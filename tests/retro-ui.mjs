import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The retro's R1 pages in the browser: #/improve → Candidates (the default rows, the other signals folded, × to dismiss),
// a merged pull request's go-live timeline and its rollback / incident note, and the quick note (記問題, the ! key) on the
// pull request, review room and Task pages: the full-width ！ an input method types opens it; ! typed in a field, during a
// composition or with a dialog open does not. At 1440 and 390, light and dark, English and 繁體中文: no console error, no
// sideways scroll, no request leaving this machine.   node tests/retro-ui.mjs   (RETRO_SHOTS=<dir> keeps screenshots)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("retro-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-retroui-"));
const fmRoot = join(tmp, "fm"), state = join(fmRoot, "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(join(data, "retro"), { recursive: true }); mkdirSync(join(data, "pr-watch"), { recursive: true });
// Studio's log: the fixture's events moved to end an hour ago (the candidate list looks back from now)
const lines = readFileSync(join(here, "fixture/retro/studio-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const shift = Date.now() - 3600e3 - Math.max(...lines.map((e) => Date.parse(e.ts)));
writeFileSync(join(data, "events.jsonl"), lines.map((e) => JSON.stringify({ ...e, ts: new Date(Date.parse(e.ts) + shift).toISOString(), ...(e.data?.mergedAt ? { data: { ...e.data, mergedAt: new Date(Date.parse(e.data.mergedAt) + shift).toISOString() } } : {}) })).join("\n") + "\n");
writeFileSync(join(data, "retro", "state.json"), JSON.stringify({ schema: 1, seq: 2, dismissed: {}, notes: {
  "N-1": { id: "N-1", at: new Date().toISOString(), text: "rolled back: the limits check failed in prod", trust: "captain", by: "captain", kind: "incident", pr: "northwind/checkout-api#41" },
  "N-2": { id: "N-2", at: new Date().toISOString(), text: "staging deploy said done but prod never moved", trust: "captain", by: "captain", kind: "note", route: "#/prs", ref: "northwind/checkout-api#43" } } }));
// the pull request list: two merged rows Studio follows (41 live, 42 partly live in prod)
const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const pod = (service, on, tag) => ({ service, repository: "northwind/infra", path: `prod/${service}.yaml`, tag, on });
const mrow = (n, envs, mergedAt) => ({ id: `northwind/checkout-api#${n}`, repo: "northwind/checkout-api", number: n, url: `https://github.com/northwind/checkout-api/pull/${n}`, title: n === 41 ? "Limits check on checkout" : "Retry the payment webhook", author: "ada-fixture",
  single: false, base: "main", mergedAt, mergeSha: "b".repeat(40), envs, deps: [], body: "", partial: [], ops: [] });
writeFileSync(join(data, "pr-watch", "snapshot.json"), JSON.stringify({ schema: 1, at: at(0.5), me: "ada-fixture", rows: [], errors: [], single: {}, depState: {}, proposal: { deps: [], hints: [] }, changed: {}, finger: {}, heads: {},
  merged: [mrow(41, [{ name: "staging", production: false, on: true }, { name: "prod", production: true, on: true }], new Date(Date.parse(lines.find((e) => e.type === "pr_merged").data.mergedAt) + shift).toISOString()),
    mrow(42, [{ name: "staging", production: false, on: true }, { name: "prod", production: true, on: true, pods: [pod("api", true, "v2.1.0-1a2b3c4"), pod("worker", false, "v2.0.3-9f9f9f9")] }], at(60))] }));
writeFileSync(join(data, "pr-watch", "state.json"), JSON.stringify({ schema: 1, watch: { repos: ["northwind/checkout-api"], prs: [], excluded: [] }, shipped: {}, retired: [], emitted: {
  "northwind/checkout-api#41": { merged: "x", envs: { prod: "live" } }, "northwind/checkout-api#42": { merged: "x", envs: { staging: "live", prod: "partial" } } } }));
const port = await freePort();
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [], offbox = [];
const page = async (width, scheme, lang = "en") => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  await ctx.addInitScript((l) => { try { localStorage.setItem("crew.labs", "1"); localStorage.setItem("crew.lang", l); } catch {} }, lang);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offbox.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${width}/${scheme}: ${m.text()}`); });
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = process.env.RETRO_SHOTS || null; if (shots) mkdirSync(shots, { recursive: true });
const shot = async (p, name) => { if (shots) await p.screenshot({ path: join(shots, `${name}.png`) }); };

try {
  // ---------- the candidates tab ----------
  for (const [width, scheme, lang] of [[1440, "light", "en"], [1440, "dark", "zh-TW"], [390, "light", "zh-TW"], [390, "dark", "en"]]) {
    const p = await page(width, scheme, lang);
    await p.goto(`${base}/#/improve/candidates`);
    await p.locator("[data-cand]").first().waitFor({ timeout: 10000 });
    const keys = await p.locator("[data-cand]").evaluateAll((xs) => xs.map((x) => x.dataset.cand));
    if (width === 1440 && scheme === "light") {
      ok(keys.includes("pr.rollback|northwind/checkout-api#41") && keys.includes("pr.partial-24h|northwind/checkout-api#42") && keys.filter((k) => k.startsWith("room.timeout|")).length === 3 && keys.includes("note.captain|N-2"), "Candidates: the rollback, the partial rollout, one room why in 3 rooms, the note", keys.join(" "));
      ok(!keys.some((k) => k.startsWith("run.transient")) && await p.locator("[data-cand-other]").count() === 1 && !(await p.locator("[data-cand-other]").evaluate((d) => d.open)), "an isolated timeout is not a row; the other signals are folded");
      ok(await p.locator('[data-cand="pr.rollback|northwind/checkout-api#41"]').innerText().then((t) => t.includes("limits check failed")), "the rollback row shows the captain's line");
      ok(await p.locator('[data-improve-tab="candidates"][aria-current="page"]').count() === 1, "the Candidates tab is current");
    }
    if (lang === "zh-TW") ok(await p.locator('[data-improve-tab="candidates"]').innerText().then((t) => t.includes("候選")), `the tab reads 候選 (${width}/${scheme})`);
    ok(await noHScroll(p), `Candidates: no sideways scroll at ${width}/${scheme}/${lang}`);
    await shot(p, `after-candidates-${width}-${scheme}-${lang}`);
    if (width === 1440 && scheme === "light") {
      await p.locator('[data-cand-dismiss="room.timeout|C-202"]').click();
      await p.locator('[data-cand="room.timeout|C-202"]').waitFor({ state: "detached", timeout: 5000 });
      ok(await p.locator('[data-cand-dismissed-key="room.timeout|C-202"]').count() === 1 && await p.locator('[data-cand="room.timeout|C-201"]').count() === 1, "× dismisses that class|group only, and it is listed as not needed");
    }
    await p.context().close();
  }
  // ---------- a merged pull request: its timeline and an incident ----------
  for (const [width, scheme, lang] of [[1440, "light", "en"], [1440, "dark", "zh-TW"], [390, "light", "zh-TW"], [390, "dark", "en"]]) {
    const p = await page(width, scheme, lang);
    await p.goto(`${base}/#/prs`);
    await p.locator('[data-prs-tab="live"]').click({ timeout: 10000 });
    await p.locator('[data-prs-ship-menu="northwind/checkout-api#41"]').click({ timeout: 8000 });
    await p.locator('[data-prs-menu] [data-prs-action="timeline"]').click();
    await p.locator('[data-prs-timeline] [data-prs-tl="pr_incident"]').first().waitFor({ timeout: 8000 });
    const tl = await p.locator("[data-prs-tl]").evaluateAll((xs) => xs.map((x) => `${x.dataset.prsTl}${x.dataset.env ? `:${x.dataset.env}` : ""}`));
    if (width === 1440 && scheme === "light") ok(tl.join(",") === "pr_merged,pr_live:prod,pr_incident" && (await p.locator('[data-prs-tl="pr_live"]').innerText()).includes("after the merge"), "the timeline: merge → prod live (time since the merge) → the rollback", tl.join(","));
    ok(await noHScroll(p), `timeline: no sideways scroll at ${width}/${scheme}/${lang}`);
    await shot(p, `after-timeline-${width}-${scheme}-${lang}`);
    await p.keyboard.press("Escape");
    if (width === 1440 && scheme === "light") {
      await p.locator('[data-prs-ship-menu="northwind/checkout-api#41"]').click();
      await p.locator('[data-prs-menu] [data-prs-action="incident"]').click();
      await p.locator('[data-prs-incident-kind="incident"]').click();
      await p.locator("[data-prs-incident-note]").fill("checkout 500s for ten minutes after the deploy");
      await shot(p, `after-incident-${width}-${scheme}-${lang}`);
      await p.locator("[data-prs-incident-note]").press("Enter");
      await p.locator('[data-prs-dialog="incident"]').waitFor({ state: "detached", timeout: 5000 });
      const tl2 = await (await fetch(`${base}/api/prs/timeline?pr=${encodeURIComponent("northwind/checkout-api#41")}`)).json();
      ok(tl2.events.at(-1).type === "pr_incident" && tl2.events.at(-1).kind === "incident" && tl2.events.at(-1).note === "checkout 500s for ten minutes after the deploy", "Rollback / incident… writes pr_incident with the captain's line", JSON.stringify(tl2.events.at(-1)));
    }
    await p.context().close();
  }
  // ---------- the quick note ----------
  for (const [width, scheme, lang] of [[1440, "light", "zh-TW"], [1440, "dark", "en"], [390, "light", "en"], [390, "dark", "zh-TW"]]) {
    const p = await page(width, scheme, lang);
    await p.goto(`${base}/#/prs`);
    await p.locator("[data-qnote-open]").waitFor({ timeout: 10000 });
    if (width === 1440 && scheme === "light") ok((await p.locator("[data-qnote-open]").innerText()).includes("記問題"), "the PR page's header has 記問題（!）");
    await p.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    // the full-width ！ an input method types, with no field focused
    await p.evaluate(() => { document.activeElement?.blur?.(); dispatchEvent(new KeyboardEvent("keydown", { key: "！", bubbles: true, cancelable: true })); });
    await p.locator("[data-qnote]").waitFor({ timeout: 3000 }).catch(() => {});
    if (width === 1440 && scheme === "light") ok(await p.locator("[data-qnote]").count() === 1 && await p.evaluate(() => document.activeElement?.matches("[data-qnote-input]")), "！ (an input method's full-width) opens the note, focused");
    await p.locator("[data-qnote-input]").fill(lang === "en" ? "the release brief named the wrong tag" : "上線 brief 寫錯 tag");
    ok(await noHScroll(p), `note: no sideways scroll at ${width}/${scheme}/${lang}`);
    await shot(p, `after-note-${width}-${scheme}-${lang}`);
    if (width === 1440 && scheme === "light") {
      await p.locator("[data-qnote-input]").press("Escape");
      ok(await p.locator("[data-qnote]").count() === 0, "Esc cancels");
      await p.keyboard.press("Shift+Digit1");
      await p.locator("[data-qnote-input]").waitFor({ timeout: 3000 });
      await p.locator("[data-qnote-chip-x]").click();
      await p.locator("[data-qnote-input]").fill("上線 brief 寫錯 tag");
      await p.locator("[data-qnote-input]").press("Enter");
      await p.locator("[data-qnote-saved]").waitFor({ timeout: 5000 });
      const st = JSON.parse(readFileSync(join(data, "retro", "state.json"), "utf8")), n = Object.values(st.notes).find((x) => x.text === "上線 brief 寫錯 tag");
      ok(!!n && n.route === null && n.by === "captain", "! then Enter saves the captain's words; the removed chip leaves the page out", JSON.stringify(n));
      await p.locator("[data-qnote-undo]").click();
      await new Promise((r) => setTimeout(r, 400));
      ok(!JSON.parse(readFileSync(join(data, "retro", "state.json"), "utf8")).notes[n.id], "the toast's Undo takes the note back");
      // not while composing, nor with a dialog open
      await p.evaluate(() => dispatchEvent(new KeyboardEvent("keydown", { key: "！", isComposing: true, bubbles: true, cancelable: true })));
      ok(await p.locator("[data-qnote]").count() === 0, "not during an input method's composition");
      await p.locator('[data-prs-tab="live"]').click(); await p.locator('[data-prs-ship-menu="northwind/checkout-api#41"]').click(); await p.locator('[data-prs-menu] [data-prs-action="incident"]').click();
      await p.locator('[data-prs-dialog="incident"]').waitFor();
      await p.evaluate(() => { document.activeElement?.blur?.(); dispatchEvent(new KeyboardEvent("keydown", { key: "!", bubbles: true, cancelable: true })); });
      ok(await p.locator("[data-qnote]").count() === 0, "not with a dialog open");
    }
    await p.context().close();
  }
  // the review room: ! typed in its field is text; the room's own keys are untouched; ! elsewhere opens the note
  {
    const p = await page(1440, "light", "en");
    await p.goto(`${base}/#/room`);
    await p.locator("[data-qnote-open]").waitFor({ timeout: 10000 });
    const field = p.locator("#view [data-pr-url], #view input[type=search], #view input[type=text], #view textarea").first();
    await field.waitFor({ timeout: 8000 }); await field.click(); await p.keyboard.type("why!");
    ok(await p.locator("[data-qnote]").count() === 0 && (await field.inputValue()).endsWith("!"), "! typed in the review room's field stays text, no note", await field.inputValue());
    await field.press("Escape").catch(() => {});
    await p.evaluate(() => { document.activeElement?.blur?.(); dispatchEvent(new KeyboardEvent("keydown", { key: "!", bubbles: true, cancelable: true })); });
    ok(await p.locator("[data-qnote]").count() === 1, "! outside a field on the review room page opens the note");
    await shot(p, "after-note-room-1440-light-en");
    await p.context().close();
  }
  // other pages: no button, no shortcut
  {
    const p = await page(1440, "light", "en");
    await p.goto(`${base}/#/improve`); await p.locator("[data-improve-tab]").first().waitFor({ timeout: 10000 });
    await p.evaluate(() => dispatchEvent(new KeyboardEvent("keydown", { key: "!", bubbles: true, cancelable: true })));
    ok(await p.locator("[data-qnote-open]").count() === 0 && await p.locator("[data-qnote]").count() === 0, "elsewhere (Improve): no 記問題 button and ! does nothing");
    await p.context().close();
  }
  ok(!errors.length, "no console errors", errors.join("\n"));
  ok(!offbox.length, "no request left this machine", offbox.join(", "));
} catch (e) { fail++; console.log(`  FAIL  ${e?.stack ?? e}\n${appLog.slice(-3000)}`); }
finally { await browser.close(); app.kill(); }
console.log(`\nretro-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
