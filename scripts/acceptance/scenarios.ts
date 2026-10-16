// Acceptance scenarios: one reviewed file per bundled workflow (tests/acceptance/<id>.yaml).
// They say which captain cards are safe to answer and how, what the run must end as, and which
// artifacts it must leave. The live acceptance driver (scripts/live-acceptance.ts) reads them;
// the stub-CLI acceptance harness imports this module too (see docs/live-acceptance.md).
//
// Card safety is an ALLOWLIST, never a name match. The driver answers a card only when every one
// of these holds, and stops otherwise:
//   - the scenario pins the workflow definition (sha256 of its nodes, edges, roles, params) and the
//     run's definition still has that hash;
//   - a rule names the card's node, its kind (only acceptance, question or plan) and an option the
//     card really offers;
//   - the card has options and no one-way door (its door, its detail.door or confirmDoor);
//   - a captain-only card is in CAPTAIN_ONLY_ALLOW, an exact (workflow, node, kind, option) pair
//     checked against the same pinned hash;
//   - every node the answer can reach before the next card runs only actions in LOCAL_ACTIONS
//     (the card's own node included when a hook or agent raised the card).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** The card kinds a rule may answer. Dispatch, scope, step-back, round-budget, merge, promote,
 *  permission, retro and any future kind are left to the captain. */
export const ANSWERABLE_KINDS = new Set(["acceptance", "question", "plan"]);

/**
 * Node actions (`do`) that stay inside this Mac and Studio's own data: intake, model rounds,
 * local renders, checks, exports into the run folder, Studio's local Library. Every other action
 * (pr.open, remote.ready, github.*, git.merge, lane.merge, firstmate.dispatch / launch /
 * project-*, fileorg.apply, pack-genesis-publish, staffing.activate, repo.cleanup, and any action
 * added later) counts as an external or irreversible effect until it is reviewed into this list.
 */
export const LOCAL_ACTIONS = new Set([
  "deliver.intake", "deliver.round", "deliver.render", "doc.export", "image.generate", "library.publish",
  "coffee.ready", "coffee.page-needed", "coffee.image-needed", "coffee.video-needed", "coffee.image", "coffee.video", "coffee.assemble", "coffee.library",
  "fileorg.plan", "fileorg.discard", "intent.capture", "pack-genesis-init", "note",
]);

/**
 * Captain-only cards the driver may answer on an ACCEPT Task: exact pairs, each bound to the
 * definition hash it was reviewed against. A changed definition voids its entries.
 */
export const CAPTAIN_ONLY_ALLOW: { workflow: string; sha256: string; node: string; kind: string; option: string }[] = [
  // deliver acceptance cards (src/domain/deliver.ts finalCard): approve-<producer> puts the approved
  // artifact into Studio's local Library; changes and reject stay the captain's
  { workflow: "documents", sha256: "63af62fcec510e63d89ab2dc3e746d2485b3e27c96982d6451627ac4bc455bbf", node: "accept", kind: "acceptance", option: "approve-draft" },
  { workflow: "images", sha256: "1105379109c7470bf5f9d194f32b3d3c34c5e6379cdeb8f0784f4d3b388e47bb", node: "accept", kind: "acceptance", option: "approve-draft" },
  { workflow: "video", sha256: "db7af80433b67b2769d5ceab8fbac05775e7be29ea763fe6ad6853e1613f711f", node: "accept", kind: "acceptance", option: "approve-draft" },
  { workflow: "web-prototype", sha256: "c3a939ff48c283bc43aff1bede54ff4915758902a9d4587f84651494351ec46c", node: "accept", kind: "acceptance", option: "approve-design-a" },
  { workflow: "web-prototype", sha256: "c3a939ff48c283bc43aff1bede54ff4915758902a9d4587f84651494351ec46c", node: "accept", kind: "acceptance", option: "approve-design-b" },
  // startup competition (src/domain/startup-recursion.ts): run the bundled template; accept the text result
  { workflow: "startup-recursion", sha256: "901c2e519c16c49348945b0283c3c7236c11f2c7079d3e5f01be8f1e3e694a29", node: "choose", kind: "question", option: "template" },
  { workflow: "startup-recursion", sha256: "901c2e519c16c49348945b0283c3c7236c11f2c7079d3e5f01be8f1e3e694a29", node: "accept", kind: "acceptance", option: "accept" },
];

export type CardRule = { node: string; kind?: string; action: "answer" | "wait" | "stop"; answer?: string; note?: string | null };
export type ArtifactExpectation = { deliver?: number; outputs?: number; file?: string };
export type Scenario = {
  schema: 2;
  workflow: string;
  /** the definition the scenario was reviewed against: sha256 of defHash; version is informational */
  pin: { sha256: string; version?: number };
  topic: string;
  /** what the board's Start form sends: its provider select (null = Studio's default) and, for the
   *  workflows whose own form sends them, those params */
  start: { provider: string | null; params: Record<string, string>; required_params?: string[] };
  /** vendors that must report signed in before a Task starts */
  providers: string[];
  /** staffing: confirm the Start form's staffing table (POST /api/wruns staffingConfirm) */
  approvals: { staffing: boolean };
  cards: CardRule[];
  /** status: the run's end status; result: its result (omitted: not checked; a run that ends on a
   *  hook without a result arg reports done); stop_at: instead, the run is accepted when it reaches
   *  this card and the driver stops there */
  expect: { status?: "succeeded" | "failed" | "cancelled"; result?: string | null; stop_at?: string; artifacts: ArtifactExpectation[] };
  budget: { wall_minutes: number; max_rounds: number };
  file?: string;
};

// ---------- the definition pin ----------
const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
/** sha256 of what a workflow does: id, kind, roles, params, policies, hooks, nodes (without layout) and edges. */
export function defHash(def: any): string {
  const nodes = (def?.nodes ?? []).map(({ x, y, ...n }: any) => n);
  const body = { id: def?.id, kind: def?.kind ?? null, roles: def?.roles ?? [], params: def?.params ?? {}, policies: def?.policies ?? null, hooks: def?.hooks ?? null, card_checks: def?.card_checks ?? null, nodes, edges: def?.edges ?? [] };
  return createHash("sha256").update(JSON.stringify(canon(body))).digest("hex");
}

function fail(where: string, msg: string): never { throw new Error(`${where}: ${msg}`); }
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const PROVIDERS = new Set(["claude", "codex", "stub"]);

export function validateScenario(raw: unknown, where = "scenario"): Scenario {
  if (!isObj(raw)) fail(where, "not a mapping");
  const s = raw as any;
  const known = ["schema", "workflow", "pin", "topic", "start", "providers", "approvals", "cards", "expect", "budget"];
  for (const k of Object.keys(s)) if (!known.includes(k)) fail(where, `unknown field ${k}`);
  if (s.schema !== 2) fail(where, "schema must be 2");
  if (typeof s.workflow !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(s.workflow)) fail(where, "workflow must be a workflow id");
  if (!isObj(s.pin) || typeof s.pin.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.pin.sha256) || (s.pin.version !== undefined && !Number.isInteger(s.pin.version)) || Object.keys(s.pin).some((k) => !["sha256", "version"].includes(k)))
    fail(where, "pin needs the workflow definition's sha256 (bun scripts/acceptance/pin.ts <id>)");
  if (typeof s.topic !== "string" || !s.topic.trim() || s.topic.length > 2000) fail(where, "topic must be a short brief");
  if (!isObj(s.start)) fail(where, "start must be a mapping");
  if (s.start.provider !== null && !PROVIDERS.has(s.start.provider)) fail(where, "start.provider must be null, claude, codex or stub");
  if (!isObj(s.start.params) || Object.values(s.start.params).some((v) => typeof v !== "string")) fail(where, "start.params must map names to strings");
  if (s.start.required_params !== undefined && (!Array.isArray(s.start.required_params) || s.start.required_params.some((p: unknown) => typeof p !== "string"))) fail(where, "start.required_params must list param names");
  if (!Array.isArray(s.providers) || s.providers.some((p: unknown) => !PROVIDERS.has(p as string))) fail(where, "providers must list claude, codex or stub");
  if (!isObj(s.approvals) || typeof s.approvals.staffing !== "boolean" || Object.keys(s.approvals).some((k) => k !== "staffing"))
    fail(where, "approvals has only staffing (true or false); dispatch and other approvals are the captain's");
  if (!Array.isArray(s.cards)) fail(where, "cards must be a list");
  const cards: CardRule[] = s.cards.map((c: any, i: number) => {
    const at = `${where} cards[${i}]`;
    if (!isObj(c) || typeof c.node !== "string" || !c.node) fail(at, "needs a node");
    for (const k of Object.keys(c)) if (!["node", "kind", "action", "answer", "note"].includes(k)) fail(at, `unknown field ${k}`);
    const action = c.action ?? (c.answer !== undefined ? "answer" : null);
    if (!["answer", "wait", "stop"].includes(action)) fail(at, "action must be answer, wait or stop");
    if (c.kind !== undefined && typeof c.kind !== "string") fail(at, "kind must be a card kind");
    if (action === "answer") {
      if (typeof c.answer !== "string" || !c.answer) fail(at, "an answer needs an option id");
      if (!ANSWERABLE_KINDS.has(c.kind)) fail(at, `an answer rule must name kind acceptance, question or plan (got ${c.kind ?? "none"}); other card kinds are the captain's`);
    } else if (c.answer !== undefined) fail(at, "only action answer takes an answer");
    if (c.note !== undefined && c.note !== null && (typeof c.note !== "string" || c.note.length > 500)) fail(at, "note must be short text");
    return { node: c.node, ...(c.kind ? { kind: c.kind } : {}), action, ...(action === "answer" ? { answer: c.answer, note: c.note ?? null } : {}) };
  });
  if (!isObj(s.expect)) fail(where, "expect must be a mapping");
  const e = s.expect;
  if (e.stop_at !== undefined && (typeof e.stop_at !== "string" || e.status !== undefined)) fail(where, "expect has either stop_at or status");
  if (e.stop_at === undefined && !["succeeded", "failed", "cancelled"].includes(e.status)) fail(where, "expect.status must be succeeded, failed or cancelled");
  if (e.result !== undefined && e.result !== null && typeof e.result !== "string") fail(where, "expect.result must be text or null");
  if (!Array.isArray(e.artifacts)) fail(where, "expect.artifacts must be a list (may be empty)");
  for (const a of e.artifacts) if (!isObj(a) || Object.keys(a).length !== 1 || !(Number.isInteger(a.deliver) || Number.isInteger(a.outputs) || typeof a.file === "string")) fail(where, "each artifact is one of {deliver: n}, {outputs: n}, {file: path}");
  if (!isObj(s.budget) || !(s.budget.wall_minutes > 0) || !(Number.isInteger(s.budget.max_rounds) && s.budget.max_rounds > 0)) fail(where, "budget needs wall_minutes > 0 and max_rounds > 0");
  return { schema: 2, workflow: s.workflow, pin: { sha256: s.pin.sha256, ...(s.pin.version !== undefined ? { version: s.pin.version } : {}) }, topic: s.topic.trim(),
    start: { provider: s.start.provider, params: { ...s.start.params }, ...(s.start.required_params ? { required_params: [...s.start.required_params] } : {}) },
    providers: [...s.providers], approvals: { staffing: s.approvals.staffing }, cards,
    expect: { ...(e.stop_at !== undefined ? { stop_at: e.stop_at } : { status: e.status, ...(e.result !== undefined ? { result: e.result } : {}) }), artifacts: e.artifacts.map((a: any) => ({ ...a })) },
    budget: { wall_minutes: Number(s.budget.wall_minutes), max_rounds: s.budget.max_rounds } };
}

export function loadScenario(file: string): Scenario {
  const raw = (Bun as any).YAML.parse(readFileSync(file, "utf8"));
  return { ...validateScenario(raw, file), file };
}

// ---------- the effect walk ----------
const whenSet = (w: unknown) => typeof w === "string" ? w.split("|").map((x) => x.trim()) : null;
/**
 * The first node the answer can reach before the next card whose action is not in LOCAL_ACTIONS,
 * or null. A card node's plain answer routes by the chosen option; a card raised by a hook, an
 * agent or a card mode may turn the choice into another outcome, so every edge out of it counts.
 * Past the first step every edge counts: which outcome a model or check produces is not known.
 */
export function externalEffect(def: any, node: string, choice: string): { node: string; do: string } | null {
  const nodes = new Map<string, any>((def?.nodes ?? []).map((n: any) => [n.id, n]));
  const edges: any[] = (def?.edges ?? []).map((e: any) => Array.isArray(e) ? { from: e[0], to: e[1], when: e[2] } : e);
  const own = nodes.get(node);
  if (!own) return { node, do: "(node not in the definition)" };
  const localDo = (n: any) => !n.do || LOCAL_ACTIONS.has(n.do);
  if (!localDo(own)) return { node, do: own.do };
  const plain = own.kind === "card" && !own.mode && !own.do && !own.args?.body_from;
  const first = edges.filter((e) => e.from === node && (!plain || !whenSet(e.when) || whenSet(e.when)!.includes(choice))).map((e) => e.to);
  const seen = new Set<string>(); const queue = [...first];
  while (queue.length) {
    const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
    const n = nodes.get(id); if (!n) return { node: id, do: "(node not in the definition)" };
    if (n.kind === "card") continue; // the next card is the next gate
    if (!localDo(n)) return { node: id, do: n.do };
    for (const e of edges) if (e.from === id) queue.push(e.to);
  }
  return null;
}

/** The card fields the decision reads (a /api/scards view). */
export type CardView = { id: string; node: string; kind: string; options?: { id: string; label?: string }[]; captainOnly?: boolean; confirmDoor?: boolean; door?: string | null; detail?: any };
export type Decision = { action: "answer"; choice: string; note: string | null } | { action: "wait" } | { action: "stop"; reason: string };

/** What the driver does with one open card of a run whose definition is `def`: answer it, leave it for a person, or stop. */
export function decideCard(s: Scenario, c: CardView, def: any): Decision {
  const stop = (reason: string): Decision => ({ action: "stop", reason: `${c.id} (${c.kind} on node ${c.node}): ${reason}` });
  const hash = defHash(def);
  if (def?.id !== s.workflow || hash !== s.pin.sha256) return stop(`the run's ${def?.id ?? "?"} definition (sha256 ${hash.slice(0, 12)}) is not the one this scenario pins (${s.pin.sha256.slice(0, 12)}); re-review the scenario`);
  const rule = s.cards.find((r) => r.node === c.node && (!r.kind || r.kind === c.kind));
  if (!rule) return stop("not listed in the scenario");
  if (rule.action === "stop") return stop("the scenario stops here");
  if (rule.action === "wait") return { action: "wait" };
  if (!ANSWERABLE_KINDS.has(c.kind) || rule.kind !== c.kind) return stop(`kind ${c.kind} is not answerable (only acceptance, question or plan, named by the rule)`);
  const doorKind = c.detail?.door?.kind ?? null;
  if (c.confirmDoor || (c.door != null && c.door !== "two-way") || (doorKind != null && doorKind !== "two-way")) return stop(`one-way door (door ${c.door ?? "-"}, detail.door ${doorKind ?? "-"}, confirmDoor ${!!c.confirmDoor}): the captain answers it`);
  if (c.detail?.remoteTarget) return stop("names a remote GitHub target: the captain answers it");
  if (!Array.isArray(c.options) || !c.options.length) return stop("offers no options, so the answer's effect cannot be checked");
  if (!c.options.some((o) => o.id === rule.answer)) return stop(`has no option ${rule.answer} (it offers ${c.options.map((o) => o.id).join(", ")})`);
  if (c.captainOnly && !CAPTAIN_ONLY_ALLOW.some((a) => a.workflow === s.workflow && a.sha256 === hash && a.node === c.node && a.kind === c.kind && a.option === rule.answer))
    return stop(`captain-only, and (${s.workflow}, ${c.node}, ${c.kind}, ${rule.answer}) at this definition is not in CAPTAIN_ONLY_ALLOW`);
  const effect = externalEffect(def, c.node, rule.answer!);
  if (effect) return stop(`answering ${rule.answer} can reach ${effect.node} (${effect.do}) before another card: an external or irreversible effect`);
  return { action: "answer", choice: rule.answer!, note: rule.note ?? null };
}
