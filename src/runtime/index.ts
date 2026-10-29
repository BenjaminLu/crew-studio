import {WorkflowAdoption} from '../workflow-package-adoption';
import {WorkflowPackages,snapshotPackage,packageSha} from '../workflow-package';
import {workflowDefinitionExport} from '../workflow-definition-export';
import {executionMode} from '../local-execution';
import {hashInput} from './checks';
import {installOwnClaudeGrants,ownClaudePlan} from '../providers/own-workflow-claude-refresh';
import {installHelloWeb} from "../domain/hello-web";
import { refusesRulesPatch } from "../operating-rules";
import { taskTitle } from "../task-title";
import { PolicyUnreadable } from "./checks";
import { failure, fromError, type FailureCode } from "./failures";
import {installStartupRecursion,startupCursorAdvice} from '../domain/startup-recursion';
import { deliverableOf, DELIVERABLE_WORKFLOW } from "../deliverables";
import {installReadinessViews,readinessNodes} from './readiness-view';
import {installGitHubReviewWorkflow} from '../domain/github-review-workflow';
import {Onboarding} from '../onboarding';
import {OnboardingTeam,type TeamPick,type TeamProbe} from '../onboarding-team';
import {ArtifactStore,websiteHref} from '../artifacts';
import {StaffingStore,staffingHash,coffeeStaffingProject,staffingApplies,staffedCapability,reviewPair,type StaffingProject} from '../domain/staffing';
import {CrewStore,resolveCrew,teamBody,withJudges,seatLabel} from '../domain/crew';
import {usableModels,levelOf,reachable,required,degradedWhy,withNote,LEVEL_TEXT,type Level} from '../domain/independence';
import {installCrewGuard,judgeSlots} from '../crew-guard';
import {installTeamStaffingGuard,crewStaffingDraft} from '../crew-staffing';
import {migrateCrew} from '../crew-migrate';
import {crewRoutes} from '../crew-routes';
import {installCrewTools} from '../crew-tools';
import {IssueTriageStore} from '../issue-triage-store';
import {installIssueTriage} from '../issue-triage-workflow';
import {IssueCategoriesStore} from '../issue-categories-store';
import {installIssueCategories} from '../issue-categories-workflow';
import {installFirstmateStaffing,staffingQuotaReady,type StaffingFacts,type StaffingAdmission} from '../firstmate-staffing';
import {installFirstmate,heldNotice} from "../firstmate";
import {WorkflowDrafts,installWorkflowDraftTools,draftRoute,ownStaffingPlan,ownWorkflow,checkNodeStaffing,ownBrief} from "../workflow-drafts";
import {installReadiness} from "../readiness";
// Studio's native runtime, wired: versioned workflow definitions, the engine,
// the check runtime, Studio-owned cards, and the steps each workflow uses.
// Routes (all under /api/wf, /api/wruns, /api/scards, /api/checks, /api/policies, /api/intake):
//   GET  /api/wf                         every workflow (latest version) and the check catalogue
//   GET  /api/wf/<id>[?v=N]              one version, its problems, every version's meta and diff
//   POST /api/wf/<id>                    save an edit as a new version (refused with errors or no change)
//   POST /api/wf/<id>/trash|restore     recoverable personal catalog state (desktop, base + revision CAS)
//   POST /api/wf/<id>/layout             node positions for one version (no new version)
//   POST /api/wf/validate                problems of an unsaved definition
//   GET  /api/checks                     every check manifest with its effective parameters
//   POST /api/checks/try                 run one check on its sample input (the editor's "try on sample")
//   GET/POST /api/policies               org and project policy
//   POST /api/intake                     classify an intent into a workflow (+ door hint)
//   GET/POST /api/wruns                  runs; start one from an intent
//   GET  /api/wruns/<id>                 a run with its events, ledger, done-line map and cards
//   POST /api/wruns/<id>/(pause|resume|cancel)    POST /api/wruns/<id>/nodes/<node>/agent  (hot swap)
//   GET  /api/wruns/<id>/file?path=…     a file from the run folder (spec, briefs, hand-offs, check evidence)
//   GET  /api/wruns/agents               the agent node runs working now (the Crew page)
//   GET  /api/wruns/<id>/captures/<head>/(before|after)/<page>.(html|png)   the app's captures; the head's pages are "Open the app"
//   GET  /api/wruns/<id>/evidence?seq=N&file=…  one evidence file a ledger entry lists (a merge card's proof link)
//   GET  /api/scards, POST /api/scards/<id>/answer   Studio's own cards
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { CAPTURE_PATH, captureResponse } from "./captures";
import { redactText } from "../secure";
import { join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import type { Agents } from "../agent";
import { bundledText } from "../bundled";
import { realInside } from "../secure";
import { classify, loadDefaults, Projects } from "../doors";
import type { Provider } from "../providers";
import type { StudioLog } from "../rawlog";
import { schemaDefaults } from "./checks";
import { validate, normalize as normDef, WorkflowDefs, roleSkillJoin } from "./defs";
import { DEFAULT_DISPLAY_NAMES, DisplayNameError } from "./workflow-names";
import { Engine, type AgentPick } from "./engine";
import {COFFEE_DESIGN_FIELDS,validateCoffeeDesign,coffeeDesignJSON} from "../domain/coffee-design";
import { installCoffeeKit } from "../domain/coffee-kit";
import { installDeliver } from "../domain/deliver";
import { SkillPackages } from "../skillpkg/index";
import { defPins, teamPins } from "../skillpkg/crew";

export type RuntimeDeps = {
  dataDir: string; agents: Agents; provider: (id?: string, model?: string) => Provider; defaultProvider: () => AgentPick; log: StudioLog; send: (t: string, d: unknown) => void;
  fmRoot: string; /** the roots nothing may read or write (default: the firstmate checkout) */ protectedRoots?: string[]; store?: any; m3?: { store: any; runs: any; lane: any; useArtifactReviewPolicy?: (policy:(id:string)=>import("../m3").ArtifactReviewPolicy|null)=>void } | null; fileorg?: any; docs?: any; improve?: any; studioUrl: () => string;
  /** domain steps (packs' actions, agent modes, natives) installed onto the engine before runs load */
  install?: ((engine: Engine, ctx: { projects: Projects; dataDir: string }) => void)[];
  /** the skill library (src/skills.ts): agent nodes' enabled skills are pinned against it and read from it */
  skills?: import("../skills").Skills | null;
  coffeeVideo?:Parameters<typeof installCoffeeKit>[1]["video"];
  coffeeFilmStatus?:{ready:boolean;reason:string|null};
  coffeeChoice?:()=>{provider:"codex";model:string;effort:string|null}|null;
  /** Studio's configured model per provider (chat settings, env, Codex config): the startup workflow's default when no exact model param was given. */
  startupModel?:(provider:"claude"|"codex"|"cursor")=>string|null|undefined;
  generateImage?: (prompt: string, authorize: () => void, signal: AbortSignal, reference?:import("../providers/codex-image").CodexImageReference, rules?: import("../operating-rules").RulesSection, crew?: { model: string; effort: string | null; provider?: "cursor" }) => Promise<import("../providers/cursor-image").StudioImage>;
  /** fresh: read every model list again now (the Crew page's detection), not a reading the provider reuses */
  staffingFacts?: (o?:{fresh?:boolean}) => Promise<StaffingFacts[]>;
  staffingAdmission?: StaffingAdmission;
  /** Studio's own bounded verification of one staffed model (a signed-in Claude pair, a Cursor key, a Codex probe): true when it
   *  ran and passed. Absent: a signed-in model that is not verified stays blocked with the reason. */
  staffingVerify?: (role:{provider:string;model:string;effort:string|null},o?:{signal?:AbortSignal})=>Promise<boolean>;
  onboardingProvider?:()=>string|null;
  /** each vendor's sign-in presence (claude, codex, cursor), free to read: the startup competition's Start form and Firstmate contract say which role to move to Cursor */
  providerLogins?:()=>Promise<Record<string,string>>;
  onboardingTeamVerify?:(pick:TeamPick,signal?:AbortSignal)=>Promise<TeamProbe>;
  onboardingTeamContext?:(pick:TeamPick)=>string;
  staffingProject?: (id:string) => StaffingProject;
  staffingPending?: (intent:any) => void;
  /** the captain approved a crew Firstmate proposed: tell Firstmate, so it proposes the work (still captain-approved) */
  staffingApproved?: (a: import('../firstmate-staffing').StaffingApproved) => void;

  selectProvider?: (x: import("./engine").X, pick: AgentPick, context?: { role: string; explicit: boolean }) => Promise<Provider>;
  /** the readiness gate (src/readiness): false inside the gate's own dry run */
  readiness?: false | { login?: (provider: string) => import("../readiness/stages").LoginState; knownProviders?: () => string[]; repoRoot?: string | null;
    /** send Firstmate a gate-repair turn; false when Firstmate is not running */ ask?: (text: string) => boolean; dryTimeoutMs?: number; smokePollMs?: number };
};

export function skillTextFor(fmRoot: string) {
  // a role with several named skills has one joined ref: its text is each skill's text, in order
  const one = (ref: string): string => {
    if (ref.startsWith("pack:")) { const t = bundledText(`packs/${ref.slice(5)}`); if (t == null) throw new Error(`no skill ${ref}`); return t; }
    if (ref.startsWith("bundled:")) { const t = bundledText(ref.slice(8)); if (t == null) throw new Error(`no skill ${ref}`); return t; }
    if (ref.startsWith("fm:")) return readFileSync(join(fmRoot, ref.slice(3)), "utf8");
    throw new Error(`unknown skill source ${ref}`);
  };
  return (ref: string): string => roleSkillJoin(ref, one);
}

/** Which workflow an intent belongs to: keyword scores over each definition's intent block, and a door hint from the paths and words it names. */
export function classifyIntent(defs: WorkflowDefs, text: string, sensitive: { glob: string; why: string }[] = [], oneWayWords: string[] = []) {
  const t = ` ${text.toLowerCase()} `;
  const want = deliverableOf(text);
  const scores = defs.catalog().map((d) => { const kw: string[] = d.intent?.keywords ?? []; const hits = kw.filter((k) => new RegExp(`[^a-z0-9]${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?[^a-z0-9]`).test(t));
    // the deliverable the request names routes it to the workflow that makes it (a shop's website goes to web-prototype)
    if (want && DELIVERABLE_WORKFLOW[want] === d.id && !hits.length) hits.push(`deliverable:${want}`);
    return { workflow: d.id, name: d.name, score: hits.length, hits }; }).sort((a, b) => b.score - a.score);
  const paths = [...text.matchAll(/(?:^|\s|`)((?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:sql|env|pem|key|proto|ya?ml|json|js|ts|mjs|md))(?=$|\s|`|[,.;:])/g)].map((m) => ({ path: m[1], added: 1 }));
  // words that hint at a one-way change come from policy (intake.one_way_words), not from the runtime
  const ow: string[] = Array.isArray(oneWayWords) ? oneWayWords : [];
  const words = ow.length ? new RegExp(`\\b(${ow.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i").exec(text) : null;
  const dd = loadDefaults(); const door = paths.length ? classify(paths, { defaults: { ...dd, base: [...dd.base, ...sensitive.filter((r) => !dd.base.some((b) => b.glob === r.glob))] } }) : null;
  const tier = door?.door === "one-way" || words ? "one-way" : door?.door ?? "two-way";
  const top = scores[0]?.score ? scores[0] : null;
  return { workflow: top?.workflow ?? null, scores: scores.slice(0, 6), door: { tier, paths: paths.map((p) => p.path), reasons: door?.reasons.filter((r) => r.list !== "trivial") ?? [], word: words?.[1] ?? null }, confident: !!top && top.score >= 1 && (scores[1]?.score ?? 0) < top.score };
}

export function createRuntime(d: RuntimeDeps) {
  const adoption=new WorkflowAdoption(d.dataDir);
  const packages=new WorkflowPackages(d.dataDir);
  const defs = new WorkflowDefs(d.dataDir);
  if (d.skills) defs.skillInfo = (id, v) => d.skills!.pinInfo(id, v);
  if (d.skills) defs.skillLibrary = () => d.skills!.library();
  const engine = new Engine({ dataDir: d.dataDir, agents: d.agents, provider: d.provider, defaultProvider: d.defaultProvider, selectProvider: d.selectProvider, log: d.log, send: d.send, skillText: skillTextFor(d.fmRoot), store: d.store, protectedRoots: d.protectedRoots ?? [d.fmRoot], library: d.skills ?? null }, defs);
  // the review room's illustrations use the same image job as image steps (src/domain/review-room.ts)
  if (d.generateImage) engine.deps.generateImage = d.generateImage;
  const projects = new Projects(d.dataDir);
  installHelloWeb(engine,d.m3?.store??new ArtifactStore(d.dataDir));
  if (d.m3?.store && d.m3?.lane && d.fileorg && d.docs) installDeliver(engine, { dataDir: d.dataDir, artifacts: d.m3.store, lane: d.m3.lane, fileorg: d.fileorg, docs: d.docs, generateImage: d.generateImage });
  const startup=d.m3?.store?installStartupRecursion(engine,{artifacts:d.m3.store,configuredModel:d.startupModel}):undefined;
  let coffee:ReturnType<typeof installCoffeeKit>|undefined;
  if(d.m3?.store){coffee=installCoffeeKit(engine,{artifacts:d.m3.store,choice:d.coffeeChoice,reviewStaffing:(def,params)=>{const c=staffingGuard.verified(def,params);return{hash:c.hash,workflow:c.workflow,roles:c.roles,approval:c.approval};},staffing:(def,params)=>{const config=staffingGuard.verified(def,params),role=config.roles['image-worker'];if(!role||role.provider!=='codex'&&role.provider!=='cursor')throw new Error('The dedicated image adapter requires an explicitly approved available Codex image-worker; no vendor fallback');return {provider:role.provider,model:role.model,effort:role.effort};},video:d.coffeeVideo});d.m3.useArtifactReviewPolicy?.(id=>coffee!.artifactReview(id)??startup?.artifactReview(id)??null);}
  engine.deps.continuationEvidence=(r:any)=>{const refs=Object.values(r.ctx.deliver??{})as any[];if(refs.length&&!d.m3?.store)throw new Error('Artifact storage unavailable for continuation');
    const notes=(id:string,n:number)=>{const store=d.m3!.store,file=join(store.vdir(id,n),'notes.json');try{if(existsSync(file)){const raw=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(raw)||raw.some(v=>!v||typeof v.id!=='string'||typeof v.comment!=='string'||!['open','resolved'].includes(v.status)))throw new Error('Invalid annotations');}return store.notes(id,n);}catch{throw new Error('Artifact annotations cannot be verified; continuation is held');}};
    const coffeePins=coffee?.continuationEvidence(r.id)??[];return{artifacts:refs.map(ref=>{const v=d.m3!.store.version(ref.id,ref.n);if(!v||v.sha256!==ref.sha256||d.m3!.store.verify(ref.id,ref.n).length)throw new Error('Pinned artifact changed; continuation is held');return{ref,version:v,notes:notes(ref.id,ref.n)};}),coffee:coffeePins.map(e=>({...e,notes:notes(e.receipt.artifact,e.receipt.n)}))};};

  // Base artifact providers precede domain wrappers that bind their own pinned outputs.
  for (const f of d.install ?? []) f(engine, { projects, dataDir: d.dataDir });
  const staffing=new StaffingStore(d.dataDir);
  const staffingProject=(id:string)=>d.staffingProject?d.staffingProject(id):projects.staffingIdentity(id,d.protectedRoots??[]);
  let staffingCapabilities:StaffingFacts[]=[];
  const staffingFacts=async(o?:{fresh?:boolean})=>{staffingCapabilities=await(d.staffingFacts??(async()=>[]))(o);return staffingCapabilities;};
  const roleReady=(role:{provider:string;model:string;effort:string|null})=>{const cap=staffingCapabilities.find(c=>c.provider===role.provider),model=cap?.models.find(m=>m.id===role.model);return !(!cap||cap.support!=='supported'||cap.auth!=='verified'||!staffingQuotaReady(role as any,cap,d.staffingAdmission)||cap.expires<=Date.now()||!model||role.effort!==null&&!model.efforts.includes(role.effort));};
  // ---------- adaptive staffing (docs/architecture.md, "Adaptive staffing") ----------
  // what this machine has, from the provider facts last read (null: none read yet, so no rule is relaxed); held models count
  const usableNow=()=>staffingCapabilities.length?usableModels(staffingCapabilities):null;
  engine.deps.usableModels=usableNow;
  type Role={provider:string;model:string;effort:string|null};
  const verifyKey=(r:Role)=>`${r.provider}/${r.model}/${r.effort??''}`,said=(r:Role)=>`${r.provider} ${r.model}${r.effort?` (${r.effort})`:''}`;
  // a verification that did not pass is not paid again for ten minutes (a captain's explicit Start clears it); one that passed
  // is the provider's own receipt (Claude: 30 minutes). One verification per model at a time, shared by every caller waiting on
  // it: its own abort ends it only when every waiter has left, and an ended verification leaves no backoff.
  const verifyFailed=new Map<string,number>(),VERIFY_RETRY_MS=10*60_000;
  const verifying=new Map<string,{job:Promise<boolean>;abort:AbortController;waiters:number}>();
  const inBackoff=(r:Role)=>(verifyFailed.get(verifyKey(r))??0)>Date.now();
  engine.deps.verifyBackoff=(p:any)=>!!p?.model&&inBackoff({provider:p.provider,model:p.model,effort:p.effort??null});
  const sharedVerify=async(role:Role,signal?:AbortSignal):Promise<boolean|'ended'>=>{
   const key=verifyKey(role);let f=verifying.get(key);
   if(!f||f.abort.signal.aborted){const abort=new AbortController(),job=(async()=>{try{return await d.staffingVerify!(role,{signal:abort.signal})===true;}catch{return false;}})();
    const created={job,abort,waiters:0};f=created;verifying.set(key,created);void job.finally(()=>{if(verifying.get(key)===created)verifying.delete(key);});}
   const shared=f;shared.waiters++;let left=false;const leave=()=>{if(left)return;left=true;shared.waiters--;};
   const onAbort=()=>{leave();if(shared.waiters<=0)shared.abort.abort();};signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
   try{const passed=await shared.job;return shared.abort.signal.aborted||signal?.aborted?'ended':passed;}
   finally{signal?.removeEventListener('abort',onAbort);leave();}};
  /** Why a role cannot run now when Studio cannot fix it by verifying it itself; null when one bounded verification would admit it. */
  const unfixable=(id:string,role:Role,o:{ignoreBackoff?:boolean}={}):{en:string;zh:string}|null=>{const cap=staffingCapabilities.find(c=>c.provider===role.provider),r=cap?.reason?` (${cap.reason})`:'';
   if(!cap||cap.support!=='supported')return{en:`The ${id} role's ${said(role)} is not available on this machine${r}. Check the account, then refresh.`,zh:`${id} 角色的 ${said(role)} 在這台機器上不可用；請確認帳號後重新整理。`};
   if(cap.auth!=='verified'&&cap.login!=='logged-in')return{en:`The ${id} role's ${role.provider} is not signed in${r}. Sign in, then Start.`,zh:`${id} 角色的 ${role.provider} 尚未登入；請先登入再按開始。`};
   if(cap.quota==='exhausted')return{en:`The ${id} role's ${role.provider} is out of quota${r}. Wait for the reset, then Start.`,zh:`${id} 角色的 ${role.provider} 額度已用完；請等額度重置後再按開始。`};
   // Codex (and a checked Cursor key) read quota for free: one that cannot be read now holds; Claude's quota is always unknown
   if(cap.quota!=='available'&&role.provider!=='claude')return{en:`The ${id} role's ${role.provider} quota could not be read just now${r}. Wait a moment, then Start again.`,zh:`${id} 角色的 ${role.provider} 目前讀不到額度；請稍候再按開始。`};
   const known=[...cap.models,...cap.candidates??[]].filter(m=>m.id===role.model);
   if(!known.length)return{en:`The ${id} role's ${role.provider} does not offer ${role.model} on this machine. Choose another model on the Crew page.`,zh:`${id} 角色的 ${role.provider} 在這台機器上沒有 ${role.model}；請到船員頁換一個模型。`};
   if(role.effort!==null&&!known.some(m=>m.efforts.includes(role.effort!)))return{en:`The ${id} role's ${role.provider} ${role.model} does not support ${role.effort} effort. Choose another effort on the Crew page.`,zh:`${id} 角色的 ${role.provider} ${role.model} 不支援 ${role.effort}；請到船員頁換一個推理強度。`};
   if(!d.staffingVerify)return{en:`The ${id} role's ${said(role)} is signed in but not verified by a bounded request, and Studio cannot verify it here. Verify it with Firstmate, then Start.`,zh:`${id} 角色的 ${said(role)} 已登入，但尚未經有限請求驗證，Studio 在這裡無法自行驗證；請先和 Firstmate 驗證，再按開始。`};
   if(!o.ignoreBackoff&&inBackoff(role))return{en:`Studio's verification of the ${id} role's ${said(role)} did not pass a few minutes ago${r}. Check the account, then Start again.`,zh:`Studio 幾分鐘前驗證 ${id} 角色的 ${said(role)} 沒有通過；請確認帳號後再按開始。`};
   return null;};
  /** Before a start (the Board's, the review room's turn): every role that is signed in but not verified yet, or whose facts are
   *  stale, is verified by Studio itself (one bounded request per model, kept for the provider's expiry window), then the facts are
   *  read again. Never for a role that is not signed in, out of quota, with unreadable quota or not offered: those stay blocked
   *  with the reason. explicit: the captain pressed Start for these roles, which retries a verification in its backoff. */
  async function autoVerify(roles:Record<string,Role>,o:{signal?:AbortSignal;why?:string;explicit?:boolean}={}):Promise<{state:'ready';verified:string[]}|{state:'blocked';role:string;reason:{en:string;zh:string}}>{
   const verified:string[]=[],done=new Set<string>();
   for(const[id,role]of Object.entries(roles)){if(roleReady(role)||done.has(verifyKey(role)))continue;const why=unfixable(id,role,{ignoreBackoff:o.explicit});if(why)return{state:'blocked',role:id,reason:why};
    const passed=await sharedVerify(role,o.signal);try{await staffingFacts();}catch{}
    if(passed==='ended')return{state:'blocked',role:id,reason:{en:`The verification of the ${id} role's ${said(role)} ended before it finished.`,zh:`${id} 角色的 ${said(role)} 驗證在完成前結束了。`}};
    const ready=passed&&roleReady(role);
    d.log.emit({type:'staffing_auto_verify',summary:`${said(role)} for the ${id} role${o.why?` (${o.why})`:''}: ${ready?'verified with one bounded request':'verification did not admit it'}`});
    if(!ready){// a hold the refreshed facts now show (quota unreadable or exhausted, signed out) is said as such, with no backoff
     const hold=unfixable(id,role,{ignoreBackoff:true});if(hold)return{state:'blocked',role:id,reason:hold};
     verifyFailed.set(verifyKey(role),Date.now()+VERIFY_RETRY_MS);
     return{state:'blocked',role:id,reason:{en:`Studio verified the ${id} role's ${said(role)} with one bounded request and it did not pass. Check the account, then Start again.`,zh:`Studio 用一次有限請求驗證 ${id} 角色的 ${said(role)}，沒有通過；請確認帳號後再按開始。`}};}
    verifyFailed.delete(verifyKey(role));done.add(verifyKey(role));verified.push(`${id}: ${said(role)}`);}
   return{state:'ready',verified};}
  // the review room's tutor (and any adaptive pick): verified the same way before its paid round
  if(d.staffingFacts)engine.deps.ensurePick=async(pick:Role,o?:{signal?:AbortSignal;why?:string})=>{try{await staffingFacts();}catch{}const r=await autoVerify({tutor:pick},o);if(r.state==='blocked')throw new Error(`${r.reason.en} / ${r.reason.zh}`);return r;};
  engine.deps.refreshUsable=async()=>{try{await staffingFacts();}catch{}return usableNow();};
  // each role's pick and each node override's effective pick (the definition the configuration names)
  const staffingCapability=(config:any)=>staffedCapability(config,engine.defs.get(config.workflow.id,config.workflow.version),roleReady);
  // the Studio-wide team (docs/design/crew-seats.md): a staffed workflow's project staffing is derived from it when it covers the
  // workflow; every other workflow's Task records the crew it started with
  const crewStore=new CrewStore(d.dataDir);
  // script skills (docs/units/skill-packages.md): approval, prepare (by itself, once approved), readiness and skill_run.
  // In use: every library version the team or a workflow's latest version pins (gc keeps their envs). A test run never uses
  // Homebrew or uv to fetch anything (CREW_TEST_ENV_ISOLATED, the mark the test guard sets); CREW_SKILL_BREW=0 / CREW_SKILL_UV=0 turn them off.
  const skillsInUse=()=>{const out=new Set<string>();try{const t=crewStore.current();if(t)for(const p of teamPins(teamBody(t)))out.add(`${p.id}@v${p.v}`);}catch{}
   try{for(const w of defs.list())for(const p of defPins(defs.get(w.id)))out.add(`${p.id}@v${p.v}`);}catch{}return out;};
  const testRun=!!process.env.CREW_TEST_ENV_ISOLATED;
  const skillPackages=d.skills?new SkillPackages({dataDir:d.dataDir,skills:d.skills,egress:()=>(d.agents as any).egress??null,protect:()=>d.protectedRoots??[d.fmRoot],inUse:skillsInUse,
   brew:process.env.CREW_SKILL_BREW==='0'||testRun?false:undefined,uv:process.env.CREW_SKILL_UV==='0'||testRun?false:undefined,log:(line)=>d.log.emit({type:'skill_prepare',summary:line})}):null;
  engine.deps.skillPackages=skillPackages;
  if(skillPackages)setTimeout(()=>{void skillPackages.prepareInUse().catch(()=>{});},0);
  // a Studio that already approved staffing gets its team seeded from it once (idempotent; src/crew-migrate.ts)
  // CREW_TEAM_SEED=0 keeps per-project staffing only: no team is seeded (a Studio that has a team keeps it)
  // the image maker is seeded from the image pick Studio used before the team (the Codex image adapter's configured model)
  let imageSeatUnfilled=false;
  if(process.env.CREW_TEAM_SEED!=='0')try{const m=migrateCrew(d.dataDir,defs,{imagePick:d.coffeeChoice});if(m.status==='seeded')d.log.emit({type:'crew_seeded',summary:`team seeded from ${m.from!.workflow} v${m.from!.version} (${m.from!.project}); ${m.overrides!.length} workflow overrides`});
   if(m.image==='seeded'&&m.status==='exists')d.log.emit({type:'crew_seeded',summary:`team v${m.version}: the image maker seeded from Studio's configured image model`});imageSeatUnfilled=m.image==='unfilled';}catch(e:any){console.warn(`crew-studio: team seeding: ${e?.message??e}`);}
  const {crewStaffing,guard:staffingGuard}=installTeamStaffingGuard(engine,staffing,crewStore,staffingProject,staffingCapability);
  const crewGuard=installCrewGuard(engine,crewStore);
  // a captain's own workflow confirms at Run exactly the crew its Task will record (the guard's own resolution, judges included)
  defs.ownCrew=(def:any)=>{const t=crewStore.current();return t?resolveCrew(teamBody(t),withJudges(def,judgeSlots(engine,def)),{},t.hash):null;};
  let seatFilled=(_run:string)=>{}; // set once Firstmate's tools exist: a seat card the captain approved resumes the proposals it held (S8)
  const issueTriage=new IssueTriageStore(d.dataDir),issueCategories=new IssueCategoriesStore(d.dataDir);
  const crewTools=installCrewTools(engine,crewStore,{facts:staffingFacts as any,cached:()=>staffingCapabilities as any,send:d.send,onApproved:run=>seatFilled(run)});
  // no image pick to seed the image maker from: raise the seat card now, so the captain sees why image work waits (never a silent block)
  if(imageSeatUnfilled){const def=engine.defs.get('images');if(def)void crewTools.seatGate(def,{key:'crew-migration'}).catch(()=>{});}
  const onboardingTeam=new OnboardingTeam({store:crewStore,admission:d.staffingAdmission,facts:fresh=>staffingFacts({fresh:!!fresh}),preferred:d.onboardingProvider??(()=>null),context:d.onboardingTeamContext??(()=>''),verify:d.onboardingTeamVerify??(async()=>{throw new Error('Native verification is unavailable');})});
  const crewApi=crewRoutes({onboarding:onboardingTeam,judges:def=>judgeSlots(engine,def),roleSkill:(def,role)=>engine.roleSkillUse(def,role) as any,defs,store:crewStore,projects:()=>projects.list().map(p=>({id:p.id,name:p.name})),facts:()=>staffingCapabilities,refreshFacts:()=>staffingFacts({fresh:true}),...process.env.CREW_DETECT_FORCE_MIN_MS!==undefined?{forceMinMs:Number(process.env.CREW_DETECT_FORCE_MIN_MS)}:{}, // tests: 0 lets 重新偵測 run back to back
  library:()=>engine.skillLibrary().library(),skillPackages:()=>skillPackages});
  /** The project's staffing from the team, when the team covers this workflow (null: the per-project staffing flow applies). */
  const teamStaffing=(def:any,projectId:string)=>{if(!staffingApplies(def))return null;const project=def.kind==='coffee-kit'?coffeeStaffingProject(projectId):staffingProject(projectId);return crewStaffing.ensure(def,project);};
  // the review room asks for a project's crew reviewer (a pull request no Task made): a team that covers code-firstmate gives it
  (engine.deps as any).teamStaffing=teamStaffing;
  /** read only: the reviewer the team would give a staffed workflow for a project (nothing written; the review room's offer) */
  (engine.deps as any).teamReviewerPreview=(def:any,projectId:string)=>{try{const team=crewStore.current();if(!team||!staffingApplies(def))return null;
    const d=crewStaffingDraft(def,team,staffingProject(projectId),(r:any)=>({pin:{skill:{ref:r.skill,version:1,sha256:'0'.repeat(64),snapshotSha256:'0'.repeat(64)}},text:''}));
    return 'missing' in d?null:d.draft.roles.reviewer??null;}catch{return null;}};
  /** A staffed code crew's reviewer on its worker's own model (src/domain/independence.ts). It is never refused here: the team's
   *  resolution already moves a reviewing seat to another member's model when the team has one (src/domain/crew.ts), so this
   *  happens on one model or by the captain's own choice. Either way it is said (Start form, merge card) and recorded.
   *  The pair is the effective one (src/domain/staffing.ts reviewPair: a node override wins over its role): each node that
   *  writes the change against each review node, the weakest pair counting; the roles themselves when no node names them. */
  const reviewIndependence=(pair:{worker:Role;reviewer:Role}|null):{level:Level;note?:{en:string;zh:string}}|null=>{
   if(!pair)return null;const w=pair.worker,level=levelOf(w,pair.reviewer),usable=usableNow();if(level!=='same')return{level};
   if(!usable||required('model',usable)==='same'){const why=degradedWhy(usable);return{level,note:{en:`Reviewer: ${LEVEL_TEXT.same.en}.${why.en}`,zh:`Reviewer：${LEVEL_TEXT.same.zh}。${why.zh}`}};}
   const other=usable.find(u=>levelOf(u,w)!=='same');
   return{level,note:{en:`Reviewer: ${LEVEL_TEXT.same.en}. This machine has another model${other?` (${other.provider} ${other.model}${other.runnable?'':`, held now: ${other.held}`})`:''}: give the reviewer seat a different model on the Crew page for an independent review.`,zh:`Reviewer：${LEVEL_TEXT.same.zh}。這台機器還有別的模型${other?`（${other.provider} ${other.model}）`:''}：到船員頁讓 reviewer 座位用不同模型，審查才是獨立的。`}};};
  /** The Start form's readiness of an approved crew, from free probes only (the Codex probe, Claude auth status). A role that is
   *  signed in but not verified yet is ready: Studio verifies it itself when Start is pressed (one bounded request per model). */
  const crewReadiness=(roles:Record<string,Role>,pair:{worker:Role;reviewer:Role}|null)=>{const verify:{role:string;provider:string;model:string;effort:string|null}[]=[];
   for(const[id,role]of Object.entries(roles)){if(roleReady(role))continue;const why=unfixable(id,role,{ignoreBackoff:true});if(why)return{state:'blocked' as const,role:id,reason:why};verify.push({role:id,...role});}
   const ind=reviewIndependence(pair);
   const models=[...new Set(verify.map(v=>`${v.provider} ${v.model}`))];
   return{state:'ready' as const,...verify.length?{verify,note:{en:`Studio verifies ${models.join(', ')} with one small paid request each when you start (kept for the provider's expiry window).`,zh:`按下開始時，Studio 會用一次小額付費請求驗證 ${models.join('、')}（在供應商的有效期內不會重複）。`}}:{},...ind?.note?{independence:{level:ind.level,...ind.note}}:{}};};
  const staffingTools=installFirstmateStaffing(engine,staffing,staffingProject,staffingFacts,d.staffingAdmission,a=>d.staffingApproved?.(a),{verified:(def,params)=>staffingGuard.verified(def,params),capability:staffingCapability},(def,projectId)=>teamStaffing(def,projectId));
  // Board start of a project-staffed workflow (code-firstmate): the approved configuration of the chosen registered
  // project, the same one Firstmate's dispatch binds. Never a bypass: the staffing guard still verifies it at start.
  const boardStaffed=(def:any)=>!!def&&staffingGuard.applies(def)&&def.kind!=='coffee-kit';
  type BoardStaffing={state:'approved';hash:string;version:number;roles:Record<string,{provider:string;model:string;effort:string|null}>}|{state:'missing'|'blocked';code:string;reason:{en:string;zh:string}};
  const boardStaffing=(def:any,projectId:string):BoardStaffing=>{
   let project:StaffingProject;try{project=staffingProject(projectId);}catch(e:any){return{state:'blocked',code:'project_unavailable',reason:{en:String(e?.message??e),zh:'已登錄專案不存在、已停用或無法驗證 / '+String(e?.message??e)}};}
   try{teamStaffing(def,projectId);}catch(e:any){return{state:'blocked',code:'staffing_unverifiable',reason:{en:'The Studio team cannot give this project its crew: '+String(e?.message??e),zh:'無法從 Studio 團隊產生此專案的人員配置。'}};}
   let config;try{config=staffing.current(project);}catch(e:any){return e?.code==='ENOENT'?{state:'missing',code:'staffing_missing',reason:{en:'No crew is approved for this project yet. Approve one on the Crew page first.',zh:'此專案尚未核准代理配置；請先到船員頁核准。'}}:{state:'blocked',code:'staffing_unverifiable',reason:{en:'The approved crew for this project cannot be verified: '+String(e?.message??e),zh:'無法驗證此專案已核准的代理配置。'}};}
   try{staffingGuard.verified(def,{project:projectId,_staffing:config.hash});}catch(e:any){return{state:'blocked',code:'staffing_changed',reason:{en:String(e?.message??e).replace(/^Staffing approval requires confirmation: /,''),zh:'已核准的代理配置與目前流程或技能不符；請重新和 Firstmate 決定代理配置。'}};}
   return{state:'approved',hash:config.hash,version:config.version,roles:Object.fromEntries(Object.entries(config.roles).map(([id,r])=>[id,{provider:r.provider,model:r.model,effort:r.effort}]))};
  };
  const onboarding=new Onboarding(engine,d.m3?.store??new ArtifactStore(d.dataDir));
  const originalFirstmate=installFirstmate(engine,projects,{prepareDispatch:async(workflow,version)=>{const def=engine.defs.get(workflow,version);if(staffingApplies(def))await staffingFacts();},onCoffeeProposal:id=>{try{onboarding.proposal(id);}catch{}},onCoffeeDispatch:(proposal,task)=>{try{onboarding.dispatch(proposal,task);}catch{}},protectedRoots:d.protectedRoots??[],staffingProject,staffingPending:d.staffingPending,teamStaffing,startupAdvice:d.providerLogins?async()=>startupCursorAdvice(await d.providerLogins!().catch(()=>({}))):undefined,crewSeatGate:(def,owner,project)=>crewTools.seatGate(def,owner,project),dispatchCrew:(def,project)=>crewTools.dispatchCrew(def,project)});
  seatFilled=run=>{void originalFirstmate.resumeHeld(run).then(done=>{const n=heldNotice(run,done);if(n)engine.notifyFirstmate?.(n.text,n.summary);}).catch(()=>{});};
  // free drafting: its own store and tools, separate from proposals, staffing and execution
  const drafts=new WorkflowDrafts(d.dataDir,defs,(id,revision)=>{try{d.send('wfdraft',{id,revision});}catch{}});
  const readiness=d.readiness===false?null:installReadiness({engine,defs,drafts,dataDir:d.dataDir,protectedRoots:d.protectedRoots??[d.fmRoot],send:d.send,startOwn:(o:any,g:unknown)=>ownClaude.start(o,g),...(d.readiness??{}),createRuntime:(d.readiness as any)?.createRuntimeOverride??createRuntime});
  const draftTools=installWorkflowDraftTools(drafts,readiness?.tools,def=>{readiness?.versionSaved(def);try{d.send('wf',{id:def.id,version:def.version});}catch{}});
  const issueTriageFlow=installIssueTriage(engine,projects,issueTriage,d.dataDir,{propose:({tainted:_t,...args},owner)=>originalFirstmate.proposeTainted(args,owner) as any,crewOf:(def,project)=>{const t=crewStore.current();return t?resolveCrew(teamBody(t),def,{},t.hash,project).nodes as any:null;},dispatchCrew:(def,project)=>crewTools.dispatchCrew(def,project) as any});
  const categoriesFlow=installIssueCategories(engine,projects,issueCategories,d.dataDir);
  const firstmate={specs:[...originalFirstmate.specs,...staffingTools.specs,...issueTriageFlow.specs,...draftTools.specs,...crewTools.specs],call:(name:string,args:any,owner:any)=>name==='studio_triage_issues'||name==='studio_work_package'?issueTriageFlow.call(name,args,owner):crewTools.specs.some(spec=>spec.name===name)?crewTools.call(name,args,owner):draftTools.specs.some(spec=>spec.name===name)?draftTools.call(name,args,owner):name==='studio_change_staffing'||name==='studio_keep_staffing'||name==='studio_staffing_facts'||name==='studio_staffing_interview'||name==='studio_propose_staffing'?staffingTools.call(name,args,owner):originalFirstmate.call(name,args,owner)};
  // the captain's own workflows start only with the staffing the captain confirmed at Run (never at drafting)
  const previousOwnStart=engine.deps.authorizeStart;
  engine.deps.authorizeStart=(def:any,o:any)=>{previousOwnStart?.(def,o);if(ownWorkflow(def)){const s=ownStaffingPlan(def,defs.ownCrew);if(s.plan.length&&(s.missing.length||o.params?._ownStaffing!==s.hash))throw new Error('Confirm staffing for every agent node when you click Run / 請在按下執行時確認每個代理節點的配置');}};
  // a staffed code Task's reviewer on its worker's own model: recorded on the Task's ledger (review-independence) and said on its
  // merge card, with what this machine could run
  const staffedPair=(def:any,params:any)=>{if(!boardStaffed(def)||!params?._staffing)return null;try{return reviewPair(def,staffingGuard.verified(def,params));}catch{return null;}};
  const initIndependence=engine.deps.initializeRun;
  engine.deps.initializeRun=(run:any,o:any)=>{initIndependence?.(run,o);const pair=staffedPair(run.def,run.params),ind=reviewIndependence(pair);if(!pair||!ind||ind.level!=='same')return;const node=run.def.nodes[0],u=usableNow();
   engine.record(engine.x(run,node,run.nodes[node.id]),'review-independence',{data:{schema:1,level:ind.level,worker:pair.worker,reviewer:pair.reviewer,reachable:u?reachable(u):null,usable:u?.map(x=>`${x.provider}/${x.model}`)??null,en:ind.note?.en??`Reviewer: ${LEVEL_TEXT.same.en}.`,zh:ind.note?.zh??`Reviewer：${LEVEL_TEXT.same.zh}。`}} as any);};
  // the merge card says it plainly when the reviewer ran on the worker's own model (whatever route the body takes)
  const mergeBody=engine.cardBodies?.merge;
  if(mergeBody)engine.cardBodies.merge=async(x:any)=>{const body=await mergeBody(x);try{const e:any=engine.trusted(x.run.id).entries.filter((l:any)=>l.record==='review-independence').at(-1);if(!e||!body||typeof body!=='object')return body;
   return withNote(body as any,{level:e.data?.level,en:String(e.data?.en??''),zh:String(e.data?.zh??'')});}catch{return body;}};
  const ownClaude=installOwnClaudeGrants(engine);
  /**
   * The one staffing step a board-staffed start takes, whoever starts it (the Board's Run, Send for review on a web
   * terminal): fresh staffing facts, the approved crew (and, from a form, the crew it showed), then the signed-in roles not
   * verified yet are verified by Studio before the Task exists. A refusal is the route's typed answer.
   */
  type StartRefusal={ok:false;status:number;body:Record<string,any>};
  async function staffedStartGuard(def:any,pid:string,o:{why:string;expected?:unknown}):Promise<{ok:true;params:{base:string;_staffing:string};autoVerified:string[]}|StartRefusal>{
    await staffingFacts();
    const crew=boardStaffing(def,pid);if(crew.state!=='approved')return{ok:false,status:409,body:{error:`${crew.reason.en} / ${crew.reason.zh}`,code:crew.code,staffing:crew}};
    // the crew the captain saw when the form loaded: a crew approved again since then is reviewed again, never started blind
    if(o.expected!==undefined&&o.expected!==crew.hash)return{ok:false,status:409,body:{error:'The approved crew changed since this form loaded; review it again / 已核准的代理配置在表單載入後已變更，請重新確認',code:'staffing_changed',staffing:{state:'blocked',code:'staffing_changed',reason:{en:'The approved crew changed since this form loaded; review it again',zh:'已核准的代理配置在表單載入後已變更，請重新確認'}}}};
    // a signed-in role not verified yet (or whose facts went stale) is verified by Studio now, before the Task exists
    const ready=await autoVerify(crew.roles,{why:o.why,explicit:true});
    if(ready.state==='blocked')return{ok:false,status:409,body:{error:`${ready.reason.en} / ${ready.reason.zh}`,code:'staffing_not_ready',staffing:{state:'blocked',code:'staffing_not_ready',role:ready.role,reason:ready.reason}}};
    return{ok:true,params:{base:projects.get(pid)!.base,_staffing:crew.hash},autoVerified:ready.verified};
  }
  /** Start the Task; a staffed start's refusal is staffing_not_ready, and what Studio verified itself goes on the Task's own signed ledger. */
  function staffedStartRun(def:any,start:()=>any,autoVerified:string[]):{ok:true;run:any}|StartRefusal{
    let r;try{r=start();}
    catch(e:any){if(!boardStaffed(def))throw e;const message=String(e?.message??e).replace(/^Staffing approval requires confirmation: /,'');return{ok:false,status:409,body:{error:message,code:'staffing_not_ready',staffing:{state:'blocked',code:'staffing_not_ready',reason:{en:message,zh:'已核准的代理目前無法開始；請更新代理能力狀態後再試。'}}}};}
    if(autoVerified.length)try{const run=engine.get(r.id)!,node=run.def.nodes[0];engine.record(engine.x(run,node,run.nodes[node.id]),"staffing-auto-verify",{data:{schema:1,verified:autoVerified,by:"studio",at:new Date().toISOString()}} as any);}catch{}
    return{ok:true,run:r};
  }
  const githubReview=installGitHubReviewWorkflow(engine,projects,d.dataDir,d.protectedRoots??[]);
  installReadinessViews(engine);
  engine.load();
  // a seat card approved just before Studio stopped: propose the work it held now (S8)
  void originalFirstmate.resumePending().then(all=>{for(const{seatRun,done}of all){const n=heldNotice(seatRun,done);if(n)engine.notifyFirstmate?.(n.text,n.summary);}}).catch(()=>{});

  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  // Whether a bound site is intact is cached per version under a fingerprint of its manifest files
  // (path + sha256) and a cheap stat of each file on disk (size, mtime, ctime). Any edit, removal or
  // replacement of a file changes the stat, so the next read re-hashes; only an intact result is kept,
  // so a damaged site is re-checked on every read rather than remembered until restart.
  const intactSites = new Map<string, string>();
  const siteIntact = (id: string, n: number, v: { files: { path: string; sha256: string }[] }) => {
    const dir = d.m3!.store.filesDir(id, n); let fp = "";
    for (const f of v.files) { let st = "-"; try { const s = statSync(join(dir, f.path)); st = `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}`; } catch {} fp += `${f.path}\u0000${f.sha256}\u0000${st}\u0001`; }
    const k = `${id}\u0000${n}`; if (intactSites.get(k) === fp) return true;
    const ok = !d.m3!.store.verify(id, n).length;
    if (ok) intactSites.set(k, fp); else intactSites.delete(k);
    return ok;
  };
  // the crew a Task started with, from its signed crew-resolved record (src/crew-guard.ts): each staffed node's seat, named as the
  // team that resolved it names it (a workflow-node override's seat included), and its pick. Null when no record exists (a staffed
  // code workflow, a Task started before the team) or the ledger does not verify: the Board then names no seat.
  const crewOf = (r: any, t: { ok: boolean; entries: any[] }) => {
    const d = t.ok ? t.entries.filter((e) => e.record === "crew-resolved").at(-1)?.data : null; if (!d?.nodes) return null;
    const team = crewStore.byHash(d.team);
    return { team: d.team, nodes: Object.fromEntries(Object.entries(d.nodes as Record<string, any>).map(([n, v]) => [n, { seat: v.seat, label: seatLabel(team ? teamBody(team) : null, v.seat, r.def), provider: v.provider, model: v.model }])) };
  };
  const runView = (id: string, who?: { kind: string }) => {
    const r = engine.get(id); if (!r) return null;
    const ledger = engine.ledger(id);
    const t = engine.trusted(id);
    const pins=[...Object.values(r.ctx.deliver??{}).map((v:any)=>({id:v.id,n:v.n})),...t.entries.filter(e=>e.record==='coffee-output-v1'&&e.data?.part==='site').map(e=>({id:e.data.artifact,n:e.data.n}))];
    const outputMap=new Map<string,any>();for(const pin of pins){const a=d.m3?.store.get(pin.id),v=d.m3?.store.version(pin.id,pin.n),href=websiteHref(a,v);if(href&&v&&siteIntact(pin.id,pin.n,v))outputMap.set(pin.id,{artifact:pin.id,version:pin.n,href});}
    // a text output (the startup competition write-up): its signed pin, opened in the review page, only while the ledger verifies and its bytes still match
    if(t.ok)for(const e of t.entries.filter(e=>e.record==='startup-artifact')){const p=e.data,v=d.m3?.store.version(p?.artifact,p?.version);if(v&&v.sha256===p.sha256&&siteIntact(p.artifact,p.version,v))outputMap.set(p.artifact,{artifact:p.artifact,version:p.version,href:`#/review/${encodeURIComponent(p.artifact)}/${p.version}`,kind:'doc',label:'competition'});}
    // the run page offers "Continue original task…" only to the desktop captain, and only when the engine would make an offer
    const continuable = who?.kind === "desktop" && engine.continuable(id);
    // Merged (reconciled) only while the ledger verifies and holds the entry it names
    const reconciled = r.reconciled && t.ok && t.entries.some((e) => e.record === "reconciled-merge" && e.seq === r.reconciled!.ledger) ? r.reconciled : null;
    return { ...r, reconciled, logFault: engine.logFault(id), reconcilable: who?.kind === "desktop" && !!engine.reconcilable?.(r), reviewRoom: engine.reviewRoom?.taskEntry(r) ?? null, title: taskTitle(r), request: r.text, claudeVerificationAvailable:ownClaude.available(id), nodes: readinessNodes(r, id=>engine.cards.get(id)), outputs:[...outputMap.values()], continuable, walked: [...new Set(engine.events(id).filter((e) => e.type === "edge_taken").map((e) => e.edge))], events: engine.timeline(id).slice(-400), ledger, ledgerOk: t.ok, crew: crewOf(r, t), roundCap: engine.policy(r, "round_cap", 3), ledgerBad: [...t.bad], ledgerTruncated: t.truncated, done: engine.doneLines(r), cards: engine.cards.list({ run: id }).map(c=>engine.cards.view(c)) };
  };
  const checkView = (m: any) => { const p = engine.params(m, null, {}); return { ref: m.ref, id: m.id, pack: m.pack, version: m.version, title: m.title, description: m.description, applies_to: m.applies_to, kind: m.kind, blocking: m.blocking, needs: m.needs,
    params: m.params, policy_bind: m.policy_bind, effective: p.params, from: p.from, timeout_s: m.timeout_s, network: m.network, impl: m.native ? "native" : m.adapter ? "adapter" : m.kind === "judged" ? "judge" : "executable", quorum: m.judge?.quorum ?? null, hasSample: !!m.sample, at: m.at }; };

  const grantNonces = new Map<string, number>();
  /** the review room's last "Check for new commits" per room (a rate limit on GitHub reads) */
  const roomChecks = new Map<string, number>();
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!/^\/api\/(workflow-packages|workflow-names|wf|wruns|scards|checks|policies|intake|coffee|onboarding|github-review|team|issue-triage|issue-categories|review-room)(\/|$)/.test(p)) return null;
    let b: any = {}; if (writing) {
      if(p.startsWith('/api/workflow-packages')){
        const cap=12*1024*1024,reader=req.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
        if(reader){while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>cap){await reader.cancel();return json({error:'Package request exceeds 12 MiB'},413);}chunks.push(r.value);}}
        try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json({error:'Invalid package request JSON'},400);}
      }else{try { b = await req.json(); } catch {}}
    }
    const by = who.kind === "phone" ? "captain (phone)" : "captain";
    if(p==='/api/github-review/scan'||p==='/api/github-review/template'||p==='/api/github-review/community'){if(req.method!=='POST'||!writing)return json({error:'Authenticated POST required'},405);if(who.kind!=='desktop')return json({error:'Confirm GitHub reviewer configuration on desktop'},403);try{return json(p.endsWith('/community')?await githubReview.community(b.project,req.signal):p.endsWith('/scan')?await githubReview.scan(b.project,b.url,req.signal):await githubReview.save(b,req.signal));}catch{return json({error:'GitHub review discovery/configuration could not be verified. Check registered project grant, PR URL and current access; no GitHub write was performed.',code:'github_review_unverified'},409);}}
    // the phone answers cards; a triage's rulings are its court card's answer (src/issue-triage-workflow.ts rule)
    if (writing && who.kind === "phone" && !/^\/api\/scards\//.test(p) && !/^\/api\/issue-triage\/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\/court\/R-\d{1,9}$/.test(p)) return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    try {
      {const r=await crewApi(p,url,req.method,writing,b,who,req.signal);if(r)return r;}
      if(p==='/api/onboarding'){
        if(who.kind!=='desktop')return json({error:'Use onboarding on the authenticated desktop'},403);
        if(!writing)return json(onboarding.view());
        if(req.method!=='POST')return json({error:'POST required'},405);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['action','choice'].includes(k)))return json({error:'Invalid onboarding request'},400);
        if(b.action==='choose')return json(onboarding.choose(b.choice));
        if(b.action==='skip'&&b.choice===undefined)return json(onboarding.pause(true));
        if(b.action==='resume'&&b.choice===undefined)return json(onboarding.pause(false));
        return json({error:'Unknown onboarding action'},400);
      }
      if(p==='/api/intake/staffing'){
        const args=writing?b:{project:url.searchParams.get('project'),workflow:url.searchParams.get('workflow'),version:Number(url.searchParams.get('version'))};
        const operation=writing&&b?.confirm===true?'studio_propose_staffing':'studio_staffing_interview';
        if(writing&&Object.hasOwn(args,'confirm')){delete args.confirm;}
        return json(await staffingTools.call(operation,args,{key:`desktop:${randomBytes(16).toString('hex')}`,captain:true,text:args.defaults==='reset'?'Captain explicitly requested reset to available staffing defaults':args.defaults==='use'?'Captain explicitly requested available staffing defaults':'Captain staffing configuration request',live:()=>!req.signal.aborted}));
      }
      if(p.startsWith('/api/workflow-packages')){
        if(who.kind!=='desktop')return json({error:'Use package transfer on the authenticated desktop'},403);
        const owner=packageSha((req.headers.get('cookie')??'')+'|'+(req.headers.get('x-crew-session')??''));
        if(p==='/api/workflow-packages'&&req.method==='GET')return json({packages:packages.list(),adoptionHolds:adoption.holds()});
        const saved=/^\/api\/workflow-packages\/(pkg-[a-f0-9]{24})\/download$/.exec(p);if(saved&&req.method==='GET'){const value=packages.read(saved[1]);return new Response(value.bytes,{headers:{'content-type':'application/zip','content-disposition':`attachment; filename="${saved[1]}.crew.zip"`,'cache-control':'no-store'}});}
        if(req.method!=='POST'||!writing)return json({error:'Authenticated POST required'},405);
        if(p==='/api/workflow-packages/preview')return json(packages.preview(owner,b?.archive));
        if(p==='/api/workflow-packages/file')return json(packages.file(owner,b?.token,b?.path));
        if(p==='/api/workflow-packages/cancel')return json(packages.cancel(owner,b?.token));
        if(p==='/api/workflow-packages/commit')return json(packages.commit(owner,b?.token),201);
        if(p==='/api/workflow-packages/reopen')return json(packages.reopen(owner,b?.id));
        if(p==='/api/workflow-packages/adopt'){const value=packages.read(b?.id);if(b?.sha256!==value.sha256)return json({error:'Package changed; inspect again'},409);try{return json(adoption.adopt(value.bytes,b.id,defs,{ready:typeof engine.natives['artifact-ready']==='function',accept:typeof engine.cardModes['deliver-accept']?.start==='function'}),201);}catch(e:any){return json({error:'Package remains held: '+adoption.text(e),code:'workflow_package_held'},409);}}
        if(p==='/api/workflow-packages/delete')return json(packages.remove(b?.id));
        return json({error:'Unknown package operation'},404);
      }
      {const packaged=/^\/api\/wf\/([a-z0-9-]+)\/package$/.exec(p);if(packaged){
        if(req.method!=='GET')return json({error:'GET required'},405);if(who.kind!=='desktop')return json({error:'Export packages on desktop'},403);
        const versions=url.searchParams.getAll('v'),value=versions[0];if(versions.length!==1||!value||!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value)))return json({error:'Choose one explicit saved version'},400);
        const stored=defs.versions(packaged[1]).find(v=>v.version===Number(value));if(!stored)return json({error:'No such saved workflow version'},404);
        return new Response(snapshotPackage(stored,d.dataDir),{headers:{'content-type':'application/zip','content-disposition':`attachment; filename="${stored.id}-v${stored.version}.crew.zip"`,'cache-control':'no-store'}});
      }}
      // ---------- definitions ----------
      if(p==="/api/coffee/design"&&writing){if(req.method!=="POST")return json({error:"POST required"},405);if(who.kind!=="desktop")return json({error:"Review coffee design on the desktop"},403);return json({plan:validateCoffeeDesign(b?.plan),canonical:coffeeDesignJSON(b?.plan)});}
      {const exported=/^\/api\/wf\/([a-z0-9-]+)\/export$/.exec(p);if(exported){
        if(req.method!=='GET')return json({error:'GET required'},405);
        if(who.kind!=='desktop')return json({error:'Export definitions on the authenticated desktop'},403);
        const versions=url.searchParams.getAll('v'),value=versions[0];
        if(versions.length!==1||!value||!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value)))return json({error:'Choose one explicit positive saved version'},400);
        const stored=defs.versions(exported[1]).find(d=>d.version===Number(value));
        if(!stored)return json({error:'No such saved workflow version'},404);
        return json(workflowDefinitionExport(stored));
      }}
      // display names (src/runtime/workflow-names.ts): what the captain sees; no definition, version or hash changes
      if(p==='/api/workflow-names'){
        if(!writing)return json({names:defs.names.map()});
        if(req.method!=='POST')return json({error:'POST required'},405);
        if(who.kind!=='desktop')return json({error:'Rename workflows on the desktop',code:'desktopOnly'},403);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['workflow','name'].includes(k))||typeof b.workflow!=='string')return json({error:'Pass the workflow id and its new name (blank resets it)'},400);
        if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(b.workflow)||!defs.versions(b.workflow).length)return json({error:'no such workflow'},404);
        const before=defs.displayName(b.workflow);let done;
        try{done=defs.rename(b.workflow,b.name,by);}catch(e:any){return json({error:e.message},e instanceof DisplayNameError?400:409);}
        const after=defs.displayName(b.workflow);
        d.log.emit({type:'workflow_renamed',workflow:b.workflow,actor:by,summary:`${b.workflow} ${done.renamed?`renamed "${before}" → "${after}"`:`name reset to "${after}"`} by ${by}`,data:{from:before,to:after,reset:!done.renamed}});
        // every open Board (other tabs, the phone) redraws with the new name
        try{d.send('workflow-names',{workflow:b.workflow,names:defs.names.map()});}catch{}
        return json({workflow:b.workflow,displayName:after,renamed:done.renamed,defaultName:DEFAULT_DISPLAY_NAMES[b.workflow]??defs.get(b.workflow)?.name??b.workflow,names:defs.names.map()});
      }
      if (p === "/api/wf" && !writing) return json({ workflows: defs.catalog(), held: defs.heldCatalog(), trash:defs.trashCatalog(), names:defs.names.map(), checks: engine.registry.all().map(checkView) });
      if(readiness){const gated=await readiness.route(p,url,req.method,writing,b,by,who);if(gated)return gated;}
      const drafted=await draftRoute(drafts,p,req.method,writing,b,by);if(drafted)return drafted;
      if (p === "/api/wf" && writing) {
        if(req.method!=="POST")return json({error:"use POST to create a workflow"},405);
        const def=defs.create(b?.id,b?.name,by,b?.locale??"en",b?.template,b?.origin);
        d.log.emit({type:"workflow_created",workflow:def.id,summary:`${def.id} v1 created by ${by}`});
        return json({def},201);
      }
      {const copy=/^\/api\/wf\/([a-z0-9-]+)\/copy$/.exec(p);if(copy){
        if(req.method!=='POST')return json({error:'POST required'},405);if(who.kind!=='desktop')return json({error:'Save templates on the desktop'},403);
        const def=defs.copyTemplate(copy[1],b?.version,b?.id,b?.name,b?.asTemplate,by);
        d.log.emit({type:'workflow_created',workflow:def.id,summary:`${def.id} copied from ${copy[1]} v${b.version}`});return json({def},201);
      }}
      {const trash=/^\/api\/wf\/([a-z0-9-]+)\/(trash|restore)$/.exec(p);if(trash){
        if(req.method!=='POST'||!writing)return json({error:'Authenticated POST required'},405);
        if(who.kind!=='desktop')return json({error:'Manage workflow Trash on the desktop'},403);
        if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['base','revision'].includes(k)))return json({error:'Pass the saved base version and Trash revision'},400);
        try{const state=defs.setTrash(trash[1],b.base,b.revision,trash[2]==='trash',by);d.log.emit({type:'workflow_trash_changed',workflow:trash[1],summary:`${trash[1]} ${state.deleted?'moved to Trash':'restored'} by ${by}`});return json({state});}catch(e:any){return json({error:e.message},409);}
      }}
      if (p === "/api/wf/validate" && writing) return json({ problems: validate(normDef(b?.def ?? {}), defs.known, undefined, defs.skillInfo ?? undefined) });
      let m = /^\/api\/wf\/([a-z0-9-]+)(?:\/(layout))?$/.exec(p);
      if (m) {
        const id = m[1];
        if (m[2] === "layout" && writing) return json({ layout: defs.setLayout(id, Number(b?.version), b?.positions ?? {}) });
        if (!writing) {
          const v = url.searchParams.get("v"); const def = defs.get(id, v ? Number(v) : undefined); if (!def) return json({ error: "no such workflow" }, 404);
          // displayName is beside def, never in it: the editor saves def back, and a rename must not become a definition change
          return json({ def, displayName:defs.displayName(id), renamed:!!defs.names.overrides()[id], defaultName:DEFAULT_DISPLAY_NAMES[id]??defs.versions(id).at(-1)?.name??id, personal:defs.personal(id), trash:defs.trashState(id), selectable:defs.selectable(id,def.version), held:defs.held(id), coffeeFilmStatus:def.kind==="coffee-kit"?d.coffeeFilmStatus??{ready:false,reason:"Local film capability is unavailable"}:null, coffeeDesign:def.kind==="coffee-kit"?COFFEE_DESIGN_FIELDS:null, coffeeChoice:def.kind==="coffee-kit" ? d.coffeeChoice?.() ?? null : null, problems: validate(def, defs.known, undefined, defs.skillInfo ?? undefined), versions: defs.versions(id).map((x) => ({ version: x.version, createdAt: x.createdAt, by: x.by, note: x.note, parent: x.parent, diff: x.diff })),
            runs: engine.list().filter((r) => r.workflow === id).map((r) => ({ id: r.id, version: r.version, status: r.status, result: r.result, merged: !!r.ctx?.merged, title: r.title, createdAt: r.createdAt })) });
        }
        // every workflow's node settings are checked the same way (provider, model, effort, agent or loop only); a role-skill ref a bundled node already had is kept as is
        {const cur=defs.get(id);for(const n of Array.isArray(b?.nodes)?b.nodes:[]){try{const kept=!ownWorkflow(cur)&&n?.skill!==undefined&&cur?.nodes.find(x=>x.id===n.id)?.skill===n.skill;checkNodeStaffing(kept?{...n,skill:undefined}:n);}catch(e:any){return json({error:e.message},400);}}}
        if(readiness){const refusal=readiness.editRefusal(id,b);if(refusal)return json(refusal,400);}
        const saved = defs.save(id, b, by, b?.note);
        readiness?.versionSaved(saved);
        d.log.emit({ type: "workflow_saved", workflow: id, summary: `${id} v${saved.version} saved by ${by}`, data: { diff: saved.diff } });
        return json({ def: saved, diff: saved.diff });
      }
      // ---------- checks and policies ----------
      if (p === "/api/checks" && !writing) return json({ checks: engine.registry.all().map(checkView) });
      if (p === "/api/checks/try" && writing) {
        const man = engine.registry.get(String(b?.use ?? "")); if (!man) return json({ error: "no such check" }, 404);
        if (man.native || man.kind === "judged" || man.kind === "hook") return json({ error: `${man.ref} reads a live run (${man.native ? "native" : man.kind}); try it on a run instead` }, 409);
        const dir = join(d.dataDir, "try", `${Date.now().toString(36)}-${man.id}`); mkdirSync(join(dir, "out"), { recursive: true });
        const sample = b?.sample && typeof b.sample === "object" ? b.sample : man.sample ?? {};
        const pr = engine.params(man, { use: man.ref, params: b?.params ?? {} }, {});
        if (pr.errors.length) return json({ error: `params: ${pr.errors.join("; ")}` }, 400);
        const input = { run: "try", node: "try", round: 1, artifact: null, previous: null, spec: null, workdir: null, ...sample, params: pr.params, out: join(dir, "out") } as any;
        const res = await engine.exec({} as any, man, { use: man.ref }, input, dir);
        return json({ input: { ...input, out: "out/" }, result: res });
      }
      if (p === "/api/policies" && !writing) return json({ execution: executionMode(), org: engine.policies.org(), projects: projects.list().map((x) => ({ id: x.id, name: x.name, policy: engine.policies.project(x.id) })) });
      // opening a window takes a fresh confirmation: the page fetches a one-time code (same origin only) and the captain confirms with it
      if (p === "/api/policies/auth-window/confirm" && !writing) {
        if (who.kind !== "desktop") return json({ error: "open an authorization window on the Mac", code: "desktopOnly" }, 403);
        const nonce = randomBytes(12).toString("hex"); grantNonces.set(nonce, Date.now() + 120_000); return json({ confirm: nonce, expires_s: 120 });
      }
      if (p === "/api/policies/auth-window" && writing) {
        if (who.kind !== "desktop") return json({ error: "open an authorization window on the Mac", code: "desktopOnly" }, 403);
        const exp = grantNonces.get(String(b?.confirm ?? "")); grantNonces.delete(String(b?.confirm ?? ""));
        if (!b?.revoke && !(exp && exp > Date.now())) return json({ error: "confirm the window in Studio first (a fresh, one-time confirmation)", code: "confirm" }, 403);
        if (b?.revoke) return json(engine.grants.revoke(String(b.revoke), "captain (desktop)"));
        return json(engine.grants.add({ kinds: Array.isArray(b?.kinds) ? b.kinds : [], until: String(b?.until ?? ""), project: b?.project ?? null }, "captain (desktop)"));
      }
      if (p === "/api/policies/auth-window" && !writing) return json({ grants: engine.grants.all() });
      if (p === "/api/policies" && writing) { if (b?.patch && "auth" in b.patch) return json({ error: "authorization windows are opened with /api/policies/auth-window" }, 400);
        if (refusesRulesPatch(b?.patch)) return json({ error: "operating rules are edited by the captain in Settings, not through the policy API", code: "captainOnly" }, 403);
        try { if (b?.level === "project" && b?.project) engine.policies.setProject(String(b.project), b.patch ?? {}); else engine.policies.setOrg(b?.patch ?? {}); }
        catch (e: any) { if (e instanceof PolicyUnreadable) return json({ error: e.message, code: e.code }, 409); throw e; }
        return json({ ok: true, org: engine.policies.org() }); }
      // ---------- intake ----------
      if (p === "/api/intake" && writing) return json(classifyIntent(defs, String(b?.text ?? ""), engine.policies.get("sensitive_paths", { project: b?.project ? String(b.project) : null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []));
      const coffeeRecovery=/^\/api\/wruns\/(R-\d+)\/coffee-recovery$/.exec(p);
      if(coffeeRecovery&&writing){if(req.method!=='POST')return json({error:'POST required'},405);if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length)return json({error:'Recovery refresh accepts no production choices'},400);if(who.kind!=='desktop')return json({error:'Refresh recovery on the Mac'},403);if(!coffee)return json({error:'Coffee workflow unavailable'},409);return json(await coffee.refreshRecovery(coffeeRecovery[1]));}
      // ---------- runs ----------
      // the default list hides archived runs; ?archived=1 lists them too
      // what the Start form needs for one workflow: whether it runs on a registered project, and each project's crew state
      if (p === "/api/wruns/start-options" && !writing) {
        const wf=String(url.searchParams.get("workflow")??""),def=defs.get(wf);if(!def||!defs.selectable(wf))return json({error:"This workflow is not available for new tasks",code:"workflow_unavailable"},409);
        const projectScoped=def.kind==="code",staffed=boardStaffed(def);if(staffed)try{await staffingFacts();}catch{staffingCapabilities=[];} // free probes only (Codex probe, Claude auth status)
        const crewOf=(id:string)=>{const crew=boardStaffing(def,id);if(crew.state!=='approved')return crew;const ready=crewReadiness(crew.roles,staffedPair(def,{project:id,_staffing:crew.hash}));return ready.state==='blocked'?{state:'blocked' as const,code:'staffing_not_ready',role:ready.role,reason:ready.reason}:{...crew,readiness:ready};};
        const providerAdvice=def.kind==="startup-recursion"&&d.providerLogins?startupCursorAdvice(await d.providerLogins().catch(()=>({}))):null;
        return json({workflow:wf,version:def.version,projectScoped,staffing:staffed,crewHref:staffed?"#/team":null,...providerAdvice?{providerAdvice}:{},projects:projectScoped?projects.list().filter(x=>!!x.path).map(x=>({id:x.id,name:x.name,base:x.base,staffing:staffed?crewOf(x.id):null})):[]});
      }
      if (p === "/api/wruns" && !writing) return json({ runs: engine.list().filter((r) => url.searchParams.get("archived") === "1" || !r.archived).map((r) => ({ id: r.id, workflow: r.workflow, version: r.version, title: taskTitle(r), request: r.text, status: r.status, result: r.result, createdAt: r.createdAt, updatedAt: r.updatedAt, endedAt: r.endedAt, error: r.error,
        childRun: (() => { const child = engine.get(r.ctx?.childRun); return child?.params?._firstmateProposal === r.id ? child.id : null; })(),
        archived: !!r.archived, merged: !!r.ctx?.merged, reconciled: r.reconciled && (() => { const t = engine.trusted(r.id); return t.ok && t.entries.some((e) => e.record === "reconciled-merge" && e.seq === r.reconciled!.ledger); })() ? r.reconciled : null, cancelReason: r.cancelReason ?? null,
        current: Object.entries(r.nodes).filter(([, n]) => ["running", "waiting"].includes(n.state)).map(([k, n]) => ({ node: k, state: n.state, waiting: n.waiting ?? null, label: r.def.nodes.find((x) => x.id === k)?.label ?? k })), door: engine.cards.list({ run: r.id }).find((c) => c.door)?.door ?? null, recovered: r.recovered })),
        cards: engine.cards.list({ open: true }).map(c=>engine.cards.view(c)) });
      if (p === "/api/wruns" && writing) {
        // every start refusal carries its typed failure (runtime/failures.ts), never only a string
        let autoVerified:string[]=[];
        const refuse = (o: Record<string, unknown>, st: number, code: FailureCode) => json({ ...o, failure: failure(code, String(o.error ?? ""), { source: "params" }) }, st);
        const text = String(b?.text ?? "").trim(); if (!text && !b?.workflow) return refuse({ error: "say what you want done" }, 400, "invalid-input.params");
        const cls = classifyIntent(defs, text, engine.policies.get("sensitive_paths", { project: b?.params?.project ? String(b.params.project) : b?.project ? String(b.project) : null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []);
        const wf = b?.workflow || cls.workflow; if (!wf) return refuse({ error: "Choose a workflow below; your request is still saved. / 請從下方選擇流程；你輸入的需求已保留。", code: "workflow_required", classifier: cls }, 409, "invalid-input.params");
        {const held=defs.held(wf);if(held)return refuse({error:`This workflow is ${held.en}. It stays in the catalog for editing. / 此流程${held.zh}，仍可在流程目錄中編輯。`,code:"workflow_held",held},409,"invalid-input.config");}
        if(!defs.selectable(wf,b?.version?Number(b.version):undefined))return refuse({error:"This workflow is internal or retired. Choose an available workflow. / 此流程為內部或已退役流程，請選擇可用流程。",code:"workflow_unavailable"},409,"invalid-input.config");
        // "_" params are Studio's own pins (staffing, crew, proposal bindings): never taken from a caller, only set below
        let params=Object.fromEntries(Object.entries(b?.params??{}).filter(([k])=>!k.startsWith('_'))) as Record<string,any>;
        const chosenDef=defs.get(wf,b?.version?Number(b.version):undefined);
        // Validate the selected version's declared inputs before allocating a Task or checking staffing.
        const missing=Object.entries(chosenDef?.params??{}).filter(([key,spec])=>spec.required&&!(String(params[key]??spec.default??'').trim())).map(([key])=>key);
        if(missing.length)return refuse({error:`Required workflow inputs / 必須提供流程輸入: ${missing.join(', ')}`,code:'param_required',params:missing},400,'invalid-input.params');
        for(const [key,spec] of Object.entries(chosenDef?.params??{})){
          if(params[key]===undefined)continue;
          if(typeof params[key]==='string'&&params[key].trim()===''){params[key]='';continue;} // blank means the declared default (file-organization: a sample folder)
          if(typeof params[key]!=='string'||spec.pattern&&!new RegExp(spec.pattern).test(params[key]))return refuse({error:`Invalid workflow input / 流程輸入格式不正確: ${key}`,code:'param_invalid',params:[key]},400,'invalid-input.params');
        }
        if(ownWorkflow(chosenDef)&&ownStaffingPlan(chosenDef!,defs.ownCrew).plan.length){ // nothing to staff: a card-only workflow just starts
          const staffing={...ownStaffingPlan(chosenDef!,defs.ownCrew),claudeVerification:ownClaudePlan(chosenDef,defs.ownCrew)};
          if(staffing.missing.length)return refuse({error:'Choose a provider, model and (for Codex) effort for every agent node before Run / 執行前請為每個代理節點選擇供應商、模型與（Codex）推理強度',code:'staffing_incomplete',staffing},409,"env.staffing");
          if(b?.staffingConfirm!==staffing.hash||(staffing.claudeVerification&&hashInput({value:b?.claudeVerification??null})!==hashInput({value:staffing.claudeVerification})))return refuse({error:'Confirm who works on each node before this Task starts / 開始任務前請確認每個節點的人員配置',code:'staffing_confirmation_required',staffing},409,"env.staffing");
          params._ownStaffing=staffing.hash;
        }
        if(boardStaffed(chosenDef)){
          if(params.repo)return json({error:'Choose a registered project; a repository path cannot carry approved staffing / 請選擇已登錄專案；直接指定儲存庫路徑無法帶入已核准的代理配置',code:'project_required'},400);
          const pid=String(params.project??'');if(!pid)return json({error:'Choose a registered project for this workflow / 請為此流程選擇已登錄專案',code:'project_required'},400);
          const g=await staffedStartGuard(chosenDef,pid,{why:`start of ${wf} on ${pid}`,expected:b?.staffingExpected});
          if(!g.ok)return json(g.body,g.status);
          autoVerified=g.autoVerified;params={...params,...g.params};
        }
        if(chosenDef?.kind==="coffee-kit") {
          let config;try{config=staffing.current(coffeeStaffingProject(params.project));}catch{return refuse({error:'Discuss and approve each coffee role before starting',code:'coffee-staffing-required'},409,"env.staffing");}const image=config.roles['image-worker'];
          if(!image||image.provider!=='codex'&&image.provider!=='cursor')return refuse({error:"Confirm an available dedicated Codex image role; no vendor fallback",code:"coffee-staffing-required"},409,"env.staffing");
          params={...params,_staffing:config.hash};
        }
        const started=staffedStartRun(chosenDef,()=>ownClaude.start({ workflow: wf, version: b?.version ? Number(b.version) : undefined, title: b?.title, text: ownWorkflow(chosenDef) ? ownBrief(chosenDef, text, params) : text, params, by, classifier: cls },b?.claudeVerification),autoVerified);
        if(!started.ok)return json(started.body,started.status);
        return json(runView(started.run.id, who));
      }
      const recovery=/^\/api\/wruns\/(R-\d+)\/continuation\/(offer|confirm)$/.exec(p);
      const claudeVerification=/^\/api\/wruns\/(R-\d+)\/claude-verification\/(offer|confirm)$/.exec(p);
      if(claudeVerification&&writing){if(req.method!=="POST")return json({error:"POST required"},405);if(who.kind!=="desktop")return json({error:"Only the desktop captain can authorize paid verification"},403);const id=claudeVerification[1];if(claudeVerification[2]==="offer")return json(ownClaude.offer(id));await ownClaude.confirm(id,b,by);return json(runView(id,who));}
      const failureRefresh=/^\/api\/wruns\/(R-\d+)\/failure-refresh$/.exec(p);
      if(failureRefresh&&writing){if(req.method!=="POST")return json({error:"POST required"},405);if(who.kind!=="desktop")return json({error:"Only the desktop captain can refresh failure diagnostics"},403);if(!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).length)return json({error:"Failure refresh accepts no execution choices"},400);engine.refreshFailure(failureRefresh[1]);return json(runView(failureRefresh[1],who));}
      if(recovery&&writing){if(who.kind!=="desktop")return json({error:"Only the desktop captain can continue a closed task"},403);const id=recovery[1];return json(recovery[2]==="offer"?engine.continuationOffer(id):(engine.confirmContinuation(id,String(b?.token??""),String(b?.confirm??"")),runView(id, who)));}
      // an app's before / after captures (a domain check makes them): the PNGs, and the built pages ("Open the app"), served sandboxed: no script, no request out
      // the agent node runs working now, for the Crew page: run, node, role, model, round, elapsed, last activity (redacted)
      if (p === "/api/wruns/agents" && !writing) {
        const out: any[] = [], seen = new Set<string>();
        for (const r of engine.list()) { if (["succeeded", "failed", "cancelled"].includes(r.status)) continue;
          for (const [nid, rn] of Object.entries(r.nodes)) { if (rn.state !== "running" || !rn.job) continue;
            const def = r.def.nodes.find((n: any) => n.id === nid) as any; const j = d.agents.jobs.get(rn.job); if (!j || j.status !== "running") continue; const last = j.log.at(-1);
            seen.add(j.id); out.push({ job: j.id, run: r.id, runTitle: r.title, workflow: r.workflow, node: nid, label: def?.label ?? nid, role: def?.role ?? null, provider: j.provider, model: j.model, round: rn.visits, attempt: rn.attempt,
              startedAt: j.started, tools: j.tools, lastActivity: last ? { at: last.ts, kind: last.kind, text: redactText(last.text).slice(0, 240) } : null }); } }
        // Helper/coordinator jobs can belong to a Task without owning rn.job. Only exact Studio Task refs qualify.
        for (const j of d.agents.jobs.values()) {
          if(j.status!=="running"||seen.has(j.id)||!j.ref)continue;
          const r=engine.get(j.ref);if(!r||["succeeded","failed","cancelled"].includes(r.status))continue;
          const last=j.log.at(-1);
          out.push({job:j.id,run:r.id,runTitle:r.title,workflow:r.workflow,node:null,label:j.title,role:null,provider:j.provider,model:j.model,round:null,startedAt:j.started,tools:j.tools,lastActivity:last?{at:last.ts,kind:last.kind,text:redactText(last.text).slice(0,240)}:null});
        }
        return json({ agents: out, localJobs:coffee?.localJobs()??[] });
      }
      m = CAPTURE_PATH.exec(p);
      if (m && !writing) return engine.get(m[1]) ? captureResponse(engine.rdir(m[1]), m[2], m[3], m[4]) : json({ error: "no such run" }, 404);
      m = /^\/api\/wruns\/(R-\d+)(?:\/(pause|resume|cancel|file|events|evidence|archive|delete|reconcile-merge)|\/nodes\/([a-z0-9-]+)\/agent)?$/.exec(p);
      if (m) {
        const id = m[1]; if (!engine.get(id)) return json({ error: "no such run" }, 404);
        if (m[3] && writing) return json(engine.setAgent(id, m[3], { provider: String(b?.provider ?? ""), model: b?.model ? String(b.model) : null, ...(b?.effort!==undefined?{effort:b.effort===null?null:String(b.effort)}:{}) }) && runView(id, who));
        if (m[2] === "file") {
          const root = realpathSync(engine.rdir(id)); const rel = String(url.searchParams.get("path") ?? "");
          // realpath of the file itself, not only the root: a symlink inside the folder never leads out of it
          const f = normalize(join(root, rel)); if (!f.startsWith(root + "/") || !existsSync(f) || !realInside(root, f) || statSync(f).isDirectory()) return new Response("not found", { status: 404 });
          return new Response(Bun.file(f), { headers: { "content-type": /\.png$/.test(f) ? "image/png" : /\.mp4$/.test(f) ? "video/mp4" : "text/plain; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'" } });
        }
        if (m[2] === "evidence" && !writing) {
          // one evidence file of one ledger entry (a merge card's proof link): only a file the entry lists, inside the entry's folder
          const e: any = engine.ledger(id).find((l) => l.seq === Number(url.searchParams.get("seq"))); const rel = String(url.searchParams.get("file") ?? "");
          if (!e?.dir || !(e.evidence ?? []).includes(rel) || !existsSync(e.dir)) return new Response("not found", { status: 404 });
          const root = realpathSync(e.dir); const f = normalize(join(root, rel)); if (!f.startsWith(root + "/") || !existsSync(f) || !realInside(root, f) || statSync(f).isDirectory()) return new Response("not found", { status: 404 });
          return new Response(Bun.file(f), { headers: { "content-type": /\.png$/.test(f) ? "image/png" : /\.jpe?g$/.test(f) ? "image/jpeg" : /\.webp$/.test(f) ? "image/webp" : "text/plain; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; img-src 'self'", "x-content-type-options": "nosniff" } });
        }
        if (m[2] === "events") return json(engine.timeline(id, Number(url.searchParams.get("after") ?? 0)));
        if (!writing) return json(runView(id, who));
        if (m[2] === "pause") return json(engine.pause(id) && runView(id, who));
        if (m[2] === "resume") return json(engine.resume(id) && runView(id, who));
        if (m[2] === "cancel") return json(engine.cancel(id, by, b?.reason ? String(b.reason) : null) && runView(id, who));
        // read the ended Task's pull request on GitHub again: a merge into its base is recorded as reconciled (read-only on GitHub)
        if (m[2] === "reconcile-merge") {
          if (who.kind !== "desktop") return json({ error: "only the desktop captain can ask Studio to check GitHub" }, 403);
          if (!engine.reconcileFromGitHub) return json({ error: "no code workflow is installed" }, 409);
          try { const res = await engine.reconcileFromGitHub(id); if (!engine.get(id)) return json({ ...res, error: "no such run" }, 404); return json({ ...res, run: runView(id, who) }); }
          catch (e: any) { return json({ state: "error", error: `GitHub could not be read: ${String(e?.message ?? e).slice(0, 200)}` }, 502); }
        }
        // archive and delete: an ended run only (409 for a live one); delete needs the typed id (400)
        if (m[2] === "archive" || m[2] === "delete") {
          try { if (m[2] === "archive") return json(engine.archive(id, b?.archived !== false, by) && runView(id, who)); return json(engine.remove(id, String(b?.confirm ?? ""), by)); }
          catch (e: any) { const msg = String(e?.message ?? e); return json({ error: msg }, /only an ended run|still finishing/.test(msg) ? 409 : 400); }
        }
      }
      // ---------- issue categories: a project's issues filed into categories kept in Studio (src/issue-categories-workflow.ts).
      // Read here; a run starts here (its captain card still comes before any model runs); the captain edits here ----------
      const cat = /^\/api\/issue-categories\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})(?:\/(start|edit))?$/.exec(p);
      if (cat) {
        if (!cat[2]) { if (writing) return json({ error: "use GET" }, 405); try { return json(categoriesFlow.view(cat[1])); } catch { return json({ error: "invalid project id" }, 400); } }
        if (!writing) return json({ error: "use POST" }, 405);
        if (who.kind !== "desktop") return json({ error: "only the desktop captain changes categories" }, 403);
        if (cat[2] === "start") { try { const run = categoriesFlow.start({ project: cat[1], by: "captain (project page)" }); return json({ ok: true, task: run.id, href: `#/run/${run.id}` }); } catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); } }
        const e = b ?? {}, id = /^C-[1-9][0-9]{0,5}$/;
        const ids = Array.isArray(e.ids) && e.ids.length > 0 && e.ids.length <= 40 && e.ids.every((x: any) => typeof x === "string" && id.test(x));
        const issue = Number.isSafeInteger(e.n) && e.n > 0;
        const valid = e.op === "rename" ? id.test(e.id) && typeof e.name === "string" : e.op === "move" ? issue && (id.test(e.to) || e.to === "PLANNED") : e.op === "unplan" ? issue : e.op === "merge" ? id.test(e.id) && id.test(e.into) : e.op === "approve" || e.op === "decline" ? ids : false;
        if (!valid) return json({ error: "an edit is rename {id, name}, move {n, to (C-n or PLANNED)}, unplan {n}, merge {id, into}, or approve / decline {ids}" }, 400);
        try { return json(categoriesFlow.edit(cat[1], e.op === "rename" ? { op: "rename", id: e.id, name: e.name } : e.op === "move" ? { op: "move", n: e.n, to: e.to } : e.op === "merge" ? { op: "merge", id: e.id, into: e.into } : e.op === "unplan" ? { op: "unplan", n: e.n } : { op: e.op, ids: e.ids }, "captain (project page)")); }
        catch (err: any) { return json({ error: String(err?.message ?? err) }, 409); }
      }
      // ---------- issue triage: read here; written by the issue-triage workflow only. The project page starts one (the
      // captain on the desktop, a batch of 1 to 50 issues); its investigators still wait for the captain's start card ----------
      if (p === "/api/issue-triage" || p.startsWith("/api/issue-triage/")) {
        const start = /^\/api\/issue-triage\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/start$/.exec(p);
        if (start) {
          if (!writing) return json({ error: "use POST" }, 405);
          if (who.kind !== "desktop") return json({ error: "only the desktop captain starts an issue triage" }, 403);
          const size = b?.size ?? 15, issues = b?.issues ?? [];
          if (!Number.isSafeInteger(size) || size < 1 || size > 50 || !Array.isArray(issues) || issues.length > 50 || !issues.every((n: any) => Number.isSafeInteger(n) && n > 0)) return json({ error: "a batch is 1 to 50 issues; issue numbers are positive integers" }, 400);
          try { const run = issueTriageFlow.start({ project: start[1], size, issues, by: "captain (project page)" }); return json({ ok: true, task: run.id, href: `#/run/${run.id}` }); }
          catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
        }
        // Fix, from the project page (docs/units/board.md, "Fixing issues"): the desktop captain's click is the approval of
        // each issue's hidden one-issue investigation and of the fix Task a fixable outcome starts
        const fixM = /^\/api\/issue-triage\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/fix$/.exec(p);
        if (fixM) {
          if (!writing) return json({ error: "use POST" }, 405);
          if (who.kind !== "desktop") return json({ error: "only the desktop captain fixes issues" }, 403);
          const issues = b?.issues;
          if (!Array.isArray(issues) || !issues.length || issues.length > 1000 || !issues.every((n: any) => Number.isSafeInteger(n) && n > 0) || Object.keys(b ?? {}).some((k) => k !== "issues" && k !== "crew") || (b.crew !== undefined && b.crew !== null && (typeof b.crew !== "string" || b.crew.length > 128))) return json({ error: "send {issues: [n, …], crew?}: 1 to 1000 issue numbers, and the crew the confirmation showed" }, 400);
          // the crew the confirmation showed is pinned: a fix Task whose dispatch card shows another crew waits for the captain there
          try { return json(await issueTriageFlow.fix(fixM[1], issues, "captain (project page)", b.crew === undefined ? undefined : b.crew)); }
          catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
        }
        // the disagreement court of one triage (public/court.js): its docket, an issue as the snapshot holds it, a file at the
        // pinned commit (read from git's objects), and the captain's rulings (the desktop or the phone captain)
        const court = /^\/api\/issue-triage\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/court\/(R-\d{1,9})(?:\/(issue\/(\d{1,9})|file))?$/.exec(p);
        if (court) {
          try {
            if (writing) { if (court[3]) return json({ error: "use GET" }, 405); if (b?.rulings === undefined || Object.keys(b ?? {}).some((k) => k !== "rulings")) return json({ error: "send {rulings: [{case, pick, reason?}]}" }, 400);
              return json(await issueTriageFlow.rule(court[1], court[2], b.rulings, by)); }
            if (!court[3]) return json(issueTriageFlow.courtView(court[1], court[2]));
            if (court[4]) return json(issueTriageFlow.courtIssue(court[1], court[2], Number(court[4])));
            return json(issueTriageFlow.courtFile(court[1], court[2], url.searchParams.get("path")));
          } catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
        }
        if (/^\/api\/issue-triage\/[^/]+\/court(\/|$)/.test(p)) return json({ error: "name a triage Task: /court/R-n" }, 400);
        // a cross-batch match, decided on the project page: join it to the earlier package, or keep it apart
        const crossM = /^\/api\/issue-triage\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/cross$/.exec(p);
        if (crossM) {
          if (!writing) return json({ error: "use POST" }, 405);
          if (who.kind !== "desktop") return json({ error: "only the desktop captain decides a match" }, 403);
          if (typeof b?.id !== "string" || !/^X-[1-9][0-9]{0,5}$/.test(b.id) || (b?.action !== "join" && b?.action !== "apart")) return json({ error: "name the match (X-n) and join or apart" }, 400);
          try { return json(issueTriageFlow.cross(crossM[1], b.id, b.action, "captain (project page)")); }
          catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
        }
        // an issue set aside because an open pull request names it, taken into a package anyway on the project page
        const takeM = /^\/api\/issue-triage\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/take$/.exec(p);
        if (takeM) {
          if (!writing) return json({ error: "use POST" }, 405);
          if (who.kind !== "desktop") return json({ error: "only the desktop captain takes an issue in progress" }, 403);
          if (!Number.isSafeInteger(b?.issue) || b.issue < 1) return json({ error: "name the issue (a positive integer)" }, 400);
          try { return json(issueTriageFlow.take(takeM[1], b.issue, "captain (project page)")); }
          catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
        }
        // packages kept as proposals, approved later on the project page (the issues are read again first)
        const approve = /^\/api\/issue-triage\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/approve$/.exec(p);
        if (approve) {
          if (!writing) return json({ error: "use POST" }, 405);
          if (who.kind !== "desktop") return json({ error: "only the desktop captain approves work packages" }, 403);
          const ids = b?.packages;
          if (!Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every((x: any) => typeof x === "string" && /^P-[1-9][0-9]{0,5}$/.test(x))) return json({ error: "name the work packages to approve (P-n)" }, 400);
          try { return json({ ok: true, ...(await issueTriageFlow.approve(approve[1], ids, "captain (project page)", req.signal)) }); }
          catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
        }
        // packages not worked yet, declined on the project page: their issues are released to be triaged again
        const decline = /^\/api\/issue-triage\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/decline$/.exec(p);
        if (decline) {
          if (!writing) return json({ error: "use POST" }, 405);
          if (who.kind !== "desktop") return json({ error: "only the desktop captain declines work packages" }, 403);
          const ids = b?.packages;
          if (!Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every((x: any) => typeof x === "string" && /^P-[1-9][0-9]{0,5}$/.test(x))) return json({ error: "name the work packages to decline (P-n)" }, 400);
          try { return json(issueTriageFlow.decline(decline[1], ids)); }
          catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
        }
        if (writing) return json({ error: "read only" }, 405);
        if (p === "/api/issue-triage") return json({ projects: issueTriage.list() });
        // whether one model twice is allowed depends on what is usable: read the free probes once if nothing was read yet
        if (d.staffingFacts && !staffingCapabilities.length) try { await staffingFacts(); } catch {}
        try { const id = decodeURIComponent(p.slice("/api/issue-triage/".length)), rec = issueTriage.get(id), investigators = issueTriageFlow.investigators(id);
          const fix = issueTriageFlow.fixView(id), worker = issueTriageFlow.fixWorker(id), fixLimit = issueTriageFlow.fixLimit();
          return json(rec ? { ...rec, progress: issueTriageFlow.progress(rec), investigators, fix, worker, fixLimit } : { state: "none", investigators, fix, worker, fixLimit }); } catch { return json({ error: "invalid project id" }, 400); }
      }
      // ---------- a merge card's review room (src/domain/review-room.ts): read on any authenticated page; a turn is a paid
      // round only the desktop captain starts, confirming its provider and model; nothing here answers the card ----------
      // a room's subject is a merge card (SC-n), a Task's reviewed branch (R-n) or a pull request read by its URL (PR-…):
      // POST /api/review-room/open-pr {url} reads the pull request (GET only) and returns its room; …/check reads it again
      if (p === "/api/review-room/open-pr") {
        const rr = engine.reviewRoom; if (!rr) return json({ error: "The review room is not installed" }, 404);
        if (!writing || req.method !== "POST") return json({ error: "POST /api/review-room/open-pr {url}" }, 405);
        if (who.kind !== "desktop") return json({ error: "Only the captain on this Mac opens a pull request's room / 只有這台 Mac 上的船長能開啟 pull request 的審查室", code: "desktopOnly" }, 403);
        try { return json(await rr.openPr(b?.url)); } catch (e: any) { return json({ error: String(e?.message ?? e), code: e?.code ?? null }, e?.code === "not_found" ? 404 : 400); }
      }
      // a room saved in the Library: read it (any authenticated page), its pictures and narration from the snapshot itself
      const libRoom = /^\/api\/review-room\/library\/(room-[a-z0-9-]{1,60})(?:\/(\d{1,6})\/asset\/([A-Za-z0-9._-]+\.(png|mp3)))?$/.exec(p);
      if (libRoom) { const rr = engine.reviewRoom; if (!rr) return json({ error: "The review room is not installed" }, 404); if (writing) return json({ error: "a saved room is read-only" }, 405);
        try { if (libRoom[3]) return new Response(rr.libraryAsset(libRoom[1], Number(libRoom[2]), libRoom[3]), { headers: { "content-type": libRoom[4] === "png" ? "image/png" : "audio/mpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } }); return json(rr.librarySnapshot(libRoom[1], url.searchParams.get("v"))); }
        catch (e: any) { return json({ error: String(e?.message ?? e), code: e?.code ?? null }, e?.code === "not_found" ? 404 : 400); } }
      const room = /^\/api\/review-room\/(SC-\d+|R-\d+|PR-[0-9a-f]{12}-[1-9]\d{0,8})(?:\/(turn|cite|image|audio|speech|check|check-answer|translate|save)(?:\/([A-Za-z0-9-]+\.(?:png|mp3)))?)?$/.exec(p);
      if (room) {
        const rr = engine.reviewRoom; if (!rr) return json({ error: "The review room is not installed" }, 404);
        const fail = (e: any) => json({ error: String(e?.message ?? e), code: e?.code ?? null, ...(e?.offer ? { offer: e.offer } : {}) }, e?.code === "not_found" ? 404 : e?.code === "confirm_required" || e?.code === "busy" ? 409 : 400);
        if (!writing && room[2] === "audio") { try { return new Response(rr.audio(room[1], room[3] ?? ""), { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } }); } catch (e: any) { return fail(e); } }
        if (!writing && room[2] === "image") { try { return new Response(rr.image(room[1], room[3] ?? ""), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } }); } catch (e: any) { return fail(e); } }
        if (!writing) { try { return room[2] === "cite" ? json(await rr.cite(room[1], url.searchParams.get("ref"))) : json(rr.view(room[1], url.searchParams.get("open") === "1" && who.kind === "desktop")); } catch (e: any) { return fail(e); } }
        if ((room[2] !== "turn" && room[2] !== "speech" && room[2] !== "check" && room[2] !== "check-answer" && room[2] !== "translate" && room[2] !== "save") || room[3] || req.method !== "POST") return json({ error: "POST /api/review-room/<card>/turn" }, 405);
        if (who.kind !== "desktop") return json({ error: "Only the captain on this Mac starts a paid tutor round / 只有這台 Mac 上的船長能開始付費的導師回合", code: "desktopOnly" }, 403);
        // Check for new commits reads GitHub: at most once every few seconds per room, whatever the page sends
        if (room[2] === "check") { const last = roomChecks.get(room[1]) ?? 0; if (Date.now() - last < 5000) return json({ error: "Checked a moment ago; try again in a few seconds / 剛剛才檢查過，請稍候再試", code: "rate_limited" }, 429);
          roomChecks.set(room[1], Date.now()); try { return json(await rr.check(room[1])); } catch (e: any) { return fail(e); } }
        if (room[2] === "speech") { try { return json(await rr.speech(room[1], b?.scene, b?.lang)); } catch (e: any) { return fail(e); } }
        // the captain picks an option of a multiple-choice question: Studio grades it, no model (the same desktop gate as a turn)
        // the explanation in another language: a small paid translation turn, confirmed once per room (the same gates as a turn)
        if (room[2] === "translate") { try { return json(await rr.translate(room[1], { lang: b?.lang, confirm: b?.confirm }, by)); } catch (e: any) { return fail(e); } }
        // Save to the Library: a new version of the room's read-only snapshot (nothing goes to GitHub)
        if (room[2] === "save") { try { return json(await rr.saveToLibrary(room[1], by)); } catch (e: any) { return fail(e); } }
        if (room[2] === "check-answer") { try { return json(rr.answer(room[1], b?.n, b?.choice)); } catch (e: any) { return fail(e); } }
        try { return json(await rr.start(room[1], { action: b?.action, text: b?.text, lang: b?.lang, confirm: b?.confirm, pick: b?.pick, regenerate: b?.regenerate }, by)); } catch (e: any) { return fail(e); }
      }
      // ---------- Studio cards ----------
      if (p === "/api/scards" && !writing) return json({ cards: engine.cards.list({ open: url.searchParams.get("open") === "1" }).map(c=>engine.cards.view(c)) });
      m = /^\/api\/scards\/(SC-\d+)(?:\/(answer))?$/.exec(p);
      if (m) {
        if (!writing) { const c = engine.cards.get(m[1]); return c ? json(engine.cards.view(c)) : json({ error: "no such card" }, 404); }
        const c = await engine.answer(m[1], { choice: String(b?.choice ?? ""), note: b?.note ?? null, by, confirm: b?.confirm ?? null, ack: typeof b?.ack === "string" ? b.ack : null, aligned: Array.isArray(b?.aligned) ? b.aligned : null, localRescope:b?.localRescope??null, crew: b?.crew ?? null });
        return json(c);
      }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e), problems: e?.problems ?? undefined, refusal: e?.refusal ?? undefined, failure: e?.refusal ? undefined : fromError(e, { source: "params" }) }, 400); }
  }
  /**
   * Send for review (docs/units/branch-intake.md): code-firstmate from an existing branch, through the same staffing guard
   * as a board start. Studio pins `_adopt` (the commit, its branch, the terminal); no caller-supplied "_" param reaches it.
   */
  const startFromBranch = async (o: { project: string; commit: string; branch: string | null; terminal: string; label: string; by: string }) => {
    const wf = "code-firstmate", def = defs.get(wf);
    if (!def) throw Object.assign(new Error("code-firstmate is not installed"), { code: "workflow_unavailable" });
    const p = projects.get(o.project); if (!p?.path) throw Object.assign(new Error("choose a registered project"), { code: "project_required" });
    if (!/^[0-9a-f]{40,64}$/.test(o.commit)) throw Object.assign(new Error("no commit to review"), { code: "commit" });
    let params: Record<string, string> = { project: p.id, base: p.base }, autoVerified: string[] = [];
    const refuse = (x: StartRefusal) => Object.assign(new Error(String(x.body.error)), { code: x.body.code, staffing: x.body.staffing });
    if (boardStaffed(def)) {
      const g = await staffedStartGuard(def, p.id, { why: `Send for review of ${o.branch ?? o.commit.slice(0, 12)} on ${p.id}` });
      if (!g.ok) throw refuse(g);
      autoVerified = g.autoVerified; params = { ...params, ...g.params };
    }
    params._adopt = JSON.stringify({ commit: o.commit, branch: o.branch, terminal: o.terminal });
    const what = o.branch ?? o.commit.slice(0, 12);
    const text = `Review ${what}, the work a web terminal (${o.label}) committed in ${p.name || p.id} (${o.commit.slice(0, 12)}): draft the spec from its diff, check it, review it and merge it.`;
    const started = staffedStartRun(def, () => ownClaude.start({ workflow: wf, title: `Review ${what} from a web terminal (${o.label})`.slice(0, 120), text, params, by: o.by }), autoVerified);
    if (!started.ok) throw refuse(started);
    return started.run;
  };
  return { handle, engine, defs, projects, firstmate, startFromBranch, prepareLocalProject:originalFirstmate.prepareLocalProject, onboarding, drafts, readiness, classify: (t: string, project?: string | null) => classifyIntent(defs, t, engine.policies.get("sensitive_paths", { project: project ?? null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []) };
}
export { schemaDefaults };
