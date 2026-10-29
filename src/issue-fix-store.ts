// The captain's Fix clicks on a project's issues (docs/units/board.md, "Fixing issues"), one file per project under
// data/issue-fix/. Each issue keeps its latest clicks: who pressed Fix and when, the hidden one-issue triage it started (or
// none, when the issue already had an approved package and its Task was proposed again), the proposal that became its
// Task, and why the last attempt stopped. Written by Studio only; the project page reads it through the triage route.
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/,KEEP=10;
/** one Fix click on one issue */
export type FixEntry={by:string;at:string;
 /** the hidden one-issue triage it started (R-n); none when its approved package's Task was proposed again */
 run?:string;
 /** the proposal its Task came from, and the dispatch card Studio answered on the strength of the click */
 proposal?:string;card?:string;
 /** why this attempt stopped before its Task started (the proposal was refused, the dispatch card did not come up) */
 error?:string};
export type FixRecord={schema:1;project:string;issues:Record<string,FixEntry[]>};
export class IssueFixStore{
 private dir:string;
 constructor(dataDir:string){this.dir=join(dataDir,'issue-fix');}
 private file(project:string){if(!ID.test(project)||project.includes('..'))throw new Error('Invalid project id');return join(this.dir,`${project}.json`);}
 get(project:string):FixRecord{const f=this.file(project);if(!existsSync(f))return{schema:1,project,issues:{}};const r=JSON.parse(readFileSync(f,'utf8'));if(r?.schema!==1)throw new Error('Unknown issue-fix schema');return r;}
 private write(rec:FixRecord){const f=this.file(rec.project);mkdirSync(this.dir,{recursive:true});const tmp=`${f}.${process.pid}.tmp`;writeFileSync(tmp,JSON.stringify(rec));renameSync(tmp,f);}
 /** the latest click on an issue, or none */
 latest(project:string,n:number):FixEntry|null{return this.get(project).issues[String(n)]?.at(-1)??null;}
 /** a new click on an issue: kept after the earlier ones (the last KEEP) */
 add(project:string,n:number,e:FixEntry){const rec=this.get(project),k=String(n);rec.issues[k]=[...(rec.issues[k]??[]),e].slice(-KEEP);this.write(rec);}
 /** what became of the latest click on an issue (its proposal, card or error) */
 note(project:string,n:number,at:string,patch:Partial<FixEntry>){const rec=this.get(project),list=rec.issues[String(n)]??[],e=list.findLast(x=>x.at===at);if(!e)return;Object.assign(e,patch);this.write(rec);}
}
