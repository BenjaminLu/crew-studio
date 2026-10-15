// Transcripts UI: a crew round's Prompt, Transcript and Report tabs (exact
// prompt bytes, the bound brief's round and head, redaction, collapsed tool
// results, live appends), the Firstmate page's session history with older
// turns, an agent node run under Runs, a paired phone getting no raw prompt,
// at 1440 and 390 px in light and dark. Temp fixture only.   node tests/transcripts-ui.mjs
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture, TOKEN, BEARER } from "./transcripts-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("transcripts-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-transcripts-ui-"));
const fx = buildFixture(tmp);
cpSync(join(here, "fixture/state/events.jsonl"), join(fx.state, "events.jsonl"));
// the worker round is live: its pid is this process
writeFileSync(join(fx.state, "runs", fx.actor, "process.json"), JSON.stringify({ actor: fx.actor, pid: process.pid }));
(await import("node:fs")).rmSync(join(fx.state, "runs", fx.actor, "last-result.json"));
// the reviewer round is old: Crew's list (two days) does not hold it, so the page cannot learn its state from that list
{ const old = Date.now() / 1000 - 5 * 86400; (await import("node:fs")).utimesSync(join(fx.state, "runs", fx.leak), old, old); }
// the main session: a project whose claude transcript is the fixture session
const home = join(tmp, "home"), proj = join(tmp, "proj"); mkdirSync(proj);
const pdir = join(home, ".claude/projects", proj.replace(/[^a-zA-Z0-9]/g, "-")); mkdirSync(pdir, { recursive: true });
writeFileSync(join(pdir, "fm-main-1.jsonl"), readFileSync(fx.session));
const TAILNET = "phone-transcripts.tailnet.ts.net";
const port = 5300 + Math.floor(Math.random() * 400), lanPort = port + 700;
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, env: { ...env, CREW_GH_NO_CLI: "1", CREW_GH: "0", CREW_FM_STATE: fx.state, CREW_PORT: String(port), CREW_BOARD_URL: "http://127.0.0.1:9",
  CREW_READONLY: "1", CREW_RECENT_DAYS: "3650", CREW_DATA: fx.data, CREW_CHAT_PROVIDER: "stub", HOME: home, CREW_MAIN_PROJECT: proj,
  CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_TAILNET_NAME: TAILNET, CREW_LAN_IP: "127.0.0.1", CREW_LAN_PORT: String(lanPort), CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + "/api/summary")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const shots = join(root, "tests/out/transcripts"); mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const errors = [];
// each page opens Studio's session first, as `crew-studio open` does: a plain page load is read-only
const page = async (width, scheme) => { const p = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme }); p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  await p.goto(`${base}/session?t=${encodeURIComponent(process.env.CREW_SESSION_TOKEN)}`).catch(() => {}); return p; };
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const seen = (p, sel, timeout = 8000) => p.waitForSelector(sel, { timeout }).then(() => true).catch(() => false);
let lanToken = null;
const raw = (method, path, { host = `127.0.0.1:${port}`, token, body } = {}) => new Promise((resolve) => {
  const data = body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body);
  const r = httpRequest({ host: "127.0.0.1", port, method, path, headers: { host, ...(token ? { authorization: `Bearer ${token}` } : { "x-crew-session": process.env.CREW_SESSION_TOKEN }), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, body: j, text: t }); }); });
  r.on("error", (e) => resolve({ status: 0, body: null, text: String(e) })); if (data) r.write(data); r.end();
});
try {
  const p = await page(1440, "light");
  // ---- Prompt ----
  await p.goto(`${base}/#/crew/${fx.actor}`);
  ok(await seen(p, '[data-section="brief"]'), "a crew round opens on its Prompt tab with sections");
  ok((await p.locator(".tr-tabs [role=tab]").allTextContents()).join(",") === "Prompt,Transcript,Report", "the tabs are Prompt, Transcript, Report in that order");
  const bind = p.locator('[data-section="brief"] [data-binding]');
  ok(await bind.count() === 1 && (await p.locator("[data-bind-round]").getAttribute("data-bind-round")) === "2" && (await p.locator("[data-bind-head]").getAttribute("data-bind-head")) === fx.head
    && /briefs\/T-900-fix1\.md/.test(await p.locator('[data-section="brief"]').innerText()), "the brief section shows its round and head");
  await p.screenshot({ path: join(shots, "prompt-sections-1440-light.png"), fullPage: true });
  await p.click('[data-mode="raw"]');
  ok((await p.locator("[data-raw-prompt]").textContent()) === readFileSync(join(fx.att, "prompt.md"), "utf8"), "the Prompt tab shows the exact bytes of prompt.md");
  // ---- Transcript ----
  await p.click('[data-tab="transcript"]');
  ok(await seen(p, '[data-entry="tool"]'), "the Transcript tab lists the stream");
  const res = p.locator('[data-entry="toolResult"] details').first();
  ok(!(await res.evaluate((d) => d.open)), "a tool result is collapsed by default and expands", "open by default");
  const big = p.locator('[data-entry="toolResult"] details').nth(1);
  await big.locator("summary").click();
  const shortLen = (await big.locator("[data-result-body]").textContent()).length;
  await big.locator("[data-expand]").click();
  const longLen = (await p.locator('[data-entry="toolResult"] details').nth(1).locator("[data-result-body]").textContent()).length;
  ok(shortLen === 2000 && longLen === 50000, "a tool result is collapsed by default and expands", JSON.stringify({ shortLen, longLen }));
  const n0 = await p.locator("[data-entry]").count();
  appendFileSync(fx.cliLog, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "LIVE-APPENDED line" }] } }) + "\n");
  ok(await p.waitForFunction((n) => document.querySelectorAll("[data-entry]").length > n && /LIVE-APPENDED line/.test(document.querySelector("#trList").innerText), n0, { timeout: 8000 }).then(() => true).catch(() => false),
    "a live fixture round appends to the transcript without a reload");
  await p.screenshot({ path: join(shots, "transcript-1440-light.png"), fullPage: true });
  // ---- Report ----
  await p.click('[data-tab="report"]');
  ok(await seen(p, "[data-report]") && /Fixed the split/.test(await p.locator("[data-report]").innerText()), "the Report tab shows final.txt");
  // ---- redaction ----
  await p.goto(`${base}/#/crew/${fx.leak}`); await seen(p, "[data-section]");
  await p.click('[data-mode="raw"]');
  const leakPrompt = await p.locator("[data-raw-prompt]").textContent();
  await p.click('[data-tab="transcript"]'); await seen(p, '[data-entry="tool"]');
  await p.locator('[data-entry="toolResult"] summary').first().click();
  const html = await p.content();
  ok(!html.includes(TOKEN) && !html.includes(BEARER) && leakPrompt.includes("[credential removed]"), "the planted token never reaches the page");
  // ---- a finished round stops polling ----
  let polls = 0; const onReq = (r) => { if (r.url().includes(`/api/crew/${fx.leak}/transcript`)) polls++; };
  await p.goto(`${base}/#/crew`); await seen(p, ".tk-round");
  p.on("request", onReq);
  await p.goto(`${base}/#/crew/${fx.leak}`); await seen(p, "[data-section]"); await p.waitForTimeout(4000);
  p.off("request", onReq);
  ok(polls === 1, "a finished round stops polling", `requests: ${polls}`);
  let npolls = 0; const onN = (r) => { if (r.url().includes("/api/node-runs/R-3/check/1/transcript")) npolls++; };
  await p.goto(`${base}/#/runs`); await seen(p, "[data-node-run]");
  p.on("request", onN);
  await p.goto(`${base}/#/runs/node/R-3/check/1`); await seen(p, ".tr-tabs"); await p.waitForTimeout(4000);
  p.off("request", onN);
  ok(npolls === 1, "a node round in a terminal state without report.json stops polling", `requests: ${npolls}`);
  // A canonical Task detail leaves a live Round, even if that Task has disappeared.
  // Reuse the fixture's genuinely live worker (its process marker is this test's pid).
  let oldRoundPolls = 0;
  const onOldRound = (req) => { if (req.url().includes(`/api/crew/${fx.actor}/transcript`)) oldRoundPolls++; };
  p.on("request", onOldRound);
  await p.goto(`${base}/#/crew/${fx.actor}`); await seen(p, ".tr-tabs"); await p.waitForTimeout(1900);
  ok(oldRoundPolls >= 2, "the live Round actually polls before leaving it", String(oldRoundPolls));
  await p.evaluate(() => { location.hash = "#/tasks/R-999"; }); await p.waitForTimeout(200);
  const stoppedAt = oldRoundPolls; await p.waitForTimeout(2000); p.off("request", onOldRound);
  ok(oldRoundPolls === stoppedAt, "leaving a live Round for a canonical Task stops its obsolete polling", `${stoppedAt} → ${oldRoundPolls}`);
  // ---- Firstmate history ----
  await p.goto(`${base}/#/firstmate`);
  ok(await seen(p, '[data-section="history"] [data-turn]'), "the Firstmate page shows the session history and loads older turns");
  const before = await p.locator('[data-section="history"] [data-turn]').count();
  await p.click("#histOlder");
  ok(await p.waitForFunction((n) => document.querySelectorAll('[data-section="history"] [data-turn]').length > n, before, { timeout: 8000 }).then(() => true).catch(() => false), "the Firstmate page shows the session history and loads older turns");
  await p.screenshot({ path: join(shots, "firstmate-history-1440-light.png"), fullPage: true });
  // ---- Runs: an agent node run ----
  await p.goto(`${base}/#/runs`);
  ok(await seen(p, '[data-node-run="R-1/build/1"]'), "Runs lists the agent node runs");
  await p.click('[data-node-run="R-1/build/1"]');
  await seen(p, '[data-invocation="prompt.md"]'); await p.click('[data-invocation="prompt.md"]');
  ok(await seen(p, ".tr-tabs") && await seen(p, '[data-section="header"] [data-bind-head]') && (await p.locator("[data-bind-head]").getAttribute("data-bind-head")) === fx.nodeHead
    && /build@1#3/.test(await p.locator('[data-section="header"]').innerText()) && await p.locator('[data-section="system"]').count() === 1, "a node run shows the same three tabs, its record header and its system prompt");
  await p.click('[data-tab="transcript"]');
  ok(await p.waitForFunction(() => /node says hi/.test(document.querySelector("#trList")?.innerText || "") && document.querySelectorAll('#trList [data-entry="tool"]').length === 1, null, { timeout: 8000 }).then(() => true).catch(() => false), "a node run's transcript reads the normalized stream");
  await p.click('[data-tab="report"]');
  ok(await seen(p, "[data-report]") && /node report/.test(await p.locator("[data-report]").innerText()) && /\bDone\b/.test(await p.locator("[data-report]").innerText()) && await p.locator('[data-report] [data-job-status="done"]').count() === 1, "a node run's Report tab reads report.json (its status in words: Done)");
  // ---- stale responses, one test per guard family: the server answers, the answer is delayed, a newer one wins ----
  const holdFirst = async (pg, pattern, alter) => { let release; const held = new Promise((r) => (release = r)); let first = true;
    await pg.route(pattern, async (route) => { if (!first) return route.continue(); first = false; const resp = await route.fetch(); let body = await resp.text();
      if (alter) body = alter(body); await held; await route.fulfill({ response: resp, body }); });
    return () => release(); };
  {
    // the live crew list: a slow, older list never replaces a newer one
    const rel = await holdFirst(p, /\/api\/crew\/live$/, (b) => { const j = JSON.parse(b); j.unshift({ ...j[0], actor: "stale-actor-xyz", name: "stale" }); return JSON.stringify(j); });
    let later = 0; const onCrew = (r) => { if (/\/api\/crew\/live$/.test(r.url())) later++; };
    p.on("requestfinished", onCrew);
    await p.goto(`${base}/#/runs`); await p.goto(`${base}/#/crew`);
    await p.waitForSelector(".tk-round", { timeout: 9000 }).catch(() => {});
    // a newer list must have come back after the held one was asked for, before the held one is let go
    // while the held list is in flight, leave and come back: the page asks again, and that newer list comes back first
    await p.waitForTimeout(3500); await p.goto(`${base}/#/runs`); await p.goto(`${base}/#/crew`);
    for (let i = 0; i < 40 && later < 1; i++) await p.waitForTimeout(250);
    rel(); await p.waitForTimeout(1500); p.off("requestfinished", onCrew);
    ok(await p.locator('[data-actor="stale-actor-xyz"]').count() === 0 && await p.locator(".tk-round").count() > 0, "a slow older crew list never replaces a newer one", JSON.stringify({ later, stale: await p.locator('[data-actor="stale-actor-xyz"]').count(), rounds: await p.locator(".tk-round").count(), view: (await p.locator("#view").innerText()).slice(0, 120) }));
    await p.unroute(/\/api\/crew\/live$/);
    // the report modal: the report asked for last is the one shown
    const relR = await holdFirst(p, /\/api\/crew\/report\/worker-fix-t900-r1$/);
    await p.locator('[data-report="worker-fix-t900-r1"]').click(); await p.waitForTimeout(200);
    await p.locator('[data-report="worker-two-t900-r1"]').click();
    await p.waitForSelector('[data-report-text="worker-two-t900-r1"]', { timeout: 6000 }).catch(() => {});
    relR(); await p.waitForTimeout(1200);
    ok(await p.locator('[data-report-text="worker-two-t900-r1"]').count() === 1 && await p.locator('[data-report-text="worker-fix-t900-r1"]').count() === 0, "the report modal shows the report asked for last");
    await p.unroute(/\/api\/crew\/report\/worker-fix-t900-r1$/); await p.keyboard.press("Escape"); await p.evaluate(() => $("#modalRoot").replaceChildren());
  }
  {
    // the node-run list: a slow first load never replaces the second
    const rel = await holdFirst(p, /\/api\/node-runs$/, (b) => { const j = JSON.parse(b); j.unshift({ run: "R-STALE", node: "x", round: "1", prompt: true, stream: false, report: false, updated: new Date().toISOString() }); return JSON.stringify(j); });
    await p.reload(); await p.goto(`${base}/#/runs`); await p.waitForTimeout(300); await p.goto(`${base}/#/crew`); await p.goto(`${base}/#/runs`);
    await p.waitForSelector("[data-node-run]", { timeout: 9000 }).catch(() => {});
    rel(); await p.waitForTimeout(1200); await p.goto(`${base}/#/crew`); await p.goto(`${base}/#/runs`); await p.waitForTimeout(500);
    ok(await p.locator('[data-node-run^="R-STALE"]').count() === 0 && await p.locator("[data-node-run]").count() > 0, "a slow first node-run list never replaces the second");
    await p.unroute(/\/api\/node-runs$/);
  }
  {
    // the Firstmate history: an older page asked for before "Newest" never joins the new history
    await p.goto(`${base}/#/firstmate`); await p.waitForSelector('[data-section="history"] [data-turn]', { timeout: 9000 });
    const rel = await holdFirst(p, /\/api\/firstmate\/history\?before=/);
    await p.click("#histOlder"); await p.waitForTimeout(200);
    await p.locator('[data-section="history"] button', { hasText: "Newest" }).click();
    await p.waitForSelector('[data-section="history"] [data-turn]', { timeout: 9000 });
    const fresh = await p.locator('[data-section="history"] [data-history]').getAttribute("data-history");
    rel(); await p.waitForTimeout(1500);
    ok((await p.locator('[data-section="history"] [data-history]').getAttribute("data-history")) === fresh, "an older history page never joins the history that \"Newest\" started", fresh);
    await p.unroute(/\/api\/firstmate\/history\?before=/);
  }
  {
    // the phone setting: the answer to the last change is the one shown, and it matches the server
    await p.goto(`${base}/#/crew/${fx.actor}`); await p.waitForSelector(".tr-set input");
    const rel = await holdFirst(p, /\/api\/transcripts\/settings$/);
    const box = p.locator(".tr-set input");
    if (await box.isChecked()) { await box.uncheck(); await p.waitForTimeout(400); }
    await p.unroute(/\/api\/transcripts\/settings$/);
    const rel2 = await holdFirst(p, /\/api\/transcripts\/settings$/);
    await box.check(); await p.waitForTimeout(200); await p.locator(".tr-set input").uncheck();
    await p.waitForTimeout(800); rel2(); rel(); await p.waitForTimeout(1200);
    const server = await (await fetch(base + "/api/transcripts/settings")).json();
    ok(!(await p.locator(".tr-set input").isChecked()) && server.phoneRaw === false, "the phone setting shows the answer to the last change, as the server holds it", JSON.stringify(server));
    await p.unroute(/\/api\/transcripts\/settings$/);
  }
  {
    // #6: a failed read of the phone setting is an error, never a silent "off"; a failed change restores the previous value
    await (await fetch(base + "/api/transcripts/settings", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ phoneRaw: true }) })).json();
    await p.route(/\/api\/transcripts\/settings$/, (route) => route.request().method() === "GET" ? route.fulfill({ status: 500, body: "{}" }) : route.continue());
    await p.reload();
    await p.goto(`${base}/#/crew/${fx.actor}`); await p.waitForSelector(".tr-set", { timeout: 9000 });
    await p.waitForTimeout(800);
    ok(await p.locator("[data-phone-setting-error]").count() === 1 && await p.locator(".tr-set input").isDisabled(), "a failed read of the phone setting shows an error, not \"off\"", (await p.locator(".tr-set").first().innerHTML().catch(() => "none")).slice(0, 300));
    await p.unroute(/\/api\/transcripts\/settings$/);
    await p.locator("[data-phone-setting-retry]").click().catch(() => {});
    await p.waitForFunction(() => document.querySelector(".tr-set input")?.checked === true, null, { timeout: 6000 }).catch(() => {});
    await p.route(/\/api\/transcripts\/settings$/, (route) => route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk full" }) }) : route.continue());
    await p.locator(".tr-set input").uncheck().catch(() => {}); await p.waitForTimeout(1000);
    ok(await p.locator(".tr-set input").isChecked() && await p.locator("[data-phone-setting-error]").count() === 1, "a failed change restores the previous value and shows the error");
    await p.unroute(/\/api\/transcripts\/settings$/);
    await fetch(base + "/api/transcripts/settings", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ phoneRaw: false }) });
    await p.reload();
  }
  // ---- a poll in flight for one invocation never lands in another ----
  {
    let release; const held = new Promise((r) => (release = r)); let heldOnce = false;
    await p.route(/\/api\/node-runs\/R-7\/make\/1\/transcript\?.*prompt=prompt\.md/, async (route) => { if (heldOnce) return route.continue(); heldOnce = true; await held; await route.continue(); });
    const bResponses = [], bRequests = [];
    const onResp = async (r) => { if (/R-7\/make\/1\/transcript\?.*prompt=prompt\.attempt2\.md/.test(r.url())) { try { bResponses.push(await r.json()); } catch {} } };
    const onReq = (r) => { if (/R-7\/make\/1\/transcript\?.*prompt=prompt\.attempt2\.md/.test(r.url())) bRequests.push(new URL(r.url()).searchParams.get("after")); };
    p.on("response", onResp); p.on("request", onReq);
    await p.goto(`${base}/#/runs`); await seen(p, "[data-node-run]");
    await p.goto(`${base}/#/runs/node/R-7/make/1/prompt.md`); await seen(p, '[data-invocation="prompt.attempt2.md"]');
    await p.waitForFunction(() => true); await p.waitForTimeout(300); // A's first poll is now held in flight
    await p.click('[data-invocation="prompt.attempt2.md"]'); await p.click('[data-tab="transcript"]');
    await p.waitForFunction(() => /b says/.test(document.querySelector("#trList")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    release(); await p.waitForTimeout(3500);
    const list = await p.locator("#trList").innerText().catch(() => "");
    const lastNext = bResponses.filter((x) => x && x.next !== undefined).at(-2)?.next;
    const lastAfter = bRequests.at(-1);
    ok(/b says/.test(list) && !/a says/.test(list) && bResponses.length >= 2 && String(lastAfter) === String(lastNext),
      "a poll in flight for one invocation never lands in another (entries and cursor untouched)", JSON.stringify({ list: list.slice(0, 80), lastAfter, lastNext, n: bResponses.length }));
    p.off("response", onResp); p.off("request", onReq); await p.unroute(/\/api\/node-runs\/R-7\/make\/1\/transcript\?.*prompt=prompt\.md/);
  }
  // ---- a retried node round: every attempt and hop, each with its own tabs; the live view follows the newest ----
  await p.goto(`${base}/#/runs`); await seen(p, "[data-node-run]");
  await p.goto(`${base}/#/runs/node/R-4/make/1`);
  ok(await seen(p, '[data-invocation="prompt.attempt2.hop1.md"][aria-pressed="true"]') && (await p.locator("[data-invocation]").count()) === 3, "the node view lists every attempt and hop, newest selected");
  await p.click('[data-invocation="prompt.md"]'); await p.click('[data-mode="raw"]');
  ok(await p.waitForFunction(() => /attempt 1 prompt/.test(document.querySelector("[data-raw-prompt]")?.textContent || ""), null, { timeout: 8000 }).then(() => true).catch(() => false), "an older attempt shows its own prompt");
  await p.click('[data-tab="transcript"]');
  ok(await p.waitForFunction(() => { const t = document.querySelector("#trList")?.innerText || ""; return /a1 says/.test(t) && !/a2 says/.test(t); }, null, { timeout: 8000 }).then(() => true).catch(() => false), "an older attempt shows its own transcript");
  // the runtime's real sequence: an attempt ends (terminal status, report.json), the engine queues the retry,
  // and only later does the next attempt write its prompt. A poll in that gap must not stop the view.
  const runJson = join(fx.data, "runs", "R-4", "run.json");
  const setNode = (n, queue = []) => writeFileSync(runJson, JSON.stringify({ id: "R-4", status: "running", queue, nodes: { make: n } }));
  const endAttempt = (name) => { appendFileSync(join(fx.retried, "stream.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "status", status: "failed", error: "red" }) + "\n");
    writeFileSync(join(fx.retried, "report.json"), JSON.stringify({ status: "failed", said: `${name} failed`, prompt: name })); setNode({ state: "pending", visits: 0, attempt: 2 }, ["make"]); };
  const startAttempt = (k, text) => { writeFileSync(join(fx.retried, `prompt.attempt${k}.md`), `---\nrun: "R-4"\nattempt: ${k}\nhop: 0\n---\nattempt ${k} prompt\n`);
    appendFileSync(join(fx.retried, "stream.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "status", status: "started", prompt: `prompt.attempt${k}.md` }) + "\n" + JSON.stringify({ ts: new Date().toISOString(), type: "message", text }) + "\n");
    setNode({ state: "running", visits: 1, attempt: k - 1 }); };
  // picking an older attempt stops following: prompt.md stays shown while attempt 3 starts
  endAttempt("prompt.attempt2.hop1.md"); await p.waitForTimeout(2500); startAttempt(3, "a3 says"); await p.waitForTimeout(3500);
  ok((await p.locator('[data-invocation="prompt.md"]').getAttribute("aria-pressed")) === "true" && /a1 says/.test(await p.locator("#trList").innerText()) && !/a3 says/.test(await p.locator("#trList").innerText()),
    "picking an older attempt stops following");
  // picking the newest follows again, and the live view moves to attempt 3
  await p.click('[data-invocation="prompt.attempt2.hop1.md"]');
  await p.click('[data-tab="transcript"]').catch(() => {});
  ok(await p.waitForFunction(() => document.querySelector('[data-invocation="prompt.attempt3.md"]')?.getAttribute("aria-pressed") === "true" && /a3 says/.test(document.querySelector("#trList")?.innerText || ""), null, { timeout: 10000 }).then(() => true).catch(() => false),
    "the newest hand-off shows its own transcript");
  // attempt 3 ends; a poll lands in the gap; attempt 4 starts: the view follows it without a reload
  endAttempt("prompt.attempt3.md"); await p.waitForTimeout(2500); startAttempt(4, "a4 says");
  ok(await p.waitForFunction(() => document.querySelector('[data-invocation="prompt.attempt4.md"]')?.getAttribute("aria-pressed") === "true" && /a4 says/.test(document.querySelector("#trList")?.innerText || ""), null, { timeout: 10000 }).then(() => true).catch(() => false),
    "the live view follows a new attempt without a reload");
  await p.screenshot({ path: join(shots, "node-attempts-1440-light.png"), fullPage: true });
  await p.close();

  // ---- a paired phone ----
  const code = (await raw("POST", "/api/remote/pair/start")).body.code;
  const ptok = (await raw("POST", "/api/remote/pair", { host: TAILNET, body: { code, name: "Pixel" } })).body?.token;
  const pi = await raw("GET", `/api/crew/${fx.actor}/invocation`, { host: TAILNET, token: ptok });
  const pt = await raw("GET", `/api/crew/${fx.actor}/transcript`, { host: TAILNET, token: ptok });
  const ph = await raw("GET", `/api/firstmate/history`, { host: TAILNET, token: ptok });
  ok(ptok && pi.status === 200 && !pi.body.prompt && !pi.text.includes("Approved local brief") && pi.body.summary?.sections?.length && !pt.body.entries.length && !ph.body.entries.length,
    "the phone view gets no raw prompt", pi.text.slice(0, 200));
  ok((await raw("POST", "/api/transcripts/settings", { host: TAILNET, token: ptok, body: { phoneRaw: true } })).status === 403, "a phone cannot allow itself raw prompts");
  // a second phone over LAN mode, for the phone summary views
  const lan = await raw("POST", "/api/remote/lan", { body: { enable: true, confirm: true } });
  const code2 = (await raw("POST", "/api/remote/pair/start")).body.code;
  const lanPair = await new Promise((resolve) => { const data = JSON.stringify({ code: code2, name: "Tablet" });
    const r = httpRequest({ host: "127.0.0.1", port: lanPort, method: "POST", path: "/api/remote/pair", headers: { host: `127.0.0.1:${lanPort}`, "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { try { resolve(JSON.parse(t)); } catch { resolve({}); } }); });
    r.on("error", () => resolve({})); r.write(data); r.end(); });
  lanToken = lanPair.token;
  ok(lan.status === 200 && lanToken, "a phone pairs over LAN mode for the phone views", JSON.stringify(lan.body));

  // ---- every view, both widths, both themes ----
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const q = await page(width, scheme);
    for (const [name, url, sel, tab] of [["prompt", `#/crew/${fx.actor}`, '[data-section="brief"]', null], ["transcript", `#/crew/${fx.actor}`, '[data-entry="tool"]', "transcript"],
      ["report", `#/crew/${fx.actor}`, "[data-report]", "report"], ["history", "#/firstmate", '[data-section="history"] [data-turn]', null], ["node", "#/runs/node/R-1/build/1/prompt.md", ".tr-tabs", null],
      ["runs", "#/runs", '[data-node-run="R-1/build/1"]', null], ["node-transcript", "#/runs/node/R-1/build/1/prompt.md", "#trList [data-entry]", "transcript"], ["node-report", "#/runs/node/R-1/build/1/prompt.md", "[data-report]", "report"],
      ["node-attempts", "#/runs/node/R-4/make/1", '[data-invocation][aria-pressed="true"]', null],
      ["phone-summary", `#/crew/${fx.actor}`, "[data-phone-summary]", null], ["phone-node", "#/runs/node/R-4/make/1", '[data-invocation][aria-pressed="true"]', null]]) {
      // the phone summary is what a real paired phone sees: Studio's LAN listener, the phone's own token
      const at = name.startsWith("phone") ? `http://127.0.0.1:${lanPort}` : base;
      if (name.startsWith("phone")) await q.addInitScript((t) => { try { localStorage.setItem("crew.remoteToken", t); } catch {} }, lanToken);
      await q.goto(`${at}/${url}`); await seen(q, ".tr-tabs, [data-section=history], [data-node-run]");
      if (tab) await q.click(`[data-tab="${tab}"]`);
      ok(await seen(q, sel), `${name} renders at ${width} ${scheme}`);
      ok(await noHScroll(q), `${name} has no sideways scroll at ${width} ${scheme}`);
      await q.screenshot({ path: join(shots, `${name}-${width}-${scheme}.png`), fullPage: true });
    }
    await q.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\ntranscripts-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
