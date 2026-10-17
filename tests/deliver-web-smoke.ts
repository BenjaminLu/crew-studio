import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Web prototypes are interaction-tested (R-053: "submit does nothing" for three rounds). A headless
// browser loads the page, performs the primary action the captain named and checks the DOM changed;
// a dead action is a blocking finding for the refine loop, and no renderer is "not run", never a pass.
import assert from 'node:assert/strict';
import {harness,until,Y} from './rt-harness';
import {ArtifactStore} from '../src/artifacts';
import {installDeliver,primaryActions} from '../src/domain/deliver';
import {renderEnv,runRender} from '../src/render';
import {TAB_CSP} from '../src/preview-csp';
import {mkdirSync,writeFileSync} from 'node:fs';
let pass=0;const ok=(v:unknown,name:string,detail='')=>{assert(v,`${name} ${detail}`);pass++;console.log('ok '+name);};
const acts=primaryActions(['A signup page. The submit button must show a thank-you message.','Clicking the "Book now" button opens the booking form']);
ok(acts.map(a=>`${a.kind}:${a.text}`).join(',')==='submit:submit,click:Book now'&&acts[0].said.includes('thank-you'),'primary actions come from the captain\'s words',JSON.stringify(acts));
ok(!primaryActions(['A calm landing page about tea']).length,'a page with no named action has no smoke actions');
ok(!primaryActions(['Remove the Book now button.','Make the submit button bigger and blue.']).length,'a note that removes or restyles a control asks no click of it');
ok(primaryActions(['Remove the banner. The Book now button must open the booking form.']).map(a=>a.text).join()==='Book now','only the sentence that asks the control to work counts');
const flow={id:'web-smoke',name:'Web smoke',version:1,roles:[{id:'designer',label:'Designer',skill:'fixture'}],nodes:[
 {id:'intake',kind:'hook',label:'Intake',do:'deliver.intake',x:0,y:0},{id:'produce',kind:'hook',label:'Round',do:'deliver.round',x:1,y:0},
 {id:'draft',kind:'agent',label:'Draft',role:'designer',mode:'deliver',args:{format:'web'},x:2,y:0},
 {id:'checks',kind:'check',label:'Readiness',join:'all',checks:[{use:'core/artifact-ready',proves:[0]}],args:{producer:'all'},x:3,y:0},
 {id:'accept',kind:'card',label:'Accept',args:{mode:'deliver-accept'},x:4,y:0},{id:'failed',kind:'hook',label:'Failed',x:4,y:1},{id:'closed',kind:'hook',label:'Closed',x:5,y:0}],
 edges:[['intake','produce'],['produce','draft'],['draft','checks'],['checks','accept','pass'],['checks','failed','fail'],['accept','closed','rejected']]};
const H=await harness([Y(flow)]),E=H.engine,store=new ArtifactStore(H.data);
installDeliver(E,{dataDir:H.data,artifacts:store,lane:{},fileorg:{},docs:{}} as any);
const form=(script:string)=>`<!doctype html><html><body><main><h1>Join the club</h1><form id="f"><label>Email <input type="email" name="email" required></label><button type="submit">Submit</button></form><p id="out"></p></main><script>${script}</script></body></html>`;
const clock="setInterval(()=>{document.getElementById('clock').textContent=String(Date.now());},50);";
const pages:Record<string,string>={clock:form(clock+"document.getElementById('f').addEventListener('submit',e=>e.preventDefault());").replace('<p id="out">','<p id="clock"></p><p id="out">'),
 hang:form("document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();for(;;){}});"),dead:form("document.getElementById('f').addEventListener('submit',e=>e.preventDefault());"),
 live:form("document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();document.getElementById('out').textContent='Thank you for joining!';});")};
let current='dead';
E.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,_t:any[],ctx:any){return{interrupt(){},async *send(){
 const out:any=await H.agents.callTool(ctx.token,'work_write',{path:'index.html',content:pages[current]});assert(!out.error,JSON.stringify(out));
 yield{type:'turnEnd',status:'ok'};}};}});
const intent='A signup page. The submit button must show a thank-you message.';
const end=async(page:string)=>{current=page;const run=E.start({workflow:flow.id,text:intent});assert(await until(()=>run.status!=='running'||E.cards.list({run:run.id,open:true}).length>0,60000),JSON.stringify(run.nodes));
 const findings=E.ledger(run.id).filter(e=>e.check==='core/artifact-ready').flatMap(e=>e.findings??[]) as any[];return{run,findings,card:E.cards.list({run:run.id,open:true}).find(c=>c.node==='accept')};};
try{
 const env=renderEnv();
 if(!env.canCrop)console.log('NOT RUN: real browser cases (no Node + Playwright here); the not-run path below still runs');
 else{
  const dead=await end('dead');const f=dead.findings.find(x=>x.class==='web-interaction');
  ok(dead.run.nodes.failed?.state==='passed'&&!dead.card&&f?.severity==='blocking'&&/submit button.*changed nothing/.test(f.message)&&/thank-you/.test(f.expected),'a submit that does nothing is a blocking web-interaction finding the refine loop gets back (R-053)',JSON.stringify(dead.findings));
  const live=await end('live');
  ok(live.card&&!live.findings.length&&/Interaction smoke: submit changed the page/.test(live.card.body),'a submit that shows a thank-you passes and the accept card says what was clicked',JSON.stringify(live.findings)+(live.card?.body??''));
  await E.answer(live.card!.id,{choice:'reject',by:'fixture captain'});
  // R-071: the smoke runs the page under the captain's preview-tab sandbox and CSP. An order form whose submit
  // handler reveals a summary works there (allow-forms); with allow-forms gone the browser never fires submit,
  // and the smoke must say the submit is dead instead of passing a page the captain cannot use.
  const orderDir=`${H.data}/fixture-order`;mkdirSync(orderDir,{recursive:true});
  writeFileSync(`${orderDir}/index.html`,`<!doctype html><html><body><h1>巷口豆花</h1><form id="order"><label>Name <input name="name" required></label><select name="item"><option>花生豆花</option></select><button type="submit">送出訂單</button></form><section id="summary" hidden></section><script>document.getElementById('order').addEventListener('submit',e=>{e.preventDefault();const s=document.getElementById('summary');s.textContent='訂單摘要：'+new FormData(e.target).get('item');s.hidden=false;});</script></body></html>`);
  const smoke=async(csp?:string)=>(await runRender(H.data,'interact',{html:`${orderDir}/index.html`,actions:JSON.stringify([{kind:'submit',text:'submit'}]),...(csp?{csp}:{})}).done).info?.results?.[0];
  const underTab=await smoke();
  ok(underTab?.found&&underTab.changed&&/訂單摘要/.test(underTab.text),'under the preview-tab policy (sandbox allow-forms, form-action none) an order form\'s own submit handler runs and shows its summary',JSON.stringify(underTab));
  const noForms=await smoke(TAB_CSP.replace(' allow-forms',''));
  ok(TAB_CSP.includes('allow-forms')&&noForms?.found&&!noForms.changed&&!/訂單摘要/.test(noForms.text??''),'with allow-forms removed from the sandbox the smoke reports the submit dead (the browser never fires it)',JSON.stringify(noForms));
  const clockRun=await end('clock');
  ok(clockRun.findings.some(x=>x.class==='web-interaction'),'a page that changes on its own (a ticking clock) still fails a dead submit: only changes the click causes count',JSON.stringify(clockRun.findings));
  process.env.CREW_INTERACT_TIMEOUT_MS='6000';const t0=Date.now(),hung=await end('hang');delete process.env.CREW_INTERACT_TIMEOUT_MS;
  const s:any=Object.values(hung.run.ctx.webSmoke??{})[0];
  ok(Date.now()-t0<60000&&s?.status==='not-run'&&/did not answer: the smoke timed out after 6 s/.test(s.reason)&&hung.card&&/Interaction smoke not run: the page did not answer/.test(hung.card.body),'a page whose handler hangs is stopped at the smoke limit and reported not run, never a pass',JSON.stringify(s));
  await E.answer(hung.card!.id,{choice:'reject',by:'fixture captain'});
  // cancelling the Task stops the browser at once
  current='hang';process.env.CREW_INTERACT_TIMEOUT_MS='120000';const run=E.start({workflow:flow.id,text:intent});
  const script=`${H.data}/tools/render.mjs`,alive=()=>Bun.spawnSync(['pgrep','-f',script]).stdout.toString().trim().length>0;
  assert(await until(alive,30000),'the smoke browser starts');const t1=Date.now();await E.cancel(run.id,'fixture cancel');
  ok(await until(()=>!alive(),10000)&&Date.now()-t1<10000,'cancelling the Task kills the smoke browser',String(Date.now()-t1));delete process.env.CREW_INTERACT_TIMEOUT_MS;
 }
 process.env.CREW_RENDER_STUB='1';
 const stub=await end('dead');
 ok(stub.card&&!stub.findings.some(x=>x.class==='web-interaction')&&/Interaction smoke not run: renderer unavailable/.test(stub.card.body)&&!/Proved by checks:[^]*interaction/i.test(stub.card.body.split('Needs your eye')[0]),'without a renderer the smoke is "not run" on the card, never a pass',stub.card?.body);
 ok(stub.run.ctx.webSmoke&&Object.values(stub.run.ctx.webSmoke).every((s:any)=>s.status==='not-run'),'the run records the smoke as not run');
 console.log(`deliver-web-smoke: ${pass} passed, 0 failed`);
}finally{delete process.env.CREW_RENDER_STUB;for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
