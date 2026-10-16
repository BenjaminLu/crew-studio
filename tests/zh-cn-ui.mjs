// 简体中文 in the browser (unit zh-cn-ui): the language picker lives in Settings with
// English, 繁體中文 and 简体中文; the lower-left switcher is gone; the choice survives a
// reload; the first run follows the browser language; and in zh-CN no Traditional-only
// character is left on Firstmate (with Studio's chat notes, an earlier session's block and an external-error
// notice), Tasks, a card list, an open card, the crew log viewer, Settings and Doctor. The captain's own chat lines
// (kept as typed) and Firstmate's replies (checked exactly: inline code stays as written; bare URLs and paths are prose)
// are left out of the generic check, and so are pre and code: code, raw logs and tool output are shown as written. Text an element marks as lang="zh-TW" (the 繁體中文 option) is meant to be Traditional.
// Runs against a temporary copy of tests/fixture/state, a mock board and stub hosts.
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs node tests/zh-cn-ui.mjs
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, utimesSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = process.env.ZH_CN_ROOT || join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const token = process.env.CREW_SESSION_TOKEN || "zh-cn-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-zh-cn-")), state = join(tmp, "state"), data = join(tmp, "data");
cpSync(join(here, "fixture/state"), state, { recursive: true }); mkdirSync(data);
const runs = readdirSync(join(state, "runs")); const live = runs.find((r) => r.startsWith("worker-")) ?? runs[0];
writeFileSync(join(state, "runs", live, "process.json"), JSON.stringify({ actor: live, pid: process.pid }));
writeFileSync(join(tmp, "board.secret"), "cd".repeat(32) + "\n");
const mock = createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); }); });
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
// one terminal session Studio can attach to, so the Firstmate chat carries Studio's own notes
const home = join(tmp, "home"), proj = join(tmp, "proj"); mkdirSync(proj, { recursive: true });
const pdir = join(home, ".claude/projects", proj.replace(/[^a-zA-Z0-9]/g, "-")); mkdirSync(pdir, { recursive: true });
writeFileSync(join(pdir, "sess-zh.jsonl"), JSON.stringify({ type: "user", isSidechain: false, cwd: proj, message: { role: "user", content: "Studio zh-CN session" } }) + "\n");
{ const t = (Date.now() - 3_600_000) / 1000; utimesSync(join(pdir, "sess-zh.jsonl"), t, t); }
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_COMPAT_BASE_URL"]) delete env[k];
Object.assign(env, { CREW_SESSION_TOKEN: token, CREW_GH_NO_CLI: "1", CREW_KEYCHAIN_TOOL: "none", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_CLAUDE_BIN: "/nonexistent/claude",
  CREW_CODEX_BIN: "/nonexistent/codex", CREW_FM_STATE: state, CREW_PORT: String(port), CREW_BOARD_URL: `http://127.0.0.1:${mock.address().port}`, CREW_BOARD_SECRET: join(tmp, "board.secret"),
  CREW_GH: "0", CREW_READONLY: "0", CREW_RECENT_DAYS: "3650", CREW_DATA: data, CREW_GH_FIXTURE: join(here, "fixture/github"), CREW_CHAT_PROVIDER: "stub", HOME: home, CREW_MAIN_PROJECT: proj,
  CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_PERMISSION_TIMEOUT_MS: "60000", CREW_WAKE_GRACE_MS: "0" });
const app = spawn("bun", ["src/server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
let pass = 0, fail = 0;
const ok = (v, name, extra = "") => { if (v) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const shots = join(root, "tests/out/zh-cn"); mkdirSync(shots, { recursive: true });
// characters that exist only in Traditional script
const TRAD = "著麼劃傳這們個說會時對開發體為裡與從後來還點過讓樣請機關門問題設資檔閱錄讀確認驗證狀態務頁選單號帳碼試應該無經將處動給學實際聯絡網際線運連標準種類換單價錢費辦變邊東車長場現見覽視訊顯開啟執絕擇隊員導覺歷識軟龍據術顏";
/** Traditional-only characters in the page's visible text and labels, outside lang="zh-TW" elements */
const tradLeft = (p) => p.evaluate((TRAD) => {
  // an element (not the page itself) marked lang="zh-TW" is meant to be Traditional, like the 繁體中文 option
  const out = [], skip = (el) => { const l = el?.closest?.("[lang]"); return (l && l !== document.documentElement && l.lang === "zh-TW") || el?.closest?.("script,style,textarea,[hidden],pre,code") || el?.closest?.('[data-main="captain"],[data-main="firstmate"]'); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (skip(el) || !el.getClientRects().length) continue; const t = n.textContent; if ([...t].some((c) => TRAD.includes(c))) out.push(t.trim().slice(0, 80)); }
  for (const el of document.body.querySelectorAll("[title],[aria-label],[placeholder],[data-tip]")) { if (skip(el)) continue;
    for (const a of ["title", "aria-label", "placeholder", "data-tip"]) { const t = el.getAttribute(a) || ""; if ([...t].some((c) => TRAD.includes(c))) out.push(`@${a}: ${t.slice(0, 80)}`); } }
  return out;
}, TRAD);
const cjk = (p) => p.evaluate(() => (document.body.innerText.match(/[一-鿿]/g) || []).length);
const api = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": token }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

let browser;
try {
  await waitUp(base, app);
  browser = withSession(await chromium.launch(), base, token);
  const errors = [];
  const ctxFor = async (o = {}) => { const c = await browser.newContext({ viewport: { width: o.width || 1280, height: 900 }, colorScheme: o.scheme || "light", locale: o.locale || "en-US" });
    if (o.lang) await c.addInitScript((l) => { try { if (!sessionStorage.getItem("zh-cn-seeded")) { localStorage.setItem("crew.lang", l); sessionStorage.setItem("zh-cn-seeded", "1"); } } catch {} }, o.lang);
    return c; };
  const open = async (c, hash) => { const p = await c.newPage(); p.on("pageerror", (e) => errors.push(`${hash}: ${e}`)); await p.goto(`${base}/${hash}`); await p.waitForTimeout(400); return p; };

  // ---------- the picker is in Settings, the lower-left switcher is gone ----------
  {
    const c = await ctxFor(); const p = await open(c, "#/settings");
    await p.locator("[data-settings-lang]").waitFor({ timeout: 8000 }).catch(() => {});
    const opts = await p.locator("[data-settings-lang] [data-lang-set]").evaluateAll((bs) => bs.map((b) => [b.dataset.langSet, b.textContent.trim()]));
    ok(JSON.stringify(opts) === JSON.stringify([["en", "English"], ["zh-TW", "繁體中文"], ["zh-CN", "简体中文"]]), "Settings offers English, 繁體中文 and 简体中文", JSON.stringify(opts));
    ok(await p.locator("#langSeg").count() === 0 && await p.locator(".side-foot [data-lang-set], .side [data-lang-set]").count() === 0, "the lower-left language switcher is gone");
    ok(await p.locator("#themeSeg").count() === 1, "the theme switch stays in the sidebar");
    ok(await p.evaluate(async () => !!window.OpenCC?.Converter && (await fetch("/vendor/opencc-js-1.4.2-t2cn.min.js")).ok && ![...document.scripts].some((x) => /^https?:/.test(x.getAttribute("src") || ""))), "OpenCC is served by Studio itself (/vendor), no CDN");
    // ---------- zh-CN persists across a reload ----------
    await p.locator('[data-settings-lang] [data-lang-set="zh-CN"]').click(); await p.waitForTimeout(300);
    ok(await p.evaluate(() => document.documentElement.lang) === "zh-CN" && await p.evaluate(() => localStorage.getItem("crew.lang")) === "zh-CN", "choosing 简体中文 switches the page and stores crew.lang");
    ok(/设置/.test(await p.locator("h1").first().innerText()), "the Settings page itself re-renders in 简体中文", await p.locator("h1").first().innerText());
    await p.reload(); await p.locator("[data-settings-lang]").waitFor({ timeout: 8000 }).catch(() => {});
    ok(await p.evaluate(() => document.documentElement.lang) === "zh-CN" && await p.locator('[data-lang-set="zh-CN"][aria-checked="true"]').count() === 1, "简体中文 is still chosen after a reload");
    await p.locator('[data-settings-lang] [data-lang-set="en"]').click(); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.documentElement.lang) === "en" && /Settings/.test(await p.locator("h1").first().innerText()), "English switches back");
    await c.close();
  }
  // ---------- the first run follows the browser language ----------
  for (const [locale, want] of [["zh-CN", "zh-CN"], ["zh-SG", "zh-CN"], ["zh-TW", "zh-TW"], ["zh-HK", "zh-TW"], ["en-US", "en"], ["fr-FR", "en"]]) {
    const c = await ctxFor({ locale }); const p = await open(c, "#/settings");
    ok(await p.evaluate(() => document.documentElement.lang) === want && await p.evaluate(() => localStorage.getItem("crew.lang")) === null, `first run with browser ${locale} shows ${want} (nothing stored until a choice)`);
    await c.close();
  }
  { const c = await ctxFor({ locale: "zh-CN", lang: "en" }); const p = await open(c, "#/settings");
    ok(await p.evaluate(() => document.documentElement.lang) === "en", "a stored English choice beats a zh-CN browser"); await c.close(); }

  // ---------- no Traditional characters left in zh-CN ----------
  { const c = await ctxFor({ lang: "zh-TW" }); const p = await open(c, "#/settings"); await p.locator("[data-settings-lang]").waitFor({ timeout: 8000 }).catch(() => {});
    ok((await tradLeft(p)).length > 0, "the check has teeth: the same Settings page in 繁體中文 does show Traditional characters"); await c.close(); }
  const att = await api("/api/main/attach", { host: "claude", id: "sess-zh" });
  ok(att.status === 200, "the fixture session attaches, so the chat carries Studio's notes", JSON.stringify(att.body));
  // a model reply with Traditional text, inline code, a URL and a path (the stub echoes the captain's line)
  const said = "這個檔案 `程式碼.js` 看 https://x.tw/設定 和 src/設定.ts 的設定";
  const sent = await api("/api/main/send", { text: said });
  ok(sent.status === 200, "a captain line goes to the stub Firstmate", JSON.stringify(sent.body));
  await new Promise((r) => setTimeout(r, 1500));
  for (const [width, scheme] of [[1280, "light"], [390, "dark"]]) {
    const c = await ctxFor({ width, scheme, lang: "zh-CN" });
    for (const [name, hash, sel] of [["settings", "#/settings", "[data-settings-lang]"], ["doctor", "#/doctor", ".doc-t"], ["tasks", "#/runs", "h1"], ["card", "#/inbox", "[data-card]"], ["card-detail", "#/inbox/D-fixture-door-check", "[data-card]"], ["log", `#/crew/${encodeURIComponent(live)}`, ".tr-tabs"],
      ["firstmate", "#/firstmate", "#chatLog [data-main]"]]) {
      const p = await open(c, hash);
      if (name === "firstmate") await p.evaluate(() => { document.body.classList.remove("chat-closed"); window.openChat?.(true); });
      if (name === "card-detail") await p.locator("[data-card] .opt").first().click().catch(() => {}); // an open card with an option picked
      if (name === "log") for (const tab of await p.locator(".tr-tabs [role=tab]").all()) { await tab.click().catch(() => {}); await p.waitForTimeout(150); if ((await tradLeft(p)).length) break; }
      const found = await p.locator(sel).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      if (name === "firstmate" && found) { // an earlier session's block and an external-error notice, as the chat shows them
        await p.evaluate(() => { MS.view.log.push({ at: Date.now() - 86400000, kind: "firstmate", text: "較早的回覆：設定已儲存。", session: { id: "old-sess", host: "claude", model: "stub-old" } });
          localNotice({ source: "studio", class: "network", code: "fixture-notice", reason: { en: "The upload could not reach Studio.", "zh-TW": "上傳無法連到 Studio，請檢查網路連線後重試。" }, message: "fetch failed" }); renderChat(false); });
        ok(await p.locator('[data-session-block="old-sess"]').count() === 1 && await p.locator('[data-external-error="fixture-notice"]').count() === 1, `the chat shows a session block and an external-error notice at ${width}`);
      }
      ok(found, `${name} renders in 简体中文 at ${width} ${scheme}`);
      await p.waitForTimeout(300);
      const left = await tradLeft(p);
      ok(left.length === 0, `${name}: no Traditional characters left at ${width} ${scheme}`, JSON.stringify(left.slice(0, 6)));
      ok(await cjk(p) > 10, `${name}: the page really shows Chinese at ${width} ${scheme}`);
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no sideways scroll at ${width} ${scheme}`);
      if (name === "firstmate") {
        const log = await p.locator("#chatLog").innerText();
        ok(/已接上 claude session/.test(log), `the chat's Studio note reads in 简体中文 at ${width}`, log.slice(0, 200));
        const reply = await p.locator('#chatLog [data-main="firstmate"] .bub', { hasText: "echo:" }).last().innerText().catch(() => "");
        ok(reply === "echo: 这个文件 程式碼.js 看 https://x.tw/设置 和 src/设置.ts 的设置", `a Firstmate reply converts for display; inline code stays as written, a bare URL and path are prose (${width})`, reply);
        ok(await p.locator('#chatLog [data-main="captain"] .bub').last().innerText() === said, `the captain's own line stays as typed (${width})`);
        ok(await p.locator("#themeLabel").innerText() === "主题" || width < 761, `the sidebar theme title reads 主题 (${width})`, await p.locator("#themeLabel").innerText());
      }
      if (name === "settings" || name === "firstmate") await p.screenshot({ path: join(shots, `zh-cn-${name}-${width}-${scheme}.png`) });
      await p.close();
    }
    await c.close();
  }
  // ---------- phones follow the same setting ----------
  { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-US" }); const p = await open(c, "#/settings");
    await p.locator('[data-settings-lang] [data-lang-set="zh-CN"]').click(); await p.reload(); await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.documentElement.lang) === "zh-CN" && (await tradLeft(p)).length === 0, "on a phone-sized touch screen the Settings picker sets 简体中文 and it sticks");
    ok(await p.evaluate(() => { const r = document.querySelector('[data-lang-set="zh-CN"]').getBoundingClientRect(); return r.height >= 36 && r.right <= innerWidth; }), "the phone picker buttons are reachable and big enough to tap");
    await c.close(); }
  ok(!errors.length, "no page errors", errors.slice(0, 3).join(" | "));
} catch (e) { fail++; console.log("  FAIL  " + (e?.stack || e)); }
finally { await browser?.close().catch(() => {}); app.kill(); mock.close(); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
console.log(`\nzh-cn-ui: ${pass} passed, ${fail} failed`);
if (fail && process.env.ZH_CN_LOG) console.log(appLog.slice(-3000));
process.exit(fail ? 1 : 0);
