import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {localUnrestricted,localExecutionNotice} from '../src/local-execution';
import {withSafetyRules,composeInstructions,SAFETY_RULES} from '../src/skills';
import {OperatingRules,jobInstructions,OPERATING_RULES_HEADING,STUDIO_RULES_HEADING,STUDIO_AGENT_RULES} from '../src/operating-rules';
import {sandboxed,roundExec} from '../src/runtime/checks';
import {Agents} from '../src/agent';
const root=mkdtempSync(join(tmpdir(),'crew-local-mode-'));
const saved={...process.env};
try{
 delete process.env.CREW_LOCAL_UNRESTRICTED;delete process.env.CREW_LOCAL_DEPENDENCY_ROOT;
 assert.equal(localUnrestricted(),false);assert.equal(withSafetyRules('hello'),composeInstructions('hello',[]));
 process.env.CREW_FORCE_NO_SANDBOX='1';
 const options={cwd:root,out:join(root,'out'),tmp:join(root,'tmp'),timeoutS:5,network:false};
 assert((await sandboxed(['/usr/bin/true'],options)).refused,'default mode still refuses unavailable sandbox');
 process.env.CREW_LOCAL_UNRESTRICTED='1';assert.throws(localUnrestricted,/DEPENDENCY_ROOT/);
 process.env.CREW_LOCAL_DEPENDENCY_ROOT=root;assert(localUnrestricted());
 const system=withSafetyRules('hello');assert(system.includes(localExecutionNotice()));assert.equal(withSafetyRules(system),system,'effective system is idempotent for signed receipts');
 const sentinel=join(root,'outside-out.txt');
 const result=await sandboxed(['/bin/sh','-c','printf local > "$1"','test',sentinel],options);
 assert.equal(result.code,0);assert.equal(readFileSync(sentinel,'utf8'),'local','unrestricted check is not wrapped by OS sandbox');
 const command=await roundExec(['/bin/sh','-c','test -z "$HTTPS_PROXY" && printf direct'],{cwd:root,writes:[root],tmp:join(root,'round'),timeoutS:5,hosts:['example.test']});
 assert.equal(command.code,0);assert.equal(command.stdout,'direct','unrestricted command needs no egress proxy');
 const data=join(root,'data'),work=join(data,'work','fixture');mkdirSync(work,{recursive:true});
 const agents=new Agents(data,()=> 'http://127.0.0.1:4210');agents.toolUrl=()=> 'http://127.0.0.1:4211';
 let captured:any,actualSystem='';
 const provider:any={id:'fixture',model:'fixture',envKeys:[],sandboxNeeds:()=>({hosts:[],reads:[],tmpEnv:[],home:()=>({}),login:()=>({ok:true,env:{},source:'fixture'})}),start:(s:string,_tools:any,ctx:any)=>{actualSystem=s;captured=ctx;return{interrupt(){},async *send(){yield{type:'turnEnd',status:'ok'};}};}};
 const job=await agents.run({kind:'fixture',title:'local execution',system:'hello',text:'test',tools:[],provider,sandbox:{writes:[work],cwd:work}});
 assert.equal(job.status,'done');assert.equal(job.executionMode,'local-unrestricted');assert.equal(captured.sandbox,null);assert.equal(captured.env.HTTPS_PROXY,undefined);assert.equal(captured.cwd,work);
 // the job sends Studio's safety rules, then the operating rules section (captain's block, then Studio's rules), then the role text, then the local-execution notice last
 const rules=new OperatingRules(data).section(null),notice=localExecutionNotice();
 assert.equal(actualSystem,jobInstructions(system,rules));assert.equal(actualSystem,`${SAFETY_RULES}\n\n${rules.text}\n\nhello\n\n${notice}`);
 const at=[SAFETY_RULES,OPERATING_RULES_HEADING,`=== BEGIN OPERATING RULES `,`=== END OPERATING RULES `,STUDIO_RULES_HEADING,STUDIO_AGENT_RULES,'\n\nhello\n\n',notice].map(t=>actualSystem.indexOf(t));
 assert(at.every((i,k)=>i>=0&&(k===0||i>at[k-1])),'sections appear once each in order: '+at.join());
 assert(actualSystem.endsWith(notice)&&actualSystem.split(notice).length===2,'the local-execution notice is last and appears once');
 assert((await agents.callTool('invalid','anything',{})).error,'tool authority remains enforced');
 console.log('PASS local execution: default refusal, explicit opt-in, exact system receipt with operating rules, real unwrapped command, proxy-free worker, tool authority');
}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);rmSync(root,{recursive:true,force:true});}
