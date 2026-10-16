import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import assert from 'node:assert/strict';
import {harness,until} from './rt-harness';
import {bundledText} from '../src/bundled';
import {skillTextFor} from '../src/runtime';
import {StaffingStore,coffeeStaffingProject} from '../src/domain/staffing';
import {installFirstmateStaffing} from '../src/firstmate-staffing';
import {NativeToolFailure} from '../src/host/types';
const h=await harness([bundledText('workflows/v2/coffee-kit.wf.yaml')!,bundledText('workflows/v2/firstmate-staffing.wf.yaml')!]);let passed=0;const ok=(v:unknown,n:string)=>{assert.ok(v,n);passed++;console.log('ok '+n);};
try{h.engine.deps.skillText=skillTextFor(h.data);const store=new StaffingStore(h.data),facts=async()=>[{provider:'codex',support:'supported' as const,auth:'verified',quota:'available',expires:Date.now()+60000,models:[{id:'fixture-model',efforts:['low']}]}],tools=installFirstmateStaffing(h.engine,store,()=>{throw new Error('No Git project for coffee')},facts),owner=(key:string)=>({key,captain:true,text:'All four roles use Codex',live:()=>true}),target={project:'corner-coffee',workflow:'coffee-kit',version:1};
let badProject:any;try{await tools.call('studio_staffing_interview',{...target,project:'Slow Day Coffee'},owner('bad-project'))}catch(e){badProject=e}ok(badProject instanceof NativeToolFailure&&badProject.publicFailure.code==='invalid_params'&&badProject.publicFailure.reason.en.includes('do not require Git registration')&&badProject.publicFailure.reason['zh-TW'].includes('slow-day-coffee')&&h.engine.list().length===0,'spaced coffee display name returns actionable artifact ID guidance without Git registration or work');
const first:any=await tools.call('studio_staffing_interview',target,owner('vendor-turn'));ok(first.frontier.length===4&&first.frontier.every((q:any)=>q.field==='provider'),'current coffee frontier asks four providers');
const exact={'worker.provider':'codex','image-worker.provider':'codex','reviewer.provider':'codex','designer.provider':'codex'};
const selected:any=await tools.call('studio_staffing_interview',{...target,answers:exact},owner('vendor-turn'));ok(selected.frontier.length===4&&selected.frontier.every((q:any)=>q.field==='model')&&Object.values(selected.choices).every((r:any)=>r.provider==='codex'),'exact live dotted vendor call persists four Codex choices and unlocks models');
const saved=store.interview(coffeeStaffingProject('corner-coffee'),{id:'coffee-kit',version:1,sha256:(await import('../src/domain/staffing')).staffingHash(h.defs.get('coffee-kit'))},['worker','image-worker','reviewer','designer']);ok(Object.keys(saved.choices).length===4,'choices survive source store reload');
const replay:any=await tools.call('studio_staffing_interview',{...target,answers:exact},owner('vendor-turn'));ok(replay.round===selected.round&&replay.frontier.every((q:any)=>q.field==='model'),'duplicate exact vendor call is read-only idempotent');
let wait:any;try{await tools.call('studio_staffing_interview',{...target,answers:{'worker.model':'fixture-model'}},owner('vendor-turn'))}catch(e){wait=e}ok(wait instanceof NativeToolFailure&&wait.publicFailure.code==='staffing_wait_captain','dependent model choice in same captain turn stays blocked with actionable error');
let invalid:any;try{await tools.call('studio_staffing_interview',{...target,answers:{'worker.provider':'claude','worker.model':'fixture-model'}},owner('invalid'))}catch(e){invalid=e}ok(invalid instanceof NativeToolFailure&&invalid.publicFailure.code==='staffing_answer_invalid'&&invalid.publicFailure.nextAction==='discuss_staffing','mixed or wrong-frontier input reports typed safe repair instead of generic unavailable');
const after:any=await tools.call('studio_staffing_interview',target,owner('read-after-error'));ok(JSON.stringify(after.choices)===JSON.stringify(selected.choices)&&after.round===selected.round,'rejected input preserves previously confirmed providers');
const models:any=await tools.call('studio_staffing_interview',{...target,answers:Object.fromEntries(first.frontier.map((q:any)=>[q.role,{model:'fixture-model'}]))},owner('model-turn'));ok(models.frontier.every((q:any)=>q.field==='effort'),'documented nested model answers still work');
const efforts:any=await tools.call('studio_staffing_interview',{...target,answers:Object.fromEntries(first.frontier.map((q:any)=>[q.role+'.effort','low']))},owner('effort-turn'));ok(efforts.complete&&h.engine.list().length===0,'effort completion never creates work or autoapproves configuration');
const choices=Object.fromEntries(first.frontier.map((q:any)=>[q.role,{provider:'codex',model:'fixture-model',effort:'low'}]));
let approvedHash='';for(const turn of ['approve-first','approve-identical']){
 const proposal:any=await tools.call('studio_propose_staffing',{...target,roles:choices},owner(turn));
 ok(await until(()=>h.engine.cards.list({run:proposal.proposal,open:true}).length===1&&!h.engine.busy(proposal.proposal)),'configuration awaits actual captain card');
 const card=h.engine.cards.list({run:proposal.proposal,open:true})[0];await h.engine.answer(card.id,{choice:'approve',by:'fixture captain'});
 ok(await until(()=>h.engine.get(proposal.proposal)?.status==='succeeded'),'captain approval completes configuration');
 const current=store.current(coffeeStaffingProject(target.project));if(!approvedHash)approvedHash=current.hash;else ok(current.hash===approvedHash&&current.version===1,'identical reapproval preserves existing tasks configuration binding');
}
console.log(`coffee-staffing-recovery: ${passed} passed, 0 failed`);
}finally{h.stop();}
