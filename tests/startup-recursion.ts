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
// Board start: no hand-typed model params. Studio's configured model per exact provider is bound before the captain card.
const {StartupModelRefusal}=await import('../src/domain/startup-recursion');
const configured=(p:string)=>p==='claude'?'cfg-claude-model':p==='codex'?'cfg-codex-model':null;
for(const scenario of ['configured','explicit-override','tamper-after-approval']){
 const H=await harness([flow]);const store=new ArtifactStore(H.data);installStartupRecursion(H.engine,{artifacts:store,configuredModel:configured as any});const jobs:{id:string;model:string}[]=[];let run:any;
 H.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxFree:true,start(_sys:any,_tools:any,ctx:any){return{interrupt(){},async *send(text:string){jobs.push({id,model});const judge=text.includes('Role: judge'),round=Number(/round: (\d)/.exec(text)![1]);if(scenario==='tamper-after-approval'&&!judge&&round===1)run.params.founderModel='tampered-claude-model';const payload=judge?{text:`Critique round ${round}: willingness to pay is untested; run five paid pilots before growth spending.`,score:80,verdict:'ready'}:{text:`Proposal round ${round}: research service for independent coffee shops with paid pilot validation and explicit revenue assumptions.`,revision:''};yield{type:'toolStart',id:'submit',name:'startup_submit',args:payload};const result=await H.agents.callTool(ctx.token,'startup_submit',payload);yield{type:'toolEnd',id:'submit',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};} } as any);
 try{
  const params:Record<string,string>={provider:'codex',...(scenario==='explicit-override'?{founderModel:'explicit-claude-model'}:{})};
  run=H.engine.start({workflow:'startup-recursion',text:'Fixture only: board-started startup competition.',params});
  const founder=scenario==='explicit-override'?'explicit-claude-model':'cfg-claude-model';
  a(await until(()=>H.engine.cards.list({run:run.id,open:true}).length===1),JSON.stringify(H.engine.get(run.id)?.nodes.choose));const c=H.engine.cards.list({run:run.id,open:true})[0];
  check(`${scenario}: exact models resolved and recorded before the captain card`,()=>{const r=H.engine.trusted(run.id).entries.filter(e=>e.record==='startup-models-resolved');a.equal(r.length,1);a.equal(r[0].data.founder.model,founder);a.equal(r[0].data.founder.source,scenario==='explicit-override'?'param':'configured');a.equal(r[0].data.judge.model,'cfg-codex-model');a.equal(r[0].data.judge.provider,'codex');a.equal(jobs.length,0);});
  check(`${scenario}: selection card shows the exact resolved models`,()=>{a(c.body.includes(`Claude: ${founder} / effort=null`),c.body);a(c.body.includes('Codex: cfg-codex-model / effort=null'),c.body);});
  await H.engine.answer(c.id,{choice:'template',by:'fixture captain'});
  check(`${scenario}: signed approval binds the resolved models`,()=>{const p=H.engine.trusted(run.id).entries.find(e=>e.record==='startup-contract-approved')!.data;a.equal(p.founder.model,founder);a.equal(p.judge.model,'cfg-codex-model');a.equal(p.claudeVerification.model,founder);});
  if(scenario==='tamper-after-approval'){a(await until(()=>H.engine.get(run.id)?.status==='failed'),JSON.stringify(H.engine.get(run.id)?.status));check('model param changed after approval is refused',()=>{a(!H.engine.trusted(run.id).entries.some(e=>e.record==='startup-round'));a(String(H.engine.get(run.id)!.nodes.pitch1.error).includes('changed'),String(H.engine.get(run.id)!.nodes.pitch1.error));});continue;}
  a(await until(()=>H.engine.cards.list({run:run.id,open:true}).some(c=>c.node==='accept')),JSON.stringify(H.engine.get(run.id)?.nodes));
  check(`${scenario}: rounds run on the exact approved models`,()=>{const rounds=H.engine.trusted(run.id).entries.filter(e=>e.record==='startup-round');a.equal(rounds.length,2);a.deepEqual(rounds.map(e=>`${e.data.provider}/${e.data.model}`),[`claude/${founder}`,'codex/cfg-codex-model']);a.deepEqual(jobs,[{id:'claude',model:founder},{id:'codex',model:'cfg-codex-model'}]);});
  const accept=H.engine.cards.list({run:run.id,open:true}).find(c=>c.node==='accept')!;await H.engine.answer(accept.id,{choice:'accept',by:'fixture captain'});
  a(await until(()=>H.engine.get(run.id)?.status==='succeeded'));check(`${scenario}: captain acceptance completes end to end`,()=>a(H.engine.trusted(run.id).entries.some(e=>e.record==='startup-accepted')));
 }finally{H.stop();}
}
for(const [name,cfg,params,provider] of [['no configured codex model',(p:string)=>p==='claude'?'cfg-claude-model':null,{provider:'codex'},'codex'],['no configured claude model',(p:string)=>p==='codex'?'cfg-codex-model':null,{},'claude'],['no configured models and no installer source',undefined,{judgeModel:'fixture-codex'},'claude']] as const){
 const H=await harness([flow]);installStartupRecursion(H.engine,{artifacts:new ArtifactStore(H.data),configuredModel:cfg as any});
 try{
  let error:any;try{H.engine.start({workflow:'startup-recursion',text:'Fixture only.',params:params as any});}catch(e){error=e;}
  check(`${name}: typed bilingual refusal naming ${provider} and where to set it, no Task, no fallback`,()=>{a(error instanceof StartupModelRefusal,String(error));a.equal(error.publicFailure.code,'startup_model_unconfigured');a.equal(error.provider,provider);a(error.publicFailure.reason.en.includes(provider)&&error.publicFailure.reason.en.includes('Settings'));a(error.publicFailure.reason['zh-TW'].includes(provider)&&error.publicFailure.reason['zh-TW'].includes('設定'));a(error.message.includes(error.publicFailure.reason['zh-TW']));a.equal(H.engine.list().length,0);});
 }finally{H.stop();}
}
{
 const H=await harness([flow]);installStartupRecursion(H.engine,{artifacts:new ArtifactStore(H.data),configuredModel:configured as any});
 try{let error:any;try{H.engine.start({workflow:'startup-recursion',text:'Fixture only.',params:{judgeModel:'bad model/with space'}});}catch(e){error=e;}check('invalid explicit model is refused, never replaced by the configured one',()=>{a(error instanceof StartupModelRefusal);a.equal(error.publicFailure.code,'startup_model_invalid');a.equal(H.engine.list().length,0);});}finally{H.stop();}
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
{
 const {installFirstmate}=await import('../src/firstmate');const {Projects}=await import('../src/doors');
 const H=await harness([flow,readFileSync(join(import.meta.dir,'../workflows/v2/firstmate-proposal.wf.yaml'),'utf8')]);
 try{installStartupRecursion(H.engine,{artifacts:new ArtifactStore(H.data),configuredModel:configured as any});const tools=installFirstmate(H.engine,new Projects(H.data)),owner={key:'fixture:startup-configured',captain:true,text:'Run a startup competition',live:()=>true};
  const contract:any=await tools.call('studio_startup_workflow_contract',{},owner);check('Firstmate contract lists model params as optional, not required',()=>{a(!contract.requiredParams);a(contract.optionalParams.includes('founderModel')&&contract.optionalParams.includes('judgeModel'));});
  const result:any=await tools.call('studio_propose_work',{workflow:'startup-recursion',version:1,text:'Startup competition for a coffee research service.',params:{}},owner);
  a(await until(()=>H.engine.cards.list({run:result.proposal,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:result.proposal,open:true})[0].id,{choice:'approve',by:'fixture captain'});a(await until(()=>!!H.engine.get(result.proposal)?.ctx.childRun));
  const child=H.engine.get(H.engine.get(result.proposal)!.ctx.childRun)!;a(await until(()=>H.engine.cards.list({run:child.id,open:true}).length===1));
  check('Firstmate proposal without model params binds the configured models on the selection card',()=>{const body=H.engine.cards.list({run:child.id,open:true})[0].body;a(body.includes('Claude: cfg-claude-model')&&body.includes('Codex: cfg-codex-model'),body);});
  H.engine.cancel(child.id,'fixture complete');
 }finally{H.stop();}
}
{
 const {installFirstmate}=await import('../src/firstmate');const {Projects}=await import('../src/doors');
 const H=await harness([flow,readFileSync(join(import.meta.dir,'../workflows/v2/firstmate-proposal.wf.yaml'),'utf8')]);
 try{installStartupRecursion(H.engine,{artifacts:new ArtifactStore(H.data),configuredModel:(p:string)=>p==='claude'?'cfg-claude-model':null});const tools=installFirstmate(H.engine,new Projects(H.data)),owner={key:'fixture:startup-unconfigured',captain:true,text:'Run a startup competition',live:()=>true};
  let error:any;try{await tools.call('studio_propose_work',{workflow:'startup-recursion',version:1,text:'Startup competition for a coffee research service.',params:{}},owner);}catch(e){error=e;}
  check('Firstmate proposal refuses before any card when the codex model is not configured',()=>{a.equal(error?.publicFailure?.code,'startup_model_unconfigured');a.equal(H.engine.list().length,0);});
 }finally{H.stop();}
}
// The real round path check: a sandboxed provider (not sandboxFree) goes through Agents' sandbox refusal, as the live server does.
{
 const H=await harness([flow]);const store=new ArtifactStore(H.data);installStartupRecursion(H.engine,{artifacts:store});const specs:any[]=[];
 H.agents.toolUrl=()=>H.toolUrl;(H.agents as any).egress={port:1,open(){},close(){}};
 const run0=H.agents.run.bind(H.agents);(H.agents as any).run=(o:any)=>{if(o.kind?.startsWith('run:startup-'))specs.push(o.sandbox);return run0(o);};
 H.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxNeeds:()=>({inProcess:true,hosts:[],reads:[],tmpEnv:[]}),start(_sys:any,_tools:any,ctx:any){return{interrupt(){},async *send(text:string){const judge=text.includes('Role: judge'),round=Number(/round: (\d)/.exec(text)![1]);const payload=judge?{text:`Critique round ${round}: willingness to pay is untested; run five paid pilots before growth spending.`,score:80,verdict:'ready'}:{text:`Proposal round ${round}: research service for independent coffee shops with paid pilot validation and explicit revenue assumptions.`,revision:''};yield{type:'toolStart',id:'submit',name:'startup_submit',args:payload};const result=await H.agents.callTool(ctx.token,'startup_submit',payload);yield{type:'toolEnd',id:'submit',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};} } as any);
 try{
  const r=H.engine.start({workflow:'startup-recursion',text:'Fixture only: sandboxed startup competition.',params:{founderModel:'fixture-claude',judgeModel:'fixture-codex'}});
  a(await until(()=>H.engine.cards.list({run:r.id,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:r.id,open:true})[0].id,{choice:'template',by:'fixture captain'});
  await until(()=>H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='accept')||H.engine.get(r.id)?.status==='failed');
  const errors=[...H.agents.jobs.values()].map(j=>j.error).filter(Boolean);
  check('sandboxed founder and judge rounds pass the real round path check (never refused for reaching data/runs)',()=>{a(!errors.some(e=>/a round may not reach/.test(String(e))),JSON.stringify(errors));a(H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='accept'),JSON.stringify(errors));});
  check('each startup round opens in its own scratch folder under data/work, not under data/runs',()=>{a.equal(specs.length,2);for(const s of specs){a(s.cwd.startsWith(join(H.data,'work')+'/'),s.cwd);a(!s.cwd.includes('/runs/'),s.cwd);a.deepEqual(s.writes,[s.cwd]);}a.notEqual(specs[0].cwd,specs[1].cwd);});
 }finally{H.stop();}
}
console.log(`${passed}/0 startup assertions (controlled providers; no live model proof)`);
