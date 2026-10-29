import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room (docs/units/review-room.md) on a real code-firstmate Task stopped at its merge card, with stub
// providers and temporary data: the room belongs to merge cards only; a turn is a paid round the captain confirms; the
// round is read-only (no write tool, no folder to write, no host beyond its model) with the pinned tutor and pstack
// skills; the board's excerpts come from the real commits; claims carry their basis and an uncited one is an inference;
// the web tools refuse filtered queries and private hosts and log every call; history reaches the next turn; the merge
// card shows the room's summary while its stored file, options, evidence and readiness stay as they were; nothing goes
// to GitHub; the per pull request record is kept.        bun tests/review-room.ts
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("review-room");
const root = join(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "crew-room-"));
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { ROOM_SKILLS, ROOM_TOOLS } = await import("../src/domain/review-room");
const { Projects } = await import("../src/doors");
// the reviewer seat (and so the tutor) runs on its own model, different from the maker's
const def = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")
  .replace('- { id: reviewer, label: Reviewer, seat: reviewer, skill: "pack:firstmate/skills/reviewer.md" }', '- { id: reviewer, label: Reviewer, seat: reviewer, provider: tutor, model: t-1, skill: "pack:firstmate/skills/reviewer.md" }');
ok(def.includes("provider: tutor"), "fixture: the reviewer seat has its own model");
const H = await harness([def], { data, checkRoots: [] });
const E = H.engine;
// the web tools, stubbed: no real network in any test
const webCalls: [string, string][] = [], spoken: string[] = [];
installCode(E, { dataDir: data, projects: new Projects(data), reviewWeb: (check) => ({
  search: async (q) => { webCalls.push(["search", q]); return { configured: true, status: 200, url: "https://search.example/?q=x", text: "Math.round rounds half up: https://example.org/rounding-guide?ref=1" }; },
  fetch: async (u) => { const why = check(u); if (why) throw new Error(`refused: ${why}`); webCalls.push(["fetch", u]); return { status: 200, type: "text/html", url: u, text: "MDN page" }; } }),
  reviewSpeak: async (text) => { spoken.push(text); return { bytes: Buffer.alloc(256, 7), model: "tts-stub", voice: "alloy" }; } });
E.policies.setProject("sandbox", { install: false });

// ---------- a real Task to its merge card ----------
const intent = ["Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100); \\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n',
  "STUB_FIX src/percent.ts :: / 100);  => / 100);"].join("\n");
const r = E.start({ workflow: "code-firstmate", text: intent, params: {} });
const waitCard = async (kind: string) => { await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000); return E.cards.list({ run: r.id, open: true }).find((c) => c.kind === kind); };
const dispatch = (await waitCard("dispatch"))!;
const room = E.reviewRoom!;
let notMerge = ""; try { room.view(dispatch.id); } catch (e: any) { notMerge = e.code; }
ok(notMerge === "not_merge" && !E.cards.view(dispatch).reviewRoom, "a dispatch card has no review room: no summary, and its room is refused");
notMerge = ""; try { await room.start(dispatch.id, { action: "how", confirm: "x" }, "captain"); } catch (e: any) { notMerge = e.code; }
ok(notMerge === "not_merge", "a turn on a card that is not a merge card is refused");
await E.answer(dispatch.id, { choice: "dispatch", by: "captain" });
const merge = (await waitCard("merge"))!;
if (!merge) { console.log(E.get(r.id)!.status, E.get(r.id)!.error); throw new Error("the Task never reached its merge card"); }
await until(() => E.get(r.id)!.nodes[merge.node].waiting === "card", 10000);
const run = E.get(r.id)!, wt = run.ctx.worktree as string, head = String(run.ctx.pr?.head ?? run.ctx.head);
const sh = (args: string[]) => Bun.spawnSync(args, { cwd: wt, stdout: "pipe", stderr: "pipe" }).stdout.toString();

// what must not change: the stored card, its options and evidence, the worktree, its index and its refs
const cardFile = join(E.cards.dir, merge.id + ".json"), storedBefore = readFileSync(cardFile, "utf8");
const viewBefore = E.cards.view(E.cards.get(merge.id)!);
const gitState = () => JSON.stringify({ status: sh(["git", "status", "--porcelain", "--untracked-files=all"]), head: sh(["git", "rev-parse", "HEAD"]), refs: sh(["git", "for-each-ref"]), index: (() => { try { return statSync(join(sh(["git", "rev-parse", "--absolute-git-dir"]).trim(), "index")).mtimeMs; } catch { return null; } })() });
const gitBefore = gitState();
ok(viewBefore.reviewRoom?.href === `#/room/${merge.id}` && viewBefore.reviewRoom.turns === 0 && viewBefore.detail?.codeEvidence?.state === "success", "the merge card shows Open review room (no turn yet) beside ready evidence", JSON.stringify(viewBefore.reviewRoom));

// ---------- a turn is paid: it needs the captain's confirmation of the exact model ----------
let refusal: any = null; try { await room.start(merge.id, { action: "teach" }, "captain"); } catch (e) { refusal = e; }
ok(refusal?.code === "confirm_required" && refusal.offer?.provider === "tutor" && refusal.offer?.model === "t-1" && typeof refusal.offer.hash === "string", "a turn without the confirmation is refused and offers the tutor's provider and model", JSON.stringify(refusal?.offer ?? refusal?.message));
const offer = room.view(merge.id).offer as any;
ok(offer.independence?.level === "vendor" && offer.independence.adaptive === false && /Different vendor/.test(offer.independence.en) && !!offer.independence.zh, "the offer labels the tutor's independence from the author: a different vendor", JSON.stringify(offer.independence));
// the tutor adapts to what this machine has (src/domain/independence.ts): the approved reviewer while it can run and differs
// from the author; otherwise another member, labelled when it is not in this project's crew; never refused for one model
const reviewer = run.def.roles.find((x: any) => x.id === "reviewer")!; const saved = { ...reviewer }; Object.assign(reviewer, { provider: undefined, model: undefined });
const U = (...m: [string, string, any?][]) => m.map(([provider, model, o]) => ({ provider, model, efforts: provider === "codex" ? ["low", "medium"] : [], verified: true, runnable: true, ...o }));
let o2: any = room.view(merge.id).offer;
ok(o2.code === "no_tutor" && /differs from the author/.test(o2.error ?? ""), "without provider facts nothing is relaxed: a tutor on the author's own model is refused, as before", JSON.stringify(o2));
E.deps.usableModels = () => U(["stub", "m-2", { isDefault: true }], ["codex", "c-1"]);
o2 = room.view(merge.id).offer;
ok(o2.provider === "codex" && o2.model === "c-1" && o2.effort === "medium" && o2.independence?.level === "vendor" && o2.independence.adaptive === true && o2.independence.outside === true && /Not in this project's crew/.test(o2.independence.en) && /不在這個專案的人員配置裡/.test(o2.independence.zh),
  "a reviewer seat on the author's model moves to a model outside the crew, labelled as such (at medium effort)", JSON.stringify(o2));
// a member left to the vendor's default is that default: here the author's own, so the tutor takes another model of it
E.deps.usableModels = () => U(["stub", "m-2", { isDefault: true }], ["stub", "m-3"]);
o2 = room.view(merge.id).offer;
ok(o2.provider === "stub" && o2.model === "m-3" && o2.independence?.level === "model", "a vendor-default member resolves to the vendor's actual default before it is judged", JSON.stringify(o2));
E.deps.usableModels = () => U(["stub", "m-2", { isDefault: true }]);
o2 = room.view(merge.id).offer;
ok(!o2.error && o2.provider === "stub" && o2.independence?.level === "same" && /Same model as the author/.test(o2.independence.en) && /Only one model is usable/.test(o2.independence.en), "with one model on this machine, the tutor runs on the author's own model and says so, never refused", JSON.stringify(o2));
E.deps.usableModels = () => U(["stub", "m-2", { isDefault: true }], ["codex", "c-1", { runnable: false, held: "codex's quota could not be read" }]);
o2 = room.view(merge.id).offer;
ok(o2.code === "no_tutor" && /The tutor waits: codex's quota could not be read/.test(o2.error ?? ""), "another vendor signed in but held for now: the tutor waits, it never falls back to the author's model", JSON.stringify(o2));
E.deps.usableModels = () => [];
o2 = room.view(merge.id).offer;
ok(o2.code === "no_tutor" && /No signed-in model/.test(o2.error ?? ""), "with nothing usable at all, the room says so", JSON.stringify(o2));
delete E.deps.usableModels; Object.assign(reviewer, saved);
// the approved reviewer stays the tutor while it can run and differs from the author: another vendor signed in changes nothing
E.deps.usableModels = () => U(["codex", "c-1"], ["tutor", "t-1"]);
o2 = room.view(merge.id).offer;
ok(o2.provider === "tutor" && o2.model === "t-1" && o2.independence.adaptive === false && o2.independence.outside === false && o2.hash !== undefined, "the approved reviewer stays the tutor when it can run, whatever else is signed in", JSON.stringify(o2));
delete E.deps.usableModels;
// a sandbox-off grant refuses the turn
const grant = E.grants.add({ kinds: ["sandbox-off"], until: new Date(Date.now() + 3600_000).toISOString(), project: null } as any, "captain (desktop)") as any;
refusal = null; try { await room.start(merge.id, { action: "how", confirm: offer.hash }, "captain"); } catch (e) { refusal = e; }
ok(refusal?.code === "sandbox", "with a sandbox-off grant the tutor does not run", refusal?.message);
E.grants.revoke(grant.id, "captain (desktop)");

// ---------- the scripted tutor (a stub provider that calls the room's tools) ----------
const ledgerSeq = E.trusted(r.id).entries.find((e) => e.check === "firstmate/ci" && e.head === head)!.seq;
const script: any[][] = [], prompts: { system: string; text: string; tools: string[] }[] = [], results: [string, any][] = [];
const fetched: string[] = []; const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: any, i: any) => { fetched.push(String(u?.url ?? u)); return realFetch(u, i); }) as any;
const scripted = (id: string, model: string) => ({ id, model, sandboxFree: true, start(system: string, tools: any[], ctx: any) {
  const me = { system, text: "", tools: tools.map((t) => t.name) }; prompts.push(me);
  return { interrupt() {}, async *send(text: string) { me.text = text;
    for (const [name, args] of script.shift() ?? []) {
      if (name === "say") { yield { type: "delta", text: args } as any; continue; }
      if (name === "wait") { await args; continue; }
      // one whole assistant message, as codex, claude and cursor stream it: its text, then the message that closes it
      if (name === "msg") { yield { type: "delta", text: args } as any; yield { type: "message", text: args } as any; continue; }
      const res = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const j = await res.json(); results.push([name, j]);
      yield { type: "toolStart", id: name, name, args } as any; yield { type: "toolEnd", id: name, rows: null, error: j?.error ?? null, result: JSON.stringify(j) } as any; }
    yield { type: "turnEnd", status: "ok", usage: { usd: 0.02, inTokens: 10, outTokens: 5 } } as any; } }; } });
const baseProvider = E.deps.provider; E.deps.provider = (id?: string, model?: string) => id === "tutor" || id === "codex" ? scripted(id, model ?? "") : baseProvider(id, model);
const runArgs: any[] = []; const baseRun = E.deps.agents.run.bind(E.deps.agents); E.deps.agents.run = (o: any) => { if (o.kind === "review-room") runArgs.push(o); return baseRun(o); };
const MDN = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round";
script.push([
  ["say", "Let me look at the diff first."], // a preamble streamed as deltas only, then a tool call: not the answer
  ["board_draw", { items: [
    { type: "mermaid", title: "The flow", group: "flow", step: 1, code: "flowchart LR\n  A[amount in cents] --> B[percent]", cites: ["diff:src/percent.ts"] },
    { type: "mermaid", title: "The flow", group: "flow", step: 2, code: "flowchart LR\n  A[amount in cents] --> B[percent]\n  B -->|Math.round| C[cents]", cites: ["diff:src/percent.ts:L2-3"] },
    { type: "code", title: "The function", path: "src/percent.ts", start: 1, end: 4, highlight: [3] },
    { type: "diff", title: "Its diff", path: "src/percent.ts" },
    { type: "compare", title: "Before and after", path: "src/percent.ts", start: 1, end: 4 },
    { type: "note", title: "A guess", text: "This was probably written for invoices." },
    { type: "diff", title: "Not changed", path: "README.md" }] }],
  ["web_search", { query: "rounding in src/percent.ts" }],
  ["web_search", { query: "Math.round((amount * pct) / 100)" }],
  ["web_search", { query: "what runs at 192.168.1.10" }],
  ["web_search", { query: "JavaScript Math.round rounding of halves" }],
  ["web_fetch", { url: "http://127.0.0.1:4210/api/scards" }],
  ["web_fetch", { url: "http://localhost/x" }],
  ["web_fetch", { url: "https://wiki.intranet.local/page" }],
  ["web_fetch", { url: MDN }],
  ["screenshots_show", { title: "The page, before and after" }],
  ["chart_draw", { source: "diffstat", title: "What changed, by file" }],
  ["chart_draw", { title: "Rounding", unit: "cents", rows: [{ label: "1999 at 15%", before: 299, after: 300 }] }],
  ["illustrate", { title: "Leak", concepts: ["src/percent.ts rounds"] }],
  ["illustrate", { title: "Rounding", concepts: ["number", "rounding", "whole number"], layout: "flow" }],
  ["illustrate", { title: "Halves", concepts: ["number line", "half"], layout: "comparison" }],
  ["illustrate", { title: "One too many", concepts: ["number"] }],
  // the old free-text form is refused; a question over its limits is refused saying which; then the check as multiple choice
  ["check_ask", { questions: ["What does percent(1999, 15) return, and why?", "Where could rounding go wrong for a user?"] }],
  ["check_ask", { questions: [{ q: "x".repeat(81), options: ["a"], answer: 3, why: "" }, { q: "ok?", options: ["a", "a"], answer: 0, why: "w" }] }],
  ["check_ask", { questions: [{ q: "What does percent(1999, 15) return?", options: ["300", "299", "299.85"], answer: 0, why: "Math.round rounds 299.85 to 300", cites: ["diff:src/percent.ts:L2-3"] }, { q: "Where could rounding go wrong for a user?", options: ["Negative amounts", "Halves of a cent"], answer: 1, why: "A half cent rounds up, which a user may not expect", cites: ["diff:src/percent.ts:L2-3"] }] }],
  ["fs_write", { path: "src/percent.ts", content: "x" }],
  // a small table on the board, drawn by Studio as text; one too wide is refused
  ["board_draw", { items: [{ type: "table", title: "Rounding cases", rows: [["amount", "15%"], ["1999", "300"], ["1000", 150]], cites: ["diff:src/percent.ts:L2-3"] }, { type: "table", title: "Too wide", rows: [["a", "b", "c", "d", "e", "f"], ["1", "2", "3", "4", "5", "6"]] }] }],
  // scenes: Studio holds the tutor to short titles and points (a CJK character weighs more), and to a picture it drew
  ["scene_show", { chapter: "what", title: "How percent rounds its result to the nearest whole cent today", picture: "B1-1", points: [{ text: "One." }, { text: "Two." }] }],
  ["scene_show", { chapter: "what", title: "金".repeat(21), picture: "B1-1", points: [{ text: "One." }, { text: "Two." }] }],
  ["scene_show", { chapter: "what", title: "Rounding", picture: "B9-9", points: [{ text: "Only one." }] }],
  ["scene_show", { chapter: "what", title: "Rounding", picture: "B1-1", points: [{ text: "a".repeat(121) }, { text: "Two." }] }],
  ["scene_show", { chapter: "what", title: "四捨五入", picture: "B1-1", points: [{ text: "金".repeat(61) }, { text: "Two." }] }],
  ["scene_show", { chapter: "what", title: "金".repeat(20), picture: "B1-2", points: [{ text: `${"金".repeat(60)} [diff:src/percent.ts:L2-3]`, cites: ["diff:src/percent.ts:L2-3"] }, { text: "a".repeat(120), cites: ["diff:src/percent.ts"] }, { text: "It was probably for invoices." }] }],
  // a lesson, chapter by chapter: per-item figures from one layout, a state machine, a sequence; chapters in order, risks cited
  ["board_draw", { items: [{ type: "item", title: "Rounding", name: "percent()", before: "Fractions of a cent kept", after: "Rounded to the cent", mechanism: "Math.round", cites: ["diff:src/percent.ts:L2-3"] },
    { type: "item", title: "Tests", name: "percent.test.ts", before: "No test of rounding", after: "1999 at 15% pinned to 300", cites: ["diff:test/percent.test.ts"] },
    { type: "states", title: "An invoice", states: [{ id: "draft", label: "Draft" }, { id: "priced", label: "Priced" }, { id: "paid", label: "Paid" }], transitions: [{ from: "draft", to: "priced", label: "price", cite: "diff:src/percent.ts:L2-3" }, { from: "priced", to: "paid", label: "pay" }] },
    { type: "sequence", title: "Pricing a line", actors: ["Cart", "percent", "Math"], steps: [{ from: "Cart", to: "percent", label: "percent(1999, 15)" }, { from: "percent", to: "Math", label: "round(299.85)", frame: "loop", frameLabel: "each line" }, { from: "Math", to: "percent", label: "300", kind: "return", frame: "loop" }, { from: "percent", to: "Cart", label: "300", kind: "return" }], cites: ["diff:src/percent.ts:L2-3"] },
    { type: "item", title: "Too long", name: "x".repeat(34), before: "a", after: "b" },
    { type: "arch", title: "Who calls percent", nodes: [{ id: "cart", label: "Cart", kind: "actor" }, { id: "percent", label: "percent()", kind: "service", mark: "new" }, { id: "math", label: "Math", kind: "external" }],
      edges: [{ from: "cart", to: "percent", label: "calls", cite: "diff:src/percent.ts:L2-3" }, { from: "percent", to: "math", label: "rounds" }] }] }],
  ["scene_show", { chapter: "talks", title: "What talks to what", picture: "B1-20", points: [{ text: "The cart calls percent [inference].", cites: [] }, { text: "percent rounds [diff:src/percent.ts:L2-3].", cites: ["diff:src/percent.ts:L2-3"] }] }],
  ["scene_show", { chapter: "change", title: "Rounding", picture: "B1-15", points: [{ text: "It rounds to the cent [diff:src/percent.ts:L2-3].", cites: ["diff:src/percent.ts:L2-3"] }, { text: "Nothing else changed in it.", cites: [] }] }],
  ["scene_show", { chapter: "change", title: "Tests", picture: "B1-16", points: [{ text: "A test pins it [diff:test/percent.test.ts].", cites: ["diff:test/percent.test.ts"] }, { text: "At 1999 and 15%.", cites: [] }] }],
  ["scene_show", { chapter: "change", title: "Not an item", picture: "B1-1", points: [{ text: "One.", cites: [] }, { text: "Two.", cites: [] }] }],
  ["scene_show", { chapter: "lifecycle", title: "An invoice", picture: "B1-17", points: [{ text: "Draft, priced, paid.", cites: [] }, { text: "Pricing rounds [diff:src/percent.ts:L2-3].", cites: ["diff:src/percent.ts:L2-3"] }] }],
  ["scene_show", { chapter: "sequence", title: "Pricing a line", picture: "B1-18", points: [{ text: "Each line is rounded once.", cites: [] }, { text: "The result goes back [diff:src/percent.ts:L2-3].", cites: ["diff:src/percent.ts:L2-3"] }] }],
  ["scene_show", { chapter: "watch", title: "What to watch", picture: "B1-15", points: [{ text: "Halves round up [diff:src/percent.ts:L2-3].", cites: ["diff:src/percent.ts:L2-3"] }, { text: "Users may notice.", cites: [] }] }],
  ["scene_show", { chapter: "watch", title: "What to watch", picture: "B1-15", points: [{ text: "Halves round up [diff:src/percent.ts:L2-3].", cites: ["diff:src/percent.ts:L2-3"] }, { text: "The test pins it [diff:test/percent.test.ts].", cites: ["diff:test/percent.test.ts"] }] }],
  ["scene_show", { chapter: "what", title: "Too late", picture: "B1-1", points: [{ text: "One.", cites: [] }, { text: "Two.", cites: [] }] }],
  ["say", `## Overview\n\nThe change adds \`percent\`, which rounds to the cent [diff:src/percent.ts:L2-3].\n\nIt was probably added for invoices.\n\n- The test pins the rounding [ledger:#${ledgerSeq}]\n- An old commit explains it [commit:deadbeef]\n\nThe sketch shows the rounding [board:B1-11].\n\n| case | cents |\n|---|---|\n| 1999 at 15% | 300 [diff:src/percent.ts:L2-3] |\n\nWant me to go deeper?`]]);
// the renderer's captures for this head (the Task's capture check makes them; stubbed here) and the image generator, stubbed
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let releaseImages!: () => void; const imagesGate = new Promise<void>((res) => (releaseImages = res));
const imagePrompts: string[] = []; E.deps.generateImage = async (prompt: string, authorize: () => void) => { authorize(); imagePrompts.push(prompt); await imagesGate; return { bytes: PNG, model: "img-1", provider: "codex" }; };
run.ctx.captures = { head, base: run.ctx.baseCommit, rendered: true, skipped: null, pages: [{ label: "Checkout", file: "index.html", before: `/api/wruns/${r.id}/captures/x/before/index.html.png`, after: `/api/wruns/${r.id}/captures/x/after/index.html.png`, changed: { removed: ["$19.99"], added: ["$20.00"] } }, { label: "Evil", before: "https://example.com/x.png", after: null }] };
{ room.view(merge.id, true); await room.settle(merge.id);
  ok(imagePrompts.length === 0 && !(room.view(merge.id) as any).board.some((b: any) => b.turn === 0) && (room.view(merge.id) as any).images === false, "generated pictures are off by default: opening the room pays for no picture", JSON.stringify(imagePrompts));
  const on: any = room.images(merge.id, true, "captain"); let bad: any = null; try { room.images(merge.id, "yes" as any, "captain"); } catch (e) { bad = e; }
  ok(on.images === true && bad?.code === "bad_request", "the captain turns them on for this room (true or false only)", JSON.stringify([on.images, bad?.message]));
  room.view(merge.id, true); await room.settle(merge.id);
  ok(imagePrompts.length === 0 && !(room.view(merge.id) as any).board.some((b: any) => b.turn === 0), "pictures on, opening the room still pays for nothing: the opening picture waits for a confirmed paid round", JSON.stringify(imagePrompts)); }
const started = await room.start(merge.id, { action: "teach", lang: "zh-TW", confirm: offer.hash }, "captain");
let busy = ""; try { await room.start(merge.id, { action: "how", confirm: offer.hash }, "captain"); } catch (e: any) { busy = e.code; }
ok(started.running === 1 && started.turns[0].status === "running" && busy === "busy", "a confirmed turn starts at once, and a second one waits: one turn at a time per room", busy);
await until(() => (room.view(merge.id) as any).running == null, 60000);
const early = room.view(merge.id) as any;
ok(early.turns[0].status === "done" && early.board.filter((b: any) => b.type === "image").every((b: any) => b.status === "pending" && b.src === null), "the turn ends without waiting for its illustrations: they are placeholders until ready");
releaseImages(); await room.settle(merge.id);
room.view(merge.id, true); await room.settle(merge.id); // the captain opens the room: its opening picture is made in the background
const v1 = room.view(merge.id) as any, t1 = v1.turns[0];
ok(t1.status === "done" && /rounds to the cent/.test(t1.answer) && t1.provider === "tutor" && t1.model === "t-1" && t1.lang === "zh-TW", "the answer is stored with its provider, model and the captain's language", JSON.stringify(t1).slice(0, 400));
ok(t1.answer.startsWith("## Overview") && !/Let me look/.test(t1.answer), "text streamed without a closing message counts as one message: a preamble before a tool call is dropped, the text after the last tool is the answer", JSON.stringify(t1.answer.slice(0, 80)));

// ---------- the round: read-only, sandboxed, no egress beyond the model, the pinned skills ----------
const a = runArgs[0];
ok(!!a && JSON.stringify(a.tools.map((t: any) => t.name)) === JSON.stringify(ROOM_TOOLS) && !a.tools.some((t: any) => /write|replace|run_tests|run_command|commit|push|merge|comment|review_verdict/.test(t.name)), "the round gets only the room's read, board, check and web tools: no write tool of any kind", JSON.stringify(a?.tools.map((t: any) => t.name)));
ok(JSON.stringify(a.sandbox) === JSON.stringify({ writes: [], reads: [], allow: [] }), "the round runs in the round sandbox with nothing to write and no host beyond its model", JSON.stringify(a.sandbox));
ok(results.some(([n, j]) => n === "fs_write" && /no such tool/.test(j.error ?? "")), "a write tool the tutor asks for does not exist");
const skillTexts = ROOM_SKILLS.map((s) => readFileSync(join(root, s.ref), "utf8"));
ok(ROOM_SKILLS.every((s, i) => createHash("sha256").update(skillTexts[i]).digest("hex") === s.sha256), "each room skill is pinned by the sha256 of its exact text");
ok(skillTexts.every((t) => prompts[0].system.includes(t.trim())) && /Role: review room tutor/.test(prompts[0].system) && /Skill: how/.test(prompts[0].system) && /Skill: why/.test(prompts[0].system) && /Skill: teach/.test(prompts[0].system), "the round's instructions carry the tutor role and the adapted how, why and teach skills");
{ const { OperatingRules } = await import("../src/operating-rules"); const sec = new OperatingRules(data).section(E.get(r.id)?.params?.project || null);
  ok(prompts[0].system.includes(sec.text) && E.deps.agents.jobs.get(E.ledger(r.id).filter((e: any) => e.record === "review-room-turn").at(0)?.data?.job)?.operatingRules?.hash === sec.hash,
    "the tutor's instructions carry the captain's operating rules for the Task's project, and its job keeps their hash", JSON.stringify(E.get(r.id)?.params?.project)); }
const recDir = join(data, "runs", r.id, "nodes", merge.node, `room-${merge.id}-1`);
ok(["prompt.md", "system.md", "stream.jsonl", "report.json"].every((f) => existsSync(join(recDir, f))) && /review-room-tutor@sha256:/.test(readFileSync(join(recDir, "prompt.md"), "utf8")) && /rounds to the cent/.test(readFileSync(join(recDir, "report.json"), "utf8")), "the turn leaves a round record: prompt with its skill pins, system, stream and report");
const rec = E.trusted(r.id).entries.filter((e: any) => e.record === "review-room-turn");
ok(rec[0]?.data.independence === "vendor" && t1.independence === "vendor" && JSON.parse(readFileSync(join(data, "review-room-stats.json"), "utf8"))[r.id]?.independence === "vendor", "the turn's independence level is on the ledger, the turn and the room's stats", JSON.stringify(rec[0]?.data));
ok(rec.length === 1 && rec[0].data.card === merge.id && rec[0].data.provider === "tutor" && rec[0].data.confirm === offer.hash && rec[0].data.skills.length === 7 && rec[0].data.check.asked === 2, "the turn is on the Task's signed ledger: card, provider, the confirmation, the skill pins, the check", JSON.stringify(rec[0]?.data));
ok(/THE TASK'S SPEC/.test(prompts[0].text) && prompts[0].text.includes(head) && /THE DIFF/.test(prompts[0].text) && prompts[0].text.includes(`[ledger:#${ledgerSeq}]`) && /Traditional Chinese/.test(prompts[0].text), "the prompt carries the spec, the head, the diff, the ledger to cite and the captain's language");

// ---------- the board: excerpts from the real commits, build-up steps, basis ----------
const board = v1.board as any[], headFile = sh(["git", "show", `${head}:src/percent.ts`]).split("\n");
const flow = board.filter((b) => b.group === "flow");
ok(flow.length === 2 && flow.map((b) => b.step).join(",") === "1,2" && flow.every((b) => b.basis === "cited"), "a diagram is built up as one group of steps, each with its basis", JSON.stringify(flow));
const code = board.find((b) => b.type === "code");
ok(code && JSON.stringify(code.lines) === JSON.stringify(headFile.slice(0, 4)) && code.commit === head && JSON.stringify(code.highlight) === "[3]", "a code item holds the real head lines, not text the tutor wrote", JSON.stringify(code));
ok(board.find((b) => b.type === "diff")?.text.includes("+export function percent") && board.find((b) => b.type === "compare")?.after?.lines.length === 4, "a diff item holds the real hunks, a compare item both sides");
ok(board.find((b) => b.type === "note")?.basis === "inference" && !board.some((b) => b.path === "README.md") && results.find(([n]) => n === "board_draw")?.[1].errors.some((e: string) => /README.md is not a changed file/.test(e)), "a note with no citation is an inference, and a file the change does not touch is refused");

// ---------- grounding: each claim cited, an uncited one an inference ----------
const claims = t1.claims as any[], find = (re: RegExp) => claims.find((c) => re.test(c.text));
ok(find(/rounds to the cent/)?.basis === "cited" && find(/test pins/)?.basis === "cited", "claims with a valid diff or ledger citation are cited", JSON.stringify(claims));
ok(find(/probably added for invoices/)?.basis === "inference", "a claim with no citation is shown as an inference");
ok(find(/sketch shows/)?.basis === "inference" && find(/sketch shows/)?.cites[0].ok === false, "an illustration is not evidence: a claim citing only it is an inference");
const shot = board.find((b) => b.type === "screenshot");
ok(shot?.kind === "screenshot" && shot.pages.length === 1 && shot.pages[0].before.endsWith("/before/index.html.png") && shot.pages[0].after.endsWith("/after/index.html.png"), "screenshots come from Studio's captures of this head, before and after; an outside picture is dropped", JSON.stringify(shot));
const numstat = sh(["git", "diff", "--numstat", run.ctx.baseCommit, head]).split("\n").filter(Boolean).map((l) => l.split("\t"));
const ds = board.find((b) => b.type === "chart" && b.mode === "diffstat"), own = board.find((b) => b.type === "chart" && b.mode === "before-after");
ok(ds?.basis === "cited" && JSON.stringify(ds.rows.map((x: any) => [String(x.added), String(x.removed), x.label])) === JSON.stringify(numstat), "a diffstat chart is counted by git, not by the tutor", JSON.stringify(ds?.rows));
ok(own?.basis === "inference" && own.rows[0].after === 300, "a chart of the tutor's own numbers without a citation is shown as an inference");
const pics = board.filter((b) => b.type === "image" && b.turn === 1), imgRes = results.filter(([n]) => n === "illustrate").map(([, j]) => j);
ok(pics.length === 2 && pics.every((b) => b.kind === "illustration" && b.status === "ready" && b.basis === "illustration" && b.model === "img-1" && b.src === `/api/review-room/${merge.id}/image/${b.id}.png`), "two illustrations are on the board, labelled generated, never evidence", JSON.stringify(pics));
ok(/refused: not in the concept list/.test(imgRes[0].error) && /at most 2 illustrations/.test(imgRes[3].error) && imagePrompts.length === 3 && imagePrompts.every((x) => !/percent\.ts/.test(x)) && imagePrompts.some((x) => /a left-to-right flow showing: number, rounding, whole number$/.test(x)) && (v1.illustrations ?? []).length === 1, "the image model gets only listed concepts: a free-text concept never reaches it; at most two a turn", JSON.stringify(imgRes));
ok(Buffer.compare(room.image(merge.id, `${pics[0].id}.png`), PNG) === 0 && (() => { try { room.image(merge.id, "../x.png"); return false; } catch { return true; } })(), "an illustration is stored in the room's record and served from it only");
const imgRec = E.trusted(r.id).entries.filter((e: any) => e.record === "review-room-image");
ok(rec[0].data.images.length === 5 && imgRec.length === 3 && imgRec.every((e: any) => /^[0-9a-f]{64}$/.test(e.data.sha256) && e.data.model === "img-1"), "the turn's ledger entry lists its pictures; each finished illustration has its own entry with its sha256", JSON.stringify(imgRec.map((e: any) => e.data)));
const opening = board.find((b) => b.turn === 0);
ok(opening?.type === "image" && opening.status === "ready" && imagePrompts.some((x) => /It explains: a before and after side by side showing: [a-z ,]*percent[a-z ,]*, change$/.test(x)), "opening the room makes its opening picture in the background, from listed concepts the spec names", JSON.stringify({ opening, imagePrompts }));
// once per merge card: not again on a reload, nor after a restart (another room instance reads the same files)
room.view(merge.id, true); await room.settle(merge.id);
const { installReviewRoom } = await import("../src/domain/review-room");
const again = installReviewRoom(E, { dataDir: data, illustrate: async () => { imagePrompts.push("restart"); return { bytes: PNG }; } });
again.view(merge.id, true); await again.settle(merge.id);
ok(imagePrompts.length === 3 && (again.view(merge.id) as any).board.filter((b: any) => b.turn === 0).length === 1, "the opening picture is made once per merge card: a reload or a restart does not make it again", JSON.stringify(imagePrompts));
delete run.ctx.captures;
ok(find(/old commit/)?.basis === "inference" && find(/old commit/)?.cites[0].ok === false, "a citation Studio cannot verify (no such commit) leaves the claim an inference");
ok(find(/Overview/)?.kind === "heading" && find(/deeper/)?.kind === "aside", "headings and offers are not claims");
// ---------- scenes: short, with a picture; over a limit the tool refuses and the tutor rewrites ----------
{ const { boardLength, fitsBoard, SCENE_LIMITS: L } = await import("../src/domain/review-room");
  ok(fitsBoard("金".repeat(20), L.title) && !fitsBoard("金".repeat(21), L.title) && fitsBoard("a".repeat(48), L.title) && !fitsBoard("a".repeat(49), L.title)
    && fitsBoard(`${"金".repeat(60)} [diff:src/percent.ts:L2-3]`, L.point) && !fitsBoard("金".repeat(61), L.point) && fitsBoard("a".repeat(120), L.point) && !fitsBoard("a".repeat(121), L.point) && boardLength("金a", L.point) === 3,
    "the board's limits: a title at most 20 CJK or 48 Latin characters, a point at most 60 CJK or 120 Latin, citations not counted");
  const sr = results.filter(([n]) => n === "scene_show").map(([, j]) => j).slice(0, 6);
  ok(sr.length === 6 && /title is too long/.test(sr[0].error) && /title is too long/.test(sr[1].error) && /not a board item/.test(sr[2].error) && /points is 2 to 4/.test(sr[2].error) && /point 1 is too long/.test(sr[3].error) && /point 1 is too long/.test(sr[4].error) && sr[5].scene === 1 && !sr[5].error,
    "scene_show refuses a title or a point over the limit, a picture that is not on the board and fewer than two points, saying which: the tutor rewrites", JSON.stringify(sr));
  const sc = t1.scenes as any[];
  ok(sc?.length >= 1 && sc[0].chapter === "what" && sc[0].title === "金".repeat(20) && sc[0].picture === "B1-2" && sc[0].points.map((p: any) => p.basis).join() === "cited,cited,inference" && sc[0].points[0].cites[0].ok === true, "a scene within the limits is kept on the turn: its title, its picture, each point with its basis", JSON.stringify(sc));
  { const sr2 = results.filter(([n]) => n === "scene_show").map(([, j]) => j).slice(6), figs = results.filter(([n]) => n === "board_draw").at(-1)?.[1];
    const item = board.find((b) => b.id === "B1-15"), states = board.find((b) => b.id === "B1-17"), seq = board.find((b) => b.id === "B1-18");
    ok(JSON.stringify(sc.map((x: any) => x.chapter)) === JSON.stringify(["what", "talks", "change", "change", "lifecycle", "sequence", "watch"]), "the lesson is chapters in their order: what, what talks to what, each changed item, its life, one request, what to watch", JSON.stringify(sc.map((x: any) => x.chapter)));
    ok(/the "change" chapter's picture is a item/.test(sr2[3]?.error ?? "") && /a risk is listed only with what it rests on/.test(sr2[6]?.error ?? "") && /one scene a chapter/.test(sr2[8]?.error ?? ""),
      "Studio holds the chapter shape: a changed item shows its item figure, a risk needs a citation, a chapter never comes back after a later one", JSON.stringify(sr2.map((x: any) => x.error ?? x.scene)));
    ok(item?.name === "percent()" && item.basis === "cited" && states?.transitions.length === 2 && states.transitions[0].cite.ok === true && /s_draft -->\|price\| s_priced/.test(states.code) && seq?.steps[1].frame === "loop" && seq.steps[2].kind === "return" && /item 5: name is 1 to 33/.test(figs?.errors[0] ?? ""),
      "per-item figures, a state machine (every transition, each cited) and a sequence (its loop kept) are board items Studio draws; a label too long for the layout is refused", JSON.stringify({ item, figs: figs?.errors })); }
  const tbl = board.find((b) => b.type === "table"), bd = results.filter(([n]) => n === "board_draw")[1]?.[1];
  ok(tbl && JSON.stringify(tbl.rows) === JSON.stringify([["amount", "15%"], ["1999", "300"], ["1000", "150"]]) && tbl.basis === "cited" && /a table is 2 to 8 rows/.test(bd.errors[0]), "a table is a board item of text cells (a number becomes text); one too wide is refused", JSON.stringify({ tbl, bd }));
  ok(claims.some((c) => c.kind === "table" && /1999 at 15%/.test(c.text)) && !claims.some((c) => c.kind === "claim" && /^\s*\|/.test(c.text)), "a markdown table in an answer is not a claim: the board shows it as a table", JSON.stringify(claims.map((c) => c.kind))); }
const cDiff: any = await room.cite(merge.id, "diff:src/percent.ts:L2-3"), cLedger: any = await room.cite(merge.id, `ledger:#${ledgerSeq}`), cSource: any = await room.cite(merge.id, "source:8");
let badCite = ""; try { await room.cite(merge.id, "diff:README.md"); } catch (e: any) { badCite = e.code; }
ok(/Math\.round/.test(cDiff.text) && cLedger.check === "firstmate/ci" && cLedger.task === r.id && cSource.url === MDN && badCite === "bad_cite", "a citation opens what it rests on: the diff hunk, the ledger entry, the web source", JSON.stringify({ cLedger, cSource }));

// ---------- the web tools: filtered, logged, nothing private out ----------
const src = v1.sources as any[];
ok(src.length === 8 && src.filter((s) => s.refused).length === 6 && src.filter((s) => s.ok).length === 2, "every web call is logged as a source, refused ones with the reason", JSON.stringify(src));
ok(/only words/.test(src[0].refused) && /only words/.test(src[1].refused) && /private address/.test(src[2].refused) && /by number/.test(src[4].refused) && /private host/.test(src[5].refused) && /private host/.test(src[6].refused), "refused: a repository path, code, a private address, an IP address, localhost, a private domain", JSON.stringify(src.map((s) => s.refused)));
ok(src.filter((s) => s.refused && s.kind === "fetch").every((s) => s.url === undefined && typeof s.text === "string"), "a refused address is kept as text only, never as a link", JSON.stringify(src.filter((s) => s.kind === "fetch")));
ok(JSON.stringify(webCalls) === JSON.stringify([["search", "JavaScript Math.round rounding of halves"], ["fetch", MDN]]), "only the clean query and the public page reach the web backend", JSON.stringify(webCalls));

// ---------- the next turn carries the history; the check is graded ----------
// a codex tutor streams a preamble before its tools and a progress message before its answer: neither is the answer
const FINAL2 = "You missed how halves round [board:B1-3]. Math.round rounds 0.5 up [source:8].";
script.push([["msg", "I’ll use the how guidance to explain the mode change and the compatibility check together."], ["check_grade", { results: [{ n: 1, correct: true, note: "300 cents" }] }],
  ["web_fetch", { url: "javascript:alert(document.cookie)" }], ["web_fetch", { url: "https://example.org/rounding-guide" }],
  ["web_search", { query: "half up rounding" }], ["web_fetch", { url: "https://example.org/rounding-guide" }], ["web_fetch", { url: "https://example.org/other-page" }],
  ["web_search", { query: "bankers rounding" }], ["web_search", { query: "rounding modes" }], ["web_search", { query: "decimal rounding" }], ["web_search", { query: "one too many" }], ["msg", "Now I have what I need."], ["msg", FINAL2]]);
// ---------- the check: multiple choice, the answer kept in Studio until the captain picks; Studio grades it, no model ----------
{ const before = room.view(merge.id) as any, qs = before.check.questions, runs = runArgs.length, calls = prompts.length;
  const cks = results.filter(([n]) => n === "check_ask").map(([, j]) => j);
  ok(/options of 1 to 40|q is 1 to 80/.test(cks[0].error ?? ""), "the old free-text check is refused: questions are multiple choice now", JSON.stringify(cks[0]));
  ok(/q is 1 to 80/.test(cks[1].error) && /2 to 4 options/.test(cks[1].error) && /answer is the right option's index/.test(cks[1].error) && /why is 1 to 120/.test(cks[1].error) && /all different/.test(cks[1].error) && JSON.stringify(cks[2].asked) === "[1,2]", "check_ask refuses a question, options, answer or why over its limits, saying which; a valid one is asked", JSON.stringify(cks));
  ok(qs.length === 2 && qs.every((q: any) => Array.isArray(q.options) && !("answer" in q) && !("why" in q) && !("cites" in q)) && !/Math\.round rounds 299\.85/.test(JSON.stringify(before)), "before the captain answers, the page gets the options and never the answer, why or its citations", JSON.stringify(qs));
  const r1: any = room.answer(merge.id, 1, 0), r2: any = room.answer(merge.id, 2, 0);
  let again: any = null; try { room.answer(merge.id, 2, 1); } catch (e) { again = e; }
  ok(r1.correct === true && r1.answer === 0 && r2.correct === false && r2.answer === 1 && /half cent/.test(r2.why) && r2.cites[0].ok === true && again?.code === "answered", "Studio grades the pick against the tutor's answer and only then shows the answer, why and its citation; a question is answered once", JSON.stringify({ r1: { ...r1, room: 0 }, r2: { ...r2, room: 0 }, again: again?.code }));
  ok(prompts.length === calls && runArgs.length === runs && E.trusted(r.id).entries.some((e: any) => e.record === "review-room-check" && e.data.question === 2 && e.data.correct === false && e.data.by === "studio"), "grading runs no model and pays nothing; each answer is on the Task's ledger", String(prompts.length));
  const shown = (room.view(merge.id) as any).check.questions;
  ok(shown[1].answer === 1 && shown[1].choice === 0 && shown[1].result.correct === false && !!shown[1].why, "once answered, the page shows the captain's pick, the right one and why", JSON.stringify(shown[1])); }
await room.start(merge.id, { action: "ask", text: "Re-explain question 2 with the board.", lang: "en", confirm: offer.hash }, "captain"); await room.settle(merge.id);
const v2 = room.view(merge.id) as any;
ok(prompts[1].text.includes("Captain [teach]: 教我這個改動。") && prompts[1].text.includes("Tutor: ## Overview") && /1\. What does percent\(1999, 15\) return\? — A\) 300 B\) 299 C\) 299\.85; right: A; the captain chose A \(correct\)/.test(prompts[1].text) && /2\. .*the captain chose A \(missed\)/.test(prompts[1].text) && /B1-3 code/.test(prompts[1].text), "the next turn's prompt carries the conversation, the open check and the board", prompts[1].text.slice(-1500));
ok(v2.turns[1].status === "done" && v2.turns[1].claims.every((c: any) => c.basis === "cited"), "a reply citing a board excerpt and a source is cited");
ok(v2.turns[1].answer === FINAL2 && !v2.turns[1].claims.some((c: any) => /guidance|what I need/.test(c.text)), "only the tutor's final message is the answer: a preamble before its tools or a progress message before its answer never shows", JSON.stringify(v2.turns[1].answer));
ok(/multiple choice: Studio grades/.test(results.find(([n]) => n === "check_grade")?.[1].errors[0] ?? "") && (room.view(merge.id) as any).check.questions[0].result.by === "studio", "the tutor cannot grade a multiple-choice question: Studio's grade stands", JSON.stringify(results.find(([n]) => n === "check_grade")));
const t2src = (v2.sources as any[]).filter((x) => x.turn === 2);
ok(t2src[0].refused && t2src[0].url === undefined && t2src[0].text === "javascript:alert(document.cookie)", "a javascript: address is refused and kept as plain text, never an address", JSON.stringify(t2src[0]));
ok(/search results or a documentation host/.test(t2src[1].refused) && t2src[3].ok && t2src[3].url === "https://example.org/rounding-guide" && /search results/.test(t2src[4].refused), "a page is read only after this turn's search returned it, and only that page", JSON.stringify(t2src.slice(1, 5)));
ok(/at most 8 web calls a turn/.test(t2src[8].refused) && webCalls.filter(([k]) => k === "search").length === 5, "a turn makes at most eight web calls", JSON.stringify(t2src.map((x) => x.refused ?? "ok")));
const after = E.cards.view(E.cards.get(merge.id)!);
ok(after.reviewRoom?.questions === 2 && after.reviewRoom.turns === 2 && JSON.stringify(after.reviewRoom.check) === JSON.stringify({ asked: 2, graded: 2, correct: 1 }) && after.reviewRoom.sources.consulted === 7, "the merge card shows the room's summary: questions asked, the check score, sources consulted", JSON.stringify(after.reviewRoom));

// ---------- the merge card and readiness untouched; nothing to GitHub; the worktree untouched ----------
ok(readFileSync(cardFile, "utf8") === storedBefore && E.cards.get(merge.id)!.status === "open", "the stored merge card is unchanged and still open");
ok(JSON.stringify(after.options) === JSON.stringify(viewBefore.options) && JSON.stringify(after.detail?.codeEvidence) === JSON.stringify(viewBefore.detail?.codeEvidence) && JSON.stringify({ ...after, reviewRoom: undefined }) === JSON.stringify({ ...viewBefore, reviewRoom: undefined }), "the card's options, evidence and every other field are what they were: readiness unchanged");
ok(gitState() === gitBefore, "the worktree, its index and its refs are untouched by the room");
ok(fetched.every((u) => u.startsWith(H.toolUrl)) && !fetched.some((u) => /github/i.test(u)), "no request left Studio for GitHub or anywhere else during the turns", JSON.stringify(fetched.filter((u) => !u.startsWith(H.toolUrl))));
const stats = JSON.parse(readFileSync(join(data, "review-room-stats.json"), "utf8"))[r.id];
ok(stats?.card === merge.id && !!stats.openedAt && stats.turns === 2 && stats.check.correct === 1, "the per pull request record keeps: room opened, turns, check score", JSON.stringify(stats));

// ---------- narration: only the vendor that answered the scene speaks, once per scene ----------
let noVoice: any = null; try { await room.speech(merge.id, "t1"); } catch (e) { noVoice = e; }
ok(noVoice?.code === "no_voice" && !spoken.length && (room.view(merge.id) as any).offer.voice === null, "a tutor whose vendor has no voice of its own sends its narration nowhere", noVoice?.message);
Object.assign(reviewer, { provider: "codex", model: "t-2" });
noVoice = null; try { await room.speech(merge.id, "t1"); } catch (e) { noVoice = e; }
ok(noVoice?.code === "no_voice" && !spoken.length, "a scene keeps the vendor that answered it: switching the seat to a vendor with a voice does not send an older scene there", noVoice?.message);
script.push([["say", "The function rounds to the cent [diff:src/percent.ts:L2-3]."]]);
await room.start(merge.id, { action: "how", lang: "en", confirm: (room.view(merge.id) as any).offer.hash }, "captain"); await room.settle(merge.id);
const [say1, sayDup]: any[] = await Promise.all([room.speech(merge.id, "t3"), room.speech(merge.id, "t3")]), say2: any = await room.speech(merge.id, "t3");
ok(say1.cached === false && sayDup.src === say1.src && say2.cached === true && spoken.length === 1 && /rounds to the cent/.test(spoken[0]) && !/\[diff:|\[ledger:|##/.test(spoken[0]) && (room.view(merge.id) as any).offer.voice?.vendor === "openai", "a Codex tutor's scene is narrated by its own vendor once (two requests at once make one), without citations, then served from the room", JSON.stringify({ say1, spoken }));
ok(Buffer.compare(room.audio(merge.id, say1.src.split("/").at(-1)), Buffer.alloc(256, 7)) === 0 && E.trusted(r.id).entries.some((e: any) => e.record === "review-room-voice" && e.data.vendor === "openai" && e.data.turn === 3), "the narration is stored in the room and on the ledger");
Object.assign(reviewer, saved);
noVoice = null; try { await room.speech(merge.id, "t3"); } catch (e) { noVoice = e; }
ok(noVoice?.code === "no_voice" && /changed/.test(noVoice.message) && spoken.length === 1, "when the seat's vendor changes after a scene, its narration is not sent anywhere", noVoice?.message);
// ---------- a tutor that ends without an answer: the turn fails and says so, never a blank scene ----------
// outside a lesson a scene may leave its chapter out, or name chapters in any order; a state called "end", a label with ";"
const r4 = results.length;
script.push([["board_draw", { items: [{ type: "states", title: "Ends", states: [{ id: "start", label: "Start" }, { id: "end", label: "End; (done) {x}" }], transitions: [{ from: "start", to: "end", label: "finish; now) --> & go ==> on", cite: "diff:src/percent.ts:L2-3" }] }] }],
  ["scene_show", { title: "No chapter", picture: "B1-1", points: [{ text: "One.", cites: [] }, { text: "Two.", cites: [] }] }],
  ["scene_show", { chapter: "watch", title: "A risk", picture: "B1-1", points: [{ text: "Halves round up [diff:src/percent.ts:L2-3].", cites: ["diff:src/percent.ts:L2-3"] }, { text: "Pinned [diff:test/percent.test.ts].", cites: ["diff:test/percent.test.ts"] }] }],
  ["scene_show", { chapter: "what", title: "Back to what", picture: "B1-1", points: [{ text: "One.", cites: [] }, { text: "Two.", cites: [] }] }],
  ["msg", "Let me check the diff first."], ["fs_search", { text: "percent" }]]);
await room.start(merge.id, { action: "why", lang: "en", confirm: (room.view(merge.id) as any).offer.hash }, "captain"); await room.settle(merge.id);
{ const v4 = room.view(merge.id) as any, t4s = v4.turns[3]?.scenes ?? [], made = results.slice(r4).filter(([n]) => n === "scene_show").map(([, j]) => j.error ?? "ok"), fig = v4.board.find((b: any) => b.turn === 4 && b.type === "states");
  ok(JSON.stringify(made) === JSON.stringify(["ok", "ok", "ok"]) && JSON.stringify(t4s.map((x: any) => x.chapter ?? null)) === JSON.stringify([null, "watch", "what"]),
    "outside a lesson (why, how, a question, a quiz) a scene may leave its chapter out or name chapters in any order", JSON.stringify({ made, chapters: t4s.map((x: any) => x.chapter) }));
  const g = fig && /flowchart LR\n {2}s_start\[Start\]\n {2}s_end\[End done x\]\n {2}s_start -->\|finish now go on\| s_end$/.test(fig.code);
  ok(!!g, "a state machine's states are drawn under Studio's own ids (a state called end is not a keyword) and labels lose ; ) } that would cut them", fig?.code); }
{ const t4 = (room.view(merge.id) as any).turns[3];
  ok(t4?.status === "failed" && /the tutor ended without an answer/.test(t4.error ?? "") && t4.answer === "" && !t4.claims.length, "a tutor that ends after a tool call with no final message fails the turn with the reason; its preamble is not the answer", JSON.stringify(t4 && { status: t4.status, error: t4.error, answer: t4.answer, claims: t4.claims })); }
// ---------- the explanation in another language: one confirmed translation turn, text only, kept per turn and language ----------
{ const v0 = room.view(merge.id) as any, t1o = v0.turns[0];
  ok(JSON.stringify(v0.translate.pending.en) === "[1]" && JSON.stringify(v0.translate.pending["zh-TW"]) === "[2,3]" && v0.translate.confirmed === false, "the room knows which answers are not in a language yet", JSON.stringify(v0.translate));
  let need: any = null; try { await room.translate(merge.id, { lang: "en" }, "captain"); } catch (e) { need = e; }
  ok(need?.code === "confirm_required" && /^[0-9a-f]{16}$/.test(need.offer?.translate?.hash ?? "") && typeof need.offer.translate.estimate === "number" && runArgs.length === 4, "translating is a small paid round: it asks to confirm first, with its estimate, and nothing runs", JSON.stringify(need?.offer?.translate));
  const blocks = t1o.claims.filter((c: any) => ["claim", "aside", "heading"].includes(c.kind)).map((c: any) => `EN ${c.text}`);
  let figs: any = {};
  const tr = (p1: string) => JSON.stringify({ turns: [{ n: 1, figures: figs, scenes: t1o.scenes.map((x: any, m: number) => m ? { title: x.title, points: x.points.map((q: any) => q.text) } : { title: "Rounding to the cent", points: [p1, "a".repeat(100), "It was probably for invoices."] }), claims: blocks, answer: `EN ${t1o.answer}` }] });
  // a translation that drops a citation is not kept: the original shows
  script.push([["msg", tr("Lost its citation.")]]);
  const runs0 = runArgs.length; await room.translate(merge.id, { lang: "en", confirm: need.offer.translate.hash }, "captain"); await room.settle(merge.id);
  const v1 = room.view(merge.id) as any, trArgs = runArgs.at(-1);
  ok(runArgs.length === runs0 + 1 && trArgs.tools.length === 0 && /translation/.test(trArgs.title) && /TRANSLATION ONLY/.test(prompts.at(-1)!.text) && !/THE DIFF/.test(prompts.at(-1)!.text), "the translation round gets no tool and no code: only the room's text", JSON.stringify({ tools: trArgs.tools.length, title: trArgs.title }));
  ok(!v1.translations.en?.["1"] && JSON.stringify(v1.translating.dropped) === "[1]" && v1.translate.confirmed === true, "a translation that lost a citation is not kept: the validator drops it and the original shows", JSON.stringify(v1.translating));
  figs = { "B1-20": ["Who calls it", "The cart", "percent()", "Math", "calls it", "rounds"], "B1-15": ["only one word"] };
  script.push([["msg", tr("Rounded to the cent [diff:src/percent.ts:L2-3]")]]);
  await room.translate(merge.id, { lang: "en" }, "captain"); await room.settle(merge.id);
  const v2 = room.view(merge.id) as any, kept = v2.translations.en?.["1"];
  ok(kept?.scenes[0].title === "Rounding to the cent" && kept.claims.length === blocks.length && /^EN /.test(kept.answer) && JSON.stringify(v2.translate.pending.en) === "[]" && E.trusted(r.id).entries.some((e: any) => e.record === "review-room-translate" && e.data.lang === "en" && JSON.stringify(e.data.kept) === "[1]"),
    "confirmed once, the next translation runs without asking again; a valid one is kept per turn and language, and recorded", JSON.stringify(kept));
  ok(JSON.stringify(kept?.figures?.["B1-20"]) === JSON.stringify(["Who calls it", "The cart", "percent()", "Math", "calls it", "rounds"]) && !kept?.figures?.["B1-15"] && /figures/.test(prompts.at(-1)!.text) && prompts.at(-1)!.text.includes('"B1-20":["Who calls percent","Cart","percent()","Math","calls","rounds"]') && prompts.at(-1)!.text.includes('"B1-15":["Rounding","percent()","Fractions of a cent kept","Rounded to the cent","Math.round"]'),
    "a translation carries the drawings' words too (asked in order, per drawing): a drawing whose words came back whole is kept, one with a missing word stays as drawn", JSON.stringify(kept?.figures));
  const runs1 = runArgs.length; await room.translate(merge.id, { lang: "en" }, "captain");
  let over: any = null; { const { translationErrors } = await import("../src/domain/review-room"); over = translationErrors(t1o, { scenes: t1o.scenes.map((x: any, m: number) => m ? { title: x.title, points: x.points.map((q: any) => q.text) } : { title: "x".repeat(49), points: ["a", "b", "c"] }), claims: blocks, answer: t1o.answer }); }
  ok(runArgs.length === runs1 && over.some((e: string) => /title is too long/.test(e)) && over.some((e: string) => /citations differ/.test(e)), "switching to a language already kept runs nothing; the validator holds a translation to the board's limits and the original's citations", JSON.stringify(over)); }
// ---------- regenerate: explain a turn again with a model the captain picks; both answers are kept ----------
{ E.deps.usableModels = () => U(["tutor", "t-1"], ["codex", "c-1"], ["claude", "x-1", { runnable: false, held: "claude's quota could not be read" }]);
  const tutors = (room.view(merge.id) as any).tutors;
  ok(tutors.length === 3 && tutors.find((t: any) => t.provider === "tutor").current && tutors.find((t: any) => t.provider === "claude").runnable === false && /quota/.test(tutors.find((t: any) => t.provider === "claude").held) && tutors.find((t: any) => t.provider === "codex").level === "vendor", "the room lists the models this machine can run, the current tutor marked, a held one with its reason", JSON.stringify(tutors));
  let e1: any = null; try { await room.start(merge.id, { regenerate: 3, pick: { provider: "claude", model: "x-1" }, confirm: "x" }, "captain"); } catch (e) { e1 = e; }
  let e2: any = null; try { await room.start(merge.id, { regenerate: 3, pick: { provider: "codex", model: "c-1" } }, "captain"); } catch (e) { e2 = e; }
  ok(e1?.code === "held" && /quota/.test(e1.message) && e2?.code === "confirm_required" && e2.offer.provider === "codex" && e2.offer.model === "c-1" && e2.offer.hash !== (room.view(merge.id) as any).offer.hash, "a held model cannot be picked; a runnable one asks to confirm its own paid round first", JSON.stringify({ e1: e1?.message, e2: e2?.offer }));
  const e3 = await (async () => { try { await room.start(merge.id, { action: "how", pick: { provider: "codex", model: "c-1" }, confirm: e2.offer.hash }, "captain"); return null; } catch (e) { return e as any; } })();
  ok(e3?.code === "bad_pick" && (room.view(merge.id) as any).turns.length === 4, "a model is picked only to explain a finished answer again: a new question with a pick is refused", e3?.message);
  script.push([["say", "Again, more briefly: it rounds to the cent [diff:src/percent.ts:L2-3]."]]);
  await room.start(merge.id, { regenerate: 3, pick: { provider: "codex", model: "c-1" }, confirm: e2.offer.hash, lang: "en" }, "captain"); await room.settle(merge.id);
  const turns = (room.view(merge.id) as any).turns, again = turns.at(-1), led = E.trusted(r.id).entries.filter((e: any) => e.record === "review-room-turn").at(-1);
  ok(again.regenOf === 3 && again.provider === "codex" && again.text === turns[2].text && turns[2].status === "done" && /Again, more briefly/.test(again.answer) && led.data.regenerate?.of === 3 && led.data.regenerate.provider === "codex" && led.data.regenerate.model === "c-1",
    "the regeneration asks the same question on the picked model; the old answer is kept beside it; the choice is on the turn and the ledger", JSON.stringify({ again: { n: again.n, regenOf: again.regenOf, provider: again.provider }, led: led.data.regenerate }));
  delete E.deps.usableModels; }
// ---------- a docs_hosts policy naming a host of user content refuses the turn ----------
E.policies.setProject("sandbox", { install: false, review_room: { docs_hosts: ["raw.githubusercontent.com"] } } as any);
refusal = null; try { await room.start(merge.id, { action: "how", confirm: (room.view(merge.id) as any).offer.hash }, "captain"); } catch (e) { refusal = e; }
E.policies.setProject("sandbox", { install: false, review_room: { docs_hosts: [] } } as any);
ok(refusal?.code === "policy" && /raw\.githubusercontent\.com/.test(refusal.message) && /user content/.test(refusal.message), "a review_room.docs_hosts policy that names a host of user content refuses the turn, saying why", refusal?.message);
// ---------- a changed skill text refuses the turn ----------
const pin = ROOM_SKILLS[1] as any, real = pin.sha256; pin.sha256 = "0".repeat(64);
refusal = null; try { await room.start(merge.id, { action: "why", confirm: offer.hash }, "captain"); } catch (e) { refusal = e; } pin.sha256 = real;
ok(refusal?.code === "skill_pin", "a skill whose text no longer matches its pin refuses the turn", refusal?.message);

// ---------- Save to Library: a read-only snapshot of the room, a version per save ----------
const aid = `room-${merge.id.toLowerCase()}`, { ArtifactStore } = await import("../src/artifacts"), lib = new ArtifactStore(data);
const fetchedBefore = fetched.length, sv1: any = await room.saveToLibrary(merge.id, "captain");
{ const snap: any = room.librarySnapshot(aid), art = lib.get(aid), img = snap.view.board.find((b: any) => b.type === "image" && b.turn === 1);
  ok(sv1.artifact === aid && sv1.n === 1 && art?.source === "room" && art.type === "doc" && lib.latest(aid)?.files.some((f: any) => f.path === "room.json") && (room.view(merge.id) as any).library?.versions.length === 1, "Save to Library writes the room as a Library artifact (source room), its snapshot a version", JSON.stringify({ sv1, art }));
  ok(snap.view.open === false && snap.view.offer === null && !snap.view.tutors.length && snap.view.translate === null && snap.subject.kind === "merge" && snap.subject.head === head && snap.tutors.some((t: any) => t.provider === "tutor") && typeof snap.cost.usd === "number" && snap.savedAt,
    "the snapshot is read-only (no offer, no tutors to pick, nothing to translate) and records the subject, its head, the tutors, the cost and the date", JSON.stringify({ subject: snap.subject, tutors: snap.tutors, cost: snap.cost }));
  ok(/Math\.round/.test(snap.cites["diff:src/percent.ts:L2-3"]?.text ?? "") && snap.cites[`ledger:#${ledgerSeq}`]?.check === "firstmate/ci" && snap.view.translations.en?.["1"] && snap.view.check.questions.every((q: any) => q.result && q.choice != null),
    "every citation is resolved into the snapshot (the diff hunk copied), with every language made and the check's answers", JSON.stringify(Object.keys(snap.cites)));
  const raw = JSON.stringify(snap);
  ok(JSON.stringify(snap.view.turns[0].scenes.map((x: any) => x.chapter)) === JSON.stringify(["what", "talks", "change", "change", "lifecycle", "sequence", "watch"]) && snap.view.board.some((b: any) => b.type === "sequence"), "the lesson's chapters and their figures are kept in the room and its Library snapshot");
  ok(!/src\/percent\.ts rounds|rounding in src\/percent\.ts|127\.0\.0\.1:4210|wiki\.intranet\.local|192\.168\.1\.10/.test(raw) && !snap.view.illustrations.length && snap.view.sources.filter((x: any) => x.refused).every((x: any) => !x.query && !x.url && !x.text && x.refused === "refused by Studio's web filter"),
    "the Library keeps no refused text: no illustration prompt the privacy filter refused, no refused query or address (only that it was refused, and why)", JSON.stringify(snap.view.sources.slice(0, 3)));
  ok(img && new RegExp(`^/api/review-room/library/${aid}/1/asset/B1-\\d+\\.png$`).test(img.src) && Buffer.compare(room.libraryAsset(aid, 1, img.src.split("/").at(-1)), PNG) === 0 && fetched.length === fetchedBefore, "its pictures are copied into it and served from it; saving asked nothing of GitHub or the web", JSON.stringify(img)); }
{ const both: any[] = await Promise.all([room.saveToLibrary(merge.id, "captain"), room.saveToLibrary(merge.id, "captain"), room.saveToLibrary(merge.id, "captain")]);
  const seen = [2, 3, 4].map((n) => room.librarySnapshot(aid, n).view.library?.versions.length ?? 0);
  ok(new Set(both.map((b) => b.n)).size === 3 && JSON.stringify(lib.versions(aid).map((v: any) => v.n)) === "[1,2,3,4]" && lib.versions(aid).every((v: any) => !lib.verify(aid, v.n).length) && JSON.stringify(seen) === "[1,2,3]",
    "three saves at once each get their own version, one after another: each snapshot already knows the version saved before it", JSON.stringify({ n: both.map((b) => b.n), seen })); }
// ---------- the room never answers the card; once the card is answered the room is read-only ----------
// a tutor turn still running when the card is answered: the room's save waits for it to end, never a half-finished scene
let releaseTurn!: () => void; const turnGate = new Promise<void>((res) => (releaseTurn = res));
script.push([["msg", "Reading the diff first."], ["wait", turnGate], ["say", "A late answer [diff:src/percent.ts:L2-3]."]]);
await room.start(merge.id, { action: "why", lang: "en", confirm: (room.view(merge.id) as any).offer.hash }, "captain");
// what the tutor has said so far is on the room's record while it works: a reload (another instance reads the files) sees it
await until(() => /Reading the diff first/.test((room.view(merge.id) as any).progress?.said ?? ""), 20000);
{ const pg = (installReviewRoom(E, { dataDir: data }).view(merge.id) as any).progress;
  ok(/Reading the diff first/.test(pg?.said ?? "") && pg.turn === (room.view(merge.id) as any).turns.at(-1).n, "a running turn's progress is persisted as it works: another instance reading the files (a restart: the turn reads interrupted) still shows what the tutor had said", JSON.stringify(pg)); }
// the room finishes (the engine's call when its card is answered) while the turn still runs
room.cardAnswered(E.cards.get(merge.id)!);
{ const f0 = JSON.parse(readFileSync(join(data, "runs", r.id, "review-room", `${merge.id}.json`), "utf8"));
  ok(lib.versions(aid).length === 4 && f0.finished && !f0.finished.tried && f0.turns.at(-1).status === "running", "answered while a turn still runs: the room is marked finished, and its save waits for the turn", JSON.stringify(f0.finished));
  releaseTurn(); await room.settle(merge.id); await until(() => lib.versions(aid).length === 5, 20000);
  const last: any = room.librarySnapshot(aid);
  ok(last.n === 5 && last.view.turns.length === 6 && !last.view.turns.some((t: any) => t.status === "running") && /A late answer/.test(last.view.turns.at(-1).answer), "once the turn has ended the room is saved, with no turn left running in it", JSON.stringify(last.view.turns.map((t: any) => t.status))); }
await E.answer(merge.id, { choice: "merge", by: "captain", aligned: merge.detail!.intents.map((_: any, i: number) => i) });
await until(() => ["succeeded", "failed"].includes(E.get(r.id)!.status), 60000);
ok(E.get(r.id)!.status === "succeeded", "the captain's merge answer goes through as before: the room changed nothing about readiness", `${E.get(r.id)!.status} ${E.get(r.id)!.error}`);
refusal = null; try { await room.start(merge.id, { action: "how", confirm: offer.hash }, "captain"); } catch (e) { refusal = e; }
ok(refusal?.code === "closed" && (room.view(merge.id) as any).turns.length === 6, "after the card is answered the room stays readable and takes no turn");
refusal = null; try { await room.speech(merge.id, "t3"); } catch (e) { refusal = e; }
ok(refusal?.code === "closed", "and it no longer speaks");
// the room ended: Studio saves it again, a new version; the snapshot reads with the room's folder and the worktree gone
room.view(merge.id); await room.settle(merge.id);
{ const vs = lib.versions(aid);
  ok(vs.length === 5 && /merge card was answered/.test(vs[4].summary ?? "") && (room.view(merge.id) as any).library.versions.length === 5, "when the merge card is answered, the room is saved again: one artifact, its history kept as versions", JSON.stringify(vs.map((v: any) => [v.n, v.summary])));
  room.view(merge.id); await room.settle(merge.id);
  ok(lib.versions(aid).length === 5, "an ended room is saved once, not again on a listing or a view");
  const { rmSync, renameSync } = await import("node:fs"), rdir = join(data, "runs", r.id, "review-room"); renameSync(rdir, `${rdir}.away`); rmSync(wt, { recursive: true, force: true });
  const snap: any = room.librarySnapshot(aid), v1: any = room.librarySnapshot(aid, 1), img = snap.view.board.find((b: any) => b.type === "image" && b.turn === 1);
  ok(snap.n === 5 && v1.n === 1 && /Math\.round/.test(snap.cites["diff:src/percent.ts:L2-3"]?.text ?? "") && Buffer.compare(room.libraryAsset(aid, 5, img.src.split("/").at(-1)), PNG) === 0 && !snap.integrity.length,
    "offline: with the room's folder and the worktree removed, the saved room still opens, its citations and pictures inside it, every version readable", JSON.stringify({ n: snap.n, integrity: snap.integrity }));
  let bad: any = null; try { room.librarySnapshot("room-../../x"); } catch (e) { bad = e; }
  let badAsset: any = null; try { room.libraryAsset(aid, 5, "../room.json"); } catch (e) { badAsset = e; }
  ok(bad?.code === "not_found" && badAsset?.code === "not_found", "only a saved room's own id and its own pictures are served"); renameSync(`${rdir}.away`, rdir);
  lib.remove(aid); const gone = (room.view(merge.id) as any).library, again: any = await room.saveToLibrary(merge.id, "captain"), kept = (room.view(merge.id) as any).library;
  ok(gone === null && again.n === 1 && JSON.stringify(kept?.versions.map((v: any) => v.n)) === "[1]", "deleted from the Library, the room no longer links it, and the next save starts again at v1", JSON.stringify({ gone, again: again.n, kept: kept?.versions })); }
{ const f = join(data, "runs", r.id, "review-room", `${merge.id}.json`), saved = readFileSync(f, "utf8"), old = JSON.parse(saved); delete old.finished; delete old.library; writeFileSync(f, JSON.stringify(old));
  // an older room (answered before Studio recorded when a room finishes): listing the cards and opening it saves nothing
  const before = lib.versions(aid).length, plain = installReviewRoom(E, { dataDir: data }); plain.summary(E.cards.get(merge.id)!); plain.view(merge.id); E.cards.view(E.cards.get(merge.id)!); await plain.settle(merge.id);
  ok(lib.versions(aid).length === before, "a room that finished before this version is not saved by a listing or a view: no burst of snapshots after an update", String(lib.versions(aid).length));
  // a save that fails is recorded once and not retried by itself
  let tries = 0; const failing: any = { get: () => null, create: () => { tries++; throw new Error("disk full"); }, versions: () => [], latest: () => null };
  const broken = installReviewRoom(E, { dataDir: data, artifacts: failing }); broken.cardAnswered(E.cards.get(merge.id)!); await broken.settle(merge.id);
  broken.cardAnswered(E.cards.get(merge.id)!); broken.summary(E.cards.get(merge.id)!); broken.view(merge.id); await broken.settle(merge.id);
  const after = JSON.parse(readFileSync(f, "utf8"));
  ok(tries === 1 && after.finished?.tried === true && /disk full/.test(after.finished?.error ?? ""), "a failed Library save is recorded with its error and not retried on the next answer, listing or view", JSON.stringify({ tries, finished: after.finished }));
  writeFileSync(f, saved); }
// a restart while an illustration was being drawn: the room reads it as interrupted, never pending forever
{ const f = join(data, "runs", r.id, "review-room", `${merge.id}.json`), rr = JSON.parse(readFileSync(f, "utf8")); rr.board.push({ id: "B9-1", turn: 9, type: "image", kind: "illustration", status: "pending", src: null, basis: "illustration", cites: [] });
  writeFileSync(f, JSON.stringify(rr)); const fresh = installReviewRoom(E, { dataDir: data });
  ok((fresh.view(merge.id) as any).board.find((b: any) => b.id === "B9-1")?.status === "failed", "after a restart an illustration left pending reads as interrupted"); }
globalThis.fetch = realFetch; H.stop(); end();
