// The live board runs from a fixed release, never from the development checkout.
//
//   bun scripts/live-release.ts deploy [--ref origin/main] [--keep 3] [--no-fetch] [--no-open] [--force]
//   bun scripts/live-release.ts status [--fetch]
//   bun scripts/live-release.ts rollback [--no-open] [--force]
//   bun scripts/live-release.ts stop [--force]
//   bun scripts/live-release.ts prune [--keep 3]
//   common: --repo <dev checkout> --root <releases dir> --env-from <file> --port <n> --data <dir>
//           --runtime-dir <dir> --timeout <seconds>
//
// A release is a detached, locked git worktree of the dev checkout's repository at
// one exact commit: ~/.crew-studio/releases/<sha>. It runs `bun src/main.ts` with the
// release as its working directory (no watch), exactly like the dev checkout does,
// so packs, workflows, public/ and node_modules (Playwright, HyperFrames) resolve
// inside the release. Its settings come from <release>/.env (0600), a copy of the
// operator's .env made at deploy time: Bun loads it from the working directory, and
// Studio already denies its Claude Firstmate edits to that file. The data dir is the
// operator's existing CREW_DATA; it is never inside a release.
//
// The script stops only the process listening on the live port that it started
// itself (live.json: pid + exact command), or a Studio process (`bun src/main.ts`,
// the crew-studio binary) that Studio's own instance discovery (src/instance.ts:
// private launch record + HMAC proof from /api/instance) ties to the live data dir
// and port. Anything else on the port is refused. A releases/<sha> entry is only
// used, written to or pruned when it is a real folder registered by
// `git worktree list` at exactly that path. Deploy, rollback and stop refuse while
// a Task has a step in flight (<data>/runs/*/run.json) unless --force.
// No command prints the env file's contents.
import { closeSync, chmodSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { discoverInstance } from "../src/instance";
import { scrubEnv } from "../src/secure";

const SHA = /^[0-9a-f]{40}$/;
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name: string) => argv.includes(`--${name}`);
const say = (s: string) => console.log(`live-release: ${s}`);
class Refusal extends Error {}

type Run = { ok: boolean; out: string; err: string; code: number | null };
const run = (args: string[], cwd: string, env: Record<string, string | undefined> = baseEnv()): Run => {
  const r = Bun.spawnSync(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { ok: r.success, out: r.stdout.toString().trim(), err: r.stderr.toString().trim(), code: r.exitCode };
};
const git = (cwd: string, ...args: string[]) => run(["git", ...args], cwd);
const must = (r: Run, what: string) => { if (!r.ok) throw new Refusal(`${what} failed: ${r.err.split("\n").slice(-3).join(" ")}`); return r.out; };

// ---- settings ------------------------------------------------------------------
function parseEnv(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const k = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!k) continue;
    let v = k[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, "");
    m.set(k[1], v);
  }
  return m;
}
function devRepo(): string {
  const given = flag("repo");
  if (given) return resolve(given);
  const r = git(process.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!r.ok) throw new Refusal("run this from the Crew Studio dev checkout, or pass --repo");
  return dirname(r.out);
}
type Settings = { repo: string; root: string; envFrom: string; operator: Map<string, string>; envText: string; port: number; data: string; runtimeDir: string; depRoot: string | null; timeout: number; state: string };
function settings(): Settings {
  const repo = devRepo();
  const root = resolve(flag("root") ?? join(homedir(), ".crew-studio", "releases"));
  const envFrom = resolve(flag("env-from") ?? join(repo, ".env"));
  const envText = existsSync(envFrom) ? readFileSync(envFrom, "utf8") : "";
  const operator = parseEnv(envText);
  const abs = (v: string) => isAbsolute(v) ? resolve(v) : resolve(repo, v); // the dev instance resolved them from the checkout
  const port = Number(flag("port") ?? operator.get("CREW_PORT") ?? 4210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Refusal("CREW_PORT is not a valid port");
  const data = abs(flag("data") ?? operator.get("CREW_DATA") ?? join(homedir(), ".crew-studio", "data"));
  const inside = (p: string) => { const r = relative(root, p); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };
  if (inside(data)) throw new Refusal("the data dir may not live inside the releases dir");
  let depRoot = operator.has("CREW_LOCAL_DEPENDENCY_ROOT") ? abs(operator.get("CREW_LOCAL_DEPENDENCY_ROOT")!) : null;
  if (depRoot && inside(depRoot)) { say("CREW_LOCAL_DEPENDENCY_ROOT pointed into a release; using the dev checkout instead"); depRoot = repo; }
  const runtimeDir = resolve(flag("runtime-dir") ?? operator.get("CREW_RUNTIME_DIR") ?? join(homedir(), ".crew-studio", "runtime"));
  const timeout = Number(flag("timeout") ?? 90);
  return { repo, root, envFrom, operator, envText, port, data, runtimeDir, depRoot, timeout, state: join(root, "live.json") };
}

// The child's environment: this shell's, minus every CREW_* variable and every key
// the operator's .env sets (Bun may have loaded the dev checkout's .env into this
// script), so the release reads its own <release>/.env and nothing else.
function baseEnv(s?: Settings): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = scrubEnv();
  for (const k of Object.keys(env)) if (k.startsWith("CREW_") || s?.operator.has(k)) delete env[k];
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  // an inherited --no-env-file or --env-file (a test run, an operator's BUN_OPTIONS) would stop Bun loading <release>/.env
  const opts: string[] = []; const given = (env.BUN_OPTIONS ?? "").split(/\s+/).filter(Boolean);
  for (let i = 0; i < given.length; i++) { if (given[i] === "--env-file") { i++; continue; } if (given[i] === "--no-env-file" || given[i].startsWith("--env-file=")) continue; opts.push(given[i]); }
  if (opts.length) env.BUN_OPTIONS = opts.join(" "); else delete env.BUN_OPTIONS;
  return env;
}

// ---- state -------------------------------------------------------------------------
type Live = { sha: string; pid: number; port: number; data: string; command: string; log: string; startedAt: string };
type State = { schema: 1; live: Live | null; history: string[] };
const readState = (s: Settings): State => { try { const v = JSON.parse(readFileSync(s.state, "utf8")); if (v.schema === 1) return v; } catch {} return { schema: 1, live: null, history: [] }; };
const writeState = (s: Settings, st: State) => { const t = s.state + ".tmp"; writeFileSync(t, JSON.stringify(st, null, 2) + "\n", { mode: 0o600 }); renameSync(t, s.state); };
/** "<pid> <start time>": a lock whose pid now belongs to another process (pid reuse) is stale too. */
const startedOf = (pid: number) => run(["ps", "-o", "lstart=", "-p", String(pid)], "/").out.replace(/\s+/g, " ");
const lockToken = (pid: number) => `${pid} ${startedOf(pid)}`;
const lockHeld = (token: string) => { const pid = Number(token.split(" ")[0]); return Number.isSafeInteger(pid) && pid > 1 && alive(pid) && lockToken(pid) === token; };
function lock(s: Settings) {
  mkdirSync(s.root, { recursive: true, mode: 0o700 });
  const l = join(s.root, ".lock"), guard = l + ".retake", mine = lockToken(process.pid);
  const take = () => { try { writeFileSync(l, mine, { flag: "wx", mode: 0o600 }); return true; } catch { return false; } };
  const holder = () => { try { return readFileSync(l, "utf8"); } catch { return null; } };
  if (!take()) {
    const seen = holder();
    if (seen !== null && lockHeld(seen)) throw new Refusal(`another live-release (pid ${seen.split(" ")[0]}) is running`);
    // Retake a stale lock under an exclusive guard (mkdir is atomic): only the guard holder may
    // unlink, and only the exact stale lock it inspected, so two processes that both saw the
    // stale lock can never unlink each other's fresh one.
    try { mkdirSync(guard, { mode: 0o700 }); } catch { throw new Refusal(`another live-release is taking the lock (remove ${guard} if no live-release is running)`); }
    try {
      const now = holder();
      if (now !== null && (now !== seen || lockHeld(now))) throw new Refusal("another live-release took the lock first");
      if (now !== null) unlinkSync(l);
      if (!take()) throw new Refusal("another live-release took the lock first");
    } finally { try { rmdirSync(guard); } catch {} }
  }
  process.once("exit", () => { try { if (readFileSync(l, "utf8") === mine) unlinkSync(l); } catch {} });
}

// ---- Tasks in flight -----------------------------------------------------------------
/** Tasks with a step in flight, read from <data>/runs/<id>/run.json (read-only). A Task that only waits for a card or an external check is not in flight. */
function activeTasks(s: Settings): string[] {
  const dir = join(s.data, "runs"); let names: string[] = [];
  try { names = readdirSync(dir); } catch { return []; }
  const out: string[] = [];
  for (const n of names.sort()) {
    let r: any; try { r = JSON.parse(readFileSync(join(dir, n, "run.json"), "utf8")); } catch { continue; }
    const running = Object.values(r?.nodes ?? {}).filter((x: any) => x?.state === "running") as any[];
    const inFlight = r?.status === "queued" || (r?.status === "running" && (running.length === 0 || running.some((x) => !x.waiting)));
    if (inFlight) out.push(`${r.id ?? n} (${r.workflow ?? "?"}): ${String(r.title ?? "").replace(/\s+/g, " ").slice(0, 80)}`);
  }
  return out;
}
function refuseWhileTasksRun(s: Settings) {
  if (has("force")) return;
  const a = activeTasks(s);
  if (a.length) throw new Refusal(`Tasks are running, nothing was changed: ${a.join("; ")}. Wait for them, or pass --force to restart anyway (their running steps are interrupted).`);
}

// ---- processes ---------------------------------------------------------------------
/** A process exists and is not a zombie (a zombie still passes kill(pid, 0)). */
const alive = (pid: number) => { try { process.kill(pid, 0); } catch { return false; } return !run(["ps", "-o", "stat=", "-p", String(pid)], "/").out.startsWith("Z"); };
const listeners = (port: number) => run(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], "/").out.split("\n").map(Number).filter((n) => n > 1);
const commandOf = (pid: number) => run(["ps", "-o", "command=", "-p", String(pid)], "/").out;
const cwdOf = (pid: number) => run(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], "/").out.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "?";
/** `bun [flags] src/main.ts` (relative or absolute) or the crew-studio binary serving. */
function studioCommand(command: string): boolean {
  const t = command.trim().split(/\s+/), exe = basename(t[0] ?? "");
  if (exe === "bun") { const rest = t.slice(1).filter((a) => !a.startsWith("-")); return rest.length === 1 && /(^|\/)src\/main\.ts$/.test(rest[0]); }
  return /^crew-studio(-[a-z0-9-]+)?$/.test(exe) && (t.length === 1 || t[1] === "launch");
}
/** Studio's own instance discovery (src/instance.ts: private owned launch records, live pid, HMAC proof from /api/instance), limited to the live data dir and port. The session token it returns is dropped here. */
async function provenInstance(s: Settings): Promise<{ pid: number; data: string; origin: string } | null> {
  const keys = ["CREW_DATA", "CREW_PORT", "CREW_RUNTIME_DIR"] as const, saved = keys.map((k) => process.env[k]);
  process.env.CREW_DATA = s.data; process.env.CREW_PORT = String(s.port); process.env.CREW_RUNTIME_DIR = s.runtimeDir;
  try { const i = await discoverInstance(); return i ? { pid: i.pid, data: i.data, origin: i.origin } : null; }
  catch { return null; }
  finally { keys.forEach((k, n) => { if (saved[n] === undefined) delete process.env[k]; else process.env[k] = saved[n]; }); }
}
async function instancePid(port: number): Promise<number | null> {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/instance`, { signal: AbortSignal.timeout(1500), redirect: "error" }); if (r.status !== 200) return null; const v = await r.json() as any; return Number.isSafeInteger(v?.pid) ? v.pid : null; } catch { return null; }
}
/** Why this script may stop pid, or null when it may not. */
async function owner(pid: number, s: Settings, st: State): Promise<string | null> {
  const command = commandOf(pid);
  if (!command) return null;
  if (st.live && st.live.pid === pid && st.live.command === command && st.live.port === s.port) return `release ${st.live.sha.slice(0, 12)} (started by live-release)`;
  if (!studioCommand(command)) return null;
  const inst = await provenInstance(s);
  if (!inst || inst.pid !== pid || inst.data !== s.data || new URL(inst.origin).port !== String(s.port)) return null;
  return `Studio from ${cwdOf(pid)} serving the live data dir`;
}
async function ownedListener(s: Settings, st: State): Promise<{ pid: number; why: string } | null> {
  const pids = listeners(s.port);
  let found: { pid: number; why: string } | null = null;
  for (const pid of pids) {
    const why = await owner(pid, s, st);
    if (!why) throw new Refusal(`port ${s.port} is held by pid ${pid} (${commandOf(pid) || "unknown"}), which is not the live Studio; nothing was stopped`);
    found = { pid, why };
  }
  return found;
}
async function waitFor(f: () => boolean | Promise<boolean>, seconds: number) { const end = Date.now() + seconds * 1000; while (Date.now() < end) { if (await f()) return true; await Bun.sleep(150); } return false; }

/** What was serving before a switch, so it can be started again. */
type Stopped = { pid: number; why: string; command: string; cwd: string; release: string | null };
async function identify(s: Settings, st: State): Promise<Stopped | null> {
  const o = await ownedListener(s, st);
  if (!o) return null;
  return { ...o, command: commandOf(o.pid), cwd: cwdOf(o.pid), release: st.live && st.live.pid === o.pid ? st.live.sha : null };
}
async function terminate(o: Stopped, s: Settings) {
  say(`stopping pid ${o.pid}: ${o.why}`);
  process.kill(o.pid, "SIGTERM");
  if (!await waitFor(() => !alive(o.pid), 30)) {
    if (commandOf(o.pid) !== o.command) say(`pid ${o.pid} no longer runs ${o.command}; not sending SIGKILL`);
    else { say(`pid ${o.pid} ignored SIGTERM for 30s; sending SIGKILL to that pid only`); try { process.kill(o.pid, "SIGKILL"); } catch {} }
    await waitFor(() => !alive(o.pid), 5);
  }
  if (!await waitFor(() => listeners(s.port).length === 0, 10)) throw new Refusal(`port ${s.port} is still in use after stopping pid ${o.pid}`);
}

let launching: ReturnType<typeof Bun.spawn> | null = null;
/** Start argv detached in cwd (log under <data>/logs) and wait until /api/instance answers 200 with its pid; fail at once if it exits. */
async function launch(argv: string[], cwd: string, env: Record<string, string | undefined>, s: Settings, label: string) {
  const logs = join(s.data, "logs");
  mkdirSync(logs, { recursive: true });
  const log = join(logs, `live-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const fd = openSync(log, "a", 0o600);
  const p = Bun.spawn(argv, { cwd, env, stdio: ["ignore", fd, fd], detached: true });
  launching = p; p.unref(); closeSync(fd);
  const exited = () => p.exitCode !== null || p.signalCode !== null;
  try {
    const up = await waitFor(async () => { if (exited()) throw new Refusal(`${label} exited (${p.exitCode ?? p.signalCode}) before answering on port ${s.port}; see ${log}`); return await instancePid(s.port) === p.pid; }, s.timeout);
    if (!up) throw new Refusal(`${label} did not answer HTTP 200 on port ${s.port} within ${s.timeout}s; see ${log}`);
  } catch (e) {
    if (!exited()) { try { process.kill(p.pid, "SIGTERM"); } catch {} await waitFor(() => exited() || !alive(p.pid), 10); }
    throw e;
  } finally { launching = null; }
  return { pid: p.pid, command: commandOf(p.pid), log };
}
async function start(sha: string, s: Settings): Promise<Live> {
  const rel = checkRelease(sha, s);
  const r = await launch([process.execPath, "src/main.ts"], rel, baseEnv(s), s, sha.slice(0, 12));
  return { sha, pid: r.pid, port: s.port, data: s.data, command: r.command, log: r.log, startedAt: new Date().toISOString() };
}
/** Start a stopped non-release Studio again with its own command and folder (its .env loads from there), on the live port and data dir. */
async function relaunch(o: Stopped, s: Settings) {
  const t = o.command.trim().split(/\s+/);
  // A bare argv0 (no slash) was found on PATH by whoever started it, not in its cwd.
  const exe = basename(t[0]) === "bun" ? (isAbsolute(t[0]) ? t[0] : process.execPath) : t[0].includes("/") ? resolve(o.cwd, t[0]) : Bun.which(t[0]);
  if (!exe) throw new Refusal(`${t[0]} is not on PATH; cannot start the previous instance again`);
  await launch([exe, ...t.slice(1)], o.cwd, { ...baseEnv(s), CREW_DATA: s.data, CREW_PORT: String(s.port), CREW_RUNTIME_DIR: s.runtimeDir }, s, "restored");
}
function openBrowser(sha: string, s: Settings) {
  if (has("no-open")) return;
  const r = run([process.execPath, "src/main.ts", "open"], checkRelease(sha, s), baseEnv(s));
  if (r.out) console.log(r.out);
  if (!r.ok) say("`open` did not request a browser; run `bun src/main.ts open` from the release dir");
}

// ---- releases ----------------------------------------------------------------------
const lexists = (p: string) => { try { lstatSync(p); return true; } catch { return false; } };
const realOr = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** root/<sha> as a release: a real folder (no symlink) inside the releases dir that `git worktree list` registers at exactly that path. Refuses otherwise. */
function checkRelease(sha: string, s: Settings): string {
  const rel = join(s.root, sha);
  if (!SHA.test(sha)) throw new Refusal(`${sha} is not a commit id`);
  let st; try { st = lstatSync(rel); } catch { throw new Refusal(`release ${sha.slice(0, 12)} is gone from ${s.root}`); }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Refusal(`${rel} is a symlink or not a folder; it is not a release and is left alone`);
  const want = join(realpathSync(s.root), sha);
  if (realpathSync(rel) !== want) throw new Refusal(`${rel} resolves outside the releases dir; it is left alone`);
  const listed = must(git(s.repo, "worktree", "list", "--porcelain"), "git worktree list").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => realOr(l.slice(9)));
  if (!listed.includes(want)) throw new Refusal(`${rel} is not a registered worktree of ${s.repo}; it is not a release and is left alone`);
  return rel;
}
/** checkRelease plus the folder's identity, so a later write or removal can prove rel was not swapped (say, for a symlink) in between. */
function pinRelease(sha: string, s: Settings) {
  const rel = checkRelease(sha, s), st = lstatSync(rel), real = realpathSync(rel);
  const still = (when: string) => {
    let now; try { now = lstatSync(rel); } catch { now = null; }
    if (!now || now.isSymbolicLink() || !now.isDirectory() || now.dev !== st.dev || now.ino !== st.ino || realOr(rel) !== real) throw new Refusal(`${rel} changed ${when}; it is left alone`);
  };
  return { rel, still };
}
function verifyRelease(rel: string, sha: string) {
  if (must(git(rel, "rev-parse", "HEAD"), "reading the release HEAD") !== sha) throw new Refusal(`${rel} is not at ${sha}`);
  const dirty = must(git(rel, "status", "--porcelain", "--untracked-files=all"), "checking the release is clean");
  if (dirty) throw new Refusal(`${rel} has changes that are not in ${sha.slice(0, 12)}`);
  const v = run([process.execPath, "src/main.ts", "--version"], rel);
  if (!v.ok) throw new Refusal(`release ${sha.slice(0, 12)} does not start: ${v.err.split("\n").slice(-2).join(" ")}`);
}
function buildRelease(sha: string, s: Settings): string {
  const rel = join(s.root, sha);
  if (!lexists(rel)) {
    must(git(s.repo, "worktree", "add", "--detach", rel, sha), "git worktree add");
    git(s.repo, "worktree", "lock", "--reason", "crew-studio live release", rel);
    say(`release ${sha.slice(0, 12)} checked out at ${rel}`);
  } else say(`release ${sha.slice(0, 12)} already at ${rel}; verifying it`);
  checkRelease(sha, s);
  if (existsSync(join(rel, "bun.lock")) || existsSync(join(rel, "bun.lockb"))) must(run([process.execPath, "install", "--frozen-lockfile"], rel), "bun install --frozen-lockfile");
  verifyRelease(rel, sha);
  return rel;
}
/** <release>/.env, 0600: the operator's .env with CREW_DATA, CREW_PORT and CREW_LOCAL_DEPENDENCY_ROOT made absolute. Never printed. */
function writeReleaseEnv(sha: string, s: Settings) {
  const { rel, still } = pinRelease(sha, s);
  const managed = new Set(["CREW_DATA", "CREW_PORT", "CREW_LOCAL_DEPENDENCY_ROOT"]);
  const kept = s.envText.split(/\r?\n/).filter((l) => { const k = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); return !k || !managed.has(k[1]); });
  const q = (v: string) => /^[A-Za-z0-9_./:@+-]*$/.test(v) ? v : JSON.stringify(v);
  const lines = [...kept, `# written by scripts/live-release.ts for ${sha} from ${basename(s.envFrom)}`, `CREW_DATA=${q(s.data)}`, `CREW_PORT=${s.port}`, ...(s.depRoot ? [`CREW_LOCAL_DEPENDENCY_ROOT=${q(s.depRoot)}`] : [])];
  const file = join(rel, ".env"), tmp = file + ".tmp";
  try { unlinkSync(tmp); } catch {}
  still("before its .env was written");
  writeFileSync(tmp, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600, flag: "wx" });
  chmodSync(tmp, 0o600);
  still("while its .env was written");
  renameSync(tmp, file);
  still("while its .env was written; check where the .env went");
  if (!existsSync(s.envFrom)) say(`no ${s.envFrom}; the release env holds only CREW_DATA and CREW_PORT`);
  const relativeKeys = [...s.operator].filter(([k, v]) => !managed.has(k) && /^\.\.?\//.test(v)).map(([k]) => k);
  if (relativeKeys.length) say(`relative paths now resolve inside the release, not the dev checkout: ${relativeKeys.join(", ")} (make them absolute in ${basename(s.envFrom)})`);
}
function prune(s: Settings, st: State, keep: number) {
  const n = Math.max(1, keep);
  const keepSet = new Set(st.history.slice(-n));
  if (st.live) keepSet.add(st.live.sha);
  for (const d of existsSync(s.root) ? readdirSync(s.root) : []) {
    if (!SHA.test(d) || keepSet.has(d)) continue;
    let rel: string, still: (when: string) => void;
    try { ({ rel, still } = pinRelease(d, s)); } catch (e) { say(`not pruning ${d.slice(0, 12)}: ${(e as Error).message}`); continue; }
    git(s.repo, "worktree", "unlock", rel);
    try { still("before it was pruned"); } catch (e) { say(`not pruning ${d.slice(0, 12)}: ${(e as Error).message}`); continue; }
    const r = git(s.repo, "worktree", "remove", "--force", rel);
    say(r.ok ? `pruned release ${d.slice(0, 12)}` : `could not prune ${d.slice(0, 12)}: ${r.err.split("\n").at(-1)}`);
  }
  st.history = st.history.filter((h) => keepSet.has(h));
}

/** One shell word: plain when safe, single-quoted otherwise. */
const shq = (v: string) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`;
/** Stop the owned live process and start sha. If sha does not come up (or Ctrl-C lands in between), start what was serving before; if that is impossible, say so with the exact command. */
async function switchTo(sha: string, s: Settings, st: State) {
  const before = await identify(s, st);
  const restore = async () => {
    try {
      if (before?.release && before.release !== sha) { st.live = await start(before.release, s); writeState(s, st); say(`started the previous release ${before.release.slice(0, 12)} again`); return; }
      if (before && !before.release) { await relaunch(before, s); say(`started the previous instance again: ${before.command} in ${before.cwd}`); return; }
    } catch (e2) { say((e2 as Error).message); }
    const prev = !before ? "nothing" : before.release ? `release ${before.release}` : `${before.command} in ${before.cwd}`;
    const how = !before ? "bun scripts/live-release.ts deploy" : before.release ? `cd ${shq(join(s.root, before.release))} && ${shq(process.execPath)} src/main.ts` : `cd ${shq(before.cwd)} && ${before.command.trim().split(/\s+/).map(shq).join(" ")}`;
    say(`nothing serves port ${s.port}; previous was ${prev}; restart with: ${how}`);
  };
  // Ctrl-C (or SIGTERM) between stop and start: stop launching, then restore below instead of leaving the port empty.
  let interrupted = false;
  const onSignal = () => { if (interrupted) return; interrupted = true; say("interrupted; will restore what was serving before"); const p = launching; if (p) try { process.kill(p.pid, "SIGTERM"); } catch {} };
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
  try {
    // deploy checked for running Tasks before fetch, worktree add, bun install and verify, which
    // can take minutes; a Task queued meanwhile would have its step interrupted by the stop below.
    refuseWhileTasksRun(s);
    if (before) await terminate(before, s);
    st.live = null; writeState(s, st);
    try {
      if (interrupted) throw new Refusal("interrupted before the new release started");
      st.live = await start(sha, s); writeState(s, st);
      if (interrupted) { const p = st.live.pid; try { process.kill(p, "SIGTERM"); } catch {} await waitFor(() => !alive(p), 10); st.live = null; writeState(s, st); throw new Refusal("interrupted"); }
    } catch (e) { say((e as Error).message); await restore(); if (interrupted) process.exit(130); throw e; }
  } finally { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); }
  say(`live: ${sha} pid ${st.live!.pid} on http://127.0.0.1:${s.port} (data ${s.data}); log ${st.live!.log}`);
}

// ---- commands ----------------------------------------------------------------------
async function deploy() {
  const s = settings(); lock(s);
  const st = readState(s);
  const ref = flag("ref") ?? "origin/main";
  refuseWhileTasksRun(s);
  await ownedListener(s, st); // refuse early when the port belongs to someone else
  if (/^origin\//.test(ref) && !has("no-fetch")) must(git(s.repo, "fetch", "--quiet", "origin"), "git fetch origin");
  const sha = must(git(s.repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`), `resolving ${ref}`);
  if (!SHA.test(sha)) throw new Refusal(`${ref} did not resolve to one commit`);
  say(`${ref} is ${sha}`);
  buildRelease(sha, s);
  writeReleaseEnv(sha, s);
  await switchTo(sha, s, st);
  st.history = [...st.history.filter((h) => h !== sha), sha];
  prune(s, st, Number(flag("keep") ?? 3));
  writeState(s, st);
  openBrowser(sha, s);
}
async function rollback() {
  const s = settings(); lock(s);
  const st = readState(s);
  const current = st.live?.sha ?? st.history.at(-1);
  const older = st.history.filter((h) => h !== current);
  const prev = older.at(-1);
  refuseWhileTasksRun(s);
  if (!prev) throw new Refusal("no previous release to roll back to");
  const rel = checkRelease(prev, s);
  verifyRelease(rel, prev);
  if (!lexists(join(rel, ".env"))) writeReleaseEnv(prev, s);
  await switchTo(prev, s, st);
  st.history = [...older];
  writeState(s, st);
  openBrowser(prev, s);
}
async function stop() {
  const s = settings(); lock(s);
  const st = readState(s);
  refuseWhileTasksRun(s);
  const o = await identify(s, st);
  if (o) await terminate(o, s);
  st.live = null; writeState(s, st);
  say(`nothing serves port ${s.port} now`);
}
async function status() {
  const s = settings(); const st = readState(s);
  if (has("fetch")) git(s.repo, "fetch", "--quiet", "origin");
  const pids = listeners(s.port);
  const lines: string[] = [];
  const liveSha = st.live?.sha ?? null;
  const subject = (sha: string) => git(s.repo, "log", "-1", "--format=%s", sha).out;
  lines.push(`live release: ${liveSha ? `${liveSha} (${subject(liveSha)})` : "none recorded"}`);
  if (liveSha) lines.push(`release dir:  ${join(s.root, liveSha)}`);
  if (!pids.length) lines.push(`process:      none listening on port ${s.port}`);
  for (const pid of pids) {
    const why = await owner(pid, s, st).catch(() => null);
    lines.push(`process:      pid ${pid}, ${why ?? "NOT the live Studio (live-release will not stop it)"}: ${commandOf(pid)}`);
    if (why && !(st.live && st.live.pid === pid)) { const c = cwdOf(pid), h = git(c, "rev-parse", "HEAD"); lines.push(`              not a release: runs from ${c}${h.ok ? ` at ${h.out}` : ""}`); }
  }
  if (st.live && !pids.includes(st.live.pid)) lines.push(`              recorded pid ${st.live.pid} is not listening`);
  lines.push(`port:         ${s.port}`);
  lines.push(`data dir:     ${s.data}`);
  const tasks = activeTasks(s);
  lines.push(`tasks:        ${tasks.length ? `in flight (deploy/rollback/stop refuse without --force): ${tasks.join("; ")}` : "none in flight"}`);
  if (st.live?.log) lines.push(`log:          ${st.live.log}`);
  const om = git(s.repo, "rev-parse", "--verify", "--quiet", "origin/main^{commit}");
  if (!om.ok) lines.push("origin/main:  unknown");
  else if (!liveSha) lines.push(`origin/main:  ${om.out} (nothing live to compare)`);
  else if (om.out === liveSha) lines.push(`origin/main:  ${om.out} - live matches`);
  else if (git(s.repo, "merge-base", "--is-ancestor", liveSha, om.out).ok) lines.push(`origin/main:  ${om.out} - live is behind by ${git(s.repo, "rev-list", "--count", `${liveSha}..${om.out}`).out} commit(s)`);
  else lines.push(`origin/main:  ${om.out} - live differs (not an ancestor)`);
  const rels = existsSync(s.root) ? readdirSync(s.root).filter((d) => SHA.test(d)) : [];
  const order = [...st.history].reverse();
  lines.push(`releases:     ${rels.sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9)).map((d) => `${d.slice(0, 12)}${d === liveSha ? " (live)" : d === order[1] ? " (rollback target)" : ""}`).join(", ") || "none"}`);
  console.log(lines.join("\n"));
}

const usage = "usage: bun scripts/live-release.ts deploy [--ref origin/main] [--keep 3] [--no-fetch] [--no-open] [--force] | status [--fetch] | rollback [--no-open] [--force] | stop [--force] | prune [--keep 3]";
try {
  if (cmd === "deploy") await deploy();
  else if (cmd === "status") await status();
  else if (cmd === "rollback") await rollback();
  else if (cmd === "stop") await stop();
  else if (cmd === "prune") { const s = settings(); lock(s); const st = readState(s); prune(s, st, Number(flag("keep") ?? 3)); writeState(s, st); }
  else { console.log(usage); if (cmd !== "help" && cmd !== "--help") process.exitCode = 2; }
} catch (e) {
  if (e instanceof Refusal) { console.error(`live-release: ${e.message}`); process.exitCode = 1; }
  else throw e;
}
