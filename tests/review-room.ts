import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room (docs/units/review-room.md) on a real code-firstmate Task stopped at its merge card, with stub
// providers and temporary data: the room belongs to merge cards only; a turn is a paid round the captain confirms; the
// round is read-only (no write tool, no folder to write, no host beyond its model) with the pinned tutor and pstack
// skills; the board's excerpts come from the real commits; claims carry their basis and an uncited one is an inference;
// the web tools refuse filtered queries and private hosts and log every call; history reaches the next turn; the merge
// card shows the room's summary while its stored file, options, evidence and readiness stay as they were; nothing goes
// to GitHub; the per pull request record is kept.        bun tests/review-room.ts
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
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
const webCalls: [string, string][] = [];
installCode(E, { dataDir: data, projects: new Projects(data), reviewWeb: (check) => ({
  search: async (q) => { webCalls.push(["search", q]); return { configured: true, status: 200, url: "https://search.example/?q=x", text: "Math.round rounds half up" }; },
  fetch: async (u) => { const why = check(u); if (why) throw new Error(`refused: ${why}`); webCalls.push(["fetch", u]); return { status: 200, type: "text/html", url: u, text: "MDN page" }; } }) });
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
ok(viewBefore.reviewRoom?.href === `#/review/${merge.id}` && viewBefore.reviewRoom.turns === 0 && viewBefore.detail?.codeEvidence?.state === "success", "the merge card shows Open review room (no turn yet) beside ready evidence", JSON.stringify(viewBefore.reviewRoom));

// ---------- a turn is paid: it needs the captain's confirmation of the exact model ----------
let refusal: any = null; try { await room.start(merge.id, { action: "teach" }, "captain"); } catch (e) { refusal = e; }
ok(refusal?.code === "confirm_required" && refusal.offer?.provider === "tutor" && refusal.offer?.model === "t-1" && typeof refusal.offer.hash === "string", "a turn without the confirmation is refused and offers the tutor's provider and model", JSON.stringify(refusal?.offer ?? refusal?.message));
const offer = room.view(merge.id).offer as any;
// the tutor never runs on the maker's model
const reviewer = run.def.roles.find((x: any) => x.id === "reviewer")!; const saved = { ...reviewer }; Object.assign(reviewer, { provider: undefined, model: undefined });
ok(/maker's model/.test((room.view(merge.id).offer as any).error ?? ""), "a tutor on the maker's model is refused", JSON.stringify(room.view(merge.id).offer));
Object.assign(reviewer, saved);
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
      const res = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const j = await res.json(); results.push([name, j]);
      yield { type: "toolStart", id: name, name, args } as any; yield { type: "toolEnd", id: name, rows: null, error: j?.error ?? null, result: JSON.stringify(j) } as any; }
    yield { type: "turnEnd", status: "ok", usage: { usd: 0.02, inTokens: 10, outTokens: 5 } } as any; } }; } });
const baseProvider = E.deps.provider; E.deps.provider = (id?: string, model?: string) => id === "tutor" ? scripted(id, model ?? "") : baseProvider(id, model);
const runArgs: any[] = []; const baseRun = E.deps.agents.run.bind(E.deps.agents); E.deps.agents.run = (o: any) => { if (o.kind === "review-room") runArgs.push(o); return baseRun(o); };
const MDN = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round";
script.push([
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
  ["check_ask", { questions: ["What does percent(1999, 15) return, and why?", "Where could rounding go wrong for a user?"] }],
  ["fs_write", { path: "src/percent.ts", content: "x" }],
  ["say", `## Overview\n\nThe change adds \`percent\`, which rounds to the cent [diff:src/percent.ts:L2-3].\n\nIt was probably added for invoices.\n\n- The test pins the rounding [ledger:#${ledgerSeq}]\n- An old commit explains it [commit:deadbeef]\n\nWant me to go deeper?`]]);
const started = await room.start(merge.id, { action: "teach", lang: "zh-TW", confirm: offer.hash }, "captain");
let busy = ""; try { await room.start(merge.id, { action: "how", confirm: offer.hash }, "captain"); } catch (e: any) { busy = e.code; }
ok(started.running === 1 && started.turns[0].status === "running" && busy === "busy", "a confirmed turn starts at once, and a second one waits: one turn at a time per room", busy);
await room.settle(merge.id);
const v1 = room.view(merge.id, true) as any, t1 = v1.turns[0];
ok(t1.status === "done" && /rounds to the cent/.test(t1.answer) && t1.provider === "tutor" && t1.model === "t-1" && t1.lang === "zh-TW", "the answer is stored with its provider, model and the captain's language", JSON.stringify(t1).slice(0, 400));

// ---------- the round: read-only, sandboxed, no egress beyond the model, the pinned skills ----------
const a = runArgs[0];
ok(!!a && JSON.stringify(a.tools.map((t: any) => t.name)) === JSON.stringify(ROOM_TOOLS) && !a.tools.some((t: any) => /write|replace|run_tests|run_command|commit|push|merge|comment|review_verdict/.test(t.name)), "the round gets only the room's read, board, check and web tools: no write tool of any kind", JSON.stringify(a?.tools.map((t: any) => t.name)));
ok(JSON.stringify(a.sandbox) === JSON.stringify({ writes: [], reads: [], allow: [] }), "the round runs in the round sandbox with nothing to write and no host beyond its model", JSON.stringify(a.sandbox));
ok(results.some(([n, j]) => n === "fs_write" && /no such tool/.test(j.error ?? "")), "a write tool the tutor asks for does not exist");
const skillTexts = ROOM_SKILLS.map((s) => readFileSync(join(root, s.ref), "utf8"));
ok(ROOM_SKILLS.every((s, i) => createHash("sha256").update(skillTexts[i]).digest("hex") === s.sha256), "each room skill is pinned by the sha256 of its exact text");
ok(skillTexts.every((t) => prompts[0].system.includes(t.trim())) && /Role: review room tutor/.test(prompts[0].system) && /Skill: how/.test(prompts[0].system) && /Skill: why/.test(prompts[0].system) && /Skill: teach/.test(prompts[0].system), "the round's instructions carry the tutor role and the adapted how, why and teach skills");
const recDir = join(data, "runs", r.id, "nodes", merge.node, `room-${merge.id}-1`);
ok(["prompt.md", "system.md", "stream.jsonl", "report.json"].every((f) => existsSync(join(recDir, f))) && /review-room-tutor@sha256:/.test(readFileSync(join(recDir, "prompt.md"), "utf8")) && /rounds to the cent/.test(readFileSync(join(recDir, "report.json"), "utf8")), "the turn leaves a round record: prompt with its skill pins, system, stream and report");
const rec = E.trusted(r.id).entries.filter((e: any) => e.record === "review-room-turn");
ok(rec.length === 1 && rec[0].data.card === merge.id && rec[0].data.provider === "tutor" && rec[0].data.confirm === offer.hash && rec[0].data.skills.length === 4 && rec[0].data.check.asked === 2, "the turn is on the Task's signed ledger: card, provider, the confirmation, the skill pins, the check", JSON.stringify(rec[0]?.data));
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
ok(find(/old commit/)?.basis === "inference" && find(/old commit/)?.cites[0].ok === false, "a citation Studio cannot verify (no such commit) leaves the claim an inference");
ok(find(/Overview/)?.kind === "heading" && find(/deeper/)?.kind === "aside", "headings and offers are not claims");
const cDiff: any = await room.cite(merge.id, "diff:src/percent.ts:L2-3"), cLedger: any = await room.cite(merge.id, `ledger:#${ledgerSeq}`), cSource: any = await room.cite(merge.id, "source:8");
let badCite = ""; try { await room.cite(merge.id, "diff:README.md"); } catch (e: any) { badCite = e.code; }
ok(/Math\.round/.test(cDiff.text) && cLedger.check === "firstmate/ci" && cLedger.task === r.id && cSource.url === MDN && badCite === "bad_cite", "a citation opens what it rests on: the diff hunk, the ledger entry, the web source", JSON.stringify({ cLedger, cSource }));

// ---------- the web tools: filtered, logged, nothing private out ----------
const src = v1.sources as any[];
ok(src.length === 8 && src.filter((s) => s.refused).length === 6 && src.filter((s) => s.ok).length === 2, "every web call is logged as a source, refused ones with the reason", JSON.stringify(src));
ok(/file of this repository/.test(src[0].refused) && /line of this change/.test(src[1].refused) && /private address/.test(src[2].refused) && /by number/.test(src[4].refused) && /private host/.test(src[5].refused) && /private host/.test(src[6].refused), "refused: a repository path, a line of the diff, a private address, an IP address, localhost, a private domain", JSON.stringify(src.map((s) => s.refused)));
ok(JSON.stringify(webCalls) === JSON.stringify([["search", "JavaScript Math.round rounding of halves"], ["fetch", MDN]]), "only the clean query and the public page reach the web backend", JSON.stringify(webCalls));

// ---------- the next turn carries the history; the check is graded ----------
script.push([["check_grade", { results: [{ n: 1, correct: true, note: "300 cents" }, { n: 2, correct: false, note: "missed half-cent rounding" }] }], ["say", "You missed how halves round [board:B1-3]. Math.round rounds 0.5 up [source:8]."]]);
await room.start(merge.id, { action: "ask", text: "1: it returns 300. 2: I am not sure.", lang: "en", confirm: offer.hash }, "captain"); await room.settle(merge.id);
const v2 = room.view(merge.id) as any;
ok(prompts[1].text.includes("Captain [teach]: 教我這個改動。") && prompts[1].text.includes("Tutor: ## Overview") && /1\. What does percent\(1999, 15\) return, and why\? \[not graded yet\]/.test(prompts[1].text) && /B1-3 code/.test(prompts[1].text), "the next turn's prompt carries the conversation, the open check and the board", prompts[1].text.slice(-1500));
ok(v2.turns[1].status === "done" && v2.turns[1].claims.every((c: any) => c.basis === "cited"), "a reply citing a board excerpt and a source is cited");
const after = E.cards.view(E.cards.get(merge.id)!);
ok(after.reviewRoom?.questions === 2 && after.reviewRoom.turns === 2 && JSON.stringify(after.reviewRoom.check) === JSON.stringify({ asked: 2, graded: 2, correct: 1 }) && after.reviewRoom.sources.consulted === 2, "the merge card shows the room's summary: questions asked, the check score, sources consulted", JSON.stringify(after.reviewRoom));

// ---------- the merge card and readiness untouched; nothing to GitHub; the worktree untouched ----------
ok(readFileSync(cardFile, "utf8") === storedBefore && E.cards.get(merge.id)!.status === "open", "the stored merge card is unchanged and still open");
ok(JSON.stringify(after.options) === JSON.stringify(viewBefore.options) && JSON.stringify(after.detail?.codeEvidence) === JSON.stringify(viewBefore.detail?.codeEvidence) && JSON.stringify({ ...after, reviewRoom: undefined }) === JSON.stringify({ ...viewBefore, reviewRoom: undefined }), "the card's options, evidence and every other field are what they were: readiness unchanged");
ok(gitState() === gitBefore, "the worktree, its index and its refs are untouched by the room");
ok(fetched.every((u) => u.startsWith(H.toolUrl)) && !fetched.some((u) => /github/i.test(u)), "no request left Studio for GitHub or anywhere else during the turns", JSON.stringify(fetched.filter((u) => !u.startsWith(H.toolUrl))));
const stats = JSON.parse(readFileSync(join(data, "review-room-stats.json"), "utf8"))[r.id];
ok(stats?.card === merge.id && !!stats.openedAt && stats.turns === 2 && stats.check.correct === 1, "the per pull request record keeps: room opened, turns, check score", JSON.stringify(stats));

// ---------- a changed skill text refuses the turn ----------
const pin = ROOM_SKILLS[1] as any, real = pin.sha256; pin.sha256 = "0".repeat(64);
refusal = null; try { await room.start(merge.id, { action: "why", confirm: offer.hash }, "captain"); } catch (e) { refusal = e; } pin.sha256 = real;
ok(refusal?.code === "skill_pin", "a skill whose text no longer matches its pin refuses the turn", refusal?.message);

// ---------- the room never answers the card; once the card is answered the room is read-only ----------
await E.answer(merge.id, { choice: "merge", by: "captain", aligned: merge.detail!.intents.map((_: any, i: number) => i) });
await until(() => ["succeeded", "failed"].includes(E.get(r.id)!.status), 60000);
ok(E.get(r.id)!.status === "succeeded", "the captain's merge answer goes through as before: the room changed nothing about readiness", `${E.get(r.id)!.status} ${E.get(r.id)!.error}`);
refusal = null; try { await room.start(merge.id, { action: "how", confirm: offer.hash }, "captain"); } catch (e) { refusal = e; }
ok(refusal?.code === "closed" && (room.view(merge.id) as any).turns.length === 2, "after the card is answered the room stays readable and takes no turn");
globalThis.fetch = realFetch; H.stop(); end();
