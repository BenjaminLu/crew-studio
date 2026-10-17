// What renders films and crops: node + playwright (a headless Chromium) + ffmpeg.
// None of them is needed for Studio itself; without them the review loops still
// capture notes and briefs, and a regenerated film waits for a render. The Doctor
// shows each one with a one-click official install.
//   CREW_NODE_BIN, CREW_PLAYWRIGHT_MODULE, CREW_FFMPEG  override the lookups (tests use stubs)
//   CREW_RENDER_STUB=1  a fake renderer (tests): copies the previous MP4 (or CREW_RENDER_STUB_MP4) and writes small PNGs
import { scrubEnv } from "./secure";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import renderSrc from "./render/render.mjs" with { type: "text" };

const which = (bin: string): string | null => {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const d of (process.env.PATH ?? "").split(":")) { const p = join(d, bin); try { accessSync(p, constants.X_OK); return p; } catch {} }
  return null;
};
export const TOOLS_DIR = join(homedir(), ".crew-studio", "tools");

export function renderEnv() {
  const node = process.env.CREW_NODE_BIN ? which(process.env.CREW_NODE_BIN) : which("node");
  const ffmpeg = process.env.CREW_FFMPEG ? which(process.env.CREW_FFMPEG) : which("ffmpeg");
  const candidates = [process.env.CREW_PLAYWRIGHT_MODULE, process.env.PLAYWRIGHT_MODULE, join(TOOLS_DIR, "node_modules/playwright/index.mjs"),
    join(import.meta.dir, "../node_modules/playwright/index.mjs")].filter(Boolean) as string[];
  const playwright = candidates.find((p) => existsSync(p)) ?? null;
  const stub = process.env.CREW_RENDER_STUB === "1";
  // ffprobe reads a rendered MP4's exact size; an explicit CREW_FFPROBE that does not exist means none
  const sibling = ffmpeg && ffmpeg.includes("/") ? join(dirname(ffmpeg), "ffprobe") : null;
  const ffprobe = process.env.CREW_FFPROBE ? which(process.env.CREW_FFPROBE) : (sibling && which(sibling)) || which("ffprobe");
  return { node, ffmpeg, ffprobe, playwright, stub, canCrop: stub || !!(node && playwright), canFilm: stub || !!(node && playwright && ffmpeg) };
}

/** The account's own home from the directory service (a process may run with another HOME; Bun's userInfo follows HOME). */
let acct: string | null = null;
export function accountHome(): string {
  if (acct) return acct;
  try { const user = Bun.spawnSync(["/usr/bin/id", "-un"], { stdout: "pipe" }).stdout.toString().trim();
    const r = Bun.spawnSync(["/usr/bin/dscl", ".", "-read", `/Users/${user}`, "NFSHomeDirectory"], { stdout: "pipe", stderr: "ignore" });
    const m = /NFSHomeDirectory:\s*(\S+)/.exec(r.stdout.toString()); if (m) return (acct = m[1]); } catch {}
  return (acct = userInfo().homedir);
}

let scriptPath: string | null = null;
const script = (dataDir: string) => {
  if (scriptPath && existsSync(scriptPath)) return scriptPath;
  const dir = join(dataDir, "tools"); mkdirSync(dir, { recursive: true });
  scriptPath = join(dir, "render.mjs"); writeFileSync(scriptPath, renderSrc); return scriptPath;
};

export type RenderJob = { done: Promise<{ ok: boolean; error?: string; ms: number; info?: any }>; cancel(): void };

/** Run one render mode; onProgress gets 0..1 for films. */
export function runRender(dataDir: string, mode: "film" | "stills" | "crop" | "page" | "interact", a: Record<string, string>, onProgress: (f: number) => void = () => {}): RenderJob {
  const env = renderEnv();
  const started = Date.now();
  if (env.stub) {
    // test renderer: no browser, no ffmpeg
    const done = (async () => {
      await Bun.sleep(150);
      if (mode === "film") { const sample = process.env.CREW_RENDER_STUB_MP4; if (a.copyFrom && existsSync(a.copyFrom)) copyFileSync(a.copyFrom, a.out); else if (sample && existsSync(sample)) copyFileSync(sample, a.out); else writeFileSync(a.out, "stub mp4"); onProgress(1); }
      else if (mode === "stills") { mkdirSync(a.out, { recursive: true }); for (const t of (a.times ?? "0").split(",")) writeFileSync(join(a.out, `t${Number(t).toFixed(2)}.png`), PNG1); }
      else if (mode === "interact") return { ok: false, error: "the test renderer has no browser", ms: Date.now() - started };
      else writeFileSync(a.out, PNG1);
      return { ok: true, ms: Date.now() - started, info: mode === "page" ? { refused: [] } : undefined };
    })();
    return { done, cancel() {} };
  }
  if (!(mode === "film" ? env.canFilm : env.canCrop)) return { done: Promise.resolve({ ok: false, error: "the renderer is not installed (see Doctor)", ms: 0 }), cancel() {} };
  const argv = [env.node!, script(dataDir), mode, ...Object.entries(a).filter(([k]) => k !== "copyFrom").flatMap(([k, v]) => [`--${k}`, v])];
  // the browsers Playwright installed live in the account's cache (its documented default), whatever HOME a process runs with
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.platform === "darwin" ? join(accountHome(), "Library", "Caches", "ms-playwright") : undefined);
  const p = Bun.spawn(argv, { env: { ...scrubEnv(), CREW_PLAYWRIGHT_MODULE: env.playwright!, CREW_FFMPEG: env.ffmpeg ?? "ffmpeg", ...(browsers ? { PLAYWRIGHT_BROWSERS_PATH: browsers } : {}) }, stdout: "pipe", stderr: "pipe" });
  let last: any = null, err = "";
  (async () => { const d = new TextDecoder(); let buf = ""; for await (const c of p.stdout as any) { buf += d.decode(c, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const o = JSON.parse(l); if (typeof o.progress === "number") onProgress(o.progress); else last = o; } catch {} } } })();
  (async () => { try { err = await new Response(p.stderr as any).text(); } catch {} })();
  const timer = setTimeout(() => { try { p.kill(); } catch {} }, Number(process.env.CREW_RENDER_TIMEOUT_MS ?? 45 * 60_000));
  const done = p.exited.then(async (code) => {
    clearTimeout(timer); await Bun.sleep(30);
    if (code === 0 && last?.ok) return { ok: true, ms: Date.now() - started, info: last };
    return { ok: false, error: last?.error ?? (err.trim().split("\n").slice(-2).join(" ").slice(0, 300) || `render exited ${code}`), ms: Date.now() - started, info: last ?? undefined };
  });
  return { done, cancel: () => { try { p.kill(); } catch {} } };
}

// a 1×1 transparent PNG
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export type VideoProbe = { kind: "size"; width: number; height: number; tool: "ffprobe" | "ffmpeg"; duration?: number | null } | { kind: "no-video"; tool: "ffprobe" | "ffmpeg" } | { kind: "unreadable"; tool: "ffprobe" | "ffmpeg" } | { kind: "no-tool" };
const capture = async (argv: string[], ms: number) => {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" }); const timer = setTimeout(() => { try { p.kill(); } catch {} }, ms);
  const [out, err, code] = await Promise.all([new Response(p.stdout as any).text(), new Response(p.stderr as any).text(), p.exited]); clearTimeout(timer);
  return { out: out.slice(0, 65536), err: err.slice(0, 65536), code };
};
/** Exact pixel size of an MP4's first video stream: ffprobe, or ffmpeg's own stream listing when ffprobe is absent. */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const env = renderEnv();
  if (env.ffprobe) {
    try {
      const r = await capture([env.ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], 10000);
      if (r.code !== 0) return { kind: "unreadable", tool: "ffprobe" };
      const j = JSON.parse(r.out), s = j.streams?.[0], d = Number(j.format?.duration);
      return s && Number.isInteger(s.width) && Number.isInteger(s.height) ? { kind: "size", width: s.width, height: s.height, tool: "ffprobe", duration: Number.isFinite(d) ? d : null } : { kind: "no-video", tool: "ffprobe" };
    } catch { return { kind: "unreadable", tool: "ffprobe" }; }
  }
  if (env.ffmpeg) {
    try {
      // `ffmpeg -i` with no output lists the streams on stderr and exits 1
      const r = await capture([env.ffmpeg, "-hide_banner", "-nostdin", "-i", file], 10000);
      const v = /Stream #\d+:\d+[^\n]*?: Video: [^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(r.err);
      const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.err);
      if (v) return { kind: "size", width: Number(v[1]), height: Number(v[2]), tool: "ffmpeg", duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null };
      return /Input #0/.test(r.err) ? { kind: "no-video", tool: "ffmpeg" } : { kind: "unreadable", tool: "ffmpeg" };
    } catch { return { kind: "unreadable", tool: "ffmpeg" }; }
  }
  return { kind: "no-tool" };
}
/** Mean brightness (0-255) of the frame at t seconds, from a 16x9 grey scale-down; null without ffmpeg or a frame. */
export async function frameLuma(file: string, t: number): Promise<number | null> {
  const ffmpeg = renderEnv().ffmpeg; if (!ffmpeg) return null;
  try {
    const p = Bun.spawn([ffmpeg, "-v", "error", "-nostdin", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", "scale=16:9,format=gray", "-f", "rawvideo", "pipe:1"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, 10000);
    const [bytes, code] = await Promise.all([new Response(p.stdout as any).arrayBuffer(), p.exited]); clearTimeout(timer);
    const b = new Uint8Array(bytes); if (code !== 0 || !b.length) return null;
    let sum = 0; for (const v of b) sum += v; return sum / b.length;
  } catch { return null; }
}
/** The film length the captain asked for, in seconds: the last "10 s", "10-second", "1 minute", "10 秒" in the texts given (latest word wins). */
export function requestedSeconds(texts: string[]): number | null {
  let found: number | null = null;
  for (const t of texts) for (const m of String(t ?? "").matchAll(/(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s|minutes?|mins?|秒|分鐘)(?![a-z])/gi)) { const n = Number(m[1]); if (n > 0 && n <= 3600) found = /^(m|分)/i.test(m[2]) ? n * 60 : n; }
  return found;
}
