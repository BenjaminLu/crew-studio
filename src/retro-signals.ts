// Retro signals (phase R1 of the retro): the short events Studio writes to its own log (data/events.jsonl) so a retro can
// look back at what went wrong, and the little the retro keeps that the log cannot give back: the captain's words (a note,
// an incident's one line) and the captain's verdicts on candidates (dismissed, by class|group).
//
// An event's data holds codes and refs only (a PR id, an environment name, a failure code, a room id), never text from a
// pull request, a model or a log. The captain's own words live in data/retro/state.json, at captain trust, and an event
// names them by id.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StudioLog } from "./rawlog";

/** The event types R1 adds; every one is written with workflow "studio". */
export const SIGNAL_TYPES = ["run_failed", "room_round_failed", "room_translate_failed", "pr_merged", "pr_live", "pr_live_partial", "pr_drift", "pr_ship_mark", "pr_ship_undo", "pr_incident", "captain_note"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
/** The ones a PR's go-live timeline reads. */
export const PR_SIGNALS: SignalType[] = ["pr_merged", "pr_live", "pr_live_partial", "pr_drift", "pr_ship_mark", "pr_ship_undo", "pr_incident"];

/** Write one signal. A log that cannot be written never breaks the caller. */
export function signal(log: StudioLog | null | undefined, type: SignalType, data: Record<string, unknown>, o: { actor?: string; task?: string | null } = {}) {
  if (!log) return;
  const ref = ["pr", "env", "task", "room", "failure", "why", "lang", "kind", "note"].map((k) => data[k]).filter((v) => typeof v === "string" && v).join(" ");
  try { log.emit({ type, workflow: "studio", actor: o.actor ?? "studio", task: o.task ?? null, summary: `${type}${ref ? ` ${ref}` : ""}`.slice(0, 200), data }); } catch {}
}

// ---------- a merged pull request's way to production, per environment ----------
export type EnvState = "live" | "partial" | "off";
/** What Studio last wrote for one merged pull request: that it saw the merge, and each environment's state. Kept in
 *  pr-watch's state.json, so a restart writes nothing twice. */
export type ShipMark = { merged?: string; envs: Record<string, EnvState> };
type ShipEnv = { name: string; on: boolean | null; production: boolean; auto?: boolean; pods?: { tag: string | null; on: boolean | null }[] };
export type ShipEvent = { type: "pr_merged" | "pr_live" | "pr_live_partial" | "pr_drift"; data: Record<string, unknown> };

/** An environment's state from a refresh: live when it runs the merge and no service of it is on an older tag; partial when
 *  some service still is; off when none runs it; null when it could not be read (nothing is said then). */
export function envState(e: ShipEnv): EnvState | null {
  if (e.on === null) return null;
  if (!e.on) return "off";
  return e.pods?.some((p) => p.on === false) ? "partial" : "live";
}
const podsOf = (e: ShipEnv) => ({ on: (e.pods ?? []).filter((p) => p.on === true).length, off: (e.pods ?? []).filter((p) => p.on === false).length });
const tagOf = (e: ShipEnv) => { const tags = [...new Set((e.pods ?? []).filter((p) => p.on === true && p.tag).map((p) => p.tag))]; return tags.length === 1 ? tags[0] : null; };

/** The events one refresh owes for one merged pull request, against what was written before: the merge once, then one per
 *  environment that changed state. A service moving to another tag inside the same state says nothing. */
export function shipEvents(prev: ShipMark | undefined, r: { id: string; mergedAt: string; envs: ShipEnv[] }): { next: ShipMark; events: ShipEvent[] } {
  const next: ShipMark = { ...(prev?.merged ? { merged: prev.merged } : {}), envs: { ...(prev?.envs ?? {}) } }, events: ShipEvent[] = [];
  if (!prev?.merged) { next.merged = r.mergedAt; events.push({ type: "pr_merged", data: { pr: r.id, mergedAt: r.mergedAt } }); }
  for (const e of r.envs) {
    if (e.auto) continue; // a repository's own GitHub environments are shown, never followed
    const now = envState(e), was = prev?.envs?.[e.name];
    if (!now || now === was) continue;
    next.envs[e.name] = now;
    if (now === "live") events.push({ type: "pr_live", data: { pr: r.id, env: e.name, production: e.production, tag: tagOf(e) } });
    else if (now === "partial") events.push({ type: "pr_live_partial", data: { pr: r.id, env: e.name, production: e.production, pods: podsOf(e) } });
    else if (was) events.push({ type: "pr_drift", data: { pr: r.id, env: e.name, production: e.production } }); // it had it, and now it does not
  }
  return { next, events };
}

// ---------- what the retro keeps: the captain's words and verdicts ----------
export type Note = { id: string; at: string; text: string; trust: "captain"; by: "captain" | "firstmate"; kind: "note" | "incident"; route?: string | null; ref?: string | null; sel?: string | null; pr?: string | null };
export type Dismissal = { at: string; count: number };
type StoreFile = { schema: 1; notes: Record<string, Note>; dismissed: Record<string, Dismissal>; seq: number };
export const NOTE_MAX = 500;

/** One line of the captain's, as kept: control characters and line breaks become spaces, at most NOTE_MAX characters. */
export const oneLine = (v: unknown, max = NOTE_MAX) => String(v ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** data/retro/state.json, read and written whole on every call (atomic), so the server and Firstmate's tools share it. */
export class RetroStore {
  readonly file: string;
  constructor(readonly dataDir: string) { this.file = join(dataDir, "retro", "state.json"); }
  read(): StoreFile {
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, "utf8")); return { schema: 1, notes: j.notes ?? {}, dismissed: j.dismissed ?? {}, seq: Number(j.seq) || 0 }; } } catch {}
    return { schema: 1, notes: {}, dismissed: {}, seq: 0 };
  }
  private write(s: StoreFile) { mkdirSync(join(this.dataDir, "retro"), { recursive: true }); const tmp = `${this.file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(s, null, 1)); renameSync(tmp, this.file); }
  /** Keep the captain's words; returns the note (its id goes in the event). */
  addNote(n: Omit<Note, "id" | "at" | "trust">): Note {
    const text = oneLine(n.text); if (!text) throw new Error("say what went wrong / 寫一句發生了什麼");
    const s = this.read(), id = `N-${++s.seq}`;
    const note: Note = { id, at: new Date().toISOString(), text, trust: "captain", by: n.by, kind: n.kind, route: n.route ?? null, ref: n.ref ?? null, sel: n.sel ? oneLine(n.sel, 200) : null, pr: n.pr ?? null };
    s.notes[id] = note; this.write(s); return note;
  }
  note(id: string): Note | null { return this.read().notes[id] ?? null; }
  /** Undo a note just saved: its event stays in the log, but without its words it is no candidate. */
  dropNote(id: string): boolean { const s = this.read(); if (!s.notes[id]) return false; delete s.notes[id]; this.write(s); return true; }
  dismiss(key: string, count: number) { const s = this.read(); s.dismissed[key] = { at: new Date().toISOString(), count }; this.write(s); return s.dismissed[key]; }
  undismiss(key: string) { const s = this.read(); delete s.dismissed[key]; this.write(s); }
  dismissed(): Record<string, Dismissal> { return this.read().dismissed; }
}
