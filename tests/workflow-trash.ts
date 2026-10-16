import "./lib/isolated-env.mjs";
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
import {createRuntime} from '../src/runtime';import {Agents} from '../src/agent';import {StudioLog} from '../src/rawlog';import {stubProvider} from '../src/providers/stub';import {until} from './rt-harness';import {WorkflowDefs} from '../src/runtime/defs';
const data=mkdtempSync(join(tmpdir(),'crew-workflow-trash-')),agents=new Agents(data,()=>''),rt=createRuntime({dataDir:data,agents,provider:()=>stubProvider(),defaultProvider:()=>({provider:'stub',model:null}),log:new StudioLog(join(data,'events.jsonl')),send(){},fmRoot:data,studioUrl:()=>''});
const request=async(path:string,b?:any,who:any={kind:'desktop'},method=b===undefined?'GET':'POST')=>{const req=new Request('http://localhost'+path,{method,headers:{'content-type':'application/json'},...(b===undefined?{}:{body:JSON.stringify(b)})});const r=await rt.handle(req,new URL(req.url),who,b!==undefined);return{status:r!.status,body:await r!.json()};};
const trash=(id:string,base:number,revision=0,restore=false,who?:any)=>request('/api/wf/'+id+'/'+(restore?'restore':'trash'),{base,revision},who);
try{
 const def=rt.defs.create('my-flow','My flow','captain','en',undefined,'starter');
 const before=readFileSync(join(data,'workflows/my-flow/v1.json'),'utf8');
 const run=rt.engine.start({workflow:def.id,version:1});assert(await until(()=>rt.engine.cards.list({run:run.id,open:true}).length===1));
 const pinned=JSON.stringify(run.def),first=rt.engine.cards.list({run:run.id,open:true})[0];
 rt.defs.save(def.id,{base:1,name:'Latest flow'},'captain');const latest=readFileSync(join(data,'workflows/my-flow/v2.json'),'utf8');
 assert.equal((await trash(def.id,1)).status,409,'stale version cannot trash latest work');
 assert.equal((await trash(def.id,2,0,false,{kind:'phone'})).status,403);
 for(const id of ['documents','firstmate-proposal','hello-crew-studio'])assert.equal((await trash(id,rt.defs.get(id)!.version)).status,409);
 assert.equal((await request('/api/wf/my-flow/trash',undefined,undefined,'GET')).status,405);
 assert.equal((await trash(def.id,2)).status,200);
 let list=(await request('/api/wf')).body;assert(!list.workflows.some((w:any)=>w.id===def.id));assert(list.trash.some((w:any)=>w.id===def.id&&w.trashRevision===1));
 assert.equal(new WorkflowDefs(data).trashed(def.id),true,'Trash persists across store restart');
 assert.equal(rt.defs.selectable(def.id,1),false);assert.equal(rt.defs.get(def.id,1)!.name,'My flow');
 assert.equal(readFileSync(join(data,'workflows/my-flow/v1.json'),'utf8'),before);assert.equal(readFileSync(join(data,'workflows/my-flow/v2.json'),'utf8'),latest);assert.equal(JSON.stringify(run.def),pinned);
 assert.throws(()=>rt.engine.start({workflow:def.id,version:1}),/Trash/);
 assert.equal((await request('/api/wruns',{workflow:def.id,version:1})).status,409);
 assert.throws(()=>rt.defs.save(def.id,{base:2,name:'hidden edit'},'captain'),/Restore/);
 const count=rt.engine.list().length;
 await assert.rejects(()=>rt.firstmate.call('studio_propose_work',{workflow:def.id,version:1,text:'Create new work'},{key:'trash-proposal',captain:true,text:'Create new work',live:()=>true}),/Choose an installed workflow/);
 assert.equal(rt.engine.list().length,count);
 await rt.engine.answer(first.id,{choice:'continue',by:'captain'});assert(await until(()=>run.status==='succeeded'),'existing pinned Task continues after trash');assert.equal(JSON.stringify(run.def),pinned);
 assert.equal((await trash(def.id,2,0,true)).status,409);assert.equal((await trash(def.id,1,1,true)).status,409);
 assert.equal((await trash(def.id,2,1,true)).status,200);
 assert.equal((await trash(def.id,2,0)).status,409,'ABA stale delete refused after restore');
 list=(await request('/api/wf')).body;assert(list.workflows.some((w:any)=>w.id===def.id));assert(!list.trash.some((w:any)=>w.id===def.id));
 const restored=rt.engine.start({workflow:def.id,version:2});assert(await until(()=>rt.engine.cards.list({run:restored.id,open:true}).length===1));await rt.engine.cancel(restored.id);
 // A Firstmate-origin personal workflow is equally recoverable; no producer needs to run.
 const drafted=rt.defs.createDrafted('drafted-flow',def,'captain',{schema:1,source:'firstmate-draft'});
 assert.equal((await trash(drafted.id,1)).status,200);assert.equal((await trash(drafted.id,1,1,true)).status,200);
 assert.equal(agents.jobs.size,0);console.log('PASS recoverable personal workflow Trash, immutable versions and pinned Task continuation, restored Start, CAS/phone/builtin/method/new Task/Firstmate refusals');
}finally{rt.engine.disposeExternal();rmSync(data,{recursive:true,force:true});}
