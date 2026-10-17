import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// An ordinary captain Rescope on an admitted code Task: the spec is rewritten, the captain dispatches again,
// and the next build must start. The old scope pin is replaced only through the signed rescope answer and the
// later signed dispatch; "Approve fresh preparation" re-pins through the same path. Real cards, the native
// queue and a temporary git repository; stub agents call the same token-authorized tools in process.
//     bun tests/code-rescope-repin.ts
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,suite,until,Y} from './rt-harness';
import {Projects} from '../src/doors';
import {installCode} from '../src/domain/code';
import {signedReservation} from '../src/domain/code-queue';
import {must} from '../src/git';
const {ok,end}=suite('code-rescope-repin');
process.env.CREW_TEST_IN_PROCESS='1';
const flow={id:'repin-fixture',name:'Repin fixture',version:1,roles:[{id:'coordinator',label:'Coordinator',skill:'test'},{id:'worker',label:'Worker',skill:'test'}],params:{project:{label:'Project'}},nodes:[
 {id:'prepare',kind:'hook',do:'repo.prepare',label:'Prepare',x:0,y:0},
 {id:'spec',kind:'agent',role:'coordinator',mode:'spec',retries:1,label:'Spec',x:1,y:0},
 {id:'dispatch',kind:'card',label:'Dispatch',args:{card_kind:'dispatch'},card:{title:'Dispatch',body:'Approve fixture',options:[{id:'dispatch',label:'Dispatch', labelZh: 'Dispatch'},{id:'rescope',label:'Rescope', labelZh: 'Rescope', note: true }]},x:2,y:0},
 {id:'build',kind:'agent',role:'worker',mode:'build',label:'Build',x:3,y:0},
 {id:'scope-card',kind:'card',label:'Scope',args:{card_kind:'scope'},card:{title:'Scope',body:'Worker is blocked',captainOnly:true,options:[{id:'rescope',label:'Rescope', labelZh: 'Rescope',note:true},{id:'park',label:'Park', labelZh: 'Park'}]},x:4,y:0},
 {id:'merge',kind:'hook',do:'git.merge',label:'Merge',x:5,y:0},
 {id:'done',kind:'hook',label:'Done',x:6,y:0}],edges:[['prepare','spec'],['spec','dispatch'],['dispatch','build','dispatch'],['dispatch','spec','rescope'],['build','scope-card'],['scope-card','spec','rescope'],['scope-card','done','park'],['scope-card','merge','merge'],['merge','done']]};
const H=await harness([Y(flow)]),E=H.engine,repo=join(H.data,'repo');mkdirSync(repo);assertTempRepo(repo);must(repo,['init','-q','-b','main']);writeFileSync(join(repo,'README.md'),'initial\n');must(repo,['add','README.md']);must(repo,['commit','-qm','Initial']);
const projects=new Projects(H.data);projects.add({id:'fixture',path:repo});installCode(E,{dataDir:H.data,projects});E.policies.setProject('fixture',{install:false});
// Each spec draft names its scope and differs in text, so every rewrite has a new spec hash.
// A cancelled Task keeps its reservation, so every Task starts on its own file.
const own=(id:string)=>`${id.toLowerCase()}.txt`;
const scopes=new Map<string,string[]>(),drafts=new Map<string,number>(),starts=new Map<string,number>(),writes=new Map<string,string>();
E.modes.spec.prompt=x=>`Run ${x.run.id} scope:${(scopes.get(x.run.id)??[own(x.run.id)]).join(',')}`;
const provider:any={id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(text:string){
 const id=/Run (R-\d+)/.exec(text)?.[1]!;
 const call=async(name:string,args:any)=>{const v:any=await H.agents.callTool(ctx.token,name,args);if(v.error)throw new Error(v.error);return v;};
 if(tools.some(t=>t.name==='spec_write')){const n=(drafts.get(id)??0)+1;drafts.set(id,n);
  await call('spec_write',{title:'Local verification',what:`Verify a local file, draft ${n}`,why:['Exercise the rescope re-pin'],done:['tests/code-rescope-repin.ts fails on base'],scope:/scope:([^\s]+)/.exec(text)![1].split(','),door:{kind:'two-way',reason:'Local fixture'},explain:{en:'Verify one file','zh-TW':'驗證單一檔案'},zh:{title:'本地驗證',why:['驗證重新界定範圍']}});}
 else if(tools.some(t=>t.name==='worker_report')){starts.set(id,(starts.get(id)||0)+1);const w=writes.get(id);if(w&&starts.get(id)===1)await call('fs_write',{path:w,content:'task work\n'});await call('worker_report',{marker:'SCOPE-BLOCKED',summary:'Needs another path'});}
 yield{type:'turnEnd',status:'ok'};
}}}};
E.deps.provider=()=>provider;
const card=async(run:string,node:string,ms=6000)=>{if(!await until(()=>E.cards.list({run,open:true}).some(c=>c.node===node&&E.get(run)!.nodes[node].waiting==='card'),ms))throw new Error('missing '+node+' '+JSON.stringify({status:E.get(run)?.status,open:E.cards.list({run,open:true}).map(c=>`${c.node}:${c.title.en}:${JSON.stringify(c.options.map(o=>o.id))}`),nodes:Object.fromEntries(Object.entries(E.get(run)!.nodes).map(([k,n])=>[k,`${n.state}:${n.outcome}:${n.waiting??''}:${n.note??''}`]))}));return E.cards.list({run,open:true}).find(c=>c.node===node)!;};
const readiness=(run:string)=>E.cards.list({run,open:true}).find(c=>c.node==='build'&&c.title.en.startsWith('Round cannot start:'));
// The second build either reports again (scope-card) or stops on a readiness card; wait for whichever comes.
const settled=(run:string)=>until(()=>starts.get(run)===2&&E.get(run)!.nodes['scope-card'].waiting==='card'||!!readiness(run)||!!E.get(run)!.nodes.build.data.nativeQueue?.reason,6000);
const start=async(o:{write?:boolean}={})=>{const r=E.start({workflow:flow.id,params:{project:'fixture'}});if(o.write)writes.set(r.id,own(r.id));await E.answer((await card(r.id,'dispatch')).id,{choice:'dispatch',by:'fixture captain'});await card(r.id,'scope-card');return r;};
const rescope=async(r:any,scope:string[]|null,by='fixture captain')=>{if(scope)scopes.set(r.id,scope);await E.answer((await card(r.id,'scope-card')).id,{choice:'rescope',note:'Rewrite the spec',by});await E.answer((await card(r.id,'dispatch')).id,{choice:'dispatch',by:'fixture captain'});};
const pin=(r:any)=>signedReservation(E,r,E.trusted(r.id)).signed;
try{
 for(const [label,write] of [['A: no commit (head == base)',false],['B: committed change (head != base)',true]] as const){
  const r=await start(write?{write:true}:{}),prior=structuredClone(r.ctx.nativeAdmission);
  ok((r.ctx.head===r.ctx.baseCommit)===!write,label+': fixture round shape',JSON.stringify({head:r.ctx.head,base:r.ctx.baseCommit}));
  await rescope(r,null);await settled(r.id);
  const p=pin(r),stuck=readiness(r.id);
  ok(!stuck&&starts.get(r.id)===2,label+': after rescope and a fresh dispatch the next build starts',stuck?String(E.cards.view(stuck).sections?.en?.why):JSON.stringify(r.nodes.build));
  ok(p&&p.specHash!==prior.specHash&&JSON.stringify(r.ctx.nativeAdmission)===JSON.stringify(p)&&p.scope.join()===own(r.id)&&p.heldScope?.join()===own(r.id),label+': the new spec is pinned with the same scope',JSON.stringify(p));
  await E.cancel(r.id);
 }
 // A widened scope that no other Task holds is admitted; the old scope stays held with it.
 {const r=await start();await rescope(r,[own(r.id),'wide.txt']);await settled(r.id);const p=pin(r);
  ok(!readiness(r.id)&&starts.get(r.id)===2&&p?.scope.join()===own(r.id)+',wide.txt'&&p.heldScope.join()===own(r.id)+',wide.txt','widened free scope goes through admission and is re-pinned',JSON.stringify(p));await E.cancel(r.id);}
 // A Task stuck on a stale-pin readiness card (raised by the build before this fix): "Approve fresh
 // preparation" re-pins through the same signed rescope path and the build runs.
 {const r=await start(),prior=structuredClone(r.ctx.nativeAdmission),q=E.queueDomain!,real=q.ready;let once=true;
  q.ready=x=>{if(once&&x.run.id===r.id){once=false;throw new Error('native scope pin changed or uses unknown hash algorithm; fresh preparation required');}return real(x);};
  try{await rescope(r,null);const stale=await card(r.id,'build');ok(stale.title.en.startsWith('Round cannot start:')&&starts.get(r.id)===1,'fixture raises the stale-pin readiness card');
   await E.answer(stale.id,{choice:'retry',by:'fixture captain'});await settled(r.id);
   const again=readiness(r.id),p=pin(r);
   ok(!again&&starts.get(r.id)===2,'approve fresh preparation re-pins and the build runs',again?String(E.cards.view(again).sections?.en?.why):'');
   ok(p?.specHash!==prior.specHash&&JSON.stringify(r.ctx.nativeAdmission)===JSON.stringify(p),'retry wrote the new signed pin',JSON.stringify(p));
  }finally{q.ready=real;}await E.cancel(r.id);}
 // A rescope that widens into another live Task's scope is admitted: Tasks run concurrently and rebase each round (no scope hold, no stale-pin card).
 {const holder=await start();
  const r=await start();await rescope(r,[own(r.id),own(holder.id)]);await settled(r.id);
  ok(!readiness(r.id)&&starts.get(r.id)===2&&!r.nodes.build.data.nativeQueue?.reason,'widening into a live Task scope is admitted alongside it',JSON.stringify({reason:r.nodes.build.data.nativeQueue?.reason,card:readiness(r.id)&&E.cards.view(readiness(r.id)!).sections?.en?.why}));
  await E.cancel(r.id);await E.cancel(holder.id);}
 // Only a captain rescope grants a replacement: an auth-window answer leaves the stale pin refused.
 {const r=await start();await rescope(r,null,'auth window:fixture');await settled(r.id);const stuck=readiness(r.id);
  ok(!!stuck&&starts.get(r.id)===1&&String(E.cards.view(stuck).body).includes('scope pin changed')&&/no longer match/.test(String(E.cards.view(stuck).sections?.en?.why)),'an auth-window rescope cannot re-pin (the card says the approved scope no longer matches; the raw reason stays in its detail)',JSON.stringify(r.nodes.build));await E.cancel(r.id);}
}catch(e){ok(false,'rescope repin fixture',String((e as any).stack??e));}
finally{for(const r of E.list())if(!['succeeded','cancelled','failed'].includes(r.status))await E.cancel(r.id);H.stop();}
end();
