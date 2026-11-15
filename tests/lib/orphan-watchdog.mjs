// A test entry whose parent is gone has no one left to read its result, stop it or clean up after it, yet it can
// spin for days (2026-11-13: four `bun tests/voice.ts` left by an agent that had ended ran at ~90% CPU each for
// 14 days). Every test entry starts this through tests/lib/isolated-env.mjs: it looks every pollMs whether the
// parent the entry started with is still alive, and once it is not, stops the entry.
//
// Bun caches process.ppid at start, so it never shows the re-parenting; signal 0 to the parent's pid does (ESRCH
// once it is gone). The timer is unref'd: it never keeps a finished entry alive. An entry started by init itself
// (parent pid 1) has nothing to watch.

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
