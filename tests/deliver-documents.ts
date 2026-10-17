import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Documents (R-032): doc.html's <title> is the document's own H1, not the raw prompt; the accept
// card lists plain-wording and readability findings under "Needs your eye"; a document about the
// product reads the product's docs/ read-only, and one that is not about it gets no such tool.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness';
import {ArtifactStore} from '../src/artifacts';
import {installDeliver,studioDocSource,productDocTools} from '../src/domain/deliver';
import {BUNDLED} from '../src/bundled.gen';
const flow={id:'doc-fixture',name:'Doc fixture',version:1,roles:[{id:'writer',label:'Writer',skill:'fixture'}],nodes:[
 {id:'intake',kind:'hook',label:'Intake',do:'deliver.intake',x:0,y:0},{id:'produce',kind:'hook',label:'Round',do:'deliver.round',x:1,y:0},
 {id:'draft',kind:'agent',label:'Draft',role:'writer',mode:'deliver',args:{format:'document'},x:2,y:0},
 {id:'ready',kind:'check',label:'Readiness',checks:[{use:'core/artifact-ready',proves:[0]}],args:{producer:'all'},x:2.5,y:0},{id:'accept',kind:'card',label:'Accept',args:{mode:'deliver-accept'},x:3,y:0},{id:'closed',kind:'hook',label:'Closed',x:4,y:0}],
 edges:[['intake','produce'],['produce','draft'],['draft','ready'],['ready','accept','pass'],['ready','accept','fail'],['accept','closed','rejected']]};
const H=await harness([Y(flow)]),E=H.engine,store=new ArtifactStore(H.data);
const studioDocs=join(H.data,'..',`${H.data.split('/').pop()}-studio-docs`);mkdirSync(studioDocs,{recursive:true});writeFileSync(join(studioDocs,'live-acceptance.md'),`# Live acceptance\nIt runs DOCS_SENTINEL_CHECKS against a clean clone.\nExample token: ghp_${'a'.repeat(36)}\n`);
const outside=join(H.data,'..',`${H.data.split('/').pop()}-outside.md`);writeFileSync(outside,'# Outside\nOUTSIDE_SECRET\n');symlinkSync(outside,join(studioDocs,'linked.md'));
installDeliver(E,{dataDir:H.data,artifacts:store,lane:{},fileorg:{},docs:{},studioDocs} as any);
const seen:{text:string;tools:string[];read?:any}[]=[];
const memo='# Live acceptance for new teammates\n\nWe will utilize the cache to ensure speed.\n\nThis sentence goes on and on with many words so that a new teammate who reads it has to hold far too much in their head before the full stop finally arrives at the very end here.\n';
const providerOf=(A:any)=>()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,tools:any[],ctx:any){return{interrupt(){},async *send(text:string){
 const entry:any={text,tools:tools.map((t:any)=>t.name)};seen.push(entry);
 if(entry.tools.includes('product_docs_read'))entry.read=await A.callTool(ctx.token,'product_docs_read',{path:'live-acceptance.md'});
 const out:any=await A.callTool(ctx.token,'work_write',{path:'doc.md',content:memo});assert(!out.error,JSON.stringify(out));
 yield{type:'turnEnd',status:'ok'};}};}});
E.deps.provider=providerOf(H.agents);
let pass=0;const ok=(v:unknown,name:string,detail='')=>{assert(v,`${name} ${detail}`);pass++;console.log('ok '+name);};
const card=async(id:string)=>{assert(await until(()=>E.cards.list({run:id,open:true}).some(c=>c.node==='accept')&&!E.busy(id)),JSON.stringify(E.get(id)?.nodes));return E.cards.list({run:id,open:true}).find(c=>c.node==='accept')!;};
try{
 const prompt='ACCEPT 2026-10-16 Write a one-page memo that explains what Crew Studio\'s live acceptance run checks, for a new teammate.';
 const run=E.start({workflow:flow.id,text:prompt}),c=await card(run.id),ref=run.ctx.deliver.draft;
 const html=readFileSync(store.file(ref.id,ref.n,'doc.html')!,'utf8');
 ok(html.includes('<title>Live acceptance for new teammates</title>')&&!html.includes('<title>ACCEPT'),'doc.html title is the document H1, not the raw prompt',/<title>[^<]*/.exec(html)?.[0]);
 const eye=c.body.split('Needs your eye:')[1]??'';
 ok(/Wording \(paragraph 2\): R5 will/.test(eye)&&/R6 utilize/.test(eye),'accept card shows the plain-wording findings under Needs your eye',eye);
 ok(/Readability \(paragraph 3\): a \d+-word sentence/.test(eye),'accept card shows the long-sentence readability finding',eye);
 ok(Array.isArray(c.detail?.wording)&&c.detail.wording.some((f:any)=>f.kind==='wording'),'card detail carries the wording findings');
 ok(seen[0].tools.includes('product_docs_read')&&!seen[0].tools.some(t=>/product_docs_(write|replace)/.test(t)),'a document about Crew Studio gets read-only product docs tools',seen[0].tools.join(','));
 ok(/DOCS_SENTINEL_CHECKS/.test(seen[0].read?.text??'')&&/Product docs \(read-only/.test(seen[0].text),'the writer reads the product docs and its brief says so',JSON.stringify(seen[0].read));
 ok(!/ghp_a{36}/.test(seen[0].read?.text??'')&&/\[credential removed\]/.test(seen[0].read?.text??''),'a credential in the docs is redacted before the model sees it',seen[0].read?.text);
 { const src=studioDocSource(studioDocs)!,[list,read,search]=productDocTools(src);
   ok(!(list.run({}) as string[]).includes('linked.md')&&(read.run({path:'linked.md'}) as any).error&&!(search.run({text:'OUTSIDE_SECRET'}) as any[]).length&&(read.run({path:'../'+outside.split('/').pop()}) as any).error,'a symlink inside the docs folder, and a path out of it, are never read'); }
 { const bundled=studioDocSource()!;
   ok(bundled&&bundled.list().includes('docs/live-acceptance.md')&&/acceptance/i.test(bundled.text('docs/live-acceptance.md')??'')&&!bundled.list().some(p=>/^docs\/(research|retro)\//.test(p)),'by default the writer reads the docs bundled with Studio (no research notes or retros)');
   ok(Object.keys(BUNDLED).includes('docs/live-acceptance.md')&&Object.keys(BUNDLED).filter(k=>k.startsWith('docs/')).every(k=>/^docs\/(?:[^/]+|units\/[^/]+)\.md$/.test(k)),'the binary embeds the same docs (src/bundled.gen.ts from the build)'); }
 await E.answer(c.id,{choice:'reject',by:'fixture captain'});
 const other=E.start({workflow:flow.id,text:'Write a memo about the office picnic'});await card(other.id);
 ok(!seen[1].tools.some(t=>t.startsWith('product_docs'))&&!/Product docs/.test(seen[1].text),'a document not about the product gets no product docs');
 const H2=await harness([Y(flow)]),E2=H2.engine;installDeliver(E2,{dataDir:H2.data,artifacts:new ArtifactStore(H2.data),lane:{},fileorg:{},docs:{},studioDocs:null} as any);E2.deps.provider=providerOf(H2.agents);
 try{const none=E2.start({workflow:flow.id,text:prompt});assert(await until(()=>E2.cards.list({run:none.id,open:true}).some(c=>c.node==='accept')&&!E2.busy(none.id)),JSON.stringify(none.nodes));
  const last=seen.at(-1)!;ok(!last.tools.some(t=>t.startsWith('product_docs'))&&/Product docs: unavailable in this build/.test(last.text),'a build without docs says so in the brief instead of offering empty tools',last.text.slice(0,400));
 }finally{for(const r of E2.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E2.cancel(r.id);H2.stop();}
 console.log(`deliver-documents: ${pass} passed, 0 failed`);
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
