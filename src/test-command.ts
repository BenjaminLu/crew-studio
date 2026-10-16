import {cpSync,existsSync,lstatSync,mkdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {must,gitArgv} from './git';
import {matches} from './doors';
import {normPath} from './review-read';
// One resolver for role tools: select files in known runners, never pretend an
// environment variable changes a package script that ignores it.
export function selectTestCommand(cfg:{test:string[]|null;testSource:string|null},files?:string[]):string[]|null {
 if(!cfg.test)return null;
 if(!files?.length)return cfg.test;
 const direct=cfg.test[0].split('/').at(-1)==='node'&&cfg.test[1]==='--test';
 const script=cfg.testSource?.startsWith('package.json')?cfg.test.at(-1):null;
 if(direct)return [cfg.test[0],'--test',...files];
 if(script&&/^node\s+--test(?:\s+[\w./-]+)*\s*$/.test(script))return ['node','--test',...files];
 if(script)throw new Error('This package test runner cannot select files yet; Firstmate must configure a runner adapter. No tests ran.');
 return cfg.test; // .crew/gates.json explicitly owns CREW_TEST_FILES support.
}

/** Keep candidate tests, restore base source/config bytes; never checkout/reset the real worktree. */
export function prepareTestBase(wt:string,dest:string,base:string,globs:string[]){
 cpSync(wt,dest,{recursive:true,filter:p=>{if(p===join(wt,'.git')||p===join(wt,'node_modules'))return false;if(lstatSync(p).isSymbolicLink())throw Error('base test copy refuses repository symlinks');return true;}});
 const baseFiles=must(wt,['ls-tree','-r','--name-only',base]).split('\n').filter(Boolean);
 const currentFiles=must(wt,['ls-files','--cached','--others','--exclude-standard']).split('\n').filter(Boolean);
 for(const p of new Set([...baseFiles,...currentFiles])){
  if(!normPath(p)||globs.some(g=>matches(g,p)))continue;
  const file=join(dest,p);if(existsSync(file))rmSync(file,{recursive:true,force:true});
  if(baseFiles.includes(p)){const raw=Bun.spawnSync(gitArgv(['show',`${base}:${p}`]),{cwd:wt,stdout:'pipe',stderr:'pipe'});if(!raw.success)throw Error(`cannot read base file ${p}`);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,raw.stdout);}
 }
 if(existsSync(join(wt,'node_modules')))symlinkSync(join(wt,'node_modules'),join(dest,'node_modules'),'dir');
 return dest;
}
