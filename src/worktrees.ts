// One worktree per task (architecture §10; borrowed from v1 bin/fm-worker.sh: the
// durable head, kept work, `ls-remote --exit-code`). A task's worktree lives in
// Studio's data, in a namespace of its own, never in the target repository's folder
// or a protected root:
//   data/work/wt/<project>/<task>/            the worktree (on the task's branch, branch_prefix + task)
//   data/work/wt/<project>/<task>.json        its record (kind "crew-worktree"): repo, branch, the durable head, kept refs, history
//   data/work/wt/<project>/<task>.marker      the mark that Studio made this worktree (nothing unmarked is ever touched)
//   data/work/wt/<project>/<task>.lock        who holds it now (one round at a time)
//   data/work/wt/.tmp/<run>-<what>/ (+ .marker) a run's temporary trees (fail-first's base, main)
//   data/work/wt/sweep.log                    what the startup sweep removed or left alone, and why
// Other units keep their own folders under data/work; this module never reads or touches them.
// Rules:
// - each round starts at the branch's durable head, checked before the agent starts:
//   the newest of the remote branch's head and the head recorded at the last hand-back
//   (an unpushed hand-back is not stale); a remote that cannot be read, or a remote and
//   a hand-back that diverged, stops the round (never a silent fallback); a worktree that
//   drifted is put back, and what it held is kept on a kept ref, never reset silently;
// - dependencies are installed before the agent starts (bun install --frozen-lockfile
//   --ignore-scripts, or the project's `install` policy), in the round sandbox: lifecycle
//   scripts only when policy grants them (`install_scripts`), and then sandboxed too;
// - a round hands back by a commit as the agent, with run, node and round trailers;
//   the checks then run on that commit; work a round leaves behind (a timeout, an
//   error, a report-only round that touched files) is kept on a kept ref with a record;
// - between rounds the worktree is read-only; only the next round of the same task
//   opens it again;
// - after a merge or a cancel the worktree goes; kept refs stay `keep_days` days;
// - at start, worktrees and locks no live run owns are swept, each with its reason.
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { addPaths, changedPaths, git, gitArgv, gitEnv, must } from "./git";
import { realInside, realOf } from "./secure";
import { roundExec } from "./runtime/checks";

export type Egress = { port: number; open(t: string, h: string[]): void; close(t: string): void };

export type WorktreeRecord = {
  kind: "crew-worktree"; project: string; task: string; repo: string; base: string; baseCommit: string; branch: string; path: string;
  /** the durable head: what the next round starts from when the repo has no remote branch */
  nativeRebase?: { version: 1; from: string; base: string; target: string };
  head: string; run: string | null;
  kept: { ref: string; head: string; reason: string; at: string }[];
  history: { at: string; what: string }[];
  createdAt: string; removedAt: string | null;
};
export type RoundStart = { head: string; corrected: { from: string; kept: string | null; reason: string } | null; deps: { ran: string[] | null; ok: boolean; detail: string } };

const now = () => new Date().toISOString();
/** An id that names a folder or a branch: refused, never rewritten, unless it is one safe segment (no ".", "..", "/", no collisions). */
export function idOk(s: string) { return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(s) && !s.includes(".."); }
const safe = (s: string) => { const v = String(s); if (!idOk(v)) throw new Error(`"${v}" cannot name a worktree folder or branch: use letters, digits, ".", "_" and "-" (one segment, no "..")`); return v; };
/** A round is stopped before its agent starts, with a reason the workflow can route (e.g. to a card). */
export class RoundBlocked extends Error { outcome = "blocked"; constructor(m: string) { super(m); } }
const alive = (pid: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; } };

export class Worktrees {
  readonly root: string;
  constructor(readonly dataDir: string, readonly o: { protect?: () => string[]; egress?: () => Egress | null } = {}) { this.root = join(dataDir, "work", "wt"); mkdirSync(this.root, { recursive: true }); }
  private markFile(project: string, task: string) { return join(this.dir(project), `${safe(task)}.marker`); }
  private log(what: string) { try { appendFileSync(join(this.root, "sweep.log"), JSON.stringify({ at: now(), what }) + "\n"); } catch {} }
  private dir(project: string) { return join(this.root, safe(project)); }
  pathOf(project: string, task: string) { return join(this.dir(project), safe(task)); }
  private recFile(project: string, task: string) { return join(this.dir(project), `${safe(task)}.json`); }
  private lockFile(project: string, task: string) { return join(this.dir(project), `${safe(task)}.lock`); }
  get(project: string, task: string): WorktreeRecord | null { try { const r = JSON.parse(readFileSync(this.recFile(project, task), "utf8")); return this.owned(r) ? r : null; } catch { return null; } }
  /** a record this module wrote: its kind, its fields, its marker, and its path where it says */
  private owned(r: any): r is WorktreeRecord {
    return !!r && r.kind === "crew-worktree" && typeof r.project === "string" && typeof r.task === "string" && idOk(r.project) && idOk(r.task) && Array.isArray(r.kept)
      && r.path === join(this.root, r.project, r.task) && existsSync(join(this.root, r.project, `${r.task}.marker`));
  }
  private save(r: WorktreeRecord) { mkdirSync(this.dir(r.project), { recursive: true }); writeFileSync(this.recFile(r.project, r.task), JSON.stringify(r, null, 1)); }
  private note(r: WorktreeRecord, what: string) { r.history = [...r.history, { at: now(), what }].slice(-200); }
  all(): WorktreeRecord[] {
    const out: WorktreeRecord[] = [];
    for (const p of existsSync(this.root) ? readdirSync(this.root) : []) { const d = join(this.root, p); if (p.startsWith(".") || !idOk(p) || !statSync(d).isDirectory()) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".json"))) { try { const r = JSON.parse(readFileSync(join(d, f), "utf8")); if (this.owned(r)) out.push(r); } catch {} } }
    return out;
  }

  /** Where a task's worktree may live: under data/work, never inside the target repository or a protected root. */
  private assertPlace(path: string, repo: string) {
    if (!realInside(this.root, path)) throw new Error(`a worktree lives under ${this.root}, not at ${path}`);
    if (realInside(repo, path, true)) throw new Error("a worktree is never inside the target repository's folder");
    for (const r of this.o.protect?.() ?? []) if (realInside(r, path, true) || realInside(path, r, true)) throw new Error(`a worktree is never inside a protected root (${r})`);
  }

  /** The task's worktree: made once (on branch_prefix + task, from base), then kept until merge or cancel. */
  /** On a case-insensitive file system two ids that differ only by case share a folder: refuse the second. */
  private assertNoCaseTwin(dir: string, name: string) {
    if (!existsSync(dir)) return;
    const twin = readdirSync(dir).find((x) => x.replace(/\.(json|marker|lock)$/, "") !== name && x.replace(/\.(json|marker|lock)$/, "").toLowerCase() === name.toLowerCase());
    if (twin) throw new Error(`"${name}" differs only by case from "${twin.replace(/\.(json|marker|lock)$/, "")}", which already has a worktree: ids that differ only by case would share a folder`);
  }
  ensure(a: { project: string; task: string; repo: string; base: string; branchPrefix: string; run?: string | null }): WorktreeRecord {
    const path = this.pathOf(a.project, a.task); this.assertPlace(path, a.repo);
    this.assertNoCaseTwin(this.root, safe(a.project)); this.assertNoCaseTwin(this.dir(a.project), safe(a.task));
    let r = this.get(a.project, a.task);
    if (r && !r.removedAt && existsSync(path)) return r;
    const branch = r?.branch ?? `${a.branchPrefix}${safe(a.task)}`;
    const baseCommit = r?.baseCommit ?? must(a.repo, ["rev-parse", `${a.base}^{commit}`]);
    mkdirSync(dirname(path), { recursive: true });
    git(a.repo, ["worktree", "prune"]);
    if (git(a.repo, ["rev-parse", "--verify", `refs/heads/${branch}`]).ok) must(a.repo, ["worktree", "add", "-q", path, branch]);
    else must(a.repo, ["worktree", "add", "-q", "-b", branch, path, baseCommit]);
    const head = must(path, ["rev-parse", "HEAD"]);
    writeFileSync(this.markFile(a.project, a.task), JSON.stringify({ kind: "crew-worktree", path, at: now() }));
    r = { kind: "crew-worktree", project: a.project, task: a.task, repo: a.repo, base: a.base, baseCommit, branch, path, head: r?.head ?? head, run: a.run ?? r?.run ?? null, kept: r?.kept ?? [], history: r?.history ?? [], createdAt: r?.createdAt ?? now(), removedAt: null };
    this.note(r, `worktree at ${path} on ${branch} (${head.slice(0, 8)})`); this.save(r);
    this.freeze(r);
    return r;
  }

  // ---------- one round at a time ----------
  /** Take the worktree for one round. A lock whose holder process is gone is stale and is taken over, with a record. */
  lock(project: string, task: string, holder: string): () => void {
    const f = this.lockFile(project, task); mkdirSync(dirname(f), { recursive: true });
    const mine = JSON.stringify({ holder, pid: process.pid, at: now() });
    for (let i = 0; i < 2; i++) {
      try { writeFileSync(f, mine, { flag: "wx" }); return () => { try { if (readFileSync(f, "utf8") === mine) rmSync(f, { force: true }); } catch {} }; }
      catch (e: any) {
        if (e?.code !== "EEXIST") throw e;
        let cur: any = null; try { cur = JSON.parse(readFileSync(f, "utf8")); } catch {}
        if (cur && alive(Number(cur.pid)) && cur.pid !== process.pid) throw new Error(`the worktree of ${task} is taken by ${cur.holder} (pid ${cur.pid})`);
        if (cur && cur.pid === process.pid && this.held.has(`${project}/${task}`)) throw new Error(`the worktree of ${task} is taken by ${cur.holder}`);
        const r = this.get(project, task); if (r) { this.note(r, `stale lock of ${cur?.holder ?? "?"} (pid ${cur?.pid ?? "?"}, gone) taken over by ${holder}`); this.save(r); }
        rmSync(f, { force: true });
      }
    }
    throw new Error(`could not take the worktree of ${task}`);
  }
  private held = new Set<string>();

  /**
   * Start a round: take the lock, put the worktree at the durable head (keeping what
   * it held on a kept ref, with a record), install the dependencies, open it for writing.
   */
  async startRound(project: string, task: string, holder: string, o: { install?: string[] | false | null; scripts?: boolean; allow?: string[]; write?: boolean; skipInstall?: boolean } = {}): Promise<RoundStart & { release: () => void }> {
    const r0 = this.get(project, task); if (!r0 || r0.removedAt || !existsSync(r0.path)) throw new Error(`no worktree for ${task}`);
    const release0 = this.lock(project, task, holder); this.held.add(`${project}/${task}`);
    const r = this.get(project, task)!; // read again: taking the lock may have recorded a stale holder
    const release = () => { this.held.delete(`${project}/${task}`); release0(); };
    try {
      this.thaw(r);
      if (r.nativeRebase) {
        if (r.nativeRebase.version !== 1 || ![r.nativeRebase.from,r.nativeRebase.base,r.nativeRebase.target].every(h=>/^[a-f0-9]{40}$/.test(h)) || must(r.path,["rev-parse","HEAD"]) !== r.head || !existsSync(must(r.path,["rev-parse","--git-path","rebase-merge"]))) throw new RoundBlocked("native rebase evidence/state requires captain recovery");
        if(o.write===false)throw new RoundBlocked("native rebase must finish before review");
        return {head:r.head,corrected:null,deps:{ran:null,ok:true,detail:"native rebase resolution round; dependency install deferred"},release};
      }
      const durable = this.durableHead(r);
      const cur = must(r.path, ["rev-parse", "HEAD"]); const branchNow = git(r.path, ["symbolic-ref", "--short", "HEAD"]).out;
      const dirty = !!changedPaths(r.path).length;
      let corrected: RoundStart["corrected"] = null;
      if (cur !== durable || dirty || branchNow !== r.branch) {
        const why = cur !== durable ? `the worktree was at ${cur.slice(0, 8)}, the branch's durable head is ${durable.slice(0, 8)}` : branchNow !== r.branch ? `the worktree was on ${branchNow || "a detached HEAD"}, not ${r.branch}` : "the worktree had changes no round handed back";
        const kept = cur !== durable || dirty ? this.keep(r, `before round of ${holder}: ${why}`) : null;
        must(r.path, ["checkout", "-q", "-B", r.branch, durable]); must(r.path, ["reset", "-q", "--hard", durable]);
        for (const p of changedPaths(r.path)) rmSync(join(r.path, p), { recursive: true, force: true });
        corrected = { from: cur, kept, reason: why };
        this.note(r, `corrected: ${why}; ${kept ? `kept on ${kept}` : "nothing to keep"}`);
      }
      r.head = durable; this.save(r);
      const deps = o.skipInstall ? { ran: null, ok: true, detail: "dependency installation skipped for source-only analysis" } : await this.installDeps(r, o.install ?? null, { scripts: !!o.scripts, allow: o.allow ?? [] });
      if (o.write === false) this.freeze(r);
      return { head: durable, corrected, deps, release };
    } catch (e) { release(); throw e; }
  }

  /** Captain-authorized local base refresh, only before this task has any work.
   * No startRound reconciliation: dirty/drifted state is refused, never reset.
   * The exact target ref permits recovery after a crash between ref CAS and save.
   */
  refreshPristine(project: string, task: string, holder: string, intent: {repo:string;branch:string;base:string;from:string;target:string}) {
    const release=this.lock(project,task,holder);let thawed:WorktreeRecord|null=null;
    try {
      const r=this.get(project,task);
      if(!r||r.removedAt||r.nativeRebase||realOf(r.repo)!==realOf(intent.repo)||r.branch!==intent.branch||r.base!==intent.base||
        ![intent.from,intent.target].every(h=>/^[a-f0-9]{40}$/.test(h))||
        !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(intent.base)||
        ![intent.from,intent.target].includes(r.head)||![intent.from,intent.target].includes(r.baseCommit)||
        r.head!==r.baseCommit||must(r.path,["symbolic-ref","--short","HEAD"])!==r.branch||
        git(r.repo,["symbolic-ref","--short","HEAD"]).out===r.branch)
        throw new RoundBlocked("local rescope base refresh identity changed");
      const actual=must(r.path,["rev-parse","HEAD"]);
      const index=must(r.path,["write-tree"]);
      const expectedTrees=[must(r.repo,["rev-parse",`${actual}^{tree}`]),...(actual===intent.target&&r.head===intent.from?[must(r.repo,["rev-parse",`${intent.from}^{tree}`])]:[])];
      if(![intent.from,intent.target].includes(actual)||must(r.repo,["rev-parse",`refs/heads/${r.base}`])!==intent.target||
        !expectedTrees.includes(index)||!git(r.path,["diff","--quiet"]).ok||must(r.path,["ls-files","--others","--exclude-standard"])||
        !git(r.repo,["merge-base","--is-ancestor",intent.from,intent.target]).ok)
        throw new RoundBlocked("local rescope requires a clean base-only task and the approved base target");
      this.thaw(r);thawed=r;
      // Verify the base and update the task branch in the same ref transaction.
      const txn=`start\nverify refs/heads/${r.base} ${intent.target}\nupdate refs/heads/${r.branch} ${intent.target} ${actual}\nprepare\ncommit\n`;
      const updated=git(r.repo,["update-ref","--stdin"],txn);if(!updated.ok)throw new RoundBlocked("local rescope base/head CAS failed");
      must(r.path,["read-tree","--reset","-u",intent.target]);
      r.head=intent.target;r.baseCommit=intent.target;this.note(r,`captain rescope refreshed base ${intent.from} -> ${intent.target}`);this.save(r);this.freeze(r);return r;
    } finally {if(thawed)this.freeze(thawed);release();}
  }

  /** Hand back an imported remote head under the existing task lock. */
  acceptHead(project: string, task: string, expected: string, next: string, base: string) {
    if (!this.held.has(`${project}/${task}`)) throw new Error("task lock required for imported head");
    const r = this.get(project,task); if (!r || r.removedAt || r.head !== expected || git(r.repo,["symbolic-ref","--short","HEAD"]).out === r.branch || must(r.path,["rev-parse","HEAD"]) !== expected || changedPaths(r.path).length || git(r.path,["symbolic-ref","--short","HEAD"]).out !== r.branch || ![next,base].every(h=>/^[a-f0-9]{40}$/.test(h))) throw new Error("imported head ownership/CAS changed");
    must(r.path,["update-ref",`refs/heads/${r.branch}`,next,expected]); must(r.path,["read-tree","--reset","-u",next]); r.head=next; r.baseCommit=base; this.save(r); return r;
  }
  /** Native rebase is confined to the locked task. Conflicts stay for fs-only worker rounds. */
  startNativeRebase(project: string, task: string, expected: string, base: string, target: string) {
    if (!this.held.has(`${project}/${task}`)) throw new Error("task lock required for rebase");
    const r=this.get(project,task); if (!r || r.nativeRebase || r.head!==expected || git(r.repo,["symbolic-ref","--short","HEAD"]).out===r.branch || must(r.path,["rev-parse","HEAD"])!==expected || changedPaths(r.path).length || ![base,target].every(h=>/^[a-f0-9]{40}$/.test(h))) throw new Error("native rebase ownership changed");
    if(!git(r.path,["merge-base","--is-ancestor",base,expected]).ok||!git(r.path,["cat-file","-e",`${target}^{commit}`]).ok)throw new Error("native rebase base/target invalid");
    r.nativeRebase={version:1,from:expected,base,target}; this.save(r);
    const out=git(r.path,["-c","core.editor=true","rebase","--onto",target,base]);
    if (!out.ok && !git(r.path,["ls-files","-u"]).out) { git(r.path,["rebase","--abort"]); delete r.nativeRebase; this.save(r); throw new Error("native rebase preparation failed"); }
    r.head=must(r.path,["rev-parse","HEAD"]);r.baseCommit=target;
    if(out.ok)delete r.nativeRebase; this.save(r); return {head:r.head,pending:!out.ok};
  }
  continueNativeRebase(project: string, task: string, scope: (path:string)=>boolean) {
    if (!this.held.has(`${project}/${task}`)) throw new Error("task lock required for rebase continuation");
    const r=this.get(project,task); if(!r?.nativeRebase || r.nativeRebase.version!==1 || must(r.path,["rev-parse","HEAD"])!==r.head)throw new Error("native rebase state changed");
    const paths=changedPaths(r.path);if(paths.some(p=>!scope(p)))throw new Error("rebase resolution outside scope");
    addPaths(r.path,paths);const out=git(r.path,["-c","core.editor=true","rebase","--continue"]);
    if(!out.ok&&!git(r.path,["ls-files","-u"]).out)throw new Error("native rebase continuation failed");
    r.head=must(r.path,["rev-parse","HEAD"]);if(out.ok)delete r.nativeRebase;this.save(r);return {head:r.head,pending:!out.ok};
  }
  /**
   * The head a round starts from: the newest of the remote branch's head and the head
   * recorded at the last hand-back. `ls-remote --exit-code`: 0 the branch is there, 2 it
   * is not; any other answer is an error and stops the round, as do a failed fetch and a
   * remote and a hand-back that diverged.
   */
  durableHead(r: WorktreeRecord): string {
    const remote = git(r.repo, ["remote"]).out.split("\n").filter(Boolean);
    if (!remote.includes("origin")) return r.head;
    const ls = git(r.repo, ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${r.branch}`]);
    const code = ls.ok ? 0 : ls.code ?? -1;
    if (code === 2) return r.head; // no remote branch yet: the hand-back head
    if (code !== 0) throw new RoundBlocked(`cannot read the remote head of ${r.branch}: ${ls.err || `git ls-remote exited ${code}`}`);
    const rh = ls.out.split(/\s+/)[0];
    if (!/^[0-9a-f]{40}$/.test(rh)) throw new RoundBlocked(`the remote answered no head for ${r.branch}`);
    if (!git(r.repo, ["cat-file", "-e", `${rh}^{commit}`]).ok) { const f = git(r.repo, ["fetch", "-q", "origin", `refs/heads/${r.branch}`]); if (!f.ok || !git(r.repo, ["cat-file", "-e", `${rh}^{commit}`]).ok) throw new RoundBlocked(`cannot fetch the remote head of ${r.branch} (${rh.slice(0, 8)}): ${f.err}`); }
    if (rh === r.head || git(r.repo, ["merge-base", "--is-ancestor", rh, r.head]).ok) return r.head;   // the hand-back is newer (not pushed yet): it is not stale
    if (git(r.repo, ["merge-base", "--is-ancestor", r.head, rh]).ok) return rh;                         // the remote moved on
    throw new RoundBlocked(`the remote ${r.branch} (${rh.slice(0, 8)}) and the last hand-back (${r.head.slice(0, 8)}) diverged: decide which work to keep`);
  }

  /**
   * Dependencies before the agent starts: the project's install policy, else bun install
   * --frozen-lockfile --ignore-scripts when the repo has a bun lockfile. It runs in the
   * round sandbox (it writes only the worktree; the network only through the egress
   * proxy, to the hosts policy egress.allow grants): a round may have written the
   * package's lifecycle scripts, so they never run with Studio's authority, and run at
   * all only when policy grants `install_scripts`.
   */
  async installDeps(r: WorktreeRecord, install: string[] | false | null, o: { scripts?: boolean; allow?: string[] } = {}): Promise<RoundStart["deps"]> {
    const res = await this.installIn(r.path, safe(r.task), install, o);
    if (res.ran) { this.note(r, `dependencies: ${res.ran.join(" ")} (in the round sandbox)`); this.save(r); }
    return res;
  }
  /**
   * The same install in any folder the runtime materialized (a round's worktree, the reviewer's fresh copy of a head):
   * the project's install policy, else bun install --frozen-lockfile, in the round sandbox writing only that folder,
   * the network only through the egress proxy to the hosts policy egress.allow grants. Throws when refused or failed.
   */
  async installIn(path: string, label: string, install: string[] | false | null, o: { scripts?: boolean; allow?: string[]; timeoutS?: number } = {}): Promise<RoundStart["deps"]> {
    if (install === false) return { ran: null, ok: true, detail: "dependency installation disabled by project policy" };
    const hasPkg = existsSync(join(path, "package.json"));
    const lock = ["bun.lock", "bun.lockb"].some((f) => existsSync(join(path, f)));
    const argv = install?.length ? install : hasPkg && lock ? ["bun", "install", "--frozen-lockfile", ...(o.scripts ? [] : ["--ignore-scripts"])] : null;
    if (!argv) return { ran: null, ok: true, detail: hasPkg ? "no lockfile and no install policy: nothing to install" : "no package manifest" };
    const tmp = join(this.dataDir, "rounds", `install-${label.replace(/[^\w.-]/g, "_")}-${Date.now().toString(36)}`); mkdirSync(tmp, { recursive: true });
    const res = await roundExec(argv, { cwd: path, writes: [path], tmp, dataDir: this.dataDir, protect: this.o.protect?.() ?? [], timeoutS: o.timeoutS ?? 300, egress: this.o.egress?.() ?? null, hosts: o.allow ?? [] });
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    const detail = (res.stdout + res.stderr).trim().split("\n").slice(-6).join("\n");
    if (res.refused) throw new Error(`installing the dependencies was refused: ${res.refused}`);
    if (res.code !== 0) throw new Error(`installing the dependencies failed (${argv.join(" ")}): ${(res.timedOut ? "timed out" : detail).slice(0, 400)}`);
    return { ran: argv, ok: true, detail };
  }

  /** Hand a round back: commit its work as the agent, with run, node and round trailers. The checks then run on that commit. */
  handBack(project: string, task: string, a: { run: string; node: string; round: number; agent: string; message: string }): { head: string; committed: boolean } {
    const r = this.get(project, task); if (!r) throw new Error(`no worktree for ${task}`);
    const paths = changedPaths(r.path);
    if (paths.length) {
      addPaths(r.path, paths);
      const msg = `${a.message.trim()}\n\nCrew-Run: ${a.run}\nCrew-Node: ${a.node}\nCrew-Round: ${a.round}\nCrew-Agent: ${a.agent}`;
      const res = Bun.spawnSync(gitArgv(["commit", "-q", "-m", msg]), { cwd: r.path, stdout: "pipe", stderr: "pipe",
        env: gitEnv({ GIT_AUTHOR_NAME: `Crew agent (${a.agent})`.slice(0, 120), GIT_AUTHOR_EMAIL: "crew-agent@localhost" }) });
      if (!res.success) throw new Error(`git commit: ${res.stderr.toString().trim().slice(0, 300)}`);
    }
    r.head = must(r.path, ["rev-parse", "HEAD"]);
    this.note(r, `${a.node} round ${a.round} handed back ${paths.length ? `as ${r.head.slice(0, 8)} (${paths.length} paths)` : `with no change (${r.head.slice(0, 8)})`}`);
    this.save(r); this.freeze(r);
    return { head: r.head, committed: !!paths.length };
  }

  /** End a round: whatever it left behind (no hand-back happened) is kept on a kept ref, the worktree goes back to its durable head and read-only. */
  endRound(project: string, task: string, reason: string): string | null {
    const r = this.get(project, task); if (!r || r.removedAt || !existsSync(r.path)) return null;
    this.thaw(r);
    const cur = git(r.path, ["rev-parse", "HEAD"]).out; let kept: string | null = null;
    if (changedPaths(r.path).length || (cur && cur !== r.head)) {
      kept = this.keep(r, reason);
      must(r.path, ["reset", "-q", "--hard", r.head]); for (const p of changedPaths(r.path)) rmSync(join(r.path, p), { recursive: true, force: true });
      this.note(r, `${reason}: its work kept on ${kept}, the worktree back at ${r.head.slice(0, 8)}`); this.save(r);
    }
    this.freeze(r);
    return kept;
  }

  /** Keep the worktree's state (its commits and uncommitted files) on refs/crew/kept/<task>/<n>, with a record. */
  keep(r: WorktreeRecord, reason: string): string {
    const n = r.kept.length + 1; const ref = `refs/crew/kept/${safe(r.task)}/${n}`;
    let commit = must(r.path, ["rev-parse", "HEAD"]);
    const paths = changedPaths(r.path);
    if (paths.length) { // a snapshot commit of the uncommitted files, off the branch (the index is restored after)
      const idx = join(this.dataDir, "git", `index-${safe(r.task)}-${n}`); mkdirSync(dirname(idx), { recursive: true });
      const env = gitEnv({ GIT_INDEX_FILE: idx });
      const run = (args: string[]) => { const x = Bun.spawnSync(gitArgv(args), { cwd: r.path, stdout: "pipe", stderr: "pipe", env }); if (!x.success) throw new Error(`git ${args[0]}: ${x.stderr.toString().trim()}`); return x.stdout.toString().trim(); };
      run(["read-tree", commit]); run(["add", "--all", "--", ...paths.map((p) => `:(literal)${p}`)]);
      const tree = run(["write-tree"]); commit = run(["commit-tree", tree, "-p", commit, "-m", `kept: ${reason}`]);
      rmSync(idx, { force: true });
    }
    must(r.repo, ["update-ref", ref, commit]);
    r.kept = [...r.kept, { ref, head: commit, reason, at: now() }]; this.save(r);
    return ref;
  }

  /** After a merge or a cancel: the worktree, its lock and its temporary trees go; kept refs older than keepDays go too. */
  remove(project: string, task: string, reason: string, keepDays = 7, extra: string[] = []) {
    const r = this.get(project, task); if (!r) return;
    for (const d of [r.path, ...extra]) { if (d && existsSync(d)) { this.thawPath(d); git(r.repo, ["worktree", "remove", "--force", d]); rmSync(d, { recursive: true, force: true }); } if (d !== r.path) rmSync(`${d}.marker`, { force: true }); }
    git(r.repo, ["worktree", "prune"]);
    rmSync(this.lockFile(project, task), { force: true });
    const cutoff = Date.now() - keepDays * 86400_000;
    r.kept = r.kept.filter((k) => { if (Date.parse(k.at) >= cutoff) return true; git(r.repo, ["update-ref", "-d", k.ref]); return false; });
    r.removedAt = now(); this.note(r, `removed: ${reason}`); this.save(r);
  }

  /**
   * A deleted run's worktree goes for good: the folder, its kept refs, its branch and its record.
   * Only the task's own branch is deleted (never the base), and only its ref: a commit already
   * merged into the base stays there.
   */
  purge(project: string, task: string, reason: string, extra: string[] = []) {
    const r = this.get(project, task); if (!r) return null;
    this.remove(project, task, reason, 0, extra);
    const deleted = r.branch && r.branch !== r.base && !/^(main|master)$/.test(r.branch) && git(r.repo, ["branch", "-D", r.branch]).ok;
    if (r.branch && r.branch !== r.base && !deleted) throw new Error("task branch cleanup failed; reservation and task authority retained");
    for (const f of [this.recFile(project, task), this.markFile(project, task), this.lockFile(project, task)]) rmSync(f, { force: true });
    return { branch: r.branch, deleted };
  }

  /**
   * At start, before the sweep: worktree records an older Studio wrote in the old layout
   * (data/work/<project>/<task>.json, no kind, no marker) move into this namespace. Any
   * uncommitted work is kept on a kept ref first; the worktree moves with `git worktree
   * move` (its branch name kept as it was); the lock moves too; each step is logged.
   * Entries that do not read as such a record are never touched.
   */
  migrate(): string[] {
    const old = join(this.dataDir, "work"), done: string[] = [];
    // a worktree record that cannot migrate safely is parked (with its lock, and its folder when it has one), never dropped and never acted on
    // the folder parked is always the record's own sibling (data/work/<p>/<stem>), never a path the record names; a symlink is moved as a link
    const lexists = (x: string) => { try { lstatSync(x); return true; } catch { return false; } };
    const quarantine = (d: string, f: string, why: string, folder: string = join(d, f.replace(/\.json$/, ""))) => {
      // a name of its own: ISO time to the ms, project, stem, a random suffix; made with a plain mkdir (EEXIST: a new suffix), so a park never lands on another
      const base = join(this.root, ".quarantine"); mkdirSync(base, { recursive: true }); let q = "";
      for (let i = 0; !q; i++) { const c = join(base, `${now().replace(/[:.]/g, "-")}-${basename(d)}-${f.replace(/\.json$/, "")}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`);
        try { mkdirSync(c); q = c; } catch (e: any) { if (e?.code !== "EEXIST" || i >= 50) throw e; } }
      if (lexists(join(d, f))) renameSync(join(d, f), join(q, f)); const lk = join(d, f.replace(/\.json$/, ".lock")); if (existsSync(lk)) renameSync(lk, join(q, f.replace(/\.json$/, ".lock")));
      let parked = "";
      if (lexists(folder)) { if (!lstatSync(folder).isSymbolicLink()) this.thawPath(folder); renameSync(folder, join(q, "folder")); parked = ` with its folder ${folder}`; }
      this.log(`old-layout record ${f} parked in ${q}${parked}: ${why}`); };
    for (const p of existsSync(old) ? readdirSync(old) : []) {
      const d = join(old, p); if (p === "wt" || p.startsWith(".") || !statSync(d).isDirectory()) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".json"))) {
        let r: any = null; try { r = JSON.parse(readFileSync(join(d, f), "utf8")); } catch { continue; }
        const t = f.slice(0, -5);
        // a worktree record by its shape (no kind, a branch, kept refs, a repo, a path); anything else is not ours and is never touched
        if (!r || r.kind || typeof r.project !== "string" || typeof r.task !== "string" || typeof r.branch !== "string" || !Array.isArray(r.kept) || typeof r.repo !== "string" || typeof r.path !== "string") continue;
        try {
          // it migrates only when it is exactly an old-layout record: its own ids are safe segments, they are its folder's and file's names,
          // and its path is exactly that folder (real path inside data/work); anything else is parked, and its path is never opened
          if (!idOk(r.project) || !idOk(r.task)) { quarantine(d, f, `its ids (${r.project}/${r.task}) cannot name a worktree folder`); continue; }
          if (r.project !== p || r.task !== t) { quarantine(d, f, `its ids (${r.project}/${r.task}) are not its folder's (${p}/${t})`); continue; }
          const want = join(old, p, t);
          if (r.path !== want || !realInside(old, want) || (existsSync(want) && realOf(want) !== join(realOf(old), p, t))) { quarantine(d, f, `its path (${r.path}) is not its own old-layout folder (${want})`); continue; }
          try { this.assertNoCaseTwin(this.root, p); this.assertNoCaseTwin(join(this.root, p), t); } catch (e: any) { quarantine(d, f, e.message); continue; }
          if (this.get(p, t)) { quarantine(d, f, `a worktree for ${p}/${t} already exists in data/work/wt`); continue; }
          if (existsSync(want) && !existsSync(r.repo)) { quarantine(d, f, `its repo ${r.repo} is gone`); continue; }
        } catch (e: any) { this.log(`old-layout record ${p}/${f} not migrated: ${e?.message ?? e}`); continue; }
        const P = p, T = t, hadRec = lexists(this.recFile(P, T)), hadMark = lexists(this.markFile(P, T));
        // one record's failure never stops the others
        try { ((): void => {
          const from = r.path, to = join(this.root, P, T); mkdirSync(join(this.root, P), { recursive: true });
          const rec: WorktreeRecord = { ...r, kind: "crew-worktree", project: P, task: T, path: to };
          if (existsSync(from) && existsSync(r.repo)) {
            this.thawPath(from);
            if (changedPaths(from).length) { const tmpRec = { ...rec, path: from }; const ref = this.keep(tmpRec, "kept before moving into data/work/wt"); rec.kept = tmpRec.kept; this.log(`old-layout worktree ${P}/${T}: its uncommitted work kept on ${ref}`); }
            const mv = git(r.repo, ["worktree", "move", from, to]);
            if (!mv.ok) { this.log(`old-layout worktree ${P}/${T} could not move (${mv.err}); left where it is`); return; }
            this.log(`old-layout worktree ${P}/${T}: moved ${from} -> ${to} (branch ${rec.branch} kept)`); this.note(rec, `moved from ${from} (old layout) into ${to}; branch ${rec.branch} kept`);
          } else { this.log(`old-layout worktree ${P}/${T}: its folder was gone; the record moves alone`); this.note(rec, "record moved from the old layout (its worktree was gone)"); }
          writeFileSync(this.markFile(P, T), JSON.stringify({ kind: "crew-worktree", path: to, at: now(), migrated: true }));
          this.save(rec); rmSync(join(d, f), { force: true });
          const lk = join(d, `${t}.lock`); if (existsSync(lk)) { try { renameSync(lk, this.lockFile(P, T)); this.log(`old-layout worktree ${P}/${T}: its lock moved`); } catch (e: any) { this.log(`old-layout worktree ${P}/${T}: its lock could not move (${e?.message ?? e})`); } }
          this.log(`old-layout worktree ${P}/${T} migrated into data/work/wt (branch ${rec.branch})`); done.push(`${P}/${T}`);
  
        })(); } catch (e: any) {
          // a failure part way: whatever this record left in the new place is undone, and the record is parked with its lock and
          // its folder (wherever the folder now is), so nothing is left outside every sweep; the next record still migrates
          const why = `its migration failed: ${e?.message ?? e}`; const to = join(this.root, P, T);
          try {
            if (!hadRec) rmSync(this.recFile(P, T), { force: true }); if (!hadMark) rmSync(this.markFile(P, T), { force: true });
            quarantine(d, f, why, lexists(join(d, t)) ? join(d, t) : to);
          } catch (e2: any) { this.log(`old-layout record ${p}/${f} not migrated (${why}) and could not be parked: ${e2?.message ?? e2}`); }
        }
      }
    }
    return done;
  }

  /** At start: worktrees and locks no live run owns go, each with its reason; a live run's worktree is never touched. */
  sweep(isLive: (run: string | null) => boolean, keepDays = 7): { removed: string[]; locks: string[]; foreign: string[] } {
    const out = { removed: [] as string[], locks: [] as string[], foreign: [] as string[] };
    const log = (what: string) => this.log(what);
    for (const r of this.all()) {
      const lf = this.lockFile(r.project, r.task);
      if (existsSync(lf)) { let cur: any = null; try { cur = JSON.parse(readFileSync(lf, "utf8")); } catch {}
        if (!cur || !alive(Number(cur.pid)) || cur.pid === process.pid) { rmSync(lf, { force: true }); out.locks.push(`${r.project}/${r.task}`); log(`stale lock of ${r.project}/${r.task} removed: its holder ${cur?.holder ?? "?"} (pid ${cur?.pid ?? "?"}) is gone`); } }
      if (isLive(r.run)) continue;
      // expired kept refs go even after the worktree went
      const cutoff = Date.now() - keepDays * 86400_000; const before = r.kept.length;
      r.kept = r.kept.filter((k) => { if (Date.parse(k.at) >= cutoff) return true; if (existsSync(r.repo)) git(r.repo, ["update-ref", "-d", k.ref]); return false; });
      if (r.kept.length !== before) { this.note(r, `${before - r.kept.length} kept refs older than ${keepDays} days removed`); this.save(r); }
      if (r.removedAt || !existsSync(r.path)) continue;
      if (existsSync(r.repo) && (changedPaths(r.path).length || git(r.path, ["rev-parse", "HEAD"]).out !== r.head)) this.keep(r, "orphaned at startup");
      this.remove(r.project, r.task, `swept at startup: run ${r.run ?? "?"} is not live`, keepDays);
      out.removed.push(`${r.project}/${r.task}`); log(`worktree ${r.project}/${r.task} removed: run ${r.run ?? "?"} is not live${r.kept.length ? ` (work kept on ${r.kept.at(-1)!.ref})` : ""}`);
    }
    // temporary trees this module marked (data/work/wt/.tmp/<run>-<what>, with <name>.marker) whose run is not live
    const tmpd = join(this.root, ".tmp");
    if (existsSync(tmpd)) for (const t of readdirSync(tmpd)) { if (t.endsWith(".marker")) continue;
      if (!existsSync(join(tmpd, `${t}.marker`))) { out.foreign.push(`.tmp/${t}`); log(`foreign entry .tmp/${t} left alone: no marker says Studio made it`); continue; }
      const run = /^(R-\d+)-/.exec(t)?.[1] ?? null; if (isLive(run)) continue;
      this.thawPath(join(tmpd, t)); rmSync(join(tmpd, t), { recursive: true, force: true }); rmSync(join(tmpd, `${t}.marker`), { force: true }); out.removed.push(`.tmp/${t}`); log(`temporary tree .tmp/${t} removed: run ${run ?? "?"} is not live`); }
    // anything else in the namespace that no marked record owns: reported, never deleted
    const owned = new Set(this.all().flatMap((r) => [r.task, `${r.task}.json`, `${r.task}.marker`, `${r.task}.lock`].map((x) => `${r.project}/${x}`)));
    for (const p of existsSync(this.root) ? readdirSync(this.root) : []) { const d = join(this.root, p); if (p.startsWith(".") || p === "sweep.log") continue;
      if (!statSync(d).isDirectory()) { out.foreign.push(p); log(`foreign entry ${p} left alone`); continue; }
      for (const t of readdirSync(d)) if (!owned.has(`${p}/${t}`)) { out.foreign.push(`${p}/${t}`); log(`foreign entry ${p}/${t} left alone: no marked record owns it`); } }
    return out;
  }

  // ---------- read-only between rounds ----------
  private walk(dir: string, f: (p: string, isDir: boolean) => void) {
    for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.name === ".git") continue; const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue; if (e.isDirectory()) { f(p, true); this.walk(p, f); } else f(p, false); }
  }
  /** Where a run's temporary trees go (fail-first's base tree, main's tree): removed with the worktree, swept when the run is not live. */
  tmpOf(run: string, what: string) { const d = join(this.root, ".tmp"); mkdirSync(d, { recursive: true }); const name = `${safe(run)}-${safe(what)}`; writeFileSync(join(d, `${name}.marker`), JSON.stringify({ kind: "crew-tmp", run, at: now() })); return join(d, name); }
  freeze(r: WorktreeRecord) { if (!existsSync(r.path)) return; this.walk(r.path, (p, d) => { try { const m = statSync(p).mode & 0o777; chmodSync(p, d ? m & ~0o222 : m & ~0o222); } catch {} }); try { chmodSync(r.path, statSync(r.path).mode & ~0o222); } catch {} }
  thaw(r: WorktreeRecord) { this.thawPath(r.path); }
  private thawPath(path: string) { if (!existsSync(path)) return; try { chmodSync(path, statSync(path).mode | 0o200); } catch {} this.walk(path, (p) => { try { chmodSync(p, statSync(p).mode | 0o200); } catch {} }); }
}
