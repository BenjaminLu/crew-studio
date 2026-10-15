// Source-owned preload for the exact pinned optional CLI. No authored code runs in Node.
import cp from 'node:child_process';
import {syncBuiltinESMExports,createRequire} from 'node:module';
import {Server} from 'node:net';
import {realpathSync,appendFileSync} from 'node:fs';
import {join,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {dirname} from 'node:path';
const root=realpathSync(process.env.CREW_HF_ROOT||''),port=Number(process.env.CREW_HF_PORT);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('owned HyperFrames port missing');
const record=reason=>{try{appendFileSync(join(root,'.crew-refused.jsonl'),JSON.stringify({reason})+'\n');}catch{}};
const forbidden=new Set(['ps','pgrep','pkill','killall','kill','osascript']);
for(const name of['spawn','spawnSync','execFile','execFileSync']){
 const original=cp[name];cp[name]=function(file,args,options,...rest){
  if(typeof file!=='string'||forbidden.has(basename(file)))throw new Error('HyperFrames global process management refused');
  if(!Array.isArray(args))throw new Error('HyperFrames subprocess arguments unavailable');
  return original.call(this,file,args,{...options,detached:false},...rest);
 };
}
for(const name of['exec','execSync'])cp[name]=()=>{throw new Error('HyperFrames shell refused');};
const fork=cp.fork;cp.fork=function(file,args,options){return fork.call(this,file,args,{...options,detached:false});};
syncBuiltinESMExports();
const listen=Server.prototype.listen;
Server.prototype.listen=function(...args){
 if(typeof args[0]==='object')args[0]={...args[0],port,host:'127.0.0.1'};
 else if(typeof args[0]==='number')args=[port,'127.0.0.1',...args.filter(a=>typeof a==='function')];
 else throw new Error('HyperFrames non-owned listener refused');
 return listen.apply(this,args);
};
const require=createRequire(process.env.CREW_HF_CLI);
// This is a source-owned fence around the pinned Node readers, not OS isolation.
// Authored references are independently validated before launch: dependency roots
// below are import authority for trusted CLI code, never authored asset authority.
const canonical=realpathSync,owned=dirname(root),cliPath=canonical(process.env.CREW_HF_CLI);
let dependencies=dirname(canonical(require.resolve('puppeteer-core')));while(basename(dependencies)!=='node_modules'&&dirname(dependencies)!==dependencies)dependencies=dirname(dependencies);
if(basename(dependencies)!=='node_modules')throw new Error('HyperFrames trusted dependency root missing');
const trustedEntry=process.argv[1]?canonical(process.argv[1]):cliPath;
const inside=(base,path)=>{const rel=relative(base,path);return rel===''||!rel.startsWith('..')&&!isAbsolute(rel);};
function readPath(value){
 if(typeof value==='number')return value; // Descriptors originate at the fenced open APIs.
 if(value instanceof URL)value=fileURLToPath(value);if(Buffer.isBuffer(value))value=value.toString();
 if(typeof value!=='string')throw new Error('HyperFrames unreadable path refused');
 // Preserve '..' until realpath resolves symlinks; lexical normalization first
 // would incorrectly authorize /allowed/link/../private through a symlink.
 const path=isAbsolute(value)?value:process.cwd()+'/'+value;let actual;try{actual=canonical(path);}catch(error){
  // Missing paths still need a confined parent; never normalize away a symlink.
  let parent=dirname(path);while(true){try{actual=join(canonical(parent),relative(parent,path));break;}catch{if(dirname(parent)===parent)throw error;parent=dirname(parent);}}
 }
 if(!inside(owned,actual)&&!inside(dependencies,actual)&&actual!==trustedEntry){record('host-read-outside-roots');throw new Error('HyperFrames host read outside owned/import roots refused');}
 return value;
}
for(const name of['readFileSync','openSync','createReadStream']){const original=fs[name];fs[name]=function(path,...args){return original.call(this,readPath(path),...args);};}
for(const name of['readFile','open']){const original=fs[name];fs[name]=function(path,...args){try{return original.call(this,readPath(path),...args);}catch(error){const callback=args.at(-1);if(typeof callback==='function'){queueMicrotask(()=>callback(error));return;}throw error;}};}
for(const name of['readFile','open']){const original=fs.promises[name];fs.promises[name]=async function(path,...args){return original.call(this,readPath(path),...args);};}
syncBuiltinESMExports();
const puppeteer=(await import(require.resolve('puppeteer-core'))).default;
const launch=puppeteer.launch.bind(puppeteer),guarded=new WeakSet();
const own=url=>{try{const u=new URL(url);return u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)&&Number(u.port)===port;}catch{return false;}};
async function protect(page){
 if(guarded.has(page))return;guarded.add(page);
 const cdp=await page.createCDPSession();
 // Chromium's network layer covers WebSocket handshakes; CSP additionally denies
 // workers, frames and all authored connections, including same-origin sockets.
 await cdp.send('Network.enable');
 await cdp.send('Network.setBlockedURLs',{urls:['ws://*','wss://*','file://*','ftp://*']});
 await page.setBypassServiceWorker(true);
 await page.setRequestInterception(true);
 page.on('request',async request=>{
  if(request.isInterceptResolutionHandled())return;
  const url=request.url();
  if(url==='about:blank'||url.startsWith('data:')){await request.continue().catch(()=>{});return;}
  if(!own(url)){record('outside-origin');await request.abort('blockedbyclient').catch(()=>{});return;}
  // The CLI serves compiled entry HTML and owned runtime scripts. Its own file
  // readers are fenced above; authored references were validated before launch.
  try{
   const u=new URL(url);if(decodeURIComponent(u.pathname).split('/').some(x=>x==='..')||/%2f|%5c/i.test(u.pathname))throw new Error('path');
   if(request.resourceType()==='document'){
    const response=await fetch(url,{redirect:'error'});const bytes=Buffer.from(await response.arrayBuffer());
    const origin=`http://localhost:${port} http://127.0.0.1:${port}`;
    const csp=`default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' ${origin}; img-src data: ${origin}; media-src ${origin}; font-src data: ${origin}; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin`;
    await request.respond({status:response.status,headers:{'content-type':response.headers.get('content-type')||'text/html','content-security-policy':csp},body:bytes});return;
   }
   await request.continue();
  }catch{record('request-refused');await request.abort('blockedbyclient').catch(()=>{});}
 });
 await page.evaluateOnNewDocument(()=>{
  // CSP is authoritative; report authored network intent without changing DOM.
  document.addEventListener('securitypolicyviolation',e=>console.warn('CREW_HF_CSP_REFUSAL:'+e.violatedDirective));
 });
}
puppeteer.launch=async options=>{
 const privateHome=realpathSync(process.env.HOME||'');
 const browser=await launch({...options,userDataDir:join(privateHome,'browser-profile'),dumpio:process.env.CREW_HF_DEBUG==='1',pipe:true,args:(options?.args||[]).filter(a=>!a.startsWith('--remote-debugging-port')&&!a.startsWith('--user-data-dir')&&!/^--(?:no-sandbox|disable-setuid-sandbox)(?:=|$)/i.test(a))});
 const newPage=browser.newPage.bind(browser);browser.newPage=async()=>{const p=await newPage();await protect(p);return p;};
 const create=browser.createBrowserContext.bind(browser);browser.createBrowserContext=async(...args)=>{const context=await create(...args),np=context.newPage.bind(context);context.newPage=async()=>{const p=await np();await protect(p);return p;};return context;};
 for(const p of await browser.pages())await protect(p);
 return browser;
};
