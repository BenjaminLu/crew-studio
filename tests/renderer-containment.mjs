import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
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
// The renderer imports Playwright from the path it is given; without PLAYWRIGHT_MODULE use this checkout's own,
// as the other page suites do (a bare run passed the string "undefined" and every mode failed to start).
const playwrightModule=process.env.PLAYWRIGHT_MODULE || import.meta.resolve('playwright');
for(const mode of ['crop','stills','film','page']){
 const out=join(tmp,mode==='stills'?'stills':`${mode}.${mode==='film'?'mp4':'png'}`);
 const args=[script,mode,...(mode==='page'?['--root',input,'--page','film.html']:['--html',join(input,'film.html')]),'--out',out,'--width','200',...(mode==='crop'?['--selector','#stage']:mode==='stills'?['--times','0']:mode==='film'?['--fps','30','--workers','1']:[])];
 const beforeConnections=accepted,beforeMessages=messages;
 const child=spawn(process.execPath,args,{env:{...process.env,CREW_PLAYWRIGHT_MODULE:playwrightModule,CREW_FFMPEG:process.env.CREW_FFMPEG||'ffmpeg'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const timer=setTimeout(()=>child.kill('SIGKILL'),30000);const status=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);const r={status,stdout,stderr};
 let result=null; for(const line of r.stdout.split('\n'))try{const value=JSON.parse(line);if(value.ok!==undefined)result=value}catch{}
 ok(r.status===0&&result?.ok,`${mode}: outside image/frame/fetch/traversal/symlink inputs are blocked while legitimate local assets remain usable`,r.stderr.slice(-300));
 if(mode!=='page'){ok(accepted===beforeConnections&&messages===beforeMessages,`${mode}: planted outside and loopback WebSocket server receives zero connections and messages`);ok(result?.refused?.some(x=>x.startsWith('ws:')&&x.includes('artifact-origin'))&&result.refused.length<=128,`${mode}: WebSocket refusal evidence is bounded and includes artifact-origin sockets`);}
 if(mode==='film'){const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',out],{encoding:'utf8'});ok(probe.status===0&&probe.stdout.trim()==='1920,1080'&&result?.width===1920&&result?.height===1080&&result?.normalized===false,'film: a fixed 16:9 #stage renders an MP4 of exactly 1920x1080 (ffprobe)',JSON.stringify({probe:probe.stdout.trim(),err:probe.stderr.slice(-200),width:result?.width,height:result?.height,normalized:result?.normalized}));}
 if(result?.ok&&mode!=='film'){const rgb=firstPixel(mode==='stills'?join(out,'t0.00.png'):out);ok(rgb[1]>180&&rgb[0]<40,`${mode}: planted outside fixture never changes rendered output`,JSON.stringify(rgb));}
 if(result?.ok)ok(Array.isArray(result.refused)&&result.refused.some(x=>/outside|escape/.test(x)),`${mode}: refused outside inputs remain observable in renderer evidence`);
}
// Older optional Playwright tools must fail before a page is created, not run bare.
const wrapper=join(tmp,'no-websocket-boundary.mjs');
writeFileSync(wrapper, `import {chromium as real} from ${JSON.stringify(playwrightModule)}; export const chromium={launch:async(...args)=>{const browser=await real.launch(...args);return new Proxy(browser,{get(target,key){if(key==='newContext')return async(...args)=>{const ctx=await target.newContext(...args);ctx.routeWebSocket=undefined;return ctx};const value=target[key];return typeof value==='function'?value.bind(target):value}})}};`);
const missing=spawn(process.execPath,[script,'crop','--html',join(input,'film.html'),'--out',join(tmp,'missing.png'),'--selector','#stage'],{env:{...process.env,CREW_PLAYWRIGHT_MODULE:wrapper},stdio:['ignore','pipe','pipe']});let missingError='';missing.stderr.on('data',x=>missingError+=x);const oldConnections=accepted;const missingCode=await new Promise(r=>missing.on('exit',r));
ok(missingCode!==0&&/WebSocket isolation unavailable/.test(missingError)&&accepted===oldConnections,'unavailable WebSocket boundary fails closed before loading any artifact page');

// Film stage shapes: the MP4 is always exactly 1920x1080 (1080x1920), a stage that follows the 16:9
// viewport keeps its whole frame and proportions, only a stage of another shape is forced to 960x540.
const shapes=join(tmp,'shapes');mkdirSync(shapes);
const film=(css,body,extra='')=>`<!doctype html><html><head><style>html,body{margin:0}${css}</style></head><body>${body}<script>const DUR=0.2;let muted=true,startAt=0,ctx=null;function build(){}function schedule(){}function render(t){}${extra}</script></body></html>`;
const shot=(name,html,args=[])=>{const f=join(shapes,`${name}.html`),out=join(shapes,`${name}.mp4`);writeFileSync(f,html);const t0=Date.now();
 const r=spawnSync(process.execPath,[script,'film',...args,'--html',f,'--out',out,'--fps','10','--workers','1'],{env:{...process.env,CREW_PLAYWRIGHT_MODULE:playwrightModule,CREW_FFMPEG:process.env.CREW_FFMPEG||'ffmpeg'},encoding:'utf8',timeout:60000});
 let result=null;for(const line of String(r.stdout).split('\n'))try{const v=JSON.parse(line);if(v.ok!==undefined)result=v}catch{}
 const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',out],{encoding:'utf8'});const [w,h]=probe.status===0?probe.stdout.trim().split(',').map(Number):[0,0];
 const raw=w?spawnSync(process.env.CREW_FFMPEG||'ffmpeg',['-v','error','-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:64*1024*1024}).stdout:null;
 const px=(x,y)=>raw?[...raw.subarray((y*w+x)*3,(y*w+x)*3+3)]:[0,0,0];
 return {result,w,h,px,ms:Date.now()-t0,status:r.status};};
const blue=p=>p[2]>180&&p[0]<60, red=p=>p[0]>180&&p[2]<60;
const fit=shot('scale-to-fit',film('#stage{position:relative;width:1920px;height:1080px;background:#08f;transform-origin:0 0}#corner{position:absolute;right:0;bottom:0;width:120px;height:120px;background:#f00}','<div id="stage"><div id="corner"></div></div>','function fit(){document.getElementById("stage").style.transform="scale("+(innerWidth/1920)+")"}fit();addEventListener("resize",fit)'));
ok(fit.w===1920&&fit.h===1080&&fit.result?.normalized===false&&red(fit.px(1890,1050))&&blue(fit.px(960,540))&&blue(fit.px(30,30)),'film: a scale-to-fit 1920x1080 stage keeps its whole frame (bottom-right corner present) at exactly 1920x1080',JSON.stringify({w:fit.w,h:fit.h,n:fit.result?.normalized,corner:fit.px(1890,1050),center:fit.px(960,540)}));
const vw=shot('viewport-units',film('#stage{position:relative;width:100vw;height:100vh;background:#08f}#bar{position:absolute;left:0;top:0;width:50vw;height:10vh;background:#f00}','<div id="stage"><div id="bar"></div></div>'));
ok(vw.w===1920&&vw.h===1080&&vw.result?.normalized===false&&red(vw.px(930,50))&&blue(vw.px(990,50))&&red(vw.px(50,98))&&blue(vw.px(50,118)),'film: a 100vw/100vh stage keeps vw/vh proportions (a 50vw x 10vh bar stays 960x108 of 1920x1080)',JSON.stringify({w:vw.w,h:vw.h,in:vw.px(930,50),out:vw.px(990,50)}));
const r035=shot('r035',film('#stage{width:100%;height:100vh;background:#08f}','<div id="stage"><h1>R-035</h1></div>'));
ok(r035.w===1920&&r035.h===1080&&blue(r035.px(1900,1060)),'film: the R-035 #stage{width:100%;height:100vh} renders exactly 1920x1080 edge to edge');
const square=shot('square',film('#stage{width:800px;height:800px;background:#08f}','<div id="stage"></div>'));
ok(square.w===1920&&square.h===1080&&square.result?.normalized===true&&square.result.notes.some(n=>/stage normalized: #stage measured 800x800, not 16:9 or a fixed 9:16; forced to 960x540/.test(n))&&blue(square.px(1900,1060)),'film: a fixed 800x800 stage is forced to 960x540 with the normalization note and fills 1920x1080',JSON.stringify(square.result?.notes));
const empty=shot('zero-box',film('#stage{position:absolute}#stage div{position:absolute;width:960px;height:540px;background:#08f}','<div id="stage"><div></div></div>'));
ok(empty.status===0&&empty.w===1920&&empty.h===1080&&empty.result?.normalized===true&&empty.ms<25000,'film: a 0x0 #stage with absolute children is normalized instead of timing out',JSON.stringify({ms:empty.ms,notes:empty.result?.notes}));
const none=shot('no-stage',film('','<div><h1>no stage</h1></div>'));
ok(none.status!==0&&none.result?.ok===false&&none.result.code==='no-stage'&&/no #stage/.test(none.result.error)&&none.ms<20000,'film: a film without #stage fails fast with code no-stage',JSON.stringify({ms:none.ms,r:none.result}));
const tall=shot('portrait-fixed',film('#stage{width:540px;height:960px;background:#08f}','<div id="stage"></div>'));
ok(tall.w===1080&&tall.h===1920&&tall.result?.normalized===false&&tall.result.notes.some(n=>/portrait: #stage is a fixed 9:16 box \(540x960\)/.test(n))&&blue(tall.px(1060,1900)),'film: a fixed 540x960 stage renders exactly 1080x1920 with a portrait note',JSON.stringify(tall.result?.notes));
const flag=shot('orient-flag-ignored',film('#stage{width:100vw;height:100vh;background:#08f}','<div id="stage"></div>'),['--orient','portrait']);
ok(flag.w===1920&&flag.h===1080&&!flag.result?.notes?.length,'film: a responsive stage is 1920x1080; no flag or guess turns it portrait');
const short=shot('one-frame',film('#stage{width:960px;height:540px;background:#08f}','<div id="stage"></div>').replace('DUR=0.2','DUR=0.01').replace('function build(){}','function build(){ctx=new AudioContext()}'),['--fps','1']);
ok(short.w===1920&&short.h===1080,'film: a film shorter than one frame, with audio, still has a video stream');

for(const socket of sockets)socket.destroy();await new Promise(r=>wsServer.close(r));
console.log(`renderer-containment: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
