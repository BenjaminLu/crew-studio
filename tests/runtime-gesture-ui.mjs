// Real browser pointer gestures while genuine local validation responses are
// delayed. No synthetic drop or verdict; route.fetch uses the actual validator.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const root = join(import.meta.dirname, ".."), temp = mkdtempSync(join(tmpdir(), "runtime-gesture-")), data = join(temp, "data");
const wfDir = join(data, "workflows", "gesture"); mkdirSync(wfDir, { recursive: true });
writeFileSync(join(wfDir, "v1.json"), JSON.stringify({ id: "gesture", name: "Gesture fixture", version: 1, roles: [], nodes: ["a", "b", "c"].map((id, i) => ({ id, kind: "hook", label: id, do: "note", x: 100 + 220 * i, y: 100 })), edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }], by: "fixture" }));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env }; for (const k of ["CREW_FM_STATE", "GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN = "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, env: { ...env, CREW_DATA: data, CREW_PORT: String(port), CREW_GH: "0", CREW_GH_NO_CLI: "1", HOME: join(temp, "home"), CREW_MAIN_PROJECT: join(temp, "project"), CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_KEYCHAIN_TOOL: "none", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_CODEX_BIN: "/none", CREW_CLAUDE_BIN: "/none" }, stdio: ["ignore", "pipe", "pipe"] });
app.stdout.resume(); app.stderr.resume();
let passed = 0, failed = 0, browser;
const ok = (v, name) => { console.log(`${v ? "PASS" : "FAIL"} ${name}`); v ? passed++ : failed++; };
const shots = join(root, "tests/out/runtime-gesture"); mkdirSync(shots, { recursive: true });
const open = async (context) => { const p = await context.newPage(); await p.goto(base + "/#/workflows/gesture"); await p.waitForSelector('[data-view-toggle="detail"]'); await p.click('[data-view-toggle="detail"]'); await p.evaluate(() => document.body.classList.add("chat-closed")); await p.click("[data-fit]"); return p; };
const arm = async (p) => {
  let release, ready; const gate = new Promise(r => release = r), started = new Promise(r => ready = r); let first = true;
  await p.route("**/api/wf/validate", async route => { if (!first) return route.continue(); first = false; const response = await route.fetch(); ready(); await gate; try { await route.fulfill({ response }); } catch {} });
  return { started, release, async dispose() { release(); await p.unroute("**/api/wf/validate"); } };
};
const editDetail = async (p, node) => { await p.locator(`[data-node="${node}"]`).focus(); await p.keyboard.press("Enter"); await p.locator('[data-field="detail"]').fill("pending actual validation"); await p.click("[data-fit]"); };
const down = async (p, from) => { await p.click("[data-fit]"); await p.locator(".rt-canvas").scrollIntoViewIfNeeded(); const box = await p.locator(`[data-port="${from}"]`).boundingBox(); const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }; await p.evaluate(() => document.querySelector("svg.rt-graph").addEventListener("pointerdown", e => window.fixturePointer = e.pointerId, { once: true })); const svg = await p.$("svg.rt-graph"); await p.mouse.move(point.x, point.y); await p.mouse.down(); await p.mouse.move(point.x + 1, point.y + 1); return { svg, point }; };
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base);
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, hasTouch: true }); const p = await open(context);
    const delayed = await arm(p); await editDetail(p, "b"); await delayed.started;
    const { svg } = await down(p, "b"); const responded = p.waitForResponse(r => r.url().endsWith("/api/wf/validate")); delayed.release(); await responded; await p.waitForTimeout(50);
    ok(await svg.evaluate(el => el.isConnected && !!el.querySelector(".rt-wire")), `${width}/${theme}: real validation keeps the captured SVG alive`);
    const b = await p.locator('[data-node="a"] .rt-box').boundingBox(), end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await p.mouse.move(end.x, end.y, { steps: 10 }); await p.screenshot({ path: join(shots, `pending-drag-${width}-${theme}.png`) });
    await p.mouse.up(); await p.waitForTimeout(500);
    ok(await p.locator('[data-edge="b→a"]').count() === 1, `${width}/${theme}: pointerup completes the real connection after deferred redraw`);
    ok(await p.locator('[data-valid]').getAttribute("data-valid") === "errors", `${width}/${theme}: latest cyclic graph validity is shown`);
    await p.screenshot({ path: join(shots, `completed-drag-${width}-${theme}.png`) }); await delayed.dispose(); await p.close();
    // The previous unsaved edit is discarded by navigating away; fresh fixture.
    const q = await open(context); const held = await arm(q); await editDetail(q, "b"); await held.started;
    const canceled = await down(q, "b");
    await q.evaluate(() => { const svg = document.querySelector("svg.rt-graph"); svg.releasePointerCapture(window.fixturePointer); }); const cancelTarget = await q.locator('[data-node="a"] .rt-box').boundingBox(); await q.mouse.move(cancelTarget.x + cancelTarget.width / 2, cancelTarget.y + cancelTarget.height / 2, { steps: 4 }); await q.mouse.up(); held.release(); await q.waitForTimeout(150);
    ok(await q.locator(".rt-wire").count() === 0 && await q.locator('[data-edge="b→a"]').count() === 0 && !(await canceled.svg.evaluate(el => !!el.querySelector(".rt-wire"))), `${width}/${theme}: lost pointer capture cancels without creating an edge`);
    await held.dispose();
    // Keep later cases independent on a broken base, using the real editor to
    // remove any ghost connection after its failure was recorded above.
    if (await q.locator('[data-edge="b→a"]').count()) { await q.locator('[data-edge="b→a"]').focus(); await q.keyboard.press("Enter"); await q.click('[data-del-edge="b→a"]'); await q.waitForFunction(() => document.querySelector('[data-valid]')?.dataset.valid === "ok"); }
    // Native Chrome touchCancel delivers pointercancel, not a synthetic DOM drop.
    await q.click("[data-fit]"); await q.locator(".rt-canvas").scrollIntoViewIfNeeded();
    const client = await context.newCDPSession(q); const portBox = await q.locator('[data-port="b"]').boundingBox();
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: portBox.x + portBox.width / 2, y: portBox.y + portBox.height / 2 }] });
    ok(await q.locator(".rt-wire").count() === 1, `${width}/${theme}: native touch begins a real port gesture`);
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    ok(await q.locator(".rt-wire").count() === 0 && await q.locator('[data-edge="b→a"]').count() === 0, `${width}/${theme}: native pointercancel removes the transient wire without changing edges`); await client.detach();
    // An older genuinely valid response must not overwrite a newer invalid
    // revision. The browser request is aborted and the generation remains bound.
    const stale = await arm(q); await editDetail(q, "a"); await stale.started;
    await q.locator('[data-edge="b→c"]').focus(); await q.keyboard.press("Enter"); await q.click('[data-del-edge="b→c"]');
    await q.waitForFunction(() => document.querySelector('[data-valid]')?.dataset.valid === "errors"); stale.release(); await q.waitForTimeout(100);
    ok(await q.locator('[data-valid]').getAttribute("data-valid") === "errors" && await q.locator('[data-edge="b→c"]').count() === 0, `${width}/${theme}: older valid response cannot replace latest invalid graph facts`);
    await stale.dispose();
    // Navigate while a validation response and pointer gesture are both pending.
    const nav = await arm(q); await q.locator('[data-node="a"]').focus(); await q.keyboard.press("Enter"); await q.locator('[data-field="detail"]').fill("navigation pending validation"); await q.click("[data-fit]"); await nav.started;
    const navigating = await down(q, "b"); await q.locator('a[href="#/workflows"]').focus(); await q.keyboard.press("Enter"); await q.waitForSelector('[data-wf="gesture"]'); nav.release(); await q.mouse.up(); await q.waitForTimeout(100);
    ok(await navigating.svg.evaluate(el => !el.isConnected && !el.querySelector(".rt-wire")), `${width}/${theme}: navigation cancels pointer ownership and deferred drawing`);
    await q.click('[data-wf="gesture"]'); await q.waitForSelector('[data-view-toggle="detail"]'); await q.click('[data-view-toggle="detail"]');
    ok(await q.locator('[data-edge="b→a"]').count() === 0 && await q.locator('[data-valid]').getAttribute("data-valid") === "ok", `${width}/${theme}: old validation cannot leak into a newly loaded editor`);
    await nav.dispose(); await context.close();
  }
} catch (e) { console.error(e.message); failed++; }
finally { await browser?.close(); app.kill(); await new Promise(resolve => { if (app.exitCode !== null) resolve(); else app.once("exit", resolve); }); rmSync(temp, { recursive: true, force: true }); }
console.log(`${passed} passed / ${failed} failed`); process.exitCode = failed ? 1 : 0;
