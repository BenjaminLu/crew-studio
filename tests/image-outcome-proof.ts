import{mkdtempSync,rmSync,readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';import assert from'node:assert/strict';
import{createRuntime}from'../src/runtime';import{Agents}from'../src/agent';import{ArtifactStore}from'../src/artifacts';import{StudioLog}from'../src/rawlog';import{imageOutcomeProof}from'../src/domain/image-proof';
const data=mkdtempSync(join(tmpdir(),'image-proof-')),store=new ArtifactStore(data);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP437DvPwAH/AM9TriEzAAAAABJRU5ErkJggg==','base64');
const rt=createRuntime({dataDir:data,agents:new Agents(data,()=>''),provider:()=>{throw new Error('No language provider in image fixture');},defaultProvider:()=>({provider:'stub',model:null}),log:new StudioLog(join(data,'events')),send(){},fmRoot:join(data,'fm'),protectedRoots:[],m3:{store,lane:{}}as any,fileorg:{}as any,docs:{}as any,generateImage:async(prompt:string,authorize:()=>void,signal:AbortSignal,reference?:any)=>{authorize();if(prompt.includes('FAIL_GENERATION'))throw new Error('fixture generation failure');return{bytes:png,mime:'image/png',width:1,height:1,sha256:createHash('sha256').update(png).digest('hex'),provider:'codex',model:'fixture-model',effort:'low'};}}as any),E=rt.engine;

async function until(test:()=>any){for(let n=0;n<300;n++){const result=test();if(result)return result;await Bun.sleep(10);}throw new Error('fixture timed out');}
async function accept(id:string){return until(()=>E.cards.list({run:id,open:true}).find(c=>c.node==='accept'));}
async function terminal(id:string){return until(()=>['succeeded','failed','cancelled'].includes(E.get(id)!.status));}
try{
 const run=E.start({workflow:'images',text:'Cute puppy',params:{provider:'codex'}}),c=await accept(run.id);
 assert.equal(imageOutcomeProof(E,store,run.id).complete,false,'awaiting acceptance has no success proof');
 await E.answer(c.id,{choice:'approve-draft',by:'captain',note:'Fixture inspected'});await terminal(run.id);
 const pin=E.get(run.id)!.ctx.deliver.draft;
 assert.deepEqual(imageOutcomeProof(E,store,run.id),{complete:true,artifact:pin.id,version:1},'real signed Engine acceptance yields proof');
 const actual=E.get(run.id)!;
 for(const edit of [
 ()=>{actual.ctx.library.version=9;return()=>actual.ctx.library.version=1;},
 ()=>{actual.nodes.accept.data.offerVisit=9;return()=>actual.nodes.accept.data.offerVisit=c.visit;},
 ]){const restore=edit();assert.equal(imageOutcomeProof(E,store,run.id).complete,false);restore();}
 const trusted=E.trusted.bind(E),ledger=trusted(run.id);
 for(const transform of [
 (es:any[])=>es.filter(e=>e.record!=='card-answer'),
 (es:any[])=>es.filter(e=>e.check!=='core/artifact-ready'),
 (es:any[])=>es.map(e=>e.record==='card-answer'?{...e,actor:'intruder'}:e),
 (es:any[])=>es.map(e=>e.record==='card-answer'?{...e,head:'wrong'}:e),
 (es:any[])=>es.map(e=>e.check==='core/artifact-ready'?{...e,data:{artifacts:[]}}:e),
 ]){E.trusted=()=>({...ledger,entries:transform(ledger.entries)})as any;assert.equal(imageOutcomeProof(E,store,run.id).complete,false,'signed authority/pins required');}E.trusted=trusted;
 const manifest=join(store.vdir(pin.id,1),'manifest.json'),saved=readFileSync(manifest,'utf8');
 for(const patch of [{status:'in-review'},{approvedBy:'intruder'},{sha256:'0'.repeat(64)},{source:{run:'R-other'}},{files:[]}]){writeFileSync(manifest,JSON.stringify({...JSON.parse(saved),...patch}));assert.equal(imageOutcomeProof(E,store,run.id).complete,false,'manifest cannot substitute signed approval/bytes');}writeFileSync(manifest,saved);
 const file=store.file(pin.id,1,'image.png')!,bytes=readFileSync(file);writeFileSync(file,'tamper');assert.equal(imageOutcomeProof(E,store,run.id).complete,false);writeFileSync(file,bytes);
 for(const mode of ['rejected','cancelled','failed']){const r=E.start({workflow:'images',text:mode==='failed'?'FAIL_GENERATION':'Puppy',params:{provider:'codex'}});if(mode==='rejected'){const card=await accept(r.id);await E.answer(card.id,{choice:'reject',by:'captain'});}else if(mode==='cancelled'){await accept(r.id);await E.cancel(r.id,'fixture');}await terminal(r.id);assert.equal(imageOutcomeProof(E,store,r.id).complete,false,mode+' has no approved deliverable');}
 console.log('PASS real image Engine readiness + captain acceptance; missing/tampered signed pins, artifact approval/hash/bytes/source, rejected/cancelled/failed');
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id,'cleanup');rmSync(data,{recursive:true,force:true});}
