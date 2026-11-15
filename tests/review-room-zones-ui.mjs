import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The room list's zones on the page (public/review-room.js; docs/units/review-room.md, "Coming back"), on the real server over
// fixture rooms: four zones, each grouped by repository; the captain archives a room and restores it, the archive outlives a
// restart of the server; search covers every zone and opens 封存, in either Chinese script. The sidebar is not touched.
// At 1440 (en, zh-TW) and 390 (zh-TW).        node tests/review-room-zones-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-zones-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-room-zones-ui-")), data = join(tmp, "data"), prDir = join(data, "review-room", "pr"); mkdirSync(prDir, { recursive: true });
const H = "a".repeat(40), B = "b".repeat(40), now = new Date().toISOString(), READ = "2026-11-01T11:00:00.000Z";
const turn = { n: 1, action: "teach", text: "x", lang: "en", by: "captain", at: "2026-11-01T10:00:00.000Z", status: "done", ended: "2026-11-01T10:05:00.000Z", job: null, provider: "p", model: "m", effort: null, answer: "a", error: null, cost: null, round: "r", head: H };
const room = (hex, n, repository, title, o = {}, snap = {}) => { const id = `PR-${hex.repeat(12)}-${n}`; writeFileSync(join(prDir, `${id}.json`), JSON.stringify({ schema: 1, run: "", card: id, node: "", head: H, base: B, turns: [], board: [], sources: [], check: { questions: [] },
  subject: { kind: "pr", room: id, url: `https://github.com/${repository}/pull/${n}`, repository, number: n, project: "p", task: null },
  pr: { title, body: "", state: "open", merged: false, mergedAt: null, closedAt: null, draft: false, author: "a", headRef: "x", headRepo: repository, baseRef: "main", head: H, base: B, files: [], notes: [], checkedAt: now, attemptedAt: now, truncated: false, stale: null, ...snap }, ...o })); return id; };
const waiting = room("a", 1, "acme/api", "Add rate limits"), waiting2 = room("b", 2, "acme/web", "軟體更新流程", { turns: [turn] }), reviewing = room("a", 3, "acme/api", "Rename the queue", { turns: [turn], read: READ }),
  merged = room("a", 4, "acme/api", "Fix the login", { turns: [turn], read: READ }, { state: "closed", merged: true }), archived = room("c", 5, "acme/old", "Drop the legacy cron", { turns: [turn], read: READ, archived: { by: "captain", at: READ } });

const port = await freePort(), base = `http://127.0.0.1:${port}`, env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const boot = async () => { const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data, CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
  app.stdout.resume(); await waitUp(base, app); return app; };
let app = await boot(), pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base), errors = [], shots = process.env.ROOM_SHOTS || join(root, "tests/out/review-room"); mkdirSync(shots, { recursive: true });
const open = async (lang, width) => { const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang]);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(`${base}/#/room`); await p.waitForSelector("[data-room-zones]", { timeout: 20000 }); return { p, ctx }; };
const zoneOf = (p, id) => p.$eval(`[data-room-row="${id}"]`, (e) => e.closest("[data-room-zone]").dataset.roomZone).catch(() => null);
const shows = (p, id) => p.$eval(`[data-room-link="${id}"]`, (e) => e.checkVisibility({ contentVisibilityAuto: true })).catch(() => false);
const search = async (p, q) => { await p.fill("[data-room-search]", q); await p.waitForTimeout(50); };

try {
  { const { p, ctx } = await open("en", 1440);
    ok(JSON.stringify(await p.$$eval("[data-room-zone]", (els) => els.map((e) => e.dataset.roomZone))) === '["waiting","reviewing","concluded","archived"]', "four zones, in order");
    ok(await zoneOf(p, waiting) === "waiting" && await zoneOf(p, reviewing) === "reviewing" && await zoneOf(p, merged) === "concluded" && await zoneOf(p, archived) === "archived", "each room is in its zone: a merged one in 已結論, not 封存");
    const repos = await p.$$eval('[data-room-zone="waiting"] [data-room-repo]', (els) => els.map((e) => [e.dataset.roomRepo, e.querySelector("h4").textContent, e.querySelectorAll("li").length]));
    ok(JSON.stringify(repos) === '[["acme/api","acme/api",1],["acme/web","acme/web",1]]', "inside a zone, rooms are grouped by repository", JSON.stringify(repos));
    ok(!await shows(p, archived) && await p.$eval('[data-room-zone="archived"]', (e) => e.tagName === "DETAILS" && !e.open), "封存 is out of the main list: folded until asked for");
    ok(await p.$eval(".nav-item[data-view=\"room\"]", (e) => !!e.getClientRects().length) && !await p.$("nav [data-room-zone], .sidebar [data-room-zone]"), "the zones live in the page's list, the sidebar has its one item as before");
    await p.screenshot({ path: join(shots, "zones-en-1440.png"), fullPage: true });

    // ---- archive and restore, on the row ----
    await p.click(`[data-room-archive="${reviewing}"]`); await p.waitForFunction((id) => document.querySelector(`[data-room-row="${id}"]`)?.closest("[data-room-zone]")?.dataset.roomZone === "archived", reviewing);
    ok(!await shows(p, reviewing) && /1|2/.test(await p.$eval('[data-room-zone="archived"] .rr-zonecount', (e) => e.textContent)), "archiving moves the room out of the main list into 封存");
    ok(await p.$eval('[data-room-zone="reviewing"]', (e) => /Nothing here/.test(e.textContent)), "a zone with nothing left says so");

    // ---- it outlives the server ----
    app.kill("SIGTERM"); await new Promise((r) => app.once("exit", r)); app = await boot();
    await p.goto(`${base}/session?t=${encodeURIComponent(process.env.CREW_SESSION_TOKEN)}`); await p.goto(`${base}/#/room`); await p.reload(); await p.waitForSelector("[data-room-zones]", { timeout: 20000 });
    ok(await zoneOf(p, reviewing) === "archived", "after a restart of the server the room is still in 封存");

    await p.click('[data-room-zone="archived"] summary'); await p.waitForFunction((id) => document.querySelector(`[data-room-link="${id}"]`)?.checkVisibility(), reviewing); await p.waitForTimeout(150); // toggle has fired: the page remembers 封存 is open
    await p.click(`[data-room-restore="${reviewing}"]`); await p.waitForFunction((id) => document.querySelector(`[data-room-row="${id}"]`)?.closest("[data-room-zone]")?.dataset.roomZone === "reviewing", reviewing);
    ok(await shows(p, reviewing) && await p.$eval('[data-room-zone="archived"]', (e) => e.open), "restoring brings it back to its zone, and 封存 stays open as the captain left it");
    await p.waitForTimeout(400); await p.click('[data-room-zone="archived"] summary'); await p.waitForTimeout(150); // the list has been read again by now; toggle has fired

    // ---- search ----
    await search(p, "legacy CRON");
    ok(await shows(p, archived) && await p.$eval('[data-room-zone="archived"]', (e) => e.open) && (await p.$$("[data-room-row]")).length === 1, "search finds an archived room: 封存 opens, only the match shows");
    ok(await p.evaluate(() => document.activeElement?.matches("[data-room-search]")), "the search box keeps the focus while the list changes");
    await search(p, "acme/api"); ok(await shows(p, waiting) && await shows(p, reviewing) && await shows(p, merged) && !await shows(p, waiting2), "search reads the repository, across zones");
    await search(p, "软件"); ok(await shows(p, waiting2) && (await p.$$("[data-room-row]")).length === 1, "a Simplified query finds a Traditional title (opencc-js, i18n.js)");
    await search(p, "no such room"); ok(!!await p.$("[data-room-nomatch]") && !(await p.$$("[data-room-row]")).length, "no match says so");
    await search(p, ""); ok((await p.$$("[data-room-zone]")).length === 4 && !await shows(p, archived), "cleared, the four zones are back and 封存 folds again", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("[data-room-zone]")].map((e) => [e.dataset.roomZone, e.tagName, e.open]))));

    // ---- the list follows the live stream: a room changed elsewhere moves without a reload ----
    const post = (id, archived) => p.evaluate(([i, a]) => fetch(`/api/review-room/${i}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: a }) }).then((r) => r.status), [id, archived]);
    await p.$eval("[data-room-search]", (e) => { e.__same = true; }); await post(merged, true);
    ok(await p.waitForFunction((id) => document.querySelector(`[data-room-row="${id}"]`)?.closest("[data-room-zone]")?.dataset.roomZone === "archived", merged, { timeout: 5000 }).then(() => true, () => false), "a live review-room event reads the list again: the room moves by itself");
    ok(await p.$eval("[data-room-search]", (e) => !!e.__same), "a redraw from the live stream leaves the search box alone: a composition in it is not broken");
    await post(merged, false); await p.waitForFunction((id) => document.querySelector(`[data-room-row="${id}"]`)?.closest("[data-room-zone]")?.dataset.roomZone === "concluded", merged);

    // ---- an answer that ends with the captain on the room is read; one that ends with the window hidden is not ----
    { let running = 1; const asked = []; const watch = async (r) => { const res = await r.fetch(), j = await res.json(); asked.push(r.request().url()); await r.fulfill({ json: { ...j, running } }); }, url = new RegExp(`/api/review-room/${reviewing}(\\?open=1)?$`);
      await p.route(url, watch); await p.click(`[data-room-link="${reviewing}"]`); await p.waitForSelector("[data-board]", { timeout: 15000 }); await p.waitForTimeout(300);
      asked.length = 0; await p.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true })); running = null; await p.waitForTimeout(3200);
      ok(asked.length && !asked.some((u) => u.endsWith("?open=1")), "a turn that ends while the window is hidden is not marked read", JSON.stringify(asked));
      await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
      ok(await (async () => { for (let i = 0; i < 40 && !asked.some((u) => u.endsWith("?open=1")); i++) await p.waitForTimeout(100); return asked.some((u) => u.endsWith("?open=1")); })(), "coming back to the window reads the answer that came meanwhile", JSON.stringify(asked));
      asked.length = 0; await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await p.waitForTimeout(300);
      ok(!asked.some((u) => u.endsWith("?open=1")), "coming back with nothing new reads nothing: that read would go to GitHub", JSON.stringify(asked));
      running = 1; await p.evaluate(() => { location.hash = "#/room"; }); await p.waitForSelector("[data-room-zones]"); await p.click(`[data-room-link="${reviewing}"]`); await p.waitForSelector("[data-board]"); await p.waitForTimeout(300);
      asked.length = 0; running = null;
      ok(await (async () => { for (let i = 0; i < 40 && !asked.some((u) => u.endsWith("?open=1")); i++) await p.waitForTimeout(100); return asked.some((u) => u.endsWith("?open=1")); })(), "a turn that ends with the captain on the room reads it as an arrival (?open=1), so it does not wait for them on the list", JSON.stringify(asked));
      await p.unroute(url, watch); await p.evaluate(() => { location.hash = "#/room"; }); await p.waitForSelector("[data-room-zones]"); }

    // ---- the room's own header ----
    await p.click(`[data-room-link="${waiting}"]`); await p.waitForSelector(`[data-room-archive="${waiting}"]`, { timeout: 15000 });
    await p.click(`[data-room-archive="${waiting}"]`); await p.waitForSelector("[data-room-archived]"); await p.waitForSelector(`[data-room-restore="${waiting}"]`);
    ok(true, "a room archives from its own header, says so, and offers Restore there");
    await p.click(`[data-room-restore="${waiting}"]`); await p.waitForSelector(`[data-room-archive="${waiting}"]`); ok(!await p.$("[data-room-archived]"), "restored from the header, the mark goes");
    // archived in the room, changed elsewhere, back on the list: the list is read again
    await p.click(`[data-room-archive="${waiting}"]`); await p.waitForSelector("[data-room-archived]"); await post(waiting, false); await p.evaluate(() => { location.hash = "#/room"; });
    ok(await p.waitForFunction((id) => document.querySelector(`[data-room-row="${id}"]`)?.closest("[data-room-zone]")?.dataset.roomZone === "waiting", waiting, { timeout: 5000 }).then(() => true, () => false), "coming back from a room reads the list again, after an archive in the room too");
    await ctx.close(); }

  { const { p, ctx } = await open("zh-TW", 1440);
    const heads = await p.$$eval("[data-room-zone] h3", (els) => els.map((e) => e.firstChild.textContent));
    ok(JSON.stringify(heads) === '["等我看","審查中","已結論","封存"]', "the zones in the captain's words", JSON.stringify(heads));
    await p.screenshot({ path: join(shots, "zones-zh-1440.png"), fullPage: true }); await ctx.close(); }

  { const { p, ctx } = await open("zh-TW", 390);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "at 390 the list does not scroll sideways", await p.evaluate(() => `${document.documentElement.scrollWidth}`));
    await p.screenshot({ path: join(shots, "zones-zh-390.png"), fullPage: true }); await ctx.close(); }
  ok(!errors.length, "no page error", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nreview-room-zones-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
