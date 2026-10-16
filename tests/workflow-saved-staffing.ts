import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {gateHarness} from './gate-harness';
import {WORKFLOW_DRAFT_EXAMPLE} from '../src/workflow-draft-contract';
const h=gateHarness();
try{
 const draft:any=await h.tool('studio_draft_workflow',WORKFLOW_DRAFT_EXAMPLE);
 const saved:any=await h.tool('studio_save_workflow_draft',{draft:draft.draft});
 const id=saved.workflow??saved.id;assert.equal(typeof id,'string',JSON.stringify(saved));
 const read:any=await h.tool('studio_read_workflow',{workflow:id});assert.equal(read.editable,true);const before=structuredClone(read.workflow);const agent=before.nodes.find((n:any)=>n.kind==='agent');assert(agent);
 const patch={node:agent.id,provider:'claude',model:'claude-opus-5-5',effort:'medium'};
 const denied:any=await h.tool('studio_update_workflow_staffing',{workflow:id,base:1,nodes:[patch]},'system event',false);assert(denied.error);
 assert.equal(h.rt.defs.get(id).version,1);
 const result:any=await h.tool('studio_update_workflow_staffing',{workflow:id,base:1,nodes:[patch]});assert.equal(result.status,'saved-no-task',JSON.stringify(result));assert.equal(result.version,2);
 const after=h.rt.defs.get(id);assert.deepEqual(after.edges,before.edges);assert.deepEqual(after.intents,before.intents);assert.deepEqual(after.roles,before.roles);assert.deepEqual(h.rt.defs.get(id,1),before);assert.equal(after.nodes.find((n:any)=>n.id===agent.id).model,'claude-opus-5-5');
 const stale:any=await h.tool('studio_update_workflow_staffing',{workflow:id,base:1,nodes:[{...patch,model:'other'}]});assert(stale.error);assert.equal(h.rt.defs.get(id).version,2);
 const atomic:any=await h.tool('studio_update_workflow_staffing',{workflow:id,base:2,nodes:[{...patch,model:'other'},{node:'missing',provider:'codex'}]});assert(atomic.error);assert.equal(h.rt.defs.get(id).version,2);
 const unchanged:any=await h.tool('studio_update_workflow_staffing',{workflow:id,base:2,nodes:[patch]});assert.equal(unchanged.status,'unchanged-no-task');
 const injected:any=await h.tool('studio_update_workflow_staffing',{workflow:id,base:2,nodes:[{...patch,args:{format:'web'}}]});assert(injected.error);
 assert.equal(h.rt.engine.list().length,0);assert.equal(h.agents.jobs.size,0);
 console.log('PASS saved configuration persists, preserves old versions and graph, refuses stale/noncaptain/invalid batch, idempotent, no tasks');
}finally{h.rt.engine.disposeExternal();}
