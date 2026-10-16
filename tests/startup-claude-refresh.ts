import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {harness,Y,until,suite} from './rt-harness';
import {hashInput} from '../src/runtime/checks';
import {fold} from '../src/runtime/engine';
import {refreshStartupClaude} from '../src/providers/startup-claude-refresh';
import {ProviderRefusal,selectNativeProvider} from '../src/providers/policy';
const {ok,end}=suite('startup-claude-refresh');
process.env.CREW_TEST_IN_PROCESS='1';
const pair={model:'claude-sonnet-5-5',effort:null};
const input:any={role:'founder',host:null,explicit:true,provider:'claude',model:pair.model,effort:null,configured:{claude:{model:pair.model,effort:'high'}},fallback:[],known:['claude']};
const cap:any={provider:'claude',available:true,auth:'verified',quota:'unknown',models:[],at:Date.now(),expires:Date.now()+30000};
const flow={id:'startup-recursion',kind:'startup-recursion',name:'Refresh fixture',version:1,params:{founderModel:{label:'Model'}},roles:[{id:'founder',label:'Founder',skill:'fixture'}],nodes:[{id:'choose',kind:'card',args:{mode:'startup-choice'},label:'Approve',x:0,y:0},...[1,2,3].map(round=>({id:`pitch${round}`,kind:'agent',role:'founder',mode:'startup-pitch',args:{round},label:'Pitch',x:round,y:0})),{id:'done',kind:'hook',label:'Done',x:4,y:0}],edges:[['choose','pitch1','template'],['pitch1','pitch2'],['pitch2','pitch3'],['pitch3','done']]};
async function fixture(o:{resolved?:string}={}){
 const H=await harness([Y(flow)]),E=H.engine;let current:any;let release=()=>{};let calls=0;
 E.cardModes['startup-choice']={async start(x){if(o.resolved)E.record(x,'startup-models-resolved',{data:{schema:1,founder:{provider:'claude',model:o.resolved,source:'configured'},judge:{provider:'codex',model:'fixture-codex',source:'configured'}}});await E.card(x,'question',{captainOnly:true,title:'Approve probes',en:{why:'At most three USD0.05/one-turn probes'},options:[{id:'template',label:'Approve'}]});return{wait:true};},async answer(x,c){E.record(x,'startup-contract-approved',{data:{schema:1,card:c.id,definitionHash:hashInput(x.run.def),candidateHash:null,execution:'fixed-template',founder:{provider:'claude',...pair},claudeVerification:{provider:'claude',...pair,maxProbes:3,maxBudgetUSD:0.05,maxTurns:1}}});return{outcome:'template'};}};
 E.modes['startup-pitch']={system:()=>'',prompt:()=>'',tools:()=>[],after:()=> 'ok'};
 E.deps.selectProvider=async x=>{current=x;await new Promise<void>(r=>release=r);return H.engine.deps.provider();};
 const r=E.start({workflow:flow.id,params:o.resolved?{}:{founderModel:pair.model}});await until(()=>r.nodes.choose.waiting==='card');await E.answer(r.nodes.choose.card!,{choice:'template',by:'fixture captain'});await until(()=>!!current);
 const ready=new WeakSet<object>();const deps:any={admitted:(c:any)=>ready.has(c),verify:async(p:any,o:any)=>{calls++;ok(p.model===pair.model&&p.effort===null&&o.confirm===true,'exact pair and explicit bounded verify');const c={...cap,expires:Date.now()+30000};ready.add(c);return c;}};
 return{H,E,r,get x(){return current},deps,get calls(){return calls},async next(){const old=current;release();await until(()=>current!==old);return current;},async stop(){if(!['succeeded','failed','cancelled'].includes(E.get(r.id)!.status))await E.cancel(r.id);release();await until(()=>!E.busy(r.id));H.stop();}};
}
{
 const F=await fixture();try{
  const first=await refreshStartupClaude(F.x,input,pair,cap,F.deps);
  ok(F.calls===1&&first.quota==='unknown'&&first.expires<=Date.now()+30000,'verified result preserves unknown quota and native TTL');
  ok(await refreshStartupClaude(F.x,input,pair,first,F.deps)===first&&F.calls===1,'fresh opaque receipt reuses admission without new cost');
  let refused=false;try{await refreshStartupClaude(F.x,input,pair,cap,F.deps)}catch{refused=true;}ok(refused&&F.calls===1,'same round cannot probe again after expiry');
  await F.next();await refreshStartupClaude(F.x,input,pair,cap,F.deps);await F.next();await refreshStartupClaude(F.x,input,pair,cap,F.deps);
  const spent=F.E.trusted(F.r.id).entries.filter(e=>e.record==='startup-claude-verification-attempt');ok(F.calls===3&&spent.length===3&&spent.every(e=>e.data.maxTurns===1&&e.data.maxBudgetUSD===0.05),'three rounds spend at most three durable attempts');
 }finally{await F.stop();}
}
for(const mode of ['failed','concurrent','replay','owner-ended','wrong-model','wrong-effort','wrong-role','no-captain','candidate-drift','definition-drift','budget-drift','untrusted','total-budget','during-attempt','during-model','quota','metadata']){
 const F=await fixture();try{
  const x=F.x,originalTrusted=F.E.trusted.bind(F.E);let finish:any;
  if(['failed','replay'].includes(mode))F.deps.verify=async()=>{throw Error('synthetic failed probe')};
  if(mode==='concurrent')F.deps.verify=()=>new Promise(resolve=>finish=resolve);
  if(mode==='during-attempt'||mode==='during-model'){const verify=F.deps.verify;F.deps.verify=async(...args:any[])=>{const c=await verify(...args);if(mode==='during-attempt')x.rn.attempt++;else F.r.params.founderModel='claude-opus-5-5';return c;};}
  if(mode==='total-budget')for(let round=1;round<=3;round++)F.E.record(x,'startup-claude-verification-attempt',{data:{round:round+10}});
  if(mode==='owner-ended')await F.E.cancel(F.r.id);
  const selected={...input},p={...pair};
  if(mode==='wrong-model')p.model='claude-opus-5-5';if(mode==='wrong-effort')(p as any).effort='high';if(mode==='wrong-role')selected.role='judge';
  if(mode==='no-captain'){const get=F.E.cards.get.bind(F.E.cards);F.E.cards.get=id=>{const c=get(id);return c?{...c,captainOnly:false}:c;};}
  if(mode==='candidate-drift')F.r.params.generatedWorkflow='changed';if(mode==='definition-drift')F.r.def.name='changed';
  if(mode==='budget-drift'){const t=F.E.trusted(F.r.id),contract=t.entries.find(e=>e.record==='startup-contract-approved')!;F.E.record(x,'startup-contract-approved',{data:{...contract.data,claudeVerification:{...contract.data.claudeVerification,maxProbes:99}}});}
  if(mode==='untrusted')F.E.trusted=(id)=>({...originalTrusted(id),ok:false});
  if(mode==='quota'){const exhausted={...cap,quota:'exhausted'};ok(await refreshStartupClaude(x,selected,p,exhausted,F.deps)===exhausted&&F.calls===0,'known quota denial never triggers paid refresh');continue;}
  if(mode==='metadata'){ok(await refreshStartupClaude(undefined,selected,p,cap,F.deps)===cap&&F.calls===0,'metadata without live task owner never triggers verification');continue;}
  if(mode==='concurrent'){
   const first=refreshStartupClaude(x,selected,p,cap,F.deps).catch(()=>{});let denied=false;try{await refreshStartupClaude(x,selected,p,cap,F.deps)}catch{denied=true;}finish(cap);await first;ok(denied&&originalTrusted(F.r.id).entries.filter(e=>e.record==='startup-claude-verification-attempt').length===1,'concurrent refresh persists only one attempt');continue;
  }
  let denied=false;try{await refreshStartupClaude(x,selected,p,cap,F.deps)}catch{denied=true;}
  ok(denied,mode+' refuses execution');
  if(mode==='failed'||mode==='replay'){
   const reloaded=fold(F.E.events(F.r.id))!;F.E.runs.set(reloaded.id,reloaded);const rx=F.E.x(reloaded,reloaded.def.nodes.find(n=>n.id===x.node.id)!,reloaded.nodes[x.node.id]);let retried=0;F.deps.verify=async()=>{retried++;return cap;};let blocked=false;try{await refreshStartupClaude(rx,input,pair,cap,F.deps)}catch{blocked=true;}ok(blocked&&retried===0&&originalTrusted(reloaded.id).entries.some(e=>e.record==='startup-claude-verification-attempt'),'event-replayed task cannot refund failed/crashed attempt');
  }else if(mode.startsWith('during-'))ok(originalTrusted(F.r.id).entries.filter(e=>e.record==='startup-claude-verification-attempt').length===1,mode+' consumes attempt but never returns launch readiness');
  else if(mode==='total-budget')ok(F.calls===0,'task-wide three-probe budget refuses additional paid call');
  else ok(!originalTrusted(F.r.id).entries.some(e=>e.record==='startup-claude-verification-attempt'),mode+' spends no probe budget');
 }finally{await F.stop();}
}
// Board-started task: no founderModel param; the signed resolution record carries Studio's configured model.
{
 const F=await fixture({resolved:pair.model});try{
  const first=await refreshStartupClaude(F.x,input,pair,cap,F.deps);
  ok(F.calls===1&&first.expires<=Date.now()+30000,'configured founder model (no param) is verified within the approved probe budget');
 }finally{await F.stop();}
}
for(const mode of ['resolved-drift','param-after-resolution']){
 const F=await fixture({resolved:mode==='resolved-drift'?'claude-opus-5-5':pair.model});try{
  if(mode==='param-after-resolution')F.r.params.founderModel='claude-opus-5-5';
  let denied=false;try{await refreshStartupClaude(F.x,input,pair,cap,F.deps)}catch{denied=true;}
  ok(denied&&F.calls===0&&!F.E.trusted(F.r.id).entries.some(e=>e.record==='startup-claude-verification-attempt'),mode+' refuses and spends no probe budget');
 }finally{await F.stop();}
}
{
 let seen:any;await selectNativeProvider({...input,provider:'codex',known:['codex'],configured:{codex:{model:pair.model,effort:'high'}}},async(id,p)=>{seen=p;return {...cap,provider:id,quota:'available',models:[{id:p.model}],at:Date.now(),expires:Date.now()+30000}},(id,model,effort)=>({id,model,reasoningEffort:effort})as any);
 ok(seen.effort===null,'explicit null effort never inherits configured high');
 let preserved=false;try{await selectNativeProvider(input,async()=>{throw new ProviderRefusal('bounded task grant exhausted')},()=>null as any)}catch(e){preserved=String(e).includes('bounded task grant exhausted');}ok(preserved,'source-owned refusal keeps actionable budget reason without fallback');
}
end();
