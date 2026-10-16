import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// W3: page save, inline edits and model revisions of one draft share one lock.
// Another process holds the draft's lock while it writes a newer revision; save must wait for it
// and save that newer revision, never the stale one it would have read without the lock.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowDefs} from '../src/runtime/defs';
import {WorkflowDrafts} from '../src/workflow-drafts';
let pass=0,fail=0;const ok=(v:any,n:string,d='')=>{console.log(`${v?'  ok   ':'  FAIL '} ${n}${v?'':' '+d}`);v?pass++:fail++;};
const data=mkdtempSync(join(tmpdir(),'crew-draft-lock-'));
try{
 const defs=new WorkflowDefs(data),drafts=new WorkflowDrafts(data,defs);
 const fixture=JSON.parse(readFileSync(join(import.meta.dir,'fixture/first-workflow-draft.json'),'utf8'));
 const d=drafts.draft(fixture,'lock-test');const file=join(drafts.dir,d.id+'.json');
 const lockName=(drafts as any).lockName?.(d.id)??'draft-'+d.id;
 const holder=Bun.spawn(['bun','-e',`const {withLock}=await import(${JSON.stringify(join(import.meta.dir,'../src/ids.ts'))});const fs=require('node:fs');withLock(${JSON.stringify(drafts.dir)},${JSON.stringify(lockName)},()=>{console.log('held');const x=JSON.parse(fs.readFileSync(${JSON.stringify(file)},'utf8'));Bun.sleepSync(600);x.revision++;x.def.nodes[1].label='Changed under the lock';fs.writeFileSync(${JSON.stringify(file)},JSON.stringify(x));});`],{stdout:'pipe'});
 const reader=holder.stdout.getReader();await reader.read();// the other process holds the lock now
 let saved:any,error:any;try{saved=drafts.save(d.id,'captain',d.revision+1);}catch(e){error=e;}
 await holder.exited;
 const after=JSON.parse(readFileSync(file,'utf8'));
 ok(!error,'save waits for the draft lock and then saves',String(error?.message));
 ok(after.saved?.workflow===saved?.workflow&&after.saved?.revision===2,'the saved record names the revision written under the lock',JSON.stringify(after.saved));
 const wf=saved?defs.get(saved.workflow):null;ok(wf?.nodes.find(n=>n.id==='draft')?.label==='Changed under the lock','the workflow is the newer revision, not a stale read');
}finally{rmSync(data,{recursive:true,force:true});}
console.log(`first-workflow-draft-lock: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
