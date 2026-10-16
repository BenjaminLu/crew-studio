import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Worktrees (units worktrees, fix-worktrees-r1; architecture §10): one worktree per
// task in Studio's own marked namespace data/work/wt/<project>/<task>, one round at a time, each round at the branch's
// durable head with its dependencies installed, hand-back by a commit as the agent,
// nothing reset without a kept ref and a record, cleanup after merge, a startup sweep
// that never touches a live run's worktree, and never a worktree inside a protected
// root or the target repository.      bun tests/worktrees.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const { Worktrees, RoundBlocked } = await import("../src/worktrees");
const sh = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }); return { ok: r.success, out: (r.stdout.toString() + r.stderr.toString()).trim() }; };
const tmp = checkedTempDir("crew-wt-");
const data = join(tmp, "data"); mkdirSync(data);
// a repository with a local dependency (offline: a file: package) and a bun lockfile
const repo = join(tmp, "repo"); mkdirSync(join(repo, "vendor", "helper"), { recursive: true }); mkdirSync(join(repo, "test"));
writeFileSync(join(repo, "vendor/helper/package.json"), JSON.stringify({ name: "helper", version: "1.0.0", main: "index.js" }));
writeFileSync(join(repo, "vendor/helper/index.js"), "module.exports = { twice: (n) => n * 2 };\n");
const escapee = join(tmp, "postinstall-ran.txt");
writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", private: true, dependencies: { helper: "file:./vendor/helper" }, scripts: { postinstall: `node -e "const fs=require('fs'); fs.writeFileSync('ran-in-tree.txt','x'); try { fs.writeFileSync('${escapee}','x') } catch (e) {}"` } }, null, 1));
writeFileSync(join(repo, "test/twice.test.ts"), 'import { expect, test } from "bun:test";\nimport { twice } from "helper";\ntest("twice", () => expect(twice(2)).toBe(4));\n');
writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
writeFileSync(join(repo, "a.txt"), "one\n");
sh(repo, "git", "init", "-q", "-b", "main"); sh(repo, "bun", "install", "--ignore-scripts"); sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-qm", "init");
ok(existsSync(join(repo, "bun.lock")) || existsSync(join(repo, "bun.lockb")), "fixture: the repository has a bun lockfile");
const W = new Worktrees(data, { protect: () => [join(tmp, "protected")] });
const base = sh(repo, "git", "rev-parse", "main").out;

// one worktree per task under data/work/<project>/<task>, on branch_prefix + task
const r = W.ensure({ project: "demo", task: "R-001", repo, base: "main", branchPrefix: "feature/", run: "R-001" });
ok(r.path === join(data, "work", "wt", "demo", "R-001") && r.kind === "crew-worktree" && existsSync(join(data, "work", "wt", "demo", "R-001.marker")) && r.branch === "feature/R-001" && sh(r.path, "git", "symbolic-ref", "--short", "HEAD").out === "feature/R-001",
  "the worktree lives at data/work/wt/<project>/<task>, marked as Studio's, on the branch the prefix names (the task id as it is)", JSON.stringify(r));
{ const bad: string[] = []; for (const t of [".", "..", "../x", "a/b", "R-001/../x", ""]) { try { W.ensure({ project: "demo", task: t, repo, base: "main", branchPrefix: "feature/" }); bad.push(t); } catch {} }
  ok(!bad.length, "a task or project id that is not one safe segment (., .., a slash) is refused, never rewritten into a colliding folder", JSON.stringify(bad));
  let e = ""; try { W.ensure({ project: "demo", task: "r-001", repo, base: "main", branchPrefix: "feature/" }); } catch (x: any) { e = x.message; }
  let e2 = ""; try { W.ensure({ project: "DEMO", task: "R-001", repo, base: "main", branchPrefix: "feature/" }); } catch (x: any) { e2 = x.message; }
  ok(/differs only by case/.test(e) && /differs only by case/.test(e2), "a task or project that differs only by case from one that has a worktree is refused (they would share a folder on APFS)", `${e} | ${e2}`); }

// a fresh worktree gets its dependencies before the agent starts, so its tests run (not skip)
{ const s = await W.startRound("demo", "R-001", "source-only spec", { write: false, skipInstall: true, install: ["must-not-execute"] });
  ok(s.deps.ran === null && !existsSync(join(r.path, "node_modules")) && s.head === base, "source-only spec skips explicit and auto dependency installation while binding the durable head");
  s.release();
}
{ const s = await W.startRound("demo", "R-001", "offline build", { install: false });
  ok(s.deps.ran === null && !existsSync(join(r.path, "node_modules")), "explicit install=false suppresses lockfile auto-install for offline builds");
  s.release();
  const review = await W.installIn(r.path, "offline-review", false);
  ok(review.ran === null, "explicit install=false also suppresses fresh review checkout installs");
}
{ const s = await W.startRound("demo", "R-001", "build round 1");
  const t = sh(r.path, "bun", "test");
  ok(s.deps.ran?.join(" ") === "bun install --frozen-lockfile --ignore-scripts" && existsSync(join(r.path, "node_modules", "helper")) && t.ok && /1 pass/.test(t.out), "a fresh worktree gets its dependencies (bun install --frozen-lockfile --ignore-scripts) and its tests run", t.out.slice(-200));
  ok(!existsSync(escapee) && !existsSync(join(r.path, "ran-in-tree.txt")), "the install runs no lifecycle script a round may have written (not even inside the tree)");
  // two rounds cannot take one worktree
  let e = ""; try { await W.startRound("demo", "R-001", "build round 1 (again)"); } catch (x: any) { e = x.message; }
  ok(/taken/.test(e), "a second round cannot take a worktree a round holds", e);
  // hand-back: a commit as the agent, with run, node and round trailers
  writeFileSync(join(r.path, "a.txt"), "two\n");
  const hb = W.handBack("demo", "R-001", { run: "R-001", node: "build", round: 1, agent: "claude·claude-opus-5-5", message: "feat: say two" });
  const msg = sh(r.path, "git", "log", "-1", "--format=%an|%B").out;
  ok(hb.committed && /^Crew agent \(claude·claude-opus-5-5\)\|/.test(msg) && /Crew-Run: R-001/.test(msg) && /Crew-Node: build/.test(msg) && /Crew-Round: 1/.test(msg) && /Crew-Agent: claude·claude-opus-5-5/.test(msg) && W.get("demo", "R-001")!.head === hb.head, "a round hands back by a commit as the agent, with run, node, round and agent trailers; that commit is the durable head", msg);
  s.release();
  // read-only between rounds
  let w = ""; try { writeFileSync(join(r.path, "a.txt"), "sneaky\n"); } catch (x: any) { w = x.code; }
  ok(w === "EACCES" && readFileSync(join(r.path, "a.txt"), "utf8") === "two\n", "between rounds the worktree is read-only", w); }
const h1 = W.get("demo", "R-001")!.head;

// a stale local branch is caught before the agent starts, and corrected; what it held is kept on a kept ref
{ W.thaw(W.get("demo", "R-001")!); sh(r.path, "git", "reset", "-q", "--hard", base); writeFileSync(join(r.path, "stray.txt"), "left over\n");
  const s = await W.startRound("demo", "R-001", "build round 2");
  const rec = W.get("demo", "R-001")!;
  ok(s.corrected?.from === base && sh(r.path, "git", "rev-parse", "HEAD").out === h1 && !existsSync(join(r.path, "stray.txt")) && readFileSync(join(r.path, "a.txt"), "utf8") === "two\n", "a worktree on a stale head is put back at the durable head before the round starts", JSON.stringify(s.corrected));
  const k = rec.kept.at(-1)!;
  ok(!!k && sh(repo, "git", "show", `${k.ref}:stray.txt`).out === "left over" && rec.history.some((x) => /corrected/.test(x.what)), "nothing is reset without a record: the stray work is kept on a kept ref", JSON.stringify(rec.kept));
  // a timed-out round keeps its partial work: the runtime hands it back as it is
  writeFileSync(join(r.path, "partial.txt"), "half done\n");
  const hb = W.handBack("demo", "R-001", { run: "R-001", node: "build", round: 2, agent: "stub·test", message: "feat: say two (round 2, stopped at the time limit)" });
  ok(hb.committed && sh(r.path, "git", "show", "HEAD:partial.txt").out === "half done", "a round stopped at its time limit keeps its partial work (committed, the next round starts from it)");
  s.release(); }
const h2 = W.get("demo", "R-001")!.head;
// a report-only round keeps the code: what it touched is kept on a kept ref and the code stays at the last hand-back
{ const s = await W.startRound("demo", "R-001", "report-only round 3");
  writeFileSync(join(r.path, "a.txt"), "rewritten by a report-only round\n");
  const kept = W.endRound("demo", "R-001", "report-only round touched files");
  ok(!!kept && sh(r.path, "git", "rev-parse", "HEAD").out === h2 && readFileSync(join(r.path, "a.txt"), "utf8") === "two\n" && /rewritten/.test(sh(repo, "git", "show", `${kept}:a.txt`).out), "a report-only round keeps the code; what it touched is kept on a kept ref", String(kept));
  s.release(); }
// the durable head: the newest of the remote branch's head and the last hand-back
{ const bare = join(tmp, "origin.git"); sh(tmp, "git", "clone", "-q", "--bare", repo, bare); sh(repo, "git", "remote", "add", "origin", bare);
  const other = join(tmp, "other"); sh(tmp, "git", "clone", "-q", bare, other); sh(other, "git", "checkout", "-q", "feature/R-001"); writeFileSync(join(other, "remote.txt"), "pushed elsewhere\n");
  sh(other, "git", "add", "remote.txt"); sh(other, "git", "commit", "-qm", "remote work"); sh(other, "git", "push", "-q", "origin", "feature/R-001");
  const remoteHead = sh(other, "git", "rev-parse", "HEAD").out;
  let s = await W.startRound("demo", "R-001", "build round 4");
  ok(s.head === remoteHead && sh(r.path, "git", "rev-parse", "HEAD").out === remoteHead && existsSync(join(r.path, "remote.txt")), "the remote moved on: the round starts at the remote's head (the local branch was stale)", JSON.stringify(s.corrected));
  // an unpushed hand-back is newer than the remote: it is not stale
  writeFileSync(join(r.path, "local.txt"), "handed back, not pushed\n");
  const hb = W.handBack("demo", "R-001", { run: "R-001", node: "build", round: 4, agent: "stub·test", message: "feat: local work" }); s.release();
  s = await W.startRound("demo", "R-001", "build round 5");
  ok(s.head === hb.head && !s.corrected && existsSync(join(r.path, "local.txt")), "a hand-back not pushed yet is the newest head: the next round starts from it, nothing is parked", JSON.stringify(s.corrected));
  s.release();
  // the remote and the hand-back diverged: the round stops, the lock is free
  writeFileSync(join(other, "other.txt"), "diverged\n"); sh(other, "git", "add", "other.txt"); sh(other, "git", "commit", "-qm", "other work"); sh(other, "git", "push", "-q", "origin", "feature/R-001");
  let d: any = null; try { await W.startRound("demo", "R-001", "build round 6"); } catch (x) { d = x; }
  ok(d instanceof RoundBlocked && /diverged/.test(d.message) && d.outcome === "blocked", "a remote and a hand-back that diverged stop the round (blocked), never a silent pick", d?.message);
  sh(repo, "git", "remote", "set-url", "origin", join(tmp, "no-such-remote.git"));
  let e: any = null; try { await W.startRound("demo", "R-001", "build round 7"); } catch (x) { e = x; }
  sh(repo, "git", "remote", "remove", "origin");
  const again = await W.startRound("demo", "R-001", "build round 8"); again.release();
  ok(e instanceof RoundBlocked && /cannot read the remote head/.test(e.message) && again.head === hb.head, "a remote that cannot be read stops the round before the agent starts (never read as \"no remote branch\"), and the lock is released", e?.message); }
// lifecycle scripts run only when policy grants them, and then in the round sandbox
{ const s = await W.startRound("demo", "R-001", "build round 9", { scripts: true }).catch((x) => x);
  const ranInTree = existsSync(join(r.path, "ran-in-tree.txt"));
  ok(ranInTree && !existsSync(escapee) && s?.deps?.ran?.join(" ") === "bun install --frozen-lockfile", "with install scripts granted, the script runs, in the round sandbox: its write inside the worktree lands, its write outside is refused", JSON.stringify([ranInTree, existsSync(escapee), s?.message ?? s?.deps?.ran]));
  if (s?.release) { W.thaw(W.get("demo", "R-001")!); (await import("node:fs")).rmSync(join(r.path, "ran-in-tree.txt"), { force: true }); s.release(); } }
// a stale lock is taken over, with a record
{ writeFileSync(join(data, "work", "wt", "demo", "R-001.lock"), JSON.stringify({ holder: "a round of an old Studio", pid: 999999, at: "2026-10-01T00:00:00Z" }));
  const s = await W.startRound("demo", "R-001", "build round 10"); s.release();
  ok(W.get("demo", "R-001")!.history.some((h) => /stale lock of a round of an old Studio \(pid 999999, gone\) taken over by build round 10/.test(h.what)), "a lock whose holder is gone is taken over by the next round, with a record"); }

// cleanup after merge leaves nothing behind: no worktree, no lock, no git worktree entry
{ const r2 = W.ensure({ project: "demo", task: "R-002", repo, base: "main", branchPrefix: "feature/", run: "R-002" });
  const s = await W.startRound("demo", "R-002", "build"); s.release();
  W.remove("demo", "R-002", "merged");
  ok(!existsSync(r2.path) && !existsSync(join(data, "work", "wt", "demo", "R-002.lock")) && !sh(repo, "git", "worktree", "list").out.includes("R-002") && !!W.get("demo", "R-002")!.removedAt, "cleanup after a merge leaves no worktree, no lock and no git worktree entry", sh(repo, "git", "worktree", "list").out); }
// kept refs stay keep_days days
{ const r3 = W.ensure({ project: "demo", task: "R-010", repo, base: "main", branchPrefix: "feature/", run: "R-010" });
  W.thaw(r3); writeFileSync(join(r3.path, "x.txt"), "old\n"); const oldRef = W.keep(W.get("demo", "R-010")!, "old work");
  writeFileSync(join(r3.path, "y.txt"), "fresh\n"); const freshRef = W.keep(W.get("demo", "R-010")!, "fresh work");
  const f = join(data, "work", "wt", "demo", "R-010.json"); const rec = JSON.parse(readFileSync(f, "utf8")); rec.kept[0].at = new Date(Date.now() - 8 * 86400_000).toISOString(); writeFileSync(f, JSON.stringify(rec));
  W.remove("demo", "R-010", "cancelled", 7);
  ok(!sh(repo, "git", "rev-parse", "--verify", "-q", oldRef).ok && sh(repo, "git", "rev-parse", "--verify", "-q", freshRef).ok && !existsSync(r3.path), "cleanup (here after a cancel) removes kept refs older than keep_days and keeps the fresh ones", JSON.stringify(W.get("demo", "R-010")!.kept)); }

// the startup sweep: a live run's worktree survives; a dead run's goes (its work kept); a stale lock goes; each with its reason
{ const live = W.ensure({ project: "demo", task: "R-003", repo, base: "main", branchPrefix: "feature/", run: "R-003" });
  const dead = W.ensure({ project: "demo", task: "R-004", repo, base: "main", branchPrefix: "feature/", run: "R-004" });
  W.thaw(dead); writeFileSync(join(dead.path, "unsaved.txt"), "orphan work\n");
  writeFileSync(join(data, "work", "wt", "demo", "R-003.lock"), JSON.stringify({ holder: "a round of an old Studio", pid: 999999, at: "2026-10-01T00:00:00Z" }));
  // what is not Studio's worktree data: another unit's work folder and JSON beside the namespace, an unmarked folder and file inside it
  mkdirSync(join(data, "work", "W-123", "assets"), { recursive: true }); writeFileSync(join(data, "work", "W-123", "data.json"), JSON.stringify({ id: "W-123" }));
  mkdirSync(join(data, "work", "wt", "demo", "R-999")); writeFileSync(join(data, "work", "wt", "demo", "notes.json"), JSON.stringify({ project: "demo", task: "notes" }));
  // temporary trees: one marked for a dead run, one marked for the live run, one unmarked
  const tDead = W.tmpOf("R-004", "base"); mkdirSync(tDead, { recursive: true }); const tLive = W.tmpOf("R-003", "base"); mkdirSync(tLive, { recursive: true });
  mkdirSync(join(data, "work", "wt", ".tmp", "R-004-strange"), { recursive: true });
  const sw = W.sweep((run) => run === "R-003" || run === "R-001");
  const log = readFileSync(join(data, "work", "wt", "sweep.log"), "utf8");
  ok(existsSync(live.path) && existsSync(r.path), "a live run's worktree survives the startup sweep");
  ok(!existsSync(dead.path) && sw.removed.includes("demo/R-004") && /R-004 removed: run R-004 is not live/.test(log) && sh(repo, "git", "show", `${W.get("demo", "R-004")!.kept.at(-1)!.ref}:unsaved.txt`).out === "orphan work", "a worktree no live run owns is swept, its work kept on a kept ref, with the reason logged", JSON.stringify(sw));
  ok(!existsSync(join(data, "work", "wt", "demo", "R-003.lock")) && /stale lock of demo\/R-003 removed/.test(log), "a stale lock (its holder is gone) is swept with its reason");
  ok(existsSync(join(data, "work", "W-123", "assets")) && existsSync(join(data, "work", "W-123", "data.json")) && existsSync(join(data, "work", "wt", "demo", "R-999")) && existsSync(join(data, "work", "wt", "demo", "notes.json"))
    && sw.foreign.includes("demo/R-999") && sw.foreign.includes("demo/notes.json") && /foreign entry demo\/R-999 left alone/.test(log), "the sweep owns only marked entries: other units' folders and unmarked entries are reported and left alone, and a foreign JSON does not stop it", JSON.stringify(sw.foreign));
  ok(!existsSync(tDead) && existsSync(tLive) && existsSync(join(data, "work", "wt", ".tmp", "R-004-strange")) && /temporary tree .tmp\/R-004-base removed/.test(log) && /foreign entry .tmp\/R-004-strange left alone/.test(log),
    "a marked temporary tree of a dead run is swept; a live run's stays; an unmarked one is left alone"); }

// never inside a protected root, never inside the target repository
{ mkdirSync(join(tmp, "protected"), { recursive: true });
  const P = new Worktrees(join(tmp, "protected", "data"), {});
  const Q = new Worktrees(join(tmp, "protected", "data"), { protect: () => [join(tmp, "protected")] });
  let e1 = ""; try { Q.ensure({ project: "demo", task: "R-005", repo, base: "main", branchPrefix: "feature/" }); } catch (x: any) { e1 = x.message; }
  const inRepo = new Worktrees(join(repo, ".crew-data"), {});
  let e2 = ""; try { inRepo.ensure({ project: "demo", task: "R-006", repo, base: "main", branchPrefix: "feature/" }); } catch (x: any) { e2 = x.message; }
  ok(/protected root/.test(e1) && !existsSync(Q.pathOf("demo", "R-005")) && /never inside the target repository/.test(e2), "a worktree is never made inside a protected root or inside the target repository", `${e1} | ${e2}`); void P; }

// the runtime calls a mode's begin before its agent starts, and its end however the round ends (done, timeout, failure)
{ const { harness, until, Y } = await import("./rt-harness");
  const roles = [{ id: "w", label: "W", skill: "x" }];
  const flow = (id: string, node: any) => Y({ id, name: id, roles, nodes: [{ id: "a", kind: "agent", label: "A", role: "w", mode: "hooked", ...node, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["a", "e"]] });
  const H = await harness([flow("hk-done", { args: {} }), flow("hk-timeout", { timeout_s: 1, args: { say: "STUB_HANG" } }), flow("hk-failed", { args: {} }), flow("hk-cancel", { args: { say: "STUB_SLOW" } }),
    flow("hk-throw", { args: {} }), flow("hk-endthrows", { args: {} }),
    Y({ id: "hk-blocked", name: "hk-blocked", roles, nodes: [{ id: "a", kind: "agent", label: "A", role: "w", mode: "hooked", args: {}, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }, { id: "stopped", kind: "hook", label: "Stopped", args: { result: "blocked" }, x: 1, y: 1 }],
      edges: [["a", "e", "ok"], ["a", "stopped", "blocked"]] })]);
  const calls: string[] = [];
  H.engine.modes.hooked = { ...H.engine.modes.test, begin: (x: any) => { calls.push(`begin:${x.run.workflow}`); if (x.run.workflow === "hk-throw") throw new Error("begin cannot take the worktree"); if (x.run.workflow === "hk-blocked") throw new RoundBlocked("the remote cannot be read"); },
    end: (x: any, how: string) => { calls.push(`end:${x.run.workflow}:${how}`); if (x.run.workflow === "hk-endthrows") throw new Error("end failed"); },
    after: (x: any) => { if (x.run.workflow === "hk-failed") throw new Error("the round's work does not hold"); return "ok"; } };
  const fin = (id: string) => until(() => ["succeeded", "failed", "cancelled"].includes(H.engine.get(id)!.status), 20000);
  const a = H.engine.start({ workflow: "hk-done", text: "x" }); await fin(a.id);
  const b = H.engine.start({ workflow: "hk-timeout", text: "x" }); await until(() => calls.includes("end:hk-timeout:timeout"), 20000);
  const c = H.engine.start({ workflow: "hk-failed", text: "x" }); await fin(c.id);
  const d = H.engine.start({ workflow: "hk-cancel", text: "x" }); await until(() => calls.includes("begin:hk-cancel"), 10000); await new Promise((res) => setTimeout(res, 300)); H.engine.cancel(d.id, "captain"); await until(() => calls.includes("end:hk-cancel:cancelled"), 20000);
  const e = H.engine.start({ workflow: "hk-throw", text: "x" }); await fin(e.id);
  const f = H.engine.start({ workflow: "hk-endthrows", text: "x" }); await fin(f.id);
  const g = H.engine.start({ workflow: "hk-blocked", text: "x" }); await fin(g.id);
  ok(H.engine.get(g.id)!.status === "succeeded" && H.engine.get(g.id)!.result === "blocked" && H.engine.events(g.id).some((ev: any) => ev.type === "round_blocked") && !calls.some((c) => c.startsWith("end:hk-blocked")),
    "a begin that stops the round with an outcome (blocked) routes it like any outcome: the blocked edge is taken, a round_blocked event says why, and there is no round to end", JSON.stringify([H.engine.get(g.id)!.status, H.engine.get(g.id)!.result, H.engine.get(g.id)!.error]));
  ok(calls.indexOf("begin:hk-done") < calls.indexOf("end:hk-done:done") && calls.includes("end:hk-timeout:timeout") && calls.includes("end:hk-failed:failed") && calls.includes("end:hk-cancel:cancelled"),
    "the runtime calls a mode's begin before the agent and its end however the round ends: done, timeout, failed, cancelled", JSON.stringify(calls));
  ok(H.engine.get(e.id)!.status === "failed" && /begin cannot take the worktree/.test(H.engine.get(e.id)!.error ?? "") && !calls.includes("end:hk-throw:failed"), "a begin that throws fails the attempt; there is no round to end", H.engine.get(e.id)!.error ?? "");
  ok(H.engine.get(f.id)!.status === "succeeded" && calls.includes("end:hk-endthrows:done"), "an end that throws is logged and does not undo the round's result");
  H.stop(); }

// worktrees an older Studio wrote in the old layout (data/work/<project>/<task>, no kind, no marker) move into data/work/wt at start
{ const d3 = join(tmp, "old-data"); mkdirSync(join(d3, "work", "demo"), { recursive: true });
  const oldWt = (task: string, run: string) => { const path = join(d3, "work", "demo", task); const branch = `feature/${task.toLowerCase()}`;
    sh(repo, "git", "worktree", "add", "-q", "-b", branch, path, "main"); const head = sh(path, "git", "rev-parse", "HEAD").out;
    writeFileSync(join(d3, "work", "demo", `${task}.json`), JSON.stringify({ project: "demo", task, repo, base: "main", baseCommit: head, branch, path, head, run, kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null }));
    return { path, branch, head }; };
  const live = oldWt("R-060", "R-060"), dead = oldWt("R-061", "R-061");
  writeFileSync(join(live.path, "unsaved.txt"), "work in flight\n");
  writeFileSync(join(d3, "work", "demo", "R-060.lock"), JSON.stringify({ holder: "an old round", pid: 999999, at: "2026-10-14T00:00:00Z" }));
  const W3 = new Worktrees(d3, {}); const moved = W3.migrate();
  const rec = W3.get("demo", "R-060")!;
  ok(moved.includes("demo/R-060") && moved.includes("demo/R-061") && rec?.path === join(d3, "work", "wt", "demo", "R-060") && rec.branch === "feature/r-060" && existsSync(rec.path) && !existsSync(live.path)
    && sh(rec.path, "git", "symbolic-ref", "--short", "HEAD").out === "feature/r-060" && sh(repo, "git", "show", `${rec.kept.at(-1)!.ref}:unsaved.txt`).out === "work in flight", "an old-layout worktree moves into data/work/wt with its branch (name kept as it was) and head; its uncommitted work is kept on a kept ref first", JSON.stringify(rec));
  const s = await W3.startRound("demo", "R-060", "build after the move"); s.release();
  const sw = W3.sweep((run) => run === "R-060");
  ok(s.head === live.head && existsSync(rec.path) && !existsSync(W3.get("demo", "R-061")!.path) && sw.removed.includes("demo/R-061") && !sw.foreign.length, "after the move, the live run's next round starts there; the dead run's is swept, nothing is left as foreign", JSON.stringify(sw)); }

// one record's failure during the migration is logged and parked (record, lock, folder), and the records after it still migrate
{ const d4 = join(tmp, "old-fail"); mkdirSync(join(d4, "work", "demo"), { recursive: true });
  const oldWt = (task: string) => { const path = join(d4, "work", "demo", task); const branch = `feature/f-${task.toLowerCase()}`;
    sh(repo, "git", "worktree", "add", "-q", "-b", branch, path, "main"); const head = sh(path, "git", "rev-parse", "HEAD").out;
    writeFileSync(join(d4, "work", "demo", `${task}.json`), JSON.stringify({ project: "demo", task, repo, base: "main", baseCommit: head, branch, path, head, run: task, kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null })); };
  oldWt("R-070"); oldWt("R-071"); oldWt("R-072");
  writeFileSync(join(d4, "work", "demo", "R-071.lock"), JSON.stringify({ holder: "an old round", pid: 999999, at: "2026-10-14T00:00:00Z" }));
  const W4 = new Worktrees(d4, {}); const save = (W4 as any).save.bind(W4);
  (W4 as any).save = (r: any) => { if (r.task === "R-071") throw new Error("disk full (injected)"); return save(r); };
  let threw = ""; let moved: string[] = []; try { moved = W4.migrate(); } catch (e: any) { threw = e.message; }
  const log = existsSync(join(d4, "work", "wt", "sweep.log")) ? readFileSync(join(d4, "work", "wt", "sweep.log"), "utf8") : "";
  const qd = join(d4, "work", "wt", ".quarantine"); const q = existsSync(qd) ? (await import("node:fs")).readdirSync(qd) : []; const q71 = q.find((x) => x.includes("-demo-R-071-"));
  ok(!threw && moved.includes("demo/R-070") && moved.includes("demo/R-072") && !moved.includes("demo/R-071") && !!W4.get("demo", "R-072"),
    "one record's failure never stops the others: the records after it still migrate", `${threw} ${JSON.stringify(moved)}`);
  ok(!!q71 && existsSync(join(qd, q71, "R-071.json")) && existsSync(join(qd, q71, "R-071.lock")) && existsSync(join(qd, q71, "folder", ".git"))
    && !existsSync(join(d4, "work", "demo", "R-071.json")) && !existsSync(join(d4, "work", "wt", "demo", "R-071")) && !existsSync(join(d4, "work", "wt", "demo", "R-071.json")) && !existsSync(join(d4, "work", "wt", "demo", "R-071.marker"))
    && /R-071\.json parked in .* with its folder .*R-071: its migration failed: disk full \(injected\)/.test(log),
    "the failing record is logged and parked with its lock and its folder (wherever the move left it); nothing of it stays in the new place or outside every sweep", `${JSON.stringify(q)} ${log}`); }

// two parks of the same stem from different projects in the same millisecond get folders of their own, even when the random suffix repeats
{ const d5 = join(tmp, "old-twin"); for (const pj of ["alpha", "beta"]) { mkdirSync(join(d5, "work", pj, "R-1"), { recursive: true }); writeFileSync(join(d5, "work", pj, "R-1", "mine.txt"), pj);
    writeFileSync(join(d5, "work", pj, "R-1.json"), JSON.stringify({ project: "other", task: "R-1", repo, base: "main", branch: "feature/x", path: join(d5, "work", pj, "R-1"), head: "", run: "R-1", kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null })); }
  const iso = Date.prototype.toISOString, rnd = Math.random; let n = 0;
  Date.prototype.toISOString = function () { return "2026-10-14T09:00:00.000Z"; }; Math.random = () => (n++ < 3 ? 0.123456789 : rnd());
  // a park already sitting at the first name the next park would try: never renamed onto
  const qd = join(d5, "work", "wt", ".quarantine"); const taken = join(qd, `2026-10-14T09-00-00-000Z-beta-R-1-${(0.123456789).toString(36).slice(2, 8)}`); mkdirSync(taken, { recursive: true }); writeFileSync(join(taken, "keep.txt"), "an earlier park");
  let threw = ""; try { new Worktrees(d5, {}).migrate(); } catch (e: any) { threw = e.message; } finally { Date.prototype.toISOString = iso; Math.random = rnd; }
  const { readdirSync: rd } = await import("node:fs"); const q = rd(qd); const own = (pj: string) => q.filter((x) => x.startsWith(`2026-10-14T09-00-00-000Z-${pj}-R-1-`) && existsSync(join(qd, x, "R-1.json")));
  ok(!threw && own("alpha").length === 1 && own("beta").length === 1 && readFileSync(join(qd, own("alpha")[0], "folder", "mine.txt"), "utf8") === "alpha" && readFileSync(join(qd, own("beta")[0], "folder", "mine.txt"), "utf8") === "beta"
    && readFileSync(join(taken, "keep.txt"), "utf8") === "an earlier park" && !existsSync(join(taken, "R-1.json")),
    "two parks of the same stem from different projects in the same millisecond each get a folder of their own (ISO-ms, project, stem, random); a name already taken is never renamed onto, a new suffix is tried", `${threw} ${JSON.stringify(q)}`); }

// Studio sweeps at its start: a worktree whose run is not live goes, with its reason
{ const { spawn } = await import("node:child_process");
  const d2 = join(tmp, "boot-data"); mkdirSync(d2);
  const W2 = new Worktrees(d2, {}); const gone = W2.ensure({ project: "demo", task: "R-777", repo, base: "main", branchPrefix: "feature/", run: "R-777" });
  for (const x of ["state", "home", "proj"]) mkdirSync(join(tmp, `boot-${x}`));
  // the old layout, as an earlier Studio left it: a worktree with work in it and a lock; a record whose ids the old rewrite folded
  // into its folder name; and entries that are not worktree records at all
  const od = join(d2, "work", "demo"); mkdirSync(od, { recursive: true });
  const oldPath = join(od, "R-090"); sh(repo, "git", "worktree", "add", "-q", "-b", "feature/r-090", oldPath, "main"); writeFileSync(join(oldPath, "wip.txt"), "in flight\n");
  const oldHead = sh(oldPath, "git", "rev-parse", "HEAD").out;
  writeFileSync(join(od, "R-090.json"), JSON.stringify({ project: "demo", task: "R-090", repo, base: "main", baseCommit: oldHead, branch: "feature/r-090", path: oldPath, head: oldHead, run: "R-090", kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null }));
  writeFileSync(join(od, "R-090.lock"), JSON.stringify({ holder: "an old round", pid: 999999, at: "2026-10-14T00:00:00Z" }));
  writeFileSync(join(od, "R-091.json"), JSON.stringify({ project: "demo", task: "R/091", repo, base: "main", baseCommit: oldHead, branch: "feature/r-091", path: join(od, "R-091"), head: oldHead, run: "R-091", kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null }));
  mkdirSync(join(od, "r-093")); writeFileSync(join(od, "r-093", "left.txt"), "x");
  writeFileSync(join(od, "r-093.json"), JSON.stringify({ project: "demo", task: "R-093", repo, base: "main", baseCommit: oldHead, branch: "feature/r-093", path: join(od, "r-093"), head: oldHead, run: "R-093", kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null }));
  mkdirSync(join(d2, "work", "W-555", "assets"), { recursive: true }); writeFileSync(join(d2, "work", "W-555", "data.json"), JSON.stringify({ id: "W-555", path: "x" }));
  const rec0 = (task: string, path: string, extra: any = {}) => JSON.stringify({ project: "demo", task, repo, base: "main", baseCommit: oldHead, branch: `feature/${task}`, path, head: oldHead, run: task, kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null, ...extra });
  // a record whose path is another unit's folder (with ..): parked, that folder never opened
  writeFileSync(join(od, "R-095.json"), rec0("R-095", join(od, "..", "W-555")));
  // a record whose repo is gone while its folder exists: parked with its folder (nothing left outside every sweep)
  mkdirSync(join(od, "R-096")); writeFileSync(join(od, "R-096", "left.txt"), "x"); writeFileSync(join(od, "R-096.json"), rec0("R-096", join(od, "R-096"), { repo: join(tmp, "no-such-repo") }));
  // a record whose ids cannot name a folder, with a real worktree: parked, the worktree not moved; it sorts before "demo", and the others still migrate
  const sd = join(d2, "work", "_scratch"); mkdirSync(sd, { recursive: true }); sh(repo, "git", "worktree", "add", "-q", "-b", "feature/scratch-r1", join(sd, "R-1"), "main");
  writeFileSync(join(sd, "R-1.json"), JSON.stringify({ project: "_scratch", task: "R-1", repo, base: "main", baseCommit: oldHead, branch: "feature/scratch-r1", path: join(sd, "R-1"), head: oldHead, run: "R-1", kept: [], history: [], createdAt: "2026-10-14T00:00:00Z", removedAt: null }));
  // a record that would be a case twin of a worktree already in data/work/wt
  W2.ensure({ project: "demo", task: "R-094", repo, base: "main", branchPrefix: "feature/", run: "R-094" }); writeFileSync(join(od, "r-094.json"), rec0("r-094", join(od, "r-094")));
  writeFileSync(join(od, "notes.json"), JSON.stringify({ project: "demo", task: "notes" }));
  const port = await freePort();
  const app = spawn("bun", ["src/server.ts"], { cwd: join(import.meta.dir, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CREW_DATA: d2, CREW_PORT: String(port), CREW_FM_STATE: join(tmp, "boot-state"), CREW_GH: "0", CREW_READONLY: "1", CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_SANDBOX: "0", HOME: join(tmp, "boot-home"), CREW_MAIN_PROJECT: join(tmp, "boot-proj"), CREW_FILE_ALLOW: tmp } });
  await waitUp(`http://127.0.0.1:${port}`, app);
  app.kill();
  const log = existsSync(join(d2, "work", "wt", "sweep.log")) ? readFileSync(join(d2, "work", "wt", "sweep.log"), "utf8") : "";
  ok(!existsSync(gone.path) && /R-777 removed: run R-777 is not live/.test(log), "Studio's start sweeps a worktree whose run is not live, and logs why");
  const at = (re: RegExp) => log.split("\n").findIndex((l) => re.test(l));
  ok(at(/R-090 migrated into data\/work\/wt/) >= 0 && at(/R-090 migrated/) < at(/worktree demo\/R-090 removed/) && at(/stale lock of demo\/R-090 removed/) > at(/R-090: its lock moved/),
    "at Studio's start the old-layout worktree migrates before the sweep runs (the sweep then finds it, and its lock, in the new place)", log.slice(0, 600));
  ok(at(/R-090: its uncommitted work kept on refs\/crew\/kept/) >= 0 && at(/R-090: moved .* -> /) >= 0 && at(/R-090: its lock moved/) >= 0 && !existsSync(oldPath) && !existsSync(join(od, "R-090.lock")) && !existsSync(join(od, "R-090.json")),
    "each step of the migration is logged: work kept, worktree moved, lock moved", log.slice(0, 600));
  ok(existsSync(join(d2, "work", "W-555", "data.json")) && existsSync(join(d2, "work", "W-555", "assets")) && existsSync(join(od, "notes.json")), "entries that are not old-layout worktree records are never touched");
  const q: string[] = existsSync(join(d2, "work", "wt", ".quarantine")) ? (await import("node:fs")).readdirSync(join(d2, "work", "wt", ".quarantine")) : [];
  ok(!existsSync(join(od, "R-091.json")) && q.some((x) => x.includes("-demo-R-091-")) && /R-091\.json parked in .*: its ids \(demo\/R\/091\) cannot name a worktree folder/.test(log), "a record whose ids the old rewrite folded into its folder name is parked in a quarantine folder with a log line, never dropped", JSON.stringify(q));
  ok(!existsSync(join(od, "r-093.json")) && !existsSync(join(d2, "work", "wt", "demo", "R-093.json")) && /r-093\.json parked in .*: its ids \(demo\/R-093\) are not its folder's/.test(log), "a record whose ids are not its folder's is parked, not migrated under other ids");
  ok(/R-095\.json parked in .*: its path .* is not its own old-layout folder/.test(log) && existsSync(join(d2, "work", "W-555", "data.json")) && existsSync(join(d2, "work", "W-555", "assets")), "a record whose path points elsewhere (another unit's folder, ..) is parked and that folder is never opened");
  const q96 = q.find((x) => x.includes("-demo-R-096-"));
  ok(!existsSync(join(od, "R-096")) && !!q96 && existsSync(join(d2, "work", "wt", ".quarantine", q96, "folder", "left.txt")) && /R-096\.json parked in .* with its folder .*R-096: its repo .* is gone/.test(log), "a record whose repo is gone is parked with its folder: nothing is left outside every sweep");
  const q1 = q.find((x) => x.includes("-_scratch-R-1-"));
  ok(!existsSync(join(sd, "R-1")) && !!q1 && existsSync(join(d2, "work", "wt", ".quarantine", q1, "folder", ".git")) && /R-1\.json parked in .* with its folder .*_scratch\/R-1: its ids \(_scratch\/R-1\) cannot name a worktree folder/.test(log) && /R-090 migrated/.test(log),
    "a record whose ids cannot name a folder is parked with its folder (named in the log line), and the other records still migrate", JSON.stringify(q));
  const q93 = q.find((x) => x.includes("-demo-r-093-")), q95 = q.find((x) => x.includes("-demo-R-095-"));
  ok(!existsSync(join(od, "r-093")) && !!q93 && existsSync(join(d2, "work", "wt", ".quarantine", q93, "folder", "left.txt")) && /r-093\.json parked in .* with its folder /.test(log) && !!q95 && !existsSync(join(d2, "work", "wt", ".quarantine", q95, "folder")),
    "every park takes the record's own sibling folder with it when there is one (ids not its folder's), and none when there is none: nothing is left outside every sweep", JSON.stringify(q));
  ok(!existsSync(join(od, "r-094.json")) && /r-094\.json parked in .*differs only by case/.test(log), "a migrated record never creates a case twin: it is parked"); }

console.log(`\nworktrees: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
