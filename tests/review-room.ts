import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room (docs/units/review-room.md) on a real code-firstmate Task stopped at its merge card, with a scripted stub
// provider and temporary data: the room belongs to merge cards only; its page (baton's, the default) is a paid run the captain
// confirms, on the tutor the room adapts to this machine; a sandbox-off grant refuses it; the merge card shows the room's pages
// and what they cost, while its stored file, options, evidence and readiness stay as they were; the Library keeps a room's
// pages; a room from before keeps its whiteboard on disk, read by nothing, offered whole as a file; the board's turn, check,
// translation, picture and lesson calls are gone.        bun tests/review-room.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("review-room");
const root = join(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "crew-room-"));
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { Projects } = await import("../src/doors");
// the reviewer seat (and so the tutor) runs on its own model, different from the maker's
const def = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")
  .replace('- { id: reviewer, label: Reviewer, seat: reviewer, skill: "pack:firstmate/skills/reviewer.md" }', '- { id: reviewer, label: Reviewer, seat: reviewer, provider: tutor, model: t-1, skill: "pack:firstmate/skills/reviewer.md" }');
ok(def.includes("provider: tutor"), "fixture: the reviewer seat has its own model");
const H = await harness([def], { data, checkRoots: [] });
const E = H.engine;
installCode(E, { dataDir: data, projects: new Projects(data) });
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
notMerge = ""; try { await room.explain.generate(dispatch.id, { skill: "studio-baton", confirm: "x" }, "captain"); } catch (e: any) { notMerge = e.code; }
ok(notMerge === "not_merge", "a page on a card that is not a merge card is refused");
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
ok(viewBefore.reviewRoom?.href === `#/room/${merge.id}` && viewBefore.reviewRoom.versions === 0 && viewBefore.reviewRoom.usd === 0 && viewBefore.detail?.codeEvidence?.state === "success", "the merge card shows Open review room (no page yet) beside ready evidence", JSON.stringify(viewBefore.reviewRoom));


// ---------- a page is paid: it needs the captain's confirmation of the exact model ----------
const X = room.explain, id = merge.id;
let refusal: any = null; try { await X.generate(id, { skill: "studio-baton" }, "captain"); } catch (e) { refusal = e; }
ok(refusal?.code === "confirm_required" && refusal.offer?.provider === "tutor" && refusal.offer?.model === "t-1" && typeof refusal.offer.hash === "string", "a page without the confirmation is refused and offers the tutor's provider and model", JSON.stringify(refusal?.offer ?? refusal?.message));
const offer = room.view(id).offer as any;
ok(offer.independence?.level === "vendor" && offer.independence.adaptive === false && /Different vendor/.test(offer.independence.en) && !!offer.independence.zh, "the offer labels the tutor's independence from the author", JSON.stringify(offer.independence));
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
ok(o2.provider === "tutor" && o2.model === "t-1" && o2.independence.adaptive === false && o2.independence.outside === false && o2.hash !== undefined, "the approved reviewer stays the tutor when it can run, whatever else is signed in", JSON.stringify(o2));
delete E.deps.usableModels;

// ---------- a scripted provider: each round runs the next script, through the real tool route ----------
const script: any[][] = [];
const scripted = (pid: string, model: string) => ({ id: pid, model, sandboxFree: true, start(_system: string, _tools: any[], ctx: any) {
  return { interrupt() {}, async *send() {
    for (const [name, args] of script.shift() ?? []) {
      if (name === "msg") { yield { type: "delta", text: args } as any; yield { type: "message", text: args } as any; continue; }
      const res = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const j = await res.json();
      yield { type: "toolStart", id: name, name, args } as any; yield { type: "toolEnd", id: name, rows: null, error: j?.error ?? null, result: JSON.stringify(j) } as any; }
    yield { type: "turnEnd", status: "ok", usage: { usd: 0.25, inTokens: 100, outTokens: 50 } } as any; } }; } });
const baseProvider = E.deps.provider; E.deps.provider = (pid?: string, model?: string) => pid === "tutor" ? scripted(pid, model ?? "") : baseProvider(pid, model);
const realFetch = globalThis.fetch, fetched: string[] = []; globalThis.fetch = (async (u: any, i: any) => { fetched.push(String(u?.url ?? u)); return realFetch(u, i); }) as any;
const waitRun = async (n: number) => { await until(() => !X.running(id) && X.view(id).runs.find((x: any) => x.n === n)?.status !== "running", 60000); return X.view(id).runs.find((x: any) => x.n === n); };

// a sandbox-off grant refuses the page
const grant = E.grants.add({ kinds: ["sandbox-off"], until: new Date(Date.now() + 3600_000).toISOString(), project: null } as any, "captain (desktop)") as any;
refusal = null; try { await X.generate(id, { skill: "studio-baton", confirm: X.offer(id, "studio-baton", "generate").hash }, "captain"); await waitRun(1); } catch (e) { refusal = e; }
ok(refusal?.code === "sandbox" || /sandbox/.test(X.view(id).runs.at(-1)?.error ?? ""), "with a sandbox-off grant the tutor does not run", refusal?.message ?? X.view(id).runs.at(-1)?.error);
E.grants.revoke(grant.id, "captain (desktop)");

// ---------- baton makes the page: a version; the merge card says how many and what they cost ----------
const PAGE = (n: number) => `<!doctype html><html><head><meta charset="utf-8"><title>percent</title></head><body><h1>How percent works (v${n})</h1><p>Math.round keeps cents.</p></body></html>`;
const runsBefore = X.view(id).runs.length;
for (const n of [1, 2]) { script.push([["out_write", { path: ".baton/packet.json", content: "{}" }], ["out_write", { path: "index.html", content: PAGE(n) }], ["explain_done", { entry: "index.html", summary: `baton: what percent does (${n})` }], ["msg", "Done."]]);
  const s = await X.generate(id, { skill: "studio-baton", confirm: X.offer(id, "studio-baton", "generate").hash }, "captain"); await waitRun(s.running); }
const xv = X.view(id), sum: any = E.cards.view(E.cards.get(id)!).reviewRoom;
ok(xv.versions.length === 2 && xv.runs.length === runsBefore + 2 && xv.runs.slice(-2).every((x: any) => x.status === "done"), "two baton runs made two versions", JSON.stringify(xv.runs.map((x: any) => [x.n, x.status, x.error])));
ok(sum.versions === 2 && sum.usd === 0.5 && sum.latest?.n === 2 && sum.running === false && !("turns" in sum) && !("check" in sum) && !("sources" in sum), "the merge card's summary: the room's versions and what they cost, no turn, check or source counts", JSON.stringify(sum));
const v1: any = room.view(id);
ok(!["turns", "board", "sources", "check", "lesson", "lessonRounds", "followUps", "actions", "progress", "langs", "illustrations", "arrive"].some((f) => f in v1) && v1.oldBoard === null, "the room's view carries no whiteboard fields, and this room has no old board", Object.keys(v1).join(","));
ok(["start", "translate", "answer", "lesson", "image", "images", "cite", "reset", "findings", "autoTeachFor", "arrive", "pasteOffer"].every((m) => typeof (room as any)[m] === "undefined"), "the board's calls (a turn, a translation, the check, pictures, lesson tools, auto-teach) are gone");
ok(room.list().find((x: any) => x.id === id)?.versions === 2 && room.list().find((x: any) => x.id === id)?.zone === "waiting", "the room list counts the room's pages; an open merge card's room waits for the captain");

// ---------- the Library: a save keeps the room's pages, byte for byte ----------
const kept: any = await room.saveToLibrary(id, "captain"), snap: any = room.librarySnapshot(kept.artifact, kept.n);
const libStore = new (await import("../src/artifacts")).ArtifactStore(data), saved0 = () => kept.artifact;
ok(snap.kind === "review-room-pages" && snap.room === id && snap.pages.length === 2 && snap.pages[1].skill.id === "studio-baton" && snap.pages[1].cost?.usd === 0.25 && snap.cost.usd === 0.5 && snap.integrity.length === 0,
  "Save to Library: the room's pages, each with its skill and cost, verified as written", JSON.stringify({ kind: snap.kind, pages: snap.pages?.length, cost: snap.cost, integrity: snap.integrity }));
ok(readFileSync(libStore.file(kept.artifact, kept.n, "pages/v2/index.html")!, "utf8") === PAGE(2) && !libStore.file(kept.artifact, kept.n, "pages/v2/.baton/packet.json"), "each version's files are kept as they were (its .baton/ workspace was never part of it)");

{ const st = join(E.rdir(r.id), "review-room", `${id}-explain`, "state.json"), keep = readFileSync(st, "utf8"), x = JSON.parse(keep);
  delete x.runs.find((q: any) => q.n === x.versions[0].run).cost; writeFileSync(st, JSON.stringify(x));
  const { installReviewRoom } = await import("../src/domain/review-room"), other = installReviewRoom(E, { dataDir: data });
  const u: any = await other.saveToLibrary(id, "captain"), us: any = other.librarySnapshot(u.artifact, u.n);
  ok(us.cost.usd === null && us.pages[0].cost === null && us.pages[1].cost?.usd === 0.25, "a version whose cost is unknown: the save shows no total (never a partial sum)", JSON.stringify(us.cost));
  writeFileSync(st, keep); const page = join(E.rdir(r.id), "review-room", `${id}-explain`, "v1", "index.html"), html = readFileSync(page, "utf8"); writeFileSync(page, html + "<!-- changed -->");
  const third = installReviewRoom(E, { dataDir: data }), before = libStore.versions(saved0()).length; let bad: any = null; try { await third.saveToLibrary(id, "captain"); } catch (e) { bad = e; }
  ok(bad?.code === "integrity" && /v1's index\.html changed/.test(bad.message) && libStore.versions(saved0()).length === before, "a page file changed since it was made fails the save: nothing is kept, nothing listed that the save does not hold", bad?.message);
  writeFileSync(page, html); }

// ---------- the merge card and readiness untouched; nothing to GitHub; the worktree untouched ----------
const after = E.cards.view(E.cards.get(id)!);
ok(readFileSync(cardFile, "utf8") === storedBefore && E.cards.get(id)!.status === "open", "the stored merge card is unchanged and still open");
ok(JSON.stringify(after.options) === JSON.stringify(viewBefore.options) && JSON.stringify(after.detail?.codeEvidence) === JSON.stringify(viewBefore.detail?.codeEvidence), "the card's options and its evidence are unchanged by the room");
ok(gitState() === gitBefore, "the worktree, its index and its refs are untouched by the room");
ok(fetched.every((u) => u.startsWith(H.toolUrl)) && !fetched.some((u) => /github/i.test(u)), "no request left Studio for GitHub or anywhere else during the runs", JSON.stringify(fetched.filter((u) => !u.startsWith(H.toolUrl))));

// ---------- the merge card answered: the room finishes and its pages are saved once ----------
const answered = await E.answer(id, { choice: "changes", by: "captain", note: "rename percent to percentOf" } as any).then(() => "ok", (e: any) => String(e?.message ?? e));
ok(answered === "ok", "fixture: the captain answers the merge card (request changes)", answered);
await until(() => (room.view(id) as any).library?.versions?.length >= 2, 10000).catch(() => null);
{ const vr: any = E.reviewRoom!.view(id); ok(vr.library?.versions?.length >= 2, "answering the merge card saves the room's pages to the Library once more (Studio's own save)", JSON.stringify(vr.library)); }
// ---------- a room from before: its whiteboard stays on disk as it was, read by nothing, offered whole as a file ----------
{ const f = join(E.rdir(r.id), "review-room", `${id}.json`), rec = JSON.parse(readFileSync(f, "utf8"));
  rec.turns = [{ n: 1, action: "teach", by: "captain", status: "done", text: "teach me", answer: "## Overview", scenes: [{ n: 1, title: "s1" }], cost: { usd: 0.3 } }, { n: 2, action: "how", by: "captain", status: "running", text: "how?" }];
  rec.board = [{ id: "B1-1", turn: 1, type: "svg", title: "flow" }]; rec.lesson = { threads: [{ n: 1, state: "open" }] }; rec.translations = { 1: { en: { answer: "x" } } }; rec.translating = { lang: "en", status: "done", at: "t", cost: { usd: 0.05 } };
  const text = JSON.stringify(rec); writeFileSync(f, text);
  const { installReviewRoom } = await import("../src/domain/review-room");
  const fresh = installReviewRoom(E, { dataDir: data }), ov: any = fresh.view(id), ex: any = fresh.exportRoom(id);
  ok(JSON.stringify(ov.oldBoard) === JSON.stringify({ turns: 1, items: 1, usd: 0.35 }) && !("turns" in ov) && !("board" in ov), "an old room: the view says only how many finished turns and board items it kept, and what its turns and translation cost", JSON.stringify(ov.oldBoard));
  const row: any = fresh.list().find((x: any) => x.id === id), sm: any = fresh.summary(E.cards.get(id)!), oldSnap: any = await fresh.saveToLibrary(id, "captain"), os: any = fresh.librarySnapshot(oldSnap.artifact, oldSnap.n);
  ok(row.usd === 0.85 && sm.usd === 0.85 && os.cost.usd === 0.85 && os.oldBoard?.usd === 0.35, "the old whiteboard's cost still counts: the room list, the merge card and a Library save add it to the pages' ($0.50 + $0.35)", JSON.stringify({ row: row.usd, card: sm.usd, lib: os.cost, old: os.oldBoard }));
  ok(JSON.stringify(ex.record.turns) === JSON.stringify(rec.turns) && JSON.stringify(ex.record.board) === JSON.stringify(rec.board) && ex.record.lesson.threads.length === 1, "its record exports exactly as kept: turns, board, lesson and translations");
  fresh.view(id, true); await fresh.settle(id);
  const disk = JSON.parse(readFileSync(f, "utf8"));
  ok(JSON.stringify(disk.turns) === JSON.stringify(rec.turns) && JSON.stringify(disk.board) === JSON.stringify(rec.board) && JSON.stringify(disk.translations) === JSON.stringify(rec.translations), "opening the room changes none of the old fields on disk (a running turn is not even marked interrupted)"); }

globalThis.fetch = realFetch; H.stop(); end();
