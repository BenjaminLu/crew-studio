// A cross-process lock that records its owner, for long critical sections such as package adoption.
//   <dir>/.lock-<name>/owner.json   {pid, boot, token}   (the lock is a directory: mkdir is atomic)
// Unlike withLock (src/ids.ts), age alone never breaks it: a contender takes it over only when the owner process
// is gone, or when the owner has not refreshed it for staleMs. The owner refreshes it while it works and removes
// it only while the recorded token is still its own.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withLock } from "./ids";

const BOOT = randomBytes(12).toString("hex");
const OWNER = "owner.json";
/** A lock directory without an owner record (crash between mkdir and the write, or an older Studio) is broken after this. */
const UNOWNED_MS = 10_000;
type Owner = { pid: number; boot: string; token: string };

export class LockLost extends Error {}
export type HeldLock = { refresh(): void; release(): void };

function readOwner(lock: string): Owner | null {
  try {
    const v = JSON.parse(readFileSync(join(lock, OWNER), "utf8"));
    if (Number.isSafeInteger(v?.pid) && v.pid > 0 && typeof v.boot === "string" && typeof v.token === "string") return v;
  } catch {}
  return null;
}

function ownerGone(o: Owner): boolean {
  if (o.pid === process.pid) return o.boot !== BOOT;
  try { process.kill(o.pid, 0); return false; } catch (e: any) { return e?.code === "ESRCH"; }
}

function abandoned(lock: string, staleMs: number): { ino: number; token: string | null } | null {
  let st;
  try { st = statSync(lock); } catch { return null; }
  const owner = readOwner(lock), age = Date.now() - st.mtimeMs;
  if (owner ? ownerGone(owner) || age > staleMs : age > UNOWNED_MS) return { ino: st.ino, token: owner?.token ?? null };
  return null;
}

/** Breakers serialize and re-check, so two contenders never both break, and never break a lock retaken in between. */
function breakAbandoned(dir: string, name: string, lock: string, staleMs: number): boolean {
  if (!abandoned(lock, staleMs)) return false;
  return withLock(dir, `${name}-break`, () => {
    const seen = abandoned(lock, staleMs);
    if (!seen) return false;
    try { if (statSync(lock).ino !== seen.ino || (readOwner(lock)?.token ?? null) !== seen.token) return false; } catch { return false; }
    try { unlinkSync(join(lock, OWNER)); } catch (e: any) { if (e?.code !== "ENOENT") throw e; }
    rmdirSync(lock);
    return true;
  });
}

/** Take the lock, waiting up to waitMs for a live owner; null when it stays busy. */
export function takeOwnerLock(dir: string, name: string, o: { waitMs: number; staleMs?: number }): HeldLock | null {
  const staleMs = o.staleMs ?? 10 * 60_000, lock = join(dir, `.lock-${name}`), token = randomBytes(12).toString("hex"), t0 = Date.now();
  mkdirSync(dir, { recursive: true });
  for (;;) {
    try { mkdirSync(lock); }
    catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      if (breakAbandoned(dir, name, lock, staleMs)) continue;
      if (Date.now() - t0 >= o.waitMs) return null;
      Bun.sleepSync(20);
      continue;
    }
    try { writeFileSync(join(lock, OWNER), JSON.stringify({ pid: process.pid, boot: BOOT, token }), { flag: "wx", mode: 0o600 }); break; }
    catch (e: any) { if (e?.code !== "ENOENT" && e?.code !== "EEXIST") { try { rmdirSync(lock); } catch {} throw e; } }
  }
  const mine = () => readOwner(lock)?.token === token;
  return {
    refresh() { if (!mine()) throw new LockLost(`lost the lock ${name}`); const now = new Date(); utimesSync(lock, now, now); },
    release() { if (!mine()) return; try { unlinkSync(join(lock, OWNER)); rmdirSync(lock); } catch {} },
  };
}
