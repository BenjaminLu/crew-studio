import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Plan-vs-execution contract. No model call or production ledger mutation.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness} from './rt-harness';
import {assertTempRepo} from './lib/git-hygiene.mjs';
import {Projects} from '../src/doors';
import {installCode} from '../src/domain/code';
import {Ledger,doneMap} from '../src/runtime/checks';
import {must,setGitHome} from '../src/git';
const root=join(import.meta.dir,'..');
const observable=Bun.YAML.parse(readFileSync(join(root,'packs/firstmate/checks/done-lines-observable/check.yaml'),'utf8')) as any;
const provable=Bun.YAML.parse(readFileSync(join(root,'packs/firstmate/checks/done-lines-provable/check.yaml'),'utf8')) as any;
// This check is a judge instruction contract, not a deterministic semantic judge.
assert.match(observable.judge.prompt,/SPECIFICATION-STAGE/);
assert.match(observable.judge.prompt,/Never require an existing test file, an executed PASS/);
assert.match(observable.judge.prompt,/Naming a test alone is insufficient/);
assert.match(observable.judge.prompt,/actionable replacement/);
assert.match(observable.judge.prompt,/NOT that the feature or tests passed/);
assert.equal(observable.kind,'judged');assert.deepEqual(observable.applies_to,['spec']);
const H=await harness([]);
try {
 const planned='tests/new-feature.test.ts: after choosing continue, the saved vendor session ID is reused; planned fail-first expects a new ID on base.';
 assert.equal(existsSync(join(H.data,'tests/new-feature.test.ts')),false);
 const check=(done:string[])=>{
  const p=Bun.spawnSync(['node',join(root,'packs/firstmate/checks/done-lines-provable/run')],{cwd:H.data,stdin:Buffer.from(JSON.stringify({artifact:{type:'spec',data:{done}},params:{test_pattern:provable.params.properties.test_pattern.default,marker_pattern:provable.params.properties.marker_pattern.default}})),stdout:'pipe',stderr:'pipe'});
  assert.equal(p.exitCode,0,p.stderr.toString());return JSON.parse(p.stdout.toString());
 };
 assert.equal(check([planned]).verdict,'pass','new planned test need not exist or have run at spec time');
 assert.equal(check(['The feature works well']).verdict,'fail','missing concrete test remains rejected');
 assert.equal(check(['tests/new-feature.test.ts observes saved ID']).verdict,'fail','expected base failure remains required');
 const repo=join(H.data,'repo');mkdirSync(repo);assertTempRepo(repo);setGitHome(H.data);must(repo,['init','-q']);writeFileSync(join(repo,'value.txt'),'base');must(repo,['add','value.txt']);must(repo,['commit','-qm','base']);const head=must(repo,['rev-parse','HEAD']);
 installCode(H.engine,{dataDir:H.data,projects:new Projects(H.data)});
 const id='R-plan-fixture',ledger=new Ledger(H.data,id),x:any={run:{id},ctx:{worktree:repo,head,spec:{done:[planned]}}};
 const gate=()=>H.engine.natives['gate-failfirst']({} as any,{x} as any) as any;
 assert.equal(gate().verdict,'fail','without execution evidence build fail-first gate stays closed');
 ledger.add({run:id,node:'spec',check:'firstmate/done-lines-observable',kind:'judged',verdict:'pass',head,proves:[0],findings:[],evidence:[]} as any);
 assert.equal(gate().verdict,'fail','a spec plan PASS cannot stand in for executed fail-first');
 assert.equal(doneMap([planned],ledger.all(),head)[0].proved,false,'judged plan alone is not proof of completion');
 // Signed isolated fixture records exercise gate admission, not live execution.
 ledger.add({run:id,node:'ci',check:'firstmate/fail-first',kind:'deterministic',verdict:'pass',head:'0'.repeat(40),proves:[0],findings:[],evidence:[]} as any);
 assert.equal(gate().verdict,'fail','stale head proof does not open gate');
 ledger.add({run:id,node:'ci',check:'firstmate/fail-first',kind:'deterministic',verdict:'fail',head,proves:[],findings:[],evidence:[]} as any);
 assert.equal(gate().verdict,'fail','failed current-head execution remains blocking');
 ledger.add({run:id,node:'ci',check:'firstmate/fail-first',kind:'deterministic',verdict:'pass',head,proves:[0],findings:[],evidence:[]} as any);
 assert.equal(gate().verdict,'pass','only current-head execution-check PASS opens this fixture gate');
 for(const path of ['packs/firstmate/checks/fail-first/check.yaml','packs/firstmate/checks/gate-failfirst/check.yaml'])assert.equal((Bun.YAML.parse(readFileSync(join(root,path),'utf8')) as any).blocking,true);
 console.log('PASS spec-plan contract, nonexistent planned tests, malformed plans, spec PASS is not completion, missing/stale/failed fail-first remains blocked');
}finally{H.stop();}
