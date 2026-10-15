import {GitHubPoller} from '../github-poller';
import { createHash } from "node:crypto";
import { GitHubPrAdapter, type ReviewRequest } from "../adapters/github";
import { githubBackoff } from "../github";
import type { X, Result } from "../runtime/engine";
const hash = (v: any) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const grantIdentity = (adapter: GitHubPrAdapter) => adapter.grantIdentity();
export type RequiredPolicy = { hash: string; strict: boolean; checks: { name: string; app: number }[]; contexts: string[] };
export type RemoteEvidence = { state: "pass" | "fail" | "pending" | "stop"; reason: string; head: string; policyHash: string; log?: { classification: string; text?: string } };
export async function requiredPolicy(adapter: GitHubPrAdapter, signal?: AbortSignal): Promise<RequiredPolicy> {
  const raw = await adapter.remoteRead("policy", adapter.grant.base, 1, signal);
  if (!raw || !Array.isArray(raw.checks) || !Array.isArray(raw.contexts) || typeof raw.strict !== "boolean") throw new Error("required-check policy is malformed");
  const checks = raw.checks.map((c: any) => { if (typeof c?.context !== "string" || !c.context || !Number.isSafeInteger(c.app_id) || c.app_id < -1) throw new Error("required check identity is malformed"); return { name: c.context, app: c.app_id }; }).sort((a: any, b: any) => a.name.localeCompare(b.name) || a.app - b.app);
  const contexts = raw.contexts.filter((c: any) => !checks.some((k: any) => k.name === c));
  if (!contexts.every((c: any) => typeof c === "string" && c) || new Set(contexts).size !== contexts.length || new Set(checks.map((c: any) => `${c.name}\0${c.app}`)).size !== checks.length) throw new Error("required policy has duplicate identities");
  contexts.sort(); return { checks, contexts, strict: raw.strict, hash: hash({ checks, contexts, strict: raw.strict }) };
}
export class RemoteMismatch extends Error {}
export async function reconcile(adapter: GitHubPrAdapter, pr: ReviewRequest, signal?: AbortSignal, fresh=false) {
  if (!adapter.recordedIdentity(pr)) throw new RemoteMismatch("recorded PR target differs from the approved project");
  const p = await adapter.remoteRead("pull", pr.id, 1, signal, fresh), r = await adapter.remoteRead("ref", pr.branch, 1, signal, pr.head, fresh);
  if (p.number !== Number(pr.id) || p.state !== "open" || p.head?.repo?.full_name !== adapter.grant.repository || p.base?.repo?.full_name !== adapter.grant.repository || p.head?.ref !== pr.branch || p.base?.ref !== pr.base || p.head?.sha !== pr.head || r.ref !== `refs/heads/${pr.branch}` || r.object?.type !== "commit" || r.object?.sha !== pr.head) throw new RemoteMismatch("PR closed, target changed or remote head moved; verification stopped");
  return p;
}
async function pages(adapter: GitHubPrAdapter, kind: "checks" | "statuses", head: string, signal?: AbortSignal) {
  const rows: any[] = []; let total: number | null = null;
  for (let page = 1; page <= 50; page++) {
    const result = await adapter.remoteRead(kind, head, page, signal), part = kind === "checks" ? result?.check_runs : result?.statuses;
    if ((kind === "statuses" && result?.sha !== head) || !Array.isArray(part) || part.length > 100 || (kind === "checks" && (!Number.isSafeInteger(result.total_count) || result.total_count < 0))) throw new Error("remote checks pagination is malformed");
    const count = result.total_count; if (!Number.isSafeInteger(count) || count < rows.length + part.length || (total !== null && total !== count)) throw new Error("remote pagination total changed or is invalid"); total = count;
    rows.push(...part); if (rows.length === total) return rows; if (part.length < 100) throw new Error("remote pagination is incomplete");
  }
  throw new Error("remote checks pagination exceeds limit");
}
export async function inspectRemote(adapter: GitHubPrAdapter, pr: ReviewRequest, policy: RequiredPolicy, signal?: AbortSignal): Promise<RemoteEvidence> {
  const result = (state: RemoteEvidence["state"], reason: string): RemoteEvidence => ({ state, reason, head: pr.head, policyHash: policy.hash });
  if (policy.hash !== hash({ checks: policy.checks, contexts: policy.contexts, strict: policy.strict })) return result("stop", "stored required-policy contents do not match their hash");
  try { await reconcile(adapter, pr, signal); } catch (e) { if (e instanceof RemoteMismatch) return result("stop", "PR closed, target changed or remote head moved"); throw e; }
  const current = await requiredPolicy(adapter, signal); if (current.hash !== policy.hash) return result("stop", "required-check policy changed; a fresh verification is needed");
  const checks = await pages(adapter, "checks", pr.head, signal), statuses = await pages(adapter, "statuses", pr.head, signal);
  let pending = false;
  for (const required of policy.checks) {
    const matches = checks.filter(c => c.name === required.name && (required.app === -1 || c.app?.id === required.app));
    if (!matches.length) { pending = true; continue; }
    if (matches.length !== 1 || matches[0].head_sha !== pr.head || !Number.isSafeInteger(matches[0].id)) return result("fail", "ambiguous or stale required check identity");
    const c = matches[0]; if (c.status !== "completed") { pending = true; continue; }
    if (c.conclusion !== "success") {
      const evidence = result("fail", `required check ${required.name} did not succeed`);
      const prefix = `https://github.com/${adapter.grant.repository}/actions/runs/`;
      const match = typeof c.details_url === "string" && c.details_url.startsWith(prefix) ? /^([1-9][0-9]*)\/job\/([1-9][0-9]*)$/.exec(c.details_url.slice(prefix.length)) : null;
      if (match) try { evidence.log = await adapter.jobLog(Number(match[2]), 0, 65535, signal); } catch { evidence.log = { classification: "log-unavailable" }; }
      return evidence;
    }
  }
  for (const context of policy.contexts) {
    const matches = statuses.filter(s => s.context === context);
    if (!matches.length) { pending = true; continue; }
    if (matches.length !== 1) return result("fail", "ambiguous or stale required status context");
    if (matches[0].state === "pending") { pending = true; continue; }
    if (matches[0].state !== "success") return result("fail", `required status ${context} did not succeed`);
  }
  // Re-read PR/ref after the paginated reads; an old green head cannot unlock.
  try { await reconcile(adapter, pr, signal,true); } catch (e) { if (e instanceof RemoteMismatch) return result("stop", "remote head moved during verification"); throw e; }
  return result(pending ? "pending" : "pass", pending ? "required checks are missing or pending" : "required remote checks succeeded on the exact PR head");
}
export type RemoteWait = { version: 1; handler: "github-ci"; grant: string; repository: string; pr: ReviewRequest; policy: RequiredPolicy; startedAt: number; deadline: number; lastDigest: string | null };
export function validRemoteWait(w: any, adapter: GitHubPrAdapter): w is RemoteWait {
  try {
    const policy = w?.policy;
    const checks = Array.isArray(policy?.checks) && policy.checks.every((c: any) => c && Object.keys(c).length === 2 && Object.hasOwn(c, "name") && Object.hasOwn(c, "app") && typeof c.name === "string" && c.name.length > 0 && c.name.length <= 256 && !/[\r\n\0]/.test(c.name) && Number.isSafeInteger(c.app) && (c.app === -1 || c.app > 0));
    const contexts = Array.isArray(policy?.contexts) && policy.contexts.every((c: any) => typeof c === "string" && c.length > 0 && c.length <= 256 && !/[\r\n\0]/.test(c));
    if (!checks || !contexts || new Set(policy.checks.map((c: any) => `${c.name}\0${c.app}`)).size !== policy.checks.length || new Set(policy.contexts).size !== policy.contexts.length || policy.contexts.some((c: string) => policy.checks.some((k: any) => k.name === c))) return false;
    return w.version === 1 && w.handler === "github-ci" && w.grant === grantIdentity(adapter) && w.repository === adapter.grant.repository && adapter.recordedIdentity(w.pr) && typeof policy.strict === "boolean" && policy.hash === hash({ checks: policy.checks, contexts: policy.contexts, strict: policy.strict }) && Number.isSafeInteger(w.startedAt) && w.startedAt > 0 && Number.isSafeInteger(w.deadline) && w.deadline > w.startedAt && w.deadline - w.startedAt <= 24 * 3600_000 && (w.lastDigest === null || /^[a-f0-9]{64}$/.test(w.lastDigest));
  } catch { return false; }
}
/** One timer/request owner per exact approved repository/grant, shared by tasks. */
export class RemoteWatchers {
 private subscriptions=new Map<string,()=>void>();
 constructor(readonly intervalMs=60000,readonly poller=new GitHubPoller()){}
 get ownership(){return this.poller.ownership;}
 get size(){return this.poller.ownership.repositories;}
 subscribe(adapter:GitHubPrAdapter,id:string,wait:RemoteWait,deliver:(e:RemoteEvidence)=>void){
  const update=(e:RemoteEvidence)=>this.poller.withoutGeneration(()=>deliver(e));
  if(!validRemoteWait(wait,adapter))throw new Error('invalid external wait descriptor');if(this.subscriptions.has(id))throw new Error('duplicate external wait owner');
  let active=true;if(wait.deadline<=Date.now()){const cancel=()=>{active=false;this.subscriptions.delete(id);};this.subscriptions.set(id,cancel);queueMicrotask(()=>{if(active){cancel();update({state:'stop',reason:'remote CI deadline expired',head:wait.pr.head,policyHash:wait.policy.hash});}});return cancel;}const authority=adapter.readAuthority();let release:()=>void=()=>{};
  const cancel=()=>{if(!active)return;active=false;release();this.subscriptions.delete(id);};
  release=this.poller.subscribe(authority,'native:'+id,async(signal)=>{let evidence:RemoteEvidence;try{evidence=await adapter.withReadOwner(this.poller,()=>inspectRemote(adapter,wait.pr,wait.policy,signal));}catch{if(active&&!signal.aborted){update({state:'pending',reason:'remote verification unavailable; waiting within its original deadline',head:wait.pr.head,policyHash:wait.policy.hash});}throw new Error('remote verification unavailable');}if(!active||signal.aborted)return;if(Date.now()>=wait.deadline){cancel();update({state:'stop',reason:'remote CI deadline expired',head:wait.pr.head,policyHash:wait.policy.hash});return;}const digest=hash(evidence);if(wait.lastDigest!==digest||evidence.state!=='pending'){wait.lastDigest=digest;update(evidence);}}, {interval:this.intervalMs,deadline:wait.deadline,expire:()=>{if(!active)return;active=false;this.subscriptions.delete(id);update({state:'stop',reason:'remote CI deadline expired',head:wait.pr.head,policyHash:wait.policy.hash});}});
  this.subscriptions.set(id,cancel);return cancel;
 }
 stop(){for(const cancel of [...this.subscriptions.values()])cancel();}
}

export function remoteStopBody(reason: string) {
  return { title: "Remote verification stopped", zhTitle: "遠端驗證已停止", captainOnly: true,
    en: { why: reason, how: "Inspect the remote PR and start a fresh verification. No merge is authorized." },
    zh: { why: "PR 已關閉、遠端 head 或目標改變，或 CI 驗證未能在期限內完成。", how: "請核對遠端 PR 並重新驗證。尚未授權合併。" }, body: reason, options: [{ id: "close", label: "Close without merging" }] };
}
export function registerRemoteWait(x: X, adapter: GitHubPrAdapter, watchers: RemoteWatchers, wait: any, wake: (r: Result) => void) {
  let active = true, stopping = false, unsubscribe = () => {};
  const signal = x.engine.abortOf?.(x.run)?.signal;
  const live = () => active && !signal?.aborted && (x.engine.owns ? x.engine.owns(x) : !x.cancelled());
  const stop = (reason: string) => {
    if (!live() || stopping) return; stopping = true; unsubscribe(); x.ctx.remoteCI = null;
    const work = (async () => { try { await x.engine.card(x, "step-back", remoteStopBody(reason)); if (live()) wake({ wait: true, note: reason }); } catch { if (live()) wake({ outcome: "error", note: "remote stop presentation failed" }); } })();
    if (x.engine.trackExternal) void x.engine.trackExternal(x, work); else void work;
  };
  if (!validRemoteWait(wait, adapter)) { queueMicrotask(() => void stop("stored external wait is unsupported or stale; fresh verification required")); return () => { active = false; }; }
  try { unsubscribe = watchers.subscribe(adapter, `${x.run.id}/${x.node.id}`, wait, evidence => {
    if (!live()) return;
    x.save();
    if (evidence.state === "pending") return;
    x.engine.record(x, "external-ci", { check: "firstmate/remote-ci", verdict: evidence.state === "pass" ? "pass" : "fail", head: evidence.head, kind: "deterministic", blocking: true, data: evidence,
      findings: evidence.state === "pass" ? [] : [{ locator: { type: "card", field: "ci" }, message: evidence.reason, expected: "required remote checks pass on the recorded PR head", class: "remote-ci", severity: "blocking" }] });
    if (evidence.state !== "pass") { void stop(evidence.reason); return; }
    x.ctx.remoteCI = { ...evidence, grant: wait.grant, deadline: wait.deadline, verifiedAt: Date.now() }; x.save(); wake({ outcome: "ok", note: evidence.reason });
  });
  } catch { queueMicrotask(() => void stop("repository wait authority conflicts with another grant; verification stopped")); }
  return () => { active = false; unsubscribe(); };
}
