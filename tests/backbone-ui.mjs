// The backbone sidebar (docs/architecture.md §2): exactly Board, Firstmate, Inbox, Crew,
// Runs, Workflows, Library and a gear; labs routes show a roadmap panel without the
// flag and work with it (Settings toggle or ?labs=1); home is the Board; the
// roadmap page lists the planned items. 1440 and 390, light and dark.
//   node tests/backbone-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("backbone-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-bb-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
const ev = (i) => JSON.stringify({ ts: new Date(Date.now() - (5 - i) * 60000).toISOString(), actor: "firstmate", type: "crew_status", task: "T-001", summary: { en: `crew note ${i}`, "zh-TW": `船員記錄 ${i}` } });
writeFileSync(join(state, "events.jsonl"), [1, 2, 3].map(ev).join("\n") + "\n");
writeFileSync(join(data, "intents.jsonl"), JSON.stringify({ id: "I-001", ts: new Date().toISOString(), goal: "Add a price filter", details: "", constraints: null, deadline: null, budget: null, text: "Add a price filter", status: "received", source: "chat" }) + "\n");
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
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
const shots = join(root, "tests/out"); mkdirSync(shots, { recursive: true });
const LABS = ["improve", "retro/x", "skill/code/worker", "packs", "pack-draft/x", "fileorg", "docs", "doc/x", "skins", "changes", "change/x", "gates", "remote"];
try {
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    // keep the page's event source reachable, so a test can deliver an SSE event
    await ctx.addInitScript(() => { const ES = window.EventSource; window.EventSource = class extends ES { constructor(...a) { super(...a); window.__es = this; } }; });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
    await p.goto(`${base}/`); await p.waitForTimeout(600);
    ok(p.url().endsWith("#/board"), `home is the Board at ${width} ${scheme}`, p.url());
    const views = await p.$$eval(".nav > .nav-item", (bs) => bs.filter((b) => !b.hidden && getComputedStyle(b).display !== "none").map((b) => b.dataset.view));
    ok(JSON.stringify(views) === JSON.stringify(["board", "firstmate", "inbox", "crew", "runs", "workflows", "library"]), `the sidebar has exactly the seven backbone items at ${width} ${scheme}`, JSON.stringify(views));
    ok(await p.locator(".side-foot #navSettings").isVisible(), `the gear is at the sidebar foot at ${width} ${scheme}`);
    ok(!(await p.locator(".nav-labs").isVisible()) && (await p.locator(".nav-labs .nav-item").count()) > 0, `labs items are out of the sidebar without the flag at ${width} ${scheme}`);
    ok((await p.locator('.nav-item[data-view="inbox"] .bb-intents').count()) === 0 && (await p.locator("#navSettings #navDoctor").count()) === 1, `the attention counts sit on the backbone: the Inbox counts decisions only, the Doctor's count is on the gear at ${width} ${scheme}`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll at ${width} ${scheme}`);
    await p.screenshot({ path: join(shots, `backbone-sidebar-${width}-${scheme}.png`) });
    if (width === 1440 && scheme === "light") {
      // the page holds one event stream, however many views and modules are open (6 connections per host is all a browser keeps)
      { const q = await ctx.newPage(); let streams = 0; q.on("request", (r) => { if (new URL(r.url()).pathname === "/api/stream") streams++; });
        for (const v of ["#/inbox", "#/crew", "#/runs", "#/workflows", "#/firstmate", "#/settings", "#/library"]) { await q.goto(`${base}/${v}`); await q.waitForTimeout(250); }
        const n = await q.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.endsWith("/api/stream")).length);
        ok(streams === 1 && n <= 1, "the page opens one event stream, with several views and modules open", JSON.stringify({ streams, n })); await q.close(); }
      await p.click("#navSettings"); await p.waitForTimeout(200);
      ok(p.url().endsWith("#/settings") && await p.locator("#labsToggle").isVisible(), "clicking the gear opens Settings");
      ok(await p.locator('a[href="#/doctor"]', { hasText: "Doctor" }).isVisible() && await p.locator('a[href="#/remote"]', { hasText: "Phone pairing" }).isVisible() && await p.locator('a[href="#/roadmap"]', { hasText: "Roadmap" }).isVisible() && await p.locator("label", { hasText: "Show labs" }).isVisible(), "settings holds Doctor, phone pairing, the roadmap and the Show labs switch");
      for (const r of LABS) { await p.goto(`${base}/#/${r}`); await p.waitForTimeout(150);
        const panel = p.locator("[data-roadmap-panel]");
        ok(await panel.isVisible() && /This is on the roadmap/.test(await panel.textContent()) && await panel.locator("button", { hasText: "Show labs" }).isVisible() && /M\d/.test(await panel.textContent()), `#/${r} without labs shows the roadmap panel (text, milestone, Show labs), not a 404`); }
      await p.goto(`${base}/#/packs`); await p.waitForSelector("[data-roadmap-panel] button");
      await p.locator("[data-roadmap-panel] button", { hasText: "Show labs" }).click(); await p.waitForTimeout(400);
      ok(!(await p.locator("[data-roadmap-panel]").count()) && await p.locator("h1", { hasText: "Packs" }).isVisible() && await p.locator(".nav-labs").isVisible(), "the panel's Show labs renders the real page and the labs group");
      await p.goto(`${base}/#/settings`); await p.uncheck("#labsToggle"); await p.waitForTimeout(100);
      ok(!(await p.locator(".nav-labs").isVisible()), "unticking Show labs hides the labs group again");
      await p.check("#labsToggle"); await p.waitForTimeout(150);
      ok(await p.locator(".nav-labs").isVisible() && (await p.locator(".nav-labs .nav-item").count()) > 0 && await p.evaluate(() => localStorage.getItem("crew.labs") === "1"), "Show labs (Settings) puts the labs items back in the sidebar");
      await p.goto(`${base}/#/roadmap`); await p.waitForSelector("[data-roadmap]");
      const rows = await p.$$eval("[data-roadmap]", (rs) => rs.map((r) => ({ m: r.querySelector(".tid")?.textContent?.trim(), planned: /planned/.test(r.querySelector(".badge")?.textContent ?? ""), t: r.querySelector(".bb-rm-t")?.textContent?.trim() })));
      ok(rows.length === 7 && rows.every((r) => /^M\d/.test(r.m) && r.planned && r.t.length > 20) && JSON.stringify(rows.map((r) => r.m)) === JSON.stringify(["M4/M5", "M6", "M7", "M7", "M8", "M3/gates", "M2.5"]), "the roadmap lists each planned item with its milestone and a description", JSON.stringify(rows));
      await p.goto(`${base}/#/crew`);
      ok(await p.waitForSelector("[data-crew-activity] .ev", { timeout: 4000 }).then(() => true, () => false), "Crew shows the activity log on a cold load (activity folds into Crew)");
      { // the embed keeps its own unfiltered list and leaves #/activity's filter alone
        const all = await p.evaluate(() => fetch("/api/activity?limit=25").then((r) => r.json()));
        const type = "nobody-by-this-name"; // an actor filter that matches nothing
        await p.goto(`${base}/#/activity`); await p.waitForSelector("#evlist", { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(400);
        await p.fill(".filters input", type); await p.press(".filters input", "Enter"); await p.waitForTimeout(600);
        const filtered = await p.locator("#evlist .ev").count();
        await p.goto(`${base}/#/crew`); await p.waitForSelector("[data-crew-activity] .ev"); await p.waitForTimeout(300);
        const shown = await p.$$eval("[data-crew-activity] .ev", (es) => es.length);
        await p.goto(`${base}/#/activity`); await p.waitForSelector("#evlist", { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(600);
        ok(!!type && filtered < all.length && shown === Math.min(25, all.length) && (await p.locator("#evlist .ev").count()) === filtered && (await p.inputValue(".filters input")) === type,
          "Crew's activity is the unfiltered log after a filtered #/activity visit, and the filter is still there when you go back", JSON.stringify({ type, shown, all: all.length, filtered })); }
      { // a Crew re-render after the list is older than 3 s (an SSE crew event, a language switch) keeps the activity block and its items
        await p.goto(`${base}/#/crew`); await p.waitForSelector("[data-crew-activity] .ev");
        let fetches = 0; const onReq = (r) => { if (r.url().includes("/api/activity?limit=25")) fetches++; }; p.on("request", onReq);
        await p.evaluate(() => { const real = Date.now; Date.now = () => real() + 10_000; }); // the loaded list is now 10 s old, whatever the refresh timer did
        const n0 = fetches;
        // counted in the same task as the re-render: no refetch can put the block back in between
        const afterSse = await p.evaluate(() => { window.__es?.dispatchEvent(new MessageEvent("crew", { data: JSON.stringify({ crew: [], tasks: [] }) })); return document.querySelectorAll("[data-crew-activity] .ev").length; });
        await p.waitForTimeout(300); const n1 = fetches; // the stale re-render refetched in the background
        await p.evaluate(() => { const real = Date.now; Date.now = () => real() + 10_000; });
        const afterLang = await p.evaluate(() => { document.querySelector('#langSeg [data-lang-set="zh-TW"]').click(); return document.querySelectorAll("[data-crew-activity] .ev").length; });
        await p.click('#langSeg [data-lang-set="en"]');
        // a visit to a stale list loads it again
        await p.goto(`${base}/#/activity`); await p.waitForTimeout(200); await p.evaluate(() => { const real = Date.now; Date.now = () => real() + 10_000; });
        const n2 = fetches; await p.goto(`${base}/#/crew`); await p.waitForTimeout(300); const n3 = fetches;
        const stillThere = await p.locator("[data-crew-activity] .ev").count();
        p.off("request", onReq);
        ok(afterSse > 0 && afterLang > 0 && n1 > n0 && n3 > n2 && stillThere > 0, "after 3 s, a Crew re-render (SSE crew event, language switch) still shows the activity block with its items, and refetches it in the background; a visit to a stale list loads it again",
          JSON.stringify({ afterSse, afterLang, n0, n1, n2, n3, stillThere })); }
      await p.evaluate(() => { const b = document.createElement("button"); b.className = "nav-item"; b.dataset.view = "late"; b.textContent = "Late"; document.querySelector(".nav").append(b); });
      ok(await Promise.race([p.evaluate(() => new Promise((r) => setTimeout(() => r(!!document.querySelector('.nav-labs .nav-item[data-view="late"]')), 50))), new Promise((r) => setTimeout(() => r(false), 2000))]), "an item added later lands in labs and the page stays responsive");
      await p.click('#langSeg [data-lang-set="zh-TW"]'); await p.waitForTimeout(200);
      const zh = await p.$$eval(".nav > .nav-item[data-backbone] .nl", (ns) => ns.map((n) => n.textContent));
      ok(JSON.stringify(zh) === JSON.stringify(["看板", "Firstmate", "收件匣", "船員", "任務", "流程", "成品庫"]) && (await p.getAttribute("#navSettings", "aria-label")) === "設定", "switching to zh-TW relabels the backbone items and the gear", JSON.stringify(zh));
      await p.click('#langSeg [data-lang-set="en"]');
    }
    if (width === 390 && scheme === "dark") {
      // wait for what the assertion reads (the page and the sidebar's labs group), not a fixed time
      const q = await ctx.newPage(); const dbg = []; q.on("response", (r) => { if (r.url().includes("/api/docs")) dbg.push(r.status()); }); q.on("pageerror", (e) => dbg.push(String(e))); q.on("console", (m) => { if (m.type() === "error") dbg.push(m.text()); });
      await q.goto(`${base}/?labs=1#/docs`);
      await q.waitForSelector("h1:has-text('Documents')", { timeout: 10000 }).catch(() => {});
      await q.waitForFunction(() => { const g = document.querySelector(".nav-labs"); return !!g && getComputedStyle(g).display !== "none" && g.querySelectorAll(".nav-item").length > 0; }, null, { timeout: 10000 }).catch(() => {});
      ok(!(await q.locator("[data-roadmap-panel]").count()) && await q.locator("h1", { hasText: "Documents" }).isVisible() && await q.evaluate(() => localStorage.getItem("crew.labs") === "1")
        && await q.evaluate(() => { const g = document.querySelector(".nav-labs"); return !!g && getComputedStyle(g).display !== "none" && g.querySelectorAll(".nav-item").length > 0; }),
        "?labs=1 turns labs on, puts the labs group in the sidebar and the labs page renders",
        JSON.stringify([await q.evaluate(() => ({ panel: !!document.querySelector("[data-roadmap-panel]"), h1: document.querySelector("h1")?.textContent, labs: localStorage.getItem("crew.labs"), group: (() => { const g = document.querySelector(".nav-labs"); return g ? [getComputedStyle(g).display, g.querySelectorAll(".nav-item").length] : null; })(), hash: location.hash, search: location.search, view: document.querySelector("#view")?.innerHTML.slice(0, 200), active: document.activeElement?.tagName })), dbg]));
    }
    await ctx.close();
  }
  ok(errors.length === 0, "no page errors", errors.join("\n"));
} catch (e) { fail++; console.log("  FAIL  exception", e, appLog.slice(-2000)); }
finally { await browser.close(); app.kill(); }
console.log(`\nbackbone-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
