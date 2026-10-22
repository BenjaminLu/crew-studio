/** Inert transfer packages. No package byte is installed in a runnable registry. */
import {zip,unzip} from './zip';
import {createHash,randomBytes} from 'node:crypto';
import {closeSync,fstatSync,lstatSync,readdirSync,mkdirSync,writeFileSync,renameSync,rmSync,readSync} from 'node:fs';
import {join} from 'node:path';
import {bundledBytes,parseYaml} from './bundled';
import {BUNDLED} from './bundled.gen';
import {workflowDefinitionExport} from './workflow-definition-export';
import {openStoredDescriptor,canCopyByDescriptor} from './untrusted-copy';
import type {WDef} from './runtime/defs';
export const PACKAGE_CAPS={archive:8*1024*1024,file:2*1024*1024,count:200,previews:16,owner:4,memory:32*1024*1024,ttl:300000};
export const packageSha=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const safe=(p:string)=>typeof p==='string'&&p.length<=240&&p.split('/').every(s=>/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(s)&&s!=='.'&&s!=='..');
const ident=(p:string)=>typeof p==='string'&&/^[a-z0-9][a-z0-9-]{0,40}$/.test(p);
const fail=(s:string):never=>{throw new Error(s);};
export type PackageFile={path:string;size:number;sha256:string};
export type PackageManifest={format:'crew-workflow-package';schema:1;profile:'crew-store-v1';source:{workflow:string;version:number;recordSha256:string};files:PackageFile[];dependencies:unknown[];holds:string[]};
type Verified={manifest:PackageManifest;files:Map<string,Buffer>;sha256:string;bytes:Buffer};
/** Read at most the recorded size plus one byte, even if a concurrent writer grows the file. */
export function boundedDescriptorBytes(fd:number,size:number,cap:number):Buffer{
 if(!Number.isSafeInteger(size)||size<0||size>cap)fail('Package source must be a bounded regular file');
 const bytes=Buffer.alloc(size+1);let used=0;while(used<bytes.length){const n=readSync(fd,bytes,used,bytes.length-used,null);if(!n)break;used+=n;}if(used!==size)fail('Package source changed while reading');return bytes.subarray(0,used);
}
/** Existing components are checked for diagnostics, then actually opened by parent descriptor (no path-reuse race). */
export function packageStoredBytes(root:string,rel:string,cap=PACKAGE_CAPS.file):Buffer{
 if(!safe(rel))fail('Noncanonical stored package source path');
 if(lstatSync(root).isSymbolicLink())fail('Package source root is a link');
 let at=root;for(const part of rel.split('/')){at=join(at,part);const st=lstatSync(at);if(st.isSymbolicLink()||(!st.isDirectory()&&!st.isFile()))fail('Package source contains a link or special file');}
 const fd=openStoredDescriptor(root,rel.split('/'));try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.size>cap)fail('Package source must be a bounded regular file');return boundedDescriptorBytes(fd,s.size,cap);}finally{closeSync(fd);}
}
function objectKeys(v:any,keys:string[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('Unknown or invalid manifest fields');}
/** Every entry is checked against both ZIP headers, its CRC and these limits. Exports are stored; imports also accept deflate, capped at each declared size. */
const unzipPackage=(b:Buffer)=>unzip(b,{archive:PACKAGE_CAPS.archive,entry:PACKAGE_CAPS.file,total:PACKAGE_CAPS.archive,count:PACKAGE_CAPS.count,name:safe});
export function encodePackage(files:Map<string,Buffer>,manifest:PackageManifest):Buffer{
 const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2));let total=manifestBytes.length;if(manifestBytes.length>PACKAGE_CAPS.file||files.size+1>PACKAGE_CAPS.count)fail('Package inventory exceeds limits');for(const [path,b]of files){if(!safe(path)||b.length>PACKAGE_CAPS.file)fail('Package source file exceeds profile limits');total+=b.length;if(total>PACKAGE_CAPS.archive-65536)fail('Package source exceeds total size limit');}
 const entries=[...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,data])=>({name,data}));
 const bytes=zip([...entries,{name:'manifest.json',data:manifestBytes}],{store:true,mode:0o100600});unzipPackage(bytes);return bytes;
}
export function verifyPackage(bytes:Buffer):Verified{
 const files=unzipPackage(bytes);
 let m:any;try{m=JSON.parse(files.get('manifest.json')?.toString('utf8')??'');}catch{fail('Missing or malformed manifest');}
 objectKeys(m,['format','schema','profile','source','files','dependencies','holds']);if(m.format!=='crew-workflow-package'||m.schema!==1||m.profile!=='crew-store-v1')fail('Unsupported Crew package format');
 objectKeys(m.source,['workflow','version','recordSha256']);if(!ident(m.source.workflow)||!Number.isSafeInteger(m.source.version)||m.source.version<1||!/^[a-f0-9]{64}$/.test(m.source.recordSha256)||!Array.isArray(m.files)||m.files.length>PACKAGE_CAPS.count-1||!Array.isArray(m.dependencies)||m.dependencies.length>400||!Array.isArray(m.holds)||m.holds.length>200||m.holds.some((x:any)=>typeof x!=='string'||x.length>1000))fail('Invalid package manifest');
 const stack=m.dependencies.map((value:any)=>({value,depth:0}));let entries=0;while(stack.length){const {value,depth}=stack.pop()!;if(depth>8||++entries>4000)fail('Package dependency metadata is too deeply nested or large');if(value&&typeof value==='object'){const keys=Object.keys(value);if(keys.length>400)fail('Package dependency metadata has too many children');for(const key of keys)stack.push({value:value[key],depth:depth+1});}}
 if(JSON.stringify(m.dependencies).length>65536)fail('Package dependency metadata exceeds 64 KiB');
 const declared=new Set<string>();for(const f of m.files){objectKeys(f,['path','size','sha256']);if(!safe(f.path)||f.path==='manifest.json'||declared.has(f.path)||!Number.isSafeInteger(f.size)||!/^([a-f0-9]{64})$/.test(f.sha256))fail('Invalid package file declaration');declared.add(f.path);const b=files.get(f.path);if(!b||b.length!==f.size||packageSha(b)!==f.sha256)fail('Missing or changed package file: '+f.path);}
 if(files.size!==declared.size+1||!declared.has('workflow/definition.json'))fail('Undeclared or missing workflow files');
 let definition:any;try{definition=JSON.parse(files.get('workflow/definition.json')!.toString('utf8'));}catch{fail('Invalid workflow declaration JSON');}
 if(!definition||definition.id!==m.source.workflow||definition.version!==m.source.version||!Array.isArray(definition.nodes)||!Array.isArray(definition.edges)||!Array.isArray(definition.roles))fail('Workflow declaration does not match manifest source');
 // Packages are untrusted: producer claims are never destination compatibility or execution authority.
 return {manifest:m,files,sha256:packageSha(bytes),bytes};
}
export function snapshotPackage(def:WDef,data:string):Buffer{
 const exported=workflowDefinitionExport(def),files=new Map<string,Buffer>(),holds:string[]=[];
 files.set('workflow/definition.json',Buffer.from(JSON.stringify(exported.definition)));
 holds.push('Entire execution declaration is not semantically classified in phase 1. This inventory is not complete execution dependency closure; local adoption must validate every field.');
 for(const key of exported.compatibility.unsupportedFields)holds.push('Unsupported workflow field preserved: '+key);
 const add=(p:string,b:Buffer)=>{if(files.size>=PACKAGE_CAPS.count-1||[...files.values()].reduce((n,f)=>n+f.length,b.length)>PACKAGE_CAPS.archive-65536)fail('Package dependency inventory exceeds total limits');if(!safe(p)||b.length>PACKAGE_CAPS.file)fail('Unsupported package file');if(files.has(p)&&!files.get(p)!.equals(b))fail('Conflicting dependency bytes');files.set(p,b);};
 // Role overrides have an independent version history. Read its explicit immutable last record without ensure/refresh.
 for(const role of def.roles??[]){if(!ident(role.id))fail('Invalid role identity');const indexPath=`skills/${def.id}/${role.id}/index.json`;let idx:any;try{idx=JSON.parse(packageStoredBytes(data,indexPath).toString('utf8'));}catch(e:any){if(e?.code==='ENOENT')continue;throw e;}if(!Array.isArray(idx)||!idx.length)continue;const rec=idx.at(-1);if(!Number.isSafeInteger(rec.n)||rec.n<1||!/^[a-f0-9]{64}$/.test(rec.sha256))fail('Invalid role version record');const b=packageStoredBytes(data,`skills/${def.id}/${role.id}/v${rec.n}.md`);if(packageSha(b)!==rec.sha256)fail('Stored role version changed');const path=`roles/${role.id}-v${rec.n}-${rec.sha256}.md`;add(path,b);exported.dependencies.push({kind:'role-version-snapshot',ref:`${def.id}/${role.id}@v${rec.n}`,sha256:rec.sha256,status:'pinned-reference',locations:[`roles.${role.id}`]});}
 for(const dep of exported.dependencies){
  if(dep.kind==='library-skill'){
   const match=/^([a-z0-9][a-z0-9-]{0,40})@v([1-9][0-9]*)$/.exec(dep.ref);if(!match){holds.push('Invalid library skill reference: '+dep.ref);continue;}
   const [,id,v]=match,root=join(data,'skills','_library',id);let rec:any;try{const idx=JSON.parse(packageStoredBytes(data,`skills/_library/${id}/index.json`).toString('utf8'));rec=idx.find((x:any)=>x.n===Number(v));}catch{holds.push('Missing exact library version: '+dep.ref);continue;}
   if(!rec||rec.sha256!==dep.sha256||!Array.isArray(rec.files)){holds.push('Library text pin mismatch: '+dep.ref);continue;}
   const pins=exported.dependencies.filter(x=>x.kind==='skill-files'&&x.ref===dep.ref);if(pins.some(x=>x.sha256!==rec.filesSha256))fail('Library files pin mismatch: '+dep.ref);
   if(rec.files.length>PACKAGE_CAPS.count-files.size-2||new Set(rec.files).size!==rec.files.length)fail('Recorded skill inventory exceeds count limit or repeats paths');
   const available=PACKAGE_CAPS.archive-65536-[...files.values()].reduce((n,b)=>n+b.length,0);
   const text=packageStoredBytes(data,`skills/_library/${id}/v${v}/SKILL.md`,Math.min(PACKAGE_CAPS.file,available)),support=new Map<string,Buffer>();if(packageSha(text)!==rec.sha256)fail('Stored skill text changed: '+dep.ref);
   let retained=text.length;for(const p of rec.files){if(!safe(p))fail('Invalid recorded skill file');const remaining=available-retained;if(remaining<0)fail('Recorded skill inventory exceeds total size limit');const b=packageStoredBytes(data,`skills/_library/${id}/v${v}/files/${p}`,Math.min(PACKAGE_CAPS.file,remaining));retained+=b.length;support.set(p,b);}
   const hash=packageSha([...support].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([p,b])=>`${p}\0${packageSha(b)}`).join('\n'));if(hash!==rec.filesSha256)fail('Stored skill supporting files changed: '+dep.ref);
   add(`skills/${id}/v${v}/SKILL.md`,text);for(const [p,b]of support)add(`skills/${id}/v${v}/files/${p}`,b);
  }else if(dep.kind==='role-skill'){
   for(const ref of dep.ref.split('+')){const path=ref.startsWith('bundled:')?ref.slice(8):ref.startsWith('pack:')?'packs/'+ref.slice(5):null;if(!path||!Object.hasOwn(BUNDLED,path)){holds.push('Role source is not a portable bundled file: '+ref);continue;}const b=bundledBytes(path);if(!b){holds.push('Missing role source: '+ref);continue;}add(`roles/${packageSha(b)}.md`,Buffer.from(b));}
   // Stored role overrides are mutable independently of WDef. Do not claim exported source equals runtime text.
   holds.push('Role text is a source snapshot; independently edited role versions require local adoption review: '+dep.ref);
  }else if(!['skill-files','provider','model'].includes(dep.kind))holds.push(`Runtime dependency requires local compatibility review: ${dep.kind} ${dep.ref}`);
 }
 if(def.nodes.some(n=>n.checks?.some(c=>c.use==='core/artifact-ready'))){const b=bundledBytes('packs/core/checks/artifact-ready/check.yaml');if(!b)fail('Missing destination-owned readiness manifest');add('capabilities/core/artifact-ready/check.yaml',Buffer.from(b));const meta:any=parseYaml(Buffer.from(b).toString('utf8'));(exported.dependencies as unknown[]).push({kind:'application-capability',ref:'core/artifact-ready',version:meta.version,native:meta.native,contract:'crew-personal-deliver-v1',path:'capabilities/core/artifact-ready/check.yaml',sha256:packageSha(b)});}
 holds.push('Saved transfer package only. Not installed, runnable, verified or approved. Explicit local adoption and separate local approvals are required.');
 const manifest:PackageManifest={format:'crew-workflow-package',schema:1,profile:'crew-store-v1',source:{workflow:def.id,version:def.version,recordSha256:packageSha(JSON.stringify(def))},files:[...files].map(([path,b])=>({path,size:b.length,sha256:packageSha(b)})),dependencies:exported.dependencies,holds};
 const bytes=encodePackage(files,manifest);verifyPackage(bytes);return bytes;
}
export class WorkflowPackages{
 private previews=new Map<string,{owner:string;at:number;value:Verified}>();
 readonly root:string;
 constructor(readonly data:string,private now=()=>Date.now()){this.root=join(data,'workflow-packages');}
 private prune(){for(const [k,p]of this.previews)if(this.now()-p.at>=PACKAGE_CAPS.ttl)this.previews.delete(k);}
 private view(v:Verified){return {storageAvailable:canCopyByDescriptor()||process.platform==='linux',sha256:v.sha256,manifest:v.manifest,files:v.manifest.files,status:'held',notice:'Inert package draft; local workflow adoption is not implemented. No script, check or asset is executed.'};}
 preview(owner:string,base64:string){this.prune();if(typeof base64!=='string'||base64.length>Math.ceil(PACKAGE_CAPS.archive/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))fail('Invalid or oversized ZIP upload');const bytes=Buffer.from(base64,'base64');if(this.previews.size>=PACKAGE_CAPS.previews||[...this.previews.values()].filter(p=>p.owner===owner).length>=PACKAGE_CAPS.owner||[...this.previews.values()].reduce((n,p)=>n+p.value.bytes.length*2,bytes.length*2)>PACKAGE_CAPS.memory)fail('Too many package previews; cancel an earlier preview');const value=verifyPackage(bytes),token=randomBytes(24).toString('hex');this.previews.set(token,{owner,at:this.now(),value});return {token,...this.view(value)};}
 private pending(owner:string,token:string){this.prune();const p=this.previews.get(token);if(!p||p.owner!==owner)fail('Package preview expired or belongs to another session; preview again');return p;}
 cancel(owner:string,token:string){this.pending(owner,token);this.previews.delete(token);return {cancelled:true};}
 file(owner:string,token:string,path:string){const v=this.pending(owner,token).value,b=v.files.get(path);if(!b)fail('No such package file');if(b.length>256*1024||b.includes(0))return {path,viewable:false,reason:'Binary or large file; source preview is unavailable'};let text:string;try{text=new TextDecoder('utf8',{fatal:true}).decode(b);}catch{return {path,viewable:false,reason:'Not UTF-8 text'};}return {path,viewable:true,text,sha256:packageSha(b)};}
 commit(owner:string,token:string){if(!canCopyByDescriptor()&&process.platform!=='linux')fail('Safe package storage currently requires macOS arm64 or Linux procfs');const p=this.pending(owner,token);this.previews.delete(token);const id='pkg-'+randomBytes(12).toString('hex');mkdirSync(this.root,{recursive:true,mode:0o700});const stage=join(this.root,'.stage-'+id),out=join(this.root,id);mkdirSync(stage,{mode:0o700});try{writeFileSync(join(stage,'package.zip'),p.value.bytes,{flag:'wx',mode:0o600});writeFileSync(join(stage,'receipt.json'),JSON.stringify({id,sha256:p.value.sha256,savedAt:new Date(this.now()).toISOString(),status:'held'}),{flag:'wx',mode:0o600});renameSync(stage,out);}catch(e){rmSync(stage,{recursive:true,force:true});throw e;}return {id,...this.view(p.value)};}
 list(){let names:string[];try{names=readdirSync(this.root);}catch{return [];}return names.filter(n=>/^pkg-[a-f0-9]{24}$/.test(n)).map(id=>{const v=this.read(id);return {id,...this.view(v)};});}
 read(id:string){if(!/^pkg-[a-f0-9]{24}$/.test(id))fail('Invalid saved package identity');const value=verifyPackage(packageStoredBytes(this.data,`workflow-packages/${id}/package.zip`,PACKAGE_CAPS.archive));const receipt=JSON.parse(packageStoredBytes(this.data,`workflow-packages/${id}/receipt.json`).toString('utf8'));if(receipt.id!==id||receipt.sha256!==value.sha256||receipt.status!=='held')fail('Saved package receipt does not match archive');return value;}
 reopen(owner:string,id:string){return this.preview(owner,this.read(id).bytes.toString('base64'));}
 remove(id:string){this.read(id);rmSync(join(this.root,id),{recursive:true});return {deleted:id};}
}
