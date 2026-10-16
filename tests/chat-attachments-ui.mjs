import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Firstmate chat's attachments in a real browser: drop, paste and pick images and PDFs, see them as chips,
// remove one, send, see them in the history, and still see them after a reload. A file the server refuses stays
// as a refused chip and blocks the send (never a silent drop). Offline: stub host CLIs only.
//   CHAT_ATT_SHOTS=<dir>  also write screenshots there (1280 light en, 390 dark zh-TW)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { pdf, png } from "./fixture/attachment-files.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-chat-att-ui-"));
const home = join(tmp, "home"), proj = join(tmp, "proj"), state = join(tmp, "state"), data = join(tmp, "data");
for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
const port = await freePort(), base = `http://127.0.0.1:${port}`, TOKEN = "chat-att-ui", shots = process.env.CHAT_ATT_SHOTS;
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
  CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_WAKE_GRACE_MS: "600000",
  CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: join(home, ".claude/projects"),
  STUB_CODEX_THREADS: JSON.stringify([{ id: "th-ui", cwd: proj, preview: "firstmate", updatedAt: Math.floor(Date.now() / 1000) - 3600 }]) } });
app.stdout.resume();
let pass = 0, fail = 0, browser; const errors = [];
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const api = async (path, body) => (await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-session": TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
const seen = async (p, sel, timeout = 8000) => { try { await p.locator(sel).first().waitFor({ timeout }); return true; } catch { return false; } };
const shot = async (p, name) => { if (!shots) return; mkdirSync(shots, { recursive: true }); await p.waitForTimeout(250); await p.screenshot({ path: join(shots, name + ".png") }); };
const RED = png(96, 96, [220, 30, 30]), GREEN = png(96, 96, [30, 170, 80]), BLUE = png(96, 96, [40, 90, 220]), PDF = pdf("Quarterly brief for the captain");
const b64 = (b) => b.toString("base64");
/** A drag of real File objects onto the chat, as the browser makes it. */
const drag = (p, files, phase) => p.evaluate(({ files, phase }) => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
  const target = document.querySelector("#chatLog");
  for (const t of phase === "drop" ? ["dragenter", "dragover", "drop"] : ["dragenter", "dragover"]) target.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
}, { files, phase });
const paste = (p, f) => p.evaluate((f) => {
  const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
  const el = document.querySelector("#chatIn"); el.focus(); el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
}, f);

async function run(width, theme, lang, tag) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: theme });
  await ctx.addInitScript(({ theme, lang }) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.theme", theme); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, { theme, lang });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
  await p.goto(base + "/#/board");
  if (width < 500 && await p.locator("#chatFab").isVisible().catch(() => false)) await p.locator("#chatFab").click();
  ok(await seen(p, '#chatLog [data-banner="attached"]', 15000), `${tag}: the chat shows the attached Firstmate`);
  ok(await p.locator("#chatAttach").isVisible() && await p.locator("#chatFile").getAttribute("accept") === "image/png,image/jpeg,image/webp,image/gif,application/pdf", `${tag}: the chat has an attach button for images and PDFs`);
  // drop: the target shows while dragging, the file becomes a chip
  await drag(p, [{ name: "red.png", type: "image/png", data: b64(RED) }], "over");
  ok(await p.locator("#chat.drop-on .att-drop").isVisible(), `${tag}: dragging files over the chat shows the drop target`);
  await shot(p, `${tag}-drop`);
  await drag(p, [{ name: "red.png", type: "image/png", data: b64(RED) }], "drop");
  ok(await seen(p, '#chatAtt .att-chip[data-att="ready"][data-att-name="red.png"]') && !(await p.locator("#chat.drop-on").count()), `${tag}: a dropped PNG becomes a ready chip with a thumbnail`);
  // paste: an image from the clipboard
  await paste(p, { name: "image.png", type: "image/png", data: b64(GREEN) });
  ok(await seen(p, '#chatAtt .att-chip[data-att="ready"][data-att-name="image.png"]'), `${tag}: a pasted image becomes a chip`);
  // pick: a PDF from the file picker; on Codex the chip says how Codex gets it
  await p.setInputFiles("#chatFile", { name: "brief.pdf", mimeType: "application/pdf", buffer: PDF });
  ok(await seen(p, '#chatAtt .att-chip[data-att="ready"][data-att-name="brief.pdf"] [data-att-note="info"]'), `${tag}: a picked PDF is a chip that says Codex gets a file path`);
  // a fake image is refused by the server and blocks the send until removed
  await drag(p, [{ name: "fake.png", type: "image/png", data: b64(Buffer.from("<html>not an image</html>")) }], "drop");
  ok(await seen(p, '#chatAtt .att-chip.is-bad[data-att="refused"][data-att-name="fake.png"] [data-att-note="refused"]'), `${tag}: HTML named .png shows as a refused chip with the server's reason`);
  const before = (await api("/api/main")).log.filter((x) => x.kind === "captain").length;
  await p.locator("#chatIn").fill(`look ${tag}`); await p.locator("#chatIn").press("Enter");
  await p.waitForTimeout(500);
  ok((await api("/api/main")).log.filter((x) => x.kind === "captain").length === before && await p.locator("#chatIn").inputValue() === `look ${tag}` && await p.locator("#chatAtt .att-chip").count() === 4, `${tag}: with a refused file the message is not sent and nothing is dropped`);
  await p.locator('#chatAtt [data-att-name="fake.png"] .att-x').click();
  await p.locator('#chatAtt [data-att-name="image.png"] .att-x').click();
  ok(await p.locator("#chatAtt .att-chip").count() === 2, `${tag}: removing chips leaves the other files pending`);
  await p.locator("#chatIn").focus();
  await p.locator(".toast").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await shot(p, `${tag}-pending`);
  await p.locator("#chatIn").press("Enter");
  const sent = `#chatLog [data-main="captain"]:has-text("look ${tag}")`;
  ok(await seen(p, `${sent} [data-att-sent="image"] img`) && await seen(p, `${sent} [data-att-sent="pdf"]`), `${tag}: the sent message shows its image and PDF`);
  ok(await p.locator("#chatAtt").isHidden() && await p.locator("#chatAtt .att-chip").count() === 0, `${tag}: the pending tray is empty after sending`);
  const v = await api("/api/main"), msg = v.log.find((x) => x.kind === "captain" && x.text === `look ${tag}`);
  ok(msg?.attachments?.map((a) => a.mime).join() === "image/png,application/pdf", `${tag}: the server got exactly the two remaining files`, JSON.stringify(msg?.attachments));
  ok(await seen(p, `#chatLog [data-main="firstmate"]:has-text("[images: ${RED.length}B]")`, 15000), `${tag}: Firstmate's reply shows it received the image`);
  await p.waitForTimeout(400); // the reply re-renders the log
  await p.evaluate(() => { const l = document.querySelector("#chatLog"); l.scrollTop = l.scrollHeight; });
  await shot(p, `${tag}-sent`);
  // history survives a reload
  await p.reload();
  if (width < 500 && await p.locator("#chatFab").isVisible().catch(() => false)) await p.locator("#chatFab").click();
  ok(await seen(p, `${sent} [data-att-sent="image"] img`, 15000) && await p.locator(`${sent} [data-att-sent="pdf"]`).count() === 1, `${tag}: after a reload the message still shows its files`);
  ok(await p.locator(`${sent} [data-att-sent="image"] img`).evaluate((i) => new Promise((done) => { const check = () => i.complete && i.naturalWidth === 96; if (check()) return done(true); i.addEventListener("load", () => done(check())); i.addEventListener("error", () => done(false)); setTimeout(() => done(check()), 8000); })), `${tag}: the history thumbnail loads Studio's stored image`);
  const href = await p.locator(`${sent} [data-att-sent="pdf"]`).getAttribute("href");
  ok(/^\/api\/main\/attachments\/[a-f0-9]{64}$/.test(href ?? ""), `${tag}: the PDF links to Studio's stored copy`);
  // a blue image with no text still goes
  await p.setInputFiles("#chatFile", { name: "blue.png", mimeType: "image/png", buffer: BLUE });
  await seen(p, '#chatAtt .att-chip[data-att="ready"]');
  await p.locator("#chatSend").click();
  ok(await seen(p, `#chatLog [data-main="captain"] [data-att-sent="image"] img[alt="blue.png"]`), `${tag}: an image alone, without text, is sent`);
  for (let i = 0; i < 100 && (await api("/api/main")).busy; i++) await p.waitForTimeout(100);
  await ctx.close();
}

try {
  await waitUp(base, app);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  ok((await api("/api/main/attach", { host: "codex", id: "th-ui" })).ok === true, "a Codex Firstmate is attached (stub)");
  await run(1280, "light", "en", "1280-light-en");
  await run(390, "dark", "zh-TW", "390-dark-zh");
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { ok(false, "the UI run finished", String(e?.stack ?? e).slice(0, 800)); }
finally { await browser?.close().catch(() => {}); app.kill("SIGTERM"); }
console.log(`chat-attachments-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
