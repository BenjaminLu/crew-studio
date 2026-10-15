// Optional pinned local renderer. No model command or arbitrary CLI arguments.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync,rmSync,copyFileSync}from'node:fs';
import{join,dirname,relative,posix}from'node:path';import{tmpdir}from'node:os';import{createServer}from'node:net';import{createHash}from'node:crypto';
import{probeProcess}from'../providers/probe-process';
import guardText from './hyperframes-guard.mjs' with {type:'text'};
export const HYPERFRAMES_VERSION='0.8.159';
export type HyperframesTools={node:string;cli:string;browser:string;ffmpeg:string;ffprobe:string};
export type HyperframesInput={project:string;tools:HyperframesTools;authorize():void;signal?:AbortSignal;timeoutMs?:number;onProgress?:(stage:'snapshot'|'check'|'render'|'verify')=>void};
export type HyperframesOutput={bytes:Buffer;sha256:string;codec:'h264';duration:number;width:number;height:number;renderer:string;manifest:Record<string,string>};
export class HyperframesFailure extends Error {
 constructor(message:string,readonly cleanupSafe:boolean){super(message);this.name='HyperframesFailure';}
}
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
/** Closed local-input dialect, checked before any upstream host-side parser runs. */
export async function validateHyperframesReferences(project:string,manifest:Record<string,string>){
 const attribute=(raw:string)=>{
  const names:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',sol:'/',bsol:'\\',colon:':',period:'.',percnt:'%',Tab:'\t',NewLine:'\n'};
  const decoded=raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi,(_,entity)=>{
   if(entity[0]==='#'){const point=Number.parseInt(entity.slice(/^#x/i.test(entity)?2:1),/^#x/i.test(entity)?16:10);if(!point||point>0x10ffff||point>=0xd800&&point<=0xdfff)throw new Error('HyperFrames invalid character reference');return String.fromCodePoint(point);}
   if(!(entity in names))throw new Error('HyperFrames unsupported character reference');return names[entity];
  });if(decoded.includes('&'))throw new Error('HyperFrames unresolved character reference');return decoded;
 };
 const reference=(raw:string,file:string,extension?:RegExp)=>{
  let value=attribute(raw).trim();if(!value||value.startsWith('#'))return;
  for(let i=0;i<4&&value.includes('%');i++){let next:string;try{next=decodeURIComponent(value);}catch{throw new Error('HyperFrames malformed asset reference');}if(next===value)break;value=next;}
  if(value.includes('%')||/[\\\x00-\x20]/.test(value)||/^[/.]|[:?]/.test(value)||value.includes('${')||value.includes('{{'))throw new Error('HyperFrames nonlocal asset reference refused');
  value=value.split('#')[0];
  if(extension&&!extension.test(value))throw new Error('HyperFrames authored text asset type refused');
  // Both the browser-relative and upstream root-relative interpretations must
  // remain within the snapshot. No reader receives traversal, even if clamped.
  if(value.split('/').some(p=>p==='..'||p==='.'||!p))throw new Error('HyperFrames asset traversal refused');
  const local=posix.join(posix.dirname(file),value);
  if(!manifest[local]&&!manifest[value])throw new Error('HyperFrames unowned asset reference refused');
 };
 const unquote=(value:string)=>{value=value.trim();const q=value[0];if(q==='"'||q==="'"){if(value.at(-1)!==q)throw new Error('HyperFrames unterminated asset quote');return value.slice(1,-1);}return value;};
 const css=(source:string,file:string)=>{
  // Every search starts beyond the last consumed delimiter. Unterminated input
  // refuses once, rather than retrying from each repeated opening prefix.
  const chunks:string[]=[];let offset=0;
  while(true){const start=source.indexOf('/*',offset);if(start<0){chunks.push(source.slice(offset));break;}chunks.push(source.slice(offset,start));const end=source.indexOf('*/',start+2);if(end<0)throw new Error('HyperFrames unterminated CSS comment');offset=end+2;}
  const text=chunks.join(''),lower=text.toLowerCase();
  if(text.includes('\\'))throw new Error('HyperFrames escaped CSS refused');
  offset=0;while(true){const start=lower.indexOf('url(',offset);if(start<0)break;const end=text.indexOf(')',start+4);if(end<0)throw new Error('HyperFrames unterminated CSS URL');reference(unquote(text.slice(start+4,end)),file);offset=end+1;}
  offset=0;while(true){const start=lower.indexOf('@import',offset);if(start<0)break;let at=start+7;while(at<text.length&&/\s/.test(text[at]))at++;
   if(lower.startsWith('url(',at)){const end=text.indexOf(')',at+4);if(end<0)throw new Error('HyperFrames unterminated CSS import');reference(unquote(text.slice(at+4,end)),file,/\.css$/i);offset=end+1;}
   else if(text[at]==='"'||text[at]==="'"){const end=text.indexOf(text[at],at+1);if(end<0)throw new Error('HyperFrames unterminated CSS import');reference(text.slice(at+1,end),file,/\.css$/i);offset=end+1;}
   else throw new Error('HyperFrames unsupported CSS import');
  }
 };
 const script=(text:string,file:string)=>{
  // Conservative lexical refusal is linear even for repeated incomplete export
  // statements. Modules/source maps are outside this local classic-script dialect.
  if(/\b(?:import|export)\b|[#@]\s*sourceMappingURL\s*=/m.test(text))throw new Error('HyperFrames authored module/source-map reference refused');
 };
 for(const file of Object.keys(manifest)){
  if(!/\.(?:html|svg|css|js)$/i.test(file))continue;
  const text=readFileSync(join(project,file),'utf8');
  if(/\.css$/i.test(file)){css(text,file);continue;}if(/\.js$/i.test(file)){script(text,file);continue;}
  let styleChunks:string[]=[],scriptChunks:string[]=[];
  await new HTMLRewriter().on('style',{element(){styleChunks=[];},text(chunk){styleChunks.push(chunk.text);if(chunk.lastInTextNode){css(styleChunks.join(''),file);styleChunks=[];}}}).on('script',{element(){scriptChunks=[];},text(chunk){scriptChunks.push(chunk.text);if(chunk.lastInTextNode){script(scriptChunks.join(''),file);scriptChunks=[];}}}).on('*',{element(el){
   if(['video','audio','source'].includes(el.tagName))throw new Error('HyperFrames authored source media refused');
   for(const [name,value]of el.attributes){
    if(/(?:^|[-:])(?:src|href|poster)$/.test(name)||['data-composition-file','background'].includes(name)){
     const ext=name==='data-composition-src'||name==='data-composition-file'?/\.html$/i:el.tagName==='script'&&name==='src'?/\.js$/i:el.tagName==='link'&&name==='href'&&attribute(el.getAttribute('rel')||'').toLowerCase().split(/\s+/).includes('stylesheet')?/\.css$/i:undefined;
     reference(value,file,ext);
    }
    if(name==='srcset'||name==='srcdoc'||name==='xml:base'||name==='data'||el.tagName==='base')throw new Error('HyperFrames unsupported indirect asset reference');
    if(name==='style')css(attribute(value),file);
   }
  }}).transform(new Response(text)).text();
  // Permit the simple HTML declaration; refuse all other declaration forms
  // without a repeated-prefix wildcard scan across authored text.
  const declarations=text.replace(/<!doctype\s+html\s*>/gi,'');
  if(/<\?xml-stylesheet|<!doctype|<!entity/i.test(declarations))throw new Error('HyperFrames external markup declaration refused');
 }
}
async function freePort(){const server=createServer();await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const port=(server.address()as any).port;await new Promise<void>(r=>server.close(()=>r()));return port;}
/** Refuse links/config executables and pin the complete input set before any browser starts. */
function snapshot(from:string,to:string){
 const manifest:Record<string,string>={};let total=0,count=0;
 const visit=(path:string,rel='')=>{if(rel.split('/').length>10)throw new Error('HyperFrames asset depth exceeded');for(const entry of readdirSync(path,{withFileTypes:true})){
  const key=rel?`${rel}/${entry.name}`:entry.name,source=join(path,entry.name),st=lstatSync(source);
  if(st.isSymbolicLink())throw new Error('HyperFrames symlink asset refused');
  if(!/^[A-Za-z0-9_. /-]+$/.test(key)||key.split('/').some(v=>v.startsWith('.')))throw new Error('HyperFrames asset name refused');
  if(st.isDirectory()){if(key!=='assets'&&!key.startsWith('assets/'))throw new Error('HyperFrames input directory refused');mkdirSync(join(to,key),{recursive:true});visit(source,key);continue;}
  if(!st.isFile()||key!=='index.html'&&key!=='BRIEF.md'&&!/^assets\/.+\.(?:html|png|jpe?g|webp|svg|css|js|txt|woff2?)$/i.test(key))throw new Error('HyperFrames input file refused');
  if(++count>64||(total+=st.size)>64*1024*1024)throw new Error('HyperFrames asset size exceeded');
  const bytes=readFileSync(source);if(bytes.length!==st.size)throw new Error('HyperFrames input changed during snapshot');
  // Do not feed playlists/disguised source video into native media discovery.
  // The Node reader fence cannot constrain ffprobe's own filesystem syscalls.
  if(/\.png$/i.test(key)&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||/\.jpe?g$/i.test(key)&&!bytes.subarray(0,3).equals(Buffer.from([255,216,255]))||/\.webp$/i.test(key)&&(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'))throw new Error('HyperFrames raster signature refused');
  manifest[key]=digest(bytes);writeFileSync(join(to,key),bytes);
 }};visit(from);if(!manifest['index.html'])throw new Error('HyperFrames index missing');return manifest;
}
async function runHyperframes(input:HyperframesInput):Promise<HyperframesOutput>{
 let deadline=Infinity;
 const o={...input,tools:{...input.tools}},guard=()=>{if(o.signal?.aborted)throw new Error('HyperFrames cancelled');if(Date.now()>=deadline)throw new Error('HyperFrames deadline expired');o.authorize();};guard();
 const timeout=o.timeoutMs??180000;if(!Number.isInteger(timeout)||timeout<1000||timeout>240000)throw new Error('HyperFrames deadline invalid');
 deadline=Date.now()+timeout;
 const tools=Object.fromEntries(Object.entries(o.tools).map(([key,value])=>[key,realpathSync(value)]))as HyperframesTools;
 const packageRoot=dirname(dirname(tools.cli));if(JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8')).version!==HYPERFRAMES_VERSION)throw new Error('HyperFrames installed version differs from approved pin');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'crew-hyperframes-'))),project=join(root,'project'),home=join(root,'home'),temp=join(root,'tmp');for(const d of[project,home,temp])mkdirSync(d);
 let process:ReturnType<typeof probeProcess>|null=null,cleanup=true;
 const stop=()=>process?.kill();o.signal?.addEventListener('abort',stop,{once:true});
 try{
  const guardSource=join(root,'guard.mjs');writeFileSync(guardSource,guardText);
  guard();o.onProgress?.('snapshot');
  const manifest=snapshot(realpathSync(o.project),project);
  await validateHyperframesReferences(project,manifest);guard();
  const port=await freePort();guard();
  const env={PATH:[dirname(tools.node),dirname(tools.ffmpeg),'/usr/bin','/bin'].join(':'),HOME:home,CFFIXED_USER_HOME:home,MAC_CHROMIUM_TMPDIR:temp,TMPDIR:temp,LANG:'en_US.UTF-8',NODE_OPTIONS:`--import=${guardSource}`,CREW_HF_ROOT:project,CREW_HF_PORT:String(port),CREW_HF_CLI:tools.cli,HYPERFRAMES_BROWSER_PATH:tools.browser,HYPERFRAMES_FFMPEG_PATH:tools.ffmpeg,HYPERFRAMES_FFPROBE_PATH:tools.ffprobe,HYPERFRAMES_NO_TELEMETRY:'1',DO_NOT_TRACK:'1',HYPERFRAMES_SKIP_SKILLS:'1',CI:'1',XDG_CACHE_HOME:join(home,'.cache'),XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),HYPERFRAMES_EXTRACT_CACHE_DIR:join(temp,'frames'),CREW_HF_DEBUG:globalThis.process.env.CREW_HF_DEBUG??'0'};
  const run=async(args:string[],ms=timeout)=>{
   guard();process=probeProcess([tools.node,tools.cli,...args],project,env,undefined,{timeoutMs:Math.min(ms,deadline-Date.now()),bytes:4*1024*1024});
   const code=await process.exited;await process.stop();guard();const output=process.output();
   // Logs stay inside the owned temporary folder and are never returned to a model.
   writeFileSync(join(root,`${args[0]}.log`),output.out+'\n'+output.err);
   if(code!==0||output.failure)throw new Error(`HyperFrames ${args[0]} refused (${output.failure||'nonzero exit'})`);
   return output;
  };
  guard();o.onProgress?.('check');await run(['check',project,'--json']);
  guard();o.onProgress?.('render');
  await run(['render',project,'--quality','looks','--fps','24','--workers','1','--no-browser-gpu','--experimental-fast-capture=false','--output',join(project,'coffee.mp4')]);
  guard();o.onProgress?.('verify');
  const probe=probeProcess([tools.ffprobe,'-v','error','-show_format','-show_streams','-of','json',join(project,'coffee.mp4')],project,env,undefined,{timeoutMs:Math.min(10000,deadline-Date.now()),bytes:65536});process=probe;const code=await probe.exited;await probe.stop();guard();
  if(code!==0||probe.output().failure)throw new Error('HyperFrames MP4 metadata unavailable');
  let meta:any;try{meta=JSON.parse(probe.output().out);}catch{throw new Error('HyperFrames MP4 metadata invalid');}
  const video=meta.streams?.find((s:any)=>s.codec_type==='video'),duration=Number(meta.format?.duration);
  if(!video||video.codec_name!=='h264'||!Number.isFinite(duration)||duration<10||duration>15.1||!Number.isInteger(video.width)||!Number.isInteger(video.height)||video.width>1920||video.height>1920)throw new Error('HyperFrames MP4 contract failed');
  const st=lstatSync(join(project,'coffee.mp4'));if(!st.isFile()||st.isSymbolicLink()||st.size<1000||st.size>64*1024*1024)throw new Error('HyperFrames MP4 output invalid');
  const bytes=readFileSync(join(project,'coffee.mp4'));guard();return{bytes,sha256:digest(bytes),codec:'h264',duration,width:video.width,height:video.height,renderer:`hyperframes@${HYPERFRAMES_VERSION}`,manifest};
 }catch(e){
  // Only explicit diagnostics opt-in source callers retain sanitized tool logs.
  if(globalThis.process.env.CREW_HF_DIAGNOSTIC_DIR){const dest=globalThis.process.env.CREW_HF_DIAGNOSTIC_DIR;for(const f of['check.log','render.log'])try{copyFileSync(join(root,f),join(dest,f));}catch{}}
  throw e;
 }finally{
  o.signal?.removeEventListener('abort',stop);try{if(process)await process.stop();}catch{cleanup=false;}
  if(cleanup)rmSync(root,{recursive:true,force:true});else throw new HyperframesFailure('HyperFrames process death unverified; owned files retained',false);
 }
}
export async function renderHyperframes(input:HyperframesInput):Promise<HyperframesOutput>{
 try{return await runHyperframes(input);}catch(error){if(error instanceof HyperframesFailure)throw error;throw new HyperframesFailure(error instanceof Error?error.message:'HyperFrames refused',true);}
}
