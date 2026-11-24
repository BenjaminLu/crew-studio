// A pull request's review room seeded on disk with three page versions, and a real isolated Studio that serves it, for the
// page download suites (tests/review-room-download.ts, tests/review-room-download-ui.mjs; docs/units/review-room.md,
// "Downloading a page"). Temporary data and HOME, a free port (never Studio's own), stub providers, no GitHub: nothing paid runs.
//   v1  one HTML file, by a skill whose id needs sanitising for a file name; its file is changed on disk by the suite
//   v2  a page and its picture (fig.png): downloads as a zip
//   v3  baton's shape: one self-contained HTML page carrying its context for a reader's agent and its own download button
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { freePort, waitUp } from "../boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const sha = (b) => createHash("sha256").update(b).digest("hex");
export const REPO = "sample-org/money-kit", ID = `PR-${sha(REPO).slice(0, 12)}-7`, H = "a".repeat(40), B = "b".repeat(40);
/** the odd skill id of v1: quotes, a slash, dots, spaces and CJK, none of which may reach the file name */
export const ODD_SKILL = '我的 walk/../"through"';
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2a3c5350000000049454e44ae426082", "hex");
const BATON = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Add percent · baton</title>
<style>body{font:16px system-ui;margin:24px;max-width:760px}button{font:inherit}</style></head><body>
<h1>Add percent, handed on</h1><p>The change adds <code>percent()</code>: 1999 × 15% rounds to 300 cents. 半數進位：2.5 變 3。</p>
<button id="ctx">Download context</button> <span id="said"></span>
<script type="application/json" id="baton-data">{"context":"# percent\\nThe change adds percent(amount, pct), rounded to the cent."}</script>
<script>document.getElementById('ctx').onclick=function(){var t=JSON.parse(document.getElementById('baton-data').textContent).context;
var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/markdown'}));a.download='context.md';document.body.appendChild(a);a.click();
document.getElementById('said').textContent='saved context.md';};</script></body></html>
`;
export const FILES = {
  1: { skill: { id: ODD_SKILL, v: 1, name: "walkthrough" }, files: { "index.html": "<!doctype html><html><head><meta charset=\"utf-8\"><title>v1</title></head><body><h1>v1: percent, step by step</h1></body></html>\n" }, summary: "One page: percent, step by step" },
  2: { skill: { id: "walkthrough", v: 1, name: "walkthrough" }, files: { "index.html": "<!doctype html><html><head><meta charset=\"utf-8\"><title>v2</title></head><body><h1>v2 with a figure</h1><img src=\"fig.png\" alt=\"figure\"></body></html>\n", "fig.png": PNG }, summary: "The page with its figure" },
  3: { skill: { id: "studio-baton", v: 2, name: "baton", upstream: "ba68615" }, files: { "index.html": BATON }, summary: "Add percent, handed on" },
};

/** the room on disk: its record and its explainer's state, each version's files with the sha256 they were kept with (FILES,
 *  or another suite's versions in the same shape) */
export function seedRoom(data, files = FILES) {
  const prDir = join(data, "review-room", "pr"), xdir = join(prDir, `${ID}-explain`); mkdirSync(xdir, { recursive: true });
  writeFileSync(join(prDir, `${ID}.json`), JSON.stringify({ schema: 1, run: "", card: ID, node: "", head: H, base: B, turns: [], board: [], sources: [], check: { questions: [] },
    subject: { kind: "pr", room: ID, url: `https://github.com/${REPO}/pull/7`, repository: REPO, number: 7, project: null, task: null },
    pr: { title: "Add percent", body: "", state: "open", merged: false, mergedAt: null, closedAt: null, draft: false, author: "someone", headRef: "percent", headRepo: REPO, baseRef: "main", head: H, base: B, files: [], notes: [], checkedAt: new Date().toISOString(), truncated: false } }));
  const versions = [], runs = [];
  for (const [k, x] of Object.entries(files)) { const n = Number(k), dir = join(xdir, `v${n}`), list = [];
    for (const [p, c] of Object.entries(x.files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); list.push({ path: p, bytes: Buffer.byteLength(c), sha256: sha(c) }); }
    versions.push({ n, run: n, skill: x.skill, at: `2026-11-01T10:0${n}:00Z`, entry: "index.html", kind: "html", files: list, summary: x.summary, from: null, prompt: "" });
    runs.push({ n, kind: "generate", skill: { ...x.skill, sha256: "x", filesSha256: "x", bodySha: "x" }, status: "done", by: "captain", at: `2026-11-01T10:0${n}:00Z`, ended: `2026-11-01T10:0${n}:30Z`, provider: "claude", model: "claude-opus-5", effort: null, confirm: "c", limitMin: 120, rounds: [], cost: { usd: 0.1 * n }, error: null, progress: [], from: null, version: n, head: H }); }
  writeFileSync(join(xdir, "state.json"), JSON.stringify({ schema: 1, selected: { id: "studio-baton", v: 2 }, runs, versions, autoTried: [H] }));
  return { xdir, file: (n, p) => join(xdir, `v${n}`, p) };
}

/** a real Studio on a free port, temporary data and HOME; the caller stops it (stop()) in finally */
export async function startStudio(tag, files = FILES) {
  process.env.CREW_SESSION_TOKEN ??= "test-session";
  const tmp = mkdtempSync(join(tmpdir(), `crew-${tag}-`)), data = join(tmp, "data"), home = join(tmp, "home"); mkdirSync(data); mkdirSync(home);
  const room = seedRoom(data, files), port = await freePort(), tailnet = `${tag}.tailnet.example`;
  const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
  const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, DISABLE_AUTOUPDATER: "1", CREW_REVIEW_EXPLAIN_DEFAULT_SKILL: "", CREW_TAILNET_NAME: tailnet, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
    CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
  let log = ""; app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`; await waitUp(base, app);
  return { tmp, data, home, port, base, tailnet, room, app, log: () => log, stop: () => { try { app.kill(); } catch {} } };
}

/** pair a phone the way Studio does (a code from the Mac, then the phone over the tailnet name) and read as it */
export async function phone(s) {
  const { request } = await import("node:http");
  const raw = (method, path, o = {}) => new Promise((resolve) => { const payload = method === "GET" ? undefined : JSON.stringify(o.body ?? {});
    const headers = { host: o.host ?? `127.0.0.1:${s.port}`, ...(o.token ? { authorization: `Bearer ${o.token}` } : { "x-crew-session": process.env.CREW_SESSION_TOKEN }), ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) };
    const q = request({ host: "127.0.0.1", port: s.port, method, path, headers }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode ?? 0, body: j, cd: res.headers["content-disposition"] ?? null }); }); });
    q.on("error", () => resolve({ status: 0, body: null })); if (payload) q.write(payload); q.end(); });
  const code = (await raw("POST", "/api/remote/pair/start")).body?.code, token = (await raw("POST", "/api/remote/pair", { host: s.tailnet, body: { code, name: "Pixel" } })).body?.token;
  return { token, get: (path) => raw("GET", path, { host: s.tailnet, token }) };
}

/** the entries of a zip Studio wrote (src/zip.ts: local headers in order, stored or deflated) */
export function unzipEntries(b) {
  const out = new Map(); let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) { const method = b.readUInt16LE(p + 8), size = b.readUInt32LE(p + 18), n = b.readUInt16LE(p + 26), x = b.readUInt16LE(p + 28);
    const name = b.subarray(p + 30, p + 30 + n).toString("utf8"), at = p + 30 + n + x, data = b.subarray(at, at + size); out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data)); p = at + size; }
  return out;
}
