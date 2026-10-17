import {OperatingRules,jobInstructions} from "../operating-rules";
import {selectTestCommand,packageTestCommand,prepareTestBase,testEnvironment,testRunner,selectionEnv,ranNoTests,treeState} from "../test-command";
import {localUnrestricted} from "../local-execution";
import { codeHandoffView } from "./code-handoff";
import { installCodeRecovery } from "./code-recovery";
import { installCodeQueue, scopeBlockers, type ScopeBlocker } from "./code-queue";
import { installCodeDesign } from "./code-design";
import { installCodePublish } from "./code-publish";
import { withoutSessionLinks } from "./pull-template";
import {GitHubPoller} from '../github-poller';
// The coding pipeline's runtime side (packs/firstmate, docs/code-firstmate-pipeline.md):
// a local git repository, a worktree on <branch_prefix><run>, the spec (what, why,
// done, scope, door, explain), the door, a plan round for one-way changes, build
// and fix rounds with a local brief bound to round + head, and what the
// firstmate pack's checks need: the diff, the base tree for fail-first, the
// repository's declared commands, the gate state. Natives here are checks that
// read Studio's own state (overlap, door, scope, the seven gates). GitHub publication is opt-in through an approved project remote grant.
//   <repo>/.crew/gates.json  {"test": [argv], "lint": [argv], "shards": N, "tests": [globs], "fixture_lists": [paths]}
//   <repo>/.crew/app.json    {"build": [argv with {out}], "pages": [{label, file}], "paths": [globs]}: an app whose pages
//                            are captured on the base and the head of a change that touches its paths (before / after)
import { createHash } from "node:crypto";
import { git, must } from "../git";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { folderTools, type AgentTool } from "../agent";
import { classify, loadDefaults, matches, Projects, type ChangedPath } from "../doors";
import type { Engine, X, Body } from "../runtime/engine";
import { LocalPrAdapter, GitHubPrAdapter, projectPrAdapter, type PrAdapter } from "../adapters/github";
import { locatorText } from "../runtime/locator";
import { amendmentsSection, briefSection, briefState, type BriefState, type CarryCheck } from "../runtime/refine";
import { sandboxed } from "../runtime/checks";
import { EnvGapError, RoundBlocked, Worktrees, rebaseConflictList } from "../worktrees";
import { envPreflight, installPlan, isNpmTestPlaceholder, type EnvGap } from "../env-preflight";
import type { SkeletonFacts } from "../runtime/brief-skeleton";
import { runRender } from "../render";
import { copyUntrusted } from "../secure";
import { helper, kindOf, LINES_PER_READ, LIST_CAP, listTree, normPath, READ_CAP_BYTES, searchTree, typedRead } from "../review-read";
import { COORDINATOR_TOOL_SCHEMA, coordinatorDetail, coordinatorText, designText, mergeDetail, type MergeInput } from "./mergecard";
import { RemoteWatchers, requiredPolicy, reconcile, inspectRemote, grantIdentity, registerRemoteWait, validRemoteWait, remoteStopBody, remoteStopReason, observedNotice, type RequiredPolicy } from "./remote-ci";
import { stablePatch, proveCleanCarry, mergeOnce, updateOnce, assertMergeAvailable } from "./remote-gates";
import type { CardDetail } from "../runtime/cards";
import { commitConvention, commitIdentity, commitSubject, commitTree, taskCommitMessage } from "./commit-message";
import { unverifiedClaim } from "./report-verification";

export { git, must };

export type RepoCfg = { test: string[] | null; lint: string[] | null; shards: number; tests: string[]; timeout_s: number; fixture_lists: string[]; testSource: string | null; testError?: string | null; testSkipped?: string | null;
  /** npm lifecycle hooks (pretest, posttest) the package declares around its test script: Studio runs the script text alone, never these */
  skippedHooks: string[] };
/**
 * The repository's declared commands, from one reader of its files. The test command is .crew/gates.json `test`; with no
 * `test` field there, the package.json test script (explicit null or an invalid value never falls back). The script text
 * itself becomes the argv (run like npm runs it: a shell, the package's own bins first on PATH), so a later edit of
 * package.json in the head never changes the command resolved from the base. The wrapper runs the script with the absolute
 * /bin/sh, never a `sh` found on the PATH it puts the worktree's node_modules/.bin in front of.
 */
export function repoCfgFrom(read: (path: string) => string | null): RepoCfg {
  let c: any = {}, testError: string | null = null, testSkipped: string | null = null;
  const raw = read(".crew/gates.json");
  try { c = JSON.parse(raw ?? "{}"); } catch { testError = "the base .crew/gates.json is not valid JSON"; }
  if (!c || typeof c !== "object" || Array.isArray(c)) { testError = "the base .crew/gates.json must be an object"; c = {}; }
  const argv = (v: any) => (Array.isArray(v) && v.length && v.every((s: any) => typeof s === "string") && v[0].trim() ? v : null);
  let packageTest: string[] | null = null, testSource: string | null = argv(c.test) ? ".crew/gates.json test" : null, skippedHooks: string[] = [];
  if (Object.prototype.hasOwnProperty.call(c, "test")) {
    if (c.test === null) testSkipped = "test execution explicitly disabled by base .crew/gates.json";
    else if (!argv(c.test)) testError = "the base .crew/gates.json test must be a nonempty argv array or null";
  } else if (!testError) {
    const rawPkg = read("package.json");
    if (rawPkg !== null) try {
      const pkg = JSON.parse(rawPkg);
      const script = pkg?.scripts?.test;
      if (script !== undefined && (typeof script !== "string" || !script.trim())) testError = "the base package.json scripts.test must be a nonempty string";
      else if (typeof script === "string") {
        testSource = `package.json scripts.test: ${script}`;
        if (isNpmTestPlaceholder(script)) testSkipped = "the base package.json has only npm init's no-test placeholder";
        else packageTest = ["/bin/sh", "-c", 'PATH="$PWD/node_modules/.bin:$PATH"; export PATH; exec /bin/sh -c "$1"', "crew-test", script];
        skippedHooks = ["pretest", "posttest"].filter((k) => typeof pkg.scripts[k] === "string" && pkg.scripts[k].trim());
      }
    } catch { testError = "the base package.json is not valid JSON"; }
  }
  if (!argv(c.test) && !packageTest && !testError && !testSkipped) testSkipped = "the repository declares no test command at the base";
  return { test: argv(c.test) ?? packageTest, lint: argv(c.lint), shards: Math.max(1, Math.min(8, Number(c.shards) || 1)), tests: Array.isArray(c.tests) && c.tests.length ? c.tests.map(String) : ["tests/**", "**/*.test.*", "test/**"],
    timeout_s: Number(c.timeout_s) || 180, fixture_lists: Array.isArray(c.fixture_lists) ? c.fixture_lists.map(String) : [], testSource, testError, testSkipped, skippedHooks };
}
export function repoCfg(dir: string): RepoCfg { return repoCfgFrom((p) => { try { return readFileSync(join(dir, p), "utf8"); } catch { return null; } }); }
const showAt = (repo: string, commit: string, path: string) => { const r = git(repo, ["show", `${commit}:${path}`]); return r.ok ? r.out : null; };
/** The declared commands as the base commit has them: a round cannot change the command its own checks run. */
export function repoCfgAt(repo: string, commit: string): RepoCfg { return repoCfgFrom((p) => showAt(repo, commit, p)); }

const READ_ONLY = (dir: string): AgentTool[] => folderTools(dir, () => {}, "fs").filter((t) => /_(list|read|search)$/.test(t.name));
export const changedOf = (wt: string, base: string): ChangedPath[] => {
  const ns = must(wt, ["diff", "--name-status", "-M", `${base}..HEAD`]).split("\n").filter(Boolean);
  const num = must(wt, ["diff", "--numstat", "-M", `${base}..HEAD`]).split("\n").filter(Boolean);
  return ns.map((l, i) => { const p = l.split("\t"); const n = num[i]?.split("\t") ?? []; return { path: p.at(-1)!, status: p[0], from: p[0].startsWith("R") ? p[1] : null, added: Number(n[0]) || 0, removed: Number(n[1]) || 0 }; });
};
const head = (wt: string) => must(wt, ["rev-parse", "HEAD"]);
/** Executed run_tests calls a worker gets per round; refused calls and runs that select no tests are not counted. */
const WORKER_TEST_RUNS = 10;
/** Executed run_tests calls a run-mode reviewer gets per review; refused calls and runs that select no tests are not counted. */
const REVIEW_TEST_RUNS = 3;
/** The base package.json scripts.test text, whatever source the declared test command came from (runner=npm-test runs it). */
const baseTestScript = (wt: string, base: string) => { const raw = showAt(wt, base, "package.json"); if (raw === null) return null; try { const s = JSON.parse(raw)?.scripts?.test; return typeof s === "string" ? s : null; } catch { return null; } };
/** A brief written for one head carries to the round's head only when the base alone moved (a merge of the base, or a rebase onto it):
 * the old base is an ancestor of the new one, and the task's own change (its stable patch id and its files) is the same. The proof is recorded. */
export const briefCarryCheck: CarryCheck = (b, x) => {
  const wt = x.ctx.worktree as string | undefined, from = String(b.head ?? ""), to = String(x.ctx.head ?? ""), base = String(x.ctx.baseCommit ?? "");
  if (!wt || !existsSync(wt)) return { ok: false, reason: "the worktree is gone" };
  if (![from, to, base].every((h) => /^[a-f0-9]{40}$/.test(h))) return { ok: false, reason: "a head or the base is not a full commit id, so it could not be checked" };
  if (!git(wt, ["cat-file", "-e", `${from}^{commit}`]).ok) return { ok: false, reason: "the brief's head is no longer in the repository" };
  const fromBase = git(wt, ["merge-base", base, from]).out.trim(), toBase = git(wt, ["merge-base", base, to]).out.trim();
  if (!/^[a-f0-9]{40}$/.test(fromBase) || !/^[a-f0-9]{40}$/.test(toBase)) return { ok: false, reason: "the heads share no history with the base" };
  if (!git(wt, ["merge-base", "--is-ancestor", fromBase, toBase]).ok) return { ok: false, reason: "the base did not move forward between the two heads" };
  const files = (h: string, bb: string) => must(wt, ["diff", "--name-only", bb, h]).split("\n").filter(Boolean).sort();
  let p1: string, p2: string; try { p1 = stablePatch(wt, fromBase, from); p2 = stablePatch(wt, toBase, to); } catch (e: any) { return { ok: false, reason: `the task's change could not be compared (${e?.message ?? e})` }; }
  const f1 = files(from, fromBase), f2 = files(to, toBase);
  if (p1 !== p2 || f1.join("\n") !== f2.join("\n")) return { ok: false, reason: "the task's change differs between the two heads" };
  return { ok: true, proof: { base: toBase, patch: p2, files: f2 } };
};
const isTest = (cfg: RepoCfg, p: string) => cfg.tests.some((g) => matches(g, p));
/** Host-owned inventory: checks consume paths, never reinterpret globs or walk generated artifacts. */
export function testFilesOf(wt: string, cfg: RepoCfg): string[] {
  return must(wt, ["ls-files", "-z"]).split("\0").filter(p => {
    if (!p || !isTest(cfg, p)) return false;
    try { return lstatSync(join(wt, p)).isFile(); } catch { return false; }
  }).sort();
}
const isDoc = (p: string) => /\.md$/i.test(p) || p.startsWith("docs/");
export const inScope = (scope: string[], p: string) => scope.some((s) => { const g = String(s).trim().replace(/^\.\//, ""); return !!g && (g === p || (g.endsWith("/") && p.startsWith(g)) || (/[*?]/.test(g) ? matches(g, p) : p.startsWith(g + "/"))); });
/** "R-0xx also edits src/a.ts; …" for each other in-flight Task whose scope meets this one (informational only). */
/** Studio v2 runtime rule for code workers (docs/v2-spec.md "Standing rules"): its own section,
 * not the captain's operating rules, and only in code-workflow worker (build) jobs. */
export const CONCURRENT_TASKS_RULE = "Code Tasks on one repository run concurrently, like pull requests. Other Tasks may change the same files as yours. Every build round starts on your branch rebased onto the current base; when the brief lists REBASE CONFLICTS, resolve them before anything else (keep both sides' intent, leave no conflict marker).";
const workerRuntimeRules = (system: string) => `${system}\n\n## Studio runtime rules\n\n${CONCURRENT_TASKS_RULE}`;
export const overlapNotes = (mine: string[], others: ScopeBlocker[]) => {
  const out: string[] = [];
  for (const r of others) {
    const unknown = !!r.identityUnavailable && !r.scope.length;
    const shared = unknown ? [] : mine.filter(p => r.scope.some((q: string) => inScope([q], p.replace(/\/$/, "/x")) || inScope([p], q.replace(/\/$/, "/x"))));
    if (!shared.length && !unknown) continue;
    out.push(`${r.run} (${r.title}) ${shared.length ? `also edits ${shared.join(", ")}` : "may edit the same files (its reservation history is unavailable)"}${r.retained ? `; it failed and is kept for captain recovery (park or archive ${r.run} to drop it)` : ""}: rebase onto the current base and resolve any conflict`);
  }
  return out;
};
/** Door: the spec's scope (or a diff) against the sensitive paths of the policy and the org list. */
export function doorOf(paths: ChangedPath[], sensitive: { glob: string; why: string }[], topLevel?: Set<string>) {
  const d = loadDefaults();
  const base = [...d.base, ...sensitive.filter((r) => !d.base.some((b) => b.glob === r.glob))];
  return classify(paths, { defaults: { ...d, base }, topLevel: topLevel ?? null });
}
const scopePaths = (scope: string[]): ChangedPath[] => scope.map((p) => ({ path: String(p).replace(/\/$/, "/x").replace(/\*\*?/g, "x"), added: 1 }));

export function installCode(engine: Engine, o: { dataDir: string; projects: Projects; adapter?: PrAdapter; poller?:GitHubPoller; improve?: { checkTriggers?: () => Promise<any> } | null;
  /** test-only seams; production never sets them. afterBuildExit: called once the app build has exited and before its output is read (it models a writer still holding the build's folder) */
  seams?: { afterBuildExit?: (rawDir: string, side: "before" | "after") => void | Promise<void> } }) {
  installCodeQueue(engine);
  const priorCardView = engine.cards.view;
  engine.cards.view = card => codeHandoffView(priorCardView(card));
  engine.beforeNodeChecks ??= {}; engine.cardPrepared ??= {}; engine.beforeStart ??= {}; engine.externalHandlers ??= {}; engine.externalValidators ??= {};
  // A worker asking the captain for scope/door authority has not completed a build.
  // Preserve the escalation; do not fabricate passing check entries or enter CI.
  engine.beforeNodeChecks["worker-escalation"] = (x, result) => {
    if (x.node.kind !== "agent" || x.node.mode !== "build" || !("outcome" in result)) return false;
    const report = x.rn.data.report;
    if (!report || report.round !== x.visit || !engine.owns(x)) return false;
    return (result.outcome === "blocked" && report.marker === "SCOPE-BLOCKED")
      || (["ask", "cap"].includes(result.outcome) && report.marker === "ASK")
      || (result.outcome === "door-change" && report.marker === "DOOR-CHANGE");
  };
  const pendingRebaseChecks = new WeakSet<object>();
  type RemoteMergeIntent = {version:1;grant:string;repository:string;pr:string;branch:string;base:string;baseHead:string;head:string;method:string;policyHash:string};
  const preparedRemoteCards = new WeakMap<object,{intent:RemoteMergeIntent;assert:()=>void}>();
  engine.beforeNodeChecks["native-rebase"]=(x,result)=>{
    if(!pendingRebaseChecks.has(x.rn))return false;
    pendingRebaseChecks.delete(x.rn);
    const rec=W.get(wkey(x).project,wkey(x).task);
    if(!engine.owns(x)||!("outcome" in result)||result.outcome!=="rebase-more"||x.node.mode!=="build"||!rec?.nativeRebase||rec.nativeRebase.version!==1||rec.head!==x.ctx.head||head(rec.path)!==rec.head||!existsSync(must(rec.path,["rev-parse","--git-path","rebase-merge"])))throw new Error("pending native rebase ownership changed before checks");
    return true; // no check entry, PASS or proof exists for the incomplete rebase
  };
  engine.cardPrepared["remote-intent"]=(x,card,body)=>{
    const prepared=body.detail?preparedRemoteCards.get(body.detail):undefined;if(!prepared)return;
    preparedRemoteCards.delete(body.detail!);prepared.assert();
    if(!engine.owns(x)||card.kind!=="merge"||prepared.intent.head!==x.ctx.head||card.detail?.remoteTarget?.head!==prepared.intent.head)throw new Error("remote merge card ownership changed");
    engine.record(x,"remote-merge-request",{head:prepared.intent.head,data:{...prepared.intent,card:card.id}} as any);
  };
  const adapter = o.adapter ?? new LocalPrAdapter();
  const remoteAdapters = new Map<string, GitHubPrAdapter>(), remoteWatchers = new RemoteWatchers(60000,o.poller);
  const digest = (v: any) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  const pendingUpdate = (x: X,a: GitHubPrAdapter) => {
    const p=x.ctx.remoteUpdatePending,t=engine.trusted(x.run.id);
    if(p?.version!==1||p.grant!==grantIdentity(a)||p.repository!==a.grant.repository||JSON.stringify(p.old)!==JSON.stringify(x.ctx.pr)||p.old.head!==x.ctx.head||p.old.head!==head(shellOk(x))||p.old.branch!==x.ctx.branch||p.fromBase!==x.ctx.baseCommit||JSON.stringify({...p.next?.pr,head:p.old.head})!==JSON.stringify(p.old)||!/^[a-f0-9]{40}$/.test(p.next?.pr?.head)||p.next.pr.head===p.old.head||!/^[a-f0-9]{40}$/.test(p.next.baseHead)||!Number.isSafeInteger(p.startedAt)||!Number.isSafeInteger(p.deadline)||p.deadline<=p.startedAt||p.deadline-p.startedAt>24*3600_000||Date.now()>=p.deadline||!t.ok||!t.entries.some(e=>e.record==="remote-update-request"&&e.seq===p.request&&e.head===p.old.head&&e.data?.grant===p.grant&&e.data?.repository===p.repository&&e.data?.base===p.fromBase&&JSON.stringify(e.data?.pr)===JSON.stringify(p.old))||!t.entries.some(e=>e.record==="remote-update-result"&&e.head===p.old.head&&e.data?.hash===digest(p)))throw new Error("pending remote update malformed, expired or target changed; retained for captain recovery");
    return structuredClone(p);
  };
  const restoreNaming = (x: X,a: PrAdapter): PrAdapter => {
    if(!(a instanceof GitHubPrAdapter))return a;a.bindOperationStore(o.dataDir);a.clearNaming();const n=x.ctx.remoteNaming,t=engine.trusted?.(x.run.id)??{ok:false,entries:[]};
    if(x.ctx.remoteUpdatePending){
      let p:any;try{p=pendingUpdate(x,a);}catch{return a;}const prior=p.naming;
      if((prior?.version===2||(prior?.version===3&&t.entries.some(e=>e.record==="remote-update-result"&&e.head===prior.sourceHead&&e.data?.hash===prior.pendingHash&&digest(e.data?.pending)===prior.pendingHash&&e.data?.pending?.next?.pr?.head===prior.head&&e.data?.pending?.grant===prior.grant)))&&prior.head===x.ctx.head&&prior.head===head(shellOk(x))&&prior.repository===a.grant.repository&&prior.grant===grantIdentity(a)&&prior.branch===x.ctx.branch&&t.ok&&t.entries.some(e=>e.record==="naming-request"&&e.head===prior.head&&JSON.stringify(e.data)===JSON.stringify(prior))&&t.entries.some(e=>e.record==="card-answer"&&e.node===prior.node&&e.head===(prior.version===3?prior.sourceHead:prior.head)&&e.data?.card===prior.card&&e.data?.kind==="scope"&&e.data?.choice==="approve-name"&&!String(e.actor??"").startsWith("auth window")))a.approveBranch(prior.branch,prior.head,prior.grant);
    }
    if(!n||n.repository!==a.grant.repository||n.grant!==grantIdentity(a)||n.branch!==x.ctx.branch||!t.ok)return a;
    const request=t.entries.some(e=>e.record==="naming-request"&&e.head===n.head&&JSON.stringify(e.data)===JSON.stringify(n));
    const answer=t.entries.some(e=>e.record==="card-answer"&&e.node===n.node&&e.head===(n.version===3?n.sourceHead:n.head)&&e.data?.card===n.card&&e.data?.kind==="scope"&&e.data?.choice==="approve-name"&&!String(e.actor??"").startsWith("auth window"));
    if(!request||!answer)return a;
    if(n.version===2&&n.head===x.ctx.head&&n.head===head(shellOk(x)))a.approveBranch(n.branch,n.head,n.grant);
    if(n.version===3){
      const proof:any=t.entries.find(e=>e.record==="remote-update-result"&&e.head===n.sourceHead&&e.data?.hash===n.pendingHash)?.data?.pending;
      if(!proof||digest(proof)!==n.pendingHash||proof.grant!==n.grant||proof.repository!==n.repository||proof.old.head!==n.sourceHead||proof.next?.pr?.head!==n.head||proof.next.pr.branch!==n.branch)return a;
      const current=n.head===x.ctx.head&&n.head===head(shellOk(x));
      if(current||(x.ctx.remoteUpdatePending&&digest(pendingUpdate(x,a))===n.pendingHash))a.approveBranch(n.branch,n.head,n.grant);
    }
    return a;
  };
  const selectedAdapter = (x: X): PrAdapter => {
    if(o.adapter)return restoreNaming(x,o.adapter);
    const project=x.ctx.project?o.projects.get(x.ctx.project):null;if(!project?.github)return new LocalPrAdapter();
    const key=JSON.stringify(project.github)+"|"+x.run.id;let a=remoteAdapters.get(key);
    if(!a){a=projectPrAdapter(project,o.dataDir,o.poller) as GitHubPrAdapter;remoteAdapters.set(key,a);}return restoreNaming(x,a);
  };
  const remotePhase = (x: X) => {
    const signal = engine.abortOf?.(x.run)?.signal;
    const target = () => JSON.stringify({ project:x.ctx.project??null,repo:x.ctx.repo??null,worktree:x.ctx.worktree??null,wt:x.ctx.wt??null,
      base:x.ctx.base??null,baseCommit:x.ctx.baseCommit??null,branch:x.ctx.branch??null,head:x.ctx.head??null,
      pr:x.ctx.pr ? {adapter:x.ctx.pr.adapter,id:x.ctx.pr.id,repo:x.ctx.pr.repo,base:x.ctx.pr.base,branch:x.ctx.pr.branch,head:x.ctx.pr.head,url:x.ctx.pr.url} : null,
      pending:x.ctx.remoteUpdatePending??null,
      grant:o.adapter instanceof GitHubPrAdapter ? grantIdentity(o.adapter) : x.ctx.project ? o.projects.get(x.ctx.project)?.github??null : null });
    let pinned=target();
    const owned = () => !signal?.aborted && (engine.owns ? engine.owns(x) : !x.cancelled?.());
    const live = () => owned() && target() === pinned;
    const assert = () => { if (!live()) throw Object.assign(new Error("remote operation owner or target changed"),{code:"REMOTE_OWNER_CHANGED"}); };
    // Only a verified native readiness CAS changes its own PR/head/base binding.
    // The call occurs synchronously after that hand-back, before another await.
    const rebind = () => {
      if(!owned())throw new Error("remote rebind owner ended");
      const before=JSON.parse(pinned),after=JSON.parse(target());
      for(const key of Object.keys(before))if(!["head","baseCommit","pr"].includes(key)&&!(key==="pending"&&before.pending&&after.pending===null&&before.pending.next?.pr?.head===after.head)&&JSON.stringify(before[key])!==JSON.stringify(after[key]))throw new Error("remote rebind changed grant or task identity");
      if(before.pr&&JSON.stringify({...after.pr,head:before.pr.head})!==JSON.stringify(before.pr))throw new Error("remote rebind changed PR identity");
      pinned=target();
    };
    const retainPending = () => {
      if(!owned())throw new Error("pending update owner ended");const before=JSON.parse(pinned),after=JSON.parse(target());
      if(before.pending!==null||after.pending?.old?.head!==before.head||JSON.stringify({...after,pending:null})!==JSON.stringify({...before,pending:null}))throw new Error("pending update changed original remote target");
      pinned=target();
    };
    return { signal, live, assert, rebind, retainPending };
  };
  engine.beforeStart["github-reconcile"] = async x => {
    if (x.ctx.pr?.adapter !== "github" || x.node.do === "pr.open") return null;
    const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x);
    try { if (!(a instanceof GitHubPrAdapter)) throw new Error(); if(x.ctx.remoteUpdatePending){const p=pendingUpdate(x,a);await a.verifyUpdateResult(p.old,p.next,phase.signal,phase.assert);}else await reconcile(a, x.ctx.pr, phase.signal); phase.assert(); return null; }
    catch { if (!phase.live()) return { outcome: "cancel" }; await engine.card(x, "step-back", remoteStopBody(x.node.mode === "build" ? "the PR or its Task branch changed on GitHub since Studio last pushed (for example someone else pushed); this round did not rebase or push anything" : "authoritative PR/ref changed at node start; verification stopped")); return { wait: true }; }
  };
  engine.externalValidators["github-ci"] = (x, descriptor) => { const a = selectedAdapter(x); return a instanceof GitHubPrAdapter && validRemoteWait(descriptor, a); };
  engine.externalHandlers["github-ci"] = (x, descriptor, wake) => {
    const a = selectedAdapter(x);
    if (!(a instanceof GitHubPrAdapter)) { queueMicrotask(() => wake({ outcome: "error", note: "remote grant is no longer available" })); return () => {}; }
    return registerRemoteWait(x, a, remoteWatchers, descriptor, wake);
  };
  const remoteWait = async (x: X, a: PrAdapter) => {
    if (!(a instanceof GitHubPrAdapter)) return "ok";
    const phase = remotePhase(x); phase.assert(); x.ctx.remoteCI = null;
    try { await reconcile(a, x.ctx.pr, phase.signal); phase.assert(); const policy = await requiredPolicy(a, phase.signal); phase.assert(); const startedAt = Date.now();
      // branch protection GitHub does not show: every check on the head is required instead; recorded once per pull request head
      const notice = observedNotice(policy);
      if (notice && !engine.ledger(x.run.id).some((e: any) => e.record === "remote-policy-notice" && e.head === x.ctx.pr.head)) { engine.record(x, "remote-policy-notice", { head: x.ctx.pr.head, data: { version: 1, observed: policy.observed, repository: a.grant.repository, base: a.grant.base, notice: notice.en } } as any); x.log(`remote CI: ${notice.en}`); }
      const duration = Math.max(1000, Math.min(24 * 3600_000, Number(x.policy("remote_ci.timeout_s", 1800)) * 1000 || 1800_000));
      return { wait: true as const, external: { version: 1 as const, handler: "github-ci", grant: grantIdentity(a), repository: a.grant.repository, pr: structuredClone(x.ctx.pr), policy, startedAt, deadline: startedAt + duration, lastDigest: null }, note: "waiting for required remote CI on the exact PR head" };
    } catch (e) { if (!phase.live()) return { outcome: "cancel" }; await engine.card(x, "step-back", remoteStopBody(remoteStopReason(e, "remote PR or required policy could not be verified"))); return { wait: true as const }; }
  };
  // one worktree per task under data/work/<project>/<task> (src/worktrees.ts); the task is the run
  const W = new Worktrees(o.dataDir, { protect: () => engine.deps.protectedRoots ?? [], egress: () => (engine.deps.agents as any).egress ?? null });
  const recoverLocalRescope=installCodeRecovery(engine,W);
  const wkey = (x: { ctx: any; run?: any; id?: string }) => ({ project: x.ctx.wt?.project ?? "local", task: x.ctx.wt?.task ?? (x.run?.id ?? x.id) });
  const tmpTree = (run: string, what: string) => W.tmpOf(run, what);
  /** a run's temporary worktree, added only on a repository whose shared git config is sound (a typed refusal otherwise) */
  const addTree = (repo: string, rest: string[]) => { W.guard(repo); return must(repo, ["worktree", "add", ...rest]); };
  const held = new Map<string, () => void>();
  const cfgOf = (x: X) => x.ctx.repo && x.ctx.baseCommit ? repoCfgAt(x.ctx.repo, x.ctx.baseCommit) : repoCfg(x.ctx.worktree ?? x.ctx.repo);
  const shellOk = (x: X) => { if (!x.ctx.worktree || !existsSync(x.ctx.worktree)) throw new Error("the run's worktree is gone"); return x.ctx.worktree as string; };
  const sensitive = (x: X) => (x.policy("sensitive_paths") ?? []) as { glob: string; why: string }[];

  // ---------- what checks see ----------
  engine.sourceRoots.code = (x) => x.ctx.worktree ?? null; // the round brief reads file evidence at the head of the task's worktree
  engine.artifacts["code-diff"] = (x) => x.ctx.worktree && existsSync(x.ctx.worktree) ? ({ type: "code-diff", workdir: x.ctx.worktree, repo: x.ctx.repo, base: x.ctx.base, baseCommit: x.ctx.baseCommit, head: head(x.ctx.worktree), branch: x.ctx.branch, door: x.ctx.door?.door ?? null, scope: x.ctx.spec?.scope ?? [] }) : null;
  engine.checkBindings ??= {};
  engine.checkBindings["firstmate/review-verdict"] = (_x, input) => {
    const a = input.artifact as any;
    if (!a?.head || !a?.baseCommit || !a?.workdir) return { version: 1, unverified: true };
    try { return { version: 1, head: a.head, base: a.baseCommit, patch: stablePatch(a.workdir, a.baseCommit, a.head) }; }
    catch { return { version: 1, head: a.head, base: a.baseCommit, unverified: true }; }
  };
  engine.artifacts.spec = (x) => ({ type: "spec", workdir: x.ctx.worktree ?? null, data: x.ctx.spec ?? null, version: x.ctx.spec?.version ?? 0 });
  engine.artifacts.plan = (x) => ({ type: "plan", workdir: x.ctx.worktree ?? null, data: x.ctx.plan ?? null });
  engine.artifacts.run = (x) => ({ type: "run", workdir: x.ctx.repo ?? null, id: x.run.id, workflow: x.run.workflow });
  engine.needs.inflight = (x) => scopeBlockers(engine, x.run);
  engine.needs.texts = (x) => { const s = x.ctx.spec; if (!s) return []; return [{ section: "title", text: s.title }, { section: "what", text: s.what }, ...s.why.map((t: string, i: number) => ({ section: `why[${i}]`, text: t })), ...s.done.map((t: string, i: number) => ({ section: `done[${i}]`, text: t.replace(/(tests?\/[\w./-]+|[\w./-]+\.test\.\w+)/g, "") })), ...(s.explain?.en ? [{ section: "explain.en", text: s.explain.en }] : []),
    // the zh-TW the cards show: checked here, at the spec, so an English or placeholder translation goes back to the coordinator before any card
    ...(s.zh?.title ? [{ section: "zh-TW.title", text: s.zh.title }] : []), ...(s.zh?.why ?? []).map((t: string, i: number) => ({ section: `zh-TW.why[${i}]`, text: t })), ...(s.explain?.["zh-TW"] ? [{ section: "zh-TW.explain", text: s.explain["zh-TW"] }] : [])]; };
  engine.needs.diff = (x) => ({ paths: changedOf(shellOk(x), x.ctx.baseCommit) });
  engine.needs.diff_text = (x) => git(shellOk(x), ["diff", "--no-color", `${x.ctx.baseCommit}..HEAD`]).out.slice(0, 24000);
  engine.needs.scope = (x) => x.ctx.spec?.scope ?? [];
  engine.needs.repo_cfg = (x) => {const cfg=cfgOf(x),wt=shellOk(x);return{...cfg,runner:testRunner(cfg),testEnv:testEnvironment(),testFiles:testFilesOf(wt,cfg),selectedTests:changedOf(wt,x.ctx.baseCommit).filter(p=>isTest(cfg,p.path)&&!p.status?.startsWith('D')).map(p=>p.path)};};
  engine.needs.report = (x) => x.run.nodes.build?.data?.report ?? null;
  engine.needs.brief_classes = (x) => (x.ctx.briefs?.build?.items ?? []).map((i: any) => i.class);
  engine.needs.ci_timings = (x) => { const e = engine.ledger(x.run.id).filter((y) => y.check === "firstmate/ci").at(-1) as any; return e?.data?.shards ?? null; };
  engine.needs.followups = (x) => x.ctx.followups ?? [];
  engine.needs.merge_state = (x) => ({ repo: x.ctx.repo, base: x.ctx.base, head: x.ctx.merged?.head ?? null });
  engine.needs.gate_state = (x) => ({ door: x.ctx.door?.door ?? null, checks: engine.ledger(x.run.id).map((e) => ({ check: e.check, verdict: e.verdict, head: e.head, seq: e.seq })) });
  /** fail-first's base tree: the head with its changed behaviour files put back to the merge base (tests kept). */
  engine.needs.base_tree = (x) => {
    const wt = shellOk(x); const cfg = cfgOf(x); const ch = changedOf(wt, x.ctx.baseCommit);
    const tests = ch.filter((p) => isTest(cfg, p.path) && !p.status?.startsWith("D")).map((p) => p.path);
    const beh = ch.filter((p) => !isTest(cfg, p.path) && !isDoc(p.path) && !p.path.startsWith(".crew/") && !p.path.startsWith(".github/"));
    if (!beh.length) return { applicable: false, tests, behaviour: [], path: null };
    const tmp = tmpTree(x.run.id, "base"); git(x.ctx.repo, ["worktree", "remove", "--force", tmp]); rmSync(tmp, { recursive: true, force: true });
    addTree(x.ctx.repo, ["-q", "--detach", tmp, head(wt)]);
    for (const p of beh) { if (p.status?.startsWith("A")) rmSync(join(tmp, p.path), { force: true }); else { must(tmp, ["checkout", x.ctx.baseCommit, "--", p.from ?? p.path]); if (p.from && p.from !== p.path) rmSync(join(tmp, p.path), { force: true }); } }
    return { applicable: true, tests, behaviour: beh.map((p) => p.path), path: tmp };
  };
  engine.needs.main_tree = (x) => {
    if (!x.ctx.repo) return null; const tmp = tmpTree(x.run.id, "main"); git(x.ctx.repo, ["worktree", "remove", "--force", tmp]); rmSync(tmp, { recursive: true, force: true });
    addTree(x.ctx.repo, ["-q", "--detach", tmp, x.ctx.merged?.adapter === "github" ? x.ctx.merged.head : x.ctx.base]); return tmp;
  };
  engine.needs.screenshots = async (x) => {
    // the app's before / after captures when this head has them (firstmate/ui-captures); else the changed UI paths for the judge to read in the diff
    const cap = x.ctx.captures; if (cap && cap.head === head(shellOk(x)) && cap.pages?.length) return { pages: cap.pages.map((p: any) => ({ label: p.label, before: p.before, after: p.after, changed: p.changed })), note: "before / after captures of the app" };
    const ui: string[] = x.policy("ui_paths") ?? []; const ch = changedOf(shellOk(x), x.ctx.baseCommit).filter((p) => ui.some((g) => matches(g, p.path)));
    return { pages: ch.map((p) => p.path), note: ch.length ? "screenshots need the renderer (Doctor); the judge reads the diff" : "no UI path changed" };
  };
  engine.expand["repo.lint"] = (x) => cfgOf(x).lint;
  engine.expand["repo.test"] = (x) => cfgOf(x).test;

  // ---------- natives (checks over Studio's own state) ----------
  const F = (locator: any, message: string, expected: string, cls: string) => ({ locator, message, expected, class: cls, severity: "blocking" as const });
  /**
   * The round contract's environment preflight (P2, P3), at the spec, before the dispatch card: the dependencies the base's
   * lockfile needs and their package manager, the test command resolved from the base, and every done line's test path
   * against the repository's test globs. A gap is a typed record (ctx.envGaps, an env_gap event) and a blocking finding
   * whose class is its code: the refine loop sends it to Firstmate's spec repair turn, and only env.permission (a host
   * the round sandbox must be allowed to reach) is routed to a captain card (code-firstmate.wf.yaml spec-fix route_classes).
   */
  const envGapsOf = (x: X): EnvGap[] => {
    if (!x.ctx.repo || !x.ctx.baseCommit) return [];
    const top = new Set(git(x.ctx.repo, ["ls-tree", "--name-only", x.ctx.baseCommit]).out.split("\n").filter(Boolean));
    const install = x.policy("install");
    return envPreflight({ cfg: repoCfgAt(x.ctx.repo, x.ctx.baseCommit), done: x.ctx.spec?.done ?? [], has: (p) => top.has(p), read: (p) => showAt(x.ctx.repo, x.ctx.baseCommit, p),
      install: install === false ? false : Array.isArray(install) ? install.map(String) : null, scripts: x.policy("install_scripts") === true,
      egressHosts: ([] as any[]).concat(x.policy("egress.allow", []) ?? []).map(String).filter(Boolean), unrestricted: localUnrestricted() });
  };
  const recordEnvGaps = (x: X, gaps: EnvGap[], at: "dispatch" | "round") => {
    x.ctx.envGaps = gaps.map((g) => ({ ...g, at, spec: x.ctx.spec?.version ?? null })); x.save();
    for (const g of gaps) engine.emit(x.run, "env_gap", `${g.code} → ${g.route === "captain" ? "the captain (a permission)" : "Firstmate"}: ${g.message}`, { node: x.node.id, code: g.code, route: g.route, at });
  };
  /**
   * A code round's facts for the brief's fixed sections (runtime/brief-skeleton.ts): the declared test and lint commands
   * at the base, the test globs, the run budget, the dependency install and its state, the host browser library, the
   * preflight's open gaps, and on a GitHub project the push facts. The manual pages hold the procedure.
   */
  const codeFacts = (x: X, role: "coordinator" | "worker" | "reviewer" | "designer", f: { runs?: number; deliverable: string[] }): SkeletonFacts => {
    const manual = [`code-firstmate/${role}`];
    const github = !!(x.ctx.project && o.projects.get(x.ctx.project)?.github); if (github) manual.push("code-firstmate/github");
    let cfg: RepoCfg | null = null; try { cfg = cfgOf(x); } catch {}
    const tests = !cfg ? ["Test command: unknown (the repository's configuration could not be read at the base)."]
      : cfg.testError ? [`Test command: invalid (${cfg.testError}).`]
      : cfg.test ? [`Test command: ${cfg.test.join(" ")} (from ${cfg.testSource ?? "the repository"}).`] : [`Test command: none declared${cfg.testSkipped ? ` (${cfg.testSkipped})` : ""}: tests are not-run, which is not a reason to HOLD.`];
    if (cfg) tests.push(`Lint command: ${cfg.lint ? cfg.lint.join(" ") : "none declared"}.`, `Test globs: ${cfg.tests.join(", ")}.`);
    if (f.runs) tests.push(`run_tests budget: ${f.runs} executed runs this round.`);
    const deps: string[] = [];
    const install = x.policy("install");
    if (install === false) deps.push("Dependency install: off (project policy install: false).");
    else { let plan: { argv: string[]; lockfile: string } | null = null;
      try { if (Array.isArray(install) && install.length) plan = { argv: install.map(String), lockfile: "the project's install policy" };
        else if (x.ctx.repo && x.ctx.baseCommit) { const top = new Set(git(x.ctx.repo, ["ls-tree", "--name-only", x.ctx.baseCommit]).out.split("\n").filter(Boolean)); plan = installPlan((p) => top.has(p), (p) => showAt(x.ctx.repo, x.ctx.baseCommit, p), { scripts: x.policy("install_scripts") === true }); } } catch {}
      deps.push(plan ? `Dependency install: ${plan.argv.join(" ")} (${plan.lockfile}), run by Studio before the round.` : "Dependency install: none (no package.json with a lockfile at the base).");
      const wt = x.ctx.worktree; if (plan && wt) deps.push(`Dependencies in the worktree: ${existsSync(join(wt, "node_modules")) ? "installed" : "not installed"}.`); }
    deps.push(testEnvironment().PLAYWRIGHT_MODULE ? "Host browser library: available to tests through PLAYWRIGHT_MODULE." : "Host browser library: not available to tests here (no PLAYWRIGHT_MODULE); a browser test cannot run in this round.");
    const gaps = (x.ctx.envGaps ?? []) as EnvGap[];
    deps.push(gaps.length ? `Open preflight gaps: ${gaps.map((g) => `${g.code}: ${g.message}`).join("; ")}.` : "Environment preflight: no open gap.");
    const env = [`Branch ${x.ctx.branch ?? "(not made yet)"} on base ${x.ctx.base ?? "(unknown)"}${x.ctx.baseCommit ? ` at ${String(x.ctx.baseCommit).slice(0, 12)}` : ""}${x.ctx.head ? `, head ${String(x.ctx.head).slice(0, 12)}` : ""}.`];
    if (github) env.push("GitHub project: Studio rebases this branch every round and pushes only it, with a lease; you never push.");
    return { manual, ENVIRONMENT: env, TESTS: tests, DEPENDENCIES: deps, DELIVERABLE: f.deliverable };
  };
  engine.natives["env-preflight"] = (_i, h) => {
    const x = h.x as X | undefined; if (!x) return { verdict: "pass", score: 1, findings: [] };
    const gaps = envGapsOf(x); recordEnvGaps(x, gaps, "dispatch");
    const findings = gaps.map((g) => ({ locator: g.done != null ? { type: "text", section: `done[${g.done}]` } : g.code === "env.test-command" ? { type: "file", path: ".crew/gates.json" } : { type: "text", section: "env" },
      message: g.message, expected: g.expected, class: g.code, severity: "blocking" as const }));
    return { verdict: gaps.length ? "fail" : "pass", score: gaps.length ? 0 : 1, findings, data: { gaps, testing: (() => { const cfg=cfgOf(x); return cfg.testError ? {status:"invalid",reason:cfg.testError} : !cfg.test ? {status:"not-run",reason:cfg.testSkipped} : {status:"configured",command:cfg.test}; })() } } as any;
  };
  /** Other Tasks writing the same paths, as an informational note only: Tasks build
   * concurrently, each build round rebases onto the current base and the worker
   * resolves any conflict there. It never fails the spec, refines it or steps back. */
  engine.natives.overlap = (i) => {
    const notes = overlapNotes(i.artifact?.data?.scope ?? [], i.inflight ?? []);
    return { verdict: "pass", score: 1, findings: notes.map(n => ({ ...F({ type: "text", section: "scope" }, n, "nothing to change: rebase onto the current base each round and resolve any conflict", "scope-overlap-note"), severity: "minor" as const })), data: { notes } } as any;
  };
  /** The door: the spec's scope (and, once code exists, the diff) against the sensitive paths; a captain's pick on the door card wins. data.route picks the edge. */
  engine.natives["door-classify"] = (i, h) => {
    const x = h.x as X | undefined;
    const paths: ChangedPath[] = i.artifact?.type === "spec" ? scopePaths(i.artifact.data?.scope ?? []) : [];
    const wd = i.artifact?.type === "code-diff" ? i.artifact : x?.ctx?.worktree && x.ctx.baseCommit && existsSync(x.ctx.worktree) ? { workdir: x.ctx.worktree, baseCommit: x.ctx.baseCommit } : null;
    if (wd && head(wd.workdir) !== wd.baseCommit) paths.push(...changedOf(wd.workdir, wd.baseCommit));
    let d: any = doorOf(paths, i.params.sensitive_paths ?? []);
    const chosen = x?.ctx?.answers?.["door-pick"]?.choice;
    if (d.door === "undecided" && (chosen === "one-way" || chosen === "two-way")) d = { ...d, tier: chosen, door: chosen, decidedBy: "captain" };
    return { verdict: "pass", score: 1, findings: d.reasons.filter((r: any) => r.list !== "trivial").map((r: any) => ({ locator: { type: "file", path: r.path }, message: `${r.path}: ${r.why}${r.glob ? ` (${r.glob})` : ""}`, expected: null, class: `door-${d.door}`, severity: "minor" })), data: { ...d, route: d.door } } as any;
  };
  engine.natives.scope = (i) => {
    const scope: string[] = i.scope ?? []; const out = (i.diff?.paths ?? []).filter((p: ChangedPath) => !inScope(scope, p.path) && !(p.from && inScope(scope, p.from)));
    return { verdict: out.length ? "fail" : "pass", score: out.length ? 0 : 1, findings: out.map((p: ChangedPath) => F({ type: "file", path: p.path }, `${p.path} is outside the spec's scope (${scope.join(", ")})`, "undo the change, or report SCOPE-BLOCKED", "scope")) };
  };
  engine.natives["shard-budget"] = (i) => {
    const sh = i.ci_timings ?? []; const over = sh.filter((s: any) => s.ms / 1000 > i.params.budget_s);
    return { verdict: over.length ? "fail" : "pass", score: over.length ? 0 : 1, findings: over.map((s: any) => F({ type: "file", path: ".crew/gates.json" }, `shard ${s.shard}/${s.of} took ${Math.round(s.ms / 1000)} s (budget ${i.params.budget_s} s)`, "split the slow suite or rebalance the shards", "shard-budget")), data: { shards: sh } } as any;
  };
  const gate = (name: string, f: (x: X, h: string) => { ok: boolean; detail: string; cls?: string; loc?: any; skip?: boolean }) => {
    engine.natives[`gate-${name}`] = (i, hp) => { const x = hp.x as X; const wt = shellOk(x); const h = head(wt); x.ctx.gatedHead = h; const r = f(x, h);
      return { verdict: r.skip ? "pass" : r.ok ? "pass" : "fail", score: r.ok ? 1 : 0, findings: r.ok ? [] : [F(r.loc ?? { type: "card", field: name }, r.detail, `gate ${name} passes on ${h.slice(0, 8)}`, r.cls ?? `gate-${name}`)], data: { detail: r.detail, head: h } } as any; };
  };
  const lastPass = (x: X, check: string, h: string) => engine.ledger(x.run.id).filter((e) => e.check === check).at(-1) as any;
  gate("branch", (x) => { const b = git(x.ctx.worktree, ["symbolic-ref", "--short", "HEAD"]).out; return { ok: b === x.ctx.branch, detail: b === x.ctx.branch ? `on ${b}` : `on ${b || "a detached HEAD"}, not ${x.ctx.branch}` }; });
  gate("rebase", (x, h) => { const target = x.ctx.pr?.adapter === "github" ? x.ctx.baseCommit : x.ctx.base; const ok = git(x.ctx.repo, ["merge-base", "--is-ancestor", target, h]).ok; return { ok, detail: ok ? `${x.ctx.base} is an ancestor of ${h.slice(0, 8)}: it fast-forwards` : `${x.ctx.base} moved: rebase onto it first`, cls: "behind-base" }; });
  const localGateRebase = engine.natives["gate-rebase"];
  engine.natives["gate-rebase"] = async(i,hp) => {
    const x=hp.x as X;if(x.ctx.pr?.adapter!=="github")return localGateRebase(i,hp);
    const phase=remotePhase(x);phase.assert();let ok=false;
    try { const a=selectedAdapter(x);if(!(a instanceof GitHubPrAdapter))throw new Error();const p=await a.mutationState(x.ctx.pr,phase.signal,phase.assert);phase.assert();ok=p.base.sha===x.ctx.baseCommit&&git(x.ctx.repo,["merge-base","--is-ancestor",p.base.sha,head(shellOk(x))]).ok; }catch{}phase.assert();
    return {verdict:ok?"pass":"fail",score:ok?1:0,findings:ok?[]:[F({type:"card",field:"rebase"},"remote base changed or ancestry unverified","current approved base is an ancestor","behind-base")],data:{head:x.ctx.head,remote:true}} as any;
  };
  gate("scope", (x) => {
    const ch = changedOf(x.ctx.worktree, x.ctx.baseCommit); const out = ch.filter((p) => !inScope(x.ctx.spec?.scope ?? [], p.path));
    if (out.length) return { ok: false, detail: `outside the scope: ${out.map((p) => p.path).join(", ")}`, cls: "scope", loc: { type: "file", path: out[0].path } };
    const d = doorOf(ch, sensitive(x));
    if (d.door === "one-way" && x.ctx.door?.door !== "one-way") return { ok: false, detail: `the diff touches a sensitive path (${d.reasons.filter((r) => r.list !== "trivial").map((r) => r.path).join(", ")}): it is one-way, but the run went the two-way path`, cls: "door-change", loc: { type: "file", path: d.reasons[0]?.path ?? "" } };
    return { ok: true, detail: `${ch.length} paths inside the scope; door ${d.door}` };
  });
  gate("failfirst", (x, h) => { const e = lastPass(x, "firstmate/fail-first", h); return { ok: !!e && e.head === h && e.verdict === "pass", detail: e ? `fail-first ${e.verdict} at ${String(e.head).slice(0, 8)}${e.data?.applicable === false ? " (not applicable: no behaviour file changed)" : ""}` : "fail-first never ran" }; });
  gate("ci", (x, h) => { const e = lastPass(x, "firstmate/ci", h); return { ok: !!e && e.head === h && e.verdict === "pass", detail: e ? `CI ${e.verdict} at ${String(e.head).slice(0, 8)}` : "CI never ran" }; });
  const localGateCI = engine.natives["gate-ci"];
  engine.natives["gate-ci"] = async (i, hp) => {
    const x = hp.x as X; if (x.ctx.pr?.adapter !== "github") return localGateCI(i, hp);
    const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x), h = head(shellOk(x)); let ok = false;
    try { if (!(a instanceof GitHubPrAdapter)) throw new Error(); await reconcile(a, x.ctx.pr, phase.signal); phase.assert(); const policy = await requiredPolicy(a, phase.signal); phase.assert(); const current = await inspectRemote(a, x.ctx.pr, policy, phase.signal); phase.assert(); ok = current.state === "pass" && x.ctx.pr.head === h && x.ctx.remoteCI?.state === "pass" && x.ctx.remoteCI?.head === h && x.ctx.remoteCI?.policyHash === policy.hash && x.ctx.remoteCI?.grant === grantIdentity(a); } catch {}
    phase.assert(); return { verdict: ok ? "pass" : "fail", score: ok ? 1 : 0, findings: ok ? [] : [F({ type: "card", field: "ci" }, "required remote CI or PR identity is unverified", "verified required checks on the exact PR head", "remote-ci")], data: { head: h, remote: true } } as any;
  };
  gate("approval", (x, h) => {
    if (x.ctx.pr?.adapter === "github") {
      const trusted = engine.trusted?.(x.run.id); const entries = trusted?.entries ?? [];
      const review: any = entries.filter(e => e.check === "firstmate/review-verdict").at(-1);
      const carry: any = entries.filter(e => e.record === "approval-carry").at(-1);
      const rejected = !review || review.verdict !== "pass" || review.findings?.some((f: any) => f.severity === "blocking") || x.ctx.reviewUnverified || (x.ctx.reviews ?? []).at(-1)?.verdict === "REJECT";
      const binding = review?.data?.binding;
      const direct = review?.head === h && binding?.version === 1 && binding.head === h && binding.base === x.ctx.baseCommit && /^[a-f0-9]{40}$/.test(binding.patch) && !binding.unverified;
      const carried = carry?.head === h && carry?.data?.review === review?.seq && carry?.data?.proof?.version === 1 && carry.data.proof.fromHead === review.head && carry.data.proof.fromBase === binding?.base && carry.data.proof.toBase === x.ctx.baseCommit && carry.data.proof.toHead === h && carry.data.proof.clean === true && binding?.version === 1 && !binding.unverified && /^[a-f0-9]{40}$/.test(binding.patch) && binding.patch === carry.data.proof.patch;
      const ok = trusted?.ok === true && !rejected && (direct || carried);
      return { ok, detail: ok ? `signed review #${review.seq} on ${h.slice(0,8)}` : "signed current-head pass or clean bound approval carry required" };
    }
    const e = lastPass(x, "firstmate/review-verdict", h); return { ok: !!e && e.head === h && e.verdict !== "fail" && e.verdict !== "error", detail: e ? `review ${e.verdict} at ${String(e.head).slice(0, 8)} (${(e.votes ?? []).map((v: any) => `${v.by}: ${v.verdict}`).join(", ")}), signed in the ledger #${e.seq}` : "no review" }; });
  engine.natives["retro-trigger"] = async (i, h) => {
    const x = h.x as X; const since = Date.now() - 14 * 86400_000;
    const merged = engine.list().filter((r) => r.workflow === x.run.workflow && r.ctx.merged && Date.parse(r.ctx.merged.at) > since).length;
    try { await o.improve?.checkTriggers?.(); } catch {}
    const rounds = x.run.nodes.build?.visits ?? 0;
    return { verdict: "pass", score: 1, findings: [], data: { merged14d: merged, rounds, refine: x.ctx.refine ?? null } } as any;
  };

  // ---------- before / after captures of the repository's app (.crew/app.json) ----------
  // The app is built on the base and on the head in the check sandbox (reads its tree, writes only its out/, no network);
  // each page is shot by Studio's renderer with scripts off and the network refused (the pages are code a round wrote).
  const appCfg = (dir: string): { build: string[]; pages: { label: string; file: string }[]; paths: string[] } | null => {
    try { const c = JSON.parse(readFileSync(join(dir, ".crew", "app.json"), "utf8"));
      const build = Array.isArray(c.build) && c.build.length && c.build.every((s: any) => typeof s === "string") ? c.build : null;
      const pages = (Array.isArray(c.pages) ? c.pages : []).filter((p: any) => p && typeof p.label === "string" && /^[\w.-]+\.html$/.test(String(p.file))).slice(0, 8);
      return build && pages.length ? { build, pages, paths: Array.isArray(c.paths) ? c.paths.map(String) : [] } : null; } catch { return null; }
  };
  const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .split("\n").map((l) => l.trim()).filter(Boolean);
  // the visible lines only in one side (a multiset difference): what changed on screen, in words
  const onlyIn = (xs: string[], ys: string[]) => { const m = new Map<string, number>(); for (const l of ys) m.set(l, (m.get(l) ?? 0) + 1);
    return xs.filter((l) => { const n = m.get(l) ?? 0; if (n > 0) { m.set(l, n - 1); return false; } return true; }); };
  const textDiff = (a: string[], b: string[]) => ({ removed: onlyIn(a, b).slice(0, 20), added: onlyIn(b, a).slice(0, 20) });
  const capturesOf = (run: string) => join(o.dataDir, "runs", run, "captures");
  async function captureApp(x: X): Promise<{ skipped: string | null; pages: any[]; head: string; app: string | null; rendered: boolean; refusedFiles?: string[]; refusedRequests?: string[]; frames?: string[] }> {
    const wt = shellOk(x); const h = head(wt); const cfg = appCfg(wt);
    if (!cfg) return { skipped: "the repository declares no app (.crew/app.json)", pages: [], head: h, app: null, rendered: false };
    const touched = changedOf(wt, x.ctx.baseCommit).filter((p) => cfg.paths.some((g) => matches(g, p.path) || (!!p.from && matches(g, p.from))));
    // a change to the policy's UI paths outside the app's own paths is captured too: the designer reviews its pictures
    if (!touched.length && !uiPathsOf(x, wt).length) return { skipped: "no app path changed", pages: [], head: h, app: null, rendered: false };
    const h8 = h.slice(0, 12); const dir = join(capturesOf(x.run.id), h8); rmSync(dir, { recursive: true, force: true });
    const baseTree = tmpTree(x.run.id, "capture-base"); git(x.ctx.repo, ["worktree", "remove", "--force", baseTree]); rmSync(baseTree, { recursive: true, force: true });
    addTree(x.ctx.repo, ["-q", "--detach", baseTree, x.ctx.baseCommit]);
    const html: Record<string, Record<string, string>> = { before: {}, after: {} }; let rendered = true; const refusedFiles: string[] = [], refusedRequests: string[] = [], frames: string[] = [];
    try {
      for (const [side, tree] of [["before", baseTree], ["after", wt]] as const) {
        // the build writes into raw/ inside the sandbox; Studio reads only a copy of its regular files (no symlink, no hard link followed)
        const box = join(dir, `${side}-box`), raw = join(box, "raw"), out = join(dir, side); mkdirSync(raw, { recursive: true });
        const argv = cfg.build.map((a) => a.replace("{out}", raw));
        const r = await sandboxed(argv, { cwd: tree, out: raw, tmp: join(box, "tmp"), timeoutS: 120, network: false, dataDir: o.dataDir });
        if (r.refused) throw new Error(`the app build was refused: ${r.refused}`);
        if (r.code !== 0) { writeFileSync(join(dir, `${side}-build.log`), (r.stdout + r.stderr).slice(-8000)); rmSync(box, { recursive: true, force: true }); continue; }
        // sandboxed() has killed the build's process group; the output also moves out of the sandbox's writable root first, so a
        // process that slipped out of the group can no longer write into it (the sandbox checks the path at each write)
        const frozen = join(dir, `${side}-frozen`); renameSync(raw, frozen);
        await o.seams?.afterBuildExit?.(raw, side);
        const copy = copyUntrusted(frozen, out); rmSync(box, { recursive: true, force: true }); rmSync(frozen, { recursive: true, force: true }); refusedFiles.push(...copy.refused.map((f) => `${side}: ${f}`));
        for (const p of cfg.pages) { const f = join(out, p.file); if (!copy.copied.includes(p.file)) continue; html[side][p.file] = readFileSync(f, "utf8");
          const job = runRender(o.dataDir, "page", { root: out, page: p.file, out: join(dir, `${side}-${p.file}.png`), width: "1280" }); const res = await job.done;
          if (!res.ok) rendered = false; else { refusedRequests.push(...(res.info?.refused ?? []).map((u: string) => `${side} ${p.file}: ${u}`)); frames.push(...(res.info?.frames ?? []).map((u: string) => `${side} ${p.file}: ${u}`)); renameSync(join(dir, `${side}-${p.file}.png`), join(out, `${p.file}.png`)); } }
      }
    } finally { git(x.ctx.repo, ["worktree", "remove", "--force", baseTree]); rmSync(baseTree, { recursive: true, force: true }); }
    const url = (side: string, file: string) => `/api/wruns/${x.run.id}/captures/${h8}/${side}/${file}`;
    const pages = cfg.pages.map((p) => { const a = html.before[p.file], b = html.after[p.file];
      return { label: p.label, file: p.file, before: a != null && existsSync(join(dir, "before", `${p.file}.png`)) ? url("before", `${p.file}.png`) : null, after: b != null && existsSync(join(dir, "after", `${p.file}.png`)) ? url("after", `${p.file}.png`) : null,
        changed: a != null && b != null ? textDiff(visible(a), visible(b)) : null, built: { before: a != null, after: b != null } }; });
    return { skipped: null, pages, head: h, app: html.after[cfg.pages[0].file] != null ? url("after", cfg.pages[0].file) : null, rendered, refusedFiles, refusedRequests, frames };
  }
  /** firstmate/ui-captures: before / after captures of the app when the change touches it; skipped (pass) when it does not. */
  engine.natives["ui-captures"] = async (_i, hp) => {
    const x = hp.x as X; const c = await captureApp(x);
    x.ctx.captures = { head: c.head, base: x.ctx.baseCommit, pages: c.pages, app: c.app, skipped: c.skipped, rendered: c.rendered, at: new Date().toISOString() };
    if (c.skipped) return { verdict: "pass", score: 1, findings: [], data: { skipped: c.skipped } } as any;
    const broken = c.pages.filter((p) => !p.built.after);
    const findings = broken.map((p) => ({ locator: { type: "file", path: ".crew/app.json" }, message: `the app page ${p.file} did not build on the head`, expected: "the app builds", class: "app-build", severity: "minor" }));
    for (const f of (c.refusedFiles ?? []).slice(0, 5)) findings.push({ locator: { type: "file", path: ".crew/app.json" }, message: `the app build's output was refused: ${f}`, expected: "the build writes regular files only", class: "app-output-refused", severity: "minor" });
    if (!c.rendered) findings.push({ locator: { type: "file", path: ".crew/app.json" }, message: "the pages were built but not shot: the headless browser is not installed (Doctor → Headless browser); the card shows the text that changed", expected: "a before / after picture of each page", class: "renderer-missing", severity: "minor" });
    return { verdict: findings.length ? "warn" : "pass", score: findings.length ? 0.5 : 1, findings,
      data: { captures: c.pages.map((p) => ({ label: p.label, before: p.before, after: p.after, changed: p.changed })), app: c.app, rendered: c.rendered, head: c.head, refusedFiles: c.refusedFiles ?? [], refusedRequests: c.refusedRequests ?? [], frames: c.frames ?? [] } } as any;
  };
  /** the changed paths that are UI as the repository classifies them: the policy's ui_paths, plus the paths its app declares */
  const uiPathsOf = (x: X, wt: string): string[] => { const globs = [...((x.policy("ui_paths") ?? []) as string[]), ...(appCfg(wt)?.paths ?? [])];
    return changedOf(wt, x.ctx.baseCommit).filter((p) => globs.some((g) => matches(g, p.path) || (!!p.from && matches(g, p.from)))).map((p) => p.path); };
  installCodeDesign(engine, { dataDir: o.dataDir, shellOk, head, uiPathsOf, specMd, appDeclared: (wt) => !!appCfg(wt), capture: (x) => engine.natives["ui-captures"]({} as any, { x } as any),
    recordEnvGaps: (x, gaps) => recordEnvGaps(x, gaps, "round") });

  // ---------- actions ----------
  engine.actions["intent.capture"] = (x) => {
    const st = x.deps.store; let id: string | null = x.ctx.intent?.id ?? null;
    if (!id && st && x.run.text) { const i = st.capture({ goal: x.run.title, details: x.run.text, text: x.run.text, source: `run ${x.run.id}` }); id = i.id; }
    x.ctx.intent = { id, text: x.run.text, workflow: x.run.workflow, classifier: x.run.classifier };
    x.rn.note = id ? `intent ${id}` : "no intent text"; return "ok";
  };
  engine.actions["repo.prepare"] = (x) => {
    if (x.ctx.worktree && existsSync(x.ctx.worktree)) { x.rn.note = `worktree ${x.ctx.branch} kept`; return "ok"; }
    // the repository: a registered project (default: the sandbox), or an explicit local path
    let repo = x.run.params.repo || "";
    const pid = x.run.params.project || (repo ? "" : "sandbox");
    if (pid) { const p = o.projects.get(pid); if (!p?.path) throw new Error(`no project ${pid} with a repository path`); repo = p.path; x.ctx.project = p.id; }
    if (!existsSync(join(repo, ".git"))) throw new Error(`${repo} is not a local git repository`);
    const base = x.run.params.base || "main";
    if (!git(repo, ["rev-parse", "--verify", `${base}^{commit}`]).ok) throw new Error(`no branch ${base} in ${repo}`);
    const prefix = String(x.policy("branch_prefix") ?? "crew/");
    const key = { project: pid || "local", task: x.run.id };
    const rec = W.ensure({ ...key, repo, base, branchPrefix: prefix, run: x.run.id });
    x.ctx.wt = key; x.ctx.repo = repo; x.ctx.base = base; x.ctx.branch = rec.branch; x.ctx.worktree = rec.path; x.ctx.baseCommit = rec.baseCommit; x.ctx.head = rec.head;
    x.rn.note = `${rec.branch} at ${rec.baseCommit.slice(0, 8)} (data/work/${key.project}/${key.task})`; return "ok";
  };
  const namingCard = async (x: X, adapter: GitHubPrAdapter, h: string, pending?: any) => {
    const phase=remotePhase(x);
      const c = await engine.card(x,"scope",{ title: pending ? "Approve updated remote branch head" : "Approve remote branch name", zhTitle: pending ? "核准更新後的遠端分支版本" : "核准遠端分支名稱", captainOnly: true,
        en: { why: pending ? "The approved branch update produced a new head outside the naming grant." : "This branch is outside the approved prefix.", next: pending ? "Approve this exact new head before importing it and running fresh CI." : "Approve this exact name or stop publication." }, zh: { why: pending ? "已核准的分支更新產生新版本，尚未取得此版本的命名授權。" : "分支名稱超出核准前綴。", next: pending ? "核准此確切新版本，之後才接回工作目錄並重新執行 CI。" : "核准此名稱或停止發布。" },
        body: `${adapter.grant.repository}\n${x.ctx.branch}\n${pending ? pending.old.head + " → " : ""}${h}`, options: [{ id: "approve-name", label: pending ? "Approve new head" : "Approve name", labelZh: pending ? "核准新版本" : "核准名稱", primary: true }, { id: "close", label: "Stop publication", labelZh: "停止發布", hold: true }] });
      phase.assert(); x.ctx.remoteNaming = { version: 2, repository: adapter.grant.repository, grant: grantIdentity(adapter), branch: x.ctx.branch, head: h, card: c.id, node: x.node.id, ...(pending ? {version:3,sourceHead:pending.old.head,pendingHash:digest(pending)} : {}) }; engine.record(x,"naming-request",{head:h,data:{...x.ctx.remoteNaming}} as any); x.save(); return { wait: true };
  };
  // a repository pull request template: the pull request waits for the evidence and opens at remote-ready (code-publish.ts)
  const publication = installCodePublish(engine, { dataDir: o.dataDir, projects: o.projects, injected: !!o.adapter, selectedAdapter, remotePhase, remoteWait, namingCard, shellOk, head, specMd });
  engine.actions["pr.open"] = async (x) => {
    const phase = remotePhase(x); phase.assert(); const wt = shellOk(x); const h = head(wt);
    const adapter = selectedAdapter(x);
    if (adapter instanceof GitHubPrAdapter && !adapter.branchAllowed(x.ctx.branch,h)) return namingCard(x,adapter,h);
    if (adapter instanceof GitHubPrAdapter && !x.ctx.pr) { const deferred = await publication.defer(x, adapter, phase); if (deferred) return deferred; }
    // a pull request opened from the template keeps the text the captain approved: each round's rebased head only moves it (the same lease push)
    const approved = x.ctx.pr && x.ctx.prText?.version === 1 && x.ctx.prText.hash ? x.ctx.pr : null;
    const title = approved ? approved.title : x.ctx.spec?.title ?? x.run.title;
    const rollback = x.ctx.spec?.rollback ?? (x.ctx.door?.door === "one-way" ? "A revert does not undo this change; the approved plan must name the rollback." : "Revert the change to undo it.");
    const body = approved ? approved.body : withoutSessionLinks(specMd(x.ctx.spec) + `\n\n## Door\n${x.ctx.door?.door ?? "undecided"}\n\n## Rollback\n${rollback}`);
    if (x.ctx.pr && x.ctx.pr.adapter !== adapter.id) throw new Error("review adapter authority changed; resolve the existing review request before publishing");
    if (x.ctx.pr) {
      const old = x.ctx.pr; let published: any;
      try { published = await adapter.update({ ...old, title, body }, h, x.dir, phase.signal,phase.assert); }
      catch (e: any) {
        // the push is --force-with-lease=<Task branch>:<last pushed head>: someone else's push is never overwritten
        if (adapter instanceof GitHubPrAdapter && /lease mismatch|mismatched pull request target or head/.test(String(e?.message ?? e))) {
          if (!phase.live()) return { outcome: "cancel" } as any;
          await engine.card(x, "step-back", remoteStopBody(`the Task branch ${old.branch} on GitHub moved away from the last pushed head ${String(old.head).slice(0, 8)} (someone else pushed); Studio did not overwrite it`)); return { wait: true } as any;
        }
        throw e;
      }
      phase.assert(); x.ctx.pr = published;
      if (published.head !== old.head && adapter instanceof GitHubPrAdapter) engine.record(x, "remote-push", { head: published.head, data: { version: 1, repository: adapter.grant.repository, branch: old.branch, from: old.head, to: published.head, lease: old.head, rewritten: !git(x.ctx.repo, ["merge-base", "--is-ancestor", old.head, published.head]).ok } } as any);
      x.rn.note = `review request at ${h.slice(0, 8)}`; return remoteWait(x, adapter); }
    const published = await adapter.open({ repo: x.ctx.repo, base: x.ctx.base, branch: x.ctx.branch, head: h, title, body }, x.dir, phase.signal,phase.assert); phase.assert(); x.ctx.pr = published;
    x.rn.note = `review request on ${x.ctx.branch} (${adapter.id})`; return remoteWait(x, adapter);
  };
  engine.actionAnswers ??= {};
  engine.actionAnswers["pr.open"] = async (x,card) => {
    if (card.answer?.choice === "retry") { const result = await engine.actions["pr.open"](x); return typeof result === "string" ? { outcome: result } : result; }
    if (card.answer?.choice !== "approve-name") return { outcome: card.answer?.choice ?? "close" };
    const n = x.ctx.remoteNaming;
    if (n?.version !== 2 || n.card !== card.id || n.head !== head(shellOk(x)) || n.branch !== x.ctx.branch || !card.captainOnly) throw new Error("naming approval no longer matches publication");
    const result = await engine.actions["pr.open"](x); return typeof result === "string" ? { outcome: result } : result;
  };
  engine.actionAnswers["remote.ready"] = async (x,card) => {
    if (!x.ctx.pr && x.ctx.prDeferred) return publication.answer(x, card);
    if (card.answer?.choice === "update-text" || card.answer?.choice === "keep-text") return publication.refreshAnswer(x, card);
    if(card.answer?.choice === "approve-name") {
      if(!x.ctx.remoteUpdatePending)return engine.actionAnswers["pr.open"](x,card);
      const phase=remotePhase(x);
      try {
      const a=selectedAdapter(x);if(!(a instanceof GitHubPrAdapter)||x.ctx.remoteNaming?.card!==card.id||!card.captainOnly)throw new Error("pending update naming decision changed");
      const p=pendingUpdate(x,a);if(!a.branchAllowed(p.next.pr.branch,p.next.pr.head))throw new Error("new update head requires its bound naming decision");
      const result=await engine.actions["remote.ready"](x);return typeof result==="string"?{outcome:result}:result;
      } catch { if(!phase.live())return {outcome:"cancel"};await engine.card(x,"step-back",remoteStopBody("pending update naming target, grant or deadline changed; retained for captain recovery"));return {wait:true}; }

    }
    if(card.answer?.choice!=="rebase")return {outcome:card.answer?.choice??"close"};
    const n=x.ctx.remoteRebaseRequired, a=selectedAdapter(x), trusted=engine.trusted(x.run.id);
    if(!(a instanceof GitHubPrAdapter)||n?.version!==1||n.card!==card.id||n.repository!==a.grant.repository||n.grant!==a.grant.approvalId||n.head!==head(shellOk(x))||!card.captainOnly||!trusted.ok||!trusted.entries.some(e=>e.record==="rebase-request"&&e.data?.card===n.card&&e.data?.base===n.base&&e.data?.fromBase===n.fromBase&&e.data?.repository===n.repository&&e.head===n.head)||!trusted.entries.some(e=>e.record==="card-answer"&&e.data?.card===card.id&&e.data?.choice==="rebase"))throw new Error("native rebase captain intent changed");
    const phase=remotePhase(x);await a.mutationState(x.ctx.pr,phase.signal,phase.assert);phase.assert();const imported=await a.importHeads(x.ctx.pr,phase.signal);phase.assert();if(imported.base!==n.base)throw new Error("rebase target moved; fresh captain decision required");
    x.ctx.remoteRebaseApproved={...n};x.ctx.remoteCI=null;x.ctx.gatedHead=null;x.ctx.reviewUnverified="native rebase requires fresh review";x.save();return {outcome:"rebase"};
  };
  engine.actions["remote.ready"] = async (x) => {
    if (!x.ctx.pr && x.ctx.prDeferred) return publication.publish(x); // the template's pull request opens now, with the evidence
    if (x.ctx.pr?.adapter !== "github") return "ok";
    const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x);
    if (!(a instanceof GitHubPrAdapter)) throw new Error("remote adapter changed");
    // a later round moved the pull request's head: its template text, refreshed, is offered to the captain first
    if (!x.ctx.remoteUpdatePending) { const offer = await publication.refresh(x); if (offer) return offer; }
    let release: (() => void) | undefined;
    try {
      const pending=x.ctx.remoteUpdatePending?pendingUpdate(x,a):null;
      const p = pending?null:await a.mutationState(x.ctx.pr, phase.signal,phase.assert); phase.assert();
      if (p && (p.mergeable === false || p.mergeable_state === "dirty")) {
        const c = await engine.card(x,"step-back",{title:"Remote conflict: native rebase round",zhTitle:"遠端衝突：原生 rebase 輪次",captainOnly:true,
          en:{why:"The remote branch cannot merge cleanly.",next:"Authorize a task-only rebase resolution round; fresh CI and review will follow."},zh:{why:"遠端分支無法乾淨合併。",next:"核准只修改此任務的 rebase 解決輪次；之後重新執行 CI 與審查。"},
          body:`${a.grant.repository}\n${x.ctx.pr.branch}\n${x.ctx.pr.head} → ${p.base.sha}`,options:[{id:"rebase",label:"Rebase in worker round",labelZh:"在工作輪次 rebase",primary:true},{id:"close",label:"Close without merging",labelZh:"不合併，關閉",hold:true}]});phase.assert();
        x.ctx.remoteRebaseRequired={version:1,repository:a.grant.repository,grant:a.grant.approvalId,head:x.ctx.pr.head,base:p.base.sha,fromBase:x.ctx.baseCommit,card:c.id};engine.record(x,"rebase-request",{head:x.ctx.pr.head,data:{...x.ctx.remoteRebaseRequired}} as any);x.save();return {wait:true};
      }
      if(p && p.mergeable !== true)throw new Error("remote mergeability remains unverified");
      if (p && p.mergeable_state !== "behind") return "ok";
      const trusted = engine.trusted(x.run.id), review: any = trusted.entries.filter(e => e.check === "firstmate/review-verdict").at(-1), b = review?.data?.binding;
      if (!trusted.ok || review?.verdict !== "pass" || b?.unverified || b?.head !== x.ctx.pr.head || x.ctx.reviewUnverified || (x.ctx.reviews ?? []).at(-1)?.verdict === "REJECT") throw new Error("bound review unavailable");
      const old = x.ctx.pr, key = wkey(x); const round = await W.startRound(key.project,key.task,`${x.run.id}/remote-ready#${x.visit}`,{write:true,install:x.policy("install") === false ? false : null,remote:()=>a.remoteGit()}); release=round.release;phase.assert();if(round.head!==old.head)throw new Error("task head moved before update");
      const request=pending?pending.request:engine.record(x,"remote-update-request",{head:old.head,data:{version:1,grant:grantIdentity(a),repository:a.grant.repository,pr:structuredClone(old),base:x.ctx.baseCommit}} as any)?.seq;
      const next = pending?pending.next:await updateOnce(a, old, x.dir, phase.signal, phase.assert); phase.assert();
      await a.verifyUpdateResult(old,next,phase.signal,phase.assert);phase.assert();
      if(!a.branchAllowed(next.pr.branch,next.pr.head)){
        const descriptor=pending??{version:1,request,repository:a.grant.repository,grant:grantIdentity(a),old:structuredClone(old),next:structuredClone(next),fromBase:x.ctx.baseCommit,naming:structuredClone(x.ctx.remoteNaming),startedAt:Date.now(),deadline:Date.now()+Math.max(1000,Math.min(24*3600_000,Number(x.policy("remote_ci.timeout_s",1800))*1000||1800_000))};
        if(!pending){x.ctx.remoteUpdatePending=descriptor;phase.retainPending();x.ctx.remoteCI=null;x.ctx.gatedHead=null;engine.record(x,"remote-update-result",{head:old.head,data:{hash:digest(descriptor),pending:descriptor}} as any);x.save();}
        return namingCard(x,a,next.pr.head,descriptor);
      }
      await a.importHeads(next.pr, phase.signal); phase.assert(); if(!git(x.ctx.repo,["merge-base","--is-ancestor",old.head,next.pr.head]).ok)throw new Error("accepted update head was replaced");
      const proof = proveCleanCarry(x.ctx.repo, b.base, old.head, next.baseHead, next.pr.head); phase.assert();
      const rec = W.get(wkey(x).project, wkey(x).task), wt = shellOk(x);
      if (!rec || rec.path !== wt || rec.branch !== old.branch || wt === x.ctx.repo || head(wt) !== old.head || git(wt, ["status", "--porcelain"]).out || git(wt, ["symbolic-ref", "--short", "HEAD"]).out !== old.branch) throw new Error("owned clean task worktree required");
      W.acceptHead(key.project,key.task,old.head,next.pr.head,next.baseHead);
      x.ctx.pr = next.pr; x.ctx.head = next.pr.head; x.ctx.baseCommit = next.baseHead; x.ctx.remoteCI = null; x.ctx.remoteUpdatePending=null; phase.rebind();
      writeFileSync(join(x.dir,"pr.json"), JSON.stringify(next.pr), { mode: 0o600 });
      engine.record(x,"approval-carry",{ head: next.pr.head, data: { review: review.seq, proof } } as any); x.save();
      const checks = await engine.runChecks(x, [{ use: "firstmate/ci" }, { use: "firstmate/fail-first" }], null); phase.assert();
      if (checks.blocked.length) return "fail";
      if(!a.branchAllowed(x.ctx.branch,x.ctx.head)) return namingCard(x,a,x.ctx.head);
      return remoteWait(x,a);
    } catch { if (!phase.live()) return { outcome: "cancel" }; await engine.card(x,"step-back",remoteStopBody("remote readiness/update could not be proved; no approval or merge allowed")); return { wait: true }; } finally { release?.(); }
  };
  /** the Task's one curated commit message (src/domain/commit-message.ts): the spec's what and why, each done line with the
   * checks that proved it on the reviewed head, under the repository's CONTRIBUTING commit rules read at that head */
  const taskCommit = (x: X, h: string) => {
    const ledger = new Map(engine.ledger(x.run.id).map((e) => [e.seq, e]));
    const done = engine.doneLines(x.run).map((d: any) => ({ text: d.text, proofs: (d.by ?? []).map((b: any) => ({ check: b.check, verdict: (ledger.get(b.seq) as any)?.verdict ?? "?" })) }));
    const author = commitIdentity(x.ctx.repo);
    return { ...taskCommitMessage({ run: x.run.id, head: h, type: x.ctx.spec?.type ?? null, title: x.ctx.spec?.title ?? x.run.title ?? "", what: x.ctx.spec?.what ?? null, why: x.ctx.spec?.why ?? [], done, author }, commitConvention(x.ctx.repo, h)), author };
  };
  /** the subject of the Task's one commit, for the merge card (null when it cannot be read yet) */
  const landing = (x: X): string | null => { try { const h = String(x.ctx.gatedHead ?? x.ctx.head ?? ""); return /^[0-9a-f]{40}$/.test(h) && x.ctx.repo ? taskCommit(x, h).subject : null; } catch { return null; } };
  engine.actions["git.merge"] = async (x) => {
    if (x.ctx.pr?.adapter === "github") {
      const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x), h = head(shellOk(x));
      const answer: any = engine.trusted(x.run.id).entries.filter(e => e.record === "card-answer" && e.data?.kind === "merge" && e.data?.choice === "merge").at(-1);
      if (!(a instanceof GitHubPrAdapter) || !engine.trusted(x.run.id).ok || !answer?.data?.card || answer.head !== h || h !== x.ctx.gatedHead || h !== x.ctx.pr.head || (x.ctx.door?.door === "one-way" && answer.data.confirm !== "one-way")) throw new Error("bound captain merge intent required");
      const trusted = engine.trusted(x.run.id);
      const intent:any=trusted.entries.filter(e=>e.record==="remote-merge-request"&&e.data?.card===answer.data.card).at(-1);
      if(!intent||intent.head!==h||intent.data.head!==h||intent.data.version!==1||intent.data.grant!==grantIdentity(a)||intent.data.repository!==a.grant.repository||intent.data.pr!==x.ctx.pr.id||intent.data.branch!==x.ctx.pr.branch||intent.data.base!==x.ctx.pr.base||intent.data.baseHead!==x.ctx.baseCommit||intent.data.method!==a.operationGrant().mergeMethod||intent.data.policyHash!==x.ctx.remoteCI?.policyHash)throw new Error("remote captain card target/grant/method changed; fresh intent required");

      if (!["branch","rebase","scope","failfirst","ci","approval","design"].every(name => { const e = trusted.entries.filter(e => e.check === `firstmate/gate-${name}`).at(-1); return e?.head === h && e.verdict === "pass"; })) throw new Error("seven signed exact-head gates required (the six and gate-design)");
      const policy = await requiredPolicy(a,phase.signal); phase.assert();
      if ((await inspectRemote(a,x.ctx.pr,policy,phase.signal)).state !== "pass" || x.ctx.remoteCI?.head !== h || x.ctx.remoteCI?.policyHash !== policy.hash || x.ctx.remoteCI?.grant !== grantIdentity(a)) throw new Error("remote checks changed before merge"); phase.assert();
      const curated = taskCommit(x, h); const result = await mergeOnce(a,x.ctx.pr,x.dir,answer.data.card,phase.signal,x.ctx.baseCommit,phase.assert,{ title: curated.subject, message: curated.body }); phase.assert();
      await a.importHeads(x.ctx.pr,phase.signal); phase.assert(); x.ctx.merged = { ...result, adapter: "github", at: new Date().toISOString() }; x.save(); return "ok";
    }
    if (x.ctx.project && o.projects.get(x.ctx.project)?.github) throw new Error("remote project has no verified PR; local merge disabled");
    const wt = shellOk(x); const h = head(wt); const repo = x.ctx.repo, base = x.ctx.base;
    if (x.ctx.door?.door === "one-way" && x.ctx.answers?.["merge-card"]?.confirm !== "one-way") throw new Error("a one-way change needs the door confirmation on the merge card");
    if (x.ctx.gatedHead && h !== x.ctx.gatedHead) throw new Error("the branch moved since the seven gates ran");
    // resume: this hook ran before a restart and its one commit is already the base tip (the reviewed head's tree, this Task)
    { const tip = git(repo, ["rev-parse", `refs/heads/${base}`]).out, tree = git(repo, ["rev-parse", `${h}^{tree}`]).out;
      if (tip && tree && git(repo, ["rev-parse", `${tip}^{tree}`]).out === tree && git(repo, ["log", "-1", "--format=%B", tip]).out.includes(`Crew Studio Task ${x.run.id}, reviewed head ${h.slice(0, 12)}.`)) {
        x.ctx.merged = { base, head: tip, reviewed: h, at: x.ctx.merged?.at ?? new Date().toISOString() }; x.ctx.head = h;
        engine.recordOnce(x, "native-merge", { head: tip, data: { version: 1, project: engine.queueProject(x.run), repo: engine.queueRepo(repo), base, head: tip, reviewed: h, tree } });
        x.rn.note = `${base} already carries this Task's commit ${tip.slice(0, 8)} (resumed)`; return "ok"; } }
    if (!git(repo, ["merge-base", "--is-ancestor", base, h]).ok) {
      // The merge stays strict: the head must contain the current base. When the
      // workflow routes it, a moved base sends the Task to a new build round that
      // rebases onto it (the worker resolves any conflict), then through the
      // checks, the gates and the merge card again.
      if (!x.run.def.edges.some(e => e.from === x.node.id && e.when?.split("|").includes("rebase"))) throw new Error(`${base} moved since the gates ran: it no longer fast-forwards`);
      x.ctx.gatedHead = null; x.rn.note = `${base} moved since the gates ran: a new build round rebases onto it`; x.save(); return "rebase";
    }
    // one curated commit lands, never the round commits: the reviewed head's exact tree on the current base tip (the rounds
    // stay on the Task branch and in the ledger)
    const tip = must(repo, ["rev-parse", `refs/heads/${base}`]), tree = must(repo, ["rev-parse", `${h}^{tree}`]);
    const curated = taskCommit(x, h); const squash = commitTree(repo, tree, tip, curated.message, curated.author);
    const cur = git(repo, ["symbolic-ref", "--short", "HEAD"]).out;
    if (cur === base) { if (git(repo, ["status", "--porcelain", "--untracked-files=no"]).out) throw new Error(`${repo} has uncommitted changes on ${base}`); must(repo, ["merge", "--ff-only", "-q", squash]); }
    else must(repo, ["update-ref", `refs/heads/${base}`, squash, tip]);
    x.ctx.merged = { base, head: squash, reviewed: h, at: new Date().toISOString() }; x.ctx.head = h;
    if (must(repo, ["rev-parse", `refs/heads/${base}`]) !== squash || must(repo, ["rev-parse", `${squash}^{tree}`]) !== tree) throw new Error("actual local merge does not carry the reviewed head's tree");
    engine.recordOnce(x, "native-merge", { head: squash, data: { version: 1, project: engine.queueProject(x.run), repo: engine.queueRepo(repo), base, head: squash, reviewed: h, tree } });
    x.rn.note = `${base} fast-forwarded to ${squash.slice(0, 8)}: one commit with the reviewed head ${h.slice(0, 8)}'s tree (local)`; return "ok";
  };
  const keepDays = (x: X) => Number(x.policy("worktree.keep_days", 7));
  engine.actions["repo.cleanup"] = (x) => {
    const k = wkey(x); W.remove(k.project, k.task, x.ctx.merged ? `merged ${String(x.ctx.merged.head).slice(0, 8)}` : "the run ended", keepDays(x), [tmpTree(x.run.id, "base"), tmpTree(x.run.id, "main")]);
    x.rn.note = "worktree removed (kept refs stay their days); the branch stays"; return "ok";
  };
  // a deleted run: its worktree, kept refs, branch and record go (src/worktrees.ts purge); main is never touched
  engine.onDelete = (r) => { if (!r.ctx.wt) return; const k = wkey(r as any); W.purge(k.project, k.task, "the run was deleted", [tmpTree(r.id, "base"), tmpTree(r.id, "main")]); };
  engine.onCancel = (r) => { if (!r.ctx.wt) return; const k = wkey(r as any); W.remove(k.project, k.task, "the run was cancelled", 7, [tmpTree(r.id, "base"), tmpTree(r.id, "main")]); };

  // ---------- rounds: one at a time, at the durable head, deps installed, the brief bound to round + head ----------
  const holder = (x: X) => `${x.run.id}/${x.node.id}#${x.visit}`;
  /** The round's brief: bound, carried across a base-only head change (the proof goes in the ledger once), or missing and why. */
  const roundBrief = (x: X, node = x.node.id) => {
    // only a node a refine loop feeds ever gets a brief (build, spec, plan); any other node's later visit needs none
    if (!(x.run.def.nodes ?? []).some((n) => n.kind === "loop" && n.args?.producer === node)) return { round: x.visit, head: x.ctx.head ?? null, brief: null, carried: null, missing: null } as BriefState;
    const had = x.ctx.briefCarry?.[node];
    const bs = briefState(x, node, briefCarryCheck);
    if (bs.carried && bs.carried !== had) { x.log(`round ${x.visit}: brief carried from ${bs.carried.from.slice(0, 8)} to ${bs.carried.to.slice(0, 8)} (base-only change, patch ${bs.carried.patch.slice(0, 12)})`);
      try { engine.record(x, "brief-carry", { head: bs.carried.to, data: { ...bs.carried, brief: bs.brief?.id ?? null } } as any); } catch {} }
    if (bs.missing) x.log(`round ${x.visit}: no brief: ${bs.missing}`);
    return bs;
  };
  const beginRound = (write: boolean, skipInstall = false) => async (x: X) => {
    if (!x.ctx.wt) return;
    if(x.node.mode==="spec")recoverLocalRescope(x);
    const k = wkey(x); const install = x.policy("install");
    let s: Awaited<ReturnType<typeof W.startRound>>;
    // a build round rebases onto the current base inside startRound, before dependencies install
    let baseRefresh: ReturnType<typeof refreshBase> = null;
    // a remote (GitHub) Task rebases onto the fetched origin base, never onto a stale local ref
    const remoteTip = write && x.node.mode === "build" ? await remoteBaseTip(x) : null;
    const beforeInstall = write && x.node.mode === "build" ? (start: string) => { baseRefresh = refreshBase(x, start, remoteTip); return baseRefresh ? { pending: baseRefresh.conflicts.length > 0 } : null; } : undefined;
    // a GitHub-connected project's branch head is read from the granted repository with the grant's token, never from origin
    // decided by the grant's presence, not by building the adapter: a grant that does not validate stops the round (RoundBlocked), never local-only
    const granted = o.adapter instanceof GitHubPrAdapter || !!(x.ctx.project && o.projects.get(x.ctx.project)?.github);
    const remote = granted ? () => { const a = selectedAdapter(x); if (!(a instanceof GitHubPrAdapter)) throw new Error("the project's GitHub grant gives no GitHub adapter"); return a.remoteGit(); } : null;
    try { s = await W.startRound(k.project, k.task, holder(x), { write, skipInstall, beforeInstall, remote, install: install === false ? false : Array.isArray(install) ? install.map(String) : null, scripts: x.policy("install_scripts") === true,
      allow: ([] as any[]).concat(x.policy("egress.allow", []) ?? []).map(String) }); }
    catch (e: any) { if (e instanceof RoundBlocked) { x.rn.data.report = { marker: "BLOCKED", summary: e.message, round: x.visit }; x.save(); } if (e instanceof EnvGapError) recordEnvGaps(x, [e.gap], "round"); throw e; }
    held.set(holder(x), s.release);
    try { x.ctx.head = (baseRefresh as any)?.headAfter ?? s.head;
    const rebase=x.ctx.remoteRebaseApproved;
    if(write && x.node.id==="build" && rebase?.version===1 && !rebase.started){
      const trusted=engine.trusted(x.run.id);if(!trusted.ok||!trusted.entries.some(e=>e.record==="rebase-request"&&e.data?.card===rebase.card&&e.data?.base===rebase.base&&e.data?.fromBase===rebase.fromBase&&e.head===rebase.head)||!trusted.entries.some(e=>e.record==="card-answer"&&e.data?.card===rebase.card&&e.data?.choice==="rebase"))throw new Error("native rebase has no bound signed captain decision");
      if(s.head!==rebase.head||x.ctx.pr?.head!==rebase.head)throw new Error("approved rebase head changed");
      const result=W.startNativeRebase(k.project,k.task,rebase.head,rebase.fromBase,rebase.base);rebase.started=true;x.ctx.head=result.head;x.ctx.baseCommit=rebase.base;x.save();
    }
    const bs = roundBrief(x);
    engine.record(x, "round-start", { head: s.head, data: { round: x.visit, brief: bs.brief?.id ?? null, ledger: bs.brief?.ledger ?? [], carried: bs.carried, briefMissing: bs.missing, corrected: s.corrected, deps: s.deps.ran?.join(" ") ?? null, depsDetail: s.deps.detail ?? null, baseRefresh, ...(s.remoteNotice ? { remoteNotice: s.remoteNotice } : {}) } } as any);
    if (baseRefresh && remoteTip) engine.record(x, "remote-rebase", { head: (baseRefresh as any).headAfter, data: { version: 1, branch: x.ctx.branch, fromBase: (baseRefresh as any).baseBefore, toBase: (baseRefresh as any).baseAfter, headBefore: (baseRefresh as any).headBefore, headAfter: (baseRefresh as any).headAfter, lease: x.ctx.pr?.head ?? null, pending: (baseRefresh as any).conflicts.length > 0 } } as any);
    if (s.corrected) x.log(`round ${x.visit}: ${s.corrected.reason}; ${s.corrected.kept ? `kept on ${s.corrected.kept}` : "nothing to keep"}`);
    if (s.remoteNotice) x.log(`round ${x.visit}: ${s.remoteNotice}`);
    } catch (e) { held.delete(holder(x)); s.release(); throw e; }
  };
  /**
   * Every local build round starts on the current base, so Tasks on one project
   * build concurrently like pull requests and no Task stays pinned to the base it
   * started on. The task branch is rebased onto the base branch head through the
   * native rebase (the same path a remote rebase round uses). A conflict neither
   * fails the Task nor asks the captain: the rebase stays in progress, the brief
   * opens with REBASE CONFLICTS, the worker resolves them in this round and Studio
   * continues the rebase after it. A remote PR keeps its own remote rebase path.
   */
  const refreshBase = (x: X, start: string, remoteTip: string | null = null) => {
    if (x.ctx.reportOnly?.build || isRemote(x) && !remoteTip) return null;
    // a captain-approved remote rebase (remote-ready card) starts its own native rebase this round
    if (x.ctx.remoteRebaseApproved?.version === 1 && !x.ctx.remoteRebaseApproved.started) return null;
    const k = wkey(x), rec = W.get(k.project, k.task);
    if (!rec || rec.nativeRebase || rec.head !== start) return null;
    const tip = remoteTip ?? git(x.ctx.repo, ["rev-parse", "--verify", `refs/heads/${x.ctx.base}`]).out.trim();
    if (!/^[0-9a-f]{40}$/.test(tip) || git(rec.path, ["merge-base", "--is-ancestor", tip, start]).ok) return null;
    const from = rec.baseCommit, result = W.startNativeRebase(k.project, k.task, start, from, tip);
    x.ctx.head = result.head; x.ctx.baseCommit = tip; x.ctx.gatedHead = null; if (remoteTip) x.ctx.remoteCI = null;
    const refresh = { round: x.visit, baseBefore: from, baseAfter: tip, headBefore: start, headAfter: result.head, conflicts: result.pending ? rebaseConflicts(x) : [] };
    x.ctx.baseRefresh = refresh; x.save();
    x.log(`round ${x.visit}: rebased onto ${x.ctx.base} ${from.slice(0, 8)} -> ${tip.slice(0, 8)}${refresh.conflicts.length ? `; ${refresh.conflicts.length} conflicting file(s) for the worker` : ""}`);
    return refresh;
  };
  const isRemote = (x: X) => { try { return selectedAdapter(x) instanceof GitHubPrAdapter; } catch { return false; } };
  /**
   * Remote (GitHub) Tasks rebase every round too (captain's standing rule). The base is
   * fetched from the granted repository into the local object store; once the Task has a PR,
   * the same fetch proves the remote Task branch is still at the last pushed head (the
   * lease). Someone else's push stops the round on a clear card: nothing is overwritten.
   * The rebased head is pushed by the publication step that follows the round, with
   * --force-with-lease on the Task's own branch only (GitHubPrAdapter.update).
   */
  const remoteBaseTip = async (x: X): Promise<string | null> => {
    if (x.ctx.reportOnly?.build || !isRemote(x)) return null;
    if (x.ctx.remoteRebaseApproved?.version === 1 && !x.ctx.remoteRebaseApproved.started) return null;
    const a = selectedAdapter(x) as GitHubPrAdapter;
    try {
      if (x.ctx.pr) return (await a.importHeads(x.ctx.pr)).base;
      return await a.importBase();
    } catch (e: any) {
      if (x.ctx.pr && /remote import head moved/.test(String(e?.message ?? e))) throw new RoundBlocked(`the Task branch ${x.ctx.pr.branch} on ${a.grant.repository} is no longer at the last pushed head ${String(x.ctx.pr.head).slice(0, 8)}: someone else pushed to it. Studio did not rebase or overwrite it. Decide whether to keep their change (rescope) or park the Task.`);
      throw new RoundBlocked(`cannot fetch ${a.grant.repository} ${a.grant.base} to rebase the Task onto it: ${String(e?.message ?? e).slice(0, 300)}`);
    }
  };
  /** Conflicting files of an in-progress native rebase, with the commits on each side that touched them. */
  const rebaseConflicts = (x: X) => {
    const rec = W.get(wkey(x).project, wkey(x).task); if (!rec?.nativeRebase) return [];
    const { from, base, target } = rec.nativeRebase, log = (range: string, p: string) => git(rec.path, ["log", "--format=%h %s", "--max-count=10", range, "--", p]).out.split("\n").filter(Boolean);
    return rebaseConflictList(rec.path).slice(0, 40)
      .map(c => ({ path: c.path, binary: c.binary, ours: c.ours, theirs: c.theirs, base: log(`${base}..${target}`, c.path), task: log(`${base}..${from}`, c.path) }));
  };
  /** Why a pending rebase goes to the captain now, or null to give the worker another round:
   * a binary conflict (no fs tool can pick a side), or round_cap consecutive rounds that left
   * the same unmerged files at the same head. */
  const rebaseStall = (x: X, result: { head: string; binary: { path: string; ours: string | null; theirs: string | null }[]; unresolved: string[] }) => {
    if (result.binary.length) return `binary rebase conflict: ${result.binary.map(c => `${c.path} (base side ${String(c.ours ?? "deleted").slice(0, 12)}, task side ${String(c.theirs ?? "deleted").slice(0, 12)})`).join(", ")}. A worker cannot pick a side with the fs tools and Studio never resolves it automatically (that would drop one side). Choose the content, then rescope or park.`;
    const key = JSON.stringify([result.head, [...result.unresolved].sort()]), prev = x.ctx.rebaseStall;
    const count = prev?.key === key ? prev.count + 1 : 1; x.ctx.rebaseStall = { key, count };
    const cap = Math.max(1, Number(x.policy("round_cap", 3)) || 3);
    return count >= cap ? `the rebase made no progress in ${count} rounds: ${result.unresolved.join(", ") || "(no file listed)"} still conflicting at ${result.head.slice(0, 8)}` : null;
  };
  const endRound = (x: X, how: string) => {
    if (!x.ctx.wt) return; const k = wkey(x);
    try { if (how !== "done" && how !== "timeout") { const kept = W.endRound(k.project, k.task, `${x.node.id} round ${x.visit} ${how}`); if (kept) x.log(`round ${x.visit} ${how}: its work kept on ${kept}`); } }
    finally { held.get(holder(x))?.(); held.delete(holder(x)); }
  };
  const roundHooks = (write: boolean, skipInstall = false) => ({ begin: beginRound(write, skipInstall), end: endRound });

  // ---------- agent modes ----------
  // Submission belongs to this agent invocation, not the cumulative visit/version counters.
  const submittedSpecs = new WeakSet<X>();
  const specTool = (x: X): AgentTool => ({ name: "spec_write", description: "Write the spec, once: title, what, why, the done lines (each names a planned acceptance test, observable scenario/assertion and expected semantic failure on base; do not claim execution), the scope (only paths the change may modify), optional verificationScope (exact existing repo-relative caller files to read and verify, never write authority), the door (one-way when it touches a sensitive path), a plain explain block in en and zh-TW, and zh: the title and the why written in Traditional Chinese (a real translation, not a placeholder; code names and paths stay as they are).",
    schema: { type: "object", properties: { title: { type: "string" }, what: { type: "string" }, why: { type: "array", items: { type: "string" } }, done: { type: "array", items: { type: "string" } }, scope: { type: "array", items: { type: "string" } }, verificationScope: { type: "array", maxItems: 200, items: { type: "string" } },
      door: { type: "object", properties: { kind: { type: "string", enum: ["one-way", "two-way"] }, reason: { type: "string" } }, required: ["kind", "reason"] }, explain: { type: "object", properties: { en: { type: "string" }, "zh-TW": { type: "string" } } },
      zh: { type: "object", properties: { title: { type: "string" }, why: { type: "array", items: { type: "string" } } }, required: ["title", "why"] } }, required: ["title", "what", "why", "done", "scope", "door", "explain", "zh"] },
    run: (a) => {
      const arr = (v: any) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
      x.ctx.spec = { title: String(a.title ?? x.run.title).slice(0, 160), what: String(a.what ?? "").slice(0, 2000), why: arr(a.why).slice(0, 8), done: arr(a.done).slice(0, 12), scope: arr(a.scope).slice(0, 40),
        ...(a.verificationScope !== undefined ? { verificationScope: a.verificationScope } : {}),
        door: a.door && typeof a.door === "object" ? { kind: String(a.door.kind ?? ""), reason: String(a.door.reason ?? "").slice(0, 400) } : null,
        explain: a.explain && typeof a.explain === "object" ? { en: String(a.explain.en ?? "").slice(0, 2000), "zh-TW": String(a.explain["zh-TW"] ?? "").slice(0, 2000) } : null,
        zh: a.zh && typeof a.zh === "object" ? { title: String(a.zh.title ?? "").slice(0, 160), why: arr(a.zh.why).slice(0, 8) } : null, version: (x.ctx.spec?.version ?? 0) + 1 };
      writeFileSync(join(x.dir, "spec.json"), JSON.stringify(x.ctx.spec, null, 1)); writeFileSync(join(x.dir, "spec.md"), specMd(x.ctx.spec)); x.save(); submittedSpecs.add(x); return { ok: true };
    } });
  engine.modes.spec = {
    ...roundHooks(false, true), // source-only analysis needs no package installation
    sandbox: (x) => { const wt = x.ctx.worktree; return wt && existsSync(wt) ? { writes: [], reads: [wt], cwd: wt } : null; }, // reads the worktree, writes nothing of it
    tools: (x) => { submittedSpecs.delete(x); return [...READ_ONLY(shellOk(x)), specTool(x)]; }, maxTools: 60,
    system: (x, skill) => `${skill}\n\nYou write the spec for one change to a local repository. Read the code with the fs_* tools (read-only), then call spec_write once. Budget: use at most 40 read/search calls; reserve the remaining calls for spec_write and schema corrections. Stop exploring once the relevant callers and tests are known. Never finish without spec_write; record unverified details as explicit scope questions rather than spending the entire budget on exploration. Say WHAT and WHY; never HOW (no line numbers, no steps). Every done line names a concrete test file and scenario, with the literal marker "planned fail-first" followed by its expected semantic failure on base; planned tests are not executed evidence. Keep manual reviewer and captain release obligations in explain, not as testless done lines. Describe the final specification, not the revision conversation; never quote rejected wording merely to describe its removal. Keep write scope limited to intended edits. List exact existing read-only callers in verificationScope; these never grant write permission or become additional changed roots. Explain the verification obligation for those callers. Write in plain English: no will/should/could, no "ensure", "utilize", "via", "etc.". Answer in one line when done.`,
    prompt: (x) => { const b = roundBrief(x, "spec");
      // the latest rescope on any escalation card (the captain's, or Firstmate's own decision with its reason)
      const rescope = ["dispatch", "step-back", "stalled", "budget", "scope-card", "design-gap-card"].map((k) => x.ctx.answers?.[k]).filter((a: any) => a?.choice === "rescope" && a.note).sort((a: any, z: any) => String(a.at).localeCompare(String(z.at))).at(-1) as any;
      const note = rescope?.by === "firstmate" ? null : rescope?.note ?? x.ctx.answers?.["scope-card"]?.note; const fmNote = rescope?.by === "firstmate" ? rescope.note : null;
      return `SPEC DRAFT\nRun ${x.run.id} · draft ${x.visit}. Repository ${x.ctx.project ?? x.run.params?.project ?? x.ctx.repo?.split("/").at(-1) ?? "(unknown)"} (base ${x.ctx.base}).\nCaptain's intent:\n${x.run.text || x.run.title}\n${note ? `\nThe captain asked for changes: ${note}\n` : ""}${fmNote ? `\nFirstmate rescoped the spec (the captain did not decide this): ${fmNote}\n` : ""}${engine.amendments(x.run).length ? `${amendmentsSection(engine.amendments(x.run))}Write the spec so its done lines include these changes; drop or rewrite any done line they supersede.\n` : ""}${x.visit > 1 ? `${briefSection(b)}${x.ctx.spec ? `Previous draft for revision only; not approval or current-head verification evidence. Revalidate it against the current source and captain changes:\n${specMd(x.ctx.spec)}\n` : ""}` : ""}\nStart with fs_list.`; },
    skeleton: (x) => codeFacts(x, "coordinator", { deliverable: ["spec_write once (title, what, why, done lines, scope, verification scope, door, explain), then one line."] }),
    after: (x) => { if (!x.ctx.spec || !submittedSpecs.has(x)) throw new Error("the spec writer did not call spec_write"); x.rn.note = `${x.ctx.spec.title}: ${x.ctx.spec.done.length} done lines, scope ${x.ctx.spec.scope.join(", ")}`; return "ok"; },
  };
  engine.modes.plan = {
    ...roundHooks(false),
    sandbox: (x) => { const wt = x.ctx.worktree; return wt && existsSync(wt) ? { writes: [], reads: [wt], cwd: wt } : null; }, // reads the worktree, writes nothing of it
    tools: (x) => [...READ_ONLY(shellOk(x)), { name: "plan_write", description: "Your plan, once: every question at once (questions block), the files you will change, and one row per done line (n from 1, the test, where it runs, how it fails on base).",
      schema: { type: "object", properties: { questions: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "object", properties: { n: { type: "number" }, test: { type: "string" }, where: { type: "string" }, fails_on_base: { type: "string" } }, required: ["n", "test", "where", "fails_on_base"] } } }, required: ["questions", "files", "rows"] },
      run: (a) => { x.ctx.plan = { questions: (a.questions ?? []).map(String).slice(0, 12), files: (a.files ?? []).map(String).slice(0, 30), rows: (Array.isArray(a.rows) ? a.rows : []).slice(0, 20), round: x.visit, head: x.ctx.head };
        writeFileSync(join(x.dir, `plan-${x.visit}.json`), JSON.stringify(x.ctx.plan, null, 1)); x.save(); return { ok: true }; } }], maxTools: 30,
    system: (x, skill) => `${skill}\n\nThis is a PLAN round for a one-way change: you change no file. Read the code, then call plan_write once with every question in the questions block, the files you will change, and a row per done line. Answer in one line.`,
    prompt: (x) => { const b = roundBrief(x, "plan"); return `PLAN ROUND\nRun ${x.run.id} · round ${x.visit} · head ${x.ctx.head}\n${amendmentsSection(engine.amendments(x.run))}${specMd(x.ctx.spec)}\n${x.ctx.planDecision?.accept === false ? `\nFirstmate sent the last plan back: ${x.ctx.planDecision.note}\n` : ""}${briefSection(b)}\nStart with fs_list.`; },
    // a plan round runs nothing: it gets the test facts, never the run_tests procedure (it has no such tool)
    skeleton: (x) => { const f = codeFacts(x, "worker", { deliverable: ["plan_write once (every question, the files you change, a row per done line); change no file."] });
      return { ...f, omitManual: ["TOOLS", "TESTS"], TESTS: ["Plan round: no test runs here. Each row names the test for its done line, where it runs and how it fails on base.", ...(f.TESTS ?? [])] }; },
    after: (x) => { if (!x.ctx.plan || x.ctx.plan.round !== x.visit) throw new Error("the worker did not write a plan"); if (git(shellOk(x), ["status", "--porcelain"]).out) throw new Error("a plan round must not change files"); x.rn.note = `${x.ctx.plan.rows.length} rows, ${x.ctx.plan.questions.length} questions`; return "ok"; },
  };
  engine.modes["plan-accept"] = {
    ...roundHooks(false),
    tools: (x) => [...READ_ONLY(shellOk(x)), { name: "plan_decision", description: "Accept the plan (answering every question), send it back with what to change, or escalate when an answer would change the spec's scope.",
      schema: { type: "object", properties: { decision: { type: "string", enum: ["accept", "revise", "escalate"] }, answers: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] } }, note: { type: "string" } }, required: ["decision", "answers"] },
      run: (a) => { const dec = ["accept", "revise", "escalate"].includes(a.decision) ? a.decision : a.accept === true ? "accept" : "revise";
        x.ctx.planDecision = { accept: dec === "accept", decision: dec, answers: (a.answers ?? []).slice(0, 12), note: String(a.note ?? "").slice(0, 1000), round: x.ctx.plan?.round, head: x.ctx.head, at: new Date().toISOString(), by: null };
        if (dec === "accept") writeFileSync(join(x.dir, "plan-accept.json"), JSON.stringify(x.ctx.planDecision, null, 1)); x.save(); return { ok: true }; } }], maxTools: 20,
    system: (x, skill) => `${skill}\n\nYou are the coordinator (firstmate). A worker sent a plan for a one-way change. Answer every question from the spec and the code, then accept it with plan_decision; send it back if a done line has no test that fails on base; escalate if an answer would change the spec's scope. Answer in one line.`,
    prompt: (x) => `PLAN DECISION\nRun ${x.run.id}\n${amendmentsSection(engine.amendments(x.run))}${specMd(x.ctx.spec)}\n\nThe plan (round ${x.ctx.plan?.round}, head ${x.ctx.head}):\n${JSON.stringify(x.ctx.plan, null, 1)}`,
    skeleton: (x) => codeFacts(x, "coordinator", { deliverable: ["plan_decision once: accept with every answer, revise with what to change, or escalate when an answer changes scope; then one line."] }),
    after: (x, job) => { const d = x.ctx.planDecision; if (!d || d.round !== x.ctx.plan?.round) throw new Error("the coordinator did not decide on the plan"); d.by = `${job.provider}·${job.model}`;
      if (d.accept) writeFileSync(join(x.dir, "plan-accept.json"), JSON.stringify({ ...d, signed: `plan-accept round ${d.round} head ${d.head} by ${d.by}` }, null, 1));
      x.rn.note = d.accept ? `accepted (round ${d.round}, head ${String(d.head).slice(0, 8)}), ${d.answers.length} answers` : `${d.decision}: ${d.note}`; return d.decision; },
  };
  const briefFile = (x: X) => join(x.dir, "briefs", `round-${x.visit}.json`);
  /** The previous REJECT's full list, as the reviewer wrote it (its numbering kept), and the convergence rule for this review. */
  const standingList = (last: any) => {
    if (last?.verdict !== "REJECT" || !Array.isArray(last.findings) || !last.findings.length) return "";
    const items = last.findings.map((f: any) => `${f.n}. [${f.tag}] ${f.path ? `${f.path}${f.line ? `:${f.line}` : ""} — ` : ""}${f.text}${f.fix ? `\n   Fix asked: ${f.fix}` : ""}`).join("\n");
    const must = last.findings.filter((f: any) => f.tag === "must-fix").map((f: any) => f.n);
    return `\nPREVIOUS REJECT (review ${last.round ?? "?"} at head ${String(last.head ?? "").slice(0, 8)}), its list as written:\n${items}\n\nCONVERGENCE RULE: verify only this list. For each must-fix item (${must.join(", ")}), say by its number whether it is fixed at this head. A new issue blocks (must-fix) only if this round's fix introduced it; anything else is a follow-up. Keep the numbering above. A REJECT gives, for every must-fix, its file:line and the exact diff that fixes it.\n`;
  };
  /** Hand the round back: a commit as the agent with run, node and round trailers; the checks then run on it. */
  const commitRound = (x: X, rep: any, agent = "agent") => {
    shellOk(x); const k = wkey(x);
    const hb = W.handBack(k.project, k.task, { run: x.run.id, node: x.node.id, round: x.visit, agent,
      message: `${commitSubject(x.ctx.spec?.type, x.ctx.spec?.title ?? x.run.title ?? "", { conventional: true, max: 72, source: null }, `Task ${x.run.id}`)}\n\nRound ${x.visit} of Crew Studio Task ${x.run.id}.\n\n${rep?.summary ?? ""}` });
    x.ctx.head = hb.head;
    x.ctx.rounds = [...(x.ctx.rounds ?? []), { round: x.visit, head: x.ctx.head, report: rep, ...(x.rn.data.failureAnswer ? { answer: { ...x.rn.data.failureAnswer } } : {}), at: new Date().toISOString() }];
  };
  engine.modes.build = {
    maxTools: 180, // multi-file implementation needs room beyond discovery, tests and the final report
    embedsSkeleton: true, // the durable round brief holds the six sections, so it equals what the worker receives
    ...roundHooks(true),
    sandbox: (x) => { const wt = x.ctx.worktree; return wt && existsSync(wt) ? { writes: [wt], cwd: wt } : null; }, // writes only its worktree
    tools: (x) => {
      const wt = shellOk(x); const cfg = cfgOf(x); let runs = 0, attempts = 0; const reportOnly = !!x.ctx.reportOnly?.build;
      const report: AgentTool = { name: "worker_report", description: "Your report, once at the end: marker WORKER_COMPLETE, SCOPE-BLOCKED, DOOR-CHANGE or ASK; a summary; on a fix round the SWEPT block (searched, found N, fixed M) and the classes you fixed; the test that fails on base (file:line).",
        schema: { type: "object", properties: { marker: { type: "string", enum: ["WORKER_COMPLETE", "SCOPE-BLOCKED", "DOOR-CHANGE", "ASK"] }, summary: { type: "string" }, swept: { type: "object", properties: { searched: { type: "string" }, found: { type: "number" }, fixed: { type: "number" } } }, classes: { type: "array", items: { type: "string" } }, failfirst: { type: "string" }, amendment: { type: "number", description: "with ASK: the number of the captain's binding change (A<n>) your question would undo or change" } }, required: ["marker", "summary"] },
        run: (a) => { if (!engine.owns(x)) return {error:"round owner ended"}; if (x.rn.data.report?.round === x.visit) return {error:"worker_report is submitted exactly once per round"}; const sw = a.swept && typeof a.swept === "object" ? { searched: String(a.swept.searched ?? ""), found: Number(a.swept.found) || 0, fixed: Number(a.swept.fixed) || 0 } : null;
          x.rn.data.report = { marker: String(a.marker), summary: String(a.summary ?? "").slice(0, 1500), swept: sw, classes: (a.classes ?? []).map(String).slice(0, 20), failfirst: a.failfirst ? String(a.failfirst).slice(0, 300) : null, ...(Number.isSafeInteger(a.amendment) && engine.amendments(x.run).some((m) => m.n === a.amendment) ? { amendment: a.amendment } : {}), round: x.visit }; x.save(); return { ok: true }; } };
      const context:AgentTool={name:'run_context',description:'Read host-verified current task, checkout, approved dispatch, project install policy and actual job execution mode. No credentials or mutable runtime files.',schema:{type:'object',properties:{}},run:()=>{
        if(!engine.owns(x))return{error:'round owner ended'};
        const trusted=engine.trusted(x.run.id);if(!trusted.ok)return{error:'task ledger is not trusted'};
        const approval=trusted.entries.filter(e=>e.record==='card-answer'&&e.data?.choice==='dispatch').at(-1);
        const jobs=[...engine.deps.agents.jobs.values()].filter(j=>j.ref===x.run.id&&j.status==='running');
        return{task:x.run.id,node:x.node.id,round:x.visit,checkout:{head:must(wt,['rev-parse','HEAD']),branch:must(wt,['symbolic-ref','--short','HEAD']),status:must(wt,['status','--porcelain=v1']),base:x.ctx.baseCommit},policy:{install:x.policy('install')??null},dispatch:approval?{seq:approval.seq,sig:approval.sig,card:approval.data.card,choice:approval.data.choice,note:approval.data.note??null}:null,jobs:jobs.map(j=>({id:j.id,kind:j.kind,provider:j.provider,model:j.model,executionMode:j.executionMode??'default'})),testCommand:cfg.test};
      }};
      if (reportOnly) return [...READ_ONLY(wt), context, report];
      return [...folderTools(wt, () => {}, "fs"), context, report,
        { name: "run_tests", description: `Run the repository's declared test command (at most ${WORKER_TEST_RUNS} executed runs per round; refused calls and runs that select no tests do not count, and every result says how many remain). Optional files selects scoped tests by repo-relative path (e.g. "test/format.test.ts"); the runner adapter receives basenames in CREW_TEST_FILES and the paths in CREW_TEST_PATHS. target=base runs the head's candidate test files against base source in an isolated copy, preserving the base package.json. evidenceDir selects an approved writable directory on head; CREW_TEST_OUTPUT_DIR names it. PLAYWRIGHT_MODULE names the host browser library when available. runner=npm-test runs the whole unchanged base package.json test script with pre/post hooks disabled (no files). A run that executes no tests returns status no-tests, never a pass. Returns actual exit, the tree it ran on (head commit, dirty, tree hash), output tail and signed execution evidence.`, schema: { type: "object", properties: {files:{type:'array',items:{type:'string'},maxItems:12},target:{type:'string',enum:['head','base']},evidenceDir:{type:'string'},runner:{type:'string',enum:['declared','npm-test']}} },
          // the repository's tests run in the check sandbox: they read the worktree, write only their own out/ and tmp, no network
          run: async (a) => { const res:any=await runTests(a);return{...res,runsRemaining:Math.max(0,WORKER_TEST_RUNS-runs)}; } }];
      async function runTests(a:any):Promise<any>{ if (!engine.owns(x))return{error:'round owner ended'};if(cfg.testError)return{error:cfg.testError};if (!cfg.test) return { status:'not-run',reason:cfg.testSkipped??'The repository has no test command; continue with review and record the testing gap.',exit:null };
            const target=a?.target??'head';if(!['head','base'].includes(target))return{error:'target must be "head" or "base"'};
            if(a?.runner!==undefined&&!['declared','npm-test'].includes(a.runner))return{error:'runner must be "declared" or "npm-test"'};
            const scope:string[]=x.ctx.spec?.scope??[],verification:string[]=x.ctx.spec?.verificationScope??[];
            const allowed=(p:any)=>typeof p==='string'&&normPath(p)===p&&!p.includes(',')&&(scope.some(g=>matches(g,p))||verification.includes(p))&&cfg.tests.some(g=>matches(g,p));
            const files=a?.files;
            if(files!==undefined){
              if(!Array.isArray(files)||!files.length||files.length>12)return{error:'files must be a nonempty list of at most 12 repo-relative test paths, e.g. run_tests({files:["test/example.test.ts"]}); omit files to run the whole declared command'};
              const bad=files.filter((p:any)=>!allowed(p));
              if(bad.length){ // a bare basename names the scoped test it ends, when exactly one does
                const known=must(wt,['ls-files','--cached','--others','--exclude-standard']).split('\n').filter(Boolean);
                const fixed=files.map((p:any)=>allowed(p)?[p]:typeof p==='string'?known.filter(k=>k.endsWith(`/${p}`)&&allowed(k)):[]);
                const hint=fixed.every((f:string[])=>f.length===1)?` Call run_tests(${JSON.stringify({files:fixed.map((f:string[])=>f[0]),...(a?.target?{target}:{})})}).`:' Use repo-relative paths, e.g. "test/example.test.ts".';
                return{error:`files must be repo-relative test paths (test globs: ${cfg.tests.join(', ')}) inside the approved write scope or verification scope; rejected ${JSON.stringify(bad)}.${hint}`};
              }
              const names=files.map((f:string)=>f.split('/').at(-1));const dup=names.find((n:string,i:number)=>names.indexOf(n)!==i);
              if(dup)return{error:`the runner adapter selects by basename and two selected files are named ${dup}; select them in separate run_tests calls`};
            }
            const npm=a?.runner==='npm-test';
            if(npm&&files?.length)return{error:`runner:"npm-test" runs the whole package test script and cannot select files; call run_tests(${JSON.stringify({files,target})}) without runner for the selected tests, or run_tests(${JSON.stringify({runner:'npm-test',target})}) without files for the whole script`};
            if(target==='base'&&!npm&&!files?.length)return{error:'target:"base" needs the candidate test files: call run_tests({files:["test/example.test.ts"],target:"base"}), or run_tests({runner:"npm-test",target:"base"}) for the whole package script on base source'};
            if(a?.evidenceDir!==undefined){
              const p=a.evidenceDir;if(target!=='head'||typeof p!=='string'||normPath(p)!==p||!['evidence.png','evidence.json'].every(f=>scope.some((g:string)=>matches(g,`${p}/${f}`))))return{error:'evidenceDir must be a directory inside approved writable scope on head'};
              let cursor=wt;for(const part of p.split('/')){cursor=join(cursor,part);if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())return{error:'evidenceDir cannot traverse symlinks'};}
            }
            let command:string[]|null;try{command=selectTestCommand(cfg,files);}catch(e:any){return{error:e.message};}
            if(!command)return{status:'not-run',exit:null};
            if (runs >= WORKER_TEST_RUNS) return { error: `test run limit reached: all ${WORKER_TEST_RUNS} executed runs of this round are used; say in worker_report which change is not verified` };
            const box = join(x.dir, "tests", `round-${x.visit}-${++attempts}`); mkdirSync(join(box, "out"), { recursive: true }); mkdirSync(join(box, "tmp"), { recursive: true });
            // base = base source bytes + the head's candidate test files (prepareTestBase, the same overlay the fail-first gate gets)
            const cwd=target==='base'?prepareTestBase(wt,join(box,'base'),x.ctx.baseCommit,cfg.tests):wt;
            if(npm){try{command=packageTestCommand(baseTestScript(wt,x.ctx.baseCommit),cwd,target);}catch(e:any){return{error:e.message};}}
            let outputDir=join(box,'out');if(a?.evidenceDir!==undefined){outputDir=join(wt,a.evidenceDir);mkdirSync(outputDir,{recursive:true});}
            const tree=treeState(wt,join(box,'tmp'));
            const env:Record<string,string>={...selectionEnv(files), CREW_TEST_OUTPUT_DIR:outputDir};
            Object.assign(env,testEnvironment());
            runs++;
            const r = await sandboxed(command, { cwd, out: outputDir, tmp: join(box, "tmp"), timeoutS: cfg.timeout_s, network: false, dataDir: o.dataDir,env });
            if (r.refused) { runs--; return { error: `refused: ${r.refused}` }; }
            if(!engine.owns(x))return{error:'round owner ended during tests'};
            const output=r.stdout+r.stderr;writeFileSync(join(box,'output.log'),output);
            const tail=output.trim().split("\n").slice(-80).join("\n").slice(-16000);
            if(!r.timedOut&&ranNoTests(output,r.code)){runs--;return{status:'no-tests',error:`the run executed no tests, so it proves nothing and does not count against the limit. ${files?.length?`The adapter got CREW_TEST_FILES=${env.CREW_TEST_FILES} and CREW_TEST_PATHS=${env.CREW_TEST_PATHS}; check those name existing test files.`:'Check the declared command finds the test files.'}`,target,command,files:files??null,exit:r.timedOut?null:r.code,tail};}
            const evidence=engine.record(x,'worker-test-execution',{head:tree.head,data:{command,target,base:x.ctx.baseCommit,files:files??null,dirty:tree.dirty,tree:tree.tree,exit:r.timedOut?null:r.code,timedOut:r.timedOut,executionMode:localUnrestricted()?'local-unrestricted':'default',outputSha256:createHash('sha256').update(output).digest('hex')}});
            return { status:'executed',target,command,base:x.ctx.baseCommit,head:tree.head,dirty:tree.dirty,tree:tree.tree,exit: r.timedOut ? null : r.code, timedOut: r.timedOut, evidence:evidence?{seq:evidence.seq,sig:evidence.sig}:null,tail }; }
    },
    system: (x, skill) => workerRuntimeRules(x.ctx.reportOnly?.build ? `${skill}\n\nREPORT ONLY: your code from the last round is kept. Do not change any file. Read what you need and call worker_report once with a complete report, then one line.`
      : `${skill}\n\nYou build ONE change in the run's worktree with the fs_* tools (no shell; run_tests runs the repository's tests). Stay inside the spec's scope. Each done line needs a test that fails without your change. How to test, the run budget, the browser library and the read caps: the brief's TOOLS, TESTS and DEPENDENCIES sections (operating manual, code-firstmate/worker). Studio commits your work; you never commit. End with worker_report, then one line.`),
    prompt: (x) => {
      const wt = shellOk(x); const h = head(wt); x.ctx.head = h;
      mkdirSync(join(x.dir, "briefs"), { recursive: true });
      const b = roundBrief(x, "build");
      const rebaseNote = W.get(wkey(x).project,wkey(x).task)?.nativeRebase ? "\nNATIVE REBASE RESOLUTION: read conflict files, resolve within scope using fs tools, then worker_report. Studio continues the rebase; another round resolves any next conflict. Fresh CI and review follow.\n" : "";
      const fix = briefSection(b);
      const plan = x.ctx.door?.door === "one-way" ? (() => { if (!existsSync(join(x.dir, "plan-accept.json"))) throw new Error("a one-way change needs an accepted plan before it builds"); return `\nAccepted plan:\n${JSON.stringify(x.ctx.plan?.rows ?? [])}\nAnswers:\n${(x.ctx.planDecision?.answers ?? []).map((q: any) => `- ${q.q}: ${q.a}`).join("\n")}\n`; })() : "";
      const ro = x.ctx.reportOnly?.build ? "\nREPORT ONLY: the code stays as it is; write the report the checks asked for.\n" : "";
      // The lane's facts live in the brief; the worker skill stays lane-neutral.
      const facts = plan || x.ctx.reportOnly?.build ? "" : "\nROUND FACTS: this is two-way work with no plan round, so the approved spec above is the plan. Staffing, rosters and role skills are Studio's job, not inputs you need. Hold only for an input this brief names that you cannot read. Where the spec is unclear, choose the reading that best fits it, implement it, and list the assumption in worker_report instead of asking.\n";
      const amend = engine.amendments(x.run).length ? `${amendmentsSection(engine.amendments(x.run))}Keep the captain's latest word on each of these (a later change overrides an earlier one it conflicts with). If a brief item, a finding or an answer below would undo the captain's latest word on one, do not do that part: finish the rest and report ASK with amendment set to that change's number, so the captain decides.\n` : "";
      const conflicts = W.get(wkey(x).project, wkey(x).task)?.nativeRebase ? rebaseConflicts(x) : [];
      const conflictNote = conflicts.length ? `REBASE CONFLICTS (resolve these before anything else)\nThe base moved and this task's branch is being rebased onto it. Resolve these files first (keep both sides' intent, remove every conflict marker), then continue the task. Studio finishes the rebase and commits.${conflicts.some(c => c.binary) ? " A binary conflict cannot be resolved with the fs tools: leave it as it is; Studio hands it to the captain." : ""}\n${conflicts.map(c => `- ${c.path}${c.binary ? ` (binary: base side ${String(c.ours ?? "deleted").slice(0, 12)}, task side ${String(c.theirs ?? "deleted").slice(0, 12)})` : ""}\n  base side: ${c.base.join("; ") || "(none listed)"}\n  task side: ${c.task.join("; ") || "(none listed)"}`).join("\n")}\n` : "";
      let notes: string[] = []; try { notes = overlapNotes(x.ctx.spec?.scope ?? [], scopeBlockers(engine, x.run)); } catch {} // informational: never stops a brief
      const overlap = notes.length ? `\nOTHER TASKS ON THESE PATHS (informational; nothing waits for them):\n${notes.map(n => `- ${n}`).join("\n")}\n` : "";
      const text = `BUILD ROUND\nRun ${x.run.id} · round ${x.visit} · head ${h} · branch ${x.ctx.branch}\n${conflictNote}${amend}${specMd(x.ctx.spec)}${plan}${facts}${fix}${ro}${conflictNote ? "" : rebaseNote}${overlap}\nStart with fs_list.${x.run.text.includes("STUB_") ? `\n\nIntent notes:\n${x.run.text}` : ""}\n${engine.briefSkeleton(x, "build")}` + engine.failureBrief(x);
      let prev: any = null; try { prev = JSON.parse(readFileSync(briefFile(x), "utf8")); } catch {}
      if (prev && prev.head !== h) x.log(`round ${x.visit} brief rebound from ${String(prev.head).slice(0, 8)} to ${h.slice(0, 8)}`);
      writeFileSync(briefFile(x), JSON.stringify({ run: x.run.id, round: x.visit, head: h, branch: x.ctx.branch, brief: text }, null, 1));
      x.rn.data.report = null;
      return text;
    },
    skeleton: (x) => codeFacts(x, "worker", { runs: x.ctx.reportOnly?.build ? undefined : WORKER_TEST_RUNS, deliverable: [x.ctx.reportOnly?.build ? "worker_report once with a complete report; change no file." : "The change in the worktree, inside the spec's scope; Studio commits it after the round.", "worker_report once (marker, each done line's test and what ran), then one line."] }),
    handoffState: (x) => { try { return "```\n" + git(shellOk(x), ["status", "--short"]).out + "\n" + git(x.ctx.worktree, ["diff", "--stat"]).out + "\n```"; } catch { return "(no worktree)"; } },
    after: (x, job) => {
      const b = JSON.parse(readFileSync(briefFile(x), "utf8"));
      if (head(shellOk(x)) !== b.head) throw new Error(`the worktree moved during the round (brief bound to ${String(b.head).slice(0, 8)})`);
      const rep = x.rn.data.report; const ro = !!x.ctx.reportOnly?.build;
      if (ro) { const k = wkey(x); const kept = W.endRound(k.project, k.task, `report-only round ${x.visit} touched files`); if (kept) x.log(`report-only round changed files: kept on ${kept}, the code stays at ${String(x.ctx.head).slice(0, 8)}`); x.ctx.reportOnly = { ...x.ctx.reportOnly, build: false }; }
      else if (!git(x.ctx.worktree, ["status", "--porcelain"]).out && (!rep || rep.marker === "WORKER_COMPLETE") && x.visit === 1) throw new Error("the worker changed nothing");
      const native=W.get(wkey(x).project,wkey(x).task)?.nativeRebase;
      if(native){const result=W.continueNativeRebase(wkey(x).project,wkey(x).task,p=>inScope(x.ctx.spec?.scope??[],p));x.ctx.head=result.head;
        if(!result.pending)x.ctx.rebaseStall=null;
        else{
          const stall=rebaseStall(x,result);x.save();
          // binary conflicts or a rebase that does not move: the captain decides (scope card), never an endless rebase-more loop.
          // The rebase is aborted first, so rescope (a spec round) or park starts from the Task's own clean head.
          if(stall){const back=W.abortNativeRebase(wkey(x).project,wkey(x).task);x.ctx.head=back.head;x.ctx.baseCommit=back.baseCommit;x.ctx.rebaseStall=null;
            const summary=`${stall} The rebase was aborted; the next build round rebases again.`;
            x.rn.data.report={marker:"SCOPE-BLOCKED",summary,round:x.visit,conflicts:result.binary.length?result.binary.map(c=>({path:c.path,binary:true,ours:c.ours,theirs:c.theirs})):result.unresolved.map(path=>({path}))};x.rn.note=`SCOPE-BLOCKED · ${summary.slice(0,160)}`;x.save();return "blocked";}
          W.freeze(W.get(wkey(x).project,wkey(x).task)!);
          pendingRebaseChecks.add(x.rn);return "rebase-more";
        }
        x.save();}
      if(x.ctx.remoteRebaseApproved){x.ctx.remoteRebaseApproved=null;x.ctx.remoteRebaseRequired=null;x.ctx.remoteCI=null;x.ctx.reviewUnverified="native rebase requires fresh review";}
      commitRound(x, rep, `${job.provider}·${job.model}`);
      x.rn.note = `${rep?.marker ?? "no report"} · ${x.ctx.head.slice(0, 8)}${rep?.summary ? ` · ${rep.summary.slice(0, 160)}` : ""}${ro ? " · report only" : ""}`;
      if (rep?.marker === "ASK" && (x.ctx.rounds ?? []).filter((r: any) => r.report?.marker === "ASK").length >= Number(x.policy("round_cap", 3))) return "cap";
      // a question that would undo a captain's binding change goes to the captain, never to Firstmate (only the captain changes the captain's changes)
      if (rep?.marker === "ASK" && rep.amendment) x.rn.data.escalation = { reason: `The worker's question touches the captain's binding change A${rep.amendment}; only the captain can undo or change it, so Firstmate does not answer it.` };
      else delete x.rn.data.escalation;
      return rep?.marker === "SCOPE-BLOCKED" ? "blocked" : rep?.marker === "DOOR-CHANGE" ? "door-change" : rep?.marker === "ASK" ? "ask" : "ok";
    },
    /** A round killed at round_timeout_s is classed timeout: its code is kept and committed, the next round can still change code. */
    onTimeout: (x, job) => { commitRound(x, { marker: "TIMEOUT", summary: "stopped at the round time limit", round: x.visit }, `${job.provider}·${job.model}`); x.rn.data.report = null; x.ctx.timeouts = [...(x.ctx.timeouts ?? []), { round: x.visit, head: x.ctx.head }]; x.rn.note = `timeout · ${x.ctx.head.slice(0, 8)} (work kept)`; return "fail"; },
  };
  // ---------- the reviewer (v1's reviewer modes: config.yaml `reviewer: mode: diff|run`, bin/fm-review.sh, skills/reviewer/SKILL.md) ----------
  // policy reviewer.mode: run (the default) gives the reviewer the spec, the diff, the CI and check results, the fail-first
  // report and read-only, type-aware reads of a fresh checkout of the head, plus sandboxed test runs and small verification
  // commands on a throwaway copy of the head, its dependencies installed by the project's install policy (no network for the
  // run itself, no credentials); diff (v1's base mode, opt-in) reads only. review-depth: every changed file read (any type;
  // within the read budget), in run mode at least one executed verification unless it cannot run (recorded, flagged), and no
  // APPROVE over a worker report that says its tests were not run or not green unless the reviewer ran the covering tests
  // green itself (E2E F20). Untrusted files are read off the event loop, with caps (src/review-read.ts).
  const reviewMode = (x: X): "diff" | "run" => (x.policy("reviewer.mode") === "diff" ? "diff" : "run");
  /** the worker's own words that its tests were not run or not green (src/domain/report-verification.ts), or a last build
   * round stopped at the time limit (its report is gone; the round is never verified) */
  const workerUnverified = (x: X): string | null => {
    const last = (x.ctx.rounds ?? []).at(-1); if (last?.report?.marker === "TIMEOUT") return `build round ${last.round} stopped at the round time limit, so its last change was never tested`;
    return unverifiedClaim(x.run.nodes?.build?.data?.report?.summary ?? last?.report?.summary); };
  const readBudget = (x: X) => Math.max(4, Number(x.policy("reviewer.read_budget") ?? 40) || 40);
  const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** a done line names a path: the path itself, not a longer one it is the start of (src/a.ts is not src/a.tsx) */
  const names = (line: string, p: string) => new RegExp(`(^|[^\\w./-])${escRe(p)}(?=$|[^\\w./-]|\\.+(?=$|[^\\w./-]))`).test(line);
  /** what this review must read: every changed file, or (over the budget) the files the done lines name plus a sample, never more than the budget */
  async function reviewPlan(x: X, tree: string) {
    const files = changedOf(shellOk(x), x.ctx.baseCommit).filter((p) => !p.status?.startsWith("D")).map((p) => normPath(p.path)).filter((p): p is string => !!p);
    const unreadable: { path: string; reason: string }[] = []; const cost = new Map<string, number>();
    for (const p of files) { const abs = join(tree, p); let st: any = null; try { st = lstatSync(abs); } catch {}
      if (!st || !st.isFile()) { unreadable.push({ path: p, reason: st ? "not a regular file (a link or a folder)" : "not in the head's checkout" }); continue; }
      if (st.size > READ_CAP_BYTES) { unreadable.push({ path: p, reason: `larger than ${READ_CAP_BYTES / 1e6} MB` }); continue; }
      const b = Buffer.from(await Bun.file(abs).arrayBuffer());
      cost.set(p, kindOf(b) === "text" ? Math.max(1, Math.ceil(b.toString("utf8").split("\n").length / LINES_PER_READ)) : 1); }
    const budget = readBudget(x); const total = [...cost.values()].reduce((a, n) => a + n, 0);
    let required = [...cost.keys()]; const notRead: { path: string; reason: string }[] = [];
    if (total > budget) {
      const named = required.filter((p) => (x.ctx.spec?.done ?? []).some((d: string) => names(d, p)));
      const pick: string[] = []; let used = 0;
      for (const p of [...named, ...required.filter((q) => !named.includes(q)).sort()]) { if (used + cost.get(p)! <= budget) { pick.push(p); used += cost.get(p)!; } else notRead.push({ path: p, reason: "budget" }); }
      required = pick;
    }
    const requiredCost = required.reduce((a, p) => a + cost.get(p)!, 0);
    return { files, required, unreadable, notRead, budget, total, requiredCost, cost: Object.fromEntries(cost), binding: { run: x.run.id, node: x.node.id, visit: x.visit, attempt: x.rn.attempt ?? 0, base: x.ctx.baseCommit, head: x.ctx.head } };
  }
  const validReviewPlan = (x: X, p: any) => {
    try {
      const paths = (a: any) => Array.isArray(a) && a.every((v: any) => typeof v === "string" && normPath(v) === v) && new Set(a).size === a.length;
      const notes = (a: any) => Array.isArray(a) && a.every((v: any) => v && typeof v.reason === "string" && v.reason.length > 0) && paths(a.map((v: any) => v.path));
      if (!p || !paths(p.files) || !paths(p.required) || !notes(p.unreadable) || !notes(p.notRead) || !p.cost || typeof p.cost !== "object" || Array.isArray(p.cost)) return false;
      const b = p.binding;
      if (!b || b.run !== x.run.id || b.node !== x.node.id || b.visit !== x.visit || b.attempt !== (x.rn.attempt ?? 0) || b.base !== x.ctx.baseCommit || b.head !== x.ctx.head || b.head !== head(shellOk(x))) return false;
      const files = changedOf(shellOk(x), x.ctx.baseCommit).filter((f) => !f.status?.startsWith("D")).map((f) => normPath(f.path)).filter(Boolean).sort();
      if (JSON.stringify([...p.files].sort()) !== JSON.stringify(files)) return false;
      const readable = Object.keys(p.cost);
      if (!readable.every(k => p.files.includes(k) && Number.isInteger(p.cost[k]) && p.cost[k] > 0)) return false;
      const covered = [...p.required, ...p.notRead.map((n: any) => n.path), ...p.unreadable.map((n: any) => n.path)];
      if (new Set(covered).size !== covered.length || JSON.stringify([...covered].sort()) !== JSON.stringify(files) || !p.required.every((k: string) => readable.includes(k)) || !p.notRead.every((n: any) => n.reason === "budget" && readable.includes(n.path)) || p.unreadable.some((n: any) => readable.includes(n.path))) return false;
      return p.budget === readBudget(x) && p.total === readable.reduce((n, k) => n + p.cost[k], 0) && p.requiredCost === p.required.reduce((n: number, k: string) => n + p.cost[k], 0) && p.requiredCost <= p.budget;
    } catch { return false; }
  };
  const reviewDepth = (x: X) => {
    const validPlan = validReviewPlan(x, x.rn.data.plan);
    const plan = validPlan ? x.rn.data.plan : { files: [], required: [], unreadable: [], notRead: [], budget: readBudget(x), total: 0, requiredCost: 0 }; const mode = reviewMode(x); const cfg = cfgOf(x);
    const d = (x.rn.data.depth ??= { executed: [] as any[], read: {} as Record<string, { total: number; ranges: [number, number][] }>, viewed: {} as Record<string, string>, notExecuted: null as string | null });
    const full = (p: string) => { if (d.viewed[p]) return true; const r = d.read[p]; if (!r) return false; let upto = 0; for (const [a, b] of [...r.ranges].filter(([a]) => a <= r.total).sort((m, n) => m[0] - n[0])) { if (a > upto + 1) return false; upto = Math.max(upto, b); } return upto >= r.total; };
    const unread = plan.required.filter((p: string) => !full(p));
    // run mode: an executed verification, unless it cannot run here (no test command, the sandbox refuses): recorded and flagged, never a loop
    if (mode === "run" && !d.executed.some((e: any) => !e.refused) && !d.notExecuted) {
      const refused = d.executed.find((e: any) => e.refused); if (refused) d.notExecuted = `the sandbox refused the run: ${refused.refused}`; else if (!cfg.test) d.notExecuted = "the repository declares no test command";
    }
    const needExec = mode === "run" && !d.executed.some((e: any) => !e.refused) && !d.notExecuted;
    const missing = [...(!validPlan ? ["prepare a valid current-attempt review plan bound to this head"] : []), ...(needExec ? ["run the repository's tests at least once (run_tests)"] : []),
      ...(unread.length ? [`read (fs_read; text in ranges of ${LINES_PER_READ} lines until every line is read; images, PDFs and binaries once): ${unread.join(", ")}`] : [])];
    const read = plan.required.filter((p: string) => full(p)).map((p: string) => ({ path: p, view: d.viewed[p] ?? "text" }));
    // an APPROVE over a worker who said its tests were not run or not green needs the reviewer's own green run of the covering
    // tests: the whole declared command, or every changed test file (with no changed test file, only the whole command). A
    // repository that declares no test command cannot be run by anyone: the APPROVE stands and the merge card says so.
    const unverified = workerUnverified(x); const changedTests = plan.files.filter((p: string) => (cfg.tests ?? []).some((g: string) => matches(g, p)));
    const covering = d.executed.some((e: any) => e.tests && !e.refused && e.exit === 0 && (e.tests === "all" || (changedTests.length > 0 && changedTests.every((p: string) => e.tests.includes(p)))));
    const unverifiedNote = unverified && !cfg.test ? `not executed: the repository declares no test command; the worker said: "${unverified}"` : null;
    const approveGap = unverified && cfg.test && !covering ? `the worker reported its tests were not run or not green ("${unverified}"); ${mode === "run" ? `run the covering tests green yourself first (run_tests with no files${changedTests.length ? `, or with ${changedTests.join(", ")}` : ""})` : "diff mode cannot run them, so this change cannot be approved in this review"}` : null;
    return { d, plan, mode, unread, missing, read, validPlan, unverified, approveGap, unverifiedNote };
  };
  engine.natives["review-depth"] = (_i, hp) => {
    const x = hp.x as X; const v = x.rn.data.verdict; const { d, plan, mode, missing, read, validPlan, unverified, approveGap, unverifiedNote } = reviewDepth(x);
    const findings = !validPlan ? [{ locator: { type: "card", field: "review" }, message: "the review has no valid current-attempt plan bound to this head", expected: "prepare a fresh review plan before verification", class: "review-unverified", severity: "blocking" }] : x.rn.data.unverified ? [{ locator: { type: "card", field: "review" }, message: `the reviewer would not verify its claims: ${x.rn.data.unverified}`, expected: `a verdict after what ${mode} mode asks`, class: "review-unverified", severity: "blocking" }]
      : v && missing.length ? missing.map((m) => ({ locator: { type: "card", field: "review" }, message: `a verdict without its verification: ${m}`, expected: `the reviewer did what ${mode} mode asks before its verdict`, class: "review-depth", severity: "blocking" }))
      : v?.verdict === "APPROVE" && approveGap ? [{ locator: { type: "card", field: "review" }, message: `an APPROVE over an unverified worker report: ${approveGap}`, expected: "the covering tests run green by the reviewer, or no APPROVE", class: "review-depth", severity: "blocking" }] : [];
    const data = { mode, read, unreadable: plan.unreadable, notRead: plan.notRead, executed: d.executed.map((e: any) => ({ command: e.command, exit: e.exit ?? null, refused: e.refused ?? null })), notExecuted: d.notExecuted, budget: plan.budget, ...(unverified ? { workerUnverified: unverified } : {}), ...(unverifiedNote ? { notes: [unverifiedNote] } : {}) };
    x.ctx.reviewDepth = data;
    return { verdict: findings.length ? "fail" : "pass", score: findings.length ? 0 : 1, findings, data } as any;
  };
  // the step-back card's "another model" (provider/model in its note): the next review runs on it, set as the round begins
  // (the run's own agent pick for the node, between visits), once per answer
  const reviewSwap = (x: X) => { const a = x.ctx.answers?.["step-back"]; if (a?.choice !== "other-model" || x.ctx.stepBackFor === "design" || x.ctx.reviewSwapAt === a.at) return;
    const [provider, ...rest] = String(a.note ?? "").trim().split("/").map((t: string) => t.trim()); x.ctx.reviewSwapAt = a.at;
    if (provider) { x.rn.agent = { provider, model: rest.join("/") || null }; x.log(`the step-back card's pick: this review runs on ${provider}${rest.length ? ` · ${rest.join("/")}` : ""}`); } };
  /** a fresh checkout of the head for the reviewer's reads (detached; removed when the review ends) */
  const reviewTree = (x: X) => { const h = head(shellOk(x)); const t = tmpTree(x.run.id, "review-head"); git(x.ctx.repo, ["worktree", "remove", "--force", t]); rmSync(t, { recursive: true, force: true });
    addTree(x.ctx.repo, ["-q", "--detach", t, h]); return t; };
  const dropReviewTree = (x: X) => { const t = x.rn.data.tree; if (t) { git(x.ctx.repo, ["worktree", "remove", "--force", t]); rmSync(t, { recursive: true, force: true }); x.rn.data.tree = null; }
    rmSync(join(x.dir, "review-runs"), { recursive: true, force: true }); x.rn.data.runBase = null; };
  /** each attempt starts from nothing: its own checkout, plan and verification */
  async function prepareReview(x: X) {
    x.ctx.reviewUnverified = null; x.ctx.reviewDepth = null;
    const wt = shellOk(x); x.ctx.head = head(wt); for (const k of ["verdict", "depth", "refused", "plan", "unverified", "runBase", "runDeps"]) x.rn.data[k] = null;
    dropReviewTree(x); x.rn.data.tree = reviewTree(x); x.rn.data.plan = await reviewPlan(x, x.rn.data.tree); x.save();
  }
  /**
   * run mode's place to run: the fresh checkout of the head, copied (no .git) and given its dependencies the way a round
   * gets them (the project's install policy, else the lockfile's frozen install, in the round sandbox, the network only to
   * the hosts egress.allow grants). Installed once per review attempt; every run then works on its own clone of that.
   */
  const runsDir = (x: X) => join(x.dir, "review-runs", `round-${x.visit}`);
  async function runBase(x: X): Promise<string> {
    if (x.rn.data.runBase && existsSync(x.rn.data.runBase)) return x.rn.data.runBase;
    const tree = x.rn.data.tree; if (!tree || !existsSync(tree)) throw new Error("the review's checkout is gone");
    const base = join(runsDir(x), "base"); mkdirSync(runsDir(x), { recursive: true }); rmSync(base, { recursive: true, force: true });
    if (!(await cloneDir(tree, base))) throw new Error("the head's checkout could not be copied");
    rmSync(join(base, ".git"), { recursive: true, force: true });
    const install = x.policy("install");
    const deps = await W.installIn(base, `review-${x.run.id}`, install === false ? false : Array.isArray(install) ? install.map(String) : null,
      { scripts: x.policy("install_scripts") === true, allow: ([] as any[]).concat(x.policy("egress.allow", []) ?? []).map(String) });
    if (!deps.ok && deps.gap) throw new EnvGapError(deps.gap);
    x.rn.data.runDeps = { ran: deps.ran, detail: deps.detail }; x.rn.data.runBase = base; x.save(); return base;
  }
  /** a clonefile copy (APFS) or a plain one, off the event loop with a time limit */
  const cloneDir = async (from: string, to: string) => { const ok = await helper(process.platform === "darwin" ? ["/bin/cp", "-cR", from, to] : ["cp", "-R", from, to], { timeoutMs: 120_000, maxBytes: 1 << 20 }); return ok !== null && existsSync(to); };
  /**
   * every command a reviewer's run executes (its argv is model-chosen, or comes from the head's own config) resolves on a
   * fixed PATH: the copy's node_modules/.bin, then the system folders and bun's. A path with a slash must stay inside the
   * copy. The sandbox never adds the program's folder to its reads (argvRead: false), and the run gets that PATH only.
   */
  const SYSTEM_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", dirname(process.execPath)];
  const fixedPath = (copy: string) => [join(copy, "node_modules", ".bin"), ...SYSTEM_PATH];
  const resolveCmd = (copy: string, cmd: string): string | null => {
    if (!cmd || cmd.startsWith("/")) return null;
    const real = (q: string) => { try { return realpathSync(q); } catch { return null; } }; const rc = real(copy);
    const inCopy = (abs: string) => { const n = normalize(abs); const r = real(n); return n.startsWith(copy + "/") && rc && r?.startsWith(rc + "/") && statSync(r).isFile() ? n : null; }; // a link out of the copy is refused
    if (cmd.includes("/")) return inCopy(join(copy, cmd));
    for (const d of fixedPath(copy)) { const p = join(d, cmd); if (d.startsWith(copy + "/") ? inCopy(p) : existsSync(p)) return p; } return null; };
  const reviewHooks = roundHooks(false);
  engine.modes.review = {
    ...reviewHooks,
    prepare: prepareReview,
    preparePick: reviewSwap,
    begin: async (x) => { await reviewHooks.begin?.(x); await prepareReview(x); },
    end: async (x, how) => { dropReviewTree(x); await reviewHooks.end?.(x, how); },
    sandbox: (x) => { const wt = x.ctx.worktree; const t = x.rn.data.tree; return wt && existsSync(wt) ? { writes: [], reads: [t ?? wt], cwd: t ?? wt } : null; }, // reads the checkout, writes nothing of it
    tools: (x) => { const tree = x.rn.data.tree ?? shellOk(x); const cfg = cfgOf(x); const mode = reviewMode(x); let runs = 0, attempts = 0, cmds = 0;
      // the listing and the search over the untrusted checkout: bounded and off the event loop like every read (src/review-read.ts)
      const others: AgentTool[] = [
        { name: "fs_list", description: `List the files of the head's checkout with their sizes (at most ${LIST_CAP}).`, schema: { type: "object", properties: {} }, run: async () => listTree(tree) },
        { name: "fs_search", description: "Find lines containing a text (case-insensitive) across the head's text files (at most 50 hits; very large files are skipped, read them with fs_read).", schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          run: async (a) => searchTree(tree, String(a.text ?? "")) }];
      const read: AgentTool = { name: "fs_read", description: `Read a changed or any other file of the head, by its type: text by line range (start from 1, up to ${LINES_PER_READ} lines a call; lockfiles and generated files too), an image as a picture, a PDF as its page text and page 1 as a picture, any other binary as its type, size, sha256, hex head and the same view of the base version.`,
        schema: { type: "object", properties: { path: { type: "string" }, start: { type: "number" }, lines: { type: "number" } }, required: ["path"] },
        run: async (a) => { const r = await typedRead(tree, String(a.path ?? ""), { start: a.start, lines: a.lines, base: x.ctx.baseCommit }); const d = reviewDepth(x).d;
          if (r?.view === "text") { const e = (d.read[r.path] ??= { total: r.totalLines, ranges: [] }); e.total = r.totalLines; e.ranges.push(r.lines); }
          else if (r?.view && r.view !== "none") d.viewed[r.path] = r.view;
          x.save(); return r; } };
      // both run tools: on a clone of the installed fresh checkout, in the sandbox (no network), the clone removed on every exit
      const inCopy = async (label: string, argv: string[], timeoutS: number, extraEnv: Record<string, string> = {}, tests: false | "all" | string[] = false) => {
        const d = reviewDepth(x).d; const box = join(runsDir(x), label); let base: string;
        try { base = await runBase(x); }
        catch (e: any) { const why = String(e?.message ?? e).slice(0, 300); if (!d.notExecuted) d.notExecuted = why; d.executed.push({ command: argv.join(" "), refused: why, at: new Date().toISOString() }); x.save();
          return { error: `${why} (recorded: the merge card flags that it could not run)` }; }
        try {
          const copy = join(box, "copy"); mkdirSync(box, { recursive: true }); if (!(await cloneDir(base, copy))) return { error: "the installed checkout could not be copied" };
          const exe = resolveCmd(copy, argv[0]); if (!exe) return { error: `refused: ${argv[0]} is not a program on the fixed PATH (${fixedPath("<copy>").join(":")}) or a file inside the copy` };
          const cmd = [exe, ...argv.slice(1)]; mkdirSync(join(box, "tmp"), { recursive: true });
          const r = process.env.CREW_TEST_REVIEW_SANDBOX_REFUSE === "1" ? { refused: "the round sandbox is not available (test)" } as any
            : await sandboxed(cmd, { cwd: copy, out: copy, tmp: join(box, "tmp"), timeoutS, network: false, dataDir: o.dataDir, argvRead: false, env: { PATH: fixedPath(copy).join(":"), ...testEnvironment(), ...extraEnv, CREW_TEST_OUTPUT_DIR:copy } });
          if (r.refused) { d.executed.push({ command: argv.join(" "), refused: r.refused, at: new Date().toISOString() }); x.save(); return { error: `refused: ${r.refused} (recorded: the merge card flags that it could not run)` }; }
          const tail = (r.stdout + r.stderr).trim().split("\n").slice(-25).join("\n");
          // a test run that selected nothing proves nothing: never recorded as an executed verification
          if (tests && !r.timedOut && ranNoTests(r.stdout + r.stderr, r.code)) return { status: "no-tests", error: `the run executed no tests, so it proves nothing and does not count against the limit.${extraEnv.CREW_TEST_FILES ? ` The adapter got CREW_TEST_FILES=${extraEnv.CREW_TEST_FILES} and CREW_TEST_PATHS=${extraEnv.CREW_TEST_PATHS}; check those name existing test files.` : " Check the declared command finds the test files."}`, exit: r.timedOut ? null : r.code, tail };
          d.executed.push({ command: argv.join(" "), exit: r.timedOut ? null : r.code, at: new Date().toISOString(), ...(tests ? { tests } : {}) }); x.save();
          return { status: "executed", exit: r.timedOut ? null : r.code, timedOut: r.timedOut, tail };
        } catch (e: any) { return { error: String(e?.message ?? e) }; }
        finally { rmSync(box, { recursive: true, force: true }); } };
      const reviewTests = async (a: any): Promise<any> => {
        if (!cfg.test) return { error: "the repository declares no test command (recorded: the merge card flags that nothing ran); run_command can still check a claim" };
        const files = a?.files; const isTest = (p: any) => typeof p === "string" && normPath(p) === p && !p.includes(",") && cfg.tests.some(g => matches(g, p));
        if (files !== undefined) {
          if (!Array.isArray(files) || !files.length || files.length > 12) return { error: 'files must be a nonempty list of at most 12 repo-relative test paths, e.g. run_tests({files:["test/example.test.ts"]}); omit files to run the whole declared command' };
          const bad = files.filter((p: any) => !isTest(p));
          if (bad.length) { // a bare basename names the repository test it ends, when exactly one does
            const r = git(tree, ["ls-files"]); const known = r.ok ? r.out.split("\n").filter(Boolean) : [];
            const fixed = files.map((p: any) => isTest(p) ? [p] : typeof p === "string" ? known.filter(k => k.endsWith(`/${p}`) && isTest(k)) : []);
            const hint = fixed.every((f: string[]) => f.length === 1) ? ` Call run_tests(${JSON.stringify({ files: fixed.map((f: string[]) => f[0]) })}).` : ' Use repo-relative paths, e.g. "test/example.test.ts".';
            return { error: `files must be repo-relative test paths (test globs: ${cfg.tests.join(", ")}); rejected ${JSON.stringify(bad)}.${hint}` };
          }
          const names = files.map((f: string) => f.split("/").at(-1)); const dup = names.find((v: string, i: number) => names.indexOf(v) !== i);
          if (dup) return { error: `the runner adapter selects by basename and two selected files are named ${dup}; select them in separate run_tests calls` };
        }
        let command; try { command = selectTestCommand(cfg, files); } catch (e: any) { return { error: e.message }; }
        if (runs >= REVIEW_TEST_RUNS) return { error: `test run limit reached: all ${REVIEW_TEST_RUNS} executed runs are used; judge by reading and say what is not verified` };
        runs++; const r: any = await inCopy(`tests-${++attempts}`, command!, cfg.timeout_s, selectionEnv(files), files?.length ? files.map(String) : "all");
        if (r.status !== "executed") runs--; // refused, could not run, or ran no tests
        return r;
      };
      const runTool: AgentTool[] = mode !== "run" ? [] : [
        { name: "run_tests", description: `Run the repository's own test command on the head, in a throwaway copy of the head with its dependencies installed, in your sandbox (no network, at most ${REVIEW_TEST_RUNS} executed runs; refused calls and runs that select no tests do not count, and every result says how many remain). Optional files selects tests by repo-relative path (e.g. "test/format.test.ts"); the runner adapter receives basenames in CREW_TEST_FILES and the paths in CREW_TEST_PATHS. Returns the exit code and the last lines.`, schema: { type: "object", properties: {files:{type:"array",items:{type:"string"},maxItems:12}} },
          run: async (a) => { const res: any = await reviewTests(a); return { ...res, runsRemaining: Math.max(0, REVIEW_TEST_RUNS - runs) }; } },
        { name: "run_command", description: "Run one small verification command (argv, no shell; a program from the system PATH, bun, or a path inside the copy) on a throwaway copy of the head in your sandbox: no network, no credentials, nothing written back. At most 4 times.",
          schema: { type: "object", properties: { argv: { type: "array", items: { type: "string" } } }, required: ["argv"] },
          run: async (a) => { const argv = (Array.isArray(a.argv) ? a.argv : []).map(String).slice(0, 40); if (!argv.length) return { error: "argv is required" }; if (++cmds > 4) return { error: "command limit reached" };
            if (argv[0].startsWith("/")) return { error: `refused: ${argv[0]} is an absolute path; name a program on the fixed PATH or a path inside the copy` };
            return inCopy(`cmd-${cmds}`, argv, 120); } }];
      return [...others, read, ...runTool,
        { name: "review_verdict", description: "Your verdict, once. REJECT carries a numbered list: each finding with a file locator (path and line), a tag (must-fix or follow-up) and one concrete fix (for a must-fix, the exact diff). After an earlier REJECT, keep its numbering. APPROVE may carry follow-ups.",
      schema: { type: "object", properties: { verdict: { type: "string", enum: ["APPROVE", "REJECT"] }, findings: { type: "array", items: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, text: { type: "string" }, tag: { type: "string", enum: ["must-fix", "follow-up"] }, fix: { type: "string" }, class: { type: "string" } }, required: ["text", "tag"] } }, followups: { type: "array", items: { type: "string" } }, superseded: { type: "array", description: "done lines a captain's binding change supersedes", items: { type: "object", properties: { done: { type: "number" }, amendment: { type: "number" } }, required: ["done", "amendment"] } } }, required: ["verdict"] },
      run: (a) => { const f = (Array.isArray(a.findings) ? a.findings : []).slice(0, 12).map((y: any, i: number) => ({ n: i + 1, path: y?.path ? String(y.path) : null, line: Number(y?.line) || null, text: String(y?.text ?? y).slice(0, 600), tag: y?.tag === "follow-up" ? "follow-up" : "must-fix", fix: String(y?.fix ?? "").slice(0, 600), class: String(y?.class ?? "review").slice(0, 40) }));
        if (a.verdict === "REJECT" && !f.some((y: any) => y.tag === "must-fix")) return { error: "a REJECT needs at least one must-fix finding" };
        const depth = reviewDepth(x);
        if (!depth.missing.length && a.verdict === "APPROVE" && depth.approveGap) { x.rn.data.refused = `Your APPROVE is refused (${depth.mode} mode): ${depth.approveGap}. Then call review_verdict again, or REJECT with a must-fix that names the missing verification.`; x.save(); return { error: x.rn.data.refused }; }
        if (depth.missing.length) { x.rn.data.refused = `Your verdict is refused (${depth.mode} mode): a verdict needs its verification first. Still missing: ${depth.missing.join("; ")}. Then call review_verdict again, and list under Executed each command you ran and under "Read, not run" each claim you only read.`; x.save(); return { error: x.rn.data.refused }; }
        // what the review could not cover is part of its verdict, and the merge card says so
        const notCovered = [...depth.plan.notRead.map((n: any) => `not read (${n.reason}): ${n.path}`), ...depth.plan.unreadable.map((n: any) => `not readable (${n.reason}): ${n.path}`), ...(depth.d.notExecuted && !depth.unverifiedNote ? [`not executed: ${depth.d.notExecuted}`] : []), ...(depth.unverifiedNote ? [depth.unverifiedNote] : [])];
        const am = engine.amendments(x.run), dn = (x.ctx.spec?.done ?? []).length;
        const superseded = (Array.isArray(a.superseded) ? a.superseded : []).map((y: any) => ({ done: Number(y?.done), amendment: Number(y?.amendment) })).filter((y: any) => Number.isSafeInteger(y.done) && y.done >= 1 && y.done <= dn && am.some((m) => m.n === y.amendment)).slice(0, 20);
        x.rn.data.verdict = { verdict: a.verdict === "APPROVE" ? "APPROVE" : "REJECT", findings: f, followups: (a.followups ?? []).map(String).slice(0, 8), mode: depth.mode, notCovered, ...(superseded.length ? { superseded } : {}) }; x.save(); return { ok: true, notCovered }; } }]; },
    // the tool budget follows the plan: every required read twice over (ranges), the run tools, the verdict, room to look around
    maxTools: (x: X) => 2 * (x.rn.data.plan?.requiredCost ?? readBudget(x)) + 30,
    skeleton: (x: X) => { const f = codeFacts(x, "reviewer", { deliverable: ["Read every file the read plan lists, then review_verdict once (each finding with a file path and line).", `Last line: APPROVE:${x.run.id} or REJECT:${x.run.id}.`] });
      return { ...f, TESTS: [`Review mode: ${reviewMode(x)}${reviewMode(x) === "run" ? " (run at least one verification before the verdict)" : " (nothing runs: judge by reading)"}; read budget ${readBudget(x)} reads.`, ...(f.TESTS ?? [])] }; },
    system: (x, skill) => `${skill}\n\nYou review one change with a fresh context in ${reviewMode(x)} mode: you get the spec, the diff, the CI and check results and the fail-first report, never the worker's reasoning, and read-only fs_* tools over a fresh checkout of the head (fs_read shows any file by its type: text, images, PDFs, binaries).${reviewMode(x) === "run" ? " In run mode you also check claims by running: run_tests (the repository's tests) or run_command (a small verification), on a throwaway copy of the head with its dependencies installed, in a sandbox with no network; run at least one before your verdict." : " Diff mode runs nothing: judge by reading."} Read every file the read plan below lists before your verdict; a verdict without that is refused. Call review_verdict once; give every finding a file path and line.${engine.amendments(x.run).length ? " Judge against the spec and the captain's binding changes listed above it: those changes are authorized, and between two the later one wins, so never reject an implementation of the captain's latest word. Where a done line conflicts with a captain change, that line is superseded: judge the change instead and name the line in review_verdict's superseded (done line number and change number)." : ""} Then answer with APPROVE:${x.run.id} or REJECT:${x.run.id} as your last line.`,
    prompt: (x) => {
      const wt = shellOk(x); const h = x.ctx.head ?? head(wt); const plan = x.rn.data.plan ?? { required: [], notRead: [], unreadable: [], budget: readBudget(x) };
      const diff = git(wt, ["diff", "--no-color", `${x.ctx.baseCommit}..HEAD`]).out.slice(0, 24000);
      const L = engine.ledger(x.run.id).filter((e) => e.head === h && (e.check === "firstmate/ci" || e.check === "firstmate/fail-first"));
      const refusedBefore = x.ctx.reviewBrief ? `BRIEF (your last attempt): ${x.ctx.reviewBrief}\n` : "";
      const prior = (x.ctx.reviews ?? []).length ? `Earlier verdicts: ${(x.ctx.reviews ?? []).map((r: any) => `${r.verdict} (${r.findings.length})`).join(", ")}\n${standingList(x.ctx.reviews.at(-1))}` : "";
      const planText = `Read plan (${reviewMode(x)} mode, budget ${plan.budget} reads): read ${plan.required.join(", ") || "(nothing)"}${plan.notRead.length ? `\nNot read (over the budget; say so in your verdict): ${plan.notRead.map((n: any) => n.path).join(", ")}` : ""}${plan.unreadable.length ? `\nNot readable: ${plan.unreadable.map((n: any) => `${n.path} (${n.reason})`).join(", ")}` : ""}\n`;
      return `CODE REVIEW\nRun ${x.run.id} · review ${x.visit} · head ${h} · door ${x.ctx.door?.door} · mode ${reviewMode(x)}\n${amendmentsSection(engine.amendments(x.run))}${specMd(x.ctx.spec)}\n${L.map((e) => `${e.check}: ${e.verdict}${e.findings.length ? ` — ${e.findings.map((f) => f.message).join("; ").slice(0, 400)}` : ""}`).join("\n")}\n${prior}${refusedBefore}${planText}\nDiff (base..head):\n${diff || "(no diff)"}`;
    },
    after: (x, job) => {
      if (!validReviewPlan(x, x.rn.data.plan)) { x.rn.data.verdict = null; x.rn.data.refused = "the review has no valid current-attempt plan bound to this head"; }
      const v = x.rn.data.verdict; const by = `${job.provider}·${job.model} (reviewer #${x.visit})`;
      if (!v) {
        x.ctx.reviewBrief = x.rn.data.refused ?? null;
        // the retry first; still refused after it, the review fails its checks (review-unverified) and the refine loop routes to the step-back card, never a failed run
        if ((x.rn.attempt ?? 0) < (x.node.retries ?? 0)) throw new Error(x.rn.data.refused ? `the reviewer's verdict was refused: ${x.rn.data.refused}` : "the reviewer gave no verdict");
        x.rn.data.unverified = x.rn.data.refused ?? "the reviewer gave no verdict"; x.ctx.reviewUnverified = x.rn.data.unverified;
        x.rn.data.judged = { provider: job.provider, model: job.model, job: job.id, by, verdict: "fail", findings: [{ locator: { type: "card", field: "review" }, message: `the reviewer would not verify its claims: ${x.rn.data.unverified}`, expected: "a verified verdict", class: "review-unverified", severity: "blocking" }] };
        x.rn.note = "no verified verdict after the retry"; return "ok";
      }
      x.ctx.reviewBrief = null; x.ctx.reviewUnverified = null;
      x.ctx.reviews = [...(x.ctx.reviews ?? []), { ...v, head: x.ctx.head, by, round: x.visit }];
      // the reviewer's verdict is one vote of the judged review-verdict check
      x.rn.data.judged = { provider: job.provider, model: job.model, job: job.id, by, verdict: v.verdict === "APPROVE" ? "pass" : "fail", findings: v.findings.filter((f: any) => f.tag === "must-fix" || v.verdict === "APPROVE").map((f: any) => ({ locator: f.path ? { type: "file", path: f.path, line: f.line } : null, message: f.text, expected: f.fix || null, class: `review-${f.class}`, severity: f.tag === "must-fix" ? "blocking" : "minor" })) };
      if (v.followups.length) x.ctx.followups = [...new Set([...(x.ctx.followups ?? []), ...v.followups])];
      x.rn.note = `${v.verdict}${v.findings.length ? `: ${v.findings.map((f: any) => `${f.n}. [${f.tag}] ${f.text}`).join(" ").slice(0, 300)}` : ""}`; return "ok";
    },
  } as any;

  // ---------- card bodies: intent sections in en and zh-TW (architecture §3.4) ----------
  const ledgerSplit = (x: X) => { const dm = engine.doneLines(x.run); return { proved: dm.filter((d) => d.proved), eye: dm.filter((d) => !d.proved) }; };
  const T = (x: X) => x.ctx.spec?.title ?? x.run.title;
  /** the zh-TW title and why the coordinator wrote (spec.zh); never an English stand-in or a placeholder */
  // a spec stored before zh existed (an in-flight run) takes the zh explain; with neither, the English title is marked, never passed off as a translation
  const ZT = (x: X) => x.ctx.spec?.zh?.title || x.ctx.spec?.explain?.["zh-TW"] || `${T(x)}（未翻譯）`;
  const zhWhyOf = (x: X) => (x.ctx.spec?.zh?.why ?? []).join("") || x.ctx.spec?.explain?.["zh-TW"] || "";
  const scopeIn = (x: X) => (x.ctx.spec?.scope ?? []) as string[];
  const glossary = [{ term: "one-way", means: "a change a revert does not undo" }, { term: "fail-first", means: "a test that is red before the change and green after it" }];
  const zhGloss = [{ term: "單向門", means: "revert 無法還原的變更" }, { term: "fail-first", means: "改動前紅、改動後綠的測試" }];
  const base = (x: X, why: string, how: string, zhWhy: string, zhHow: string, extra: any = {}) => ({
    en: { why, how, scope: { in: scopeIn(x), out: [] }, done: x.ctx.spec?.done ?? [], beforeAfter: extra.ba ?? "", glossary },
    zh: { why: zhWhy, how: zhHow, intent: x.ctx.spec?.explain?.["zh-TW"] || undefined, scope: { in: scopeIn(x), out: [] }, done: x.ctx.spec?.done ?? [], beforeAfter: extra.ba ?? "", glossary: zhGloss } });
  // what an escalation names: the checks still failing on the last round (from its brief), never the brief itself
  const failingOf = (x: X, producer: string) => { const items: any[] = x.ctx.briefs?.[producer]?.items ?? []; const by = new Map<string, string>();
    for (const it of items) if (it?.check && !by.has(it.check)) by.set(String(it.check), String(it.message ?? "").replace(/\s+/g, " ").slice(0, 160)); return [...by.entries()].slice(0, 6); };
  const failingEn = (x: X, producer = "build") => { const f = failingOf(x, producer); return f.length ? `Still failing: ${f.map(([c, m]) => `${c}${m ? ` (${m})` : ""}`).join("; ")}.` : "No check names a failure; the captain's or the reviewer's notes are still open."; };
  const failingZh = (x: X, producer = "build") => { const f = failingOf(x, producer); return f.length ? `仍未通過的檢查：${f.map(([c]) => c).join("、")}。` : "沒有檢查列出失敗；船長或 reviewer 的意見仍未處理。"; };
  const failingList = (x: X, producer = "build") => failingOf(x, producer).map(([c, m]) => `- ${c}${m ? `: ${m}` : ""}`).join("\n");
  /** the "another model" picker: the providers and models Studio is set up with (engine.modelChoices) */
  const modelPicker = () => { const c = engine.modelChoices(); return c.length ? { select: c } : { note: true, noteLabel: "provider/model, e.g. codex/gpt-5", noteLabelZh: "provider/model，例如 codex/gpt-5" }; };
  /** the step this card came from (the last finished step before it): which escalation it is */
  const cameFrom = (x: X) => [...x.run.steps].reverse().find((s) => s.node !== x.node.id && (s.state === "passed" || s.state === "failed" || s.state === "error"));
  engine.cardBodies.dispatch = (x) => ({ title: `Dispatch: ${T(x)}`, zhTitle: `派工：${ZT(x)}`, ...base(x, x.ctx.spec?.why?.join(" ") ?? "", "A worker builds it on its own branch. Checks and a fresh reviewer judge each round.", zhWhyOf(x), "worker 在自己的 branch 上做；每一輪由檢查和全新的 reviewer 判定。"),
    body: `${specMd(x.ctx.spec)}\nRepository: ${x.ctx.repo} (${x.ctx.base}) · branch ${x.ctx.branch}\nRollback: ${x.ctx.spec?.door?.kind === "one-way" ? "a revert does not undo a one-way change; the plan round names the rollback" : "a revert undoes it"}`,
    options: [{ id: "dispatch", label: "A · Dispatch", labelZh: "A · 派工", primary: true }, { id: "rescope", label: "B · Rescope", labelZh: "B · 調整範圍", note: true, noteLabel: "What the new scope adds or removes", noteLabelZh: "新範圍要加入或移除什麼" }, { id: "drop", label: "D · Drop", labelZh: "D · 放棄" }] });
  engine.cardBodies.door = (x) => ({ title: `Pick the door: ${T(x)}`, zhTitle: `選門：${ZT(x)}`, ...base(x, `No list can sort this scope: ${(x.ctx.door?.reasons ?? []).map((r: any) => r.path).join(", ") || "the scope paths"}.`, "Pick one-way or two-way.", "沒有清單能分類這個範圍。", "選單向門或雙向門。"),
    body: `No list can classify this scope:\n${(x.ctx.door?.reasons ?? []).map((r: any) => `- ${r.path}: ${r.why}`).join("\n")}`, options: [{ id: "two-way", label: "Two-way (a revert undoes it)", labelZh: "雙向門（revert 可以還原）" }, { id: "one-way", label: "One-way", labelZh: "單向門" }] });
  engine.cardBodies.budget = (x) => { const n = x.run.nodes.build?.visits ?? 0;
    return { title: `${n} rounds ran and checks still fail: more rounds or a smaller scope? ${T(x)}`, zhTitle: `跑了 ${n} 輪檢查仍未通過：要再給幾輪，還是縮小範圍？${ZT(x)}`,
      ...base(x, `The round cap is reached after ${n} rounds. ${failingEn(x)}`, "Add 2 rounds, narrow the scope, or park the run.", `輪數上限已到，已跑 ${n} 輪。${failingZh(x)}`, "多給 2 輪、縮小範圍，或暫停這個 run。"),
      body: `${n} rounds ran and it is still not green.\n\nStill failing:\n${failingList(x) || "- (no check named a failure)"}`,
      options: [{ id: "extend", label: "Continue: 2 more rounds", labelZh: "繼續：再給 2 輪", primary: true }, { id: "rescope", label: "Narrow the scope", labelZh: "縮小範圍", note: true, noteLabel: "What to drop from the scope", noteLabelZh: "要從範圍拿掉什麼" }, { id: "park", label: "Park the run", labelZh: "暫停這個 run" }] }; };
  engine.cardBodies["step-back"] = (x) => {
    // a review still without a verified verdict after its retry stops on the captain here too (architecture §3.3), never a failed run
    // which round "another model" reruns (the designer's own swap reads this; the review's ignores a design step-back)
    x.ctx.stepBackFor = x.ctx.reviewUnverified ? "review" : x.ctx.designUnverified ? "design" : "class";
    // a designer still without a verdict after its retry (design-unverified): another model reruns the designer, never the review
    if (!x.ctx.reviewUnverified && x.ctx.designUnverified) { const why = String(x.ctx.designUnverified);
      return { title: `The designer gave no verdict: retry on another model? ${T(x)}`, zhTitle: `設計審查沒有給出結論：換一個模型重來嗎？${ZT(x)}`,
        ...base(x, `The designer review failed twice without a verdict: ${why.slice(0, 300)}`, "Retry the design review with another model, rescope the spec, or park the run.",
          `設計審查連續兩次沒有給出結論：${why.slice(0, 300)}`, "換一個模型重新做設計審查、調整規格範圍，或暫停這個 run。"),
        body: `The designer gave no verdict after its retry.\n\n${why}`,
        options: [{ id: "other-model", label: "Retry the design review with another model", labelZh: "換一個模型重新做設計審查", ...modelPicker(), primary: true }, { id: "rescope", label: "Rescope the spec", labelZh: "調整規格範圍", note: true, noteLabel: "What the new scope adds or removes", noteLabelZh: "新範圍要加入或移除什麼" }, { id: "park", label: "Park the run", labelZh: "暫停這個 run" }] }; }
    if (x.ctx.reviewUnverified) { const refused = x.ctx.reviewUnverified; const err = refused;
      return { title: `${refused ? "The reviewer would not verify its claims" : "The reviewer gave no verdict"}: retry on another model? ${T(x)}`, zhTitle: `${refused ? "reviewer 不肯先驗證就下判定" : "reviewer 沒有給出判定"}：換一個模型重來嗎？${ZT(x)}`,
        ...base(x, refused ? "Twice the reviewer gave a verdict without running the tests and reading every changed file, and the verdict was refused both times." : `The review failed twice: ${err.slice(0, 300)}`,
          "Retry the review with another model, rescope the spec, or drop the run.",
          refused ? "reviewer 兩次都沒跑測試、也沒讀完改動的檔案就下判定，兩次都被拒絕。" : `審查連續失敗兩次：${err.slice(0, 300)}`, "換一個模型重新審查、調整規格範圍，或放棄這個 run。"),
        body: refused ? `The reviewer's verdict was refused after its retry.\n\n${refused}` : `The review failed after its retry: ${err}`,
        options: [{ id: "other-model", label: "Retry the review with another model", labelZh: "換一個模型重新審查", ...modelPicker(), primary: true }, { id: "rescope", label: "Rescope the spec", labelZh: "調整規格範圍", note: true, noteLabel: "What the new scope adds or removes", noteLabelZh: "新範圍要加入或移除什麼" }, { id: "park", label: "Drop the run", labelZh: "放棄這個 run" }] }; }
    const r = x.ctx.refine?.fix; const last = r?.history?.at(-1); const cls = (last?.repeated ?? []).join(", ") || "the same check";
    return { title: `The same failure twice: rethink the scope or try once more? ${T(x)}`, zhTitle: `同一類失敗連續兩次：重新界定範圍，還是再試一次？${ZT(x)}`,
      ...base(x, `${cls} failed in two rounds in a row; a third try the same way is unlikely to work. ${failingEn(x)}`, "Question the design: rescope, or allow one more round.", `${cls} 連續兩輪失敗，照原方式再試一次多半沒用。${failingZh(x)}`, "重新思考設計：調整範圍，或再給一輪。"),
      body: `${cls} failed in two rounds in a row. A third try the same way is unlikely to work: question the design.\n\nStill failing:\n${failingList(x) || "- (no check named a failure)"}`,
      options: [{ id: "rescope", label: "Rethink: rescope the spec", labelZh: "重新思考：調整規格範圍", note: true, noteLabel: "What the new scope adds or removes", noteLabelZh: "新範圍要加入或移除什麼", primary: true }, { id: "continue", label: "One more round as is", labelZh: "照原樣再給一輪" }, { id: "park", label: "Park the run", labelZh: "暫停這個 run" }] }; };
  // the designer's capture gap, after Firstmate escalated it (design-gap → design-gap-card)
  engine.cardBodies["design-gap"] = (x) => { const g = x.ctx.designGap ?? {}; const fm = g.firstmate ?? {};
    return { title: `Design review has no captures: ${T(x)}`, zhTitle: `設計審查沒有截圖：${ZT(x)}`, captainOnly: true,
      ...base(x, `${g.message ?? "The designer has no captures of this change."} Firstmate escalated it (${fm.why ?? "no reason"}): ${fm.reason ?? ""}`, "Capture again once it is fixed, rescope the spec, or park the run.",
        `這個改動碰到 UI，repository 也宣告了 app，但設計審查沒有截圖，無法開始。Firstmate 轉給你（${fm.why ?? "沒有理由"}）：${fm.reason ?? ""}`, "修好後重新截圖、調整規格範圍，或暫停這個 run。"),
      body: `${g.code}: ${g.message}\nExpected: ${g.expected}\nMissing:\n${(g.missing ?? []).map((m: string) => `- ${m}`).join("\n")}\nFirstmate (${fm.why}): ${fm.reason}`,
      options: [{ id: "recapture", label: "Fixed: capture again", labelZh: "已修好：重新截圖", primary: true }, { id: "rescope", label: "Rescope the spec", labelZh: "調整規格範圍", note: true }, { id: "park", label: "Park the run", labelZh: "暫停這個 run" }] }; };
  engine.cardBodies.stalled = (x) => ({ title: `No progress for 2 rounds: rescope or one more round? ${T(x)}`, zhTitle: `兩輪沒有進展：調整範圍，還是再給一輪？${ZT(x)}`,
    ...base(x, `The checks' score did not rise for two rounds. ${failingEn(x)}`, "Rescope, allow one more round, or park.", `檢查分數兩輪沒有上升。${failingZh(x)}`, "調整範圍、再給一輪，或暫停。"),
    body: `The checks' score did not improve for two rounds.\n\nStill failing:\n${failingList(x) || "- (no check named a failure)"}`,
    options: [{ id: "rescope", label: "Rescope the spec", labelZh: "調整規格範圍", note: true, noteLabel: "What the new scope adds or removes", noteLabelZh: "新範圍要加入或移除什麼", primary: true }, { id: "continue", label: "One more round", labelZh: "再給一輪" }, { id: "park", label: "Park the run", labelZh: "暫停這個 run" }] });
  const rescopeOpts = [{ id: "rescope", label: "Rescope the spec", labelZh: "調整規格範圍", note: true, noteLabel: "What the new scope adds or removes", noteLabelZh: "新範圍要加入或移除什麼", primary: true }, { id: "park", label: "Park the run", labelZh: "暫停這個 run" }];
  engine.cardBodies.scope = (x) => { const perm = x.node.id === "scope-card" && !x.run.nodes.build?.data?.report ? (x.ctx.envGaps ?? []).filter((g: any) => g.route === "captain") : [];
    // an environment gap only the captain can close: a permission (a host the round sandbox may reach), never an error; Firstmate cannot grant it
    if (perm.length) return { title: `Permission needed before the build starts: grant it? ${T(x)}`, zhTitle: `開工前需要授權：要授權嗎？${ZT(x)}`, direct: true, ...base(x, `The build needs a permission only you can grant before it starts: ${perm.map((g: any) => g.message).join("; ").slice(0, 400)}`, "Grant it in the project's policy, then rescope to check again; or park the run.", "開工前需要只有你能給的授權。", "在專案 policy 裡授權後選「調整範圍」重新檢查；或暫停這個 run。"),
      body: perm.map((g: any) => `${g.code}: ${g.message}\n→ ${g.expected}`).join("\n\n"), options: rescopeOpts };
    // which escalation this is: the worker stopped on its scope, the plan found an open decision, or the spec / plan did not converge
    const from = cameFrom(x); const rep = from?.node === "build" ? x.run.nodes.build?.data?.report : null;
    if (rep?.marker === "SCOPE-BLOCKED") { const files = (rep.conflicts ?? []).map((c: any) => c.path).filter(Boolean);
      return { title: `The worker is blocked by the scope: widen it or narrow the change? ${T(x)}`, zhTitle: `worker 被範圍擋住：要放寬範圍，還是縮小改動？${ZT(x)}`,
        ...base(x, `The worker stopped: the change needs work outside the approved scope (${scopeIn(x).join(", ") || "no paths"}). It said: ${String(rep.summary ?? "").slice(0, 400)}`, "Rescope the spec to include what it needs, or to drop that part; or park the run.",
          `worker 停下來了：這個改動需要動到核准範圍（${scopeIn(x).join("、") || "沒有路徑"}）以外的地方。`, "調整規格範圍，把需要的部分加進來或拿掉；或暫停這個 run。"),
        body: `The worker stopped on round ${from?.visit ?? "?"}: the change needs work outside the approved scope.\n\nThe worker said: ${String(rep.summary ?? "").slice(0, 1200)}${files.length ? `\n\nFiles: ${files.join(", ")}` : ""}`, options: rescopeOpts }; }
    // a round stopped before it could finish (build, or any round blocked before its agent: a remote it cannot read,
    // a conflict it cannot resolve …): its own words say why
    if (from && (from.node === "build" || from.outcome === "blocked")) { const n = x.run.nodes[from.node], name = from.node === "plan-accept" ? "plan decision" : from.node;
      const said = String(n?.data?.report?.summary ?? n?.error ?? n?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || "the round gave no reason";
      return { title: `The ${name} round is blocked: rescope or park? ${T(x)}`, zhTitle: `${name} 回合被擋住了：要調整範圍還是暫停？${ZT(x)}`,
        ...base(x, `The ${name} round stopped before it could finish: ${said}`, "Fix what blocks it, then rescope to prepare again; or park the run.", `${name} 回合在完成前停下來了。`, "排除阻擋的原因後選「調整範圍」重新準備；或暫停這個 run。"),
        body: `The ${name} round (round ${from.visit ?? "?"}) stopped before it could finish.

${said}`, options: rescopeOpts }; }
    if (from?.node === "plan-accept" && x.ctx.planDecision) return { title: `The plan needs a decision the spec does not settle: ${T(x)}`, zhTitle: `計畫需要一個 spec 沒有決定的選擇：${ZT(x)}`,
      ...base(x, `The plan round found a decision the spec does not settle: ${String(x.ctx.planDecision.note ?? "").slice(0, 400)}`, "Rescope the spec to settle it, or park the run.", "計畫回合找到一個 spec 沒有決定的選擇。", "調整規格範圍把它定下來，或暫停這個 run。"),
      body: `The plan round could not accept the plan: ${String(x.ctx.planDecision.note ?? "").slice(0, 1200)}`, options: rescopeOpts };
    const loop = from?.node === "plan-fix" ? "plan" : "spec"; const why = from?.outcome === "door-change" ? "a change of door (one-way or two-way)" : from?.outcome === "cap" ? "the round cap" : from?.outcome === "stalled" ? "no progress for two rounds" : "the same failure twice";
    return { title: `The ${loop} did not pass its checks: rescope it? ${T(x)}`, zhTitle: `${loop === "plan" ? "計畫" : "規格"}沒有通過檢查：要調整範圍嗎？${ZT(x)}`,
      ...base(x, `The ${loop} stopped on ${why}. ${failingEn(x, loop)}`, "Rescope the spec, or park the run.", `${loop === "plan" ? "計畫" : "規格"}停住了。${failingZh(x, loop)}`, "調整規格範圍，或暫停這個 run。"),
      body: `The ${loop} stopped on ${why}.\n\nStill failing:\n${failingList(x, loop) || "- (no check named a failure)"}`, options: rescopeOpts }; };
  /** The merge card of a GitHub Task whose project has no operations grant: the open pull request, merged by the captain on GitHub. */
  const mergeOnGitHubBody = (pr: any, policy?: RequiredPolicy): Body => ({ title: `Pull request #${pr.id} is open: merge it on GitHub`, zhTitle: `Pull request #${pr.id} 已開：請到 GitHub 合併`, captainOnly: true,
    en: { why: `PR #${pr.id} is open at ${pr.url}. Merging from Studio is off for this project, so merge it on GitHub.`, how: "Merge the pull request on GitHub, then close this Task here; or request changes for another round." },
    zh: { why: `PR #${pr.id} 已在 ${pr.url} 開好。這個專案在 Studio 裡合併是關閉的，請到 GitHub 合併。`, how: "到 GitHub 合併這個 pull request，再回來關閉這個任務；或要求修改，再跑一輪。" },
    // each language its own line (and literal): the zh rule reads the Chinese line alone
    body: [`PR #${pr.id} is open at ${pr.url}; merging from Studio is off, so merge it on GitHub.`, `PR #${pr.id} 已開在 ${pr.url}；Studio 不合併，請到 GitHub 合併。`, "", `Branch: ${pr.branch} → ${pr.base} at ${pr.head}`, ...(policy?.observed ? ["", observedNotice(policy)!.en, observedNotice(policy)!.zh] : [])].join("\n"),
    links: [{ label: `Pull request #${pr.id}`, href: pr.url }],
    options: [{ id: "close", label: "Close here (I merge on GitHub)", labelZh: "在這裡關閉（我到 GitHub 合併）", primary: true, hold: true }, { id: "changes", label: "Request changes", labelZh: "要求修改", note: true, hold: true }] });
  engine.cardBodies.merge = async (x) => {
    let remoteIntent: RemoteMergeIntent | undefined;
    let assertRemoteCard: (() => void) | undefined;
    if (x.ctx.pr?.adapter === "github") {
      const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x); assertRemoteCard=phase.assert;
      let policy: RequiredPolicy | undefined;
      try { if (!(a instanceof GitHubPrAdapter)) throw new Error(); await reconcile(a, x.ctx.pr, phase.signal); phase.assert(); policy = await requiredPolicy(a, phase.signal); phase.assert(); if (x.ctx.remoteCI?.head !== x.ctx.pr.head || x.ctx.remoteCI?.policyHash !== policy.hash || x.ctx.remoteCI?.grant !== grantIdentity(a) || (await inspectRemote(a, x.ctx.pr, policy, phase.signal)).state !== "pass") throw new Error(); }
      catch { phase.assert(); return remoteStopBody("authoritative PR, head or required CI no longer matches; merge refused"); }
      phase.assert();
      // no operations grant (merging from Studio is off by design): the pull request is open and merges on GitHub
      let mergeOff = false; try { (a as GitHubPrAdapter).operationGrant(); } catch { mergeOff = true; }
      if (mergeOff) return mergeOnGitHubBody(x.ctx.pr, policy);
      try { (a as GitHubPrAdapter).operationGrant(); assertMergeAvailable(a as GitHubPrAdapter,x.ctx.pr,x.dir); const p = await (a as GitHubPrAdapter).mutationState(x.ctx.pr,phase.signal,phase.assert); phase.assert(); if (p.base?.sha !== x.ctx.baseCommit || p.draft !== false || p.mergeable !== true || p.mergeable_state !== "clean") throw new Error(); remoteIntent={version:1,grant:grantIdentity(a as GitHubPrAdapter),repository:(a as GitHubPrAdapter).grant.repository,pr:x.ctx.pr.id,branch:x.ctx.pr.branch,base:x.ctx.pr.base,baseHead:x.ctx.baseCommit,head:x.ctx.pr.head,method:(a as GitHubPrAdapter).operationGrant().mergeMethod,policyHash:x.ctx.remoteCI.policyHash}; }
      catch { phase.assert(); return remoteStopBody("remote merge grant or CLEAN/non-draft state is unverified"); }

    }
    const wt = x.ctx.worktree; const stat = wt && existsSync(wt) ? git(wt, ["diff", "--stat", `${x.ctx.baseCommit}..HEAD`]).out : "";
    const gates = engine.ledger(x.run.id).filter((e) => e.check.startsWith("firstmate/gate-") && e.check !== "firstmate/gate-design").slice(-6).map((e) => `${e.verdict === "pass" ? "✓" : "✗"} ${e.check.replace("firstmate/gate-", "")}: ${(e as any).data?.detail ?? e.findings[0]?.message ?? ""}`).join("\n");
    const one = x.ctx.door?.door === "one-way"; const sp = ledgerSplit(x);
    // the captain's binding changes outrank the done lines; the review on this head names the lines they supersede
    const am = engine.amendments(x.run); const lastReview = (x.ctx.reviews ?? []).at(-1);
    const sup = new Map<number, number>(((lastReview?.head === x.ctx.head ? lastReview?.superseded : null) ?? []).map((y: any) => [y.done - 1, y.amendment]));
    const supEn = (i: number) => sup.has(i) ? ` — reviewer: superseded by A${sup.get(i)}` : "", supZh = (i: number) => sup.has(i) ? `（reviewer 判定：已由 A${sup.get(i)} 取代）` : "";
    const amendText = am.length ? `Captain's binding changes (they outrank the done lines below):\n${am.map((m) => `A${m.n}. ${m.note} (card ${m.card})`).join("\n")}\n\n` : "";
    const walk = x.ctx.spec?.explain?.en ?? "";
    // the app's before / after captures of the head being merged (firstmate/ui-captures), and the head's build to click around
    const cap = x.ctx.captures && !x.ctx.captures.skipped && x.ctx.captures.head === (x.ctx.gatedHead ?? x.ctx.head) ? x.ctx.captures : null;
    const captures = cap ? cap.pages.map((p: any) => ({ label: p.label, before: p.before, after: p.after, changed: p.changed ?? null })) : null;
    const seen = cap ? `\n\nBefore / after (the app, base → head):\n${cap.pages.map((p: any) => `- ${p.label}: ${p.changed && (p.changed.removed.length || p.changed.added.length) ? `${p.changed.removed.slice(0, 4).join(", ") || "—"} → ${p.changed.added.slice(0, 4).join(", ") || "—"}` : p.built?.after === false ? "the page did not build on the head" : "no visible text changed"}`).join("\n")}${cap.app ? "\nOpen the app: the head's build, linked on this card." : ""}` : "";
    const detail = await mergeCardDetail(x, stat);
    assertRemoteCard?.();
    if(remoteIntent){const {version,repository,pr,branch,head,base,baseHead,method,grant}=remoteIntent;detail.remoteTarget={version,repository,pr,branch,head,base,baseHead,method,grant};}
    else delete detail.remoteTarget;

    // the zh-TW sections read from the detail: a line the coordinator did not translate stays English and is marked
    const UNTR = "（未翻譯）"; const zl = (l: { en: string; "zh-TW": string; untranslated?: boolean }) => (l.untranslated ? `${l.en}${UNTR}` : l["zh-TW"]);
    const b0 = base(x, x.ctx.spec?.why?.join(" ") ?? "", one ? `One-way: confirm the door to merge. Walk: ${walk}` : x.ctx.pr?.adapter === "github" ? "Merge the verified PR head remotely; the source checkout stays untouched." : "Merge lands one curated commit on the base branch locally.", detail.why.map(zl).join(" "), one ? `單向門：請確認門再合併。說明：${x.ctx.spec?.explain?.["zh-TW"] ?? ""}` : x.ctx.pr?.adapter === "github" ? "合併已驗證的遠端 PR 版本；來源工作目錄保持不變。" : "合併會在本地 base branch 落下一個整理過的 commit。", { ba: stat });
    b0.zh.done = detail.done.map((d, i) => zl(d.text) + supZh(i));
    if (sup.size) { b0.en.done = b0.en.done.map((d: string, i: number) => d + supEn(i));
      detail.done = detail.done.map((d, i) => sup.has(i) ? { ...d, text: { ...d.text, en: d.text.en + supEn(i), "zh-TW": d.text["zh-TW"] + supZh(i) } } : d); }
    if (am.length) detail.amendments = am.map((m) => ({ n: m.n, note: m.note, card: m.card }));
    const body:Body = { title: `Merge: ${T(x)}`, zhTitle: `合併：${ZT(x)}`, ledger: { done: engine.doneLines(x.run) }, detail, captainOnly: true, captures, links: [...(cap?.app ? [{ label: "Open the app", href: cap.app }] : []), ...(x.ctx.pr?.adapter === "github" && x.ctx.pr.url ? [{ label: `Pull request #${x.ctx.pr.id}`, href: x.ctx.pr.url }] : [])], ...b0,
      body: `Intent: ${x.run.text.split("\n")[0].slice(0, 300)}\n\n${one ? `ONE-WAY: a revert will not undo this (${(x.ctx.door?.reasons ?? []).filter((r: any) => r.list !== "trivial").map((r: any) => `${r.path}: ${r.why}`).join("; ")}). Walk: ${walk}\nTick the door confirmation to merge.\n\n` : ""}${x.ctx.pr?.adapter === "github" ? `Merge PR #${x.ctx.pr.id} (${x.ctx.pr.url}) in ${(selectedAdapter(x) as GitHubPrAdapter).grant.repository} at ${x.ctx.pr.head} into ${x.ctx.pr.base}. Method: ${(selectedAdapter(x) as GitHubPrAdapter).operationGrant().mergeMethod}. ${(selectedAdapter(x) as GitHubPrAdapter).operationGrant().mergeMethod === "rebase" ? `GitHub's rebase method lands every round commit on ${x.ctx.pr.base}, not one curated commit; squash is the preferred method.` : `One curated commit lands: "${landing(x) ?? T(x)}".`}` : `Lands one curated commit on ${x.ctx.base} in ${x.ctx.repo} with the tree of ${String(x.ctx.gatedHead ?? x.ctx.head).slice(0, 8)} (branch ${x.ctx.branch}): "${landing(x) ?? T(x)}". The round commits stay on the branch. Local only: nothing is pushed.`}\n\nBefore → after:\n${stat}\n\nSix gates:\n${gates}\n\n${amendText}Proved by checks:\n${sp.proved.map((d) => `✓ ${d.index + 1}. ${d.text} — ${d.by.map((b) => b.check).join(", ")}${supEn(d.index)}`).join("\n") || "(none)"}\n\nNeeds your eye:\n${sp.eye.map((d) => `· ${d.index + 1}. ${d.text}${d.note ? ` (${d.note})` : ""}${supEn(d.index)}`).join("\n") || "(nothing)"}${x.ctx.followups?.length ? `\n\nReviewer follow-ups:\n${x.ctx.followups.map((f: string) => `- ${f}`).join("\n")}` : ""}${seen}${designText(detail.design)}${(() => { const rv = (x.ctx.reviews ?? []).at(-1); if (!rv?.mode) return ""; return `\n\nReviewed in ${rv.mode} mode.${rv.notCovered?.length ? `\nNeeds your eye (the review did not cover):\n${rv.notCovered.map((n: string) => `· ${n}`).join("\n")}` : ""}`; })()}`,
      options: [{ id: "merge", label: "Merge", labelZh: "合併", primary: true }, { id: "changes", label: "Request changes", labelZh: "要求修改", note: true, hold: true }, { id: "close", label: "Close without merging", labelZh: "不合併，關閉", hold: true }] };
    if(remoteIntent)preparedRemoteCards.set(detail,{intent:structuredClone(remoteIntent),assert:assertRemoteCard!});
    return body;
  };
  /** the intent-aligned detail (src/domain/mergecard.ts): the run's records, the diff, and the coordinator's translations and walk notes */
  async function mergeCardDetail(x: X, stat: string) {
    const wt = x.ctx.worktree; const diff = wt && existsSync(wt) ? git(wt, ["diff", "-U3", `${x.ctx.baseCommit}..HEAD`]).out : "";
    const jobs = Object.values(x.run.nodes).flatMap((n: any) => n?.data?.jobs ?? []); const usd = jobs.reduce((a: number, j: any) => a + (Number(j?.cost?.usd) || 0), 0);
    const input: MergeInput = { run: x.run.id, intent: x.run.text, spec: x.ctx.spec, ctx: x.ctx, ledger: engine.ledger(x.run.id), doneMap: engine.doneLines(x.run), diff, stat,
      cost: { usd: jobs.some((j: any) => j?.cost?.usd != null) ? usd : null, rounds: (x.ctx.rounds ?? []).length, minutes: Math.round((Date.now() - Date.parse(x.run.createdAt)) / 60000) } };
    const fallback = mergeDetail(input);
    let detail: CardDetail = fallback;
    // the coordinator (the workflow's coordinator role) writes the zh-TW text and the walk notes; on any failure the card keeps the fallback
    let got: unknown = null;
    try {
      const role = x.run.def.roles.find((r: any) => r.id === "coordinator");
      const p = engine.deps.approvedPick?.(x.run,{...x.node,role:"coordinator"},"coordinator") ?? (role?.provider ? { provider: role.provider, model: role.model ?? null } : x.run.params.provider ? { provider: x.run.params.provider, model: x.run.params.model || null } : engine.deps.defaultProvider());
      // the coordinator's instructions, as for its agent nodes: the safety rules, its role skill, then the skills its nodes enable (in node order, once each)
      const pins = x.run.def.nodes.filter((n: any) => n.kind === "agent" && n.role === "coordinator").flatMap((n: any) => n.skills ?? []).filter((p: any, i: number, a: any[]) => a.findIndex((q: any) => q.id === p.id) === i);
      const skill = engine.instructions(x.run, role?.id, pins);
      const tools: AgentTool[] = [{ name: "card_detail", description: "The merge card's zh-TW translations and walk notes, once.", schema: COORDINATOR_TOOL_SCHEMA, run: (a) => { got = a; return { ok: true }; } }];
      const system=`${skill}\n\nYou are the coordinator (firstmate). You write the merge card the captain reads: real Traditional Chinese, plain words. Call card_detail exactly once, then answer in one line.`;
      const selected=engine.deps.selectProvider ? await engine.deps.selectProvider(x,p,{role:"coordinator",explicit:true}) : engine.deps.provider(p.provider,p.model??undefined);
      const rules=new OperatingRules(engine.deps.dataDir).section(x.run.params?.project||null);
      const admissionReceipt=engine.deps.instructionReceipt?.(x,"coordinator",jobInstructions(system,rules),selected);
      await engine.deps.agents.run({ kind: "card:merge", title: `${x.run.id} merge card detail`, system,
        text: coordinatorText(fallback), tools, admissionReceipt, provider: selected, ref: x.run.id, project: x.run.params?.project || null, rules, receiptFor: (r: any) => engine.deps.instructionReceipt?.(x,"coordinator",jobInstructions(system,r),selected), maxTools: 3, timeoutMs: 5 * 60_000, sandbox: engine.roundSandbox(x, null, "merge-card") } as any);
      // its answer is checked against the schema here, inside the guard: a malformed one keeps the fallback
      const { rejected, ...d } = coordinatorDetail(input, got); if (rejected) x.log(`merge card: the coordinator's answer was malformed (${rejected}); zh-TW stays marked untranslated`);
      detail = d;
    } catch (e: any) { x.log(`merge card: the coordinator could not write the detail (${String(e?.message ?? e).slice(0, 200)}); zh-TW stays marked untranslated`); }
    return detail;
  }
  return { adapter };
}

export function specMd(s: any): string {
  if (!s) return "(no spec yet)\n";
  return `# ${s.title}\n\nWhat: ${s.what}\n\nWhy:\n${(s.why ?? []).map((w: string) => `- ${w}`).join("\n")}\n\nDone when:\n${(s.done ?? []).map((d: string, i: number) => `${i + 1}. ${d}`).join("\n")}\n\nScope: ${(s.scope ?? []).join(", ")}\nRead/verification only (no write authority): ${(s.verificationScope ?? []).join(", ")}\nDoor: ${s.door?.kind ?? "?"}${s.door?.reason ? ` (${s.door.reason})` : ""}\n${s.explain?.en ? `\nExplain: ${s.explain.en}\n` : ""}`;
}
export { locatorText };
