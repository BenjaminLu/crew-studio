// The Inbox, the sidebar counts and the Board's Needs you follow the live stream (unit inbox-live):
// a card raised while the page is open appears without a reload, with one non-blocking "new card" cue;
// a card the captain has open keeps its note and ticks across live updates; a card answered on another
// page, or withdrawn (its run cancelled), leaves.      node tests/inbox-live-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("inbox-live-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-inboxlive-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const serverEnv = { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp };
let appLog = "";
const startApp = () => { const a = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: serverEnv }); a.stdout.on("data", (d) => (appLog += d)); a.stderr.on("data", (d) => (appLog += d)); return a; };
let app = startApp();
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out"); mkdirSync(shots, { recursive: true });
const INTENT = (what) => [what,
  "STUB_FILE src/percent.ts :: export function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\nimport { percent } from "../src/percent";\\n\\ntest("percent rounds to the cent", () => expect(percent(1999, 15)).toBe(300));\\n'].join("\n");
const dom = (p) => p.evaluate(() => ({ inbox: [...document.querySelectorAll("[data-inbox-studio] [data-scard]")].map((e) => e.dataset.scard), needs: [...document.querySelectorAll("[data-need-scard]")].map((e) => e.dataset.needScard), nav: document.querySelector("#navInbox")?.textContent, needsCount: document.querySelector("#needsCount")?.textContent }));
const waitFor = async (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
try {
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" }); const A = await ctxA.newPage(); A.on("pageerror", (e) => errors.push(`A: ${e.message}`));
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" }); const B = await ctxB.newPage(); B.on("pageerror", (e) => errors.push(`B: ${e.message}`));
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" }); const C = await ctxC.newPage(); C.on("pageerror", (e) => errors.push(`C: ${e.message}`));
  // A: the Inbox, open before any card exists; C: the Board, open too
  await A.goto(`${base}/#/inbox`); await A.waitForSelector("#view .page", { timeout: 15000 });
  await C.goto(`${base}/#/board`); await C.waitForSelector("#needsH", { timeout: 15000 });
  await B.goto(`${base}/#/runs`); await B.waitForSelector("#view .page", { timeout: 15000 });
  await A.waitForTimeout(800);
  const navs = () => A.evaluate(() => [document.querySelector("#navInbox")?.textContent.trim() ?? "", document.querySelector("#navNeeds")?.hidden ? "" : document.querySelector("#navNeeds")?.textContent.trim() ?? ""]);
  ok((await A.locator("[data-inbox-studio] [data-scard]").count()) === 0 && JSON.stringify(await navs()) === '["",""]', "the Inbox opens with no card and empty sidebar counts");
  await A.evaluate(() => { window.__mark = "no-reload"; });
  await C.evaluate(() => { window.__mark = "no-reload"; });
  const call = (u, b) => B.evaluate(async ([u, b]) => { const r = await fetch(u, b === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [u, b]);
  // ---------- a card raised by the runtime while the Inbox is open ----------
  const r1 = (await call("/api/wruns", { workflow: "code-firstmate", text: INTENT("Add a percent function to money-kit"), params: {} })).j;
  const appeared = await waitFor(A, () => !!document.querySelector("[data-inbox-studio] [data-scard]"), null, 120000);
  const c1 = (await call("/api/scards?open=1")).j.cards.find((c) => c.run === r1.id);
  ok(appeared && !!c1 && (await A.locator(`[data-inbox-studio] [data-scard="${c1.id}"]`).count()) === 1 && await A.evaluate(() => window.__mark === "no-reload"),
    "a card raised while the Inbox is open appears in it without a reload", JSON.stringify([appeared, c1?.id]));
  ok(await waitFor(A, () => document.querySelector("#navInbox")?.textContent.trim() === "1" && document.querySelector("#navNeeds")?.textContent.trim() === "1" && !document.querySelector("#navNeeds")?.hidden, null, 5000),
    "the sidebar's Inbox and Board counts rise to 1 without a reload", JSON.stringify(await navs()));
  const cue = await A.$("[data-new-card-cue]");
  ok(!!cue && /new card|新卡片/i.test(await cue.textContent()) && (await A.locator("[data-new-card-cue]").count()) === 1 && (await cue.getAttribute("role")) === "status",
    "one non-blocking new-card cue shows (a status line, not a dialog)", JSON.stringify(cue ? await cue.textContent() : null));
  ok(await waitFor(C, (id) => !!document.querySelector(`[data-need-scard="${id}"]`) && document.querySelector("#needsCount")?.textContent.trim() === "1", c1?.id, 10000) && await C.evaluate(() => window.__mark === "no-reload"),
    "the Board's Needs you shows the card and its count without a reload");
  await A.screenshot({ path: join(shots, "inbox-live-arrived-1440-light.png") });
  // ---------- the open card keeps what the captain typed across live updates ----------
  const sel = `[data-inbox-studio] [data-scard="${c1.id}"]`;
  await A.fill(`${sel} [data-card-note]`, "narrow it to percent() only"); await A.focus(`${sel} [data-card-note]`);
  await A.evaluate((s) => { document.querySelector(s).__keep = "same element"; }, sel);
  const r2 = (await call("/api/wruns", { workflow: "code-firstmate", text: INTENT("Add a second percent helper"), params: {} })).j;
  const second = await waitFor(A, () => document.querySelectorAll("[data-inbox-studio] [data-scard]").length === 2, null, 120000);
  const c2 = (await call("/api/scards?open=1")).j.cards.find((c) => c.run === r2.id);
  ok(second && await A.evaluate((s) => document.querySelector(s)?.__keep === "same element", sel) && (await A.inputValue(`${sel} [data-card-note]`)) === "narrow it to percent() only",
    "a second card arrives while the captain types in the first: the first is not re-rendered and keeps its note", JSON.stringify([second, await A.inputValue(`${sel} [data-card-note]`).catch(() => null)]));
  ok(await A.evaluate((s) => document.activeElement === document.querySelector(`${s} [data-card-note]`), sel), "the note box keeps the keyboard focus while the other card arrives");
  ok(await waitFor(A, () => document.querySelector("#navInbox")?.textContent.trim() === "2", null, 5000) && (await A.locator("[data-new-card-cue]").count()) === 1 && /2/.test(await A.textContent("[data-new-card-cue]")),
    "the counts rise to 2 and the one cue now says two cards arrived", await A.textContent("[data-new-card-cue]").catch(() => ""));
  // ---------- answered on another page: it leaves the first ----------
  let ans = null; for (let i = 0; i < 40; i++) { ans = await call(`/api/scards/${c2.id}/answer`, { choice: (c2.options.find((o) => !o.note && o.id !== "dispatch") ?? c2.options.at(-1)).id }); if (ans.status === 200) break; await B.waitForTimeout(500); } // (a card is answerable once its checks finish raising it)
  ok(ans?.status === 200, "the second card is answered from another page", JSON.stringify(ans));
  ok(await waitFor(A, (id) => !document.querySelector(`[data-inbox-studio] [data-scard="${id}"]`) && document.querySelector("#navInbox")?.textContent.trim() === "1", c2.id, 10000)
    && await waitFor(C, (id) => !document.querySelector(`[data-need-scard="${id}"]`) && document.querySelector("#needsCount")?.textContent.trim() === "1", c2.id, 10000),
    "a card answered on another page leaves the Inbox, the sidebar count and the Board's Needs you", JSON.stringify([await dom(A), await dom(C), (await call(`/api/scards/${c2.id}`)).j.status]));
  ok((await A.inputValue(`${sel} [data-card-note]`)) === "narrow it to percent() only", "the card still open keeps its note when another one leaves");
  // ---------- withdrawn: its run is cancelled ----------
  await call(`/api/wruns/${r1.id}/cancel`, {});
  ok(await waitFor(A, (id) => !document.querySelector(`[data-inbox-studio] [data-scard="${id}"]`) && document.querySelector("#navInbox")?.textContent.trim() === "" && document.querySelector("#navNeeds")?.hidden, c1.id, 10000)
    && await waitFor(C, (id) => !document.querySelector(`[data-need-scard="${id}"]`), c1.id, 10000),
    "a withdrawn card (its run cancelled) leaves the Inbox, the counts and the Board", JSON.stringify([await dom(A), await dom(C), (await call(`/api/scards/${c1.id}`)).j.status]));
  // ---------- the captain is on one card (#/inbox/<id>, the Board's Open link) and answers it; the next card still shows ----------
  const r3 = (await call("/api/wruns", { workflow: "code-firstmate", text: INTENT("Add a third percent helper"), params: {} })).j;
  let c3 = null; for (let i = 0; i < 240 && !c3; i++) { c3 = (await call("/api/scards?open=1")).j.cards.find((c) => c.run === r3.id && c.ste); if (!c3) await A.waitForTimeout(500); }
  await A.evaluate((id) => { location.hash = `#/inbox/${id}`; }, c3.id); await A.waitForSelector(`[data-inbox-studio] [data-scard="${c3.id}"]`, { timeout: 10000 });
  const opt = c3.options.find((o) => !o.note && o.id !== "dispatch") ?? c3.options.at(-1);
  await A.click(`[data-inbox-studio] [data-scard="${c3.id}"] [data-option="${opt.id}"]`);
  await waitFor(A, (id) => !document.querySelector(`[data-inbox-studio] [data-scard="${id}"] [data-option]`), c3.id, 10000);
  const r4 = (await call("/api/wruns", { workflow: "code-firstmate", text: INTENT("Add a fourth percent helper"), params: {} })).j;
  const c4seen = await waitFor(A, () => !!document.querySelector("[data-inbox-studio] [data-scard]") && [...document.querySelectorAll("[data-inbox-studio] [data-scard]")].some((e) => e.querySelector("[data-option]")), null, 120000);
  const c4 = (await call("/api/scards?open=1")).j.cards.find((c) => c.run === r4.id);
  ok(c4seen && !!c4 && (await A.locator(`[data-inbox-studio] [data-scard="${c4.id}"]`).count()) === 1 && (await A.evaluate(() => location.hash)).startsWith(`#/inbox/${c3.id}`) && (await A.locator(`[data-inbox-gone="${c3.id}"]`).count()) === 1,
    "on one card's Inbox page (#/inbox/<id>), after the captain answers it, a newly raised card still appears there without a reload", JSON.stringify([c4seen, c4?.id, await dom(A)]));
  // ---------- the stream drops (Studio restarts) and the page cannot reconnect for a while: cards raised and withdrawn
  // meanwhile are right once it does ----------
  await A.evaluate(() => { location.hash = "#/inbox"; }); await A.waitForTimeout(500);
  await ctxA.route("**/api/stream", (r) => r.abort());
  await ctxC.route("**/api/stream", (r) => r.abort()); // the Board too: its Needs you must catch up from crew:live, not from a live scard event
  app.kill(); await new Promise((res) => app.once("exit", res)); app = startApp(); await waitUp(base, app);
  const downSeen = await waitFor(A, () => document.querySelector("#conn")?.classList.contains("bad"), null, 15000);
  const downSeenC = await waitFor(C, () => document.querySelector("#conn")?.classList.contains("bad"), null, 15000);
  // every event for c4 and c5 must fall inside the outage, so only the reconnect's re-read (crew:live) can bring the pages up to date:
  // c4 is settled (its STE check saved) before it is withdrawn, the withdrawal is confirmed, and c5 is read only once its STE check saved it
  for (let i = 0; i < 240 && !(await call(`/api/scards/${c4.id}`)).j.ste; i++) await B.waitForTimeout(500);
  await call(`/api/wruns/${r4.id}/cancel`, {});
  for (let i = 0; i < 40 && (await call(`/api/scards/${c4.id}`)).j.status === "open"; i++) await B.waitForTimeout(250);
  const r5 = (await call("/api/wruns", { workflow: "code-firstmate", text: INTENT("Add a fifth percent helper"), params: {} })).j;
  let c5 = null; for (let i = 0; i < 240 && !c5; i++) { c5 = (await call("/api/scards?open=1")).j.cards.find((c) => c.run === r5.id && c.ste); if (!c5) await B.waitForTimeout(500); } // settled: no scard event for it is left to arrive after the reconnect
  await B.waitForTimeout(1000);
  const before = await dom(A), beforeC = await dom(C);
  await ctxA.unroute("**/api/stream");
  await ctxC.unroute("**/api/stream");
  ok(downSeen && !!c5 && !before.inbox.includes(c5.id) && before.inbox.includes(c4.id) && await waitFor(A, (id) => !!document.querySelector(`[data-inbox-studio] [data-scard="${id}"]`), c5.id, 30000)
    && await waitFor(A, (id) => !document.querySelector(`[data-inbox-studio] [data-scard="${id}"]`), c4.id, 5000),
    "after the stream drops and reconnects, the card raised meanwhile shows and the one withdrawn meanwhile is gone", JSON.stringify([downSeen, c5?.id, before, await dom(A)]));
  ok(downSeenC && !!c5 && !beforeC.needs.includes(c5.id) && beforeC.needs.includes(c4.id)
    && await waitFor(C, ([n, g]) => !!document.querySelector(`[data-need-scard="${n}"]`) && !document.querySelector(`[data-need-scard="${g}"]`), [c5?.id, c4.id], 30000),
    "after the Board's stream drops and reconnects, its Needs you shows the card raised meanwhile and drops the one withdrawn meanwhile", JSON.stringify([downSeenC, beforeC, await dom(C)]));
  ok(await A.evaluate(() => window.__mark === "no-reload") && await C.evaluate(() => window.__mark === "no-reload"), "no page was reloaded along the way");
  await A.screenshot({ path: join(shots, "inbox-live-empty-1440-light.png") });
  await ctxA.close(); await ctxB.close(); await ctxC.close();
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-3000)); }
await browser.close(); app.kill();
console.log(`\ninbox-live-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
