// Paid verification is a task effect, never part of passive status/metadata reads.
import {createHash} from 'node:crypto';
import {hashInput} from '../runtime/checks';
import {ProviderRefusal,type ProviderCapability,type ProviderSelection} from './policy';
import {nativeClaude,isClaudeExecutionAdmission,validClaudePair,type ClaudePair} from './claude-native';
const ATTEMPT='startup-claude-verification-attempt';
const refuse=(reason:string):never=>{throw new ProviderRefusal(`Startup Claude verification: ${reason}; hold without fallback`);};
const candidateHash=(raw:unknown)=>raw===undefined||raw===''?null:createHash('sha256').update(JSON.stringify(raw)).digest('hex');
type Dependencies={verify:typeof nativeClaude.verify;admitted:typeof isClaudeExecutionAdmission};
const defaults:Dependencies={verify:(p,o)=>nativeClaude.verify(p,o),admitted:isClaudeExecutionAdmission};
export async function refreshStartupClaude(x:any,input:ProviderSelection,pair:ClaudePair,cap:ProviderCapability,d:Dependencies=defaults):Promise<ProviderCapability>{
 if(!x||x.run?.workflow!=='startup-recursion')return cap;
 const engine=x.engine,run=x.run,round=Number(x.node?.args?.round),visit=x.visit,attempt=x.rn?.attempt,head=x.ctx?.head??null;
 const own=()=>{if(engine.get(run.id)!==run||!engine.owns(x)||engine.abortOf(run).signal.aborted||x.rn.visits!==visit||x.rn.attempt!==attempt||(x.ctx?.head??null)!==head)refuse('task owner ended');};
 const authority=()=>{
  own();
  if(run.def.id!=='startup-recursion'||run.def.kind!=='startup-recursion'||run.def.version!==1||x.node.id!==`pitch${round}`||
    ![1,2,3].includes(round)||x.node.kind!=='agent'||x.node.mode!=='startup-pitch'||x.node.role!=='founder'||input.role!=='founder'||
    !input.explicit||input.provider!=='claude'||input.model!==pair.model||input.effort!==null||pair.effort!==null||!validClaudePair(pair)||run.params.founderModel!==pair.model)refuse('exact founder role/model binding changed');
  const trusted=engine.trusted(run.id);if(!trusted.ok)refuse('task ledger is untrusted');
  const approvals=trusted.entries.filter((e:any)=>e.record==='startup-contract-approved');if(approvals.length!==1)refuse('exactly one captain contract is required');
  const contract=approvals[0],a=contract.data,c=engine.cards.get(a?.card);
  const answer=trusted.entries.find((e:any)=>e.record==='card-answer'&&e.seq<contract.seq&&e.data?.card===a?.card&&e.data?.choice==='template'&&!String(e.actor??'').startsWith('auth window'));
  if(contract.kind!=='record'||contract.verdict!=='pass'||contract.node!=='choose'||a?.schema!==1||a.execution!=='fixed-template'||
    a.definitionHash!==hashInput(run.def)||a.candidateHash!==candidateHash(run.params.generatedWorkflow)||
    a.founder?.provider!=='claude'||a.founder.model!==pair.model||a.founder.effort!==null||
    a.claudeVerification?.provider!=='claude'||a.claudeVerification.model!==pair.model||a.claudeVerification.effort!==null||
    a.claudeVerification.maxProbes!==3||a.claudeVerification.maxBudgetUSD!==0.05||a.claudeVerification.maxTurns!==1||
    !answer||!c?.captainOnly||c.run!==run.id||c.node!=='choose'||c.status!=='answered'||c.answer?.choice!=='template'||
    String(c.answer.by).startsWith('auth window')||c.visit!==contract.round)refuse('captain verification grant is missing or changed');
  return {trusted,contract};
 };
 const initial=authority();
 if(d.admitted(cap,pair))return cap; // no new cost, no receipt lifetime extension
 if(!cap.available||cap.auth!=='verified'||cap.quota!=='unknown')return cap; // never retry known auth/quota denial
 // No await between authoritative count and append: concurrent owners cannot both spend.
 // An attempt is consumed BEFORE calling the provider; crash/failure never refunds it.
 const spent=initial.trusted.entries.filter((e:any)=>e.record===ATTEMPT);
 if(spent.length>=3||spent.some((e:any)=>e.data?.round===round))refuse('approved probe budget for this task/round is already consumed');
 const receipt=engine.record(x,ATTEMPT,{data:{schema:1,contract:initial.contract.seq,contractHash:hashInput(initial.contract.data),card:initial.contract.data.card,candidateHash:initial.contract.data.candidateHash,
  provider:'claude',model:pair.model,effort:null,round,node:x.node.id,visit:x.visit,attempt:x.rn.attempt,maxBudgetUSD:0.05,maxTurns:1}});
 if(!receipt?.seq||!receipt.sig)refuse('probe consumption was not persisted');
 const persisted=authority();if(!persisted.trusted.entries.some((e:any)=>e.seq===receipt.seq&&e.sig===receipt.sig&&e.record===ATTEMPT))refuse('probe consumption cannot be authenticated');
 const result=await d.verify(pair,{confirm:true,signal:engine.abortOf(run).signal});
 const current=authority();if(current.contract.seq!==initial.contract.seq||hashInput(current.contract.data)!==hashInput(initial.contract.data))refuse('contract changed during verification');
 // Native verify owns its fixed 1-turn / USD0.05 command, cleanup and 30s opaque receipt.
 // Do not forge quota, cache a synthetic admission, or record credentials/provider output.
 if(result.quota!=='unknown'||!d.admitted(result,pair))refuse('bounded request did not establish exact execution readiness');
 return result;
}
