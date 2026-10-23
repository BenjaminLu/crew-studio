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
//     (the card's own node included when a hook or agent raised the card), and the next card it
//     reaches has a reviewed mode and body builder (its start code runs when it opens).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The one scenario list: the live driver and the stub-CLI harness (tests/acceptance.ts) both read it. */
export const SCENARIO_DIR = join(import.meta.dir, "../../tests/acceptance");
export const scenarioFiles = (dir = SCENARIO_DIR) => readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort().map((f) => join(dir, f));

/** The card kinds a rule may answer. Dispatch, scope, step-back, round-budget, merge, promote,
 *  permission, retro and any future kind are left to the captain. */
export const ANSWERABLE_KINDS = new Set(["acceptance", "question", "plan"]);

/**
 * Node actions (`do`) that stay inside this Mac and Studio's own data: intake, model rounds,
 * local renders, exports into the run folder, Studio's local Library. Every other action counts
 * as an external, irreversible or captain-directed effect until it is reviewed into this list:
 * pr.open, remote.ready, github.*, git.merge, lane.merge, firstmate.*, fileorg.apply,
 * pack-genesis-publish, staffing.activate, repo.cleanup, the coffee kit's paid generation
 * (coffee.image, coffee.video: the captain directs it), and any action added later.
 */
export const LOCAL_ACTIONS = new Set([
  "deliver.intake", "deliver.round", "deliver.render", "doc.export", "image.generate", "library.publish",
  "coffee.ready", "coffee.page-needed", "coffee.image-needed", "coffee.video-needed", "coffee.assemble", "coffee.library",
  "fileorg.plan", "fileorg.discard", "intent.capture", "pack-genesis-init",
]);

/** Card modes whose code was reviewed, both the start that raises the card and the answer: it only
 *  records the choice, approves an artifact into the local Library, or starts the workflow's own
 *  model rounds. Any other mode stops, on the answered card and on a card the walk reaches. */
export const REVIEWED_CARD_MODES = new Set(["deliver-accept", "startup-choice", "startup-accept"]);

/** Card body builders (args.body_from, engine.cardBodies) whose start code was reviewed: each only
 *  formats the card from the Task's context or a local store (src/domain/code.ts, deliver.ts,
 *  src/pack-genesis.ts). A card the walk reaches runs its builder when it opens, so any other
 *  builder stops; `merge`, for one, reads the pull request and its CI from GitHub. */
export const REVIEWED_CARD_BODIES = new Set(["dispatch", "door", "budget", "step-back", "stalled", "scope", "fileorg", "lane", "pack-interview", "pack-publish", "deliver-escalation", "render-capability"]);

/** Card `effects` (e.g. {policy: round_cap, add: 2}) the driver may set off: none yet. */
export const ALLOWED_CARD_EFFECTS: { workflow: string; node: string; option: string }[] = [];

/**
 * Captain-only cards the driver may answer on an ACCEPT Task: exact pairs, each bound to the
 * definition hash it was reviewed against. A changed definition voids its entries.
 */
export const CAPTAIN_ONLY_ALLOW: { workflow: string; sha256: string; node: string; kind: string; option: string }[] = [
  // deliver acceptance cards (src/domain/deliver.ts finalCard): approve-<producer> puts the approved
  // artifact into Studio's local Library; changes and reject stay the captain's
  { workflow: "documents", sha256: "688585e39d1aa2f22e5ed6e60f1d7bb1a4cde24188a8de81a3d5a78221b06e6d", node: "accept", kind: "acceptance", option: "approve-draft" },
  { workflow: "images", sha256: "44906e97aaa39844b23ec8397964eeb2b8627d185b1174df2c2d08fde5dcd1dd", node: "accept", kind: "acceptance", option: "approve-draft" },
  { workflow: "video", sha256: "94e2604c0eef113c33bb812c1598366144f6734f7bf6313d1357e40b129fb185", node: "accept", kind: "acceptance", option: "approve-draft" },
  { workflow: "web-prototype", sha256: "6a6a532393a166f189e246acafc489119582aa2fec86cd579e7f3870cfe2ba5c", node: "accept", kind: "acceptance", option: "approve-design-a" },
  { workflow: "web-prototype", sha256: "6a6a532393a166f189e246acafc489119582aa2fec86cd579e7f3870cfe2ba5c", node: "accept", kind: "acceptance", option: "approve-design-b" },
  // startup competition (src/domain/startup-recursion.ts): run the bundled template; accept the text result
  { workflow: "startup-recursion", sha256: "bcd48b6f8d8cbf9c59fd18d6729556d67ba4856a5b59db2a597afa739fa811b6", node: "choose", kind: "question", option: "template" },
  { workflow: "startup-recursion", sha256: "bcd48b6f8d8cbf9c59fd18d6729556d67ba4856a5b59db2a597afa739fa811b6", node: "accept", kind: "acceptance", option: "accept" },
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
  /** false: the board cannot start this workflow (internal to Firstmate, or retired); the live driver skips it */
  live?: boolean;
  /** the offline stub-CLI harness's runs of this workflow (tests/acceptance/stub.ts validates them) */
  stub?: unknown[];
  file?: string;
};

// ---------- the definition pin ----------
const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
/** sha256 of what a workflow does: id, kind, roles, params, policies, hooks, nodes (without layout) and edges. */
/** A held workflow (GET /api/wf/:id "held"): kept and editable, but no Task starts until its runtime is activated.
 *  The driver stops before any start with this reason instead of reaching the start route's refusal. */
export function heldStop(workflow: string, view: any): string | null {
  const held = view?.held;
  return held && typeof held.en === "string" ? `workflow ${workflow} is held (${held.en}): the board does not offer it for a new Task` : null;
}
export function defHash(def: any): string {
  const nodes = (def?.nodes ?? []).map(({ x, y, ...n }: any) => n);
  const body = { id: def?.id, kind: def?.kind ?? null, roles: def?.roles ?? [], params: def?.params ?? {}, policies: def?.policies ?? null, hooks: def?.hooks ?? null, card_checks: def?.card_checks ?? null, nodes, edges: def?.edges ?? [] };
  return createHash("sha256").update(JSON.stringify(canon(body))).digest("hex");
}

function fail(where: string, msg: string): never { throw new Error(`${where}: ${msg}`); }
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const PROVIDERS = new Set(["claude", "codex", "cursor", "stub"]);

export function validateScenario(raw: unknown, where = "scenario"): Scenario {
  if (!isObj(raw)) fail(where, "not a mapping");
  const s = raw as any;
  const known = ["schema", "workflow", "pin", "topic", "start", "providers", "approvals", "cards", "expect", "budget", "live", "stub"];
  for (const k of Object.keys(s)) if (!known.includes(k)) fail(where, `unknown field ${k}`);
  if (s.schema !== 2) fail(where, "schema must be 2");
  if (typeof s.workflow !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(s.workflow)) fail(where, "workflow must be a workflow id");
  if (!isObj(s.pin) || typeof s.pin.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.pin.sha256) || (s.pin.version !== undefined && !Number.isInteger(s.pin.version)) || Object.keys(s.pin).some((k) => !["sha256", "version"].includes(k)))
    fail(where, "pin needs the workflow definition's sha256 (bun scripts/acceptance/pin.ts <id>)");
  if (typeof s.topic !== "string" || !s.topic.trim() || s.topic.length > 2000) fail(where, "topic must be a short brief");
  if (!isObj(s.start)) fail(where, "start must be a mapping");
  if (s.start.provider !== null && !PROVIDERS.has(s.start.provider)) fail(where, "start.provider must be null, claude, codex, cursor or stub");
  if (!isObj(s.start.params) || Object.values(s.start.params).some((v) => typeof v !== "string")) fail(where, "start.params must map names to strings");
  if (s.start.required_params !== undefined && (!Array.isArray(s.start.required_params) || s.start.required_params.some((p: unknown) => typeof p !== "string"))) fail(where, "start.required_params must list param names");
  if (!Array.isArray(s.providers) || s.providers.some((p: unknown) => !PROVIDERS.has(p as string))) fail(where, "providers must list claude, codex, cursor or stub");
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
  if (s.live !== undefined && typeof s.live !== "boolean") fail(where, "live must be true or false");
  if (s.stub !== undefined && (!Array.isArray(s.stub) || s.stub.some((r: unknown) => !isObj(r)))) fail(where, "stub must be a list of offline runs");
  if (!isObj(s.budget) || !(s.budget.wall_minutes > 0) || !(Number.isInteger(s.budget.max_rounds) && s.budget.max_rounds > 0)) fail(where, "budget needs wall_minutes > 0 and max_rounds > 0");
  return { schema: 2, workflow: s.workflow, pin: { sha256: s.pin.sha256, ...(s.pin.version !== undefined ? { version: s.pin.version } : {}) }, topic: s.topic.trim(),
    start: { provider: s.start.provider, params: { ...s.start.params }, ...(s.start.required_params ? { required_params: [...s.start.required_params] } : {}) },
    providers: [...s.providers], approvals: { staffing: s.approvals.staffing }, cards,
    expect: { ...(e.stop_at !== undefined ? { stop_at: e.stop_at } : { status: e.status, ...(e.result !== undefined ? { result: e.result } : {}) }), artifacts: e.artifacts.map((a: any) => ({ ...a })) },
    budget: { wall_minutes: Number(s.budget.wall_minutes), max_rounds: s.budget.max_rounds },
    ...(s.live !== undefined ? { live: s.live } : {}), ...(s.stub ? { stub: structuredClone(s.stub) } : {}) };
}

export function loadScenario(file: string): Scenario {
  const raw = (Bun as any).YAML.parse(readFileSync(file, "utf8"));
  return { ...validateScenario(raw, file), file };
}

// ---------- the effect walk ----------
/**
 * Why answering `choice` on the card at `node` may set off an effect the driver must not, or null.
 * The walk follows EVERY out-edge, from the card node and from every node after it: an edge's
 * blocking checks re-route its source as "fail" (engine.route), and which outcome a model, a check
 * or a card mode produces is not known in advance. It stops at the next card, which is the next
 * gate (the caller refuses when an authorization window could answer that card instead), but opening
 * that card runs its start code, so its mode must be in REVIEWED_CARD_MODES and its body builder in
 * REVIEWED_CARD_BODIES.
 * Also refused: the card's own action or unreviewed mode, card effects that are not allowlisted,
 * and workflow hooks (they run checks at lifecycle points the walk does not review).
 */
export function externalEffect(def: any, node: string, choice: string, workflow = def?.id): { node: string; do: string } | null {
  const nodes = new Map<string, any>((def?.nodes ?? []).map((n: any) => [n.id, n]));
  const edges: any[] = (def?.edges ?? []).map((e: any) => Array.isArray(e) ? { from: e[0], to: e[1], when: e[2] } : e);
  const own = nodes.get(node);
  if (!own) return { node, do: "(node not in the definition)" };
  if (Array.isArray(def?.hooks) && def.hooks.length) return { node: "(workflow hooks)", do: def.hooks.map((h: any) => `${h.at}: ${h.use}`).join(", ") };
  const localDo = (n: any) => !n.do || LOCAL_ACTIONS.has(n.do);
  if (!localDo(own)) return { node, do: own.do };
  const mode = own.args?.mode ?? own.mode ?? null;
  if (mode && !REVIEWED_CARD_MODES.has(mode)) return { node, do: `card mode ${mode} (answer code not reviewed)` };
  // the engine applies node.card.effects[choice] once the card is answered (engine.carryAnswer)
  const effect = own.card?.effects?.[choice];
  if (effect && !ALLOWED_CARD_EFFECTS.some((a) => a.workflow === workflow && a.node === node && a.option === choice)) return { node, do: `card effect ${JSON.stringify(effect)}` };
  const seen = new Set<string>(); const queue = edges.filter((e) => e.from === node).map((e) => e.to);
  while (queue.length) {
    const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id);
    const n = nodes.get(id); if (!n) return { node: id, do: "(node not in the definition)" };
    if (n.kind === "card") { // the next card is the next gate, once its start code is reviewed
      const m = n.args?.mode ?? n.mode ?? null;
      if (m && !REVIEWED_CARD_MODES.has(m)) return { node: id, do: `card mode ${m} (start code not reviewed)` };
      const b = n.args?.body_from ?? null;
      if (b && !REVIEWED_CARD_BODIES.has(b)) return { node: id, do: `card body_from ${b} (start code not reviewed)` };
      continue;
    }
    if (!localDo(n)) return { node: id, do: n.do };
    for (const e of edges) if (e.from === id) queue.push(e.to);
  }
  return null;
}

/** The card fields the decision reads (a /api/scards view). */
export type CardView = { id: string; node: string; kind: string; options?: { id: string; label?: string }[]; captainOnly?: boolean; confirmDoor?: boolean; door?: string | null; detail?: any };
export type Decision = { action: "answer"; choice: string; note: string | null } | { action: "wait" } | { action: "stop"; reason: string };

/** What the driver does with one open card of a run whose definition is `def`: answer it, leave it for a person, or stop. */
/** What the driver knows about the run besides its definition. openAuthWindows: the ids of the
 *  captain's authorization windows open for this run's project (GET /api/policies/auth-window). */
export type RunContext = { openAuthWindows: string[] };
/** The ids of the authorization windows (GET /api/policies/auth-window grants) open now for a run on `project`. */
export function openWindowIds(grants: any[], project: string | null, now = Date.now()): string[] {
  const revoked = new Set(grants.filter((g) => g.revoked).map((g) => g.id));
  return grants.filter((g) => !g.revoked && !revoked.has(g.id) && Date.parse(g.until) > now && (!g.project || g.project === project)).map((g) => g.id);
}
export function decideCard(s: Scenario, c: CardView, def: any, run: RunContext): Decision {
  const stop = (reason: string): Decision => ({ action: "stop", reason: `${c.id} (${c.kind} on node ${c.node}): ${reason}` });
  if (!run || !Array.isArray(run.openAuthWindows)) return stop("the caller did not say which authorization windows are open");
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
  // an open window may answer the next card without the captain: that card is then no gate
  if (run.openAuthWindows.length) return stop(`authorization window ${run.openAuthWindows.join(", ")} is open: a later card could be answered without the captain, so the walk cannot stop at it`);
  const effect = externalEffect(def, c.node, rule.answer!, s.workflow);
  if (effect) return stop(`answering ${rule.answer} can reach ${effect.node} (${effect.do}) before another card: an external or irreversible effect`);
  return { action: "answer", choice: rule.answer!, note: rule.note ?? null };
}
