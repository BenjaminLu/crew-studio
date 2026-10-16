// Compare transcripts, the page (docs/units/compare-transcripts.md): from a seeded startup Task's page, two
// columns side by side at 1280 (founder left, judge right, synchronized headers, each column scrolls by itself),
// the round selector switching the content, stacked with a role toggle at 390 in dark zh-TW, a workflow without
// a hint picking any two rounds, and every text a text node. Temp data only.     bun tests/compare-ui.mjs
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { seeded, plant, PLANTED } from "./compare-fixture.ts";
import { freePort, waitUp, withSession } from "./boot.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
let pass = 0, fail = 0; const ok = (v, n, e = "") => { console.log(`  ${v ? "ok  " : "FAIL"}  ${n} ${v ? "" : e}`); v ? pass++ : fail++; };
const root = join(import.meta.dir, ".."), shots = join(root, "tests/out/compare"); mkdirSync(shots, { recursive: true });

const { H, startup, plain } = await seeded(); H.stop();
plant(H.data, startup, "pitch1");
// markup in a message must stay text
appendFileSync(join(H.data, "runs", startup, "nodes", "pitch1", "1", "stream.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "message", text: "<img src=x onerror=\"window.__pwned=1\"> **bold** stays safe\n## 結論\n- 第一點\n> 引言" }) + "\n");
const port = await freePort(), base = `http://127.0.0.1:${port}`;
mkdirSync(join(H.data, "fm", "state"), { recursive: true });
process.env.CREW_SESSION_TOKEN = "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CREW_DATA: H.data, CREW_PORT: String(port), CREW_CHAT_PROVIDER: "stub", CREW_GH: "0", CREW_READONLY: "1",
  CREW_RETRO_AUTO: "0", CREW_SESSION_TOKEN: "test-session", CREW_FM_STATE: join(H.data, "fm", "state"), CREW_CLAUDE_BIN: "/nonexistent", CREW_CODEX_BIN: "/nonexistent", CREW_LOCAL_UNRESTRICTED: "0" } });
let browser; const errors = [];
const context = async (width, theme, lang) => { const c = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  await c.addInitScript(({ lang, theme }) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "0"); } catch {} }, { lang, theme });
  const p = await c.newPage(); p.on("pageerror", (e) => errors.push(`${width}/${theme}: ${e}`)); return { c, p }; };
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const text = (p, sel) => p.locator(sel).innerText();
const box = (p, sel) => p.locator(sel).boundingBox();
try {
  await waitUp(base, app);
  browser = withSession(await chromium.launch({ headless: true }), base);
  // ---- 1280, light, English ----
  { const { c, p } = await context(1280, "light", "en");
    await p.goto(`${base}/#/tasks/${startup}`); await p.waitForSelector("[data-runview]");
    ok(await p.locator(`[data-compare-link="${startup}"]`).count() === 1, "the Task page offers Compare transcripts");
    await p.click(`[data-compare-link="${startup}"]`);
    ok(await p.waitForSelector(`[data-compare="${startup}"] [data-cmp-body="left"] [data-entry]`, { timeout: 10000 }).then(() => true).catch(() => false), "the compare view opens with the founder's transcript");
    await p.waitForSelector('[data-cmp-body="right"] [data-entry]');
    ok((await p.locator("[data-cmp-pick]").allTextContents()).join("|") === "Round 1|Round 2|Round 3", "the round selector lists Round 1, 2, 3", (await p.locator("[data-cmp-pick]").allTextContents()).join("|"));
    const [hl, hr, bl, br] = await Promise.all(['[data-cmp-head="left"]', '[data-cmp-head="right"]', '[data-cmp-body="left"]', '[data-cmp-body="right"]'].map((s) => box(p, s)));
    ok(hl && hr && bl && br && hl.x + hl.width <= hr.x && Math.abs(hl.y - hr.y) < 1 && Math.abs(hl.height - hr.height) < 1 && Math.abs(bl.y - br.y) < 1 && bl.width > 400 && br.width > 400,
      "two columns side by side with synchronized headers", JSON.stringify({ hl, hr }));
    const L = await text(p, '[data-cmp-head="left"]'), R = await text(p, '[data-cmp-head="right"]');
    ok(/Claude 創業者/.test(L) && /claude · fixture-claude/.test(L) && /Codex 評審/.test(R) && /codex · fixture-codex/.test(R) && /Duration/.test(L) && /Passed/.test(R) && /revise/.test(R), "headers show role, provider/model, duration and outcome", `${L} || ${R}`);
    ok(await p.locator('[data-cmp-log="left"]').getAttribute("href") === `#/runs/node/${startup}/pitch1/1/transcript` && await p.locator('[data-cmp-log="right"]').getAttribute("href") === `#/runs/node/${startup}/judge1/1/transcript`, "each header links to the round's full log");
    const scrolls = await p.evaluate(() => ["left", "right"].map((k) => getComputedStyle(document.querySelector(`[data-cmp-body="${k}"]`)).overflowY));
    ok(scrolls.every((x) => x === "auto"), "each column scrolls by itself", scrolls.join(","));
    { const indep = await p.evaluate(() => { const l = document.querySelector('[data-cmp-body="left"]'), r = document.querySelector('[data-cmp-body="right"]'); l.style.maxHeight = "200px"; r.style.maxHeight = "200px"; l.scrollTop = 120; const res = [l.scrollTop > 0, r.scrollTop === 0]; l.scrollTop = 0; l.style.maxHeight = r.style.maxHeight = ""; return res; });
      ok(indep[0] && indep[1], "scrolling one column leaves the other where it was", JSON.stringify(indep)); }
    const bodyL = await text(p, '[data-cmp-body="left"]'), bodyR = await text(p, '[data-cmp-body="right"]');
    ok(/startup_submit/.test(bodyL) && /創業提案第 1 輪/.test(bodyL) && /已提交第 1 輪提案/.test(bodyL) && /Final report/.test(bodyL), "the founder column shows messages, the startup_submit call and the final report");
    ok(/startup_submit/.test(bodyR) && /評審第 1 輪/.test(bodyR) && /score: 65/.test(bodyR) && /verdict: revise/.test(bodyR), "the judge column shows the critique, score and verdict", bodyR.slice(0, 300));
    await p.click('[data-cmp-body="left"] [data-cmp-prompt] summary');
    ok(/Role: founder; round: 1\/3/.test(await text(p, '[data-cmp-body="left"] [data-cmp-prompt]')), "the prompt each agent received opens in its column");
    ok(!(await p.locator("body").innerText()).includes(PLANTED) && !(await p.content()).includes(PLANTED), "the planted credential is not on the page");
    ok(await p.locator('[data-cmp-body="left"] img').count() === 0 && /<img src=x onerror=/.test(bodyL) && !(await p.evaluate(() => window.__pwned)), "markup in a message is shown as text, never parsed");
    ok(await p.locator('[data-cmp-body="left"] .cmp-h').count() >= 1 && await p.locator('[data-cmp-body="left"] blockquote').count() >= 1 && await p.locator('[data-cmp-body="left"] .cmp-li').count() >= 1, "headings, quotes and list items render as blocks");
    ok(await p.locator('[data-cmp-said-same="right"]').count() === 1 && (bodyR.match(/已提交：65\/100/g) || []).length === 1, "a report that repeats the last message is not shown twice", bodyR.slice(-200));
    { const pk = await box(p, ".cmp-picker"), hd = await box(p, '[data-cmp-head="left"]'); ok(pk && hd && hd.y - (pk.y + pk.height) <= 24, "the columns sit close under the round selector", JSON.stringify({ pk, hd })); }
    ok(await noHScroll(p), "no sideways scroll at 1280");
    ok(await p.locator("[data-cmp-sync]").isVisible(), "the sync-scroll-by-step toggle is offered");
    await p.screenshot({ path: join(shots, "compare-1280-light-en.png"), fullPage: true });
    // the round selector switches the content
    await p.click('[data-cmp-pick="2"]');
    await p.waitForFunction(() => /創業提案第 2 輪/.test(document.querySelector('[data-cmp-body="left"]')?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    const l2 = await text(p, '[data-cmp-body="left"]'), r2 = await text(p, '[data-cmp-body="right"]');
    ok(/創業提案第 2 輪/.test(l2) && !/創業提案第 1 輪/.test(l2) && /回應第 1 輪評審/.test(l2) && /評審第 2 輪/.test(r2) && /score: 70/.test(r2), "Round 2 shows pitch 2 next to judge 2", l2.slice(0, 200));
    ok(await p.locator('[data-cmp-head="left"]').getAttribute("data-cmp-node") === "pitch2" && await p.locator('[data-cmp-head="right"]').getAttribute("data-cmp-node") === "judge2", "the headers follow the selected round");
    await p.click('[data-cmp-pick="3"]'); await p.waitForFunction(() => /創業提案第 3 輪/.test(document.querySelector('[data-cmp-body="left"]')?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok(/評審第 3 輪/.test(await text(p, '[data-cmp-body="right"]')), "Round 3 shows judge 3");
    await p.screenshot({ path: join(shots, "compare-1280-light-en-round3.png"), fullPage: true });
    // a workflow without a hint: pick any two
    await p.goto(`${base}/#/tasks/${plain}/compare`); await p.waitForSelector("[data-cmp-undeclared]");
    ok(await p.locator("[data-cmp-select]").count() === 2 && await p.locator("[data-cmp-pick]").count() === 0, "a workflow without pairs offers two round pickers");
    await p.waitForSelector('[data-cmp-body="right"] [data-cmp-prompt]');
    ok(await p.locator('[data-cmp-head="left"]').getAttribute("data-cmp-node") === "draft" && await p.locator('[data-cmp-head="right"]').getAttribute("data-cmp-node") === "edit", "it starts with the first two rounds");
    await p.selectOption('[data-cmp-select="right"]', "draft/1");
    ok(await p.locator('[data-cmp-head="right"]').getAttribute("data-cmp-node") === "draft", "picking a round switches that column");
    await c.close(); }
  // ---- 390, dark, zh-TW ----
  { const { c, p } = await context(390, "dark", "zh-TW");
    await p.goto(`${base}/#/tasks/${startup}/compare`); await p.waitForSelector('[data-cmp-body="left"] [data-entry]');
    ok(/並排比較紀錄/.test(await text(p, "h1")) && (await p.locator("[data-cmp-pick]").allTextContents()).join("|") === "第 1 輪|第 2 輪|第 3 輪", "zh-TW title and round selector");
    const vis = async () => ({ l: await p.locator('[data-cmp-body="left"]').isVisible(), r: await p.locator('[data-cmp-body="right"]').isVisible() });
    let v = await vis();
    ok(v.l && !v.r && await p.locator("[data-cmp-show]").count() === 2 && await p.locator('[data-cmp-show="left"]').isVisible(), "stacked at 390: one column at a time with a role toggle", JSON.stringify(v));
    ok((await p.locator("[data-cmp-show]").allTextContents()).join("|") === "Claude 創業者|Codex 評審", "the toggle names the roles", (await p.locator("[data-cmp-show]").allTextContents()).join("|"));
    ok(/耗時/.test(await text(p, '[data-cmp-head="left"]')) && /最終報告/.test(await text(p, '[data-cmp-body="left"]')), "zh-TW headers and report title");
    ok(await noHScroll(p), "no sideways scroll at 390");
    await p.screenshot({ path: join(shots, "compare-390-dark-zh-TW.png"), fullPage: true });
    await p.click('[data-cmp-show="right"]'); await p.waitForSelector('[data-cmp-body="right"] [data-entry]');
    v = await vis();
    ok(!v.l && v.r && /評審第 1 輪/.test(await text(p, '[data-cmp-body="right"]')), "the toggle shows the judge", JSON.stringify(v));
    await p.click('[data-cmp-pick="2"]'); await p.waitForFunction(() => /評審第 2 輪/.test(document.querySelector('[data-cmp-body="right"]')?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok(/評審第 2 輪/.test(await text(p, '[data-cmp-body="right"]')), "the round selector switches the content on a phone too");
    ok(await noHScroll(p), "no sideways scroll at 390 after switching");
    await p.screenshot({ path: join(shots, "compare-390-dark-zh-TW-judge.png"), fullPage: true });
    await c.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e?.stack || e}`); }
finally { await browser?.close(); app.kill(); }
console.log(`\ncompare-ui: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
