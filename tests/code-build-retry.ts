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
const {ok,end}=suite('code-build-retry');
const rejects=(fn:()=>unknown)=>{try{fn();return false;}catch{return true;}};
process.env.CREW_TEST_IN_PROCESS='1';
const flow={id:'code-firstmate',name:'Rescope fixture',version:1,roles:[{id:'coordinator',label:'Coordinator',skill:'test'},{id:'worker',label:'Worker',skill:'test'}],params:{project:{label:'Project'}},nodes:[
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


for(const mode of ['success','changed-spec','foreign-card']){
 const F=await fixture();try{
  const {E}=F,r=await F.start(false),dispatch=await F.card(r.id,'dispatch');
  await E.answer(dispatch.id,{choice:'dispatch',by:'captain'});const c=await F.card(r.id,'scope-card');
  const originalSpec=JSON.stringify(r.ctx.spec),originalDef=JSON.stringify(r.def),old=r.ctx.head;
  ok(E.cards.view(c).options.some(o=>o.id==='retry-build'),mode+' offers approved build continuation');
  if(mode==='changed-spec'){
   r.ctx.spec.what+=' changed';let refused=false;try{await E.answer(c.id,{choice:'retry-build',by:'captain'});}catch{refused=true;}
   ok(refused&&F.starts.get(r.id)===1,'changed spec cannot reuse approval');
  }else if(mode==='foreign-card'){
   let refused=false;try{await E.answer(c.id,{choice:'retry-build',by:'auth window attacker'});}catch{refused=true;}
   ok(refused&&F.starts.get(r.id)===1,'auth window cannot grant captain continuation');
  }else{
   await E.answer(c.id,{choice:'retry-build',by:'captain',note:'Runner repaired; preserve spec'});await F.card(r.id,'scope-card');
   ok(F.starts.get(r.id)===2&&r.nodes.spec.visits===1,'continues build without re-running spec');
   ok(JSON.stringify(r.ctx.spec)===originalSpec&&JSON.stringify(r.def)===originalDef,'approved spec and pinned definition preserved');
   ok(r.ctx.baseCommit!==r.ctx.head&&old!==r.ctx.head,'existing work retained and next build committed');
   const answer=E.trusted(r.id).entries.filter(e=>e.record==='card-answer'&&e.data.choice==='retry-build');
   ok(answer.length===1&&E.trusted(r.id).ok,'continuation is signed exactly once');
  }
 }finally{await F.stop();}
}
end();
