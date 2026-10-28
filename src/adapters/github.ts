import {AsyncLocalStorage} from 'node:async_hooks';
import {GitHubPoller,readAuthority,grantReadScope} from '../github-poller';
// Local review remains the default. GitHub publication requires a trusted,
// exact project grant; this interface exposes no review/comment/merge endpoint.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { gitArgv, gitEnv } from "../git";
import { githubHeaders, findToken } from "../github";
import type { RemoteGit } from "../worktrees";
import { registerSecretValues, redactText } from "../secure";

export type ReviewRequest = { id: string; adapter: "local" | "github"; repo: string; base: string; branch: string; head: string; title: string; body: string; openedAt: string; url: string | null };
type OpenRequest = Omit<ReviewRequest, "id" | "adapter" | "openedAt" | "url"> & {draft?:true};
export interface PrAdapter {
  readonly id: "local" | "github";
  open(o: OpenRequest, runDir: string, signal?: AbortSignal, assertOwner?: () => void): Promise<ReviewRequest>;
  update(pr: ReviewRequest, head: string, runDir: string, signal?: AbortSignal, assertOwner?: () => void): Promise<ReviewRequest>;
}
const persist = (dir: string, pr: ReviewRequest) => {
  const tmp = join(dir, `pr.json.${crypto.randomUUID()}.tmp`);
  try { writeFileSync(tmp, JSON.stringify(pr, null, 1), { mode: 0o600 }); renameSync(tmp, join(dir, "pr.json")); }
  finally { rmSync(tmp, { force: true }); }
};
export class LocalPrAdapter implements PrAdapter {
  readonly id = "local" as const;
  async open(o: OpenRequest, runDir: string, signal?: AbortSignal, assertOwner?: () => void) {
    const pr: ReviewRequest = { ...o, id: `local:${o.branch}`, adapter: "local", openedAt: new Date().toISOString(), url: null };
    signal?.throwIfAborted(); assertOwner?.();persist(runDir, pr); return pr;
  }
  async update(pr: ReviewRequest, head: string, runDir: string, signal?: AbortSignal, assertOwner?: () => void) { const n = { ...pr, head }; signal?.throwIfAborted(); assertOwner?.();persist(runDir, n); return n; }
}

/** Trusted project-file metadata, not accepted by project-add or run parameters.
 * approvedAt/approvalId must name the captain's project/remote grant. Sensitivity
 * approval is separate and never enables GitHub writes. */
export type RemoteOperations = { version: 1; repository: string; approvalId: string; approvedAt: string; mergeMethod: "merge" | "squash" | "rebase"; enableRealWrites?: boolean };
export type GitHubProjectGrant = {
  mode: "github" | "simulator"; repository: string; localPath: string;
  pushUrl: string; apiOrigin: string; base: string; branchPrefix: string;
  approvedAt: string; approvalId: string; operations?: RemoteOperations;
  /** Studio's signature over this grant and the project it was approved for (src/github-grant.ts) */
  signature?: string;
};
// Ambient Git variables can redirect the repository or inject config/trace
// helpers. Retain only Studio's deliberately constructed Git settings.
export function publicationEnv(extra: Record<string, string> = {}) {
  const env = gitEnv(); const keep = new Set(["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT"]);
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !keep.has(key) || key === "SSH_ASKPASS") delete env[key];
  return { ...env, ...extra };
}
function localGit(cwd: string, args: string[]) {
  const r = Bun.spawnSync(gitArgv(args), { cwd, env: publicationEnv(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { ok: r.success, out: r.stdout.toString().trim() };
}
function localMust(cwd: string, args: string[]) { const r = localGit(cwd, args); if (!r.ok) throw new Error("GitHub local Git preparation failed"); return r.out; }
const slug = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const sha = /^[a-f0-9]{40}$/;
const ref = (s: string) => typeof s === "string" && s.length < 240 && !s.startsWith("-") && localGit(process.cwd(), ["check-ref-format", "--branch", s]).ok;
export type MergeMethod = "merge" | "squash" | "rebase";
export const MERGE_METHODS: MergeMethod[] = ["squash", "merge", "rebase"];
/** What the read-only probe before a merge grant found: what is missing (empty: nothing GitHub shows is missing), the merge
 *  methods the repository allows (null: GitHub did not show them), the one Studio offers first, and what GitHub cannot show. */
export type MergeAccess = { missing: { en: string; zh: string }[]; methods: MergeMethod[] | null; preferred: MergeMethod; role: string | null;
  token: "classic" | "fine-grained" | "app" | "oauth" | "other"; scopes: string[] | null; unseen: { en: string; zh: string } | null };
/** The probe's verdict from GitHub's repository answer as the token sees it (GET /repos/<owner/repo>), its X-OAuth-Scopes header
 *  (classic and OAuth tokens only) and the token's kind (by its prefix; the token itself never leaves). Merging a pull request
 *  needs write access to the repository: the role (push, maintain or admin), and for a classic token the repo scope (public_repo
 *  on a public repository). A fine-grained token or a GitHub App shows its role, not its own permissions: Contents and Pull
 *  requests write stay GitHub's to enforce at the merge, and the card says so. */
export function mergeAccessOf(repository: string, repo: any, scopesHeader: string | null, token: MergeAccess["token"]): MergeAccess {
  if (!repo || typeof repo !== "object" || String(repo.full_name ?? "").toLowerCase() !== repository.toLowerCase()) throw new Error("GitHub showed another repository than the granted one");
  const missing: MergeAccess["missing"] = [], p = repo.permissions;
  const role = p && typeof p === "object" ? (p.admin === true ? "admin" : p.maintain === true ? "maintain" : p.push === true ? "push" : p.triage === true ? "triage" : p.pull === true ? "pull" : "none") : null;
  if (!role) missing.push({ en: `GitHub does not show this token's permissions on ${repository}; merging needs write access (Contents and Pull requests: write)`, zh: `GitHub 沒有顯示這個權杖在 ${repository} 的權限；合併需要寫入權限（Contents 與 Pull requests：write）` });
  else if (!["admin", "maintain", "push"].includes(role)) missing.push({ en: `write access to ${repository}: the token's account or app has ${role} access only; merging needs Contents and Pull requests: write`, zh: `${repository} 的寫入權限：這個權杖的帳號或 app 只有 ${role} 權限；合併需要 Contents 與 Pull requests：write` });
  const scopes = typeof scopesHeader === "string" ? scopesHeader.split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (scopes && !scopes.includes("repo") && !(repo.private === false && scopes.includes("public_repo"))) missing.push({ en: `the token's ${repo.private === false ? "repo or public_repo" : "repo"} scope (it has ${scopes.join(", ") || "no scope"})`, zh: `權杖的 ${repo.private === false ? "repo 或 public_repo" : "repo"} scope（目前是 ${scopes.join("、") || "沒有 scope"}）` });
  const flags: Record<MergeMethod, string> = { merge: "allow_merge_commit", squash: "allow_squash_merge", rebase: "allow_rebase_merge" };
  const shown = MERGE_METHODS.every((m) => typeof repo[flags[m]] === "boolean"), methods = shown ? MERGE_METHODS.filter((m) => repo[flags[m]] === true) : null;
  if (methods && !methods.length) missing.push({ en: `a merge method: ${repository} allows none of merge, squash or rebase`, zh: `合併方式：${repository} 不允許 merge、squash 或 rebase 任何一種` });
  const unseen = token === "fine-grained" || token === "app" ? { en: `GitHub shows the ${token === "app" ? "app's" : "token's account"} role on ${repository} (${role ?? "unknown"}), not a ${token === "app" ? "GitHub App installation's" : "fine-grained token's"} own permissions: it needs Contents: write and Pull requests: write, or GitHub refuses the merge (Studio records the refusal; nothing else is written).`,
    zh: `GitHub 只顯示${token === "app" ? " app " : "權杖帳號"}在 ${repository} 的角色（${role ?? "未知"}），不顯示${token === "app" ? " GitHub App 安裝" : "細粒度權杖"}本身的權限：它需要 Contents：write 與 Pull requests：write，否則 GitHub 會拒絕合併（Studio 會記下拒絕，不會寫入其他東西）。` } : null;
  return { missing, methods, preferred: (methods ?? MERGE_METHODS).find((m) => m === "squash") ?? (methods ?? MERGE_METHODS)[0] ?? "squash", role, token, scopes, unseen };
}
/** The token's kind by its documented prefix (classic ghp_, fine-grained github_pat_, app installation ghs_, OAuth gho_). */
export const tokenKind = (t: string): MergeAccess["token"] => t.startsWith("github_pat_") ? "fine-grained" : t.startsWith("ghp_") ? "classic" : t.startsWith("ghs_") ? "app" : t.startsWith("gho_") ? "oauth" : "other";

export function validateGitHubGrant(g: GitHubProjectGrant) {
  if (!g || !["github", "simulator"].includes(g.mode) || !slug.test(g.repository) || !g.approvalId?.trim() || !Number.isFinite(Date.parse(g.approvedAt))) throw new Error("GitHub requires an explicit approved project remote grant");
  if (!g.localPath?.startsWith("/") || !existsSync(join(g.localPath, ".git")) || !ref(g.base) || !g.branchPrefix?.endsWith("/") || !ref(g.branchPrefix + "probe")) throw new Error("invalid GitHub project repository, base or branch prefix");
  let u: URL; try { u = new URL(g.apiOrigin); } catch { throw new Error("invalid GitHub API origin"); }
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/") throw new Error("GitHub API origin must contain no credentials or path");
  if (g.mode === "github") {
    if (g.apiOrigin !== "https://api.github.com" || g.pushUrl !== `https://github.com/${g.repository}.git`) throw new Error("GitHub grant must name the exact HTTPS GitHub repository and API");
  } else if (u.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(u.hostname) || !g.pushUrl?.startsWith("/") || !existsSync(join(g.pushUrl, "HEAD")) || !existsSync(join(g.pushUrl, "objects"))) throw new Error("simulator grant requires loopback API and an existing absolute bare repository");
}

// Node's detached POSIX spawn creates a new session/process group. Keep it
// owned until cleanup; Studio exit kills only groups it actually created.
// https://nodejs.org/api/child_process.html#optionsdetached
const gitGroups = new Set<number>();
/** one pull request fetch at a time per review room cache (GitHubPrAdapter.fetchPull) */
const pullFetches = new Map<string, Promise<void>>();
process.once("exit", () => { for (const pid of gitGroups) try { process.kill(-pid, "SIGKILL"); } catch {} });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function ownedGit(argv: string[], cwd: string, env: Record<string, string>, timeoutMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (process.platform === "win32") throw new Error("GitHub publication requires supported owned POSIX process groups");
  const p = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const pid = p.pid;
  if (pid) gitGroups.add(pid);
  let stdout = "", bytes = 0, exited = false;
  let end: (result: { code: number | null; failed: boolean }) => void;
  const ended = new Promise<{ code: number | null; failed: boolean }>(resolve => { end = resolve; });
  const exit = new Promise<void>(resolve => {
    p.once("exit", code => { exited = true; end({ code, failed: false }); resolve(); });
    p.once("error", () => { exited = true; end({ code: null, failed: true }); resolve(); });
  });
  p.stdout?.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1_000_000) end({ code: null, failed: true }); else stdout += chunk.toString("utf8"); });
  p.stdout?.on("error", () => end({ code: null, failed: true }));
  p.stderr?.on("error", () => end({ code: null, failed: true }));
  p.stderr?.on("data", () => {}); // drain without retaining private Git error output
  const onAbort = () => end({ code: null, failed: true }); signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) onAbort();
  const timer = setTimeout(() => end({ code: null, failed: true }), timeoutMs);
  const groupSignal = async (sig: NodeJS.Signals) => {
    if (!pid) return;
    // Darwin reports EPERM for a zombie-only group until its reaper finishes.
    // Retry only that transient state; a lasting denial still fails closed.
    const deadline = Date.now() + 300;
    for (;;) {
      try { process.kill(-pid, sig); return; }
      catch (e: any) {
        if (e.code === "ESRCH") return;
        if (e.code !== "EPERM" || Date.now() >= deadline) throw new Error("GitHub owned process cleanup failed");
        await delay(5);
      }
    }
  };
  const alive = () => { if (!pid) return false; try { process.kill(-pid, 0); return true; } catch (e: any) { return e.code !== "ESRCH"; } };
  const result = await ended; clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
  try {
    if (result.failed) { await groupSignal("SIGTERM"); await delay(25); }
    await groupSignal("SIGKILL");
    // Pipes are not a lifetime signal: helpers inherit them. Bound the buffered
    // drain after killing the owned group, then close our endpoints explicitly.
    await delay(10); p.stdout?.destroy(); p.stderr?.destroy();
    if (!exited) await Promise.race([exit, delay(200)]);
    const deadline = Date.now() + 300;
    while (alive() && Date.now() < deadline) await delay(5);
    if (!exited || alive()) { const error = new Error("GitHub owned process cleanup incomplete; temporary client retained"); (error as any).retainClient = true; throw error; }
    if (pid) gitGroups.delete(pid);
    if (result.failed || result.code !== 0) throw new Error("GitHub push or lease check failed (remote changed, authentication or timeout)");
    return stdout.trim();
  } catch (e: any) { if (alive()) e.retainClient = true; throw e; }
}

// Abort the owned request first: body cancellation itself must not keep a bad
// streaming response alive. Keep cancellation awaited but bounded before the
// request is reported settled; never abort the shared repository controller.
async function disposeOwnedResponse(response:Response|null,controller:AbortController){
  controller.abort();if(!response?.body)return;let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([response.body.cancel().catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{if(timer)clearTimeout(timer);}
}

async function boundedBytes(response: Response, cap: number) {
  const reader = response.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let count = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.byteLength; if (count > cap) throw new Error("GitHub response exceeds limit"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {});reader.releaseLock(); }
  const bytes = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
async function boundedResponse(response: Response, cap: number) { return new TextDecoder().decode(await boundedBytes(response, cap)); }

async function abortableDelay(ms: number, signal?: AbortSignal) { signal?.throwIfAborted(); await new Promise<void>((resolve, reject) => { const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(new Error("remote operation owner cancelled")); }; const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms); signal?.addEventListener("abort", onAbort, { once: true }); if (signal?.aborted) onAbort(); }); }

export class GitHubPrAdapter implements PrAdapter {
  readonly id = "github" as const;
  private readOwners=new AsyncLocalStorage<GitHubPoller>();
  withReadOwner<T>(poller:GitHubPoller,run:()=>Promise<T>){if(this.poller&&this.poller!==poller)throw new Error("conflicting GitHub polling registry");return this.readOwners.run(poller,run);}
  private tokenValue: string | null = null;
  private active = new Set<string>();
  private named = new Map<string, string>();
  private operationData: string | null = null;
  grantIdentity() { return createHash("sha256").update(JSON.stringify(this.grant)).digest("hex"); }
  bindOperationStore(dataDir: string) { this.operationData ??= resolve(dataDir); }
  operationStore() { if (!this.operationData) throw new Error("trusted Studio operation store is required"); return this.operationData; }
  clearNaming() { this.named.clear(); }
  readonly grant: GitHubProjectGrant;
  get publicationOwners() { return this.active.size; }
  readonly poller?: GitHubPoller;
  constructor(grant: GitHubProjectGrant, readonly token: () => string | null, readonly timeoutMs = 15_000, operationDataOrPoller?: string | GitHubPoller, poller?: GitHubPoller) {
    const operationData = typeof operationDataOrPoller === "string" ? operationDataOrPoller : undefined;
    this.poller = typeof operationDataOrPoller === "string" ? poller : operationDataOrPoller ?? poller;
    validateGitHubGrant(grant);
    if (operationData) this.bindOperationStore(operationData);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) throw new Error("invalid GitHub request timeout");
    this.grant = Object.freeze({ ...grant, ...(grant.operations ? { operations: Object.freeze({ ...grant.operations }) } : {}) });
    registerSecretValues(() => [this.tokenValue]);
  }
  readAuthority(){return readAuthority(this.grant.apiOrigin,this.grant.repository,grantReadScope(this.grant),this.credential());}
  private credential() {
    const t = this.token()?.trim(); if (!t || /[\r\n]/.test(t)) throw new Error("GitHub authentication is required");
    this.tokenValue = t; return t;
  }
  /** Only a private config path crosses the process boundary; KERN_PROCARGS2 exposes argv and env. */
  private gitAuth(): Record<string, string> {
    if (this.grant.mode !== "github") return {};
    const token = this.credential();
    const dir = join(this.operationStore(), "private-git-auth");
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const path = join(dir, `${createHash("sha256").update(this.grantIdentity()).digest("hex")}.config`);
    const tmp = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, `[http "https://github.com/"]\n\textraHeader = Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}\n[credential]\n\thelper =\n`, { mode: 0o600 });
      renameSync(tmp, path);
    } finally { rmSync(tmp, { force: true }); }
    return { GIT_CONFIG_GLOBAL: path };
  }
  /** Remote git reads of the granted repository from outside the adapter (a round's durable head):
   * only the grant's pushUrl, never what the project's origin says, with the same authentication. */
  remoteGit(): RemoteGit {
    validateGitHubGrant(this.grant);
    const env = publicationEnv(this.gitAuth());
    return { url: this.grant.pushUrl, repo: this.grant.localPath, env, fileProtocol: this.grant.mode === "simulator", secrets: this.tokenValue && this.grant.mode === "github" ? [this.tokenValue, Buffer.from(`x-access-token:${this.tokenValue}`).toString("base64")] : [] };
  }
  /** The complete allowlist; arbitrary URLs and generic request methods are not exposed. */
  private async api(method: "GET" | "POST" | "PATCH", suffix: string, body?: Record<string, any>, signal?: AbortSignal, assertOwner?: () => void) {
    assertOwner?.();signal?.throwIfAborted();
    const allowed = ["GET", "POST", "PATCH"].includes(method) && (method === "GET" ? /^\/(?:pulls\?[a-zA-Z0-9%=&_.+-]+|pulls\/[1-9][0-9]*)$/ : method === "POST" ? suffix === "/pulls" : /^\/pulls\/[1-9][0-9]*$/.test(suffix));
    if (!allowed) throw new Error("GitHub endpoint is not allowlisted");
    if (method !== "GET") {
      const fields = method === "POST" ? ["title", "body", "head", "base"] : !body || "title" in body || "body" in body ? ["title", "body", "base"] : ["base"]; // a PATCH sends the title and text together, or the base alone
      if (!body || Object.keys(body).length !== fields.length+Number(method==="POST"&&body.draft===true) || !fields.every(k => typeof body[k] === "string") || Object.keys(body).some(k => !fields.includes(k)&&!(method==="POST"&&k==="draft"&&body[k]===true))) throw new Error("GitHub request body is not allowlisted");
    } else if (body !== undefined) throw new Error("GitHub GET does not accept a body");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response:Response|null=null;
    try {
      const r = response = await fetch(`${this.grant.apiOrigin}/repos/${this.grant.repository}${suffix}`, { method, headers: { ...githubHeaders(this.credential()), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, redirect: "error" });
      // Never return vendor error text, which can echo credentials or private data.
      if (!r.ok) throw new Error(`GitHub ${r.status}${r.status === 403 || r.status === 429 ? " (authorization or rate limit; retry after resolving)" : ""}`);
      const text = await boundedResponse(r, 1_000_000);
      assertOwner?.();return JSON.parse(text);
    } catch (e: any) { throw new Error(e?.message?.startsWith("GitHub ") ? e.message : "GitHub request failed or timed out"); }
    finally { await disposeOwnedResponse(response,controller);clearTimeout(timer); }
  }
  branchAllowed(branch: string, head?: string) { return typeof branch === "string" && (branch.startsWith(this.grant.branchPrefix) || (typeof head === "string" && this.named.get(branch) === head)); }
  /** Runtime-only restoration after a verified captain naming card. */
  approveBranch(branch: string, head: string, grant: string) { if (!ref(branch) || !sha.test(head) || grant !== this.grantIdentity()) throw new Error("invalid approved branch capability"); this.named.set(branch, head); }
  operationGrant() {
    const o = this.grant.operations;
    if (!o || o.version !== 1 || o.repository !== this.grant.repository || !o.approvalId?.trim() || !Number.isFinite(Date.parse(o.approvedAt)) || !["merge", "squash", "rebase"].includes(o.mergeMethod) || (this.grant.mode === "github" && o.enableRealWrites !== true)) throw new Error("remote mutation requires an explicit captain-named repository operation grant");
    return o;
  }
  recordedIdentity(pr: any) {
    return !!pr && pr.adapter === "github" && pr.repo === this.grant.localPath && pr.base === this.grant.base && typeof pr.branch === "string" && ref(pr.branch) && this.branchAllowed(pr.branch, pr.head) && typeof pr.id === "string" && /^[1-9][0-9]*$/.test(pr.id) && Number.isSafeInteger(Number(pr.id)) && sha.test(pr.head) && pr.url === `https://github.com/${this.grant.repository}/pull/${pr.id}`;
  }
  /** Typed, grant-bound read surface. No arbitrary endpoint or URL is accepted. */
  private communityPins=new Map<string,{repository:string;head:string;source:'repository'|'owner'}>();
  /** Fixed repository/community paths only. Public owner defaults never receive credentials. */
  private async communityRequest(source:'repository'|'owner',suffix:string,signal?:AbortSignal){
    const repository=source==='repository'?this.grant.repository:this.grant.repository.split('/')[0]+'/.github';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);let response:Response|null=null;
    try{response=await fetch(`${this.grant.apiOrigin}/repos/${repository}${suffix}`,{headers:githubHeaders(source==='repository'?this.credential():null),redirect:'error',signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal});if(response.status===404)return null;if(!response.ok)throw new Error(`GitHub ${response.status}`);return JSON.parse(await boundedResponse(response,1_000_000));}catch(e:any){throw new Error(/^GitHub \d+$/.test(e?.message)?e.message:'GitHub community read failed or timed out');}finally{await disposeOwnedResponse(response,controller);clearTimeout(timer);}
  }
  async communitySnapshot(source:'repository'|'owner',signal?:AbortSignal){
    if(!['repository','owner'].includes(source))throw new Error('Invalid community source');const repository=source==='repository'?this.grant.repository:this.grant.repository.split('/')[0]+'/.github',meta=await this.communityRequest(source,'',signal);if(meta===null){if(source==='owner')return null;throw new Error('Repository unavailable');}if(meta.full_name!==repository||!ref(meta.default_branch)||source==='owner'&&(meta.private!==false||meta.visibility!=='public'))throw new Error('Community source identity/public visibility unverified');const commit=await this.communityRequest(source,`/commits/${encodeURIComponent(meta.default_branch)}`,signal);if(!sha.test(commit?.sha))throw new Error('Community default branch identity unverified');const pin={repository,head:commit.sha,source};this.communityPins.set(repository+'@'+commit.sha,pin);return structuredClone(pin);
  }
  async communityContent(pin:{repository:string;head:string;source:'repository'|'owner'},path:string,signal?:AbortSignal){
    const known=this.communityPins.get(pin?.repository+'@'+pin?.head);if(!known||JSON.stringify(known)!==JSON.stringify(pin)||typeof path!=='string'||path.length>300||path.split('/').some(p=>p==='..'||p==='.'||!p)||!/^((\.github|docs)\/)?(pull_request_template\.md|PULL_REQUEST_TEMPLATE(\/[A-Za-z0-9_.-]+\.md)?|CONTRIBUTING\.md|ISSUE_TEMPLATE(\.[Mm][Dd]|\/[A-Za-z0-9_.-]+\.(md|ya?ml))?|AGENTS\.md)$/i.test(path))throw new Error('Community content target is not allowlisted');
    return this.communityRequest(pin.source,`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${pin.head}`,signal);
  }
  async remoteRead(kind: "pull" | "ref" | "base" | "repository" | "protection" | "policy" | "checks" | "statuses" | "reviews" | "inline-comments" | "issue-comments" | "issues" | "closed-issues" | "open-pulls" | "pull-files", target: string, page = 1, signal?: AbortSignal, approvedHeadOrFresh?: string | boolean, fresh=false): Promise<any> {
    const approvedHead = typeof approvedHeadOrFresh === "string" ? approvedHeadOrFresh : undefined;
    if (typeof approvedHeadOrFresh === "boolean") fresh = approvedHeadOrFresh;
    signal?.throwIfAborted();
    if (!Number.isInteger(page) || page < 1 || page > 50) throw new Error("GitHub pagination limit");
    let suffix: string;
    if (kind === "repository" && target === this.grant.repository && page === 1) suffix = "";
    else if (kind === "base" && target === this.grant.base && page === 1) suffix = `/git/ref/heads/${encodeURIComponent(target)}`;
    else if (kind === "pull" && /^[1-9][0-9]*$/.test(target) && page === 1) suffix = `/pulls/${target}`;
    else if (["reviews","inline-comments","issue-comments"].includes(kind) && /^[1-9][0-9]*$/.test(target)) suffix = kind==="issue-comments"?`/issues/${target}/comments?per_page=100&page=${page}`:`/pulls/${target}/${kind==="reviews"?"reviews":"comments"}?per_page=100&page=${page}`;
    // the files a pull request changes (the review room reads a pull request by its URL: src/domain/review-room.ts)
    else if (kind === "pull-files" && /^[1-9][0-9]*$/.test(target)) suffix = `/pulls/${target}/files?per_page=100&page=${page}`;
    // the open issues of the granted repository, oldest first (src/domain/issue-triage.ts snapshots them)
    else if (kind === "issues" && target === this.grant.repository) suffix = `/issues?state=open&sort=created&direction=asc&per_page=50&page=${page}`;
    // what triage checks before investigating (read only): the recently closed issues (one page) and the open pull requests
    else if (kind === "closed-issues" && target === this.grant.repository && page === 1) suffix = `/issues?state=closed&sort=updated&direction=desc&per_page=50&page=1`;
    else if (kind === "open-pulls" && target === this.grant.repository) suffix = `/pulls?state=open&per_page=30&page=${page}`;
    else if (kind === "ref" && ref(target) && this.branchAllowed(target, approvedHead) && page === 1) suffix = `/git/ref/heads/${encodeURIComponent(target)}`;
    else if (kind === "protection" && target === this.grant.base && page === 1) suffix = `/branches/${encodeURIComponent(target)}/protection`;
    else if (kind === "policy" && target === this.grant.base && page === 1) suffix = `/branches/${encodeURIComponent(target)}/protection/required_status_checks`;
    else if ((kind === "checks" || kind === "statuses") && sha.test(target)) suffix = `/commits/${target}/${kind === "checks" ? "check-runs?filter=all&" : "status?"}per_page=100&page=${page}`;
    else throw new Error("GitHub read target is not allowlisted");
    return this.readResponse(suffix, signal,fresh);
  }
  private async readResponse(suffix:string,signal?:AbortSignal,fresh=false):Promise<any>{const token=this.credential(),authority=readAuthority(this.grant.apiOrigin,this.grant.repository,grantReadScope(this.grant),token);const poller=this.poller??this.readOwners.getStore();return poller?poller.read(authority,`/repos/${this.grant.repository}${suffix}`,s=>this.readResponseOwned(suffix,token,s),signal,fresh):this.readResponseOwned(suffix,token,signal);}
  private async readResponseOwned(suffix: string, token:string, signal?: AbortSignal) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response:Response|null=null;
    try {
      response = await fetch(`${this.grant.apiOrigin}/repos/${this.grant.repository}${suffix}`, { headers: githubHeaders(token), redirect: "error", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
      if (!response.ok) {
        // branch protection GitHub will not show: a private repository on a free plan (403 "Upgrade to GitHub Pro …")
        // or a branch with no protection (404 "Branch not protected"); only the class leaves, never the vendor text
        if (/\/protection(?:\/required_status_checks)?$/.test(suffix) && (response.status === 403 || response.status === 404)) {
          let message = ""; try { message = String(JSON.parse(await boundedResponse(response, 64_000))?.message ?? ""); } catch {}
          if (response.status === 403 && /upgrade to github pro|make this repository public/i.test(message)) throw new Error("GitHub 403 protection-plan");
          if (response.status === 404 && /branch not protected/i.test(message)) throw new Error("GitHub 404 protection-none");
        }
        // out of API calls, not out of permission: the caller can say which (issue triage's pull request read does)
        if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") throw new Error("GitHub 403 rate-limited");
        throw new Error(`GitHub ${response.status}`);
      }
      return JSON.parse(await boundedResponse(response, 1_000_000));
    } catch (e: any) { throw new Error(/^GitHub \d+(?: protection-(?:plan|none)| rate-limited)?$/.test(e?.message) ? e.message : "GitHub read failed or timed out"); }
    finally { await disposeOwnedResponse(response,controller);clearTimeout(timer); }
  }
  /** The read-only probe before the captain grants merging (src/github-merge-grant.ts): one GET of the granted repository with
   *  the grant's token, read fresh (its scopes header is part of the answer), never through the shared poller's cache. */
  async mergeAccess(signal?: AbortSignal): Promise<MergeAccess> {
    const token = this.credential(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response | null = null;
    try {
      response = await fetch(`${this.grant.apiOrigin}/repos/${this.grant.repository}`, { headers: githubHeaders(token), redirect: "error", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
      if (!response.ok) throw new Error(`GitHub ${response.status}`);
      const scopes = response.headers.get("x-oauth-scopes"), repo = JSON.parse(await boundedResponse(response, 1_000_000));
      return mergeAccessOf(this.grant.repository, repo, scopes, tokenKind(token));
    } catch (e: any) { throw new Error(/^GitHub (\d+|showed another)/.test(e?.message) ? e.message : "GitHub read failed or timed out"); }
    finally { await disposeOwnedResponse(response, controller); clearTimeout(timer); }
  }
  async jobLog(id: number, start: number, end: number, signal?: AbortSignal): Promise<{ classification: string; text?: string; start?: number; end?: number; total?: number }> {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start >= 65_536) throw new Error("invalid GitHub log range");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs), combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let response:Response|null=null,download:Response|null=null;
    try {
      response = await fetch(`${this.grant.apiOrigin}/repos/${this.grant.repository}/actions/jobs/${id}/logs`, { headers: githubHeaders(this.credential()), redirect: "manual", signal: combined });
      if (response.status !== 302) { await response.body?.cancel(); return { classification: response.status === 416 ? "range-unsatisfiable" : "unsupported-log-download" }; }
      const location = response.headers.get("location"); await response.body?.cancel(); let url: URL;
      try { url = new URL(location ?? ""); } catch { throw new Error("GitHub log redirect refused"); }
      // GitHub log downloads use its owned blob service. Simulator only permits
      // its exact granted loopback origin, never a general test URL bypass.
      const allowed = this.grant.mode === "simulator" ? url.origin === this.grant.apiOrigin : url.protocol === "https:" && /^(?:[a-z0-9-]+\.)+(?:blob\.core\.windows\.net|githubusercontent\.com)$/.test(url.hostname);
      if (!allowed || url.username || url.password || url.hash) throw new Error("GitHub log redirect refused");
      download = await fetch(url, { headers: { range: `bytes=${start}-${end}` }, redirect: "manual", signal: combined });
      if (download.status === 416) { await download.body?.cancel(); return { classification: "range-unsatisfiable" }; }
      if (download.status !== 206) { await download.body?.cancel(); return { classification: "unsupported-range" }; }
      const m = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(download.headers.get("content-range") ?? "");
      if (!m || Number(m[1]) !== start || Number(m[2]) > end || Number(m[2]) < start || Number(m[3]) <= Number(m[2])) throw new Error("GitHub log Content-Range refused");
      const bytes = await boundedBytes(download, end - start + 1);
      if (bytes.length !== Number(m[2]) - start + 1) throw new Error("GitHub log byte length refused");
      return { classification: "range", text: redactText(new TextDecoder().decode(bytes), [this.tokenValue]).replace(/https:\/\/[^\s<>"']+\?[^\s<>"']+/g, "[download URL redacted]"), start, end: Number(m[2]), total: Number(m[3]) };
    } catch (e: any) { throw new Error(e?.message?.startsWith("GitHub log") ? e.message : "GitHub log read failed or timed out"); }
    finally { await disposeOwnedResponse(download??response,controller);clearTimeout(timer); }
  }
  async mutationState(pr: ReviewRequest, signal?: AbortSignal, assertOwner?: () => void) {
    pr=structuredClone(pr);if (!this.recordedIdentity(pr)) throw new Error("recorded remote mutation identity is invalid");
    assertOwner?.();const p = await this.remoteRead("pull", pr.id, 1, signal, true);assertOwner?.();
    if (p.number !== Number(pr.id) || p.state !== "open" || p.head?.ref !== pr.branch || p.head?.sha !== pr.head || p.head?.repo?.full_name !== this.grant.repository || p.base?.ref !== pr.base || p.base?.repo?.full_name !== this.grant.repository || !sha.test(p.base?.sha)) throw new Error("remote PR target/head changed or closed");
    const r = await this.remoteRead("ref", pr.branch, 1, signal, pr.head, true);assertOwner?.(); if (r.object?.sha !== pr.head || r.ref !== `refs/heads/${pr.branch}`) throw new Error("remote branch head changed");
    return p;
  }
  private async put(pr: ReviewRequest, operation: "update-branch" | "merge", body: Record<string, string>, signal?: AbortSignal) {
    if(!["merge","update-branch"].includes(operation))throw new Error("remote mutation is not allowlisted");
    this.operationGrant(); signal?.throwIfAborted(); if (!this.recordedIdentity(pr)) throw new Error("invalid remote operation target");
    // a squash or merge commit may carry the Task's curated title and message (GitHub's optional commit_title, commit_message)
    const keys = operation === "merge" ? ["sha", "merge_method", ...["commit_title", "commit_message"].filter(k => k in body)] : ["expected_head_sha"];
    if (Object.keys(body).length !== keys.length || !keys.every(k => typeof body[k] === "string") || (operation === "merge" && ("commit_title" in body || "commit_message" in body) && body.merge_method === "rebase") || (body.sha ?? body.expected_head_sha) !== pr.head || (operation === "merge" && body.merge_method !== this.operationGrant().mergeMethod)) throw new Error("remote mutation body is not allowlisted");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response | null = null;
    try { response = await fetch(`${this.grant.apiOrigin}/repos/${this.grant.repository}/pulls/${pr.id}/${operation}`, { method: "PUT", headers: { ...githubHeaders(this.credential()), "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
      if (!response.ok || operation === "merge" && response.status !== 200) throw new Error(`GitHub operation ${response.status}`); const result = JSON.parse(await boundedResponse(response, 1_000_000)); signal?.throwIfAborted(); return result;
    } catch (e: any) { throw new Error(/^GitHub operation [0-9]+$/.test(e?.message) ? e.message : "GitHub operation failed or response is uncertain"); } finally { await disposeOwnedResponse(response,controller); clearTimeout(timer); }
  }
  async updateBranch(pr: ReviewRequest, signal?: AbortSignal, assertOwner?: () => void) {
    pr=structuredClone(pr);assertOwner?.();this.operationGrant(); const p = await this.mutationState(pr, signal,assertOwner);assertOwner?.();
    if (p.mergeable !== true || p.mergeable_state !== "behind") throw new Error("update-branch requires BEHIND and MERGEABLE");
    const result = await this.put(pr, "update-branch", { expected_head_sha: pr.head }, signal);assertOwner?.();
    if (typeof result.message !== "string") throw new Error("invalid update-branch acknowledgement");
    // Accepted updates can finish asynchronously. Reads are bounded by the
    // adapter timeout; a restart never submits the mutation again implicitly.
    const deadline = Date.now() + this.timeoutMs;
    do { assertOwner?.();const next = await this.remoteRead("pull", pr.id, 1, signal, true);assertOwner?.(); if (next.head?.sha !== pr.head) {
      const updated = { ...pr, head: next.head?.sha }; if (next.number !== Number(pr.id) || (!sha.test(updated.head) || !this.recordedIdentity({...updated,head:pr.head})) || next.state !== "open" || next.base?.ref !== pr.base || next.base?.repo?.full_name !== this.grant.repository || next.head?.ref !== pr.branch || next.head?.repo?.full_name !== this.grant.repository || !sha.test(next.base?.sha)) throw new Error("updated PR target is invalid"); return { pr: updated, baseHead: next.base.sha };
    } await abortableDelay(25, signal);assertOwner?.(); } while (Date.now() < deadline);
    throw new Error("update-branch completion is uncertain");
  }
  /** Read-only verification of an owned update result. The original naming
   * capability permits observing this branch, never writing its new head. */
  async verifyUpdateResult(old: ReviewRequest, next: {pr: ReviewRequest; baseHead: string}, signal?: AbortSignal, assertOwner?: () => void) {
    old=structuredClone(old);next=structuredClone(next);
    if ((!this.recordedIdentity(old) && !this.recordedIdentity(next.pr)) || JSON.stringify({...next.pr,head:old.head})!==JSON.stringify(old) || !sha.test(next.pr.head) || next.pr.head===old.head || !sha.test(next.baseHead)) throw new Error("invalid owned update result");
    assertOwner?.();const p=await this.remoteRead("pull",old.id,1,signal,true);assertOwner?.();
    const r=await this.remoteRead("ref",old.branch,1,signal,this.branchAllowed(old.branch,old.head)?old.head:next.pr.head,true);assertOwner?.();
    if(p.number!==Number(old.id)||p.state!=="open"||p.head?.repo?.full_name!==this.grant.repository||p.base?.repo?.full_name!==this.grant.repository||p.head?.ref!==old.branch||p.base?.ref!==old.base||p.head?.sha!==next.pr.head||p.base?.sha!==next.baseHead||r.ref!==`refs/heads/${old.branch}`||r.object?.sha!==next.pr.head)throw new Error("owned update result changed; fresh captain recovery required");
  }
  /** The read-only checks before a merge PUT, in order: the PR at its recorded head, the base, the repository's settings and
   *  branch protection. observed: GitHub does not show the base branch's protection (a private repository on a free plan, or
   *  none), so the merge rests on the captain's acknowledgement of Studio's own verification: protection must still be
   *  unreadable here (a readable one is GitHub's to enforce, on the normal path), in simulator and real mode alike. */
  async mergeReady(pr: ReviewRequest, signal?: AbortSignal, expectedBase?: string, assertOwner?: () => void, o: { observed?: boolean } = {}) {
    pr=structuredClone(pr);assertOwner?.();
    const op = this.operationGrant(), p = await this.mutationState(pr, signal,assertOwner);assertOwner?.();const settings = await this.remoteRead("repository", this.grant.repository, 1, signal, true);assertOwner?.();
    if (expectedBase && p.base.sha !== expectedBase) throw new Error("remote base changed before merge");
    if (this.grant.mode === "github" && !sha.test(expectedBase ?? "")) throw new Error("real merge requires bound base proof");
    if (p.auto_merge != null || p.merge_queue != null || settings.merge_queue_enabled === true) throw new Error("queued/automatic merge mode unsupported");
    if (p.draft !== false || p.mergeable !== true || p.mergeable_state !== "clean") throw new Error("merge requires CLEAN, MERGEABLE and not draft");
    const flag = op.mergeMethod === "merge" ? "allow_merge_commit" : op.mergeMethod === "squash" ? "allow_squash_merge" : "allow_rebase_merge";
    if (settings.full_name !== this.grant.repository || settings[flag] !== true) throw new Error("repository does not allow the configured merge method");
    if (o.observed) {
      let readable = true;
      try { await this.remoteRead("policy", pr.base, 1, signal, true); } catch (e: any) { if (!/^GitHub \d+ protection-(plan|none)$/.test(String(e?.message ?? ""))) throw e; readable = false; }
      assertOwner?.(); if (readable) throw new Error("branch protection is readable on GitHub now; an observed-policy merge is refused");
    } else if(this.grant.mode === "github") {
      const protection = await this.remoteRead("protection",pr.base,1,signal,true);
      assertOwner?.();const bypass = protection.required_pull_request_reviews?.bypass_pull_request_allowances;
      if(protection.required_status_checks?.strict !== true || protection.enforce_admins?.enabled !== true || !protection.required_pull_request_reviews || !bypass || ![bypass.users,bypass.teams,bypass.apps].every(v=>Array.isArray(v)&&v.length===0))throw new Error("real merge requires verified strict up-to-date protection with no bypass");
    }
    return op;
  }
  async mergeHead(pr: ReviewRequest, signal?: AbortSignal, expectedBase?: string, assertOwner?: () => void, commit?: { title: string; message: string }, o: { observed?: boolean } = {}) {
    pr=structuredClone(pr);assertOwner?.();
    const op = await this.mergeReady(pr, signal, expectedBase, assertOwner, o);assertOwner?.();
    // squash and merge land one commit with the Task's curated title and message; rebase lands the branch's own commits
    const curated = commit && op.mergeMethod !== "rebase" && commit.title.trim() ? { commit_title: commit.title.slice(0, 250), commit_message: commit.message.slice(0, 20_000) } : {};
    assertOwner?.();const result = await this.put(pr, "merge", { sha: pr.head, merge_method: op.mergeMethod, ...curated }, signal);
    assertOwner?.();if (result.merged !== true || !sha.test(result.sha)) throw new Error("GitHub did not confirm a merge");
    const merged = await this.remoteRead("pull", pr.id, 1, signal, true);assertOwner?.();
    if (merged.state !== "closed" || merged.merged !== true || merged.merge_commit_sha !== result.sha || merged.number !== Number(pr.id) || merged.head?.sha !== pr.head || merged.head?.repo?.full_name !== this.grant.repository || merged.base?.ref !== pr.base || merged.base?.repo?.full_name !== this.grant.repository) throw new Error("remote merge acknowledgement/target is inconsistent");
    return { head: result.sha, sourceHead: pr.head, method: op.mergeMethod, base: pr.base };
  }
  async importHeads(pr: ReviewRequest, signal?: AbortSignal) {
    if (!this.recordedIdentity(pr)) throw new Error("invalid remote import identity"); signal?.throwIfAborted();
    const dir = mkdtempSync(join(tmpdir(), "crew-remote-import-")); let retain = false;
    try {
      localMust(dir, ["init", "--bare", "-q", "."]); const objects = localMust(this.grant.localPath, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]); if (/[\r\n]/.test(objects)) throw new Error("invalid object path");
      const extra = this.gitAuth();
      const env = publicationEnv({ ...extra, GIT_OBJECT_DIRECTORY: objects });
      await ownedGit(gitArgv(["fetch", "--no-tags", "--", this.grant.pushUrl, `+refs/heads/${pr.branch}:refs/crew/head`, `+refs/heads/${pr.base}:refs/crew/base`]), dir, env, this.timeoutMs, signal);
      const read = async (name: string) => ownedGit(gitArgv(["rev-parse", name]), dir, env, this.timeoutMs, signal);
      const head = await read("refs/crew/head"), base = await read("refs/crew/base"); if (head !== pr.head || !sha.test(base)) throw new Error("remote import head moved"); return { head, base };
    } catch (e: any) { retain = !!e.retainClient; throw e; } finally { if (!retain) rmSync(dir, { recursive: true, force: true }); }
  }
  /** The review room's copy of pull request n (src/domain/review-room.ts): GitHub's refs/pull/<n>/head (a fork's head too) and
   *  the base branch, fetched read-only with the grant's credential into a bare repository Studio owns under its data
   *  directory (cache). Never the project's checkout or its object store, no worktree, no hooks, no templates, nothing pushed,
   *  no gc. Full history (the room reads merge-base, log and blame at the head). Bounded: a time limit, and the cache's size on
   *  disk, watched while the fetch runs (over maxBytes the fetch is stopped) and checked after it, success or not; a fetch that
   *  stops leaves no temporary pack behind. Over the cap the read is refused with overCap set (the caller decides whether the
   *  cache may go: another room may be reading it). One fetch at a time per cache. Each head it saw is kept (refs/crew/seen/<sha>). */
  async fetchPull(n: string, base: string, cache: string, o: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {}) {
    validateGitHubGrant(this.grant); o.signal?.throwIfAborted();
    if (!/^[1-9][0-9]{0,8}$/.test(n) || !ref(base) || !cache.startsWith("/") || /[\r\n]/.test(cache)) throw new Error("invalid pull request fetch target");
    const prior = pullFetches.get(cache) ?? Promise.resolve(); let done!: () => void; const mine = new Promise<void>((r) => (done = r)), chain = prior.then(() => mine); pullFetches.set(cache, chain);
    await prior.catch(() => {});
    const max = o.maxBytes ?? 1024 ** 3, packs = join(cache, "objects", "pack");
    const sizeOf = (dir: string): number => { let t = 0; try { for (const e of readdirSync(dir, { withFileTypes: true })) { const f = join(dir, e.name); t += e.isDirectory() ? sizeOf(f) : (() => { try { return statSync(f).size; } catch { return 0; } })(); } } catch {} return t; };
    const overCap = () => Object.assign(new Error(`the pull request's repository is larger than the review room keeps (${Math.round(max / 1024 ** 2)} MB)`), { overCap: true });
    const clean = () => { try { for (const f of readdirSync(packs)) if (/^tmp_|\.keep$|\.lock$/.test(f)) rmSync(join(packs, f), { force: true }); } catch {} try { for (const f of readdirSync(join(cache, "objects"))) if (/^(incoming-|tmp_)/.test(f)) rmSync(join(cache, "objects", f), { recursive: true, force: true }); } catch {} };
    const stop = new AbortController(), signal = o.signal ? AbortSignal.any([o.signal, stop.signal]) : stop.signal; let over = false;
    const watch = setInterval(() => { if (sizeOf(join(cache, "objects")) > max) { over = true; stop.abort(); } }, 250);
    try {
      mkdirSync(cache, { recursive: true, mode: 0o700 });
      if (!existsSync(join(cache, "HEAD"))) localMust(cache, ["-c", "core.hooksPath=/dev/null", "init", "--bare", "-q", "--template=", "."]);
      const env = publicationEnv(this.gitAuth()), timeout = Math.max(1000, Math.min(600_000, o.timeoutMs ?? 120_000));
      const c = (args: string[]) => ownedGit(gitArgv(["-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=" + (this.grant.mode === "simulator" ? "always" : "never"), "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args]), cache, env, timeout, signal);
      try { await c(["fetch", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "--", this.grant.pushUrl, `+refs/pull/${n}/head:refs/crew/pull/${n}/head`, `+refs/heads/${base}:refs/crew/pull/${n}/base`]); }
      catch (e) { clean(); if (over || sizeOf(join(cache, "objects")) > max) throw overCap(); throw e; }
      if (sizeOf(join(cache, "objects")) > max) throw overCap();
      const head = await c(["rev-parse", "--verify", `refs/crew/pull/${n}/head^{commit}`]), tip = await c(["rev-parse", "--verify", `refs/crew/pull/${n}/base^{commit}`]);
      if (!sha.test(head) || !sha.test(tip)) throw new Error("the fetched pull request head or base is invalid");
      await c(["update-ref", `refs/crew/seen/${head}`, head]);
      return { head, base: tip };
    } finally { clearInterval(watch); clean(); done(); if (pullFetches.get(cache) === chain) pullFetches.delete(cache); }
  }
  /** Fetch the granted base branch head into the local object store (read only); the per-round rebase target before a PR exists. */
  async importBase(signal?: AbortSignal) {
    validateGitHubGrant(this.grant); signal?.throwIfAborted();
    const dir = mkdtempSync(join(tmpdir(), "crew-remote-base-")); let retain = false;
    try {
      localMust(dir, ["init", "--bare", "-q", "."]); const objects = localMust(this.grant.localPath, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]); if (/[\r\n]/.test(objects)) throw new Error("invalid object path");
      const extra = this.gitAuth();
      const env = publicationEnv({ ...extra, GIT_OBJECT_DIRECTORY: objects });
      await ownedGit(gitArgv(["-c", "protocol.file.allow=" + (this.grant.mode === "simulator" ? "always" : "never"), "fetch", "--no-tags", "--", this.grant.pushUrl, `+refs/heads/${this.grant.base}:refs/crew/base`]), dir, env, this.timeoutMs, signal);
      const base = await ownedGit(gitArgv(["rev-parse", "refs/crew/base"]), dir, env, this.timeoutMs, signal); if (!sha.test(base)) throw new Error("remote base head is invalid"); return base;
    } catch (e: any) { retain = !!e.retainClient; throw e; } finally { if (!retain) rmSync(dir, { recursive: true, force: true }); }
  }
  private valid(o: OpenRequest) {
    validateGitHubGrant(this.grant);
    if(o.draft!==undefined&&o.draft!==true)throw new Error("Draft publication flag must be explicitly true or omitted");
    if (resolve(o.repo) !== resolve(this.grant.localPath) || o.base !== this.grant.base || !sha.test(o.head) || !ref(o.branch)) throw new Error("review request does not match the approved project target");
    if (!this.branchAllowed(o.branch, o.head)) throw new Error("naming approval required for a branch outside the approved prefix");
    if (typeof o.title !== "string" || !o.title.trim() || o.title.length > 256 || typeof o.body !== "string" || o.body.length > 60_000) throw new Error("invalid pull request title or body");
    if (!localGit(o.repo, ["cat-file", "-e", `${o.head}^{commit}`]).ok) throw new Error("review head is not a local commit");
  }
  private response(p: any, o: OpenRequest, expectedId?: string, content = false) {
    if (!Number.isSafeInteger(p?.number) || p.number < 1 || p.state !== "open" || p.head?.ref !== o.branch || p.head?.sha !== o.head || p.head?.repo?.full_name !== this.grant.repository || p.base?.ref !== o.base || p.base?.repo?.full_name !== this.grant.repository || (expectedId && String(p.number) !== expectedId)) throw new Error("GitHub returned a mismatched pull request target or head");
    if (p.html_url !== `https://github.com/${this.grant.repository}/pull/${p.number}` || typeof p.title !== "string" || (typeof p.body !== "string" && p.body !== null)) throw new Error("GitHub returned an invalid pull request record");
    if(o.draft===true&&p.draft!==true)throw new Error("Requested Draft PR is not draft; no adoption or conversion was authorized");
    if (content && (p.title !== o.title || p.body !== o.body)) throw new Error("GitHub returned mismatched PR publication content");
    return p;
  }
  /** A temporary bare client contains only the requested object database, no
   * project config, remotes, hooks, credential helpers, URL rewrites or project proxy settings.
   * GitHub credentials exist only in the subprocess environment. */
  private async push(o: OpenRequest, expected: string | null, signal?: AbortSignal, assertOwner?: () => void) {
    const dir = mkdtempSync(join(tmpdir(), "studio-gh-push-")); let retainClient = false;
    try {
      localMust(dir, ["init", "--bare", "-q", "."]);
      const objects = localMust(o.repo, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]);
      if (/[\r\n]/.test(objects)) throw new Error("invalid repository object path");
      mkdirSync(join(dir, "objects", "info"), { recursive: true }); writeFileSync(join(dir, "objects", "info", "alternates"), objects + "\n");
      this.credential(); const extras = this.gitAuth(); // a push needs the token in every mode
      const command = async (args: string[]) => {assertOwner?.();const result=await ownedGit(gitArgv(["-c", "protocol.file.allow=" + (this.grant.mode === "simulator" ? "always" : "never"), ...args]), dir, publicationEnv(extras), this.timeoutMs, signal);assertOwner?.();return result;};
      const remote = await command(["ls-remote", "--refs", "--", this.grant.pushUrl, `refs/heads/${o.branch}`]);
      const lines = remote ? remote.split("\n") : []; if (lines.length > 1 || (lines.length && !new RegExp(`^[a-f0-9]{40}\\s+refs/heads/${o.branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(lines[0]))) throw new Error("invalid remote branch response");
      const current = lines.length ? lines[0].slice(0, 40) : null;
      if (current === o.head) return; // interrupted publication/update: recover without a second push
      if (current !== expected) throw new Error("GitHub push refused: remote branch lease mismatch");
      await command(["push", "--porcelain", `--force-with-lease=refs/heads/${o.branch}:${expected ?? ""}`, "--", this.grant.pushUrl, `${o.head}:refs/heads/${o.branch}`]);
    } catch (e: any) { retainClient = !!e.retainClient; throw e; }
    finally { if (!retainClient) rmSync(dir, { recursive: true, force: true }); }
  }
  private async locked<T>(branch: string, f: () => Promise<T>) { if (this.active.has(branch)) throw new Error("GitHub publication already in progress for this branch"); this.active.add(branch); try { return await f(); } finally { this.active.delete(branch); } }
  async open(o: OpenRequest, runDir: string, signal?: AbortSignal, assertOwner?: () => void): Promise<ReviewRequest> {
    o=structuredClone(o);assertOwner?.();signal?.throwIfAborted(); this.valid(o);
    return this.locked(o.branch, async () => {
      const q = new URLSearchParams({ state: "open", head: `${this.grant.repository.split("/")[0]}:${o.branch}`, base: o.base, per_page: "100" });
      const list = await this.api("GET", `/pulls?${q}`, undefined, signal, assertOwner);
      if (!Array.isArray(list) || list.length > 1) throw new Error("GitHub pull request lookup is ambiguous");
      // Existing matching PR is the durable recovery anchor. A moved/foreign
      // head is never force overwritten by a new run without its recorded lease.
      if (list.length) this.response(list[0], o);
      await this.push(o, null, signal, assertOwner);
      const p = list.length ? this.response(await this.api("PATCH", `/pulls/${list[0].number}`, { title: o.title, body: o.body, base: o.base }, signal, assertOwner), o, String(list[0].number), true) : this.response(await this.api("POST", "/pulls", { title: o.title, body: o.body, head: o.branch, base: o.base, ...(o.draft===true?{draft:true}:{}) }, signal, assertOwner), o, undefined, true);
      const pr: ReviewRequest = { ...o, adapter: "github", id: String(p.number), url: p.html_url, openedAt: p.created_at ?? new Date().toISOString() };
      signal?.throwIfAborted(); assertOwner?.();persist(runDir, pr); return pr;
    });
  }
  /** opts.text false: the push moves the head only; the title and text on GitHub are left as they are (a person's edit there stays). */
  async update(pr: ReviewRequest, head: string, runDir: string, signal?: AbortSignal, assertOwner?: () => void, opts: { text?: boolean } = {}): Promise<ReviewRequest> {
    pr=structuredClone(pr);assertOwner?.();signal?.throwIfAborted(); const o = { ...pr, head }; this.valid(o);
    if (pr.adapter !== "github" || !/^[1-9][0-9]*$/.test(pr.id) || !sha.test(pr.head) || pr.url !== `https://github.com/${this.grant.repository}/pull/${pr.id}`) throw new Error("invalid recorded GitHub PR identity");
    const text = opts.text !== false;
    return this.locked(pr.branch, async () => {
      const before = await this.api("GET", `/pulls/${pr.id}`, undefined, signal, assertOwner);
      // A retry may observe the new head after a successful push and failed PATCH.
      this.response(before, { ...pr, head: before?.head?.sha === head ? head : pr.head }, pr.id);
      await this.push(o, pr.head, signal, assertOwner);
      const p = this.response(await this.api("PATCH", `/pulls/${pr.id}`, text ? { title: pr.title, body: pr.body, base: pr.base } : { base: pr.base }, signal, assertOwner), o, pr.id, text);
      const n = { ...pr, head, url: p.html_url }; signal?.throwIfAborted(); assertOwner?.();persist(runDir, n); return n;
    });
  }
  /** Edit only the title and text of the open pull request at its recorded head (no push), and only when expect accepts the
   *  title and text GitHub shows right before the PATCH (compare and swap as close as GitHub's API allows). */
  async updateText(pr: ReviewRequest, title: string, body: string, expect: (live: { title: string; body: string }) => boolean, runDir: string, signal?: AbortSignal, assertOwner?: () => void): Promise<ReviewRequest> {
    pr=structuredClone(pr);assertOwner?.();signal?.throwIfAborted(); const o = { ...pr, title, body }; this.valid(o);
    if (pr.adapter !== "github" || !/^[1-9][0-9]*$/.test(pr.id) || !sha.test(pr.head) || pr.url !== `https://github.com/${this.grant.repository}/pull/${pr.id}`) throw new Error("invalid recorded GitHub PR identity");
    return this.locked(pr.branch, async () => {
      const before = this.response(await this.api("GET", `/pulls/${pr.id}`, undefined, signal, assertOwner), pr, pr.id);
      if (!expect({ title: String(before.title ?? ""), body: String(before.body ?? "") })) throw new Error("GitHub's pull request text changed before the edit");
      const p = this.response(await this.api("PATCH", `/pulls/${pr.id}`, { title, body, base: pr.base }, signal, assertOwner), o, pr.id, true);
      const n = { ...pr, title, body, url: p.html_url }; signal?.throwIfAborted(); assertOwner?.();persist(runDir, n); return n;
    });
  }
}

export function projectPrAdapter(project: { path: string | null; github?: GitHubProjectGrant } | null, dataDir: string, poller?:GitHubPoller): PrAdapter {
  if (!project?.github) return new LocalPrAdapter();
  if (!project.path || resolve(project.path) !== resolve(project.github.localPath)) throw new Error("GitHub grant does not match registered project path");
  return new GitHubPrAdapter(project.github, () => findToken(dataDir).token, 15_000, dataDir, poller);
}
