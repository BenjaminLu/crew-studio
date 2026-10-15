import {dlopen,FFIType} from 'bun:ffi';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {MediaLibrary,type MediaOwner} from '../media-library';
import {verifyImagePng} from '../providers/codex-image';
import type {GeneratedImage} from './types';
const MAX=16*1024*1024;
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
// The supported desktop platform uses openat at every untrusted descendant;
// no path component is resolved twice and a swapped directory link cannot escape.
let sys:any;
function ownedFile(root:string,rel:string):number{
 if(process.platform!=="darwin")throw new Error("Safe saved-image descriptor traversal unavailable; inline PNG required");
 sys??=dlopen("/usr/lib/libSystem.B.dylib",{openat:{args:[FFIType.i32,FFIType.cstring,FFIType.i32],returns:FFIType.i32}}).symbols;
 const parts=rel.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('\0')))throw new Error("Unsafe output path");
 let fd=openSync(realpathSync(root),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_DIRECTORY);
 try{for(let i=0;i<parts.length;i++){const next=sys.openat(fd,Buffer.from(parts[i]+'\0'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|(i<parts.length-1?constants.O_DIRECTORY:0));if(next<0)throw new Error("Generated image path alias refused");closeSync(fd);fd=next;}return fd;}catch(e){closeSync(fd);throw e;}
}
/** Source-only: the caller must be the owned host notification bridge. */
export async function publishGeneratedImage(library:MediaLibrary,image:GeneratedImage,owner:MediaOwner){
 const check=()=>{owner.authorize();if(owner.signal.aborted||!image.live())throw new Error('Generated image ownership ended');};check();
 const item=image.item;if(item.type!=='imageGeneration'||item.status!=='completed'||typeof item.id!=='string'||!item.id||item.id.length>200||!image.model||image.model==='codex')throw new Error('Unverified generated image identity');
 let bytes:Buffer;
 if(typeof item.result==='string'&&item.result.length&&/^[A-Za-z0-9+/]*={0,2}$/.test(item.result)&&item.result.length%4===0){
  if(item.result.length>Math.ceil(MAX/3)*4)throw new Error('Generated image too large');bytes=Buffer.from(item.result,'base64');if(bytes.toString('base64')!==item.result)throw new Error('Noncanonical generated image');
 }else{
  if(typeof item.savedPath!=='string'||!isAbsolute(item.savedPath))throw new Error('Generated image has no supported PNG output');
  const root=resolve(image.outputRoot),path=resolve(item.savedPath),rel=relative(root,path);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||realpathSync(path)!==resolve(realpathSync(root),rel))throw new Error('Generated image path escapes owned output');
  const before=lstatSync(path);if(!before.isFile()||before.nlink!==1||before.size>MAX||before.size<57||before.birthtimeMs<image.startedAt||before.mtimeMs<image.startedAt)throw new Error('Generated image is not a new bounded regular file');
  const fd=ownedFile(root,rel);try{const stat=fstatSync(fd);if(stat.dev!==before.dev||stat.ino!==before.ino||stat.nlink!==1||!stat.isFile()||stat.size!==before.size)throw new Error('Generated image file changed');bytes=Buffer.alloc(stat.size);let at=0;while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);if(!n)throw new Error('Truncated generated image');at+=n;}const after=fstatSync(fd);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw new Error('Generated image changed while reading');}finally{closeSync(fd);}
 }
 verifyImagePng(bytes);check();
 const identity=sha(JSON.stringify([image.thread,image.turn,item.id]));
 return library.run({schema:1,task:'firstmate-'+identity,project:'studio-firstmate',role:'direct-image',generation:1,type:'image',title:'Firstmate generated image',provider:'codex',model:image.model,dependencies:{source:identity,content:sha(bytes)},origin:'generated'},{signal:owner.signal,authorize:check},async()=>({bytes,mime:'image/png'}));
}
