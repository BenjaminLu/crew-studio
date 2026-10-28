// The disagreement court of an issue triage (docs/units/board.md, "The disagreement court"): what a batch left for a
// person, as a docket of cases the captain rules on one at a time, and the rulings applied to the project's stored
// triage. A case is one issue the reports disagree on (its state, its place in the code, whether it can be located at
// all, one report missing it, or a finding Studio's check refused); the issues both reports agree on but group
// differently (a package case); or one issue set aside before packaging (a likely duplicate, an open pull request naming
// it, or not an agent's work). What a case shows comes from Studio's own check: each side's locus as checked against the
// code, the quoted lines as they are in the file. Nothing here writes to GitHub, and no suggestion is made.
import {normalize} from 'node:path';
import {cleanText,compareReports,lineRange,mergeNoCode,needsCode,quotedLines,sharedLocus,takeRefusal,verifyReport,NEAR,
 type Finding,type Locus,type NoCode,type Package,type Reads,type Report,type RulingEntry,type Snapshot,type StoredPackage,type TriageRecord} from './issue-triage';
import type {GoldLabel} from './issue-eval';

/** Code a side quotes, as Studio read it at the pinned commit: a stretch of one file, its quoted lines marked. */
export type Excerpt={file:string;start:number;lines:string[];quoted:number[]};
/** One investigator's finding on one issue, as Studio checked it. The repro and questions are model-written text: shown
 *  as text, never acted on. */
export type Side={state:string;locus:Locus[];ok:boolean;problems:string[];repro:string;security:boolean;excerpts:Excerpt[];questions?:string[];duplicateOf?:number;
 /** a duplicate's matching symptom as this investigator quoted it from both issues' text (checked by Studio) */
 symptom?:{here:string;there:string};fit?:'agent'|'human';fitReason?:string};
/** One way to group a package case's issues: each part a package (joins: packages of this batch it takes in). */
export type Part={members:number[];order:number[];kind:Package['kind'];joins:string[]};
export type CaseKind='finding'|'package'|'duplicate'|'in-progress'|'human-fit';
export type CourtCase={id:string;kind:CaseKind;issues:number[];
 /** finding: state, locate (one side could not find it in the code), location, missing, duplicate, check; package:
  *  package; a set-aside case: its kind */
 diff:string[];reason:string;a:Record<string,Side|null>;b:Record<string,Side|null>;
 /** each issue's content hash as it was investigated: a ruling on an issue changed since is not applied */
 hashes?:Record<string,string>;
 /** each issue's comment count as it was investigated: a comment added since makes it changed too */
 comments?:Record<string,number>;
 /** per issue, what both reports agree on and both pass Studio's check for (null: they do not) */
 agreed:Record<string,{state:string}|null>;
 groupings?:{a:Part[];b:Part[];separate:Part[]};
 /** a duplicate case: the issue both name; an in-progress case: the open pull requests naming it; human-fit: why */
 duplicateOf?:number;pulls?:number[];fit?:string[];
 /** human-fit: how many investigators said so; in-progress: each pull request's author and their relation */
 fitFrom?:number;pullInfo?:{n:number;author:string;association:string}[]};
export type Docket={schema:1;project:string;repository:string;commit:string;by:{a:string;b:string};cases:CourtCase[]};
export type Pick='a'|'b'|'neither'|'needs-info'|'separate'|'confirm'|'not-duplicate'|'wait'|'take'|'human'|'agent';
export type Ruling={case:string;pick:Pick;reason?:string};
/** what each kind of case is ruled: in the order the docket page offers them (keys 1 to 4) */
export const PICKS:Record<CaseKind,Pick[]>={finding:['a','b','neither','needs-info'],package:['a','b','separate','needs-info'],
 duplicate:['confirm','not-duplicate','needs-info'],'in-progress':['wait','take','needs-info'],'human-fit':['human','agent','needs-info']};
/** an item a batch set aside for a person, as the triage writes it (a plain disagreement has no kind) */
type HumanItem={issues:number[];reason:string;kind?:string;duplicateOf?:number;pulls?:number[];fit?:string[];fitFrom?:number;pullInfo?:{n:number;author:string;association:string}[]};

const sorted=(ns:number[])=>[...new Set(ns)].sort((x,y)=>x-y);
const oneLine=(s:unknown,max:number)=>cleanText(s,max*2).replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,max);
const EXCERPT=60,LINE_MAX=400,KINDS=['duplicate','in-progress','human-fit'];

/** A side's quoted code: each checked locus with a line range, from a little above to a little below the stated range
 *  and any quoted line within NEAR of it, at most EXCERPT lines. */
function excerpts(f:Finding,locus:Locus[],read:(file:string)=>string|null):Excerpt[]{
 const out:Excerpt[]=[];
 for(const l of locus){const at=lineRange(l.lines),t=at?read(l.file):null;if(!at||t===null)continue;const lines=t.split('\n');
  const q=quotedLines(f.evidence,lines,at[0]-NEAR,at[1]+NEAR);
  const lo=Math.max(1,Math.min(at[0],q[0]??at[0])-2);let hi=Math.min(lines.length,Math.max(at[1],q.at(-1)??at[1])+2);if(hi-lo+1>EXCERPT)hi=lo+EXCERPT-1;
  out.push({file:l.file,start:lo,lines:lines.slice(lo-1,hi).map(s=>s.slice(0,LINE_MAX)),quoted:q.filter(n=>n>=lo&&n<=hi)});}
 return out.slice(0,6);
}
const questionsOf=(f:any):string[]=>Array.isArray(f?.questions)?f.questions.filter((q:unknown)=>typeof q==='string').map((q:string)=>oneLine(q,300)).filter(Boolean).slice(0,5):[];

/** The docket of one batch: its items for a person (the batch's toHuman), each issue in at most one case. An item set
 *  aside before packaging (duplicate, in-progress, human-fit) is a case of its kind per issue. Of any other item, an issue
 *  the reports disagree on, or whose finding fails Studio's check, is a finding case of its own; the issues both reports
 *  agree on and both pass are one package case, ruled on how to group them. `skip`: issues not to rule on (changed on
 *  GitHub while investigated, or closed: a later batch takes them again). `added`: this batch's new packages, which a
 *  grouping may take in when the set one report gives holds all of a package's issues. */
export function buildDocket(o:{project:string;repository:string;commit:string;snapshot:Snapshot;a:Report;b:Report;read:(file:string)=>string|null;reads?:{a?:Reads;b?:Reads};
 toHuman:HumanItem[];added:StoredPackage[];skip?:Iterable<number>;by:{a:string;b:string}}):Docket{
 const {a,b,read}=o,reads=o.reads??{},skip=new Set(o.skip??[]),inSnap=new Set(o.snapshot.issues.map(i=>i.n));
 const va=new Map(verifyReport(a,o.snapshot,read,reads.a).map(c=>[c.n,c])),vb=new Map(verifyReport(b,o.snapshot,read,reads.b).map(c=>[c.n,c]));
 const cmp=new Map(compareReports(a,b).map(c=>[c.n,c]));
 const agreedOn=(n:number)=>{const c:any=cmp.get(n);return va.get(n)?.ok&&vb.get(n)?.ok&&c?.agree&&c.state?{state:String(c.state)}:null;};
 const sound=(n:number)=>needsCode(agreedOn(n)?.state);
 const side=(r:Report,v:typeof va,n:number):Side|null=>{const f:any=r.issues.find(x=>x.n===n);if(!f)return null;const c=v.get(n),locus=sharedLocus(f,f,read),qs=questionsOf(f);
  return{state:String(f.state),locus,ok:!!c?.ok,problems:(c?.problems??[]).slice(0,10).map(p=>oneLine(p,300)),repro:oneLine(f.repro,500),security:f.security==='yes'||!!c?.security,excerpts:excerpts(f,locus,read),
   ...(qs.length?{questions:qs}:{}),...(Number.isSafeInteger(f.duplicateOf)?{duplicateOf:f.duplicateOf}:{}),
   ...(f.symptom&&typeof f.symptom.here==='string'&&typeof f.symptom.there==='string'?{symptom:{here:oneLine(f.symptom.here,500),there:oneLine(f.symptom.there,500)}}:{}),
   ...(f.fit==='human'||f.fit==='agent'?{fit:f.fit,...(f.fit==='human'&&typeof f.fitReason==='string'?{fitReason:oneLine(f.fitReason,40)}:{})}:{})};};
 const hashOf=new Map(o.snapshot.issues.map(i=>[i.n,i.hash]));
 const commentsOf=new Map(o.snapshot.issues.map(i=>[i.n,Number((i as any).comments)||0]));
 const sides=(ns:number[])=>({hashes:Object.fromEntries(ns.map(n=>[n,hashOf.get(n)??''])),comments:Object.fromEntries(ns.map(n=>[n,commentsOf.get(n)??0])),a:Object.fromEntries(ns.map(n=>[n,side(a,va,n)])),b:Object.fromEntries(ns.map(n=>[n,side(b,vb,n)])),agreed:Object.fromEntries(ns.map(n=>[n,agreedOn(n)]))});
 const both=(n:number,s:string)=>a.issues.find(f=>f.n===n)?.state===s&&b.issues.find(f=>f.n===n)?.state===s;
 const cases:CourtCase[]=[],placed=new Set<number>();let k=0;
 const grouping=(r:Report,R:number[]):Part[]=>{const parts:Part[]=[],done=new Set<number>();
  for(const n of R){if(done.has(n))continue;
   const g=r.groups.find(x=>x.members.includes(n)),rel=g?undefined:r.related.find(x=>x.members.includes(n));
   const set=g?g.members:rel?rel.members:[n];
   // a package of this batch the set holds whole is taken in (the issue left aside joins the issues both reports named)
   const joins=o.added.filter(p=>p.status==='proposed'&&p.members.every(m=>set.includes(m))&&!p.members.some(m=>R.includes(m)));
   const members=sorted([...set.filter(m=>R.includes(m)),...joins.flatMap(p=>p.members)]);members.forEach(m=>done.add(m));
   const order=rel?.order.length?[...rel.order.filter(m=>members.includes(m)),...members.filter(m=>!rel.order.includes(m))]:g?members:[];
   const kind:Package['kind']=members.every(m=>both(m,'fixed?'))?'recheck':members.length===1?'single':g?'one-change':rel?.order.length?'ordered':'unordered';
   parts.push({members,order:kind==='recheck'||kind==='single'?members:order,kind,joins:joins.map(p=>p.id)});}
  return parts;};
 for(const h of o.toHuman){const S=sorted(h.issues).filter(n=>!skip.has(n)&&inSnap.has(n)&&!placed.has(n));if(!S.length)continue;S.forEach(n=>placed.add(n));
  if(h.kind&&KINDS.includes(h.kind)){for(const n of S)cases.push({id:`C-${++k}`,kind:h.kind as CaseKind,issues:[n],diff:[h.kind],reason:oneLine(h.reason,300),...sides([n]),
   ...(Number.isSafeInteger(h.duplicateOf)?{duplicateOf:h.duplicateOf}:{}),...(Array.isArray(h.pulls)?{pulls:h.pulls.filter(Number.isSafeInteger).slice(0,20)}:{}),...(Array.isArray(h.fit)?{fit:h.fit.map(x=>oneLine(x,40)).slice(0,6)}:{}),
   ...(Number.isSafeInteger(h.fitFrom)?{fitFrom:h.fitFrom}:{}),...(Array.isArray(h.pullInfo)?{pullInfo:h.pullInfo.filter(p=>Number.isSafeInteger(p?.n)).slice(0,20).map(p=>({n:p.n,author:oneLine(p.author,100),association:oneLine(p.association,40)}))}:{})});continue;}
  for(const n of S.filter(n=>!sound(n))){const c=cmp.get(n),fa=a.issues.find(f=>f.n===n),fb=b.issues.find(f=>f.n===n),diff=[...(c?.diff??[])];
   const unlocated=(s?:string)=>s==='not-found'||s==='needs-info';
   if(diff.includes('state')&&unlocated(fa?.state)!==unlocated(fb?.state))diff.push('locate');
   if(!diff.length)diff.push('check');
   cases.push({id:`C-${++k}`,kind:'finding',issues:[n],diff,reason:oneLine(h.reason,300),...sides([n])});}
  const R=S.filter(sound);
  if(R.length)cases.push({id:`C-${++k}`,kind:'package',issues:R,diff:['package'],reason:oneLine(h.reason,300),...sides(R),
   groupings:{a:grouping(a,R),b:grouping(b,R),separate:R.map(n=>({members:[n],order:[n],kind:both(n,'fixed?')?'recheck' as const:'single' as const,joins:[]}))}});}
 return{schema:1,project:o.project,repository:o.repository,commit:o.commit,by:{a:oneLine(o.by.a,120),b:oneLine(o.by.b,120)},cases};
}

/** The captain's rulings, as sent: each a case of this docket, ruled once, with a pick its kind offers (PICKS) and an
 *  optional one-line reason. Adopting a side's finding needs that finding to pass Studio's check. Anything else refuses
 *  the whole set. */
export function parseRulings(d:Docket,raw:unknown):Ruling[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>d.cases.length)throw new Error(`Send one ruling for each of the docket's ${d.cases.length} case${d.cases.length===1?'':'s'}`);
 const seen=new Set<string>();
 const out=raw.map((r:any):Ruling=>{
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(x=>!['case','pick','reason'].includes(x)))throw new Error('A ruling is {case, pick, reason?}');
  const c=d.cases.find(x=>x.id===r.case);if(typeof r.case!=='string'||!c)throw new Error(`${String(r.case).slice(0,20)} is not a case of this docket`);
  if(seen.has(c.id))throw new Error(`${c.id} is ruled twice`);seen.add(c.id);
  if(!PICKS[c.kind]?.includes(r.pick))throw new Error(`${c.id}: a ${c.kind} case is ruled ${(PICKS[c.kind]??[]).join(', ')}`);
  if(c.kind==='finding'&&(r.pick==='a'||r.pick==='b')){const s=c[r.pick as 'a'|'b'][String(c.issues[0])];
   if(!s)throw new Error(`${c.id}: investigator ${r.pick.toUpperCase()} did not report #${c.issues[0]}`);
   if(!s.ok)throw new Error(`${c.id}: investigator ${r.pick.toUpperCase()}'s finding on #${c.issues[0]} failed Studio's check, so it cannot be adopted`);}
  if(r.reason!==undefined&&r.reason!==null&&(typeof r.reason!=='string'||r.reason.length>400))throw new Error(`${c.id}: the reason is one line of text`);
  const reason=typeof r.reason==='string'?oneLine(r.reason,200):'';
  return{case:c.id,pick:r.pick,...(reason?{reason}:{})};});
 // every case is ruled: the rulings answer the court card once, and a case left out would never come back to the court
 if(out.length!==d.cases.length)throw new Error(`Rule every case of the docket: ${d.cases.filter(c=>!seen.has(c.id)).map(c=>c.id).join(', ')} not ruled`);
 return out;
}

const lastId=(rec:TriageRecord)=>Math.max(rec.lastPackage??0,...rec.packages.map(p=>Number(p.id.slice(2))||0));
/** The rulings applied to the project's stored triage, each case's issues taken off the items for a person.
 *  - A finding's A or B: that finding becomes the issue's state and place (its locus as Studio checked it); code to change
 *    makes a single package (a recheck when maybe fixed) waiting for approval; nothing to change puts it with the agreed
 *    no-code issues. Neither: the issue is released, to be triaged again.
 *  - A package case's A or B grouping, or all separate: each part a package waiting for approval, taking in the batch's
 *    package it holds whole.
 *  - A duplicate confirmed, a pull request still in progress, a person's work agreed: recorded, nothing packaged (nothing
 *    is closed, labeled or commented on GitHub). Not a duplicate, take it anyway, give it to an agent: what both reports
 *    agree on is adopted (a single package, or the agreed no-code state); where they disagree it stays for a person.
 *  - Needs-info: with the no-code issues as needs-info, the reports' questions for the reporter kept, shown only in Studio.
 *  Each ruling is recorded on the record and gives the captain's gold labels (state, files, package) where it says one. */
export function applyRulings(rec:TriageRecord,d:Docket,rulings:Ruling[],o:{run:string;card:string;by:string;at:string;
 /** issues whose content hash (title, text and labels) changed on GitHub since the docket, or closed: their cases are not applied */
 changed?:Iterable<number>}){
 const moved=new Set(o.changed??[]),skipped:number[]=[];
 const issues={...rec.issues},added:string[]=[],removed:string[]=[],released:number[]=[],needsInfo:number[]=[],gold:Record<string,GoldLabel>={},entries:RulingEntry[]=[],back:{issues:number[];reason:string}[]=[];
 let packages=[...rec.packages],noCode:NoCode[]=[...(rec.noCode??[])],last=lastId(rec);
 const ruled=new Set<number>();
 const files=(...ss:(Side|null|undefined)[])=>[...new Set(ss.flatMap(s=>(s?.locus??[]).map(l=>normalize(l.file))))].sort();
 const mark=(n:number,f:Partial<typeof issues[string]>,r:Ruling)=>{const i=issues[String(n)];if(!i)return;const next:any={...i,...f,ruled:{pick:r.pick,case:r.case,run:o.run,by:o.by,at:o.at}};
  for(const k of Object.keys(next))if(next[k]===undefined)delete next[k];issues[String(n)]=next;};
 const newPack=(p:{kind:Package['kind'];members:number[];order:number[]}):string=>{const id=`P-${++last}`,security=p.members.some(n=>issues[String(n)]?.security);
  packages.push({...p,why:'',security,agreement:'exact',id,commit:d.commit,status:'proposed'});added.push(id);return id;};
 const label=(n:number,l:Omit<GoldLabel,'n'|'source'|'at'>,r:Ruling)=>{gold[String(n)]={n,...l,source:'captain',at:o.at,from:[`captain: ruled ${r.pick} on ${r.case} of ${o.run}`]};};
 const toNoCode=(n:number,state:NoCode['state'],questions?:string[])=>noCode.push({issues:[n],state,reason:'',...(questions?.length?{questions:{[String(n)]:questions}}:{})});
 /** what both reports agree on, adopted: code to change, a single package; nothing to change, the no-code state; else for a person */
 const adopt=(c:typeof d.cases[number],n:number,r:Ruling,made:string[])=>{const ag=c.agreed[String(n)],sa=c.a[String(n)],sb=c.b[String(n)];
  // the captain's ruling overrides what set it aside: not a duplicate after all, or an agent's work
  const over:Partial<typeof issues[string]>=r.pick==='not-duplicate'?{duplicateOf:undefined}:r.pick==='agent'?{fit:'agent',fitReason:undefined}:{};
  if(ag&&needsCode(ag.state)){const id=newPack({kind:ag.state==='fixed?'?'recheck':'single',members:[n],order:[n]});made.push(id);mark(n,{checked:true,...over},r);
   // taken although an open pull request names it: the package records it, as taking it on the project page does
   if(r.pick==='take')packages=packages.map(p=>p.id===id?{...p,taken:{by:o.by,at:o.at,pulls:c.pulls??[]}}:p);
   label(n,{state:ag.state as GoldLabel['state'],...(files(sa,sb).length?{files:files(sa,sb)}:{}),package:id},r);}
  else if(ag){mark(n,{checked:true,state:ag.state as any,...over},r);toNoCode(n,ag.state as NoCode['state'],[...(sa?.questions??[]),...(sb?.questions??[])]);if(ag.state==='needs-info')needsInfo.push(n);label(n,{state:ag.state as GoldLabel['state']},r);}
  else{mark(n,over,r);back.push({issues:[n],reason:`the captain ruled ${r.pick} on #${n}, but the two reports disagree on it (or Studio's check fails): decide it here`});}};
 for(const r of rulings){const c=d.cases.find(x=>x.id===r.case)!;const made:string[]=[];
  // decided on text that is no longer the issue's: left for the next triage, which investigates it again
  if(c.issues.some(n=>moved.has(n))){const ns=c.issues.filter(n=>!!issues[String(n)]);skipped.push(...ns);c.issues.forEach(n=>ruled.add(n));
   if(ns.length)back.push({issues:ns,reason:`changed on GitHub while the court waited: the captain's ruling (${r.pick}) on ${c.id} is not applied; the next triage takes ${ns.length===1?'it':'them'} again`});
   entries.push({case:c.id,kind:c.kind,issues:c.issues,pick:r.pick,...(r.reason?{reason:r.reason}:{}),packages:[],run:o.run,card:o.card,by:o.by,at:o.at,skipped:'changed'} as RulingEntry);continue;}
  // an issue closed or gone since the docket was made is left as it is
  const live=c.issues.filter(n=>!!issues[String(n)]);
  if(r.pick==='needs-info'){for(const n of live){const qs=[...new Set([...(c.a[String(n)]?.questions??[]),...(c.b[String(n)]?.questions??[])])].slice(0,5);
    mark(n,{state:'needs-info',checked:true},r);toNoCode(n,'needs-info',qs);needsInfo.push(n);label(n,{state:'needs-info'},r);}}
  else if(r.pick==='neither'){for(const n of live){mark(n,{investigated:false},r);released.push(n);}}
  else if(r.pick==='confirm'||r.pick==='human'){for(const n of live)mark(n,{},r);}
  // still in progress: recorded, and left set aside, so the captain can still take it on the project page once that work ends
  else if(r.pick==='wait'){for(const n of live)mark(n,{},r);entries.push({case:c.id,kind:c.kind,issues:c.issues,pick:r.pick,...(r.reason?{reason:r.reason}:{}),packages:[],run:o.run,card:o.card,by:o.by,at:o.at});continue;}
  // take it anyway: refused as the project page refuses it (a person's work, a duplicate, no agreed code): it stays set aside
  else if(r.pick==='take'){const no=live.map(n=>takeRefusal(issues[String(n)],n)).find(Boolean);
   if(no){for(const n of live)mark(n,{},r);entries.push({case:c.id,kind:c.kind,issues:c.issues,pick:r.pick,...(r.reason?{reason:r.reason}:{}),packages:[],run:o.run,card:o.card,by:o.by,at:o.at,refused:no});continue;}
   for(const n of live)adopt(c,n,r,made);}
  // not a duplicate: the rules the duplicate went before apply now, in the triage's order: an open pull request naming it
  // sets it aside as in progress, a person's work as human-fit; only then is what both reports agree on adopted
  else if(r.pick==='not-duplicate'){for(const n of live){const i=issues[String(n)];
    if(i?.inProgress?.length){mark(n,{duplicateOf:undefined},r);back.push({issues:[n],reason:`ruled not a duplicate; open pull request ${i.inProgress.map(p=>'#'+p).join(' ')} names #${n}: work may be in progress; check it before anyone starts`,kind:'in-progress',pulls:i.inProgress} as any);}
    else if(i?.fit==='human'){mark(n,{duplicateOf:undefined},r);back.push({issues:[n],reason:`ruled not a duplicate; not an agent's work (${(i.fitReason??[]).join(', ')}): a person takes it`,kind:'human-fit',fit:i.fitReason??[]} as any);}
    else adopt(c,n,r,made);}}
  else if(r.pick==='agent'){for(const n of live)adopt(c,n,r,made);}
  else if(c.kind==='finding'){const n=live[0],s=n!==undefined?c[r.pick as 'a'|'b'][String(n)]:null;
   if(n!==undefined&&s){mark(n,{state:s.state as any,locus:s.locus,checked:true,security:!!issues[String(n)]?.security||s.security},r);
    if(needsCode(s.state)){const id=newPack({kind:s.state==='fixed?'?'recheck':'single',members:[n],order:[n]});made.push(id);label(n,{state:s.state as GoldLabel['state'],...(files(s).length?{files:files(s)}:{}),package:id},r);}
    else{toNoCode(n,s.state as NoCode['state'],s.questions);if(s.state==='needs-info')needsInfo.push(n);label(n,{state:s.state as GoldLabel['state']},r);}}}
  else{const parts=c.groupings![r.pick==='separate'?'separate':r.pick as 'a'|'b'],from=r.pick==='b'?c.b:c.a;
   for(const p of parts){
    // the batch's packages this part takes in, only while they still wait for approval: one declined meanwhile (its issues
    // released) or approved (its work may start) is left as it is, and its issues stay out of this part
    const into=p.joins.map(id=>packages.find(x=>x.id===id&&x.status==='proposed')).filter((x):x is StoredPackage=>!!x);
    const allowed=new Set([...c.issues,...into.flatMap(x=>x.members)]),members=p.members.filter(n=>allowed.has(n)&&!!issues[String(n)]);if(!members.length)continue;
    const kind:Package['kind']=members.length===1?(p.kind==='recheck'?'recheck':'single'):p.kind;
    const pk={kind,members,order:kind==='single'||kind==='recheck'?members:p.order.filter(n=>members.includes(n))};let id:string;
    if(into.length){id=into[0].id;packages=packages.filter(x=>!into.slice(1).includes(x)).map(x=>x===into[0]?{...x,...pk,security:pk.members.some(n=>issues[String(n)]?.security)}:x);
     removed.push(...into.slice(1).map(x=>x.id));made.push(id);}
    else{id=newPack(pk);made.push(id);}
    for(const n of members.filter(n=>c.issues.includes(n))){const s=from[String(n)]??c.a[String(n)];mark(n,{checked:true},r);label(n,{...(s?{state:s.state as GoldLabel['state']}:{}),...(files(s).length?{files:files(s)}:{}),package:id},r);}}}
  c.issues.forEach(n=>ruled.add(n));
  entries.push({case:c.id,kind:c.kind,...(c.duplicateOf!==undefined?{duplicateOf:c.duplicateOf}:{}),issues:c.issues,pick:r.pick,...(r.reason?{reason:r.reason}:{}),packages:made,run:o.run,card:o.card,by:o.by,at:o.at});}
 const investigated=Object.entries(issues).filter(([,v])=>v.investigated).map(([n])=>Number(n)).sort((x,y)=>x-y);
 const record:TriageRecord={...rec,issues,investigated,packages,lastPackage:last,noCode:mergeNoCode(noCode.map(x=>({...x,issues:x.issues.filter(n=>!released.includes(n))}))),
  toHuman:[...rec.toHuman.map(h=>({...h,issues:h.issues.filter(n=>!ruled.has(n))})).filter(h=>h.issues.length),...back],
  rulings:[...(rec.rulings??[]),...entries].slice(-1000)};
 return{record,added,removed:[...new Set(removed)].filter(id=>!added.includes(id)),released,needsInfo:sorted(needsInfo),gold,skipped:sorted(skipped)};
}
