import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The tidy workflow graph in the pages: the auto layout on a newly loaded built-in
// workflow, no drawn edge through a node (sampled on the drawn paths), dashed arcs,
// stages that collapse and expand (collapsed on a phone, with their state in the
// live view), count badges that open their lists, Tidy / Fit to view / minimap, the
// manual mode a drag starts, and screenshots of every built-in workflow at 1440
// and 390 px, light and dark.      node tests/graph-tidy-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("graph-tidy-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-gtidy-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
// the pack workflows a live Studio holds, as fixtures (the bundled ones seed themselves)
for (const f of readdirSync(join(here, "fixture/workflows"))) { const d = JSON.parse(readFileSync(join(here, "fixture/workflows", f), "utf8")); mkdirSync(join(data, "workflows", d.id), { recursive: true });
  writeFileSync(join(data, "workflows", d.id, "v1.json"), JSON.stringify({ ...d, version: 1, parent: null, createdAt: new Date().toISOString(), by: "test fixture", note: "fixture", diff: null, seed: null })); }
// a version dragged before graph-tidy: its layout file exists, with no layout-mode entry
{ const v = JSON.parse(readFileSync(join(here, "fixture/workflows/video.json"), "utf8")); const pos = Object.fromEntries(v.nodes.map((n, i) => [n.id, { x: 40 + i * 200, y: 60 + (i % 2) * 140 }]));
  writeFileSync(join(data, "workflows", "video", "layout-v1.json"), JSON.stringify(pos)); globalThis.legacyPos = pos; }
// a real code-firstmate Task for the live view, seeded before the server starts: since a6fd64f one started through the
// server needs a signed captain staffing approval naming a real provider (tests/lib/code-firstmate-run-seed.ts)
const { spawnSync } = await import("node:child_process");
const seeded = spawnSync("bun", ["tests/lib/code-firstmate-run-seed.ts", data, "Add a percent function"], { cwd: root, encoding: "utf8" });
const seededRun = (() => { try { return JSON.parse(seeded.stdout.trim().split("\n").at(-1)).id; } catch { return null; } })();
if (!seededRun) { console.error(`graph-tidy-ui: the code-firstmate Task could not be seeded\n${seeded.stdout}\n${seeded.stderr}`); process.exit(1); }
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", CREW_EXAMPLE_WORKFLOWS: "1",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out/graph-tidy/after"); mkdirSync(shots, { recursive: true });
const before = join(root, "tests/out/graph-tidy/before"); mkdirSync(before, { recursive: true });
const { existsSync } = await import("node:fs");
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(body) }).then((r) => r.json());
const page = async (width, scheme) => { const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e.message}`));
  await p.goto(`${base}/#/workflows`); await p.evaluate(() => { localStorage.setItem("crew.chatOpen", "0"); document.body.classList.add("chat-closed"); }); return p; };
const nodePos = (p) => p.$$eval("[data-node]", (gs) => Object.fromEntries(gs.map((g) => { const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform")); return [g.dataset.node, [Number(m[1]), Number(m[2])]]; })));
const autoPos = (p, id, collapsed = []) => p.evaluate(async ([id, collapsed]) => { const j = await (await fetch(`/api/wf/${id}`)).json(); const g = window.crewLayout.layout(j.def, { collapsed }); return Object.fromEntries(g.nodes.filter((n) => n.kind === "node").map((n) => [n.id, [n.x, n.y]])); }, [id, collapsed]);
const same = (a, b) => Object.keys(b).length > 0 && Object.entries(b).every(([k, v]) => a[k] && a[k][0] === v[0] && a[k][1] === v[1]);
// every drawn edge, sampled along its path, against every drawn node box
const through = (p) => p.evaluate(() => {
  const svg = document.querySelector("svg.rt-graph"); const boxes = [...svg.querySelectorAll("[data-node], [data-stage-node]")].map((g) => { const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform")); const r = g.querySelector(".rt-box"); return { id: g.dataset.node || g.dataset.stageNode, x: Number(m[1]), y: Number(m[2]), w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")) }; });
  const bad = [];
  for (const path of svg.querySelectorAll(".rt-edge .rt-line")) { const len = path.getTotalLength(); for (let l = 0; l <= len; l += 3) { const q = path.getPointAtLength(l);
    const b = boxes.find((r) => q.x > r.x + 2 && q.x < r.x + r.w - 2 && q.y > r.y + 2 && q.y < r.y + r.h - 2); if (b) { bad.push(`${path.parentNode.dataset.edge} in ${b.id}`); break; } } }
  return bad; });
try {
  const wfs0 = (await (await fetch(`${base}/api/wf`)).json()).workflows;
  // ---------- before: every built-in workflow in its hand layout (manual mode, Detail view), then back to auto ----------
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme); await p.evaluate(() => localStorage.setItem("crew.graphView", "detail"));
    for (const w of wfs0) { const legacy = w.id === "video"; if (!legacy) await post(`/api/graph-layout/${w.id}/v${w.version}`, { mode: "manual" });
      await p.goto(`${base}/#/workflows/${w.id}${w.id==="coffee-kit"?"/advanced":""}`); await p.reload(); await p.evaluate(() => document.body.classList.add("chat-closed")); await p.waitForSelector("svg.rt-graph [data-node]", { timeout: 15000 }).catch(() => {});
      await p.click("[data-fit]").catch(() => {}); await p.waitForTimeout(150);
      await p.screenshot({ path: join(before, `${w.id}-${width}-${scheme}.png`), fullPage: true });
      if (!legacy) await post(`/api/graph-layout/${w.id}/v${w.version}`, { mode: "auto" }); }
    await p.context().close();
  }
  ok(wfs0.every((w) => existsSync(join(before, `${w.id}-1440-light.png`)) && existsSync(join(before, `${w.id}-390-dark.png`))), "before screenshots of the hand layouts exist for every workflow, 1440 and 390, light and dark");
  // ---------- the simple view (the default): main path, badges, toggle, docked minimap, readable Fit ----------
  { const p = await page(1440, "light");
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector('svg.rt-graph[data-view="simple"] [data-node="spec"]'); await p.waitForTimeout(300);
    const ids = await p.$$eval("svg.rt-graph [data-node]", (gs) => gs.map((g) => g.dataset.node));
    ok(ids.length === 19 && ids.includes("pr-open") && !ids.some((x) => ["spec-fix", "fix", "plan-fix", "door-pick", "step-back", "stalled", "budget", "scope-card", "parked", "closed", "dropped"].includes(x)), "the simple view is the default and shows the main path with publication and the designer round (19 nodes)", ids.join(","));
    ok(await p.locator("svg.rt-graph .rt-edge[data-back]").count() === 0 && await p.locator('svg.rt-graph .rt-edge[data-edge*="step-back"], svg.rt-graph .rt-edge[data-edge*="scope-card"], svg.rt-graph .rt-edge[data-edge*="→spec["]').count() === 0, "no back edges and no escalation edges in simple view");
    const bt = async (k) => (await p.textContent(`[data-badge="${k}"]`).catch(() => "")) || "";
    ok(await bt("loop:spec") === "↻ refine ≤3" && await bt("loop:build") === "↻ fix ≤3" && await bt("ask:door") === "? asks you if unsure" && await bt("s:build:escalations") === "⚑ 8 escalations" && await bt("s:intake:escalations") === "⚑ 3 escalations",
      "the badges show the loops (with their cap), the door question and the escalation counts", [await bt("loop:spec"), await bt("loop:build"), await bt("ask:door"), await bt("s:build:escalations")].join(" | "));
    await p.locator('[data-badge="s:build:escalations"]').dispatchEvent("click"); await p.waitForTimeout(150);
    const esc = await p.$$eval('[data-badge-list="s:build:escalations"] .rt-badge-item', (xs) => xs.map((x) => x.textContent));
    ok(esc.length === 8 && esc.includes("Step-back card"), "an escalation badge lists its escalations", esc.join(","));
    await p.locator('[data-badge="s:build:escalations"]').dispatchEvent("click");
    const minFont = await p.evaluate(() => { const svg = document.querySelector("svg.rt-graph"); const k = svg.getScreenCTM().a; return Math.min(...[...svg.querySelectorAll("[data-node] .rt-label")].map((t) => parseFloat(getComputedStyle(t).fontSize) * k)); });
    ok(minFont >= 11, "node titles render at 11 px or more in the simple view at Fit (1440)", `${minFont.toFixed(1)} px`);
    ok(await p.locator("[data-minimap]").count() === 0, "the simple view fits whole and needs no minimap");
    await p.screenshot({ path: join(shots, "editor-simple-1440-light.png") });
    await p.click('[data-view-toggle="detail"]'); await p.waitForSelector('svg.rt-graph[data-view="detail"] [data-node="spec-fix"]');
    const detailIds = await p.$$eval("svg.rt-graph [data-node]", (gs) => gs.length);
    ok(detailIds === 32 && await p.locator("svg.rt-graph .rt-edge[data-back]").count() >= 10 && await p.locator("[data-port]").count() === 32 && await p.locator('svg.rt-graph [data-node="pr-open"]').count() === 1, "toggling to Detail view restores every node, back edge and port", String(detailIds));
    await p.click('[data-view-toggle="simple"]'); await p.waitForSelector('svg.rt-graph[data-view="simple"]');
    ok(await p.locator("svg.rt-graph [data-node]").count() === 19 && await p.locator("[data-port]").count() === 0 && await p.isVisible("[data-palette-note]"), "back in the simple view: the main path again, editing points to Detail view");
    await p.context().close();
  }
  // ---------- a version dragged before graph-tidy opens in manual mode, and a drag keeps its other positions ----------
  { const p = await page(1440, "light"); await p.evaluate(() => localStorage.setItem("crew.graphView", "detail"));
    await p.goto(`${base}/#/workflows/video`); await p.waitForSelector('svg.rt-graph[data-view="detail"] [data-node="make"]');
    const saved = globalThis.legacyPos; const at = await nodePos(p);
    ok(await p.getAttribute("svg.rt-graph", "data-layout") === "manual" && Object.entries(saved).every(([k, v]) => at[k] && at[k][0] === v.x && at[k][1] === v.y), "a version with a layout saved before this change opens in manual mode with its positions", JSON.stringify(at));
    // Reload only after this actual drag's layout write is acknowledged.
    const layoutSaved = p.waitForResponse(r => r.url() === `${base}/api/wf/video/layout` && r.request().method() === "POST" && r.request().postDataJSON()?.version === 1 && !!r.request().postDataJSON()?.positions?.render);
    // Let the real pointer target settle after the editor's deferred initial fit.
    await p.locator('[data-node="render"] .rt-box').hover({ position: { x: 20, y: 20 } });
    const box = await p.locator('[data-node="render"] .rt-box').boundingBox();
    await p.mouse.move(box.x + 20, box.y + 20); await p.mouse.down(); await p.mouse.move(box.x + 50, box.y + 70, { steps: 6 }); await p.mouse.up(); const persisted = await layoutSaved; ok(persisted.ok(), "the first drag is acknowledged before reload", `HTTP ${persisted.status()}`);
    await p.reload(); await p.waitForSelector('[data-node="make"]'); const after = await nodePos(p);
    ok(Object.entries(saved).filter(([k]) => k !== "render").every(([k, v]) => after[k][0] === v.x && after[k][1] === v.y) && (after.render[0] !== saved.render.x || after.render[1] !== saved.render.y), "the first drag keeps every other saved position", JSON.stringify(after));
    await p.context().close();
  }
  // ---------- 1440 light, Detail view: layout, arcs, badges, stages, modes, controls ----------
  { const p = await page(1440, "light"); await p.evaluate(() => localStorage.setItem("crew.graphView", "detail"));
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector('svg.rt-graph[data-view="detail"] [data-node="spec"]');
    ok(await p.getAttribute("svg.rt-graph", "data-layout") === "auto" && same(await nodePos(p), await autoPos(p, "code-firstmate")), "a newly loaded built-in workflow uses the auto layout");
    // Detail view: the minimap is docked outside the canvas: it covers no node and no edge
    const hitsMm = await p.evaluate(() => { const mm = document.querySelector("[data-minimap]")?.getBoundingClientRect(); if (!mm) return ["no minimap"]; const cv = document.querySelector(".rt-canvas").getBoundingClientRect();
      const clip = (r) => ({ l: Math.max(r.left, cv.left), t: Math.max(r.top, cv.top), r: Math.min(r.right, cv.right), b: Math.min(r.bottom, cv.bottom) });
      const bad = []; for (const el of document.querySelectorAll("svg.rt-graph [data-node], svg.rt-graph [data-stage-node], svg.rt-graph .rt-edge .rt-line")) { const c = clip(el.getBoundingClientRect()); if (c.r <= c.l || c.b <= c.t) continue; if (c.l < mm.right && mm.left < c.r && c.t < mm.bottom && mm.top < c.b) bad.push(el.closest("[data-node],[data-edge]")?.dataset.node || el.closest("[data-edge]")?.dataset.edge); } return bad; });
    ok(!hitsMm.length, "the minimap does not cover any node or edge", hitsMm.slice(0, 4).join(","));
    const tb = await through(p);
    ok(!tb.length, "no drawn edge passes through a node", tb.slice(0, 5).join("; "));
    const arcs = await p.$$eval(".rt-edge[data-back] .rt-line", (ps) => ps.map((x) => getComputedStyle(x).strokeDasharray));
    ok(arcs.length >= 10 && arcs.every((d) => d && d !== "none"), "back edges are drawn as dashed arcs", JSON.stringify(arcs.slice(0, 3)));
    // spec carries eight checks since 21b3fe5 added firstmate/env-preflight
    ok(await p.textContent('[data-badge="n:spec"]') === "8 checks" && /7 gates/.test(await p.textContent('[data-badge^="e:remote-ready→merge-card"]')) && await p.getAttribute('[data-node="spec"]', "data-checks") === "8", "checks and gates show as count badges");
    await p.click('[data-badge="n:spec"]'); await p.waitForTimeout(150);
    const items = await p.locator('[data-badge-list="n:spec"] .rt-badge-item').count();
    await p.click('[data-badge="n:spec"]'); await p.waitForTimeout(150);
    ok(items === 8 && await p.locator('[data-badge-list="n:spec"]').count() === 0, "a badge opens its list", `items ${items}`);
    await p.focus('[data-stage-toggle="build"]'); await p.keyboard.press("Enter"); await p.waitForSelector('[data-stage-node="build"]'); // from the keyboard
    const collapsedOk = await p.locator('[data-node="build"]').count() === 0 && await p.locator('[data-node="ci"]').count() === 0 && !(await through(p)).length;
    await p.locator('[data-stage-node="build"]').dispatchEvent("click"); await p.waitForSelector('[data-node="build"]'); // and with a click
    ok(collapsedOk && await p.locator('[data-stage-node="build"]').count() === 0 && await p.locator('[data-stage="build"]').count() === 1, "a stage collapses into one box and expands again");
    await p.screenshot({ path: join(shots, "editor-start-1440-light.png") });
    // Fit to view shows every node
    await p.click("[data-fit]"); await p.waitForTimeout(200);
    const fits = await p.evaluate(() => { const svg = document.querySelector("svg.rt-graph"); const [x, y, w, h] = svg.getAttribute("viewBox").split(" ").map(Number); const b = svg.lay.bbox; return b.x >= x - 1 && b.y >= y - 1 && b.x + b.w <= x + w + 1 && b.y + b.h <= y + h + 1; });
    ok(fits, "Fit to view shows the whole graph");
    await p.screenshot({ path: join(shots, "editor-fit-1440-light.png") });
    // the minimap moves the view
    await p.click("[data-fit]"); await p.waitForTimeout(100); await p.click("[data-tidy]"); await p.waitForTimeout(300);
    const vx0 = Number((await p.getAttribute("svg.rt-graph", "viewBox")).split(" ")[0]);
    await p.evaluate(() => document.body.classList.add("chat-closed")); await p.waitForTimeout(200);
    await p.locator("[data-minimap]").scrollIntoViewIfNeeded(); const mm = await p.locator("[data-minimap]").boundingBox(); await p.mouse.click(mm.x + mm.width - 10, mm.y + mm.height / 2); await p.waitForTimeout(150);
    const vx1 = Number((await p.getAttribute("svg.rt-graph", "viewBox")).split(" ")[0]);
    ok(mm && vx1 > vx0 + 200, "the minimap moves the view", `${vx0} → ${vx1}`);
    // a drag turns the version manual and is kept; Tidy layout goes back
    await p.click("[data-tidy]"); await p.waitForTimeout(300);
    const box = await p.locator('[data-node="prepare"] .rt-box').boundingBox();
    await p.mouse.move(box.x + 30, box.y + 20); await p.mouse.down(); await p.mouse.move(box.x + 60, box.y + 120, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600);
    const moved = (await nodePos(p)).prepare;
    await p.reload(); await p.evaluate(() => document.body.classList.add("chat-closed")); await p.waitForSelector('[data-node="prepare"]');
    const kept = (await nodePos(p)).prepare;
    ok(await p.getAttribute("svg.rt-graph", "data-layout") === "manual" && kept[0] === moved[0] && kept[1] === moved[1], "a dragged node keeps its place after a reload (manual mode)", JSON.stringify({ moved, kept }));
    await p.click("[data-tidy]"); await p.waitForTimeout(400);
    await p.reload(); await p.evaluate(() => document.body.classList.add("chat-closed")); await p.waitForSelector('[data-node="prepare"]');
    ok(await p.getAttribute("svg.rt-graph", "data-layout") === "auto" && same(await nodePos(p), await autoPos(p, "code-firstmate")), "Tidy layout returns to the auto layout");
    await p.context().close();
  }
  // ---------- the live view: the same layout, node states; collapsed stages carry their state ----------
  let runId = null;
  { runId = seededRun;
    const p = await page(1440, "light");
    await p.goto(`${base}/#/run/${runId}`); await p.waitForSelector('[data-runview] [data-node="spec"][data-state]', { timeout: 120000 }).catch(() => {});
    const simpleIds = await p.evaluate(async () => { const j = await (await fetch("/api/wf/code-firstmate")).json(); return window.crewLayout.layoutSimple(j.def, { wrap: 6 }).nodes.map((n) => n.id).sort(); });
    const shown = (await p.$$eval("[data-runview] [data-node]", (gs) => gs.map((g) => g.dataset.node))).sort();
    ok(runId && JSON.stringify(shown) === JSON.stringify(simpleIds) && await p.locator("[data-runview] [data-state]").count() > 0, "the run view shows the same simple view, with node states", shown.join(","));
    ok(/round \d\/3/.test(await p.textContent('[data-badge="loop:spec"]').catch(() => "")), "in the live view the loop badge shows the current round", await p.textContent('[data-badge="loop:spec"]').catch(() => "none"));
    await p.click('[data-view-toggle="detail"]'); await p.waitForSelector('[data-runview] svg.rt-graph[data-view="detail"]');
    const detailStates = await p.$$eval("[data-runview] svg.rt-graph[data-view=detail] [data-node][data-state]", (gs) => Object.fromEntries(gs.map((g) => [g.dataset.node, g.dataset.state])));
    const apiStates = await (await fetch(`${base}/api/wruns/${runId}`)).json().then((r) => Object.fromEntries(Object.entries(r.nodes).filter(([, n]) => n.state && n.state !== "pending").map(([k, n]) => [k, n.state])));
    ok(same(await nodePos(p), await autoPos(p, "code-firstmate")) && Object.keys(detailStates).length > 0 && Object.entries(detailStates).every(([k, v]) => !apiStates[k] || apiStates[k] === v),
      "the run view's Detail view uses the same tidy layout, with node states", JSON.stringify(detailStates));
    await p.screenshot({ path: join(shots, "run-1440-light.png"), fullPage: true });
    await p.context().close();
    const q = await page(390, "light");
    await q.goto(`${base}/#/run/${runId}`); await q.waitForSelector('[data-stage-node="intake"]', { timeout: 30000 }).catch(() => {});
    const st = await q.getAttribute('[data-stage-node="intake"]', "data-state").catch(() => null);
    ok(["running", "passed", "failed"].includes(st), "a collapsed stage shows its state in the live view", String(st));
    await q.screenshot({ path: join(shots, "run-390-light.png"), fullPage: true });
    await q.context().close();
  }
  // ---------- a phone starts with the stages collapsed ----------
  { const p = await page(390, "light");
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector("[data-stage-node]");
    ok(await p.locator("[data-stage-node]").count() === 7 && await p.locator("svg.rt-graph [data-stage]").count() === 0, "on a phone the stages start collapsed");
    await p.context().close();
  }
  // ---------- every built-in workflow, 1440 and 390, light and dark ----------
  const wfs = (await (await fetch(`${base}/api/wf`)).json()).workflows.map((w) => w.id);
  // + the two retained four-agent fixtures (6ad1e71), the public startup-recursion (4bc5390) and hello-crew-studio (afe9e27)
  // workflows; github-review is held as preview-only (73f504e), so /api/wf lists it under held, not here
  const expected=["code-firstmate","coffee-kit","crew-onboarding-collab","documents","file-organization","four-agent-proposals","hello-crew-studio","images","pack-genesis","startup-recursion","trivial-lane","video","web-prototype"];
  ok(JSON.stringify([...wfs].sort())===JSON.stringify(expected), "public native workflows plus the explicitly installed captain fixture lane", wfs.join(","));
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    for (const id of wfs) for (const view of ["simple", "detail"]) {
      await p.evaluate((v) => localStorage.setItem("crew.graphView", v), view);
      await p.goto(`${base}/#/workflows/${id}${id==="coffee-kit"?"/advanced":""}`); await p.reload(); await p.evaluate(() => document.body.classList.add("chat-closed"));
      const okSel = await p.waitForSelector(`svg.rt-graph[data-view="${view}"] [data-node], svg.rt-graph[data-view="${view}"] [data-stage-node]`, { timeout: 15000 }).then(() => true).catch(() => false);
      await p.waitForTimeout(200);
      ok(okSel && !(await through(p)).length && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${id} renders at ${width} ${scheme} (${view})`);
      await p.screenshot({ path: join(shots, `${id}-${view}-${width}-${scheme}.png`), fullPage: true });
      if (view === "simple") { await p.click("[data-fit]"); await p.waitForTimeout(150); await p.screenshot({ path: join(shots, `${id}-simple-fit-${width}-${scheme}.png`), fullPage: true }); }
    }
    await p.context().close();
  }
  ok(!errors.length, "no page errors", errors.slice(0, 3).join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\ngraph-tidy-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
