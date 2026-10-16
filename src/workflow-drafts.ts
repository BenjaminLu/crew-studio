// Free first-workflow drafting. Firstmate interviews the captain in chat, then calls
// studio_draft_workflow with the graph its model produced; the page previews it live.
// Drafting and saving never start a Task, never write staffing and never call a paid engine:
// execution stays behind Run, which asks the captain to confirm each agent node's staffing.
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {NativeToolFailure,type NativeMainTools} from './host/types';
import {normalize,validate,type WDef,type WNode,type WorkflowDefs} from './runtime/defs';
import {withLock} from './ids';

/** Role skills a drafted or inline-edited node may use: bundled text only, never a file path. */
export const DRAFT_SKILLS:Record<string,{en:string;zh:string}>={
 'bundled:workflows/skills/v2/writer.md':{en:'Writer',zh:'撰稿'},
 'bundled:workflows/skills/v2/designer.md':{en:'Designer',zh:'設計'},
};
export const DRAFT_PROVIDERS=['codex','claude'] as const;
export const DRAFT_EFFORTS=['minimal','low','medium','high','xhigh'] as const;
const DRAFT_MODES=new Set(['deliver']);
const FORMATS=new Set(['document','web']);
const MODEL=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const plain=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const bounded=(v:any,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const stable=(v:any):string=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const sha=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');

export type DraftRecord={schema:1;id:string;revision:number;goal:string;interview:{question:string;answer:string}[];def:WDef;
 provenance:{source:'model';via:'studio_draft_workflow';turn:string;edited:boolean};createdAt:string;updatedAt:string;saved:{workflow:string;version:number}|null};

class DraftError extends Error{constructor(msg:string,readonly status=400,readonly problems?:unknown){super(msg);}}

/** A node's model choices: provider, model, effort and role skill. Throws on anything outside the closed sets. */
export function checkNodeStaffing(n:any,label=n?.id){
 if(n.provider!==undefined&&!(DRAFT_PROVIDERS as readonly string[]).includes(n.provider))throw new DraftError(`${label}: provider must be codex or claude`);
 if(n.model!==undefined&&!(typeof n.model==='string'&&MODEL.test(n.model)))throw new DraftError(`${label}: model must be a short model id`);
 if(n.effort!==undefined&&!(DRAFT_EFFORTS as readonly string[]).includes(n.effort))throw new DraftError(`${label}: effort must be one of ${DRAFT_EFFORTS.join(', ')}`);
 if(n.skill!==undefined&&!Object.hasOwn(DRAFT_SKILLS,n.skill))throw new DraftError(`${label}: skill must be a bundled Studio role skill`);
 if(n.kind!=='agent'&&['provider','model','effort','skill'].some(k=>n[k]!==undefined))throw new DraftError(`${label}: only agent nodes have a provider, model, effort or skill`);
}

/** The model's graph, restricted to a drafting vocabulary that can never name a privileged action. */
function draftDefinition(raw:any,defs:WorkflowDefs):WDef{
 if(!plain(raw))throw new DraftError('workflow must be an object');
 for(const k of Object.keys(raw))if(!['name','description','roles','nodes','edges'].includes(k))throw new DraftError(`workflow.${k} is not part of a draft`);
 if(!bounded(raw.name,120))throw new DraftError('workflow.name: 1–120 characters');
 if(raw.description!==undefined&&!(typeof raw.description==='string'&&raw.description.length<=500))throw new DraftError('workflow.description: up to 500 characters');
 if(!Array.isArray(raw.roles)||raw.roles.length>6)throw new DraftError('workflow.roles: up to 6 roles');
 if(!Array.isArray(raw.nodes)||!raw.nodes.length||raw.nodes.length>24)throw new DraftError('workflow.nodes: 1–24 nodes');
 if(!Array.isArray(raw.edges)||raw.edges.length>48)throw new DraftError('workflow.edges: up to 48 edges');
 const roles=raw.roles.map((r:any)=>{if(!plain(r)||Object.keys(r).some(k=>!['id','label','skill'].includes(k))||!/^[a-z][a-z0-9-]{0,39}$/.test(r.id)||!bounded(r.label,60)||!Object.hasOwn(DRAFT_SKILLS,r.skill))throw new DraftError(`role ${r?.id}: id, label and a bundled Studio role skill only`);return{id:r.id,label:r.label,skill:r.skill};});
 const nodes=raw.nodes.map((n:any,i:number)=>{
  if(!plain(n))throw new DraftError('each node is an object');
  for(const k of Object.keys(n))if(!['id','kind','label','detail','role','mode','args','card','provider','model','effort','skill','x','y'].includes(k))throw new DraftError(`node ${n.id}: ${k} is not part of a draft`);
  if(!['agent','card','hook'].includes(n.kind))throw new DraftError(`node ${n.id}: a draft uses agent, card or hook nodes`);
  if(!bounded(n.label,80)||n.detail!==undefined&&!(typeof n.detail==='string'&&n.detail.length<=500))throw new DraftError(`node ${n.id}: label 1–80 characters`);
  const out:any={id:String(n.id),kind:n.kind,label:n.label,...(n.detail?{detail:n.detail}:{}),x:Number.isFinite(n.x)?n.x:0,y:Number.isFinite(n.y)?n.y:0,_i:i};
  if(n.kind==='agent'){
   if(!DRAFT_MODES.has(n.mode))throw new DraftError(`node ${n.id}: agent nodes draft in deliver mode only`);
   if(!plain(n.args)||Object.keys(n.args).some(k=>!['format','variant'].includes(k))||!FORMATS.has(n.args.format)||n.args.variant!==undefined&&!/^[A-Z]$/.test(n.args.variant))throw new DraftError(`node ${n.id}: args are format (document or web) and an optional variant letter`);
   Object.assign(out,{role:n.role,mode:n.mode,args:{...n.args}});
   for(const k of ['provider','model','effort','skill'])if(n[k]!==undefined)out[k]=n[k];
  }else if(['role','mode','args','provider','model','effort','skill'].some(k=>n[k]!==undefined))throw new DraftError(`node ${n.id}: only agent nodes have a role, mode, args or staffing`);
  if(n.kind==='card'){
   const c=n.card;const text=(v:any)=>v===undefined||typeof v==='string'&&v.length<=300||plain(v)&&Object.keys(v).every(k=>['en','zh-TW'].includes(k)&&typeof v[k]==='string'&&v[k].length<=300);
   if(!plain(c)||Object.keys(c).some(k=>!['title','body','options'].includes(k))||!text(c.title)||!text(c.body)||!Array.isArray(c.options)||!c.options.length||c.options.length>4||c.options.some((o:any)=>!plain(o)||Object.keys(o).some(k=>!['id','label'].includes(k))||!/^[a-z][a-z0-9-]{0,30}$/.test(o.id)||!bounded(o.label,40)))throw new DraftError(`node ${n.id}: a card has a title, body and 1–4 options {id,label}`);
   out.card={...(c.title?{title:c.title}:{}),...(c.body?{body:c.body}:{}),options:c.options.map((o:any)=>({id:o.id,label:o.label}))};
  }
  if(n.kind==='hook'&&n.card!==undefined)throw new DraftError(`node ${n.id}: a hook ends the draft and takes no card`);
  if(n.kind==='agent'&&n.card!==undefined)throw new DraftError(`node ${n.id}: only card nodes have a card`);
  checkNodeStaffing(out,`node ${n.id}`);
  return out;
 });
 const edges=raw.edges.map((e:any)=>{if(!plain(e)||Object.keys(e).some(k=>!['from','to','when'].includes(k))||typeof e.from!=='string'||typeof e.to!=='string'||e.when!==undefined&&!/^[a-z][a-z0-9-]{0,30}$/.test(e.when))throw new DraftError('each edge is {from,to,when?}');return{from:e.from,to:e.to,...(e.when?{when:e.when}:{})};});
 const def=normalize({id:'draft',name:raw.name.trim(),version:1,...(raw.description?{description:raw.description}:{}),roles,nodes,edges});
 layout(def);for(const n of def.nodes)delete (n as any)._i;
 const errors=validate(def,defs.known,defs.runners?.(),defs.skillInfo??undefined).filter(p=>p.level==='error');
 if(errors.length)throw new DraftError(`the drafted graph has ${errors.length} problem(s): ${errors.map(p=>p.text).join('; ')}`,400,errors);
 return def;
}
/** Left-to-right layers by first reach from the entry, so a model graph never needs coordinates. */
function layout(def:WDef){
 if(def.nodes.every(n=>n.x||n.y))return;
 const ins=new Set(def.edges.map(e=>e.to)),entry=def.nodes.find(n=>!ins.has(n.id));const depth=new Map<string,number>();if(entry){depth.set(entry.id,0);const q=[entry.id];while(q.length){const id=q.shift()!;for(const e of def.edges.filter(e=>e.from===id))if(!depth.has(e.to)){depth.set(e.to,depth.get(id)!+1);q.push(e.to);}}}
 const rows=new Map<number,number>();for(const n of def.nodes){const d=depth.get(n.id)??0,r=rows.get(d)??0;rows.set(d,r+1);n.x=80+d*220;n.y=100+r*120;}
}

export class WorkflowDrafts{
 readonly dir:string;
 constructor(readonly dataDir:string,readonly defs:WorkflowDefs,readonly notify:(id:string,revision:number)=>void=()=>{}){this.dir=join(dataDir,'workflow-drafts');mkdirSync(this.dir,{recursive:true});}
 private file(id:string){if(!/^d-[a-f0-9]{12}$/.test(id))throw new DraftError('no such draft',404);return join(this.dir,id+'.json');}
 get(id:string):DraftRecord{const f=this.file(id);if(!existsSync(f))throw new DraftError('no such draft',404);return JSON.parse(readFileSync(f,'utf8'));}
 list(){return readdirSync(this.dir).filter(f=>/^d-[a-f0-9]{12}\.json$/.test(f)).map(f=>{try{return JSON.parse(readFileSync(join(this.dir,f),'utf8')) as DraftRecord;}catch{return null;}}).filter(Boolean).sort((a:any,b:any)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,50).map((d:any)=>({id:d.id,revision:d.revision,goal:d.goal,name:d.def.name,nodes:d.def.nodes.length,source:d.provenance.source,saved:d.saved,updatedAt:d.updatedAt}));}
 private write(d:DraftRecord){const f=this.file(d.id);writeFileSync(f+'.tmp',JSON.stringify(d,null,1));renameSync(f+'.tmp',f);this.notify(d.id,d.revision);return d;}
 /** Only the native tool reaches this: the graph is the Firstmate model's own output for this captain turn. */
 draft(args:any,turn:string):DraftRecord{
  if(!plain(args)||Object.keys(args).some(k=>!['goal','interview','workflow','draft'].includes(k)))throw new DraftError('use goal, interview, workflow and optionally draft (to revise)');
  if(!bounded(args.goal,500))throw new DraftError('goal: 1–500 characters');
  const interview=args.interview??[];if(!Array.isArray(interview)||interview.length>8||interview.some((q:any)=>!plain(q)||Object.keys(q).some(k=>!['question','answer'].includes(k))||!bounded(q.question,300)||!bounded(q.answer,500)))throw new DraftError('interview: up to 8 {question, answer} pairs');
  const def=draftDefinition(args.workflow,this.defs),now=new Date().toISOString();
  return withLock(this.dir,'draft',()=>{
   if(args.draft!==undefined){const prev=this.get(String(args.draft));if(prev.saved)throw new DraftError('this draft is already saved; edit the saved workflow instead',409);return this.write({...prev,revision:prev.revision+1,goal:args.goal,interview,def,provenance:{source:'model',via:'studio_draft_workflow',turn,edited:false},updatedAt:now});}
   const id='d-'+randomBytes(6).toString('hex');
   return this.write({schema:1,id,revision:1,goal:args.goal,interview,def,provenance:{source:'model',via:'studio_draft_workflow',turn,edited:false},createdAt:now,updatedAt:now,saved:null});
  });
 }
 /** The captain's inline choice for one agent node: provider, model, effort, skill. Empty string clears a field. */
 editNode(id:string,node:string,body:any):DraftRecord{
  if(!plain(body)||Object.keys(body).some(k=>!['revision','provider','model','effort','skill'].includes(k))||!Number.isSafeInteger(body.revision))throw new DraftError('send revision plus provider, model, effort or skill');
  return withLock(this.dir,'draft',()=>{
   const d=this.get(id);if(d.saved)throw new DraftError('this draft is saved; edit the workflow in the editor',409);if(d.revision!==body.revision)throw new DraftError(`the draft is at revision ${d.revision}; reload before editing`,409);
   const n=d.def.nodes.find(x=>x.id===node);if(!n)throw new DraftError('no such node',404);
   const next:any={...n};for(const k of ['provider','model','effort','skill'])if(body[k]!==undefined){if(body[k]==='')delete next[k];else next[k]=body[k];}
   if(n.kind!=='agent')throw new DraftError('only agent nodes have model settings');checkNodeStaffing(next,node);
   return this.write({...d,revision:d.revision+1,def:{...d.def,nodes:d.def.nodes.map(x=>x.id===node?next:x)},provenance:{...d.provenance,edited:true},updatedAt:new Date().toISOString()});
  });
 }
 /** Save as the captain's own workflow v1. Idempotent per draft: a retry after a lost response finds the same workflow. */
 save(id:string,by:string){
  return withLock(this.dir,'save-'+id,()=>{
   const d=this.get(id);
   const existing=d.saved?.workflow??this.defs.ids().find(w=>(this.defs.versions(w)[0] as any)?.origin?.draft===id);
   if(existing){const def=this.defs.get(existing)!;if(!d.saved)this.write({...d,saved:{workflow:existing,version:1}});return{workflow:existing,version:def.version,href:`#/workflows/${existing}`,created:false};}
   const slug=d.def.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,28)||'my-workflow';
   const wid=(/^[a-z0-9]/.test(slug)?slug:'my-'+slug)+'-'+id.slice(2,8);
   const def=this.defs.createDrafted(wid,d.def,by,{schema:1,source:'firstmate-draft',draft:id,revision:d.revision,definition:sha(d.def)});
   this.write({...d,saved:{workflow:def.id,version:def.version}});
   return{workflow:def.id,version:def.version,href:`#/workflows/${def.id}`,created:true};
  });
 }
}

/** The plan a Run of the captain's own workflow needs confirmed: one row per agent node. */
export function ownStaffingPlan(def:WDef){
 const plan=def.nodes.filter(n=>n.kind==='agent').map((n:WNode)=>{const role=def.roles.find(r=>r.id===n.role);return{node:n.id,label:n.label,role:n.role??null,provider:n.provider??null,model:n.model??null,effort:(n as any).effort??null,skill:n.skill??role?.skill??null};});
 const missing=plan.filter(p=>!p.provider||!p.model||p.provider==='codex'&&!p.effort).map(p=>p.node);
 return{plan,missing,hash:sha({workflow:def.id,version:def.version,plan})};
}
/** Only the captain's own workflows (a draft or the free starter) take the Run-time staffing gate. */
export const ownWorkflow=(def:any)=>plain(def?.origin)&&['firstmate-draft','starter'].includes(def.origin.source);

export function installWorkflowDraftTools(drafts:WorkflowDrafts):NativeMainTools{
 const fail=(e:any):never=>{if(e instanceof NativeToolFailure)throw e;if(e instanceof DraftError)throw new NativeToolFailure(e.status===404?'draft_missing':'draft_invalid',`Draft refused: ${e.message}. Fix the graph and call studio_draft_workflow again.`,`草稿未通過：${e.message}。請修正流程圖後再呼叫 studio_draft_workflow。`,'read_current_state');throw new NativeToolFailure('draft_invalid','Draft refused. Read the draft and try again.','草稿未通過，請讀取草稿後再試。','read_current_state');};
 return{specs:[
  {type:'function',name:'studio_draft_workflow',description:'FREE drafting, no execution: after a short interview (goal, who does the work, who reviews, when the captain decides), submit the graph you designed for the captain\'s own workflow. Nodes: agent (mode deliver, args.format document|web, optional provider codex|claude, model, effort, skill), card (captain decision with options), hook (end). Role skills: '+Object.keys(DRAFT_SKILLS).join(', ')+'. The page previews it live, labeled as model output. Never starts a Task or staffing; never use studio_propose_work for drafting. Pass draft to revise an unsaved draft.',inputSchema:{type:'object',properties:{goal:{type:'string'},interview:{type:'array',items:{type:'object',properties:{question:{type:'string'},answer:{type:'string'}},required:['question','answer'],additionalProperties:false}},workflow:{type:'object'},draft:{type:'string'}},required:['goal','workflow'],additionalProperties:false}},
  {type:'function',name:'studio_save_workflow_draft',description:'Save a reviewed draft as the captain\'s own workflow version. Creates a workflow definition only: no Task, no staffing, no model call. Staffing is confirmed later, only when the captain clicks Run.',inputSchema:{type:'object',properties:{draft:{type:'string'}},required:['draft'],additionalProperties:false}},
 ],
 async call(name,args:any,owner){
  if(!owner.live())throw new NativeToolFailure('owner_ended','The primary request ended.','主要對話請求已結束。');
  if(!owner.captain)throw new NativeToolFailure('owner_ended','Only a current captain message may draft or save a workflow.','只有目前的船長訊息可以起草或儲存流程。');
  try{
   if(name==='studio_draft_workflow'){const d=drafts.draft(args,sha(owner.key).slice(0,16));return{draft:d.id,revision:d.revision,source:'model',status:'draft-preview',href:`#/first-workflow/${d.id}`,nodes:d.def.nodes.length};}
   if(name==='studio_save_workflow_draft'){if(!plain(args)||Object.keys(args).some(k=>k!=='draft')||typeof args.draft!=='string')throw new DraftError('pass the draft id only');return{...drafts.save(args.draft,'captain via Firstmate'),status:'saved-no-task'};}
  }catch(e){fail(e);}
  throw new NativeToolFailure('invalid_params','Unknown native tool','未知的工具。','read_current_state');
 }};
}

/** HTTP routes for the page: read drafts, inline node edits, and save. Desktop writes only (the route table enforces). */
export async function draftRoute(drafts:WorkflowDrafts,p:string,method:string,writing:boolean,b:any,by:string):Promise<Response|null>{
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 if(!/^\/api\/wf\/drafts(\/|$)/.test(p))return null;
 try{
  if(p==='/api/wf/drafts'&&!writing)return json({drafts:drafts.list(),skills:Object.entries(DRAFT_SKILLS).map(([ref,l])=>({ref,...l})),providers:DRAFT_PROVIDERS,efforts:DRAFT_EFFORTS});
  let m=/^\/api\/wf\/drafts\/(d-[a-f0-9]{12})$/.exec(p);if(m&&!writing)return json({draft:drafts.get(m[1])});
  if(writing&&method!=='POST')return json({error:'POST required'},405);
  m=/^\/api\/wf\/drafts\/(d-[a-f0-9]{12})\/nodes\/([a-z0-9][a-z0-9-]{0,40})$/.exec(p);if(m&&writing)return json({draft:drafts.editNode(m[1],m[2],b)});
  m=/^\/api\/wf\/drafts\/(d-[a-f0-9]{12})\/save$/.exec(p);if(m&&writing)return json(drafts.save(m[1],by));
  return json({error:'no such draft route'},404);
 }catch(e:any){return json({error:e?.message??'draft request failed',...(e?.problems?{problems:e.problems}:{})},e instanceof DraftError?e.status:400);}
}
