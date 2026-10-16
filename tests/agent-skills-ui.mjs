import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Agent skills in the page (docs/units/agent-skills.md): Library → Skills (the built-in
// skill, imports from a folder and a skills home, a refusal the captain sees), the
// workflow editor's node panel (turn two skills on, order them, save: the diff names
// both in order; a newer version shown and taken; a skill's ignored tool request), and
// the run page's step showing name@v1. 1440 and 390, light and dark, no sideways scroll.
//                                                             node tests/agent-skills-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("agent-skills-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-skillsui-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data"), home = join(tmp, "home");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
const md = (name, desc, body, extra = "") => `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n\n${body}\n`;
const mk = (dir, files) => { for (const [f, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t); } return dir; };
mk(join(home, ".claude", "skills", "home-skill"), { "SKILL.md": md("home-skill", "Rules kept in the claude skills home", "HOME BODY") });
const alpha = mk(join(tmp, "src", "alpha"), { "SKILL.md": md("alpha", "Alpha: short sentences, one idea each", "ALPHA ONE") });
const beta = mk(join(tmp, "src", "beta"), { "SKILL.md": md("beta", "Beta: name the reader before you write", "BETA") });
const greedy = mk(join(tmp, "src", "greedy"), { "SKILL.md": md("greedy", "Asks for tools it never gets", "GREEDY", "allowed-tools: Bash, WebFetch\nnetwork: true\n") });
const empty = mk(join(tmp, "src", "not-a-skill"), { "README.md": "no skill here" });
const delta = mk(join(tmp, "src", "delta"), { "SKILL.md": md("delta", "Delta: say what changed first", "DELTA ONE") });
const bigA = mk(join(tmp, "src", "big-a"), { "SKILL.md": md("big-a", "A long skill", "a".repeat(60 * 1024)) });
const bigB = mk(join(tmp, "src", "big-b"), { "SKILL.md": md("big-b", "Another long skill", "b".repeat(60 * 1024)) });
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out"); mkdirSync(shots, { recursive: true });
// a step that cannot happen (the base has no Skills page) is logged and the suite goes on, so every assertion reports on its own
const SAFE = new Set(["click", "fill", "selectOption", "waitForSelector", "textContent", "getAttribute", "$eval", "focus"]);
const safe = (pg) => { pg.setDefaultTimeout(8000); return new Proxy(pg, { get(t, k) { const v = t[k]; if (typeof v !== "function") return v; if (!SAFE.has(k)) return v.bind(t);
  return (...a) => v.apply(t, a).catch((e) => { if (k !== "waitForSelector") console.log(`  (${String(k)}: ${String(e?.message ?? e).split("\n")[0].slice(0, 120)})`); if (k === "waitForSelector") throw e; return k === "textContent" || k === "getAttribute" ? "" : null; }); } }); };
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const wait = (p, sel, ms = 8000) => p.waitForSelector(sel, { timeout: ms }).then(() => true, () => false);
const importFolder = async (p, path) => { await p.click('[data-import-kind="folder"]'); await p.fill("[data-import-path]", path); await p.click("[data-import-go]"); };
const selectNode = async (p, id) => { await p.focus(`[data-node="${id}"]`); await p.keyboard.press("Enter"); await p.waitForSelector(`.rt-panel [data-node-skills="${id}"]`, { timeout: 8000 }).catch(() => {}); };
const order = (p) => p.$$eval("[data-node-skill]", (els) => els.map((e) => e.dataset.nodeSkill)).catch(() => []);
let runId = null;
try {
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, colorScheme: "light" }); const p = safe(await ctx.newPage());
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/library`); await p.evaluate(() => document.body.classList.add("chat-closed"));
    ok(await wait(p, '[data-lib-tab="skills"]'), "Library has a Skills tab");
    await p.click('[data-lib-tab="skills"]');
    ok(await wait(p, '[data-skill="plain-writing"]') && /built in/i.test(await p.textContent('[data-skill="plain-writing"] [data-skill-source]')) && (await p.textContent('[data-skill="plain-writing"] [data-skill-version]')).trim() === "v1",
      "Library → Skills lists the built-in plain-writing skill (core pack, v1)");
    ok(await wait(p, '[data-role-skill="code-firstmate/coordinator"]'), "the role skills already there are listed too");
    // done 1: a folder, then a skills home
    await importFolder(p, alpha);
    const alphaRow = await wait(p, '[data-skill="alpha"]');
    const row = alphaRow ? await p.textContent('[data-skill="alpha"]') : "";
    ok(alphaRow && row.includes("Alpha: short sentences, one idea each") && row.includes(alpha) && (await p.textContent('[data-skill="alpha"] [data-skill-version]')).trim() === "v1"
      && (await p.getAttribute('[data-skill="alpha"] [data-skill-sha]', "title")) === sha(join(alpha, "SKILL.md")), "import from a folder in the page: name, description, source, v1 and sha256 shown", row + " msg=" + await p.textContent("[data-import-msg]").catch(() => "-"));
    await p.click('[data-import-kind="home"]');
    ok(await wait(p, '[data-home-import="claude/home-skill"]'), "the skills home lists its skills to pick from");
    await p.click('[data-home-import="claude/home-skill"]');
    ok(await wait(p, '[data-skill="home-skill"]') && (await p.textContent('[data-skill="home-skill"]')).includes("~/.claude/skills/home-skill"), "import from a skills home in the page: picked and listed");
    // done 2, as the captain sees it
    await importFolder(p, empty); await p.waitForFunction(() => /SKILL\.md/.test(document.querySelector("[data-import-msg]")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
    ok(/no SKILL\.md/.test(await p.textContent("[data-import-msg]")) && (await p.getAttribute("[data-import-msg]", "data-state")) === "error", "a refused import shows the reason in the page", await p.textContent("[data-import-msg]"));
    await importFolder(p, beta); await wait(p, '[data-skill="beta"]');
    await importFolder(p, greedy); await wait(p, '[data-skill="greedy"]');
    ok(/allowed-tools/.test(await p.textContent('[data-skill="greedy"] [data-skill-ignored]')), "the Skills page says which frontmatter keys were ignored");
    // done 3: two skills on one node, ordered, saved as a new version whose diff names both in order
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector('[data-editor="code-firstmate"] [data-node="spec"]').catch(() => {});
    await p.click('[data-view-toggle="detail"]'); await p.waitForSelector('svg.rt-graph[data-view="detail"] [data-node="build"]').catch(() => {});
    await selectNode(p, "build");
    const v0 = (await (await fetch(`${base}/api/wf/code-firstmate`)).json()).def.version;
    await p.selectOption("[data-skill-pick]", "alpha"); await p.click("[data-skill-on]");
    await p.selectOption("[data-skill-pick]", "beta"); await p.click("[data-skill-on]");
    const o1 = await order(p);
    await p.click('[data-skill-up="beta"]'); const o2 = await order(p);
    await p.fill("[data-save-note]", "skills on build"); await p.click("[data-save]");
    const saved = await wait(p, '[data-diff-k="skills"]');
    const diffText = saved ? await p.textContent('[data-diff-k="skills"]') : "";
    const after = (await (await fetch(`${base}/api/wf/code-firstmate`)).json()).def;
    ok(JSON.stringify(o1) === '["alpha","beta"]' && JSON.stringify(o2) === '["beta","alpha"]' && saved && diffText.includes("build: beta@v1, alpha@v1") && after.version === v0 + 1
      && JSON.stringify((after.nodes.find((n) => n.id === "build").skills ?? []).map((s) => `${s.id}@v${s.v}`)) === '["beta@v1","alpha@v1"]',
      "two skills on one node make a new version whose diff names both, in order (editor)", JSON.stringify({ o1, o2, diffText, v0, v: after.version }));
    ok(await noHScroll(p), "the editor has no sideways scroll at 1440");
    // done 5 in the editor: v2 exists, moving to it is a new version
    writeFileSync(join(alpha, "SKILL.md"), md("alpha", "Alpha: short sentences, one idea each", "ALPHA TWO"));
    await p.goto(`${base}/#/library/skills`); await importFolder(p, alpha);
    await p.waitForFunction(() => document.querySelector('[data-skill="alpha"] [data-skill-version]')?.textContent.trim() === "v2", null, { timeout: 8000 }).catch(() => {});
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector('[data-editor="code-firstmate"] [data-node="build"]').catch(() => {});
    await p.click('[data-view-toggle="detail"]'); await selectNode(p, "build");
    ok(await wait(p, '[data-skill-newer="alpha"]') && /v2/.test(await p.textContent('[data-skill-newer="alpha"]')) && (await p.textContent('[data-node-skill="alpha"]')).includes("alpha@v1"), "re-import makes v2; the editor shows that v2 exists while the node keeps v1");
    await p.click('[data-skill-upgrade="alpha"]'); await p.click("[data-save]");
    const up = await wait(p, '[data-diff-k="skills"]'); const upText = up ? await p.textContent('[data-diff-k="skills"]') : "";
    const after2 = (await (await fetch(`${base}/api/wf/code-firstmate`)).json()).def;
    ok(up && upText.includes("build: beta@v1, alpha@v2") && after2.version === after.version + 1, "moving to v2 in the editor is a new workflow version", upText);
    // done 6 in the panel
    await selectNode(p, "build");
    await p.selectOption("[data-skill-pick]", "greedy"); await p.click("[data-skill-on]");
    const ign = await wait(p, '[data-skill-ignored="greedy"]') ? await p.textContent('[data-skill-ignored="greedy"]') : "";
    ok(/allowed-tools/.test(ign) && /network/.test(ign) && /ignored/i.test(ign) && /tools/.test(ign) && /sandbox/.test(ign), "a skill cannot grant tools: the node panel says its request was ignored", ign);
    await p.click('[data-skill-off="greedy"]');
    ok(JSON.stringify(await order(p)) === '["beta","alpha"]', "turning a skill off removes it from the node's list");
    // r3: the wording (no "frontmatter"; the size and the ignored request in plain words)
    await p.selectOption("[data-skill-pick]", "greedy"); await p.click("[data-skill-on]");
    const ign2 = await p.textContent('[data-skill-ignored="greedy"]'); const size2 = await p.textContent("[data-skill-size]");
    ok(ign2.includes("This skill asked for allowed-tools and network. Studio ignored the request: a skill is text only and never changes tools, sandbox, network or credentials.") && /^Skill text on this node: \d+ B of 96 KB$/.test(size2.trim())
      && !/frontmatter/i.test(await p.textContent("main")), "the panel's words: the ignored request and the skill text size, no 'frontmatter'", JSON.stringify([ign2, size2]));
    await p.click('[data-skill-off="greedy"]');
    // a node pinned to delta v1 while v2 exists (the "v2 available" state the captures show)
    await p.goto(`${base}/#/library/skills`); await importFolder(p, delta); await wait(p, '[data-skill="delta"]');
    await importFolder(p, bigA); await wait(p, '[data-skill="big-a"]'); await importFolder(p, bigB); await wait(p, '[data-skill="big-b"]');
    ok(/^9 bytes$/.test((await p.textContent('[data-skill="delta"] [data-skill-size]')).trim()) && !/frontmatter/i.test(await p.textContent("main")) && (await p.textContent('[data-role-skill="code/worker"]').catch(() => "")).includes("not versioned"),
      "the Skills page's words: the size in bytes, 'not versioned' for a role with no version, no 'frontmatter'", await p.textContent('[data-skill="delta"] [data-skill-size]'));
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector('[data-editor="code-firstmate"] [data-node="build"]').catch(() => {});
    await p.click('[data-view-toggle="detail"]'); await selectNode(p, "build");
    await p.selectOption("[data-skill-pick]", "delta"); await p.click("[data-skill-on]"); await p.click("[data-save]"); await wait(p, '[data-diff-k="skills"]');
    writeFileSync(join(delta, "SKILL.md"), md("delta", "Delta: say what changed first", "DELTA TWO"));
    await p.goto(`${base}/#/library/skills`); await importFolder(p, delta);
    await p.waitForFunction(() => document.querySelector('[data-skill="delta"] [data-skill-version]')?.textContent.trim() === "v2", null, { timeout: 8000 }).catch(() => {});
    // done 4 on the run page: the step shows name@v1
    const r = await p.evaluate(async () => (await fetch("/api/wruns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflow: "code-firstmate", text: "Add a percent function to money-kit" }) })).json());
    runId = r.id;
    await p.goto(`${base}/#/run/${runId}`);
    const stepOk = await wait(p, '[data-step-skills="spec"]', 30000);
    ok(stepOk && (await p.textContent('[data-step-skills="spec"]')).includes("plain-writing@v1"), "the step shows name@v1 on the run page", stepOk ? await p.textContent('[data-step-skills="spec"]') : "no step");
    await p.evaluate(async (id) => fetch(`/api/wruns/${id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), runId);
    await ctx.close(); }
  // done 8 (r3): every state the test reaches, at 1440 and 390, light and dark: agent-skills-<state>-<w>-<scheme>.png
  // a full page: at 1440 the page scrolls inside #main, so the viewport grows to the content for the capture, then goes back
  const pngHeight = (f) => { try { return readFileSync(f).readUInt32BE(20); } catch { return 0; } };
  const shot = async (p, state, width, scheme) => { await p.evaluate(() => { document.scrollingElement.scrollTop = 0; const m = document.querySelector("#main"); if (m) m.scrollTop = 0; }).catch(() => {});
    const full = await p.evaluate(() => { const m = document.querySelector("#main"); return m ? m.scrollHeight - m.clientHeight : 0; }).catch(() => 0);
    if (full > 0) await p.setViewportSize({ width, height: 900 + full });
    const f = join(shots, `agent-skills-${state}-${width}-${scheme}.png`); await p.screenshot({ path: f, fullPage: true });
    if (full > 0) await p.setViewportSize({ width, height: 900 }); return pngHeight(f); };
  const covered = {};
  const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // the panel whole: unclipped, in a viewport tall enough for it (then the viewport goes back)
  const shotPanel = async (p, state, width, scheme) => {
    const hgt = await p.evaluate(() => { const el = document.querySelector(".rt-panel"); if (!el) return 0; el.style.maxHeight = "none"; el.style.overflow = "visible"; return Math.ceil(el.getBoundingClientRect().height); }).catch(() => 0);
    await p.setViewportSize({ width, height: Math.max(900, hgt + 600) });
    // the capture's own view: the page scrolled to its end, where the floating button sits over the end of the panel if nothing is reserved
    await p.evaluate(() => { const pn = document.querySelector(".rt-panel"); if (pn) pn.scrollIntoView({ block: "end" }); }); await p.waitForTimeout(100); // the panel's end at the bottom of the view
    const fab = await p.locator(".fab").boundingBox().catch(() => null); const prob = await p.locator(".rt-panel .rt-problems").boundingBox().catch(() => null);
    covered[state] = { fab, prob, hit: overlap(fab, prob) };
    await p.locator(".rt-panel").screenshot({ path: join(shots, `agent-skills-${state}-${width}-${scheme}.png`) }).catch((e) => console.log(`  (panel shot: ${String(e.message).split("\n")[0]})`));
    await p.setViewportSize({ width, height: 900 }); };
  const boxes = (p) => p.$$eval('[data-node-skills="build"] .rt-skill-btn, [data-node-skills="build"] [data-skill-on]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { k: Object.keys(e.dataset)[0] || e.textContent, w: Math.round(r.width), h: Math.round(r.height) }; })).catch(() => []);
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme }); const p = safe(await ctx.newPage()); p.on("pageerror", (e) => errors.push(e.message));
    const tag = `${width} ${scheme}`;
    await p.goto(`${base}/#/library/skills`); await p.evaluate(() => document.body.classList.add("chat-closed"));
    const shown = await wait(p, '[data-skill="alpha"]');
    const hSkills = await shot(p, "skills", width, scheme);
    ok(hSkills > 1500, `the Skills page capture at ${tag} is the full page (${hSkills} px tall)`);
    ok(shown && await noHScroll(p), `the Skills page at ${tag}: no sideways scroll`);
    // the last card clears the floating firstmate button
    const clear = await p.evaluate(() => { const m = document.querySelector("#main"); m.scrollTop = m.scrollHeight; document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight; const fab = document.querySelector(".fab"); const last = [...document.querySelectorAll("#view .card")].at(-1);
      if (!fab || !last || getComputedStyle(fab).display === "none") return { ok: true }; const a = fab.getBoundingClientRect(), b = last.getBoundingClientRect(); return { ok: b.bottom <= a.top || a.right <= b.left || b.right <= a.left, fab: [a.top, a.bottom], last: [b.top, b.bottom], main: [m.scrollTop, m.scrollHeight, m.clientHeight, getComputedStyle(m).paddingBottom, getComputedStyle(m).overflowY], doc: [document.scrollingElement.scrollTop, document.scrollingElement.scrollHeight, innerHeight] }; });
    ok(clear.ok, `the floating firstmate button does not cover the end of the Skills page at ${tag}`, JSON.stringify(clear));
    await p.evaluate(() => { document.querySelector("#main").scrollTop = 0; });
    await importFolder(p, empty); await p.waitForFunction(() => document.querySelector("[data-import-msg]")?.dataset.state === "error", null, { timeout: 8000 }).catch(() => {});
    const nextTo = await p.evaluate(() => { const f = document.querySelector("[data-import-path]"), m = document.querySelector("[data-import-msg]"); if (!f || !m) return false; const a = f.getBoundingClientRect(), b = m.getBoundingClientRect(); return b.top >= a.bottom && b.top - a.bottom < 24; });
    await shot(p, "refused", width, scheme);
    ok(nextTo && /no SKILL\.md/.test(await p.textContent("[data-import-msg]")), `a refused import shows its reason right under the field at ${tag}`);
    await p.click('[data-import-kind="home"]'); const homeOk = await wait(p, '[data-home-import="claude/home-skill"]'); await shot(p, "home", width, scheme);
    const homeH = await p.textContent('[data-home="claude"] .sk-home-h');
    ok(homeOk && await noHScroll(p) && /1 skill$/.test(homeH.trim()) && !/1 skills/.test(homeH), `the Skills home tab and its list at ${tag} ("1 skill")`, homeH);
    if (width === 390) { const t = await p.$$eval('.sk-import .seg button, [data-home-import]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })).catch(() => []);
      ok(t.length >= 4 && t.every(([w, hh]) => w >= 44 && hh >= 44), `at 390 the import tabs and each home skill's Import are at least 44×44`, JSON.stringify(t)); }
    await p.click('[data-import-kind="git"]'); await p.fill("[data-import-url]", "http://example.com/org/skills.git"); await p.click("[data-import-go]");
    await p.waitForFunction(() => document.querySelector("[data-import-msg]")?.dataset.state === "error", null, { timeout: 8000 }).catch(() => {});
    await shot(p, "git", width, scheme);
    ok(/only https:\/\//.test(await p.textContent("[data-import-msg]")) && await noHScroll(p), `the Git URL tab refuses an http:// URL with its reason at ${tag}`);
    // the node panel
    await p.goto(`${base}/#/workflows/code-firstmate`); await p.waitForSelector('[data-editor="code-firstmate"] [data-view-toggle="detail"]').catch(() => {});
    await p.click('[data-view-toggle="detail"]'); await p.waitForSelector('svg.rt-graph[data-view="detail"]').catch(() => {});
    if (!(await p.locator('[data-node="build"]').count())) { await p.locator('[data-stage-node="build"]').dispatchEvent("click").catch(() => {}); await p.waitForSelector('[data-node="build"]').catch(() => {}); } // a phone starts with the stages collapsed
    await selectNode(p, "build");
    const newer = await wait(p, '[data-skill-newer="delta"]') && await wait(p, '[data-skill-upgrade="delta"]');
    await shotPanel(p, "newer", width, scheme);
    ok(newer, `the "v2 available" notice and its control at ${tag}`);
    const nums = await p.$$eval('[data-node-skills="build"] .rt-skill-n', (els) => els.map((e) => e.textContent)).catch(() => []);
    const bw = await p.$eval('[data-node-skills="build"]', (el) => el.getBoundingClientRect().width).catch(() => 9999);
    ok(JSON.stringify(nums) === '["1.","2.","3."]' && (width < 700 || bw <= 641), `the skills are numbered 1, 2, 3 and the block is at most 640 px wide at ${tag}`, JSON.stringify({ nums, bw }));
    const firstUp = await p.$('[data-node-skills="build"] [data-skill-up]').catch(() => null);
    const dis = firstUp ? await firstUp.evaluate((e) => ({ d: e.disabled, a: e.getAttribute("aria-disabled"), cls: e.className })) : {};
    ok(dis.d === true && dis.a === "true" && /\bbtn\b/.test(dis.cls) && !/\bghost\b/.test(dis.cls), `the first row's up arrow is a disabled bordered button with aria-disabled at ${tag}`, JSON.stringify(dis));
    if (width === 390) { const b = await boxes(p);
      ok(b.length >= 10 && b.every((x) => x.w >= 44 && x.h >= 44), `at 390 every skills control (arrows, turn off, use v2, turn on) is at least 44×44`, JSON.stringify(b)); }
    await p.selectOption("[data-skill-pick]", "greedy"); await p.click("[data-skill-on]"); // shows the ignored note too (not saved)
    await shotPanel(p, "panel", width, scheme);
    const fits = await p.$eval('.rt-panel [data-node-skills="build"]', (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }).catch(() => false);
    ok(fits && await noHScroll(p), `the node panel's skills at ${tag}: inside the page, no sideways scroll`);
    // a save over the per-node cap: refused with the total and the cap, shown in the panel
    const vBefore = (await (await fetch(`${base}/api/wf/code-firstmate`)).json()).def.version;
    await p.selectOption("[data-skill-pick]", "big-a"); await p.click("[data-skill-on]"); await p.selectOption("[data-skill-pick]", "big-b"); await p.click("[data-skill-on]");
    await p.click("[data-save]"); await p.waitForFunction(() => /the cap is 96 KB/.test(document.querySelector(".rt-panel")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
    // scrolled to the end (the page and the panel), the floating firstmate button covers no part of the refusal
    await p.evaluate(() => { const pn = document.querySelector(".rt-panel"); if (pn) { pn.scrollTop = 1e9; pn.scrollIntoView({ block: "end" }); } }); // the panel scrolled to its end, its end at the bottom of the view
    await p.waitForTimeout(150);
    const fabBox = await p.locator(".fab").boundingBox().catch(() => null); const probBox = await p.locator(".rt-panel .rt-problems").boundingBox().catch(() => null);
    ok(!!probBox && !overlap(fabBox, probBox), `the floating firstmate button does not cover the cap refusal (the panel at its end) at ${tag}`, JSON.stringify({ fabBox, probBox }));
    const sizeLine = (await p.textContent("[data-skill-size]")).trim(); const probText = await p.textContent(".rt-panel .rt-problems");
    const total = /total (\d+(?:\.\d)? (?:KB|B))/.exec(probText)?.[1];
    ok(!!total && sizeLine === `Skill text on this node: ${total} of 96 KB`, `the size line and the refusal give the same size (${total}) at ${tag}`, JSON.stringify([sizeLine, probText]));
    await shotPanel(p, "cap", width, scheme);
    ok(!!covered.cap?.prob && !covered.cap.hit, `in the cap capture (the panel whole, the page at its end) the floating button covers no part of the refusal at ${tag}`, JSON.stringify(covered.cap));
    const vAfter = (await (await fetch(`${base}/api/wf/code-firstmate`)).json()).def.version;
    ok(/build: the enabled skills total \d+ KB; the cap is 96 KB/.test(await p.textContent(".rt-panel")) && vAfter === vBefore && /over/.test(await p.getAttribute("[data-skill-size]", "class")), `a save over the per-node cap is refused in the panel with the total and the cap at ${tag}`);
    // the run step's name@v1
    await p.goto(`${base}/#/run/${runId}`); const st = await wait(p, '[data-step-skills="spec"]', 30000);
    await p.evaluate(() => { document.scrollingElement.scrollTop = 0; document.querySelector("#main").scrollTop = 0; }); // a full-page capture from the top (the phone's header stays where it belongs)
    await shot(p, "step", width, scheme);
    ok(st && (await p.textContent('[data-step-skills="spec"]')).includes("plain-writing@v1") && await noHScroll(p), `the run step shows plain-writing@v1 at ${tag}`);
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { ok(false, "agent-skills-ui", `${e?.stack ?? e}\n${appLog.slice(-1500)}`); }
finally { await browser.close().catch(() => {}); app.kill(); }
console.log(`\nagent-skills-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
