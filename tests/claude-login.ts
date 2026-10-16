// Claude sign-in from the board: official `claude auth login` in the ordinary account context, offline fixture only.
import{mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{spawn}from'node:child_process';import{request as httpRequest}from'node:http';
import{suite,until}from'./rt-harness';import{freePort,waitUp}from'./boot.mjs';
for(const key of['CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CONFIG_DIR','CREW_CLAUDE_BILLING'])delete process.env[key];
const{ok,end}=suite('claude-login');
const fixture=join(import.meta.dir,'fixture/claude-login.mjs'),root=mkdtempSync(join(tmpdir(),'crew-claude-login-test-')),home=join(root,'home'),data=join(root,'data'),repo=join(root,'repo');for(const d of[home,data,repo])mkdirSync(d,{recursive:true});
const mode=(m:string)=>writeFileSync(join(home,'.claude-login-mode'),m);
const trace=()=>existsSync(join(home,'.claude-login-trace.jsonl'))?readFileSync(join(home,'.claude-login-trace.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const port=await freePort(),base=`http://127.0.0.1:${port}`,token='offline-claude-login-session',TAILNET='claude-login-test.tailnet.example';
const app=spawn('bun',['src/server.ts'],{cwd:join(import.meta.dir,'..'),env:{...process.env,USER:process.env.USER||'fixture-user',LOGNAME:process.env.LOGNAME||'fixture-user',HOME:home,CODEX_HOME:join(home,'.codex'),CREW_DATA:data,CREW_MAIN_PROJECT:repo,CREW_SESSION_TOKEN:token,CREW_PORT:String(port),CREW_GH:'0',CREW_CHAT_PROVIDER:'stub',CREW_INSTALL_RUNNER:'mock',CREW_CLAUDE_BIN:fixture,CREW_HOST_CLAUDE_BIN:'/nonexistent/claude',CREW_HOST_CODEX_BIN:'/nonexistent/codex',CREW_TAILNET_NAME:TAILNET,CREW_CLAUDE_LOGIN_MS:'1500'},stdio:['ignore','pipe','pipe']});app.stdout.resume();app.stderr.resume();
const raw=(method:string,path:string,o:{host?:string;token?:string;session?:boolean;origin?:string;body?:any}={}):Promise<{status:number;body:any}>=>new Promise(resolve=>{
 const payload=method==='GET'?undefined:JSON.stringify(o.body??{});
 const headers:Record<string,any>={host:o.host??`127.0.0.1:${port}`,...(o.token?{authorization:`Bearer ${o.token}`}:o.session===false?{}:{'x-crew-session':token}),...(o.origin?{origin:o.origin}:{}),...(payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{})};
 const r=httpRequest({host:'127.0.0.1',port,method,path,headers},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>{let j=null;try{j=JSON.parse(t);}catch{}resolve({status:res.statusCode??0,body:j});});});r.on('error',()=>resolve({status:0,body:null}));if(payload)r.write(payload);r.end();});
const account=async()=>(await raw('GET','/api/claude/account')).body;
const settle=async()=>{let v:any;for(let n=0;n<100;n++){v=await account();if(v?.state!=='pending')return v;await Bun.sleep(40);}return v;};
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
try{
 await waitUp(base,app);
 // refusals
 ok((await raw('GET','/api/claude/account',{session:false})).status===401,'account status needs a Studio session on the desktop');
 ok((await raw('POST','/api/claude/account/login',{session:false})).body?.code==='session','sign-in without a Studio session is refused');
 ok((await raw('POST','/api/claude/account/login',{origin:'https://evil.example'})).body?.code==='crossSite','cross-site sign-in is refused');
 const code=(await raw('POST','/api/remote/pair/start')).body.code,ptok=(await raw('POST','/api/remote/pair',{host:TAILNET,body:{code,name:'Pixel'}})).body?.token;
 ok(!!ptok&&(await raw('POST','/api/claude/account/login',{host:TAILNET,token:ptok})).body?.code==='desktopOnly','a paired phone cannot start Claude sign-in');
 ok((await raw('POST','/api/claude/account/cancel',{host:TAILNET,token:ptok})).body?.code==='desktopOnly','a paired phone cannot cancel Claude sign-in');
 ok(trace().every(r=>r.args.join(' ')!=='auth login'),'no refused request launched the CLI');
 // signed out, then success
 const before=(await raw('GET','/api/claude/native/status')).body;ok(before.loginState==='not-logged-in','status starts signed out');
 mode('success');const started=await raw('POST','/api/claude/account/login');ok(started.status===200&&['pending','done'].includes(started.body.state),'desktop sign-in starts the official login');
 const done=await settle();ok(done.state==='done','a successful CLI exit is reported as done');
 const after=(await raw('GET','/api/claude/native/status')).body;ok(after.loginState==='logged-in'&&after.auth==='verified','status refreshes to signed in after sign-in');
 ok(!JSON.stringify([started.body,done,after]).match(/PRIVATE_OAUTH|PRIVATE_ACCOUNT/),'no sign-in URL or account detail leaves the server');
 const logins=trace().filter(r=>r.args.join(' ')==='auth login');ok(logins.length===1&&logins.every(r=>r.user&&r.credentialKeys.length===0),'login runs with USER/LOGNAME and no copied credential');
 ok(trace().every(r=>r.args[0]==='auth'),'signing in and status make no model request');
 // fail
 mode('fail');await raw('POST','/api/claude/account/login');ok((await settle()).state==='failed','a failed CLI exit is reported as failed');
 // cancel
 rmSync(join(home,'.claude-login-pid'),{force:true});mode('hang');const hang=await raw('POST','/api/claude/account/login');ok(hang.body.state==='pending','a waiting sign-in is pending');
 ok((await raw('POST','/api/claude/account/login')).status===409,'a second sign-in while one runs is refused');
 ok(/claude auth login/.test(hang.body.reason)&&/code to paste/.test(hang.body.reason)&&/stops waiting after 2 seconds/.test(hang.body.reason)&&/claude auth login/.test(hang.body.reasonZh)&&/2 秒後停止等待/.test(hang.body.reasonZh),'pending copy says what to do if no browser opens or a code is shown, and when Studio stops waiting');
 await until(()=>existsSync(join(home,'.claude-login-pid')));const pid=Number(readFileSync(join(home,'.claude-login-pid'),'utf8'));
 const cancelled=await raw('POST','/api/claude/account/cancel');ok(cancelled.body.state==='cancelled','cancel reports cancelled');ok(!alive(pid),'cancel stops the owned CLI process');
 // Doctor's Log in for Claude runs the same shared sign-in, never a Terminal job
 rmSync(join(home,'.claude-login-pid'),{force:true});const docLogin=await raw('POST','/api/doctor/login',{body:{item:'claude'}});ok(docLogin.status===200&&docLogin.body.state==='pending'&&!docLogin.body.job,'Doctor Claude login starts the shared sign-in, not a Terminal job');
 ok((await account()).state==='pending','Doctor sign-in is the same owned flow the card shows');await until(()=>existsSync(join(home,'.claude-login-pid')));await raw('POST','/api/claude/account/cancel');
 // timeout
 rmSync(join(home,'.claude-login-pid'),{force:true});await raw('POST','/api/claude/account/login');await until(()=>existsSync(join(home,'.claude-login-pid')));const tpid=Number(readFileSync(join(home,'.claude-login-pid'),'utf8'));
 const timed=await settle();ok(timed.state==='timeout','an abandoned sign-in times out');ok(!alive(tpid),'timeout stops the owned CLI process');
}finally{if(app.exitCode===null&&app.signalCode===null){const exited=new Promise(r=>app.once('exit',r));app.kill('SIGTERM');await exited;}rmSync(root,{recursive:true,force:true});}
{ // a sign-in whose process cleanup is unverified blocks the next one
 const {ClaudeLogin}=await import('../src/host/claude-login');const uhome=mkdtempSync(join(tmpdir(),'crew-claude-login-unit-'));const saved=process.env.HOME;process.env.HOME=uhome;writeFileSync(join(uhome,'.claude-login-mode'),'hang');
 const l=new ClaudeLogin({bin:()=>fixture});try{const first=l.start();ok(/stops waiting after 5 minutes/.test(first.reason)&&/5 分鐘後停止等待/.test(first.reasonZh),'default pending copy says Studio stops waiting after 5 minutes');await until(()=>existsSync(join(uhome,'.claude-login-pid')));const owner=(l as any).owner,realStop=owner.proc.stop;owner.proc.stop=()=>Promise.reject(new Error('probe group death unverified'));
  const v:any=await Promise.race([l.cancel(),Bun.sleep(3000).then(()=>({state:'hung'}))]);let refused=false;try{l.start();}catch{refused=true;}ok(v.state==='failed'&&refused,'start refuses while an earlier owned process cleanup is unverified');await realStop();
 }finally{process.env.HOME=saved;rmSync(uhome,{recursive:true,force:true});}
}
end();
