import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The read-only skill viewer in a real isolated Studio and Chromium (public/skills.js, public/team.js):
//   - every skill chip on the Crew page (#/team) is a button named 查看技能：<name> / View skill: <name>; Enter opens the
//     viewer at the version the seat pins (an older pin says so and offers the latest), Esc closes it, the focus returns
//     to the chip, and the page keeps its selected workflow and its open member editor
//   - the seat editor's chip, a role skill chip and a Library row open it too; #/skills/<id>@<v> opens it over the Library
//   - SKILL.md as the stored bytes (原文) and rendered as text nodes: a skill holding <script> and <img onerror> shows them
//     as text and runs nothing; a javascript: link is plain text; a Studio link is a link
//   - the version switcher, a supporting file opened inline, a binary one not openable, Tab kept inside the dialog
//   - the API sits behind the same gate as /api/skills
// 1440 with the Firstmate panel open and 390, English and 繁體中文; no sideways scroll; no browser errors.
//      bun tests/skill-viewer-ui.mjs        (screenshots: SKILL_VIEWER_SHOTS=<dir>)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { CrewStore } = await import("../src/domain/crew.ts");
const { Skills } = await import("../src/skills.ts");
const root = join(import.meta.dir, ".."), dir = mkdtempSync(join(tmpdir(), "skill-viewer-ui-")), data = join(dir, "data"), home = join(dir, "home"), token = "skill-viewer-fixture";
mkdirSync(home); mkdirSync(data);
const shots = process.env.SKILL_VIEWER_SHOTS || join(root, "tests/out/skill-viewer"); mkdirSync(shots, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
// the skill: v1 (pinned by the maker) and v2 (the latest); its text tries to run script, its files are text and binary
const mk = (d, files) => { for (const [f, t] of Object.entries(files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), t); } return d; };
const V1 = `---\nname: alpha\ndescription: Alpha rules for short sentences\n---\n\n# Alpha rules\n\nWrite **short** sentences. See [the library](#/library).\n\n- one idea each\n- name the reader\n\n<script>window.__xss=1</script>\n<img src=x onerror="window.__xss=2">\n[evil](javascript:window.__xss=3)\n\n\`\`\`\nconst x = "<b>not bold</b>";\n\`\`\`\n`;
const V2 = V1.replace("# Alpha rules", "# Alpha rules, second edition");
const NOTES = "# Notes\n\n<script>window.__xss=4</script> supporting text\n";
const src = mk(join(dir, "alpha"), { "SKILL.md": V1, "ref/notes.md": NOTES, "img/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) });
const lib = new Skills(data, { list: () => [], get: () => null, sourceSkill: () => null });
const v1 = lib.importFolder(src, "test"); writeFileSync(join(src, "SKILL.md"), V2); lib.importFolder(src, "test");
const stored = (v) => readFileSync(join(data, "skills", "_library", "alpha", `v${v}`, "SKILL.md"), "utf8");
const pw = lib.library().find((s) => s.id === "plain-writing");
const m = (provider, model, effort, skills = []) => ({ provider, model, effort, skills });
const seed = () => { rmSync(join(data, "crew"), { recursive: true, force: true }); new CrewStore(data).write({ schema: 1, members: { coordinator: m("claude", "opus-5.5", "high"),
  maker: m("codex", "gpt-6.1-sol", "medium", [{ id: "alpha", v: 1, sha256: v1.version.sha256 }, { id: "plain-writing", v: pw.current, sha256: pw.sha256 }]),
  "alt-maker": m("claude", "sonnet-5.5", "medium"), reviewer: m("claude", "opus-5.5", "high"), "design-reviewer": m("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" }); };
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOME: home, CREW_DATA: data, CREW_PORT: String(port), CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_RETRO_AUTO: "0",
  CREW_HOST_CODEX_BIN: "/nonexistent/codex", CREW_HOST_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_SANDBOX: "0",
  USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user" };
for (const k of ["CREW_MAIN_PROJECT", "CREW_FM_STATE", "CODEX_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
seed();
const app = spawn("bun", ["src/server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }); let browser;
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const dialog = (p) => p.locator('[role="dialog"][data-skill-viewer]');
const shownVersion = (p) => p.evaluate(() => document.querySelector("[data-skill-viewer]")?.getAttribute("data-skv-shown") || "");
const waitShown = (p, v) => p.waitForFunction((v) => document.querySelector("[data-skill-viewer]")?.getAttribute("data-skv-shown") === v, v, { timeout: 10000 }).then(() => true, () => false);
const focusIn = (p) => p.evaluate(() => !!document.activeElement?.closest("[data-skill-viewer]"));
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base, token);
  // the viewer routes answer exactly as /api/skills does (the server's one gate for every route)
  { const bare = await fetch(`${base}/api/skills/alpha`), list = await fetch(`${base}/api/skills`), file = await fetch(`${base}/api/skills/alpha/files/ref/notes.md`);
    ok(bare.status === list.status && file.status === list.status, "the viewer's routes sit behind the same gate as /api/skills (the same answer to the same caller)", `${bare.status} ${list.status} ${file.status}`); }
  for (const [lang, width, height] of [["en", 1440, 940], ["zh-TW", 1440, 940], ["zh-TW", 390, 844], ["en", 390, 844]]) {
    seed();
    const tag = `${lang} ${width}`, zh = lang === "zh-TW", name = (n) => (zh ? `查看技能：${n}` : `View skill: ${n}`);
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript((l) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, lang);
    const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${base}/#/team`); await p.evaluate((l) => setLang(l), lang);
    await p.locator("[data-team-page]").waitFor({ timeout: 30000 });
    if (width === 1440) ok(await p.evaluate(() => !document.body.classList.contains("chat-closed")), `the Firstmate panel is open beside the page ${tag}`);
    await p.locator('[data-team-card="web-prototype"]').click();
    const rowA = p.locator('[data-team-row="design-a"]'); await rowA.waitFor();
    // the member editor open, so its chips are on the page and its state can be checked after the viewer
    await p.locator("[data-open-members]").click(); await p.locator("[data-member-editor]").waitFor();
    const pageState = () => p.evaluate(() => ({ card: document.querySelector('[data-team-card][aria-pressed="true"]')?.dataset.teamCard, editor: !!document.querySelector("[data-member-editor]"), hash: location.hash }));
    const before = await pageState();
    await rowA.scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `team-chips-${lang}-${width}.png`) });
    // ---------- a seat's chip: Enter opens, at the pinned (older) version ----------
    const chip = rowA.locator('[data-skill-view="alpha"]');
    ok(await chip.count() === 1 && await chip.evaluate((e) => e.tagName) === "BUTTON" && await chip.getAttribute("aria-label") === name("alpha"), `the member's skill chip on a node is a button named “${name("alpha")}” ${tag}`, await chip.getAttribute("aria-label").catch(() => ""));
    const names = await p.$$eval("[data-team-page] [data-skill-view]", (bs) => bs.map((b) => [b.tagName, b.getAttribute("aria-label")]));
    ok(names.length >= 4 && names.every(([t, l]) => t === "BUTTON" && l.startsWith(zh ? "查看技能：" : "View skill: ")), `every skill chip on the page (role, duty, member, node, seat editor) is a named button ${tag}`, JSON.stringify(names.slice(0, 6)));
    await chip.focus(); await p.keyboard.press("Enter");
    await dialog(p).waitFor(); ok(await waitShown(p, "1"), `Enter opens the viewer at v1, the version this seat pins ${tag}`, await shownVersion(p));
    ok(await dialog(p).getAttribute("aria-modal") === "true" && (await p.locator("#skvTitle").innerText()).trim() === "alpha" && await focusIn(p), `the viewer is a modal dialog named by the skill, with the focus inside ${tag}`);
    const meta = await dialog(p).innerText();
    ok(meta.includes(zh ? "這個位置用的是 v1（舊版）。最新是 v2。" : "This seat uses v1, an older version. The latest is v2.") && await dialog(p).locator("[data-skv-used-here]").count() === 1, `an older pin says so: this seat uses v1, the latest is v2 ${tag}`, meta.slice(0, 400));
    ok(meta.includes(zh ? "匯入 · 資料夾" : "Imported · Folder") && meta.includes(zh ? "適用" : "Fits") && (meta.includes("seat maker") || meta.includes("位置 maker")), `source (imported, folder), what it fits and the seat using it ${tag}`);
    // rendered: text nodes only; nothing ran
    const r = await p.evaluate(() => { const d = document.querySelector("[data-skv-rendered]"); return { scripts: d.querySelectorAll("script, img, iframe, object").length, links: [...d.querySelectorAll("a")].map((a) => a.getAttribute("href")), text: d.textContent, xss: window.__xss ?? null, heading: d.querySelector('[role="heading"]')?.textContent, bold: d.querySelector("b")?.textContent, pre: d.querySelector("pre")?.textContent }; });
    ok(r.scripts === 0 && r.xss === null && r.text.includes("<script>window.__xss=1</script>") && r.text.includes('<img src=x onerror="window.__xss=2">'), `a skill holding <script> and <img onerror> shows them as text and runs nothing ${tag}`, JSON.stringify({ s: r.scripts, x: r.xss }));
    ok(JSON.stringify(r.links) === JSON.stringify(["#/library"]) && r.text.includes("evil"), `links are whitelisted: the Studio link is a link, the javascript: one plain text ${tag}`, JSON.stringify(r.links));
    ok(r.heading === "Alpha rules" && r.bold === "short" && r.pre === 'const x = "<b>not bold</b>";', `markdown renders: a heading, bold, a code block kept as text ${tag}`, JSON.stringify([r.heading, r.bold, r.pre]));
    const fm = await p.$$eval("[data-skv-frontmatter] dt, [data-skv-frontmatter] dd", (es) => es.map((e) => e.textContent));
    ok(JSON.stringify(fm) === JSON.stringify(["name", "alpha", "description", "Alpha rules for short sentences"]), `the frontmatter fields show as a list above the text ${tag}`, JSON.stringify(fm));
    ok(!/\[object |^null$/m.test(await dialog(p).innerText()), `no stray "null" or "[object …]" in the viewer ${tag}`);
    // 原文: the exact stored bytes
    await dialog(p).locator("[data-skv-raw]").click();
    ok(await p.locator("[data-skv-raw-text]").evaluate((e) => e.textContent) === stored(1) && stored(1) === V1, `原文 shows SKILL.md v1 exactly as stored ${tag}`);
    ok(await dialog(p).locator("[data-skv-raw]").getAttribute("aria-pressed") === "true" && (await dialog(p).locator("[data-skv-raw]").innerText()).trim() === (zh ? "原文" : "Raw text"), `the 原文 toggle is pressed ${tag}`);
    if (lang === "zh-TW") await p.screenshot({ path: join(shots, `viewer-raw-${lang}-${width}.png`) });
    // the version switcher: v2's own bytes; the note offers the way back
    await dialog(p).locator("select[data-skv-version]").selectOption("2");
    ok(await waitShown(p, "2") && await p.locator("[data-skv-raw-text]").evaluate((e) => e.textContent) === stored(2), `the version switcher shows v2's exact text ${tag}`);
    ok((await dialog(p).locator("[data-skv-pinned]").innerText()).includes(zh ? "這個位置用的是 v1" : "This seat uses v1") && await dialog(p).locator("[data-skv-back]").count() === 1, `on the latest, the note still names the pinned v1 with a way back ${tag}`);
    await dialog(p).locator("[data-skv-back]").click(); ok(await waitShown(p, "1"), `back to the pinned v1 ${tag}`);
    await dialog(p).locator("[data-skv-raw]").click();
    // a supporting file inline; a binary one cannot be opened
    await dialog(p).locator('[data-skv-file="ref/notes.md"]').click();
    const fileText = p.locator('[data-skv-file-text="ref/notes.md"]'); await fileText.waitFor();
    ok(await fileText.evaluate((e) => e.textContent) === NOTES && await p.evaluate(() => window.__xss ?? null) === null, `a supporting file opens inline as its exact text, nothing in it runs ${tag}`);
    ok(await dialog(p).locator('[data-skv-file="img/logo.png"]').isDisabled(), `a binary supporting file is not openable ${tag}`);
    await p.screenshot({ path: join(shots, `viewer-team-${lang}-${width}.png`) });
    if (width === 390) ok(await noSideways(p), `no sideways scroll with the viewer open ${tag}`);
    // Tab stays inside the dialog
    let inside = true; for (let i = 0; i < 14; i++) { await p.keyboard.press("Tab"); inside &&= await focusIn(p); }
    await dialog(p).locator("[data-skv-close]").focus(); await p.keyboard.press("Shift+Tab"); inside &&= await focusIn(p);
    ok(inside, `Tab and Shift+Tab keep the focus inside the dialog ${tag}`);
    // Esc closes; the focus returns to the chip; the page's selection and its member editor are as they were
    await p.keyboard.press("Escape");
    ok(await dialog(p).count() === 0, `Esc closes the viewer ${tag}`);
    ok(await p.evaluate(() => document.activeElement?.getAttribute("data-skill-view") === "alpha" && !!document.activeElement.closest('[data-team-row="design-a"]')), `the focus returns to the chip that opened it ${tag}`);
    ok(JSON.stringify(await pageState()) === JSON.stringify(before), `opening the viewer changed nothing on the page: same workflow, member editor still open, same hash ${tag}`, JSON.stringify([before, await pageState()]));
    // the seat editor's chip, closed with its close button
    const seatChip = p.locator('[data-seat-editor="maker"] [data-skill-view="alpha"]');
    await seatChip.click(); await dialog(p).waitFor(); ok(await waitShown(p, "1"), `the seat editor's chip opens the viewer at the seat's v1 ${tag}`);
    await dialog(p).locator("[data-skv-close]").click();
    ok(await dialog(p).count() === 0 && await p.evaluate(() => !!document.activeElement?.closest('[data-seat-editor="maker"]')), `the close button closes it and the focus returns to the seat editor's chip ${tag}`);
    // the role skill chip: Studio's versioned role text, the version this node receives
    const roleChip = rowA.locator('[data-skill-view^="role:"]');
    const roleKey = await roleChip.getAttribute("data-skill-view"), roleV = await roleChip.getAttribute("data-skill-pinned");
    await roleChip.click(); await dialog(p).waitFor(); await waitShown(p, roleV);
    await dialog(p).locator("[data-skv-raw]").click();
    const [, wf, role] = /^role:([^/]+)\/(.+)$/.exec(roleKey) || [];
    const roleText = await p.evaluate(async ([wf, role, v]) => (await (await fetch(`/api/improve/skills/${wf}/${role}?v=${v}`)).json()).text, [wf, role, roleV]);
    ok(wf === "web-prototype" && !!roleText && await p.locator("[data-skv-raw-text]").evaluate((e) => e.textContent) === roleText && (await dialog(p).innerText()).includes(zh ? "角色技能" : "Role skill"), `the role skill chip opens that role's text at v${roleV} ${tag}`, roleKey);
    await p.keyboard.press("Escape");
    // a duty skill chip opens the library skill at its pin
    const duty = rowA.locator('.tm-skill.own [data-skill-view="web-interaction"]').first();
    await duty.click(); await dialog(p).waitFor(); ok(await waitShown(p, String(await duty.getAttribute("data-skill-pinned"))) && (await p.locator("#skvTitle").innerText()).trim() === "web-interaction", `a node's own skill chip opens it at its pinned version ${tag}`);
    await p.keyboard.press("Escape");
    ok(errors.length === 0, `no browser errors on the Crew page ${tag}`, errors.join(" | "));
    // ---------- the Library row ----------
    await p.goto(`${base}/#/library/skills`); await p.locator('[data-skill="alpha"]').waitFor();
    const read = p.locator('[data-skill="alpha"] [data-skill-view="alpha"]');
    ok(await read.getAttribute("aria-label") === name("alpha"), `a Library row has a Read button named “${name("alpha")}” ${tag}`);
    await read.click(); await dialog(p).waitFor(); ok(await waitShown(p, "2") && await dialog(p).locator("[data-skv-pinned]").count() === 0, `from the Library it opens on the latest version, with no pin note ${tag}`);
    await dialog(p).locator("[data-skv-raw]").click();
    ok(await p.locator("[data-skv-raw-text]").evaluate((e) => e.textContent) === stored(2), `the Library's viewer shows v2's exact text ${tag}`);
    await dialog(p).locator("[data-skv-raw]").click();
    await p.screenshot({ path: join(shots, `viewer-library-${lang}-${width}.png`) });
    await p.keyboard.press("Escape");
    ok(await p.evaluate(() => document.activeElement?.getAttribute("data-skill-view") === "alpha"), `Esc returns the focus to the Library row's Read button ${tag}`);
    // ---------- the deep link ----------
    await p.goto(`${base}/#/skills/alpha@1`); await dialog(p).waitFor();
    ok(await waitShown(p, "1"), `#/skills/alpha@1 opens the viewer at v1 over the Library ${tag}`);
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => location.hash === "#/library/skills").catch(() => {});
    ok(await dialog(p).count() === 0 && await p.evaluate(() => location.hash) === "#/library/skills", `closing the deep link leaves the Library's Skills page ${tag}`, await p.evaluate(() => location.hash));
    ok(errors.length === 0, `no browser errors ${tag}`, errors.join(" | "));
    await ctx.close();
  }
} catch (e) { ok(false, "skill-viewer-ui threw", e?.stack ?? String(e)); }
finally { await browser?.close(); if (app.exitCode === null) { const stopped = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await stopped; } rmSync(dir, { recursive: true, force: true }); }
console.log(`\nskill-viewer-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
