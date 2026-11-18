// studio_now: where the captain is (what each window shows, how long ago), what waits for them, what runs and what changed in
// the last hour. The live status line Studio adds to each captain turn (src/firstmate-turn.ts liveStatus) is a rendering of it.
import { ago, STALE_MS, type FocusSeen } from "./focus";
import { refOf, parseRef, kindDef, routeOf, type FieldDecl, type Sources } from "./registry";
import { byUrgency, urgencyLabel } from "./kinds/card";
import { withheldOf } from "./kinds/task";
import { taskTitle } from "../task-title";

export const NOW_SHOWN = 8;
const RUNNING = ["queued", "running", "waiting", "paused"];
const HOUR = 60 * 60_000;

/** The pieces of studio_now, before shaping. */
export function nowSummary(s: Sources, o: { focus?: boolean; recent?: boolean } = {}) {
  const engine = s.engine, clock = s.now ?? Date.now, t = clock();
  const open = engine.cards.list({ open: true }).filter((c) => { const r = engine.get(c.run); return !!r && !r.archived; }).sort(byUrgency);
  const waiting = open.map((c) => { const r = engine.get(c.run)!, withheld = withheldOf(engine, r);
    return { ref: refOf("card", c.id), card: c.id, kind: c.kind, task: refOf("task", r.id), run: r.id, workflow: r.workflow, since: c.createdAt, captainOnly: !!c.captainOnly,
      // the door as the Inbox ranks it (kinds/card.ts urgency): a confirm-door card is a one-way door, whatever door it names
      door: c.confirmDoor ? "one-way" : c.door ?? null, urgency: urgencyLabel(c),
      // what it asks and its choices: someone else's words (an agent's body, a template's file name as a label), none of it on a
      // withheld Task; studio_now's summary leaves both out so eight cards fit its 4 KB (tools.ts now)
      ...(withheld ? { withheld } : { title: c.title.en, question: String(engine.cards.view(c).body ?? "").slice(0, 300), options: (c.options ?? []).slice(0, 6).map((o) => String(o.label ?? "").slice(0, 60)),
        ...(engine.externalOrigin?.(r) ? { external: true } : { taskTitle: taskTitle(r) }) }) }; });
  const busy = new Set(open.map((c) => c.run));
  const runningRuns = engine.list().filter((r) => !r.archived && !busy.has(r.id) && RUNNING.includes(r.status));
  const jobs = (engine.deps as any).agents?.jobs as Map<string, any> | undefined;
  const running = runningRuns.map((r) => { const withheld = withheldOf(engine, r);
    const nodes = Object.entries(r.nodes).filter(([, n]) => ["running", "waiting"].includes(n.state)).map(([k, n]) => { const j = n.job ? jobs?.get(n.job) : null;
      return { node: k, label: r.def.nodes.find((x) => x.id === k)?.label ?? k, state: n.state, round: n.visits ?? null, cost: j?.cost ?? null, since: j?.started ?? null }; });
    return { ref: refOf("task", r.id), run: r.id, workflow: r.workflow, status: r.status, updatedAt: r.updatedAt, nodes, ...(withheld ? { withheld } : engine.externalOrigin?.(r) ? { external: true } : { title: taskTitle(r) }) }; });
  // the last hour: Tasks that changed or ended, cards raised or answered, rooms with a new page or a run, pull requests merged
  const recent: { ref: string; what: string; at: string }[] = [];
  if (o.recent !== false) {
  const within = (at: unknown) => { const n = Date.parse(String(at ?? "")); return Number.isFinite(n) && t - n <= HOUR && n <= t + 60_000; };
  for (const r of engine.list()) if (!r.archived && within(r.endedAt ?? r.updatedAt)) recent.push({ ref: refOf("task", r.id), what: r.endedAt && within(r.endedAt) ? `Task ${r.status}` : `Task ${r.status} (updated)`, at: String(r.endedAt ?? r.updatedAt) });
  for (const c of engine.cards.list({})) { if (c.answer && within(c.answer.at)) recent.push({ ref: refOf("card", c.id), what: `${c.kind} card answered: ${c.answer.choice} (by ${c.answer.by})`, at: c.answer.at });
    else if (c.status === "open" && within(c.createdAt)) recent.push({ ref: refOf("card", c.id), what: `new ${c.kind} card`, at: c.createdAt }); }
  try { for (const room of ((engine as any).reviewRoom?.list?.() ?? []) as any[]) if (within(room.updatedAt)) recent.push({ ref: refOf("room", room.id), what: room.running ? "room running (a page or a question)" : `room page v${room.versions ?? 0}`, at: room.updatedAt }); } catch {}
  try { for (const m of (s.prs?.()?.view()?.merged ?? []) as any[]) if (within(m.mergedAt)) recent.push({ ref: refOf("pr", m.id), what: "pull request merged", at: m.mergedAt }); } catch {}
  recent.sort((a, b) => b.at.localeCompare(a.at)); }
  return { waiting, running, recent, focus: o.focus === false ? null : focusPart(s, t) };
}

const seenView = (x: FocusSeen, t: number) => { const pr = parseRef(x.ref), def = pr ? kindDef(pr.kind) : undefined;
  return { route: x.route, ref: x.ref, page: x.label, selection: x.selection, dialog: x.dialog, ago: ago(t - x.at), at: new Date(x.at).toISOString(), stale: t - x.at > STALE_MS, ...(def && pr ? { open: routeOf(def, pr.id) } : {}) }; };
/** What the captain is looking at; sharing off says so and holds nothing to guess from. */
function focusPart(s: Sources, t: number) {
  const f = s.focus; if (!f) return { sharing: "unavailable", note: "This Studio does not report what the captain is looking at." };
  const n = f.now();
  if (!n.sharing) return { sharing: "off", note: "The captain turned off sharing their screen with Firstmate (Settings). Do not guess what they are looking at: ask them, or say sharing is off." };
  if (!n.current) return { sharing: "on", note: "No window has reported a page since Studio started." };
  const cur = seenView(n.current, t);
  return { sharing: "on", ...(cur.stale ? { last: cur, note: `Last seen ${cur.ago}: the captain may have moved on.` } : { current: cur }),
    otherWindows: n.others.slice(0, 3).map((x) => seenView(x, t)), recentPages: n.recent.slice(1, 6).map((x) => ({ page: x.label ?? x.route, ref: x.ref, ago: ago(t - x.at) })) };
}

export const NOW_FIELDS: FieldDecl[] = [
  ...["waiting[].ref", "waiting[].card", "waiting[].kind", "waiting[].task", "waiting[].run", "waiting[].workflow", "waiting[].since", "waiting[].captainOnly", "waiting[].door", "waiting[].urgency", "waiting[].withheld", "waiting[].title",
    "running[].ref", "running[].run", "running[].workflow", "running[].status", "running[].updatedAt", "running[].nodes", "running[].withheld", "waiting[].external", "running[].external", "recent", "focus", "counts"].map((path) => ({ path, trust: "studio" as const })),
  { path: "waiting[].taskTitle", trust: "captain" }, { path: "waiting[].options", trust: "untrusted", source: "option labels (workflow or agent)" },
  { path: "waiting[].question", trust: "untrusted", source: "the card's body, written by the Task's agents" }, { path: "running[].title", trust: "captain" },
];
