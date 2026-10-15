// Real native page production + actual M3 mutation routes. No account/model/network vendor.
import {strict as assert} from 'node:assert';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {harness,until} from './rt-harness';
import {installCoffeeKit} from '../src/domain/coffee-kit';
import {createM3} from '../src/m3';
const fixtureDesignPlan=JSON.parse(readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8'));
const fixturePoster=Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAHAQEBAAAAAAAAAAAAAAAAAAACBBABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIABAAEAMBIgACEQADEQD/2gAMAwEAAhEDEQA/ALkAiJ//2Q==','base64');

const def=JSON.stringify({id:'coffee-preview',kind:'coffee-kit',name:'Coffee preview fixture',version:1,roles:[{id:'designer',label:'Designer',skill:'fixture'}],nodes:[{id:'direction',kind:'card',label:'Direction',args:{mode:'coffee-direction'}},{id:'page',kind:'agent',label:'Page',role:'designer',mode:'coffee-page'},{id:'done',kind:'hook',label:'Done'}],edges:[['direction','page','confirmed'],['page','done','ok']]});
const H=await harness([def]);let pass=0,launches=0;const ok=(c:unknown,n:string)=>{assert(c,n);console.log('PASS '+n);pass++;};
try{
 H.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxFree:true,start(_s:any,_t:any,ctx:any){launches++;return{interrupt(){},async *send(){const args={path:'index.html',content:'<main><h1>Coffee</h1><img src="assets/coffee.png"><video controls src="assets/coffee.mp4"></video></main>'};yield{type:'toolStart',id:'write',name:'work_write',args};const result=await fetch(ctx.studioUrl+'/api/tools/work_write',{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify(args)}).then(r=>r.json());assert(!result.error);yield{type:'toolEnd',id:'write',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};}} as any);
 const m3=createM3({dataDir:H.data,fileAllow:[H.data],studioUrl:()=>H.toolUrl,provider:H.engine.deps.provider,send(){},allowDrive:()=>true});
 const coffee=installCoffeeKit(H.engine,{artifacts:m3.store,choice:()=>({provider:'codex',model:'fixture-model',effort:'low'})});
 // Optional call makes the frozen-old control reach the actual vulnerable route.
 m3.useArtifactReviewPolicy?.(coffee?.artifactReview);
 const r=H.engine.start({workflow:'coffee-preview',text:'Useful preview',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});assert(await until(()=>H.engine.cards.list({run:r.id,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:r.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});assert(await until(()=>H.engine.get(r.id)?.status==='succeeded'));
 const receipt=H.engine.trusted(r.id).entries.find(e=>e.record==='coffee-output-v1'&&e.data.part==='page')!.data,id=receipt.artifact,n=receipt.n;
 const call=async(path:string,body?:any)=>{const req=new Request('http://localhost'+path,body!==undefined?{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}}:undefined);return (await m3.handle(req,new URL(req.url),{kind:'desktop'},body!==undefined))!;};
 // Approval is first: frozen17 actually returns200, not an import or API-shape shortcut.
 ok((await call(`/api/artifacts/${id}/v/${n}/approve`,{})).status===403,'generic approval cannot bypass native coffee bundle authority');
 for(const suffix of ['request','render','notes','findings'])ok((await call(`/api/artifacts/${id}/v/${n}/${suffix}`,{provider:'claude',comment:'Bypass attempt'})).status===403,'generic '+suffix+' cannot mutate native coffee artifact');
 ok((await call(`/api/artifacts/${id}/versions`,{html:'<main>Replacement</main>'})).status===403,'generic version upload cannot replace native artifact');
 ok((await call('/api/lane/run',{artifact:id,version:n,repo:'fixture-unused'})).status===403,'generic lane cannot export a native artifact outside whole-site Task authority');
 ok(launches===1&&m3.runs.list().length===0&&m3.store.version(id,n)!.status!=='approved','refused paths allocate no legacy producer or approval');
 const detail=await (await call(`/api/artifacts/${id}`)).json();ok(detail.nativeReview?.readOnly===true&&detail.nativeReview.taskHref===`#/run/${r.id}`&&detail.versions[0].createdBy.provider==='codex','preview carries trusted Task context and actual provenance');
 const file=await call(`/af/${id}/${n}/index.html`);ok(file.ok&&(await file.text()).includes('<video controls'),'native preview destination stays available read-only');
 const source=join(H.data,'ordinary-source');mkdirSync(source);writeFileSync(join(source,'index.html'),'<main>Ordinary artifact</main>');m3.store.create({id:'ordinary-artifact',title:'Ordinary',type:'web',source:'html',entry:'index.html'});m3.store.addVersion('ordinary-artifact',{from:source,primary:'index.html',createdBy:{kind:'captain'}});
 ok((await call('/api/artifacts/ordinary-artifact/v/1/approve',{})).ok,'ordinary artifact approval remains available');
 ok((await call('/api/artifacts/coffee-r-999-page',{title:'Pretend'})).status===403,'unknown reserved coffee ownership fails closed');
 writeFileSync(join(H.data,'evidence',r.id,'ledger.jsonl'),'malformed fixture\n',{flag:'a'});
 const untrusted=await (await call(`/api/artifacts/${id}`)).json();ok(untrusted.nativeReview?.readOnly===true&&untrusted.nativeReview.taskHref===null,'damaged signed ownership cannot fall back to legacy authority');
 console.log(`native-coffee-preview: ${pass} passed, 0 failed`);
}finally{H.stop();rmSync(H.data,{recursive:true,force:true});}
