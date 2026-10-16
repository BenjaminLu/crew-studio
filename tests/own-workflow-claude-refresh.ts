import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {harness,Y,until} from './rt-harness';
import {ProviderRefusal} from '../src/providers/policy';
import {fold} from '../src/runtime/engine';
import {installOwnClaudeGrants,ownClaudePlan,refreshOwnWorkflowClaude} from '../src/providers/own-workflow-claude-refresh';
process.env.CREW_TEST_IN_PROCESS='1';
const pair={model:'claude-opus-5-5',effort:'medium'},input:any={role:'writer',explicit:true,provider:'claude',...pair};
const cap:any={provider:'claude',available:true,auth:'verified',quota:'unknown',models:[],at:Date.now(),expires:Date.now()+30000};
const flow={id:'personal-claude',name:'Personal',version:1,origin:{schema:1,source:'starter'},roles:[{id:'writer',label:'Writer',skill:'fixture'}],nodes:[{id:'write-a',kind:'agent',role:'writer',mode:'test',label:'Write',x:0,y:0,provider:'claude',...pair},{id:'done',kind:'hook',label:'Done',x:1,y:0}],edges:[['write-a','done']]};
async function fixture(granted=true){const H=await harness([Y(flow)]),E=H.engine,G=installOwnClaudeGrants(E);let x:any,release:any,reject:any;E.deps.selectProvider=async ctx=>{x=ctx;await new Promise((r,j)=>{release=r;reject=j;});return E.deps.provider();};const options={workflow:flow.id,by:'captain'},r=granted?G.start(options,ownClaudePlan(H.defs.get(flow.id))):E.start(options);assert(await until(()=>!!x));let calls=0;const admitted=new WeakSet<object>(),deps:any={admitted:(c:any)=>admitted.has(c),verify:async()=>{calls++;const c={...cap};admitted.add(c);return c;}};return{H,E,G,r,get x(){return x;},deps,async block(){reject(new ProviderRefusal('fixture capability expired; hold without fallback'));assert(await until(()=>!!r.nodes['write-a'].waiting&& !E.busy(r.id)));},get calls(){return calls;},async stop(){if(!["cancelled","failed","succeeded"].includes(E.get(r.id)!.status))await E.cancel(r.id);release();await until(()=>!E.busy(r.id));H.stop();}};}
for(const mode of ['success','no-grant','tamper-pair','tamper-def','untrusted','owner-ended','failed','concurrent','restart','during-owner','quota','metadata']){
 const F=await fixture(mode!=='no-grant');try{
  let x=F.x,p={...pair},finish:any;
  if(mode==='tamper-pair')p.effort='high';if(mode==='tamper-def')F.r.def.name='changed';if(mode==='untrusted'){const t=F.E.trusted.bind(F.E);F.E.trusted=id=>({...t(id),ok:false});}
  if(mode==='owner-ended')await F.E.cancel(F.r.id);
  if(mode==='failed'||mode==='restart')F.deps.verify=async()=>{throw Error('fixture request failed');};
  if(mode==='during-owner')F.deps.verify=async()=>{await F.E.cancel(F.r.id);return cap;};
  if(mode==='concurrent')F.deps.verify=()=>new Promise(r=>finish=r);
  if(mode==='quota'){const denied={...cap,quota:'exhausted'};assert.equal(await refreshOwnWorkflowClaude(x,input,p,denied,F.deps),denied);assert.equal(F.calls,0);}
  if(mode==='metadata'){assert.equal(await refreshOwnWorkflowClaude(undefined,input,p,cap,F.deps),cap);assert.equal(F.calls,0);continue;}
  if(mode==='quota')continue;
  if(mode==='concurrent'){const first=refreshOwnWorkflowClaude(x,input,p,cap,F.deps).catch(()=>{});await assert.rejects(()=>refreshOwnWorkflowClaude(x,input,p,cap,F.deps));finish(cap);await first;assert.equal(F.E.trusted(F.r.id).entries.filter(e=>e.record==='own-claude-verification-attempt').length,1);continue;}
  if(mode==='success'){const c=await refreshOwnWorkflowClaude(x,input,p,cap,F.deps);assert.equal(c.quota,'unknown');assert.equal(await refreshOwnWorkflowClaude(x,input,p,c,F.deps),c);assert.equal(F.calls,1);await assert.rejects(()=>refreshOwnWorkflowClaude(x,input,p,cap,F.deps));}
  else {await assert.rejects(()=>refreshOwnWorkflowClaude(x,input,p,cap,F.deps));if(mode==='restart'){const r=fold(F.E.events(F.r.id))!;F.E.runs.set(r.id,r);await assert.rejects(()=>refreshOwnWorkflowClaude(F.E.x(r,r.def.nodes[0],r.nodes['write-a']),input,p,cap,F.deps));assert.equal(F.E.trusted(r.id).entries.filter(e=>e.record==='own-claude-verification-attempt').length,1);}}
  console.log('PASS '+mode);
 }finally{await F.stop();}
}
// Native fixture: a real bounded subprocess produces the opaque execution receipt.
{
 const {ClaudeNative,isClaudeExecutionAdmission}=await import('../src/providers/claude-native');const {mkdtempSync,copyFileSync,readFileSync,rmSync}=await import('node:fs');const {join}=await import('node:path');
 const dir=mkdtempSync('/private/tmp/crew-own-claude-provider-'),bin=join(dir,'success.mjs');copyFileSync(join(import.meta.dirname,'fixture/claude-native.mjs'),bin);const native=new ClaudeNative({bin,login:()=>({ok:true,env:{CLAUDE_CODE_OAUTH_TOKEN:'sk-ant-oat01-'+'x'.repeat(48)},source:'offline fixture only',warn:null})});const F=await fixture();
 try{const c=await refreshOwnWorkflowClaude(F.x,input,pair,cap,{verify:(p,o)=>native.verify(p,o),admitted:isClaudeExecutionAdmission});assert(isClaudeExecutionAdmission(c,pair));assert.equal(c.quota,'unknown');const rows=readFileSync(join(dir,'trace.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));assert.equal(rows.filter(r=>r.phase==='model').length,1);assert.equal(rows.find(r=>r.phase==='model').effort,'medium');console.log('PASS real native exact pair bounded verification');}finally{await F.stop();rmSync(dir,{recursive:true,force:true});}
}
// Existing task: a signed new grant resumes its original readiness card and pin.
{
 const F=await fixture(false);try{const x=F.x;await F.block();assert(F.G.available(F.r.id));const offer=F.G.offer(F.r.id),before=JSON.stringify({def:F.r.def,params:F.r.params});const oldHead=F.r.ctx.head;F.r.ctx.head='changed-after-offer';await assert.rejects(()=>F.G.confirm(F.r.id,{...offer,confirm:'authorize-bounded-verification'},'captain'));if(oldHead===undefined)delete F.r.ctx.head;else F.r.ctx.head=oldHead;await assert.rejects(()=>F.G.confirm(F.r.id,{...offer,node:'wrong-node',confirm:'authorize-bounded-verification'},'captain'));await assert.rejects(()=>F.G.confirm(F.r.id,{...offer,token:'stale',confirm:'authorize-bounded-verification'},'captain'));await assert.rejects(()=>F.G.confirm(F.r.id,{...offer,plan:{...offer.plan,nodes:[]},confirm:'authorize-bounded-verification'},'captain'));assert.equal(F.E.trusted(F.r.id).entries.filter(e=>e.record==='own-claude-verification-grant').length,0);await F.G.confirm(F.r.id,{...offer,confirm:'authorize-bounded-verification'},'captain');assert.equal(JSON.stringify({def:F.r.def,params:F.r.params}),before);assert.equal(F.E.trusted(F.r.id).entries.filter(e=>e.record==='own-claude-verification-grant').length,1);await assert.rejects(()=>F.G.confirm(F.r.id,{...offer,confirm:'authorize-bounded-verification'},'captain'));console.log('PASS original task grant confirmation stale/repeat refusal and pinned definition preserved');}finally{await F.stop();}
}
{
 const F=await fixture();try{assert.equal(await refreshOwnWorkflowClaude({...F.x,run:{def:{id:'internal'}}},input,pair,cap,F.deps),cap);assert.equal(F.calls,0);assert.throws(()=>F.G.start({workflow:flow.id},{...ownClaudePlan(F.r.def),run:'injected'}));console.log('PASS builtin metadata never probes and extra grant fields cannot widen authority');}finally{await F.stop();}
}
{
 const {gateHarness}=await import('./gate-harness');const H=gateHarness();try{const url=new URL('http://local/api/wruns/R-0001/claude-verification/confirm');const response=await H.rt.handle(new Request(url,{method:'POST',body:'{}',headers:{'content-type':'application/json'}}),url,{kind:'phone'},true);assert.equal(response.status,403);console.log('PASS phone cannot authorize paid verification');}finally{H.rt.engine.disposeExternal();}
}
