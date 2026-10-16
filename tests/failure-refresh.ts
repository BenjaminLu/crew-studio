import './lib/isolated-env.mjs';
import assert from 'node:assert/strict';
import {harness,until,Y} from './rt-harness';
const h=await harness([Y({id:'legacy-failure',name:'Legacy failure',nodes:[{id:'spec',kind:'hook',label:'Spec',do:'spec',x:0,y:0},{id:'end',kind:'hook',label:'End',x:1,y:0}],edges:[['spec','end','ok']]})]);
const e=h.engine;
try {
 let calls=0;
 e.actions.spec=()=>{calls++;throw new Error('the spec writer did not call spec_write');};
 const r=e.start({workflow:'legacy-failure',text:'isolated historical failure'});
 await until(()=>!!r.failureCard&&!e.busy(r.id));
 assert.equal(r.failure?.code,'deterministic.spec-missing');
 // Model an old persisted task that predates classified failure cards.
 e.cards.cancel(r.failureCard!);r.failureCard=null;r.failure=null;delete r.nodes.spec.data.failure;
 const originalSteps=JSON.stringify(r.steps),count=calls;
 const c=e.refreshFailure(r.id)!;
 assert.equal(c.captainOnly,true);assert.equal(c.kind,'failure');
 assert.equal(r.status,'failed');assert.equal(calls,count);assert.equal(JSON.stringify(r.steps),originalSteps);
 assert.equal(e.refreshFailure(r.id)!.id,c.id,'repeated refresh returns the same card');
 assert.equal(e.cards.list({run:r.id,open:true}).length,1);
 assert.ok(c.options.some(o=>o.id==='rescope'),'recovery still requires a concrete captain decision');
 r.archived={at:new Date().toISOString(),by:'test'} as any;
 assert.throws(()=>e.refreshFailure(r.id),/unarchived/);r.archived=null;
 r.ctx.firstmateQuestion={node:'spec',question:'pending'};
 assert.throws(()=>e.refreshFailure(r.id),/pending Firstmate/);delete r.ctx.firstmateQuestion;
 r.status='running';assert.throws(()=>e.refreshFailure(r.id),/ended/);r.status='failed';
 e.cards.cancel(c.id);r.failureCard=null;
 r.steps.push({...r.steps[0],node:'end'});assert.throws(()=>e.refreshFailure(r.id),/ambiguous/);r.steps.pop();
 const trusted=e.trusted.bind(e);e.trusted=(()=>({ok:false,entries:[]})) as any;
 assert.throws(()=>e.refreshFailure(r.id),/trusted/);e.trusted=trusted;
 let wakes=0;e.askFirstmate=()=>{wakes++;return true;};
 r.nodes.spec.error='ASK Which color?';delete r.nodes.spec.data.failure;
 const question=e.refreshFailure(r.id)!;
 assert.equal(question.failure?.code,'ask.escalated');assert.equal(wakes,0);
 assert.equal(r.status,'failed');assert.equal(calls,count);
 console.log('PASS historical failure refresh is idempotent, preserves failed state and history, and rejects unsafe recovery');
} finally {h.stop();}
