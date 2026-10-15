// /api/tasks: Tasks and their Rounds (docs/units/task-round.md). A Task is stored as a run, so the
// run routes stay as they were and answer under both names: /api/wruns is the old one, kept as an alias.
//   GET  /api/tasks                       unarchived Tasks (newest first); ?archived=1 includes archived
//   GET  /api/tasks/<id>                  one Task: the run view (/api/wruns/<id>) plus `task` and `rounds`
//   GET  /api/tasks/<id>/rounds           its Rounds only
//   POST /api/tasks, /api/tasks/<id>/<action>, /api/tasks/agents, …   the same as under /api/wruns
import type { Run } from "./runtime/engine";
import { roundsOf, summaryOf, taskOf } from "./task-round";

/** The /api/wruns path a /api/tasks path stands for, when the run routes serve it (null: served here, or not a task path). */
export function taskAlias(p: string, writing: boolean): string | null {
  if (p === "/api/tasks") return writing ? "/api/wruns" : null;
  const m = /^\/api\/tasks\/(.+)$/.exec(p);
  if (!m) return null;
  const rest = m[1];
  if (/^R-\d+$/.test(rest) && !writing) return null; // the Task view, served here
  if (/^R-\d+\/rounds$/.test(rest)) return null;
  return `/api/wruns/${rest}`;
}

export type TasksDeps = {
  list(): Run[]; get(id: string): Run | null | undefined; openCards(): any[];
  /** the run view the run routes serve for GET /api/wruns/<id> */
  runView(id: string): Promise<any | null>;
};

export function createTasksApi(d: TasksDeps) {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  async function handle(url: URL, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (writing || !/^\/api\/tasks(\/|$)/.test(p)) return null;
    if (p === "/api/tasks") {
      const cards = d.openCards();
      const tasks = d.list().filter((r) => url.searchParams.get("archived") === "1" || !r.archived).map((r) => summaryOf(taskOf(r, cards))).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return json({ tasks, cards });
    }
    const m = /^\/api\/tasks\/(R-\d+)(\/rounds)?$/.exec(p);
    if (!m) return null;
    const run = d.get(m[1]);
    if (!run) return json({ error: "no such task" }, 404);
    if (m[2]) return json({ task: run.id, rounds: roundsOf(run) });
    const view = await d.runView(run.id);
    const t = taskOf(run, d.openCards());
    return json({ ...(view ?? {}), task: summaryOf(t), rounds: t.rounds });
  }
  return { handle };
}
