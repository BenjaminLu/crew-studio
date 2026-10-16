import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The restored Firstmate chat history and typed external errors in a real browser: after a Studio restart the
// earlier session is its own labelled block with its files and its vendor error; a new primary follows it; an
// upload that never reached Studio, a send Studio refused, and a PDF whose pages cannot be read each say so.
// Offline: stub host CLIs only.
//   CHAT_HISTORY_SHOTS=<dir>  also write screenshots there (1280 light en, 390 dark zh-TW)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { png } from "./fixture/attachment-files.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-chat-history-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
const projects = join(home, ".claude/projects"), pdir = join(projects, proj.replace(/[^a-zA-Z0-9]/g, "-")); mkdirSync(pdir, { recursive: true });
{ const f = join(pdir, "sess-new.jsonl"); writeFileSync(f, JSON.stringify({ type: "user", isSidechain: false, cwd: proj, sessionId: "sess-new", message: { role: "user", content: "firstmate" } }) + "\n"); const old = (Date.now() - 3_600_000) / 1000; utimesSync(f, old, old); }
const TOKEN = "chat-history-ui", shots = process.env.CHAT_HISTORY_SHOTS;
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
let port = 0, base = "";
const boot = async () => {
  port = await freePort(); base = `http://127.0.0.1:${port}`;
  const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
    CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_LOCAL_UNRESTRICTED: "0", CREW_WAKE_GRACE_MS: "600000",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: projects,
    STUB_CODEX_THREADS: JSON.stringify([{ id: "th-old", cwd: proj, preview: "firstmate", updatedAt: Math.floor(Date.now() / 1000) - 3600 }]) } });
  app.stdout.resume(); await waitUp(base, app); return app;
};
let pass = 0, fail = 0, browser; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const api = async (path, body) => { const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-session": TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error(`${path}: HTTP ${r.status} ${t.slice(0, 200)}`); } };
const idle = async () => { for (let i = 0; i < 150; i++) { const v = await api("/api/main"); if (!v.busy && !v.queue.length) return; await new Promise((r) => setTimeout(r, 100)); } };
const seen = async (p, sel, timeout = 8000) => { try { await p.locator(sel).first().waitFor({ timeout }); return true; } catch { return false; } };
const shot = async (p, name) => { if (!shots) return; mkdirSync(shots, { recursive: true }); await p.waitForTimeout(250); await p.screenshot({ path: join(shots, name + ".png") }); };
const VENDOR = "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)";

let app;
try {
  // the first Studio: a Codex session with a file and a vendor failure
  app = await boot();
  ok((await api("/api/main/attach", { host: "codex", id: "th-old" })).ok, "first Studio: a Codex session attached");
  const up = await api("/api/main/attachments", { name: "mock.png", data: png(80, 60, [40, 90, 220]).toString("base64") });
  await api("/api/main/send", { text: "Here is the mockup", attachments: [{ id: up.attachment.id, name: "mock.png" }] }); await idle();
  await api("/api/main/send", { text: `STUB_FAIL ${VENDOR}` }); await idle();
  await api("/api/main/detach", {});
  app.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 600)); app.kill("SIGKILL");
  // the restarted Studio, with a new Claude primary
  app = await boot();
  ok((await api("/api/main/attach", { host: "claude", id: "sess-new" })).ok, "restarted Studio: a new Claude primary attached");
  await api("/api/main/send", { text: "Picking up after the restart" }); await idle();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  for (const [width, theme, lang, tag] of [[1280, "light", "en", "1280-light-en"], [390, "dark", "zh-TW", "390-dark-zh"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: theme });
    await ctx.addInitScript(({ theme, lang }) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, { theme, lang });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
    await p.goto(base + "/#/board");
    if (width < 500 && await p.locator("#chatFab").isVisible().catch(() => false)) await p.locator("#chatFab").click();
    ok(await seen(p, '#chatLog [data-session-block="th-old"][data-earlier="1"]', 15000), `${tag}: the restored Codex session is an earlier, labelled block`);
    ok(await seen(p, '#chatLog [data-main="captain"]:has-text("Here is the mockup") [data-att-sent="image"] img'), `${tag}: the restored message still shows its file`);
    const n = p.locator('#chatLog [data-external-error="codex_network"]');
    ok(/codex/.test(await p.locator('#chatLog [data-main="firstmate"]:has-text("echo: Here is the mockup") .vbadge').innerText()), `${tag}: a restored reply keeps the host of its own session`);
    ok(await n.count() === 1 && (await n.locator("[data-external-message]").innerText()).includes(VENDOR), `${tag}: the restored vendor failure is a typed network notice with Codex's own message`);
    ok(await seen(p, '#chatLog [data-session-block="sess-new"][data-earlier="0"]') && await seen(p, '#chatLog [data-main="firstmate"]:has-text("echo: Picking up after the restart")'), `${tag}: the new Claude primary follows as the current block`);
    await n.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await shot(p, `${tag}-restored`);
    // an upload that never reached Studio
    await p.route("**/api/main/attachments", (r) => r.request().method() === "POST" ? r.abort("connectionreset") : r.continue());
    await p.setInputFiles("#chatFile", { name: "lost.png", mimeType: "image/png", buffer: png(10, 10, [1, 2, 3]) });
    ok(await seen(p, '#chatAtt .att-chip[data-att="refused"][data-att-name="lost.png"] [data-att-code="upload_network"]') && await seen(p, '#chatLog [data-external-error="upload_network"]'), `${tag}: an upload that never reached Studio is a refused chip and a typed upload notice`);
    await p.unroute("**/api/main/attachments");
    await p.locator('#chatAtt [data-att-name="lost.png"] .att-x').click();
    // a PDF whose page count cannot be read, with Claude running
    await p.setInputFiles("#chatFile", { name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(300, 0x41)]) });
    ok(await seen(p, '#chatAtt [data-att-name="scan.pdf"] [data-att-note="warn"]') && /100/.test(await p.locator('#chatAtt [data-att-name="scan.pdf"] [data-att-note="warn"]').innerText()), `${tag}: a PDF with an unreadable page count warns that Claude refuses PDFs over 100 pages`);
    await shot(p, `${tag}-warning`);
    await p.locator('#chatAtt [data-att-name="scan.pdf"] .att-x').click();
    await ctx.close();
  }
  // a send Studio refuses (nothing attached): the refusal is a typed notice, the draft stays
  await api("/api/main/detach", {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`refusal: ${e}`));
  await p.goto(base + "/#/board"); await seen(p, '#chatLog [data-banner="detached"]', 15000);
  await p.evaluate(() => { document.querySelector("#chatSend").disabled = false; document.querySelector("#chatIn").value = "are you there?"; document.querySelector("#chatForm").requestSubmit(); });
  ok(await seen(p, '#chatLog [data-external-error="detached"]') && /no main session is attached/.test(await p.locator('#chatLog [data-external-error="detached"] [data-external-message]').innerText()) && await p.locator("#chatIn").inputValue() === "are you there?", "a send Studio refuses shows a typed notice with Studio's reason and keeps the draft");
  await ctx.close();
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { ok(false, "the UI run finished", String(e?.stack ?? e).slice(0, 800)); }
finally { await browser?.close().catch(() => {}); app?.kill("SIGTERM"); }
console.log(`chat-history-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
