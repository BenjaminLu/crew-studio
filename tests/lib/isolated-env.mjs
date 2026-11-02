// Every test entry imports this first. Tests never read the operator's local .env.
//
// Bun loads .env from the working directory before any test code runs, so a suite
// started from the captain's checkout would otherwise inherit live settings such as
// CREW_LOCAL_UNRESTRICTED=1, CREW_DATA and CREW_PORT (docs/local-execution.md).
// 1. A top-level entry (no trusted mark) drops every value it got from a .env file: a variable is
//    dropped when its value equals the one a .env file in the working directory or the repository root
//    gives it, BUN_OPTIONS and the mark included (a .env-sourced BUN_OPTIONS or mark is never trusted).
//    It also clears the operator keys (CREW_LOCAL_UNRESTRICTED, CREW_LOCAL_DEPENDENCY_ROOT, CREW_DATA,
//    CREW_PORT, CREW_GH) and the real Cursor key (CURSOR_API_KEY) even when the shell exported them: a test
//    that needs one sets it itself, in the env it passes its child.
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
// 6. No test reaches the real Claude or Codex CLI (2026-10-18: discovery and auth reads ran the dev machine's
//    `claude` with its keychain login). The outermost entry puts a sentinel folder first on PATH whose `claude`,
//    `codex`, `cursor-agent` and `agent` record the call and fail (exit 97), and defaults CREW_CLAUDE_BIN, CREW_CODEX_BIN,
//    CREW_CURSOR_BIN, CREW_HOST_CLAUDE_BIN, CREW_HOST_CODEX_BIN and CREW_HOST_CURSOR_BIN to a path that does not exist
//    (no CLI installed); a test that needs a CLI points them at its stub. When the run ends, any recorded call fails it (exit 1) and names it.
// 7. Studio's session for the test's own reads: see below.
// Production (bun src/main.ts, bun run start) never imports this file.
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
// a vendor key the operator's shell exports (a real Cursor account): a test that needs a key passes its fixture key itself
const VENDOR_KEYS = ["CURSOR_API_KEY"];
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
if (!trusted) for (const k of [...OPERATOR, ...VENDOR_KEYS]) drop(k);
// recomputed after the drop: what is left of BUN_OPTIONS, without any --env-file, plus --no-env-file
const kept = []; const rest = flags(env.BUN_OPTIONS); let strippedEnvFile = false;
for (let i = 0; i < rest.length; i++) { if (isEnvFileFlag(rest[i])) { strippedEnvFile = true; if (rest[i] === "--env-file") i++; continue; } if (rest[i] !== NO_ENV) kept.push(rest[i]); }
env.BUN_OPTIONS = [...kept, NO_ENV].join(" ");
// a per-run token, so a .env line (even CREW_TEST_ENV_ISOLATED=1) never equals the mark a parent passes on
if (!trusted) env[MARK] = `1-${process.pid}-${Math.random().toString(36).slice(2)}`;
const gitGone = scrubGitEnv(env);
// A suite must never create launch records/probe files in the operator's runtime.
// Nested entries share their parent's explicit runtime; independent suites do not.
const ownRuntime = !trusted ? mkdtempSync(join(tmpdir(), "crew-test-runtime-")) : null;
if (ownRuntime) {
  env.CREW_RUNTIME_DIR = ownRuntime;
  process.on("exit", () => rmSync(ownRuntime, { recursive: true, force: true }));
}
// the review room's local voice (src/voice): no test reads this Mac's real model files or writes its tools folder;
// a test that needs a voice folder sets these itself
for (const [k, v] of [["CREW_VOICE_TOOLS", "voice-tools"], ["CREW_VOICE_MODELS", "voice-models"], ["CREW_VOICE_WARDROBE", null]])
  if (env[k] === undefined) env[k] = v ? join(env.CREW_RUNTIME_DIR || tmpdir(), v) : "none";

// 6. the real-CLI sentinel: installed once, by the outermost entry; nested entries share it (and its record)
const SENTINEL = "CREW_TEST_CLI_SENTINEL";
// a child started with a trimmed env still has the PATH: the sentinel folder first on it is the one to share
const firstOnPath = (env.PATH || "").split(":")[0];
const sentinelOn = /crew-test-cli-sentinel-/.test(firstOnPath) && existsSync(join(firstOnPath, "calls.log"));
if (sentinelOn) env[SENTINEL] = firstOnPath;
const ownSentinel = !sentinelOn && !restarted ? mkdtempSync(join(tmpdir(), "crew-test-cli-sentinel-")) : null;
if (ownSentinel) {
  writeFileSync(join(ownSentinel, "calls.log"), "");
  for (const bin of ["claude", "codex", "cursor-agent", "agent"]) {
    const f = join(ownSentinel, bin), vendor = bin === "claude" || bin === "codex" ? bin.toUpperCase() : "CURSOR";
    writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' "${bin} $* (cwd $PWD)" >> '${join(ownSentinel, "calls.log")}'\necho "isolated-env: a test ran the real ${bin} CLI from PATH; point CREW_${vendor}_BIN or CREW_HOST_${vendor}_BIN at a stub" >&2\nexit 97\n`);
    chmodSync(f, 0o755);
  }
  env.PATH = `${ownSentinel}:${env.PATH || "/usr/bin:/bin"}`; env[SENTINEL] = ownSentinel;
}
for (const k of ["CREW_CLAUDE_BIN", "CREW_CODEX_BIN", "CREW_CURSOR_BIN", "CREW_HOST_CLAUDE_BIN", "CREW_HOST_CODEX_BIN", "CREW_HOST_CURSOR_BIN"])
  if (env[k] === undefined) env[k] = `/nonexistent/crew-test-cli/${k.includes("CLAUDE") ? "claude" : k.includes("CURSOR") ? "cursor-agent" : "codex"}`;
/** The calls the sentinel recorded: each one is a test that ran a real CLI. */
export const sentinelCalls = (dir = env[SENTINEL]) => { try { return readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean); } catch { return []; } };
const sentinelVerdict = (code) => {
  const calls = sentinelCalls(ownSentinel); try { rmSync(ownSentinel, { recursive: true, force: true }); } catch {}
  if (!calls.length) return code;
  process.stderr.write(`isolated-env: FAIL ${calls.length} call(s) reached the real CLI through PATH:\n${calls.slice(0, 20).map((c) => `  ${c}`).join("\n")}\n`);
  return code || 1;
};
// every card a test raises keeps the card contract (src/runtime/card-contract.ts): a violation throws instead of being logged
if (env.CREW_CARD_CONTRACT === undefined) env.CREW_CARD_CONTRACT = "enforce";
// 7. Studio's session for the test's own reads (architecture §10 "Loopback"): every /api and /files read of a Studio needs its
// session, as a sandboxed test run may reach its port. A test plays the captain's own scripts, which hold the token
// (data/session-token): the run gets one session token (inherited by every Studio it starts unless the test sets its own),
// and a GET or HEAD this process sends to a loopback address without x-crew-session, a cookie, a tool token or an
// Authorization header carries the current CREW_SESSION_TOKEN. Writes are untouched: a test sends their session itself, so
// the refusal of a write without one stays tested; a test that checks a read is refused sends x-crew-session: "" itself.
if (env.CREW_SESSION_TOKEN === undefined) env.CREW_SESSION_TOKEN = `crew-test-session-${process.pid}-${Math.random().toString(36).slice(2)}`;
if (typeof globalThis.fetch === "function" && !globalThis.fetch.__crewSession) {
  const realFetch = globalThis.fetch;
  const withSession = (input, init) => {
    try {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = String(init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input.method : "GET") ?? "GET").toUpperCase();
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["GET", "HEAD"].includes(method) || !process.env.CREW_SESSION_TOKEN) return realFetch(input, init);
      const headers = new Headers(init?.headers ?? (typeof input === "object" && !(input instanceof URL) ? input.headers : undefined));
      if (["x-crew-session", "cookie", "x-crew-tool-token", "authorization"].some((h) => headers.has(h))) return realFetch(input, init);
      headers.set("x-crew-session", process.env.CREW_SESSION_TOKEN);
      return realFetch(input, { ...(init ?? {}), headers });
    } catch { return realFetch(input, init); }
  };
  withSession.__crewSession = true;
  globalThis.fetch = withSession;
}

// Bun starts children with the environment it was launched with (plus its .env),
// not with later process.env edits. So a bun entry that may have loaded a .env (one
// exists in the working directory or the repository root), or that had
// values to drop, runs itself again in the cleaned environment and passes on its
// exit (signals forwarded); nothing else in the test has run yet. Node children follow process.env.
// (the outermost Bun entry always runs again: its children must see the sentinel PATH, and it reads the record at the end)
if (isBun && !restarted && (loaded || dropped || strippedEnvFile || gitGone.length || ownSentinel)) {
  const child = globalThis.Bun.spawn([process.execPath, ...(process.execArgv || []), ...process.argv.slice(1)], { env: { ...env, [RESTART]: String(process.pid) }, stdio: ["inherit", "inherit", "inherit"] });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { try { child.kill(sig); } catch {} });
  const code = await child.exited;
  const exit = child.signalCode ? 128 + (osConstants.signals[child.signalCode] ?? 1) : code;
  process.exit(ownSentinel ? sentinelVerdict(exit) : exit);
}
// a Node entry's children follow process.env: it reads the record when it exits
if (ownSentinel) process.on("exit", (code) => { process.exitCode = sentinelVerdict(process.exitCode ?? code); });
