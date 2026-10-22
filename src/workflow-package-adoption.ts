/** Local-only adoption. Publication is recoverable, never an imported authority. */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,rmSync,renameSync,unlinkSync,rmdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {adoptionProfile} from './workflow-package-profile';
import {packageSha,packageStoredBytes} from './workflow-package';
import {inspectAdoptionSkill} from './skills';
import {validate,type WorkflowDefs,type WDef} from './runtime/defs';
import {ledgerKey} from './runtime/checks';
import {takeOwnerLock,LockLost,type HeldLock} from './owner-lock';
const txnPattern=/^import-[a-f0-9]{24}$/;
/** An adoption waits this long for another process's adoption or recovery to finish. */
const ADOPT_WAIT_MS=30_000;
/** The ledger key signs other records too; the purpose prefix keeps an adoption journal signature from being valid anywhere else. */
const SIGN_PURPOSE='crew-workflow-adoption-v1\0';
const OWNER='package-owner.json';
type File={path:string;sha256:string};
type Plan={schema:1;txn:string;workflow:string;archiveSha256:string;files:File[];roots:string[]};
export type AdoptionHold={txn:string;reason:string;at:string|null};
type State='complete'|'rolled-back'|'held'|'staging';
const safe=(p:string)=>p.split('/').every(x=>/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(x)&&x!=='.'&&x!=='..');
const present=(p:string)=>{try{lstatSync(p);return true;}catch(e:any){if(e?.code==='ENOENT')return false;throw e;}};
const walk=(dir:string,prefix=''):string[]=>readdirSync(join(dir,prefix)).sort().flatMap(name=>{const p=prefix?prefix+'/'+name:name,s=lstatSync(join(dir,p));if(s.isSymbolicLink()||!s.isDirectory()&&!s.isFile())throw Error('Adoption recovery refuses changed object');return s.isDirectory()?walk(dir,p):[p];});
export class WorkflowAdoption{
 readonly root:string;
 private held:HeldLock|null=null;
 constructor(readonly data:string,private fault:(point:string)=>void=()=>{}){this.root=join(data,'workflow-adoptions');this.recover();}
 /** Every step refreshes the adoption lock, so a contender never mistakes a slow adoption for a dead one, and stops if the lock was lost. */
 private step(point:string){this.held?.refresh();this.fault(point);this.held?.refresh();}
 private sign(plan:Plan){return createHmac('sha256',ledgerKey(this.data)).update(SIGN_PURPOSE+JSON.stringify(plan)).digest('hex');}
 private journal(id:string){const v=JSON.parse(packageStoredBytes(this.data,`workflow-adoptions/${id}/journal.json`).toString('utf8'));if(!txnPattern.test(id)||v.plan?.txn!==id||typeof v.sig!=='string'||!/^([a-f0-9]{64})$/.test(v.sig)||!timingSafeEqual(Buffer.from(v.sig,'hex'),Buffer.from(this.sign(v.plan),'hex')))throw Error('Adoption journal signature mismatch');return v.plan as Plan;}
 /** Error text for logs, holds and the UI without the absolute data folder path. */
 text(e:any){return String(e?.message??e).split(this.data+'/').join('').split(this.data).join('<data>');}
 /** Best effort: staging copies are not needed once a transaction is settled; journal, source ZIP and markers stay. */
 private tidy(dir:string){try{for(const n of readdirSync(dir))if(n==='out'||/^skill-[0-9]+$/.test(n))rmSync(join(dir,n),{recursive:true,force:true});}catch(e:any){console.error(`workflow adoption: could not tidy staging: ${this.text(e)}`);}}
 private published(plan:Plan){return [OWNER,'v1.json'].every(name=>{const path=`workflows/${plan.workflow}/${name}`,want=plan.files.find(f=>f.path===path)?.sha256;try{return !!want&&packageSha(packageStoredBytes(this.data,path))===want;}catch{return false;}});}
 /** A template copy keeps origin.transaction and pins the imported skills, so a workflow carrying it means the skills must stay. Read-only: a wrong answer can only keep files. */
 private pinnedBy(txn:string){let ids:string[];try{ids=readdirSync(join(this.data,'workflows'));}catch{return false;}return ids.some(w=>{try{return readdirSync(join(this.data,'workflows',w)).some(f=>/^v[0-9]+\.json$/.test(f)&&JSON.parse(readFileSync(join(this.data,'workflows',w,f),'utf8'))?.origin?.transaction===txn);}catch{return false;}});}
 private complete(plan:Plan){return plan.files.every(f=>{try{return packageSha(packageStoredBytes(this.data,f.path))===f.sha256;}catch{return false;}});}
 /** Runs before WorkflowDefs/catalog creation and never throws: a transaction it cannot settle is held and logged, and Studio still starts. */
 /** Boot never waits for the lock: if another process holds it, recovery runs at the next adoption instead. */
 recover(){try{if(!existsSync(this.root))return;const lock=takeOwnerLock(this.root,'adopt',{waitMs:0});if(!lock){console.error('workflow adoption: another adoption or recovery is running on this data folder; recovery will run at the next adoption');return;}this.held=lock;try{this.recoverAll();}finally{this.held=null;lock.release();}}catch(e:any){console.error(`workflow adoption: recovery skipped: ${this.text(e)}`);}}
 private recoverAll(){let ids:string[];try{ids=readdirSync(this.root).filter(x=>txnPattern.test(x));}catch(e:any){console.error(`workflow adoption: cannot list transactions: ${this.text(e)}`);return;}for(const id of ids){this.held?.refresh();this.settle(id);}}
 private settle(id:string):State{
  const dir=join(this.root,id);
  try{
   if(existsSync(join(dir,'complete')))return 'complete';if(existsSync(join(dir,'rolled-back')))return 'rolled-back';if(present(join(dir,'recovery-hold.json')))return 'held';
   // no journal means nothing was published yet: the folder is an interrupted staging area
   if(!existsSync(join(dir,'journal.json'))){rmSync(dir,{recursive:true,force:true});return 'rolled-back';}
   return this.recoverOne(id,dir);
  }catch(e:any){
   const reason=this.text(e);console.error(`workflow adoption ${id}: recovery held: ${reason}`);
   try{writeFileSync(join(dir,'recovery-hold.json'),JSON.stringify({txn:id,reason,at:new Date().toISOString()}),{flag:'wx',mode:0o600});}catch(w:any){console.error(`workflow adoption ${id}: could not record the hold: ${this.text(w)}`);}
   return 'held';
  }
 }
 /** Held transactions for the saved-packages view. A missing or malformed record never throws. */
 holds():AdoptionHold[]{
  let ids:string[];try{ids=readdirSync(this.root).filter(x=>txnPattern.test(x));}catch{return [];}
  return ids.flatMap(txn=>{try{if(!present(join(this.root,txn,'recovery-hold.json')))return [];}catch{}try{const v=JSON.parse(packageStoredBytes(this.data,`workflow-adoptions/${txn}/recovery-hold.json`,65536).toString('utf8'));return [{txn,reason:typeof v?.reason==='string'?v.reason.slice(0,500):'Unreadable recovery hold record',at:typeof v?.at==='string'?v.at.slice(0,40):null}];}catch{return [{txn,reason:'Unreadable recovery hold record',at:null}];}});
 }
 private recoverOne(id:string,dir:string):State{const p=this.journal(id);if(p.schema!==1||!/^imp-[a-f0-9]{24}$/.test(p.workflow)||p.roots.some(r=>!safe(r)||!(r===`workflows/${p.workflow}`||/^skills\/_library\/imp-[a-f0-9]{12}-s[0-9]+$/.test(r)))||p.files.some(f=>!safe(f.path)||!p.roots.some(r=>f.path.startsWith(r+'/'))))throw Error('Invalid adoption journal ownership');
  // everything is published and intact: the workflow exists, so a failed marker or cleanup write must not turn it into a hold
  // the workflow folder is published last, whole, by rename: if it is present with our owner file, publication finished and nothing may be deleted, even after later local edits or a hand-removed skill folder
  if(this.complete(p)||this.published(p)||this.pinnedBy(id)){try{writeFileSync(join(dir,'complete'),p.archiveSha256,{flag:'wx',mode:0o600});}catch(e:any){if(e?.code!=='EEXIST')console.error(`workflow adoption ${id}: published, but the complete marker could not be written: ${this.text(e)}`);}this.tidy(dir);return 'complete';}
  const expected=new Map(p.files.map(f=>[f.path,f.sha256])),owned:[string,string[]][]=[];
  for(const root of p.roots){const target=join(this.data,root);if(!present(target))continue;const st=lstatSync(target);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Changed adoption target; manual recovery required');const marker=root+'/'+OWNER;if(!existsSync(join(this.data,marker))||packageSha(packageStoredBytes(this.data,marker))!==expected.get(marker))throw Error('Unowned adoption target; manual recovery required');const files=walk(target);for(const file of files){const rel=root+'/'+file;if(expected.get(rel)!==packageSha(packageStoredBytes(this.data,rel)))throw Error('Changed adoption bytes; manual recovery required');}owned.push([root,files]);}
  for(const [root,files]of owned.reverse())this.removeOwned(root,files);
  rmSync(join(dir,'out'),{recursive:true,force:true});this.tidy(dir);writeFileSync(join(dir,'rolled-back'),p.archiveSha256,{flag:'wx',mode:0o600});return 'rolled-back';
 }
 /** Unlink only verified files, then their folders deepest first; the owner marker goes last so an interrupted removal is still recognised. rmdir fails, holding the transaction, if anything unexpected remains. */
 private removeOwned(root:string,files:string[]){
  const base=join(this.data,root),dirs=new Set<string>();for(const f of files)if(f!==OWNER){unlinkSync(join(base,f));for(let d=dirname(f);d!=='.';d=dirname(d))dirs.add(d);}
  for(const d of [...dirs].sort((a,b)=>b.split('/').length-a.split('/').length))rmdirSync(join(base,d));
  if(files.includes(OWNER))unlinkSync(join(base,OWNER));rmdirSync(base);
 }
 /** One adoption or recovery at a time per data folder, across processes; the lock is broken only when its owner process is gone. */
 adopt(bytes:Buffer,sourceId:string,defs:WorkflowDefs,capabilities:{ready:boolean;accept:boolean}){mkdirSync(this.root,{recursive:true,mode:0o700});const lock=takeOwnerLock(this.root,'adopt',{waitMs:ADOPT_WAIT_MS});if(!lock)throw Error('Another package adoption is running on this data folder; try again shortly');this.held=lock;try{return this.adoptLocked(bytes,sourceId,defs,capabilities);}finally{this.held=null;lock.release();}}
 private adoptLocked(bytes:Buffer,sourceId:string,defs:WorkflowDefs,capabilities:{ready:boolean;accept:boolean}){
 this.recoverAll();if(!/^pkg-[a-f0-9]{24}$/.test(sourceId))throw Error('Save the package before adoption');
 const parsed=adoptionProfile(bytes,capabilities),txn='import-'+randomBytes(12).toString('hex'),suffix=txn.slice(7),id='imp-'+suffix,stage=join(this.root,txn),out=join(stage,'out'),namespace=suffix.slice(0,12);
 const result={workflow:id,version:1,href:`#/workflows/${id}`,status:'saved-no-task',profile:parsed.profile};
 mkdirSync(this.root,{recursive:true,mode:0o700});mkdirSync(stage,{mode:0o700});
 const outputs=new Map<string,Buffer>(),pinMap=new Map<string,any>(),roots:string[]=[];let journaled=false;
 try{
 writeFileSync(join(stage,'source.zip'),bytes,{flag:'wx',mode:0o600});
 for(const [i,pin]of parsed.pins.entries()){
  this.held?.refresh();const fresh=`imp-${namespace}-s${i}`,prefix=`skills/${pin.id}/v${pin.v}/`,folder=join(stage,`skill-${i}`);mkdirSync(folder,{mode:0o700});const files:string[]=[];
  const skill=parsed.value.files.get(prefix+'SKILL.md');if(!skill||packageSha(skill)!==pin.sha256)throw Error('Missing exact skill text bytes');writeFileSync(join(folder,'SKILL.md'),skill,{flag:'wx',mode:0o600});
  for(const [p,b]of parsed.value.files)if(p.startsWith(prefix+'files/')){const rel=p.slice((prefix+'files/').length);if(!safe(rel))throw Error('Invalid skill support path');const file=join(folder,'files',rel);mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,b,{flag:'wx',mode:0o600});files.push(rel);}
  const rec=inspectAdoptionSkill(folder,fresh,files,`workflow-package:${parsed.value.sha256}`);if(rec.sha256!==pin.sha256||rec.filesSha256!==pin.filesSha256)throw Error('Skill P1 would change packaged bytes');
  const root=`skills/_library/${fresh}`;roots.push(root);outputs.set(root+'/v1/SKILL.md',skill);for(const p of files)outputs.set(root+'/v1/files/'+p,readFileSync(join(folder,'files',p)));outputs.set(root+'/index.json',Buffer.from(JSON.stringify([rec],null,1)));pinMap.set(`${pin.id}@v${pin.v}`,{id:fresh,v:1,sha256:rec.sha256,filesSha256:rec.filesSha256,bytes:rec.bytes,ignored:rec.ignored,latest:1});
 }
 const def:WDef={...structuredClone(parsed.definition),id,version:1,parent:null,createdAt:new Date().toISOString(),by:'captain (package adoption)',note:'Imported package; local approvals are separate',diff:null,seed:null,origin:{schema:1,source:'package-import',package:{id:sourceId,archiveSha256:parsed.value.sha256,sourceWorkflow:parsed.definition.id,sourceVersion:parsed.definition.version,declarationSha256:packageSha(parsed.value.files.get('workflow/definition.json')!)},transaction:txn} as any};
 for(const node of def.nodes)if(node.skills)node.skills=node.skills.map(p=>{const next=pinMap.get(`${p.id}@v${p.v}`);if(!next)throw Error('Unresolved imported skill pin');return {id:next.id,v:1,sha256:next.sha256,filesSha256:next.filesSha256};});
 const localInfo=(skill:string,v:number)=>[...pinMap.values()].find(p=>p.id===skill&&v===1)??null;
 const errors=validate(def,defs.known,defs.runners?.(),localInfo).filter(p=>p.level==='error');if(errors.length)throw Error(errors[0].text);
 roots.push(`workflows/${id}`);outputs.set(`workflows/${id}/v1.json`,Buffer.from(JSON.stringify(def,null,1)));
 for(const root of roots)outputs.set(root+'/'+OWNER,Buffer.from(JSON.stringify({txn,nonce:randomBytes(24).toString('hex')})));
 if(roots.some(root=>present(join(this.data,root))))throw Error('Fresh adoption namespace already exists');
 const plan:Plan={schema:1,txn,workflow:id,archiveSha256:parsed.value.sha256,files:[...outputs].map(([path,b])=>({path,sha256:packageSha(b)})),roots};writeFileSync(join(stage,'journal.json'),JSON.stringify({plan,sig:this.sign(plan)}),{flag:'wx',mode:0o600});journaled=true;this.step('journal');
 // Each folder is built whole inside this transaction's staging (same data filesystem), then published by one rename: a crash leaves no folder or a complete one, never a partial file.
 mkdirSync(out,{mode:0o700});
 for(const [i,root]of roots.entries())for(const [p,b]of outputs)if(p.startsWith(root+'/')){const file=join(out,String(i),p.slice(root.length+1));mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,b,{flag:'wx',mode:0o600});this.step('stage:'+p);}
 for(const [i,root]of roots.entries()){const target=join(this.data,root);mkdirSync(dirname(target),{recursive:true,mode:0o700});if(present(target))throw Error('Fresh adoption namespace already exists');try{this.step('rename:'+root);renameSync(join(out,String(i)),target);}catch(e:any){if(e?.code==='EXDEV')throw Error('Cannot publish: the workflows and skills folders must be on the same filesystem as the data folder');throw e;}this.step('publish:'+root);}
 this.step('published');
 writeFileSync(join(stage,'complete'),parsed.value.sha256,{flag:'wx',mode:0o600});this.tidy(stage);return result;
 }catch(e){
  if(e instanceof LockLost)throw e;
  if(!journaled){rmSync(stage,{recursive:true,force:true});throw e;}
  // Settle only this transaction: everything published and intact means the workflow exists, so report success instead of inviting a duplicate retry.
  if(this.settle(txn)==='complete')return result;
  throw e;
 }
 }
}
