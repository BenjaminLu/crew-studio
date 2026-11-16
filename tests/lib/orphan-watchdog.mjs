// A test entry whose parent is gone has no one left to read its result, stop it or clean up after it, yet it can
// spin for days (2026-11-13: four `bun tests/voice.ts` left by an agent that had ended ran at ~90% CPU each for
// 14 days). Every test entry starts this through tests/lib/isolated-env.mjs: it looks every pollMs whether the
// parent the entry started with is still alive, and once it is not, stops the entry.
//
// Bun caches process.ppid at start, so it never shows the re-parenting; signal 0 to the parent's pid does (ESRCH
// once it is gone). The timer is unref'd: it never keeps a finished entry alive. An entry started by init itself
// (parent pid 1) has nothing to watch.

import { execFileSync } from "node:child_process";

const POLL_ENV = "CREW_TEST_ORPHAN_POLL_MS";

/** Whether pid is alive: EPERM means alive under another user, ESRCH means gone. */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code !== "ESRCH"; }
}

/**
 * Calls onOrphan once when the parent this process started with is gone. Returns a stop function.
 * @param {{ parent?: number, pollMs?: number, alive?: (pid: number) => boolean, onOrphan?: (parent: number) => void }} o
 */
export function watchParent(o = {}) {
  const parent = o.parent ?? process.ppid;
  if (!parent || parent <= 1) return () => {};
  const pollMs = o.pollMs ?? (Number(process.env[POLL_ENV]) > 0 ? Number(process.env[POLL_ENV]) : 2000);
  const alive = o.alive ?? pidAlive;
  const onOrphan = o.onOrphan ?? ((p) => {
    process.stderr.write(`orphan-watchdog: this test's parent (pid ${p}) is gone; stopping it instead of letting it run on unattended\n`);
    process.exit(124);
  });
  const timer = setInterval(() => {
    if (alive(parent)) return;
    clearInterval(timer);
    onOrphan(parent);
  }, pollMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * When the entry ends, a Studio it started and left running (`src/server.ts` or `src/main.ts`, its direct child) is
 * stopped with SIGTERM. Belt and braces: a Studio stops itself once its starter is gone (src/parent-watch.ts); this
 * only makes it immediate. Only this process's own children are touched.
 */
export function stopLeftServers(o = {}) {
  const self = o.self ?? process.pid;
  let rows = "";
  try { rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }); } catch { return []; }
  const left = [];
  for (const line of rows.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m || Number(m[2]) !== self || !/(?:^|[\s/])src\/(?:server|main)\.ts(?:\s|$)/.test(m[3])) continue;
    try { process.kill(Number(m[1]), "SIGTERM"); left.push(Number(m[1])); } catch {}
  }
  return left;
}
