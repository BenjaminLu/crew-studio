import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Code work between two Studios (docs/units/lan-relay.md, Applying a code result): the dispatch names the dispatcher's
// project history and base commit; a project that does not hold them cannot take the work; the result names its base and
// applies there, never onto another base; the dispatcher applies only a result it accepted, from a peer still introduced
// and not frozen, naming the hash of the exact patch it read; and every commit applied joins the taint list.
//                                                                                                  bun tests/lan-code.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, sha256hex } from "../src/lan/crypto";
import { baseOf, baseProblem, lanApplier } from "../src/lan/apply";
import { makeEnvelope, sealBlob, type Body } from "../src/lan/protocol";
import { Lan, type LanRunner } from "../src/lan/relay";
import { call } from "../src/lan/wire";
import { taintOf } from "../src/lan/taint";

process.env.CREW_LAN_ALLOW_LOOPBACK = "1";
let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await Bun.sleep(25); } return true; };
const g = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "core.hooksPath=/dev/null", ...a], { cwd, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
const repoA = checkedTempDir("crew-lan-code-a-"), repoB = checkedTempDir("crew-lan-code-b-"), stranger = checkedTempDir("crew-lan-code-x-");
for (const r of [repoA, stranger]) { g(r, "init", "-q", "-b", "main"); writeFileSync(join(r, "README.md"), `${r === repoA ? "project" : "another"}\n`); g(r, "add", "README.md"); g(r, "commit", "-qm", "base"); }
g(repoB, "init", "-q", "-b", "main"); g(repoB, "fetch", "-q", repoA, "+refs/heads/main:refs/remotes/a/main"); // B's clone of the same project
const base0 = g(repoA, "rev-parse", "main");
const projects: Record<string, string> = { proj: repoA, other: stranger, bproj: repoB };
const runner = (): LanRunner => ({ workflows: () => [{ id: "code-firstmate", version: 1, name: "Code", defHash: "c".repeat(64), eligible: true, why: [], notRun: [], staffing: null, needsProject: true }],
  start: async () => ({ run: "R-1", workflow: { id: "code-firstmate", version: 1, defHash: "c".repeat(64) } }), status: () => ({ state: "running", result: null, spent: { usd: 0, rounds: 0 }, stopped: null }), output: async () => { throw new Error("no"); }, cancel: () => {} });
const mk = (name: string) => Lan.open({ dataDir: mkdtempSync(join(tmpdir(), `crew-lan-code-${name}-`)), runner: runner(), bind: "127.0.0.1", port: 0,
  baseOf: (id) => projects[id] ? baseOf(projects[id], "main") : null, baseProblem: (id, b) => projects[id] ? baseProblem(projects[id], b) : "no such project",
  apply: lanApplier({ dataDir: mkdtempSync(join(tmpdir(), "crew-lan-code-ad-")), project: (id) => projects[id] ? { path: projects[id], base: "main" } : null }) });
const authorOf = (x: Lan) => (x as any).author(), recOf = (x: Lan) => ({ id: x.id.key, dh: (x as any).ks.dhPub }), meOf = (x: Lan) => (x as any).me();
const peerOf = (x: Lan) => ({ key: x.id.key, dh: (x as any).ks.dhPub.toString("base64url"), host: "127.0.0.1", port: x.wire.port });
async function pairUp(A: Lan, B: Lan) { B.openIntro(1); const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros[0]; await A.confirmIntro(ia.id, ib.sas, "B"); await B.confirmIntro(ib.id, ia.sas, "A"); }

const A = await mk("a"), B = await mk("b"); A.setEnabled(true); B.setEnabled(true); await pairUp(A, B);
const t = await A.dispatch({ to: B.id.key, title: "code", briefing: "add a file", project: "proj" }); await A.flush(); await until(() => B.view().items.length === 1);
ok(t.base?.sha === base0 && B.thread(t.id)?.base?.sha === base0 && /^[0-9a-f]{40}$/.test(String(B.thread(t.id)?.base?.root)), "the dispatch names the dispatcher's project history and base commit, and the taker records it", JSON.stringify(B.thread(t.id)?.base));
// the taker's project must hold that history and that commit
{ const d = B.view().items[0], th = B.thread(d.thread)!; let e = "";
  try { await B.approve(d.id, { workflow: "code-firstmate", seen: B.seenHash(th, th.rounds[0]), project: "other", roundsOnly: true, rounds: 3 }); } catch (x: any) { e = `${x.code}: ${x.message}`; }
  ok(/^base: .*does not share/.test(e), "a project that does not share the dispatcher's history cannot take the code work", e);
  await B.approve(d.id, { workflow: "code-firstmate", seen: B.seenHash(th, th.rounds[0]), project: "bproj", roundsOnly: true, rounds: 3 }); await B.flush(); }
await until(() => A.view().items.some((i: any) => i.kind === "take")); await A.approve(A.view().items.find((i: any) => i.kind === "take")!.id); await A.flush();
await until(() => B.thread(t.id)?.rounds[0].assign !== null);
// the taker's result: a patch that adds a file, over the base it names
const patch = `diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+from the peer\n`;
const result = async (seq: number, base: string | null) => {
  const plain = Buffer.from(canonical({ files: [{ path: "changes.patch", text: patch }] })), blob = sealBlob(plain, [recOf(A)], recOf(B)), r = B.thread(t.id)!.rounds[0];
  const e = await makeEnvelope(authorOf(B), seq, (B as any).st.logs[B.id.key].head, [recOf(A)], { kind: "result", thread: t.id, round: 1, take: r.take!.entry, briefing: r.briefing.hash, output: { hash: blob.hash, size: plain.length, files: [{ path: "changes.patch", bytes: patch.length }] },
    workflow: { id: "code-firstmate", version: 1, defHash: "c".repeat(64) }, run: "R-1", checks: { pass: 1, fail: 0, other: 0, summary: "1/1" }, ...(base ? { base } : {}) } as Body);
  return call(meOf(B), peerOf(A), "push", { entries: [e], blobs: [blob] });
};
const r1 = await result((B as any).st.logs[B.id.key].seq + 1, base0);
ok(r1.accepted?.length === 1, "the taker's code result is taken in", JSON.stringify(r1));
const it = A.view().items.find((i: any) => i.kind === "result")!;
const tryApply = (o: any) => { try { return A.applyResult(t.id, { project: "proj", ...o }); } catch (e: any) { return { err: `${e.code}: ${e.message}` }; } };
{ const x: any = tryApply({ seen: sha256hex(patch) }); ok(/^accept:/.test(x.err ?? ""), "a result is not applied before the dispatcher accepted it", x.err); }
await A.approve(it.id);
{ const x: any = tryApply({}); ok(/^unread:/.test(x.err ?? ""), "an apply that does not name the hash of the patch it showed is refused", x.err); }
{ const x: any = tryApply({ seen: sha256hex(patch + " ") }); ok(/^unread:/.test(x.err ?? ""), "an apply naming another patch's hash is refused", x.err); }
{ const p = (A as any).peer(B.id.key); p.frozen = { at: "x", seq: 1, entries: ["a", "b"], why: "test" }; const x: any = tryApply({ seen: sha256hex(patch) }); p.frozen = null;
  ok(/^peer:/.test(x.err ?? ""), "a frozen peer's result is not applied", x.err); }
// the commit is on the taint list before any branch names it: written (with an "apply-pending" audit row) after commit-tree and
// before update-ref. An audit write that fails leaves no branch; an update-ref that fails keeps the row; an applier that
// reports no commit is an error, never a silent apply with nothing recorded
const branchOf = `lan-untrusted/${t.id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-r1`;
const hasBranch = () => Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branchOf}`], { cwd: repoA }).exitCode === 0;
{ const st = A.store as any, keep = st.audit.bind(st); st.audit = (kind: string, data: unknown) => { if (kind === "apply-pending") throw new Error("disk full"); return keep(kind, data); };
  const x: any = tryApply({ seen: sha256hex(patch) }); st.audit = keep;
  const rows = A.view().taints.filter((r: any) => r.thread === t.id);
  ok(/^apply:/.test(x.err ?? "") && !hasBranch() && rows.length === 1, "an audit write that fails stops the apply before any branch exists, and the commit stays on the taint list", JSON.stringify([x.err, hasBranch(), rows.length])); }
{ const lock = join(repoA, ".git", "refs", "heads", "lan-untrusted"); Bun.spawnSync(["mkdir", "-p", lock]); writeFileSync(join(repoA, ".git", `refs/heads/${branchOf}.lock`), "");
  const x: any = tryApply({ seen: sha256hex(patch) }); Bun.spawnSync(["rm", "-f", join(repoA, ".git", `refs/heads/${branchOf}.lock`)]);
  const pend = A.auditView().rows.filter((r: any) => r.what === "apply-pending");
  ok(/^apply:/.test(x.err ?? "") && !hasBranch() && A.view().taints.some((r: any) => r.thread === t.id) && pend.length >= 1, "an update-ref that fails keeps the taint row (and the apply-pending audit row)", JSON.stringify([x.err, hasBranch(), pend.length])); }
{ const o = (A as any).o, keep = o.apply; o.apply = (a: any) => ({ branch: a.branch, path: repoA, files: ["new.txt"] });
  const x: any = tryApply({ seen: sha256hex(patch) }); o.apply = keep;
  ok(/^apply: .*no commit/.test(x.err ?? ""), "an applier that names no commit recorded on the taint list is an error, never an apply with nothing tainted", x.err); }
{ const x: any = tryApply({ seen: sha256hex(patch) });
  ok(x.branch && g(repoA, "rev-parse", `${x.commit}^`) === base0 && g(repoA, "show", `${x.commit}:new.txt`) === "from the peer", "a good result applies onto the base it names (the commit dispatched), on its own branch", JSON.stringify(x));
  ok(A.view().taints.some((r: any) => r.sha === x.commit && r.peer.key === B.id.key) && !!taintOf(repoA, x.commit), "the applied commit joins the taint list, with its peer and thread");
  // the taint list follows the commit, not the folder: a second clone, a fetch into another clone, a moved folder
  { const c2 = checkedTempDir("crew-lan-code-clone-"); g(c2, "clone", "-q", "--no-local", repoA, "."); g(c2, "fetch", "-q", "origin", `+refs/heads/${x.branch}:refs/heads/elsewhere`);
    g(repoB, "fetch", "-q", repoA, `+refs/heads/${x.branch}:refs/heads/from-a`);
    const moved = repoA + "-moved"; Bun.spawnSync(["mv", repoA, moved]);
    const hits = [taintOf(c2, "elsewhere"), taintOf(repoB, "from-a"), taintOf(moved, x.commit)];
    Bun.spawnSync(["mv", moved, repoA]);
    ok(hits.every(Boolean), "a commit applied from a peer is tainted in a second clone, in another clone it was fetched into, and after the folder moved", JSON.stringify(hits.map(Boolean))); }
  // the dispatcher's base branch moves on: the result still applies where it was based, never onto the new base
  writeFileSync(join(repoA, "later.txt"), "later\n"); g(repoA, "add", "later.txt"); g(repoA, "commit", "-qm", "later");
  const mine = g(repoA, "rev-parse", "main"); ok(mine !== base0 && g(repoA, "rev-parse", `${x.commit}^`) === base0, "the applied commit's parent is the dispatched base, not the base branch as it is now"); }
// a result based on another commit than the one dispatched is not applied
{ const th = (A as any).thread(t.id), r = th.rounds[0]; r.result.base = "f".repeat(40);
  const x: any = tryApply({ seen: sha256hex(patch) }); ok(/^base:/.test(x.err ?? ""), "a result based on another commit than the one this thread dispatched is not applied (never onto another base)", x.err); r.result.base = base0; }
// a code result is applied only onto a base this Studio dispatched: a thread that named none takes no result's own base
{ const th = (A as any).thread(t.id), keep = th.base; th.base = null;
  const x: any = tryApply({ seen: sha256hex(patch) }); th.base = keep;
  ok(/^base:/.test(x.err ?? ""), "a result for a thread that dispatched no base is not applied onto the base the peer names", x.err); }
// a pinned base branch that was moved is refused, never trusted
{ const { pinBase } = await import("../src/lan/apply"); const name = pinBase(repoA, base0);
  g(repoA, "update-ref", `refs/heads/${name}`, g(repoA, "rev-parse", "main")); let e = ""; try { pinBase(repoA, base0); } catch (x: any) { e = String(x?.message ?? x); }
  ok(/moved|points at/.test(e), "a lan-base/ branch that no longer points at the dispatched commit is refused (never a silent other base)", e);
  g(repoA, "update-ref", `refs/heads/${name}`, base0); }
// a step that fails is rolled back in place: a reference taken before it sees the state as it was, and is still the one
// the relay holds (never an orphaned copy)
{ const th = (A as any).thread(t.id), title0 = th.title, n0 = th.rounds.length, threads0 = (A as any).st.threads.length;
  try { (A as any).step(() => { th.title = "changed in a step that fails"; th.rounds.push({ n: 99 }); (A as any).st.threads.unshift({ id: "ghost", rounds: [], steps: [] }); throw new Error("fails"); }); } catch {}
  ok((A as any).thread(t.id) === th && th.title === title0 && th.rounds.length === n0 && (A as any).st.threads.length === threads0 && !(A as any).thread("ghost"), "a failed step is rolled back in place: a reference held before it is the relay's own again, with what it held before", JSON.stringify([(A as any).thread(t.id) === th, th.title, th.rounds.length])); }
// the taint list outlives the relay: closed, its records are still in lan/taint.db, opened on their own (as at a start with
// CREW_LAN=0); clearing one commit ("I reviewed commit X") clears it in every repository
const dirA = (A as any).o.dataDir, applied = A.view().taints.find((r: any) => r.thread === t.id && hasBranch() && g(repoA, "rev-parse", branchOf) === r.sha)?.sha;
A.close(); B.close();
{ const { openTaintList, setTaintSource } = await import("../src/lan/taint") as any; setTaintSource(null);
  const list = openTaintList(dirA);
  ok(!!applied && !!taintOf(repoA, applied), "with the relay closed, the taint list opened on its own still holds the applied commit", String(applied));
  // the project itself carries the taint too (refs/crew/lan-taint/<sha>, written before the branch): with no list at all
  // (taint.db and its sentinel gone with the lan folder) the commit and what is built on it are still tainted there
  const refOf = (repo: string) => Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `refs/crew/lan-taint/${applied}`], { cwd: repo, stdout: "pipe" }).stdout.toString().trim();
  list.close(); setTaintSource(null);
  ok(refOf(repoA) === applied && !!taintOf(repoA, applied!), "with no taint list open at all, the commit is still tainted in its project by its ref (refs/crew/lan-taint)", refOf(repoA));
  // outside a test run, no taint list open is a refusal (fail closed), never "nothing tainted"
  { const iso = process.env.CREW_TEST_ENV_ISOLATED; delete process.env.CREW_TEST_ENV_ISOLATED; const { taintRefusal } = await import("../src/lan/taint");
    const r = taintRefusal(stranger, "HEAD", "Push"); process.env.CREW_TEST_ENV_ISOLATED = iso;
    ok(/no list of commits applied from peers is open/.test(r ?? ""), "outside a test run, a check with no taint list open refuses (fail closed)", String(r)); }
  // "I reviewed commit X" is an admin signature (purpose "reviewed", over the commit and the time), kept in the audit row;
  // the commit is then clear in every repository that holds it
  const A2 = await Lan.open({ dataDir: dirA, runner: runner(), bind: "127.0.0.1", port: 0 });
  await A2.clearTaint(applied);
  const row = A2.auditView().rows.reverse().find((r: any) => r.what === "taint-cleared") as any;
  const { verifyAdmin } = await import("../src/lan/keystore"), { unb64u } = await import("../src/lan/crypto");
  ok(!!row && verifyAdmin((A2 as any).ks.identity, "reviewed", [applied!, row.data.at], unb64u(row.data.sig, 64)), "clearing a commit is signed with the admin key (purpose reviewed), and the audit row keeps the signature", JSON.stringify(row?.data));
  ok(!taintOf(repoA, applied!) && !taintOf(repoB, "from-a") && !refOf(repoA), "a commit cleared by its SHA is clear in every repository that holds it, its ref deleted too", refOf(repoA));
  A2.close(); }

// a taint list that was deleted, or restored from an older copy, is not "nothing tainted": its sentinel
// (lan/taint.created, with the most rows the list ever held) says it was there, so it is broken and refuses everywhere
{ const { TaintStore } = await import("../src/lan/taint") as any, { rmSync, copyFileSync, existsSync: ex } = await import("node:fs");
  const d = mkdtempSync(join(tmpdir(), "crew-lan-taint-hw-")), f = join(d, "lan", "taint.db");
  const row = (sha: string) => ({ sha, repo: repoA, project: "proj", peer: "p", thread: "t", round: 1, at: new Date().toISOString(), why: "test" });
  const s1 = new TaintStore(f); ok(!s1.broken && ex(join(d, "lan", "taint.created")), "a new taint list is made with its sentinel", String(s1.broken)); s1.add(row("a".repeat(40))); s1.close();
  copyFileSync(f, join(d, "old.db"));
  const s2 = new TaintStore(f); s2.add(row("b".repeat(40))); s2.close();
  for (const x of ["", "-wal", "-shm"]) rmSync(f + x, { force: true }); copyFileSync(join(d, "old.db"), f);
  const older = new TaintStore(f); ok(/fewer|older/.test(String(older.broken)), "a taint list restored from an older copy (fewer rows than it held) is broken: every check refuses", String(older.broken)); older.close();
  for (const x of ["", "-wal", "-shm"]) rmSync(f + x, { force: true });
  const gone = new TaintStore(f); ok(/missing/.test(String(gone.broken)) && !ex(f), "a taint list that was deleted is not made again empty: it is broken, every check refuses", String(gone.broken)); gone.close();
  const d2 = mkdtempSync(join(tmpdir(), "crew-lan-taint-up-")); { const s = new TaintStore(join(d2, "lan", "taint.db")); s.add(row("c".repeat(40))); s.close(); } rmSync(join(d2, "lan", "taint.created"));
  const up = new TaintStore(join(d2, "lan", "taint.db")); ok(!up.broken && ex(join(d2, "lan", "taint.created")), "a list made before the sentinel existed is kept, and gets its sentinel", String(up.broken)); up.close(); }

// the same take pushed twice at the same moment is taken in once (its verdict is checked again inside the transaction)
{ const C = await mk("twice-c"), D = await mk("twice-d"); C.setEnabled(true); D.setEnabled(true); await pairUp(C, D);
  const t2 = await C.dispatch({ to: D.id.key, title: "twice", briefing: "the same take, twice" }); await C.flush(); await until(() => D.view().items.some((i: any) => i.thread === t2.id));
  const d2 = D.view().items.find((i: any) => i.thread === t2.id)!, th2 = D.thread(t2.id)!;
  await D.approve(d2.id, { workflow: "code-firstmate", seen: D.seenHash(th2, th2.rounds[0]), project: "bproj", rounds: 3 });
  const ob = (D as any).st.outbox.find((x: any) => x.thread === t2.id), env = (D as any).entry(ob.entry), blobs = ob.blobs.map((h: string) => (D as any).blob(h));
  const res = await Promise.all([0, 1].map(() => (C as any).request(D.id.key, "push", { entries: [env], blobs }, "127.0.0.1", null)));
  const takes = C.view().items.filter((i: any) => i.thread === t2.id && i.kind === "take"), steps = C.thread(t2.id)?.steps.filter((x: any) => x.kind === "take").length ?? 0;
  ok(takes.length === 1 && steps === 1, "a take pushed twice at the same moment raises one inbox item and one step", JSON.stringify([takes.length, steps, res]));
  (D as any).st.outbox = (D as any).st.outbox.filter((x: any) => x.thread !== t2.id); C.close(); D.close(); }

// a refinement carries over what the taker handed back last round: its prompt shows that result to revise (bound into
// the hash the taker approves), so a document revision has its draft
{ const out: any = { files: [{ path: "report.md", text: "# report v1\nthe first draft\n", bytes: 28 }], changed: ["report.md"], protectedHits: [], checks: { pass: 1, fail: 0, other: 0, summary: "1/1" }, workflow: { id: "documents", version: 1, defHash: "d".repeat(64) }, kind: "files" };
  const run = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Docs", defHash: "d".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
    start: async () => ({ run: "R-31", workflow: { id: "documents", version: 1, defHash: "d".repeat(64) } }), status: () => ({ state: "succeeded", result: "done", spent: { rounds: 1, tokens: 0, minutes: 0 }, stopped: null }), output: async () => out, cancel: () => {} });
  const mk3 = (n: string) => Lan.open({ dataDir: mkdtempSync(join(tmpdir(), `crew-lan-refine-${n}-`)), runner: run(), bind: "127.0.0.1", port: 0 });
  const D = await mk3("d"), T = await mk3("t"); D.setEnabled(true); T.setEnabled(true); await pairUp(D, T);
  const th = await D.dispatch({ to: T.id.key, title: "a report", briefing: "write the report" }); await D.flush(); await until(() => T.view().items.length === 1);
  const d = T.view().items[0], tt = T.thread(d.thread)!; await T.approve(d.id, { workflow: "documents", seen: T.seenHash(tt, tt.rounds[0]), rounds: 3 }); await T.flush();
  await until(() => D.view().items.some((i: any) => i.kind === "take")); await D.approve(D.view().items.find((i: any) => i.kind === "take")!.id); await D.flush();
  await until(() => T.view().items.some((i: any) => i.kind === "assign")); await T.approve(T.view().items.find((i: any) => i.kind === "assign")!.id);
  const pre = await T.handbackPreview(th.id); await T.handback(th.id, { confirm: pre.hash }); await T.flush();
  await until(() => D.view().items.some((i: any) => i.kind === "result")); await D.approve(D.view().items.find((i: any) => i.kind === "result")!.id);
  await D.refine(th.id, { briefing: "make it shorter" }); await D.flush();
  await until(() => T.view().items.some((i: any) => i.kind === "refine"));
  const rf = T.view().items.find((i: any) => i.kind === "refine")!, t2 = T.thread(th.id)!, prompt = (T as any).prompt(t2, t2.rounds[1]);
  ok(/the first draft/.test(prompt) && /previous round/i.test(prompt) && rf.prompt === prompt, "a refinement's prompt carries the taker's own previous result to revise, and is what the taker approves", prompt.slice(-400));
  D.close(); T.close(); }

// a hand-back cannot carry a binary file: the preview says so and the send is refused (never a silent drop)
{ const out = { files: [{ path: "report.md", text: "# report\n", bytes: 9 }, { path: "chart.png", text: null, bytes: 2048 }], changed: ["report.md", "chart.png"], protectedHits: [], checks: { pass: 1, fail: 0, other: 0, summary: "1/1" }, workflow: { id: "documents", version: 1, defHash: "d".repeat(64) }, kind: "files" as const };
  const run = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Docs", defHash: "d".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
    start: async () => ({ run: "R-9", workflow: { id: "documents", version: 1, defHash: "d".repeat(64) } }), status: () => ({ state: "succeeded", result: "done", spent: { usd: 0, rounds: 1 }, stopped: null }), output: async () => out, cancel: () => {} });
  const mk2 = (n: string, r: LanRunner) => Lan.open({ dataDir: mkdtempSync(join(tmpdir(), `crew-lan-bin-${n}-`)), runner: r, bind: "127.0.0.1", port: 0 });
  const D = await mk2("d", run()), T = await mk2("t", run()); D.setEnabled(true); T.setEnabled(true); await pairUp(D, T);
  const th = await D.dispatch({ to: T.id.key, title: "a report", briefing: "x" }); await D.flush(); await until(() => T.view().items.length === 1);
  const d = T.view().items[0], tt = T.thread(d.thread)!; await T.approve(d.id, { workflow: "documents", seen: T.seenHash(tt, tt.rounds[0]), roundsOnly: true, rounds: 3 }); await T.flush();
  await until(() => D.view().items.some((i: any) => i.kind === "take")); await D.approve(D.view().items.find((i: any) => i.kind === "take")!.id); await D.flush();
  await until(() => T.view().items.some((i: any) => i.kind === "assign")); await T.approve(T.view().items.find((i: any) => i.kind === "assign")!.id);
  const pre = await T.handbackPreview(th.id); let e = ""; try { await T.handback(th.id, { confirm: pre.hash }); } catch (x: any) { e = `${x.code}: ${x.message}`; }
  ok(!pre.ok && pre.binary.includes("chart.png") && /^binary:/.test(e), "a binary file in the output is a refusal at the hand-back (shown in the preview), never dropped silently", JSON.stringify([pre.ok, pre.binary, e]));
  // the preview counts what goes back per file, and too much added text blocks the send (C-S2)
  out.files = [{ path: "report.md", text: "line\n".repeat(30_000), bytes: 150_000 }];
  const big = await T.handbackPreview(th.id); let e2 = ""; try { await T.handback(th.id, { confirm: big.hash }); } catch (x: any) { e2 = `${x.code}: ${x.message}`; }
  ok(big.stats?.[0]?.path === "report.md" && big.stats[0].added === 30_001 && big.tooMuchAdded && !big.ok && /^added:/.test(e2), "the preview counts what each file adds, and more added text than a round may hand back blocks the send", JSON.stringify([big.stats, big.addedBytes, e2]));
  D.close(); T.close(); }
console.log(`\nlan-code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
