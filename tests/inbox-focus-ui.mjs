import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Inbox shows one card at a time (unit inbox-focus): with four open cards it lists four rows (oldest first) and
// renders exactly one card in full; the card's sticky header and its primary button name the Task, so the captain
// cannot answer the wrong one; ↑/↓ and j/k move the selection; an answer leaves the list, says "Recorded for <task>"
// and selects the next card; #/inbox/<id> selects that card; at 390 the list comes first and a row opens its card
// alone, with Back to list. The four cards are served to the page (its /api/scards calls), so the test owns them.
//      node tests/inbox-focus-ui.mjs      (INBOX_FOCUS_SHOTS=<dir> also writes the 1440 and 390 screenshots there)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("inbox-focus-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-inboxfocus-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shotDir = process.env.INBOX_FOCUS_SHOTS || join(root, "tests/out"); mkdirSync(shotDir, { recursive: true });
const phase = process.env.INBOX_FOCUS_PHASE || "after";

// ---------- four open cards, raised a minute apart (SC-701 has waited longest) ----------
const VIDEO = "巷口豆花宣傳短片";
const sec = (why) => ({ en: { why }, "zh-TW": { why } });
const plain = (n, kind, run, workflow, runTitle, title, why, options) => ({ id: `SC-70${n}`, run, node: kind === "dispatch" ? "dispatch" : "ask", visit: 1, kind, title: { en: title, "zh-TW": title },
  sections: sec(why), body: why, options, confirmDoor: false, door: null, links: [], detail: null, workflow, runTitle, ledger: null, ste: null, status: "open",
  createdAt: new Date(Date.parse("2026-10-17T08:00:00Z") + n * 60000).toISOString(), answer: null });
const acceptance = { ...plain(1, "acceptance", "R-701", "promo-video", VIDEO, `Accept ${VIDEO}?`, "The film is ready for your review.", [
  { id: "approve", label: "Approve", labelZh: "核准", primary: true }, { id: "changes", label: "Request changes", labelZh: "要求修改", note: true, hold: true }, { id: "reject", label: "Reject", labelZh: "不採用" }]),
  node: "accept", detail: { intent: { en: `A 30-second promo film for ${VIDEO}` }, intents: [], why: [], how: [], scope: { in: [], out: [] }, done: [], beforeAfter: { text: "", images: [] }, walk: [], gates: [],
    artifactAcceptance: { offered: [{ id: "A-701", n: 1, producer: "video" }] } } };
const CARDS = () => [acceptance,
  plain(2, "dispatch", "R-702", "code-firstmate", "Add a percent helper", "Dispatch: Add a percent helper?", "Firstmate drafted the spec.", [{ id: "dispatch", label: "Dispatch", labelZh: "派工", primary: true }, { id: "close", label: "Close", labelZh: "關閉", hold: true }]),
  plain(3, "question", "R-703", "brand-kit", "Night market poster", "Which palette?", "The designer asks which palette to keep.", [{ id: "warm", label: "Warm", labelZh: "暖色", primary: true }, { id: "cool", label: "Cool", labelZh: "冷色" }]),
  plain(4, "failure", "R-704", "hello-web", "Hello web page", "Round cannot start: the build failed", "The build step failed twice.", [{ id: "retry", label: "Retry", labelZh: "重試", primary: true }, { id: "close", label: "Close task", labelZh: "關閉任務", hold: true }])];
const serve = async (ctx) => { let cards = CARDS(); const answers = [];
  await ctx.route(/\/api\/scards(\/[^?]*)?(\?.*)?$/, async (r) => { const u = new URL(r.request().url()); const m = /^\/api\/scards\/(SC-\d+)(?:\/(answer))?$/.exec(u.pathname);
    if (m?.[2] === "answer") { const b = r.request().postDataJSON(); const c = cards.find((x) => x.id === m[1]); if (!c) return r.fulfill({ status: 400, json: { error: "no such open card" } });
      cards = cards.filter((x) => x.id !== c.id); answers.push({ id: c.id, ...b }); return r.fulfill({ json: { ...c, status: "answered", answer: { choice: b.choice, by: "captain", at: new Date().toISOString() } } }); }
    if (m) { const c = cards.find((x) => x.id === m[1]); return c ? r.fulfill({ json: c }) : r.fulfill({ status: 404, json: { error: "no such card" } }); }
    return r.fulfill({ json: { cards: u.searchParams.get("open") === "1" ? cards : cards } }); });
  return answers; };
const open = async (width, hash = "#/inbox", { chat = false, zh = false, scardsDown = false, staleSummary = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: "light" });
  // staleSummary: the page's first summary is from before firstmate wrote its cards (no pending ones); later reads are real
  if (staleSummary) { let first = true; await ctx.route(/\/api\/summary$/, async (r) => { if (!first) return r.continue(); first = false; const res = await r.fetch(); return r.fulfill({ response: res, json: { ...(await res.json()), pending: [] } }); }); }
  const answers = scardsDown ? (await ctx.route(/\/api\/scards/, (r) => r.fulfill({ status: 500, json: { error: "down" } })), []) : await serve(ctx);
  await ctx.addInitScript(([chat, zh]) => { try { localStorage.setItem("crew.chatOpen", chat ? "1" : "0"); localStorage.setItem("crew.lang", zh ? "zh-TW" : "en"); } catch {} }, [chat, zh]);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
  await p.goto(`${base}/${hash}`); await p.waitForSelector("[data-scard]", { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400);
  if (!chat) await p.evaluate(() => document.body.classList.add("chat-closed"));
  return { ctx, p, answers };
};
const shot = (p, name) => p.screenshot({ path: join(shotDir, `${phase}-${name}.png`) });
const visible = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").length, sel);
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll("#main")].some((m) => m.scrollWidth > m.clientWidth + 1));
if (process.env.INBOX_FOCUS_SHOTS_ONLY) { // the screenshots alone (taken before a layout change, to compare)
  for (const w of [1440, 390]) { const { ctx, p } = await open(w); await p.evaluate(() => { document.querySelector("#main").scrollTop = 0; }); await shot(p, String(w)); await p.screenshot({ path: join(shotDir, `${phase}-${w}-full.png`), fullPage: true }); await ctx.close(); }
  await browser.close(); app.kill(); process.exit(0); }
try {
  // ---------- wide: the list and the one selected card ----------
  { const { ctx, p, answers } = await open(1440);
    await shot(p, "1440");
    ok(await p.locator("[data-inbox-row]").count() === 4, "the list shows one row per open card (4)", String(await p.locator("[data-inbox-row]").count()));
    ok(await p.locator("[data-scard]").count() === 1 && await p.getAttribute("[data-scard]", "data-scard") === "SC-701", "only one card is rendered in full: the oldest one, waiting longest",
      JSON.stringify(await p.$$eval("[data-scard]", (es) => es.map((e) => e.dataset.scard))));
    ok(JSON.stringify(await p.$$eval("[data-inbox-row]", (es) => es.map((e) => e.dataset.inboxRow))) === JSON.stringify(["SC-701", "SC-702", "SC-703", "SC-704"]), "rows are ordered oldest first");
    ok(await p.getAttribute('[data-inbox-row="SC-701"]', "aria-selected") === "true" && await p.locator('[data-inbox-row][aria-selected="true"]').count() === 1, "the selected row is marked, and only it");
    const row = await p.textContent('[data-inbox-row="SC-702"]');
    ok(/dispatch/.test(row) && /code-firstmate/.test(row) && /R-702/.test(row) && /Add a percent helper/.test(row), "a row names the kind, the workflow, the Task and its run", row);
    const head = await p.textContent("[data-inbox-head]");
    ok([VIDEO, "promo-video", "R-701", "SC-701"].every((x) => head.includes(x)), "the card's header names the Task, workflow, run and card", head);
    const approve = (await p.textContent('[data-scard="SC-701"] [data-option="approve"]')).trim();
    ok(approve === `Approve · ${VIDEO} v1`, "the primary button carries its target: Approve · <Task> v1", approve);
    ok(await visible(p, '[data-inbox-back]') === 0, "wide: no Back to list (the list is beside the card)");
    // the header stays on screen while the card scrolls
    await p.evaluate(() => { const c = document.querySelector("[data-scard]"); c.append(Object.assign(document.createElement("div"), { style: "height:2400px" })); document.querySelector("#main").scrollTop = 1500; });
    await p.waitForTimeout(100);
    ok(await p.evaluate(() => { const r = document.querySelector("[data-inbox-head]").getBoundingClientRect(), m = document.querySelector("#main").getBoundingClientRect(); return r.top >= m.top - 1 && r.top < m.top + 80; }), "the header stays visible while the card scrolls");
    // the arrow keys read a long card: ↓ after a click in the card's text, and j/k on its buttons, leave the selection alone
    await p.click('[data-scard="SC-701"] .cc-quote'); await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("j"); await p.waitForTimeout(150);
    ok(await p.getAttribute("[data-scard]", "data-scard") === "SC-701" && (await p.evaluate(() => location.hash)) === "#/inbox", "↓ and j inside the card's text do not switch the card",
      JSON.stringify(await p.evaluate(() => [document.querySelector("[data-scard]")?.dataset.scard, location.hash, document.activeElement?.tagName])));
    await p.focus('[data-scard="SC-701"] [data-option="reject"]'); await p.keyboard.press("k"); await p.keyboard.press("j"); await p.keyboard.press("ArrowDown"); await p.waitForTimeout(150);
    ok(await p.getAttribute("[data-scard]", "data-scard") === "SC-701", "j, k and ↓ on one of the card's buttons do not switch the card");
    await p.evaluate(() => { document.querySelector("#main").scrollTop = 0; });
    // keyboard on the list
    await p.click('[data-inbox-row="SC-701"]'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => document.activeElement?.dataset?.inboxRow) === "SC-701", "a clicked row keeps the keyboard focus");
    await p.keyboard.press("ArrowDown"); await p.waitForTimeout(150);
    ok(await p.getAttribute("[data-scard]", "data-scard") === "SC-702" && (await p.evaluate(() => location.hash)) === "#/inbox/SC-702" && await p.getAttribute('[data-inbox-row="SC-702"]', "aria-selected") === "true", "↓ on a row selects the next card");
    ok(await p.evaluate(() => document.activeElement?.dataset?.inboxRow) === "SC-702", "the focus follows to the newly selected row");
    await p.keyboard.press("j"); await p.waitForTimeout(150);
    ok(await p.getAttribute("[data-scard]", "data-scard") === "SC-703", "j selects the next card");
    await p.keyboard.press("k"); await p.keyboard.press("ArrowUp"); await p.waitForTimeout(150);
    ok(await p.getAttribute("[data-scard]", "data-scard") === "SC-701" && await p.locator("[data-scard]").count() === 1, "k and ↑ go back; still one card rendered");
    // answer: the card leaves, the next is selected, the captain is told which Task was recorded
    await p.click('[data-scard="SC-701"] [data-option="approve"]');
    ok(await p.waitForFunction(() => document.querySelectorAll("[data-inbox-row]").length === 3 && document.querySelector("[data-scard]")?.dataset.scard === "SC-702", null, { timeout: 10000 }).then(() => true, () => false),
      "after the answer the card leaves the list and the next card is selected", JSON.stringify(await p.$$eval("[data-inbox-row]", (es) => es.map((e) => e.dataset.inboxRow))));
    ok(answers.length === 1 && answers[0].id === "SC-701" && answers[0].choice === "approve", "the answer went to the card on screen (SC-701 approve)", JSON.stringify(answers));
    const rec = await p.textContent("[data-inbox-recorded]").catch(() => "");
    ok(rec.includes(`Recorded for ${VIDEO}`), "a short line says which Task's answer was recorded", rec);
    ok(await p.waitForFunction((v) => (document.querySelector("[data-inbox-live]")?.textContent || "").includes(`Recorded for ${v}. Next: Add a percent helper.`), VIDEO, { timeout: 3000 }).then(() => true, () => false)
      && await p.evaluate(() => { const l = document.querySelector("[data-inbox-live]"); return l.getAttribute("role") === "status" && l.getAttribute("aria-live") === "polite" && !document.querySelector("#view").contains(l); }),
      "a live region that stays outside the re-rendered page announces the answer and the next card", await p.textContent("[data-inbox-live]").catch(() => "none"));
    ok(await p.evaluate(() => document.activeElement?.dataset?.inboxHead) === "SC-702", "the keyboard focus moves to the next card's header, not the page", await p.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.className}`));
    ok((await p.textContent('[data-scard="SC-702"] [data-option="dispatch"]')).trim() === "Dispatch · Add a percent helper" && await p.getAttribute('[data-inbox-row="SC-702"]', "aria-selected") === "true", "the next card's button names its own Task");
    await shot(p, "1440-after-answer");
    await ctx.close(); }
  // ---------- deep link ----------
  { const { ctx, p } = await open(1440, "#/inbox/SC-704");
    ok(await p.getAttribute("[data-scard]", "data-scard") === "SC-704" && await p.getAttribute('[data-inbox-row="SC-704"]', "aria-selected") === "true" && await p.locator("[data-scard]").count() === 1, "#/inbox/<id> selects that card");
    await p.goto(`${base}/#/inbox/SC-799`); await p.waitForTimeout(500);
    ok(await p.locator('[data-inbox-gone="SC-799"]').count() === 1 && await p.locator("[data-inbox-row]").count() === 4 && await p.locator("[data-scard]").count() === 1, "a link to a card no longer waiting says so and still shows the list and one card");
    await ctx.close(); }
  // ---------- zh-TW ----------
  { const { ctx, p } = await open(1440, "#/inbox", { zh: true });
    const approve = (await p.textContent('[data-scard="SC-701"] [data-option="approve"]').catch(() => "")).trim();
    ok(approve === `核准 · ${VIDEO} v1`, "zh-TW: the primary button reads 核准 · <Task> v1", approve);
    await ctx.close(); }
  // ---------- the Firstmate panel open beside it (the desktop default): a compact rail beside the oldest card, no click needed ----------
  for (const width of [1440, 1280]) { const { ctx, p } = await open(width, "#/inbox", { chat: true });
    const main = await p.evaluate(() => !document.body.classList.contains("chat-closed") ? document.querySelector("#main").clientWidth : 0);
    await shot(p, `${width}-chat-open`);
    ok(main > 0 && main < 900, `${width} with the panel open: the page is under 900px (${main})`);
    ok(await visible(p, "[data-inbox-row]") === 4 && await visible(p, "[data-scard]") === 1 && await p.getAttribute("[data-scard]", "data-scard") === "SC-701" && await visible(p, "[data-inbox-back]") === 0,
      `${width} with the panel open: the list rail and the oldest card show together at once`);
    const rail = await p.evaluate(() => { const l = document.querySelector(".ib-list").getBoundingClientRect(), c = document.querySelector(".ib-detail").getBoundingClientRect(); return { l: l.width, side: c.left >= l.right - 1 }; });
    const row = p.locator('[data-inbox-row="SC-702"]');
    ok(rail.side && rail.l <= 240 && await visible(p, '[data-inbox-row="SC-702"] .ib-wf') === 0 && (await row.getAttribute("title")) === "Add a percent helper" && /Add a percent helper · dispatch · code-firstmate · R-702/.test(await row.getAttribute("aria-label")),
      `${width} with the panel open: the rail is narrow (kind, title, age) and the full title is on hover and in its label`, JSON.stringify(rail));
    await row.click(); await p.waitForTimeout(300);
    ok(await p.getAttribute("[data-scard]", "data-scard") === "SC-702" && await visible(p, "[data-inbox-row]") === 4, `${width} with the panel open: a rail row selects its card, the rail stays`);
    ok(!(await sideways(p)), `${width} with the panel open: nothing scrolls sideways`);
    await ctx.close(); }
  // ---------- phone: list first, then one card full width ----------
  { const { ctx, p } = await open(390);
    await shot(p, "390");
    ok(await visible(p, "[data-inbox-row]") === 4 && await visible(p, "[data-scard]") === 0, "390: the list shows, no card under it");
    await p.click('[data-inbox-row="SC-703"]'); await p.waitForTimeout(300);
    ok(await visible(p, "[data-scard]") === 1 && await p.getAttribute("[data-scard]", "data-scard") === "SC-703" && await visible(p, "[data-inbox-row]") === 0, "390: a tap opens that card alone, full width");
    const w = await p.evaluate(() => [document.querySelector("[data-scard]").getBoundingClientRect().width, document.querySelector("#main").clientWidth]);
    ok(w[0] >= w[1] - 48, "390: the card takes the width", JSON.stringify(w));
    ok(await visible(p, "[data-inbox-back]") === 1 && !(await sideways(p)), "390: Back to list shows and nothing scrolls sideways");
    await shot(p, "390-card");
    await p.click("[data-inbox-back]"); await p.waitForTimeout(300);
    ok(await visible(p, "[data-inbox-row]") === 4 && await visible(p, "[data-scard]") === 0, "390: Back returns to the list");
    await ctx.close(); }
  // ---------- Studio's cards cannot be read: firstmate's cards still list, select and move with j/k ----------
  for (const n of [1, 2]) writeFileSync(join(state, "pending", `D-focus-${n}.json`), JSON.stringify({ id: `D-focus-${n}`, purpose: "question", kind: "choice", title: `Firstmate question ${n}`, ts: `2026-10-17T07:0${n}:00.000Z`,
    details: { en: { title: `Firstmate question ${n}`, options: { A: { description: "Yes" }, B: { description: "No" } } } } }));
  // the summary a page loads right after a card file lands holds that card (it no longer waits for the next poll tick: a page
  // that read the summary before the tick and connected its live events after it never saw the card)
  const fresh = await fetch(`${base}/api/summary`, { headers: { "x-crew-session": process.env.CREW_SESSION_TOKEN } }).then((r) => r.json());
  ok(["D-focus-1", "D-focus-2"].every((id) => fresh.pending?.some((c) => c.id === id)), "the summary read right after firstmate writes its cards already holds them", JSON.stringify(fresh.pending?.map((c) => c.id)));
  { const { ctx, p } = await open(1440, "#/inbox", { scardsDown: true });
    const listed = await p.waitForFunction(() => document.querySelectorAll("[data-inbox-row]").length === 2, null, { timeout: 15000 }).then(() => true, () => false);
    ok(listed && await p.getAttribute("[data-card]", "data-card") === "D-focus-1", "with /api/scards failing, firstmate's cards list and the oldest is shown");
    await p.locator("h1").first().click(); await p.keyboard.press("j"); await p.waitForTimeout(150);
    ok(await p.getAttribute("[data-card]", "data-card") === "D-focus-2" && await p.getAttribute('[data-inbox-row="D-focus-2"]', "aria-selected") === "true", "with /api/scards failing, j still moves the selection");
    await ctx.close(); }
  // the page read its summary before the cards landed and its stream connected after the server announced them: the
  // stream's hello reads the cards again, so they still list
  { const { ctx, p } = await open(1440, "#/inbox", { scardsDown: true, staleSummary: true });
    const listed = await p.waitForFunction(() => document.querySelectorAll("[data-inbox-row]").length === 2, null, { timeout: 10000 }).then(() => true, () => false);
    ok(listed, "a summary read before firstmate's cards landed: the stream's hello reads them again and they list");
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-3000)); }
await browser.close(); app.kill();
console.log(`\ninbox-focus-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
