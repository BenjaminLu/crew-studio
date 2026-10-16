import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
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
 mkdirSync(repo);writeFileSync(join(repo,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --test server.test.mjs'}}));
 writeFileSync(join(repo,'server.test.mjs'),"import {test} from 'node:test';test('unchanged backend',()=>{});");
 writeFileSync(join(repo,'value.mjs'),'export const value=1;');
 assertTempRepo(repo);must(repo,['init','-q','-b','main']);must(repo,['add','.']);must(repo,['commit','-qm','Fixture']);
 const projects=new Projects(H.data);projects.add({id:'fixture',path:repo});installCode(E,{dataDir:H.data,projects});E.policies.setProject('fixture',{install:false});
 process.env.CREW_LOCAL_UNRESTRICTED='1';process.env.CREW_LOCAL_DEPENDENCY_ROOT='/Users/you/Desktop/crew-studio';
 let context:any,result:any,verification:any,baseResult:any,rejected=0;
 E.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(){
  const call=(name:string,args:any)=>H.agents.callTool(ctx.token,name,args);
  if(tools.some(t=>t.name==='spec_write'))await call('spec_write',{title:'Verify fixture',what:'Verify scoped test',why:['Evidence'],done:['site.test.mjs proves fixture'],scope:['site.test.mjs','value.mjs','docs/validation/**'],verificationScope:['server.test.mjs'],door:{kind:'two-way',reason:'Fixture'},explain:{en:'Evidence','zh-TW':'證據'},zh:{title:'驗證',why:['證據']}});
  else{
   context=await call('run_context',{});
   const wt=E.get(context.task)!.ctx.worktree;writeFileSync(join(wt,'value.mjs'),'export const value=2;');
   writeFileSync(join(wt,'site.test.mjs'),`import assert from 'node:assert/strict';import {value} from './value.mjs';import {createRequire} from 'node:module';import {createServer} from 'node:http';import {join} from 'node:path';assert.equal(value,2,'semantic changed page');const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);const server=createServer((q,r)=>r.end('<h1>Hello '+value+'</h1>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();try{const p=await browser.newPage();await p.goto('http://127.0.0.1:'+server.address().port);assert.equal(await p.locator('h1').innerText(),'Hello 2');await p.screenshot({path:join(process.env.CREW_TEST_OUTPUT_DIR,'browser.png')});console.log('BROWSER_OK');}finally{await browser.close();server.close();}`);
   for(const path of ['../outside','tests/../test.mjs','tests/not-scoped.ts','site.test.mjs,other'])if((await call('run_tests',{files:[path]}) as any).error)rejected++;
   baseResult=await call('run_tests',{files:['site.test.mjs'],target:'base'});
   result=await call('run_tests',{files:['site.test.mjs'],target:'head',evidenceDir:'docs/validation/R-041'});
   verification=await call('run_tests',{});
   await call('worker_report',{marker:'SCOPE-BLOCKED',summary:'Fixture verification complete; no change needed'});
  }
  yield{type:'turnEnd',status:'ok'};
 }};}} as any);
 const r=E.start({workflow:flow.id,params:{project:'fixture'}});
 assert(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.node==='dispatch')&&!E.busy(r.id)));
 const card=E.cards.list({run:r.id,open:true})[0];await E.answer(card.id,{choice:'dispatch',by:'fixture captain',note:'Verify scoped test'});
 assert(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.node==='hold')&&!E.busy(r.id)),JSON.stringify(r.nodes));
 assert.equal(verification.exit,0,JSON.stringify(verification));assert.match(verification.tail,/unchanged backend/);
 assert.equal(baseResult.exit,1,JSON.stringify(baseResult));assert.match(baseResult.tail,/semantic changed page/);
 assert.equal(rejected,4);assert.equal(result.exit,0,JSON.stringify(result));assert.match(result.tail,/BROWSER_OK/);
 assert(existsSync(join(r.ctx.worktree,'docs/validation/R-041/browser.png')));
 assert.equal(JSON.parse(readFileSync(join(r.ctx.worktree,'package.json'),'utf8')).scripts.test,'node --test server.test.mjs');
 assert.equal(context.policy.install,false);assert.equal(context.dispatch.card,card.id);assert.equal(context.checkout.head,r.ctx.baseCommit);assert.equal(context.jobs[0].executionMode,'local-unrestricted');
 assert(!JSON.stringify(context).includes('token'));
 const evidence=E.trusted(r.id).entries.find(e=>e.seq===result.evidence.seq)!;assert.equal(evidence.record,'worker-test-execution');assert.equal(evidence.sig,result.evidence.sig);assert.equal(evidence.data.exit,0);assert.deepEqual(evidence.data.files,['site.test.mjs']);
 console.log('PASS actual role tool: exact Node selection, semantic base red/head green, real Chromium screenshot in approved evidence directory, unchanged backend and signed receipts');
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
