// Opt-in real local encoder smoke test. No provider calls or Studio Task writes.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {discoverCoffeeFilmCapability,renderCoffeeFilm} from '../src/render/coffee-film';
import {coffeeDesignHash} from '../src/domain/coffee-design';
import {TOOLS_DIR,renderEnv} from '../src/render';
const env=renderEnv(),cap=discoverCoffeeFilmCapability([process.env.CREW_HYPERFRAMES_ROOT||TOOLS_DIR],{playwright:env.playwright,ffmpeg:env.ffmpeg,ffprobe:Bun.which('ffprobe')});
if(!cap.ready)throw new Error(cap.reason);
const root=mkdtempSync(join(tmpdir(),'coffee-real-smoke-'));
try {
 const page=join(root,'page');mkdirSync(page);writeFileSync(join(page,'index.html'),'<html><head><title>Isolated renderer test</title></head><body>Test only</body></html>');
 const image=join(root,'image.png');writeFileSync(image,execFileSync(cap.tools.ffmpeg,['-v','error','-f','lavfi','-i','color=c=tan:s=960x540','-frames:v','1','-vcodec','png','-f','image2pipe','pipe:1']));
 const design=JSON.parse(readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8'));
 const result=await renderCoffeeFilm({direction:{version:1,design,designHash:coffeeDesignHash(design),brief:design.brief,name:design.name,palette:design.brand.palette,type:design.brand.typography,spacing:design.brand.spacing,motion:'test',image:design.brand.imageDirection,provider:'codex',model:'isolated-test-no-provider-call',effort:'low'},image,page,revision:null,signal:new AbortController().signal,authorize(){},onProgress:stage=>console.log(stage)},cap);
 assert.equal(result.codec,'h264');assert.equal(result.duration,12);assert.equal(result.width,960);assert.equal(result.height,540);assert(result.bytes.length>1000&&result.poster.length>100);
 console.log(JSON.stringify({codec:result.codec,duration:result.duration,width:result.width,height:result.height,bytes:result.bytes.length,poster:result.poster.length,renderer:result.renderer}));
}finally{rmSync(root,{recursive:true,force:true});}
