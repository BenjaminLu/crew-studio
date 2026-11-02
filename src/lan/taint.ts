// Commits Studio applied from a peer's work (docs/units/lan-relay.md, Applying a code result): the taint list. A branch
// name is not enough (one commit on top of a lan-untrusted/ branch, under another name, is still the peer's work), so
// Studio keeps the SHA of every commit it applied, with the peer and the thread, in its store (src/lan/store.ts), and a
// commit is tainted when any recorded SHA is its ancestor (git merge-base --is-ancestor). The check runs wherever trusted
// work would start from or publish such a commit: a Task's base (repo.prepare, a base Firstmate set included), Send for
// review and From existing branch, a merge, and every Studio push or pull request. Only an audited desktop action ("I
// reviewed commit X") clears a record.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { git } from "../git";
import type { TaintRow } from "./store";

export type Tainted = { sha: string; peer: string; thread: string; why: string };
type Source = () => TaintRow[];
const sources = new Set<Source>();
/** the relay registers its store's taint rows when it opens (it removes them when it closes) */
export function addTaintSource(s: Source): () => void { sources.add(s); return () => { sources.delete(s); }; }
/** tests: one source in place of every other (null: none) */
export function setTaintSource(s: Source | null) { sources.clear(); if (s) sources.add(s); }
const rowsOf = () => [...sources].flatMap((s) => { try { return s(); } catch { return []; } });
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** The recorded commit from a peer this commit is or descends from (in this repository), or null. A commit git cannot
 *  resolve is treated as tainted when the repository has records (fail closed). */
export function taintOf(repo: string, commit: string): Tainted | null {
  if (!sources.size) return null;
  const r = real(repo), rows = rowsOf().filter((t) => !t.cleared && real(t.repo) === r);
  if (!rows.length) return null;
  const head = git(repo, ["rev-parse", "--verify", `${commit}^{commit}`]); if (!head.ok) return { sha: "?", peer: rows[0].peer, thread: rows[0].thread, why: `${commit} cannot be resolved in a repository that holds work from a peer` };
  const sha = head.out.trim();
  for (const t of rows) {
    if (t.sha === sha) return { sha: t.sha, peer: t.peer, thread: t.thread, why: t.why };
    const a = git(repo, ["merge-base", "--is-ancestor", t.sha, sha]);
    if (a.ok) return { sha: t.sha, peer: t.peer, thread: t.thread, why: t.why };
  }
  return null;
}
/** the refusal a trusted step gives a tainted commit, or null */
export function taintRefusal(repo: string, commit: string, what: string): string | null {
  const t = taintOf(repo, commit);
  return t ? `${what}: ${commit.slice(0, 12)} holds work from a peer's Studio (commit ${t.sha.slice(0, 12)}, ${t.why}); Studio does not start or publish trusted work from it until a person marks that commit reviewed on the Peers page` : null;
}
