import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import{OperatingRules,jobInstructions}from'../src/operating-rules';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {StaffingStore,staffingHash} from '../src/domain/staffing';
const root=mkdtempSync(join(tmpdir(),'staffing-'));let n=0;
const ok=(v:unknown,m:string)=>{if(!v)throw new Error(m);n++};
const rejects=(f:()=>unknown,m:string)=>{let rejected=false;try{f()}catch{rejected=true}ok(rejected,m)};
try{
 const store=new StaffingStore(root), project={namespace:'git' as const,id:'project-one',identity:'canonical-repository-identity'};
 const workflow={id:'code-firstmate',version:1,sha256:staffingHash({definition:1})};
 const skill=store.remember({ref:'pack:firstmate/skills/worker.md',version:1,text:'# Worker\nExact scope.'});
 const roles={worker:{provider:'codex',model:'test-model',effort:'low',skill}};
 const draft={schema:1 as const,algorithm:'sha256-canonical-v1' as const,project,workflow,roles,review:{freshContexts:3,distinctProviders:false}};
 rejects(()=>store.current(project),'missing current must hold');
 const config=store.approve(draft,null,{run:'R-001',card:'SC-001',answerSeq:1});
 ok(store.current(project).hash===config.hash,'approved current roundtrip');
 const pointerPath=join(root,'projects',store.key(project),'staffing','current.json'),firstPointer=readFileSync(pointerPath,'utf8');
 ok(store.skill(config.roles.worker.skill,project)==='# Worker\nExact scope.','exact snapshot read');
 rejects(()=>store.approve(draft,null,{run:'R-001',card:'SC-002',answerSeq:2}),'stale CAS must hold');
 rejects(()=>store.approve({...draft,unexpected:true} as any,config.hash,{run:'R-001',card:'SC-002',answerSeq:2}),'unknown keys must hold');
 rejects(()=>store.approve({...draft,roles:{worker:{...roles.worker,effort:null}}} as any,config.hash,{run:'R-001',card:'SC-002',answerSeq:2}),'Codex effort must be explicit');
 const next=store.approve(draft,config.hash,{run:'R-001',card:'SC-002',answerSeq:2});
 ok(next.version===2&&next.previous===config.hash,'append only version');
 const latestPointer=readFileSync(pointerPath,'utf8');writeFileSync(pointerPath,firstPointer);rejects(()=>store.current(project),'old correctly signed pointer cannot rollback current version');writeFileSync(pointerPath,latestPointer);
 writeFileSync(store.snapshotPath(project,skill.sha256),'tampered');
 rejects(()=>store.current(project),'snapshot tamper holds current');
 rejects(()=>staffingHash({bad:undefined}),'undefined canonical identity rejected');
 console.log(`staffing: ${n} passed`);
}finally{rmSync(root,{recursive:true,force:true})}

if(process.env.STAFFING_BASE_ENGINE){
 const {harness,Y}=await import('./rt-harness');const {installStaffingGuard}=await import('../src/domain/staffing');
 const flow={id:'code-firstmate',name:'Direct start control',kind:'code',version:1,roles:[],nodes:[{id:'wait',kind:'card',label:'Wait',x:1,y:1,card:{options:[{id:'done',label:'Done'}]}}],edges:[]};
 const h=await harness([Y(flow)]);const {Engine}=await import(process.env.STAFFING_BASE_ENGINE);const engine=new Engine(h.engine.deps,h.defs),store=new StaffingStore(h.data);let refused=false;
 try{installStaffingGuard(engine,store,()=>({namespace:'git',id:'p',identity:'control'}));try{engine.start({workflow:flow.id,params:{project:'p'}})}catch{refused=true}console.log(`actual Engine missing-config preallocation refusal=${refused}, allocated=${engine.list().length}`);if(!refused||engine.list().length)process.exitCode=1;}finally{for(const run of engine.list())await engine.cancel(run.id,'control cleanup');h.stop();rmSync(h.data,{recursive:true,force:true})}
 process.exit(process.exitCode??0);
}

// Actual Engine.start is the bypass boundary, not a route-only guard.
{
 const {harness,Y}=await import('./rt-harness');
 const {installStaffingGuard}=await import('../src/domain/staffing');
 const def={id:'code-firstmate',name:'Staffed code',kind:'code',version:1,roles:[{id:'worker',label:'Worker',skill:'pack:firstmate/skills/worker.md'}],nodes:[{id:'wait',kind:'card',label:'Wait',x:1,y:1,card:{options:[{id:'done',label:'Done'}]}}],edges:[]};
 const h=await harness([Y(def)]),e=h.engine,s=new StaffingStore(h.data),p={namespace:'git' as const,id:'project-one',identity:'registered canonical project'};
 try{
  installStaffingGuard(e,s,id=>{if(id!==p.id)throw new Error('unregistered project');return p;});
  const before=e.list().length;
  rejects(()=>e.start({workflow:def.id,params:{project:p.id}}),'actual direct Engine missing config refuses');
  ok(e.list().length===before,'missing approval allocates no run');
  const actual=e.defs.get(def.id)!;const skill=s.remember({ref:def.roles[0].skill,version:1,text:e.deps.skillText(def.roles[0].skill)});
  const c=s.approve({schema:1,algorithm:'sha256-canonical-v1',project:p,workflow:{id:actual.id,version:actual.version,sha256:staffingHash(actual)},roles:{worker:{provider:'codex',model:'chosen-model',effort:'high',skill}},review:{freshContexts:3,distinctProviders:false}},null,{run:'R-source',card:'SC-source',answerSeq:1});
  rejects(()=>e.start({workflow:def.id,params:{project:p.id,_staffing:'forged'}}),'actual direct Engine forged hash refuses');
  const run=e.start({workflow:def.id,params:{project:p.id,_staffing:c.hash}});const node=run.def.nodes[0];node.role='worker';
  // Restore signed definition before verifying its source-owned role pick.
  delete node.role;
  const picked=e.deps.approvedPick(run,{...node,role:'worker'});
  ok(picked.provider==='codex'&&picked.model==='chosen-model'&&picked.effort==='high','approved explicit role pick wins over default');
  ok(e.instructions(run,'worker',[]).includes('# Test skill'),'actual instruction composer receives exact approved snapshot');
  const nodeRun=run.nodes[node.id];nodeRun.agent={provider:'claude',model:'different'};
  ok(e.x(run,{...node,role:'worker'},nodeRun).pick().provider==='codex','raw node agent mutation cannot bypass approved role');
  writeFileSync(s.snapshotPath(p,skill.sha256),'altered');
  rejects(()=>e.instructions(run,'worker',[]),'actual instruction boundary refuses missing/tampered skill');
  await e.cancel(run.id,'fixture complete');
 }finally{h.stop();rmSync(h.data,{recursive:true,force:true})}
 console.log(`staffing total: ${n} passed`);
}
{
 const {harness,Y,until}=await import('./rt-harness');
 const {installStaffingGuard}=await import('../src/domain/staffing');
 const {installFirstmateStaffing}=await import('../src/firstmate-staffing');
 const {bundledText}=await import('../src/bundled');
 const nativeRole='pack:firstmate/skills/worker.md';
 const flow={id:'code-firstmate',name:'Actual staffing payload',kind:'code',version:1,roles:[{id:'worker',label:'Worker',skill:nativeRole}],nodes:[{id:'work',kind:'agent',role:'worker',mode:'receipt',label:'Work',x:1,y:1}],edges:[]};
 const h=await harness([Y(flow),bundledText('workflows/v2/firstmate-staffing.wf.yaml')!]),e=h.engine,store=new StaffingStore(h.data),project={namespace:'git' as const,id:'p',identity:'isolated-fixture-project'};
 const receipts:any[]=[];
 let exhausted=false;
 const facts=async()=>[{provider:'codex',support:'supported' as const,auth:'verified',quota:exhausted?'exhausted':'available',expires:Date.now()+30000,models:[{id:'explicit-model',efforts:['high']}]},{provider:'claude',support:'unsupported' as const,auth:'unverified',quota:'unknown',expires:Date.now()+30000,models:[]}];
 try{
  installStaffingGuard(e,store,()=>project);
  const tools=installFirstmateStaffing(e,store,()=>project,facts);
  const owner={key:'captain-round-1',captain:true,text:'Use Codex explicit-model high for worker',live:()=>true};
  const absent=await tools.call('studio_staffing_facts',{},owner) as any;
  ok(absent.capabilities.find((c:any)=>c.provider==='claude').support==='unsupported','Claude unsupported is explicit before any paid work');
  let failed=false;try{await tools.call('studio_propose_staffing',{project:'p',workflow:flow.id,version:1,roles:{worker:{provider:'claude',model:'invented',effort:null}}},owner)}catch{failed=true}ok(failed&&e.list().length===0,'unsupported choice cannot create config proposal or paid work');
  const interviewBase={project:'p',workflow:flow.id,version:1};
  const first=await tools.call('studio_staffing_interview',interviewBase,owner) as any;ok(first.frontier[0].field==='provider','first frontier asks vendor before model');
  const vendor=await tools.call('studio_staffing_interview',{...interviewBase,answers:{worker:{provider:'codex'}}},owner) as any;ok(vendor.frontier[0].field==='model','vendor answer unlocks model frontier');
  let sameTurn=false;try{await tools.call('studio_staffing_interview',{...interviewBase,answers:{worker:{model:'explicit-model'}}},owner)}catch{sameTurn=true}ok(sameTurn,'dependent frontier cannot be answered by model in same captain turn');
  const model=await tools.call('studio_staffing_interview',{...interviewBase,answers:{worker:{model:'explicit-model'}}},{...owner,key:'captain-round-2'}) as any;ok(model.frontier[0].field==='effort','model answer unlocks effort frontier');
  const effort=await tools.call('studio_staffing_interview',{...interviewBase,answers:{worker:{effort:'high'}}},{...owner,key:'captain-round-3'}) as any;ok(effort.complete,'explicit effort completes persisted choices');
  exhausted=true;const exhaustedFacts=await tools.call('studio_staffing_facts',{},owner) as any;ok(exhaustedFacts.capabilities[0].auth==='verified'&&exhaustedFacts.capabilities[0].quota==='exhausted','authenticated exhausted account remains distinct from missing login');let exhaustedRefused=false;try{await tools.call('studio_propose_staffing',{project:'p',workflow:flow.id,version:1,roles:{worker:{provider:'codex',model:'explicit-model',effort:'high'}}},owner)}catch{exhaustedRefused=true}ok(exhaustedRefused&&e.list().length===0,'exhausted authenticated account holds without retry or fallback');exhausted=false;
  const proposal=await tools.call('studio_propose_staffing',{project:'p',workflow:flow.id,version:1,roles:{worker:{provider:'codex',model:'explicit-model',effort:'high'}}},owner) as any;
  await until(()=>e.get(proposal.proposal)?.nodes.confirm.waiting==='card');
  rejects(()=>store.current(project),'model proposal alone cannot activate config');
  const card=e.cards.list({run:proposal.proposal})[0];ok(card.captainOnly&&card.body.includes('explicit-model')&&card.body.includes(nativeRole),'actual card shows selected model and native skill');
  await e.answer(card.id,{choice:'approve',by:'captain'});await until(()=>e.get(proposal.proposal)?.status==='succeeded');
  const config=store.current(project);ok(config.approval.card===card.id&&config.approval.answerSeq>0,'actual signed captain answer activates configuration');
  e.deps.selectProvider=async(x,p)=>({id:p.provider,model:p.model!,reasoningEffort:p.effort,sandboxFree:true,start(system,tools,ctx){receipts.push({provider:p.provider,model:p.model,effort:p.effort,system});return{interrupt(){},async *send(){yield{type:'turnEnd' as const,status:'ok' as const}}}}});
  e.modes.receipt={system:(_x,skill)=>skill,prompt:()=> 'Offline staffing receipt',tools:()=>[],after:()=> 'ok'};
  const task=e.start({workflow:flow.id,params:{project:project.id,_staffing:config.hash}});
  await until(()=>['succeeded','failed'].includes(task.status));
  ok(task.status==='succeeded'&&receipts.length===1,'actual approved Engine task invokes provider.start once');
  ok(receipts[0]?.provider==='codex'&&receipts[0]?.model==='explicit-model'&&receipts[0]?.effort==='high','actual provider.start receives exact captain-selected model and effort');
  ok(receipts[0]?.system.includes(store.skill(config.roles.worker.skill,project)),'actual provider.start receives exact approved skill body');
  const instructionRecord=e.ledger(task.id).find(r=>r.record==='staffing-instructions');ok(instructionRecord?.data?.config===config.hash&&instructionRecord.data.skill===config.roles.worker.skill.sha256,'actual instruction receipt binds signed config and skill');
  const allowedProvider=e.deps.selectProvider;const {ProviderRefusal}=await import('../src/providers/policy');e.deps.selectProvider=async()=>{throw new ProviderRefusal('offline capability hold')};
  let held=e.start({workflow:flow.id,params:{project:project.id,_staffing:config.hash}});await until(()=>held.nodes.work.waiting==='card'&&!e.busy(held.id));
  const recoveryCard=e.cards.get(held.nodes.work.card!);ok(recoveryCard?.status==='open'&&held.status==='waiting','existing task exposes genuine readiness recovery hold');
  // Simulate a pre-existing newer signed configuration; recovery must bind it without another identical activation.
  const {hash:oldHash,signature:oldSignature,version:oldVersion,previous:oldPrevious,approval:oldApproval,...recoveryDraft}=config;
  store.approve(recoveryDraft,config.hash,{run:'R-existing-config',card:'SC-existing-config',answerSeq:1});
  const recovery=await tools.call('studio_change_staffing',{task:held.id,node:'work',roles:{worker:{provider:'codex',model:'explicit-model',effort:'high'}}},{...owner,key:'captain-recovery'}) as any;
  await until(()=>e.get(recovery.proposal)?.nodes.confirm.waiting==='card');const staffingCard=e.cards.list({run:recovery.proposal})[0];
  ok(staffingCard.body.includes(held.id)&&staffingCard.body.includes(recoveryCard!.id),'recovery approval shows exact existing task and separate preparation card');
  await e.answer(staffingCard.id,{choice:'approve',by:'captain'});await until(()=>e.get(recovery.proposal)?.status==='succeeded');
  ok(held.params._staffing===store.current(project).hash&&e.cards.get(recoveryCard!.id)?.status==='open','configuration upgrade preserves explicit preparation approval');
  ok(receipts.length===1&&e.list().filter(r=>r.workflow===flow.id).length===2,'staffing recovery neither launches paid work nor creates replacement task');
  const upgraded=store.current(project);e.load();held=e.get(held.id)!;
  ok(held.params._staffing===config.hash&&held.params._staffing!==upgraded.hash,'restart reproduces old creation params rather than persisting upgrade cache');
  ok(e.deps.staffingBinding!(held)===upgraded.hash,'restart derives approved staffing from signed upgrade');
  const historicalParams=JSON.stringify(held.params);held.params._staffing='f'.repeat(64);
  ok(e.deps.staffingBinding!(held)===upgraded.hash,'unsigned parameter cache cannot select another configuration');held.params=JSON.parse(historicalParams);
  const trusted=e.trusted.bind(e);e.trusted=(id:string)=>id===held.id?{...trusted(id),ok:false}:trusted(id);
  rejects(()=>e.deps.staffingBinding!(held),'untrusted ledger cannot restore staffing');e.trusted=trusted;
  // A later valid project config alone cannot silently upgrade this task.
  const pointer=join(h.data,'projects',store.key(project),'staffing','current.json'),savedPointer=readFileSync(pointer,'utf8');
  const {hash,signature,version,previous,approval,...nextDraft}=upgraded;
  store.approve(nextDraft,upgraded.hash,{run:'R-999',card:'SC-999',answerSeq:1});
  rejects(()=>e.deps.staffingBinding!(held),'changed project current still requires explicit task upgrade');writeFileSync(pointer,savedPointer);rmSync(join(h.data,'projects',store.key(project),'staffing',`v${upgraded.version+1}.json`));
  const replayed=await tools.call('studio_change_staffing',{task:held.id,node:'work',roles:{worker:{provider:'codex',model:'explicit-model',effort:'high'}}},{...owner,key:'captain-recovery-after-restart'}) as any;
  await until(()=>e.get(replayed.proposal)?.nodes.confirm.waiting==='card');
  const replayPin=JSON.parse(e.get(replayed.proposal)!.params.recovery);
  ok(replayPin.config===upgraded.hash,'next recovery after restart pins signed predecessor instead of stale params');
  await e.cancel(replayed.proposal,'fixture no second upgrade required');
  e.deps.selectProvider=allowedProvider;await e.answer(recoveryCard!.id,{choice:'retry',by:'captain'});await until(()=>held.status==='succeeded');
  ok(held.status==='succeeded'&&receipts.length===2,'separate captain reprepare resumes same task on approved staffing');
  // Historical tasks predate staffing-start and have no creation _staffing param.
  const authorizeStart=e.deps.authorizeStart,initializeRun=e.deps.initializeRun;e.deps.authorizeStart=undefined;e.deps.initializeRun=undefined;
  let legacy=e.start({workflow:flow.id,params:{project:project.id}});e.deps.authorizeStart=authorizeStart;e.deps.initializeRun=initializeRun;
  await until(()=>legacy.nodes.work.waiting==='card'&&!e.busy(legacy.id));
  const legacyCard=e.cards.get(legacy.nodes.work.card!)!;
  legacy.params._staffing=store.current(project).hash;
  rejects(()=>e.deps.staffingBinding!(legacy),'historical task cannot gain authority from cache alone');delete legacy.params._staffing;
  const legacyRecovery=await tools.call('studio_change_staffing',{task:legacy.id,node:'work',roles:{worker:{provider:'codex',model:'explicit-model',effort:'high'}}},{...owner,key:'legacy-recovery'}) as any;
  await until(()=>e.get(legacyRecovery.proposal)?.nodes.confirm.waiting==='card');
  const legacyApproval=e.cards.list({run:legacyRecovery.proposal})[0];await e.answer(legacyApproval.id,{choice:'approve',by:'captain'});await until(()=>e.get(legacyRecovery.proposal)?.status==='succeeded');
  e.load();legacy=e.get(legacy.id)!;
  ok(!legacy.params._staffing&&e.deps.staffingBinding!(legacy)===store.current(project).hash,'historical task with no original staffing restores signed upgrade after restart');
  await e.answer(legacyCard.id,{choice:'retry',by:'captain'});await until(()=>legacy.status==='succeeded');
  ok(legacy.status==='succeeded'&&receipts.length===3,'historical task resumes only after separate captain retry');
  const v2=e.defs.save(flow.id,{base:1,nodes:[{...flow.nodes[0],label:'Updated work'}]},'captain');const oldChoices=store.interview(project,{id:flow.id,version:1,sha256:staffingHash(e.defs.get(flow.id,1))},['worker']);
  const upgradeBase={project:project.id,workflow:flow.id,version:v2.version};const fresh=await tools.call('studio_staffing_interview',upgradeBase,{...owner,key:'upgrade-read'})as any;ok(fresh.frontier[0].field==='provider'&&Object.keys(fresh.choices).length===0,'actual native tool starts fresh v2 grilling after completed v1');
  let choices:any;for(const[field,value]of [['provider','codex'],['model','explicit-model'],['effort','high']])choices=await tools.call('studio_staffing_interview',{...upgradeBase,answers:{worker:{[field]:value}}},{...owner,key:'upgrade-'+field});
  const upgradeProposal=await tools.call('studio_propose_staffing',{...upgradeBase,roles:choices.choices},{...owner,key:'upgrade-confirm'})as any;await until(()=>e.get(upgradeProposal.proposal)?.nodes.confirm.waiting==='card');const upgradeCard=e.cards.list({run:upgradeProposal.proposal})[0];await e.answer(upgradeCard.id,{choice:'approve',by:'captain'});await until(()=>e.get(upgradeProposal.proposal)?.status==='succeeded');ok(store.current(project).workflow.version===2,'actual captain approval activates independently discussed v2 configuration');ok(staffingHash(store.interview(project,oldChoices.workflow,['worker']))===staffingHash(oldChoices),'actual v2 approval retains signed v1 discussion unchanged');


 }finally{for(const r of e.list())if(!['succeeded','failed','cancelled'].includes(r.status))await e.cancel(r.id,'fixture cleanup');h.stop();rmSync(h.data,{recursive:true,force:true})}
 console.log(`staffing total: ${n} passed`);
}

// Canonical project identity uses actual local Git metadata, never a model path.
{
 const {mkdirSync,symlinkSync}=await import('node:fs');const {Projects}=await import('../src/doors');
 const base=mkdtempSync(join(tmpdir(),'staffing-identity-')),data=join(base,'data'),repo=join(base,'repo');mkdirSync(data);mkdirSync(repo);
 const git=(args:string[])=>{const r=Bun.spawnSync(['git',...args],{cwd:repo,env:{PATH:process.env.PATH!,HOME:base,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'},stdout:'pipe',stderr:'pipe'});if(r.exitCode)throw new Error(r.stderr.toString());};
 try{
  git(['init','-b','main']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Fixture initial']);
  const project={id:'real-local',name:'Fixture repository',path:repo,base:'main',sensitive:[],proposed:null,proposedAt:null,approvedAt:null,enabled:true};const registry=join(data,'projects.json'),projects=new Projects(data);writeFileSync(registry,JSON.stringify([project]));
  const first=projects.staffingIdentity(project.id);ok(first.namespace==='git'&&first.identity.length===64,'strict source helper resolves actual Git project identity');
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Fixture next head']);ok(projects.staffingIdentity(project.id).identity===first.identity,'staffing identity stays stable across actual commits');
  rejects(()=>projects.staffingIdentity(project.id,[repo]),'protected registered repository refuses staffing authority');
  writeFileSync(registry,JSON.stringify([{...project,enabled:false}]));rejects(()=>projects.staffingIdentity(project.id),'disabled project refuses canonical staffing identity');
  writeFileSync(registry,JSON.stringify([project,{...project,id:'alias'}]));rejects(()=>projects.staffingIdentity(project.id),'two registry aliases of one Git identity fail closed');
  writeFileSync(registry,JSON.stringify([{...project,base:'missing'}]));rejects(()=>projects.staffingIdentity(project.id),'missing confirmed base refuses identity');
  writeFileSync(registry,JSON.stringify([{...project,github:{repository:'synthetic/unverified'}}]));rejects(()=>projects.staffingIdentity(project.id),'external grant cannot become local staffing authority without source verifier');
  writeFileSync(registry,JSON.stringify([project]));rmSync(join(repo,'.git','refs','heads','main'));writeFileSync(join(data,'private-ref'),'a'.repeat(40)+' refs/heads/main\n');symlinkSync(join(data,'private-ref'),join(repo,'.git','packed-refs'));rejects(()=>projects.staffingIdentity(project.id),'packed reference symlink cannot read private data outside Git container');
  // The built-in sandbox at exactly <data>/demo-repo is the one repository below the data root with staffing identity.
  {const sandbox=join(data,'demo-repo'),sgit=(cwd:string,args:string[])=>{const r=Bun.spawnSync(['git',...args],{cwd,env:{PATH:process.env.PATH!,HOME:base,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'},stdout:'pipe',stderr:'pipe'});if(r.exitCode)throw new Error(r.stderr.toString());};
   const init=(p:string)=>{mkdirSync(p,{recursive:true});sgit(p,['init','-b','main']);sgit(p,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Fixture sandbox']);};init(sandbox);
   const demo={...project,id:'sandbox',path:sandbox},use=(...records:any[])=>writeFileSync(registry,JSON.stringify(records));
   use(demo);ok(projects.staffingIdentity('sandbox').namespace==='git','built-in sandbox at data/demo-repo has staffing identity');
   rejects(()=>projects.staffingIdentity('sandbox',[sandbox]),'an explicit protected root still refuses the sandbox');
   rejects(()=>projects.staffingIdentity('sandbox',[data]),'a protected root equal to the data root still refuses the sandbox');
   use({...demo,id:'other'});rejects(()=>projects.staffingIdentity('other'),'another id at data/demo-repo cannot claim the sandbox exception');
   const elsewhere=join(data,'other-repo');init(elsewhere);use({...demo,path:elsewhere});rejects(()=>projects.staffingIdentity('sandbox'),'the sandbox id at another data path stays refused');
   use({...demo,path:data+'/x/../demo-repo'});rejects(()=>projects.staffingIdentity('sandbox'),'a non-literal spelling of the sandbox path is refused');
   symlinkSync(elsewhere,join(data,'demo-link'));use({...demo,path:join(data,'demo-link')});rejects(()=>projects.staffingIdentity('sandbox'),'a link inside data cannot borrow the sandbox exception');
   writeFileSync(join(sandbox,'.git','commondir'),'../../other-repo/.git\n');use(demo);rejects(()=>projects.staffingIdentity('sandbox'),'a sandbox commondir redirect into private data is refused');rmSync(join(sandbox,'.git','commondir'));
   const real=join(data,'demo-repo-real');sgit(data,['clone','-q',sandbox,real]);rmSync(sandbox,{recursive:true,force:true});symlinkSync(real,sandbox);rejects(()=>projects.staffingIdentity('sandbox'),'a demo-repo symlink to other private data is refused');
   rmSync(sandbox);mkdirSync(sandbox);writeFileSync(join(sandbox,'.git'),`gitdir: ${join(real,'.git')}\n`);rejects(()=>projects.staffingIdentity('sandbox'),'a sandbox .git file pointing at other private data is refused');}
  writeFileSync(registry,'{malformed');rejects(()=>projects.staffingIdentity(project.id),'corrupt registry is never treated as empty or repaired');
 }finally{rmSync(base,{recursive:true,force:true})}
 console.log(`staffing total: ${n} passed`);
}

// Actual MainSession -> owned native Codex tool calls -> captain config -> CLI payload.
if(process.env.STAFFING_CONVERSATION==='1'){
 const {staffingConversationFixture}=await import('./lib/firstmate-staffing-fixture');const{Projects}=await import('../src/doors');const f=await staffingConversationFixture();
 try{
  const started=await f.api('/api/main/start',{host:'codex',confirm:true});ok(started.status===200,'actual independently owned primary starts for staffing conversation');await f.until(async()=>!(await f.api('/api/main')).body.busy);
  const registrationCount=f.rows().filter(r=>r.toolResult).length;await f.api('/api/main/send',{text:'NATIVE-PROJECT '+JSON.stringify({path:f.repo,name:'Staffing repo',workflow:'code-firstmate',version:1,text:'Verify approved native staffing delivery'})});await f.until(async()=>f.rows().filter(r=>r.toolResult).length>registrationCount&&!(await f.api('/api/main')).body.busy);const registrationResult=JSON.parse(f.rows().filter(r=>r.toolResult).at(-1).toolResult.contentItems[0].text);if(registrationResult.error)throw new Error(JSON.stringify(registrationResult));await f.until(async()=>(await f.api(`/api/wruns/${registrationResult.proposal}`)).body.nodes.register.waiting==='card');const registrationCard=(await f.api('/api/scards')).body.cards.find((c:any)=>c.run===registrationResult.proposal);await f.api(`/api/scards/${registrationCard.id}/answer`,{choice:'approve'});ok(await f.until(async()=>(await f.api(`/api/wruns/${registrationResult.proposal}`)).body.status==='succeeded'),'actual registration captain approval pauses cleanly for staffing instead of failing continuation');const registrationRun=(await f.api(`/api/wruns/${registrationResult.proposal}`)).body;const pending=registrationRun.ledger.find((e:any)=>e.record==='firstmate-project-staffing-pending')?.data;ok(pending?.schema===1&&!registrationRun.ledger.some((e:any)=>e.record==='firstmate-project-continuation-start')&&!(await f.api('/api/wruns')).body.runs.some((r:any)=>r.workflow==='firstmate-proposal'||r.workflow==='code-firstmate'),'signed pending intent preserves registration without consuming dispatch or allocating work');const project={id:pending.project};ok(!!project.id,'conversation continues with source-registered project without manual project ID lookup');await f.until(async()=>!(await f.api('/api/main')).body.busy);
  const tool=async(name:string,args:any)=>{const count=f.rows().filter(r=>r.toolResult).length;await f.api('/api/main/send',{text:'NATIVE-STAFFING '+JSON.stringify({name,args})});const finished=await f.until(async()=>f.rows().filter(r=>r.toolResult).length>count&&!(await f.api('/api/main')).body.busy);if(!finished)throw new Error('Owned primary tool request did not finish');const result=f.rows().filter(r=>r.toolResult).at(-1)?.toolResult;return JSON.parse(result.contentItems[0].text);};
  const facts=await tool('studio_staffing_facts',{});ok(facts.capabilities.some((c:any)=>c.provider==='codex'&&c.auth==='verified'&&c.quota==='available'),'actual chat reads strict offline native capability facts before choosing roles');
  const base={project:project.id,workflow:'code-firstmate',version:1};const frontier=await tool('studio_staffing_interview',base);if(!frontier.frontier)throw new Error(JSON.stringify({project,frontier}));ok(frontier.frontier.length===4&&frontier.frontier.every((q:any)=>q.field==='provider'),'actual chat asks all role vendors before dependent questions');
  const ids=['coordinator','worker','reviewer','designer'];let round=await tool('studio_staffing_interview',{...base,answers:Object.fromEntries(ids.map(id=>[id,{provider:'codex'}]))});ok(round.frontier.every((q:any)=>q.field==='model'),'actual next captain reply unlocks model questions');
  round=await tool('studio_staffing_interview',{...base,answers:Object.fromEntries(ids.map(id=>[id,{model:'fixture-model'}]))});ok(round.frontier.every((q:any)=>q.field==='effort'),'actual next captain reply unlocks effort questions');
  round=await tool('studio_staffing_interview',{...base,answers:Object.fromEntries(ids.map(id=>[id,{effort:'low'}]))});ok(round.complete,'actual separate captain effort reply completes role configuration');
  const proposal=await tool('studio_propose_staffing',{...base,roles:round.choices});if(proposal.error)throw new Error(JSON.stringify(proposal));await f.until(async()=>(await f.api(`/api/wruns/${proposal.proposal}`)).body.nodes.confirm.waiting==='card');const card=(await f.api('/api/scards')).body.cards.find((c:any)=>c.run===proposal.proposal);ok(card.captainOnly&&!(await f.api('/api/wruns')).body.runs.some((r:any)=>r.workflow==='code-firstmate'),'actual conversation raises config confirmation before any coding work');await f.api(`/api/scards/${card.id}/answer`,{choice:'approve'});ok(await f.until(async()=>(await f.api(`/api/wruns/${proposal.proposal}`)).body.status==='succeeded'),'actual captain approval writes project-local configuration');
  const config=new StaffingStore(f.data).current(new Projects(f.data).staffingIdentity(project.id));ok(config.roles.worker.provider==='codex'&&config.roles.reviewer.provider==='codex','written source configuration reflects captain choices rather than default Claude reviewer');
  const before=f.rows().filter(r=>r.toolResult).length;await f.api('/api/main/send',{text:'NATIVE-PROPOSE '+JSON.stringify({workflow:'code-firstmate',version:1,text:'Verify approved native staffing delivery',params:{project:project.id}})});await f.until(async()=>f.rows().filter(r=>r.toolResult).length>before&&!(await f.api('/api/main')).body.busy);const dispatchResult=JSON.parse(f.rows().filter(r=>r.toolResult).at(-1).toolResult.contentItems[0].text);if(dispatchResult.error)throw new Error(JSON.stringify(dispatchResult));await f.until(async()=>(await f.api(`/api/wruns/${dispatchResult.proposal}`)).body.nodes.dispatch.waiting==='card');const dispatch=(await f.api('/api/scards')).body.cards.find((c:any)=>c.run===dispatchResult.proposal);await f.api(`/api/scards/${dispatch.id}/answer`,{choice:'approve'});
  const found=await f.until(async()=>(await f.api('/api/agents')).body.some((job:any)=>job.log.some((line:any)=>line.text.includes('NATIVE_STAFFING_RECEIPT '))));if(!found)console.log('conversation diagnostics',JSON.stringify((await f.api('/api/wruns')).body.runs.map((r:any)=>({id:r.id,status:r.status,error:r.error,nodes:r.nodes}))),JSON.stringify((await f.api('/api/agents')).body),f.output().slice(-1000));ok(found,'actual selected Codex CLI reaches provider.start with no real model call');
  const task=(await f.api('/api/wruns')).body.runs.find((r:any)=>r.workflow==='code-firstmate'),detail=await f.api(`/api/wruns/${task.id}`),instruction=detail.body.ledger.find((e:any)=>e.record==='staffing-instructions');const job=(await f.api('/api/agents')).body.find((j:any)=>j.log.some((l:any)=>l.text.includes('NATIVE_STAFFING_RECEIPT ')));const receipt=job?.log.find((l:any)=>l.text.includes('NATIVE_STAFFING_RECEIPT '))?.text;const actual=receipt?JSON.parse(receipt.slice(receipt.indexOf('NATIVE_STAFFING_RECEIPT ')+'NATIVE_STAFFING_RECEIPT '.length)):null;ok(actual?.model==='fixture-model'&&actual?.effort==='low'&&actual?.instructionsSha256===instruction?.data.instructionsSha256,'actual CLI instruction hash/model/effort match signed source staffing receipt');
 }finally{await f.close();}
 console.log(`staffing conversation total: ${n} passed`);
}

// The built-in sandbox (money-kit at data/demo-repo) through the real server: staffing identity,
// captain approval, dispatch and the first agent launch all pass; no GitHub, no real model.
if(process.env.STAFFING_CONVERSATION==='1'){
 const {staffingConversationFixture}=await import('./lib/firstmate-staffing-fixture');const {existsSync,readdirSync}=await import('node:fs');const f=await staffingConversationFixture();
 try{
  const registered=JSON.parse(readFileSync(join(f.data,'projects.json'),'utf8')).find((p:any)=>p.id==='sandbox');ok(registered?.path===join(f.data,'demo-repo'),'the server registers money-kit as project sandbox at data/demo-repo');
  const started=await f.api('/api/main/start',{host:'codex',confirm:true});ok(started.status===200,'sandbox conversation primary starts');await f.until(async()=>!(await f.api('/api/main')).body.busy);
  const tool=async(name:string,args:any)=>{const count=f.rows().filter(r=>r.toolResult).length;await f.api('/api/main/send',{text:'NATIVE-STAFFING '+JSON.stringify({name,args})});if(!await f.until(async()=>f.rows().filter(r=>r.toolResult).length>count&&!(await f.api('/api/main')).body.busy))throw new Error('Owned primary tool request did not finish');return JSON.parse(f.rows().filter(r=>r.toolResult).at(-1)?.toolResult.contentItems[0].text);};
  const base={project:'sandbox',workflow:'code-firstmate',version:1},ids=['coordinator','worker','reviewer','designer'];
  let round=await tool('studio_staffing_interview',base);ok(!round.error&&round.frontier?.length===4,'staffing interview accepts the built-in sandbox identity '+(round.error?JSON.stringify(round):''));
  for(const answer of [{provider:'codex'},{model:'fixture-model'},{effort:'low'}])round=await tool('studio_staffing_interview',{...base,answers:Object.fromEntries(ids.map(id=>[id,answer]))});ok(round.complete,'sandbox role configuration completes');
  const proposal=await tool('studio_propose_staffing',{...base,roles:round.choices});if(proposal.error)throw new Error(JSON.stringify(proposal));await f.until(async()=>(await f.api(`/api/wruns/${proposal.proposal}`)).body.nodes.confirm.waiting==='card');
  const card=(await f.api('/api/scards')).body.cards.find((c:any)=>c.run===proposal.proposal);await f.api(`/api/scards/${card.id}/answer`,{choice:'approve'});ok(await f.until(async()=>(await f.api(`/api/wruns/${proposal.proposal}`)).body.status==='succeeded'),'captain approval writes sandbox staffing');
  const before=f.rows().filter(r=>r.toolResult).length;await f.api('/api/main/send',{text:'NATIVE-PROPOSE '+JSON.stringify({workflow:'code-firstmate',version:1,text:'Round the totals in src/money.ts',params:{project:'sandbox'}})});await f.until(async()=>f.rows().filter(r=>r.toolResult).length>before&&!(await f.api('/api/main')).body.busy);
  const dispatchResult=JSON.parse(f.rows().filter(r=>r.toolResult).at(-1).toolResult.contentItems[0].text);ok(!dispatchResult.error&&!!dispatchResult.proposal,'the sandbox coding proposal is captured, not refused as private data '+(dispatchResult.error?JSON.stringify(dispatchResult):''));
  await f.until(async()=>(await f.api(`/api/wruns/${dispatchResult.proposal}`)).body.nodes.dispatch.waiting==='card');const dispatch=(await f.api('/api/scards')).body.cards.find((c:any)=>c.run===dispatchResult.proposal);await f.api(`/api/scards/${dispatch.id}/answer`,{choice:'approve'});
  const launched=await f.until(async()=>(await f.api('/api/agents')).body.some((job:any)=>job.log.some((line:any)=>line.text.includes('NATIVE_STAFFING_RECEIPT '))));
  const task=(await f.api('/api/wruns')).body.runs.find((r:any)=>r.workflow==='code-firstmate');if(!launched)console.log('sandbox diagnostics',JSON.stringify(task),f.output().slice(-1500));
  ok(launched&&task?.status!=='failed'&&!/overlaps private|outside Studio private data/.test(JSON.stringify(task)),'the sandbox code-firstmate Task passes staffing admission and launches its first agent');
  const wt=join(f.data,'work','wt','sandbox'),worktree=await f.until(async()=>existsSync(wt)&&readdirSync(wt).some(e=>e.endsWith('.json')));
  ok(worktree,'the sandbox Task is admitted to a Studio worktree under data/work/wt/sandbox '+(worktree?'':JSON.stringify((await f.api(`/api/wruns/${task?.id}`)).body?.nodes)));
 }finally{await f.close();}
 console.log(`staffing sandbox total: ${n} passed`);
}

{
 const{harness,Y,until}=await import('./rt-harness');const{installStaffingGuard}=await import('../src/domain/staffing');const{createHash}=await import('node:crypto');const{createNativeProviderAdmission}=await import('../src/providers/native-admission');
 const roles=['reviewer','designer'].map(id=>({id,label:id,skill:`pack:firstmate/skills/${id}.md`})),flow={id:'code-firstmate',name:'Fresh role contexts',kind:'code',version:1,roles,nodes:[{id:'primary',kind:'agent',role:'reviewer',mode:'primary',label:'Primary review',x:1,y:1},{id:'wait',kind:'hook',do:'hold-judges',label:'Wait for checks',x:2,y:1}],edges:[['primary','wait']]};
 const h=await harness([Y(flow)]),e=h.engine,store=new StaffingStore(h.data),project={namespace:'git' as const,id:'p',identity:'strict-fresh-review-fixture'},receipts:any[]=[];let checkOwner:any,finishChecks=()=>{};e.actions['hold-judges']=async x=>{checkOwner=x;await new Promise<void>(r=>finishChecks=r);return'ok'};e.deps.skillText=ref=>`# Exact native ${ref.includes('designer')?'designer':'reviewer'} body\n`;
 try{
  installStaffingGuard(e,store,()=>project);const def=e.defs.get(flow.id)!,config=store.approve({schema:1,algorithm:'sha256-canonical-v1',project,workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles:Object.fromEntries(roles.map(role=>[role.id,{provider:'codex',model:role.id+'-model',effort:role.id==='reviewer'?'high':'low',skill:store.remember({ref:role.skill,version:1,text:e.deps.skillText(role.skill)})}])),review:{freshContexts:3,distinctProviders:false}},null,{run:'R-source',card:'SC-source',answerSeq:1});
  e.deps.selectProvider=async(_x,p)=>({id:p.provider,model:p.model!,reasoningEffort:p.effort,sandboxFree:true,start(system,tools,ctx){const receipt={system,model:p.model,effort:p.effort,session:crypto.randomUUID()};receipts.push(receipt);return{interrupt(){},async *send(){if(tools.some(t=>t.name==='judge_report')){const response=await fetch(ctx.studioUrl+'/api/tools/judge_report',{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify({verdict:'pass',findings:[]})});if(!response.ok)throw new Error('Actual fixture judge tool failed');}yield{type:'turnEnd' as const,status:'ok' as const}}}}});
  const select=e.deps.selectProvider,certified=new WeakMap<object,any>();e.deps.selectProvider=async(x,p,c)=>{const provider=await select(x,p,c);certified.set(provider,{input:{},expires:Date.now()+30000,x});return provider;};h.agents.providerAdmission=createNativeProviderAdmission({certified,engine:()=>e,select:async()=>{throw new Error('unexpected refresh')},pick:async()=>{throw new Error('unexpected uncertified provider')}});
  e.modes.primary={system:(_x,skill)=>skill,prompt:()=> 'Read-only synthetic primary review',tools:()=>[],after:()=> 'ok'};const task=e.start({workflow:flow.id,params:{project:project.id,_staffing:config.hash}});await until(()=>!!checkOwner);const x=checkOwner,input:any={out:h.data,params:{},run:task.id};
  const review=await e.judge(x,{id:'review-verdict',title:{en:'Synthetic fresh review'},judge:{prompt:'Offline text verification only',quorum:{n:1,of:2}},timeout_s:5,network:[]}as any,{use:'fixture/review'}as any,input);
  ok(review.verdict==='pass'&&receipts.length===3&&new Set(receipts.map(r=>r.session)).size===3,'primary reviewer plus two same-vendor judges create three fresh provider sessions');
  ok(receipts.every(r=>r.model==='reviewer-model'&&r.effort==='high'&&r.system.includes(store.skill(config.roles.reviewer.skill,project))),'every actual fresh reviewer payload gets exact reviewer snapshot/model/effort');
  const design=await e.judge(x,{id:'designer-compare',title:{en:'Synthetic design text check'},judge:{prompt:'Offline text fixture; no real image inspection claim'},timeout_s:5,network:[]}as any,{use:'fixture/designer'}as any,input);
  ok(design.verdict==='pass'&&receipts.at(-1).model==='designer-model'&&receipts.at(-1).effort==='low'&&receipts.at(-1).system.includes(store.skill(config.roles.designer.skill,project)),'actual designer check gets its own approved role snapshot and effort');
  const records=e.ledger(task.id).filter(r=>r.record==='staffing-instructions');ok(records.length===receipts.length&&records.every((r,i)=>r.data.instructionsSha256===createHash('sha256').update(receipts[i].system).digest('hex')),'signed instruction hashes match actual safety-prefixed provider.start payloads for all contexts');finishChecks();await until(()=>task.status==='succeeded');
 }finally{finishChecks();h.stop();rmSync(h.data,{recursive:true,force:true})}
 console.log(`staffing all roles total: ${n} passed`);
}

// Actual server resolver, after a real Agents queue wait, must recheck staffing.
{
 const {harness,Y,until}=await import('./rt-harness');const{installStaffingGuard}=await import('../src/domain/staffing');const{createNativeProviderAdmission}=await import('../src/providers/native-admission');const{withSafetyRules}=await import('../src/skills');
 for(const kind of ['run:receipt','judge:review-verdict','card:merge'])for(const mode of ['cached','refreshed'])for(const drift of ['none','config','skill','project','instructions','forged','missing','provider','task','during-refresh','refresh-provider']){
  if(mode==='cached'&&['during-refresh','refresh-provider'].includes(drift))continue;
  const role=kind==='card:merge'?'coordinator':kind.startsWith('judge:')?'reviewer':'worker',ref=`pack:firstmate/skills/${role==='coordinator'?'firstmate':role}.md`,flow={id:'code-firstmate',name:'Queued staffing',kind:'code',version:1,roles:[{id:role,label:role,skill:ref}],nodes:[{id:'hold',kind:'hook',do:'hold',label:'Hold source owner',x:1,y:1}],edges:[]};
  const h=await harness([Y(flow)],{policies:'queue:\n  global_capacity: 1\n  project_capacity: 1\n'}),e=h.engine,store=new StaffingStore(h.data),project={namespace:'git' as const,id:'p',identity:'source-authorized-project'};let releaseOwner=()=>{},x:any,validProject=true,starts=0,refreshes=0;
  try{
   installStaffingGuard(e,store,()=>{if(!validProject)throw new Error('source project grant revoked');return project;});const def=e.defs.get(flow.id)!,draft={schema:1 as const,algorithm:'sha256-canonical-v1' as const,project,workflow:{id:def.id,version:1,sha256:staffingHash(def)},roles:{[role]:{provider:'codex' as const,model:'selected-model',effort:'high',skill:store.remember({ref,version:1,text:e.deps.skillText(ref)})}},review:{freshContexts:3,distinctProviders:false}},config=store.approve(draft,null,{run:'source',card:'captain',answerSeq:1});
   e.actions.hold=async owner=>{x=owner;await new Promise<void>(r=>releaseOwner=r);return'ok';};const run=e.start({workflow:flow.id,params:{project:'p',_staffing:config.hash}});await until(()=>!!x);
   const payloads:string[]=[],provider:any={id:'codex',model:'selected-model',reasoningEffort:'high',sandboxFree:true,start(system:string){starts++;payloads.push(system);return{interrupt(){},async *send(){yield{type:'turnEnd',status:'ok'}}}}},certified=new WeakMap<object,any>();certified.set(provider,{input:{},expires:mode==='cached'?Date.now()+30000:0,x});
   const system=e.instructions(run,role,[]),rules=new OperatingRules(h.data).section('p'),admissionReceipt=e.deps.instructionReceipt(x,role,jobInstructions(system,rules),provider);
   h.agents.providerAdmission=createNativeProviderAdmission({certified,engine:()=>e,select:async()=>{refreshes++;if(drift==='during-refresh')validProject=false;return{...provider,...drift==='refresh-provider'?{reasoningEffort:'low'}:{}};},pick:async()=>{throw new Error('unexpected uncertified selection');}});
   const unblock=await h.agents.queue.acquire({key:'blocker',task:'other-task',project:'other-project',deadline:Date.now()+10000,limits:()=>({global:1,project:1}),ready:()=>({ready:true}),waiting(){},admitted(){}});
   const pending=h.agents.run({kind,title:'Strict queued staffing fixture',system:drift==='instructions'?system+' unauthorized changed instructions':system,text:'Offline only',tools:[],provider,rules,ref:drift==='task'?'unrelated-task':run.id,admissionReceipt:drift==='forged'?{}:drift==='missing'?undefined:admissionReceipt,owns:()=>e.owns(x)}as any).then(job=>({job}),error=>({error}));
   await until(()=>h.agents.queue.snapshot().pending.length===1);ok(starts===0,`${kind}/${mode}/${drift}: queue blocks provider.start`);
   if(drift==='config')store.approve(draft,config.hash,{run:'source',card:'captain-new',answerSeq:2});if(drift==='skill')e.deps.skillText=()=> 'Changed native skill';if(drift==='project')validProject=false;if(drift==='provider')provider.model='wrong-model';
   unblock();const result=await pending;
   if(drift==='none')ok(starts===1&&'job'in result&&result.job.status==='done'&&payloads[0]===jobInstructions(system,rules),`${kind}/${mode}: unchanged authority reaches actual start payload`);else ok(starts===0&&'error'in result,`${kind}/${mode}/${drift}: drift after queue produces zero provider.start`);
   if(mode==='refreshed'&&(drift==='none'||drift==='during-refresh'))ok(refreshes===1,`${kind}/${drift}: actual expired certificate refresh path exercised`);
   releaseOwner();await until(()=>run.status==='succeeded');
  }finally{releaseOwner();for(const run of e.list())if(!['succeeded','failed','cancelled'].includes(run.status))await e.cancel(run.id,'cleanup');h.stop();rmSync(h.data,{recursive:true,force:true});}
 }
 console.log(`staffing post-queue admission total: ${n} passed`);
}

// Workflow upgrades start a separate signed conversation, preserving prior answers.
{
 const data=mkdtempSync(join(tmpdir(),'staffing-interview-upgrade-')),store=new StaffingStore(data),project={namespace:'git' as const,id:'p',identity:'interview-upgrade'},v1={id:'code-firstmate',version:1,sha256:staffingHash({v:1})},v2={...v1,version:2,sha256:staffingHash({v:2})};
 try{
  const old=store.interview(project,v1,['worker']);old.choices.worker={provider:'codex'};old.round=2;old.lastTurn='captain-v1';store.saveInterview(old,1);
  const upgraded=store.interview(project,v2,['worker']);ok(upgraded.round===1&&Object.keys(upgraded.choices).length===0,'workflow v2 receives a fresh provider frontier after saved v1 discussion');
  upgraded.choices.worker={provider:'claude'};upgraded.round=2;upgraded.lastTurn='captain-v2';store.saveInterview(upgraded,1);
  ok(store.interview(project,v1,['worker']).choices.worker.provider==='codex','v1 signed discussion remains intact after v2 answer');
  ok(store.interview(project,v2,['worker']).choices.worker.provider==='claude','v2 discussion persists independently');
  const {mkdirSync}=await import('node:fs');const dir=join(data,'projects',store.key(project),'staffing'),legacyBody=JSON.stringify({body:old,signature:(await import('node:crypto')).createHmac('sha256',(await import('../src/runtime/checks')).ledgerKey(data)).update(staffingHash(old)).digest('hex')});writeFileSync(join(dir,'interview.json'),legacyBody);writeFileSync(join(dir,'interview-v2.json'),legacyBody);rmSync(join(dir,'interviews',staffingHash(v1)),{recursive:true,force:true});
  ok(store.interview(project,v1,['worker']).choices.worker.provider==='codex','existing signed legacy discussion remains readable');
  const legacyNext=store.interview(project,v1,['worker']);legacyNext.round++;legacyNext.lastTurn='new-captain';store.saveInterview(legacyNext,2);ok(readFileSync(join(dir,'interview.json'),'utf8')===legacyBody&&readFileSync(join(dir,'interview-v2.json'),'utf8')===legacyBody,'continuing legacy discussion preserves original signed pointer and history bytes');
  const changed={...v2,sha256:staffingHash({v:2,changed:true})};ok(store.interview(project,changed,['worker']).round===1,'same workflow version with changed definition gets fresh discussion');
 }finally{rmSync(data,{recursive:true,force:true})}
 console.log(`staffing workflow upgrade total: ${n} passed`);
}
