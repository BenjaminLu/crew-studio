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

// An older release raised a Studio-bug card for a round blocked before its agent (R-066: spec → blocked, no edge);
// a refresh classifies it again with the current rules, and a terminal card can start the same request on the current release.
const legacy=await harness([Y({id:'pinned-flow',name:'Pinned flow',nodes:[{id:'spec',kind:'hook',label:'Spec',do:'blocked',x:0,y:0},{id:'end',kind:'hook',label:'End',x:1,y:0}],edges:[['spec','end','ok']]})]);
try {
 const e=legacy.engine;
 e.actions.blocked=(x:any)=>{x.rn.data.report={marker:'BLOCKED',summary:"cannot read the remote head of feature/R-066: fatal: could not read Username for 'https://github.com': terminal prompts disabled"};return 'blocked';};
 const r=e.start({workflow:'pinned-flow',text:'format EUR amounts'});
 await until(()=>!!r.failureCard&&!e.busy(r.id));
 // Model the card the older release raised: unclassified, Report and Park only.
 const first=e.cards.get(r.failureCard!)!;e.cards.cancel(first.id);r.failureCard=null;
 const old=failure('internal.unmapped','Spec ended with "blocked" and no edge takes it',{source:'engine',run:r.id,node:'spec',visit:r.nodes.spec.visits});
 r.nodes.spec.data.failure=old;
 const oldCard=e.raiseFailure(r,r.def.nodes.find(n=>n.id==='spec')!,old)!;
 e.cards.get(oldCard.id)!.options=[{id:'report',label:'Report it (diagnostics kept)',labelZh:'回報問題（保留診斷資料）',primary:true,hold:true},{id:'park',label:'Park',labelZh:'暫停（Park）',hold:true}] as any;
 // The current release has a newer version of the workflow, with the route the old one lacked.
 const v1=e.defs.get('pinned-flow')!;
 const v2=e.defs.save('pinned-flow',{...v1,base:v1.version,edges:[...v1.edges,{from:'spec',to:'end',on:'blocked'}]},'captain','route blocked');
 assert.ok(v2.version>v1.version,'a newer version exists');
 const card=e.refreshFailure(r.id)!;
 assert.notEqual(card.id,oldCard.id,'refresh replaces the stale card');
 assert.equal(e.cards.get(oldCard.id)!.status,'cancelled');
 assert.equal(card.failure!.code,'env.repository','refresh reclassifies with the current rules');
 assert.equal(r.failure!.code,'env.repository');
 assert.deepEqual(card.options.map(o=>o.id),['fix-retry','new-task','park'],'the refreshed card offers a new task on the current release');
 assert.ok(card.options.some(o=>o.id==='new-task'&&o.label==='Start a new Task with the same request'));
 assert.match(card.sections.en.how,/older version of its workflow/);
 assert.equal(e.refreshFailure(r.id)!.id,card.id,'a second refresh keeps the refreshed card');
 assert.equal(r.status,'failed');
 let woke=0;e.askFirstmate=()=>{woke++;return true;};
 await e.answer(card.id,{choice:'new-task',by:'captain'});
 const next=e.get(r.ctx.followedBy)!;
 assert.ok(next&&next.id!==r.id,'a new task started');
 assert.equal(next.version,v2.version,'the new task runs the current version');
 assert.equal(next.text,r.text);assert.equal(next.ctx.follows,r.id,'the new task links the old one');
 assert.equal(r.parked?.note,`followed by ${next.id}`);
 assert.equal(woke,0,'Firstmate is not involved');
 assert.ok(e.events(next.id).some((v:any)=>v.type==='follows'&&v.task===r.id));
 console.log('PASS an older release\'s unclassified card is reclassified on refresh and offers a new task on the current release, linked both ways');
 // A card raised under the current rules is kept by refresh, and a Studio-bug card offers the new task too.
 e.actions.blocked=()=>'blocked';
 const r2=e.start({workflow:'pinned-flow',version:v1.version,text:'internal'});
 await until(()=>!!r2.failureCard&&!e.busy(r2.id));
 const c2=e.cards.get(r2.failureCard!)!;
 assert.equal(c2.failure!.code,'internal.unmapped');
 assert.deepEqual(c2.options.map(o=>o.id),['report','new-task','park']);
 assert.equal(e.refreshFailure(r2.id)!.id,c2.id);
 console.log('PASS a card raised under the current rules is kept by refresh; a Studio-bug card offers a new task');
} finally {legacy.stop();}
