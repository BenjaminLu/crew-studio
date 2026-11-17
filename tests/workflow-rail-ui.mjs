import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The workflow page's Steps view (public/wf-rail.js) in a real browser against an isolated native Studio (temp data, stub
// providers): the seven editing tasks end to end through Save, the drawn rail (connectors, gates, ends, detours), a large
// bundled workflow opening collapsed, parallel steps as a read-only fork, the graph editor still at …/advanced, dark and phone.
import { spawn } from "node:child_process"; import { mkdtempSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { seedShipFeature } from "./lib/rail-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), dir = mkdtempSync(join(tmpdir(), "crew-rail-")), data = join(dir, "data"), state = join(dir, "state"), shots = join(root, "tests/out/workflow-rail");
mkdirSync(data); mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(shots, { recursive: true });
const port = await freePort(), base = `http://127.0.0.1:${port}`, env = { ...process.env }; for (const k of Object.keys(env)) if (/TOKEN|API_KEY/.test(k)) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_SESSION_TOKEN: "rail-fixture", CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(dir, "home"), CREW_MAIN_PROJECT: join(dir, "project") } });
let log = ""; app.stdout.on("data", (b) => (log += b)); app.stderr.on("data", (b) => (log += b));
let browser, pass = 0, fail = 0;
const ok = (v, name, detail = "") => { if (v) { pass++; console.log("  ok    " + name); } else { fail++; console.log("  FAIL  " + name + " " + detail); } };
const names = (p) => p.$$eval(".r-wrap > .r-step", (r) => r.map((x) => x.querySelector(".r-name, .r-loopline b")?.textContent));
const wf = async (ctx, id = "ship-feature") => (await (await ctx.request.get(`${base}/api/wf/${id}`)).json()).def;
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base, "rail-fixture");
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem("crew.lang", "en"); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(String(e)));
  const v2 = await seedShipFeature(ctx.request, base);
  await p.goto(`${base}/#/workflows/ship-feature`); await p.waitForSelector("[data-rail-wrap]");
  ok((await p.textContent("[data-rail-story]")).includes("ends with Done"), "one sentence on top says where the workflow ends");
  ok(JSON.stringify(await names(p)) === JSON.stringify(["Take the request", "Plan the change", "You approve the plan", "Build it", "Review the change", "QA gate", "Open the pull request"]), "the main line reads in order", JSON.stringify(await names(p)));
  ok(await p.locator("[data-rail-detours] [data-step='stuck']").count() === 1, "a step only a branch reaches is listed below the ends as a detour");
  ok(await p.locator("[data-rail-end]").count() === 2 && (await p.textContent("[data-rail-end='closed']")).includes("from step"), "the Ends block lists every end and where it comes from");
  ok(await p.locator(".r-step[data-step='approve-plan'] .r-cp.k-card").count() === 1 && await p.locator(".r-step[data-step='qa'] .r-cp.k-check").count() === 1, "cards and checks are checkpoints on the line");
  ok(await p.locator("[data-rail-gate='plan']").count() === 1, "a step's must-pass checks are a tag on the segment after it");
  await p.waitForFunction(() => Number(document.querySelector("[data-rail-wrap]")?.dataset.connectors) >= 2);
  ok(await p.locator(".r-conn path.back").count() >= 2, "back-branches are drawn as return connectors");
  ok((await p.textContent(".r-step[data-step='review']")).includes("max 3 rounds"), "a back-branch shows its round cap");
  ok(await p.locator("[data-rail-savebar]").isHidden(), "no save bar before any change");

  // 1. add a step between two steps
  await p.hover("[data-link='review']"); await p.click("[data-after='review']"); await p.click(".wf-menu [data-mi='agent']");
  await p.fill("[data-rail-name]", "Write release notes"); await p.press("[data-rail-name]", "Enter");
  let order = await names(p); ok(order.indexOf("Write release notes") === order.indexOf("Review the change") + 1 && order.indexOf("QA gate") === order.indexOf("Write release notes") + 1, "task 1: + on the line adds a step between Review and QA", JSON.stringify(order));
  ok((await p.textContent("[data-rail-changes]")).includes("2 unsaved changes"), "the save bar counts the changes and says they are not live", await p.textContent("[data-rail-changes]"));
  ok((await p.getAttribute("[data-start-run]", "data-tip") || "").includes("saved version"), "Start a task says it uses the saved version");
  await p.click("[data-act='close']");

  // 2. change a step's agent and skill
  await p.click(".r-step[data-step='review'] .r-name"); await p.selectOption("[data-rail-role]", "builder");
  ok((await p.textContent(".r-step[data-step='review'] .r-who")).includes("Builder"), "task 2: the drawer's Role changes the step's agent");
  const offSkill = p.locator(".wf-drawer [data-skill][aria-checked='false']").first();
  if (await offSkill.count()) { const id = await offSkill.getAttribute("data-skill"); await offSkill.click(); ok(await p.locator(`.wf-drawer [data-skill='${id}'][aria-checked='true']`).count() === 1, "task 2: a suggested skill turns on"); }
  else ok(true, "task 2: no suggested skill in this library (switch not exercised)");
  await p.click("[data-act='close']");

  // 3. add a branch: QA fails → Build it
  await p.click(".r-step[data-step='qa'] [data-act='fixwarn']"); await p.click(".wf-pick [data-out='fail']"); await p.click(".wf-pick [data-to='build']");
  ok(await p.locator(".r-step[data-step='qa'] .wf-chip[data-cto='build']").count() === 1, "task 3: the warning's Add a branch draws “If fails ↩ back to Build”");
  ok(await p.locator(".r-step[data-step='qa'] [data-act='fixwarn']").count() === 0, "task 3: the check's stop-here warning is gone");

  // 4. reorder: QA above the release notes (drag), then back down with the keyboard menu
  const notesId = await p.$$eval(".r-wrap > .r-step", (r) => r.find((x) => x.querySelector(".r-name")?.textContent === "Write release notes")?.dataset.step);
  await p.dragAndDrop(".r-step[data-step='qa']", `.r-wrap > .r-step[data-step='${notesId}']`, { targetPosition: { x: 300, y: 4 } });
  order = await names(p); ok(order.indexOf("QA gate") === order.indexOf("Write release notes") - 1, "task 4: dragging a step reorders the line", JSON.stringify(order));
  await p.click(".r-step[data-step='qa'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='dn']");
  order = await names(p); ok(order.indexOf("QA gate") === order.indexOf("Write release notes") + 1, "task 4: ⋯ → Move down puts it back", JSON.stringify(order));

  // 5. rename the workflow and a step
  await p.click("h1[data-act='rename']"); await p.fill("#wfName", "Ship a feature (team)"); await p.press("#wfName", "Enter");
  await p.waitForFunction(() => document.querySelector("h1[data-ed-name]")?.textContent === "Ship a feature (team)");
  ok((await (await ctx.request.get(`${base}/api/wf/ship-feature`)).json()).displayName === "Ship a feature (team)", "task 5: clicking the title renames the workflow");
  await p.click("[data-rail-page-menu]"); await p.click(".wf-menu [data-mi='r']"); await p.click("[data-workflow-rename-reset]");
  await p.waitForFunction(() => document.querySelector("h1[data-ed-name]")?.textContent === "Ship a feature"); ok(true, "⋯ → Rename… keeps Reset to default");
  await p.click(".r-step[data-step='build'] .r-name"); await p.fill("[data-rail-name]", "Build and test"); await p.press("[data-rail-name]", "Enter");
  ok((await names(p)).includes("Build and test"), "task 5: the drawer renames a step"); await p.click("[data-act='close']");

  // 6. gates: ask me after QA, and Build must pass a check
  await p.click(".r-step[data-step='qa'] .r-name"); await p.click("#dAsk");
  order = await names(p); ok(order[order.indexOf("QA gate") + 1] === "You approve: QA gate", "task 6: “Ask me before continuing” puts a decision card after the step", JSON.stringify(order));
  await p.click("[data-act='close']");
  await p.click(".r-step[data-step='build'] .r-name"); await p.click(".wf-drawer [data-act='addcheck']"); const ck = await p.getAttribute(".wf-pick [data-ck]", "data-ck"); await p.click(".wf-pick [data-ck]");
  ok(await p.locator("[data-rail-gate='build']").count() === 1, "task 6: Add a check makes a must-pass tag after Build"); await p.click("[data-act='close']");

  // undo / redo
  const before = await p.textContent("[data-rail-changes]"); await p.click("[data-act='undo']"); ok(await p.locator("[data-rail-gate='build']").count() === 0, "Undo takes the last change back");
  await p.click("[data-act='redo']"); ok(await p.locator("[data-rail-gate='build']").count() === 1 && (await p.textContent("[data-rail-changes]")) === before, "Redo puts it back");
  await p.screenshot({ path: join(shots, "edited.png") });

  // 7. save
  await p.fill("[data-rail-note]", "Release notes, QA branch, approval"); await p.click("[data-rail-save]");
  await p.waitForFunction(async () => (await fetch("/api/wf/ship-feature").then((r) => r.json())).def.version === 3);
  const v3 = await wf(ctx);
  const notes = v3.nodes.find((n) => n.label === "Write release notes"), card = v3.nodes.find((n) => n.label === "You approve: QA gate");
  ok(v3.note === "Release notes, QA branch, approval", "task 7: Save makes v3 with the note");
  ok(!!notes && v3.edges.some((e) => e.from === "review" && e.to === notes.id) && v3.edges.some((e) => e.from === "qa" && e.to === card?.id && e.when === "pass"), "saved: review → release notes → QA → approval card", JSON.stringify(v3.edges));
  ok(v3.edges.some((e) => e.from === notes.id && e.to === "qa"), "saved: release notes lead to QA");
  ok(v3.edges.some((e) => e.from === "qa" && e.to === "build" && e.when === "fail"), "saved: the QA fail branch");
  ok(v3.nodes.find((n) => n.id === "review").role === "builder" && v3.nodes.find((n) => n.id === "build").label === "Build and test", "saved: role and step name");
  ok(v3.nodes.find((n) => n.id === "build").checks?.some((c) => c.use === ck), "saved: Build's must-pass check");
  ok(v3.edges.some((e) => e.from === card.id && e.when === "approve" && e.to === "ship"), "saved: the approval card continues to the next step");
  const old = await (await ctx.request.get(`${base}/api/wf/ship-feature?v=2`)).json(); ok(old.def.nodes.length === v2.nodes.length, "the earlier version is kept as it was");
  await p.waitForSelector("[data-rail-wrap]"); ok(await p.locator("[data-rail-savebar]").isHidden(), "after Save the page shows the new version with no unsaved changes");

  // Discard
  await p.click(".r-step[data-step='ship'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='rm']");
  ok(!(await names(p)).includes("Open the pull request"), "Remove step takes it off the line");
  await p.click("[data-act='discard']"); ok((await names(p)).includes("Open the pull request") && await p.locator("[data-rail-savebar]").isHidden(), "Discard returns to the saved version");

  // the graph editor stays reachable, unchanged, as Advanced
  await p.click("[data-rail-advanced]"); await p.waitForSelector("[data-editor='ship-feature'] svg.rt-graph");
  ok(p.url().endsWith("#/workflows/ship-feature/advanced"), "Advanced opens the graph editor");
  await p.click("[data-editor-steps]"); await p.waitForSelector("[data-rail-wrap]"); ok(true, "the graph editor links back to the Steps view");

  // map and versions tabs
  await p.click("[data-rail-tab='map']"); await p.waitForSelector("[data-rail-map] svg"); ok(true, "Map shows the read-only graph");
  await p.click("[data-rail-tab='versions']"); await p.waitForSelector("[data-rail-version-row]"); const vrows = await p.locator("[data-rail-version-row]").count(); ok(vrows === 3, "Versions lists every saved version", String(vrows));

  // a large bundled workflow: phases collapse, the strip opens one
  await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector("[data-rail-wrap]");
  const col = await p.locator(".r-phase.col").count(); ok(col >= 5, "more than 12 steps open with the later phases collapsed", String(col));
  await p.screenshot({ path: join(shots, "coding-collapsed.png") });
  const dot = p.locator(".r-ph.col [data-jump]").first(), jump = await dot.getAttribute("data-jump"); await dot.click();
  ok(await p.locator(`.r-wrap .r-step[data-step='${jump}'].sel`).count() === 1, "a strip dot in a collapsed phase opens it and selects the step");
  await p.click("[data-act='close']");
  for (let i = 0; i < 12 && await p.locator(".r-phase.col").count(); i++) await p.locator(".r-phase.col [data-phase]").first().click();
  ok(await p.locator(".r-phase.col").count() === 0, "every phase opens");
  ok(await p.locator("[data-rail-lock]").count() >= 1, "edge checks show as a “before going on” gate tag");
  await p.screenshot({ path: join(shots, "coding-expanded.png"), fullPage: true });

  // parallel steps: a read-only fork/join
  await p.goto(`${base}/#/workflows/web-prototype`); await p.waitForSelector("[data-rail-wrap]");
  ok(await p.locator(".r-step.is-group [data-rail-member]").count() === 2 && await p.locator(".r-step.is-group [data-rail-graph]").count() === 1, "parallel steps are one fork/join row that points to the graph editor");

  // dark and phone
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }); await dctx.addInitScript(() => { localStorage.setItem("crew.theme", "dark"); localStorage.setItem("crew.lang", "en"); });
  const d = await dctx.newPage(); d.on("pageerror", (e) => errors.push(String(e))); await d.goto(`${base}/#/workflows/ship-feature`); await d.waitForSelector("[data-rail-wrap]");
  ok(await d.evaluate(() => getComputedStyle(document.body).backgroundColor !== "rgb(255, 255, 255)"), "dark theme"); await d.screenshot({ path: join(shots, "dark.png") });
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await mctx.addInitScript(() => { localStorage.setItem("crew.lang", "en"); });
  const m = await mctx.newPage(); m.on("pageerror", (e) => errors.push(String(e))); await m.goto(`${base}/#/workflows/ship-feature`); await m.waitForSelector("[data-rail-wrap]");
  ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone: no horizontal scroll");
  ok(await m.locator(".r-plus").first().isHidden(), "phone: + stays hidden until Edit steps");
  await m.click("[data-rail-edit-toggle]"); ok(await m.locator(".r-plus").first().isVisible(), "phone: Edit steps shows + on the line");
  await m.screenshot({ path: join(shots, "phone.png") });
  // zh-TW renders
  const zctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await zctx.addInitScript(() => { localStorage.setItem("crew.lang", "zh-TW"); });
  const z = await zctx.newPage(); z.on("pageerror", (e) => errors.push(String(e))); await z.goto(`${base}/#/workflows/ship-feature`); await z.waitForSelector("[data-rail-wrap]");
  ok((await z.textContent("[data-rail-story]")).includes("結束於"), "zh-TW: the sentence is translated");
  ok(errors.length === 0, "no page errors", errors.join("\n"));
} catch (e) { fail++; console.log("  FAIL  " + (e?.stack || e)); console.log(log.slice(-3000)); }
finally { await browser?.close().catch(() => {}); app.kill(); }
console.log(`workflow-rail-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
