import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {gateHarness,until} from './gate-harness';
import {WORKFLOW_DRAFT_EXAMPLE} from '../src/workflow-draft-contract';
const h=gateHarness(),actual:string[]=[];
try{
 const original=h.rt.engine.deps.selectProvider;h.rt.engine.deps.selectProvider=async(...args:any[])=>{const p=await original(...args);return{...p,start(system:any,tools:any,ctx:any){const session=p.start(system,tools,ctx);return{...session,async *send(text:string){actual.push(text);yield*session.send(text);}};}};};
 const draft:any=await h.tool('studio_draft_workflow',WORKFLOW_DRAFT_EXAMPLE),saved:any=await h.tool('studio_save_workflow_draft',{draft:draft.draft}),id=saved.workflow??saved.id;
 const read=h.rt.defs.get(id),node=read.nodes.find((n:any)=>n.kind==='agent');await h.tool('studio_update_workflow_staffing',{workflow:id,base:1,nodes:[{node:node.id,provider:'codex',model:'fixture-model',effort:'low'}]});
 const text='Build a calm blue Hello website for families visiting on weekends.';
 const check=await h.api('/api/wruns',{workflow:id,text});assert.equal(check.status,409);assert.equal(h.rt.engine.list().length,0);
 const start=await h.api('/api/wruns',{workflow:id,text,staffingConfirm:check.body.staffing.hash});assert.equal(start.status,200,JSON.stringify(start.body));
 assert(await until(()=>h.rt.engine.cards.list({run:start.body.id,open:true}).some((c:any)=>c.node==='confirm')));const card=h.rt.engine.cards.list({run:start.body.id,open:true})[0];await h.rt.engine.answer(card.id,{choice:'begin',by:'fixture captain'});
 assert(await until(()=>actual.length>0));assert(actual.some(p=>p.includes(text)));assert.match(h.rt.engine.get(start.body.id).text,/calm blue Hello/);console.log('PASS caller task requirements reach ownBrief and the actual delivery agent prompt after explicit staffing and captain confirmation');
}finally{for(const r of h.rt.engine.list())if(!['succeeded','cancelled','failed'].includes(r.status))await h.rt.engine.cancel(r.id);h.rt.engine.disposeExternal();h.agents.cancelAll?.();}
