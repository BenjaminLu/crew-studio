import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {repoCfgAt,repoCfgFrom,testFilesOf,must} from '../src/domain/code';
import {testRunner} from '../src/test-command';
import {Engine} from '../src/runtime/engine';
import {CheckRegistry} from '../src/runtime/checks';
import {envPreflight} from '../src/env-preflight';
import {checkedTempDir,assertTempRepo} from './lib/git-hygiene.mjs';
const root=checkedTempDir('crew-test-inventory-'),repo=join(root,'repo'),out=join(root,'out');mkdirSync(repo);assertTempRepo(repo);mkdirSync(out);
const put=(p:string,s:string|Buffer)=>{mkdirSync(join(repo,p,'..'),{recursive:true});writeFileSync(join(repo,p),s);};
const run=(name:string,input:any)=>{const script=join(root,`${name}.cjs`);writeFileSync(script,readFileSync(join(import.meta.dir,'../packs/firstmate/checks',name,'run')));const r=Bun.spawnSync(['node',script],{stdin:Buffer.from(JSON.stringify(input)),stdout:'pipe',stderr:'pipe'});assert.equal(r.exitCode,0,r.stderr.toString());return JSON.parse(r.stdout.toString());};
try {
 const preflight=(cfg:any)=>envPreflight({cfg,done:[],has:()=>false,read:()=>null,install:false,egressHosts:[],unrestricted:false,which:()=>'/bin/sh'});
 const resolve=(files:Record<string,string>)=>repoCfgFrom(p=>files[p]??null);
 for(const files of [{},{'.crew/gates.json':'{"test":null}'},{'package.json':JSON.stringify({scripts:{test:'echo "Error: no test specified" && exit 1'}})}]) {
  const cfg=resolve(files);assert.equal(cfg.test,null);assert.equal(cfg.testError,null);assert(cfg.testSkipped);assert.deepEqual(preflight(cfg),[]);
  for(const name of ['ci','covering-suites','fail-first']){const skipped=run(name,{repo_cfg:cfg,out,workdir:repo});assert.equal(skipped.verdict,'pass');assert.equal(skipped.data.status,'not-run');assert.deepEqual(skipped.proves,[]);}
 }
 for(const files of [{'.crew/gates.json':'{"test":[]}'},{'.crew/gates.json':'{"test":"node --test"}'},{'.crew/gates.json':'not JSON'},{'package.json':'{"scripts":{"test":42}}'}]) {
  const cfg=resolve(files);assert(cfg.testError);assert(preflight(cfg).some(g=>g.code==='env.test-command'));
  for(const name of ['ci','covering-suites','fail-first']){const bad=run(name,{repo_cfg:cfg,out,workdir:repo});assert.equal(bad.verdict,'fail');assert.equal(bad.data.status,'invalid');}
 }
 const realFail=resolve({'package.json':JSON.stringify({scripts:{test:'echo "no test specified in this actual check"; exit 9'}})});assert(realFail.test);assert.equal(realFail.testSkipped,null);assert.deepEqual(preflight(realFail),[]);
 assert.equal(run('ci',{repo_cfg:realFail,out,workdir:repo,params:{shards:1}}).verdict,'fail','arbitrary failing scripts are never treated as the npm placeholder');
 assert.equal(new CheckRegistry(root).get('firstmate/lints')?.adapter?.optional,true,'bundled optional lint flag survives manifest parsing');
 must(repo,['init','-q']);put('package.json',JSON.stringify({type:'module',scripts:{test:'node --test'}}));put('value.mjs','export const value=2;');
 put('site.test.mjs',"import {test} from 'node:test';import assert from 'node:assert/strict';import {value} from './value.mjs';test('page',()=>assert.equal(value,2));");
 put('nested/unit.test.ts',"import {test} from 'node:test';test('nested',()=>{});");
 put('test/deep/check.mjs',"import {test} from 'node:test';test('test directory',()=>{});");
 put('tests/deep/check.mjs',"import {test} from 'node:test';test('tests directory',()=>{});");
 put('README.md','not valid JavaScript');put('docs/evidence.md','documentation');put('docs/screenshot.png',Buffer.concat([Buffer.from([137,80,78,71,0]),Buffer.from('\n'.repeat(5000))]));
 must(repo,['add','--','package.json','value.mjs','site.test.mjs','nested/unit.test.ts','test/deep/check.mjs','tests/deep/check.mjs','README.md','docs/evidence.md','docs/screenshot.png']);must(repo,['commit','-qm','base']);
 const base=must(repo,['rev-parse','HEAD']);const cfg=repoCfgAt(repo,base);const testFiles=testFilesOf(repo,cfg);
 assert.deepEqual(testFiles,['nested/unit.test.ts','site.test.mjs','test/deep/check.mjs','tests/deep/check.mjs']);
 // Configuration comes from the unchanged base, even if the candidate widens its own globs/command.
 put('package.json',JSON.stringify({scripts:{test:'node --test README.md'}}));put('.crew/gates.json',JSON.stringify({tests:['**'],test:['false']}));
 assert.deepEqual(testFilesOf(repo,repoCfgAt(repo,base)),testFiles);
 put('untracked.test.mjs','throw new Error("untracked must not run");');assert(!testFilesOf(repo,cfg).includes('untracked.test.mjs'));
 const paths=[{path:'site.test.mjs',status:'M'},{path:'value.mjs',status:'M'},{path:'README.md',status:'M'},{path:'docs/evidence.md',status:'M'},{path:'docs/screenshot.png',status:'A'}];
 const input:any={workdir:repo,out,repo_cfg:{...cfg,runner:testRunner(cfg),testFiles},diff:{paths},params:{max:10,shards:1},base_tree:{applicable:true,tests:[],behaviour:['value.mjs']}};
 const cover=run('covering-suites',input);assert.equal(cover.verdict,'pass',JSON.stringify(cover));assert.deepEqual(cover.data.command.slice(1),['--test','site.test.mjs']);
 input.diff.paths=[{path:'value.mjs',status:'M'}];assert.deepEqual(run('covering-suites',input).data.tests,['site.test.mjs'],'importer mapping retained');
 put('value.mjs','export const value=1;');assert.equal(run('covering-suites',input).verdict,'fail','real assertion failure still blocks');put('value.mjs','export const value=2;');input.diff.paths=paths;
 const cap=run('file-size-cap',input);assert.equal(cap.verdict,'pass');assert.deepEqual(cap.findings,[]);
 put('site.test.mjs','// line\n'.repeat(11));const tooLong=run('file-size-cap',input);assert.equal(tooLong.verdict,'fail');assert.equal(tooLong.findings[0].locator.path,'site.test.mjs');
 input.params.glob_prefix='docs/';const binary=run('file-size-cap',input);assert.equal(binary.verdict,'pass');assert.deepEqual(binary.data.skippedBinary,['docs/screenshot.png']);
 put('docs/source.txt','text\n'.repeat(11));input.diff.paths.push({path:'docs/source.txt',status:'A'});assert.equal(run('file-size-cap',input).verdict,'fail','explicit source prefix preserves text line cap');
 input.params.glob_prefix='';delete input.repo_cfg.testFiles;assert.equal(run('file-size-cap',input).findings[0].class,'test-inventory');assert.equal(run('covering-suites',input).findings[0].class,'test-inventory');
 input.repo_cfg.test=null;for(const name of ['ci','covering-suites','fail-first']){const r=run(name,input);assert.equal(r.verdict,'pass');assert.equal(r.data.status,'not-run');assert.deepEqual(r.evidence,[]);assert.deepEqual(r.proves,[]);}
 // Exercise the actual optional adapter branch; required adapters still report missing configuration.
 const fake:any={deps:{dataDir:root},readable:()=>true,expand:{'repo.lint':()=>[]}};
 const man:any={kind:'deterministic',ref:'firstmate/lints',id:'lints',adapter:{command:['{repo.lint}'],optional:true},timeout_s:5,network:false};
 const args:any=[{},man,{use:'firstmate/lints'},{workdir:repo,out,params:{}},root];
 const absent=await Engine.prototype.exec.apply(fake,args);assert.equal(absent.verdict,'pass');assert.equal(absent.data?.status,'not-run');assert.deepEqual(absent.proves,[]);assert.deepEqual(absent.evidence,[]);
 man.adapter.optional=false;assert.equal((await Engine.prototype.exec.apply(fake,args)).verdict,'error');
 man.adapter.optional=true;fake.expand['repo.lint']=()=>['node','-e','process.exit(0)'];const lintPass=await Engine.prototype.exec.apply(fake,args);assert.equal(lintPass.verdict,'pass',JSON.stringify(lintPass));
 fake.expand['repo.lint']=()=>['node','-e','process.exit(9)'];assert.equal((await Engine.prototype.exec.apply(fake,args)).verdict,'fail','configured failing lint remains blocking');
 console.log('PASS host glob inventory excludes docs/binary, keeps tracked test patterns and importers, preserves caps/assertions/lint failures, and records absent commands as not-run without proofs');
} finally {rmSync(root,{recursive:true,force:true});}
