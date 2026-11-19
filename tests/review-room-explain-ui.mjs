import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The room's page on the page (public/review-explain.js, docs/units/review-room.md): the header's picker (baton built in and the
// captain's library skill), the paid run's confirmation, the background run's progress and Stop, the output in a sandboxed
// frame served by a real Studio under the output CSP (the page in it cannot fetch, cannot read Studio, has working storage),
// a question about the page shown and its answer in the chat, the version menu, an older version, a video. A real isolated
// Studio serves the skill import, the capability and the version's page; the room and the paid runs are answered by the test:
// nothing paid runs.
//        node tests/review-room-explain-ui.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-explain-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-explain-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort(), TAILNET = "explain-ui-test.tailnet.example";
const sha = (b) => createHash("sha256").update(b).digest("hex");
// a made-up pull request's room, seeded on disk: what the explainer's own routes (the capability, the page) read
const REPO = "sample-org/money-kit", ID = `PR-${sha(REPO).slice(0, 12)}-7`, H = "a".repeat(40), B = "b".repeat(40);
const prDir = join(data, "review-room", "pr"), xdir = join(prDir, `${ID}-explain`); mkdirSync(xdir, { recursive: true });
writeFileSync(join(prDir, `${ID}.json`), JSON.stringify({ schema: 1, run: "", card: ID, node: "", head: H, base: B, turns: [], board: [], sources: [], check: { questions: [] },
  subject: { kind: "pr", room: ID, url: `https://github.com/${REPO}/pull/7`, repository: REPO, number: 7, project: null, task: null },
  pr: { title: "Add percent", body: "", state: "open", merged: false, mergedAt: null, closedAt: null, draft: false, author: "someone", headRef: "percent", headRepo: REPO, baseRef: "main", head: H, base: B, files: [], notes: [], checkedAt: "2026-11-01T10:00:00Z", truncated: false } }));
const page = (n, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><title>percent, step by step</title><style>body{font:16px system-ui;margin:24px}svg rect{fill:#e9effd;stroke:#2f5bd3}</style></head><body>
<h1>How percent works (v${n})</h1>
<h2 id="s1">Step 1 · rounding</h2>
<svg width="420" height="140"><g data-node="round"><rect x="10" y="10" width="200" height="80" rx="8"></rect><text x="30" y="55">Math.round</text></g></svg>${extra}
<p id="probe">probing</p><img id="px" src="/api/review-room" alt="">
<script>(async()=>{const o=[];try{localStorage.setItem('walk-lang','zh');o.push('storage:'+localStorage.getItem('walk-lang'))}catch(e){o.push('storage:throws')}
try{void parent.document.title;o.push('parent:read')}catch(e){o.push('parent:blocked')}
try{await fetch('/api/review-room');o.push('fetch:ok')}catch(e){o.push('fetch:blocked')}
try{await fetch('http://127.0.0.1:${port}/api/instance');o.push('abs:ok')}catch(e){o.push('abs:blocked')}
try{o.push('cookie:'+(document.cookie?'some':'none'))}catch(e){o.push('cookie:throws')}
o.push('origin:'+self.origin);document.getElementById('probe').textContent=o.join(' ')})();</script></body></html>`;
const probePort = await freePort(), probeHits = [];
const files = { 1: { "index.html": page(1) }, 2: { "index.html": page(2, '<p data-node="half">Halves round up: 2.5 becomes 3.</p>') }, 3: { "clip.mp4": Buffer.from("not really a video") },
  // a page that tries to carry what it holds out by navigating its own frame elsewhere (neither its CSP nor its sandbox stops that)
  4: { "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>leak</title></head><body><h1>private diff text</h1><script>setTimeout(()=>{location='http://127.0.0.1:${probePort}/nav?d='+encodeURIComponent(document.body.textContent)},150)</script></body></html>` } };
const versions = [];
for (const [n, fs] of Object.entries(files)) { mkdirSync(join(xdir, `v${n}`), { recursive: true }); const list = [];
  for (const [p, c] of Object.entries(fs)) { writeFileSync(join(xdir, `v${n}`, p), c); list.push({ path: p, bytes: Buffer.byteLength(c), sha256: sha(c) }); }
  const entry = Object.keys(fs)[0]; versions.push({ n: Number(n), run: Number(n), skill: n === "3" ? { id: "explainer-video", v: 1, name: "explainer-video" } : { id: "walkthrough", v: 1, name: "walkthrough" }, at: `2026-11-01T10:0${n}:00Z`, entry, kind: entry.endsWith(".mp4") ? "video" : "html", files: list, summary: n === "1" ? "One page: percent, step by step" : n === "2" ? "added a note on halves" : "A short video", from: n === "2" ? 1 : null }); }
writeFileSync(join(xdir, "state.json"), JSON.stringify({ schema: 1, selected: { id: "walkthrough", v: 1 }, runs: [], versions }));
// the captain's skill, made up: imported into the library through Studio's own route
const skillDir = join(tmp, "walkthrough"); mkdirSync(skillDir);
writeFileSync(join(skillDir, "SKILL.md"), "---\nname: walkthrough\ndescription: An interactive one-page walkthrough of a change.\n---\n# Walkthrough\n\nWrite index.html.\n");

const { createServer } = await import("node:http");
const probe = createServer((q, res) => { probeHits.push(q.url); res.end("got it"); }); await new Promise((r) => probe.listen(probePort, "127.0.0.1", r));
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_REVIEW_EXPLAIN_DEFAULT_SKILL: "", CREW_TAILNET_NAME: TAILNET, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = process.env.ROOM_SHOTS || join(root, "tests/out/review-room-explain"); mkdirSync(shots, { recursive: true });
const ROOM = { card: { id: ID, run: "R-050", node: "review", title: { en: "Pull request #7: Add percent", "zh-TW": "Pull request #7：Add percent" }, status: "open" }, task: { id: "R-050", title: "Add percent" }, pr: { id: "7", url: `https://github.com/${REPO}/pull/7` }, summary: null,
  subject: { kind: "pr", room: ID, url: `https://github.com/${REPO}/pull/7`, repository: REPO, number: 7 }, head: H, base: B, open: true, running: null,
  diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }], total: { files: 1, added: 4, removed: 0 }, from: "git" },
  offer: { provider: "claude", model: "claude-opus-5", effort: null, paid: true, independence: { level: "vendor", en: "Different vendor from the author.", zh: "和作者不同供應商。" }, hash: "feedc0ffee123456" },
  actions: [{ id: "teach", en: "Teach me", zh: "教我" }], board: [], turns: [{ n: 1, action: "ask", text: "What does it do?", lang: "en", status: "done", provider: "claude", model: "claude-opus-5", answer: "x", claims: [{ text: "It adds a percent function.", kind: "claim", basis: "inference", cites: [] }] }], sources: [], check: { questions: [] }, tutors: [], prState: { state: "open", draft: false, approved: false, checkedAt: "2026-11-01T10:00:00Z", headRepo: REPO, verdicts: [] } };
const OFFER = { kind: "generate", skill: { id: "walkthrough", v: 1, name: "walkthrough" }, provider: "claude", model: "claude-opus-5", effort: null, independence: { level: "vendor", en: "Different vendor from the author.", zh: "和作者不同供應商。" }, paid: true, hash: "c0ffee0000000001", limitMin: 120,
  rounds: { en: "No round cap: the skill keeps going until it is satisfied, you stop it, or the safety limit passes.", zh: "不限輪數" }, materials: { en: ["the diff", "the commits", "reviews and comments"], zh: ["diff", "commit", "review 與留言"] }, expected: null,
  isolation: { en: "The output is shown in an isolated frame: it cannot read Studio or see any token, and cannot fetch or navigate out.", zh: "產出放在隔離框裡顯示" },
  cost: { spent: 0.42, runs: 1, estimate: null }, billing: { en: "Billed to the claude account Studio runs claude with on this Mac (your own sign-in or key).", zh: "由這台 Mac 上 Studio 使用的 claude 帳號付費" },
  scripts: { run: true, count: 3, interpreters: ["python3 3.12.4"], network: true, browser: false, credentials: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"], keys: ["ANTHROPIC_API_KEY"], endpoints: ["ANTHROPIC_BASE_URL"], missing: ["ffmpeg"], approved: false,
    limits: { cpuS: 300, fileMB: 60, wallS: 600, calls: 60 },
    rows: { network: { en: "Through Studio's proxy, public hosts only (never this Mac or its network); every host is logged", zh: "經過 Studio 的代理，只能連公開主機" }, access: { en: "Writes only the output folder and its temp folder", zh: "只寫產出資料夾" },
      limits: { en: "300 s of CPU · files up to 60 MB · 10 min · 60 calls per round", zh: "CPU 300 秒 · 檔案 60 MB · 10 分鐘 · 每輪 60 次" }, browser: { en: "None installed (Playwright's headless shell): steps that need one fail", zh: "沒有安裝" },
      missing: { en: "ffmpeg", zh: "ffmpeg" }, approval: { en: "This version has no decision yet: choose below whether its scripts run (Studio first installs its dependencies from its lockfiles) or it stays text only; the decision holds for this version, Studio-wide.", zh: "這個版本還沒決定：請在下面選要跑它的 script（Studio 會先照它的 lockfile 安裝依賴），還是只當文字；這個決定對這個版本全 Studio 有效。" } },
    en: "The skill's 3 scripts run when it calls them, each in Studio's sandbox, with python3 3.12.4. With network: through Studio's proxy, to public hosts only.", zh: "這個 skill 的 3 個腳本會在它呼叫時執行，每次都在 Studio 的沙盒裡，可以連網。" } };
const ASK_OFFER = { ...OFFER, kind: "ask", hash: "c0ffee0000000002" };
/** a script call's line as the server sends it (src/domain/review-explain.ts ScriptLine) */
const SL = (x) => ({ args: "", limit: null, limits: { cpuS: 300, fileMB: 60, wallS: 600, diskMB: 120 }, exit: null, signal: null, ms: 0, hosts: [], refused: [], refusal: null, stderr: "", ...x });
const run = (n, kind, status, extra = {}) => ({ n, kind, skill: { id: "walkthrough", v: 1, name: "walkthrough", sha256: "x" }, status, by: "captain", at: new Date(Date.now() - 4 * 60_000).toISOString(), ended: status === "running" ? null : new Date().toISOString(), provider: "claude", model: "claude-opus-5", effort: null, confirm: "c", limitMin: 120, rounds: [{ n: 1, job: "J1" }], cost: { usd: 0.42 }, error: null, progress: [], from: null, version: null, ...extra });

/** the version menu on the output's line: opened when it is not, then a version picked from it */
const openVersions = async (pg) => { if (!(await pg.$("[data-explain-vermenu]"))) { await pg.click("[data-explain-versions]"); await pg.waitForSelector("[data-explain-vermenu]"); } };
const pickVersion = async (pg, n) => { await openVersions(pg); await pg.click(`[data-explain-version="${n}"]`); };
/** Generate again: the stage's own button while nothing is made yet, else the one in the version menu */
const again = async (pg) => { if (!(await pg.$("[data-explain-empty] [data-explain-again]"))) await openVersions(pg); await pg.click("[data-explain-again]"); };
const versionsLoaded = (pg, n) => pg.waitForFunction((k) => document.querySelector("[data-explain-versions] .rx-vercount")?.textContent === String(k), n, { timeout: 15000 });

try {
  // ---------- baton by default: opening the room starts its generation for this head by itself (no confirmation), once; Try again ----------
  { const ca = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ca.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
    await ca.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const baton = { id: "baton", v: 1, name: "baton", sha256: "x" }, due = { on: true, skill: "baton", head: H, due: true, tried: null };
    let A = { skills: [{ id: "baton", name: "baton", description: "Hand a change on as one page.", v: 1, source: "builtin", own: false }], log: [], settings: { limitMin: 120, defaultSkill: "baton", autoRun: true }, busy: false,
      selected: { id: "baton", v: 1 }, tutor: false, auto: due, versions: [], running: null, consent: null, runs: [] };
    const autos = [], confirms = [];
    await ca.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await ca.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
    await ca.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: A }));
    await ca.route(new RegExp(`/api/review-room/${ID}/explain/(offer|generate)`), (r) => { confirms.push(r.request().url()); r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required" } }); });
    await ca.route(new RegExp(`/api/review-room/${ID}/explain/auto$`), (r) => { const b = JSON.parse(r.request().postData() || "{}"); autos.push(b);
      const failed = run(autos.length, "generate", "failed", { skill: baton, opened: true, head: H, why: "provider", error: "The CLI reported an error. Reason: the vendor is down", rounds: [{ n: 1, job: "J1" }] });
      A = { ...A, auto: { ...due, due: false, why: "done", tried: { head: H, skill: "baton", at: new Date().toISOString(), run: autos.length } }, runs: [...A.runs.slice(0, autos.length - 1), failed] };
      r.fulfill({ json: A }); });
    const w = await ca.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-retry]", { timeout: 15000 }); await w.waitForTimeout(300);
    const st = await w.evaluate(() => ({ ended: document.querySelector("[data-explain-ended]")?.dataset.explainEnded, text: document.querySelector("[data-explain-empty]")?.textContent || "", modal: !!document.querySelector(".rx-modal") }));
    ok(autos.length === 1 && autos[0].retry === undefined && !confirms.length && !st.modal, "opening a room explained with baton starts its generation by itself: one POST …/explain/auto, no paid confirmation", JSON.stringify({ autos, confirms, st }));
    ok(st.ended === "provider" && /vendor is down/.test(st.text) && /Try again/.test(st.text), "it failed: the stage says why and offers Try again; nothing retries by itself", JSON.stringify(st));
    await w.reload(); await w.waitForSelector("[data-explain-retry]", { timeout: 15000 }); await w.waitForTimeout(600);
    ok(autos.length === 1, "reopening the room (Studio says this head is done) starts nothing more", JSON.stringify(autos));
    await w.click("[data-explain-retry]"); await w.waitForTimeout(600);
    ok(autos.length === 2 && autos[1].retry === true && !confirms.length, "Try again asks Studio to start it once more, still without a paid confirmation", JSON.stringify(autos));
    await ca.close(); }
  // ---------- a room from before: its whiteboard is not drawn; the page says so and offers the room's record as a file ----------
  { const co = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await co.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); });
    await co.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const html = versions.filter((v) => v.kind === "html" && v.n !== 4);
    await co.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: { ...ROOM, oldBoard: { turns: 2, items: 1 } } }));
    await co.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: { skills: [], log: [], settings: { limitMin: 120 }, busy: false, selected: { id: "walkthrough", v: 1 }, versions: html, running: null, consent: null, runs: [run(1, "generate", "done", { version: 1 })] } }));
    const w = await co.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-old-board]", { timeout: 15000 }); await w.waitForSelector("[data-explain-frame]", { timeout: 15000 });
    const nb = await w.evaluate(() => { const n = document.querySelector("[data-old-board]"), a = n.querySelector("[data-old-board-download]"); return { n: n.dataset.oldBoard, text: n.textContent, href: a.getAttribute("href"), dl: a.getAttribute("download"), board: !!document.querySelector("[data-board], .rb-view, [data-playbar]"), h: Math.round(n.getBoundingClientRect().height) }; });
    ok(nb.n === "2" && /This room has 2 whiteboard turns from before/.test(nb.text) && /no longer shows the board/.test(nb.text) && nb.href === `/api/review-room/${ID}/export` && nb.dl === `${ID}.json` && !nb.board && nb.h <= 80,
      "a room with an old whiteboard: one line says how many turns it had, that the board is gone (nothing deleted), and offers its JSON; no board is drawn", JSON.stringify(nb));
    const dl = await Promise.all([w.waitForEvent("download"), w.click("[data-old-board-download]")]).then(([d]) => d);
    const body = JSON.parse(await (await import("node:fs/promises")).readFile(await dl.path(), "utf8"));
    ok(dl.suggestedFilename() === `${ID}.json` && body.room === ID && body.record?.card === ID && Array.isArray(body.record.turns), "Download gives the room's record as Studio keeps it, as a file", JSON.stringify({ name: dl.suggestedFilename(), keys: Object.keys(body), rec: Object.keys(body.record || {}).slice(0, 6) }));
    await w.screenshot({ path: join(shots, "0-old-board.png") });
    // the real export route: read only, with Studio's session, as a file never cached; an unknown room is a 404, a write is refused
    const ex = await w.evaluate(async (id) => { const r = await fetch(`/api/review-room/${id}/export`), no = await fetch("/api/review-room/PR-000000000000-9/export"), post = await fetch(`/api/review-room/${id}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { s: r.status, type: r.headers.get("content-type"), cd: r.headers.get("content-disposition"), cache: r.headers.get("cache-control"), no: no.status, post: post.status }; }, ID);
    const bare = await fetch(`${base}/api/review-room/${ID}/export`), bareRoom = await fetch(`${base}/api/review-room/${ID}`);
    ok(ex.s === 200 && /application\/json/.test(ex.type) && ex.cd === `attachment; filename="${ID}.json"` && ex.cache === "no-store" && ex.no === 404 && ex.post >= 400 && bare.status === bareRoom.status,
      "the export route: the room's JSON as a file, never cached; no such room is a 404; a POST is refused; outside Studio's page it is read as the room itself is", JSON.stringify({ ex, bare: bare.status, room: bareRoom.status }));
    // a paired phone (Studio's own pairing, over the tailnet name): it reads the room, never its whole record as a file
    { const { request } = await import("node:http"), host = TAILNET;
      const raw = (method, path, o = {}) => new Promise((resolve) => { const payload = method === "GET" ? undefined : JSON.stringify(o.body ?? {});
        const headers = { host: o.host ?? `127.0.0.1:${port}`, ...(o.token ? { authorization: `Bearer ${o.token}` } : { "x-crew-session": process.env.CREW_SESSION_TOKEN }), ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) };
        const q = request({ host: "127.0.0.1", port, method, path, headers }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode ?? 0, body: j, cd: res.headers["content-disposition"] ?? null }); }); });
        q.on("error", () => resolve({ status: 0, body: null })); if (payload) q.write(payload); q.end(); });
      const code = (await raw("POST", "/api/remote/pair/start")).body?.code, ptok = (await raw("POST", "/api/remote/pair", { host, body: { code, name: "Pixel" } })).body?.token;
      const view = await raw("GET", `/api/review-room/${ID}`, { host, token: ptok }), ex2 = await raw("GET", `/api/review-room/${ID}/export`, { host, token: ptok });
      ok(!!ptok && view.status === 200 && ex2.status === 403 && ex2.body?.code === "desktopOnly" && !ex2.cd, "a paired phone reads the room but its whole record is refused: 403 desktopOnly, no file", JSON.stringify({ ptok: !!ptok, view: view.status, ex: ex2.status, code: ex2.body?.code }));
      await w.evaluate(() => { window.__tok = window.crewRemote.token; window.crewRemote.token = () => "phone"; render(); }); await w.waitForSelector("[data-old-board-desktop]");
      const ph = await w.evaluate(() => ({ dl: !!document.querySelector("[data-old-board-download]"), note: document.querySelector("[data-old-board]")?.textContent || "" }));
      ok(!ph.dl && /downloads on the Mac running Studio/.test(ph.note), "on a paired phone the notice stays and says where the file downloads; no download link", JSON.stringify(ph));
      await w.evaluate(() => { window.crewRemote.token = window.__tok; render(); }); }
    await co.close(); }

  // ---------- the page could not reach Studio to start it: never a "Starting…" that nothing ends ----------
  { const cb = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await cb.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
    await cb.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const A = { skills: [], log: [], settings: { limitMin: 120, defaultSkill: "baton", autoRun: true }, busy: false, selected: { id: "baton", v: 1 }, tutor: false, auto: { on: true, skill: "baton", head: H, due: true, tried: null }, versions: [], running: null, consent: null, runs: [] };
    const autos = [];
    await cb.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await cb.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
    await cb.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: A }));
    await cb.route(new RegExp(`/api/review-room/${ID}/explain/auto$`), (r) => { autos.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 500, json: { error: "Studio is restarting" } }); });
    const w = await cb.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-retry]", { timeout: 15000 }); await w.waitForTimeout(300);
    const st = await w.evaluate(() => ({ starting: !!document.querySelector("[data-explain-starting]"), text: document.querySelector("[data-explain-empty]")?.textContent || "" }));
    ok(autos.length === 1 && !st.starting && /restarting/.test(st.text), "a start that did not reach Studio shows why with Try again, not a Starting… that never ends", JSON.stringify({ autos, st }));
    await w.click("[data-explain-retry]"); await w.waitForTimeout(600);
    ok(autos.length === 2 && autos[1].retry === undefined, "Try again sends the opening's start again (Studio never saw the first)", JSON.stringify(autos));
    await cb.close(); }

  // ---------- the output's line: no column left of the output; the board / output switch and the version menu, by mouse and keys ----------
  { const c9 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c9.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
    await c9.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const html = versions.filter((v) => v.kind === "html" && v.n !== 4);
    let W = { skills: [], log: [], settings: { limitMin: 120 }, busy: false, selected: { id: "walkthrough", v: 1 }, versions: html, running: null, consent: null, runs: [run(1, "generate", "done", { version: 1 })] }; const sel = [];
    await c9.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await c9.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
    await c9.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: W }));
    await c9.route(new RegExp(`/api/review-room/${ID}/explain/select$`), (r) => { const b = JSON.parse(r.request().postData() || "{}"); sel.push(b.skill); W = { ...W, selected: b.skill ? { id: b.skill, v: 1 } : null }; r.fulfill({ json: W }); });
    const w = await c9.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector('[data-explain-frame="2"]', { timeout: 15000 }); await w.waitForTimeout(200);
    const geo = await w.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(), body = r(".rx-body"), stage = r(".rx-body > .rx-stage"), chat = r(".rx-body > .rx-chat"), slot = r(".rx-slot");
      const left = [...document.querySelector(".rx-body").children].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right <= stage.left + 1 && e.getBoundingClientRect().width > 0).map((e) => e.className);
      return { left, stageGap: Math.round(stage.left - body.left), stageW: Math.round(stage.width), free: Math.round(chat.left - body.left), slotW: Math.round(slot.width), line: Math.round(r("[data-x-line]")?.height ?? 999) }; });
    ok(!geo.left.length && geo.stageGap <= 2 && geo.stageW >= geo.free - 2 && geo.slotW >= geo.stageW - 2 && geo.line <= 44,
      "1440: nothing sits left of the output (no rail): the output takes the whole width beside the chat, its line one row high", JSON.stringify(geo));
    // one line: the version menu, Generate again, full screen, a tab of its own, the isolation tag; no board, no Board | Output switch
    const line = await w.evaluate(() => { const l = document.querySelector("[data-x-line]"), top = (s) => l.querySelector(s)?.getBoundingClientRect().top;
      return { sw: !!document.querySelector("[data-explain-switch]"), board: !!document.querySelector("[data-board]"), btn: document.querySelector("[data-explain-versions]")?.textContent, exp: document.querySelector("[data-explain-versions]")?.getAttribute("aria-expanded"),
        tools: ["[data-explain-versions]", "[data-explain-regen]", "[data-explain-full]", "[data-explain-newtab]", "[data-explain-isolation]"].map(top), h: Math.round(l.getBoundingClientRect().height), under: !!document.querySelector(".rx-tools") }; });
    ok(!line.sw && !line.board && !line.under && /walkthrough v2/.test(line.btn) && line.exp === "false" && line.tools.every((t) => t != null && Math.abs(t - line.tools[0]) < 12) && line.h <= 44,
      "one line over the output: the version menu, Generate again, Full screen, New tab and the isolation tag, one row high; no Board | Output switch, no board, no row of tools below", JSON.stringify(line));
    // the version menu by keyboard: Enter opens it on the shown version, ↓ moves, Enter shows that one and gives the focus back
    await w.focus("[data-explain-versions]"); await w.keyboard.press("Enter"); await w.waitForSelector("[data-explain-vermenu]"); await w.waitForTimeout(80);
    ok(await w.evaluate(() => document.activeElement?.dataset.explainVersion === "2" && document.activeElement.getAttribute("aria-current") === "true" && document.querySelector("[data-explain-versions]").getAttribute("aria-expanded") === "true"), "Enter opens the menu with the focus on the shown version (aria-current)", await w.evaluate(() => document.activeElement?.outerHTML.slice(0, 90)));
    const mb = await w.evaluate(() => { const m = document.querySelector("[data-explain-vermenu]").getBoundingClientRect(), at = document.elementFromPoint(m.left + 20, m.top + 40); return { over: !!at?.closest("[data-explain-vermenu]"), inView: m.right <= innerWidth && m.bottom <= innerHeight, m: [m.left, m.top, m.right, m.bottom], iw: innerWidth, ih: innerHeight }; });
    ok(mb.over && mb.inView, "the menu draws over the output's frame, inside the window", JSON.stringify(mb));
    await w.keyboard.press("ArrowDown"); ok(await w.evaluate(() => document.activeElement?.dataset.explainVersion === "1"), "↓ moves to the next version");
    await w.keyboard.press("Enter"); await w.waitForSelector('[data-explain-frame="1"]'); await w.waitForTimeout(100);
    ok(!(await w.$("[data-explain-vermenu]")) && /walkthrough v1/.test(await w.$eval("[data-explain-versions]", (e) => e.textContent)) && (await w.evaluate(() => document.activeElement?.hasAttribute("data-explain-versions"))), "Enter shows that version, closes the menu and gives the focus back to its button");
    await w.keyboard.press("Enter"); await w.waitForFunction(() => !!document.activeElement?.closest("[data-explain-vermenu]")); await w.keyboard.press("Escape"); await w.waitForTimeout(80);
    ok(!(await w.$("[data-explain-vermenu]")) && (await w.evaluate(() => document.activeElement?.hasAttribute("data-explain-versions"))), "Esc closes the menu, the focus back on its button");
    await w.click("[data-explain-versions]"); await w.waitForSelector("[data-explain-vermenu]"); await w.mouse.click(700, 600); await w.waitForTimeout(80);
    ok(!(await w.$("[data-explain-vermenu]")) && (await w.$eval("[data-explain-versions]", (e) => e.getAttribute("aria-expanded"))) === "false", "a click elsewhere (over the output's frame too) closes the menu");
    await w.focus("[data-explain-versions]"); await w.keyboard.press("Enter"); await w.waitForFunction(() => !!document.activeElement?.closest("[data-explain-vermenu]")); await w.keyboard.press("End"); await w.keyboard.press("Tab"); await w.waitForTimeout(80);
    ok(!(await w.$("[data-explain-vermenu]")) && (await w.evaluate(() => document.activeElement && document.activeElement !== document.body)), "Tab out of the menu closes it; the focus goes on, never lost", await w.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
    // a run in progress polls the room every 2.5 s and redraws the line: the open menu keeps the focus where it was
    W = { ...W, running: 9, runs: [...W.runs, run(9, "ask", "running")] }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForTimeout(300);
    await w.focus("[data-explain-versions]"); await w.keyboard.press("Enter"); await w.waitForFunction(() => !!document.activeElement?.closest("[data-explain-vermenu]"));
    const was = await w.evaluate(() => document.activeElement?.dataset.explainVersion);
    await w.waitForTimeout(3200);
    const polled = await w.evaluate(() => ({ v: document.activeElement?.dataset.explainVersion, inMenu: !!document.activeElement?.closest("[data-explain-vermenu]"), exp: document.querySelector("[data-explain-versions]")?.getAttribute("aria-expanded") }));
    await w.keyboard.press("ArrowDown"); const moved = await w.evaluate(() => !!document.activeElement?.closest("[data-explain-vermenu]") && document.activeElement.dataset.explainVersion);
    ok(polled.inMenu && polled.v === was && polled.exp === "true" && moved && moved !== was, "during a run, a poll that redraws the open menu keeps the focus on the same version; ↓ still moves in the menu", JSON.stringify({ was, polled, moved }));
    await w.keyboard.press("Escape"); W = { ...W, running: null, runs: W.runs.slice(0, -1) }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForTimeout(300);
    await w.screenshot({ path: join(shots, "15-line-1440.png") });
    // a phone's width: the line stays usable, nothing scrolls sideways, the menu fits the screen
    await w.setViewportSize({ width: 390, height: 844 }); await w.waitForTimeout(200);
    await w.click("[data-explain-versions]"); await w.waitForSelector("[data-explain-vermenu]"); await w.waitForTimeout(80);
    const ph = await w.evaluate(() => { const b = (s) => document.querySelector(s).getBoundingClientRect(), m = b("[data-explain-vermenu]"), vb = b("[data-explain-versions]"), fu = b("[data-explain-full]"), sl = b(".rx-slot");
      return { over: document.documentElement.scrollWidth > innerWidth + 1, menu: m.left >= 0 && m.right <= innerWidth, vb: vb.width > 60 && vb.right <= innerWidth, full: fu.right <= innerWidth, slot: Math.round(sl.height), ih: innerHeight }; });
    ok(!ph.over && ph.menu && ph.vb && ph.full && ph.slot >= ph.ih * 0.6, "390: the line and the version menu fit the screen, the output takes most of it; no sideways scroll", JSON.stringify(ph));
    await w.screenshot({ path: join(shots, "15-line-390.png") });
    await c9.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("keep-lang")) localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
    // no speech in this test (the room's voice controls read the voices; headless Chromium has none)
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.SpeechRecognition = class { static async available() { return "unavailable"; } start() {} stop() {} }; window.Audio = function (src) { return { src, play: async () => {}, pause() {} }; }; });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  // the room itself and the paid runs are the test's; the explainer's view too (so its runs can be staged), with the real versions
  let X = { selected: null, skills: [], versions: [], runs: [], running: null, consent: null, log: [], settings: { limitMin: 120 }, busy: false };
  const posts = [];
  await ctx.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
  await ctx.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
  await ctx.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: X }));
  await ctx.route(new RegExp(`/api/review-room/${ID}/explain/offer(\\?|$)`), (r) => { const kind = r.request().method() === "POST" ? JSON.parse(r.request().postData() || "{}").kind : new URL(r.request().url()).searchParams.get("kind"); r.fulfill({ json: kind === "ask" ? ASK_OFFER : OFFER }); });
  const answer = (r, body, status = 200) => { posts.push([new URL(r.request().url()).pathname.split("/").pop(), JSON.parse(r.request().postData() || "{}")]); r.fulfill({ status, json: body }); };
  let onGenerate = null, onAsk = null, onStop = null, onSelect = null;
  await ctx.route(new RegExp(`/api/review-room/${ID}/explain/(generate|ask|stop|select)$`), (r) => { const op = new URL(r.request().url()).pathname.split("/").pop(); const f = { generate: onGenerate, ask: onAsk, stop: onStop, select: onSelect }[op]; return f ? f(r) : answer(r, X); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  // frames' requests: the output page must reach nothing
  // what the output page asked for and really got: a request the browser refused under the page's CSP never completes
  const frameReqs = [], frameBlocked = []; const fromFrame = (q) => { try { const f = q.frame(); return f && f !== p.mainFrame() && !/\/rrx\//.test(q.url()); } catch { return false; } };
  p.on("requestfinished", (q) => { if (fromFrame(q)) frameReqs.push(q.url()); }); p.on("requestfailed", (q) => { if (fromFrame(q)) frameBlocked.push(`${q.url()} ${q.failure()?.errorText}`); });
  await p.goto(`${base}/#/board`); await p.waitForFunction(() => typeof S !== "undefined");
  const imp = await p.evaluate(async (dir) => { const r = await fetch("/api/skills/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "folder", path: dir }) }); return [r.status, await r.text()]; }, skillDir);
  ok(imp[0] === 200, "fixture: the made-up skill is imported into the library", JSON.stringify(imp).slice(0, 300));
  const lib = await p.evaluate(async () => (await (await fetch("/api/skills")).json()).skills.map((s) => ({ id: s.id, name: s.name, description: s.description, v: s.current })));
  const own = await p.evaluate(async () => (await (await fetch("/api/skills")).json()).skills.filter((s) => s.sourceKind !== "builtin").map((s) => s.id));
  X.skills = lib.map((s) => ({ ...s, own: own.includes(s.id) })).sort((a, b) => Number(!a.own) - Number(!b.own));

  // ---------- the picker: the tutor by default; the skill from the library; picking it asks for the paid run ----------
  await p.goto(`${base}/#/room/${ID}`); await p.waitForSelector("[data-explain-picker]", { timeout: 15000 });
  ok(await p.$eval("[data-explain-picker]", (e) => e.dataset.explainPicker === "none" && /Explain with\s*Pick a skill/.test(e.textContent)) && !(await p.$("[data-board]")) && !!(await p.$("[data-explain-noskill]")), "no skill for the room: the header's picker says so, and the stage asks for one; there is no board");
  const place = await p.evaluate(() => { const pk = document.querySelector("[data-explain-picker]"), head = document.querySelector(".rr-head"), fm = document.querySelector("[data-room-firstmate]");
    return { inPills: !!pk.closest(".rr-pills"), inHead: head.contains(pk), beforeFirstmate: !!(pk.compareDocumentPosition(fm) & Node.DOCUMENT_POSITION_FOLLOWING), visible: pk.getBoundingClientRect().width > 80, tutorPill: !!document.querySelector(".rr-pills [data-tutor-open]") }; });
  ok(!place.inPills && place.inHead && place.beforeFirstmate && place.visible, "the picker sits at the header's right end, out of the clipped pills", JSON.stringify(place));
  const pageCsp = await p.evaluate(async () => (await fetch("/")).headers.get("content-security-policy"));
  ok(/frame-src 'self'/.test(pageCsp || ""), "Studio's page frames only its own addresses (frame-src 'self')", pageCsp);
  await p.focus("[data-explain-open]"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-explain-menu]"); await p.waitForTimeout(80);
  ok(await p.evaluate(() => document.activeElement?.closest("[data-explain-menu]") && document.activeElement.dataset.explainSkill === "studio-baton"), "the menu takes the focus (on the built-in baton, first)", await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  for (let i = 0; i < 6; i++) await p.keyboard.press("Tab");
  ok(await p.evaluate(() => !!document.activeElement?.closest("[data-explain-menu]")), "Tab stays in the menu");
  const menu = await p.$$eval("[data-explain-menu] > [data-explain-skill]", (es) => es.map((e) => [e.dataset.explainSkill, e.textContent]));
  const more = await p.$eval("[data-explain-more]", (d) => ({ open: d.open, n: d.querySelectorAll("[data-explain-skill]").length, all: [...d.querySelectorAll("[data-explain-skill]")].every((e) => /Studio's library/.test(e.textContent)) }));
  ok(menu.length === 2 && menu[0][0] === "studio-baton" && /baton \(built in\)/.test(menu[0][1]) && / · built in/.test(menu[0][1]) && menu[1][0] === "walkthrough" && /your skill/.test(menu[1][1]) && !/new run/.test(menu[1][1]) && more.open === false && more.n > 3 && more.all,
    "the menu: the built-in baton first, the captain's own skill; the rest of Studio's library folded under More; no tutor, no board", JSON.stringify({ menu, more }));
  await p.keyboard.press("Escape"); await p.waitForTimeout(80);
  ok(!(await p.$("[data-explain-menu]")) && (await p.evaluate(() => document.activeElement?.hasAttribute("data-explain-open"))), "Esc closes the menu and gives the focus back to the picker");
  await p.click("[data-explain-open]"); await p.waitForSelector("[data-explain-menu]");
  await p.screenshot({ path: join(shots, "1-picker.png") });
  await p.click('[data-explain-skill="walkthrough"]'); await p.waitForSelector("[data-explain-start]:not([disabled])");
  const conf = await p.$eval("[data-explain-confirm]", (e) => e.textContent);
  ok(/claude · claude-opus-5/.test(conf) && /the diff, the commits, reviews and comments/.test(conf) && /No round cap/.test(conf) && /not known yet/.test(conf) && /isolated frame/.test(conf) && (await p.$eval("[data-explain-limit]", (e) => e.value)) === "120", "the confirmation names the model, the materials, rounds, expected time, the safety limit and the isolation", conf);
  ok((await p.$eval("[data-explain-scripts]", (e) => e.getAttribute("data-explain-scripts"))) === "run" && /Run, sandboxed, with network · python3 3\.12\.4/.test(conf), "the confirmation says the skill's scripts run, sandboxed, with network, and names the interpreter", conf);
  const srows = await p.$$eval("[data-explain-srow]", (es) => Object.fromEntries(es.map((e) => [e.dataset.explainSrow, { text: e.textContent, chips: [...e.querySelectorAll(".rx-chipname")].map((c) => c.textContent), weight: getComputedStyle(e).fontWeight, small: e.closest(".faint") !== null }])));
  ok(JSON.stringify(srows.credentials?.chips) === '["ANTHROPIC_API_KEY"]' && JSON.stringify(srows.endpoints?.chips) === '["ANTHROPIC_BASE_URL"]' && /public hosts only/.test(srows.network?.text) && /300 s of CPU/.test(srows.limits?.text) && /None installed/.test(srows.browser?.text) && srows.missing?.text === "ffmpeg" && !!srows.access,
    "the scripts are rows of their own: network, credentials and endpoints as chips by name, files, limits, browser, missing", JSON.stringify(srows));
  ok(Object.values(srows).every((r) => Number(r.weight) < 600 && !r.small), "the rows are at normal weight, not one small faint paragraph", JSON.stringify(Object.values(srows).map((r) => [r.weight, r.small])));
  const warn = await p.$eval("[data-explain-confirm] [data-explain-unapproved]", (e) => ({ text: e.textContent, cls: e.className, color: getComputedStyle(e).borderLeftColor }));
  ok(/no decision yet/.test(warn.text) && /rx-warn/.test(warn.cls), "an undecided version is a warning line of its own", JSON.stringify(warn));
  ok(/Output frame/.test(conf) && !/Isolation/.test(conf), "the output frame's row is named for the frame (no clash with the scripts' network)", conf);
  ok(/Billed to the claude account/.test(conf) && /this room so far \$0\.420 over 1 run/.test(conf) && /no estimate yet/.test(conf) && /applies to every room/.test(conf), "it says who pays, what this room cost so far, and that the limit applies to every room", conf);
  ok(await p.waitForFunction(() => document.activeElement?.hasAttribute("data-explain-start"), null, { timeout: 2000 }).then(() => true, () => false), "the confirmation takes the focus on Confirm and start");
  await p.screenshot({ path: join(shots, "2-confirm.png") });
  onGenerate = (r) => { X = { ...X, selected: { id: "walkthrough", v: 1 }, running: 1, runs: [run(1, "generate", "running", { progress: [{ at: "t", text: "reading the diff and the commits" },
    { at: "t", text: "build.py — exit 0 · 0.1 s", script: SL({ script: "scripts/build.py", args: "spec.json", outcome: "ok", exit: 0, ms: 120 }) },
    { at: "t", text: "fetch.py — exit 0", script: SL({ script: "scripts/fetch.py", args: "--url https://api.model-vendor.example/v1", outcome: "ok", exit: 0, ms: 3400, hosts: ["api.model-vendor.example"], refused: [{ host: "169.254.169.254", why: "a metadata address" }] }) },
    { at: "t", text: "check.py — exit 3", script: SL({ script: "scripts/check.py", args: "index.html", outcome: "fail", exit: 3, ms: 90, stderr: "Traceback: missing <h1>" }) },
    { at: "t", text: "spin.py — CPU", script: SL({ script: "scripts/spin.py", outcome: "limit", limit: "cpu", signal: "SIGXCPU", ms: 300200 }) },
    { at: "t", text: "passwd — refused", script: SL({ script: "../../etc/passwd", outcome: "refused", refusalCode: "not-script", refusal: "../../etc/passwd is not a script of walkthrough@v1 (scripts: scripts/build.py, scripts/check.py)" }) },
    { at: "t", text: "wait.sh — time", script: SL({ script: "scripts/wait.sh", outcome: "limit", limit: "time", ms: 5100, limits: { cpuS: 300, fileMB: 60, wallS: 5, diskMB: 120 } }) },
    { at: "t", text: "drawing the rounding figure" }] })], log: [{ ts: "2026-11-01T10:01:00Z", kind: "tool", text: "mat_read {\"path\":\"diff.txt\"}" }] }; answer(r, X); };
  await p.click("[data-explain-start]"); await p.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
  ok(posts.at(-1)[0] === "generate" && posts.at(-1)[1].skill === "walkthrough" && posts.at(-1)[1].confirm === OFFER.hash, "Confirm and start sends the skill and the exact confirmation", JSON.stringify(posts.at(-1)));
  const prog = await p.$eval("[data-explain-progress]", (e) => e.textContent);
  const steps = await p.$$eval("[data-explain-steps] > li", (es) => es.map((e) => e.className));
  ok(/walkthrough is making the explanation/.test(prog) && /drawing the rounding figure/.test(prog) && /Studio tells you when it is done/.test(prog) && /of the 120 min safety limit/.test(prog) && /walkthrough · generating…/.test(await p.$eval("[data-explain-versions]", (e) => e.textContent)) && !!(await p.$('[data-explain-progress] [role="progressbar"]')) && steps.join(",") === "done,now,todo,todo",
    "the run shows live progress: done, current and upcoming steps, a bar of the time used, in the stage and on the version menu's button", prog);
  const callRows = () => p.$$eval("[data-explain-progress] li.rx-callrow", (es) => es.map((e) => ({ mark: e.querySelector(".d").textContent, cls: e.className, sum: e.querySelector("summary").textContent })));
  let cr = await callRows();
  ok(cr.length === 6 && cr[5].mark === "⚠" && /wait\.sh — hit the time limit \(5 s\)/.test(cr[5].sum), "a time limit names the call's own wall clock (its timeout_s), not the configured one", JSON.stringify(cr[5]));
  ok(/^\.\.\/\.\.\/etc\/passwd — refused: not a script of this skill$/.test(cr[4].sum) && /Studio said: .*\(scripts: scripts\/build\.py, scripts\/check\.py\)/.test(await p.$eval('[data-explain-call="refused"] .rx-calldetail', (e) => e.textContent)),
    "a refused call shows the path as written and a short reason; Studio's full message is in its detail", JSON.stringify(cr[4]));
  const geo = await p.$$eval("[data-explain-progress] li.rx-callrow", (es) => es.map((e) => { const d = e.querySelector(".d").getBoundingClientRect(), s = e.querySelector("summary").getBoundingClientRect(); return Math.abs(d.top - s.top) < 12; }));
  const affordance = await p.$eval("[data-explain-progress] .rx-call summary", (e) => getComputedStyle(e, "::before").content);
  ok(geo.every(Boolean) && /▸/.test(affordance), "each line's marker sits on the line it marks, and an expandable line shows ▸", JSON.stringify({ geo, affordance }));
  ok(cr.length >= 5 && cr[0].mark === "✓" && /^build\.py — done · 0\.1 s$/.test(cr[0].sum) && cr[1].mark === "⚠" && /reached api\.model-vendor\.example/.test(cr[1].sum) && /refused 169\.254\.169\.254/.test(cr[1].sum)
    && cr[2].mark === "✗" && /check\.py — failed, exit 3/.test(cr[2].sum) && cr[3].mark === "⚠" && /spin\.py — hit the CPU limit \(300 s\)/.test(cr[3].sum) && cr[4].mark === "✗" && /passwd — refused: .*not a script/.test(cr[4].sum),
    "each script call is a line with its outcome: ✓ done, ⚠ a limit or a refused host, ✗ failed or refused; the result first", JSON.stringify(cr));
  await p.click('[data-explain-call="fail"] summary');
  ok(/stderr:\nTraceback: missing <h1>/.test(await p.$eval('[data-explain-call="fail"] .rx-calldetail', (e) => e.textContent)) && /refused 169\.254\.169\.254 \(a metadata address\)/.test(await p.$$eval("[data-explain-progress] .rx-call", (es) => es.find((e) => /fetch\.py/.test(e.querySelector("summary").textContent))?.querySelector(".rx-calldetail").textContent ?? "")),
    "a line opens to its stderr tail and every host it reached or was refused");
  await p.click("[data-explain-log]"); ok(/mat_read/.test(await p.$eval("[data-explain-logtext]", (e) => e.textContent)), "the skill's live log opens");
  await p.screenshot({ path: join(shots, "3-progress.png") });
  // the same lines in Traditional Chinese (built by the page from the call, not the server's English text)
  await p.evaluate(() => { sessionStorage.setItem("keep-lang", "1"); localStorage.setItem("crew.lang", "zh-TW"); }); await p.reload(); await p.waitForSelector("[data-explain-progress] [data-explain-call]");
  cr = await callRows();
  ok(/build\.py — 完成/.test(cr[0].sum) && /碰到 CPU 上限（300 秒）/.test(cr[3].sum) && /被拒：不是這個 skill 的腳本/.test(cr[4].sum) && /碰到時間上限（5 秒）/.test(cr[5].sum) && /連到 api\.model-vendor\.example/.test(cr[1].sum), "the lines are in the captain's language", JSON.stringify(cr));
  await p.screenshot({ path: join(shots, "3b-progress-zh.png") });
  await p.evaluate(() => { sessionStorage.removeItem("keep-lang"); localStorage.setItem("crew.lang", "en"); }); await p.reload(); await p.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
  onStop = (r) => { X = { ...X, running: null, runs: [run(1, "generate", "stopped", { stop: "stopped by the captain", why: "captain" })] }; answer(r, X); };
  await p.click("[data-explain-stop]"); await p.waitForSelector("[data-explain-empty]");
  const stopped = await p.$eval("[data-explain-empty]", (e) => ({ text: e.textContent, warn: !!e.querySelector('.rx-state.warn[data-explain-ended="captain"] .rx-ic'), again: document.querySelectorAll("[data-explain-again]").length }));
  ok(posts.at(-1)[0] === "stop" && /walkthrough stopped/.test(stopped.text) && /You stopped it\./.test(stopped.text) && !/stopped by the captain/.test(stopped.text) && stopped.warn && stopped.again === 1, "Stop stops it; the stage says so once, as a warning with its icon, with one Try again", JSON.stringify(stopped));
  ok(await p.$eval('[data-explain-run="1"]', (e) => e.classList.contains("warn") && !e.classList.contains("sys")), "the chat's line for it is a warning too, not grey centred text");
  // generate again: this time it finishes (the next read of the room's explainer has v1)
  onGenerate = (r) => { X = { ...X, running: 2, runs: [...X.runs, run(2, "generate", "running")] }; answer(r, X); setTimeout(() => { X = { ...X, running: null, runs: [X.runs[0], run(2, "generate", "done", { version: 1 })], versions: versions.slice(0, 1) }; }, 300); };
  onGenerate = (r) => { X = { ...X, running: 2, runs: [...X.runs, run(2, "generate", "running")] }; answer(r, X); };
  await p.click("[data-explain-again]"); await p.waitForSelector("[data-explain-start]:not([disabled])"); await p.click("[data-explain-start]");
  await p.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
  const qbox = await p.$eval("[data-explain-q]", (e) => ({ disabled: e.disabled, ph: e.placeholder, send: document.querySelector("[data-explain-send]").textContent }));
  ok(!qbox.disabled && /sent once the output is ready/.test(qbox.ph) && /Ask when ready/.test(qbox.send), "while the first output is made the captain can already ask", JSON.stringify(qbox));
  await p.fill("[data-explain-q]", "What is the gist?"); await p.click("[data-explain-send]"); await p.waitForSelector("[data-explain-queued]");
  ok(!posts.some(([op, b]) => op === "ask" && b.question === "What is the gist?"), "the question waits (nothing paid is asked before there is an output)");
  onAsk = (r) => answer(r, { error: "confirm", code: "confirm_required", offer: ASK_OFFER }, 409);
  X = { ...X, running: null, runs: [X.runs[0], run(2, "generate", "done", { version: 1 })], versions: versions.slice(0, 1) };
  await p.waitForSelector('[data-explain-frame="1"]', { timeout: 10000 }); await p.waitForSelector("[data-explain-askconfirm]", { timeout: 5000 });
  ok(posts.at(-1)[0] === "ask" && posts.at(-1)[1].question === "What is the gist?" && posts.at(-1)[1].version === 1, "once the output is there, the waiting question is asked", JSON.stringify(posts.at(-1)));
  await p.waitForTimeout(80);
  ok(await p.evaluate(() => document.activeElement?.hasAttribute("data-explain-askok")), "the follow-up's confirmation takes the focus");
  await p.click('[data-explain-askconfirm] button:not([data-explain-askok])');
  const live = await p.$eval("[data-explain-q]", (e) => ({ disabled: e.disabled, ph: e.placeholder, send: document.querySelector("[data-explain-send]").disabled }));
  ok(!live.disabled && /Ask about this explanation/.test(live.ph) && !live.send, "the run ended while watching: the ask box and Ask come alive without a reload", JSON.stringify(live));
  const fr = await p.$eval('[data-explain-frame="1"]', (e) => ({ sandbox: e.getAttribute("sandbox"), src: e.getAttribute("src") || "" }));
  ok(fr.sandbox === "allow-scripts" && /^\/rrx\/\d+\.[0-9a-f]{32}\//.test(fr.src), "v1 is shown in a frame with sandbox=allow-scripts only, by a capability URL", JSON.stringify(fr));
  const frame = p.frames().find((f) => /\/rrx\//.test(f.url()));
  await frame.waitForFunction(() => document.getElementById("probe")?.textContent !== "probing", null, { timeout: 10000 });
  const probe = await frame.$eval("#probe", (e) => e.textContent);
  ok(/storage:zh/.test(probe), "the page's localStorage works (Studio's in-memory shim in the opaque origin)", probe);
  ok(/parent:blocked/.test(probe) && /cookie:throws/.test(probe) && /origin:null/.test(probe), "the page cannot read Studio's page nor its cookies: an opaque origin", probe);
  ok(/fetch:blocked/.test(probe) && /abs:blocked/.test(probe), "the page cannot fetch, not even Studio's own address (connect-src 'none')", probe);
  const resp = await p.evaluate(async (u) => { const r = await fetch(u); return { csp: r.headers.get("content-security-policy"), nosniff: r.headers.get("x-content-type-options") }; }, fr.src);
  ok(/^sandbox allow-scripts; default-src 'none'/.test(resp.csp) && /connect-src 'none'/.test(resp.csp) && /img-src data: blob:/.test(resp.csp) && !/allow-same-origin/.test(resp.csp) && resp.nosniff === "nosniff", "the real Studio serves the page with the output CSP", JSON.stringify(resp));
  ok(!frameReqs.length, "nothing the page asked for (a fetch, an image from Studio) was ever answered: only its own document loaded", `${frameReqs.join(",")} | blocked: ${frameBlocked.join(",")}`);
  ok(await frame.$eval("#px", (e) => !e.complete || e.naturalWidth === 0), "an image from Studio's address does not load in it");
  await p.screenshot({ path: join(shots, "4-output.png") });

  // ---------- a question: the room's tutor answers in the chat, about the page shown; the page never changes ----------
  { const tools = await p.evaluate(() => ({ box: !!document.querySelector("[data-explain-box]"), pause: !!document.querySelector("[data-explain-pause]"), scope: document.querySelector("[data-x-scope]")?.textContent || "", who: document.querySelector("[data-x-askrow]")?.textContent || "" }));
    ok(!tools.box && !tools.pause && /About: the page shown \(v1\)/.test(tools.scope) && /answered by the room's tutor · claude · claude-opus-5/.test(tools.who), "no region to box: a question is about the page shown, and the chat says who answers it", JSON.stringify(tools)); }
  onAsk = (r) => { const b = JSON.parse(r.request().postData() || "{}"); if (!b.confirm) return answer(r, { error: "confirm", code: "confirm_required", offer: ASK_OFFER }, 409);
    X = { ...X, running: 3, runs: [...X.runs, run(3, "ask", "running", { question: b.question, from: b.version, progress: [{ at: "t", text: "reading the page and the diff" }] })] }; answer(r, X);
    setTimeout(() => { X = { ...X, running: null, consent: { plan: ASK_OFFER.hash }, runs: [...X.runs.slice(0, -1), run(3, "ask", "done", { question: b.question, from: b.version, version: null, answer: 'Rounding happens once, at the end. <img src=x onerror="window.__pwned=1">\n\n- **first** point\n- `second` point\n\n| Input | Result |\n|---|---|\n| 1999 | 300 |', cites: ["src/percent.ts:L3", "page:Step 1 · rounding"] })] }; }, 900); };
  await p.fill("[data-explain-q]", "Why round here?"); await p.click("[data-explain-send]");
  await p.waitForSelector("[data-explain-askconfirm]");
  const first = posts.at(-1)[1];
  ok(posts.at(-1)[0] === "ask" && first.question === "Why round here?" && first.version === 1 && first.selection === undefined && !first.confirm, "the question goes with the version shown, and nothing else (no region)", JSON.stringify(first));
  const askc = await p.$eval("[data-explain-askconfirm]", (e) => ({ text: e.textContent, scripts: !!e.querySelector("[data-explain-askscripts]"), consent: e.querySelector("label").textContent }));
  ok(/The room's tutor answers this question: a paid run on claude · claude-opus-5/.test(askc.text) && /never changes the page/.test(askc.text) && !askc.scripts && /questions here on this tutor/.test(askc.consent),
    "the question's confirmation, in the chat: the room's tutor, paid, never changing the page; no script", JSON.stringify(askc));
  await p.check("[data-explain-consent]"); await p.click("[data-explain-askok]");
  await p.waitForSelector('[data-explain-answer="3"][data-status="running"]', { timeout: 5000 });
  const busy = await p.evaluate(() => ({ send: document.querySelector("[data-explain-send]").disabled, why: document.querySelector("[data-x-askrow]").textContent }));
  ok(busy.send && /Wait for the answer/.test(busy.why), "while the tutor answers, Ask waits and says why", JSON.stringify(busy));
  await p.waitForSelector('[data-explain-answer="3"][data-status="done"]', { timeout: 10000 });
  ok(posts.at(-1)[1].confirm === ASK_OFFER.hash && posts.at(-1)[1].consent === true, "confirmed with “don't ask again”: the same question goes with the confirmation and the consent", JSON.stringify(posts.at(-1)[1]));
  const ans = await p.$eval('[data-explain-answer="3"]', (e) => ({ text: e.textContent, cites: [...e.querySelectorAll("[data-explain-cite]")].map((c) => c.textContent), upd: !!e.querySelector("[data-explain-updated]"), img: !!e.querySelector("img"),
    li: [...e.querySelectorAll("[data-explain-md] li")].map((x) => x.innerHTML), cells: [...e.querySelectorAll("[data-explain-md] table th, [data-explain-md] table td")].map((x) => x.textContent) }));
  ok(JSON.stringify(ans.li) === JSON.stringify(["<b>first</b> point", "<code>second</code> point"]) && ans.cells.join("|") === "Input|Result|1999|300", "the answer's Markdown reads as a list and a table, built from text (bold and code as elements, nothing else)", JSON.stringify(ans));
  ok(ans.cites.join("|") === "src/percent.ts:L3|page:Step 1 · rounding" && !ans.upd && /onerror/.test(ans.text) && !ans.img && !(await p.evaluate(() => window.__pwned)), "the answer shows its citations; the page is not changed; the model's text stays text", JSON.stringify(ans));
  ok((await p.$eval('[data-explain-q-run="3"] [data-explain-about]', (e) => e.textContent)) === "about v1" && (await p.$$eval("[data-explain-version]", (es) => es.length).catch(() => 0)) === 0 && !!(await p.$('[data-explain-frame="1"]')),
    "the question says which version it was about; still one version, still shown");
  await p.screenshot({ path: join(shots, "6-answer.png") });
  // every version in the menu; switching keeps the conversation, and the next question is about the version now shown
  X = { ...X, versions: versions.filter((v) => v.kind === "html" && v.n !== 4) }; await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await versionsLoaded(p, 2);
  await pickVersion(p, 2); await p.waitForSelector('[data-explain-frame="2"]');
  ok(!!(await p.$('[data-explain-answer="3"][data-status="done"]')) && /About: the page shown \(v2\)/.test(await p.$eval("[data-x-scope]", (e) => e.textContent)), "switching to v2 keeps the conversation; the next question is about v2");
  onAsk = (r) => answer(r, X);
  await p.fill("[data-explain-q]", "And on v2?"); await p.click("[data-explain-send]"); await p.waitForTimeout(300);
  ok(posts.at(-1)[0] === "ask" && posts.at(-1)[1].version === 2 && !posts.at(-1)[1].confirm, "agreed once, the next question goes about v2 without a confirmation", JSON.stringify(posts.at(-1)[1]));
  onAsk = (r) => answer(r, { error: "A turn is already running in this room / 這個審查室已有一回合在進行", code: "busy" }, 409);
  await p.fill("[data-explain-q]", "Again?"); await p.click("[data-explain-send]"); await p.waitForSelector("[data-explain-error]");
  const er = await p.$eval("[data-explain-error]", (e) => ({ text: e.textContent, err: e.classList.contains("err") }));
  ok(er.err && /A turn is already running in this room/.test(er.text) && !/這個審查室/.test(er.text), "a refusal shows in the captain's language only, as an error", JSON.stringify(er));
  // ---------- the question shows at once, before /ask answers (it waits for admission); refused, it stays; no duplicate ----------
  const mine = (t) => p.$$eval("[data-x-msgs] .rx-m.me", (es, t) => es.filter((e) => e.textContent.includes(t)).map((e) => ({ run: e.dataset.explainQRun ?? null, pend: e.dataset.explainPending ?? null, text: e.textContent })), t);
  const refused = await p.$eval('[data-explain-pending="refused"]', (e) => e.textContent).catch(() => null);
  ok(/Again\?/.test(refused || "") && /about v2/.test(refused || "") && !!(await p.$("[data-explain-error] [data-explain-retry]")), "a refused question stays in the chat with the version it was about, why, and Retry", String(refused));
  await p.click("[data-explain-pendx]", { timeout: 2000 }).catch(() => p.fill("[data-explain-q]", "Again?")); await p.waitForTimeout(60);
  ok((await p.$eval("[data-explain-q]", (e) => e.value)) === "Again?" && !(await p.$("[data-explain-pending]")) && !!refused, "set aside, a refused question goes back into the ask box (nothing is lost)");
  const slow = (ms, then) => (r) => { posts.push(["ask", JSON.parse(r.request().postData() || "{}")]); setTimeout(() => then(r), ms); };
  onAsk = slow(1500, (r) => r.fulfill({ status: 409, json: { error: "A turn is already running in this room / 這個審查室已有一回合在進行", code: "busy" } }));
  await p.fill("[data-explain-q]", "What moves here?"); const t0 = Date.now(); await p.click("[data-explain-send]");
  const shown = await p.waitForSelector('[data-explain-pending="sending"]', { timeout: 500 }).then(() => Date.now() - t0, () => null);
  const view = await p.$eval("[data-explain-pending]", (e) => { const b = e.getBoundingClientRect(), m = e.closest(".rx-msgs").getBoundingClientRect(); return { text: e.textContent, busy: e.getAttribute("aria-busy"), inView: b.top >= Math.max(0, m.top) - 1 && b.bottom <= Math.min(innerHeight, m.bottom) + 1 && b.height > 0, box: document.querySelector("[data-explain-q]").value }; });
  ok(shown != null && shown < 500 && /What moves here\?/.test(view?.text) && /about v2/.test(view.text) && /Sending…/.test(view.text) && view.busy === "true" && view.inView && view.box === "",
    "pressing Ask puts the question (and the version it is about) in the chat at once, marked Sending…, in view, before /ask answers", JSON.stringify({ shown, view }));
  ok(await p.waitForFunction(() => /Starting…/.test(document.querySelector('[data-explain-pending="starting"]')?.textContent || ""), null, { timeout: 1000 }).then(() => true, () => false), "while /ask waits for admission, the question reads Starting…");
  await p.waitForSelector('[data-explain-pending="refused"]', { timeout: 3000 }).catch(() => {});
  const late = await mine("What moves here?"), lateWhy = await p.$eval("[data-explain-error]", (e) => e.textContent).catch(() => "");
  ok(late.length === 1 && late[0].pend === "refused" && /A turn is already running in this room/.test(lateWhy) && /Retry/.test(lateWhy), "refused after a slow start, the question stays with the reason and Retry", JSON.stringify({ late, lateWhy }));
  // Retry: the run is pushed (the server tells the page) before /ask itself answers; the question is in the chat once
  onAsk = slow(2000, (r) => r.fulfill({ json: X }));
  await p.click("[data-explain-retry]", { timeout: 2000 }).catch(() => p.click("[data-explain-send]")); await p.waitForSelector('[data-explain-pending="sending"]', { timeout: 500 }).catch(() => {});
  const rb = posts.at(-1)[1];
  ok(rb.question === "What moves here?" && rb.version === 2, "Retry asks the same question about the same version", JSON.stringify(rb));
  X = { ...X, running: 4, runs: [...X.runs, run(4, "ask", "running", { question: rb.question, from: 2 })] };
  await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector('[data-explain-q-run="4"]', { timeout: 3000 });
  const pushed = await mine("What moves here?");
  ok(pushed.length === 1 && pushed[0].run === "4" && /about v2/.test(pushed[0].text), "the push brings the real run: it takes the pending question's place, no duplicate", JSON.stringify(pushed));
  await p.waitForTimeout(2300);
  const after = await mine("What moves here?");
  ok(after.length === 1 && after[0].run === "4" && !(await p.$("[data-explain-pending]")), "when /ask answers after the push, still one entry", JSON.stringify(after));
  X = { ...X, running: null, runs: [...X.runs.slice(0, -1), run(4, "ask", "done", { question: rb.question, from: 2, answer: "The bar moves." })] };
  await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector('[data-explain-answer="4"][data-status="done"]', { timeout: 5000 });
  // Retry waits while the page is made; after another version is shown, it asks about that one
  onAsk = (r) => answer(r, { error: "A turn is already running in this room / 這個審查室已有一回合在進行", code: "busy" }, 409);
  await p.fill("[data-explain-q]", "Which part is this?"); await p.click("[data-explain-send]"); await p.waitForSelector("[data-explain-retry]", { timeout: 3000 });
  X = { ...X, running: 5, runs: [...X.runs, run(5, "generate", "running")] }; await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector("[data-explain-genstrip]", { timeout: 5000 }).catch(() => {});
  const rbusy = await p.$eval("[data-explain-error] [data-explain-retry]", (e) => ({ disabled: e.disabled, title: e.title })).catch(() => null);
  ok(rbusy?.disabled === true && /Wait for the skill/.test(rbusy.title) && (await mine("Which part is this?")).length === 1, "while the page is made, Retry is off and says why (the refused question stays, once)", JSON.stringify(rbusy));
  X = { ...X, running: null, runs: X.runs.slice(0, -1) }; await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector("[data-explain-error] [data-explain-retry]:not([disabled])", { timeout: 5000 }).catch(() => {});
  await pickVersion(p, 1); await p.waitForSelector('[data-explain-frame="1"]', { timeout: 5000 });
  onAsk = (r) => answer(r, X); const nposts = posts.length;
  await p.click("[data-explain-error] [data-explain-retry]", { timeout: 2000 }).catch(() => {}); await p.waitForFunction(() => !document.querySelector("[data-explain-pending]"), null, { timeout: 3000 }).catch(() => {});
  const rv = posts.slice(nposts).find(([op]) => op === "ask")?.[1];
  ok(rv?.question === "Which part is this?" && rv.version === 1, "Retry after another version is shown asks about that version", JSON.stringify(rv));
  X = { ...X, versions }; await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await versionsLoaded(p, 4);

  // ---------- a page that tries to navigate itself out of Studio ----------
  onSelect = (r) => { const b = JSON.parse(r.request().postData() || "{}"); X = { ...X, selected: b.skill ? { id: b.skill, v: 1 } : null }; answer(r, X); };
  await pickVersion(p, 4); await p.waitForSelector('[data-explain-frame="4"]'); await p.waitForTimeout(2000);
  ok(!probeHits.length, "the output cannot carry anything out by navigating its frame: Studio's page refuses frames outside Studio", probeHits.join(","));

  // ---------- a run that ends while the captain is elsewhere: Studio says so ----------
  X = { ...X, running: 9, runs: [...X.runs, run(9, "generate", "running", { head: H })] }; await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector("[data-explain-genstrip]");
  // a new version being made while one is shown: the shown one stays, with one strip above it (who runs it and pays, Stop)
  { const g = await p.evaluate(() => ({ frame: !!document.querySelector("[data-explain-frame]") && !document.querySelector("[data-x-layer]").hidden, card: !!document.querySelector("[data-explain-progress]"),
      strip: document.querySelector("[data-explain-genstrip]")?.textContent || "", stop: !!document.querySelector("[data-explain-genstrip] [data-explain-stop]") }));
    ok(g.frame && !g.card && /claude · claude-opus-5/.test(g.strip) && /billed to the claude account/.test(g.strip) && /aaaaaaa/.test(g.strip) && g.stop, "a generation over a shown version keeps the version on the stage, the progress one strip above it (model, who pays, head, Stop)", JSON.stringify(g)); }
  await p.evaluate(() => { location.hash = "#/board"; }); await p.waitForFunction(() => S.route?.name === "board");
  X = { ...X, running: null, runs: [...X.runs.slice(0, -1), run(9, "generate", "done", { version: 4 })] };
  await p.evaluate((id) => window.crewRoomExplain.load(id), ID); await p.waitForSelector("[data-explain-toast]", { timeout: 5000 });
  ok(/walkthrough: v4 is ready/.test(await p.$eval("[data-explain-toast]", (e) => e.textContent)) && (await p.$eval("[data-explain-toast] a", (e) => e.getAttribute("href"))) === `#/room/${ID}`, "a run that ends off the room is announced, with a link back");
  ok(await p.$eval("[data-explain-toast] a", (a) => getComputedStyle(a).color === getComputedStyle(a.closest(".toast")).color), "the toast's link reads in the toast's own colour");
  await p.goto(`${base}/#/room/${ID}`); await p.waitForSelector("[data-explain-room]");

  await ctx.close();


  // ---------- zh-TW at 390 on a paired phone: the reason in Chinese; the phone reads only ----------
  { const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c2.addInitScript(() => { try { localStorage.setItem("crew.lang", "zh-TW"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
    await c2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const Z = { ...X, selected: { id: "walkthrough", v: 1 }, versions: [], running: null, runs: [run(1, "generate", "stopped", { stop: "the safety limit of 120 min passed", why: "limit" })] };
    await c2.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await c2.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
    await c2.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: Z }));
    const q = await c2.newPage(); q.on("pageerror", (e) => errors.push(e.message));
    await q.goto(`${base}/#/room/${ID}`); await q.waitForSelector("[data-explain-empty]", { timeout: 15000 });
    const zt = await q.$eval("[data-explain-empty]", (e) => e.textContent);
    ok(/安全時限/.test(zt) && !/safety limit/.test(zt), "zh-TW: why it stopped is said in Chinese (from the server's reason code)", zt);
    // the picker is drawn with the header (state loaded), and hidden by the narrow layout: wait for both, then read it
    await q.waitForSelector("[data-explain-picker]", { state: "attached", timeout: 10000 });
    const pick = await q.waitForFunction(() => { const e = document.querySelector("[data-explain-picker]"); return e && getComputedStyle(e).display === "none" && e.getBoundingClientRect().width === 0; }, null, { timeout: 5000 }).then(() => "none", async () => q.$eval("[data-explain-picker]", (e) => getComputedStyle(e).display));
    ok(pick === "none", "at 390 the picker is not shown (no clipped label)", pick);
    await q.evaluate(() => { window.crewRemote.token = () => "phone"; render(); }); await q.waitForSelector("[data-explain-readonly]");
    ok(!(await q.$("[data-explain-q]")) && !(await q.$("[data-explain-again]")) && /在 Mac 上/.test(await q.$eval("[data-explain-readonly]", (e) => e.textContent)), "a paired phone reads only: no ask box, no Generate, a note says to use the Mac");
    await q.screenshot({ path: join(shots, "7-phone-zh.png") });
    await c2.close(); }

  // ---------- two rooms: a question queued in room B is only ever asked in room B, never in the room drawn last ----------
  { const ID_A = `PR-${sha("sample-org/other-kit").slice(0, 12)}-3`, c4 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c4.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
    await c4.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const ROOM_A = { ...ROOM, card: { ...ROOM.card, id: ID_A, title: { en: "Pull request #3: Other" } }, subject: { ...ROOM.subject, room: ID_A, number: 3 } };
    // room A already agreed to unconfirmed follow-ups: a question sent there by mistake would start a paid run
    let B = { ...X, selected: { id: "walkthrough", v: 1 }, versions: [], consent: null, running: 5, runs: [run(5, "generate", "running")] };
    const A = { ...X, selected: { id: "walkthrough", v: 1 }, versions: versions.slice(0, 1), consent: { plan: ASK_OFFER.hash }, running: null, runs: [run(1, "generate", "done", { version: 1 })] };
    const asks = [];
    await c4.route(new RegExp(`/api/review-room/(${ID}|${ID_A})(\\?open=1)?$`), (r) => r.fulfill({ json: r.request().url().includes(ID_A) ? ROOM_A : ROOM }));
    await c4.route(/\/arrive$/, (r) => r.fulfill({ json: {} }));
    await c4.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: B }));
    await c4.route(new RegExp(`/api/review-room/${ID_A}/explain$`), (r) => r.fulfill({ json: A }));
    await c4.route(new RegExp(`/api/review-room/${ID_A}/explain/cap`), (r) => r.fulfill({ status: 404, json: { error: "no" } }));
    await c4.route(new RegExp(`/api/review-room/(${ID}|${ID_A})/explain/ask$`), (r) => { asks.push([r.request().url().includes(ID_A) ? "A" : "B", JSON.parse(r.request().postData() || "{}")]); r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: ASK_OFFER } }); });
    await c4.route(new RegExp(`/api/review-room/${ID}/explain/select$`), (r) => { const b = JSON.parse(r.request().postData() || "{}"); B = { ...B, selected: b.skill ? { id: b.skill, v: 1 } : null }; r.fulfill({ json: B }); });
    const w = await c4.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-progress]", { timeout: 15000 });
    await w.fill("[data-explain-q]", "Question for B"); await w.click("[data-explain-send]"); await w.waitForSelector("[data-explain-queued]");
    await w.evaluate((a) => { location.hash = `#/room/${a}`; }, ID_A); await w.waitForSelector(`[data-explain-room="${ID_A}"] [data-explain-q]`, { timeout: 15000 });
    B = { ...B, running: null, versions: versions.slice(0, 1), runs: [run(5, "generate", "done", { version: 1 })] };
    await w.evaluate((b) => window.crewRoomExplain.load(b), ID); await w.waitForTimeout(400);
    ok(!asks.length, "room B's run ends while room A is shown: nothing is asked anywhere", JSON.stringify(asks));
    await w.evaluate((b) => { location.hash = `#/room/${b}`; }, ID); await w.waitForSelector("[data-explain-askconfirm]", { timeout: 8000 });
    ok(asks.length === 1 && asks[0][0] === "B" && asks[0][1].question === "Question for B" && !asks[0][1].confirm, "back in room B, it asks its own question, at its own /ask, behind its confirmation", JSON.stringify(asks));
    await c4.close(); }

  // ---------- narrow windows (a phone-sized browser, a split-screen Mac): the chat keeps room, its confirmation is clickable ----------
  for (const width of [390, 900]) {
    const c3 = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 } });
    await c3.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
    await c3.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    let N = { ...X, selected: { id: "walkthrough", v: 1 }, versions: versions.slice(0, 1), running: null, consent: null, runs: [run(1, "generate", "done", { version: 1 })] };
    await c3.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await c3.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
    await c3.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: N }));
    await c3.route(new RegExp(`/api/review-room/${ID}/explain/ask$`), (r) => r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: ASK_OFFER } }));
    await c3.route(new RegExp(`/api/review-room/${ID}/explain/stop$`), (r) => { N = { ...N, running: null, runs: [...N.runs.slice(0, -1), run(2, "generate", "stopped", { why: "captain" })] }; r.fulfill({ json: N }); });
    const w = await c3.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-q]", { timeout: 15000 });
    await w.fill("[data-explain-q]", "Why?"); await w.click("[data-explain-send]"); await w.waitForSelector("[data-explain-askok]");
    // after the scroll, two frames: the output's layer follows its slot on the next frame (the output is taller on a phone)
    const hit = async (sel) => w.$eval(sel, async (e) => { e.scrollIntoView({ block: "center" }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const b = e.getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { h: Math.round(b.height), top: Math.round(b.top), at: at ? at.tagName + "." + at.className + (at.dataset ? JSON.stringify(Object.keys(at.dataset)) : "") : null, ok: !!at && (at === e || e.contains(at)) }; });
    const ok1 = await hit("[data-explain-askok]"), ok2 = await hit("[data-explain-consent]"), list = await w.$eval("[data-x-msgs]", (e) => Math.round(e.getBoundingClientRect().height));
    ok(ok1.ok && ok2.ok && list >= 120, `at ${width} wide the chat's messages have room (${list}px) and its Confirm and ask and consent are clickable`, JSON.stringify({ ok1, ok2, list }));
    await w.click("[data-explain-consent]"); ok(await w.$eval("[data-explain-consent]", (e) => e.checked), `at ${width} wide the consent box takes the click`);
    // scrolled anywhere, the output's layer never draws over the room's header (the title stays visible and clickable)
    const over = [];
    for (const frac of [0, 0.35, 0.7, 1]) {
      await w.$eval(".rx-body", (e, f) => { e.scrollTop = (e.scrollHeight - e.clientHeight) * f; }, frac); await w.waitForTimeout(120);
      over.push(await w.evaluate(() => { const L = document.querySelector("[data-x-layer]"), H = document.querySelector(".rr-head").getBoundingClientRect(), body = document.querySelector(".rx-body").getBoundingClientRect();
        const r = L.getBoundingClientRect(), m = /inset\(([\d.]+)px 0px ([\d.]+)px 0px\)|inset\(([\d.]+)px 0px ([\d.]+)px\)/.exec(L.style.clipPath || ""), ct = m ? Number(m[1] ?? m[3]) : 0, cb = m ? Number(m[2] ?? m[4]) : 0;
        const drawnTop = r.top + ct, drawnBottom = r.bottom - cb, title = document.querySelector(".rr-htitle b") || document.querySelector(".rr-head"), tb = title.getBoundingClientRect();
        const atTitle = document.elementFromPoint(tb.left + Math.min(10, tb.width / 2), tb.top + tb.height / 2);
        return { hidden: L.hidden, drawnTop: Math.round(drawnTop), headBottom: Math.round(H.bottom), bodyTop: Math.round(body.top), titleOk: !!atTitle && document.querySelector(".rr-head").contains(atTitle) && !L.contains(atTitle), drawnBottom: Math.round(drawnBottom) }; }));
    }
    ok(over.every((o) => (o.hidden || o.drawnTop >= o.headBottom - 1 && o.drawnTop >= o.bodyTop - 1 || o.drawnBottom <= o.drawnTop) && o.titleOk), `at ${width} wide, scrolled top to bottom, the output never draws over the header and its title stays clickable`, JSON.stringify(over));
    await w.screenshot({ path: join(shots, `8-narrow-${width}.png`), fullPage: true });
    if (width === 900) {
      // a question queued during a generation that then stops goes back into the ask box
      N = { ...N, versions: [], running: 2, runs: [...N.runs, run(2, "generate", "running")] }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
      await w.fill("[data-explain-q]", "What is the gist?"); await w.click("[data-explain-send]"); await w.waitForSelector("[data-explain-queued]");
      await w.click("[data-explain-progress] [data-explain-stop]"); await w.waitForSelector("[data-explain-empty]"); await w.waitForTimeout(150);
      ok(!(await w.$("[data-explain-queued]")) && (await w.$eval("[data-explain-q]", (e) => e.value)) === "What is the gist?", "a question waiting for a generation that stopped goes back into the ask box, not left waiting");
      // a question waiting for a generation that finishes while the captain is away is asked when they come back
      N = { ...N, running: 3, runs: [...N.runs, run(3, "generate", "running")] }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
      await w.fill("[data-explain-q]", "And the risk?"); await w.click("[data-explain-send]"); await w.waitForSelector("[data-explain-queued]");
      const asked = []; await w.route(new RegExp(`/api/review-room/${ID}/explain/ask$`), (r) => { asked.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: ASK_OFFER } }); });
      await w.evaluate(() => { location.hash = "#/board"; }); await w.waitForFunction(() => S.route?.name === "board");
      N = { ...N, running: null, versions: versions.slice(0, 1), runs: [...N.runs.slice(0, -1), run(3, "generate", "done", { version: 1 })] };
      await w.evaluate((id) => { location.hash = `#/room/${id}`; }, ID); await w.waitForSelector("[data-explain-askconfirm]", { timeout: 8000 });
      ok(asked.length === 1 && asked[0].question === "And the risk?" && !asked[0].confirm, "a question waiting for a run that finished while away is asked on coming back, behind its confirmation", JSON.stringify(asked));
    }
    await c3.close();
  }

  // ---------- "What should it produce?" and full screen: the captain's instructions with a version, and the output filling the screen ----------
  { const P1 = "Include an error-code table and an ops runbook; Traditional Chinese.", LAST = "Draw the data flow first, then a risk table.";
    const withMade = versions.map((v) => (v.n === 1 ? { ...v, prompt: P1 } : v.n === 2 ? { ...v, question: "Why round here?" } : v.n === 4 ? { ...v, prompt: "" } : v));
    const hashOf = (t) => (t ? `c0ffee${sha(t).slice(0, 10)}` : OFFER.hash);
    // the offer is for the text it was asked with (none: the skill's last instructions, the prefill), as the server's is
    const offerReqs = [], gens = [], defs = [], selects = []; let DEF = null, failSelect = false;
    const EX = { en: "For this pull request, include:\n- an architecture diagram", zh: "這個 PR 請包含：\n- 架構圖" };
    const prefill = () => (DEF != null ? { text: DEF, source: "default" } : LAST ? { text: LAST, source: "last" } : { text: "", source: "none" });
    const routes = async (c, Y) => {
      await c.addInitScript(() => { try { if (!sessionStorage.getItem("keep-lang")) localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
      await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await c.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
      await c.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
      await c.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: Y() }));
      // a generation's offer is a POST (the instructions do not fit a URL): for the text sent, else the prefill (default, else last)
      await c.route(new RegExp(`/api/review-room/${ID}/explain/offer$`), (r) => { const b = JSON.parse(r.request().postData() || "{}"), has = typeof b.prompt === "string", pf = prefill(), text = has ? b.prompt : pf.text; offerReqs.push(has ? text : null);
        r.fulfill({ json: b.kind === "ask" ? ASK_OFFER : { ...OFFER, hash: hashOf(text), prompt: { text, max: 2000, last: LAST, default: DEF, source: has ? "given" : pf.source, example: EX } } }); });
      await c.route(/\/api\/review-room\/explain\/prompts$/, (r) => { if (r.request().method() !== "POST") return r.continue(); const b = JSON.parse(r.request().postData() || "{}"); defs.push(b); DEF = b.text || null; r.fulfill({ json: { skill: b.skill, default: DEF } }); });
      await c.route(new RegExp(`/api/review-room/${ID}/explain/generate$`), (r) => { const b = JSON.parse(r.request().postData() || "{}"); gens.push(b);
        r.fulfill(b.confirm === hashOf(b.prompt ?? "") ? { json: { ...Y(), running: 7, runs: [run(7, "generate", "running", { prompt: b.prompt })] } } : { status: 409, json: { error: "confirm / 確認", code: "confirm_required", offer: { ...OFFER, hash: hashOf(b.prompt), prompt: { text: b.prompt, max: 2000, last: LAST } } } }); });
      await c.route(new RegExp(`/api/review-room/${ID}/explain/select$`), (r) => { selects.push(r.request().postData()); return failSelect ? r.fulfill({ status: 400, json: { error: "That skill is not in the library / 技能庫裡沒有這個 skill", code: "bad_skill" } }) : r.fulfill({ json: Y() }); }); };
    let Y = { ...X, selected: { id: "walkthrough", v: 1 }, versions: withMade, running: null, consent: null, runs: [run(1, "generate", "done", { version: 1, prompt: P1 })] };
    const c5 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await routes(c5, () => Y);
    const w = await c5.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await versionsLoaded(w, 4);
    await pickVersion(w, 1); await w.waitForSelector('[data-explain-frame="1"]');
    await openVersions(w);
    const railMade = await w.$$eval("[data-explain-verprompt]", (es) => Object.fromEntries(es.map((e) => [e.dataset.explainVerprompt, e.textContent])));
    ok(/^✎ Include an error-code table/.test(railMade[1]) && /^\? Why round here\?/.test(railMade[2]) && /the skill's default/.test(railMade[4]) && !railMade[3], "the version menu says what each version was made from: the instructions, a follow-up's question, the skill's default", JSON.stringify(railMade));
    await w.keyboard.press("Escape");
    const head = await w.$eval("[data-explain-made]", (e) => ({ kind: e.dataset.explainMade, open: e.open, text: e.querySelector("summary").textContent }));
    ok(head.kind === "prompt" && !head.open && /Made with your instructions: Include an error-code table/.test(head.text), "the version view names the instructions it was made with, folded", JSON.stringify(head));
    await w.click("[data-explain-made] > summary");
    ok((await w.$eval('[data-explain-promptfull="1"]', (e) => e.textContent)) === P1 && !!(await w.$('[data-explain-reuse="1"]')), "opened, it shows the whole text and Generate again with these instructions");
    await w.screenshot({ path: join(shots, "9-version-instructions.png") });
    // generate again: the confirmation starts from this version's instructions, editable; the offer is for exactly that text
    await w.click('[data-explain-reuse="1"]'); await w.waitForSelector("[data-explain-start]:not([disabled])");
    const field = await w.$eval("[data-explain-prompt]", (e) => ({ value: e.value, max: e.maxLength, label: document.querySelector("[data-explain-promptfield] label").textContent, count: document.querySelector("[data-explain-promptcount]").textContent }));
    ok(field.value === P1 && offerReqs.at(-1) === P1 && field.max === 2000 && /What should it produce\?/.test(field.label) && field.count === `${P1.length} / 2000`, "Generate again starts from the version's instructions: in the field, with a visible counter, and in the offer", JSON.stringify({ field, req: offerReqs.at(-1) }));
    const link = await w.$eval("[data-explain-skillslink]", (a) => ({ target: a.target, rel: a.rel }));
    ok(link.target === "_blank" && /noopener/.test(link.rel), "the confirmation's Skills page link opens a tab of its own (the typed text stays)", JSON.stringify(link));
    await w.keyboard.press("Escape"); await w.waitForFunction(() => !document.querySelector(".rx-modal"), null, { timeout: 3000 }); await w.waitForTimeout(150);
    const esc = await w.evaluate(() => ({ reuse: document.activeElement?.matches?.('[data-explain-reuse="1"]'), summary: document.activeElement?.matches?.("[data-explain-made] > summary"), tag: document.activeElement?.tagName }));
    ok((esc.reuse || esc.summary) && esc.tag !== "BODY", "Esc gives the focus back to Generate again (its line stays open), never to the page", JSON.stringify(esc));
    await w.click('[data-explain-reuse="1"]'); await w.waitForSelector("[data-explain-start]:not([disabled])");
    const P2 = "Only an ops runbook, as a checklist.";
    await w.fill("[data-explain-prompt]", P2);
    const waiting = await w.$eval("[data-explain-start]", (e) => e.disabled);
    await w.waitForFunction(() => !document.querySelector("[data-explain-start]").disabled, null, { timeout: 5000 });
    ok(waiting && offerReqs.at(-1) === P2 && (await w.$eval("[data-explain-promptcount]", (e) => e.textContent)) === `${P2.length} / 2000` && (await w.$eval("[data-explain-prompt]", (e) => document.activeElement === e)), "an edit waits for the offer of the new text (Confirm waits; the focus and the text stay)", JSON.stringify(offerReqs.slice(-2)));
    await w.screenshot({ path: join(shots, "10-confirm-instructions.png") });
    // a default for this skill, set from the confirmation: saved as typed, then the field says it is the default
    ok((await w.$eval("[data-explain-promptsource]", (e) => e.dataset.explainPromptsource)) === "edited" && (await w.$eval("[data-explain-promptreset]", (e) => e.hidden)), "an edited text says so; with no default there is nothing to reset to");
    await w.click("[data-explain-promptsave]"); await w.waitForSelector("[data-explain-promptsaved]");
    ok(defs.at(-1)?.skill === "walkthrough" && defs.at(-1).text === P2 && (await w.$eval("[data-explain-promptsource]", (e) => e.dataset.explainPromptsource)) === "default" && (await w.$eval("[data-explain-promptsave]", (e) => e.disabled)),
      "Save as default for this skill: the text is the skill's default, and the field says so", JSON.stringify(defs.at(-1)));
    await w.fill("[data-explain-prompt]", "Something else for once."); await w.waitForFunction(() => !document.querySelector("[data-explain-start]").disabled, null, { timeout: 5000 });
    ok(!(await w.$eval("[data-explain-promptreset]", (e) => e.hidden)) && (await w.$eval("[data-explain-promptsource]", (e) => e.dataset.explainPromptsource)) === "edited", "edited away from the default, Reset to default shows");
    await w.click("[data-explain-promptreset]"); await w.waitForFunction((t) => document.querySelector("[data-explain-prompt]").value === t && !document.querySelector("[data-explain-start]").disabled, P2, { timeout: 5000 });
    ok(offerReqs.at(-1) === P2 && (await w.$eval("[data-explain-promptreset]", (e) => e.hidden)), "Reset to default puts the default back, and the offer is read again for it");
    await w.click("[data-explain-promptexample]"); await w.waitForFunction(() => !document.querySelector("[data-explain-start]").disabled, null, { timeout: 5000 });
    const exv = await w.$eval("[data-explain-prompt]", (e) => e.value);
    ok(exv === `${P2}\n\n${EX.en}` && offerReqs.at(-1) === exv, "Insert a review checklist adds the built-in example below the text (never applied by itself), and the offer follows", JSON.stringify(exv));
    ok(await w.$eval("[data-explain-promptexample]", (e) => e.disabled), "with the checklist in the field, Insert is off (no second copy)");
    await w.click("[data-explain-promptreset]"); await w.waitForFunction((t) => document.querySelector("[data-explain-prompt]").value === t && !document.querySelector("[data-explain-start]").disabled, P2, { timeout: 5000 });
    ok(!(await w.$eval("[data-explain-promptexample]", (e) => e.disabled)), "without it, Insert is on again");
    await w.click("[data-explain-start]"); await w.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
    ok(gens.at(-1)?.prompt === P2 && gens.at(-1).confirm === hashOf(P2) && gens.at(-1).skill === "walkthrough", "Confirm sends the instructions with the confirmation of exactly that text", JSON.stringify(gens.at(-1)));
    // a room with nothing made yet: the field is prefilled with what this skill was last asked for (the server's prefill)
    Y = { ...Y, versions: [], runs: [], running: null }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector("[data-explain-empty] [data-explain-again]");
    await w.click("[data-explain-empty] [data-explain-again]"); await w.waitForSelector("[data-explain-start]:not([disabled])");
    ok(offerReqs.at(-1) === null && (await w.$eval("[data-explain-prompt]", (e) => e.value)) === P2 && (await w.$eval("[data-explain-promptsource]", (e) => e.dataset.explainPromptsource)) === "default", "the first Generate is prefilled with the skill's default, and says so");
    await w.click(".rx-modal .rx-foot .btn:not(.primary)"); DEF = null;
    await w.click("[data-explain-empty] [data-explain-again]"); await w.waitForSelector("[data-explain-start]:not([disabled])");
    ok((await w.$eval("[data-explain-prompt]", (e) => e.value)) === LAST && (await w.$eval("[data-explain-promptsource]", (e) => e.dataset.explainPromptsource)) === "last" && /What you last asked this skill for/.test(await w.$eval("[data-explain-promptfield]", (e) => e.textContent)), "with no default, it falls back to the last instructions, and says so");
    await w.fill("[data-explain-prompt]", "y".repeat(1900)); await w.waitForTimeout(50);
    ok(await w.$eval("[data-explain-promptcount]", (e) => e.classList.contains("over") && e.textContent === "1900 / 2000"), "near the cap the counter warns");
    await w.fill("[data-explain-prompt]", ""); await w.waitForFunction(() => !document.querySelector("[data-explain-start]").disabled, null, { timeout: 5000 });
    await w.click("[data-explain-start]"); await w.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
    ok(gens.at(-1)?.prompt === "" && gens.at(-1).confirm === OFFER.hash, "cleared, the run is the skill's default (an empty prompt, its own confirmation)", JSON.stringify(gens.at(-1)));
    // a confirmation for one text does not start another: Studio asks again with the new offer
    Y = { ...Y, versions: withMade, runs: [run(1, "generate", "done", { version: 1, prompt: P1 })], running: null }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector('[data-explain-frame="4"],[data-explain-frame="1"]');
    await pickVersion(w, 1); await w.waitForSelector('[data-explain-frame="1"]');

    // ---------- full screen: native on the layer (the frame is not reloaded); Esc / ✕ brings the room back where it was ----------
    await w.setViewportSize({ width: 900, height: 700 }); await w.waitForTimeout(150);
    await w.$eval("[data-explain-full]", (e) => e.scrollIntoView({ block: "center" })); await w.waitForTimeout(100);
    const before = await w.evaluate(() => { const f = document.querySelector('[data-explain-frame="1"]'); f.__kept = 1; return { body: document.querySelector(".rx-body").scrollTop, y: scrollY }; });
    await w.click("[data-explain-full]"); await w.waitForFunction(() => !!window.crewRoomExplain.full(), null, { timeout: 5000 }); await w.waitForTimeout(200);
    const fs = await w.evaluate(() => { const L = document.querySelector("[data-x-layer]"), b = L.getBoundingClientRect(), f = L.querySelector('[data-explain-frame="1"]').getBoundingClientRect();
      const bar = L.querySelector("[data-explain-fullbar]").getBoundingClientRect();
      return { mode: window.crewRoomExplain.full(), el: document.fullscreenElement === L, w: Math.round(b.width), h: Math.round(b.height), sw: innerWidth, sh: innerHeight, fw: Math.round(f.width), fh: Math.round(f.height), ftop: Math.round(f.top), barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), barW: Math.round(bar.width), kept: L.querySelector('[data-explain-frame="1"]').__kept === 1, clip: L.style.clipPath, bar: !!L.querySelector("[data-explain-fullclose]"), focus: document.activeElement?.hasAttribute("data-explain-fullclose") }; });
    ok(fs.barTop === 0 && fs.barW === fs.w && fs.ftop >= fs.barBottom && fs.fh === fs.h - fs.barBottom, "the bar has a strip of its own at the top: the output starts below it, so it never covers the page's own controls", JSON.stringify(fs));
    ok(fs.mode === "native" && fs.el && fs.w === fs.sw && fs.h === fs.sh && fs.fw === fs.w && fs.kept && !fs.clip && fs.bar && fs.focus, "Full screen: the output's layer is the screen (the Fullscreen API), its frame fills it and is not reloaded; ✕ has the focus", JSON.stringify(fs));
    await w.screenshot({ path: join(shots, "11-fullscreen.png") });
    await w.click("[data-explain-fullclose]"); await w.waitForFunction(() => !window.crewRoomExplain.full() && !document.fullscreenElement, null, { timeout: 5000 }); await w.waitForTimeout(200);
    const back = await w.evaluate(() => { const L = document.querySelector("[data-x-layer]").getBoundingClientRect(), s = document.querySelector("[data-x-slot]").getBoundingClientRect();
      return { body: document.querySelector(".rx-body").scrollTop, y: scrollY, onSlot: Math.abs(L.top - s.top) < 2 && Math.abs(L.width - s.width) < 2, focus: document.activeElement?.hasAttribute("data-explain-full"), kept: document.querySelector('[data-explain-frame="1"]').__kept === 1 }; });
    ok(back.body === before.body && back.y === before.y && back.onSlot && back.focus && back.kept, "✕ brings the room back at the same scroll position, the output on its stage again, the focus on Full screen", JSON.stringify({ before, back }));
    // the browser's own way out (Esc in real full screen ends it) is followed too
    await w.click("[data-explain-full]"); await w.waitForFunction(() => window.crewRoomExplain.full() === "native" && !!document.fullscreenElement, null, { timeout: 5000 });
    await w.evaluate(() => document.exitFullscreen()); await w.waitForFunction(() => !window.crewRoomExplain.full(), null, { timeout: 5000 });
    ok(!(await w.$("[data-x-layer] [data-explain-fullbar]")), "leaving full screen the browser's way (Esc) ends Studio's full screen too");
    // refused (a browser or a frame policy that does not allow it): a fixed layer over the whole window; Esc closes it
    await w.evaluate(() => { window.__realFs = Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError("Permissions check failed")); }; });
    const before2 = await w.evaluate(() => ({ body: document.querySelector(".rx-body").scrollTop, y: scrollY }));
    await w.focus("[data-explain-newtab]"); await w.keyboard.press("f"); await w.waitForFunction(() => window.crewRoomExplain.full() === "fallback", null, { timeout: 5000 }); await w.waitForTimeout(150);
    const fb = await w.evaluate(() => { const L = document.querySelector("[data-x-layer]"), b = L.getBoundingClientRect(), head = document.querySelector(".rr-head").getBoundingClientRect(), at = document.elementFromPoint(head.left + 20, head.top + head.height / 2);
      return { cls: L.classList.contains("full"), x: b.left, y: b.top, w: Math.round(b.width), h: Math.round(b.height), sw: innerWidth, sh: innerHeight, covers: L.contains(at), fs: !!document.fullscreenElement, bar: getComputedStyle(L.querySelector(".rx-fullbar")).display !== "none",
        below: L.querySelector("iframe").getBoundingClientRect().top >= L.querySelector(".rx-fullbar").getBoundingClientRect().bottom }; });
    ok(fb.cls && !fb.fs && fb.x === 0 && fb.y === 0 && fb.w === fb.sw && fb.h === fb.sh && fb.covers && fb.bar && fb.below, "F on the stage; refused, the output fills the window instead (a fixed layer over the room), with its ✕", JSON.stringify(fb));
    await w.screenshot({ path: join(shots, "12-fullscreen-fallback.png") });
    await w.keyboard.press("Escape"); await w.waitForFunction(() => !window.crewRoomExplain.full(), null, { timeout: 3000 }); await w.waitForTimeout(200);
    const back2 = await w.evaluate(() => { const L = document.querySelector("[data-x-layer]"), r = L.getBoundingClientRect(), s = document.querySelector("[data-x-slot]").getBoundingClientRect(), head = document.querySelector(".rr-head").getBoundingClientRect(), at = document.elementFromPoint(head.left + 20, head.top + head.height / 2);
      return { body: document.querySelector(".rx-body").scrollTop, y: scrollY, cls: L.classList.contains("full"), onSlot: Math.abs(r.top - s.top) < 2, headOk: !L.contains(at) }; });
    ok(back2.body === before2.body && back2.y === before2.y && !back2.cls && back2.onSlot && back2.headOk, "Esc closes it: the same scroll position, the output on its stage, the header clickable again", JSON.stringify({ before2, back2 }));
    await w.evaluate(() => { Element.prototype.requestFullscreen = window.__realFs; });
    // a video: its own player's native full screen
    // a version another skill made (v3, explainer-video) is shown as it is: the room's skill stays the one it generates with
    const sel0 = selects.length, skill0 = await w.evaluate(() => window.crewRoomExplain.state(S.route.arg)?.selected?.id ?? null);
    await pickVersion(w, 3); await w.waitForSelector('[data-explain-video], video', { timeout: 5000 }).catch(() => {}); await w.waitForTimeout(300);
    const skill3 = await w.evaluate(() => window.crewRoomExplain.state(S.route.arg)?.selected?.id ?? null);
    ok(selects.length === sel0 && skill3 === skill0 && !(await w.$("[data-explain-error]")), "showing a version another skill made never changes the room's selected skill (no /select is sent)", JSON.stringify({ sent: selects.slice(sel0), skill0, skill3 }));
    await pickVersion(w, 1); await w.waitForSelector('[data-explain-frame="1"]'); await w.waitForTimeout(150);
    ok(!(await w.$("[data-explain-error]")) && selects.length === sel0, "and back to v1: still nothing sent");
    await pickVersion(w, 3); await w.waitForSelector("[data-explain-video]");
    await w.click("[data-explain-full]"); await w.waitForFunction(() => !!window.crewRoomExplain.full() && !!document.fullscreenElement, null, { timeout: 5000 });
    ok(await w.evaluate(() => document.fullscreenElement?.tagName === "VIDEO" && document.fullscreenElement.hasAttribute("data-explain-video")), "a video goes full screen in its own player", await w.evaluate(() => document.fullscreenElement?.tagName));
    ok(!(await w.$("[data-explain-newtab]")), "a video has no Open in new tab (Studio's own player shows it)");
    await w.evaluate(() => document.exitFullscreen()); await w.waitForFunction(() => !window.crewRoomExplain.full(), null, { timeout: 5000 });

    // ---------- Open in new tab: a fresh capability, Studio's page framing the version exactly as here ----------
    await w.setViewportSize({ width: 1440, height: 900 });
    await pickVersion(w, 1); await w.waitForSelector('[data-explain-frame="1"]');
    const roomSrc = await w.$eval('[data-explain-frame="1"]', (e) => e.getAttribute("src"));
    const [tab] = await Promise.all([c5.waitForEvent("page"), w.click("[data-explain-newtab]")]);
    await tab.waitForLoadState("load");
    const tabUrl = new URL(tab.url()), tabResp = await w.evaluate(async (u) => { const r = await fetch(u); return { csp: r.headers.get("content-security-policy"), body: await r.text() }; }, tabUrl.pathname);
    ok(new RegExp(`^/rrxt/\\d+\\.[0-9a-f]{32}/${ID}/1$`).test(decodeURIComponent(tabUrl.pathname)) && /frame-src 'self'/.test(tabResp.csp) && /default-src 'none'/.test(tabResp.csp) && !/<script/i.test(tabResp.body), "the new tab is Studio's page by a capability, running nothing, framing only Studio", JSON.stringify({ u: tabUrl.pathname, csp: tabResp.csp }));
    const tf = await tab.$eval("iframe", (e) => ({ sandbox: e.getAttribute("sandbox"), src: e.getAttribute("src") }));
    ok(tf.sandbox === "allow-scripts" && /^\/rrx\/\d+\.[0-9a-f]{32}\//.test(tf.src) && tf.src !== roomSrc, "its frame is sandbox=allow-scripts on a fresh /rrx/ capability (not the room's)", JSON.stringify({ tf, roomSrc }));
    const inner = tab.frames().find((f) => /\/rrx\//.test(f.url())); await inner.waitForFunction(() => document.getElementById("probe")?.textContent !== "probing", null, { timeout: 10000 });
    const tprobe = await inner.$eval("#probe", (e) => e.textContent), innerCsp = await w.evaluate(async (u) => (await fetch(u)).headers.get("content-security-policy"), tf.src);
    ok(/origin:null/.test(tprobe) && /parent:blocked/.test(tprobe) && /fetch:blocked/.test(tprobe) && /abs:blocked/.test(tprobe) && /storage:zh/.test(tprobe) && /^sandbox allow-scripts; default-src 'none'/.test(innerCsp) && /connect-src 'none'/.test(innerCsp),
      "in the new tab the page is still an opaque origin with no network, under the same output CSP", JSON.stringify({ tprobe, innerCsp }));
    await tab.setViewportSize({ width: 1440, height: 900 }); await tab.screenshot({ path: join(shots, "13-new-tab.png") }); await tab.close();
    await pickVersion(w, 4); await w.waitForSelector('[data-explain-frame="4"]');
    const hits0 = probeHits.length, [tab4] = await Promise.all([c5.waitForEvent("page"), w.click("[data-explain-newtab]")]); await tab4.waitForLoadState("load"); await tab4.waitForTimeout(2000);
    ok(probeHits.length === hits0, "a page that navigates its frame away carries nothing out of the new tab either", probeHits.join(",")); await tab4.close();
    await c5.close();

    // ---------- the Skills page: a skill's default instructions, kept outside any run (the real Studio's route), one per skill ----------
    { const c7 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c7.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
      const k = await c7.newPage(); k.on("pageerror", (e) => errors.push(e.message));
      await k.goto(`${base}/#/skills`); await k.waitForSelector('[data-skill-defprompt="walkthrough"]', { timeout: 15000 });
      const shown0 = await k.$$eval("[data-skill-defprompt]", (es) => es.map((e) => e.dataset.skillDefprompt));
      ok(shown0.length === 1 && shown0[0] === "walkthrough" && (await k.$eval('[data-skill-defprompt="walkthrough"] [data-skill-defstate]', (e) => e.dataset.skillDefstate)) === "none" && (await k.$eval("[data-skill-defall]", (e) => e.getAttribute("aria-pressed"))) === "false",
        "the Skills page shows the default-instructions editor on the captain's own skill only (none set yet); Studio's built-in ones wait behind a toggle", JSON.stringify(shown0));
      await k.click("[data-skill-defall]"); await k.waitForFunction(() => document.querySelectorAll("[data-skill-defprompt]").length > 2);
      const other = await k.$$eval("[data-skill-defprompt]", (es) => es.map((e) => e.dataset.skillDefprompt).find((x) => x !== "walkthrough"));
      ok(!!other && (await k.$eval("[data-skill-defall]", (e) => e.getAttribute("aria-pressed"))) === "true", "“show for all skills” shows the editor on every library skill", other);
      await k.click('[data-skill-defprompt="walkthrough"] > summary'); await k.click('[data-skill-defexample="walkthrough"]');
      const ex = await k.$eval('[data-skill-deftext="walkthrough"]', (e) => e.value);
      ok(/architecture diagram/.test(ex) && /sequence diagram/.test(ex) && /database lifecycle/.test(ex) && /state machine/.test(ex) && /error codes/.test(ex) && /API request and response/.test(ex) && /technology choices/.test(ex) && /before and after/.test(ex),
        "Insert a review checklist fills in the built-in example (architecture, sequence, database lifecycle, state machine, error codes, API, technology choices, before/after)", ex);
      await k.fill('[data-skill-deftext="walkthrough"]', `${ex}\n- written in Traditional Chinese`); await k.click('[data-skill-defsave="walkthrough"]'); await k.waitForSelector('[data-skill-defnote="walkthrough"]');
      const saved = await k.evaluate(async () => (await (await fetch("/api/review-room/explain/prompts")).json()).skills);
      ok(saved.walkthrough?.default === `${ex}\n- written in Traditional Chinese` && !saved[other]?.default && (await k.$eval('[data-skill-defprompt="walkthrough"] [data-skill-defstate]', (e) => e.dataset.skillDefstate)) === "set" && (await k.$eval(`[data-skill-defprompt="${other}"] [data-skill-defstate]`, (e) => e.dataset.skillDefstate)) === "none",
        "Save default keeps it in Studio's settings for that skill only", JSON.stringify(saved));
      await k.screenshot({ path: join(shots, "15-skills-default.png") });
      await k.reload(); await k.waitForSelector('[data-skill-defprompt="walkthrough"] [data-skill-defstate="set"]', { timeout: 15000 });
      ok(true, "the default is still there after a reload");
      await k.click('[data-skill-defprompt="walkthrough"] > summary'); await k.click('[data-skill-defclear="walkthrough"]'); await k.waitForSelector('[data-skill-defprompt="walkthrough"] [data-skill-defstate="none"]');
      ok(!(await k.evaluate(async () => (await (await fetch("/api/review-room/explain/prompts")).json()).skills.walkthrough?.default)), "Clear takes the default away");
      await c7.close(); }

    // ---------- the look: 1440 / 900 / 390, light and dark, English and 繁體中文 ----------
    const looks = [];
    for (const width of [1440, 900, 390]) for (const scheme of ["light", "dark"]) for (const lang of ["en", "zh-TW"]) {
      const c6 = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 860 }, colorScheme: scheme });
      await c6.addInitScript((l) => { try { sessionStorage.setItem("keep-lang", "1"); localStorage.setItem("crew.lang", l); } catch {} }, lang);
      const Z = { ...X, selected: { id: "walkthrough", v: 1 }, versions: withMade, running: null, consent: null, runs: [run(1, "generate", "done", { version: 1, prompt: P1 })] };
      await routes(c6, () => Z);
      const q = await c6.newPage(); q.on("pageerror", (e) => errors.push(e.message));
      await q.goto(`${base}/#/room/${ID}`); await q.waitForSelector("[data-explain-versions]", { timeout: 15000 }); await pickVersion(q, 1); await q.waitForSelector('[data-explain-frame="1"]');
      await q.click("[data-explain-made] > summary"); await q.waitForTimeout(150);
      const tag = `${width}-${scheme}-${lang}`;
      const m1 = await q.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, full: (() => { const b = document.querySelector("[data-explain-full]"); b?.scrollIntoView({ block: "center" }); const r = b?.getBoundingClientRect(); return !!r && r.width > 0 && r.right <= innerWidth + 1; })(), head: document.querySelector("[data-explain-made] summary")?.textContent || "" }));
      await q.screenshot({ path: join(shots, `14-look-${tag}-version.png`) });
      await q.click('[data-explain-reuse="1"]'); await q.waitForSelector("[data-explain-start]:not([disabled])");
      await q.fill("[data-explain-prompt]", Array.from({ length: 30 }, (_, i) => `- section ${i + 1}: what it shows and why`).join("\n")); await q.waitForFunction(() => !document.querySelector("[data-explain-start]").disabled, null, { timeout: 5000 });
      const m2 = await q.evaluate(() => { const ta = document.querySelector("[data-explain-prompt]").getBoundingClientRect(), md = document.querySelector(".rx-modal"), m = md.getBoundingClientRect(); md.scrollTop = 0;
        const b = document.querySelector("[data-explain-start]").getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { label: document.querySelector("[data-explain-promptfield] label").textContent, inModal: ta.left >= m.left && ta.right <= m.right + 0.5, over: document.documentElement.scrollWidth > innerWidth + 1,
          startInView: b.bottom <= Math.min(innerHeight, m.bottom) + 0.5 && b.top >= m.top && !!at?.closest?.("[data-explain-start]") }; });
      await q.screenshot({ path: join(shots, `14-look-${tag}-confirm.png`) });
      await q.click(".rx-modal .rx-foot .btn:not(.primary)");
      await q.evaluate(() => { Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError("no")); }; }); await q.click("[data-explain-full]"); await q.waitForFunction(() => window.crewRoomExplain.full() === "fallback", null, { timeout: 5000 }); await q.waitForTimeout(150);
      const m3 = await q.evaluate(() => { const b = document.querySelector("[data-explain-fullclose]").getBoundingClientRect(); return { x: b.right <= innerWidth && b.left >= 0, text: document.querySelector("[data-explain-fullclose]").textContent }; });
      await q.screenshot({ path: join(shots, `14-look-${tag}-full.png`) });
      const zhOk = lang === "en" ? /What should it produce\?/.test(m2.label) && /Exit full screen/.test(m3.text) && /Made with your instructions/.test(m1.head) : /要產出什麼？/.test(m2.label) && /離開全螢幕/.test(m3.text) && /依你的指示產生/.test(m1.head);
      looks.push({ tag, ok: !m1.over && m1.full && m2.inModal && !m2.over && m2.startInView && m3.x && zhOk, m1, m2, m3 });
      await c6.close();
    }
    ok(looks.every((l) => l.ok), "at 1440, 900 and 390, light and dark, English and 繁體中文: no sideways scroll, Full screen in reach, the field inside its dialog, Confirm in view with long instructions (the dialog's footer stays), the words in the captain's language", JSON.stringify(looks.filter((l) => !l.ok)));
    // a provider failure shows the CLI's reason, a long one with an unbroken path included, inside its box at phone width
    { const why = `exit 1, no result; stderr: ${"/private/var/folders/".repeat(12)}cli.js:1 | ${"fatal stream error ".repeat(14)}`.slice(0, 400);
      const long = `The Claude CLI reported an error; readiness was invalidated. Reason: ${why} / Claude CLI 回報錯誤；已撤銷就緒狀態。原因：${why}`;
      const c7 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await c7.addInitScript(() => { try { sessionStorage.setItem("keep-lang", "1"); localStorage.setItem("crew.lang", "en"); } catch {} });
      let Z = { ...X, selected: { id: "walkthrough", v: 1 }, versions: [], running: null, consent: null, runs: [run(1, "generate", "failed", { why: "provider", error: long })] };
      await routes(c7, () => Z);
      const q = await c7.newPage(); q.on("pageerror", (e) => errors.push(e.message));
      await q.goto(`${base}/#/room/${ID}`); await q.waitForSelector('[data-explain-ended="provider"]', { timeout: 15000 });
      const f = await q.$eval('[data-explain-ended="provider"]', (e) => { const r = e.getBoundingClientRect(), s = e.querySelector("small"), sr = s?.getBoundingClientRect();
        return { text: e.textContent, inBox: !!sr && sr.right <= r.right + 0.5 && sr.left >= r.left, over: document.documentElement.scrollWidth > innerWidth + 1, boxIn: r.right <= innerWidth + 0.5 }; });
      await q.screenshot({ path: join(shots, "15-provider-reason.png") });
      ok(/The model's provider reported an error\./.test(f.text) && /Reason: exit 1, no result; stderr:/.test(f.text) && !/readiness|CLI reported|原因/.test(f.text) && f.inBox && f.boxIn && !f.over, "a provider failure shows only its reason under the headline (no repeated sentence, no internal words), wrapped inside its box at 390 px", JSON.stringify({ ...f, text: f.text.slice(0, 160) }));
      // a run stopped because its replies kept hitting the model's output limit says so, in both languages
      const cutErr = "The model's reply exceeded the 64000-token output limit; write large files in several smaller writes. / 模型的回覆超過 64000 token 的輸出上限；大檔案請分幾次寫入。";
      Z = { ...Z, runs: [run(1, "generate", "failed", { why: "outputLimit", error: cutErr })] };
      await q.reload(); await q.waitForSelector('[data-explain-ended="outputLimit"]', { timeout: 15000 });
      const en = await q.$eval('[data-explain-ended="outputLimit"]', (e) => e.textContent);
      const c8 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await c8.addInitScript(() => { try { sessionStorage.setItem("keep-lang", "1"); localStorage.setItem("crew.lang", "zh-TW"); } catch {} });
      await routes(c8, () => Z); const qz = await c8.newPage(); qz.on("pageerror", (e) => errors.push(e.message));
      const zhRun = Z; Z = { ...Z, runs: [run(1, "generate", "failed", { why: "provider", error: long })] };
      await qz.goto(`${base}/#/room/${ID}`); await qz.waitForSelector('[data-explain-ended="provider"]', { timeout: 15000 });
      const pz = await qz.$eval('[data-explain-ended="provider"]', (e) => e.textContent); Z = zhRun;
      ok(/模型供應商回報錯誤。/.test(pz) && /原因：exit 1, no result/.test(pz) && !/就緒|Reason:|readiness/.test(pz), "in 繁體中文 the provider failure shows the headline and only 原因：…", pz.slice(0, 200));
      await qz.reload(); await qz.waitForSelector('[data-explain-ended="outputLimit"]', { timeout: 15000 });
      const zh = await qz.$eval('[data-explain-ended="outputLimit"]', (e) => e.textContent); await c8.close();
      ok(/hit its output limit twice in a row/.test(en) && /64000-token output limit/.test(en) && !/rounds in a row ended/.test(en) && /連續兩次碰到輸出上限/.test(zh) && /64000 token 的輸出上限/.test(zh), "a run stopped at the output limit says so, with the cap, in English and 繁體中文", JSON.stringify({ en, zh }));
      await c7.close(); }
  }
  // ---------- an undecided script version: the decision is picked in the confirmation; the run shows its prepare ----------
  { const c7 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await c7.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; });
    await c7.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const FACTS = { id: "walkthrough", v: 1, sha256: "a".repeat(64), filesSha256: "b".repeat(64), scripts: [{ path: "scripts/use-py.py", lang: "python", flags: ["network", "subprocess"] }], hosts: ["api.model-vendor.example"], bins: ["ffmpeg"], locks: ["python (requirements.txt)"] };
    const PENDING = { ...OFFER, hash: "c0ffee00000000a1", decide: { state: "pending", facts: FACTS } };
    let cur = PENDING, D = { ...X, selected: { id: "walkthrough", v: 1 }, versions: [], running: null, consent: null, runs: [] };
    const gens = [], asks = []; let onGen = null;
    await c7.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await c7.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} }));
    await c7.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: D }));
    await c7.route(new RegExp(`/api/review-room/${ID}/explain/offer(\\?|$)`), (r) => r.fulfill({ json: cur }));
    await c7.route(new RegExp(`/api/review-room/${ID}/explain/select$`), (r) => r.fulfill({ json: D }));
    await c7.route(new RegExp(`/api/review-room/${ID}/explain/generate$`), (r) => { const b = JSON.parse(r.request().postData() || "{}"); gens.push(b); onGen(r, b); });
    await c7.route(new RegExp(`/api/review-room/${ID}/explain/ask$`), (r) => { const b = JSON.parse(r.request().postData() || "{}"); asks.push(b);
      r.fulfill(b.confirm ? { json: D } : { status: 409, json: { error: "confirm", code: "confirm_required", offer: { ...ASK_OFFER, decide: { state: "pending", facts: FACTS } } } }); });
    const w = await c7.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    const openConfirm = async () => { await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-again], [data-explain-empty], [data-explain-open]", { timeout: 15000 });
      await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.click("[data-explain-open]"); await w.waitForSelector("[data-explain-menu]"); await w.click('[data-explain-skill="walkthrough"]'); await w.waitForSelector("[data-explain-confirm] [data-explain-start]"); await w.waitForTimeout(60); };
    D = { ...D, selected: null }; await openConfirm();
    const box = await w.$eval("[data-explain-decidebox]", (e) => e.textContent);
    const startOff = await w.$eval("[data-explain-start]", (e) => e.disabled);
    ok(/no decision yet/.test(box) && /scripts\/use-py\.py · network, subprocess/.test(box) && /Network when it runs: api\.model-vendor\.example/.test(box) && /installed by Studio before it runs: python \(requirements\.txt\)/.test(box) && /Programs it uses: ffmpeg/.test(box) && /aaaaaaaaaaaa \/ bbbbbbbbbbbb/.test(box) && /Approve with scripts/.test(box) && /Text only/.test(box) && startOff,
      "an undecided script version: the confirmation shows the team-change card's facts (scripts with flags, hosts, lockfiles, programs, hashes) and the pick; Confirm waits for it", JSON.stringify({ box, startOff }));
    // while undecided, the upper rows do not promise a run or a network the decision below may not give
    const upper = await w.evaluate(() => ({ scripts: document.querySelector("[data-explain-scripts]")?.dataset.explainScripts, text: document.querySelector("[data-explain-scripts]")?.textContent || "", net: document.querySelector('[data-explain-srow="network"]')?.textContent || "" }));
    ok(upper.scripts === "pending" && /Depends on your decision below/.test(upper.text) && !/with network/.test(upper.text) && /Depends on your decision below/.test(upper.net) && !/public hosts only/.test(upper.net),
      "an undecided version: the scripts and network rows say they depend on the decision below", JSON.stringify(upper));
    // the decision is far down: the sticky footer says Confirm waits for it, and takes the captain there
    const hint = async () => w.evaluate(() => { const e = document.querySelector("[data-explain-pickhint]"), r = e?.getBoundingClientRect(); return e ? { hidden: e.hidden, text: e.textContent, inView: !!r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight } : null; });
    const inView = () => w.evaluate(() => { const r = document.querySelector('[data-explain-decide="scripts"]')?.getBoundingClientRect(), f = document.querySelector(".rx-modal > .rx-foot")?.getBoundingClientRect(); return !!r && !!f && r.height > 0 && r.top >= 0 && r.bottom <= f.top; });
    // a smooth scroll: wait until the dialog stops moving
    const settle = () => w.evaluate(() => new Promise((ok) => { const m = document.querySelector(".rx-modal"); let last = -1, same = 0; const t = setInterval(() => { same = m.scrollTop === last ? same + 1 : 0; last = m.scrollTop; if (same >= 4) { clearInterval(t); ok(); } }, 50); }));
    const h0 = await hint();
    ok(h0 && !h0.hidden && h0.inView && /Choose “Approve with scripts” or “Text only” below to start/.test(h0.text) && !(await inView()), "the footer says Confirm waits for the pick, on the first screen", JSON.stringify(h0));
    await w.click("[data-explain-gopick]"); await settle();
    ok(await inView(), "the footer's button scrolls to the decision");
    await w.screenshot({ path: join(shots, "15-decide-pending.png") });
    await w.check('[data-explain-decide="scripts"]');
    ok(!(await w.$eval("[data-explain-start]", (e) => e.disabled)) && (await hint())?.hidden === true, "picking Approve with scripts enables Confirm and the footer line goes");
    onGen = (r, b) => { D = { ...D, selected: { id: "walkthrough", v: 1 }, running: 1, runs: [run(1, "generate", "running", { decided: "approved", prepare: { state: "running", at: "t" }, rounds: [], progress: [{ at: "t", text: "Studio is reading the materials (read-only)" }] })] }; r.fulfill({ json: D }); };
    await w.click("[data-explain-start]"); await w.waitForSelector("[data-explain-progress], [data-explain-genstrip]");
    ok(gens.at(-1)?.confirm === PENDING.hash && gens.at(-1)?.skillDecision === "scripts", "Confirm sends the exact confirmation and the pick", JSON.stringify(gens.at(-1)));
    const prep = await w.$eval('[data-explain-prepare="running"]', (e) => e.textContent).catch(() => "");
    ok(/installing the skill's dependencies from its lockfiles/.test(prep), "the run shows Studio installing the skill's dependencies before its first round", prep);
    await w.screenshot({ path: join(shots, "16-decide-preparing.png") });
    D = { ...D, running: null, runs: [run(1, "generate", "failed", { decided: "approved", why: "prepare", error: "Studio could not prepare the skill's dependencies: walkthrough@v1: preparing its dependencies failed: pip install failed / Studio 沒辦法準備這個 skill 的依賴：walkthrough@v1：準備依賴失敗：pip 安裝失敗", rounds: [], prepare: { state: "failed", at: "t", reasons: [{ en: "walkthrough@v1: preparing its dependencies failed: pip install failed", zh: "walkthrough@v1：準備依賴失敗：pip 安裝失敗" }] } })] };
    await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector('[data-explain-ended="prepare"]', { timeout: 5000 });
    const ended = await w.$eval('[data-explain-ended="prepare"]', (e) => e.textContent);
    ok(/could not install the skill's dependencies, so no round ran/.test(ended) && /pip install failed/.test(ended), "a failed prepare says why the run stopped", ended);
    // a narrow window: the options are there (the header's skill picker hides below 760 px; the decision does not) and the pick enables Confirm
    await w.setViewportSize({ width: 390, height: 844 });
    // (the header's picker is hidden at this width: the room's own Generate button opens the confirmation)
    cur = { ...PENDING, hash: "c0ffee00000000a4" }; D = { ...D, selected: { id: "walkthrough", v: 1 }, versions: [], runs: [] };
    await w.goto(`${base}/#/board`); await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-again]", { timeout: 15000 });
    await w.click("[data-explain-again]"); await w.waitForSelector("[data-explain-confirm] [data-explain-start]"); await w.waitForTimeout(60);
    const h390 = await hint();
    ok(h390 && !h390.hidden && h390.inView, "390 px: the footer says Confirm waits for the pick", JSON.stringify(h390));
    await w.click("[data-explain-gopick]"); await settle();
    const opts = await w.$$eval("[data-explain-decide]", (xs) => xs.map((x) => { const r = x.closest("label").getBoundingClientRect(); return { v: x.value, w: r.width, h: r.height, shown: getComputedStyle(x.closest("[role=radiogroup]")).display !== "none", inView: r.top >= 0 && r.bottom <= document.querySelector(".rx-modal > .rx-foot").getBoundingClientRect().top }; }));
    ok(opts.length === 2 && opts.every((o) => o.shown && o.w > 0 && o.h > 0 && o.inView), "390 px: both decision options are visible", JSON.stringify(opts));
    await w.screenshot({ path: join(shots, "15b-decide-390.png") });
    await w.click('label:has([data-explain-decide="text-only"])');
    ok(!(await w.$eval("[data-explain-start]", (e) => e.disabled)), "390 px: picking enables Confirm");
    await w.click(".rx-modal .rx-foot > .btn:not(.primary)"); await w.setViewportSize({ width: 1440, height: 900 });
    // refused because the skill has a new, undecided version: the pick made for the old one is not carried over
    cur = { ...PENDING, hash: "c0ffee00000000a5" }; D = { ...D, selected: null, runs: [] }; await openConfirm();
    await w.check('[data-explain-decide="scripts"]');
    const NEWV = { ...PENDING, hash: "c0ffee00000000a6", skill: { ...PENDING.skill, v: 2 }, decide: { state: "pending", facts: { ...FACTS, v: 2, sha256: "c".repeat(64), filesSha256: "d".repeat(64) } } };
    onGen = (r) => r.fulfill({ status: 409, json: { error: "The skill changed since you confirmed: confirm again / 確認之後 skill 變了，請再確認一次", code: "confirm_required", offer: NEWV } });
    await w.click("[data-explain-start]"); await w.waitForSelector("[data-explain-note]", { timeout: 5000 }); await w.waitForTimeout(100);
    const after = await w.evaluate(() => ({ checked: [...document.querySelectorAll("[data-explain-decide]")].filter((x) => x.checked).map((x) => x.value), off: !!document.querySelector("[data-explain-start]")?.disabled, box: document.querySelector("[data-explain-decidebox]")?.textContent || "" }));
    ok(after.checked.length === 0 && after.off && /walkthrough@v2 · cccccccccccc/.test(after.box), "refused for a new undecided version: no option is pre-ticked and Confirm waits for a new pick", JSON.stringify({ ...after, box: after.box.slice(0, 120) }));
    await w.check('[data-explain-decide="text-only"]'); onGen = (r) => { D = { ...D, running: null, runs: [] }; r.fulfill({ json: D }); };
    await w.click("[data-explain-start]"); await w.waitForTimeout(150);
    ok(gens.at(-1)?.confirm === NEWV.hash && gens.at(-1)?.skillDecision === "text-only", "the new pick goes with the new version's confirmation", JSON.stringify(gens.at(-1)));
    // text only, picked in the confirmation
    cur = { ...PENDING, hash: "c0ffee00000000a2" }; D = { ...D, selected: null, runs: [] }; await openConfirm();
    await w.check('[data-explain-decide="text-only"]');
    onGen = (r) => { D = { ...D, running: null, runs: [] }; r.fulfill({ json: D }); };
    await w.click("[data-explain-start]"); await w.waitForTimeout(150);
    ok(gens.at(-1)?.skillDecision === "text-only" && gens.at(-1)?.confirm === "c0ffee00000000a2", "Text only is sent with the confirmation", JSON.stringify(gens.at(-1)));
    // already decided: the decision is shown, nothing is asked
    cur = { ...OFFER, hash: "c0ffee00000000a3", scripts: { ...OFFER.scripts, approved: true, rows: { ...OFFER.scripts.rows, approval: null } }, decide: { state: "approved", via: "review-room", at: "2026-11-18T10:00:00Z", ready: "ready" } };
    D = { ...D, selected: null }; await openConfirm();
    const dec = await w.$eval("[data-explain-decision]", (e) => ({ state: e.dataset.explainDecision, text: e.textContent })).catch(() => null);
    ok(dec?.state === "approved" && /Approved with scripts · decided in the review room/.test(dec.text) && !(await w.$("[data-explain-decide]")) && !(await w.$eval("[data-explain-start]", (e) => e.disabled)), "a decided version shows its decision and asks nothing", JSON.stringify(dec));
    onGen = (r) => { D = { ...D, running: null }; r.fulfill({ json: D }); };
    await w.click("[data-explain-start]"); await w.waitForTimeout(150);
    ok(gens.at(-1)?.confirm === "c0ffee00000000a3" && !("skillDecision" in gens.at(-1)), "no pick is sent for a decided version", JSON.stringify(gens.at(-1)));
    // a question is the room tutor's own: whatever the skill's scripts, its confirmation in the chat asks no script decision
    D = { ...D, selected: { id: "walkthrough", v: 1 }, versions: versions.slice(0, 1), runs: [run(1, "generate", "done", { version: 1 })] };
    await w.goto(`${base}/#/board`); await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-open]", { timeout: 15000 }); await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector('[data-explain-frame="1"]', { timeout: 15000 });
    await w.fill("[data-explain-q]", "Why this lockfile?"); await w.click("[data-explain-send]"); await w.waitForSelector("[data-explain-askconfirm]", { timeout: 5000 });
    ok(!(await w.$("[data-explain-askconfirm] [data-explain-decidebox]")) && !(await w.$('[data-explain-askok="scripts"]')) && !!(await w.$("[data-explain-askok]")), "a question asks no script decision: one Confirm and ask");
    await w.click("[data-explain-askok]"); await w.waitForTimeout(150);
    ok(asks.at(-1)?.confirm === ASK_OFFER.hash && !("skillDecision" in asks.at(-1)), "the question goes with its confirmation and no pick", JSON.stringify(asks.at(-1)));
    await c7.close(); }


  // ---------- Confirm and start while the server is slow to admit the run: it says so, then the dialog closes and stays closed ----------
  // the server answers only once the run is admitted (a model it verifies again can take a minute) and pushes that the run
  // started; pushes and the poll landing meanwhile or after never bring the dialog back. Refused, the dialog stays with why.
  // What it says (starting, or why it was refused) is in the dialog's sticky footer: in view at any width, however long the dialog.
  const explainCtx = async (vp, zh) => { const c = await browser.newContext({ viewport: vp });
    await c.addInitScript((z) => { try { localStorage.setItem("crew.lang", z ? "zh-TW" : "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [], speak() {}, cancel() {} } }); window.SpeechRecognition = class { static async available() { return "unavailable"; } }; }, zh);
    await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await c.route(new RegExp(`/api/review-room/${ID}(\\?open=1)?$`), (r) => r.fulfill({ json: ROOM }));
    await c.route(new RegExp(`/api/review-room/${ID}/arrive$`), (r) => r.fulfill({ json: {} })); return c; };
  /** the element is wholly on screen, inside the dialog's visible box, and is what is drawn at its centre */
  const inView = (w, sel) => w.evaluate((s) => { const e = document.querySelector(s), m = document.querySelector(".rx-modal"); if (!e || !m) return false;
    const b = e.getBoundingClientRect(), mb = m.getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return b.height > 0 && b.top >= Math.max(0, mb.top) - 0.5 && b.bottom <= Math.min(innerHeight, mb.bottom) + 0.5 && b.left >= 0 && b.right <= innerWidth + 0.5 && !!at && e.contains(at); }, sel);
  const REFUSAL = { status: 400, json: { error: "The tutor's model is not available: not signed in / 導師的模型不能用：沒有登入", code: "no_tutor" } };
  const failedBefore = () => ({ ...X, selected: { id: "walkthrough", v: 1 }, versions: [], running: null, consent: null, runs: [run(1, "generate", "failed", { why: "provider", error: "readiness was invalidated" })] });
  for (const sc of [{ from: "tutor", vp: { width: 1440, height: 900 } }, { from: "again", vp: { width: 1440, height: 900 }, zh: true }, { from: "again", vp: { width: 390, height: 844 } },
    { from: "refused", vp: { width: 1440, height: 900 } }, { from: "refused", vp: { width: 390, height: 844 }, zh: true }]) {
    const { from, vp, zh } = sc, tag = `${from} ${vp.width}${zh ? " zh-TW" : ""}`;
    const c7 = await explainCtx(vp, !!zh);
    // from the board (the skill picked, nothing made yet), or Try again after a run the provider refused
    let Y = from === "tutor" ? { ...X, selected: null, versions: [], running: null, consent: null, runs: [] } : failedBefore();
    let release = null; const gens = [];
    await c7.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: Y }));
    await c7.route(new RegExp(`/api/review-room/${ID}/explain/offer$`), (r) => r.fulfill({ json: OFFER }));
    await c7.route(new RegExp(`/api/review-room/${ID}/explain/generate$`), async (r) => { gens.push(JSON.parse(r.request().postData() || "{}"));
      await new Promise((go) => (release = go));
      if (from === "refused") return r.fulfill(REFUSAL);
      // recorded as the server does (no rounds, no progress yet), pushed, then answered
      Y = { ...Y, selected: { id: "walkthrough", v: 1 }, running: 2, runs: [...Y.runs, run(2, "generate", "running", { rounds: [], cost: null })] }; r.fulfill({ json: Y }); });
    const w = await c7.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    const push = () => w.evaluate((id) => { for (const t of ["review-explain", "review-room"]) LIVE.es.dispatchEvent(new MessageEvent(t, { data: JSON.stringify({ card: id }) })); }, ID);
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector(from === "tutor" ? "[data-explain-picker]" : "[data-explain-again], [data-explain-versions]", { timeout: 15000 });
    if (from === "tutor") { await w.click("[data-explain-open]"); await w.click('[data-explain-skill="walkthrough"]'); } else await again(w);
    await w.waitForSelector("[data-explain-start]:not([disabled])");
    await w.click("[data-explain-start]"); for (let i = 0; i < 60 && !release; i++) await w.waitForTimeout(50);
    await push(); await w.waitForTimeout(300); await w.keyboard.press("Escape"); await w.waitForTimeout(150);
    await w.click(".rx-modalbg", { position: { x: 5, y: 5 } }).catch(() => {}); await push(); await w.waitForTimeout(300);
    const busy = await w.evaluate(() => { const b = document.querySelector("[data-explain-start]"), cancel = document.querySelector(".rx-modal .rx-foot .btn:not(.primary)");
      return { open: !!document.querySelector("[data-explain-confirm]"), disabled: !!b?.disabled, text: b?.textContent || "", busy: b?.getAttribute("aria-busy"), cancel: !!cancel?.disabled, said: document.querySelector("[data-explain-starting]")?.textContent || "",
        locked: [...document.querySelectorAll("[data-explain-confirm] :is([data-explain-prompt], [data-explain-limit], [data-explain-promptsave], [data-explain-promptreset], [data-explain-promptexample])")].map((e) => e.disabled) }; });
    const starting = zh ? /開始中…/.test(busy.text) && /正在確認模型並開始執行/.test(busy.said) : /Starting…/.test(busy.text) && /starting the run/.test(busy.said);
    ok(gens.length === 1 && busy.open && busy.disabled && starting && busy.busy === "true" && busy.cancel && busy.locked.length >= 3 && busy.locked.every(Boolean),
      `${tag}: while the server starts the run the dialog says it is starting, on its button; its instructions are locked; Esc, the backdrop and Cancel do not dismiss it, and it is sent once`, JSON.stringify({ busy, gens: gens.length }));
    ok(await inView(w, "[data-explain-starting]"), `${tag}: the line that says it is starting is in view, beside Confirm (no scrolling)`);
    await w.screenshot({ path: join(shots, `15-starting-${from}-${vp.width}${zh ? "-zh" : ""}.png`) });
    release?.();
    if (from === "refused") {
      await w.waitForSelector("[data-explain-note]", { timeout: 5000 }).catch(() => {});
      const after = await w.evaluate(() => { const b = document.querySelector("[data-explain-start]"), n = document.querySelector("[data-explain-confirm] [data-explain-note]");
        return { open: !!document.querySelector("[data-explain-confirm]"), note: n?.textContent || "", role: n?.getAttribute("role"), disabled: !!b?.disabled, text: b?.textContent || "", starting: !!document.querySelector("[data-explain-starting]") }; });
      ok(after.open && (zh ? /沒有登入/.test(after.note) && /確認並開始/.test(after.text) : /not signed in/.test(after.note) && /Confirm and start/.test(after.text)) && after.role === "alert" && !after.disabled && !after.starting,
        `${tag}: refused, the dialog stays with why (an alert), and Confirm and start is on again`, JSON.stringify(after));
      ok(await inView(w, "[data-explain-note]"), `${tag}: the reason it was refused is in view, beside Confirm (no scrolling)`);
      await w.screenshot({ path: join(shots, `15-refused-${vp.width}${zh ? "-zh" : ""}.png`) });
      await w.click(".rx-modal .rx-foot .btn:not(.primary)"); await w.waitForTimeout(150);
      ok(!(await w.$("[data-explain-confirm]")), `${tag}: Cancel closes it then`);
    } else {
      await w.waitForSelector("[data-explain-confirm]", { state: "detached", timeout: 5000 }).catch(() => {});
      await push(); await w.waitForTimeout(3200); // a push, and the room's poll (every 2.5 s), after the answer
      const after = await w.evaluate(() => ({ open: !!document.querySelector("[data-explain-confirm], .rx-modal"), progress: !!document.querySelector("[data-explain-progress]") }));
      ok(!after.open && after.progress, `${tag}: once started, the dialog closes and stays closed (a push and the poll after it do not bring it back); the run's progress shows`, JSON.stringify(after));
    }
    await c7.close();
  }
  // ---------- an answer for a dialog that is gone never brings it back ----------
  { const c8 = await explainCtx({ width: 1440, height: 900 }, false);
    let Y = failedBefore(), releaseGen = null, releaseLimit = null;
    await c8.route(new RegExp(`/api/review-room/${ID}/explain$`), (r) => r.fulfill({ json: Y }));
    await c8.route(new RegExp(`/api/review-room/${ID}/explain/offer$`), (r) => r.fulfill({ json: OFFER }));
    await c8.route(new RegExp(`/api/review-room/${ID}/explain/generate$`), async (r) => { await new Promise((go) => (releaseGen = go)); r.fulfill(REFUSAL); });
    await c8.route(/\/api\/review-room\/explain\/settings$/, async (r) => { if (r.request().method() !== "POST") return r.continue(); await new Promise((go) => (releaseLimit = go)); r.fulfill({ json: { limitMin: 90 } }); });
    const w = await c8.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${base}/#/room/${ID}`); await w.waitForSelector("[data-explain-again], [data-explain-versions]", { timeout: 15000 });
    // the safety limit changed, then Cancel before Studio saved it: the dialog does not come back with the new limit
    await again(w); await w.waitForSelector("[data-explain-start]:not([disabled])");
    await w.fill("[data-explain-limit]", "90"); await w.press("[data-explain-limit]", "Tab"); for (let i = 0; i < 60 && !releaseLimit; i++) await w.waitForTimeout(50);
    await w.click(".rx-modal .rx-foot .btn:not(.primary)"); await w.waitForTimeout(150); releaseLimit?.(); await w.waitForTimeout(600);
    ok(!!releaseLimit && !(await w.$("[data-explain-confirm]")), "the limit saved after the dialog was cancelled: it stays closed");
    await w.keyboard.press("Escape"); await w.waitForTimeout(150); // whatever came back, out of the way
    // the captain left the room while the run was being started, and came back; then the server refused it
    await again(w); await w.waitForSelector("[data-explain-start]:not([disabled])"); await w.click("[data-explain-start]");
    for (let i = 0; i < 60 && !releaseGen; i++) await w.waitForTimeout(50);
    await w.evaluate(() => { location.hash = "#/board"; }); await w.waitForTimeout(400);
    await w.evaluate((id) => { location.hash = `#/room/${id}`; }, ID); await w.waitForSelector("[data-explain-again], [data-explain-versions]", { timeout: 10000 }); await w.waitForTimeout(400);
    releaseGen(); await w.waitForTimeout(600);
    const left = await w.evaluate(() => ({ open: !!document.querySelector("[data-explain-confirm]"), err: document.querySelector("[data-explain-error]")?.textContent || "" }));
    ok(!left.open && /not signed in/.test(left.err), "a run refused after the captain left its dialog: no dialog comes back; the room says why", JSON.stringify(left));
    await c8.close();
  }
  ok(!errors.length, "no page error", errors.join(" | "));
} catch (e) { fail++; console.log("  FAIL  the run stopped:", e?.stack || e, "PAGEERRORS", errors.join(" | ")); console.log(appLog.slice(-3000)); }
finally { await browser.close(); app.kill(); probe.close(); }
console.log(`\nreview-room-explain-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
