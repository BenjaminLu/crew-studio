import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// How a run ends, and removing runs, in the pages (docs/units/run-end-and-remove.md):
// one word per run state on Runs, the Board and the run page (en and zh-TW), "Closed without
// merging" never in the success style; Cancel with a reason from a run waiting at its card
// (the card leaves Needs you and the Inbox); Archive, Show archived and Unarchive; Delete with
// the typed id. The runs are made by the runtime harness in a temp data dir, then served by
// a real Studio over that dir. 1440 and 390, light and dark.      bun tests/run-end-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { harness, until, Y } from "./rt-harness.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("run-end-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const root = join(import.meta.dir, "..");
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };

// ---------- the runs: closed, done, waiting at a card (two), failed (two) ----------
const H = await harness([
  Y({ id: "cardy", name: "cardy", roles: [], nodes: [
    { id: "s", kind: "hook", label: "Start", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "q", kind: "card", label: "Ship?", card: { title: { en: "Ship it", "zh-TW": "出貨" }, options: [{ id: "ship", label: "Ship" }, { id: "close", label: "Close without merging", hold: true }] }, x: 1, y: 0 },
    { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed", summary: "closed without merging" }, x: 2, y: 1 }],
    edges: [["s", "q"], ["q", "done", "ship"], ["q", "closed", "close"]] }),
  Y({ id: "faily", name: "faily", roles: [], nodes: [{ id: "b", kind: "hook", label: "Boom", do: "boom", x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["b", "e"]] }),
]);
const E = H.engine; E.actions.boom = () => { throw new Error("boom: the step failed"); };
const card = (run) => E.cards.list({ run, open: true })[0] ?? null;
const startAt = async (title) => { const r = E.start({ workflow: "cardy", text: title, title }); await until(() => !!card(r.id), 8000); return r.id; };
const CLOSED = await startAt("Abandoned at the merge card"); await E.answer(card(CLOSED).id, { choice: "close", by: "captain" });
const DONE = await startAt("Shipped"); await E.answer(card(DONE).id, { choice: "ship", by: "captain" });
const WAIT = await startAt("Waiting at its card");
const WAIT2 = await startAt("Also waiting");
const failRun = async () => { const r = E.start({ workflow: "faily", text: "fails", title: "Failed run" }); await until(() => E.get(r.id).status === "failed", 8000); return r.id; };
const FAILED = await failRun(), FAILED2 = await failRun();
await until(() => ["succeeded"].includes(E.get(CLOSED).status) && E.get(DONE).status === "succeeded", 8000);
H.stop();

const port = await freePort(); const base = `http://127.0.0.1:${port}`;
const fm = join(H.data, "..", `fm-ui-${port}`, "state"); mkdirSync(join(fm, "pending"), { recursive: true });
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: fm, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: H.data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(H.data, "..", `home-ui-${port}`), CREW_MAIN_PROJECT: join(H.data, "..", `proj-ui-${port}`) } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
await waitUp(base, app);
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = join(root, "tests/out/run-end"); mkdirSync(shots, { recursive: true });
const page = async (width, scheme) => { const c = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme }); await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const p = await c.newPage(); p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`)); return p; };
const seen = (p, sel, timeout = 8000, state = "visible") => p.waitForSelector(sel, { timeout, state }).then(() => true, () => false);
const text = (p, sel) => p.textContent(sel).then((t) => (t || "").trim(), () => "");
const color = (p, sel) => p.$eval(sel, (e) => getComputedStyle(e).color).catch(() => "");
const okColor = (p) => p.evaluate(() => { const d = document.createElement("span"); d.style.color = "var(--ok)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
// the text/background contrast of an element as painted: its background is the first opaque one up the tree, and the
// opacity of its ancestors fades its text toward that background
const contrast = (p, sel) => p.$eval(sel, (el) => {
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number); const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let bg = null, op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); op *= Number(cs.opacity); const c = rgb(cs.backgroundColor); if (!bg && (c[3] ?? 1) > 0.5) bg = c.slice(0, 3); }
  bg = bg || [255, 255, 255]; const fg = rgb(getComputedStyle(el).color).slice(0, 3).map((v, i) => bg[i] + (v - bg[i]) * op);
  const [x, y] = [L(fg), L(bg)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }).catch(() => 0);
const varColor = (p, v) => p.evaluate((v) => { const d = document.createElement("span"); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
const stroke = (p, edge) => p.$eval(`[data-edge="${edge}"] .rt-line`, (l) => getComputedStyle(l).stroke).catch(() => "");
// an edge is coloured as walked only when the run took it (the closed run went Ship? → Closed, never Ship? → Done)
const edgesRight = async (p) => { const [ok, neutral] = [await varColor(p, "--ok"), await varColor(p, "--text-3")];
  return { ok: await stroke(p, "q→closed[close]") === ok && await stroke(p, "s→q") === ok && await stroke(p, "q→done[ship]") === neutral, got: [await stroke(p, "s→q"), await stroke(p, "q→closed[close]"), await stroke(p, "q→done[ship]"), ok, neutral] }; };

try {
  const p = await page(1440, "light");
  // ---------- 1. one word per state, on Runs, the Board and the run page; closed never green ----------
  await p.goto(`${base}/#/runs`); await seen(p, `[data-run="${CLOSED}"] [data-run-state]`);
  const words = { [CLOSED]: "Closed without merging", [DONE]: "Done", [WAIT]: "Waiting for you", [FAILED]: "Failed" };
  for (const [id, w] of Object.entries(words)) ok(await text(p, `[data-run="${id}"] [data-run-state]`) === w, `Runs: ${id} reads "${w}"`, await text(p, `[data-run="${id}"] [data-run-state]`));
  const green = await okColor(p);
  { const mark = (k) => p.$eval(`[data-run-state="${k}"] .d`, (d) => { const s = getComputedStyle(d), b = getComputedStyle(d, "::before"); return [s.backgroundColor, s.boxShadow, b.content].join("|"); }).catch(() => "");
    const [cl, ca, dn] = [await mark("closed"), await mark("cancelled").catch(() => ""), await mark("done")];
    ok(/^rgba\(0, 0, 0, 0\)\|/.test(cl) && !/\|none\|/.test(cl) && cl !== dn, "Closed without merging has its own mark: a ring, not the filled dot", JSON.stringify([cl, dn])); }
  // 7: no raw node:state sub-line; plain words instead
  ok(!/\b[\w-]+:(running|pending|waiting|passed)\b/.test(await text(p, ".rt-runs")) && /Waiting for you at Ship\?/.test(await text(p, `[data-run="${WAIT2}"]`)), "the Runs list says where a run is in plain words, never node:state", await text(p, `[data-run="${WAIT2}"]`));
  ok(await color(p, `[data-run="${CLOSED}"] [data-run-state]`) !== green && await color(p, `[data-run="${DONE}"] [data-run-state]`) === green, "Runs: Closed without merging is not in the success colour (Done is)");
  await p.goto(`${base}/#/run/${CLOSED}`); await seen(p, "[data-run-state]");
  { const tl = await text(p, "[data-timeline]");
    ok(/Task: \S.* → Closed without merging/.test(tl) && !/succeeded|running→|pending→|→running|ended at/.test(tl), "the timeline says the run's states in the same words (no raw status), Simple view", tl.slice(0, 300));
    await p.click('[data-view-toggle="detail"]'); await p.waitForTimeout(200);
    ok(/running→succeeded/.test(await text(p, "[data-timeline]")), "Detail view shows the raw transitions");
    await p.click('[data-view-toggle="simple"]'); await p.waitForTimeout(200); }
  ok(await p.locator('[data-node="closed"][data-state="passed"], [data-node="closed"].st-passed').count() === 1, "the run graph shows the end node the run reached (closed), in Simple view");
  { const e = await edgesRight(p); ok(e.ok, "the run graph colours only the edges the run took (Ship? → Done stays neutral on the closed run)", JSON.stringify(e.got)); }
  // the Simple timeline never says a thing twice, and a result reads as a word
  { const lines = await p.$$eval("[data-timeline] .rt-ev", (es) => es.map((e) => e.textContent.replace(/^\S+\s/, "").trim()));
    const esc = (t) => t.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
    const twice = lines.filter((l) => { const m = /^([^:]+): (.*)$/.exec(l); return m && new RegExp("^" + esc(m[1]) + "(?!\\w)", "i").test(m[2]); });
    ok(!twice.length && !lines.some((l) => /→ ok\b/.test(l)) && lines.some((l) => l === "Closed: Finished") && lines.includes("Ship? → Closed"),
      "the Simple timeline says each thing once (no 'X: X…'), a result as a word (Finished), and the edge the run took", JSON.stringify(twice.length ? twice : lines)); }
  { const lines = await p.$$eval("[data-timeline] .rt-ev", (es) => es.map((e) => [!!e.querySelector("b"), e.textContent.replace(/^\S+\s/, "").trim()]));
    ok(lines.every(([b]) => b) && !lines.some(([, l]) => /^Task: started/.test(l)) && lines.some(([, l]) => l === "Ship?: card SC-001 · core/ste-wording failed (1 finding)") && !lines.some(([, l]) => /card:SC-|: fail\b/.test(l)),
      "every timeline row has a bold subject, capitalised words, and a check result in words (card SC-001 · … failed (1 finding))", JSON.stringify(lines.map(([b, l]) => (b ? "" : "NO-SUBJECT ") + l))); }
  ok(!/ r\d\b/.test(await text(p, ".rt-ledger")) && /Ship\?, round 1/.test(await text(p, ".rt-ledger")), "the evidence ledger spells out where an entry comes from (node name, round), in Simple view", await text(p, ".rt-ledger"));
  ok(await p.evaluate(() => { const a = document.querySelector("[data-runview] .phead p a"); const d = document.createElement("span"); d.style.color = "var(--accent-text)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return !!a && getComputedStyle(a).color === c; }), "the workflow link uses the project's link colour");
  ok(await text(p, "[data-runview] [data-run-state]") === "Closed without merging" && await color(p, "[data-runview] [data-run-state]") !== green, "the run page reads Closed without merging, not in the success colour");
  await p.goto(`${base}/#/workflows/cardy`); await seen(p, `[data-overlay-run="${CLOSED}"]`, 10000, "attached");
  { const o = await text(p, `[data-overlay-run="${CLOSED}"]`); ok(/Closed without merging/.test(o) && !/succeeded/.test(o), "the workflow's run picker names the run's state in the same words (no raw status)", o); }
  await p.goto(`${base}/#/board`); await seen(p, `[data-ended-run="${CLOSED}"]`, 10000);
  ok(await text(p, `[data-ended-run="${CLOSED}"] [data-run-state]`) === "Closed without merging" && await color(p, `[data-ended-run="${CLOSED}"] [data-run-state]`) !== green, "the Board lists the closed run under Ended with the same word, not green");
  ok(await text(p, `[data-run="${WAIT}"] .badge`) === "Waiting for you", "the Board's badge for a run at its card reads Waiting for you", await text(p, `[data-run="${WAIT}"] .badge`));
  await p.evaluate(() => setLang("zh-TW")); await p.waitForTimeout(300);
  const zhB = await text(p, `[data-ended-run="${CLOSED}"] [data-run-state]`);
  await p.goto(`${base}/#/runs`); await seen(p, `[data-run="${CLOSED}"] [data-run-state]`); const zhR = await text(p, `[data-run="${CLOSED}"] [data-run-state]`);
  await p.goto(`${base}/#/run/${CLOSED}`); await seen(p, "[data-run-state]"); const zhP = await text(p, "[data-runview] [data-run-state]");
  ok(zhB === "未合併就關閉" && zhR === zhB && zhP === zhB, "zh-TW: the same word on the Board, Runs and the run page", JSON.stringify([zhB, zhR, zhP]));
  ok(/未合併就關閉/.test(await text(p, "[data-timeline]")), "zh-TW: the timeline uses the same word");
  await p.evaluate(() => setLang("en"));

  // ---------- 2. cancel at a card, with a reason: the card leaves Needs you and the Inbox ----------
  const wcard = card(WAIT)?.id;
  await p.goto(`${base}/#/board`); ok(await seen(p, `[data-need="${wcard}"]`, 10000), "before: the waiting run's card is in Needs you");
  await p.goto(`${base}/#/run/${WAIT}`); await seen(p, "[data-run-cancel]");
  await p.click("[data-run-cancel]"); await seen(p, "[data-cancel-reason]");
  await p.fill("[data-cancel-reason]", "the captain changed course"); await p.click("[data-cancel-confirm]");
  ok(await p.waitForFunction(() => document.querySelector("[data-runview] [data-run-state]")?.textContent?.trim() === "Cancelled", null, { timeout: 8000 }).then(() => true, () => false)
    && /the captain changed course/.test(await text(p, "[data-runview] .phead")), "Cancel on a run waiting at its card ends it Cancelled, with the reason shown");
  { const m = await p.$eval('[data-runview] [data-run-state="cancelled"] .d', (d) => getComputedStyle(d, "::before").content).catch(() => "none");
    ok(m && m !== "none" && m !== "normal", "Cancelled has its own mark", m); }
  await p.goto(`${base}/#/board`); await p.waitForTimeout(800);
  ok(await p.locator(`[data-need="${wcard}"]`).count() === 0, "its card left the Board's Needs you");
  await p.goto(`${base}/#/inbox`); await p.waitForTimeout(800);
  ok(await p.locator(`[data-scard="${wcard}"]`).count() === 0, "its card left the Inbox");

  // ---------- 3. archive, show archived, unarchive ----------
  await p.goto(`${base}/#/run/${FAILED}`); await seen(p, "[data-run-archive]");
  await p.click("[data-run-archive]"); await p.waitForTimeout(400);
  await p.goto(`${base}/#/runs`); await seen(p, `[data-run="${CLOSED}"]`);
  ok(await p.locator(`[data-run="${FAILED}"]`).count() === 0, "Archive hides the failed run from the default Runs list");
  await p.goto(`${base}/#/board`); await p.waitForTimeout(800);
  ok(await p.locator(`[data-run="${FAILED}"], [data-ended-run="${FAILED}"]`).count() === 0 && await p.locator(`[data-run="${FAILED2}"]`).count() === 1, "and from the Board (another failed run stays)");
  await p.goto(`${base}/#/runs`); await seen(p, "[data-show-archived]"); await p.check("[data-show-archived]");
  ok(await seen(p, `[data-run="${FAILED}"] [data-archived]`), "Show archived lists it, marked archived");
  await p.click(`[data-run="${FAILED}"] [data-run-unarchive]`); await p.waitForTimeout(400); await p.uncheck("[data-show-archived]"); await p.waitForTimeout(400);
  ok(await p.locator(`[data-run="${FAILED}"]`).count() === 1 && await p.locator(`[data-run="${FAILED}"] [data-archived]`).count() === 0, "Unarchive restores it to the default list");
  await p.goto(`${base}/#/run/${FAILED}`); await seen(p, "[data-timeline]");
  { const tl = await text(p, "[data-timeline]"); ok(/Unarchived/.test(tl) && (tl.match(/Archived/g) || []).length === 1, "the timeline says Archived once and Unarchived once", tl.slice(0, 200)); }
  { const lines = await p.$$eval("[data-timeline] .rt-ev", (es) => es.map((e) => e.textContent.replace(/^\S+\s/, "").trim()));
    ok(!lines.some((l) => /^Boom: Boom/.test(l)) && lines.some((l) => /^Boom: boom: the step failed$/.test(l)), "a failed node's line names the node once", JSON.stringify(lines));
    ok(lines.filter((l) => /^Boom: .*fail/i.test(l)).length === 1 && lines.filter((l) => /^Task: Started/.test(l)).length === 1, "one failure row for the failed node, and one Task: Started row", JSON.stringify(lines));
    ok(!lines.some((l) => /^Task: (\S+) → \1$/.test(l)), "no run row moves from a state to the same state", JSON.stringify(lines)); }
  ok(await text(p, "[data-ledger-state]") === "No entries yet", "an empty evidence ledger reads No entries yet", await text(p, "[data-ledger-state]"));
  await p.evaluate(() => setLang("zh-TW")); await p.waitForTimeout(200);
  { const tl = await text(p, "[data-timeline]"); ok(/已封存/.test(tl) && /已取消封存/.test(tl), "and in zh-TW", tl.slice(0, 200)); }
  await p.evaluate(() => setLang("en"));
  ok(await p.locator(`[data-run="${WAIT2}"] [data-run-archive], [data-run="${WAIT2}"] [data-run-delete]`).count() === 0, "a live run offers neither archive nor delete");
  await p.goto(`${base}/#/run/${WAIT2}`); await seen(p, "[data-run-cancel]");
  ok(await p.locator("[data-run-archive], [data-run-delete]").count() === 0, "nor does its run page");

  // ---------- 4. delete with the typed id ----------
  await p.goto(`${base}/#/run/${FAILED2}`); await seen(p, "[data-run-delete]");
  await p.click("[data-run-delete]"); await seen(p, "[data-delete-confirm-id]");
  ok(await p.inputValue("[data-delete-confirm-id]") === "" && (await p.getAttribute("[data-delete-confirm-id]", "placeholder") || "") !== FAILED2 && new RegExp(`Type ${FAILED2}`).test(await text(p, "[data-delete-hint]")),
    "the confirm field starts empty, with the hint Type <id> (the id is not a placeholder to copy)");
  ok(await p.isDisabled("[data-delete-confirm]"), "Delete for good is disabled while the field is empty");
  await p.fill("[data-delete-confirm-id]", "R-000");
  ok(await p.isDisabled("[data-delete-confirm]") && p.url().endsWith(`#/run/${FAILED2}`), "and stays disabled with a wrong id");
  await p.fill("[data-delete-confirm-id]", FAILED2);
  ok(!(await p.isDisabled("[data-delete-confirm]")), "it is enabled once the typed id matches");
  await p.click("[data-delete-confirm]");
  ok(await p.waitForFunction(() => location.hash === "#/runs", null, { timeout: 5000 }).then(() => true, () => false), "the right id deletes it and goes back to Runs");
  await p.waitForTimeout(500);
  ok(await p.locator(`[data-run="${FAILED2}"]`).count() === 0 && (await (await fetch(`${base}/api/wruns/${FAILED2}`)).status) === 404, "the deleted run is gone");
  await p.context().close();

  // ---------- 7. Runs and the run pages at 1440 and 390, light and dark (the failed run archived for its captures) ----------
  { const q = await page(1440, "light"); await q.goto(`${base}/#/runs`); await q.evaluate((id) => fetch(`/api/wruns/${id}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true }) }), FAILED); await q.context().close(); }
  const fabClear = (q) => q.evaluate(() => { const fab = document.querySelector("#chatFab"); if (!fab || getComputedStyle(fab).display === "none") return true; const m = document.querySelector("#main"); m.scrollTop = m.scrollHeight; document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
    const f = fab.getBoundingClientRect(); const last = [...document.querySelectorAll("#view .page > *, #view > *")].filter((e) => e.getBoundingClientRect().height).at(-1); if (!last) return true;
    const b = last.getBoundingClientRect(); return b.bottom <= f.top - 40 || b.right <= f.left || b.left >= f.right; });
  const rowsAt = {};
  const big = (q, sel) => q.$$eval(sel, (es) => es.length > 0 && es.every((e) => e.getBoundingClientRect().height >= 44));
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const q = await page(width, scheme); const tag = `${width} ${scheme}`;
    const shot = async (name) => { await q.evaluate(() => document.body.classList.add("chat-closed")); await q.waitForTimeout(300);
      ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} at ${tag}: no sideways scroll`);
      ok(await fabClear(q), `${name} at ${tag}: the firstmate button covers nothing at the bottom`);
      if (width === 390) await q.screenshot({ path: join(shots, `${name}-${width}-${scheme}-end.png`) }); // the end of the page, as a phone shows it, with the firstmate button
      await q.evaluate(() => { document.querySelector("#main").scrollTop = 0; document.scrollingElement.scrollTop = 0; document.querySelector("#chatFab").style.visibility = "hidden"; });
      await q.screenshot({ path: join(shots, `${name}-${width}-${scheme}.png`), fullPage: true }); // a full-page capture would paint the fixed button mid-page
      await q.evaluate(() => { document.querySelector("#chatFab").style.visibility = ""; }); };
    await q.goto(`${base}/#/run/${WAIT2}`); await seen(q, "[data-run-cancel]"); await shot("run-waiting");
    await q.click("[data-run-cancel]"); await seen(q, "[data-cancel-reason]");
    await q.fill("[data-cancel-reason]", "the captain changed course"); await shot("run-cancel-reason");
    if (width === 390) ok(await big(q, ".rt-endpanel .btn"), `cancel form at ${tag}: its actions are 44 px targets`);
    await q.goto(`${base}/#/run/${WAIT}`); await seen(q, '[data-run-state="cancelled"]'); await shot("run-cancelled");
    ok(/the captain changed course/.test(await text(q, "[data-runview] .phead")), `cancelled run at ${tag}: the supplied reason remains visible`);
    await q.goto(`${base}/#/runs`); await seen(q, `[data-run="${CLOSED}"]`); await shot("runs");
    ok(await q.$eval(".rt-runs", (e) => getComputedStyle(e).overflow).catch(() => "") === "hidden", `runs at ${tag}: the list card clips its rows to its rounded corners`);
    if (width === 390) ok(await big(q, "label:has([data-show-archived])"), `runs at ${tag}: Show archived is a 44 px target`);
    await q.check("[data-show-archived]"); await seen(q, `[data-run="${FAILED}"] [data-archived]`); await shot("runs-archived");
    if (width === 390) ok(await big(q, "[data-run-unarchive]"), `runs at ${tag}: Unarchive is a 44 px target`);
    ok(await contrast(q, `[data-run="${FAILED}"] [data-archived]`) >= 4.5 && await contrast(q, `[data-run="${FAILED}"] [data-run-state]`) >= 4.5, `runs at ${tag}: the Archived pill and the state pill of an archived row reach AA (4.5:1)`, String(await contrast(q, `[data-run="${FAILED}"] [data-archived]`)));
    ok(await q.$eval(`[data-run="${FAILED}"] [data-archived]`, (e) => e.classList.contains("badge") && !/mono/i.test(getComputedStyle(e).fontFamily.split(",")[0])).catch(() => false), `runs at ${tag}: Archived is a status pill in the UI font, not a code chip`);
    ok(await q.evaluate((id) => { const mid = (e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; }; const u = document.querySelector(`[data-run="${id}"] [data-run-unarchive]`), c = document.querySelector(`[data-run="${id}"] [data-archived]`);
      return !!u && !!c && Math.abs(mid(u) - mid(c)) <= 4 && !u.classList.contains("ghost"); }, FAILED), `runs at ${tag}: Unarchive is a small secondary button, in line with the chips`);
    await q.goto(`${base}/#/run/${CLOSED}`); await seen(q, "[data-run-state]"); await shot("run-closed");
    ok(await q.evaluate(() => { const svg = document.querySelector(".rt-rungraph svg"); const vb = svg.viewBox.baseVal; return [...svg.querySelectorAll(".rt-line")].every((l) => { const b = l.getBBox(); return b.x >= vb.x + 16 && b.x + b.width <= vb.x + vb.width - 16; }); }), `run graph at ${tag}: connectors stay inside the card's padding`);
    if (width === 390) ok(await q.evaluate(() => { const c = document.querySelector(".rt-rungraph"), svg = c.querySelector("svg"); return svg.getBoundingClientRect().right <= c.getBoundingClientRect().right - 1 && c.scrollWidth <= c.clientWidth + 1; }),
      `run graph at ${tag}: the graph fits the card, so a wrapping connector is seen inside the card, not cut at its edge`);
    { const e = await edgesRight(q); ok(e.ok, `run graph at ${tag}: only the edges taken are coloured`, JSON.stringify(e.got)); }
    rowsAt[tag] = await q.$$eval("[data-timeline] .rt-ev", (es) => es.map((e) => e.textContent.replace(/^\S+\s/, "").trim()));
    ok(await q.evaluate(() => ["q→done[ship]", "q→closed[close]"].every((k) => { const l = document.querySelector(`[data-label="${k}"]`); return !!l && /ship|close/.test(l.textContent); })),
      `run graph at ${tag}: each edge out of Ship? keeps its label (ship, close)`);
    await q.goto(`${base}/#/run/${FAILED}`); await seen(q, "[data-run-unarchive-page], [data-run-archive]"); await shot("run-archived");
    ok(await q.locator("[data-runview] [data-archived]").count() === 1 && /Unarchive/.test(await text(q, "[data-run-archive]")), `run page at ${tag}: the archived marker and Unarchive`);
    if (width === 390) { ok(await big(q, "[data-runview] .phead .actions .btn"), `run page at ${tag}: its buttons are 44 px targets`);
      ok(await q.evaluate(() => { const a = document.querySelector("[data-run-archive]").getBoundingClientRect(), d = document.querySelector("[data-run-delete]").getBoundingClientRect(); const z = document.querySelector("[data-danger-zone]");
        return !!z && (d.top >= a.bottom + 8 || d.left - a.right >= 16); }), `run page at ${tag}: Delete sits apart from Archive`); }
    await q.click("[data-run-delete]"); await seen(q, "[data-delete-confirm-id]"); await shot("run-delete-confirm");
    ok(await q.$eval(".rt-endpanel p", (e) => { const px = parseFloat(getComputedStyle(e).fontSize); return e.getBoundingClientRect().width <= px * 40; }), `delete confirm at ${tag}: the explanation is capped near 65 characters a line`);
    await q.fill("[data-delete-confirm-id]", FAILED); ok(!(await q.isDisabled("[data-delete-confirm]")), `delete confirm at ${tag}: typed, Delete for good is enabled`);
    ok(await contrast(q, "[data-delete-confirm]") >= 4.5, `delete confirm at ${tag}: the enabled Delete for good reaches AA (4.5:1)`, String(await contrast(q, "[data-delete-confirm]")));
    await shot("run-delete-confirm-typed");
    for (const [name, hash, sel] of [["board", "#/board", "#needs"], ["inbox", "#/inbox", ".page"]]) { await q.goto(`${base}/${hash}`); await seen(q, sel); await q.evaluate(() => document.body.classList.add("chat-closed")); await q.waitForTimeout(400);
      ok(await fabClear(q), `${name} at ${tag}: the firstmate button covers nothing at the bottom`); }
    await q.context().close();
  }
  { const all = Object.values(rowsAt).map((l) => JSON.stringify(l)); ok(all.length === 4 && new Set(all).size === 1, "the closed run's timeline has the same rows at 1440 and 390, light and dark (no narrow-layout cap)", JSON.stringify(Object.fromEntries(Object.entries(rowsAt).map(([k, l]) => [k, l.length])))); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nrun-end-ui: ${pass} passed, ${fail} failed${fail ? "\n" + appLog.slice(-1500) : ""}`);
process.exit(fail ? 1 : 0);
