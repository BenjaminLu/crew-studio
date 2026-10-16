import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {testRunner} from '../src/test-command';
const root=mkdtempSync(join(tmpdir(),'crew-runner-gates-')),base=join(root,'base'),head=join(root,'head'),out=join(root,'out');
const pkg=JSON.stringify({type:'module',scripts:{test:'node --test server.test.mjs'}});
for(const d of [base,head,out])mkdirSync(d);
for(const [d,value] of [[base,1],[head,2]] as const){writeFileSync(join(d,'package.json'),pkg);writeFileSync(join(d,'value.mjs'),`export const value=${value};`);writeFileSync(join(d,'server.test.mjs'),"import {test} from 'node:test';test('unchanged backend',()=>{});");writeFileSync(join(d,'site.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('changed page semantic assertion',()=>assert.equal(value,2));");}
const cfg={test:['node','--test','server.test.mjs'],testSource:'.crew/gates.json test',tests:['**/*.test.*'],shards:1,testFiles:['server.test.mjs','site.test.mjs'],selectedTests:['site.test.mjs']};
const input={workdir:head,out,repo_cfg:{...cfg,runner:testRunner(cfg)},base_tree:{applicable:true,tests:['site.test.mjs'],behaviour:['value.mjs'],path:base},diff:{paths:[{path:'site.test.mjs',status:'A'},{path:'value.mjs',status:'M'}]},params:{shards:1},spec:{done:['site.test.mjs demonstrates changed page']}};
const run=(name:string)=>{const dir=join(root,name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),'{"type":"commonjs"}');writeFileSync(join(dir,'run.cjs'),readFileSync(join(import.meta.dir,'../packs/firstmate/checks',name,'run')));const p=Bun.spawnSync(['node',join(dir,'run.cjs')],{stdin:Buffer.from(JSON.stringify(input)),stdout:'pipe',stderr:'pipe'});assert.equal(p.exitCode,0,p.stderr.toString());return JSON.parse(p.stdout.toString());};
try{
 const ff=run('fail-first');assert.equal(ff.verdict,'pass',JSON.stringify(ff));assert.deepEqual(ff.proves,[0]);assert.deepEqual(ff.data.command,['node','--test','site.test.mjs']);
 assert.equal(run('covering-suites').verdict,'pass');const ci=run('ci');assert.equal(ci.verdict,'pass');assert.equal(ci.data.shards.length,2);assert(ci.data.shards.some((s:any)=>s.command.includes('server.test.mjs')));assert(ci.data.shards.some((s:any)=>s.command.includes('site.test.mjs')));
 writeFileSync(join(head,'value.mjs'),'export const value=1;');assert.equal(run('covering-suites').verdict,'fail');assert.equal(run('ci').verdict,'fail');
 writeFileSync(join(head,'value.mjs'),'export const value=2;');writeFileSync(join(base,'site.test.mjs'),"import './missing-environment.mjs';");const env=run('fail-first');assert.equal(env.verdict,'fail');assert(env.findings.some((f:any)=>f.class==='failfirst-environment'));
 writeFileSync(join(base,'site.test.mjs'),'this is invalid JavaScript !!!');assert.equal(run('fail-first').verdict,'fail');
 const prior=structuredClone(input.repo_cfg);input.repo_cfg={...prior,test:['node','-e',`if(process.cwd().endsWith('base')){console.log('ERR_ASSERTION');setInterval(()=>{},1000);}`],runner:{custom:true},timeout_s:0.5} as any;
 assert.equal(run('fail-first').verdict,'fail','assertion text before timeout is not a completed assertion result');input.repo_cfg=prior;
 assert.equal(readFileSync(join(base,'package.json'),'utf8'),pkg);assert.equal(readFileSync(join(head,'package.json'),'utf8'),pkg);
 console.log('PASS real fail-first/covering/CI scripts select site tests, preserve backend command, reject environment-red evidence and keep manifests intact');
}finally{rmSync(root,{recursive:true,force:true});}
