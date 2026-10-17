import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness';
import {Projects} from '../src/doors';
import {installCode} from '../src/domain/code';
import {must} from '../src/git';
process.env.CREW_TEST_IN_PROCESS='1';
const flow={id:'worker-evidence',name:'Worker evidence',version:1,roles:[{id:'coordinator',label:'Coordinator',skill:'test'},{id:'worker',label:'Worker',skill:'test'}],params:{project:{label:'Project'}},nodes:[
 {id:'prepare',kind:'hook',do:'repo.prepare',label:'Prepare',x:0,y:0},
 {id:'spec',kind:'agent',role:'coordinator',mode:'spec',label:'Spec',x:1,y:0},
 {id:'dispatch',kind:'card',label:'Dispatch',args:{card_kind:'dispatch'},card:{title:'Dispatch',options:[{id:'dispatch',label:'Dispatch'}]},x:2,y:0},
 {id:'build',kind:'agent',role:'worker',mode:'build',label:'Build',x:3,y:0},
 {id:'hold',kind:'card',label:'Hold',card:{title:'Hold',options:[{id:'close',label:'Close'}]},x:4,y:0}],edges:[['prepare','spec'],['spec','dispatch'],['dispatch','build','dispatch'],['build','hold']]};
const H=await harness([Y(flow)]),E=H.engine,repo=join(H.data,'repo');
try{
 mkdirSync(join(repo,'.crew'),{recursive:true});mkdirSync(join(repo,'tests'));
 writeFileSync(join(repo,'tests/allowed.ts'),'// scoped fixture\n');
 writeFileSync(join(repo,'tests/verification.ts'),'// read-only regression fixture\n');
 // adapters get basenames in CREW_TEST_FILES (the gates' contract) and repo-relative paths in CREW_TEST_PATHS
 writeFileSync(join(repo,'test.mjs'),'const f=process.env.CREW_TEST_FILES,p=process.env.CREW_TEST_PATHS;console.log("SELECTED="+p);console.log("ok 1 - selected");process.exit(["tests/allowed.ts","tests/verification.ts"].includes(p)&&p.endsWith("/"+f)?0:9);');
 writeFileSync(join(repo,'.crew/gates.json'),JSON.stringify({test:[process.execPath,'test.mjs'],tests:['tests/**'],timeout_s:10}));
 assertTempRepo(repo);must(repo,['init','-q','-b','main']);must(repo,['add','.']);must(repo,['commit','-qm','Fixture']);
 const projects=new Projects(H.data);projects.add({id:'fixture',path:repo});installCode(E,{dataDir:H.data,projects});E.policies.setProject('fixture',{install:false});
 process.env.CREW_LOCAL_UNRESTRICTED='1';process.env.CREW_LOCAL_DEPENDENCY_ROOT=repo;
 let context:any,result:any,verification:any,rejected=0;
 E.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(){
  const call=(name:string,args:any)=>H.agents.callTool(ctx.token,name,args);
  if(tools.some(t=>t.name==='spec_write'))await call('spec_write',{title:'Verify fixture',what:'Verify scoped test',why:['Evidence'],done:['tests/allowed.ts proves fixture'],scope:['tests/allowed.ts'],verificationScope:['tests/verification.ts'],door:{kind:'two-way',reason:'Fixture'},explain:{en:'Evidence','zh-TW':'證據'},zh:{title:'驗證',why:['證據']}});
  else{
   context=await call('run_context',{});
   for(const path of ['../outside','tests/../test.mjs','tests/not-scoped.ts','tests/allowed.ts,other'])if((await call('run_tests',{files:[path]}) as any).error)rejected++;
   result=await call('run_tests',{files:['tests/allowed.ts']});
   verification=await call('run_tests',{files:['tests/verification.ts']});
   await call('worker_report',{marker:'SCOPE-BLOCKED',summary:'Fixture verification complete; no change needed'});
  }
  yield{type:'turnEnd',status:'ok'};
 }};}} as any);
 const r=E.start({workflow:flow.id,params:{project:'fixture'}});
 assert(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.node==='dispatch')&&!E.busy(r.id)));
 const card=E.cards.list({run:r.id,open:true})[0];await E.answer(card.id,{choice:'dispatch',by:'fixture captain',note:'Verify scoped test'});
 assert(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.node==='hold')&&!E.busy(r.id)),JSON.stringify(r.nodes));
 assert.equal(verification.exit,0,JSON.stringify(verification));
 assert.deepEqual(r.ctx.spec.scope,['tests/allowed.ts']);
 const verified=E.trusted(r.id).entries.find(e=>e.seq===verification.evidence.seq)!;
 assert.equal(verified.record,'worker-test-execution');assert.equal(verified.data.exit,0);assert.deepEqual(verified.data.files,['tests/verification.ts']);
 assert.equal(rejected,4);assert.equal(result.exit,0);assert.match(result.tail,/SELECTED=tests\/allowed.ts/);
 assert.equal(context.policy.install,false);assert.equal(context.dispatch.card,card.id);assert.equal(context.checkout.head,r.ctx.baseCommit);assert.equal(context.jobs[0].executionMode,'local-unrestricted');
 assert(!JSON.stringify(context).includes('token'));
 const evidence=E.trusted(r.id).entries.find(e=>e.seq===result.evidence.seq)!;assert.equal(evidence.record,'worker-test-execution');assert.equal(evidence.sig,result.evidence.sig);assert.equal(evidence.data.exit,0);assert.deepEqual(evidence.data.files,['tests/allowed.ts']);
 console.log('PASS actual worker context, scoped test selection, invalid paths refused, actual exit and signed evidence');
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
