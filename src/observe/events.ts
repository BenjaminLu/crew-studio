// studio_events: Studio's own event log (data/events.jsonl, src/rawlog.ts StudioLog) as a stream an agent reads on with a
// cursor: the pull form of a subscription. Each event names the entities it is about as refs (task:R-…, pr:owner/repo#N,
// room:…), so a caller can follow one entity or one kind.
//   The retro's signals (src/retro-signals.ts SIGNAL_TYPES: run_failed, room_round_failed, pr_merged, pr_live, …) carry codes
//   and refs only: their summary and data are Studio's. A captain_note names a note the retro keeps: its text is the
//   captain's words (captain trust); text that was selected on the page when it was written is page text (untrusted).
//   Studio's own audit lines (a grant issued, used or refused, a skill imported) have Studio's summary. Any other line's
//   summary may quote a tool's output or someone's words: it comes as untrusted, and none of its data is emitted.
// A Task whose text is withheld from Firstmate keeps its events' untrusted parts out, as everywhere else.
import { RetroStore, SIGNAL_TYPES } from "../retro-signals";
import { kindDef, refOf, shape, sinceOf, type FieldDecl, type KindDef, type LogEvent, type Sources } from "./registry";
import { withheldOf } from "./kinds/task";

const SIGNALS = new Set<string>(SIGNAL_TYPES);
/** Studio's audit lines, whose summaries Studio composes from ids alone. */
const STUDIO_LINES = new Set(["cli_grant_issued", "cli_grant_revoked", "cli_grant_used", "cli_grant_refused", "cli_grant_run", "cli_grant_prs_edit", "skill_imported", "operating_rules_changed", "worktree_sweep"]);
const text = (v: any) => (typeof v === "string" ? v : v && typeof v === "object" ? String(v.en ?? "") : "");
const RUN = /^R-\d+$/, PR = /^[\w.-]+\/[\w.-]+#\d+$/;

/** The refs an event is about. */
export function refsOf(e: LogEvent): string[] {
  const out = new Set<string>(), d = e.data ?? {};
  for (const t of [e.task, d.task, d.run]) if (typeof t === "string" && RUN.test(t)) out.add(refOf("task", t));
  if (typeof d.pr === "string" && PR.test(d.pr)) out.add(refOf("pr", d.pr));
  if (typeof d.room === "string" && kindDef("room")?.idPattern.test(d.room)) out.add(refOf("room", d.room));
  if (e.type === "captain_note" && typeof d.ref === "string") { if (RUN.test(d.ref)) out.add(refOf("task", d.ref)); else if (PR.test(d.ref)) out.add(refOf("pr", d.ref)); else if (kindDef("room")?.idPattern.test(d.ref)) out.add(refOf("room", d.ref)); }
  return [...out];
}

export const EVENT_FIELDS: FieldDecl[] = [
  ...["seq", "at", "type", "actor", "workflow", "refs", "summary", "data", "note.id", "note.by", "note.kind", "note.at", "note.gone", "withheld"].map((path) => ({ path, trust: "studio" as const })),
  { path: "note.text", trust: "captain" },
  { path: "note.context", trust: "untrusted", source: "text selected on the page when the note was written (a pull request's or a model's)" },
  { path: "line", trust: "untrusted", source: "a line of Studio's event log, which may quote a tool's output or someone's words" },
];
const DEF = { kind: "event", fields: EVENT_FIELDS } as unknown as KindDef;

/** One event as an agent reads it, shaped by EVENT_FIELDS. */
export function eventView(s: Sources, e: LogEvent, store: RetroStore | null) {
  const refs = refsOf(e), runId = refs.find((r) => r.startsWith("task:"))?.slice(5), run = runId ? s.engine.get(runId) : null, withheld = run ? withheldOf(s.engine, run) : null;
  const raw: Record<string, unknown> = { seq: e.seq, at: e.ts, type: e.type, actor: e.actor, workflow: e.workflow ?? null, refs };
  if (SIGNALS.has(e.type)) { raw.summary = text(e.summary); const { turn: _t, ...data } = e.data ?? {}; raw.data = data;
    if (e.type === "captain_note" && typeof e.data?.note === "string") { const n = store?.note(e.data.note) ?? null;
      raw.note = n ? { id: n.id, by: n.by, kind: n.kind, at: n.at, text: n.text, context: n.context?.sel ?? null } : { id: e.data.note, gone: true }; } }
  else if (STUDIO_LINES.has(e.type)) raw.summary = text(e.summary);
  else raw.line = text(e.summary);
  return shape(DEF, raw, withheld).data;
}

/** The events after `since` (a cursor "seq:N" or a time), oldest first, about `ref` or one of `kinds` when given. */
export function readEvents(s: Sources, o: { since: string | null; kinds: string[] | null; ref: string | null }) {
  let all: LogEvent[] = []; try { all = s.log?.poll() ?? []; } catch { all = []; }
  const since = sinceOf(o.since);
  const match = (e: LogEvent) => { if (since.seq !== null && e.seq <= since.seq) return false; if (since.at !== null && !(Date.parse(e.ts) > since.at)) return false;
    if (!o.ref && !o.kinds) return true; const refs = refsOf(e); if (o.ref && !refs.includes(o.ref)) return false; return !o.kinds || refs.some((r) => o.kinds!.includes(r.slice(0, r.indexOf(":")))); };
  return { all, hits: all.filter(match) };
}
export const retroStore = (s: Sources) => (s.dataDir ? new RetroStore(s.dataDir) : null);
