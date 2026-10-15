// The generalized retro: for any workflow, read its event log over a window,
// compute the metrics its retro config names, and find its repeat classes.
// Config: workflows/<id>.retro.yaml (or a pack's retro file). Nothing here
// writes to firstmate: the firstmate log is read-only.
import { allocate } from "./ids";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pluck, type RawEv } from "./rawlog";

export type Detector = {
  id: string; title: string; explain?: string; kind: "regex" | "duration"; types?: string[]; field: string; pattern?: string;
  where?: Record<string, string>; center?: number; below?: number; above?: number; group: "task" | "actor" | "pr"; min_groups?: number;
  propose?: { role: string; section?: string; rule: string; target?: number; eval?: { ask: string; terms: string[]; expect: { pattern: string; why: string }[] } };
};
export type MetricDef = { id: string; label: string; count?: { type?: string; types?: string[]; pattern?: string }; ratio?: [string, string];
  quantile?: { field: string; q: number; where?: Record<string, string> } };
export type Trigger = { kind: "every"; days: number } | { kind: "count"; type: string; n: number } | { kind: "repeat"; min_groups: number };
export type RetroConfig = { workflow: string; source: "firstmate" | "studio"; window_days: number; triggers: Trigger[]; metrics: MetricDef[]; classes: Detector[] };
export type Hit = { seq: number; ts: string; task: string | null; actor: string; text: string; group: string };
export type ClassResult = { id: string; title: string; explain: string | null; found: boolean; count: number; groups: string[]; firstTs: string | null; lastTs: string | null;
  examples: Hit[]; perWeek: number; note: string | null; role: string | null };
export type Report = { id: string; workflow: string; createdAt: string; trigger: string; window: { from: string; to: string; days: number; events: number };
  metrics: { id: string; label: string; value: number | null }[]; classes: ClassResult[]; proposals: string[]; skipped: { class: string; why: string }[] };

const match = (e: RawEv, where?: Record<string, string>) => !where || Object.entries(where).every(([k, v]) => pluck(e, k).some((x) => String(x) === String(v)));
const groupOf = (e: RawEv, g: Detector["group"]) => (g === "actor" ? e.actor : g === "pr" ? (e.pr != null ? `#${e.pr}` : null) : e.task) ?? e.actor ?? "?";

/** Every hit of one class among the events (any window: the caller slices). */
export function detect(d: Detector, events: RawEv[]): Hit[] {
  const hits: Hit[] = [];
  const re = d.kind === "regex" ? new RegExp(d.pattern ?? "", "i") : null;
  for (const e of events) {
    if (d.types && !d.types.includes(e.type)) continue;
    if (!match(e, d.where)) continue;
    for (const v of pluck(e, d.field)) {
      if (re) { if (typeof v === "string" && re.test(v)) { hits.push({ seq: e.seq, ts: e.ts, task: e.task, actor: e.actor, text: v.slice(0, 300), group: groupOf(e, d.group) }); break; } }
      else if (typeof v === "number") {
        const c = d.center ?? 0;
        if (v >= c - (d.below ?? 60) && v <= c + (d.above ?? 60)) { hits.push({ seq: e.seq, ts: e.ts, task: e.task, actor: e.actor, text: `${Math.round(v)} s`, group: groupOf(e, d.group) }); break; }
      }
    }
  }
  return hits;
}

function quantile(xs: number[], q: number) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]); }
export function metrics(defs: MetricDef[], evs: RawEv[]) {
  const out: { id: string; label: string; value: number | null }[] = [];
  const val = (id: string) => out.find((m) => m.id === id)?.value ?? null;
  for (const m of defs) {
    let v: number | null = null;
    if (m.count) { const types = m.count.types ?? (m.count.type ? [m.count.type] : null); const re = m.count.pattern ? new RegExp(m.count.pattern, "i") : null;
      v = evs.filter((e) => (!types || types.includes(e.type)) && (!re || re.test(String(e.summary?.en ?? e.summary ?? "")))).length; }
    else if (m.ratio) { const a = val(m.ratio[0]), b = val(m.ratio[1]); v = a != null && b ? Math.round((a / b) * 100) / 100 : null; }
    else if (m.quantile) v = quantile(evs.filter((e) => match(e, m.quantile!.where)).flatMap((e) => pluck(e, m.quantile!.field)).filter((x) => typeof x === "number"), m.quantile.q);
    out.push({ id: m.id, label: m.label, value: v });
  }
  return out;
}

export function sliceWindow(events: RawEv[], from: string, to: string, workflow?: string, source?: string) {
  return events.filter((e) => e.ts >= from && e.ts <= to && (source !== "studio" || !workflow || e.workflow === workflow));
}

export class Retros {
  readonly dir: string;
  constructor(dataDir: string) { this.dir = join(dataDir, "retros"); mkdirSync(this.dir, { recursive: true }); }
  list(): Report[] { return readdirSync(this.dir).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(this.dir, f), "utf8")); } catch { return null; } })
    .filter(Boolean).sort((a: Report, b: Report) => b.createdAt.localeCompare(a.createdAt)); }
  get(id: string): Report | null { const f = join(this.dir, `${id.replace(/[^\w-]/g, "")}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; }
  save(r: Report) { writeFileSync(join(this.dir, `${r.id}.json`), JSON.stringify(r, null, 1)); }
  last(workflow: string) { return this.list().find((r) => r.workflow === workflow) ?? null; }

  /** Run one retro over [now - window_days, now]. Proposals are made by the caller from the classes found. */
  run(cfg: RetroConfig, events: RawEv[], o: { trigger: string; days?: number; to?: string }): Report {
    const days = o.days ?? cfg.window_days ?? 14;
    const to = o.to ?? new Date().toISOString(), from = new Date(Date.parse(to) - days * 86400e3).toISOString();
    const win = sliceWindow(events, from, to, cfg.workflow, cfg.source);
    const id = allocate(this.dir, "R", { existing: () => this.list().map((r) => r.id) });
    const classes: ClassResult[] = cfg.classes.map((d) => {
      const hits = detect(d, win);
      const groups = [...new Set(hits.map((h) => h.group))];
      const found = groups.length >= (d.min_groups ?? 2);
      const ex: Hit[] = []; const seen = new Set<string>();
      for (const h of hits) { if (seen.has(h.group)) continue; seen.add(h.group); ex.push(h); if (ex.length >= 8) break; }
      return { id: d.id, title: d.title, explain: d.explain ?? null, found, count: hits.length, groups, firstTs: hits[0]?.ts ?? null, lastTs: hits.at(-1)?.ts ?? null, examples: ex,
        perWeek: Math.round((hits.length / days) * 7 * 10) / 10, role: d.propose?.role ?? null,
        note: found ? null : hits.length ? `seen on ${groups.length} ${d.group}${groups.length === 1 ? "" : "s"} only (needs ${d.min_groups ?? 2})` : "not in the log for this window" };
    });
    const r: Report = { id, workflow: cfg.workflow, createdAt: new Date().toISOString(), trigger: o.trigger,
      window: { from, to, days, events: win.length }, metrics: metrics(cfg.metrics ?? [], win), classes, proposals: [], skipped: [] };
    this.save(r);
    return r;
  }

  /** Which of the config's triggers fire now (manual retros always run). */
  due(cfg: RetroConfig, events: RawEv[], now = new Date().toISOString()): string | null {
    const last = this.last(cfg.workflow);
    const since = last?.window?.to ?? last?.createdAt ?? new Date(Date.parse(now) - (cfg.window_days ?? 14) * 86400e3).toISOString();
    const fresh = sliceWindow(events, since, now, cfg.workflow, cfg.source);
    for (const t of cfg.triggers ?? []) {
      if (t.kind === "every" && (!last || Date.parse(now) - Date.parse(last.createdAt) >= t.days * 86400e3)) return `every ${t.days} days`;
      if (t.kind === "count" && fresh.filter((e) => e.type === t.type).length >= t.n) return `${t.n} ${t.type} since the last retro`;
      if (t.kind === "repeat") for (const d of cfg.classes) { const g = new Set(detect(d, fresh).map((h) => h.group)); if (g.size >= t.min_groups) return `${d.title}: ${g.size} repeats since the last retro`; }
    }
    return null;
  }
}

/** Occurrences per week of one class before and after a moment (adoption tracking). */
export function beforeAfter(d: Detector, events: RawEv[], at: string, windowDays: number, now = new Date().toISOString()) {
  const b0 = new Date(Date.parse(at) - windowDays * 86400e3).toISOString();
  const before = detect(d, events.filter((e) => e.ts >= b0 && e.ts < at)).length;
  const afterDays = Math.max(0, (Date.parse(now) - Date.parse(at)) / 86400e3);
  const after = detect(d, events.filter((e) => e.ts >= at && e.ts <= now)).length;
  return { beforePerWeek: Math.round((before / windowDays) * 70) / 10, afterPerWeek: afterDays >= 1 ? Math.round((after / afterDays) * 70) / 10 : null, afterCount: after, afterDays: Math.round(afterDays * 10) / 10 };
}
