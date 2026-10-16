import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Standalone interview contract: native engine and temporary data, with stub agents.
// No check authoring, publication, browser, or real-model coverage is claimed.
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkflowDefs,NODE_KINDS} from '../src/runtime/defs';
import {suite,harness,until} from './rt-harness';
import {hashInput} from '../src/runtime/checks';
import {ArtifactStore} from '../src/artifacts';
const {ok,end}=suite('pack-genesis-interview');
const interviewNote=(e:any,c:any,answers:any)=>{const form=e.cards.view?.(c)?.interview;return JSON.stringify(form?{schema:1,card:c.id,visit:c.visit,batchHash:form.batchHash,answers}:answers);};
const baseInput:any={run:'R-001',node:'check',round:1,artifact:{type:'web',content:'good'},params:{limit:1},previous:null,spec:null,out:'/out',workdir:'/work'};
ok(hashInput(baseInput)!==hashInput({...baseInput,artifact:{type:'web',content:'bad'}}),'nested artifact content changes the standard input hash');
ok(hashInput(baseInput)!==hashInput({...baseInput,params:{limit:2}}),'nested check parameters change the standard input hash');
ok(hashInput(baseInput)===hashInput({...baseInput,artifact:{content:'good',type:'web'},params:{limit:1},run:'R-002',out:'/other'}),'key order and execution output identity do not change semantic input hashes');
ok(hashInput({...baseInput,artifact:{a:[1,2],b:null,c:undefined}})===hashInput({...baseInput,artifact:{b:null,a:[1,2]}})&&hashInput({...baseInput,artifact:{a:[1,2]}})!==hashInput({...baseInput,artifact:{a:[2,1]}}),'canonical hashing preserves JSON null/undefined and array order semantics');
const data=mkdtempSync(join(tmpdir(),'crew-pack-genesis-'));
const defs=new WorkflowDefs(data),flow=defs.get('pack-genesis');
ok(!!flow,'describe starts a bundled native pack-genesis workflow rather than a detached legacy draft');
if(flow){
 ok(flow.nodes.every(n=>NODE_KINDS.includes(n.kind)),'genesis uses only the five native node kinds');
 ok(['interview','samples','draft','refine'].every(id=>flow.nodes.some(n=>n.id===id&&n.kind==='agent')),'interview samples draft and refinement are real native agent Rounds');
 ok(flow.nodes.some(n=>n.id==='measure'&&n.kind==='check'),'check-the-checks is an actual native check Round');
 ok(['label','promote','publish-decision'].every(id=>flow.nodes.some(n=>n.id===id&&n.kind==='card')),'label promotion and publication wait for real captain card Rounds');
}
if(flow){
 const H=await harness([readFileSync(join(import.meta.dir,'../workflows/v2/pack-genesis.wf.yaml'),'utf8')]);
 try{
  const {installPackGenesis}=await import('../src/pack-genesis'),{createRuntime}=await import('../src/runtime/index'),{installCode}=await import('../src/domain/code');const artifacts=new ArtifactStore(H.data);let pg:any,pgApi:any;
  const initial=H.engine.deps;const runtime=createRuntime({dataDir:H.data,agents:H.agents,provider:initial.provider,defaultProvider:initial.defaultProvider,log:initial.log,send:initial.send,fmRoot:join(import.meta.dir,'..'),protectedRoots:[join(import.meta.dir,'..')],store:artifacts,m3:{store:artifacts,runs:{},lane:{}},fileorg:{},docs:{},studioUrl:()=>H.toolUrl,install:[(engine,c)=>{installCode(engine,{dataDir:c.dataDir,projects:c.projects});pgApi=installPackGenesis(engine,{dataDir:c.dataDir,artifacts});pg=pgApi.pg;}]});H.engine=runtime.engine;
  const r=pg.start('STUB_PG_THRESHOLD_REFINE Create a workflow to produce and review accessible HTML pages','page-quality');
  const current=async(node:string)=>{if(!await until(()=>H.engine.cards.list({run:r.id,open:true}).some(c=>c.node===node)))throw new Error(`Did not reach ${node}: ${JSON.stringify(H.engine.get(r.id))}`);return H.engine.cards.list({run:r.id,open:true}).find(c=>c.node===node)!;};
  const answer=async(node:string,choice:string,note?:string)=>{const c=await current(node);if(node==='interview-answers'&&note){try{note=interviewNote(H.engine,c,JSON.parse(note));}catch{}}return H.engine.answer(c.id,{choice,note,by:'captain'});};
  await current('interview-answers');ok(pg.get(r.id).questions.length===6&&H.engine.get(r.id)!.steps.some(s=>s.node==='interview'&&!!s.job),'real coordinator agent asked all six interview categories in one batch');
  const rawInterview=await current('interview-answers'),viewInterview=typeof H.engine.cards.view==='function'?H.engine.cards.view(rawInterview):rawInterview;ok(viewInterview.interview?.questions?.length===6&&viewInterview.interview?.batchHash?.length===64,'every serialized interview card carries its actual source-owned six-field form');
  if(viewInterview.interview){const descriptor=viewInterview.interview,draft={schema:1,card:rawInterview.id,visit:rawInterview.visit,batchHash:descriptor.batchHash,revision:0,answers:{inputs:'Persist this first answer'}};const request=()=>new Request('http://fixture/api/pack-genesis/'+r.id+'/interview-draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(draft)});for(const [label,changed]of [['visit',{visit:rawInterview.visit+1}],['hash',{batchHash:'0'.repeat(64)}],['oversize',{answers:{inputs:'x'.repeat(501)}}],['unknown field',{answers:{unknown:'No'}}]]as any){const body={...draft,...changed},req=new Request(request().url,{method:'POST',body:JSON.stringify(body)});const denied=await pgApi.handle(req,new URL(req.url),{kind:'desktop'},true);ok(denied.status===409,'draft refuses '+label+' without consuming or changing the batch');}const phone=await pgApi.handle(request(),new URL(request().url),{kind:'phone'},true);ok(phone.status===403,'draft keeps the existing Mac-only mutation boundary');const originalQuestions=pg.get(r.id).questions,altered=pg.get(r.id);altered.questions=altered.questions.map((q:any,i:number)=>i? q:{...q,en:q.en+' changed'});pg.save(altered);ok(!H.engine.cards.view(rawInterview).interview,'changed question bytes invalidate signed batch metadata');const restoredQuestions=pg.get(r.id);restoredQuestions.questions=originalQuestions;pg.save(restoredQuestions);const saved=await pgApi.handle(request(),new URL(request().url),{kind:'desktop'},true);ok(saved.status===200&&((await saved.json())as any).answers.inputs===draft.answers.inputs,'authenticated partial draft persists without consuming the interview card');const stale=await pgApi.handle(request(),new URL(request().url),{kind:'desktop'},true);ok(stale.status===409,'stale interview draft revision cannot overwrite a newer save');const file=join(H.data,'cards',rawInterview.id+'.json'),before=readFileSync(file,'utf8'),legacy=JSON.parse(before);delete legacy.interview;writeFileSync(file,JSON.stringify(legacy));const hydrated=H.engine.cards.view(H.engine.cards.get(rawInterview.id)!);ok(hydrated.interview?.batchHash===descriptor.batchHash&&hydrated.interview.answers.inputs===draft.answers.inputs&&readFileSync(file,'utf8')===JSON.stringify(legacy),'existing untyped live card hydrates saved answers without rewriting its historical file');const wrong={...draft,revision:1,batchHash:'0'.repeat(64)};let bad=false;try{await H.engine.answer(rawInterview.id,{choice:'continue',note:JSON.stringify({...wrong,answers:Object.fromEntries(pg.get(r.id).questions.map((q:any)=>[q.key,'Answered']))}),by:'captain'});}catch{bad=true;}ok(bad&&H.engine.cards.get(rawInterview.id)?.status==='open','stale submitted batch cannot consume the current captain card');}
  const completeAnswers={inputs:'HTML requests',outputs:'A local page',tools:'Studio',quality:'Labelled buttons',dealbreakers:'Empty button labels',signoff:'Captain'};
  const form=H.engine.cards.view(rawInterview).interview;
  const envelope={schema:1,card:rawInterview.id,visit:rawInterview.visit,batchHash:form.batchHash,answers:completeAnswers};
  const invalidSubmissions:[string,unknown][]=[
   ['missing answer',{...envelope,answers:{...completeAnswers,signoff:undefined}}],
   ['whitespace answer',{...envelope,answers:{...completeAnswers,signoff:' \n\t'}}],
   ['non-string answer',{...envelope,answers:{...completeAnswers,signoff:42}}],
   ['array answers',{...envelope,answers:Object.values(completeAnswers)}],
   ['unknown answer key',{...envelope,answers:{...completeAnswers,unknown:'extra'}}],
   ['oversized answer',{...envelope,answers:{...completeAnswers,inputs:'x'.repeat(501)}}],
   ['stale card',{...envelope,card:rawInterview.id+'-old'}],
   ['stale visit',{...envelope,visit:rawInterview.visit+1}],
   ['stale batch',{...envelope,batchHash:'0'.repeat(64)}],
   ['legacy bare answers',completeAnswers],
  ];
  const cardFile=join(H.data,'cards',rawInterview.id+'.json'),priorCardBytes=readFileSync(cardFile,'utf8'),priorDraft=JSON.stringify(pg.get(r.id).interviewDraft);
  for(const [label,submission]of invalidSubmissions){
   let denied=false;try{await H.engine.answer(rawInterview.id,{choice:'continue',note:JSON.stringify(submission),by:'captain'});}catch{denied=true;}
   ok(denied&&H.engine.cards.get(rawInterview.id)?.status==='open',label+' is rejected with the original interview card still open');
   ok(readFileSync(cardFile,'utf8')===priorCardBytes&&JSON.stringify(pg.get(r.id).interviewDraft)===priorDraft,label+' cannot rewrite the historical card or erase the saved partial answer');
  }
  let refused=false;try{await answer('interview-answers','continue','only one answer');}catch{refused=true;}ok(refused&&H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='interview-answers'),'incomplete interview refuses without consuming the captain card');
  const savedPartial=pg.get(r.id).interviewDraft;
  const completedDraft={...savedPartial,answers:{...savedPartial.answers,...completeAnswers,inputs:savedPartial.answers.inputs}};
  const draftRequest=new Request('http://fixture/api/pack-genesis/'+r.id+'/interview-draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(completedDraft)});
  const completedReply=await pgApi.handle(draftRequest,new URL(draftRequest.url),{kind:'desktop'},true);
  ok(completedReply.status===200&&JSON.stringify(pg.get(r.id).interviewDraft.answers)===JSON.stringify(completedDraft.answers)&&H.engine.cards.get(rawInterview.id)?.status==='open','completing the five missing draft fields preserves the first answer and does not submit the card');
  await answer('interview-answers','continue',JSON.stringify(completedDraft.answers));
  const answered=H.engine.cards.get(rawInterview.id)!;
  ok(answered.status==='answered'&&JSON.stringify(JSON.parse(answered.answer!.note!).answers)===JSON.stringify(completedDraft.answers),'one accepted current batch persists all six answers on the original captain card');
 }catch(e){ok(false,'interview contract',String((e as any).stack??e));}
 finally{
  for(const task of H.engine.list())if(!['succeeded','failed','cancelled'].includes(task.status))await H.engine.cancel(task.id);
  H.stop();
 }
}
end();
