import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {strict as a} from 'node:assert';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
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
 const pin=trust.entries.find(e=>e.record==='startup-artifact')!.data;const manifest=store.version(pin.artifact,pin.version)!;const output=store.file(pin.artifact,pin.version,'doc.md');a(output);check(`${scenario}: the run folder keeps startup-output/competition.md (the acceptance scenario contract) beside the version's doc.md and doc.html`,()=>{const f=join(H.data,'runs',r.id,'startup-output','competition.md');a(existsSync(f),f);a.equal(readFileSync(f,'utf8'),readFileSync(output!,'utf8'));a(store.file(pin.artifact,pin.version,'doc.html'));a(store.file(pin.artifact,pin.version,'competition.md'));});a(readFileSync(output!,'utf8').includes('Critique round 1'));
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
// The live shape end to end: Agents' real run (sandboxed, not sandboxFree) and a stub that calls startup_submit over
// Studio's tool listener with its round token, as the CLI's MCP bridge (src/mcp.ts) does. The acceptance card must carry
// the whole competition, the artifact must exist and be pinned, and a round with no submission must fail the run, typed.
for(const scenario of ['sandboxed-three-rounds','sandboxed-no-submission']){
 const H=await harness([flow]);const store=new ArtifactStore(H.data);installStartupRecursion(H.engine,{artifacts:store});
 const listener=Bun.serve({port:0,hostname:'127.0.0.1',async fetch(req){const u=new URL(req.url),t=req.headers.get('x-crew-tool-token')??'';if(u.pathname==='/api/tools')return Response.json(H.agents.toolList(t));let b:any={};try{b=await req.json();}catch{}return Response.json(await H.agents.callTool(t,decodeURIComponent(u.pathname.slice('/api/tools/'.length)),b));}});
 H.agents.toolUrl=()=>`http://127.0.0.1:${listener.port}`;(H.agents as any).egress={port:1,open(){},close(){}};
 const said:Record<string,string>={};
 H.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxNeeds:()=>({inProcess:true,hosts:[],reads:[],tmpEnv:[]}),start(_sys:any,tools:any[],ctx:any){a(tools.some(t=>t.name==='startup_submit'));return{interrupt(){},async *send(text:string){
  const judge=text.includes('Role: judge'),round=Number(/round: (\d)/.exec(text)![1]);
  if(scenario==='sandboxed-no-submission'&&judge&&round===2){yield{type:'text',text:'I reviewed it but forgot to submit.'};yield{type:'turnEnd',status:'ok'};return;}
  const payload=judge?{text:`JUDGE-${round}: willingness to pay is still untested; run five paid pilots before any growth spending.`,score:60+round,verdict:'revise'}:{text:`FOUNDER-${round}: research service for independent coffee shops with paid pilot validation and explicit revenue assumptions.`,revision:round===1?'':`REVISION-${round}: answered critique ${round-1} with five paid pilots.`};
  said[`${judge?'judge':'founder'}-${round}`]=payload.text;
  yield{type:'toolStart',id:'submit',name:'startup_submit',args:payload};
  const r=await fetch(`${ctx.studioUrl}/api/tools/startup_submit`,{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify(payload)});const result=await r.json();a(!result.error,JSON.stringify(result));
  yield{type:'toolEnd',id:'submit',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};} } as any);
 try{
  const r=H.engine.start({workflow:'startup-recursion',text:'Fixture only: sandboxed startup competition, live tool path.',params:{founderModel:'fixture-claude',judgeModel:'fixture-codex'}});
  a(await until(()=>H.engine.cards.list({run:r.id,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:r.id,open:true})[0].id,{choice:'template',by:'fixture captain'});
  a(await until(()=>H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='accept')||['failed','succeeded'].includes(String(H.engine.get(r.id)?.status))),JSON.stringify(H.engine.get(r.id)?.nodes));
  const jobErrors=[...H.agents.jobs.values()].map(j=>j.error).filter(Boolean);
  if(scenario==='sandboxed-no-submission'){
   check('a round that never calls startup_submit fails the run with a typed reason, before any acceptance card',()=>{const run=H.engine.get(r.id)!;a.equal(run.status,'failed',run.status);a(String(run.error).includes('startup_no_submission'),String(run.error));a(!H.engine.cards.list({run:r.id}).some(c=>c.node==='accept'));const f=H.engine.trusted(r.id).entries.filter(e=>e.record==='startup-round-failed');a.equal(f.length,1);a.equal(f[0].data.code,'startup_no_submission');a.equal(f[0].data.role,'judge');a.equal(f[0].data.round,2);a(!H.engine.trusted(r.id).entries.some(e=>e.record==='startup-artifact'));});
   continue;
  }
  const accept=H.engine.cards.list({run:r.id,open:true}).find(c=>c.node==='accept')!;a(accept,JSON.stringify({status:H.engine.get(r.id)?.status,error:H.engine.get(r.id)?.error,jobErrors}));
  const trust=H.engine.trusted(r.id);a(trust.ok);
  check('sandboxed live-path rounds all submit through the tool listener and are signed',()=>{a.deepEqual(jobErrors,[]);a.equal(trust.entries.filter(e=>e.record==='startup-round').length,6);a.equal(Object.keys(said).length,6);});
  check('acceptance card body carries every round: founder proposal, revision and judge critique with score and verdict',()=>{for(const n of [1,2,3]){a(accept.body.includes(said[`founder-${n}`]),`founder ${n} missing: ${accept.body.slice(0,300)}`);a(accept.body.includes(said[`judge-${n}`]),`judge ${n} missing`);a(accept.body.includes(`Score: ${60+n}; verdict: revise`),`score ${n} missing`);}a(accept.body.includes('REVISION-2')&&accept.body.includes('REVISION-3'));});
  const pin=trust.entries.find(e=>e.record==='startup-artifact')?.data;
  check('the competition artifact exists, its bytes match the signed pin, and the card links to it',()=>{a(pin,'no startup-artifact pin');const v=store.version(pin.artifact,pin.version)!;a(v);a.equal(v.sha256,pin.sha256);a.deepEqual(store.verify(pin.artifact,pin.version),[]);const text=readFileSync(store.file(pin.artifact,pin.version,'doc.md')!,'utf8');for(const k of Object.keys(said))a(text.includes(said[k]),k);a(accept.links.some(l=>l.href===`#/review/${pin.artifact}/${pin.version}`));});
  check('the card as the board reads it lists each round with proposal, critique, score and verdict and the pinned artifact',()=>{const v=H.engine.cards.view(accept) as any;const m=v.competition;a(m,'no competition on the card view');a.equal(m.rounds.length,3);for(const x of m.rounds){a.equal(x.founder.text,said[`founder-${x.round}`]);a.equal(x.judge.text,said[`judge-${x.round}`]);a.equal(x.judge.score,60+x.round);a.equal(x.judge.verdict,'revise');}a.equal(m.artifact.id,pin.artifact);a(m.artifact.intact);a.equal(m.artifact.href,`#/review/${pin.artifact}/${pin.version}`);});
  await H.engine.answer(accept.id,{choice:'accept',by:'fixture captain'});a(await until(()=>H.engine.get(r.id)?.status==='succeeded'));
  check('captain acceptance approves the exact pinned artifact',()=>a.equal(store.version(pin.artifact,pin.version)?.status,'approved'));
  // a ledger that no longer verifies: the card says so instead of silently dropping the rounds
  {const lf=join(H.data,'evidence',r.id,'ledger.jsonl'),lines=readFileSync(lf,'utf8').split('\n');const i=lines.findIndex(l=>l.includes('"record":"startup-round"'));lines[i]=lines[i].replace(said['founder-1'],'tampered proposal text, long enough to look like a real one');writeFileSync(lf,lines.join('\n'));
   check('a card whose ledger does not verify carries competition {untrusted:true}, no rounds',()=>{a(!H.engine.trusted(r.id).ok);a.deepEqual((H.engine.cards.view(accept) as any).competition,{untrusted:true});});}
 }finally{listener.stop(true);H.stop();}
}
// An incomplete transcript when the acceptance step starts (here: the signed founder round is missing from what the
// ledger returns): the run fails typed startup_incomplete_transcript, signs the failure, and raises no acceptance card.
{
 const H=await harness([flow]);const store=new ArtifactStore(H.data);installStartupRecursion(H.engine,{artifacts:store});
 const real=H.engine.trusted.bind(H.engine);(H.engine as any).trusted=(id:string)=>{const t=real(id);return t.entries.some((e:any)=>e.record==='startup-round'&&e.data?.role==='judge')?{...t,entries:t.entries.filter((e:any)=>!(e.record==='startup-round'&&e.data?.role==='founder'))}:t;};
 H.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxFree:true,start(_sys:any,_tools:any,ctx:any){return{interrupt(){},async *send(text:string){const judge=text.includes('Role: judge');const payload=judge?{text:'Critique round 1: willingness to pay is untested; run five paid pilots first.',score:80,verdict:'ready'}:{text:'Proposal round 1: research service for independent coffee shops with paid pilots.',revision:''};yield{type:'toolStart',id:'submit',name:'startup_submit',args:payload};const result=await H.agents.callTool(ctx.token,'startup_submit',payload);a(!result.error,JSON.stringify(result));yield{type:'toolEnd',id:'submit',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};} } as any);
 try{
  const r=H.engine.start({workflow:'startup-recursion',text:'Fixture only: incomplete transcript.',params:{founderModel:'fixture-claude',judgeModel:'fixture-codex'}});
  a(await until(()=>H.engine.cards.list({run:r.id,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:r.id,open:true})[0].id,{choice:'template',by:'fixture captain'});
  a(await until(()=>['failed','succeeded'].includes(String(H.engine.get(r.id)?.status))||H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='accept')),JSON.stringify(H.engine.get(r.id)?.nodes));
  check('an incomplete transcript fails the run typed startup_incomplete_transcript, signed, with no acceptance card and no artifact; its failure card is typed, never an unclassified bug',()=>{const run=H.engine.get(r.id)!;a.equal(run.status,'failed',run.status);a(String(run.error).includes('startup_incomplete_transcript'),String(run.error));a(!H.engine.cards.list({run:r.id}).some(c=>c.kind==='acceptance'));const fc=H.engine.cards.list({run:r.id}).find(c=>c.kind==='failure') as any;a(fc&&fc.failure?.code==='deterministic.incomplete'&&fc.failure?.class==='deterministic',String(fc?.failure?.code));const f=real(r.id).entries.filter((e:any)=>e.record==='startup-round-failed');a.equal(f.length,1);a.equal(f[0].data.code,'startup_incomplete_transcript');a.equal(f[0].data.rounds,1);a(!real(r.id).entries.some((e:any)=>e.record==='startup-artifact'));});
 }finally{H.stop();}
}
// Selectable providers: founderProvider / judgeProvider (claude, codex or cursor); empty keeps Claude founder, Codex judge.
{
 const {resolveStartupModels,startupProvider,StartupModelRefusal,startupCursorAdvice}=await import('../src/domain/startup-recursion');
 check('with Claude and Codex signed in, or Cursor not signed in, nothing is advised and the defaults stand',()=>{a.equal(startupCursorAdvice({claude:'logged-in',codex:'logged-in',cursor:'logged-in'}),null);a.equal(startupCursorAdvice({claude:'not-logged-in',codex:'not-logged-in',cursor:'not-logged-in'}),null);a.equal(startupCursorAdvice({}),null);});
 check('Claude and Codex not signed in while Cursor is: both provider params should be cursor, said in English and zh-TW',()=>{const v=startupCursorAdvice({claude:'not-logged-in',codex:'unknown',cursor:'logged-in'})!;a.equal(v.code,'startup_use_cursor');a.deepEqual(v.params,['founderProvider','judgeProvider']);a(v.en.includes('Claude and Codex are not signed in')&&v.en.includes('Set founderProvider and judgeProvider to cursor')&&v.en.includes('hold at dispatch'),v.en);a(v.zh.includes('尚未登入 Claude 與 Codex')&&v.zh.includes('founderProvider 與 judgeProvider 設為 cursor')&&v.zh.includes('派工時停住'),v.zh);});
 check('only Codex not signed in: only the judge moves to Cursor',()=>{const v=startupCursorAdvice({claude:'logged-in',codex:'not-logged-in',cursor:'logged-in'})!;a.deepEqual(v.params,['judgeProvider']);a(v.en.startsWith('Codex is not signed in')&&v.en.includes('judge step holds')&&!v.en.includes('founderProvider'),v.en);a(v.zh.includes('評審步驟')&&!v.zh.includes('founderProvider'),v.zh);});
 const cfg=(p:string)=>`cfg-${p}-model`;
 check('defaults: the founder runs on Claude and the judge on Codex',()=>{a.equal(startupProvider({},'founder'),'claude');a.equal(startupProvider({},'judge'),'codex');a.deepEqual(resolveStartupModels({},cfg),{founder:{provider:'claude',model:'cfg-claude-model',source:'configured'},judge:{provider:'codex',model:'cfg-codex-model',source:'configured'}});a.deepEqual(resolveStartupModels({founderProvider:'',judgeProvider:''},cfg),resolveStartupModels({},cfg));});
 check('a chosen provider binds that provider\'s configured model',()=>a.deepEqual(resolveStartupModels({founderProvider:'cursor',judgeProvider:'claude'},cfg),{founder:{provider:'cursor',model:'cfg-cursor-model',source:'configured'},judge:{provider:'claude',model:'cfg-claude-model',source:'configured'}}));
 check('an unknown provider is refused, typed and bilingual, never replaced',()=>{let e:any;try{resolveStartupModels({judgeProvider:'gemini'},cfg);}catch(x){e=x;}a(e instanceof StartupModelRefusal);a.equal(e.publicFailure.code,'startup_provider_invalid');a(e.publicFailure.reason.en.includes('judgeProvider')&&e.publicFailure.reason['zh-TW'].includes('judgeProvider'));});
 check('no configured model for the chosen provider names that provider',()=>{let e:any;try{resolveStartupModels({founderProvider:'cursor'},(p:string)=>p==='cursor'?null:cfg(p));}catch(x){e=x;}a.equal(e?.publicFailure?.code,'startup_model_unconfigured');a.equal(e.provider,'cursor');a(e.publicFailure.reason.en.includes('cursor')&&e.publicFailure.reason['zh-TW'].includes('Cursor 創業者'));});
 check('the template declares the provider params as choices, with no default that would change a default run\'s params',()=>{const def=JSON.parse(flow);for(const k of ['founderProvider','judgeProvider']){a.deepEqual(def.params[k].options,['claude','codex','cursor']);a.equal(def.params[k].default,undefined);a(def.params[k].labelZh);}a.equal(def.roles.find((r:any)=>r.id==='founder').provider,'claude');a.equal(def.roles.find((r:any)=>r.id==='judge').provider,'codex');});
 for(const scenario of ['default','cursor','tamper-provider']){
  const H=await harness([flow]);const store=new ArtifactStore(H.data);installStartupRecursion(H.engine,{artifacts:store,configuredModel:cfg as any});const jobs:string[]=[];let run:any;
  H.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxFree:true,start(_sys:any,_tools:any,ctx:any){return{interrupt(){},async *send(text:string){jobs.push(`${id}/${model}`);const judge=text.includes('Role: judge');if(scenario==='tamper-provider'&&!judge)run.params.judgeProvider='claude';const payload=judge?{text:'Critique round 1: willingness to pay is untested; run five paid pilots before growth spending.',score:80,verdict:'ready'}:{text:'Proposal round 1: research service for independent coffee shops with paid pilot validation and explicit revenue assumptions.',revision:''};yield{type:'toolStart',id:'submit',name:'startup_submit',args:payload};const result=await H.agents.callTool(ctx.token,'startup_submit',payload);yield{type:'toolEnd',id:'submit',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};} } as any);
  try{
   run=H.engine.start({workflow:'startup-recursion',text:'Fixture only: provider choice.',params:scenario==='default'?{}:{founderProvider:'cursor',judgeProvider:'cursor'}});
   a(await until(()=>H.engine.cards.list({run:run.id,open:true}).length===1));const c=H.engine.cards.list({run:run.id,open:true})[0];
   if(scenario==='default')check('default: the selection card keeps the template wording, Claude and Codex lines and the Claude verification grant',()=>{a(c.body.includes('Claude: cfg-claude-model / effort=null')&&c.body.includes('Codex: cfg-codex-model / effort=null'),c.body);a.equal(c.sections.en.intent,'Claude founder, Codex judge, at most three rounds, captain signoff.');a(c.sections.en.why.includes('Claude execution verification once'));a.equal(c.sections["zh-TW"].intent,'Claude 創業提案與修訂，Codex 銳評，最多三輪後由船長驗收。');a(!('founderProvider' in run.params)&&!('judgeProvider' in run.params));});
   else check(`${scenario}: the selection card names Cursor for both roles, in English and zh-TW, with no Claude verification`,()=>{a(c.body.includes('Cursor founder: cfg-cursor-model / effort=null')&&c.body.includes('Cursor judge: cfg-cursor-model / effort=null'),c.body);a.equal(c.sections.en.intent,'Cursor founder, Cursor judge, at most three rounds, captain signoff.');a.equal(c.sections["zh-TW"].intent,'Cursor 創業提案與修訂，Cursor 銳評，最多三輪後由船長驗收。');a(!c.sections.en.why.includes('verification once')&&c.sections["zh-TW"].why.includes('不會執行 Claude 驗證'));});
   await H.engine.answer(c.id,{choice:'template',by:'fixture captain'});
   const approved=H.engine.trusted(run.id).entries.find(e=>e.record==='startup-contract-approved')!.data;
   if(scenario==='default')check('default: the signed contract binds Claude founder, Codex judge and the Claude verification grant, as before',()=>{a.deepEqual(Object.keys(approved),['schema','definitionHash','card','candidateHash','candidateMatches','execution','founder','judge','claudeVerification']);a.deepEqual(approved.founder,{provider:'claude',model:'cfg-claude-model',effort:null,source:'configured'});a.deepEqual(approved.judge,{provider:'codex',model:'cfg-codex-model',effort:null,source:'configured'});a.deepEqual(approved.claudeVerification,{provider:'claude',model:'cfg-claude-model',effort:null,maxProbes:3,maxBudgetUSD:0.05,maxTurns:1});});
   else check(`${scenario}: the signed contract binds Cursor for both roles and grants no Claude verification`,()=>{a.equal(approved.founder.provider,'cursor');a.equal(approved.judge.provider,'cursor');a(!('claudeVerification' in approved));});
   if(scenario==='tamper-provider'){a(await until(()=>H.engine.get(run.id)?.status==='failed'),String(H.engine.get(run.id)?.status));check('a provider param changed after approval is refused before the judge runs',()=>{a.deepEqual(jobs,['cursor/cfg-cursor-model']);a(String(H.engine.get(run.id)!.nodes.judge1.error).includes('changed'),String(H.engine.get(run.id)!.nodes.judge1.error));});continue;}
   a(await until(()=>H.engine.cards.list({run:run.id,open:true}).some(c=>c.node==='accept')),JSON.stringify(H.engine.get(run.id)?.nodes));
   const rounds=H.engine.trusted(run.id).entries.filter(e=>e.record==='startup-round').map(e=>`${e.data.role}:${e.data.provider}`);
   check(`${scenario}: rounds run on the chosen providers`,()=>{a.deepEqual(rounds,scenario==='default'?['founder:claude','judge:codex']:['founder:cursor','judge:cursor']);a.deepEqual(jobs,scenario==='default'?['claude/cfg-claude-model','codex/cfg-codex-model']:['cursor/cfg-cursor-model','cursor/cfg-cursor-model']);});
  }finally{for(const r of H.engine.list())if(!['succeeded','failed','cancelled'].includes(r.status))await H.engine.cancel(r.id,'fixture cleanup');H.stop();}
 }
 {
  const {installFirstmate}=await import('../src/firstmate');const {Projects}=await import('../src/doors');
  const H=await harness([flow,readFileSync(join(import.meta.dir,'../workflows/v2/firstmate-proposal.wf.yaml'),'utf8')]);
  try{installStartupRecursion(H.engine,{artifacts:new ArtifactStore(H.data),configuredModel:cfg as any});const tools=installFirstmate(H.engine,new Projects(H.data)),owner={key:'fixture:startup-providers',captain:true,text:'Run a startup competition on Cursor',live:()=>true};
   const contract:any=await tools.call('studio_startup_workflow_contract',{},owner);
   check('Firstmate contract lists the provider params as optional, defaults Claude founder and Codex judge',()=>{a(contract.optionalParams.includes('founderProvider')&&contract.optionalParams.includes('judgeProvider'));a(/founderProvider \(default claude\)/.test(contract.models)&&/judgeProvider \(default codex\)/.test(contract.models));});
   const result:any=await tools.call('studio_propose_work',{workflow:'startup-recursion',version:1,text:'Startup competition on Cursor.',params:{founderProvider:'cursor',judgeProvider:'cursor'}},owner);
   a(await until(()=>H.engine.cards.list({run:result.proposal,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:result.proposal,open:true})[0].id,{choice:'approve',by:'fixture captain'});a(await until(()=>!!H.engine.get(result.proposal)?.ctx.childRun));
   const child=H.engine.get(H.engine.get(result.proposal)!.ctx.childRun)!;a(await until(()=>H.engine.cards.list({run:child.id,open:true}).length===1));
   check('without sign-in facts the contract carries no providerAdvice',()=>a(!('providerAdvice' in contract)));
   check('Firstmate start guidance says to move a role to Cursor when its default vendor is not signed in and Cursor is',()=>{const spec=tools.specs.find((s:any)=>s.name==='studio_propose_work')!;a(/providerAdvice says Claude or Codex is not signed in and Cursor is, set that role to cursor/.test(spec.description),spec.description.slice(0,300));a(/providerAdvice says a default provider is not signed in here and Cursor is: then propose that role on cursor/.test(contract.models));});
   check('a Firstmate proposal carries the provider choice to the selection card',()=>{const body=H.engine.cards.list({run:child.id,open:true})[0].body;a(body.includes('Cursor founder: cfg-cursor-model')&&body.includes('Cursor judge: cfg-cursor-model'),body);});
   H.engine.cancel(child.id,'fixture complete');
  }finally{H.stop();}
 }
 {
  const {installFirstmate}=await import('../src/firstmate');const {Projects}=await import('../src/doors');
  const H=await harness([flow,readFileSync(join(import.meta.dir,'../workflows/v2/firstmate-proposal.wf.yaml'),'utf8')]);
  try{installStartupRecursion(H.engine,{artifacts:new ArtifactStore(H.data),configuredModel:cfg as any});const owner={key:'fixture:startup-advice',captain:true,text:'Run a startup competition',live:()=>true};
   const cursorOnly=await installFirstmate(H.engine,new Projects(H.data),{startupAdvice:async()=>startupCursorAdvice({claude:'not-logged-in',codex:'not-logged-in',cursor:'logged-in'})}).call('studio_startup_workflow_contract',{},owner) as any;
   check('on a Cursor-only Studio the Firstmate contract says, bilingually, to set both provider params to cursor',()=>{a.deepEqual(cursorOnly.providerAdvice?.params,['founderProvider','judgeProvider']);a(cursorOnly.providerAdvice.en.includes('Set founderProvider and judgeProvider to cursor')&&cursorOnly.providerAdvice.zh.includes('設為 cursor'));});
   const signedIn=await installFirstmate(H.engine,new Projects(H.data),{startupAdvice:async()=>startupCursorAdvice({claude:'logged-in',codex:'logged-in',cursor:'logged-in'})}).call('studio_startup_workflow_contract',{},owner) as any;
   check('with Claude and Codex signed in the contract carries no providerAdvice (defaults unchanged)',()=>a(!('providerAdvice' in signedIn)));
  }finally{H.stop();}
 }
}
console.log(`${passed}/0 startup assertions (controlled providers; no live model proof)`);
