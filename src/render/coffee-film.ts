// Source-owned composition factory. Only signed native coffee inputs reach this adapter.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,lstatSync,realpathSync,rmSync,existsSync,accessSync,constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {renderHyperframes,HyperframesFailure,HYPERFRAMES_VERSION,type HyperframesTools,type HyperframesInput,type HyperframesOutput} from './hyperframes';
import type {CoffeeDirection} from '../domain/coffee-kit';
import {verifyImagePng} from '../providers/codex-image';
import {validateCoffeeDesign,coffeeDesignHash} from '../domain/coffee-design';
import {probeProcess} from '../providers/probe-process';
import {bundledText} from '../bundled';
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
/** Film body text: the first approved brand color that meets WCAG AA (4.5:1) on the film background, else black or white.
 * HyperFrames `check` refuses AA failures, so the template never trusts palette order for text. */
export function coffeeTextColor(background:string,candidates:string[]):string {
 const luminance=(hex:string)=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const bg=luminance(background),ratio=(color:string)=>{const fg=luminance(color);return(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);};
 return candidates.find(color=>ratio(color)>=4.5)??(['#000000','#ffffff'].sort((a,b)=>ratio(b)-ratio(a))[0]);
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export type CoffeeFilmRequest={direction:CoffeeDirection;image:string;page:string;revision:{target:string;note:string}|null;context?:{requests:{target:string;originalCaptainComment:string}[]};signal:AbortSignal;authorize():void;onProgress?:(stage:'snapshot'|'check'|'render'|'verify')=>void;failedInputDigest?:string|null};
export type CoffeeFilmCapability={ready:true;tools:HyperframesTools;gsap:string}|{ready:false;reason:string};
/** Read installed tool metadata only: no browser, download, login or global mutation. */
export function coffeeFilmCapability(root:string,options:{browser?:string|null;playwright?:string|null;ffmpeg?:string|null;ffprobe?:string|null}={}):CoffeeFilmCapability {
 try{
  const packages=[['hyperframes',HYPERFRAMES_VERSION],['node','22.22.0'],['gsap','3.14.2']];
  for(const [name,version]of packages)if(JSON.parse(readFileSync(join(root,'node_modules',name,'package.json'),'utf8')).version!==version)throw new Error(`Pinned ${name} ${version} is unavailable`);
  let browser=options.browser;
  if(!browser&&options.playwright){const require=createRequire(join(realpathSync(root),'package.json'));browser=require(options.playwright).chromium.executablePath();}
  const tools={node:join(root,'node_modules/node/bin/node'),cli:join(root,'node_modules/hyperframes/bin/hyperframes.mjs'),browser:browser??'',ffmpeg:options.ffmpeg??'',ffprobe:options.ffprobe??''};
  const gsap=join(root,'node_modules/gsap/dist/gsap.min.js');
  for(const [name,path]of Object.entries({...tools,gsap})){if(!path||!lstatSync(realpathSync(path)).isFile())throw new Error(`Local ${name} is unavailable`);accessSync(path,name==='cli'||name==='gsap'?constants.R_OK:constants.X_OK);}
  return{ready:true,tools,gsap};
 }catch(error){return{ready:false,reason:error instanceof Error?error.message:'Local film tools unavailable'};}
}
/** Ordered explicit/managed/application discovery, retaining each failure for Doctor. */
export function discoverCoffeeFilmCapability(roots:string[],options:Parameters<typeof coffeeFilmCapability>[1]={}):CoffeeFilmCapability {
 const failures:string[]=[];
 for(const root of [...new Set(roots)]){const result=coffeeFilmCapability(root,options);if(result.ready)return result;failures.push(`${root}: ${result.reason}`);}
 return{ready:false,reason:failures.join('; ')||'Pinned local HyperFrames tools are not installed'};
}
/** Escaped, deterministic, seekable 12-second composition from the exact shared inputs. */
export async function renderCoffeeFilm(request:CoffeeFilmRequest,capability:Extract<CoffeeFilmCapability,{ready:true}>,render:(input:HyperframesInput)=>Promise<HyperframesOutput>=renderHyperframes):Promise<HyperframesOutput&{poster:Buffer}>{
 const guard=()=>{if(request.signal.aborted)throw new HyperframesFailure('Coffee film cancelled',true);request.authorize();};guard();
 const d=structuredClone(request.direction),revision=structuredClone(request.revision),plan=validateCoffeeDesign(d.design);
 if(d.designHash!==coffeeDesignHash(plan))throw new HyperframesFailure('Coffee design plan hash differs',true);
 let motion=1;
 const videoRequests=request.context?.requests.filter(r=>r.target==='video').map(r=>r.originalCaptainComment)??(revision?.target==='video'?[revision.note]:[]);
 for(const note of videoRequests){
  if(/(?:no motion|still|stop animation|不要動|不动|靜止|静止)/i.test(note))motion=0;
  else if(/(?:less motion|slower|gentler|calmer|少.*動|少.*动|慢|柔和)/i.test(note))motion=.35;
  else if(/(?:more motion|more dynamic|活潑|活泼|更多動|更多动)/i.test(note))motion=1.35;
  else throw new HyperframesFailure('Discuss a revised storyboard for this video change; supported motion feedback is less motion, no motion, or more motion.',true);
 }
 const root=realpathSync(mkdtempSync(join(tmpdir(),'crew-coffee-film-')));let cleanupSafe=true;
 try{
  const assets=join(root,'assets');mkdirSync(assets);
  const read=(file:string,max:number)=>{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw new Error('Coffee film input refused');return readFileSync(file);};
  const image=read(request.image,64*1024*1024),page=read(join(request.page,'index.html'),1024*1024),gsap=read(capability.gsap,1024*1024);
  guard();writeFileSync(join(assets,'coffee.png'),image);writeFileSync(join(assets,'gsap.min.js'),gsap);
  // The page is a bound dependency, never executable code in the film composition.
  const profile=bundledText('packs/coffee-kit/skills/hyperframes.md');if(!profile)throw new Error('Pinned HyperFrames instruction profile missing');writeFileSync(join(assets,'hyperframes-profile.txt'),profile);
  writeFileSync(join(root,'BRIEF.md'),JSON.stringify({version:1,profileSHA256:hash(profile),direction:d,revision,context:request.context??null,imageSHA256:hash(image),pageSHA256:hash(page),gsapSHA256:hash(gsap),duration:12},null,2));
  const [cream,wood,accent]=plan.brand.palette,pad=plan.brand.spacing[3],font=plan.brand.typography==='serif-sans'?'Georgia,serif':'Arial,sans-serif';
  const textColor=coffeeTextColor(cream,[wood,accent]);
  const scenes=plan.video.beats.map((beat,n)=>`<section id="scene${n}" class="clip" data-start="${beat.start}" data-duration="${n<2?4.35:4}"><img id="photo${n}" class="photo" src="assets/coffee.png" alt="${escape(plan.image.alt)}"><div class="shade"></div><div class="copy" id="copy${n}"><div class="rule"></div><h1>${escape(beat.title)}</h1><p>${escape(beat.caption)}</p>${n===2?`<div class="cta">${escape(plan.video.cta)} →</div>`:''}</div><div class="footer">${escape(plan.name)}</div></section>`).join('');
  const choreography=plan.video.beats.map((beat,n)=>{
    const amplitude=18*motion,zoom=motion*.08,from=beat.motion==='pan-left'?amplitude:beat.motion==='pan-right'?-amplitude:0,to=-from;
    const startScale=beat.motion==='zoom-out'?1.08+zoom:1.08,endScale=beat.motion==='zoom-in'?1.08+zoom:1.08;
    const photo=beat.motion==='still'||motion===0?'':`tl.fromTo('#photo${n}',{x:${from},scale:${startScale}},{x:${to},scale:${endScale},duration:4.35,ease:'none'},${beat.start});`;
    return photo+`tl.fromTo('#copy${n} h1,#copy${n} p,#copy${n} .rule,#copy${n} .cta',{opacity:0,y:${motion===0?0:20*motion}},{opacity:1,y:0,duration:${motion===0?.15:.7},stagger:.1,ease:'power2.out'},${beat.start+.12});`+(n?`tl.fromTo('#scene${n}',{opacity:0${plan.video.transition==='slide'&&motion?',x:16':''}},{opacity:1,x:0,duration:.35,ease:'power2.out'},${beat.start});`:'');
  }).join('');
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${escape(plan.name)}</title><script src="assets/gsap.min.js"></script><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:${cream};color:${textColor};font-family:${font}}#coffee{position:relative;width:100%;height:100%;overflow:hidden}.clip{position:absolute;inset:0;overflow:hidden}.photo{position:absolute;right:0;top:0;width:68%;height:100%;object-fit:cover;object-position:${plan.integration.mobileCrop};transform-origin:50% 50%}.shade{position:absolute;inset:0;background:linear-gradient(90deg,${cream} 0%,${cream} 31%,${cream}ee 43%,${cream}00 73%)}.copy{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;width:47%;padding:${pad}px;overflow:hidden}.copy h1{font-size:46px;line-height:1.08;font-weight:400;margin:0 0 20px;overflow-wrap:anywhere}.copy p{font:17px/1.65 Arial,sans-serif;overflow-wrap:anywhere}.rule{width:48px;height:3px;background:${accent};margin-bottom:24px}.footer{position:absolute;left:${pad}px;bottom:24px;font:12px Arial,sans-serif}.cta{font:14px Arial,sans-serif;border-bottom:1px solid ${accent};align-self:flex-start;padding-bottom:8px;margin-top:18px}</style></head><body><div id="coffee" data-composition-id="coffee" data-width="960" data-height="540" data-duration="12" data-start="0" data-fps="24">${scenes}</div><script>const tl=gsap.timeline({paused:true});${choreography}window.__timelines=window.__timelines||{};window.__timelines.coffee=tl;</script></body></html>`;
  writeFileSync(join(root,'index.html'),html);guard();
  const result=await render({project:root,tools:capability.tools,signal:request.signal,authorize:guard,onProgress:request.onProgress,failedInputDigest:request.failedInputDigest??null});guard();
  writeFileSync(join(root,'render.mp4'),result.bytes);const home=join(root,'home'),tmp=join(root,'tmp');mkdirSync(home);mkdirSync(tmp);
  const process=probeProcess([capability.tools.ffmpeg,'-v','error','-i',join(root,'render.mp4'),'-frames:v','1','-y',join(root,'poster.png')],root,{PATH:dirname(capability.tools.ffmpeg)+':/usr/bin:/bin',HOME:home,TMPDIR:tmp},undefined,{timeoutMs:10000,bytes:65536});
  const abort=()=>process.kill();request.signal.addEventListener('abort',abort,{once:true});
  try{const code=await process.exited;await process.stop();guard();if(code!==0||process.output().failure)throw new Error('First-frame poster unavailable');}
  finally{request.signal.removeEventListener('abort',abort);try{await process.stop();}catch{cleanupSafe=false;throw new HyperframesFailure('Poster process death unverified',false);}}
  const poster=read(join(root,'poster.png'),4*1024*1024);verifyImagePng(poster);guard();return{...result,poster};
 }catch(error){cleanupSafe=cleanupSafe&&(error instanceof HyperframesFailure?error.cleanupSafe:true);throw error instanceof HyperframesFailure?error:new HyperframesFailure(error instanceof Error?error.message:'Coffee film refused',cleanupSafe);}
 finally{if(cleanupSafe)rmSync(root,{recursive:true,force:true});}
}

// Host-owned playback only. Authored pages never acquire parent/script/network authority.
export const COFFEE_PLAYBACK_SCRIPT=`(()=>{
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),zh=document.documentElement.lang.toLowerCase().startsWith('zh');
 for(const v of document.querySelectorAll('video.coffee-native-film')){
  const frame=document.createElement('div');frame.className='coffee-film-player';v.before(frame);frame.append(v);
  const button=document.createElement('button');button.type='button';button.className='coffee-film-toggle';frame.append(button);
  let posterOnly=false;
  const sync=()=>{const label=v.paused?(posterOnly?(zh?'仍要播放影片':'Play film with motion'):(zh?'播放影片':'Play film')):(zh?'暫停影片':'Pause film');button.textContent=label;button.setAttribute('aria-label',label);};
  button.onclick=()=>{if(v.paused){posterOnly=false;v.controls=true;v.play().catch(()=>{if(reduced.matches)apply();else sync();});}else v.pause();};
  v.addEventListener('play',sync);v.addEventListener('pause',sync);
  const apply=()=>{if(reduced.matches){v.pause();v.removeAttribute('autoplay');posterOnly=true;v.controls=false;v.load();}else{posterOnly=false;v.controls=true;}sync();};
  apply();reduced.addEventListener('change',apply);
 }
})();`;

export async function integrateCoffeeSite(html:string,design:unknown):Promise<string>{
 const p=validateCoffeeDesign(design),style=`<style>video.coffee-native-film{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;object-position:${p.integration.mobileCrop};background:${p.brand.palette[1]}}.coffee-film-player{position:relative;width:100%;aspect-ratio:16/9}.coffee-film-toggle{position:absolute;top:12px;left:12px;z-index:1;max-width:calc(100% - 24px);min-height:44px;padding:10px 18px;border:1px solid currentColor;border-radius:999px;background:${p.brand.palette[0]};color:${coffeeTextColor(p.brand.palette[0],[p.brand.palette[1],p.brand.palette[2]])};cursor:pointer}.coffee-film-toggle:focus-visible{outline:3px solid ${p.brand.palette[2]};outline-offset:3px}@media(prefers-reduced-motion:reduce){video.coffee-native-film{animation:none!important;transition:none!important}}</style><script src="assets/coffee-playback.js" defer></script>`;
 let inserted=false;const result=await new HTMLRewriter().on('head',{element(e){inserted=true;e.append(style,{html:true});}}).on('video',{element(e){e.setAttribute('class',((e.getAttribute('class')||'')+' coffee-native-film').trim());for(const a of ['controls','muted','loop','playsinline'])e.setAttribute(a,'');e.setAttribute('preload','metadata');e.setAttribute('poster','assets/coffee-poster.png');if(p.integration.autoplay)e.setAttribute('autoplay','');else e.removeAttribute('autoplay');}}).transform(new Response(html)).text();if(!inserted)throw new HyperframesFailure('The page needs a complete HTML head for integrated playback',true);return result;
}
