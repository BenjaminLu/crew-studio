import "./lib/isolated-env.mjs";
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, networkInterfaces } from "node:os";
import { roundProfile } from "../src/runtime/checks";
import { BROKER_PORTS } from "../src/loopback-ports";

// Actual Seatbelt admission, not a profile-string assertion. Both listeners start
// after both profiles are compiled. No Studio/model listener or real credential.
assert.equal(process.platform, "darwin", "this gate requires actual macOS Seatbelt");
const root = mkdtempSync(join(tmpdir(), "crew-round-admission-"));
const tmp = join(root, "tmp"); mkdirSync(tmp);
const [portA, portB] = BROKER_PORTS.slice(-4, -2);
assert(portA && portB && portA !== portB);
for (const [name, port] of [["A", portA], ["B", portB]] as const) {
  writeFileSync(join(root, name + ".sb"), roundProfile({ cwd: root, tmp, writes: [root], reads: [root], proxyPort: port, toolPort: port }));
}
const servers: Server[] = [];
async function fixture(port: number, label: string) {
  const s = createServer(c => {
    c.once("data", () => c.end("HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n" + label));
    c.on("error", () => c.destroy());
  });
  servers.push(s);
  await new Promise<void>((r,j) => { s.once("error",j); s.listen({ port, host: "::", ipv6Only: false },r); });
}
const probe = String.raw`
const net=require('node:net');
const dial=(host,port)=>new Promise(r=>{
 const s=net.connect({host,port});let body='';let settled=false;
 const done=x=>{if(settled)return;settled=true;s.destroy();r(x)};
 s.setTimeout(1000,()=>done('timeout'));
 s.once('connect',()=>s.write('CONNECT dummy.invalid:443 HTTP/1.1\r\nHost: dummy.invalid:443\r\n\r\n'));
 s.on('data',c=>body+=c);s.once('end',()=>done(body));s.once('error',e=>done(e.code));
});
(async()=>{const result=[];for(const host of JSON.parse(process.argv[1]))for(const port of JSON.parse(process.argv[2]))result.push([host,port,await dial(host,port)]);console.log(JSON.stringify({started:true,result}))})().catch(e=>{console.error(e);process.exit(1)});`;
async function execute(hosts: string[], profile?: string) {
  const args = [process.execPath, "-e", probe, JSON.stringify(hosts), JSON.stringify([portA,portB])];
  const p = Bun.spawn(profile ? ["/usr/bin/sandbox-exec", "-f", profile, ...args] : args, { cwd: root, stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin" } });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  assert.equal(code,0,`child must start: ${stderr}`);
  const parsed = JSON.parse(stdout); assert.equal(parsed.started,true);
  return parsed.result as [string,number,string][];
}
try {
  await fixture(portA,"A"); await fixture(portB,"B");
  const candidates = ["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1", ...Object.values(networkInterfaces()).flat().filter(x=>x&&!x.internal&&x.family==="IPv4").map(x=>x!.address)];
  const baseline = await execute(candidates);
  const hosts = candidates.filter(h=>baseline.filter(x=>x[0]===h).every(x=>/^HTTP\/1\.1 200 OK/.test(x[2])));
  const unreachableHostAliases = candidates.filter(h=>!hosts.includes(h));
  assert(["127.0.0.1","localhost","::1","::ffff:127.0.0.1"].every(h=>hosts.includes(h)), "all loopback spellings need unsandboxed positive controls");
  assert(hosts.some(h=>h!=="localhost"&&!h.includes(":")&&!h.startsWith("127.")), "at least one LAN alias needs a positive control");
  const [a,b] = await Promise.all([execute(hosts,join(root,"A.sb")),execute(hosts,join(root,"B.sb"))]);
  for (const [name, own, other, rows] of [["A",portA,portB,a],["B",portB,portA,b]] as const) {
    for (const host of hosts) {
      const positive = rows.find(x=>x[0]===host&&x[1]===own)?.[2];
      const negative = rows.find(x=>x[0]===host&&x[1]===other)?.[2];
      if (host === "::ffff:127.0.0.1") assert(["EPERM","ECONNREFUSED"].includes(positive??""), `${name} mapped own address is not admitted by Seatbelt localhost tcp`);
      else assert.equal(positive, "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n"+name, `${name} own relay must answer via ${host}`);
      assert(["EPERM","ECONNREFUSED"].includes(negative??""),`${name} cross-round relay blocked via ${host}: ${negative}`);
    }
  }
  console.log(JSON.stringify({ports:{A:portA,B:portB},profilesCompiledBeforeListeners:true,mappedOwnAlias:"not admitted by Seatbelt localhost tcp",hosts,unreachableHostAliases,roundA:a,roundB:b},null,2));
} finally { for(const s of servers) await new Promise<void>(r=>s.close(()=>r())); }
