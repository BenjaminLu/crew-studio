// Source-owned requirement lineage. Snapshot text is evidence, not a visual-success verdict.
// Every producer (image, web, document, video) carries the captain's cumulative notes from
// every earlier version into each round: a later round never sees only the latest notes.
import{createHash}from'node:crypto';import{readFileSync}from'node:fs';
import type{ArtifactStore,Note}from'../artifacts';
import{verifyImagePng,type CodexImageReference}from'../providers/codex-image';
export type ImageRequirement={key:string;version:number;note:string;comment:string;locator:Note['locator'];bbox:Note['bbox'];box:Note['box'];t0:Note['t0'];t1:Note['t1'];status:Note['status'];state:'active'|'superseded';supersedes:{version:number;note:string}[];capturedFrom:'snapshot'|'current-notes'};
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
   history.push({key,version:v.n,note:note.id,comment:note.comment,locator:note.locator??null,bbox:note.bbox??null,box:note.box??null,t0:note.t0??null,t1:note.t1??null,status:note.status,state:'active',supersedes:structuredClone(note.supersedes??[]),capturedFrom:'current-notes'});
  }
  for(const note of history)for(const target of note.supersedes){const prior=history.find(r=>r.version===target.version&&r.note===target.note);if(!prior||prior===note||prior.version>note.version)throw new Error(`${noun} override target invalid`);prior.state='superseded';}
 }
 return{schema:1,run:o.run,producer:o.producer,round:o.round,attempt:o.attempt,intent:o.intent,reference:o.old?{artifact:o.old.id,version:o.old.n,sha256:o.old.sha256}:null,history,active:history.filter(n=>n.state==='active')};
}
/** The lineage as brief lines, oldest first: each requirement names the version it was written on and
 *  whether it is still active; superseded entries stay listed as history. The latest word wins. */
export function lineageText(s:RefinementSnapshot):string{
 if(!s.history.length)return'Captain requirements so far: none yet.';
 const newest=Math.max(...s.history.map(r=>r.version));
 const line=(r:Requirement)=>`- v${r.version} ${r.note} [${r.state==='superseded'?'superseded: history only':r.version===newest?'active, newest':'active, from an earlier round: still binding'}${r.status==='resolved'?', marked resolved: keep it done':''}]: ${JSON.stringify(r.comment)}`;
 return`Captain requirements across every round (oldest first; every active one still binds; where two conflict the later one wins, only in the aspect it changes):\n${s.history.map(line).join('\n')}`;
}
export function imageRefinement(store:ArtifactStore,o:LineageOpts):{snapshot:ImageRefinementSnapshot;reference?:CodexImageReference;prompt:string}{
 let reference:CodexImageReference|undefined;
 const snapshot=requirementLineage(store,{...o,type:'image',noun:'Image'});
 if(o.old){const old=o.old,current=store.version(old.id,old.n)!;
  const path=store.file(old.id,old.n,current.primary??'');if(!path)throw new Error('Image refinement source missing');const bytes=readFileSync(path);verifyImagePng(bytes);const sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==old.sha256)throw new Error('Image reference hash changed');reference={bytes,sha256};
 }
 const prompt=`${reference?'Edit the attached CURRENT image; do not regenerate from the original description alone.':'Create the initial image.'}\nOriginal captain intent: ${o.intent}\nPreserve all active requirements and all other current-image details. Apply the latest requested changes. Later explicit conflicting changes override earlier intent only in the changed aspect. Opposite-side directions are relative to the attached current image; do not mirror unrelated content. Superseded records are history, not active requirements.\nActive captain requirements (exact words): ${JSON.stringify(snapshot.active)}\nAnnotation history (exact words and target versions): ${JSON.stringify(snapshot.history)}`;
 if(Buffer.byteLength(prompt)>16000)throw new Error('Image refinement context exceeds safe capacity; discuss consolidation with the captain');
 return{snapshot,reference,prompt};
}
