import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The intent-aligned merge card (unit intent-merge-card), module side: the detail built
// from a fixture of R-002's real records (tests/fixture/cards/R-002), the walk that maps
// each hunk to the done lines it serves, the zh-TW translations, and the server rule
// that a merge answer needs every intent line ticked (or a note), and on a one-way
// change the door confirmation too, enforced through the engine's answer route.
//      bun tests/intent-card.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("intent-card");
const fx = join(import.meta.dir, "fixture/cards/R-002");
const input = JSON.parse(readFileSync(join(fx, "input.json"), "utf8"));
const coord = JSON.parse(readFileSync(join(fx, "coordinator.json"), "utf8"));
const diff = readFileSync(join(fx, "diff.patch"), "utf8");
const { mergeDetail, parseHunks, intentLines } = await import("../src/domain/mergecard");
const { doneMap } = await import("../src/runtime/checks");
const { Cards } = await import("../src/runtime/cards");
const CJK = /[㐀-鿿]/;

const mi = { run: input.run, intent: input.intent, spec: input.spec, ctx: input.ctx, ledger: input.ledger, doneMap: doneMap(input.spec.done, input.ledger, input.ctx.head), diff, stat: input.stat, cost: input.cost };
const d = mergeDetail(mi, coord);

// ---------- every section, from R-002's records ----------
ok(d.intent.en === input.intent && d.intents.length === 3 && /JPY/.test(d.intents[0].en) && /¥1,235/.test(d.intents[1].en) && /USD output must stay the same/.test(d.intents[2].en),
  "intent: the captain's own sentence, split into three lines to tick", JSON.stringify(d.intents.map((x) => x.en)));
ok(d.why.length === 3 && d.why[0].en === input.spec.why[0], "why: the spec's three reasons");
ok(d.scope.in.join(",") === "src/money.ts,test/format.test.ts,test/money.test.ts,README.md" && Array.isArray(d.scope.out), "scope: in and out");
ok(d.done.length === 4 && d.done.every((x) => x.proved), "done: four lines, every one proved");
ok(/format\(1235, "JPY"\) gives "¥1,235"/.test(d.beforeAfter.text.en) && /README\.md/.test(d.beforeAfter.stat) && /3 files changed/.test(d.beforeAfter.stat), "before/after: the spec's explanation and the diff stat");
ok(d.how.length === 1 && /optional second argument/.test(d.how[0].en), "how: the worker's report");
ok(d.door?.kind === "two-way" && /optional parameter/.test(d.door.reason.en) && /revert/.test(d.door.rollback.en) && CJK.test(d.door.rollback["zh-TW"]), "door and rollback");
ok(d.review?.verdicts[0]?.verdict === "APPROVE" && d.review.followups.length === 2 && /src\/money\.ts:24/.test(d.review.followups[0].en), "reviewer verdict and its two follow-ups");
ok(d.cost?.rounds === 1 && d.cost.usd! > 0.3 && d.cost.minutes === 5, "cost and time", JSON.stringify(d.cost));
ok(d.gates.length === 6 && d.gates.every((g) => g.verdict === "pass") && d.gates.map((g) => g.name).join(",") === "branch,rebase,scope,failfirst,ci,approval", "the six gates");
ok(d.head === input.ctx.head && d.base === input.ctx.baseCommit && d.run === "R-002", "head and base");

// ---------- done lines show their proof ----------
for (const [i, x] of d.done.entries()) {
  const ci = x.proofs.find((p) => p.check === "firstmate/ci"), ff = x.proofs.find((p) => p.check === "firstmate/fail-first");
  ok(ci?.seq === 29 && ff?.seq === 30 && ci.verdict === "pass" && ci.head === input.ctx.head && ci.evidence.length === 2 && /\/api\/wruns\/R-002\/evidence\?seq=29&file=out%2Fshard-1\.log/.test(ci.evidence[0].href),
    `done line ${i + 1} names its proof: CI (ledger #29) and fail-first (#30) at head ${input.ctx.head.slice(0, 8)}, with evidence links`, JSON.stringify(x.proofs));
}
ok(/shows whole yen with a thousands separator/.test(d.done[0].proofs.find((p) => p.check === "firstmate/fail-first")!.detail) && !/shows a minus sign/.test(d.done[0].proofs.find((p) => p.check === "firstmate/fail-first")!.detail)
  && /groups JPY thousands/.test(d.done[2].proofs.find((p) => p.check === "firstmate/fail-first")!.detail), "a fail-first proof names the test that was red on base for that line");
const unproved = mergeDetail({ ...mi, doneMap: doneMap(input.spec.done, input.ledger.filter((e: any) => e.seq !== 29 && e.seq !== 30), input.ctx.head) }, coord);
ok(unproved.done.every((x) => !x.proved && !x.proofs.length), "without the CI and fail-first entries no line claims a proof");

// ---------- walk the diff: each hunk mapped to what it serves ----------
const hs = parseHunks(diff);
ok(hs.length === 6 && hs.filter((h) => h.kind === "test").length === 4, "the diff splits into six walk items: README, src/money.ts and one per new test", JSON.stringify(hs.map((h) => h.id)));
const tests = d.walk.filter((w) => w.file === "test/format.test.ts");
ok(tests.map((w) => w.serves.done.join("+")).join(",") === "0,1,2,3", "each new test maps to exactly the done line it proves, in order", JSON.stringify(tests.map((w) => w.serves)));
const src = d.walk.find((w) => w.file === "src/money.ts")!;
ok(src.serves.done.join(",") === "0,1,2,3" && src.serves.intents.includes(2), "the source hunk serves all four done lines and the keep-USD intent line");
const readme = d.walk.find((w) => w.file === "README.md")!;
ok(!readme.serves.done.length && readme.serves.intents.includes(1), "the README hunk serves the captain's example (an intent line), no done line");
ok(d.done.every((_, i) => d.walk.some((w) => w.file.startsWith("test/") && w.serves.done.includes(i))), "every done line has a test hunk in the walk");
ok(d.walk.every((w) => w.note.en && CJK.test(w.note["zh-TW"]) && w.lines.length > 0), "every walk item has a note in en and zh-TW and its lines");
const fb = mergeDetail(mi, null);
ok(fb.walk.map((w) => w.serves.done.join("+")).join("|") === d.walk.map((w) => w.serves.done.join("+")).join("|") && /proves done line 1 /.test(fb.walk[2].note.en) && /證明完成條件第 1 條/.test(fb.walk[2].note["zh-TW"]),
  "without the coordinator the walk keeps the same mapping and a deterministic note in both languages");

// ---------- zh-TW: real translations, or marked ----------
const zhAll = [d.intents, d.why, d.how, d.done.map((x) => x.text), d.review!.followups, [d.door!.reason]].flat();
ok(zhAll.every((l) => !l.untranslated && CJK.test(l["zh-TW"]) && l["zh-TW"] !== l.en) && d.writer === "coordinator", "with the coordinator every line has a Chinese zh-TW text, not the English", JSON.stringify(zhAll.filter((l) => l.untranslated || !CJK.test(l["zh-TW"]))));
ok(!zhAll.some((l) => /船長要求的變更/.test(l["zh-TW"])), "no placeholder sentence stands in for a translation");
ok([fb.intents, fb.why, fb.how, fb.done.map((x) => x.text), fb.review!.followups, [fb.door!.reason]].flat().every((l) => l.untranslated && l["zh-TW"] === l.en), "without the coordinator the done lines, why, how, follow-ups and door reason are all marked untranslated");
ok(fb.writer === "fallback" && fb.intents.every((l) => l.untranslated && l["zh-TW"] === l.en) && fb.beforeAfter.text["zh-TW"] === input.spec.explain["zh-TW"],
  "without the coordinator untranslated lines are marked (the spec's own zh-TW explanation still shows)");
ok(mergeDetail(mi, { ...coord, intents: ["one", "two", "three"] }).intents.every((l) => l.untranslated), "a 'translation' with no Chinese in it is refused and marked untranslated");
// malformed coordinator output (its tool arguments are not schema-checked) falls back, marked, and never throws
const { coordinatorDetail, validCoordinator } = await import("../src/domain/mergecard");
const malformed: any[] = [{ intents: "x", walk: "y", done: {} }, "a string", 42, null, [], { intents: [1, 2, 3], done: coord.done, walk: coord.walk },
  { ...coord, walk: [{ id: 5, en: "x", zh: "中" }] }, { ...coord, intents: ["只有一條"] }, { ...coord, why: "為什麼" }, { ...coord, how: ["怎麼"] }, { ...coord, door_reason: { zh: "門" } }, { ...coord, followups: [null, "後續"] }];
for (const [k, raw] of malformed.entries()) {
  let got: any = null, threw = "";
  try { got = coordinatorDetail(mi, raw); } catch (e: any) { threw = String(e.message); }
  ok(!threw && got.writer === "fallback" && [got.intents, got.why, got.done.map((x: any) => x.text)].flat().every((l: any) => l.untranslated) && got.walk.length === 6,
    `malformed coordinator answer #${k + 1} (${JSON.stringify(raw)?.slice(0, 50)}) falls back to marked untranslated sections`, threw || JSON.stringify(got?.writer));
}
ok(validCoordinator(coord).ok && coordinatorDetail(mi, coord).writer === "coordinator", "a well-formed coordinator answer is used");
ok(!validCoordinator({ intents: "x", walk: "y", done: {} }).ok && /intents/.test(validCoordinator({ intents: "x", walk: "y", done: {} }).why), "the validator names the malformed field");
let threwRaw = ""; try { mergeDetail(mi, { intents: "x", walk: "y", done: {} } as any); } catch (e: any) { threwRaw = e.message; }
ok(!threwRaw, "mergeDetail itself never throws on a malformed coordinator object", threwRaw);
ok(intentLines("Make it fast. Keep the API: no new routes, and log every call.").length === 4, "the intent splitter handles sentences, a colon and ', and'");

// ---------- the server: every intent ticked (or a note); one-way also needs the door ----------
const cdir = mkdtempSync(join(tmpdir(), "crew-icard-"));
const C = new Cards(cdir);
const mk = (door = "two-way") => C.create({ run: "R-1", node: "q", visit: 1, kind: "merge", title: { en: "Merge", "zh-TW": "合併" }, sections: { en: {} as any, "zh-TW": {} as any }, body: "",
  options: [{ id: "merge", label: "Merge", primary: true }, { id: "changes", label: "Request changes", note: true, hold: true }, { id: "close", label: "Close", hold: true }], confirmDoor: true, door, links: [], detail: d, workflow: "w", runTitle: "t" } as any);
const err = (f: () => any) => { try { f(); return ""; } catch (e: any) { return String(e.message); } };
let c = mk();
ok(/tick every intent line as met \(0 of 3\)/.test(err(() => C.answer(c.id, { choice: "merge", by: "captain" }))), "a merge with no intent ticked is refused");
ok(/2 of 3/.test(err(() => C.answer(c.id, { choice: "merge", by: "captain", aligned: [0, 2] }))) && C.get(c.id)!.status === "open", "a merge with two of three ticked is refused, the card stays open");
ok(/0 of 3/.test(err(() => C.answer(c.id, { choice: "merge", by: "captain", aligned: [7, -1, 1.5] as any }))), "ticks outside the intent lines do not count");
ok(!err(() => C.answer(c.id, { choice: "merge", by: "captain", aligned: [2, 0, 1, 1] })) && JSON.stringify(C.get(c.id)!.answer!.aligned) === "[0,1,2]", "a merge with every line ticked is taken and the ticks are recorded");
c = mk(); ok(!err(() => C.answer(c.id, { choice: "merge", by: "captain", aligned: [0], note: "line 3: USD grouping is a follow-up" })), "a note answers in place of the missing ticks");
c = mk(); ok(!err(() => C.answer(c.id, { choice: "close", by: "captain" })), "a hold option (close) needs no ticks");
c = mk("one-way");
ok(/confirm the door/.test(err(() => C.answer(c.id, { choice: "merge", by: "captain", aligned: [0, 1, 2] }))), "one-way: every line ticked but no door confirmation is refused");
ok(/tick every intent line/.test(err(() => C.answer(c.id, { choice: "merge", by: "captain", confirm: "one-way" }))), "one-way: the door confirmed but no ticks is refused");
ok(!err(() => C.answer(c.id, { choice: "merge", by: "captain", confirm: "one-way", aligned: [0, 1, 2] })), "one-way: door confirmed and every line ticked is taken");

// ---------- through the engine (the HTTP route is exercised by tests/intent-card-ui.mjs) ----------
const H = await harness([Y({ id: "icd", name: "icd", roles: [], nodes: [{ id: "q", kind: "card", label: "Dispatch", args: { card_kind: "dispatch" }, card: { title: "Dispatch?", options: [{ id: "go", label: "Go", primary: true }] }, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["q", "e", "go"]] }), Y({ id: "ic", name: "ic", roles: [], nodes: [{ id: "q", kind: "card", label: "Merge", args: { body_from: "fixture", card_kind: "merge" }, card: { confirm_door: true }, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["q", "e", "merge"]] })]);
H.engine.cardBodies.fixture = async () => { await new Promise((r) => setTimeout(r, 10)); return { title: "Merge: JPY", en: {}, detail: d, captainOnly: true, options: [{ id: "merge", label: "Merge", primary: true }, { id: "close", label: "Close", hold: true }] }; };
const r = H.engine.start({ workflow: "ic", text: input.intent, params: {} });
await until(() => H.engine.cards.list({ run: r.id, open: true }).length > 0, 20000);
const card = H.engine.cards.list({ run: r.id, open: true })[0];
ok(card?.detail?.intents.length === 3 && card.detail.walk.length === 6, "an async card body's detail reaches the raised card unchanged");
ok(/tick every intent line/.test(await H.engine.answer(card.id, { choice: "merge", by: "captain", aligned: [0] }).then(() => "", (e) => String(e.message))), "the engine refuses the merge with one tick");
ok(await H.engine.answer(card.id, { choice: "merge", by: "captain", aligned: [0, 1, 2] }).then(() => true, () => false) && H.engine.cards.get(card.id)!.answer?.aligned?.length === 3, "with every line ticked the engine takes the merge");
await until(() => H.engine.get(r.id)!.status === "succeeded", 10000);
ok(H.engine.get(r.id)!.status === "succeeded", "the run moves on after the aligned answer");
// (captain's decision) an authorization window never answers a merge card: intent alignment is the captain's own act.
// The merge body marks its card captain-only (the generic runtime knows no card kinds); a window still answers a dispatch card.
const g = H.engine.grants.add({ kinds: ["merge", "dispatch"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)");
const r2 = H.engine.start({ workflow: "ic", text: input.intent, params: {} });
await until(() => H.engine.cards.list({ run: r2.id }).length > 0, 20000); await new Promise((res) => setTimeout(res, 600));
const c2 = H.engine.cards.list({ run: r2.id })[0];
ok(c2?.status === "open" && !c2.answer && H.engine.get(r2.id)!.status === "waiting", "an authorization window that lists merge leaves the merge card open for the captain", JSON.stringify(c2?.answer));
ok(c2?.captainOnly === true && H.engine.timeline(r2.id).some((e: any) => /waits for the captain's own answer/.test(e.text ?? e.summary ?? JSON.stringify(e))), "the card is marked captain-only and the run's timeline says why the window left it", JSON.stringify(H.engine.timeline(r2.id).slice(-4)));
const r3 = H.engine.start({ workflow: "icd", text: "dispatch it", params: {} });
await until(() => H.engine.get(r3.id)!.status === "succeeded", 20000);
const c3 = H.engine.cards.list({ run: r3.id })[0];
ok(c3?.kind === "dispatch" && c3.answer?.choice === "go" && new RegExp(`auth window ${g.id}`).test(c3.answer.by), "the same window still answers a dispatch card", JSON.stringify(c3?.answer));
H.stop();
end();
