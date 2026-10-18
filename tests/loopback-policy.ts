import "./lib/isolated-env.mjs";
import { strict as assert } from 'node:assert';
import { profileFor, parseListeningPorts } from '../src/runtime/checks';
const p = profileFor({out:'/private/tmp/out',tmp:'/private/tmp/tmp',reads:[],network:false,localBinding:true,blockedPorts:[43210]} as any);
assert(p.includes('(deny network-outbound (remote ip "localhost:43210"))'), 'snapshot listener must be explicitly denied');
for (const n of [4210,43000,43063]) {
 assert(p.includes(`(deny network-outbound (remote ip "localhost:${n}"))`), `reserved port ${n} outbound denied`);
 assert(p.includes(`(deny network-bind network-inbound (local ip "localhost:${n}"))`), `reserved port ${n} binding/inbound denied`);
}
assert.throws(()=>profileFor({out:'/tmp/out',tmp:'/tmp/tmp',reads:[],network:false,localBinding:true,blockedPorts:null} as any), /listener/i);
console.log('loopback profile deny policy passed');

assert.deepEqual(parseListeningPorts('Proto Recv-Q Send-Q Local Address Foreign Address (state)\ntcp46 0 0 *.12345 *.* LISTEN\ntcp6 0 0 ::1.54321 *.* LISTEN\ntcp4 0 0 127.0.0.1.12345 *.* LISTEN'),[12345,54321]);
