import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A test entry whose parent is gone stops itself (tests/lib/orphan-watchdog.mjs, started by isolated-env), and the run
// it restarted, whose parent that entry is, stops after it. One that still has its parent keeps running.        bun tests/orphan-watchdog.ts
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suite, sleep } from "./rt-harness";
import { watchParent, pidAlive } from "./lib/orphan-watchdog.mjs";
const { ok, end } = suite("orphan-watchdog");
const root = join(import.meta.dir, "..");

// ---------- the watch itself ----------
{ let alive = true; const seen: number[] = [];
  const stop = watchParent({ parent: 4242, pollMs: 20, alive: () => alive, onOrphan: (p) => seen.push(p) });
  await sleep(120);
  ok(!seen.length, "while the parent is alive nothing happens");
  alive = false; await sleep(120);
  ok(seen.length === 1 && seen[0] === 4242, "once the parent is gone it reports that parent, once", JSON.stringify(seen));
  stop(); }
{ const seen: number[] = [];
  watchParent({ parent: 1, pollMs: 10, alive: () => false, onOrphan: (p) => seen.push(p) });
  await sleep(60);
  ok(!seen.length, "an entry started by init (parent 1) has nothing to watch"); }
ok(pidAlive(process.pid) && !pidAlive(2 ** 22 + 12345), "pidAlive: this process is alive, an unused pid is not");

// ---------- a real entry left behind ----------
// The sleeper is started as an outermost entry (no mark, no shared sentinel), so it restarts itself: two runs.
const cleanPath = (process.env.PATH || "").split(":").filter((d) => !/crew-test-cli-sentinel-/.test(d)).join(":");
const runEnv = { PATH: cleanPath, HOME: process.env.HOME ?? "", TMPDIR: tmpdir(), CREW_TEST_ORPHAN_POLL_MS: "200" };
const pidsOf = (f: string) => existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map(Number) : [];
// the outer entry waits on its restarted run inside isolated-env, so only the restarted run reaches the fixture's
// own code and records its pid; the outer entry is that run's parent
const parentOf = (pid: number) => Number(Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(pid)]).stdout.toString().trim()) || 0;
const waitPids = async (f: string) => { for (let i = 0; i < 100 && !pidsOf(f).length; i++) await sleep(50); const [inner] = pidsOf(f); return inner ? [parentOf(inner), inner] : []; };
const sleeper = join(root, "tests/fixture/orphan-sleeper.ts");

{ const dir = mkdtempSync(join(tmpdir(), "crew-orphan-")), f = join(dir, "pids");
  // the shell starts the entry in the background and leaves after a second: the entry's parent is gone
  Bun.spawn(["/bin/sh", "-c", `"${process.execPath}" "${sleeper}" "${f}" >/dev/null 2>&1 & sleep 1`], { env: runEnv, stdio: ["ignore", "ignore", "ignore"] });
  const pids = await waitPids(f);
  ok(pids.length === 2 && pids.every(pidAlive), "the entry and its restarted run are both running while the shell is there", JSON.stringify(pids));
  let gone = false;
  for (let i = 0; i < 100 && !gone; i++) { await sleep(50); gone = pids.every((p) => !pidAlive(p)); }
  ok(gone, "after the shell leaves, the orphaned entry stops itself and takes its restarted run with it", JSON.stringify(pids.map((p) => [p, pidAlive(p)])));
  for (const p of pids) try { process.kill(p, "SIGKILL"); } catch {} }

{ const dir = mkdtempSync(join(tmpdir(), "crew-orphan-")), f = join(dir, "pids");
  const sh = Bun.spawn(["/bin/sh", "-c", `"${process.execPath}" "${sleeper}" "${f}" >/dev/null 2>&1`], { env: runEnv, stdio: ["ignore", "ignore", "ignore"] });
  const pids = await waitPids(f);
  await sleep(1200);
  ok(pids.length === 2 && pids.every(pidAlive), "an entry whose parent is still there keeps running", JSON.stringify(pids));
  for (const p of pids) try { process.kill(p, "SIGKILL"); } catch {}
  sh.kill(); }

end();
