import {workflowDraftSchema,WORKFLOW_DRAFT_EXAMPLE} from './workflow-draft-contract';
import {bundledText} from './bundled';
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
import {intentStage,outcomesOf} from './readiness/stages';
import {redactText} from './secure';
import {neutralizeMarkers} from './operating-rules';

/** Role skills a drafted or inline-edited node may use: bundled text only, never a file path. */
/** The catalogue: what each skill makes. The builder refuses a node whose skill does not fit its work (R-044: a writer on design direction, design review). */
export const DRAFT_SKILLS:Record<string,{en:string;zh:string;makes:string;formats:string[];design:boolean}>={
 'bundled:workflows/skills/v2/writer.md':{en:'Writer',zh:'撰稿',makes:'documents: copy, articles, plans, reports and reviews of written work',formats:['document'],design:false},
 'bundled:workflows/skills/v2/designer.md':{en:'Designer',zh:'設計',makes:'web pages, design direction and design review of a page',formats:['web','document'],design:true},
 'bundled:workflows/skills/v2/film-editor.md':{en:'Film editor',zh:'影片剪輯',makes:'films: a timed stage of beats rendered to video, and revisions of one',formats:['video'],design:false},
};
// Visual design work only: "design" alone (a design doc, a meal-plan design, a system design) is not visual work.
const VISUAL_WORK=/\b(?:visual(?:\s+(?:design|direction|style))?|layout|mock-?ups?|wireframes?|style ?guide|look and feel|UI|UX|design direction|design review|art direction)\b|視覺|视觉|版面|排版|設計方向|设计方向|設計審查|设计审查|視覺風格|视觉风格/i,NOT_VISUAL=/\bdesign\s+(?:doc|document|plan|spec|proposal)s?\b|系統設計|系统设计/i;
/** Visual design work: a node whose label or assignment names visual design (and not a design document). */
const visualWork=(n:any)=>{const t=`${n.label} ${n.detail??''}`;return VISUAL_WORK.test(t)&&!NOT_VISUAL.test(t);};
/** Why a node's skill does not fit its work, or null. The format check is strict (a Writer cannot make a web
 *  page); the work check refuses only a skill without design on visual design work (R-044), and only for the
 *  model's draft (strict), never a captain's inline choice. Anything else a skill can make is allowed. */
export function skillMismatch(def:{nodes:any[];edges:{from:string;to:string}[];roles:{id:string;skill:string}[]},n:any,strict=true):string|null{
 if(n.kind!=='agent')return null;const ref=n.skill??def.roles.find(r=>r.id===n.role)?.skill,s=ref&&DRAFT_SKILLS[ref];if(!s)return null;const f=n.args?.format;
 if(f&&!s.formats.includes(f))return `node ${n.id}: the ${s.en} skill makes ${s.makes}, not a ${f} output; use ${Object.values(DRAFT_SKILLS).filter(o=>o.formats.includes(f)).map(o=>o.en).join(' or ')}`;
 if(strict&&f==='document'&&!s.design&&visualWork(n))return `node ${n.id}: visual design direction or design review is the Designer's work, not the ${s.en}'s`;
 return null;
}
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
 provenance:{source:'model';via:'studio_draft_workflow';turn:string;edited:boolean;
 /** who wrote the latest revision: a captain-driven model turn, a gate repair turn, the captain's inline edit, or Studio re-basing a repair on the latest saved version */
 last?:'model'|'repair'|'captain-edit'|'repair-base'};
 /** set by rebaseOnSaved: the saved version a repair started from */
 base?:{workflow:string;version:number};createdAt:string;updatedAt:string;saved:{workflow:string;version:number;revision?:number}|null;
 /** the captain's inline choices per node (null = cleared); a model revision never overrides them */
 captain?:Record<string,Partial<Record<'provider'|'model'|'effort'|'skill',string|null>>>};

export class DraftError extends Error{constructor(msg:string,readonly status=400,readonly problems?:unknown){super(msg);}}

/** A node's model choices: provider, model, effort and role skill. Throws on anything outside the closed sets. */
/** A node effort, wherever it is saved (bundled workflows included). */
export function checkEffort(n:any,label=n?.id){if(n?.effort!==undefined&&!(DRAFT_EFFORTS as readonly string[]).includes(n.effort))throw new DraftError(`${label}: effort must be one of ${DRAFT_EFFORTS.join(', ')}`);}
export function checkNodeStaffing(n:any,label=n?.id){
 if(n.provider!==undefined&&!(DRAFT_PROVIDERS as readonly string[]).includes(n.provider))throw new DraftError(`${label}: provider must be codex or claude`);
 if(n.model!==undefined&&!(typeof n.model==='string'&&MODEL.test(n.model)))throw new DraftError(`${label}: model must be a short model id`);
 if(n.effort!==undefined&&!(DRAFT_EFFORTS as readonly string[]).includes(n.effort))throw new DraftError(`${label}: effort must be one of ${DRAFT_EFFORTS.join(', ')}`);
 if(n.skill!==undefined&&!Object.hasOwn(DRAFT_SKILLS,n.skill))throw new DraftError(`${label}: skill must be a bundled Studio role skill`);
 if(n.kind!=='agent'&&n.kind!=='loop'&&['provider','model','effort','skill'].some(k=>n[k]!==undefined))throw new DraftError(`${label}: only agent and loop nodes have a provider, model, effort or skill`);
}

/** The model's graph, restricted to a drafting vocabulary that can never name a privileged action. */
function draftDefinition(raw:any,defs:WorkflowDefs):WDef{
 if(!plain(raw))throw new DraftError('workflow must be an object');
 for(const k of Object.keys(raw))if(!['name','description','roles','nodes','edges','intents','params','sample'].includes(k))throw new DraftError(`workflow.${k} is not part of a draft`);
 // intent lines: the captain's own words, numbered by position, each with what "done" means (and Firstmate's assumption when a line was ambiguous)
 if(raw.intents!==undefined&&(!Array.isArray(raw.intents)||raw.intents.length>8||raw.intents.some((l:any)=>!plain(l)||Object.keys(l).some(k=>!['n','text','done','assumption'].includes(k))||!bounded(l.text,300)||!bounded(l.done,300)||l.assumption!==undefined&&!(typeof l.assumption==='string'&&l.assumption.length<=300))))throw new DraftError('workflow.intents: up to 8 {text, done, assumption?} lines in the captain\'s words');
 const intents=(raw.intents??[]).map((l:any,i:number)=>({n:i+1,text:l.text.trim(),done:l.done.trim(),...(l.assumption?.trim()?{assumption:l.assumption.trim()}:{})}));
 if(raw.params!==undefined&&(!plain(raw.params)||Object.keys(raw.params).length>8||Object.entries(raw.params).some(([k,v]:any)=>!/^[a-z][a-z0-9_]{0,30}$/.test(k)||!plain(v)||Object.keys(v).some(x=>!['label','default'].includes(x))||!bounded(v.label,80)||v.default!==undefined&&!(typeof v.default==='string'&&v.default.length<=300))))throw new DraftError('workflow.params: up to 8 Start inputs {label, default?}');
 if(raw.sample!==undefined&&(!plain(raw.sample)||Object.keys(raw.sample).some(k=>!['text','params'].includes(k))||raw.sample.text!==undefined&&!bounded(raw.sample.text,500)||raw.sample.params!==undefined&&(!plain(raw.sample.params)||Object.values(raw.sample.params).some((v:any)=>typeof v!=='string'||v.length>300))))throw new DraftError('workflow.sample: {text?, params?} for the dry run');
 if(!bounded(raw.name,120))throw new DraftError('workflow.name: 1–120 characters');
 if(raw.description!==undefined&&!(typeof raw.description==='string'&&raw.description.length<=500))throw new DraftError('workflow.description: up to 500 characters');
 if(!Array.isArray(raw.roles)||raw.roles.length>6)throw new DraftError('workflow.roles: up to 6 roles');
 if(!Array.isArray(raw.nodes)||!raw.nodes.length||raw.nodes.length>24)throw new DraftError('workflow.nodes: 1–24 nodes');
 if(!Array.isArray(raw.edges)||raw.edges.length>48)throw new DraftError('workflow.edges: up to 48 edges');
 const roles=raw.roles.map((r:any)=>{if(!plain(r)||Object.keys(r).some(k=>!['id','label','skill'].includes(k))||!/^[a-z][a-z0-9-]{0,39}$/.test(r.id)||!bounded(r.label,60)||!Object.hasOwn(DRAFT_SKILLS,r.skill))throw new DraftError(`role ${r?.id}: id, label and a bundled Studio role skill only`);return{id:r.id,label:r.label,skill:r.skill};});
 const nodes=raw.nodes.map((n:any,i:number)=>{
  if(!plain(n))throw new DraftError('each node is an object');
  for(const k of Object.keys(n))if(!['id','kind','label','detail','role','mode','args','card','accept','serves','provider','model','effort','skill','x','y'].includes(k))throw new DraftError(`node ${n.id}: ${k} is not part of a draft`);
  if(n.serves!==undefined&&(!Array.isArray(n.serves)||n.serves.length>8||n.serves.some((v:any)=>!Number.isInteger(v)||v<1||v>8)))throw new DraftError(`node ${n.id}: serves lists intent line numbers`);
  if(n.accept!==undefined&&(n.accept!==true||n.kind!=='card'))throw new DraftError(`node ${n.id}: accept: true marks the captain's acceptance card`);
  if(!['agent','card','hook'].includes(n.kind))throw new DraftError(`node ${n.id}: a draft uses agent, card or hook nodes`);
  if(!bounded(n.label,80)||n.detail!==undefined&&!(typeof n.detail==='string'&&n.detail.length<=500))throw new DraftError(`node ${n.id}: label 1–80 characters`);
  const out:any={id:String(n.id),kind:n.kind,label:n.label,...(n.detail?{detail:n.detail}:{}),...(n.serves?{serves:[...new Set(n.serves as number[])]}:{}),x:Number.isFinite(n.x)?n.x:0,y:Number.isFinite(n.y)?n.y:0,_i:i};
  if(n.kind==='agent'){
   if(!DRAFT_MODES.has(n.mode))throw new DraftError(`node ${n.id}: agent nodes draft in deliver mode only`);
   if(!plain(n.args)||Object.keys(n.args).some(k=>!['format','variant'].includes(k))||!FORMATS.has(n.args.format)||n.args.variant!==undefined&&!/^[A-Z]$/.test(n.args.variant))throw new DraftError(`node ${n.id}: args are format (document or web) and an optional variant letter`);
   Object.assign(out,{role:n.role,mode:n.mode,args:{...n.args}});
   for(const k of ['provider','model','effort','skill'])if(n[k]!==undefined)out[k]=n[k];
  }else if(['role','mode','args','provider','model','effort','skill'].some(k=>n[k]!==undefined))throw new DraftError(`node ${n.id}: only agent nodes have a role, mode, args or staffing`);
  if(n.kind==='card'&&n.accept){
   // the captain's acceptance card: shows every delivered output and ticks each intent line before approving
   if(n.card!==undefined)throw new DraftError(`node ${n.id}: an acceptance card builds its own options`);
   out.args={mode:'deliver-accept',card_kind:'acceptance'};
  }else if(n.kind==='card'){
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
 // every agent node carries its own assignment (what this node produces), never the whole design interview (R-044);
 // made from the node id, its output and the lines it serves, so a captain's label edit never changes it under a repair
 for(const n of nodes)if(n.kind==='agent'&&!n.detail?.trim()){const lines=intents.filter((l:any)=>n.serves?.includes(l.n)).map((l:any)=>`${l.n}. ${l.text}`);n.detail=`Step ${n.id}: produce ${n.args.format==='web'?'the web page (index.html)':'the document (doc.md)'} for this step only.${lines.length?` It serves intent line${lines.length>1?'s':''} ${lines.join('; ')}`:''}`.slice(0,500);}
 for(const n of nodes){const why=skillMismatch({nodes,edges,roles},n);if(why)throw new DraftError(why);}
 const def=normalize({id:'draft',name:raw.name.trim(),version:1,...(raw.description?{description:raw.description}:{}),...(intents.length?{intents}:{}),...(raw.params?{params:raw.params}:{}),...(raw.sample?{sample:raw.sample}:{}),roles,nodes,edges});
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
 /** One lock per draft id: model revisions, inline edits and saves never interleave. */
 /** This data folder's identity for the page's local state: a new folder never shows another folder's tutorial state. */
 scope():string{const f=join(this.dir,'scope.json');try{const v=JSON.parse(readFileSync(f,'utf8')).scope;if(/^[a-f0-9]{16}$/.test(v))return v;}catch{}const v=randomBytes(8).toString('hex');try{writeFileSync(f,JSON.stringify({scope:v}),{flag:'wx'});return v;}catch{return JSON.parse(readFileSync(f,'utf8')).scope;}}
 lockName(id:string){this.file(id);return 'draft-'+id;}
 private withDraft<T>(id:string,fn:()=>T):T{return withLock(this.dir,this.lockName(id),fn);}
 private write(d:DraftRecord){const f=this.file(d.id);writeFileSync(f+'.tmp',JSON.stringify(d,null,1));renameSync(f+'.tmp',f);this.notify(d.id,d.revision);return d;}
 /** Only the native tool reaches this: the graph is the Firstmate model's own output for this captain turn. */
 /** The readiness gate's hooks: a repair revision that weakens the gate is refused (and the loop told why). */
 gate:{weakening?:(prev:DraftRecord,next:WDef)=>string|null;refused?:(id:string,reason:string,def:WDef)=>void}={};
 preview(args:any):WDef{
  if(!plain(args)||Object.keys(args).some(k=>!['goal','interview','workflow','draft'].includes(k)))throw new DraftError('use goal, interview, workflow and optionally draft (to revise)');
  if(!bounded(args.goal,500))throw new DraftError('goal: 1–500 characters');
  const interview=args.interview??[];if(!Array.isArray(interview)||interview.length>8||interview.some((q:any)=>!plain(q)||Object.keys(q).some(k=>!['question','answer'].includes(k))||!bounded(q.question,300)||!bounded(q.answer,500)))throw new DraftError('interview: up to 8 {question, answer} pairs');
  const def=draftDefinition(args.workflow,this.defs);
  for(const node of def.nodes){const outcomes=outcomesOf(node),edges=def.edges.filter(e=>e.from===node.id);if(!outcomes)continue;
   for(const edge of edges)if(edge.when&&!outcomes.includes(edge.when))throw new DraftError(`edge ${edge.from} -> ${edge.to}: ${edge.when} is not an outcome of ${node.id}; use ${outcomes.join(', ')}`);
   if(node.kind==='card')for(const outcome of outcomes)if(!edges.some(e=>(node.args?.mode!=='deliver-accept'&&!e.when)||e.when===outcome))throw new DraftError(`node ${node.id}: outcome ${outcome} needs ${node.args?.mode==='deliver-accept'?'an explicit':'a'} route`);
  }
  return def;
 }
 draft(args:any,turn:string,o:{repair?:boolean}={}):DraftRecord{
  const def=this.preview(args),interview=args.interview??[],now=new Date().toISOString();
  if(args.draft!==undefined)return this.withDraft(String(args.draft),()=>{
   const prev=this.get(String(args.draft));if(prev.saved&&!o.repair)throw new DraftError('this draft is already saved; edit the saved workflow instead',409);
   // a gate repair may not weaken the gate: the captain's intent lines, cards, round folders, checks and editor changes stay
   if(o.repair){const why=this.gate.weakening?.(prev,def);if(why){this.gate.refused?.(prev.id,why,prev.def);throw new DraftError(`repair refused: ${why}`,409);}}
   // the captain's inline choices win over the model's on the same node id
   const captain=prev.captain??{};
   const nodes=def.nodes.map(n=>{const c=captain[n.id];if(!c||n.kind!=='agent')return n;const next:any={...n};for(const[k,v]of Object.entries(c)){if(v===null)delete next[k];else next[k]=v;}checkNodeStaffing(next,n.id);return next;});
   // a repair never rewrites what the captain said: the goal and the interview answers stay as they are
   return this.write({...prev,revision:prev.revision+1,goal:o.repair?prev.goal:args.goal,interview:o.repair?prev.interview:interview,def:{...def,nodes},provenance:{source:'model',via:'studio_draft_workflow',turn,edited:prev.provenance.edited||Object.keys(captain).length>0,last:o.repair?'repair':'model'},updatedAt:now});
  });
  if(o.repair)throw new DraftError('a repair revises an existing draft: pass draft',400);
  const id='d-'+randomBytes(6).toString('hex');
  return this.withDraft(id,()=>this.write({schema:1,id,revision:1,goal:args.goal,interview,def,provenance:{source:'model',via:'studio_draft_workflow',turn,edited:false,last:'model'},createdAt:now,updatedAt:now,saved:null,captain:{}}));
 }
 /** The captain's inline choice for one agent node: provider, model, effort, skill. Empty string clears a field. */
 editNode(id:string,node:string,body:any):DraftRecord{
  if(!plain(body)||Object.keys(body).some(k=>!['revision','provider','model','effort','skill'].includes(k))||!Number.isSafeInteger(body.revision))throw new DraftError('send revision plus provider, model, effort or skill');
  return this.withDraft(id,()=>{
   const d=this.get(id);if(d.saved)throw new DraftError('this draft is saved; edit the workflow in the editor',409);if(d.revision!==body.revision)throw new DraftError(`the draft is at revision ${d.revision}; reload before editing`,409);
   const n=d.def.nodes.find(x=>x.id===node);if(!n)throw new DraftError('no such node',404);
   const next:any={...n},mine:any={...(d.captain?.[node]??{})};for(const k of ['provider','model','effort','skill'])if(body[k]!==undefined){if(body[k]===''){delete next[k];mine[k]=null;}else{next[k]=body[k];mine[k]=body[k];}}
   if(n.kind!=='agent')throw new DraftError('only agent nodes have model settings');checkNodeStaffing(next,node);
   // the captain may pick any skill that can make the node's output; one that cannot (a writer on a web page) is refused
   const unfit=skillMismatch(d.def as any,next,false);if(unfit)throw new DraftError(unfit);
   return this.write({...d,revision:d.revision+1,def:{...d.def,nodes:d.def.nodes.map(x=>x.id===node?next:x)},provenance:{...d.provenance,edited:true,last:'captain-edit'},captain:{...(d.captain??{}),[node]:mine},updatedAt:new Date().toISOString()});
  });
 }
 /** A real-run failure on a saved workflow: the repair starts from the latest saved version (with the captain's editor changes), not from the old draft. */
 rebaseOnSaved(id:string):DraftRecord|null{
  return this.withDraft(id,()=>{const d=this.get(id);if(!d.saved)return null;const cur=this.defs.get(d.saved.workflow);if(!cur)return null;
   const {origin,parent,createdAt,by,note,diff,seed,...rest}=cur as any;void origin;void parent;void createdAt;void by;void note;void diff;void seed;
   return this.write({...d,revision:d.revision+1,def:{...rest,id:'draft',version:1} as WDef,base:{workflow:cur.id,version:cur.version},provenance:{...d.provenance,last:'repair-base'},updatedAt:new Date().toISOString()} as any);});
 }
 /** Save as the captain's own workflow v1. Idempotent per draft: a retry after a lost response finds the same workflow. */
 save(id:string,by:string,revision?:number){
  return this.withDraft(id,()=>{
   const d=this.get(id);
   // intent lines first: every line served by a node, every node serving a line (en / zh-TW)
   const intent=intentStage(d.def);
   const existing=d.saved?.workflow??this.defs.ids().find(w=>(this.defs.versions(w)[0] as any)?.origin?.draft===id);
   if(existing&&d.saved&&d.revision>(d.saved.revision??0)){
    // a gate repair revised the saved draft: saving again writes the next version of the same workflow
    if(revision!==undefined&&revision!==d.revision)throw new DraftError(`the draft changed to revision ${d.revision} after you looked; reload to see it before saving`,409);
    if(intent.length)throw intentRefusal(intent);
    // the repair started from a saved version: if the captain saved another version since, nothing is overwritten
    const cur=this.defs.get(existing)!;const base=(d as any).base;
    if(!base||base.workflow!==existing||base.version!==cur.version)throw new DraftError(`v${cur.version} of this workflow was saved after the repair started from ${base?`v${base.version}`:'an older draft'}; ask Firstmate to repair again from v${cur.version} / 修正開始後已存了 v${cur.version}，請讓 Firstmate 從 v${cur.version} 重新修正`,409);
    const {intents,sample,params,roles,nodes,edges,name,description}=d.def as any;
    const next=this.defs.save(existing,{...cur,intents,sample,params,roles,nodes,edges,name,description,base:cur.version},by,`Firstmate repair ${id} revision ${d.revision}`);
    this.write({...d,saved:{workflow:existing,version:next.version,revision:d.revision}});
    return{workflow:existing,version:next.version,href:`#/workflows/${existing}`,created:false};
   }
   if(existing){const def=this.defs.get(existing)!;if(!d.saved)this.write({...d,saved:{workflow:existing,version:1,revision:d.revision}});return{workflow:existing,version:def.version,href:`#/workflows/${existing}`,created:false};}
   if(revision!==undefined&&revision!==d.revision)throw new DraftError(`the draft changed to revision ${d.revision} after you looked; reload to see it before saving`,409);
   if(intent.length)throw intentRefusal(intent);
   const slug=d.def.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,28)||'my-workflow';
   const wid=(/^[a-z0-9]/.test(slug)?slug:'my-'+slug)+'-'+id.slice(2,8);
   const def=this.defs.createDrafted(wid,d.def,by,{schema:1,source:'firstmate-draft',draft:id,revision:d.revision,definition:sha(d.def),brief:{goal:d.goal,interview:d.interview}});
   this.write({...d,saved:{workflow:def.id,version:def.version,revision:d.revision}});
   return{workflow:def.id,version:def.version,href:`#/workflows/${def.id}`,created:true};
  });
 }
}

function intentRefusal(ps:ReturnType<typeof intentStage>){return new DraftError(`Cannot save yet: ${ps.map(p=>p.reason.en).join(' ')} / 還不能儲存：${ps.map(p=>p.reason.zh).join('')}`,400,ps.map(p=>({level:'error',node:p.node??undefined,text:p.reason.en,zh:p.reason.zh,fix:p.fix})));}
/** The plan a Run of the captain's own workflow needs confirmed: one row per agent node. */
export function ownStaffingPlan(def:WDef){
 const plan=def.nodes.filter(n=>n.kind==='agent').map((n:WNode)=>{const role=def.roles.find(r=>r.id===n.role);return{node:n.id,label:n.label,role:n.role??null,provider:n.provider??null,model:n.model??null,effort:(n as any).effort??null,skill:n.skill??role?.skill??null};});
 const missing=plan.filter(p=>!p.provider||!p.model||p.provider==='codex'&&!p.effort).map(p=>p.node);
 return{plan,missing,hash:sha({workflow:def.id,version:def.version,plan})};
}
/** The Task brief for the captain's own workflow: what they asked for, the drafted goal, intent lines and Start inputs.
 * The design interview (who makes, who reviews) shaped the graph: it is background, never a worker's assignment, which is its node's detail. */
/** One line of the captain's input in a brief: no newline, no rules marker, no secret. */
const briefLine=(v:unknown,max=300)=>redactText(neutralizeMarkers(String(v??'').replace(/[\r\n\u2028\u2029]+/g,' ').replace(/\s{2,}/g,' ').trim())).slice(0,max);
export function ownBrief(def:any,text:string,params:Record<string,string>={}){
 const b=def?.origin?.brief,intents=Array.isArray(def?.intents)?def.intents:[];
 const inputs=Object.entries(def?.params??{}).filter(([k])=>typeof params[k]==='string'&&params[k].trim()).map(([k,v]:any)=>`- ${briefLine(v?.label??k,80)}: ${briefLine(params[k])}`);
 if((!plain(b)||typeof b.goal!=='string')&&!intents.length&&!inputs.length)return text;
 // the intent lines and Start inputs always fit: the free text (the Task text, goal, interview) is what gets cut
 const fixed=[...(intents.length?['Intent lines (the captain\'s words):',...intents.map((l:any)=>`${l.n}. ${briefLine(l.text)} — done means: ${briefLine(l.done)}${l.assumption?` (assumed: ${briefLine(l.assumption)})`:''}`)]:[]),
  ...(inputs.length?['Start inputs:',...inputs]:[])].join('\n');
 const free=[text.trim(),...(plain(b)&&typeof b.goal==='string'?[`Captain goal: ${b.goal}`,...(Array.isArray(b.interview)&&b.interview.length?['Background from the workflow design interview (not any step\'s assignment; each step\'s own assignment is in its brief):',...b.interview.map((q:any)=>`- ${q.question} — ${q.answer}`)]:[])]:[])].filter(Boolean).join('\n');
 const room=Math.max(0,3800-fixed.length-(fixed&&free?1:0));
 return [free.length>room?free.slice(0,Math.max(0,room-1))+'…':free,fixed].filter(Boolean).join('\n');}
/** Only the captain's own workflows (a draft or the free starter) take the Run-time staffing gate. */
export const ownWorkflow=(def:any)=>plain(def?.origin)&&['firstmate-draft','starter'].includes(def.origin.source);

export type DraftGateTools={repairAuthorized(draft:string,ref:{draft?:unknown;nonce?:unknown}|null|undefined):boolean;view(args:{draft?:string;workflow?:string;version?:number}):unknown};
export function installWorkflowDraftTools(drafts:WorkflowDrafts,gate?:DraftGateTools,onSaved?:(def:WDef)=>void):NativeMainTools{
 const fail=(e:any):never=>{if(e instanceof NativeToolFailure)throw e;if(e instanceof DraftError)throw new NativeToolFailure(e.status===404?'draft_missing':'draft_invalid',`Draft refused: ${e.message}. Read studio_workflow_draft_contract, validate with studio_validate_workflow_draft, then submit the corrected graph.`,`草稿未通過：${e.message}。請修正流程圖後再呼叫 studio_draft_workflow。`,'read_current_state');throw new NativeToolFailure('draft_invalid','Draft refused. Read the draft and try again.','草稿未通過，請讀取草稿後再試。','read_current_state');};
 const schema=workflowDraftSchema(Object.keys(DRAFT_SKILLS),DRAFT_PROVIDERS,DRAFT_EFFORTS);
 return{specs:[
  {type:'function',name:'studio_read_workflow',description:'Read a saved workflow and its exact node IDs, roles, model configuration and current version before editing. No execution.',inputSchema:{type:'object',properties:{workflow:{type:'string'}},required:['workflow'],additionalProperties:false}},
  {type:'function',name:'studio_update_workflow_staffing',description:'After the captain explicitly chooses configuration, persist agent or loop node provider/model/effort/skill in a saved personal workflow as a new version. Read studio_read_workflow first, pass its version as base, and include every node sharing the chosen role. Does not run work, verify a paid model, or approve staffing. Never tell the captain to re-enter choices manually.',inputSchema:{type:'object',properties:{workflow:{type:'string'},base:{type:'integer'},nodes:{type:'array',minItems:1,maxItems:18,items:{type:'object',properties:{node:{type:'string'},provider:{type:'string',enum:[...DRAFT_PROVIDERS]},model:{type:'string'},effort:{type:'string',enum:[...DRAFT_EFFORTS]},skill:{type:'string',enum:Object.keys(DRAFT_SKILLS)}},required:['node'],additionalProperties:false}}},required:['workflow','base','nodes'],additionalProperties:false}},
  {type:'function',name:'studio_workflow_draft_contract',description:'Read the current workflow drafting skill, exact tool input schema and an executable Hello website example. Read this before designing a graph; this is read-only and starts no Task.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {type:'function',name:'studio_validate_workflow_draft',description:'Validate a proposed draft without saving it or starting work. Checks the same argument format and static graph rules as studio_draft_workflow; then draft and read studio_workflow_gate for readiness, dry-run and runtime evidence.',inputSchema:schema},
  {type:'function',name:'studio_draft_workflow',description:'FREE drafting, no execution: after a short interview (goal, who does the work, who reviews, when the captain decides), submit the graph you designed for the captain\'s own workflow. Put the captain\'s goals in workflow.intents as numbered lines in the captain\'s own words, each {text, done} where done says what "done" means (add assumption when a line was ambiguous: pick the most reasonable reading, do not ask); every node lists the intent line numbers it serves in serves (a plain end hook needs none). Nodes: agent (mode deliver, args.format document|web, optional provider codex|claude, model, effort, skill), card (captain decision with options, or accept: true for the acceptance card that ticks every intent line), hook (end). Optional workflow.params (Start inputs {label, default?}) and workflow.sample ({text, params} for the dry run). Role skills: '+Object.keys(DRAFT_SKILLS).join(', ')+'. Studio runs the readiness gate on every revision and sends you a GATE-REPAIR turn when it fails: then revise with draft set, keep every intent line, and never ask the captain. The page previews it live, labeled as model output. Never starts a Task or staffing; never use studio_propose_work for drafting. Pass draft to revise an unsaved draft.',inputSchema:schema},
  {type:'function',name:'studio_workflow_gate',description:'Read the readiness gate result for a draft (draft) or a saved workflow version (workflow, version): each stage (1 intent lines, 2 static contract, 3 briefs, 4 stub dry run, 5 real run) with typed problems (stage, node, reason, fix, who can fix it), the repair rounds so far and the status line. Read-only; use it to fix the draft yourself before asking the captain.',inputSchema:{type:'object',properties:{draft:{type:'string'},workflow:{type:'string'},version:{type:'integer'}},additionalProperties:false}},
  {type:'function',name:'studio_save_workflow_draft',description:'Only when the captain asks to save: save a reviewed draft as the captain\'s own workflow version. Creates a workflow definition only: no Task, no staffing, no model call. Staffing is confirmed later, only when the captain clicks Run.',inputSchema:{type:'object',properties:{draft:{type:'string'},revision:{type:'integer'}},required:['draft'],additionalProperties:false}},
 ],
 async call(name,args:any,owner){
  if(!owner.live())throw new NativeToolFailure('owner_ended','The primary request ended.','主要對話請求已結束。');
  if(name==='studio_workflow_draft_contract')return{schema,skill:bundledText('workflows/skills/firstmate-workflow-design/SKILL.md'),skills:Object.entries(DRAFT_SKILLS).map(([ref,l])=>({ref,label:l.en,makes:l.makes,formats:l.formats})),example:structuredClone(WORKFLOW_DRAFT_EXAMPLE),limits:{staticValidationIsExecutionEvidence:false}};
  if(name==='studio_validate_workflow_draft'){try{const def=drafts.preview(args);return{valid:true,stage:'static-contract',nodes:def.nodes.length,edges:def.edges.length,next:'studio_draft_workflow',runtimeVerified:false};}catch(e:any){return{valid:false,stage:'static-contract',problems:e.problems??[{text:e.message}],next:'Correct these exact problems using studio_workflow_draft_contract, then validate again.',runtimeVerified:false};}}
  if(name==='studio_read_workflow'){if(!plain(args)||Object.keys(args).some(k=>k!=='workflow')||typeof args.workflow!=='string')throw new NativeToolFailure('invalid_params','Pass workflow ID','請提供流程 ID。');const def=drafts.defs.get(args.workflow);if(!def)throw new NativeToolFailure('draft_missing','No such workflow','找不到這個流程。');return{workflow:def,editable:ownWorkflow(def),status:'read-only'};}
  if(name==='studio_workflow_gate'){if(!gate)throw new NativeToolFailure('invalid_params','The readiness gate is not available.','檢查閘門目前無法使用。');try{return gate.view(plain(args)?args:{});}catch(e:any){throw new NativeToolFailure('invalid_params',`Gate read refused: ${e?.message??e}`,`無法讀取檢查結果：${e?.message??e}`,'read_current_state');}}
  // a Studio gate-repair turn may revise exactly the draft it names, while its nonce is current; nothing else
  const repair=!owner.captain&&name==='studio_draft_workflow'&&plain(args)&&typeof args.draft==='string'&&!!gate?.repairAuthorized(args.draft,(owner as any).repair);
  if(!owner.captain&&!repair)throw new NativeToolFailure('owner_ended','Only a current captain message may draft or save a workflow.','只有目前的船長訊息可以起草或儲存流程。');
  try{
   if(name==='studio_update_workflow_staffing'){
    if(!plain(args)||Object.keys(args).some(k=>!['workflow','base','nodes'].includes(k))||typeof args.workflow!=='string'||!/^([a-z0-9][a-z0-9-]{0,80})$/.test(args.workflow)||!Number.isSafeInteger(args.base)||!Array.isArray(args.nodes)||!args.nodes.length||args.nodes.length>18)throw new DraftError('pass workflow, base and 1–18 node configuration patches');
    return withLock(drafts.defs.dir,'staffing-'+args.workflow,()=>{
     const def=drafts.defs.get(args.workflow);if(!def||!ownWorkflow(def))throw new DraftError('only saved personal workflows can be configured');if(def.version!==args.base)throw new DraftError('workflow changed; read the latest version before editing',409);
     const patches=new Map<string,any>();for(const patch of args.nodes){if(!plain(patch)||Object.keys(patch).some(k=>!['node','provider','model','effort','skill'].includes(k))||typeof patch.node!=='string'||patches.has(patch.node)||Object.keys(patch).length<2)throw new DraftError('each unique node needs provider, model, effort or skill');const node=def.nodes.find(n=>n.id===patch.node);if(!node||node.kind!=='agent'&&node.kind!=='loop')throw new DraftError('configuration target must be an existing agent or loop node');const {node:id,...fields}=patch;const next={...node,...fields};checkNodeStaffing(next,id);patches.set(id,next);}
     const nodes=def.nodes.map(n=>patches.get(n.id)??n);if(JSON.stringify(nodes)===JSON.stringify(def.nodes))return{workflow:def.id,version:def.version,status:'unchanged-no-task'};
     const saved=drafts.defs.save(def.id,{base:args.base,nodes},'captain via Firstmate','Update captain-selected agent configuration');onSaved?.(saved);return{workflow:saved.id,version:saved.version,status:'saved-no-task',href:`#/workflows/${saved.id}`,nodes:saved.nodes.filter(n=>patches.has(n.id))};
    });
   }
   if(name==='studio_draft_workflow'){const d=drafts.draft(args,sha(owner.key).slice(0,16),{repair});return{draft:d.id,revision:d.revision,source:'model',status:'draft-preview',href:`#/first-workflow/${d.id}`,nodes:d.def.nodes.length};}
   if(name==='studio_save_workflow_draft'){if(!plain(args)||Object.keys(args).some(k=>!['draft','revision'].includes(k))||typeof args.draft!=='string'||args.revision!==undefined&&!Number.isSafeInteger(args.revision))throw new DraftError('pass the draft id and optionally the revision the captain approved');return{...drafts.save(args.draft,'captain via Firstmate',args.revision),status:'saved-no-task'};}
  }catch(e){fail(e);}
  throw new NativeToolFailure('invalid_params','Unknown native tool','未知的工具。','read_current_state');
 }};
}

/** HTTP routes for the page: read drafts, inline node edits, and save. Desktop writes only (the route table enforces). */
export async function draftRoute(drafts:WorkflowDrafts,p:string,method:string,writing:boolean,b:any,by:string):Promise<Response|null>{
 const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 if(!/^\/api\/wf\/drafts(\/|$)/.test(p))return null;
 try{
  if(p==='/api/wf/drafts'&&!writing)return json({scope:drafts.scope(),drafts:drafts.list(),skills:Object.entries(DRAFT_SKILLS).map(([ref,l])=>({ref,...l})),providers:DRAFT_PROVIDERS,efforts:DRAFT_EFFORTS});
  let m=/^\/api\/wf\/drafts\/(d-[a-f0-9]{12})$/.exec(p);if(m&&!writing)return json({draft:drafts.get(m[1])});
  if(writing&&method!=='POST')return json({error:'POST required'},405);
  m=/^\/api\/wf\/drafts\/(d-[a-f0-9]{12})\/nodes\/([a-z0-9][a-z0-9-]{0,40})$/.exec(p);if(m&&writing)return json({draft:drafts.editNode(m[1],m[2],b)});
  m=/^\/api\/wf\/drafts\/(d-[a-f0-9]{12})\/save$/.exec(p);if(m&&writing){if(!plain(b)||Object.keys(b).some(k=>k!=='revision')||!Number.isSafeInteger(b.revision))return json({error:'send the draft revision you are saving; reload the page if you do not see one'},400);return json(drafts.save(m[1],by,b.revision));}
  return json({error:'no such draft route'},404);
 }catch(e:any){return json({error:e?.message??'draft request failed',...(e?.problems?{problems:e.problems}:{})},e instanceof DraftError?e.status:400);}
}
