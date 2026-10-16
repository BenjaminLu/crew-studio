// The live board runs from a fixed release, never from the development checkout.
//
//   bun scripts/live-release.ts deploy [--ref origin/main] [--keep 3] [--no-fetch] [--no-open]
//   bun scripts/live-release.ts status [--fetch]
//   bun scripts/live-release.ts rollback [--no-open]
//   bun scripts/live-release.ts stop
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
// the crew-studio binary) whose launch record names the live data dir and whose
// /api/instance answers with that pid. Anything else on the port is refused.
// No command prints the env file's contents.
import { closeSync, chmodSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

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
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("CREW_") || s?.operator.has(k)) delete env[k];
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  return env;
}

// ---- state -------------------------------------------------------------------------
type Live = { sha: string; pid: number; port: number; data: string; command: string; log: string; startedAt: string };
type State = { schema: 1; live: Live | null; history: string[] };
const readState = (s: Settings): State => { try { const v = JSON.parse(readFileSync(s.state, "utf8")); if (v.schema === 1) return v; } catch {} return { schema: 1, live: null, history: [] }; };
const writeState = (s: Settings, st: State) => { const t = s.state + ".tmp"; writeFileSync(t, JSON.stringify(st, null, 2) + "\n", { mode: 0o600 }); renameSync(t, s.state); };
function lock(s: Settings) {
  mkdirSync(s.root, { recursive: true, mode: 0o700 });
  const l = join(s.root, ".lock");
  try { writeFileSync(l, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch { const pid = Number(readFileSync(l, "utf8")); if (pid && alive(pid)) throw new Refusal(`another live-release (pid ${pid}) is running`); writeFileSync(l, String(process.pid), { mode: 0o600 }); }
  process.once("exit", () => { try { if (readFileSync(l, "utf8") === String(process.pid)) unlinkSync(l); } catch {} });
}

// ---- processes ---------------------------------------------------------------------
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const listeners = (port: number) => run(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], "/").out.split("\n").map(Number).filter((n) => n > 1);
const commandOf = (pid: number) => run(["ps", "-o", "command=", "-p", String(pid)], "/").out;
const cwdOf = (pid: number) => run(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], "/").out.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "?";
/** `bun [flags] src/main.ts` (relative or absolute) or the crew-studio binary serving. */
function studioCommand(command: string): boolean {
  const t = command.trim().split(/\s+/), exe = basename(t[0] ?? "");
  if (exe === "bun") { const rest = t.slice(1).filter((a) => !a.startsWith("-")); return rest.length === 1 && /(^|\/)src\/main\.ts$/.test(rest[0]); }
  return /^crew-studio(-[a-z0-9-]+)?$/.test(exe) && (t.length === 1 || t[1] === "launch");
}
/** Studio's own launch record (CREW_RUNTIME_DIR/<boot>.json): which data dir a pid serves. Never reads the .key files. */
function recordData(pid: number, s: Settings): string | null {
  let names: string[] = []; try { names = readdirSync(s.runtimeDir); } catch { return null; }
  for (const n of names) if (/^[a-f0-9]{48}\.json$/.test(n)) try { const r = JSON.parse(readFileSync(join(s.runtimeDir, n), "utf8")); if (r.pid === pid && new URL(r.origin).port === String(s.port)) return r.data; } catch {}
  return null;
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
  if (recordData(pid, s) !== s.data) return null;
  if (await instancePid(s.port) !== pid) return null;
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
async function stopOwned(s: Settings, st: State) {
  const o = await ownedListener(s, st);
  if (!o) return;
  say(`stopping pid ${o.pid}: ${o.why}`);
  process.kill(o.pid, "SIGTERM");
  if (!await waitFor(() => !alive(o.pid), 30)) { say(`pid ${o.pid} ignored SIGTERM for 30s; sending SIGKILL to that pid only`); try { process.kill(o.pid, "SIGKILL"); } catch {} await waitFor(() => !alive(o.pid), 5); }
  if (!await waitFor(() => listeners(s.port).length === 0, 10)) throw new Refusal(`port ${s.port} is still in use after stopping pid ${o.pid}`);
}
async function start(sha: string, s: Settings): Promise<Live> {
  const rel = join(s.root, sha), logs = join(s.data, "logs");
  mkdirSync(logs, { recursive: true });
  const log = join(logs, `live-${sha.slice(0, 12)}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const fd = openSync(log, "a", 0o600);
  const p = Bun.spawn([process.execPath, "src/main.ts"], { cwd: rel, env: baseEnv(s), stdio: ["ignore", fd, fd], detached: true });
  p.unref(); closeSync(fd);
  const up = await waitFor(async () => p.exitCode === null && await instancePid(s.port) === p.pid, s.timeout);
  if (!up) {
    if (p.exitCode === null) { try { process.kill(p.pid, "SIGTERM"); } catch {} await waitFor(() => !alive(p.pid), 10); }
    throw new Refusal(`release ${sha.slice(0, 12)} did not answer HTTP 200 on port ${s.port} within ${s.timeout}s; see ${log}`);
  }
  return { sha, pid: p.pid, port: s.port, data: s.data, command: commandOf(p.pid), log, startedAt: new Date().toISOString() };
}
function openBrowser(sha: string, s: Settings) {
  if (has("no-open")) return;
  const r = run([process.execPath, "src/main.ts", "open"], join(s.root, sha), baseEnv(s));
  if (r.out) console.log(r.out);
  if (!r.ok) say("`open` did not request a browser; run `bun src/main.ts open` from the release dir");
}

// ---- releases ----------------------------------------------------------------------
function verifyRelease(rel: string, sha: string) {
  if (must(git(rel, "rev-parse", "HEAD"), "reading the release HEAD") !== sha) throw new Refusal(`${rel} is not at ${sha}`);
  const dirty = must(git(rel, "status", "--porcelain", "--untracked-files=all"), "checking the release is clean");
  if (dirty) throw new Refusal(`${rel} has changes that are not in ${sha.slice(0, 12)}`);
  const v = run([process.execPath, "src/main.ts", "--version"], rel);
  if (!v.ok) throw new Refusal(`release ${sha.slice(0, 12)} does not start: ${v.err.split("\n").slice(-2).join(" ")}`);
}
function buildRelease(sha: string, s: Settings): string {
  const rel = join(s.root, sha);
  if (!existsSync(rel)) {
    must(git(s.repo, "worktree", "add", "--detach", rel, sha), "git worktree add");
    git(s.repo, "worktree", "lock", "--reason", "crew-studio live release", rel);
    say(`release ${sha.slice(0, 12)} checked out at ${rel}`);
  } else say(`release ${sha.slice(0, 12)} already at ${rel}; verifying it`);
  if (existsSync(join(rel, "bun.lock")) || existsSync(join(rel, "bun.lockb"))) must(run([process.execPath, "install", "--frozen-lockfile"], rel), "bun install --frozen-lockfile");
  verifyRelease(rel, sha);
  return rel;
}
/** <release>/.env, 0600: the operator's .env with CREW_DATA, CREW_PORT and CREW_LOCAL_DEPENDENCY_ROOT made absolute. Never printed. */
function writeReleaseEnv(sha: string, s: Settings) {
  const managed = new Set(["CREW_DATA", "CREW_PORT", "CREW_LOCAL_DEPENDENCY_ROOT"]);
  const kept = s.envText.split(/\r?\n/).filter((l) => { const k = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); return !k || !managed.has(k[1]); });
  const q = (v: string) => /^[A-Za-z0-9_./:@+-]*$/.test(v) ? v : JSON.stringify(v);
  const lines = [...kept, `# written by scripts/live-release.ts for ${sha} from ${basename(s.envFrom)}`, `CREW_DATA=${q(s.data)}`, `CREW_PORT=${s.port}`, ...(s.depRoot ? [`CREW_LOCAL_DEPENDENCY_ROOT=${q(s.depRoot)}`] : [])];
  const file = join(s.root, sha, ".env"), tmp = file + ".tmp";
  try { unlinkSync(tmp); } catch {}
  writeFileSync(tmp, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600, flag: "wx" });
  chmodSync(tmp, 0o600); renameSync(tmp, file);
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
    const rel = join(s.root, d);
    git(s.repo, "worktree", "unlock", rel);
    git(s.repo, "worktree", "remove", "--force", rel);
    if (existsSync(rel)) rmSync(rel, { recursive: true, force: true });
    say(`pruned release ${d.slice(0, 12)}`);
  }
  st.history = st.history.filter((h) => keepSet.has(h));
}

/** Stop the owned live process, start sha, and fall back to the previous live release when sha does not come up. */
async function switchTo(sha: string, s: Settings, st: State) {
  const before = st.live;
  await stopOwned(s, st);
  st.live = null; writeState(s, st);
  try { st.live = await start(sha, s); writeState(s, st); }
  catch (e) {
    if (before && before.sha !== sha && existsSync(join(s.root, before.sha))) {
      say(`starting the previous release ${before.sha.slice(0, 12)} again`);
      try { st.live = await start(before.sha, s); writeState(s, st); } catch (e2) { say(String((e2 as Error).message)); }
    }
    throw e;
  }
  say(`live: ${sha} pid ${st.live!.pid} on http://127.0.0.1:${s.port} (data ${s.data}); log ${st.live!.log}`);
}

// ---- commands ----------------------------------------------------------------------
async function deploy() {
  const s = settings(); lock(s);
  const st = readState(s);
  const ref = flag("ref") ?? "origin/main";
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
  if (!prev) throw new Refusal("no previous release to roll back to");
  if (!existsSync(join(s.root, prev))) throw new Refusal(`release ${prev.slice(0, 12)} is gone from ${s.root}`);
  verifyRelease(join(s.root, prev), prev);
  if (!existsSync(join(s.root, prev, ".env"))) writeReleaseEnv(prev, s);
  await switchTo(prev, s, st);
  st.history = [...older];
  writeState(s, st);
  openBrowser(prev, s);
}
async function stop() {
  const s = settings(); lock(s);
  const st = readState(s);
  await stopOwned(s, st);
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

const usage = "usage: bun scripts/live-release.ts deploy [--ref origin/main] [--keep 3] [--no-fetch] [--no-open] | status [--fetch] | rollback [--no-open] | stop | prune [--keep 3]";
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
