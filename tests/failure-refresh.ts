import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {failure,FailureError} from '../src/runtime/failures';
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
 // An old unclassified refine failure can gain a typed recovery card, never auto-execution.
 e.cards.cancel(question.id);r.failureCard=null;
 const node=r.def.nodes.find(n=>n.id==='spec')!;node.kind='loop';
 const msg='the brief failed brief-quality after a coordinator root-cause turn: item 1 has only a placeholder expected change';
 r.nodes.spec.error=msg;
 const legacy=failure('internal.unmapped',msg,{source:'engine',run:r.id,node:'spec',visit:r.nodes.spec.visits});
 r.nodes.spec.data.failure=legacy;
 const old=e.raiseFailure(r,node,legacy)!;
 const recovered=e.refreshFailure(r.id)!;
 assert.notEqual(recovered.id,old.id);
 assert.equal(e.cards.get(old.id)!.status,'cancelled');
 assert.equal(e.cards.get(old.id)!.failure!.code,'internal.unmapped');
 assert.equal(recovered.failure!.code,'deterministic.brief-quality');
 assert.ok(recovered.options.some(o=>o.id==='rescope'&&o.note));
 assert.equal(e.refreshFailure(r.id)!.id,recovered.id);
 assert.equal(calls,count);assert.equal(r.status,'failed');
 assert.equal(e.trusted(r.id).entries.filter(x=>x.record==='failure-reclassified').length,1);
 await assert.rejects(e.answer(recovered.id,{choice:'rescope',by:'captain',note:''}));
 assert.equal(e.cards.get(recovered.id)!.status,'open');
 console.log('PASS historical failure refresh is idempotent, preserves failed state and history, and rejects unsafe recovery');
} finally {h.stop();}

// Simulate process death at each cross-file persistence boundary, then replay events.
const crash=await harness([Y({id:'refine-crash',name:'Refine crash',nodes:[
 {id:'source',kind:'hook',label:'Source',do:'set',args:{key:'fixture',value:true},x:0,y:0},
 {id:'fix',kind:'loop',label:'Fix',args:{producer:'source'},x:1,y:0},
 {id:'end',kind:'hook',label:'End',x:2,y:0}],edges:[['source','fix'],['fix','end','pass']]})]);
try {
 const e=crash.engine;
 e.kinds.loop={start:()=>{throw new FailureError('internal.unmapped','the brief failed brief-quality: item 1 has only a placeholder expected change');}};
 for(const boundary of ['create','cancel'] as const){
  const r=e.start({workflow:'refine-crash'});await until(()=>!!r.failureCard&&!e.busy(r.id));
  const old=r.failureCard!;
  const original=e.cards[boundary].bind(e.cards);
  (e.cards as any)[boundary]=(...args:any[])=>{const result=(original as any)(...args);throw new Error('simulated crash');};
  assert.throws(()=>e.refreshFailure(r.id),/simulated crash/);
  (e.cards as any)[boundary]=original;
  e.load();
  const card=e.refreshFailure(r.id)!;
  assert.equal(card.failure!.code,'deterministic.brief-quality');
  assert.equal(e.cards.get(old)!.status,'cancelled');
  assert.equal(e.cards.list({run:r.id,open:true}).length,1);
  assert.equal(e.must(r.id).failureCard,card.id);
  assert.equal(e.trusted(r.id).entries.filter(x=>x.record==='failure-reclassified').length,1);
  assert.equal(e.refreshFailure(r.id)!.id,card.id);
 }
 console.log('PASS failure reclassification survives card-create and card-cancel crashes after event replay');
} finally {crash.stop();}
