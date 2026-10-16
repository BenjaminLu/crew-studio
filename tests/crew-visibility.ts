import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {gateHarness} from './gate-harness';
const h=gateHarness();
try{
 const task:any={id:'R-fixture',title:'Fixture',workflow:'hello',status:'running',def:{nodes:[{id:'build',label:'Build',role:'developer'}]},nodes:{build:{state:'running',job:'J-main',visits:2,attempt:1}}};
 h.rt.engine.list=()=>[task];h.rt.engine.get=(id:string)=>id===task.id?task:null;
 const job=(id:string,ref:string|null,status='running')=>({id,ref,status,kind:'card:merge',title:'Merge coordinator',provider:'stub',model:'offline',started:new Date().toISOString(),tools:0,log:[]});
 for(const j of [job('J-main',task.id),job('J-nested',task.id),job('J-external',null),job('J-unknown','R-unknown'),job('J-done',task.id,'done')])h.agents.jobs.set(j.id,j as any);
 let result=(await h.api('/api/wruns/agents')).body.agents;
 assert.deepEqual(result.map((a:any)=>a.job).sort(),['J-main','J-nested']);
 assert.equal(result.find((a:any)=>a.job==='J-main').node,'build');
 assert.equal(result.find((a:any)=>a.job==='J-nested').node,null);
 console.log('PASS node owner and nested coordinator counted once; unrelated/external/completed jobs excluded');
 task.nodes.build.state='waiting';h.agents.jobs.get('J-main')!.status='done';h.agents.jobs.get('J-nested')!.status='done';
 assert.equal((await h.api('/api/wruns/agents')).body.agents.length,0);
 console.log('PASS actual endpoint clears completed jobs');
 task.status='succeeded';h.agents.jobs.get('J-nested')!.status='running';
 assert.equal((await h.api('/api/wruns/agents')).body.agents.length,0);
 console.log('PASS terminal Task never advertises stale job');
}finally{h.rt.readiness.stop();rmSync(h.data,{recursive:true,force:true});}
