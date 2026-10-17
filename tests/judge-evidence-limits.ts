import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import assert from 'node:assert/strict';
import {harness,Y,until} from './rt-harness';
process.env.CREW_TEST_IN_PROCESS='1';
const h=await harness(['coffee-kit','other'].map(kind=>Y({id:kind,name:kind,kind,version:1,roles:[],nodes:[{id:'hold',kind:'card',label:'Hold',x:0,y:0,card:{ body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, options:[{id:'close',label:'Close', labelZh: 'Close'}]}}],edges:[]})));
let launches=0,received=0;
h.engine.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,_t:any,ctx:any){launches++;return{interrupt(){},async *send(text:string){received=JSON.parse(text.split('Input (JSON):\n')[1]).payload.length;await h.agents.callTool(ctx.token,'judge_report',{verdict:'pass',findings:[]});yield{type:'turnEnd',status:'ok'};}};}} as any);
try{for(const [kind,size,allowed] of [['coffee-kit',70000,true],['coffee-kit',170000,true],['coffee-kit',200000,false],['other',70000,false]] as const){
 const r=h.engine.start({workflow:kind});await until(()=>r.nodes.hold.waiting==='card');const x=h.engine.x(r,r.def.nodes[0],r.nodes.hold),before=launches;
 const result=await h.engine.judge(x,{id:'fixture',title:{en:'Evidence limit'},judge:{prompt:'Offline evidence limit'},timeout_s:5,network:[]} as any,{use:'fixture/judge'} as any,{out:h.data,payload:'x'.repeat(size)});
 if(allowed){assert.equal(result.verdict,'pass');assert.equal(received,size);assert.equal(launches,before+1);}else{assert.match(result.error??'',/bounded capacity/);assert.equal(launches,before);}
 console.log(`PASS ${kind} ${size}: ${allowed?'complete input retained':'refused before model launch'}`);
}}finally{h.stop();}
