// A Studio does not outlive whoever started it, unless it was started detached on purpose (docs/setup-and-reference.md,
// "Studio's lifetime"). 2026-11-16: 53 `bun src/server.ts` left by test suites and agents whose starter had died ran on
// under launchd, the oldest for 27 days, each holding its ports.
//
// The process that started this one is read at start. Every pollMs, signal 0 to that pid tells whether it is still
// there (ESRCH: gone; EPERM: alive under another user). Bun caches process.ppid at start, so it never shows the
// re-parenting to launchd; the signal does. Once the starter is gone, onGone runs once (server.ts: the SIGTERM shutdown).
//
// Nothing is watched when:
//   - the starter is init/launchd itself (parent pid 1): nothing will go away;
//   - CREW_DETACHED names the starter's pid: the starter detached it on purpose and will exit (scripts/live-release.ts,
//     the live board). The marker names a pid so it is never inherited: a process this Studio starts with its default
//     env (Bun children get the env Bun started with) has another parent, so the same value does not exempt it.
// The timer is unref'd: it never keeps a stopping Studio alive.

export const DETACHED_ENV = "CREW_DETACHED";
export const POLL_ENV = "CREW_PARENT_POLL_MS";

/** The starter's pid, read before anything else in this process. */
export const STARTED_BY = process.ppid;
const marker = process.env[DETACHED_ENV];
delete process.env[DETACHED_ENV]; // explicit child envs built from process.env never carry it on

/** Whether pid is alive: EPERM means alive under another user, ESRCH means gone. */
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code !== "ESRCH"; }
}

/** Why this process has no starter to watch, or null when it does. */
export function exemption(parent: number, mark: string | undefined): string | null {
  if (!parent || parent <= 1) return "started by init (parent pid 1)";
  if (mark && mark === String(parent)) return `started detached on purpose by pid ${parent} (${DETACHED_ENV})`;
  return null;
}

export type WatchOpts = { parent?: number; mark?: string; pollMs?: number; alive?: (pid: number) => boolean; onGone: (parent: number) => void };
/** Calls onGone once when the starter is gone. Returns why it watches nothing (or null) and a stop function. */
export function watchStarter(o: WatchOpts): { exempt: string | null; stop: () => void } {
  const parent = o.parent ?? STARTED_BY;
  const exempt = exemption(parent, "mark" in o ? o.mark : marker);
  if (exempt) return { exempt, stop: () => {} };
  const fromEnv = Number(process.env[POLL_ENV]);
  const pollMs = o.pollMs ?? (fromEnv > 0 ? fromEnv : 2000);
  const alive = o.alive ?? pidAlive;
  const timer = setInterval(() => {
    if (alive(parent)) return;
    clearInterval(timer);
    o.onGone(parent);
  }, pollMs);
  timer.unref?.();
  return { exempt: null, stop: () => clearInterval(timer) };
}
