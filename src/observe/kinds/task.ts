// Tasks (task:R-162): the board's Tasks list row (src/runtime/task-row.ts) and Task page, as an agent reads them.
// A Task whose text is withheld from Firstmate (engine.redacted: a peer's Studio, issue text) shows its state, never its words.
import { registerKind, type Entity, type Sources } from "../registry";
import { taskRow } from "../../runtime/task-row";
import type { Engine, Run } from "../../runtime/engine";

const PROPOSAL = "firstmate-proposal";
export const withheldOf = (engine: Engine, r: Run): string | null => (engine.redacted(r) ? (r.profile?.name === "lan" ? "work from a peer's Studio: its text is withheld" : "untrusted text: withheld") : null);
const ENDED = ["succeeded", "failed", "cancelled"];

/** A Task's state as Firstmate reads it: status, the cards it waits on (by the run's own nodes), its pull request. */
export function runState(engine: Engine, r: Run) {
  const open = engine.cards.list({ run: r.id, open: true }).map((c) => ({ card: c.id, node: c.node, kind: c.kind, title: c.title.en }));
  return { id: r.id, workflow: r.workflow, workflowName: engine.defs.names?.of(r.workflow, r.def?.name) ?? r.workflow, version: r.version, status: r.status, ...(r.result ? { result: r.result } : {}), ...(open.length ? { waitingOn: open } : {}), ...(typeof r.ctx?.pr?.url === "string" ? { pr: r.ctx.pr.url } : {}) };
}

/** studio_work_status, now `studio_list {kind: "task"}` in its older shape: the newest Tasks first (engine.list is newest
 *  first; H10: slice(-50) read the oldest 50), and a dispatched proposal names its execution run and that run's state. */
export function workStatus(engine: Engine, limit = 50) {
  const all = engine.list();
  return { total: all.length, order: "newest first", tasks: all.slice(0, limit).map((r) => {
    if (engine.redacted(r)) return { id: r.id, workflow: r.workflow, version: r.version, status: r.status, ...(r.result ? { result: r.result } : {}), title: `(a Task whose text is withheld from Firstmate: ${r.profile?.name === "lan" ? "work from a peer's Studio" : "untrusted text"})`, ...(r.profile?.name === "lan" ? { fromPeer: true } : { withheld: true }) };
    const child = r.workflow === PROPOSAL && typeof r.ctx?.childRun === "string" ? engine.get(r.ctx.childRun) : undefined;
    return { ...runState(engine, r), title: r.title, ...(r.workflow === PROPOSAL ? { dispatched: !!child, ...(child ? { execution: { ...runState(engine, child), title: child.title } } : {}) } : {}),
      ...(typeof r.params?._firstmateProposal === "string" ? { proposal: r.params._firstmateProposal } : {}),
      ...(() => { const trust = engine.trusted(r.id), pending = trust.entries.filter((e) => e.record === "firstmate-project-staffing-pending").at(-1)?.data; return trust.ok && pending?.schema === 1 ? { staffingPending: pending } : {}; })(),
      ...(Array.isArray(r.ctx?.skillRefusals) && r.ctx.skillRefusals.length ? { skillRefusals: r.ctx.skillRefusals.map((x: any) => `skill ${x.skill} tried ${x.host}, not in its approved hosts (${x.node}, ${x.script})`) } : {}) };
  }), ...(() => { const s = engine.deps.skillPackages?.inUseStatus?.() ?? []; return s.length ? { skills: s } : {}; })() };
}

/** One Task's data: the board's row, its state, what it waits on and, when it failed, Studio's typed reading of why. */
function taskData(s: Sources, r: Run, full: boolean): Record<string, unknown> {
  const engine = s.engine, row = (s.taskRow ?? ((x: Run) => taskRow(engine, x)))(r), withheld = withheldOf(engine, r), st = runState(engine, r);
  const child = r.workflow === PROPOSAL && typeof r.ctx?.childRun === "string" ? engine.get(r.ctx.childRun) : undefined;
  const f = r.failure, external = !!row.origin;
  const out: Record<string, unknown> = {
    id: row.id, workflow: row.workflow, workflowName: st.workflowName, version: row.version, status: row.status, result: row.result, project: row.project,
    createdAt: row.createdAt, updatedAt: row.updatedAt, endedAt: row.endedAt, archived: row.archived, merged: row.merged, cancelReason: row.cancelReason,
    current: row.current, waitingOn: (st.waitingOn ?? []).map((w) => (withheld ? { card: w.card, node: w.node, kind: w.kind } : w)), pr: st.pr ?? null, childRun: row.childRun,
    // an external CLI grant's Task: its title and request are the CLI's words, not the captain's (src/cli-grants.ts)
    ...(withheld ? {} : external ? { externalTitle: row.title, externalRequest: full ? row.request : String(row.request ?? "").slice(0, 200), origin: { grant: (row.origin as any)?.grant ?? null } }
      : { title: row.title, request: full ? row.request : String(row.request ?? "").slice(0, 200) }),
    ...(r.workflow === PROPOSAL ? { dispatched: !!child, execution: child ? (withheldOf(engine, child) ? { ...runState(engine, child), waitingOn: (runState(engine, child).waitingOn ?? []).map((w) => ({ card: w.card, node: w.node, kind: w.kind })), title: null } : { ...runState(engine, child), title: child.title }) : null } : {}),
    ...(typeof r.params?._firstmateProposal === "string" ? { proposal: r.params._firstmateProposal } : {}),
    ...(f ? { failure: { class: f.class, code: f.code, at: f.at, node: f.node, title: f.title, meaning: f.meaning, fix: f.fix, where: f.where, message: f.message } } : {}),
    error: row.error,
  };
  if (full) {
    try { out.events = engine.timeline(r.id).slice(-40).map((e: any) => ({ type: e.type, node: e.node ?? null, edge: e.edge ?? null, at: e.ts ?? e.at ?? null })); } catch { out.events = []; }
    out.cards = engine.cards.list({ run: r.id }).map((c) => ({ id: c.id, kind: c.kind, node: c.node, status: c.status, ...(withheld ? {} : { title: c.title.en }), createdAt: c.createdAt, answer: c.answer ? { choice: c.answer.choice, by: c.answer.by, at: c.answer.at } : null }));
  }
  return out;
}
const entity = (s: Sources, r: Run): Entity => {
  const withheld = withheldOf(s.engine, r);
  const row = taskRow(s.engine, r);
  return { id: r.id, title: withheld ? `${r.id} (a Task whose text is withheld from Firstmate)` : row.origin ? `${r.id} (started by an external CLI)` : `${r.id} ${String(row.title ?? "").slice(0, 60)}`.trim(), updatedAt: r.updatedAt ?? null, withheld, project: s.engine.projectRow(r),
    data: taskData(s, r, false), full: () => taskData(s, r, true) };
};

registerKind({
  kind: "task", route: "#/run/:id", listRoute: "#/runs", idPattern: /^R-\d+$/, idExample: "R-162",
  about: "A Task: its workflow, status, the step it is on, the cards it waits on, its pull request and, when it failed, why.",
  scope: (e) => e.project ?? null, grantable: true, viewer: "desktop",
  filters: { status: { type: "string", description: "queued, running, waiting, paused, succeeded, failed or cancelled", enum: ["queued", "running", "waiting", "paused", "succeeded", "failed", "cancelled"] },
    active: { type: "boolean", description: "true: only Tasks not ended" }, archived: { type: "boolean", description: "true: include archived Tasks" }, workflow: { type: "string", description: "a workflow id" } },
  fields: [
    ...["id", "workflow", "workflowName", "version", "status", "result", "project", "createdAt", "updatedAt", "endedAt", "archived", "merged", "current", "waitingOn", "pr", "childRun", "dispatched", "proposal", "withheld",
      "failure.class", "failure.code", "failure.at", "failure.node", "failure.title", "failure.meaning", "failure.fix", "failure.where", "events", "cards",
      "execution.id", "execution.workflow", "execution.workflowName", "execution.version", "execution.status", "execution.result", "execution.waitingOn", "execution.pr"].map((path) => ({ path, trust: "studio" as const })),
    { path: "title", trust: "captain" }, { path: "request", trust: "captain" }, { path: "origin.grant", trust: "studio" },
    { path: "externalTitle", trust: "untrusted", source: "a Task title an external CLI wrote" }, { path: "externalRequest", trust: "untrusted", source: "a Task request an external CLI wrote" }, { path: "cancelReason", trust: "captain" }, { path: "execution.title", trust: "captain" },
    { path: "error", trust: "untrusted", source: "the failing step's error output" },
    { path: "failure.message", trust: "untrusted", source: "the failing step's underlying message" },
  ],
  list: (s, filter) => s.engine.list().filter((r) => (filter.archived === true || !r.archived) && (!filter.status || r.status === filter.status) && (filter.active !== true || !ENDED.includes(r.status)) && (!filter.workflow || r.workflow === filter.workflow)).map((r) => entity(s, r)),
  get: (s, id) => { const r = s.engine.get(id); return r ? entity(s, r) : null; },
});
