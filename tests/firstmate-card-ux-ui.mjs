import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Firstmate's cards read like cards, not dumps (E2E F1, F3, F4, F9): the staffing confirmation card shows a
// role table (role, provider, model, effort, skill) with its hashes in a closed details and says when the
// reviewer is not independent of the worker; a dispatch card shows its parameters as key/value lines and keeps
// Studio's internal _-prefixed pins (the _staffing hash) in a closed details, for the older JSON body and the
// current one; the chat box has an accessible name.      node tests/firstmate-card-ux-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("firstmate-card-ux-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-fmcard-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(join(data, "cards"), { recursive: true });
const P1 = "寫一份文件：「Crew Studio 新手三分鐘上手」，給第一次打開 Studio 的同事看。", P2 = "內容照先前草稿的方向：開頭點出「Studio 的工作都要你按確認才會開始」。";
const HASH = "c89c8e781426d0af49059d9ae785ffd44f26e401a82edd9cb4e3daf48645ba45";
const sec = (intent, why, how) => ({ intent, why, scope: { in: [], out: [] }, done: [], beforeAfter: "", how, glossary: [] });
const card = (id, run, kind, title, body, intent) => ({ id, run, node: kind === "permission" ? "confirm" : "dispatch", visit: 1, kind, title: { en: title, "zh-TW": title },
  sections: { en: sec(intent, "No work has started.", "Approve, or keep discussing."), "zh-TW": sec(intent, "工作尚未開始。", "核准，或繼續討論。") }, body,
  options: [{ id: "approve", label: "Approve", primary: true }, { id: "close", label: "Close", hold: true }], confirmDoor: false, door: null, links: [], detail: null, captainOnly: true,
  workflow: "firstmate-proposal", runTitle: title, ledger: null, ste: null, status: "open", createdAt: "2026-10-17T09:00:00.000Z", answer: null });
const skill = (role) => ({ ref: `pack:firstmate/skills/${role}.md`, version: 1, sha256: "a".repeat(64), snapshotSha256: "b".repeat(64) });
const role = (r, effort) => ({ provider: "codex", model: "gpt-6.1-sol", effort, skill: skill(r) });
const configuration = { schema: 1, algorithm: "sha256-canonical-v1", project: { namespace: "git", id: "sandbox", identity: "d".repeat(64) }, workflow: { id: "code-firstmate", version: 8, sha256: "e".repeat(64) },
  roles: { coordinator: role("firstmate", "low"), worker: role("worker", "low"), reviewer: role("reviewer", "medium"), designer: role("designer", "medium") }, review: { freshContexts: 1, distinctProviders: false },
  nodes: { build: { model: "gpt-6.1-max", effort: "high", skills: [{ ref: "skill:plain-writing", version: 1, sha256: "a".repeat(64), snapshotSha256: "a".repeat(64) }] } } };
const cards = [
  card("SC-901", "R-901", "permission", "Confirm role models", JSON.stringify({ configuration, existingTask: null }, null, 2), "Approve this project-local agent configuration"),
  // the body R-057 had: parameters as one JSON line, the _staffing pin among them
  card("SC-902", "R-902", "dispatch", "Start this work?", `Workflow / 工作流程: code-firstmate v8\nParameters / 參數: {"project":"sandbox","base":"main","_staffing":"${HASH}"}\nProject / 專案: sandbox\n\nAdd EUR to format()\n\nOnly your approval starts this exact pinned work. / 只有你的核准會啟動這項已鎖定的工作。`, "Add EUR to format()"),
  // the body src/firstmate.ts writes now: key/value lines, the internal pins last
  card("SC-903", "R-903", "dispatch", "Start this work?", `Workflow / 工作流程: code-firstmate v8\nParameters / 參數:\n  project: sandbox\n  base: main\nProject / 專案: sandbox\n\nAdd EUR to format()\n\nOnly your approval starts this exact pinned work. / 只有你的核准會啟動這項已鎖定的工作。\n\nInternal pins / 內部鎖定:\n  _staffing: ${HASH}`, "Add EUR to format()"),
  // S6: a Documents dispatch whose body repeats the captain's intent (two paragraphs) under "Parameters / 參數: —"
  card("SC-904", "R-904", "dispatch", "Start this work?", `Workflow / 工作流程: documents v5\nParameters / 參數: —\n\n${P1}\n\n${P2}`, `${P1} ${P2}`),
];
for (const c of cards) writeFileSync(join(data, "cards", `${c.id}.json`), JSON.stringify(c, null, 1));
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const at = (id) => `[data-inbox-studio] [data-scard="${id}"]`;
try {
  for (const lang of ["en", "zh-TW"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript((l) => { try { localStorage.setItem("crew.lang", l); } catch {} }, lang);
    // ---------- F4 / F3: the staffing card ----------
    await p.goto(`${base}/#/inbox/SC-901`); await p.waitForSelector(`${at("SC-901")} [data-staffing-table]`, { timeout: 15000 });
    const rows = await p.$$eval(`${at("SC-901")} [data-staffing-role]`, (trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent)));
    ok(rows.length === 4 && rows.find((r) => r[0] === "reviewer")?.join("|") === "reviewer|codex|gpt-6.1-sol|medium|reviewer.md v1", `${lang}: the staffing card shows one row per role: provider, model, effort, skill and version`, JSON.stringify(rows));
    const nodeRows = await p.$$eval(`${at("SC-901")} [data-staffing-node]`, (trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent)));
    ok(nodeRows.length === 1 && nodeRows[0].slice(2).join("|") === "gpt-6.1-max|high|plain-writing v1" && nodeRows[0][0].includes("build"), `${lang}: a node override is a row in the role table: its model, effort and named skills`, JSON.stringify(nodeRows));
    // a named skill opens the read-only skill viewer at the pinned version (public/skills.js)
    const views = await p.$$eval(`${at("SC-901")} [data-staffing-table] [data-skill-view]`, (bs) => bs.map((b) => [b.tagName, b.dataset.skillView, b.dataset.skillPinned, b.getAttribute("aria-label")]));
    ok(views.some(([t, k, v, l]) => t === "BUTTON" && k === "role:code-firstmate/reviewer" && v === "1" && l === (lang === "en" ? "View skill: reviewer.md v1" : "查看技能：reviewer.md v1"))
      && views.some(([t, k, v]) => t === "BUTTON" && k === "plain-writing" && v === "1"), `${lang}: each skill in the role table is a button that opens the skill viewer at its pin`, JSON.stringify(views));
    await p.click(`${at("SC-901")} [data-staffing-node] [data-skill-view="plain-writing"]`);
    ok(await p.waitForFunction(() => document.querySelector('[role="dialog"][data-skill-viewer="plain-writing"]')?.getAttribute("data-skv-shown") === "1", null, { timeout: 8000 }).then(() => true, () => false),
      `${lang}: the node's skill opens plain-writing v1 in the viewer`);
    await p.keyboard.press("Escape");
    ok(await p.evaluate(() => !document.querySelector("[data-skill-viewer]") && document.activeElement?.getAttribute("data-skill-view") === "plain-writing"), `${lang}: Esc closes it and the focus returns to the card's skill`);
    const shown = await p.$eval(at("SC-901"), (el) => [...el.querySelectorAll("[data-card-root] > *")].filter((x) => !x.matches("details")).map((x) => x.innerText).join("\n"));
    ok(!/sha256|"configuration"|aaaaaaaa/.test(shown), `${lang}: no hash or raw JSON outside the closed details`, shown.slice(0, 300));
    ok(await p.$eval(`${at("SC-901")} [data-card-raw]`, (d) => !d.open && d.textContent.includes('"sha256"')), `${lang}: the configuration hashes stay in a closed details`);
    ok(/reviewer, designer/.test(await p.textContent(`${at("SC-901")} [data-staffing-independence]`) || "") || (lang !== "en" && /reviewer、designer/.test(await p.textContent(`${at("SC-901")} [data-staffing-independence]`) || "")),
      `${lang}: the card says the reviewer and designer are not independent of the worker`);
    // ---------- F9: dispatch cards, the older JSON body and the current one ----------
    for (const id of ["SC-902", "SC-903"]) {
      await p.goto(`${base}/#/inbox/${id}`); await p.waitForSelector(`${at(id)} [data-card-params]`, { timeout: 15000 });
      const kv = await p.$eval(`${at(id)} [data-card-params]`, (dl) => [...dl.querySelectorAll("dt")].map((dt) => `${dt.textContent}=${dt.nextElementSibling.textContent}`).join(","));
      ok(kv === "project=sandbox,base=main", `${lang} ${id}: the dispatch card lists its parameters as key/value lines without _staffing`, kv);
      const visible = await p.$eval(at(id), (el) => [...el.querySelectorAll("[data-card-root] > *")].filter((x) => !x.matches("details")).map((x) => x.innerText).join("\n"));
      ok(!visible.includes(HASH) && !visible.includes("_staffing") && !visible.includes('{"project"'), `${lang} ${id}: no raw JSON or internal hash on the card face`, visible.slice(0, 400));
      ok(await p.$eval(`${at(id)} [data-card-raw]`, (d, h) => !d.open && d.textContent.includes(`_staffing`) && d.textContent.includes(h), HASH), `${lang} ${id}: the internal pin stays readable in a closed details`);
    }
    // ---------- S6: the intent shows once; no empty parameters section ----------
    await p.goto(`${base}/#/inbox/SC-904`); await p.waitForSelector(`${at("SC-904")} [data-sec="intent"]`, { timeout: 15000 });
    const face = await p.$eval(at("SC-904"), (el) => [...el.querySelectorAll("[data-card-root] > *")].filter((x) => !x.matches("details")).map((x) => x.innerText).join("\n"));
    const times = (t) => face.split(t).length - 1;
    ok(times(P1.slice(0, 20)) === 1 && times(P2.slice(0, 20)) === 1, `${lang} SC-904: the dispatch card shows the captain's intent once, not again in the body box`, face.slice(0, 600));
    ok(face.includes("documents v5") && await p.locator(`${at("SC-904")} [data-sec="params"]`).count() === 0, `${lang} SC-904: the workflow line stays; a dispatch with no parameters shows no empty Parameters section`, face.slice(0, 600));
    ok(!/legacy adapter|Read-only:|唯讀：/.test(await p.locator("[data-inbox-sub]").innerText()) && (await p.locator("[data-inbox-sub]").innerText()).includes(lang === "en" ? "Decisions waiting on you" : "等你決定的事"), `${lang}: the Inbox subtitle says what the page is for, not an internal adapter state`, await p.locator("[data-inbox-sub]").innerText());
    // ---------- F1: the chat box has an accessible name ----------
    const name = lang === "en" ? "Message Firstmate" : "傳訊息給 Firstmate";
    ok(await p.getByRole("textbox", { name }).count() === 1, `${lang}: the Firstmate chat box is a textbox named "${name}" in the accessibility tree`);
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-3000)); }
await browser.close(); app.kill();
console.log(`\nfirstmate-card-ux-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
