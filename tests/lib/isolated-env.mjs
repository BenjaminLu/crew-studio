// Every test entry imports this first. Tests never read the operator's local .env.
//
// Bun loads .env from the working directory before any test code runs, so a suite
// started from the captain's checkout would otherwise inherit live settings such as
// CREW_LOCAL_UNRESTRICTED=1, CREW_DATA and CREW_PORT (docs/local-execution.md).
// 1. Values this process got from a .env file are removed: a variable is dropped when
//    its value equals the one a .env file in the working directory or the repository
//    root gives it. A value a test or its parent set differently is kept.
// 2. BUN_OPTIONS gains --no-env-file, so every bun child (bun src/server.ts,
//    bun src/main.ts, helpers) inherits "do not load .env" with the rest of the env.
// 3. CREW_TEST_ENV_ISOLATED=1 tells a child test entry that its parent already did
//    both, so a value the parent set on purpose is never mistaken for a .env value.
// 4. Inherited GIT_DIR, GIT_WORK_TREE and the other repository-pointing GIT_* variables are removed
//    (tests/lib/git-hygiene.mjs lists them): a suite run under `git bisect run` or a hook never points
//    its fixtures' git at the parent's repository (2026-10-16: core.bare=true in the shared config).
// 5. Under Bun the entry then runs itself again in that clean environment (below), once: the restarted
//    run is marked with its parent's pid, which it checks against process.ppid and removes at once, so
//    the mark never reaches (or disarms) a later test this run starts.
// Production (bun src/main.ts, bun run start) never imports this file.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as osConstants } from "node:os";
import { scrubGitEnv } from "./git-hygiene.mjs";

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

const bunOptions = (process.env.BUN_OPTIONS || "").split(/\s+/).filter(Boolean);
const isBun = typeof globalThis.Bun !== "undefined";
const found = dotenvValues();
const loaded = isBun && !bunOptions.includes(NO_ENV) && found.size > 0;
let dropped = 0;
if (!(process.env[MARK] === "1" && !loaded)) {
  for (const [k, vs] of found) if (!KEEP.has(k) && process.env[k] !== undefined && vs.has(process.env[k])) { delete process.env[k]; dropped++; }
}
if (!bunOptions.includes(NO_ENV)) process.env.BUN_OPTIONS = [...bunOptions, NO_ENV].join(" ");
process.env[MARK] = "1";
const gitGone = scrubGitEnv(process.env);
const RESTART = "CREW_TEST_RESTARTED_BY";
const restarted = process.env[RESTART] === String(process.ppid); delete process.env[RESTART];

// Bun starts children with the environment it was launched with (plus its .env),
// not with later process.env edits. So a bun entry that may have loaded a .env (one
// exists in the working directory or the repository root), or that had
// values to drop, runs itself again in the cleaned environment and passes on its
// exit; nothing else in the test has run yet. Node children follow process.env.
if (isBun && !restarted && (loaded || dropped || gitGone.length)) {
  const child = globalThis.Bun.spawn([process.execPath, ...(process.execArgv || []), ...process.argv.slice(1)], { env: { ...process.env, [RESTART]: String(process.pid) }, stdio: ["inherit", "inherit", "inherit"] });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { try { child.kill(sig); } catch {} });
  const code = await child.exited;
  process.exit(child.signalCode ? 128 + (osConstants.signals[child.signalCode] ?? 1) : code);
}
// a restarted run that still sees GIT_* (something outside this guard put them back) has them removed from
// process.env above; it never restarts again
if (restarted && gitGone.length) process.stderr.write(`isolated-env: ${gitGone.join(", ")} came back in the restarted run; removed from process.env\n`);
