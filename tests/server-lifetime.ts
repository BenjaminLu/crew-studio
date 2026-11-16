import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A Studio does not outlive whoever started it (src/parent-watch.ts): the real server, started from a shell that is then
// killed with SIGKILL, shuts itself down and frees its port. One started detached on purpose (CREW_DETACHED naming its
// starter, as scripts/live-release.ts does) keeps running; a marker naming another process exempts nothing.
//                                                                                              bun tests/server-lifetime.ts
import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import { join } from "node:path";
import { suite, sleep } from "./rt-harness";
import { checkedTempDir } from "./lib/git-hygiene.mjs";
import { freePort } from "./boot.mjs";
import { exemption, watchStarter, pidAlive } from "../src/parent-watch";
const { ok, end } = suite("server-lifetime");
const root = join(import.meta.dir, "..");

// ---------- the watch itself ----------
ok(exemption(1, undefined) !== null, "a Studio started by init (parent pid 1) has nothing to watch");
ok(exemption(4242, "4242") !== null, "CREW_DETACHED naming the starter's own pid exempts it");
ok(exemption(4242, undefined) === null && exemption(4242, "1") === null && exemption(4242, "4243") === null,
  "no marker, or one naming another process (an inherited one), exempts nothing");
{ let alive = true; const seen: number[] = [];
  const w = watchStarter({ parent: 4242, mark: undefined, pollMs: 20, alive: () => alive, onGone: (p) => seen.push(p) });
  await sleep(120);
  ok(w.exempt === null && !seen.length, "while the starter is alive nothing happens");
  alive = false; await sleep(120);
  ok(seen.length === 1 && seen[0] === 4242, "once the starter is gone it reports that starter, once", JSON.stringify(seen));
  w.stop(); }
{ const seen: number[] = [];
  const w = watchStarter({ parent: 4242, mark: "4242", pollMs: 10, alive: () => false, onGone: (p) => seen.push(p) });
  await sleep(60);
  ok(w.exempt !== null && !seen.length, "a Studio detached on purpose is never stopped by the watch"); }

// ---------- the real server, its starter killed ----------
const temp = checkedTempDir("crew-server-lifetime-");
const started: number[] = [];
const listening = (port: number) => new Promise<boolean>((resolve) => {
  const c = createConnection({ port, host: "127.0.0.1" });
  c.once("connect", () => { c.destroy(); resolve(true); }); c.once("error", () => resolve(false));
});
const instancePid = async (port: number) => { try { const r = await fetch(`http://127.0.0.1:${port}/api/instance`, { signal: AbortSignal.timeout(1000) }); return r.ok ? (await r.json() as any).pid as number : null; } catch { return null; } };
const until = async (f: () => boolean | Promise<boolean>, ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(100); } return !!(await f()); };

/**
 * `sh -c 'bun src/server.ts & wait'`: the server's parent is the shell, not this test. marker: what CREW_DETACHED says,
 * "$$" being the shell itself (its starter). Returns the shell, the server's pid and port once it answers.
 */
async function startUnderShell(label: string, marker: string | null) {
  const dir = join(temp, label), port = await freePort();
  for (const d of ["home", "data", "state", "project"]) mkdirSync(join(dir, d), { recursive: true });
  const pidFile = join(dir, "server.pid"), log = join(dir, "server.log");
  const mark = marker === null ? "" : `CREW_DETACHED=${marker} `;
  const shell = Bun.spawn(["/bin/sh", "-c", `${mark}"$0" src/server.ts >"$1" 2>&1 & echo $! >"$2"; wait`, process.execPath, log, pidFile], {
    cwd: root, stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, CREW_SESSION_TOKEN: `lifetime-${label}`, CREW_PORT: String(port), CREW_DATA: join(dir, "data"), HOME: join(dir, "home"),
      CREW_FM_STATE: join(dir, "state"), CREW_MAIN_PROJECT: join(dir, "project"), CREW_FILE_ALLOW: dir, CREW_GH: "0", CREW_GH_NO_CLI: "1",
      CREW_CHAT_PROVIDER: "stub", CREW_SANDBOX: "0", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1",
      CREW_PARENT_POLL_MS: "500" } });
  await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim().length > 0, 5000);
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  started.push(pid);
  const up = await until(async () => (await instancePid(port)) === pid || !pidAlive(pid), 45000) && pidAlive(pid);
  if (!up) throw new Error(`${label}: the server did not answer on port ${port}: ${existsSync(log) ? readFileSync(log, "utf8").slice(-1500) : "no log"}`);
  return { shell, pid, port, log };
}
const logOf = (f: string) => existsSync(f) ? readFileSync(f, "utf8").slice(-600) : "no log";

try {
  // 1. no marker: the shell that started it is killed, the server stops and its port is free
  { const s = await startUnderShell("plain", null);
    s.shell.kill("SIGKILL"); await s.shell.exited;
    const gone = await until(() => !pidAlive(s.pid), 10000);
    ok(gone, "a server whose starter was killed with SIGKILL exits within 10 s", logOf(s.log));
    ok(gone && !(await listening(s.port)), "and its port is free again");
    ok(/process that started this Studio \(pid \d+\) is gone/.test(logOf(s.log)), "it says in its log why it stopped", logOf(s.log)); }

  // 2. a marker that names another process (one a Studio's own child would inherit) exempts nothing
  { const s = await startUnderShell("inherited", String(process.pid));
    s.shell.kill("SIGKILL"); await s.shell.exited;
    ok(await until(() => !pidAlive(s.pid), 10000), "a server whose CREW_DETACHED names another process still stops with its starter", logOf(s.log)); }

  // 3. detached on purpose (CREW_DETACHED names the shell that started it): it outlives that shell
  { const s = await startUnderShell("detached", "$$");
    s.shell.kill("SIGKILL"); await s.shell.exited;
    await sleep(4000); // eight polls at 500 ms
    ok(pidAlive(s.pid) && (await instancePid(s.port)) === s.pid, "a server started detached on purpose keeps serving after its starter is gone", logOf(s.log));
    process.kill(s.pid, "SIGTERM");
    ok(await until(() => !pidAlive(s.pid), 15000), "and stops on SIGTERM"); }

  // 4. belt and braces (tests/lib/isolated-env.mjs): a test entry that ends with a Studio of its own still running stops
  //    it then, without waiting for the Studio's own watch. The stand-in Studio here has no watch of its own.
  { const dir = join(temp, "left"), pids = join(dir, "pids");
    mkdirSync(join(dir, "src"), { recursive: true });
    const fake = join(dir, "src", "server.ts"); writeFileSync(fake, "setInterval(() => {}, 1000);\n");
    const entry = Bun.spawn([process.execPath, join(root, "tests/fixture/leaves-server.ts"), fake, pids], { cwd: root, stdio: ["ignore", "ignore", "inherit"],
      env: { PATH: (process.env.PATH || "").split(":").filter((d) => !/crew-test-cli-sentinel-/.test(d)).join(":"), HOME: process.env.HOME ?? "", TMPDIR: tmpdir() } });
    await entry.exited;
    const [pid] = existsSync(pids) ? readFileSync(pids, "utf8").split("\n").filter(Boolean).map(Number) : [];
    if (pid) started.push(pid);
    ok(!!pid && await until(() => !pidAlive(pid), 3000), "a Studio a test entry left running is stopped when that entry ends", String(pid)); }
} catch (e) {
  ok(false, String((e as any)?.stack ?? e));
} finally {
  // only a pid this test started that still runs src/server.ts (never a reused pid)
  const ours = (pid: number) => pidAlive(pid) && /src\/server\.ts/.test(Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString());
  for (const pid of started) if (ours(pid)) { try { process.kill(pid, "SIGTERM"); } catch {} }
  await until(() => !started.some(ours), 10000);
  for (const pid of started) if (ours(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  rmSync(temp, { recursive: true, force: true });
}
end();
