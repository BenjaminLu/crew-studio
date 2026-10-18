// One Studio-wide team staffs every workflow's agent nodes (docs/design/crew-seats.md).
// A seat (maker, reviewer …) has one member: provider, model, effort and the member's own library skills. A node runs as
// its seat's member unless the workflow overrides it; a Task records what each node finally runs in its signed ledger.
// The team is written by the captain only (the Crew page, a captain card answer, the one-time migration), versioned,
// hash-chained and HMAC-signed like staffing; Firstmate proposes changes and never applies them.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerKey} from '../runtime/checks';
import {staffingHash,nodeRole} from './staffing';
import {TEAM_SEATS} from '../runtime/defs';

export const BUILTIN_SEATS=TEAM_SEATS;
export const SEAT_LABELS:Record<string,{en:string;zh:string}>={coordinator:{en:'Coordinator',zh:'協調'},maker:{en:'Maker',zh:'產出'},'alt-maker':{en:'Second maker',zh:'第二產出'},reviewer:{en:'Reviewer',zh:'審查'},'design-reviewer':{en:'Design reviewer',zh:'設計審查'}};
/** The seat a built-in reviewing seat judges: its model must differ from that seat's (alt-maker differs from maker too). */
const BUILTIN_REVIEWS:Record<string,string>={reviewer:'maker','design-reviewer':'maker','alt-maker':'maker'};
const BUILTIN_REVIEWING=new Set(['reviewer','design-reviewer']);
export const EFFORTS=['none','minimal','low','medium','high','xhigh'];
export const PROVIDERS=['codex','claude'] as const;
/** What a model can do, by provider (a fact's model may name its own tags). A specialist seat lists the tags it needs. */
export const PROVIDER_CAPS:Record<string,string[]>={codex:['code','tools','long-context','vision','image-generation'],claude:['code','tools','long-context','vision']};
export const CAP_LABELS:Record<string,{en:string;zh:string}>={'image-generation':{en:'generate images',zh:'產生圖片'},audio:{en:'listen to audio',zh:'聽音訊'},'long-context':{en:'long context',zh:'長上下文'},vision:{en:'read images',zh:'看圖片'},code:{en:'write code',zh:'寫程式'},tools:{en:'use tools',zh:'使用工具'}};

export type Pin={id:string;v:number;sha256:string};
export type Member={provider:'codex'|'claude';model:string;effort:string|null;skills:Pin[]};
/** A specialist seat a workflow or pack declares (a built-in seat needs no declaration). */
export type SeatDecl={id:string;label:string;labelZh:string;reviews?:string;needs?:string[];suggest?:{provider?:'codex'|'claude';model?:string;effort?:string|null}};
/** One node's workflow override: what the captain changed "only in this workflow". at: the node's role and kind when it was
 *  set, so the override carries to a later version only while that node is still the same role and kind. */
export type NodeOverride={at:{role:string|null;kind:string};seat?:string;provider?:'codex'|'claude';model?:string;effort?:string|null;add?:Pin[];remove?:string[]};
/** One project's change to a seat's member, on top of the team ("only this project"): any of provider, model, effort, skills. */
export type ProjectSeat={provider?:'codex'|'claude';model?:string;effort?:string|null;skills?:Pin[]};
/** projects: absent while no project overrides anything, so a team written before project overrides keeps its hash. */
export type Team={schema:1;members:Record<string,Member>;seats:Record<string,SeatDecl>;workflows:Record<string,{nodes:Record<string,NodeOverride>}>;projects?:Record<string,{seats:Record<string,ProjectSeat>}>};
export type TeamApproval={by:string;via:'page'|'card'|'migration';card?:string;run?:string;answerSeq?:number};
export type TeamConfig=Team&{version:number;previous:string|null;approval:TeamApproval;hash:string;signature:string};
export const emptyTeam=():Team=>({schema:1,members:{},seats:{},workflows:{}});

// ---------- validation (strict keys, like staffing) ----------
const plain=(x:any)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const ID=/^[a-z0-9][a-z0-9-]{0,40}$/;
/** A project key: a registered project id, or a coffee artifact project. */
const PROJECT=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
function bad(m:string):never{throw new Error(`Crew team: ${m}`);}
function onlyKeys(x:any,allowed:string[],what:string){if(!plain(x))bad(`${what} is not an object`);for(const k of Object.keys(x))if(!allowed.includes(k))bad(`${what} has an unknown field ${k}`);}
function text(x:any,what:string,max=200){if(typeof x!=='string'||!x.trim()||x.length>max||/[\u0000-\u001f]/.test(x))bad(`${what} is malformed`);}
function effortOk(e:any,provider:string,what:string){if(e===null){if(provider==='codex')bad(`${what}: choose a Codex effort`);return;}if(!EFFORTS.includes(e))bad(`${what}: unknown effort ${e}`);}
export function validatePins(list:any,what:string){if(!Array.isArray(list)||list.length>8)bad(`${what}: at most 8 skills`);const seen=new Set<string>();for(const p of list){onlyKeys(p,['id','v','sha256'],what);if(!ID.test(p.id)||!Number.isSafeInteger(p.v)||p.v<1||!/^[a-f0-9]{64}$/.test(p.sha256)||seen.has(p.id))bad(`${what}: a skill is pinned once as {id, v, sha256}`);seen.add(p.id);}}
function validateMember(m:any,what:string){onlyKeys(m,['provider','model','effort','skills'],what);if(!PROVIDERS.includes(m.provider))bad(`${what}: unknown provider`);text(m.model,`${what} model`);effortOk(m.effort,m.provider,what);validatePins(m.skills,`${what} skills`);}
function validateSeat(s:any,id:string){onlyKeys(s,['id','label','labelZh','reviews','needs','suggest'],`seat ${id}`);if(s.id!==id||!ID.test(id)||(BUILTIN_SEATS as readonly string[]).includes(id))bad(`seat ${id}: a specialist seat has its own id`);text(s.label,`seat ${id} label`,80);text(s.labelZh,`seat ${id} labelZh`,80);if(s.reviews!==undefined&&!ID.test(s.reviews))bad(`seat ${id}: reviews names a seat`);if(s.needs!==undefined&&(!Array.isArray(s.needs)||s.needs.length>8||s.needs.some((n:any)=>!ID.test(String(n)))))bad(`seat ${id}: needs lists capability tags`);if(s.suggest!==undefined)onlyKeys(s.suggest,['provider','model','effort'],`seat ${id} suggest`);}
function validateOverride(o:any,what:string){onlyKeys(o,['at','seat','provider','model','effort','add','remove'],what);onlyKeys(o.at,['role','kind'],`${what} at`);if(o.at.role!==null)text(o.at.role,`${what} role`,40);text(o.at.kind,`${what} kind`,20);
 if(o.seat!==undefined&&!ID.test(o.seat))bad(`${what}: seat`);if(o.provider!==undefined&&!PROVIDERS.includes(o.provider))bad(`${what}: provider`);if(o.model!==undefined)text(o.model,`${what} model`);if(o.effort!==undefined&&o.effort!==null&&!EFFORTS.includes(o.effort))bad(`${what}: effort`);
 if(o.add!==undefined)validatePins(o.add,`${what} added skills`);if(o.remove!==undefined&&(!Array.isArray(o.remove)||o.remove.length>8||o.remove.some((x:any)=>!ID.test(String(x)))))bad(`${what}: removed skills are skill ids`);
 if(Object.keys(o).length===1)bad(`${what}: an override changes something`);}
/** A seat's member in one project: the team's member with that project's changes (null: the team has no member on the seat). */
export function projectMember(team:Team|null,project:string|null|undefined,seat:string):{member:Member;from:Set<'provider'|'model'|'effort'|'skills'>}|null{
 const base=team?.members[seat];if(!base)return null;const p=project?team!.projects?.[project]?.seats[seat]:undefined,from=new Set<'provider'|'model'|'effort'|'skills'>();if(!p)return{member:base,from};
 const m:Member={provider:p.provider??base.provider,model:p.model??base.model,effort:Object.hasOwn(p,'effort')?p.effort??null:base.effort,skills:p.skills??base.skills};
 for(const k of ['provider','model','effort','skills'] as const)if(Object.hasOwn(p,k))from.add(k);return{member:m,from};}
function validateProjects(t:any){
 if(t.projects===undefined)return;if(!plain(t.projects)||!Object.keys(t.projects).length||Object.keys(t.projects).length>100)bad('projects');
 for(const[id,v]of Object.entries<any>(t.projects)){if(!PROJECT.test(id))bad(`project id ${id}`);onlyKeys(v,['seats'],`project ${id}`);if(!plain(v.seats)||!Object.keys(v.seats).length||Object.keys(v.seats).length>24)bad(`project ${id} seats`);
  for(const[seat,o]of Object.entries<any>(v.seats)){const what=`project ${id} seat ${seat}`;onlyKeys(o,['provider','model','effort','skills'],what);if(!Object.keys(o).length)bad(`${what}: an override changes something`);
   if(!t.members[seat])bad(`${what}: the team has no member on this seat (fill it for the whole team first)`);
   if(o.provider!==undefined&&!PROVIDERS.includes(o.provider))bad(`${what}: provider`);if(o.model!==undefined)text(o.model,`${what} model`);if(o.skills!==undefined)validatePins(o.skills,`${what} skills`);
   const pm=projectMember(t,id,seat)!.member;validateMember(pm,what);
   // a project never leaves a seat without what it needs (an image maker that cannot generate images would dead-end the work)
   const lack=(t.seats[seat]?.needs??[]).filter((n:string)=>!capabilitiesOf(pm.provider,pm.model).includes(n));
   if(lack.length)bad(`${what}: ${pm.provider} ${pm.model} cannot ${lack.map((n:string)=>CAP_LABELS[n]?.en??n).join(' and ')}, which this seat needs; choose a model that can`);}}}
export function validateTeam(t:any):asserts t is Team{
 onlyKeys(t,['schema','members','seats','workflows','projects'],'team');if(t.schema!==1)bad('unknown schema');
 if(!plain(t.members)||Object.keys(t.members).length>24)bad('members');for(const[id,m]of Object.entries(t.members)){if(!ID.test(id))bad(`seat id ${id}`);validateMember(m,`member ${id}`);}
 if(!plain(t.seats)||Object.keys(t.seats).length>16)bad('seats');for(const[id,s]of Object.entries(t.seats))validateSeat(s,id);
 for(const id of Object.keys(t.members))if(!(BUILTIN_SEATS as readonly string[]).includes(id)&&!t.seats[id])bad(`member ${id} fills an undeclared seat`);
 if(!plain(t.workflows)||Object.keys(t.workflows).length>200)bad('workflows');
 for(const[w,v]of Object.entries<any>(t.workflows)){if(!ID.test(w))bad(`workflow id ${w}`);onlyKeys(v,['nodes'],`workflow ${w}`);if(!plain(v.nodes)||Object.keys(v.nodes).length>60)bad(`workflow ${w} nodes`);for(const[n,o]of Object.entries(v.nodes)){if(!ID.test(n))bad(`node id ${n}`);validateOverride(o,`${w}/${n}`);}}
 validateProjects(t);
}

// ---------- seats of a workflow ----------
/** The seat a role falls back to when neither the node nor the role names one (a workflow written before seats). */
export function fallbackSeat(def:any,roleId:string|null|undefined):string{
 const r=String(roleId??'');if(r==='coordinator')return'coordinator';if(r==='reviewer'||r==='judge')return'reviewer';if(r==='designer'&&def?.kind==='code')return'design-reviewer';return'maker';}
/** Hook steps that run a model the crew picks: the image adapter (image.generate) runs on a member that can generate images. */
export const IMAGE_HOOKS=new Set(['image.generate']);
export const IMAGE_CAP='image-generation';
/** The seat an image hook falls back to (declared by a workflow like images and coffee-kit; this is its shape when none does). */
export const IMAGE_SEAT:SeatDecl={id:'image-maker',label:'Image maker',labelZh:'圖像產出',needs:[IMAGE_CAP],suggest:{provider:'codex'}};
/** A node the crew staffs: an agent node, a loop that runs agent turns of its own (its coordinator role), or an image hook.
 *  needs: the capability tags its member must have (an image hook: image generation). */
export type Slot={node:string;label:string;kind:string;role:string|null;seat:string;declared:boolean;skills:Pin[];def:{provider?:string;model?:string;effort?:string|null};needs?:string[]};
export function slotsOf(def:any):Slot[]{
 const out:Slot[]=[];
 for(const n of def?.nodes??[]){const hook=n.kind==='hook'&&IMAGE_HOOKS.has(String(n.do??''));if(n.kind!=='agent'&&n.kind!=='loop'&&!hook)continue;const role=nodeRole(def,n)??null;if(n.kind==='loop'&&!role)continue;
  const r=def.roles?.find((x:any)=>x.id===role),declared=typeof n.seat==='string'?n.seat:typeof r?.seat==='string'?r.seat:null;
  const d:Slot['def']={};if(n.provider)d.provider=n.provider;if(n.model)d.model=n.model;if(n.effort)d.effort=n.effort;
  out.push({node:n.id,label:String(n.label??n.id),kind:n.kind,role,seat:declared??(hook?IMAGE_SEAT.id:fallbackSeat(def,role)),declared:!!declared,skills:Array.isArray(n.skills)?n.skills.map((p:any)=>({id:String(p.id),v:Number(p.v),sha256:String(p.sha256)})):[],def:d,...(hook?{needs:[IMAGE_CAP]}:{})});}
 return out;
}
/** A judged check (a model judges a node's work) occupies a reviewing seat too: shown and resolved like a node. */
export type JudgeSlot={node:string;check:string;label:string;seat:string};
export const JUDGE_NODE='judge--';
export const isJudgeRow=(id:string)=>id.startsWith(JUDGE_NODE);
/** The definition with one virtual agent node per judged check, on the seat it judges as (its rows resolve and follow the rules like any node). */
export function withJudges(def:any,judges:JudgeSlot[]){if(!judges.length)return def;return{...def,nodes:[...def.nodes,...judges.map((j,i)=>({id:`${JUDGE_NODE}${j.node}--${i}`,kind:'agent',label:j.label,role:null,seat:j.seat,mode:'judge'}))]};}
/** The specialist seats a workflow declares (def.seats). */
export const declaredSeats=(def:any):SeatDecl[]=>Array.isArray(def?.seats)?def.seats.filter((s:any)=>plain(s)&&typeof s.id==='string'):[];
export const seatLabel=(team:Team|null,id:string,def?:any):{en:string;zh:string}=>{const b=SEAT_LABELS[id];if(b)return b;const s=team?.seats[id]??declaredSeats(def).find(x=>x.id===id);return s?{en:s.label,zh:s.labelZh}:{en:id,zh:id};};
const reviewsOf=(team:Team,seat:string,def?:any)=>BUILTIN_REVIEWS[seat]??team.seats[seat]?.reviews??declaredSeats(def).find(s=>s.id===seat)?.reviews;
const reviewing=(team:Team,seat:string,def?:any)=>BUILTIN_REVIEWING.has(seat)||!!(team.seats[seat]?.reviews??declaredSeats(def).find(s=>s.id===seat)?.reviews);
/** A seat that judges another's work (its effort is medium or more). */
export const reviewingSeat=reviewing;
/** Model capability tags (a fact's model tags win). */
export function capabilitiesOf(provider:string,model:string,facts?:{provider:string;models:{id:string;tags?:string[]}[]}[]):string[]{const m=facts?.find(f=>f.provider===provider)?.models.find(x=>x.id===model);return Array.isArray(m?.tags)?m!.tags!:PROVIDER_CAPS[provider]??[];}

// ---------- resolution ----------
export type Note={en:string;zh:string};
export type Source='team'|'project'|'workflow'|'definition'|'run'|'missing';
export type Resolved={node:string;label:string;kind:string;role:string|null;seat:string;provider:'codex'|'claude'|null;model:string|null;effort:string|null;
 skills:(Pin&{from:'member'|'node'})[];source:Source;fields:{seat:Source;provider:Source;model:Source;effort:Source};custom:boolean;notes:Note[];removed:string[]};
export type Resolution={workflow:string;version:number;team:string|null;project:string|null;nodes:Resolved[];missing:string[];notes:Note[]};
/** The override that applies to a node of this definition: one set while the node had this role and kind (kept across versions). */
export function overrideFor(team:Team|null,def:any,slot:Pick<Slot,'node'|'role'|'kind'>):NodeOverride|null{const o=team?.workflows[def?.id]?.nodes[slot.node];return o&&o.at.role===slot.role&&o.at.kind===slot.kind?o:null;}
/** A run override: effort only, per node, for one Task (the dispatch card). */
export type RunOverride=Record<string,{effort:string|null}>;
export function parseRunOverride(raw:unknown):RunOverride{
 if(raw==null||raw==='')return{};let v:any;try{v=typeof raw==='string'?JSON.parse(raw):raw;}catch{bad('the run override is not JSON');}
 if(!plain(v)||Object.keys(v).length>60)bad('the run override is per node');for(const[n,o]of Object.entries<any>(v)){if(!ID.test(n))bad('run override node');onlyKeys(o,['effort'],`run override ${n}`);if(o.effort!==null&&!EFFORTS.includes(o.effort))bad(`run override ${n}: effort`);}
 return v;}
const keyOf=(p:{provider:string|null;model:string|null})=>`${p.provider}/${p.model}`;
/** Who runs each node of this definition. Pure: the same team, definition, run override and project always give the same answer.
 *  Precedence: run override (effort) > workflow override > the node's definition > project override > team seat. */
export function resolveCrew(team:Team|null,def:any,run:RunOverride={},hash:string|null=null,project:string|null=null):Resolution{
 const slots=slotsOf(def),missing=new Set<string>(),notes:Note[]=[],projectSkills=new Set<string>();
 const memberOf=(seat:string)=>projectMember(team,project,seat)?.member;
 const rows:Resolved[]=slots.map(s=>{
  const o=overrideFor(team,def,s),hookNotes:Note[]=[];let seat=o?.seat??s.seat,pm=projectMember(team,project,seat);
  // a slot that needs a capability (an image hook) runs on a member that has it: its seat's, else the image maker's (said in a note);
  // with neither, the image-maker seat is missing. A model written on the node or its workflow override is taken as is.
  if(s.needs?.length&&!(s.def.provider&&s.def.model)&&!(o?.provider&&o?.model)){const can=(p:typeof pm)=>!!p&&s.needs!.every(t=>capabilitiesOf(p.member.provider,p.member.model).includes(t));
   if(!can(pm)){const img=projectMember(team,project,IMAGE_SEAT.id);
    if(pm&&can(img)){const me=seatLabel(team,seat,def);hookNotes.push({en:`${me.en} (${pm.member.provider} ${pm.member.model}) cannot generate images; ${s.label} runs as the image maker (${img!.member.provider} ${img!.member.model}).`,zh:`${me.zh}（${pm.member.provider} ${pm.member.model}）不能產生圖片；${s.label}改由圖像產出（${img!.member.provider} ${img!.member.model}）來做。`});}
    seat=IMAGE_SEAT.id;pm=can(img)?img:null;}}
  const m=pm?.member;
  const from=(k:'provider'|'model'|'effort'):Source=>pm?.from.has(k)?'project':'team';if(pm?.from.has('skills'))projectSkills.add(s.node);
  const f:Resolved['fields']={seat:o?.seat?'workflow':'team',provider:from('provider'),model:from('model'),effort:from('effort')};
  let provider:Resolved['provider']=m?.provider??null,model=m?.model??null,effort:string|null=m?m.effort:null;
  if(s.def.provider){provider=s.def.provider as any;f.provider='definition';}if(s.def.model){model=s.def.model;f.model='definition';}if(s.def.effort!==undefined){effort=s.def.effort;f.effort='definition';}
  if(o?.provider){provider=o.provider;f.provider='workflow';}if(o?.model){model=o.model;f.model='workflow';}if(o&&Object.hasOwn(o,'effort')){effort=o.effort??null;f.effort='workflow';}
  if(!m&&!(provider&&model)){missing.add(seat);for(const k of ['provider','model','effort'] as const)if(f[k]==='team')f[k]='missing';}
  if(Object.hasOwn(run,s.node)&&m){effort=run[s.node].effort;f.effort='run';}
  const removed=(o?.remove??[]).filter(id=>s.skills.some(p=>p.id===id));
  const member=(m?.skills??[]).map(p=>({...p,from:'member' as const}));
  const nodeSkills=[...s.skills.filter(p=>!removed.includes(p.id)),...(o?.add??[])].filter((p,i,a)=>a.findIndex(q=>q.id===p.id)===i&&!member.some(q=>q.id===p.id)).map(p=>({...p,from:'node' as const}));
  return{node:s.node,label:s.label,kind:s.kind,role:s.role,seat,provider,model,effort,skills:[...member,...nodeSkills],source:'team',fields:f,custom:false,notes:hookNotes,removed};});
 // the rules: never silent. A reviewing seat (and alt-maker) does not run on the model of the seat it reviews; a reviewing seat thinks at medium or more.
 if(team)for(const r of rows){if(!r.provider||!r.model)continue;const target=reviewsOf(team,r.seat,def);if(!target)continue;
  const theirs=new Set(rows.filter(x=>x.seat===target&&x.provider&&x.model).map(keyOf));if(!theirs.size&&memberOf(target))theirs.add(keyOf(memberOf(target)!));
  if(!theirs.has(keyOf(r)))continue;
  // the replacement is another member's model, never an image seat's (an image model cannot review or make text)
  const alt=[...BUILTIN_SEATS,...Object.keys(team.seats).filter(id=>id!==IMAGE_SEAT.id&&!team.seats[id].needs?.includes(IMAGE_CAP))].map(id=>memberOf(id)).find(x=>x&&!theirs.has(keyOf(x)));
  const who=seatLabel(team,target,def),me=seatLabel(team,r.seat,def);
  if(alt){const was=`${r.provider} ${r.model}`;r.provider=alt.provider;r.model=alt.model;if(r.effort===null&&alt.provider==='codex')r.effort=alt.effort;r.fields.provider=r.fields.model='team';
   const why=reviewing(team,r.seat,def)?{en:'so the check is a second opinion',zh:'才是第二意見'}:{en:'so the two versions differ',zh:'兩個版本才會不一樣'};
   r.notes.push({en:`${me.en} would use ${was}, the same model as ${who.en}; it runs on ${alt.provider} ${alt.model} instead, ${why.en}.`,zh:`${me.zh}原本會用 ${was}，跟${who.zh}同一個模型；改用 ${alt.provider} ${alt.model}，${why.zh}。`});}
  else r.notes.push({en:`${me.en} uses the same model as ${who.en} (${r.provider} ${r.model}) because the team has no other model: a fresh context, not an independent opinion.`,zh:`${me.zh}跟${who.zh}用同一個模型（${r.provider} ${r.model}），因為團隊沒有別的模型：是新的脈絡，不是獨立意見。`});}
 if(team)for(const r of rows){if(!reviewing(team,r.seat,def)||r.effort===null||!r.provider)continue;if(EFFORTS.indexOf(r.effort)>=EFFORTS.indexOf('medium'))continue;const me=seatLabel(team,r.seat,def);
  r.notes.push({en:`${me.en} judges work, so it thinks at medium effort, not ${r.effort}.`,zh:`${me.zh}要審別人的成果，effort 至少 medium，不用 ${r.effort}。`});r.effort='medium';}
 for(const r of rows){const vals=Object.values(r.fields);r.source=vals.includes('missing')?'missing':vals.includes('run')?'run':vals.includes('workflow')||r.removed.length||r.skills.some(p=>p.from==='node'&&!slots.find(s=>s.node===r.node)!.skills.some(q=>q.id===p.id))?'workflow':vals.includes('definition')?'definition':vals.includes('project')||projectSkills.has(r.node)?'project':'team';
  r.custom=r.source==='workflow'||r.source==='run'||r.source==='project';notes.push(...r.notes);}
 return{workflow:def?.id,version:Number(def?.version),team:hash,project,nodes:rows,missing:[...missing],notes};
}
/** A badge for a workflow card: missing seats first, then the number of custom nodes. */
export function crewBadge(res:Resolution):{state:'missing'|'custom'|'team';count:number}{if(res.missing.length)return{state:'missing',count:res.missing.length};const c=res.nodes.filter(n=>n.custom).length;return c?{state:'custom',count:c}:{state:'team',count:0};}

// ---------- changes ----------
/** A change to the team. member: the whole seat (every node that follows the team); node: only this workflow's node;
 *  restore: drop a workflow's (or one node's) overrides; seat: declare and fill a specialist seat; preset: every member's effort. */
export type CrewChange=
 |{kind:'member';seat:string;set:{provider?:'codex'|'claude';model?:string;effort?:string|null;skills?:Pin[]}}
 |{kind:'node';workflow:string;node:string;set:{seat?:string;provider?:'codex'|'claude';model?:string;effort?:string|null};addSkill?:Pin;removeSkill?:string}
 |{kind:'restore';workflow:string;node?:string}
 |{kind:'project';project:string;seat:string;set:{provider?:'codex'|'claude';model?:string;effort?:string|null;skills?:Pin[]}}
 |{kind:'project-restore';project:string;seat?:string}
 |{kind:'seat';seat:SeatDecl;member:Member}
 |{kind:'preset';preset:'save'|'balanced'|'quality'};
export const PRESETS:Record<string,{en:string;zh:string;effort:Record<string,string>}>={
 save:{en:'Economy',zh:'省錢',effort:{coordinator:'low',maker:'low','alt-maker':'low',reviewer:'medium','design-reviewer':'medium'}},
 balanced:{en:'Balanced',zh:'均衡',effort:{coordinator:'medium',maker:'medium','alt-maker':'medium',reviewer:'medium','design-reviewer':'medium'}},
 quality:{en:'Quality',zh:'品質',effort:{coordinator:'high',maker:'high','alt-maker':'high',reviewer:'high','design-reviewer':'high'}}};
export function validateChange(c:any):asserts c is CrewChange{
 if(!plain(c))bad('a change is an object');
 if(c.kind==='member'){onlyKeys(c,['kind','seat','set'],'change');if(!ID.test(c.seat))bad('change seat');onlyKeys(c.set,['provider','model','effort','skills'],'change set');if(!Object.keys(c.set).length)bad('a member change sets something');if(c.set.skills!==undefined)validatePins(c.set.skills,'member skills');return;}
 if(c.kind==='node'){onlyKeys(c,['kind','workflow','node','set','addSkill','removeSkill'],'change');if(!ID.test(c.workflow)||!ID.test(c.node))bad('change node');onlyKeys(c.set??{},['seat','provider','model','effort'],'change set');if(c.addSkill!==undefined)validatePins([c.addSkill],'added skill');if(c.removeSkill!==undefined&&!ID.test(c.removeSkill))bad('removed skill');if(!Object.keys(c.set??{}).length&&!c.addSkill&&!c.removeSkill)bad('a node change sets something');return;}
 if(c.kind==='restore'){onlyKeys(c,['kind','workflow','node'],'change');if(!ID.test(c.workflow)||c.node!==undefined&&!ID.test(c.node))bad('restore target');return;}
 if(c.kind==='project'){onlyKeys(c,['kind','project','seat','set'],'change');if(!PROJECT.test(String(c.project))||!ID.test(c.seat))bad('change project seat');onlyKeys(c.set,['provider','model','effort','skills'],'change set');if(!Object.keys(c.set).length)bad('a project change sets something');if(c.set.skills!==undefined)validatePins(c.set.skills,'project skills');return;}
 if(c.kind==='project-restore'){onlyKeys(c,['kind','project','seat'],'change');if(!PROJECT.test(String(c.project))||c.seat!==undefined&&!ID.test(c.seat))bad('restore project target');return;}
 if(c.kind==='seat'){onlyKeys(c,['kind','seat','member'],'change');validateSeat(c.seat,c.seat?.id);validateMember(c.member,'seat member');return;}
 if(c.kind==='preset'){onlyKeys(c,['kind','preset'],'change');if(!Object.hasOwn(PRESETS,c.preset))bad('preset');return;}
 bad('unknown change');
}
/** The team after a change (the input is never modified). def: the workflow a node change is for (its current version). */
export function applyChange(team:Team,c:CrewChange,def?:any):Team{
 validateChange(c);const t:Team=structuredClone(team);
 if(c.kind==='member'){const m=t.members[c.seat];if(!m&&!(c.set.provider&&c.set.model))bad(`seat ${c.seat} has no member yet: choose its provider and model`);
  if(!(BUILTIN_SEATS as readonly string[]).includes(c.seat)&&!t.seats[c.seat])bad(`seat ${c.seat} is not declared`);
  const next:Member={provider:c.set.provider??m!.provider,model:c.set.model??m!.model,effort:Object.hasOwn(c.set,'effort')?c.set.effort??null:m?m.effort:null,skills:c.set.skills??m?.skills??[]};
  if(next.provider==='codex'&&next.effort===null)next.effort='medium';t.members[c.seat]=next;}
 else if(c.kind==='node'){const slot=slotsOf(def).find(s=>s.node===c.node);if(!def||def.id!==c.workflow||!slot)bad(`${c.workflow} has no agent node ${c.node}`);
  const cur:NodeOverride=structuredClone(overrideFor(t,def,slot)??{at:{role:slot.role,kind:slot.kind}});
  for(const k of ['seat','provider','model'] as const)if(c.set[k]!==undefined)(cur as any)[k]=c.set[k];if(Object.hasOwn(c.set,'effort'))cur.effort=c.set.effort??null;
  // back to what the team says is no override at all
  if(cur.seat===slot.seat)delete cur.seat;
  if(c.addSkill){if(slot.skills.some(p=>p.id===c.addSkill!.id)&&(cur.remove??[]).includes(c.addSkill.id))cur.remove=cur.remove!.filter(x=>x!==c.addSkill!.id);else if(!slot.skills.some(p=>p.id===c.addSkill!.id))cur.add=[...(cur.add??[]).filter(p=>p.id!==c.addSkill!.id),c.addSkill];}
  if(c.removeSkill){if((cur.add??[]).some(p=>p.id===c.removeSkill))cur.add=cur.add!.filter(p=>p.id!==c.removeSkill);else if(slot.skills.some(p=>p.id===c.removeSkill))cur.remove=[...new Set([...(cur.remove??[]),c.removeSkill])];else bad(`${c.node} has no skill ${c.removeSkill} of its own (a member's skills are changed on the member)`);}
  if(cur.add&&!cur.add.length)delete cur.add;if(cur.remove&&!cur.remove.length)delete cur.remove;
  const w=t.workflows[c.workflow]??{nodes:{}};if(Object.keys(cur).length>1)w.nodes[c.node]=cur;else delete w.nodes[c.node];
  if(Object.keys(w.nodes).length)t.workflows[c.workflow]=w;else delete t.workflows[c.workflow];}
 else if(c.kind==='restore'){const w=t.workflows[c.workflow];if(w){if(c.node)delete w.nodes[c.node];else w.nodes={};if(!Object.keys(w.nodes).length)delete t.workflows[c.workflow];}}
 else if(c.kind==='project'){const base=t.members[c.seat];if(!base)bad(`seat ${c.seat} has no team member yet: fill it for the whole team first`);
  const projects=t.projects??{},p=projects[c.project]??{seats:{}},cur:ProjectSeat=structuredClone(p.seats[c.seat]??{});
  for(const k of ['provider','model'] as const)if(c.set[k]!==undefined)(cur as any)[k]=c.set[k];if(Object.hasOwn(c.set,'effort'))cur.effort=c.set.effort??null;if(c.set.skills!==undefined)cur.skills=structuredClone(c.set.skills);
  // a Codex model needs an effort: a project that moves a seat to Codex without one runs it at medium
  if((cur.provider??base.provider)==='codex'&&(Object.hasOwn(cur,'effort')?cur.effort:base.effort)===null)cur.effort='medium';
  // back to what the team says is no override at all
  if((cur.provider??base.provider)===base.provider&&(cur.model??base.model)===base.model){delete cur.provider;delete cur.model;}
  if(Object.hasOwn(cur,'effort')&&cur.effort===base.effort)delete cur.effort;if(cur.skills&&JSON.stringify(cur.skills)===JSON.stringify(base.skills))delete cur.skills;
  if(Object.keys(cur).length)p.seats[c.seat]=cur;else delete p.seats[c.seat];
  if(Object.keys(p.seats).length)projects[c.project]=p;else delete projects[c.project];
  if(Object.keys(projects).length)t.projects=projects;else delete t.projects;}
 else if(c.kind==='project-restore'){const p=t.projects?.[c.project];if(p){if(c.seat)delete p.seats[c.seat];else p.seats={};if(!Object.keys(p.seats).length)delete t.projects![c.project];if(!Object.keys(t.projects!).length)delete t.projects;}}
 else if(c.kind==='seat'){t.seats[c.seat.id]=structuredClone(c.seat);t.members[c.seat.id]=structuredClone(c.member);}
 else if(c.kind==='preset'){for(const[id,m]of Object.entries(t.members)){const e=PRESETS[c.preset].effort[id]??PRESETS[c.preset].effort.maker;m.effort=e;}}
 validateTeam(t);return t;
}
/** What a change does to every workflow: the nodes whose provider, model, effort or skills change (the scope question's N). */
export function changeImpact(before:Team,after:Team,defs:any[],project:string|null=null):{workflow:string;node:string;label:string;before:string;after:string}[]{
 const out:{workflow:string;node:string;label:string;before:string;after:string}[]=[];const line=(r:Resolved)=>`${r.provider??'—'} ${r.model??'—'} · ${r.effort??'default'} · ${r.skills.map(p=>`${p.id}@v${p.v}`).join(', ')||'no skills'}`;
 for(const def of defs){const a=resolveCrew(before,def,{},null,project),b=resolveCrew(after,def,{},null,project);for(const r of b.nodes){const was=a.nodes.find(x=>x.node===r.node);if(!was||line(was)!==line(r)||was.seat!==r.seat)out.push({workflow:def.id,node:r.node,label:r.label,before:was?line(was):'—',after:line(r)});}}
 return out;
}
/** The nodes of other workflows a member change reaches: those that follow the team for that field. */
export function seatUses(team:Team,seat:string,defs:any[],field?:'model'|'effort',project:string|null=null):{workflow:string;node:string}[]{return defs.flatMap(def=>resolveCrew(team,def,{},null,project).nodes.filter(r=>r.seat===seat&&(!field||r.fields[field]==='team'&&(field!=='model'||r.fields.provider==='team'))).map(r=>({workflow:def.id,node:r.node})));}
/** The nodes a project change of this seat reaches in that project ("only this project", per field like the member's count):
 *  those that follow the seat for that field, whether the team or the project set it. */
export function projectUses(team:Team,seat:string,defs:any[],project:string,field?:'model'|'effort'):{workflow:string;node:string}[]{const follows=(s:Source)=>s==='team'||s==='project';return defs.flatMap(def=>resolveCrew(team,def,{},null,project).nodes.filter(r=>r.seat===seat&&(!field||follows(r.fields[field])&&(field!=='model'||follows(r.fields.provider)))).map(r=>({workflow:def.id,node:r.node})));}
/** The projects whose crew differs from the team, and on which seats (Firstmate's read of the project layer). */
export const projectLayer=(team:Team)=>Object.entries(team.projects??{}).map(([id,p])=>({project:id,seats:Object.fromEntries(Object.entries(p.seats).map(([seat,o])=>[seat,{...o,...(o.skills?{skills:o.skills.map(s=>`${s.id}@v${s.v}`)}:{})}]))}));

// ---------- the store ----------
export class CrewStore{
 readonly dir:string;
 constructor(readonly dataDir:string){this.dir=join(dataDir,'crew');}
 private sign(h:string){return createHmac('sha256',ledgerKey(this.dataDir)).update(h).digest('hex');}
 private safe(){mkdirSync(this.dir,{recursive:true,mode:0o700});if(lstatSync(this.dir).isSymbolicLink())bad('crew folder is a symlink');}
 exists(){return existsSync(join(this.dir,'current.json'));}
 private verify(c:any):TeamConfig{
  onlyKeys(c,['schema','members','seats','workflows','projects','version','previous','approval','hash','signature'],'team version');const{version,previous,approval,hash,signature,...team}=c;validateTeam(team);
  if(!Number.isSafeInteger(version)||version<1||previous!==null&&!/^[a-f0-9]{64}$/.test(previous))bad('version chain');onlyKeys(approval,['by','via','card','run','answerSeq'],'approval');
  const expected=this.sign(hash);if(staffingHash({...team,version,previous,approval})!==hash||typeof signature!=='string'||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))bad('the team version does not verify');
  return c as TeamConfig;}
 /** The current team, verified; null when none was ever written. A team that does not verify is an error, never "no team". */
 current():TeamConfig|null{
  const p=join(this.dir,'current.json');if(!existsSync(p))return null;const ptr=JSON.parse(readFileSync(p,'utf8'));onlyKeys(ptr,['schema','version','hash','signature'],'team pointer');
  if(ptr.signature!==this.sign(staffingHash({crew:true,version:ptr.version,hash:ptr.hash}))||readdirSync(this.dir).some(f=>/^v[1-9][0-9]*\.json$/.test(f)&&Number(f.slice(1,-5))>ptr.version))bad('the team pointer changed or was rolled back');
  const c=this.verify(JSON.parse(readFileSync(join(this.dir,`v${ptr.version}.json`),'utf8')));if(c.hash!==ptr.hash||c.version!==ptr.version)bad('the team pointer and version differ');return c;}
 /** An earlier team version by hash (a Task or staffing version derived from it), verified; null when none matches. */
 byHash(hash:string):TeamConfig|null{if(!/^[a-f0-9]{64}$/.test(hash)||!existsSync(this.dir))return null;for(const f of readdirSync(this.dir).filter(f=>/^v[1-9][0-9]*\.json$/.test(f))){let c:any;try{c=JSON.parse(readFileSync(join(this.dir,f),'utf8'));}catch{continue;}if(c?.hash===hash)return this.verify(c);}return null;}
 /** Write the next version: only when the current one is still `expected` (compare-and-swap). */
 write(team:Team,expected:string|null,approval:TeamApproval):TeamConfig{
  validateTeam(team);if(!/^(captain\b|migration$)/i.test(approval.by))bad('only the captain changes the team');this.safe();const lock=join(this.dir,'.lock');mkdirSync(lock,{mode:0o700});
  try{const prev=this.current();if((prev?.hash??null)!==expected)bad('the team changed since you looked; reload and choose again');
   const body={...structuredClone(team),version:(prev?.version??0)+1,previous:expected,approval:structuredClone(approval)};const hash=staffingHash(body),c={...body,hash,signature:this.sign(hash)};
   writeFileSync(join(this.dir,`v${c.version}.json`),JSON.stringify(c),{flag:'wx',mode:0o600});const tmp=join(this.dir,'current.json.tmp');
   writeFileSync(tmp,JSON.stringify({schema:1,version:c.version,hash,signature:this.sign(staffingHash({crew:true,version:c.version,hash}))}),{flag:'wx',mode:0o600});renameSync(tmp,join(this.dir,'current.json'));return structuredClone(c);}
  finally{rmSync(lock,{recursive:true});}}
}
/** A team config's body (without the version record): what resolution reads. */
export const teamBody=(c:TeamConfig|Team):Team=>({schema:1,members:c.members,seats:c.seats,workflows:c.workflows,...(c.projects?{projects:c.projects}:{})});
