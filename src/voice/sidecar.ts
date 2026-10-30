// Studio's side of the local voice engine (src/voice/sidecar.cjs): it starts the Node child on demand, speaks its stdio
// JSON protocol, sends one request at a time, and starts it again after it exits (the child leaves on its own when idle).
// The child gets the least environment (no credentials, no proxy settings, nothing of Studio's own), its text on stdin
// only, and on macOS runs under sandbox-exec with no network and no file writes: it reads the model and answers.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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
};
type Pending = { id: number; msg: Record<string, any>; ms: number; ok: (v: any) => void; bad: (e: Error) => void };

const NO_NETWORK = '(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write-data (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))';
/** the child's whole environment: enough for Node to start, nothing else */
export const sidecarEnv = (): Record<string, string> => ({ PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", NODE_OPTIONS: "", NO_COLOR: "1" });
export function sidecarArgv(o: Pick<SidecarOpts, "node" | "script" | "sandbox">): string[] {
  const sandbox = o.sandbox ?? (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"));
  return [...(sandbox ? ["/usr/bin/sandbox-exec", "-p", NO_NETWORK] : []), o.node, o.script];
}

export class Sidecar {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private ready: Promise<any> | null = null;
  private loaded = false;
  private waiting = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  /** how many children were started (tests: idle exit and restart) */
  starts = 0;
  info: { sherpa: string | null; sampleRate: number | null; loadMs: number | null } = { sherpa: null, sampleRate: null, loadMs: null };
  constructor(readonly o: SidecarOpts) {}
  get running() { return !!this.proc; }

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
      const why = Object.assign(new Error(code === 0 ? "the voice engine left (idle)" : `the voice engine stopped (exit ${code})${err.trim() ? `: ${err.trim().split("\n").at(-1)!.slice(0, 200)}` : ""}`), { idle: code === 0 });
      fail(why); for (const w of this.waiting.values()) w.bad(why); this.waiting.clear();
    });
  }
  private send(msg: Record<string, any>, ms: number): Promise<any> {
    const p = this.proc; if (!p) return Promise.reject(new Error("the voice engine is not running"));
    const id = ++this.seq;
    return new Promise((ok, bad) => {
      const timer = setTimeout(() => { if (this.waiting.delete(id)) { bad(new Error(`the voice engine took longer than ${Math.round(ms / 1000)} s`)); this.stop(); } }, ms);
      this.waiting.set(id, { id, msg, ms, ok: (v) => { clearTimeout(timer); ok(v); }, bad: (e) => { clearTimeout(timer); bad(e); } });
      try { (p.stdin as any).write(JSON.stringify({ id, ...msg }) + "\n"); (p.stdin as any).flush?.(); } catch (e: any) { this.waiting.delete(id); clearTimeout(timer); bad(new Error(`the voice engine could not be reached: ${e?.message ?? e}`)); }
    });
  }
  /** one request, after the ones before it; the child is started and the model loaded first when needed */
  request(msg: Record<string, any>): Promise<any> {
    const once = async () => {
      if (!this.proc) this.start();
      const hello = this.ready!;
      let t: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([hello, new Promise((_, bad) => { t = setTimeout(() => bad(new Error("the voice engine did not start in time")), this.o.loadTimeoutMs ?? 30_000); })])
        .catch((e) => { this.stop(); throw e; }).finally(() => clearTimeout(t));
      if (!this.loaded) { const r = await this.send({ op: "load", config: this.o.config, idleMs: this.o.idleMs ?? 10 * 60_000 }, this.o.loadTimeoutMs ?? 30_000);
        this.loaded = true; this.info.sampleRate = r.sampleRate ?? null; this.info.loadMs = r.ms ?? null; }
      return this.send(msg, this.o.timeoutMs ?? 60_000);
    };
    // the child may leave for being idle just as a request is sent: that one request starts it again, once
    const run = () => once().catch((e) => (e?.idle ? once() : Promise.reject(e)));
    const job = this.queue.then(run, run); this.queue = job.catch(() => {}); return job;
  }
  /** synthesize one run: 16-bit mono PCM and its sample rate */
  async tts(text: string, sid: number, speed = 1): Promise<{ pcm: Buffer; sampleRate: number; ms: number }> {
    const r = await this.request({ op: "tts", text, sid, speed });
    return { pcm: Buffer.from(String(r.pcm ?? ""), "base64"), sampleRate: Number(r.sampleRate) || 24000, ms: Number(r.ms) || 0 };
  }
  stop() { const p = this.proc; this.proc = null; this.loaded = false; if (p) { try { p.kill(); } catch {} const why = new Error("the voice engine was stopped"); for (const w of this.waiting.values()) w.bad(why); this.waiting.clear(); } }
}
export const scriptIn = (dir: string) => join(dir, "sidecar.cjs");
