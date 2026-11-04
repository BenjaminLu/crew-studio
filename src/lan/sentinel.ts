// A store's sentinel (docs/units/lan-relay.md): a small file beside an always-open store (lan/taint.db, lan/spend.db)
// saying the store was made and the most it ever held. A store that is gone while its sentinel is there, or that holds
// less than its sentinel says (an older copy restored, a partial cleanup), is broken: Studio refuses what it guards
// instead of starting again from empty. The sentinel lives apart from the relay's store, which a replace may move aside.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";

export type SentinelState = { v: 1; created: string; high: number };
export class Sentinel {
  constructor(readonly path: string) {}
  /** what it says, or null when there is none; throws when it is there but cannot be read (the caller fails closed) */
  read(): SentinelState | null {
    if (!existsSync(this.path)) return null;
    const j = JSON.parse(readFileSync(this.path, "utf8"));
    if (!j || j.v !== 1 || !Number.isSafeInteger(j.high) || j.high < 0 || typeof j.created !== "string") throw new Error(`${this.path} is not a sentinel Studio wrote`);
    return j;
  }
  /** written to a temporary file, synced, renamed into place: never a half-written sentinel */
  write(s: SentinelState) {
    const tmp = `${this.path}.${process.pid}.tmp`, fd = openSync(tmp, "w", 0o600);
    try { writeSync(fd, JSON.stringify(s)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
  }
  /** raise the high-water mark to `n` (never lowers it) */
  raise(n: number) { const s = this.read(); if (!s) throw new Error(`${this.path} is missing`); if (n > s.high) this.write({ ...s, high: n }); }
}
/** Before a guarded store is opened (an open would make it again, empty): it is missing though its sentinel says Studio
 *  made it. Throws with the reason (the caller fails closed). */
export function checkNotMissing(sen: Sentinel, existed: boolean, what: string) {
  const s = sen.read(); if (s && !existed) throw new Error(`${what} is missing, though Studio made it on ${s.created} (it was deleted, or not restored with the rest)`);
}
/** Once it is open: it holds fewer records than it once did (an older copy, a partial cleanup). A store with no sentinel
 *  yet (new, or made before sentinels) gets one. Throws with the reason. */
export function checkHeld(sen: Sentinel, held: number, what: string) {
  const s = sen.read();
  if (s && held < s.high) throw new Error(`${what} holds fewer records (${held}) than it once did (${s.high}): an older copy was restored, or part of it was removed`);
  if (!s) sen.write({ v: 1, created: new Date().toISOString(), high: held });
}
