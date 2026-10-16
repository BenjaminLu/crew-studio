// Studio's one way to run git. Every git Studio runs gets a controlled config:
// GIT_CONFIG_GLOBAL is a file Studio owns (no signing, no templates), the system
// config is off (GIT_CONFIG_NOSYSTEM), and hooks come from an empty folder Studio
// owns (core.hooksPath), so the captain's own git setup (commit.gpgsign,
// core.hooksPath, init templates) never runs inside Studio's commits.
// Studio never stages with `add -A`: it names the paths it commits.
//   <data>/git/config   the global config Studio's git reads
//   <data>/git/hooks/   empty: no hook runs
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubEnv } from "./secure";

let home: string | null = null; let checked: string | null = null;
/** Studio's data folder holds its git config (the server sets this at start). */
export function setGitHome(dataDir: string) { home = join(dataDir, "git"); checked = null; }
/**
 * Studio's git home: a folder only this user can open (0700), its config written by
 * Studio, its hooks folder empty. Without setGitHome, a fresh private folder with an
 * unpredictable name (never a fixed shared path). Anything else is refused.
 */
export function gitPaths() {
  if (!home) home = mkdtempSync(join(tmpdir(), "crew-git-"));
  const cfg = join(home, "config"), hooks = join(home, "hooks");
  if (checked !== home) {
    mkdirSync(home, { recursive: true, mode: 0o700 }); chmodSync(home, 0o700);
    const st = statSync(home);
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error(`Studio's git home ${home} belongs to another user`);
    mkdirSync(hooks, { recursive: true, mode: 0o700 });
    writeFileSync(cfg, `# Crew Studio's own git config: the captain's global and system config never apply to Studio's git\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = ${hooks}\n`, { mode: 0o600 });
    checked = home;
  }
  if (readdirSync(hooks).length) throw new Error(`Studio's hooks folder (${hooks}) is not empty: Studio's git runs no hook`);
  return { cfg, hooks };
}
export const STUDIO_AUTHOR = { GIT_AUTHOR_NAME: "Crew Studio", GIT_AUTHOR_EMAIL: "crew-studio@localhost", GIT_COMMITTER_NAME: "Crew Studio", GIT_COMMITTER_EMAIL: "crew-studio@localhost" };
/**
 * Variables that point git at another repository or inject config. Inherited from a parent
 * git (a hook, `git bisect run`, `git rebase -x`), they turn `git init` or `git config` in a
 * folder Studio chose into a write to the parent's repository: on 2026-10-16 a test fixture's
 * `git init` under `git bisect run` re-initialised a checkout's git folder with core.bare=true.
 * Studio's git never inherits them (tests/lib/git-hygiene.mjs keeps the same list for tests).
 */
export const INHERITED_GIT_VARS = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|QUARANTINE_PATH|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/;
export function withoutInheritedGit(env: Record<string, string>): Record<string, string> { for (const k of Object.keys(env)) if (INHERITED_GIT_VARS.test(k)) delete env[k]; return env; }
/** The environment of every git Studio runs. */
export function gitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const { cfg } = gitPaths();
  return { ...withoutInheritedGit(scrubEnv()), ...STUDIO_AUTHOR, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", ...extra };
}
/** Studio's git argv: no hook, no fsmonitor command (nothing a worktree's content can make Studio's git run) */
export function gitArgv(args: string[]) { return ["git", "-c", `core.hooksPath=${gitPaths().hooks}`, "-c", "core.fsmonitor=false", ...args]; }
export function git(cwd: string, args: string[], input?: string): { ok: boolean; code: number | null; out: string; err: string; bytes: Uint8Array } {
  const r = Bun.spawnSync(gitArgv(args), { cwd, stdin: input ? new TextEncoder().encode(input) : "ignore", stdout: "pipe", stderr: "pipe", env: gitEnv() });
  return { ok: r.success, code: r.exitCode, out: r.stdout.toString().replace(/\s+$/, ""), err: r.stderr.toString().trim(), bytes: r.stdout };
}
export function must(cwd: string, args: string[]): string { const r = git(cwd, args); if (!r.ok) throw new Error(`git ${args[0]}: ${r.err || r.out}`.slice(0, 500)); return r.out; }
/** The paths a working tree changed (added, modified, deleted, untracked; never ignored ones). */
export function changedPaths(cwd: string): string[] {
  const out = Bun.spawnSync(gitArgv(["status", "--porcelain=v1", "-z", "--untracked-files=all"]), { cwd, stdout: "pipe", stderr: "pipe", env: gitEnv() }).stdout.toString();
  const parts = out.split("\0").filter(Boolean); const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) { const st = parts[i].slice(0, 2); paths.push(parts[i].slice(3)); if (st[0] === "R" || st[0] === "C") paths.push(parts[++i]); }
  return [...new Set(paths)];
}
/** Stage exactly these paths (never `add -A`). */
export function addPaths(cwd: string, paths: string[]) {
  const lit = (p: string) => `:(literal)${p}`;
  // present or gone by lstat: a symlink is a path of its own, even when it points nowhere
  const present = (p: string) => { try { lstatSync(join(cwd, p)); return true; } catch { return false; } };
  const here = paths.filter(present), gone = paths.filter((p) => !present(p));
  if (here.length) must(cwd, ["add", "--all", "--", ...here.map(lit)]);
  if (gone.length) must(cwd, ["rm", "-q", "--cached", "--ignore-unmatch", "-r", "--", ...gone.map(lit)]); // a deletion (staged or not)
}
