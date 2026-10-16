// Acceptance scenarios: one reviewed file per bundled workflow (workflows/acceptance/<id>.yaml).
// They say which captain cards are safe to answer and how, what the run must end as, and which
// artifacts it must leave. The live acceptance driver (scripts/live-acceptance.ts) reads them;
// the stub-CLI acceptance harness is meant to read the same list (see docs/live-acceptance.md).
//
// Safety does not rest on the files alone: decideCard refuses irreversible or external cards
// (merge, publish, push, GitHub, a one-way door) even when a scenario lists them, and
// validateScenario refuses a file that tries to answer one.
import { readFileSync } from "node:fs";

export type CardRule = {
  node: string;
  /** match only cards of this kind (dispatch, question, acceptance, ...) */
  kind?: string;
  /** answer: post this option; wait: leave the card for a person on the board; stop: stop the run here */
  action: "answer" | "wait" | "stop";
  answer?: string;
  note?: string | null;
  /** a card the engine marks captain-only may be answered by the driver only with this set */
  captain_only?: boolean;
};
export type ArtifactExpectation = { deliver?: number; outputs?: number; file?: string };
export type Scenario = {
  schema: 1;
  workflow: string;
  topic: string;
  /** what the board's Start form sends: its provider select (null = Studio's default) and, for the
   *  workflows whose own form sends them, those params */
  start: { provider: string | null; params: Record<string, string>; required_params?: string[] };
  /** vendors that must report signed in before a Task starts */
  providers: string[];
  approvals: { staffing: boolean; dispatch: boolean };
  cards: CardRule[];
  /** status: the run's end status; result: its result (null when the workflow sets none);
   *  (omitted: not checked; a run that ends on a hook without a result arg reports done);
   *  stop_at: instead, the run is accepted when it reaches this card and the driver stops there */
  expect: { status?: "succeeded" | "failed" | "cancelled"; result?: string | null; stop_at?: string; artifacts: ArtifactExpectation[] };
  budget: { wall_minutes: number; max_rounds: number };
  file?: string;
};

/** Option ids, node ids and card kinds that name an irreversible or external step. */
export const IRREVERSIBLE = /(^|[-_.:])(merge|merged|publish|push|pr|github|deploy|release|ship|force)([-_.:]|$)/i;
const UNSAFE_KINDS = new Set(["merge", "promote"]);
const PROVIDERS = new Set(["claude", "codex", "stub"]);

function fail(where: string, msg: string): never { throw new Error(`${where}: ${msg}`); }
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

export function validateScenario(raw: unknown, where = "scenario"): Scenario {
  if (!isObj(raw)) fail(where, "not a mapping");
  const s = raw as any;
  const known = ["schema", "workflow", "topic", "start", "providers", "approvals", "cards", "expect", "budget"];
  for (const k of Object.keys(s)) if (!known.includes(k)) fail(where, `unknown field ${k}`);
  if (s.schema !== 1) fail(where, "schema must be 1");
  if (typeof s.workflow !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(s.workflow)) fail(where, "workflow must be a workflow id");
  if (typeof s.topic !== "string" || !s.topic.trim() || s.topic.length > 2000) fail(where, "topic must be a short brief");
  if (!isObj(s.start)) fail(where, "start must be a mapping");
  if (s.start.provider !== null && !PROVIDERS.has(s.start.provider)) fail(where, "start.provider must be null, claude, codex or stub");
  if (!isObj(s.start.params) || Object.values(s.start.params).some((v) => typeof v !== "string")) fail(where, "start.params must map names to strings");
  if (s.start.required_params !== undefined && (!Array.isArray(s.start.required_params) || s.start.required_params.some((p: unknown) => typeof p !== "string"))) fail(where, "start.required_params must list param names");
  if (!Array.isArray(s.providers) || s.providers.some((p: unknown) => !PROVIDERS.has(p as string))) fail(where, "providers must list claude, codex or stub");
  if (!isObj(s.approvals) || typeof s.approvals.staffing !== "boolean" || typeof s.approvals.dispatch !== "boolean") fail(where, "approvals needs staffing and dispatch, true or false");
  if (!Array.isArray(s.cards)) fail(where, "cards must be a list");
  const cards: CardRule[] = s.cards.map((c: any, i: number) => {
    const at = `${where} cards[${i}]`;
    if (!isObj(c) || typeof c.node !== "string" || !c.node) fail(at, "needs a node");
    for (const k of Object.keys(c)) if (!["node", "kind", "action", "answer", "note", "captain_only"].includes(k)) fail(at, `unknown field ${k}`);
    const action = c.action ?? (c.answer !== undefined ? "answer" : null);
    if (!["answer", "wait", "stop"].includes(action)) fail(at, "action must be answer, wait or stop");
    if (action === "answer" && (typeof c.answer !== "string" || !c.answer)) fail(at, "an answer needs an option id");
    if (action !== "answer" && c.answer !== undefined) fail(at, "only action answer takes an answer");
    if (action === "answer" && (IRREVERSIBLE.test(c.answer) || IRREVERSIBLE.test(c.node) || (c.kind && UNSAFE_KINDS.has(c.kind))))
      fail(at, `answering ${c.node} with ${c.answer} is irreversible or external: the driver never answers it`);
    if (c.kind !== undefined && typeof c.kind !== "string") fail(at, "kind must be a card kind");
    if (c.note !== undefined && c.note !== null && (typeof c.note !== "string" || c.note.length > 500)) fail(at, "note must be short text");
    if (c.captain_only !== undefined && typeof c.captain_only !== "boolean") fail(at, "captain_only must be true or false");
    return { node: c.node, ...(c.kind ? { kind: c.kind } : {}), action, ...(action === "answer" ? { answer: c.answer, note: c.note ?? null } : {}), ...(c.captain_only ? { captain_only: true } : {}) };
  });
  if (!isObj(s.expect)) fail(where, "expect must be a mapping");
  const e = s.expect;
  if (e.stop_at !== undefined && (typeof e.stop_at !== "string" || e.status !== undefined)) fail(where, "expect has either stop_at or status");
  if (e.stop_at === undefined && !["succeeded", "failed", "cancelled"].includes(e.status)) fail(where, "expect.status must be succeeded, failed or cancelled");
  if (e.result !== undefined && e.result !== null && typeof e.result !== "string") fail(where, "expect.result must be text or null");
  if (!Array.isArray(e.artifacts)) fail(where, "expect.artifacts must be a list (may be empty)");
  for (const a of e.artifacts) if (!isObj(a) || Object.keys(a).length !== 1 || !(Number.isInteger(a.deliver) || Number.isInteger(a.outputs) || typeof a.file === "string")) fail(where, "each artifact is one of {deliver: n}, {outputs: n}, {file: path}");
  if (!isObj(s.budget) || !(s.budget.wall_minutes > 0) || !(Number.isInteger(s.budget.max_rounds) && s.budget.max_rounds > 0)) fail(where, "budget needs wall_minutes > 0 and max_rounds > 0");
  return { schema: 1, workflow: s.workflow, topic: s.topic.trim(), start: { provider: s.start.provider, params: { ...s.start.params }, ...(s.start.required_params ? { required_params: [...s.start.required_params] } : {}) },
    providers: [...s.providers], approvals: { staffing: s.approvals.staffing, dispatch: s.approvals.dispatch }, cards,
    expect: { ...(e.stop_at !== undefined ? { stop_at: e.stop_at } : { status: e.status, ...(e.result !== undefined ? { result: e.result } : {}) }), artifacts: e.artifacts.map((a: any) => ({ ...a })) },
    budget: { wall_minutes: Number(s.budget.wall_minutes), max_rounds: s.budget.max_rounds } };
}

export function loadScenario(file: string): Scenario {
  const raw = (Bun as any).YAML.parse(readFileSync(file, "utf8"));
  return { ...validateScenario(raw, file), file };
}

/** The card fields the decision reads (a /api/scards view). */
export type CardView = { id: string; node: string; kind: string; options?: { id: string; label?: string }[]; captainOnly?: boolean; confirmDoor?: boolean; door?: string | null; detail?: any };
export type Decision = { action: "answer"; choice: string; note: string | null } | { action: "wait" } | { action: "stop"; reason: string };

/** What the driver does with one open card: answer it, leave it for a person, or stop. */
export function decideCard(s: Scenario, c: CardView): Decision {
  // never, whatever the scenario says
  if (UNSAFE_KINDS.has(c.kind)) return { action: "stop", reason: `${c.id} is a ${c.kind} card: irreversible, the captain answers it` };
  if (c.detail?.remoteTarget) return { action: "stop", reason: `${c.id} names a remote GitHub target: external, the captain answers it` };
  if (c.confirmDoor) return { action: "stop", reason: `${c.id} asks for a one-way door confirmation: the captain answers it` };
  if (IRREVERSIBLE.test(c.node)) return { action: "stop", reason: `${c.id} sits on node ${c.node}, which names an irreversible or external step` };
  if (c.kind === "dispatch" && !s.approvals.dispatch) return { action: "stop", reason: `${c.id} is a dispatch approval and this scenario does not allow dispatch approvals` };
  if (/staffing/.test(c.node) && !s.approvals.staffing) return { action: "stop", reason: `${c.id} is a staffing approval and this scenario does not allow staffing approvals` };
  const rule = s.cards.find((r) => r.node === c.node && (!r.kind || r.kind === c.kind));
  if (!rule) return { action: "stop", reason: `${c.id} (${c.kind} on node ${c.node}) is not listed as safe in the scenario` };
  if (rule.action === "stop") return { action: "stop", reason: `${c.id} on node ${c.node}: the scenario stops here` };
  if (rule.action === "wait") return { action: "wait" };
  if (c.captainOnly && !rule.captain_only) return { action: "stop", reason: `${c.id} is captain-only and the scenario does not allow answering it` };
  const option = (c.options ?? []).find((o) => o.id === rule.answer);
  if (c.options && !option) return { action: "stop", reason: `${c.id} has no option ${rule.answer} (it offers ${(c.options ?? []).map((o) => o.id).join(", ") || "none"})` };
  if (IRREVERSIBLE.test(rule.answer!)) return { action: "stop", reason: `${c.id}: option ${rule.answer} is irreversible or external` };
  return { action: "answer", choice: rule.answer!, note: rule.note ?? null };
}
