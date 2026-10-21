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
fixture("history-cancel"); fixture("history-failure"); fixture("history-layout-save"); fixture("layout-save"); fixture("pointers"); fixture("dispose-save");
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
  // Two genuine layout writes straddle a Save. Neither a late v1 position ACK
  // nor the acknowledged v2 snapshot may overwrite the newer draft.
  { const id = "history-layout-save", context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), p = await open(context, id);
    let releaseA, releaseB, readyA, readyB, count = 0;
    const gateA = new Promise(r => releaseA = r), gateB = new Promise(r => releaseB = r), startedA = new Promise(r => readyA = r), startedB = new Promise(r => readyB = r);
    const handler = async route => { if (route.request().method() !== "POST") return route.continue(); const n = ++count; if (n > 2) return route.continue(); const body = route.request().postDataJSON(); (n === 1 ? readyA : readyB)(body); await (n === 1 ? gateA : gateB); await route.continue(); };
    await p.route(`**/api/wf/${id}/layout`, handler); const held = await holdSave(p, id);
    const drag = async dx => { const b = await p.locator('[data-node="b"] rect').first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + 15, { steps: 12 }); await p.mouse.up(); };
    await field(p, "a", "history layout snapshot"); await drag(35); const a = await startedA;
    await p.click('[data-save]'); ok(await p.locator('[data-editor-undo]').isDisabled(), 'Save waiting for layout blocks history controls');
    await drag(45); const draftB = await p.locator('[data-node="b"]').getAttribute('transform'); releaseA(); const b = await startedB;
    ok(await held.started === 200, 'Save commits captured A while later layout B remains held');
    const savedA = (await (await p.request.get(`${base}/api/wf/${id}`)).json()).def;
    ok(savedA.version === 2 && savedA.nodes.find(n => n.id === 'b').x === a.positions.b.x && b.positions.b.x !== a.positions.b.x, 'v2 contains captured layout A, not later draft B');
    held.release(); await p.waitForFunction(() => /later edits remain unsaved/.test(document.querySelector('.rt-status').textContent));
    ok(await p.locator('[data-node="b"]').getAttribute('transform') === draftB && await p.locator('[data-editor-undo]').isDisabled(), 'Save ACK retains later layout B and resets the history checkpoint');
    const late = p.waitForResponse(r => r.url().endsWith(`/api/wf/${id}/layout`) && r.request().postDataJSON()?.positions?.b?.x === b.positions.b.x); releaseB(); await late;
    const afterB = (await (await p.request.get(`${base}/api/wf/${id}`)).json()).def;
    ok(afterB.version === 2 && afterB.nodes.find(n => n.id === 'b').x === a.positions.b.x && await p.locator('[data-node="b"]').getAttribute('transform') === draftB && /later edits remain unsaved/.test(await p.locator('.rt-status').textContent()), 'late v1 B ACK changes neither saved v2 nor newer draft/status');
    await held.close(); await p.unroute(`**/api/wf/${id}/layout`, handler); await p.click('[data-save]'); await p.waitForFunction(() => /Saved as v3/.test(document.querySelector('[data-diff]')?.textContent || ''));
    await p.reload(); await p.waitForSelector('[data-node="b"]'); const final = (await (await p.request.get(`${base}/api/wf/${id}`)).json()).def;
    ok(final.version === 3 && final.nodes.find(n => n.id === 'b').x === b.positions.b.x, 'subsequent Save and reload persist the retained B layout');
    await context.close();
  }
  { const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true }), p = await open(context, 'history-cancel'), client = await context.newCDPSession(p); let writes = 0;
    p.on('request', r => { if (r.method() === 'POST' && /\/(layout|graph-layout\/)/.test(r.url())) writes++; });
    const before = await p.locator('[data-node="b"]').getAttribute('transform'), box = await p.locator('[data-node="b"] rect').first().boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] }); await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x + 35, y: y + 20 }] }); await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await p.waitForFunction(before => document.querySelector('[data-node="b"]').getAttribute('transform') === before, before);
    ok(writes === 0 && await p.locator('[data-editor-undo]').isDisabled(), 'cancelled native drag restores position with zero layout writes and no history entry'); await client.detach(); await context.close();
  }
  { const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), p = await open(context, 'history-failure'); let modeWrites = 0, failedPositions, retryPositions;
    const beforeMove = await p.locator('[data-node="b"]').evaluate(el => { const m = el.transform.baseVal.consolidate().matrix; return {x:m.e,y:m.f}; });
    p.on('response', r => { if (r.request().method() === 'POST' && r.url().includes('/api/graph-layout/') && r.ok()) modeWrites++; });
    await p.route('**/api/wf/history-failure/layout', route => { if(route.request().method() !== 'POST') return route.continue(); failedPositions = route.request().postDataJSON().positions; return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'controlled layout refusal'})}); });
    await p.locator('[data-node="b"]').focus(); await p.keyboard.press('Shift+ArrowRight'); await p.waitForFunction(() => /Position change could not be saved/.test(document.querySelector('.rt-status').textContent));
    const unchanged = (await (await p.request.get(`${base}/api/wf/history-failure`)).json()).def;
    ok(modeWrites === 1 && unchanged.nodes.find(n => n.id === 'b').x === 320 && failedPositions.b.x === beforeMove.x + 50 && failedPositions.b.y === beforeMove.y, 'successful mode ACK plus failed position write reports failure and leaves saved coordinates unchanged');
    await p.unroute('**/api/wf/history-failure/layout'); await p.route('**/api/wf/history-failure/layout', route => { if(route.request().method() === 'POST') retryPositions = route.request().postDataJSON().positions; return route.continue(); }); await field(p, 'a', 'retry position'); await p.click('[data-save]'); await p.waitForFunction(() => /Saved as v2/.test(document.querySelector('[data-diff]')?.textContent || ''));
    const retried = (await (await p.request.get(`${base}/api/wf/history-failure`)).json()).def;
    ok(retried.version === 2 && JSON.stringify(retryPositions) === JSON.stringify(failedPositions) && retried.nodes.every(n => n.x === failedPositions[n.id].x && n.y === failedPositions[n.id].y), 'Save retries the real failed layout before creating a version ' + JSON.stringify(retried.nodes)); await context.close();
  }
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
