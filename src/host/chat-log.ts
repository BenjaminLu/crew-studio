// The Firstmate chat log on disk, so the panel keeps its history across Studio restarts.
//   data/chat-log/log.jsonl     one LogItem per line, appended with one write each (0600, folder 0700)
//   data/chat-log/log.<n>.jsonl rotated when the current file passes maxBytes; the oldest beyond `keep` goes
// Every line is redacted before it is written (credentials never reach the disk). Each item carries the
// primary session it belongs to (host, id, model), so the panel shows earlier sessions as their own blocks.
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { redactJSON } from "../secure";

export class ChatLog {
  readonly dir: string;
  constructor(dataDir: string, readonly maxBytes = 2 * 1024 * 1024, readonly keep = 2) { this.dir = join(dataDir, "chat-log"); }
  private file(n = 0) { return join(this.dir, n ? `log.${n}.jsonl` : "log.jsonl"); }
  private plain(f: string) { try { const st = lstatSync(f); return st.isFile() && !st.isSymbolicLink(); } catch { return false; } }
  private folder() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(this.dir); if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("the chat log folder is not a plain directory");
  }
  /** Append one item (redacted). Never throws: a log that cannot be written must not stop the chat. */
  append(item: unknown): boolean {
    try {
      this.folder();
      const line = Buffer.from(JSON.stringify(redactJSON(item)) + "\n"), f = this.file();
      if (existsSync(f) && !this.plain(f)) return false;
      if (existsSync(f) && statSync(f).size + line.length > this.maxBytes) this.rotate();
      const fd = openSync(f, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        // a partial last line (a write cut short) must not swallow this entry
        const size = fstatSync(fd).size, last = Buffer.alloc(1);
        const torn = size > 0 && (readSync(fd, last, 0, 1, size - 1), last[0] !== 0x0a);
        writeSync(fd, torn ? Buffer.concat([Buffer.from("\n"), line]) : line);
      } finally { closeSync(fd); }
      return true;
    } catch { return false; }
  }
  private rotate() {
    rmSync(this.file(this.keep), { force: true });
    for (let n = this.keep - 1; n >= 0; n--) if (existsSync(this.file(n))) renameSync(this.file(n), this.file(n + 1));
  }
  /** Every attachment id the retained history (all kept files) references: those files stay (src/attachments.ts sweep). */
  referencedIds(): Set<string> {
    const ids = new Set<string>();
    for (const x of this.load(Number.MAX_SAFE_INTEGER)) for (const a of Array.isArray(x.attachments) ? x.attachments : []) if (typeof a?.id === "string") ids.add(a.id);
    return ids;
  }
  /** The newest `limit` items, oldest first, across the rotated files. */
  load(limit = 400): any[] {
    const out: any[] = [];
    for (let n = this.keep; n >= 0; n--) {
      const f = this.file(n); if (!this.plain(f)) continue;
      for (const l of readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue; try { const o = JSON.parse(l); if (o && typeof o.at === "number" && typeof o.kind === "string") out.push(o); } catch {} }
    }
    return out.slice(-limit);
  }
}
