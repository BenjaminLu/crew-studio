import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room on the page (public/review-room.js, public/scard.js; docs/units/review-room.md): the merge card's
// "Open review room" entry and summary (a merge card only, the same on every merge card); the room's board (a flowchart
// built up step by step, code at the head, the diff, before / after), the chat with each claim's basis (a citation opens
// what it rests on; an uncited claim reads Inference), sources and the understanding check; a turn asks for the paid
// round's confirmation and the controls wait while it runs. Model text stays text. At 1440 (en) and 390 (zh-TW).
// The room's routes are answered by the test: nothing paid runs.        node tests/review-room-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-room-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const shots = process.env.ROOM_SHOTS || join(root, "tests/out/review-room"); mkdirSync(shots, { recursive: true });
const H = "a".repeat(40), B = "b".repeat(40);
const summary = { href: "#/review/SC-50", opened: true, turns: 2, questions: 2, running: false, check: { asked: 2, graded: 2, correct: 1 }, sources: { consulted: 1, refused: 1 } };
const card = (kind, extra = {}) => ({ id: kind === "merge" ? "SC-50" : "SC-49", run: "R-050", node: kind === "merge" ? "merge-card" : "dispatch", workflow: "code-firstmate", kind, status: "open", title: { en: `${kind} card`, "zh-TW": `${kind} 卡` }, body: "", sections: { en: { why: "w" }, "zh-TW": { why: "w" } },
  options: [{ id: "merge", label: "Merge", labelZh: "合併", primary: true }, { id: "close", label: "Close without merging", labelZh: "不合併，關閉", hold: true }], createdAt: "2026-10-28T10:00:00Z", answer: null, ...extra });
const ROOM = { card: { id: "SC-50", run: "R-050", node: "merge-card", title: { en: "Merge: Add percent", "zh-TW": "合併：新增 percent" }, status: "open" }, task: { id: "R-050", title: "Add percent" }, pr: { id: 7, url: null }, head: H, base: B, open: true, running: null,
  offer: { provider: "codex", model: "gpt-6", effort: "high", paid: true, hash: "feedc0ffee123456" },
  actions: [["how", "How does this change work?", "這個改動是怎麼運作的？"], ["why", "Why?", "為什麼？"], ["teach", "Teach me", "教我"], ["merge-check", "Check", "檢查"], ["quiz", "Quiz", "考我"]].map(([id, en, zh]) => ({ id, en, zh })),
  board: [
    { id: "B1-1", turn: 1, type: "mermaid", title: "The flow", group: "flow", step: 1, code: "flowchart LR\n  A[amount in cents] --> B[percent]", basis: "cited", cites: [{ ref: "diff:src/percent.ts", ok: true }] },
    { id: "B1-2", turn: 1, type: "mermaid", title: "The flow", group: "flow", step: 2, code: "flowchart LR\n  A[amount in cents] --> B[percent]\n  B -->|Math.round| C[cents]", basis: "cited", cites: [{ ref: "diff:src/percent.ts:L2-3", ok: true }] },
    { id: "B1-3", turn: 1, type: "code", title: "The function", path: "src/percent.ts", commit: H, start: 1, end: 4, total: 5, lines: ["// A percent", "export function percent(amount: number, pct: number): number {", "  return Math.round((amount * pct) / 100);", "}"], highlight: [3], basis: "cited", cites: [] },
    { id: "B1-4", turn: 1, type: "diff", title: "Its diff", path: "src/percent.ts", commit: H, base: B, text: "@@ -0,0 +1,4 @@\n+// A percent\n+export function percent(amount: number, pct: number): number {", header: "new file mode 100644", basis: "cited", cites: [] },
    { id: "B1-5", turn: 1, type: "compare", title: "Before and after", path: "src/percent.ts", base: B, commit: H, before: null, after: { start: 1, end: 2, lines: ["// A percent", "export function percent("] }, basis: "cited", cites: [] },
    { id: "B1-6", turn: 1, type: "note", title: "A guess", text: "This was probably written for invoices.", basis: "inference", cites: [] }],
  turns: [
    { n: 1, action: "teach", text: "Teach me this change.", lang: "en", status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.04 }, answer: "x",
      claims: [{ text: "## Overview", kind: "heading", basis: null, cites: [] }, { text: "The change adds `percent`, which rounds to the cent [diff:src/percent.ts:L2-3].", kind: "claim", basis: "cited", cites: [{ ref: "diff:src/percent.ts:L2-3", ok: true }] },
        { text: 'It was probably added for invoices <img src=x onerror="window.__pwned=1">.', kind: "claim", basis: "inference", cites: [] }, { text: "Want me to go deeper?", kind: "aside", basis: null, cites: [] }] },
    { n: 2, action: "ask", text: "1: 300. 2: not sure.", lang: "en", status: "done", provider: "codex", model: "gpt-6", answer: "y", claims: [{ text: "Halves round up [source:1].", kind: "claim", basis: "cited", cites: [{ ref: "source:1", ok: true }] }] }],
  sources: [{ n: 1, turn: 1, kind: "fetch", url: "https://developer.mozilla.org/x", ok: true, status: 200, at: "t" }, { n: 2, turn: 1, kind: "search", query: "rounding in src/percent.ts", ok: false, refused: "it names a file of this repository", at: "t" }],
  check: { questions: [{ n: 1, q: "What does percent(1999, 15) return?", turn: 1, at: "t", result: { correct: true, note: "300", turn: 2 } }, { n: 2, q: "Where could rounding go wrong?", turn: 1, at: "t", result: { correct: false, note: "halves", turn: 2 } }] }, summary };

async function open(width, lang) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 960 } });
  await ctx.addInitScript(([l]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); }, [lang]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const posts = [], cites = []; let hold = null, roomNow = ROOM;
  await ctx.route(/\/api\/review-room\/SC-50(\?open=1)?$/, (r) => r.fulfill({ json: roomNow }));
  await ctx.route(/\/api\/review-room\/SC-50\/cite\?/, (r) => { const ref = new URL(r.request().url()).searchParams.get("ref"); cites.push(ref); r.fulfill({ json: { kind: "diff", path: "src/percent.ts", from: 2, to: 3, head: H, text: "@@ -0,0 +1,4 @@\n+  return Math.round((amount * pct) / 100);" } }); });
  await ctx.route(/\/api\/review-room\/SC-50\/turn$/, async (r) => { posts.push(JSON.parse(r.request().postData() || "{}")); await new Promise((res) => (hold = res));
    roomNow = { ...ROOM, running: 3, turns: [...ROOM.turns, { n: 3, action: "how", text: "How does this change work?", lang, status: "running", provider: "codex", model: "gpt-6", answer: "" }] }; r.fulfill({ json: roomNow }); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p, posts, cites, release: () => hold?.() };
}
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
try {
  // ---------- the merge card's entry ----------
  { const { ctx, p } = await open(1440, "en");
    await p.goto(`${base}/#/board`); await p.waitForFunction(() => window.crewCard?.mountCard);
    const r = await p.evaluate(([m, d]) => { const a = document.createElement("div"), b = document.createElement("div"); document.body.append(a, b); window.crewCard.mountCard(a, m); window.crewCard.mountCard(b, d);
      return { link: a.querySelector("[data-review-room-open]")?.getAttribute("href"), text: a.querySelector("[data-review-room-open]")?.textContent, summary: a.querySelector("[data-review-room-summary]")?.textContent, merge: !!a.querySelector('[data-option="merge"]'), other: !!b.querySelector("[data-review-room]") }; },
      [card("merge", { reviewRoom: summary }), card("dispatch")]);
    ok(r.link === "#/review/SC-50" && r.text === "Open review room" && r.merge, "a merge card shows Open review room beside its own options", JSON.stringify(r));
    ok(/2 questions asked in the room · check 1\/2 correct · 1 source consulted/.test(r.summary) && /never answers this card or changes whether it can merge/.test(r.summary), "the card shows the room's summary: questions, check score, sources; display only", r.summary);
    ok(!r.other, "a card that is not a merge card has no review room");
    await ctx.close(); }

  // ---------- the room at 1440 ----------
  { const { ctx, p, posts, cites, release } = await open(1440, "en");
    await p.goto(`${base}/#/review/SC-50`); await p.waitForSelector('[data-build-up="flow"]', { timeout: 15000 });
    const step = async () => p.$eval('[data-build-up="flow"]', (e) => ({ at: e.dataset.step, of: e.dataset.steps, nodes: [...e.querySelectorAll("[data-node]")].map((n) => n.dataset.node + (n.classList.contains("rr-new") ? "*" : "")), edges: [...e.querySelectorAll("[data-edge]")].map((n) => n.dataset.edge + (n.classList.contains("rr-new") ? "*" : "")) }));
    let s = await step();
    ok(s.at === "2" && s.of === "2" && s.nodes.join(",") === "A,B,C*" && s.edges.join(",") === "A>B,B>C*", "the flowchart shows its latest step with the part it added marked new", JSON.stringify(s));
    await p.click('[data-build-up="flow"] [data-step-prev]'); s = await step();
    ok(s.at === "1" && s.nodes.join(",") === "A,B" && s.edges.join(",") === "A>B", "Back shows step 1: the diagram before the part was added", JSON.stringify(s));
    await p.click('[data-build-up="flow"] [data-step-next]'); s = await step();
    ok(s.at === "2" && s.nodes.includes("C*"), "Next part adds it again: the picture assembles step by step");
    const code = await p.$eval('[data-item-type="code"]', (e) => ({ path: e.querySelector("[data-item-path]")?.textContent, hl: [...e.querySelectorAll(".hl")].map((x) => x.dataset.line), lines: e.querySelectorAll("[data-line]").length }));
    ok(code.path === "src/percent.ts:1-4" && code.hl.join() === "3" && code.lines === 4, "a code excerpt names its path and lines at the head, its highlighted line marked", JSON.stringify(code));
    ok(await p.$eval('[data-item-type="diff"] .add', (e) => e.textContent.startsWith("+// A percent")) && await p.$eval('[data-item-type="compare"]', (e) => /not in this commit/.test(e.textContent)), "the diff shows its added lines; before / after shows a file new at the head");
    ok(await p.$eval('[data-board-item="B1-6"] [data-basis="inference"]', (e) => e.textContent === "Inference"), "a board note with no citation is marked Inference");
    const claims = await p.$$eval("[data-claim]", (els) => els.map((e) => ({ k: e.dataset.claim, badge: !!e.querySelector('[data-basis="inference"]'), cite: !!e.querySelector("[data-cite]") })));
    ok(claims.some((c) => c.k === "cited" && c.cite && !c.badge) && claims.some((c) => c.k === "inference" && c.badge), "a cited claim shows its citation; an uncited claim is shown as Inference", JSON.stringify(claims));
    ok(await p.evaluate(() => !window.__pwned && !document.querySelector(".rr-answer img")), "model text with markup stays text");
    await p.click('[data-claim="cited"] [data-cite="diff:src/percent.ts:L2-3"]'); await p.waitForSelector("[data-cite-panel] .rr-diff");
    ok(cites[0] === "diff:src/percent.ts:L2-3" && /Math\.round/.test(await p.textContent("[data-cite-panel]")), "a citation opens the diff hunk it rests on", JSON.stringify(cites));
    const src = await p.$$eval("[data-source]", (els) => els.map((e) => e.textContent));
    ok(src.length === 2 && /developer\.mozilla\.org/.test(src[0]) && /refused: it names a file of this repository/.test(src[1]), "every source is listed, a refused query with its reason", JSON.stringify(src));
    ok((await p.textContent("[data-check-score]")) === "1 of 2 correct" && (await p.$$eval("[data-check-result]", (els) => els.map((e) => e.dataset.checkResult))).join() === "correct,missed", "the understanding check shows its score and each answer");
    // a paid turn: the confirmation names the model; controls wait while it runs
    await p.click('[data-room-action="how"]'); await p.waitForSelector('[data-room-confirm="how"]');
    ok(/paid model round on codex · gpt-6 \(high\)/.test(await p.textContent("[data-room-confirm]")) && /nothing is sent to GitHub/.test(await p.textContent("[data-room-confirm]")) && !posts.length, "a quick action first asks to confirm the paid round on its provider and model; nothing is sent yet");
    await p.click("[data-room-start]"); await p.waitForFunction(() => document.querySelector('[data-room-action="why"]')?.disabled);
    ok(posts.length === 1 && posts[0].action === "how" && posts[0].confirm === "feedc0ffee123456" && posts[0].lang === "en", "Start sends the turn with the confirmation of that model and the captain's language", JSON.stringify(posts));
    ok(await p.$eval("[data-room-start]", (e) => e.disabled) && await p.$eval("[data-room-send]", (e) => e.disabled), "while the turn is being sent every control waits");
    release(); await p.waitForSelector("[data-turn-running]");
    ok(await p.$eval('[data-room-action="teach"]', (e) => e.disabled) && !!(await p.$("[data-room-busy]")), "while the tutor works, one turn at a time: the controls stay disabled");
    ok(await noScroll(p), "no sideways scroll at 1440");
    await p.screenshot({ path: join(shots, "room-1440.png"), fullPage: true });
    await ctx.close(); }

  // ---------- 390, zh-TW ----------
  { const { ctx, p } = await open(390, "zh-TW");
    await p.goto(`${base}/#/review/SC-50`); await p.waitForSelector('[data-build-up="flow"]', { timeout: 15000 });
    ok(/白板/.test(await p.textContent(".rr-board h2")) && /第 2 步，共 2 步/.test(await p.textContent(".rr-step-bar")) && (await p.textContent('[data-board-item="B1-6"] [data-basis="inference"]')) === "推論", "zh-TW: the board, its steps and the Inference mark read in Chinese");
    ok(await noScroll(p), "no sideways scroll at 390");
    await p.screenshot({ path: join(shots, "room-390-zh.png"), fullPage: true });
    await ctx.close(); }

  // ---------- the real routes: a card that does not exist, a write needs the desktop session ----------
  { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(`${base}/#/board`);
    const r = await p.evaluate(async () => { const a = await fetch("/api/review-room/SC-999"); const b = await fetch("/api/review-room/SC-999/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return [a.status, b.status, (await b.json()).code]; });
    ok(r[0] === 404 && r[1] === 404 && r[2] === "not_found", "the real routes answer: no room for a card that does not exist", JSON.stringify(r));
    const raw = await fetch(`${base}/api/review-room/SC-999/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    ok(raw.status === 401 || raw.status === 403, "a write without Studio's session is refused", String(raw.status));
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} finally { await browser.close(); app.kill(); }
console.log(`\nreview-room-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
