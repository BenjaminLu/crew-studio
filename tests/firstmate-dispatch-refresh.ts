import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {readFileSync} from 'node:fs';import {harness,until} from './rt-harness';import {installFirstmate} from '../src/firstmate';import {Projects} from '../src/doors';import assert from 'node:assert/strict';
process.env.CREW_TEST_IN_PROCESS='1';
const H=await harness([readFileSync(new URL('../workflows/v2/firstmate-proposal.wf.yaml',import.meta.url),'utf8'),JSON.stringify({id:'refresh-fixture',name:'Refresh fixture',version:1,roles:[],nodes:[{id:'done',kind:'hook',label:'Done'}],edges:[]})]);const E=H.engine;
let refresh=0,expiry=0,available=true,caseMode='fresh',targetProposal='';
E.deps.authorizeStart=(def:any)=>{if(def.id==='refresh-fixture'&&(!available||expiry<=Date.now()))throw Error('capability still unavailable/expired');};
const tools=installFirstmate(E,new Projects(H.data),{prepareDispatch:async()=>{refresh++;if(caseMode==='cancel'){void E.cancel(targetProposal);await Bun.sleep(10);}if(caseMode!=='expired')expiry=Date.now()+30000;}});
async function propose(key:string){const p:any=await tools.call('studio_propose_work',{workflow:'refresh-fixture',version:1,text:'local test'},{key,captain:true,text:'propose',live:()=>true});assert.ok(await until(()=>E.cards.list({run:p.proposal,open:true}).length>0));return p.proposal;}
async function approve(id:string){targetProposal=id;const card=E.cards.list({run:id,open:true})[0];await E.answer(card.id,{choice:'approve',by:'captain'});assert.ok(await until(()=>['succeeded','failed','cancelled'].includes(E.get(id)!.status)));}
try{
 expiry=0;const good=await propose('fresh');await approve(good);assert.equal(E.get(good)!.status,'succeeded');assert.ok(E.get(good)!.ctx.childRun);assert.equal(refresh,1,'fresh admission replaces expired facts after captain wait');
 caseMode='expired';expiry=0;const expired=await propose('expired');await approve(expired);assert.equal(E.get(expired)!.status,'failed');assert.equal(E.get(expired)!.ctx.childRun,undefined);
 caseMode='fresh';available=false;const bad=await propose('unavailable');await approve(bad);assert.equal(E.get(bad)!.status,'failed');assert.equal(E.get(bad)!.ctx.childRun,undefined);available=true;
 caseMode='cancel';const cancelled=await propose('cancel');await approve(cancelled);assert.equal(E.get(cancelled)!.status,'cancelled');assert.ok(!E.list().some(r=>r.params._firstmateProposal===cancelled),'owner revoked during async refresh cannot launch');
 caseMode='fresh';const replay=await propose('replay');expiry=Date.now()+30000;const child=E.start({workflow:'refresh-fixture',version:1,text:'local test',params:{_firstmateProposal:replay,_firstmateDefinition:E.get(replay)!.params.definition}});const count=refresh;expiry=0;await approve(replay);assert.equal(E.get(replay)!.ctx.childRun,child.id);assert.equal(refresh,count,'existing child replay does not refresh or launch twice');
 console.log('PASS dispatch refresh: expired admission, unavailable/expired fail closed, revoked owner, existing child replay');
}finally{for(const r of E.list())if(!['failed','cancelled','succeeded'].includes(r.status))await E.cancel(r.id);H.stop();}
