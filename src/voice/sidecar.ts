// Studio's side of the local voice engine (src/voice/sidecar.cjs): it starts the Node child on demand, speaks its stdio
// JSON protocol, sends one request at a time, and starts it again after it exits (the child leaves on its own when idle).
// The child gets the least environment (no credentials, no proxy settings, nothing of Studio's own), its text on stdin
// only, and on macOS runs under sandbox-exec with a deny-by-default profile: it may run its own Node and read that Node,
// the system's libraries, its own folder and the verified model, and nothing else: no network, no file writes, no
// other program, no Apple events, no system services.
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

export type SidecarOpts = {
  node: string; script: string;
  /** the model config the child loads before its first synthesis (models.ts kokoroConfig) */
  config: Record<string, any>;
  /** the child exits after this long with nothing to do */
  idleMs?: number;
  /** how long a request may take before the child is stopped (synthesis of one run, or the model load) */
  timeoutMs?: number; loadTimeoutMs?: number;
  /** false: no sandbox-exec (tests on other systems); default: on macOS when /usr/bin/sandbox-exec exists */
  sandbox?: boolean;
  /** the folders the child may read besides Node and the system (the model's); the script's own folder always */
  reads?: string[];
};
type Pending = { id: number; msg: Record<string, any>; ms: number; ok: (v: any) => void; bad: (e: Error) => void };

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const q = (p: string) => JSON.stringify(p); // an SBPL string: quotes and backslashes escaped
/** a binary's linked libraries as `otool -L` lists them (tests pass their own) */
export type Otool = (bin: string) => string;
const otoolL: Otool = (bin) => { try { const r = Bun.spawnSync(["/usr/bin/otool", "-L", bin], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "ignore", timeout: 5000 }); return r.success ? r.stdout.toString() : ""; } catch { return ""; } };
/** The folders of the libraries Node links beyond the system's (a Homebrew Node links icu4c, libuv, OpenSSL… from
 *  /opt/homebrew/opt, which are links into its Cellar), each by its real path: absolute paths only, never a home folder
 *  unless it is inside Node's own install prefix (an nvm Node's own lib folder). Found when the engine starts. */
export function nodeLibDirs(node: string, otool: Otool = otoolL): string[] {
  const n = real(node), home = homedir(), prefix = dirname(dirname(n));
  const tooWide = (d: string) => d === "/" || d === home || d === dirname(home) || /^\/(Users|home|usr|private|opt)?$/.test(d) || /^(\/private)?\/(tmp|var\/tmp|var\/folders)(\/|$)/.test(d);
  const inPrefix = (d: string) => !tooWide(prefix) && (d === prefix || d.startsWith(prefix + "/"));
  const atHome = (d: string) => d === home || d.startsWith(home + "/") || /^\/(Users|home)\//.test(d);
  const out = new Set<string>();
  for (const line of otool(n).split("\n").slice(1)) {
    const m = /^\s+(\/.+?) \(compatibility version/.exec(line); if (!m) continue;
    const lib = normalize(m[1]); if (!isAbsolute(lib) || lib.startsWith("/usr/lib/") || lib.startsWith("/System/")) continue;
    const d = dirname(real(lib));
    if (!isAbsolute(d) || tooWide(d) || (atHome(d) && !inPrefix(d))) continue;
    out.add(d);
  }
  return [...out].sort();
}
/** The child's sandbox: deny by default; exec of its own Node only; reads of that Node, its own linked libraries, the
 *  system's libraries and frameworks, timezone and ICU data, a few devices and the given folders; file metadata (so paths
 *  resolve); nothing else. */
export function sandboxProfile(node: string, reads: string[], otool?: Otool): string {
  const n = real(node), dirs = [...new Set([...reads.map(real), ...nodeLibDirs(node, otool)])];
  return ["(version 1)", "(deny default)",
    `(allow process-exec (literal ${q(n)}))`,
    "(allow file-read-metadata)",
    `(allow file-read* (literal "/") (literal ${q(n)}) (subpath "/usr/lib") (subpath "/System/Library") (subpath "/System/Cryptexes") (subpath "/private/var/db/timezone") (subpath "/usr/share/icu") (subpath "/private/var/db/dyld")`,
    `  (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")${dirs.map((d) => ` (subpath ${q(d)})`).join("")})`,
    '(allow file-write-data (literal "/dev/null"))',
    "(allow sysctl-read)", "(allow signal (target self))"].join("\n");
}
/** the child's whole environment: enough for Node to start, nothing else */
export const sidecarEnv = (): Record<string, string> => ({ PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", NODE_OPTIONS: "", NO_COLOR: "1" });
export function sidecarArgv(o: Pick<SidecarOpts, "node" | "script" | "sandbox" | "reads">): string[] {
  const sandbox = o.sandbox ?? (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"));
  // under the sandbox Node runs by its real path: the profile allows exec of that one file
  return sandbox ? ["/usr/bin/sandbox-exec", "-p", sandboxProfile(o.node, [dirname(o.script), ...(o.reads ?? [])]), real(o.node), o.script] : [o.node, o.script];
}

/** after this many failures in a row (crashes or timeouts) the engine is not started again for a while: it keeps crashing */
export const CRASH_LIMIT = 5;
export const crashingError = () => Object.assign(new Error("The local voice engine keeps crashing; this Mac's voice speaks instead / 語音引擎一直當掉，改用這台 Mac 的聲音"), { code: "voice_crashing" });
const stopped = () => Object.assign(new Error("stopped"), { code: "aborted" });
/** every engine Studio started, so Studio's shutdown stops them all */
const live = new Set<Sidecar>();
export const stopAllSidecars = () => { for (const s of live) s.stop(); };

export class Sidecar {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private ready: Promise<any> | null = null;
  private loaded = false;
  private waiting = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  /** how many children were started (tests: idle exit, restart, back-off) */
  starts = 0;
  /** failures in a row, and when the next start may happen (exponential back-off, capped) */
  failures = 0; private notBefore = 0;
  info: { sherpa: string | null; sampleRate: number | null; loadMs: number | null } = { sherpa: null, sampleRate: null, loadMs: null };
  constructor(readonly o: SidecarOpts & { backoffMs?: number; backoffMaxMs?: number }) { live.add(this); }
  get running() { return !!this.proc; }
  get crashing() { return this.failures >= CRASH_LIMIT; }
  private failed() { this.failures++; const base = this.o.backoffMs ?? 500, max = this.o.backoffMaxMs ?? 60_000; this.notBefore = Date.now() + Math.min(max, base * 2 ** (this.failures - 1)); }

  private start() {
    this.starts++; this.loaded = false;
    const p = Bun.spawn(sidecarArgv(this.o), { cwd: dirname(this.o.script), env: sidecarEnv(), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.proc = p;
    let hello: (v: any) => void = () => {}, fail: (e: Error) => void = () => {};
    this.ready = new Promise((ok, bad) => { hello = ok; fail = bad; });
    this.ready.catch(() => {});
    let err = "";
    (async () => { try { for await (const c of p.stderr as any) err = (err + new TextDecoder().decode(c)).slice(-2000); } catch {} })();
    (async () => {
      const d = new TextDecoder(); let buf = "";
      try { for await (const c of p.stdout as any) { buf += d.decode(c, { stream: true }); let i;
        while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m: any; try { m = JSON.parse(line); } catch { continue; }
          if ("ready" in m) { if (m.ready) { this.info.sherpa = m.sherpa ?? null; hello(m); } else fail(new Error(String(m.error ?? "the voice engine did not start"))); continue; }
          const w = this.waiting.get(m.id); if (w) { this.waiting.delete(m.id); m.ok ? w.ok(m) : w.bad(new Error(String(m.error ?? "the voice engine refused"))); } } } } catch {}
    })();
    p.exited.then((code) => {
      if (this.proc !== p) return;
      this.proc = null; this.loaded = false;
      if (code !== 0) this.failed();
      const why = Object.assign(new Error(code === 0 ? "the voice engine left (idle)" : `the voice engine stopped (exit ${code})${err.trim() ? `: ${err.trim().split("\n").at(-1)!.slice(0, 200)}` : ""}`), { idle: code === 0 });
      fail(why); for (const w of this.waiting.values()) w.bad(why); this.waiting.clear();
    });
  }
  private send(msg: Record<string, any>, ms: number, signal?: AbortSignal): Promise<any> {
    const p = this.proc; if (!p) return Promise.reject(new Error("the voice engine is not running"));
    if (signal?.aborted) return Promise.reject(stopped());
    const id = ++this.seq;
    return new Promise((ok, bad) => {
      // a request given up while the engine works on it: the engine is stopped (a synthesis cannot be cut short), the next one starts it again
      const abort = () => { if (this.waiting.delete(id)) { clearTimeout(timer); bad(stopped()); this.stop(); } };
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      const timer = setTimeout(() => { if (this.waiting.delete(id)) { done(); bad(new Error(`the voice engine took longer than ${Math.round(ms / 1000)} s`)); this.failed(); this.stop(); } }, ms);
      signal?.addEventListener("abort", abort);
      this.waiting.set(id, { id, msg, ms, ok: (v) => { done(); ok(v); }, bad: (e) => { done(); bad(e); } });
      try { (p.stdin as any).write(JSON.stringify({ id, ...msg }) + "\n"); (p.stdin as any).flush?.(); } catch (e: any) { this.waiting.delete(id); done(); bad(new Error(`the voice engine could not be reached: ${e?.message ?? e}`)); }
    });
  }
  /** one request, after the ones before it; the child is started and the model loaded first when needed. A request given up
   *  while it waits its turn is dropped without reaching the engine. */
  request(msg: Record<string, any>, signal?: AbortSignal): Promise<any> {
    const once = async () => {
      if (signal?.aborted) throw stopped();
      if (!this.proc) {
        if (this.crashing && Date.now() < this.notBefore) throw crashingError();
        const wait = this.notBefore - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (signal?.aborted) throw stopped();
        this.start();
      }
      const hello = this.ready!;
      let t: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([hello, new Promise((_, bad) => { t = setTimeout(() => bad(new Error("the voice engine did not start in time")), this.o.loadTimeoutMs ?? 30_000); })])
        .catch((e) => { if (this.proc) { this.failed(); this.stop(); } throw e; }).finally(() => clearTimeout(t));
      if (!this.loaded) { const r = await this.send({ op: "load", config: this.o.config, idleMs: this.o.idleMs ?? 10 * 60_000 }, this.o.loadTimeoutMs ?? 30_000, signal);
        this.loaded = true; this.info.sampleRate = r.sampleRate ?? null; this.info.loadMs = r.ms ?? null; }
      const r = await this.send(msg, this.o.timeoutMs ?? 60_000, signal); this.failures = 0; return r;
    };
    // the child may leave for being idle just as a request is sent: that one request starts it again, once
    const run = () => once().catch((e) => (e?.idle ? once() : Promise.reject(e)));
    const job = this.queue.then(run, run); this.queue = job.catch(() => {}); return job;
  }
  /** synthesize one run: 16-bit mono PCM and its sample rate */
  async tts(text: string, sid: number, speed = 1, signal?: AbortSignal): Promise<{ pcm: Buffer; sampleRate: number; ms: number }> {
    const r = await this.request({ op: "tts", text, sid, speed }, signal);
    return { pcm: Buffer.from(String(r.pcm ?? ""), "base64"), sampleRate: Number(r.sampleRate) || 24000, ms: Number(r.ms) || 0 };
  }
  stop() { const p = this.proc; this.proc = null; this.loaded = false; if (p) { try { p.kill(); } catch {} const why = new Error("the voice engine was stopped"); for (const w of this.waiting.values()) w.bad(why); this.waiting.clear(); } }
}
export const scriptIn = (dir: string) => join(dir, "sidecar.cjs");
