import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// What Firstmate sees, on the board (docs/units/observe.md): the Firstmate panel's "看得到：…" label names this window's page and
// pauses sharing on a click; the Settings switch says exactly what is shared; each page change is reported half a second after it
// settles, with ids and Studio's labels only; and a ref in Firstmate's answer is a chip that opens its page, its hover saying
// which read tool read it and when. Offline: the chat history is restored from the log on disk, with stub host CLIs only.
//   bun tests/observe-ui.mjs   (Playwright's Chromium: npx playwright install chromium)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-observe-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex"), join(data, "chat-log")]) mkdirSync(d, { recursive: true });
const TOKEN = "observe-ui", session = { host: "codex", id: "th-old", model: "stub-model" }, at = Date.now() - 60_000;
const ROOM = "PR-0123456789ab-1645";
writeFileSync(join(data, "chat-log", "log.jsonl"), [
  { at, kind: "captain", text: "R-162 卡在哪？", source: "desktop", session },
  { at: at + 1000, kind: "tool", text: 'mcp__studio__studio_get {"ref":"task:R-162"}', tool: "studio_get", activity: { en: "Reading task:R-162", "zh-TW": "讀取 task:R-162" }, session },
  { at: at + 2000, kind: "firstmate", text: `R-162 停在部署那一步（task:R-162），房間在 room:${ROOM}。task:R-162 修好前別合併。`, session },
  { at: at + 3000, kind: "captain", text: "那現在呢？", source: "desktop", session },
  { at: at + 4000, kind: "firstmate", text: "還是一樣，task:R-162 沒動。", session },
].map((x) => JSON.stringify(x)).join("\n") + "\n", { mode: 0o600 });
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
let pass = 0, fail = 0, browser, app; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const seen = async (p, sel, timeout = 8000) => { try { await p.locator(sel).first().waitFor({ timeout }); return true; } catch { return false; } };
try {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
    CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_LOCAL_UNRESTRICTED: "0",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects") } });
  app.stdout.resume(); await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "zh-TW"); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(String(e)));
  const reports = []; p.on("request", (r) => { if (r.url().endsWith("/api/focus") && r.method() === "POST") reports.push({ at: Date.now(), body: JSON.parse(r.postData() || "{}") }); });
  await p.goto(base + "/#/board");
  // the label and the reports
  ok(await seen(p, "#fmSees[data-sharing='1']", 15000), "the Firstmate panel shows what it can see");
  ok(/^看得到：看板/.test(await p.locator("#fmSees").innerText()), "it names this window's page", await p.locator("#fmSees").innerText());
  const look = await p.evaluate(() => { const b = document.querySelector("#fmSees"), log = document.querySelector("#chatLog"), cs = getComputedStyle(b), r = b.getBoundingClientRect(), panel = document.querySelector("#chat").getBoundingClientRect();
    return { w: r.width, panel: panel.width, bg: cs.backgroundColor, border: cs.borderTopWidth, pressed: b.getAttribute("aria-pressed"), fs: parseFloat(cs.fontSize), gap: log.getBoundingClientRect().top - r.bottom }; });
  ok(look.w < look.panel * 0.75 && look.bg === "rgba(0, 0, 0, 0)" && look.border === "0px" && look.pressed === null && look.fs <= 12 && look.gap >= 6, "the label is small, muted and as wide as its words, with room below it before the log", JSON.stringify(look));
  ok((await p.locator("#fmSees").getAttribute("data-state")) === "offline" && /Firstmate 未連接/.test(await p.locator("#fmSees").innerText()), "with Firstmate not connected it says so, greyed");
  reports.length = 0; const navAt = Date.now();
  await p.evaluate(() => { location.hash = "#/run/R-162"; });
  await p.waitForTimeout(250); await p.evaluate(() => { location.hash = "#/inbox"; }); await p.waitForTimeout(250); await p.evaluate(() => { location.hash = "#/run/R-162"; });
  await p.waitForTimeout(1200);
  ok(reports.length === 1 && reports[0].at - navAt >= 500, "page changes in quick succession are reported once, after they settle", JSON.stringify(reports.map((r) => r.body.route)));
  const b = reports.at(-1)?.body ?? {};
  ok(b.route === "#/run/R-162" && b.ref === "task:R-162" && b.label === "任務 · R-162" && b.visible === true && JSON.stringify(Object.keys(b).sort()) === JSON.stringify(["dialog", "label", "ref", "route", "selection", "tab", "visible"]), "a report carries the route, the ref and Studio's label, nothing else", JSON.stringify(b));
  ok(/看得到：任務 · R-162/.test(await p.locator("#fmSees").innerText()), "the label follows the page");
  await p.locator("#chatIn").fill("這段是我正在打的字");
  await p.evaluate(() => { location.hash = "#/inbox"; }); await p.waitForTimeout(900);
  ok(!reports.some((r) => JSON.stringify(r.body).includes("正在打的字")), "what the captain is typing is never reported");
  await p.evaluate(() => { location.hash = "#/runs?q=my%20secret%20search"; }); await p.waitForTimeout(900);
  ok(reports.at(-1)?.body.route === "#/runs" && !reports.some((r) => /secret/.test(JSON.stringify(r.body))), "a list's search query in the address is never reported", JSON.stringify(reports.at(-1)?.body));
  // a click pauses sharing
  await p.locator("#fmSees").click();
  ok(await seen(p, "#fmSees[data-sharing='0']") && (await p.locator("#fmSees").innerText()) === "沒有分享畫面 · 恢復" && await p.locator("#fmSees svg").count() === 1, "a click on the label pauses sharing; the label says so, with the verb that resumes it", await p.locator("#fmSees").innerText());
  ok((await p.evaluate(() => fetch("/api/focus").then((r) => r.json()))).sharing === false, "Studio holds sharing off");
  reports.length = 0; await p.evaluate(() => { location.hash = "#/board"; }); await p.waitForTimeout(900);
  ok(reports.length === 0, "with sharing off, nothing is reported");
  // the Settings switch, with its exact words, in step with the label
  await p.evaluate(() => { location.hash = "#/settings"; });
  ok(await seen(p, "[data-focus-sharing] #focusShare"), "Settings has the sharing switch");
  const words = await p.locator("[data-focus-sharing]").innerText();
  ok(words.includes("與 Firstmate 分享我目前的頁面與選取（只送頁面和項目名稱，不送輸入中的文字或畫面）") && words.includes("外部 CLI 授權不會收到這項資訊。"), "its words are the spec's, title and subtitle", words);
  ok((await p.locator("[data-focus-sharing] b").innerText()) === "與 Firstmate 分享我目前的頁面與選取" && await p.evaluate(() => { const f = document.querySelector("[data-focus-sharing]"), g = document.querySelector("#cliGrants"); return !!g && !!(f.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) && f.nextElementSibling === g; }), "only the main phrase is bold, and the switch sits right before the external CLI grants");
  ok(!(await p.locator("#focusShare").isChecked()), "it shows sharing off");
  await p.locator("#focusShare").check(); await p.waitForTimeout(300);
  ok((await p.evaluate(() => fetch("/api/focus").then((r) => r.json()))).sharing === true && (await p.locator("#fmSees").getAttribute("data-sharing")) === "1", "turning it on shares again, and the label says so");
  // a report that does not reach Studio greys the label and keeps what Studio last received
  await p.route("**/api/focus", (r) => r.request().method() === "POST" ? r.fulfill({ status: 500, body: "{}" }) : r.continue());
  await p.evaluate(() => { location.hash = "#/inbox"; }); await p.waitForTimeout(900);
  ok((await p.locator("#fmSees").getAttribute("data-state")) === "failed" && /沒送到/.test(await p.locator("#fmSees").innerText()), "a report Studio did not receive greys the label and says so", await p.locator("#fmSees").innerText());
  await p.unroute("**/api/focus");
  // refs in Firstmate's answer
  await p.evaluate(() => { location.hash = "#/board"; });
  const chip = p.locator('#chatLog [data-main="firstmate"] a.ref-chip[data-ref="task:R-162"]');
  ok(await seen(p, '#chatLog [data-main="firstmate"] a.ref-chip[data-ref="task:R-162"]', 10000), "a ref in Firstmate's answer is a chip");
  const first = chip.first();
  ok((await first.getAttribute("href")) === "#/run/R-162" && (await first.evaluate((a) => a.firstChild.textContent)) === "R-162" && (await first.getAttribute("data-ref-read")) === "studio_get" && (await first.getAttribute("data-ref-turn")) === "this", "it opens the Task under its short label, read with studio_get this turn");
  const shape = await first.evaluate((a) => { const cs = getComputedStyle(a); return { h: a.getBoundingClientRect().height, font: cs.fontFamily, minH: cs.minHeight, border: cs.borderTopWidth }; });
  ok(shape.h <= 24 && shape.border === "0px" && !/^monospace$/.test(shape.font) && shape.font.length > 9, "a chip follows the line height, no border, Studio's mono font", JSON.stringify(shape));
  const ans = p.locator('#chatLog [data-main="firstmate"]').filter({ hasText: "修好前別合併" });
  ok(await ans.locator('a.ref-chip[data-ref="task:R-162"]').count() === 1 && await ans.locator('a.ref-link[data-ref="task:R-162"]').count() === 1, "only a ref's first mention in an answer is a chip; the later one is a plain link");
  const room = p.locator(`#chatLog a.ref-chip[data-ref="room:${ROOM}"]`);
  ok((await room.getAttribute("href")) === `#/room/${ROOM}` && (await room.evaluate((a) => a.firstChild.textContent)) === "PR #1645" && /沒有讀過/.test(await room.getAttribute("aria-label")), "a room's ref reads PR #1645, and one nothing read says so", await room.getAttribute("aria-label"));
  await first.focus(); await p.waitForTimeout(400);
  const pop = first.locator(".ref-pop");
  ok(await pop.isVisible() && /這一輪/.test(await pop.innerText()) && /task:R-162/.test(await pop.innerText()), "keyboard focus opens its card: the ref and which read tool read it this turn", await pop.innerText().catch(() => ""));
  await first.hover(); await p.waitForTimeout(200); ok(await pop.isVisible(), "so does hovering");
  const later = p.locator('#chatLog [data-main="firstmate"]').filter({ hasText: "沒動" }).locator("a.ref-chip");
  ok((await later.getAttribute("data-ref-turn")) === "earlier" && /稍早/.test(await later.getAttribute("aria-label")), "a ref read in an earlier turn says so, not 'never read'", await later.getAttribute("aria-label"));
  await first.click(); await p.waitForTimeout(300);
  ok(p.url().endsWith("#/run/R-162"), "a click opens the page");
  // OBSERVE_UI_SHOTS=<dir>: the panel, a chip's card, paused and Settings at 1440 and 390 wide, light and dark
  if (process.env.OBSERVE_UI_SHOTS) for (const [w, scheme] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
    const dir = process.env.OBSERVE_UI_SHOTS; await p.setViewportSize({ width: w, height: w < 500 ? 844 : 900 }); await p.emulateMedia({ colorScheme: scheme });
    await p.evaluate(() => { location.hash = "#/run/R-162"; }); await p.waitForTimeout(900);
    if (w < 500 && await p.locator("#chatFab").isVisible().catch(() => false)) await p.locator("#chatFab").click();
    await p.locator("#chat").screenshot({ path: `${dir}/${w}-${scheme}-panel.png` }).catch(() => {});
    const c = p.locator('#chatLog a.ref-chip[data-ref="task:R-162"]').first(); await c.focus(); await p.waitForTimeout(300);
    await p.locator("#chat").screenshot({ path: `${dir}/${w}-${scheme}-chip-focus.png` }).catch(() => {});
    await p.locator("#fmSees").click(); await p.waitForTimeout(300); await p.locator("#chat").screenshot({ path: `${dir}/${w}-${scheme}-paused.png` }).catch(() => {});
    await p.locator("#fmSees").click(); await p.waitForTimeout(300);
    await p.evaluate(() => { location.hash = "#/settings"; }); await p.waitForTimeout(600);
    await p.locator("[data-focus-sharing]").screenshot({ path: `${dir}/${w}-${scheme}-settings.png` }).catch(() => {}); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log("FAIL " + (e?.stack || e)); }
finally { await browser?.close().catch(() => {}); app?.kill(); }
console.log(`\nobserve-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
