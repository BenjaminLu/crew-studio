// Source-owned staffing authority. Vendor settings and project repositories are never written.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,lstatSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {ledgerKey} from '../runtime/checks';
import {QueueRefusal} from '../runtime/queue';
import {jobInstructions} from '../operating-rules';
export function nativeStaffingSkillRef(role:string,workflow='code-firstmate'):string{
 const names:Record<string,string>=workflow==='coffee-kit'?{worker:'website','image-worker':'image',reviewer:'reviewer',designer:'designer'}:workflow==='code-firstmate'?{coordinator:'firstmate',worker:'worker',reviewer:'reviewer',designer:'designer'}:{};
 if(!Object.hasOwn(names,role))throw new Error('Unknown native staffing workflow or role');
 return workflow==='coffee-kit'?`pack:coffee-kit/skills/${names[role]}.md`:`pack:firstmate/skills/${names[role]}.md`;
}
/** Explicit artifact project names are a separate authority namespace from Git repositories. */
export function coffeeStaffingProject(id:string):StaffingProject{
 if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id))throw new Error('Choose an explicit coffee artifact project');
 return {namespace:'artifact',id,identity:'coffee-artifact-project-v1:'+staffingHash({namespace:'artifact',id})};
}
export type StaffingProject={namespace:'git'|'artifact';id:string;identity:string};
export type SkillPin={ref:string;version:number;sha256:string;snapshotSha256:string};
export type StaffingRole={provider:'codex'|'claude';model:string;effort:string|null;skill:SkillPin};
export type StaffingDraft={schema:1;algorithm:'sha256-canonical-v1';project:StaffingProject;workflow:{id:string;version:number;sha256:string};roles:Record<string,StaffingRole>;review:{freshContexts:number;distinctProviders:boolean}};
export type StaffingConfig=StaffingDraft&{version:number;previous:string|null;approval:{run:string;card:string;answerSeq:number};hash:string;signature:string};
function plain(x:any){return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function keys(x:any,expected:string[]){if(!plain(x)||Object.keys(x).sort().join('|')!==[...expected].sort().join('|'))throw new Error('Staffing schema keys differ');}
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
function validateProject(x:StaffingProject){keys(x,['namespace','id','identity']);if(!['git','artifact'].includes(x.namespace))throw new Error('Unknown project namespace');text(x.id);text(x.identity,2000);}
export function validateStaffingDraft(x:StaffingDraft):void{
 keys(x,['schema','algorithm','project','workflow','roles','review']);if(x.schema!==1||x.algorithm!=='sha256-canonical-v1')throw new Error('Unsupported staffing schema');validateProject(x.project);
 keys(x.workflow,['id','version','sha256']);text(x.workflow.id);integer(x.workflow.version);digest(x.workflow.sha256);
 if(!plain(x.roles)||!Object.keys(x.roles).length||Object.keys(x.roles).length>12)throw new Error('Staffing roles are missing or excessive');
 for(const[id,r]of Object.entries(x.roles)){if(!/^[a-z][a-z0-9-]{0,39}$/.test(id))throw new Error('Malformed role');keys(r,['provider','model','effort','skill']);if(!['codex','claude'].includes(r.provider))throw new Error('Unsupported staffing provider');text(r.model);if(r.effort!==null)text(r.effort,40);if(r.provider==='codex'&&!r.effort)throw new Error('Choose Codex effort explicitly');keys(r.skill,['ref','version','sha256','snapshotSha256']);text(r.skill.ref);integer(r.skill.version);digest(r.skill.sha256);digest(r.skill.snapshotSha256);if(r.skill.sha256!==r.skill.snapshotSha256)throw new Error('Skill snapshot differs');}
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
 skill(pin:SkillPin,project?:StaffingProject){if(!project){const pending=this.pendingSkills.get(pin.sha256);if(pending!==undefined)return pending;throw new Error('Project identity required for skill');}const body=this.read(this.snapshotPath(project,pin.sha256));if(createHash('sha256').update(body).digest('hex')!==pin.sha256)throw new Error('Approved skill changed');return body;}
 current(project:StaffingProject):StaffingConfig{
 const dir=this.dir(project),pointer=JSON.parse(this.read(join(dir,'current.json')));keys(pointer,['schema','version','hash','signature']);if(pointer.schema!==1)throw new Error('Unknown staffing pointer schema');integer(pointer.version);digest(pointer.hash);digest(pointer.signature);const pointerSignature=createHmac('sha256',ledgerKey(this.dataDir)).update(staffingHash({project:this.key(project),version:pointer.version,hash:pointer.hash})).digest('hex');if(pointer.signature!==pointerSignature||readdirSync(dir).some(file=>/^v[1-9][0-9]*\.json$/.test(file)&&Number(file.slice(1,-5))>pointer.version))throw new Error('Staffing activation pointer changed or rolled back');const c=JSON.parse(this.read(join(dir,`v${pointer.version}.json`))) as StaffingConfig;
 keys(c,['schema','algorithm','project','workflow','roles','review','version','previous','approval','hash','signature']);const{version,previous,approval,hash,signature,...draft}=c;validateStaffingDraft(draft);integer(version);if(previous!==null)digest(previous);keys(approval,['run','card','answerSeq']);text(approval.run);text(approval.card);integer(approval.answerSeq);digest(hash);digest(signature);
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
 const applies=(def:any)=>def?.id==='code-firstmate'||def?.kind==='coffee-kit';
 function currentSkill(def:any,id:string){const role=def.roles.find((r:any)=>r.id===id);const source=role&&engine.deps.skillText(role.skill);if(typeof source!=='string'||!source.trim())throw new Error('Current workflow role skill is missing');return source;}
 function verifyStored(def:any,params:Record<string,string>){
  const project=def.kind==='coffee-kit'?coffeeStaffingProject(params.project):resolveProject(params.project);const config=store.current(project);
  if(params._staffing!==config.hash||config.workflow.id!==def.id||config.workflow.version!==def.version||config.workflow.sha256!==staffingHash(def))throw new Error('Staffing approval missing or changed; confirm project role configuration / 派工配置尚未核准或已變更，請確認各角色配置');
  const required=def.roles.map((r:any)=>r.id);
  if(required.some((id:string)=>!config.roles[id]))throw new Error('Approve every workflow role before dispatch');
  for(const[id,pick]of Object.entries(config.roles)){const role=def.roles.find((r:any)=>r.id===id);if(!role||role.skill!==nativeStaffingSkillRef(id,def.kind==='coffee-kit'?'coffee-kit':def.id)||role.skill!==pick.skill.ref)throw new Error('Approved role skill differs from workflow policy');currentSkill(def,id);}
  return config;
 }
 function verified(def:any,params:Record<string,string>){try{return verifyStored(def,params)}catch(error){throw new QueueRefusal('Staffing approval requires confirmation: '+String((error as any)?.message??error));}}
 const previousStart=engine.deps.authorizeStart;
 engine.deps.authorizeStart=(def:any,o:any)=>{previousStart?.(def,o);if(applies(def)){const config=verified(def,o.params??{});verifyCapability?.(config);}};
 const previousInitialize=engine.deps.initializeRun;
 engine.deps.initializeRun=(run:any)=>{previousInitialize?.(run);if(applies(run.def)){const c=verified(run.def,run.params),node=run.def.nodes[0];engine.record(engine.x(run,node,run.nodes[node.id]),'staffing-start',{data:{schema:1,config:c.hash,project:staffingHash(c.project),definition:c.workflow.sha256}});}};
 function verifyRun(run:any){const binding=signedStaffingBinding(engine,run);if(!binding)throw new QueueRefusal('Historical or changed staffing lacks task approval; propose an explicit configuration upgrade / 舊任務或已變更配置缺少任務核准，請提出配置升級');return verified(run.def,{...run.params,_staffing:binding});}
 const previousAnswer=engine.deps.authorizeAnswer;engine.deps.authorizeAnswer=(run:any,card:any,answer:any)=>{previousAnswer?.(run,card,answer);if(applies(run?.def)&&((card.kind==='scope'&&answer.choice==='retry')||(card.kind==='dispatch'&&answer.choice==='dispatch')))verifyRun(run);};
 const previousBinding=engine.deps.staffingBinding;engine.deps.staffingBinding=(run:any)=>applies(run?.def)?verifyRun(run).hash:previousBinding?.(run);
 const previousPick=engine.deps.approvedPick;
 engine.deps.approvedPick=(run:any,node:any,roleOverride?:string)=>{if(!applies(run?.def))return previousPick?.(run,node,roleOverride);const c=verifyRun(run),id=roleOverride??node.role??node.args?.role;const role=c.roles[id];if(!role)throw new Error('Approved agent role is missing');return{provider:role.provider,model:role.model,effort:role.effort};};
 const previousSkill=engine.deps.approvedSkill;
 engine.deps.approvedSkill=(run:any,id:string)=>{if(!applies(run?.def))return previousSkill?.(run,id);const c=verifyRun(run);if(!c.roles[id])throw new Error('Approved native role skill is missing');return currentSkill(run.def,id);};
 const previousChange=engine.deps.authorizePickChange;
 engine.deps.authorizePickChange=(run:any,node:any,pick:any)=>{previousChange?.(run,node,pick);if(applies(run?.def)){const c=verifyRun(run),r=c.roles[node.role??node.args?.role];if(!r||staffingHash({provider:r.provider,model:r.model,effort:r.effort})!==staffingHash({provider:pick.provider,model:pick.model,effort:pick.effort??null}))throw new Error('Changing staffing requires a fresh captain configuration and explicit reprepare');}};
 // Opaque per-job intent: the model cannot synthesize this from ledger/public facts.
 const jobReceipts=new WeakMap<object,{x:any;config:string;role:string;hash:string;node:string;visit:number;attempt:number;head:string|null;used:boolean}>();
 const previousReceipt=engine.deps.instructionReceipt;
 engine.deps.instructionReceipt=(x:any,id:string,system:string,provider:any)=>{const prior=previousReceipt?.(x,id,system,provider);if(!applies(x.run?.def))return prior;const c=verifyRun(x.run),r=c.roles[id];if(!r||provider.id!==r.provider||provider.model!==r.model||(provider.reasoningEffort??null)!==r.effort||!system.includes(currentSkill(x.run.def,id)))throw new Error('Actual provider instructions or role selection differ from approved staffing');const hash=createHash('sha256').update(system).digest('hex');engine.record(x,'staffing-instructions',{data:{schema:1,config:c.hash,role:id,skill:createHash('sha256').update(currentSkill(x.run.def,id)).digest('hex'),instructionsSha256:hash,provider:r.provider,model:r.model,effort:r.effort,node:x.node.id,visit:x.visit,attempt:x.rn.attempt,head:x.ctx.head??null}});const token=Object.freeze({});jobReceipts.set(token,{x,config:c.hash,role:id,hash,node:x.node.id,visit:x.visit,attempt:x.rn.attempt,head:x.ctx.head??null,used:false});return token;};
 const previousJob=engine.deps.authorizeProviderJob;
 engine.deps.authorizeProviderJob=(run:any,provider:any,o:any,phase:'before'|'launch')=>{previousJob?.(run,provider,o,phase);if(!applies(run?.def))return;
  const pin=o.admissionReceipt&&jobReceipts.get(o.admissionReceipt);if(!pin||pin.used||o.ref!==run.id||pin.x.run!==run||!engine.owns(pin.x)||pin.node!==pin.x.node.id||pin.visit!==pin.x.rn.visits||pin.attempt!==pin.x.rn.attempt||pin.head!==(run.ctx.head??null))throw new QueueRefusal('Native job staffing/owner receipt is missing, changed or consumed');
  const c=verifyRun(run),role=c.roles[pin.role];if(c.hash!==pin.config||!role||provider.id!==role.provider||provider.model!==role.model||(provider.reasoningEffort??null)!==role.effort||!o.rules||createHash('sha256').update(jobInstructions(o.system,o.rules)).digest('hex')!==pin.hash)throw new QueueRefusal('Queued job configuration, role or actual instructions changed; confirm fresh staffing');
  if(phase==='launch')pin.used=true;
 };

 return{applies,verified};
}

export type StaffingInterview={schema:1;project:StaffingProject;workflow:{id:string;version:number;sha256:string};roles:string[];choices:Record<string,{provider?:string;model?:string;effort?:string|null}>;round:number;lastTurn:string|null};
export function staffingFrontier(interview:StaffingInterview){return interview.roles.flatMap(role=>{const choice=interview.choices[role]??{};return[{role,field:!choice.provider?'provider':!choice.model?'model':!Object.hasOwn(choice,'effort')?'effort':null}].filter(q=>q.field!==null);});}
