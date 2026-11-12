// Pull requests (docs/units/pr-watch.md): every open pull request the captain is on, across repositories, what it waits
// for and who. One list, on the top-level page #/prs.
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

export const APPLY_WORKFLOW = "pr-watch-apply-depends";
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
export const READ_BUDGET = 1500, MAX_ROWS = 60;
export class OverBudget extends Error { constructor() { super(`a refresh would read GitHub more than ${READ_BUDGET} times: watch fewer repositories or pull requests`); } }
type Reader = { get(path: string): Promise<any>; pages(path: string, max: number): Promise<any[]>; graphql(query: string, variables: Record<string, unknown>): Promise<any> };
function reader(api: string, token: string, signal: AbortSignal | undefined, poller: GitHubPoller | null, authority: ReadAuthority | null, o: { etags?: EtagCache; budget?: { left: number } } = {}): Reader {
  const spend = () => { if (o.budget && --o.budget.left < 0) throw new OverBudget(); };
  const through = (key: string, load: () => Promise<any>) => poller && authority ? poller.read(authority, key, () => { spend(); return load(); }, signal) : (spend(), load());
  const get = (path: string) => through(`GET ${path}`, () => call(api, token, "GET", path, undefined, signal, o.etags));
  return {
    get,
    async pages(path, max) { const out: any[] = []; const sep = path.includes("?") ? "&" : "?";
      for (let page = 1; page <= max; page++) { const part = await get(`${path}${sep}per_page=100&page=${page}`); const list = Array.isArray(part) ? part : []; out.push(...list); if (list.length < 100) break; }
      return out; },
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
};
export const DEFAULT_SETTINGS: Settings = { which: { mine: true, assigned: true, reviewRequested: false }, evidence: { accounts: [], checks: [], labels: [] }, requiredReviewers: [], environments: [], groups: [], shortForm: false, messageLang: null };
type Dep = { on: string[]; by: "captain" | "accepted" | "github"; at: string };
export type State = { schema: 1; settings: Settings; watch: { repos: string[]; prs: string[]; excluded: string[] }; order: string[] | null; deps: Record<string, Dep>; applied: Record<string, { block: string; on: string[]; at: string }>; groups: Record<string, string> };
const fresh = (): State => ({ schema: 1, settings: structuredClone(DEFAULT_SETTINGS), watch: { repos: [], prs: [], excluded: [] }, order: null, deps: {}, applied: {}, groups: {} });
type Change = { k: "new" } | { k: "head"; sha: string } | { k: "next"; from: string; to: string } | { k: "review"; login: string; state: string } | { k: "evidence"; verdict: string } | { k: "env"; name: string; on: boolean } | { k: "draft"; draft: boolean } | { k: "title" } | { k: "ci"; state: string };
export type RawRow = {
  id: string; repo: string; number: number; url: string; title: string; author: string; draft: boolean; single: boolean; base: string; headRef: string; head: string;
  createdAt: string; labels: string[]; bodyBlock: string | null; githubDeps: string[] | null; bodyMalformed: boolean;
  issues: { ref: string; url: string; title: string | null; state: string | null; external: boolean }[];
  reviews: R.ReviewView[]; approvals: R.Approvals; evidence: R.Evidence | null; ci?: string | null; envs: { name: string; on: boolean | null; production: boolean; auto?: boolean }[];
  facts: R.PrFacts; partial: string[];
};
export type Snapshot = { schema: 1; at: string | null; me: string | null; rows: RawRow[]; errors: { target: string; en: string; tw: string }[]; single: Record<string, string>;
  depState: Record<string, string>; proposal: { deps: R.Signal[]; hints: R.Hint[] }; changed: Record<string, { at: string; what: Change[] }>; finger: Record<string, any>;
  /** each row's head and when Studio first saw it: a comment that names no commit covers a head seen before it */
  heads: Record<string, { sha: string; at: string }>;
  /** accounts that may post test evidence, offered when none is set: people who commented on a row's pull request but
   *  are not its author, did not review it, and are not a bot account */
  suggest?: { evidenceAccounts: { login: string; prs: number }[] } };
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
  return { which: { mine: w.mine !== false, assigned: w.assigned !== false, reviewRequested: !!w.reviewRequested },
    evidence: { accounts, checks: list(s.evidence?.checks), labels: list(s.evidence?.labels) }, requiredReviewers: req, environments: envs, groups: list(s.groups, 20, 30), shortForm: !!s.shortForm, messageLang: lang };
}

export type PrWatchDeps = { dataDir: string; poller: GitHubPoller; notify?: (type: string, data: unknown) => void; now?: () => number;
  /** tests lower the caps; production uses MAX_ROWS and READ_BUDGET */ limits?: { rows?: number; reads?: number; autoReads?: number } };
/** the cap on reads for a repository's own environments was reached (they are for show: never fails a refresh) */
class OverAuto extends Error {}

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
      const w = state.watch; next.rows = next.rows.filter((r) => r.single ? has(w.prs, r.id) : has(w.repos, r.repo) && !has(w.excluded, r.id));
      snap = next; write(snapFile, snap); live.error = null; live.backoffUntil = null; live.failures = 0;
    } catch (e: any) {
      if (signal.aborted) return;
      live.failures++; live.backoffUntil = new Date(now() + Math.min(15 * 60_000, interval() * 2 ** Math.min(live.failures, 20))).toISOString();
      live.error = e instanceof RateLimited ? { en: e.message, tw: "GitHub 限流：Studio 會等一下再讀" } : e instanceof OverBudget ? { en: e.message, tw: `一次刷新要讀 GitHub 超過 ${READ_BUDGET} 次：請少追蹤一些 repo 或 PR` } : e instanceof HttpError ? why(e) : { en: "the refresh failed; Studio tries again later", tw: "刷新失敗；Studio 稍後再試" };
      throw e;
    } finally { live.refreshing = false; d.notify?.("prs", { count: count(), at: snap.at }); }
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
    for (const id of s.watch.prs) { const sp = R.splitId(id); if (!sp) continue;
      try { const p = await g.get(`${repoPath(sp.repo)}/pulls/${sp.number}`); if (p?.state === "open") found.set(id.toLowerCase(), { pr: p, repo: sp.repo, single: true }); else out.single[id] = p?.merged_at ? "merged" : "closed"; }
      catch (e) { if (e instanceof RateLimited || e instanceof OverBudget) throw e; out.errors.push({ target: id, ...why(e) }); }
    }
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
      for (const p of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) { const t = await fileOf(repo, p, base); if (t === "unreadable") return "unreadable"; if (t !== "missing") return R.codeownersOverLimit(t) ? "unreadable" : R.parseCodeowners(t); }
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
    const envOn = async (e: R.EnvSetting, repo: string, head: string, checks: any[]): Promise<boolean | null> => {
      try {
        const dt = e.detect;
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
        const prod = (n: string) => /prod/i.test(n);
        const used = (await Promise.all(names.filter((n: string) => n.toLowerCase() !== "github-pages").slice(0, 10).map(async (n: string) => (await deployedOn(repo, n)) ? n : null))).filter((n): n is string => !!n);
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
      const [reviews, commits, comments, timeline, files, checks, gql] = await Promise.all([
        soft(async () => (await g.pages(`${path}/pulls/${n}/reviews`, 3)).map((r: any) => ({ login: String(r.user?.login ?? ""), state: String(r.state ?? ""), commit: r.commit_id ? String(r.commit_id) : null, at: String(r.submitted_at ?? "") })), [] as R.Review[], partial, "reviews"),
        soft(async () => (await g.pages(`${path}/pulls/${n}/commits`, 3)).map((c: any) => ({ sha: String(c.sha ?? ""), at: String(c.commit?.committer?.date ?? c.commit?.author?.date ?? ""), login: String(c.author?.login ?? c.committer?.login ?? ""), author: c.author?.login ? String(c.author.login) : null, committer: c.committer?.login ? String(c.committer.login) : null })), [] as (R.Commit & { login: string; author: string | null; committer: string | null })[], partial, "commits"),
        soft(async () => (await g.pages(`${path}/issues/${n}/comments`, 3)).map((c: any) => ({ login: String(c.user?.login ?? ""), body: String(c.body ?? "").slice(0, 65536), at: String(c.created_at ?? ""), url: String(c.html_url ?? "") })), [] as R.EvidenceInput["comments"], partial, "comments"),
        soft(() => g.pages(`${path}/issues/${n}/timeline`, 2), [] as any[], partial, "timeline"),
        soft(async () => (await g.pages(`${path}/pulls/${n}/files`, 3)).map((f: any) => String(f.filename ?? "")).filter(Boolean), [] as string[], partial, "files"),
        soft(async () => SHA.test(head) ? ((await g.get(`${path}/commits/${head}/check-runs?per_page=100`))?.check_runs ?? []) : [], [] as any[], partial, "checks"),
        soft(async () => { const [o, r] = repo.split("/"); const data = await g.graphql("query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){commits(last:1){nodes{commit{oid statusCheckRollup{state}}}} reviewDecision mergeStateStatus reviewRequests(first:20){nodes{requestedReviewer{__typename ... on User{login} ... on Team{slug organization{login}}}}} closingIssuesReferences(first:20){nodes{number title state url repository{nameWithOwner}}}}}}", { o, r, n });
          return (data?.repository?.pullRequest ?? null) as any; }, null as any, partial, "closing issues"),
      ]);
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
      for (const c of comments) { const k = c.login.toLowerCase(); if (!k || k === author.toLowerCase() || k === me.toLowerCase() || reviewers.has(k) || k.endsWith("[bot]") || /(?:^|[-_])bot$|^bot[-_]/.test(k) || !R.NAME.test(c.login)) continue;
        const e = commenters.get(k) ?? { login: c.login, prs: new Set<string>() }; e.prs.add(id); commenters.set(k, e); }
      const block = R.findBlock(body);
      const row: RawRow = { id, repo, number: n, url: `https://github.com/${repo}/pull/${n}`, title: String(p.title ?? "").slice(0, 300), author, draft: !!p.draft, single, base, headRef: String(p.head?.ref ?? ""), head,
        createdAt: String(p.created_at ?? ""), labels: (p.labels ?? []).map((l: any) => String(l?.name ?? "")).filter(Boolean).slice(0, 20),
        bodyBlock: block && block !== "malformed" ? block.text : null, githubDeps: R.blockDeps(body, repo), bodyMalformed: block === "malformed",
        issues, reviews: rv, approvals, evidence, ci, envs, partial,
        facts: { id, repo, number: n, body: body.slice(0, 65536), base, headRef: String(p.head?.ref ?? ""), createdAt: String(p.created_at ?? ""), files: files.slice(0, 300), issues: issues.map((i) => i.ref) } };
      return row;
    });
    rows.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    out.rows = rows;
    out.proposal = R.signals(rows.map((r) => r.facts));
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
      const on = record ? record.on : proposed.map((x) => x.on);
      const depsView = on.map((id) => { const inList = rowIds.get(id.toLowerCase()); const st = inList ? "open" : sn.depState[id] ?? Object.entries(sn.depState).find(([k]) => eq(k, id))?.[1] ?? "unread"; return { id, done: st === "merged", state: st }; });
      const ak = Object.keys(s.applied).find((k) => eq(k, r.id)), applied = ak ? s.applied[ak] : null;
      const drift = applied && R.normBlock(r.bodyBlock) !== R.normBlock(applied.block) ? { github: r.bodyBlock, studio: applied.block, githubDeps: r.githubDeps } : null;
      const next = R.nextStep({ draft: r.draft, author: r.author, reviews: r.reviews, requiredReviewers: s.settings.requiredReviewers, deps: depsView,
        envs: r.envs.filter((e) => !e.auto).map((e) => ({ name: e.name, on: !!e.on, production: e.production })), /* a repository's own environments are shown, never a step */ evidence: r.evidence, evidenceSources: s.settings.evidence, approvals: r.approvals });
      const gk = Object.keys(s.groups).find((k) => eq(k, r.id));
      const { facts: _f, ...rest } = r;
      return { ...rest, project: projectOf(r.repo), group: gk ? s.groups[gk] : null, next,
        deps: { on: depsView, source: record ? record.by : proposed.length ? "proposal" : "none", proposed: record ? [] : proposed, applied: !!applied && !drift, drift },
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
  const count = () => viewRows(snap, state).filter((r) => r.next.kind === "approve" || r.next.kind === "merge").length;
  function view() {
    const tok = { token: tokenNow() };
    const { rows, proposal } = ordered(viewRows(snap, state), snap, state);
    const pendingDeps = rows.filter((r) => r.deps.proposed.length).map((r) => ({ pr: r.id, on: r.deps.proposed }));
    const repoCount = (repo: string) => rows.filter((r) => eq(r.repo, repo) && !r.single).length;
    const projects = (() => { try { return new Projects(d.dataDir).nativeSnapshot().records; } catch { return []; } })();
    return {
      enabled: !disabled(), connected: !!tok.token, settingsWarning, me: snap.me, refreshedAt: snap.at, refreshing: live.refreshing, error: live.error, backoffUntil: live.backoffUntil, errors: snap.errors, intervalMs: interval(),
      settings: state.settings, suggest: snap.suggest ?? { evidenceAccounts: [] },
      watch: { repos: state.watch.repos.map((repo) => { const p = projects.find((x) => x.github?.repository && eq(x.github.repository, repo)); return { repo, count: repoCount(repo), project: p ? { id: p.id, name: p.name || p.id } : null }; }),
        prs: state.watch.prs.map((id) => ({ id, state: snap.single[id] ?? (rows.some((r) => eq(r.id, id)) ? "open" : null) })), excluded: state.watch.excluded },
      rows, rules: R.RULES, count: rows.filter((r) => r.next.kind === "approve" || r.next.kind === "merge").length,
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
      snap.rows = snap.rows.filter((r) => !eq(r.repo, b.repo) || has(state.watch.prs, r.id)); write(snapFile, snap); }
    else if (typeof b?.pr === "string" && R.splitId(b.pr)) { const id = b.pr;
      if (has(state.watch.prs, id)) state.watch.prs = state.watch.prs.filter((x) => !eq(x, id));
      else if (!has(state.watch.excluded, id)) state.watch.excluded.push(id);
      snap.rows = snap.rows.filter((r) => !eq(r.id, id)); write(snapFile, snap); }
    else throw new Error("Name a repository or a pull request");
    save();
  }
  const validIds = (v: unknown, max = 400) => { if (!Array.isArray(v) || v.length > max) throw new Error("Send a list of pull requests"); const ids = v.map(String); if (ids.some((x) => !R.splitId(x))) throw new Error("A pull request is owner/repo#number"); return ids; };

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
          const dk = Object.keys(state.deps).find((a) => eq(a, t.id)) ?? t.id; state.deps[dk] = { on: t.on, by: "captain", at: iso() };
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

  async function refresh(): Promise<void> {
    const { token } = ensure(); if (!token || !sub) return;
    // a refresh asked while one runs joins it; when the list or settings changed since that one started, read again once
    const want = version, joined = live.refreshing;
    await d.poller.refresh(sub.authority);
    if (sub && (joined || ranVersion < want)) await d.poller.refresh(sub.authority);
  }

  // ---------- routes ----------
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const fail = (e: any, status = 400) => json({ error: String(e?.message ?? e).slice(0, 300), ...(e?.tw ? { tw: e.tw } : {}) }, status);
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname; if (p !== "/api/prs" && !p.startsWith("/api/prs/")) return null;
    if (!writing) {
      if (p === "/api/prs") { ensure(); return json(view()); }
      if (p === "/api/prs/count") return json({ count: count(), refreshedAt: snap.at });
      return json({ error: "not found" }, 404);
    }
    if (who.kind !== "desktop") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    let b: any = {}; try { b = await req.json(); } catch {}
    try {
      switch (p) {
        case "/api/prs/refresh": { const { token } = ensure(); if (!state.watch.repos.length && !state.watch.prs.length) return json(view()); if (!token) return json({ ...view(), error: disabled() ? { en: "The pull request list is off (CREW_PR_WATCH=0)", tw: "PR 列表已關閉（CREW_PR_WATCH=0）" } : { en: "GitHub is not connected: Studio has no token", tw: "GitHub 尚未連線：Studio 沒有權杖" } });
          await refresh().catch(() => {}); return json(view()); }
        case "/api/prs/watch": { const got = watchUrl(b?.url); ensure(); void refresh().catch(() => {}); return json({ ...view(), added: got }); }
        case "/api/prs/unwatch": unwatch(b); ensure(); return json(view());
        case "/api/prs/restore": { if (typeof b?.pr === "string") state.watch.excluded = state.watch.excluded.filter((x) => !eq(x, b.pr)); else state.watch.excluded = []; save(); void refresh().catch(() => {}); return json(view()); }
        case "/api/prs/settings": { state.settings = cleanSettings(b?.settings); settingsWarning = null; save();
          // what the settings change (environments, evidence, which pull requests) is not a change on GitHub: start the marks afresh
          snap.finger = {}; snap.changed = {}; write(snapFile, snap); void refresh().catch(() => {}); return json(view()); }
        case "/api/prs/order": { state.order = validIds(b?.order); save(); return json(view()); }
        case "/api/prs/deps": { const id = String(b?.pr ?? ""); if (!R.splitId(id) || !rowIdsNow().some((r) => eq(r, id))) throw new Error("Choose a pull request in the list");
          const on = validIds(b?.on, 20).filter((o) => !eq(o, id)); const k = Object.keys(state.deps).find((a) => eq(a, id)) ?? id; state.deps[k] = { on: [...new Set(on)], by: "captain", at: iso() }; save(); return json(view()); }
        case "/api/prs/group": { const id = String(b?.pr ?? ""), g = String(b?.group ?? "").trim(); if (!R.splitId(id)) throw new Error("Choose a pull request");
          if (g && !state.settings.groups.includes(g)) throw new Error("Choose one of the release groups in the settings");
          const k = Object.keys(state.groups).find((a) => eq(a, id)) ?? id; if (g) state.groups[k] = g; else delete state.groups[k]; save(); return json(view()); }
        case "/api/prs/accept": { const v = view(); state.order = v.rows.map((r) => r.id);
          for (const r of v.rows) if (r.deps.source === "proposal") state.deps[r.id] = { on: r.deps.on.map((x) => x.id), by: "accepted", at: iso() };
          save(); return json(view()); }
        case "/api/prs/drift/take": { const id = String(b?.pr ?? ""), r = snap.rows.find((x) => eq(x.id, id)); if (!r) throw new Error("Choose a pull request in the list");
          const ak = Object.keys(state.applied).find((a) => eq(a, id)); if (!ak) throw new Error("Studio never wrote a block into this pull request");
          const dk = Object.keys(state.deps).find((a) => eq(a, id)) ?? id;
          if (r.bodyBlock) { state.applied[ak] = { block: r.bodyBlock, on: r.githubDeps ?? [], at: iso() }; state.deps[dk] = { on: r.githubDeps ?? [], by: "github", at: iso() }; }
          else { delete state.applied[ak]; state.deps[dk] = { on: [], by: "github", at: iso() }; }
          save(); return json(view()); }
        case "/api/prs/apply": { const ids = validIds(b?.prs, 50); if (!ids.length) throw new Error("Choose the pull requests to apply");
          const run = await startApply(ids, b?.shortForm === undefined ? state.settings.shortForm : !!b.shortForm); return json({ ok: true, task: run.id, href: `#/run/${run.id}` }); }
      }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return fail(e); }
  }
  return { handle, install, view, count, refresh, ensure, stop: () => { sub?.cancel(); sub = null; }, get state() { return state; }, get snapshot() { return snap; } };
}
