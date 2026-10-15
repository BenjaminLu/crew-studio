import A from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,symlinkSync,linkSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {deflateSync} from 'node:zlib';
import {MainSession} from '../src/host/main';
import {codexHost} from '../src/host/codex';import {MediaLibrary} from '../src/media-library';import {publishGeneratedImage} from '../src/host/generated-media';
const root=mkdtempSync(join(tmpdir(),'firstmate-media-'));let count=0;
const ok=(v:unknown,name:string)=>{A.ok(v,name);count++;console.log('PASS '+name);};
function chunk(type:string,data:Buffer){const b=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const x of b){crc^=x;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([n,b,c]);}
const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
try{
 const home=join(root,'codex');mkdirSync(home);writeFileSync(join(home,'.fixture-account.json'),JSON.stringify({authenticated:true}));const lib=new MediaLibrary(join(root,'data'));const controller=new AbortController();const owner={signal:controller.signal,authorize(){}};let calls=0;let pending:Promise<unknown>|null=null;
 const session=await codexHost(join(import.meta.dir,'fixture/codex-account.mjs')).attach('',{cwd:root,fresh:true,env:{CODEX_HOME:home,ACCOUNT_FIXTURE_IMAGE_RESULT:png.toString('base64')},onEvent:()=>{},onPermission:async()=>({allow:false}),onGeneratedImage:async image=>{A.equal(image.model,'fixture-model');A.equal(image.item.id,'image-1');A.ok(image.live());calls++;await publishGeneratedImage(lib,image,owner);}});
 try{
  const out=await session.send('DIRECT-IMAGE success');ok(out.status==='completed'&&calls===1&&lib.store.view().length===1,'successful app-server image is in actual managed Library before completion');const first=lib.store.view()[0];ok(readFileSync(lib.store.file(first.id,1,'image.png')!).equals(png),'managed artifact retains exact verified bytes');
  for(const mode of ['foreign','stale','failed','hold']){const n=calls;const send=session.send('DIRECT-IMAGE '+mode);if(mode==='hold'){await Bun.sleep(80);await session.interrupt();}await send;ok(calls===n,mode+' cannot import staged output');}
  const n=calls;const dup=await session.send('DIRECT-IMAGE duplicate');ok(dup.status==='completed'&&calls===n+1,'duplicate notification publishes once');
  for(const mode of ['conflict','item-failed']){const n=calls;const r=await session.send('DIRECT-IMAGE '+mode);ok(r.status==='failed'&&calls===n,mode+' fails closed before publication');}
 }finally{await session.detach();}
 let release!:()=>void,entered!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);let heldPublished=0;
 const held=await codexHost(join(import.meta.dir,'fixture/codex-account.mjs')).attach('',{cwd:root,fresh:true,env:{CODEX_HOME:home,ACCOUNT_FIXTURE_IMAGE_RESULT:png.toString('base64')},onEvent:()=>{},onPermission:async()=>({allow:false}),onGeneratedImage:async image=>{entered();await gate;if(!image.live())throw new Error('ended');heldPublished++;}});
 try{const sent=held.send('DIRECT-IMAGE success');await enteredPromise;ok(held.busy,'turn remains busy while Library flush pending');await held.interrupt();release();const result=await sent;await Bun.sleep(25);ok(result.status==='interrupted'&&heldPublished===0,'interrupt during flush cannot publish or complete successful');ok((await held.send('ordinary next turn')).status==='completed','late flush cannot poison next turn');}finally{release();await held.detach();}
 const oldHome=process.env.CODEX_HOME,oldResult=process.env.ACCOUNT_FIXTURE_IMAGE_RESULT;process.env.CODEX_HOME=home;process.env.ACCOUNT_FIXTURE_IMAGE_RESULT=png.toString('base64');
 const main=new MainSession({dataDir:join(root,'main-data'),projectDir:root,stateDir:join(root,'state'),nativeWorkspace:true,hosts:{codex:codexHost(join(import.meta.dir,'fixture/codex-account.mjs')),claude:codexHost(join(import.meta.dir,'fixture/codex-account.mjs'))},permissionMcp:()=>({command:[],env:{}}),onGeneratedImage:async(image,owner)=>{await publishGeneratedImage(lib,image,owner);}});
 try{await main.start();const fresh=await main.startFresh('codex',i=>i.model==='fixture-model'&&i.effort==='low');ok(fresh.ok,'actual MainSession starts verified isolated primary');for(let i=0;i<100&&main.view().busy;i++)await Bun.sleep(20);const before=lib.store.view().length;main.enqueue('chat','DIRECT-IMAGE success','desktop');for(let i=0;i<100&&lib.store.view().length===before;i++)await Bun.sleep(20);ok(lib.store.view().length===before+1,'actual MainSession private bridge publishes direct captain image');await main.detach();}finally{main.stop();if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome;if(oldResult===undefined)delete process.env.ACCOUNT_FIXTURE_IMAGE_RESULT;else process.env.ACCOUNT_FIXTURE_IMAGE_RESULT=oldResult;}
 const outputRoot=join(home,'generated_images');mkdirSync(outputRoot);const path=join(outputRoot,'new.png');const image={thread:'thread',turn:'turn',model:'fixture-model',startedAt:Date.now()-20,outputRoot,item:{type:'imageGeneration',id:'saved',status:'completed',result:'',savedPath:path},live:()=>true};writeFileSync(path,png);const saved=await publishGeneratedImage(lib,image,owner);ok(!!saved.artifact,'new owned saved PNG imports');const again=await publishGeneratedImage(lib,image,owner);ok(again.version===saved.version,'same source item retries idempotently');
 const reject=async(candidate:any,label:string)=>{await A.rejects(()=>publishGeneratedImage(lib,candidate,owner));ok(true,label);};
 writeFileSync(join(root,'outside.png'),png);const nested=join(outputRoot,'nested');symlinkSync(root,nested);await reject({...image,item:{...image.item,savedPath:join(nested,'outside.png')}},'parent-directory alias refused');
 await reject({...image,item:{...image.item,result:'A'.repeat(24*1024*1024)}},'oversized inline output refused before decode');
 await reject({...image,item:{...image.item,result:'AA=A',savedPath:null}},'malformed base64 refused');
 await reject({...image,live:()=>false},'expired source ownership refused');await reject({...image,item:{...image.item,result:'AAAA'}},'invalid inline bytes refused');
 const old=join(outputRoot,'old.png');writeFileSync(old,png);utimesSync(old,new Date(0),new Date(0));await reject({...image,item:{...image.item,savedPath:old}},'old output refused');
 const alias=join(outputRoot,'alias.png');symlinkSync(path,alias);await reject({...image,item:{...image.item,savedPath:alias}},'symlink refused');const hard=join(outputRoot,'hard.png');linkSync(path,hard);await reject({...image,item:{...image.item,savedPath:hard}},'hard link refused');
 const outside=join(root,'outside.png');writeFileSync(outside,png);await reject({...image,item:{...image.item,savedPath:outside}},'outside output refused');
 const cancelled=new AbortController();cancelled.abort();await A.rejects(()=>publishGeneratedImage(lib,image,{signal:cancelled.signal,authorize(){}}));ok(true,'aborted publication refused');
 console.log(`PASS ${count}/0`);
}finally{rmSync(root,{recursive:true,force:true});}
process.exit(0);
