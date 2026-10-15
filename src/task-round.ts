// Task and Round (docs/units/task-round.md).
//   Workflow  the template (code-firstmate).
//   Task      one piece of work going through a workflow once (stored as a run, id R-NNN).
//   Round     one launch of an agent or a check inside a Task (build round 2, review round 3), and the cards
//             a person answers on the way.
// Rounds are derived from a run's steps (its node visits): no stored data changes, the store reads runs as they are.
import type { Run, Step } from "./runtime/engine";

export type Text = { en: string; "zh-TW": string };
export type Cost = { usd: number | null; inTokens: number | null; outTokens: number | null; seconds: number | null };
/** a step's state; a card a person answered is "chosen" (its choice in `verdict`) */
export type RoundOutcome = "running" | "waiting" | "passed" | "failed" | "error" | "chosen" | "interrupted" | "skipped" | "superseded" | "swapped";
export type RoundActor = { kind: "agent" | "check" | "card"; role: string | null; name: string | null; label: string; provider: string | null; model: string | null };
export type Round = {
  id: string; task: string; seq: number; node: string; actor: RoundActor; number: number; attempt: number;
  startedAt: string | null; endedAt: string | null; outcome: RoundOutcome; verdict: string | null; reason: Text | null;
  cost: Cost | null; transcript: string | null; note: string | null;
};
export type TaskStatus = "queued" | "running" | "waiting" | "needs-you" | "paused" | "failed" | "done" | "cancelled" | "idle";
export type TaskView = {
  id: string; workflow: string; version: number | null; title: string; project: string | null;
  /** one word for the Board and Inbox; `state` keeps the run's own status */
  status: TaskStatus; state: string; node: string | null;
  createdAt: string | null; updatedAt: string | null; endedAt: string | null; href: string; roundCount: number;
};
export type TaskDetail = TaskView & { rounds: Round[] };

export const TASK_ID = /^R-\d+$/;

/** The node kinds whose steps are Rounds: an agent or a check launch, and a card a person answers. */
const ROUND_KINDS = new Set(["agent", "check", "card"]);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function addCost(a: Cost | null, c: any): Cost | null {
  if (!c) return a;
  const base: Cost = a ?? { usd: null, inTokens: null, outTokens: null, seconds: null };
  const plus = (x: number | null, y: unknown) => (num(y) == null ? x : (x ?? 0) + (y as number));
  return { usd: plus(base.usd, c.usd), inTokens: plus(base.inTokens, c.inTokens), outTokens: plus(base.outTokens, c.outTokens), seconds: plus(base.seconds, c.seconds) };
}

/** the checks a check Round ran (the step's record), else the ones its node names */
const checkNames = (s: Step, def: any): string | null =>
  ((s.checks ?? []).map((c) => c.check).join(", ") || (Array.isArray(def?.checks) ? def.checks.map((c: any) => c?.use).filter(Boolean).join(", ") : "")) || null;

function stepOutcome(s: Step): RoundOutcome {
  if (s.kind === "card" && s.state === "passed") return "chosen";
  return s.state as RoundOutcome;
}

/** A Task's Rounds, in order: one per agent, check or card step. Attempts of one visit share its number. */
export function roundsOf(run: Run): Round[] {
  const attempts = new Map<string, number>();
  const out: Round[] = [];
  for (const s of run.steps ?? []) {
    if (!ROUND_KINDS.has(s.kind)) continue;
    const key = `${s.node}#${s.visit}`;
    const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt);
    const def: any = run.def?.nodes?.find((n: any) => n.id === s.node) ?? null;
    const jobs: any[] = Array.isArray(run.nodes?.[s.node]?.data?.jobs) ? run.nodes[s.node].data.jobs : [];
    let cost: Cost | null = null;
    if (s.job) for (const j of jobs) if (j?.id === s.job) cost = addCost(cost, j.cost);
    if (cost && s.startedAt && s.endedAt) cost.seconds = Math.max(0, (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000);
    const kind = s.kind as RoundActor["kind"];
    const role = kind === "agent" ? def?.role ?? null : kind === "card" ? "captain" : null;
    out.push({
      id: `${run.id}/${s.node}/${s.visit}${attempt > 1 ? `.${attempt}` : ""}`, task: run.id, seq: s.seq, node: s.node,
      actor: { kind, role, name: kind === "check" ? checkNames(s, def) : null, label: def?.label ?? s.node, provider: s.provider ?? null, model: s.model ?? null },
      number: s.visit, attempt, startedAt: s.startedAt ?? null, endedAt: s.endedAt ?? null, outcome: stepOutcome(s),
      verdict: kind === "card" && s.state === "passed" ? s.outcome : null, reason: s.error ? { en: s.error, "zh-TW": s.error } : null,
      cost, transcript: kind === "agent" ? `#/runs/node/${encodeURIComponent(run.id)}/${encodeURIComponent(s.node)}/${s.visit}` : null, note: s.note ?? null,
    });
  }
  return out;
}

const STUDIO_STATUS: Record<string, TaskStatus> = { queued: "queued", running: "running", waiting: "waiting", paused: "paused", succeeded: "done", failed: "failed", cancelled: "cancelled" };

/** A run as a Task. `openCards` are the run's unanswered cards: a run waiting on one needs the captain. */
export function taskOf(run: Run, openCards: { run?: string | null }[] = []): TaskDetail {
  const rounds = roundsOf(run);
  const live = Object.entries(run.nodes ?? {}).find(([, n]) => n.state === "running") ?? Object.entries(run.nodes ?? {}).find(([, n]) => n.state === "pending" && n.waiting);
  let status = STUDIO_STATUS[run.status] ?? "idle";
  if ((run.status === "running" || run.status === "waiting") && openCards.some((c) => c.run === run.id)) status = "needs-you";
  const last = [...(run.steps ?? [])].reverse().find((s) => s.state === "running" || s.state === "waiting");
  return {
    id: run.id, workflow: run.workflow, version: run.version ?? null, title: run.title ?? "", project: run.params?.project || null,
    status, state: run.status, node: live?.[0] ?? last?.node ?? null,
    createdAt: run.createdAt ?? null, updatedAt: run.updatedAt ?? null, endedAt: run.endedAt ?? null, href: `#/run/${run.id}`, roundCount: rounds.length, rounds,
  };
}

export const summaryOf = (t: TaskDetail): TaskView => { const { rounds, ...rest } = t; return rest; };
