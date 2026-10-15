// The event log with each event's full data, for the retro. Read-only, read
// incrementally as the file grows. seq numbers match FmState's (the same lines
// are kept: valid JSON with a string type), so #/event/<seq> links line up.
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";

export type RawEv = { seq: number; ts: string; type: string; task: string | null; actor: string; pr: number | null; summary: any; data: any; workflow?: string };

export class RawLog {
  events: RawEv[] = [];
  private offset = 0; private partial = "";
  constructor(readonly file: string) {}
  poll(): RawEv[] {
    if (!existsSync(this.file)) return this.events;
    const fd = openSync(this.file, "r");
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) { this.offset = 0; this.partial = ""; this.events = []; }
      while (this.offset < size) {
        const buf = Buffer.alloc(Math.min(4 << 20, size - this.offset));
        const n = readSync(fd, buf, 0, buf.length, this.offset); if (n <= 0) break;
        this.offset += n;
        const lines = (this.partial + buf.subarray(0, n).toString("utf8")).split("\n");
        this.partial = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          let o: any; try { o = JSON.parse(l); } catch { continue; }
          if (!o || typeof o.type !== "string") continue;
          this.events.push({ seq: this.events.length, ts: String(o.ts ?? ""), type: o.type, task: typeof o.task === "string" && o.task ? o.task : null, actor: String(o.actor ?? ""),
            pr: Number.isInteger(o.pr) ? o.pr : Number.isInteger(o.data?.pr) ? o.data.pr : null, summary: o.summary ?? null, data: o.data ?? {}, workflow: o.workflow });
        }
      }
    } finally { closeSync(fd); }
    return this.events;
  }
}

/** Studio's own event log (data/events.jsonl): what Studio's workflows do (gates, packs, documents), in firstmate's event shape. */
export class StudioLog extends RawLog {
  onAppend: (e: any) => void = () => {};
  emit(e: { type: string; workflow: string; task?: string | null; actor?: string; summary: string; data?: any }) {
    mkdirSync(dirname(this.file), { recursive: true });
    const rec = { ts: new Date().toISOString(), actor: e.actor ?? "studio", type: e.type, workflow: e.workflow, task: e.task ?? null, summary: { en: e.summary, "zh-TW": e.summary }, data: e.data ?? {} };
    appendFileSync(this.file, JSON.stringify(rec) + "\n");
    this.onAppend(rec);
  }
}

/** Values at a dotted path; "a.b[]" spreads an array, so one event can yield several strings. */
export function pluck(o: any, path: string): any[] {
  let cur: any[] = [o];
  for (const part of path.split(".")) {
    const spread = part.endsWith("[]"); const key = spread ? part.slice(0, -2) : part;
    const next: any[] = [];
    for (const c of cur) { const v = c?.[key]; if (v === undefined || v === null) continue; if (spread && Array.isArray(v)) next.push(...v); else next.push(v); }
    cur = next;
  }
  return cur;
}
