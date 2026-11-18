// Review rooms (room:PR-<hash>-1645, room:SC-12, room:R-162, room:DIR-…): the tutor's board and the "Explain with" runs, as the
// room's page reads them (engine.reviewRoom.list / view / explain.view: the same functions GET /api/review-room returns).
// Read with opened=false: reading never marks a room opened and never reads GitHub again. Nothing here starts a turn,
// a translation or an explainer run: those are paid and only the captain starts them on the room's page.
import { refOf, registerKind, sinceOf, timePage, type Entity, type Sources } from "../registry";
import { eventView, readEvents, retroStore } from "../events";
import { CHAPTERS, DIR_CHAPTERS } from "../../domain/review-room";
import { withheldOf } from "./task";

const rrOf = (s: Sources): any => (s.engine as any).reviewRoom ?? null;
const usd = (c: any) => (c && typeof c.usd === "number" ? c.usd : 0);
const round = (n: number) => Math.round(n * 10000) / 10000;

/** A room's title as Studio words it: never a pull request's own title (its author wrote that; it is in data, untrusted). */
export function roomTitle(row: { id: string; kind: string; title?: string; repository?: string | null }, number?: number | null): string {
  if (row.kind === "pr") { const n = number ?? Number(/-(\d+)$/.exec(row.id)?.[1] ?? 0); return `Pull request #${n}${row.repository ? ` (${row.repository})` : ""}`; }
  return String(row.title ?? row.id).slice(0, 100);
}
/** Where the tutor's lesson is: the chapters its board covers, the one it is on, and how it ended. */
export function lessonState(view: any, full = false) {
  const chapters = view?.subject?.kind === "dir" ? DIR_CHAPTERS : CHAPTERS;
  const teach = [...(view?.turns ?? [])].reverse().find((t: any) => !t.studio && t.action === "teach" && Array.isArray(t.scenes) && t.scenes.length);
  const covered = new Set<string>((teach?.scenes ?? []).filter((x: any) => !x.skip && x.chapter).map((x: any) => x.chapter));
  const last = (teach?.scenes ?? []).filter((x: any) => !x.skip).at(-1);
  const threads = view?.lesson?.threads ?? [];
  return { turn: teach?.n ?? null, status: teach?.status ?? null, scenes: teach?.scenes?.length ?? 0,
    current: last ? (() => { const c = chapters.find((y) => y.id === last.chapter); return { chapter: last.chapter ?? null, en: c?.en ?? null, zh: c?.zh ?? null, scene: last.n, of: chapters.findIndex((y) => y.id === last.chapter) + 1, chapters: chapters.length }; })() : null,
    covered: chapters.filter((c) => covered.has(c.id)).map((c) => c.id), remaining: chapters.filter((c) => !covered.has(c.id)).map((c) => c.id),
    sceneList: (teach?.scenes ?? []).filter((x: any) => !x.skip).slice(full ? 0 : -5).map((x: any) => ({ n: x.n, chapter: x.chapter ?? null, title: x.title })),
    complete: !!teach?.complete, stopped: teach?.stopped ?? null, gaps: teach?.gaps ?? [],
    threads: { open: threads.filter((t: any) => t.state === "open").length, resolved: threads.filter((t: any) => t.state === "resolved").length, confused: threads.filter((t: any) => t.confused).length } };
}
function roomData(s: Sources, id: string, full: boolean): Record<string, unknown> | null {
  const rr = rrOf(s); if (!rr) return null;
  let v: any; try { v = rr.view(id, false); } catch { return null; }
  let x: any = null; try { x = rr.explain?.view?.(id) ?? null; } catch { x = null; }
  const turns = (v.turns ?? []).filter((t: any) => !t.studio);
  // newest first: a cut to the size budget keeps the latest turns
  const shownTurns = (full ? turns : turns.slice(-5)).reverse();
  const cost = round(turns.reduce((n: number, t: any) => n + usd(t.cost), 0) + (x?.runs ?? []).reduce((n: number, r: any) => n + usd(r.cost), 0));
  return {
    id, kind: v.subject?.kind ?? null, subject: { kind: v.subject?.kind ?? null, url: v.subject?.url ?? null, repository: v.subject?.repository ?? null, number: v.subject?.number ?? null, branch: v.subject?.branch ?? null, task: v.subject?.task ?? null },
    task: v.task ? { id: v.task.id } : null, open: !!v.open, closed: v.closed ?? null, running: v.running ? { turn: v.running.turn ?? null, action: v.running.action ?? null } : null, archived: !!v.archived,
    pr: v.prState ? { state: v.prState.state, draft: v.prState.draft, mergedAt: v.prState.mergedAt, head: v.prState.head, headRef: v.prState.headRef, baseRef: v.prState.baseRef, author: v.prState.author, files: v.prState.files, approved: v.prState.approved,
      verdicts: (v.prState.verdicts ?? []).map((d: any) => ({ author: d.author, state: d.state, current: d.current })), title: v.prState.title } : null,
    head: v.head ?? null, base: v.base ?? null,
    questions: { asked: turns.length, done: turns.filter((t: any) => t.status === "done").length, failed: turns.filter((t: any) => t.status === "failed").length },
    turns: shownTurns.map((t: any) => ({ n: t.n, action: t.action, by: t.by, auto: !!t.auto, at: t.at, ended: t.ended, status: t.status, provider: t.provider, model: t.model, cost: t.cost ?? null,
      ...(t.by === "captain" || !t.auto ? { question: full ? t.text : String(t.text ?? "").slice(0, 400) } : {}), answer: full ? t.answer : String(t.answer ?? "").slice(0, 500), error: t.error ?? null,
      ...(t.thread ? { thread: { n: t.thread.n, chip: t.thread.chip ?? null } } : {}) })),
    lesson: lessonState(v, full),
    cost: { usd: cost },
    errors: turns.filter((t: any) => t.status === "failed" || t.error).slice(-5).map((t: any) => ({ turn: t.n, status: t.status, error: t.error ?? t.followUpError ?? null })),
    notes: { count: (v.notes ?? []).length, ...(full ? { items: (v.notes ?? []).slice(0, 40).map((n: any) => ({ kind: n.kind, author: n.author, at: n.at, state: n.state ?? null, path: n.path ?? null, body: n.body })) } : {}) },
    explain: x ? {
      selected: x.selected ?? null, running: x.running ?? null,
      runs: (full ? x.runs ?? [] : (x.runs ?? []).slice(-3)).map((r: any) => ({ n: r.n, kind: r.kind, skill: r.skill ? { id: r.skill.id, v: r.skill.v, name: r.skill.name } : null, status: r.status, at: r.at, ended: r.ended, provider: r.provider, model: r.model,
        rounds: (r.rounds ?? []).length, cost: r.cost ?? null, why: r.why ?? null, decided: r.decided ?? null, prepare: r.prepare ? { state: r.prepare.state } : null, version: r.version ?? null,
        question: r.question ?? null, prompt: r.prompt ?? null, stop: r.stop ?? null, error: r.error ?? null, summary: r.summary ?? null })),
      versions: (x.versions ?? []).slice(full ? 0 : -5).map((ver: any) => ({ n: ver.n, run: ver.run, skill: ver.skill, at: ver.at, kind: ver.kind, entry: ver.entry, prompt: ver.prompt ?? null, question: ver.question ?? null, summary: ver.summary ?? null })),
    } : null,
  };
}
/** studio_logs room:…: each tutor round and Explain-with run, oldest first, with its status, cost and why it stopped, and
 *  the room's events in Studio's log (a round that failed). After `since`, a time or the cursor it gave. */
function roomLogs(s: Sources, id: string, o: { tail: number; since: string | null }) {
  const d: any = roomData(s, id, true); if (!d) return null;
  const since = sinceOf(o.since), withheld = roomWithheld(s, id, d), store = retroStore(s);
  // one timeline, the tutor's rounds, the Explain-with runs and the room's events, paged by time: the cursor is the last shown
  const turns = [...(d.turns ?? [])].reverse().map((t: any) => ({ k: "turn" as const, at: t.ended ?? t.at, v: { n: t.n, action: t.action, by: t.by, at: t.at, ended: t.ended, status: t.status, provider: t.provider, model: t.model, cost: t.cost, ...(withheld ? {} : { error: t.error }) } }));
  const runs = (d.explain?.runs ?? []).map((r: any) => ({ k: "explain" as const, at: r.ended ?? r.at, v: { n: r.n, kind: r.kind, skill: r.skill, status: r.status, at: r.at, ended: r.ended, provider: r.provider, model: r.model, rounds: r.rounds, cost: r.cost, why: r.why, stop: r.stop, prepare: r.prepare, decided: r.decided, ...(withheld ? {} : { error: r.error }) } }));
  const events = readEvents(s, { since: null, kinds: null, ref: refOf("room", id) }).hits.map((e) => ({ k: "event" as const, at: e.ts, v: e }));
  const pg = timePage([...turns, ...runs, ...events], (x) => x.at, since.at, o.tail);
  const of = (k: string) => pg.page.filter((x) => x.k === k).map((x) => x.v);
  return { cursor: pg.cursor, updatedAt: null, data: { turns: of("turn"), explain: of("explain"), events: of("event").map((e: any) => eventView(s, e, store)), more: pg.more, cost: d.cost, ...(withheld ? { withheld } : {}) } };
}
const ROOM_ID =/^(SC-\d+|R-\d+|PR-[0-9a-f]{12}-[1-9]\d{0,8}|DIR-[0-9a-f]{12}-[0-9a-f]{12})$/;
/** The Task a room belongs to: its own (R-…), its merge card's, or the one its subject names. A room of a Task whose text is
 *  withheld from Firstmate (issue text, a peer's Studio) is withheld too: its tutor's words come from that text. */
function roomWithheld(s: Sources, id: string, data?: any): string | null {
  const e = s.engine, runId = /^R-\d+$/.test(id) ? id : /^SC-\d+$/.test(id) ? e.cards.get(id)?.run : data?.task?.id ?? data?.subject?.task ?? null;
  const r = runId ? e.get(runId) : null; return r ? withheldOf(e, r) : null;
}
/** A listed room: the room list's own row (cheap), the full view only on studio_get. */
const entityOf = (s: Sources, row: any): Entity => ({ id: row.id, title: roomTitle(row), updatedAt: row.updatedAt ?? null, withheld: roomWithheld(s, row.id),
  data: { id: row.id, kind: row.kind, open: !!row.open, running: !!row.running, answered: row.turns ?? 0, repository: row.repository ?? null, zone: row.zone ?? null },
  full: () => roomData(s, row.id, true) ?? {} });

registerKind({
  kind: "room", route: "#/room/:id", listRoute: "#/room", idPattern: ROOM_ID, idExample: "PR-0123456789ab-1645",
  about: "A review room: the pull request or branch under review, the captain's questions, where the tutor's lesson is, the Explain-with runs and versions, errors and costs.",
  scope: (e) => e.project ?? null, grantable: true, viewer: "desktop",
  filters: { open: { type: "boolean", description: "true: only rooms that still take turns" }, zone: { type: "string", description: "the room list's zone" } },
  fields: [
    ...["id", "kind", "subject", "task", "open", "closed", "running", "archived", "head", "base", "questions", "lesson", "cost", "notes.count",
      "pr.state", "pr.draft", "pr.mergedAt", "pr.head", "pr.headRef", "pr.baseRef", "pr.author", "pr.files", "pr.approved", "pr.verdicts",
      "turns[].n", "turns[].action", "turns[].by", "turns[].auto", "turns[].at", "turns[].ended", "turns[].status", "turns[].provider", "turns[].model", "turns[].cost", "turns[].thread",
      "errors[].turn", "errors[].status", "explain.selected", "explain.running",
      "explain.runs[].n", "explain.runs[].kind", "explain.runs[].skill", "explain.runs[].status", "explain.runs[].at", "explain.runs[].ended", "explain.runs[].provider", "explain.runs[].model", "explain.runs[].rounds",
      "explain.runs[].cost", "explain.runs[].why", "explain.runs[].decided", "explain.runs[].prepare", "explain.runs[].version", "explain.runs[].stop",
      "explain.versions[].n", "explain.versions[].run", "explain.versions[].skill", "explain.versions[].at", "explain.versions[].kind", "explain.versions[].entry",
      "notes.items[].kind", "notes.items[].author", "notes.items[].at", "notes.items[].state", "notes.items[].path", "withheld", "answered", "repository", "zone"].map((path) => ({ path, trust: "studio" as const })),
    ...["turns[].question", "explain.runs[].question", "explain.runs[].prompt", "explain.versions[].prompt", "explain.versions[].question"].map((path) => ({ path, trust: "captain" as const })),
    { path: "pr.title", trust: "untrusted", source: "the pull request's title (GitHub)" },
    { path: "lesson.sceneList[].title", trust: "untrusted", source: "a scene title the tutor wrote (a model)" },
    { path: "turns[].answer", trust: "untrusted", source: "the tutor's answer (a model)" },
    { path: "turns[].error", trust: "untrusted", source: "the tutor round's error output" },
    { path: "errors[].error", trust: "untrusted", source: "the tutor round's error output" },
    { path: "explain.runs[].error", trust: "untrusted", source: "the explainer run's error output" },
    { path: "explain.runs[].summary", trust: "untrusted", source: "the explainer's own summary (a model)" },
    { path: "explain.versions[].summary", trust: "untrusted", source: "the explainer's own summary (a model)" },
    { path: "notes.items[].body", trust: "untrusted", source: "a GitHub reviewer's comment" },
  ],
  logCursor: "time",
  logs: (s, id, o) => roomLogs(s, id, o),
  logFields: [
    ...["turns[].n", "turns[].action", "turns[].by", "turns[].at", "turns[].ended", "turns[].status", "turns[].provider", "turns[].model", "turns[].cost",
      "explain[].n", "explain[].kind", "explain[].skill", "explain[].status", "explain[].at", "explain[].ended", "explain[].provider", "explain[].model", "explain[].rounds", "explain[].cost", "explain[].why", "explain[].stop", "explain[].prepare", "explain[].decided",
      "events", "more", "cost", "withheld"].map((path) => ({ path, trust: "studio" as const })),
    { path: "turns[].error", trust: "untrusted", source: "the tutor round's error output" },
    { path: "explain[].error", trust: "untrusted", source: "the explainer run's error output" },
  ],
  list: (s, filter) => { const rr = rrOf(s); if (!rr) return []; let rows: any[] = []; try { rows = rr.list(); } catch { rows = []; }
    return rows.filter((r) => (filter.open !== true || r.open) && (!filter.zone || r.zone === filter.zone)).map((r) => entityOf(s, r)); },
  get: (s, id) => { const rr = rrOf(s); if (!rr || !ROOM_ID.test(id)) return null; let row: any = null; try { row = rr.list().find((r: any) => r.id === id); } catch {}
    const data = roomData(s, id, false); if (!data) return null;
    return { id, title: roomTitle(row ?? { id, kind: (data.kind as string) ?? "", repository: (data.subject as any)?.repository }, (data.subject as any)?.number), updatedAt: row?.updatedAt ?? null, withheld: roomWithheld(s, id, data), data, full: () => roomData(s, id, true) ?? data }; },
});
