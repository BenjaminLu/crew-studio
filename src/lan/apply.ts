// The dispatcher's side of a code result (docs/units/lan-relay.md): the peer's changes.patch, applied to one of this
// Studio's registered projects on a new branch lan-untrusted/<thread>-r<n>. Nothing is merged, built, tested or pushed:
// the dispatcher reviews the branch like any other untrusted work.
//   - Git decides which paths the patch names (`git apply --numstat -z` and `--summary`), never a regex over its text:
//     every one of them, renames and copies included, is checked (no path outside the project, no protected path:
//     src/lan/paths.ts). A patch with a binary hunk, a new or changed file mode other than a plain 100644 file (an
//     executable, a symbolic link, a submodule), or anything git cannot account for is refused whole.
//   - It is applied without a checkout or a working tree: into a temporary index read from the base (`apply --cached`),
//     written as a tree and committed with `commit-tree`, the branch made with `update-ref`. So no clean or smudge filter
//     the repository's attributes name runs, no hook runs, and Studio's git reads no system or global config of the
//     captain's (src/git.ts), with core.attributesFile empty and apply.* settings overridden on the command line.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitArgv, gitEnv } from "../git";
import { protectedHit, writeRefused } from "./paths";

export type PatchRefusal = { path: string; why: string };
const SAFE = ["-c", "core.attributesFile=/dev/null", "-c", "apply.whitespace=nowarn", "-c", "apply.ignoreWhitespace=no", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false"];
function run(cwd: string, args: string[], o: { input?: string; env?: Record<string, string> } = {}) {
  const r = Bun.spawnSync(gitArgv([...SAFE, ...args]), { cwd, stdin: o.input !== undefined ? new TextEncoder().encode(o.input) : "ignore", stdout: "pipe", stderr: "pipe", env: gitEnv(o.env ?? {}) });
  return { ok: r.success, out: r.stdout.toString(), err: r.stderr.toString().trim() };
}
/** Work from a peer: a branch named lan-untrusted/…, or a commit one of those branches holds (under any other name). It is
 *  read and diffed by people; Studio never sends it for review as trusted work (that run may merge). */
export function lanUntrusted(repo: string, commit: string, branch: string | null): boolean {
  if (branch && /^(refs\/heads\/)?lan-untrusted\//i.test(branch)) return true;
  const r = run(repo, ["branch", "--list", "--contains", commit, "--format=%(refname:short)", "lan-untrusted/*"]);
  return !r.ok || r.out.trim().length > 0; // git could not answer: refused
}
const outside = (p: string) => p.startsWith("/") || p.split("/").includes("..") || p.includes("\\") || /^[A-Za-z]:/.test(p) || p.split("/").includes(".git");

/** The paths git says this patch touches, and every reason any part of it may not be applied (empty: it may). */
export function patchProblems(patch: string, cwd = tmpdir()): { paths: string[]; problems: PatchRefusal[] } {
  const problems: PatchRefusal[] = [], paths: string[] = [];
  if (/^GIT binary patch$/m.test(patch) || /^Binary files .* differ$/m.test(patch) || /^literal \d+$|^delta \d+$/m.test(patch)) problems.push({ path: "(patch)", why: "a binary hunk (only text changes are applied)" });
  const ns = run(cwd, ["apply", "--numstat", "-z", "-"], { input: patch });
  if (!ns.ok) return { paths, problems: [...problems, { path: "(patch)", why: `git cannot read it: ${ns.err.slice(0, 200)}` }] };
  // numstat -z: "added\tdeleted\tpath\0", or for a rename or copy "added\tdeleted\t\0from\0to\0"; "-\t-" is a binary file
  const parts = ns.out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]); if (!m) continue;
    const named = m[3] ? [m[3]] : [parts[++i], parts[++i]];
    if (m[1] === "-" || m[2] === "-") problems.push({ path: named.at(-1) ?? "?", why: "a binary file (only text changes are applied)" });
    for (const p of named) { if (p === undefined) continue; paths.push(p); }
  }
  for (const p of new Set(paths)) {
    if (outside(p)) problems.push({ path: p, why: "a path outside the project" });
    else if (writeRefused(p)) problems.push({ path: p, why: "a protected path (CI, hooks, agent or editor settings, runner configuration)" });
  }
  // modes: only plain 100644 files are created; no mode change (an executable, a link, a submodule)
  const sum = run(cwd, ["apply", "--summary", "-"], { input: patch });
  for (const line of sum.out.split("\n")) {
    const c = /^\s*create mode (\d+) (.*)$/.exec(line); if (c && c[1] !== "100644") problems.push({ path: c[2], why: c[1] === "120000" ? "a symbolic link" : c[1] === "160000" ? "a submodule" : c[1] === "100755" ? "an executable file" : `file mode ${c[1]}` });
    const ch = /^\s*mode change (\d+) => (\d+) (.*)$/.exec(line); if (ch) problems.push({ path: ch[3], why: ch[2] === "100755" ? "a mode change to executable" : `a mode change to ${ch[2]}` });
  }
  // the same in the text, in case a line git skipped in its summary still carries a mode
  for (const line of patch.split("\n")) { const mm = /^(new file mode|new mode|old mode|deleted file mode) (\d+)/.exec(line); if (mm && mm[2] !== "100644" && !(mm[1] === "old mode" || mm[1] === "deleted file mode") ) { if (!problems.some((x) => /mode|executable|link|submodule/.test(x.why))) problems.push({ path: "(patch)", why: mm[2] === "100755" ? "an executable file" : `file mode ${mm[2]}` }); } }
  if (!paths.length && !problems.length) problems.push({ path: "(patch)", why: "it changes nothing" });
  return { paths: [...new Set(paths)], problems };
}

/** Every path the patch touches must be absent from the base or a plain 100644 file there (a symbolic link keeps its mode
 *  when only its target changes, an executable keeps its bit); copies and renames are refused (they carry the source's mode). */
export function baseModeProblems(repo: string, base: string, patch: string, paths: string[]): PatchRefusal[] {
  const out: PatchRefusal[] = [];
  if (/^(copy|rename) (from|to) /m.test(patch) || /^similarity index /m.test(patch)) out.push({ path: "(patch)", why: "a copy or rename (only edits and new plain files are applied)" });
  for (const p of paths) {
    const r = run(repo, ["ls-tree", "-z", base, "--", p]); const m = /^(\d{6}) /.exec(r.out);
    if (m && m[1] !== "100644") out.push({ path: p, why: m[1] === "120000" ? "a symbolic link in the base (its target cannot change)" : m[1] === "100755" ? "an executable in the base" : m[1] === "160000" ? "a submodule in the base" : `mode ${m[1]} in the base` });
  }
  return out;
}

/** the dispatcher's base for code work: the project's root commit and the commit its base branch is at */
export function baseOf(repo: string, branch: string): { root: string; sha: string } | null {
  const sha = run(repo, ["rev-parse", "--verify", `${branch}^{commit}`]); if (!sha.ok) return null;
  const roots = run(repo, ["rev-list", "--max-parents=0", sha.out.trim()]); if (!roots.ok) return null;
  const root = roots.out.trim().split("\n").sort()[0]; return /^[0-9a-f]{40}$/.test(root) ? { root, sha: sha.out.trim() } : null;
}
/** why a project cannot take code work on this base (it lacks the root or the commit), or null */
export function baseProblem(repo: string, base: { root: string; sha: string }): string | null {
  if (!run(repo, ["cat-file", "-e", `${base.root}^{commit}`]).ok) return `it does not share the dispatcher's history (root ${base.root.slice(0, 12)})`;
  if (!run(repo, ["cat-file", "-e", `${base.sha}^{commit}`]).ok) return `it does not hold the dispatcher's base commit ${base.sha.slice(0, 12)} (fetch it first)`;
  return null;
}
/** a branch pinned at the dispatcher's base in the taker's project, so the Task's worktree starts there and stays there */
export function pinBase(repo: string, sha: string): string {
  const name = `lan-base/${sha.slice(0, 12)}`;
  const have = run(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}^{commit}`]);
  if (!have.ok) { const r = run(repo, ["update-ref", `refs/heads/${name}`, sha, ""]); if (!r.ok) throw new Error(`the base ${sha.slice(0, 12)} could not be pinned: ${r.err.slice(0, 200)}`); }
  // an existing pin must still point at the full commit asked for: one that was moved is refused, never trusted
  else if (have.out.trim() !== sha) throw new Error(`the branch ${name} was moved: it points at ${have.out.trim().slice(0, 12)}, not at the dispatched base ${sha.slice(0, 12)}; delete it or move it back`);
  return name;
}

/** A patch committed onto a base commit, without a checkout or a working tree, under every rule a result from a peer is
 *  applied under (paths named by git and checked, no protected path, plain 100644 files only, no binary hunk, package.json
 *  scripts and hooks against the base; no filter or hook runs). Returns the commit; refuses with the reasons. */
export function commitPatch(repo: string, base: string, patch: string, message = "Work from a peer's Studio: not reviewed yet"): { commit: string; paths: string[] } {
  if (!/^[0-9a-f]{40}$/.test(String(base ?? ""))) throw new Error("no base commit");
  const { paths, problems } = patchProblems(patch, repo);
  if (problems.length) throw new Error(`refused: ${problems.slice(0, 5).map((x) => `${x.path} (${x.why})`).join(", ")}`);
  const baseCommit = run(repo, ["rev-parse", "--verify", `${base}^{commit}`]); if (!baseCommit.ok) throw new Error(`the base ${base.slice(0, 12)} is not in this project (never onto another base)`);
  const modes = baseModeProblems(repo, baseCommit.out.trim(), patch, paths);
  if (modes.length) throw new Error(`refused: ${modes.slice(0, 5).map((x) => `${x.path} (${x.why})`).join(", ")}`);
  const tmp = mkdtempSync(join(tmpdir(), "crew-lan-apply-")), env = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    const must = (args: string[], input?: string) => { const r = run(repo, args, { input, env }); if (!r.ok) throw new Error(`git ${args[0]}: ${r.err.slice(0, 300)}`); return r.out.trim(); };
    must(["read-tree", baseCommit.out.trim()]);
    must(["apply", "--cached", "--check", "--whitespace=nowarn", "-"], patch);
    // package.json: its script and hook keys against the base, read as blobs (no checkout)
    const blob = (rev: string, x: string) => { const r = run(repo, ["cat-file", "blob", `${rev}:${x}`], { env }); return r.ok ? r.out : null; };
    must(["apply", "--cached", "--whitespace=nowarn", "-"], patch);
    const tree = must(["write-tree"]);
    for (const x of paths.filter((y) => /(^|\/)package\.json$/i.test(y))) { const hit = protectedHit(x, blob(tree, x), blob(baseCommit.out.trim(), x)); if (hit) throw new Error(`refused: ${hit}`); }
    return { commit: must(["commit-tree", tree, "-p", baseCommit.out.trim(), "-m", message]), paths };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
export function lanApplier(o: { dataDir: string; project: (id: string) => { path: string; base?: string } | null }) {
  return ({ project, patch, branch, base: parent, record }: { project: string; patch: string; branch: string; base: string; record: (commit: string, repo: string) => void }) => {
    const p = o.project(project); if (!p?.path || !run(p.path, ["rev-parse", "--git-dir"]).ok) throw new Error(`no registered project ${project} with a git repository`);
    if (!/^lan-untrusted\/[a-z0-9-]+-r\d+$/.test(branch)) throw new Error("bad branch name");
    // the result applies to the commit it names (the dispatcher's own base, sent with the dispatch): never to whatever the
    // project's base branch is now
    if (!/^[0-9a-f]{40}$/.test(String(parent ?? ""))) throw new Error("the result names no base commit: it is not applied (never onto another base)");
    const repo = p.path;
    if (run(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok) throw new Error(`branch ${branch} already exists in ${project}: this result was applied before`);
    if (!run(repo, ["rev-parse", "--verify", `${parent}^{commit}`]).ok) throw new Error(`the base ${parent.slice(0, 12)} the result names is not in ${project}: it is not applied (never onto another base)`);
    const { commit, paths } = commitPatch(repo, parent, patch, `Work from a peer's Studio (${branch}): not reviewed yet`);
    // on the taint list (its row and the audit row written) before any branch names the commit
    record(commit, repo);
    const r = run(repo, ["update-ref", `refs/heads/${branch}`, commit, ""]); if (!r.ok) throw new Error(`git update-ref: ${r.err.slice(0, 300)}`); // "" as the old value: the branch must not exist yet
    return { branch, path: repo, files: paths, commit, repo };
  };
}
