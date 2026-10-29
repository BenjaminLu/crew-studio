// Where one issue stands after the captain pressed Fix on it (docs/units/board.md, "Fixing issues"): its hidden one-issue
// triage, then the outcome the triage record holds for it (src/domain/issue-triage.ts), then its fix Task. Shown on the
// issue's own row in its category; nothing here is written anywhere.
import type {TriageRecord,WorkState} from './issue-triage';

export type FixStateName='none'|'starting'|'queued'|'crew'|'investigating'|'judge'|'security'|'running'|'waiting'|'ready'|'merged'|'failed'|
 'needs-info'|'not-code'|'duplicate'|'in-progress'|'recheck'|'human'|'changed'|'proposed'|'approved'|'package';
export type FixState={state:FixStateName;
 /** another Fix on it starts nothing: its investigation or its Task is under way, or its Task is done */
 busy:boolean;
 /** "select all" takes it: nothing was decided about it yet, or its last attempt failed */
 pick:boolean;
 /** in an ordinary triage (not a Fix), which waits for the captain at its court or approval card */
 inBatch?:boolean;
 task?:string|null;court?:string|null;package?:string;why?:string;questions?:string[];duplicateOf?:number;pulls?:number[];fit?:string[];with?:string;where?:string;by?:string;at?:string};
/** the hidden triage a Fix click started, as the engine has it */
export type FixRun={id:string;status:string;error?:string|null;note?:string|null;
 /** the captain-only card it waits on: the disagreement court, or the approval card of a security package */
 waiting:'court'|'approve'|null;
 /** its docket names this issue (the court view can show it) */
 docket:boolean;
 /** waiting for an investigation slot (a few Fix investigations run at a time) */
 queued?:boolean};
/** an issue's Task, as the engine has it: waiting when it waits on a card */
export type FixWork={state:WorkState|'waiting';task:string|null;
 /** its task is still the proposal: the Task has not started */
 proposal?:boolean};
const ENDED=['succeeded','failed','cancelled'];
const BUSY:FixStateName[]=['starting','queued','crew','investigating','security','running','waiting','ready','merged'],PICK:FixStateName[]=['none','failed','changed','proposed','approved'];
const of=(state:FixStateName,o:Partial<FixState>={}):FixState=>({state,busy:BUSY.includes(state),pick:PICK.includes(state),...o});

export function fixState(n:number,o:{project:string;rec:TriageRecord|null;entry:{by:string;at:string;run?:string;error?:string;crewChanged?:true;specError?:string}|null;run:FixRun|null;work:(pkg:string,n:number)=>FixWork;dispatching:boolean;
 /** an ordinary triage reading this issue now (R-n): a Fix would pay for it twice */
 batch?:{id:string;waiting:boolean}|null}):FixState{
 const who=o.entry?{by:o.entry.by,at:o.entry.at}:{},court=(id:string)=>`#/court/${encodeURIComponent(o.project)}/${id}`;
 if(o.dispatching)return of('starting',who);
 const r=o.run;
 if(r&&!ENDED.includes(r.status)){
  // a disagreement waits for the captain's rulings on the docket page; its run is under way, so another Fix starts nothing
  if(r.waiting==='court')return{...of('judge',{...who,task:r.id,court:court(r.id)}),busy:true};
  if(r.waiting==='approve')return of('security',{...who,task:r.id});
  return of(r.queued?'queued':'investigating',{...who,task:r.id});}
 if(o.batch)return o.batch.waiting?{...of('judge',{task:o.batch.id,inBatch:true}),busy:true}:of('investigating',{task:o.batch.id,inBatch:true});
 if(r&&r.status!=='succeeded')return of('failed',{...who,task:r.id,why:r.status==='cancelled'?'cancelled':String(r.error??'the investigation failed').slice(0,300)});
 const rec=o.rec,k=String(n),i=rec?.issues[k],pkg=rec?.packages.find(p=>p.members.includes(n));
 if(pkg){
  const e=pkg.work?.[k];
  if(e){const w=o.work(pkg.id,n);
   if(w.state==='open'&&w.proposal&&o.entry?.crewChanged)return of('crew',{...who,task:w.task,package:pkg.id});
   if(w.state==='open')return of('running',{...who,task:w.task,package:pkg.id});
   if(w.state==='waiting')return of('waiting',{...who,task:w.task,package:pkg.id,...(o.entry?.specError?{why:o.entry.specError.slice(0,300)}:{})});
   if(w.state==='ready')return of('ready',{...who,task:w.task,package:pkg.id});
   if(w.state==='merged')return of('merged',{...who,task:w.task,package:pkg.id});
   return of('failed',{...who,task:w.task,package:pkg.id,why:'its Task ended without being ready'});}
  if(pkg.kind==='recheck')return of('recheck',{...who,package:pkg.id,...(pkg.match?{with:pkg.match.with,where:pkg.match.where}:{})});
  if(pkg.status==='stale')return of('changed',{...who,package:pkg.id});
  // a package of several issues is worked one issue at a time from the package (the advanced path), not from a row
  if(pkg.members.length>1)return of('package',{...who,package:pkg.id});
  if(o.entry?.error)return of('failed',{...who,package:pkg.id,why:o.entry.error.slice(0,300)});
  return of(pkg.status==='approved'?'approved':'proposed',{...who,package:pkg.id});}
 const x=(rec?.cross??[]).find(c=>c.issues.includes(n));
 if(x)return of('judge',{...who,with:x.with,where:x.where});
 const h=(rec?.toHuman??[]).find(t=>t.issues.includes(n));
 if(h?.kind==='duplicate')return of('duplicate',{...who,duplicateOf:h.duplicateOf});
 if(h?.kind==='in-progress')return of('in-progress',{...who,pulls:h.pulls??[]});
 if(h?.kind==='human-fit')return of('human',{...who,fit:h.fit??[]});
 if(h)return of('judge',{...who,why:h.reason.slice(0,300),court:r?.docket?court(r.id):null,...(r?{task:r.id}:{})});
 const none=(rec?.noCode??[]).find(c=>c.issues.includes(n));
 if(none)return none.state==='not-code'?of('not-code',who):of('needs-info',{...who,questions:none.questions?.[k]??[]});
 // the hidden triage ran and left nothing for this issue: it was not open, or it changed while it was investigated
 if(r)return of(i?.changed?'changed':'failed',{...who,task:r.id,why:String(r.note||'nothing was investigated').slice(0,300)});
 return of('none',who);
}
