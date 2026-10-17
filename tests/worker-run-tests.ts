import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness';
import {Projects} from '../src/doors';
import {installCode} from '../src/domain/code';
import {ranNoTests,selectionEnv} from '../src/test-command';
import {must} from '../src/git';
process.env.CREW_TEST_IN_PROCESS='1';
// R-058 regressions: a money-kit shaped repo (gates.json shard adapter that selects by basename, package.json "bun test",
// a candidate test file that exists only on the head) and a worker that has to verify its own change with run_tests.
assert(ranNoTests('shard 1/1: no test files')&&ranNoTests('Ran 0 tests across 0 files.')&&ranNoTests('# tests 0')&&!ranNoTests(' 0 fail\nRan 3 tests across 1 file.'));
assert.deepEqual(selectionEnv(['test/format.test.ts']),{CREW_TEST_FILES:'format.test.ts',CREW_TEST_PATHS:'test/format.test.ts'});
const flow={id:'worker-run-tests',name:'Worker run tests',version:1,roles:[{id:'coordinator',label:'Coordinator',skill:'test'},{id:'worker',label:'Worker',skill:'test'}],params:{project:{label:'Project'}},nodes:[
 {id:'prepare',kind:'hook',do:'repo.prepare',label:'Prepare',x:0,y:0},
 {id:'spec',kind:'agent',role:'coordinator',mode:'spec',label:'Spec',x:1,y:0},
 {id:'dispatch',kind:'card',label:'Dispatch',args:{card_kind:'dispatch'},card:{title:'Dispatch',options:[{id:'dispatch',label:'Dispatch'}]},x:2,y:0},
 {id:'build',kind:'agent',role:'worker',mode:'build',label:'Build',x:3,y:0},
 {id:'hold',kind:'card',label:'Hold',card:{title:'Hold',options:[{id:'close',label:'Close'}]},x:4,y:0}],edges:[['prepare','spec'],['spec','dispatch'],['dispatch','build','dispatch'],['build','hold']]};
const H=await harness([Y(flow)]),E=H.engine,repo=join(H.data,'repo');
try{
 for(const d of ['.crew','scripts','src','test'])mkdirSync(join(repo,d),{recursive:true});
 writeFileSync(join(repo,'scripts/test-shard.ts'),readFileSync(join(import.meta.dir,'../templates/sandbox-repo/scripts/test-shard.ts')));
 writeFileSync(join(repo,'.crew/gates.json'),JSON.stringify({test:[process.execPath,'scripts/test-shard.ts'],shards:2,tests:['test/**'],timeout_s:60}));
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'money-kit',private:true,type:'module',scripts:{test:'bun test'}}));
 writeFileSync(join(repo,'src/money.ts'),'export const format=(cents:number)=>`$${cents}`;\n');
 writeFileSync(join(repo,'test/money.test.ts'),"import {test,expect} from 'bun:test';import {format} from '../src/money';test('formats',()=>expect(format(5)).toContain('$'));\n");
 assertTempRepo(repo);must(repo,['init','-q','-b','main']);must(repo,['add','.']);must(repo,['commit','-qm','Fixture']);
 const baseTree=must(repo,['rev-parse','HEAD^{tree}']);
 const projects=new Projects(H.data);projects.add({id:'fixture',path:repo});installCode(E,{dataDir:H.data,projects});E.policies.setProject('fixture',{install:false});
 process.env.CREW_LOCAL_UNRESTRICTED='1';process.env.CREW_LOCAL_DEPENDENCY_ROOT=repo;
 const out:Record<string,any>={};const executed:any[]=[];
 E.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(){
  const call=(name:string,args:any)=>H.agents.callTool(ctx.token,name,args) as Promise<any>;
  if(tools.some(t=>t.name==='spec_write'))await call('spec_write',{title:'Format cents',what:'Format cents as dollars',why:['Evidence'],done:['test/format.test.ts proves cents format'],scope:['src/**','test/**'],door:{kind:'two-way',reason:'Fixture'},explain:{en:'Evidence','zh-TW':'證據'},zh:{title:'格式',why:['證據']}});
  else{
   await call('fs_write',{path:'src/money.ts',content:'export const format=(cents:number)=>`$${(cents/100).toFixed(2)}`;\n'});
   await call('fs_write',{path:'test/format.test.ts',content:"import {test,expect} from 'bun:test';import {format} from '../src/money';test('cents format',()=>expect(format(150)).toBe('$1.50'));\n"});
   const run=async(key:string,args:any)=>{const r=await call('run_tests',args);out[key]=r;if(r.status==='executed')executed.push(r);return r;};
   await run('base',{files:['test/format.test.ts'],target:'base'});
   await run('head',{files:['test/format.test.ts']});
   await run('basename',{files:['format.test.ts'],target:'base'});
   await run('missing',{files:['test/missing.test.ts']});
   await run('npmFiles',{files:['test/format.test.ts'],runner:'npm-test'});
   await run('npmHead',{runner:'npm-test'});
   await run('npmBase',{runner:'npm-test',target:'base'});
   for(let i=0;i<10&&!out.limit?.error;i++)await run('limit',{});
   await call('worker_report',{marker:'WORKER_COMPLETE',summary:'Fixture'});
  }
  yield{type:'turnEnd',status:'ok'};
 }};}} as any);
 const r=E.start({workflow:flow.id,params:{project:'fixture'}});
 assert(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.node==='dispatch')&&!E.busy(r.id)));
 const card=E.cards.list({run:r.id,open:true})[0];await E.answer(card.id,{choice:'dispatch',by:'fixture captain',note:'Format'});
 assert(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.node==='hold')&&!E.busy(r.id),120000),JSON.stringify(r.nodes));
 // base = base source + the head's candidate test: the new test runs and goes red, never "no test files" exit 0
 assert.equal(out.base.status,'executed',JSON.stringify(out.base));assert.notEqual(out.base.exit,0,JSON.stringify(out.base));assert.match(out.base.tail,/FAIL test\/format\.test\.ts: cents format/);
 assert.equal(out.head.exit,0,JSON.stringify(out.head));assert.match(out.head.tail,/Ran 1 test/);
 // the head evidence names the tree that actually ran: the commit is still the base, the worktree is dirty
 assert.equal(out.head.head,r.ctx.baseCommit);assert.equal(out.head.dirty,true);assert.notEqual(out.head.tree,baseTree);
 const ev=E.trusted(r.id).entries.find(e=>e.seq===out.head.evidence.seq)!;assert.equal(ev.data.dirty,true);assert.equal(ev.data.tree,out.head.tree);
 // a bare basename is refused with the exact call to make, and does not count
 assert.match(out.basename.error,/run_tests\(\{"files":\["test\/format\.test\.ts"\],"target":"base"\}\)/);assert.equal(out.basename.runsRemaining,8);
 // a selection that runs nothing is not a pass and does not count
 assert.equal(out.missing.status,'no-tests',JSON.stringify(out.missing));assert.equal(out.missing.runsRemaining,8);
 assert.match(out.npmFiles.error,/call run_tests\(\{"files":\["test\/format\.test\.ts"\],"target":"head"\}\) without runner/);
 // npm-test works although the declared command comes from .crew/gates.json
 assert.equal(out.npmHead.status,'executed',JSON.stringify(out.npmHead));assert.equal(out.npmHead.exit,0,out.npmHead.tail);assert.deepEqual(out.npmHead.command,['npm','--ignore-scripts','test']);
 assert.equal(out.npmBase.status,'executed',JSON.stringify(out.npmBase));assert.notEqual(out.npmBase.exit,0,out.npmBase.tail);
 // ten executed runs, a countdown in every result, then a limit message that says what to do
 assert.equal(executed.length,10);assert.deepEqual(executed.map(e=>e.runsRemaining),[9,8,7,6,5,4,3,2,1,0]);
 assert.match(out.limit.error,/test run limit reached: all 10 executed runs/);assert.equal(out.limit.runsRemaining,0);
 console.log('PASS worker run_tests: base overlays candidate tests, repo-relative selection reaches the basename adapter, zero-test runs refused, npm-test with gates.json, 10 counted runs, dirty tree evidence');
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
