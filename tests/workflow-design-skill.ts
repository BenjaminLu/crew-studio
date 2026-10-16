import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {WORKFLOW_DRAFT_EXAMPLE} from '../src/workflow-draft-contract';import {gateHarness,until} from './gate-harness';
const h=gateHarness();
try{
 const contract:any=await h.tool('studio_workflow_draft_contract',{});assert(contract.skill.includes('firstmate-workflow-design'));assert(contract.schema.properties.workflow.properties.nodes.items.properties.mode.enum.includes('deliver'));
 const before=h.rt.drafts.list().length;
 const bad=structuredClone(WORKFLOW_DRAFT_EXAMPLE);bad.workflow.edges[2].when='approve-make';const refusal:any=await h.tool('studio_validate_workflow_draft',bad);assert.equal(refusal.valid,false);assert(refusal.problems[0].text.includes('approved'));assert.equal(h.rt.drafts.list().length,before);assert.equal(h.rt.engine.list().length,0);
 for(const proposal of [WORKFLOW_DRAFT_EXAMPLE]){
  const v:any=await h.tool('studio_validate_workflow_draft',proposal);assert.equal(v.valid,true,JSON.stringify(v));assert.equal(v.runtimeVerified,false);
  const d:any=await h.tool('studio_draft_workflow',proposal);assert(d.draft,JSON.stringify(d));assert(await until(async()=>{const v:any=await h.tool('studio_workflow_gate',{draft:d.draft});return v.gate?.stages?.find((s:any)=>s.id==='dryrun')?.status==='pass';}),JSON.stringify(await h.tool('studio_workflow_gate',{draft:d.draft})));
  const gate:any=await h.tool('studio_workflow_gate',{draft:d.draft});assert(!gate.gate.stages.slice(0,4).some((s:any)=>s.status==='fail'),JSON.stringify(gate));
 }
 assert.equal(h.rt.engine.list().length,0);assert.equal(h.agents.jobs.size,0);console.log('PASS current contract/skill discovery, non-mutating validation, exact dynamic acceptance outcomes and first four real readiness stages without a paid Task');
}finally{h.rt.engine.disposeExternal();}
