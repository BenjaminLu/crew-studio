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
import { TAB_CSP } from "./preview-csp";

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
export function runRender(dataDir: string, mode: "film" | "stills" | "crop" | "page" | "interact" | "pdf", a: Record<string, string>, onProgress: (f: number) => void = () => {}): RenderJob {
  const env = renderEnv();
  const started = Date.now();
  if (env.stub) {
    // test renderer: no browser, no ffmpeg
    const done = (async () => {
      await Bun.sleep(150);
      if (mode === "film") { const sample = process.env.CREW_RENDER_STUB_MP4; if (a.copyFrom && existsSync(a.copyFrom)) copyFileSync(a.copyFrom, a.out); else if (sample && existsSync(sample)) copyFileSync(sample, a.out); else writeFileSync(a.out, "stub mp4"); onProgress(1); }
      else if (mode === "stills") { mkdirSync(a.out, { recursive: true }); for (const t of (a.times ?? "0").split(",")) writeFileSync(join(a.out, `t${Number(t).toFixed(2)}.png`), PNG1); }
      else if (mode === "interact" || mode === "pdf") return { ok: false, error: "the test renderer has no browser", ms: Date.now() - started };
      else writeFileSync(a.out, PNG1);
      return { ok: true, ms: Date.now() - started, info: mode === "page" ? { refused: [] } : undefined };
    })();
    return { done, cancel() {} };
  }
  if (!(mode === "film" ? env.canFilm : env.canCrop)) return { done: Promise.resolve({ ok: false, error: "the renderer is not installed (see Doctor)", ms: 0 }), cancel() {} };
  // the interaction smoke serves the page under the captain's preview-tab policy (sandbox and CSP), so a
  // control that policy kills is dead in the smoke too; `csp` overrides it only for tests. It vouches for the
  // new-tab path: Studio's interactive dialog (INTERACTIVE_CSP) also refuses the page's own external scripts and images
  if (mode === "interact") a = { ...a, csp: a.csp ?? TAB_CSP };
  const argv = [env.node!, script(dataDir), mode, ...Object.entries(a).filter(([k]) => k !== "copyFrom").flatMap(([k, v]) => [`--${k}`, v])];
  // the browsers Playwright installed live in the account's cache (its documented default), whatever HOME a process runs with
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.platform === "darwin" ? join(accountHome(), "Library", "Caches", "ms-playwright") : undefined);
  const p = Bun.spawn(argv, { env: { ...scrubEnv(), CREW_PLAYWRIGHT_MODULE: env.playwright!, CREW_FFMPEG: env.ffmpeg ?? "ffmpeg", ...(browsers ? { PLAYWRIGHT_BROWSERS_PATH: browsers } : {}) }, stdout: "pipe", stderr: "pipe" });
  let last: any = null, err = "";
  (async () => { const d = new TextDecoder(); let buf = ""; for await (const c of p.stdout as any) { buf += d.decode(c, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const o = JSON.parse(l); if (typeof o.progress === "number") onProgress(o.progress); else last = o; } catch {} } } })();
  (async () => { try { err = await new Response(p.stderr as any).text(); } catch {} })();
  // an interaction smoke is bounded tightly (a page's own handler can hang the browser); a film may take long
  const limit = mode === "interact" ? Number(process.env.CREW_INTERACT_TIMEOUT_MS ?? 90_000) : mode === "pdf" ? Number(process.env.CREW_PDF_TIMEOUT_MS ?? 60_000) : Number(process.env.CREW_RENDER_TIMEOUT_MS ?? 45 * 60_000);
  let timedOut = false; const timer = setTimeout(() => { timedOut = true; try { p.kill(); } catch {} }, limit);
  const done = p.exited.then(async (code) => {
    clearTimeout(timer); await Bun.sleep(30);
    if (timedOut) return { ok: false, error: `timed out after ${Math.round(limit / 1000)} s`, ms: Date.now() - started, info: undefined };
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
/** Brightness (0-255) of the frame at t seconds, from a 64x36 grey scale-down: its mean (fades) and its 99th
 *  percentile (a frame is black only when even its brightest part is dark: a white title on black is not black).
 *  null without ffmpeg or a frame. */
export async function frameLuma(file: string, t: number): Promise<{ mean: number; peak: number } | null> {
  const ffmpeg = renderEnv().ffmpeg; if (!ffmpeg) return null;
  try {
    const p = Bun.spawn([ffmpeg, "-v", "error", "-nostdin", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "pipe:1"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, 10000);
    const [bytes, code] = await Promise.all([new Response(p.stdout as any).arrayBuffer(), p.exited]); clearTimeout(timer);
    const b = new Uint8Array(bytes); if (code !== 0 || !b.length) return null;
    let sum = 0; for (const v of b) sum += v; const sorted = [...b].sort((x, y) => x - y);
    return { mean: sum / b.length, peak: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] };
  } catch { return null; }
}
const FILM = String.raw`(?:film|video|movie|promo|clip|reel|teaser|trailer|spot|ad|animation)`, UNIT = String.raw`(seconds?|secs?|minutes?|mins?)`, NUM = String.raw`(\d{1,3}(?:\.\d+)?)(?!\d)`;
// only a length tied to the film itself: "a 30-second film", "a film of 30 seconds", "make the video 20 seconds",
// "30 秒影片"; a "5-second intro", "hold the logo for 3 seconds", "1990s" or a bare "10s" is not the film's length
const LENGTH = [
  new RegExp(String.raw`(?<![\d.])${NUM}[\s-]*${UNIT}[\s-]+(?:long\s+)?(?:[a-z]+\s+){0,2}?${FILM}s?\b`, "gi"),
  new RegExp(String.raw`\b${FILM}\s+(?:that\s+(?:is|runs|lasts)\s+|(?:of|lasting|running|runs|lasts|should\s+(?:be|run|last))\s+)(?:about\s+|exactly\s+)?${NUM}\s*${UNIT}\b`, "gi"),
  new RegExp(String.raw`\b(?:make|keep)\s+the\s+${FILM}\s+(?:about\s+|exactly\s+)?${NUM}\s*${UNIT}\b`, "gi"),
  new RegExp(String.raw`(?<![\d.])${NUM}\s*(秒|分鐘|分钟)(?:的|長的|长的)?\s*(?:影片|短片|影像|視頻|视频|動畫|动画)`, "g"),
  new RegExp(String.raw`(?:影片|短片|視頻|视频)(?:長度|长度|時長|时长)?\s*(?:為|为|是|約|约)?\s*${NUM}\s*(秒|分鐘|分钟)`, "g"),
];
/** The film length the captain asked for, in seconds, from phrases tied to the film; the latest text that names
 *  one wins. null when nothing names the film's length unambiguously (the check is then skipped). */
export function requestedSeconds(texts: string[]): number | null {
  let found: number | null = null;
  for (const t of texts) {
    const values = new Set<number>();
    for (const re of LENGTH) for (const m of String(t ?? "").matchAll(re)) { const n = Number(m[1]), unit = m[2]; if (n > 0 && n <= 600) values.add(/^(m|分)/i.test(unit) ? n * 60 : n); }
    if (values.size === 1) found = [...values][0]; // two different film lengths in one text: ambiguous, not used
  }
  return found;
}
