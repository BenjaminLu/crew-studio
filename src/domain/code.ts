import { installCodeQueue } from "./code-queue";
import {GitHubPoller} from '../github-poller';
// The coding pipeline's runtime side (packs/firstmate, docs/code-firstmate-pipeline.md):
// a local git repository, a worktree on <branch_prefix><run>, the spec (what, why,
// done, scope, door, explain), the door, a plan round for one-way changes, build
// and fix rounds with a local brief bound to round + head, and what the
// firstmate pack's checks need: the diff, the base tree for fail-first, the
// repository's declared commands, the gate state. Natives here are checks that
// read Studio's own state (overlap, door, scope, the six gates). GitHub publication is opt-in through an approved project remote grant.
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
import { briefFor } from "../runtime/refine";
import { sandboxed } from "../runtime/checks";
import { RoundBlocked, Worktrees } from "../worktrees";
import { runRender } from "../render";
import { copyUntrusted } from "../secure";
import { helper, kindOf, LINES_PER_READ, LIST_CAP, listTree, normPath, READ_CAP_BYTES, searchTree, typedRead } from "../review-read";
import { COORDINATOR_TOOL_SCHEMA, coordinatorDetail, coordinatorText, mergeDetail, type MergeInput } from "./mergecard";
import { RemoteWatchers, requiredPolicy, reconcile, inspectRemote, grantIdentity, registerRemoteWait, validRemoteWait, remoteStopBody } from "./remote-ci";
import { stablePatch, proveCleanCarry, mergeOnce, updateOnce, assertMergeAvailable } from "./remote-gates";
import type { CardDetail } from "../runtime/cards";

export { git, must };

export type RepoCfg = { test: string[] | null; lint: string[] | null; shards: number; tests: string[]; timeout_s: number; fixture_lists: string[] };
export function repoCfg(dir: string): RepoCfg {
  let c: any = {}; try { c = JSON.parse(readFileSync(join(dir, ".crew", "gates.json"), "utf8")); } catch {}
  const argv = (v: any) => (Array.isArray(v) && v.length && v.every((s: any) => typeof s === "string") ? v : null);
  return { test: argv(c.test), lint: argv(c.lint), shards: Math.max(1, Math.min(8, Number(c.shards) || 1)), tests: Array.isArray(c.tests) && c.tests.length ? c.tests.map(String) : ["tests/**", "**/*.test.*", "test/**"],
    timeout_s: Number(c.timeout_s) || 180, fixture_lists: Array.isArray(c.fixture_lists) ? c.fixture_lists.map(String) : [] };
}

const READ_ONLY = (dir: string): AgentTool[] => folderTools(dir, () => {}, "fs").filter((t) => /_(list|read|search)$/.test(t.name));
export const changedOf = (wt: string, base: string): ChangedPath[] => {
  const ns = must(wt, ["diff", "--name-status", "-M", `${base}..HEAD`]).split("\n").filter(Boolean);
  const num = must(wt, ["diff", "--numstat", "-M", `${base}..HEAD`]).split("\n").filter(Boolean);
  return ns.map((l, i) => { const p = l.split("\t"); const n = num[i]?.split("\t") ?? []; return { path: p.at(-1)!, status: p[0], from: p[0].startsWith("R") ? p[1] : null, added: Number(n[0]) || 0, removed: Number(n[1]) || 0 }; });
};
const head = (wt: string) => must(wt, ["rev-parse", "HEAD"]);
const isTest = (cfg: RepoCfg, p: string) => cfg.tests.some((g) => matches(g, p));
const isDoc = (p: string) => /\.md$/i.test(p) || p.startsWith("docs/");
export const inScope = (scope: string[], p: string) => scope.some((s) => { const g = String(s).trim().replace(/^\.\//, ""); return !!g && (g === p || (g.endsWith("/") && p.startsWith(g)) || (/[*?]/.test(g) ? matches(g, p) : p.startsWith(g + "/"))); });
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
  engine.beforeNodeChecks ??= {}; engine.cardPrepared ??= {}; engine.beforeStart ??= {}; engine.externalHandlers ??= {}; engine.externalValidators ??= {};
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
    catch { if (!phase.live()) return { outcome: "cancel" }; await engine.card(x, "step-back", remoteStopBody("authoritative PR/ref changed at node start; verification stopped")); return { wait: true }; }
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
      const duration = Math.max(1000, Math.min(24 * 3600_000, Number(x.policy("remote_ci.timeout_s", 1800)) * 1000 || 1800_000));
      return { wait: true as const, external: { version: 1 as const, handler: "github-ci", grant: grantIdentity(a), repository: a.grant.repository, pr: structuredClone(x.ctx.pr), policy, startedAt, deadline: startedAt + duration, lastDigest: null }, note: "waiting for required remote CI on the exact PR head" };
    } catch { if (!phase.live()) return { outcome: "cancel" }; await engine.card(x, "step-back", remoteStopBody("remote PR or required policy could not be verified")); return { wait: true as const }; }
  };
  // one worktree per task under data/work/<project>/<task> (src/worktrees.ts); the task is the run
  const W = new Worktrees(o.dataDir, { protect: () => engine.deps.protectedRoots ?? [], egress: () => (engine.deps.agents as any).egress ?? null });
  const wkey = (x: { ctx: any; run?: any; id?: string }) => ({ project: x.ctx.wt?.project ?? "local", task: x.ctx.wt?.task ?? (x.run?.id ?? x.id) });
  const tmpTree = (run: string, what: string) => W.tmpOf(run, what);
  const held = new Map<string, () => void>();
  const cfgOf = (x: X) => repoCfg(x.ctx.worktree ?? x.ctx.repo);
  const shellOk = (x: X) => { if (!x.ctx.worktree || !existsSync(x.ctx.worktree)) throw new Error("the run's worktree is gone"); return x.ctx.worktree as string; };
  const sensitive = (x: X) => (x.policy("sensitive_paths") ?? []) as { glob: string; why: string }[];

  // ---------- what checks see ----------
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
  engine.needs.inflight = (x) => engine.list().filter((r) => r.id !== x.run.id && ["running", "waiting", "paused"].includes(r.status) && r.ctx.repo && r.ctx.repo === x.ctx.repo && r.ctx.spec?.scope).map((r) => ({ run: r.id, title: r.title, scope: r.ctx.spec.scope }));
  engine.needs.texts = (x) => { const s = x.ctx.spec; if (!s) return []; return [{ section: "title", text: s.title }, { section: "what", text: s.what }, ...s.why.map((t: string, i: number) => ({ section: `why[${i}]`, text: t })), ...s.done.map((t: string, i: number) => ({ section: `done[${i}]`, text: t.replace(/(tests?\/[\w./-]+|[\w./-]+\.test\.\w+)/g, "") })), ...(s.explain?.en ? [{ section: "explain.en", text: s.explain.en }] : []),
    // the zh-TW the cards show: checked here, at the spec, so an English or placeholder translation goes back to the coordinator before any card
    ...(s.zh?.title ? [{ section: "zh-TW.title", text: s.zh.title }] : []), ...(s.zh?.why ?? []).map((t: string, i: number) => ({ section: `zh-TW.why[${i}]`, text: t })), ...(s.explain?.["zh-TW"] ? [{ section: "zh-TW.explain", text: s.explain["zh-TW"] }] : [])]; };
  engine.needs.diff = (x) => ({ paths: changedOf(shellOk(x), x.ctx.baseCommit) });
  engine.needs.diff_text = (x) => git(shellOk(x), ["diff", "--no-color", `${x.ctx.baseCommit}..HEAD`]).out.slice(0, 24000);
  engine.needs.scope = (x) => x.ctx.spec?.scope ?? [];
  engine.needs.repo_cfg = (x) => cfgOf(x);
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
    must(x.ctx.repo, ["worktree", "add", "-q", "--detach", tmp, head(wt)]);
    for (const p of beh) { if (p.status?.startsWith("A")) rmSync(join(tmp, p.path), { force: true }); else { must(tmp, ["checkout", x.ctx.baseCommit, "--", p.from ?? p.path]); if (p.from && p.from !== p.path) rmSync(join(tmp, p.path), { force: true }); } }
    return { applicable: true, tests, behaviour: beh.map((p) => p.path), path: tmp };
  };
  engine.needs.main_tree = (x) => {
    if (!x.ctx.repo) return null; const tmp = tmpTree(x.run.id, "main"); git(x.ctx.repo, ["worktree", "remove", "--force", tmp]); rmSync(tmp, { recursive: true, force: true });
    must(x.ctx.repo, ["worktree", "add", "-q", "--detach", tmp, x.ctx.merged?.adapter === "github" ? x.ctx.merged.head : x.ctx.base]); return tmp;
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
  engine.natives.overlap = (i) => {
    const mine: string[] = i.artifact?.data?.scope ?? []; const f: any[] = [];
    for (const r of i.inflight ?? []) for (const p of mine) if (r.scope.some((q: string) => inScope([q], p.replace(/\/$/, "/x")) || inScope([p], q.replace(/\/$/, "/x")))) f.push(F({ type: "text", section: "scope" }, `${p} overlaps ${r.run} (${r.title})`, `wait for ${r.run} or narrow the scope`, "scope-overlap"));
    return { verdict: f.length ? "fail" : "pass", score: f.length ? 0 : 1, findings: f };
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
    if (!touched.length) return { skipped: "no app path changed", pages: [], head: h, app: null, rendered: false };
    const h8 = h.slice(0, 12); const dir = join(capturesOf(x.run.id), h8); rmSync(dir, { recursive: true, force: true });
    const baseTree = tmpTree(x.run.id, "capture-base"); git(x.ctx.repo, ["worktree", "remove", "--force", baseTree]); rmSync(baseTree, { recursive: true, force: true });
    must(x.ctx.repo, ["worktree", "add", "-q", "--detach", baseTree, x.ctx.baseCommit]);
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
    x.ctx.captures = { head: c.head, base: x.ctx.baseCommit, pages: c.pages, app: c.app, skipped: c.skipped, at: new Date().toISOString() };
    if (c.skipped) return { verdict: "pass", score: 1, findings: [], data: { skipped: c.skipped } } as any;
    const broken = c.pages.filter((p) => !p.built.after);
    const findings = broken.map((p) => ({ locator: { type: "file", path: ".crew/app.json" }, message: `the app page ${p.file} did not build on the head`, expected: "the app builds", class: "app-build", severity: "minor" }));
    for (const f of (c.refusedFiles ?? []).slice(0, 5)) findings.push({ locator: { type: "file", path: ".crew/app.json" }, message: `the app build's output was refused: ${f}`, expected: "the build writes regular files only", class: "app-output-refused", severity: "minor" });
    if (!c.rendered) findings.push({ locator: { type: "file", path: ".crew/app.json" }, message: "the pages were built but not shot: the headless browser is not installed (Doctor → Headless browser); the card shows the text that changed", expected: "a before / after picture of each page", class: "renderer-missing", severity: "minor" });
    return { verdict: findings.length ? "warn" : "pass", score: findings.length ? 0.5 : 1, findings,
      data: { captures: c.pages.map((p) => ({ label: p.label, before: p.before, after: p.after, changed: p.changed })), app: c.app, rendered: c.rendered, head: c.head, refusedFiles: c.refusedFiles ?? [], refusedRequests: c.refusedRequests ?? [], frames: c.frames ?? [] } } as any;
  };

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
  engine.actions["pr.open"] = async (x) => {
    const phase = remotePhase(x); phase.assert(); const wt = shellOk(x); const h = head(wt);
    const adapter = selectedAdapter(x);
    if (adapter instanceof GitHubPrAdapter && !adapter.branchAllowed(x.ctx.branch,h)) return namingCard(x,adapter,h);
    const title = x.ctx.spec?.title ?? x.run.title;
    const rollback = x.ctx.spec?.rollback ?? (x.ctx.door?.door === "one-way" ? "A revert does not undo this change; the approved plan must name the rollback." : "Revert the change to undo it.");
    const body = specMd(x.ctx.spec) + `\n\n## Door\n${x.ctx.door?.door ?? "undecided"}\n\n## Rollback\n${rollback}`;
    if (x.ctx.pr && x.ctx.pr.adapter !== adapter.id) throw new Error("review adapter authority changed; resolve the existing review request before publishing");
    if (x.ctx.pr) { const published = await adapter.update({ ...x.ctx.pr, title, body }, h, x.dir, phase.signal,phase.assert); phase.assert(); x.ctx.pr = published; x.rn.note = `review request at ${h.slice(0, 8)}`; return remoteWait(x, adapter); }
    const published = await adapter.open({ repo: x.ctx.repo, base: x.ctx.base, branch: x.ctx.branch, head: h, title, body }, x.dir, phase.signal,phase.assert); phase.assert(); x.ctx.pr = published;
    x.rn.note = `review request on ${x.ctx.branch} (${adapter.id})`; return remoteWait(x, adapter);
  };
  engine.actionAnswers ??= {};
  engine.actionAnswers["pr.open"] = async (x,card) => {
    if (card.answer?.choice !== "approve-name") return { outcome: card.answer?.choice ?? "close" };
    const n = x.ctx.remoteNaming;
    if (n?.version !== 2 || n.card !== card.id || n.head !== head(shellOk(x)) || n.branch !== x.ctx.branch || !card.captainOnly) throw new Error("naming approval no longer matches publication");
    const result = await engine.actions["pr.open"](x); return typeof result === "string" ? { outcome: result } : result;
  };
  engine.actionAnswers["remote.ready"] = async (x,card) => {
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
    if (x.ctx.pr?.adapter !== "github") return "ok";
    const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x);
    if (!(a instanceof GitHubPrAdapter)) throw new Error("remote adapter changed");
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
      const old = x.ctx.pr, key = wkey(x); const round = await W.startRound(key.project,key.task,`${x.run.id}/remote-ready#${x.visit}`,{write:true,install:null}); release=round.release;phase.assert();if(round.head!==old.head)throw new Error("task head moved before update");
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
  engine.actions["git.merge"] = async (x) => {
    if (x.ctx.pr?.adapter === "github") {
      const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x), h = head(shellOk(x));
      const answer: any = engine.trusted(x.run.id).entries.filter(e => e.record === "card-answer" && e.data?.kind === "merge" && e.data?.choice === "merge").at(-1);
      if (!(a instanceof GitHubPrAdapter) || !engine.trusted(x.run.id).ok || !answer?.data?.card || answer.head !== h || h !== x.ctx.gatedHead || h !== x.ctx.pr.head || (x.ctx.door?.door === "one-way" && answer.data.confirm !== "one-way")) throw new Error("bound captain merge intent required");
      const trusted = engine.trusted(x.run.id);
      const intent:any=trusted.entries.filter(e=>e.record==="remote-merge-request"&&e.data?.card===answer.data.card).at(-1);
      if(!intent||intent.head!==h||intent.data.head!==h||intent.data.version!==1||intent.data.grant!==grantIdentity(a)||intent.data.repository!==a.grant.repository||intent.data.pr!==x.ctx.pr.id||intent.data.branch!==x.ctx.pr.branch||intent.data.base!==x.ctx.pr.base||intent.data.baseHead!==x.ctx.baseCommit||intent.data.method!==a.operationGrant().mergeMethod||intent.data.policyHash!==x.ctx.remoteCI?.policyHash)throw new Error("remote captain card target/grant/method changed; fresh intent required");

      if (!["branch","rebase","scope","failfirst","ci","approval"].every(name => { const e = trusted.entries.filter(e => e.check === `firstmate/gate-${name}`).at(-1); return e?.head === h && e.verdict === "pass"; })) throw new Error("six signed exact-head gates required");
      const policy = await requiredPolicy(a,phase.signal); phase.assert();
      if ((await inspectRemote(a,x.ctx.pr,policy,phase.signal)).state !== "pass" || x.ctx.remoteCI?.head !== h || x.ctx.remoteCI?.policyHash !== policy.hash || x.ctx.remoteCI?.grant !== grantIdentity(a)) throw new Error("remote checks changed before merge"); phase.assert();
      const result = await mergeOnce(a,x.ctx.pr,x.dir,answer.data.card,phase.signal,x.ctx.baseCommit,phase.assert); phase.assert();
      await a.importHeads(x.ctx.pr,phase.signal); phase.assert(); x.ctx.merged = { ...result, adapter: "github", at: new Date().toISOString() }; x.save(); return "ok";
    }
    if (x.ctx.project && o.projects.get(x.ctx.project)?.github) throw new Error("remote project has no verified PR; local merge disabled");
    const wt = shellOk(x); const h = head(wt); const repo = x.ctx.repo, base = x.ctx.base;
    if (x.ctx.door?.door === "one-way" && x.ctx.answers?.["merge-card"]?.confirm !== "one-way") throw new Error("a one-way change needs the door confirmation on the merge card");
    if (x.ctx.gatedHead && h !== x.ctx.gatedHead) throw new Error("the branch moved since the six gates ran");
    if (!git(repo, ["merge-base", "--is-ancestor", base, h]).ok) throw new Error(`${base} moved since the gates ran: it no longer fast-forwards`);
    const cur = git(repo, ["symbolic-ref", "--short", "HEAD"]).out;
    if (cur === base) { if (git(repo, ["status", "--porcelain", "--untracked-files=no"]).out) throw new Error(`${repo} has uncommitted changes on ${base}`); must(repo, ["merge", "--ff-only", "-q", h]); }
    else must(repo, ["update-ref", `refs/heads/${base}`, h, must(repo, ["rev-parse", base])]);
    x.ctx.merged = { base, head: h, at: new Date().toISOString() }; x.ctx.head = h;
    if (must(repo, ["rev-parse", `refs/heads/${base}`]) !== h) throw new Error("actual local merge head does not match reviewed head");
    engine.record(x, "native-merge", { head: h, data: { version: 1, project: engine.queueProject(x.run), repo: engine.queueRepo(repo), base, head: h } });
    x.rn.note = `${base} fast-forwarded to ${h.slice(0, 8)} (local)`; return "ok";
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
  const beginRound = (write: boolean, skipInstall = false) => async (x: X) => {
    if (!x.ctx.wt) return;
    const k = wkey(x); const install = x.policy("install");
    let s: Awaited<ReturnType<typeof W.startRound>>;
    try { s = await W.startRound(k.project, k.task, holder(x), { write, skipInstall, install: Array.isArray(install) ? install.map(String) : null, scripts: x.policy("install_scripts") === true,
      allow: ([] as any[]).concat(x.policy("egress.allow", []) ?? []).map(String) }); }
    catch (e: any) { if (e instanceof RoundBlocked) { x.rn.data.report = { marker: "BLOCKED", summary: e.message, round: x.visit }; x.save(); } throw e; }
    held.set(holder(x), s.release);
    try { x.ctx.head = s.head;
    const rebase=x.ctx.remoteRebaseApproved;
    if(write && x.node.id==="build" && rebase?.version===1 && !rebase.started){
      const trusted=engine.trusted(x.run.id);if(!trusted.ok||!trusted.entries.some(e=>e.record==="rebase-request"&&e.data?.card===rebase.card&&e.data?.base===rebase.base&&e.data?.fromBase===rebase.fromBase&&e.head===rebase.head)||!trusted.entries.some(e=>e.record==="card-answer"&&e.data?.card===rebase.card&&e.data?.choice==="rebase"))throw new Error("native rebase has no bound signed captain decision");
      if(s.head!==rebase.head||x.ctx.pr?.head!==rebase.head)throw new Error("approved rebase head changed");
      const result=W.startNativeRebase(k.project,k.task,rebase.head,rebase.fromBase,rebase.base);rebase.started=true;x.ctx.head=result.head;x.ctx.baseCommit=rebase.base;x.save();
    }
    const b = briefFor(x);
    engine.record(x, "round-start", { head: s.head, data: { round: x.visit, brief: b?.id ?? null, ledger: b?.ledger ?? [], corrected: s.corrected, deps: s.deps.ran?.join(" ") ?? null } } as any);
    if (s.corrected) x.log(`round ${x.visit}: ${s.corrected.reason}; ${s.corrected.kept ? `kept on ${s.corrected.kept}` : "nothing to keep"}`);
    } catch (e) { held.delete(holder(x)); s.release(); throw e; }
  };
  const endRound = (x: X, how: string) => {
    if (!x.ctx.wt) return; const k = wkey(x);
    try { if (how !== "done" && how !== "timeout") { const kept = W.endRound(k.project, k.task, `${x.node.id} round ${x.visit} ${how}`); if (kept) x.log(`round ${x.visit} ${how}: its work kept on ${kept}`); } }
    finally { held.get(holder(x))?.(); held.delete(holder(x)); }
  };
  const roundHooks = (write: boolean, skipInstall = false) => ({ begin: beginRound(write, skipInstall), end: endRound });

  // ---------- agent modes ----------
  const specTool = (x: X): AgentTool => ({ name: "spec_write", description: "Write the spec, once: title, what, why, the done lines (each names the test file that proves it and says it fails on base), the scope (paths the change may touch, including every caller), the door (one-way when it touches a sensitive path), a plain explain block in en and zh-TW, and zh: the title and the why written in Traditional Chinese (a real translation, not a placeholder; code names and paths stay as they are).",
    schema: { type: "object", properties: { title: { type: "string" }, what: { type: "string" }, why: { type: "array", items: { type: "string" } }, done: { type: "array", items: { type: "string" } }, scope: { type: "array", items: { type: "string" } },
      door: { type: "object", properties: { kind: { type: "string", enum: ["one-way", "two-way"] }, reason: { type: "string" } }, required: ["kind", "reason"] }, explain: { type: "object", properties: { en: { type: "string" }, "zh-TW": { type: "string" } } },
      zh: { type: "object", properties: { title: { type: "string" }, why: { type: "array", items: { type: "string" } } }, required: ["title", "why"] } }, required: ["title", "what", "why", "done", "scope", "door", "explain", "zh"] },
    run: (a) => {
      const arr = (v: any) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
      x.ctx.spec = { title: String(a.title ?? x.run.title).slice(0, 160), what: String(a.what ?? "").slice(0, 2000), why: arr(a.why).slice(0, 8), done: arr(a.done).slice(0, 12), scope: arr(a.scope).slice(0, 40),
        door: a.door && typeof a.door === "object" ? { kind: String(a.door.kind ?? ""), reason: String(a.door.reason ?? "").slice(0, 400) } : null,
        explain: a.explain && typeof a.explain === "object" ? { en: String(a.explain.en ?? "").slice(0, 2000), "zh-TW": String(a.explain["zh-TW"] ?? "").slice(0, 2000) } : null,
        zh: a.zh && typeof a.zh === "object" ? { title: String(a.zh.title ?? "").slice(0, 160), why: arr(a.zh.why).slice(0, 8) } : null, version: (x.ctx.spec?.version ?? 0) + 1 };
      writeFileSync(join(x.dir, "spec.json"), JSON.stringify(x.ctx.spec, null, 1)); writeFileSync(join(x.dir, "spec.md"), specMd(x.ctx.spec)); x.save(); return { ok: true };
    } });
  engine.modes.spec = {
    ...roundHooks(false, true), // source-only analysis needs no package installation
    sandbox: (x) => { const wt = x.ctx.worktree; return wt && existsSync(wt) ? { writes: [], reads: [wt], cwd: wt } : null; }, // reads the worktree, writes nothing of it
    tools: (x) => [...READ_ONLY(shellOk(x)), specTool(x)], maxTools: 30,
    system: (x, skill) => `${skill}\n\nYou write the spec for one change to a local repository. Read the code with the fs_* tools (read-only), then call spec_write once. Say WHAT and WHY; never HOW (no line numbers, no steps). Every done line names the test file that proves it and says it fails on base. Write in plain English: no will/should/could, no "ensure", "utilize", "via", "etc.". Answer in one line when done.`,
    prompt: (x) => { const b = briefFor(x, "spec"); const note = x.ctx.answers?.dispatch?.choice === "rescope" ? x.ctx.answers.dispatch.note : x.ctx.answers?.["step-back"]?.choice === "rescope" ? x.ctx.answers["step-back"].note : x.ctx.answers?.["scope-card"]?.note;
      return `SPEC DRAFT\nRun ${x.run.id} · draft ${x.visit}. Repository ${x.ctx.repo} (base ${x.ctx.base}).\nCaptain's intent:\n${x.run.text || x.run.title}\n${note ? `\nThe captain asked for changes: ${note}\n` : ""}${b && x.visit > 1 ? `\n${b.text}\nThe last draft:\n${specMd(x.ctx.spec)}\n` : ""}\nStart with fs_list.`; },
    after: (x) => { if (!x.ctx.spec || x.ctx.spec.version < x.visit) throw new Error("the spec writer did not call spec_write"); x.rn.note = `${x.ctx.spec.title}: ${x.ctx.spec.done.length} done lines, scope ${x.ctx.spec.scope.join(", ")}`; return "ok"; },
  };
  engine.modes.plan = {
    ...roundHooks(false),
    sandbox: (x) => { const wt = x.ctx.worktree; return wt && existsSync(wt) ? { writes: [], reads: [wt], cwd: wt } : null; }, // reads the worktree, writes nothing of it
    tools: (x) => [...READ_ONLY(shellOk(x)), { name: "plan_write", description: "Your plan, once: every question at once (questions block), the files you will change, and one row per done line (n from 1, the test, where it runs, how it fails on base).",
      schema: { type: "object", properties: { questions: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "object", properties: { n: { type: "number" }, test: { type: "string" }, where: { type: "string" }, fails_on_base: { type: "string" } }, required: ["n", "test", "where", "fails_on_base"] } } }, required: ["questions", "files", "rows"] },
      run: (a) => { x.ctx.plan = { questions: (a.questions ?? []).map(String).slice(0, 12), files: (a.files ?? []).map(String).slice(0, 30), rows: (Array.isArray(a.rows) ? a.rows : []).slice(0, 20), round: x.visit, head: x.ctx.head };
        writeFileSync(join(x.dir, `plan-${x.visit}.json`), JSON.stringify(x.ctx.plan, null, 1)); x.save(); return { ok: true }; } }], maxTools: 30,
    system: (x, skill) => `${skill}\n\nThis is a PLAN round for a one-way change: you change no file. Read the code, then call plan_write once with every question in the questions block, the files you will change, and a row per done line. Answer in one line.`,
    prompt: (x) => { const b = briefFor(x, "plan"); return `PLAN ROUND\nRun ${x.run.id} · round ${x.visit} · head ${x.ctx.head}\n${specMd(x.ctx.spec)}\n${x.ctx.planDecision?.accept === false ? `\nFirstmate sent the last plan back: ${x.ctx.planDecision.note}\n` : ""}${b && x.visit > 1 ? `\n${b.text}\n` : ""}\nStart with fs_list.`; },
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
    prompt: (x) => `PLAN DECISION\nRun ${x.run.id}\n${specMd(x.ctx.spec)}\n\nThe plan (round ${x.ctx.plan?.round}, head ${x.ctx.head}):\n${JSON.stringify(x.ctx.plan, null, 1)}`,
    after: (x, job) => { const d = x.ctx.planDecision; if (!d || d.round !== x.ctx.plan?.round) throw new Error("the coordinator did not decide on the plan"); d.by = `${job.provider}·${job.model}`;
      if (d.accept) writeFileSync(join(x.dir, "plan-accept.json"), JSON.stringify({ ...d, signed: `plan-accept round ${d.round} head ${d.head} by ${d.by}` }, null, 1));
      x.rn.note = d.accept ? `accepted (round ${d.round}, head ${String(d.head).slice(0, 8)}), ${d.answers.length} answers` : `${d.decision}: ${d.note}`; return d.decision; },
  };
  const briefFile = (x: X) => join(x.dir, "briefs", `round-${x.visit}.json`);
  /** Hand the round back: a commit as the agent with run, node and round trailers; the checks then run on it. */
  const commitRound = (x: X, rep: any, agent = "agent") => {
    shellOk(x); const k = wkey(x);
    const hb = W.handBack(k.project, k.task, { run: x.run.id, node: x.node.id, round: x.visit, agent,
      message: `${x.ctx.spec?.type ?? "feat"}: ${(x.ctx.spec?.title ?? x.run.title).replace(/^\w+(\([^)]*\))?:\s*/, "").replace(/^./, (c: string) => c.toLowerCase()).slice(0, 64)}${x.visit > 1 ? ` (round ${x.visit})` : ""}\n\n${rep?.summary ?? ""}` });
    x.ctx.head = hb.head;
    x.ctx.rounds = [...(x.ctx.rounds ?? []), { round: x.visit, head: x.ctx.head, report: rep, at: new Date().toISOString() }];
  };
  engine.modes.build = {
    ...roundHooks(true),
    sandbox: (x) => { const wt = x.ctx.worktree; return wt && existsSync(wt) ? { writes: [wt], cwd: wt } : null; }, // writes only its worktree
    tools: (x) => {
      const wt = shellOk(x); const cfg = cfgOf(x); let runs = 0; const reportOnly = !!x.ctx.reportOnly?.build;
      const report: AgentTool = { name: "worker_report", description: "Your report, once at the end: marker WORKER_COMPLETE, SCOPE-BLOCKED, DOOR-CHANGE or ASK; a summary; on a fix round the SWEPT block (searched, found N, fixed M) and the classes you fixed; the test that fails on base (file:line).",
        schema: { type: "object", properties: { marker: { type: "string", enum: ["WORKER_COMPLETE", "SCOPE-BLOCKED", "DOOR-CHANGE", "ASK"] }, summary: { type: "string" }, swept: { type: "object", properties: { searched: { type: "string" }, found: { type: "number" }, fixed: { type: "number" } } }, classes: { type: "array", items: { type: "string" } }, failfirst: { type: "string" } }, required: ["marker", "summary"] },
        run: (a) => { const sw = a.swept && typeof a.swept === "object" ? { searched: String(a.swept.searched ?? ""), found: Number(a.swept.found) || 0, fixed: Number(a.swept.fixed) || 0 } : null;
          x.rn.data.report = { marker: String(a.marker), summary: String(a.summary ?? "").slice(0, 1500), swept: sw, classes: (a.classes ?? []).map(String).slice(0, 20), failfirst: a.failfirst ? String(a.failfirst).slice(0, 300) : null, round: x.visit }; x.save(); return { ok: true }; } };
      if (reportOnly) return [...READ_ONLY(wt), report];
      return [...folderTools(wt, () => {}, "fs"), report,
        { name: "run_tests", description: "Run the repository's own test command in your worktree (at most 6 times per round). Returns the exit code and the last lines.", schema: { type: "object", properties: {} },
          // the repository's tests run in the check sandbox: they read the worktree, write only their own out/ and tmp, no network
          run: async () => { if (!cfg.test) return { error: "the repository declares no test command" }; if (++runs > 6) return { error: "test run limit reached" };
            const box = join(x.dir, "tests", `round-${x.visit}-${runs}`); mkdirSync(join(box, "out"), { recursive: true }); mkdirSync(join(box, "tmp"), { recursive: true });
            const r = await sandboxed(cfg.test, { cwd: wt, out: join(box, "out"), tmp: join(box, "tmp"), timeoutS: cfg.timeout_s, network: false, dataDir: o.dataDir });
            if (r.refused) return { error: `refused: ${r.refused}` };
            return { exit: r.timedOut ? null : r.code, timedOut: r.timedOut, tail: (r.stdout + r.stderr).trim().split("\n").slice(-25).join("\n") }; } }];
    },
    system: (x, skill) => x.ctx.reportOnly?.build ? `${skill}\n\nREPORT ONLY: your code from the last round is kept. Do not change any file. Read what you need and call worker_report once with a complete report, then one line.`
      : `${skill}\n\nYou build ONE change in the run's worktree with the fs_* tools (no shell; run_tests runs the repository's tests). Stay inside the spec's scope. Each done line needs a test that fails without your change. Studio commits your work; you never commit. End with worker_report, then one line.`,
    prompt: (x) => {
      const wt = shellOk(x); const h = head(wt); x.ctx.head = h;
      mkdirSync(join(x.dir, "briefs"), { recursive: true });
      const b = briefFor(x, "build");
      const rebaseNote = W.get(wkey(x).project,wkey(x).task)?.nativeRebase ? "\nNATIVE REBASE RESOLUTION: read conflict files, resolve within scope using fs tools, then worker_report. Studio continues the rebase; another round resolves any next conflict. Fresh CI and review follow.\n" : "";
      const fix = x.visit > 1 && b ? `\n${b.text}\n` : "";
      const plan = x.ctx.door?.door === "one-way" ? (() => { if (!existsSync(join(x.dir, "plan-accept.json"))) throw new Error("a one-way change needs an accepted plan before it builds"); return `\nAccepted plan:\n${JSON.stringify(x.ctx.plan?.rows ?? [])}\nAnswers:\n${(x.ctx.planDecision?.answers ?? []).map((q: any) => `- ${q.q}: ${q.a}`).join("\n")}\n`; })() : "";
      const ro = x.ctx.reportOnly?.build ? "\nREPORT ONLY: the code stays as it is; write the report the checks asked for.\n" : "";
      const text = `BUILD ROUND\nRun ${x.run.id} · round ${x.visit} · head ${h} · branch ${x.ctx.branch}\n${specMd(x.ctx.spec)}${plan}${fix}${ro}${rebaseNote}\nStart with fs_list.${x.run.text.includes("STUB_") ? `\n\nIntent notes:\n${x.run.text}` : ""}`;
      let prev: any = null; try { prev = JSON.parse(readFileSync(briefFile(x), "utf8")); } catch {}
      if (prev && prev.head !== h) x.log(`round ${x.visit} brief rebound from ${String(prev.head).slice(0, 8)} to ${h.slice(0, 8)}`);
      writeFileSync(briefFile(x), JSON.stringify({ run: x.run.id, round: x.visit, head: h, branch: x.ctx.branch, brief: text }, null, 1));
      x.rn.data.report = null;
      return text;
    },
    handoffState: (x) => { try { return "```\n" + git(shellOk(x), ["status", "--short"]).out + "\n" + git(x.ctx.worktree, ["diff", "--stat"]).out + "\n```"; } catch { return "(no worktree)"; } },
    after: (x, job) => {
      const b = JSON.parse(readFileSync(briefFile(x), "utf8"));
      if (head(shellOk(x)) !== b.head) throw new Error(`the worktree moved during the round (brief bound to ${String(b.head).slice(0, 8)})`);
      const rep = x.rn.data.report; const ro = !!x.ctx.reportOnly?.build;
      if (ro) { const k = wkey(x); const kept = W.endRound(k.project, k.task, `report-only round ${x.visit} touched files`); if (kept) x.log(`report-only round changed files: kept on ${kept}, the code stays at ${String(x.ctx.head).slice(0, 8)}`); x.ctx.reportOnly = { ...x.ctx.reportOnly, build: false }; }
      else if (!git(x.ctx.worktree, ["status", "--porcelain"]).out && (!rep || rep.marker === "WORKER_COMPLETE") && x.visit === 1) throw new Error("the worker changed nothing");
      const native=W.get(wkey(x).project,wkey(x).task)?.nativeRebase;
      if(native){const result=W.continueNativeRebase(wkey(x).project,wkey(x).task,p=>inScope(x.ctx.spec?.scope??[],p));x.ctx.head=result.head;x.save();if(result.pending){pendingRebaseChecks.add(x.rn);W.freeze(W.get(wkey(x).project,wkey(x).task)!);return "rebase-more";}}
      if(x.ctx.remoteRebaseApproved){x.ctx.remoteRebaseApproved=null;x.ctx.remoteRebaseRequired=null;x.ctx.remoteCI=null;x.ctx.reviewUnverified="native rebase requires fresh review";}
      commitRound(x, rep, `${job.provider}·${job.model}`);
      x.rn.note = `${rep?.marker ?? "no report"} · ${x.ctx.head.slice(0, 8)}${rep?.summary ? ` · ${rep.summary.slice(0, 160)}` : ""}${ro ? " · report only" : ""}`;
      return rep?.marker === "SCOPE-BLOCKED" ? "blocked" : rep?.marker === "DOOR-CHANGE" ? "door-change" : rep?.marker === "ASK" ? "blocked" : "ok";
    },
    /** A round killed at round_timeout_s is classed timeout: its code is kept and committed, the next round can still change code. */
    onTimeout: (x, job) => { commitRound(x, { marker: "TIMEOUT", summary: "stopped at the round time limit", round: x.visit }, `${job.provider}·${job.model}`); x.rn.data.report = null; x.ctx.timeouts = [...(x.ctx.timeouts ?? []), { round: x.visit, head: x.ctx.head }]; x.rn.note = `timeout · ${x.ctx.head.slice(0, 8)} (work kept)`; return "fail"; },
  };
  // ---------- the reviewer (v1's reviewer modes: config.yaml `reviewer: mode: diff|run`, bin/fm-review.sh, skills/reviewer/SKILL.md) ----------
  // policy reviewer.mode: diff (the default, v1's base mode) gives the reviewer the spec, the diff, the CI and check results, the
  // fail-first report and read-only, type-aware reads of a fresh checkout of the head; run adds sandboxed test runs and small
  // verification commands on a throwaway copy of the head, its dependencies installed by the project's install policy
  // (no network for the run itself, no credentials). review-depth:
  // every changed file read (any type; within the read budget), and in run mode at least one executed verification unless it
  // cannot run (recorded, flagged). Untrusted files are read off the event loop, with caps (src/review-read.ts).
  const reviewMode = (x: X): "diff" | "run" => (x.policy("reviewer.mode") === "run" ? "run" : "diff");
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
    return { d, plan, mode, unread, missing, read, validPlan };
  };
  engine.natives["review-depth"] = (_i, hp) => {
    const x = hp.x as X; const v = x.rn.data.verdict; const { d, plan, mode, missing, read, validPlan } = reviewDepth(x);
    const findings = !validPlan ? [{ locator: { type: "card", field: "review" }, message: "the review has no valid current-attempt plan bound to this head", expected: "prepare a fresh review plan before verification", class: "review-unverified", severity: "blocking" }] : x.rn.data.unverified ? [{ locator: { type: "card", field: "review" }, message: `the reviewer would not verify its claims: ${x.rn.data.unverified}`, expected: `a verdict after what ${mode} mode asks`, class: "review-unverified", severity: "blocking" }]
      : v && missing.length ? missing.map((m) => ({ locator: { type: "card", field: "review" }, message: `a verdict without its verification: ${m}`, expected: `the reviewer did what ${mode} mode asks before its verdict`, class: "review-depth", severity: "blocking" })) : [];
    const data = { mode, read, unreadable: plan.unreadable, notRead: plan.notRead, executed: d.executed.map((e: any) => ({ command: e.command, exit: e.exit ?? null, refused: e.refused ?? null })), notExecuted: d.notExecuted, budget: plan.budget };
    x.ctx.reviewDepth = data;
    return { verdict: findings.length ? "fail" : "pass", score: findings.length ? 0 : 1, findings, data } as any;
  };
  // the step-back card's "another model" (provider/model in its note): the next review runs on it, set as the round begins
  // (the run's own agent pick for the node, between visits), once per answer
  const reviewSwap = (x: X) => { const a = x.ctx.answers?.["step-back"]; if (a?.choice !== "other-model" || x.ctx.reviewSwapAt === a.at) return;
    const [provider, ...rest] = String(a.note ?? "").trim().split("/").map((t: string) => t.trim()); x.ctx.reviewSwapAt = a.at;
    if (provider) { x.rn.agent = { provider, model: rest.join("/") || null }; x.log(`the step-back card's pick: this review runs on ${provider}${rest.length ? ` · ${rest.join("/")}` : ""}`); } };
  /** a fresh checkout of the head for the reviewer's reads (detached; removed when the review ends) */
  const reviewTree = (x: X) => { const h = head(shellOk(x)); const t = tmpTree(x.run.id, "review-head"); git(x.ctx.repo, ["worktree", "remove", "--force", t]); rmSync(t, { recursive: true, force: true });
    must(x.ctx.repo, ["worktree", "add", "-q", "--detach", t, h]); return t; };
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
   * gets them (the project's install policy, else bun install --frozen-lockfile, in the round sandbox, the network only to
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
    const deps = await W.installIn(base, `review-${x.run.id}`, Array.isArray(install) ? install.map(String) : null,
      { scripts: x.policy("install_scripts") === true, allow: ([] as any[]).concat(x.policy("egress.allow", []) ?? []).map(String) });
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
    tools: (x) => { const tree = x.rn.data.tree ?? shellOk(x); const cfg = cfgOf(x); const mode = reviewMode(x); let runs = 0, cmds = 0;
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
      const inCopy = async (label: string, argv: string[], timeoutS: number) => {
        const d = reviewDepth(x).d; const box = join(runsDir(x), label); let base: string;
        try { base = await runBase(x); }
        catch (e: any) { const why = String(e?.message ?? e).slice(0, 300); if (!d.notExecuted) d.notExecuted = why; d.executed.push({ command: argv.join(" "), refused: why, at: new Date().toISOString() }); x.save();
          return { error: `${why} (recorded: the merge card flags that it could not run)` }; }
        try {
          const copy = join(box, "copy"); mkdirSync(box, { recursive: true }); if (!(await cloneDir(base, copy))) return { error: "the installed checkout could not be copied" };
          const exe = resolveCmd(copy, argv[0]); if (!exe) return { error: `refused: ${argv[0]} is not a program on the fixed PATH (${fixedPath("<copy>").join(":")}) or a file inside the copy` };
          const cmd = [exe, ...argv.slice(1)]; mkdirSync(join(box, "tmp"), { recursive: true });
          const r = process.env.CREW_TEST_REVIEW_SANDBOX_REFUSE === "1" ? { refused: "the round sandbox is not available (test)" } as any
            : await sandboxed(cmd, { cwd: copy, out: copy, tmp: join(box, "tmp"), timeoutS, network: false, dataDir: o.dataDir, argvRead: false, env: { PATH: fixedPath(copy).join(":") } });
          if (r.refused) { d.executed.push({ command: argv.join(" "), refused: r.refused, at: new Date().toISOString() }); x.save(); return { error: `refused: ${r.refused} (recorded: the merge card flags that it could not run)` }; }
          d.executed.push({ command: argv.join(" "), exit: r.timedOut ? null : r.code, at: new Date().toISOString() }); x.save();
          return { exit: r.timedOut ? null : r.code, timedOut: r.timedOut, tail: (r.stdout + r.stderr).trim().split("\n").slice(-25).join("\n") };
        } catch (e: any) { return { error: String(e?.message ?? e) }; }
        finally { rmSync(box, { recursive: true, force: true }); } };
      const runTool: AgentTool[] = mode !== "run" ? [] : [
        { name: "run_tests", description: "Run the repository's own test command on the head, in a throwaway copy of the head with its dependencies installed, in your sandbox (no network, at most 3 times). Returns the exit code and the last lines.", schema: { type: "object", properties: {} },
          run: async () => { if (!cfg.test) return { error: "the repository declares no test command (recorded: the merge card flags that nothing ran); run_command can still check a claim" }; if (++runs > 3) return { error: "test run limit reached" };
            return inCopy(`tests-${runs}`, cfg.test, cfg.timeout_s); } },
        { name: "run_command", description: "Run one small verification command (argv, no shell; a program from the system PATH, bun, or a path inside the copy) on a throwaway copy of the head in your sandbox: no network, no credentials, nothing written back. At most 4 times.",
          schema: { type: "object", properties: { argv: { type: "array", items: { type: "string" } } }, required: ["argv"] },
          run: async (a) => { const argv = (Array.isArray(a.argv) ? a.argv : []).map(String).slice(0, 40); if (!argv.length) return { error: "argv is required" }; if (++cmds > 4) return { error: "command limit reached" };
            if (argv[0].startsWith("/")) return { error: `refused: ${argv[0]} is an absolute path; name a program on the fixed PATH or a path inside the copy` };
            return inCopy(`cmd-${cmds}`, argv, 120); } }];
      return [...others, read, ...runTool,
        { name: "review_verdict", description: "Your verdict, once. REJECT carries a numbered list: each finding with a file locator (path and line), a tag (must-fix or follow-up) and one concrete fix. APPROVE may carry follow-ups.",
      schema: { type: "object", properties: { verdict: { type: "string", enum: ["APPROVE", "REJECT"] }, findings: { type: "array", items: { type: "object", properties: { path: { type: "string" }, line: { type: "number" }, text: { type: "string" }, tag: { type: "string", enum: ["must-fix", "follow-up"] }, fix: { type: "string" }, class: { type: "string" } }, required: ["text", "tag"] } }, followups: { type: "array", items: { type: "string" } } }, required: ["verdict"] },
      run: (a) => { const f = (Array.isArray(a.findings) ? a.findings : []).slice(0, 12).map((y: any, i: number) => ({ n: i + 1, path: y?.path ? String(y.path) : null, line: Number(y?.line) || null, text: String(y?.text ?? y).slice(0, 600), tag: y?.tag === "follow-up" ? "follow-up" : "must-fix", fix: String(y?.fix ?? "").slice(0, 600), class: String(y?.class ?? "review").slice(0, 40) }));
        if (a.verdict === "REJECT" && !f.some((y: any) => y.tag === "must-fix")) return { error: "a REJECT needs at least one must-fix finding" };
        const depth = reviewDepth(x);
        if (depth.missing.length) { x.rn.data.refused = `Your verdict is refused (${depth.mode} mode): a verdict needs its verification first. Still missing: ${depth.missing.join("; ")}. Then call review_verdict again, and list under Executed each command you ran and under "Read, not run" each claim you only read.`; x.save(); return { error: x.rn.data.refused }; }
        // what the review could not cover is part of its verdict, and the merge card says so
        const notCovered = [...depth.plan.notRead.map((n: any) => `not read (${n.reason}): ${n.path}`), ...depth.plan.unreadable.map((n: any) => `not readable (${n.reason}): ${n.path}`), ...(depth.d.notExecuted ? [`not executed: ${depth.d.notExecuted}`] : [])];
        x.rn.data.verdict = { verdict: a.verdict === "APPROVE" ? "APPROVE" : "REJECT", findings: f, followups: (a.followups ?? []).map(String).slice(0, 8), mode: depth.mode, notCovered }; x.save(); return { ok: true, notCovered }; } }]; },
    // the tool budget follows the plan: every required read twice over (ranges), the run tools, the verdict, room to look around
    maxTools: (x: X) => 2 * (x.rn.data.plan?.requiredCost ?? readBudget(x)) + 30,
    system: (x, skill) => `${skill}\n\nYou review one change with a fresh context in ${reviewMode(x)} mode: you get the spec, the diff, the CI and check results and the fail-first report, never the worker's reasoning, and read-only fs_* tools over a fresh checkout of the head (fs_read shows any file by its type: text, images, PDFs, binaries).${reviewMode(x) === "run" ? " In run mode you also check claims by running: run_tests (the repository's tests) or run_command (a small verification), on a throwaway copy of the head with its dependencies installed, in a sandbox with no network; run at least one before your verdict." : " Diff mode runs nothing: judge by reading."} Read every file the read plan below lists before your verdict; a verdict without that is refused. Call review_verdict once; give every finding a file path and line. Then answer with APPROVE:${x.run.id} or REJECT:${x.run.id} as your last line.`,
    prompt: (x) => {
      const wt = shellOk(x); const h = x.ctx.head ?? head(wt); const plan = x.rn.data.plan ?? { required: [], notRead: [], unreadable: [], budget: readBudget(x) };
      const diff = git(wt, ["diff", "--no-color", `${x.ctx.baseCommit}..HEAD`]).out.slice(0, 24000);
      const L = engine.ledger(x.run.id).filter((e) => e.head === h && (e.check === "firstmate/ci" || e.check === "firstmate/fail-first"));
      const refusedBefore = x.ctx.reviewBrief ? `BRIEF (your last attempt): ${x.ctx.reviewBrief}\n` : "";
      const prior = (x.ctx.reviews ?? []).length ? `Earlier verdicts: ${(x.ctx.reviews ?? []).map((r: any) => `${r.verdict} (${r.findings.length})`).join(", ")}\n` : "";
      const planText = `Read plan (${reviewMode(x)} mode, budget ${plan.budget} reads): read ${plan.required.join(", ") || "(nothing)"}${plan.notRead.length ? `\nNot read (over the budget; say so in your verdict): ${plan.notRead.map((n: any) => n.path).join(", ")}` : ""}${plan.unreadable.length ? `\nNot readable: ${plan.unreadable.map((n: any) => `${n.path} (${n.reason})`).join(", ")}` : ""}\n`;
      return `CODE REVIEW\nRun ${x.run.id} · review ${x.visit} · head ${h} · door ${x.ctx.door?.door} · mode ${reviewMode(x)}\n${specMd(x.ctx.spec)}\n${L.map((e) => `${e.check}: ${e.verdict}${e.findings.length ? ` — ${e.findings.map((f) => f.message).join("; ").slice(0, 400)}` : ""}`).join("\n")}\n${prior}${refusedBefore}${planText}\nDiff (base..head):\n${diff || "(no diff)"}`;
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
  engine.cardBodies.dispatch = (x) => ({ title: `Dispatch: ${T(x)}`, zhTitle: `派工：${ZT(x)}`, ...base(x, x.ctx.spec?.why?.join(" ") ?? "", "A worker builds it on its own branch. Checks and a fresh reviewer judge each round.", zhWhyOf(x), "worker 在自己的 branch 上做；每一輪由檢查和全新的 reviewer 判定。"),
    body: `${specMd(x.ctx.spec)}\nRepository: ${x.ctx.repo} (${x.ctx.base}) · branch ${x.ctx.branch}\nRollback: ${x.ctx.spec?.door?.kind === "one-way" ? "a revert does not undo a one-way change; the plan round names the rollback" : "a revert undoes it"}`,
    options: [{ id: "dispatch", label: "A · Dispatch", primary: true }, { id: "rescope", label: "B · Rescope", note: true }, { id: "drop", label: "D · Drop" }] });
  engine.cardBodies.door = (x) => ({ title: `Pick the door: ${T(x)}`, zhTitle: `選門：${ZT(x)}`, ...base(x, "No list can sort this scope.", "Pick one-way or two-way.", "沒有清單能分類這個範圍。", "選單向門或雙向門。"),
    body: `No list can classify this scope:\n${(x.ctx.door?.reasons ?? []).map((r: any) => `- ${r.path}: ${r.why}`).join("\n")}`, options: [{ id: "two-way", label: "Two-way (a revert undoes it)" }, { id: "one-way", label: "One-way" }] });
  engine.cardBodies.budget = (x) => ({ title: `Round budget reached: ${T(x)}`, zhTitle: `輪數預算用完：${ZT(x)}`, ...base(x, "The round cap is reached and checks still fail.", "Add 2 rounds, narrow the scope, or park the run.", "輪數上限已到，檢查仍未通過。", "多給 2 輪、縮小範圍，或暫停這個 run。"),
    body: `${x.run.nodes.build?.visits ?? 0} rounds ran and it is still not green.\n\n${x.ctx.briefs?.build?.text ?? ""}`,
    options: [{ id: "extend", label: "Continue: 2 more rounds", primary: true }, { id: "rescope", label: "Narrow the scope", note: true }, { id: "park", label: "Park the run" }] });
  engine.cardBodies["step-back"] = (x) => {
    // a review still without a verified verdict after its retry stops on the captain here too (architecture §3.3), never a failed run
    if (x.ctx.reviewUnverified) { const refused = x.ctx.reviewUnverified; const err = refused;
      return { title: `${refused ? "The reviewer would not verify its claims" : "The reviewer gave no verdict"}: ${T(x)}`, zhTitle: `${refused ? "reviewer 不肯先驗證就下判定" : "reviewer 沒有給出判定"}：${ZT(x)}`,
        ...base(x, refused ? "Twice the reviewer gave a verdict without running the tests and reading every changed file, and the verdict was refused both times." : `The review failed twice: ${err.slice(0, 300)}`,
          "Retry the review with another model, rescope the spec, or drop the run.",
          refused ? "reviewer 兩次都沒跑測試、也沒讀完改動的檔案就下判定，兩次都被拒絕。" : `審查連續失敗兩次：${err.slice(0, 300)}`, "換一個模型重新審查、調整規格範圍，或放棄這個 run。"),
        body: refused ? `The reviewer's verdict was refused after its retry.\n\n${refused}` : `The review failed after its retry: ${err}`,
        options: [{ id: "other-model", label: "Retry the review with another model (name it: provider/model)", note: true, primary: true }, { id: "rescope", label: "Rescope the spec", note: true }, { id: "park", label: "Drop the run" }] }; }
    const r = x.ctx.refine?.fix; const last = r?.history?.at(-1);
    return { title: `Step back: the same failure twice — ${T(x)}`, zhTitle: `退一步：同一類失敗連續兩次 — ${ZT(x)}`, ...base(x, `The class ${(last?.repeated ?? []).join(", ")} failed in two rounds in a row.`, "Question the design: rescope, or allow one more round.", `類別 ${(last?.repeated ?? []).join(", ")} 連續兩輪失敗。`, "重新思考設計：調整範圍，或再給一輪。"),
      body: `The class ${(last?.repeated ?? []).join(", ")} failed in two rounds in a row. A third try the same way is unlikely to work: question the design.\n\n${x.ctx.briefs?.build?.text ?? ""}`,
      options: [{ id: "rescope", label: "Rethink: rescope the spec", note: true, primary: true }, { id: "continue", label: "One more round as is" }, { id: "park", label: "Park the run" }] }; };
  engine.cardBodies.stalled = (x) => ({ title: `No progress for 2 rounds: ${T(x)}`, zhTitle: `兩輪沒有進展：${ZT(x)}`, ...base(x, "The checks' score did not rise for two rounds.", "Rescope, allow one more round, or park.", "檢查分數兩輪沒有上升。", "調整範圍、再給一輪，或暫停。"),
    body: `The checks' score did not improve for two rounds.\n\n${x.ctx.briefs?.build?.text ?? ""}`,
    options: [{ id: "rescope", label: "Rescope the spec", note: true, primary: true }, { id: "continue", label: "One more round" }, { id: "park", label: "Park the run" }] });
  engine.cardBodies.scope = (x) => ({ title: `Scope question: ${T(x)}`, zhTitle: `範圍問題：${ZT(x)}`, ...base(x, "The work needs a decision on the scope.", "Rescope the spec, or park the run.", "工作需要決定範圍。", "調整規格範圍，或暫停這個 run。"),
    body: `${x.run.nodes.build?.data?.report?.marker ?? x.ctx.planDecision?.decision ?? ""}: ${x.run.nodes.build?.data?.report?.summary ?? x.ctx.planDecision?.note ?? (x.ctx.briefs?.spec?.text ?? x.ctx.briefs?.plan?.text ?? "")}`,
    options: [{ id: "rescope", label: "Rescope the spec", note: true, primary: true }, { id: "park", label: "Park the run" }] });
  engine.cardBodies.merge = async (x) => {
    let remoteIntent: RemoteMergeIntent | undefined;
    let assertRemoteCard: (() => void) | undefined;
    if (x.ctx.pr?.adapter === "github") {
      const phase = remotePhase(x); phase.assert(); const a = selectedAdapter(x); assertRemoteCard=phase.assert;
      try { if (!(a instanceof GitHubPrAdapter)) throw new Error(); await reconcile(a, x.ctx.pr, phase.signal); phase.assert(); const policy = await requiredPolicy(a, phase.signal); phase.assert(); if (x.ctx.remoteCI?.head !== x.ctx.pr.head || x.ctx.remoteCI?.policyHash !== policy.hash || x.ctx.remoteCI?.grant !== grantIdentity(a) || (await inspectRemote(a, x.ctx.pr, policy, phase.signal)).state !== "pass") throw new Error(); }
      catch { phase.assert(); return remoteStopBody("authoritative PR, head or required CI no longer matches; merge refused"); }
      phase.assert();
      try { (a as GitHubPrAdapter).operationGrant(); assertMergeAvailable(a as GitHubPrAdapter,x.ctx.pr,x.dir); const p = await (a as GitHubPrAdapter).mutationState(x.ctx.pr,phase.signal,phase.assert); phase.assert(); if (p.base?.sha !== x.ctx.baseCommit || p.draft !== false || p.mergeable !== true || p.mergeable_state !== "clean") throw new Error(); remoteIntent={version:1,grant:grantIdentity(a as GitHubPrAdapter),repository:(a as GitHubPrAdapter).grant.repository,pr:x.ctx.pr.id,branch:x.ctx.pr.branch,base:x.ctx.pr.base,baseHead:x.ctx.baseCommit,head:x.ctx.pr.head,method:(a as GitHubPrAdapter).operationGrant().mergeMethod,policyHash:x.ctx.remoteCI.policyHash}; }
      catch { phase.assert(); return remoteStopBody("remote merge grant or CLEAN/non-draft state is unverified"); }

    }
    const wt = x.ctx.worktree; const stat = wt && existsSync(wt) ? git(wt, ["diff", "--stat", `${x.ctx.baseCommit}..HEAD`]).out : "";
    const gates = engine.ledger(x.run.id).filter((e) => e.check.startsWith("firstmate/gate-")).slice(-6).map((e) => `${e.verdict === "pass" ? "✓" : "✗"} ${e.check.replace("firstmate/gate-", "")}: ${(e as any).data?.detail ?? e.findings[0]?.message ?? ""}`).join("\n");
    const one = x.ctx.door?.door === "one-way"; const sp = ledgerSplit(x);
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
    const b0 = base(x, x.ctx.spec?.why?.join(" ") ?? "", one ? `One-way: confirm the door to merge. Walk: ${walk}` : x.ctx.pr?.adapter === "github" ? "Merge the verified PR head remotely; the source checkout stays untouched." : "Merge fast-forwards the base branch locally.", detail.why.map(zl).join(" "), one ? `單向門：請確認門再合併。說明：${x.ctx.spec?.explain?.["zh-TW"] ?? ""}` : x.ctx.pr?.adapter === "github" ? "合併已驗證的遠端 PR 版本；來源工作目錄保持不變。" : "合併會在本地 fast-forward base branch。", { ba: stat });
    b0.zh.done = detail.done.map((d) => zl(d.text));
    const body:Body = { title: `Merge: ${T(x)}`, zhTitle: `合併：${ZT(x)}`, ledger: { done: engine.doneLines(x.run) }, detail, captainOnly: true, captures, links: cap?.app ? [{ label: "Open the app", href: cap.app }] : [], ...b0,
      body: `Intent: ${x.run.text.split("\n")[0].slice(0, 300)}\n\n${one ? `ONE-WAY: a revert will not undo this (${(x.ctx.door?.reasons ?? []).filter((r: any) => r.list !== "trivial").map((r: any) => `${r.path}: ${r.why}`).join("; ")}). Walk: ${walk}\nTick the door confirmation to merge.\n\n` : ""}${x.ctx.pr?.adapter === "github" ? `Merge PR #${x.ctx.pr.id} in ${(selectedAdapter(x) as GitHubPrAdapter).grant.repository} at ${x.ctx.pr.head} into ${x.ctx.pr.base}. Method: ${(selectedAdapter(x) as GitHubPrAdapter).operationGrant().mergeMethod}.` : `Fast-forwards ${x.ctx.base} in ${x.ctx.repo} to ${String(x.ctx.gatedHead ?? x.ctx.head).slice(0, 8)} (branch ${x.ctx.branch}). Local only: nothing is pushed.`}\n\nBefore → after:\n${stat}\n\nSix gates:\n${gates}\n\nProved by checks:\n${sp.proved.map((d) => `✓ ${d.index + 1}. ${d.text} — ${d.by.map((b) => b.check).join(", ")}`).join("\n") || "(none)"}\n\nNeeds your eye:\n${sp.eye.map((d) => `· ${d.index + 1}. ${d.text}${d.note ? ` (${d.note})` : ""}`).join("\n") || "(nothing)"}${x.ctx.followups?.length ? `\n\nReviewer follow-ups:\n${x.ctx.followups.map((f: string) => `- ${f}`).join("\n")}` : ""}${seen}${(() => { const rv = (x.ctx.reviews ?? []).at(-1); if (!rv?.mode) return ""; return `\n\nReviewed in ${rv.mode} mode.${rv.notCovered?.length ? `\nNeeds your eye (the review did not cover):\n${rv.notCovered.map((n: string) => `· ${n}`).join("\n")}` : ""}`; })()}`,
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
      const p = role?.provider ? { provider: role.provider, model: role.model ?? null } : x.run.params.provider ? { provider: x.run.params.provider, model: x.run.params.model || null } : engine.deps.defaultProvider();
      // the coordinator's instructions, as for its agent nodes: the safety rules, its role skill, then the skills its nodes enable (in node order, once each)
      const pins = x.run.def.nodes.filter((n: any) => n.kind === "agent" && n.role === "coordinator").flatMap((n: any) => n.skills ?? []).filter((p: any, i: number, a: any[]) => a.findIndex((q: any) => q.id === p.id) === i);
      const skill = engine.instructions(x.run, role?.id, pins);
      const tools: AgentTool[] = [{ name: "card_detail", description: "The merge card's zh-TW translations and walk notes, once.", schema: COORDINATOR_TOOL_SCHEMA, run: (a) => { got = a; return { ok: true }; } }];
      await engine.deps.agents.run({ kind: "card:merge", title: `${x.run.id} merge card detail`, system: `${skill}\n\nYou are the coordinator (firstmate). You write the merge card the captain reads: real Traditional Chinese, plain words. Call card_detail exactly once, then answer in one line.`,
        text: coordinatorText(fallback), tools, provider: engine.deps.provider(p.provider, p.model ?? undefined), ref: x.run.id, maxTools: 3, timeoutMs: 5 * 60_000, sandbox: engine.roundSandbox(x, null) });
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
  return `# ${s.title}\n\nWhat: ${s.what}\n\nWhy:\n${(s.why ?? []).map((w: string) => `- ${w}`).join("\n")}\n\nDone when:\n${(s.done ?? []).map((d: string, i: number) => `${i + 1}. ${d}`).join("\n")}\n\nScope: ${(s.scope ?? []).join(", ")}\nDoor: ${s.door?.kind ?? "?"}${s.door?.reason ? ` (${s.door.reason})` : ""}\n${s.explain?.en ? `\nExplain: ${s.explain.en}\n` : ""}`;
}
export { locatorText };
