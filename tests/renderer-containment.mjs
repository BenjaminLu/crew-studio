// Renderer containment uses planted outside fixtures only: no real private reads.
// Native web crops and film/stills share the same canonical input-root origin.
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), tmp = mkdtempSync(join(tmpdir(), 'crew-render-containment-'));
const input = join(tmp, 'artifact'), outside = join(tmp, 'outside'); mkdirSync(input); mkdirSync(outside);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17"><rect width="17" height="17" fill="blue"/></svg>';
writeFileSync(join(input, 'local.svg'), svg); writeFileSync(join(outside, 'outside.svg'), svg);
writeFileSync(join(outside, 'outside.html'), '<script>parent.postMessage("fixture-outside-frame-loaded","*")</script><p>Planted outside fixture</p>');
writeFileSync(join(outside, 'memo.txt'), 'Planted outside text fixture'); symlinkSync(outside, join(input, 'escape'));
const outsideImage = pathToFileURL(join(outside, 'outside.svg')).href, outsideFrame = pathToFileURL(join(outside, 'outside.html')).href;
let accepted = 0, messages = 0; const sockets = new Set();
const wsServer = createServer((req,res)=>{res.writeHead(404);res.end()});
wsServer.on('upgrade',(req,socket)=>{ accepted++; sockets.add(socket); const key=createHash('sha1').update(String(req.headers['sec-websocket-key'])+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);socket.on('data',b=>{if((b[0]&15)===1||(b[0]&15)===2)messages++});socket.on('close',()=>sockets.delete(socket)); });
await new Promise(r=>wsServer.listen(0,'127.0.0.1',r));const wsPort=wsServer.address().port;
const html = `<!doctype html><html><head><style>html,body{margin:0}#stage{width:200px;height:112px;background:rgb(10,210,30)}img,iframe{display:none}</style></head><body><div id="stage"><img id="local" src="local.svg"><img src="${outsideImage}" onload="unsafe()"><img src="${outsideImage.replace('outside.svg','%6futside.svg')}" onload="unsafe()"><img src="escape/outside.svg" onload="unsafe()"><iframe src="${outsideFrame}"></iframe></div><script>
for(const url of ['ws://127.0.0.1:${wsPort}/outside','ws://localhost:${wsPort}/loopback',location.origin.replace(/^http/,'ws')+'/artifact-origin']){const ws=new WebSocket(url);ws.onopen=()=>ws.send('planted fixture message')}
for(let i=0;i<160;i++)new WebSocket('ws://127.0.0.1:${wsPort}/bounded/'+i);
let violated=false; function unsafe(){violated=true; document.getElementById('stage').style.background='rgb(230,10,20)'}
addEventListener('message',e=>{if(e.data==='fixture-outside-frame-loaded')unsafe()});
fetch('${pathToFileURL(join(outside,'memo.txt')).href}').then(r=>r.text()).then(unsafe).catch(()=>{});
fetch('/..%2foutside/memo.txt').then(r=>{if(r.ok)unsafe()}).catch(()=>{});
fetch('https://example.invalid/unreachable').then(unsafe).catch(()=>{});
const DUR=.1;let muted=true,startAt=0,ctx=null;function build(){ctx=new AudioContext()}function schedule(){}
function render(t){if(violated)throw Error('outside artifact input loaded');if(!document.getElementById('local').naturalWidth)throw Error('legitimate local asset blocked')}
</script></body></html>`;
writeFileSync(join(input, 'film.html'), html);
let pass=0, fail=0; const ok=(condition,label,extra='')=>{ if(condition){pass++;console.log('PASS '+label)}else{fail++;console.log('FAIL '+label+' '+extra)} };
// Read the first RGB pixel of a PNG, handling standard byte filters (no library).
const firstPixel = p => { const b=readFileSync(p), chunks=[];let pos=8,width=0,channels=0;while(pos<b.length){const n=b.readUInt32BE(pos),k=b.subarray(pos+4,pos+8).toString();if(k==='IHDR'){width=b.readUInt32BE(pos+8);channels=b[pos+17]===6?4:3;if(b[pos+16]!==8)throw Error('8-bit PNG required')}if(k==='IDAT')chunks.push(b.subarray(pos+8,pos+8+n));pos+=12+n;}const raw=inflateSync(Buffer.concat(chunks)), f=raw[0];if(![0,1,2,3,4].includes(f)||!width||!channels)throw Error('bad PNG');return [...raw.subarray(1,4)]; };
const script=process.env.CREW_TEST_RENDERER_SCRIPT || join(root,'src/render/render.mjs');
for(const mode of ['crop','stills','film','page']){
 const out=join(tmp,mode==='stills'?'stills':`${mode}.${mode==='film'?'mp4':'png'}`);
 const args=[script,mode,...(mode==='page'?['--root',input,'--page','film.html']:['--html',join(input,'film.html')]),'--out',out,'--width','200',...(mode==='crop'?['--selector','#stage']:mode==='stills'?['--times','0']:mode==='film'?['--fps','30','--workers','1']:[])];
 const beforeConnections=accepted,beforeMessages=messages;
 const child=spawn(process.execPath,args,{env:{...process.env,CREW_PLAYWRIGHT_MODULE:process.env.PLAYWRIGHT_MODULE,CREW_FFMPEG:process.env.CREW_FFMPEG||'ffmpeg'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const timer=setTimeout(()=>child.kill('SIGKILL'),30000);const status=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);const r={status,stdout,stderr};
 let result=null; for(const line of r.stdout.split('\n'))try{const value=JSON.parse(line);if(value.ok!==undefined)result=value}catch{}
 ok(r.status===0&&result?.ok,`${mode}: outside image/frame/fetch/traversal/symlink inputs are blocked while legitimate local assets remain usable`,r.stderr.slice(-300));
 if(mode!=='page'){ok(accepted===beforeConnections&&messages===beforeMessages,`${mode}: planted outside and loopback WebSocket server receives zero connections and messages`);ok(result?.refused?.some(x=>x.startsWith('ws:')&&x.includes('artifact-origin'))&&result.refused.length<=128,`${mode}: WebSocket refusal evidence is bounded and includes artifact-origin sockets`);}
 if(mode==='film'){const probe=spawnSync(process.env.CREW_FFPROBE||'ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',out],{encoding:'utf8'});ok(probe.status===0&&probe.stdout.trim()==='1920,1080'&&result?.width===1920&&result?.height===1080&&result?.normalized===false,'film: a fixed 16:9 #stage renders an MP4 of exactly 1920x1080 (ffprobe)',JSON.stringify({probe:probe.stdout.trim(),err:probe.stderr.slice(-200),width:result?.width,height:result?.height,normalized:result?.normalized}));}
 if(result?.ok&&mode!=='film'){const rgb=firstPixel(mode==='stills'?join(out,'t0.00.png'):out);ok(rgb[1]>180&&rgb[0]<40,`${mode}: planted outside fixture never changes rendered output`,JSON.stringify(rgb));}
 if(result?.ok)ok(Array.isArray(result.refused)&&result.refused.some(x=>/outside|escape/.test(x)),`${mode}: refused outside inputs remain observable in renderer evidence`);
}
// Older optional Playwright tools must fail before a page is created, not run bare.
const wrapper=join(tmp,'no-websocket-boundary.mjs');
writeFileSync(wrapper, `import {chromium as real} from ${JSON.stringify(process.env.PLAYWRIGHT_MODULE)}; export const chromium={launch:async(...args)=>{const browser=await real.launch(...args);return new Proxy(browser,{get(target,key){if(key==='newContext')return async(...args)=>{const ctx=await target.newContext(...args);ctx.routeWebSocket=undefined;return ctx};const value=target[key];return typeof value==='function'?value.bind(target):value}})}};`);
const missing=spawn(process.execPath,[script,'crop','--html',join(input,'film.html'),'--out',join(tmp,'missing.png'),'--selector','#stage'],{env:{...process.env,CREW_PLAYWRIGHT_MODULE:wrapper},stdio:['ignore','pipe','pipe']});let missingError='';missing.stderr.on('data',x=>missingError+=x);const oldConnections=accepted;const missingCode=await new Promise(r=>missing.on('exit',r));
ok(missingCode!==0&&/WebSocket isolation unavailable/.test(missingError)&&accepted===oldConnections,'unavailable WebSocket boundary fails closed before loading any artifact page');

for(const socket of sockets)socket.destroy();await new Promise(r=>wsServer.close(r));
console.log(`renderer-containment: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
