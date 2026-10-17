import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Video acceptance checks the rendered MP4 itself, not only that a render exists: its length
// against what the captain asked, that its frames are not all black, and the fades the captain
// named. Doctor has one film-renderer row; the readiness gate checks the render environment of
// a video workflow instead of discovering it at the render step.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {harness,until,Y} from './rt-harness';
import {ArtifactStore} from '../src/artifacts';
import {installDeliver} from '../src/domain/deliver';
import {requestedSeconds,frameLuma} from '../src/render';
import {diagnose} from '../src/doctor';
import {contractStage} from '../src/readiness/stages';
let pass=0;const ok=(v:unknown,name:string,detail='')=>{assert(v,`${name} ${detail}`);pass++;console.log('ok '+name);};
ok(requestedSeconds(['Make a 10-second film'])===10&&requestedSeconds(['a 1 minute teaser'])===60&&requestedSeconds(['做一支 15 秒的影片'])===15,'the requested length is read from the captain\'s words');
ok(requestedSeconds(['Make a 10-second film','make the film 6 seconds instead'])===6&&requestedSeconds(['three steps, 1920x1080'])===null,'the latest length wins and unrelated numbers are not lengths');
ok(requestedSeconds(['A 30-second film with a 5-second intro'])===30&&requestedSeconds(['做一支 30 秒影片，片頭 5 秒'])===30,'a part\'s length (an intro) is not the film\'s length');
ok(requestedSeconds(['Make a film; hold the logo for 3 seconds'])===null&&requestedSeconds(['A 1990s vibe film'])===null&&requestedSeconds(['a 10s film'])===null,'a hold time, a decade or a bare "10s" is no requested length: the check is skipped');
ok(requestedSeconds(['A 30-second film, then a 15-second video cut'])===null,'two different film lengths in one text are ambiguous: the check is skipped');
const flow={id:'film-fixture',name:'Film fixture',version:1,roles:[{id:'editor',label:'Editor',skill:'fixture'}],nodes:[
 {id:'intake',kind:'hook',label:'Intake',do:'deliver.intake',x:0,y:0},{id:'produce',kind:'hook',label:'Round',do:'deliver.round',x:1,y:0},
 {id:'draft',kind:'agent',label:'Draft',role:'editor',mode:'deliver',args:{format:'video'},x:2,y:0},
 {id:'render',kind:'hook',label:'Render',do:'deliver.render',args:{producer:'draft'},x:3,y:0},
 {id:'checks',kind:'check',label:'Readiness',join:'all',checks:[{use:'core/artifact-ready',proves:[0]}],args:{producer:'all'},x:4,y:0},
 {id:'passed',kind:'hook',label:'Passed',x:5,y:0},{id:'failed',kind:'hook',label:'Failed',x:5,y:1}],
 edges:[['intake','produce'],['produce','draft'],['draft','render'],['render','checks','ok|unavailable'],['checks','passed','pass'],['checks','failed','fail']]};
const ffmpeg=Bun.which('ffmpeg');assert(ffmpeg,'ffmpeg is required for the rendered-MP4 checks');
const H2=await harness([Y(flow)]),E=H2.engine,store=new ArtifactStore(H2.data),dir=join(H2.data,'mp4');mkdirSync(dir,{recursive:true});
const mp4=(name:string,source:string,vf='')=>{const f=join(dir,`${name}.mp4`);const r=Bun.spawnSync([ffmpeg!,'-y','-loglevel','error','-f','lavfi','-i',source,...(vf?['-vf',vf]:[]),'-c:v','libx264','-pix_fmt','yuv420p',f]);assert.equal(r.exitCode,0,r.stderr.toString());return f;};
const bright='color=c=0x80a0c0:s=1920x1080:d=2:r=10',files={title:mp4('title','color=c=black:s=1920x1080:d=2:r=10','drawbox=x=760:y=510:w=400:h=60:color=white:t=fill'),bright:mp4('bright',bright),black:mp4('black','color=c=black:s=1920x1080:d=2:r=10'),fadeIn:mp4('fade-in',bright,'fade=t=in:st=0:d=1'),fadeOut:mp4('fade-out',bright,'fade=t=out:st=1:d=1')};
ok((await frameLuma(files.black,1))!.peak<16&&(await frameLuma(files.bright,1))!.mean>60,'frame brightness is sampled from the MP4 with ffmpeg');
installDeliver(E,{dataDir:H2.data,artifacts:store,lane:{},fileorg:{},docs:{}} as any);
E.deps.provider=()=>({id:'fixture',model:'offline',sandboxFree:true,start(_s:any,_t:any[],ctx:any){return{interrupt(){},async *send(){
 const out:any=await H2.agents.callTool(ctx.token,'work_write',{path:'film.html',content:'<!doctype html><div id="stage" style="width:960px;height:540px"></div><script>const DUR=2;function render(t){}</script>'});assert(!out.error,JSON.stringify(out));
 yield{type:'turnEnd',status:'ok'};}};}});
process.env.CREW_RENDER_STUB='1';
const classes=async(text:string,file:string)=>{process.env.CREW_RENDER_STUB_MP4=file;const run=E.start({workflow:flow.id,text});assert(await until(()=>['succeeded','failed'].includes(run.status)),JSON.stringify(run.nodes));
 return E.ledger(run.id).filter(e=>e.check==='core/artifact-ready').flatMap(e=>e.findings??[]).map((f:any)=>f.class);};
try{
 let c=await classes('Make a 10-second film about coffee',files.bright);ok(c.includes('video-duration'),'a 2 s render for a 10-second request is a video-duration finding',c.join());
 c=await classes('Make a 2-second film about coffee',files.bright);ok(!c.length,'a 2 s render for a 2-second request passes',c.join());
 c=await classes('Make a film about coffee',files.black);ok(c.includes('video-black'),'an all-black render is a video-black finding',c.join());
 c=await classes('Make a title card film about coffee',files.title);ok(!c.includes('video-black'),'a white title on a black background is not a black frame',c.join());
 c=await classes('Make a film that fades in from black',files.bright);ok(c.includes('video-fade'),'a requested fade-in that the render lacks is a video-fade finding',c.join());
 c=await classes('Make a film that fades in from black',files.fadeIn);ok(!c.includes('video-fade'),'a render that fades in passes the fade check',c.join());
 c=await classes('Make a film that fades out at the end',files.bright);ok(c.includes('video-fade'),'a requested fade-out that the render lacks is a video-fade finding',c.join());
 c=await classes('Make a film that fades out at the end',files.fadeOut);ok(!c.includes('video-fade'),'a render that fades out passes the fade check',c.join());
}finally{delete process.env.CREW_RENDER_STUB;delete process.env.CREW_RENDER_STUB_MP4;for(const r of E.list())if(!['succeeded','failed','cancelled'].includes(r.status))await E.cancel(r.id);H2.stop();}
// Doctor: one film-renderer row that names what is missing
const base={state:H2.data,board:{writable:false},gh:{},keys:{},chatProvider:'stub',lanIp:null,tailscale:{},compiled:false} as any;
const row=(render:any,film?:any)=>diagnose({...base,render,film}).find(i=>i.id==='film-renderer') as any;
const none=row({node:'/bin/node',playwright:'/pw/index.mjs',ffmpeg:null,ffprobe:null},{ready:false,reason:'Pinned hyperframes 0.8.159 is unavailable'});
ok(none&&none.status!=='ok'&&/missing ffmpeg/.test(none.detail)&&/HyperFrames .*not ready/.test(none.detail)&&none.action?.item==='ffmpeg','Doctor film-renderer row names the missing ffmpeg and the HyperFrames state',JSON.stringify(none));
const all=row({node:'/bin/node',playwright:'/pw/index.mjs',ffmpeg:'/bin/ffmpeg',ffprobe:'/bin/ffprobe'},{ready:true});
ok(all?.status==='ok'&&all.availability==='available','Doctor film-renderer row is ok when the renderer and HyperFrames are ready',JSON.stringify(all));
// readiness gate: a video workflow's contract stage checks the render environment
const env=(canFilm:boolean)=>({actions:()=>true,modes:()=>true,cardModes:()=>true,cardBodies:()=>true,check:()=>({}),skillText:()=>'# skill',knownProviders:['stub'],defaultPick:()=>({provider:'stub',model:'m'}),login:()=>'logged-in',sandbox:()=>null,pathRefusal:()=>null,roundRoot:'/tmp/work',forbidden:[],egressAllow:()=>[],startInputs:{},render:()=>({canFilm,missing:canFilm?[]:['ffmpeg']})}) as any;
const missing=contractStage(flow as any,env(false)).filter(p=>p.code==='renderer-missing');
ok(missing.length===1&&missing[0].node==='render'&&missing[0].owner==='captain'&&missing[0].need==='install'&&/ffmpeg/.test(missing[0].reason.en),'the gate fails a video workflow whose renderer is missing, naming what to install',JSON.stringify(missing));
ok(!contractStage(flow as any,env(true)).some(p=>p.code==='renderer-missing'),'the gate passes the render stage when the renderer is present');
console.log(`deliver-video: ${pass} passed, 0 failed`);
