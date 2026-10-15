// Source-owned jobs publish complete output here. Visibility never grants approval.
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ArtifactStore,type MediaProvenance} from './artifacts';
import {Ledger} from './runtime/checks';
import {verifyImagePng} from './providers/codex-image';
import {probeProcess} from './providers/probe-process';
export class MediaPublicationFailure extends Error{constructor(message:string,readonly cleanupSafe:boolean){super(message);this.name="MediaPublicationFailure";}}
export type MediaRequest={schema:1;task:string;project:string;role:string;generation:number;type:'image'|'video'|'audio';title:string;provider:string|null;model:string|null;dependencies:Record<string,string>;origin:'generated'|'import'};
export type MediaOwner={signal:AbortSignal;authorize():void};
export type MediaBytes={bytes:Buffer;poster?:Buffer;mime:'image/png'|'video/mp4'|'audio/wav'|'audio/mpeg'|'audio/mp4'|'audio/ogg'};
const names={'image/png':'image.png','video/mp4':'video.mp4','audio/wav':'audio.wav','audio/mpeg':'audio.mp3','audio/mp4':'audio.m4a','audio/ogg':'audio.ogg'};
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function canonical(v:any):string{if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);if(Array.isArray(v))return'['+v.map(canonical).join(',')+']';if(v&&Object.getPrototypeOf(v)===Object.prototype)return'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';throw new Error('Unsupported media identity');}
function request(raw:MediaRequest):MediaRequest{
 if(!raw||Object.keys(raw).sort().join()!==['schema','task','project','role','generation','type','title','provider','model','dependencies','origin'].sort().join()||raw.schema!==1||!Number.isSafeInteger(raw.generation)||raw.generation<1||!['image','video','audio'].includes(raw.type)||!['generated','import'].includes(raw.origin))throw new Error('Malformed managed media request');
 for(const k of ['task','project','role','title']as const)if(typeof raw[k]!=='string'||!raw[k].trim()||raw[k].length>200)throw new Error('Missing managed media identity');
 if(!raw.dependencies||Object.getPrototypeOf(raw.dependencies)!==Object.prototype||Object.keys(raw.dependencies).length>32||Object.entries(raw.dependencies).some(([k,v])=>k.length>100||typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))throw new Error('Malformed media dependencies');
 for(const k of ['provider','model']as const)if(raw[k]!==null&&(typeof raw[k]!=='string'||!raw[k]||raw[k]!.length>100))throw new Error('Malformed media provider');
 if(raw.origin==='generated'&&(!raw.provider||!raw.model))throw new Error('Generated media requires actual producer identity');
 return JSON.parse(canonical(raw));
}
/** Refuse playlists before any native parser sees them. Only standalone containers. */
function container(bytes:Buffer,mime:MediaBytes['mime']):string{
 if(mime==='video/mp4'||mime==='audio/mp4'){
  let offset=0,ftyp=false,moov=false,mdat=false;
  while(offset<bytes.length){if(offset+8>bytes.length)throw new Error('Truncated MP4 box');let size=bytes.readUInt32BE(offset),head=8;const kind=bytes.toString('ascii',offset+4,offset+8);if(size===1){if(offset+16>bytes.length)throw new Error('Truncated MP4 size');const wide=bytes.readBigUInt64BE(offset+8);if(wide>BigInt(bytes.length))throw new Error('Oversized MP4 box');size=Number(wide);head=16;}if(size===0)size=bytes.length-offset;if(size<head||offset+size>bytes.length)throw new Error('Invalid MP4 box');if(offset===0&&(kind!=='ftyp'||size<16))throw new Error('Standalone MP4 requires initial ftyp');ftyp ||=kind==='ftyp';moov ||=kind==='moov';mdat ||=kind==='mdat';offset+=size;}
  if(!ftyp||!moov||!mdat)throw new Error('Incomplete standalone MP4');return'mov';
 }
 if(mime==='audio/wav'){if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw new Error('Not a standalone RIFF/WAVE');return'wav';}
 if(mime==='audio/ogg'){if(bytes.length<28||bytes.toString('ascii',0,4)!=='OggS'||bytes[4]!==0||27+bytes[26]>bytes.length)throw new Error('Not a standalone Ogg stream');return'ogg';}
 if(mime==='audio/mpeg'){let at=0;if(bytes.toString('ascii',0,3)==='ID3'){if(bytes.length<10||[...bytes.subarray(6,10)].some(n=>n>127))throw new Error('Invalid ID3 header');at=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9]);if(bytes[5]&16)at+=10;}if(at+4>bytes.length||bytes[at]!==255||(bytes[at+1]&224)!==224||(bytes[at+1]&6)===0||(bytes[at+1]&24)===8)throw new Error('Not a standalone MPEG audio stream');return'mp3';}
 throw new Error('Unsupported standalone media container');
}
export function mediaArtifactId(spec:Pick<MediaRequest,'task'|'project'|'role'|'type'>){return'media-'+sha(canonical(spec)).slice(0,40);}
export class MediaLibrary{
 readonly store:ArtifactStore;private ledger:Ledger;private active=new Set<string>();
 constructor(readonly dataDir:string,store?:ArtifactStore,readonly ffprobe:string|null=Bun.which('ffprobe')){this.store=store??new ArtifactStore(dataDir);this.ledger=new Ledger(dataDir,'managed-media-library');}
 private entries(){const t=this.ledger.authenticatedPrefix();if(t.bad.length||t.malformed)throw new Error('Managed media ownership unavailable');return t.prefix;}
 owns(id:string){return /^media-/.test(id);}
 private check(o:MediaOwner){if(!o||!o.signal||typeof o.authorize!=='function'||o.signal.aborted)throw new Error('Media job no longer owned');o.authorize();if(o.signal.aborted)throw new Error("Media job cancelled during admission");}
 private add(record:string,data:any){this.entries();return this.ledger.add({run:'managed-media-library',node:'publish',record,data,proves:[],verdict:'pass',check:'media',version:1,kind:'deterministic'}as any);}
 async validate(output:MediaBytes,type:MediaRequest['type'],owner:MediaOwner){
  if(!Buffer.isBuffer(output.bytes)||output.bytes.length<16||output.bytes.length>128*1024*1024||!(output.mime in names)||!output.mime.startsWith(type==='image'?'image/':type==='video'?'video/':'audio/'))throw new Error('Invalid complete media output');
  if(output.poster!==undefined){if(type!=='video'||!Buffer.isBuffer(output.poster)||output.poster.length>4*1024*1024)throw new Error('Invalid bounded video poster');verifyImagePng(output.poster);}
  if(type==='image'){verifyImagePng(output.bytes);return;}
  const format=container(output.bytes,output.mime);
  if(!this.ffprobe)throw new Error('Media verification requires local ffprobe');
  const tmp=mkdtempSync(join(tmpdir(),'crew-media-verify-')),path=join(tmp,names[output.mime]);writeFileSync(path,output.bytes,{mode:0o600});
  let safe=false;const p=probeProcess(['/bin/sh','-c','probe=$1; input=$2; shift 2; exec "$probe" "$@" < "$input"','crew-media-probe',this.ffprobe,path,'-v','error','-protocol_whitelist','pipe','-format_whitelist',format,'-f',format,...(format==='mov'?['-enable_drefs','0','-use_absolute_path','0']:[]),'-count_frames','-show_streams','-show_format','-of','json','-i','pipe:0'],tmp,{PATH:process.env.PATH??'',HOME:tmp,TMPDIR:tmp},undefined,{timeoutMs:10000,bytes:128*1024});const stop=()=>{void p.stop().catch(()=>{});};owner.signal.addEventListener('abort',stop,{once:true});
  try{const code=await p.exited;await p.stop();safe=true;this.check(owner);const out=p.output();if(code!==0||out.failure)throw new Error('Media decode verification failed');const meta=JSON.parse(out.out);const formats:Record<string,RegExp>={'video/mp4':/(^|,)mp4(,|$)/,'audio/mp4':/(^|,)mp4(,|$)/,'audio/wav':/(^|,)wav(,|$)/,'audio/mpeg':/(^|,)mp3(,|$)/,'audio/ogg':/(^|,)ogg(,|$)/};if(!formats[output.mime]?.test(meta.format?.format_name??''))throw new Error('Media container differs from declared MIME');if(!Array.isArray(meta.streams)||!meta.streams.some((s:any)=>s.codec_type===(type==='video'?'video':'audio')&&Number(s.nb_read_frames)>0))throw new Error('Media has no verified playable stream');}
  finally{owner.signal.removeEventListener('abort',stop);if(!safe)try{await p.stop();safe=true;}catch{}if(safe)rmSync(tmp,{recursive:true,force:true});else throw new MediaPublicationFailure("Media verification process cleanup is unverified",false);}
 }
 async run(raw:MediaRequest,owner:MediaOwner,produce:()=>Promise<MediaBytes>){
  const spec=request(raw),key=sha(canonical(spec)),artifact=mediaArtifactId({task:spec.task,project:spec.project,role:spec.role,type:spec.type});this.check(owner);
  const rows=this.entries(),prior=rows.find(e=>e.record==='media-intent-v1'&&e.data?.key===key);
  if(prior){const v=this.store.version(artifact,prior.data.n),ready=rows.find(e=>e.record==='media-ready-v1'&&e.data?.key===key);const files=ready?.data?.files??(ready?[{path:ready.data.name,sha256:ready.data.sha256,size:v?.files.find(f=>f.path===ready.data.name)?.size}]:null);
   if(!v||v.type!==spec.type||canonical(v.createdBy)!==canonical({kind:spec.origin==='import'?'import':'agent',...(spec.provider?{provider:spec.provider}:{}),...(spec.model?{model:spec.model}:{}),run:spec.task})||!ready||ready.data.artifact!==artifact||ready.data.n!==v.n||ready.data.sha256!==v.sha256||!Array.isArray(files)||files.length<1||files.length>2||files.some((f:any)=>![ready.data.name,'poster.png'].includes(f.path)||!this.store.file(artifact,v.n,f.path))||canonical(readdirSync(this.store.filesDir(artifact,v.n)).sort())!==canonical(files.map((f:any)=>f.path).sort())||files.some((f:any)=>statSync(this.store.file(artifact,v.n,f.path)!).size!==f.size)||canonical(v.files)!==canonical(files)||ready.data.manifestHash&&sha(canonical(files))!==ready.data.manifestHash||v.primary!==ready.data.name||v.media?.request!==key||canonical(v.media)!==canonical({schema:1,request:key,task:spec.task,generation:spec.generation,dependencies:spec.dependencies,provider:spec.provider,model:spec.model,origin:spec.origin})||this.store.verify(artifact,v.n).length>0)throw new Error('Interrupted media request requires explicit fresh generation');
   if(!rows.some(e=>e.record==='media-complete-v1'&&e.data?.key===key)){this.check(owner);this.add('media-complete-v1',{key,artifact,n:v.n,sha256:v.sha256,manifestHash:sha(canonical(v.files))});}return this.result(artifact,v.n);}

  if(rows.some(e=>e.record==='media-intent-v1'&&e.data?.artifact===artifact&&e.data?.spec?.generation>=spec.generation))throw new Error('Media generation identity already reserved');
  if(this.active.has(key))throw new Error('Media request is already active');const n=(this.store.latest(artifact)?.n??0)+1;this.add('media-intent-v1',{schema:1,key,artifact,n,spec});this.active.add(key);
  try{const output=await produce();this.check(owner);await this.validate(output,spec.type,owner);this.check(owner);
   const media:MediaProvenance={schema:1,request:key,task:spec.task,generation:spec.generation,dependencies:spec.dependencies,provider:spec.provider,model:spec.model,origin:spec.origin};
   const files=[{path:names[output.mime],size:output.bytes.length,sha256:sha(output.bytes)},...(output.poster?[{path:'poster.png',size:output.poster.length,sha256:sha(output.poster)}]:[])].sort((a,b)=>a.path.localeCompare(b.path)),manifestHash=sha(canonical(files));
   this.add('media-ready-v1',{key,artifact,n,sha256:sha(output.bytes),name:names[output.mime],files,manifestHash});
   const v=this.store.publishMedia({id:artifact,title:spec.title,type:spec.type,project:spec.project},{n,name:names[output.mime],bytes:output.bytes,poster:output.poster,media,createdBy:{kind:spec.origin==='import'?'import':'agent',provider:spec.provider??undefined,model:spec.model??undefined,run:spec.task}});this.add('media-complete-v1',{key,artifact,n:v.n,sha256:v.sha256,manifestHash});return this.result(artifact,v.n);
  }finally{this.active.delete(key);}
 }
 private result(artifact:string,n:number){const version=this.store.version(artifact,n)!;return{artifact,version:n,manifest:version,href:`#/artifact/${artifact}`,preview:`/af/${artifact}/${n}/${version.primary}`};}
}
