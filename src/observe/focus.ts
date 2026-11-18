// What the captain is looking at (docs/units/observe.md "Focus"): the board says, debounced, which page, item and dialog is on
// screen in each window (POST /api/focus; only the captain's own page on this Mac, never a tool token or a phone). Only ids
// and the labels Studio itself shows, each capped; never what is being typed, never a picture of the screen. Kept in memory
// only: the last 20 reports and when each window was last seen. The captain turns sharing off in Settings or by clicking
// the Firstmate panel's "看得到" label; off clears what was kept and refuses new reports.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FocusReport = { route: string; ref: string | null; selection: { kind: string; id: string; label: string } | null; dialog: string | null; label: string | null };
export type FocusSeen = FocusReport & { tab: string; at: number };
const KEYS = new Set(["route", "ref", "selection", "dialog", "label", "tab", "visible"]);
const SEL_KEYS = new Set(["kind", "id", "label"]);
export const FOCUS_LIMITS = { route: 200, ref: 200, id: 160, label: 80, dialog: 60, tab: 64, kept: 20, tabs: 20 } as const;
const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** Check a report from the board; the reason when it is refused. Unknown keys are refused: a report carries nothing else. */
export function readReport(b: unknown): { ok: true; tab: string; visible: boolean; report: FocusReport } | { ok: false; error: string } {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, error: "send {route, ref?, selection?, dialog?, label?, tab, visible}" };
  const o = b as Record<string, unknown>, extra = Object.keys(o).find((k) => !KEYS.has(k));
  if (extra) return { ok: false, error: `a focus report carries only route, ref, selection, dialog, label, tab and visible (not ${extra.slice(0, 40)})` };
  const route = clean(o.route, FOCUS_LIMITS.route);
  if (!/^#\/[\w-]{1,40}(?:\/[^\s]*)?$/.test(route)) return { ok: false, error: "route is the board's #/… address" };
  const tab = clean(o.tab, FOCUS_LIMITS.tab); if (!/^[\w-]{1,64}$/.test(tab)) return { ok: false, error: "tab is the window's id" };
  let selection: FocusReport["selection"] = null;
  if (o.selection != null) { const s = o.selection as Record<string, unknown>;
    if (typeof s !== "object" || Array.isArray(s) || Object.keys(s).some((k) => !SEL_KEYS.has(k))) return { ok: false, error: "selection is {kind, id, label}" };
    selection = { kind: clean(s.kind, 20), id: clean(s.id, FOCUS_LIMITS.id), label: clean(s.label, FOCUS_LIMITS.label) }; if (!selection.kind || !selection.id) selection = null; }
  const ref = o.ref == null || o.ref === "" ? null : clean(o.ref, FOCUS_LIMITS.ref);
  if (ref && !/^[a-z][a-z-]{1,20}:\S+$/.test(ref)) return { ok: false, error: "ref is kind:id (task:R-162)" };
  return { ok: true, tab, visible: o.visible !== false, report: { route, ref, selection, dialog: o.dialog == null || o.dialog === "" ? null : clean(o.dialog, FOCUS_LIMITS.dialog), label: o.label == null || o.label === "" ? null : clean(o.label, FOCUS_LIMITS.label) } };
}

export class FocusStore {
  private kept: FocusSeen[] = [];
  private seen = new Map<string, number>();
  private sharing: boolean;
  constructor(private dataDir: string | null, private clock: () => number = Date.now) {
    this.sharing = (() => { if (!dataDir) return true; try { const v = JSON.parse(readFileSync(join(dataDir, "focus-sharing.json"), "utf8")); return v?.sharing !== false; } catch { return true; } })();
  }
  /** Is the captain sharing (Settings, default on)? */
  get on(): boolean { return this.sharing; }
  /** The captain turns sharing on or off; off forgets every report. */
  setSharing(on: boolean): boolean {
    this.sharing = on; if (!on) { this.kept = []; this.seen.clear(); }
    if (this.dataDir) { try { if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true }); const f = join(this.dataDir, "focus-sharing.json"); writeFileSync(f + ".tmp", JSON.stringify({ schema: 1, sharing: on }), { mode: 0o600 }); renameSync(f + ".tmp", f); } catch {} }
    return this.sharing;
  }
  /** A window's report. A background window's report only marks it seen: what is on screen is what counts. */
  put(tab: string, report: FocusReport, visible = true): boolean {
    if (!this.sharing) return false;
    const at = this.clock(); this.seen.delete(tab); this.seen.set(tab, at);
    while (this.seen.size > FOCUS_LIMITS.tabs) this.seen.delete(this.seen.keys().next().value!);
    if (!visible) return true;
    const last = this.kept.at(-1);
    if (last && last.tab === tab && JSON.stringify({ ...last, at: 0 }) === JSON.stringify({ ...report, tab, at: 0 })) { last.at = at; return true; }
    this.kept.push({ ...report, tab, at }); if (this.kept.length > FOCUS_LIMITS.kept) this.kept.shift();
    return true;
  }
  /** What the captain looks at now: the window used last, the other windows' last pages, the recent history. */
  now(): { sharing: boolean; current: FocusSeen | null; others: FocusSeen[]; recent: FocusSeen[]; lastSeen: Record<string, number> } {
    if (!this.sharing) return { sharing: false, current: null, others: [], recent: [], lastSeen: {} };
    const current = this.kept.at(-1) ?? null, others: FocusSeen[] = [];
    for (const tab of [...this.seen.keys()].reverse()) { if (tab === current?.tab) continue; const last = [...this.kept].reverse().find((x) => x.tab === tab); if (last) others.push(last); }
    return { sharing: true, current, others, recent: [...this.kept].reverse(), lastSeen: Object.fromEntries(this.seen) };
  }
}

/** "12 s ago", "3 min ago"; over 10 minutes it is "last seen" rather than "now" (studio_now). */
export function ago(ms: number): string { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; }
export const STALE_MS = 10 * 60_000;
