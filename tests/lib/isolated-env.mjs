// Every test entry imports this first. Tests never read the operator's local .env.
//
// Bun loads .env from the working directory before any test code runs, so a suite
// started from the captain's checkout would otherwise inherit live settings such as
// CREW_LOCAL_UNRESTRICTED=1, CREW_DATA and CREW_PORT (docs/local-execution.md).
// 1. A top-level entry (no trusted mark) drops every value it got from a .env file: a variable is
//    dropped when its value equals the one a .env file in the working directory or the repository root
//    gives it, BUN_OPTIONS and the mark included (a .env-sourced BUN_OPTIONS or mark is never trusted).
//    It also clears the operator keys (CREW_LOCAL_UNRESTRICTED, CREW_LOCAL_DEPENDENCY_ROOT, CREW_DATA,
//    CREW_PORT, CREW_GH) even when the shell exported them: a test that needs one sets it itself, in the
//    env it passes its child.
// 2. BUN_OPTIONS (what is left of it) loses every --env-file flag and gains --no-env-file, so every bun
//    child (bun src/server.ts, bun src/main.ts, helpers) inherits "do not load .env" with the rest of the env.
// 3. CREW_TEST_ENV_ISOLATED (a per-run token the guard sets) tells a child test entry that its parent
//    already did both, so a value the parent set on purpose is never mistaken for a .env value. The mark
//    is trusted only when it does not match a .env value; a child test passes on the parent's value.
// 4. Inherited GIT_DIR, GIT_WORK_TREE and the other repository-pointing GIT_* variables are removed
//    (tests/lib/git-hygiene.mjs lists them): a suite run under `git bisect run` or a hook never points
//    its fixtures' git at the parent's repository (2026-10-16: core.bare=true in the shared config).
// 5. Under Bun the entry then runs itself again in that clean environment (below), once, because Bun's
//    children (Bun.spawn, spawnSync, node:child_process) get the environment Bun started with, never later
//    process.env edits. The restarted run is marked with its parent's pid. The mark does reach later
//    processes this run starts with the default env (a child's parent is then not the pid in the mark), so
//    only the process.ppid check makes it harmless: a mark naming anyone but the process's own parent is
//    ignored. A restarted run that still sees a GIT_* variable, a .env value or an --env-file flag (a forged
//    mark, or something that put them back) exits 1: removing them from process.env would not reach its
//    children.
// Production (bun src/main.ts, bun run start) never imports this file.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as osConstants } from "node:os";
import { scrubGitEnv, INHERITED_GIT_VARS } from "./git-hygiene.mjs";

const MARK = "CREW_TEST_ENV_ISOLATED";
// The shell's own basics are never dropped, even when a .env repeats them.
const KEEP = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TERM", "PWD"]);
const NO_ENV = "--no-env-file";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** KEY=value pairs of a dotenv file: comments, `export`, and single, double or back quotes. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'" || q === "`") && v.indexOf(q, 1) > 0) {
      v = v.slice(1, v.indexOf(q, 1));
      if (q === '"') v = v.replace(/\\n/g, "\n");
    } else v = v.replace(/\s+#.*$/, "");
    if (q !== "'") v = v.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, n) => out[n] ?? process.env[n] ?? "");
    out[m[1]] = v;
  }
  return out;
}

/** Every value the .env files Bun would load (working directory and repository root) give. */
export function dotenvValues(dirs = [process.cwd(), repo]) {
  const values = new Map();
  for (const dir of new Set(dirs.map((d) => resolve(d)))) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/^\.env(\.[\w.-]+)?$/.test(name) || /\.(example|sample)$/.test(name)) continue;
      let text = "";
      try { text = readFileSync(join(dir, name), "utf8"); } catch { continue; }
      for (const [k, v] of Object.entries(parseDotenv(text))) {
        if (!values.has(k)) values.set(k, new Set());
        values.get(k).add(v);
      }
    }
  }
  return values;
}

const OPERATOR = ["CREW_LOCAL_UNRESTRICTED", "CREW_LOCAL_DEPENDENCY_ROOT", "CREW_DATA", "CREW_PORT", "CREW_GH"];
const RESTART = "CREW_TEST_RESTARTED_BY";
const env = process.env;
const isBun = typeof globalThis.Bun !== "undefined";
const found = dotenvValues();
const fromDotenv = (k) => env[k] !== undefined && !!found.get(k)?.has(env[k]);
const isEnvFileFlag = (f) => f === "--env-file" || f.startsWith("--env-file=");
const flags = (v) => (v || "").split(/\s+/).filter(Boolean);
const restarted = env[RESTART] === String(process.ppid); delete env[RESTART];

if (restarted) {
  // the parent cleaned this env and set BUN_OPTIONS and the mark itself; anything left here came back
  const left = [...Object.keys(env).filter((k) => INHERITED_GIT_VARS.test(k)),
    ...[...found.keys()].filter((k) => !KEEP.has(k) && k !== MARK && k !== "BUN_OPTIONS" && fromDotenv(k))];
  const opts = flags(env.BUN_OPTIONS);
  if (!opts.includes(NO_ENV)) left.push("BUN_OPTIONS without --no-env-file");
  if (opts.some(isEnvFileFlag)) left.push("BUN_OPTIONS --env-file");
  if (left.length) {
    process.stderr.write(`isolated-env: the restarted test run still has ${left.join(", ")}; its children would inherit them, so it stops here. Run the test from a plain shell (no GIT_* exported, no hand-set ${RESTART}).\n`);
    process.exit(1);
  }
}
const launchOpts = fromDotenv("BUN_OPTIONS") ? [] : flags(env.BUN_OPTIONS); // what Bun itself started with
const trusted = restarted || (!!env[MARK] && !fromDotenv(MARK) && !fromDotenv("BUN_OPTIONS"));
// Bun loaded a .env (or an --env-file) unless it started with --no-env-file
const loaded = isBun && !launchOpts.includes(NO_ENV) && (found.size > 0 || launchOpts.some(isEnvFileFlag));
let dropped = 0;
const drop = (k) => { if (env[k] !== undefined) { delete env[k]; dropped++; } };
if (!trusted || loaded) for (const k of found.keys()) if (!KEEP.has(k) && fromDotenv(k)) drop(k);
if (!trusted) for (const k of OPERATOR) drop(k);
// recomputed after the drop: what is left of BUN_OPTIONS, without any --env-file, plus --no-env-file
const kept = []; const rest = flags(env.BUN_OPTIONS); let strippedEnvFile = false;
for (let i = 0; i < rest.length; i++) { if (isEnvFileFlag(rest[i])) { strippedEnvFile = true; if (rest[i] === "--env-file") i++; continue; } if (rest[i] !== NO_ENV) kept.push(rest[i]); }
env.BUN_OPTIONS = [...kept, NO_ENV].join(" ");
// a per-run token, so a .env line (even CREW_TEST_ENV_ISOLATED=1) never equals the mark a parent passes on
if (!trusted) env[MARK] = `1-${process.pid}-${Math.random().toString(36).slice(2)}`;
const gitGone = scrubGitEnv(env);

// Bun starts children with the environment it was launched with (plus its .env),
// not with later process.env edits. So a bun entry that may have loaded a .env (one
// exists in the working directory or the repository root), or that had
// values to drop, runs itself again in the cleaned environment and passes on its
// exit (signals forwarded); nothing else in the test has run yet. Node children follow process.env.
if (isBun && !restarted && (loaded || dropped || strippedEnvFile || gitGone.length)) {
  const child = globalThis.Bun.spawn([process.execPath, ...(process.execArgv || []), ...process.argv.slice(1)], { env: { ...env, [RESTART]: String(process.pid) }, stdio: ["inherit", "inherit", "inherit"] });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { try { child.kill(sig); } catch {} });
  const code = await child.exited;
  process.exit(child.signalCode ? 128 + (osConstants.signals[child.signalCode] ?? 1) : code);
}
