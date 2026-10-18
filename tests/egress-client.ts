import "./lib/isolated-env.mjs";
import { strict as assert } from 'node:assert';
import { createServer, connect } from 'node:net';
import { Egress } from '../src/egress';
import { openScopedProxy, BROKER_PORTS } from '../src/egress-client';
const { denial, guardedLookup } = await import('../src/egress-guard');
assert(denial('127.0.0.1','127.0.0.1',[]) !== null, 'literal loopback never bypasses proxy guard');
assert(denial('localhost','127.0.0.1',[]) !== null, 'localhost never bypasses proxy guard');
assert('refused' in await guardedLookup('127.0.0.1'), 'literal resolution enforces guard too');
const seen:string[]=[];const grants=new Set<string>();
const upstream=createServer(socket=>{let head='';socket.on('data',b=>{head+=b;if(!head.includes('\r\n\r\n'))return;const auth=/Proxy-Authorization: Basic ([^\r]+)/i.exec(head)?.[1];const token=auth?Buffer.from(auth,'base64').toString().slice(6):'';seen.push(token);socket.end(grants.has(token)?'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok':'HTTP/1.1 407 Refused\r\n\r\n');});});
await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
const eg={port:(upstream.address() as any).port,open(t:string,_h:string[]){grants.add(t);},close(t:string){grants.delete(t);}};
const ask=(port:number)=>new Promise<string>((resolve,reject)=>{let out='';const s=connect(port,'127.0.0.1',()=>s.write('GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: Basic attacker\r\n\r\n'));s.on('data',b=>out+=b);s.on('end',()=>resolve(out));s.on('error',reject);});
let a:Awaited<ReturnType<typeof openScopedProxy>>|undefined,b:typeof a;
try{
 a=await openScopedProxy(eg,['example.com']);b=await openScopedProxy(eg,['other.example']);
 assert(BROKER_PORTS.includes(a.port)&&BROKER_PORTS.includes(b.port)&&a.port!==b.port);
 assert.equal(new URL(a.url).username,'');assert.equal(new URL(a.url).password,'');
 assert.match(await ask(a.port),/200 OK/);assert.match(await ask(b.port),/200 OK/);
 assert.equal(seen.length,2);assert(seen.every(t=>grants.has(t)));assert.notEqual(seen[0],seen[1]);assert(!JSON.stringify([a.url,b.url]).includes(seen[0]));
 a.close();a=undefined;assert.equal(grants.size,1);
 console.log('egress-client: credential-free client URL, private per-job upstream auth, reserved ports, revocation passed');
}finally{a?.close();b?.close();await new Promise<void>(r=>upstream.close(()=>r()));}

// Real TCP lifecycle, with a trusted injected dialer mapping a permitted public
// destination to a local fixture. No external request/DNS/model call is made.
const destination=createServer();await new Promise<void>(r=>destination.listen(0,'127.0.0.1',r));
const central=new Egress(null,()=>connect((destination.address() as any).port,'127.0.0.1'));
await central.start();central.open('dummy-revoke',['1.1.1.1']);
const live=connect(central.port,'127.0.0.1');
try{
 const opened=new Promise<void>((resolve,reject)=>{live.on('data',b=>{if(b.toString().includes('200 Connection Established'))resolve();});live.on('error',reject);});
 live.write('CONNECT 1.1.1.1:443 HTTP/1.1\r\nProxy-Authorization: Basic '+Buffer.from('round:dummy-revoke').toString('base64')+'\r\n\r\n');
 await opened;const closed=new Promise<void>(r=>live.once('close',()=>r()));central.close('dummy-revoke');
 await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('revoked tunnel survived')),2000))]);
 assert.equal(central.status().rounds,0);console.log('egress-client: central revocation tears down an already-open tunnel');
}finally{live.destroy();central.stop();await new Promise<void>(r=>destination.close(()=>r()));}
