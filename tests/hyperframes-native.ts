// Browser-free guard contract. Captures actual wrapped launch options, not a browser.
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { strict as assert } from 'node:assert';
const cli = join(import.meta.dirname,'../node_modules/hyperframes/bin/hyperframes.mjs');
// An external watchdog bounds even the rejected old synchronous validator. The
// child models the Board host: its own interval must survive authored input.
if(process.env.HF_VALIDATOR_CHILD){
 const{mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const{validateHyperframesReferences}=await import(process.env.HF_VALIDATOR_SOURCE||'../src/render/hyperframes');
 const root=mkdtempSync('/private/tmp/hf-validator-cpu-');mkdirSync(join(root,'assets'));
 const cases={js:['assets/hostile.js','export '.repeat(300000)],url:['assets/hostile.css','url('.repeat(500000)],comment:['assets/hostile.css','/*x'.repeat(600000)],style:['index.html','<style '.repeat(280000)],script:['index.html','<script '.repeat(250000)],declaration:['index.html','<!DOCTYPE '.repeat(200000)]};
 const[file,text]=cases[process.env.HF_VALIDATOR_CHILD];writeFileSync(join(root,'index.html'),'<main>Owned</main>');writeFileSync(join(root,file),text);
 let beats=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++;console.log(JSON.stringify({heartbeat:true}));},10);
 try{
  await new Promise(r=>setTimeout(r,30));console.log(JSON.stringify({started:true,root}));const start=performance.now();let held=false;
  try{await validateHyperframesReferences(root,{'index.html':'x',[file]:'x'});}catch{held=true;}
  const elapsed=performance.now()-start;await new Promise(r=>setTimeout(r,60));clearInterval(timer);
  console.log(JSON.stringify({settled:true,elapsed,maxGap,beats,held}));
 }finally{clearInterval(timer);rmSync(root,{recursive:true,force:true});}
 process.exit(0);
}
if(process.env.HF_VALIDATOR_CONTROL==='1'){
 const{spawn}=await import('node:child_process');const{rmSync}=await import('node:fs');let passed=0,failed=0;
 for(const kind of['js','url','comment','style','script','declaration']){
  const child=spawn(process.execPath,[import.meta.filename],{env:{...process.env,HF_VALIDATOR_CHILD:kind,HF_VALIDATOR_CONTROL:''},stdio:['ignore','pipe','pipe']});
  let out='',err='',timedOut=false;child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  // Deadline is armed outside the potentially blocked host. Never wait for its
  // JS timer to terminate itself; SIGKILL targets only this owned child.
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},2000);
  const exit=await new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));clearTimeout(timer);
  const records=out.trim().split('\n').map(s=>{try{return JSON.parse(s);}catch{return {};}}),record=records.find(v=>v.settled),started=records.find(v=>v.started);
  if(started?.root?.startsWith('/private/tmp/hf-validator-cpu-'))rmSync(started.root,{recursive:true,force:true});
  const heartbeatAfterStart=records.slice(records.findIndex(v=>v.started)+1).filter(v=>v.heartbeat).length;
  console.log(JSON.stringify({kind,timedOut,exit,heartbeatAfterStart,...record}));
  if(!timedOut&&exit.code===0&&record?.elapsed<1000&&record?.maxGap<500&&record?.beats>=4)passed++;else{failed++;if(err)console.error(err);}
 }
 console.log(`hyperframes-validator-cpu: ${passed} passed, ${failed} failed; no browser launched`);process.exit(failed?1:0);
}
// Actual subprocess failure/cancel/deadline checks; never launch a browser.
if(process.env.HF_ADAPTER_CONTROL==='1'){
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync}=await import('node:fs');
 const {renderHyperframes,HyperframesFailure}=await import(process.env.HF_ADAPTER_SOURCE||'../src/render/hyperframes');
 const root=mkdtempSync('/private/tmp/hf-adapter-control-'),project=join(root,'project'),fake=join(root,'fake'),bin=join(fake,'bin');
 mkdirSync(project);mkdirSync(bin,{recursive:true});writeFileSync(join(project,'index.html'),'<main>Owned fixture</main>');writeFileSync(join(fake,'package.json'),JSON.stringify({version:'0.8.159'}));
 symlinkSync(join(import.meta.dirname,'../node_modules'),join(fake,'node_modules'));
 const fakeCLI=join(bin,'hyperframes.mjs'),marker=join(root,'entered'),tools={node:join(import.meta.dirname,'../node_modules/node/bin/node'),cli:fakeCLI,browser:'/usr/bin/true',ffmpeg:'/usr/bin/true',ffprobe:'/usr/bin/true'};
 let count=0;
 const refused=async(label,options={})=>{let error;try{await renderHyperframes({project,tools,authorize(){},timeoutMs:1500,...options});}catch(e){error=e;}assert(error instanceof HyperframesFailure&&error.cleanupSafe===true,label+': '+String(error));count++;};
 try{
  writeFileSync(fakeCLI,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'entered');process.exit(3);`);
  writeFileSync(join(project,'index.html'),'<div data-composition-src="../planted.html"></div>');await refused('traversal rejected before first actual CLI entry');assert(!existsSync(marker),'authored traversal reached CLI before validation');count++;
  mkdirSync(join(project,'assets'));
  writeFileSync(join(project,'index.html'),'<main>Owned media fixture</main>');
  for(const name of['playlist.mp4','disguised.png']){writeFileSync(join(project,'assets',name),'#EXTM3U\nfile:///private/planted');await refused('untrusted media container refused before native discovery');assert(!existsSync(marker));count++;rmSync(join(project,'assets',name));}
  writeFileSync(join(project,'assets/local.css'),'.x{background:url(picture.svg)}');writeFileSync(join(project,'assets/local.js'),'window.localAsset=true;');writeFileSync(join(project,'assets/scene.html'),'<div>Owned nested scene</div>');writeFileSync(join(project,'assets/picture.svg'),'<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const valid='<main><link rel="stylesheet" href="assets&#47;local.css"><script src="assets/local.js"></script><img src="assets/picture.svg"><template><div data-composition-src="assets/scene.html"></div></template></main>';
  writeFileSync(join(project,'index.html'),valid);await refused('owned nested HTML/CSS/JS/media reach actual CLI');assert(existsSync(marker));count++;rmSync(marker);
  const negatives=[
   '<div data-composition-src="/private/tmp/planted.html"></div>',
   '<div data-composition-src="../planted.html"></div>',
   '<div data-composition-src="&#46;&#46;/planted.html"></div>',
   '<template><div data-composition-src="&period;&period;&sol;planted.html"></div></template>',
   '<div data-composition-src="%252e%252e/planted.html"></div>',
   '<img src="https://example.invalid/x.png">','<img srcset="assets/picture.svg 1x">',
   '<style>@import "../planted.css";</style>','<style>.a{background:url(file:///private/tmp/planted.png)}</style>',
   '<script>import("../planted.js")</script>','<svg><image href="../planted.svg"/></svg>',
   '<div data-composition-src="assets/local.js"></div>','<link rel="stylesheet" href="assets/picture.svg">','<script src="assets/picture.svg"></script>',
   '<video src="assets/local.js"></video>','<audio src="assets/local.js"></audio>',
  ];
  for(const html of negatives){writeFileSync(join(project,'index.html'),html);await refused('authored reference rejected before actual CLI: '+html);assert(!existsSync(marker));count++;}
  writeFileSync(join(project,'index.html'),valid);writeFileSync(join(project,'assets/scene.html'),'<div data-composition-src="../../planted.html"></div>');await refused('nested composition traversal rejected before launch');assert(!existsSync(marker));count++;writeFileSync(join(project,'assets/scene.html'),'<div>Owned nested scene</div>');
  writeFileSync(join(project,'assets/local.css'),'@import "../../planted.css";');await refused('nested stylesheet traversal rejected before launch');assert(!existsSync(marker));count++;writeFileSync(join(project,'assets/local.css'),'.x{color:red}');
  writeFileSync(join(project,'assets/local.js'),'//# sourceMappingURL=../../planted.json');await refused('script source-map reference rejected before launch');assert(!existsSync(marker));count++;writeFileSync(join(project,'assets/local.js'),'window.localAsset=true;');
  writeFileSync(join(project,'package.json'),'{}');await refused('authored configuration refused before launch');assert(!existsSync(marker));count++;rmSync(join(project,'package.json'));
  symlinkSync(join(project,'index.html'),join(project,'asset.html'));await refused('authored symlink refused before launch');assert(!existsSync(marker));count++;rmSync(join(project,'asset.html'));
  await refused('real owned CLI failure reports verified cleanup');assert(existsSync(marker));count++;rmSync(marker);
  writeFileSync(fakeCLI,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'entered');setInterval(()=>{},1000);`);
  const before=Date.now();await refused('real hung CLI deadline reports verified cleanup',{timeoutMs:1000});assert(Date.now()-before<5000&&existsSync(marker));count++;rmSync(marker);
  const controller=new AbortController(),pending=refused('actual running CLI cancellation reports verified cleanup',{signal:controller.signal,timeoutMs:5000});
  const until=Date.now()+2000;while(!existsSync(marker)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert(existsSync(marker));controller.abort();await pending;count++;
  const cancelled=new AbortController();cancelled.abort();await refused('pre-cancelled request never launches',{signal:cancelled.signal});
  // Exercise the real installed parser, not a fake stand-in for its file reads.
  const outsideRoot=mkdtempSync('/private/tmp/hf-host-private-'),outside=join(outsideRoot,'planted.html'),hostRoot=join(root,'host'),hostProject=join(hostRoot,'project'),hostHome=join(hostRoot,'home');
  mkdirSync(hostProject,{recursive:true});mkdirSync(hostHome);writeFileSync(outside,'<template><div data-composition-id="outside" data-width="960" data-height="540">PLANTED_PRIVATE</div></template>');
  const child=join(root,'host-reader.mjs'),dist=join(import.meta.dirname,'../node_modules/hyperframes/dist/chunk-7F3B5YYT.js');
  writeFileSync(child,`import fs from'node:fs';import{readFile as promiseRead}from'node:fs/promises';import{syncBuiltinESMExports}from'node:module';import{lintProject}from${JSON.stringify(dist)};
const original=fs.openSync;let opened=0;fs.openSync=function(p,...args){const fd=original.call(this,p,...args);if(p===${JSON.stringify(outside)})opened++;return fd;};syncBuiltinESMExports();
let direct=0;for(const read of[()=>fs.readFileSync(${JSON.stringify(outside)}),()=>fs.promises.readFile(${JSON.stringify(outside)}),()=>promiseRead(${JSON.stringify(outside)}),()=>new Promise((yes,no)=>fs.readFile(${JSON.stringify(outside)},(e,b)=>e?no(e):yes(b))),()=>new Promise((yes,no)=>{const stream=fs.createReadStream(${JSON.stringify(outside)});stream.on('error',no);stream.on('data',()=>{});stream.on('end',yes);})]){try{await read();}catch(e){if(String(e).includes('host read outside owned/import roots refused'))direct++;else throw e;}}
let blocked=0;for(const ref of[${JSON.stringify(outside)},${JSON.stringify(relative(hostProject,outside))}]){fs.writeFileSync(${JSON.stringify(join(hostProject,'index.html'))},'<div data-composition-id="main" data-width="960" data-height="540" data-duration="12"><div data-composition-src="'+ref+'"></div></div>');try{await lintProject(${JSON.stringify(hostProject)});}catch(e){if(String(e).includes('host read outside owned/import roots refused'))blocked++;else throw e;}}
fs.writeFileSync(${JSON.stringify(join(hostProject,'scene.html'))},'<template><div data-composition-id="local" data-width="960" data-height="540">Owned</div></template>');fs.writeFileSync(${JSON.stringify(join(hostProject,'index.html'))},'<div data-composition-id="main" data-width="960" data-height="540" data-duration="12"><div data-composition-src="scene.html"></div></div>');await lintProject(${JSON.stringify(hostProject)});console.log(JSON.stringify({opened,blocked,direct,local:true}));`);
  try{
   const {spawnSync}=await import('node:child_process');const guard=process.env.HF_HOST_GUARD||join(import.meta.dirname,'../src/render/hyperframes-guard.mjs');
   const result=spawnSync(tools.node,['--import',guard,child],{env:{...process.env,HOME:hostHome,CREW_HF_ROOT:hostProject,CREW_HF_PORT:'39991',CREW_HF_CLI:cli},encoding:'utf8',timeout:10000});
   assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{opened:0,blocked:2,direct:5,local:true});count+=8;
  }finally{rmSync(outsideRoot,{recursive:true,force:true});}
  const{spawnSync}=await import('node:child_process');const cpu=spawnSync(process.execPath,[import.meta.filename],{env:{...process.env,HF_ADAPTER_CONTROL:'',HF_VALIDATOR_CONTROL:'1'},encoding:'utf8',timeout:15000,maxBuffer:262144});
  console.log(cpu.stdout);assert.equal(cpu.status,0,'bounded hostile-input host heartbeat controls: '+cpu.stderr);count+=6;
  console.log(`hyperframes-adapter-lifecycle: ${count} passed, 0 failed; no browser launched`);
 }finally{rmSync(root,{recursive:true,force:true});}
 process.exit(0);
}
process.env.CREW_HF_CLI=cli;
process.env.CREW_HF_ROOT=import.meta.dirname;
process.env.CREW_HF_PORT='39991';
const require = createRequire(cli), p = (await import(require.resolve('puppeteer-core'))).default;
let captured:any;
p.launch = async (options:any) => { captured=options; return {newPage:async()=>{throw new Error('no browser allowed in this fixture');},createBrowserContext:async()=>{},pages:async()=>[]}; };
await import('../src/render/hyperframes-guard.mjs');
await p.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--no-sandbox=true','--remote-debugging-port=9222','--window-size=960,540']});
assert(!captured.args.some((a:string)=>/^--(?:no-sandbox|disable-setuid-sandbox)(?:=|$)/i.test(a)),'unsafe upstream sandbox flags reached actual launch boundary');
assert(!captured.args.some((a:string)=>a.startsWith('--remote-debugging-port')));
assert(captured.pipe === true && captured.args.includes('--window-size=960,540'));
console.log('hyperframes-launch-guard: 3 passed, 0 failed; no browser launched');
