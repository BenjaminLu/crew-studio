import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Generic deliver keeps the captain's whole requirement lineage (R-051, R-054): a note
// from round 1 is still in round 4's brief, for every producer type, and every later
// round names the parent version it edits instead of "Write <file>".
import assert from 'node:assert/strict';
import {harness,until,Y} from './rt-harness';
import {ArtifactStore} from '../src/artifacts';
import {installDeliver} from '../src/domain/deliver';
const entry:Record<string,string>={document:'doc.md',web:'index.html',video:'film.html'};
const flow=(format:string)=>({id:`lineage-${format}`,name:`Lineage ${format}`,version:1,roles:[{id:'maker',label:'Maker',skill:'fixture'}],nodes:[
 {id:'intake',kind:'hook',label:'Intake',do:'deliver.intake',x:0,y:0},{id:'produce',kind:'hook',label:'Round',do:'deliver.round',x:1,y:0},
 {id:'draft',kind:'agent',label:'Draft',role:'maker',mode:'deliver',args:{format},x:2,y:0},
 {id:'accept',kind:'card',label:'Accept',args:{mode:'deliver-accept'},x:3,y:0},{id:'closed',kind:'hook',label:'Closed',x:4,y:0}],
 edges:[['intake','produce'],['produce','draft'],['draft','accept'],['accept','produce','changes'],['accept','closed','rejected']]});
const formats=['document','web','video'];
const H=await harness(formats.map(f=>Y(flow(f)))),E=H.engine,store=new ArtifactStore(H.data),prompts:Record<string,string[]>={};
installDeliver(E,{dataDir:H.data,artifacts:store,lane:{},fileorg:{},docs:{}} as any);
E.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,_t:any[],ctx:any){return{interrupt(){},async *send(text:string){
 const f=/DELIVER (\w+)/.exec(text)![1];(prompts[f]??=[]).push(text);
 const body=f==='document'?`# Memo\n\nRound ${prompts[f].length} memo body text.\n`:`<!doctype html><main><h1>Round ${prompts[f].length}</h1></main><script>const DUR=1;function render(t){}</script>`;
 const out:any=await H.agents.callTool(ctx.token,'work_write',{path:entry[f],content:body});assert(!out.error,JSON.stringify(out));
 yield{type:'turnEnd',status:'ok'};}};}});
let pass=0;const ok=(v:unknown,name:string)=>{assert(v,name);pass++;console.log('ok '+name);};
const notes=['R1_NOTE keep the navy palette','R2_NOTE the submit button must show a thank-you message','R3_NOTE shorten the intro'];
try{
 for(const f of formats){
  const run=E.start({workflow:`lineage-${f}`,text:`Make a ${f} fixture`});
  for(let round=1;round<=3;round++){
   assert(await until(()=>E.cards.list({run:run.id,open:true}).some(c=>c.node==='accept')&&!E.busy(run.id)),JSON.stringify(run.nodes));
   const card=E.cards.list({run:run.id,open:true}).find(c=>c.node==='accept')!;
   await E.answer(card.id,{choice:'changes',note:notes[round-1],by:'fixture captain'});
  }
  assert(await until(()=>(prompts[f]?.length??0)===4&&E.cards.list({run:run.id,open:true}).some(c=>c.node==='accept')),JSON.stringify(run.nodes));
  const fourth=prompts[f][3];
  ok(notes.every(n=>fourth.includes(n)),`${f}: round 4 brief still carries the round 1, 2 and 3 captain notes`);
  ok(fourth.indexOf('R1_NOTE')<fourth.indexOf('R3_NOTE')&&/v3 \S+ \[active, newest\]: "R3_NOTE/.test(fourth)&&/v1 \S+ \[active, from an earlier round: still binding\]: "R1_NOTE/.test(fourth),`${f}: lineage is oldest first and marks the newest note`);
  ok(fourth.includes(`${entry[f]} in the work folder is v3`)&&!fourth.includes(`Write ${entry[f]}.`),`${f}: round 4 names the parent version it edits`);
  ok(prompts[f][0].includes(`Write ${entry[f]}.`)&&prompts[f][0].includes('Captain requirements so far: none yet.'),`${f}: round 1 writes fresh with no requirements`);
  const ref=run.ctx.deliver.draft,v4=store.version(ref.id,4) as any;
  ok(v4?.refinement?.active?.map((r:any)=>r.version).join(',')==='1,2,3',`${f}: v4 records the lineage snapshot it was built from`);
  await E.answer(E.cards.list({run:run.id,open:true}).find(c=>c.node==='accept')!.id,{choice:'reject',by:'fixture captain'});
 }
 console.log(`deliver-lineage: ${pass} passed, 0 failed`);
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
