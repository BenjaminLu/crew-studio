// The retro's candidate list (#/improve → Candidates): the hits of workflows/studio.retro.yaml's classes over Studio's log,
// worked out each time it is shown, never stored. Each candidate is one class|group (a class on one pull request, Task,
// room or note). Only the captain's verdicts are kept (RetroStore): a dismissed class|group stays dismissed, and new hits
// only raise its count. Classes that are only counted, and hits below a class's repeat threshold, are the other signals:
// a count per class, folded away.
import { bundledText, parseYaml } from "./bundled";
import type { RawEv } from "./rawlog";
import { detect, type Detector, type RetroConfig } from "./retro";
import type { RetroStore } from "./retro-signals";

export type Candidate = { key: string; class: string; title: string; kind: string; group: string; groupKind: Detector["group"]; count: number; firstTs: string; lastTs: string; seqs: number[];
  note?: { text: string; by: string; sel: string | null } | null; recurring?: { groups: number; days: number } | null };
export type OtherSignal = { class: string; title: string; count: number; groups: number };
export type CandidateView = { rows: Candidate[]; other: OtherSignal[]; dismissed: (Candidate & { dismissedAt: string; since: number })[]; window: { from: string; to: string; days: number } };

let cached: RetroConfig | null = null;
/** workflows/studio.retro.yaml (bundled with the binary). */
export function studioRetro(): RetroConfig { return (cached ??= parseYaml(bundledText("workflows/studio.retro.yaml") ?? "classes: []") as RetroConfig); }

const titleOf = (d: Detector, cls: string) => cls === d.id ? d.title : `${d.title}: ${cls.slice(d.id.length + 1)}`;

export function candidates(cfg: RetroConfig, events: RawEv[], store: RetroStore, now = Date.now()): CandidateView {
  const days = cfg.window_days ?? 30, from = new Date(now - days * 86400e3).toISOString(), to = new Date(now).toISOString();
  const win = events.filter((e) => e.ts >= from && e.ts <= to && (!e.workflow || e.workflow === "studio" || e.type === "run_failure"));
  const s = store.read(), rows: Candidate[] = [], dismissed: CandidateView["dismissed"] = [], other = new Map<string, OtherSignal & { g: Set<string> }>();
  for (const d of cfg.classes ?? []) {
    const hits = detect(d, win, now), buckets = new Map<string, Candidate>();
    for (const h of hits) {
      const cls = h.class ?? d.id, key = `${cls}|${h.group}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { key, class: cls, title: titleOf(d, cls), kind: d.id.split(".")[0], group: h.group, groupKind: d.group, count: 0, firstTs: h.ts, lastTs: h.ts, seqs: [] });
      b.count++; b.lastTs = h.ts; if (b.seqs.length < 5) b.seqs.push(h.seq);
    }
    // a note is its words: one undone (or never kept) is nothing to show
    if (d.group === "note") for (const [k, b] of buckets) { const n = s.notes[b.group]; if (!n) buckets.delete(k); else b.note = { text: n.text, by: n.by, sel: n.sel ?? null }; }
    if (d.id === "pr") for (const b of buckets.values()) { const e = win.find((x) => x.seq === b.seqs.at(-1)), n = e?.data?.note ? s.notes[e.data.note] : null; b.note = n ? { text: n.text, by: n.by, sel: null } : null; }
    const counted = (cls: string) => d.candidate === "never" || (d.count_only ?? []).some((p) => new RegExp(p).test(cls.slice(d.id.length + 1)));
    // repeat: within its window, on at least min_groups groups (a class, never one isolated failure)
    const recentFrom = new Date(now - (d.window_days ?? 7) * 86400e3).toISOString(), recent = new Map<string, Set<string>>();
    for (const b of buckets.values()) if (b.lastTs >= recentFrom) { const g = recent.get(b.class) ?? new Set(); g.add(b.group); recent.set(b.class, g); }
    for (const b of buckets.values()) {
      const groups = recent.get(b.class)?.size ?? 0;
      const isRow = !counted(b.class) && (d.candidate === "always" || (d.candidate === "repeat" && groups >= (d.min_groups ?? 3) && b.lastTs >= recentFrom));
      if (!isRow) { const o = other.get(b.class) ?? { class: b.class, title: b.title, count: 0, groups: 0, g: new Set<string>() }; o.count += b.count; o.g.add(b.group); o.groups = o.g.size; other.set(b.class, o); continue; }
      if (d.candidate === "repeat") b.recurring = { groups, days: d.window_days ?? 7 };
      const dis = s.dismissed[b.key];
      if (dis) dismissed.push({ ...b, dismissedAt: dis.at, since: Math.max(0, b.count - dis.count) }); else rows.push(b);
    }
  }
  const order = (a: Candidate, b: Candidate) => a.class.localeCompare(b.class) || b.lastTs.localeCompare(a.lastTs);
  return { rows: rows.sort(order), dismissed: dismissed.sort(order), other: [...other.values()].map(({ g: _g, ...o }) => o).sort((a, b) => b.count - a.count), window: { from, to, days } };
}
