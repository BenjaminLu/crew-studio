import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Real owned dummy descendants inherit pipes and ignore TERM; no vendor call.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{probeCodex}from'../src/providers/codex-probe';import{suite}from'./rt-harness';
const{ok,end}=suite('probe-process');const dir=mkdtempSync(join(tmpdir(),'crew-probe-descendants-')),auth=join(dir,'source'),bin=join(dir,'cli.mjs'),child=join(dir,'child.mjs'),pidfile=join(dir,'pids');mkdirSync(auth);writeFileSync(join(auth,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'abcdefgh.abcdefgh.abcdefgh',id_token:'fixture',account_id:'fixture',refresh_token:'NEVER-HAND'}}),{mode:0o600});
writeFileSync(child,`import{appendFileSync,writeFileSync}from'node:fs';appendFileSync(${JSON.stringify(pidfile)},process.pid+'\\n');process.on('SIGTERM',()=>{});setInterval(()=>writeFileSync(${JSON.stringify(join(dir,'heartbeat'))},String(Date.now())),20);`);
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
for(const mode of['descendant','oversize','app-descendant','app-oversize']){
writeFileSync(bin,`import{spawn}from'node:child_process';import{createInterface}from'node:readline';import{writeFileSync,appendFileSync}from'node:fs';appendFileSync(${JSON.stringify(pidfile)},process.pid+'\\n');writeFileSync(${JSON.stringify(join(dir,'home'))},process.env.CODEX_HOME);const args=process.argv.slice(2);if(args[0]==='login'){${mode==='oversize'?"process.stdout.write('X'.repeat(1000000));setInterval(()=>{},1000);":mode==='descendant'?"spawn(process.execPath,["+JSON.stringify(child)+"],{stdio:['ignore','inherit','inherit']});await new Promise(r=>setTimeout(r,70));console.log('Logged in using fixture');process.exit(0);":"console.log('Logged in using fixture');process.exit(0);"}}else{${mode==='app-descendant'?"spawn(process.execPath,["+JSON.stringify(child)+"],{stdio:['ignore','inherit','inherit']});await new Promise(r=>setTimeout(r,70));":mode==='app-oversize'?"process.stdout.write('X'.repeat(2000000));":""}const r=createInterface({input:process.stdin});r.on('line',l=>{let m;try{m=JSON.parse(l)}catch{return}if(!m.id)return;let result={};if(m.method==='account/read')result={account:{type:'chatgpt'}};if(m.method==='model/list')result={data:[{id:'fixture',model:'fixture',supportedReasoningEfforts:[]}],nextCursor:null};if(m.method==='account/rateLimits/read')result={rateLimits:{primary:{usedPercent:1}}};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});}`);
process.env.CODEX_HOME=auth;delete process.env.CODEX_API_KEY;const start=Date.now(),pending=probeCodex(bin);let timeout=false;const result=await Promise.race([pending,new Promise<null>(r=>setTimeout(()=>{timeout=true;r(null)},1500))]);const pids=existsSync(pidfile)?readFileSync(pidfile,'utf8').trim().split('\n').map(Number):[];
ok(!timeout&&Date.now()-start<1500,`${mode} bounded actual probe finishes without inherited-pipe hang`);
if(mode.includes('descendant'))ok(pids.length>0&&pids.every(p=>!alive(p)),'probe-owned inherited-pipe child ignores TERM yet is actually gone',JSON.stringify({pids,result}));
else ok(result&&!result.available,'oversized metadata cannot produce available capability');
const home=existsSync(join(dir,'home'))?readFileSync(join(dir,'home'),'utf8'):'';ok(!!home&&!existsSync(home),`${mode} copied credential home removed only after verified group teardown`,JSON.stringify({home,exists:existsSync(home),result}));
// Control-only cleanup of exact planted fixture children if the old probe failed.
for(const pid of pids)if(alive(pid))try{process.kill(pid,'SIGKILL')}catch{}
if(timeout){await Promise.race([pending,new Promise(r=>setTimeout(r,1200))]);}
}
// A group whose members have all exited but are not reaped yet (zombies) is gone: macOS refuses to signal it (EPERM) and ps
// still lists it. Under load a probe's own leader is such a zombie for a moment; the probe once called that an unverified
// cleanup, and the Claude auth status then stayed "cleanup unverified; restart Studio" for the rest of the run (the Start
// form's flaky "claude claude-sonnet-5-5 目前不可用"). Here the leader exits after a member of its group exited unreaped
// (its parent sits in another group and never reaps it), so the group holds only a zombie when the probe stops.
{const hpid=join(dir,'h.pid');
 const script=`my $L=$$; my $h=fork(); if(!$h){ setpgrp(0,0); open(STDOUT,'>/dev/null'); open(STDERR,'>/dev/null'); my $m=fork(); if(!$m){ setpgrp(0,$L) or exit 3; exit 0 } open(my $f,'>',$ARGV[0]); print $f "$$\\n"; close $f; sleep 30; exit 0 } select(undef,undef,undef,0.5); print "{\\"ok\\":true}\\n"; exit 0`;
 const {probeProcess}=await import('../src/providers/probe-process');
 const p=probeProcess(['/usr/bin/perl','-e',script,hpid],dir,{PATH:'/usr/bin:/bin'},undefined,{timeoutMs:8000});let error='';
 try{await p.exited;await p.stop();}catch(e:any){error=e.message;}
 ok(!error&&p.output().out.trim()==='{"ok":true}','a probe whose group holds only an unreaped zombie stops cleanly and keeps its output',error);
 const h=existsSync(hpid)?Number(readFileSync(hpid,'utf8')):0;if(h)try{process.kill(h,'SIGKILL');}catch{}}
rmSync(dir,{recursive:true,force:true});end();
