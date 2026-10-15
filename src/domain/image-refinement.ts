// Source-owned image lineage. Snapshot text is evidence, not a visual-success verdict.
import{createHash}from'node:crypto';import{readFileSync}from'node:fs';
import type{ArtifactStore,Note}from'../artifacts';
import{verifyImagePng,type CodexImageReference}from'../providers/codex-image';
export type ImageRequirement={key:string;version:number;note:string;comment:string;locator:Note['locator'];bbox:Note['bbox'];box:Note['box'];t0:Note['t0'];t1:Note['t1'];status:Note['status'];state:'active'|'superseded';supersedes:{version:number;note:string}[];capturedFrom:'snapshot'|'current-notes'};
export type ImageRefinementSnapshot={schema:1;run:string;producer:string;round:number;attempt:number;intent:string;reference:{artifact:string;version:number;sha256:string}|null;history:ImageRequirement[];active:ImageRequirement[]};
export function imageRefinement(store:ArtifactStore,o:{run:string;producer:string;round:number;attempt:number;intent:string;old?:{id:string;n:number;sha256:string}}):{snapshot:ImageRefinementSnapshot;reference?:CodexImageReference;prompt:string}{
 const history:ImageRequirement[]=[];let reference:CodexImageReference|undefined;
 if(o.old){const old=o.old,current=store.version(old.id,old.n);if(!current||current.type!=='image'||current.source.run!==o.run||current.sha256!==old.sha256||store.verify(old.id,old.n).length)throw new Error('Image refinement source is unverified');
  const path=store.file(old.id,old.n,current.primary??'');if(!path)throw new Error('Image refinement source missing');const bytes=readFileSync(path);verifyImagePng(bytes);const sha256=createHash('sha256').update(bytes).digest('hex');if(sha256!==old.sha256)throw new Error('Image reference hash changed');reference={bytes,sha256};
  const chain=[];const seen=new Set<number>();let n:number|null=old.n;
  while(n!==null){if(seen.has(n)||chain.length>=100)throw new Error('Image parent lineage invalid');seen.add(n);const v=store.version(old.id,n);if(!v||v.type!=='image'||v.source.run!==o.run||store.verify(old.id,n).length||v.parent!==null&&(!Number.isInteger(v.parent)||v.parent>=n||v.parent<1))throw new Error('Image parent lineage unverified');chain.unshift(v);n=v.parent;}
  if(current.refinement){if(current.refinement.schema!==1||current.refinement.run!==o.run)throw new Error('Image refinement history unverified');history.push(...structuredClone(current.refinement.history).map(v=>({...v,capturedFrom:'snapshot' as const})));}
  for(const v of chain)for(const note of store.notes(old.id,v.n)){
   const key=`v${v.n}:${note.id}`;if(history.some(r=>r.key===key))continue;
   history.push({key,version:v.n,note:note.id,comment:note.comment,locator:note.locator??null,bbox:note.bbox??null,box:note.box??null,t0:note.t0??null,t1:note.t1??null,status:note.status,state:'active',supersedes:structuredClone(note.supersedes??[]),capturedFrom:'current-notes'});
  }
  for(const note of history)for(const target of note.supersedes){const prior=history.find(r=>r.version===target.version&&r.note===target.note);if(!prior||prior===note||prior.version>note.version)throw new Error('Image override target invalid');prior.state='superseded';}
 }
 const snapshot:ImageRefinementSnapshot={schema:1,run:o.run,producer:o.producer,round:o.round,attempt:o.attempt,intent:o.intent,reference:o.old?{artifact:o.old.id,version:o.old.n,sha256:o.old.sha256}:null,history,active:history.filter(n=>n.state==='active')};
 const prompt=`${reference?'Edit the attached CURRENT image; do not regenerate from the original description alone.':'Create the initial image.'}\nOriginal captain intent: ${o.intent}\nPreserve all active requirements and all other current-image details. Apply the latest requested changes. Later explicit conflicting changes override earlier intent only in the changed aspect. Opposite-side directions are relative to the attached current image; do not mirror unrelated content. Superseded records are history, not active requirements.\nActive captain requirements (exact words): ${JSON.stringify(snapshot.active)}\nAnnotation history (exact words and target versions): ${JSON.stringify(snapshot.history)}`;
 if(Buffer.byteLength(prompt)>16000)throw new Error('Image refinement context exceeds safe capacity; discuss consolidation with the captain');
 return{snapshot,reference,prompt};
}
