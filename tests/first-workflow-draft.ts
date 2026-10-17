import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Free first-workflow drafting: actual server + owned offline Codex app-server fixture as the model.
// The fixture "model" answers the captain's interview message by calling studio_draft_workflow with
// tests/fixture/first-workflow-draft.json. No vendor call, no Task, no staffing record until Run.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {freePort,waitUp} from './boot.mjs';
let pass=0,fail=0;const ok=(v:any,name:string,detail='')=>{console.log(`${v?'  ok   ':'  FAIL '} ${name}${v?'':' '+detail}`);v?pass++:fail++;};
const root=mkdtempSync(join(tmpdir(),'crew-first-draft-')),home=join(root,'home'),data=join(root,'data'),log=join(root,'rpc.jsonl'),token='first-draft-fixture-session';
mkdirSync(join(home,'.codex'),{recursive:true});mkdirSync(data);
writeFileSync(join(home,'.codex','config.toml'),'model="fixture-model"\nmodel_reasoning_effort="low"\n');writeFileSync(join(home,'.codex','.fixture-account.json'),'{"authenticated":true}');
const fixture=join(import.meta.dir,'fixture/codex-account.mjs'),draftFixture=join(import.meta.dir,'fixture/first-workflow-draft.json'),cwd=process.env.FIRST_WORKFLOW_BASE||join(import.meta.dir,'..');
const port=await freePort(),base=`http://127.0.0.1:${port}`;
const env:any={...process.env,HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_RUNTIME_DIR:join(root,'runtime'),CREW_PORT:String(port),CREW_SESSION_TOKEN:token,CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_CODEX_BIN:'/nonexistent/codex',CREW_HOST_CODEX_BIN:fixture,CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',CREW_CLAUDE_BIN:'/nonexistent/claude',ACCOUNT_FIXTURE_LOG:log,ACCOUNT_FIXTURE_DRAFT:draftFixture};
for(const key of ['CREW_MAIN_PROJECT','CREW_FM_STATE','OPENAI_API_KEY','ANTHROPIC_API_KEY','GITHUB_TOKEN','GH_TOKEN'])delete env[key];
const start=()=>{const p=spawn('bun',['src/server.ts'],{cwd,env,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);return p;};
let app=start();
const stop=async()=>{if(app.exitCode===null&&app.signalCode===null){const done=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await done;}};
const api=async(path:string,body?:any)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-crew-session':token},body:body===undefined?undefined:JSON.stringify(body)});let j:any={};try{j=await r.json();}catch{}return{status:r.status,body:j};};
const until=async(f:()=>Promise<boolean>)=>{for(let i=0;i<200;i++){if(await f())return true;await Bun.sleep(30);}return false;};
const rows=()=>{try{return readFileSync(log,'utf8').split('\n').filter(Boolean).map(r=>JSON.parse(r));}catch{return[];}};
const results=()=>rows().filter(r=>r.toolResult);
const send=async(text:string)=>{const before=results().length;await api('/api/main/send',{text});const done=await until(async()=>results().length>before&&!(await api('/api/main')).body.busy);if(!done)throw new Error('fixture model turn did not finish');return JSON.parse(results().at(-1).toolResult.contentItems[0].text);};
const runs=async()=>(await api('/api/wruns')).body.runs??[];
const staffingFiles=()=>{const out:string[]=[];const walk=(d:string)=>{if(!existsSync(d))return;for(const f of readdirSync(d,{withFileTypes:true})){const p=join(d,f.name);if(f.isDirectory())walk(p);else if(/staffing/.test(p))out.push(p);}};walk(join(data,'projects'));return out;};
try{
 await waitUp(base,app);
 const started=await api('/api/main/start',{host:'codex',confirm:true});ok(started.status===200,'offline fixture primary starts');await until(async()=>!(await api('/api/main')).body.busy);
 const threadTools=rows().find(r=>r.method==='thread/start'&&Array.isArray(r.nativeTools))?.nativeTools??[];
 ok(threadTools.includes('studio_draft_workflow')&&threadTools.includes('studio_save_workflow_draft'),'Firstmate registers native free draft and save tools',JSON.stringify(threadTools));
 const {nativeFreshText}=await import(join(cwd,'src/host/main.ts'));const seed=nativeFreshText(join(data,'workspace'));
 ok(threadTools.length>0&&threadTools.every((t:string)=>seed.includes(t)),'W8 Firstmate seed text names every registered native tool',JSON.stringify(threadTools.filter((t:string)=>!seed.includes(t))));

 // 1. interview answered -> the model call produces a graph (fixture) -> stored as a model draft
 const drafted=await send('Help me design my own workflow. My goal: a weekly newsletter about local coffee events');
 ok(typeof drafted.draft==='string'&&drafted.source==='model','draft tool returns a model-generated draft id',JSON.stringify(drafted));
 const view=await api(`/api/wf/drafts/${drafted.draft}`);
 ok(view.status===200&&view.body.draft?.provenance?.source==='model'&&view.body.draft.def.nodes.length===5,'draft preview is readable and labeled as model output',JSON.stringify(view.body).slice(0,300));
 ok(view.body.draft?.goal==='A weekly newsletter about local coffee events'&&view.body.draft?.interview?.length===2,'draft keeps goal and interview answers');
 const list=await api('/api/wf/drafts');ok(list.body.drafts?.some((d:any)=>d.id===drafted.draft),'draft list shows the new draft');
 ok((await runs()).length===0,'drafting allocates no Task');
 ok(staffingFiles().length===0,'drafting writes no staffing configuration');
 ok(!(await api('/api/wf')).body.workflows.some((w:any)=>w.name==='Weekly coffee newsletter'),'drafting alone saves no workflow version');

 // unsafe model graphs are refused (privileged hook, outside skill, execution mode)
 const bad=JSON.parse(readFileSync(draftFixture,'utf8'));
 const variants:[string,(w:any)=>void][]=[
  ['privileged hook action',w=>{w.nodes[4].do='firstmate.launch';}],
  ['role skill outside the bundled allowlist',w=>{w.roles[0].skill='fm:skills/worker/SKILL.md';}],
  ['agent execution mode outside drafting allowlist',w=>{w.nodes[1].mode='build';}],
  ['unknown provider',w=>{w.nodes[1].provider='paid-cloud';}],
  ['graph that does not validate',w=>{w.edges=w.edges.slice(1);}],
 ];
 for(const [name,mutate] of variants){const copy=JSON.parse(JSON.stringify(bad));mutate(copy.workflow);const r=await send('NATIVE-TOOL '+JSON.stringify({name:'studio_draft_workflow',args:copy}));ok(r.code==='invalid_params'||r.code==='draft_invalid','draft tool refuses '+name,JSON.stringify(r).slice(0,200));}

 // 2. inline node config persistence on the draft
 const rev=view.body.draft.revision;
 const edit=await api(`/api/wf/drafts/${drafted.draft}/nodes/review`,{revision:rev,provider:'claude',model:'claude-fixture',effort:'high',skill:'bundled:workflows/skills/v2/designer.md'});
 ok(edit.status===200&&edit.body.draft?.revision===rev+1,'inline node edit saves a new draft revision',JSON.stringify(edit.body).slice(0,200));
 const stale=await api(`/api/wf/drafts/${drafted.draft}/nodes/review`,{revision:rev,model:'other'});ok(stale.status===409,'stale inline edit is refused');
 const badEdit=await api(`/api/wf/drafts/${drafted.draft}/nodes/review`,{revision:rev+1,skill:'fm:secret.md'});ok(badEdit.status===400,'inline edit refuses a skill outside the allowlist');
 const cardEdit=await api(`/api/wf/drafts/${drafted.draft}/nodes/topics`,{revision:rev+1,provider:'codex'});ok(cardEdit.status===400,'inline model edit only applies to agent nodes');
 await stop();app=start();await waitUp(base,app);
 const reread=(await api(`/api/wf/drafts/${drafted.draft}`)).body.draft;const reviewNode=reread?.def.nodes.find((n:any)=>n.id==='review');
 ok(reviewNode?.provider==='claude'&&reviewNode?.model==='claude-fixture'&&reviewNode?.effort==='high'&&reviewNode?.skill==='bundled:workflows/skills/v2/designer.md','inline node config survives a server restart');
 ok(reread?.provenance?.source==='model'&&reread?.provenance?.edited===true,'provenance stays model and records captain edits');

 // B1 a model revision keeps the captain's inline node choices
 const started2=await api('/api/main/start',{host:'codex',confirm:true});await until(async()=>!(await api('/api/main')).body.busy);void started2;
 const revise=JSON.parse(readFileSync(draftFixture,'utf8'));revise.draft=drafted.draft;revise.workflow.nodes[2].label='Review the draft for tone';revise.workflow.nodes[2].provider='codex';
 const revised=await send('NATIVE-TOOL '+JSON.stringify({name:'studio_draft_workflow',args:revise}));
 const afterModel=(await api(`/api/wf/drafts/${drafted.draft}`)).body.draft;const rn=afterModel?.def.nodes.find((n:any)=>n.id==='review');
 ok(revised.revision===reread.revision+1&&rn?.label==='Review the draft for tone','B1 model revision applies the model change',JSON.stringify(revised).slice(0,200));
 ok(rn?.provider==='claude'&&rn?.model==='claude-fixture'&&rn?.effort==='high'&&rn?.skill==='bundled:workflows/skills/v2/designer.md','B1 model revision keeps captain-set provider/model/effort/skill',JSON.stringify(rn));
 ok(afterModel?.provenance?.edited===true,'B1 model revision keeps edited=true');

 // W2 page save names the revision the captain saw
 const noRev=await api(`/api/wf/drafts/${drafted.draft}/save`,{});ok(noRev.status===400,'W2 page save without a revision is refused',String(noRev.status));
 const staleSave=await api(`/api/wf/drafts/${drafted.draft}/save`,{revision:reread.revision});ok(staleSave.status===409&&/reload|refresh/i.test(staleSave.body.error||''),'W2 page save of an older revision is refused with a refresh prompt',JSON.stringify(staleSave.body));
 ok(!(await api('/api/wf')).body.workflows.some((w:any)=>w.name==='Weekly coffee newsletter'),'W2 refused saves create no workflow');

 // 3. save as the captain's own workflow (no Task, no staffing)
 const saved=await api(`/api/wf/drafts/${drafted.draft}/save`,{revision:afterModel.revision});
 ok(saved.status===200&&typeof saved.body.workflow==='string','save creates the captain workflow',JSON.stringify(saved.body).slice(0,200));
 const again=await api(`/api/wf/drafts/${drafted.draft}/save`,{revision:afterModel.revision});ok(again.body.workflow===saved.body.workflow,'repeat save returns the same workflow, never a duplicate');
 const viaTool=await send('NATIVE-TOOL '+JSON.stringify({name:'studio_save_workflow_draft',args:{draft:drafted.draft}}));ok(viaTool.workflow===saved.body.workflow,'native save tool is idempotent with the page save',JSON.stringify(viaTool).slice(0,200));
 const wf=(await api(`/api/wf/${saved.body.workflow}`)).body.def;
 ok(wf?.origin?.source==='firstmate-draft'&&wf.origin.draft===drafted.draft,'saved workflow records its draft origin');
 const wfReview=wf?.nodes.find((n:any)=>n.id==='review');ok(wfReview?.model==='claude-fixture'&&wfReview?.effort==='high'&&wfReview?.skill==='bundled:workflows/skills/v2/designer.md','saved workflow keeps inline node config');
 ok((await runs()).length===0&&staffingFiles().length===0,'saving allocates no Task and no staffing');

 // editor save keeps origin and node model fields across versions
 const nodes=wf.nodes.map((n:any)=>n.id==='draft'?{...n,model:'fixture-model-2',effort:'medium'}:n);
 const v2=await api(`/api/wf/${wf.id}`,{base:wf.version,nodes,edges:wf.edges,roles:wf.roles,origin:{source:'forged'}});
 ok(v2.status===200&&v2.body.def.version===2,'editor saves inline node config as a new version',JSON.stringify(v2.body).slice(0,200));
 const wf2=(await api(`/api/wf/${wf.id}`)).body.def;ok(wf2.nodes.find((n:any)=>n.id==='draft').effort==='medium'&&wf2.origin?.source==='firstmate-draft','new version keeps node effort and immutable origin');
 const badSave=await api(`/api/wf/${wf.id}`,{base:2,nodes:wf2.nodes.map((n:any)=>n.id==='draft'?{...n,provider:'paid-cloud'}:n),edges:wf2.edges,roles:wf2.roles});ok(badSave.status>=400,'editor refuses an unknown node provider');

 // 4. no staffing until Run: the staffing confirmation only appears when Run is requested
 const incomplete=wf2.nodes.map((n:any)=>n.id==='review'?(({provider,model,effort,...rest})=>rest)(n):n);
 const v3=await api(`/api/wf/${wf.id}`,{base:2,nodes:incomplete,edges:wf2.edges,roles:wf2.roles});ok(v3.status===200,'captain may leave a node unstaffed while drafting');
 const runIncomplete=await api('/api/wruns',{workflow:wf.id,text:'This week'});
 ok(runIncomplete.status===409&&runIncomplete.body.code==='staffing_incomplete'&&runIncomplete.body.staffing?.missing?.includes('review'),'Run with an unstaffed agent node asks for staffing first',JSON.stringify(runIncomplete.body).slice(0,300));
 const v4=await api(`/api/wf/${wf.id}`,{base:3,nodes:wf2.nodes,edges:wf2.edges,roles:wf2.roles});ok(v4.status===200,'captain completes staffing inline');
 const ask=await api('/api/wruns',{workflow:wf.id,text:'This week'});
 ok(ask.status===409&&ask.body.code==='staffing_confirmation_required'&&ask.body.staffing?.plan?.length===2&&typeof ask.body.staffing.hash==='string','Run returns the staffing confirmation instead of starting',JSON.stringify(ask.body).slice(0,300));
 ok(ask.body.staffing?.plan?.find((p:any)=>p.node==='review')?.provider==='claude','confirmation lists each agent node provider/model/effort');
 const forged=await api('/api/wruns',{workflow:wf.id,text:'This week',params:{_ownStaffing:ask.body.staffing.hash}});ok(forged.status===409,'a client param cannot stand in for the confirmation');
 const wrong=await api('/api/wruns',{workflow:wf.id,text:'This week',staffingConfirm:'0'.repeat(64)});ok(wrong.status===409,'a stale or wrong confirmation is refused');
 const unverified=await api('/api/wruns',{workflow:wf.id,text:'This week',staffingConfirm:ask.body.staffing.hash});ok(unverified.status===409&&unverified.body.code==='staffing_confirmation_required','the staffing hash alone does not authorize the Claude node verification');
 ok((await runs()).length===0,'no Task exists before the captain confirms staffing');
 // a Claude-staffed node also needs the captain's bounded Claude verification echoed back at Run (4efabd8)
 const go=await api('/api/wruns',{workflow:wf.id,text:'This week',staffingConfirm:ask.body.staffing.hash,claudeVerification:ask.body.staffing.claudeVerification});
 ok(go.status===200&&typeof go.body.id==='string','confirmed staffing starts exactly one Task',JSON.stringify(go.body).slice(0,200));
 ok((await runs()).length===1,'one Task after confirmation');
 const task=go.body.id?(await api(`/api/wruns/${go.body.id}`)).body:null;
 ok(task?.text?.includes('A weekly newsletter about local coffee events')&&task?.text?.includes('Regulars who visit on weekends'),'W1 the Task brief carries the captain goal and interview answers',String(task?.text).slice(0,300));
 if(go.body.id)await api(`/api/wruns/${go.body.id}/cancel`,{});
 // B3 any saved node effort is validated, bundled workflows included
 const docs=(await api('/api/wf/documents')).body.def;const badEffort=await api('/api/wf/documents',{base:docs.version,nodes:docs.nodes.map((n:any)=>n.kind==='agent'?{...n,effort:'turbo'}:n),edges:docs.edges,roles:docs.roles});ok(badEffort.status===400,'B3 an unknown node effort is refused on a bundled workflow',String(badEffort.status));
 // the free starter has no agent node: nothing to staff, so Run starts without a confirmation
 const starter=await api('/api/wf',{id:'my-starter-check',name:'Starter check',origin:'starter'});ok(starter.status===201&&starter.body.def.origin?.source==='starter','free starter records its origin');
 const forgedOrigin=await api('/api/wf',{id:'my-forged-origin',name:'Forged',origin:'firstmate-draft'});ok(forgedOrigin.status>=400,'a page cannot claim a Firstmate draft origin');
 const starterRun=await api('/api/wruns',{workflow:'my-starter-check',text:'Go'});ok(starterRun.status===200,'card-only own workflow needs no staffing confirmation');if(starterRun.body.id)await api(`/api/wruns/${starterRun.body.id}/cancel`,{});
}catch(e){fail++;console.log('  FAIL  exception',(e as any)?.stack??e);}
finally{await stop();rmSync(root,{recursive:true,force:true});}
console.log(`first-workflow-draft: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
