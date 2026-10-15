import {mkdirSync,mkdtempSync,existsSync} from "node:fs";import {join} from "node:path";import {tmpdir} from "node:os";import {freePort,waitUp} from "./boot.mjs";
const root=join(import.meta.dir,".."),bin=process.argv[2]||join(root,"dist/crew-studio"),temp=mkdtempSync(join(tmpdir(),"native-binary-")),path=join(temp,"no-tools"),data=join(temp,"data");mkdirSync(path);
let pass=0,fail=0;const ok=(c:unknown,n:string)=>{console.log(`${c?"ok":"FAIL"} ${n}`);c?pass++:fail++;};
if(!existsSync(bin))throw new Error("build the binary first");
ok(!existsSync(data)&&!existsSync(join(temp,"Desktop/firstmate-workflow")),"fixture starts with no data or v1 checkout");
const port=await freePort(),base=`http://127.0.0.1:${port}`;
const env={HOME:temp,TMPDIR:temp,PATH:path,CREW_DATA:data,CREW_PORT:String(port),CREW_INSTALL_RUNNER:"mock",CREW_NO_REAL_INSTALL:"1",CREW_SESSION_TOKEN:"native-test-session"};
for(const tool of ["bun","node","python3","git","gh","claude","codex"]) {let absent=false;try{absent=!Bun.spawnSync([tool,"--version"],{env}).success;}catch{absent=true;}ok(absent,`clean launch PATH has no ${tool}`);}
const app=Bun.spawn([bin],{cwd:temp,env,stdout:"ignore",stderr:"pipe"});
let diagnostics=""; (async()=>{for await(const d of app.stderr)diagnostics+=new TextDecoder().decode(d);})();
try{
 await waitUp(base,app,10000);ok(true,"binary starts with no coding tools or v1 state");
 const summary=await(await fetch(base+"/api/summary")).json();ok(summary.state===join(data,"legacy-empty")&&!summary.github.enabled&&!summary.board.writable&&summary.tasks.length===0,"default startup reads no legacy checkout and enables no external adapters");
 const doctor=await(await fetch(base+"/api/doctor")).json(),by=Object.fromEntries(doctor.items.map((i:any)=>[i.id,i]));
 ok(doctor.compiled&&by.native.status==="ok"&&by.assets.status==="ok","basic web readiness and assets are native and embedded");
 ok(["git","node","python","claude","codex"].every(id=>by[id]?.status==="missing"),"missing coding/interpreter dependencies are reported honestly");
 ok(by.state.status==="info"&&by.board.status==="info"&&!by["round-login"],"no outside vendor credential probe or legacy adapter is needed for basic pages");
 const wf=await(await fetch(base+"/api/wf")).json();ok(wf.workflows.length>0&&wf.checks.length>0,"native workflow and check manifests work without their optional interpreters");
 for(const api of ["/api/wruns","/api/scards","/api/skills"]) {const r=await fetch(base+api);ok(r.ok,`native ${api} works${r.ok?"":": "+r.status+" "+(await r.text()).slice(0,200)}`);}
 const takeover=await(await fetch(base+"/api/takeover")).json();ok(takeover.project===join(data,"workspace"),"firstmate default is the safe Studio workspace");
 for(const file of ["/","/app.js","/ootb.js","/styles.css","/runtime.js"]) {const r=await fetch(base+file);ok(r.ok,`native web asset ${file} served`);}
 ok(!existsSync(join(temp,"Desktop/firstmate-workflow")),"startup never creates or projects v1 state");
}catch(e){ok(false,`binary launch/verification: ${String(e).slice(0,120)}`);}finally{app.kill();}
if(fail)console.log(diagnostics.split("\n").filter(l=>/^(error:|Error:|TypeError:|SyntaxError:|ReferenceError:|\s+at )/.test(l)).map(l=>l.replaceAll(temp,"<fixture>")).join("\n"));
console.log(`native-standalone-binary: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
