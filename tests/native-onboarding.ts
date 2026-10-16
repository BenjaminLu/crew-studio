import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Real source APIs/Engine/captain cards. All provider callbacks are offline fixtures.
import {strict as assert} from 'node:assert';
import {readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {harness,Y,until} from './rt-harness';import {bundledText} from '../src/bundled';
import {Onboarding} from '../src/onboarding';import {ArtifactStore} from '../src/artifacts';
import {installFirstmate} from '../src/firstmate';import {Projects} from '../src/doors';
import {StaffingStore,staffingHash,coffeeStaffingProject} from '../src/domain/staffing';
const target={id:'onboarding-cancel',name:'Cancellation boundary only',kind:'coffee-kit',version:1,params:{project:{label:'Project'},coffeeDesignPlan:{label:'Discussed plan'}},roles:[{id:'worker',label:'Worker',skill:'pack:coffee-kit/skills/website.md'}],nodes:[{id:'direction',kind:'card',label:'Captain decision',x:1,y:1,card:{options:[{id:'confirm',label:'Confirm'}]}}],edges:[]};
const h=await harness([Y(target),bundledText('workflows/v2/firstmate-proposal.wf.yaml')!]);let passed=0;const ok=(name:string,f:()=>void)=>{f();passed++;console.log('PASS '+name);};
try {
 const artifacts=new ArtifactStore(h.data),journey=new Onboarding(h.engine,artifacts),store=new StaffingStore(h.data),project=coffeeStaffingProject('cancel-project'),def=h.defs.get(target.id)!;
 journey.choose('coffee');ok('caller cannot bind missing or foreign work',()=>{assert.throws(()=>journey.proposal('R-999'));assert.equal(journey.view().stage,'discuss');assert.equal(h.engine.list().length,0);});
 const skill=store.remember({ref:target.roles[0].skill,version:1,text:h.engine.deps.skillText(target.roles[0].skill)});
 store.approve({schema:1,algorithm:'sha256-canonical-v1',project,workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles:{worker:{provider:'codex',model:'offline-model',effort:'low',skill}},review:{freshContexts:3,distinctProviders:false}},null,{run:'fixture',card:'fixture-staffing',answerSeq:1});
 const tools=installFirstmate(h.engine,new Projects(h.data),{onCoffeeProposal:id=>journey.proposal(id),onCoffeeDispatch:(proposal,task)=>journey.dispatch(proposal,task)}),design=JSON.parse(readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8'));
 const p:any=await tools.call('studio_propose_work',{workflow:def.id,version:def.version,text:'Captain cancellation proof',params:{project:project.id,coffeeDesignPlan:JSON.stringify(design)}},{key:'cancel-proof',captain:true,text:'Explicit offline captain brief',live:()=>true,signal:new AbortController().signal});
 assert(await until(()=>h.engine.cards.list({run:p.proposal,open:true}).length===1));const card=h.engine.cards.list({run:p.proposal,open:true})[0];
 ok('mere proposal cannot certify completion',()=>{assert.equal(journey.view().stage,'confirm');assert.equal(journey.view().complete,false);});
 await h.engine.answer(card.id,{choice:'approve',by:'offline captain'});assert(await until(()=>!!journey.view().task));const task=journey.view().task!;await h.engine.cancel(task,'offline captain cancels');
 ok('actual cancellation is a retained hold, never completed work',()=>{assert.equal(journey.view().stage,'hold');assert.equal(journey.view().complete,false);assert.equal(h.engine.get(task)!.status,'cancelled');});
 const count=h.engine.list().length;journey.pause(true);journey.pause(false);journey.dispatch(p.proposal,task);
 ok('reload/resume/replayed dispatch keep cancelled identity without replacement',()=>{const reload=new Onboarding(h.engine,artifacts);assert.equal(reload.view().task,task);assert.equal(reload.view().stage,'hold');assert.equal(h.engine.list().length,count);});
 ok('another child cannot overwrite the durable dispatch',()=>assert.throws(()=>journey.dispatch(p.proposal,'R-999')));
 console.log(`native onboarding cancellation: ${passed}/0`);
}finally{for(const r of h.engine.list())if(!['succeeded','failed','cancelled'].includes(r.status))await h.engine.cancel(r.id,'fixture cleanup');h.stop();rmSync(h.data,{recursive:true,force:true});}
// The positive path uses the full shared-plan/staffing/media/review/refine fixture,
// created through native Firstmate dispatch, not manufactured acceptance-card JSON.
process.env.COFFEE_ONBOARDING='1';await import('./native-coffee-kit');
