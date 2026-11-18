// One Task as the board's Tasks list shows it (GET /api/tasks): the route and Studio's observe provider (src/observe/kinds/task.ts)
// both call this, so what an agent reads of a Task is what the captain's list shows.
import { taskTitle } from "../task-title";
import type { Engine, Run } from "./engine";

export function taskRow(engine: Engine, r: Run) {
  return { id: r.id, workflow: r.workflow, version: r.version, title: taskTitle(r), request: r.text, status: r.status, project: engine.projectRow(r), result: r.result, createdAt: r.createdAt, updatedAt: r.updatedAt, endedAt: r.endedAt, error: r.error,
    childRun: (() => { const child = engine.get(r.ctx?.childRun); return child?.params?._firstmateProposal === r.id ? child.id : null; })(),
    archived: !!r.archived, origin: engine.externalOrigin?.(r) ?? null, merged: !!r.ctx?.merged, reconciled: r.reconciled && (() => { const t = engine.trusted(r.id); return t.ok && t.entries.some((e) => e.record === "reconciled-merge" && e.seq === r.reconciled!.ledger); })() ? r.reconciled : null, cancelReason: r.cancelReason ?? null,
    current: Object.entries(r.nodes).filter(([, n]) => ["running", "waiting"].includes(n.state)).map(([k, n]) => ({ node: k, state: n.state, waiting: n.waiting ?? null, label: r.def.nodes.find((x) => x.id === k)?.label ?? k })), door: engine.cards.list({ run: r.id }).find((c) => c.door)?.door ?? null, recovered: r.recovered };
}
