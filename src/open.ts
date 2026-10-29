// Explicit local launch authority, never obtained from an unauthenticated page.
import {discoverInstance,runtimeDir,RuntimePathError,type RunningInstance} from './instance';
import {writeFileSync,mkdirSync,lstatSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {scrubEnv} from './secure';
import {defaultHttpHandler} from './default-browser';
function browserFlag(argv:string[]){const i=argv.indexOf('--browser');if(i>=0&&argv[i+1])return argv[i+1];return argv.find(a=>a.startsWith('--browser='))?.slice(10).trim()||process.env.CREW_BROWSER?.trim()||null;}
type Find={tool?:string;env?:Record<string,string|undefined>;exists?:(p:string)=>boolean;which?:(b:string)=>string|null};
/**
 * The commands that open `target` (the private redirect file's file: URL, never a URL with the session token) as a Studio
 * window: a Chromium browser's app window (--app), which keeps no key for itself, so the terminal page gets the new-tab,
 * close and new-window chords (docs/units/web-terminal.md). macOS asks LaunchServices for each browser by name (open fails
 * when it is not installed); Windows and Linux list only the browsers found. Empty: no Chromium, open the default browser.
 */
export function appWindowCommands(platform:string,target:string,o:Find={}):string[][]{
 const app=`--app=${target}`,env=o.env??process.env,exists=o.exists??existsSync,which=o.which??((b:string)=>Bun.which(b));
 if(platform==='darwin')return ['Google Chrome','Microsoft Edge','Brave Browser','Chromium'].map(a=>[o.tool??'open','-na',a,'--args',app]);
 if(platform==='win32'){const roots=[env.ProgramFiles,env['ProgramFiles(x86)'],env.LOCALAPPDATA].filter((r):r is string=>!!r);
  const exes=['Google\\Chrome\\Application\\chrome.exe','Microsoft\\Edge\\Application\\msedge.exe','BraveSoftware\\Brave-Browser\\Application\\brave.exe'].flatMap(rel=>roots.map(r=>`${r}\\${rel}`));
  return exes.filter(p=>exists(p)).map(p=>[p,app]);}
 return ['google-chrome','google-chrome-stable','chromium','chromium-browser','microsoft-edge','brave-browser'].map(b=>which(b)).filter((p):p is string=>!!p).map(p=>[p,app]);
}
/** The system's own opener for a file outside macOS (macOS keeps its LaunchServices path below). */
export const defaultOpenCommand=(platform:string,file:string):string[]=>platform==='win32'?['cmd','/c','start','',file]:['xdg-open',file];
/** A started process: its exit (a status), and, for a browser started on its own, a way to let it outlive Studio. */
export type Proc={exited:Promise<number|null>;unref?:()=>void;kill?:()=>void};
export type BrowserOpts={app?:boolean;platform?:string;argv?:string[];find?:Find;
 /** starts a command (tests inject one); detach: a browser itself, which runs for as long as its window is open */
 start?:(cmd:string[],detach:boolean)=>Proc;
 /** how long an opener (open, xdg-open, start) may take to answer before the next is tried; default 5 s */
 waitMs?:number};
const startProc=(cmd:string[],detach:boolean):Proc=>{const p=Bun.spawn(cmd,{env:scrubEnv(),stdio:['ignore','ignore','ignore'],...(detach?{detached:true}:{})} as any);if(detach)p.unref();return p;};
/**
 * Opens Studio's session link; answers what took it (named in the output), or false. With app, a Studio window first.
 * Never blocks: the page's "Open in a Studio window" runs it inside the server. An opener (open, xdg-open, start) answers
 * at once and is waited for, at most waitMs, without blocking; a browser started directly (Windows, Linux) is the browser,
 * so it is started detached and never waited for or stopped: started is accepted.
 */
export async function requestBrowser(instance:RunningInstance,opts:BrowserOpts={}):Promise<string|false>{
 const argv=opts.argv??process.argv.slice(3),platform=opts.platform??process.platform,start=opts.start??startProc,waitMs=opts.waitMs??5000;
 // a Studio window unless the captain asks for a tab (--tab, CREW_APP_WINDOW=0) or names a browser (--browser)
 const asked=browserFlag(argv),app=opts.app??(!asked&&!argv.includes('--tab')&&process.env.CREW_APP_WINDOW!=='0');
 const link=(w:boolean)=>`${instance.origin}/session?t=${encodeURIComponent(instance.token)}${w?'&w=app':''}`,tool=process.env.CREW_OPEN_TOOL||'open';
 const dir=runtimeDir();mkdirSync(dir,{recursive:true,mode:0o700});const mode=lstatSync(dir);if(mode.isSymbolicLink()||!mode.isDirectory()||mode.uid!==process.getuid?.()||(mode.mode&0o077))throw new RuntimePathError('Browser launch needs the private Studio runtime directory');
 for(const name of readdirSync(dir).filter(n=>/^browser-[a-f0-9-]+\.html$/.test(n))){const path=join(dir,name),s=lstatSync(path);if(s.isFile()&&!s.isSymbolicLink()&&Date.now()-s.mtimeMs>600000)rmSync(path,{force:true});}
 const file=join(dir,`browser-${randomUUID()}.html`),expires=Date.now()+600000;
 // the Studio window's link says so (&w=app); when no app window opens, the same private file is rewritten with the plain link
 const redirect=(w:boolean,flag:string)=>writeFileSync(file,`<!doctype html><meta charset="utf-8"><title>Crew Studio</title><script>if(Date.now()<${expires})location.replace(${JSON.stringify(link(w)).replace(/</g,'\\u003c')});</script>`,{mode:0o600,flag});
 redirect(app,'wx');
 const timer=setTimeout(()=>rmSync(file,{force:true}),600000);timer.unref();
 const waitRun=async(cmd:string[])=>{let p:Proc;try{p=start(cmd,false)}catch{return false}
  let t:any;const code=await Promise.race([p.exited,new Promise<'late'>(r=>{t=setTimeout(()=>r('late'),waitMs)})]);clearTimeout(t);
  if(code==='late'){try{p.kill?.()}catch{}return false}return code===0;};
 const detachRun=(cmd:string[])=>{try{start(cmd,true);return true}catch{return false}};
 const run=(args:string[])=>waitRun([tool,...args,file]);
 const appWindow=async()=>{for(const cmd of appWindowCommands(platform,pathToFileURL(file).href,{tool,...opts.find}))
   if(platform==='darwin'?await waitRun(cmd):detachRun(cmd))return `a Studio window (${platform==='darwin'?cmd[2]:cmd[0].split(/[\\/]/).pop()})`;
  redirect(false,'w');return null;};
 let used:string|null=null;if(platform==='darwin'||process.env.CREW_OPEN_TOOL){if(asked){if(await run(['-a',asked]))used=asked;else console.log('Requested browser did not accept the link; trying the default browser.');}
 if(!used&&app)used=await appWindow();
 if(!used){let handler:string|null=null;try{const d=Bun.spawn([process.env.CREW_DEFAULTS_TOOL||'defaults','read','com.apple.LaunchServices/com.apple.launchservices.secure','LSHandlers'],{env:scrubEnv(),stdout:'pipe',stderr:'ignore'});
   let t:any;const out=await Promise.race([Promise.all([new Response(d.stdout).text(),d.exited]),new Promise<null>(r=>{t=setTimeout(()=>r(null),3000)})]);clearTimeout(t);
   if(out&&out[1]===0)handler=defaultHttpHandler(out[0]);else if(!out)d.kill();}catch{}
  if(handler&&await run(['-b',handler]))used=`your default browser (${handler})`;else if(await run([]))used="the system's default for links";}}
 else{if(app)used=await appWindow();if(!used&&await waitRun(defaultOpenCommand(platform,file)))used="the system's default for links";}
 if(!used){clearTimeout(timer);rmSync(file,{force:true}); // nothing will read it
  console.error(`Could not request a browser. Studio is running at ${instance.origin}. Retry the launch command with --browser Safari (or another installed browser). Session credentials are never printed.`);return false;}
 console.log(`Requested Studio's authenticated Board in ${used}. Browser dispatch was accepted; a visible window is not verified.`);return used;
}
export async function openStudio(start=false){let instance=await discoverInstance();if(!instance&&start){const {runningInstance}=await import('./server');instance=runningInstance;}if(!instance)throw new Error('No verified running Studio instance matches. Run the same binary with launch (or bun run launch); use CREW_DATA/CREW_PORT only to select a specific instance.');return requestBrowser(instance);}
if(process.argv[2]==='open'||process.argv[2]==='launch'){try{if(!await openStudio(process.argv[2]==='launch'))process.exitCode=1}catch(e){if(e instanceof RuntimePathError)console.error(e.message);console.error('Could not find or open a verified Studio instance. Run this binary with launch, or select the intended CREW_DATA and CREW_PORT. No session credential was created or printed.');process.exit(1)}}
