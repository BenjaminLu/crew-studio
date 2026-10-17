import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Generic deliver keeps the captain's whole requirement lineage (R-051, R-054): a note
// from round 1 is still in round 4's brief, for every producer type, and every later
// round names the parent version it edits instead of "Write <file>".
import assert from 'node:assert/strict';
import {harness,until,Y} from './rt-harness';
import {ArtifactStore} from '../src/artifacts';
import {installDeliver} from '../src/domain/deliver';
import {lineageText,LINEAGE_BUDGET} from '../src/domain/image-refinement';
const entry:Record<string,string>={document:'doc.md',web:'index.html',video:'film.html'};
const flow=(format:string)=>({id:`lineage-${format}`,name:`Lineage ${format}`,version:1,roles:[{id:'maker',label:'Maker',skill:'fixture'}],nodes:[
 {id:'intake',kind:'hook',label:'Intake',do:'deliver.intake',x:0,y:0},{id:'produce',kind:'hook',label:'Round',do:'deliver.round',x:1,y:0},
 {id:'draft',kind:'agent',label:'Draft',role:'maker',mode:'deliver',args:{format},x:2,y:0},
 {id:'ready',kind:'check',label:'Readiness',checks:[{use:'core/artifact-ready',proves:[0]}],args:{producer:'all'},x:2.5,y:0},{id:'accept',kind:'card',label:'Accept',args:{mode:'deliver-accept'},x:3,y:0},{id:'closed',kind:'hook',label:'Closed',x:4,y:0}],
 edges:[['intake','produce'],['produce','draft'],['draft','ready'],['ready','accept','pass'],['ready','accept','fail'],['accept','produce','changes'],['accept','closed','rejected']]});
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
  ok(fourth.indexOf('R1_NOTE')<fourth.indexOf('R3_NOTE')&&/v3 \S+ \[active, newest\](?: \([^)]*\))?: "R3_NOTE/.test(fourth)&&/v1 \S+ \[active, from an earlier round: still binding\](?: \([^)]*\))?: "R1_NOTE/.test(fourth),`${f}: lineage is oldest first and marks the newest note`);
  ok(notes.every(n=>fourth.split(n).length===2)&&!/Open annotations/.test(fourth),`${f}: each captain note appears once in the brief (no second copy of the parent's notes)`);
  ok(fourth.includes(`${entry[f]} in the work folder is v3`)&&!fourth.includes(`Write ${entry[f]}.`),`${f}: round 4 names the parent version it edits`);
  ok(prompts[f][0].includes(`Write ${entry[f]}.`)&&prompts[f][0].includes('Captain requirements so far: none yet.'),`${f}: round 1 writes fresh with no requirements`);
  const ref=run.ctx.deliver.draft,v4=store.version(ref.id,4) as any;
  ok(v4?.refinement?.active?.map((r:any)=>r.version).join(',')==='1,2,3',`${f}: v4 records the lineage snapshot it was built from`);
  await E.answer(E.cards.list({run:run.id,open:true}).find(c=>c.node==='accept')!.id,{choice:'reject',by:'fixture captain'});
 }
 // a long lineage stays inside the brief budget: newest active requirements kept, superseded ones collapse to ids
 { const req=(v:number,note:string,extra:any={})=>({key:`v${v}:${note}`,version:v,note,comment:`${note} `+'keep this exact long requirement wording '.repeat(8),locator:null,selector:null,bbox:null,box:null,t0:null,t1:null,status:'open',state:'active',supersedes:[],capturedFrom:'current-notes',...extra});
   const history:any[]=[];for(let v=1;v<=300;v++)history.push(req(v,`N${v}`));history[0].state='superseded';history.push(req(301,'N301',{supersedes:[{version:1,note:'N1'}]}));
   const text=lineageText({schema:1,run:'R',producer:'draft',round:302,attempt:1,intent:'',reference:null,history,active:history.filter(r=>r.state==='active')} as any);
   ok(Buffer.byteLength(text)<=LINEAGE_BUDGET,'a 300-note lineage stays within the 16000-byte brief budget',String(Buffer.byteLength(text)));
   ok(text.includes('N301 ')&&text.includes('N300 ')&&/older requirements do not fit this brief: .*v2 N2\b/.test(text)&&/consolidate/.test(text),'the newest requirements are kept and the rest are named for consolidation');
   ok(/- v1 N1 \[superseded by v301 N301\]$/m.test(text)||/v1 N1/.test(text.split('do not fit')[1]??''),'a superseded requirement collapses to its id and what replaced it'); }
 { const small=lineageText({schema:1,run:'R',producer:'d',round:3,attempt:1,intent:'',reference:null,history:[{key:'v1:A',version:1,note:'A',comment:'old colour',locator:null,bbox:null,box:null,t0:null,t1:null,status:'open',state:'superseded',supersedes:[],capturedFrom:'current-notes'},{key:'v2:B',version:2,note:'B',comment:'new colour',locator:null,bbox:null,box:null,t0:null,t1:null,status:'open',state:'active',supersedes:[{version:1,note:'A'}],capturedFrom:'current-notes'}],active:[]} as any);
   ok(/- v1 A \[superseded by v2 B\]\n/.test(small)&&!small.includes('old colour'),'a superseded requirement keeps no words, only its id',small); }
 // a note's locator reads as words in the brief, never as raw locator JSON (H12): a whole-page web note
 // names no place at all, a pointed one names its element or point on that version's page
 { const r=(v:number,note:string,locator:any,selector:string|null=null)=>({key:`v${v}:${note}`,version:v,note,comment:note+' words',locator,selector,bbox:null,box:null,t0:null,t1:null,status:'open',state:'active',supersedes:[],capturedFrom:'current-notes'});
   const web=(v:number,extra:any)=>({type:'web',url:`/af/out-r-071-design-a/${v}/index.html`,selector:null,x:null,y:null,w:null,h:null,viewport:{w:1280,h:800},...extra});
   const history=[r(2,'P1',web(2,{selector:'body'}),'body'),r(3,'P2',web(3,{selector:'#menu .item'}),'#menu .item'),r(3,'P3',web(3,{x:40,y:60,w:120,h:30})),r(3,'P4',{type:'file',path:'src/a.ts',line:4,end_line:9}),r(3,'P5',{type:'text',section:'Intro',start:10,end:40})];
   const text=lineageText({schema:1,run:'R',producer:'d',round:4,attempt:1,intent:'',reference:null,history,active:history} as any);
   ok(!/\{"type"|"x":null|"viewport"/.test(text),'no raw locator JSON reaches the brief',text);
   ok(/- v2 P1 \[[^\]]*\]: "P1 words"$/m.test(text),'a whole-page web note names no place',text);
   ok(/- v3 P2 \[[^\]]*\] \(on the v3 page at #menu \.item\): /m.test(text)&&!/selector #menu \.item; /.test(text),'a pointed web note names its element once, on that version\'s page',text);
   ok(/- v3 P3 \[[^\]]*\] \(on the v3 page at x 40, y 60, 120×30 of a 1280×800 viewport\): /m.test(text),'a point note names its box and viewport',text);
   ok(/\(in src\/a\.ts lines 4-9\)/.test(text)&&/\(in section Intro, characters 10-40\)/.test(text),'file and text locators read as places',text); }
 console.log(`deliver-lineage: ${pass} passed, 0 failed`);
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
