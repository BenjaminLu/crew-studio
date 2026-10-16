import {strict as a} from 'node:assert';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until} from './rt-harness';
import {ArtifactStore} from '../src/artifacts';
import {installStartupRecursion,inspectStartupCandidate,startupCandidateExample} from '../src/domain/startup-recursion';
const flow=readFileSync(join(import.meta.dir,'../workflows/v2/startup-recursion.wf.yaml'),'utf8');
let passed=0;const check=(n:string,f:()=>void)=>{f();passed++;console.log('PASS '+n);};
check('complete generated manifest matches restricted contract',()=>a(inspectStartupCandidate(JSON.stringify(startupCandidateExample())).matches));
check('different provider rejected',()=>{const c=startupCandidateExample() as any;c.roles[0].provider='codex';a(!inspectStartupCandidate(JSON.stringify(c)).matches);});
check('extra authority rejected',()=>{const c=startupCandidateExample() as any;c.nodes[1].do='shell';a(!inspectStartupCandidate(JSON.stringify(c)).matches);});
check('missing edge rejected',()=>{const c=startupCandidateExample() as any;c.edges.pop();a(!inspectStartupCandidate(JSON.stringify(c)).matches);});
for(const scenario of ['three-rounds','early-ready','fallback','reject','tamper','wrong-provider','cancel-before-choice','restart']){
 let H=await harness([flow]);const store=new ArtifactStore(H.data);installStartupRecursion(H.engine,{artifacts:store});let calls=0;const prompts:string[]=[];
 H.engine.deps.provider=(id='codex',model='fixture-model')=>({id:scenario==='wrong-provider'?'codex':id,model,sandboxFree:true,start(_sys:any,_tools:any,ctx:any){return{interrupt(){},async *send(text:string){calls++;prompts.push(text);const judge=text.includes('Role: judge'),round=Number(/round: (\d)/.exec(text)![1]);const payload=judge?{text:`Critique round ${round}: customer willingness to pay remains untested. Test five paid pilots before any growth spending.`,score:50+round,verdict:scenario==='early-ready'?'ready':'revise'}:{text:`Proposal round ${round}: a local customer research service for independent coffee shops, with paid pilot validation and explicit uncertain revenue assumptions.`,revision:round===1?'':`Addressed critique ${round-1}: changed validation to five paid pilots and reduced costs.`};yield{type:'toolStart',id:'submit',name:'startup_submit',args:payload};const result=await H.agents.callTool(ctx.token,'startup_submit',payload);a(!result.error,JSON.stringify(result));yield{type:'toolEnd',id:'submit',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};} } as any);
 try{
 const r=H.engine.start({workflow:'startup-recursion',text:'Fixture only: coffee startup competition.',params:{founderModel:'fixture-claude',judgeModel:'fixture-codex',...(scenario==='fallback'?{generatedWorkflow:JSON.stringify({kind:'startup-recursion',roles:[]})}:{})}});
 a(await until(()=>H.engine.cards.list({run:r.id,open:true}).length===1));const c=H.engine.cards.list({run:r.id,open:true})[0];check(`${scenario}: no paid work before explicit choice`,()=>a.equal(calls,0));a(c.captainOnly);
 if(scenario==='cancel-before-choice'){await H.engine.answer(c.id,{choice:'close',by:'fixture captain'});a(await until(()=>H.engine.get(r.id)?.status==='succeeded'));a.equal(calls,0);continue;}
 if(scenario==='fallback')check('mismatched actual candidate is visible and requires template choice',()=>{a(c.body.includes('不相符'));a(c.links.some(l=>l.href.includes('generated-candidate.json')));a.equal(c.options[0].id,'template');});
 await H.engine.answer(c.id,{choice:'template',by:'fixture captain'});
 if(scenario==='wrong-provider'){a(await until(()=>H.engine.get(r.id)?.status==='failed'));check('wrong actual provider cannot certify founder output',()=>a(!H.engine.trusted(r.id).entries.some(e=>e.record==='startup-round')));continue;}
 a(await until(()=>H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='accept')),JSON.stringify(H.engine.get(r.id)));
 if(scenario==='restart'){const data=H.data;H.stop();H=await harness([flow],{data});installStartupRecursion(H.engine,{artifacts:store});H.engine.load();check('restart restores pending captain card without new model jobs',()=>a.equal(H.agents.jobs.size,0));}
 const accept=H.engine.cards.list({run:r.id,open:true}).find(c=>c.node==='accept')!;const trust=H.engine.trusted(r.id);a(trust.ok);const rounds=trust.entries.filter(e=>e.record==='startup-round');const expected=scenario==='early-ready'?2:6;
 check(`${scenario}: signed exact-provider rounds stop within cap`,()=>{a.equal(rounds.length,expected);a.equal(calls,expected);a(rounds.every((e,i)=>e.data.provider===(i%2?'codex':'claude')));});
 if(expected===6)check(`${scenario}: revisions consume previous critiques`,()=>a(prompts[2].includes('Critique round 1')));
 const pin=trust.entries.find(e=>e.record==='startup-artifact')!.data;const manifest=store.version(pin.artifact,pin.version)!;const output=store.file(pin.artifact,pin.version,'competition.md');a(output);a(readFileSync(output!,'utf8').includes('Critique round 1'));
 if(scenario==='tamper'){writeFileSync(output!,'tampered');await a.rejects(H.engine.answer(accept.id,{choice:'accept',by:'fixture captain'}));check('artifact tamper cannot become approved',()=>a.notEqual(store.version(pin.artifact,pin.version)?.status,'approved'));continue;}
 await H.engine.answer(accept.id,{choice:scenario==='reject'?'reject':'accept',note:scenario==='reject'?'Fixture rejection':undefined,by:'fixture captain'});
 a(await until(()=>H.engine.get(r.id)?.status==='succeeded'));
 check(`${scenario}: only captain acceptance approves exact artifact`,()=>a.equal(store.version(pin.artifact,pin.version)?.status,scenario==='reject'?'in-review':'approved'));
 await a.rejects(H.engine.answer(accept.id,{choice:'accept',by:'fixture captain'}));
 }finally{H.stop();}
}
{
 const {installFirstmate}=await import('../src/firstmate');const {Projects}=await import('../src/doors');
 const H=await harness([flow,readFileSync(join(import.meta.dir,'../workflows/v2/firstmate-proposal.wf.yaml'),'utf8')]);
 try{installStartupRecursion(H.engine,{artifacts:new ArtifactStore(H.data)});const tools=installFirstmate(H.engine,new Projects(H.data)),owner={key:'fixture:startup',captain:true,text:'Generate a startup competition workflow',live:()=>true};
 const contract:any=await tools.call('studio_startup_workflow_contract',{},owner);check('actual Firstmate read tool returns inspectable manifest without dispatch',()=>{a(contract.candidate.nodes.length>6);a.equal(H.engine.list().length,0);});
 await a.rejects(tools.call('studio_propose_work',{workflow:'startup-recursion',version:1,text:'Startup',params:{}},owner));
 const brief='Startup competition '+ 'x'.repeat(1700),candidate=JSON.stringify(contract.candidate,null,2);
 const result:any=await tools.call('studio_propose_work',{workflow:'startup-recursion',version:1,text:brief,params:{founderModel:'fixture-claude',judgeModel:'fixture-codex',generatedWorkflow:candidate}},owner);
 a(await until(()=>H.engine.cards.list({run:result.proposal,open:true}).length===1));
 check('long native proposal uses immutable transport instead of truncated run param',()=>a(H.engine.get(result.proposal)!.params.target.startsWith('coffee-proposal-v1:sha256:')));
 const card=H.engine.cards.list({run:result.proposal,open:true})[0];await H.engine.answer(card.id,{choice:'approve',by:'fixture captain'});a(await until(()=>!!H.engine.get(result.proposal)?.ctx.childRun));
 const child=H.engine.get(H.engine.get(result.proposal)!.ctx.childRun)!;a(await until(()=>H.engine.cards.list({run:child.id,open:true}).length===1));
 check('native dispatch retains complete candidate and still waits for explicit template selection',()=>{a.equal(child.params.generatedWorkflow,JSON.stringify(contract.candidate));a.equal(child.steps.filter(s=>s.job).length,0);a(H.engine.cards.list({run:child.id,open:true})[0].body.includes('固定 template runner'));});
 H.engine.cancel(child.id,'fixture complete');
 }finally{H.stop();}
}
console.log(`${passed}/0 startup assertions (controlled providers; no live model proof)`);
