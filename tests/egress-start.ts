import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Actual sandbox-denied bind must reject normally, not emit an uncaught event.
import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,dirname}from'node:path';
import{sandboxed}from'../src/runtime/checks';import{Egress}from'../src/egress';
let pass=0,fail=0;const ok=(v:unknown,n:string)=>{console.log(`${v?'ok':'FAIL'} ${n}`);v?pass++:fail++;};
const root=mkdtempSync(join(tmpdir(),'crew-egress-start-')),source=process.env.EGRESS_SOURCE??join(import.meta.dir,'../src/egress.ts'),script=join(root,'denied.ts');
writeFileSync(script,`import{Egress}from ${JSON.stringify(source)};const e=new Egress();let unhandled=false;process.on('uncaughtException',()=>{unhandled=true;});const timer=setTimeout(()=>{console.log('UNSETTLED');process.exit(1);},1200);try{await e.start();console.log('UNEXPECTED_LISTEN');process.exitCode=1;}catch{console.log(JSON.stringify({caught:true,unhandled,closed:!e.status().running,port:e.port}));process.exitCode=unhandled||e.status().running||e.port!==0?1:0;}finally{clearTimeout(timer);e.stop();}`);
try{
 const denied=await sandboxed([process.execPath,script],{cwd:root,out:root,tmp:join(root,'tmp'),timeoutS:4,network:false,reads:[dirname(source),join(dirname(dirname(source)),'package.json'),dirname(process.execPath)]});
 ok(denied.code===0&&!denied.timedOut&&denied.stdout.includes('"caught":true')&&denied.stdout.includes('"closed":true'),'actual denied bind rejects and clears ownership without unhandled error');
 if(denied.code!==0)console.log(JSON.stringify({code:denied.code,out:denied.stdout,err:denied.stderr.slice(-300)}));
 if(!process.env.EGRESS_SOURCE){const e=new Egress();try{const[a,b]=await Promise.all([e.start(),e.start()]);ok(a>0&&a===b,'concurrent start callers await one live owned listener');ok(!e.allowed('api.openai.com',null),'startup changes preserve credential-required proxy authority');}finally{e.stop();}}
}finally{rmSync(root,{recursive:true,force:true});}
console.log(`egress-start: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
