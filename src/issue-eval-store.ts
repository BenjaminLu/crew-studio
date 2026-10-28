// A project's issue evaluation set (src/domain/issue-eval.ts) in Studio's data directory, next to its triage and
// categories, and never in the repository: data/issue-eval/<project>/gold.json (the gold set), labels-<time>.json (the
// templates to label) and scores/<key>.json (each score). It also reads, never writes, what the scorer replays: the
// stored triage batches under data/runs/<task>/ (issue-snapshot.json, issue-report-a.json, issue-report-b.json) and the
// categorizer's reports in those runs' run.json.
import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {realpathSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {git} from './git';
import {emptyGold,GOLD_SCHEMA,type GoldLabel,type GoldSet,type Replay} from './domain/issue-eval';
import type {Reads,WorkState} from './domain/issue-triage';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/,FILE_CAP=2_000_000;
const json=(f:string)=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return null;}};
const atomic=(f:string,v:unknown)=>{const tmp=`${f}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;writeFileSync(tmp,JSON.stringify(v,null,1),{mode:0o600});renameSync(tmp,f);};
type RunFile={id:string;workflow:string;status:string;params:Record<string,string>;createdAt:string;ctx?:any;nodes:Record<string,any>;steps?:any[]};
/** the sha256 of the role skill a step's latest agent turn received: the engine keeps it on the run's steps, not its nodes */
const skillOf=(r:RunFile,node:string):string|undefined=>{const s=[...(r.steps??[])].reverse().find(x=>x?.node===node&&typeof x?.roleSkill?.sha256==='string');return s?.roleSkill.sha256;};

const line=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=1;
/** recorded reads, or undefined when absent or malformed: {file: [[start, end], ...]}, 1-based, start <= end */
export function readsOf(v:unknown):Reads|undefined{
 if(!v||typeof v!=='object'||Array.isArray(v))return undefined;const out:Reads={};
 for(const[f,rs]of Object.entries(v as Record<string,unknown>)){if(!f||f.length>300||!Array.isArray(rs)||rs.length>10000)return undefined;
  for(const x of rs)if(!Array.isArray(x)||x.length!==2||!line(x[0])||!line(x[1])||x[0]>x[1])return undefined;
  out[f]=(rs as [number,number][]).map(([s,e])=>[s,e]);}
 return out;}

export class IssueEvalStore{
 constructor(readonly dataDir:string){}
 dir(project:string){if(!ID.test(project)||project.includes('..'))throw new Error('Invalid project id');return join(this.dataDir,'issue-eval',project);}
 gold(project:string):GoldSet|null{const g=json(join(this.dir(project),'gold.json'));if(g&&g.schema!==GOLD_SCHEMA)throw new Error(`Unknown gold set schema ${g.schema}`);return g;}
 writeGold(g:GoldSet){if(g.schema!==GOLD_SCHEMA)throw new Error('Unknown gold set schema');const d=this.dir(g.project);mkdirSync(d,{recursive:true,mode:0o700});atomic(join(d,'gold.json'),g);}
 /** The captain's own labels added to the gold set (a ruling of the triage's disagreement court, src/domain/issue-court.ts):
  *  its answer (state, files, package) replaces the earlier one whole, the category, planned and security answers given
  *  before kept; derived labels are left as they are. Adding the same labels again changes nothing, so a step run again
  *  may repeat it. */
 addCaptain(project:string,labels:Record<string,GoldLabel>,at:string){if(!Object.keys(labels).length)return;const g=this.gold(project)??emptyGold(project,at);
  for(const l of Object.values(labels))if(l.source!=='captain'||!Number.isSafeInteger(l.n)||l.n<1)throw new Error('A captain label names its issue and comes from the captain');
  // the answer (state, files, package) is replaced whole: a ruling of needs-info leaves no files or package from an earlier
  // one; only what the captain said about the issue otherwise (category, planned, security) is kept from before
  const captain={...g.captain};for(const[n,l]of Object.entries(labels)){const was=captain[n];
   captain[n]=was?{...(was.category!==undefined?{category:was.category}:{}),...(was.notPlanned?{notPlanned:was.notPlanned}:{}),...(was.security!==undefined?{security:was.security}:{}),...l,from:[...new Set([...(was.from??[]),...(l.from??[])])]}:l;}
  this.writeGold({...g,captain,updatedAt:at});}
 writeTemplate(project:string,t:unknown,stamp:string){const d=this.dir(project);mkdirSync(d,{recursive:true,mode:0o700});const f=join(d,`labels-${stamp.replace(/[^0-9TZ]/g,'')}.json`);atomic(f,t);return f;}
 writeScore(project:string,key:string,s:unknown){const d=join(this.dir(project),'scores');mkdirSync(d,{recursive:true,mode:0o700});const f=join(d,`${key.replace(/[^\w.-]/g,'')}.json`);atomic(f,s);return f;}
 scores(project:string){const d=join(this.dir(project),'scores');if(!existsSync(d))return[];return readdirSync(d).filter(f=>f.endsWith('.json')).map(f=>json(join(d,f))).filter(Boolean);}

 /** Every run of a workflow for the project, from its run.json (read only). */
 runs(workflow:string,project:string):RunFile[]{const root=join(this.dataDir,'runs');let ids:string[]=[];try{ids=readdirSync(root);}catch{return[];}
  return ids.flatMap(id=>{const r=json(join(root,id,'run.json'));return r&&r.workflow===workflow&&r.params?.project===project?[r as RunFile]:[];}).sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.id<b.id?-1:a.id>b.id?1:0);}
 /** The project's stored triage batches: each run that kept both reports and its snapshot. The reports are the files the
  *  investigators' steps wrote (else the step's own copy in run.json); the code is read by `read(commit)`. */
 triageBatches(project:string,read:(commit:string)=>(file:string)=>string|null):{batches:Replay[];missing:string[]}{
  const batches:Replay[]=[],missing:string[]=[];
  for(const r of this.runs('issue-triage',project)){const d=join(this.dataDir,'runs',r.id),snap=json(join(d,'issue-snapshot.json'));
   const a=json(join(d,'issue-report-a.json'))??r.nodes?.a?.data?.triageReport,b=json(join(d,'issue-report-b.json'))??r.nodes?.b?.data?.triageReport;
   if(!snap||!a||!b){if(snap)missing.push(r.id);continue;}
   const skills=['a','b'].map(n=>skillOf(r,n)).filter((s):s is string=>!!s);
   // what fs_read showed each investigator, where the run recorded it (rounds since Studio records reads); anything not
   // shaped as {file: [[start, end], ...]} is treated as no reads, so the batch is replayed without that check
   const seen=(n:string)=>readsOf(r.nodes?.[n]?.data?.triageReads);
   batches.push({run:r.id,at:r.createdAt,a,b,snapshot:snap,read:read(String(a.commit??'')),reads:{a:seen('a'),b:seen('b')},skills});}
  return{batches,missing};}
 /** The categorizer's stored reports for the project, and the skill each ran with. */
 categoryReports(project:string){return this.runs('issue-categories',project).flatMap(r=>{const c=r.nodes?.categorize?.data?.categoriesReport;
  return c?.report&&(c.mode==='build'||c.mode==='file')?[{run:r.id,at:r.createdAt,mode:c.mode as 'build'|'file',report:c.report,skill:skillOf(r,'categorize')}]:[];});}
 /** Where a package issue's Task stands, read as src/issue-triage-workflow.ts reads it: its proposal, then the Task the
  *  dispatch card launched (merged = that Task succeeded through its done step). */
 work(proposal:string):WorkState{const run=(id:string)=>ID.test(id)?json(join(this.dataDir,'runs',id,'run.json')):null,DONE=['succeeded','failed','cancelled'];
  const pr=run(proposal);if(!pr)return'closed';const child=typeof pr.ctx?.childRun==='string'?run(pr.ctx.childRun):null;
  if(!child)return DONE.includes(pr.status)?'closed':'open';
  if(child.status==='succeeded')return(child.nodes?.done?.visits??0)>0?'merged':'closed';
  return DONE.includes(child.status)?'closed':'open';}
}

/** A project's code at one commit, read from its repository without a checkout (`git cat-file`): regular files only, at
 *  most 2 MB, null for anything else. Nothing is written to the repository. */
export function commitReader(repo:string|null){const cache=new Map<string,string|null>(),have=new Map<string,boolean>(),missing=new Set<string>();
 return Object.assign((commit:string)=>{
  const ok=()=>{if(!have.has(commit))have.set(commit,!!repo&&/^[a-f0-9]{40}$/.test(commit)&&git(repo,['cat-file','-e',`${commit}^{commit}`]).ok);if(!have.get(commit))missing.add(commit);return have.get(commit)!;};
  return(file:string)=>{if(!ok())return null;const k=`${commit}:${file}`;if(cache.has(k))return cache.get(k)!;
   const t=git(repo!,['cat-file','-t',k]),r=t.ok&&t.out==='blob'?git(repo!,['cat-file','blob',k]):null;
   const v=r?.ok&&r.bytes.length<=FILE_CAP?new TextDecoder().decode(r.bytes):null;cache.set(k,v);return v;};},
 /** the commits the repository does not have: their code checks fail, and the score says so */
 {missing});
}

/** A path with its symbolic links resolved, as far as it exists (the rest appended), so a link cannot hide the checkout. */
export function realish(p:string):string{let at=resolve(p),rest:string[]=[];
 for(let i=0;i<200;i++){try{return join(realpathSync(at),...rest.reverse());}catch{const up=dirname(at);if(up===at)return resolve(p);rest.push(at.slice(up.length).replace(/^[\\/]+/,''));at=up;}}
 return resolve(p);}
/** Private data never enters the repository: why `p` may not hold it (null when it may). Outside the checkout is fine;
 *  inside it, only a path git ignores (Studio's own data/ is ignored). `ignored` gets the path relative to the checkout. */
export function privatePathProblem(root:string,p:string,ignored:(rel:string)=>boolean):string|null{
 const r=realish(root),f=realish(p),rel=relative(r,f);
 if(rel===''||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))){
  if(rel===''||rel.split(sep)[0]==='.git')return `${p} is the repository itself`;
  if(!ignored(rel))return `${p} is inside the repository and not ignored by git: use the data directory or a path outside the checkout`;}
 return null;}
