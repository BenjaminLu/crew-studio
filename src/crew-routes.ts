// The Crew page's API (#/team, public/team.js; docs/design/crew-seats.md):
//   GET  /api/team          the team, every workflow's resolved crew, the seats, the models and skills to choose from;
//                           ?project=<id> resolves every workflow in that project (its project layer applied)
//   POST /api/team/change   {change, expected, skillDecisions?}: the captain's change from the page (desktop only); compare-and-swap on expected.
//                           A change that brings a script skill the captain never decided is answered 409 {code:"skillDecision", skills}
//                           (its scripts, flags and hosts); the page asks and sends it again with {"<id>@v<N>": "scripts"|"text-only"}.
// Firstmate never calls these: it proposes a change on a captain card (src/crew-tools.ts).
import {withJudges,type JudgeSlot,CrewStore,resolveCrew,crewBadge,changeImpact,applyChange,teamBody,emptyTeam,slotsOf,declaredSeats,seatLabel,seatUses,projectUses,IMAGE_SEAT,BUILTIN_SEATS,PRESETS,EFFORTS,type Team} from './domain/crew';
import type {OnboardingTeam} from './onboarding-team';
import {staffingApplies} from './domain/staffing';
import {withRoleNodes} from './crew-staffing';
import type {WorkflowDefs} from './runtime/defs';
import type {SkillPackages} from './skillpkg/index';
import {defPins,pendingScripts,teamPins} from './skillpkg/crew';

export type CrewViewDeps={defs:WorkflowDefs;store:CrewStore;
 /** the judged checks of a definition, on their reviewing seats (src/crew-guard.ts judgeSlots): shown and counted like nodes */
 judges?:(def:any)=>JudgeSlot[];
 /** a role's skill as agents receive it (src/runtime/engine.ts roleSkillUse): ref, Studio's version, sha256 of the exact text */
 roleSkill?:(def:any,role:string|null)=>RoleSkillView|null;facts:()=>CrewFacts[];library:()=>{id:string;name:string;description?:string;current:number;sha256:string}[];
 /** the registered projects the page can choose ("only this project") */
 projects?:()=>{id:string;name:string}[];
 /** script skills (src/skillpkg): readiness on the page, the captain's decision on a change that brings one */
 skillPackages?:()=>SkillPackages|null};
const PROJECT=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
export type RoleSkillView={role?:string|null;ref:string|null;version:number|null;sha256:string;parts?:{ref:string;sha256:string|null}[]};
/** A role skill's short name: the file of its ref (worker.md), each part's for a role of several named skills. */
export const roleSkillLabel=(r:RoleSkillView)=>(r.parts?.length?r.parts.map(p=>p.ref):[r.ref??'']).map(x=>x.split(/[/:]/).pop()||x).join(' + ');
/** A judged check's own duty skills: the pins on its ref, on the node it sits on or on an edge into that node. */
export const checkPins=(def:any,node:string,check:string)=>{const n=def.nodes.find((x:any)=>x.id===node);const refs=[...(n?.checks??[]),...def.edges.filter((e:any)=>e.to===node).flatMap((e:any)=>e.checks??[])];return(refs.find((c:any)=>c.use===check&&Array.isArray(c.skills))?.skills??[]) as {id:string;v:number;sha256:string}[];};
/** A provider's staffing facts as the Crew page reads them (src/firstmate-staffing.ts StaffingFacts). */
export type CrewFacts={provider:string;models:{id:string;efforts:string[]}[];candidates?:{id:string;efforts:string[]}[];auth?:string;reason?:string;
 detectedAt?:number;inventory?:'detected'|'unverified-fallback'|'unavailable';inventoryReason?:string;login?:'logged-in'|'not-logged-in'|'unknown'};
export type CrewModel={provider:string;model:string;efforts:string[];available:boolean;unverified?:true};
/** The models to choose from: every model a provider reports on this machine right now (the Codex probe's list, the Claude
 * CLI's own list), each with the efforts it reported; nothing else. A model the team still uses that is no longer reported
 * stays, marked unavailable, so the page can show it. Per provider: login, how many models, when they were read, and why not. */
export function crewModels(facts:CrewFacts[],team:Team){
 const models:CrewModel[]=[];const add=(m:CrewModel)=>{if(!models.some(x=>x.provider===m.provider&&x.model===m.model))models.push(m);};
 for(const f of facts)for(const m of[...f.models,...f.candidates??[]])add({provider:f.provider,model:m.id,efforts:m.efforts,available:true,...f.inventory==='unverified-fallback'?{unverified:true as const}:{}});
 for(const m of Object.values(team.members))add({provider:m.provider,model:m.model,efforts:[],available:false});
 for(const w of Object.values(team.workflows))for(const o of Object.values(w.nodes))if(o.model)add({provider:o.provider??'codex',model:o.model,efforts:[],available:false});
 for(const pr of Object.values(team.projects??{}))for(const [seat,o] of Object.entries(pr.seats))if(o.model)add({provider:o.provider??team.members[seat]?.provider??'codex',model:o.model,efforts:[],available:false});
 // Cursor is listed once Studio has read it or the team uses it; a Codex and Claude crew reads as it always did
 const providers=(['codex','claude','cursor'] as const).filter(id=>id!=='cursor'||facts.some(x=>x.provider===id)||models.some(m=>m.provider===id)).map(id=>{const f=facts.find(x=>x.provider===id),count=models.filter(m=>m.provider===id&&m.available).length;
  if(!f)return{provider:id,state:'unread' as const,login:'unknown' as const,count,detectedAt:null,reason:null};
  const state=f.inventory??(count?'detected':'unavailable');
  return{provider:id,state,login:f.login??(f.auth==='verified'?'logged-in' as const:'unknown' as const),count,detectedAt:f.detectedAt??null,reason:f.inventoryReason??(state==='detected'?null:f.reason??null)};});
 return{models,providers};
}
/** The workflows the team staffs: every selectable workflow with an agent node (the startup competition keeps its own pick). */
export const crewWorkflows=(defs:WorkflowDefs)=>defs.catalog().map(w=>defs.get(w.id,w.version)).filter((d:any)=>d&&d.kind!=='startup-recursion'&&slotsOf(d).length>0) as any[];
export function crewView(d:CrewViewDeps,project:string|null=null){
 const cfg=d.store.current(),team:Team=cfg?teamBody(cfg):emptyTeam(),wfs=crewWorkflows(d.defs).map(def=>withJudges(def,d.judges?.(def)??[]));
 const lib=(()=>{try{return d.library();}catch{return [];}})(),name=(id:string)=>lib.find(s=>s.id===id)?.name??id;
 const role=(def:any,id:string|null)=>{try{const r=d.roleSkill?.(def,id);return r?{...r,name:roleSkillLabel(r)}:null;}catch{return null;}};
 const workflows=wfs.map(def=>{const res=resolveCrew(team,def,{},cfg?.hash??null,project);const order=new Map(def.nodes.map((n:any,i:number)=>[n.id,i]));
  // a judge row: the role it judges as (its role skill) and its check's own duty skills, which its judge turns load
  const slots=d.judges?.(def)??[],judgeOf=(id:string)=>{const m=/^judge--.+--(\d+)$/.exec(id);return m?slots[Number(m[1])]??null:null;};
  // a staffed workflow also needs the seats of roles no agent node shows (coffee's image worker): its staffing derives from every role
  const staffed=staffingApplies(def),roles=staffed?resolveCrew(team,withRoleNodes(def),{},null,project):null,missing=roles?roles.missing:res.missing;
  // which seat is empty, and for which role: a staffed role no node shows (coffee's image worker) is named, not just counted
  const missingRoles=(roles?.nodes??[]).filter(n=>n.source==='missing'&&n.node.startsWith('role--')).map(n=>({role:n.role,label:n.label,seat:n.seat,seatLabel:seatLabel(team,n.seat,def)}));
  return{id:def.id,name:def.name,version:def.version,kind:def.kind??null,staffed,badge:missing.length?{state:'missing',count:missing.length}:crewBadge(res),missing,missingRoles,
   nodes:res.nodes.sort((a,b)=>Number(order.get(a.node))-Number(order.get(b.node))).map(n=>{const j=n.node.startsWith('judge--')?judgeOf(n.node):null;
    return{...n,judge:n.node.startsWith('judge--'),roleSkill:role(def,j?j.role??null:n.role),skills:n.skills.map(p=>({...p,name:name(p.id)})),...(j?{duty:checkPins(def,j.node,j.check).map(p=>({...p,name:name(p.id)}))}:{})};})};});
 const declared=new Map<string,any>();for(const def of wfs)for(const s of declaredSeats(def))if(!declared.has(s.id))declared.set(s.id,structuredClone(s));
 // an image hook on no declared seat runs as the image maker: shown so it can be filled
 if(!declared.has(IMAGE_SEAT.id)&&!team.seats[IMAGE_SEAT.id]&&wfs.some(def=>slotsOf(def).some(s=>s.seat===IMAGE_SEAT.id)))declared.set(IMAGE_SEAT.id,structuredClone(IMAGE_SEAT));
 const ids=[...BUILTIN_SEATS,...Object.keys(team.seats),...[...declared.keys()].filter(id=>!team.seats[id])];
 const seats=ids.map(id=>({id,label:seatLabel(team,id,[...declared.values()].find(s=>s.id===id)?{seats:[declared.get(id)]}:undefined),builtin:(BUILTIN_SEATS as readonly string[]).includes(id),declared:team.seats[id]??declared.get(id)??null,
  member:team.members[id]?{...team.members[id],skills:team.members[id].skills.map(p=>({...p,name:name(p.id)}))}:null,uses:seatUses(team,id,wfs).length,usesModel:seatUses(team,id,wfs,'model').length,usesEffort:seatUses(team,id,wfs,'effort').length,
  // in a project: what that project changed on the seat, and how many of its nodes a project change of the model or effort reaches
  ...(project?{project:team.projects?.[project]?.seats[id]??null,usesProjectModel:projectUses(team,id,wfs,project,'model').length,usesProjectEffort:projectUses(team,id,wfs,project,'effort').length}:{})}));
 // the projects to choose from: the registered ones, then any the team already overrides
 const projects:{id:string;name:string;custom:boolean}[]=[];for(const p of (()=>{try{return d.projects?.()??[];}catch{return [];}})())projects.push({id:p.id,name:p.name,custom:!!team.projects?.[p.id]});
 for(const id of Object.keys(team.projects??{}))if(!projects.some(p=>p.id===id))projects.push({id,name:id,custom:true});
 const {models,providers}=crewModels(d.facts(),team);
 return{team:cfg?{version:cfg.version,hash:cfg.hash,approval:cfg.approval}:null,project,projects,workflows,seats,models,providers,efforts:EFFORTS.slice(2,6),library:lib.map(s=>({id:s.id,name:s.name,v:s.current,sha256:s.sha256,...((s as any).filesSha256?{filesSha256:(s as any).filesSha256}:{}),description:s.description??''})),skillStatus:skillStatus(d,team,lib),presets:Object.entries(PRESETS).map(([id,p])=>({id,en:p.en,zh:p.zh}))};
}
/** Each script skill version the page shows (the team's pins, the library's current versions): its readiness line, en and zh-TW. */
function skillStatus(d:CrewViewDeps,team:Team,lib:{id:string;current:number;sha256:string}[]){
 const pk=(()=>{try{return d.skillPackages?.()??null;}catch{return null;}})();if(!pk)return{};const out:Record<string,unknown>={};
 for(const p of [...teamPins(team),...lib.map(s=>({id:s.id,v:s.current}))]){const k=`${p.id}@v${p.v}`;if(k in out)continue;try{const b=pk.badge(p.id,p.v);if(b)out[k]=b;}catch{}}
 return out;
}
/** How long a model detection is reused when the page opens again (the 重新偵測 button always detects afresh). */
export const DETECT_REUSE_MS=60_000;
/** 重新偵測 within this long of the last detection reuses it: repeated clicks never stack probes. */
export const DETECT_FORCE_MIN_MS=10_000;
export function crewRoutes(d:CrewViewDeps&{refreshFacts?:()=>Promise<unknown>;reuseMs?:number;forceMinMs?:number;onboarding?:OnboardingTeam}){
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 // GET /api/team?facts=1 (the page opening) detects the models again unless a detection finished within reuseMs;
 // &force=1 (重新偵測) does unless one finished within forceMinMs. Concurrent requests share one detection: the probes are free but not instant.
 let detectedAt=0,detecting:Promise<unknown>|null=null;
 const detect=(force:boolean)=>{if(!d.refreshFacts)return null;if(detecting)return detecting;if(Date.now()-detectedAt<(force?d.forceMinMs??DETECT_FORCE_MIN_MS:d.reuseMs??DETECT_REUSE_MS))return null;
  const run=detecting=d.refreshFacts().catch(()=>{}).finally(()=>{detectedAt=Date.now();if(detecting===run)detecting=null;});return run;};
 return async function handle(p:string,url:URL,method:string,writing:boolean,b:any,who:{kind:string},signal?:AbortSignal):Promise<Response|null>{
  if(p==='/api/team/setup'||p.startsWith('/api/team/setup/')){
   if(who.kind!=='desktop')return json({error:'Configure the team on the desktop'},403);
   if(!d.onboarding)return json({error:'Team setup is unavailable'},409);
   try{if(p==='/api/team/setup'&&!writing)return json(await d.onboarding.view());
    if(!writing||method!=='POST')return json({error:'Authenticated POST required'},405);
    if(p==='/api/team/setup/verify')return json(await d.onboarding.verify(b,signal));
    if(p==='/api/team/setup/save')return json(await d.onboarding.save(b));
    if(p==='/api/team/setup/cancel')return json(d.onboarding.cancel());
    return json({error:'Unknown team setup action'},404);
   }catch(e:any){return json({error:String(e?.message??e)},409);}
  }
  const projectOf=(v:unknown)=>typeof v==='string'&&PROJECT.test(v)?v:null;
  if(p==='/api/team'&&!writing){if(url.searchParams.get('facts')==='1')await detect(url.searchParams.get('force')==='1');return json({...crewView(d,projectOf(url.searchParams.get('project'))),detection:{at:detectedAt||null}});}
  if(p==='/api/team/skill'){
   const pk=d.skillPackages?.();if(!pk)return json({error:'Script skills unavailable'},503);
   const id=writing?b?.id:url.searchParams.get('id'),v=writing?b?.v:Number(url.searchParams.get('v'));
   if(typeof id!=='string'||!Number.isInteger(v)||v<1)return json({error:'A skill version is required'},400);
   const facts=pk.cardFacts(id,v);if(!facts)return json({error:'Skill version not found'},404);
   const view=()=>({facts,status:pk.badge(id,v),decisionRevision:pk.decision(id,v)?.sig??null});
   if(!writing)return json(view());
   if(method!=='POST')return json({error:'POST required'},405);
   if(who.kind!=='desktop')return json({error:'Manage script skills on the desktop',code:'desktopOnly'},403);
   try{pk.assertDecidable(id,v,b);}catch(e:any){return json({error:String(e?.message??e),tw:'Skill 版本或檔案已變更；請重新查看。',code:'targetChanged'},409);}
   const decided=pk.decision(id,v);
   if(b.action==='retry'){
    if(decided?.scripts!=='approved')return json({error:'Only an approved script version can be prepared',tw:'只有已核准的 script 版本可以重新準備。'},409);
    await pk.ensure(id,v,undefined,true);return json(view());
   }
   if(b.action==='enable-scripts'){
    if(decided?.scripts!=='text-only'||b.previousDecision!==decided.sig)return json({error:'This decision changed; inspect the script permissions again before enabling',tw:'原決定已變更；請重新查看 script 權限後再啟用。',code:'decisionChanged'},409);
    pk.decide(id,v,'approved','captain','page-script-upgrade');return json(view());
   }
   if(!['scripts','text-only'].includes(b.action))return json({error:'Choose scripts, text-only, or retry'},400);
   if(decided)return json({error:'This version already has a decision; reload its status',tw:'這個版本已有決定；請重新查看狀態。',code:'alreadyDecided'},409);
   pk.decide(id,v,b.action==='scripts'?'approved':'text-only','captain','page');return json(view());
  }
  if(p==='/api/team/change'){
   if(!writing||method!=='POST')return json({error:'POST required'},405);if(who.kind!=='desktop')return json({error:'Change the team on the desktop',code:'desktopOnly'},403);
   const cfg=d.store.current(),before:Team=cfg?teamBody(cfg):emptyTeam();
   if((b?.expected??null)!==(cfg?.hash??null))return json({error:'The team changed since you looked; reload and choose again',tw:'團隊在你看過之後改了；請重新整理再選一次'},409);
   const c=b?.change,def=c?.kind==='node'?d.defs.get(c.workflow):undefined;
   let next:Team;try{next=applyChange(before,c,def);}catch(e:any){return json({error:String(e?.message??e)},400);}
   // a script skill the captain never decided: the page asks (its scripts and the hosts approving it allows), then sends the answer
   const pk=(()=>{try{return d.skillPackages?.()??null;}catch{return null;}})(),pending=pendingScripts(pk,[...teamPins(next),...(def?defPins(def):[])]);
   const said=b?.skillDecisions&&typeof b.skillDecisions==='object'?b.skillDecisions:{};
   if(pending.some(p=>!['scripts','text-only'].includes(said[`${p.id}@v${p.v}`])))return json({error:'This change brings a script skill: approve it with its scripts or as text only',tw:'這個變更帶來有 script 的 skill：請選「核准（含 script）」或「只當文字」',code:'skillDecision',skills:pending},409);
   try{for(const p of pending)pk!.assertDecidable(p.id,p.v,p);}catch(e:any){return json({error:String(e?.message??e),tw:'Skill 檔案已變更；請重新匯入並確認版本。',code:'targetChanged'},409);}
   const written=d.store.write(next,cfg?.hash??null,{by:'captain',via:'page'});
   for(const p of pending)if(!pk!.decision(p.id,p.v))pk!.decide(p.id,p.v,said[`${p.id}@v${p.v}`]==='text-only'?'text-only':'approved','captain','page');
   // the page reads the project it shows; a project change is measured in its own project
   const project=c?.kind==='project'||c?.kind==='project-restore'?projectOf(c.project):projectOf(b?.project);
   const wfs=crewWorkflows(d.defs).map(def=>withJudges(def,d.judges?.(def)??[]));const impact=changeImpact(before,next,wfs,project);
   const notes=wfs.flatMap(def=>resolveCrew(next,def,{},null,project).nodes.filter(n=>impact.some(i=>i.workflow===def.id&&i.node===n.node)).flatMap(n=>n.notes.map(x=>({workflow:def.id,node:n.node,...x}))));
   return json({...crewView(d,projectOf(b?.project)),changed:{version:written.version,impact,notes}});
  }
  return null;};
}
