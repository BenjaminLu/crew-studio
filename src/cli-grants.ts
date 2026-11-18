// External CLI grants (docs/units/cli-mcp-grant.md): the captain lets a plain agent CLI they opened themselves
// (`claude`, codex) start and follow Studio workflow runs over MCP, for one project and a bounded time.
//   data/cli-grants.json   the grant records: id, project, expiry, created, last used, revoked, calls, the runs it
//                          started, and only a SHA-256 of the token
//   data/grants/<id>       the token itself, mode 0600 (directory 0700): `crew-studio mcp --grant-file <path>` reads it,
//                          so it never appears on a command line; removed on revoke
// A grant has a set of scopes: "project" reaches exactly four tools (GRANT_TOOLS); "prs" the pull request list's tools
// (src/pr-watch.ts), which edit Studio's own list and never write to GitHub; "observe" Studio's read tools (src/observe/),
// limited to the kinds the captain picked (a preset or groups, src/observe/grant-scope.ts), to its project, and without
// external text unless the captain ticked it. A grant written before scopes were a set (scope: "prs", or none) is read as
// that one scope and written back as a set. Each grant also has a rolling budget: calls and bytes in the last hour. None answers a card, changes staffing or merges: a run a grant
// starts is a Firstmate-style proposal whose dispatch card only the captain answers, on the board. Every issue, use,
// refusal and revoke is appended to Studio's own event log (data/events.jsonl) through `audit`.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { Engine, Run } from "./runtime/engine";
import { grantableKinds, readObserve, type ObserveScope } from "./observe/grant-scope";
import type { GrantView as ObserveGrant } from "./observe/registry";
import type { CliGrantFile } from "./studio-home";

export const GRANT_TTLS = ["1h", "8h", "eod"] as const;
export type GrantTtl = (typeof GRANT_TTLS)[number];
/** project: start and follow runs in one project (the default, and every grant issued before scopes); prs: read and edit the
 *  pull request list; observe: read Studio (the kinds the captain picked) */
export const GRANT_SCOPES = ["project", "prs", "observe"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];
export type CliGrant = { id: string; /** what the CLI calls it: --grant <name>, ~/.crew-studio/grants/<name>.json (default: the id) */ name?: string; scopes: GrantScope[]; observe?: ObserveScope | null; project: string; ttl: GrantTtl; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null;
  revokedBy: string | null; createdBy: string; calls: number; tokenHash: string; runs: { run: string; at: string; staffing: Record<string, string> | null }[];
  /** the rolling budget's window: each call's time and the bytes it returned (the last hour's only) */
  usage?: { at: number; bytes: number; pending?: true }[]; scope?: GrantScope };
export type GrantView = Omit<CliGrant, "tokenHash" | "usage"> & { state: "active" | "expired" | "revoked"; file: string | null; budget: { calls: number; bytes: number; maxCalls: number; maxBytes: number; usedUp: boolean; freesAt: string | null } };
export type Audit = (type: string, summary: string, data: Record<string, unknown>) => void;
/** What a run started under a grant says about itself: the board's label and its cards' "from an external CLI" line. */
export type ExternalOrigin = { kind: "external-cli"; grant: string; staffing: Record<string, string> | null };

const TOKEN = /^csg_(g-[0-9a-f]{8})_[0-9a-f]{64}$/;
export const GRANT_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** the `by` a grant's proposal run carries: set only by this module's start_run (POST /api/wruns sets the captain's own) */
export const grantBy = (id: string) => `External CLI grant ${id} (captain approval required)`;
const BY = /^External CLI grant (g-[0-9a-f]{8}) \(captain approval required\)$/;
export const grantOfBy = (by: unknown): string | null => typeof by === "string" ? BY.exec(by)?.[1] ?? null : null;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const maxCalls = () => Number(process.env.CREW_CLI_GRANT_MAX_CALLS) || 2000;
/** The rolling budget: at most this many calls, and this many bytes of answers, in any hour. */
export const ROLLING = { windowMs: 3600_000, calls: () => Number(process.env.CREW_CLI_GRANT_HOURLY_CALLS) || 600, bytes: () => Number(process.env.CREW_CLI_GRANT_HOURLY_BYTES) || 4 * 1024 * 1024 };
/** The bytes a call holds against the hourly budget from the moment it is admitted until its answer is counted: the most a
 *  read tool returns (src/observe/registry.ts BUDGET.full). A slow or concurrent caller cannot get past the budget meanwhile. */
export const RESERVE_BYTES = 24_576;
/** What a release from before scopes were a set reads as "no grant": a grant it would misread (observe, or more than one
 *  scope) is stored with this in place of its token's hash, so that release refuses its token (403) instead of treating it
 *  as a project grant; the real hash is in tokenHash2. A plain project grant and a plain "prs" grant stay as that release
 *  wrote them (docs/units/cli-mcp-grant.md "Rolling back"). */
export const NO_OLD_HASH = "x".repeat(64);
const plainOld = (scopes: GrantScope[]) => scopes.length === 1 && (scopes[0] === "project" || scopes[0] === "prs");
/** A record as stored, read: its scopes (a record from before the set: its one scope, none: "project") and its token's hash. */
export function migrateGrant(g: any): CliGrant {
  const { scope, tokenHash2, ...rest } = g ?? {};
  const scopes: GrantScope[] = Array.isArray(g?.scopes) ? g.scopes : [scope === "prs" ? "prs" : "project"];
  return { ...rest, scopes, tokenHash: typeof tokenHash2 === "string" ? tokenHash2 : g?.tokenHash };
}
/** A grant as stored: what an older release can read safely (see NO_OLD_HASH). */
export function storedGrant(g: CliGrant): any {
  const { scope: _s, ...rest } = g as any, scopes = g.scopes ?? ["project"];
  if (plainOld(scopes)) return { ...rest, ...(scopes[0] === "prs" ? { scope: "prs" } : {}) };
  return { ...rest, tokenHash: NO_OLD_HASH, tokenHash2: g.tokenHash };
}
/** A record that is a grant at all: an object with a grant id (anything else in the file is set aside, not read). */
const isRecord = (g: unknown): boolean => !!g && typeof g === "object" && !Array.isArray(g) && /^g-[0-9a-f]{8}$/.test(String((g as any).id ?? "")) && typeof (g as any).tokenHash === "string";

/** When a grant of this length ends: 1 h, 8 h, or the end of the local day. */
export function expiryOf(ttl: GrantTtl, now = new Date()): Date {
  if (ttl === "1h") return new Date(now.getTime() + 3600_000);
  if (ttl === "8h") return new Date(now.getTime() + 8 * 3600_000);
  const d = new Date(now); d.setHours(24, 0, 0, 0); return d;
}

const windowOf = (u: CliGrant["usage"], now = Date.now()) => (u ?? []).filter((x) => now - x.at < ROLLING.windowMs);

export class CliGrants {
  private unknownAt = 0; private unknownQuiet = 0; private overAt = new Map<string, { at: number; quiet: number }>();
  /** cli: where the crew-studio CLI's grant files go (~/.crew-studio/grants) and Studio's address to write in them; none: no
   *  CLI files (an in-process test) */
  constructor(readonly dataDir: string, private audit: Audit = () => {}, private cli: { dir: string; url: () => string } | null = null) { try { this.migrate(); } catch {} }
  /** The CLI grant file of a grant (docs/units/cli.md): ~/.crew-studio/grants/<id>.json. */
  cliFile(id: string) { if (!this.cli) return null; const g = this.read().find((x) => x.id === id); return join(this.cli.dir, `${g?.name ?? id}.json`); }
  private writeCliFile(g: CliGrant, token: string) {
    if (!this.cli) return; const f = join(this.cli.dir, `${g.name ?? g.id}.json`); mkdirSync(this.cli.dir, { recursive: true, mode: 0o700 }); chmodSync(this.cli.dir, 0o700);
    const body: CliGrantFile = { schema: 1, name: g.name ?? g.id, id: g.id, token, scopes: g.scopes, project: g.project || null, expiresAt: g.expiresAt, url: this.cli.url() };
    writeFileSync(f + ".tmp", JSON.stringify(body, null, 1) + "\n", { mode: 0o600 }); chmodSync(f + ".tmp", 0o600); renameSync(f + ".tmp", f);
  }
  private dropCliFile(id: string) { const f = this.cliFile(id); if (f) rmSync(f, { force: true }); }
  private file() { return join(this.dataDir, "cli-grants.json"); }
  tokenFile(id: string) { return join(this.dataDir, "grants", id); }
  private read(): CliGrant[] { try { const j = JSON.parse(readFileSync(this.file(), "utf8")); return Array.isArray(j) ? j.filter(isRecord).map(migrateGrant) : []; } catch { return []; } }
  /** Write back every record in the stored form, once, when one was written before scopes were a set; a record that is no
   *  grant (null, a string, an object without an id) is moved to cli-grants.quarantine.json, with a warning, so the list and
   *  every revoke keep working. */
  migrate(): number { let raw: any[] = []; try { const j = JSON.parse(readFileSync(this.file(), "utf8")); raw = Array.isArray(j) ? j : []; } catch { return 0; }
    const bad = raw.filter((g) => !isRecord(g)), good = raw.filter(isRecord), old = good.filter((g) => !Array.isArray(g.scopes)).length;
    if (bad.length) { const q = join(this.dataDir, "cli-grants.quarantine.json"); let prev: any[] = []; try { prev = JSON.parse(readFileSync(q, "utf8")); } catch {}
      writeFileSync(q, JSON.stringify([...(Array.isArray(prev) ? prev : []), ...bad], null, 1), { mode: 0o600 }); console.warn(`crew-studio: ${bad.length} record(s) in cli-grants.json are no grant; set aside in ${q}`); }
    if (old || bad.length) this.write(good.map(migrateGrant)); return old; }
  private write(all: CliGrant[]) { mkdirSync(this.dataDir, { recursive: true }); const f = this.file(); writeFileSync(f + ".tmp", JSON.stringify(all.map(storedGrant), null, 1), { mode: 0o600 }); renameSync(f + ".tmp", f); }
  private stateOf(g: CliGrant, now = Date.now()): GrantView["state"] { return g.revokedAt ? "revoked" : Date.parse(g.expiresAt) <= now ? "expired" : "active"; }
  get(id: string): CliGrant | null { return this.read().find((g) => g.id === id) ?? null; }
  view(g: CliGrant): GrantView { const { tokenHash: _h, usage, ...rest } = g; const state = this.stateOf(g), u = windowOf(usage);
    const used = { calls: u.length, bytes: u.reduce((n, x) => n + x.bytes, 0) }, full = used.calls >= ROLLING.calls() || used.bytes + RESERVE_BYTES > ROLLING.bytes();
    // the kinds the grant really reads: the stored ones, filtered as the read path filters them (observeGrant)
    const effective = rest.observe ? { ...rest.observe, kinds: observeGrant({ ...g, scopes: ["observe"] })?.kinds ?? [] } : rest.observe;
    return { ...rest, ...(rest.observe ? { observe: effective } : {}), state, file: state === "active" && existsSync(this.tokenFile(g.id)) ? this.tokenFile(g.id) : null,
      budget: { ...used, maxCalls: ROLLING.calls(), maxBytes: ROLLING.bytes(), usedUp: full, freesAt: full && u.length ? new Date(u[0].at + ROLLING.windowMs).toISOString() : null } }; }
  list(): GrantView[] { const all = this.read(); for (const g of all) if (this.stateOf(g) !== "active") { rmSync(this.tokenFile(g.id), { force: true }); this.dropCliFile(g.id); } return all.map((g) => this.view(g)).reverse(); }
  active(id: string) { const g = this.get(id); return !!g && this.stateOf(g) === "active"; }

  /** The captain issues a grant (called only from the board's authenticated, same-site route). */
  issue(o: { project?: string; ttl: string; scope?: string; scopes?: unknown; observe?: unknown; name?: unknown }, by: string): { grant: GrantView; file: string } {
    if (!(GRANT_TTLS as readonly string[]).includes(o.ttl)) throw new Error(`choose an expiry: ${GRANT_TTLS.join(", ")}`);
    // a name the captain gives it (the CLI's --grant <name>): short, lower case, unique among the grants still active
    const name = o.name === undefined || o.name === "" ? null : String(o.name).trim().toLowerCase();
    if (name !== null && !GRANT_NAME.test(name)) throw new Error("a grant's name is 1 to 40 lower-case letters, digits and dashes (it becomes the CLI's --grant name)");
    if (name !== null && this.read().some((x) => (x.name ?? x.id) === name && this.stateOf(x) === "active")) throw new Error(`an active grant is already called ${name}`);
    const asked: unknown[] = o.scopes !== undefined ? (Array.isArray(o.scopes) ? o.scopes : [null]) : [o.scope ?? "project"];
    if (!asked.length || asked.some((x) => !(GRANT_SCOPES as readonly unknown[]).includes(x))) throw new Error(`choose what the grant reaches: ${GRANT_SCOPES.join(", ")}`);
    const scopes = GRANT_SCOPES.filter((x) => asked.includes(x));
    const observe = scopes.includes("observe") ? readObserve(o.observe) : null;
    if (!observe && o.observe !== undefined) throw new Error("observe settings need the observe scope");
    // a project: for its runs, and for reading one project (a "review only" read grant may name none: every room)
    const needsProject = scopes.includes("project") || observe?.preset === "project";
    if (needsProject && (!o.project || typeof o.project !== "string")) throw new Error("choose a project");
    if (!needsProject && !(observe && o.project)) o = { ...o, project: "" };
    const scope = scopes[0];
    const id = `g-${randomBytes(4).toString("hex")}`, token = `csg_${id}_${randomBytes(32).toString("hex")}`, now = new Date();
    const g: CliGrant = { id, ...(name ? { name } : {}), scopes, ...(observe ? { observe } : {}), project: o.project!, ttl: o.ttl as GrantTtl, createdAt: now.toISOString(), expiresAt: expiryOf(o.ttl as GrantTtl, now).toISOString(), lastUsedAt: null,
      revokedAt: null, revokedBy: null, createdBy: by, calls: 0, tokenHash: sha(token), runs: [] };
    const dir = join(this.dataDir, "grants"); mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const f = this.tokenFile(id); writeFileSync(f, token + "\n", { mode: 0o600 }); chmodSync(f, 0o600);
    this.writeCliFile(g, token);
    this.write([...this.read(), g]);
    this.audit("cli_grant_issued", `external CLI grant ${id} issued (${scopes.join(", ")}${g.project ? ` for ${g.project}` : ""}) until ${g.expiresAt}`, { grant: id, scope, scopes, project: g.project, observe: observe ? { preset: observe.preset, kinds: observe.kinds, untrusted: observe.untrusted } : null, expiresAt: g.expiresAt, by });
    return { grant: this.view(g), file: f };
  }

  revoke(id: string, by: string): GrantView {
    const all = this.read(), g = all.find((x) => x.id === id); if (!g) throw new Error("no such grant");
    if (!g.revokedAt) { g.revokedAt = new Date().toISOString(); g.revokedBy = by; this.write(all); }
    rmSync(this.tokenFile(id), { force: true }); this.dropCliFile(id);
    this.audit("cli_grant_revoked", `external CLI grant ${id} revoked`, { grant: id, project: g.project, by });
    return this.view(g);
  }

  /** A token that looks like a grant token (whatever its state): the tool route hands it here, never to another store. */
  static claims(token: string) { return token.startsWith("csg_"); }

  /** The grant a token belongs to, counted as one call; else the HTTP refusal (403 revoked, expired or unknown; 429 over its calls). */
  /** A token's grant without counting a call (the CLI's whoami): the same refusals as use(), no audit, no budget. */
  peek(token: string): { ok: true; grant: GrantView } | { ok: false; status: number; error: string } {
    const m = TOKEN.exec(token), g = m ? this.read().find((x) => x.id === m[1]) : undefined;
    if (!g) return { ok: false, status: 403, error: "no valid external CLI grant" };
    const a = Buffer.from(sha(token)), b = Buffer.from(g.tokenHash); if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 403, error: "no valid external CLI grant" };
    if (g.revokedAt) return { ok: false, status: 403, error: `grant ${g.id} was revoked by the captain at ${g.revokedAt}` };
    if (Date.parse(g.expiresAt) <= Date.now()) return { ok: false, status: 403, error: `grant ${g.id} expired at ${g.expiresAt}` };
    return { ok: true, grant: this.view(g) };
  }
  use(token: string, tool: string): { ok: true; grant: CliGrant } | { ok: false; status: number; error: string; freesAt?: string } {
    const m = TOKEN.exec(token), all = this.read(), g = m ? all.find((x) => x.id === m[1]) : undefined;
    const refuse = (status: number, error: string, why: string) => { if (why === "unknown") { const now = Date.now(); if (now - this.unknownAt < 60_000) { this.unknownQuiet++; return { ok: false as const, status, error }; } this.unknownAt = now; }
      const quiet = why === "unknown" && this.unknownQuiet ? this.unknownQuiet : 0; this.unknownQuiet = 0; this.audit("cli_grant_refused", `external CLI call ${tool} refused: ${why}`, { grant: g?.id ?? null, tool, why, ...(quiet ? { unloggedBefore: quiet } : {}) }); return { ok: false as const, status, error }; };
    if (!g) return refuse(403, "no valid external CLI grant", "unknown");
    const a = Buffer.from(sha(token)), b = Buffer.from(g.tokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return refuse(403, "no valid external CLI grant", "unknown");
    if (g.revokedAt) return refuse(403, `grant ${g.id} was revoked by the captain at ${g.revokedAt}`, "revoked");
    if (Date.parse(g.expiresAt) <= Date.now()) { rmSync(this.tokenFile(g.id), { force: true }); this.dropCliFile(g.id); return refuse(403, `grant ${g.id} expired at ${g.expiresAt}`, "expired"); }
    if (g.calls >= maxCalls()) return refuse(429, `grant ${g.id} reached its limit of ${maxCalls()} calls; ask the captain for a new grant`, "call limit");
    // the bytes of calls still answering are held at RESERVE_BYTES each, so concurrent or slow callers cannot pass the budget
    const now = Date.now(), w = windowOf(g.usage, now), bytes = w.reduce((n, x) => n + x.bytes, 0);
    if (w.length >= ROLLING.calls() || bytes + RESERVE_BYTES > ROLLING.bytes()) { const again = new Date((w[0]?.at ?? now) + ROLLING.windowMs).toISOString();
      const held = w.filter((x) => x.pending).length;
      const error = `grant ${g.id} used its hourly budget (${w.length} of ${ROLLING.calls()} calls, ${bytes} of ${ROLLING.bytes()} bytes in the last hour${held ? `, ${held} of them still answering and holding ${RESERVE_BYTES} bytes each` : ""}; every call holds ${RESERVE_BYTES} bytes up front until its answer is counted); it frees up from ${again}`;
      // one audit line a minute per grant while it is over (with how many were not written), not one per call
      const o = this.overAt.get(g.id); if (o && now - o.at < 60_000) { o.quiet++; return { ok: false, status: 429, error, freesAt: again }; }
      const quiet = o?.quiet ?? 0; this.overAt.set(g.id, { at: now, quiet: 0 });
      this.audit("cli_grant_refused", `external CLI call ${tool} refused: hourly budget`, { grant: g.id, tool, why: "hourly budget", ...(quiet ? { unloggedBefore: quiet } : {}) });
      return { ok: false, status: 429, error, freesAt: again }; }
    g.calls += 1; g.lastUsedAt = new Date(now).toISOString(); g.usage = [...w, { at: now, bytes: RESERVE_BYTES, pending: true }]; this.write(all);
    this.audit("cli_grant_used", `external CLI grant ${g.id} called ${tool}`, { grant: g.id, tool });
    return { ok: true, grant: g };
  }

  /** What a call returned replaces the bytes it held (the oldest call still answering): the hourly budget counts the real size. */
  charge(id: string, bytes: number) { const all = this.read(), g = all.find((x) => x.id === id); if (!g?.usage?.length) return;
    const e = g.usage.find((x) => x.pending) ?? g.usage[g.usage.length - 1]; e.bytes = (e.pending ? 0 : e.bytes) + Math.max(0, Math.round(bytes)); delete e.pending; g.usage = windowOf(g.usage); this.write(all); }
  recordRun(id: string, run: string, staffing: Record<string, string> | null) {
    const all = this.read(), g = all.find((x) => x.id === id); if (!g) return;
    g.runs.push({ run, at: new Date().toISOString(), staffing }); this.write(all);
    this.audit("cli_grant_run", `external CLI grant ${id} proposed ${run} (waits for the captain)`, { grant: id, run, staffing });
  }
  /** A change a grant made to Studio's pull request list, with what it sent (addresses, ids, settings: no secrets), cut to 4 KB. */
  recordEdit(id: string, tool: string, args: unknown) { let sent = JSON.stringify(args ?? {}); if (sent.length > 4096) sent = sent.slice(0, 4096) + "…";
    this.audit("cli_grant_prs_edit", `external CLI grant ${id} changed the pull request list (${tool})`, { grant: id, tool, args: sent }); }
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
  // a proposal Studio raised again (the crew changed) carries the staffing preference of the one the grant started
  let staffing = grants.staffingOf(id, proposal.id);
  if (!staffing) { const g = grants.get(id); for (const x of g?.runs ?? []) { for (let r2 = engine.get(x.run), n = 0; r2 && n < 20; r2 = engine.get(r2.ctx?.crewReraised), n++) if (r2.id === proposal.id) { staffing = x.staffing; break; } if (staffing) break; } }
  return { kind: "external-cli", grant: id, staffing };
}

/** Label every card of a grant's run as coming from an external CLI (a view only: the card itself is unchanged). */
export function installGrantViews(engine: Engine, grants: CliGrants) {
  const prior = engine.cards.view;
  engine.cards.view = (c) => { const v = prior(c); const origin = externalOrigin(engine, grants, engine.get(c.run)); return origin ? { ...v, origin } as any : v; };
  engine.externalOrigin = (r) => externalOrigin(engine, grants, r);
}

/** The pull request list's tools (src/pr-watch.ts `tools`): what a grant of scope "prs" reaches instead of the four. */
export type PrTools = { list(): { name: string; description: string; inputSchema: unknown }[]; call(name: string, args: unknown, grant: string): Promise<unknown>; writes(name: string): boolean };
/** A grant's scopes (a record from before the set: its one scope). */
export const scopesOf = (g: Partial<Pick<CliGrant, "scopes" | "scope">>): GrantScope[] => (Array.isArray(g.scopes) ? g.scopes : [g.scope ?? "project"]);
/** What a grant's read tools reach (src/observe/tools.ts createObserve's grant), or null when it has no observe scope. */
export function observeGrant(g: Pick<CliGrant, "id" | "project" | "observe" | "scopes">): ObserveGrant | null {
  if (!scopesOf(g).includes("observe") || !g.observe) return null;
  // read again against the registry: a kind no grant may read (a hand-edited record) never reaches the tools
  const ok = new Set(grantableKinds()); return { id: g.id, kinds: g.observe.kinds.filter((k) => ok.has(k)), project: g.project || null, untrusted: g.observe.untrusted === true };
}
type ObserveTools = { specs: { name: string; description: string; inputSchema: unknown; outputSchema?: unknown; annotations?: unknown }[]; call(name: string, args: unknown): Promise<unknown> };

export function createGrantTools(d: { engine: Engine; grants: CliGrants; firstmate: () => Firstmate; prs?: () => PrTools | null; observe?: (grant: ObserveGrant) => ObserveTools | null }) {
  const { engine, grants } = d;
  const projectScoped = (def: any) => !!def && Object.hasOwn(def.params ?? {}, "project") && !String(def.id).startsWith("firstmate-");
  /** the runs a grant may read: the proposals it started (recorded here and marked with its id), the work their dispatch
   *  cards started, and a proposal Studio raised again for one of them (the crew changed), all in the grant's project */
  const owned = (g: CliGrant, id: string): Run | null => {
    const mine = new Set(g.runs.map((x) => x.run).filter((x) => grantOfBy(engine.get(x)?.by) === g.id));
    for (const x of [...mine]) for (let again = engine.get(x)?.ctx?.crewReraised, n = 0; typeof again === "string" && n < 20 && grantOfBy(engine.get(again)?.by) === g.id; again = engine.get(again)?.ctx?.crewReraised, n++) mine.add(again);
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
    const owner = { key: `cli-grant:${g.id}:${randomBytes(8).toString("hex")}`, captain: true, text: input.text, live: () => grants.active(g.id), origin: { grant: g.id, staffing } };
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
  const readTools = (g: Pick<CliGrant, "id" | "project" | "observe" | "scopes">) => { const v = observeGrant(g); return v ? d.observe?.(v) ?? null : null; };
  const toolsOf = (g?: Pick<CliGrant, "id" | "project" | "observe" | "scopes" | "scope">): { name: string; description: string; inputSchema: unknown }[] => {
    const sc = g ? scopesOf(g) : (["project"] as GrantScope[]);
    return [...(sc.includes("project") ? GRANT_TOOLS.map((t) => ({ ...t })) : []), ...(sc.includes("prs") ? d.prs?.()?.list() ?? [] : []),
      ...(sc.includes("observe") && g ? (readTools(g as any)?.specs ?? []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations })) : [])];
  };
  return {
    /** the tools a grant reaches, by its scopes: the four run tools, the pull request list's, Studio's read tools; a tool its
     *  scopes do not give is not in the list at all */
    list: toolsOf,
    async call(g: CliGrant, name: string, args: unknown): Promise<unknown> {
      const sc = scopesOf(g);
      if (sc.includes("observe") && (readTools(g)?.specs ?? []).some((t) => t.name === name)) {
        try { return await readTools(g)!.call(name, args); } catch (e: any) { return { error: e?.publicFailure?.reason?.en ?? String(e?.message ?? e), code: e?.publicFailure?.code ?? null }; }
      }
      if (sc.includes("prs") && (d.prs?.()?.list() ?? []).some((t) => t.name === name)) {
        const prs = d.prs?.(); if (!prs) return { error: `no such tool: ${name}` };
        const out: any = await prs.call(name, args, g.id);
        if (prs.writes(name) && !(out && typeof out === "object" && "error" in out)) grants.recordEdit(g.id, name, args);
        return out;
      }
      if (!sc.includes("project")) return { error: `no such tool: ${name} (this grant reaches ${toolsOf(g).map((t) => t.name).join(", ")})` };
      if (name === "list_workflows") return list();
      if (name === "start_run") return start(g, args);
      if (name === "run_status") return status(g, args);
      if (name === "read_cards") return cards(g, args);
      return { error: `no such tool: ${name} (studio exposes ${GRANT_TOOLS.map((t) => t.name).join(", ")})` };
    },
  };
}
