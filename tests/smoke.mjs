import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Smoke tests for Crew Studio. They run against a temporary COPY of
// tests/fixture/state and a mock board, so no live state is read or written
// and no real card is ever answered.   node tests/smoke.mjs
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("smoke: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session

const tmp = mkdtempSync(join(tmpdir(), "crew-studio-"));
const state = join(tmp, "state");
cpSync(join(here, "fixture/state"), state, { recursive: true });
// one crew round is alive: point its pid at this test process
const runs = readdirSync(join(state, "runs"));
const liveActor = runs.find((r) => r.startsWith("worker-")) ?? runs[0];
writeFileSync(join(state, "runs", liveActor, "process.json"), JSON.stringify({ actor: liveActor, pid: process.pid }));
// Studio's own data dir: the fixture artifacts, with a one-second clip in an allowed folder
const data = join(tmp, "data"), films = join(tmp, "films");
mkdirSync(data); mkdirSync(films);
execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x180:rate=10", "-pix_fmt", "yuv420p", join(films, "clip.mp4")]);
writeFileSync(join(data, "artifacts.json"), readFileSync(join(here, "fixture/data/artifacts.json"), "utf8").replace("__CLIP__", join(films, "clip.mp4")));
const secret = "ab".repeat(32);
writeFileSync(join(tmp, "board.secret"), secret + "\n");

// mock board: records what POST /decisions receives
const received = [];
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ path: req.url, method: req.method, auth: req.headers.authorization, origin: req.headers.origin, type: req.headers["content-type"], body: body ? JSON.parse(body) : null });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, decision: { id: received.at(-1).body?.id } }));
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;

// M2.5: a temporary HOME with one claude session for a temporary project; stub host CLIs; a fake tailnet name
const home = join(tmp, "home"), proj = join(tmp, "proj");
mkdirSync(proj, { recursive: true });
const pdir = join(home, ".claude/projects", proj.replace(/[^a-zA-Z0-9]/g, "-"));
mkdirSync(pdir, { recursive: true });
writeFileSync(join(pdir, "sess-ui.jsonl"), JSON.stringify({ type: "user", isSidechain: false, cwd: proj, message: { role: "user", content: "Studio test session" } }) + "\n");
{ const t = (Date.now() - 3_600_000) / 1000; (await import("node:fs")).utimesSync(join(pdir, "sess-ui.jsonl"), t, t); }
const TAILNET = "phone-test.tailnet.ts.net";
const tsServe = () => { try { return execFileSync("tailscale", ["serve", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return String(e.stdout ?? "") + String(e.stderr ?? ""); } };
const tsBefore = tsServe();
const port = await freePort();
const lanPort = await freePort();
// out of the box: no GitHub token, gh or API keys from this machine leak in; installs are mocked and real ones refused
const baseEnv = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_COMPAT_BASE_URL"]) delete baseEnv[k];
Object.assign(baseEnv, { CREW_GH_NO_CLI: "1", CREW_KEYCHAIN_TOOL: "none", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  CREW_LAN_IP: "127.0.0.1", CREW_LAN_PORT: String(lanPort) });
const app = spawn("bun", ["src/server.ts"], { cwd: root, env: { ...baseEnv, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_BOARD_URL: mockUrl,
  CREW_BOARD_SECRET: join(tmp, "board.secret"), CREW_GH: "0", CREW_READONLY: "0", CREW_RECENT_DAYS: "3650",
  CREW_DATA: data, CREW_FILE_ALLOW: films, CREW_GH_FIXTURE: join(here, "fixture/github"), CREW_CHAT_PROVIDER: "stub", CREW_CHAT_TIMEOUT_MS: "3000",
  HOME: home, CREW_MAIN_PROJECT: proj, CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"),
  CREW_TAILNET_NAME: TAILNET, CREW_PERMISSION_TIMEOUT_MS: "60000", CREW_WAKE_GRACE_MS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
let appLog = "";
app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { if (cond) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const page = async (width, scheme) => {
  const p = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
  // phone pairing is a lab (backbone sidebar); the first-project guide (public/onboarding.js) is covered by
  // the onboarding suites and would otherwise overlay the chat button on a phone
  await p.addInitScript(() => { try { localStorage.setItem("crew.labs", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
  p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${width}/${scheme}: ${m.text()}`); });
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = join(root, "tests/out");

try {
  const flow = (await (await fetch(base + "/api/flow")).json());
  // every page renders at both widths in both themes, with no console error and no sideways scroll
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    for (const [view, sel] of [["board", "[data-task]"], ["inbox", "[data-inbox-row]"], ["crew", ".tk-round"], ["activity", "#evlist .ev"], ["workflow", "svg.graph .gn"],
      ["intents", ".ilist"], ["library", "[data-pr]"], ["task/T-304", "[data-lineage]"], ["event/0", ".ev.hl"]]) {
      await p.goto(`${base}/#/${view}`);
      const found = await p.waitForSelector(sel, { timeout: 8000 }).then(() => true).catch(() => false);
      ok(found, `${view} renders at ${width} ${scheme}`);
      ok(await noHScroll(p), `${view} has no sideways scroll at ${width} ${scheme}`);
      await p.screenshot({ path: join(shots, `smoke-${view.replace("/", "_")}-${width}-${scheme}.png`) });
    }
    if (width === 1440 && scheme === "light") {
      await p.goto(`${base}/#/workflow`); await p.waitForSelector("svg.graph .gn");
      ok((await p.locator("svg.graph .gn").count()) === flow.nodes.length, "workflow draws one box per node in code.flow.yaml");
      await p.goto(`${base}/#/crew`);
      ok(await p.locator(`[data-actor="${liveActor}"].is-live`).count() === 1, "the live crew round shows live");
      ok((await p.locator(`[data-actor="${liveActor}"] .term .tl`).count()) > 0, "the live crew row shows readable log lines");
      await p.goto(`${base}/#/crew/${encodeURIComponent(liveActor)}`);
      // the round's detail: its log is the Transcript tab (the Prompt tab opens first)
      await p.waitForSelector(".tr-tabs", { timeout: 8000 }).catch(() => {});
      await p.click('[data-tab="transcript"]').catch(() => {});
      ok(await p.waitForSelector("#trList [data-entry]", { timeout: 8000 }).then(() => true).catch(() => false), "crew focus view shows the log");
      // sidebar collapse is remembered
      await p.goto(`${base}/#/board`);
      await p.click("#sideTog");
      await p.reload(); await p.waitForSelector("[data-task]");
      ok(await p.evaluate(() => document.body.classList.contains("side-collapsed")), "collapsed sidebar is remembered after reload");
      await p.click("#sideTog");
    }
    await p.close();
  }

  // live updates: an appended event shows on the activity page without a reload
  const p = await page(1440, "light");
  await p.goto(`${base}/#/activity`);
  await p.waitForSelector("#evlist .ev");
  const marker = `smoke event ${Date.now()}`;
  appendFileSync(join(state, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), actor: "firstmate", type: "crew_status", task: "T-999", summary: { en: marker, "zh-TW": marker } }) + "\n");
  ok(await p.waitForSelector(`text=${marker}`, { timeout: 6000 }).then(() => true).catch(() => false), "an appended event appears live on the activity page");
  await p.goto(`${base}/#/board`);
  await p.waitForSelector("[data-task]");
  await p.waitForTimeout(1500);
  ok(await p.locator('[data-task="T-999"]').count() === 0 && await p.locator("[data-task]").count() > 0, "an idle task (no crew, no card) stays off the Board, which lists the runs in flight (docs/units/board.md)");

  // a new pending card appears live in the inbox
  await p.goto(`${base}/#/inbox`);
  await p.waitForSelector("[data-inbox-row]");
  // the Inbox lists every card and shows one at a time (unit inbox-focus): count its rows
  const before = await p.locator("[data-inbox-row]").count();
  const src = readdirSync(join(state, "pending")).find((f) => f !== "D-fixture-door-check.json");
  const card = JSON.parse(readFileSync(join(state, "pending", src), "utf8"));
  writeFileSync(join(state, "pending", "D-fixture-live.json"), JSON.stringify({ ...card, id: "D-fixture-live" }));
  ok(await p.waitForFunction((n) => document.querySelectorAll("[data-inbox-row]").length === n + 1, before, { timeout: 6000 }).then(() => true).catch(() => false), "a new pending card appears live");

  // answering: pick A, confirm, and the board receives the card id, A, the secret and its own origin
  await p.goto(`${base}/#/inbox/D-fixture-live`); await p.waitForSelector('[data-card="D-fixture-live"]');
  const c = p.locator('[data-card="D-fixture-live"]');
  await c.locator('.opt:has(.letter:text-is("A"))').click();
  await c.locator(".actions button.primary").click(); // sent from the card itself: no dialog
  await p.waitForTimeout(800);
  const post = received.find((r) => r.body?.id === "D-fixture-live");
  ok(!!post && post.path === "/decisions" && post.method === "POST", "the answer goes to the board's POST /decisions");
  ok(post?.auth === `Bearer ${secret}`, "the answer carries the board secret as a Bearer token");
  ok(post?.origin === mockUrl, "the answer carries the board's own Origin");
  ok(post?.body?.chosen === "A" && /^application\/json/.test(post?.type ?? ""), "the answer is JSON with chosen A");
  const qn = card.details?.en?.questions?.length;
  ok(!qn || (Array.isArray(post?.body?.answers) && post.body.answers.length === qn && post.body.answers.every((a, i) => a.index === i && a.ok === true)),
    "every card question is answered yes by default");

  // a board-only card cannot be answered here, and the server refuses it too
  await p.goto(`${base}/#/inbox/D-fixture-door-check`); await p.waitForSelector('[data-card="D-fixture-door-check"]');
  const bo = p.locator('[data-card="D-fixture-door-check"]');
  ok((await bo.locator(".banner").count()) === 0 && (await bo.locator(".opt[disabled]").count()) === 0, "a card with a check is answered in Studio too (the door confirmation is only needed for a one-way merge)");
  // the one-way door confirmation is covered end to end in tests/takeover-ui.mjs
  // a board-only card (a retro takes one answer per item): the server refuses it and sends nothing
  writeFileSync(join(state, "pending", "D-smoke-retro.json"), JSON.stringify({ id: "D-smoke-retro", purpose: "retro", kind: "choice", title: "Retro", details: { en: { title: "Retro", options: { A: { description: "ok" } } } } }));
  await new Promise((r) => setTimeout(r, 1500));
  const rr = await fetch(base + "/api/answer", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ id: "D-smoke-retro", chosen: "A" }) });
  ok(rr.status === 409 && (await rr.json()).code === "useBoard" && !received.some((x) => x.body?.id === "D-smoke-retro"), "the server refuses a board-only (retro) card and sends nothing");
  const r2 = await fetch(base + "/api/answer", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ id: "D-not-pending", chosen: "A" }) });
  ok(r2.status === 404, "the server refuses a card that is not pending");
  await p.close();


  // ---------- M2: chat, intents, library ----------
  // Since acc5b89 the chat panel is the one primary Firstmate conversation (public/m25.js:
  // chatMode is always "main"); the read-only status agent has no panel of its own any more.
  // Its server side (/api/chat, the question-token tools, intent capture) is still served,
  // so it is checked here through the API, and the panel through what it shows now.
  const stateSig = () => { const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [`${join(d, e.name)}:${statSync(join(d, e.name)).size}`]); return walk(state).sort().join("\n"); };
  const before2 = stateSig();
  ok((await fetch(base + "/api/tools")).status === 403 && (await fetch(base + "/api/tools/runs_list", { method: "POST", body: "{}" })).status === 403, "chat tools refuse a call without a question token");
  const chatApi = async (message) => {
    const r = await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ message }) });
    return (await r.text()).split("\n\n").map((b) => /^data: (.*)$/m.exec(b)?.[1]).filter(Boolean).map((d) => JSON.parse(d));
  };
  {
    const ev = await chatApi("How is it going?");
    const done = ev.find((e) => e.type === "done");
    ok(ev[0]?.type === "start" && ev[0].provider === "stub" && ev.some((e) => e.type === "text") && !!done, "the status agent streams an answer (start, text, done)", JSON.stringify(ev.map((e) => e.type)));
    const tools = ev.filter((e) => e.type === "tool"), results = ev.filter((e) => e.type === "toolResult");
    ok(tools.length === 2 && /runs\.list/.test(tools[0].name) && typeof results[0]?.rows === "number", "each lookup is reported with the tool name and its row count", JSON.stringify(tools));
    ok(/\(#\/task\/T-\d+\)/.test(done?.text ?? ""), "the answer links back to the task page", done?.text);
    const ie = (await chatApi("STUB_INTENT please")).find((e) => e.type === "intent");
    ok(ie?.intent?.id === "I-001", "a captured intent is streamed as an intent event");
    const rec = readFileSync(join(data, "intents.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
    ok(rec?.id === "I-001" && rec.status === "received" && rec.goal === "Add a dark mode to the docs site", "intent.capture appends to Studio's intents.jsonl");
    for (const [msg, code, label] of [["STUB_LOGIN", "notLoggedIn", "a logged-out provider"], ["STUB_TIMEOUT", "timeout", "a question past its time limit"]]) {
      const er = (await chatApi(msg)).find((e) => e.type === "error");
      ok(er?.code === code, `${label} ends with a clear ${code} error`, JSON.stringify(er));
    }
    const s1 = await (await fetch(base + "/api/settings", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ provider: "codex" }) })).json();
    ok(s1.provider === "codex" && (await (await fetch(base + "/api/settings")).json()).provider === "codex", "the status agent's provider is a setting");
    const s2 = await (await fetch(base + "/api/settings", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ provider: "claude", model: "bad name!" }) })).json();
    ok(!!s2.error, "settings refuse a malformed model name");
    await fetch(base + "/api/settings", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ provider: "stub" }) });
  }
  for (const [width, scheme] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
    const q = await page(width, scheme);
    await q.goto(`${base}/#/board`); await q.waitForSelector("[data-task]");
    if (width < 1100) { ok(await q.locator("#chatFab").isVisible(), `chat opens from a button on a phone (${width} ${scheme})`); await q.click("#chatFab"); }
    ok(await q.locator("#chatIn").isVisible(), `the chat panel is on screen at ${width} ${scheme}`);
    ok(await q.waitForFunction(() => { const t = document.querySelector("#chatSub")?.textContent ?? ""; return t && t !== "…"; }, null, { timeout: 6000 }).then(() => true).catch(() => false), `the chat header says where the Firstmate conversation stands at ${width} ${scheme}`);
    ok(await q.locator("#chatClear").isHidden() && await q.locator("#chatProv").isHidden(), `the primary conversation offers no clear button and no status-provider picker at ${width} ${scheme}`);
    if (width === 1440 && scheme === "light") {
      // the Intents page, a linked task and the Library
      await q.goto(`${base}/#/intents`);
      ok(await q.waitForSelector('[data-intent-row="I-001"] [data-step="received"]', { timeout: 6000 }).then(() => true).catch(() => false), "the Intents page lists the intent at Received");
      // firstmate links the intent to a task; the trail follows that task's events to its merge
      appendFileSync(join(data, "intent-links.jsonl"), JSON.stringify({ intent: "I-001", task: "T-304", by: "firstmate" }) + "\n");
      ok(await q.waitForSelector('[data-intent-row="I-001"] .s.fin[data-step="merged"]', { timeout: 6000 }).then(() => true).catch(() => false), "a linked intent advances along its task's events to Merged, live");
      await q.goto(`${base}/#/intents/I-001`);
      ok(await q.waitForSelector('[data-lineage="T-304"]', { timeout: 6000 }).then(() => true).catch(() => false), "the intent page shows its task's lineage");
      // the library: lineage from the event log, CI and the commit from GitHub, and a video that plays
      await q.goto(`${base}/#/library`);
      await q.waitForSelector('[data-pr="287"]');
      const lin = await q.locator('[data-pr="287"] .lineage').textContent();
      ok(/T304-1/.test(lin) && /T304-2/.test(lin) && /19 passed/.test(lin) && /8acb6357/.test(lin), "a merged PR shows dispatch card, rounds, CI, merge card and commit", lin);
      ok(await q.waitForFunction(() => document.querySelector('[data-file="A-clip"] video')?.readyState >= 1, null, { timeout: 8000 }).then(() => true).catch(() => false), "the video file loads in the Library");
      ok((await q.locator('[data-file="A-outside"] video').count()) === 0 && (await fetch(base + "/files/A-outside")).status === 404, "a file outside the allowed folder is not served");
      const rng = await fetch(base + "/files/A-clip", { headers: { range: "bytes=0-99" } });
      ok(rng.status === 206 && (await rng.arrayBuffer()).byteLength === 100, "video files are served with byte ranges");
      await q.locator('[data-filter="video"]').click();
      ok((await q.locator("[data-pr]").count()) === 0 && (await q.locator("[data-file]").count()) === 2, "the type filter narrows the Library");
      await q.locator('[data-filter="all"]').first().click();
    }
    ok(await noHScroll(q), `no sideways scroll with the chat open at ${width} ${scheme}`);
    await q.screenshot({ path: join(shots, `smoke-chat-${width}-${scheme}.png`) });
    await q.close();
  }
  ok(stateSig() === before2, "the chat, intents and library wrote nothing into firstmate state");

  // ---------- M2.5: phones, the drive gate, the main session ----------
  const raw = (method, path, { host = `127.0.0.1:${port}`, token, body } = {}) => new Promise((resolve) => {
    const data = body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body);
    const r = httpRequest({ host: "127.0.0.1", port, method, path, headers: { host, ...(token ? { authorization: `Bearer ${token}` } : { "x-crew-session": process.env.CREW_SESSION_TOKEN }), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, body: j, text: t }); });
    });
    r.on("error", (e) => resolve({ status: 0, body: null, text: String(e) })); if (data) r.write(data); r.end();
  });
  ok((await raw("GET", "/api/summary", { host: "evil.example" })).status === 421, "an unknown Host is refused (421)");
  ok((await raw("GET", "/api/summary", { host: TAILNET })).body?.code === "pair", "the tailnet name without a token is told to pair");
  ok(/<title>Crew Studio<\/title>/.test((await raw("GET", "/", { host: TAILNET })).text), "an unpaired phone can load the page, to pair");
  ok((await raw("POST", "/api/remote/pair/start", { host: TAILNET })).status === 401, "a phone cannot start pairing");
  const code = (await raw("POST", "/api/remote/pair/start")).body.code;
  ok((await raw("POST", "/api/remote/pair", { host: TAILNET, body: { code: code === "000000" ? "111111" : "000000", name: "Pixel" } })).status === 401, "a wrong code is refused");
  const paired = await raw("POST", "/api/remote/pair", { host: TAILNET, body: { code, name: "Pixel" } });
  const ptok = paired.body?.token;
  ok(paired.status === 200 && ptok && !readFileSync(join(data, "remote-devices.json"), "utf8").includes(ptok), "the right code pairs the phone; the token itself is not stored");
  ok((await raw("GET", "/api/remote/me", { host: TAILNET, token: ptok })).body?.kind === "phone", "the phone is recognised by its token");
  ok((await raw("GET", "/api/summary", { host: TAILNET, token: ptok })).status === 200, "a paired phone can read");
  ok((await raw("POST", "/api/main/send", { host: TAILNET, token: ptok, body: { text: "hi" } })).body?.code === "noDrive", "driving is refused until it is allowed on the Mac");
  ok((await raw("POST", "/api/answer", { host: TAILNET, token: ptok, body: { id: "x", chosen: "A" } })).body?.code === "noDrive", "answering a card from the phone also needs the drive setting");
  ok((await raw("POST", "/api/main/locale", { host: TAILNET, token: ptok, body: { locale: "zh-CN" } })).body?.code === "noDrive" && !(existsSync(join(data, "board-language.json")) && readFileSync(join(data, "board-language.json"), "utf8").includes("zh-CN")), "changing the Board language Firstmate greets in also needs the drive setting");
  ok((await raw("POST", "/api/main/interrupt", { host: TAILNET, token: ptok })).status === 200, "a phone may always interrupt");
  ok((await raw("POST", "/api/remote/settings", { host: TAILNET, token: ptok, body: { allowDrive: true } })).body?.code === "desktopOnly", "a phone cannot allow itself to drive");
  ok((await raw("POST", "/api/remote/settings", { body: { allowDrive: true } })).body?.allowDrive === true, "the Mac allows phone driving");
  ok((await raw("POST", "/api/main/send", { host: TAILNET, token: ptok, body: { text: "hi" } })).body?.code === "detached", "with driving allowed, the phone's send passes the gate (nothing attached yet)");
  // revoking cuts the phone's live stream
  const streamCut = new Promise((resolve) => {
    const r = httpRequest({ host: "127.0.0.1", port, path: `/api/stream?token=${ptok}`, headers: { host: TAILNET } }, (res) => { let got = false; res.on("data", () => { got = true; }); res.on("end", () => resolve(got)); res.on("close", () => resolve(got)); });
    r.on("error", () => resolve(false)); r.end();
  });
  await new Promise((r) => setTimeout(r, 500));
  const dev = (await raw("GET", "/api/remote")).body.devices[0];
  await raw("POST", "/api/remote/revoke", { body: { id: dev.id } });
  ok(await Promise.race([streamCut, new Promise((r) => setTimeout(() => r("timeout"), 4000))]) === true, "revoking the phone ends its open stream");
  ok((await raw("GET", "/api/summary", { host: TAILNET, token: ptok })).status === 401, "a revoked phone's token is refused");
  // tailscale: the build only records the command
  const tsr = await raw("POST", "/api/remote/tailscale", { body: { action: "enable", confirm: true } });
  ok(tsr.body?.live === false && tsr.body?.ran === `tailscale serve --bg --https=8443 http://127.0.0.1:${port}` && /stub/.test(tsr.body?.out), "Enable phone access runs the stub, naming the exact command");
  ok((await raw("POST", "/api/remote/tailscale", { body: { action: "enable" } })).status === 400, "enabling needs an explicit confirm");
  ok((await raw("POST", "/api/remote/tailscale", { body: { action: "disable", confirm: true } })).body?.ran === "tailscale serve --https=8443 off", "turning it off names `tailscale serve --https=8443 off` (stub)");
  ok(tsServe() === tsBefore, "Tailscale serve state is unchanged by the tests");

  // the main session through the UI: attach, talk, approve a tool, a wake, hand back.
  // Since acc5b89 the chat is always the primary Firstmate conversation (no mode switch) and the
  // chat no longer has its own Attach button: an existing session is attached from the Take over
  // page (covered by tests/takeover-ui.mjs). Here the session is attached through the same API.
  {
    const q = await page(1440, "light");
    await q.goto(`${base}/#/board`); await q.waitForSelector("[data-task]");
    ok(await q.waitForSelector('[data-banner="detached"]', { timeout: 5000 }).then(() => true).catch(() => false), "the Firstmate chat shows that no session is attached");
    ok(/Connect your account to begin/.test(await q.locator("#chatSub").textContent()) && await q.locator("#chatSend").isDisabled(), "the header says to connect first and sending is off");
    const sessions = (await raw("GET", "/api/main/sessions?host=claude")).body?.sessions ?? [];
    ok(sessions.some((x) => x.id === "sess-ui"), "the project's terminal session is listed for attaching");
    // the attach happens outside this page: it shows only through the live stream, so the page must be on it first
    await q.waitForFunction(() => S.conn === "live", null, { timeout: 8000 });
    const att = await raw("POST", "/api/main/attach", { body: { host: "claude", id: "sess-ui" } });
    ok(att.body?.ok === true, "attaching the session succeeds", JSON.stringify(att.body));
    ok(await q.waitForSelector('[data-banner="attached"]', { timeout: 8000 }).then(() => true).catch(() => false), "attaching shows Studio as the driver");
    ok(JSON.parse(readFileSync(join(data, "driver.json"), "utf8")).holder === "studio", "the driver lock says studio");
    ok(/main session · claude/.test(await q.locator("#chatSub").textContent()), "the header names the main session and host");
    await q.fill("#chatIn", "hello main"); await q.press("#chatIn", "Enter");
    ok(await q.waitForSelector('[data-main="firstmate"] .bub:text("echo: hello main")', { timeout: 8000 }).then(() => true).catch(() => false), "a message reaches the main session and its reply appears");
    await q.fill("#chatIn", "STUB_TOOL"); await q.press("#chatIn", "Enter");
    ok(await q.waitForSelector("[data-approval]", { timeout: 8000 }).then(() => true).catch(() => false), "a tool permission request shows as an approval card");
    ok(await q.locator("#apprBar").isVisible(), "a bar flags the request on every page");
    ok(/ls -la/.test(await q.locator("[data-approval] code").textContent()), "the card names the tool input");
    await q.locator("[data-approval] .btn.primary").click();
    ok(await q.waitForSelector('[data-main="firstmate"] .bub:text("Ran ls.")', { timeout: 8000 }).then(() => true).catch(() => false), "allowing lets the tool run");
    mkdirSync(join(state, "session"), { recursive: true });
    appendFileSync(join(state, "session", "wake.jsonl"), JSON.stringify({ reason: "verdict", line: "review: T-777 APPROVE abc1234 #300" }) + "\n");
    ok(await q.waitForSelector('[data-main="wake"]:has-text("review: T-777 APPROVE")', { timeout: 8000 }).then(() => true).catch(() => false), "a firstmate wake is delivered into the session as its own turn");
    await q.screenshot({ path: join(shots, "smoke-main-1440-light.png") });
    await q.locator('[data-banner="attached"] .btn', { hasText: "Hand back" }).click();
    ok(await q.waitForSelector("#resumeCmd", { timeout: 6000 }).then(() => true).catch(() => false) && (await q.locator("#resumeCmd").textContent()) === "claude --resume sess-ui", "handing back shows the terminal resume command");
    const drv = JSON.parse(readFileSync(join(data, "driver.json"), "utf8"));
    ok(drv.holder === "terminal" && drv.resume === "claude --resume sess-ui", "the driver lock goes back to the terminal");
    await q.close();
  }
  // the Phone page renders everywhere
  for (const [width, scheme] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
    const q = await page(width, scheme);
    await q.goto(`${base}/#/remote`);
    ok(await q.waitForSelector('[data-section="pair"]', { timeout: 6000 }).then(() => true).catch(() => false), `the Phone page renders at ${width} ${scheme}`);
    if (width === 1440 && scheme === "light") {
      await q.click("#startPair");
      ok(await q.waitForSelector("[data-code]", { timeout: 4000 }).then(() => true).catch(() => false) && /^\d{6}$/.test(await q.locator("[data-code]").textContent()), "the Mac shows a 6-digit code");
      ok((await q.locator("[data-pair] svg").count()) === 1, "with a QR code");
      await q.click("#enablePhone");
      ok(/tailscale serve --bg --https=8443 http:\/\/127\.0\.0\.1:\d+/.test(await q.locator("[data-cmd]").textContent()), "Enable phone access shows the exact command before running anything");
      await q.locator(".modal .btn", { hasText: "Cancel" }).click();
    }
    ok(await noHScroll(q), `the Phone page has no sideways scroll at ${width} ${scheme}`);
    await q.screenshot({ path: join(shots, `smoke-remote-${width}-${scheme}.png`) });
    await q.close();
  }
  // ---------- out of the box ----------
  // no network: every request that leaves this machine is blocked, and the pages still work
  {
    const q = await page(1440, "light");
    const blocked = [];
    await q.route("**/*", (r) => { const u = new URL(r.request().url()); if (["127.0.0.1", "localhost"].includes(u.hostname)) return r.continue(); blocked.push(u.href); return r.abort(); });
    for (const [view, sel] of [["board", "[data-task]"], ["doctor", "[data-item]"], ["remote", '[data-section="pair"]'], ["library", "[data-pr]"]]) {
      await q.goto(`${base}/#/${view}`);
      ok(await q.waitForSelector(sel, { timeout: 8000 }).then(() => true).catch(() => false), `${view} works with the network blocked`);
    }
    ok(await q.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => f.family.replace(/"/g, "") === "IBM Plex Sans" && f.status === "loaded"); }), "IBM Plex loads from Studio itself");
    ok(blocked.length === 0, "the UI makes no request off this machine", JSON.stringify(blocked.slice(0, 5)));
    await q.close();
  }
  // the Doctor: every width and theme, then one-click installs through the mocked runner
  for (const [width, scheme] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
    const q = await page(width, scheme);
    await q.goto(`${base}/#/doctor`);
    ok(await q.waitForSelector('[data-item="claude"][data-status="missing"] [data-install="claude"]', { timeout: 8000 }).then(() => true).catch(() => false), `Doctor renders at ${width} ${scheme}, claude missing with Install`);
    ok(await noHScroll(q), `Doctor has no sideways scroll at ${width} ${scheme}`);
    await q.screenshot({ path: join(shots, `smoke-doctor-${width}-${scheme}.png`), fullPage: true });
    await q.close();
  }
  {
    const jobsBefore = (await (await fetch(base + "/api/doctor")).json()).jobs.length;
    const noConfirm = await fetch(base + "/api/doctor/install", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ item: "claude", method: "npm" }) });
    const nc = await noConfirm.json();
    ok(noConfirm.status === 400 && /npm install -g @anthropic-ai\/claude-code/.test(nc.command) && nc.source && nc.location, "an install without confirmation only returns the command, source and location");
    ok((await (await fetch(base + "/api/doctor")).json()).jobs.length === jobsBefore, "and runs nothing");
    const q = await page(1440, "light");
    let doctorGets = 0;
    q.on("request", (r) => { if (new URL(r.url()).pathname === "/api/doctor") doctorGets++; });
    await q.goto(`${base}/#/doctor`);
    await q.click('[data-item="claude"] [data-install="claude"]');
    ok(await q.waitForSelector(".modal #installDetail [data-cmd]", { timeout: 4000 }).then(() => true).catch(() => false), "Install first shows a confirmation");
    const shown = await q.locator(".modal [data-cmd]").textContent();
    ok(/claude/.test(shown) && /(claude\.ai\/install\.sh|npm install -g @anthropic-ai\/claude-code|brew install --cask claude-code)/.test(shown), "it shows the exact official command", shown);
    ok(/https:\/\//.test(await q.locator(".modal #installDetail").textContent()), "with its source URL and install location");
    await q.screenshot({ path: join(shots, "smoke-doctor-confirm-1440-light.png") });
    await q.locator(".modal .btn.primary").click();
    ok(await q.waitForSelector('[data-job="running"] #installLog', { timeout: 4000 }).then(() => true).catch(() => false), "the install runs with its log on the page");
    ok(await q.waitForFunction(() => /downloading/.test(document.querySelector("#installLog")?.textContent ?? ""), null, { timeout: 4000 }).then(() => true).catch(() => false), "log lines stream in");
    const before = doctorGets;
    ok(await q.waitForSelector('[data-job="done"]', { timeout: 8000 }).then(() => true).catch(() => false), "the install finishes");
    await q.waitForTimeout(600);
    ok(doctorGets > before, "detection runs again after the install");
    ok(/\(mock\) would run: /.test(await q.locator("#installLog").textContent()), "the mocked runner only records the command");
    await q.locator('[data-job="done"] .btn', { hasText: "Close" }).click();
    // cancel
    await q.click('[data-item="claude"] [data-install="claude"]'); await q.locator(".modal .btn.primary").click();
    await q.waitForSelector("#installCancel", { timeout: 4000 }); await q.click("#installCancel");
    ok(await q.waitForSelector('[data-job="cancelled"]', { timeout: 6000 }).then(() => true).catch(() => false), "Cancel stops the install and says so");
    await q.locator('[data-job="cancelled"] .btn', { hasText: "Close" }).click();
    // failure
    await fetch(base + "/api/doctor/mock", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ fail: true }) });
    await q.click('[data-item="claude"] [data-install="claude"]'); await q.locator(".modal .btn.primary").click();
    ok(await q.waitForSelector('[data-job="failed"]', { timeout: 8000 }).then(() => true).catch(() => false), "a failed install shows Failed");
    ok(/mock installer failed/.test(await q.locator("#installLog").textContent()), "with the installer's own error in the log");
    await q.screenshot({ path: join(shots, "smoke-doctor-failed-1440-light.png") });
    await fetch(base + "/api/doctor/mock", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ fail: false }) });
    const dj = (await (await fetch(base + "/api/doctor")).json());
    ok(dj.installer === "mock" && dj.jobs.length >= 3 && dj.jobs.every((j) => !j.lines.length || j.lines[0].startsWith("(mock) would run")), "no real install ran");
    await q.close();
  }
  // LAN mode: built in, off by default, a second listener only while on, always treated as a phone
  {
    const lanBase = `http://127.0.0.1:${lanPort}`;
    const r0 = await (await fetch(base + "/api/remote")).json();
    ok(r0.lan && r0.lan.on === false && r0.lan.url === `http://127.0.0.1:${lanPort}/remote/`, "LAN mode is off by default and shows its URL");
    ok(await fetch(lanBase + "/api/summary").then(() => false).catch(() => true), "nothing listens on the LAN address while off");
    const nc = await fetch(base + "/api/remote/lan", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ enable: true }) });
    ok(nc.status === 400, "turning it on needs confirmation");
    const q = await page(1440, "light");
    await q.goto(`${base}/#/remote`);
    ok(await q.waitForSelector('[data-section="lan"] [data-lan="off"]', { timeout: 6000 }).then(() => true).catch(() => false), "the Phone page shows LAN mode off");
    ok(/plain HTTP/.test(await q.locator('[data-section="lan"]').textContent()), "and says plainly that it is HTTP on the local network");
    await q.click("#lanToggle"); await q.locator(".modal .btn.primary").click();
    ok(await q.waitForSelector('[data-section="lan"] [data-lan="on"]', { timeout: 6000 }).then(() => true).catch(() => false), "after confirming, LAN mode is on");
    await q.screenshot({ path: join(shots, "smoke-remote-lan-1440-light.png") });
    const raw = (path, host, token) => new Promise((resolve) => {
      const rq = httpRequest({ host: "127.0.0.1", port: lanPort, path, method: "GET", headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b })); });
      rq.on("error", () => resolve({ status: 0, body: "" })); rq.end();
    });
    const lanHost = `127.0.0.1:${lanPort}`;
    ok((await raw("/api/summary", `127.0.0.1:${port}`)).status === 421, "on the LAN listener a loopback Host is refused (a phone cannot pose as the Mac)");
    ok((await raw("/api/summary", lanHost)).status === 401, "an unpaired phone on the LAN gets nothing");
    ok((await raw("/remote/", lanHost)).status === 200, "but can load the page to pair");
    const code = (await (await fetch(base + "/api/remote/pair/start", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: "{}" })).json());
    ok(code.url === `http://127.0.0.1:${lanPort}/remote/?pair=${code.code}`, "the pairing link points at the LAN URL");
    const paired = await new Promise((resolve) => { const rq = httpRequest({ host: "127.0.0.1", port: lanPort, path: "/api/remote/pair", method: "POST", headers: { host: lanHost, "content-type": "application/json" } },
      (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(JSON.parse(b))); }); rq.end(JSON.stringify({ code: code.code, name: "lan-phone" })); });
    ok(!!paired.token, "a phone pairs over the LAN");
    ok((await raw("/api/summary", lanHost, paired.token)).status === 200, "the paired phone reads over the LAN");
    const desk = await new Promise((resolve) => { const rq = httpRequest({ host: "127.0.0.1", port: lanPort, path: "/api/remote/lan", method: "POST", headers: { host: lanHost, authorization: `Bearer ${paired.token}`, "content-type": "application/json" } },
      (res) => resolve(res.statusCode)); rq.end(JSON.stringify({ enable: false })); });
    ok(desk === 403, "a phone cannot change LAN mode (Mac only)");
    await q.click("#lanToggle");
    ok(await q.waitForSelector('[data-section="lan"] [data-lan="off"]', { timeout: 6000 }).then(() => true).catch(() => false), "turning LAN mode off");
    await new Promise((r) => setTimeout(r, 300));
    ok(await fetch(lanBase + "/remote/").then(() => false).catch(() => true), "closes the LAN listener");
    await q.close();
  }
  ok(errors.length === 0, "no console errors", JSON.stringify(errors.slice(0, 5)));
  // No repository configured: native startup leaves GitHub disabled, not disconnected.
  {
    const offEnv={...baseEnv};for(const k of ["CREW_GH","CREW_GH_REPO","CREW_GH_FIXTURE"])delete offEnv[k];
    const offPort=await freePort(),offBase=`http://127.0.0.1:${offPort}`;
    const offApp=spawn("bun",["src/server.ts"],{cwd:root,env:{...offEnv,HOME:home,CREW_MAIN_PROJECT:proj,CREW_DATA:join(tmp,"data-off"),CREW_FM_STATE:state,CREW_PORT:String(offPort),CREW_GITHUB_API:"http://127.0.0.1:9"},stdio:"ignore"});
    try {
      await waitUp(offBase,offApp);
      const gs=await(await fetch(offBase+"/api/github")).json();
      ok(!gs.enabled&&!gs.connected,"no repository configured: GitHub stays disabled by default");
      const doctor=await(await fetch(offBase+"/api/doctor")).json();
      ok(doctor.items.find(i=>i.id==="github")?.status==="info","disabled GitHub is optional in Doctor, not a disconnected dependency");
    }finally{offApp.kill();}
  }
  // GitHub not connected: a second Studio with no token anywhere still works and says so
  {
    const port2 = await freePort(), data2 = join(tmp, "data2");
    mkdirSync(data2);
    const app2 = spawn("bun", ["src/server.ts"], { cwd: root, env: { ...baseEnv, CREW_FM_STATE: state, CREW_PORT: String(port2), CREW_DATA: data2, CREW_BOARD_URL: mockUrl,
      CREW_RECENT_DAYS: "3650", CREW_CHAT_PROVIDER: "stub", HOME: home, CREW_MAIN_PROJECT: proj, CREW_GH: "1", CREW_GH_REPO: "fixture/disconnected", CREW_GH_FIXTURE: "", CREW_GITHUB_API: "http://127.0.0.1:9" }, stdio: "ignore" });
    try {
      const b2 = `http://127.0.0.1:${port2}`;
      for (let i = 0; i < 50; i++) { try { if ((await fetch(b2 + "/api/summary")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
      const gs = await (await fetch(b2 + "/api/github")).json();
      ok(gs.enabled === true && gs.repo === "fixture/disconnected" && gs.connected === false && gs.error === "GitHub not connected", "configured fake repository with no token: GitHub is disconnected", JSON.stringify(gs));
      for (const [width, scheme] of [[1440, "light"], [390, "dark"]]) {
        const q = await page(width, scheme);
        await q.goto(`${b2}/#/board`);
        ok(await q.waitForSelector('[data-gh="disconnected"]', { timeout: 8000 }).then(() => true).catch(() => false), `the board shows GitHub not connected at ${width} ${scheme}`);
        ok(await q.waitForSelector("[data-task]", { timeout: 8000 }).then(() => true, () => false), "and still lists the tasks");
        await q.screenshot({ path: join(shots, `smoke-board-nogh-${width}-${scheme}.png`) });
        if (width === 1440) {
          await q.locator('[data-gh="disconnected"] .btn').click();
          ok(await q.waitForSelector(".modal #ghToken", { timeout: 4000 }).then(() => true).catch(() => false), "Connect opens the token field");
          await q.locator(".modal .btn", { hasText: "Cancel" }).click();
          await q.goto(`${b2}/#/doctor`);
          ok(await q.waitForSelector('[data-item="github"][data-status="degraded"] [data-gh="connect"]', { timeout: 6000 }).then(() => true).catch(() => false), "Doctor lists GitHub as degraded with Connect");
          await q.goto(`${b2}/#/library`);
          ok(await q.waitForSelector('[data-page="library"], .page', { timeout: 6000 }).then(() => true).catch(() => false), "the Library still renders");
        }
        await q.close();
      }
    } finally { app2.kill(); }
  }
  ok(errors.length === 0, "no console errors (out-of-the-box checks)", JSON.stringify(errors.slice(0, 5)));
} finally {
  await browser.close();
  app.kill();
  mock.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(appLog.slice(-2000)); process.exit(1); }
