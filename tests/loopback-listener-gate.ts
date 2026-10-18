import './lib/isolated-env.mjs';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { profileFor, inspectListeningPorts, selfProbe, sandboxed, parseListeningPorts } from '../src/runtime/checks';
import { BROKER_PORTS } from '../src/loopback-ports';
assert.equal(process.platform,'darwin','actual macOS test required');
delete process.env.CREW_LOCAL_UNRESTRICTED;
const root=mkdtempSync(join(tmpdir(),'crew-listener-gate-')), out=join(root,'out'),tmp=join(root,'tmp');
mkdirSync(out);mkdirSync(tmp);
const servers: ReturnType<typeof createServer>[]=[];
async function listen(port=0) {const s=createServer(c=>c.end('fixture'));servers.push(s);await new Promise<void>((r,j)=>{s.once('error',j);s.listen(port,'::',r)});return (s.address() as any).port as number;}
try {
 const existing=await listen(); process.env.CREW_PORT=String(existing);
 const snapshot=inspectListeningPorts();assert(snapshot.includes(existing),'live listener captured');
 assert.throws(()=>parseListeningPorts(''),/header/);
 assert.throws(()=>parseListeningPorts('Proto Recv-Q Send-Q Local Address Foreign Address (state)\ntcp4 0 0 broken *.* LISTEN'),/parse/);
 const profile=join(root,'profile.sb');writeFileSync(profile,profileFor({out,tmp,reads:[root],cwd:root,network:false,localBinding:true,blockedPorts:snapshot}));
 // Future listener proves protection does not depend on the snapshot seeing it.
 const futurePort=43062; assert(!snapshot.includes(futurePort),'reserved future fixture port initially free');
 await listen(futurePort);
 const probe=String.raw`
 const net=require('node:net'),http=require('node:http');
 const connect=(host,port)=>new Promise(r=>{const s=net.connect({host,port});s.setTimeout(800);s.once('connect',()=>{s.destroy();r(true)});s.once('error',e=>r(e.code));s.once('timeout',()=>{s.destroy();r('timeout')})});
 (async()=>{const own=http.createServer((q,r)=>r.end('owned'));await new Promise((r,j)=>{own.once('error',j);own.listen(0,'127.0.0.1',r)});const body=await new Promise((r,j)=>http.get('http://127.0.0.1:'+own.address().port,x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>r(b))}).on('error',j));await new Promise(r=>own.close(r));const results=[];for(const host of JSON.parse(process.argv[1]))for(const port of JSON.parse(process.argv[2]))results.push([host,port,await connect(host,port)]);const binds=[];for(const port of [4210,43000,43031,43063])binds.push(await new Promise(r=>{const s=net.createServer();s.once('error',e=>r([port,e.code]));s.listen(port,'127.0.0.1',()=>s.close(()=>r([port,true])))}));console.log(JSON.stringify({started:true,body,results,binds}))})().catch(e=>{console.error(e);process.exit(1)});`;
 let hosts=['127.0.0.1','localhost','::1','::ffff:127.0.0.1',...Object.values(networkInterfaces()).flat().filter(x=>x&&!x.internal&&x.family==='IPv4').map(x=>x!.address)];
 const baselineCode=`const net=require('node:net');(async()=>{const r=[];for(const host of JSON.parse(process.argv[1]))for(const port of JSON.parse(process.argv[2]))r.push(await new Promise(y=>{const s=net.connect({host,port});s.setTimeout(1000);s.once('connect',()=>{s.destroy();y(true)});s.once('error',e=>y(e.code));s.once('timeout',()=>{s.destroy();y('timeout')})}));console.log(JSON.stringify(r))})();`;
 const baseline=Bun.spawnSync([process.execPath,'-e',baselineCode,JSON.stringify(hosts),JSON.stringify([existing,futurePort])],{stdout:'pipe',stderr:'pipe',cwd:root,timeout:20000});
 assert(baseline.success,`unsandboxed fixture positive control started: ${baseline.stderr}`);
 const positive=JSON.parse(baseline.stdout.toString());
 const unreachable=hosts.filter((h,i)=>positive[i*2]!==true||positive[i*2+1]!==true);
 hosts=hosts.filter((h,i)=>positive[i*2]===true&&positive[i*2+1]===true);
 assert(['127.0.0.1','localhost','::1','::ffff:127.0.0.1'].every(h=>hosts.includes(h)),'all loopback spellings reachable without sandbox');
 assert(hosts.some(h=>h!=='localhost'&&!h.includes(':')&&!h.startsWith('127.')),'at least one live LAN alias positive control');
 const r=Bun.spawnSync(['/usr/bin/sandbox-exec','-f',profile,process.execPath,'-e',probe,JSON.stringify(hosts),JSON.stringify([existing,futurePort])],{stdout:'pipe',stderr:'pipe',env:{PATH:'/usr/bin:/bin'},cwd:root,timeout:20000});
 assert(r.success,`sandbox child must start: ${r.stderr}`);const p=JSON.parse(r.stdout.toString());
 assert(p.started&&p.body==='owned','positive HTTP control proves running sandbox permits own server');
 assert(p.results.every((x:any[])=>['EPERM','ECONNREFUSED'].includes(x[2])),JSON.stringify(p.results));
 assert(p.binds.every((x:any[])=>x[1]==='EPERM'),JSON.stringify(p.binds));
 assert.equal(selfProbe(profile,[],[existing]),null,'production probe passes with own HTTP and blocked listeners');
 const broken=join(root,'broken.sb');writeFileSync(broken,'not valid seatbelt');assert.match(selfProbe(broken,[],[existing])??'',/could not run/,'sandbox startup failure never passes');
 const noBinding=join(root,'no-bind.sb');writeFileSync(noBinding,profileFor({out,tmp,reads:[root],cwd:root,network:false}));assert.match(selfProbe(noBinding,[],[existing])??'',/positive loopback control failed/,'no-network profile never false-passes');
 const s=await sandboxed([process.execPath,'-e','console.log("PRODUCTION_STARTED")'],{cwd:root,out:join(root,'out2'),tmp:join(root,'tmp2'),network:false,testRun:true,timeoutS:20});
 assert(!s.refused&&s.code===0&&s.stdout.includes('PRODUCTION_STARTED'),JSON.stringify(s));
 assert(BROKER_PORTS.every(n=>require('node:fs').readFileSync(profile,'utf8').includes(`localhost:${n}`)));
 console.log(JSON.stringify({positive:'own HTTP passed',snapshotListener:existing,futureReservedListener:futurePort,hosts,unreachableHostAliases:unreachable,connections:p.results,binds:p.binds,productionSandbox:'started'},null,2));
}finally{for(const s of servers)await new Promise<void>(r=>s.close(()=>r()));}
