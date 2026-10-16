import "./lib/isolated-env.mjs";
import {checkedTempDir,assertTempRepo} from './lib/git-hygiene.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {selectTestCommand,prepareTestBase} from '../src/test-command';
import {must} from '../src/git';
const root=checkedTempDir('runner-selection-'),repo=join(root,'repo');mkdirSync(repo);assertTempRepo(repo);
try{
 const cfg={test:['/bin/sh','-c','wrapper','crew-test','node --test server.test.mjs'],testSource:'package.json scripts.test: node --test server.test.mjs'};
 assert.deepEqual(selectTestCommand(cfg,['site.test.mjs']),['node','--test','site.test.mjs']);
 assert.equal(selectTestCommand({test:null,testSource:null}),null);
 assert.throws(()=>selectTestCommand({...cfg,test:[...cfg.test.slice(0,-1),'npm run other']},['site.test.mjs']),/cannot select/);
 writeFileSync(join(repo,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --test server.test.mjs'}}));
 writeFileSync(join(repo,'value.mjs'),'export const value=1;');writeFileSync(join(repo,'server.test.mjs'),'');
 must(repo,['init','-q','-b','main']);must(repo,['add','.']);must(repo,['commit','-qm','base']);const base=must(repo,['rev-parse','HEAD']);
 writeFileSync(join(repo,'value.mjs'),'export const value=2;');
 writeFileSync(join(repo,'site.test.mjs'),"import assert from 'node:assert/strict';import {value} from './value.mjs';assert.equal(value,2,'semantic changed value');");
 writeFileSync(join(repo,'package.json'),JSON.stringify({type:'module',scripts:{test:'exit 99'}}));
 const copy=prepareTestBase(repo,join(root,'base-copy'),base,['**/*.test.*']);
 assert.equal(JSON.parse(readFileSync(join(copy,'package.json'),'utf8')).scripts.test,'node --test server.test.mjs');
 const command=selectTestCommand(cfg,['site.test.mjs'])!;
 const red=Bun.spawnSync(command,{cwd:copy,stdout:'pipe',stderr:'pipe'}),green=Bun.spawnSync(command,{cwd:repo,stdout:'pipe',stderr:'pipe'});
 assert.notEqual(red.exitCode,0);assert.match(red.stdout.toString()+red.stderr.toString(),/semantic changed value/);assert.equal(green.exitCode,0);
 assert.equal(must(repo,['rev-parse','HEAD']),base);assert.equal(readFileSync(join(repo,'value.mjs'),'utf8'),'export const value=2;');
 console.log('PASS exact Node file selection; candidate tests red on base source, green on head; base manifest and real checkout preserved');
}finally{rmSync(root,{recursive:true,force:true});}
