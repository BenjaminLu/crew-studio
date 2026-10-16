import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'crew-callers-'));
const put=(p,s)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);};
try {
 put("check.cjs",readFileSync("packs/firstmate/checks/caller-coverage/run"));
 put('src/runtime/index.ts','export const x=1;');put('src/other/index.ts','export const x=2;');
 put('src/real.ts','import {x} from "./runtime/index";');
 put('src/dynamic.ts','const x = import("./runtime/index.js");');
 put('src/unrelated.ts','import {x} from "./other/index";');
 put('src/multiline.ts','import {\n x\n} from \"./runtime/index\";');
 put('src/quoted.ts',`const example = \"import(\\\"./runtime/index\\\")\";`);
 put('src/comment.ts','// import {x} from "./runtime/index";');
 put('docs/note.md','import src/runtime/index.ts');put('tests/fixture/history.log','import src/runtime/index.ts');
 const run=(scope,verificationScope)=>{const r=spawnSync(process.execPath,[join(root,'check.cjs')],{input:JSON.stringify({workdir:root,artifact:{data:{scope,verificationScope}},params:{exts:['.ts','.sh','.py']}}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 put('src/require.cjs','const x=require("./runtime/index");');
 put('src/reexport.ts','export {x} from "./runtime/index";');
 put('src/template.ts','const x=import(`./runtime/index`);');
 put('lib.sh','echo hello');put('caller','#!/bin/sh\n. ./lib.sh');
 put('pkg/helper.py','x=1');put('pkg/relative.py','from . import helper');put('pkg/absolute.py','import pkg.helper');put('pkg/from.py','from pkg.helper import x');
 put('pkg/comment.py','import pkg.helper # needed');put('pkg/multi.py','from . import (\n helper,\n)');
 put('conditional.sh','if true; then source ./lib.sh; fi');put('absolute.sh',`source "${root}/lib.sh"`);
 put('src/assets.gen.ts',`import asset from './runtime/index.ts' with { type: 'file' }; export const ASSETS={asset};`);
 put('src/json-asset.ts',`import asset from './other/index.ts' with { type: 'json' };`);
 assert.equal(run(['src/other/index.ts']).verdict,'fail','non-file imports remain covered');
 const r=run(['src/runtime/index.ts']);assert.equal(r.verdict,'fail');assert.deepEqual(r.findings.map(f=>f.locator.path).sort(),['src/dynamic.ts','src/multiline.ts','src/real.ts','src/reexport.ts','src/require.cjs','src/template.ts']);
 assert.equal(run(['src/runtime/index.ts','src/dynamic.ts','src/multiline.ts','src/real.ts','src/reexport.ts','src/require.cjs','src/template.ts']).verdict,'pass');
 assert.deepEqual(run(['lib.sh']).findings.map(f=>f.locator.path),['absolute.sh','caller','conditional.sh']);
 assert.deepEqual(run(['pkg/helper.py']).findings.map(f=>f.locator.path).sort(),['pkg/absolute.py','pkg/comment.py','pkg/from.py','pkg/multi.py','pkg/relative.py']);
 const callers=['src/dynamic.ts','src/multiline.ts','src/real.ts','src/reexport.ts','src/require.cjs','src/template.ts'];
 assert.equal(run(['src/runtime/index.ts'],callers).verdict,'pass','read-only callers need no write reservation');
 assert.equal(run(['lib.sh'],['absolute.sh','caller','conditional.sh']).verdict,'pass','shell callers can be verified read-only');
 assert.equal(run(['pkg/helper.py'],['pkg/absolute.py','pkg/comment.py','pkg/from.py','pkg/multi.py','pkg/relative.py']).verdict,'pass');
 const missing=run(['src/runtime/index.ts'],callers.filter(p=>p!=='src/real.ts'));
 assert.equal(missing.verdict,'fail');assert.deepEqual(missing.findings.map(f=>f.locator.path),['src/real.ts']);
 assert.match(missing.findings[0].expected,/read-only verificationScope/);
 put('src/downstream.ts','import "./real";');
 assert.equal(run(['src/runtime/index.ts'],callers).verdict,'pass','verification impact must not recursively become shared write roots');
 assert.equal(run(['src/runtime/index.ts',...callers]).verdict,'fail','write callers still seed shared roots');
 for(const invalid of ['src/**','src/*','src/real.?s','src/[real].ts','src/{real}.ts','src','src/','../src/real.ts','src/../src/real.ts','./src/real.ts',resolve(root,'src/real.ts'),'src/missing.ts','src\\real.ts',42,null]) {
   const result=run(['src/runtime/index.ts'],[...callers,invalid]);
   assert.equal(result.verdict,'fail',`invalid verification path ${invalid}`);
   assert.equal(result.findings[0].class,'invalid-verification-scope');
 }
 for (const invalid of ['src/real.ts',null,{},42]) assert.equal(run(['src/runtime/index.ts'],invalid).findings[0].class,'invalid-verification-scope','array required');
 symlinkSync(process.execPath,join(root,'outside-link'));
 assert.equal(run(['src/runtime/index.ts'],[...callers,'outside-link']).findings[0].class,'invalid-verification-scope','external symlink rejected');
 assert.equal(run(['src/runtime/index.ts','src/**']).verdict,'pass','legacy scope globs remain supported');
 console.log('PASS exact caller checks, read-only verification scope, non-recursive impact, and invalid path rejection');
} finally {rmSync(root,{recursive:true,force:true});}
