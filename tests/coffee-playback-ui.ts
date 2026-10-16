import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {COFFEE_PLAYBACK_SCRIPT,integrateCoffeeSite} from '../src/render/coffee-film';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const plan=JSON.parse(readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8'));
plan.integration.autoplay=false;
const html=await integrateCoffeeSite('<html lang="zh-Hant"><head><style>body{margin:0}.feature-frame{aspect-ratio:16/9}figcaption{margin-top:16px}</style></head><body><figure><div class="feature-frame"><video src="assets/coffee.mp4"></video></div><figcaption>影片說明</figcaption></figure></body></html>',plan);
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const path=new URL(req.url).pathname;if(path.endsWith('coffee-playback.js'))return new Response(COFFEE_PLAYBACK_SCRIPT,{headers:{'content-type':'text/javascript; charset=utf-8'}});if(path.endsWith('.mp4'))return new Response(Bun.file(join(import.meta.dir,'fixture/web-open/coffee.mp4')));if(path.endsWith('.png'))return new Response(Bun.file(join(import.meta.dir,'fixture/web-open/coffee-poster.png')));return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});}});
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',(e:any)=>console.error('PAGE',String(e)));await page.goto(`http://127.0.0.1:${server.port}`);
 const button=page.getByRole('button',{name:'播放影片',exact:true});await button.waitFor();
 const b=await button.boundingBox(),caption=await page.locator('figcaption').boundingBox();assert(b&&caption&&b.y+b.height<=caption.y);
 await button.click();await page.waitForFunction(()=>!document.querySelector('video')!.paused);
 await page.getByRole('button',{name:'暫停影片',exact:true}).waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'仍要播放影片',exact:true}).waitFor();
 assert.deepEqual(await page.locator('video').evaluate((v:HTMLVideoElement)=>({paused:v.paused,time:v.currentTime,controls:v.controls,poster:v.getAttribute('poster')})),{paused:true,time:0,controls:false,poster:'assets/coffee-poster.png'});
 await page.getByRole('button',{name:'仍要播放影片',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('video')!.paused&&document.querySelector('video')!.controls);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'仍要播放影片',exact:true}).waitFor();
 await page.screenshot({path:`/tmp/coffee-playback-${width}.png`});await page.close();
 console.log(`PASS ${width}: no caption overlap, localized live labels, poster reset after playback, explicit motion opt-in`);
}}finally{await browser.close();server.stop(true);}
