// A project's issue evaluation set (src/domain/issue-eval.ts) in Studio's data directory, next to its triage and
// categories, and never in the repository: data/issue-eval/<project>/gold.json (the gold set), labels-<time>.json (the
// templates to label) and scores/<key>.json (each score). It also reads, never writes, what the scorer replays: the
// stored triage batches under data/runs/<task>/ (issue-snapshot.json, issue-report-a.json, issue-report-b.json) and the
// categorizer's reports in those runs' run.json.
import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {git} from './git';
import {GOLD_SCHEMA,type GoldSet,type Replay} from './domain/issue-eval';
import type {WorkState} from './domain/issue-triage';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/,FILE_CAP=2_000_000;
const json=(f:string)=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return null;}};
const atomic=(f:string,v:unknown)=>{const tmp=f+'.tmp';writeFileSync(tmp,JSON.stringify(v,null,1),{mode:0o600});renameSync(tmp,f);};
type RunFile={id:string;workflow:string;status:string;params:Record<string,string>;createdAt:string;ctx?:any;nodes:Record<string,any>;steps?:any[]};
/** the sha256 of the role skill a step's latest agent turn received: the engine keeps it on the run's steps, not its nodes */
const skillOf=(r:RunFile,node:string):string|undefined=>{const s=[...(r.steps??[])].reverse().find(x=>x?.node===node&&typeof x?.roleSkill?.sha256==='string');return s?.roleSkill.sha256;};

export class IssueEvalStore{
 constructor(readonly dataDir:string){}
 dir(project:string){if(!ID.test(project)||project.includes('..'))throw new Error('Invalid project id');return join(this.dataDir,'issue-eval',project);}
 gold(project:string):GoldSet|null{const g=json(join(this.dir(project),'gold.json'));if(g&&g.schema!==GOLD_SCHEMA)throw new Error(`Unknown gold set schema ${g.schema}`);return g;}
 writeGold(g:GoldSet){if(g.schema!==GOLD_SCHEMA)throw new Error('Unknown gold set schema');const d=this.dir(g.project);mkdirSync(d,{recursive:true});atomic(join(d,'gold.json'),g);}
 writeTemplate(project:string,t:unknown,stamp:string){const d=this.dir(project);mkdirSync(d,{recursive:true});const f=join(d,`labels-${stamp.replace(/[^0-9TZ]/g,'')}.json`);atomic(f,t);return f;}
 writeScore(project:string,key:string,s:unknown){const d=join(this.dir(project),'scores');mkdirSync(d,{recursive:true});const f=join(d,`${key.replace(/[^\w.-]/g,'')}.json`);atomic(f,s);return f;}
 scores(project:string){const d=join(this.dir(project),'scores');if(!existsSync(d))return[];return readdirSync(d).filter(f=>f.endsWith('.json')).map(f=>json(join(d,f))).filter(Boolean);}

 /** Every run of a workflow for the project, from its run.json (read only). */
 runs(workflow:string,project:string):RunFile[]{const root=join(this.dataDir,'runs');let ids:string[]=[];try{ids=readdirSync(root);}catch{return[];}
  return ids.flatMap(id=>{const r=json(join(root,id,'run.json'));return r&&r.workflow===workflow&&r.params?.project===project?[r as RunFile]:[];}).sort((a,b)=>a.createdAt<b.createdAt?-1:1);}
 /** The project's stored triage batches: each run that kept both reports and its snapshot. The reports are the files the
  *  investigators' steps wrote (else the step's own copy in run.json); the code is read by `read(commit)`. */
 triageBatches(project:string,read:(commit:string)=>(file:string)=>string|null):{batches:Replay[];missing:string[]}{
  const batches:Replay[]=[],missing:string[]=[];
  for(const r of this.runs('issue-triage',project)){const d=join(this.dataDir,'runs',r.id),snap=json(join(d,'issue-snapshot.json'));
   const a=json(join(d,'issue-report-a.json'))??r.nodes?.a?.data?.triageReport,b=json(join(d,'issue-report-b.json'))??r.nodes?.b?.data?.triageReport;
   if(!snap||!a||!b){if(snap)missing.push(r.id);continue;}
   const skills=['a','b'].map(n=>skillOf(r,n)).filter((s):s is string=>!!s);
   batches.push({run:r.id,at:r.createdAt,a,b,snapshot:snap,read:read(String(a.commit??'')),skills});}
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
