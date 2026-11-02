import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Code work between two Studios (docs/units/lan-relay.md, Applying a code result): the dispatch names the dispatcher's
// project history and base commit; a project that does not hold them cannot take the work; the result names its base and
// applies there, never onto another base; the dispatcher applies only a result it accepted, from a peer still introduced
// and not frozen, naming the hash of the exact patch it read; and every commit applied joins the taint list.
//                                                                                                  bun tests/lan-code.ts
import { mkdtempSync, writeFileSync } from "node:fs";
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
const repoA = mkdtempSync(join(tmpdir(), "crew-lan-code-a-")), repoB = mkdtempSync(join(tmpdir(), "crew-lan-code-b-")), stranger = mkdtempSync(join(tmpdir(), "crew-lan-code-x-"));
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
{ const x: any = tryApply({ seen: sha256hex(patch) });
  ok(x.branch && g(repoA, "rev-parse", `${x.commit}^`) === base0 && g(repoA, "show", `${x.commit}:new.txt`) === "from the peer", "a good result applies onto the base it names (the commit dispatched), on its own branch", JSON.stringify(x));
  ok(A.view().taints.some((r: any) => r.sha === x.commit && r.peer.key === B.id.key) && !!taintOf(repoA, x.commit), "the applied commit joins the taint list, with its peer and thread");
  // the dispatcher's base branch moves on: the result still applies where it was based, never onto the new base
  writeFileSync(join(repoA, "later.txt"), "later\n"); g(repoA, "add", "later.txt"); g(repoA, "commit", "-qm", "later");
  const mine = g(repoA, "rev-parse", "main"); ok(mine !== base0 && g(repoA, "rev-parse", `${x.commit}^`) === base0, "the applied commit's parent is the dispatched base, not the base branch as it is now"); }
// a result based on another commit than the one dispatched is not applied
{ const th = (A as any).thread(t.id), r = th.rounds[0]; r.result.base = "f".repeat(40);
  const x: any = tryApply({ seen: sha256hex(patch) }); ok(/^base:/.test(x.err ?? ""), "a result based on another commit than the one this thread dispatched is not applied (never onto another base)", x.err); r.result.base = base0; }
A.close(); B.close();

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
  D.close(); T.close(); }
console.log(`\nlan-code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
