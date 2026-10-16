import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Signed local recovery: real cards, native queue admissions and temporary git
// worktrees. Stub agents call the same token-authorized tools in process.
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {harness,suite,until,Y} from './rt-harness';
import {Projects} from '../src/doors';
import {installCode} from '../src/domain/code';
import {signedReservation} from '../src/domain/code-queue';
import {Engine} from '../src/runtime/engine';
import {Worktrees,patchEquivalentBase} from '../src/worktrees';
import {must} from '../src/git';
const {ok,end}=suite('code-rescope-preserve');
const rejects=(fn:()=>unknown)=>{try{fn();return false;}catch{return true;}};
process.env.CREW_TEST_IN_PROCESS='1';
const flow={id:'rescope-fixture',name:'Rescope fixture',version:1,roles:[{id:'coordinator',label:'Coordinator',skill:'test'},{id:'worker',label:'Worker',skill:'test'}],params:{project:{label:'Project'}},nodes:[
 {id:'prepare',kind:'hook',do:'repo.prepare',label:'Prepare',x:0,y:0},
 {id:'spec',kind:'agent',role:'coordinator',mode:'spec',retries:1,label:'Spec',x:1,y:0},
 {id:'dispatch',kind:'card',label:'Dispatch',args:{card_kind:'dispatch'},card:{title:'Dispatch',body:'Approve fixture',options:[{id:'dispatch',label:'Dispatch'},{id:'rescope',label:'Rescope'}]},x:2,y:0},
 {id:'build',kind:'agent',role:'worker',mode:'build',label:'Build',x:3,y:0},
 {id:'scope-card',kind:'card',label:'Scope',args:{card_kind:'scope'},card:{title:'Scope',body:'Rescope pristine task',captainOnly:true,options:[{id:'rescope',label:'Rescope',note:true},{id:'park',label:'Park'}]},x:4,y:0},
 {id:'merge',kind:'hook',do:'git.merge',label:'Merge',x:5,y:0},
 {id:'done',kind:'hook',label:'Done',x:6,y:0}],edges:[['prepare','spec'],['spec','dispatch'],['dispatch','build','dispatch'],['dispatch','spec','rescope'],['build','scope-card'],['scope-card','spec','rescope'],['scope-card','done','park'],['scope-card','merge','merge'],['merge','done']]};
async function fixture(){
 const H=await harness([Y(flow)]),E=H.engine,repo=join(H.data,'repo');mkdirSync(repo);assertTempRepo(repo);must(repo,['init','-q','-b','main']);writeFileSync(join(repo,'README.md'),'initial\n');must(repo,['add','README.md']);must(repo,['commit','-qm','Initial']);
 const projects=new Projects(H.data);projects.add({id:'fixture',path:repo});installCode(E,{dataDir:H.data,projects});E.policies.setProject('fixture',{install:false});
 const scopes=new Map<string,string>(),starts=new Map<string,number>();
 E.modes.spec.prompt=x=>`Run ${x.run.id} scope:${scopes.get(x.run.id)||'old.txt'}`;
 const provider:any={id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(text:string){
  const id=/Run (R-\d+)/.exec(text)?.[1]!;
  const call=async(name:string,args:any)=>{const v:any=await H.agents.callTool(ctx.token,name,args);if(v.error)throw new Error(v.error);return v;};
  if(tools.some(t=>t.name==='spec_write'))await call('spec_write',{title:'Local verification',what:'Verify a local file',why:['Exercise signed recovery'],done:['tests/code-rescope-recovery.ts fails on base'],scope:[/scope:([^\s]+)/.exec(text)?.[1]],door:{kind:'two-way',reason:'Local fixture'},explain:{en:'Verify one file','zh-TW':'驗證單一檔案'},zh:{title:'本地驗證',why:['驗證簽章恢復']}});
  else if(tools.some(t=>t.name==='worker_report')){starts.set(id,(starts.get(id)||0)+1);if(starts.get(id)!<=2){writeFileSync(join(E.get(id)!.ctx.worktree,'old.txt'),starts.get(id)===1?'product one\n':'product two\n');}await call('worker_report',{marker:'SCOPE-BLOCKED',summary:'Fixture needs a fresh base; no task files changed'});}
  yield{type:'turnEnd',status:'ok'};
 }}}};
 E.deps.provider=()=>provider;
 const card=async(run:string,node:string)=>{if(!await until(()=>E.cards.list({run,open:true}).some(c=>c.node===node&&E.get(run)!.nodes[node].waiting==='card'),4000))throw new Error('missing '+node+' '+JSON.stringify(E.get(run)));return E.cards.list({run,open:true}).find(c=>c.node===node)!;};
 const start=async(dispatch=true)=>{const r=E.start({workflow:flow.id,params:{project:'fixture'}}),c=await card(r.id,'dispatch');if(dispatch){await E.answer(c.id,{choice:'dispatch',by:'fixture captain'});await card(r.id,'scope-card');await E.answer((await card(r.id,'scope-card')).id,{choice:'rescope',note:'Second product round',by:'captain'});await E.answer((await card(r.id,'dispatch')).id,{choice:'dispatch',by:'captain'});await card(r.id,'scope-card');}return r;};
 const advance=()=>{writeFileSync(join(repo,'environment.txt'),'offline test configuration\n');must(repo,['add','environment.txt']);must(repo,['commit','-qm','Environment repair']);return must(repo,['rev-parse','HEAD']);};
 const stop=async()=>{for(const r of E.list())if(!['succeeded','cancelled','failed'].includes(r.status))await E.cancel(r.id);H.stop();};
 return {H,E,repo,scopes,starts,card,start,advance,stop};
}

for(const mode of ['success','dirty','drift','conflict','untrusted','stale-preview','locked','replay','foreign','diverged','result-drift','base-race','ignored-collision']){
 const F=await fixture();try{
  const {E}=F,r=await F.start(),W=new Worktrees(F.H.data),old=r.ctx.head,base=r.ctx.baseCommit,c=await F.card(r.id,'scope-card');
  const target=F.advance(),preview:any=E.cards.view(c).localRescope;
  ok(must(F.repo,['rev-list','--count',`${base}..${old}`])==='2',mode+' two product commits retained before recovery');
  ok(old!==base&&preview?.strategy==='preserve-commits'&&preview.originalBase===base,mode+' preview discloses committed recovery');
  const i={...preview,repo:E.queueRepo(r.ctx.repo),branch:r.ctx.branch};
  if(mode==='success'){
   await E.answer(c.id,{choice:'rescope',note:'Retain product and use runner',by:'captain',localRescope:preview});await F.card(r.id,'dispatch');
   ok(r.ctx.head!==old&&r.ctx.head!==target&&r.ctx.baseCommit===target&&readFileSync(join(r.ctx.worktree,'old.txt'),'utf8')==='product two\n'&&readFileSync(join(r.ctx.worktree,'environment.txt'),'utf8').includes('offline'),'real product commits and main runner survive rebase');
   ok(must(F.repo,['rev-parse','main'])===target&&must(F.repo,['rev-parse',`refs/crew/recovery/fixture/${r.id}/${old}`])===old,'main unchanged and original work retained');
   await E.answer((await F.card(r.id,'dispatch')).id,{choice:'dispatch',by:'captain'});await F.card(r.id,'scope-card');
   ok(signedReservation(E,r,E.trusted(r.id)).signed.version===3&&F.starts.get(r.id)===3,'fresh exact-head dispatch admits recovery epoch and reruns worker');
   ok(E.trusted(r.id).entries.filter(e=>e.record==='local-rescope-prepared').length===1,'one durable prepared result');
   }else if(mode==='base-race'||mode==='ignored-collision'){
   const result=W.preparePreserving('fixture',r.id,'fixture',i);
   if(mode==='base-race'){
    const check=(W as any).assertPreserving.bind(W);(W as any).assertPreserving=(rec:any,intent:any)=>{check(rec,intent);must(F.repo,['update-ref','refs/heads/main',base,target]);};
   }else{
    W.thaw(W.get('fixture',r.id)!);const exclude=must(F.repo,['rev-parse','--git-path','info/exclude']);writeFileSync(join(F.repo,exclude),'environment.txt\n');writeFileSync(join(r.ctx.worktree,'environment.txt'),'must survive');
   }
   ok(rejects(()=>W.applyPreserving('fixture',r.id,'fixture',i,result)),mode+' refuses before CAS');
   ok(must(r.ctx.worktree,['rev-parse','HEAD'])===old,mode+' retains original task head');
   if(mode==='ignored-collision')ok(readFileSync(join(r.ctx.worktree,'environment.txt'),'utf8')==='must survive','ignored collision retains original bytes');
  }else if(mode==='result-drift'){
   const result=W.preparePreserving('fixture',r.id,'fixture',i);
   ok(rejects(()=>W.applyPreserving('fixture',r.id,'fixture',i,'f'.repeat(40))),'invalid prepared result refused');
   ok(W.get('fixture',r.id)!.head===old,'invalid result leaves original record');
  }else if(mode==='replay'){
   const result=W.preparePreserving('fixture',r.id,'fixture',i);
   // Crash after atomic ref update, before index/record reconciliation.
   must(F.repo,['update-ref',`refs/heads/${r.ctx.branch}`,result,old]);
   const out=W.applyPreserving('fixture',r.id,'fixture',i,result);
   ok(out.head===result&&out.baseCommit===target,'interrupted CAS resumes only prepared exact result');
   ok(W.applyPreserving('fixture',r.id,'fixture',i,result).head===result,'replayed completed effect is idempotent');
  }else{
   let release=()=>{};
   if(mode==='dirty'){W.thaw(W.get('fixture',r.id)!);writeFileSync(join(r.ctx.worktree,'unapproved.txt'),'untouched');}
   if(mode==='drift'){W.thaw(W.get('fixture',r.id)!);writeFileSync(join(r.ctx.worktree,'drift.txt'),'drift');must(r.ctx.worktree,['add','drift.txt']);must(r.ctx.worktree,['commit','-qm','Foreign drift']);}
   if(mode==='conflict'){writeFileSync(join(F.repo,'old.txt'),'conflicting main\n');must(F.repo,['add','old.txt']);must(F.repo,['commit','-qm','Conflicting base']);i.target=must(F.repo,['rev-parse','HEAD']);}
   if(mode==='stale-preview'){writeFileSync(join(F.repo,'new.txt'),'new main');must(F.repo,['add','new.txt']);must(F.repo,['commit','-qm','New main']);}
   if(mode==='untrusted')delete r.ctx.nativeAdmission;
   if(mode==='foreign')i.repo=F.H.data;
   if(mode==='diverged'){must(F.repo,['checkout','--orphan','other']);writeFileSync(join(F.repo,'orphan.txt'),'unrelated');must(F.repo,['add','orphan.txt']);must(F.repo,['commit','-qm','Unrelated']);i.target=must(F.repo,['rev-parse','HEAD']);}
   if(mode==='locked')release=W.lock('fixture',r.id,'other-live-owner');
   let refused=false;try{
    if(['conflict','locked','foreign','diverged'].includes(mode))W.preparePreserving('fixture',r.id,'fixture',i);
    else await E.answer(c.id,{choice:'rescope',note:'Retry',by:'captain',localRescope:preview});
   }catch{refused=true;}finally{release();}
   ok(refused,mode+' fails closed');
   ok(W.get('fixture',r.id)!.head===old&&readFileSync(join(r.ctx.worktree,'old.txt'),'utf8')==='product two\n',mode+' preserves original durable work');
  }
 }catch(e){ok(false,mode,String((e as any).stack??e));}finally{await F.stop();}
}
for(const phase of ['prepared','cas','saved']){
 const F=await fixture(),original=Worktrees.prototype.applyPreserving;let recovered:Engine|undefined;
 try{
  const r=await F.start(),old=r.ctx.head,target=F.advance(),c=await F.card(r.id,'scope-card');
  const ef=join(F.H.data,'runs',r.id,'events.jsonl'),lf=join(F.H.data,'evidence',r.id,'ledger.jsonl');
  let snapshot:any;
  Worktrees.prototype.applyPreserving=function(project,task,holder,i,result){
   if(phase==='cas')must(F.repo,['update-ref',`refs/heads/${r.ctx.branch}`,result,old]);
   if(phase==='saved')original.call(this,project,task,holder,i,result);
   snapshot={events:readFileSync(ef,'utf8'),ledger:readFileSync(lf,'utf8'),result};
   throw new Error('fixture crash after '+phase);
  };
  await F.E.answer(c.id,{choice:'rescope',note:'Preserve and refresh',by:'captain',localRescope:F.E.cards.view(c).localRescope});
  await until(()=>!!snapshot&&r.nodes.spec.waiting==='card',4000);
  Worktrees.prototype.applyPreserving=original;
  if(!snapshot)throw new Error('no crash snapshot');
  // Restore exactly the durable bytes at crash time, without later error routing.
  writeFileSync(ef,snapshot.events);writeFileSync(lf,snapshot.ledger);
  recovered=new Engine({...F.E.deps},F.H.defs);installCode(recovered,{dataDir:F.H.data,projects:new Projects(F.H.data)});recovered.load();
  const restored=recovered.get(r.id)!;
  if(!await until(()=>recovered!.cards.list({run:r.id,open:true}).some(c=>c.node==='dispatch'&&restored.nodes.dispatch.card===c.id),4000))throw new Error('reloaded spec did not reach dispatch '+JSON.stringify(restored));
  ok(restored.ctx.head===snapshot.result&&restored.ctx.baseCommit===target,phase+' real Engine.load recovers signed exact prepared result');
  const ledger=recovered.trusted(r.id);
  ok(ledger.ok&&ledger.entries.filter(e=>e.record==='local-rescope-prepared').length===1&&ledger.entries.filter(e=>e.record==='local-rescope-applied').length===1,phase+' replay creates one prepared/applied pair');
  ok(readFileSync(join(restored.ctx.worktree,'old.txt'),'utf8')==='product two\n'&&must(F.repo,['rev-parse','main'])===target&&must(F.repo,['rev-parse',`refs/crew/recovery/fixture/${r.id}/${old}`])===old,phase+' reload retains product backup and main');
 }catch(e){ok(false,'engine crash '+phase,String((e as any).stack??e));}
 finally{Worktrees.prototype.applyPreserving=original;for(const r of F.E.list())(F.E as any).runs.delete(r.id);if(recovered)for(const r of recovered.list())await recovered.cancel(r.id);F.H.stop();}
}
end();
