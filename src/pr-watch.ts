// Pull requests (docs/units/pr-watch.md): every open pull request the captain is on, across repositories, what it waits
// for and who, and each merged one until it runs in production. One list, on the top-level page #/prs.
//   GET  /api/prs                  the list (from the last snapshot; never calls GitHub)
//   GET  /api/prs/count            the sidebar count: rows whose next step is approve or merge
//   POST /api/prs/refresh          read GitHub now (the page asks on open; a 5-minute timer asks too)
//   POST /api/prs/watch {url}      a github.com repository or pull request address; POST /api/prs/unwatch {repo}|{pr}
//   POST /api/prs/restore {pr?}    bring excluded pull requests back
//   POST /api/prs/settings         which pull requests, evidence sources, required reviewers, environments, groups
//   POST /api/prs/order {order}    the captain's order; POST /api/prs/deps {pr,on}; POST /api/prs/group {pr,group}
//   POST /api/prs/accept           take the proposal (order and dependencies) as Studio's record
//   POST /api/prs/drift/take {pr}  take the block GitHub now shows as Studio's record
//   POST /api/prs/apply {prs}      starts the captain-only card that writes the dependency block (workflow
//                                  pr-watch-apply-depends); nothing is written to GitHub before the captain approves it
// Reads: GET and GraphQL queries to the GitHub API only (api.github.com; CREW_GITHUB_API may name a loopback test server),
// with the token findToken finds, which never leaves the server. Every address is built here from validated owner, repo
// and number; no address a page or GitHub supplies is fetched. Bodies are bounded (boundedGitHubJSON), lists capped by
// pages, and the timer runs on the shared GitHubPoller under its own key (never a repository's, so it cannot collide with a
// project grant or the dashboard), which backs off after a failed refresh. A rate limit (403/429) fails the refresh.
// State: <data>/pr-watch/state.json (watch list, settings, the captain's order and dependencies, what Studio wrote) and
// <data>/pr-watch/snapshot.json (the last refresh). Writes to GitHub: only the dependency block, only from the card.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boundedGitHubJSON, readAuthority, type GitHubPoller, type ReadAuthority } from "./github-poller";
import { findToken, githubHeaders } from "./github";
import { bundledText } from "./bundled";
import { normalize } from "./runtime/defs";
import { Projects } from "./doors";
import type { Engine, X } from "./runtime/engine";
import * as R from "./pr-watch-rules";
import * as Rel from "./pr-watch-release";
import * as F from "./pr-watch-follow";

export const APPLY_WORKFLOW = "pr-watch-apply-depends", FOLLOW_WORKFLOW = "pr-follow";
export const INTERVAL_MS = 5 * 60_000;
// tests shorten the timer (never below a second); production keeps five minutes
const interval = () => { const v = Number(process.env.CREW_PR_WATCH_INTERVAL_MS); return Number.isFinite(v) && v >= 1000 ? v : INTERVAL_MS; };
const CAPTAIN = /^captain\b/i;
const MAX_BODY = 65536;

// ---------- the GitHub API ----------
/** api.github.com, or a loopback http test server named by CREW_GITHUB_API; anything else is refused. */
export function apiBase(): string {
  const v = (process.env.CREW_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
  if (v === "https://api.github.com") return v;
  let u: URL; try { u = new URL(v); } catch { throw new Error("CREW_GITHUB_API is not an address"); }
  if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && u.pathname === "/" && !u.search) return v;
  throw new Error("CREW_GITHUB_API must be https://api.github.com or a loopback test server");
}
export class RateLimited extends Error { constructor() { super("GitHub rate limit: Studio waits before reading again"); } }
export class HttpError extends Error { constructor(public status: number, public data: any) { super(`GitHub ${status}`); } }
const enc = encodeURIComponent;
const repoPath = (repo: string) => { if (!R.repoOk(repo)) throw new Error("invalid repository"); const [o, r] = repo.split("/"); return `/repos/${o}/${r}`; };
const SHA = /^[0-9a-f]{7,40}$/i;

/** GET answers kept with their ETag: a later identical GET asks If-None-Match, and a 304 (which GitHub does not count
 *  against the rate limit) reuses the kept answer. Bounded; dropped when the token changes. */
/** Kept GET answers by path, bounded by their serialized size (32 MB in all, none over 256 KB), least recently used out. */
export class EtagCache {
  private m = new Map<string, { etag: string; data: any; bytes: number }>(); bytes = 0;
  constructor(readonly maxBytes = 32 * 1024 * 1024, readonly maxEntry = 256 * 1024) {}
  get size() { return this.m.size; }
  get(path: string) { const e = this.m.get(path); if (e) { this.m.delete(path); this.m.set(path, e); } return e; }
  set(path: string, etag: string, data: any) {
    const old = this.m.get(path); if (old) { this.bytes -= old.bytes; this.m.delete(path); }
    const bytes = JSON.stringify(data ?? null).length; if (bytes > this.maxEntry) return;
    this.m.set(path, { etag, data: structuredClone(data), bytes }); this.bytes += bytes;
    for (const [k, v] of this.m) { if (this.bytes <= this.maxBytes) break; this.m.delete(k); this.bytes -= v.bytes; }
  }
  clear() { this.m.clear(); this.bytes = 0; }
}
async function call(api: string, token: string, method: "GET" | "POST" | "PATCH", path: string, body?: unknown, signal?: AbortSignal, etags?: EtagCache): Promise<any> {
  if (!path.startsWith("/") || /(^|\/)\.\.?(\/|\?|$)|[\s#\\]/.test(path)) throw new Error("invalid GitHub path");
  const timeout = AbortSignal.timeout(15_000), kept = method === "GET" ? etags?.get(path) : undefined;
  const r = await fetch(api + path, { method, headers: { ...githubHeaders(token), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(kept ? { "if-none-match": kept.etag } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: "manual" }); // a redirect is never followed (304 is not one)
  if (r.status >= 300 && r.status < 400 && r.status !== 304) { await r.body?.cancel().catch(() => {}); throw new HttpError(r.status, null); }
  if (r.status === 304 && kept) { await r.body?.cancel().catch(() => {}); return structuredClone(kept.data); }
  if (r.status === 429 || (r.status === 403 && (r.headers.get("x-ratelimit-remaining") === "0" || r.headers.has("retry-after")))) { await r.body?.cancel().catch(() => {}); throw new RateLimited(); }
  let data: any = null;
  if (r.status !== 204) { try { data = await boundedGitHubJSON(r); } catch (e) { if (r.ok) throw e; } }
  if (!r.ok) throw new HttpError(r.status, data && typeof data === "object" ? { message: String(data.message ?? "").slice(0, 200) } : null);
  const etag = method === "GET" ? r.headers.get("etag") : null;
  if (etags && etag && etag.length < 200) etags.set(path, etag, data);
  return data;
}
/** A refresh reads at most this many times; past it the refresh fails and the last list stays (src: docs/units/pr-watch.md). */
export const READ_BUDGET = 1500, MAX_ROWS = 60, MAX_MERGED = 40;
export class OverBudget extends Error { constructor() { super(`a refresh would read GitHub more than ${READ_BUDGET} times: watch fewer repositories or pull requests`); } }
/** pages: up to max pages of 100; the list carries capped: true when GitHub has more past the last page read */
type Reader = { get(path: string): Promise<any>; pages(path: string, max: number): Promise<any[] & { capped?: boolean }>; graphql(query: string, variables: Record<string, unknown>): Promise<any> };
function reader(api: string, token: string, signal: AbortSignal | undefined, poller: GitHubPoller | null, authority: ReadAuthority | null, o: { etags?: EtagCache; budget?: { left: number } } = {}): Reader {
  const spend = () => { if (o.budget && --o.budget.left < 0) throw new OverBudget(); };
  const through = (key: string, load: () => Promise<any>) => poller && authority ? poller.read(authority, key, () => { spend(); return load(); }, signal) : (spend(), load());
  const get = (path: string) => through(`GET ${path}`, () => call(api, token, "GET", path, undefined, signal, o.etags));
  return {
    get,
    async pages(path, max) { const out: any[] & { capped?: boolean } = []; const sep = path.includes("?") ? "&" : "?";
      for (let page = 1; page <= max; page++) { const part = await get(`${path}${sep}per_page=100&page=${page}`); const list = Array.isArray(part) ? part : []; out.push(...list); if (list.length < 100) return out; }
      out.capped = true; return out; }, // a full last page: there may be more
    graphql: (query, variables) => through(`POST /graphql ${JSON.stringify(variables)} ${createHash("sha256").update(query).digest("hex").slice(0, 16)}`,
      async () => { const j = await call(api, token, "POST", "/graphql", { query, variables }, signal); if (j?.errors?.length && !j.data) throw new HttpError(200, { message: "GraphQL error" }); return j?.data ?? null; }),
  };
}
const why = (e: any): { en: string; tw: string } => e instanceof HttpError ? (e.status === 404 ? { en: "GitHub shows nothing there to this token (404)", tw: "GitHub 沒有讓這個權杖看到它（404）" } : e.status === 401 ? { en: "GitHub refused the token (401)", tw: "GitHub 拒絕了權杖（401）" } : e.status === 403 ? { en: "the token may not read it (403)", tw: "權杖沒有讀取權限（403）" } : { en: `GitHub answered ${e.status}`, tw: `GitHub 回覆 ${e.status}` })
  : { en: "GitHub could not be reached", tw: "連不上 GitHub" };

// ---------- state ----------
export type Settings = {
  which: { mine: boolean; assigned: boolean; reviewRequested: boolean };
  evidence: R.EvidenceSources; requiredReviewers: string[]; environments: R.EnvSetting[]; groups: string[]; shortForm: boolean;
  messageLang: "en" | "zh-TW" | "zh-CN" | null;
  /** the paths that mean a migration, configuration or a secret, for the release brief (CODEOWNERS-style patterns) */
  opsRules: Rel.OpsRules;
  /** follow-through (docs/units/pr-watch.md "Follow-through"): raise Inbox cards for the watched open pull requests */
  follow: { enabled: boolean };
  /** where cards and briefs may be sent: chat channels (their webhook addresses live apart, in state.hooks), and who a
   *  GitHub account is in a chat tool (for a DM, and for @ in a channel) */
  sending: { targets: { id: string; name: string; tool: F.Tool; use: string }[]; contacts: { gh: string; tool: F.ContactTool; id: string }[]; slackTeam: string | null };
};
export const DEFAULT_SETTINGS: Settings = { which: { mine: true, assigned: true, reviewRequested: false }, evidence: { accounts: [], checks: [], labels: [] }, requiredReviewers: [], environments: [], groups: [], shortForm: false, messageLang: null, opsRules: structuredClone(Rel.DEFAULT_OPS_RULES), follow: { enabled: false }, sending: { targets: [], contacts: [], slackTeam: null } };
/** by: who set it. external-cli: a pull request list grant's prs_deps (grant names which), shown as such until the captain sets it again */
type Dep = { on: string[]; by: "captain" | "accepted" | "github" | "external-cli"; grant?: string; at: string };
export type State = { schema: 1; settings: Settings; watch: { repos: string[]; prs: string[]; excluded: string[] }; order: string[] | null; deps: Record<string, Dep>; applied: Record<string, { block: string; on: string[]; at: string }>; groups: Record<string, string>;
  /** merged pull requests followed until production (key: the id in lower case): when Studio first saw each in every
   *  production environment; and the ones dropped 14 days after that, so they never come back */
  shipped: Record<string, { id: string; mergedAt: string; liveAt: string | null }>; retired: string[];
  /** the follow-through: each open card (by run), the team member picked for a team, the heads the captain said not to
   *  test or not to merge yet, and the comments the captain classified */
  follow: { open: Record<string, FollowOpen>; picks: Record<string, string>; skip: Record<string, string>; hold: Record<string, string>; classified: Record<string, F.NoteKind> };
  /** the send targets' incoming-webhook addresses (secrets: never sent to the browser unmasked) */
  hooks: Record<string, string> };
type FollowOpen = { run: string; card: string | null; pr: string; kind: FollowKind; head: string; at: string };
export type FollowKind = "qa" | "nudge" | "approve" | "merge" | "ask" | "push";
const fresh = (): State => ({ schema: 1, settings: structuredClone(DEFAULT_SETTINGS), watch: { repos: [], prs: [], excluded: [] }, order: null, deps: {}, applied: {}, groups: {}, shipped: {}, retired: [], follow: { open: {}, picks: {}, skip: {}, hold: {}, classified: {} }, hooks: {} });
type Change = { k: "new" } | { k: "head"; sha: string } | { k: "next"; from: string; to: string } | { k: "review"; login: string; state: string } | { k: "evidence"; verdict: string } | { k: "env"; name: string; on: boolean } | { k: "draft"; draft: boolean } | { k: "title" } | { k: "ci"; state: string };
export type RawRow = {
  id: string; repo: string; number: number; url: string; title: string; author: string; draft: boolean; single: boolean; base: string; headRef: string; head: string;
  createdAt: string; labels: string[]; bodyBlock: string | null; githubDeps: string[] | null; bodyMalformed: boolean;
  issues: { ref: string; url: string; title: string | null; state: string | null; external: boolean }[];
  reviews: R.ReviewView[]; approvals: R.Approvals; evidence: R.Evidence | null; ci?: string | null; envs: { name: string; on: boolean | null; production: boolean; auto?: boolean }[];
  facts: R.PrFacts; partial: string[];
  /** each reviewer's latest review with its words (and the inline comments of that review) read by rules: the kind of
   *  request and the sentence that says it (src/pr-watch-follow.ts) */
  notes?: F.Note[];
  /** HTTP routes the diff adds (a QA request cites only these), and the members of each team the rules ask an approval from */
  routes?: F.Route[]; teams?: Record<string, string[]>;
};
/** A merged pull request on its way to production: each environment is on when its commit contains the merge commit. */
export type MergedRow = { id: string; repo: string; number: number; url: string; title: string; author: string; single: boolean; base: string; mergedAt: string; mergeSha: string;
  envs: { name: string; on: boolean | null; production: boolean; auto?: boolean }[]; deps: string[]; body: string; partial: string[];
  /** what it asks for before it goes live (src/pr-watch-release.ts), each with the address it came from */
  ops: Rel.Op[] };
export type Snapshot = { schema: 1; at: string | null; me: string | null; rows: RawRow[]; errors: { target: string; en: string; tw: string }[]; single: Record<string, string>;
  depState: Record<string, string>; proposal: { deps: R.Signal[]; hints: R.Hint[] }; changed: Record<string, { at: string; what: Change[] }>; finger: Record<string, any>;
  /** each row's head and when Studio first saw it: a comment that names no commit covers a head seen before it */
  heads: Record<string, { sha: string; at: string }>;
  /** accounts that may post test evidence, offered when none is set: people who commented on a row's pull request but
   *  are not its author, did not review it, and are not a bot account */
  suggest?: { evidenceAccounts: { login: string; prs: number }[] };
  /** merged pull requests still followed (until 14 days after production) */
  merged?: MergedRow[] };
const emptySnap = (): Snapshot => ({ schema: 1, at: null, me: null, rows: [], errors: [], single: {}, depState: {}, proposal: { deps: [], hints: [] }, changed: {}, finger: {}, heads: {} });

const list = (v: unknown, max = 50, each = 100) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : []).map((s) => String(s ?? "").trim()).filter(Boolean).filter((s) => s.length <= each).slice(0, max);
const login = (s: string) => /^[A-Za-z0-9_.\-[\]]{1,60}$/.test(s);
/** Settings from the page, validated field by field; throws a message the page shows. */
export function cleanSettings(v: any): Settings {
  const s = v && typeof v === "object" ? v : {}, w = s.which ?? {};
  const accounts = list(s.evidence?.accounts).map((a) => a.replace(/^@/, "")), req = list(s.requiredReviewers).map((a) => a.replace(/^@/, ""));
  for (const a of [...accounts, ...req]) if (!login(a)) throw new Error(`"${a}" is not a GitHub account name`);
  const envs: R.EnvSetting[] = (Array.isArray(s.environments) ? s.environments : []).slice(0, 12).map((e: any) => {
    const name = String(e?.name ?? "").trim(), d = e?.detect ?? {}, repos = list(e?.repos, 30);
    if (!name || name.length > 40) throw new Error("Each environment needs a short name");
    for (const r of repos) if (!R.repoOk(r)) throw new Error(`"${r}" is not owner/repo`);
    let detect: R.EnvDetect;
    const txt = (x: unknown, n = 100) => { const t = String(x ?? "").trim(); if (!t || t.length > n || /[\u0000-\u001f]/.test(t)) throw new Error(`${name}: fill in every field of how it is detected`); return t; };
    if (d.kind === "deployment") detect = { kind: "deployment", environment: txt(d.environment) };
    else if (d.kind === "check") detect = { kind: "check", name: txt(d.name) };
    else if (d.kind === "branch") detect = { kind: "branch", branch: txt(d.branch, 200), ...(String(d.environment ?? "").trim() ? { environment: txt(d.environment) } : {}) };
    else if (d.kind === "file") { const repository = txt(d.repository); if (!R.repoOk(repository)) throw new Error(`${name}: the file's repository must be owner/repo`);
      const path = txt(d.path, 300); if (path.split("/").some((p) => !p || p === "." || p === "..")) throw new Error(`${name}: the file path is not a plain path`);
      const template = txt(d.template, 200), bad = R.templateProblem(template); if (bad) throw new Error(`${name}: ${bad}`);
      detect = { kind: "file", repository, path, template, ...(String(d.ref ?? "").trim() ? { ref: txt(d.ref, 200) } : {}) }; }
    else throw new Error(`${name}: choose how it is detected`);
    return { name, production: !!e?.production, repos, detect };
  });
  const lang = ["en", "zh-TW", "zh-CN"].includes(s.messageLang) ? s.messageLang : null;
  const rules = (k: keyof Rel.OpsRules) => { const v = s.opsRules?.[k]; if (v === undefined) return [...Rel.DEFAULT_OPS_RULES[k]];
    const l = list(v, 30, 256); for (const p of l) if (/[\u0000-\u001f]/.test(p) || p.split("/").length > 32) throw new Error(`"${p}" is not a path pattern`); return l; };
  const opsRules = { migration: rules("migration"), config: rules("config"), secret: rules("secret") };
  const sd = s.sending && typeof s.sending === "object" ? s.sending : {}, USES = ["qa", "nudge", "approve", "brief", "any"];
  const targets = (Array.isArray(sd.targets) ? sd.targets : []).slice(0, 12).map((t: any) => {
    const id = String(t?.id ?? "").trim(), name = String(t?.name ?? "").trim(), tool = String(t?.tool ?? ""), use = String(t?.use ?? "any");
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error("A send target needs an id"); if (!name || name.length > 60 || /[\u0000-\u001f]/.test(name)) throw new Error("Each send target needs a short name");
    if (!(F.TOOLS as readonly string[]).includes(tool)) throw new Error(`${name}: choose the chat tool`); if (!USES.includes(use)) throw new Error(`${name}: choose what it is used for`);
    return { id, name, tool: tool as F.Tool, use }; });
  if (new Set(targets.map((t) => t.id)).size !== targets.length) throw new Error("Two send targets have the same id");
  const contacts = (Array.isArray(sd.contacts) ? sd.contacts : []).slice(0, 100).map((c: any) => { const x = { gh: String(c?.gh ?? "").trim().replace(/^@/, ""), tool: String(c?.tool ?? "") as F.ContactTool, id: String(c?.id ?? "").trim() };
    const bad = F.contactProblem(x); if (bad) throw new Error(bad); return x; });
  const slackTeam = String(sd.slackTeam ?? "").trim() || null; if (slackTeam && !/^T[A-Z0-9]{2,20}$/.test(slackTeam)) throw new Error("A Slack workspace id looks like T0123ABCD");
  return { which: { mine: w.mine !== false, assigned: w.assigned !== false, reviewRequested: !!w.reviewRequested },
    evidence: { accounts, checks: list(s.evidence?.checks), labels: list(s.evidence?.labels) }, requiredReviewers: req, environments: envs, groups: list(s.groups, 20, 30), shortForm: !!s.shortForm, messageLang: lang, opsRules, follow: { enabled: !!s.follow?.enabled }, sending: { targets, contacts, slackTeam } };
}

export type PrWatchDeps = { dataDir: string; poller: GitHubPoller; notify?: (type: string, data: unknown) => void; now?: () => number;
  /** tests lower the caps; production uses MAX_ROWS, MAX_MERGED and READ_BUDGET */ limits?: { rows?: number; reads?: number; autoReads?: number; merged?: number } };
/** the cap on reads for a repository's own environments was reached (they are for show: never fails a refresh) */
class OverAuto extends Error {}

/** An action name `act` does not know: the route's 404 (an error GitHub answered with 404 stays the 400 it always was). */
/** the same pull requests, whatever the order or case */
const sameIds = (a: string[], b: string[]) => { const n = (x: string[]) => [...new Set(x.map((i) => i.toLowerCase()))].sort().join(); return n(a) === n(b); };
class NoSuchAction extends Error { constructor(name: string) { super(`no such action: ${name}`); } }

export function createPrWatch(d: PrWatchDeps) {
  const dir = join(d.dataDir, "pr-watch"), stateFile = join(dir, "state.json"), snapFile = join(dir, "snapshot.json");
  const now = d.now ?? (() => Date.now());
  const iso = () => new Date(now()).toISOString();
  const read = <T>(f: string, def: () => T): T => { try { return existsSync(f) ? { ...def(), ...JSON.parse(readFileSync(f, "utf8")) } : def(); } catch { return def(); } };
  const write = (f: string, v: unknown) => { mkdirSync(dir, { recursive: true, mode: 0o700 }); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); renameSync(tmp, f); };
  let state: State = read(stateFile, fresh);
  // saved settings pass the same checks as new ones before anything runs them; an environment that fails is dropped and
  // the page says which (a template saved by an older Studio must never run)
  let settingsWarning: { en: string; tw: string } | null = null;
  { const raw: any = { ...structuredClone(DEFAULT_SETTINGS), ...state.settings }, dropped: string[] = [];
    const envs = (Array.isArray(raw.environments) ? raw.environments : []).filter((e: any) => { try { cleanSettings({ ...raw, environments: [e] }); return true; } catch { dropped.push(String(e?.name ?? "?").slice(0, 40)); return false; } });
    try { state.settings = cleanSettings({ ...raw, environments: envs }); } catch { state.settings = structuredClone(DEFAULT_SETTINGS); dropped.push("(all settings)"); }
    if (dropped.length) settingsWarning = { en: `Saved settings that no longer pass Studio's checks were not used: ${dropped.join(", ")}. Open the settings to set them again.`, tw: `已儲存但不再通過 Studio 檢查的設定沒有使用：${dropped.join("、")}。請打開設定重新設定。` }; }
  let snap: Snapshot = read(snapFile, emptySnap);
  // the proposal is derived from the rows' saved facts: rebuild it on load, so one saved by an older Studio (which proposed
  // every body mention as a dependency) never shows or gets accepted; the captain's own dependencies are in state.json
  if (snap.rows?.length && snap.rows.every((r) => r.facts)) { try { snap.proposal = R.signals(snap.rows.map((r) => r.facts)); } catch { snap.proposal = { deps: [], hints: [] }; } }
  const etags = new EtagCache(); let etagToken = "";
  let version = 0, ranVersion = -1; // the state a refresh reads: a change while one runs asks for another
  const save = () => { version++; write(stateFile, state); };
  const live = { refreshing: false, error: null as null | { en: string; tw: string }, backoffUntil: null as string | null, failures: 0 };
  // its own switch only: CREW_GH=0 turns off the firstmate dashboard's poller, not a list the captain filled in by hand
  const disabled = () => process.env.CREW_PR_WATCH === "0";
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const has = (xs: string[], v: string) => xs.some((x) => eq(x, v));
  let engine: Engine | null = null;

  // ---------- the poller subscription ----------
  let sub: { authority: ReadAuthority; cancel: () => void; token: string } | null = null;
  const authorityFor = (token: string) => readAuthority(apiBase(), "(pr-watch)", { kind: "pr-watch" }, token);
  // the token, looked up at most once a minute (an installed gh is asked through a subprocess)
  let tokenSeen: { at: number; token: string | null } | null = null;
  const tokenNow = () => { if (disabled()) return null; if (!tokenSeen || now() - tokenSeen.at > 60_000) tokenSeen = { at: now(), token: findToken(d.dataDir).token }; return tokenSeen.token; };
  function ensure(): { token: string | null } {
    const any = state.watch.repos.length + state.watch.prs.length > 0, token = any ? tokenNow() : null;
    if (!token || !any) { sub?.cancel(); sub = null; return { token }; }
    if (sub && sub.token === token) return { token };
    sub?.cancel(); sub = null; let authority: ReadAuthority;
    try { authority = authorityFor(token); } catch (e: any) { live.error = { en: String(e?.message ?? e), tw: "CREW_GITHUB_API 只能是 https://api.github.com 或本機測試伺服器" }; return { token: null }; }
    const cancel = d.poller.subscribe(authority, "pr-watch", (signal) => refreshOnce(token, authority, signal), { interval: interval() });
    sub = { authority, cancel, token }; return { token };
  }

  // ---------- one refresh ----------
  async function refreshOnce(token: string, authority: ReadAuthority, signal: AbortSignal) {
    live.refreshing = true; ranVersion = version; d.notify?.("prs", { refreshing: true });
    try {
      if (etagToken !== token) { etags.clear(); etagToken = token; } // kept answers belong to the token that read them
      const g = reader(apiBase(), token, signal, d.poller, authority, { etags, budget: { left: d.limits?.reads ?? READ_BUDGET } });
      const next = await collect(g, signal);
      signal.throwIfAborted();
      // the watch list may have changed while GitHub answered: what was removed meanwhile stays removed
      const w = state.watch, watched = (r: { id: string; repo: string; single: boolean }) => r.single ? has(w.prs, r.id) : has(w.repos, r.repo) && !has(w.excluded, r.id);
      next.rows = next.rows.filter(watched); next.merged = (next.merged ?? []).filter(watched);
      snap = next; write(snapFile, snap); followShipped(next); queueMicrotask(() => { void followUp().catch(() => {}); }); live.error = null; live.backoffUntil = null; live.failures = 0;
    } catch (e: any) {
      if (signal.aborted) return;
      live.failures++; live.backoffUntil = new Date(now() + Math.min(15 * 60_000, interval() * 2 ** Math.min(live.failures, 20))).toISOString();
      live.error = e instanceof RateLimited ? { en: e.message, tw: "GitHub 限流：Studio 會等一下再讀" } : e instanceof OverBudget ? { en: e.message, tw: `一次刷新要讀 GitHub 超過 ${READ_BUDGET} 次：請少追蹤一些 repo 或 PR` } : e instanceof HttpError ? why(e) : { en: "the refresh failed; Studio tries again later", tw: "刷新失敗；Studio 稍後再試" };
      throw e;
    } finally { live.refreshing = false; d.notify?.("prs", { count: count(), at: snap.at }); }
  }

  /** Studio's record of where each merged pull request got to: when it was first seen in every production environment, and
   *  the ones dropped 14 days after that (never picked up again). Written without counting as a change of the watch list. */
  function followShipped(sn: Snapshot) {
    let changed = false;
    for (const r of sn.merged ?? []) { const k = r.id.toLowerCase(), cur = state.shipped[k], st = R.shipState(r.envs), liveAt = st.live ? cur?.liveAt ?? sn.at : null;
      if (!cur || cur.liveAt !== liveAt || cur.mergedAt !== r.mergedAt) { state.shipped[k] = { id: r.id, mergedAt: r.mergedAt, liveAt }; changed = true; } }
    for (const [k, v] of Object.entries(state.shipped)) {
      const sp = R.splitId(v.id), followed = (sn.merged ?? []).some((r) => r.id.toLowerCase() === k) || (!!sp && (has(state.watch.repos, sp.repo) || has(state.watch.prs, v.id)));
      if (v.liveAt && now() - Date.parse(v.liveAt) > R.LIVE_KEEP_MS) { delete state.shipped[k]; state.retired = [...state.retired.filter((x) => x !== k), k].slice(-2000); changed = true; }
      else if (!followed) { delete state.shipped[k]; changed = true; } }
    if (changed) write(stateFile, state);
  }

  async function pool<T, U>(xs: T[], n: number, f: (x: T) => Promise<U>): Promise<U[]> {
    const out: U[] = new Array(xs.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
    return out;
  }
  const soft = async <T>(f: () => Promise<T>, fallback: T, partial?: string[], what?: string): Promise<T> => { try { return await f(); } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget || (e as any)?.name === "AbortError") throw e; if (partial && what) partial.push(what); return fallback; } };

  async function collect(g: Reader, signal: AbortSignal): Promise<Snapshot> {
    const s = state, out = emptySnap(); out.at = iso();
    const me = String((await g.get("/user"))?.login ?? ""); if (!me) throw new HttpError(401, null); out.me = me;
    const found = new Map<string, { pr: any; repo: string; single: boolean }>();
    const keep = (p: any) => { const w = s.settings.which, l = me.toLowerCase();
      return (w.mine && String(p.user?.login ?? "").toLowerCase() === l) || (w.assigned && (p.assignees ?? []).some((a: any) => String(a?.login ?? "").toLowerCase() === l))
        || (w.reviewRequested && (p.requested_reviewers ?? []).some((a: any) => String(a?.login ?? "").toLowerCase() === l)); };
    for (const repo of s.watch.repos) {
      try { for (const p of await g.pages(`${repoPath(repo)}/pulls?state=open`, 3)) { const id = R.prId(repo, Number(p.number)); if (Number.isSafeInteger(p.number) && keep(p) && !has(s.watch.excluded, id)) found.set(id.toLowerCase(), { pr: p, repo, single: false }); } }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; out.errors.push({ target: repo, ...why(e) }); }
    }
    // merged pull requests followed until production: a watched repository's (opened by or assigned to the captain) and
    // the single ones, merged in the last 30 days or already followed, never one dropped after its 14 days in production
    const mergedFound = new Map<string, { pr: any; repo: string; single: boolean }>(), retired = new Set(s.retired.map((x) => x.toLowerCase()));
    const followMerged = (p: any, repo: string, single: boolean) => { const id = R.prId(repo, Number(p?.number)), k = id.toLowerCase();
      if (Number.isSafeInteger(p?.number) && p.merged_at && !retired.has(k) && (s.shipped[k] || Date.parse(String(p.merged_at)) > now() - R.MERGED_WINDOW_MS)) mergedFound.set(k, { pr: p, repo, single }); };
    for (const id of s.watch.prs) { const sp = R.splitId(id); if (!sp) continue;
      try { const p = await g.get(`${repoPath(sp.repo)}/pulls/${sp.number}`); if (p?.state === "open") found.set(id.toLowerCase(), { pr: p, repo: sp.repo, single: true }); else { out.single[id] = p?.merged_at ? "merged" : "closed"; if (p?.merged_at) followMerged(p, sp.repo, true); } }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; out.errors.push({ target: id, ...why(e) }); }
    }
    for (const repo of s.watch.repos) {
      try { const list = await g.get(`${repoPath(repo)}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
        for (const p of Array.isArray(list) ? list : []) if (keep(p) && !has(s.watch.excluded, R.prId(repo, Number(p.number)))) followMerged(p, repo, false); }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; out.errors.push({ target: repo, ...why(e) }); }
    }
    // a followed one GitHub's first page of closed pull requests no longer shows: read on its own (at most 30 a refresh)
    let followReads = 0;
    for (const [k, v] of Object.entries(s.shipped)) { if (mergedFound.has(k) || retired.has(k)) continue; const sp = R.splitId(v.id); if (!sp || !has(s.watch.repos, sp.repo) || ++followReads > 30) continue;
      try { const p = await g.get(`${repoPath(sp.repo)}/pulls/${sp.number}`); if (p?.merged_at && !has(s.watch.excluded, v.id)) followMerged(p, sp.repo, false); }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; } }
    signal.throwIfAborted();
    const rulesCache = new Map<string, Promise<R.Rules>>(), ownersCache = new Map<string, Promise<{ pattern: string; owners: string[] }[] | null | "unreadable">>(), teamCache = new Map<string, Promise<string[] | null>>();
    const issueCache = new Map<string, Promise<{ title: string | null; state: string | null }>>(), fileCache = new Map<string, Promise<string | "missing" | "unreadable">>(), compareCache = new Map<string, Promise<boolean | null>>(), deployCache = new Map<string, Promise<any>>();
    const once = <T>(m: Map<string, Promise<T>>, k: string, f: () => Promise<T>) => { if (!m.has(k)) m.set(k, f()); return m.get(k)!; };
    const rulesFor = (repo: string, base: string) => once(rulesCache, `${repo}|${base}`.toLowerCase(), async () => {
      let rulesets: any[] | null = null, prot: any = null, unreadable: { en: string; tw: string } | null = null, unread: { en: string; tw: string } | null = null;
      try { const r = await g.get(`${repoPath(repo)}/rules/branches/${enc(base)}`); rulesets = Array.isArray(r) ? r : []; }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; unreadable = { en: `the rulesets of ${repo} ${base} could not be read (${why(e).en})`, tw: `讀不到 ${repo} ${base} 的 rulesets（${why(e).tw}）` }; }
      try { prot = await g.get(`${repoPath(repo)}/branches/${enc(base)}/protection`); }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e;
        if (e instanceof HttpError && e.status === 404 && /not protected/i.test(String(e.data?.message ?? ""))) prot = "none";
        // reading classic protection needs admin access: GitHub answers 403, or 404 without "not protected". The rulesets
        // are readable with read access, so they stand, and GitHub's own review decision covers what the protection may add.
        else if (e instanceof HttpError && (e.status === 403 || e.status === 404 && /^not found$/i.test(String(e.data?.message ?? "").trim()))) unread = { en: `the branch protection of ${repo} ${base} could not be read (${why(e).en}; reading it needs admin access): the rulesets and GitHub's own review decision are used`, tw: `讀不到 ${repo} ${base} 的分支保護（${why(e).tw}；需要 admin 權限）：改用 rulesets 和 GitHub 自己的 review 判定` };
        else unreadable ??= { en: `the branch protection of ${repo} ${base} could not be read (${why(e).en}; reading it needs admin access)`, tw: `讀不到 ${repo} ${base} 的分支保護（${why(e).tw}；需要 admin 權限）` }; }
      return R.mergeRules(rulesets, prot, unreadable, repo.split("/")[0], unread);
    });
    // a file's text; "missing" when GitHub says there is none (404), "unreadable" for any other failure
    const fileOf = (repo: string, path: string, ref: string | null) => once(fileCache, `${repo}|${path}|${ref ?? ""}`.toLowerCase(), async (): Promise<string | "missing" | "unreadable"> => {
      try { const j = await g.get(`${repoPath(repo)}/contents/${path.split("/").map(enc).join("/")}${ref ? `?ref=${enc(ref)}` : ""}`);
        if (j?.type !== "file" || j.encoding !== "base64" || typeof j.content !== "string" || Number(j.size) > 200_000) return "unreadable";
        return Buffer.from(j.content, "base64").toString("utf8"); }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return e instanceof HttpError && e.status === 404 ? "missing" : "unreadable"; } });
    const contents = async (repo: string, path: string, ref: string | null) => { const t = await fileOf(repo, path, ref); return t === "missing" || t === "unreadable" ? null : t; };
    // CODEOWNERS: its rules, null when the repository has none, "unreadable" when one could not be read
    const codeownersFor = (repo: string, base: string) => once(ownersCache, `${repo}|${base}`.toLowerCase(), async (): Promise<{ pattern: string; owners: string[] }[] | null | "unreadable"> => {
      for (const p of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) { const t = await fileOf(repo, p, base); if (t === "unreadable") return "unreadable"; if (t !== "missing") { if (R.codeownersOverLimit(t)) return "unreadable";
        // owners GitHub reports as unknown (codeowners/errors) are left out, as GitHub itself ignores them
        const unknown = new Set<string>(); try { const e = await g.get(`${repoPath(repo)}/codeowners/errors?ref=${enc(base)}`);
          for (const x of Array.isArray(e?.errors) ? e.errors : []) if (/unknown owner/i.test(String(x?.kind ?? "")) && typeof x.source === "string") { const tok = x.source.slice(Math.max(0, Number(x.column) - 1)).split(/\s+/)[0]; if (tok) unknown.add(tok.toLowerCase()); } }
        catch (err) { if (err instanceof RateLimited || err instanceof OverBudget) throw err; }
        return R.parseCodeowners(t).map((r) => ({ ...r, owners: r.owners.filter((o) => !unknown.has(o.toLowerCase())) })); } }
      return null; });
    const teamNames = new Map<string, string>(); // a required team named only by id: its org/slug, once looked up
    const members = (key: string, owner: string) => once(teamCache, key.toLowerCase(), async () => {
      try {
        let org = owner, slug: string;
        if (key.startsWith("id:")) { const id = key.slice(3); if (!/^\d{1,12}$/.test(id)) return null; const t = await g.get(`/teams/${id}`); slug = String(t?.slug ?? ""); org = String(t?.organization?.login ?? owner); }
        else if (key.startsWith("slug:")) slug = key.slice(5); else { [org, slug] = key.split("/"); }
        if (!R.NAME.test(org) || !R.NAME.test(slug ?? "")) return null;
        teamNames.set(key.toLowerCase(), `@${org}/${slug}`);
        return (await g.pages(`/orgs/${org}/teams/${slug}/members`, 3)).map((m: any) => String(m?.login ?? "")).filter(Boolean);
      } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return null; } });
    const contains = (repo: string, head: string, deployed: string) => once(compareCache, `${repo}|${head}|${deployed}`.toLowerCase(), async () => {
      if (!SHA.test(head) || !SHA.test(deployed)) return null; if (head.toLowerCase().startsWith(deployed.toLowerCase()) || deployed.toLowerCase().startsWith(head.toLowerCase())) return true;
      try { const c = await g.get(`${repoPath(repo)}/compare/${head}...${deployed}`); return c?.status === "ahead" || c?.status === "identical"; } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return null; } });
    const latestDeploy = (repo: string, q: string) => once(deployCache, `${repo}|${q}`.toLowerCase(), async () => { const l = await g.get(`${repoPath(repo)}/deployments?${q}&per_page=5`); return Array.isArray(l) ? l[0] ?? null : null; });
    // the newest of a query's last five deployments whose latest status is success (or active): its commit
    const successfulCache = new Map<string, Promise<string | null>>();
    const successful = (repo: string, q: string) => once(successfulCache, `${repo}|${q}`.toLowerCase(), async () => {
      const l = await g.get(`${repoPath(repo)}/deployments?${q}&per_page=5`);
      for (const dep of Array.isArray(l) ? l : []) { if (!Number.isSafeInteger(dep?.id) || !SHA.test(String(dep?.sha ?? ""))) continue;
        const st = await g.get(`${repoPath(repo)}/deployments/${dep.id}/statuses?per_page=1`); if (["success", "active"].includes(String(Array.isArray(st) ? st[0]?.state : ""))) return String(dep.sha); }
      return null; });
    /** whether an environment runs `head`; for a merged pull request (`merged`) `head` is its merge commit, and an environment
     *  has it when the commit it runs contains it (a later deployment carries every earlier merge) */
    const envOn = async (e: R.EnvSetting, repo: string, head: string, checks: any[], merged = false): Promise<boolean | null> => {
      try {
        const dt = e.detect;
        if (merged && dt.kind === "deployment") { const dep = await successful(repo, `environment=${enc(dt.environment)}`); return dep ? await contains(repo, head, dep) : false; }
        if (dt.kind === "check") return checks.some((c) => eq(String(c.name), dt.name) && c.status === "completed" && ["success", "neutral"].includes(String(c.conclusion)));
        if (dt.kind === "deployed") { const dep = await deployedOn(repo, dt.environment); if (!dep) return false;
          if (++autoCompares > AUTO_COMPARES) return null; // past the cap a refresh reads no more: shown as not read, never as off
          return await contains(repo, head, dep); }
        if (dt.kind === "deployment") { const dep = await latestDeploy(repo, `environment=${enc(dt.environment)}`); if (!dep || String(dep.sha) !== head || !Number.isSafeInteger(dep.id)) return false;
          const st = await g.get(`${repoPath(repo)}/deployments/${dep.id}/statuses?per_page=1`); return ["success", "active"].includes(String(Array.isArray(st) ? st[0]?.state : "")); }
        if (dt.kind === "branch") { const dep = await latestDeploy(repo, `ref=${enc(dt.branch)}${dt.environment ? `&environment=${enc(dt.environment)}` : ""}`); if (!dep || !Number.isSafeInteger(dep.id)) return false;
          // a failed, pending or inactive deployment of the branch runs nothing: only a successful (or active) one counts
          const st = await g.get(`${repoPath(repo)}/deployments/${dep.id}/statuses?per_page=1`); if (!["success", "active"].includes(String(Array.isArray(st) ? st[0]?.state : ""))) return false;
          return await contains(repo, head, String(dep.sha)); }
        const text = await contents(dt.repository, dt.path, dt.ref ?? null); if (text == null) return null;
        const tag = R.tagCommit(text, dt.template); return tag ? await contains(repo, head, tag) : false;
      } catch (err) { if (err instanceof RateLimited || err instanceof OverBudget) throw err; return null; }
    };
    // a repository's own GitHub environments, used when the settings name none (at most 6, production last)
    const envCache = new Map<string, Promise<R.EnvSetting[]>>();
    const repoEnvs = (repo: string) => once(envCache, repo.toLowerCase(), async () => {
      try { const j = await autoGet(`${repoPath(repo)}/environments?per_page=30`);
        const names = (Array.isArray(j?.environments) ? j.environments : []).map((e: any) => String(e?.name ?? "")).filter((n: string) => n.length > 0 && n.length <= 60 && !/[\u0000-\u001f]/.test(n));
        const prod = (n: string) => /^(?:prod|production|live)(?:$|[-_ ./])/i.test(n); // not preproduction, nonprod
        // each environment on its own: one that cannot be read is left out, the others stay
        const used = (await Promise.all(names.filter((n: string) => n.toLowerCase() !== "github-pages").slice(0, 10).map(async (n: string) => { try { return (await deployedOn(repo, n)) ? n : null; } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return null; } }))).filter((n): n is string => !!n);
        return [...used.filter((n) => !prod(n)), ...used.filter(prod)].slice(0, 6).map((n) => ({ name: n, production: prod(n), repos: [repo], detect: { kind: "deployed" as const, environment: n } })); }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return []; } });
    const commenters = new Map<string, { login: string; prs: Set<string> }>();
    // the newest of an environment's last five deployments whose latest status is success (or active): a deployment still
    // running, or one that failed, leaves the environment on the commit it ran before
    const deployedCache = new Map<string, Promise<string | null>>();
    const deployedOn = (repo: string, env: string) => once(deployedCache, `${repo}|${env}`.toLowerCase(), async () => {
      const l = await autoGet(`${repoPath(repo)}/deployments?environment=${enc(env)}&per_page=5`);
      for (const dep of Array.isArray(l) ? l : []) { if (!Number.isSafeInteger(dep?.id) || !SHA.test(String(dep?.sha ?? ""))) continue;
        const st = await autoGet(`${repoPath(repo)}/deployments/${dep.id}/statuses?per_page=1`); if (["success", "active"].includes(String(Array.isArray(st) ? st[0]?.state : ""))) return String(dep.sha); }
      return null; });
    // a repository's own environments are for show: their reads (environment lists, deployments, statuses, compares)
    // share one cap a refresh, past which a repository shows none and an environment reads "not read"
    let autoCompares = 0, autoReads = 0; const AUTO_COMPARES = 120, AUTO_READS = d.limits?.autoReads ?? 200;
    const autoGet = (path: string) => { if (++autoReads > AUTO_READS) throw new OverAuto(); return g.get(path); };
    let issueReads = 0; // issues named in bodies may be anywhere: at most 60 read per refresh
    const issueOf = (repo: string, n: number) => once(issueCache, `${repo}#${n}`.toLowerCase(), async () => { if (++issueReads > 60) return { title: null, state: null }; try { const j = await g.get(`${repoPath(repo)}/issues/${n}`); return { title: String(j?.title ?? "").slice(0, 300) || null, state: String(j?.state ?? "") || null }; } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return { title: null, state: null }; } });

    // at most MAX_ROWS rows a refresh, the single pull requests first, then the most recently updated
    const ownersByBase = new Map<string, Map<string, string[] | "limit">>(); // code owners per path, shared by the rows of one base
    let picked = [...found.values()]; const maxRows = d.limits?.rows ?? MAX_ROWS;
    if (picked.length > maxRows) { out.errors.push({ target: "", en: `${picked.length} pull requests match: only ${maxRows} are read per refresh (the single ones, then the most recently updated)`, tw: `符合的 PR 有 ${picked.length} 個：每次刷新只讀 ${maxRows} 個（先單獨加入的，再依最近更新）` });
      picked = picked.sort((a, b) => Number(b.single) - Number(a.single) || String(b.pr.updated_at ?? "").localeCompare(String(a.pr.updated_at ?? ""))).slice(0, maxRows); }
    const rows = await pool(picked, 2, async ({ pr: p, repo, single }) => {
      const n = Number(p.number), id = R.prId(repo, n), path = `${repoPath(repo)}`, head = String(p.head?.sha ?? ""), base = String(p.base?.ref ?? ""), author = String(p.user?.login ?? "");
      const partial: string[] = [];
      // a list past the page cap is read as incomplete (the newest entries are the ones left out): the row is held
      const capped = <T extends any[] & { capped?: boolean }>(list: T, what: string): T => { if (list.capped && !partial.includes(what)) partial.push(what); return list; };
      const [reviews, commits, comments, timeline, fileList, checks, gql, inline] = await Promise.all([
        soft(async () => capped(await g.pages(`${path}/pulls/${n}/reviews`, 3), "reviews").map((r: any) => ({ login: String(r.user?.login ?? ""), state: String(r.state ?? ""), commit: r.commit_id ? String(r.commit_id) : null, at: String(r.submitted_at ?? ""), body: String(r.body ?? "").slice(0, 4000), id: Number(r.id) || 0, url: typeof r.html_url === "string" && r.html_url.startsWith(`https://github.com/${repo}/pull/${n}#`) ? r.html_url : null })), [] as (R.Review & { body: string; id: number; url: string | null })[], partial, "reviews"),
        soft(async () => (await g.pages(`${path}/pulls/${n}/commits`, 3)).map((c: any) => ({ sha: String(c.sha ?? ""), at: String(c.commit?.committer?.date ?? c.commit?.author?.date ?? ""), login: String(c.author?.login ?? c.committer?.login ?? ""), author: c.author?.login ? String(c.author.login) : null, committer: c.committer?.login ? String(c.committer.login) : null })), [] as (R.Commit & { login: string; author: string | null; committer: string | null })[], partial, "commits"),
        soft(async () => capped(await g.pages(`${path}/issues/${n}/comments`, 3), "comments").map((c: any) => ({ login: String(c.user?.login ?? ""), body: String(c.body ?? "").slice(0, 65536), at: String(c.created_at ?? ""), url: String(c.html_url ?? "") })), [] as R.EvidenceInput["comments"], partial, "comments"),
        soft(() => g.pages(`${path}/issues/${n}/timeline`, 2), [] as any[], partial, "timeline"),
        soft(async () => (await g.pages(`${path}/pulls/${n}/files`, 3)).map((f: any) => ({ filename: String(f.filename ?? ""), patch: typeof f.patch === "string" ? f.patch.slice(0, 200_000) : null })).filter((f: any) => f.filename), [] as { filename: string; patch: string | null }[], partial, "files"),
        soft(async () => SHA.test(head) ? ((await g.get(`${path}/commits/${head}/check-runs?per_page=100`))?.check_runs ?? []) : [], [] as any[], partial, "checks"),
        soft(async () => { const [o, r] = repo.split("/"); const data = await g.graphql("query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){commits(last:1){nodes{commit{oid statusCheckRollup{state}}}} reviewDecision mergeStateStatus reviewRequests(first:20){nodes{requestedReviewer{__typename ... on User{login} ... on Team{slug organization{login}}}}} closingIssuesReferences(first:20){nodes{number title state url repository{nameWithOwner}}}}}}", { o, r, n });
          return (data?.repository?.pullRequest ?? null) as any; }, null as any, partial, "closing issues"),
        // the inline comments, for what a reviewer's review asks (one page: the newest are what a follow-through reads)
        soft(async () => ((await g.get(`${path}/pulls/${n}/comments?per_page=100&sort=created&direction=desc`)) ?? []).map((c: any) => ({ login: String(c.user?.login ?? ""), body: String(c.body ?? "").slice(0, 4000), review: Number(c.pull_request_review_id) || 0, path: String(c.path ?? ""), line: Number(c.line ?? c.original_line) || null })), [] as { login: string; body: string; review: number; path: string; line: number | null }[], partial, "inline comments"),
      ]);
      const files = fileList.map((f) => f.filename);
      const routes = fileList.flatMap((f) => F.routesIn(f.filename, Rel.patchLines(f.patch).added)).slice(0, 10);
      signal.throwIfAborted();
      const body = String(p.body ?? "");
      // issues: the body's links, closingIssuesReferences, and cross-references in the timeline
      const iss = new Map<string, { repo: string; number: number; title: string | null; state: string | null }>();
      const addIssue = (r: string, num: number, title: string | null = null, st: string | null = null) => { if (!R.repoOk(r) || !Number.isSafeInteger(num) || num < 1) return; const k = `${r}#${num}`.toLowerCase(); const prev = iss.get(k); if (!prev || (!prev.title && title)) iss.set(k, { repo: r, number: num, title: title ?? prev?.title ?? null, state: st ?? prev?.state ?? null }); };
      for (const c of gql?.closingIssuesReferences?.nodes ?? []) addIssue(String(c?.repository?.nameWithOwner ?? ""), Number(c?.number), c?.title ? String(c.title).slice(0, 300) : null, c?.state ? String(c.state).toLowerCase() : null);
      for (const l of R.issueLinks(body)) addIssue(l.repo, l.number);
      for (const ev of timeline) if (ev?.event === "cross-referenced" && ev.source?.issue && !ev.source.issue.pull_request) {
        const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)$/.exec(String(ev.source.issue.html_url ?? "")); if (m) addIssue(m[1], Number(m[2]), String(ev.source.issue.title ?? "").slice(0, 300) || null, String(ev.source.issue.state ?? "") || null); }
      const issues = await Promise.all([...iss.values()].slice(0, 15).map(async (i) => { const got = i.title ? i : { ...i, ...(await issueOf(i.repo, i.number)) };
        return { ref: `${i.repo}#${i.number}`, url: `https://github.com/${i.repo}/issues/${i.number}`, title: got.title, state: got.state, external: !has(s.watch.repos, i.repo) }; }));
      // reviews and the approvals the rules still miss
      const rv = R.latestReviews(reviews, head, author);
      // each reviewer's latest review that says something, with that review's inline comments: its kind and its sentence
      const notes: F.Note[] = rv.filter((v) => !v.author).map((v) => {
        const mine = reviews.filter((x) => x.login.toLowerCase() === v.login.toLowerCase() && String(x.state).toUpperCase() !== "PENDING").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        const last = [...mine].reverse().find((x) => String(x.state).toUpperCase() === v.state) ?? mine.at(-1);
        const text = [last?.body ?? "", ...inline.filter((c) => last && c.review === last.id).map((c) => c.body)].join("\n");
        const fixedBy = commits.filter((c) => Date.parse(c.at) > Date.parse(v.at)).map((c) => c.sha.slice(0, 7)).slice(-3);
        return { login: v.login, state: v.state, at: v.at, url: last?.url ?? null, stale: v.stale, ...F.classifyNote(text), ...(fixedBy.length ? { fixedBy } : {}) }; });
      const rules = base ? await rulesFor(repo, base) : R.mergeRules(null, null, { en: "the base branch is unknown", tw: "不知道 base branch" });
      let owners: { pattern: string; owners: string[] }[] | null = null, ownersUnreadable: { en: string; tw: string } | null = null; const teamMembers = new Map<string, string[] | null>();
      if (rules.readable) {
        if (rules.codeOwners) { const got = await codeownersFor(repo, base);
          if (got === "unreadable") ownersUnreadable = { en: `the CODEOWNERS file of ${repo} could not be read (or is past Studio's limits), so the code owners cannot be checked`, tw: `讀不到 ${repo} 的 CODEOWNERS（或超過 Studio 的上限），無法檢查 code owner` };
          else owners = got;
          const total = Number(p.changed_files);
          if (partial.includes("files") || (Number.isSafeInteger(total) && total > files.length) || files.length >= 300) ownersUnreadable ??= { en: "not every changed file could be read, so the code owners cannot be checked", tw: "沒能讀到所有改動的檔案，無法檢查 code owner" }; }
        const teamKeys = [...rules.teams.map((t) => t.key), ...(owners ?? []).flatMap((o) => o.owners).filter((o) => o.startsWith("@") && o.includes("/")).map((o) => o.slice(1))];
        for (const k of [...new Set(teamKeys.map((k) => k.toLowerCase()))].slice(0, 10)) teamMembers.set(k, await members(k, repo.split("/")[0]));
      }
      const ownersKey = `${repo}|${base}`.toLowerCase(); if (!ownersByBase.has(ownersKey)) ownersByBase.set(ownersKey, new Map());
      // what GitHub's merge box shows: its review decision, merge state and the pending review requests
      const word = (x: unknown) => { const t = String(x ?? ""); return /^[A-Z_]{1,40}$/.test(t) ? t : null; };
      const github: R.GitHubMerge | null = gql ? { reviewDecision: word(gql.reviewDecision), mergeState: word(gql.mergeStateStatus),
        requested: (gql.reviewRequests?.nodes ?? []).map((x: any) => { const v = x?.requestedReviewer ?? {}; return v.__typename === "Team" && R.NAME.test(String(v.organization?.login ?? "")) && R.NAME.test(String(v.slug ?? "")) ? `@${v.organization.login}/${v.slug}` : v.__typename === "User" && R.NAME.test(String(v.login ?? "")) ? String(v.login) : ""; }).filter(Boolean).slice(0, 20) } : null;
      // CI: GitHub's combined state of the head's checks and commit statuses (statusCheckRollup), for this head only
      const tip = gql?.commits?.nodes?.[0]?.commit, ci = tip && String(tip.oid ?? "") === head ? word(tip.statusCheckRollup?.state) ?? "NONE" : null;
      const named: R.Rules = rules.readable ? { ...rules, teams: rules.teams.map((t) => ({ ...t, label: teamNames.get(t.key.toLowerCase()) ?? t.label })) } : rules;
      const approvals = R.approvalsOf(named, rv, { github, ownersCache: ownersByBase.get(ownersKey), files, codeowners: owners, teamMembers, author, headCommit: commits.length && commits.at(-1)!.sha === head && !partial.includes("commits") ? { author: commits.at(-1)!.author, committer: commits.at(-1)!.committer } : null, ownersUnreadable });
      const seen = snap.heads?.[id.toLowerCase()], headSeenAt = seen && seen.sha === head ? seen.at : out.at!;
      out.heads[id.toLowerCase()] = { sha: head, at: headSeenAt };
      const evidence = R.evidenceOf(s.settings.evidence, { comments, labels: (p.labels ?? []).map((l: any) => String(l?.name ?? "")), head, commits, headSeenAt: seen && seen.sha === head ? seen.at : null,
        checks: checks.map((c: any) => ({ name: String(c.name ?? ""), status: String(c.status ?? ""), conclusion: c.conclusion ? String(c.conclusion) : null, at: c.completed_at ? String(c.completed_at) : null, url: c.html_url ? String(c.html_url) : null })) });
      const auto = !s.settings.environments.length, envList = auto ? await repoEnvs(repo) : s.settings.environments.filter((e) => R.envApplies(e, repo));
      const envs = await Promise.all(envList.map(async (e) => ({ name: e.name, production: e.production, on: await envOn(e, repo, head, checks), ...(auto ? { auto: true } : {}) })));
      const reviewers = new Set(reviews.map((x) => x.login.toLowerCase()));
      // without the reviews (or comments) read, reviewers cannot be told apart: such a row offers no one
      if (!partial.includes("reviews") && !partial.includes("comments")) for (const c of comments) { const k = c.login.toLowerCase(); if (!k || k === author.toLowerCase() || k === me.toLowerCase() || reviewers.has(k) || k.endsWith("[bot]") || /(?:^|[-_])bot$|^bot[-_]/.test(k) || !R.NAME.test(c.login)) continue;
        const e = commenters.get(k) ?? { login: c.login, prs: new Set<string>() }; e.prs.add(id); commenters.set(k, e); }
      const block = R.findBlock(body);
      const row: RawRow = { id, repo, number: n, url: `https://github.com/${repo}/pull/${n}`, title: String(p.title ?? "").slice(0, 300), author, draft: !!p.draft, single, base, headRef: String(p.head?.ref ?? ""), head,
        createdAt: String(p.created_at ?? ""), labels: (p.labels ?? []).map((l: any) => String(l?.name ?? "")).filter(Boolean).slice(0, 20),
        bodyBlock: block && block !== "malformed" ? block.text : null, githubDeps: R.blockDeps(body, repo), bodyMalformed: block === "malformed",
        issues, reviews: rv, approvals, evidence, ci, envs, partial, notes, routes,
        teams: Object.fromEntries([...teamMembers].filter(([, m]) => !!m).map(([k, m]) => [teamNames.get(k) ?? k, m!.slice(0, 50)])),
        facts: { id, repo, number: n, body: body.slice(0, 65536), base, headRef: String(p.head?.ref ?? ""), createdAt: String(p.created_at ?? ""), files: files.slice(0, 300), issues: issues.map((i) => i.ref) } };
      return row;
    });
    rows.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    out.rows = rows;
    out.proposal = R.signals(rows.map((r) => r.facts));
    // merged pull requests: each environment from the settings (or the repository's own), on when it has the merge commit
    let mergedList = [...mergedFound.values()].sort((a, b) => String(b.pr.merged_at).localeCompare(String(a.pr.merged_at)));
    const maxMerged = d.limits?.merged ?? MAX_MERGED;
    if (mergedList.length > maxMerged) { out.errors.push({ target: "", en: `${mergedList.length} merged pull requests are followed: only the ${maxMerged} merged last are read per refresh`, tw: `追蹤中的已合併 PR 有 ${mergedList.length} 個：每次刷新只讀最近合併的 ${maxMerged} 個` }); mergedList = mergedList.slice(0, maxMerged); }
    out.merged = (await pool(mergedList, 2, async ({ pr: p, repo, single }): Promise<MergedRow> => {
      const n = Number(p.number), mergeSha = String(p.merge_commit_sha ?? ""), partial: string[] = [], body = String(p.body ?? "").slice(0, 65536);
      const auto = !s.settings.environments.length, envList = auto ? await repoEnvs(repo) : s.settings.environments.filter((e) => R.envApplies(e, repo));
      const checks = SHA.test(mergeSha) && envList.some((e) => e.detect.kind === "check") ? await soft(async () => (await g.get(`${repoPath(repo)}/commits/${mergeSha}/check-runs?per_page=100`))?.check_runs ?? [], [] as any[], partial, "checks") : [];
      const envs = await Promise.all(envList.map(async (e) => ({ name: e.name, production: e.production, on: SHA.test(mergeSha) ? await envOn(e, repo, mergeSha, checks, true) : null, ...(auto ? { auto: true } : {}) })));
      if (!SHA.test(mergeSha)) partial.push("merge commit");
      // the changed files with their patches: what the diff adds is scanned for the release brief's items
      const files = SHA.test(mergeSha) ? await soft(async () => (await g.pages(`${repoPath(repo)}/pulls/${n}/files`, 3)).map((f: any) => ({ filename: String(f.filename ?? ""), status: String(f.status ?? ""), patch: typeof f.patch === "string" ? f.patch.slice(0, 200_000) : null })), [] as Rel.ChangedFile[], partial, "files") : [];
      const ops = SHA.test(mergeSha) ? Rel.opsOf({ id: R.prId(repo, n), repo, number: n, mergeSha: mergeSha.toLowerCase(), body, files }, s.settings.opsRules ?? Rel.DEFAULT_OPS_RULES).slice(0, 40) : [];
      return { id: R.prId(repo, n), repo, number: n, url: `https://github.com/${repo}/pull/${n}`, title: String(p.title ?? "").slice(0, 300), author: String(p.user?.login ?? ""), single, base: String(p.base?.ref ?? ""),
        mergedAt: String(p.merged_at), mergeSha: SHA.test(mergeSha) ? mergeSha.toLowerCase() : "", envs, deps: [...new Set([...(R.blockDeps(body, repo) ?? []), ...R.dependsOnLines(body, repo)])], body, partial, ops };
    })).sort((a, b) => a.mergedAt.localeCompare(b.mergedAt) || a.id.localeCompare(b.id));
    out.suggest = { evidenceAccounts: [...commenters.values()].map((c) => ({ login: c.login, prs: c.prs.size })).sort((a, b) => b.prs - a.prs || a.login.localeCompare(b.login)).slice(0, 6) };
    // the state of every pull request a row may depend on that is not itself a row
    const want = new Set<string>([...out.proposal.deps.map((x) => x.on), ...Object.values(s.deps).flatMap((x) => x.on), ...rows.flatMap((r) => r.githubDeps ?? [])]);
    let depReads = 0; // pull requests named as dependencies outside the list: at most 30 read per refresh
    for (const id of want) { if (rows.some((r) => eq(r.id, id))) continue; const sp = R.splitId(id); if (!sp) continue; if (++depReads > 30) { out.depState[id] = "unread"; continue; }
      try { const p = await g.get(`${repoPath(sp.repo)}/pulls/${sp.number}`); out.depState[id] = p?.merged_at ? "merged" : String(p?.state ?? "unknown"); } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; out.depState[id] = "unreadable"; } }
    // what changed since the last refresh: the mark stays until the next change
    const prevRows = new Map(snap.rows.map((r) => [r.id.toLowerCase(), r]));
    for (const r of viewRows(out, s)) {
      const f = finger(r), before = snap.finger[r.id.toLowerCase()] ?? snap.finger[r.id], what: Change[] = [];
      if (!before) { if (snap.at && !prevRows.has(r.id.toLowerCase())) what.push({ k: "new" }); }
      else {
        if (before.head !== f.head) what.push({ k: "head", sha: f.head.slice(0, 7) });
        if (before.title !== f.title) what.push({ k: "title" });
        if (before.draft !== f.draft) what.push({ k: "draft", draft: f.draft });
        for (const [lg, st] of Object.entries(f.reviews as Record<string, string>)) if (before.reviews?.[lg] !== st) what.push({ k: "review", login: lg, state: st });
        if (before.evidence !== f.evidence) what.push({ k: "evidence", verdict: f.evidence });
        // CI that finishes or fails on the same head (a snapshot from before CI was read has no entry: not a change)
        if ("ci" in before && before.ci !== f.ci && f.ci) what.push({ k: "ci", state: f.ci });
        // an environment that could not be read this time (null) is not a change
        for (const [nm, on] of Object.entries(f.envs as Record<string, boolean | null>)) if (on !== null && (before.envs?.[nm] ?? null) !== on) what.push({ k: "env", name: nm, on: !!on });
        if (before.next !== f.next) what.push({ k: "next", from: before.next, to: f.next });
      }
      out.finger[r.id.toLowerCase()] = f;
      const old = snap.changed[r.id.toLowerCase()];
      if (what.length) out.changed[r.id.toLowerCase()] = { at: out.at!, what }; else if (old) out.changed[r.id.toLowerCase()] = old;
    }
    return out;
  }
  const finger = (r: ReturnType<typeof viewRows>[number]) => ({ head: r.head, title: r.title, draft: r.draft, next: r.next.kind,
    reviews: Object.fromEntries(r.reviews.map((x) => [x.login, `${x.state}${x.stale ? ":stale" : ""}`])), evidence: r.evidence ? `${r.evidence.verdict}:${r.evidence.covers}` : "none",
    envs: Object.fromEntries(r.envs.map((e) => [e.name, e.on])), ci: r.ci ?? null });

  // ---------- the list as the page shows it ----------
  function viewRows(sn: Snapshot, s: State) {
    const rows = sn.rows, rowIds = new Map(rows.map((r) => [r.id.toLowerCase(), r]));
    const projects = (() => { try { return new Projects(d.dataDir).nativeSnapshot().records; } catch { return []; } })();
    const projectOf = (repo: string) => { const p = projects.find((x) => x.github?.repository && eq(x.github.repository, repo)); return p ? { id: p.id, name: p.name || p.id } : null; };
    return rows.map((r) => {
      const key = Object.keys(s.deps).find((k) => eq(k, r.id)), record = key ? s.deps[key] : null;
      const proposed = sn.proposal.deps.filter((x) => eq(x.pr, r.id)).map((x) => ({ on: x.on, why: x.why, kind: x.kind }));
      // no record of Studio's: a valid block on GitHub (written by Studio elsewhere, or before its state was lost) still holds the row
      const fromGithub = !record && !!r.githubDeps?.length, on = record ? record.on : fromGithub ? r.githubDeps! : proposed.map((x) => x.on);
      const depsView = on.map((id) => { const inList = rowIds.get(id.toLowerCase()); const st = inList ? "open" : sn.depState[id] ?? Object.entries(sn.depState).find(([k]) => eq(k, id))?.[1] ?? "unread"; return { id, done: st === "merged", state: st }; });
      const ak = Object.keys(s.applied).find((k) => eq(k, r.id)), applied = ak ? s.applied[ak] : null;
      const drift = applied && R.normBlock(r.bodyBlock) !== R.normBlock(applied.block) ? { github: r.bodyBlock, studio: applied.block, githubDeps: r.githubDeps } : null;
      const stepIn: R.StepInput = { draft: r.draft, author: r.author, reviews: r.reviews, requiredReviewers: s.settings.requiredReviewers, deps: depsView,
        envs: r.envs.filter((e) => !e.auto).map((e) => ({ name: e.name, on: !!e.on, production: e.production })), /* a repository's own environments are shown, never a step */ evidence: r.evidence, evidenceSources: s.settings.evidence, approvals: r.approvals, incomplete: r.partial };
      // the follow-through's reading of the reviewers decides between "fix" and "test" or "look again": the list, the
      // detail and the Inbox card say the same thing
      const next0 = R.nextStep(stepIn), ev = s.settings.evidence;
      const sh = F.shepherd({ draft: r.draft, author: r.author, next: next0, ci: r.ci ?? null, evidence: r.evidence, evidenceSet: !!(ev.accounts.length + ev.checks.length + ev.labels.length), reviews: r.reviews, approvals: r.approvals,
        notes: rowNotes(r), skipEvidence: !!s.follow?.skip?.[`${r.id}@${r.head}`.toLowerCase()] });
      const next = sh.branch === "needs-evidence" || sh.branch === "evidence-covers-head" ? R.nextStep({ ...stepIn, follow: { branch: sh.branch, who: sh.branch === "needs-evidence" ? (ev.accounts.length ? ev.accounts : ["QA"]) : sh.stale ?? [], quote: sh.note?.quote ?? null } }) : next0;
      const gk = Object.keys(s.groups).find((k) => eq(k, r.id));
      const { facts: _f, ...rest } = r;
      const fo = Object.values(s.follow?.open ?? {}).find((o) => eq(o.pr, r.id) && !!o.card);
      // the row's card button only when the card asks for what the row's next step is (one next step per row)
      const fits = fo && ({ qa: ["evidence-asked", "evidence"], nudge: ["re-review"], approve: ["approvals"], merge: ["ready"] } as Record<string, string[]>)[fo.kind]?.includes(next.rule) !== false;
      return { ...rest, project: projectOf(r.repo), group: gk ? s.groups[gk] : null, next, followCard: fo && fits ? { card: fo.card, kind: fo.kind } : null,
        follow: { branch: sh.branch, why: sh.why, quote: sh.note?.quote ?? null, by: sh.note?.login ?? null, stale: sh.stale ?? [] },
        deps: { on: depsView, source: record ? record.by : fromGithub ? "github" : proposed.length ? "proposal" : "none", proposed: record || fromGithub ? [] : proposed, applied: !!applied && !drift && sameIds(applied.on, on), drift },
        changed: sn.changed[r.id.toLowerCase()] ?? null };
    });
  }
  function ordered(rows: ReturnType<typeof viewRows>, sn: Snapshot, s: State) {
    const prop = R.proposeOrder(sn.rows.map((r) => r.facts), rows.flatMap((r) => r.deps.on.map((x) => ({ pr: r.id, on: x.id }))), sn.proposal.hints);
    const pos = (id: string) => prop.findIndex((p) => eq(p.id, id));
    const fixed = (s.order ?? []).map((id) => rows.find((r) => eq(r.id, id))).filter(Boolean) as typeof rows;
    const rest = rows.filter((r) => !fixed.includes(r)).sort((a, b) => pos(a.id) - pos(b.id));
    return { rows: [...fixed, ...rest].map((r, i) => ({ ...r, position: i + 1, proposedPosition: !fixed.includes(r), orderWhy: prop.find((p) => eq(p.id, r.id))?.why ?? [] })), proposal: prop };
  }
  /** The merged pull requests as the page shows them: "merged" (not in every production environment yet) or "live" (in
   *  production, dropped 14 days later), oldest merge first. Each waits on the next environment that does not have it. */
  function mergedRows(sn: Snapshot, s: State) {
    const projects = (() => { try { return new Projects(d.dataDir).nativeSnapshot().records; } catch { return []; } })();
    const projectOf = (repo: string) => { const p = projects.find((x) => x.github?.repository && eq(x.github.repository, repo)); return p ? { id: p.id, name: p.name || p.id } : null; };
    const retired = new Set(s.retired);
    return (sn.merged ?? []).filter((r) => !retired.has(r.id.toLowerCase())).map((r) => {
      const st = R.shipState(r.envs), liveAt = st.live ? s.shipped[r.id.toLowerCase()]?.liveAt ?? sn.at : null;
      const key = Object.keys(s.deps).find((k) => eq(k, r.id)), on = key ? s.deps[key].on : r.deps;
      const { body: _b, ...rest } = r;
      return { ...rest, project: projectOf(r.repo), tab: (st.live ? "live" : "merged") as "live" | "merged", unit: r.repo.split("/")[1],
        ship: { ...st, liveAt, dropAt: liveAt ? new Date(Date.parse(liveAt) + R.LIVE_KEEP_MS).toISOString() : null },
        deps: on.map((id) => { const m = (sn.merged ?? []).find((x) => eq(x.id, id)); return { id, state: m ? (R.shipState(m.envs).live ? "live" : "merged") : rowIdsNow().some((x) => eq(x, id)) ? "open" : "other" }; }) };
    }).filter((r) => !r.ship.dropAt || Date.parse(r.ship.dropAt) > now());
  }
  const sendingView = () => ({ targets: state.settings.sending.targets.map((t) => ({ ...t, masked: state.hooks[t.id] ? F.maskHook(state.hooks[t.id]) : null })) });
  const count = () => viewRows(snap, state).filter((r) => r.next.kind === "approve" || r.next.kind === "merge").length;
  function view() {
    const tok = { token: tokenNow() };
    const { rows, proposal } = ordered(viewRows(snap, state), snap, state);
    const pendingDeps = rows.filter((r) => r.deps.proposed.length).map((r) => ({ pr: r.id, on: r.deps.proposed }));
    const repoCount = (repo: string) => rows.filter((r) => eq(r.repo, repo) && !r.single).length;
    const projects = (() => { try { return new Projects(d.dataDir).nativeSnapshot().records; } catch { return []; } })();
    return {
      enabled: !disabled(), connected: !!tok.token, settingsWarning, me: snap.me, refreshedAt: snap.at, refreshing: live.refreshing, error: live.error, backoffUntil: live.backoffUntil, errors: snap.errors, intervalMs: interval(),
      settings: state.settings, suggest: snap.suggest ?? { evidenceAccounts: [] }, sending: sendingView(),
      watch: { repos: state.watch.repos.map((repo) => { const p = projects.find((x) => x.github?.repository && eq(x.github.repository, repo)); return { repo, count: repoCount(repo), project: p ? { id: p.id, name: p.name || p.id } : null }; }),
        prs: state.watch.prs.map((id) => ({ id, state: snap.single[id] ?? (rows.some((r) => eq(r.id, id)) ? "open" : null) })), excluded: state.watch.excluded },
      rows, rules: R.RULES, count: rows.filter((r) => r.next.kind === "approve" || r.next.kind === "merge").length, merged: mergedRows(snap, state),
      proposal: { pending: pendingDeps.length > 0 || rows.some((r) => r.proposedPosition) && !!rows.length, deps: pendingDeps, order: proposal, accepted: !!state.order },
      connector: { available: false, en: "No messaging connector is connected to Studio: copy the message and send it yourself.", tw: "Studio 沒有接上任何訊息 connector：複製訊息後自己送出。" },
    };
  }

  // ---------- the captain's edits ----------
  const rowIdsNow = () => snap.rows.map((r) => r.id);
  function watchUrl(url: unknown) {
    const p = R.parseGitHubUrl(url); if (p.kind === "error") throw Object.assign(new Error(p.error), { tw: p.tw });
    if (p.kind === "repo") { if (has(state.watch.repos, p.repo)) throw Object.assign(new Error(`Already watching ${p.repo}`), { tw: `已經在追蹤 ${p.repo}` }); if (state.watch.repos.length >= 30) throw new Error("Studio watches at most 30 repositories"); state.watch.repos.push(p.repo); }
    else { const id = R.prId(p.repo, p.number); state.watch.excluded = state.watch.excluded.filter((x) => !eq(x, id)); if (!has(state.watch.prs, id)) { if (state.watch.prs.length >= 100) throw new Error("Studio watches at most 100 single pull requests"); state.watch.prs.push(id); } }
    save(); return p;
  }
  function unwatch(b: any) {
    if (typeof b?.repo === "string") { if (!R.repoOk(b.repo)) throw new Error("Name a watched repository"); state.watch.repos = state.watch.repos.filter((r) => !eq(r, b.repo)); state.watch.excluded = state.watch.excluded.filter((x) => !eq(R.splitId(x)?.repo ?? "", b.repo));
      snap.rows = snap.rows.filter((r) => !eq(r.repo, b.repo) || has(state.watch.prs, r.id)); snap.merged = (snap.merged ?? []).filter((r) => !eq(r.repo, b.repo) || has(state.watch.prs, r.id)); write(snapFile, snap); }
    else if (typeof b?.pr === "string" && R.splitId(b.pr)) { const id = b.pr;
      if (has(state.watch.prs, id)) state.watch.prs = state.watch.prs.filter((x) => !eq(x, id));
      else if (!has(state.watch.excluded, id)) state.watch.excluded.push(id);
      snap.rows = snap.rows.filter((r) => !eq(r.id, id)); snap.merged = (snap.merged ?? []).filter((r) => !eq(r.id, id)); write(snapFile, snap); }
    else throw new Error("Name a repository or a pull request");
    save();
  }
  const validIds = (v: unknown, max = 400) => { if (!Array.isArray(v) || v.length > max) throw new Error("Send a list of pull requests"); const ids = v.map(String); if (ids.some((x) => !R.splitId(x))) throw new Error("A pull request is owner/repo#number"); return ids.filter((x, i) => ids.findIndex((y) => eq(y, x)) === i); }; // a repeated id (any case) counts once

  // ---------- the captain-only card that writes the block ----------
  const pin = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const bodyHash = (b: string) => createHash("sha256").update(String(b ?? "")).digest("hex");
  type Target = { id: string; repo: string; number: number; title: string; on: string[]; block: string; bodyHash: string; current: string | null };
  type Proposal = { schema: 1; targets: Target[]; shortForm: boolean };
  async function startApply(ids: string[], shortForm: boolean) {
    if (!engine) throw new Error("Studio's runtime is not ready yet");
    const token = tokenNow(); if (!token) throw new Error("GitHub is not connected: Studio has no token");
    const def = engine.defs.get(APPLY_WORKFLOW, 1); if (!def) throw new Error("The apply workflow is missing");
    const rows = viewRows(snap, state), g = reader(apiBase(), token, undefined, null, null), targets: Target[] = [];
    for (const id of ids) {
      const r = rows.find((x) => eq(x.id, id)); if (!r) throw new Error(`${id} is not in the list`);
      const on = r.deps.on.map((x) => x.id);
      const p = await g.get(`${repoPath(r.repo)}/pulls/${r.number}`), body = String(p?.body ?? "");
      const problem = R.blockProblem(body); if (problem) throw new Error(`${id}: ${problem}`);
      const found = R.findBlock(body);
      // no dependency left: the card removes the block GitHub still has (nothing to do when there is none)
      if (!on.length && !(found && found !== "malformed")) throw new Error(`${id} has no dependency to write and no block on GitHub to remove`);
      const block = on.length ? R.renderBlock(on, r.repo, shortForm) : "";
      // Studio never writes a block it would itself refuse to replace later (blockProblem's 4000-character limit)
      if (block.length > R.BLOCK_MAX) throw new Error(`${id}: ${on.length} dependencies make a block of ${block.length} characters; at most ${R.BLOCK_MAX} fit. Remove some first.`);
      if (block && R.replaceBlock(body, block).length > MAX_BODY) throw new Error(`${id}: the body would exceed GitHub's limit`);
      targets.push({ id: r.id, repo: r.repo, number: r.number, title: r.title, on, block, bodyHash: bodyHash(body), current: found && found !== "malformed" ? found.text.slice(0, 4000) : null });
    }
    const proposal: Proposal = { schema: 1, targets, shortForm };
    const params = { proposal: JSON.stringify(proposal) };
    const open = engine.list().find((x) => x.workflow === APPLY_WORKFLOW && x.params.proposal === params.proposal && !["succeeded", "failed", "cancelled"].includes(x.status));
    if (open) return open;
    const label = targets.map((t) => t.id).join(", ");
    return engine.start({ workflow: APPLY_WORKFLOW, version: def.version, text: `Write the dependency block into ${label}`, title: `Apply dependencies: ${label}`.slice(0, 120), params, by: "captain (Pull requests page)" } as any);
  }
  function checkProposal(x: X, source: any): Proposal {
    if (x.run.def.id !== APPLY_WORKFLOW || pin(x.run.def.nodes) !== pin(source.nodes) || pin(x.run.def.edges) !== pin(source.edges)) throw new Error("The installed apply workflow changed");
    const p = JSON.parse(String(x.run.params.proposal ?? "null")) as Proposal;
    if (p?.schema !== 1 || !Array.isArray(p.targets) || !p.targets.length || p.targets.length > 50) throw new Error("The apply proposal is malformed");
    for (const t of p.targets) { const sp = R.splitId(t.id);
      if (!sp || !eq(sp.repo, t.repo) || sp.number !== t.number || !Array.isArray(t.on) || t.on.some((o) => !R.splitId(o)) || t.block !== (t.on.length ? R.renderBlock(t.on, t.repo, !!p.shortForm) : "") || (!t.on.length && !t.current) || t.block.length > R.BLOCK_MAX || !/^[a-f0-9]{64}$/.test(t.bodyHash) || !(t.current === null || typeof t.current === "string"))
        throw new Error("The apply proposal is malformed"); }
    return p;
  }
  function install(e: Engine) {
    engine = e;
    const source = normalize(JSON.parse(bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`) || "null"));
    const previous = e.deps.authorizeAnswer;
    e.deps.authorizeAnswer = (run: any, card: any, answer: any) => {
      previous?.(run, card, answer);
      if (run?.workflow === APPLY_WORKFLOW && card?.node === "card" && !CAPTAIN.test(String(answer?.by ?? ""))) throw new Error("Only the captain approves a write to a pull request body");
      // a follow-through card: the captain, or Studio itself when GitHub shows what the card waits for; never Firstmate
      if (run?.workflow === FOLLOW_WORKFLOW && !CAPTAIN.test(String(answer?.by ?? "")) && !(answer?.by === "studio (GitHub)" && answer?.choice === "auto")) throw new Error("Only the captain answers a follow-through card");
    };
    e.actions["pr-watch.apply-card"] = async (x) => {
      const p = checkProposal(x, source), n = p.targets.length, repos = [...new Set(p.targets.map((t) => t.repo))];
      const body = p.targets.flatMap((t) => [`Repository / 儲存庫: ${t.repo}`, `Pull request: https://github.com/${t.repo}/pull/${t.number}${t.title ? ` (${t.title})` : ""}`,
        ...(t.current ? ["Block on GitHub now, which this replaces / GitHub 上現在的區塊（會被取代）:", t.current] : ["No block on GitHub yet: it is added at the end / GitHub 上還沒有區塊：會加在尾端"]),
        ...(t.block ? ["Block written / 寫入的區塊:", t.block] : ["No dependency left: the block is removed / 沒有依賴了：移除這個區塊"]), ""]).concat([
        "Studio replaces only this marked block (or adds it at the end) and changes nothing else in the body. It reads the body again right before writing; a body that changed since this card is left alone.",
        "Studio 只取代這段帶標記的區塊（沒有就加在尾端），body 其他內容一律不動。寫入前會再讀一次 body；如果它在這張卡片之後被改過，就不寫入。"]).join("\n");
      await e.card(x, "permission", { captainOnly: true, title: `Write the dependency block into ${n === 1 ? p.targets[0].id : `${n} pull requests`}?`, zhTitle: `把依賴區塊寫進 ${n === 1 ? p.targets[0].id : `${n} 個 pull request`} 嗎？`,
        en: { why: `Studio writes one marked block at the end of ${n === 1 ? "this pull request's body" : "each pull request body"} below, in ${repos.join(", ")}, so the order you set is visible on GitHub.`, how: "Write it, or close without writing. Every refresh afterwards compares the block on GitHub with Studio's record.",
          scope: { in: p.targets.map((t) => `${t.repo}#${t.number}: the crew-studio:depends block only`), out: ["Any other text in the body", "Labels, reviews, comments, merging", "Any other pull request or repository"] } },
        zh: { why: `Studio 會在下列${n === 1 ? "這個 pull request" : "每個 pull request"}（${repos.join("、")}）的 body 尾端寫入一段帶標記的區塊，讓你訂的順序在 GitHub 上看得到。`, how: "寫入，或關閉、不寫。之後每次刷新都會比對 GitHub 上的區塊和 Studio 的紀錄。",
          scope: { in: p.targets.map((t) => `${t.repo}#${t.number}：只有 crew-studio:depends 區塊`), out: ["body 的其他文字", "label、review、留言、合併", "其他 pull request 或 repo"] } },
        body, options: [{ id: "apply", label: `Write the block (${n})`, labelZh: `寫入區塊（${n}）`, primary: true }, { id: "close", label: "Close without writing", labelZh: "關閉，不寫入", hold: true }] });
      return { wait: true };
    };
    // the follow-through: one card per Task of pr-follow, answered by the captain, or by Studio when GitHub shows what it waits for
    e.actions["pr-follow.card"] = async (x) => {
      const f = JSON.parse(String(x.run.params.follow ?? "null"));
      if (x.run.def.id !== FOLLOW_WORKFLOW || f?.schema !== 1 || !R.splitId(String(f.pr)) || !(f.kind in KIND_LABEL)) throw new Error("The follow-through card is malformed");
      const r = viewRows(snap, state).find((v) => eq(v.id, f.pr)); if (!r) { delete state.follow.open[x.run.id]; write(stateFile, state); return { outcome: "done", note: `${f.pr} is no longer an open watched pull request` }; }
      const sh: F.Shepherd = f.kind === "push" ? { branch: "code-change", why: { en: "a push is about to happen", tw: "準備 push" } } : shepherdOf(r);
      const p: any = followPayload(f.kind, r, sh, { quote: f.quote ?? null, by: f.by ?? null, tests: f.tests === true, voids: f.voids ?? null, who: f.who ?? [] }); p.history = [hist("card raised", "出卡", true)];
      const c = await e.card(x, "question", { title: p.heading.en, zhTitle: p.heading.tw, en: { why: p.lead.en, how: p.autoClose.en }, zh: { why: p.lead.tw, how: p.autoClose.tw }, body: p.message?.en ?? p.lead.en,
        options: p.opts.map((o: any) => ({ id: o.id, label: o.label.en, labelZh: o.label.tw, ...(o.keep ? { hold: true } : {}), ...(o.note ? { note: true, noteLabel: "Why", noteLabelZh: "理由" } : {}) })).concat([
          // how Studio closes the card when GitHub shows what it waits for (the follow-through layout does not offer it)
          { id: "auto", label: "Close: GitHub shows it is done", labelZh: "關閉：GitHub 上已經好了", hold: true }]), follow: p });
      state.follow.open[x.run.id] ??= { run: x.run.id, card: null, pr: r.id, kind: f.kind, head: r.head, at: iso() }; state.follow.open[x.run.id].card = c.id; write(stateFile, state);
      return { wait: true };
    };
    // the same branch for the github-review workflow's own PR 跟進 node (that workflow is still draft-only: these run once
    // its runtime is activated). The run's pull request must be a watched one; a branch that waits holds the node.
    const runPr = (x: X) => { const u = String(x.ctx?.pr?.url ?? x.ctx?.pullRequest?.url ?? x.run.params.pr ?? ""), m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)$/.exec(u);
      const r = m ? viewRows(snap, state).find((v) => eq(v.id, `${m[1]}#${m[2]}`)) : null; if (!r) throw new Error("PR follow-through reads this run's pull request from the Pull requests page: watch it there first"); return r; };
    e.actions["pr.shepherd"] = async (x) => { const sh = shepherdOf(runPr(x)); if (sh.branch === "wait") throw new Error(`PR follow-through waits: ${sh.why.en}`); return { outcome: sh.branch === "ask" ? "missing-approvals" : sh.branch, note: sh.why.en }; };
    e.actions["pr.track-deploy"] = async (x) => { const u = String(x.ctx?.pr?.url ?? x.run.params.pr ?? ""), m = mergedRows(snap, state).find((r) => r.url === u);
      if (!m) throw new Error("Follow to production reads the merged pull request from the Pull requests page: watch it there first"); if (m.tab !== "live") throw new Error(`Not in production yet: waits on ${m.ship.waits ?? "a production environment"}`); return { outcome: "ok" }; };
    e.actionAnswers["pr-follow.card"] = async (x, card) => {
      const f = JSON.parse(String(x.run.params.follow ?? "null")), choice = String(card.answer?.choice ?? ""), key = (k: string) => `${f.pr}@${f.head}@${k}`.toLowerCase();
      if (f.kind === "qa" && (choice === "skip" || choice === "code")) state.follow.hold[key("qa")] = choice === "skip" ? `skip: ${card.answer?.note ?? ""}` : "code";
      if (f.kind === "qa" && choice === "skip") state.follow.skip[`${f.pr}@${f.head}`.toLowerCase()] = String(card.answer?.note ?? "");
      if (f.kind === "nudge" && choice === "more") state.follow.hold[key("nudge")] = "more evidence";
      if ((f.kind === "merge" || f.kind === "ask") && choice === "hold") state.follow.hold[key(f.kind)] = "hold";
      if (f.kind === "ask" && ["code-change", "needs-evidence", "non-blocking"].includes(choice) && card.follow?.note) state.follow.classified[`${f.pr}@${card.follow.note.login}@${card.follow.note.at}`.toLowerCase()] = choice as F.NoteKind;
      delete state.follow.open[x.run.id]; write(stateFile, state); queueMicrotask(() => { void followUp().catch(() => {}); });
      return { outcome: "done", note: `${choice}${card.answer?.note ? `: ${card.answer.note}` : ""}` };
    };
    e.actionAnswers["pr-watch.apply-card"] = async (_x, card) => ({ outcome: card.answer?.choice === "apply" ? "apply" : "close" });
    e.actions["pr-watch.apply-write"] = async (x) => {
      const p = checkProposal(x, source);
      const card = e.cards.list({ run: x.run.id }).filter((c) => c.node === "card" && c.status === "answered").at(-1), trusted = e.trusted(x.run.id);
      const entry: any = card && trusted.entries.filter((en: any) => en.record === "card-answer" && en.data?.card === card.id).at(-1);
      if (!card?.captainOnly || !trusted.ok || !entry || entry.data?.choice !== "apply" || card.answer?.choice !== "apply" || !CAPTAIN.test(String(entry.actor ?? "")) || !CAPTAIN.test(String(card.answer?.by ?? "")) || !e.owns(x) || x.cancelled())
        throw new Error("The captain's answer on this card is unavailable");
      const token = findToken(d.dataDir).token; if (!token) throw new Error("GitHub is not connected: Studio has no token");
      const api = apiBase(), written: string[] = [], refused: { id: string; why: string }[] = [];
      // the Task may end (cancelled, deleted) while GitHub answers: checked after every await and before every write
      const ended = () => x.cancelled() || !e.owns(x);
      for (const t of p.targets) {
        if (ended()) { refused.push({ id: t.id, why: "the Task ended before this write" }); continue; }
        try {
          const path = `${repoPath(t.repo)}/pulls/${t.number}`, cur = await call(api, token, "GET", path), body = String(cur?.body ?? "");
          if (ended()) { refused.push({ id: t.id, why: "the Task ended before this write" }); continue; }
          if (bodyHash(body) !== t.bodyHash) { refused.push({ id: t.id, why: "the body changed on GitHub since the card; apply again" }); continue; }
          const next = t.block ? R.replaceBlock(body, t.block) : R.removeBlock(body); if (next.length > MAX_BODY) { refused.push({ id: t.id, why: "the body would exceed GitHub's limit" }); continue; }
          const out = await call(api, token, "PATCH", path, { body: next });
          // GitHub has no conditional write for a body: an edit between the read and the write shows as a different answer
          // GitHub may hand the body back with its line endings or trailing spaces normalised: compare after normalising
          // those, and the block itself exactly (line endings aside)
          const flat = (t: string) => t.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trimEnd();
          const keptBlock = R.findBlock(String(out?.body ?? "")), sameBlock = t.block ? !!keptBlock && keptBlock !== "malformed" && keptBlock.text.replace(/\r\n/g, "\n") === t.block : !keptBlock;
          if (flat(String(out?.body ?? "")) !== flat(next) || !sameBlock) { refused.push({ id: t.id, why: "the body GitHub kept differs from what Studio wrote (edited at the same moment?); check it on GitHub and apply again" }); continue; }
          const k = Object.keys(state.applied).find((a) => eq(a, t.id)) ?? t.id; if (t.block) state.applied[k] = { block: t.block, on: t.on, at: iso() }; else delete state.applied[k];
          // the record follows the card only while it is still the one the card was made from: a change since (the board, a CLI) stays
          const dk = Object.keys(state.deps).find((a) => eq(a, t.id)) ?? t.id, rec = state.deps[dk]; if (!rec || sameIds(rec.on, t.on)) state.deps[dk] = { on: t.on, by: "captain", at: iso() };
          written.push(t.id);
        } catch (err: any) { refused.push({ id: t.id, why: err instanceof HttpError ? why(err).en : "GitHub could not be reached" }); }
      }
      save();
      e.record(x, "pr-watch-apply", { actor: String(entry.actor), data: { schema: 1, card: card.id, answerSeq: entry.seq, written, refused } } as any);
      x.rn.note = `Wrote the dependency block into ${written.length ? written.join(", ") : "no pull request"}${refused.length ? `; not written: ${refused.map((r) => `${r.id} (${r.why})`).join("; ")}` : ""}`;
      queueMicrotask(() => { void refresh().catch(() => {}); });
      return "ok";
    };
  }

  // ---------- the follow-through (docs/units/pr-watch.md "Follow-through") ----------
  // After every refresh each watched open pull request is read again by src/pr-watch-follow.ts shepherd (PR 跟進): which
  // branch it is on. A branch that needs a person raises one Inbox card (a Task of the internal workflow pr-follow); the
  // card closes by itself when GitHub shows what it waits for (Studio answers it as "studio (GitHub)"), and a partly met
  // approve card keeps only the groups still missing. Studio never sends, @-mentions or re-requests a review by itself.
  const KIND_OF: Partial<Record<F.Branch, FollowKind>> = { "needs-evidence": "qa", "evidence-covers-head": "nudge", "missing-approvals": "approve", mergeable: "merge", ask: "ask" };
  const KIND_LABEL: Record<FollowKind, F.L> = { qa: { en: "Ask QA to test", tw: "請 QA 測試" }, nudge: { en: "Ask reviewers to look again", tw: "請 reviewer 重驗" }, approve: { en: "Ask for approval", tw: "請 approve" },
    merge: { en: "Ready to merge", tw: "可合併" }, ask: { en: "Your call", tw: "等你決定" }, push: { en: "Confirm before pushing", tw: "push 前確認" } };
  const VERDICT_TW: Record<string, string> = { pass: "通過", conditional: "有條件通過", fail: "不通過", "code-only": "只審 code", unclassified: "無法分類" };
  const hist = (en: string, tw: string, hit = false) => ({ at: iso(), en, tw, ...(hit ? { hit: true } : {}) });
  const noteKey = (pr: string, n: F.Note) => `${pr}@${n.login}@${n.at}`.toLowerCase();
  const rowNotes = (r: { id: string; notes?: F.Note[] }) => (r.notes ?? []).map((n) => { const k = state.follow.classified[noteKey(r.id, n)]; return k ? { ...n, kind: k, confidence: "high" as const } : n; });
  const shepherdOf = (r: ReturnType<typeof viewRows>[number]) => F.shepherd({ draft: r.draft, author: r.author, next: r.next, ci: r.ci ?? null, evidence: r.evidence, evidenceSet: !!(state.settings.evidence.accounts.length + state.settings.evidence.checks.length + state.settings.evidence.labels.length),
    reviews: r.reviews, approvals: r.approvals, notes: rowNotes(r), skipEvidence: !!state.follow.skip[`${r.id}@${r.head}`.toLowerCase()] });
  const contactOf = (login: string) => state.settings.sending.contacts.find((c) => eq(c.gh, login)) ?? null;
  const TOOL_WORD: Record<string, F.L> = { slack: { en: "Slack DM", tw: "Slack DM" }, teams: { en: "Teams chat", tw: "Teams 對話" }, email: { en: "email", tw: "Email" } };
  const person = (login: string) => { const c = contactOf(login); return { who: login, team: false, members: [] as string[], pick: login, via: c ? TOOL_WORD[c.tool] : { en: "no contact: copy only", tw: "沒有聯絡人：只能複製" } }; };
  const teamPerson = (label: string, members: string[]) => { const pick = state.follow.picks[label.toLowerCase()] && members.some((m) => eq(m, state.follow.picks[label.toLowerCase()])) ? state.follow.picks[label.toLowerCase()] : members[0] ?? "";
    const c = pick ? contactOf(pick) : null; return { who: label, team: true, members, pick, via: c ? TOOL_WORD[c.tool] : { en: "members from GitHub", tw: "成員從 GitHub 讀" }, last: state.follow.picks[label.toLowerCase()] ?? null }; };
  const channelFor = (kind: string) => (state.settings.sending.targets.find((t) => t.use === kind) ?? state.settings.sending.targets.find((t) => t.use === "any"))?.id ?? null;
  const OPT = (id: string, letter: string, en: string, tw: string, keep: boolean, pro: F.L | null = null, con: F.L | null = null, note = false) => ({ id, letter, label: { en, tw }, keep, pro, con, note });
  /** where QA should test: the environment the reviewer named, else a pre-production environment that runs the head now,
   *  else none (the request keeps a placeholder) */
  const testEnv = (r: { envs: { name: string; on: boolean | null; production: boolean }[] }, quote: string | null) => {
    const pre = r.envs.filter((e) => !e.production), q = String(quote ?? "").toLowerCase();
    const named = pre.filter((e) => q && new RegExp(`(^|[^a-z0-9_-])${e.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_-])`).test(q)).sort((a, b) => b.name.length - a.name.length)[0];
    return named?.name ?? pre.find((e) => e.on === true)?.name ?? null; };
  /** a follow-through card's content for a row as it is now */
  function followPayload(kind: FollowKind, r: ReturnType<typeof viewRows>[number], sh: F.Shepherd, extra: { quote?: string | null; by?: string | null; tests?: boolean; voids?: number | null; who?: string[] } = {}) {
    const pr: F.MsgPr = { id: r.id, url: r.url, title: r.title, head: r.head, env: testEnv(r, sh.note?.quote ?? null) };
    const ciOk = r.ci === "SUCCESS", ev = r.evidence;
    const done: F.L[] = [...(ciOk ? [{ en: "CI passes", tw: "CI 通過" }] : []), ...(ev && ev.verdict !== "fail" && ev.covers === "head" ? [{ en: `evidence: ${ev.verdict} on the current head (${ev.by})`, tw: `證據：${VERDICT_TW[ev.verdict] ?? ev.verdict} · 目前 head（${ev.by}）` }] : []),
      // the approvals the rules count (the row's own list: not the author's, not the pusher's)
      ...(r.approvals.approvers ?? r.reviews.filter((v) => v.state === "APPROVED" && !v.stale && !v.author).map((v) => v.login)).map((l) => ({ en: `${l} approved`, tw: `${l} approve` }))];
    const note = sh.note ?? null, q = note?.quote ? { en: `${note.login}'s comment: "${F.unq(note.quote)}". `, tw: `${note.login} 的意見是「${F.unq(note.quote)}」。` } : { en: "", tw: "" };
    const base = { schema: 1, kind, kindLabel: KIND_LABEL[kind], pr: r.id, repo: r.repo, url: r.url, title: r.title, head: r.head, channel: channelFor(kind), snoozeUntil: null as string | null, chased: 0 };
    if (kind === "qa") { const m = F.qaMessage(pr, r.routes ?? [], note);
      return { ...base, heading: { en: `Ask QA to test ${short(r)} on ${pr.env ?? "an environment"}`, tw: `請 QA 在 ${pr.env ?? "測試環境"} 實測 ${short(r)}` }, lead: { en: `${q.en}No code change is asked for, so the flow waits for evidence.`, tw: `${q.tw}代碼這邊沒有要改的，所以流程停在這裡等證據。` },
        done, missing: [{ en: `QA evidence covering the current head ${r.head.slice(0, 7)}`, tw: `QA 證據，要覆蓋目前 head ${r.head.slice(0, 7)}` }], msgHead: { en: "Test request", tw: "測試請求" }, recipients: state.settings.evidence.accounts.map(person), message: m.msg, short: m.short,
        opts: [OPT("sent", "A", "I sent it to QA; waiting for the evidence", "我已轉給 QA，等證據", true, { en: "the card closes when the evidence arrives", tw: "證據貼回來卡就自己關" }),
          OPT("skip", "B", "No test this time", "這次不做實測", false, { en: "reply to the reviewer with the reason", tw: "回 reviewer 說明理由" }, { en: "needs a reason; the reviewer may not accept it", tw: "要寫理由；reviewer 可能不收" }, true),
          OPT("code", "C", "It is a code problem: back to the author for a fix", "其實是代碼問題，回作者修正", false, { en: "the pull request goes back to its author for a fix", tw: "回作者修正，開下一個 round" })],
        autoClose: { en: "Evidence on the pull request that covers the current head closes this card and moves on to asking the reviewers again.", tw: "證據貼回 PR 而且覆蓋目前 head，卡就自動關，接著「請 reviewer 重驗」" } }; }
    if (kind === "nudge") { const who = sh.stale ?? [], m = F.nudgeMessage(pr, who, ev!, rowNotes(r));
      return { ...base, heading: { en: `The evidence is in: ask ${who.length === 1 ? who[0] : `the ${who.length} reviewers`} to look again on the current head`, tw: `證據齊了，請 ${who.length === 1 ? who[0] : `${who.length} 個 reviewer`} 在目前 head 重驗` },
        lead: (() => { const older = r.reviews.some((v) => v.stale && who.some((w) => eq(w, v.login)));
          return { en: `${ev!.by}'s report (${ev!.verdict}) covers the current head ${r.head.slice(0, 7)}; ${who.join(", ")} ${older ? "gave their verdict on an older head" : "reviewed before the evidence arrived"}. The card comes as soon as the evidence does.`,
            tw: `${ev!.by} 的報告（結論：${VERDICT_TW[ev!.verdict] ?? ev!.verdict}）覆蓋目前 head ${r.head.slice(0, 7)}；${who.join("、")} ${older ? "的意見還停在舊 head" : "是在證據之前 review 的"}。證據一齊就出卡，不等。` }; })(),
        done: [...done, ...(() => { const ns = rowNotes(r).filter((n) => who.some((w) => eq(w, n.login)) && n.quote); return ns.length && ns.every((n) => n.fixedBy?.length) ? [{ en: `the ${ns.length === 1 ? "last comment was" : `${ns.length} last comments were`} answered by new commits`, tw: `上次${ns.length === 1 ? "的意見" : ` ${ns.length} 條意見`}都已修` }] : []; })()],
        missing: who.map((w) => ({ en: `${w}'s result on the current head`, tw: `${w} 在目前 head 的結果` })), msgHead: { en: "Ask to review again", tw: "請重驗" }, recipients: who.map(person), message: m.msg, short: m.short,
        opts: [OPT("sent", "A", "I sent it; waiting for the reviews", "我已發出，等重驗", true, { en: "the card closes when they review the current head", tw: "兩人在目前 head 給結果卡就關" }),
          OPT("more", "B", "The evidence is not enough: ask QA again", "證據還不夠，再請 QA 補", false, { en: "back to asking QA", tw: "回「請 QA 測試」" }),
          OPT("later", "C", "Not now", "先不催", true, { en: "the card stays", tw: "卡留著" })],
        autoClose: { en: "Every reviewer giving a verdict on the current head closes this card; a change request goes back to the follow-through.", tw: "reviewer 都在目前 head 給出 review，卡就自動關；有 change request 就回到 PR 跟進" } }; }
    if (kind === "approve") { const a = r.approvals, groups = (a.groups ?? []).filter((g) => !g.ok), count = a.missing.find((m) => m.kind === "count") as { n: number } | undefined;
      // the author is never asked (their own approval does not count); a team owner is asked through its members
      const recips = groups.flatMap((g) => g.kind === "team" ? [teamPerson(g.who, (r.teams ?? {})[g.who] ?? [])] : g.who.split(" | ").filter((o) => !eq(o.replace(/^@/, ""), r.author)).map((o) => o.startsWith("@") && o.includes("/") ? teamPerson(o, ((r.teams ?? {})[o] ?? []).filter((m) => !eq(m, r.author))) : person(o.replace(/^@/, ""))));
      const miss = [...groups.map((g) => ({ who: g.who, files: g.kind === "owner" ? (g.files ?? []).slice(0, 4) : [], authorOnly: !!g.authorOnly })), ...(count ? [{ who: count.n === 1 ? "1 more approval" : `${count.n} more approvals`, whoTw: `還要 ${count.n} 個 approve`, files: [] as string[], count: true }] : [])];
      // each approver once: a team that approved names them, so their own "approved" line goes
      const doneA = [...done.filter((d) => !(a.groups ?? []).some((g) => g.ok && g.by.some((l) => d.en === `${l} approved`))), ...(a.groups ?? []).filter((g) => g.ok).map((g) => ({ en: `${g.who} (${g.by.join(", ")})`, tw: `${g.who}（${g.by.join("、")}）` }))];
      const m = F.approveMessage(pr, miss, doneA, a.lastPush);
      const named = miss.filter((x) => !(x as any).count), cnt = miss.find((x) => (x as any).count) as any;
      return { ...base, heading: { en: `Still missing: ${miss.map((x) => x.who).join(", ")}`, tw: [named.length ? `還缺 ${named.map((x) => x.who).join("、")} 的 approve` : "", cnt ? cnt.whoTw : ""].filter(Boolean).join("，") },
        lead: { en: `What the machines can do is done; the base branch's rules still ask for people's approval${a.lastPush ? ", after the last push" : ""}.`, tw: `機器能做的都好了，分支規則還要求人工 approve${a.lastPush ? "，而且要在最後一次 push 之後" : ""}。` },
        done: doneA, missing: miss.map((x) => ({ en: `✕ ${x.who}${(x as any).authorOnly ? " (only the author owns these files: GitHub needs another owner or an admin)" : ""}`, tw: `✕ ${(x as any).whoTw ?? x.who}${(x as any).authorOnly ? "（只有作者是這些檔案的 owner：GitHub 需要別的 owner 或 admin）" : ""}` })), groupsMissing: named.map((x) => x.who), countGap: count?.n ?? 0,
        approvedBy: [...(a.approvers ?? [])],
        msgHead: { en: "Ask for approval", tw: "請 approve" }, recipients: recips, message: m.msg, short: m.short,
        opts: [OPT("sent", "A", "I sent it; waiting for the approval", "我已發出，等 approve", true, { en: "an approval updates or closes the card", tw: "有人 approve 卡就更新或關掉" }),
          OPT("switch", "B", "Someone else", "換人", true, { en: "pick another member above and DM them", tw: "在上面選別的成員再 DM" }),
          OPT("hold", "C", "Not merging yet; keep the card", "先不合併，卡留著", true)],
        autoClose: { en: "All of the branch rules met closes this card and raises the merge card; partly met, the card keeps only the groups still missing.", tw: "分支規則全部滿足，卡就自動關並出合併卡；只滿足一部分，卡只留還缺的組" } }; }
    if (kind === "merge") return { ...base, heading: { en: `${short(r)} can merge`, tw: `${short(r)} 可以合併了` }, lead: { en: `${sh.why.en}. Studio does not merge a pull request it did not open: merge it on GitHub.`, tw: `${sh.why.tw}。Studio 不會合併不是它開的 PR：請在 GitHub 上合併。` },
      done, missing: [{ en: "your merge", tw: "你的合併" }], recipients: [], message: null, short: null,
      opts: [OPT("merging", "A", "I will merge it on GitHub", "我去 GitHub 合併", true, { en: "the card closes when it merges; the row moves to Merged", tw: "合併後卡自動關，PR 移到「已合併未上線」" }), OPT("hold", "B", "Not now", "先不合併", false, { en: "no merge card again for this head", tw: "這個 head 不再出合併卡" })],
      autoClose: { en: "Merged (or no longer mergeable) closes this card.", tw: "合併了（或不再可合併），卡就自動關" } };
    if (kind === "push") return { ...base, heading: { en: `This push voids ${extra.voids ?? "the"} approval${extra.voids === 1 ? "" : "s"}: push?`, tw: `這次 push 會讓 ${extra.voids ?? "已有的"} 個 approve 失效，要推嗎？` },
      lead: { en: `${extra.quote ? `${extra.by ? `${extra.by} left a comment` : "A reviewer left a comment"}: “${extra.quote.replace(/[.。]+$/, "")}”. ` : ""}The fix is ready, but the branch rules dismiss approvals on a push: ${extra.who?.join(", ") || "the approvers"} would have to approve again.`,
        tw: `${extra.quote ? `${extra.by ?? "reviewer"} 留了一條意見：「${extra.quote.replace(/[.。]+$/, "")}」。` : ""}修改已經好了，但分支規則會讓舊 approve 失效：推了之後 ${extra.who?.join("、") || "approver"} 要重新 approve。` },
      done: [extra.tests ? { en: "the change is ready; its tests pass", tw: "修改已在本機，測試通過" } : { en: "the change is ready", tw: "修改已在本機" }], missing: [{ en: "your decision", tw: "你決定要不要推" }], recipients: [], message: null, short: null,
      opts: [OPT("push", "A", "Push, then ask for the approvals again", "推，之後重新請 approve", false, { en: "the reviewer's comment is fixed", tw: "修好 reviewer 的意見" }, { en: `${extra.who?.join(", ") || "the approvers"} approve again`, tw: `${extra.who?.join("、") || "approver"} 要再 approve 一次` }),
        OPT("no-push", "B", "Do not push; reply that it stays as it is", "先不推，回覆 reviewer 這次不改", false, { en: "the approvals stay", tw: "已有 approve 不受影響" }, { en: "needs a reason", tw: "要寫理由" }, true),
        OPT("follow-up", "C", "Merge first, fix in a follow-up pull request", "合併後另開 PR 處理", false, { en: "this pull request merges first", tw: "這個 PR 先合" }, { en: "the reviewer may still block", tw: "reviewer 可能仍擋" })],
      autoClose: { en: "Push goes on and the approve card lists the voided approvals again.", tw: "選 A 會推送並回到 PR 跟進；「請 approve」卡會自動重新列出要重新 approve 的人" } };
    // ask: a comment Studio could not read as one kind, or rules it could not read
    return { ...base, heading: note ? { en: `What does ${note.login} ask for on ${short(r)}?`, tw: `${note.login} 在 ${short(r)} 要的是什麼？` } : { en: `The branch rules of ${short(r)} could not be read`, tw: `讀不到 ${short(r)} 的分支規則` },
      lead: note ? (() => { const qs = (note.quotes?.length ? note.quotes : note.quote ? [note.quote] : []).map(F.unq);
        return { en: `${qs.map((x) => `"${x}"`).join(" / ")}${qs.length ? " — " : ""}${sh.why.en}. Studio does not guess: tell it which kind of request this is.`, tw: `${qs.map((x) => `「${x}」`).join("／")}${qs.length ? "——" : ""}${sh.why.tw}。Studio 不猜：請告訴它這是哪一種要求。` }; })() : { en: `${sh.why.en}.`, tw: `${sh.why.tw}。` },
      done, missing: [{ en: "your call", tw: "你的判斷" }], recipients: [], message: null, short: null, note: note ? { login: note.login, at: note.at } : null,
      opts: note ? [OPT("code-change", "A", "A code change", "要改代碼", false), OPT("needs-evidence", "B", "Evidence from a test", "要外部證據", false), OPT("non-blocking", "C", "Nothing that blocks the merge", "不擋合併", false)]
        : [OPT("hold", "A", "I will check the rules on GitHub", "我去 GitHub 看規則", false, { en: "no card again for this head", tw: "這個 head 不再出卡" })],
      autoClose: { en: "A new review or a change on GitHub closes this card.", tw: "GitHub 上有新 review 或改動，卡就自動關" } };
  }
  const short = (r: { id: string }) => r.id.split("/")[1];
  /** an open entry's card: by its id, else (the node is still raising it, its id not written yet) by its run */
  const followCard = (o: FollowOpen) => { if (!engine) return null; if (o.card) return engine.cards.get(o.card) ?? null;
    const c = engine.cards.list({ run: o.run }).find((x: any) => x.status === "open" && x.follow) ?? null; if (c) o.card = c.id; return c; };
  /** update an open follow card's content and history (a live update tells the Inbox) */
  function patchCard(o: FollowOpen, f: (p: any) => void) { const c = followCard(o); if (!c || c.status !== "open" || !c.follow) return null; f(c.follow); engine!.cards.save(c); return c; }
  /** close an entry and its card together: an entry whose card is not raised yet stays (the next refresh closes both);
   *  an answer that does not land keeps the entry, so the card is never left open without one */
  async function closeFollow(key: string, en: string, tw: string): Promise<boolean> {
    const o = state.follow.open[key]; if (!o) return true;
    const run = engine?.list().find((x) => x.id === o.run), ended = !run || ["succeeded", "failed", "cancelled"].includes(run.status);
    const c = followCard(o);
    if (!c) { if (ended) { delete state.follow.open[key]; return true; } return false; }
    if (c.status === "open") { patchCard(o, (p) => { p.history.push(hist(en, tw, true)); });
      try { await engine!.answer(c.id, { choice: "auto", note: en, by: "studio (GitHub)" }); } catch { if (engine!.cards.get(c.id)?.status === "open") return false; } }
    delete state.follow.open[key]; return true;
  }
  /** why a card closes: what GitHub shows now that it did not when the card was raised (new commits, the evidence, an
   *  approval, a review), else the rule the pull request now waits on, as one plain sentence */
  function closeReason(o: FollowOpen, r: ReturnType<typeof viewRows>[number], sh: F.Shepherd): F.L {
    const c = followCard(o), p: any = c?.follow ?? {}, raised = Date.parse(o.at);
    const after = (at: string | null | undefined) => !!at && Date.parse(at) >= raised - 60_000;
    let what: F.L | null = null;
    if (r.head !== o.head) what = { en: `new commits: the head is now ${r.head.slice(0, 7)}`, tw: `有新 commit：head 變成 ${r.head.slice(0, 7)}` };
    else if (o.kind === "qa" && r.evidence && r.evidence.covers === "head") what = { en: `evidence from ${r.evidence.by} (${r.evidence.verdict}) covers the head`, tw: `${r.evidence.by} 的證據（${VERDICT_TW[r.evidence.verdict] ?? r.evidence.verdict}）覆蓋目前 head` };
    else if (o.kind === "nudge") { const who = r.reviews.filter((v) => !v.stale && after(v.at) && (p.recipients ?? []).some((x: any) => eq(x.who, v.login))).map((v) => `${v.login} (${v.state.toLowerCase().replace(/_/g, " ")})`);
      if (who.length) what = { en: `new review on the head: ${who.join(", ")}`, tw: `目前 head 上的新 review：${who.join("、")}` }; }
    else if (o.kind === "approve") { const got = (r.approvals.groups ?? []).filter((g) => g.ok && (p.groupsMissing ?? []).includes(g.who));
      if (got.length) what = { en: `approved: ${got.map((g) => `${g.who} (${g.by.join(", ")})`).join(", ")}`, tw: `已 approve：${got.map((g) => `${g.who}（${g.by.join("、")}）`).join("、")}` }; }
    // else the rule the pull request now waits on, as one plain sentence (its condition and what follows from it, no arrow)
    if (!what) { const rule = R.RULES.find((x) => x.id === r.next.rule); what = rule ? R.ruleSentence(rule) : { en: sh.why.en, tw: sh.why.tw }; }
    return what;
  }
  /** after a refresh: each open row's branch, its card raised, kept, updated or closed */
  // one follow-through pass at a time: a refresh, a settings save or an answer that asks for one while a pass runs gets
  // exactly one more pass after it (two passes at once would log twice and could raise a card twice)
  let followRun: Promise<void> | null = null, followAgain = false;
  function followUp(): Promise<void> {
    if (followRun) { followAgain = true; return followRun; }
    followRun = (async () => { try { do { followAgain = false; await followUpOnce(); } while (followAgain); } finally { followRun = null; } })();
    return followRun;
  }
  async function followUpOnce() {
    if (!engine || !state.settings.follow?.enabled) return;
    const rows = viewRows(snap, state); let changed = false;
    for (const [key, o] of Object.entries(state.follow.open)) {
      const r = rows.find((x) => eq(x.id, o.pr)), run = engine.list().find((x) => x.id === o.run);
      if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) { delete state.follow.open[key]; changed = true; continue; }
      if (!r) { const merged = (snap.merged ?? []).some((m) => eq(m.id, o.pr)); await closeFollow(key, merged ? "merged on GitHub" : "no longer an open watched pull request", merged ? "已在 GitHub 合併" : "已不是追蹤中的 open PR"); changed = true; continue; }
      if (o.kind === "push") continue; // a push card waits on its answer only
      const sh = shepherdOf(r), want = KIND_OF[sh.branch];
      if (want !== o.kind || (o.kind !== "approve" && o.kind !== "merge" && o.head !== r.head)) {
        const why = closeReason(o, r, sh); await closeFollow(key, why.en, why.tw); changed = true; continue; }
      if (o.kind === "approve") { const fresh = followPayload("approve", r, sh) as any;
        patchCard(o, (p) => {
          // the named groups (a team, a code-owner set) and the approval count are followed apart: a count that drops is
          // someone's approval, never a group that "left"
          const was: string[] = (p.groupsMissing ?? []).filter((g: string) => !/more approvals?$/.test(g)), now: string[] = fresh.groupsMissing;
          const gone = was.filter((g) => !now.includes(g)), added = now.some((g) => !was.includes(g)), gap0 = Number(p.countGap ?? 0), gap1 = Number(fresh.countGap ?? 0);
          // a card raised before the count was followed: take this refresh's count as where it starts, without a line
          if (p.countGap === undefined) { Object.assign(p, { groupsMissing: fresh.groupsMissing, countGap: fresh.countGap, approvedBy: fresh.approvedBy }); return; }
          if (!gone.length && !added && gap0 === gap1) return;
          const ok = (r.approvals.groups ?? []).filter((g) => g.ok && gone.includes(g.who)), dropped = gone.filter((g) => !ok.some((x) => x.who === g));
          const newApprovers = (fresh.approvedBy ?? []).filter((l: string) => !(p.approvedBy ?? []).some((x: string) => eq(x, l)) && !ok.some((g) => g.by.some((b) => eq(b, l))));
          const en: string[] = [], tw: string[] = [];
          if (ok.length) { en.push(`${ok.map((g) => `${g.who} (${g.by.join(", ")})`).join(", ")} approved ✓`); tw.push(`${ok.map((g) => `${g.who}（${g.by.join("、")}）`).join("、")}approve ✓`); }
          if (gap1 < gap0 && newApprovers.length) { en.push(`${newApprovers.join(", ")} approved ✓`); tw.push(`${newApprovers.join("、")} approve ✓`); }
          if (dropped.length) { en.push(`${dropped.join(", ")} is no longer required (GitHub ignores an owner it reports as unknown, or the branch rules changed)`); tw.push(`${dropped.join("、")} 不再需要（GitHub 會略過它判定為 unknown 的 owner，或分支規則改了）`); }
          // (a smaller gap is in what the card still asks for, below; a gap that closes is said here)
          if (gap0 && !gap1) { en.push("the approval count is met"); tw.push("approve 人數已夠"); }
          // the card grows: an approval no longer counts (new commits, or the rules now dismiss stale approvals), or the rules
          // ask for a new group; said with its cause
          const grows = added || gap1 > gap0, lost = (p.approvedBy ?? []).filter((l: string) => !(fresh.approvedBy ?? []).some((x: string) => eq(x, l)));
          if (grows) { const cause = r.head !== o.head ? { en: "after new commits", tw: "有新 commit 之後" } : r.approvals.dismissStale || r.approvals.lastPush ? { en: "the rules now dismiss approvals given before the last push", tw: "分支規則改為舊 approve 不算" } : { en: "the branch rules changed", tw: "分支規則改了" };
            if (lost.length) { en.push(`${lost.join(", ")}'s approval no longer counts (${cause.en})`); tw.push(`${lost.join("、")} 的 approve 不再算數（${cause.tw}）`); }
            else { en.push(`the branch rules now ask for more (${cause.en})`); tw.push(`分支規則現在要求更多（${cause.tw}）`); } }
          const left = (fresh.missing ?? []).map((m: F.L) => ({ en: m.en.replace(/^✕ /, ""), tw: m.tw.replace(/^✕ /, "") }));
          if (left.length) { en.push(`the card now asks for: ${left.map((m: F.L) => m.en).join(", ")}`); tw.push(`${grows ? "卡片現在要" : "卡裡只留"}：${left.map((m: F.L) => m.tw).join("、")}`); }
          p.history.push(hist(`${en.join("; ")}.`, `${tw.join("；")}。`));
          Object.assign(p, { heading: fresh.heading, done: fresh.done, missing: fresh.missing, groupsMissing: fresh.groupsMissing, countGap: fresh.countGap, approvedBy: fresh.approvedBy, recipients: fresh.recipients, message: fresh.message, short: fresh.short }); }); }
    }
    for (const r of rows) {
      const sh = shepherdOf(r), kind = KIND_OF[sh.branch]; if (!kind) continue;
      if (state.follow.hold[`${r.id}@${r.head}@${kind}`.toLowerCase()]) continue;
      if (Object.values(state.follow.open).some((o) => eq(o.pr, r.id) && (o.kind === kind || o.kind !== "push"))) continue; // one card at a time: a card still closing holds the next
      await startFollow(r.id, kind, r.head, sh); changed = true;
    }
    if (changed) write(stateFile, state);
  }
  async function startFollow(pr: string, kind: FollowKind, head: string, sh: F.Shepherd | null, extra: Record<string, unknown> = {}) {
    const def = engine!.defs.get(FOLLOW_WORKFLOW, 1); if (!def) throw new Error("The follow-through workflow is missing");
    const params = { follow: JSON.stringify({ schema: 1, pr, kind, head, branch: sh?.branch ?? null, ...extra }) };
    const run = await engine!.start({ workflow: FOLLOW_WORKFLOW, version: def.version, text: `${KIND_LABEL[kind].en}: ${pr}`, title: `${KIND_LABEL[kind].en}: ${pr}`.slice(0, 120), params, by: "studio (PR follow-through)" } as any);
    state.follow.open[run.id] = { run: run.id, card: null, pr, kind, head, at: iso() }; return run;
  }
  /** the captain's actions on a follow card: pick a team member, copy, DM, send to a channel, nudge again, snooze, an
   *  option that keeps the card open. Each is written into the card's history. */
  async function followAction(name: string, b: any) {
    // the card is shown while its node still finishes raising it: find it by its run then
    const asked = String(b?.card ?? ""), byRun = engine?.cards.get(asked)?.run;
    const o = Object.values(state.follow.open).find((x) => x.card === asked) ?? (byRun ? state.follow.open[byRun] : undefined); if (o && !o.card) o.card = asked; if (!o) throw new Error("That card is not an open follow-through card");
    const c = followCard(o); if (!c?.follow) throw new Error("That card is gone");
    const p = c.follow; let out: any = { ok: true };
    switch (name) {
      case "pick": { const who = String(b?.who ?? ""), m = String(b?.member ?? ""), rc = (p.recipients ?? []).find((x: any) => x.team && eq(x.who, who)); if (!rc || !rc.members.some((x: string) => eq(x, m))) throw new Error("Pick a member of that team");
        state.follow.picks[who.toLowerCase()] = m; patchCard(o, (q) => { const t = q.recipients.find((x: any) => x.team && eq(x.who, who)); t.pick = m; const cc = contactOf(m); t.via = cc ? TOOL_WORD[cc.tool] : { en: "members from GitHub", tw: "成員從 GitHub 讀" }; }); break; }
      case "copy": patchCard(o, (q) => q.history.push(hist("copied the message", "複製了訊息"))); break;
      case "dm": { const login = String(b?.login ?? ""), ok = (p.recipients ?? []).some((x: any) => eq(x.pick, login)); if (!ok) throw new Error("DM someone this card is for");
        const cc = contactOf(login), link = F.dmLink(cc, String(b?.text ?? "").slice(0, 8000), `${p.pr}: ${p.title}`, state.settings.sending.slackTeam);
        patchCard(o, (q) => { for (const t of q.recipients ?? []) if (t.team && eq(t.pick, login)) t.last = login; // "last time: …" on the card
          q.history.push(link ? hist(`copied and opened a DM with ${login} (${cc!.tool})`, `複製並 DM ${login}（${cc!.tool}）`) : hist(`copied the message for ${login} (no contact set: copy only)`, `複製訊息給 ${login}（沒有聯絡人：只複製）`)); });
        out = { ok: true, href: link?.href ?? null, prefilled: link?.prefilled ?? false, tool: cc?.tool ?? null }; break; }
      case "send": { const t = await sendTo(String(b?.target ?? ""), String(b?.text ?? "")); patchCard(o, (q) => q.history.push(hist(`sent to ${t.name}`, `已發到 ${t.name}`))); out = { ok: true, target: t.name }; break; }
      case "chase": patchCard(o, (q) => { q.chased = (q.chased ?? 0) + 1; q.history.push(hist("nudged again with the short version", "再催一次：跟進版")); }); break;
      case "snooze": { const until = b?.until ? String(b.until) : null; if (until && !(Date.parse(until) > now())) throw new Error("Snooze to a time ahead");
        patchCard(o, (q) => { q.snoozeUntil = until; q.history.push(until ? hist(`snoozed until ${until}`, `暫緩到 ${until}`) : hist("snooze cleared", "取消暫緩")); }); break; }
      case "choose": { const opt = (p.opts ?? []).find((x: any) => x.id === b?.option && x.keep); if (!opt) throw new Error("That option answers the card: use the card's answer");
        patchCard(o, (q) => { q.chosen = opt.id; q.history.push(hist(`chose ${opt.letter}: ${opt.label.en}`, `選了 ${opt.letter}：${opt.label.tw}`)); }); break; }
      default: throw new NoSuchAction(name);
    }
    write(stateFile, state); return out;
  }
  /** send a text to a channel through its incoming webhook (only on the captain's click) */
  async function sendTo(id: string, text: string) {
    const t = state.settings.sending.targets.find((x) => x.id === id), url = state.hooks[id]; if (!t || !url) throw new Error("Choose a send target that has a webhook");
    const bad = F.webhookProblem(t.tool, url, process.env.CREW_WEBHOOK_LOOPBACK === "1"); if (bad) throw new Error(bad);
    const body = String(text ?? "").trim(); if (!body) throw new Error("Nothing to send"); if (body.length > 8000) throw new Error("The message is too long to send");
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(F.webhookBody(t.tool, F.chatMentions(body, t.tool, state.settings.sending.contacts))), redirect: "manual", signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel().catch(() => {}); if (!r.ok) throw new Error(`${t.name} answered ${r.status}`);
    return t;
  }
  /** before a push: when the rules void approvals on a push and there are some, the captain confirms first (a card) */
  async function pushCheck(b: any) {
    const id = String(b?.pr ?? ""), r = viewRows(snap, state).find((x) => eq(x.id, id)); if (!r) throw new Error("Choose a pull request in the list");
    const v = F.pushVoids(r.approvals, r.reviews); if (v.voids === 0) return { voids: 0, card: false };
    // one push card per pull request and head: asking again shows the one already waiting
    const same = Object.values(state.follow.open).find((o) => o.kind === "push" && eq(o.pr, r.id) && o.head === r.head);
    if (same) return { voids: v.voids, who: v.who, card: true, task: same.run, existing: true };
    // who asked for the change: the caller says, else the latest reviewer comment read as a code change (with its sentence)
    const asked = rowNotes(r).filter((n) => n.kind === "code-change" && n.quote).sort((x, y) => Date.parse(y.at) - Date.parse(x.at))[0];
    const quote = typeof b?.quote === "string" ? b.quote.slice(0, 300) : asked?.quote ?? null;
    const by = typeof b?.by === "string" && R.NAME.test(b.by) ? b.by.slice(0, 60) : rowNotes(r).find((n) => n.quote && quote && n.quote === quote)?.login ?? (typeof b?.quote === "string" ? null : asked?.login ?? null);
    const run = await startFollow(r.id, "push", r.head, null, { voids: v.voids, who: v.who, quote, by, tests:b?.tests === true });
    write(stateFile, state); return { voids: v.voids, who: v.who, card: true, task: run.id };
  }

  // ---------- the release brief (docs/units/pr-watch.md "Release brief") ----------
  /** The selected merged pull requests in batches, each with, per deploy unit, the line to change in each production
   *  environment's image-tag file (old tag → new tag) and what it asks for before going live. Reads GitHub (the file, the
   *  repository's tags, compares and the tag's CI) at most 300 times; writes nothing. */
  async function buildBrief(ids: string[]) {
    const token = tokenNow(); if (!token) throw new Error("GitHub is not connected: Studio has no token");
    const rows = mergedRows(snap, state), waiting = rows.filter((r) => r.tab === "merged");
    for (const id of ids) if (!waiting.some((r) => eq(r.id, id))) throw new Error(`${id} is not a merged pull request waiting to go live`);
    const plan = Rel.batchesOf(ids, waiting.map((r) => ({ id: r.id, deps: r.deps })));
    const g = reader(apiBase(), token, undefined, null, null, { budget: { left: 300 } });
    const row = (id: string) => waiting.find((r) => eq(r.id, id))!;
    const tagsCache = new Map<string, Promise<{ name: string; sha: string }[]>>(), fileCache = new Map<string, Promise<string | null>>(), cmpCache = new Map<string, Promise<boolean | null>>(), ciCache = new Map<string, Promise<"green" | "red" | "none">>();
    const once = <T>(m: Map<string, Promise<T>>, k: string, f: () => Promise<T>) => { if (!m.has(k)) m.set(k, f()); return m.get(k)!; };
    const tagsOf = (repo: string) => once(tagsCache, repo.toLowerCase(), async () => { const l = await g.get(`${repoPath(repo)}/tags?per_page=50`);
      return (Array.isArray(l) ? l : []).map((t: any) => ({ name: String(t?.name ?? ""), sha: String(t?.commit?.sha ?? "") })).filter((t) => /^[0-9A-Za-z._-]{1,128}$/.test(t.name) && SHA.test(t.sha)); });
    const fileOf = (repo: string, path: string, ref: string | undefined) => once(fileCache, `${repo}|${path}|${ref ?? ""}`, async () => { try { const j = await g.get(`${repoPath(repo)}/contents/${path.split("/").map(enc).join("/")}${ref ? `?ref=${enc(ref)}` : ""}`);
      return j?.type === "file" && j.encoding === "base64" && typeof j.content === "string" && Number(j.size) <= 200_000 ? Buffer.from(j.content, "base64").toString("utf8") : null; } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return null; } });
    const has_ = (repo: string, commit: string, tip: string) => once(cmpCache, `${repo}|${commit}|${tip}`.toLowerCase(), async () => { if (commit.toLowerCase() === tip.toLowerCase()) return true;
      try { const c = await g.get(`${repoPath(repo)}/compare/${commit}...${tip}`); return c?.status === "ahead" || c?.status === "identical"; } catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; return null; } });
    // CI on a tag's commit: green when nothing failed and nothing still runs (no CI at all reads "none")
    const ciOf = (repo: string, sha: string) => once(ciCache, `${repo}|${sha}`.toLowerCase(), async () => {
      const runs = (await g.get(`${repoPath(repo)}/commits/${sha}/check-runs?per_page=100`))?.check_runs ?? [], st = await g.get(`${repoPath(repo)}/commits/${sha}/status`);
      const bad = runs.some((c: any) => c.status !== "completed" || !["success", "neutral", "skipped"].includes(String(c.conclusion))) || ["failure", "error", "pending"].includes(String(st?.state)) && Number(st?.total_count) > 0;
      return bad ? "red" : runs.length || Number(st?.total_count) > 0 ? "green" : "none"; });
    // a unit's tag after the batch before (the next batch's old tag, and the commit it runs); "" when no tag could be built
    const prevTag = new Map<string, { name: string; sha: string | null }>();
    const batches = [];
    for (let i = 0; i < plan.batches.length; i++) {
      const b = plan.batches[i], repos = [...new Set(b.map((id) => row(id).repo))], units = [];
      for (const repo of repos) {
        const mine = plan.batches.slice(0, i + 1).flat().filter((id) => eq(row(id).repo, repo)).map((id) => row(id).mergeSha).filter(Boolean);
        const later = plan.batches.slice(i + 1).flat().filter((id) => eq(row(id).repo, repo)).map((id) => row(id).mergeSha).filter(Boolean);
        const prodFiles = state.settings.environments.filter((e) => e.production && e.detect.kind === "file" && R.envApplies(e, repo));
        const lines = [], carries = new Set<string>();
        for (const e of prodFiles) { const dt = e.detect as Extract<R.EnvDetect, { kind: "file" }>, key = `${repo}|${e.name}`.toLowerCase();
          const prev = prevTag.get(key), text = prev ? null : await fileOf(dt.repository, dt.path, dt.ref);
          const fileTag = text != null ? R.tagOf(text, dt.template) : null, before = prev ? prev.name || null : fileTag;
          // the commit production runs before this batch: the batch before's tag, else the file's tag
          const baseSha = prev ? prev.sha : fileTag ? (await tagsOf(repo)).find((t) => t.name === fileTag)?.sha ?? R.commitOfTag(fileTag) : null;
          let after: string | null = null, problem: string | null = text == null && !prev ? "file" : prev && !prev.name ? "previous" : null, ci: string | null = null;
          const lack = { contains: 0, laterBy: new Set<string>(), red: 0 };
          for (const t of (await tagsOf(repo)).slice(0, 20)) {
            if (!(await Promise.all(mine.map((m) => has_(repo, m, t.sha)))).every((x) => x === true)) continue;
            lack.contains++;
            const lateHits = await Promise.all(later.map((m) => has_(repo, m, t.sha)));
            if (lateHits.some((x) => x === true)) { later.forEach((m, k) => { if (lateHits[k]) lack.laterBy.add(plan.batches.slice(i + 1).flat().find((id) => row(id).mergeSha === m)!); }); continue; } // it would carry a later batch
            const c = await ciOf(repo, t.sha); if (c === "red") { lack.red++; continue; }
            after = t.name; ci = c;
            // merged pull requests of this unit, not selected, that this tag carries and production does not run yet
            for (const o of waiting) if (eq(o.repo, repo) && o.mergeSha && !plan.batches.flat().some((x) => eq(x, o.id)) && (await has_(repo, o.mergeSha, t.sha)) === true
              && !(baseSha && (await has_(repo, o.mergeSha, baseSha)) === true)) carries.add(o.id);
            prevTag.set(key, { name: t.name, sha: t.sha });
            break; }
          // no tag: say why (none has these merges yet; every one that has them also carries a later batch; or CI failed)
          if (!after) { problem ??= !lack.contains ? "tag" : lack.laterBy.size && lack.red < lack.contains ? "order" : "ci"; prevTag.set(key, { name: "", sha: null }); }
          const [pre, post] = dt.template.split("{tag}");
          lines.push({ env: e.name, repository: dt.repository, path: dt.path, before: before ? `${pre}${before}${post}` : null, after: after ? `${pre}${after}${post}` : null, oldTag: before, newTag: after, ci, problem, laterBy: [...lack.laterBy] }); }
        units.push({ repo, unit: repo.split("/")[1], prs: b.filter((id) => eq(row(id).repo, repo)), lines, carries: [...carries], noFile: !prodFiles.length }); }
      batches.push({ n: i + 1, of: plan.batches.length, prs: b.map((id) => ({ id: row(id).id, title: row(id).title, url: row(id).url })), units,
        added: plan.added.filter((a) => b.some((x) => eq(x, a.id))), forced: plan.forced.filter((f) => b.some((x) => eq(x, f.pr))),
        ops: b.flatMap((id) => row(id).ops ?? []) });
    }
    return { batches, notMerged: plan.notMerged, selected: ids.length };
  }

  async function refresh(): Promise<void> {
    const { token } = ensure(); if (!token || !sub) return;
    // a refresh asked while one runs joins it; when the list or settings changed since that one started, read again once
    const want = version, joined = live.refreshing;
    await d.poller.refresh(sub.authority);
    if (sub && (joined || ranVersion < want)) await d.poller.refresh(sub.authority);
  }

  /** The captain's edits, by name: the board's POST /api/prs/<name> and an external CLI grant's PR tools both come here. */
  async function act(name: string, b: any, actor: { grant: string } | null = null): Promise<any> {
    // a grant's edits read GitHub again at most once a minute (the captain's token is shared); the board's always do
    const kick = () => { if (actor) { if (Date.now() - toolRefreshAt < REFRESH_GAP) return; toolRefreshAt = Date.now(); } void refresh().catch(() => {}); };
    if (name.startsWith("follow/")) return followAction(name.slice("follow/".length), b);
    switch (name) {
      case "send": { const t = await sendTo(String(b?.target ?? ""), String(b?.text ?? "")); return { ok: true, target: t.name }; }
      case "sending/test": { const t = await sendTo(String(b?.target ?? ""), "Crew Studio: a test message from the Pull requests page. / Crew Studio：Pull requests 頁的測試訊息。"); return { ok: true, target: t.name }; }
      case "push-check": return await pushCheck(b);
      case "refresh": { const { token } = ensure(); if (!state.watch.repos.length && !state.watch.prs.length) return view(); if (!token) return { ...view(), error: disabled() ? { en: "The pull request list is off (CREW_PR_WATCH=0)", tw: "PR 列表已關閉（CREW_PR_WATCH=0）" } : { en: "GitHub is not connected: Studio has no token", tw: "GitHub 尚未連線：Studio 沒有權杖" } };
        await refresh().catch(() => {}); return view(); }
      case "watch": { const got = watchUrl(b?.url); ensure(); kick(); return { ...view(), added: got }; }
      case "unwatch": unwatch(b); ensure(); return view();
      case "restore": { if (typeof b?.pr === "string") state.watch.excluded = state.watch.excluded.filter((x) => !eq(x, b.pr)); else state.watch.excluded = []; save(); kick(); return view(); }
      case "settings": { // the page sends the settings it opened with: a change made meanwhile (another window, an agent CLI) is never undone silently
        if (b?.base !== undefined && JSON.stringify(cleanSettings(b.base)) !== JSON.stringify(state.settings)) throw Object.assign(new Error("The settings changed while this dialog was open (another window or an agent CLI). Close it and open it again."), { tw: "這個視窗開著的時候設定被改過了（別的視窗或 agent CLI）。請關掉再重新打開。" });
        const next = cleanSettings(b?.settings), hooks = { ...state.hooks };
        // a webhook typed in the dialog (anything but the masked form the page was given) is checked and kept apart
        for (const t of Array.isArray(b?.settings?.sending?.targets) ? b.settings.sending.targets : []) { const url = typeof t?.url === "string" ? t.url.trim() : "", tt = next.sending.targets.find((x) => x.id === t?.id);
          if (!tt || !url || url.includes("••••")) continue; const bad = F.webhookProblem(tt.tool, url, process.env.CREW_WEBHOOK_LOOPBACK === "1"); if (bad) throw new Error(`${tt.name}: ${bad}`); hooks[tt.id] = url; }
        for (const k of Object.keys(hooks)) if (!next.sending.targets.some((t) => t.id === k)) delete hooks[k];
        state.settings = next; state.hooks = hooks; settingsWarning = null; save(); queueMicrotask(() => { void followUp().catch(() => {}); });
        // what the settings change (environments, evidence, which pull requests) is not a change on GitHub: start the marks afresh
        snap.finger = {}; snap.changed = {}; write(snapFile, snap); kick(); return view(); }
      case "order": { state.order = validIds(b?.order); save(); return view(); }
      case "deps": { const id = String(b?.pr ?? ""); if (!R.splitId(id) || !rowIdsNow().some((r) => eq(r, id))) throw new Error("Choose a pull request in the list");
        const on = validIds(b?.on, 20).filter((o) => !eq(o, id)); const k = Object.keys(state.deps).find((a) => eq(a, id)) ?? id; state.deps[k] = { on: [...new Set(on)], ...(actor ? { by: "external-cli" as const, grant: actor.grant } : { by: "captain" as const }), at: iso() }; save(); return view(); }
      case "group": { const id = String(b?.pr ?? ""), g = String(b?.group ?? "").trim(); if (!R.splitId(id)) throw new Error("Choose a pull request");
        if (g && !state.settings.groups.includes(g)) throw new Error("Choose one of the release groups in the settings");
        const k = Object.keys(state.groups).find((a) => eq(a, id)) ?? id; if (g) state.groups[k] = g; else delete state.groups[k]; save(); return view(); }
      case "accept": { const v = view(); state.order = v.rows.map((r) => r.id);
        for (const r of v.rows) if (r.deps.source === "proposal") state.deps[r.id] = { on: r.deps.on.map((x) => x.id), by: "accepted", at: iso() };
        save(); return view(); }
      case "drift/take": { const id = String(b?.pr ?? ""), r = snap.rows.find((x) => eq(x.id, id)); if (!r) throw new Error("Choose a pull request in the list");
        const ak = Object.keys(state.applied).find((a) => eq(a, id)); if (!ak) throw new Error("Studio never wrote a block into this pull request");
        const dk = Object.keys(state.deps).find((a) => eq(a, id)) ?? id;
        if (r.bodyBlock) { state.applied[ak] = { block: r.bodyBlock, on: r.githubDeps ?? [], at: iso() }; state.deps[dk] = { on: r.githubDeps ?? [], by: "github", at: iso() }; }
        else { delete state.applied[ak]; state.deps[dk] = { on: [], by: "github", at: iso() }; }
        save(); return view(); }
      case "brief": { const ids = validIds(b?.prs, 50); if (!ids.length) throw new Error("Choose the merged pull requests to release"); return await buildBrief(ids); }
      case "apply": { const ids = validIds(b?.prs, 50); if (!ids.length) throw new Error("Choose the pull requests to apply");
        const run = await startApply(ids, b?.shortForm === undefined ? state.settings.shortForm : !!b.shortForm); return ({ ok: true, task: run.id, href: `#/run/${run.id}` }); }
    }
    throw new NoSuchAction(name);
  }

  // ---------- an external CLI grant's tools (docs/units/cli-mcp-grant.md) ----------
  // The same edits as the board (act), so a CLI the captain granted changes Studio's own list directly. Nothing here
  // writes to GitHub: the dependency block is written only through the captain-only card the board's Apply starts.
  const brief = (r: ReturnType<typeof view>["rows"][number]) => ({ pr: r.id, url: r.url, title: r.title, author: r.author, draft: r.draft, base: r.base, position: r.position,
    group: r.group, project: r.project?.id ?? null, ci: r.ci ?? null, next: r.next,
    approvals: r.approvals ? { readable: r.approvals.readable, required: r.approvals.required, counted: r.approvals.counted, missing: r.approvals.missing, groups: r.approvals.groups ?? [], blocked: !!r.approvals.blocked } : null,
    reviews: r.reviews.map((x) => ({ login: x.login, state: x.state, stale: x.stale })), evidence: r.evidence, envs: r.envs, deps: r.deps.on,
    issues: (r.issues ?? []).map((i: any) => ({ ref: i.ref, url: i.url, title: i.title })), changed: r.changed });
  const listView = () => { const v = view(); return { enabled: v.enabled, connected: v.connected, refreshedAt: v.refreshedAt, refreshing: v.refreshing, refreshError: v.error, errors: v.errors,
    watch: v.watch, settings: v.settings, suggest: v.suggest, proposal: { pending: v.proposal.pending, accepted: v.proposal.accepted }, rows: v.rows.map(brief), merged: v.merged.map((r) => ({ pr: r.id, url: r.url, title: r.title, tab: r.tab, mergeSha: r.mergeSha, mergedAt: r.mergedAt, envs: r.envs, ship: r.ship, deps: r.deps })),
    board: "#/prs", note: "Studio's own list. No tool here writes to GitHub (merge, review, comment, label, the dependency block)." }; };
  const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
  const ids = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
  const changedBy = async (name: string, b: unknown, grant: string) => { const out = await act(name, b, { grant }); d.notify?.("prs", { count: count(), at: snap.at }); return out; };
  /** the settings fields and the type each must have: a tool names only these, each with its own type (never cleared by a wrong one) */
  const SETTING_TYPES: Record<string, "object" | "array" | "boolean" | "lang"> = { follow: "object", opsRules: "object", which: "object", evidence: "object", requiredReviewers: "array", environments: "array", groups: "array", shortForm: "boolean", messageLang: "lang" };
  const settingError = (n: Record<string, any>): string | null => {
    for (const [k, v] of Object.entries(n)) { const t = SETTING_TYPES[k]; if (!t) return `prs_settings does not know ${k} (${Object.keys(SETTING_TYPES).join(", ")})`;
      if (t === "object" ? !obj(v) : t === "array" ? !Array.isArray(v) : t === "boolean" ? typeof v !== "boolean" : !(v === null || typeof v === "string")) return `settings.${k} must be ${t === "lang" ? "a language or null" : t === "object" ? "an object" : t === "array" ? "a list" : "true or false"}`; }
    for (const k of ["which", "evidence", "opsRules"] as const) if (obj(n[k])) { const allowed = k === "which" ? ["mine", "assigned", "reviewRequested"] : k === "opsRules" ? ["migration", "config", "secret"] : ["accounts", "checks", "labels"];
      for (const [f, v] of Object.entries(n[k] as Record<string, unknown>)) { if (!allowed.includes(f)) return `settings.${k} does not know ${f}`; if (k === "which" ? typeof v !== "boolean" : !Array.isArray(v)) return `settings.${k}.${f} must be ${k === "which" ? "true or false" : "a list"}`; } }
    return null; };
  const REFRESH_GAP = 60_000; let toolRefreshAt = 0;
  const MAX_ARGS = 16_384;
  const TOOLS = [
    { name: "prs_list", description: "Studio's pull request list: every watched open pull request in the captain's order, with CI, approvals (what is still missing, per required team), reviews, test evidence, environments, dependencies, linked issues and the next step; the merged ones followed until production (merged or live, with each environment). Also the watch list and the settings.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "prs_get", description: "One pull request of the list in full: everything prs_list has plus the merge-box facts Studio read.", inputSchema: { type: "object", required: ["pr"], additionalProperties: false, properties: { pr: { type: "string", description: "owner/repo#number" } } } },
    { name: "prs_refresh", description: "Read GitHub again now (Studio also refreshes every 5 minutes), then return the list.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "prs_watch", description: "Watch a repository (its open pull requests the captain opened or is assigned to) or one pull request, by its GitHub address.", inputSchema: { type: "object", required: ["url"], additionalProperties: false, properties: { url: { type: "string", description: "https://github.com/<owner>/<repo> or …/pull/<n>" } } } },
    { name: "prs_unwatch", description: "Stop watching a repository ({repo: owner/repo}) or leave one pull request out of the list ({pr: owner/repo#N}).", inputSchema: { type: "object", additionalProperties: false, properties: { repo: { type: "string" }, pr: { type: "string" } } } },
    { name: "prs_restore", description: "Bring back a pull request left out of the list ({pr}), or all of them ({}).", inputSchema: { type: "object", additionalProperties: false, properties: { pr: { type: "string" } } } },
    { name: "prs_settings", description: "Change the list's settings. Pass only what changes; the rest is kept. Fields: which {mine, assigned, reviewRequested}, evidence {accounts, checks, labels}, requiredReviewers, environments, groups, shortForm, messageLang.", inputSchema: { type: "object", required: ["settings"], additionalProperties: false, properties: { settings: { type: "object" } } } },
    { name: "prs_order", description: "Set the release order: pull request ids first to last (owner/repo#N). Rows not named follow in Studio's proposed order.", inputSchema: { type: "object", required: ["order"], additionalProperties: false, properties: { order: { type: "array", items: { type: "string" } } } } },
    { name: "prs_deps", description: "Set what one pull request waits for: {pr, on: [ids]} (an empty list clears it). Studio's record only; nothing is written to GitHub.", inputSchema: { type: "object", required: ["pr", "on"], additionalProperties: false, properties: { pr: { type: "string" }, on: { type: "array", items: { type: "string" } } } } },
    { name: "prs_group", description: "Put a pull request in one of the release groups from the settings ({pr, group}); an empty group takes it out.", inputSchema: { type: "object", required: ["pr", "group"], additionalProperties: false, properties: { pr: { type: "string" }, group: { type: "string" } } } },
    { name: "prs_accept", description: "Accept Studio's proposed order and dependencies as the captain's.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  ] as const;
  /** A tool call from a pull request list grant (grant: its id, recorded on what it changes). */
  async function tool(name: string, a: unknown, grant = "external-cli"): Promise<unknown> {
    const b: Record<string, any> = obj(a) ? a : {};
    if (JSON.stringify(b).length > MAX_ARGS) return { error: `${name}: arguments over ${MAX_ARGS} bytes` };
    const extra = (allowed: string[]) => Object.keys(b).find((k) => !allowed.includes(k));
    const t = TOOLS.find((x) => x.name === name); if (!t) return { error: `no such tool: ${name}` };
    const bad = extra(Object.keys((t.inputSchema as any).properties ?? {})); if (bad) return { error: `${name} does not take ${bad}` };
    try {
      switch (name) {
        case "prs_list": ensure(); return listView();
        case "prs_get": { const id = str(b.pr), r = id ? view().rows.find((x) => eq(x.id, id)) : null; if (!r) return { error: `${b.pr ?? "(none)"} is not in the list (prs_list)` };
          const raw = snap.rows.find((x) => eq(x.id, r.id)); return { ...brief(r), labels: r.labels, head: r.head, headRef: r.headRef, createdAt: r.createdAt, reviews: r.reviews, partial: r.partial, deps: r.deps, orderWhy: r.orderWhy, body: raw?.facts?.body ?? null }; }
        case "prs_refresh": { // the captain's GitHub token is shared: a CLI refreshes at most once a minute (Studio also refreshes every 5 minutes)
          if (Date.now() - toolRefreshAt < REFRESH_GAP) return { ...listView(), note: `Refreshed less than a minute ago; this is the last refresh (${snap.at}).` };
          toolRefreshAt = Date.now(); const v: any = await act("refresh", {}); return { ...listView(), ...(v.error ? { refreshError: v.error } : {}) }; }
        case "prs_watch": { if (!str(b.url)) return { error: "prs_watch takes {url}" }; const v: any = await changedBy("watch", { url: b.url }, grant); return { added: v.added, ...listView() }; }
        case "prs_unwatch": { if (!!str(b.repo) === !!str(b.pr)) return { error: "prs_unwatch takes {repo} or {pr}" }; await changedBy("unwatch", b, grant); return listView(); }
        case "prs_restore": { if (b.pr !== undefined && !str(b.pr)) return { error: "prs_restore takes {pr} or {}" }; await changedBy("restore", b, grant); return listView(); }
        case "prs_settings": { if (!obj(b.settings)) return { error: "prs_settings takes {settings: {...only what changes}}" }; const cur: any = state.settings, n = b.settings;
          const bad = settingError(n); if (bad) return { error: bad };
          const merged = { ...cur, ...n, which: { ...cur.which, ...(obj(n.which) ? n.which : {}) }, evidence: { ...cur.evidence, ...(obj(n.evidence) ? n.evidence : {}) }, opsRules: { ...cur.opsRules, ...(obj(n.opsRules) ? n.opsRules : {}) } };
          await changedBy("settings", { settings: merged }, grant); return listView(); }
        case "prs_order": { if (!ids(b.order)) return { error: "prs_order takes {order: [owner/repo#N, …]}" }; await changedBy("order", b, grant); return listView(); }
        case "prs_deps": { if (!str(b.pr) || !ids(b.on)) return { error: "prs_deps takes {pr, on: [ids]}" }; await changedBy("deps", b, grant); return listView(); }
        case "prs_group": { if (!str(b.pr) || typeof b.group !== "string") return { error: "prs_group takes {pr, group}" }; await changedBy("group", b, grant); return listView(); }
        case "prs_accept": await changedBy("accept", {}, grant); return listView();
      }
    } catch (e: any) { return { error: String(e?.message ?? e).slice(0, 300) }; }
    return { error: `no such tool: ${name}` };
  }
  const tools = { list: () => TOOLS.map((t) => ({ ...t })), call: tool, writes: (name: string) => !["prs_list", "prs_get", "prs_refresh"].includes(name) };

  // ---------- routes ----------
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const fail = (e: any, status = 400) => json({ error: String(e?.message ?? e).slice(0, 300), ...(e?.tw ? { tw: e.tw } : {}) }, status);
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname; if (p !== "/api/prs" && !p.startsWith("/api/prs/")) return null;
    if (!writing) {
      if (p === "/api/prs") { ensure(); return json(view()); }
      if (p === "/api/prs/count") return json({ count: count(), refreshedAt: snap.at });
      if (p === "/api/prs/sending") return json(sendingView());
      return json({ error: "not found" }, 404);
    }
    if (who.kind !== "desktop") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    let b: any = {}; try { b = await req.json(); } catch {}
    try { return json(await act(p.slice("/api/prs/".length), b)); }
    catch (e: any) { return e instanceof NoSuchAction ? json({ error: "not found" }, 404) : fail(e); }
  }
  return { handle, install, view, count, refresh, ensure, tools, stop: () => { sub?.cancel(); sub = null; }, get state() { return state; }, get snapshot() { return snap; } };
}
