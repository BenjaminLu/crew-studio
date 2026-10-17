import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness';
import {ArtifactStore} from '../src/artifacts';
import {installDeliver} from '../src/domain/deliver';
import {captureDeliverInputs,deliverInputTools,DELIVER_INPUT_MAX_BYTES} from '../src/domain/deliver-inputs';
const flow={id:'handoff-fixture',name:'Three role handoff',version:1,roles:[{id:'writer',label:'Design and review',skill:'fixture'}],nodes:[
 {id:'design',kind:'agent',label:'Design direction',detail:'DESIGN_ASSIGNMENT: define the visual direction.',role:'writer',mode:'deliver',args:{format:'document'},x:0,y:0},
 {id:'approve',kind:'card',label:'Captain approves design',card:{ body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, options:[{id:'approve',label:'Approve', labelZh: 'Approve'}]},x:1,y:0},
 {id:'build',kind:'agent',label:'Build website',detail:'BUILD_ASSIGNMENT: use the approved design source.',role:'writer',mode:'deliver',args:{format:'web'},x:2,y:0},
 {id:'review',kind:'agent',label:'Review sources',detail:'REVIEW_ASSIGNMENT: compare design and HTML sources, not visual browser behavior.',role:'writer',mode:'deliver',args:{format:'document'},x:3,y:0},
 {id:'done',kind:'hook',label:'Done',x:4,y:0}],edges:[['design','approve'],['approve','build','approve'],['build','review'],['review','done']]};
const H=await harness([Y(flow)]),E=H.engine,store=new ArtifactStore(H.data),prompts:Record<string,string>={};installDeliver(E,{dataDir:H.data,artifacts:store,lane:{},fileorg:{},docs:{}} as any);
const design='# Approved design\nUse APRICOT_SENTINEL as the site accent and address families.';
let run:any,rejections=0;
const version=(id:string,source:string,task:string)=>{const dir=join(H.data,'source-'+id);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'doc.md'),source);if(!store.get(id))store.create({id,title:id,type:'doc',source:'md',entry:'doc.md'});return store.addVersion(id,{from:dir,primary:'doc.md',createdBy:{kind:'host'},source:{run:task}});};
E.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_system:any,tools:any[],ctx:any){return{interrupt(){},async *send(text:string){
 const node=/Node: (design|build|review) —/.exec(text)?.[1]!;assert(node);prompts[node]=text;assert(text.includes(node.toUpperCase()+'_ASSIGNMENT'));
 const call=async(name:string,args:any)=>H.agents.callTool(ctx.token,name,args),good=async(name:string,args:any)=>{const out:any=await call(name,args);assert(!out.error,JSON.stringify(out));return out;};
 const listed:any=await good('input_list',{});
 if(node==='design'){assert.equal(listed.inputs.length,0);await good('work_write',{path:'doc.md',content:design});}
 if(node==='build'){
  assert.deepEqual(listed.inputs.map((p:any)=>p.producer),['design']);const pin=listed.inputs[0];assert.equal(pin.n,1);assert.equal((await good('work_list',{})).length,0,'inputs are not copied into writable folder');
  version(pin.id,'# Newer design\nNEW_LATEST_MUST_NOT_REPLACE_PIN',run.id);assert.equal(store.latest(pin.id)?.n,2);
  const read:any=await good('input_read',{producer:'design'});assert.match(read.text,/APRICOT_SENTINEL/);assert(!read.text.includes('NEW_LATEST'));assert.equal(read.n,1);
  for(const [name,args] of [['input_read',{producer:'../design'}],['input_read',{producer:'design',path:'../../secret'}],['input_read',{producer:'foreign'}],['input_read',{producer:'design',id:'foreign',n:1}],['input_read',{producer:'design',lines:201}],['work_read',{path:store.file(pin.id,1,'doc.md')}],['work_write',{path:'../design/doc.md',content:'overwritten'}]] as any[]){assert((await call(name,args) as any).error,name);rejections++;}
  assert(!tools.some(t=>t.name==='input_write'));
  const path=store.file(pin.id,1,'doc.md')!;writeFileSync(path,'tampered');assert((await call('input_read',{producer:'design'}) as any).error);rejections++;writeFileSync(path,design);
  const foreign=version('foreign-doc','# Foreign Task\nNOT_THIS_TASK','R-foreign');assert.throws(()=>captureDeliverInputs({run,node:run.def.nodes.find((n:any)=>n.id==='build'),ctx:{deliver:{design:{...pin,id:'foreign-doc',n:foreign.n,sha256:foreign.sha256}}}} as any,store),/Task pin/);
  const long=version('long-doc','x'.repeat(26000)+'TAIL_SENTINEL',run.id),longPins=captureDeliverInputs({run,node:run.def.nodes.find((n:any)=>n.id==='build'),ctx:{deliver:{design:{...pin,id:'long-doc',n:long.n,sha256:long.sha256}}}} as any,store),readLong=deliverInputTools(store,run.id,longPins,()=>true).find(t=>t.name==='input_read')!;
  const first=readLong.run({producer:'design'}),tail=readLong.run({producer:'design',offset:first.nextOffset});assert.equal(first.text.length,24000);assert.match(tail.text,/TAIL_SENTINEL/);assert.equal(tail.nextOffset,null);
  const huge=version('huge-doc','x'.repeat(DELIVER_INPUT_MAX_BYTES+1),run.id);assert.throws(()=>captureDeliverInputs({run,node:run.def.nodes.find((n:any)=>n.id==='build'),ctx:{deliver:{design:{...pin,id:'huge-doc',n:huge.n,sha256:huge.sha256}}}} as any,store),/bounded text/);
  await good('work_write',{path:'index.html',content:'<!doctype html><main><h1>APRICOT_SENTINEL</h1><p>FAMILY_HTML_SENTINEL</p></main>'});
 }
 if(node==='review'){
  assert.deepEqual(listed.inputs.map((p:any)=>p.producer),['build','design']);const designRead:any=await good('input_read',{producer:'design'}),htmlRead:any=await good('input_read',{producer:'build'});assert.match(designRead.text,/APRICOT_SENTINEL/);assert.match(htmlRead.text,/FAMILY_HTML_SENTINEL/);
  await good('work_write',{path:'doc.md',content:'# Source review\nPassed source comparison: APRICOT_SENTINEL design and FAMILY_HTML_SENTINEL HTML agree.'});
 }
 yield{type:'turnEnd',status:'ok'};
 }}}});
try{
 run=E.start({workflow:flow.id,text:'Create a family site from the captain-approved design.'});assert(await until(()=>E.cards.list({run:run.id,open:true}).some(c=>c.node==='approve')&&!E.busy(run.id)),JSON.stringify(run.nodes));
 assert(!prompts.build,'build waits for captain approval');await E.answer(E.cards.list({run:run.id,open:true})[0].id,{choice:'approve',by:'fixture captain'});
 assert(await until(()=>run.status==='succeeded'||run.status==='failed'),JSON.stringify(run.nodes));assert.equal(run.status,'succeeded',JSON.stringify({error:run.error,nodes:run.nodes}));assert.equal(rejections,8);
 const ref=run.ctx.deliver.review;assert.match(readFileSync(store.file(ref.id,ref.n,'doc.md')!,'utf8'),/FAMILY_HTML_SENTINEL/);assert(E.trusted(run.id).ok);assert.equal(E.ledger(run.id).filter(e=>e.record==='deliver-inputs').length,3);
 console.log('PASS actual three-role handoff reads pinned design and HTML, includes node assignments, waits for captain, ignores latest, refuses tamper/path/cross-Task/oversize, preserves writable isolation and records manifests');
}finally{for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H.stop();}
