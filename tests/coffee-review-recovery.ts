// Offline fixture: real signed workflow/receipts, local media bytes, no visual-quality claim.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until} from './rt-harness';
import {bundledText} from '../src/bundled';
import {ArtifactStore} from '../src/artifacts';
import {installCoffeeKit} from '../src/domain/coffee-kit';
import {StaffingStore,coffeeStaffingProject,staffingHash,installStaffingGuard} from '../src/domain/staffing';
import {skillTextFor} from '../src/runtime';
process.env.CREW_TEST_IN_PROCESS='1';
const H=await harness([bundledText('workflows/v2/coffee-kit.wf.yaml')!]);
const png=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=16x16','-frames:v','1','-vcodec','png','-f','image2pipe','pipe:1']);
const film=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=160x90:r=1:d=12','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
let pages=0,images=0,videos=0,judges=0,fail=true,snapshots:any[]=[];
H.engine.deps.skillText=skillTextFor(join(H.data,'protected'));
const staffing=new StaffingStore(H.data),def=H.defs.get('coffee-kit')!,roles:any={};for(const role of def.roles)roles[role.id]={provider:'codex',model:'fixture-model',effort:'low',skill:staffing.remember({ref:role.skill,version:1,text:H.engine.deps.skillText(role.skill)})};
const config=staffing.approve({schema:1,algorithm:'sha256-canonical-v1',project:coffeeStaffingProject('review-fixture'),workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles,review:{freshContexts:3,distinctProviders:false}},null,{run:'fixture-staffing',card:'fixture-card',answerSeq:1});
const guard=installStaffingGuard(H.engine,staffing,()=>{throw new Error('No borrowed project');});
H.engine.deps.provider=()=>({id:'codex',model:'fixture-model',reasoningEffort:'low',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(text:string){
 const call=async(name:string,args:any)=>H.agents.callTool(ctx.token,name,args);
 if(tools.some(t=>t.name==='judge_report')){
  judges++;const input=JSON.parse(text.split('Input (JSON):\n')[1]),snap=input.coffee_review_snapshot??input.needs?.coffee_review_snapshot; snapshots.push(snap??input);
  const invalid=await call('judge_report',{verdict:'fail',findings:[{locator:{file:{path:'index.html',line:1}},message:'broken locator',class:'fixture'}]});assert(invalid.error,'malformed locator is refused for correction, never silently dropped');
  const valid=await call('judge_report',{verdict:fail?'fail':'pass',findings:fail?[{locator:{type:'file',path:'index.html',line:1},message:'Fixture review '+judges+' asks for explicit re-review: '+ 'Retain this unresolved evidence. '.repeat(50),expected:'Explicit correction required. '.repeat(35),class:'fixture-review',severity:'blocking'}]:[]});assert(!valid.error,JSON.stringify(valid));
 }else{pages++;const result=await call('work_write',{path:'index.html',content:'<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Test</h1><img src="assets/coffee.png" alt="Coffee"><video controls src="assets/coffee.mp4"></video></main></body></html>'});assert(!result.error);}
 yield{type:'turnEnd',status:'ok'};
}};}} as any);
const store=new ArtifactStore(H.data),api=installCoffeeKit(H.engine,{artifacts:store,choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),reviewStaffing:(def,params)=>{const c=guard.verified(def,params);return{hash:c.hash,roles:c.roles,workflow:c.workflow,approval:c.approval};},image:async(o:any)=>{o.authorize();images++;return{bytes:png,mime:'image/png',width:16,height:16,sha256:'fixture',provider:'codex',model:'fixture-model',effort:'low'};},video:async(o:any)=>{o.authorize();videos++;return{bytes:film,poster:png,codec:'h264',duration:12,width:160,height:90,renderer:'hyperframes@0.8.159'};}});
try{
 const r=H.engine.start({workflow:'coffee-kit',text:'Offline review fixture',params:{project:'review-fixture',_staffing:config.hash,coffeeDesignPlan:readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8')}});
 const card=async(node:string)=>{assert(await until(()=>H.engine.cards.list({run:r.id,open:true}).some(c=>c.node===node)&&!H.engine.busy(r.id)),JSON.stringify(r.nodes));return H.engine.cards.list({run:r.id,open:true}).find(c=>c.node===node)!;};
 await H.engine.answer((await card('direction')).id,{choice:'confirm',by:'fixture captain'});
 let hold=await card('capability');assert(hold.options.some(o=>o.id==='retry-review'),JSON.stringify({nodes:r.nodes,jobs:[...H.agents.jobs.values()].map(j=>({error:j.error,said:j.said})),ledger:H.engine.trusted(r.id).entries.filter(e=>e.record==='check').map(e=>({check:e.check,error:e.error}))}));assert(hold.options.some(o=>o.id==='revise-page'));assert(!hold.options.some(o=>o.id==='approve'));
 const checks=H.engine.trusted(r.id).entries.filter(e=>e.node==='checks'&&e.kind==='judged');assert.equal(checks.length,2);assert(checks.every(e=>e.verdict==='fail'&&e.findings.length===3&&e.dropped===0));
 const snap=snapshots[0];assert.deepEqual(snap.reviewBoundary,{decision:'source-correctness-before-captain-acceptance',visualEvidence:'not-supplied-not-certified',missingVisualEvidenceBlocksSourceReview:false,captainWholeSiteApprovalRequired:true});assert(snap.texts['assets/coffee-playback.js'].includes('video'));assert.equal(snap.staffing.approved.hash,config.hash);assert(snap.staffing.evidence.some((e:any)=>e.record==='staffing-start'));assert(snap.staffing.evidence.some((e:any)=>e.record==='staffing-instructions'&&e.data.role==='worker'));
 assert.equal(snap.receipts.site.dependencies.video,snap.receiptEvidence.video.sha256);assert(snap.receiptEvidence.site.source.sig);assert.equal(store.approved(snap.receipts.site.artifact),null);
 const counts=[pages,images,videos],prior=hold.id;hold=(await api.refreshRecovery(r.id))!;assert.equal(H.engine.cards.get(prior)?.status,'cancelled');assert.deepEqual([pages,images,videos],counts);await assert.rejects(H.engine.answer(prior,{choice:'retry-review',note:'Stale',by:'fixture captain'}));
 const file=join(store.filesDir(snap.receipts.site.artifact,snap.receipts.site.n),'index.html'),original=readFileSync(file);writeFileSync(file,'changed');await assert.rejects(api.refreshRecovery(r.id));writeFileSync(file,original);
 fail=false;await H.engine.answer(hold.id,{choice:'retry-review',note:'Review the complete source evidence after the adapter fix',by:'fixture captain'});
 const acceptance=await card('review');assert.deepEqual([pages,images,videos],counts,'re-review reuses media and page');assert.equal(judges,12);assert(snapshots.at(-1).cumulativeCaptainConstraints.reviewRequests.some((r:any)=>r.note==='Review the complete source evidence after the adapter fix'&&r.source.sig),'signed captain re-review instructions must reach judges');assert(JSON.stringify(snapshots.at(-1).cumulativeCaptainConstraints).length>12000,'real multi-review history remains complete beyond the old limit');assert.equal(store.approved(snap.receipts.site.artifact),null,'judge pass still needs captain approval');assert(H.engine.trusted(r.id).entries.some(e=>e.record==='coffee-review-recovery-v1'&&e.data.target==='site'));
 fail=true;await H.engine.answer(acceptance.id,{choice:'video',note:'Explicitly revise only film pacing',by:'fixture captain'});const reviseHold=await card('capability'),beforeRevise=[pages,images,videos];
 assert.equal(store.approved(snap.receipts.site.artifact),null);fail=false;
 await H.engine.answer(reviseHold.id,{choice:'revise-video',note:'Keep page and image; correct only the film',by:'fixture captain'});const finalReview=await card('review');
 assert.deepEqual([pages,images,videos],[beforeRevise[0],beforeRevise[1],beforeRevise[2]+1],'targeted recovery regenerates only authorized dependencies');
 assert(snapshots.at(-1).cumulativeCaptainConstraints.requests.some((r:any)=>r.originalCaptainComment==='Keep page and image; correct only the film'));
 for(const snapshot of snapshots){assert(snapshot.staffing.evidence.length<=3,'only signed binding + current page/image producer receipts; no historical judge accumulation');assert(snapshot.staffing.evidence.every((e:any)=>e.record!=='staffing-instructions'||e.data.role==='worker'));}
 assert(snapshots.length>=24,'multiple actual judged rounds exercised');
 await H.engine.answer(finalReview.id,{choice:'approve',note:'Captain explicitly defers visual inspection; no visual PASS claimed',by:'fixture captain'});
 assert(await until(()=>r.status==='succeeded'));assert.equal(r.nodes.library.state,'passed');assert(store.approved(snap.receipts.site.artifact));assert(H.engine.trusted(r.id).entries.some(e=>e.record==='coffee-approved-v1'),'source pass alone is insufficient; captain approval persists before library');
 console.log('PASS full source/receipt/staffing evidence, typed finding correction, fail preserved, signed/revalidated recovery, stale card refusal, no media regeneration, captain acceptance still mandatory');
}finally{H.stop();rmSync(H.data,{recursive:true,force:true});}
