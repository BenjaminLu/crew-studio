// The Crew page's API (#/team, public/team.js; docs/design/crew-seats.md):
//   GET  /api/team          the team, every workflow's resolved crew, the seats, the models and skills to choose from
//   POST /api/team/change   {change, expected}: the captain's change from the page (desktop only); compare-and-swap on expected
// Firstmate never calls these: it proposes a change on a captain card (src/crew-tools.ts).
import {withJudges,type JudgeSlot,CrewStore,resolveCrew,crewBadge,changeImpact,applyChange,teamBody,emptyTeam,slotsOf,declaredSeats,seatLabel,seatUses,BUILTIN_SEATS,PRESETS,EFFORTS,type Team} from './domain/crew';
import {staffingApplies} from './domain/staffing';
import {withRoleNodes} from './crew-staffing';
import type {WorkflowDefs} from './runtime/defs';

export type CrewViewDeps={defs:WorkflowDefs;store:CrewStore;
 /** the judged checks of a definition, on their reviewing seats (src/crew-guard.ts judgeSlots): shown and counted like nodes */
 judges?:(def:any)=>JudgeSlot[];facts:()=>{provider:string;models:{id:string;efforts:string[]}[]}[];library:()=>{id:string;name:string;description?:string;current:number;sha256:string}[]};
/** The workflows the team staffs: every selectable workflow with an agent node (the startup competition keeps its own pick). */
export const crewWorkflows=(defs:WorkflowDefs)=>defs.catalog().map(w=>defs.get(w.id,w.version)).filter((d:any)=>d&&d.kind!=='startup-recursion'&&slotsOf(d).length>0) as any[];
export function crewView(d:CrewViewDeps){
 const cfg=d.store.current(),team:Team=cfg?teamBody(cfg):emptyTeam(),wfs=crewWorkflows(d.defs).map(def=>withJudges(def,d.judges?.(def)??[]));
 const lib=(()=>{try{return d.library();}catch{return [];}})(),name=(id:string)=>lib.find(s=>s.id===id)?.name??id;
 const workflows=wfs.map(def=>{const res=resolveCrew(team,def,{},cfg?.hash??null);const order=new Map(def.nodes.map((n:any,i:number)=>[n.id,i]));
  // a staffed workflow also needs the seats of roles no agent node shows (coffee's image worker): its staffing derives from every role
  const staffed=staffingApplies(def),roles=staffed?resolveCrew(team,withRoleNodes(def)):null,missing=roles?roles.missing:res.missing;
  // which seat is empty, and for which role: a staffed role no node shows (coffee's image worker) is named, not just counted
  const missingRoles=(roles?.nodes??[]).filter(n=>n.source==='missing'&&n.node.startsWith('role--')).map(n=>({role:n.role,label:n.label,seat:n.seat,seatLabel:seatLabel(team,n.seat,def)}));
  return{id:def.id,name:def.name,version:def.version,kind:def.kind??null,staffed,badge:missing.length?{state:'missing',count:missing.length}:crewBadge(res),missing,missingRoles,
   nodes:res.nodes.sort((a,b)=>Number(order.get(a.node))-Number(order.get(b.node))).map(n=>({...n,judge:n.node.startsWith('judge--'),skills:n.skills.map(p=>({...p,name:name(p.id)}))}))};});
 const declared=new Map<string,any>();for(const def of wfs)for(const s of declaredSeats(def))if(!declared.has(s.id))declared.set(s.id,structuredClone(s));
 const ids=[...BUILTIN_SEATS,...Object.keys(team.seats),...[...declared.keys()].filter(id=>!team.seats[id])];
 const seats=ids.map(id=>({id,label:seatLabel(team,id,[...declared.values()].find(s=>s.id===id)?{seats:[declared.get(id)]}:undefined),builtin:(BUILTIN_SEATS as readonly string[]).includes(id),declared:team.seats[id]??declared.get(id)??null,
  member:team.members[id]?{...team.members[id],skills:team.members[id].skills.map(p=>({...p,name:name(p.id)}))}:null,uses:seatUses(team,id,wfs).length,usesModel:seatUses(team,id,wfs,'model').length,usesEffort:seatUses(team,id,wfs,'effort').length}));
 // models to choose from: the verified facts, then every model the team already uses
 const models:{provider:string;model:string;efforts:string[]}[]=[];const add=(provider:string,model:string,efforts:string[])=>{if(!models.some(m=>m.provider===provider&&m.model===model))models.push({provider,model,efforts});};
 for(const f of d.facts())for(const m of f.models)add(f.provider,m.id,m.efforts);
 for(const m of Object.values(team.members))add(m.provider,m.model,m.provider==='claude'?[]:EFFORTS.slice(2,6));
 for(const w of Object.values(team.workflows))for(const o of Object.values(w.nodes))if(o.model)add(o.provider??'codex',o.model,EFFORTS.slice(2,6));
 return{team:cfg?{version:cfg.version,hash:cfg.hash,approval:cfg.approval}:null,workflows,seats,models,efforts:EFFORTS.slice(2,6),library:lib.map(s=>({id:s.id,name:s.name,v:s.current,sha256:s.sha256,description:s.description??''})),presets:Object.entries(PRESETS).map(([id,p])=>({id,en:p.en,zh:p.zh}))};
}
export function crewRoutes(d:CrewViewDeps&{refreshFacts?:()=>Promise<unknown>}){
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return async function handle(p:string,url:URL,method:string,writing:boolean,b:any,who:{kind:string}):Promise<Response|null>{
  if(p==='/api/team'&&!writing){if(url.searchParams.get('facts')==='1')try{await d.refreshFacts?.();}catch{}return json(crewView(d));}
  if(p==='/api/team/change'){
   if(!writing||method!=='POST')return json({error:'POST required'},405);if(who.kind!=='desktop')return json({error:'Change the team on the desktop',code:'desktopOnly'},403);
   const cfg=d.store.current(),before:Team=cfg?teamBody(cfg):emptyTeam();
   if((b?.expected??null)!==(cfg?.hash??null))return json({error:'The team changed since you looked; reload and choose again',tw:'團隊在你看過之後改了；請重新整理再選一次'},409);
   const c=b?.change,def=c?.kind==='node'?d.defs.get(c.workflow):undefined;
   let next:Team;try{next=applyChange(before,c,def);}catch(e:any){return json({error:String(e?.message??e)},400);}
   const written=d.store.write(next,cfg?.hash??null,{by:'captain',via:'page'});
   const wfs=crewWorkflows(d.defs).map(def=>withJudges(def,d.judges?.(def)??[]));const impact=changeImpact(before,next,wfs);
   const notes=wfs.flatMap(def=>resolveCrew(next,def).nodes.filter(n=>impact.some(i=>i.workflow===def.id&&i.node===n.node)).flatMap(n=>n.notes.map(x=>({workflow:def.id,node:n.node,...x}))));
   return json({...crewView(d),changed:{version:written.version,impact,notes}});
  }
  return null;};
}
