import { scrubEnv } from "./secure";
import {GitHubPoller,readAuthority,grantReadScope,boundedGitHubJSON,type ReadAuthority} from './github-poller';
import type {GitHubProjectGrant} from './adapters/github';
// Open pull requests and their checks for one repository, read with GitHub's
// REST API over fetch: no `gh` CLI needed. GitHub is optional: without a token
// Studio works and shows "GitHub not connected".
// Token, first found wins: CREW_GITHUB_TOKEN / GITHUB_TOKEN / GH_TOKEN; a token
// pasted in Studio (CREW_DATA/github-token, 0600); `gh auth token` if gh happens
// to be installed. Polled every 60 s; a failure backs off (2, 4, 8 … up to 15 min).
//   CREW_GITHUB_API  API base (default https://api.github.com; tests point it at a mock)
//   CREW_GH_FIXTURE  a directory with merged.json (and optionally open.json) instead of the API, for tests
//   CREW_GH_NO_CLI=1 never ask an installed gh for its token
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { registerSecretValues } from "./secure";

export type Check = { name: string; state: string; bucket: string; link: string };
export type Pr = { number: number; title: string; branch: string; head: string; draft: boolean; mergeState: string; updatedAt: string; url: string; checks: Check[] };
export type MergedPr = { number: number; title: string; mergedAt: string; commit: string | null; url: string; branch: string;
  checks: { pass: number; fail: number; other: number } };
export type TokenSource = "env" | "settings" | "gh" | null;
export type GhState = {
  repo: string; enabled: boolean; connected: boolean; tokenSource: TokenSource; ok: boolean; lastSync: string | null; error: string | null;
  backoffUntil: string | null; rateLimited: boolean; prs: Pr[];
};

export const githubHeaders = (token: string | null): Record<string, string> => ({ accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "crew-studio", ...(token ? { authorization: `Bearer ${token}` } : {}) });

const BASE_MS = 60_000, MAX_MS = 15 * 60_000;
export const githubBackoff = (failures: number, base = BASE_MS) => Math.min(MAX_MS, base * 2 ** Math.min(20, Math.max(0, failures)));
export const NOT_CONNECTED = "GitHub not connected";

// Studio's GitHub token, wherever it came from, is a known secret for the one redactor: registered the moment it is read
let tokenSeen: string | null = null;
registerSecretValues(() => [tokenSeen]);
const seen = (v: string) => { tokenSeen = v; return v; };
/** Find a token without asking anyone: env, then Studio's saved token, then an installed gh's. */
// A Studio started from the Dock or launchd may not have Homebrew on its PATH: an unset CREW_GH_BIN also tries gh's usual homes.
const ghCandidates = (bin: string) => process.env.CREW_GH_BIN || bin !== "gh" ? [bin] : ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
export function findToken(dataDir: string, ghBin = process.env.CREW_GH_BIN ?? "gh"): { token: string | null; source: TokenSource } {
  for (const k of ["CREW_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"]) { const v = process.env[k]?.trim(); if (v) return { token: seen(v), source: "env" }; }
  try { const v = readFileSync(join(dataDir, "github-token"), "utf8").trim(); if (v) return { token: seen(v), source: "settings" }; } catch {}
  if (process.env.CREW_GH_NO_CLI !== "1") {
    // gh keeps its token in the macOS keychain and reads it with the user's HOME; it never prompts here
    for (const bin of ghCandidates(ghBin)) try {
      const r = Bun.spawnSync([bin, "auth", "token", "--hostname", "github.com"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 10_000, env: { ...scrubEnv(process.env, ["GH_CONFIG_DIR", "GH_HOST"]), HOME: process.env.HOME || homedir(), GH_PROMPT_DISABLED: "1" } });
      const v = r.success ? r.stdout.toString().trim() : "";
      if (v) return { token: seen(v), source: "gh" };
    } catch { /* gh is not installed there: fine */ }
  }
  return { token: null, source: null };
}

const bucketOf = (status: string, conclusion: string | null) => {
  if (status !== "completed") return "pending";
  const c = (conclusion ?? "").toLowerCase();
  if (["success", "neutral"].includes(c)) return "pass";
  if (c === "skipped") return "skipping";
  if (c === "cancelled") return "cancel";
  return "fail";
};

export class GitHub {
  state: GhState;
  private failures = 0;
  private unsubscribe:(()=>void)|null=null;
  private epoch=0;
  private authority:ReadAuthority|null=null;
  readonly poller:GitHubPoller;
  onChange: (s: GhState) => void = () => {};
  merged: MergedPr[] = [];
  mergedSync: string | null = null;
  private mergedAt = 0;
  private fixture = process.env.CREW_GH_FIXTURE ?? "";
  private token: string | null = null;
  private rollups = new Map<string, MergedPr["checks"]>();
  readonly api = (process.env.CREW_GITHUB_API ?? "https://api.github.com").replace(/\/$/, "");

  constructor(repo: string, enabled: boolean, private dataDir = "",private binding?:{poller:GitHubPoller;grant?:GitHubProjectGrant}) {
    this.poller=binding?.poller??new GitHubPoller();if(binding?.grant)this.api=binding.grant.apiOrigin;
    this.state = { repo, enabled, connected: false, tokenSource: null, ok: false, lastSync: null,
      error: enabled ? null : "GitHub polling is off (CREW_GH=0)", backoffUntil: null, rateLimited: false, prs: [] };
  }

  start() {
    if (this.fixture) { this.loadFixture(); return; }
    if (this.state.enabled) this.connectFromSources();
  }
  stop() {this.epoch++;this.unsubscribe?.();this.unsubscribe=null;this.authority=null;}

  private connectFromSources() {
    const t = findToken(this.dataDir);
    this.token = t.token;
    this.failures = 0;
    this.stop();
    this.state = { ...this.state, enabled: true, connected: !!t.token, tokenSource: t.source, ok: false, lastSync: t.token ? this.state.lastSync : null,
      error: t.token ? null : NOT_CONNECTED, backoffUntil: null, rateLimited: false, prs: t.token ? this.state.prs : [] };
    if (!t.token) this.merged = [];
    this.onChange(this.state);
    if(t.token){const authority=readAuthority(this.api,this.state.repo,this.binding?.grant?grantReadScope(this.binding.grant):{kind:'dashboard'},t.token);this.authority=authority;try{this.unsubscribe=this.poller.subscribe(authority,'dashboard',signal=>this.pollOnce(signal),{interval:BASE_MS});}catch{this.authority=null;this.state={...this.state,ok:false,error:'unsupported conflicting GitHub repository authority'};this.onChange(this.state);}}
  }

  /** Save a pasted token (0600) after checking it can read the repository. */
  async saveToken(token: string): Promise<{ ok: boolean; error?: string }> {
    token = String(token ?? "").trim();
    if (!/^[\w-]{20,255}$/.test(token)) return { ok: false, error: "that does not look like a GitHub token" };
    try {
      const r = await fetch(`${this.api}/repos/${this.state.repo}`, { headers: this.headers(token) });
      if (r.status === 401) return { ok: false, error: "GitHub refused this token (401)" };
      if (!r.ok) return { ok: false, error: `the token cannot read ${this.state.repo} (HTTP ${r.status})` };
    } catch (e: any) { return { ok: false, error: `GitHub is not reachable: ${e?.message ?? e}` }; }
    writeFileSync(join(this.dataDir, "github-token"), token + "\n", { mode: 0o600 });
    this.connectFromSources();
    return { ok: true };
  }
  forgetToken() { rmSync(join(this.dataDir, "github-token"), { force: true }); this.connectFromSources(); }

  private loadFixture() {
    try {
      this.merged = JSON.parse(readFileSync(join(this.fixture, "merged.json"), "utf8"));
      const open = join(this.fixture, "open.json");
      if (existsSync(open)) this.state = { ...this.state, prs: JSON.parse(readFileSync(open, "utf8")) };
      this.mergedSync = new Date().toISOString();
      this.state = { ...this.state, enabled: true, connected: true, tokenSource: "settings", ok: true, lastSync: this.mergedSync, error: null };
    } catch (e: any) { this.state = { ...this.state, ok: false, error: `fixture: ${e?.message ?? e}` }; }
  }

  private headers(token = this.token): Record<string, string> {
    return githubHeaders(token);
  }
  private async get(path: string,signal?:AbortSignal):Promise<any>{if(!this.authority)throw new Error('GitHub polling is stopped');const authority=this.authority,token=this.token;return this.poller.read(authority,path,s=>this.getOwned(path,token,s),signal);}
  private async getOwned(path:string,token:string|null,signal?:AbortSignal):Promise<any>{
    const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),15000);try{const r=await fetch(`${this.api}${path}`,{headers:this.headers(token),signal:signal?AbortSignal.any([signal,timeout.signal]):timeout.signal,redirect:'error'});
    if(!r.ok){await r.body?.cancel();throw new Error(r.status===429||r.status===403&&r.headers.get('x-ratelimit-remaining')==='0'?'API rate limit exceeded':`GitHub ${r.status}`);}return await boundedGitHubJSON(r);}finally{clearTimeout(timer);}
  }

  private async checksFor(sha: string,signal?:AbortSignal): Promise<Check[]> {
    const [runs, status] = await Promise.all([this.get(`/repos/${this.state.repo}/commits/${sha}/check-runs?${this.binding?.grant?'filter=all&per_page=100&page=1':'per_page=100'}`,signal),
      this.get(`/repos/${this.state.repo}/commits/${sha}/status${this.binding?.grant?'?per_page=100&page=1':''}`,signal).catch(() => null)]);
    const out: Check[] = (runs?.check_runs ?? []).map((c: any) => ({ name: String(c.name), state: String(c.conclusion ?? c.status ?? "").toUpperCase(),
      bucket: bucketOf(String(c.status), c.conclusion ?? null), link: String(c.html_url ?? "") }));
    for (const s of status?.statuses ?? []) {
      const b = s.state === "success" ? "pass" : s.state === "pending" ? "pending" : "fail";
      out.push({ name: String(s.context), state: String(s.state).toUpperCase(), bucket: b, link: String(s.target_url ?? "") });
    }
    return out;
  }

  /** Merged pull requests, newest first; refreshed at most every ten minutes. */
  private async refreshMerged(signal?:AbortSignal) {
    if (Date.now() - this.mergedAt < 10 * 60_000) return;
    const list: any[] = await this.get(`/repos/${this.state.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,signal);
    const merged = list.filter((p) => p.merged_at).sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at))).slice(0, 50);
    const out: MergedPr[] = [];
    for (const p of merged) {
      const sha = String(p.head?.sha ?? "");
      let c = this.rollups.get(sha);
      if (!c) {
        c = { pass: 0, fail: 0, other: 0 };
        try { for (const k of await this.checksFor(sha,signal)) { if (k.bucket === "pass" || k.bucket === "skipping") c.pass++; else if (k.bucket === "fail") c.fail++; else c.other++; } this.rollups.set(sha, c); } catch {}
      }
      out.push({ number: p.number, title: String(p.title), mergedAt: String(p.merged_at), commit: p.merge_commit_sha ?? null, url: String(p.html_url), branch: String(p.head?.ref ?? ""), checks: c });
    }
    signal?.throwIfAborted();this.merged = out;
    this.mergedAt = Date.now();
    this.mergedSync = new Date().toISOString();
  }

  /** One poll; exported for tests. */
  async tick(){if(this.authority)await this.poller.refresh(this.authority);}
  private async pollOnce(signal:AbortSignal){
    if(!this.token)return;const epoch=this.epoch;
    let next = BASE_MS;
    try {
      const list: any[] = await this.get(`/repos/${this.state.repo}/pulls?state=open&per_page=30`,signal);
      const prs: Pr[] = [];
      for (const p of list ?? []) {
        let checks: Check[] = this.state.prs.find((q) => q.number === p.number&&q.head===String(p.head?.sha))?.checks ?? [];
        let mergeState = "UNKNOWN";
        try { checks = await this.checksFor(String(p.head?.sha),signal); } catch { /* keep the earlier ones */ }
        try { const one = await this.get(`/repos/${this.state.repo}/pulls/${p.number}`,signal); mergeState = String(one.mergeable_state ?? "unknown").toUpperCase(); } catch {}
        prs.push({ number: p.number, title: String(p.title), branch: String(p.head?.ref ?? ""), head: String(p.head?.sha ?? ""), draft: !!p.draft,
          mergeState, updatedAt: String(p.updated_at), url: String(p.html_url), checks });
      }
      try { await this.refreshMerged(signal); } catch { /* keep the last merged list */ }
      if(signal.aborted||epoch!==this.epoch)return;this.failures = 0;
      this.state = { ...this.state, ok: true, lastSync: new Date().toISOString(), error: null, backoffUntil: null, rateLimited: false, prs };
    } catch (e: any) {
      if(signal.aborted||epoch!==this.epoch)return;this.failures++;
      next = githubBackoff(this.failures);
      const msg = String(e?.message ?? e);
      this.state = { ...this.state, ok: false, error: msg, rateLimited: /rate limit/i.test(msg), backoffUntil: new Date(Date.now() + next).toISOString() };
    }
    this.onChange(this.state);
    if(this.state.error)throw new Error('GitHub polling unavailable');
  }
}
