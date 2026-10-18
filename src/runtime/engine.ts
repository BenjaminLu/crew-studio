// Studio's native workflow runtime (docs/architecture.md §3). A captain's intent
// picks a workflow (classifier + door) and becomes a run: a state machine over the
// workflow's graph, pinned to one workflow version.
//
// Node kinds are a closed set: agent, check, card, loop, hook (§3.1). The entry is
// the node with no incoming edge; a node with no outgoing edge ends the run. An
// outcome picks the out-edges whose `when` names it, else the plain ones (a
// failure never takes a plain edge); parallelism comes from the edges, and a node
// with join: all waits for every input. A node's checks run after it produces
// (a blocking fail makes it fail); an edge's checks run before the edge is taken.
//
// Durable and replayable (§3.2): every change is an event in data/runs/<id>/events.jsonl
// ({ts, run, node, from, to, cause} for transitions, plus token, ctx, ndata, queue
// and step records). run.json is only a cache: on start Studio replays the events
// (fold), keeps finished nodes and restarts interrupted ones.
//   run:  queued → running ⇄ waiting → succeeded | failed | cancelled, plus paused
//   node: pending → running → passed | failed | error | skipped | superseded
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { allocate } from "../ids";
import type { AgentJob, AgentTool, Agents } from "../agent";
import type { Provider } from "../providers";
import type { StudioLog } from "../rawlog";
import { ProviderRefusal } from "../providers/policy";
import { QueueRefusal, capacity, type QueueRequest } from "./queue";
import { Grants } from "./grants";
import { Cards, emptySections, type CardKind, type SCard, type Sections, type LocalRescope } from "./cards";
import { cardContract, cardContractMode } from "./card-contract";
import { diagnosedBody, escalationQuestion, readinessCause } from "./escalation";
import { CheckRegistry, Ledger, Policies, INPUT_HASH_ALGORITHM, coerce, doneMap, execAdapter, hashInput, inputPaths, jsRegex, parseOutput, sandboxed, schemaDefaults, schemaErrors,
  type CheckInput, type CheckManifest, type CheckOutput, type CheckRef, type LedgerEntry, type Native } from "./checks";
import { AMEND_CHOICES, briefFor, installRefine, verifiedAmendments, type Amendment } from "./refine";
import { realInside, redactJSON, redactText } from "../secure";
import { helperCommand, helperReads } from "../self";
import { entryOf, MODEL_HOOK_ACTIONS, pinsSkills, roleSkillParts, validate, type WDef, type WEdge, type WNode, type WorkflowDefs } from "./defs";
import { locatorText, parseFinding, type Finding } from "./locator";
import { materializeRoundDir, roundWorkPath } from "./round-paths";
import { composeInstructions, Skills } from "../skills";
import { OperatingRules, jobInstructions } from "../operating-rules";
import { composeSkeleton, type SkeletonFacts } from "./brief-skeleton";
import { clampTitle, deriveTitle } from "../task-title";
import { ACT, homeless, FailureError, FailureRefusal, changedInputs, codeOf, failure, failureActions, failureCardBody, fromError, inputsHash, parseParamEdit, rescopeRefusal, retryRefusal, type Failure, type FailureCode, type InputSnapshot } from "./failures";

export type NState = "pending" | "running" | "passed" | "failed" | "error" | "skipped" | "superseded";
export type AgentPick = { provider: string; model: string | null; effort?: string | null };
export type NodeRun = {
  state: NState; visits: number; extra: number; attempt: number; outcome: string | null; cause: string | null; error: string | null; startedAt: string | null; endedAt: string | null;
  inbox: string[]; agent: AgentPick | null; swap: AgentPick | null; job: string | null; card: string | null; waiting: "card" | "external" | "firstmate" | null; data: Record<string, any>; note: string | null;
  /** the routing decision still to be carried out (set in the same durable step as the node's result, cleared when its tokens are delivered) */
  routing?: { outcome: string } | null;
};
export type Step = { seq: number; node: string; kind: string; visit: number; state: "running" | "waiting" | "passed" | "failed" | "error" | "interrupted" | "skipped" | "superseded" | "swapped";
  outcome: string | null; startedAt: string; endedAt: string | null; error: string | null; job: string | null; provider: string | null; model: string | null; note: string | null; handoff?: string | null;
  /** the reasoning effort the step's agent ran at (null: the provider's own default) */
  effort?: string | null; checks?: { check: string; verdict: string; seq: number }[];
  /** the enabled skills an agent step loaded, as name@vN in order (unit agent-skills) */
  skills?: string[];
  /** the role skill its latest agent turn received (ref, Studio version, sha256 of the text) */
  roleSkill?: RoleSkillUse | null;
  /** the judge calls made for this step's checks, each with the role skill it received */
  judges?: { check: string; role: string | null; roleSkill: RoleSkillUse | null; skills: string[]; at: string }[] };
/** Which role skill a turn received: the role, its source ref, Studio's version of it (null when no versioned copy) and the sha256 of the exact text. */
/** parts: a role with several named skills, each with the sha256 of its source text, in the order the role text joins them */
export type RoleSkillUse = { role: string | null; ref: string | null; version: number | null; sha256: string | null; parts?: { ref: string; sha256: string | null }[] };
export type RunStatus = "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "cancelled";
export type Run = {
  id: string; workflow: string; version: number; def: WDef; title: string; text: string; params: Record<string, string>; by: string;
  status: RunStatus; result: string | null; createdAt: string; updatedAt: string; endedAt: string | null; error: string | null;
  nodes: Record<string, NodeRun>; queue: string[]; steps: Step[]; ctx: Record<string, any>; classifier: any; events: number; recovered: number;
  /** the captain's reason when the run was cancelled */
  cancelReason?: string | null;
  continuation?:{token:string;previousCard:string;node:string;visit:number};
  /** the typed failure that ended the run (src/runtime/failures.ts), its card, and every earlier one */
  failure?: Failure | null; failureCard?: string | null; failures?: Failure[];
  /** the captain's Edit params answers on failure cards, the only params change that persists (replayed over the creation params) */
  paramEdits?: Record<string, string>;
  /** the captain parked the failed run: it stays failed, nothing retries it */
  parked?: { by: string; at: string; note: string | null } | null;
  /** hidden from the default lists (an ended run only); an "archived" event records each change */
  archived?: boolean;
};
export type Result = { outcome: string; note?: string | null; cause?: string; failure?: Failure | null } | { wait: true; external?: { version: 1; handler: string; [key: string]: any }; note?: string | null; firstmate?: true };
export type X = {
  edgeOwner?: symbol; run: Run; node: WNode; rn: NodeRun; visit: number; engine: Engine; deps: Deps; ctx: Record<string, any>; dir: string;
  log(text: string, data?: any): void; save(): void; cancelled(): boolean; provider(): Provider; pick(): AgentPick; skill(): string; policy(path: string, dflt?: any): any;
  /** the same instructions as skill(), with which role skill and node skills they carry */
  skillUse?(): { text: string; roleSkill: RoleSkillUse | null; skills: string[] };
};
export type KindHandler = { start(x: X): Promise<Result>; answer?(x: X, card: SCard): Promise<Result> };
export type AgentMode = {
  /** Apply an already authorized role choice synchronously, before capability verification or work preparation. */
  preparePick?(x: X): void;
  tools(x: X): AgentTool[]; system(x: X, skill: string): string; prompt(x: X): string;
  /** after a finished job: the node's outcome (throw to fail the attempt) */
  after(x: X, job: AgentJob): Promise<string> | string;
  /** a job stopped at its time limit: keep what it did; the node ends failed(cause=timeout), never report-only */
  onTimeout?(x: X, job: AgentJob): Promise<void> | void;
  /** extra state for a hand-off file (e.g. what the agent changed so far) */
  handoffState?(x: X): string; /** a number, or one worked out for the round (a plan's size) */ maxTools?: number | ((x: X) => number);
  /** this round's facts for the brief's fixed sections (BRIEFING … DELIVERABLE): test command, dependency state, deliverable; the graph's facts and the manual are added by the engine */
  skeleton?(x: X): SkeletonFacts | null;
  /** the mode's prompt already carries engine.briefSkeleton(x) (it keeps a durable brief that must equal what is sent) */
  embedsSkeleton?: boolean;
  /** a round that runs in the OS sandbox (architecture §10): the folders the runtime materialized for it */
  sandbox?(x: X): { writes: string[]; reads?: string[]; cwd?: string } | null;
  /** before the round's agent starts (e.g. take its working folder, put it at its durable state); a throw fails the attempt */
  begin?(x: X): Promise<void> | void;
  /** after the round, however it ended (done, timeout, failed, cancelled): release what begin took, keep what the round left */
  end?(x: X, how: "done" | "timeout" | "failed" | "cancelled"): Promise<void> | void;
};
export type Body = { crew?: import("./cards").CardCrew | null; title: string; zhTitle?: string; en: Partial<Sections>; zh?: Partial<Sections>; body?: string; links?: { label: string; href: string }[]; door?: string | null; options?: SCard["options"]; ledger?: any;
  /** optional structured detail of an intent-aligned card (cards.ts CardDetail; unit intent-merge-card) */
  detail?: import("./cards").CardDetail | null;
  /** an authorization window never answers this card: only the captain does */
  captainOnly?: boolean;
  /** what only the captain can give (a credential, a permission, a one-way call): the card skips Firstmate's diagnosis */
  direct?: boolean;
  captures?: SCard["captures"];
  pullRequest?: SCard["pullRequest"];
  /** the typed failure the card is about (a domain's own recovery card shows its class, message and log) */
  failure?: Failure | null;
  /** a statement the captain ticks before answering with its option (cards.ts Acknowledge) */
  acknowledge?: SCard["acknowledge"] };
export type Deps = {
  dataDir: string; agents: Agents; provider: (id?: string, model?: string) => Provider; log: StudioLog; send: (t: string, d: unknown) => void;
  skillText: (ref: string) => string; defaultProvider: () => AgentPick;
  /** Studio's versioned copy of a role skill (src/skills.ts current): what the Improve page shows and edits. Null: the source text is used. */
  roleSkill?: (workflow: string, role: string, ref: string) => { text: string; version: number } | null;
  [k: string]: any;
};

const now = () => new Date().toISOString();
const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled"];
const FAILS = ["fail", "error", "cap", "cancel", "timeout"];
const FAILED_OUTCOMES = new Set(["fail", "timeout", "cap"]);
/** A provider's own end code (providers/*: turnEnd.code) → the failure code, so the class is never guessed from the words. */
const JOB_CODES: Record<string, FailureCode> = { notLoggedIn: "env.login", quotaExhausted: "env.quota", cliUnavailable: "env.tool-missing", modelMismatch: "invalid-input.config", cleanupUnverified: "internal.bug" };
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
/** {{ctx.a.b}} / {{params.x}} / {{run.title}} in card text */
export function fill(s: string, run: Run): string {
  return String(s ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p: string) => {
    const [head, ...rest] = p.split("."); let v: any = head === "ctx" ? run.ctx : head === "params" ? run.params : head === "run" ? run : undefined;
    for (const k of rest) v = v?.[k];
    return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}
const ekey = (e: WEdge) => `${e.from}→${e.to}${e.when ? `[${e.when}]` : ""}`;
// params are not a run field: the creation params are replayed from run_created, and a domain may keep an in-memory cache in them
// (staffing upgrades) that must never become durable. Only the captain's Edit params on a failure card persists, as paramEdits.
const RUN_FIELDS = ["status", "result", "error", "endedAt", "recovered", "cancelReason", "continuation", "paramEdits", "failure", "failureCard", "failures", "parked"] as const;
const NODE_FIELDS = ["visits", "extra", "attempt", "outcome", "cause", "error", "startedAt", "endedAt", "inbox", "agent", "swap", "job", "card", "waiting", "data", "note", "routing"] as const;

/** Replay a run's events into its snapshot (the snapshot is a fold of the events). */
export function fold(events: any[]): Run | null {
  let r: Run | null = null;
  for (const e of events) {
    if (e.type === "run_created") { r = clone(e.run); r!.events = e.seq; continue; }
    if (!r) continue;
    r.events = Math.max(r.events, e.seq ?? 0); r.updatedAt = e.ts ?? r.updatedAt;
    if (e.type === "run") { r.status = e.to; for (const k of RUN_FIELDS) if (k in (e.set ?? {})) (r as any)[k] = e.set[k]; if (e.set?.paramEdits) r.params = { ...r.params, ...e.set.paramEdits }; }
    else if (e.type === "node") { const n = r.nodes[e.node]; if (n) { n.state = e.to; for (const k of NODE_FIELDS) if (k in (e.set ?? {})) (n as any)[k] = e.set[k]; } }
    else if (e.type === "ndata") { const n = r.nodes[e.node]; if (n) for (const [k, v] of Object.entries(e.set ?? {})) (n as any)[k] = v; }
    else if (e.type === "queue") r.queue = e.queue;
    else if (e.type === "archived") r.archived = e.archived !== false;
    else if (e.type === "unarchived") r.archived = false;
    else if (e.type === "ctx") { for (const [k, v] of Object.entries(e.set ?? {})) r.ctx[k] = v; for (const k of e.del ?? []) delete r.ctx[k]; }
    else if (e.type === "step") { const i = r.steps.findIndex((s) => s.seq === e.step.seq); if (i >= 0) r.steps[i] = e.step; else r.steps.push(e.step); }
  }
  return r;
}

/** What a run's project resolves against: the registered ids, and (for a run that named a raw repository path) their real paths. */
export type ProjectRegistry = { ids: ReadonlySet<string>; byPath?: (path: string) => string | null };
/**
 * Which project a run is in (docs: projects design §3.2), first match:
 *   1. ctx.project (set by repo.prepare);
 *   2. a firstmate-proposal's target params.project (the proposal's own params.project is a binding);
 *   3. params.project when it is a registered id (a code run with neither project nor repo works on the sandbox);
 *   4. a coffee-kit run's artifact namespace, as "coffee:<name>" (never a registered id);
 *   5. "studio": the run has no project.
 * A code run given a raw params.repo resolves to the registered project at that path, if any.
 */
export function projectOf(r: Pick<Run, "workflow" | "params" | "ctx"> & { def?: { kind?: string } | null }, reg: ProjectRegistry): string {
  const known = (v: unknown) => typeof v === "string" && reg.ids.has(v) ? v : null;
  const params = r.params ?? {}, ctx = r.ctx ?? {};
  const fromCtx = known(ctx.project); if (fromCtx) return fromCtx;
  if (r.workflow === "firstmate-proposal") {
    try { const t = typeof params.target === "string" && params.target.trim().startsWith("{") ? JSON.parse(params.target) : null; const id = known(t?.params?.project); if (id) return id; } catch {}
    return "studio";
  }
  const kind = r.def?.kind;
  if (kind === "coffee-kit") return `coffee:${params.project || r.workflow}`;
  const fromParams = known(params.project); if (fromParams) return fromParams;
  if (kind === "code" && !params.project) {
    if (params.repo) return reg.byPath?.(String(params.repo)) ?? "studio";
    if (reg.ids.has("sandbox")) return "sandbox";
  }
  return "studio";
}

/** A judged check may block only with a quorum: n ≥ 2 failing votes out of of ≥ n independent runs. */
export const quorumOk = (q: { n: number; of: number } | null | undefined) => !!q && Number.isInteger(q.n) && Number.isInteger(q.of) && q.n >= 2 && q.of >= q.n;

export class Engine {
  runs = new Map<string, Run>();
  private committed = new Map<string, Run>();
  readonly root: string;
  readonly cards: Cards;
  readonly registry: CheckRegistry;
  readonly policies: Policies;
  readonly grants: Grants;
  kinds: Record<string, KindHandler> = {};
  actions: Record<string, (x: X) => Promise<string | Result> | string | Result> = {};
  beforeNodeChecks: Record<string, (x: X, result: Result) => boolean> = {};
  continuationEdges: Record<string,(run:Run,node:WNode,outcome:string)=>WEdge[]> = {};
  /** Where a round's source lives (the directory whose head a brief's file evidence is read from); a domain registers it, the first answer wins. */
  sourceRoots: Record<string,(x:X)=>string|null> = {};
  cardPrepared: Record<string, (x: X, card: SCard, body: Body) => void> = {};
  beforeStart: Record<string, (x: X) => Promise<Result | null> | Result | null> = {};
  externalValidators: Record<string, (x: X, descriptor: any) => boolean> = {};
  externalHandlers: Record<string, (x: X, descriptor: any, wake: (result: Result) => void) => () => void> = {};
  private externalOwners = new Map<string, { cancel: () => void }>();
  trackExternal(x: X, work: Promise<void>) { return this.track(x.run, "external presentation", work); }
  disposeExternal() { for (const owner of this.externalOwners.values()) owner.cancel(); this.externalOwners.clear(); }
  private edgeOwners = new Map<symbol, { run: Run; node: WNode; rn: NodeRun; visit: number; head: string | null }>();
  owns(x: X) {
    const common = this.runs.get(x.run.id) === x.run && !this.gone.has(x.run.id) && !TERMINAL.includes(x.run.status) && x.run.nodes[x.node.id] === x.rn && x.rn.visits === x.visit;
    if (!common) return false;
    if (!x.edgeOwner) return x.rn.state === "running";
    const owner = this.edgeOwners.get(x.edgeOwner);
    return !!owner && owner.run === x.run && owner.node === x.node && owner.rn === x.rn && owner.visit === x.visit && owner.head === (x.ctx.head ?? null) && !!x.rn.routing;
  }
  private registerExternal(r: Run, node: WNode, rn: NodeRun) {
    const key = `${r.id}/${node.id}`, descriptor = rn.data.external;
    this.externalOwners.get(key)?.cancel();
    const owner = { cancel: () => {}, completing: false }; this.externalOwners.set(key, owner);
    const wake = (result: Result) => {
      if (this.externalOwners.get(key) !== owner || this.gone.has(r.id) || TERMINAL.includes(r.status) || rn.waiting !== "external") return;
      if (owner.completing) return; owner.completing = true; owner.cancel();
      const step = [...r.steps].reverse().find(s => s.node === node.id && s.state === "waiting"); if (!step) return;
      rn.note = result.note ?? rn.note; rn.data.externalCompletion = { version: 1, visit: rn.visits, result }; this.commit(r, "external completion received");
      void this.track(r, `external completion ${node.id}`, (async () => {
        const x = this.x(r, node, rn); let completed = result;
        if (!("wait" in result) && node.kind === "hook") completed = await this.hookChecks(x, result.outcome, true);
        if (this.externalOwners.get(key) !== owner || !this.owns(x)) return;
        this.externalOwners.delete(key); rn.waiting = null;
        this.finish(r, node, rn, step, completed, null);
      })().catch(() => {
        if (this.externalOwners.get(key) !== owner || TERMINAL.includes(r.status)) return;
        this.externalOwners.delete(key); rn.waiting = null; this.finish(r, node, rn, step, null, "external completion checks failed");
      }));
    };
    const handler = descriptor && this.externalHandlers[descriptor.handler];
    if (!handler) { queueMicrotask(() => wake({ outcome: "error", note: "unsupported external wait record; verification refused" })); return; }
    const completion = rn.data.externalCompletion;
    let valid = true; try { const validator = this.externalValidators[descriptor.handler]; if (validator) valid = validator(this.x(r, node, rn), descriptor); } catch { valid = false; }
    if (valid && completion?.version === 1 && completion.visit === rn.visits && completion.result && (typeof completion.result.outcome === "string" || completion.result.wait === true)) { queueMicrotask(() => wake(completion.result)); return; }
    try { const cancel = handler(this.x(r, node, rn), descriptor, wake); if (this.externalOwners.get(key) === owner) owner.cancel = cancel; else cancel(); }
    catch { queueMicrotask(() => wake({ outcome: "error", note: "external wait could not be registered" })); }
  }
  modes: Record<string, AgentMode> = {};
  /** native checks: Studio functions behind the same JSON contract */
  natives: Record<string, Native> = {};
  /** what a check sees as its artifact, by type (code-diff, spec, video, card, run …) */
  artifacts: Record<string, (x: X) => any> = {};
  /** extra input a manifest's `needs` asks for */
  needs: Record<string, (x: X, man: CheckManifest) => any | Promise<any>> = {};
  /** placeholders in an exit-code adapter's command: {repo.test} → argv */
  expand: Record<string, (x: X) => string[] | null> = {};
  cardBodies: Record<string, (x: X) => Body | Promise<Body>> = {};
  /** card nodes with their own behaviour (an artifact review that runs an agent on "request changes") */
  cardModes: Record<string, KindHandler> = {};
  /** A card node's answer that its body's domain handles itself (keyed by args.body_from, e.g. the merge card's "update-text");
   *  null routes the choice as the outcome. */
  cardAnswers: Record<string, (x: X, card: SCard) => Promise<Result | null>> = {};
  /** Tests only, never set in production: a run whose GitHub pull request text is left out of the check before the merge
   *  (a fixture that injects a pull request Studio has no record of, or plays an older release). */
  testOnlySkipPrTextCheck?: (x: X) => boolean;
  private live = new Set<string>(); // "run/node" being executed in this process
  private routing = new Map<string, number>();

  constructor(readonly deps: Deps, readonly defs: WorkflowDefs) {
    this.root = join(deps.dataDir, "runs"); mkdirSync(this.root, { recursive: true });
    this.cards = new Cards(deps.dataDir);
    this.registry = new CheckRegistry(deps.dataDir, deps.checkRoots ?? []);
    this.policies = new Policies(deps.dataDir);
    // a failure card shows, live, which inputs changed since it failed (a deterministic retry needs one)
    { const prior = this.cards.view; this.cards.view = (c) => { const v = prior(c); if (c.kind !== "failure" || c.status !== "open" || !c.failure?.inputs) return v;
      try { const r = this.runs.get(c.run); const node = r?.def.nodes.find((n) => n.id === c.node) ?? null; if (!r) return v;
        // one computation per card while its run is unchanged, at most every few seconds (the board polls every card)
        const key = `${r.updatedAt}`, hit = this.changedCache.get(c.id);
        const changed = hit && hit.key === key && Date.now() - hit.at < 5_000 ? hit.value : changedInputs(c.failure.inputs.snapshot, this.failureInputs(r, node));
        if (!hit || hit.value !== changed) { this.changedCache.set(c.id, { key, at: Date.now(), value: changed }); if (this.changedCache.size > 500) this.changedCache.delete(this.changedCache.keys().next().value!); }
        return { ...v, failureChanged: changed } as SCard; } catch { return v; } }; }
    this.policies.onChange = () => this.deps.agents.queue.wake();
    this.grants = new Grants(deps.dataDir);
    defs.known ??= (ref) => !!this.registry.get(ref);
    this.cards.onChange = (c) => deps.send("scard", { id: c.id, run: c.run, status: c.status });
    deps.agents.admission = (o: any, key: string) => this.jobAdmission(o, key);
    this.builtinKinds();
    installRefine(this); // the loop kind
    defs.runners ??= () => new Set(Object.keys(this.kinds));
  }

  // ---------- persistence: events first, the snapshot is their fold ----------
  rdir(id: string) { return join(this.root, id.replace(/[^\w-]/g, "")); }
  private append(r: Run, e: Record<string, any>) {
    if (this.gone.has(r.id)) return { seq: r.events, ts: now(), run: r.id, ...e }; // a deleted run takes no more writes
    const ev = { seq: ++r.events, ts: now(), run: r.id, ...e };
    appendFileSync(join(this.rdir(r.id), "events.jsonl"), JSON.stringify(ev) + "\n");
    return ev;
  }
  /** Record every change since the last commit as events, then write the snapshot cache. */
  commit(r: Run, cause = "progress") {
    if (this.gone.has(r.id)) return;
    const c = this.committed.get(r.id)!;
    r.updatedAt = now();
    const evs: any[] = [];
    if (r.status !== c.status || RUN_FIELDS.some((k) => !same((r as any)[k], (c as any)[k]))) {
      const set: any = {}; for (const k of RUN_FIELDS) if (!same((r as any)[k], (c as any)[k])) set[k] = (r as any)[k];
      evs.push(this.append(r, { type: "run", from: c.status, to: r.status, cause, set }));
    }
    for (const [id, n] of Object.entries(r.nodes)) {
      const o = c.nodes[id]; const set: any = {}; for (const k of NODE_FIELDS) if (!same((n as any)[k], (o as any)?.[k])) set[k] = clone((n as any)[k]);
      if (n.state !== o?.state) evs.push(this.append(r, { type: "node", node: id, from: o?.state ?? null, to: n.state, cause: n.cause ?? cause, visit: n.visits, outcome: n.outcome, set }));
      else if (Object.keys(set).length) this.append(r, { type: "ndata", node: id, set });
    }
    if (!same(r.queue, c.queue)) this.append(r, { type: "queue", queue: r.queue });
    const set: any = {}; const del: string[] = [];
    for (const [k, v] of Object.entries(r.ctx)) if (!same(v, c.ctx[k])) set[k] = clone(v);
    for (const k of Object.keys(c.ctx)) if (!(k in r.ctx)) del.push(k);
    if (Object.keys(set).length || del.length) this.append(r, { type: "ctx", set, del });
    for (const s of r.steps) { const o = c.steps.find((y) => y.seq === s.seq); if (!o || !same(o, s)) this.append(r, { type: "step", step: clone(s) }); }
    this.committed.set(r.id, clone(r));
    this.deps.agents.queue.wake();
    const f = join(this.rdir(r.id), "run.json"); writeFileSync(f + ".tmp", JSON.stringify(r)); renameSync(f + ".tmp", f);
    for (const e of evs) { this.deps.log.emit({ type: `run_${e.type === "run" ? "status" : "node"}`, workflow: r.workflow, task: r.id, summary: e.type === "run" ? `${e.from} → ${e.to} (${e.cause})` : `${e.node}: ${e.from} → ${e.to} (${e.cause})`, data: { version: r.version, node: e.node ?? null, from: e.from, to: e.to, cause: e.cause } });
      this.deps.send("wrun", { id: r.id, project: this.projectOf(r), status: r.status, event: { seq: e.seq, ts: e.ts, type: e.type, node: e.node ?? null, from: e.from, to: e.to, cause: e.cause, outcome: e.outcome ?? null }, nodes: this.nodeStates(r) }); }
  }
  save(r: Run) { this.commit(r); }
  /** A display event (logs, check results, cards raised): in the run's events and Studio's log, ignored by the fold. */
  emit(r: Run, type: string, summary: string, data: Record<string, any> = {}) {
    if (this.gone.has(r.id)) return;
    const ev = this.append(r, { type, summary, ...data });
    this.deps.log.emit({ type: `run_${type}`, workflow: r.workflow, task: r.id, summary, data: { version: r.version, ...data } });
    this.deps.send("wrun", { id: r.id, project: this.projectOf(r), status: r.status, event: ev, nodes: this.nodeStates(r) });
  }
  events(id: string, after = 0): any[] {
    const f = join(this.rdir(id), "events.jsonl"); if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.seq > after);
  }
  /** What a timeline shows: transitions and display events, not the ctx/ndata payloads. */
  timeline(id: string, after = 0) { return this.events(id, after).filter((e) => !["ctx", "ndata", "queue", "step", "run_created"].includes(e.type))
    .map((e) => (e.type === "run" ? { ...e, set: undefined, result: e.set?.result ?? null } : e.type === "node" ? { ...e, set: undefined } : e)); } // a run transition keeps its result: the UI names the state from it
  ledger(id: string): LedgerEntry[] { return new Ledger(this.deps.dataDir, id).all(); }
  nodeStates(r: Run) { return Object.fromEntries(Object.entries(r.nodes).map(([k, n]) => [k, { state: n.state, visits: n.visits, outcome: n.outcome, waiting: n.waiting }])); }
  get(id: string) { return this.runs.get(id) ?? null; }
  list() { return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }

  /** Replay every run from its events; a run that was live when the server stopped resumes from its last durable step. */
  load() {
    const backoffs: [Run, string][] = [];
    for (const d of readdirSync(this.root).filter((x) => /^R-\d+$/.test(x))) {
      const r = fold(this.events(d)); if (!r) continue;
      this.runs.set(r.id, r); this.committed.set(r.id, clone(r));
      if (TERMINAL.includes(r.status)) continue;
      let n = 0; const reroute: string[] = []; const reanswer: string[] = []; const reescalate: string[] = [];
      for (const [id, rn] of Object.entries(r.nodes)) {
        if (rn.routing && rn.state !== "running") { reroute.push(id); continue; } // the result is durable, its routing was not done: do it again
        if (rn.state !== "running") continue;
        if (rn.waiting === "external") continue;
        if (rn.waiting === "firstmate" && r.ctx.firstmateQuestion?.card && r.ctx.firstmateQuestion.node === id) continue; // an escalation still with Firstmate
        // Firstmate escalated, and Studio stopped before the captain's card was up: raise it now
        if (rn.waiting === "firstmate" && rn.data.firstmateCard?.escalation && rn.data.firstmateCard.visit === rn.visits) { reescalate.push(id); continue; }
        // a retry that was waiting out its backoff (failure card): it never started, so it runs now with no visit taken back
        if ((rn as any).waiting === "backoff") { backoffs.push([r, id]); continue; } // it keeps waiting only the time still left
        if (rn.waiting === "card") {
          const c = rn.card ? this.cards.get(rn.card) : null;
          if (c?.status === "open") continue;                 // still waiting for the captain
          if (c?.status === "answered") { reanswer.push(id); continue; } // answered just before the crash: carry it on
        }
        rn.waiting = null;
        const st = [...r.steps].reverse().find((s) => s.node === id && (s.state === "running" || s.state === "waiting"));
        if (st) { st.state = "interrupted"; st.endedAt = now(); st.error = "Studio stopped during this step"; }
        // an agent turn that had started keeps its record: the round's stream says it was interrupted, and the turn counts as an
        // attempt, so the re-run writes prompt.attempt<k>.md beside it instead of over it (docs/architecture.md §3.2, resume semantics)
        if (rn.job) { rn.data = { ...rn.data, interrupted: [...(rn.data.interrupted ?? []), { round: rn.visits, job: rn.job }] };
          const dir = join(this.root, r.id, "nodes", id, String(rn.visits));
          if (existsSync(join(dir, "stream.jsonl"))) try { appendFileSync(join(dir, "stream.jsonl"), JSON.stringify({ ts: now(), type: "status", status: "interrupted", job: rn.job, error: "Studio stopped during this round" }) + "\n"); } catch {} }
        rn.visits = Math.max(0, rn.visits - 1); rn.job = null; rn.cause = "recovered: interrupted, runs again"; n++;
        if (rn.swap) { rn.agent = rn.swap; rn.swap = null; }
        rn.state = "pending"; if (!r.queue.includes(id)) r.queue.unshift(id);
      }
      // a card raised by a step that did not finish raising it: cancel the orphan (the step runs again and raises its own)
      const waitingOn = new Set(Object.values(r.nodes).filter((x) => x.waiting === "card" && x.card).map((x) => x.card));
      for (const c of this.cards.list({ run: r.id, open: true })) if (!waitingOn.has(c.id)) this.cards.cancel(c.id);
      this.upgradeCards(r);
      // a run whose creation was recorded but not its first step: start at the entry
      if (r.status === "queued" && !r.steps.length && !r.queue.length) { const e = entryOf(r.def); if (e) { r.queue.push(e.id); r.status = "running"; } }
      r.recovered = (r.recovered ?? 0) + 1;
      this.commit(r, "recovered");
      this.emit(r, "recovered", `resumed after a restart from ${r.events} events${n ? `: ${n} interrupted node${n > 1 ? "s" : ""} run again` : ""}${reroute.length ? `; routing replayed for ${reroute.join(", ")}` : ""}${reanswer.length ? `; answers carried on for ${reanswer.join(", ")}` : ""}`, { interrupted: n, reroute, reanswer });
      for (const id of reroute) { const node = r.def.nodes.find((x) => x.id === id)!; if (r.def.edges.some((e) => e.from === id)) void this.track(r, `routing after ${id}`, this.route(r, node, r.nodes[id].routing!.outcome)); else this.end(r, node, r.nodes[id].outcome ?? "ok"); }
      for (const id of reanswer) void this.track(r, `the answer at ${id}`, this.carryAnswer(r, id));
      for (const id of reescalate) void this.track(r, "escalation card", this.escalateCard(r, r.def.nodes.find((n) => n.id === id)!, r.nodes[id].data.firstmateCard.escalation));
    }
    for (const r of this.runs.values()) if (!TERMINAL.includes(r.status)) for (const [id, rn] of Object.entries(r.nodes)) if (rn.state === "running" && rn.waiting === "external") this.registerExternal(r, r.def.nodes.find(n => n.id === id)!, rn);
    // the cards nodes still wait on are watched again (a fact observed while Studio was down settles them now)
    for (const r of this.runs.values()) if (!TERMINAL.includes(r.status)) for (const [id, rn] of Object.entries(r.nodes)) {
      const node = r.def.nodes.find(n => n.id === id), c = rn.card ? this.cards.get(rn.card) : null;
      if (node && rn.state === "running" && rn.waiting === "card" && c?.status === "open") this.watchCard(this.x(r, node, rn), c);
    }
    for (const r of this.runs.values()) if (r.status === "running" || r.status === "waiting" || r.status === "queued") this.tick(r);
    for (const [r, id] of backoffs) this.scheduleBackoff(r, id);
    this.resumeFirstmateQuestions(); // a no-op until askFirstmate is wired (server.ts calls it again then)
  }

  /** A domain presents an open card that an older release raised again under the current rules (other options, other words):
   *  the body to show instead, or null to keep the card. A card is only ever replaced here, never answered. */
  cardUpgrades: ((r: Run, node: WNode, rn: NodeRun, c: SCard) => Body | null)[] = [];
  /** On boot: replace each open card a node waits on when a domain upgrades it. The new card is created and recorded before the node
   *  points at it, and the old one is cancelled last, so a crash between the writes leaves an orphan the next boot's sweep cancels. */
  private upgradeCards(r: Run) {
    if (!this.cardUpgrades.length) return;
    for (const [id, rn] of Object.entries(r.nodes)) {
      const node = r.def.nodes.find((n) => n.id === id), old = rn.card ? this.cards.get(rn.card) : null;
      if (!node || rn.state !== "running" || rn.waiting !== "card" || old?.status !== "open") continue;
      let b: Body | null = null;
      for (const up of this.cardUpgrades) { try { b = up(r, node, rn, old); } catch { b = null; } if (b) break; }
      if (!b) continue;
      const { id: _id, status: _status, createdAt: _at, answer: _answer, ...kept } = old;
      const c = this.cards.create({ ...kept, title: { en: b.title, "zh-TW": b.zhTitle ?? b.title }, sections: { en: { ...old.sections.en, ...b.en }, "zh-TW": { ...old.sections["zh-TW"], ...b.zh } },
        body: b.body ?? old.body, options: b.options ?? old.options, acknowledge: b.acknowledge ?? null, ...(b.captainOnly ? { captainOnly: true } : {}), ledger: { ...(old.ledger ?? {}), upgradedFrom: old.id } as any, ste: null });
      const broken = cardContract(c); if (broken.length) { this.cards.cancel(c.id); this.emit(r, "log", `card contract: ${old.id} kept, its upgrade broke it: ${broken.join("; ").slice(0, 400)}`); continue; }
      // the ledger names the replacement before the node points at it (a crash after the record leaves an orphan, swept and redone)
      this.record(this.x(r, node, rn), "card-upgraded", { data: { from: old.id, to: c.id, options: c.options.map((o) => o.id) } });
      rn.card = c.id; this.commit(r, `card ${old.id} replaced by ${c.id} under the current release`); this.cards.cancel(old.id);
      this.emit(r, "card_raised", `${c.id} ${c.title.en} (replaces ${old.id})`, { node: id, card: c.id, kind: c.kind });
    }
  }

  // ---------- starting ----------
  start(o: { workflow: string; version?: number; title?: string; text?: string; params?: Record<string, string>; by?: string; classifier?: any }): Run {
    const def = this.defs.get(o.workflow, o.version); if (!def) throw new Error(`no workflow ${o.workflow}${o.version ? ` v${o.version}` : ""}`);
    if(this.defs.trashed(def.id))throw new Error("Restore this workflow from Trash before starting a new Task");
    const errs = validate(def, this.defs.known, this.defs.runners?.(), this.defs.skillInfo ?? undefined).filter((p) => p.level === "error"); if (errs.length) throw new Error(`${def.id} v${def.version} is not runnable: ${errs[0].text}`);
    this.deps.authorizeStart?.(def, o);
    const id = allocate(this.root, "R");
    mkdirSync(this.rdir(id), { recursive: true });
    const params: Record<string, string> = {};
    for (const [k, p] of Object.entries(def.params ?? {})) if (p.default != null) params[k] = String(p.default);
    // a parameter is at most 4000 characters, or the larger bound its definition declares (max, up to 64 KB)
    const paramCap = (k: string) => Math.min(65536, Math.max(4000, Number((def.params as any)?.[k]?.max) || 0));
    for (const [k, v] of Object.entries(o.params ?? {})) if (v != null && String(v) !== "") params[k] = String(v).slice(0, paramCap(k));
    const text = String(o.text ?? "").slice(0, 8000);
    const r: Run = { id, workflow: def.id, version: def.version, def, title: (o.title ? clampTitle(o.title) : deriveTitle(text)) || clampTitle(def.name), text, params, by: o.by ?? "captain",
      status: "queued", result: null, createdAt: now(), updatedAt: now(), endedAt: null, error: null, nodes: {}, queue: [], steps: [], ctx: { nativeQueueVersion: 1 }, classifier: o.classifier ?? null, events: 0, recovered: 0 };
    for (const nd of def.nodes) r.nodes[nd.id] = { state: "pending", visits: 0, extra: 0, attempt: 0, outcome: null, cause: null, error: null, startedAt: null, endedAt: null, inbox: [], agent: null, swap: null, job: null, card: null, waiting: null, data: {}, note: null };
    this.runs.set(id, r);
    this.append(r, { type: "run_created", run: clone(r) });
    this.committed.set(id, clone(r));
    this.deps.initializeRun?.(r, o);
    const entry = entryOf(def)!;
    r.queue.push(entry.id); r.status = "running";
    this.commit(r, "started");
    this.emit(r, "started", `${def.name} v${def.version}: ${r.title}`, { workflowVersion: def.version });
    this.tick(r);
    return r;
  }

  private async queueCapability(x: X, reason: string, cause: unknown = null): Promise<Result> {
    // the readiness card keeps its retry / close actions; the typed failure says which class stopped the round (login, quota, overlap, staffing …)
    const typed = fromError(cause ?? new Error(reason), { source: "queue", run: x.run.id, node: x.node.id, visit: x.visit });
    // a domain may offer one more captain action for this failure (staffing: approve a changed role skill), with what the captain approves
    // data: what the captain is shown, kept with the hold so the action can refuse when it changed before the click
    let extra: { options: { id: string; label: string; labelZh: string }[]; detail?: string; data?: unknown } | null = null;
    try { extra = this.deps.readinessRecovery?.(x, typed) ?? null; } catch (e: any) { x.log(`readiness recovery option unavailable: ${e?.message ?? e}`); }
    x.rn.data.nativeQueueCapability = { version: 1, reason, retryAction: "retry", closeAction: "close", ...(extra?.options.length ? { extraActions: extra.options.map((o) => o.id), extraData: extra.data ?? null } : {}) };
    const scope = Array.isArray(x.ctx.spec?.scope) ? x.ctx.spec.scope.map(String) : [];
    const project = this.queueProject(x.run), repo = this.queueRepo(x.ctx.repo) || "artifact workflow"; let dependencies: string[] = []; try { dependencies = this.queueDependencies(x.run); } catch {}
    const plain = readinessCause(reason);
    let body: Body = { captainOnly: true, title: `Round cannot start: ${plain.en.short}. Prepare again or close?`, zhTitle: `回合無法開始：${plain.zh.short}。要重新準備還是關閉？`,
      en: { why: extra?.detail ? `${plain.en.cause}\n\n${extra.detail}` : plain.en.cause, how: plain.en.action, scope: { in: [...scope, `Project: ${project}`, `Repository: ${repo}`, ...dependencies.map(id => `Dependency: ${id}`)], out: [] } },
      zh: { why: extra?.detail ? `${plain.zh.cause}\n\n${extra.detail}` : plain.zh.cause, how: plain.zh.action, scope: { in: [...scope, `專案：${project}`, `儲存庫：${repo === "artifact workflow" ? "產物工作流程" : repo}`, ...dependencies.map(id => `依賴：${id}`)], out: [] } },
      body: `${plain.en.cause}\n\nWhat to do: ${plain.en.action}\n\nDetail: ${reason}`,
      options: [...(extra?.options ?? []), { id: "retry", label: "Approve fresh preparation", labelZh: "核准重新準備" }, { id: "close", label: "Close task", labelZh: "關閉任務", hold: true }], failure: typed };
    // a provider that is not verified (login, quota, model): Firstmate looks first and may prepare again once it checked; it never closes the task
    if (plain.provider) { const asked = this.diagnoseFirst(x, "scope", body, ["retry"]);
      if (asked === true) return { wait: true, firstmate: true, note: "Firstmate checks the provider first" };
      body = diagnosedBody(body, { by: "studio", why: asked.en, zhWhy: asked.zh }); }
    const c = await this.card(x, "scope", body);
    return { wait: true, note: `readiness recovery card ${c.id}` };
  }

  private queueOwner = randomBytes(8).toString("hex");
  private projectCache: { key: string; reg: ProjectRegistry } | null = null;
  /** The registry projectOf reads: data/projects.json, re-read only when it changes (a wrun event carries the project). */
  projectRegistry(): ProjectRegistry {
    const file = join(this.deps.dataDir, "projects.json");
    let key = "absent"; try { const st = lstatSync(file); key = `${st.mtimeMs}:${st.size}`; } catch {}
    if (this.projectCache?.key === key) return this.projectCache.reg;
    let list: any[] = []; try { const st = lstatSync(file); if (st.isFile() && st.size <= 1024 * 1024) { const v = JSON.parse(readFileSync(file, "utf8")); if (Array.isArray(v)) list = v; } } catch {}
    const ids = new Set<string>(list.filter((p) => p && typeof p.id === "string" && p.id).map((p) => p.id));
    const real = (p: string) => { try { return realpathSync(p); } catch { return null; } };
    const reg: ProjectRegistry = { ids, byPath: (path) => { const want = real(path); if (!want) return null; const hit = list.find((p) => typeof p?.path === "string" && real(p.path) === want); return hit?.id ?? null; } };
    this.projectCache = { key, reg }; return reg;
  }
  projectOf(r: Run) { try { return projectOf(r, this.projectRegistry()); } catch { return "studio"; } }
  /** The sidebar row a run counts under: its registered project, else "studio" (no project; a coffee namespace is not a registered project). */
  projectRow(r: Run) { const id = this.projectOf(r); return this.projectRegistry().ids.has(id) ? id : "studio"; }
  queueProject(r: Run) { return String(r.ctx.project ?? r.params.project ?? "studio") || "studio"; }
  queueRepo(repo: unknown) { try { return typeof repo === "string" && repo ? realpathSync(repo) : ""; } catch { return ""; } }
  queueDependencies(r: Run): string[] {
    const raw = r.params.depends_on; if (!raw) return [];
    let ids: unknown; try { ids = JSON.parse(raw); } catch { throw new Error("depends_on must be a JSON array of native task ids"); }
    if (!Array.isArray(ids) || ids.length > 64 || ids.some(id => typeof id !== "string" || !/^R-\d+$/.test(id) || id === r.id) || new Set(ids).size !== ids.length) throw new Error("invalid native dependency identities");
    return ids as string[];
  }
  queueDomain: { worker(x: X, mode: string): boolean; ready(x: X): { ready: boolean; reason?: string }; admitted(x: X): void; answer(r: Run, node: WNode, rn: NodeRun, c: SCard): Record<string, unknown>; merged(r: Run, expected?: { project: string; repo: string }): boolean } | null = null;
  verifiedMerge(r: Run, expected?: { project: string; repo: string }) { return this.queueDomain?.merged(r, expected) ?? false; }
  private queueLimits(r?: Run) {
    const options = r ? { project: this.queueProject(r), workflow: r.def.policies } : {};
    const get = (name: string) => this.policies.get(`queue.${name}`, options).value;
    return { global: capacity(this.policies.get("queue.global_capacity").value, "queue.global_capacity"), project: capacity(get("project_capacity"), "queue.project_capacity") };
  }
  private queueTimeout(r?: Run) {
    const n = this.policies.get("queue.wait_timeout_s", r ? { project: this.queueProject(r), workflow: r.def.policies } : {}).value;
    if (!Number.isInteger(n) || n < 1 || n > 604800) throw new Error("queue.wait_timeout_s must be an explicit integer from 1 to 604800"); return n * 1000;
  }
  private jobAdmission(o: any, key: string): QueueRequest {
    const r = o.ref ? this.get(o.ref) : null;
    return { key, task: r?.id ?? o.ref ?? key, project: r ? this.queueProject(r) : "studio", deadline: Date.now() + this.queueTimeout(r ?? undefined), signal: r ? this.abortOf(r).signal : undefined,
      limits: () => this.queueLimits(r ?? undefined), ready: () => ({ ready: !r || !TERMINAL.includes(r.status), reason: "task ended" }), waiting() {}, admitted() {} };
  }
  private roundAdmission(x: X, mode: string): QueueRequest {
    const worker = this.queueDomain?.worker(x, mode) ?? false;
    const old = x.rn.data.nativeQueue;
    if (old && (old.version !== 1 || !Number.isInteger(old.visit) || !Number.isFinite(old.deadline))) throw new QueueRefusal("historical queued round has no valid visit/deadline binding; fresh preparation required");
    const deadline = old?.visit === x.visit ? old.deadline : Date.now() + this.queueTimeout(x.run);
    const key = `${x.run.id}/${x.node.id}#${x.visit}/${this.queueOwner}`;
    return { key, task: x.run.id, project: this.queueProject(x.run), deadline, signal: this.abortOf(x.run).signal, limits: () => this.queueLimits(x.run),
      ready: () => {
        if (TERMINAL.includes(x.run.status)) throw new Error("queued task ended");
        if (this.deps.agents.queue.snapshot().active.some(a => a.key.startsWith(`${x.run.id}/${x.node.id}#${x.visit}/`))) return { ready: false, reason: "previous owned round has not completed" };
        if (x.run.ctx.nativeQueueVersion !== 1) throw new Error("historical round has no native queue binding; fresh preparation required");
        return worker ? this.queueDomain!.ready(x) : { ready: true };
      },
      waiting: reason => { if (x.rn.data.nativeQueue?.reason === reason && x.rn.data.nativeQueue?.state === "waiting") return; x.rn.data.nativeQueue = { version: 1, visit: x.visit, deadline, state: "waiting", reason }; x.rn.note = reason; this.commit(x.run, "queued"); this.settle(x.run); },
      admitted: () => {
        if (worker) this.queueDomain!.admitted(x);
        x.rn.data.nativeQueue = { version: 1, visit: x.visit, deadline, state: "admitted" }; x.rn.note = "owned round admitted"; this.commit(x.run, "round admitted"); this.settle(x.run);
      } };
  }

  // ---------- the scheduler ----------
  tick(r: Run) {
    if (r.status === "paused" || TERMINAL.includes(r.status)) return;
    const q = r.queue.splice(0); if (q.length) this.commit(r, "scheduled");
    for (const id of q) if (r.nodes[id]?.state === "pending") void this.track(r, `node ${id}`, this.runNode(r, id));
    this.settle(r);
  }
  private settle(r: Run) {
    if (TERMINAL.includes(r.status) || r.status === "paused") return;
    if ((this.routing.get(r.id) ?? 0) > 0) return; // an edge's checks are still running
    const ns = Object.values(r.nodes);
    const before = r.status;
    if (ns.some((n) => n.state === "running" && !n.waiting && n.data?.nativeQueue?.state !== "waiting") || r.queue.length) r.status = "running";
    else if (ns.some((n) => n.state === "running" && n.waiting)) r.status = "waiting";
    else if (ns.some((n) => n.state === "running" && n.data?.nativeQueue?.state === "waiting")) r.status = "queued";
    else if (r.ctx.firstmateQuestion) r.status = "waiting"; // an agent's question waits for Firstmate's answer
    else { r.status = "failed"; r.error = "stalled: no node can run (a join is still waiting for an input)"; r.endedAt = now(); this.stopAll(r, "the run stalled"); }
    if (r.status !== before) { this.commit(r, r.status === "waiting" ? (ns.some(n => n.waiting === "external") ? "waiting(external)" : r.ctx.firstmateQuestion && !ns.some((n) => n.state === "running") ? "waiting(firstmate)" : "waiting(card)") : r.status === "failed" ? "stalled" : "running"); if (r.status === "failed") { this.emit(r, "failed", r.error!);
      this.raiseFailure(r, null, failure("internal.bug", r.error!, { source: "engine", run: r.id, diagnostics: { nodes: JSON.stringify(this.nodeStates(r)) } })); } }
  }

  x(r: Run, node: WNode, rn: NodeRun): X {
    const self = this;
    const pick = (): AgentPick => {
      const approved = self.deps.approvedPick?.(r, node); if (approved) return approved;
      if (rn.agent) return rn.agent;
      if (node.provider) return { provider: node.provider, model: node.model ?? null, ...(node.effort ? { effort: node.effort } : {}) };
      const role = r.def.roles.find((x) => x.id === node.role);
      if (role?.provider) return { provider: role.provider, model: role.model ?? null, ...(role.effort ? { effort: role.effort } : {}) };
      if (r.params.provider) return { provider: r.params.provider, model: r.params.model || null, ...(r.params.effort ? { effort: r.params.effort } : {}) };
      return this.deps.defaultProvider();
    };
    return { run: r, node, rn, visit: rn.visits, engine: this, deps: this.deps, ctx: r.ctx, dir: this.rdir(r.id),
      log: (text, data = {}) => self.emit(r, "log", `${node.id}: ${text}`, { node: node.id, ...data }),
      save: () => self.commit(r), cancelled: () => r.status === "cancelled",
      pick, provider: () => { const p = pick(); return self.deps.provider(p.provider, p.model ?? undefined); },
      policy: (path, dflt) => self.policy(r, path, dflt),
      // the agent's instructions: Studio's safety rules, the role skill, then each enabled skill (pinned by version and hash) under its heading
      skill: () => self.instructions(r, node.role ?? node.args?.role, self.nodePins(r, node), node.kind === "agent" ? node.skill : undefined),
      skillUse: () => self.instructionsUse(r, node.role ?? node.args?.role, self.nodePins(r, node), node.kind === "agent" ? node.skill : undefined) };
  }
  /** The skills a node's agent turns load: an agent node's own pins; a loop node's own, else those its role's agent nodes pin (its coordinator turns keep them). */
  nodePins(r: Run, node: WNode): { id: string; v: number; sha256: string }[] {
    // a staffed workflow's node loads the skills its approved configuration names for it (src/domain/staffing.ts)
    const approved = this.deps.approvedNodePins?.(r, node); if (approved !== undefined) return approved;
    if (Array.isArray(node.skills)) return pinsSkills(node) ? node.skills : [];
    if (node.kind !== "loop") return [];
    const role = node.role ?? node.args?.role; if (!role) return [];
    return r.def.nodes.filter((n) => n.kind === "agent" && n.role === role).flatMap((n) => n.skills ?? []).filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i);
  }
  /** The skills a hook action's own model turn loads (the pull request text, the image request): the pins of the hook that runs it. */
  textPins(r: Run, action: (typeof MODEL_HOOK_ACTIONS)[number]): { id: string; v: number; sha256: string }[] {
    const hook = r.def.nodes.find((n) => n.kind === "hook" && n.do === action);
    return hook ? this.nodePins(r, hook) : [];
  }
  /** A role's skill text: Studio's versioned copy (the text the Improve page shows and edits) when there is one, else its source. Null: no such role. */
  roleSkillText(def: WDef, roleId: string | undefined, nodeSkill?: string): { text: string; ref: string; version: number | null } | null {
    // a node may name its own bundled role skill (the captain's inline choice); never a file path
    const role = def.roles.find((x) => x.id === roleId);
    if (typeof nodeSkill === "string" && nodeSkill.startsWith("bundled:workflows/skills/v2/")) return { text: this.deps.skillText(nodeSkill), ref: nodeSkill, version: null };
    if (!role?.skill) return null;
    const stored = this.deps.roleSkill?.(def.id, role.id, role.skill);
    return stored ? { text: stored.text, ref: role.skill, version: stored.version } : { text: this.deps.skillText(role.skill), ref: role.skill, version: null };
  }
  /** The one way an agent's instructions are built (architecture §5): the safety rules, the role's skill, then each pinned skill in order. */
  instructions(r: Run, roleId: string | undefined, pins: { id: string; v: number; sha256: string }[], nodeSkill?: string): string {
    return this.instructionsUse(r, roleId, pins, nodeSkill).text;
  }
  /** The same instructions, with the role skill they carry (ref, version, sha256 of the exact role text) and the node skills as name@vN. */
  instructionsUse(r: Run, roleId: string | undefined, pins: { id: string; v: number; sha256: string }[], nodeSkill?: string): { text: string; roleSkill: RoleSkillUse | null; skills: string[] } {
    const approved = this.deps.approvedSkill?.(r, roleId);
    let roleText = approved === undefined ? "" : `# Approved native role snapshot\n${approved}\n# End native role snapshot`;
    let src: { text: string; ref: string; version: number | null } | null = null;
    if (approved === undefined) { try { src = this.roleSkillText(r.def, roleId, nodeSkill); roleText = src?.text ?? ""; } catch {} }
    else { try { src = this.roleSkillText(r.def, roleId); } catch {} }
    const roleSkill = this.roleSkillOf(roleId, src, approved ?? src?.text ?? "");
    return { text: composeInstructions(roleText, pins.map((p) => ({ id: p.id, v: p.v, body: this.skillLibrary().body(p.id, p.v, p.sha256) }))), roleSkill, skills: pins.map((p) => `${p.id}@v${p.v}`) };
  }
  /** Which role skill a text is (ref, Studio version, sha256 of the exact text, and its parts' hashes for a role of several named skills). */
  private roleSkillOf(roleId: string | undefined | null, src: { ref: string; version: number | null } | null, text: string): RoleSkillUse | null {
    const parts = roleSkillParts(src?.ref);
    const partUse = parts.length > 1 ? { parts: parts.map((ref) => { let sha256: string | null = null; try { sha256 = createHash("sha256").update(this.deps.skillText(ref)).digest("hex"); } catch {} return { ref, sha256 }; }) } : {};
    return text.trim() ? { role: roleId ?? null, ref: src?.ref ?? null, version: src?.version ?? null, sha256: createHash("sha256").update(text).digest("hex"), ...partUse } : null;
  }
  /** The role skill a role's agents receive in this definition, as the Crew page names it; null when the role has none. */
  roleSkillUse(def: WDef, roleId: string | null | undefined): RoleSkillUse | null {
    const src = this.roleSkillText(def, roleId ?? undefined); return src ? this.roleSkillOf(roleId, src, src.text) : null;
  }
  /** Studio's skill library under this data folder; an engine built without one (a test, a tool) opens the same store. */
  skillLibrary(): Skills {
    if (!this.deps.library) this.deps.library = new Skills(this.deps.dataDir, { list: () => [], get: () => null, sourceSkill: () => null } as any);
    return this.deps.library;
  }
  /** Policy resolution (§6): org → project → workflow version override → run override (only set by a card answer). auth.* never resolves here: see grants. */
  policy(r: Run, path: string, dflt?: any) {
    if (path === "auth" || path.startsWith("auth.")) return undefined;
    const v = this.policies.get(path, { project: r.ctx.project ?? r.params.project ?? null, workflow: r.def.policies ?? null }).value ?? dflt;
    const add = Number(r.ctx.policyAdds?.[path] ?? 0); // a run override set by a card adds to what resolved, never replaces it
    return add && typeof v === "number" ? v + add : v;
  }

  private async runNode(r: Run, id: string) {
    const node = r.def.nodes.find((n) => n.id === id)!; const rn = r.nodes[id];
    const key = `${r.id}/${id}`; if (this.live.has(key)) return;
    const cap = node.max_visits ? node.max_visits + (rn.extra ?? 0) : Infinity;
    if (rn.visits >= cap) {
      r.steps.push({ seq: r.steps.length + 1, node: id, kind: node.kind, visit: rn.visits, state: "failed", outcome: "cap", startedAt: now(), endedAt: now(), error: null, job: null, provider: null, model: null, note: `round cap: ${cap} visits` });
      rn.state = "failed"; rn.outcome = "cap"; rn.cause = "cap"; rn.routing = { outcome: "cap" }; this.commit(r, "cap"); this.emit(r, "capped", `${node.label}: round cap reached (${cap})`, { node: id });
      return void this.track(r, `routing after ${id}`, this.route(r, node, "cap"));
    }
    for (const s of r.steps) if (s.node === id && (s.state === "passed" || s.state === "failed")) s.state = "superseded";
    rn.visits++; rn.state = "running"; rn.cause = rn.visits > 1 ? `visit ${rn.visits}` : "token"; rn.startedAt = now(); rn.endedAt = null; rn.error = null; rn.outcome = null; rn.waiting = null; rn.data.externalCompletion = null; rn.data.externalHookReport = null;
    const x = this.x(r, node, rn);
    let pk: AgentPick | null = null;
    try { pk = node.kind === "agent" ? x.pick() : null; } catch (error) { if (!(error instanceof QueueRefusal) && !(error instanceof ProviderRefusal)) throw error; }
    const step: Step = { seq: r.steps.length + 1, node: id, kind: node.kind, visit: rn.visits, state: "running", outcome: null, startedAt: now(), endedAt: null, error: null, job: null, provider: pk?.provider ?? null, model: pk?.model ?? null, ...(pk ? { effort: pk.effort ?? null } : {}), note: null };
    r.steps.push(step); this.commit(r, rn.cause);
    this.emit(r, "node_started", `${node.label}${rn.visits > 1 ? ` (visit ${rn.visits})` : ""}`, { node: id, visit: rn.visits, kind: node.kind, ...(pk ? { provider: pk.provider, model: pk.model } : {}) });
    this.live.add(key);
    let res: Result | null = null, err: string | null = null, blocked = false, thrown: unknown = null;
    try {
      const h = node.kind === "card" && node.args?.mode && this.cardModes[node.args.mode] ? this.cardModes[node.args.mode] : this.kinds[node.kind];
      if (!h) throw new FailureError("internal.bug", `no runner for node kind ${node.kind}`);
      for (const guard of Object.values(this.beforeStart)) { res = await guard(x); if (res) break; }
      if (!res) {
        try { res = await h.start(x); }
        catch (e) {
          // Nested coordinator turns belong to the loop but need the same
          // formal readiness recovery as a top-level agent turn.
          if (node.kind !== "loop" || x.cancelled() || (!(e instanceof QueueRefusal) && !(e instanceof ProviderRefusal))) throw e;
          res = await this.queueCapability(x, e.message, e);
        }
      }
      res = await this.afterChecks(x, step, res);
    } catch (e: any) { err = homeless(redactText(String(e?.message ?? e))).slice(0, 1200); blocked = e?.outcome === "blocked"; thrown = e; } // credentials and the home folder go before any cut; a RoundBlocked is never retried
    finally { this.live.delete(key); }
    this.finish(r, node, rn, step, res, err, blocked, thrown);
  }
  /** An agent or card node's own checks run once it has produced; a blocking fail makes it fail. */
  private async afterChecks(x: X, step: Step, res: Result | null): Promise<Result | null> {
    if (!res || "wait" in res || !x.node.checks?.length || x.node.kind === "check" || x.node.kind === "hook" || x.cancelled()) return res;
    for (const applicable of Object.values(this.beforeNodeChecks)) { if (!this.owns(x)) return res; if (applicable(x, res)) return res; }
    if (FAILS.includes(res.outcome) || (res as any).stopped) return res; // a round stopped before its agent produced nothing to check
    const out = await this.runChecks(x, x.node.checks, null);
    step.checks = out.entries.map((e) => ({ check: e.check, verdict: e.verdict, seq: e.seq }));
    if (out.blocked.length) { const note = `${out.blocked.map((e) => `${e.check}: ${e.verdict}`).join(", ")}${res.note ? ` · ${res.note}` : ""}`;
      return { outcome: "fail", note, failure: this.checkFailure(x, out.blocked, "deterministic.check") }; }
    return { outcome: res.outcome, note: [res.note, `${out.entries.filter((e) => e.verdict === "pass").length}/${out.entries.length} checks pass`].filter(Boolean).join(" · ") };
  }

  /** A node's attempt ended (or is now waiting on a card). */
  private finish(r: Run, node: WNode, rn: NodeRun, step: Step, res: Result | null, err: string | null, blocked = false, thrown: unknown = null) {
    // whatever way the node ends this step (waiting on its card, a retry, an error, a late result), its card is no longer being raised: once, here
    if (rn.card) this.raising.get(rn.card)?.resolve();
    // a step that failed after raising its card leaves no open card behind (a retry raises its own)
    if (err && rn.card && this.cards.get(rn.card)?.status === "open") { this.cards.cancel(rn.card); rn.card = null; }
    if (rn.agent && !step.provider) { step.provider = rn.agent.provider; step.model = rn.agent.model; }
    step.job = rn.job ?? step.job;
    // a result that arrives after the run ended is refused: the node was already stopped
    if (TERMINAL.includes(r.status)) { if (step.state === "running" || step.state === "waiting") { step.state = "skipped"; step.endedAt = now(); step.note = `late result refused (the run is ${r.status})`; } if (rn.state === "running") { rn.state = "skipped"; rn.cause = `the run is ${r.status}`; } this.commit(r, "late result refused"); return; }
    if (err) {
      step.state = "error"; step.error = err; step.endedAt = now();
      // classified at the source when it threw a typed failure; otherwise by its words (no rule: internal, with diagnostics)
      rn.data.failure = fromError(thrown ?? err, { source: node.kind === "agent" ? "agent" : node.kind === "check" ? "check" : "engine", run: r.id, node: node.id, visit: rn.visits, inputs: this.failureInputs(r, node), log: rn.job ? { k: "job", job: rn.job, run: r.id, node: node.id, round: String(rn.visits) } : null });
      // blocked: the step cannot start safely (its reason says why); a retry would hit the same wall
      if (!blocked && rn.attempt < (node.retries ?? 0)) {
        rn.attempt++; rn.visits--; rn.state = "pending"; rn.cause = `retry ${rn.attempt + 1}: ${err.slice(0, 120)}`; r.queue.push(node.id); this.commit(r, "retry");
        this.emit(r, "retry", `${node.label}: attempt ${rn.attempt + 1} after: ${err.slice(0, 200)}`, { node: node.id, error: err });
        return this.tick(r);
      }
      // a blocked step takes a "blocked" edge when the workflow has one; otherwise it routes as an error (never retried)
      const routeAs = blocked && r.def.edges.some((e) => e.from === node.id && e.when?.split("|").includes("blocked")) ? "blocked" : "error";
      if (blocked) { step.outcome = "blocked"; this.emit(r, "round_blocked", `${node.label}: ${err.slice(0, 300)}`, { node: node.id }); }
      rn.attempt = 0; rn.state = "error"; rn.cause = blocked ? "blocked" : "error"; rn.error = err; rn.endedAt = now(); rn.outcome = blocked ? "blocked" : "error"; rn.routing = { outcome: routeAs }; this.commit(r, rn.cause);
      this.emit(r, "node_failed", `${node.label}: ${err.slice(0, 300)}`, { node: node.id, error: err });
      return void this.track(r, `routing after ${node.id}`, this.route(r, node, routeAs));
    }
    if (res && "wait" in res) {
      if (res.external) {
        rn.data.external = res.external; step.state = "waiting"; step.note = res.note ?? step.note;
        rn.waiting = "external"; rn.cause = "waiting(external)"; this.commit(r, "waiting(external)");
        this.emit(r, "node_waiting", `${node.label}: ${res.note ?? "waiting for external verification"}`, { node: node.id, waiting: "external" });
        this.registerExternal(r, node, rn); return this.settle(r);
      }
      if (res.firstmate) { step.state = "waiting"; step.note = res.note ?? step.note; rn.waiting = "firstmate"; rn.cause = "waiting(firstmate)"; this.commit(r, "waiting(firstmate)");
        this.emit(r, "node_waiting", `${node.label}: ${res.note ?? "Firstmate diagnoses this first"}`, { node: node.id, waiting: "firstmate" }); return this.settle(r); }
      step.state = "waiting"; step.note = res.note ?? step.note; rn.waiting = "card"; rn.cause = "waiting(card)"; this.commit(r, "waiting(card)");
      this.emit(r, "node_waiting", `${node.label}: ${res.note ?? "waiting for the captain"}`, { node: node.id, card: rn.card });
      return this.settle(r);
    }
    const outcome = (res as any)?.outcome ?? "ok";
    const failed = FAILED_OUTCOMES.has(outcome);
    rn.data.failure = (res as any)?.failure ?? null; // a source that knows its failure's class says so with its result
    step.state = failed ? "failed" : "passed"; step.outcome = outcome; step.note = (res as any)?.note ?? step.note; step.endedAt = now();
    rn.attempt = 0; rn.state = failed ? "failed" : "passed"; rn.outcome = outcome; rn.cause = failed ? ((res as any)?.cause ?? outcome) : `→ ${outcome}`; rn.waiting = null; rn.endedAt = now(); rn.note = step.note;
    if (r.def.edges.some((e) => e.from === node.id)) rn.routing = { outcome }; // one durable step: the result and the routing still to do
    this.commit(r, rn.cause!);
    this.emit(r, "node_done", `${node.label} → ${outcome}${step.note ? `: ${String(step.note).slice(0, 200)}` : ""}`, { node: node.id, outcome, visit: rn.visits });
    void this.track(r, `the after:${node.id} hooks`, this.hooksAt(r, node, `after:${node.id}`));
    if (!r.def.edges.some((e) => e.from === node.id)) return this.end(r, node, outcome);
    void this.track(r, `routing after ${node.id}`, this.route(r, node, outcome));
  }

  private async route(r: Run, node: WNode, outcome: string): Promise<void> {
    if (TERMINAL.includes(r.status)) return;
    const outs = [...r.def.edges.filter((e) => e.from === node.id), ...Object.values(this.continuationEdges).flatMap(f=>f(r,node,outcome))];
    let take = outs.filter((e) => e.when && e.when.split("|").includes(outcome));
    if (!take.length && !FAILS.includes(outcome)) take = outs.filter((e) => !e.when);
    // an edge's checks run before it is taken; a blocking fail re-routes the source as "fail"
    const checked = take.filter((e) => e.checks?.length);
    if (checked.length && r.status !== "cancelled") {
      this.routing.set(r.id, (this.routing.get(r.id) ?? 0) + 1);
      try {
        const x = this.x(r, node, r.nodes[node.id]);
        for (const e of checked) {
          const token = Symbol(ekey(e)); x.edgeOwner = token;
          this.edgeOwners.set(token, { run: r, node, rn: x.rn, visit: x.visit, head: x.ctx.head ?? null });
          let out: Awaited<ReturnType<Engine["runChecks"]>>;
          try { out = await this.runChecks(x, e.checks!, ekey(e)); if (!this.owns(x)) {
            if (this.runs.get(r.id) === r && !TERMINAL.includes(r.status) && !this.gone.has(r.id)) { r.status = "failed"; r.endedAt = now(); r.error = "edge ownership or head changed during checks"; this.stopAll(r,r.error); this.commit(r,r.error); this.emit(r,"failed",r.error);
            this.raiseFailure(r, node, failure("internal.bug", r.error, { source: "engine", run: r.id, node: node.id, visit: x.visit, diagnostics: { edge: ekey(e), head: String(x.ctx.head ?? "") } })); } return;
          } }
          finally { this.edgeOwners.delete(token); delete x.edgeOwner; }
          if (TERMINAL.includes(r.status) || this.gone.has(r.id)) return;
          const st = [...r.steps].reverse().find((s) => s.node === node.id);
          if (st) st.checks = [...(st.checks ?? []), ...out.entries.map((y) => ({ check: y.check, verdict: y.verdict, seq: y.seq }))];
          if (out.blocked.length) {
            this.emit(r, "edge_blocked", `${ekey(e)}: ${out.blocked.map((y) => `${y.check} ${y.verdict}`).join(", ")}`, { node: node.id, edge: ekey(e) });
            const rn = r.nodes[node.id]; rn.state = "failed"; rn.outcome = "fail"; rn.cause = `edge ${ekey(e)} blocked`; rn.routing = { outcome: "fail" }; if (st) { st.state = "failed"; st.outcome = "fail"; }
            rn.data.failure = this.checkFailure(x, out.blocked, "deterministic.gate", ekey(e));
            this.commit(r, rn.cause);
            return this.route(r, node, "fail");
          }
        }
      } finally { this.routing.set(r.id, (this.routing.get(r.id) ?? 1) - 1); }
      if (r.status === "cancelled") return;
    }
    if (!take.length) {
      // an agent's question Firstmate will answer is a wait, not a failure: the run waits (status waiting) until the answer or an escalation
      let f = this.failureOf(r, node, outcome);
      if (f.code === "ask.escalated" && !f.escalation?.reason) {
        r.nodes[node.id].routing = null; this.stopAll(r, "waiting for Firstmate's answer");
        if (this.toFirstmate(r, node, f)) { r.status = "waiting"; r.error = null; this.commit(r, "waiting(firstmate)"); return; }
        f = { ...f, escalation: { by: "firstmate", reason: "Firstmate is not running, so it could not answer this question." } };
      }
      r.status = "failed"; r.endedAt = now();
      r.error = outcome === "cap" ? `${node.label}: the round cap was reached` : outcome === "error" ? `${node.label} failed: ${r.nodes[node.id].error ?? ""}` : `${node.label} ended with "${outcome}" and no edge takes it`;
      r.nodes[node.id].routing = null; this.stopAll(r, "the run failed");
      this.commit(r, `no edge for ${outcome}`); this.emit(r, "failed", r.error, { node: node.id });
      this.raiseFailure(r, node, f);
      return;
    }
    for (const e of take) this.deliver(r, e.to, node.id);
    // the edges the run took, by name: the graph colours an edge as walked only when the run's events record it
    for (const e of take) this.emit(r, "edge_taken", `${node.label} → ${r.def.nodes.find((n) => n.id === e.to)?.label ?? e.to}${e.when ? ` (${outcome})` : ""}`, { node: node.id, edge: ekey(e), from: node.id, to: e.to, outcome });
    r.nodes[node.id].routing = null; // the tokens and the cleared marker are one durable step
    this.commit(r, `${node.id} → ${outcome}`); this.tick(r);
  }
  private deliver(r: Run, to: string, from: string) {
    const tn = r.nodes[to]; const node = r.def.nodes.find((n) => n.id === to)!;
    if (node.join === "all") {
      if (!tn.inbox.includes(from)) tn.inbox.push(from);
      const need = [...new Set(r.def.edges.filter((e) => e.to === to).map((e) => e.from))];
      if (!need.every((s) => tn.inbox.includes(s))) { this.emit(r, "join_wait", `${node.label}: ${tn.inbox.length}/${need.length} inputs in`, { node: to }); return; }
      tn.inbox = [];
    }
    if (tn.state === "running" || r.queue.includes(to)) return;
    tn.state = "pending"; tn.cause = `token from ${from}`; r.queue.push(to);
  }
  /** A run that reached a terminal status stops everything still live: sibling agent jobs, open cards, queued nodes. Late results are refused (finish/route return early). */
  /** A path the runtime may let a check (or a round) read: not inside a protected root, and inside Studio's data only where the runtime materializes work (worktrees, the sandbox repo, clones, artifact versions, this run's evidence). */
  readable(p: string, run: string | null): boolean {
    if (!existsSync(p)) return false;
    const under = (root: string) => realInside(root, p, true); // the one real-path containment rule (secure.ts)
    for (const root of this.deps.protectedRoots ?? []) if (under(root)) return false;
    if (!under(this.deps.dataDir)) return true;
    const d = this.deps.dataDir;
    return ["work", "demo-repo", "repos", "artifacts"].some((x) => under(join(d, x))) || (!!run && under(join(d, "evidence", run)));
  }
  private aborts = new Map<string, AbortController>();
  /** Every check process a run starts listens to this; ending the run kills their process groups. */
  abortOf(r: Run) { let a = this.aborts.get(r.id); if (!a) { a = new AbortController(); this.aborts.set(r.id, a); } return a; }
  private stopAll(r: Run, cause: string) {
    for (const [key, owner] of this.externalOwners) if (key.startsWith(r.id + "/")) { owner.cancel(); this.externalOwners.delete(key); }
    this.abortOf(r).abort(); this.aborts.delete(r.id);
    if (r.ctx.firstmateQuestion?.card) delete r.ctx.firstmateQuestion; // an escalation still with Firstmate ends with the run
    // what this stop interrupted: a failure card's retry puts these back (parallel siblings, queued nodes), so a join still gets every input
    r.ctx.stopped = { cause, nodes: Object.entries(r.nodes).filter(([, n]) => n.state === "running").map(([id]) => id), queue: [...r.queue] };
    for (const rn of Object.values(r.nodes)) {
      if (rn.state !== "running" && !r.queue.length) continue;
      if (rn.state === "running") { if (rn.job) this.deps.agents.cancel(rn.job); if (rn.card) { this.cards.cancel(rn.card); this.raising.get(rn.card)?.resolve(); } rn.state = "skipped"; rn.waiting = null; rn.cause = cause; }
    }
    for (const st of r.steps) if (st.state === "running" || st.state === "waiting") { st.state = "skipped"; st.endedAt = now(); st.note = cause; }
    r.queue = [];
    for (const c of this.cards.list({ run: r.id, open: true })) { this.cards.cancel(c.id); this.raising.get(c.id)?.resolve(); }
  }
  private end(r: Run, node: WNode, outcome: string) {
    // a run the captain rejected at its acceptance card ends closed whatever its end node says (R-047: a drafted "closed" hook had no result)
    r.status = "succeeded"; r.result = node.args?.result ?? (r.ctx.acceptRejected ? "closed" : FAILED_OUTCOMES.has(outcome) ? outcome : "done"); r.endedAt = now();
    this.stopAll(r, "the run ended");
    this.commit(r, `ended at ${node.id}`); this.emit(r, r.result === "done" ? "done" : "closed", node.args?.summary ? fill(node.args.summary, r) : `${node.label}`, { result: r.result });
    if (FAILED_OUTCOMES.has(outcome) && !node.args?.result) this.raiseFailure(r, node, this.failureOf(r, node, outcome)); // a run that ends on a failed outcome is a failure too, never only a word in its result
  }

  // ---------- checks ----------
  /** Run checks (in parallel), record each in the ledger; returns the blocking failures. */
  async runChecks(x: X, refs: CheckRef[], edge: string | null): Promise<{ entries: LedgerEntry[]; blocked: LedgerEntry[] }> {
    const entries = await Promise.all(refs.map((ref) => this.runCheck(x, ref, edge)));
    return { entries, blocked: entries.filter((e) => e.blocking && (e.verdict === "fail" || e.verdict === "error")) };
  }
  /** Parameters: the schema's defaults, then policy (org → project → workflow → run), then the workflow's own override on the check. */
  params(man: CheckManifest, ref: CheckRef | null, o: { project?: string | null; workflow?: Record<string, any> | null; run?: Run | null }) {
    const p: Record<string, any> = schemaDefaults(man.params); const from: Record<string, string> = {};
    for (const k of Object.keys(p)) from[k] = "default";
    for (const [k, path] of Object.entries(man.policy_bind ?? {})) {
      const v = this.policies.get(path, o);
      // in a run, the run's own resolution: overrides and a card's additions apply on top of what resolved, never instead of it
      const val = o.run ? this.policy(o.run, path, p[k]) : v.value;
      if (val !== undefined) { p[k] = val; from[k] = `policy ${path} (${o.run?.ctx.policyAdds?.[path] ? `${v.from ?? "default"} + run` : v.from})`; } }
    for (const [k, v] of Object.entries(coerce(man.params, ref?.params ?? {}))) { p[k] = v; from[k] = "workflow"; }
    return { params: p, from, errors: schemaErrors(man.params, p) };
  }
  /** Record a non-check ledger entry (a review verdict, a plan acceptance, a card answer). */
  record(x: X, record: string, e: Partial<LedgerEntry>) {
    if (this.gone.has(x.run.id)) return null; // stale native/agent holders never append after deletion
    const rec = new Ledger(this.deps.dataDir, x.run.id).add({ run: x.run.id, node: x.node.id, edge: null, round: x.visit, head: x.ctx.head ?? null, check: `runtime/${record}`, version: "1", kind: "record", attempt: 0,
      verdict: "pass", score: null, findings: [], evidence: [], proves: [], blocking: false, inputHash: "", params: {}, ms: 0, dir: null, record, ...e } as any);
    this.emit(x.run, "evidence", `${record} recorded (#${rec.seq})`, { node: x.node.id, record, seq: rec.seq, sig: rec.sig });
    return rec;
  }
  /** A record a hook may write again when it runs again after a restart (resume semantics): kept once per node, visit and head. */
  recordOnce(x: X, record: string, e: Partial<LedgerEntry>) {
    const head = e.head !== undefined ? e.head : x.ctx.head ?? null;
    const prior = this.ledger(x.run.id).find((l) => l.record === record && l.node === x.node.id && l.round === x.visit && (l.head ?? null) === head);
    return prior ?? this.record(x, record, e);
  }

  /**
   * The ledger as far as it can be trusted: every signature and chain link holds,
   * and it is not shorter than the run's own events say (a truncated tail is caught).
   */
  trusted(id: string): { entries: LedgerEntry[]; prefix: LedgerEntry[]; bad: Set<number>; truncated: boolean; ok: boolean } {
    const scan = new Ledger(this.deps.dataDir, id).authenticatedPrefix(), entries = scan.entries, bad = new Set(scan.bad);
    let prefix = scan.prefix;
    const seen = this.events(id).filter((e) => (e.type === "check_result" || e.type === "evidence") && Number.isSafeInteger(e.seq) && e.seq > 0);
    const tip = seen.reduce((m, e) => Math.max(m, e.seq), 0), tail = entries.at(-1)?.seq;
    const last = Number.isSafeInteger(tail) && tail! > 0 ? tail! : 0;
    for (const e of seen) {
      const x = entries.find((y) => y.seq === e.seq);
      if (x && e.sig && x.sig !== e.sig) {
        bad.add(e.seq);
        const position = prefix.indexOf(x); if (position >= 0) prefix = prefix.slice(0, position);
      }
    }
    const truncated = last < tip;
    return { entries, prefix, bad, truncated, ok: !scan.malformed && !bad.size && !truncated };
  }
  actionAnswers: Record<string, (x: X, card: SCard) => Promise<Result>> = {};
  checkBindings: Record<string, (x: X, input: CheckInput) => Record<string, any>> = {};
  async runCheck(x: X, ref: CheckRef, edge: string | null, extra: Record<string, any> = {}): Promise<LedgerEntry> {
    const L = new Ledger(this.deps.dataDir, x.run.id);
    const man = this.registry.get(ref.use);
    if (TERMINAL.includes(x.run.status) && !String(edge ?? "").startsWith("hook:")) return ({ run: x.run.id, node: x.node.id, edge, round: x.visit, head: x.ctx.head ?? null, check: ref.use, version: man?.version ?? "?", kind: man?.kind ?? "deterministic", attempt: 0, record: "check", verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `not run: the run is ${x.run.status}`, blocking: false, inputHash: "", params: {}, ms: 0, dir: null } as any);
    const base = { run: x.run.id, node: x.node.id, edge, round: x.visit, head: x.ctx.head ?? null, check: ref.use, version: man?.version ?? "?", kind: man?.kind ?? "deterministic", attempt: 0, record: "check", actor: null as string | null };
    if (!man) return this.recordCheck(x, L, { ...base, verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `no check ${ref.use}`, blocking: ref.blocking ?? true, inputHash: "", params: {}, ms: 0, dir: null });
    const pr = this.params(man, ref, { project: x.ctx.project ?? x.run.params.project ?? null, workflow: x.run.def.policies ?? null, run: x.run });
    let blocking = ref.blocking ?? man.blocking;
    const quorum = ref.quorum ?? man.judge?.quorum ?? null;
    if (man.kind === "judged" && blocking && !quorumOk(quorum)) blocking = false; // a judged check blocks only with a quorum of at least 2 independent votes
    if (man.kind === "hook") blocking = false;
    // the evidence folder's name is unique even when one node runs the same check twice at once
    const cdir = join(L.dir, `${Date.now().toString(36)}${randomBytes(4).toString("hex")}-${man.id}`); const out = join(cdir, "out");
    mkdirSync(out, { recursive: true });
    let input: CheckInput;
    try { input = { ...(await this.input(x, man, pr.params, out, Object.keys(extra))), ...extra }; }
    catch (e: any) { return this.recordCheck(x, L, { ...base, verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `could not build the input: ${e?.message ?? e}`, blocking, inputHash: "", params: pr.params, ms: 0, dir: cdir }); }
    const binding = this.checkBindings[man.ref]?.(x, input);
    if (pr.errors.length) return this.recordCheck(x, L, { ...base, verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `params: ${pr.errors.join("; ")}`, blocking, inputHash: hashInput(input), params: pr.params, ms: 0, dir: cdir });
    const t0 = Date.now();
    // a lifecycle hook is reported even when the run has just ended; every other check stops with its run
    const signal = String(edge ?? "").startsWith("hook:") ? undefined : this.abortOf(x.run).signal;
    let res = await this.exec(x, man, ref, input, cdir, signal);
    let retried: string | null = null;
    // flaky policy: only a tool error is retried (once by default), logged by name; an assertion failure never is
    const retries = Number(this.policy(x.run, "flaky.retry", 1));
    if (res.verdict === "error" && retries > 0 && /^(tool error|spawn)/.test(res.error ?? "")) {
      retried = res.error ?? "error"; this.emit(x.run, "check_retry", `${man.ref}: retrying once after a tool error: ${String(res.error).slice(0, 160)}`, { node: x.node.id, check: man.ref });
      res = await this.exec(x, man, ref, input, cdir, signal);
    }
    if (binding) res.data = { ...res.data, binding };
    const proves = res.verdict === "pass" ? [...new Set([...(res.proves ?? []), ...(ref.proves ?? []), ...(man.proves ?? [])])] : [];
    return this.recordCheck(x, L, { ...base, ...res, actor: res.votes?.map((v) => v.by).join(", ") || null, proves, attempt: retried ? 1 : 0, retried, blocking, inputHash: hashInput(input), params: pr.params, ms: Date.now() - t0, dir: cdir });
  }
  private recordCheck(x: X, L: Ledger, e: any): LedgerEntry {
    if ((x.edgeOwner && !this.owns(x)) || this.gone.has(x.run.id) || (TERMINAL.includes(x.run.status) && !String(e.edge ?? "").startsWith("hook:"))) return { ...e, seq: 0, sig: "", error: "late check result refused" }; // no ordinary check writes after its owner ends
    const rec = L.add(e.inputHash ? { ...e, inputHashAlgorithm: INPUT_HASH_ALGORITHM } : e);
    this.emit(x.run, "check_result", `${e.edge ? `${e.edge} · ` : `${x.node.label} · `}${e.check}: ${e.verdict}${e.findings.length ? ` (${e.findings.length} finding${e.findings.length > 1 ? "s" : ""})` : ""}${e.error ? ` — ${String(e.error).slice(0, 160)}` : ""}`,
      { node: x.node.id, check: e.check, verdict: e.verdict, seq: rec.seq, sig: rec.sig, blocking: e.blocking, edge: e.edge ?? null });
    return rec;
  }
  async input(x: X, man: CheckManifest, params: Record<string, any>, out: string, given: string[] = []): Promise<CheckInput> {
    const type = man.applies_to.find((t) => this.artifacts[t]) ?? null;
    const artifact = type ? this.artifacts[type](x) : null;
    const prev = this.ledger(x.run.id).filter((e) => e.check === man.ref && e.node === x.node.id).at(-1) ?? null;
    const input: CheckInput = { run: x.run.id, node: x.node.id, round: x.visit, artifact, previous: prev ? { verdict: prev.verdict, score: prev.score, findings: prev.findings, head: prev.head } : null,
      spec: x.ctx.spec?.done ? { done: x.ctx.spec.done } : null, params, workdir: artifact?.workdir ?? null, out };
    for (const n of man.needs) { if (n === "artifact" || n === "previous" || n === "spec" || given.includes(n)) continue; const f = this.needs[n]; if (!f) throw new Error(`nothing provides "${n}"`); input[n] = await f(x, man); }
    return input;
  }
  /** Execute one check: native, exit-code adapter, executable, or a model judge. */
  async exec(x: X, man: CheckManifest, ref: CheckRef, input: CheckInput, cdir: string, signal?: AbortSignal): Promise<CheckOutput> {
    const E = (error: string): CheckOutput => ({ verdict: "error", score: null, findings: [], evidence: [], proves: [], error });
    try {
      if (man.kind === "judged") return await this.judge(x, man, ref, input);
      if (man.native) {
        const f = this.natives[man.native]; if (!f) return E(`no native check ${man.native}`);
        // A timeout reports the check early, but cannot stop an in-process native.
        // Keep its actual promise holding the run until all of its writes finish.
        const native = Promise.resolve().then(() => f(input, { x, manifest: man }));
        void this.track(x.run, `native check ${man.ref}`, native);
        let timer: any; const r = await Promise.race([native, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${man.timeout_s} s`)), man.timeout_s * 1000); })]).finally(() => clearTimeout(timer));
        return parseOutput(JSON.stringify(r), man.ref);
      }
      // reads widen only to paths the runtime itself put in the input (never a check's params), real paths, never a protected root or Studio's own state
      const reads = inputPaths({ ...input, params: undefined }).filter((p) => p !== input.out && this.readable(p, x.run?.id ?? null));
      const sb = { out: input.out, tmp: join(cdir, "tmp"), timeoutS: man.timeout_s, network: man.network, reads, dataDir: this.deps.dataDir, signal };
      if (man.adapter) {
        const argv = man.adapter.command.flatMap((a) => { const m = /^\{([\w.]+)\}$/.exec(a); if (m) return this.expand[m[1]]?.(x) ?? []; return [a.replace(/\{param\.(\w+)\}/g, (_, k) => String(input.params[k] ?? "")).replace(/\{workdir\}/g, input.workdir ?? "")]; });
        if (!argv.length) {
          const reason = `nothing to run: ${man.adapter.command.join(" ")} is not declared for this repository`;
          if (man.adapter.optional === true) return {verdict:"pass",score:1,findings:[],evidence:[],proves:[],data:{status:"not-run",reason}};
          return E(reason);
        }
        const { log, ...res } = await execAdapter(argv, { ...sb, cwd: input.workdir ?? cdir, passOn: man.adapter.pass_on, regex: man.adapter.findings_from?.regex ?? null, cls: man.adapter.findings_from?.class ?? man.id, severity: man.adapter.findings_from?.severity, ref: man.ref, env: input.env ?? {} });
        void log; return res;
      }
      const exe = this.registry.executable(man);
      const embedded = man.runtime === "studio";
      const executableHash = embedded ? createHash("sha256").update(readFileSync(exe)).digest("hex") : null;
      if (embedded && (man as any).studioScriptHash && executableHash !== (man as any).studioScriptHash) throw new Error("validated check script hash changed during extraction");
      const canaryDir = join(this.deps.dataDir, "check-canaries"); let guard: string | null = null;
      if (embedded) { mkdirSync(canaryDir, { recursive: true }); guard = join(realpathSync(canaryDir), randomBytes(16).toString("hex")); writeFileSync(guard, "Studio check sandbox denial canary", { mode: 0o644, flag: "wx" }); if (readFileSync(guard, "utf8") !== "Studio check sandbox denial canary") throw new Error("sandbox canary control failed"); }
      const argv = embedded ? helperCommand("check-script", [realpathSync(exe), (man as any).studioScriptHash ?? executableHash!, guard!]) : [exe];
      let r; try { r = await sandboxed(argv, { ...sb, reads: embedded ? [...reads, exe, ...helperReads()] : reads, cwd: input.workdir ?? cdir, stdin: JSON.stringify(input), env: embedded ? {} : input.env ?? {} }); } finally { if (guard) rmSync(guard, { force: true }); }
      if (r.refused) return E(`refused: ${r.refused}`);
      if (r.aborted) return E("stopped: the run ended");
      writeFileSync(join(cdir, "stderr.txt"), r.stderr);
      if (r.timedOut) return E(`timeout after ${man.timeout_s} s`);
      if (r.code !== 0) return E(`exit ${r.code}: ${r.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`);
      return parseOutput(r.stdout, man.ref);
    } catch (e: any) { return E(`tool error: ${String(e?.message ?? e).slice(0, 400)}`); }
  }
  /** A judged check: a model (or an agent node's own verdict) through the provider interface. Findings need locators; a quorum decides. */
  async judge(x: X, man: CheckManifest, ref: CheckRef, input: CheckInput): Promise<CheckOutput> {
    const j = man.judge ?? { prompt: "" };
    const q = ref.quorum ?? j.quorum ?? { n: 1, of: 1 };
    const votes: { provider?: string; model?: string; job?: string; by: string; verdict: "pass" | "fail" | "warn"; findings: Finding[]; dropped: number; score: number | null }[] = [];
    const actual = new Set<string>();
    if (j.distinct_providers !== undefined && typeof j.distinct_providers !== "boolean") return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: "distinct_providers must be explicitly boolean" };
    const take = (o: any, by: string, identity?: { provider: string; model?: string; job?: string }) => { const raw = Array.isArray(o?.findings) ? o.findings : []; const fs = raw.map((f: any) => parseFinding(f, "judge", man.ref)).filter((f: Finding | null) => f && f.locator) as Finding[];
      votes.push({ by, ...identity, verdict: o?.verdict === "fail" ? "fail" : o?.verdict === "warn" ? "warn" : "pass", findings: fs, dropped: raw.length - fs.length, score: Number.isFinite(Number(o?.score)) ? Number(o.score) : null }); };
    if (j.from_node) { const v = x.run.nodes[j.from_node]?.data?.judged; if (v) { if (j.distinct_providers && (!v.provider || actual.has(v.provider))) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: "from-node vendor identity is unverified or duplicate", votes }; if (v.provider) actual.add(v.provider); take(v, v.by ?? j.from_node, v.provider ? { provider: v.provider, model: v.model, job: v.job } : undefined); } }
    const vendors = (ref.provider ? [ref.provider] : j.vendors?.length ? j.vendors : [j.provider ?? this.deps.defaultProvider().provider]);
    const evidenceJSON=JSON.stringify({ ...input, out: undefined });
    if(evidenceJSON.length>(x.run.def.kind==='coffee-kit'?192000:64000))return {verdict:'error',score:null,findings:[],evidence:[],proves:[],error:'Complete judge evidence exceeds bounded capacity; refusing truncated review'};
    const prompt = `${ref.prompt ?? j.prompt}\n\nInput (JSON):\n${evidenceJSON}`;
    const role = this.judgeRole(x, man);
    for (let i = votes.length; i < q.of; i++) {
      const approvedJudge = this.deps.approvedPick?.(x.run, x.node, role);
      const provider = approvedJudge?.provider ?? vendors[i % vendors.length]; const model = approvedJudge?.model ?? ref.model ?? j.model ?? null;
      let got: any = null;
      const tools: AgentTool[] = [{ name: "judge_report", description: `Your judgement, once: verdict pass, warn or fail, and findings. Every finding MUST carry a typed locator, e.g. {"type":"file","path":"index.html","line":1}, {"type":"text","section":"receipts.site"}, or {"type":"card","field":"staffing"}. type is mandatory. Invalid findings are rejected; correct the payload and call again.`,
        schema: { type: "object", properties: { verdict: { type: "string", enum: ["pass", "warn", "fail"] }, score: { type: "number" }, findings: { type: "array", items: { type: "object", properties: { locator: { type: "object", properties:{type:{type:"string",enum:["file","web","image","timeline","text","card"]},path:{type:"string"},line:{type:"number"},url:{type:"string"},bbox:{type:"array",items:{type:"number"},minItems:4,maxItems:4},from:{type:"number"},to:{type:"number"},section:{type:"string"},field:{type:"string"}},required:["type"] }, message: { type: "string" }, expected: { type: "string" }, class: { type: "string" }, severity: { type: "string", enum: ["blocking", "minor"] } }, required: ["locator", "message", "class"] } } }, required: ["verdict", "findings"] },
        run: (a) => { if(!['pass','warn','fail'].includes(a?.verdict)||!Array.isArray(a?.findings)||a.findings.some((f:any)=>!parseFinding(f,"judge",man.ref)?.locator))return {error:'Every finding needs a message and typed valid locator. Use {type:"file",path:"index.html",line:1} or {type:"text",section:"receipts.site"}; correct and resubmit.'};got = a; return { ok: true }; } }];
      const selected = this.deps.selectProvider ? await this.deps.selectProvider(x, { provider, model, ...(approvedJudge ? {effort: approvedJudge.effort} : {}) }, { role: role === "designer" ? "designer" : "judge", explicit: true }) : this.deps.provider(provider, model ?? undefined);
      if (j.distinct_providers && actual.has(selected.id)) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: "distinct provider agreement resolved to a duplicate actual vendor", votes };
      // a judge's instructions go through the same composer as any agent's: the safety rules, its role's skill, then its check's duty skills
      const use = x.run?.def ? this.instructionsUse(x.run, role, Array.isArray(ref.skills) ? ref.skills : []) : { text: composeInstructions("", []), roleSkill: null, skills: [] as string[] };
      const system = `${use.text}\n\nYou are a judge for the check "${man.title.en}". Judge only what the input shows. Submit one valid judge_report; if its payload is rejected, correct it before ending. Then answer in one line.`;
      const rules = new OperatingRules(this.deps.dataDir).section(x.run?.params?.project || null);
      const admissionReceipt=this.deps.instructionReceipt?.(x,role,jobInstructions(system, rules),selected);
      const job = await this.deps.agents.run({ kind: `judge:${man.id}`, title: `${x.run?.id ?? "try"} judge ${man.id} #${i + 1}`, system,
        text: `JUDGE ${man.id}\n${prompt}`, tools, admissionReceipt, provider: selected, ref: x.run?.id, project: x.run?.params?.project || null, rules, receiptFor: (r: any) => this.deps.instructionReceipt?.(x,role,jobInstructions(system, r),selected), signal: x.run && x.run.id !== "try" ? this.abortOf(x.run).signal : undefined, owns: x.run && x.run.id !== "try" ? () => this.owns(x) : undefined, maxTools: 4, timeoutMs: man.timeout_s * 1000,
        sandbox: x.run ? this.roundSandbox(x, null, `judge-${man.id}-${i + 1}`) : { writes: [] } } as any);
      if (job.status !== "done" || !got) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: `tool error: judge ${provider} ${job.status === "done" ? "gave no judgement" : job.error}` };
      if (j.distinct_providers && actual.has(job.provider)) return { verdict: "error", score: null, findings: [], evidence: [], proves: [], error: "distinct provider agreement produced duplicate actual vendor", votes };
      actual.add(job.provider); take(got, `${job.provider}·${job.model}`, { provider: job.provider, model: job.model, job: job.id });
      this.noteJudge(x, man, role, use);
    }
    const fails = votes.filter((v) => v.verdict === "fail").length;
    const verdict = fails >= q.n ? "fail" : fails > 0 || votes.some((v) => v.verdict === "warn") ? "warn" : "pass";
    const scores = votes.map((v) => v.score).filter((s): s is number => s != null);
    return { verdict, score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : verdict === "pass" ? 1 : verdict === "fail" ? 0 : 0.5, findings: votes.filter((v) => v.verdict !== "pass").flatMap((v) => v.findings), evidence: [], proves: [],
      dropped: votes.reduce((n, v) => n + v.dropped, 0), votes: votes.map((v) => ({ by: v.by, verdict: v.verdict, ...(v.provider ? { provider: v.provider, model: v.model, job: v.job } : {}) })) };
  }
  /** The role a judged check is judged as: the role its check.yaml names (judge.role), else the role of the node it sits on, else (a node with no role) the designer for a check named for one, else the reviewer. */
  judgeRole(x: X, man: CheckManifest): string {
    const declared = man.judge?.role;
    if (typeof declared === "string" && declared) {
      // a declared role must be one of the workflow's roles: its skill is the judge's instructions
      if (x.run?.def?.roles && !x.run.def.roles.some((r) => r.id === declared)) throw new Error(`check ${man.ref} judges as role "${declared}", which workflow ${x.run.def.id} does not define (roles: ${x.run.def.roles.map((r) => r.id).join(", ") || "none"})`);
      return declared;
    }
    const own = x.node?.role ?? x.node?.args?.role;
    if (own && x.run?.def?.roles?.some((r) => r.id === own)) return own;
    return man.id.includes("designer") ? "designer" : "reviewer";
  }
  /** A judge call on the step it judges: which check, role, role skill and node skills (the run page's Agent rounds panel lists them). */
  private noteJudge(x: X, man: CheckManifest, role: string, use: { roleSkill: RoleSkillUse | null; skills: string[] }) {
    if (!x.run?.steps) return;
    const step = [...x.run.steps].reverse().find((s) => s.node === x.node.id && s.visit === x.visit && s.state !== "superseded"); if (!step) return;
    step.judges = [...(step.judges ?? []), { check: man.ref, role, roleSkill: use.roleSkill, skills: use.skills, at: now() }].slice(-20);
    try { this.commit(x.run, "judge"); } catch {}
  }
  /** Workflow hooks at a lifecycle point (after:<node>, after_round, after_merge, on_cancel): reported, never moving the run. */
  async hooksAt(r: Run, node: WNode | null, at: string) {
    // a node declares the lifecycle points it marks (lifecycle: [after_round], [after_merge] …); the runtime knows no domain
    const points = new Set([at, ...(node && at === `after:${node.id}` ? node.lifecycle ?? [] : [])]);
    const hs = (r.def.hooks ?? []).filter((h) => points.has(h.at));
    if (!hs.length) return;
    const n = node ?? r.def.nodes[0];
    const x = this.x(r, n, r.nodes[n.id]);
    for (const h of hs) await this.runCheck(x, { use: h.use, params: h.params, blocking: false }, `hook:${h.at}`);
  }
  /** What the done lines rest on: checks that proved them at the final head, and the lines that need the captain's eye. */
  doneLines(r: Run) {
    // verified first: a line resting on a tampered entry, or any line when the ledger was cut short, needs the captain's eye
    const t = this.trusted(r.id);
    const lines = doneMap(r.ctx.spec?.done ?? [], t.entries.filter((e) => !t.bad.has(e.seq)), r.ctx.head ?? null);
    return t.truncated ? lines.map((l) => ({ ...l, proved: false, note: "the evidence ledger is shorter than the run's events: it was cut short" })) : lines;
  }

  // ---------- the captain's controls ----------
  pause(id: string) { const r = this.must(id); if (TERMINAL.includes(r.status)) throw new Error(`the run is ${r.status}`); if (r.status === "paused") return r;
    r.status = "paused"; this.commit(r, "paused by the captain"); this.emit(r, "paused", "paused: running steps finish, nothing new starts"); return r; }
  resume(id: string) { const r = this.must(id); if (r.status !== "paused") throw new Error(`the run is ${r.status}`); r.status = "running"; this.commit(r, "resumed by the captain"); this.emit(r, "resumed", "resumed"); this.tick(r); this.settle(r); this.watchFirstmate(r); return r; }
  cancel(id: string, by = "captain", reason: string | null = null) {
    const r = this.must(id); if (TERMINAL.includes(r.status)) throw new Error(`the run is ${r.status}`);
    const why = reason ? String(reason).trim().slice(0, 1000) || null : null;
    r.status = "cancelled"; r.endedAt = now(); r.error = `cancelled by ${by}${why ? `: ${why}` : ""}`; r.cancelReason = why;
    this.stopAll(r, "cancelled");
    this.commit(r, `cancelled by ${by}`); this.emit(r, "cancelled", r.error, { by, reason: why }); void this.track(r, "its on_cancel hooks", this.hooksAt(r, null, "on_cancel").finally(() => this.onCancel(r))); return r;
  }
  // ---------- work that holds a run ----------
  // every promise that may still write under a run's folders (a node, routing, hooks, on_cancel, an answer carried on) is tracked
  // by run; archive and delete are refused while any is in flight ("still finishing: …"), and a deleted run takes no more writes
  private work = new Map<string, Map<symbol, string>>();
  private gone = new Set<string>();
  private track(r: Run, what: string, p: Promise<unknown>): Promise<void> {
    const k = Symbol(what); let m = this.work.get(r.id); if (!m) this.work.set(r.id, (m = new Map())); m.set(k, what);
    return p.then(() => {}, (e) => { try { this.emit(r, "log", `${what} failed: ${String(e?.message ?? e).slice(0, 300)}`); } catch {} })
      .finally(() => { m!.delete(k); if (!m!.size && this.work.get(r.id) === m) this.work.delete(r.id); });
  }
  /** What async work still holds the run (null when none): the reason archive and delete wait. */
  busy(id: string): string | null {
    const w = [...(this.work.get(id)?.values() ?? [])];
    for (const k of this.live) if (k.startsWith(`${id}/`)) w.push(`node ${k.slice(id.length + 1)}`);
    for (const c of this.raising.keys()) if (this.cards.get(c)?.run === id) w.push(`raising card ${c}`);
    return w.length ? [...new Set(w)].join(", ") : null;
  }
  onCancel: (r: Run) => void = () => {};
  /** A domain's own clean-up when a run is deleted (each pack removes what it made for the run). */
  onDelete: (r: Run) => void = () => {};
  private ended(r: Run, what: string) { if (!TERMINAL.includes(r.status)) throw new Error(`the run is ${r.status}: only an ended run can be ${what}`);
    const b = this.busy(r.id); if (b) throw new Error(`still finishing: ${b}. The run can be ${what} once that is done`); }
  /** A terminal captain hold can be continued, never treated as an approval or a new job. */
  private continuationHash(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
  private continuationPin(r:Run){return this.continuationHash({status:r.status,result:r.result,definition:r.def,params:r.params,ctx:r.ctx,nodes:r.nodes,continuation:r.continuation??null,evidence:this.deps.continuationEvidence?.(r)??null});}
  private continuationShape(r:Run){
    this.ended(r,"reopened");if([...this.deps.agents.jobs.values()].some(j=>j.ref===r.id&&j.status==="running")||this.deps.agents.queue.snapshot().active.some(j=>j.task===r.id))throw new Error("Owned work is still finishing; continuation is held");const installed=this.defs.get(r.workflow,r.version);if(!installed||this.continuationHash(installed)!==this.continuationHash(r.def))throw new Error("Pinned workflow definition changed; cannot continue");const trust=this.trusted(r.id);if(!trust.ok||r.archived||r.ctx.merged||r.ctx.approved||r.ctx.library||trust.entries.some(e=>e.record==='coffee-approved-v1'||e.record==='native-merge')||!(r.status==='cancelled'||r.status==='succeeded'&&r.result==='closed'))throw new Error('Only an unapproved closed or cancelled captain hold can continue');
    const candidates=this.cards.list({run:r.id}).filter(c=>{const node=r.def.nodes.find(n=>n.id===c.node),rn=r.nodes[c.node];if(!node||node.kind!=="card"||node.do||!c.captainOnly||rn?.card!==c.id||node.args?.mode&&!['coffee-capability','coffee-review','coffee-direction','deliver-accept'].includes(node.args.mode))return false;
      if(r.status==='cancelled')return c.status==='cancelled'&&r.steps.some(s=>s.node===node.id&&s.visit===c.visit&&s.state==='skipped');
      return c.status==='answered'&&['close','reject','rejected'].includes(c.answer?.choice??'')&&r.def.edges.some(e=>e.from===node.id&&(!e.when||e.when.split('|').includes(rn.outcome??'')||e.when.split('|').includes(c.answer!.choice))&&r.def.nodes.some(n=>n.id===e.to&&n.kind==='hook'&&!n.do&&n.args?.result==='closed'));});
    if(candidates.length!==1)throw new Error('No single source-owned captain continuation is available');const card=candidates[0],node=r.def.nodes.find(n=>n.id===card.node)!;return{card,node};
  }
  private continuationTarget(r:Run){const {card,node}=this.continuationShape(r);return{card,node,pin:this.continuationHash({run:this.continuationPin(r),card})};}
  /** Whether a continuation offer can be made now, from the task's shape alone (no artifact hashing): the run page shows its button only then. The offer still verifies every pinned byte. */
  continuable(id:string){const r=this.get(id);if(!r||!TERMINAL.includes(r.status))return false;try{this.continuationShape(r);return true;}catch{return false;}}
  continuationOffer(id:string){const r=this.must(id),{card,node,pin}=this.continuationTarget(r),past=this.trusted(id).entries.filter(e=>e.record==='captain-continuation-offer-v1'&&e.data?.pin===pin).at(-1);if(past)return past.data;
    const offer={schema:1,token:randomBytes(16).toString('hex'),task:id,node:node.id,previousCard:card.id,visit:card.visit,pin,head:r.ctx.head??null,title:card.title};this.record(this.x(r,node,r.nodes[node.id]),'captain-continuation-offer-v1',{data:offer});return offer;
  }
  confirmContinuation(id:string,token:string,confirmation:string){const r=this.must(id);if(confirmation!==id||typeof token!=='string'||! /^[a-f0-9]{32}$/.test(token))throw new Error('Explicit captain task confirmation is required');if(r.continuation?.token===token){const trust=this.trusted(id);if(!trust.ok||!trust.entries.some(e=>e.record==='captain-continuation-confirmed-v1'&&e.data?.token===token))throw new Error('Continuation receipt cannot be authenticated');return r;}
    const {card,node,pin}=this.continuationTarget(r),offer=this.trusted(id).entries.find(e=>e.record==='captain-continuation-offer-v1'&&e.data?.token===token)?.data;if(!offer||offer.task!==id||offer.pin!==pin||offer.previousCard!==card.id||offer.node!==node.id)throw new Error('Continuation offer is stale; read current task state');
    const rn=r.nodes[node.id];this.record(this.x(r,node,rn),'captain-continuation-confirmed-v1',{actor:'captain (desktop)',data:{token,previousCard:card.id,pin}});
    r.continuation={token,previousCard:card.id,node:node.id,visit:rn.visits+1};r.status='running';r.result=null;r.endedAt=null;r.error=null;r.cancelReason=null;r.queue=[node.id];rn.state='pending';rn.waiting=null;rn.card=null;rn.attempt=0;rn.routing=null;if(node.max_visits&&rn.visits>=node.max_visits+(rn.extra??0))rn.extra=(rn.extra??0)+1;
    this.aborts.delete(id);this.commit(r,'captain continued original task');this.emit(r,'continued','Captain reopened the original unapproved task / 船長接續原本尚未核准的任務',{node:node.id,previousCard:card.id});this.tick(r);return r;
  }
  /** Hide an ended run from the default lists, or bring it back. An event in the run and in Studio's log. */
  archive(id: string, on: boolean, by = "captain") {
    const r = this.must(id); this.ended(r, on ? "archived" : "unarchived");
    if (!!r.archived === on) return r;
    r.archived = on; this.append(r, on ? { type: "archived", archived: true, by } : { type: "unarchived", by }); r.updatedAt = now();
    const c = this.committed.get(r.id); if (c) c.archived = on;
    const f = join(this.rdir(r.id), "run.json"); writeFileSync(f + ".tmp", JSON.stringify(r)); renameSync(f + ".tmp", f);
    this.deps.log.emit({ type: on ? "run_archived" : "run_unarchived", workflow: r.workflow, task: r.id, summary: `${r.id} ${on ? "archived" : "unarchived"} by ${by}`, data: { by } });
    this.deps.send("wrun", { id: r.id, project: this.projectOf(r), status: r.status, archived: on, event: { type: "archived", archived: on }, nodes: this.nodeStates(r) });
    return r;
  }
  /**
   * Delete an ended run for good: the captain types its id. Its directory (captures included), its cards and the
   * domain's own traces (onDelete) go. The evidence ledger stays and gains one signed entry recording the deletion,
   * so it still verifies. An event in Studio's log.
   */
  remove(id: string, confirm: string, by = "captain") {
    const r = this.must(id); this.ended(r, "deleted");
    if (String(confirm ?? "").trim() !== r.id) throw new Error(`type the run id (${r.id}) to delete it`);
    this.onDelete(r); // a domain clean-up that throws leaves the run intact (still listed, still writable) and the error goes back
    this.gone.add(r.id);
    const cards = this.cards.removeRun(r.id);
    rmSync(this.rdir(r.id), { recursive: true, force: true });
    this.runs.delete(r.id); this.committed.delete(r.id); this.aborts.delete(r.id);
    new Ledger(this.deps.dataDir, r.id).add({ run: r.id, node: "", edge: null, round: 0, head: null, check: "run/delete", version: "1", kind: "deterministic", attempt: 0, record: "deletion", actor: by,
      verdict: "pass", score: null, findings: [], evidence: [], proves: [], blocking: false, inputHash: "", params: {}, ms: 0, dir: null, data: { workflow: r.workflow, title: r.title, status: r.status, result: r.result, cards } } as any);
    this.deps.log.emit({ type: "run_deleted", workflow: r.workflow, task: r.id, summary: `${r.id} deleted by ${by}`, data: { by, cards } });
    this.deps.send("wrun", { id: r.id, deleted: true });
    return { id: r.id, deleted: true, cards };
  }
  /** Hot swap: a live agent node stops, writes data/handoff/<run>/<node>.md, and its new agent starts from it. An idle node just takes the new agent. */
  setAgent(id: string, nodeId: string, p: AgentPick) {
    const r = this.must(id); const node = r.def.nodes.find((n) => n.id === nodeId); if (!node) throw new Error("no such node");
    if (node.kind !== "agent" && node.kind !== "loop" && !(node.kind === "card" && node.args?.mode)) throw new Error(`${node.label} has no agent`);
    if (!p.provider) throw new Error("name a provider");
    this.deps.authorizePickChange?.(r, node, p);
    const rn = r.nodes[nodeId];
    if (rn.state === "running" && rn.job && node.kind === "agent") { rn.swap = p; this.commit(r, "swap requested"); this.emit(r, "swap_requested", `${node.label}: switching to ${p.provider}${p.model ? ` · ${p.model}` : ""}`, { node: nodeId, ...p }); this.deps.agents.cancel(rn.job); }
    else { rn.agent = p; this.commit(r, "agent set"); this.emit(r, "agent_set", `${node.label}: next visit runs on ${p.provider}${p.model ? ` · ${p.model}` : ""}`, { node: nodeId, ...p }); }
    return r;
  }
  /** The captain answered a Studio card (exactly once). The answer is signed into the ledger. */
  /** Cards whose node is still raising them (its STE checks): an answer waits for this, never polls. */
  private raising = new Map<string, { done: Promise<void>; resolve: () => void }>();
  /** How long an answer waits for a card that is still being raised. */
  cardReadyMs = 30_000;
  async answer(cardId: string, a: { choice: string; note?: string | null; by: string; confirm?: string | null; ack?: string | null; aligned?: number[] | null; localRescope?: LocalRescope | null; crew?: Record<string, string | null> | null }) {
    const c0 = this.cards.get(cardId); if (!c0) throw new Error("no such card");
    if (c0.kind === "failure") return this.answerFailure(c0, a);
    const r = this.must(c0.run);
    if(this.repreparing.has(`${r.id}/${c0.node}`))throw new Error("Captain card preparation is still running; no answer was submitted");
    // a card is visible as soon as it is raised; its node finishes raising it (the STE check) a moment later: wait for that, not longer than cardReadyMs
    if (TERMINAL.includes(r.status)) throw new Error(`the run is ${r.status}`);
    const raising = this.raising.get(cardId);
    if (raising) { let t: any; const ok = await Promise.race([raising.done.then(() => true), new Promise<boolean>((res) => { t = setTimeout(() => res(false), this.cardReadyMs); })]); clearTimeout(t);
      if (!ok) throw new Error("this card is still being raised (its checks are running): answer it again in a moment"); }
    if (TERMINAL.includes(r.status)) throw new Error(`the run is ${r.status}`);
    if(this.repreparing.has(`${r.id}/${c0.node}`))throw new Error("Captain card preparation is still running; no answer was submitted");
    const rn = r.nodes[c0.node]; if (rn?.state !== "running" || rn.waiting !== "card" || rn.card !== c0.id) throw new Error("this card is not the one its node waits on");
    this.deps.authorizeAnswer?.(r,c0,a);
    // a rescope with the very note of the last rescope on this run changes nothing: refused, with why (runtime/failures.ts)
    if (a.choice === ACT.rescope && c0.status === "open" && c0.options.some((o) => o.id === ACT.rescope)) {
      const last = Object.values(r.ctx.answers ?? {}).filter((x: any) => x?.choice === ACT.rescope && x.note).sort((x: any, y: any) => String(x.at).localeCompare(String(y.at))).at(-1) as any;
      const no = rescopeRefusal({ note: a.note, previous: last?.note ?? null }); if (no) throw new FailureRefusal(no);
    }
    const c = this.cards.answer(cardId, a);
    const node = r.def.nodes.find((n) => n.id === c.node)!;
    const x = this.x(r, node, rn);
    this.emit(r, "card_answered", `${c.id} ${c.title.en}: ${c.answer!.choice}${c.answer!.note ? ` — ${c.answer!.note.slice(0, 160)}` : ""}`, { node: node.id, card: c.id, choice: c.answer!.choice, by: a.by });
    await this.carryAnswer(r, node.id);
    return c;
  }
  /** Record the captain's note on a card as a captain amendment (refine.ts Amendment), bound to the signed ledger entry of that answer. */
  private addAmendment(r: Run, c: SCard, nodeId: string, rec: { seq: number; sig: string } | null) {
    const note = String(c.answer?.note ?? "").trim(); if (!note || !rec) return;
    const prev = Array.isArray(r.ctx.amendments) ? r.ctx.amendments : [];
    r.ctx.amendments = [...prev, { n: prev.length + 1, card: c.id, node: nodeId, note: note.slice(0, 4000), by: c.answer!.by, at: c.answer!.at, seq: rec.seq, sig: rec.sig }];
    this.emit(r, "captain_amendment", `A${prev.length + 1} from ${c.id}: ${note.slice(0, 200)}`, { node: nodeId, card: c.id });
  }
  private amendmentDrops = new Set<string>();
  /** The run's captain amendments that still match their signed ledger entries; a tampered one is dropped and logged once. */
  amendments(r: Run): Amendment[] {
    if (!Array.isArray(r?.ctx?.amendments) || !r.ctx.amendments.length) return [];
    return verifiedAmendments(r.ctx, this.trusted(r.id), (why) => { const k = `${r.id}:${why}`; if (this.amendmentDrops.has(k)) return; this.amendmentDrops.add(k); this.emit(r, "log", why); });
  }
  /** Move a node on from its answered card (also after a restart that came between the answer and the move). */
  async carryAnswer(r: Run, nodeId: string) {
    const node = r.def.nodes.find((n) => n.id === nodeId)!; const rn = r.nodes[nodeId]; const c = this.cards.get(rn.card ?? "")!;
    r.ctx.answers = { ...(r.ctx.answers ?? {}), [node.id]: c.answer };
    // the answer goes into the ledger once, here, so an answer carried on after a crash is recorded too
    if (!r.ctx.answersRecorded?.includes(c.id)) { r.ctx.answersRecorded = [...(r.ctx.answersRecorded ?? []), c.id]; const rec = this.record(this.x(r, node, rn), "card-answer", { actor: c.answer!.by, data: { card: c.id, kind: c.kind, choice: c.answer!.choice, note: c.answer!.note, confirm: c.answer!.confirm, ...(c.answer!.ack ? { ack: c.answer!.ack } : {}), ...(c.answer!.localRescope?{localRescope:c.answer!.localRescope}:{}), ...(c.answer!.crew?{crew:c.answer!.crew}:{}), ...(this.queueDomain?.answer(r, node, rn, c) ?? {}) } });
      // a captain's "request changes" (or rescope) note binds every later round: kept cumulatively (never latest-only), bound to its signed card-answer entry
      if (AMEND_CHOICES.includes(c.answer!.choice) && c.answer!.by !== "firstmate") this.addAmendment(r, c, node.id, rec); }
    // the card's effects, once per card (an answer carried on after a restart does not apply them twice)
    const eff = node.card?.effects?.[c.answer!.choice] as any;
    if (eff && !r.ctx.effectsApplied?.includes(c.id)) {
      r.ctx.effectsApplied = [...(r.ctx.effectsApplied ?? []), c.id];
      if (eff.policy) { r.ctx.policyAdds = { ...(r.ctx.policyAdds ?? {}), [eff.policy]: Number(r.ctx.policyAdds?.[eff.policy] ?? 0) + Number(eff.add ?? 0) }; this.emit(r, "policy_override", `run override by card ${c.id}: ${eff.policy} +${eff.add} (now +${r.ctx.policyAdds[eff.policy]})`, { node: node.id }); }
      else if (r.nodes[eff.node]) { r.nodes[eff.node].extra += eff.add; this.emit(r, "budget", `${eff.node}: ${eff.add} more visits`, { node: eff.node }); }
    }
    const step = [...r.steps].reverse().find((s) => s.node === node.id && s.state === "waiting");
    const hold = (node.kind === "agent" || node.kind === "loop") ? rn.data.nativeQueueCapability : null;
    if (hold && (c.answer!.choice === hold.retryAction || (Array.isArray(hold.extraActions) && hold.extraActions.includes(c.answer!.choice)))) {
      if (!this.owns(this.x(r, node, rn))) throw new Error("readiness recovery owner ended");
      // a domain action (e.g. approve a changed role skill) applies first, once per card, then the round is prepared again like a retry
      if (c.answer!.choice !== hold.retryAction && !r.ctx.recoveryApplied?.includes(c.id)) {
        if (!this.deps.readinessAction?.(r, node, rn, c)) throw new Error(`no handler for readiness action ${c.answer!.choice}`);
        r.ctx.recoveryApplied = [...(r.ctx.recoveryApplied ?? []), c.id];
      }
      r.ctx.nativeQueueVersion = 1; delete rn.data.nativeQueue; delete rn.data.nativeQueueCapability;
      if (step) { step.state = "passed"; step.outcome = "retry"; step.endedAt = now(); }
      rn.waiting = null; rn.card = null; rn.state = "pending"; rn.cause = `fresh preparation approved by ${c.id}`;
      if (!r.queue.includes(nodeId)) r.queue.push(nodeId); this.commit(r, rn.cause);
      // Answer settles after scheduling; the new provider round owns its own
      // continuation. Cancellation before this microtask prevents a late start.
      queueMicrotask(() => { if (!TERMINAL.includes(r.status) && !this.gone.has(r.id) && this.runs.get(r.id) === r) this.tick(r); });
      return;
    }
    rn.waiting = null; this.commit(r, `card ${c.id} answered: ${c.answer!.choice}`);
    const x = this.x(r, node, rn);
    const h = node.kind === "card" && node.args?.mode && this.cardModes[node.args.mode] ? this.cardModes[node.args.mode] : this.kinds[node.kind];
    let res: Result | null = null, err: string | null = null;
    const key = `${r.id}/${node.id}`; this.live.add(key);
    try { res = node.kind === "loop" && rn.data.nativeQueueCapability ? await this.kinds.agent.answer!(x, c) : h.answer ? await h.answer(x, c) : { outcome: c.answer!.choice, note: c.answer!.note }; } catch (e: any) { err = String(e?.message ?? e); } finally { this.live.delete(key); }
    this.finish(r, node, rn, step ?? { seq: r.steps.length + 1, node: node.id, kind: node.kind, visit: rn.visits, state: "waiting", outcome: null, startedAt: now(), endedAt: null, error: null, job: null, provider: null, model: null, note: null }, res, err);
  }
  private must(id: string) { const r = this.runs.get(id); if (!r) throw new Error("no such run"); return r; }

  /**
   * Raise a card for a waiting node: intent sections in en and zh-TW, STE-checked
   * (recorded in the ledger). Inside an open authorization window (a signed grant the
   * captain opened in Studio) the runtime answers the listed kinds, never a one-way door.
   */
  /** Domain watchers of an open card (the merge card's watch for a pull request merged or closed on GitHub): called when the
   *  card is raised and again after a restart for every card a node still waits on. */
  cardWatchers: ((x: X, c: SCard) => void)[] = [];
  /** Domain refreshers after the captain changed a project's signed GitHub grant (merge granted or revoked): each prepares its
   *  open cards on that project again under the new grant, and returns one line per card for the run's note. */
  grantChanged: ((project: string) => Promise<string[]>)[] = [];
  private watchCard(x: X, c: SCard) { for (const w of this.cardWatchers) { try { w(x, c); } catch (e: any) { this.emit(x.run, "log", `${c.id}: card watch not started (${String(e?.message ?? e).slice(0, 200)})`); } } }
  /**
   * A fact observed outside Studio settles the node's open card (the pull request was merged or closed on GitHub): the card is
   * cancelled, never answered, and the node goes on with the observed outcome. The caller records the fact in the ledger first.
   * False when the card is no longer the open one its node waits on (an answer came first).
   */
  observeCard(x: X, cardId: string, result: { outcome: string; note?: string }): boolean {
    const { run: r, node, rn } = x, c = this.cards.get(cardId);
    if (!this.owns(x) || rn.waiting !== "card" || rn.card !== cardId || c?.status !== "open" || this.repreparing.has(`${r.id}/${node.id}`)) return false;
    const step = [...r.steps].reverse().find((s) => s.node === node.id && s.state === "waiting");
    this.cards.cancel(cardId); this.raising.get(cardId)?.resolve(); rn.waiting = null;
    this.commit(r, `card ${cardId} settled by an observed fact: ${result.outcome}`);
    this.emit(r, "card_observed", `${cardId}: ${result.note ?? result.outcome}`, { node: node.id, card: cardId, outcome: result.outcome });
    this.finish(r, node, rn, step ?? { seq: r.steps.length + 1, node: node.id, kind: node.kind, visit: rn.visits, state: "waiting", outcome: null, startedAt: now(), endedAt: null, error: null, job: null, provider: null, model: null, note: null }, result, null);
    return true;
  }
  private repreparing = new Map<string,{previous:string;prepared:string|null}>();
  /** Stage a fresh captain card; the durable waiting pointer remains on the old hold until preparation succeeds. */
  async reprepareCard(x:X,prepare:()=>Promise<unknown>):Promise<SCard>{
    const key=`${x.run.id}/${x.node.id}`,previous=x.rn.card,old=previous&&this.cards.get(previous);
    if(!this.owns(x)||x.run.status!=='waiting'||x.rn.waiting!=='card'||!old||old.status!=='open'||!old.captainOnly||old.run!==x.run.id||old.node!==x.node.id||old.visit!==x.visit||this.busy(x.run.id)||this.repreparing.has(key))throw new Error('Card is not quiescent');
    const stage={previous:previous!,prepared:null as string|null};this.repreparing.set(key,stage);
    const work=(async()=>{try{
      await prepare();const fresh=stage.prepared&&this.cards.get(stage.prepared);
      if(!this.owns(x)||x.run.status!=='waiting'||x.rn.waiting!=='card'||x.rn.card!==previous||this.cards.get(previous!)?.status!=='open'||!fresh||fresh.status!=='open'||!fresh.captainOnly)throw new Error('Fresh card was not prepared for its current owner');
      x.rn.card=fresh.id;this.commit(x.run,`card ${previous} replaced by ${fresh.id}`);this.cards.cancel(previous!);return fresh;
    }catch(error){if(stage.prepared)this.cards.cancel(stage.prepared);throw error;
    }finally{this.repreparing.delete(key);if(stage.prepared)this.raising.get(stage.prepared)?.resolve();}})();
    void this.track(x.run,'captain card preparation',work);return work;
  }
  // ---------- failures (src/runtime/failures.ts): one class, one card, one next action ----------
  /** What a failed attempt ran on. A deterministic failure is retried only when one of these changes. */
  failureInputs(r: Run, node: WNode | null): InputSnapshot {
    const rn = node ? r.nodes[node.id] : null; const short = (v: unknown) => { const j = typeof v === "string" ? v : JSON.stringify(v ?? null); return j.length > 160 ? `sha256:${inputsHash({ v: j }).slice(0, 16)}` : j; };
    let pick = "default"; try { if (node && (node.kind === "agent" || node.kind === "loop")) { const p = this.x(r, node, rn!).pick(); pick = `${p.provider}·${p.model ?? "default"}${p.effort ? `·${p.effort}` : ""}`; } } catch {}
    let policy = ""; try { policy = inputsHash({ org: JSON.stringify(this.policies.org()), project: JSON.stringify(this.policies.project(r.ctx.project ?? r.params.project ?? null)), adds: JSON.stringify(r.ctx.policyAdds ?? {}) }).slice(0, 16); } catch {}
    return { workflow: `${r.workflow}@v${r.version}`, params: short(r.params), agent: pick, head: String(r.ctx.head ?? ""), base: String(r.ctx.baseCommit ?? r.ctx.base ?? ""), spec: String(r.ctx.spec?.version ?? ""),
      policy, budget: String(rn?.extra ?? 0), ...this.failureInputExtra(r, node) };
  }
  /** A domain adds what else its node reads (a coffee film adds its input digest). */
  failureInputExtra: (r: Run, node: WNode | null) => InputSnapshot = () => ({});
  /** An agent's question goes to Firstmate first (server.ts wakes it): true when it was sent. Firstmate answers or escalates through answerFromFirstmate. */
  askFirstmate: ((r: Run, node: WNode, question: string, visit: number, o?: { escalation?: { options: { id: string; label: string; note?: boolean; select?: string[] }[] } }) => boolean) | null = null;
  private changedCache = new Map<string, { key: string; at: number; value: ReturnType<typeof changedInputs> }>();
  /** environment probes by code: a string says what is still broken (Fix and retry is refused), null says fixed or unknown */
  failureProbes: Partial<Record<FailureCode, (r: Run) => string | null>> = {};
  /** Per workflow: a failed proposal's "Re-propose" answer (deterministic.re-propose). It raises a fresh proposal for the current state and returns its run. */
  reproposers: Record<string, (r: Run, by: string) => Run> = {};
  /** transient retries wait this long (failures.ts backoffMs); a test may shorten it */
  failureBackoff: (attempt: number) => number = (a) => [5_000, 30_000, 120_000, 600_000][Math.min(3, Math.max(0, a - 1))];
  /** A failure from blocking check entries, with the check's evidence as the log reference. */
  checkFailure(x: X, blocked: LedgerEntry[], code: "deterministic.check" | "deterministic.gate", edge: string | null = null): Failure {
    const toolErr = blocked.every((e) => e.verdict === "error");
    const message = blocked.map((e) => `${e.check}: ${e.verdict}${(e as any).error ? ` (${(e as any).error})` : ""}${e.findings?.length ? ` — ${e.findings.slice(0, 3).map((f) => f.message).join("; ")}` : ""}`).join("\n");
    // a check that could not run (verdict error) is not a verdict on the inputs: its words decide (sandbox, timeout, tool), else a Studio bug
    const c: FailureCode = toolErr ? (codeOf(message) === "internal.unmapped" ? "internal.bug" : codeOf(message)) : code;
    const first = blocked[0] as any;
    return failure(c, message, { source: edge ? "gate" : "check", run: x.run.id, node: x.node.id, visit: x.visit, inputs: this.failureInputs(x.run, x.node),
      log: first?.dir ? { k: "evidence", run: x.run.id, dir: String(first.dir), file: "output.txt" } : null, diagnostics: c.startsWith("internal") ? { checks: blocked.map((e) => `${e.check}#${e.seq}`).join(", "), edge: edge ?? "" } : null });
  }
  /** The failure that ended a run at this node: what the source said, else the outcome's own class, else its words. */
  refreshFailure(id: string) {
    const r = this.must(id);
    this.ended(r, "diagnosed");
    if (r.status !== "failed" || r.archived || r.parked || r.ctx.firstmateQuestion || !this.trusted(id).ok) throw new Error("Only a trusted, unarchived failed task without a pending Firstmate question can be diagnosed");
    const old = r.failureCard ? this.cards.get(r.failureCard) : null;
    const intent = old && this.trusted(id).entries.find(e => e.record === "failure-reclassified" && e.data?.card === old.id);
    const terminal = this.events(id).filter(e => e.type === "failed").at(-1);
    const node = r.def.nodes.find(n => n.id === terminal?.node), last = r.steps.at(-1);
    const rn = node && r.nodes[node.id];
    const unambiguous = !!node && !!rn && !!last && last.node === node.id && last.visit === rn.visits && !!rn.outcome && !["running", "pending", "waiting", "skipped"].includes(rn.state);
    // a card an older release raised as a Studio bug is classified again with the current rules; it is replaced when its class or its actions changed
    const reach = this.newTaskReach(r);
    let fresh: Failure | null = null;
    if (old && (old.status === "open" || (old.status === "cancelled" && !!intent)) && old.failure?.class === "internal" && unambiguous && old.node === node!.id && old.visit === rn!.visits) {
      const cur = this.failureOf(r, node!, rn!.outcome!, { fresh: true });
      const g = { ...cur, diagnostics: cur.diagnostics ?? old.failure.diagnostics ?? null };
      const actions = failureCardBody(g, { label: node!.label, ...reach }).options.map(o => o.id).join();
      if (intent || g.code !== old.failure.code || actions !== old.options.map(o => o.id).join()) fresh = g.code === "ask.escalated" ? { ...g, escalation: { by: "firstmate", reason: "A historical failure was recovered for captain review; no agent was started." } } : g;
    }
    const reclassify = !!fresh;
    if (r.failureCard && !reclassify) return old;
    if (!reclassify && this.cards.list({run:id,open:true}).some(c => c.id !== old?.id)) throw new Error("Resolve the existing card first");
    if (!unambiguous) throw new Error("The failed source node is ambiguous; no recovery card was created");
    const f = fresh ?? this.failureOf(r, node!, rn!.outcome!);
    if (reclassify) {
      const b = failureCardBody(f, {label:node!.label, ...reach});
      const replacement = intent?.data?.replacement ?? {
        run:id,node:node!.id,visit:rn!.visits,kind:"failure",title:{en:b.title,"zh-TW":b.zhTitle},
        sections:{en:{...old!.sections.en,why:b.en.why,how:b.en.how},"zh-TW":{...old!.sections["zh-TW"],why:b.zh.why,how:b.zh.how}},
        body:b.body,options:b.options,confirmDoor:false,door:null,links:old!.links,detail:null,captainOnly:true,workflow:r.workflow,runTitle:r.title,ste:null,failure:f,
      };
      if (replacement.run!==id || replacement.node!==node!.id || replacement.visit!==rn!.visits || replacement.failure?.code!==f.code || replacement.failure?.message!==f.message) throw new Error("Recovery intent differs from the failed node");
      const matching = (c:SCard) => {
        const {id:_id,status:_status,createdAt:_at,answer:_answer,ledger,...body}=c;
        return !!intent && ledger?.reclassifiedFrom===old!.id && ledger?.request===intent.seq && hashInput(body)===hashInput(replacement);
      };
      const open=this.cards.list({run:id,open:true}).filter(c=>c.id!==old!.id);
      if(open.length>1 || open.some(c=>!matching(c)))throw new Error("Resolve the existing card first");
      // Persist the exact replacement before either card mutation; retries can finish both crash windows.
      const request=intent ?? this.record(this.x(r,node!,rn!),"failure-reclassified",{data:{card:old!.id,from:old!.failure!.code,to:f.code,replacement}});
      if(!request)throw new Error("Recovery intent was not recorded");
      const card=open[0] ?? this.cards.create({...replacement,ledger:{reclassifiedFrom:old!.id,request:request.seq}});
      this.cards.cancel(old!.id);
      r.failure=card.failure!;rn!.data.failure=card.failure;r.failureCard=card.id;
      r.failures=[...(r.failures??[]),card.failure!].slice(-20);
      this.commit(r,"failure diagnostics reclassified");
      this.emit(r,"failure",`${f.class} · ${f.code}`,{node:node!.id,card:card.id,class:f.class,code:f.code});
      return card;
    }
    // Diagnosis only creates a captain card; it must never wake Firstmate.
    return this.raiseFailure(r, node!, f.code === "ask.escalated" ? { ...f, escalation: { by: "firstmate", reason: "A historical failure was recovered for captain review; no agent was started." } } : f);
  }
  /** Whether a failure card can start a new task, and whether the current release has a newer version of the run's workflow (the run keeps its pinned routes). */
  newTaskReach(r: Run): { newTaskAllowed: boolean; newerVersion: boolean } {
    const latest = this.defs.get(r.workflow), current = !!latest && latest.version > r.version && this.defs.selectable(r.workflow, latest.version);
    return { newTaskAllowed: current || this.defs.selectable(r.workflow, r.version), newerVersion: current };
  }
  /** fresh: classify again with the current rules, ignoring the failure the node recorded (a refresh of an old card). */
  failureOf(r: Run, node: WNode, outcome: string, o2: { fresh?: boolean } = {}): Failure {
    const rn = r.nodes[node.id]; const o = { source: "engine" as const, run: r.id, node: node.id, visit: rn.visits, inputs: this.failureInputs(r, node), log: rn.job ? { k: "job" as const, job: rn.job, run: r.id, node: node.id, round: String(rn.visits) } : null };
    const known = o2.fresh ? null : rn.data.failure as Failure | null;
    if (known && known.node === node.id) return { ...known, inputs: known.inputs ?? { hash: inputsHash(o.inputs), snapshot: o.inputs } };
    // a round stopped before its agent (begin's RoundBlocked) keeps its reason on the report, not the step note
    const note = String(rn.note || rn.error || (outcome === "blocked" ? rn.data.report?.summary : "") || "");
    if (outcome === "cap") return failure("deterministic.round-cap", `${node.label}: the round cap was reached${note ? ` (${note})` : ""}`, o);
    if (outcome === "timeout") return failure("transient.timeout", note || `${node.label} stopped at its time limit`, o);
    // an agent question reaches the captain only when Firstmate escalated it (rn.data.escalation: Firstmate's reason); a domain without that path escalates as is
    if (outcome === "ask") return failure("ask.escalated", note || rn.data.report?.summary || `${node.label} asks a question`, { escalation: rn.data.escalation?.reason ?? null, ...o, source: "agent" });
    if (outcome === "error") return fromError(rn.error ?? "", o);
    const byWords = note ? codeOf(note) : "internal.unmapped";
    if (byWords !== "internal.unmapped") return failure(byWords, note, o);
    if (outcome === "fail") return failure("deterministic.agent-result", note || `${node.label} ended with "fail"`, o);
    return failure("internal.unmapped", `${node.label} ended with "${outcome}" and no edge takes it${note ? `: ${note}` : ""}`, { ...o, diagnostics: { outcome, note, cause: String(rn.cause ?? ""), state: rn.state } });
  }
  /** The run failed: keep the typed failure on it and raise its card (captain only: no grant answers it). */
  raiseFailure(r: Run, node: WNode | null, f: Failure) {
    if (this.gone.has(r.id)) return null;
    // an agent's question: Firstmate answers it; only an escalation (with Firstmate's reason) reaches the captain
    if (f.code === "ask.escalated" && node && !f.escalation?.reason) {
      if (this.toFirstmate(r, node, f)) return null;
      f = { ...f, escalation: { by: "firstmate", reason: "Firstmate is not running, so it could not answer this question." } };
    }
    if (f.class === "transient" && node) { const attempt = (r.nodes[node.id].data.failureRetries ?? 0) + 1; f = { ...f, retry: { attempt, backoffMs: this.failureBackoff(attempt) } }; }
    r.failure = f; r.failures = [...(r.failures ?? []), f].slice(-20);
    const ended = r.status === "succeeded"; // a run that ended on a failed outcome: its card offers a new task, it is never revived
    const b = failureCardBody(f, { label: node?.label, ended, ...this.newTaskReach(r) });
    const sec = (p: { why: string; how: string }) => ({ ...emptySections(), intent: r.text.split("\n")[0].slice(0, 300) || r.title, ...p });
    let c: SCard | null = null;
    try { c = this.cards.create({ run: r.id, node: node?.id ?? "", visit: node ? r.nodes[node.id].visits : 0, kind: "failure", title: { en: b.title, "zh-TW": b.zhTitle }, sections: { en: sec(b.en), "zh-TW": sec(b.zh) }, body: b.body,
      options: b.options, confirmDoor: false, door: null, links: f.log.href ? [{ label: "Open the log", href: f.log.href }] : [], detail: null, captainOnly: true, workflow: r.workflow, runTitle: r.title, ledger: null, ste: null, failure: f }); }
    catch (e: any) { this.emit(r, "log", `failure card could not be raised: ${String(e?.message ?? e).slice(0, 200)}`); }
    r.failureCard = c?.id ?? null; this.commit(r, `failure ${f.class}: ${f.code}`);
    this.emit(r, "failure", `${f.class} · ${f.code}: ${f.message.slice(0, 200)}`, { node: node?.id ?? null, card: c?.id ?? null, class: f.class, code: f.code });
    return c;
  }
  /** Send an agent's question to Firstmate: true when it was sent (the question then waits on the run, no card). */
  private toFirstmate(r: Run, node: WNode, f: Failure): boolean {
    let sent = false; try { sent = !!this.askFirstmate?.(r, node, f.message, r.nodes[node.id].visits); } catch { sent = false; }
    if (!sent) return false;
    r.failure = f; r.failures = [...(r.failures ?? []), f].slice(-20); r.failureCard = null; r.ctx.firstmateQuestion = { node: node.id, visit: r.nodes[node.id].visits, question: f.message, at: now() };
    this.commit(r, "question to Firstmate"); this.emit(r, "question_to_firstmate", `${node.label}: ${f.message.slice(0, 200)}`, { node: node.id });
    this.firstmateSent.add(`${r.id}@${r.ctx.firstmateQuestion.at}`); this.watchFirstmate(r);
    return true;
  }
  /** The models an escalation card's "another model" picker offers (server.ts sets them from Studio's provider settings). */
  modelChoices: () => { value: string; label: string }[] = () => [];
  /** How long a question waits for Firstmate before it goes to the captain as the failure card. */
  firstmateAnswerMs = 15 * 60_000;
  /** After a restart: send each pending question to Firstmate again (its wake notice died with the old process), or to the captain when Firstmate cannot take it. */
  /** Questions this process has sent to Firstmate (run@question time): each is sent once; resume skips them. */
  private firstmateSent = new Set<string>();
  /** Also called when Firstmate attaches (server.ts): a question it could not take at the restart is sent then. */
  resumeFirstmateQuestions() {
    for (const r of this.runs.values()) {
      const q = r.ctx.firstmateQuestion; if (!q || r.failureCard || r.archived || r.parked || this.gone.has(r.id) || !["waiting", "failed", "paused"].includes(r.status)) continue;
      const node = r.def.nodes.find((n) => n.id === q.node); if (!node) continue;
      this.watchFirstmate(r); // the bounded wait holds whether or not Firstmate can take the question now
      const key = `${r.id}@${q.at}`; if (this.firstmateSent.has(key)) continue;
      const held = q.card ? r.nodes[node.id].data.firstmateCard : null; const options = held ? this.firstmateOptions(r, node, held.body.options ?? node.card?.options ?? [], held.allowed ?? null) : null;
      let sent = false; try { sent = !!this.askFirstmate?.(r, node, q.question, q.visit ?? r.nodes[node.id].visits, options ? { escalation: { options: options.map((o) => ({ id: o.id, label: o.label, ...(o.note ? { note: true } : {}), ...(o.select?.length ? { select: o.select.map((s) => s.value) } : {}) })) } } : undefined); } catch { sent = false; }
      if (!sent) continue; // Firstmate is not attached yet: sent when it attaches, or the deadline takes it to the captain
      this.firstmateSent.add(key); this.emit(r, "question_to_firstmate", `${node.label}: sent again after a restart`, { node: node.id });
    }
  }
  /** The bounded wait: a question Firstmate has not answered by its deadline goes to the captain (the same path as Firstmate's escalation). */
  private firstmateWatched = new Set<string>();
  private watchFirstmate(r: Run) {
    const q = r.ctx.firstmateQuestion; if (!q) return;
    const key = `${r.id}@${q.at}`; if (this.firstmateWatched.has(key)) return; this.firstmateWatched.add(key);
    const left = Math.max(0, Date.parse(q.at) + this.firstmateAnswerMs - Date.now());
    const t: any = setTimeout(() => {
      this.firstmateWatched.delete(key); // a paused run is armed again on resume
      const cur = this.runs.get(r.id); if (cur !== r || this.gone.has(r.id) || r.failureCard || r.ctx.firstmateQuestion?.at !== q.at || !["waiting", "failed"].includes(r.status)) return;
      if (this.busy(r.id)) { setTimeout(() => this.watchFirstmate(r), 1000)?.unref?.(); return; }
      const node = r.def.nodes.find((n) => n.id === q.node); if (!node) return;
      const late = `Firstmate did not answer within ${Math.round(this.firstmateAnswerMs / 60_000) || 1} min, so the question comes to you.`;
      if (q.card) { void this.track(r, "escalation card", this.escalateCard(r, node, { by: "studio", why: late, zhWhy: `Firstmate 沒有在 ${Math.round(this.firstmateAnswerMs / 60_000) || 1} 分鐘內回覆，所以交給你決定。` })); return; }
      this.escalateQuestion(r, node, late);
    }, left); t?.unref?.();
  }
  /** The question goes to the captain: the run stops waiting and raises the failure card with the reason. */
  private escalateQuestion(r: Run, node: WNode, reason: string) {
    const q = r.ctx.firstmateQuestion; delete r.ctx.firstmateQuestion;
    if (r.status === "waiting") { r.status = "failed"; r.endedAt = now(); r.error = `${node.label}: the agent's question went to the captain`; this.commit(r, "question escalated"); this.emit(r, "failed", r.error, { node: node.id }); }
    return this.raiseFailure(r, node, failure("ask.escalated", q?.question ?? r.failure?.message ?? `${node.label} asks a question`, { source: "agent", run: r.id, node: node.id, visit: r.nodes[node.id].visits, escalation: reason.slice(0, 2000) }));
  }
  /** The brief an agent gets on the visit after a failure card: the captain's answer, or the rescope note. */
  failureBrief(x: X): string {
    const fa = x.rn.data.failureAnswer as { kind: string; question: string; note: string; by?: string } | undefined; if (!fa) return "";
    const who = fa.by === "firstmate" ? ["FIRSTMATE'S ANSWER", "Firstmate"] : ["CAPTAIN'S ANSWER", "The captain"];
    return fa.kind === "answer" ? `\n\n${who[0]}\nYou asked: ${fa.question}\n${who[1]} answered: ${fa.note}\nContinue the same step with this answer.`
      : fa.kind === "rescope" ? `\n\nCAPTAIN'S RESCOPE\nThe last attempt failed: ${fa.question}\nThe captain changed the scope: ${fa.note}` : `\n\nCAPTAIN'S NOTE\n${fa.note}`;
  }
  /** The captain answered a failure card. Refusals (no change, not fixed, vague note) leave the card open and say why. */
  async answerFailure(c: SCard, a: { choice: string; note?: string | null; by: string; confirm?: string | null }) {
    const r = this.must(c.run); const f = c.failure;
    if (!f || c.status !== "open" || r.failureCard !== c.id || !TERMINAL.includes(r.status) || r.parked) throw new Error(c.status !== "open" ? `this card is ${c.status}: a card is answered exactly once` : "this failure card is no longer the run's current failure");
    if (!c.options.some((o) => o.id === a.choice)) throw new Error(`choose one of ${c.options.map((o) => o.id).join(", ")}`);
    if (String(a.by).startsWith("auth window")) throw new Error("a failure card is answered by the captain only");
    // an archived run stays hidden and ended; a run whose evidence does not verify is never revived (like a continuation)
    if (r.archived) throw new Error("this run is archived: unarchive it before you answer its failure card");
    if (!this.trusted(r.id).ok) throw new Error("this run's evidence ledger does not verify: it cannot run again");
    const b = this.busy(r.id); if (b) throw new Error(`still finishing: ${b}. Answer again once that is done`);
    if (r.status === "succeeded" && ![ACT.newTask, ACT.park, ACT.report].includes(a.choice as any)) throw new Error("this run ended: start a new task or park the card");
    const node = r.def.nodes.find((n) => n.id === c.node) ?? null; const note = String(a.note ?? "").trim();
    const refuse = (x: { en: string }) => { throw new FailureRefusal(x as any); };
    let delay = 0, params: Record<string, string> | null = null;
    if (a.choice === ACT.park) { const ans = this.cards.answer(c.id, a); r.parked = { by: a.by, at: now(), note: note || null }; this.recordFailure(r, c, "park"); this.commit(r, "parked"); this.emit(r, "parked", `parked after ${f.class} · ${f.code}`, { card: c.id }); return ans; }
    if (a.choice === ACT.report) {
      const dir = join(this.deps.dataDir, "failures"); mkdirSync(dir, { recursive: true });
      const file = join(dir, `${r.id}-${c.id}.json`);
      // credentials go first (before any cut), then the home folder: the report is kept and may be shared
      const report = redactJSON(JSON.parse(JSON.stringify({ schema: 1, failure: f, run: { id: r.id, workflow: r.workflow, version: r.version, status: r.status, error: r.error, steps: r.steps, nodes: this.nodeStates(r) }, note: note || null, by: a.by, at: now() })));
      report.run.steps = report.run.steps.slice(-20);
      writeFileSync(file, homeless(JSON.stringify(report, null, 1)));
      const ans = this.cards.answer(c.id, a); this.recordFailure(r, c, "report", { file: `failures/${r.id}-${c.id}.json` }); this.emit(r, "failure_reported", `${f.code}: diagnostics kept in failures/${r.id}-${c.id}.json`, { card: c.id }); return ans;
    }
    if (a.choice === ACT.newTask) {
      const reach = this.newTaskReach(r);
      if (!reach.newTaskAllowed) refuse({ en: "New task refused: this workflow is internal or retired. Ask Firstmate to prepare the work again.", "zh-TW": "已拒絕開始新任務：此流程為內部或已退役流程。請 Firstmate 重新準備這項工作。" });
      // the staffing pins travel with the task: start() checks them against the current staffing like any new task
      const params = Object.fromEntries(Object.entries(r.params).filter(([k]) => !k.startsWith("_") || k === "_staffing" || k === "_ownStaffing"));
      // the new task runs the current release of the workflow (a run pinned to a replaced version keeps its old routes); the captain starts it, Firstmate is not involved
      let next: Run; try { next = this.start({ workflow: r.workflow, version: reach.newerVersion ? undefined : r.version, title: r.title, text: r.text, params, by: a.by }); }
      catch (e: any) { refuse({ en: `New task refused: ${e?.message ?? e}`, "zh-TW": `已拒絕開始新任務：${e?.message ?? e}` }); throw e; }
      // the link goes both ways: the old task names its follower, the new one names the task it repeats
      next.ctx.follows = r.id; this.commit(next, `follows ${r.id}`); this.emit(next, "follows", `the same request as ${r.id}, started from its failure card`, { task: r.id, card: c.id });
      const ans = this.cards.answer(c.id, a); r.parked = { by: a.by, at: now(), note: `followed by ${next.id}` }; r.ctx.followedBy = next.id;
      this.recordFailure(r, c, ACT.newTask, { task: next.id }); this.commit(r, `followed by ${next.id}`); this.emit(r, "failure_new_task", `${f.code}: a new task ${next.id} starts from the same request`, { card: c.id, task: next.id }); return ans;
    }
    if (a.choice === ACT.repropose) {
      const fresh = this.reproposers[r.workflow]; if (!fresh) refuse({ en: "Re-propose refused: this workflow has no fresh proposal. Ask Firstmate to propose it again.", "zh-TW": "已拒絕重新提出：這個流程無法重新提出。請 Firstmate 重新提案。" });
      let next: Run; try { next = fresh!(r, a.by); } catch (e: any) { refuse({ en: `Re-propose refused: ${e?.message ?? e}`, "zh-TW": `已拒絕重新提出：${e?.publicFailure?.reason?.["zh-TW"] ?? e?.message ?? e}` }); throw e; }
      const ans = this.cards.answer(c.id, a); r.parked = { by: a.by, at: now(), note: `followed by ${next.id}` }; r.ctx.followedBy = next.id;
      this.recordFailure(r, c, ACT.repropose, { task: next.id }); this.commit(r, `followed by ${next.id}`); this.emit(r, "failure_new_task", `${f.code}: a fresh proposal ${next.id} replaces this one`, { card: c.id, task: next.id }); return ans;
    }
    if (!node) throw new Error("this failure has no step to run again: report it or park it");
    if (a.choice === ACT.retry || a.choice === ACT.fixRetry) {
      if (f.class === "deterministic") { const no = retryRefusal(f, this.failureInputs(r, node)); if (no) refuse(no); }
      if (f.class === "environment") { const still = this.failureProbes[f.code]?.(r); if (still) refuse({ en: `Fix and retry refused: it is still not fixed: ${still}`, "zh-TW": `已拒絕重試：問題仍未修好：${still}` } as any); }
      if (f.class === "transient") delay = this.failureBackoff(f.retry?.attempt ?? 1);
    } else if (a.choice === ACT.rescope) {
      const no = rescopeRefusal({ note, previous: r.ctx.failureRescope?.note ?? null, requireConcrete: true }); if (no) refuse(no);
    } else if (a.choice === ACT.editParams) {
      const got = parseParamEdit(note, r.params, r.def.params ?? null); // only declared, unlocked params, checked against their spec
      if ("code" in got) refuse(got); else params = got.params;
    } else if (a.choice !== ACT.answer && a.choice !== ACT.prepareAgain) throw new Error(`choose one of ${c.options.map((o) => o.id).join(", ")}`);
    if (a.choice === ACT.answer && !note) throw new Error("give a non-empty answer before continuing");
    const ans = this.cards.answer(c.id, a);
    if (a.choice === ACT.prepareAgain) { const from = this.preparationNode(r, node); this.recordFailure(r, c, a.choice, { from: from.id }); r.nodes[node.id].state = "pending"; r.nodes[node.id].routing = null; r.nodes[node.id].data.failure = null; return this.reopenAt(r, c, f, from, a, 0); }
    const rn = r.nodes[node.id];
    if (params) { r.params = { ...r.params, ...params }; r.paramEdits = { ...(r.paramEdits ?? {}), ...params }; } // durable: replayed on top of the creation params
    if (a.choice === ACT.answer) { delete rn.data.escalation; rn.data.failureAnswer = { kind: "answer", question: f.message, note, by: "captain" }; r.ctx.answers = { ...(r.ctx.answers ?? {}), [node.id]: ans.answer }; }
    else if (a.choice === ACT.rescope) { rn.data.failureAnswer = { kind: "rescope", question: f.message, note }; r.ctx.failureRescope = { node: node.id, note, at: now() }; }
    else delete rn.data.failureAnswer;
    const rec = this.recordFailure(r, ans, a.choice, params ? { params } : {});
    // the captain's answer (or rescope) is the captain's latest word: it binds later rounds like a "request changes" note, and can override an earlier one
    if (a.choice === ACT.answer || a.choice === ACT.rescope) this.addAmendment(r, ans, node.id, rec);
    return this.reopenAt(r, c, f, node, a, delay);
  }
  /** Firstmate answered an agent's question (studio_answer_agent_question), or escalated it to the captain with its reason. */
  answerFromFirstmate(runId: string, nodeId: string, o: { answer?: string | null; escalate?: string | null; visit?: number; choice?: string | null; recommendation?: string | null }): any {
    const r = this.must(runId); const q = r.ctx.firstmateQuestion; const node = r.def.nodes.find((n) => n.id === nodeId);
    if (!node || !q || q.node !== nodeId) throw new Error("no question from this step waits for Firstmate");
    if (q.card) return this.decideEscalation(r, node, o);
    if (o.choice) throw new Error("this is an agent's question: answer it or escalate it; choice is for an escalation card");
    if (!this.trusted(r.id).ok) throw new Error("this run's evidence ledger does not verify: it cannot run again");
    if (r.archived || r.parked || !["failed", "waiting"].includes(r.status) || r.failureCard) throw new Error("this run is not waiting for Firstmate's answer");
    const b = this.busy(r.id); if (b) throw new Error(`still finishing: ${b}. Answer again once that is done`);
    const answer = String(o.answer ?? "").trim(), escalate = String(o.escalate ?? "").trim();
    if (!!answer === !!escalate) throw new Error("give either an answer or a reason to escalate");
    const f = r.failure!;
    if (q.visit !== undefined && o.visit !== q.visit) throw new Error("the answer must match the visit in the question notice");
    if (!f || f.code !== "ask.escalated" || f.node !== nodeId || f.visit !== r.nodes[nodeId].visits || (q.visit !== undefined && q.visit !== f.visit) || f.message !== q.question) throw new Error("the question no longer matches this failed round");
    // an escalation is the captain's failure card: the run stops waiting and fails as any other question for the captain does
    if (escalate) { const c = this.escalateQuestion(r, node, escalate); return { escalated: true, card: c?.id ?? null }; }
    delete r.ctx.firstmateQuestion;
    const rn = r.nodes[node.id]; rn.data.failureAnswer = { kind: "answer", question: q.question, note: answer.slice(0, 4000), by: "firstmate" };
    this.record(this.x(r, node, rn), "failure-answer", { actor: "firstmate", data: { class: f.class, code: f.code, choice: ACT.answer, note: answer.slice(0, 4000), by: "firstmate" } });
    this.reopenAt(r, { id: `firstmate:${r.id}:${node.id}` } as SCard, f, node, { choice: ACT.answer }, 0);
    return { answered: true };
  }
  // ---------- escalations go to Firstmate first (retro 2026-10-17, finding 9) ----------
  /** The options Firstmate may take on an escalation: never one that ends the run (park, close, drop) or holds it for the captain. */
  private firstmateOptions(r: Run, node: WNode, options: SCard["options"], allowed?: string[] | null) {
    if (allowed) return options.filter((o) => allowed.includes(o.id));
    const ends = (id: string) => { const to = r.def.edges.filter((e) => e.from === node.id && e.when?.split("|").includes(id)).map((e) => r.def.nodes.find((n) => n.id === e.to));
      return !to.length || to.some((n) => !n || !r.def.edges.some((e) => e.from === n.id)); };
    // another model: only the picks this run's staffing accepts (firstmatePicks), never free text; with none, the option is the captain's
    const picks = new Set(this.firstmatePicks(r, node).map((p) => p.value));
    return options.filter((o) => !o.hold && !ends(o.id)).flatMap((o) => o.id !== "other-model" ? [o] : (() => { const sel = (o.select ?? []).filter((s) => picks.has(s.value)); return sel.length ? [{ ...o, select: sel }] : []; })());
  }
  /** The models Firstmate may pick for "another model" on this run: the configured ones by default; a staffed run narrows them (staffing.ts). */
  firstmatePicks: (r: Run, node: WNode) => { value: string; label: string }[] = () => this.modelChoices();
  /** Kinds that are the captain's decision by nature: they never go to Firstmate first, whatever the workflow says. */
  static readonly CAPTAIN_KINDS: readonly string[] = ["merge", "dispatch", "permission", "acceptance"];
  /** An escalation card node asks Firstmate first: true when the question was sent (the node waits), else why it could not be. */
  private diagnoseFirst(x: X, kind: CardKind, b: Body, allowed: string[] | null = null): true | { en: string; zh: string } {
    // Firstmate decides an escalation at one step at most twice: still stuck after that, the captain decides
    const door = b.door ?? (x.node.card?.door_from ? (x.ctx[x.node.card.door_from]?.door ?? x.ctx[x.node.card.door_from] ?? null) : null);
    if (Engine.CAPTAIN_KINDS.includes(kind) || door === "one-way" || x.node.card?.confirm_door || (b.captainOnly && !allowed)) return { en: "Only the captain decides this card (its kind, a one-way door, or a captain-only decision), so it comes straight to you.", zh: "這張卡只能由船長決定（卡片種類、單向門或只限船長），所以直接交給你。" };
    const decided = Number(x.run.ctx.firstmateDecided?.[x.node.id] ?? 0);
    if (decided >= 2) return { en: `Firstmate already decided here ${decided} times and the run is still stuck, so this one is yours.`, zh: `Firstmate 在這裡已經決定過 ${decided} 次，仍然卡住，所以這次交給你。` };
    const options = b.options ?? x.node.card?.options ?? [];
    const open = this.firstmateOptions(x.run, x.node, options, allowed);
    const question = escalationQuestion(x.node.label, b, options, open);
    x.rn.data.firstmateCard = { visit: x.visit, kind, body: b, allowed };
    let sent = false; try { sent = !!this.askFirstmate?.(x.run, x.node, question, x.visit, { escalation: { options: open.map((o) => ({ id: o.id, label: o.label, ...(o.note ? { note: true } : {}), ...(o.select?.length ? { select: o.select.map((s) => s.value) } : {}) })) } }); } catch { sent = false; }
    if (!sent) { delete x.rn.data.firstmateCard; return { en: "Firstmate is not running, so this comes straight to you.", zh: "Firstmate 目前沒有在執行，所以直接交給你決定。" }; }
    x.run.ctx.firstmateQuestion = { node: x.node.id, visit: x.visit, question, at: now(), card: true };
    this.firstmateSent.add(`${x.run.id}@${x.run.ctx.firstmateQuestion.at}`); this.watchFirstmate(x.run);
    this.emit(x.run, "question_to_firstmate", `${x.node.label}: Firstmate diagnoses this escalation first`, { node: x.node.id, escalation: true });
    return true;
  }
  /** Firstmate answered an escalation: it decides within the spec (the run goes on), or escalates with its diagnosis (the captain's card). */
  private decideEscalation(r: Run, node: WNode, o: { answer?: string | null; escalate?: string | null; visit?: number; choice?: string | null; recommendation?: string | null }) {
    const q = r.ctx.firstmateQuestion!; const rn = r.nodes[node.id]; const held = rn.data.firstmateCard as { visit: number; kind: CardKind; body: Body; allowed?: string[] | null; escalation?: any } | undefined;
    if (!this.trusted(r.id).ok) throw new Error("this run's evidence ledger does not verify: it cannot run again");
    if (r.archived || r.parked || TERMINAL.includes(r.status) || rn.state !== "running" || rn.waiting !== "firstmate" || !held || held.visit !== rn.visits || q.visit !== rn.visits) throw new Error("this escalation no longer waits for Firstmate");
    if (o.visit !== q.visit) throw new Error("the answer must match the visit in the escalation notice");
    const b = this.busy(r.id); if (b) throw new Error(`still finishing: ${b}. Answer again once that is done`);
    const escalate = String(o.escalate ?? "").trim(), choice = String(o.choice ?? "").trim(), note = String(o.answer ?? "").trim();
    if (!!escalate === !!choice) throw new Error("give either a choice (with your reason in answer) or a diagnosis to escalate");
    if (escalate) {
      const d = { by: "firstmate" as const, why: escalate.slice(0, 2000), recommendation: String(o.recommendation ?? "").trim().slice(0, 1000) || null };
      held.escalation = d; delete r.ctx.firstmateQuestion; this.commit(r, "escalation to the captain"); // a restart from here raises the card (load)
      const work = this.escalateCard(r, node, d);
      void this.track(r, "escalation card", work);
      return work.then((c) => ({ escalated: true, card: c?.id ?? null }));
    }
    const options = held.body.options ?? node.card?.options ?? [];
    const mayTake = this.firstmateOptions(r, node, options, (held as any).allowed ?? null); const opt = mayTake.find((x) => x.id === choice);
    if (!opt) throw new Error(`Firstmate may choose ${mayTake.map((x) => x.id).join(", ") || "nothing here"}; ending or holding the run is the captain's call: escalate instead`);
    if (!note) throw new Error("say why in answer: the reason (or, for a picker, the value) goes on the record");
    if (opt.select?.length && !opt.select.some((s) => s.value === note)) throw new Error(`pick one of ${opt.select.map((s) => s.value).join(", ")}`);
    if (choice === ACT.rescope) { const last = Object.values(r.ctx.answers ?? {}).filter((x: any) => x?.choice === ACT.rescope && x.note).sort((x: any, y: any) => String(x.at).localeCompare(String(y.at))).at(-1) as any;
      const no = rescopeRefusal({ note, previous: last?.note ?? null }); if (no) throw new FailureRefusal(no); }
    // the decision is a card of its own, answered by Firstmate: the ledger, the card's effects and the routing are the captain's path
    const sec = (p: Partial<Sections> | undefined, intent: string): Sections => ({ ...emptySections(), ...(p ?? {}), intent, scope: { in: p?.scope?.in ?? [], out: p?.scope?.out ?? [] } });
    const intent = r.text.split("\n")[0].slice(0, 300) || r.title;
    const c = this.cards.create({ run: r.id, node: node.id, visit: rn.visits, kind: held.kind, title: { en: held.body.title, "zh-TW": held.body.zhTitle ?? held.body.title },
      sections: { en: sec(held.body.en, intent), "zh-TW": sec(held.body.zh, intent) }, body: `Firstmate decided: ${opt.label} — ${note}`, options, confirmDoor: false, door: null, links: held.body.links ?? [], detail: null,
      decidedBy: "firstmate", workflow: r.workflow, runTitle: r.title, ledger: null, ste: null });
    // the same authorization as the captain's answer (staffing verification, approvals only the captain gives); a refusal leaves no card
    try { this.deps.authorizeAnswer?.(r, c, { choice, note, by: "firstmate" }); this.cards.answer(c.id, { choice, note, by: "firstmate" }); }
    catch (e) { this.cards.cancel(c.id); throw e; }
    delete r.ctx.firstmateQuestion; delete rn.data.firstmateCard; r.ctx.firstmateDecided = { ...(r.ctx.firstmateDecided ?? {}), [node.id]: Number(r.ctx.firstmateDecided?.[node.id] ?? 0) + 1 };
    rn.card = c.id; rn.waiting = "card"; this.commit(r, `Firstmate decided ${choice} on ${node.id}`);
    this.emit(r, "firstmate_decided", `${node.label}: Firstmate chose ${opt.label} — ${note.slice(0, 200)}`, { node: node.id, card: c.id, choice });
    const work = this.carryAnswer(r, node.id); void this.track(r, `the answer at ${node.id}`, work);
    return work.then(() => ({ decided: true, choice, card: c.id }));
  }
  /** The escalation reaches the captain: the card's body is the diagnosis in captain terms (what is stuck, why, what to do), never a worker brief. */
  private async escalateCard(r: Run, node: WNode, d: { by: "firstmate" | "studio"; why: string; zhWhy?: string; recommendation?: string | null }) {
    const rn = r.nodes[node.id]; const held = rn.data.firstmateCard as { visit: number; kind: CardKind; body: Body } | undefined;
    if (r.ctx.firstmateQuestion?.node === node.id) delete r.ctx.firstmateQuestion;
    if (!held || rn.state !== "running" || rn.waiting !== "firstmate" || TERMINAL.includes(r.status)) return null;
    const x = this.x(r, node, rn);
    const c = await this.card(x, held.kind, diagnosedBody(held.body, d));
    if (this.owns(x)) { delete rn.data.firstmateCard; rn.waiting = "card"; rn.cause = "waiting(card)"; this.commit(r, `escalated to the captain: ${c.id}`); this.raising.get(c.id)?.resolve(); this.settle(r); }
    return c;
  }
  /** The node a fresh preparation goes back to: the step before the card that led here, so that card's edge checks (gates) run again and a new card is raised. */
  preparationNode(r: Run, node: WNode): WNode {
    const visited = (id: string) => (r.nodes[id]?.visits ?? 0) > 0;
    const pred = (n: WNode) => r.def.edges.filter((e) => e.to === n.id && visited(e.from)).map((e) => r.def.nodes.find((x) => x.id === e.from)!).find(Boolean) ?? null;
    let p = pred(node); if (!p) return node;
    if (p.kind === "card") { const q = pred(p); if (q) p = q; }
    return p;
  }
  /** The run goes on from `node`: nothing else is reset, every earlier step and record stays. Siblings the failure stopped run again too. */
  private reopenAt(r: Run, c: SCard, f: Failure, node: WNode, a: { choice: string }, delay: number) {
    const rn = r.nodes[node.id]; const ans = this.cards.get(c.id) ?? null;
    r.status = "running"; r.result = null; r.endedAt = null; r.error = null; r.failureCard = null; r.queue = [];
    rn.state = "pending"; rn.waiting = null; rn.card = null; rn.attempt = 0; rn.routing = null; rn.data.failure = null;
    // the failure stopped the run's other live work (parallel siblings, queued nodes): it runs again, so joins downstream get every input
    const stopped = r.ctx.stopped ?? { nodes: [], queue: [] }; const again: string[] = [];
    for (const id of stopped.nodes as string[]) { const sib = r.nodes[id]; if (id === node.id || !sib || sib.state !== "skipped") continue;
      sib.state = "pending"; sib.waiting = null; sib.card = null; sib.job = null; sib.routing = null; sib.visits = Math.max(0, sib.visits - 1); sib.cause = `re-queued: stopped by the failure, ${a.choice} on ${c.id}`; again.push(id); }
    for (const id of stopped.queue as string[]) if (id !== node.id && r.nodes[id]?.state === "pending" && !again.includes(id)) again.push(id);
    delete r.ctx.stopped;
    if (a.choice !== ACT.answer && node.max_visits && rn.visits >= node.max_visits + (rn.extra ?? 0)) rn.extra = (rn.extra ?? 0) + 1;
    rn.data.failureRetries = (rn.data.failureRetries ?? 0) + 1; this.aborts.delete(r.id);
    const wait = delay >= 60_000 ? `${Math.round(delay / 60_000)} min` : `${Math.round(delay / 1000)} s`;
    rn.cause = delay ? `retry after ${wait} (backoff)` : `${a.choice} on ${c.id}`;
    this.commit(r, rn.cause); this.emit(r, "failure_retry", `${node.label}: ${a.choice} after ${f.class} · ${f.code}${delay ? ` (waits ${wait})` : ""}`, { node: node.id, card: c.id, choice: a.choice, delayMs: delay });
    if (delay) { rn.state = "running"; (rn as any).waiting = "backoff"; rn.data.backoffUntil = new Date(Date.now() + delay).toISOString(); rn.data.backoffAlso = again; r.status = "waiting"; this.commit(r, "backoff"); this.scheduleBackoff(r, node.id); }
    else { for (const id of [node.id, ...again]) if (!r.queue.includes(id) && r.nodes[id]?.state === "pending") r.queue.push(id); this.tick(r); }
    return ans;
  }
  /** A transient retry waits out its backoff (also after a restart: only the time still left), then runs with the siblings the failure stopped. */
  private scheduleBackoff(r: Run, id: string) {
    const rn = r.nodes[id]; const left = Math.max(0, Date.parse(rn.data.backoffUntil ?? "") - Date.now() || 0);
    setTimeout(() => {
      if (this.runs.get(r.id) !== r || this.gone.has(r.id) || TERMINAL.includes(r.status) || rn.state !== "running" || (rn as any).waiting !== "backoff") return;
      const also: string[] = rn.data.backoffAlso ?? []; rn.state = "pending"; rn.waiting = null; delete rn.data.backoffUntil; delete rn.data.backoffAlso;
      for (const n of [id, ...also]) if (!r.queue.includes(n) && r.nodes[n]?.state === "pending") r.queue.push(n);
      r.status = "running"; this.commit(r, "backoff over"); this.tick(r);
    }, left);
  }
  private recordFailure(r: Run, c: SCard, choice: string, extra: Record<string, unknown> = {}) {
    const node = r.def.nodes.find((n) => n.id === c.node) ?? r.def.nodes[0]; if (!node) return null;
    return this.record(this.x(r, node, r.nodes[node.id]), "failure-answer", { actor: c.answer?.by ?? "captain", data: { card: c.id, class: c.failure?.class, code: c.failure?.code, choice, note: c.answer?.note ?? null, ...extra } });
  }
  async card(x: X, kind: CardKind, b: Body): Promise<SCard> {
    if (!this.owns(x)) throw new Error("card owner ended before presentation");
    if(x.run.continuation?.node===x.node.id&&x.run.continuation.visit===x.visit)b={...b,captainOnly:true};
    const sec = (p: Partial<Sections> | undefined): Sections => ({ ...emptySections(), ...(p ?? {}), scope: { in: p?.scope?.in ?? [], out: p?.scope?.out ?? [] } });
    const en = sec({ intent: x.run.text.split("\n")[0].slice(0, 300) || x.run.title, ...b.en });
    const zh = sec({ intent: en.intent, ...b.zh });
    const c = this.cards.create({ run: x.run.id, node: x.node.id, visit: x.rn.visits, kind, title: { en: b.title, "zh-TW": b.zhTitle ?? b.title }, sections: { en, "zh-TW": zh }, body: b.body ?? "",
      options: b.options ?? x.node.card?.options ?? [{ id: "approve", label: "Approve", labelZh: "核准", primary: true }, { id: "reject", label: "Reject", labelZh: "不採用" }],
      confirmDoor: !!x.node.card?.confirm_door, door: b.door ?? (x.node.card?.door_from ? (x.ctx[x.node.card.door_from]?.door ?? x.ctx[x.node.card.door_from] ?? null) : null), links: b.links ?? [], detail: b.detail ?? null, ...(b.captainOnly ? { captainOnly: true } : {}), workflow: x.run.workflow, runTitle: x.run.title, ledger: b.ledger ?? null, ste: null, captures: b.captures ?? null, ...(b.pullRequest ? { pullRequest: b.pullRequest } : {}), ...(b.failure ? { failure: b.failure } : {}), ...(b.crew ? { crew: b.crew } : {}), ...(b.acknowledge ? { acknowledge: b.acknowledge } : {}) });
    // the card contract (card-contract.ts): a card that cannot answer its question is refused in tests and logged on the run otherwise
    const broken = cardContract(c);
    if (broken.length) { this.emit(x.run, "log", `card contract: ${c.id} (${kind}): ${broken.join("; ").slice(0, 600)}`);
      if (cardContractMode() === "enforce") { this.cards.cancel(c.id); console.error(`card contract violated by ${x.run.workflow}#${x.node.id} (${kind} "${c.title.en}"): ${broken.join("; ")}`); throw new Error(`card contract: ${c.id} (${kind} "${c.title.en}"): ${broken.join("; ")}`); } }
    const staged=this.repreparing.get(`${x.run.id}/${x.node.id}`);if(staged){if(staged.prepared){this.cards.cancel(c.id);throw new Error("One replacement card per preparation");}staged.prepared=c.id;}else{x.rn.card = c.id; this.commit(x.run, `card ${c.id} raised`);}
    { let done!: () => void; const p = new Promise<void>((res) => (done = res)); this.raising.set(c.id, { done: p, resolve: () => { this.raising.delete(c.id); done(); } }); }
    this.emit(x.run, "card_raised", `${c.id} ${c.title.en}`, { node: x.node.id, card: c.id, kind });
    // every card is STE-checked (en and zh-TW) by the checks the workflow names, by default the runtime's core one
    for (const use of x.run.def.card_checks ?? ["core/ste-wording"]) {
      const texts = (["en", "zh-TW"] as const).flatMap((l) => { const s = c.sections[l]; return [{ section: `${l}.title`, text: c.title[l] }, { section: `${l}.intent`, text: s.intent }, { section: `${l}.why`, text: s.why }, { section: `${l}.how`, text: s.how }].filter((t) => t.text); });
      const e = await this.runCheck(x, { use, blocking: false }, `card:${c.id}`, { texts }).catch(() => null);
      if (!this.owns(x)) throw new Error("card owner ended during presentation checks");
      const cur = this.cards.get(c.id)!; cur.ste = e ? { verdict: e.verdict, findings: e.findings.length, seq: e.seq } : { verdict: "error", findings: 0, seq: null }; this.cards.save(cur);
    }
    // an authorization window: only a signed grant the captain opened in Studio; never for a one-way door
    if (!this.owns(x)) throw new Error("card owner ended before authorization");
    try { for (const prepared of Object.values(this.cardPrepared)) { if (!this.owns(x)) throw new Error("card owner ended during preparation"); prepared(x,c,b); if (!this.owns(x)) throw new Error("card owner ended during preparation"); } }
    catch (error) { this.cards.cancel(c.id); throw error; }
    const g = this.grants.open(kind, x.ctx.project ?? x.run.params.project ?? null);
    const choice = x.node.card?.auto_option ?? c.options.find((o) => o.primary)?.id ?? null;
    // a window never answers a card its body marks captain-only (the merge card's intent alignment is the captain's own act)
    if (g && c.captainOnly) this.emit(x.run, "log", `${c.id}: authorization window ${g.id} lists ${kind}, but this card waits for the captain's own answer`);
    if (g && !c.captainOnly && choice && c.options.some((o) => o.id === choice) && c.door !== "one-way") {
      setTimeout(() => { if (!this.owns(x)) return; void this.answer(c.id, { choice, by: `auth window ${g.id} (granted by ${g.granted_by} at ${g.at}, until ${g.until})` }).catch((e) => this.emit(x.run, "log", `auth window could not answer ${c.id}: ${e?.message ?? e}`)); }, 10);
    }
    this.watchCard(x, c);
    return this.cards.get(c.id)!;
  }

  private async hookChecks(x: X, outcome: string, external = false): Promise<Result> {
    if (!this.owns(x)) return { outcome: "cancel" };
    const refs = (x.node.checks ?? []).map(ref => ({ ...ref, blocking: false }));
    const trusted = external ? this.trusted(x.run.id) : null;
    if (trusted && !trusted.ok) throw new Error("external hook check evidence integrity failed");
    // Keep the canonical parallel hook execution. Each external check has its
    // own durable index so restart can reuse completed signed evidence.
    const entries = external ? await Promise.all(refs.map(async (ref, index) => {
      if (!this.owns(x)) throw new Error("external hook owner ended");
      const edge = `external-hook:${index}`;
      const kept = trusted!.entries.filter(e => e.node === x.node.id && e.round === x.visit && e.edge === edge && e.check === ref.use).at(-1);
      return kept ?? await this.runCheck(x, ref, edge);
    })) : (await this.runChecks(x, refs, null)).entries;
    if (!this.owns(x)) return { outcome: "cancel" };
    const report = x.rn.data.externalHookReport;
    const reported = external && report?.version === 1 && report.visit === x.visit && JSON.stringify(report.seqs) === JSON.stringify(entries.map(e => e.seq));
    const body = entries.map(e => ({ check: e.check, verdict: e.verdict, findings: e.findings, seq: e.seq, data: e.data ?? null }));
    if (reported && JSON.stringify(x.ctx.hooks?.[x.node.id]) === JSON.stringify(body)) return { outcome, note: x.rn.note };
    if (x.node.checks?.length && this.owns(x)) {
      // Node and context events are separate durable writes. If the report
      // marker reached disk before context, rebuild the context, not its checks
      // or the already recorded note.
      x.ctx.hooks = { ...(x.ctx.hooks ?? {}), [x.node.id]: body };
      if (!reported) x.rn.note = [x.rn.note, entries.map(e => `${e.check.split("/").pop()}: ${e.verdict}`).join(", ")].filter(Boolean).join(" · "); if (external) x.rn.data.externalHookReport = { version: 1, visit: x.visit, seqs: entries.map(e => e.seq) }; x.save();
    }
    return { outcome, note: x.rn.note };
  }

  // ---------- the five node kinds ----------
  private builtinKinds() {
    const self = this;
    // hook: a runtime action (do) and/or hook checks; reported, never moving the run backward
    this.kinds.hook = { async start(x: X) {
      let out = "ok";
      if (x.node.do) { const f = self.actions[x.node.do]; if (!f) throw new Error(`no action ${x.node.do}`); const result = (await f(x)) || "ok"; if (typeof result !== "string") { if ("wait" in result) return result; out = result.outcome; x.rn.note = result.note ?? x.rn.note; } else out = result; }
      return self.hookChecks(x, out);
    }, async answer(x: X, card: SCard) { const handler = x.node.do && self.actionAnswers[x.node.do]; return handler ? handler(x, card) : { outcome: card.answer!.choice }; } };
    // check: runs its checks; the outcome is pass/fail, or a route a check names (data.route), e.g. the door
    this.kinds.check = { async start(x: X) {
      const r = await self.runChecks(x, x.node.checks ?? [], null);
      x.rn.data.results = r.entries.map((e) => ({ check: e.check, verdict: e.verdict, seq: e.seq }));
      const routed = x.node.args?.route_from ? r.entries.find((e) => e.check === x.node.args!.route_from) as any : null;
      if (routed?.data?.route) { x.rn.note = `${routed.check}: ${routed.data.route}`; if (x.node.args?.store) x.ctx[x.node.args.store] = routed.data; return { outcome: String(routed.data.route), note: x.rn.note }; }
      return { outcome: r.blocked.length ? "fail" : "pass", note: r.blocked.length ? r.blocked.map((e) => `${e.check} ${e.verdict}`).join(", ") : `${r.entries.filter((e) => e.verdict === "pass").length}/${r.entries.length} pass` };
    } };
    // card: asks a human (or an auth window) and waits
    this.kinds.card = {
      async start(x: X) {
        const from = x.node.args?.body_from ? self.cardBodies[x.node.args.body_from] : null;
        // a workflow's card text may carry both locales: title / body as {en, zh-TW}
        const loc = (v: any, l: "en" | "zh-TW") => (v && typeof v === "object" ? v[l] ?? v.en ?? "" : v ?? "");
        const card = x.node.card ?? {};
        const b: Body = from ? await from(x) : { title: fill(loc(card.title, "en") || x.node.label, x.run), zhTitle: fill(loc(card.title, "zh-TW") || x.node.label, x.run),
          en: { why: fill(loc(card.body, "en"), x.run) }, zh: { why: fill(loc(card.body, "zh-TW"), x.run) }, body: fill(loc(card.body, "en"), x.run) };
        const kind = (x.node.args?.card_kind ?? "question") as CardKind; let body: Body = { ...b, options: b.options ?? x.node.card?.options };
        // an escalation (args.firstmate_first) goes to Firstmate first: only its escalation, or its silence, reaches the captain
        if (x.node.args?.firstmate_first && !body.direct) { const asked = self.diagnoseFirst(x, kind, body);
          if (asked === true) return { wait: true, firstmate: true, note: "Firstmate diagnoses this first" };
          body = diagnosedBody(body, { by: "studio", why: asked.en, zhWhy: asked.zh }); }
        const c = await self.card(x, kind, body);
        return { wait: true, note: `card ${c.id}` };
      },
      async answer(x: X, c: SCard) {
        const own = x.node.args?.body_from ? self.cardAnswers[x.node.args.body_from] : null, r = own ? await own(x, c) : null;
        return r ?? { outcome: c.answer!.choice, note: c.answer!.note };
      },
    };
    this.kinds.agent = {
      async start(x: X) {
        x.rn.data.stoppedBeforeAgent = false;
        try { const outcome = await self.runAgent(x); return { outcome, ...(x.rn.data.stoppedBeforeAgent ? { stopped: true } : {}) } as any; }
        catch (e: any) { if (!(e instanceof QueueRefusal) && !(e instanceof ProviderRefusal) || x.cancelled()) throw e; return self.queueCapability(x, e.message, e); }
      },
      async answer(x: X, c: SCard) {
        if (!x.rn.data.nativeQueueCapability) return { outcome: c.answer!.choice, note: c.answer!.note };
        if (c.answer!.choice === x.rn.data.nativeQueueCapability.closeAction) { self.cancel(x.run.id, "closed after round readiness refusal"); return { outcome: "cancelled" }; }
        if (c.answer!.choice !== x.rn.data.nativeQueueCapability.retryAction) throw new Error("unknown readiness recovery action");
        throw new Error("readiness retry must use its owned continuation");
      }
    };
    // the one built-in hook action: a step that only records a note (a hand-off point, a marker in the run)
    this.actions.note ??= (x: X) => { x.rn.note = String(x.node.args?.text ?? x.node.label).slice(0, 300); return "ok"; };
    // loop: installed by refine.ts
  }

  /**
   * Every agent round runs in the round sandbox (architecture §10): the folders its mode
   * materialized (none by default), plus the hosts policy egress.allow grants for this
   * run. Only a signed captain grant of kind "sandbox-off" (time-boxed, per project or
   * global) runs a round outside it, and the run's log says so.
   */
  roundSandbox(x: X, b: { writes: string[]; reads?: string[]; cwd?: string } | null, label = "agent") {
    const off = this.grants.open("sandbox-off", x.run.ctx.project ?? x.run.params?.project ?? null);
    if (off) { x.log(`this round runs outside the round sandbox: the captain's grant ${off.id} (until ${off.until})`); return null; }
    // a round with no folder of its own (judges, designers, coordinators) still opens in a scratch folder of its own under data/work
    const own = b ?? this.roundScratch(x, label);
    return { ...own, allow: ([] as any[]).concat(x.policy("egress.allow", []) ?? []).map(String) };
  }
  /** The one place a round's working folder is made: <data>/work/<area>/<run>/<node>-<visit>-<attempt>[-label] (fresh unless kept). */
  roundDir(x: X, area: string, o: { prefix?: string; label?: string; fresh?: boolean } = {}) {
    return materializeRoundDir(this.deps.dataDir, this.roundDirParts(x, area, o), { fresh: o.fresh });
  }
  /** The same folder's path, without touching it (a mode's sandbox spec names it; its begin made it). */
  roundDirPath(x: X, area: string, o: { prefix?: string; label?: string } = {}) { return roundWorkPath(this.deps.dataDir, ...this.roundDirParts(x, area, o)); }
  private roundDirParts(x: X, area: string, o: { prefix?: string; label?: string }) {
    const clean = (v: unknown) => String(v).replace(/[^A-Za-z0-9._-]/g, "_");
    const leaf = [o.prefix, x.node.id, x.visit, x.rn?.attempt ?? 0, o.label].filter((v) => v !== undefined && v !== "").map(clean).join("-");
    return [clean(area), clean(x.run.id), leaf];
  }
  /** A text-only round's scratch folder: its cwd and the only place it may write. */
  roundScratch(x: X, label = "agent") { const d = this.roundDir(x, "round-scratch", { label }); return { writes: [d], cwd: d }; }
  /** Each round's skeleton, computed once (its preflight facts read git and the repository configuration) and reused by its turns. */
  private skeletons = new WeakMap<X, { key: string; text: string }>();
  /** The brief's six fixed sections for this round: the graph's facts, the mode's preflight facts and the operating manual page. */
  briefSkeleton(x: X, modeName = x.node.mode ?? ""): string {
    const mode = this.modes[modeName]; if (!mode) return "";
    const key = `${modeName}|${x.visit}|${x.rn?.attempt ?? 0}`, had = this.skeletons.get(x); if (had?.key === key) return had.text;
    const maxTools = typeof mode.maxTools === "function" ? mode.maxTools(x) : mode.maxTools;
    const text = composeSkeleton({ def: x.run.def, node: x.node, visit: x.visit, modeName, tools: mode.tools(x).map((t) => t.name), maxTools: maxTools ?? 60,
      timeoutS: Number(x.node.timeout_s ?? x.policy("round_timeout_s", 900)) || null, egress: ([] as any[]).concat(x.policy("egress.allow", []) ?? []).map(String).filter(Boolean),
      facts: mode.skeleton?.(x) ?? null, dataDir: this.deps.dataDir });
    this.skeletons.set(x, { key, text }); return text;
  }
  /** An agent node: one turn of its mode on the picked provider; a swap stops it, writes a hand-off, and starts the new agent from it. */
  async runAgent(x: X, modeName = x.node.mode): Promise<string> {
    const mode = this.modes[modeName ?? ""]; if (!mode) throw new Error(`no agent mode ${modeName}`);
    // a begin that stops the round with an outcome (e.g. "blocked": the round cannot start safely) routes like any outcome; any other throw fails the attempt
    const release = await this.deps.agents.queue.acquire(this.roundAdmission(x, modeName!));
    let begun = false, how: "done" | "timeout" | "failed" | "cancelled" = "failed";
    try {
      if (!this.owns(x)) throw new QueueRefusal("round owner ended before provider choice");
      const pickPreparation = mode.preparePick?.(x) as unknown;
      if (pickPreparation && typeof (pickPreparation as any).then === "function") throw new QueueRefusal("provider choice preparation must be synchronous");
      const preparedPick = hashInput(x.pick());
      const preparedProvider: Provider | undefined = this.deps.selectProvider ? await this.deps.selectProvider(x, x.pick()) : undefined;
      if (!this.owns(x) || hashInput(x.pick()) !== preparedPick) throw new QueueRefusal("round owner or provider choice changed before provider preparation");
      try { await mode.begin?.(x); begun = true; } catch (e: any) { if (typeof e?.outcome === "string") { x.rn.data.stoppedBeforeAgent = true; x.rn.note = `stopped before the agent: ${e.message}`; this.emit(x.run, "round_blocked", `${x.node.label}: ${e.message}`, { node: x.node.id }); return e.outcome; } throw e; }
      if (!this.owns(x) || hashInput(x.pick()) !== preparedPick) throw new QueueRefusal("round owner or provider choice changed before provider launch");
      const out = await this.agentTurns(x, mode, modeName!, preparedProvider, preparedPick); how = out === "timeout" ? "timeout" : "done"; return out;
    } catch (e: any) { how = x.cancelled() || /cancelled/.test(String(e?.message)) ? "cancelled" : "failed"; throw e; }
    finally { if (begun) try { await mode.end?.(x, how); } catch (e: any) { x.log(`round end: ${e?.message ?? e}`); } release(); }
  }
  private async agentTurns(x: X, mode: AgentMode, modeName: string, initialProvider?: Provider, initialPick?: string): Promise<string> {
    let handoff: string | null = x.rn.data.handoff ?? null;
    for (let hop = 0; hop < 5; hop++) {
      const pickIdentity = !hop && initialPick ? initialPick : hashInput(x.pick());
      const prov = !hop && initialProvider ? initialProvider : this.deps.selectProvider ? await this.deps.selectProvider(x, x.pick()) : x.provider();
      const use = x.skillUse ? x.skillUse() : { text: x.skill(), roleSkill: null, skills: [] }; const skill = use.text;
      // the step (and the round record's header) names the role skill and the node skills this turn received
      { const loaded = use.skills;
        const step = [...x.run.steps].reverse().find((s) => s.node === x.node.id && s.state === "running");
        if (step) { step.skills = loaded; step.roleSkill = use.roleSkill; x.save(); }
        if (!hop && (loaded.length || use.roleSkill)) x.log(`skills loaded: ${[use.roleSkill ? roleSkillName(use.roleSkill) : null, ...loaded].filter(Boolean).join(", ")}`); }
      const prompt = mode.prompt(x), answer = this.failureBrief(x);
      const tools = mode.tools(x), maxTools = typeof mode.maxTools === "function" ? mode.maxTools(x) : mode.maxTools;
      // every brief ends with the same six sections (a mode that keeps a durable brief, like build, puts them in it itself)
      const skeleton = this.briefSkeleton(x, modeName), withAnswer = prompt + (answer && !prompt.endsWith(answer) ? answer : "");
      const base = mode.embedsSkeleton ? withAnswer : `${withAnswer}\n${skeleton}`;
      const text = handoff ? `${base}\n\nHANDOFF\nAnother agent started this step and was stopped. Its hand-off follows; continue from the current state instead of starting over.\n${handoff}` : base;
      x.ctx.lastPrompt = { ...(x.ctx.lastPrompt ?? {}), [x.node.id]: base.length <= 6000 + skeleton.length ? base : `${base.slice(0, 6000)}\n[…]\n${skeleton}` }; // the six sections are always kept
      const tl = Number(x.node.timeout_s ?? x.policy("round_timeout_s", 900));
      const system = mode.system(x, skill);
      const rules = new OperatingRules(this.deps.dataDir).section(x.run.params?.project || null); // read per round: an edit reaches the next round
      const admissionReceipt=this.deps.instructionReceipt?.(x, x.node.role ?? x.node.args?.role, jobInstructions(system, rules), prov);
      const job = await this.deps.agents.run({ kind: `run:${modeName}`, title: `${x.run.id} ${x.node.label}${x.visit > 1 ? ` (visit ${x.visit})` : ""}`, system, text, admissionReceipt, tools, provider: prov,
        ref: x.run.id, project: x.run.params?.project || null, rules, receiptFor: (r: any) => this.deps.instructionReceipt?.(x, x.node.role ?? x.node.args?.role, jobInstructions(system, r), prov), queueLease: true, signal: this.abortOf(x.run).signal, owns: () => this.owns(x) && hashInput(x.pick()) === pickIdentity, maxTools: maxTools ?? 60, timeoutMs: tl * 1000,
        // a sandboxed round reaches its provider's API, plus the hosts policy egress.allow grants (e.g. a package registry)
        record: (() => { const b = briefFor(x); return { dir: join(this.root, x.run.id, "nodes", x.node.id, String(x.visit)), header: { run: x.run.id, node: x.node.id, round: x.visit, attempt: (x.rn.data.jobs ?? []).filter((j: any) => j.round === x.visit && !j.hop).length + (x.rn.data.interrupted ?? []).filter((j: any) => j.round === x.visit).length + (hop ? 0 : 1), head: x.ctx.head ?? null, brief: b?.id ?? null, ledger: b?.ledger ?? [], hop, mode: modeName, roleSkill: use.roleSkill, skills: use.skills } }; })(),
        sandbox: this.roundSandbox(x, mode.sandbox?.(x) ?? null), onStart: (jid: string) => { x.rn.job = jid; x.save(); this.emit(x.run, "agent_started", `${x.node.label}: ${prov.id} · ${prov.model}`, { node: x.node.id, job: jid, provider: prov.id, model: prov.model }); } } as any);
      x.rn.data = { ...x.rn.data, jobs: [...(x.rn.data.jobs ?? []), { id: job.id, round: x.visit, hop, provider: job.provider, model: job.model, status: job.status, cost: job.cost, tools: job.tools, error: job.error, operatingRules: job.operatingRules?.hash ?? null }] };
      if (x.cancelled()) throw new Error("cancelled");
      if (job.status === "cancelled" && x.rn.swap) {
        const to = x.rn.swap; x.rn.swap = null;
        const hdir = join(this.deps.dataDir, "handoff", x.run.id); mkdirSync(hdir, { recursive: true });
        const file = join(hdir, `${x.node.id}.md`);
        const findings = this.ledger(x.run.id).filter((e) => e.verdict === "fail" && e.head === (x.ctx.head ?? null)).flatMap((e) => e.findings.map((f) => `- [${f.class}] ${locatorText(f.locator)}: ${f.message}`));
        handoff = [`# Hand-off: ${x.run.id} · ${x.node.label} (visit ${x.visit})`, "", `From: ${job.provider} · ${job.model}  →  To: ${to.provider}${to.model ? ` · ${to.model}` : ""}`, `Stopped at: ${new Date().toISOString()} after ${job.tools} tool calls`, "",
          "## Inputs (the brief it had)", "", base.slice(0, 6000), "", "## Progress (tool log)", "", ...job.log.filter((l) => l.kind === "tool" || l.kind === "result").slice(-40).map((l) => `- ${l.text}`), "",
          "## What it said", "", job.said.trim().slice(0, 3000) || "(nothing yet)", "", "## Open findings", "", ...(findings.length ? findings.slice(0, 30) : ["(none)"]), "", "## State now", "", mode.handoffState?.(x) ?? "(no extra state)"].join("\n");
        if (existsSync(file)) appendFileSync(file, `\n\n---\n\n${handoff}`); else writeFileSync(file, handoff);
        x.rn.data = { ...x.rn.data, handoff }; x.rn.agent = to;
        const step = [...x.run.steps].reverse().find((s) => s.node === x.node.id && s.state === "running");
        const rel = `handoff/${x.run.id}/${x.node.id}.md`;
        if (step) { step.handoff = rel; step.note = `swapped ${job.provider} → ${to.provider}`; }
        x.save(); this.emit(x.run, "handoff", `${x.node.label}: ${job.provider} stopped, hand-off written, ${to.provider} starts from it`, { node: x.node.id, file: rel, from: job.provider, to: to.provider });
        continue;
      }
      if (job.status === "failed" && /^no result within/.test(job.error ?? "")) {
        // a timeout ends the node failed(cause=timeout); it is never report-only (§3.2)
        this.emit(x.run, "timeout", `${x.node.label}: stopped at the ${tl} s round limit`, { node: x.node.id });
        x.rn.data = { ...x.rn.data, handoff: null };
        await mode.onTimeout?.(x, job);
        this.record(x, "check", { check: "runtime/round-timeout", kind: "deterministic", actor: `${job.provider}·${job.model}`,
          verdict: "fail", score: 0, findings: [{ locator: { type: "card", field: x.node.id }, message: `the round was stopped at its ${tl} s limit`, expected: "finish the round inside the time limit: smaller steps, fewer tool calls", class: "timeout", severity: "blocking", source: "check", check: "runtime/round-timeout" }],
          evidence: [], proves: [], blocking: true, params: { round_timeout_s: tl }, ms: tl * 1000 } as any);
        return "timeout";
      }
      if (job.status !== "done") { const m = job.error ?? `the agent run ${job.status}`; const code = JOB_CODES[(job as any).errorCode ?? ""] ?? null;
        const f = fromError(code ? new FailureError(code, m) : new Error(m), { source: "agent", run: x.run.id, node: x.node.id, visit: x.visit, log: { k: "job", job: job.id, run: x.run.id, node: x.node.id, round: String(x.visit) } });
        throw Object.assign(new Error(m), { failure: f }); }
      x.rn.data = { ...x.rn.data, handoff: null };
      return await mode.after(x, job);
    }
    throw new Error("too many hand-offs in one step");
  }
}
export { locatorText };
/** A role skill as one short label: role (ref) vN · sha256 prefix. */
export function roleSkillName(u: RoleSkillUse): string {
  return `${u.role ?? "role"}${u.ref ? ` (${u.ref})` : ""}${u.version != null ? ` v${u.version}` : ""}${u.sha256 ? ` · ${u.sha256.slice(0, 12)}` : ""}${u.parts?.length ? ` [${u.parts.map((p) => `${p.ref}${p.sha256 ? ` · ${p.sha256.slice(0, 12)}` : ""}`).join(", ")}]` : ""}`;
}
