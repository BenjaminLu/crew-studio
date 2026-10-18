// A Task of a workflow staffed by the team directly (web, documents, video, the captain's own …) runs what the team said
// when it started: the resolution is recorded once in the signed run ledger (crew-resolved) and every agent turn reads
// that record, so a later team edit never changes a running Task (docs/design/crew-seats.md).
import {CrewStore,resolveCrew,parseRunOverride,teamBody,slotsOf,withJudges,seatLabel,EFFORTS,type Resolution,type JudgeSlot} from './domain/crew';
import {staffingApplies,staffingHash,nodeRole} from './domain/staffing';
import {QueueRefusal} from './runtime/queue';
import type {Engine} from './runtime/engine';

/** Workflows whose agents the team staffs directly. Staffed workflows (code, coffee-kit) derive their signed project staffing
 *  from the team instead (src/crew-staffing.ts); the startup competition keeps its own two-vendor pick. */
export const crewApplies=(def:any)=>!!def&&!staffingApplies(def)&&def.kind!=='startup-recursion'&&slotsOf(def).length>0;
export type CrewRecord={schema:1;team:string;teamVersion:number;workflow:string;version:number;definition:string;run:Record<string,{effort:string|null}>;project?:string|null;
 nodes:Record<string,{seat:string;provider:string;model:string;effort:string|null;skills:{id:string;v:number;sha256:string;from:'member'|'node'}[];source:string;notes:{en:string;zh:string}[]}>;
 judges:Record<string,{provider:string;model:string;effort:string|null}>};
/** The seats a judge turn runs as, by the role a check judges with (code workflows keep their staffed reviewer and designer). */
export const judgeSeat=(def:any,role:string|undefined)=>{const r=def?.roles?.find((x:any)=>x.id===role);return typeof r?.seat==='string'&&r.seat!=='maker'&&r.seat!=='alt-maker'?r.seat:role==='designer'?'design-reviewer':'reviewer';};
/** The judged checks of a definition (a model judges a node's work), each on the reviewing seat it judges as: the same role the engine's
 *  judge turns use (the check's declared role, else the node's own role, else designer or reviewer by the check). A check judging with the
 *  node's own role runs as that node and adds no seat. */
export function judgeSlots(engine:Pick<Engine,'registry'>,def:any):JudgeSlot[]{
 const out:JudgeSlot[]=[];const add=(node:any,refs:any[]|undefined)=>{for(const ref of refs??[]){let man:any=null;try{man=engine.registry.get(ref.use);}catch{}if(!man||man.kind!=='judged')continue;
  const own=node?nodeRole(def,node):undefined,declared=typeof man.judge?.role==='string'&&man.judge.role?man.judge.role:undefined,role=declared??(own&&def.roles?.some((r:any)=>r.id===own)?own:man.id?.includes('designer')?'designer':'reviewer');
  if(node&&role===own&&(node.kind==='agent'||node.kind==='loop'))continue;
  const at=node??def.nodes.find((n:any)=>n.id===ref.__to);out.push({node:at?.id??'edge',check:ref.use,label:`${at?.label??''} · ${man.title?.en??ref.use}`.replace(/^ · /,''),seat:judgeSeat(def,role)});}};
 for(const n of def?.nodes??[])add(n,n.checks);
 for(const e of def?.edges??[])add(def.nodes.find((n:any)=>n.id===e.to),e.checks);
 return out.filter((j,i,a)=>a.findIndex(x=>x.node===j.node&&x.check===j.check)===i);
}
export function missingSeatsError(res:Resolution){const seats=res.missing.join(', ');return new Error(`${res.workflow} needs the team seat${res.missing.length>1?'s':''} ${seats}, which nobody fills yet. Fill ${res.missing.length>1?'them':'it'} on the Crew page (or approve Firstmate's seat card), then start again. / ${res.workflow} 需要團隊的「${seats}」位置，目前沒有人；請在船員頁補上（或核准 Firstmate 的位置卡）再開始。`);}
export function crewRecordOf(res:Resolution,team:{hash:string;version:number;members:any},def:any,run:Record<string,{effort:string|null}>):CrewRecord{
 const nodes:CrewRecord['nodes']={};for(const r of res.nodes)nodes[r.node]={seat:r.seat,provider:r.provider!,model:r.model!,effort:r.effort,skills:r.skills.map(p=>({id:p.id,v:p.v,sha256:p.sha256,from:p.from})),source:r.source,notes:r.notes};
 // judge turns (a judged check on these nodes): the reviewing seats' picks, at medium effort or more
 const judges:CrewRecord['judges']={};for(const seat of ['reviewer','design-reviewer']){const row=res.nodes.find(r=>r.seat===seat),m=team.members[seat];const p=row?{provider:row.provider!,model:row.model!,effort:row.effort}:m?{provider:m.provider,model:m.model,effort:m.effort}:null;if(!p)continue;if(p.effort!==null&&EFFORTS.indexOf(p.effort)<EFFORTS.indexOf('medium'))p.effort='medium';judges[seat]=p;}
 return{schema:1,team:team.hash,teamVersion:team.version,workflow:def.id,version:def.version,definition:staffingHash(def),run,project:res.project??null,nodes,judges};
}
/** The project a Task's crew is resolved for (its project layer): the Task's project parameter, when it names one. */
export const crewProject=(params:Record<string,unknown>|undefined)=>typeof params?.project==='string'&&params.project.trim()?params.project:null;
export function installCrewGuard(engine:Engine,store:CrewStore){
 const resolve=(def:any,params:Record<string,string>|undefined)=>{const team=store.current();if(!team)return null;const run=parseRunOverride(params?._crewRun);
  for(const n of Object.keys(run))if(!slotsOf(def).some(s=>s.node===n))throw new Error(`The run override names ${n}, which is not an agent node of ${def.id}`);
  const res=resolveCrew(teamBody(team),withJudges(def,judgeSlots(engine,def)),run,team.hash,crewProject(params));return{team,res,run};};
 /** The crew a Task started with, from its signed ledger; null for a Task started before the team existed. */
 function recordOf(run:any):CrewRecord|null{
  const t=engine.trusted(run.id);const e=t.entries.filter(x=>x.record==='crew-resolved').at(-1);if(!e)return null;
  if(!t.ok)throw new QueueRefusal('The crew this Task started with is in an untrusted ledger');
  const d=e.data as CrewRecord;if(d?.schema!==1||d.workflow!==run.def.id||d.version!==run.def.version||d.definition!==staffingHash(run.def))throw new QueueRefusal('The crew record differs from this Task\'s workflow');return d;}
 const previousStart=engine.deps.authorizeStart;
 engine.deps.authorizeStart=(def:any,o:any)=>{previousStart?.(def,o);
  // a dispatch card showed the crew of one team version: a Task starts only on that version (a team changed since is shown again)
  const shown=o?.params?._crewTeam;if(typeof shown==='string'&&shown!==(store.current()?.hash??'none'))throw Object.assign(new Error('The team changed after the dispatch card showed its crew; Studio shows the crew again before this work starts / 派工卡顯示人員之後團隊改了；開始前會重新顯示人員'),{crewChanged:true});
  if(!crewApplies(def))return;const r=resolve(def,o?.params);if(r?.res.missing.length)throw missingSeatsError(r.res);};
 const previousInit=engine.deps.initializeRun;
 engine.deps.initializeRun=(run:any,o:any)=>{previousInit?.(run,o);if(!crewApplies(run.def))return;const r=resolve(run.def,run.params);if(!r)return;if(r.res.missing.length)throw missingSeatsError(r.res);
  const node=run.def.nodes[0];engine.record(engine.x(run,node,run.nodes[node.id]),'crew-resolved',{data:crewRecordOf(r.res,r.team,run.def,r.run)});};
 const previousPick=engine.deps.approvedPick;
 engine.deps.approvedPick=(run:any,node:any,roleOverride?:string)=>{
  const prior=previousPick?.(run,node,roleOverride);if(prior||!crewApplies(run?.def))return prior;
  const rec=recordOf(run);if(!rec)return prior;
  // the captain's own pick for this node on this Task (the run page) is a run override: it wins
  if(run.nodes?.[node?.id]?.agent)return prior;
  const own=nodeRole(run.def,node);
  // a judge turn (a check judging with a role) runs as a reviewing seat; a node the crew does not staff keeps the engine's own pick
  if(roleOverride&&roleOverride!==own){const j=rec.judges[judgeSeat(run.def,roleOverride)];return j?{provider:j.provider,model:j.model,effort:j.effort}:prior;}
  if(!rec.nodes[node?.id])return prior;
  const n=rec.nodes[node.id];return{provider:n.provider,model:n.model,effort:n.effort};};
 // the captain's pick on the run page (captain-only, as before) is recorded next to the crew, with the rule it breaks said plainly
 const previousChange=engine.deps.authorizePickChange;
 engine.deps.authorizePickChange=(run:any,node:any,pick:any)=>{previousChange?.(run,node,pick);if(!crewApplies(run?.def))return;const rec=recordOf(run),n=rec?.nodes[node?.id];if(!rec||!n)return;
  const team=store.byHash(rec.team),notes:{en:string;zh:string}[]=[],me=seatLabel(team,n.seat,run.def);
  const target=n.seat==='alt-maker'||n.seat==='reviewer'||n.seat==='design-reviewer'?'maker':team?.seats[n.seat]?.reviews;
  if(target&&Object.values(rec.nodes).some(o=>o.seat===target&&o.provider===pick.provider&&o.model===(pick.model??null))){const who=seatLabel(team,target,run.def);notes.push({en:`${me.en} now runs on the same model as ${who.en} (${pick.provider} ${pick.model}): a fresh context, not an independent opinion.`,zh:`${me.zh}現在跟${who.zh}用同一個模型（${pick.provider} ${pick.model}）：是新的脈絡，不是獨立意見。`});}
  if((n.seat==='reviewer'||n.seat==='design-reviewer'||team?.seats[n.seat]?.reviews)&&typeof pick.effort==='string'&&EFFORTS.indexOf(pick.effort)<EFFORTS.indexOf('medium'))notes.push({en:`${me.en} judges work at ${pick.effort} effort, under the team's medium minimum.`,zh:`${me.zh}用 ${pick.effort} 審查，低於團隊要求的 medium。`});
  engine.record(engine.x(run,node,run.nodes[node.id]),'crew-run-override',{data:{schema:1,team:rec.team,node:node.id,seat:n.seat,from:{provider:n.provider,model:n.model,effort:n.effort},to:{provider:pick.provider,model:pick.model??null,effort:pick.effort??null},notes}});};
 const previousPins=engine.deps.approvedNodePins;
 engine.deps.approvedNodePins=(run:any,node:any)=>{const prior=previousPins?.(run,node);if(prior!==undefined||!crewApplies(run?.def))return prior;const rec=recordOf(run),n=rec?.nodes[node?.id];return n?n.skills.map(p=>({id:p.id,v:p.v,sha256:p.sha256})):prior;};
 return{recordOf,resolve};
}
