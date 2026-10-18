// Explicit local launch authority, never obtained from an unauthenticated page.
import {discoverInstance,runtimeDir,RuntimePathError,type RunningInstance} from './instance';
import {writeFileSync,mkdirSync,lstatSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {scrubEnv} from './secure';
import {defaultHttpHandler} from './default-browser';
function browserFlag(argv:string[]){const i=argv.indexOf('--browser');if(i>=0&&argv[i+1])return argv[i+1];return argv.find(a=>a.startsWith('--browser='))?.slice(10).trim()||process.env.CREW_BROWSER?.trim()||null;}
export function requestBrowser(instance:RunningInstance){const url=`${instance.origin}/session?t=${encodeURIComponent(instance.token)}`,tool=process.env.CREW_OPEN_TOOL||'open';
 const dir=runtimeDir();mkdirSync(dir,{recursive:true,mode:0o700});const mode=lstatSync(dir);if(mode.isSymbolicLink()||!mode.isDirectory()||mode.uid!==process.getuid?.()||(mode.mode&0o077))throw new RuntimePathError('Browser launch needs the private Studio runtime directory');
 for(const name of readdirSync(dir).filter(n=>/^browser-[a-f0-9-]+\.html$/.test(n))){const path=join(dir,name),s=lstatSync(path);if(s.isFile()&&!s.isSymbolicLink()&&Date.now()-s.mtimeMs>600000)rmSync(path,{force:true});}
 const file=join(dir,`browser-${randomUUID()}.html`),expires=Date.now()+600000;
 writeFileSync(file,`<!doctype html><meta charset="utf-8"><title>Crew Studio</title><script>if(Date.now()<${expires})location.replace(${JSON.stringify(url).replace(/</g,'\\u003c')});</script>`,{mode:0o600,flag:'wx'});
 const timer=setTimeout(()=>rmSync(file,{force:true}),600000);timer.unref();
 const run=(args:string[])=>{try{return Bun.spawnSync([tool,...args,file],{env:scrubEnv(),stdout:'ignore',stderr:'ignore',timeout:5000}).success}catch{return false}};
 let used:string|null=null;if(process.platform==='darwin'||process.env.CREW_OPEN_TOOL){const asked=browserFlag(process.argv.slice(3));if(asked){if(run(['-a',asked]))used=asked;else console.log('Requested browser did not accept the link; trying the default browser.');}
 if(!used){let handler:string|null=null;try{const d=Bun.spawnSync([process.env.CREW_DEFAULTS_TOOL||'defaults','read','com.apple.LaunchServices/com.apple.launchservices.secure','LSHandlers'],{env:scrubEnv(),stdout:'pipe',stderr:'ignore',timeout:3000});if(d.success)handler=defaultHttpHandler(d.stdout.toString())}catch{}if(handler&&run(['-b',handler]))used=`your default browser (${handler})`;else if(run([]))used="the system's default for links";}}
 if(!used){console.error(`Could not request a browser. Studio is running at ${instance.origin}. Retry the launch command with --browser Safari (or another installed browser). Session credentials are never printed.`);return false;}
 console.log(`Requested Studio's authenticated Board in ${used}. Browser dispatch was accepted; a visible window is not verified.`);return true;
}
export async function openStudio(start=false){let instance=await discoverInstance();if(!instance&&start){const {runningInstance}=await import('./server');instance=runningInstance;}if(!instance)throw new Error('No verified running Studio instance matches. Run the same binary with launch (or bun run launch); use CREW_DATA/CREW_PORT only to select a specific instance.');return requestBrowser(instance);}
if(process.argv[2]==='open'||process.argv[2]==='launch'){try{if(!await openStudio(process.argv[2]==='launch'))process.exitCode=1}catch(e){if(e instanceof RuntimePathError)console.error(e.message);console.error('Could not find or open a verified Studio instance. Run this binary with launch, or select the intended CREW_DATA and CREW_PORT. No session credential was created or printed.');process.exit(1)}}
