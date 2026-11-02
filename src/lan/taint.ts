// Commits Studio applied from a peer's work (docs/units/lan-relay.md, Applying a code result): the taint list. A branch
// name is not enough (one commit on top of a lan-untrusted/ branch, under another name, is still the peer's work), so
// Studio keeps the SHA of every commit it applied, with the peer and the thread, and a commit is tainted when a recorded
// SHA is its ancestor (git merge-base --is-ancestor). The check runs wherever trusted work would start from or publish
// such a commit: a Task's base (repo.prepare, a base Firstmate set included), Send for review and From existing branch, a
// merge, and every Studio push or pull request. Only an audited desktop action ("I reviewed commit X") clears a record.
//   - Its own store, lan/taint.db, opened when Studio starts whatever the relay does (CREW_LAN=0, an identity lost, a
//     relay that does not open): the relay's store may be set aside (作廢並換新身分), this one never is.
//   - It matches by commit, never by folder: a row counts in every repository that holds its commit (a moved folder, a
//     second clone, a fetch into another clone), and clearing a commit clears it everywhere.
//   - It fails closed: a list that cannot be read refuses every check, in every repository, with the reason; so does a
//     list that was deleted or restored from an older copy (its sentinel, lan/taint.created, says it was made and the
//     most rows it held: src/lan/sentinel.ts), and, outside a test run, a check with no list open at all.
//   - The project carries it too: before the branch is made, the commit is also marked in the project itself
//     (refs/crew/lan-taint/<sha>), so it stays tainted there with no list at all (the whole data folder gone). A check
//     reads the list's rows and the project's marks; clearing a commit deletes both.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "../git";
import { checkHeld, checkNotMissing, Sentinel } from "./sentinel";

export type TaintRow = { sha: string; repo: string; project: string; peer: string; thread: string; round: number; at: string; why: string; cleared: string | null; clearedBy: string | null };
export type Tainted = { sha: string; peer: string; thread: string; why: string; unreadable?: boolean };
type Source = () => TaintRow[];
const sources = new Set<Source>();
/** a list of rows the checks read (a source that throws refuses every check) */
export function addTaintSource(s: Source): () => void { sources.add(s); return () => { sources.delete(s); }; }
/** tests: one source in place of every other (null: none) */
export function setTaintSource(s: Source | null) { sources.clear(); if (s) sources.add(s); }

/** lan/taint.db: 0600, WAL, synchronous FULL. A file that is there but cannot be opened or read leaves `broken` set and
 *  every read throws (so every check refuses). */
export class TaintStore {
  private db: Database | null = null;
  readonly broken: string | null = null;
  private remove: () => void = () => {};
  private readonly sentinel: Sentinel;
  constructor(readonly path: string) {
    this.sentinel = new Sentinel(join(dirname(path), "taint.created"));
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // never made again empty: a list Studio made that is gone is broken, not "nothing tainted"
      checkNotMissing(this.sentinel, existsSync(path), `the list of commits applied from peers (${path})`);
      const db = new Database(path, { create: true, readwrite: true });
      try {
        db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = FULL"); db.exec("PRAGMA busy_timeout = 5000");
        db.exec("CREATE TABLE IF NOT EXISTS taint (sha TEXT NOT NULL, repo TEXT NOT NULL, project TEXT NOT NULL, peer TEXT NOT NULL, thread TEXT NOT NULL, round INTEGER NOT NULL, at TEXT NOT NULL, why TEXT NOT NULL, cleared TEXT, cleared_by TEXT, PRIMARY KEY (sha, repo))");
        checkHeld(this.sentinel, Number((db.query("SELECT count(*) AS n FROM taint").get() as any).n), `the list of commits applied from peers (${path})`);
      } catch (e) { db.close(); throw e; }
      for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) try { chmodSync(f, 0o600); } catch {}
      this.db = db;
    } catch (e: any) { const m = String(e?.message ?? e); this.broken = m.startsWith("the list of commits") ? m.slice(0, 400) : `the list of commits applied from peers (${path}) cannot be read: ${m.slice(0, 200)}`; }
  }
  private live(): Database { if (!this.db) throw new Error(this.broken ?? "the list of commits applied from peers is closed"); return this.db; }
  /** every row (cleared ones included); throws when the list cannot be read */
  rows(): TaintRow[] {
    return (this.live().query("SELECT * FROM taint").all() as any[]).map((r) => ({ sha: r.sha, repo: r.repo, project: r.project, peer: r.peer, thread: r.thread, round: r.round, at: r.at, why: r.why, cleared: r.cleared ?? null, clearedBy: r.cleared_by ?? null }));
  }
  /** a commit joins the list (again, if it was cleared): written and synced before it returns */
  add(t: Omit<TaintRow, "cleared" | "clearedBy">) {
    this.live().query("INSERT INTO taint (sha, repo, project, peer, thread, round, at, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sha, repo) DO UPDATE SET cleared = NULL, cleared_by = NULL, why = excluded.why").run(t.sha, t.repo, t.project, t.peer, t.thread, t.round, t.at, t.why);
    // the most rows the list ever held (rows are never deleted: a clear only marks one)
    this.sentinel.raise(Number((this.live().query("SELECT count(*) AS n FROM taint").get() as any).n));
  }
  /** "I reviewed commit X": every row of that commit, whatever folder it was recorded in */
  clear(sha: string, by: string): number { return this.live().query("UPDATE taint SET cleared = ?, cleared_by = ? WHERE sha = ? AND cleared IS NULL").run(new Date().toISOString(), by, sha).changes; }
  retag(peer: string, why: string) { this.live().query("UPDATE taint SET why = ? WHERE peer = ?").run(why, peer); }
  /** the checks read this list (until close) */
  register(): this { this.remove(); this.remove = addTaintSource(() => this.rows()); return this; }
  close() { this.remove(); this.remove = () => {}; try { this.db?.close(); } catch {} this.db = null; }
}
/** Studio's start: the taint list of this data folder, open and read by every check, whatever the relay does */
export function openTaintList(dataDir: string): TaintStore { return new TaintStore(join(dataDir, "lan", "taint.db")).register(); }

const rowsOf = () => [...sources].flatMap((s) => s());
const REF = "refs/crew/lan-taint/";
/** mark a commit applied from a peer in its project (before any branch names it); throws when git cannot */
export function markTaintRef(repo: string, sha: string) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("not a commit");
  const r = git(repo, ["update-ref", `${REF}${sha}`, sha]); if (!r.ok) throw new Error(`the commit could not be marked in its project (${REF}${sha.slice(0, 12)}): ${r.err.slice(0, 200)}`);
}
/** "I reviewed commit X": its mark leaves the project (true when there was one) */
export function clearTaintRef(repo: string, sha: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(sha) || !git(repo, ["rev-parse", "--verify", "--quiet", `${REF}${sha}`]).ok) return false;
  const r = git(repo, ["update-ref", "-d", `${REF}${sha}`]); if (!r.ok) throw new Error(`the mark of ${sha.slice(0, 12)} could not be removed from ${repo}: ${r.err.slice(0, 200)}`); return true;
}
/** the commits marked in this project, or null when git cannot list them */
export function taintRefs(repo: string): string[] | null {
  const r = git(repo, ["for-each-ref", "--format=%(objectname)", REF]); if (!r.ok) return null;
  return r.out.split("\n").map((x) => x.trim()).filter((x) => /^[0-9a-f]{40}$/.test(x));
}
/** The recorded commit from a peer this commit is or descends from (in this repository, wherever the row was recorded),
 *  or null. A list that cannot be read, or a commit git cannot resolve while the list has records, is tainted (fail closed). */
export function taintOf(repo: string, commit: string): Tainted | null {
  const testRun = !!process.env.CREW_TEST_ENV_ISOLATED;
  // outside a test run, Studio always opened a list at its start: none open is a refusal, never "nothing tainted"
  if (!sources.size && !testRun) return { sha: "?", peer: "?", thread: "?", why: "no list of commits applied from peers is open in this process", unreadable: true };
  let rows: TaintRow[];
  try { rows = rowsOf().filter((t) => !t.cleared); }
  catch (e: any) { return { sha: "?", peer: "?", thread: "?", why: String(e?.message ?? e).slice(0, 300), unreadable: true }; }
  // the project's own marks, with the list's rows
  const marked = taintRefs(repo);
  if (marked === null && (sources.size || !testRun)) return { sha: "?", peer: "?", thread: "?", why: `the marks of commits from peers in ${repo} (${REF}) cannot be read`, unreadable: true };
  for (const m of marked ?? []) if (!rows.some((t) => t.sha === m)) rows.push({ sha: m, repo, project: "?", peer: "?", thread: "?", round: 0, at: "", why: `marked in this project as work from a peer (${REF}${m.slice(0, 12)})`, cleared: null, clearedBy: null });
  if (!rows.length) return null;
  const head = git(repo, ["rev-parse", "--verify", `${commit}^{commit}`]); if (!head.ok) return { sha: "?", peer: rows[0].peer, thread: rows[0].thread, why: `${commit} cannot be resolved while Studio holds work from a peer` };
  const sha = head.out.trim(), seen = new Set<string>();
  for (const t of rows) {
    if (seen.has(t.sha)) continue; seen.add(t.sha);
    if (t.sha === sha) return { sha: t.sha, peer: t.peer, thread: t.thread, why: t.why };
    if (!git(repo, ["cat-file", "-e", `${t.sha}^{commit}`]).ok) continue; // this repository does not hold that commit
    const a = git(repo, ["merge-base", "--is-ancestor", t.sha, sha]);
    if (a.ok) return { sha: t.sha, peer: t.peer, thread: t.thread, why: t.why };
  }
  return null;
}
/** the refusal a trusted step gives a tainted commit, or null */
export function taintRefusal(repo: string, commit: string, what: string): string | null {
  const t = taintOf(repo, commit); if (!t) return null;
  if (t.unreadable) return `${what}: refused, because ${t.why}. Studio does not start or publish trusted work while it cannot tell which commits hold work from a peer's Studio`;
  return `${what}: ${commit.slice(0, 12)} holds work from a peer's Studio (commit ${t.sha.slice(0, 12)}, ${t.why}); Studio does not start or publish trusted work from it until a person marks that commit reviewed on the Peers page`;
}
