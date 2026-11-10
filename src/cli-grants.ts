// External CLI grants (docs/units/cli-mcp-grant.md): the captain lets a plain agent CLI they opened themselves
// (`claude`, codex) start and follow Studio workflow runs over MCP, for one project and a bounded time.
//   data/cli-grants.json   the grant records: id, project, expiry, created, last used, revoked, calls, the runs it
//                          started, and only a SHA-256 of the token
//   data/grants/<id>       the token itself, mode 0600 (directory 0700): `crew-studio mcp --grant-file <path>` reads it,
//                          so it never appears on a command line; removed on revoke
// A grant token reaches exactly four tools (GRANT_TOOLS). None answers a card, changes staffing or merges: a run a grant
// starts is a Firstmate-style proposal whose dispatch card only the captain answers, on the board. Every issue, use,
// refusal and revoke is appended to Studio's own event log (data/events.jsonl) through `audit`.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { Engine, Run } from "./runtime/engine";

export const GRANT_TTLS = ["1h", "8h", "eod"] as const;
export type GrantTtl = (typeof GRANT_TTLS)[number];
export type CliGrant = { id: string; project: string; ttl: GrantTtl; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null;
  revokedBy: string | null; createdBy: string; calls: number; tokenHash: string; runs: { run: string; at: string; staffing: Record<string, string> | null }[] };
export type GrantView = Omit<CliGrant, "tokenHash"> & { state: "active" | "expired" | "revoked"; file: string | null };
export type Audit = (type: string, summary: string, data: Record<string, unknown>) => void;
/** What a run started under a grant says about itself: the board's label and its cards' "from an external CLI" line. */
export type ExternalOrigin = { kind: "external-cli"; grant: string; staffing: Record<string, string> | null };

const TOKEN = /^csg_(g-[0-9a-f]{8})_[0-9a-f]{64}$/;
/** the `by` a grant's proposal run carries: set only by this module's start_run (POST /api/wruns sets the captain's own) */
export const grantBy = (id: string) => `External CLI grant ${id} (captain approval required)`;
const BY = /^External CLI grant (g-[0-9a-f]{8}) \(captain approval required\)$/;
export const grantOfBy = (by: unknown): string | null => typeof by === "string" ? BY.exec(by)?.[1] ?? null : null;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const maxCalls = () => Number(process.env.CREW_CLI_GRANT_MAX_CALLS) || 2000;

/** When a grant of this length ends: 1 h, 8 h, or the end of the local day. */
export function expiryOf(ttl: GrantTtl, now = new Date()): Date {
  if (ttl === "1h") return new Date(now.getTime() + 3600_000);
  if (ttl === "8h") return new Date(now.getTime() + 8 * 3600_000);
  const d = new Date(now); d.setHours(24, 0, 0, 0); return d;
}

export class CliGrants {
  constructor(readonly dataDir: string, private audit: Audit = () => {}) {}
  private file() { return join(this.dataDir, "cli-grants.json"); }
  tokenFile(id: string) { return join(this.dataDir, "grants", id); }
  private read(): CliGrant[] { try { const j = JSON.parse(readFileSync(this.file(), "utf8")); return Array.isArray(j) ? j : []; } catch { return []; } }
  private write(all: CliGrant[]) { mkdirSync(this.dataDir, { recursive: true }); const f = this.file(); writeFileSync(f + ".tmp", JSON.stringify(all, null, 1), { mode: 0o600 }); renameSync(f + ".tmp", f); }
  private stateOf(g: CliGrant, now = Date.now()): GrantView["state"] { return g.revokedAt ? "revoked" : Date.parse(g.expiresAt) <= now ? "expired" : "active"; }
  get(id: string): CliGrant | null { return this.read().find((g) => g.id === id) ?? null; }
  view(g: CliGrant): GrantView { const { tokenHash: _h, ...rest } = g; const state = this.stateOf(g); return { ...rest, state, file: state === "active" && existsSync(this.tokenFile(g.id)) ? this.tokenFile(g.id) : null }; }
  list(): GrantView[] { return this.read().map((g) => this.view(g)).reverse(); }
  active(id: string) { const g = this.get(id); return !!g && this.stateOf(g) === "active"; }

  /** The captain issues a grant (called only from the board's authenticated, same-site route). */
  issue(o: { project: string; ttl: string }, by: string): { grant: GrantView; file: string } {
    if (!(GRANT_TTLS as readonly string[]).includes(o.ttl)) throw new Error(`choose an expiry: ${GRANT_TTLS.join(", ")}`);
    if (!o.project || typeof o.project !== "string") throw new Error("choose a project");
    const id = `g-${randomBytes(4).toString("hex")}`, token = `csg_${id}_${randomBytes(32).toString("hex")}`, now = new Date();
    const g: CliGrant = { id, project: o.project, ttl: o.ttl as GrantTtl, createdAt: now.toISOString(), expiresAt: expiryOf(o.ttl as GrantTtl, now).toISOString(), lastUsedAt: null,
      revokedAt: null, revokedBy: null, createdBy: by, calls: 0, tokenHash: sha(token), runs: [] };
    const dir = join(this.dataDir, "grants"); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const f = this.tokenFile(id); writeFileSync(f, token + "\n", { mode: 0o600 }); chmodSync(f, 0o600);
    this.write([...this.read(), g]);
    this.audit("cli_grant_issued", `external CLI grant ${id} issued for ${g.project} until ${g.expiresAt}`, { grant: id, project: g.project, expiresAt: g.expiresAt, by });
    return { grant: this.view(g), file: f };
  }

  revoke(id: string, by: string): GrantView {
    const all = this.read(), g = all.find((x) => x.id === id); if (!g) throw new Error("no such grant");
    if (!g.revokedAt) { g.revokedAt = new Date().toISOString(); g.revokedBy = by; this.write(all); }
    rmSync(this.tokenFile(id), { force: true });
    this.audit("cli_grant_revoked", `external CLI grant ${id} revoked`, { grant: id, project: g.project, by });
    return this.view(g);
  }

  /** A token that looks like a grant token (whatever its state): the tool route hands it here, never to another store. */
  static claims(token: string) { return token.startsWith("csg_"); }

  /** The grant a token belongs to, counted as one call; else the HTTP refusal (403 revoked, expired or unknown; 429 over its calls). */
  use(token: string, tool: string): { ok: true; grant: CliGrant } | { ok: false; status: number; error: string } {
    const m = TOKEN.exec(token), all = this.read(), g = m ? all.find((x) => x.id === m[1]) : undefined;
    const refuse = (status: number, error: string, why: string) => { this.audit("cli_grant_refused", `external CLI call ${tool} refused: ${why}`, { grant: g?.id ?? null, tool, why }); return { ok: false as const, status, error }; };
    if (!g) return refuse(403, "no valid external CLI grant", "unknown");
    const a = Buffer.from(sha(token)), b = Buffer.from(g.tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return refuse(403, "no valid external CLI grant", "unknown");
    if (g.revokedAt) return refuse(403, `grant ${g.id} was revoked by the captain at ${g.revokedAt}`, "revoked");
    if (Date.parse(g.expiresAt) <= Date.now()) return refuse(403, `grant ${g.id} expired at ${g.expiresAt}`, "expired");
    if (g.calls >= maxCalls()) return refuse(429, `grant ${g.id} reached its limit of ${maxCalls()} calls; ask the captain for a new grant`, "call limit");
    g.calls += 1; g.lastUsedAt = new Date().toISOString(); this.write(all);
    this.audit("cli_grant_used", `external CLI grant ${g.id} called ${tool}`, { grant: g.id, tool });
    return { ok: true, grant: g };
  }

  recordRun(id: string, run: string, staffing: Record<string, string> | null) {
    const all = this.read(), g = all.find((x) => x.id === id); if (!g) return;
    g.runs.push({ run, at: new Date().toISOString(), staffing }); this.write(all);
    this.audit("cli_grant_run", `external CLI grant ${id} proposed ${run} (waits for the captain)`, { grant: id, run, staffing });
  }
  /** The staffing preference a grant's run was proposed with (shown on its cards; never applied). */
  staffingOf(id: string, run: string) { return this.get(id)?.runs.find((r) => r.run === run)?.staffing ?? null; }
}

// ---------- the four tools a grant token reaches ----------
export const GRANT_TOOLS = [
  { name: "list_workflows", description: "List the Studio workflows this grant may start (those that run in its project), with their declared inputs.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "start_run", description: "Propose a run of a workflow in this grant's project. The run is created waiting for the captain: only the captain's approval on the Studio board starts it. Pass workflow, input {text, title?, params?} and optionally a staffing preference (role → provider), which the captain sees on the card and decides on.",
    inputSchema: { type: "object", required: ["workflow", "input"], additionalProperties: false, properties: { workflow: { type: "string" }, version: { type: "integer" },
      input: { type: "object", required: ["text"], additionalProperties: false, properties: { text: { type: "string", description: "what you want done" }, title: { type: "string" }, params: { type: "object", additionalProperties: { type: "string" } } } },
      staffing: { type: "object", additionalProperties: { type: "string" }, description: "a preference only, e.g. {\"reviewer\": \"codex\"}" } } } },
  { name: "run_status", description: "The state of a run this grant started: state, current node, rounds and tokens so far, and its result when done.", inputSchema: { type: "object", required: ["run"], additionalProperties: false, properties: { run: { type: "string" } } } },
  { name: "read_cards", description: "The open captain cards of a run this grant started. Read-only: cards are answered by the captain on the Studio board, never here.", inputSchema: { type: "object", required: ["run"], additionalProperties: false, properties: { run: { type: "string" } } } },
] as const;

type Firstmate = { call(name: string, args: unknown, owner: any): Promise<unknown> };
const plain = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const ENDED = new Set(["succeeded", "failed", "cancelled"]);
const PROPOSAL = "firstmate-proposal";

/** The board's view of where a run came from: a grant's proposal, or the work its dispatch card started. */
export function externalOrigin(engine: Engine, grants: CliGrants, r: Run | null | undefined): ExternalOrigin | null {
  if (!r) return null;
  let proposal: Run | null | undefined = r;
  if (typeof r.params?._firstmateProposal === "string") proposal = engine.get(r.params._firstmateProposal);
  const id = grantOfBy(proposal?.by); if (!id || !proposal) return null;
  return { kind: "external-cli", grant: id, staffing: grants.staffingOf(id, proposal.id) };
}

/** Label every card of a grant's run as coming from an external CLI (a view only: the card itself is unchanged). */
export function installGrantViews(engine: Engine, grants: CliGrants) {
  const prior = engine.cards.view;
  engine.cards.view = (c) => { const v = prior(c); const origin = externalOrigin(engine, grants, engine.get(c.run)); return origin ? { ...v, origin } as any : v; };
  engine.externalOrigin = (r) => externalOrigin(engine, grants, r);
}

export function createGrantTools(d: { engine: Engine; grants: CliGrants; firstmate: () => Firstmate }) {
  const { engine, grants } = d;
  const projectScoped = (def: any) => !!def && Object.hasOwn(def.params ?? {}, "project") && !String(def.id).startsWith("firstmate-");
  /** the runs a grant may read: the proposals it started (recorded here and marked with its id), the work their dispatch
   *  cards started, and a proposal Studio raised again for one of them (the crew changed), all in the grant's project */
  const owned = (g: CliGrant, id: string): Run | null => {
    const mine = new Set(g.runs.map((x) => x.run).filter((x) => grantOfBy(engine.get(x)?.by) === g.id));
    for (const x of [...mine]) { const again = engine.get(x)?.ctx?.crewReraised; if (typeof again === "string" && grantOfBy(engine.get(again)?.by) === g.id) mine.add(again); }
    const r = engine.get(id); if (!r) return null;
    const ok = mine.has(r.id) || (typeof r.params?._firstmateProposal === "string" && mine.has(r.params._firstmateProposal));
    if (!ok) return null;
    return projectOf(r) === g.project ? r : null;
  };
  const projectOf = (r: Run): string | null => {
    if (r.workflow !== PROPOSAL) return r.params?.project ?? null;
    try { return JSON.parse(r.params.target)?.params?.project ?? null; } catch { return null; }
  };
  const tokensOf = (r: Run) => { let n: number | null = null; const agents = (engine.deps as any).agents;
    for (const s of r.steps) { const j = s.job && agents?.jobs?.get?.(s.job); const c = j?.cost; if (c && (typeof c.inTokens === "number" || typeof c.outTokens === "number")) n = (n ?? 0) + (c.inTokens ?? 0) + (c.outTokens ?? 0); }
    return n; };
  const openCards = (r: Run) => engine.cards.list({ run: r.id, open: true });
  const current = (r: Run) => Object.entries(r.nodes).filter(([, n]) => n.state === "running" || n.state === "waiting").map(([k]) => k)[0] ?? null;
  const stateOf = (r: Run) => r.status === "succeeded" ? "done" : r.status === "failed" ? "failed" : r.status === "cancelled" ? "cancelled" : openCards(r).length ? "awaiting_captain" : r.status;

  function status(g: CliGrant, a: any) {
    if (!plain(a) || typeof a.run !== "string") return { error: "run_status takes {run}" };
    const p = owned(g, a.run); if (!p) return { error: `no run ${a.run} started by grant ${g.id}` };
    const child = p.workflow === PROPOSAL && typeof p.ctx?.childRun === "string" ? engine.get(p.ctx.childRun) : null;
    const r = child ?? p;
    // a proposal closed on its dispatch card ends without work: the captain declined it
    const declined = p.workflow === PROPOSAL && !child && ENDED.has(p.status) && engine.cards.list({ run: p.id }).some((c) => c.node === "dispatch" && c.answer?.choice === "close");
    const waiting = openCards(r).map((c) => c.node);
    return { run: a.run, ...(child ? { task: child.id } : {}), workflow: child ? child.workflow : (() => { try { return JSON.parse(p.params.target).workflow; } catch { return p.workflow; } })(),
      state: declined ? "declined_by_captain" : stateOf(r), node: current(r), ...(waiting.length ? { waiting_on: waiting, answer_on: "board" } : {}),
      rounds: r.steps.filter((s) => s.job).length, tokens: tokensOf(r),
      ...(ENDED.has(r.status) ? { result: r.result, error: r.error } : {}), board: `#/run/${r.id}` };
  }
  function cards(g: CliGrant, a: any) {
    if (!plain(a) || typeof a.run !== "string") return { error: "read_cards takes {run}" };
    const p = owned(g, a.run); if (!p) return { error: `no run ${a.run} started by grant ${g.id}` };
    const child = p.workflow === PROPOSAL && typeof p.ctx?.childRun === "string" ? engine.get(p.ctx.childRun) : null;
    const list = [...openCards(p), ...(child ? openCards(child) : [])];
    return { run: a.run, readOnly: true, note: "Cards are answered by the captain on the Studio board. No tool here can answer them.",
      cards: list.map((c) => ({ card: c.id, run: c.run, node: c.node, kind: c.kind, title: c.title.en, state: c.status, options: c.options.map((o) => o.label), answer_on: "board" })) };
  }
  async function start(g: CliGrant, a: any) {
    if (!plain(a) || Object.keys(a).some((k) => !["workflow", "version", "input", "staffing"].includes(k))) return { error: "start_run takes {workflow, version?, input: {text, title?, params?}, staffing?}" };
    const input = typeof a.input === "string" ? { text: a.input } : a.input;
    if (!plain(input) || typeof input.text !== "string" || !input.text.trim() || Object.keys(input).some((k) => !["text", "title", "params"].includes(k)) || (input.params !== undefined && !plain(input.params)))
      return { error: "input is {text, title?, params?}: text says what you want done" };
    let staffing: Record<string, string> | null = null;
    if (a.staffing !== undefined) {
      if (!plain(a.staffing) || Object.keys(a.staffing).length > 8 || Object.entries(a.staffing).some(([k, v]) => !/^[a-z][\w-]{0,40}$/.test(k) || typeof v !== "string" || !v.trim() || v.length > 80))
        return { error: "staffing is a preference {role: provider}, at most 8 roles" };
      staffing = Object.fromEntries(Object.entries(a.staffing).map(([k, v]) => [k, String(v).trim()]));
    }
    const versions = engine.defs.catalog().filter((w: any) => w.id === a.workflow);
    const def: any = a.version !== undefined ? versions.find((w: any) => w.version === a.version) : versions.at(-1);
    if (!def) return { error: `no workflow ${a.workflow}${a.version !== undefined ? ` v${a.version}` : ""} this grant may start (list_workflows)` };
    if (!projectScoped(def)) return { error: `${def.id} does not run in a project; grant ${g.id} only starts work in ${g.project}` };
    const params: Record<string, string> = { ...(input.params ?? {}) };
    if (params.project !== undefined && params.project !== g.project) return { error: `grant ${g.id} is for project ${g.project}, not ${params.project}` };
    params.project = g.project;
    const owner = { key: `cli-grant:${g.id}:${randomBytes(8).toString("hex")}`, captain: true, text: input.text, live: () => grants.active(g.id), origin: { grant: g.id } };
    let r: any;
    try { r = await d.firstmate().call("studio_propose_work", { workflow: def.id, version: def.version, ...(input.title !== undefined ? { title: input.title } : {}), text: input.text, params }, owner); }
    catch (e: any) { return { error: e?.publicFailure?.reason?.en ?? String(e?.message ?? e), code: e?.publicFailure?.code ?? null }; }
    const id = r?.proposal; if (typeof id !== "string") return { error: "Studio did not create the proposal" };
    grants.recordRun(g.id, id, staffing);
    return { run: id, state: "awaiting_captain", waiting_on: "dispatch", answer_on: "board", board: `#/run/${id}`,
      note: "The run waits for the captain's approval on the Studio board. Nothing starts until then, and no tool here can approve it." };
  }
  function list() {
    return { workflows: engine.defs.catalog().filter(projectScoped).map((w: any) => ({ id: w.id, name: w.displayName ?? w.name, version: w.version, kind: w.kind ?? null, description: w.description ?? "",
      inputs: Object.entries(w.params ?? {}).filter(([k]) => !["project", "repo", "base", "branch", "worktree"].includes(k)).map(([k, s]: [string, any]) => ({ name: k, label: s?.label ?? k, required: !!s?.required })) })) };
  }
  return {
    list: () => GRANT_TOOLS.map((t) => ({ ...t })),
    async call(g: CliGrant, name: string, args: unknown): Promise<unknown> {
      if (name === "list_workflows") return list();
      if (name === "start_run") return start(g, args);
      if (name === "run_status") return status(g, args);
      if (name === "read_cards") return cards(g, args);
      return { error: `no such tool: ${name} (studio exposes ${GRANT_TOOLS.map((t) => t.name).join(", ")})` };
    },
  };
}
