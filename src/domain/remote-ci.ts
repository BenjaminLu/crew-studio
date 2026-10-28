import {GitHubPoller} from '../github-poller';
import { createHash } from "node:crypto";
import { GitHubPrAdapter, type ReviewRequest } from "../adapters/github";
import { githubBackoff } from "../github";
import { redactText } from "../secure";
import type { X, Result } from "../runtime/engine";
const hash = (v: any) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const grantIdentity = (adapter: GitHubPrAdapter) => adapter.grantIdentity();
/** observed: GitHub will not show the base branch's protection (a private repository on a free plan, or no protection at
 *  all), so the required checks are every check and status reported on the PR head, all of which must succeed. */
export type RequiredPolicy = { hash: string; strict: boolean; checks: { name: string; app: number }[]; contexts: string[]; observed?: "plan" | "none" };
const policyHash = (p: { checks: any[]; contexts: any[]; strict: boolean; observed?: string }) => hash(p.observed ? { checks: p.checks, contexts: p.contexts, strict: p.strict, observed: p.observed } : { checks: p.checks, contexts: p.contexts, strict: p.strict });
/** The notice for an observed policy, in both languages (the run log, the ledger and the merge card carry it). */
export const observedNotice = (p: RequiredPolicy) => !p.observed ? null : {
  en: `${p.observed === "plan" ? "GitHub does not show branch protection for this private repository on its current plan" : "The base branch has no branch protection on GitHub"}, so Studio required every check reported on the PR head to pass.`,
  zh: `${p.observed === "plan" ? "這個私有儲存庫的 GitHub 方案看不到分支保護設定" : "GitHub 上的 base 分支沒有設分支保護"}，所以 Studio 要求 PR head 上回報的每一個檢查都通過。` };
export type RemoteEvidence = { state: "pass" | "fail" | "pending" | "stop"; reason: string; head: string; policyHash: string; log?: { classification: string; text?: string } };
export async function requiredPolicy(adapter: GitHubPrAdapter, signal?: AbortSignal): Promise<RequiredPolicy> {
  let raw: any;
  try { raw = await adapter.remoteRead("policy", adapter.grant.base, 1, signal); }
  catch (e: any) {
    const m = /^GitHub \d+ protection-(plan|none)$/.exec(String(e?.message ?? ""));
    if (!m) throw e;
    const observed = m[1] as "plan" | "none", p = { checks: [], contexts: [], strict: false, observed };
    return { ...p, hash: policyHash(p) };
  }
  if (!raw || !Array.isArray(raw.checks) || !Array.isArray(raw.contexts) || typeof raw.strict !== "boolean") throw new Error("required-check policy is malformed");
  const checks = raw.checks.map((c: any) => { if (typeof c?.context !== "string" || !c.context || !Number.isSafeInteger(c.app_id) || c.app_id < -1) throw new Error("required check identity is malformed"); return { name: c.context, app: c.app_id }; }).sort((a: any, b: any) => a.name.localeCompare(b.name) || a.app - b.app);
  const contexts = raw.contexts.filter((c: any) => !checks.some((k: any) => k.name === c));
  if (!contexts.every((c: any) => typeof c === "string" && c) || new Set(contexts).size !== contexts.length || new Set(checks.map((c: any) => `${c.name}\0${c.app}`)).size !== checks.length) throw new Error("required policy has duplicate identities");
  contexts.sort(); return { checks, contexts, strict: raw.strict, hash: policyHash({ checks, contexts, strict: raw.strict }) };
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
  if (policy.hash !== policyHash(policy)) return result("stop", "stored required-policy contents do not match their hash");
  try { await reconcile(adapter, pr, signal); } catch (e) { if (e instanceof RemoteMismatch) return result("stop", "PR closed, target changed or remote head moved"); throw e; }
  const current = await requiredPolicy(adapter, signal); if (current.hash !== policy.hash) return result("stop", "required-check policy changed; a fresh verification is needed");
  const checks = await pages(adapter, "checks", pr.head, signal), statuses = await pages(adapter, "statuses", pr.head, signal);
  let pending = false;
  if (policy.observed) {
    // every check run (its latest by name and app) and every status context reported on the head; none reported yet is pending
    const latest = new Map<string, any>(); for (const c of checks) { if (c.head_sha !== pr.head || !Number.isSafeInteger(c.id)) return result("fail", "ambiguous or stale check identity"); const k = `${c.name}\0${c.app?.id ?? -1}`; if (!latest.has(k) || latest.get(k).id < c.id) latest.set(k, c); }
    for (const c of latest.values()) { if (c.status !== "completed") { pending = true; continue; } if (!["success", "neutral", "skipped"].includes(c.conclusion)) return result("fail", `check ${c.name} did not succeed`); }
    for (const s of statuses) { if (s.state === "pending") { pending = true; continue; } if (s.state !== "success") return result("fail", `status ${s.context} did not succeed`); }
    if (!latest.size && !statuses.length) pending = true;
    try { await reconcile(adapter, pr, signal, true); } catch (e) { if (e instanceof RemoteMismatch) return result("stop", "remote head moved during verification"); throw e; }
    return result(pending ? "pending" : "pass", pending ? "checks on the PR head are missing or pending" : "every check reported on the exact PR head succeeded");
  }
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
    if (policy.observed !== undefined && (!["plan", "none"].includes(policy.observed) || policy.checks.length || policy.contexts.length)) return false;
    return w.version === 1 && w.handler === "github-ci" && w.grant === grantIdentity(adapter) && w.repository === adapter.grant.repository && adapter.recordedIdentity(w.pr) && typeof policy.strict === "boolean" && policy.hash === policyHash(policy) && Number.isSafeInteger(w.startedAt) && w.startedAt > 0 && Number.isSafeInteger(w.deadline) && w.deadline > w.startedAt && w.deadline - w.startedAt <= 24 * 3600_000 && (w.lastDigest === null || /^[a-f0-9]{64}$/.test(w.lastDigest));
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

/** Why a remote read failed, by class: the pull request closed or moved, GitHub refused the grant's token, GitHub did not
 *  answer; anything else keeps the caller's reason. Vendor text never reaches it. */
export function remoteStopReason(e: any, fallback: string) {
  const m = String(e?.message ?? e ?? "");
  if (e instanceof RemoteMismatch) return "the pull request was closed, retargeted, or its head moved on GitHub";
  if (/^GitHub (401|403)\b/.test(m)) return "GitHub refused the project's GitHub access (authorization)";
  if (/^GitHub 404\b/.test(m)) return "GitHub does not show the pull request or its repository to the project's GitHub access (authorization)";
  if (/^GitHub (429|5\d\d)\b|failed or timed out/.test(m)) return "GitHub could not be reached";
  return fallback;
}

/** Why Studio will not merge on an observed policy: the required checks are what Studio saw on the head, not what GitHub enforces. */
/** The merge card's option on an observed policy: the captain merges on Studio's own verification, acknowledging that GitHub does not enforce the required checks. */
export const OBSERVED_MERGE = "merge-observed";
export const OBSERVED_REFUSAL = "required checks are only observed (GitHub does not show branch protection for the base branch); Studio merge refused";
/** A stop that only someone's change on GitHub explains: the pull request closed or retargeted, its head or Task branch moved
 *  (someone else pushed). Studio never adopts that change, so a fresh check stops the same way: close is the only answer. */
const TERMINAL_STOP = /closed, retargeted|PR closed, target changed|head moved|moved away|changed on GitHub|changed since|PR\/ref changed|no longer matches/i;
export const remoteStopRecoverable = (reason: string) => !TERMINAL_STOP.test(stopKind(reason));
/** The cause Studio caught, appended to a stop reason as " (cause: …)": shown to the captain, never used to classify the stop. */
const CAUSE = / \(cause: ([^]*)\)$/;
const stopKind = (reason: string) => String(reason ?? "").replace(CAUSE, "");
/** A stop reason with the cause Studio caught: one line, at most 240 characters, so the card names why it stopped. */
export const withCause = (reason: string, e: any) => {
  const cause = redactText(String(e?.message ?? e ?? "")).replace(/\s+/g, " ").replace(/[()]/g, "").replace(/\.\s*$/, "").trim().slice(0, 240);
  return cause ? `${reason} (cause: ${cause})` : reason;
};
/** How many times the captain may check one node's remote stop again in a Task; after that, close is the only answer. */
export const REMOTE_CHECK_LIMIT = 5;
/** The captain's "Check again" (and "Update the branch") answers on this node's remote-stop cards, from the signature-verified
 *  ledger; a ledger that does not verify counts as the limit reached (close only). */
export const remoteChecksUsed = (x: X, engine: X["engine"] = x.engine) => {
  if (!engine.trusted) return 0; // an engine fixture without a ledger
  const t = engine.trusted(x.run.id); if (!t.ok) return REMOTE_CHECK_LIMIT;
  return t.entries.filter((e: any) => e.record === "card-answer" && e.node === x.node.id && ["check", "update"].includes(e.data?.choice)).length;
};
/** remote-ready on Check again (read only): the pull request is behind its base, and only the captain's Update writes to GitHub. */
export const REMOTE_BEHIND = "the pull request is behind its base branch on GitHub; checking again only reads GitHub, so the branch was not updated";
/** The reason a remote-stop card names, read back from its body (an older release's card keeps no other record of it). */
export const remoteStopReasonOf = (body: string) => /^Remote verification stopped: ([^]*)\. Nothing was merged\.$/.exec(String(body ?? ""))?.[1] ?? null;

/** The card when the remote PR stopped verification: what went wrong (the reason), in both languages; nothing was merged.
 *  A known class gets its own title (closed or moved, refused access, unreachable, checks failed). A stop a fresh check can
 *  clear (recover, below the limit) also offers "Check again": its node verifies the pull request again under the current rules. */
export function remoteStopBody(full: string, o: { recover?: boolean; used?: number } = {}) {
  // the classification reads the stop's own words; the caught cause, when there is one, is shown in both languages as is
  const reason = stopKind(full), cause = CAUSE.exec(full)?.[1] ?? null;
  const used = o.used ?? 0, recoverable = (o.recover ?? true) && remoteStopRecoverable(reason), check = recoverable && used < REMOTE_CHECK_LIMIT;
  const zh = /only observed/i.test(reason) ? "GitHub 沒有顯示 base 分支的分支保護，必要檢查只是 Studio 觀察到的，所以 Studio 不合併；請到 GitHub 合併。"
    : /pushed|moved away|changed on GitHub|changed since/i.test(reason) ? "GitHub 上的 PR 或任務 branch 在 Studio 上次推送後被改動了（例如有人推送）；Studio 沒有覆蓋它。"
    : /closed, retargeted|head moved on GitHub/i.test(reason) ? "GitHub 上的 PR 已關閉、改了目標，或它的 head 被移動了。"
    : /\(authorization\)/i.test(reason) ? "GitHub 拒絕了這個專案的 GitHub 存取權（授權問題）。"
    : /could not be reached/i.test(reason) ? "連不上 GitHub。"
    : /did not succeed/i.test(reason) ? "PR head 上有檢查沒有通過。"
    : /CI deadline expired/i.test(reason) ? "PR head 上的檢查沒有在等待期限內完成。"
    : /behind its base branch/i.test(reason) ? "PR 落後 base 分支；「重新檢查」只讀取 GitHub，所以沒有更新分支。"
    : /merge refused|no longer matches/i.test(reason) ? "PR、head 或必要的 CI 已和核准時不同，所以拒絕合併。"
    : /grant|CLEAN|draft/i.test(reason) ? "無法確認合併授權，或 PR 不是可乾淨合併的非草稿狀態。"
    : /naming|deadline/i.test(reason) ? "待處理更新的目標、授權或期限改變了；保留給船長處理。"
    : "無法驗證遠端 PR 或它的必要檢查；這一輪已停止。";
  // what the captain sets right first, before checking again (en, zh-TW)
  const fix = /\(authorization\)/i.test(reason) ? ["Fix the project's GitHub access first (its grant in the project settings).", "請先修好專案的 GitHub 存取權（專案設定裡的授權）。"]
    : /could not be reached/i.test(reason) ? ["Wait until GitHub answers again.", "請等 GitHub 恢復回應。"]
    : /did not succeed/i.test(reason) ? ["Re-run or fix the failed check on GitHub first; Studio reads its latest result.", "請先在 GitHub 重新執行或修好沒通過的檢查；Studio 會讀它最新的結果。"]
    : /CI deadline expired/i.test(reason) ? ["Make sure the checks run on the PR head.", "請確認 PR head 上的檢查有在執行。"]
    : ["Look at the PR on GitHub if you want to.", "需要的話，可以先到 GitHub 看這個 PR。"];
  const [what, zhWhat] = /only observed/i.test(reason) ? ["GitHub does not show branch protection", "GitHub 沒有顯示分支保護"]
    : /closed, retargeted|head moved on GitHub/i.test(reason) ? ["The pull request was closed or moved on GitHub", "GitHub 上的 PR 已關閉或被移動"]
    : /\(authorization\)/i.test(reason) ? ["GitHub refused the project's access", "GitHub 拒絕了專案的存取"]
    : /could not be reached/i.test(reason) ? ["GitHub could not be reached", "連不上 GitHub"]
    : /did not succeed/i.test(reason) ? ["Checks failed on the pull request", "PR 的檢查沒有通過"]
    : /behind its base branch/i.test(reason) ? ["The pull request is behind its base branch", "PR 落後 base 分支"]
    : ["Remote verification stopped", "遠端驗證已停止"];
  const [title, zhTitle] = /only observed/i.test(reason) ? [`${what}: Studio will not merge this pull request`, `${zhWhat}：Studio 不合併這個 PR`]
    : check && /behind its base branch/i.test(reason) ? [`${what}: update it on GitHub, check again or close this task?`, `${zhWhat}：要在 GitHub 更新、重新檢查，還是關閉這個任務？`]
    : check ? [`${what}: check again or close this task?`, `${zhWhat}：要重新檢查，還是關閉這個任務？`] : [`${what}: close this task?`, `${zhWhat}：要關閉這個任務嗎？`];
  const behind = /behind its base branch/i.test(reason);
  const how = check && behind ? { en: "Update the branch runs Studio's normal path: GitHub merges the base into the Task branch at the reviewed head (update-branch), Studio imports the result, proves the reviewed change carried over cleanly and runs the checks again. Check again only reads GitHub and stops here while the PR is behind. Or close without merging.",
      zh: "「更新分支」會走 Studio 的正常流程：GitHub 在已審查的 head 上把 base 合進任務分支（update-branch），Studio 匯入結果、證明審查過的改動乾淨帶過去，再重跑檢查。「重新檢查」只讀取 GitHub，PR 還落後時會停在這裡。或者不合併，直接關閉。" }
    : check ? { en: `${fix[0]} Check again verifies the PR, its branch protection and its checks on GitHub again under the current release's rules, then waits for the checks on the PR head. It does not push or merge. Or close without merging.`,
      zh: `${fix[1]}「重新檢查」會用目前版本的規則，再到 GitHub 驗證一次 PR、分支保護和檢查，然後等 PR head 上的檢查；不會推送，也不會合併。或者不合併，直接關閉。` }
    : recoverable ? { en: `Studio already checked again ${used} times. Inspect the PR on GitHub, then close this task and start a fresh one if the change should go on. No merge is authorized.`,
      zh: `已經重新檢查 ${used} 次。請在 GitHub 核對 PR，關閉這個任務；如果改動要繼續，再開一個新任務。尚未授權合併。` }
    : { en: "Inspect the PR on GitHub, then close this task and start a fresh one if the change should go on. No merge is authorized.", zh: "請在 GitHub 核對 PR，關閉這個任務；如果改動要繼續，再開一個新任務。尚未授權合併。" };
  return { title, zhTitle, captainOnly: true, direct: true,
    en: { why: `Remote verification stopped: ${full}. Nothing was merged.`, how: how.en },
    zh: { why: `遠端驗證已停止：${zh}${cause ? `（原因：${cause}）` : ""}沒有合併任何東西。`, how: how.zh }, body: `Remote verification stopped: ${full}. Nothing was merged.`,
    options: [...(check && behind ? [{ id: "update", label: "Update the branch on GitHub", labelZh: "在 GitHub 更新分支", primary: true }] : []), ...(check ? [{ id: "check", label: "Check again", labelZh: "重新檢查", ...(behind ? {} : { primary: true }) }] : []), { id: "close", label: "Close without merging", labelZh: "不合併，關閉" }] };
}
/** The nodes whose answer handler checks a remote stop again (code.ts); a stop anywhere else is answered by close. */
export const REMOTE_CHECK_NODES = ["pr.open", "remote.ready"];
/** Raise the remote-stop card on this node, with its check-again count read from the ledger. */
export const remoteStopCard = (x: X, reason: string, engine: X["engine"] = x.engine) =>
  engine.card(x, "step-back", remoteStopBody(reason, { recover: REMOTE_CHECK_NODES.includes(x.node.do ?? ""), used: remoteChecksUsed(x, engine) }));
export function registerRemoteWait(x: X, adapter: GitHubPrAdapter, watchers: RemoteWatchers, wait: any, wake: (r: Result) => void) {
  let active = true, stopping = false, unsubscribe = () => {};
  const signal = x.engine.abortOf?.(x.run)?.signal;
  const live = () => active && !signal?.aborted && (x.engine.owns ? x.engine.owns(x) : !x.cancelled());
  const stop = (reason: string) => {
    if (!live() || stopping) return; stopping = true; unsubscribe(); x.ctx.remoteCI = null;
    const work = (async () => { try { await remoteStopCard(x, reason); if (live()) wake({ wait: true, note: reason }); } catch { if (live()) wake({ outcome: "error", note: "remote stop presentation failed" }); } })();
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
