// The dispatcher's side of a code result (docs/units/lan-relay.md): the peer's changes.patch, applied to one of this
// Studio's registered projects on a branch of its own, lan-untrusted/<thread>-r<n>, in a worktree under Studio's data.
// Before anything is written every path the patch names is checked again (src/lan/paths.ts: no CI, hooks, agent or
// editor settings, runner configuration; no link, no path outside the tree), git apply checks the patch first, and
// Studio's git runs no hook (src/git.ts). Nothing is merged, built, tested or pushed here: the dispatcher reviews the
// branch like any other untrusted work, and a run of its tests should go through a restricted Task too.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { addPaths, git, must } from "../git";
import { protectedHit, writeRefused } from "./paths";

export type PatchRefusal = { path: string; why: string };
/** Every path a unified git patch touches, and the reasons any of them may not be applied. */
export function patchProblems(patch: string): { paths: string[]; problems: PatchRefusal[] } {
  const paths = new Set<string>(), problems: PatchRefusal[] = [];
  let cur = "";
  for (const line of patch.split("\n")) {
    const d = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (d) { cur = d[2]; for (const p of new Set([d[1], d[2]])) { paths.add(p); if (p.startsWith("/") || p.split("/").includes("..") || p.includes("\\")) problems.push({ path: p, why: "a path outside the project" }); else if (writeRefused(p)) problems.push({ path: p, why: "a protected path (CI, hooks, agent or editor settings, runner configuration)" }); } continue; }
    if (/^(new file mode|new mode|old mode|deleted file mode) 120000/.test(line)) problems.push({ path: cur, why: "a symbolic link" });
    if (/^(new file mode|new mode) 160000/.test(line)) problems.push({ path: cur, why: "a submodule" });
    if (/^(rename|copy) (from|to) /.test(line)) { const p = line.replace(/^(rename|copy) (from|to) /, ""); paths.add(p); if (writeRefused(p)) problems.push({ path: p, why: "a protected path" }); }
  }
  return { paths: [...paths], problems };
}

export function lanApplier(o: { dataDir: string; project: (id: string) => { path: string; base?: string } | null }) {
  return ({ project, patch, branch }: { project: string; patch: string; branch: string }) => {
    const p = o.project(project); if (!p?.path || !existsSync(join(p.path, ".git"))) throw new Error(`no registered project ${project} with a git repository`);
    if (!/^lan-untrusted\/[a-z0-9-]+-r\d+$/.test(branch)) throw new Error("bad branch name");
    const { paths, problems } = patchProblems(patch);
    if (!paths.length) throw new Error("the patch changes nothing");
    if (problems.length) throw new Error(`refused: ${problems.slice(0, 5).map((x) => `${x.path} (${x.why})`).join(", ")}`);
    const base = p.base || "main";
    if (git(p.path, ["rev-parse", "--verify", `refs/heads/${branch}`]).ok) throw new Error(`branch ${branch} already exists in ${project}: this result was applied before`);
    const dir = join(o.dataDir, "lan", "apply", branch.replace(/\//g, "_"));
    mkdirSync(join(o.dataDir, "lan", "apply"), { recursive: true });
    const undo = () => { git(p.path, ["worktree", "remove", "--force", dir]); git(p.path, ["branch", "-D", branch]); rmSync(dir, { recursive: true, force: true }); };
    must(p.path, ["worktree", "add", "-q", "-b", branch, dir, base]);
    try {
      const check = git(dir, ["apply", "--check", "--whitespace=nowarn", "-"], patch); if (!check.ok) throw new Error(`git apply --check: ${check.err.slice(0, 300)}`);
      // package.json: its script and hook keys against the base, once the bytes are known
      const before = new Map(paths.filter((x) => /(^|\/)package\.json$/i.test(x)).map((x) => [x, git(dir, ["show", `HEAD:${x}`])]));
      const done = git(dir, ["apply", "--whitespace=nowarn", "-"], patch); if (!done.ok) throw new Error(`git apply: ${done.err.slice(0, 300)}`);
      for (const [x, b] of before) { const after = existsSync(join(dir, x)) ? readFileSync(join(dir, x), "utf8") : null; const hit = protectedHit(x, after, b.ok ? b.out : null); if (hit) throw new Error(`refused: ${hit}`); }
      addPaths(dir, paths);
      must(dir, ["commit", "-q", "--no-verify", "-m", `Work from a peer's Studio (${branch}): not reviewed yet`]);
      return { branch, path: dir, files: paths };
    } catch (e) { undo(); throw e; }
  };
}
