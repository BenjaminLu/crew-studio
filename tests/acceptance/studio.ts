// A real Studio server for the acceptance harness: `bun src/server.ts` on a free port, a temporary
// CREW_DATA and HOME, and the providers bound to the stub CLIs through the existing overrides
// (CREW_CODEX_BIN, CREW_CLAUDE_BIN, CREW_HOST_CODEX_BIN). Nothing in Studio is replaced in process:
// rounds go through Agents.execute, the sandbox profile, the egress proxy, the path check, the
// round env and login copy, staffing admission and the signed ledger exactly as on the live board.
// The harness acts as the captain through the same HTTP routes the board uses (session header).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, lstatSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { freePort, waitUp } from "../boot.mjs";

const REPO = join(import.meta.dir, "../..");
export const TERMINAL = ["succeeded", "failed", "cancelled"];
/** The CLI stubs (tests/fixture/codex-account.mjs, tests/fixture/claude-native.mjs) switch to the scripted agent on these logins. */
const CODEX_AUTH = { auth_mode: "chatgpt", last_refresh: "2020-02-29T12:34:56.123+08:00", tokens: { access_token: "abcdefgh.abcdefgh.abcdefgh", id_token: "fixture-id-token", account_id: "fixture-acceptance", refresh_token: "acceptance-refresh-must-not-copy" } };
const CLAUDE_TOKEN = "sk-ant-oat01-acceptance" + "0".repeat(40); // a fixture login of the official shape; not a credential

export type Api = (path: string, body?: unknown) => Promise<{ status: number; body: any }>;
export type Studio = { name: string; base: string; data: string; root: string; api: Api; output: () => string; close: () => Promise<void> };

/**
 * The film the stub renderer copies into a render (CREW_RENDER_STUB_MP4, src/render.ts): a real
 * 1920x1080, 1 s H.264 MP4, made once per suite with the same ffmpeg command as
 * tests/non-code-workflows.ts (goodMp4), so the video readiness probe reads a real film. Without
 * ffmpeg it is null with the reason, and the runs that need it are skipped, not passed.
 */
export const filmSample: { path: string | null; reason: string | null } = (() => {
  const ffmpeg = Bun.which("ffmpeg"); if (!ffmpeg) return { path: null, reason: "ffmpeg is not on PATH: no real sample film for the stub renderer" };
  const dir = mkdtempSync(join(tmpdir(), "crew-acceptance-media-")), f = join(dir, "1920x1080.mp4");
  process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  const r = Bun.spawnSync([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x102030:s=1920x1080:d=1:r=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", f], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? { path: f, reason: null } : { path: null, reason: `ffmpeg could not make the sample film: ${r.stderr.toString().trim().slice(0, 300)}` };
})();

export async function bootStudio(name: string, o: { localUnrestricted?: boolean; beforeStart?: (data:string)=>Promise<void> } = {}): Promise<Studio> {
  const root = mkdtempSync(join(tmpdir(), `crew-acceptance-${name}-`)), home = join(root, "home"), data = join(root, "data"), deps = join(root, "deps");
  for (const d of [join(home, ".codex"), data, deps]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, ".codex", "config.toml"), 'model="fixture-model"\nmodel_reasoning_effort="low"\n');
  writeFileSync(join(home, ".codex", ".fixture-account.json"), '{"authenticated":true}');
  writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify(CODEX_AUTH), { mode: 0o600 });
  const port = await freePort(), base = `http://127.0.0.1:${port}`, token = `acceptance-${name}-session`;
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home, CODEX_HOME: join(home, ".codex"), CREW_DATA: data, CREW_RUNTIME_DIR: join(root, "runtime"), CREW_PORT: String(port),
    CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1",
    CREW_CODEX_BIN: join(REPO, "tests/fixture/codex-account.mjs"), CREW_CLAUDE_BIN: join(REPO, "tests/fixture/claude-native.mjs"),
    CREW_HOST_CODEX_BIN: join(REPO, "tests/fixture/codex-account.mjs"), CREW_HOST_CLAUDE_BIN: "/nonexistent/claude",
    CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN,
    // the film renderer is a local tool, not a provider: its existing stub (src/render.ts) stands in for Playwright + ffmpeg
    CREW_RENDER_STUB: "1", ...(filmSample.path ? { CREW_RENDER_STUB_MP4: filmSample.path } : {}),
    CREW_LOCAL_UNRESTRICTED: o.localUnrestricted ? "1" : "0", ...(o.localUnrestricted ? { CREW_LOCAL_DEPENDENCY_ROOT: deps } : {}) };
  for (const k of [...(filmSample.path ? [] : ["CREW_RENDER_STUB_MP4"]), "CREW_MAIN_PROJECT", "CREW_FM_STATE", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CODEX_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "CREW_CHAT_PROVIDER", "CLAUDE_CONFIG_DIR", "CREW_CODEX_MODEL", "CREW_CLAUDE_MODEL", "CREW_CLAUDE_BILLING", "CREW_TEST_IN_PROCESS"]) delete env[k];
  if (!o.localUnrestricted) delete env.CREW_LOCAL_DEPENDENCY_ROOT;
  await o.beforeStart?.(data);
  let out = "";
  const app: ChildProcess = spawn("bun", ["src/server.ts"], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout!.on("data", (b) => { if (out.length < 400_000) out += b; }); app.stderr!.on("data", (b) => { if (out.length < 400_000) out += b; });
  await waitUp(base, app);
  const api: Api = async (path, body) => {
    const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-session": token }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; }
    return { status: r.status, body: parsed };
  };
  const close = async () => {
    try { for (const r of (await api("/api/wruns")).body.runs ?? []) if (!TERMINAL.includes(r.status)) await api(`/api/wruns/${r.id}/cancel`, { reason: "acceptance cleanup" }); } catch {}
    if (app.exitCode === null && app.signalCode === null) { const done = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await Promise.race([done, Bun.sleep(8000)]); if (app.exitCode === null) app.kill("SIGKILL"); }
    if (process.env.ACCEPTANCE_KEEP) { console.log(`acceptance: kept ${root}`); return; }
    const thaw = (p: string) => { try { const st = lstatSync(p); if (st.isSymbolicLink()) return; if (st.isDirectory()) { chmodSync(p, st.mode | 0o700); for (const e of readdirSync(p)) thaw(join(p, e)); } } catch {} };
    thaw(root); rmSync(root, { recursive: true, force: true });
  };
  return { name, base, data, root, api, output: () => out, close };
}
