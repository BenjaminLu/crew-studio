// Coffee outputs are a dependency bundle, never interchangeable A/B alternatives.
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {validateCoffeeDesign,storeCoffeeDesign,loadCoffeeDesign,coffeeDesignJSON,coffeeDesignHash,coffeeDesignSummary,type CoffeeDesignPlan} from './coffee-design';
import {MediaLibrary,MediaPublicationFailure,mediaArtifactId} from '../media-library';
import {mediaJobs} from '../providers/media-jobs';
import {HyperframesFailure,HYPERFRAMES_VERSION} from '../render/hyperframes';
import {integrateCoffeeSite,COFFEE_PLAYBACK_SCRIPT} from '../render/coffee-film';

export type CoffeePart = 'page' | 'image' | 'video' | 'site';
export type CoffeeManifest = { path: string; size: number; sha256: string }[];
export type CoffeeGenerations = Record<CoffeePart, number>;
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
/** A complete bounded file census. Added files and links are changes too. */
export function coffeeManifest(root: string): CoffeeManifest {
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Bundle root must be an owned directory');
  const files: CoffeeManifest = []; let bytes = 0, entries = 0;
  function walk(dir: string, prefix = '') {
    for (const name of readdirSync(dir).sort()) {
      if (++entries > 256) throw new Error('Bundle entry limit');
      const path = prefix ? `${prefix}/${name}` : name, at = join(dir, name), st = lstatSync(at);
      if (st.isSymbolicLink()) throw new Error('Bundle links are not allowed');
      if (st.isDirectory()) { if (path.split('/').length > 12) throw new Error('Bundle nesting limit'); walk(at, path); }
      else if (st.isFile()) {
        if (files.length >= 128 || st.size > 64 * 1024 * 1024) throw new Error('Bundle file limit');
        const content = readFileSync(at); bytes += content.length;
        if (bytes > 128 * 1024 * 1024) throw new Error('Bundle size limit');
        files.push({ path, size: content.length, sha256: digest(content) });
      } else throw new Error('Bundle contains unsupported filesystem entry');
    }
  }
  walk(root); if (!files.length) throw new Error('Bundle has no files'); return files;
}
export function coffeeManifestHash(manifest: CoffeeManifest): string {
  return digest(JSON.stringify(manifest));
}
export function verifyCoffeeManifest(root: string, expected: CoffeeManifest): boolean {
  try { return JSON.stringify(coffeeManifest(root)) === JSON.stringify(expected); } catch { return false; }
}
/** Host-owned invalidation, independent of mutable renderer/latest pointers. */
export function reviseCoffeeGenerations(old: CoffeeGenerations, target: CoffeePart | 'direction'): CoffeeGenerations {
  for (const key of ['page','image','video','site'] as const) if (!Number.isSafeInteger(old[key]) || old[key] < 1) throw new Error('Unknown coffee generation');
  const next = { ...old };
  const affected: CoffeePart[] = target === 'direction' ? ['page','image','video','site'] : target === 'page' ? ['page','video','site'] : target === 'image' ? ['image','video','site'] : target === 'video' ? ['video','site'] : target === 'site' ? ['site'] : [];
  if (!affected.length) throw new Error('Unknown revision target');
  for (const key of affected) { if (next[key] >= Number.MAX_SAFE_INTEGER) throw new Error('Coffee generation exhausted'); next[key]++; }
  return next;
}

import { folderTools } from '../agent';
import { generateCodexImage, CodexImageFailure, verifyImagePng, type CodexImage } from '../providers/codex-image';
import type { Engine, X } from '../runtime/engine';
import type { ArtifactStore } from '../artifacts';
import type { SCard } from '../runtime/cards';

export type CoffeeDirection = { version: 1; design?:CoffeeDesignPlan; designHash?:string; brief: string; name: string; palette: string[]; type: string; spacing: number[]; motion: string; image: string; provider: string; model: string; effort: string };
type CoffeePlan = { version: 1; pageAdmission?: "paid-intent-v1";mediaAdmission?:"managed-media-v1"; direction: CoffeeDirection; generations: CoffeeGenerations; revision: { target: CoffeePart | 'direction'; note: string } | null };
type CoffeeReceipt = { version: 1; part: CoffeePart; generation: number; direction: string; artifact: string; n: number; manifest: CoffeeManifest; primary: string; metadata:string; dependencies: Partial<Record<CoffeePart, string>> };
const planRecord = 'coffee-plan-v1', outputRecord = 'coffee-output-v1';
function requireOwner(x: X) { if (x.cancelled() || !x.engine.owns(x)) throw new Error('Coffee operation no longer owns this visit'); }
function trustedCoffee(x: X) { const t = x.engine.trusted(x.run.id); if (!t.ok) throw new Error('Coffee history cannot be authenticated'); return t.entries; }
function currentPlan(x: X): CoffeePlan {
  const e = trustedCoffee(x).filter(e => e.record === planRecord).at(-1), p = e?.data as CoffeePlan;
  if (!p || p.version !== 1 || p.direction?.version !== 1 || typeof p.direction.brief !== 'string' || !p.direction.brief.trim()) throw new Error('Prepare a fresh coffee direction');
  // Validate all generations without advancing them; unknown legacy pins cannot recover silently.
  for (const v of Object.values(p.generations ?? {})) if (!Number.isSafeInteger(v) || v < 1) throw new Error('Invalid coffee generation');
  if (['page','image','video','site'].some(k => !Object.hasOwn(p.generations ?? {}, k))) throw new Error('Incomplete coffee generation');
  return structuredClone(p);
}
function productionPlan(x:X){const p=currentPlan(x);if(p.mediaAdmission!=='managed-media-v1')throw new Error('Historical media admission is unbound; confirm a fresh coffee Task');if(!p.direction.design||p.direction.designHash!==coffeeDesignHash(p.direction.design))throw new Error('Historical coffee direction has no approved complete design plan; prepare a fresh Task');validateCoffeeDesign(p.direction.design);return p;}
function recordCoffeePlan(x: X, p: CoffeePlan) {
  requireOwner(x); const e = x.engine.record(x, planRecord, { data: structuredClone(p) });
  if (!e) throw new Error('Coffee plan was not persisted');
  x.ctx.coffee = { direction: digest(JSON.stringify(p.direction)), generations: structuredClone(p.generations), revision: p.revision };
  x.save();
}
function presentationHash(c:SCard) { return digest(JSON.stringify({run:c.run,node:c.node,visit:c.visit,title:c.title,sections:c.sections,body:c.body,options:c.options,links:c.links,captainOnly:c.captainOnly})); }
function requireSignedAnswer(x:X,c:SCard) { const e=trustedCoffee(x).filter(e=>e.record==='card-answer' && e.data?.card===c.id).at(-1); if(!e || e.node!==x.node.id || e.round!==x.visit || e.data.choice!==c.answer?.choice || (e.data.note??null)!==(c.answer?.note??null) || e.actor!==c.answer?.by)throw new Error('Coffee card answer is not authenticated'); }
function receiptHash(r: CoffeeReceipt) { return digest(JSON.stringify(r)); }
function coffeeMetadata(st:ArtifactStore,id:string,n:number) {const a=st.get(id),v=st.version(id,n);if(!a||!v)throw new Error('Coffee version metadata unavailable');return digest(JSON.stringify({artifact:{id:a.id,type:a.type,source:a.source,entry:a.entry},version:{artifact:v.artifact,n:v.n,type:v.type,primary:v.primary,files:v.files,createdBy:v.createdBy,source:v.source,parent:v.parent,createdAt:v.createdAt,cost:v.cost,summary:v.summary,media:v.media}}));}
function coffeeNeeds(x:X,st:ArtifactStore,part:CoffeePart):'produce'|'current' {
  const p=currentPlan(x),old=trustedCoffee(x).filter(e=>e.record===outputRecord&&e.data?.part===part).at(-1)?.data as CoffeeReceipt|undefined;
  if(!old)return 'produce';
  if(old.version!==1||!Number.isSafeInteger(old.generation)||old.generation<1||old.generation>p.generations[part])throw new Error('Unknown coffee output history; explicit recovery required');
  if(old.generation<p.generations[part])return 'produce';
  coffeeReceipt(x,st,part);return 'current';
}
function coffeeReceipt(x: X, st: ArtifactStore, part: CoffeePart, checking = new Set<CoffeePart>()): CoffeeReceipt {
  if (checking.has(part)) throw new Error('Coffee dependency cycle'); checking.add(part);
  const p = currentPlan(x), e = trustedCoffee(x).filter(e => e.record === outputRecord && e.data?.part === part).at(-1), r = e?.data as CoffeeReceipt;
  if (!r || r.version !== 1 || r.generation !== p.generations[part] || r.direction !== digest(JSON.stringify(p.direction))) throw new Error(`${part} needs a current version`);
  if (!['page','image','video','site'].includes(r.part) || !r.dependencies || typeof r.dependencies !== 'object' || Array.isArray(r.dependencies) || Object.keys(r.dependencies).some(k => !['page','image','video'].includes(k))) throw new Error('Unknown coffee dependency');
  const required=part==='site'?['image','page','video']:part==='video'?['image','page']:[];
  const managed=p.mediaAdmission==='managed-media-v1'&&(part==='image'||part==='video'),expectedId=managed?mediaArtifactId({task:x.run.id,project:x.run.params.project||`coffee:${x.run.workflow}`,role:part==='image'?'image-worker':'video-renderer',type:part==='image'?'image':'video'}):`coffee-${x.run.id.toLowerCase()}-${part}`;
  if(r.artifact!==expectedId||!Number.isSafeInteger(r.n)||r.n<1||r.primary!==(part==='image'?(managed?'image.png':'coffee.png'):part==='video'?(managed?'video.mp4':'coffee.mp4'):'index.html')||!/^[a-f0-9]{64}$/.test(r.metadata)||!Array.isArray(r.manifest)||!r.manifest.length||r.manifest.length>128||r.manifest.some(f=>!f||typeof f.path!=='string'||f.path.startsWith('/')||f.path.split('/').some(v=>!v||v==='.'||v==='..')||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/.test(f.sha256))||JSON.stringify(Object.keys(r.dependencies).sort())!==JSON.stringify(required)||Object.values(r.dependencies).some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))throw new Error('Malformed coffee receipt');
  const v = st.version(r.artifact, r.n), a = st.get(r.artifact);
  if (!v || !a || v.artifact !== r.artifact || v.n !== r.n || v.primary !== r.primary || a.entry !== r.primary || v.source.run !== x.run.id || coffeeMetadata(st,r.artifact,r.n)!==r.metadata || !verifyCoffeeManifest(st.filesDir(r.artifact,r.n),r.manifest)) throw new Error(`${part} artifact changed`);
  for (const [dependency, pin] of Object.entries(r.dependencies)) if (receiptHash(coffeeReceipt(x, st, dependency as CoffeePart, new Set(checking))) !== pin) throw new Error(`${part} has a stale ${dependency}`);
  return structuredClone(r);
}

/** Parse actual HTML elements; comments, raw text and inactive template trees do not count. */
export async function verifyCoffeePage(html:string):Promise<boolean> {
  const active=await new HTMLRewriter().on('template, noscript', {element(e){e.remove();}}).transform(new Response(html)).text();
  let content=false,image=false,video=false,alternate=false;
  await new HTMLRewriter().on('main, h1',{element(){content=true;}})
    .on('picture',{element(){alternate=true;}})
    .on('img[src]',{element(e){if(e.getAttribute('src')==='assets/coffee.png'){image=true;if(e.hasAttribute('srcset'))alternate=true;}}})
    .on('video > source',{element(e){if(e.getAttribute('src')!=='assets/coffee.mp4'||e.getAttribute('type')&&e.getAttribute('type')!=='video/mp4')alternate=true;}})
    .on('video[controls]',{element(e){if(e.getAttribute('src')==='assets/coffee.mp4')video=true;}})
    .on('video[controls]:not([src]) > source[src]',{element(e){if(e.getAttribute('src')==='assets/coffee.mp4'&&(!e.getAttribute('type')||e.getAttribute('type')==='video/mp4'))video=true;}})
    .transform(new Response(active)).text();
  return content&&image&&video&&!alternate;
}

/** Source-installed domain only. No model-controlled workflow can install a renderer. */
function coffeeConstraintContext(x:X,through?:number){
 const entries=trustedCoffee(x).filter(e=>through===undefined||e.seq<=through),requests=entries.filter(e=>e.record===planRecord&&e.data?.revision?.note).map(e=>({source:{seq:e.seq,sig:e.sig},target:e.data.revision.target,originalCaptainComment:e.data.revision.note,targetVersion:entries.filter(r=>r.seq<e.seq&&r.record===outputRecord&&r.data?.part===e.data.revision.target).map(r=>({artifact:r.data.artifact,n:r.data.n,manifest:r.data.manifest,metadata:r.data.metadata,generation:r.data.generation,dependencies:r.data.dependencies})).at(-1)??null,generations:e.data.generations,designHash:e.data.direction?.designHash??null}));
 // Artifact findings are distinct from presentation-copy lint on captain cards. Both remain in the signed ledger.
 const machineFindings=entries.filter(e=>e.record==='check'&&e.check?.startsWith('coffee-kit/')&&['fail','warn','error'].includes(e.verdict)&&((e.findings??[]).length||e.error)).map(e=>({source:{seq:e.seq,sig:e.sig},check:e.check,head:e.head,verdict:e.verdict,findings:e.findings,error:e.error??null}));
 const context={schema:1,machineFindings,rule:'Preserve earlier captain constraints unless a later request explicitly replaces them. Do not infer resolution or rely on model memory.',requests};
 if(JSON.stringify(context).length>12000)throw new Error('Cumulative captain constraints exceed bounded context; discuss a new explicit plan without discarding history');
 return context;
}
export type CoffeeChoice = {provider:'codex';model:string;effort:string|null};
export type CoffeeFilm = {poster?:Buffer;bytes:Buffer;codec:'h264';duration:number;width:number;height:number;renderer:string};
export function installCoffeeKit(engine: Engine, d: { artifacts: ArtifactStore; choice?:()=>CoffeeChoice|null; staffing?:(def:any,params:Record<string,string>)=>CoffeeChoice; video?: (o:{direction:CoffeeDirection;image:string;page:string;revision:CoffeePlan['revision'];context?:ReturnType<typeof coffeeConstraintContext>;signal:AbortSignal;authorize():void;onProgress?:(stage:'snapshot'|'check'|'render'|'verify')=>void})=>Promise<CoffeeFilm>; image?: (o:{direction:CoffeeDirection;context?:ReturnType<typeof coffeeConstraintContext>;signal:AbortSignal;authorize():void})=>Promise<CodexImage> }) {
  const media=new MediaLibrary(engine.deps.dataDir,d.artifacts),jobs=mediaJobs(media);
  const choice = () => {const pick=d.choice?.();if(!pick || pick.provider!=='codex' || typeof pick.model!=='string' || !pick.model.trim() || pick.effort!==null && !['none','minimal','low','medium','high','xhigh','max','ultra'].includes(pick.effort))throw new Error('Configured native coffee model unavailable');return structuredClone(pick);};
  const requireChoice = (x:X) => {const selected=d.staffing?d.staffing(x.run.def,x.run.params):choice();if(x.run.params.provider!==selected.provider || x.run.params.model!==selected.model || (x.run.params.effort??'')!==(selected.effort??''))throw new Error('Coffee approved image staffing changed; confirm a fresh configuration');return selected;};
  const originalStart=engine.start.bind(engine);
  engine.start = options => {
    const def=engine.defs.get(options.workflow,options.version);
    const usesCoffee=def && (def.kind==='coffee-kit'||def.nodes.some(n=>n.mode==='coffee-page'||String(n.args?.mode??'').startsWith('coffee-')||String(n.do??'').startsWith('coffee.')||(n.checks??[]).some(c=>c.use==='coffee-kit/bundle-ready')));
    if(!usesCoffee)return originalStart(options);
    const params=options.params??{},selected=d.staffing?d.staffing(def,params):choice();
    if(params.provider && params.provider!==selected.provider || params.model && params.model!==selected.model || params.effort!==undefined && params.effort!==(selected.effort??''))throw new Error('Coffee account choice changed before Task allocation');
    const design=validateCoffeeDesign(params.coffeeDesignPlan);
    return originalStart({...options,params:{...params,coffeeDesignPlan:storeCoffeeDesign(engine.deps.dataDir,design),provider:selected.provider,model:selected.model,effort:selected.effort??''}});
  };
  const originalAnswer=engine.answer.bind(engine);engine.answer=async(id,answer)=>{const card=engine.cards.get(id),run=card&&engine.get(card.run),node=run?.def.nodes.find(n=>n.id===card?.node);if(answer.choice==='direction'&&node?.args?.mode==='coffee-review'){const canonical=coffeeDesignJSON(answer.note);if(canonical.length>4000)throw new Error('This revised plan is too large for a card note; discuss a fresh coffee Task instead. The existing offer remains open.');return originalAnswer(id,{...answer,note:canonical});}return originalAnswer(id,answer);};
  engine.actions['coffee.ready'] = async x => {
    requireOwner(x);const p=currentPlan(x);if(x.node.id!=='round')return'ok';
    const entries=trustedCoffee(x),latest=entries.filter(e=>e.record===planRecord).at(-1)!,draft=entries.filter(e=>e.record==='coffee-design-draft-v1').at(-1);
    if(!draft||draft.seq<latest.seq)return'ok';if(draft.data?.base!==digest(JSON.stringify(p)))throw new Error('Shared design draft is stale');const design=validateCoffeeDesign(draft.data.design);
    const body=coffeeDesignSummary(design),card=await engine.card(x,'plan',{captainOnly:true,title:'Confirm the revised shared design',zhTitle:'確認修改後的共同設計',body,en:{why:body,how:'Review the full revised plan. No production starts until you confirm.'},zh:{why:body,how:'請檢視完整的新計畫。只有你確認後，才會開始製作。'},options:[{id:'confirm-design',label:'Confirm revised design',labelZh:'確認新設計',primary:true},{id:'close',label:'Cancel creation',labelZh:'取消製作',hold:true}]});
    requireOwner(x);if(!engine.record(x,'coffee-redesign-offer-v1',{data:{card:card.id,visit:x.visit,draft:draft.seq,sig:draft.sig,base:draft.data.base,presentation:presentationHash(card)}}))throw new Error('Revised design offer was not persisted');return{wait:true};
  };
  engine.actionAnswers['coffee.ready']=async(x,c)=>{
    requireOwner(x);requireSignedAnswer(x,c);if(x.node.id!=='round')throw new Error('No shared design decision belongs here');const p=currentPlan(x),entries=trustedCoffee(x),offer=entries.filter(e=>e.record==='coffee-redesign-offer-v1').at(-1),draft=entries.find(e=>e.seq===offer?.data?.draft&&e.sig===offer?.data?.sig&&e.record==='coffee-design-draft-v1');
    if(!offer||offer.node!==x.node.id||offer.round!==x.visit||offer.data.card!==c.id||offer.data.visit!==c.visit||offer.data.presentation!==presentationHash(c)||offer.data.base!==digest(JSON.stringify(p))||!draft||draft.data.base!==offer.data.base)throw new Error('Revised design approval is stale');
    if(c.answer?.choice==='close'){engine.cancel(x.run.id,c.answer.by,'Captain cancelled the revised shared design');return{outcome:'closed'};}if(c.answer?.choice!=='confirm-design')throw new Error('Unknown revised design decision');
    const design=validateCoffeeDesign(draft.data.design),pick=requireChoice(x);p.direction={version:1,design,designHash:coffeeDesignHash(design),brief:design.brief,name:design.name,palette:design.brand.palette,type:design.brand.typography,spacing:design.brand.spacing,motion:design.video.beats.map(b=>b.motion).join(', '),image:JSON.stringify(design.image),provider:pick.provider,model:pick.model,effort:x.run.params.effort??''};p.generations=reviseCoffeeGenerations(p.generations,'direction');p.pageAdmission='paid-intent-v1';p.revision={target:'direction',note:'Captain confirmed the complete revised shared plan'};recordCoffeePlan(x,p);return{outcome:'ok'};
  };
  engine.cardModes['coffee-direction'] = {
    async start(x) {
      requireOwner(x);
      const pick = requireChoice(x);
      const brief = x.run.text.trim();
      if (!brief || brief.length>4000 || !pick.provider || !pick.model) throw new Error('A brief and explicitly configured model are required');
      const design=loadCoffeeDesign(engine.deps.dataDir,x.run.params.coffeeDesignPlan);const direction: CoffeeDirection = {version:1,design,designHash:coffeeDesignHash(design),brief:design.brief,name:design.name,palette:design.brand.palette,type:design.brand.typography,spacing:design.brand.spacing,motion:design.video.beats.map(b=>b.motion).join(', '),image:JSON.stringify(design.image),provider:pick.provider,model:pick.model,effort:x.run.params.effort??''};
      const warning=d.video?'':'\n\nFilm rendering is not configured. Continuing creates page/image previews; final website approval stays blocked until a verified film is available.';
      const warningZh=d.video?'':'\n\n尚未設定影片渲染。繼續後可製作網頁與圖片預覽；在取得已驗證的影片前，無法驗收整個網站。';
      const body=`${coffeeDesignSummary(design)}${warning}\n\nModel: ${pick.provider} / ${pick.model}`;
      const bodyZh=`請檢視與 Firstmate 討論後的完整網站、圖片與影片分鏡計畫；尚未開始製作。\n\n${coffeeDesignSummary(design)}${warningZh}\n\n模型：${pick.provider} / ${pick.model}`;
      const card = await engine.card(x,'plan',{captainOnly:true,title:'Confirm your coffee-shop direction',zhTitle:'確認咖啡店的創作方向',en:{why:body,how:'Confirm the direction to begin bounded preview creation.'},zh:{why:bodyZh,how:'確認方向後，才會開始製作預覽。'},body,options:[{id:'confirm',label:'Create previews',labelZh:'開始製作預覽',primary:true},{id:'close',label:'Close',labelZh:'關閉',hold:true}]});
      requireOwner(x); if(!engine.record(x,'coffee-direction-offer-v1',{data:{version:1,card:card.id,visit:x.visit,presentation:presentationHash(card),direction}}))throw new Error('Direction offer was not persisted'); x.rn.data.coffeeDirection = direction; x.rn.data.coffeeCard = card.id; x.save();
      return {wait:true};
    },
    async answer(x,c) {
      requireOwner(x);
      requireSignedAnswer(x,c);
      const offer=trustedCoffee(x).filter(e=>e.record==='coffee-direction-offer-v1').at(-1);
      if (offer?.data?.card!==c.id || offer.node!==x.node.id || offer.data.visit!==x.visit || offer.data.presentation!==presentationHash(c)) throw new Error('Coffee direction card is stale');
      if (c.answer?.choice !== 'confirm') return {outcome:'closed'};
      if (trustedCoffee(x).some(e => e.record === planRecord)) throw new Error('Existing coffee direction requires an explicit revision');
      const direction = offer.data.direction as CoffeeDirection, pick = requireChoice(x);
      if (!direction || direction.provider !== pick.provider || direction.model !== pick.model) throw new Error('The chosen model changed; confirm a fresh direction');
      recordCoffeePlan(x,{version:1,mediaAdmission:"managed-media-v1",pageAdmission:"paid-intent-v1",direction,generations:{page:1,image:1,video:1,site:1},revision:null});
      return {outcome:'confirmed'};
    },
  };
  engine.actions['coffee.image-needed'] = x => {
    return coffeeNeeds(x,d.artifacts,'image');
  };
  engine.actions['coffee.image'] = async x => {
    requireOwner(x); requireChoice(x);if(coffeeNeeds(x,d.artifacts,'image')==='current')return 'ok'; const p = productionPlan(x), generation = p.generations.image;
    if (trustedCoffee(x).some(e => e.record === 'coffee-operation-v1' && e.data?.part === 'image' && e.data?.generation === generation)) {
      x.rn.note = 'A prior image operation may have run. Request an explicit fresh image revision; it will not be charged again automatically.'; return 'unavailable';
    }
    const admission = engine.deps.agents.admission;
    if (!admission) throw new Error('Coffee image capacity admission unavailable');
    const request = admission({ref:x.run.id},`${x.run.id}/${x.node.id}#${x.visit}/coffee-image`), ready = request.ready;
    request.ready = () => {requireOwner(x);requireChoice(x); return ready();};
    request.waiting = reason => {if(engine.owns(x)){x.rn.note=reason;x.save();}};
    const release = await engine.deps.agents.queue.acquire(request);
    let cleanupSafe = true;
    try {
      requireOwner(x);
      if (!engine.record(x,'coffee-operation-v1',{data:{version:1,part:'image',generation,direction:digest(JSON.stringify(p.direction)),context:coffeeConstraintContext(x)}})) throw new Error('Image operation intent was not persisted');
      const owner={signal:engine.abortOf(x.run).signal,authorize:()=>{requireOwner(x);requireChoice(x);if(JSON.stringify(currentPlan(x))!==JSON.stringify(p))throw new Error('Image plan changed');}};
      const imageSkill=engine.deps.approvedSkill?.(x.run,'image-worker');if(d.staffing&&!imageSkill)throw new Error('Approved image skill is missing');
      const imagePrompt=`${imageSkill??''}\nCumulative source-bound captain constraints: ${JSON.stringify(coffeeConstraintContext(x))}\nCreate one coffee-shop visual from this shared direction: ${JSON.stringify(p.direction)}. Targeted revision: ${JSON.stringify(p.revision)}. No invented text or branding.`;
      if(imageSkill&&!engine.record(x,'coffee-image-instructions-v1',{data:{config:x.run.params._staffing,skill:digest(imageSkill),prompt:digest(imagePrompt),generation,design:p.direction.designHash,provider:p.direction.provider,model:p.direction.model,effort:p.direction.effort}}))throw new Error('Image skill receipt was not persisted');
      const spec={schema:1 as const,task:x.run.id,project:x.run.params.project||`coffee:${x.run.workflow}`,role:'image-worker',generation,type:'image' as const,title:`${x.run.title} — image`,provider:p.direction.provider,model:p.direction.model,dependencies:{design:p.direction.designHash!},origin:'generated' as const};
      let published:Awaited<ReturnType<MediaLibrary['run']>>;
      try{published=d.image?await media.run(spec,owner,async()=>{const image=await d.image!({direction:structuredClone(p.direction),context:coffeeConstraintContext(x),signal:owner.signal,authorize:owner.authorize});if(image.provider!==p.direction.provider||image.model!==p.direction.model||image.effort!==(p.direction.effort||null))throw new Error('Image effective identity differs');return{bytes:image.bytes,mime:image.mime};}):await jobs.image(spec,owner,{prompt:imagePrompt,approved:{model:p.direction.model,effort:p.direction.effort||null},authorize:owner.authorize,signal:owner.signal});}
      catch(error){cleanupSafe=error instanceof CodexImageFailure||error instanceof MediaPublicationFailure?error.cleanupSafe:false;throw error;}
      owner.authorize();const id=published.artifact,v=published.manifest,manifest=coffeeManifest(d.artifacts.filesDir(id,v.n));
      if(!engine.record(x,outputRecord,{data:{version:1,part:'image',generation,direction:digest(JSON.stringify(p.direction)),artifact:id,n:v.n,manifest,primary:v.primary!,metadata:coffeeMetadata(d.artifacts,id,v.n),dependencies:{}}}))throw new Error('Image receipt was not persisted');return'ok';

    } catch(error) {
      if (!engine.owns(x)) throw error;
      x.rn.note = error instanceof Error&&error.message.startsWith('Cumulative captain constraints exceed')?error.message:cleanupSafe ? 'Image unavailable; no verified image was offered.' : 'Image cleanup unverified; capacity and private credentials remain held.'; x.save(); return 'unavailable';
    } finally { if(cleanupSafe) release(); }
  };
  engine.actions['coffee.page-needed'] = x => {
    return coffeeNeeds(x,d.artifacts,'page');
  };
  engine.modes['coffee-page'] = {
    begin(x) {
      requireOwner(x); requireChoice(x); const plan = productionPlan(x), generation=plan.generations.page;
      if(coffeeNeeds(x,d.artifacts,'page')==='current')throw Object.assign(new Error('Current signed page receipt already completed'),{outcome:'ok'});
      if(plan.pageAdmission!=='paid-intent-v1')throw Object.assign(new Error('Historical page admission is unbound; explicit fresh preparation is required'),{outcome:'unavailable'});
      if(trustedCoffee(x).some(e=>e.record==='coffee-operation-v1'&&e.data?.part==='page'&&e.data?.generation===generation))throw Object.assign(new Error('A prior paid page operation may have run; explicit fresh generation is required'),{outcome:'unavailable'});
      if(!engine.record(x,'coffee-operation-v1',{data:{version:1,part:'page',generation,direction:digest(JSON.stringify(plan.direction)),context:coffeeConstraintContext(x)}}))throw new Error('Page operation intent was not persisted');
      const dir = join(engine.deps.dataDir,"work","coffee",x.run.id,`page-${x.node.id}-${x.visit}-${x.rn.attempt ?? 0}`);
      rmSync(dir,{recursive:true,force:true}); mkdirSync(dir,{recursive:true});
      const old = trustedCoffee(x).filter(e => e.record === outputRecord && e.data?.part === 'page').at(-1)?.data as CoffeeReceipt | undefined;
      if (old && verifyCoffeeManifest(d.artifacts.filesDir(old.artifact,old.n),old.manifest)) cpSync(d.artifacts.filesDir(old.artifact,old.n),dir,{recursive:true});
      x.rn.data.coffeeWork = dir; x.rn.data.coffeePlan = plan; x.save();
    },
    sandbox:x => ({writes:[x.rn.data.coffeeWork],cwd:x.rn.data.coffeeWork}),
    tools:x => folderTools(x.rn.data.coffeeWork,()=>{},'work').filter(t => t.name !== 'work_search'),
    maxTools:30,
    system:(_x,skill) => `${skill}\nWrite a complete index.html document with head and body, and optional local CSS only using work_* tools. No network, shell, external resources, tracking, scripts, forms or publication. Use the exact approved design plan sections, brand tokens, layout and CTA. Create a polished cinematic inline hero or wide feature with readable HTML heading and CTA outside the video, stable 16:9 aspect ratio and a responsive phone crop. The host integrates assets/coffee.png, assets/coffee.mp4 and its real first-frame poster. Do not embed any custom player, external fonts or script. Include an img with src="assets/coffee.png" and a video controls with src="assets/coffee.mp4". These files arrive later; do not invent media bytes. Use real brief content; do not invent an address, price or opening hours.`,
    prompt:x => `Create the useful coffee-shop introduction page. Shared direction: ${JSON.stringify(x.rn.data.coffeePlan.direction)}\nSource-bound cumulative captain constraints: ${JSON.stringify(coffeeConstraintContext(x))}\nRequested targeted revision: ${JSON.stringify(x.rn.data.coffeePlan.revision)}\nPreserve unrelated existing copy and design.`,
    async after(x,job) {
      requireOwner(x); requireChoice(x); const p = currentPlan(x), source = x.rn.data.coffeePlan as CoffeePlan;
      if(job.provider!==p.direction.provider || job.model!==p.direction.model)throw new Error('Page effective model differs from confirmed direction');
      if (JSON.stringify(p) !== JSON.stringify(source)) throw new Error('Direction or revision changed during page production');
      const dir = x.rn.data.coffeeWork, manifest = coffeeManifest(dir), html = readFileSync(join(dir,'index.html'),'utf8');
      if (!(await verifyCoffeePage(html))) throw new Error('Page must integrate image and playable video references');
      if (/<(?:script|iframe|object|embed|form|base)\b|\bon\w+\s*=|(?:src|href)\s*=\s*["'](?:https?:|\/\/|javascript:)/i.test(html)) throw new Error('Page contains unsupported active or external content');
      requireOwner(x);requireChoice(x);if(JSON.stringify(currentPlan(x))!==JSON.stringify(source))throw new Error('Page direction changed during validation');
      const id = `coffee-${x.run.id.toLowerCase()}-page`;
      if (!d.artifacts.get(id)) d.artifacts.create({id,title:`${x.run.title} — page`,type:'web',source:'html',entry:'index.html'});
      const v = d.artifacts.addVersion(id,{from:dir,primary:'index.html',createdBy:{kind:'agent',provider:job.provider,model:job.model,run:job.id},source:{run:x.run.id},summary:job.said.slice(0,300)});
      if (!verifyCoffeeManifest(d.artifacts.filesDir(id,v.n),manifest)) throw new Error('Page changed while being versioned');
      requireOwner(x);
      const receipt: CoffeeReceipt = {version:1,part:'page',generation:p.generations.page,direction:digest(JSON.stringify(p.direction)),artifact:id,n:v.n,manifest,primary:'index.html',metadata:coffeeMetadata(d.artifacts,id,v.n),dependencies:{}};
      if (!engine.record(x,outputRecord,{data:receipt})) throw new Error('Page receipt was not persisted');
      x.rn.note = `${id} v${v.n}`; return 'ok';
    },
    end(x) { if (x.rn.data.coffeeWork) rmSync(x.rn.data.coffeeWork,{recursive:true,force:true}); },
  };
  engine.actions['coffee.video-needed'] = x => {
    return coffeeNeeds(x,d.artifacts,'video');
  };
  engine.actions['coffee.video'] = async x => {
    requireOwner(x); requireChoice(x);if(coffeeNeeds(x,d.artifacts,'video')==='current')return 'ok'; const p = productionPlan(x), generation = p.generations.video;
    if (!d.video) {x.rn.note='HyperFrames rendering is unavailable. No playable film is offered.'; return 'unavailable';}
    const image = coffeeReceipt(x,d.artifacts,'image'), page = coffeeReceipt(x,d.artifacts,'page');
    if (trustedCoffee(x).some(e => e.record === 'coffee-operation-v1' && e.data?.part === 'video' && e.data?.generation === generation)) {x.rn.note='A prior render operation needs explicit recovery.';return 'unavailable';}
    const admission = engine.deps.agents.admission; if(!admission)throw new Error('Coffee render capacity admission unavailable');
    const request=admission({ref:x.run.id},`${x.run.id}/${x.node.id}#${x.visit}/coffee-video`),ready=request.ready;
    request.ready=()=>{requireOwner(x);requireChoice(x);return ready();};
    const release=await engine.deps.agents.queue.acquire(request);let cleanupSafe=true;
    try {
      requireOwner(x);
      if(!engine.record(x,'coffee-operation-v1',{data:{version:1,part:'video',generation,direction:digest(JSON.stringify(p.direction)),context:coffeeConstraintContext(x)}}))throw new Error('Render intent was not persisted');
      const owner={signal:engine.abortOf(x.run).signal,authorize:()=>{requireOwner(x);requireChoice(x);if(JSON.stringify(currentPlan(x))!==JSON.stringify(p)||receiptHash(coffeeReceipt(x,d.artifacts,'image'))!==receiptHash(image)||receiptHash(coffeeReceipt(x,d.artifacts,'page'))!==receiptHash(page))throw new Error('Film dependencies changed');}};
      let published:Awaited<ReturnType<MediaLibrary['run']>>;
      try{published=await media.run({schema:1,task:x.run.id,project:x.run.params.project||`coffee:${x.run.workflow}`,role:'video-renderer',generation,type:'video',title:`${x.run.title} — video`,provider:'hyperframes',model:`hyperframes@${HYPERFRAMES_VERSION}`,dependencies:{design:p.direction.designHash!,image:receiptHash(image),page:receiptHash(page)},origin:'generated'},owner,async()=>{
        const film=await d.video!({direction:structuredClone(p.direction),image:join(d.artifacts.filesDir(image.artifact,image.n),image.primary),page:d.artifacts.filesDir(page.artifact,page.n),revision:p.revision,context:coffeeConstraintContext(x),signal:owner.signal,authorize:owner.authorize,onProgress:stage=>{owner.authorize();x.rn.note=`HyperFrames: ${stage}`;x.save();engine.emit(x.run,'coffee_render_stage',`HyperFrames ${stage}`,{node:x.node.id,stage});}});
        if(film.codec!=='h264'||film.duration<10||film.duration>15.1||!Number.isFinite(film.duration)||film.width<1||film.height<1||film.width>1920||film.height>1920||film.renderer!==`hyperframes@${HYPERFRAMES_VERSION}`||!film.poster)throw new Error('No verified HyperFrames film/poster');return{bytes:film.bytes,mime:'video/mp4',poster:film.poster};
      });}catch(error){cleanupSafe=error instanceof HyperframesFailure||error instanceof MediaPublicationFailure?error.cleanupSafe:false;throw error;}
      owner.authorize();const id=published.artifact,v=published.manifest,manifest=coffeeManifest(d.artifacts.filesDir(id,v.n));
      if(!engine.record(x,outputRecord,{data:{version:1,part:'video',generation,direction:digest(JSON.stringify(p.direction)),artifact:id,n:v.n,manifest,primary:v.primary!,metadata:coffeeMetadata(d.artifacts,id,v.n),dependencies:{image:receiptHash(image),page:receiptHash(page)}}}))throw new Error('Film receipt was not persisted');return'ok';

    }catch(error){if(!engine.owns(x))throw error;x.rn.note=cleanupSafe?'No verified film was offered.':'Render cleanup unverified; capacity remains held.';x.save();return 'unavailable';}
    finally{if(cleanupSafe)release();}
  };
  engine.actions['coffee.assemble'] = async x => {
    requireOwner(x); const p = currentPlan(x);
    const page = coffeeReceipt(x,d.artifacts,'page'), image = coffeeReceipt(x,d.artifacts,'image'), video = coffeeReceipt(x,d.artifacts,'video');
    const dir = join(x.dir,`coffee-site-${x.visit}`); rmSync(dir,{recursive:true,force:true}); mkdirSync(dir,{recursive:true});
    try {
      // Reject a page attempting to supply a second identity for host-owned media.
      if (page.manifest.some(f => f.path === 'assets/coffee.png' || f.path === 'assets/coffee.mp4')) throw new Error('The page cannot replace host-owned media');
      cpSync(d.artifacts.filesDir(page.artifact,page.n),dir,{recursive:true});
      mkdirSync(join(dir,'assets'),{recursive:true});
      writeFileSync(join(dir,'assets','coffee.png'),readFileSync(join(d.artifacts.filesDir(image.artifact,image.n),image.primary)));
      writeFileSync(join(dir,'assets','coffee.mp4'),readFileSync(join(d.artifacts.filesDir(video.artifact,video.n),video.primary)));
      const poster=video.manifest.find(f=>f.path==='poster.png');if(poster)writeFileSync(join(dir,'assets','coffee-poster.png'),readFileSync(join(d.artifacts.filesDir(video.artifact,video.n),poster.path)));
      if(p.direction.design){writeFileSync(join(dir,'assets','coffee-playback.js'),COFFEE_PLAYBACK_SCRIPT);const integrated=await integrateCoffeeSite(readFileSync(join(dir,'index.html'),'utf8'),p.direction.design);requireOwner(x);requireChoice(x);if(JSON.stringify(currentPlan(x))!==JSON.stringify(p))throw new Error('Design changed while integrating playback');writeFileSync(join(dir,'index.html'),integrated);}
      const manifest = coffeeManifest(dir), id = `coffee-${x.run.id.toLowerCase()}-site`;
      if (!d.artifacts.get(id)) d.artifacts.create({id,title:x.run.title,type:'web',source:'html',entry:'index.html'});
      const v = d.artifacts.addVersion(id,{from:dir,primary:'index.html',createdBy:{kind:'host',provider:'studio',model:'coffee-assembly-v1',run:x.run.id},source:{run:x.run.id},summary:'Host assembled exact versioned page, image and film; no publication'});
      if (!verifyCoffeeManifest(d.artifacts.filesDir(id,v.n),manifest)) throw new Error('Site changed during assembly');
      requireOwner(x);
      const receipt: CoffeeReceipt = {version:1,part:'site',generation:p.generations.site,direction:digest(JSON.stringify(p.direction)),artifact:id,n:v.n,manifest,primary:'index.html',metadata:coffeeMetadata(d.artifacts,id,v.n),dependencies:{page:receiptHash(page),image:receiptHash(image),video:receiptHash(video)}};
      if (!engine.record(x,outputRecord,{data:receipt})) throw new Error('Site receipt was not persisted');
      x.ctx.head = receiptHash(receipt); x.ctx.spec = {done:['The current website embeds its exact verified image and playable film','The content, visual direction and pacing match the captain’s intent']}; x.save();
      return 'ok';
    } finally { rmSync(dir,{recursive:true,force:true}); }
  };
  engine.needs['coffee_review_snapshot']=x=>{
    requireOwner(x);requireChoice(x);const plan=productionPlan(x),site=coffeeReceipt(x,d.artifacts,'site');
    const receipts=Object.fromEntries((['page','image','video','site'] as CoffeePart[]).map(part=>[part,coffeeReceipt(x,d.artifacts,part)]));
    const texts:Record<string,string>={};for(const file of site.manifest){if(/\.(html|css)$/.test(file.path)){if(file.size>18000)throw new Error('Coffee source review exceeds bounded text capacity; review remains unverified');texts[file.path]=readFileSync(join(d.artifacts.filesDir(site.artifact,site.n),file.path),'utf8');}}
    const snapshot={schema:1,scope:'text-and-source-only',design:plan.direction.design,designHash:plan.direction.designHash,generations:plan.generations,revision:plan.revision,cumulativeCaptainConstraints:coffeeConstraintContext(x),staffing:x.run.params._staffing,receipts,texts};
    if(JSON.stringify(snapshot).length>24000)throw new Error('Complete coffee review input exceeds bounded capacity; no truncated approval');
    return snapshot;
  };
  const openBundleCard = async (x:X) => {
    requireOwner(x); const bundle = coffeeReceipt(x,d.artifacts,'site'), pin = receiptHash(bundle),contextSource=trustedCoffee(x).at(-1)!,constraints=coffeeConstraintContext(x,contextSource.seq);
    const constraintText=constraints.requests.map(r=>`${r.target} — ${r.originalCaptainComment}\nTarget version: ${r.targetVersion?.artifact??'shared-plan'} v${r.targetVersion?.n??'-'}; manifest ${r.targetVersion?coffeeManifestHash(r.targetVersion.manifest):'plan'}; generations: ${JSON.stringify(r.generations)}; source ${r.source.seq}`).join('\n');
    const description = `Proved by checks: all files and dependency generations are pinned.\nNeeds your eye: the writing, image quality, visual coherence and video pacing.\nWebsite version ${bundle.n}\nBundle SHA256: ${pin}\nOriginal captain requests and target generations (cumulative):\n${constraintText||'Initial approved plan; no refinement comments yet.'}`;
    const translated = `檢查已證明：所有檔案與相依版本均已固定。\n需要你判斷：文案、圖片品質、視覺一致性與影片節奏。\n網站版本 ${bundle.n}\n整站 SHA256：${pin}\n船長原始回饋與目標版本（累積保留）：\n${constraintText||'初次核准的計畫，尚無修改回饋。'}`;
    const c = await engine.card(x,'acceptance',{captainOnly:true,title:'Review your complete coffee website',zhTitle:'檢視完整的咖啡店網站',body:description,en:{why:description,how:'Preview the whole site, then approve or choose the specific item to revise.'},zh:{why:translated,how:'先預覽整個網站，再核准或選擇要修改的作品。'},links:[{label:`Website v${bundle.n}`,href:`/#/review/${bundle.artifact}/${bundle.n}`}],options:[{id:'approve',label:'Approve whole website',labelZh:'核准整個網站',primary:true},{id:'page',label:'Revise page',labelZh:'修改網頁',note:true,hold:true},{id:'image',label:'Revise image',labelZh:'修改圖片',note:true,hold:true},{id:'video',label:'Revise video',labelZh:'修改影片',note:true,hold:true},{id:'direction',label:'Review a replacement shared plan',labelZh:'檢視新的完整共同計畫',note:true,hold:true},{id:'close',label:'Close',labelZh:'關閉',hold:true}]});
    requireOwner(x);
    if (!engine.record(x,'coffee-offer-v1',{data:{version:1,card:c.id,visit:x.visit,bundle:pin,contextSource:{seq:contextSource.seq,sig:contextSource.sig},constraints,constraintsHash:digest(JSON.stringify(constraints)),presentation:presentationHash(c)}})) throw new Error('Bundle offer was not persisted');
    return {wait:true} as const;
  };
  engine.cardModes['coffee-capability'] = {
    async start(x) {
      requireOwner(x);const links:{label:string;href:string}[]=[];
      for(const part of ['page','image','video','site'] as const)try{const r=coffeeReceipt(x,d.artifacts,part);links.push({label:`${part} v${r.n}`,href:`/#/review/${r.artifact}/${r.n}`});}catch{}
      let recovery:CoffeePlan|null=null,videoRecovery:CoffeePlan|null=null;try{if(!x.run.def.edges.some(e=>e.from===x.node.id&&e.to==='round'&&e.when==='revise'))throw new Error('Historical workflow has no bound recovery edge');const p=currentPlan(x);if((p.pageAdmission!=='paid-intent-v1'||trustedCoffee(x).some(e=>e.record==='coffee-operation-v1'&&e.data?.part==='page'&&e.data.generation===p.generations.page))&&coffeeNeeds(x,d.artifacts,'page')==='produce')recovery=p;else if(d.video&&coffeeNeeds(x,d.artifacts,'page')==='current'&&coffeeNeeds(x,d.artifacts,'image')==='current'&&coffeeNeeds(x,d.artifacts,'video')==='produce')videoRecovery=p;}catch{}
      const card=await engine.card(x,'question',{captainOnly:true,title:'Creation needs attention',zhTitle:'製作需要處理',en:{why:'No verified complete website is available for final approval. Existing valid previews remain available below. Review the failed step; no publication has occurred.',how:videoRecovery?'Approve a fresh film attempt to reuse the existing page and image. Production waits for your confirmation.':'Review the failed step and repair its capability before preparing another attempt.'},zh:{why:'目前沒有可供最終驗收的完整網站。下方仍可開啟已完成且完整的預覽。請查看失敗步驟；尚未發布。',how:videoRecovery?'核准重新製作影片，沿用既有網頁與圖片。確認後才會開始製作。':'請查看失敗步驟並修復所需能力，再準備新的嘗試。'},links,options:[...(videoRecovery?[{id:'fresh-video',label:'Authorize a fresh film attempt',labelZh:'授權重新製作影片',note:true,hold:true}]:[]),...(recovery?[{id:'fresh-page',label:'Authorize a fresh page attempt',labelZh:'授權重新製作網頁',note:true,hold:true}]:[]),{id:'close',label:'Close',labelZh:'關閉',hold:true}]});
      if((recovery||videoRecovery)&&!engine.record(x,'coffee-recovery-offer-v1',{data:{version:1,card:card.id,visit:x.visit,plan:digest(JSON.stringify(recovery||videoRecovery)),target:videoRecovery?'video':'page',presentation:presentationHash(card)}}))throw new Error('Recovery offer was not persisted');
      return {wait:true};
    },
    async answer(x,c){requireOwner(x);requireSignedAnswer(x,c);if(c.answer?.choice==='fresh-page'||c.answer?.choice==='fresh-video'){
      const p=currentPlan(x),offer=trustedCoffee(x).filter(e=>e.record==='coffee-recovery-offer-v1'&&e.data?.card===c.id).at(-1);
      if(!offer||offer.node!==x.node.id||offer.round!==x.visit||offer.data.card!==c.id||offer.data.visit!==c.visit||offer.data.plan!==digest(JSON.stringify(p))||offer.data.presentation!==presentationHash(c))throw new Error('Recovery offer is stale');
      const target=c.answer.choice==='fresh-video'?'video':'page';if((offer.data.target??'page')!==target)throw new Error('Recovery target differs');
      const note=c.answer.note?.trim();if(!note)throw new Error('Explain the fresh production attempt');
      if(target==='video'){if(!d.video)throw new Error('Film renderer is unavailable');coffeeReceipt(x,d.artifacts,'page');coffeeReceipt(x,d.artifacts,'image');p.generations=reviseCoffeeGenerations(p.generations,'video');recordCoffeePlan(x,p);if(!engine.record(x,'coffee-video-recovery-v1',{data:{card:c.id,note}}))throw new Error('Film recovery authorization was not persisted');return{outcome:'revise'};}
      p.pageAdmission='paid-intent-v1';p.generations=reviseCoffeeGenerations(p.generations,'page');p.revision={target:'page',note:note.slice(0,4000)};recordCoffeePlan(x,p);return{outcome:'revise'};
    }if(c.answer?.choice!=='close')throw new Error('Unknown capability choice');return{outcome:'close'};},
  };
  engine.cardModes['coffee-review'] = {
    start:openBundleCard,
    async answer(x,c) {
      requireOwner(x); requireSignedAnswer(x,c);
      const offer = trustedCoffee(x).filter(e => e.record === 'coffee-offer-v1').at(-1);
      if (!offer || offer.node !== x.node.id || offer.round !== x.visit || offer.data?.card !== c.id || offer.data?.visit !== c.visit || offer.data.presentation!==presentationHash(c)) throw new Error('This coffee offer is stale');
      // This complete re-read happens even for a revision: rejected stale offers cannot change authority.
      const bundle = coffeeReceipt(x,d.artifacts,'site');
      if(!Number.isSafeInteger(offer.data.contextSource?.seq)||!trustedCoffee(x).some(e=>e.seq===offer.data.contextSource.seq&&e.sig===offer.data.contextSource.sig)||offer.data.constraintsHash!==digest(JSON.stringify(coffeeConstraintContext(x,offer.data.contextSource.seq))))throw new Error('Captain constraint snapshot changed; prepare a fresh review');
      if (offer.data.bundle !== receiptHash(bundle)) throw new Error('The coffee bundle changed; prepare a fresh review');
      const choice = c.answer?.choice;
      if (choice === 'close') return {outcome:'closed'};
      if(choice==='direction'){
        const design=validateCoffeeDesign(c.answer?.note);const p=currentPlan(x);if(!engine.record(x,'coffee-design-draft-v1',{data:{version:1,base:digest(JSON.stringify(p)),design}}))throw new Error('Revised shared design draft unavailable');return{outcome:'revise'};
      }
      if (['page','image','video'].includes(choice ?? '')) {
        const note = c.answer?.note?.trim(); if (!note) throw new Error('Write a specific revision comment');
        const plan = currentPlan(x), target = choice as CoffeePart | 'direction';
        plan.pageAdmission='paid-intent-v1';plan.generations = reviseCoffeeGenerations(plan.generations,target); plan.revision = {target,note:note.slice(0,4000)};

        recordCoffeePlan(x,plan); return {outcome:'revise'};
      }
      if (choice !== 'approve') throw new Error('Unknown coffee review choice');
      const checked = await engine.runCheck(x,{use:'coffee-kit/bundle-ready'} ,null);
      requireOwner(x);
      if (checked.verdict !== 'pass' || receiptHash(coffeeReceipt(x,d.artifacts,'site')) !== offer.data.bundle) throw new Error('The complete bundle cannot be approved');
      // The website contains exact image/video copies: one artifact approval is the atomic bundle decision.
      d.artifacts.approve(bundle.artifact,bundle.n,c.answer!.by);
      if(!engine.record(x,'coffee-approved-v1',{data:{version:1,bundle:offer.data.bundle,artifact:bundle.artifact,n:bundle.n,card:c.id,by:c.answer!.by}}))throw new Error('Whole-bundle approval was not persisted');
      x.ctx.coffeeApproved = {artifact:bundle.artifact,version:bundle.n,bundle:offer.data.bundle,card:c.id,by:c.answer!.by}; x.save();
      return {outcome:'approved'};
    },
  };
  engine.actions['coffee.library'] = x => {
    requireOwner(x); const bundle = coffeeReceipt(x,d.artifacts,'site'), approval = x.ctx.coffeeApproved;
    const offer = trustedCoffee(x).find(e => e.record === 'coffee-offer-v1' && e.data?.card === approval?.card);
    const card = approval && engine.cards.get(approval.card);
    const receipt=trustedCoffee(x).filter(e=>e.record==='coffee-approved-v1').at(-1);
    if(!receipt || receipt.data.card!==approval?.card || receipt.data.bundle!==receiptHash(bundle) || receipt.data.by!==approval?.by)throw new Error('Whole-bundle approval receipt unavailable');
    if (!approval || !offer || offer.data.bundle !== receiptHash(bundle) || approval.bundle !== receiptHash(bundle) || card?.answer?.choice !== 'approve' || d.artifacts.version(bundle.artifact,bundle.n)?.status !== 'approved') throw new Error('No current whole-bundle captain approval');
    x.ctx.library = {artifact:bundle.artifact,version:bundle.n,href:`#/artifact/${bundle.artifact}`}; x.save(); return 'ok';
  };
  engine.natives['coffee-bundle-ready'] = (_i,h) => {
    const x = h.x as X;
    try {
      const bundle = coffeeReceipt(x,d.artifacts,'site');
      for (const needed of ['image','video','page'] as const) if (!bundle.dependencies[needed]) throw new Error(`The site does not bind its ${needed}`);
      return {verdict:'pass',score:1,findings:[],proves:[0],data:{bundle:receiptHash(bundle)}};
    } catch (error) {
      return {verdict:'fail',score:0,proves:[],findings:[{locator:{type:'card',field:'bundle'},class:'coffee-bundle-integrity',severity:'blocking',message:error instanceof Error ? error.message : 'Coffee bundle unavailable',expected:'Produce and verify the complete current site, image and playable film'}]};
    }
  };
  return {async refreshRecovery(id:string){
    const run=engine.get(id);if(!run||run.def.kind!=='coffee-kit'||run.status!=='waiting'||engine.busy(id))throw new Error('Task must be waiting without active work');
    const node=run.def.nodes.find(n=>n.args?.mode==='coffee-capability'&&run.nodes[n.id]?.waiting==='card');
    if(!node)throw new Error('Task has no coffee capability hold');
    const rn=run.nodes[node.id],old=engine.cards.get(rn.card??'');if(!old||old.status!=='open'||old.captainOnly!==true)throw new Error('Capability card is not open');
    const x=engine.x(run,node,rn);requireOwner(x);requireChoice(x);currentPlan(x);
    if(!d.video)throw new Error('Install the film renderer and restart Studio first');
    coffeeReceipt(x,d.artifacts,'page');coffeeReceipt(x,d.artifacts,'image');
    if(coffeeNeeds(x,d.artifacts,'video')!=='produce'||!run.def.edges.some(e=>e.from===node.id&&e.to==='round'&&e.when==='revise'))throw new Error('Task has no bound film recovery path');
    await engine.reprepareCard(x,()=>engine.cardModes['coffee-capability'].start!(x));requireOwner(x);
    if(rn.card===old.id)throw new Error('Recovery card was not prepared');
    engine.cards.cancel(old.id);engine.record(x,'coffee-recovery-refreshed-v1',{data:{previous:old.id,card:rn.card}});return engine.cards.get(rn.card!);
  },artifactReview(id:string) {
    for(const run of engine.list()) {
      const authority=engine.trusted(run.id);
      if(authority.ok&&authority.entries.some(e=>e.record===outputRecord&&e.data?.artifact===id&&Number.isSafeInteger(e.data.n)&&e.data.n>0))return {readOnly:true as const,taskHref:`#/run/${encodeURIComponent(run.id)}`,reason:'Review and revise this version in its native Task.'};
    }
    if(!/^coffee-r-[0-9]+-(page|image|video|site)$/.test(id))return null;
    return {readOnly:true as const,taskHref:null,reason:'Native artifact authority is unavailable; generic mutation is blocked.'};
  }};

}

/** Read-only product progress. A created Task or route change never certifies completion. */
export function coffeeJourneyProof(engine:Engine,artifacts:ArtifactStore,id:string){
 const r=engine.get(id),trust=r&&engine.trusted(id);if(!r||r.def.kind!=='coffee-kit'||!trust?.ok)return{complete:false,review:false};
 const open=engine.cards.list({run:id,open:true}),review=open.some(c=>c.node==='review'),hold=open.some(c=>c.node==='capability');
 try{const node=r.def.nodes.find(n=>n.id==='library');if(!node)throw new Error('No library stage');const x=engine.x(r,node,r.nodes[node.id]),site=coffeeReceipt(x,artifacts,'site');
 const approval=trust.entries.filter(e=>e.record==='coffee-approved-v1').at(-1),card=approval&&engine.cards.get(approval.data?.card);
 const complete=r.status==='succeeded'&&r.nodes.library?.state==='passed'&&r.nodes.done?.state==='passed'&&approval?.data?.artifact===site.artifact&&approval.data.n===site.n&&approval.data.bundle===receiptHash(site)&&card?.captainOnly===true&&card.run===id&&card.node==='review'&&card.answer?.choice==='approve'&&trust.entries.some(e=>e.record==='card-answer'&&e.data?.card===card.id&&e.data?.choice==='approve')&&artifacts.version(site.artifact,site.n)?.status==='approved';
 return{complete:!!complete,review,hold,artifact:site.artifact,version:site.n,preview:`#/review/${site.artifact}/${site.n}`,library:'#/library'};
 }catch{return{complete:false,review,hold};}
}
