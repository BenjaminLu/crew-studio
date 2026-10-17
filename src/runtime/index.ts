import {hashInput} from './checks';
import {installOwnClaudeGrants,ownClaudePlan} from '../providers/own-workflow-claude-refresh';
import {installHelloWeb} from "../domain/hello-web";
import { refusesRulesPatch } from "../operating-rules";
import { taskTitle } from "../task-title";
import { PolicyUnreadable } from "./checks";
import { failure, fromError, type FailureCode } from "./failures";
import {installStartupRecursion} from '../domain/startup-recursion';
import { deliverableOf, DELIVERABLE_WORKFLOW } from "../deliverables";
import {installReadinessViews,readinessNodes} from './readiness-view';
import {installGitHubReviewWorkflow} from '../domain/github-review-workflow';
import {Onboarding} from '../onboarding';
import {ArtifactStore,websiteHref} from '../artifacts';
import {StaffingStore,staffingHash,installStaffingGuard,coffeeStaffingProject,staffingApplies,staffedCapability,type StaffingProject} from '../domain/staffing';
import {installFirstmateStaffing,staffingQuotaReady,type StaffingFacts,type StaffingAdmission} from '../firstmate-staffing';
import {installFirstmate} from "../firstmate";
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
import { Engine, type AgentPick } from "./engine";
import {COFFEE_DESIGN_FIELDS,validateCoffeeDesign,coffeeDesignJSON} from "../domain/coffee-design";
import { installCoffeeKit } from "../domain/coffee-kit";
import { installDeliver } from "../domain/deliver";

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
  startupModel?:(provider:"claude"|"codex")=>string|null|undefined;
  generateImage?: (prompt: string, authorize: () => void, signal: AbortSignal, reference?:import("../providers/codex-image").CodexImageReference, rules?: import("../operating-rules").RulesSection) => Promise<import("../providers/codex-image").CodexImage>;
  staffingFacts?: () => Promise<StaffingFacts[]>;
  staffingAdmission?: StaffingAdmission;
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
  const defs = new WorkflowDefs(d.dataDir);
  if (d.skills) defs.skillInfo = (id, v) => d.skills!.pinInfo(id, v);
  const engine = new Engine({ dataDir: d.dataDir, agents: d.agents, provider: d.provider, defaultProvider: d.defaultProvider, selectProvider: d.selectProvider, log: d.log, send: d.send, skillText: skillTextFor(d.fmRoot), store: d.store, protectedRoots: d.protectedRoots ?? [d.fmRoot], library: d.skills ?? null }, defs);
  const projects = new Projects(d.dataDir);
  installHelloWeb(engine,d.m3?.store??new ArtifactStore(d.dataDir));
  if (d.m3?.store && d.m3?.lane && d.fileorg && d.docs) installDeliver(engine, { dataDir: d.dataDir, artifacts: d.m3.store, lane: d.m3.lane, fileorg: d.fileorg, docs: d.docs, generateImage: d.generateImage });
  const startup=d.m3?.store?installStartupRecursion(engine,{artifacts:d.m3.store,configuredModel:d.startupModel}):undefined;
  let coffee:ReturnType<typeof installCoffeeKit>|undefined;
  if(d.m3?.store){coffee=installCoffeeKit(engine,{artifacts:d.m3.store,choice:d.coffeeChoice,reviewStaffing:(def,params)=>{const c=staffingGuard.verified(def,params);return{hash:c.hash,workflow:c.workflow,roles:c.roles,approval:c.approval};},staffing:(def,params)=>{const config=staffingGuard.verified(def,params),role=config.roles['image-worker'];if(!role||role.provider!=='codex')throw new Error('The dedicated image adapter requires an explicitly approved available Codex image-worker; no vendor fallback');return {provider:'codex',model:role.model,effort:role.effort};},video:d.coffeeVideo});d.m3.useArtifactReviewPolicy?.(id=>coffee!.artifactReview(id)??startup?.artifactReview(id)??null);}
  engine.deps.continuationEvidence=(r:any)=>{const refs=Object.values(r.ctx.deliver??{})as any[];if(refs.length&&!d.m3?.store)throw new Error('Artifact storage unavailable for continuation');
    const notes=(id:string,n:number)=>{const store=d.m3!.store,file=join(store.vdir(id,n),'notes.json');try{if(existsSync(file)){const raw=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(raw)||raw.some(v=>!v||typeof v.id!=='string'||typeof v.comment!=='string'||!['open','resolved'].includes(v.status)))throw new Error('Invalid annotations');}return store.notes(id,n);}catch{throw new Error('Artifact annotations cannot be verified; continuation is held');}};
    const coffeePins=coffee?.continuationEvidence(r.id)??[];return{artifacts:refs.map(ref=>{const v=d.m3!.store.version(ref.id,ref.n);if(!v||v.sha256!==ref.sha256||d.m3!.store.verify(ref.id,ref.n).length)throw new Error('Pinned artifact changed; continuation is held');return{ref,version:v,notes:notes(ref.id,ref.n)};}),coffee:coffeePins.map(e=>({...e,notes:notes(e.receipt.artifact,e.receipt.n)}))};};

  // Base artifact providers precede domain wrappers that bind their own pinned outputs.
  for (const f of d.install ?? []) f(engine, { projects, dataDir: d.dataDir });
  const staffing=new StaffingStore(d.dataDir);
  const staffingProject=(id:string)=>d.staffingProject?d.staffingProject(id):projects.staffingIdentity(id,d.protectedRoots??[]);
  let staffingCapabilities:StaffingFacts[]=[];
  const staffingFacts=async()=>{staffingCapabilities=await(d.staffingFacts??(async()=>[]))();return staffingCapabilities;};
  const roleReady=(role:{provider:string;model:string;effort:string|null})=>{const cap=staffingCapabilities.find(c=>c.provider===role.provider),model=cap?.models.find(m=>m.id===role.model);return !(!cap||cap.support!=='supported'||cap.auth!=='verified'||!staffingQuotaReady(role as any,cap,d.staffingAdmission)||cap.expires<=Date.now()||!model||role.effort!==null&&!model.efforts.includes(role.effort));};
  // each role's pick and each node override's effective pick (the definition the configuration names)
  const staffingCapability=(config:any)=>staffedCapability(config,engine.defs.get(config.workflow.id,config.workflow.version),roleReady);
  const staffingGuard=installStaffingGuard(engine,staffing,staffingProject,staffingCapability);
  /** The Start form's readiness of an approved crew, from free probes only (the Codex probe, Claude auth status).
   *  A Claude role that is signed in but not verified by a bounded request cannot start: the form never pays for it. */
  const crewReadiness=(roles:Record<string,{provider:string;model:string;effort:string|null}>)=>{for(const[id,role]of Object.entries(roles)){if(roleReady(role))continue;const cap=staffingCapabilities.find(c=>c.provider===role.provider);
    if(role.provider==='claude'&&cap?.support==='supported'&&cap.auth==='verified'&&cap.expires>Date.now())return{state:'blocked' as const,role:id,reason:{en:`The ${id} role's Claude ${role.model} is signed in but not verified by a bounded request. Verify it with Firstmate, then Start.`,zh:`${id} 角色的 Claude ${role.model} 已登入，但尚未經有限請求驗證；請先和 Firstmate 驗證，再按開始。`}};
    return{state:'blocked' as const,role:id,reason:{en:`The ${id} role's ${role.provider} ${role.model} is not available now${cap?.reason?` (${cap.reason})`:''}. Check the account, then refresh.`,zh:`${id} 角色的 ${role.provider} ${role.model} 目前不可用；請確認帳號後重新整理。`}};}
   return{state:'ready' as const};};
  const staffingTools=installFirstmateStaffing(engine,staffing,staffingProject,staffingFacts,d.staffingAdmission,a=>d.staffingApproved?.(a),{verified:(def,params)=>staffingGuard.verified(def,params),capability:staffingCapability});
  // Board start of a project-staffed workflow (code-firstmate): the approved configuration of the chosen registered
  // project, the same one Firstmate's dispatch binds. Never a bypass: the staffing guard still verifies it at start.
  const boardStaffed=(def:any)=>!!def&&staffingGuard.applies(def)&&def.kind!=='coffee-kit';
  type BoardStaffing={state:'approved';hash:string;version:number;roles:Record<string,{provider:string;model:string;effort:string|null}>}|{state:'missing'|'blocked';code:string;reason:{en:string;zh:string}};
  const boardStaffing=(def:any,projectId:string):BoardStaffing=>{
   let project:StaffingProject;try{project=staffingProject(projectId);}catch(e:any){return{state:'blocked',code:'project_unavailable',reason:{en:String(e?.message??e),zh:'已登錄專案不存在、已停用或無法驗證 / '+String(e?.message??e)}};}
   let config;try{config=staffing.current(project);}catch(e:any){return e?.code==='ENOENT'?{state:'missing',code:'staffing_missing',reason:{en:'No crew is approved for this project yet. Choose your crew together with Firstmate first.',zh:'此專案尚未核准代理配置；請先和 Firstmate 一起決定代理配置。'}}:{state:'blocked',code:'staffing_unverifiable',reason:{en:'The approved crew for this project cannot be verified: '+String(e?.message??e),zh:'無法驗證此專案已核准的代理配置。'}};}
   try{staffingGuard.verified(def,{project:projectId,_staffing:config.hash});}catch(e:any){return{state:'blocked',code:'staffing_changed',reason:{en:String(e?.message??e).replace(/^Staffing approval requires confirmation: /,''),zh:'已核准的代理配置與目前流程或技能不符；請重新和 Firstmate 決定代理配置。'}};}
   return{state:'approved',hash:config.hash,version:config.version,roles:Object.fromEntries(Object.entries(config.roles).map(([id,r])=>[id,{provider:r.provider,model:r.model,effort:r.effort}]))};
  };
  const onboarding=new Onboarding(engine,d.m3?.store??new ArtifactStore(d.dataDir));
  const originalFirstmate=installFirstmate(engine,projects,{prepareDispatch:async(workflow,version)=>{const def=engine.defs.get(workflow,version);if(staffingApplies(def))await staffingFacts();},onCoffeeProposal:id=>{try{onboarding.proposal(id);}catch{}},onCoffeeDispatch:(proposal,task)=>{try{onboarding.dispatch(proposal,task);}catch{}},protectedRoots:d.protectedRoots??[],staffingProject,staffingPending:d.staffingPending});
  // free drafting: its own store and tools, separate from proposals, staffing and execution
  const drafts=new WorkflowDrafts(d.dataDir,defs,(id,revision)=>{try{d.send('wfdraft',{id,revision});}catch{}});
  const readiness=d.readiness===false?null:installReadiness({engine,defs,drafts,dataDir:d.dataDir,protectedRoots:d.protectedRoots??[d.fmRoot],send:d.send,startOwn:(o:any,g:unknown)=>ownClaude.start(o,g),...(d.readiness??{}),createRuntime:(d.readiness as any)?.createRuntimeOverride??createRuntime});
  const draftTools=installWorkflowDraftTools(drafts,readiness?.tools,def=>{readiness?.versionSaved(def);try{d.send('wf',{id:def.id,version:def.version});}catch{}});
  const firstmate={specs:[...originalFirstmate.specs,...staffingTools.specs,...draftTools.specs],call:(name:string,args:any,owner:any)=>draftTools.specs.some(spec=>spec.name===name)?draftTools.call(name,args,owner):name==='studio_change_staffing'||name==='studio_keep_staffing'||name==='studio_staffing_facts'||name==='studio_staffing_interview'||name==='studio_propose_staffing'?staffingTools.call(name,args,owner):originalFirstmate.call(name,args,owner)};
  // the captain's own workflows start only with the staffing the captain confirmed at Run (never at drafting)
  const previousOwnStart=engine.deps.authorizeStart;
  engine.deps.authorizeStart=(def:any,o:any)=>{previousOwnStart?.(def,o);if(ownWorkflow(def)){const s=ownStaffingPlan(def);if(s.plan.length&&(s.missing.length||o.params?._ownStaffing!==s.hash))throw new Error('Confirm staffing for every agent node when you click Run / 請在按下執行時確認每個代理節點的配置');}};
  const ownClaude=installOwnClaudeGrants(engine);
  const githubReview=installGitHubReviewWorkflow(engine,projects,d.dataDir,d.protectedRoots??[]);
  installReadinessViews(engine);
  engine.load();

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
    return { ...r, title: taskTitle(r), request: r.text, claudeVerificationAvailable:ownClaude.available(id), nodes: readinessNodes(r, id=>engine.cards.get(id)), outputs:[...outputMap.values()], continuable, walked: [...new Set(engine.events(id).filter((e) => e.type === "edge_taken").map((e) => e.edge))], events: engine.timeline(id).slice(-400), ledger, ledgerOk: t.ok, ledgerBad: [...t.bad], ledgerTruncated: t.truncated, done: engine.doneLines(r), cards: engine.cards.list({ run: id }).map(c=>engine.cards.view(c)) };
  };
  const checkView = (m: any) => { const p = engine.params(m, null, {}); return { ref: m.ref, id: m.id, pack: m.pack, version: m.version, title: m.title, description: m.description, applies_to: m.applies_to, kind: m.kind, blocking: m.blocking, needs: m.needs,
    params: m.params, policy_bind: m.policy_bind, effective: p.params, from: p.from, timeout_s: m.timeout_s, network: m.network, impl: m.native ? "native" : m.adapter ? "adapter" : m.kind === "judged" ? "judge" : "executable", quorum: m.judge?.quorum ?? null, hasSample: !!m.sample, at: m.at }; };

  const grantNonces = new Map<string, number>();
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!/^\/api\/(wf|wruns|scards|checks|policies|intake|coffee|onboarding|github-review)(\/|$)/.test(p)) return null;
    let b: any = {}; if (writing) { try { b = await req.json(); } catch {} }
    const by = who.kind === "phone" ? "captain (phone)" : "captain";
    if(p==='/api/github-review/scan'||p==='/api/github-review/template'||p==='/api/github-review/community'){if(req.method!=='POST'||!writing)return json({error:'Authenticated POST required'},405);if(who.kind!=='desktop')return json({error:'Confirm GitHub reviewer configuration on desktop'},403);try{return json(p.endsWith('/community')?await githubReview.community(b.project,req.signal):p.endsWith('/scan')?await githubReview.scan(b.project,b.url,req.signal):await githubReview.save(b,req.signal));}catch{return json({error:'GitHub review discovery/configuration could not be verified. Check registered project grant, PR URL and current access; no GitHub write was performed.',code:'github_review_unverified'},409);}}
    if (writing && who.kind === "phone" && !/^\/api\/scards\//.test(p)) return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    try {
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
      // ---------- definitions ----------
      if(p==="/api/coffee/design"&&writing){if(req.method!=="POST")return json({error:"POST required"},405);if(who.kind!=="desktop")return json({error:"Review coffee design on the desktop"},403);return json({plan:validateCoffeeDesign(b?.plan),canonical:coffeeDesignJSON(b?.plan)});}
      if (p === "/api/wf" && !writing) return json({ workflows: defs.catalog(), held: defs.heldCatalog(), trash:defs.trashCatalog(), checks: engine.registry.all().map(checkView) });
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
          return json({ def, personal:defs.personal(id), trash:defs.trashState(id), selectable:defs.selectable(id,def.version), held:defs.held(id), coffeeFilmStatus:def.kind==="coffee-kit"?d.coffeeFilmStatus??{ready:false,reason:"Local film capability is unavailable"}:null, coffeeDesign:def.kind==="coffee-kit"?COFFEE_DESIGN_FIELDS:null, coffeeChoice:def.kind==="coffee-kit" ? d.coffeeChoice?.() ?? null : null, problems: validate(def, defs.known, undefined, defs.skillInfo ?? undefined), versions: defs.versions(id).map((x) => ({ version: x.version, createdAt: x.createdAt, by: x.by, note: x.note, parent: x.parent, diff: x.diff })),
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
      if (p === "/api/policies" && !writing) return json({ org: engine.policies.org(), projects: projects.list().map((x) => ({ id: x.id, name: x.name, policy: engine.policies.project(x.id) })) });
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
        const crewOf=(id:string)=>{const crew=boardStaffing(def,id);if(crew.state!=='approved')return crew;const ready=crewReadiness(crew.roles);return ready.state==='blocked'?{state:'blocked' as const,code:'staffing_not_ready',role:ready.role,reason:ready.reason}:{...crew,readiness:ready};};
        return json({workflow:wf,version:def.version,projectScoped,staffing:staffed,crewHref:staffed?"#/firstmate":null,projects:projectScoped?projects.list().filter(x=>!!x.path).map(x=>({id:x.id,name:x.name,base:x.base,staffing:staffed?crewOf(x.id):null})):[]});
      }
      if (p === "/api/wruns" && !writing) return json({ runs: engine.list().filter((r) => url.searchParams.get("archived") === "1" || !r.archived).map((r) => ({ id: r.id, workflow: r.workflow, version: r.version, title: taskTitle(r), request: r.text, status: r.status, result: r.result, createdAt: r.createdAt, updatedAt: r.updatedAt, endedAt: r.endedAt, error: r.error,
        childRun: (() => { const child = engine.get(r.ctx?.childRun); return child?.params?._firstmateProposal === r.id ? child.id : null; })(),
        archived: !!r.archived, merged: !!r.ctx?.merged, cancelReason: r.cancelReason ?? null,
        current: Object.entries(r.nodes).filter(([, n]) => ["running", "waiting"].includes(n.state)).map(([k, n]) => ({ node: k, state: n.state, waiting: n.waiting ?? null, label: r.def.nodes.find((x) => x.id === k)?.label ?? k })), door: engine.cards.list({ run: r.id }).find((c) => c.door)?.door ?? null, recovered: r.recovered })),
        cards: engine.cards.list({ open: true }).map(c=>engine.cards.view(c)) });
      if (p === "/api/wruns" && writing) {
        // every start refusal carries its typed failure (runtime/failures.ts), never only a string
        const refuse = (o: Record<string, unknown>, st: number, code: FailureCode) => json({ ...o, failure: failure(code, String(o.error ?? ""), { source: "params" }) }, st);
        const text = String(b?.text ?? "").trim(); if (!text && !b?.workflow) return refuse({ error: "say what you want done" }, 400, "invalid-input.params");
        const cls = classifyIntent(defs, text, engine.policies.get("sensitive_paths", { project: b?.params?.project ? String(b.params.project) : b?.project ? String(b.project) : null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []);
        const wf = b?.workflow || cls.workflow; if (!wf) return refuse({ error: "Choose a workflow below; your request is still saved. / 請從下方選擇流程；你輸入的需求已保留。", code: "workflow_required", classifier: cls }, 409, "invalid-input.params");
        {const held=defs.held(wf);if(held)return refuse({error:`This workflow is ${held.en}. It stays in the catalog for editing. / 此流程${held.zh}，仍可在流程目錄中編輯。`,code:"workflow_held",held},409,"invalid-input.config");}
        if(!defs.selectable(wf,b?.version?Number(b.version):undefined))return refuse({error:"This workflow is internal or retired. Choose an available workflow. / 此流程為內部或已退役流程，請選擇可用流程。",code:"workflow_unavailable"},409,"invalid-input.config");
        let params={...(b?.params??{})};delete params._ownStaffing;
        const chosenDef=defs.get(wf,b?.version?Number(b.version):undefined);
        // Validate the selected version's declared inputs before allocating a Task or checking staffing.
        const missing=Object.entries(chosenDef?.params??{}).filter(([key,spec])=>spec.required&&!(String(params[key]??spec.default??'').trim())).map(([key])=>key);
        if(missing.length)return refuse({error:`Required workflow inputs / 必須提供流程輸入: ${missing.join(', ')}`,code:'param_required',params:missing},400,'invalid-input.params');
        for(const [key,spec] of Object.entries(chosenDef?.params??{})){
          if(params[key]===undefined)continue;
          if(typeof params[key]==='string'&&params[key].trim()===''){params[key]='';continue;} // blank means the declared default (file-organization: a sample folder)
          if(typeof params[key]!=='string'||spec.pattern&&!new RegExp(spec.pattern).test(params[key]))return refuse({error:`Invalid workflow input / 流程輸入格式不正確: ${key}`,code:'param_invalid',params:[key]},400,'invalid-input.params');
        }
        if(ownWorkflow(chosenDef)&&ownStaffingPlan(chosenDef!).plan.length){ // nothing to staff: a card-only workflow just starts
          const staffing={...ownStaffingPlan(chosenDef!),claudeVerification:ownClaudePlan(chosenDef)};
          if(staffing.missing.length)return refuse({error:'Choose a provider, model and (for Codex) effort for every agent node before Run / 執行前請為每個代理節點選擇供應商、模型與（Codex）推理強度',code:'staffing_incomplete',staffing},409,"env.staffing");
          if(b?.staffingConfirm!==staffing.hash||(staffing.claudeVerification&&hashInput({value:b?.claudeVerification??null})!==hashInput({value:staffing.claudeVerification})))return refuse({error:'Confirm who works on each node before this Task starts / 開始任務前請確認每個節點的人員配置',code:'staffing_confirmation_required',staffing},409,"env.staffing");
          params._ownStaffing=staffing.hash;
        }
        if(boardStaffed(chosenDef)){
          if(params.repo)return json({error:'Choose a registered project; a repository path cannot carry approved staffing / 請選擇已登錄專案；直接指定儲存庫路徑無法帶入已核准的代理配置',code:'project_required'},400);
          const pid=String(params.project??'');if(!pid)return json({error:'Choose a registered project for this workflow / 請為此流程選擇已登錄專案',code:'project_required'},400);
          await staffingFacts();
          const crew=boardStaffing(chosenDef,pid);if(crew.state!=='approved')return json({error:`${crew.reason.en} / ${crew.reason.zh}`,code:crew.code,staffing:crew},409);
          // the crew the captain saw when the form loaded: a crew approved again since then is reviewed again, never started blind
          if(b?.staffingExpected!==undefined&&b.staffingExpected!==crew.hash)return json({error:'The approved crew changed since this form loaded; review it again / 已核准的代理配置在表單載入後已變更，請重新確認',code:'staffing_changed',staffing:{state:'blocked',code:'staffing_changed',reason:{en:'The approved crew changed since this form loaded; review it again',zh:'已核准的代理配置在表單載入後已變更，請重新確認'}}},409);
          params={...params,base:projects.get(pid)!.base,_staffing:crew.hash};
        }
        if(chosenDef?.kind==="coffee-kit") {
          let config;try{config=staffing.current(coffeeStaffingProject(params.project));}catch{return refuse({error:'Discuss and approve each coffee role before starting',code:'coffee-staffing-required'},409,"env.staffing");}const image=config.roles['image-worker'];
          if(!image||image.provider!=='codex')return refuse({error:"Confirm an available dedicated Codex image role; no vendor fallback",code:"coffee-staffing-required"},409,"env.staffing");
          params={...params,_staffing:config.hash};
        }
        let r;try{r = ownClaude.start({ workflow: wf, version: b?.version ? Number(b.version) : undefined, title: b?.title, text: ownWorkflow(chosenDef) ? ownBrief(chosenDef, text, params) : text, params, by, classifier: cls },b?.claudeVerification);}
        catch(e:any){if(!boardStaffed(chosenDef))throw e;const message=String(e?.message??e).replace(/^Staffing approval requires confirmation: /,'');return json({error:message,code:'staffing_not_ready',staffing:{state:'blocked',code:'staffing_not_ready',reason:{en:message,zh:'已核准的代理目前無法開始；請更新代理能力狀態後再試。'}}},409);}
        return json(runView(r.id, who));
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
      m = /^\/api\/wruns\/(R-\d+)(?:\/(pause|resume|cancel|file|events|evidence|archive|delete)|\/nodes\/([a-z0-9-]+)\/agent)?$/.exec(p);
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
        // archive and delete: an ended run only (409 for a live one); delete needs the typed id (400)
        if (m[2] === "archive" || m[2] === "delete") {
          try { if (m[2] === "archive") return json(engine.archive(id, b?.archived !== false, by) && runView(id, who)); return json(engine.remove(id, String(b?.confirm ?? ""), by)); }
          catch (e: any) { const msg = String(e?.message ?? e); return json({ error: msg }, /only an ended run|still finishing/.test(msg) ? 409 : 400); }
        }
      }
      // ---------- Studio cards ----------
      if (p === "/api/scards" && !writing) return json({ cards: engine.cards.list({ open: url.searchParams.get("open") === "1" }).map(c=>engine.cards.view(c)) });
      m = /^\/api\/scards\/(SC-\d+)(?:\/(answer))?$/.exec(p);
      if (m) {
        if (!writing) { const c = engine.cards.get(m[1]); return c ? json(engine.cards.view(c)) : json({ error: "no such card" }, 404); }
        const c = await engine.answer(m[1], { choice: String(b?.choice ?? ""), note: b?.note ?? null, by, confirm: b?.confirm ?? null, aligned: Array.isArray(b?.aligned) ? b.aligned : null, localRescope:b?.localRescope??null });
        return json(c);
      }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e), problems: e?.problems ?? undefined, refusal: e?.refusal ?? undefined, failure: e?.refusal ? undefined : fromError(e, { source: "params" }) }, 400); }
  }
  return { handle, engine, defs, projects, firstmate, onboarding, drafts, readiness, classify: (t: string, project?: string | null) => classifyIntent(defs, t, engine.policies.get("sensitive_paths", { project: project ?? null }).value ?? [], engine.policies.get("intake.one_way_words").value ?? []) };
}
export { schemaDefaults };
