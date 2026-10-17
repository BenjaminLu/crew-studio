import "./lib/isolated-env.mjs";
import assert from 'node:assert/strict';import {rmSync} from 'node:fs';
import {harness,Y} from './rt-harness';import {StaffingStore} from '../src/domain/staffing';import {installFirstmateStaffing} from '../src/firstmate-staffing';import {bundledText} from '../src/bundled';
const flow={id:'code-firstmate',name:'Candidate choices',kind:'code',version:1,roles:[{id:'worker',label:'Worker',skill:'pack:firstmate/skills/worker.md'}],nodes:[{id:'wait',kind:'card',label:'Wait',card:{ body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, options:[{id:'done',label:'Done', labelZh: 'Done'}]}}],edges:[]};
const h=await harness([Y(flow),bundledText('workflows/v2/firstmate-staffing.wf.yaml')!]);
try{
 const e=h.engine;e.deps.skillText=(ref:string)=>bundledText('packs/'+ref.slice(5))!;
 const project={namespace:'git' as const,id:'candidate-project',identity:'offline-candidate-project'};
 const facts=async()=>[{provider:'claude',support:'supported' as const,auth:'verified',quota:'unknown',expires:Date.now()+30000,models:[],candidates:[{id:'claude-opus-5-5',efforts:['low','medium','high']}]}];
 const tools=installFirstmateStaffing(e,new StaffingStore(h.data),()=>project,facts,()=>false);let turn=0;
 const call=(name:string,args:any)=>tools.call(name,args,{captain:true,key:'captain-'+ ++turn,text:'explicit offline choice',live:()=>true});
 const base={project:project.id,workflow:'code-firstmate',version:1};
 for(const [field,value] of [['provider','claude'],['model','claude-opus-5-5'],['effort','medium']]){const result:any=await call('studio_staffing_interview',{...base,answers:{worker:{[field]:value}}});assert(!result.error);}
 const result:any=await call('studio_staffing_interview',base);assert(result.complete);assert.equal(result.choices.worker.model,'claude-opus-5-5');
 await assert.rejects(()=>call('studio_propose_staffing',{...base,roles:result.choices}));assert.equal(e.list().length,0);
 console.log('PASS unverified candidate model/effort choices persist while dispatch remains blocked without exact verification');
}finally{h.stop();rmSync(h.data,{recursive:true,force:true});}
