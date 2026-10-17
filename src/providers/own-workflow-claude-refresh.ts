// Paid verification requires a captain's task-scoped signed grant, never metadata.
import {hashInput} from '../runtime/checks';
import {ownWorkflow,ownStaffingPlan} from '../workflow-drafts';
import {nativeClaude,isClaudeExecutionAdmission,validClaudePair,type ClaudePair} from './claude-native';
import {ProviderRefusal,type ProviderCapability,type ProviderSelection} from './policy';
const GRANT='own-claude-verification-grant',ATTEMPT='own-claude-verification-attempt';
const same=(a:any,b:any)=>hashInput({value:a??null})===hashInput({value:b??null});
const refuse=(reason:string):never=>{throw new ProviderRefusal(`Personal workflow Claude verification: ${reason}; hold without fallback`);};
export function ownClaudePlan(def:any,crew?:((def:any)=>any)|null){
 if(!ownWorkflow(def))return null;
 const staffing=ownStaffingPlan(def,crew),nodes=staffing.plan.filter((n:any)=>n.provider==='claude'&&!n.judge).map(n=>({node:n.node,provider:'claude',model:n.model,effort:n.effort??null,maxProbes:1,maxBudgetUSD:0.05,maxTurns:1}));
 return nodes.length?{schema:1,definitionHash:hashInput(def),staffing:staffing.hash,nodes}:null;
}
export function installOwnClaudeGrants(engine:any){
 const authorized=new WeakMap<object,any>(),previous=engine.deps.initializeRun;
 engine.deps.initializeRun=(run:any,options:any)=>{previous?.(run,options);const grant=options&&authorized.get(options);if(grant){if(!same(grant,ownClaudePlan(run.def,engine.defs.ownCrew)))throw Error('Claude verification grant changed');engine.record(engine.x(run,run.def.nodes[0],run.nodes[run.def.nodes[0].id]),GRANT,{actor:options.by,data:{plan:grant,source:'run-confirmation'}});}};
 const target=(id:string)=>{const run=engine.get(id);if(!run||!ownWorkflow(run.def)||['succeeded','failed','cancelled'].includes(run.status))throw Error('No active personal workflow');const t=engine.trusted(id);if(!t.ok)throw Error('Task ledger is untrusted');
 const candidates=run.def.nodes.filter((n:any)=>n.kind==='agent'&&n.provider==='claude'&&run.nodes[n.id]?.data?.nativeQueueCapability&&run.nodes[n.id]?.waiting==='card');if(!candidates.length)throw Error('No waiting Claude readiness node');
 const node=candidates[0],rn=run.nodes[node.id],card=engine.cards.get(rn.card);if(card?.status!=='open'||!card.captainOnly||card.visit!==rn.visits)throw Error('Readiness card changed');
 const plan=ownClaudePlan(run.def,engine.defs.ownCrew),entry=plan?.nodes.find((n:any)=>n.node===node.id);if(!entry||!validClaudePair(entry as any))throw Error('Invalid exact Claude pair');
 return{run,node,rn,card,plan,token:hashInput({task:id,definition:plan!.definitionHash,node:node.id,visit:rn.visits,attempt:rn.attempt,card:card.id,head:run.ctx.head??null,plan})};};
 return {
  start(options:any,grant:any){const expected=ownClaudePlan(engine.defs.get(options.workflow,options.version),engine.defs.ownCrew);if(expected&&!same(grant,expected))throw Error('Confirm the exact bounded Claude verification grant');if(expected)authorized.set(options,expected);try{return engine.start(options);}finally{authorized.delete(options);}},
  available(id:string){try{target(id);return true;}catch{return false;}},
  offer(id:string){const t=target(id);return{token:t.token,plan:t.plan,node:t.node.id,card:t.card.id};},
  async confirm(id:string,body:any,by:string){const t=target(id);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['token','plan','confirm','node','card'].includes(k))||body.node!==undefined&&body.node!==t.node.id||body.card!==undefined&&body.card!==t.card.id||body?.token!==t.token||body?.confirm!=='authorize-bounded-verification'||!same(body?.plan,t.plan))throw Error('Verification confirmation is stale or changed');
   // A card is a single-use authorization boundary. A repeated POST cannot mint more grants.
   const ledger=engine.trusted(id);if(ledger.entries.some((e:any)=>e.record===GRANT&&e.data?.card===t.card.id))throw Error('This readiness card already authorized verification');
   engine.record(engine.x(t.run,t.node,t.rn),GRANT,{actor:by,data:{plan:t.plan,source:'readiness-confirmation',card:t.card.id,node:t.node.id,visit:t.rn.visits,token:t.token}});
   await engine.answer(t.card.id,{choice:t.rn.data.nativeQueueCapability.retryAction,by,confirm:'authorize-bounded-verification'});
  }
 };
}
type Dependencies={verify:typeof nativeClaude.verify;admitted:typeof isClaudeExecutionAdmission};
const defaults:Dependencies={verify:(p,o)=>nativeClaude.verify(p,o),admitted:isClaudeExecutionAdmission};
export async function refreshOwnWorkflowClaude(x:any,input:ProviderSelection,pair:ClaudePair,cap:ProviderCapability,d:Dependencies=defaults):Promise<ProviderCapability>{
 if(!x||!ownWorkflow(x.run?.def))return cap;
 const engine=x.engine,run=x.run,visit=x.visit,attempt=x.rn.attempt,head=x.ctx.head??null;
 const authority=()=>{
  if(engine.get(run.id)!==run||!engine.owns(x)||engine.abortOf(run).signal.aborted||x.rn.visits!==visit||x.rn.attempt!==attempt||(x.ctx.head??null)!==head)refuse('task owner ended');
  const plan=ownClaudePlan(run.def,engine.defs.ownCrew),node=plan?.nodes.find(n=>n.node===x.node.id);
  if(!node||!validClaudePair(pair)||!input.explicit||input.provider!=='claude'||input.model!==pair.model||(input.effort??null)!==pair.effort||node.model!==pair.model||node.effort!==pair.effort)refuse('exact node/model binding changed');
  const trusted=engine.trusted(run.id);if(!trusted.ok)refuse('task ledger is untrusted');
  const grant=trusted.entries.filter((e:any)=>e.record===GRANT&&e.kind==='record'&&e.verdict==='pass'&&same(e.data?.plan,plan)&&(e.data.source==='run-confirmation'||e.data.source==='readiness-confirmation'&&e.data.node===x.node.id)).at(-1);
  if(!grant)refuse('captain verification grant missing; confirm bounded verification on this Task');
  return{trusted,grant};
 };
 // A current opaque native receipt needs no paid request and no new grant.
 if(d.admitted(cap,pair))return cap;
 if(!cap.available||cap.auth!=='verified'||cap.quota!=='unknown')return cap;
 const initial=authority();
 if(initial.trusted.entries.some((e:any)=>e.record===ATTEMPT&&e.data?.grant===initial.grant.seq&&e.data?.node===x.node.id))refuse('approved node probe budget consumed; confirm a new grant on this Task');
 const receipt=engine.record(x,ATTEMPT,{data:{schema:1,grant:initial.grant.seq,grantHash:hashInput(initial.grant.data),node:x.node.id,visit,attempt,provider:'claude',...pair,maxBudgetUSD:0.05,maxTurns:1}});
 if(!receipt?.seq||!receipt.sig||!authority().trusted.entries.some((e:any)=>e.seq===receipt.seq&&e.sig===receipt.sig&&e.record===ATTEMPT))refuse('probe consumption was not persisted');
 const result=await d.verify(pair,{confirm:true,signal:engine.abortOf(run).signal});
 if(authority().grant.seq!==initial.grant.seq)refuse('grant changed during verification');
 if(result.quota!=='unknown'||!d.admitted(result,pair))refuse('bounded verification did not establish exact execution readiness');
 return result;
}
