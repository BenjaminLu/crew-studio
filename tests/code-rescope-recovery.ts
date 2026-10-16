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
const {ok,end}=suite('code-rescope-recovery');
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
 const H=await harness([Y(flow)]),E=H.engine,repo=join(H.data,'repo');mkdirSync(repo);must(repo,['init','-q','-b','main']);writeFileSync(join(repo,'README.md'),'initial\n');must(repo,['add','README.md']);must(repo,['commit','-qm','Initial']);
 const projects=new Projects(H.data);projects.add({id:'fixture',path:repo});installCode(E,{dataDir:H.data,projects});E.policies.setProject('fixture',{install:false});
 const scopes=new Map<string,string>(),starts=new Map<string,number>();
 E.modes.spec.prompt=x=>`Run ${x.run.id} scope:${scopes.get(x.run.id)||'old.txt'}`;
 const provider:any={id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(text:string){
  const id=/Run (R-\d+)/.exec(text)?.[1]!;
  const call=async(name:string,args:any)=>{const v:any=await H.agents.callTool(ctx.token,name,args);if(v.error)throw new Error(v.error);return v;};
  if(tools.some(t=>t.name==='spec_write'))await call('spec_write',{title:'Local verification',what:'Verify a local file',why:['Exercise signed recovery'],done:['tests/code-rescope-recovery.ts fails on base'],scope:[/scope:([^\s]+)/.exec(text)?.[1]],door:{kind:'two-way',reason:'Local fixture'},explain:{en:'Verify one file','zh-TW':'驗證單一檔案'},zh:{title:'本地驗證',why:['驗證簽章恢復']}});
  else if(tools.some(t=>t.name==='worker_report')){starts.set(id,(starts.get(id)||0)+1);await call('worker_report',{marker:'SCOPE-BLOCKED',summary:'Fixture needs a fresh base; no task files changed'});}
  yield{type:'turnEnd',status:'ok'};
 }}}};
 E.deps.provider=()=>provider;
 const card=async(run:string,node:string)=>{if(!await until(()=>E.cards.list({run,open:true}).some(c=>c.node===node&&E.get(run)!.nodes[node].waiting==='card'),4000))throw new Error('missing '+node+' '+JSON.stringify(E.get(run)));return E.cards.list({run,open:true}).find(c=>c.node===node)!;};
 const start=async(dispatch=true)=>{const r=E.start({workflow:flow.id,params:{project:'fixture'}}),c=await card(r.id,'dispatch');if(dispatch){await E.answer(c.id,{choice:'dispatch',by:'fixture captain'});await card(r.id,'scope-card');}return r;};
 const advance=()=>{writeFileSync(join(repo,'environment.txt'),'offline test configuration\n');must(repo,['add','environment.txt']);must(repo,['commit','-qm','Environment repair']);return must(repo,['rev-parse','HEAD']);};
 const stop=async()=>{for(const r of E.list())if(!['succeeded','cancelled','failed'].includes(r.status))await E.cancel(r.id);H.stop();};
 return {H,E,repo,scopes,starts,card,start,advance,stop};
}
const F=await fixture();
try{
 const {E,scopes,starts,card}=F,r=await F.start(),old=r.ctx.head,prior=structuredClone(r.ctx.nativeAdmission),history=readFileSync(join(F.H.data,'evidence',r.id,'ledger.jsonl'),'utf8'),target=F.advance();
 scopes.set(r.id,'new.txt');const sc=await card(r.id,'scope-card');const cardFile=join(F.H.data,'cards',sc.id+'.json'),cardBytes=readFileSync(cardFile,'utf8'),preview=E.cards.view(sc);ok(preview.localRescope?.target===target&&preview.sections['zh-TW'].how.includes(target)&&readFileSync(cardFile,'utf8')===cardBytes,'read-only view explains exact base refresh without rewriting historical card');await E.answer(sc.id,{choice:'rescope',note:'Use the repaired local environment and new scope',by:'fixture captain',localRescope:(E.cards.view(sc) as any).localRescope} as any);
 ok(JSON.stringify(E.cards.get(sc.id)?.answer?.localRescope)===JSON.stringify(preview.localRescope)&&E.trusted(r.id).entries.some(e=>e.record==='card-answer'&&e.data?.card===sc.id&&JSON.stringify(e.data?.localRescope)===JSON.stringify(preview.localRescope)),'captain preview persists in the card and signed answer for replay');
 const dispatch=await card(r.id,'dispatch');ok(r.ctx.head===target&&r.ctx.baseCommit===target&&must(r.ctx.worktree,['rev-parse','HEAD'])===target,'signed rescope refreshes pristine task to current main before spec');
 ok(starts.get(r.id)===1&&JSON.stringify(r.ctx.nativeAdmission)===JSON.stringify(prior),'new spec waits for fresh dispatch and retains old admission');
 await E.answer(dispatch.id,{choice:'dispatch',by:'fixture captain'});await card(r.id,'scope-card');
 const trusted=E.trusted(r.id),pin=signedReservation(E,r,trusted).signed;
 ok(starts.get(r.id)===2&&pin.version===3&&pin.specHash!==prior.specHash&&pin.scope.join()==='new.txt','fresh dispatch admits the new signed scope epoch');
 ok(pin.heldScope.join()==='old.txt,new.txt'&&readFileSync(join(F.H.data,'evidence',r.id,'ledger.jsonl'),'utf8').startsWith(history),'new epoch preserves old scope and signed history bytes');
 ok(trusted.entries.filter(e=>e.record==='local-rescope-request').length===1&&trusted.entries.filter(e=>e.record==='local-rescope-applied').length===1,'one captain decision produces one request and one applied record');
 // Competing native tasks cannot enter either the retired or current scope.
 for(const scope of ['old.txt','new.txt']){const other=await F.start(false);scopes.set(other.id,scope);if(scope!=='old.txt'){await E.answer((await card(other.id,'dispatch')).id,{choice:'rescope',by:'fixture captain'});await card(other.id,'dispatch');}
  await E.answer((await card(other.id,'dispatch')).id,{choice:'dispatch',by:'fixture captain'});await until(()=>!!other.nodes.build.data.nativeQueue?.reason,2000);
  ok(!starts.has(other.id)&&other.nodes.build.data.nativeQueue?.reason?.includes(r.id),'competing '+scope+' remains held by the recovered task');await E.cancel(other.id);
 }
 // Even a correctly signed extra admission is not authorization for scope drift.
 const x=E.x(r,r.def.nodes.find(n=>n.id==='scope-card')!,r.nodes['scope-card']);
 const ledger=join(F.H.data,'evidence',r.id,'ledger.jsonl'),before=readFileSync(ledger,'utf8'),eventsFile=join(F.H.data,'runs',r.id,'events.jsonl'),eventsBefore=readFileSync(eventsFile,'utf8');
 for(const mutation of ['scope','dependencies','predecessor','recovery','dispatch','heldScope']){
  const altered=structuredClone(pin);if(mutation==='scope')altered.scope=['forged.txt'];else if(mutation==='dependencies')altered.dependencies=['R-999'];else if(mutation==='heldScope')altered.heldScope=['new.txt'];else altered[mutation]=0;
  E.record(x,'scope-admission',{data:altered});let refused=false;try{signedReservation(E,r,E.trusted(r.id));}catch{refused=true;}ok(E.trusted(r.id).ok&&refused,'signed '+mutation+' drift without a new recovery is rejected');writeFileSync(ledger,before);writeFileSync(eventsFile,eventsBefore);
 }
 // A corrupt later tail must not free any scope added by a valid epoch.
 E.record(x,'fixture-tail',{data:{fixture:true}});const corrupted=readFileSync(ledger,'utf8').trim().split('\n'),tail=JSON.parse(corrupted.at(-1)!);tail.sig='0'.repeat(64);corrupted[corrupted.length-1]=JSON.stringify(tail);writeFileSync(ledger,corrupted.join('\n')+'\n');
 const contender=await F.start(false);scopes.set(contender.id,'new.txt');await E.answer((await card(contender.id,'dispatch')).id,{choice:'rescope',by:'fixture captain'});await E.answer((await card(contender.id,'dispatch')).id,{choice:'dispatch',by:'fixture captain'});await until(()=>!!contender.nodes.build.data.nativeQueue?.reason,1000);
 ok(!starts.has(contender.id)&&contender.nodes.build.data.nativeQueue?.reason?.includes('scope identity unavailable'),'corrupt tail preserves verified prior epochs added scope');writeFileSync(ledger,before);writeFileSync(eventsFile,eventsBefore);await E.cancel(contender.id);
 // Restart from the persisted real run/card/evidence without rebinding admission.
 const restored=new Engine({...E.deps},F.H.defs);installCode(restored,{dataDir:F.H.data,projects:new Projects(F.H.data)});restored.load();
 const restoredRun=restored.get(r.id)!;ok(restored.trusted(r.id).ok&&JSON.stringify(signedReservation(restored,restoredRun,restored.trusted(r.id)).signed)===JSON.stringify(pin)&&restored.cards.list({run:r.id,open:true}).some(c=>c.node==='scope-card'),'restart retains the signed epoch and pending captain handoff',JSON.stringify({trusted:restored.trusted(r.id).ok,pin:signedReservation(restored,restoredRun,restored.trusted(r.id)).signed,expected:pin,cards:restored.cards.list({run:r.id,open:true}),state:restoredRun.status}));
 // This evidence-only fixture never claims a merge or completed product task.
 ok(old!==target&&must(r.ctx.worktree,['status','--porcelain'])==='','recovery adds no task changes or fake merge evidence');
}catch(e){ok(false,'signed recovery fixture',String((e as any).stack??e));}finally{await F.stop();}
for(const mutation of ['dirty','commit','ctx-pin','dependencies','auth-window']){
 const F=await fixture();try{const r=await F.start(),c=await F.card(r.id,'scope-card');F.advance();const preview=(F.E.cards.view(c) as any).localRescope;
  if(mutation==='dirty'){new Worktrees(F.H.data).thaw(new Worktrees(F.H.data).get('fixture',r.id)!);writeFileSync(join(r.ctx.worktree,'unapproved.txt'),'keep me');}
  if(mutation==='commit'){new Worktrees(F.H.data).thaw(new Worktrees(F.H.data).get('fixture',r.id)!);writeFileSync(join(r.ctx.worktree,'task.txt'),'task work');must(r.ctx.worktree,['add','task.txt']);must(r.ctx.worktree,['commit','-qm','Task work']);}
  if(mutation==='ctx-pin')delete r.ctx.nativeAdmission;
  if(mutation==='dependencies')r.params.depends_on='["R-999"]';
  let refused=false;try{await F.E.answer(c.id,{choice:'rescope',note:'Retry',by:mutation==='auth-window'?'auth window:fixture':'fixture captain',...(!['dirty','commit'].includes(mutation)?{localRescope:preview}:{})});}catch{refused=true;}
  if(['dirty','commit'].includes(mutation)){await F.card(r.id,'dispatch');ok(!refused&&F.E.cards.get(c.id)?.status==='answered'&&!F.E.trusted(r.id).entries.some(e=>e.record==='local-rescope-request'),'ordinary '+mutation+' rescope remains available without base-refresh authority');}
  else ok(refused&&F.E.cards.get(c.id)?.status==='open'&&F.starts.get(r.id)===1,mutation+' refuses recovery before consuming the card or starting another worker');
  if(mutation==='dirty')ok(new Worktrees(F.H.data).get('fixture',r.id)!.kept.length>0,'ordinary dirty rescope retains original kept-work reconciliation');
 }catch(e){ok(false,mutation,String(e));}finally{await F.stop();}
}
// Git-level CAS and interrupted ref update recovery, without any unchecked reset.
for(const mode of ['base-advanced','base-diverged','base-rewound','head-drift','after-ref-cas','after-record-save']){
 const F=await fixture();try{
  const r=await F.start(),W=new Worktrees(F.H.data),from=r.ctx.head,target=F.advance();
  const intent={repo:F.E.queueRepo(r.ctx.repo),branch:r.ctx.branch,base:r.ctx.base,from,target};
  if(mode==='base-advanced'){writeFileSync(join(F.repo,'another.txt'),'new base');must(F.repo,['add','another.txt']);must(F.repo,['commit','-qm','Moved base']);
   const observed=must(F.repo,['rev-parse','HEAD']),updated=W.refreshPristine('fixture',r.id,'fixture recovery',intent);
   ok(updated.head===target&&updated.baseCommit===target&&must(r.ctx.worktree,['rev-parse','HEAD'])===target&&must(F.repo,['rev-parse','main'])===observed&&observed!==target,'main may advance but task refreshes only to exact signed target');
  }else if(mode==='base-diverged'||mode==='base-rewound'){
   const changed=mode==='base-rewound'?from:must(F.repo,['commit-tree',`${target}^{tree}`,'-p',from,'-m','Sibling main']);must(F.repo,['update-ref','refs/heads/main',changed,target]);
   ok(rejects(()=>W.refreshPristine('fixture',r.id,'fixture recovery',intent))&&must(r.ctx.worktree,['rev-parse','HEAD'])===from,mode+' refuses non-descendant base without moving task');
  }else if(mode==='head-drift'){
   const foreign=must(F.repo,['commit-tree',`${target}^{tree}`,'-p',target,'-m','Unowned head']);must(F.repo,['update-ref',`refs/heads/${r.ctx.branch}`,foreign,from]);
   ok(rejects(()=>W.refreshPristine('fixture',r.id,'fixture recovery',intent))&&must(r.ctx.worktree,['rev-parse','HEAD'])===foreign,'head CAS refuses an unowned commit without resetting it');
  }else{
   if(mode==='after-ref-cas')must(F.repo,['update-ref',`refs/heads/${r.ctx.branch}`,target,from]);
   else W.refreshPristine('fixture',r.id,'fixture recovery',intent);
   const recovered=W.refreshPristine('fixture',r.id,'fixture recovery replay',intent);
   ok(recovered.head===target&&recovered.baseCommit===target&&must(r.ctx.worktree,['status','--porcelain'])==='',mode+' replay completes only the exact authorized snapshot');
  }
 }catch(e){ok(false,mode,String(e));}finally{await F.stop();}
}
// Main advancing after the exact answer is bound must not substitute a newer target.
{
 const F=await fixture();try{
  const r=await F.start(),from=r.ctx.head,target=F.advance();const record=F.E.record.bind(F.E);
  F.E.record=(x,name,e)=>{const value=record(x,name,e);if(name==='local-rescope-request'){writeFileSync(join(F.repo,'raced.txt'),'target moved');must(F.repo,['add','raced.txt']);must(F.repo,['commit','-qm','Target drift']);}return value;};
  const c=await F.card(r.id,'scope-card');await F.E.answer(c.id,{choice:'rescope',note:'Refresh base',by:'fixture captain',localRescope:(F.E.cards.view(c) as any).localRescope} as any);
  await F.card(r.id,'dispatch');
  const applied=F.E.trusted(r.id).entries.find(e=>e.record==='local-rescope-applied');
  ok(must(r.ctx.worktree,['rev-parse','HEAD'])===target&&r.ctx.baseCommit===target&&F.starts.get(r.id)===1&&applied?.head===target&&must(F.repo,['rev-parse','main'])!==target,'signed target remains fixed after main advances; spec returns to fresh dispatch without launching worker');
 }catch(e){ok(false,'signed target drift',String(e));}finally{await F.stop();}
}
for(const mode of ['stale-preview','orphan-request','ordinary-clean']){
 const F=await fixture();try{
  const r=await F.start(),from=r.ctx.head;F.advance();const c=await F.card(r.id,'scope-card'),preview=F.E.cards.view(c).localRescope!;
  if(mode==='stale-preview'){
   writeFileSync(join(F.repo,'newer.txt'),'newer main');must(F.repo,['add','newer.txt']);must(F.repo,['commit','-qm','Main moved after preview']);
   let refused=false;try{await F.E.answer(c.id,{choice:'rescope',note:'Refresh',by:'fixture captain',localRescope:preview});}catch{refused=true;}
   ok(refused&&F.E.cards.get(c.id)?.status==='open'&&r.ctx.head===from,'stale visible target is refused before consuming the card');
  }else{
   if(mode==='orphan-request'){
    let refused=false;try{await F.E.answer(c.id,{choice:'rescope',by:'fixture captain',localRescope:preview});}catch{refused=true;}
    ok(refused&&F.E.cards.get(c.id)?.status==='open'&&F.E.trusted(r.id).entries.some(e=>e.record==='local-rescope-request'),'invalid form leaves only an inert request without captain answer');
   }
   await F.E.answer(c.id,{choice:'rescope',note:'Only rewrite the spec',by:'fixture captain'});await F.card(r.id,'dispatch');
   ok(r.ctx.head===from&&must(r.ctx.worktree,['rev-parse','HEAD'])===from&&!F.E.trusted(r.id).entries.some(e=>e.record==='local-rescope-applied'),mode+' without descriptor never refreshes the base');
  }
 }catch(e){ok(false,mode,String(e));}finally{await F.stop();}
}
{
 const F=await fixture();try{
  const r=await F.start(false),target=F.advance(),c=await F.card(r.id,'dispatch');F.scopes.set(r.id,'new.txt');
  await F.E.answer(c.id,{choice:'rescope',note:'Refresh before first dispatch',by:'fixture captain',localRescope:F.E.cards.view(c).localRescope});
  await F.E.answer((await F.card(r.id,'dispatch')).id,{choice:'dispatch',by:'fixture captain'});await F.card(r.id,'scope-card');
  ok(r.ctx.head===target&&r.ctx.nativeAdmission.version===2&&r.ctx.nativeAdmission.scope.join()==='new.txt','pre-admission recovery refreshes base but still requires first dispatch');
 }catch(e){ok(false,'pre-admission recovery',String(e));}finally{await F.stop();}
}
// Exercise the actual HTTP handler's payload forwarding without a server/socket.
{
 const H=await harness([]);try{
  const {createRuntime}=await import('../src/runtime/index');
  const rt=createRuntime({dataDir:H.data,agents:H.agents,provider:H.engine.deps.provider,defaultProvider:H.engine.deps.defaultProvider,log:H.engine.deps.log,send(){},fmRoot:join(import.meta.dir,'..'),studioUrl:()=>H.toolUrl});
  let submitted:any=null;rt.engine.answer=async(id,a)=>{submitted={id,...a};return submitted;};
  const localRescope={version:1,card:'SC-001',visit:1,base:'main',from:'a'.repeat(40),target:'b'.repeat(40)},url=new URL('http://fixture/api/scards/SC-001/answer');
  const response=await rt.handle(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({choice:'rescope',note:'Refresh',localRescope})}),url,{kind:'desktop'},true);
  ok(response?.status===200&&submitted.by==='captain'&&JSON.stringify(submitted.localRescope)===JSON.stringify(localRescope),'actual card API forwards the exact displayed descriptor to the captain answer');
 }catch(e){ok(false,'card API descriptor',String(e));}finally{H.stop();}
}
// Rebased pristine bases: explicit signed exception only before first admission.
for(const mode of ['success','admitted','dirty','task-commit','unmatched','missing-variant','tampered-variant','stale-target','execution-diverged']){
 const F=await fixture();try{
  const root=must(F.repo,['rev-parse','HEAD']),old=F.advance(),r=await F.start(mode==='admitted');
  must(F.repo,['reset','--hard',root]);writeFileSync(join(F.repo,'upstream.txt'),'new upstream\n');must(F.repo,['add','upstream.txt']);must(F.repo,['commit','-qm','Upstream']);
  if(mode!=='unmatched')must(F.repo,['cherry-pick',old]);const target=must(F.repo,['rev-parse','HEAD']);
  const c=await F.card(r.id,mode==='admitted'?'scope-card':'dispatch');
  if(mode==='dirty'||mode==='task-commit'){const W=new Worktrees(F.H.data);W.thaw(W.get('fixture',r.id)!);writeFileSync(join(r.ctx.worktree,'owned.txt'),'task work');if(mode==='task-commit'){must(r.ctx.worktree,['add','owned.txt']);must(r.ctx.worktree,['commit','-qm','Task work']);}}
  const preview=F.E.cards.view(c).localRescope;
  if(['admitted','dirty','task-commit','unmatched'].includes(mode))ok(!preview,mode+' never offers patch-equivalent refresh');
  else {
   ok(preview?.baseRelation==='patch-equivalent-unadmitted'&&F.E.cards.view(c).sections.en.how.includes('abandons the old base lineage'),'explicit rewritten-history preview for '+mode);
   if(mode==='missing-variant'||mode==='tampered-variant'||mode==='stale-target'){
    const submitted:any={...preview};if(mode==='missing-variant')delete submitted.baseRelation;if(mode==='tampered-variant')submitted.baseRelation='any-rewind';
    if(mode==='stale-target'){writeFileSync(join(F.repo,'later.txt'),'new');must(F.repo,['add','later.txt']);must(F.repo,['commit','-qm','Moved after preview']);}
    let refused=false;try{await F.E.answer(c.id,{choice:'rescope',note:'Approve exact rewritten base',by:'captain',localRescope:submitted});}catch{refused=true;}
    ok(refused&&F.E.cards.get(c.id)?.status==='open'&&must(r.ctx.worktree,['rev-parse','HEAD'])===old,mode+' rejects without consuming card or moving task');
   }else{
    const record=F.E.record.bind(F.E);
    F.E.record=(x,name,e)=>{const value=record(x,name,e);if(name==='local-rescope-request'){
      if(mode==='execution-diverged')must(F.repo,['update-ref','refs/heads/main',root,target]);
      else {writeFileSync(join(F.repo,'later.txt'),'new');must(F.repo,['add','later.txt']);must(F.repo,['commit','-qm','Main advances during handoff']);}
    }return value;};
    await F.E.answer(c.id,{choice:'rescope',note:'Approve exact rewritten base',by:'captain',localRescope:preview});
    if(mode==='execution-diverged'){await until(()=>r.status==='waiting'||r.status==='failed');ok(must(r.ctx.worktree,['rev-parse','HEAD'])===old&&!F.E.trusted(r.id).entries.some(e=>e.record==='local-rescope-applied'),'execution main divergence rejects before replacing base');}
    else {await F.card(r.id,'dispatch');const ledger=F.E.trusted(r.id).entries,request=ledger.find(e=>e.record==='local-rescope-request'),answer=ledger.find(e=>e.record==='card-answer'&&e.data.card===c.id);ok(r.ctx.head===target&&r.ctx.baseCommit===target&&!r.ctx.nativeAdmission&&!F.starts.get(r.id)&&request?.data.baseRelation===preview!.baseRelation&&answer?.data.localRescope.baseRelation===preview!.baseRelation,'signed exception refreshes only approved target and still waits for first dispatch');}
   }
  }
 }catch(e){ok(false,'rebased '+mode,String(e));}finally{await F.stop();}
}
// Bound both sides; no merges, empty old-side series or unrelated histories.
{
 const F=await fixture();try{
  const root=must(F.repo,['rev-parse','HEAD']),old=F.advance();
  ok(!patchEquivalentBase(F.repo,root,old),'empty old-side series is not a rewritten-history exception');
  const unrelated=must(F.repo,['commit-tree',`${old}^{tree}`,'-m','Unrelated']);ok(!patchEquivalentBase(F.repo,old,unrelated),'unrelated histories cannot refresh');
  const sibling=must(F.repo,['commit-tree',`${root}^{tree}`,'-p',root,'-m','Sibling']),merge=must(F.repo,['commit-tree',`${old}^{tree}`,'-p',old,'-p',sibling,'-m','Old merge']);ok(!patchEquivalentBase(F.repo,merge,sibling)&&!patchEquivalentBase(F.repo,sibling,merge),'merges on either side cannot refresh');
  let deep=sibling;for(let i=0;i<65;i++)deep=must(F.repo,['commit-tree',`${root}^{tree}`,'-p',deep,'-m','Bound '+i]);ok(!patchEquivalentBase(F.repo,old,deep)&&!patchEquivalentBase(F.repo,deep,old),'either side over 64 commits refuses bounded matching');
 }finally{await F.stop();}
}
end();
