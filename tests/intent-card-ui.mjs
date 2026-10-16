import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The intent-aligned merge card on the page (unit intent-merge-card): R-002's merge
// card, rebuilt from the fixture of its real records, renders every section, the done
// lines with their proof, the walk of the diff mapped to done lines, and zh-TW; the
// merge button says what is missing until every intent line is ticked. Then a live
// stub run's merge card shows that the server refuses a merge without the ticks, in the
// Inbox and on the run page, and takes it with them. Screenshots 1440 and 390, light
// and dark.      node tests/intent-card-ui.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("intent-card-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-icui-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
const fx = spawnSync("bun", ["tests/intent-card-fixture.ts", data, "SC-900"], { cwd: root, encoding: "utf8" });
if (fx.status !== 0) { console.error(fx.stderr); process.exit(1); }
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
env.CREW_SESSION_TOKEN = process.env.CREW_SESSION_TOKEN ??= "test-session";
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp,
  // the app captures (unit visual-sandbox) use the real renderer; the test's HOME hides the browser cache
  ...(process.env.PLAYWRIGHT_MODULE ? { CREW_PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME, "Library/Caches/ms-playwright") } : {}) } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out"); mkdirSync(shots, { recursive: true });
const SECTIONS = ["intent", "why", "scope", "done", "before-after", "how", "walk", "door", "review", "gates", "cost"];
const CARD = '[data-inbox-studio] [data-scard="SC-900"]';
// the page scrolls inside its main column: grow the viewport to the card's height, shoot the card, restore
const shootCard = async (p, path) => { const vp = p.viewportSize(); const hgt = await p.$eval(CARD, (e) => e.getBoundingClientRect().height);
  await p.setViewportSize({ width: vp.width, height: Math.ceil(hgt) + 600 }); await p.waitForTimeout(150); await p.locator(CARD).screenshot({ path }); await p.setViewportSize(vp); };
try {
  // ---------- R-002's merge card from the fixture, in the Inbox, 1440 light ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); } catch {} });
    await p.goto(`${base}/#/inbox/SC-900`); await p.waitForSelector(`${CARD} [data-sec="walk"]`, { timeout: 15000 });
    const secs = await p.$$eval(`${CARD} [data-sec]`, (els) => els.map((e) => e.dataset.sec));
    ok(SECTIONS.every((s) => secs.includes(s)), "the merge card shows every section: intent, why, scope, done, before/after, how, walk, door, review, gates, cost", JSON.stringify(secs));
    ok((await p.textContent(`${CARD} [data-intent-text]`)).includes('format(1235, "JPY") should give "¥1,235"'), "the intent section quotes the captain's own sentence");
    const proofs = await p.$$eval(`${CARD} [data-done]`, (els) => els.map((e) => ({ ci: e.querySelector('[data-proof="firstmate/ci"]')?.textContent ?? "", ff: e.querySelector('[data-proof="firstmate/fail-first"]')?.textContent ?? "", links: e.querySelectorAll("[data-evidence]").length })));
    ok(proofs.length === 4 && proofs.every((x) => /ledger #29/.test(x.ci) && /@ 8a8f29c7/.test(x.ci) && /ledger #30/.test(x.ff) && x.links === 4), "each done line shows its proof: CI #29 and fail-first #30 at the head, with evidence links", JSON.stringify(proofs));
    ok(/shows whole yen with a thousands separator/.test(proofs[0].ff), "done line 1's fail-first proof names the test that was red on base");
    const walk = await p.$$eval(`${CARD} [data-walk]`, (els) => els.map((e) => ({ id: e.dataset.walk, done: [...e.querySelectorAll("[data-serves-done]")].map((c) => Number(c.dataset.servesDone)) })));
    ok(walk.length === 6 && walk.filter((w) => w.id.startsWith("test/")).map((w) => w.done.join("+")).join(",") === "0,1,2,3" && walk.find((w) => w.id.startsWith("src/")).done.length === 4, "the walk lists six hunks; each new test maps to its done line", JSON.stringify(walk));
    await p.click(`${CARD} [data-walk="test/format.test.ts:10"] summary`);
    ok(/format\(1235, "JPY"\)\)\.toBe\("¥1,235"\)/.test(await p.textContent(`${CARD} [data-walk="test/format.test.ts:10"] .cc-diff`)), "opening a walk item shows its diff lines");
    // the intent ticks: the merge button says what is missing until every line is ticked
    ok((await p.getAttribute(`${CARD} [data-option="merge"]`, "data-ready")) === "false" && /0 of 3/.test(await p.textContent(`${CARD} [data-tick-count]`)), "with no tick the merge button is marked as not ready (0 of 3)");
    await p.check(`${CARD} [data-intent-tick="0"]`); await p.check(`${CARD} [data-intent-tick="1"]`);
    ok(await p.$eval(`${CARD} [data-walk="test/format.test.ts:10"]`, (d) => d.open), "an opened walk item stays open while the captain ticks");
    ok((await p.getAttribute(`${CARD} [data-option="merge"]`, "data-ready")) === "false" && /2 of 3/.test(await p.textContent(`${CARD} [data-tick-count]`)), "two of three ticked: still not ready");
    ok((await p.getAttribute(`${CARD} [data-option="close"]`, "data-ready")) === "true", "a hold option (close) needs no ticks");
    await p.check(`${CARD} [data-intent-tick="2"]`);
    ok((await p.getAttribute(`${CARD} [data-option="merge"]`, "data-ready")) === "true", "every line ticked: the merge button is ready");
    await shootCard(p, join(shots, "intent-card-r002-1440-light.png"));
    // zh-TW: the card's own toggle; every line translated, nothing marked untranslated
    await p.click(`${CARD} [data-card-lang="zh-TW"]`);
    const zh = await p.textContent(CARD);
    ok(/完成條件與證明/.test(zh) && /逐段看 diff/.test(zh) && /回傳 "¥1,235"/.test(zh) && /現有的美元（USD）輸出必須維持不變/.test(zh) && (await p.locator(`${CARD} [data-untranslated]`).count()) === 0, "zh-TW renders real translations: headings, done lines, intent lines; none marked untranslated");
    ok((await p.locator(`${CARD} [data-intent-tick]:checked`).count()) === 3, "switching language keeps the ticks");
    await shootCard(p, join(shots, "intent-card-r002-1440-light-zh.png"));
    await ctx.close(); }
  // ---------- 1440 dark and 390 light and dark ----------
  for (const [width, scheme] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/inbox/SC-900`); await p.waitForSelector(`${CARD} [data-sec="walk"]`, { timeout: 15000 });
    await p.click(`${CARD} [data-walk="src/money.ts:13"] summary`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const secs = await p.$$eval(`${CARD} [data-sec]`, (els) => els.length);
    await p.screenshot({ path: join(shots, `intent-card-r002-${width}-${scheme}-page.png`) }); await shootCard(p, join(shots, `intent-card-r002-${width}-${scheme}.png`));
    ok(sw && secs >= SECTIONS.length, `R-002's merge card renders at ${width} ${scheme} with no sideways scroll`);
    await ctx.close(); }
  // ---------- a live stub run: the server refuses a merge without the ticks ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/runs`);
    const INTENT = ["Add a percent function to money-kit, and keep the existing money functions unchanged",
      "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
      'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
    const call = (u, b) => p.evaluate(async ([u, b]) => { const r = await fetch(u, b === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [u, b]);
    // code-firstmate itself only starts for a registered project with an approved staffing configuration
    // (src/domain/staffing.ts installStaffingGuard, tests/firstmate-staffing.ts); the merge card under test comes
    // from the code domain, so the run uses the same graph under its own id, which the staffing guard does not
    // cover, and runs on the stub provider over the built-in sandbox project
    { const wdir = join(data, "workflows"), src = join(wdir, "code-firstmate");
      const latest = readdirSync(src).filter((f) => /^v\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5))).at(-1);
      const def = JSON.parse(readFileSync(join(src, latest), "utf8"));
      mkdirSync(join(wdir, "code-intent-card"), { recursive: true });
      writeFileSync(join(wdir, "code-intent-card", "v1.json"), JSON.stringify({ ...def, id: "code-intent-card", name: "Code (intent-card fixture)", version: 1, parent: null, by: "intent-card-ui test", note: "a copy of code-firstmate", diff: null, seed: undefined })); }
    const run = (await call("/api/wruns", { workflow: "code-intent-card", text: INTENT, params: {} })).j; const rid = run.id;
    const waitKind = async (kind, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const cs = (await call("/api/scards?open=1")).j.cards || []; const c = cs.find((c) => c.run === rid && c.kind === kind); if (c && c.ste) return c; await p.waitForTimeout(500); } return null; };
    const disp = await waitKind("dispatch", 120000); ok(!!disp, "the stub run raises its dispatch card", rid);
    await call(`/api/scards/${disp.id}/answer`, { choice: "dispatch" });
    const mc = await waitKind("merge", 180000);
    ok(!!mc && mc.detail && mc.detail.intents.length === 2 && mc.detail.walk.some((w) => w.file === "test/percent.test.ts" && w.serves.done.length), "the run's merge card carries the detail: its intent lines and a walk whose test hunk serves a done line", JSON.stringify(mc?.detail?.walk?.map((w) => [w.id, w.serves])));
    ok(mc.detail.writer === "fallback" && [mc.detail.intents, mc.detail.done.map((d) => d.text)].flat().every((l) => l.untranslated), "with the stub coordinator the zh-TW lines (done lines included) are marked untranslated, not filled with a placeholder");
    ok(mc.sections["zh-TW"].done.length > 0 && mc.sections["zh-TW"].done.every((t) => t.endsWith("（未翻譯）")) && !/船長要求的變更/.test(mc.sections["zh-TW"].why), "the card's zh-TW sections mark the untranslated done lines too", JSON.stringify(mc.sections["zh-TW"].done));
    // the Inbox: the server's refusal shows inline
    await p.goto(`${base}/#/inbox/${mc.id}`); await p.waitForSelector(`[data-inbox-studio] [data-align="${mc.id}"]`, { timeout: 15000 });
    await p.click(`[data-inbox-studio] [data-scard="${mc.id}"] [data-option="merge"]`);
    ok(await p.waitForFunction((id) => /tick every intent line as met \(0 of 2\)/.test(document.querySelector(`[data-inbox-studio] [data-scard="${id}"] [role=status]`)?.textContent ?? ""), mc.id, { timeout: 10000 }).then(() => true, () => false),
      "Inbox: Merge with no tick is refused by the server, and the refusal shows on the card");
    const direct = await call(`/api/scards/${mc.id}/answer`, { choice: "merge", aligned: [0] });
    ok(direct.status === 400 && /1 of 2/.test(direct.j.error), "the answer route itself refuses a merge with one of two lines ticked", JSON.stringify(direct));
    // the run page: tick both lines, merge, the run reaches merged
    await p.goto(`${base}/#/run/${rid}`); await p.waitForSelector(`[data-runview] [data-align="${mc.id}"]`, { timeout: 15000 });
    // the app's before / after captures sit inside the before/after section: pictures side by side, the changed text, Open the app
    await p.waitForSelector(`[data-scard="${mc.id}"] [data-sec="before-after"] [data-captures] img`, { timeout: 15000 }).catch(() => {});
    const capInfo = await p.$eval(`[data-scard="${mc.id}"] [data-sec="before-after"]`, (sec) => ({ figs: sec.querySelectorAll("[data-capture]").length, imgs: [...sec.querySelectorAll("[data-captures] img")].map((i) => i.complete && i.naturalWidth > 0),
      pairs: [...sec.querySelectorAll(".cc-cap-pair")].map((pr) => { const [a, b] = pr.querySelectorAll("[data-capture-side]"); const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.abs(ra.top - rb.top) < 2 && rb.left > ra.left; }),
      text: sec.querySelectorAll("[data-capture-changed], .cc-cap p").length, app: sec.querySelector('[data-card-link="Open the app"]')?.getAttribute("href") ?? null }));
    ok(mc.captures?.length === 2 && capInfo.figs === 2 && capInfo.imgs.length === 4 && capInfo.imgs.every(Boolean) && capInfo.pairs.every(Boolean) && capInfo.text === 2 && /\/after\/index\.html$/.test(capInfo.app ?? ""),
      "the merge card's before/after section holds the app captures side by side (they load), the changed text under each, and Open the app", JSON.stringify([mc.captures?.length, capInfo]));
    await p.locator(`[data-scard="${mc.id}"] [data-sec="before-after"]`).scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, "intent-card-captures-1440-light.png") });
    await p.check(`[data-scard="${mc.id}"] [data-intent-tick="0"]`); await p.check(`[data-scard="${mc.id}"] [data-intent-tick="1"]`);
    await p.waitForTimeout(1200); // live updates re-render the run page: the ticks must survive them
    ok((await p.locator(`[data-scard="${mc.id}"] [data-intent-tick]:checked`).count()) === 2, "run page: the ticks survive the page's live re-renders");
    await p.screenshot({ path: join(shots, "intent-card-run-1440-light.png") });
    await p.click(`[data-scard="${mc.id}"] [data-option="merge"]`);
    await p.waitForSelector('[data-run-status="succeeded"]', { timeout: 120000 }).catch(() => {});
    const saved = JSON.parse(readFileSync(join(data, "cards", `${mc.id}.json`), "utf8"));
    ok(saved.answer?.choice === "merge" && JSON.stringify(saved.answer.aligned) === "[0,1]", "run page: with both lines ticked the merge is taken and the ticks are recorded", JSON.stringify(saved.answer));
    ok(await p.locator('[data-run-status="succeeded"]').count() === 1, "the run reaches merged");
    // the evidence route: a listed file is served; an unlisted file, a ".." path and a symlink out of the folder are refused
    const led = (await call(`/api/wruns/${rid}`)).j.ledger || []; const ci = led.filter((e) => e.check === "firstmate/ci").at(-1);
    const ev = (file) => p.evaluate(async ([u]) => { const r = await fetch(u); return { status: r.status, text: await r.text() }; }, [`/api/wruns/${rid}/evidence?seq=${ci.seq}&file=${encodeURIComponent(file)}`]);
    const listed = await ev("out/shard-1.log");
    ok(listed.status === 200 && listed.text.length > 0, "the evidence route serves a file its ledger entry lists", JSON.stringify([ci?.seq, ci?.evidence, listed.status]));
    ok((await ev("out/other.log")).status === 404, "the evidence route refuses a file the entry does not list");
    ok((await ev("../../ledger.jsonl")).status === 404 && (await ev("out/../../ledger.jsonl")).status === 404, "the evidence route refuses a .. path");
    const evDir = readdirSync(join(data, "evidence", rid)).map((d) => join(data, "evidence", rid, d)).find((d) => d.endsWith("-ci") && existsSync(join(d, "out", "shard-1.log")));
    const outside = join(tmp, "outside-secret.txt"); writeFileSync(outside, "SECRET OUTSIDE THE EVIDENCE FOLDER");
    rmSync(join(evDir, "out", "shard-1.log")); symlinkSync(outside, join(evDir, "out", "shard-1.log"));
    const sym = await ev("out/shard-1.log");
    ok(sym.status === 404 && !sym.text.includes("SECRET"), "the evidence route refuses a listed file that is a symlink out of the entry's folder", JSON.stringify(sym));
    // the run folder's /file route: the same symlink class
    const spec = join(data, "runs", rid, "spec.md"); rmSync(spec); symlinkSync(outside, spec);
    const fr = await p.evaluate(async ([u]) => { const r = await fetch(u); return { status: r.status, text: await r.text() }; }, [`/api/wruns/${rid}/file?path=spec.md`]);
    ok(fr.status === 404 && !fr.text.includes("SECRET"), "the run's /file route refuses a symlink out of the run folder", JSON.stringify(fr));
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-3000)); }
await browser.close(); app.kill();
console.log(`\nintent-card-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
