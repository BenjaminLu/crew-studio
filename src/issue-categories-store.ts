// A project's issue categories (src/domain/issue-categories.ts), one file per project under data/issue-categories/.
// Written by the issue-categories workflow and the captain's edits on the project page.
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {CategoryRecord} from './domain/issue-categories';

const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
export class IssueCategoriesStore{
 private dir:string;
 constructor(dataDir:string){this.dir=join(dataDir,'issue-categories');}
 private file(project:string){if(!ID.test(project)||project.includes('..'))throw new Error('Invalid project id');return join(this.dir,`${project}.json`);}
 get(project:string):CategoryRecord|null{const f=this.file(project);if(!existsSync(f))return null;return JSON.parse(readFileSync(f,'utf8'));}
 write(rec:CategoryRecord){const f=this.file(rec.project);if(rec.schema!==1)throw new Error('Unknown categories schema');mkdirSync(this.dir,{recursive:true});const tmp=f+'.tmp';writeFileSync(tmp,JSON.stringify(rec));renameSync(tmp,f);}
}
