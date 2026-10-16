import "./lib/isolated-env.mjs";
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
import {createRuntime} from '../src/runtime';import {Agents} from '../src/agent';import {StudioLog} from '../src/rawlog';import {stubProvider} from '../src/providers/stub';
const data=mkdtempSync(join(tmpdir(),'crew-template-')),agents=new Agents(data,()=>''),rt=createRuntime({dataDir:data,agents,provider:()=>stubProvider(),defaultProvider:()=>({provider:'stub',model:null}),log:new StudioLog(join(data,'events.jsonl')),send(){},fmRoot:data,studioUrl:()=>''});
const request=async(id:string,b:any,who:any={kind:'desktop'})=>{const req=new Request('http://localhost/api/wf/'+id+'/copy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const r=await rt.handle(req,new URL(req.url),who,true);return{status:r!.status,body:await r!.json()};};
try{
 const d=rt.defs.create('my-flow','Original','captain','en',undefined,'starter');
 const bytes=readFileSync(join(data,'workflows/my-flow/v1.json'),'utf8');
 rt.defs.save(d.id,{base:1,name:'Edited',nodes:d.nodes.map(n=>({...n,label:n.label+' revised'}))},'captain');
 const c=await request(d.id,{id:'my-template',name:'Reusable',version:1,asTemplate:true});assert.equal(c.status,201);assert.equal(c.body.def.isTemplate,true);assert.equal(c.body.def.name,'Reusable');assert.deepEqual(c.body.def.nodes,d.nodes);assert.equal(c.body.def.templateSource.version,1);
 assert.equal(rt.engine.list().length,0);assert.equal(agents.jobs.size,0);assert.equal(readFileSync(join(data,'workflows/my-flow/v1.json'),'utf8'),bytes);
 const use=await request('my-template',{id:'new-flow',name:'New workflow',version:1,asTemplate:false});assert.equal(use.status,201);assert.equal(use.body.def.isTemplate,false);assert.deepEqual(use.body.def.nodes,d.nodes);assert.equal(rt.defs.catalog().find(w=>w.id==='my-template')!.isTemplate,true);
 for(const args of [{id:'my-template',name:'Overwrite',version:1,asTemplate:true},{id:'../escape',name:'Bad',version:1,asTemplate:true},{id:'missing-version',name:'Bad',version:99,asTemplate:true}])assert((await request(d.id,args)).status>=400);
 assert.equal((await request(d.id,{id:'phone-copy',name:'No',version:1,asTemplate:true},{kind:'phone'})).status,403);
 assert((await request('github-review',{id:'unsafe-copy',name:'No',version:1,asTemplate:true})).status>=400);
 assert.equal(rt.engine.list().length,0);assert.equal(agents.jobs.size,0);console.log('PASS exact-version templates, independent reuse, no task/approval copied, duplicate/path/version/phone/held-source refusals');
}finally{rt.engine.disposeExternal();rmSync(data,{recursive:true,force:true});}
