// Offline providers and encoder fixture: tests authority and reuse, not visual quality.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,rmSync,cpSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {harness,until} from './rt-harness';
import {bundledText} from '../src/bundled';
import {ArtifactStore} from '../src/artifacts';
import {installCoffeeKit} from '../src/domain/coffee-kit';
import {HyperframesFailure} from '../src/render/hyperframes';
const H=await harness([bundledText('workflows/v2/coffee-kit.wf.yaml')!]);
const png=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=16x16','-frames:v','1','-vcodec','png','-f','image2pipe','pipe:1']);
let pages=0,images=0,videos=0;
H.engine.deps.provider=()=>({id:'codex',model:'fixture-model',reasoningEffort:'low',sandboxFree:true,start(_s:any,_t:any,ctx:any){return{interrupt(){},async *send(){pages++;const content='<!doctype html><html><head><title>Fixture</title></head><body><h1>Test</h1><img src="assets/coffee.png" alt="Test"><video controls src="assets/coffee.mp4"></video></body></html>';const response=await fetch(`${ctx.studioUrl}/api/tools/work_write`,{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify({path:'index.html',content})});const result=await response.json();assert(!result.error,JSON.stringify(result));yield{type:'turnEnd',status:'ok'};}};}} as any);
const options={artifacts:new ArtifactStore(H.data),choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),image:async(o:any)=>{o.authorize();images++;return{bytes:png,mime:'image/png',width:16,height:16,sha256:'fixture',provider:'codex',model:'fixture-model',effort:'low'};}};
const api=installCoffeeKit(H.engine,options);
try {
 const r=H.engine.start({workflow:'coffee-kit',text:'Offline video recovery test',params:{coffeeDesignPlan:readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8')}});
 assert(await until(()=>H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='direction')));
 await H.engine.answer(H.engine.cards.list({run:r.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});
 assert(await until(()=>r.nodes.capability?.waiting==='card'&&!H.engine.busy(r.id)));
 assert.equal(r.nodes.page.outcome,'ok',JSON.stringify({node:r.nodes.page,jobs:[...H.agents.jobs.values()].map(j=>({error:j.error,status:j.status,provider:j.provider,model:j.model}))}));
 const old=r.nodes.capability.card!;assert.deepEqual(H.engine.cards.get(old)!.options.map(o=>o.id),['close']);
 await assert.rejects(api.refreshRecovery(r.id),/Install the film renderer/);assert.equal(r.nodes.capability.card,old);
 console.log('PASS missing renderer preserves original hold');
 const recovered=installCoffeeKit(H.engine,{...options,video:async(o:any)=>{o.authorize();videos++;throw new HyperframesFailure('Explicit test stop after admission',true);}});
 const node=r.def.nodes.find(n=>n.id==='capability')!,x=H.engine.x(r,node,r.nodes.capability);
 await assert.rejects(H.engine.reprepareCard(x,async()=>{await H.engine.card(x,'question',{captainOnly:true,title:'Explicit failed preparation fixture'});throw new Error('Fixture preparation failed');}),/Fixture preparation failed/);
 assert.equal(r.nodes.capability.card,old);assert.equal(H.engine.cards.get(old)!.status,'open');assert.equal(H.engine.busy(r.id),null);assert.equal(videos,0);
 console.log('PASS failed preparation restores original hold and releases card readiness');
 let entered=false,release=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 const held=H.engine.reprepareCard(x,async()=>{await H.engine.card(x,'question',{captainOnly:true,title:'Held preparation fixture'});entered=true;await gate;throw new Error('Held preparation stopped');});const heldResult=held.catch(e=>e);
 assert(await until(()=>entered));assert.equal(r.nodes.capability.card,old);assert.equal(H.engine.cards.get(old)!.status,'open');
 await assert.rejects(recovered.refreshRecovery(r.id),/waiting without active work/);await assert.rejects(H.engine.answer(old,{choice:'close',by:'fixture captain'}),/preparation is still running/);assert.equal(videos,0);
 console.log('PASS in-flight preparation keeps original pointer and refuses concurrent refresh or old-card answers');
 const snapshot=mkdtempSync(join(tmpdir(),'coffee-recovery-crash-'));cpSync(H.data,snapshot,{recursive:true});const loaded=await harness([bundledText('workflows/v2/coffee-kit.wf.yaml')!],{data:snapshot});
 try{installCoffeeKit(loaded.engine,options);loaded.engine.load();const replay=loaded.engine.get(r.id)!;assert.equal(replay.nodes.capability.card,old);assert.equal(loaded.engine.cards.get(old)!.status,'open');assert.equal(loaded.engine.cards.list({run:r.id,open:true}).length,1);assert.equal(videos,0);console.log('PASS restart during preparation keeps old hold and cancels the staged orphan without production');}finally{loaded.stop();rmSync(snapshot,{recursive:true,force:true});}
 release();await heldResult;assert.equal(r.nodes.capability.card,old);assert(await until(()=>!H.engine.busy(r.id))); 
 const before=H.engine.trusted(r.id).entries.filter(e=>e.record==='coffee-plan-v1').at(-1)!.data;
 const fresh=await recovered.refreshRecovery(r.id);assert(fresh?.options.some(o=>o.id==='fresh-video'));assert.equal(fresh.captainOnly,true);assert.equal(fresh.visit,H.engine.cards.get(old)!.visit);assert.equal(H.engine.cards.get(old)!.status,'cancelled');assert.equal(videos,0);assert.equal(H.engine.list().length,1);
 assert.deepEqual(H.engine.trusted(r.id).entries.filter(e=>e.record==='coffee-plan-v1').at(-1)!.data,before);
 console.log('PASS refresh creates signed captain card in same Task without production or generation changes');
 await assert.rejects(H.engine.answer(old,{choice:'fresh-video',note:'Retry',by:'fixture captain'}));assert.equal(videos,0);
 await H.engine.answer(fresh.id,{choice:'fresh-video',note:'Retry the repaired renderer; preserve approved design',by:'fixture captain'});
 assert(await until(()=>videos===1&&r.nodes.capability.waiting==='card'&&!H.engine.busy(r.id)));
 assert.equal(pages,1);assert.equal(images,1);const after=H.engine.trusted(r.id).entries.filter(e=>e.record==='coffee-plan-v1').at(-1)!.data;
 assert.equal(after.generations.page,before.generations.page);assert.equal(after.generations.image,before.generations.image);assert.equal(after.generations.video,before.generations.video+1);assert.equal(after.generations.site,before.generations.site+1);assert.deepEqual(after.revision,before.revision);
 console.log('PASS explicit captain retry advances film/site only, reuses page/image and preserves creative constraints');
 let cancelEntered=false,cancelRelease=()=>{};const cancelGate=new Promise<void>(resolve=>cancelRelease=resolve),cancelX=H.engine.x(r,node,r.nodes.capability);const cancelPending=H.engine.reprepareCard(cancelX,async()=>{await H.engine.card(cancelX,'question',{captainOnly:true,title:'Cancel preparation fixture'});cancelEntered=true;await cancelGate;});const cancelResult=cancelPending.catch(e=>e);assert(await until(()=>cancelEntered));H.engine.cancel(r.id,'fixture teardown during preparation');cancelRelease();assert(await cancelResult instanceof Error);assert(await until(()=>!H.engine.busy(r.id)));assert.equal(H.engine.cards.list({run:r.id,open:true}).length,0);assert.equal(videos,1);await assert.rejects(recovered.refreshRecovery(r.id));console.log('PASS cancellation during preparation cannot publish or authorize a late production attempt');
}finally{H.stop();rmSync(H.data,{recursive:true,force:true});}

const {createRuntime}=await import('../src/runtime/index');const apiData=mkdtempSync(join(tmpdir(),'coffee-recovery-api-'));
try{const runtime=createRuntime({dataDir:apiData,agents:H.agents,provider:H.engine.deps.provider,defaultProvider:()=>({provider:'codex',model:'fixture-model'}),log:H.engine.deps.log,send(){},fmRoot:apiData,studioUrl:()=>H.toolUrl});const path='http://127.0.0.1/api/wruns/R-001/coffee-recovery';for(const [method,who,body,want]of [['DELETE','desktop',{},405],['POST','phone',{},403],['POST','desktop',{choice:'fresh-video'},400]]as const){const response=await runtime.handle(new Request(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)}),new URL(path),{kind:who},true);assert.equal(response?.status,want);assert.equal(runtime.engine.list().length,0);}console.log('PASS actual recovery route refuses non-POST, phone and caller-supplied production choices without allocation');}finally{rmSync(apiData,{recursive:true,force:true});}
