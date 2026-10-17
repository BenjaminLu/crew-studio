// Task and Round (docs/units/task-round.md).
//   Workflow  the template (code-firstmate).
//   Task      one piece of work going through a workflow once (stored as a run, id R-NNN).
//   Round     one launch of an agent or a check inside a Task (build round 2, review round 3), and the cards
//             a person answers on the way.
// Rounds are derived from a run's steps (its node visits): no stored data changes, the store reads runs as they are.
import { taskTitle } from "./task-title";
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
  /** the captain's full request; `title` is its short name */
  request: string;
  /** one word for the Board and Inbox; `state` keeps the run's own status */
  status: TaskStatus; state: string; node: string | null;
  createdAt: string | null; updatedAt: string | null; endedAt: string | null; href: string; roundCount: number;
  /** the run's result once it ended (closed, fail, …): `status` folds succeeded into done */
  result: string | null;
  /** who the Task waits on now (§3.3 of the projects design) */
  waitsOn: WaitsOn;
};
/**
 * Who a Task waits on. kind: captain (an open card on a waiting node), hold (a round that is not ready, with its
 * captain-only recovery card), queue (project or global capacity), ci (remote checks), agent (a running round), none.
 */
export type WaitsOn = {
  kind: "captain" | "hold" | "agent" | "queue" | "ci" | "none";
  node: string | null; nodeLabel: string | null; card: string | null;
  /** hold: the readiness reason; staffing is true when the hold is the crew-approval variant */
  reason?: string | null; staffing?: boolean;
  /** agent: the round's role and pick */
  role?: string | null; provider?: string | null; model?: string | null; effort?: string | null;
  /** ci: the wait's deadline (epoch ms); queue: the queue's own reason text */
  deadline?: number | null;
  detail: Text;
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
    id: run.id, workflow: run.workflow, version: run.version ?? null, title: taskTitle(run), request: run.text ?? "", project: run.params?.project || null,
    status, state: run.status, node: live?.[0] ?? last?.node ?? null,
    createdAt: run.createdAt ?? null, updatedAt: run.updatedAt ?? null, endedAt: run.endedAt ?? null, href: `#/run/${run.id}`, roundCount: rounds.length,
    result: run.result ?? null, waitsOn: waitsOn(run, openCards as any), rounds,
  };
}

export const summaryOf = (t: TaskDetail): TaskView => { const { rounds, ...rest } = t; return rest; };

const STAFFING_HOLD = /staffing|role configuration|角色配置|派工配置/i;
const nodeDef = (run: Run, id: string): any => run.def?.nodes?.find((n: any) => n.id === id) ?? null;
/** "(a/b)" from a queue reason such as "project capacity full (2/2)", when it carries one */
const capacityOf = (reason: string) => /\((\d+)\s*\/\s*(\d+)\)/.exec(reason);
/**
 * Who a Task waits on (projects design §3.3), first match: an open card on a waiting node (a readiness hold when the
 * node carries one), a readiness hold, a queue wait, a remote CI wait, a running round with a job, else none.
 * Reads the run as stored; no state changes.
 */
export function waitsOn(run: Run, openCards: { id?: string; run?: string | null; node?: string; status?: string }[] = [], capacity: { active: number; limit: number } | null = null): WaitsOn {
  const ended = ["succeeded", "failed", "cancelled"].includes(run.status);
  const none: WaitsOn = { kind: "none", node: null, nodeLabel: null, card: null, detail: { en: "", "zh-TW": "" } };
  if (ended) return none;
  const nodes = Object.entries(run.nodes ?? {});
  const label = (id: string) => nodeDef(run, id)?.label ?? id;
  const mine = openCards.filter((c) => c.run === run.id && (c.status === undefined || c.status === "open"));
  const hold = (id: string, rn: any, card: string | null): WaitsOn => {
    const reason = String(rn.data?.nativeQueueCapability?.reason ?? "");
    const staffing = STAFFING_HOLD.test(reason);
    const why = staffing ? { en: "crew needs approval", "zh-TW": "船員配置待核准" } : { en: reason || "readiness needs confirmation", "zh-TW": reason || "就緒狀態需要確認" };
    return { kind: "hold", node: id, nodeLabel: label(id), card, reason, staffing, detail: { en: `Round not ready: ${why.en}`, "zh-TW": `這一輪還不能開始：${why["zh-TW"]}` } };
  };
  // 1. an open card on a waiting node (a readiness hold's card reads as the hold)
  for (const [id, rn] of nodes) {
    if (rn.waiting !== "card") continue;
    const card = mine.find((c) => c.node === id && (!rn.card || c.id === rn.card)) ?? mine.find((c) => c.node === id);
    if (!card) continue;
    if (rn.data?.nativeQueueCapability) return hold(id, rn, card.id ?? null);
    return { kind: "captain", node: id, nodeLabel: label(id), card: card.id ?? null, detail: { en: `at ${label(id)}`, "zh-TW": `在「${label(id)}」` } };
  }
  // 2. a readiness hold whose card is not (or no longer) open
  for (const [id, rn] of nodes) if (rn.state === "running" && rn.data?.nativeQueueCapability) return hold(id, rn, rn.card ?? null);
  // 3. a queue wait
  for (const [id, rn] of nodes) if (rn.state === "running" && rn.data?.nativeQueue?.state === "waiting") {
    const reason = String(rn.data.nativeQueue.reason ?? "");
    const m = capacityOf(reason), full = /capacity/i.test(reason);
    const cap = m ? [Number(m[1]), Number(m[2])] : full && capacity ? [capacity.active, capacity.limit] : null;
    const en = cap ? `queue: project capacity full (${cap[0]}/${cap[1]})` : full ? "queue: capacity full" : `queue: ${reason || "waiting for capacity"}`;
    const zh = cap ? `佇列：專案名額已滿（${cap[0]}/${cap[1]}）` : full ? "佇列：名額已滿" : `佇列：${reason || "等待名額"}`;
    return { kind: "queue", node: id, nodeLabel: label(id), card: null, reason, detail: { en, "zh-TW": zh } };
  }
  // 4. a remote CI wait
  for (const [id, rn] of nodes) if (rn.waiting === "external" && rn.data?.external?.handler === "github-ci") {
    const deadline = Number.isFinite(rn.data.external.deadline) ? rn.data.external.deadline : null;
    const left = deadline ? Math.max(0, Math.round((deadline - Date.now()) / 60000)) : null;
    return { kind: "ci", node: id, nodeLabel: label(id), card: null, deadline,
      detail: { en: `CI: GitHub checks${left != null ? ` · ${left} min left` : ""}`, "zh-TW": `CI：GitHub 檢查${left != null ? ` · 剩 ${left} 分鐘` : ""}` } };
  }
  // 5. a running round with a job
  for (const [id, rn] of nodes) if (rn.state === "running" && rn.job && !rn.waiting) {
    const def = nodeDef(run, id);
    const step = [...(run.steps ?? [])].reverse().find((s) => s.node === id && s.state === "running");
    const job = Array.isArray(rn.data?.jobs) ? rn.data.jobs.find((j: any) => j?.id === rn.job) : null;
    const role = def?.role ?? def?.args?.role ?? null;
    const provider = rn.agent?.provider ?? step?.provider ?? job?.provider ?? null;
    const model = rn.agent?.model ?? step?.model ?? job?.model ?? null;
    const effort = rn.agent?.effort ?? null;
    const who = [role ?? label(id), [provider, model, effort].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    return { kind: "agent", node: id, nodeLabel: label(id), card: null, role, provider, model, effort, detail: { en: `agent: ${who}`, "zh-TW": `代理：${who}` } };
  }
  return none;
}
