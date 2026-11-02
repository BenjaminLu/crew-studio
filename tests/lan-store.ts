import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The relay's store and what it guarantees across a crash (docs/units/lan-relay.md, src/lan/store.ts): the own log's
// sequence number, head, outbox and the entry are written together before anything is sent; a refusal the peer marks
// retryable keeps the entry in the outbox; a trimmed author's old entries are never applied again; every KK operation
// is idempotent (sent twice, the state is the same); the audit is hash-chained and a write that fails stops the step.
//                                                                                                 bun tests/lan-store.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lan, type LanRunner } from "../src/lan/relay";
import { LIMITS } from "../src/lan/protocol";
import { call } from "../src/lan/wire";
import { Store } from "../src/lan/store";

process.env.CREW_LAN_ALLOW_LOOPBACK = "1"; // the two Studios of this test talk over loopback
let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await Bun.sleep(20); } return true; };
const runner = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Documents", defHash: "a".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
  start: async () => { throw new Error("no"); }, status: () => null, output: async () => { throw new Error("no"); }, cancel: () => {} });
const dirOf = (n: string) => mkdtempSync(join(tmpdir(), `crew-lan-store-${n}-`));
const mk = (dir: string) => new Lan({ dataDir: dir, runner: runner(), bind: "127.0.0.1", port: 0, discovery: null });
async function pair() {
  const da = dirOf("a"), db = dirOf("b"), A = mk(da), B = mk(db); A.setEnabled(true); B.setEnabled(true); B.openIntro(1);
  const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros[0]; A.confirmIntro(ia.id, ib.sas, "B"); B.confirmIntro(ib.id, ia.sas, "A");
  return { A, B, da, db };
}
const st = (x: Lan) => (x as any).st;

// 1. A-M1: a crash right after signing loses nothing that could fork the log
{ const { A, B, da } = await pair();
  B.wire.stop(); // B is away: the entry stays in A's outbox
  const t = A.dispatch({ to: B.id.key, title: "crash", briefing: "work" });
  const seq = st(A).seq, head = st(A).head;
  const A2 = mk(da); // a second process on the same store, the first never closed: what a restart after a crash sees
  ok(st(A2).seq === seq && st(A2).head === head && !!A2.entry(head) && st(A2).outbox.some((x: any) => x.entry === head) && !!A2.thread(t.id),
    "after a crash the own log's sequence number, head, entry, outbox row and thread are all on disk (written before the send)", JSON.stringify({ seq, s2: st(A2).seq }));
  const t2 = A2.dispatch({ to: B.id.key, title: "after", briefing: "more" });
  ok(st(A2).seq === seq + 1 && A2.entry(st(A2).head)?.prev === head, "the next entry after a restart takes the next sequence number and joins the head (no fork)");
  A2.close(); A.close(); B.close(); void t2; }

// 2. A-M2: a refusal the peer marks retryable keeps the entry, in order, until it is taken in
{ const { A, B } = await pair();
  st(B).daily[A.id.key] = { day: new Date().toISOString().slice(0, 10), n: LIMITS.perDay };
  const t = A.dispatch({ to: B.id.key, title: "limited", briefing: "x" }); await A.flush();
  const ob = st(A).outbox.find((x: any) => x.entry === t.steps[0].entry);
  ok(ob?.retry === true && /daily/.test(ob.error ?? "") && /daily/.test(A.thread(t.id)!.steps[0].waiting ?? "") && !A.thread(t.id)!.steps[0].refused,
    "a refusal the peer marks retryable (its daily limit) keeps the entry in the outbox, waiting, with the reason shown", JSON.stringify(ob));
  st(B).daily[A.id.key].n = 0; ob.next = 0; await A.flush();
  ok(!st(A).outbox.length && A.thread(t.id)!.steps[0].delivered === true && B.view().items.some((i: any) => i.thread === t.id), "once the limit passes, the same entry is sent again and taken in");
  // a permanent refusal is not retried
  const r = await call(A.id, { key: B.id.key, host: "127.0.0.1", port: B.wire.port }, "push", { entries: [{ v: 1 }], blobs: [] });
  ok(r.refused?.[0]?.retry === false, "a malformed entry is refused for good (not retryable)", JSON.stringify(r));
  A.close(); B.close(); }

// 3. S2: an author's chain trimmed below its low-water mark: an old entry sent again is never applied again
{ const { A, B } = await pair();
  const t = A.dispatch({ to: B.id.key, title: "old", briefing: "x" }); await A.flush(); await until(() => B.view().items.length === 1);
  const e = A.entry(t.steps[0].entry)!;
  B.store.trimVerdicts(0); B.store.trimChain(A.id.key, 0, new Set()); // what months of traffic do
  const before = B.view().items.length, threads = st(B).threads.length;
  const r = await call(A.id, { key: B.id.key, host: "127.0.0.1", port: B.wire.port }, "push", { entries: [e], blobs: [] });
  ok(r.refused?.length === 1 && /older/.test(r.refused[0].reason) && B.view().items.length === before && st(B).threads.length === threads, "an entry at or below its author's low-water mark is refused and never applied again", JSON.stringify(r));
  A.close(); B.close(); }

// 4. N2: every KK operation is idempotent: sent twice, B's state is the same (the replay cache is memory only)
{ const { A, B } = await pair();
  const t = A.dispatch({ to: B.id.key, title: "twice", briefing: "x" }); await A.flush(); await until(() => B.view().items.length === 1);
  const peerB = { key: B.id.key, host: "127.0.0.1", port: B.wire.port }, e = A.entry(t.steps[0].entry)!, blob = (A as any).blob(A.thread(t.id)!.rounds[0].briefing.hash);
  const snap = () => JSON.stringify({ threads: st(B).threads, items: st(B).items.map((i: any) => ({ ...i, id: "" })), seq: st(B).seq, outbox: st(B).outbox });
  const s0 = snap();
  for (const op of ["push", "push", "ping", "ping"]) await call(A.id, peerB, op, op === "push" ? { entries: [e], blobs: [blob] } : {});
  ok(snap() === s0, "a push or a ping sent again (a replay after a restart) leaves B's threads, items and log exactly as they were");
  A.close(); B.close(); }

// 5. C-S7: the audit is hash-chained, and a write that fails stops the step it records
{ const { A, B } = await pair();
  A.dispatch({ to: B.id.key, title: "audited", briefing: "x" });
  const v = A.auditView(); ok(v.broken === null && v.rows.some((r) => r.what === "introduce") && v.rows.some((r) => r.what === "dispatch"), "the audit names the introduction and the dispatch, and its chain holds");
  A.store.db.query("UPDATE audit SET data = ? WHERE what = 'dispatch'").run(JSON.stringify({ thread: "forged" }));
  ok(A.auditView().broken !== null, "a row changed after the fact breaks the chain (the inspector says where)");
  const seq = st(A).seq, queued = st(A).outbox.length; A.store.db.exec("DROP TABLE audit");
  let e = ""; try { A.dispatch({ to: B.id.key, title: "no audit", briefing: "x" }); } catch (x: any) { e = String(x?.message ?? x); }
  ok(!!e && st(A).seq === seq && st(A).outbox.length === queued && !A.store.chainAt(A.id.key, seq + 1), "when the audit cannot be written the step does not happen: no entry is signed, nothing is queued", e);
  A.close(); B.close(); }

// 7. C-S7 retention: content that started a run is kept sealed even when its peer withdraws the work
{ const da = dirOf("ra"), db = dirOf("rb");
  const started = { workflows: runner().workflows, start: async () => ({ run: "R-1", workflow: { id: "documents", version: 1, defHash: "a".repeat(64) } }), status: () => ({ state: "running", result: null, spent: { usd: 0, rounds: 0 }, stopped: null }), output: async () => { throw new Error("no"); }, cancel: () => {} } as LanRunner;
  const A = mk(da), B = new Lan({ dataDir: db, runner: started, bind: "127.0.0.1", port: 0, discovery: null }); A.setEnabled(true); B.setEnabled(true); B.openIntro(1);
  const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros[0]; A.confirmIntro(ia.id, ib.sas, "B"); B.confirmIntro(ib.id, ia.sas, "A");
  const t = A.dispatch({ to: B.id.key, title: "kept", briefing: "the briefing that started a run" }); await A.flush(); await until(() => B.view().items.length === 1);
  const d = B.view().items[0]; await B.approve(d.id, { workflow: "documents", seen: B.seenHash(B.thread(t.id)!, B.thread(t.id)!.rounds[0]), roundsOnly: true, rounds: 3 }); await B.flush();
  await until(() => A.view().items.some((i: any) => i.kind === "take")); await A.approve(A.view().items.find((i: any) => i.kind === "take")!.id); await A.flush();
  await until(() => B.view().items.some((i: any) => i.kind === "assign")); await B.approve(B.view().items.find((i: any) => i.kind === "assign")!.id);
  const brief = B.thread(t.id)!.rounds[0].briefing.hash;
  A.withdraw(t.id); await A.flush(); await until(() => B.thread(t.id)?.state === "withdrawn");
  ok(B.thread(t.id)?.state === "withdrawn" && B.store.hasBlob(brief) && B.store.isUsed(brief), "a briefing that started a run stays on the taker's disk, sealed, after the dispatcher withdraws it (forensics)");
  A.close(); B.close(); }

// 6. rotation keeps the chain: rows moved out leave their last hash as the anchor
{ const s = new Store(join(dirOf("rot"), "relay.db")); for (let i = 0; i < 30; i++) s.audit("x", { i });
  const moved = s.rotateAudit(10); s.audit("after", {});
  ok(moved.length === 20 && s.auditBreak() === null && s.auditRows(1)[0].what === "after", "an audit rotated down to its newest rows still verifies from the moved rows' last hash"); s.close(); }

console.log(`\nlan-store: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
