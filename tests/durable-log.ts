import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The event log and the ledger survive a crash (src/runtime/durable-log.ts, docs/architecture.md §3.2):
//   a commit is one write and one fsync, whatever number of events it records
//   a torn last line (or a commit a crash kept only in part) is cut off, noted, and the run resumes
//   a corrupt line before the tail stops that run only: it loads failed with its failure card, nothing of it resumes,
//     no write lands behind the bad line, and every other run loads as usual
//   a failed write is cut back, so it never leaves half a line
//   the ledger: one write and one fsync per entry, a torn last entry is tolerated, a corrupt middle entry is reported
//   bun tests/durable-log.ts
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, sleep, suite, until, Y } from "./rt-harness";
import { appendLines, durableFs, fullSync, parseLog } from "../src/runtime/durable-log";
import { Ledger } from "../src/runtime/checks";
import { failure } from "../src/runtime/failures";
const { ok, end } = suite("durable-log");

// ---------- the reader ----------
{
  const a = JSON.stringify({ seq: 1, type: "x" }), b = JSON.stringify({ seq: 2, type: "y" });
  const torn = parseLog(`${a}\n${b}\n{"seq":3,"ty`);
  ok(torn.rows.length === 2 && !!torn.torn && torn.torn.keep === Buffer.byteLength(`${a}\n${b}\n`) && !torn.corrupt, "a torn last line is dropped and reported as torn, not corrupt", JSON.stringify(torn));
  const part = parseLog(`${a}\n${JSON.stringify({ seq: 2, type: "y", tx: 3 })}\n${JSON.stringify({ seq: 3, type: "z" })}\n`);
  ok(part.rows.length === 1 && part.torn?.lines === 2 && part.torn.keep === Buffer.byteLength(`${a}\n`), "a commit of three events a crash kept two of is dropped whole", JSON.stringify(part));
  const whole = parseLog(`${JSON.stringify({ seq: 1, type: "x", tx: 2 })}\n${b}\n`);
  ok(whole.rows.length === 2 && !whole.torn && whole.rows.every((r) => !("tx" in r)), "a complete commit is kept, without its frame mark");
  const framed = JSON.stringify({ seq: 1, type: "x", tx: 1 });
  const bad = parseLog(`${framed}\n{not json\n${b}\n`);
  ok(!!bad.corrupt && bad.corrupt.line === 2 && bad.rows.length === 1, "a corrupt line before the tail of a framed log stops the reader there and names its line", JSON.stringify(bad));
  const legacy = parseLog(`${a}\n{not json\n${b}\n`);
  ok(!legacy.corrupt && legacy.rows.length === 2 && legacy.skipped?.[0]?.line === 2, "the same line in a log written before the framing is skipped and reported, as the old reader did", JSON.stringify(legacy));
  const first = parseLog(`{not json\n${b}\n`);
  ok(!!first.corrupt && first.corrupt.line === 1, "a log whose first line does not parse is corrupt (nothing names the run)", JSON.stringify(first));
}

// ---------- a failed write leaves nothing behind ----------
{
  const H0 = await harness([]); const f = join(H0.data, "cut.jsonl"); appendLines(f, ['{"seq":1}']);
  const size = statSync(f).size, real = durableFs.writeSync;
  (durableFs as any).writeSync = (fd: number, buf: Buffer, off: number, _len: number) => { real(fd, buf, off, 5); throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }); };
  let threw = false; try { appendLines(f, ['{"seq":2,"long":"line"}', '{"seq":3}']); } catch { threw = true; } finally { (durableFs as any).writeSync = real; }
  ok(threw && statSync(f).size === size && readFileSync(f, "utf8") === '{"seq":1}\n', "a write that fails part way is cut back to the size before it", readFileSync(f, "utf8"));
  H0.stop();
}

const flows = [
  Y({ id: "two", name: "two", roles: [], nodes: [{ id: "a", kind: "hook", label: "A", do: "set", args: { key: "k", value: 1 }, x: 0, y: 0 }, { id: "b", kind: "hook", label: "B", do: "set", args: { key: "k", value: 2 }, x: 1, y: 0 },
    { id: "end", kind: "hook", label: "End", args: { result: "done" }, x: 2, y: 0 }], edges: [["a", "b"], ["b", "end"]] }),
];
const H = await harness(flows);
const E = H.engine;
const { Engine } = await import("../src/runtime/engine");
const fresh = () => { const E2 = new Engine((E as any).deps, H.defs); E2.actions = E.actions; E2.modes = E.modes; E2.natives = E.natives; return E2; };
let next = 900;
const copy = (id: string, upto: number, extra = "") => {
  const nid = `R-${next++}`; mkdirSync(E.rdir(nid), { recursive: true });
  const evs = E.events(id).slice(0, upto + 1).map((e) => JSON.stringify({ ...e, run: nid, ...(e.type === "run_created" ? { run: { ...e.run, id: nid } } : {}) }));
  writeFileSync(join(E.rdir(nid), "events.jsonl"), evs.join("\n") + "\n" + extra);
  return nid;
};

// ---------- a commit is one write and one fsync ----------
const done = E.start({ workflow: "two", text: "x" }); await until(() => E.get(done.id)!.status === "succeeded", 8000);
{
  const file = join(E.rdir(done.id), "events.jsonl"), paths = new Map<number, string>(), calls: string[] = [];
  const real = { ...durableFs };
  (durableFs as any).openSync = (p: string, flag: string) => { const fd = real.openSync(p, flag); paths.set(fd, String(p)); return fd; };
  (durableFs as any).writeSync = (fd: number, ...rest: any[]) => { calls.push(`write ${paths.get(fd)}`); return (real.writeSync as any)(fd, ...rest); };
  (durableFs as any).fsyncSync = (fd: number) => { calls.push(`fsync ${paths.get(fd)}`); return real.fsyncSync(fd); };
  (durableFs as any).cacheSync = (fd: number) => { calls.push(`cache-fsync ${paths.get(fd)}`); return real.cacheSync?.(fd); };
  const before = readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  const r = E.get(done.id)!; r.ctx.one = 1; r.ctx.two = 2; r.queue = ["x"]; r.nodes.a.note = "changed"; r.nodes.b.note = "changed too";
  try { E.commit(r, "fixture"); } finally { Object.assign(durableFs, real); }
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean), added = lines.slice(before).map((l) => JSON.parse(l));
  const on = (what: string, f: string) => calls.filter((c) => c === `${what} ${f}`).length;
  ok(added.length >= 4 && added[0].tx === added.length, "a commit of several events writes them framed as one commit", JSON.stringify(added.map((e) => [e.type, e.tx])));
  ok(on("write", file) === 1 && on("fsync", file) === 1, "… with one write and one fsync of the event log", JSON.stringify(calls));
  ok(on("fsync", join(E.rdir(done.id), "run.json.tmp")) === 0 && on("cache-fsync", join(E.rdir(done.id), "run.json.tmp")) === 1, "… and the run.json snapshot (a cache) is fsynced, without a full flush, before its rename", JSON.stringify(calls));
}

// ---------- a torn tail is cut off and the run resumes ----------
const evs = E.events(done.id), atA = evs.findIndex((e) => e.type === "node" && e.node === "a" && e.to === "passed");
{
  const nid = copy(done.id, atA, `{"seq":999,"ts":"2026-10-28T00:00:00.000Z","run":"R-x","type":"node","node":"b","to":"pas`);
  const E2 = fresh(); E2.load();
  await until(() => E2.get(nid)?.status === "succeeded", 8000);
  const raw = readFileSync(join(E2.rdir(nid), "events.jsonl"), "utf8");
  ok(E2.get(nid)?.status === "succeeded" && E2.get(nid)?.result === "done", "a run whose last line was torn resumes and reaches its end", `${E2.get(nid)?.status} ${E2.get(nid)?.error}`);
  ok(!raw.includes('"to":"pas"') && !parseLog(raw).corrupt && !parseLog(raw).torn, "… the torn line is cut off before anything is appended behind it");
  ok(E2.events(nid).some((e) => e.type === "log" && /torn tail/.test(e.summary)), "… and the run's events note it");
}
// a commit the crash kept only in part: dropped whole, then the run carries on from the step before it
{
  const cut = atA + 1, nid = copy(done.id, atA, JSON.stringify({ seq: 998, ts: "2026-10-28T00:00:00.000Z", run: "R-x", type: "ctx", set: { half: true }, del: [], tx: 3 }) + "\n");
  const E2 = fresh(); E2.load(); void cut;
  await until(() => E2.get(nid)?.status === "succeeded", 8000);
  ok(E2.get(nid)?.status === "succeeded" && E2.get(nid)!.ctx.half === undefined, "a commit kept only in part is dropped whole and the run resumes", `${E2.get(nid)?.status} ${JSON.stringify(E2.get(nid)?.ctx)}`);
}

// ---------- a corrupt line in the middle stops that run only ----------
{
  const bad = `R-${next++}`; mkdirSync(E.rdir(bad), { recursive: true });
  // written by the crash-safe writer (every commit framed with tx), then damaged in the middle
  const lines = E.events(done.id).slice(0, atA + 1).map((e) => JSON.stringify({ ...e, run: bad, tx: 1, ...(e.type === "run_created" ? { run: { ...e.run, id: bad } } : {}) }));
  lines.splice(2, 0, '{"seq":2,"type":"ctx","set":{"k":'); // a damaged line with good lines after it
  const file = join(E.rdir(bad), "events.jsonl"); writeFileSync(file, lines.join("\n") + "\n");
  const good = copy(done.id, 0); // only its creation: it starts at the entry after the restart
  const bytes = readFileSync(file, "utf8");
  const E2 = fresh(); let threw: any = null; try { E2.load(); } catch (e) { threw = e; }
  await until(() => E2.get(good)?.status === "succeeded", 8000); await sleep(300);
  const r = E2.get(bad);
  ok(!threw, "a run with a corrupt log does not stop the server's load", String(threw));
  ok(E2.get(good)?.status === "succeeded", "… every other run loads and runs as usual");
  ok(r?.status === "failed" && !!E2.logFault(bad) && /corrupt at line 3/.test(r.error ?? ""), "the run with a corrupt line before its tail loads failed, naming the line", `${r?.status} ${r?.error}`);
  ok(r!.ctx.k !== 2 && r!.nodes.b.state !== "passed" && r!.nodes.end.state !== "passed", "… nothing of it resumes: no hook after the bad line runs", JSON.stringify(E2.nodeStates(r!)));
  ok(readFileSync(file, "utf8") === bytes, "… and nothing is written behind the bad line");
  const cards = E2.cards.list({ run: bad, open: true }).filter((c) => c.kind === "failure");
  ok(cards.length === 1 && r!.failureCard === cards[0].id && cards[0].failure?.code === "internal.bug" && cards[0].options.some((o) => o.id === "new-task"), "… the captain gets its failure card (a new Task with the same request is offered)", JSON.stringify(cards.map((c) => [c.kind, c.failure?.code, c.options.map((o) => o.id)])));
  const E3 = fresh(); E3.load();
  ok(E3.cards.list({ run: bad, open: true }).filter((c) => c.kind === "failure").length === 1 && E3.get(bad)?.failureCard === cards[0].id, "a later restart keeps the same card, not a second one");
  // the sealed run's snapshot is never rewritten: no reconcile, no archive, and the code domain does not offer a GitHub check
  const snap = join(E3.rdir(bad), "run.json"), snapBefore = (() => { try { return readFileSync(snap, "utf8"); } catch { return null; } })();
  let refusedArchive = false; try { E3.archive(bad, true); } catch { refusedArchive = true; }
  let refusedReconcile = false; try { E3.reconcileMerge(bad, { pr: 1, base: "main", sha: "a".repeat(40) }); } catch { refusedReconcile = true; }
  const snapAfter = (() => { try { return readFileSync(snap, "utf8"); } catch { return null; } })();
  ok(refusedArchive && refusedReconcile && snapAfter === snapBefore && readFileSync(file, "utf8") === bytes, "a sealed run is not archived or reconciled: its run.json and log stay as they were");
  // (that the code domain never offers a sealed run for a GitHub check: tests/reconciled-merge.ts)
  // the captain parks it: later restarts take the answered card as the decision, no new card is raised
  await E3.answerFailure(E3.cards.get(cards[0].id)!, { choice: "park", by: "captain" });
  const E4 = fresh(); E4.load();
  const all = E4.cards.list({ run: bad }).filter((c) => c.kind === "failure");
  ok(all.length === 1 && all[0].status !== "open" && !!E4.get(bad)?.parked && E4.get(bad)?.failureCard === cards[0].id, "after Park, a restart raises no new card and the run stays parked", JSON.stringify(all.map((c) => [c.id, c.status])) + ` parked=${JSON.stringify(E4.get(bad)?.parked)}`);
  E3.remove(bad, bad);
  ok(!E3.get(bad) && !E3.logFault(bad), "the captain can still delete the run");
}

// ---------- logs written before the crash-safe format ----------
// the old writer appended one event per call with no fsync: a crash left half a line, and the next start glued its next event
// onto it, so a garbage line sits mid-file. The old reader skipped it; a log with no framed (tx) commit before such a line keeps that
{
  const old = `R-${next++}`; mkdirSync(E.rdir(old), { recursive: true });
  const lines = E.events(done.id).map((e) => JSON.stringify({ ...e, run: old, ...(e.type === "run_created" ? { run: { ...e.run, id: old } } : {}) }));
  lines.splice(3, 1, lines[3].slice(0, 30) + lines[4]); lines.splice(4, 1); // a half line glued onto the next event
  const file = join(E.rdir(old), "events.jsonl"); writeFileSync(file, lines.join("\n") + "\n");
  const E2 = fresh(); E2.load(); await sleep(200);
  const r = E2.get(old);
  ok(r?.status === "succeeded" && !E2.logFault(old) && !E2.cards.list({ run: old }).some((c) => c.kind === "failure"), "an old-format log with a garbage line mid-file loads as before (the line skipped), not sealed", `${r?.status} ${JSON.stringify(E2.logFault(old))}`);
}
// a crash-safe log corrupt in the middle, of a run whose run.json says it ended: loaded read-only as it ended, never flipped to failed
{
  const ended = `R-${next++}`; mkdirSync(E.rdir(ended), { recursive: true });
  const lines = E.events(done.id).map((e) => JSON.stringify({ ...e, run: ended, tx: 1, ...(e.type === "run_created" ? { run: { ...e.run, id: ended } } : {}) }));
  lines.splice(2, 0, "{garbage");
  const file = join(E.rdir(ended), "events.jsonl"); writeFileSync(file, lines.join("\n") + "\n");
  writeFileSync(join(E.rdir(ended), "run.json"), JSON.stringify({ ...E.get(done.id)!, id: ended }));
  const bytes = readFileSync(file, "utf8"), snap = readFileSync(join(E.rdir(ended), "run.json"), "utf8");
  const E2 = fresh(); E2.load(); await sleep(200);
  const r = E2.get(ended);
  ok(r?.status === "succeeded" && r.result === "done" && !!E2.logFault(ended) && !E2.cards.list({ run: ended }).some((c) => c.kind === "failure"), "an ended run with a corrupt log loads as it ended, read-only with a note, no failure card", `${r?.status} ${JSON.stringify(E2.logFault(ended))}`);
  ok(readFileSync(file, "utf8") === bytes && readFileSync(join(E2.rdir(ended), "run.json"), "utf8") === snap, "… nothing of it is rewritten");
}

// a new Task started from the seal card: later starts keep the link to it
{
  const bad = `R-${next++}`; mkdirSync(E.rdir(bad), { recursive: true });
  const lines = E.events(done.id).slice(0, atA + 1).map((e) => JSON.stringify({ ...e, run: bad, tx: 1, ...(e.type === "run_created" ? { run: { ...e.run, id: bad } } : {}) }));
  lines.splice(2, 0, "{garbage"); writeFileSync(join(E.rdir(bad), "events.jsonl"), lines.join("\n") + "\n");
  const E2 = fresh(); E2.load();
  const card = E2.cards.get(E2.get(bad)!.failureCard!)!;
  await E2.answerFailure(card, { choice: "new-task", by: "captain" });
  const follower = E2.get(bad)!.ctx.followedBy;
  await until(() => !!follower && E2.get(follower)?.status === "succeeded", 8000);
  const E3 = fresh(); E3.load(); await sleep(100);
  ok(!!follower && E3.get(bad)?.ctx.followedBy === follower && E3.get(bad)?.parked?.note === `followed by ${follower}`, "after a new Task from the seal card, a restart keeps the link to it", `${follower} ${JSON.stringify(E3.get(bad)?.parked)} ${E3.get(bad)?.ctx.followedBy}`);
}

// an ended run loaded read-only is never revived: its own failure card offers Retry, but nothing of it runs again
{
  const ended = `R-${next++}`; mkdirSync(E.rdir(ended), { recursive: true });
  const lines = E.events(done.id).map((e) => JSON.stringify({ ...e, run: ended, tx: 1, ...(e.type === "run_created" ? { run: { ...e.run, id: ended } } : {}) }));
  lines.splice(2, 0, "{garbage");
  const file = join(E.rdir(ended), "events.jsonl"); writeFileSync(file, lines.join("\n") + "\n");
  writeFileSync(join(E.rdir(ended), "run.json"), JSON.stringify({ ...E.get(done.id)!, id: ended, status: "failed", result: null }));
  const E2 = fresh(); E2.load(); await sleep(100);
  const r = E2.get(ended)!, node = r.def.nodes.find((n) => n.id === "b")!;
  E2.raiseFailure(r, node, failure("transient.network", "the network dropped", { source: "engine", run: ended }));
  const card = E2.cards.get(r.failureCard!)!, states = JSON.stringify(E2.nodeStates(r)), bytes = readFileSync(file, "utf8");
  let refused = ""; try { await E2.answerFailure(card, { choice: card.options.find((o) => o.id !== "park" && o.id !== "report")!.id, by: "captain" }); } catch (e: any) { refused = String(e?.message ?? e); }
  await sleep(200);
  ok(!!refused && E2.cards.get(card.id)!.status === "open" && JSON.stringify(E2.nodeStates(E2.get(ended)!)) === states, "a sealed run's failure card refuses Retry: no node is put back to run", refused);
  ok(!E2.continuable(ended), "… a sealed run is not offered Continue");
  let offered = false; try { E2.continuationOffer(ended); offered = true; } catch {}
  ok(!offered, "… and no continuation is offered or confirmed for it");
  r.queue.push("b"); r.nodes.b.state = "pending"; r.status = "running"; let started = false;
  const realRun = (E2 as any).runNode; (E2 as any).runNode = (...x: any[]) => { started = true; return realRun.apply(E2, x); };
  E2.tick(r); await sleep(100); (E2 as any).runNode = realRun;
  ok(!started && readFileSync(file, "utf8") === bytes, "… and tick runs nothing of a sealed run");
}

// ---------- macOS: fsync does not flush the drive's cache, F_FULLFSYNC does ----------
if (process.platform === "darwin") {
  const f = join(H.data, "full.jsonl"); appendLines(f, ['{"seq":1}']);
  const fd = durableFs.openSync(f, "r");
  try { ok(fullSync(fd) === "F_FULLFSYNC", "on macOS a durable write is flushed with F_FULLFSYNC"); } finally { durableFs.closeSync(fd); }
}

// ---------- a new run's folder is durable: the runs folder is fsynced when it is created ----------
{
  const paths = new Map<number, string>(), synced: string[] = [], real = { ...durableFs };
  (durableFs as any).openSync = (p: string, flag: string) => { const fd = real.openSync(p, flag); paths.set(fd, String(p)); return fd; };
  (durableFs as any).fsyncSync = (fd: number) => { synced.push(String(paths.get(fd))); return real.fsyncSync(fd); };
  let id = ""; try { id = E.start({ workflow: "two", text: "dir" }).id; } finally { Object.assign(durableFs, real); }
  await until(() => E.get(id)!.status === "succeeded", 8000);
  ok(synced.includes(E.root) && synced.includes(E.rdir(id)), "starting a run fsyncs the runs folder (its new folder) and the run's folder (its new log)", JSON.stringify(synced));
}

// ---------- a failed write that cannot be cut back seals the run in memory; the seq moves only when a write lands ----------
{
  const r = E.get(done.id)!, file = join(E.rdir(done.id), "events.jsonl"), seq = r.events, real = { ...durableFs };
  (durableFs as any).writeSync = (fd: number, buf: Buffer, off: number) => { real.writeSync(fd, buf, off, 5); throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" }); };
  (durableFs as any).ftruncateSync = () => { throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" }); };
  r.ctx.cut = 1; let threw = false;
  try { E.commit(r, "fixture"); } catch { threw = true; } finally { Object.assign(durableFs, real); }
  ok(threw && r.events === seq, "a failed write leaves the run's seq where it was", `${seq} → ${r.events}`);
  ok(!!E.logFault(done.id), "… and a write that left half a commit it could not cut seals the run", JSON.stringify(E.logFault(done.id)));
  ok(r.status === "failed" && !!r.error, "… and stops it in memory (failed, its jobs stopped)", `${r.status} ${r.error}`);
  const size = statSync(file).size; r.ctx.after = 1; E.commit(r, "fixture");
  ok(statSync(file).size === size, "… nothing more is written behind it");
}

// ---------- the ledger ----------
{
  const L = new Ledger(H.data, "R-777"), entry = (n: number) => ({ run: "R-777", node: "a", edge: null, round: 1, head: null, check: `t/${n}`, version: "1", kind: "deterministic", attempt: 1, verdict: "pass", score: null, findings: [], evidence: [], proves: [], blocking: false, inputHash: "", params: {}, ms: 0, dir: null } as any);
  const paths = new Map<number, string>(), calls: string[] = [], real = { ...durableFs };
  (durableFs as any).openSync = (p: string, flag: string) => { const fd = real.openSync(p, flag); paths.set(fd, String(p)); return fd; };
  (durableFs as any).fsyncSync = (fd: number) => { calls.push(String(paths.get(fd))); return real.fsyncSync(fd); };
  try { L.add(entry(1)); } finally { Object.assign(durableFs, real); }
  ok(calls.filter((c) => c === L.file()).length === 1, "a ledger entry is written with one fsync", JSON.stringify(calls));
  L.add(entry(2));
  appendFileSync(L.file(), '{"run":"R-777","seq":3,"che'); // a crash inside the third entry's write
  ok(L.verify().length === 0, "a torn last ledger entry is not reported as a broken chain", JSON.stringify(L.verify()));
  const third = L.add(entry(3));
  ok(third.seq === 3 && L.verify().length === 0 && L.all().length === 3, "… the next entry cuts it off and the chain still verifies", JSON.stringify(L.verify()));
  const raw = readFileSync(L.file(), "utf8").split("\n"); raw.splice(1, 0, "{damaged"); writeFileSync(L.file(), raw.join("\n"));
  const scan = L.authenticatedPrefix();
  ok(scan.bad.includes(2) && scan.malformed && scan.prefix.length === 1, "a corrupt ledger line before the tail is reported (bad, malformed), not skipped", JSON.stringify(scan.bad));
  ok(!E.trusted("R-777").ok, "… and the run's ledger no longer counts as trusted");
}

H.stop();
end();
