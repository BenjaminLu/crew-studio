import "./lib/isolated-env.mjs"; // first: tests never read the operator environment
// Staffing defaults for the roles that judge the work (E2E F3, F20): R-056 gave all four roles codex/gpt-6.1-sol at
// low effort, and its reviewer approved in 17 s without running anything. Defaults now start a reviewer and a
// designer at medium effort or more, staff them on another verified provider (else another model) than the worker,
// and, when only the worker's own configuration is verified, say so in the plan and on the captain's card.
//      bun tests/staffing-judge-defaults.ts
import assert from 'node:assert/strict';import {rmSync} from 'node:fs';import {join} from 'node:path';
import {harness,until} from './rt-harness';import {bundledText} from '../src/bundled';import {skillTextFor} from '../src/runtime';
import {StaffingStore,coffeeStaffingProject} from '../src/domain/staffing';import {installFirstmateStaffing,judgeEffort,staffingApprovedTurn,type StaffingFacts,type StaffingApproved} from '../src/firstmate-staffing';
process.env.CREW_TEST_IN_PROCESS='1';
let pass=0,fail=0;const ok=(v:unknown,n:string,extra='')=>{console.log(`${v?'ok':'FAIL'} ${n}${v?'':' '+extra}`);v?pass++:fail++;};
const H=await harness([bundledText('workflows/v2/coffee-kit.wf.yaml')!,bundledText('workflows/v2/firstmate-staffing.wf.yaml')!]),E=H.engine,store=new StaffingStore(H.data),def=H.defs.get('coffee-kit')!;E.deps.skillText=skillTextFor(join(H.data,'protected'));
const SOL={id:'gpt-6.1-sol',efforts:['low','medium','high']};
const codex=(models=[SOL]):StaffingFacts=>({provider:'codex',support:'supported',auth:'verified',quota:'available',expires:Date.now()+60000,models,default:{model:'gpt-6.1-sol',effort:'low'}});
const claude:StaffingFacts={provider:'claude',support:'supported',auth:'verified',quota:'available',expires:Date.now()+60000,models:[{id:'claude-opus-5-5',efforts:['low','medium','high']}],default:{model:'claude-opus-5-5',effort:'low'}};
let caps:StaffingFacts[]=[codex()];const heard:StaffingApproved[]=[];
const tools=installFirstmateStaffing(E,store,()=>{throw Error('Coffee does not use a Git registration');},async()=>caps,undefined,a=>heard.push(a)),owner=(key:string)=>({key,text:'Use available defaults',captain:true,live:()=>true});
const read=(project:string)=>tools.call('studio_staffing_interview',{project,workflow:def.id,version:def.version},owner('read-'+project)) as Promise<any>;
try{
 ok(judgeEffort('low',['low','medium','high'])==='medium'&&judgeEffort('high',['low','high'])==='high'&&judgeEffort(null,[])===null&&judgeEffort('low',['low'])==='low','a judge starts at the lowest offered effort of medium or more; a default (null) or a model without one stays');
 // R-056's facts: one verified provider and model
 const only=(await read('only-codex')).defaults;
 ok(only.available&&only.roles.worker.effort==='low'&&only.roles.reviewer.effort==='medium'&&only.roles.designer.effort==='medium',"the worker keeps the configured low effort; reviewer and designer start at medium",JSON.stringify(only.roles));
 ok(only.independence?.independent===false&&only.independence.sameAsWorker.join(',')==='reviewer,designer'&&/fresh context, not an independent opinion/.test(only.independence.note)&&/新的對話脈絡/.test(only.independence.noteZh),'with nothing else verified, the plan says the reviewer and designer are not independent of the worker',JSON.stringify(only.independence));
 const used:any=await tools.call('studio_staffing_interview',{project:'only-codex',workflow:def.id,version:def.version,defaults:'use'},owner('use'));
 const proposal:any=await tools.call('studio_propose_staffing',{project:'only-codex',workflow:def.id,version:def.version,roles:used.choices},owner('use'));
 await until(()=>E.cards.list({run:proposal.proposal,open:true}).length===1);const card=E.cards.list({run:proposal.proposal,open:true})[0];
 ok(/Not independent: reviewer and designer use the worker's own provider and model \(codex gpt-6\.1-sol\)/.test(card?.sections.en.why)&&/不是獨立審查/.test(card?.sections['zh-TW'].why),"the captain's staffing card says the review is not independent",card?.sections.en.why);
 // F5: approving the crew tells Firstmate to go on and propose the captain's work (still for the captain's approval)
 ok(heard.length===0,'nothing is heard before the captain answers');
 await E.answer(card.id,{choice:'approve',by:'captain'});await until(()=>E.get(proposal.proposal)?.status==='succeeded');
 ok(heard.length===1&&heard[0].project==='only-codex'&&heard[0].workflow===def.id&&heard[0].card===card.id&&heard[0].hash===store.current(coffeeStaffingProject('only-codex')).hash,'the approval is heard once, naming the card, project and workflow',JSON.stringify(heard));
 const turn=heard[0]?staffingApprovedTurn(heard[0]):'';
 ok(/propose it now with studio_propose_work/.test(turn)&&/still approves its dispatch card/.test(turn)&&/never the staffing/.test(turn)&&/現在就用 studio_propose_work 提出/.test(turn),"Firstmate's turn says to propose the work now, without staffing in the text, for the captain's dispatch approval",turn);
 // another verified provider: the judges go there
 caps=[codex(),claude];const two=(await read('two-providers')).defaults;
 ok(two.roles.worker.provider==='codex'&&two.roles.reviewer.provider==='claude'&&two.roles.designer.provider==='claude'&&two.roles.reviewer.effort==='medium'&&two.independence.independent===true,'with Claude verified too, reviewer and designer are staffed on Claude at medium; the worker stays on the Codex default',JSON.stringify(two.roles));
 // one provider, two models: another model
 caps=[codex([SOL,{id:'gpt-6.1-mini',efforts:['medium','high']}])];const models=(await read('two-models')).defaults;
 ok(models.roles.worker.model==='gpt-6.1-sol'&&models.roles.reviewer.model==='gpt-6.1-mini'&&models.roles.reviewer.effort==='medium'&&models.independence.independent===true,'with one provider and two verified models, the judges take the other model',JSON.stringify(models.roles));
 assert.equal(H.agents.jobs.size,0,'defaults never run a model');
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();rmSync(H.data,{recursive:true,force:true});}
console.log(`\nstaffing-judge-defaults: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
