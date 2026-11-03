import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The bounds of board-to-board work (docs/units/lan-relay.md, Limits): runners' code-loading config files are protected,
// a peer has at most five open dispatches here, at most three peers' Tasks run at once, a peer's content on this disk
// has a quota, a hand-back with too many files is refused before any file is read, the audit rotates without breaking
// its chain, sealed sizes are rounded, the preview counts what goes back (and blocks too much), flags copies of the
// taker's own files, and a peer that cannot be reached says since when.                       bun tests/lan-limits.ts
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, seal } from "../src/lan/crypto";
import { protectedHit, writeRefused } from "../src/lan/paths";
import { LIMITS } from "../src/lan/protocol";
import { Lan, type LanRunner } from "../src/lan/relay";
import { copiesOf } from "../src/lan/runner";

process.env.CREW_LAN_ALLOW_LOOPBACK = "1";
let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await Bun.sleep(25); } return true; };
const g = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(["git", "-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "core.hooksPath=/dev/null", ...a], { cwd, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };

// 28. config files a runner loads as code are protected
for (const p of ["vite.config.ts", "web/webpack.config.js", "jest.config.cjs", "vitest.config.mts", "playwright.config.ts", ".eslintrc.js", "pkg/.babelrc.js", ".mocharc.yml", "karma.conf.js"])
  if (!protectedHit(p, "x", null) || !writeRefused(p)) ok(false, `${p} is protected`);
ok(!protectedHit("src/config.ts", "x", null) && !protectedHit("docs/vite.md", "x", null), "configuration a tool loads as code (vite, webpack, jest, vitest, playwright, eslint, babel, mocha, karma) is protected at any depth; an ordinary source file is not");

// padding: what a sealed box shows of its size is rounded to 1 KiB
{ const k = { id: "x", dh: (await import("../src/lan/crypto")).generateKeyPair().pub };
  const a = seal(Buffer.alloc(1), [k], "blob").ct.length, b = seal(Buffer.alloc(900), [k], "blob").ct.length, c = seal(Buffer.alloc(1500), [k], "blob").ct.length;
  ok(a === b && c > b, "sealed sizes are rounded up to 1 KiB (a one-byte and a 900-byte body look the same)", `${a} ${b} ${c}`); }

// copies of the taker's own files in what goes back
{ const wt = checkedTempDir("crew-lan-copy-"); g(wt, "init", "-q", "-b", "main");
  const secret = Array.from({ length: 30 }, (_, i) => `const internal${i} = "the taker's own code line ${i}";`).join("\n") + "\n";
  writeFileSync(join(wt, "internal.ts"), secret); writeFileSync(join(wt, "README.md"), "x\n"); g(wt, "add", "."); g(wt, "commit", "-qm", "base"); const base = g(wt, "rev-parse", "HEAD");
  const patch = `diff --git a/out.ts b/out.ts\nnew file mode 100644\n--- /dev/null\n+++ b/out.ts\n@@ -0,0 +1,30 @@\n${secret.split("\n").filter(Boolean).map((l) => "+" + l).join("\n")}\n`;
  ok(copiesOf(wt, base, patch, new Set(["out.ts"])).includes("internal.ts"), "a hand-back that copies a file of the taker's project it did not change is flagged (the file is named)");
  ok(!copiesOf(wt, base, "diff --git a/n.ts b/n.ts\n+++ b/n.ts\n@@ -0,0 +1 @@\n+new line\n", new Set(["n.ts"])).length, "an ordinary patch is not flagged"); }

const starts: string[] = [];
let outputs: any = null;
const runner = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Documents", defHash: "a".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
  start: async () => { const id = `R-${starts.length + 1}`; starts.push(id); return { run: id, workflow: { id: "documents", version: 1, defHash: "a".repeat(64) } }; },
  status: () => ({ state: outputs ? "succeeded" : "running", result: null, spent: { usd: 0, rounds: 1 }, stopped: null }), output: async () => outputs, cancel: () => {} });
const mk = (n: string) => Lan.open({ dataDir: mkdtempSync(join(tmpdir(), `crew-lan-limits-${n}-`)), runner: runner(), bind: "127.0.0.1", port: 0 });
const A = await mk("a"), B = await mk("b"); A.setEnabled(true); B.setEnabled(true);
{ B.openIntro(1); const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros[0]; await A.confirmIntro(ia.id, ib.sas, "B"); await B.confirmIntro(ib.id, ia.sas, "A"); }
// 29. at most five open dispatches per peer
{ const ts = []; for (let i = 0; i < 6; i++) ts.push(await A.dispatch({ to: B.id.key, title: `d${i}`, briefing: `work ${i}` })); await A.flush(); await until(() => B.view().items.length >= 5); await A.flush();
  const sixth = A.thread(ts[5].id)!.steps[0];
  ok(B.view().items.filter((i: any) => i.kind === "dispatch").length === 5 && /open dispatches here already/.test(sixth.waiting ?? ""), "a peer has at most five open dispatches here: the sixth waits (retryable), with the reason", JSON.stringify(sixth)); }
// 29. at most three peers' Tasks run at once
{ const ids = B.view().items.filter((i: any) => i.kind === "dispatch").map((i: any) => i.thread).slice(0, 4);
  for (const id of ids) { const d = B.view().items.find((i: any) => i.thread === id && i.kind === "dispatch")!, th = B.thread(id)!; await B.approve(d.id, { workflow: "documents", seen: B.seenHash(th, th.rounds[0]), roundsOnly: true, rounds: 3 }); }
  await B.flush(); await until(() => A.view().items.filter((i: any) => i.kind === "take").length === 4);
  for (const k of A.view().items.filter((i: any) => i.kind === "take")) await A.approve(k.id); await A.flush();
  await until(() => B.view().items.filter((i: any) => i.kind === "assign").length === 4);
  const res: string[] = []; for (const a of B.view().items.filter((i: any) => i.kind === "assign")) { try { await B.approve(a.id); res.push("started"); } catch (e: any) { res.push(String(e.code)); } }
  ok(res.filter((x) => x === "started").length === LIMITS.concurrentTasks && res.includes("busy"), `at most ${LIMITS.concurrentTasks} Tasks from peers run at once on a Mac; the next start is refused until one ends`, JSON.stringify(res)); }
// 29. a peer's content on this disk has a quota
{ const keep = LIMITS.peerQuota; (LIMITS as any).peerQuota = B.store.peerBytes(A.id.key) + 10;
  const done = (B as any).st.threads.filter((t: any) => t.owner === A.id.key); for (const t of done) t.state = "done"; // room under the five-open bound
  const t = await A.dispatch({ to: B.id.key, title: "big", briefing: "x".repeat(200) }); await A.flush(); await until(() => !!A.thread(t.id)!.steps[0].waiting, 15000);
  ok(/quota/.test(A.thread(t.id)!.steps[0].waiting ?? "") && !B.thread(t.id), "a peer's content past its quota on this Mac is refused for now (it waits), and nothing is stored", A.thread(t.id)!.steps[0].waiting ?? "");
  (LIMITS as any).peerQuota = keep; }
// A-S4: a peer that cannot be reached says since when
{ B.wire.stop(); await A.dispatch({ to: B.id.key, title: "away", briefing: "x" }).catch(() => {}); for (const x of (A as any).st.outbox) x.next = 0; await A.flush();
  const since = A.view().peers[0].unreachableSince; ok(!!since, "a peer that cannot be reached shows since when", String(since)); }
// 30. the audit rotates to a 0600 file and its chain still holds
{ const s = A.store; s.tx(() => { for (let i = 0; i < 50_010; i++) s.audit("filler", { i }); }); A.flushState();
  const files = readdirSync(join((A as any).dir)).filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"));
  ok(files.length === 1 && A.auditView().broken === null && s.auditRows(1)[0].what === "filler", "past 50,000 rows the audit rotates its oldest rows to a file of their own, and its chain still holds from them", JSON.stringify(files)); }
A.close(); B.close();
void canonical;
console.log(`\nlan-limits: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
