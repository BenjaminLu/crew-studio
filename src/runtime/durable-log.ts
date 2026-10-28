// Append-only JSON-lines files that survive a crash (a run's events.jsonl, a run's evidence ledger).
//
// Writing: one call is one write(2) of every line it is given, then one fsync, on a descriptor opened for that call
// (open, append, fsync, close). A run's commit hands all of its events to one call, so a commit costs one fsync however
// many events it records. A write that fails part way (a full disk) is cut back to the size the file had before it, so
// a failed write never leaves half a line for the next one to land behind. The first write of a new file also syncs its
// folder, so the file itself survives the crash. Opening per call (not one descriptor kept per run) keeps no descriptor
// open across a run's deletion, a second engine over the same data (tests, recovery) or thousands of ended runs; the
// open and close cost microseconds next to the fsync.
//
// Framing: one event per line. A call of several lines marks its first line with `tx: <count>`, so a reader can tell
// that a crash kept only part of a call (a power cut can persist a prefix of one write) and drop that part.
//
// Reading (readLog): a torn tail (the last line has no newline and is not JSON, or a call whose lines are not all
// there) is dropped and reported as `torn`; the next writer cuts it off first (repairTail). Any other line that is not
// JSON is `corrupt`: the reader stops before it and says where. Nothing after a corrupt line is folded.
import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/** The file operations the writer uses, as one object so a test can watch them (fsync is called, once per write). */
export const durableFs = { openSync, writeSync, fsyncSync, closeSync, fstatSync, ftruncateSync };

function syncDir(dir: string) {
  // a folder's entry (a new file, a rename) is durable once the folder is synced; some filesystems refuse a folder fsync
  let fd: number | null = null;
  try { fd = durableFs.openSync(dir, "r"); durableFs.fsyncSync(fd); } catch {} finally { if (fd !== null) try { durableFs.closeSync(fd); } catch {} }
}

/** Append lines (without their newlines) as one write and one fsync. `sync: false` writes once without the fsync (the next synced write covers it). */
export function appendLines(file: string, lines: string[], o: { sync?: boolean } = {}) {
  if (!lines.length) return;
  const created = !existsSync(file);
  const buf = Buffer.from(lines.map((l) => l + "\n").join(""));
  const fd = durableFs.openSync(file, "a");
  try {
    const size = durableFs.fstatSync(fd).size;
    try { let off = 0; while (off < buf.length) off += durableFs.writeSync(fd, buf, off, buf.length - off); }
    catch (e) { try { durableFs.ftruncateSync(fd, size); } catch {} throw e; }
    if (o.sync !== false) durableFs.fsyncSync(fd);
  } finally { durableFs.closeSync(fd); }
  if (created && o.sync !== false) syncDir(dirname(file));
}

/** Replace a file whole: write a temporary copy, fsync it, rename it over the file. A reader sees the old file or the new one. */
export function writeAtomic(file: string, text: string) {
  const tmp = file + ".tmp";
  const fd = durableFs.openSync(tmp, "w");
  try { const buf = Buffer.from(text); let off = 0; while (off < buf.length) off += durableFs.writeSync(fd, buf, off, buf.length - off); durableFs.fsyncSync(fd); }
  finally { durableFs.closeSync(fd); }
  renameSync(tmp, file);
}

export type LogRead = {
  /** the rows before any corrupt line, without a torn tail (the `tx` mark removed) */
  rows: any[];
  /** a tail the reader dropped: the bytes kept, and what was cut */
  torn: { keep: number; bytes: number; lines: number } | null;
  /** the last line was whole JSON with no newline after it: the next writer adds the newline */
  unterminated: boolean;
  /** the first line that is not JSON and is not the tail: its line number (1-based) */
  corrupt: { line: number; text: string } | null;
};

/** Read a JSON-lines text, telling a torn tail (tolerated) from a corrupt line in the middle (a hard stop). */
export function parseLog(raw: string): LogRead {
  const parts = raw.split("\n"); const tail = parts.pop()!; // "" when the text ends with a newline
  const rows: any[] = []; const ends: number[] = []; // the byte offset after each row's newline
  let off = 0, line = 0;
  for (const p of parts) {
    line++; off += Buffer.byteLength(p) + 1;
    if (!p.trim()) continue;
    let v: any; try { v = JSON.parse(p); } catch { return { rows, torn: null, unterminated: false, corrupt: { line, text: p.slice(0, 120) } }; }
    if (!v || typeof v !== "object" || Array.isArray(v)) return { rows, torn: null, unterminated: false, corrupt: { line, text: p.slice(0, 120) } };
    rows.push(v); ends.push(off);
  }
  let torn: LogRead["torn"] = null, unterminated = false;
  if (tail.trim()) {
    let v: any = null; try { v = JSON.parse(tail); } catch {}
    if (v && typeof v === "object" && !Array.isArray(v)) { rows.push(v); ends.push(off + Buffer.byteLength(tail)); unterminated = true; }
    else torn = { keep: off, bytes: Buffer.byteLength(tail), lines: 1 };
  }
  // a write of several lines that a crash kept only in part: drop the part (the call never returned)
  for (let i = rows.length - 1; i >= 0; i--) {
    const n = rows[i].tx; if (!Number.isSafeInteger(n) || n < 2) continue;
    if (i + n > rows.length) {
      const keep = i ? ends[i - 1] : 0, total = Buffer.byteLength(raw);
      torn = { keep, bytes: total - keep, lines: rows.length - i + (torn ? 1 : 0) }; unterminated = false; rows.length = i;
    }
    break;
  }
  for (const r of rows) delete r.tx;
  return { rows, torn, unterminated, corrupt: null };
}

export function readLog(file: string): LogRead {
  if (!existsSync(file)) return { rows: [], torn: null, unterminated: false, corrupt: null };
  return parseLog(readFileSync(file, "utf8"));
}

/** Make the file end cleanly before anything is appended to it: cut a torn tail, or end a whole last line with its newline. */
export function repairTail(file: string, read: LogRead) {
  if (read.corrupt) return;
  if (read.torn) { const fd = durableFs.openSync(file, "r+"); try { durableFs.ftruncateSync(fd, read.torn.keep); durableFs.fsyncSync(fd); } finally { durableFs.closeSync(fd); } }
  else if (read.unterminated) { const fd = durableFs.openSync(file, "a"); try { durableFs.writeSync(fd, "\n"); durableFs.fsyncSync(fd); } finally { durableFs.closeSync(fd); } }
}

/** The ledger's form of repairTail, for a file written one line per call: a whole last line gets its newline, a torn one is cut. Returns the bytes cut. */
export function endCleanly(file: string, raw = existsSync(file) ? readFileSync(file, "utf8") : ""): number {
  if (!raw || raw.endsWith("\n")) return 0;
  const keep = raw.lastIndexOf("\n") + 1, tail = raw.slice(keep);
  let whole = false; try { const v = JSON.parse(tail); whole = !!v && typeof v === "object" && !Array.isArray(v); } catch {}
  if (whole) { repairTail(file, { rows: [], torn: null, unterminated: true, corrupt: null }); return 0; }
  repairTail(file, { rows: [], torn: { keep: Buffer.byteLength(raw.slice(0, keep)), bytes: Buffer.byteLength(tail), lines: 1 }, unterminated: false, corrupt: null });
  return Buffer.byteLength(tail);
}
