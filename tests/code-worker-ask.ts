import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Real build rounds, signed dispatch and restart; offline agents use token-authorized tools.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,suite,until,Y} from './rt-harness';
import {Projects} from '../src/doors';
import {installCode} from '../src/domain/code';
import {Engine} from '../src/runtime/engine';
import {must} from '../src/git';
const {ok,end}=suite('code-worker-ask');
const rejects=(fn:()=>unknown)=>{try{fn();return false;}catch{return true;}};
process.env.CREW_TEST_IN_PROCESS='1';
const flow={id:'code-firstmate',name:'Question fixture',version:1,roles:[{id:'coordinator',label:'Coordinator',skill:'test'},{id:'worker',label:'Worker',skill:'test'}],params:{project:{label:'Project'}},nodes:[
{id:'prepare',kind:'hook',do:'repo.prepare',label:'Prepare'},
{id:'spec',kind:'agent',role:'coordinator',mode:'spec',label:'Spec'},
{id:'dispatch',kind:'card',label:'Dispatch',args:{card_kind:'dispatch'},card:{title:'Dispatch',body:'Approve fixture',options:[{id:'dispatch',label:'Dispatch', labelZh: 'Dispatch'}]}},
{id:'build',kind:'agent',role:'worker',mode:'build',label:'Build',checks:[{use:'firstmate/report-schema'}]},
{id:'done',kind:'hook',label:'Done'}],edges:[['prepare','spec'],['spec','dispatch'],['dispatch','build','dispatch'],['build','done','ok']]};

for(const scenario of ['firstmate','captain','amendment','timeout','reattach']){
 const H=await harness([Y(flow)]);let E=H.engine;const repo=join(H.data,'repo');mkdirSync(repo);assertTempRepo(repo);must(repo,['init','-q','-b','main']);writeFileSync(join(repo,'README.md'),'initial\n');must(repo,['add','.']);must(repo,['commit','-qm','Initial']);
 const projects=new Projects(H.data);projects.add({id:'fixture',path:repo});
 let asked=0;const install=()=>{installCode(E,{dataDir:H.data,projects});E.policies.setProject('fixture',{install:false});E.askFirstmate=()=>{asked++;return true;};if(scenario==='timeout')E.firstmateAnswerMs=400;E.deps.provider=()=>provider;};
 const prompts:string[]=[],toolsSeen:any[]=[];
 const provider:any={id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(text:string){
 const call=(name:string,args:any)=>H.agents.callTool(ctx.token,name,args);
 if(tools.some(t=>t.name==='spec_write'))await call('spec_write',{title:'Question fixture',what:'Color one file',why:['Test answer'],done:['test.txt proves the color'],scope:['result.txt','test.txt'],door:{kind:'two-way',reason:'Fixture'},explain:{en:'Fixture','zh-TW':'測試'},zh:{title:'測試',why:['測試']}});
 else if(tools.some(t=>t.name==='worker_report')){prompts.push(text);const report=tools.find(t=>t.name==='worker_report');toolsSeen.push((args:any)=>H.agents.callTool(ctx.token,"worker_report",args));
 await call('worker_report',{marker:'ASK',summary:'Which color should I use?',...(scenario==='amendment'?{amendment:1}:{})});
 const duplicate:any=await call('worker_report',{marker:'WORKER_COMPLETE',summary:'Duplicate'});ok(!!duplicate.error,scenario+' rejects duplicate report');}
 yield{type:'turnEnd',status:'ok'};
 }}}};
 install();const r=E.start({workflow:'code-firstmate',params:{project:'fixture'}});
 try{
 ok(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.node==='dispatch')&&!E.busy(r.id)),scenario+' dispatch ready');
 const dispatch=E.cards.list({run:r.id,open:true})[0];
 // a captain's binding change on the run (tests/captain-amendment.ts records one through a real merge card)
 if(scenario==='amendment'){const node=r.def.nodes.find((n:any)=>n.id==='dispatch')!;const rec=E.record(E.x(r,node,r.nodes.dispatch),'card-answer',{actor:'captain',data:{card:'SC-0',choice:'changes',note:'use indigo'}})!;
 r.ctx.amendments=[{n:1,card:'SC-0',node:'dispatch',note:'use indigo',by:'captain',at:new Date().toISOString(),seq:rec.seq,sig:rec.sig}];}
 await E.answer(dispatch.id,{choice:'dispatch',by:'captain'});
 if(scenario==='amendment'){
 // an ASK that touches a captain's change goes straight to the captain, never to Firstmate
 ok(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.kind==='failure')&&!E.busy(r.id)),'amendment ASK raises a captain card');
 const c=E.cards.list({run:r.id,open:true}).find(c=>c.kind==='failure')!;
 ok(asked===0&&!E.get(r.id)!.ctx.firstmateQuestion&&c.failure?.code==='ask.escalated'&&/binding change A1/.test(c.failure?.escalation?.reason??''),'amendment ASK skips Firstmate and names A1 to the captain',JSON.stringify([asked,c.failure?.escalation]));
 ok(/CAPTAIN'S BINDING CHANGES[\s\S]*A1\. use indigo[\s\S]*Done when:/.test(prompts[0]),'build brief shows the captain change above the spec');
 continue;}
 const waiting=()=>!!E.get(r.id)?.ctx.firstmateQuestion&&!E.busy(r.id);
 ok(await until(waiting),scenario+' ASK skips failing checks and waits for Firstmate');
 // F25: a question waiting for Firstmate is a wait, not a failure
 ok(E.get(r.id)!.status==='waiting'&&!E.get(r.id)!.error&&!E.timeline(r.id).some((e:any)=>e.type==='failed')&&!E.cards.list({run:r.id,open:true}).length,scenario+' run waits (not failed) while Firstmate answers',JSON.stringify([E.get(r.id)!.status,E.get(r.id)!.error]));
 if(scenario==='timeout'){
 // the bounded wait: Firstmate never answers, so the question comes to the captain as the failure card
 ok(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.kind==='failure')&&!E.busy(r.id)),'unanswered question reaches the captain after the bounded wait');
 const c=E.cards.list({run:r.id,open:true}).find(c=>c.kind==='failure')!;
 ok(c.failure?.code==='ask.escalated'&&/did not answer within/.test(c.failure?.escalation?.reason??'')&&E.get(r.id)!.status==='failed'&&!E.get(r.id)!.ctx.firstmateQuestion,'the card says Firstmate did not answer in time',JSON.stringify(c.failure?.escalation));
 continue;}
 if(scenario==='reattach'){
 // restart while Firstmate is not attached: the question keeps waiting (no card), is sent once Firstmate attaches, and the deadline still holds
 let up=false;const sentBefore=asked;E=new Engine(E.deps,E.defs);install();E.firstmateAnswerMs=2500;E.askFirstmate=()=>{if(!up)return false;asked++;return true;};E.load();
 ok(E.get(r.id)!.status==='waiting'&&!!E.get(r.id)!.ctx.firstmateQuestion&&!E.cards.list({run:r.id,open:true}).length&&asked===sentBefore,'restart with Firstmate detached keeps waiting, no captain card',JSON.stringify([E.get(r.id)!.status,asked-sentBefore]));
 up=true;E.resumeFirstmateQuestions();E.resumeFirstmateQuestions();
 ok(asked===sentBefore+1,'Firstmate attaching re-sends the question exactly once',String(asked-sentBefore));
 ok(await until(()=>E.cards.list({run:r.id,open:true}).some(c=>c.kind==='failure')&&!E.busy(r.id)),'the deadline still takes the unanswered question to the captain');
 const c=E.cards.list({run:r.id,open:true}).find(c=>c.kind==='failure')!;
 ok(/did not answer within/.test(c.failure?.escalation?.reason??'')&&E.get(r.id)!.status==='failed','the card says Firstmate did not answer in time');
 continue;}
 const snapshot=JSON.stringify({spec:r.ctx.spec,def:r.def,head:r.ctx.head,admission:E.ledger(r.id).filter(e=>e.record==='scope-admission'),dispatch:E.cards.get(dispatch.id)});
 ok(rejects(()=>E.answerFromFirstmate(r.id,'build',{answer:'  '})),scenario+' blank Firstmate answer refused');
 const q=r.ctx.firstmateQuestion;r.ctx.firstmateQuestion={...q,visit:0};ok(rejects(()=>E.answerFromFirstmate(r.id,'build',{answer:'stale',visit:0})),scenario+' stale question refused');r.ctx.firstmateQuestion=q;
 const stale:any=await toolsSeen[0]({marker:'ASK',summary:'late'});ok(!!stale.error,scenario+' ended report owner refused');
 if(scenario==='captain'){
 // Restart from durable state, keeping the pending question and signed dispatch.
 const sentBefore=asked;const next=new Engine(E.deps,E.defs);E=next;install();E.load();const back=E.get(r.id)!;
 ok(back.ctx.firstmateQuestion?.question===q.question&&back.status==='waiting','restart retains pending Firstmate question and the waiting status');
 ok(asked===sentBefore+1,'restart sends the pending question to Firstmate again',String(asked-sentBefore));
 E.answerFromFirstmate(r.id,'build',{escalate:'Only the captain can pick a color',visit:q.visit});
 const c=E.cards.list({run:r.id,open:true}).find(c=>c.kind==='failure')!;
 ok(!!c&&E.get(r.id)!.status==='failed','escalation raises the captain card and the run then shows the failure');
 let blank=false;try{await E.answer(c.id,{choice:'answer',note:' ',by:'captain'});}catch{blank=true;}
 ok(blank&&E.cards.get(c.id)?.status==='open','blank captain answer leaves card open');
 await E.answer(c.id,{choice:'answer',note:'CAPTAIN-ANSWER indigo',by:'captain'});
 let duplicate=false;try{await E.answer(c.id,{choice:'answer',note:'again',by:'captain'});}catch{duplicate=true;}ok(duplicate,'captain card answered once');
 }else E.answerFromFirstmate(r.id,'build',{answer:'FIRSTMATE-ANSWER indigo',visit:q.visit});
 ok(await until(()=>prompts.length===2&&waiting()),scenario+' same build resumes with answer');
 const current=E.get(r.id)!;
 ok(JSON.stringify({spec:current.ctx.spec,def:current.def,head:current.ctx.head,admission:E.ledger(r.id).filter(e=>e.record==='scope-admission'),dispatch:E.cards.get(dispatch.id)})===snapshot,scenario+' original spec graph head admission dispatch retained');
 const answer=scenario==='captain'?'CAPTAIN-ANSWER':'FIRSTMATE-ANSWER';
 const file=JSON.parse(readFileSync(join(E.root,r.id,'briefs','round-2.json'),'utf8'));
 ok(prompts[1].includes(answer)&&file.brief===prompts[1],scenario+' actual prompt equals durable answered brief');
 ok(current.ctx.rounds[1].answer.note.includes(answer)&&E.trusted(r.id).entries.some(e=>e.record==='failure-answer'),scenario+' answer retained in round and signed ledger');
 ok(rejects(()=>E.answerFromFirstmate(r.id,'spec',{answer:'wrong step'})),scenario+' wrong step refused');
 ok(rejects(()=>E.answerFromFirstmate(r.id,'build',{answer:'OLD NOTICE answer',visit:q.visit})),scenario+' first notice cannot answer second question at same node');
 ok(rejects(()=>E.answerFromFirstmate(r.id,'build',{answer:'missing visit'})),scenario+' new questions require notice visit');
 E.answerFromFirstmate(r.id,'build',{answer:'answer again',visit:current.ctx.firstmateQuestion.visit});
 ok(await until(()=>E.get(r.id)?.failure?.code==='deterministic.round-cap'&&!E.busy(r.id)),scenario+' repeated ASK stops at existing round cap');
 ok(prompts.length===3&&!E.get(r.id)?.ctx.firstmateQuestion,scenario+' cap starts no fourth build');
 }finally{if (!["failed","succeeded","cancelled"].includes(E.get(r.id)!.status)) await E.cancel(r.id);H.stop();}
}
end();
