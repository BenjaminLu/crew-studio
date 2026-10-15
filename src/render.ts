// What renders films and crops: node + playwright (a headless Chromium) + ffmpeg.
// None of them is needed for Studio itself; without them the review loops still
// capture notes and briefs, and a regenerated film waits for a render. The Doctor
// shows each one with a one-click official install.
//   CREW_NODE_BIN, CREW_PLAYWRIGHT_MODULE, CREW_FFMPEG  override the lookups (tests use stubs)
//   CREW_RENDER_STUB=1  a fake renderer (tests): copies the previous MP4 and writes small PNGs
import { scrubEnv } from "./secure";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
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
  return { node, ffmpeg, playwright, stub, canCrop: stub || !!(node && playwright), canFilm: stub || !!(node && playwright && ffmpeg) };
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
export function runRender(dataDir: string, mode: "film" | "stills" | "crop" | "page", a: Record<string, string>, onProgress: (f: number) => void = () => {}): RenderJob {
  const env = renderEnv();
  const started = Date.now();
  if (env.stub) {
    // test renderer: no browser, no ffmpeg
    const done = (async () => {
      await Bun.sleep(150);
      if (mode === "film") { if (a.copyFrom && existsSync(a.copyFrom)) copyFileSync(a.copyFrom, a.out); else writeFileSync(a.out, "stub mp4"); onProgress(1); }
      else if (mode === "stills") { mkdirSync(a.out, { recursive: true }); for (const t of (a.times ?? "0").split(",")) writeFileSync(join(a.out, `t${Number(t).toFixed(2)}.png`), PNG1); }
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
    return { ok: false, error: last?.error ?? (err.trim().split("\n").slice(-2).join(" ").slice(0, 300) || `render exited ${code}`), ms: Date.now() - started };
  });
  return { done, cancel: () => { try { p.kill(); } catch {} } };
}

// a 1×1 transparent PNG
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
