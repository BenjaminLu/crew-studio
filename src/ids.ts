// Unique identifiers and short critical sections across processes (fix round 1,
// runtime class "ids", check-runtime#5): an id comes from a counter read and
// written under a lock, never from "count + 1" of what happens to be on disk.
//   <dir>/.seq-<prefix>     the counter     <dir>/.lock-<name>   the lock (a directory: mkdir is atomic)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Run fn while holding a lock directory; a lock older than staleMs is taken over (its holder died). */
export function withLock<T>(dir: string, name: string, fn: () => T, staleMs = 10_000): T {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, `.lock-${name}`);
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > staleMs) { rmdirSync(lock); continue; } } catch {}
      if (Date.now() - t0 > staleMs * 2) throw new Error(`could not take the lock ${lock}`);
      Bun.sleepSync(2);
    }
  }
  try { return fn(); } finally { try { rmdirSync(lock); } catch {} }
}

/**
 * The next id with this prefix in dir: PREFIX-001, PREFIX-002 … The counter starts
 * above the highest id already present (from `existing`, or the dir's entries).
 */
export function allocate(dir: string, prefix: string, o: { width?: number; existing?: () => string[] } = {}): string {
  const width = o.width ?? 3;
  return withLock(dir, `seq-${prefix}`, () => {
    const f = join(dir, `.seq-${prefix}`);
    let n = 0;
    if (existsSync(f)) n = Number(readFileSync(f, "utf8").trim()) || 0;
    else for (const name of o.existing ? o.existing() : readdirSync(dir)) { const m = new RegExp(`^${prefix}-(\\d+)`).exec(name); if (m) n = Math.max(n, Number(m[1])); }
    n++;
    writeFileSync(f, String(n));
    return `${prefix}-${String(n).padStart(width, "0")}`;
  });
}
