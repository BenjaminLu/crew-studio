// firstmate's wakes, read (never written) from its wake queue,
// state/session/wake.jsonl - the same items its stop-hook delivers to a
// terminal session. Studio keeps its own cursor and starts at the end, so only
// wakes written after Studio attaches are delivered.
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

/** Port of fm_watch.wake_line: the short reason a queue item wakes firstmate with. */
export function wakeLine(item: any): string {
  if (typeof item?.line === "string" && item.line.trim()) return item.line.split(/\s+/).join(" ").trim();
  const en = item?.summary?.en;
  if (typeof en === "string" && en.trim()) return en.split(/\s+/).join(" ").trim();
  const id = item?.id ?? "?";
  const d = item?.decision && typeof item.decision === "object" ? item.decision : {};
  if (item?.reason === "answered") return `card: ${id} answered ${d.chosen ?? "?"}`;
  if (item?.reason === "merge_settled") return `merge: ${id} ${d.merge ?? "settled"}`;
  return `${item?.reason ?? "wake"}: ${id}`;
}

export class WakeReader {
  private offset: number;
  readonly file: string;
  constructor(stateDir: string, fromStart = false) {
    this.file = join(stateDir, "session", "wake.jsonl");
    this.offset = fromStart || !existsSync(this.file) ? 0 : statSync(this.file).size;
  }
  /** New wake lines since the last read. */
  read(): string[] { return this.readItems().map((w) => w.line); }

  /** New wake items since the last read: the line, and the id and time firstmate acknowledges them by. */
  readItems(): WakeItem[] {
    if (!existsSync(this.file)) return [];
    const size = statSync(this.file).size;
    if (size < this.offset) this.offset = 0; // replaced
    if (size === this.offset) return [];
    const fd = openSync(this.file, "r");
    try {
      const b = Buffer.alloc(Math.min(size - this.offset, 4 << 20));
      const n = readSync(fd, b, 0, b.length, this.offset);
      const text = b.subarray(0, n).toString("utf8");
      const end = text.lastIndexOf("\n") + 1;
      this.offset += Buffer.byteLength(text.slice(0, end));
      const out: WakeItem[] = [];
      for (const l of text.slice(0, end).split("\n")) {
        if (!l.trim()) continue;
        try {
          const o = JSON.parse(l);
          const id = typeof o?.id === "string" ? o.id : "";
          const woken = typeof o?.woken === "number" ? o.woken : 0;
          const line = wakeLine(o);
          out.push({ id, woken, line, key: id ? `${id}@${woken}` : `line:${woken}:${line}` });
        } catch {}
      }
      return out;
    } finally { closeSync(fd); }
  }
}

export type WakeItem = { id: string; woken: number; line: string; key: string };

/** Whether firstmate's own record says this wake was already given to a session
 *  (bin/lib/fm_lifeline.py: state/session/acknowledged/<id>.json, read only).
 *  An unfinished acknowledgement batch counts as not acknowledged, as there. */
export function acknowledged(stateDir: string, id: string, woken: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return false;
  try {
    const tx = JSON.parse(readFileSync(join(stateDir, "session", ".ack-transaction.json"), "utf8"));
    if (tx && typeof tx === "object" && id in tx) { const r = tx[id]; return !!r && typeof r.acknowledged === "number" && r.acknowledged >= woken; }
  } catch {}
  try {
    const r = JSON.parse(readFileSync(join(stateDir, "session", "acknowledged", `${id}.json`), "utf8"));
    return typeof r?.acknowledged === "number" && r.acknowledged >= (woken || 0);
  } catch { return false; }
}
