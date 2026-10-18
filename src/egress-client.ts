// Untrusted CLIs know a per-job loopback URL, never the upstream proxy credential.
// Seatbelt clients may reach their own port only; test profiles deny this entire
// reserved range, including listeners created after the test profile was compiled.
import { randomBytes } from 'node:crypto';
import { createServer, connect, type Socket } from 'node:net';
export const BROKER_PORTS = Object.freeze(Array.from({length:64},(_,i)=>43000+i));
export type ProxyAuthority={port:number;open(t:string,hosts:string[]):void;close(t:string):void};
export async function openScopedProxy(egress:ProxyAuthority,hosts:string[]) {
  if(!Number.isInteger(egress.port)||egress.port<1)throw new Error('egress upstream is unavailable');
  const token=randomBytes(24).toString('hex'),sockets=new Set<Socket>();let closed=false;
  egress.open(token,hosts);
  const server=createServer(client=>{
    if(closed||sockets.size>=64){client.destroy();return;}
    const own=(s:Socket)=>{sockets.add(s);s.once('close',()=>sockets.delete(s));s.on('error',()=>s.destroy());};own(client);
    client.setTimeout(10000,()=>client.destroy());
    let head=Buffer.alloc(0);
    const read=(chunk:Buffer)=>{
      head=Buffer.concat([head,chunk]);const end=head.indexOf('\r\n\r\n');
      if(end<0){if(head.length>16384)client.destroy();return;}
      if(end>16384){client.destroy();return;}
      client.off('data',read);client.pause();
      const lines=head.subarray(0,end).toString('latin1').split('\r\n');
      if(!/^[A-Z]+ \S+ HTTP\/1\.[01]$/.test(lines[0])){client.destroy();return;}
      const clean=lines.filter(line=>!/^proxy-authorization\s*:/i.test(line));
      clean.push(`Proxy-Authorization: Basic ${Buffer.from('round:'+token).toString('base64')}`);
      const up=connect(egress.port,'127.0.0.1');own(up);up.setTimeout(10000,()=>up.destroy());
      const destroy=()=>{client.destroy();up.destroy();};client.once('close',()=>up.destroy());up.once('close',()=>client.destroy());
      up.once('error',destroy);client.once('error',destroy);
      up.once('connect',()=>{
        if(closed){destroy();return;}
        client.setTimeout(120000,destroy);up.setTimeout(120000,destroy);
        up.write(Buffer.concat([Buffer.from(clean.join('\r\n')+'\r\n\r\n','latin1'),head.subarray(end+4)]));
        head=Buffer.alloc(0);client.pipe(up);up.pipe(client);client.resume();
      });
    };client.on('data',read);
  });
  const close=()=>{if(closed)return;closed=true;egress.close(token);for(const s of sockets)s.destroy();server.close();};
  try{
    let port=0;
    for(const candidate of BROKER_PORTS){
      const started=await new Promise<boolean>((resolve,reject)=>{
        const error=(e:NodeJS.ErrnoException)=>{server.off('listening',ready);if(e.code==='EADDRINUSE')resolve(false);else reject(e);};
        const ready=()=>{server.off('error',error);resolve(true);};server.once('error',error);server.once('listening',ready);server.listen(candidate,'127.0.0.1');
      });
      if(started){port=candidate;break;}
    }
    if(!port)throw new Error('egress broker port reservation exhausted');
    return{port,url:`http://127.0.0.1:${port}`,close};
  }catch(error){close();throw error;}
}
