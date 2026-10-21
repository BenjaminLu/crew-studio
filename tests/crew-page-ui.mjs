import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Crew page, option C (#/team; docs/design/crew-seats.md) in a real isolated Studio and Chromium, at 1440 and 390:
//   - one card per workflow with its agent nodes as dots in the member's colour and a badge (Follows team / N custom / Missing)
//   - the selected workflow's table: member, model, effort, skills (member's grey, node's removable, "+ skill"), source
//   - a model or effort change asks "only this workflow" or "the whole member (affects N nodes)", and changes only those nodes
//   - adding and removing a node skill; restore to team; the member editor (presets, a member's model); the rules' notes
//   - the project selector: one project's crew, "only this project" in the scope question, restore the project to the team
//   - the model choices are the models detected on this machine (stub Codex app-server and stub Claude CLI): opening the page
//     detects them, each provider shows its login, model count and detection time, 重新偵測 detects again; the select is
//     grouped by provider with only detected models and their own efforts; an assigned model no longer detected shows
//     「目前不可用」 and the note says why; a provider without a login says so
//   - English and 繁體中文; no horizontal scroll at 390; no browser errors. No accounts, no model calls.
//      bun tests/crew-page-ui.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { CrewStore } = await import("../src/domain/crew.ts");
const root = join(import.meta.dir, ".."), dir = mkdtempSync(join(tmpdir(), "crew-page-ui-")), data = join(dir, "data"), home = join(dir, "home"), token = "crew-page-fixture";
mkdirSync(home); mkdirSync(data);
// the detected models: a stub Codex app-server (its login is the strict offline fixture's) and a stub Claude CLI
const CODEX_MODELS = [["gpt-6.1-sol", ["low", "medium", "high", "xhigh"]], ["gpt-6-astra", ["low", "medium", "high", "xhigh"]], ["gpt-6.2-nova", ["medium", "high"]]];
mkdirSync(join(home, ".codex"));
writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ auth_mode: "chatgpt", last_refresh: "2020-02-29T12:34:56.123+08:00", tokens: { access_token: "abcdefgh.abcdefgh.abcdefgh", id_token: "fixture-id-token", account_id: "fixture-native-staffing", refresh_token: "source-fixture-refresh-must-not-copy" } }), { mode: 0o600 });
// the probe hands the CLI a clean environment, so a wrapper in the temp folder carries the model list into the fixture
writeFileSync(join(dir, "codex.mjs"), `process.env.ACCOUNT_FIXTURE_MODELS=${JSON.stringify(JSON.stringify(CODEX_MODELS))};await import(${JSON.stringify(join(root, "tests/fixture/codex-account.mjs"))});\n`);
writeFileSync(join(home, ".claude-models.json"), JSON.stringify([{ value: "opus", resolvedModel: "claude-opus-4-8", displayName: "Opus 4.8", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] }, { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" }]));
writeFileSync(join(home, ".claude-models-login"), "1");
const claudeReads = () => existsSync(join(home, ".claude-models-trace.jsonl")) ? readFileSync(join(home, ".claude-models-trace.jsonl"), "utf8").split("\n").filter((l) => l.includes('"initialize"')).length : 0;
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const pin = (id) => ({ id, v: 1, sha256: createHash("sha256").update(readFileSync(join(root, `packs/core/skills/${id}/SKILL.md`), "utf8")).digest("hex") });
const m = (provider, model, effort, skills = []) => ({ provider, model, effort, skills });
const seed = () => { rmSync(join(data, "crew"), { recursive: true, force: true }); new CrewStore(data).write({ schema: 1, members: { coordinator: m("claude", "opus-5.5", "high"), maker: m("codex", "gpt-6.1-sol", "medium", [pin("plain-writing")]),
  "alt-maker": m("claude", "sonnet-5.5", "medium"), reviewer: m("claude", "opus-5.5", "high", [pin("code-review")]), "design-reviewer": m("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" }); };
seed();
// a registered project to choose on the page (no repository: the page only lists it)
writeFileSync(join(data, "projects.json"), JSON.stringify([{ id: "shop", name: "Shop", path: null, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null }]));
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_DATA: data, CREW_PORT: String(port), CREW_SESSION_TOKEN: token, CREW_GH: "0", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_HOST_CODEX_BIN: "/nonexistent/codex", CREW_HOST_CLAUDE_BIN: "/nonexistent/claude", CREW_SANDBOX: "0",
  USER: process.env.USER || "fixture-user", LOGNAME: process.env.LOGNAME || "fixture-user", CREW_CODEX_BIN: join(dir, "codex.mjs"), CREW_CLAUDE_BIN: join(root, "tests/fixture/claude-models.mjs"), CREW_DETECT_FORCE_MIN_MS: "0" };
delete env.CREW_MAIN_PROJECT; delete env.CREW_FM_STATE; delete env.CODEX_API_KEY;
const app = spawn("bun", ["src/server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }); let browser;
const api = async () => (await fetch(`${base}/api/team`, { headers: { cookie: `crew_session=${token}` } })).json();
try {
  await waitUp(base, app); browser = withSession(await chromium.launch(), base, token);
  const view = async (p) => p.evaluate(async () => (await fetch("/api/team")).json());
  const closeSettings=async p=>{if(await p.locator('[data-crew-drawer]').count())await p.locator('[data-crew-drawer-close]').click();};
  const section=async(p,name)=>{await closeSettings(p);await p.locator(`[data-crew-section="${name}"]`).click();};
  const expand=async(p,key)=>{const fold=p.locator(`[data-crew-fold="${key}"]`);if(!await fold.evaluate(el=>el.open))await fold.locator(':scope > summary').click();};
  const workflow=async(p,id)=>{await section(p,'workflows');await p.locator('[data-crew-workflow-picker]').selectOption(id);await expand(p,'workflow-overview');};
  const inspect=async(p,node)=>{if(!await p.locator(`[data-team-row="${node}"]`).count()){await closeSettings(p);await p.locator(`[data-crew-node="${node}"]`).click();}const fold=p.locator('[data-crew-drawer] [data-crew-fold^="node-skills:"]');if(await fold.count()&&!await fold.evaluate(el=>el.open))await fold.locator(':scope > summary').click();};

  for (const [lang, width, height] of [["en", 1440, 940], ["zh-TW", 390, 844]]) {
    seed();
    const p = await browser.newPage({ viewport: { width, height } }); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    const tag = `${lang} ${width}`;
    await p.goto(`${base}/#/crew`); await p.evaluate((l) => setLang(l), lang);
    // the page first shows the facts the server already holds (an earlier read of the CLI's list), then detects again:
    // wait for that detection's answer, not for the first "detected" state, which can be the earlier read's
    const readsBefore = claudeReads(), detected = p.waitForResponse((r) => /\/api\/team\?(.*&)?facts=1\b/.test(r.url()), { timeout: 30000 });
    await p.locator("[data-team-link]").click();
    await detected;
    await p.locator("[data-team-page]").waitFor();
    ok(/#\/team$/.test(p.url()), `the Crew page links to who runs each workflow ${tag}`);
    await section(p,"team");await expand(p,"model-detection");
    // ---------- detected models ----------
    const claudeStatus = p.locator('[data-provider-status="claude"]'), codexStatus = p.locator('[data-provider-status="codex"]');
    await p.waitForFunction(() => document.querySelector('[data-provider-status="claude"]')?.dataset.state === "detected" && document.querySelector('[data-provider-status="codex"]')?.dataset.state === "detected", null, { timeout: 30000 });
    if (lang === "en") ok(claudeReads() > readsBefore, `opening the page detects the models (the Claude CLI's list was read) ${tag}`, `${readsBefore} → ${claudeReads()}`);
    ok(await codexStatus.locator("[data-model-count]").getAttribute("data-model-count") === "3" && await claudeStatus.locator("[data-model-count]").getAttribute("data-model-count") === "2", `each provider shows how many models were detected ${tag}`);
    ok(await claudeStatus.getAttribute("data-login") === "logged-in" && (await claudeStatus.innerText()).includes(lang === "en" ? "signed in" : "已登入"), `each provider shows its login ${tag}`, await claudeStatus.innerText());
    ok(Number(await claudeStatus.locator("[data-detected-at]").getAttribute("data-detected-at")) > 0 && (await claudeStatus.innerText()).includes(lang === "en" ? "detected at" : "偵測時間"), `each provider shows when it was detected ${tag}`);
    const opts = async (row) => row.locator("select").nth(1).evaluate((s) => [...s.querySelectorAll("optgroup")].map((g) => ({ group: g.dataset.providerGroup, options: [...g.querySelectorAll("option")].map((o) => ({ value: o.value, text: o.textContent, stale: o.hasAttribute("data-unavailable"), efforts: o.dataset.efforts })) })));
    const note = p.locator("[data-models-note]");
    ok(await note.count() === 1 && /sonnet-5\.5/.test(await note.innerText()) && (await note.innerText()).includes(lang === "en" ? "not detected on this machine" : "沒有偵測到"), `the note names the unavailable models and explains ${tag}`, await note.innerText().catch(() => ""));
    await workflow(p,'web-prototype');
    const card = p.locator('[data-team-card="web-prototype"]');
    ok(await card.count() === 1 && await p.locator('[data-team-card="documents"]').count() === 1 && await p.locator('[data-team-card="code-firstmate"]').count() === 1, `one card per workflow with agents ${tag}`);
    ok((await card.innerText()).includes(lang === "en" ? "Follows team" : "跟團隊"), `a workflow that follows the team says so ${tag}`, await card.innerText());
    await workflow(p,"web-prototype");await inspect(p,"design-a");
    const rowA = p.locator('[data-team-row="design-a"]'), rowB = p.locator('[data-team-row="design-b"]');
    await rowA.waitFor();
    const modelOf = async (row) => {await inspect(p,row===rowA?"design-a":"design-b");return row.locator("select").nth(1).inputValue();};
    ok(await modelOf(rowA) === "codex/gpt-6.1-sol" && await modelOf(rowB) === "claude/sonnet-5.5", `design A and B show different members' models ${tag}`);
    const groupsB = await opts(rowB);
    ok(JSON.stringify(groupsB.map((g) => g.group)) === '["codex","claude"]' && JSON.stringify(groupsB[0].options.map((o) => o.value)) === JSON.stringify(CODEX_MODELS.map(([m]) => `codex/${m}`)),
      `the model select is grouped by provider and lists only the detected models ${tag}`, JSON.stringify(groupsB));
    const claudeOpts = groupsB[1].options;
    ok(claudeOpts.length === 3 && claudeOpts[0].value === "claude/sonnet-5.5" && claudeOpts[0].stale && claudeOpts[0].text.includes(lang === "en" ? "unavailable now" : "目前不可用") && claudeOpts.slice(1).map((o) => o.value).join() === "claude/claude-opus-4-8,claude/claude-haiku-4-5-20251001" && !claudeOpts.some((o) => /opus-5-5|opus-5\.5/.test(o.value)),
      `the current model no longer detected stays, marked unavailable; Claude's choices are its CLI's list ${tag}`, JSON.stringify(claudeOpts));
    ok(claudeOpts[1].efforts === "low medium high xhigh max" && claudeOpts[2].efforts === "" && groupsB[0].options[2].efforts === "medium high", `each model carries its own efforts ${tag}`);
    await inspect(p,"design-a");
    ok(JSON.stringify(await rowA.locator("select").nth(2).evaluate((s) => [...s.options].map((o) => o.value))) === '["low","medium","high","xhigh"]', `the effort select offers the model's own efforts ${tag}`);
    ok(await rowA.locator(".tm-skill.base").innerText() === "plain-writing", `the member's skill shows grey on the node ${tag}`);
    { const role = await rowA.locator("[data-role-skill]").textContent().catch(() => "") ?? "";
      ok(role.includes(lang === "en" ? "Role" : "角色") && role.includes("designer.md") && /· [0-9a-f]{8}/.test(role) && await rowA.locator(".tm-skill.own", { hasText: "web-interaction" }).count() === 1,
        `the node shows its role skill (labelled, with its hash) and its own duty skills ${tag}`, role); }
    // effort, only this workflow
    await rowA.locator("select").nth(2).selectOption("high");
    const ask = p.locator('[data-scope-ask="design-a"]'); await ask.waitFor();
    const teamBtn = await ask.locator("[data-scope-team]").innerText();
    const uses = (await view(p)).seats.find((s) => s.id === "maker").usesEffort;
    ok(uses >= 3 && teamBtn.includes(String(uses)) && teamBtn.includes(lang === "en" ? "Maker" : "產出"), `the scope question names the member and how many nodes it reaches ${tag}`, teamBtn);
    await ask.locator("[data-scope-here]").click();
    await p.waitForFunction(() => document.querySelector('[data-team-row="design-a"] [data-source]')?.dataset.source === "workflow");
    let v = await view(p);
    const wp = (id) => v.workflows.find((w) => w.id === id), node = (w, n) => wp(w).nodes.find((x) => x.node === n);
    ok(node("web-prototype", "design-a").effort === "high" && node("documents", "draft").effort === "medium" && node("web-prototype", "design-b").effort === "medium", `only this workflow: one node changed ${tag}`);
    ok(v.seats.find((s) => s.id === "maker").usesEffort === uses - 1 && v.seats.find((s) => s.id === "maker").usesModel === uses, `the member's reach for effort no longer counts the node this workflow set itself ${tag}`);
    ok((await card.innerText()).includes(lang === "en" ? "1 custom" : "1 項自訂") && (await card.innerText()).includes("★"), `the card counts the custom node and stars it ${tag}`, await card.innerText());
    // model, the whole member
    await rowA.locator("select").nth(1).selectOption("codex/gpt-6-astra");
    await p.locator('[data-scope-ask="design-a"] [data-scope-team]').click();
    await p.waitForFunction(() => !document.querySelector("[data-scope-ask]"));
    v = await view(p);
    ok(node("documents", "draft").model === "gpt-6-astra" && node("web-prototype", "design-a").model === "gpt-6-astra" && node("web-prototype", "design-a").effort === "high" && node("video", "draft").model === "gpt-6-astra", `the whole member: every maker node changes, the workflow's own effort stays ${tag}`);
    ok(node("web-prototype", "design-b").model === "sonnet-5.5", `the second maker is not touched ${tag}`);
    // coffee's empty image seat is named on its card; code-firstmate's judged checks show who reviews
    ok(/Image maker|圖像產出/.test(await p.locator('[data-missing-roles="coffee-kit"]').innerText()), `a missing seat says which seat and role ${tag}`);
    await workflow(p,'code-firstmate');const judged=(await view(p)).workflows.find(w=>w.id==='code-firstmate').nodes.find(n=>n.judge);await inspect(p,judged.node);await p.locator('[data-team-detail="code-firstmate"]').waitFor();
    ok(await p.locator('[data-team-judge]').count() > 0 && (await p.locator('[data-team-card="code-firstmate"] .tm-step.judge').count()) > 0, `judged checks show on the card and in the table, on their reviewing seat ${tag}`);
    await workflow(p,"web-prototype");await inspect(p,"design-b"); await rowB.waitFor();
    // skills: add one, remove it (design-b already pins web-interaction and accessible-ui by duty)
    await rowB.locator(".tm-add").selectOption("data-viz");
    await p.waitForFunction(() => [...document.querySelectorAll('[data-team-row="design-b"] .tm-skill.own')].some((e) => e.textContent.includes("data-viz")));
    ok(true, `a skill from the library is added to one node ${tag}`);
    await rowB.locator(".tm-skill.own", { hasText: "data-viz" }).locator(".tm-x").click();
    await p.waitForFunction(() => ![...document.querySelectorAll('[data-team-row="design-b"] .tm-skill.own')].some((e) => e.textContent.includes("data-viz")));
    ok(true, `and removed again ${tag}`);
    // restore
    await closeSettings(p);await expand(p,"restore:web-prototype");await p.locator('[data-restore="web-prototype"]').click();
    await p.waitForFunction(() => document.querySelector('[data-team-card="web-prototype"] .tm-badge')?.classList.contains("team"));
    ok(node("web-prototype", "design-a").effort === "high" && (await view(p)).workflows.find((w) => w.id === "web-prototype").nodes.find((x) => x.node === "design-a").effort === "medium", `restore to team drops this workflow's customisation ${tag}`);
    // the member editor: a preset, and the rule's note when the second maker takes the maker's model
    await section(p,"team");await expand(p,"team-advanced");await p.locator("[data-crew-manage]").click();
    await p.locator("[data-member-editor]").waitFor();
    await p.locator('[data-preset="quality"]').click();
    await p.waitForFunction(() => document.querySelector('[data-seat-editor="maker"] select:nth-of-type(2)')?.value === "high");
    v = await view(p);
    ok(v.seats.filter((s) => s.member).every((s) => s.member.effort === "high"), `the quality preset sets every member's effort ${tag}`);
    await p.locator('[data-seat-editor="alt-maker"] select').first().selectOption("codex/gpt-6-astra");
    await workflow(p,"web-prototype");await inspect(p,"design-b");await p.waitForFunction(() => document.querySelector('[data-team-row="design-b"] .tm-notes'));
    ok(/same model as Maker|同一個模型/.test(await rowB.locator(".tm-notes").innerText()) && await modelOf(rowB) !== "codex/gpt-6-astra", `the rule moves B off the maker's model and says so ${tag}`, await rowB.locator(".tm-notes").innerText());
    // 重新偵測 reads the lists again; a provider without a login says so
    await section(p,"team");await expand(p,"model-detection");
    const readsNow = claudeReads(); rmSync(join(home, ".claude-models-login"));
    const redetect = async (login) => { await p.locator("[data-redetect]:not([disabled])").click(); await p.waitForFunction((l) => document.querySelector('[data-provider-status="claude"]')?.dataset.login === l && document.querySelector("[data-model-detection]")?.getAttribute("aria-busy") === "false", login, { timeout: 30000 }); };
    await redetect("not-logged-in");
    ok(claudeReads() > readsNow && (await claudeStatus.innerText()).includes(lang === "en" ? "not signed in" : "未登入"), `重新偵測 detects again, and a provider without a login says so ${tag}`, await claudeStatus.innerText());
    writeFileSync(join(home, ".claude-models-login"), "1"); await redetect("logged-in");
    if (width === 390) ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1), `no horizontal scroll at 390 ${tag}`, String(await p.evaluate(() => document.scrollingElement.scrollWidth)));
    if (process.env.CREW_UI_SHOTS) { await p.screenshot({ path: join(process.env.CREW_UI_SHOTS, `team-${width}.png`) }); await workflow(p,"web-prototype");await p.locator("[data-team-detail]").screenshot({ path: join(process.env.CREW_UI_SHOTS, `team-detail-${width}.png`) }); }
    // last, so its page visits do not overlap the detection checks above: the sidebar's Crew opens the team page; the rounds and activity are its second tab, and #/crew deep links still open them
    await p.goto(`${base}/#/board`); await p.evaluate(() => document.querySelector('.nav-item[data-view="crew"]').click());
    await p.locator("[data-team-page]").waitFor();
    ok(/#\/team$/.test(p.url()) && await p.locator('.nav-item[data-view="crew"][aria-current="page"]').count() === 1, `the sidebar's Crew opens the team page and stays marked current ${tag}`, p.url());
    ok(await p.locator('[data-crew-tabs="team"] [data-crew-tab="team"][aria-current="page"]').count() === 1 && (await p.locator("[data-crew-tabs]").innerText()).includes(lang === "en" ? "Rounds & activity" : "回合與紀錄"), `the team page shows Crew's two tabs, Team current ${tag}`, await p.locator("[data-crew-tabs]").innerText());
    await p.locator('[data-crew-tab="rounds"]').click(); await p.locator('[data-crew-tabs="rounds"]').waitFor();
    ok(/#\/crew$/.test(p.url()) && await p.locator('.nav-item[data-view="crew"][aria-current="page"]').count() === 1 && await p.locator('[data-crew-tab="rounds"][aria-current="page"]').count() === 1, `the Rounds tab opens #/crew under the same sidebar item ${tag}`, p.url());
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Crew's tabs fit the width ${tag}`);
    if (process.env.CREW_SHOTS) await p.screenshot({ path: join(process.env.CREW_SHOTS, `crew-tabs-${lang}-${width}.png`) });
    ok(errors.length === 0, `no browser errors ${tag}`, errors.join(" | "));
    await p.close();
  }
  // one project's crew: "only this project" changes that project's nodes and nothing else
  {
    seed();
    const p = await browser.newPage({ viewport: { width: 1440, height: 940 } }); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`${base}/#/team`); await p.evaluate(() => setLang("en")); await p.locator("[data-team-page]").waitFor();
    const read = async (q) => p.evaluate(async (u) => (await fetch(u)).json(), `/api/team${q}`);
    const projectLoaded=p.waitForResponse(r=>new URL(r.url()).pathname==="/api/team"&&new URL(r.url()).searchParams.get("project")==="shop");
    await p.locator("[data-team-project]").selectOption("shop");await projectLoaded;
    await p.waitForFunction(() => document.querySelector("[data-team-project]")?.value === "shop" && document.querySelector("[data-crew-person]"));
    await workflow(p,"web-prototype");await inspect(p,"design-a");
    const rowA = p.locator('[data-team-row="design-a"]'); await rowA.waitFor();
    await rowA.locator("select").nth(2).selectOption("xhigh");
    const ask = p.locator('[data-scope-ask="design-a"]'); await ask.waitFor();
    const projBtn = ask.locator("[data-scope-project]");
    ok(await projBtn.count() === 1 && /Only this project \(Shop/.test(await projBtn.innerText()), "in a project the scope question offers only this project", await projBtn.innerText().catch(() => ""));
    await projBtn.click();
    await p.waitForFunction(() => document.querySelector('[data-team-row="design-a"] [data-source]')?.dataset.source === "project");
    const shop = await read("?project=shop"), wide = await read("");
    const at = (v, w, n) => v.workflows.find((x) => x.id === w).nodes.find((x) => x.node === n);
    ok(at(shop, "web-prototype", "design-a").effort === "xhigh" && at(shop, "documents", "draft").effort === "xhigh" && at(wide, "web-prototype", "design-a").effort === "medium" && at(wide, "documents", "draft").effort === "medium",
      "only this project: the seat's nodes change in that project, the Studio-wide team does not", JSON.stringify({ shop: at(shop, "web-prototype", "design-a").effort, wide: at(wide, "web-prototype", "design-a").effort }));
    ok(shop.projects.find((x) => x.id === "shop")?.custom === true && /◆/.test(await p.locator("[data-team-project] option[value=shop]").innerText()), "the selector marks a project with its own crew");
    await closeSettings(p);await expand(p,"restore:web-prototype");await p.locator('[data-restore-project="shop"]').click();await inspect(p,"design-a");
    await p.waitForFunction(() => document.querySelector('[data-team-row="design-a"] [data-source]')?.dataset.source === "team");
    ok(!(await read("?project=shop")).projects.find((x) => x.id === "shop").custom, "restore puts the project back on the team");
    ok(errors.length === 0, "no browser errors (project)", errors.join(" | "));
    await p.close();
  }
  // Real-save lifecycle: no prototype routes, no fabricated availability or success.
  {
    seed();const p=await browser.newPage({viewport:{width:1440,height:940}});await p.goto(`${base}/#/team`);await p.evaluate(()=>setLang('en'));await p.locator('[data-crew-person="maker"]').waitFor();await section(p,'team');await p.locator('[data-crew-person="maker"]').click();
    await p.waitForFunction(()=>document.querySelector('[data-crew-edit-model] option[value="codex/gpt-6.2-nova"]'));
    let writes=0;p.on('request',r=>{if(r.method()==='POST'&&r.url()===`${base}/api/team/change`)writes++;});
    const current=await api();await p.locator('[data-crew-edit-model]').selectOption('codex/gpt-6.2-nova');ok(await p.evaluate(()=>window.pageDirty.why())==='crew-member-draft','an unsaved role draft owns the release guard');
    await p.getByRole('button',{name:'Cancel changes',exact:true}).click();ok(await p.evaluate(()=>window.pageDirty.why())==='dialog','cancel removes the unsaved role guard while retaining the inspector');ok(writes===0&&(await api()).team.hash===current.team.hash,'cancel discards a role draft without any write');
    await p.locator('[data-crew-edit-model]').selectOption('codex/gpt-6.2-nova');await p.locator('[data-crew-edit-effort]').selectOption('high');
    const saved=p.waitForResponse(r=>r.url()===`${base}/api/team/change`&&r.request().method()==='POST');await p.locator('[data-crew-save]').click();ok((await saved).status()===200,'role Save receives a real successful server acknowledgement');await p.waitForFunction(()=>!document.querySelector('[data-crew-save]'));
    const persisted=await api();ok(persisted.seats.find(s=>s.id==='maker').member.model==='gpt-6.2-nova'&&persisted.seats.find(s=>s.id==='maker').member.effort==='high','acknowledged role model and effort are persisted');
    await p.reload();await p.locator('[data-crew-person="maker"]').click();ok(await p.locator('[data-crew-edit-model]').inputValue()==='codex/gpt-6.2-nova'&&await p.locator('[data-crew-edit-effort]').inputValue()==='high','saved role model and effort survive a real reload');
    for(const kind of ['403','network']){
      const before=await api();await p.locator('[data-crew-edit-model]').selectOption('codex/gpt-6.1-sol');
      const handler=route=>kind==='403'?route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Fixture permission denied'})}):route.abort('failed');await p.route('**/api/team/change',handler);
      await p.locator('[data-crew-save]').click();await p.waitForFunction(()=>{const b=document.querySelector('[data-crew-save]'),s=document.querySelector('[data-crew-save-status]');return b&&!b.disabled&&s?.textContent.trim()&&!s.textContent.includes('Unsaved changes');});
      ok(await p.locator('[data-crew-edit-model]').inputValue()==='codex/gpt-6.1-sol'&&(await api()).team.hash===before.team.hash,`${kind} failure retains the exact draft without persisting it`);await p.unroute('**/api/team/change',handler);await p.getByRole('button',{name:'Cancel changes',exact:true}).click();
    }
    const beforeConflict=await api();await p.locator('[data-crew-edit-model]').selectOption('codex/gpt-6-astra');
    const concurrent=await p.evaluate(async expected=>{const r=await fetch('/api/team/change',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({change:{kind:'preset',preset:'save'},expected,project:null})});return {status:r.status,body:await r.json()};},beforeConflict.team.hash);ok(concurrent.status===200,'a concurrent actual team change establishes a newer CAS head');
    const conflicted=p.waitForResponse(r=>r.url()===`${base}/api/team/change`&&r.request().method()==='POST');await p.locator('[data-crew-save]').click();const conflict=await conflicted;await p.waitForFunction(()=>document.querySelector('[data-crew-save-status]')?.textContent.includes('team changed'));
    ok(conflict.status()===409&&conflict.request().postDataJSON().expected===beforeConflict.team.hash&&await p.locator('[data-crew-edit-model]').inputValue()==='codex/gpt-6-astra','stale role Save retains its draft and original CAS token instead of silently rebasing');
    ok((await api()).team.hash===concurrent.body.team.hash,'CAS rejection does not overwrite the concurrent team');await p.getByRole('button',{name:'Cancel changes',exact:true}).click();
    // Permission retry must retain the original CAS token, not silently rebase.
    for(const stale of [true,false]){
      const before=await api(),target=before.seats.find(s=>s.id==='maker').member.model==='gpt-6.1-sol'?'codex/gpt-6-astra':'codex/gpt-6.1-sol';await p.locator('[data-crew-edit-model]').selectOption(target);
      const decision=route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'skillDecision',skills:[]})});await p.route('**/api/team/change',decision);await p.locator('[data-crew-save]').click();await p.locator('[data-skill-decide]').waitFor();await p.unroute('**/api/team/change',decision);
      if(stale)await p.evaluate(async expected=>{const r=await fetch('/api/team/change',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({change:{kind:'preset',preset:'quality'},expected,project:null})});if(!r.ok)throw new Error('Concurrent fixture update failed');},before.team.hash);
      const retried=p.waitForResponse(r=>r.url()===`${base}/api/team/change`&&r.request().method()==='POST');await p.locator('[data-decide="scripts"]').click();const response=await retried;
      ok(response.request().postDataJSON().expected===before.team.hash,`permission retry retains its original CAS token (stale=${stale})`);
      if(stale){await p.waitForFunction(()=>document.querySelector('[data-crew-save-status]')?.textContent.includes('team changed'));ok(response.status()===409&&await p.locator('[data-crew-edit-model]').inputValue()===target,'permission retry cannot overwrite a concurrent team and retains its draft');await p.getByRole('button',{name:'Cancel changes',exact:true}).click();}
      else{await p.waitForFunction(()=>!document.querySelector('[data-crew-save]'));ok(response.status()===200&&(await api()).seats.find(s=>s.id==='maker').member.model===target.split('/')[1],'confirmed permission retry persists and clears its own draft');}
    }
    await closeSettings(p);
    // A delayed acknowledgement for Studio defaults cannot replace a newer project view.
    const beforeProject=await api();await p.evaluate(async expected=>{const r=await fetch('/api/team/change',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({change:{kind:'project',project:'shop',seat:'maker',set:{effort:'xhigh'}},expected,project:null})});if(!r.ok)throw new Error('Project fixture setup failed');},beforeProject.team.hash);
    await p.reload();await p.locator('[data-crew-person="maker"]').click();await p.waitForFunction(()=>document.querySelector('[data-crew-edit-model] option[value="codex/gpt-6.2-nova"]'));const beforeDelayed=await api(),target=beforeDelayed.seats.find(s=>s.id==='maker').member.model==='gpt-6.2-nova'?'codex/gpt-6.1-sol':'codex/gpt-6.2-nova';await p.locator('[data-crew-edit-model]').selectOption(target);
    let release,ready;const gate=new Promise(r=>release=r),started=new Promise(r=>ready=r);const delayed=async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response});};await p.route('**/api/team/change',delayed);const acknowledged=p.waitForResponse(r=>r.url()===`${base}/api/team/change`&&r.request().method()==='POST');await p.locator('[data-crew-save]').click();await started;await closeSettings(p);
    const projectResponse=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/team'&&new URL(r.url()).searchParams.get('project')==='shop');await p.locator('[data-team-project]').selectOption('shop');await projectResponse;await workflow(p,'web-prototype');await inspect(p,'design-a');
    const refreshedProject=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/team'&&new URL(r.url()).searchParams.get('project')==='shop');release();await acknowledged;await refreshedProject;await p.unroute('**/api/team/change',delayed);await p.waitForFunction(()=>document.querySelector('[data-team-row="design-a"] select:nth-of-type(3)')?.value==='xhigh'||document.querySelector('[data-team-row="design-a"] [aria-label$="effort"]')?.value==='xhigh');
    ok(await p.locator('[data-team-project]').inputValue()==='shop'&&await p.locator('[data-team-row="design-a"] select').nth(2).inputValue()==='xhigh','late Studio save acknowledgement preserves the current project scope and effective effort');await closeSettings(p);
    // Returning to the same seat must not make an obsolete permission response current again.
    await section(p,'team');await p.locator('[data-crew-person="maker"]').click();const abaBefore=await api(),abaTarget=abaBefore.seats.find(s=>s.id==='maker').member.model==='gpt-6-astra'?'codex/gpt-6.1-sol':'codex/gpt-6-astra';await p.locator('[data-crew-edit-model]').selectOption(abaTarget);
    let releaseAba,startAba;const abaGate=new Promise(r=>releaseAba=r),abaReady=new Promise(r=>startAba=r);const abaHandler=async route=>{startAba();await abaGate;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'skillDecision',skills:[]})});};await p.route('**/api/team/change',abaHandler);const abaResponse=p.waitForResponse(r=>r.url()===`${base}/api/team/change`&&r.request().method()==='POST');await p.locator('[data-crew-save]').click();await abaReady;await closeSettings(p);await p.locator('[data-crew-person="maker"]').click();releaseAba();await abaResponse;await p.evaluate(()=>new Promise(requestAnimationFrame));await p.unroute('**/api/team/change',abaHandler);ok(await p.locator('[data-skill-decide]').count()===0&&await p.locator('[data-crew-drawer]').count()===1,'late permission response cannot resurrect an obsolete decision after reopening the same seat');await closeSettings(p);
    // A delayed permission response must not reopen a drawer after its owner closes.
    await section(p,'team');await p.locator('[data-crew-person="maker"]').click();const beforeLatePermission=await api(),permissionTarget=beforeLatePermission.seats.find(s=>s.id==='maker').member.model==='gpt-6-astra'?'codex/gpt-6.1-sol':'codex/gpt-6-astra';await p.locator('[data-crew-edit-model]').selectOption(permissionTarget);
    let releasePermission,permissionStarted;const permissionGate=new Promise(r=>releasePermission=r),permissionReady=new Promise(r=>permissionStarted=r);const latePermission=async route=>{permissionStarted();await permissionGate;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'skillDecision',skills:[]})});};await p.route('**/api/team/change',latePermission);const permissionResponse=p.waitForResponse(r=>r.url()===`${base}/api/team/change`&&r.request().method()==='POST');await p.locator('[data-crew-save]').click();await permissionReady;await closeSettings(p);
    const switched=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/team'&&!new URL(r.url()).searchParams.has('project'));await p.locator('[data-team-project]').selectOption('');await switched;releasePermission();await permissionResponse;await p.evaluate(()=>new Promise(requestAnimationFrame));await p.unroute('**/api/team/change',latePermission);ok(await p.locator('[data-skill-decide],[data-crew-drawer]').count()===0,'late permission response cannot reopen a closed owner in another project view');
    await workflow(p,'code-firstmate');const last=p.locator('[data-crew-node]').last(),nodeId=await last.getAttribute('data-crew-node');
    for(const close of ['button','Escape','outside']){await last.hover();const before=await p.evaluate(()=>({main:document.querySelector('#main').scrollTop,doc:document.scrollingElement.scrollTop}));await last.click();await p.locator('[data-crew-drawer]').waitFor();if(close==='button')await p.locator('[data-crew-drawer-close]').click();else if(close==='Escape')await p.keyboard.press('Escape');else await p.locator('.tm-crew-backdrop').click({position:{x:2,y:2}});await p.waitForFunction(id=>document.activeElement?.dataset.crewNode===id,nodeId);ok(await p.evaluate(v=>document.querySelector('#main').scrollTop===v.main&&document.scrollingElement.scrollTop===v.doc,before),`${close} returns exact node focus without changing the viewport`);}
    for(let i=0;i<8;i++){await last.hover();const before=await p.evaluate(()=>document.querySelector('#main').scrollTop);await p.evaluate(id=>{document.querySelector(`[data-crew-node="${CSS.escape(id)}"]`).click();document.querySelector('.tm-crew-backdrop').click();},nodeId);await p.waitForFunction(id=>document.activeElement?.dataset.crewNode===id,nodeId);ok(await p.locator('#main').evaluate(el=>el.scrollTop)===before,`rapid open/outside-close cancels stale focus work ${i+1}`);}
    await section(p,'team');await section(p,'workflows');ok(await p.locator('[data-crew-workflow-picker]').inputValue()==='code-firstmate','local view switches retain the selected workflow');
    await p.goto(`${base}/#/team?staffing=shop&workflow=code-firstmate`);await p.locator('[data-team-staffing][open]').waitFor();ok(await p.locator('[data-crew-section="workflows"]').getAttribute('aria-pressed')==='true','staffing deep links enter the workflow view with the original panel open');await section(p,'team');await p.locator('[data-crew-person="maker"]').click();await closeSettings(p);ok(await p.locator('[data-crew-section="team"]').getAttribute('aria-pressed')==='true','ordinary rerenders do not hijack an explicitly selected view');await p.close();
  }

  // a stale page never overwrites a newer team
  const r = await fetch(`${base}/api/team/change`, { method: "POST", headers: { "content-type": "application/json", cookie: `crew_session=${token}`, origin: base, "x-crew-csrf": "1" }, body: JSON.stringify({ change: { kind: "preset", preset: "save" }, expected: "0".repeat(64) }) });
  ok([403, 409].includes(r.status), "a change from a stale view (or without the page's session) is refused", String(r.status));
} catch (e) { ok(false, "crew-page-ui threw", e?.stack ?? String(e)); }
finally { await browser?.close(); if (app.exitCode === null) { const stopped = new Promise((r) => app.once("exit", r)); app.kill("SIGTERM"); await stopped; } rmSync(dir, { recursive: true, force: true }); }
console.log(`\ncrew-page-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
