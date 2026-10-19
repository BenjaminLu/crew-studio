import type { LedgerEntry } from '../runtime/checks';
export const CODE_GATES=['branch','rebase','scope','failfirst','ci','approval','design'] as const;
type Subject={head:string|null;base:string|null};
export type RequiredCodeEvidence={seq:number;check:string;head:string;files:string[]};
export type CodeEvidenceOffer=Subject & {version:1;requiredEvidence:RequiredCodeEvidence[]};
type Input={run:string;offered:Subject & Partial<CodeEvidenceOffer>;current:Subject;trusted:{ok:boolean;entries:LedgerEntry[]};filePresent:(entry:LedgerEntry,file:string)=>boolean};
const executionChecks=new Set(['firstmate/ci','firstmate/fail-first']);
const latest=(entries:LedgerEntry[],check:string)=>entries.filter(e=>e.check===check).at(-1);
/** Only the issuer supplies mandatory evidence. Optional media and unrecorded provenance are never mandatory. */
export function snapshotCodeEvidence(subject:Subject,entries:LedgerEntry[]):CodeEvidenceOffer {
  const requiredEvidence:RequiredCodeEvidence[]=[];
  for(const check of executionChecks){const e=latest(entries,check);if(e?.head===subject.head&&e.head&&e.data?.status!=='not-run'&&e.evidence?.length)
    requiredEvidence.push({seq:e.seq,check:e.check,head:e.head,files:[...e.evidence]});}
  return {...subject,version:1,requiredEvidence};
}
/** Pure projection. Callers authenticate the ledger and supply path-contained file availability; no model output is consumed. */
export function projectCodeEvidence(i:Input){
  const entries=i.trusted.entries.filter(e=>e.run===i.run);
  const reasons:string[]=[];let state:'success'|'fail'|'missing'|'stale'='success';
  const gates=CODE_GATES.map(name=>{const e=latest(entries,`firstmate/gate-${name}`);return {name,seq:e?.seq??null,head:e?.head??null,verdict:e?.verdict??'unknown',detail:e?.findings?.map(f=>f.message).join('; ')??''};});
  if(!i.trusted.ok){state='fail';reasons.push('ledger-integrity');}
  else if(gates.some(g=>g.head===i.offered.head&&['fail','error'].includes(g.verdict))){state='fail';reasons.push('gate-failed');}
  else if(!i.offered.head||!i.offered.base||gates.some(g=>g.head!==i.offered.head||g.verdict!=='pass')){state='missing';reasons.push('gate-unbound');}
  const execution=[...executionChecks].map(check=>{
    const e=latest(entries,check),bound=!!e&&e.head===i.offered.head;
    const status=!bound?'unknown':e.data?.status==='not-run'?'not-run':e.data?.applicable===false||e.data?.status==='not-applicable'?'not-applicable':e.evidence?.length?'recorded':'unknown';
    return {check,seq:e?.seq??null,head:e?.head??null,verdict:bound?e.verdict:'unknown',status,command:bound&&Array.isArray(e.data?.command)?e.data.command:null,reason:bound?String(e.data?.reason??e.data?.why??''):'No exact-head receipt',shards:bound&&Array.isArray(e.data?.shards)?e.data.shards:[],files:bound?(e.evidence??[]).map(file=>({file,href:`/api/wruns/${encodeURIComponent(i.run)}/evidence?seq=${e.seq}&file=${encodeURIComponent(file)}`,present:i.filePresent(e,file)})):[]};
  });
  if(execution.some(e=>e.head===i.offered.head&&['fail','error'].includes(e.verdict))){state='fail';reasons.push('execution-failed');}
  if(i.offered.version===1){for(const required of i.offered.requiredEvidence??[]){const e=entries.find(e=>e.seq===required.seq&&e.check===required.check&&e.head===required.head&&e.head===i.offered.head);
    if(!e||required.files.some(file=>!e.evidence?.includes(file)||!i.filePresent(e,file))){if(state==='success')state='missing';reasons.push('required-evidence-missing');}}
  }
  if(i.offered.head!==i.current.head||i.offered.base!==i.current.base){state='stale';reasons.unshift('recorded-target-changed');}
  const capture=latest(entries,'firstmate/ui-captures');
  const media=capture?.head===i.offered.head&&capture.data?.head===i.offered.head&&capture.data?.base===i.offered.base&&capture.data?.rendered===true&&Array.isArray(capture.data?.captures)
    ?capture.data.captures.filter((p:any)=>[p.before,p.after].every(h=>typeof h==='string'&&h.startsWith('/api/')&&!h.startsWith('//'))).map((p:any)=>({label:String(p.label??'Page'),before:p.before,after:p.after,seq:capture.seq})):[];
  return {version:1 as const,media,state,blocked:i.offered.version===1&&state!=='success',legacy:i.offered.version!==1,offered:{head:i.offered.head,base:i.offered.base},current:i.current,gates,execution,reasons,
    limitations:['Recorded target only; live Git identity is rechecked by the merge action.','Signed receipts reference files; original file bytes have no producer digest.','Sandbox and service provenance are unknown unless explicitly recorded.','No recording.','Intent-to-diff mappings are suggestions, not proof of behavior.']};
}
export type CodeCardEvidence=ReturnType<typeof projectCodeEvidence>;
