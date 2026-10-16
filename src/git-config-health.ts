// The shared git config of a checkout (<repo>/.git/config) is read by the checkout and by
// every linked worktree, Studio's task worktrees under data/work/wt included. One bad key
// there breaks all of them at once, and git only says "must be run in a work tree"
// (2026-10-16: core.bare=true, written by a test fixture's `git init` that inherited
// GIT_DIR from `git bisect run`). This module reads that file directly, without git's
// repository discovery (which is what the bad key breaks), and names each problem:
//   core.bare      true in a repository that has a working tree
//   core.worktree  pointing anywhere but the checkout that owns the git folder
//   core.hooksPath pointing outside the repository
//   (unreadable)   a config file git cannot parse
// It only reports. Studio never rewrites a repository's config: the fix is the captain's.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gitEnv } from "./git";

export type GitConfigProblem = { label: string; repo: string; config: string; key: "core.bare" | "core.worktree" | "core.hooksPath" | "config"; value: string; why: string; fix: string };
type Layout = { gitDir: string; commonDir: string; config: string; tops: string[] };

/** the real path of p, or of its nearest existing ancestor plus the rest (/var and /private/var compare equal) */
const real = (p: string): string => { try { return realpathSync(p); } catch { const up = dirname(resolve(p)); return up === resolve(p) ? up : join(real(up), basename(p)); } };
const inside = (root: string, p: string) => { const r = relative(real(root), real(p)); return r === "" || (!!r && r !== ".." && !r.startsWith("../") && !isAbsolute(r)); };

/** Where a checkout's git folder and shared config are, read from the files git itself reads (no git process). Null: not a checkout. */
export function gitLayout(repo: string): Layout | null {
  if (typeof repo !== "string" || !repo || !isAbsolute(repo)) return null;
  const dot = join(repo, ".git"); let gitDir: string;
  try {
    const st = statSync(dot);
    if (st.isDirectory()) gitDir = dot;
    else if (st.isFile() && st.size < 4096) { const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dot, "utf8")); if (!m) return null; gitDir = resolve(repo, m[1]); }
    else return null;
  } catch { return null; }
  let commonDir = gitDir;
  try { const c = readFileSync(join(gitDir, "commondir"), "utf8").trim(); if (c) commonDir = resolve(gitDir, c); } catch {}
  // the checkouts allowed to own this git folder: the main checkout (<top>/.git), and this one when its git folder is the common one (a submodule)
  const tops = [...new Set([...(basename(commonDir) === ".git" ? [dirname(commonDir)] : []), ...(real(gitDir) === real(commonDir) ? [repo] : [])].map(real))];
  return { gitDir, commonDir, config: join(commonDir, "config"), tops };
}

/** git's boolean: a key with no "=" is true; "" is false; an integer is true unless 0 */
const truthy = (v: string | null) => v === null || /^(true|yes|on)$/i.test(v.trim()) || (/^-?\d+$/.test(v.trim()) && Number(v.trim()) !== 0);

/** The problems in one checkout's shared git config ([] when it is sound or the folder is not a checkout). */
export function sharedGitConfigProblems(repo: string, label = repo): GitConfigProblem[] {
  const l = gitLayout(repo); if (!l || !existsSync(l.config)) return [];
  const p = (key: GitConfigProblem["key"], value: string, why: string, fix: string): GitConfigProblem => ({ label, repo, config: l.config, key, value, why, fix });
  // --file reads exactly this file (no discovery, no GIT_DIR), --includes follows its include.path like git does
  const r = Bun.spawnSync(["git", "config", "--file", l.config, "--includes", "--null", "--list"], { cwd: "/", stdout: "pipe", stderr: "pipe", env: gitEnv() });
  if (!r.success) return [p("config", "", `git cannot read ${l.config}: ${r.stderr.toString().trim().slice(0, 200)}`, `Repair ${l.config} by hand`)];
  const last = new Map<string, string | null>();
  for (const e of r.stdout.toString().split("\0").filter(Boolean)) { const i = e.indexOf("\n"); const k = (i < 0 ? e : e.slice(0, i)).toLowerCase(); last.set(k, i < 0 ? null : e.slice(i + 1)); }
  const out: GitConfigProblem[] = [];
  const bare = last.get("core.bare");
  if (bare !== undefined && truthy(bare))
    out.push(p("core.bare", bare ?? "true", `core.bare=true in ${l.config}, but ${repo} has a working tree: every git command there and in each linked worktree fails ("must be run in a work tree")`, `git config --file ${l.config} core.bare false`));
  const wt = last.get("core.worktree");
  if (wt !== undefined && wt !== null) {
    const to = resolve(l.commonDir, wt);
    if (!l.tops.includes(real(to))) out.push(p("core.worktree", wt, `core.worktree in ${l.config} points to ${to}, not to the checkout that owns ${l.commonDir}${l.tops.length ? ` (${l.tops.join(", ")})` : ""}: git works on the wrong folder`, `git config --file ${l.config} --unset core.worktree`));
  }
  const hp = last.get("core.hookspath");
  if (hp) {
    const expanded = hp.startsWith("~/") ? join(homedir(), hp.slice(2)) : hp;
    const to = isAbsolute(expanded) ? expanded : resolve(repo, expanded);
    const roots = [...l.tops, real(repo)];
    if (!roots.some((t) => inside(t, to))) out.push(p("core.hooksPath", hp, `core.hooksPath in ${l.config} points to ${to}, outside the repository: commits there run hooks from a folder the repository does not own`, `git config --file ${l.config} --unset core.hooksPath`));
  }
  return out;
}

/** Every listed repository checked once (two paths sharing one git folder are one check), in order. */
export function gitConfigReport(targets: { label: string; path: string | null | undefined }[]): { checked: { label: string; path: string }[]; problems: GitConfigProblem[] } {
  const seen = new Set<string>(); const checked: { label: string; path: string }[] = []; const problems: GitConfigProblem[] = [];
  for (const t of targets) {
    if (!t.path) continue; const l = gitLayout(t.path); if (!l) continue;
    const key = real(l.commonDir); if (seen.has(key)) continue; seen.add(key);
    checked.push({ label: t.label, path: t.path }); problems.push(...sharedGitConfigProblems(t.path, t.label));
  }
  return { checked, problems };
}

/** Refused before Studio makes or uses a worktree on a repository whose shared config is broken: a typed reason, never a cascade of git errors. */
export class SharedGitConfigBroken extends Error {
  readonly outcome = "blocked"; readonly code = "shared_git_config_broken";
  constructor(readonly problems: GitConfigProblem[]) {
    super(`the shared git config of ${problems[0].repo} is broken (${problems.map((x) => `${x.key}=${x.value}`).join(", ")}): ${problems[0].why}. Studio does not change it; fix it by hand (${problems.map((x) => x.fix).join("; ")}) and retry`);
  }
}
export function assertSharedGitConfig(repo: string) { const p = sharedGitConfigProblems(repo); if (p.length) throw new SharedGitConfigBroken(p); }
