// Git hygiene for tests: the one place tests scrub inherited GIT_* and check where they build repositories.
// Importing this module removes, from this process's environment (and so from every child it spawns, a
// Studio server included), the variables that point git at another repository or inject config. A test
// run under `git bisect run`, a hook or `git rebase -x` inherits GIT_DIR; on 2026-10-16 a fixture's
// `git init` then re-initialised the checkout's own git folder and wrote core.bare=true into the shared
// .git/config, breaking the checkout and every linked worktree. src/git.ts keeps the same list for Studio.
// A test that runs git config, git init or --bare builds its repositories under checkedTempDir() or
// checks them with assertTempRepo(); tests/git-config-guard.ts fails a test file that does not.
import { mkdtempSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const INHERITED_GIT_VARS = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|QUARANTINE_PATH|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/;
/** Remove inherited repository-pointing GIT_* variables from env (process.env by default); returns the names removed. */
export function scrubGitEnv(env = process.env) { const gone = []; for (const k of Object.keys(env)) if (INHERITED_GIT_VARS.test(k)) { delete env[k]; gone.push(k); } return gone; }
/**
 * At import: when this process inherited any of them, it runs again without them and exits with that run's
 * status. Removing them from process.env alone is not enough: Bun starts children with the environment the
 * process began with (Bun 1.3: `delete process.env.GIT_DIR` does not reach Bun.spawnSync or
 * child_process.spawnSync without an explicit env), so only a clean start keeps every child clean.
 */
export const scrubbedAtImport = (() => {
  const gone = Object.keys(process.env).filter((k) => INHERITED_GIT_VARS.test(k)); if (!gone.length) return [];
  if (process.argv[1] && process.env.CREW_GIT_HYGIENE_REEXEC !== "0") {
    const env = { ...process.env }; scrubGitEnv(env);
    const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { env, stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
  scrubGitEnv(); return gone;
})();

/** This test tree's own checkout: a temporary repository is never inside it. */
export const STUDIO_CHECKOUT = (() => { const p = fileURLToPath(new URL("../..", import.meta.url)); try { return realpathSync(p); } catch { return resolve(p); } })();
const realOf = (p) => { let d = resolve(p); const tail = []; while (!existsSync(d)) { const up = dirname(d); if (up === d) break; tail.unshift(basename(d)); d = up; } let r = d; try { r = realpathSync(d); } catch {} return tail.length ? join(r, ...tail) : r; };
const within = (root, p) => { const r = relative(root, p); return r === "" || (!!r && r !== ".." && !r.startsWith("../") && !isAbsolute(r)); };
const TEMP_ROOTS = [...new Set([tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"].map((p) => { try { return realpathSync(p); } catch { return null; } }).filter(Boolean))];

/**
 * A path a test may build a repository in (or run git config / git init in): non-empty, absolute, strictly
 * under a temporary folder, not inside this checkout, and not inside any other repository's working tree.
 * Throws otherwise; returns its real path.
 */
export function assertTempRepo(path, what = "temporary repository") {
  if (typeof path !== "string" || !path.trim() || !isAbsolute(path)) throw new Error(`${what}: refusing an empty or relative path (${JSON.stringify(path)}): git would run in the current folder`);
  const real = realOf(path);
  if (!TEMP_ROOTS.some((t) => t !== real && within(t, real))) throw new Error(`${what}: ${real} is not under a temporary folder (${TEMP_ROOTS.join(", ")})`);
  if (within(STUDIO_CHECKOUT, real) || within(real, STUDIO_CHECKOUT)) throw new Error(`${what}: ${real} overlaps this checkout (${STUDIO_CHECKOUT})`);
  // the nearest existing folder must not sit in someone else's working tree (its own repository is fine)
  let d = real; while (!existsSync(d)) d = dirname(d);
  const env = { ...process.env }; scrubGitEnv(env);
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: d, env, encoding: "utf8" });
  if (top.status === 0) { const t = realOf(top.stdout.trim()); if (t !== real && !within(real, t)) throw new Error(`${what}: ${real} is inside the working tree of ${t}`); }
  return real;
}
/** mkdtemp under the system temporary folder, checked with assertTempRepo. */
export function checkedTempDir(prefix) {
  if (typeof prefix !== "string" || !prefix || prefix.includes("/")) throw new Error(`checkedTempDir: a plain name prefix, not ${JSON.stringify(prefix)}`);
  const d = mkdtempSync(join(tmpdir(), prefix)); assertTempRepo(d, "temporary directory"); return d;
}
