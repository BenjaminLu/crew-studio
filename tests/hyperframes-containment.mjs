import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Real Chromium page-guard controls. No outer OS file/network containment claim.
// Planted local HTTP/WS/file targets only; no vendor request.
import{createServer}from'node:http';import{spawn}from'node:child_process';import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createRequire}from'node:module';import{createHash}from'node:crypto';
const cwd=new URL('..',import.meta.url).pathname,node=join(cwd,'node_modules/node/bin/node'),cli=join(cwd,'node_modules/hyperframes/bin/hyperframes.mjs'),guard=join(cwd,'src/render/hyperframes-guard.mjs');
const browser=process.env.CREW_HF_BROWSER;if(!browser)throw new Error('Set CREW_HF_BROWSER to the installed browser executable');
if(process.argv.includes('--child')){
 const require=createRequire(cli),puppeteer=(await import(require.resolve('puppeteer-core'))).default;
 const b=await puppeteer.launch({headless:true,executablePath:browser,userDataDir:join(process.env.HOME,'browser-profile'),pipe:true});
 try{
  const page=await b.newPage();await page.goto(`http://127.0.0.1:${process.env.CREW_HF_PORT}`,{waitUntil:'load'});
  const text=await page.$eval('h1',e=>e.textContent);if(text!=='Local coffee')throw new Error('legitimate local page missing');
  await new Promise(r=>setTimeout(r,250));
  let outside=false;try{await page.goto(`file://${process.env.CREW_HF_OUTSIDE}`);outside=(await page.content()).includes('PLANTED_OUTSIDE');}catch{}
  console.log(JSON.stringify({local:true,outside}));
 }finally{await b.close();}
}else{
 let passed=0,failed=0;const ok=(v,s)=>{console.log(`${v?'ok':'FAIL'} ${s}`);v?passed++:failed++;};
 const root=mkdtempSync(join(tmpdir(),'crew-hf-containment-')),outside=join(root,'outside.html'),project=join(root,'project');
 const{mkdirSync}=await import('node:fs');mkdirSync(project);writeFileSync(outside,'<h1>PLANTED_OUTSIDE</h1>');
 let http=0,ws=0,ownWS=0;
 const external=createServer((q,r)=>{http++;r.setHeader('access-control-allow-origin','*');r.end('planted');});
 external.on('upgrade',(q,s)=>{ws++;const key=createHash('sha1').update(String(q.headers['sec-websocket-key'])+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');s.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);});
 await new Promise(r=>external.listen(0,'127.0.0.1',r));const other=external.address().port;
 const server=createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(`<h1>Local coffee</h1><img src="http://127.0.0.1:${other}/planted.png"><script>fetch('http://127.0.0.1:${other}/planted');new WebSocket('ws://127.0.0.1:${other}');new WebSocket('ws://127.0.0.1:'+location.port);</script>`);});
 server.on('upgrade',(q,s)=>{ownWS++;s.destroy();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const run=async enabled=>{
  const {probeProcess}=await import('../src/providers/probe-process.ts');
  const home=join(root,enabled?'guard-home':'control-home'),temp=join(home,'tmp');mkdirSync(home);mkdirSync(temp);
  const p=probeProcess([node,...(enabled?['--import',guard]:[]),import.meta.filename,'--child'],project,{PATH:process.env.PATH||'/usr/bin:/bin',HOME:home,CFFIXED_USER_HOME:home,TMPDIR:temp,MAC_CHROMIUM_TMPDIR:temp,CREW_HF_BROWSER:browser,CREW_HF_ROOT:project,CREW_HF_PORT:String(port),CREW_HF_CLI:cli,CREW_HF_OUTSIDE:outside},undefined,{timeoutMs:20000,bytes:262144});
  const code=await p.exited;await p.stop();const {out,err,failure}=p.output();if(code!==0||failure)throw new Error('browser fixture failed '+(failure||'')+' '+err.slice(-600));return JSON.parse(out.trim().split('\n').at(-1));
 };
 try{
  const old=await run(false);ok(old.local&&old.outside&&http>0&&ws>0&&ownWS>0,'unprotected real Chromium control reaches planted HTTP/WS/file targets');
  http=ws=ownWS=0;const current=await run(true);ok(current.local,'guard preserves legitimate owned HTTP composition');ok(!current.outside,'guard blocks actual outside-file navigation');ok(http===0,'guard blocks external-loopback fetch and image subresource');ok(ws===0,'guard blocks external-loopback WebSocket handshake');ok(ownWS===0,'CSP/Chromium blocks even same-origin WebSocket handshake');
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>external.close(r));rmSync(root,{recursive:true,force:true});}
 console.log(`hyperframes-containment: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}
