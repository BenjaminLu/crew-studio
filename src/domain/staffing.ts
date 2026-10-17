// Source-owned staffing authority. Vendor settings and project repositories are never written.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,lstatSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {ledgerKey} from '../runtime/checks';
import {QueueRefusal} from '../runtime/queue';
import {jobInstructions} from '../operating-rules';
import {failure} from '../runtime/failures';
import {unified} from '../diff';
import {ROLE_SKILL_JOIN,roleSkillParts} from '../runtime/defs';
export function nativeStaffingSkillRef(role:string,workflow='code-firstmate'):string{
 // coffee-kit roles name two skills: the shared native contract, then the coffee domain profile (one joined ref)
 const names:Record<string,string[]>=workflow==='coffee-kit'?{worker:['firstmate/skills/worker','coffee-kit/skills/website'],'image-worker':['firstmate/skills/worker','coffee-kit/skills/image'],reviewer:['firstmate/skills/reviewer','coffee-kit/skills/reviewer'],designer:['firstmate/skills/designer','coffee-kit/skills/designer']}:workflow==='code-firstmate'?{coordinator:['firstmate/skills/firstmate'],worker:['firstmate/skills/worker'],reviewer:['firstmate/skills/reviewer'],designer:['firstmate/skills/designer']}:{};
 if(!Object.hasOwn(names,role))throw new Error('Unknown native staffing workflow or role');
 return names[role].map(n=>`pack:${n}.md`).join(ROLE_SKILL_JOIN);
}
/** Staffing is enforced by kind, never by workflow id: coffee-kit, and every code workflow with roles or agent nodes
 * (code-firstmate, a captain's own code workflow, github-review). */
export function staffingApplies(def:any):boolean{
 return def?.kind==='coffee-kit'||def?.kind==='code'&&(Array.isArray(def.roles)&&def.roles.length>0||Array.isArray(def.nodes)&&def.nodes.some((n:any)=>n?.kind==='agent'||typeof n?.role==='string'));
}
/** The skill a staffed role must carry: the source contract for code-firstmate and coffee-kit; a captain's own code
 * workflow keeps the skill its definition declares for that role. */
export function staffingSkillRef(def:any,role:string):string{
 if(def?.kind==='coffee-kit')return nativeStaffingSkillRef(role,'coffee-kit');
 if(def?.id==='code-firstmate')return nativeStaffingSkillRef(role,'code-firstmate');
 const r=Array.isArray(def?.roles)?def.roles.find((x:any)=>x?.id===role):null;
 if(typeof r?.skill!=='string'||!r.skill.trim())throw new Error('Unknown native staffing workflow or role');
 return r.skill;
}
/** A role with several named skills: one pin per skill (the same SkillPin a node's library skill has; its ref is the skill's source,
 *  its version 1: the source text as approved), in order. Undefined for a role with one skill. */
export function skillPartPins(ref:string,text:(ref:string)=>string):SkillPin[]|undefined{const parts=roleSkillParts(ref);return parts.length>1?parts.map(p=>{const sha256=createHash('sha256').update(text(p)).digest('hex');return{ref:p,version:1,sha256,snapshotSha256:sha256};}):undefined;}
/** Explicit artifact project names are a separate authority namespace from Git repositories. */
export function coffeeStaffingProject(id:string):StaffingProject{
 if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id))throw new Error('Choose an explicit coffee artifact project');
 return {namespace:'artifact',id,identity:'coffee-artifact-project-v1:'+staffingHash({namespace:'artifact',id})};
}
export type StaffingProject={namespace:'git'|'artifact';id:string;identity:string};
export type SkillPin={ref:string;version:number;sha256:string;snapshotSha256:string};
/** skill pins the role's joined text; skills (a role with several named skills only) pins each named skill, in the same SkillPin list a node override's skills use. */
export type StaffingRole={provider:'codex'|'claude';model:string;effort:string|null;skill:SkillPin;skills?:SkillPin[]};
/** One node's override of its role's staffing (an agent or loop node): any of provider, model, effort, plus the named skills it loads.
 *  A library skill pin's ref is skill:<id>; its version and sha256 are the library version's. */
export type StaffingNode={provider?:'codex'|'claude';model?:string;effort?:string|null;skills?:SkillPin[]};
export type StaffingDraft={schema:1;algorithm:'sha256-canonical-v1';project:StaffingProject;workflow:{id:string;version:number;sha256:string};roles:Record<string,StaffingRole>;review:{freshContexts:number;distinctProviders:boolean};
 /** per-node overrides (absent in approvals made before node overrides existed: those cover a workflow with no node provider, model or effort) */
 nodes?:Record<string,StaffingNode>};
export type StaffingConfig=StaffingDraft&{version:number;previous:string|null;approval:{run:string;card:string;answerSeq:number};hash:string;signature:string};
function plain(x:any){return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function keys(x:any,expected:string[]){if(!plain(x)||Object.keys(x).sort().join('|')!==[...expected].sort().join('|'))throw new Error('Staffing schema keys differ');}
/** the same, with node overrides allowed (they are optional) */
const withNodes=(x:any,expected:string[])=>keys(x,plain(x)&&Object.hasOwn(x,'nodes')?[...expected,'nodes']:expected);
function text(x:any,max=200){if(typeof x!=='string'||!x.trim()||x.length>max||/[\u0000-\u001f]/.test(x))throw new Error('Malformed staffing text');}
function integer(x:any){if(!Number.isSafeInteger(x)||x<1)throw new Error('Malformed staffing version');}
function digest(x:any){if(typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))throw new Error('Malformed staffing digest');}
export function staffingCanonical(x:any):string{
 if(x===null||typeof x==='boolean'||typeof x==='string')return JSON.stringify(x);
 if(typeof x==='number'&&Number.isFinite(x))return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(staffingCanonical).join(',')+']';
 if(plain(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+staffingCanonical(x[k])).join(',')+'}';
 throw new Error('Unsupported staffing identity');
}
export const staffingHash=(x:unknown)=>createHash('sha256').update(staffingCanonical(x)).digest('hex');
const LIBRARY_REF=/^skill:[a-z0-9][a-z0-9-]{0,40}$/;
function validatePin(p:any){keys(p,['ref','version','sha256','snapshotSha256']);text(p.ref);integer(p.version);digest(p.sha256);digest(p.snapshotSha256);if(p.sha256!==p.snapshotSha256)throw new Error('Skill snapshot differs');}
/** A list of skill pins (a role's named skills, a node's library skills): each a valid SkillPin, distinct, of the right kind of ref;
 *  a role's list must join to its role skill ref. */
function validateSkillList(list:any,min:number,kind:(p:SkillPin)=>boolean,joined?:string){
 if(!Array.isArray(list)||list.length<min||list.length>8)throw new Error('A skill list names at most 8 skills');const seen=new Set<string>();
 for(const p of list){validatePin(p);if(!kind(p)||seen.has(p.ref))throw new Error('Malformed or repeated skill pin');seen.add(p.ref);}
 if(joined!==undefined&&list.map((p:SkillPin)=>p.ref).join(ROLE_SKILL_JOIN)!==joined)throw new Error('Role skill pins differ from the role skill');
}
function validateNodes(nodes:any){
 if(!plain(nodes)||!Object.keys(nodes).length||Object.keys(nodes).length>40)throw new Error('Staffing node overrides are missing or excessive');
 for(const[id,n]of Object.entries<any>(nodes)){
  if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id))throw new Error('Malformed node override');
  if(!plain(n)||!Object.keys(n).length||Object.keys(n).some(k=>!['provider','model','effort','skills'].includes(k)))throw new Error('Staffing node override keys differ');
  if(n.provider!==undefined&&!['codex','claude'].includes(n.provider))throw new Error('Unsupported staffing provider');if(n.model!==undefined)text(n.model);if(n.effort!==undefined&&n.effort!==null)text(n.effort,40);
  if(n.skills!==undefined)validateSkillList(n.skills,0,p=>LIBRARY_REF.test(p.ref));
 }
}
/** The node overrides a workflow definition asks for: an agent or loop node's own provider, model, effort and skills (library pins).
 *  Undefined when it asks for none. A staffing proposal records these, so the captain approves them with the roles. */
export function staffingNodeOverrides(def:any):Record<string,StaffingNode>|undefined{
 const out:Record<string,StaffingNode>={};
 for(const n of def?.nodes??[]){if(n.kind!=='agent'&&n.kind!=='loop')continue;const o:StaffingNode={};
  if(n.provider)o.provider=n.provider;if(n.model)o.model=n.model;if(n.effort)o.effort=n.effort;
  if(Array.isArray(n.skills)&&n.skills.length)o.skills=n.skills.map((p:any)=>({ref:`skill:${p.id}`,version:Number(p.v),sha256:p.sha256,snapshotSha256:p.sha256}));
  if(Object.keys(o).length)out[n.id]=o;}
 return Object.keys(out).length?out:undefined;
}
const pickOverride=(o:StaffingNode|undefined)=>!!o&&(o.provider!==undefined||o.model!==undefined||o.effort!==undefined);
/** The role a node's turns run as: an agent node's role; a loop's coordinator turns run as the coordinator role. */
export function nodeRole(def:any,node:any):string|undefined{if(node?.kind==='loop'){const has=(r:unknown)=>!!r&&def?.roles?.some((x:any)=>x.id===r);return node.role??(has(node.args?.coordinator)?node.args.coordinator:has('coordinator')?'coordinator':undefined);}return node?.role??node?.args?.role;}
/** What a node runs on: its role's approved provider, model and effort, with the node's approved override on top.
 *  The override applies to the node's own role only (a judge turn on an agent node keeps the reviewer's staffing). */
export function effectivePick(config:Pick<StaffingDraft,'roles'|'nodes'>,def:any,node:any,roleId:string|undefined):{provider:'codex'|'claude';model:string;effort:string|null}|null{
 const role=roleId?config.roles[roleId]:undefined;if(!role)return null;const o=node?.id?config.nodes?.[node.id]:undefined;
 if(!pickOverride(o)||roleId!==nodeRole(def,node))return{provider:role.provider,model:role.model,effort:role.effort};
 const provider=o!.provider??role.provider;
 return{provider,model:o!.model??role.model,effort:o!.effort!==undefined?o!.effort:role.effort};
}
/** Every pick a configuration runs: each role's, then each node override's effective pick (each must be verified available like a role). */
export function staffedPicks(config:Pick<StaffingDraft,'roles'|'nodes'>,def:any):{provider:'codex'|'claude';model:string;effort:string|null}[]{
 const out=Object.values(config.roles).map(r=>({provider:r.provider,model:r.model,effort:r.effort}));
 for(const[id,o]of Object.entries(config.nodes??{})){if(!pickOverride(o))continue;const node=def?.nodes?.find((n:any)=>n.id===id);const p=node&&effectivePick(config,def,node,nodeRole(def,node));if(!p)throw new Error(`Node override ${id} has no staffed role`);out.push(p);}
 return out;
}
/** A Task start's capability check: every role pick and node override pick must be ready (the definition the configuration names). */
export function staffedCapability(config:StaffingConfig|StaffingDraft,def:any,ready:(pick:{provider:string;model:string;effort:string|null})=>boolean){
 for(const pick of staffedPicks(config,def))if(!ready(pick))throw new Error('Refresh staffing facts and confirm available role models before work / 請先更新派工能力並確認可用的角色模型');
}
/** Problems with a definition's node overrides against its roles' picks (a provider change names its model; Codex names an effort). */
export function nodeOverrideProblems(def:any,roles:Record<string,{provider:string;model:string;effort:string|null}>):string[]{
 const nodes=staffingNodeOverrides(def)??{},out:string[]=[];
 for(const[id,o]of Object.entries(nodes)){if(!pickOverride(o))continue;const node=def.nodes.find((n:any)=>n.id===id),role=roles[nodeRole(def,node)??''];
  if(!role){out.push(`${id}: no staffed role for this node's override`);continue;}
  if(o.provider&&o.provider!==role.provider&&!o.model)out.push(`${id}: a node that changes provider names its model`);
  const provider=o.provider??role.provider,effort=o.effort!==undefined?o.effort:role.effort;if(provider==='codex'&&!effort)out.push(`${id}: choose a Codex effort for this node`);}
 return out;
}
function validateProject(x:StaffingProject){keys(x,['namespace','id','identity']);if(!['git','artifact'].includes(x.namespace))throw new Error('Unknown project namespace');text(x.id);text(x.identity,2000);}
export function validateStaffingDraft(x:StaffingDraft):void{
 withNodes(x,['schema','algorithm','project','workflow','roles','review']);if(Object.hasOwn(x,'nodes'))validateNodes(x.nodes);if(x.schema!==1||x.algorithm!=='sha256-canonical-v1')throw new Error('Unsupported staffing schema');validateProject(x.project);
 keys(x.workflow,['id','version','sha256']);text(x.workflow.id);integer(x.workflow.version);digest(x.workflow.sha256);
 if(!plain(x.roles)||!Object.keys(x.roles).length||Object.keys(x.roles).length>12)throw new Error('Staffing roles are missing or excessive');
 for(const[id,r]of Object.entries(x.roles)){if(!/^[a-z][a-z0-9-]{0,39}$/.test(id))throw new Error('Malformed role');keys(r,Object.hasOwn(r,'skills')?['provider','model','effort','skill','skills']:['provider','model','effort','skill']);if(!['codex','claude'].includes(r.provider))throw new Error('Unsupported staffing provider');text(r.model);if(r.effort!==null)text(r.effort,40);if(r.provider==='codex'&&!r.effort)throw new Error('Choose Codex effort explicitly');keys(r.skill,['ref','version','sha256','snapshotSha256']);text(r.skill.ref,400);integer(r.skill.version);digest(r.skill.sha256);digest(r.skill.snapshotSha256);if(r.skill.sha256!==r.skill.snapshotSha256)throw new Error('Skill snapshot differs');
  if(Object.hasOwn(r,'skills'))validateSkillList(r.skills,2,p=>!p.ref.startsWith('skill:'),r.skill.ref);}
 keys(x.review,['freshContexts','distinctProviders']);if(x.review.freshContexts!==3||typeof x.review.distinctProviders!=='boolean')throw new Error('Three fresh review contexts are required');
}
export class StaffingStore{
 constructor(readonly dataDir:string){}
 key(p:StaffingProject){validateProject(p);return p.namespace+'-'+staffingHash(p);}
 private dir(p:StaffingProject){return join(this.dataDir,'projects',this.key(p),'staffing');}
 snapshotPath(p:StaffingProject,sha:string){digest(sha);return join(this.dir(p),'skills',sha+'.md');}
 private contained(path:string){const base=resolve(this.dataDir),target=resolve(path),rel=relative(base,target);if(rel.startsWith('..'+sep)||rel==='..'||rel.startsWith(sep))throw new Error('Staffing path escaped');let current=base;for(const part of rel.split(sep)){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new Error('Staffing symlink refused');}}
 private read(path:string){this.contained(path);return readFileSync(path,'utf8');}
 private safeDir(path:string){this.contained(path);mkdirSync(path,{recursive:true,mode:0o700});if(lstatSync(path).isSymbolicLink())throw new Error('Staffing directory symlink refused');}
 snapshot(input:{ref:string;version:number;text:string}):SkillPin{ text(input.ref);integer(input.version);if(typeof input.text!=='string'||!input.text.trim()||input.text.length>100000)throw new Error('Missing native role skill');const sha=createHash('sha256').update(input.text).digest('hex');return{ref:input.ref,version:input.version,sha256:sha,snapshotSha256:sha};}
 // Optional historical skill archives are audit-only; runtime reads the selected workflow skill.
 approve(draft:StaffingDraft,expected:string|null,approval:StaffingConfig['approval'],sourceSkills?:Record<string,string>):StaffingConfig{
 validateStaffingDraft(draft);keys(approval,['run','card','answerSeq']);text(approval.run);text(approval.card);integer(approval.answerSeq);
 const dir=this.dir(draft.project);this.safeDir(dir);const lock=join(dir,'.lock');mkdirSync(lock,{mode:0o700});
 try{
 const previous=existsSync(join(dir,'current.json'))?this.current(draft.project):null;if((previous?.hash??null)!==expected)throw new Error('Staffing changed; confirm a fresh proposal');
 this.safeDir(join(dir,'skills'));
 for(const r of Object.values(draft.roles)){const path=this.snapshotPath(draft.project,r.skill.sha256);if(!existsSync(path)){const body=sourceSkills?.[r.skill.ref]??this.pendingSkills.get(r.skill.sha256);if(typeof body==='string'&&createHash('sha256').update(body).digest('hex')===r.skill.sha256)writeFileSync(path,body,{flag:'wx',mode:0o600});}}
 const body={...structuredClone(draft),version:(previous?.version??0)+1,previous:expected,approval:structuredClone(approval)};const hash=staffingHash(body),signature=createHmac('sha256',ledgerKey(this.dataDir)).update(hash).digest('hex');const config={...body,hash,signature};
 writeFileSync(join(dir,`v${config.version}.json`),JSON.stringify(config),{flag:'wx',mode:0o600});const pointer=join(dir,'current.json.tmp');writeFileSync(pointer,JSON.stringify({schema:1,version:config.version,hash,signature:createHmac('sha256',ledgerKey(this.dataDir)).update(staffingHash({project:this.key(draft.project),version:config.version,hash})).digest('hex')}),{flag:'wx',mode:0o600});renameSync(pointer,join(dir,'current.json'));return structuredClone(config);
 }finally{rmSync(lock,{recursive:true});}
 }
 private interviewDir(project:StaffingProject,workflow:StaffingInterview['workflow']){return join(this.dir(project),'interviews',staffingHash(workflow));}
 interview(project:StaffingProject,workflow:StaffingInterview['workflow'],roles:string[]):StaffingInterview{
  const path=join(this.interviewDir(project,workflow),'current.json'),legacy=join(this.dir(project),'interview.json');
  const fresh=():StaffingInterview=>({schema:1,project,workflow,roles,choices:{},round:1,lastTurn:null});
  const selected=existsSync(path)?path:existsSync(legacy)?legacy:null;if(!selected)return fresh();
  const record=JSON.parse(this.read(selected));keys(record,['body','signature']);const expected=createHmac('sha256',ledgerKey(this.dataDir)).update(staffingHash(record.body)).digest('hex');if(record.signature!==expected||record.body.schema!==1||staffingHash(record.body.project)!==staffingHash(project))throw new Error('Staffing interview signature or project changed');
  if(selected===legacy&&staffingHash(record.body.workflow)!==staffingHash(workflow))return fresh();
  if(staffingHash(record.body.workflow)!==staffingHash(workflow)||staffingHash(record.body.roles)!==staffingHash(roles))throw new Error('Staffing interview binding changed; prepare a new discussion');return record.body;
 }
 saveInterview(interview:StaffingInterview,expectedRound:number){
  const root=this.dir(interview.project);this.safeDir(root);const lock=join(root,'.interview-lock');mkdirSync(lock,{mode:0o700});
  try{const current=this.interview(interview.project,interview.workflow,interview.roles);if(current.round!==expectedRound)throw new Error('Staffing discussion changed; read the current frontier');const dir=this.interviewDir(interview.project,interview.workflow);this.safeDir(dir);const signature=createHmac('sha256',ledgerKey(this.dataDir)).update(staffingHash(interview)).digest('hex'),tmp=join(dir,'current.json.tmp');const serialized=JSON.stringify({body:interview,signature});writeFileSync(join(dir,`interview-v${interview.round}.json`),serialized,{flag:'wx',mode:0o600});writeFileSync(tmp,serialized,{flag:'wx',mode:0o600});renameSync(tmp,join(dir,'current.json'));}finally{rmSync(lock,{recursive:true});}
 }
 private pendingSkills=new Map<string,string>();
 remember(input:{ref:string;version:number;text:string}){const pin=this.snapshot(input);this.pendingSkills.set(pin.sha256,input.text);return pin;}
 /** A role's pins from its source texts (text reads a ref as the runtime's skillText does): the joined text (skill) and, for a role with several named skills, each one (skills). */
 rolePins(ref:string,text:(ref:string)=>string,version=1):Pick<StaffingRole,'skill'|'skills'>{const parts=skillPartPins(ref,text);return{skill:this.remember({ref,version,text:text(ref)}),...(parts?{skills:parts}:{})};}
 skill(pin:SkillPin,project?:StaffingProject){if(!project){const pending=this.pendingSkills.get(pin.sha256);if(pending!==undefined)return pending;throw new Error('Project identity required for skill');}const body=this.read(this.snapshotPath(project,pin.sha256));if(createHash('sha256').update(body).digest('hex')!==pin.sha256)throw new Error('Approved skill changed');return body;}
 /** An earlier approved version by its hash (a task bound before a newer approval), verified like the current one; null when none matches. */
 byHash(project:StaffingProject,hash:string):StaffingConfig|null{
  digest(hash);const dir=this.dir(project);if(!existsSync(dir))return null;
  for(const file of readdirSync(dir).filter(f=>/^v[1-9][0-9]*\.json$/.test(f))){let c:any;try{c=JSON.parse(this.read(join(dir,file)));}catch{continue;}if(c?.hash!==hash)continue;
   withNodes(c,['schema','algorithm','project','workflow','roles','review','version','previous','approval','hash','signature']);const{version,previous,approval,hash:h,signature,...draft}=c;validateStaffingDraft(draft);
   const expected=createHmac('sha256',ledgerKey(this.dataDir)).update(h).digest('hex');if(staffingHash({...draft,version,previous,approval})!==h||staffingHash(project)!==staffingHash(c.project)||typeof signature!=='string'||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error('Staffing approval verification failed');
   return c as StaffingConfig;}
  return null;
 }
 current(project:StaffingProject):StaffingConfig{
 const dir=this.dir(project),pointer=JSON.parse(this.read(join(dir,'current.json')));keys(pointer,['schema','version','hash','signature']);if(pointer.schema!==1)throw new Error('Unknown staffing pointer schema');integer(pointer.version);digest(pointer.hash);digest(pointer.signature);const pointerSignature=createHmac('sha256',ledgerKey(this.dataDir)).update(staffingHash({project:this.key(project),version:pointer.version,hash:pointer.hash})).digest('hex');if(pointer.signature!==pointerSignature||readdirSync(dir).some(file=>/^v[1-9][0-9]*\.json$/.test(file)&&Number(file.slice(1,-5))>pointer.version))throw new Error('Staffing activation pointer changed or rolled back');const c=JSON.parse(this.read(join(dir,`v${pointer.version}.json`))) as StaffingConfig;
 withNodes(c,['schema','algorithm','project','workflow','roles','review','version','previous','approval','hash','signature']);const{version,previous,approval,hash,signature,...draft}=c;validateStaffingDraft(draft);integer(version);if(previous!==null)digest(previous);keys(approval,['run','card','answerSeq']);text(approval.run);text(approval.card);integer(approval.answerSeq);digest(hash);digest(signature);
 const expected=createHmac('sha256',ledgerKey(this.dataDir)).update(hash).digest('hex');if(staffingHash({...draft,version,previous,approval})!==hash||pointer.hash!==hash||pointer.version!==version||staffingHash(project)!==staffingHash(c.project)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error('Staffing approval verification failed');return c;
 }
}

/** Runtime staffing follows signed task authority; mutable params are only a creation input.
 * Engine event replay intentionally does not persist later params assignments. */
export function signedStaffingBinding(engine:import('../runtime/engine').Engine,run:any):string|null {
 const trusted=engine.trusted(run.id);
 if(!trusted.ok)throw new QueueRefusal('Staffing task history is untrusted');
 let current:string|null=null;
 for(const entry of trusted.entries.filter(e=>e.record==='staffing-start'||e.record==='staffing-upgrade')){
  const data=entry.data;
  if(data?.schema!==1||typeof data.config!=='string'||!/^[a-f0-9]{64}$/.test(data.config)||
    (entry.record==='staffing-upgrade'&&data.previous!==current))throw new QueueRefusal('Staffing task binding chain changed');
  current=data.config;
 }
 return current;
}
export function installStaffingGuard(engine:import('../runtime/engine').Engine,store:StaffingStore,resolveProject:(id:string)=>StaffingProject,verifyCapability?:(config:StaffingConfig)=>void){
 const applies=staffingApplies;
 // The role text agents receive now: Studio's versioned copy (what the Improve page shows and edits), else the source.
 function currentSkill(def:any,id:string){const source=engine.roleSkillText(def,id)?.text;if(typeof source!=='string'||!source.trim())throw new Error('Current workflow role skill is missing');return source;}
 // A round runs only with the role text the captain approved: a changed skill (a pack update, an adopted edit) refuses at round start until staffing is confirmed again.
 function pinnedSkill(def:any,id:string,pin:SkillPin){const text=currentSkill(def,id),sha=createHash('sha256').update(text).digest('hex');if(sha!==pin.sha256)throw new SkillChanged(id,pin.sha256,sha);return text;}
 const sha=(t:string)=>createHash('sha256').update(t).digest('hex');
 /** A role's named skills as they are now (several skills only): each one's ref and sha256 of its source text. */
 function liveParts(def:any,id:string){const role=def.roles.find((r:any)=>r.id===id);return role?skillPartPins(role.skill,engine.deps.skillText):undefined;}
 /** The approved per-skill pins differ from the named skills now (a part's text changed, or a pin is missing). */
 const partsDiffer=(def:any,id:string,pinned:StaffingRole)=>staffingHash(liveParts(def,id)??null)!==staffingHash(pinned.skills??null);
 /** The one check every approved skill list goes through (a role's named skills, a node's library skills): the same refs in order, and the
  *  first pin whose live sha256 differs (null: all match). Mismatched refs are a policy change, never a skill change. */
 function pinMoved(pinned:SkillPin[]|undefined,live:{ref:string;sha256:string}[]|undefined){
  if(!!pinned!==!!live||pinned&&(pinned.length!==live!.length||pinned.some((p,i)=>p.ref!==live![i].ref)))throw new Error('Approved role skill differs from workflow policy');
  const i=pinned?.findIndex((p,k)=>p.sha256!==live![k].sha256)??-1;return i>=0?{pinned:pinned![i],live:live![i]}:null;}
 /** A node's approved library skills as the library holds them now (versions are immutable: a changed one was altered, not updated). */
 const liveNodePins=(pins:SkillPin[]|undefined)=>pins?.map(p=>{const info=engine.skillLibrary().pinInfo(p.ref.slice('skill:'.length),p.version);return{ref:p.ref,sha256:info?.sha256??''};});
 /** A task's approved staffing that differs from what runs now only in role skill text: which roles changed, and whether a newer approval already covers the new text (rebind only). */
 function skillDrift(def:any,params:Record<string,string>){
  const project=def.kind==='coffee-kit'?coffeeStaffingProject(params.project):resolveProject(params.project),current=store.current(project),binding=params._staffing;
  const bound=binding===current.hash?current:typeof binding==='string'&&/^[a-f0-9]{64}$/.test(binding)?store.byHash(project,binding):null;if(!bound)return null;
  if([current,bound].some(c=>c.workflow.id!==def.id||c.workflow.version!==def.version||c.workflow.sha256!==staffingHash(def)))return null;
  // only the skill pins may differ: providers, models, efforts, refs, review and project stay as approved
  const strip=(c:StaffingConfig)=>({project:c.project,review:c.review,nodes:c.nodes??null,roles:Object.fromEntries(Object.entries(c.roles).map(([id,r])=>[id,{provider:r.provider,model:r.model,effort:r.effort,ref:r.skill.ref}]))});
  if(staffingHash(strip(bound))!==staffingHash(strip(current)))return null;
  const live:Record<string,{text:string;version:number}>={};for(const id of Object.keys(bound.roles)){const t=engine.roleSkillText(def,id);if(!t?.text?.trim())return null;live[id]={text:t.text,version:t.version??1};}
  const changed=Object.keys(bound.roles).filter(id=>sha(live[id].text)!==bound.roles[id].skill.sha256||partsDiffer(def,id,bound.roles[id]));if(!changed.length)return null;
  return{def,project,current,bound,binding,live,changed,rebind:current.hash!==binding&&Object.keys(current.roles).every(id=>sha(live[id].text)===current.roles[id].skill.sha256&&!partsDiffer(def,id,current.roles[id]))};
 }
 function verifyStored(def:any,params:Record<string,string>){
  const project=def.kind==='coffee-kit'?coffeeStaffingProject(params.project):resolveProject(params.project);const config=store.current(project);
  // a newer approval that only re-pinned role skills (another task approved the new text): this task's own skill is what changed
  if(params._staffing&&params._staffing!==config.hash){const d=(()=>{try{return skillDrift(def,params)}catch{return null}})();if(d){const id=d.changed[0];throw new SkillChanged(id,d.bound.roles[id].skill.sha256,sha(d.live[id].text));}}
  if(params._staffing!==config.hash||config.workflow.id!==def.id||config.workflow.version!==def.version||config.workflow.sha256!==staffingHash(def))throw new Error('Staffing approval missing or changed; confirm project role configuration / 派工配置尚未核准或已變更，請確認各角色配置');
  // node overrides: what the captain approved is what the definition asks for (an approval from before node overrides covers a definition without provider, model or effort overrides; its node skills are bound by the definition hash)
  const wanted=staffingNodeOverrides(def);
  if(Object.hasOwn(config,'nodes')?staffingHash(config.nodes)!==staffingHash(wanted??null):Object.values(wanted??{}).some(pickOverride))throw new Error('Approved node overrides differ from the workflow; confirm staffing again / 已核准的節點設定與流程不同，請重新確認派工配置');
  const required=def.roles.map((r:any)=>r.id);
  if(required.some((id:string)=>!config.roles[id]))throw new Error('Approve every workflow role before dispatch');
  for(const[id,pick]of Object.entries(config.roles)){const role=def.roles.find((r:any)=>r.id===id);if(!role||role.skill!==staffingSkillRef(def,id)||role.skill!==pick.skill.ref)throw new Error('Approved role skill differs from workflow policy');pinnedSkill(def,id,pick.skill);
   // a role with several named skills: each skill's text is the one approved for it
   const moved=pinMoved(pick.skills,liveParts(def,id));if(moved)throw new SkillChanged(id,moved.pinned.sha256,moved.live.sha256);}
  // a node's library skills: the same pin check; a library version never changes, so a mismatch is refused, not offered for approval
  for(const[id,n]of Object.entries(config.nodes??{})){if(!n.skills)continue;const moved=pinMoved(n.skills,liveNodePins(n.skills));if(moved)throw new Error(`Node ${id} skill ${moved.pinned.ref} v${moved.pinned.version} no longer has its approved hash in the skill library`);}
  return config;
 }
 function verified(def:any,params:Record<string,string>){try{return verifyStored(def,params)}catch(error){const refusal=new QueueRefusal('Staffing approval requires confirmation: '+String((error as any)?.message??error));if(error instanceof SkillChanged)(refusal as any).failure=failure('env.skill-changed',error.message,{source:'staffing'});throw refusal;}}
 const previousStart=engine.deps.authorizeStart;
 engine.deps.authorizeStart=(def:any,o:any)=>{previousStart?.(def,o);if(applies(def)){const config=verified(def,o.params??{});verifyCapability?.(config);}};
 const previousInitialize=engine.deps.initializeRun;
 engine.deps.initializeRun=(run:any)=>{previousInitialize?.(run);if(applies(run.def)){const c=verified(run.def,run.params),node=run.def.nodes[0];engine.record(engine.x(run,node,run.nodes[node.id]),'staffing-start',{data:{schema:1,config:c.hash,project:staffingHash(c.project),definition:c.workflow.sha256}});}};
 // staffingUnapproved: no signed staffing for this Task yet (the readiness gate shows it as the captain's Run-time step, not a broken brief)
 function verifyRun(run:any){const binding=signedStaffingBinding(engine,run);if(!binding)throw Object.assign(new QueueRefusal('Historical or changed staffing lacks task approval; propose an explicit configuration upgrade / 舊任務或已變更配置缺少任務核准，請提出配置升級'),{staffingUnapproved:true});return verified(run.def,{...run.params,_staffing:binding});}
 const previousAnswer=engine.deps.authorizeAnswer;engine.deps.authorizeAnswer=(run:any,card:any,answer:any)=>{previousAnswer?.(run,card,answer);if(applies(run?.def)&&((card.kind==='scope'&&answer.choice==='retry')||(card.kind==='dispatch'&&answer.choice==='dispatch'))){try{verifyRun(run);}catch(error){/* a role skill change is shown again on a fresh card at round start, with its current diff */if(!(card.kind==='scope'&&(error as any)?.failure?.code==='env.skill-changed'))throw error;}}if(applies(run?.def)&&answer.choice==='approve-skill'){if(!/^captain\b/i.test(String(answer.by??'')))throw new Error('Only the captain approves a role skill change');approvedDrift(run,run.nodes[card.node]);}};
 // The readiness card's way out of env.skill-changed: the captain sees the change (approved pin → new text) and approves it with one click.
 // Only the changed skill pins are replaced (a new staffing version; providers, models and efforts unchanged), the task is rebound, and the round is prepared again.
 const SKILL_ACTION='approve-skill';
 function driftOf(run:any){const binding=signedStaffingBinding(engine,run);return binding?skillDrift(run.def,{...run.params,_staffing:binding}):null;}
 /** What the card showed: per changed role, the approved pin and the exact new text's sha256. */
 const shownOf=(d:any)=>d.changed.map((id:string)=>{const parts=liveParts(d.def,id);return{role:id,from:d.bound.roles[id].skill.sha256,to:sha(d.live[id].text),...(parts?{parts:parts.map(p=>p.sha256)}:{})};});
 /** The change the captain approves must be exactly the change the card showed: same roles, same approved pins, same new text. */
 function approvedDrift(run:any,rn:any){const shown=rn?.data?.nativeQueueCapability?.extraData?.skills,d=driftOf(run);
  if(!d||!Array.isArray(shown)||staffingHash(shownOf(d))!==staffingHash(shown))throw new QueueRefusal('Role skill approval is stale: the text changed after this card was shown');return d;}
 const previousRecovery=engine.deps.readinessRecovery;
 engine.deps.readinessRecovery=(x:any,typed:any)=>{if(!applies(x.run?.def)||typed?.code!=='env.skill-changed')return previousRecovery?.(x,typed)??null;const d=driftOf(x.run);if(!d)return null;
  const detail=d.changed.map((id:string)=>{const pin=d.bound.roles[id].skill;let before:string|null=null;try{before=store.skill(pin,d.project);}catch{}
   const parts=(d.bound.roles[id].skills??[]).map((p:SkillPin,i:number)=>{const now=liveParts(d.def,id)?.[i]?.sha256??'';return now===p.sha256?null:`  skill ${p.ref}: approved ${p.sha256.slice(0,12)} → now ${now.slice(0,12)}`;}).filter(Boolean);
   const head=`Role ${id} (${pin.ref}): approved v${pin.version} · ${pin.sha256.slice(0,12)} → now v${d.live[id].version} · ${sha(d.live[id].text).slice(0,12)}${parts.length?'\n'+parts.join('\n'):''}`;
   return before==null?`${head}\n(the approved text is not archived; the new text is in Improve → ${id})`:`${head}\n${unified(before,d.live[id].text,`${id}.md`).slice(0,6000)}`;}).join('\n\n');
  return{data:{skills:shownOf(d)},options:[{id:SKILL_ACTION,label:d.rebind?'Use the approved new role skill':'Approve new role skill',labelZh:d.rebind?'改用已核准的新角色技能':'核准新的角色技能'}],detail:`Role skill change / 角色技能變更:\n${detail}`};};
 const previousAction=engine.deps.readinessAction;
 engine.deps.readinessAction=(run:any,node:any,rn:any,card:any)=>{if(!applies(run?.def)||card.answer?.choice!==SKILL_ACTION)return previousAction?.(run,node,rn,card)??false;
  if(!card.captainOnly||!/^captain\b/i.test(String(card.answer?.by??'')))throw new Error('Only the captain approves a role skill change');const d=approvedDrift(run,rn);
  let approved:StaffingConfig=d.current;
  if(!d.rebind){const answer=engine.ledger(run.id).filter(e=>e.record==='card-answer'&&e.data?.card===card.id).at(-1);if(!answer)throw new Error('The captain answer is not recorded');
   const{version,previous,approval,hash,signature,...draft}=structuredClone(d.current);const sources:Record<string,string>={};
   for(const id of Object.keys(draft.roles)){const text=d.live[id].text;if(sha(text)===draft.roles[id].skill.sha256&&!partsDiffer(d.def,id,draft.roles[id]))continue;const parts=liveParts(d.def,id);draft.roles[id]={...draft.roles[id],skill:store.remember({ref:draft.roles[id].skill.ref,version:d.live[id].version,text}),...(parts?{skills:parts}:{})};sources[draft.roles[id].skill.ref]=text;}
   approved=store.approve(draft as StaffingDraft,d.current.hash,{run:run.id,card:card.id,answerSeq:answer.seq},sources);}
  run.params._staffing=approved.hash;
  engine.record(engine.x(run,node,rn),'staffing-upgrade',{actor:card.answer.by,data:{schema:1,config:approved.hash,previous:d.binding,card:card.id,node:node.id,visit:rn.visits,attempt:rn.attempt,head:run.ctx.head??null,reason:'role-skill',roles:d.changed}});
  return true;};
 const previousBinding=engine.deps.staffingBinding;engine.deps.staffingBinding=(run:any)=>applies(run?.def)?verifyRun(run).hash:previousBinding?.(run);
 const previousPick=engine.deps.approvedPick;
 engine.deps.approvedPick=(run:any,node:any,roleOverride?:string)=>{if(!applies(run?.def))return previousPick?.(run,node,roleOverride);const c=verifyRun(run),id=roleOverride??node.role??node.args?.role;const pick=effectivePick(c,run.def,node,id);if(!pick)throw new Error('Approved agent role is missing');return pick;};
 // the named skills a node loads come from the approved configuration when it overrides them (verified by version and hash when loaded)
 const previousPins=engine.deps.approvedNodePins;
 engine.deps.approvedNodePins=(run:any,node:any)=>{if(!applies(run?.def))return previousPins?.(run,node);const skills=verifyRun(run).nodes?.[node.id]?.skills;return skills?skills.map(p=>({id:p.ref.slice('skill:'.length),v:p.version,sha256:p.sha256})):undefined;};
 const previousSkill=engine.deps.approvedSkill;
 engine.deps.approvedSkill=(run:any,id:string)=>{if(!applies(run?.def))return previousSkill?.(run,id);const c=verifyRun(run);if(!c.roles[id])throw new Error('Approved native role skill is missing');return currentSkill(run.def,id);};
 const previousChange=engine.deps.authorizePickChange;
 engine.deps.authorizePickChange=(run:any,node:any,pick:any)=>{previousChange?.(run,node,pick);if(applies(run?.def)){const c=verifyRun(run),r=effectivePick(c,run.def,node,node.role??node.args?.role);if(!r||staffingHash({provider:r.provider,model:r.model,effort:r.effort})!==staffingHash({provider:pick.provider,model:pick.model,effort:pick.effort??null}))throw new Error('Changing staffing requires a fresh captain configuration and explicit reprepare');}};
 // Opaque per-job intent: the model cannot synthesize this from ledger/public facts.
 const jobReceipts=new WeakMap<object,{x:any;config:string;role:string;hash:string;node:string;visit:number;attempt:number;head:string|null;used:boolean}>();
 const previousReceipt=engine.deps.instructionReceipt;
 engine.deps.instructionReceipt=(x:any,id:string,system:string,provider:any)=>{const prior=previousReceipt?.(x,id,system,provider);if(!applies(x.run?.def))return prior;const c=verifyRun(x.run),r=effectivePick(c,x.run.def,x.node,id);if(!r||provider.id!==r.provider||provider.model!==r.model||(provider.reasoningEffort??null)!==r.effort||!system.includes(currentSkill(x.run.def,id)))throw new Error('Actual provider instructions or role selection differ from approved staffing');const hash=createHash('sha256').update(system).digest('hex');engine.record(x,'staffing-instructions',{data:{schema:1,config:c.hash,role:id,skill:createHash('sha256').update(currentSkill(x.run.def,id)).digest('hex'),instructionsSha256:hash,provider:r.provider,model:r.model,effort:r.effort,node:x.node.id,visit:x.visit,attempt:x.rn.attempt,head:x.ctx.head??null}});const token=Object.freeze({});jobReceipts.set(token,{x,config:c.hash,role:id,hash,node:x.node.id,visit:x.visit,attempt:x.rn.attempt,head:x.ctx.head??null,used:false});return token;};
 const previousJob=engine.deps.authorizeProviderJob;
 engine.deps.authorizeProviderJob=(run:any,provider:any,o:any,phase:'before'|'launch')=>{previousJob?.(run,provider,o,phase);if(!applies(run?.def))return;
  const pin=o.admissionReceipt&&jobReceipts.get(o.admissionReceipt);if(!pin||pin.used||o.ref!==run.id||pin.x.run!==run||!engine.owns(pin.x)||pin.node!==pin.x.node.id||pin.visit!==pin.x.rn.visits||pin.attempt!==pin.x.rn.attempt||pin.head!==(run.ctx.head??null))throw new QueueRefusal('Native job staffing/owner receipt is missing, changed or consumed');
  const c=verifyRun(run),role=effectivePick(c,run.def,pin.x.node,pin.role);if(c.hash!==pin.config||!role||provider.id!==role.provider||provider.model!==role.model||(provider.reasoningEffort??null)!==role.effort||!o.rules||createHash('sha256').update(jobInstructions(o.system,o.rules)).digest('hex')!==pin.hash)throw new QueueRefusal('Queued job configuration, role or actual instructions changed; confirm fresh staffing');
  if(phase==='launch')pin.used=true;
 };

 return{applies,verified};
}

/** The live role text no longer matches the sha256 the captain approved for that role. */
export class SkillChanged extends Error{constructor(readonly role:string,readonly approved:string,readonly current:string){super(`Role skill ${role} changed since staffing approval (approved ${approved.slice(0,12)}, now ${current.slice(0,12)}); re-confirm staffing to approve the new text / 角色 ${role} 的技能在派工核准後已變更，請重新確認派工配置`);}}
export type StaffingInterview={schema:1;project:StaffingProject;workflow:{id:string;version:number;sha256:string};roles:string[];choices:Record<string,{provider?:string;model?:string;effort?:string|null}>;round:number;lastTurn:string|null};
export function staffingFrontier(interview:StaffingInterview){return interview.roles.flatMap(role=>{const choice=interview.choices[role]??{};return[{role,field:!choice.provider?'provider':!choice.model?'model':!Object.hasOwn(choice,'effort')?'effort':null}].filter(q=>q.field!==null);});}
