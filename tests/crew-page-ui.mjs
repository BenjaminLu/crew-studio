import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Crew page, option C (#/team; docs/design/crew-seats.md) in a real isolated Studio and Chromium, at 1440 and 390:
//   - one card per workflow with its agent nodes as dots in the member's colour and a badge (Follows team / N custom / Missing)
//   - the selected workflow's table: member, model, effort, skills (member's grey, node's removable, "+ skill"), source
//   - a model or effort change asks "only this workflow" or "the whole member (affects N nodes)", and changes only those nodes
//   - adding and removing a node skill; restore to team; the member editor (presets, a member's model); the rules' notes
//   - English and 繁體中文; no horizontal scroll at 390; no browser errors. No accounts, no model calls.
//      bun tests/crew-page-ui.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { CrewStore } = await import("../src/domain/crew.ts");
const root = join(import.meta.dir, ".."), dir = mkdtempSync(join(tmpdir(), "crew-page-ui-")), data = join(dir, "data"), home = join(dir, "home"), token = "crew-page-fixture";
mkdirSync(home); mkdirSync(data);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const pin = (id) => ({ id, v: 1, sha256: createHash("sha256").update(readFileSync(join(root, `packs/core/skills/${id}/SKILL.md`), "utf8")).digest("hex") });
const m = (provider, model, effort, skills = []) => ({ provider, model, effort, skills });
const seed = () => { rmSync(join(data, "crew"), { recursive: true, force: true }); new CrewStore(data).write({ schema: 1, members: { coordinator: m("claude", "opus-5.5", "high"), maker: m("codex", "gpt-6.1-sol", "medium", [pin("plain-writing")]),
  "alt-maker": m("claude", "sonnet-5.5", "medium"), reviewer: m("claude", "opus-5.5", "high", [pin("code-review")]), "design-reviewer": m("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" }); };
seed();
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_DATA: data, CREW_PORT: String(port), CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_HOST_CODEX_BIN: "/nonexistent/codex", CREW_HOST_CLAUDE_BIN: "/nonexistent/claude", CREW_SANDBOX: "0" };
delete env.CREW_MAIN_PROJECT; delete env.CREW_FM_STATE;
const app = spawn("bun", ["src/server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }); let browser;
const api = async () => (await fetch(`${base}/api/team`, { headers: { cookie: `crew_session=${token}` } })).json();
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base, token);
  const view = async (p) => p.evaluate(async () => (await fetch("/api/team")).json());
  for (const [lang, width, height] of [["en", 1440, 940], ["zh-TW", 390, 844]]) {
    seed();
    const p = await browser.newPage({ viewport: { width, height } }); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    const tag = `${lang} ${width}`;
    await p.goto(`${base}/#/crew`); await p.evaluate((l) => setLang(l), lang);
    await p.locator("[data-team-link]").click();
    await p.locator("[data-team-page]").waitFor();
    ok(/#\/team$/.test(p.url()), `the Crew page links to who runs each workflow ${tag}`);
    const card = p.locator('[data-team-card="web-prototype"]');
    ok(await card.count() === 1 && await p.locator('[data-team-card="documents"]').count() === 1 && await p.locator('[data-team-card="code-firstmate"]').count() === 1, `one card per workflow with agents ${tag}`);
    ok((await card.innerText()).includes(lang === "en" ? "Follows team" : "跟團隊"), `a workflow that follows the team says so ${tag}`, await card.innerText());
    await card.click();
    const rowA = p.locator('[data-team-row="design-a"]'), rowB = p.locator('[data-team-row="design-b"]');
    await rowA.waitFor();
    const modelOf = async (row) => row.locator("select").nth(1).inputValue();
    ok(await modelOf(rowA) === "codex/gpt-6.1-sol" && await modelOf(rowB) === "claude/sonnet-5.5", `design A and B show different members' models ${tag}`);
    ok(await rowA.locator(".tm-skill.base").innerText() === "plain-writing", `the member's skill shows grey on the node ${tag}`);
    // effort, only this workflow
    await rowA.locator("select").nth(2).selectOption("high");
    const ask = p.locator('[data-scope-ask="design-a"]'); await ask.waitFor();
    const teamBtn = await ask.locator("[data-scope-team]").innerText();
    const uses = (await view(p)).seats.find((s) => s.id === "maker").uses;
    ok(uses >= 3 && teamBtn.includes(String(uses)) && teamBtn.includes(lang === "en" ? "Maker" : "產出"), `the scope question names the member and how many nodes it reaches ${tag}`, teamBtn);
    await ask.locator("[data-scope-here]").click();
    await p.waitForFunction(() => document.querySelector('[data-team-row="design-a"] [data-source]')?.dataset.source === "workflow");
    let v = await view(p);
    const wp = (id) => v.workflows.find((w) => w.id === id), node = (w, n) => wp(w).nodes.find((x) => x.node === n);
    ok(node("web-prototype", "design-a").effort === "high" && node("documents", "draft").effort === "medium" && node("web-prototype", "design-b").effort === "medium", `only this workflow: one node changed ${tag}`);
    ok((await card.innerText()).includes(lang === "en" ? "1 custom" : "1 項自訂") && (await card.innerText()).includes("★"), `the card counts the custom node and stars it ${tag}`, await card.innerText());
    // model, the whole member
    await rowA.locator("select").nth(1).selectOption("codex/gpt-6-astra");
    await p.locator('[data-scope-ask="design-a"] [data-scope-team]').click();
    await p.waitForFunction(() => !document.querySelector("[data-scope-ask]"));
    v = await view(p);
    ok(node("documents", "draft").model === "gpt-6-astra" && node("web-prototype", "design-a").model === "gpt-6-astra" && node("web-prototype", "design-a").effort === "high" && node("video", "draft").model === "gpt-6-astra", `the whole member: every maker node changes, the workflow's own effort stays ${tag}`);
    ok(node("web-prototype", "design-b").model === "sonnet-5.5", `the second maker is not touched ${tag}`);
    // skills: add one, remove it
    await rowB.locator(".tm-add").selectOption("accessible-ui");
    await p.waitForFunction(() => [...document.querySelectorAll('[data-team-row="design-b"] .tm-skill.own')].some((e) => e.textContent.includes("accessible-ui")));
    ok(true, `a skill from the library is added to one node ${tag}`);
    await rowB.locator(".tm-skill.own", { hasText: "accessible-ui" }).locator(".tm-x").click();
    await p.waitForFunction(() => ![...document.querySelectorAll('[data-team-row="design-b"] .tm-skill.own')].some((e) => e.textContent.includes("accessible-ui")));
    ok(true, `and removed again ${tag}`);
    // restore
    await p.locator('[data-restore="web-prototype"]').click();
    await p.waitForFunction(() => document.querySelector('[data-team-card="web-prototype"] .tm-badge')?.classList.contains("team"));
    ok(node("web-prototype", "design-a").effort === "high" && (await view(p)).workflows.find((w) => w.id === "web-prototype").nodes.find((x) => x.node === "design-a").effort === "medium", `restore to team drops this workflow's customisation ${tag}`);
    // the member editor: a preset, and the rule's note when the second maker takes the maker's model
    await p.locator('[data-legend="reviewer"]').click();
    await p.locator("[data-member-editor]").waitFor();
    await p.locator('[data-preset="quality"]').click();
    await p.waitForFunction(() => document.querySelector('[data-seat-editor="maker"] select:nth-of-type(2)')?.value === "high");
    v = await view(p);
    ok(v.seats.filter((s) => s.member).every((s) => s.member.effort === "high"), `the quality preset sets every member's effort ${tag}`);
    await p.locator('[data-seat-editor="alt-maker"] select').first().selectOption("codex/gpt-6-astra");
    await p.waitForFunction(() => document.querySelector('[data-team-row="design-b"] .tm-notes'));
    ok(/same model as Maker|同一個模型/.test(await rowB.locator(".tm-notes").innerText()) && await modelOf(rowB) !== "codex/gpt-6-astra", `the rule moves B off the maker's model and says so ${tag}`, await rowB.locator(".tm-notes").innerText());
    if (width === 390) ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), `no horizontal scroll at 390 ${tag}`, String(await p.evaluate(() => document.scrollingElement.scrollWidth)));
    if (process.env.CREW_UI_SHOTS) { await p.screenshot({ path: join(process.env.CREW_UI_SHOTS, `team-${width}.png`) }); await p.locator("[data-team-detail]").screenshot({ path: join(process.env.CREW_UI_SHOTS, `team-detail-${width}.png`) }); }
    ok(errors.length === 0, `no browser errors ${tag}`, errors.join(" | "));
    await p.close();
  }
  // a stale page never overwrites a newer team
  const r = await fetch(`${base}/api/team/change`, { method: "POST", headers: { "content-type": "application/json", cookie: `crew_session=${token}`, origin: base, "x-crew-csrf": "1" }, body: JSON.stringify({ change: { kind: "preset", preset: "save" }, expected: "0".repeat(64) }) });
  ok([403, 409].includes(r.status), "a change from a stale view (or without the page's session) is refused", String(r.status));
} catch (e) { ok(false, "crew-page-ui threw", e?.stack ?? String(e)); }
finally { await browser?.close(); if (app.exitCode === null) { const stopped = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await stopped; } rmSync(dir, { recursive: true, force: true }); }
console.log(`\ncrew-page-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
