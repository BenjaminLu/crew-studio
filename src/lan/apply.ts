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

export function lanApplier(o: { dataDir: string; project: (id: string) => { path: string; base?: string } | null }) {
  return ({ project, patch, branch }: { project: string; patch: string; branch: string }) => {
    const p = o.project(project); if (!p?.path || !run(p.path, ["rev-parse", "--git-dir"]).ok) throw new Error(`no registered project ${project} with a git repository`);
    if (!/^lan-untrusted\/[a-z0-9-]+-r\d+$/.test(branch)) throw new Error("bad branch name");
    const repo = p.path, base = p.base || "main";
    const { paths, problems } = patchProblems(patch, repo);
    if (problems.length) throw new Error(`refused: ${problems.slice(0, 5).map((x) => `${x.path} (${x.why})`).join(", ")}`);
    if (run(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok) throw new Error(`branch ${branch} already exists in ${project}: this result was applied before`);
    const baseCommit = run(repo, ["rev-parse", "--verify", `${base}^{commit}`]); if (!baseCommit.ok) throw new Error(`no branch ${base} in ${project}`);
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
      const commit = must(["commit-tree", tree, "-p", baseCommit.out.trim(), "-m", `Work from a peer's Studio (${branch}): not reviewed yet`]);
      must(["update-ref", `refs/heads/${branch}`, commit, ""]); // "" as the old value: the branch must not exist yet
      return { branch, path: repo, files: paths };
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  };
}
