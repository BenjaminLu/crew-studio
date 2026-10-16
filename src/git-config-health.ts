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
// The shared config is read as written (no --includes); when extensions.worktreeConfig is on, the
// checkout's own config.worktree is read too. Only what makes git itself fail blocks a worktree
// (core.bare, a wrong core.worktree, an unreadable file or a bad boolean): a hooksPath outside the
// repository and keys that come only through include.path are reported, never refused (Studio's
// git overrides hooksPath anyway).
// It only reports. Studio never rewrites a repository's config: the fix is the captain's.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gitEnv } from "./git";
import { RoundBlocked } from "./round-blocked";

export type GitConfigProblem = { label: string; repo: string; config: string; key: "core.bare" | "core.worktree" | "core.hooksPath" | "config"; value: string; why: string; fix: string;
  /** true: git itself fails on it, so Studio refuses task worktrees; false: reported only (Doctor, startup) */
  blocking: boolean; /** git did not answer: the repository was not checked */ unchecked?: boolean };
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

/** each read is bounded: a git that hangs (a wrapper, a locked filesystem) never holds Studio's start or a round */
export const GIT_CONFIG_READ_TIMEOUT_MS = 2000;
class GitDidNotAnswer extends Error {}
const cfg = (file: string, args: string[]) => { const r = Bun.spawnSync(["git", "config", "--file", file, ...args], { cwd: "/", stdout: "pipe", stderr: "pipe", env: gitEnv(), timeout: GIT_CONFIG_READ_TIMEOUT_MS });
  if ((r as any).exitedDueToTimeout) throw new GitDidNotAnswer(`git config did not answer within ${GIT_CONFIG_READ_TIMEOUT_MS} ms`);
  return { ok: r.success, code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString().trim() }; };
/** the last value of each key, as git config --null --list prints it (null: a key with no "=") */
const listOf = (out: string) => { const m = new Map<string, string | null>(); for (const e of out.split("\0").filter(Boolean)) { const i = e.indexOf("\n"); m.set((i < 0 ? e : e.slice(0, i)).toLowerCase(), i < 0 ? null : e.slice(i + 1)); } return m; };

/** The problems in one checkout's shared git config ([] when it is sound or the folder is not a checkout). */
export function sharedGitConfigProblems(repo: string, label = repo): GitConfigProblem[] {
  const l = gitLayout(repo); if (!l || !existsSync(l.config)) return [];
  const out: GitConfigProblem[] = [];
  try { return check(l, repo, label, out); }
  catch (e) { if (!(e instanceof GitDidNotAnswer)) throw e;
    // unknown is not broken: reported, never refused (the git that hung would fail the round on its own)
    out.push({ label, repo, config: l.config, key: "config", value: "", why: `${e.message} while reading ${l.config}: not checked`, fix: "Check that git runs", blocking: false, unchecked: true }); return out; }
}
function check(l: Layout, repo: string, label: string, out: GitConfigProblem[]): GitConfigProblem[] {
  const read = (file: string, tops: string[], scope: string) => {
    const p = (key: GitConfigProblem["key"], value: string, why: string, fix: string, blocking: boolean) => out.push({ label, repo, config: file, key, value, why, fix, blocking });
    // as written: --file reads exactly this file (no discovery, no GIT_DIR, no include.path)
    const list = cfg(file, ["--null", "--list"]);
    if (!list.ok) { p("config", "", `git cannot read ${file}: ${list.err.slice(0, 200)}`, `Repair ${file} by hand`, true); return null; }
    const last = listOf(list.out);
    if (last.has("core.bare")) {
      const b = cfg(file, ["--type=bool", "--get", "core.bare"]);
      if (!b.ok) p("core.bare", String(last.get("core.bare")), `core.bare in ${file} is not a boolean (${b.err.slice(0, 120)}): git refuses to start in ${repo} and its linked worktrees`, `git config --file ${file} core.bare false`, true);
      else if (b.out.trim() === "true") p("core.bare", last.get("core.bare") ?? "true", `core.bare=true in ${file}${scope}, but ${repo} has a working tree: every git command there and in each linked worktree fails ("must be run in a work tree")`, `git config --file ${file} core.bare false`, true);
    }
    const wt = last.get("core.worktree");
    if (wt !== undefined && wt !== null) {
      const to = resolve(dirname(file), wt);
      if (!tops.includes(real(to))) p("core.worktree", wt, `core.worktree in ${file}${scope} points to ${to}, not to the checkout that owns it${tops.length ? ` (${tops.join(", ")})` : ""}: git works on the wrong folder`, `git config --file ${file} --unset core.worktree`, true);
    }
    const hp = last.get("core.hookspath");
    if (hp) {
      const expanded = hp.startsWith("~/") ? join(homedir(), hp.slice(2)) : hp;
      const to = isAbsolute(expanded) ? expanded : resolve(repo, expanded);
      if (![...l.tops, real(repo)].some((t) => inside(t, to))) p("core.hooksPath", hp, `core.hooksPath in ${file}${scope} points to ${to}, outside the repository: commits made outside Studio run hooks from a folder the repository does not own (Studio's own git overrides it)`, `git config --file ${file} --unset core.hooksPath`, false);
    }
    return last;
  };
  const shared = read(l.config, l.tops, "");
  if (!shared) return out;
  // keys whose value comes from include.path (it differs from the file as written): reported, never refused
  const withIncludes = cfg(l.config, ["--includes", "--null", "--list"]);
  if (withIncludes.ok) { const inc = listOf(withIncludes.out);
    for (const k of ["core.bare", "core.worktree", "core.hookspath"]) if (inc.has(k) && inc.get(k) !== shared.get(k)) {
      const key = (k === "core.hookspath" ? "core.hooksPath" : k) as GitConfigProblem["key"]; const v = inc.get(k) ?? "true";
      if (k === "core.bare" && !/^(true|yes|on|1)$/i.test(v.trim()) && inc.get(k) !== null) continue;
      out.push({ label, repo, config: l.config, key, value: v, why: `${key}=${v} reaches ${l.config} through include.path; reported, not refused`, fix: `Check the files ${l.config} includes`, blocking: false }); } }
  // the checkout's own config.worktree, when the repository turned per-worktree config on
  const ext = cfg(l.config, ["--type=bool", "--get", "extensions.worktreeConfig"]);
  if (ext.ok && ext.out.trim() === "true") { const wcfg = join(l.gitDir, "config.worktree"); if (existsSync(wcfg)) read(wcfg, [real(repo)], " (per-worktree config)"); }
  return out;
}

/** Every listed repository checked once (two paths sharing one git folder are one check), in order. */
export function gitConfigReport(targets: { label: string; path: string | null | undefined }[]): { checked: { label: string; path: string }[]; problems: GitConfigProblem[] } {
  const seen = new Set<string>(); const checked: { label: string; path: string }[] = []; const problems: GitConfigProblem[] = [];
  for (const t of targets) {
    if (!t.path) continue; const l = gitLayout(t.path); if (!l) continue;
    const key = real(l.commonDir); if (seen.has(key)) continue; seen.add(key);
    checked.push({ label: t.label, path: t.path }); const found = sharedGitConfigProblems(t.path, t.label); problems.push(...found);
    if (found.some((p) => p.unchecked)) break; // git hangs: the other repositories would only wait the same way
  }
  return { checked, problems };
}

/** Refused before Studio makes or uses a worktree on a repository whose shared config breaks git: a typed BLOCKED reason, never a cascade of git errors or a retried node error. */
export class SharedGitConfigBroken extends RoundBlocked {
  readonly code = "shared_git_config_broken";
  constructor(readonly problems: GitConfigProblem[]) {
    super(`the shared git config of ${problems[0].repo} is broken (${problems.map((x) => `${x.key}=${x.value}`).join(", ")}): ${problems[0].why}. Studio does not change it; fix it by hand (${problems.map((x) => x.fix).join("; ")}) and retry`);
  }
}
/** Only what makes git itself fail refuses; report-only findings (hooksPath, include-only keys) never block. */
export function assertSharedGitConfig(repo: string) { const p = sharedGitConfigProblems(repo).filter((x) => x.blocking); if (p.length) throw new SharedGitConfigBroken(p); }
