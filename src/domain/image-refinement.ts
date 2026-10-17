// Source-owned requirement lineage. Snapshot text is evidence, not a visual-success verdict.
// Every producer (image, web, document, video) carries the captain's cumulative notes from
// every earlier version into each round: a later round never sees only the latest notes.
import{createHash}from'node:crypto';import{readFileSync}from'node:fs';
import type{ArtifactStore,Note}from'../artifacts';
import{verifyImagePng,type CodexImageReference}from'../providers/codex-image';
export type ImageRequirement={key:string;version:number;note:string;comment:string;locator:Note['locator'];selector?:string|null;bbox:Note['bbox'];box:Note['box'];t0:Note['t0'];t1:Note['t1'];status:Note['status'];state:'active'|'superseded';supersedes:{version:number;note:string}[];capturedFrom:'snapshot'|'current-notes'};
export type ImageRefinementSnapshot={schema:1;run:string;producer:string;round:number;attempt:number;intent:string;reference:{artifact:string;version:number;sha256:string}|null;history:ImageRequirement[];active:ImageRequirement[]};
export type Requirement=ImageRequirement;export type RefinementSnapshot=ImageRefinementSnapshot;
type Old={id:string;n:number;sha256:string};
type LineageOpts={run:string;producer:string;round:number;attempt:number;intent:string;old?:Old};
/** The cumulative captain requirements behind one producer's current version: every note on every
 *  version of its verified parent chain (plus the parent's recorded snapshot), with explicit overrides
 *  marked superseded. `type` is the artifact type the chain must keep; `noun` names it in refusals. */
export function requirementLineage(store:ArtifactStore,o:LineageOpts&{type:string;noun?:string}):RefinementSnapshot{
 const noun=o.noun??'Artifact',history:Requirement[]=[];
 if(o.old){const old=o.old,current=store.version(old.id,old.n);if(!current||current.type!==o.type||current.source.run!==o.run||current.sha256!==old.sha256||store.verify(old.id,old.n).length)throw new Error(`${noun} refinement source is unverified`);
  const chain=[];const seen=new Set<number>();let n:number|null=old.n;
  while(n!==null){if(seen.has(n)||chain.length>=100)throw new Error(`${noun} parent lineage invalid`);seen.add(n);const v=store.version(old.id,n);if(!v||v.type!==o.type||v.source.run!==o.run||store.verify(old.id,n).length||v.parent!==null&&(!Number.isInteger(v.parent)||v.parent>=n||v.parent<1))throw new Error(`${noun} parent lineage unverified`);chain.unshift(v);n=v.parent;}
  if(current.refinement){if(current.refinement.schema!==1||current.refinement.run!==o.run)throw new Error(`${noun} refinement history unverified`);history.push(...structuredClone(current.refinement.history).map(v=>({...v,capturedFrom:'snapshot' as const})));}
  for(const v of chain)for(const note of store.notes(old.id,v.n)){
   const key=`v${v.n}:${note.id}`;if(history.some(r=>r.key===key))continue;
   history.push({key,version:v.n,note:note.id,comment:note.comment,locator:note.locator??null,selector:(note as any).selector??null,bbox:note.bbox??null,box:note.box??null,t0:note.t0??null,t1:note.t1??null,status:note.status,state:'active',supersedes:structuredClone(note.supersedes??[]),capturedFrom:'current-notes'});
  }
  for(const note of history)for(const target of note.supersedes){const prior=history.find(r=>r.version===target.version&&r.note===target.note);if(!prior||prior===note||prior.version>note.version)throw new Error(`${noun} override target invalid`);prior.state='superseded';}
 }
 return{schema:1,run:o.run,producer:o.producer,round:o.round,attempt:o.attempt,intent:o.intent,reference:o.old?{artifact:o.old.id,version:o.old.n,sha256:o.old.sha256}:null,history,active:history.filter(n=>n.state==='active')};
}
/** The brief's byte budget for the lineage, the same one an image refinement prompt has. */
export const LINEAGE_BUDGET=16000;
/** The lineage as brief lines, oldest first, and the one place a round sees the captain's notes: each active
 *  requirement names its version, its words and where it points; a superseded one collapses to its id and what
 *  replaced it. Over the budget, the newest active requirements are kept and the rest are named by id only,
 *  with a request to consolidate them with the captain. The latest word wins. */
export function lineageText(s:RefinementSnapshot,budget=LINEAGE_BUDGET):string{
 if(!s.history.length)return'Captain requirements so far: none yet.';
 const newest=Math.max(...s.history.map(r=>r.version)),id=(r:Requirement)=>`v${r.version} ${r.note}`;
 const by=(r:Requirement)=>s.history.find(o=>o.supersedes.some(t=>t.version===r.version&&t.note===r.note));
 const where=(r:Requirement)=>{const w=[r.selector?`selector ${r.selector}`:'',r.bbox?`region ${JSON.stringify(r.bbox)}`:'',r.t0!=null&&r.t1!=null&&!(r.t0===0&&r.t1===1)?`time ${r.t0}-${r.t1}`:'',r.locator&&!['document'].includes(String((r.locator as any).section??''))?`at ${JSON.stringify(r.locator)}`:''].filter(Boolean);return w.length?` (${w.join('; ').slice(0,300)})`:'';};
 const line=(r:Requirement)=>r.state==='superseded'?`- ${id(r)} [superseded${by(r)?` by ${id(by(r)!)}`:''}]`:`- ${id(r)} [${r.version===newest?'active, newest':'active, from an earlier round: still binding'}${r.status==='resolved'?', marked resolved: keep it done':''}]${where(r)}: ${JSON.stringify(r.comment)}`;
 const head='Captain requirements across every round (oldest first; every active one still binds; where two conflict the later one wins, only in the aspect it changes):';
 const lines=s.history.map(r=>({r,text:line(r)}));let size=Buffer.byteLength(head)+1200;const keep=new Set<Requirement>();
 for(const l of [...lines].reverse()){const n=Buffer.byteLength(l.text)+1;if(size+n>budget)continue;size+=n;keep.add(l.r);}
 const dropped=lines.filter(l=>!keep.has(l.r)).map(l=>id(l.r));
 return`${head}\n${lines.filter(l=>keep.has(l.r)).map(l=>l.text).join('\n')}${dropped.length?`\n(${dropped.length} older requirements do not fit this brief: ${dropped.slice(0,40).join(', ')}${dropped.length>40?', ...':''}. They still bind as the current version shows them; ask the captain to consolidate them into one note.)`:''}`;
}
/** The image request's byte cap: the provider refuses a larger prompt (src/providers/codex-image.ts), so the whole request is checked here. */
export const IMAGE_PROMPT_CAP=16000;
/** lead: text that goes first in the request (the node's role skill); the cap counts it with the refinement. */
export function imageRefinement(store:ArtifactStore,o:LineageOpts&{lead?:string}):{snapshot:ImageRefinementSnapshot;reference?:CodexImageReference;prompt:string}{
 let reference:CodexImageReference|undefined;
 const snapshot=requirementLineage(store,{...o,type:'image',noun:'Image'});
 if(o.old){const old=o.old,current=store.version(old.id,old.n)!;
  const path=store.file(old.id,old.n,current.primary??'');if(!path)throw new Error('Image refinement source missing');const bytes=readFileSync(path);verifyImagePng(bytes);const sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==old.sha256)throw new Error('Image reference hash changed');reference={bytes,sha256};
 }
 const prompt=`${reference?'Edit the attached CURRENT image; do not regenerate from the original description alone.':'Create the initial image.'}\nOriginal captain intent: ${o.intent}\nPreserve all active requirements and all other current-image details. Apply the latest requested changes. Later explicit conflicting changes override earlier intent only in the changed aspect. Opposite-side directions are relative to the attached current image; do not mirror unrelated content. Superseded records are history, not active requirements.\nActive captain requirements (exact words): ${JSON.stringify(snapshot.active)}\nAnnotation history (exact words and target versions): ${JSON.stringify(snapshot.history)}`;
 const full=o.lead?.trim()?`${o.lead.trim()}\n\n${prompt}`:prompt;
 if(Buffer.byteLength(full)>IMAGE_PROMPT_CAP)throw new Error('Image refinement context exceeds safe capacity; discuss consolidation with the captain');
 return{snapshot,reference,prompt:full};
}
