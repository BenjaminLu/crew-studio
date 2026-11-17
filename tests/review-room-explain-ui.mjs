import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// "Explain with" on the page (public/review-explain.js, docs/units/review-room.md): the header's picker (the tutor and the
// captain's library skill), the paid run's confirmation, the background run's progress and Stop, the output in a sandboxed
// frame served by a real Studio under the output CSP (the page in it cannot fetch, cannot read Studio, has working storage),
// boxing a region (the frame's helper says what lies there) and a follow-up that carries it, the answer with its citations and
// the new version in the rail, an older version, a video paused at a frame. A real isolated Studio serves the skill import,
// the capability and the version's page; the room and the paid runs are answered by the test: nothing paid runs.
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
const port = await freePort();
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
const files = { 1: { "index.html": page(1) }, 2: { "index.html": page(2, '<p data-node="half">Halves round up: 2.5 becomes 3.</p>') }, 3: { "clip.mp4": Buffer.from("not really a video") } };
const versions = [];
for (const [n, fs] of Object.entries(files)) { mkdirSync(join(xdir, `v${n}`), { recursive: true }); const list = [];
  for (const [p, c] of Object.entries(fs)) { writeFileSync(join(xdir, `v${n}`, p), c); list.push({ path: p, bytes: Buffer.byteLength(c), sha256: sha(c) }); }
  const entry = Object.keys(fs)[0]; versions.push({ n: Number(n), run: Number(n), skill: { id: "walkthrough", v: 1, name: "walkthrough" }, at: `2026-11-01T10:0${n}:00Z`, entry, kind: entry.endsWith(".mp4") ? "video" : "html", files: list, summary: n === "1" ? "One page: percent, step by step" : n === "2" ? "added a note on halves" : "A short video", from: n === "2" ? 1 : null }); }
writeFileSync(join(xdir, "state.json"), JSON.stringify({ schema: 1, selected: { id: "walkthrough", v: 1 }, runs: [], versions }));
// the captain's skill, made up: imported into the library through Studio's own route
const skillDir = join(tmp, "walkthrough"); mkdirSync(skillDir);
writeFileSync(join(skillDir, "SKILL.md"), "---\nname: walkthrough\ndescription: An interactive one-page walkthrough of a change.\n---\n# Walkthrough\n\nWrite index.html.\n");

const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
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
  isolation: { en: "The output is shown in an isolated frame: it cannot read Studio, reach the network or see any token.", zh: "產出放在隔離框裡顯示" },
  scripts: { run: true, count: 3, interpreters: ["python3 3.12.4"], network: true, browser: false, credentials: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"], keys: ["ANTHROPIC_API_KEY"], endpoints: ["ANTHROPIC_BASE_URL"], missing: ["ffmpeg"], approved: false,
    limits: { cpuS: 300, fileMB: 60, wallS: 600, calls: 60 },
    rows: { network: { en: "Through Studio's proxy, public hosts only (never this Mac or its network); every host is logged", zh: "經過 Studio 的代理，只能連公開主機" }, access: { en: "Writes only the output folder and its temp folder", zh: "只寫產出資料夾" },
      limits: { en: "300 s of CPU · files up to 60 MB · 10 min · 60 calls per round", zh: "CPU 300 秒 · 檔案 60 MB · 10 分鐘 · 每輪 60 次" }, browser: { en: "None installed (Playwright's headless shell): steps that need one fail", zh: "沒有安裝" },
      missing: { en: "ffmpeg", zh: "ffmpeg" }, approval: { en: "This version is not approved for workflows on the Skills page: confirming here lets its scripts run for this run only.", zh: "這個版本沒有在技能頁核准給工作流程用：在這裡確認只讓它的腳本在這一次執行裡跑。" } },
    en: "The skill's 3 scripts run when it calls them, each in Studio's sandbox, with python3 3.12.4. With network: through Studio's proxy, to public hosts only.", zh: "這個 skill 的 3 個腳本會在它呼叫時執行，每次都在 Studio 的沙盒裡，可以連網。" } };
const ASK_OFFER = { ...OFFER, kind: "ask", hash: "c0ffee0000000002" };
/** a script call's line as the server sends it (src/domain/review-explain.ts ScriptLine) */
const SL = (x) => ({ args: "", limit: null, limits: { cpuS: 300, fileMB: 60, wallS: 600, diskMB: 120 }, exit: null, signal: null, ms: 0, hosts: [], refused: [], refusal: null, stderr: "", ...x });
const run = (n, kind, status, extra = {}) => ({ n, kind, skill: { id: "walkthrough", v: 1, name: "walkthrough", sha256: "x" }, status, by: "captain", at: new Date(Date.now() - 4 * 60_000).toISOString(), ended: status === "running" ? null : new Date().toISOString(), provider: "claude", model: "claude-opus-5", effort: null, confirm: "c", limitMin: 120, rounds: [{ n: 1, job: "J1" }], cost: { usd: 0.42 }, error: null, progress: [], from: null, version: null, ...extra });

try {
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
  await ctx.route(new RegExp(`/api/review-room/${ID}/explain/offer\\?`), (r) => { const kind = new URL(r.request().url()).searchParams.get("kind"); r.fulfill({ json: kind === "ask" ? ASK_OFFER : OFFER }); });
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
  ok(await p.$eval("[data-explain-picker]", (e) => e.dataset.explainPicker === "tutor" && /Explain with\s*Studio tutor/.test(e.textContent)) && !!(await p.$("[data-board]")), "the header's picker reads Studio tutor, and the room is the board as before");
  await p.click("[data-explain-open]"); await p.waitForSelector("[data-explain-menu]");
  const menu = await p.$$eval("[data-explain-skill]", (es) => es.map((e) => [e.dataset.explainSkill, e.textContent]));
  ok(menu[0][0] === "tutor" && menu[1][0] === "walkthrough" && /your skill/.test(menu[1][1]) && /interactive one-page walkthrough/.test(menu[1][1]) && menu.slice(2).every(([, t]) => /in Studio's library/.test(t)), "the menu lists the tutor, the captain's own skill first, then the skills Studio's library ships", JSON.stringify(menu.slice(0, 3)));
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
  ok(/not approved for workflows on the Skills page/.test(warn.text) && /rx-warn/.test(warn.cls), "an unapproved version is a warning line of its own", JSON.stringify(warn));
  ok(/Output frame/.test(conf) && !/Isolation/.test(conf), "the output frame's row is named for the frame (no clash with the scripts' network)", conf);
  await p.screenshot({ path: join(shots, "2-confirm.png") });
  onGenerate = (r) => { X = { ...X, selected: { id: "walkthrough", v: 1 }, running: 1, runs: [run(1, "generate", "running", { progress: [{ at: "t", text: "reading the diff and the commits" },
    { at: "t", text: "build.py — exit 0 · 0.1 s", script: SL({ script: "scripts/build.py", args: "spec.json", outcome: "ok", exit: 0, ms: 120 }) },
    { at: "t", text: "fetch.py — exit 0", script: SL({ script: "scripts/fetch.py", args: "--url https://api.model-vendor.example/v1", outcome: "ok", exit: 0, ms: 3400, hosts: ["api.model-vendor.example"], refused: [{ host: "169.254.169.254", why: "a metadata address" }] }) },
    { at: "t", text: "check.py — exit 3", script: SL({ script: "scripts/check.py", args: "index.html", outcome: "fail", exit: 3, ms: 90, stderr: "Traceback: missing <h1>" }) },
    { at: "t", text: "spin.py — CPU", script: SL({ script: "scripts/spin.py", outcome: "limit", limit: "cpu", signal: "SIGXCPU", ms: 300200 }) },
    { at: "t", text: "passwd — refused", script: SL({ script: "../../etc/passwd", outcome: "refused", refusal: "../../etc/passwd is not a script of walkthrough@v1" }) },
    { at: "t", text: "drawing the rounding figure" }] })], log: [{ ts: "2026-11-01T10:01:00Z", kind: "tool", text: "mat_read {\"path\":\"diff.txt\"}" }] }; answer(r, X); };
  await p.click("[data-explain-start]"); await p.waitForSelector("[data-explain-progress]");
  ok(posts.at(-1)[0] === "generate" && posts.at(-1)[1].skill === "walkthrough" && posts.at(-1)[1].confirm === OFFER.hash, "Confirm and start sends the skill and the exact confirmation", JSON.stringify(posts.at(-1)));
  const prog = await p.$eval("[data-explain-progress]", (e) => e.textContent);
  ok(/walkthrough is making the explanation/.test(prog) && /drawing the rounding figure/.test(prog) && /you can leave the room/.test(prog) && /safety limit 120 min/.test(prog) && !!(await p.$("[data-explain-generating]")), "the run shows live progress in the stage and in the rail", prog);
  const callRows = () => p.$$eval("[data-explain-progress] li", (es) => es.filter((e) => e.querySelector("[data-explain-call]")).map((e) => ({ mark: e.querySelector(".d").textContent, cls: e.className, sum: e.querySelector("summary").textContent })));
  let cr = await callRows();
  ok(cr.length === 5 && cr[0].mark === "✓" && /^build\.py — done · 0\.1 s$/.test(cr[0].sum) && cr[1].mark === "⚠" && /reached api\.model-vendor\.example/.test(cr[1].sum) && /refused 169\.254\.169\.254/.test(cr[1].sum)
    && cr[2].mark === "✗" && /check\.py — failed, exit 3/.test(cr[2].sum) && cr[3].mark === "⚠" && /spin\.py — hit the CPU limit \(300 s\)/.test(cr[3].sum) && cr[4].mark === "✗" && /passwd — refused: .*not a script/.test(cr[4].sum),
    "each script call is a line with its outcome: ✓ done, ⚠ a limit or a refused host, ✗ failed or refused; the result first", JSON.stringify(cr));
  await p.click('[data-explain-call="fail"] summary');
  ok(/stderr:\nTraceback: missing <h1>/.test(await p.$eval('[data-explain-call="fail"] .rx-calldetail', (e) => e.textContent)) && /refused 169\.254\.169\.254 \(a metadata address\)/.test(await p.$eval('[data-explain-progress] li:nth-of-type(3) .rx-calldetail', (e) => e.textContent)),
    "a line opens to its stderr tail and every host it reached or was refused");
  await p.click("[data-explain-log]"); ok(/mat_read/.test(await p.$eval("[data-explain-logtext]", (e) => e.textContent)), "the skill's live log opens");
  await p.screenshot({ path: join(shots, "3-progress.png") });
  // the same lines in Traditional Chinese (built by the page from the call, not the server's English text)
  await p.evaluate(() => { sessionStorage.setItem("keep-lang", "1"); localStorage.setItem("crew.lang", "zh-TW"); }); await p.reload(); await p.waitForSelector("[data-explain-progress] [data-explain-call]");
  cr = await callRows();
  ok(/build\.py — 完成/.test(cr[0].sum) && /碰到 CPU 上限（300 秒）/.test(cr[3].sum) && /被拒/.test(cr[4].sum) && /連到 api\.model-vendor\.example/.test(cr[1].sum), "the lines are in the captain's language", JSON.stringify(cr));
  await p.screenshot({ path: join(shots, "3b-progress-zh.png") });
  await p.evaluate(() => { sessionStorage.removeItem("keep-lang"); localStorage.setItem("crew.lang", "en"); }); await p.reload(); await p.waitForSelector("[data-explain-progress]");
  onStop = (r) => { X = { ...X, running: null, runs: [run(1, "generate", "stopped", { stop: "stopped by the captain" })] }; answer(r, X); };
  await p.click("[data-explain-stop]"); await p.waitForSelector("[data-explain-empty]");
  ok(posts.at(-1)[0] === "stop" && /Stopped/.test(await p.$eval("[data-explain-empty]", (e) => e.textContent)) && /stopped by the captain/.test(await p.$eval("[data-explain-empty]", (e) => e.textContent)), "Stop stops it, and the stage says so");
  // generate again: this time it finishes (the next read of the room's explainer has v1)
  onGenerate = (r) => { X = { ...X, running: 2, runs: [...X.runs, run(2, "generate", "running")] }; answer(r, X); setTimeout(() => { X = { ...X, running: null, runs: [X.runs[0], run(2, "generate", "done", { version: 1 })], versions: versions.slice(0, 1) }; }, 300); };
  await p.click("[data-explain-again]"); await p.waitForSelector("[data-explain-start]:not([disabled])"); await p.click("[data-explain-start]");
  await p.waitForSelector('[data-explain-frame="1"]', { timeout: 10000 });
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

  // ---------- box a region, ask about it; confirm the follow-up once with "don't ask again"; the answer and v2 ----------
  await p.click("[data-explain-box]"); await p.waitForSelector("[data-explain-overlay]");
  const lb = await p.$eval("[data-x-layer]", (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await p.mouse.move(lb.x + 4, lb.y + 70); await p.mouse.down(); await p.mouse.move(lb.x + 200, lb.y + 160, { steps: 4 }); await p.mouse.move(lb.x + 420, lb.y + 250, { steps: 4 }); await p.mouse.up();
  await p.waitForSelector('[data-explain-scope="region"]', { timeout: 5000 });
  const scopeText = await p.$eval("[data-x-scope]", (e) => e.textContent);
  ok(/boxed region \(How percent works \(v1\) › Step 1 · rounding\)/.test(scopeText) && /Math\.round/.test(scopeText) && !!(await p.$("[data-explain-quick]")), "the frame's helper said what lies in the box: the headings and the text (quick questions offered)", scopeText);
  await p.screenshot({ path: join(shots, "5-boxed.png") });
  onAsk = (r) => { const b = JSON.parse(r.request().postData() || "{}"); if (!b.confirm) return answer(r, { error: "confirm", code: "confirm_required", offer: ASK_OFFER }, 409);
    X = { ...X, running: 3, runs: [...X.runs, run(3, "ask", "running", { question: b.question, selection: b.selection, from: 1, progress: [{ at: "t", text: "reading the figure" }] })] }; answer(r, X);
    setTimeout(() => { X = { ...X, running: null, consent: { plan: ASK_OFFER.hash }, versions: versions.slice(0, 2), runs: [...X.runs.slice(0, -1), run(3, "ask", "done", { question: b.question, selection: b.selection, from: 1, version: 2, answer: 'Rounding happens once, at the end. <img src=x onerror="window.__pwned=1">', cites: ["src/percent.ts:L3", "commit:abc1234"], summary: "added a note on halves" })] }; }, 400); };
  await p.fill("[data-explain-q]", "Why round here?"); await p.click("[data-explain-send]");
  await p.waitForSelector("[data-explain-askconfirm]");
  const first = posts.at(-1)[1];
  ok(posts.at(-1)[0] === "ask" && first.question === "Why round here?" && first.version === 1 && first.selection?.headings?.includes("Step 1 · rounding") && first.selection.nodes.includes("round") && /Math\.round/.test(first.selection.text) && first.selection.rect?.w > 100 && !first.confirm,
    "the follow-up carries the boxed region: headings, figure ids, text, the rectangle", JSON.stringify(first));
  ok(/paid run on claude · claude-opus-5 with walkthrough/.test(await p.$eval("[data-explain-askconfirm]", (e) => e.textContent)), "a follow-up asks for its paid run's confirmation, in the chat");
  const askc = await p.$eval("[data-explain-askconfirm]", (e) => ({ scripts: e.querySelector("[data-explain-askscripts]")?.textContent ?? "", chips: [...e.querySelectorAll(".rx-chipname")].map((c) => c.textContent), warn: e.querySelector("[data-explain-unapproved]")?.textContent ?? "", consent: e.querySelector("label").textContent }));
  ok(/Its scripts run in this follow-up too: sandboxed, with network/.test(askc.scripts) && JSON.stringify(askc.chips) === '["ANTHROPIC_API_KEY"]' && /approves this run only/.test(askc.warn) && /their scripts included \(sandboxed, with network\)/.test(askc.consent),
    "the follow-up's confirmation says its scripts run (network, the credential, unapproved), and so does the don't-ask-again consent", JSON.stringify(askc));
  await p.check("[data-explain-consent]"); await p.click("[data-explain-askok]");
  await p.waitForSelector('[data-explain-answer="3"][data-status="done"]', { timeout: 10000 });
  ok(posts.at(-1)[1].confirm === ASK_OFFER.hash && posts.at(-1)[1].consent === true && posts.at(-1)[1].selection?.nodes?.includes("round"), "confirmed with “don't ask again”: the same question goes with the confirmation and the consent", JSON.stringify(posts.at(-1)[1]));
  const ans = await p.$eval('[data-explain-answer="3"]', (e) => ({ text: e.textContent, cites: [...e.querySelectorAll("[data-explain-cite]")].map((c) => c.textContent), upd: e.querySelector("[data-explain-updated]")?.textContent, img: !!e.querySelector("img") }));
  ok(ans.cites.join("|") === "src/percent.ts:L3|commit:abc1234" && /output is now v2: added a note on halves/.test(ans.upd) && /onerror/.test(ans.text) && !ans.img && !(await p.evaluate(() => window.__pwned)), "the answer shows its citations and says the output is now v2; the model's text stays text", JSON.stringify(ans));
  ok(/▭ Step 1 · rounding/.test(await p.$eval('[data-explain-q-run="3"]', (e) => e.textContent)), "the question in the chat shows what was boxed");
  await p.waitForSelector('[data-explain-frame="2"]', { timeout: 5000 });
  ok(await p.$$eval("[data-explain-version]", (es) => es.map((e) => e.dataset.explainVersion).join(",")) === "1,2" && (await p.$eval('[data-explain-version="2"]', (e) => e.classList.contains("on"))), "v2 is in the rail and shown");
  await p.screenshot({ path: join(shots, "6-answer-v2.png") });
  await p.click('[data-explain-version="1"]'); await p.waitForSelector('[data-explain-frame="1"]');
  ok(await p.$eval('[data-explain-version="1"]', (e) => e.classList.contains("on")), "an older version is viewable again");

  // ---------- a video output: pause at a frame and ask ----------
  X = { ...X, versions };
  await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector('[data-explain-version="3"]');
  await p.click('[data-explain-version="3"]'); await p.waitForSelector("[data-explain-video]"); await p.waitForSelector("[data-explain-pause]");
  ok(/\/explain\/media\/3\/clip\.mp4$/.test(await p.$eval("[data-explain-video]", (e) => e.getAttribute("src"))), "a video is shown in Studio's own player");
  await p.click("[data-explain-pause]"); await p.waitForSelector('[data-explain-scope="frame"]');
  onAsk = (r) => answer(r, X);
  await p.fill("[data-explain-q]", "What is this step?"); await p.click("[data-explain-send]"); await p.waitForTimeout(300);
  ok(posts.at(-1)[0] === "ask" && posts.at(-1)[1].version === 3 && posts.at(-1)[1].selection?.time === 0 && !posts.at(-1)[1].confirm, "paused at a frame, the follow-up sends its time (and needs no confirmation once agreed)", JSON.stringify(posts.at(-1)[1]));

  // ---------- back to the tutor: the board as before ----------
  onSelect = (r) => { X = { ...X, selected: null }; answer(r, X); };
  await p.click("[data-explain-tutor]"); await p.waitForSelector("[data-board]"); await p.waitForTimeout(100);
  ok(posts.at(-1)[0] === "select" && posts.at(-1)[1].skill === null && (await p.$eval("[data-explain-picker]", (e) => e.dataset.explainPicker)) === "tutor" && (await p.$eval("[data-x-layer]", (e) => e.hidden)), "picking the tutor again brings the board back; the output's layer is gone");
  ok(!errors.length, "no page error", errors.join(" | "));
  await ctx.close();
} catch (e) { fail++; console.log("  FAIL  the run stopped:", e?.stack || e); console.log(appLog.slice(-3000)); }
finally { await browser.close(); app.kill(); }
console.log(`\nreview-room-explain-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
