import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The workflow page's Steps view (public/wf-rail.js) in a real browser against an isolated native Studio (temp data, stub
// providers): the seven editing tasks end to end through Save, the drawn rail (connectors, gates, ends, detours), a large
// bundled workflow opening collapsed, parallel steps as a read-only fork, the graph editor still at …/advanced, dark and phone.
import { spawn } from "node:child_process"; import { mkdtempSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { seedShipFeature } from "./lib/rail-fixture.mjs";
import { revealEditorControl } from "./lib/reveal-editor-control.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), dir = mkdtempSync(join(tmpdir(), "crew-rail-")), data = join(dir, "data"), state = join(dir, "state"), shots = join(root, "tests/out/workflow-rail");
mkdirSync(data); mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(shots, { recursive: true });
const port = await freePort(), base = `http://127.0.0.1:${port}`, env = { ...process.env }; for (const k of Object.keys(env)) if (/TOKEN|API_KEY/.test(k)) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_DATA: data, CREW_FM_STATE: state, CREW_SESSION_TOKEN: "rail-fixture", CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(dir, "home"), CREW_MAIN_PROJECT: join(dir, "project") } });
let log = ""; app.stdout.on("data", (b) => (log += b)); app.stderr.on("data", (b) => (log += b));
let browser, pass = 0, fail = 0;
const ok = (v, name, detail = "") => { if (v) { pass++; console.log("  ok    " + name); } else { fail++; console.log("  FAIL  " + name + " " + detail); } };
const names = (p) => p.$$eval(".r-wrap > .r-step", (r) => r.map((x) => x.querySelector(".r-name, .r-loopline b")?.textContent));
let page0; const tryStep = async (name, fn) => { try { await fn(); } catch (e) { ok(false, name, String(e?.message || e).split("\n")[0]); await page0?.keyboard.press("Escape").catch(() => {}); } };
const wf = async (ctx, id = "ship-feature") => (await (await ctx.request.get(`${base}/api/wf/${id}`)).json()).def;
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base, "rail-fixture");
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem("crew.lang", "en"); });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000); page0 = p; p.on("pageerror", (e) => errors.push(String(e)));
  const v2 = await seedShipFeature(ctx.request, base);
  await p.goto(`${base}/#/workflows/ship-feature`); await p.waitForSelector("[data-rail-wrap]");
  ok((await p.textContent("[data-rail-story]")).includes("ends with Done"), "one sentence on top says where the workflow ends");
  ok(JSON.stringify(await names(p)) === JSON.stringify(["Take the request", "Plan the change", "You approve the plan", "Build it", "Review the change", "QA gate", "Open the pull request"]), "the main line reads in order", JSON.stringify(await names(p)));
  ok(await p.locator("[data-rail-detours] [data-step='stuck']").count() === 1, "a step only a branch reaches is listed below the ends as a detour");
  ok(await p.locator("[data-rail-end]").count() === 2 && (await p.textContent("[data-rail-end='closed']")).includes("from step"), "the Ends block lists every end and where it comes from");
  ok((await p.textContent("[data-rail-end='closed']")).includes("closed without finishing") && !(await p.textContent("[data-rail-ends]")).includes("ends as"), "an end says what it means, not its raw result word");
  ok(await p.locator("[data-rail-strip] .r-sstart .r-sdot").count() === 1 && await p.locator("[data-rail-strip] .r-sstart svg").count() === 0, "the strip starts with a dot, not a Run triangle");
  ok(await p.locator("[data-rail-detours] .wf-chip.back").count() >= 1 && !(await p.locator(".wf-chip.end").allTextContents()).some((t) => t.includes("↩")), "a detour's way back is a pink return; an end never shows ↩");
  ok(/^[A-Z]/.test(await p.textContent("[data-rail-story] .wf-2").then((t) => t.trim())), "the how-line after the sentence is one capitalised sentence");
  await tryStep("keyboard", async () => {
  // keyboard: Enter on a step puts the focus in the drawer's title, Escape gives it back to the step
  await p.focus(".r-step[data-step='review']"); await p.keyboard.press("Enter"); await p.waitForFunction(() => document.activeElement?.matches("[data-rail-name]"));
  ok(true, "keyboard: Enter on a step focuses the drawer title");
  await p.keyboard.press("Escape"); await p.waitForFunction(() => document.activeElement?.matches(".r-step[data-step='review']"));
  ok(true, "keyboard: Escape closes the drawer and returns focus to the step");
  await p.focus("[data-after='plan']"); await p.keyboard.press("Enter"); await p.waitForFunction(() => document.activeElement?.matches(".wf-menu [data-mi='agent']"));
  ok(await p.locator('.wf-menu button[class="null"]').count() === 0, "menu items carry no class=null");
  await p.keyboard.press("ArrowDown"); ok(await p.evaluate(() => document.activeElement?.dataset.mi) === "check", "keyboard: + opens the templates with the first focused; arrows move");
  await p.keyboard.press("Escape"); ok(await p.evaluate(() => document.activeElement?.dataset.after) === "plan" && await p.locator(".wf-menu").count() === 0, "keyboard: Escape closes the menu back to +");
  });
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

  await tryStep("task 2", async () => {
  // 2. change a step's model, agent and skill
  await p.click(".r-step[data-step='review'] .r-name");
  ok(await p.waitForFunction(() => document.activeElement?.matches(".wf-drawer .wf-dh"), null, { timeout: 3000 }).then(() => true, () => false), "a click opens the drawer without focusing the name field (no phone keyboard)");
  await p.click(".wf-drawer [data-preset='strongest']");
  ok(await p.getAttribute(".wf-drawer [data-preset='strongest']", "aria-pressed") === "true" && (await p.textContent(".r-step[data-step='review'] .r-who")).includes("highest effort"), "task 2: Strongest is one click and shows on the step as the highest effort");
  ok(/highest reasoning effort/.test(await p.textContent("[data-rail-preset-note]")), "task 2: the drawer says what Strongest sets");
  await p.selectOption("[data-rail-role]", "builder");
  ok((await p.textContent(".r-step[data-step='review'] .r-who")).includes("Builder"), "task 2: the drawer's Role changes the step's agent");
  const offSkill = p.locator(".wf-drawer [data-skill][aria-checked='false']").first();
  ok(await offSkill.count() === 1, "task 2: the drawer suggests skills for the role");
  ok(!(await p.locator(".wf-drawer .wf-skill .nm").allTextContents()).some((t) => /^[a-z0-9]+(-[a-z0-9]+)+$/.test(t.trim())), "task 2: skills read by name, not slug");
  const skillId = await offSkill.getAttribute("data-skill"); await offSkill.click(); ok(await p.locator(`.wf-drawer [data-skill='${skillId}'][aria-checked='true']`).count() === 1, "task 2: a suggested skill turns on");
  ok(await p.locator(".wf-drawer .wf-db > .wf-ds").first().getAttribute("data-rail-gives-section") === "" && !(await p.textContent(".wf-drawer [data-rail-step-adv]")).includes("Description"), "the hands-on field is one field, first in the drawer");
  await p.click("[data-act='close']");

  });
  // 3. add a branch: QA fails → Build it
  await p.click(".r-step[data-step='qa'] [data-act='fixwarn']"); await p.click(".wf-pick [data-out='fail']");
  ok(!/null/.test(await p.textContent(".wf-pick")), "the branch picker shows no stray null");
  await p.click(".wf-pick [data-to='build']");
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
  ok(!!v3.nodes.find((n) => n.id === "review").effort && !v3.nodes.find((n) => n.id === "review").model, "saved: Strongest sets the effort only");
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
  const chipText = (await p.locator(".wf-chip").allTextContents()).join("\n");
  ok(!/If (is |adopt|recapture|escalate|door change|is unavailable)/.test(chipText), "outcome words read as plain language", chipText.match(/If [^\n→↩]*/g)?.slice(0, 6).join(" | "));
  ok(chipText.includes("Rescope ↩") && !chipText.includes("Needs a new scope ↩ back"), "a card's choice without a label reads as its own word");
  ok((await p.textContent(".r-step[data-step='after-merge'] .r-who")).includes("runs its checks"), "a hook with only checks says it runs them");
  ok(!(await p.locator(".r-who").allTextContents()).some((t) => /\b[a-z]+\.[a-z-]+\b/.test(t)), "automatic steps show plain action names, not ids");
  const gates = await p.$$eval(".r-link .r-gates", (gs) => gs.map((g) => { const rs = [...g.querySelectorAll(".r-gate")].map((x) => x.getBoundingClientRect()), link = g.parentElement.getBoundingClientRect();
    return { n: rs.length, overlap: rs.some((a, i) => rs.some((b, j) => i < j && a.bottom > b.top && b.bottom > a.top)), inside: rs.every((r) => r.right <= link.right - 28 && r.bottom <= link.bottom + 1) }; }));
  ok(gates.some((g) => g.n === 2) && gates.every((g) => !g.overlap && g.inside), "two gate tags on one segment stack inside it, clear of +", JSON.stringify(gates.filter((g) => g.overlap || !g.inside)));
  ok(await p.evaluate(() => { const e = document.querySelector(".r-gate .t"); return !!e && getComputedStyle(e).textOverflow === "ellipsis"; }), "long gate tags end with an ellipsis");
  ok(await p.locator("[data-rail-lock]").count() >= 1, "edge checks show as a “before going on” gate tag");
  await p.screenshot({ path: join(shots, "coding-expanded.png"), fullPage: true });

  // parallel steps: a read-only fork/join
  await p.goto(`${base}/#/workflows/web-prototype`); await p.waitForSelector("[data-rail-wrap]");
  ok(await p.locator(".r-step.is-group [data-rail-member]").count() === 2 && await p.locator(".r-step.is-group [data-rail-graph]").count() === 1, "parallel steps are one fork/join row that points to the graph editor");

  // a single end reads as one
  await p.goto(`${base}/#/workflows/hello-crew-studio`); await p.waitForSelector("[data-rail-ends]");
  ok(await p.locator("[data-rail-end]").count() === 1 && !(await p.textContent("[data-rail-ends]")).includes("one of 1"), "one end is not “one of 1”");

  // moves keep the flow whole: the first step, a step with its refine loop (a second copy of the fixture)
  await seedShipFeature(ctx.request, base, "move-demo"); let loopId = null;
  await p.goto(`${base}/#/workflows/move-demo`); await p.waitForSelector("[data-rail-wrap]");
  await tryStep("first step moves", async () => {
  // Plan is also reached by "Change the plan": it cannot become the entry, so Take the request cannot move below it
  await p.click(".r-step[data-step='intake'] [data-act='stepmenu']");
  ok(await p.locator(".wf-menu [data-mi='dn']").isDisabled(), "the first step does not move below a step a branch reaches"); await p.keyboard.press("Escape");
  // a fresh step after it is reached from nowhere else: the first step moves below it and the flow stays whole
  await p.hover("[data-link='intake']"); await p.click("[data-after='intake']"); await p.click(".wf-menu [data-mi='agent']"); await p.fill("[data-rail-name]", "Gather context"); await p.press("[data-rail-name]", "Enter"); await p.click("[data-act='close']");
  await p.click(".r-step[data-step='intake'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='dn']");
  order = await names(p); ok(order[0] === "Gather context" && order[1] === "Take the request" && order[2] === "Plan the change", "moving the first step down keeps the line in order", JSON.stringify(order));
  await p.waitForTimeout(800); ok(await p.locator("[data-rail-errors]").count() === 0 && await p.locator(".wf-warn:has-text('orphan'), .wf-warn:has-text('entry')").count() === 0, "moving the first step down leaves no orphan and one entry");
  for (let i = 0; i < 3; i++) await p.click("[data-act='undo']");
  });
  await tryStep("loop, duplicate, note, save lock", async () => {
  await p.hover("[data-link='build']"); await p.click("[data-after='build']"); await p.click(".wf-menu [data-mi='loop']"); await p.press("[data-rail-name]", "Enter"); await p.click("[data-act='close']");
  loopId = await p.$eval(".r-wrap > .r-step.is-loop", (e) => e.dataset.step);
  ok(await p.getAttribute(`.r-step[data-step='${loopId}']`, "draggable") === "false", "a refine loop row is not dragged on its own");
  await p.click(".r-step[data-step='build'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='dn']");
  order = await names(p); ok(order.indexOf("Build it") === order.indexOf("Review the change") + 1 && order[order.indexOf("Build it") + 1] === "Repeat until checks pass", "a step moves together with its refine loop", JSON.stringify(order));
  // and back up: Review now leads into Build twice, by its line and by "requests changes"; only the line moves, the branch keeps Build
  await p.click(".r-step[data-step='build'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='u']");
  order = await names(p); ok(order.indexOf("Review the change") === order.indexOf("Repeat until checks pass") + 1, "and back up, loop and all", JSON.stringify(order));
  // Duplicate a card copies its other choices too
  await p.click(".r-step[data-step='approve-plan'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='dup']"); await p.click("[data-act='close']");
  // the note survives the page redrawing; an edit while Save is on its way is held, not lost
  await p.fill("[data-rail-note]", "Moves"); await p.click(".r-step[data-step='qa'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='o']"); await p.click("[data-act='close']");
  ok(await p.inputValue("[data-rail-note]") === "Moves", "the version note keeps its text across redraws");
  let release; const held = new Promise((r) => (release = r));
  await p.route(`${base}/api/wf/move-demo`, async (route) => { if (route.request().method() !== "POST") return route.continue(); await held; await route.continue(); });
  const before2 = await p.textContent("[data-rail-changes]");
  await p.click("[data-rail-save]"); await p.click(".r-step[data-step='qa'] [data-act='stepmenu']"); await p.click(".wf-menu [data-mi='rm']");
  ok((await names(p)).includes("QA gate") && await p.textContent("[data-rail-changes]") === before2, "an edit while saving is held (nothing changes under the save)");
  release(); await p.waitForFunction(async () => (await fetch("/api/wf/move-demo").then((r) => r.json())).def.version === 3); await p.unroute(`${base}/api/wf/move-demo`);
  const mv = await wf(ctx, "move-demo"), E_ = (f, t, w) => mv.edges.some((e) => e.from === f && e.to === t && (w === undefined || (e.when || "") === w));
  ok(E_("build", loopId, "fail|timeout") && E_(loopId, "build", "retry|report") && E_(loopId, "review", "pass") && E_("build", "review", "") && E_("review", "qa", "") && E_("approve-plan-copy", "build", "approve"), "saved: the loop still repeats Build and both go on to Review", JSON.stringify(mv.edges));
  ok(E_("review", "build", "changes") && !mv.edges.some((e) => e.from === "review" && e.when === "changes" && e.to !== "build"), "saved: a branch that pointed at the next row keeps its target through moves", JSON.stringify(mv.edges.filter((e) => e.from === "review")));
  const dupCard = mv.nodes.find((n) => n.id !== "approve-plan" && n.label.startsWith("You approve the plan"));
  ok(!!dupCard && E_(dupCard.id, "plan", "change") && E_(dupCard.id, "closed", "close"), "saved: a duplicated card keeps every choice", JSON.stringify(mv.edges.filter((e) => e.from === dupCard?.id)));
  ok(mv.note === "Moves", "saved: the note typed before the redraws");
  });
  await tryStep("graph editor round trip", async () => {
  // back from the graph editor: its edit is not undone by Steps' Undo
  await p.waitForSelector("[data-rail-wrap]"); await p.click(".r-step[data-step='ship'] .r-name"); await p.fill("[data-rail-name]", "Open the PR"); await p.press("[data-rail-name]", "Enter"); await p.click("[data-act='close']");
  await p.click("[data-rail-advanced]"); await p.waitForSelector("[data-editor='move-demo'] svg.rt-graph");
  await revealEditorControl(p, '[data-view-toggle="detail"]'); await p.click('[data-view-toggle="detail"]'); await p.locator('[data-node="qa"]').focus(); await p.keyboard.press("Enter");
  await p.locator('[data-field="label"]').fill("QA check"); await p.locator('[data-field="label"]').press("Tab");
  await p.click("[data-editor-steps]"); await p.waitForSelector("[data-rail-wrap]");
  ok((await names(p)).includes("QA check") && (await names(p)).includes("Open the PR") && await p.locator("[data-act='undo']").isDisabled() && await p.locator("[data-rail-savebar]").isVisible(), "after the graph editor, both edits stay unsaved and Undo cannot step over them");
  await p.click("[data-act='discard']");

  });
  // dark and phone
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }); await dctx.addInitScript(() => { localStorage.setItem("crew.theme", "dark"); localStorage.setItem("crew.lang", "en"); });
  const d = await dctx.newPage(); d.on("pageerror", (e) => errors.push(String(e))); await d.goto(`${base}/#/workflows/ship-feature`); await d.waitForSelector("[data-rail-wrap]");
  ok(await d.evaluate(() => getComputedStyle(document.body).backgroundColor !== "rgb(255, 255, 255)"), "dark theme"); await d.screenshot({ path: join(shots, "dark.png") });
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await mctx.addInitScript(() => { localStorage.setItem("crew.lang", "en"); });
  const m = await mctx.newPage(); m.on("pageerror", (e) => errors.push(String(e))); await m.goto(`${base}/#/workflows/ship-feature`); await m.waitForSelector("[data-rail-wrap]");
  ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone: no horizontal scroll");
  ok(await m.locator(".r-plus").first().isHidden(), "phone: + stays hidden until Edit steps");
  await m.click("[data-rail-edit-toggle]"); ok(await m.locator(".r-plus").first().isVisible(), "phone: Edit steps shows + on the line");
  ok(await m.$$eval(".r-link.gated", (ls) => ls.length > 0 && ls.every((l) => { const pl = l.querySelector(".r-plus").getBoundingClientRect(); return [...l.querySelectorAll(".r-gate")].every((g) => g.getBoundingClientRect().right <= pl.left + 1); })), "phone: + never covers a gate tag");
  await m.screenshot({ path: join(shots, "phone.png") });
  // zh-TW renders
  const zctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await zctx.addInitScript(() => { localStorage.setItem("crew.lang", "zh-TW"); });
  const z = await zctx.newPage(); z.on("pageerror", (e) => errors.push(String(e))); await z.goto(`${base}/#/workflows/ship-feature`); await z.waitForSelector("[data-rail-wrap]");
  ok((await z.textContent("[data-rail-story]")).includes("結束於") && /。/.test(await z.textContent("[data-rail-story]")) && !/\.\s/.test(await z.textContent("[data-rail-story]")), "zh-TW: the sentence is translated, with a full-width period");
  ok(!/closed|result/.test(await z.textContent("[data-rail-ends]")), "zh-TW: ends carry no English result word");
  await z.goto(`${base}/#/workflows/code-firstmate`); await z.waitForSelector("[data-rail-story]");
  ok(!/[A-Za-z]。/.test(await z.textContent("[data-rail-story] .wf-2")), "zh-TW: an English description keeps its own period");
  for (let i = 0; i < 12 && await z.locator(".r-phase.col").count(); i++) await z.locator(".r-phase.col [data-phase]").first().click();
  ok((await z.locator(".r-loopline").allTextContents()).some((t) => /如果 \S.* 的檢查沒過，就修正再試/.test(t)), "zh-TW: the loop line spaces Latin words and reads naturally");

  ok(errors.length === 0, "no page errors", errors.join("\n"));
} catch (e) { fail++; console.log("  FAIL  " + (e?.stack || e)); console.log(log.slice(-3000)); }
finally { await browser?.close().catch(() => {}); app.kill(); }
console.log(`workflow-rail-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
