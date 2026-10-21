import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { revealEditorControl } from "./lib/reveal-editor-control.mjs";
// Genuine local save responses held after commit, and native Chrome pointer
// input. Never synthesize a drop, verdict or successful server response.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const root = join(import.meta.dirname, ".."), temp = mkdtempSync(join(tmpdir(), "editor-owner-")), data = join(temp, "data");
const fixture = id => { const dir = join(data, "workflows", id); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "v1.json"), JSON.stringify({ id, name: "Editor ownership fixture", version: 1, roles: [], nodes: ["a", "b", "c"].map((id, i) => ({ id, kind: "hook", do: "note", label: id, x: 100 + i * 220, y: 100 })), edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }], by: "fixture" })); };
for (const width of [1440, 390]) for (const theme of ["light", "dark"]) for (const lang of ["en", "zh-TW"]) fixture(`save-${width}-${theme}-${lang.toLowerCase()}`);
fixture("layout-save"); fixture("pointers"); fixture("dispose-save");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env }; for (const k of ["CREW_FM_STATE", "GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN = "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, env: { ...env, CREW_DATA: data, CREW_PORT: String(port), CREW_GH: "0", CREW_GH_NO_CLI: "1", HOME: join(temp, "home"), CREW_MAIN_PROJECT: join(temp, "project"), CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_KEYCHAIN_TOOL: "none", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_CODEX_BIN: "/none", CREW_CLAUDE_BIN: "/none" }, stdio: ["ignore", "pipe", "pipe"] }); app.stdout.resume(); app.stderr.resume();
let browser, passed = 0, failed = 0;
const ok = (v, name) => { console.log(`${v ? "PASS" : "FAIL"} ${name}`); v ? passed++ : failed++; };
const shots = join(root, "tests/out/runtime-editor-ownership"); mkdirSync(shots, { recursive: true });
const open = async (context, id) => { const p = await context.newPage(); await p.goto(`${base}/#/workflows/${id}`); await revealEditorControl(p, '[data-view-toggle="detail"]'); await p.waitForSelector('[data-view-toggle="detail"]'); await revealEditorControl(p, '[data-view-toggle="detail"]'); await p.click('[data-view-toggle="detail"]'); await p.evaluate(() => document.body.classList.add("chat-closed")); await revealEditorControl(p, "[data-fit]"); await p.click("[data-fit]"); return p; };
const field = async (p, id, value) => { await p.locator(`[data-node="${id}"]`).focus(); await p.keyboard.press("Enter"); await p.locator('[data-field="label"]').fill(value); await revealEditorControl(p, "[data-fit]"); await p.click("[data-fit]"); };
const holdSave = async (p, id) => { let release, ready; const gate = new Promise(r => release = r), started = new Promise(r => ready = r); let first = true;
  const handler = async route => { if (route.request().method() !== "POST" || !first) return route.continue(); first = false; const response = await route.fetch(); ready(response.status()); await gate; try { await route.fulfill({ response }); } catch {} };
  await p.route(`**/api/wf/${id}`, handler); return { started, release, async close() { release(); await p.unroute(`**/api/wf/${id}`, handler); } }; };
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base);
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) for (const lang of ["en", "zh-TW"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme }); await context.addInitScript(({ lang }) => { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.chatOpen", "0"); }, { lang });
    const id = `save-${width}-${theme}-${lang.toLowerCase()}`, p = await open(context, id); const held = await holdSave(p, id);
    if(width===390){
      const originalSave=await p.$('[data-save]'),originalNote=await p.$('[data-save-note]');
      await p.locator('[data-node="a"]').focus();await p.keyboard.press('Enter');
      await p.waitForFunction(()=>document.querySelector('[data-inspector-savebar] [data-save]'));
      ok(await p.evaluate(({button,note})=>button===document.querySelector('[data-inspector-savebar] [data-save]')&&note===document.querySelector('[data-inspector-savebar] [data-save-note]'),{button:originalSave,note:originalNote}),`${width}/${theme}/${lang}: mobile inspector reuses the original real Save and note`);
      await p.locator('[data-inspector-savebar] [data-save-note]').fill('retain caret');await p.locator('[data-inspector-savebar] [data-save-note]').focus();
      await originalNote.evaluate(el=>el.setSelectionRange(2,5));await p.setViewportSize({width:390,height:980});await p.waitForTimeout(40);
      const caret=await p.evaluate(note=>({focused:document.activeElement===note,start:note.selectionStart,end:note.selectionEnd,active:document.activeElement?.outerHTML?.slice(0,180),parent:note.parentElement?.className}),originalNote);
      ok(caret.focused&&caret.start===2&&caret.end===5,'same-parent resize preserves the active note and caret '+JSON.stringify(caret));
      await p.setViewportSize({width:1440,height:1000});await p.waitForFunction(()=>document.querySelector('.wf-editor-save-home [data-save]'));
      ok(await p.evaluate(button=>button===document.querySelector('.wf-editor-save-home [data-save]'),originalSave),'resizing restores the same Save to the header');
      await p.setViewportSize({width:390,height:1000});await p.waitForFunction(()=>document.querySelector('[data-inspector-savebar] [data-save]'));
      await p.locator('[data-inspector-close]').click();
      ok(await p.evaluate(button=>button===document.querySelector('.wf-editor-save-home [data-save]')&&document.querySelectorAll('[data-save]').length===1,originalSave),'closing restores one original Save without cloning its authority');
    }
    await field(p, "a", "submitted snapshot"); await p.click("[data-save]"); ok(await held.started === 200, `${width}/${theme}/${lang}: genuine save committed before its response is released`);
    ok(await p.locator("[data-save]").isDisabled() && /Saving|儲存中/.test(await p.locator("[data-save]").textContent()), `${width}/${theme}/${lang}: pending save state is visible and duplicate save is held`);
    await field(p, "a", "later draft retained"); await p.locator("[data-save]").scrollIntoViewIfNeeded();
    await p.screenshot({ path: join(shots, `save-pending-${width}-${theme}-${lang}.png`), fullPage: true });
    held.release(); await p.waitForTimeout(300);
    await p.locator('[data-node="a"]').focus(); await p.keyboard.press("Enter");
    ok(await p.locator('[data-field="label"]').inputValue() === "later draft retained", `${width}/${theme}/${lang}: late node edits survive successful older save response`);
    const server = await (await p.request.get(`${base}/api/wf/${id}`)).json();
    ok(server.def.version === 2 && server.def.nodes.find(n => n.id === "a").label === "submitted snapshot", `${width}/${theme}/${lang}: server saved only the acknowledged snapshot`);
    ok(await p.locator('select[aria-label="Version"], select[aria-label="版本"]').inputValue() === "2" && /later edits remain unsaved|後續修改尚未儲存/.test(await p.locator(".rt-status").textContent()), `${width}/${theme}/${lang}: saved base advances while later draft stays unsaved`);
    await p.locator('.rt-panel').scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `save-retained-${width}-${theme}-${lang}.png`), fullPage: true });
    await held.close();
    await field(p, "a", "later draft retained");
    const oldSvg = await p.$("svg.rt-graph"); const oldPanel = await p.$(".rt-panel");
    await p.click("[data-save]"); await p.waitForFunction(() => /Saved as v3|已存成 v3/.test(document.querySelector("[data-diff]")?.textContent ?? ""));
    const latest = await (await p.request.get(`${base}/api/wf/${id}`)).json();
    ok(latest.def.version === 3 && latest.def.nodes.find(n => n.id === "a").label === "later draft retained", `${width}/${theme}/${lang}: repeated save uses advanced base and persists retained draft`);
    ok(await oldSvg.evaluate(el => !el.isConnected) && await oldPanel.evaluate(el => !el.isConnected), `${width}/${theme}/${lang}: replacing an acknowledged editor releases its old DOM owner`);
    await context.close();
  }
  // A successful replacement must abort its old validator, independently of
  // the delayed-save draft preservation cases above. Repeat with a new owner.
  { const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), p = await open(context, "dispose-save");
    for (const version of [1, 2]) {
      let release, ready; const gate = new Promise(r => release = r), started = new Promise(r => ready = r); let heldRequest, aborted = false;
      const failedRequest = request => { if (request === heldRequest) aborted = true; }; p.on("requestfailed", failedRequest);
      const handler = async route => { const request = route.request(); if (request.method() !== "POST" || request.postDataJSON()?.def?.version !== version || heldRequest) return route.continue(); heldRequest = request; const response = await route.fetch(); ready(); await gate; try { await route.fulfill({ response }); } catch {} };
      await p.route("**/api/wf/validate", handler);
      await field(p, "a", `replacement ${version}`); await started;
      const oldSvg = await p.$("svg.rt-graph"); await p.click("[data-save]");
      await p.waitForFunction(v => new RegExp(`Saved as v${v}|已存成 v${v}`).test(document.querySelector("[data-diff]")?.textContent ?? ""), version + 1);
      await p.waitForTimeout(150);
      ok(aborted && await oldSvg.evaluate(el => !el.isConnected), `successful save ${version}: replaced owner aborts its genuine in-flight validation`);
      release(); await p.unroute("**/api/wf/validate", handler); p.off("requestfailed", failedRequest);
    }
    await context.close();
  }
  // Layout edits do not schedule the normal content validator, but they are
  // still draft revisions and must not be erased by a save already in flight.
  { const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), p = await open(context, "layout-save"); const held = await holdSave(p, "layout-save");
    await field(p, "a", "layout snapshot"); await p.click("[data-save]"); await held.started;
    await p.locator('[data-node="b"]').focus(); await p.keyboard.press("Shift+ArrowRight"); const moved = await p.locator('[data-node="b"]').getAttribute("transform");
    held.release(); await p.waitForTimeout(300);
    ok(await p.locator('[data-node="b"]').getAttribute("transform") === moved && await p.locator('select[aria-label="Version"]').inputValue() === "2", "layout-only edit survives successful save and advances its base revision");
    await held.close(); await context.close(); }
  // Mouse owner plus a native touch pointer can end/cancel the secondary touch
  // independently (CDP touchEnd/touchCancel empty arrays affect touches only).
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, colorScheme: theme, hasTouch: true }), p = await open(context, "pointers"), client = await context.newCDPSession(p);
    await p.locator(".rt-canvas").scrollIntoViewIfNeeded();
    const point = async id => { const b = await p.locator(`[data-port="${id}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const b = await point("b"), c = await point("c"), a = await point("a");
    await p.evaluate(() => { window.fixturePointers = []; document.querySelector("svg.rt-graph").addEventListener("pointerdown", e => fixturePointers.push({ id: e.pointerId, type: e.pointerType })); });
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 10, x: b.x, y: b.y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 10, x: b.x, y: b.y }, { id: 11, x: c.x, y: c.y }] });
    ok(await p.evaluate(() => fixturePointers.filter(e => e.type === "touch").length >= 2) && await p.locator(".rt-wire").count() === 1, `${theme}: two genuine touch pointers reach the SVG but only the first owns one wire`);
    const touchWire = await p.locator(".rt-wire").first().getAttribute("d");
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 10, x: b.x, y: b.y }, { id: 11, x: a.x, y: a.y }] });
    ok(await p.locator(".rt-wire").count() === 1 && await p.locator(".rt-wire").first().getAttribute("d") === touchWire, `${theme}: moving the second real touch does not move the owner's wire`);
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    ok(await p.locator(".rt-wire").count() === 0, `${theme}: cancelling the actual touch owner clears all transient wire state`);
    const svg = await p.$("svg.rt-graph"); await p.mouse.move(b.x, b.y); await p.mouse.down(); await p.mouse.move(b.x + 1, b.y + 1);
    const owner = await p.evaluate(() => fixturePointers.find(e => e.type === "mouse")?.id), original = await p.locator(".rt-wire").first().getAttribute("d");
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: c.x, y: c.y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: a.x, y: a.y }] });
    ok(await p.locator(".rt-wire").count() === 1 && await p.locator(".rt-wire").first().getAttribute("d") === original, `${theme}: secondary down/move cannot overwrite the owner's wire`);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    ok(await svg.evaluate((el, owner) => el.isConnected && el.hasPointerCapture(owner), owner) && await p.locator('[data-edge="b→a"]').count() === 0, `${theme}: secondary pointerup cannot commit or release the owner`);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 2, x: c.x, y: c.y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    ok(await svg.evaluate((el, owner) => el.isConnected && el.hasPointerCapture(owner), owner) && await p.locator(".rt-wire").count() === 1, `${theme}: secondary pointercancel cannot cancel the owner`);
    await p.screenshot({ path: join(shots, `pointer-owner-${theme}.png`) });
    await svg.evaluate((el, owner) => el.releasePointerCapture(owner), owner); await p.mouse.move(a.x, a.y); await p.mouse.up();
    ok(await p.locator(".rt-wire").count() === 0 && await p.locator('[data-edge="b→a"]').count() === 0 && await p.locator('[data-edge="c→a"]').count() === 0, `${theme}: owner cancellation leaves no ghost wire or unintended edge`);
    await client.detach(); await context.close();
  }
} catch (e) { console.error(e.message); failed++; }
finally { await browser?.close(); app.kill(); await new Promise(resolve => { if (app.exitCode !== null) resolve(); else app.once("exit", resolve); }); rmSync(temp, { recursive: true, force: true }); }
console.log(`${passed} passed / ${failed} failed`); process.exitCode = failed ? 1 : 0;
