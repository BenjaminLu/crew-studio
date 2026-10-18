// Metadata probes own one detached process group and every pipe byte. Their
// disposable credential home can be removed only after this group is gone.
import { spawn, spawnSync } from 'node:child_process';
/** A probe's process group as `ps -o pgid=,pid=,ppid=,stat=` lists it: gone; zombie when every member has exited and waits
 *  only for Studio (its parent) or launchd (pid 1) to reap it (it holds no file, pipe or credential); live when a member runs,
 *  or when a zombie's parent is any other process: that parent left the group and still runs, so the group's teardown
 *  cannot be verified (fail closed). */
export function probeGroupState(ps:string,pgid:number,self:number):'gone'|'live'|'zombie'{
  const members=ps.split('\n').map(line=>line.trim().split(/\s+/)).filter(f=>Number(f[0])===pgid);
  if(!members.length)return 'gone';
  return members.every(f=>/^Z/.test(f[3]??'')&&(Number(f[2])===self||Number(f[2])===1))?'zombie':'live';
}
export function probeProcess(argv: string[], cwd: string, env: Record<string,string>, onLine?: (value:any)=>void, limits: { timeoutMs?:number; bytes?:number; lineBytes?:number } = {}) {
  const child=spawn(argv[0],argv.slice(1),{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
  const max=limits.bytes??1024*1024,lineMax=limits.lineBytes??128*1024;
  let total=0,out='',err='',buffer='',ended=false,code:number|null=null,failure:string|null=null;
  let resolve:(n:number|null)=>void=()=>{},reject:(e:Error)=>void=()=>{};
  const exited=new Promise<number|null>((yes,no)=>{resolve=yes;reject=no;});
  // The probe caller may be waiting on a RPC rather than process completion.
  exited.catch(()=>{});
  const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  let stopping:Promise<void>|null=null;
  const group=():'gone'|'live'|'zombie'|null=>{if(!child.pid)return 'gone';
    const rows=spawnSync('/bin/ps',['-ax','-o','pgid=,pid=,ppid=,stat='],{encoding:'utf8',maxBuffer:512*1024,timeout:2000});
    if(rows.status!==0||rows.error)return null; // ps could not answer this time (a busy machine): asked again until the deadline
    return probeGroupState(rows.stdout,child.pid,process.pid);
  };
  const stop=()=>stopping??(stopping=(async()=>{
    clearTimeout(timer);
    // EPERM: macOS refuses to signal a group whose members have all exited but are not reaped yet; ps below decides
    if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(e:any){if(e.code!=='ESRCH'&&e.code!=='EPERM')throw new Error('probe group stop unavailable: '+e.code);}}
    // zombies are usually reaped within moments; one still unreaped at the deadline (its reaper is busy) counts as gone
    const until=Date.now()+2000;let state=group();while(state!=='gone'&&Date.now()<until){await new Promise(r=>setTimeout(r,10));state=group();}
    if(state===null)throw new Error('probe group liveness unavailable');
    if(state==='live')throw new Error('probe group death unverified');
    // Killing the owned group does not consume stdout already queued in its
    // pipes. Keep delivering frames until close verifies that both pipes drained.
    await new Promise<void>((resolve,reject)=>{const drain=setTimeout(()=>reject(new Error('probe output drain unverified')),2000);closed.then(()=>{clearTimeout(drain);resolve();});});
    ended=true;child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
    resolve(code);
  })().catch(e=>{reject(e);throw e;}));
  const refuse=(why:string)=>{failure??=why;void stop().catch(()=>{});};
  const timer=setTimeout(()=>refuse('probe deadline expired'),limits.timeoutMs??30000);
  child.on('error',()=>refuse('probe spawn refused'));
  child.stdin.on('error',()=>refuse('probe input closed'));
  child.stdout.on('error',()=>refuse('probe output closed'));
  child.stderr.on('error',()=>refuse('probe output closed'));
  child.on('exit',n=>{code=n;void stop().catch(()=>{});});
  const consume=(chunk:Buffer,isError:boolean)=>{
    if(ended)return;total+=chunk.length;if(total>max){refuse('probe output limit exceeded');return;}
    const text=chunk.toString('utf8');if(isError){err+=text;return;}out+=text;
    if(!onLine)return;buffer+=text;if(Buffer.byteLength(buffer)>lineMax&&!buffer.includes('\n')){refuse('probe line limit exceeded');return;}
    let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(Buffer.byteLength(line)>lineMax){refuse('probe line limit exceeded');return;}if(!line.trim())continue;try{onLine(JSON.parse(line));}catch{}}
  };
  child.stdout.on('data',b=>consume(b,false));child.stderr.on('data',b=>consume(b,true));
  return {pid:child.pid,exited,stop,write(value:unknown){if(!ended&&!stopping)try{child.stdin.write(JSON.stringify(value)+'\n');}catch{refuse('probe input closed');}},output:()=>({out,err,failure}),kill(){void stop().catch(()=>{});}};
}
