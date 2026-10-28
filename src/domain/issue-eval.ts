// The issue evaluation set (docs/units/issue-eval.md): gold answers for a project's issue triage and categories, so a
// change to a skill, a model or an agreement rule is measured instead of guessed. Gold comes from the captain (a labeled
// template, imported) or is derived from what Studio already records (the captain's moves on the categories page, the
// packages the captain approved or joined, packages whose work merged). The scorer replays the investigators' stored
// reports through the CURRENT rules of src/domain/issue-triage.ts (imported, never copied) against that gold. No model
// runs here, nothing is written to GitHub, and a gold set lives only in Studio's data directory.
import {createHash} from 'node:crypto';
import {isAbsolute,normalize} from 'node:path';
import * as triage from './issue-triage';
import type {Checked,Finding,Reads,Report,Snapshot,TriageRecord,WorkState} from './issue-triage';
import {PLANNED,type CategoryRecord} from './issue-categories';

/** the triager's states, and needs-info: the captain's ruling that an issue needs more from its reporter (src/domain/issue-court.ts) */
export type GoldState=Finding['state']|'needs-info';
/** One issue's gold answer. Every field is optional: a field is scored only where it is labeled. */
export type GoldLabel={n:number;state?:GoldState;files?:string[];security?:'yes'|'no';
 /** a category id (C-n) or PLANNED */
 category?:string;
 /** the captain took it off planned work: any category but PLANNED */
 notPlanned?:true;
 /** a group key: issues with one key belong in one work package */
 package?:string;
 source:'captain'|'derived';at:string;
 /** derived: what it was read from (a captain's move, an approved or joined package, a merged Task) */
 from?:string[]};
export type GoldSet={schema:1;project:string;captain:Record<string,GoldLabel>;derived:Record<string,GoldLabel>;updatedAt:string};
export const GOLD_SCHEMA=1, TEMPLATE_SCHEMA=1, SCORE_SCHEMA=1;
const STATES:GoldState[]=['present','fixed?','not-code','not-found','needs-info'];
const FIELDS=['state','files','security','category','notPlanned','package'] as const;
const cmp=(x:string,y:string)=>x<y?-1:x>y?1:0;

/** The rules the scorer runs: the live functions of src/domain/issue-triage.ts, so a changed rule changes the score. */
export const RULES={parseReport:triage.parseReport,verifyReport:triage.verifyReport,compareReports:triage.compareReports,proposePackages:triage.proposePackages};
export type Rules=typeof RULES;

export const emptyGold=(project:string,at:string):GoldSet=>({schema:1,project,captain:{},derived:{},updatedAt:at});
/** The gold answer per issue: the captain's fields win over derived ones, field by field. */
export function effectiveGold(g:GoldSet):Record<string,GoldLabel&{sources:Partial<Record<typeof FIELDS[number],'captain'|'derived'>>}>{
 const out:Record<string,any>={};
 for(const src of ['derived','captain'] as const)for(const[n,l]of Object.entries(g[src])){const cur=out[n]??{n:Number(n),source:src,at:l.at,sources:{}};
  for(const f of FIELDS)if(l[f]!==undefined){cur[f]=l[f];cur.sources[f]=src;}
  if(src==='captain'){cur.source='captain';cur.at=l.at;}out[n]=cur;}
 return out;
}

// ---------- derived labels: from what Studio records already ----------
/** Gold read from the records: on categories, the captain's moves, planned tags and "not planned" (a merge only follows the
 *  model's own category, so it is not a judgement); on the triage, every package the captain approved or joined a match
 *  to (its members belong together), and every issue whose Task merged (the problem was there; not for a recheck package). A decline is not kept by
 *  the triage record (the package is dropped), so it gives nothing. */
export function mineDerived(o:{triage:TriageRecord|null;categories:CategoryRecord|null;work?:(proposal:string)=>WorkState;at:string}):Record<string,GoldLabel>{
 const out:Record<string,GoldLabel>={};
 const put=(n:number,f:Partial<GoldLabel>,from:string)=>{const cur=out[String(n)]??{n,source:'derived' as const,at:o.at,from:[]};Object.assign(cur,f);cur.from=[...new Set([...(cur.from??[]),from])];out[String(n)]=cur;};
 for(const[k,a]of Object.entries(o.categories?.assignments??{})){const n=Number(k);if(!Number.isSafeInteger(n))continue;
  if(a.notPlanned)put(n,{notPlanned:true},'captain: not planned');
  if(a.by==='captain'&&a.category&&!/^merged by/.test(a.why??''))put(n,{category:a.category},a.category===PLANNED?'captain: tagged planned':'captain: moved');}
 for(const p of o.triage?.packages??[]){
  const judged=p.status==='approved'||!!p.approvedBy||!!p.joins?.length;
  if(judged)for(const n of p.members)put(n,{package:p.id},p.joins?.length?'captain: joined a match':'captain: approved');
  // a recheck asks whether earlier work already fixed the issue: its Task merging says nothing about the problem's state
  for(const[k,w]of Object.entries(p.work??{}))if(o.work?.(w.proposal)==='merged')put(Number(k),p.kind==='recheck'?{package:p.id}:{state:'present',package:p.id},'work merged');}
 return out;
}

// ---------- the captain's labels: a template prefilled with the current answers, edited, imported ----------
type Row={n:number;title:string;stratum:string;reviewed:boolean;model:Record<string,unknown>;gold:Partial<GoldLabel>};
/** One investigator's answer on an issue, as the template and the scorer show it. */
export type Answer={state:GoldState;files:string[];security:'yes'|'no'};
export type Template={schema:1;kind:'issue-eval-labels';project:string;createdAt:string;note:string;rows:Row[]};
const rank=(seed:string,n:number)=>createHash('sha256').update(`${seed}\0${n}`).digest('hex');
/** The issues the records know: the triage's and the categories'. */
export function knownIssues(t:TriageRecord|null,c:CategoryRecord|null):Set<number>{
 return new Set([...Object.keys(t?.issues??{}),...Object.keys(c?.assignments??{}),...Object.keys(c?.titles??{}),...(c?.open??[]).map(String)].map(Number).filter(n=>Number.isSafeInteger(n)&&n>0));
}
/** A stratified sample to label: strata are category × whether the two investigators agreed (or nobody investigated),
 *  taken in turn so each is represented; within one, a fixed order from the seed. Issues the captain labeled are left out.
 *  Each row's gold is prefilled with the current answer; only rows marked reviewed are imported. */
export function labelTemplate(o:{project:string;triage:TriageRecord|null;categories:CategoryRecord|null;gold:GoldSet|null;sample:number;seed:string;at:string;
 /** each investigator's own answer per issue, from the stored reports (replay(...).preds) */
 reports?:Map<number,{a?:Answer;b?:Answer}>}):Template{
 const t=o.triage,c=o.categories,done=new Set(Object.keys(o.gold?.captain??{}).map(Number));
 const pkg=new Map<number,string>();for(const p of t?.packages??[])for(const n of p.members)pkg.set(n,p.id);
 const strata=new Map<string,number[]>();
 for(const n of [...knownIssues(t,c)].filter(n=>!done.has(n)).sort((a,b)=>a-b)){const i=t?.issues[String(n)],cat=c?.assignments[String(n)]?.category||'-';
  const s=`${cat}|${i?.investigated&&i.agree!==undefined?(i.agree?'agree':'disagree'):'not investigated'}`;strata.set(s,[...(strata.get(s)??[]),n]);}
 for(const ns of strata.values())ns.sort((a,b)=>cmp(rank(o.seed,a),rank(o.seed,b))||a-b);
 const keys=[...strata.keys()].sort(),picked:{n:number;s:string}[]=[];
 for(let round=0;picked.length<o.sample&&keys.some(k=>strata.get(k)!.length>round);round++)for(const k of keys){const n=strata.get(k)![round];if(n!==undefined&&picked.length<o.sample)picked.push({n,s:k});}
 const rows=picked.sort((a,b)=>a.n-b.n).map(({n,s})=>{const i=t?.issues[String(n)],a=c?.assignments[String(n)];
  const files=[...new Set((i?.locus??[]).map(l=>normalize(l.file)))],diff=new Set(i?.diff??[]),r=o.reports?.get(n);
  // where the two investigators disagree (the record's diff), the gold is left for the captain to decide
  const both=!diff.has('missing');
  return{n,title:i?.title??c?.titles?.[String(n)]??'',stratum:s,reviewed:false,
   model:{investigated:!!i?.investigated,agree:i?.agree??null,diff:[...diff],checked:i?.checked??null,a:r?.a??null,b:r?.b??null,studio:{state:i?.state??null,files,security:i?.security?'yes':'no'},category:a?.category||null,categoryBy:a?.by??null,
    categoryName:c?.categories.find(x=>x.id===a?.category)?.name??(a?.category===PLANNED?PLANNED:null),package:pkg.get(n)??null},
   gold:{...(i?.state&&both&&!diff.has('state')?{state:i.state}:{}),...(files.length&&both&&!diff.has('state')&&!diff.has('location')?{files}:{}),...(i?.investigated&&both&&!(r?.a&&r?.b&&r.a.security!==r.b.security)?{security:(i.security?'yes':'no') as 'yes'|'no'}:{}),...(a?.category?{category:a.category}:{}),...(pkg.has(n)?{package:pkg.get(n)}:{})}};});
 return{schema:1,kind:'issue-eval-labels',project:o.project,createdAt:o.at,note:'Prefilled with the current answers, except where the two investigators disagree (model.diff): decide those. Correct each row\'s gold (state: present | fixed? | not-code | not-found | needs-info; files: paths in the checkout; security: yes | no; category: C-n or PLANNED, or notPlanned: true; package: any key, one key per work package), drop a field you cannot judge, set reviewed: true, then import. Rows not reviewed are skipped.',rows};
}

const inside=(f:string)=>!!f&&!isAbsolute(f)&&!normalize(f).split(/[\\/]/).some(p=>p==='..'||p==='.git');
/** A labeled template read back. Anything wrong refuses the whole import, every problem listed: a state or security answer
 *  outside the skill's words, an issue the records do not know, a category that is not open, a path outside the checkout. */
export function parseLabels(raw:any,o:{project:string;triage:TriageRecord|null;categories:CategoryRecord|null;at:string}):{labels:Record<string,GoldLabel>;skipped:number}{
 const problems:string[]=[];
 if(!raw||typeof raw!=='object'||raw.kind!=='issue-eval-labels')throw new Error('Not an issue-eval label file');
 if(raw.schema!==TEMPLATE_SCHEMA)throw new Error(`Unknown label file schema ${raw.schema}`);
 if(raw.project!==o.project)throw new Error(`This label file is for ${String(raw.project).slice(0,200)}, not ${o.project}`);
 if(!Array.isArray(raw.rows)||raw.rows.length>5000)throw new Error('rows');
 const known=knownIssues(o.triage,o.categories),open=new Set((o.categories?.categories??[]).filter(c=>c.status==='active'||c.status==='proposed').map(c=>c.id));
 const labels:Record<string,GoldLabel>={},seen=new Set<number>();let skipped=0;
 for(const r of raw.rows){const n=r?.n,at=`#${n}`;
  if(!Number.isSafeInteger(n)||n<1){problems.push(`a row without an issue number`);continue;}
  if(seen.has(n)){problems.push(`${at} is in the file twice`);continue;}seen.add(n);
  if(r.reviewed!==true){skipped++;continue;}
  if(!known.has(n)){problems.push(`${at} is not an issue of ${o.project}'s triage or categories`);continue;}
  const g=r.gold??{},l:GoldLabel={n,source:'captain',at:o.at},before=problems.length;
  if(typeof g!=='object'||Array.isArray(g)){problems.push(`${at}: gold is not an object`);continue;}
  for(const k of Object.keys(g))if(!(FIELDS as readonly string[]).includes(k)&&!['n','source','at','from'].includes(k))problems.push(`${at}: unknown field ${k.slice(0,40)}`);
  if(g.state!=null){if(!STATES.includes(g.state))problems.push(`${at}: state "${String(g.state).slice(0,40)}" is not one of ${STATES.join(', ')}`);else l.state=g.state;}
  if(g.security!=null){if(g.security!=='yes'&&g.security!=='no')problems.push(`${at}: security is yes or no`);else l.security=g.security;}
  if(g.files!=null){if(!Array.isArray(g.files)||g.files.length>50||!g.files.every((f:any)=>typeof f==='string'&&f.length<=300&&inside(f)))problems.push(`${at}: files are paths inside the checkout`);else l.files=[...new Set(g.files.map((f:string)=>normalize(f)))] as string[];}
  if(g.category!=null){if(g.category!==PLANNED&&!open.has(g.category))problems.push(`${at}: category ${String(g.category).slice(0,40)} is not an open category (C-n) or ${PLANNED}`);else l.category=g.category;}
  if(g.notPlanned!=null){if(g.notPlanned!==true)problems.push(`${at}: notPlanned is true or left out`);else if(l.category===PLANNED)problems.push(`${at}: both planned and not planned`);else l.notPlanned=true;}
  if(g.package!=null){if(typeof g.package!=='string'||!g.package.trim()||g.package.length>80)problems.push(`${at}: package is a short key`);else l.package=g.package.trim();}
  if(problems.length>before)continue;
  if(!FIELDS.some(f=>l[f]!==undefined)){problems.push(`${at} is reviewed but labels nothing`);continue;}
  labels[String(n)]=l;}
 if(problems.length)throw Object.assign(new Error(`The label file is refused (${problems.length} problem${problems.length===1?'':'s'}):\n${problems.slice(0,50).join('\n')}`),{problems});
 return{labels,skipped};
}

// ---------- the scorer ----------
/** One stored triage batch: its two reports, its snapshot and the code at the report's commit. */
/** `reads`: what fs_read returned to each investigator in its round, where the run recorded it. A report from before
 *  Studio recorded reads has none: it is replayed with every other check, only the "quoted from what fs_read showed you"
 *  check left out (counted in `withoutReads`), since that check cannot be made after the fact. */
export type Replay={run:string;at:string;a:unknown;b:unknown;snapshot:Snapshot;read:(file:string)=>string|null;reads?:{a?:Reads;b?:Reads};skills?:string[]};
export type Prediction={run:string;a?:Answer;b?:Answer;
 /** what Studio does with the issue: answered when it is in a work package both reports agree on, or when both agree it
  *  has nothing to change in the code (noCode: not-found or not-code, no files) */
 studio?:Answer;securityFlag:boolean;agree:boolean;package:string|null;noCode:'not-found'|'not-code'|null;human:boolean;
 /** its batch was replayed without recorded reads (from before Studio recorded them, or unreadable) */
 withoutReads:boolean};
const answer=(f?:Finding):Answer|undefined=>f&&{state:f.state,files:[...new Set(f.locus.map(l=>normalize(l.file)))],security:f.security};
/** Each stored batch through the current rules; an issue investigated twice is answered by its latest batch, as the
 *  stored triage keeps it. Packages are each batch's own (the cross-batch match is not replayed). */
export function replay(batches:Replay[],rules:Rules=RULES){
 const preds=new Map<number,Prediction>(),skipped:{run:string;why:string}[]=[];let toHuman=0,packages=0,withoutReads=0;
 for(const r of [...batches].sort((x,y)=>cmp(x.at,y.at)||cmp(x.run,y.run))){
  let a:Report,b:Report;try{a=rules.parseReport(r.a);b=rules.parseReport(r.b);}catch(e:any){skipped.push({run:r.run,why:String(e?.message??e).slice(0,200)});continue;}
  const reads=r.reads??{},blind=!reads.a||!reads.b;
  // one batch the current rules cannot judge (a malformed snapshot or reads) is skipped and named, never the whole score
  let va:Map<number,Checked>,vb:Map<number,Checked>,cmpd:Map<number,{agree:boolean}>,plan:ReturnType<Rules['proposePackages']>;
  try{va=new Map(rules.verifyReport(a,r.snapshot,r.read,reads.a).map(c=>[c.n,c]));vb=new Map(rules.verifyReport(b,r.snapshot,r.read,reads.b).map(c=>[c.n,c]));
   cmpd=new Map(rules.compareReports(a,b).map(c=>[c.n,c]));plan=rules.proposePackages(a,b,r.snapshot,r.read,reads);}
  catch(e:any){skipped.push({run:r.run,why:String(e?.message??e).slice(0,200)});continue;}
  if(blind)withoutReads++;
  const none=new Map<number,'not-found'|'not-code'>();for(const x of plan.noCode??[])for(const n of x.issues)none.set(n,x.state);
  const inPkg=new Map<number,string>();plan.packages.forEach((p,i)=>p.members.forEach(n=>inPkg.set(n,`${r.run}#${i+1}`)));
  packages+=plan.packages.length;toHuman+=plan.toHuman.length;
  for(const n of new Set([...a.issues,...b.issues].map(f=>f.n))){const fa=a.issues.find(f=>f.n===n),fb=b.issues.find(f=>f.n===n),key=inPkg.get(n)??null;
   const sa=answer(fa),sb=answer(fb),nc=none.get(n)??null,flag=!!(va.get(n)?.security||vb.get(n)?.security);
   const studio=key&&sa?{...sa,files:[...new Set([...sa.files,...(sb?.files??[])])].sort()}:nc?{state:nc,files:[],security:(flag?'yes':'no') as 'yes'|'no'}:undefined;
   preds.set(n,{run:r.run,a:sa,b:sb,studio,securityFlag:flag,agree:!!cmpd.get(n)?.agree,package:key,noCode:nc,human:!key&&!nc,withoutReads:blind});}}
 return{preds,skipped,packages,toHuman,withoutReads};
}

/** The categorizer's answer per issue: the record's own where the model filed it; where the captain changed it, what the
 *  categorizer's latest report said (given). Either way a merged category is followed to the one it was merged into. */
/** A category id followed through merges to the category that holds its issues now (PLANNED and unknown ids unchanged). */
export function followMerged(rec:CategoryRecord|null):(id:string)=>string{
 return id=>{for(let i=0;i<20&&rec;i++){const c=rec.categories.find(x=>x.id===id);if(c?.status==='merged'&&c.mergedInto){id=c.mergedInto;continue;}return id;}return id;};
}
export function categoryAnswers(rec:CategoryRecord|null,fromReports:Map<number,string>=new Map()):Map<number,string>{
 const out=new Map<number,string>();if(!rec)return out;
 const follow=followMerged(rec);
 for(const[k,a]of Object.entries(rec.assignments)){const n=Number(k);if(a.by==='model'&&a.category)out.set(n,follow(a.category));else if(fromReports.has(n))out.set(n,follow(fromReports.get(n)!));}
 return out;
}
/** What a categories run's report filed each issue into, as category ids of the record (a build's categories in order;
 *  a NEW name by the category that run made, or one already holding that name). */
export function reportCategories(rec:CategoryRecord,runs:{run:string;at:string;mode:'build'|'file';report:any}[]):Map<number,string>{
 const out=new Map<number,string>();
 for(const r of [...runs].sort((x,y)=>cmp(x.at,y.at)||cmp(x.run,y.run))){const made=rec.categories.filter(c=>c.createdBy.startsWith(`${r.run} (`)),byName=(name:string)=>{const k=String(name??'').trim().toLowerCase();return(made.find(c=>c.name.trim().toLowerCase()===k)??rec.categories.find(c=>c.name.trim().toLowerCase()===k))?.id;};
  if(r.mode==='build'){(r.report?.categories??[]).forEach((c:any,i:number)=>{const id=made[i]?.id??byName(c.name);if(id)for(const n of c.issues??[])out.set(Number(n),id);});for(const p of r.report?.planned??[])out.set(Number(p.n),PLANNED);}
  else for(const a of r.report?.assign??[]){const id=a.category==='NEW'?byName(a.new_name):a.category;if(id)out.set(Number(a.n),id);}}
 return out;
}

const rate=(num:number,den:number)=>den?Math.round(num/den*10000)/10000:null;
type Cls={precision:number|null;recall:number|null;support:number};
function classes<T extends string>(rows:{gold:T;pred?:T}[],labels:T[]):Record<string,Cls>{
 return Object.fromEntries(labels.map(c=>[c,{precision:rate(rows.filter(r=>r.pred===c&&r.gold===c).length,rows.filter(r=>r.pred===c).length),recall:rate(rows.filter(r=>r.gold===c&&r.pred===c).length,rows.filter(r=>r.gold===c).length),support:rows.filter(r=>r.gold===c).length}]));
}
/** gold: issues labeled; answered: of those, the ones the predictor answered; accuracy: right among answered;
 *  recall: right among all labeled (an unanswered issue counts as missed). */
function field<T extends string>(rows:{gold:T;pred?:T}[],labels:T[]){const ans=rows.filter(r=>r.pred!==undefined),right=ans.filter(r=>r.pred===r.gold).length;
 return{gold:rows.length,answered:ans.length,coverage:rate(ans.length,rows.length),accuracy:rate(right,ans.length),recall:rate(right,rows.length),classes:classes(rows,labels)};}
function fileOverlap(rows:{gold:string[];pred?:string[]}[]){const ans=rows.filter(r=>r.pred);let inter=0,p=0,g=0,hit=0;
 for(const r of ans){const gs=new Set(r.gold),k=r.pred!.filter(f=>gs.has(f)).length;inter+=k;p+=r.pred!.length;g+=r.gold.length;if(k)hit++;}
 return{gold:rows.length,answered:ans.length,coverage:rate(ans.length,rows.length),hit:rate(hit,ans.length),precision:rate(inter,p),recall:rate(inter,g)};}
const pairs=(ns:number[],key:(n:number)=>string|null|undefined)=>{const s=new Set<string>();for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){const a=key(ns[i]),b=key(ns[j]);if(a&&a===b)s.add(`${ns[i]},${ns[j]}`);}return s;};

type Eff=ReturnType<typeof effectiveGold>[string];
/** The metrics of one gold list. Package pairs are counted only within one replayed batch: the replay does not repeat
 *  the cross-batch match, so a gold pair whose issues were answered by different batches is counted apart (crossBatch)
 *  instead of as a miss; an issue whose gold package spans batches is left out of `exact` the same way. */
function metrics(gold:Eff[],P:Map<number,Prediction>,cats:Map<number,string>,follow:(id:string)=>string){
 const who=['a','b','studio'] as const,on=<K extends 'state'|'security'>(k:K)=>gold.filter(l=>l[k]!==undefined);
 const state=Object.fromEntries(who.map(w=>[w,field(on('state').map(l=>({gold:l.state!,pred:P.get(l.n)?.[w]?.state})),STATES)]));
 const security=Object.fromEntries(who.map(w=>[w,field(on('security').map(l=>({gold:l.security!,pred:w==='studio'?(P.has(l.n)?(P.get(l.n)!.securityFlag?'yes':'no') as 'yes'|'no':undefined):P.get(l.n)?.[w]?.security})),['yes','no'])]));
 const files=Object.fromEntries(who.map(w=>[w,fileOverlap(gold.filter(l=>l.files?.length).map(l=>({gold:l.files!,pred:P.get(l.n)?.[w]?.files})))]));
 // a gold category merged since it was labeled is the category it was merged into, as the answers are
 const catRows=gold.filter(l=>l.category!==undefined).map(l=>({gold:follow(l.category!),pred:cats.get(l.n)}));
 const planRows=gold.filter(l=>l.category!==undefined||l.notPlanned).map(l=>({gold:l.category===PLANNED?'planned':'not planned',pred:cats.has(l.n)?(cats.get(l.n)===PLANNED?'planned':'not planned'):undefined}));
 const {classes:_none,...cat}=field(catRows,[] as string[]),category={...cat,planned:field(planRows,['planned','not planned']).classes.planned};
 const pk=gold.filter(l=>l.package!==undefined).map(l=>l.n).sort((a,b)=>a-b),gk=new Map(gold.map(l=>[l.n,l.package]));
 const run=(n:number)=>P.get(n)?.run,apart=(x:string)=>{const[a,b]=x.split(',').map(Number);return!!run(a)&&!!run(b)&&run(a)!==run(b);};
 const all=pairs(pk,n=>gk.get(n)),gp=new Set([...all].filter(x=>!apart(x))),pp=pairs(pk,n=>P.get(n)?.package),both=[...pp].filter(x=>gp.has(x)).length;
 const same=(a:number[],b:number[])=>a.length===b.length&&a.every((x,i)=>x===b[i]),group=(n:number)=>pk.filter(m=>gk.get(m)===gk.get(n));
 const one=pk.filter(n=>group(n).every(m=>!run(m)||!run(n)||run(m)===run(n)));
 const exact=one.filter(n=>{const k=P.get(n)?.package;if(!k)return false;return same(group(n),pk.filter(m=>P.get(m)?.package===k));}).length;
 return{state,files,security,category,
  package:{gold:pk.length,pairs:{gold:gp.size,predicted:pp.size,precision:rate(both,pp.size),recall:rate(both,gp.size),crossBatch:all.size-gp.size},exact:rate(exact,one.length),exactOf:one.length}};
}
/** Every field against the gold set: per predictor (investigator A, B, and what Studio does with the two), the share
 *  routed to a person, and package membership as pairs of issues put together. The headline uses the effective gold
 *  (the captain's fields over derived ones); `bySource` scores the captain's labels and the derived ones apart, since
 *  derived package gold comes from the very packages Studio proposed and is circular on its own. */
export function score(o:{gold:GoldSet;replayed:ReturnType<typeof replay>;categories:Map<number,string>;follow?:(id:string)=>string}){
 const eff=effectiveGold(o.gold),gold=Object.values(eff),P=o.replayed.preds,follow=o.follow??(id=>id);
 const only=(src:'captain'|'derived')=>Object.values(o.gold[src]).map(l=>({...l,sources:{}}) as Eff);
 const investigated=P.size,human=[...P.values()].filter(p=>p.human).length;
 // the same metrics over only the issues answered by batches with recorded reads: old and new data side by side
 const RP=new Map([...P].filter(([,p])=>!p.withoutReads)),rHuman=[...RP.values()].filter(p=>p.human).length;
 return{gold:{issues:gold.length,captain:gold.filter(l=>l.source==='captain').length,derived:gold.filter(l=>l.source==='derived').length,
   fields:Object.fromEntries(FIELDS.map(f=>[f,gold.filter(l=>l[f]!==undefined).length]))},
  ...metrics(gold,P,o.categories,follow),
  bySource:{captain:metrics(only('captain'),P,o.categories,follow),derived:metrics(only('derived'),P,o.categories,follow)},
  withReads:{issues:RP.size,gold:gold.filter(l=>RP.has(l.n)).length,...metrics(gold.filter(l=>RP.has(l.n)),RP,o.categories,follow),human:{investigated:RP.size,routed:rHuman,share:rate(rHuman,RP.size)}},
  // counted on the latest answer per issue: an issue a later batch took again is counted once
  human:{investigated,routed:human,share:rate(human,investigated),agreed:[...P.values()].filter(p=>p.agree).length,packages:o.replayed.packages,noCode:[...P.values()].filter(p=>p.noCode).length,toHumanItems:o.replayed.toHuman},
  runs:{skipped:o.replayed.skipped,withoutReads:o.replayed.withoutReads}};
}
/** The gold set's own hash, so a score of a grown gold set never replaces an earlier one. */
export const goldHash=(g:GoldSet)=>{const e=effectiveGold(g);return createHash('sha256').update(JSON.stringify(Object.keys(e).sort((a,b)=>Number(a)-Number(b)).map(n=>{const{at:_a,from:_f,sources:_s,...l}=e[n] as any;return l;}))).digest('hex');};
/** A score's key: the skills that wrote the replayed reports, the code that judged them, and the gold it was scored on. */
export function scoreKey(o:{skills:string[];commit:string;rules:string;dirty:boolean;gold:string}){
 const skills=createHash('sha256').update([...new Set(o.skills)].sort().join('\n')).digest('hex');
 return{key:`${skills.slice(0,12)}-${o.commit.slice(0,12)}-g${o.gold.slice(0,8)}${o.dirty?`-${o.rules.slice(0,8)}`:''}`,skills};
}
