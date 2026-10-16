import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// R-017: a film whose HyperFrames check fails shows the real cause on the captain card, keeps it as
// Task evidence, and a "continue" does not blindly rerun identical inputs. Offline providers; the
// renderer is a fixture that throws the typed diagnostic the real check produced.
//   bun tests/coffee-film-failure.ts
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until} from './rt-harness';
import {bundledText} from '../src/bundled';
import {ArtifactStore} from '../src/artifacts';
import {installCoffeeKit} from '../src/domain/coffee-kit';
import {HyperframesFailure,type HyperframesDiagnostic} from '../src/render/hyperframes';
const H=await harness([bundledText('workflows/v2/coffee-kit.wf.yaml')!]);
const png=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=16x16','-frames:v','1','-vcodec','png','-f','image2pipe','pipe:1']);
let passed=0;const ok=(name:string)=>{passed++;console.log('PASS '+name);};
H.engine.deps.provider=()=>({id:'codex',model:'fixture-model',reasoningEffort:'low',sandboxFree:true,start(_s:any,_t:any,ctx:any){return{interrupt(){},async *send(){const content='<!doctype html><html><head><title>Fixture</title></head><body><h1>Test</h1><img src="assets/coffee.png" alt="Test"><video controls src="assets/coffee.mp4"></video></body></html>';const response=await fetch(`${ctx.studioUrl}/api/tools/work_write`,{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify({path:'index.html',content})});assert(!(await response.json()).error);yield{type:'turnEnd',status:'ok'};}};}}) as any;
const contrast=(inputDigest:string):HyperframesDiagnostic=>({schema:1,stage:'check',code:'command-failed',inputDigest,deterministic:true,
 gates:[{gate:'lint',ok:true,errors:0,warnings:4},{gate:'layout',ok:true,errors:0,warnings:2},{gate:'contrast',ok:false,errors:5,warnings:2}],
 findings:[{gate:'contrast',code:'contrast_aa_failure',severity:'error',message:'Contrast is 3.01:1; WCAG AA requires 4.5:1.',text:'杯子與色塊依序登場。',fg:'rgb(240,100,69)',bg:'rgb(255,248,235)',suggestedColor:'rgb(190,79,55)',ratio:3.01,requiredRatio:4.5}],detail:null});
const seen:(string|null|undefined)[]=[];
const video=async(o:any)=>{o.authorize();seen.push(o.failedInputDigest);
 if(seen.length===1)throw new HyperframesFailure('HyperFrames check failed',true,'check','command-failed',contrast('a'.repeat(64)));
 if(o.failedInputDigest==='a'.repeat(64))throw new HyperframesFailure('HyperFrames inputs are unchanged since the failed check',true,'snapshot','unchanged-inputs',{...contrast('a'.repeat(64)),stage:'snapshot',code:'unchanged-inputs',gates:[],findings:[],detail:'identical'});
 throw new Error('unexpected third attempt');};
installCoffeeKit(H.engine,{artifacts:new ArtifactStore(H.data),choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),image:async(o:any)=>{o.authorize();return{bytes:png,mime:'image/png',width:16,height:16,sha256:'fixture',provider:'codex',model:'fixture-model',effort:'low'};},video});
try{
 const r=H.engine.start({workflow:'coffee-kit',text:'Offline film failure test',params:{coffeeDesignPlan:readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8')}});
 assert(await until(()=>H.engine.cards.list({run:r.id,open:true}).some(c=>c.node==='direction')));
 await H.engine.answer(H.engine.cards.list({run:r.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});
 assert(await until(()=>r.nodes.capability?.waiting==='card'&&!H.engine.busy(r.id)));
 const note=r.nodes.video.note??'';
 assert.equal(r.nodes.video.outcome,'unavailable');
 assert.match(note,/HyperFrames check failed: contrast \(5 errors\)/);assert.match(note,/Contrast is 3\.01:1; WCAG AA requires 4\.5:1\./);assert.match(note,/rgb\(240,100,69\) on rgb\(255,248,235\)/);
 ok('the node note names the failing gate and the real contrast finding, not only "No verified film"');
 const evidence=H.engine.trusted(r.id).entries.filter(e=>e.record==='coffee-film-failure-v1');
 assert.equal(evidence.length,1);assert.equal(evidence[0].data.diagnostic.inputDigest,'a'.repeat(64));assert.equal(evidence[0].data.diagnostic.findings[0].ratio,3.01);
 ok('the typed diagnostic is kept as signed Task evidence');
 const card=H.engine.cards.get(r.nodes.capability.card!)!;
 assert(card.options.some(o=>o.id==='fresh-video'));assert.equal(card.body,note);assert.equal((card as any).detail?.coffeeFilmFailure?.findings?.[0]?.code,'contrast_aa_failure');
 ok('the captain card shows the cause next to the fresh-film choice');
 await H.engine.answer(card.id,{choice:'fresh-video',note:'繼續',by:'fixture captain'});
 assert(await until(()=>seen.length===2&&r.nodes.capability.waiting==='card'&&r.nodes.capability.card!==card.id&&!H.engine.busy(r.id)));
 assert.equal(seen[0],null);assert.equal(seen[1],'a'.repeat(64));
 ok('"continue" hands the renderer the failed inputs digest so identical inputs are not rerun');
 const again=r.nodes.video.note??'';assert.match(again,/Nothing changed since the failed film check/);
 const card2=H.engine.cards.get(r.nodes.capability.card!)!;assert.equal(card2.body,again);
 ok('an identical rerun tells the captain nothing changed instead of failing the same way');
}finally{H.stop();rmSync(H.data,{recursive:true,force:true});}
console.log(`coffee-film-failure: ${passed} passed, 0 failed`);
