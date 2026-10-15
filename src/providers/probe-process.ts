// Metadata probes own one detached process group and every pipe byte. Their
// disposable credential home can be removed only after this group is gone.
import { spawn, spawnSync } from 'node:child_process';
export function probeProcess(argv: string[], cwd: string, env: Record<string,string>, onLine?: (value:any)=>void, limits: { timeoutMs?:number; bytes?:number; lineBytes?:number } = {}) {
  const child=spawn(argv[0],argv.slice(1),{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
  const max=limits.bytes??1024*1024,lineMax=limits.lineBytes??128*1024;
  let total=0,out='',err='',buffer='',ended=false,code:number|null=null,failure:string|null=null;
  let resolve:(n:number|null)=>void=()=>{},reject:(e:Error)=>void=()=>{};
  const exited=new Promise<number|null>((yes,no)=>{resolve=yes;reject=no;});
  // The probe caller may be waiting on a RPC rather than process completion.
  exited.catch(()=>{});
  let stopping:Promise<void>|null=null;
  const alive=()=>{if(!child.pid)return false;
    const rows=spawnSync('/bin/ps',['-ax','-o','pgid=,pid=,stat='],{encoding:'utf8',maxBuffer:512*1024,timeout:500});
    if(rows.status!==0||rows.error)throw new Error('probe group liveness unavailable');
    return rows.stdout.split('\n').some(line=>{const fields=line.trim().split(/\s+/);return Number(fields[0])===child.pid;});
  };
  const stop=()=>stopping??(stopping=(async()=>{
    ended=true;clearTimeout(timer);
    if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(e:any){if(e.code!=='ESRCH')throw new Error('probe group stop unavailable: '+e.code);}}
    const until=Date.now()+2000;while(alive()&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
    if(alive())throw new Error('probe group death unverified');
    child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
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
  return {pid:child.pid,exited,stop,write(value:unknown){if(!ended)try{child.stdin.write(JSON.stringify(value)+'\n');}catch{refuse('probe input closed');}},output:()=>({out,err,failure}),kill(){void stop().catch(()=>{});}};
}
