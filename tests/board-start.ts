import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The board's Start form path (POST /api/wruns) for workflows that need more than a provider:
// code-firstmate on a registered project with its approved crew, and the held GitHub review template.
// Offline: the real runtime routes, staffing store and guard, with a fixture provider in place of a vendor CLI.
import {writeFileSync,rmSync} from 'node:fs';
import {checkedTempDir,assertTempRepo,scrubGitEnv} from './lib/git-hygiene.mjs'; // repositories only in checked temp folders
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {harness,until,suite} from './rt-harness';
import {createRuntime} from '../src/runtime/index';
import {installCode} from '../src/domain/code';
import {StaffingStore,staffingHash} from '../src/domain/staffing';
const {ok,end}=suite('board-start');
// every repository here is built in a checked temporary folder, never with an inherited GIT_DIR or config
const git=(cwd:string,args:string[])=>{assertTempRepo(cwd,'board-start fixture repository');const env={...process.env};scrubGitEnv(env);const r=spawnSync('git',args,{cwd,env,encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);return r.stdout.trim();};
const root=join(import.meta.dir,'..'),repoHome=process.env.BOARD_START_FIXTURE_REPOS?assertTempRepo(process.env.BOARD_START_FIXTURE_REPOS,'board-start fixture repositories'):checkedTempDir('board-start-repo-'),repo=join(repoHome,'repo'),other=join(repoHome,'other');
const claudeRepo=join(repoHome,'claude');
for(const dir of [repo,other,claudeRepo]){spawnSync('mkdir',['-p',dir]);assertTempRepo(dir);git(dir,['init','-q','-b','main']);writeFileSync(join(dir,'README.md'),'fixture\n');git(dir,['add','README.md']);git(dir,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Initial']);}
// BOARD_START_FIXTURE_DATA: prepare a Studio data folder for tests/board-start-ui.mjs and stop: four registered projects
// (a ready Codex crew, a signed-in but unverified Claude crew, no crew, a crew approved for another definition).
if(process.env.BOARD_START_FIXTURE_DATA){
 const data=process.env.BOARD_START_FIXTURE_DATA,{WorkflowDefs}=await import('../src/runtime/defs'),{Projects}=await import('../src/doors'),{skillTextFor}=await import('../src/runtime/index');
 const defs=new WorkflowDefs(data),list=new Projects(data),store=new StaffingStore(data),def=defs.get('code-firstmate')!,skill=skillTextFor(root),stale=join(repoHome,'stale');
 spawnSync('mkdir',['-p',stale]);assertTempRepo(stale);git(stale,['init','-q','-b','main']);writeFileSync(join(stale,'README.md'),'fixture\n');git(stale,['add','README.md']);git(stale,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Initial']);
 list.add({id:'fixture',name:'Fixture repo',path:repo,base:'main'} as any);list.add({id:'unstaffed',name:'Unstaffed repo',path:other,base:'main'} as any);list.add({id:'stale',name:'Stale crew repo',path:stale,base:'main'} as any);
 const approve=(id:string,sha256:string)=>store.approve({schema:1,algorithm:'sha256-canonical-v1',project:list.staffingIdentity(id,[root]),workflow:{id:def.id,version:def.version,sha256},roles:Object.fromEntries(def.roles.map((r:any)=>[r.id,{provider:'claude' as const,model:'claude-sonnet-5-5',effort:'low',skill:store.remember({ref:r.skill,version:1,text:skill(r.skill)})}])),review:{freshContexts:3,distinctProviders:false}},null,{run:'R-staffing',card:'SC-staffing',answerSeq:1});
 approve('fixture',staffingHash(def));approve('stale',staffingHash({...def,description:'an older definition'}));
 const codexRepo=join(repoHome,'codex');spawnSync('mkdir',['-p',codexRepo]);assertTempRepo(codexRepo);git(codexRepo,['init','-q','-b','main']);writeFileSync(join(codexRepo,'README.md'),'fixture\n');git(codexRepo,['add','README.md']);git(codexRepo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Initial']);
 list.add({id:'codex',name:'Codex crew repo',path:codexRepo,base:'main'} as any);
 store.approve({schema:1,algorithm:'sha256-canonical-v1',project:list.staffingIdentity('codex',[root]),workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles:Object.fromEntries(def.roles.map((r:any)=>[r.id,{provider:'codex' as const,model:'fixture-model',effort:'low',skill:store.remember({ref:r.skill,version:1,text:skill(r.skill)})}])),review:{freshContexts:3,distinctProviders:false}},null,{run:'R-staffing',card:'SC-staffing',answerSeq:1});
 console.log('board-start fixture ready');process.exit(0);
}
const H=await harness([]);
let codexAuth='verified',factsCalls=0;
const facts=async()=>{factsCalls++;return[{provider:'codex',support:'supported' as const,auth:codexAuth,quota:'available',expires:Date.now()+60000,models:[{id:'fixture-model',efforts:['low']}]},{provider:'claude',support:'supported' as const,auth:'verified',quota:'unknown',expires:Date.now()+60000,models:[]}];};
let projects:any;
const rt=createRuntime({dataDir:H.data,agents:H.agents,provider:H.engine.deps.provider,defaultProvider:()=>({provider:'claude',model:'studio-default'}),log:H.engine.deps.log,send(){},fmRoot:root,protectedRoots:[root],studioUrl:()=>H.toolUrl,staffingFacts:facts,
 install:[(engine:any,c:any)=>{projects=c.projects;installCode(engine,{dataDir:c.dataDir,projects:c.projects});}]} as any);
const E=rt.engine;
// a provider that answers the spec round the way a coordinator does, and records who it ran as
const launched:any[]=[];
E.deps.provider=((id:string,model?:string)=>({id,model,reasoningEffort:'low',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(){
 launched.push({id,model,tools:tools.map(t=>t.name)});
 if(tools.some(t=>t.name==='spec_write')){const v:any=await H.agents.callTool(ctx.token,'spec_write',{title:'Board start',what:'Add one line to the README',why:['Prove a board start reaches spec'],done:['tests/board-start.ts passes'],scope:['README.md'],door:{kind:'two-way',reason:'Local fixture'},explain:{en:'Add one README line','zh-TW':'新增一行 README'},zh:{title:'看板啟動',why:['證明看板啟動能到達規格']}});if(v?.error)throw new Error(v.error);}
 yield{type:'turnEnd',status:'ok'};}}}})) as any;
const call=async(path:string,body?:unknown,who='desktop')=>{const url=new URL('http://fixture'+path),r=await rt.handle(new Request(url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),url,{kind:who} as any,body!==undefined);return{status:r!.status,body:await r!.json() as any};};
try{
 projects.add({id:'fixture',name:'Fixture repo',path:repo,base:'main'});projects.add({id:'unstaffed',name:'Unstaffed repo',path:other,base:'main'});
 // approve the crew for "fixture" exactly as the staffing card does: every role, the exact skill text, the current definition
 const def=E.defs.get('code-firstmate')!,store=new StaffingStore(H.data),identity=projects.staffingIdentity('fixture',[root]);
 const roles=Object.fromEntries(def.roles.map((r:any)=>[r.id,{provider:'codex' as const,model:'fixture-model',effort:'low',skill:store.remember({ref:r.skill,version:1,text:E.deps.skillText(r.skill)})}]));
 const approved=store.approve({schema:1,algorithm:'sha256-canonical-v1',project:identity,workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles,review:{freshContexts:3,distinctProviders:false}},null,{run:'R-staffing',card:'SC-staffing',answerSeq:1});

 // the Start form's view of the workflow: registered projects and each one's crew state
 const options=await call('/api/wruns/start-options?workflow=code-firstmate');
 const byId=Object.fromEntries((options.body.projects??[]).map((p:any)=>[p.id,p]));
 ok(options.status===200&&options.body.projectScoped===true&&options.body.staffing===true&&options.body.crewHref==='#/team','start options mark code-firstmate as project-scoped and staffed',JSON.stringify(options.body));
 ok(byId.fixture?.staffing?.state==='approved'&&byId.fixture.staffing.hash===approved.hash&&byId.fixture.staffing.roles.worker.model==='fixture-model','an approved project shows its approved crew');
 ok(byId.unstaffed?.staffing?.state==='missing'&&byId.unstaffed.staffing.code==='staffing_missing','a project without a crew shows missing');

 ok(factsCalls>=1&&byId.fixture.staffing.readiness?.state==='ready','start options refresh the free capability probes and show a ready crew');
 codexAuth='missing';const down=(await call('/api/wruns/start-options?workflow=code-firstmate')).body.projects.find((p:any)=>p.id==='fixture');
 ok(down?.staffing?.state==='blocked'&&down.staffing.code==='staffing_not_ready'&&!!down.staffing.role,'an approved crew whose vendor is unavailable now shows cannot start with the role',JSON.stringify(down?.staffing));
 codexAuth='verified';
 projects.add({id:'claude-crew',name:'Claude crew repo',path:claudeRepo,base:'main'});
 store.approve({schema:1,algorithm:'sha256-canonical-v1',project:projects.staffingIdentity('claude-crew',[root]),workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles:Object.fromEntries(def.roles.map((r:any)=>[r.id,{provider:'claude' as const,model:'claude-sonnet-5-5',effort:'low',skill:store.remember({ref:r.skill,version:1,text:E.deps.skillText(r.skill)})}])),review:{freshContexts:3,distinctProviders:false}},null,{run:'R-staffing',card:'SC-staffing',answerSeq:2});
 const claudeCrew=(await call('/api/wruns/start-options?workflow=code-firstmate')).body.projects.find((p:any)=>p.id==='claude-crew');
 ok(claudeCrew?.staffing?.state==='blocked'&&claudeCrew.staffing.code==='staffing_not_ready'&&/signed in but not verified by a bounded request/.test(claudeCrew.staffing.reason?.en??''),'a signed-in but unverified Claude crew cannot start: the form never pays for a verification',JSON.stringify(claudeCrew?.staffing));
 {const runs=E.list().length,r=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{project:'claude-crew'}});
  ok(r.status===409&&r.body.code==='staffing_not_ready'&&E.list().length===runs,'starting the unverified Claude crew anyway is a typed refusal and creates no Task',JSON.stringify(r.body).slice(0,300));}

 const before=E.list().length;
 const noProject=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{provider:'codex'}});
 ok(noProject.status===400&&noProject.body.code==='project_required'&&E.list().length===before,'a board start without a project is a typed refusal and creates no Task');
 const rawRepo=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{project:'fixture',repo}});
 ok(rawRepo.status===400&&rawRepo.body.code==='project_required'&&E.list().length===before,'a raw repository path cannot ride along with approved staffing');
 const missing=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{project:'unstaffed'}});
 ok(missing.status===409&&missing.body.code==='staffing_missing'&&missing.body.staffing?.state==='missing'&&E.list().length===before,'a project without an approved crew is refused before any Task');
 const unknown=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{project:'nobody'}});
 ok(unknown.status===409&&unknown.body.code==='project_unavailable'&&E.list().length===before,'an unregistered project cannot start');
 const forged=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{project:'unstaffed',_staffing:approved.hash}});
 ok(forged.status===409&&E.list().length===before,'another project\'s approval hash in the body never bypasses the guard');

 {const runs=E.list().length,r=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{project:'fixture'},staffingExpected:'0'.repeat(64)});
  ok(r.status===409&&r.body.code==='staffing_changed'&&E.list().length===runs,'a crew approved again since the form loaded is reviewed again, not started blind',JSON.stringify(r.body).slice(0,300));}
 // the real thing: approved crew, registered project, board body → the Task reaches spec on the approved role
 const started=await call('/api/wruns',{workflow:'code-firstmate',text:'Add one README line',params:{project:'fixture'},staffingExpected:approved.hash});
 ok(started.status===200&&!!started.body.id,'a board start of code-firstmate with an approved crew is accepted',JSON.stringify(started.body).slice(0,400));
 const id=started.body.id;
 if(id){
 const reached=await until(()=>(E.get(id)?.nodes.spec?.visits??0)>=1&&E.trusted(id).entries.some((e:any)=>e.record==='staffing-instructions'&&e.node==='spec'),20000);
 const ledger=E.trusted(id).entries,binding=ledger.find((e:any)=>e.record==='staffing-start'),instructions=ledger.find((e:any)=>e.record==='staffing-instructions'&&e.node==='spec');
 ok(reached&&binding?.data.config===approved.hash,'the Task reaches spec bound to the approved crew in its signed ledger',JSON.stringify({status:E.get(id)?.status,error:E.get(id)?.error,nodes:Object.fromEntries(Object.entries(E.get(id)?.nodes??{}).filter(([,n]:any)=>n.visits).map(([k,n]:any)=>[k,n.state]))}));
 ok(instructions?.data.provider==='codex'&&instructions.data.model==='fixture-model'&&instructions.data.effort==='low'&&launched.some(l=>l.id==='codex'&&l.model==='fixture-model'),'the spec round runs as the approved coordinator, not the Studio default');
 ok(E.get(id)!.params.base==='main'&&E.get(id)!.params.project==='fixture'&&!E.get(id)!.params.repo,'the Task takes its base from the registered project');
 await until(()=>E.cards.list({run:id,open:true}).some(c=>c.node==='dispatch'),8000);
 }

 // the GitHub review template: kept and editable, never offered for a new Task
 const wf=await call('/api/wf');
 ok(!wf.body.workflows.some((w:any)=>w.id==='github-review'),'the Start form list does not offer github-review');
 const held=wf.body.held?.find((w:any)=>w.id==='github-review');
 ok(held?.held?.en==='held: GitHub review does not run end to end until it is rebuilt from code-firstmate'&&!!held.held.zh,'the workflow catalog lists github-review as held with its reason');
 const detail=await call('/api/wf/github-review');
 ok(detail.status===200&&detail.body.selectable===false&&detail.body.held?.en==='held: GitHub review does not run end to end until it is rebuilt from code-firstmate','the editor keeps github-review readable with its held reason');
 const runs=E.list().length,refused=await call('/api/wruns',{workflow:'github-review',text:'Review a pull request',params:{project:'fixture'}});
 ok(refused.status===409&&refused.body.code==='workflow_held'&&refused.body.error.includes('does not run end to end')&&E.list().length===runs,'a board start of github-review is a typed held refusal, not a template error');
 const heldOptions=await call('/api/wruns/start-options?workflow=github-review');
 ok(heldOptions.status===409,'start options are not offered for a held workflow');
 const tool:any=await rt.firstmate.call('studio_list_workflows',{},{key:'board-start',captain:true,text:'list',live:()=>true});
 ok(!tool.workflows.some((w:any)=>w.id==='github-review'),'Firstmate does not offer the held workflow either');
 ok(!!E.defs.get('github-review'),'the github-review definition is kept');
}catch(e){ok(false,'board start',String((e as any)?.stack??e));}
finally{for(const r of E.list())if(!['succeeded','cancelled','failed'].includes(r.status)){try{await E.cancel(r.id);}catch{}}H.stop();rmSync(repoHome,{recursive:true,force:true});}
end();
