import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {mkdirSync,mkdtempSync,writeFileSync,existsSync,readFileSync} from "node:fs";import {join,dirname} from "node:path";import {tmpdir} from "node:os";
const temp=mkdtempSync(join(tmpdir(),"native-standalone-"));process.env.HOME=temp;
const {startupPaths}=await import("../src/startup");const {diagnose}=await import("../src/doctor");const {renderEnv}=await import("../src/render");
let pass=0,fail=0;const ok=(c:unknown,n:string)=>{console.log(`${c?"ok":"FAIL"} ${n}`);c?pass++:fail++;};
const data=join(temp,"data"),p=startupPaths(data,{});
ok(!p.legacy && p.state===join(data,"legacy-empty") && p.project===join(data,"workspace"),"native startup uses owned data/workspace, not the v1 checkout");
ok(!p.protectedRoots.includes(temp) && !p.protectedRoots.includes(data),"native workspace has no accidental HOME or data ancestor protection");
const explicit=startupPaths(data,{CREW_MAIN_PROJECT:join(temp,"selected")});ok(explicit.project===join(temp,"selected")&&!explicit.legacy,"explicit native project selection keeps legacy disabled");
const state=join(temp,"fixture/state"),legacy=startupPaths(data,{CREW_FM_STATE:state});ok(legacy.legacy&&legacy.project===dirname(state)&&legacy.protectedRoots[0]===dirname(state),"explicit legacy state keeps the existing project and protection boundary");
const v1=join(temp,"Desktop/firstmate-workflow/node_modules/playwright/index.mjs");mkdirSync(dirname(v1),{recursive:true});writeFileSync(v1,"fixture");
const keys=["PATH","CREW_NODE_BIN","CREW_PYTHON_BIN","PLAYWRIGHT_MODULE","CREW_PLAYWRIGHT_MODULE"];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
try{
 process.env.PATH=join(temp,"no-tools");for(const k of keys.slice(1))delete process.env[k];
 const renderer=renderEnv();ok(renderer.playwright!==v1,"renderer never discovers the v1 node_modules fallback");
 process.env.PLAYWRIGHT_MODULE=v1;ok(renderEnv().playwright===v1,"an explicit renderer module remains supported");delete process.env.PLAYWRIGHT_MODULE;
 const rows=diagnose({legacy:false,state:p.state,board:{writable:false},gh:{enabled:false,connected:false,tokenSource:null},keys:{anthropic:null,openai:null,compatBaseUrl:null},chatProvider:"claude",lanIp:null,tailscale:{installed:false,running:false,dnsName:null},compiled:true,render:renderer});const by=Object.fromEntries(rows.map(x=>[x.id,x]));
 ok(by.native.status==="ok"&&by.native.group==="basic"&&by.state.status==="info"&&by.board.status==="info","native basic readiness is independent of the optional v1 adapter");
 ok(["git","node","python"].every(id=>by[id]?.status==="missing"&&by[id].group==="coding"),"absent Git, Node and Python are honestly reported as coding/check dependencies");
 ok(by.node.action.kind==="install"&&by.python.action.kind==="none"&&by.git.action.kind==="none","guided install is offered only for supported installers");
 ok(by.renderer.group==="optional"&&by.renderer.status==="info"&&by.ffmpeg.status==="info","rendering dependencies are optional for basic launch");
 ok(/v1/.test(by.native.detail)&&/v1/.test(by.native.detailZh)&&!!by.python.titleZh,"new readiness copy includes Traditional Chinese");
}finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
console.log(`native-standalone: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
