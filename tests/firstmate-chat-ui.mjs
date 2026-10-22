import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Firstmate chat panel in a real browser, for two live E2E findings (scratchpad e2e-sandbox.md):
//  S23 an escalation Studio sent Firstmate showed in the chat as its raw prompt (English, tool syntax
//      "studio_answer_agent_question {task:…}"): the chat shows the short summary (Task, what is stuck, Firstmate is looking)
//  S24 a markdown table in a Firstmate reply showed as raw pipes: it renders as a table, CJK cells included, and stays
//      inside the panel on a phone
// Offline: the chat history is restored from the log on disk, with stub host CLIs only.
//   FIRSTMATE_CHAT_SHOTS=<dir>  also write screenshots there
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-fm-chat-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex"), join(data, "chat-log")]) mkdirSync(d, { recursive: true });
const TOKEN = "firstmate-chat-ui", shots = process.env.FIRSTMATE_CHAT_SHOTS;
const session = { host: "codex", id: "th-old", model: "stub-model" }, at = Date.now() - 60_000;
const RAW = `firstmate wake:\nEscalation in Task R-088, step budget (Round-budget card).\nEscalation at Round-budget card: 3 rounds ran and checks still fail: more rounds or a smaller scope?\nDecide with studio_answer_agent_question {task:"R-088", node:"budget", visit:1, choice:"<option id>"}\nHandle each event, then advance already authorized actionable follow-ups.`;
const PROPOSE_RAW = '{"workflow":"images","version":4,"title":"轉角書店方形社群海報","text":"給我一張轉角書店的方形社群海報。","captain_quote":"給我一張轉角書店的方形社群海報"}';
const TABLE = "其他還在等你的卡片：\n\n| # | 工作 | 派工卡 |\n|---|:---|---:|\n| 1 | 轉角書店單頁網站 | **R-080** `#/run/R-080` |\n| 2 | 轉角書店社群主視覺（方形） | R-083 |\n| 3 | 轉角書店 15 秒宣傳片，介紹本週選書和營業時間 10:00–21:00 | R-085 |\n\n請到收件匣核准。";
writeFileSync(join(data, "chat-log", "log.jsonl"), [
  { at, kind: "captain", text: "還有什麼在等我？", source: "desktop", session },
  { at: at + 1000, kind: "firstmate", text: TABLE, session },
  { at: at + 2000, kind: "wake", text: RAW, source: "studio-native", session, shown: [{ en: "Task R-088 “新增 percent()” is stuck at Round-budget card: 3 rounds ran and checks still fail. Firstmate is looking at it and opens a card for you only if it needs you.", "zh-TW": "任務 R-088 “新增 percent()” 在「Round-budget card」卡住了。Firstmate 正在判斷，需要你決定時才會開卡給你。" }] },
  { at: at + 3000, kind: "wake", text: "firstmate wake:\nfm: task T-12 finished\nHandle each event.", source: "firstmate", session },
  // S27: tool calls as Studio writes them now (short name + activity line; raw call kept), and from before it did (raw only)
  { at: at + 4000, kind: "tool", text: 'ToolSearch {"query":"select:mcp__studio__studio_propose_work"}', tool: "ToolSearch", activity: null, session },
  { at: at + 4100, kind: "tool", text: "mcp__studio__studio_list_workflows {}", tool: "studio_list_workflows", activity: { en: "Looking at the workflow list", "zh-TW": "查看工作流程清單" }, session },
  { at: at + 4200, kind: "tool", text: `mcp__studio__studio_propose_work ${PROPOSE_RAW}`, tool: "studio_propose_work", activity: { en: "Proposing work: 轉角書店方形社群海報 → R-093", "zh-TW": "提出派工：轉角書店方形社群海報 → R-093" }, session },
  { at: at + 4300, kind: "tool", text: 'mcp__studio__studio_manual {"section":"studio/pages"}', session },
  { at: at + 4400, kind: "tool", text: 'ToolSearch {"query":"select:mcp__studio__studio_manual"}', session },
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
  for (const [width, theme, lang, tag] of [[1280, "light", "zh-TW", "1280-light-zh"], [390, "dark", "en", "390-dark-en"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: theme });
    await ctx.addInitScript(({ theme, lang }) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, { theme, lang });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
    await p.goto(base + "/#/board");
    if (width < 500 && await p.locator("#chatFab").isVisible().catch(() => false)) await p.locator("#chatFab").click();
    // S24: the table
    const fm = p.locator('#chatLog [data-main="firstmate"]').filter({ hasText: "轉角書店單頁網站" });
    ok(await seen(p, '#chatLog [data-main="firstmate"] table.md-table', 15000), `${tag}: a Firstmate reply's markdown table renders as a table`);
    const bub = (await fm.locator(".bub").innerText().catch(() => "")) || "";
    ok(!/\|---|\| # \|/.test(bub), `${tag}: no raw pipe rows are left`, bub.slice(0, 200));
    ok(await fm.locator("table.md-table thead th").count() === 3 && await fm.locator("table.md-table tbody tr").count() === 3, `${tag}: header and body rows are kept`);
    ok((await fm.locator("table.md-table tbody tr").nth(1).locator("td").nth(1).innerText()) === "轉角書店社群主視覺（方形）", `${tag}: a CJK cell keeps its full text`);
    ok(await fm.locator("table.md-table tbody tr").first().locator("td b").innerText() === "R-080" && await fm.locator("table.md-table tbody tr").first().locator("td code").count() === 1, `${tag}: a cell's bold and code still render`);
    // Chat refresh replaces rows: resolve and measure the same DOM revision atomically.
    ok(await p.evaluate(() => {const row=[...document.querySelectorAll('#chatLog [data-main="firstmate"]')].find(e=>e.textContent.includes("轉角書店單頁網站"));const cell=row?.querySelectorAll('table.md-table th')[2];return cell?getComputedStyle(cell).textAlign:null;}) === "right", `${tag}: a column's alignment from the separator row applies`);
    ok(/其他還在等你的卡片/.test(bub) && /請到收件匣核准/.test(bub), `${tag}: the text before and after the table stays`);
    const fits = await p.evaluate(() => { const w = document.querySelector("#chatLog .md-table-wrap"); return !!w && w.getBoundingClientRect().right <= document.querySelector("#chatLog").getBoundingClientRect().right + 1 && document.documentElement.scrollWidth <= innerWidth; });
    ok(fits, `${tag}: the table stays inside the chat panel; nothing scrolls the page sideways`);
    // S23: the escalation wake
    const wake = p.locator("#chatLog [data-wake-shown]");
    ok(await seen(p, "#chatLog [data-wake-shown]") && await wake.count() === 1, `${tag}: the escalation shows as its summary`);
    const said = (await wake.innerText().catch(() => "")) || "";
    ok(/R-088/.test(said) && (lang === "zh-TW" ? /卡住了/.test(said) && /Firstmate 正在判斷/.test(said) : /is stuck at Round-budget card/.test(said) && /Firstmate is looking/.test(said)), `${tag}: it names the Task, what is stuck and that Firstmate is looking, in the page language`, said);
    ok(!/studio_answer_agent_question|\{task:|Handle each event/.test(await p.locator("#chatLog").innerText()), `${tag}: the raw escalation prompt is not shown`);
    ok(await seen(p, '#chatLog [data-main="wake"]:has-text("fm: task T-12 finished")'), `${tag}: a wake firstmate wrote itself still shows its line`);
    // S27: each tool call is one short activity line in the page language; the raw call is folded under it; ToolSearch is not shown
    const group = p.locator('#chatLog [data-tool-group]');
    ok(await group.count() === 1 && !(await group.evaluate(e => e.open)), `${tag}: adjacent tool activities start in one collapsed group`);
    await group.locator(':scope > summary').click();
    const acts = await p.locator('#chatLog [data-main="tool"] [data-tool-activity]').allInnerTexts();
    const want = lang === "zh-TW" ? ["查看工作流程清單", "提出派工：轉角書店方形社群海報 → R-093", "使用工具：studio_manual"] : ["Looking at the workflow list", "Proposing work: 轉角書店方形社群海報 → R-093", "Using a tool: studio_manual"];
    ok(JSON.stringify(acts) === JSON.stringify(want), `${tag}: tool calls show as activity lines in the page language (a line from before them names the tool only)`, JSON.stringify(acts));
    ok(await p.locator('#chatLog [data-main="tool"][data-tool="ToolSearch"]').count() === 0, `${tag}: ToolSearch is not shown, old line or new`);
    const shown = await p.locator("#chatLog").innerText();
    ok(!/mcp__studio__|\{"workflow"|captain_quote|"query"/.test(shown), `${tag}: no raw tool name or JSON shows by default`, shown.slice(0, 300));
    const pw = p.locator('#chatLog [data-main="tool"][data-tool="studio_propose_work"]');
    await pw.locator("summary").click();
    ok(await pw.evaluate((e) => e.open) && (await pw.locator("[data-tool-raw]").innerText()).includes('"captain_quote":"給我一張轉角書店的方形社群海報"'), `${tag}: the raw call is there when the line is expanded`);
    if (shots) { mkdirSync(shots, { recursive: true }); await p.waitForTimeout(250); await p.screenshot({ path: join(shots, `${tag}.png`) }); }
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { ok(false, "the UI run finished", String(e?.stack ?? e).slice(0, 800)); }
finally { await browser?.close().catch(() => {}); app?.kill("SIGTERM"); }
console.log(`firstmate-chat-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
