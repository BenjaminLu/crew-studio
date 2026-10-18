import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// An Inbox answer goes to the card it was written on, and a click that cannot send says why (the SC-160 incident: on the
// image acceptance card "Request changes" did nothing, and the video card's note later answered the image card).
// Typing a note or ticking a line used to rebuild the whole card: every button was replaced under the captain's hand,
// so a press spanning the rebuild, or a reference to the button taken before typing (a browser tool's page snapshot),
// clicked nothing and said nothing. Here, at 1440 with the Firstmate panel open (the compact rail):
//   - a button reference taken before typing still answers its own card, with that card's own text, and the next card's
//     note (put into its box without an input event, as a tool's fill does) answers the next card only;
//   - a click that cannot send says why beside the buttons, moves the focus to what is missing, and sends nothing;
//     nothing is remembered and sent later;
//   - a refusal from the server shows on the card; a second click while one answer is in flight shows "Sending…".
// The cards are served to the page (its /api/scards calls), so the test owns them and every request the page sends.
//      node tests/inbox-answer-binding-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("inbox-answer-binding-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
const tmp = mkdtempSync(join(tmpdir(), "crew-inboxbind-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
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

// ---------- the incident's cards: two acceptance cards (image, video), each with one intent line ----------
const at = (m) => new Date(Date.parse("2026-10-18T05:00:00Z") + m * 60000).toISOString();
const card = (n, run, workflow, title, options, { kind = "acceptance", format = "image", intents = 1 } = {}) => ({ id: `SC-${n}`, run, node: "accept", visit: 1, kind,
  title: { en: title, "zh-TW": title }, sections: { en: { why: "One version is ready for your review." }, "zh-TW": { why: "有 1 個版本等你審查。" } }, body: "One version is ready for your review.",
  options, confirmDoor: false, door: null, links: [], workflow, runTitle: title, ledger: null, ste: null, status: "open", createdAt: at(n - 150), answer: null,
  detail: { intent: { en: title, "zh-TW": title }, intents: Array.from({ length: intents }, () => ({ en: title, "zh-TW": title })), why: [], how: [], scope: { in: [], out: [] },
    done: [{ text: { en: "Every delivered source passes its check", "zh-TW": "通過檢查" }, proved: true, proofs: [{ check: "core/artifact-ready", seq: 2, verdict: "pass", head: "x", detail: "", evidence: [] }] }],
    beforeAfter: { text: { en: "", "zh-TW": "" }, stat: "", images: [] }, door: null, review: null, cost: null, gates: [], design: null, walk: [], run, head: "x", base: null, writer: "coordinator",
    artifactAcceptance: { kind: format === "file-plan" ? "file-plan" : "artifact", offered: format === "file-plan" ? [] : [{ id: `out-${run}`, n: 1, sha256: "a".repeat(64), format, producer: "draft" }], review: { node: "accept", round: 1, attempt: 1 } } } });
const ACCEPT = [{ id: "approve-draft", label: "Approve v1", labelZh: "核准版本 1", primary: true }, { id: "changes", label: "Request changes", labelZh: "要求修改", note: true, noteLabel: "What to change", noteLabelZh: "要改什麼", hold: true },
  { id: "reject", label: "Reject", labelZh: "不採用", hold: true }];
const IMAGE = "轉角書店社群主視覺", VIDEO = "轉角書店15秒宣傳片";
const IMAGE_NOTE = "畫面左上角加上店名「轉角書店」，字體安靜典雅。", VIDEO_NOTE = "本週選書請寫出三本書名，和網站上的一致：《日常的練習》《沿著山的方向》《一人餐桌》。其他保持不變。".repeat(2);
// the server's own rules (src/runtime/cards.ts), so a client that sends what it should not is refused, as on the live server
const serve = async (ctx, cards, { refuse = {}, slow = {} } = {}) => { const answers = [];
  await ctx.route(/\/api\/scards(\/[^?]*)?(\?.*)?$/, async (r) => { const u = new URL(r.request().url()); const m = /^\/api\/scards\/(SC-\d+)(?:\/(answer))?$/.exec(u.pathname);
    if (m?.[2] === "answer") { const b = r.request().postDataJSON(); answers.push({ id: m[1], ...b }); const c = cards.find((x) => x.id === m[1]);
      if (!c) return r.fulfill({ status: 400, json: { error: "no such open card" } });
      if (refuse[c.id]) return r.fulfill({ status: 400, json: { error: refuse[c.id] } });
      const o = c.options.find((x) => x.id === b.choice), n = c.detail?.intents?.length || 0, note = String(b.note ?? "").trim(), met = (b.aligned || []).filter((i) => i >= 0 && i < n).length;
      if (o?.note && !note) return r.fulfill({ status: 400, json: { error: `write it first: ${o.noteLabel}` } });
      if (n && !o?.hold && met !== n && !note) return r.fulfill({ status: 400, json: { error: `tick every intent line as met (${met} of ${n}), or write a note` } });
      if (slow[c.id]) await new Promise((res) => setTimeout(res, slow[c.id]));
      cards.splice(cards.indexOf(c), 1); return r.fulfill({ json: { ...c, status: "answered", answer: { choice: b.choice, note: b.note ?? null, by: "captain", at: new Date().toISOString() } } }); }
    if (m) { const c = cards.find((x) => x.id === m[1]); return c ? r.fulfill({ json: c }) : r.fulfill({ status: 404, json: { error: "no such card" } }); }
    return r.fulfill({ json: { cards } }); });
  return answers; };
const open = async (cards, o) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const answers = await serve(ctx, cards, o);
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.lang", "zh-TW"); } catch {} });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/#/inbox`); await p.waitForSelector("[data-scard]", { timeout: 15000 }); await p.waitForTimeout(300);
  return { ctx, p, answers };
};
const sel = (id, s) => `[data-inbox-studio] [data-scard="${id}"] ${s}`;
const shown = (p) => p.getAttribute("[data-inbox-studio] [data-scard]", "data-scard");
const msgOf = (p, id) => p.textContent(sel(id, "[data-card-msg]")).catch(() => "");
// the reason is on screen and sits right under the buttons (not at the far end of a long card)
const visibleMsg = (p, id) => p.evaluate((id) => { const m = document.querySelector(`[data-scard="${id}"] [data-card-msg]`), a = document.querySelector(`[data-scard="${id}"] .cc-actions`);
  if (!m || !a || !m.getClientRects().length) return null; const r = m.getBoundingClientRect(), q = a.getBoundingClientRect(); return { text: m.textContent, near: r.top >= q.bottom - 1 && r.top - q.bottom < 80 }; }, id);
const focused = (p) => p.evaluate(() => { const a = document.activeElement; return a ? [a.closest("[data-scard]")?.dataset.scard || "", a.dataset.noteFor || (a.hasAttribute("data-intent-tick") ? "tick" : a.tagName)].join(":") : ""; });
// a press on the button the captain (or a tool) had found; when that button is gone from the page, nothing happens
const press = (h) => h.click({ timeout: 2500 }).then(() => true, () => false);

try {
  // ---------- the incident: the image card, then the video card ----------
  { const cards = [card(160, "R-084", "images", IMAGE, ACCEPT), card(162, "R-086", "video", VIDEO, ACCEPT, { format: "video" })];
    const { ctx, p, answers } = await open(cards);
    ok(await shown(p) === "SC-160" && await p.evaluate(() => !document.body.classList.contains("chat-closed")), "1440 with the Firstmate panel open: the image card (oldest) is shown");
    // Request changes with no note: says why beside the buttons, moves the focus to the note box, sends nothing
    await p.click(sel("SC-160", '[data-option="changes"]')); await p.waitForTimeout(300);
    const why = await visibleMsg(p, "SC-160");
    ok(answers.length === 0 && why && /要求修改：要改什麼/.test(why.text) && why.near && await focused(p) === "SC-160:changes",
      "Request changes with no note: no request, the reason shows right under the buttons, the focus is in its note box", JSON.stringify({ answers, why, f: await focused(p) }));
    // the references a tool's page snapshot holds (or the button under the captain's press), taken before typing
    const noteA = await p.$(sel("SC-160", '[data-note-for="changes"]')), changesA = await p.$(sel("SC-160", '[data-option="changes"]'));
    await noteA.fill(IMAGE_NOTE);
    ok(await changesA.evaluate((b) => b.isConnected), "typing the note keeps the card's buttons: the Request changes button found before typing is still on the page");
    ok(await msgOf(p, "SC-160") === "", "typing clears the reason");
    const landed = await press(changesA);
    await p.waitForFunction(() => document.querySelector("[data-inbox-studio] [data-scard]")?.dataset.scard === "SC-162", null, { timeout: 5000 }).catch(() => {});
    ok(landed && answers.length === 1 && answers[0].id === "SC-160" && answers[0].choice === "changes" && answers[0].note === IMAGE_NOTE,
      "that click answers the image card, with the image card's own note", JSON.stringify({ landed, answers }));
    // the next card: selected by the answer, or from the rail when the click did not land
    if (await shown(p) !== "SC-162") { await p.click('[data-inbox-row="SC-162"]'); await p.waitForTimeout(300); }
    ok(await shown(p) === "SC-162", "the video card is shown next");
    const noteB = await p.$(sel("SC-162", '[data-note-for="changes"]')), changesB = await p.$(sel("SC-162", '[data-option="changes"]'));
    // a long value goes in as a tool's fill puts it: the value set without keystrokes (here: no input event at all)
    await noteB.evaluate((t, v) => { t.focus(); t.value = v; }, VIDEO_NOTE);
    ok(await press(changesB), "the video card's Request changes button takes the click");
    await p.waitForTimeout(500);
    const img = answers.filter((a) => a.id === "SC-160"), vid = answers.filter((a) => a.id === "SC-162");
    ok(!img.some((a) => a.note === VIDEO_NOTE), "the image card is never answered with the video card's note", JSON.stringify(answers));
    ok(vid.length === 1 && vid[0].choice === "changes" && vid[0].note === VIDEO_NOTE, "the video card is answered with the text in its own box (what the captain sees is what is sent)", JSON.stringify(answers));
    ok(answers.length === 2, "exactly two answers, one per card: nothing earlier was remembered and sent later", JSON.stringify(answers.map((a) => a.id)));
    await ctx.close(); }

  // ---------- a file-organization plan card: no primary option, one intent line to tick (SC-170) ----------
  { const FILE = "整理示範資料夾";
    const cards = [card(170, "R-090", "file-organization", FILE, [{ id: "apply", label: "Apply moves", labelZh: "套用搬移" }, { id: "discard", label: "Discard", labelZh: "捨棄", hold: true }], { format: "file-plan" })];
    const { ctx, p, answers } = await open(cards);
    const apply = (await p.textContent(sel("SC-170", '[data-option="apply"]'))).trim();
    ok(apply === `套用搬移 · ${FILE}`, "the plan card's first button names its Task", apply);
    await p.click(sel("SC-170", '[data-option="apply"]')); await p.waitForTimeout(300);
    const why = await visibleMsg(p, "SC-170");
    ok(answers.length === 0 && why && /請勾完每一條意圖（0\/1）/.test(why.text) && why.near && await focused(p) === "SC-170:tick",
      "Apply before ticking: nothing is sent, the reason shows under the buttons and the focus goes to the unticked line", JSON.stringify({ answers, why, f: await focused(p) }));
    const applyBtn = await p.$(sel("SC-170", '[data-option="apply"]'));
    await p.check(sel("SC-170", '[data-intent-tick="0"]'));
    ok(/1\/1/.test(await p.textContent(sel("SC-170", "[data-tick-count]"))) && await p.getAttribute(sel("SC-170", '[data-option="apply"]'), "data-ready") === "true" && await msgOf(p, "SC-170") === "",
      "ticking the line updates the count and the button in place and clears the reason");
    ok(await applyBtn.evaluate((b) => b.isConnected), "ticking keeps the Apply button found before the tick");
    ok(await press(applyBtn), "that Apply button takes the click");
    await p.waitForTimeout(500);
    ok(answers.length === 1 && answers[0].id === "SC-170" && answers[0].choice === "apply" && JSON.stringify(answers[0].aligned) === "[0]", "Apply sends the plan card's answer with the ticked line (0-based)", JSON.stringify(answers));
    ok(await p.locator('[data-inbox-row="SC-170"]').count() === 0, "the answered plan card leaves the Inbox");
    await ctx.close(); }

  // ---------- a refusal from the server shows on the card; a second click while one is in flight says Sending… ----------
  { const Q = [{ id: "warm", label: "Warm", labelZh: "暖色", primary: true }, { id: "cool", label: "Cool", labelZh: "冷色" }];
    const cards = [card(180, "R-091", "brand-kit", "夜市海報", Q, { kind: "question", intents: 0 }), card(181, "R-092", "brand-kit", "豆花海報", Q, { kind: "question", intents: 0 })];
    const { ctx, p, answers } = await open(cards, { refuse: { "SC-180": "this card's run has moved on; reload the Inbox" }, slow: { "SC-181": 1500 } });
    await p.click(sel("SC-180", '[data-option="warm"]'));
    ok(await p.waitForFunction(() => /run has moved on/.test(document.querySelector('[data-scard="SC-180"] [data-card-msg]')?.textContent || ""), null, { timeout: 5000 }).then(() => true, () => false)
      && (await visibleMsg(p, "SC-180"))?.near && await shown(p) === "SC-180", "a refused answer shows the server's reason on the card, under the buttons, and the card stays", await msgOf(p, "SC-180"));
    await p.click('[data-inbox-row="SC-181"]'); await p.waitForTimeout(300);
    await p.click(sel("SC-181", '[data-option="cool"]'));
    ok(await p.waitForSelector(sel("SC-181", "[data-card-sending]"), { timeout: 1000 }).then(() => true, () => false) && /送出中/.test(await p.textContent(sel("SC-181", "[data-card-sending]"))),
      "while the answer is in flight the card says Sending…");
    await p.click(sel("SC-181", '[data-option="warm"]'), { force: true, timeout: 1000 }).catch(() => {});
    await p.waitForTimeout(1800);
    ok(answers.filter((a) => a.id === "SC-181").length === 1 && answers.find((a) => a.id === "SC-181").choice === "cool", "a second click while one answer is in flight sends nothing", JSON.stringify(answers));
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-3000)); }
await browser.close(); app.kill();
console.log(`\ninbox-answer-binding-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
