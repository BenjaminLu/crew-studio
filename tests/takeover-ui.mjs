import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Takeover UI: the Take over page (fork, rehearsal warning, release), a wake from
// a synthetic event in a temp state copy reaching the chat queue, a question
// from the session answered in the chat, the live crew rows with a final report,
// and an intent-alignment card with every section and the one-way door
// confirmation, at 1440 and 390 px in light and dark. No live state is read or
// written: a temp copy of tests/fixture/state, a stub claude, a mock board.
//   node tests/takeover-ui.mjs
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("takeover-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-takeover-ui-"));
const state = join(tmp, "state");
cpSync(join(here, "fixture/state"), state, { recursive: true });
mkdirSync(join(state, "session/acknowledged"), { recursive: true });
writeFileSync(join(state, "session/wake.jsonl"), "");
const now = Date.now() / 1000;
for (const r of readdirSync(join(state, "runs"))) utimesSync(join(state, "runs", r), now, now);
const worker = readdirSync(join(state, "runs")).find((r) => r.startsWith("worker-"));
const attempt = readdirSync(join(state, "runs", worker)).find((x) => x.startsWith("claude-"));
writeFileSync(join(state, "runs", worker, "last-result.json"), JSON.stringify({ status: "completed", exit_code: 0 }));
writeFileSync(join(state, "runs", worker, attempt, "final.txt"), "**Done.** The shard split now uses one estimate for CI and the model.\n");
const reviewer = readdirSync(join(state, "runs")).find((r) => r.startsWith("reviewer-"));
writeFileSync(join(state, "runs", reviewer, "process.json"), JSON.stringify({ actor: reviewer, pid: process.pid })); // one round is live
// a synthetic one-way merge card with every intent section, in en and zh-TW
const sections = (zh) => ({
  title: zh ? "合併卡 — 合併 PR #901：分片時間更平均" : "MERGE CARD — merge PR #901: shards finish in about the same time",
  explanation: zh ? "審查已核准。這個 head 的 CI 是綠的。" : "The review approved it. CI is green on this head.",
  intent: [{ kind: "fact", text: zh ? "CI 和時間模型用同一種切法。" : "CI and the timing model use one split." }, { kind: "fact", text: zh ? "沒有紀錄的新套件先跑。" : "A new suite with no recorded time starts first." }],
  why: [{ kind: "fact", text: zh ? "第 6 片連續三次最慢。" : "Shard 6 was the slowest three runs in a row." }],
  scope_in: zh ? ["分片切法", "時間模型"] : ["the shard split", "the timing model"], scope_out: zh ? ["600 秒上限"] : ["the 600-second budget"],
  done: [{ kind: "fact", text: zh ? "一個測試用 main 的紀錄跑切法。" : "A test runs main's recorded times through the split." }],
  before: zh ? "第 6 片 657 秒。" : "Shard 6 took 657 seconds.", after: zh ? "各片 324 到 532 秒。" : "Shards took 324 to 532 seconds.",
  before_nodes: [{ state: "same", label: "Merge" }, { state: "gone", label: "Slow shard 6" }], after_nodes: [{ state: "same", label: "Merge" }, { state: "new", label: "Even shards" }],
  how: [{ kind: "fact", text: zh ? "一個模組給出估計與切法。" : "One module gives the estimates and the split." }],
  glossary: [{ id: "door", term: zh ? "門" : "door", text: zh ? "門說明改動能不能用 revert 復原。" : "A door says if a revert can undo a change." }],
  door: { kind: "one-way", reason: zh ? "改了 CI 的必要檢查。" : "It changes the required CI checks.", rollback: zh ? "再開一個 PR 改回來。" : "Another pull request puts them back." },
  check: { q: zh ? "合併後哪個會變？" : "What changes after the merge?", options: zh ? ["上限", "切法"] : ["The budget", "The split"] },
  options: { A: { description: zh ? "合併 #901" : "Merge #901", pros: zh ? "分片平均" : "Even shards", cons: zh ? "要再看一次 main" : "Main needs one more look" },
    B: { description: zh ? "先不合併" : "Hold the merge", pros: zh ? "不動" : "Nothing changes", cons: zh ? "第 6 片仍慢" : "Shard 6 stays slow" } },
});
writeFileSync(join(state, "pending", "D-ui-oneway.json"), JSON.stringify({ id: "D-ui-oneway", kind: "merge", task: "T-305", pr: 901, ts: new Date().toISOString(),
  title: sections(false).title, details: { en: sections(false), "zh-TW": sections(true), walk: { status: "valid", head: "abc1234", intents: [{ intent: 1, key: [{ file: "bin/lib/split.py", start: 12, note: { en: "one split", "zh-TW": "同一種切法" } }] }, { intent: 2, key: [] }], other: [] } } }));
for (const f of readdirSync(join(state, "pending"))) if (f !== "D-ui-oneway.json") try { (await import("node:fs")).rmSync(join(state, "pending", f)); } catch {}

const secret = "cd".repeat(32);
writeFileSync(join(tmp, "board.secret"), secret + "\n");
const received = [];
const mock = createServer((req, res) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
  const b = body ? JSON.parse(body) : null; received.push({ path: req.url, body: b });
  res.writeHead(200, { "content-type": "application/json" });
  if (req.url === "/decisions/check-door") return res.end(JSON.stringify(b.check_answer === 1 ? { ok: true, id: b.id } : { ok: false, code: "doorUnconfirmed", why: "Not that one." }));
  res.end(JSON.stringify({ ok: true }));
}); });
await new Promise((r) => mock.listen(0, "127.0.0.1", r));

const home = join(tmp, "home"), proj = join(tmp, "proj"); mkdirSync(proj);
const pdir = join(home, ".claude/projects", proj.replace(/[^a-zA-Z0-9]/g, "-")); mkdirSync(pdir, { recursive: true });
const SID = "fm-session-ui";
writeFileSync(join(pdir, `${SID}.jsonl`), [{ type: "user", isSidechain: false, cwd: proj, permissionMode: "auto", message: { role: "user", content: "firstmate: run the crew" } },
  { type: "assistant", isSidechain: false, cwd: proj, message: { role: "assistant", model: "stub-opus", content: [{ type: "text", text: "ok" }] } }].map((o) => JSON.stringify(o)).join("\n") + "\n");
{ const t = now - 3600; utimesSync(join(pdir, `${SID}.jsonl`), t, t); }
const port = await freePort();
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, env: { ...env, CREW_GH_NO_CLI: "1", CREW_GH: "0", CREW_FM_STATE: state, CREW_PORT: String(port), CREW_BOARD_URL: `http://127.0.0.1:${mock.address().port}`,
  CREW_BOARD_SECRET: join(tmp, "board.secret"), CREW_READONLY: "0", CREW_RECENT_DAYS: "3650", CREW_DATA: join(tmp, "data"), CREW_CHAT_PROVIDER: "stub",
  HOME: home, CREW_MAIN_PROJECT: proj, CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_WAKE_GRACE_MS: "600000", CREW_PERMISSION_TIMEOUT_MS: "60000",
  CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const shots = join(root, "tests/out/takeover"); mkdirSync(shots, { recursive: true });
const browser = withSession(await chromium.launch(), base);
const errors = [];
const page = async (width, scheme) => { const p = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme }); p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`)); return p; };
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const seen = (p, sel, timeout = 8000) => p.waitForSelector(sel, { timeout }).then(() => true).catch(() => false);
try {
  // ---- takeover flow at 1440 light ----
  const p = await page(1440, "light");
  await p.goto(`${base}/#/takeover`);
  // since acc5b89 the page leads with starting Studio's own Firstmate; taking over an existing session is
  // opt-in behind "Show existing sessions" (public/takeover.js, TK.optional)
  await p.click("[data-optional-sessions]");
  ok(await seen(p, `[data-firstmate="${SID}"]`), "the Take over page lists the firstmate session", (await p.locator("#view").innerText()).slice(0, 400) + " " + errors.join("|") + (await (await fetch(base + "/api/takeover")).text()).slice(0, 300));
  await p.screenshot({ path: join(shots, "takeover-before-1440-light.png"), fullPage: true });
  await p.click("#takeoverBtn");
  ok(await seen(p, ".modal .banner"), "the takeover dialog says the terminal session must stay idle");
  ok(/stay idle/.test(await p.locator(".modal").innerText()), "the dialog text names the idle rule");
  await p.click(".modal .btn.primary"); // without the tick: refused
  ok(await p.locator(".modal").count() === 1, "takeover waits for the captain's tick");
  await p.check("#tkAck"); await p.click(".modal .btn.primary");
  ok(await seen(p, '[data-takeover="takeover"]'), "after takeover the page shows Studio driving the copy");
  ok(await seen(p, "[data-idle-warning]"), "the page keeps the terminal-idle warning in view");
  ok(await seen(p, "[data-section=cutover]"), "while Studio drives a taken-over copy, the page shows the cutover steps");
  ok(await p.waitForFunction(() => document.querySelector("[data-copy-id]")?.dataset.copyId?.endsWith("-copy"), null, { timeout: 8000 }).then(() => true).catch(() => false), "the copy's new id is shown once the CLI names it");
  const drv = JSON.parse(readFileSync(join(tmp, "data/driver.json"), "utf8"));
  ok(drv.holder === "studio" && drv.forkedFrom === SID && readdirSync(join(tmp, "data/handoff")).length === 1, "Studio holds the driver lock and wrote a handoff note");
  await p.screenshot({ path: join(shots, "takeover-driving-1440-light.png"), fullPage: true });
  // a wake from a synthetic event in the temp state reaches the queue, shown in the chat
  appendFileSync(join(state, "session/wake.jsonl"), JSON.stringify({ id: "worker-ui-t305-r3", reason: "finished", line: "worker: T-305 round 3 finished", woken: now }) + "\n");
  await p.evaluate(() => { chatMode = "main"; store.set("crew.chatMode", "main"); openChat(true); renderChat(); });
  ok(await seen(p, '#chatLog [data-q="wake"]'), "a synthetic wake reaches the input queue");
  ok(/worker: T-305 round 3 finished/.test(await p.locator("#chatLog").innerText()), "the wake shows in the chat stream as a system line");
  // a question from the session, answered in the chat
  await fetch(base + "/api/main/send", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ text: "STUB_ASK" }) });
  ok(await seen(p, "#chatLog [data-question]"), "a question the session asks shows as a reply box");
  await p.screenshot({ path: join(shots, "chat-question-1440-light.png") });
  await p.locator("#chatLog [data-question] .tk-opts button", { hasText: "540s" }).click();
  await p.locator("#chatLog [data-question] .btn.primary").click();
  ok(await p.waitForFunction(() => /answered: \{"Which shard budget\?":"540s"\}/.test(document.querySelector("#chatLog").innerText), null, { timeout: 8000 }).then(() => true).catch(() => false), "the answer goes back to the session");
  // dispatch from an intent
  await p.fill("#dispatchIn", "Make shard times even");
  await p.click("#dispatchBtn");
  ok(await p.waitForFunction(() => /Captain's intent for new work/.test(document.querySelector("#chatLog").innerText), null, { timeout: 8000 }).then(() => true).catch(() => false), "dispatch sends the intent to firstmate to raise a card");
  // release
  await p.click("#releaseBtn"); await p.click(".modal .btn.primary");
  ok(await seen(p, "#resumeCmd"), "release shows the resume command");
  ok(/claude --resume fm-session-ui-copy/.test(await p.locator("#resumeCmd").innerText()), "the resume command names the copy");
  await p.click(".modal .btn.primary");
  await p.close();

  // ---- every view at both widths, both themes ----
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const q = await page(width, scheme);
    // after the release above Studio drives nothing, so the page shows the released card with the
    // resume command (cutover steps only show while a taken-over copy is driven, checked above)
    for (const [view, sel] of [["takeover", "[data-released]"], ["crew", `[data-actor="${worker}"]`], ["inbox", '[data-card="D-ui-oneway"]']]) {
      await q.goto(`${base}/#/${view}`);
      ok(await seen(q, sel), `${view} renders at ${width} ${scheme}`);
      ok(await noHScroll(q), `${view} has no sideways scroll at ${width} ${scheme}`);
      await q.screenshot({ path: join(shots, `${view}-${width}-${scheme}.png`), fullPage: true });
    }
    await q.close();
  }

  // ---- crew live ----
  const c = await page(1440, "light");
  await c.goto(`${base}/#/crew`);
  await seen(c, `[data-actor="${worker}"]`);
  const row = c.locator(`[data-actor="${worker}"]`);
  ok(/T-305/.test(await row.innerText()) && (await row.locator("[data-phase]").getAttribute("data-phase")) === "finished", "a crew row shows task and phase");
  ok(await c.locator(`[data-actor="${reviewer}"].is-live`).count() === 1, "a running round is marked live");
  await row.locator("[data-report]").click();
  ok(await seen(c, `[data-report-text="${worker}"]`) && /shard split now uses one estimate/.test(await c.locator(".modal").innerText()), "the final report opens from the row");
  await c.close();

  // ---- the intent card and the door ----
  const k = await page(1440, "light");
  await k.goto(`${base}/#/inbox`);
  const card = k.locator('[data-card="D-ui-oneway"]');
  await seen(k, '[data-card="D-ui-oneway"]');
  for (const s of ["intent", "why", "scope", "done", "before-after", "how", "glossary"]) ok(await card.locator(`[data-sec="${s}"]`).count() === 1, `the card shows its ${s} section`);
  ok(await card.locator("[data-walk]").count() === 1 && /bin\/lib\/split.py:12/.test(await card.locator("[data-walk]").innerText()), "the card shows the walk");
  ok(await card.locator('[data-door="one-way"] [data-door-check]').count() === 1, "a one-way merge shows the door confirmation");
  await card.locator('.opt:has(b:text-is("Merge #901"))').click();
  ok(await card.locator(".actions .btn.primary").isDisabled(), "the merge stays locked until the door is confirmed");
  await card.locator('[data-intent="1"]').check(); await card.locator('[data-intent="2"]').check();
  await card.locator('[data-check-answer="0"]').click();
  ok(await k.waitForFunction(() => /Not that one/.test(document.querySelector('[data-door-check]').innerText), null, { timeout: 6000 }).then(() => true).catch(() => false), "a wrong check answer is refused by the board's check");
  await card.locator('[data-check-answer="1"]').click();
  ok(await k.waitForFunction(() => /unlocked/.test(document.querySelector('[data-door-check]').innerText), null, { timeout: 6000 }).then(() => true).catch(() => false), "the right answer unlocks the merge");
  // a slow check for an older answer never overrides the newer one
  { let release; const held = new Promise((r) => (release = r));
    await k.route("**/api/answer/check-door", async (route) => { const b = JSON.parse(route.request().postData() || "{}"); if (b.check_answer === 0) { await held; } await route.continue(); });
    await card.locator('[data-check-answer="0"]').click(); await k.waitForTimeout(200);
    await card.locator('[data-check-answer="1"]').click();
    await k.waitForFunction(() => /unlocked/.test(document.querySelector('[data-door-check]').innerText), null, { timeout: 6000 }).catch(() => {});
    release(); await k.waitForTimeout(1500);
    ok(/unlocked/.test(await card.locator("[data-door-check]").innerText()) && !(await card.locator(".actions .btn.primary").isDisabled()), "a slow check of an older answer never overrides the newer answer");
    await k.unroute("**/api/answer/check-door"); }
  await k.screenshot({ path: join(shots, "inbox-door-confirmed-1440-light.png"), fullPage: true });
  await card.locator(".actions .btn.primary").click(); // sent from the card itself: no dialog
  await k.waitForTimeout(800);
  const dec = received.find((r) => r.path === "/decisions");
  ok(dec && dec.body.id === "D-ui-oneway" && dec.body.chosen === "A" && JSON.stringify(dec.body.reviewed_intents) === "[1,2]" && dec.body.check_answer === 1, "the answer goes to the board with the door confirmation", JSON.stringify(dec));
  const direct = await fetch(base + "/api/answer", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ id: "D-ui-oneway", chosen: "A" }) });
  ok(direct.status === 400, "the server refuses a one-way merge answer without the door confirmation");
  const before = received.length;
  const partial = await fetch(base + "/api/answer", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ id: "D-ui-oneway", chosen: "A", reviewed_intents: [1], check_answer: 1 }) });
  const dup = await fetch(base + "/api/answer", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ id: "D-ui-oneway", chosen: "A", reviewed_intents: [1, 1], check_answer: 1 }) });
  const pdoor = await fetch(base + "/api/answer/check-door", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ id: "D-ui-oneway", reviewed_intents: [2, 2], check_answer: 1 }) });
  ok(partial.status === 400 && dup.status === 400 && pdoor.status === 400 && received.length === before, "a partial or repeated intent list is refused and nothing reaches the board");
  await k.evaluate(() => setLang("zh-TW"));
  ok(/分片時間更平均/.test(await card.innerText()) && /單向門/.test(await card.innerText()), "the card reads in zh-TW");
  await k.screenshot({ path: join(shots, "inbox-zh-TW-1440-light.png"), fullPage: true });
  await k.close();
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally {
  await browser.close(); app.kill(); mock.close();
}
console.log(`\ntakeover-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
