// Remote mutation ownership and durable same-head finality. Only typed adapters
// reach the vendor API; this module never derives authority from task params.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { git, must } from "../git";
import { join } from "node:path";
import { GitHubPrAdapter } from "../adapters/github";
import type { ReviewRequest } from "../adapters/github";
const owners = new Set<string>();
export type MergeAttempt = { version: 1; repository: string; grant: string; pr: string; branch: string; base: string; head: string; method: string; card: string; state: "started" | "succeeded" | "failed" | "uncertain"; at: string; result?: any; observed?: true };
const read = (path: string): MergeAttempt[] => {
  if (!existsSync(path)) return [];
  let value: any; try { value = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("remote merge history malformed; retained for captain review"); }
  if (!Array.isArray(value) || value.some(a => a?.version !== 1 || !["started", "succeeded", "failed", "uncertain"].includes(a.state) || !/^[a-f0-9]{40}$/.test(a.head) || !a.card || !a.repository || !a.grant || !/^[1-9][0-9]*$/.test(a.pr) || !a.branch || !a.base || !["merge", "squash", "rebase"].includes(a.method))) throw new Error("remote merge history malformed; retained for captain review");
  return value;
};
const write = (path: string, value: MergeAttempt[]) => { const temp = path + ".tmp"; writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(temp, path); };
// The adapter receives this root only from trusted Studio installation/project
// construction. Caller task directories are evidence locations, never authority.
const operationPath = (adapter: GitHubPrAdapter, pr: ReviewRequest, kind: "merge" | "update") => {
  const root = join(adapter.operationStore(), "remote-operations"); mkdirSync(root, { recursive: true, mode: 0o700 });
  const identity = { version: 2, kind, grant: adapter.grantIdentity(), repository: adapter.grant.repository, pr: pr.id, branch: pr.branch, base: pr.base, head: pr.head };
  return { path: join(root, createHash("sha256").update(JSON.stringify({version:2,kind,grant:identity.grant,repository:identity.repository,pr:identity.pr,head:identity.head})).digest("hex") + ".json"), identity };
};
const validateClaim = (path: string, identity: any) => {
  let a: any; try { a = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("shared remote operation record malformed; retained for captain review"); }
  if (Object.keys(identity).some(k => a[k] !== identity[k]) || !["started","succeeded","failed","uncertain"].includes(a.state) || !a.task || !Number.isFinite(Date.parse(a.at))) throw new Error("shared remote operation record malformed; retained for captain review");
  return a;
};
const legacyFinal = (adapter: GitHubPrAdapter, pr: ReviewRequest, dir: string, kind: "merge" | "update", store: ReturnType<typeof operationPath>) => {
  const paths = new Set([join(dir, `remote-${kind}-attempts.json`)]), runs = join(adapter.operationStore(), "runs");
  if (existsSync(runs)) for (const entry of readdirSync(runs, { withFileTypes: true })) if (entry.isDirectory()) paths.add(join(runs, entry.name, `remote-${kind}-attempts.json`));
  for (const path of paths) if (existsSync(path)) {
    let rows: any; try { rows=JSON.parse(readFileSync(path,"utf8")); } catch { throw new Error("legacy remote operation history malformed; retained for captain review"); }
    if (!Array.isArray(rows) || rows.some((a:any)=>a?.version!==1 || !["started","succeeded","failed","uncertain"].includes(a.state) || !/^[a-f0-9]{40}$/.test(a.head) || !a.repository || !a.grant || !/^[1-9][0-9]*$/.test(a.pr) || !a.branch || !a.base || !Number.isFinite(Date.parse(a.at)))) throw new Error("legacy remote operation history malformed; retained for captain review");
    // Version 1 has only an approval id, so cannot prove a changed grant. It can
    // deny a repeated target, but never authorize any retry or repaired record.
    const old=rows.find((a:any)=>a.repository===adapter.grant.repository && a.pr===pr.id && a.head===pr.head);
    if(old){
      // Persist denial before a task may be archived/deleted. Unverified legacy
      // evidence can only deny; it never grants a repair, success or retry.
      const denial={...store.identity,task:path,state:old.state,at:old.at,legacy:{version:1,path,unverified:true}};
      try{writeFileSync(store.path,JSON.stringify(denial),{flag:"wx",mode:0o600});}catch(e:any){if(e.code!=="EEXIST")throw e;validateClaim(store.path,store.identity);}
      throw new Error("remote operation is final for this head; historical attempt retained");
    }
  }
};
const available = (adapter: GitHubPrAdapter, pr: ReviewRequest, dir: string, kind: "merge" | "update") => {
  const store=operationPath(adapter,pr,kind); if(existsSync(store.path)){validateClaim(store.path,store.identity);throw new Error("remote operation is final for this head; shared attempt retained");}
  legacyFinal(adapter,pr,dir,kind,store);return store;
};
const claim = (adapter: GitHubPrAdapter, pr: ReviewRequest, dir: string, kind: "merge" | "update") => {
  const store=available(adapter,pr,dir,kind), value={...store.identity,task:dir,state:"started",at:new Date().toISOString()};
  try { writeFileSync(store.path,JSON.stringify(value),{flag:"wx",mode:0o600}); } catch(e:any) { if(e.code==="EEXIST"){validateClaim(store.path,store.identity);throw new Error("remote operation is final for this head; shared attempt retained");}throw e; }
  return (state:string) => { value.state=state; const temp=store.path+`.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,store.path); };
};
export async function mergeOnce(adapter: GitHubPrAdapter, pr: ReviewRequest, dir: string, card: string, signal?: AbortSignal, expectedBase?: string, assertOwner?: () => void, commit?: { title: string; message: string }, o: { observed?: boolean } = {}) {
  pr=structuredClone(pr);if(!adapter.recordedIdentity(pr))throw new Error("invalid remote operation identity");assertOwner?.();signal?.throwIfAborted();
  const op = adapter.operationGrant();
  if (!card?.trim()) throw new Error("remote merge requires a bound captain card");
  const key = adapter.grant.apiOrigin + "|" + adapter.grant.repository;
  if (owners.has(key)) throw new Error("repository merge already owned");
  owners.add(key);
  try {
    mkdirSync(dir, { recursive: true }); available(adapter,pr,dir,"merge"); const path = join(dir, "remote-merge-attempts.json"), history = read(path);
    if (history.some(a => a.repository !== adapter.grant.repository || a.grant !== adapter.grant.approvalId || a.pr !== pr.id || a.branch !== pr.branch || a.base !== pr.base)) throw new Error("remote merge history target mismatch");
    if (history.some(a => a.head === pr.head)) throw new Error("remote merge is final for this head; reconcile before a new head and card");
    if (history.some(a => a.card === card)) throw new Error("replacement head requires a new captain card");
    const attempt: MergeAttempt = { version: 1, repository: adapter.grant.repository, grant: adapter.grant.approvalId, pr: pr.id, branch: pr.branch, base: pr.base, head: pr.head, method: op.mergeMethod, card, state: "started", at: new Date().toISOString(), ...(o.observed ? { observed: true } : {}) };
    const finish=claim(adapter,pr,dir,"merge");
    history.push(attempt); write(path, history); // precedes every potentially mutating request
    try { const result = await adapter.mergeHead(pr, signal, expectedBase, assertOwner, commit, o); signal?.throwIfAborted(); assertOwner?.();attempt.result = result; attempt.state = "succeeded"; finish(attempt.state); write(path, history); return result; }
    catch (e) { attempt.state = signal?.aborted || (e as any)?.code === "REMOTE_OWNER_CHANGED" ? "uncertain" : "failed"; finish(attempt.state); write(path, history); throw e; }
  } finally { owners.delete(key); }
}
export const remoteMergeOwners = () => owners.size;

export function stablePatch(repo: string, base: string, head: string) {
  if (![base, head].every(s => /^[a-f0-9]{40}$/.test(s))) throw new Error("invalid patch binding");
  const diff = git(repo, ["diff", "--binary", "--no-ext-diff", "--no-textconv", base, head]);
  if (!diff.ok || !diff.out) throw new Error("empty or unavailable patch cannot carry approval");
  const id = git(repo, ["patch-id", "--stable"], diff.out).out.split(" ")[0];
  if (!/^[a-f0-9]{40}$/.test(id)) throw new Error("patch identity unavailable"); return id;
}
export function proveCleanCarry(repo: string, fromBase: string, fromHead: string, toBase: string, toHead: string) {
  const patch = stablePatch(repo, fromBase, fromHead);
  if (patch !== stablePatch(repo, toBase, toHead) || !git(repo, ["merge-base", "--is-ancestor", fromBase, toBase]).ok || !git(repo, ["merge-base", "--is-ancestor", toBase, toHead]).ok) throw new Error("patch or base history changed");
  const dir = mkdtempSync(join(tmpdir(), "crew-clean-carry-"));
  try {
    must(dir, ["clone", "--no-local", "--no-checkout", "-q", "--", repo, "."]);
    must(dir, ["checkout", "-q", "--detach", fromHead]);
    const merged = git(dir, ["merge", "--no-commit", "--no-ff", toBase]);
    let tree: string;
    if (merged.ok) tree = must(dir, ["write-tree"]);
    else { git(dir, ["merge", "--abort"]); must(dir, ["checkout", "-q", "--detach", fromHead]); must(dir, ["rebase", "--onto", toBase, fromBase]); tree = must(dir, ["rev-parse", "HEAD^{tree}"]); }
    if (tree !== must(repo, ["rev-parse", `${toHead}^{tree}`])) throw new Error("clean integration tree differs");
    return { version: 1, fromBase, fromHead, toBase, toHead, patch, clean: true };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export async function updateOnce(adapter: GitHubPrAdapter, pr: ReviewRequest, dir: string, signal?: AbortSignal, assertOwner?: () => void) {
  pr=structuredClone(pr);if(!adapter.recordedIdentity(pr))throw new Error("invalid remote operation identity");assertOwner?.();adapter.operationGrant(); signal?.throwIfAborted();
  const key = adapter.grant.apiOrigin + "|" + adapter.grant.repository;
  if (owners.has(key)) throw new Error("repository operation already owned"); owners.add(key);
  const path = join(dir, "remote-update-attempts.json");
  try {
    available(adapter,pr,dir,"update");
    let history: any[] = [];
    if (existsSync(path)) { try { history = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("update history malformed"); }
      if (!Array.isArray(history) || history.some(a => a?.version !== 1 || a.repository !== adapter.grant.repository || a.grant !== adapter.grant.approvalId || a.pr !== pr.id || a.branch !== pr.branch || a.base !== pr.base || !/^[a-f0-9]{40}$/.test(a.head) || !["started","succeeded","failed","uncertain"].includes(a.state))) throw new Error("update history malformed or target changed"); }
    if (history.some(a => a.head === pr.head)) throw new Error("update already attempted for this head; captain reconciliation required");
    const attempt: any = { version: 1, repository: adapter.grant.repository, grant: adapter.grant.approvalId, pr: pr.id, branch: pr.branch, base: pr.base, head: pr.head, state: "started", at: new Date().toISOString() };
    const finish=claim(adapter,pr,dir,"update");
    history.push(attempt); write(path, history);
    try { const result = await adapter.updateBranch(pr, signal, assertOwner); signal?.throwIfAborted(); assertOwner?.();attempt.state = "succeeded"; attempt.result = result; finish(attempt.state); write(path, history); return result; }
    catch (e) { attempt.state = signal?.aborted || (e as any)?.code === "REMOTE_OWNER_CHANGED" ? "uncertain" : "failed"; finish(attempt.state); write(path, history); throw e; }
  } finally { owners.delete(key); }
}

export function assertMergeAvailable(adapter: GitHubPrAdapter,pr: ReviewRequest,dir: string){
  available(adapter,pr,dir,"merge");
  const history=read(join(dir,"remote-merge-attempts.json"));
  if(history.some(a=>a.repository!==adapter.grant.repository||a.grant!==adapter.grant.approvalId||a.pr!==pr.id||a.base!==pr.base||a.branch!==pr.branch))throw new Error("remote merge attempt target changed");
  if(history.some(a=>a.head===pr.head))throw new Error("merge attempt is final on this head; new head and captain card required");
}
