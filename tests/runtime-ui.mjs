import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The runtime pages (unit code-firstmate-smoke): the code-firstmate workflow in the
// graph editor, edited and saved as v2 with its diff, then run end to end on the
// sandbox repository from the Runs page with the stub provider (dispatch card →
// merge card → merged), with the run shown live on its graph and as an overlay in
// the editor. 1440 and 390, light and dark.      node tests/runtime-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("runtime-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
// the Playwright this suite uses: PLAYWRIGHT_MODULE, else the package
const PW_MODULE = process.env.PLAYWRIGHT_MODULE || (() => { try { return fileURLToPath(import.meta.resolve("playwright")); } catch { return null; } })();
const tmp = mkdtempSync(join(tmpdir(), "crew-rtui-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
// code-firstmate runs on an approved crew: a Codex login the stub CLI (tests/fixture/codex-account.mjs) hands to the
// scripted agent (tests/acceptance/agent.mjs), so every round goes through the real native Codex path offline
const codexHome = join(tmp, "home", ".codex"); mkdirSync(codexHome, { recursive: true });
writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", last_refresh: "2020-02-29T12:34:56.123+08:00", tokens: { access_token: "abcdefgh.abcdefgh.abcdefgh", id_token: "fixture-id-token", account_id: "fixture-acceptance", refresh_token: "acceptance-refresh-must-not-copy" } }), { mode: 0o600 });
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: join(root, "tests/fixture/codex-account.mjs"), CODEX_HOME: codexHome,
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp, ...(PW_MODULE ? { CREW_PLAYWRIGHT_MODULE: PW_MODULE } : {}) } }); // Studio's renderer (the app captures) uses the Playwright this test uses
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out"); mkdirSync(shots, { recursive: true });
const pos = (p, id) => p.$eval(`[data-node="${id}"]`, (g) => { const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform")); return { x: Number(m[1]), y: Number(m[2]) }; });
const INTENT = ["Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100); \\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n',
  "STUB_FIX src/percent.ts :: / 100);  => / 100);"].join("\n");
let runId = null;
const api = async (path, body) => { const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-crew-session": env.CREW_SESSION_TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
// the captain's staffing discussion and its captain-only confirmation card, every role on the stub Codex account
async function approveStaffing(project, workflow) {
  const version = (await api(`/api/wf/${workflow}`)).body.def.version, target = { project, workflow, version };
  let r = (await api(`/api/intake/staffing?project=${project}&workflow=${workflow}&version=${version}`)).body; if (r.error) throw new Error("staffing interview: " + r.error);
  const roles = [...new Set((r.frontier ?? []).map((q) => q.role))];
  for (const [field, value] of [["provider", "codex"], ["model", "fixture-model"], ["effort", "low"]]) { const a = await api("/api/intake/staffing", { ...target, answers: Object.fromEntries(roles.map((id) => [id, { [field]: value }])) }); if (a.status !== 200 || a.body.error) throw new Error(`staffing ${field}: ${a.status} ${a.body.error ?? ""}`); r = a.body; }
  const conf = await api("/api/intake/staffing", { ...target, roles: r.choices, confirm: true }); if (!conf.body.proposal) throw new Error("staffing confirmation: " + JSON.stringify(conf.body).slice(0, 300));
  for (let i = 0; i < 200; i++) { const card = (await api("/api/scards")).body.cards?.find((c) => c.run === conf.body.proposal); if (card) { await api(`/api/scards/${card.id}/answer`, { choice: "approve" }); break; } await new Promise((res) => setTimeout(res, 100)); }
  for (let i = 0; i < 200; i++) { if ((await api(`/api/wruns/${conf.body.proposal}`)).body.status === "succeeded") return; await new Promise((res) => setTimeout(res, 100)); }
  throw new Error("staffing approval did not finish");
}
try {
  // ---------- the editor, 1440 light: the full interaction ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 }, colorScheme: "light" }); const p = await ctx.newPage(); // tall enough for the canvas and the palette under it (drag and drop between them)
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/workflows`); await p.waitForSelector('[data-wf="code-firstmate"]');
    ok(await p.locator('[data-wf="code-firstmate"]').isVisible(), "Workflows lists code-firstmate");
    await p.evaluate(() => document.body.classList.add("chat-closed")); // the chat panel closed: the editor gets the room
    await p.click('[data-wf="code-firstmate"]'); await p.waitForSelector('[data-editor="code-firstmate"] [data-node="spec"]');
    await p.click('[data-view-toggle="detail"]'); await p.waitForSelector('svg.rt-graph[data-view="detail"] [data-node="spec-fix"]'); // editing happens in Detail view
    ok(await p.getAttribute('[data-node="spec"]', "data-checks") === "7" && await p.locator('[data-edge="remote-ready→merge-card[ok]"]').getAttribute("data-edge-checks") === "6" && (await p.locator("[data-node]").count()) >= 25,
      "the editor loads code-firstmate's graph with check badges on nodes (spec ✓7) and edges (six gates on review → merge card)");
    ok((await p.textContent("[data-valid]")).startsWith("Valid"), "the loaded graph validates");
    // drag a node: its position is kept for the version
    const before = await pos(p, "prepare"); const box = await p.locator('[data-node="prepare"] .rt-box').boundingBox();
    await p.mouse.move(box.x + 40, box.y + 20); await p.mouse.down(); await p.mouse.move(box.x + 90, box.y + 80, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400);
    const after = await pos(p, "prepare");
    await p.reload(); await p.evaluate(() => document.body.classList.add("chat-closed")); await p.waitForSelector('[data-node="prepare"]'); const reloaded = await pos(p, "prepare");
    ok(after.y > before.y + 30 && reloaded.x === after.x && reloaded.y === after.y, "dragging a node moves it, and the position is kept for the version (it survives a reload)", JSON.stringify({ before, after, reloaded }));
    // keyboard: Tab to a node, arrows move it, Enter opens it
    await p.focus('[data-node="intake"]'); const k0 = await pos(p, "intake"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("Shift+ArrowRight"); await p.waitForTimeout(200);
    const k1 = await pos(p, "intake"); await p.focus('[data-node="intake"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
    ok(k1.y === k0.y + 10 && k1.x === k0.x + 50 && (await p.textContent(".rt-panel h3")) === "Capture intent", "keyboard: arrows move the focused node, Enter opens it in the side panel", JSON.stringify({ k0, k1 }));
    // disconnect an edge, add a node from the palette, reconnect through it by dragging from the ports
    await p.focus('[data-edge="cleanup→done"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(100);
    ok((await p.textContent(".rt-panel h3")) === "cleanup → done", "an edge is selected from the keyboard (Tab to it, Enter)");
    await p.click('[data-del-edge="cleanup→done"]'); await p.waitForTimeout(500);
    ok(!(await p.locator('[data-edge="cleanup→done"]').count()) && (await p.getAttribute("[data-valid]", "data-valid")) === "errors", "disconnecting an edge: the graph no longer validates (done is cut off)", await p.textContent(".rt-problems"));
    await p.click('[data-add="hook"]'); await p.waitForTimeout(300);
    const added = await p.$eval(".rt-node.sel", (g) => g.dataset.node);
    // move the new node next to cleanup, then wire cleanup → new → done by dragging from the ports
    const cl = await pos(p, "cleanup"); const ad = await pos(p, added); await p.focus(`[data-node="${added}"]`);
    const dx = Math.round((cl.x + 80 - ad.x) / 50), dy = Math.round((cl.y + 120 - ad.y) / 50);
    for (let i = 0; i < Math.abs(dx); i++) await p.keyboard.press(dx > 0 ? "Shift+ArrowRight" : "Shift+ArrowLeft");
    for (let i = 0; i < Math.abs(dy); i++) await p.keyboard.press(dy > 0 ? "Shift+ArrowDown" : "Shift+ArrowUp");
    await p.focus('[data-node="cleanup"]'); await p.waitForTimeout(200);
    const wire = async (from, to) => {
      // Focus/Fit may pan the SVG, and every connection rerenders it. Resolve
      // ports from the current DOM, including after pointerdown; never retain
      // coordinates from the prior render or from before a focus-induced pan.
      await p.focus(`[data-node="${from}"]`); await p.click("[data-fit]");
      await p.locator(".rt-canvas").scrollIntoViewIfNeeded();
      const port = p.locator(`[data-port="${from}"]`); const a = await port.boundingBox();
      const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
      const startHit = await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-port]")?.dataset.port, start);
      ok(startHit === from, `wire ${from} → ${to}: actual pointer starts on the current port`, String(startHit));
      const capturedSvg = await p.$("svg.rt-graph");
      await p.mouse.move(start.x, start.y); await p.mouse.down();
      // The pending real validation request redraws asynchronously. A human
      // holding a drag through it must retain the same captured SVG.
      await p.waitForTimeout(350);
      ok(await capturedSvg.evaluate(svg => svg.isConnected), `wire ${from} → ${to}: validation does not replace the captured SVG`);
      const b = await p.locator(`[data-node="${to}"] .rt-box`).boundingBox();
      const target = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      await p.mouse.move(target.x, target.y, { steps: 10 });
      const targetHit = await p.evaluate(({ x, y }) => document.elementsFromPoint(x, y).find(el => !el.classList.contains("rt-wire"))?.closest("[data-node]")?.dataset.node, target);
      ok(targetHit === to, `wire ${from} → ${to}: actual pointer reaches the current target node`, String(targetHit));
      await p.mouse.up(); await p.waitForSelector(`[data-edge="${from}→${to}"]`, { state: "attached", timeout: 5000 });
      await p.waitForTimeout(350);
    };
    await wire("cleanup", added); await wire(added, "done"); await p.waitForTimeout(500);
    ok(await p.locator(`[data-edge="cleanup→${added}"]`).count() === 1 && await p.locator(`[data-edge="${added}→done"]`).count() === 1 && (await p.getAttribute("[data-valid]", "data-valid")) === "ok",
      "reconnecting by dragging from a node's port: cleanup → new hook → done, and the graph validates again", await p.textContent(".rt-problems"));
    // drop a check from the palette onto the new node, then onto an edge
    await p.locator('[data-pal-check="core/ste-wording"]').dragTo(p.locator(`[data-node="${added}"] .rt-box`)); await p.waitForTimeout(300);
    ok(await p.getAttribute(`[data-node="${added}"]`, "data-checks") === "1", "dragging a check from the palette onto a node attaches it (badge ✓1)");
    await p.focus('[data-node="build"]'); await p.waitForTimeout(150);
    // a real pointer drag (mouse down, move, up; force only skips the visibility wait for a transparent hit path), dropped at the
    // middle of build→pr-open (a forward curve is symmetric about its box's centre, so that centre lies on it), after asserting that
    // point hits this edge: no back edge covers it
    await p.$eval('[data-edge="build→pr-open[ok]"] .rt-hit', (path) => path.scrollIntoView({ block: "center", inline: "center" })); await p.waitForTimeout(300);
    const eb = await p.locator('[data-edge="build→pr-open[ok]"] .rt-hit').boundingBox(); const drop = { x: eb.x + eb.width / 2, y: eb.y + eb.height / 2 };
    drop.hit = await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el?.closest("[data-edge]")?.getAttribute("data-edge") ?? el?.getAttribute("class") ?? null; }, [drop.x, drop.y]);
    ok(drop.hit === "build→pr-open[ok]", "the middle of the forward edge build→pr-open hits that edge (no back edge covers it)", String(drop.hit));
    let dragErr = null; await p.locator('[data-pal-check="firstmate/scope"]').dragTo(p.locator('[data-edge="build→pr-open[ok]"] .rt-hit'), { targetPosition: { x: eb.width / 2, y: eb.height / 2 }, force: true, timeout: 8000 }).catch((e) => { dragErr = String(e.message).split("\n")[0]; }); await p.waitForTimeout(300);
    ok(await p.locator('[data-edge="build→pr-open[ok]"]').getAttribute("data-edge-checks") === "1", "dragging a check onto an edge attaches it to the edge (a real pointer drag dropped at that point, no synthetic drop)", String(dragErr));
    // the side panel: a params form from the check's schema, and Try on sample
    await p.focus('[data-node="spec"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(200);
    const det = p.locator('[data-check="core/ste-wording"]'); if (!(await det.getAttribute("open"))) await det.locator("summary").click();
    ok(await det.locator(".rt-params .rt-field").count() > 0, "the side panel shows a params form generated from the check's schema");
    await det.locator('[data-try="core/ste-wording"]').click(); await p.waitForFunction(() => document.querySelector('[data-try-out="core/ste-wording"]')?.dataset.verdict, null, { timeout: 30000 }).catch(() => {});
    const verdict = await p.getAttribute('[data-try-out="core/ste-wording"]', "data-verdict");
    ok(["pass", "warn", "fail"].includes(verdict), "Try on sample runs the check on its sample and shows the verdict", verdict);
    // keep the run harmless: take the checks back off the new node and the edge
    await p.focus(`[data-node="${added}"]`); await p.keyboard.press("Enter"); await p.waitForTimeout(150); await p.evaluate(() => document.querySelectorAll(".rt-panel details").forEach((d) => (d.open = true)));
    await p.locator(".rt-panel [data-check='core/ste-wording'] button", { hasText: "Remove" }).click(); await p.waitForTimeout(150);
    await p.focus('[data-edge="build→pr-open[ok]"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(150); await p.evaluate(() => document.querySelectorAll(".rt-panel details").forEach((d) => (d.open = true)));
    await p.locator(".rt-panel [data-check='firstmate/scope'] button", { hasText: "Remove" }).click(); await p.waitForTimeout(400);
    // save as v2: the diff
    await p.fill("[data-save-note]", "a hand-off step before done"); await p.click("[data-save]"); await p.waitForSelector("[data-diff] b", { timeout: 10000 });
    const diff = await p.textContent("[data-diff]");
    ok(/Saved as v2/.test(diff) && new RegExp(`\\+ nodes ${added}`).test(diff) && /\+ edges/.test(diff) && /cleanup→done/.test(diff), "saving makes v2 and shows its diff (added node, added and removed edges)", diff);
    const v = await p.$eval('select[aria-label="Version"]', (s) => [...s.options].map((o) => o.textContent));
    ok(v.length === 2 && /v2 · a hand-off step before done/.test(v[1]), "the version list holds v1 and v2 with its note", JSON.stringify(v));
    await p.screenshot({ path: join(shots, "runtime-editor-1440-light.png") });
    // ---------- a run: from the Runs page, end to end on the sandbox repository ----------
    await p.goto(`${base}/#/runs`); await p.waitForSelector("[data-run-text]");
    await approveStaffing("sandbox", "code-firstmate");
    await p.fill("[data-run-text]", INTENT); await p.selectOption("[data-run-wf]", "code-firstmate");
    await p.waitForSelector('[data-run-project="code-firstmate"] option[value="sandbox"]', { state: "attached" }); await p.selectOption('[data-run-project="code-firstmate"]', "sandbox");
    await p.waitForSelector('[data-run-crew="approved"]'); await p.click("[data-run-start]");
    await p.waitForSelector("[data-runview]"); runId = await p.getAttribute("[data-runview]", "data-runview");
    await p.waitForSelector('[data-scard] [data-option="dispatch"]', { timeout: 120000 });
    ok(await p.locator('[data-node="spec"][data-state="passed"]').count() === 1, "the run view shows the run's graph with live node states (spec passed, waiting on dispatch)");
    await p.screenshot({ path: join(shots, "runtime-run-dispatch-1440-light.png") });
    // the Studio card is in the Inbox too, beside firstmate's, labelled with run, workflow and node, counted in the sidebar, answerable there
    await p.goto(`${base}/#/inbox`); await p.waitForSelector('[data-inbox-studio] [data-scard] [data-option="dispatch"]', { timeout: 15000 });
    const meta = await p.textContent("[data-inbox-studio] [data-scard-meta]"); const navN = (await p.textContent("#navInbox")).trim();
    ok(meta.includes(runId) && /code-firstmate/.test(meta) && /dispatch/.test(meta) && navN === "1", "a Studio card shows in the Inbox labelled with its run, workflow and node, and the sidebar Inbox count includes it", JSON.stringify([meta, navN]));
    for (const scheme of ["light", "dark"]) { const pc = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: scheme }); const pp = await pc.newPage();
      await pp.goto(`${base}/#/inbox`); await pp.waitForSelector("[data-inbox-studio] [data-scard]", { timeout: 15000 }).catch(() => {});
      const sw = await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); await pp.screenshot({ path: join(shots, `runtime-inbox-390-${scheme}.png`) });
      ok((await pp.locator("[data-inbox-studio] [data-scard]").count()) === 1 && sw, `the Inbox with a Studio card renders at 390 ${scheme} with no sideways scroll`); await pc.close(); }
    await p.click('[data-inbox-studio] [data-scard] [data-option="dispatch"]');
    ok(await p.waitForFunction(() => !document.querySelector('[data-inbox-studio] [data-option="dispatch"]') && (document.querySelector("#navInbox")?.textContent ?? "").trim() === "", null, { timeout: 15000 }).then(() => true, () => false),
      "answered from the Inbox: the card leaves it and the count drops");
    await p.goto(`${base}/#/run/${runId}`);
    await p.waitForSelector('[data-scard] [data-option="merge"]', { timeout: 180000 });
    const body = await p.textContent(".rt-card-body");
    ok(/Six gates:/.test(body) && /Proved by checks:/.test(body), "the merge card arrives with the six gates and the ledger split");
    // the change touches the library the app uses: the merge card shows the app before / after, and the run page and the card link the head's build
    await p.waitForSelector("[data-captures] img", { timeout: 15000 }).catch(async (e) => { const rv = await (await p.request.get(`${base}/api/wruns/${runId}`)).json(); console.log("DEBUG", JSON.stringify(rv.ctx?.captures).slice(0, 800), JSON.stringify(rv.ledger.filter((x) => x.check === "firstmate/ui-captures")).slice(0, 800), rv.ctx?.gatedHead, JSON.stringify(rv.cards.map((c) => [c.kind, !!c.captures]))); throw e; });
    const capImgs = await p.locator("[data-captures] img").count(); const appHref = await p.getAttribute('[data-card-link="Open the app"]', "href"); const runApp = await p.getAttribute("[data-open-app]", "href");
    const appRes = await p.request.get(`${base}${appHref}`); const imgOk = await p.$$eval("[data-captures] img", (xs) => xs.every((i) => i.complete && i.naturalWidth > 0));
    ok(capImgs === 4 && imgOk && appHref === runApp && /\/after\/index\.html$/.test(appHref) && appRes.status() === 200 && /^sandbox;/.test(appRes.headers()["content-security-policy"] ?? "") && /Corner Shop/.test(await appRes.text()),
      "the merge card shows the app's before / after captures (they load), and Open the app (card and run page) serves the head's build, sandboxed", JSON.stringify([capImgs, imgOk, appHref, runApp, appRes.status()]));
    await p.locator("[data-captures]").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, "runtime-merge-captures-1440-light.png") });
    // the one-way confirmation works in the Inbox too: the merge card, made one-way for this check, refuses a merge without the tick
    const mc = await p.getAttribute('[data-scard]:has([data-option="merge"])', "data-scard"); const cf = join(data, "cards", `${mc}.json`);
    // (the card is re-saved once its STE check finishes raising it: rewrite until the change holds)
    for (let i = 0; i < 20; i++) { const card = JSON.parse(readFileSync(cf, "utf8")); if (card.door === "one-way" && card.ste) break; if (card.ste) writeFileSync(cf, JSON.stringify({ ...card, door: "one-way", confirmDoor: true })); await p.waitForTimeout(500); }
    await p.goto(`${base}/#/inbox/${mc}`); await p.waitForSelector(`[data-inbox-studio] [data-confirm-door="${mc}"]`, { timeout: 15000 });
    await p.click('[data-inbox-studio] [data-option="merge"]'); await p.waitForFunction(() => /confirm the door first/.test(document.querySelector("[data-inbox-studio] .rt-card [role=status]")?.textContent ?? ""), null, { timeout: 10000 });
    // (unit intent-merge-card) a merge also needs every intent line ticked: tick them, then merge
    await p.check(`[data-confirm-door="${mc}"]`); const nt = await p.locator('[data-inbox-studio] [data-intent-tick]').count(); for (let i = 0; i < nt; i++) await p.check(`[data-inbox-studio] [data-intent-tick="${i}"]`);
    await p.click('[data-inbox-studio] [data-option="merge"]');
    await p.goto(`${base}/#/run/${runId}`);
    await p.waitForSelector('[data-run-status="succeeded"]', { timeout: 120000 });
    ok(JSON.parse(readFileSync(cf, "utf8")).answer?.confirm === "one-way", "a one-way Studio card in the Inbox refuses an answer without the door tick and takes it with the tick, as on the run page");
    ok(await p.locator('[data-node="done"][data-state="passed"]').count() === 1 && await p.locator(`[data-node="${added}"][data-state="passed"]`).count() === 1, "the run reaches Merged through the v2 graph (the new hand-off node ran)", runId);
    await p.screenshot({ path: join(shots, "runtime-run-merged-1440-light.png"), fullPage: true });
    // the run as an overlay in the editor
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector('[data-overlay]'); await p.selectOption("[data-overlay]", runId); await p.waitForTimeout(800);
    ok(await p.locator('[data-node="merge"][data-state="passed"]').count() === 1, "the editor overlays a run's node states on the graph");
    await ctx.close(); }
  // ---------- every page at 1440 and 390, light and dark ----------
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    for (const [route, sel, name] of [["#/workflows", "[data-wf]", "workflows"], ["#/workflows/code-firstmate", "[data-node]", "editor"], ["#/runs", "[data-run]", "runs"], [`#/run/${runId}`, "[data-runview] [data-node]", "run"]]) {
      await p.goto(`${base}/${route}`); await p.waitForSelector(sel, { timeout: 15000 }).catch(() => {});
      const sw = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      ok((await p.locator(sel).count()) > 0 && sw, `${name} renders at ${width} ${scheme} with no sideways scroll`);
      await p.screenshot({ path: join(shots, `runtime-${name}-${width}-${scheme}.png`) });
    }
    if (width === 390) { await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector("[data-node]");
      const c = await p.locator(".rt-canvas").boundingBox(); ok(c.width > 300 && c.width <= 390, "on a phone the canvas takes the width, palette and panel stack under it", JSON.stringify(c)); }
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.slice(0, 5).join(" | "));
  { const src = (await import("node:fs")).readFileSync(join(root, "public/runtime.js"), "utf8");
    ok(!/new EventSource/.test(src) && /window\.liveListen/.test(src), "the runtime pages listen on the page's one event stream (a browser allows 6 connections per host; every extra stream starves the page's requests)"); }
} catch (e) { ok(false, `exception ${e.message}`, appLog.slice(-1500)); }
await browser.close(); app.kill();
console.log(`\nruntime-ui: ${pass} passed, ${fail} failed${runId ? ` (run ${runId})` : ""}`);
process.exit(fail ? 1 : 0);
