import "./lib/isolated-env.mjs";
import { strict as assert } from 'node:assert';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { sandboxed } from '../src/runtime/checks';
delete process.env.CREW_LOCAL_UNRESTRICTED;
const source=process.env.R088_SOURCE;
assert(source,'R088_SOURCE must name the preserved original diagnosis base/head directory');
const root=mkdtempSync(join(tmpdir(),'crew-r088-original-'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const results=[];
for(const ref of ['base','head']) {
 const cwd=join(root,ref);cpSync(join(source,ref),cwd,{recursive:true});
 const original=sha(join(source,ref,'test/shop.test.ts'));assert.equal(sha(join(cwd,'test/shop.test.ts')),original);
 const out=join(root,ref+'-out'),tmp=join(root,ref+'-tmp');mkdirSync(out);mkdirSync(tmp);
 const r=await sandboxed([process.execPath,'test'],{cwd,out,tmp,network:false,testRun:true,timeoutS:60});
 writeFileSync(join(root,ref+'.json'),JSON.stringify(r,null,2));
 assert(!r.refused&&r.code===0&&!r.timedOut,`${ref}: ${JSON.stringify(r)}`);
 assert(/\b0 fail\b/.test(r.stderr)&&!/[1-9]\d* skip/.test(r.stderr),`${ref} no failures or skips: ${r.stderr}`);
 assert(r.stderr.includes('the server euro switch preserves the basket'),`${ref}: original server test must actually run`);
 assert.equal(sha(join(cwd,'test/shop.test.ts')),original,'original assertions unchanged');
 results.push({ref,sourceShopSHA256:original,code:r.code,suite:r.stderr,log:join(root,ref+'.json')});
}
console.log(JSON.stringify({root,results},null,2));
