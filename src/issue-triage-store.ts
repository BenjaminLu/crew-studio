// A project's latest issue triage (src/domain/issue-triage.ts), one file per project under data/issue-triage/.
// Written by the issue-triage workflow only; the Board reads it.
import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TriageRecord} from './domain/issue-triage';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
export class IssueTriageStore{
 private dir:string;
 constructor(dataDir:string){this.dir=join(dataDir,'issue-triage');}
 private file(project:string){if(!ID.test(project)||project.includes('..'))throw new Error('Invalid project id');return join(this.dir,`${project}.json`);}
 get(project:string):TriageRecord|null{const f=this.file(project);if(!existsSync(f))return null;return JSON.parse(readFileSync(f,'utf8'));}
 write(rec:TriageRecord){const f=this.file(rec.project);if(rec.schema!==1)throw new Error('Unknown triage schema');mkdirSync(this.dir,{recursive:true});const tmp=f+'.tmp';writeFileSync(tmp,JSON.stringify(rec));renameSync(tmp,f);}
 list(){if(!existsSync(this.dir))return[];return readdirSync(this.dir).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5)).filter(id=>ID.test(id)).sort().flatMap(id=>{try{const r=this.get(id)!;return[{project:id,repository:r.repository,open:r.open,investigated:r.investigated.length,packages:r.packages.length,createdAt:r.createdAt}];}catch{return[];}});}
}
