import {homedir} from 'node:os';
import {localUnrestricted} from './local-execution';
import {cpSync,readFileSync,existsSync,lstatSync,mkdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {must,gitArgv} from './git';
import {matches} from './doors';
import {normPath} from './review-read';
// One resolver for role tools: select files in known runners, never pretend an
// environment variable changes a package script that ignores it.
export function selectTestCommand(cfg:{test:string[]|null;testSource:string|null},files?:string[]):string[]|null {
 if(!cfg.test)return null;
 if(!files?.length)return cfg.test;
 const node=cfg.test[0].split('/').at(-1)==='node'&&cfg.test[1]==='--test';
 const direct=node&&cfg.test.slice(2).every(p=>/^[\w./-]+$/.test(p)&&!p.startsWith('-'));
 if(node&&!direct)throw new Error('This Node test runner cannot select files without losing options; configure a runner adapter. No tests ran.');
 const script=cfg.testSource?.startsWith('package.json')?cfg.test.at(-1):null;
 if(direct)return [cfg.test[0],'--test',...files];
 if(script&&/^node\s+--test(?:\s+[\w./-]+)*\s*$/.test(script))return ['node','--test',...files];
 if(script)throw new Error('This package test runner cannot select files yet; Firstmate must configure a runner adapter. No tests ran.');
 return cfg.test; // .crew/gates.json explicitly owns CREW_TEST_FILES support.
}

export function packageTestCommand(cfg:{test:string[]|null;testSource:string|null},cwd:string){
 if(!cfg.testSource?.startsWith('package.json')||!cfg.test)throw Error('npm-test requires the test script resolved from the base package.json');
 const pkg=JSON.parse(readFileSync(join(cwd,'package.json'),'utf8'));if(pkg?.scripts?.test!==cfg.test.at(-1))throw Error('package.json test script differs from the approved base command');
 return ['npm','--ignore-scripts','test']; // run the actual test lifecycle, deliberately skip pretest/posttest hooks.
}

/** Only operator-configured local browser capabilities, never credentials. */
export function testEnvironment():Record<string,string>{
 const env:Record<string,string>={};if(!localUnrestricted())return env;
 const root=process.env.CREW_LOCAL_DEPENDENCY_ROOT!,module=join(root,'node_modules','playwright');if(existsSync(join(module,'package.json')))env.PLAYWRIGHT_MODULE=module;
 const browsers=process.env.PLAYWRIGHT_BROWSERS_PATH??join(homedir(),process.platform==='darwin'?'Library/Caches/ms-playwright':'.cache/ms-playwright');if(existsSync(browsers))env.PLAYWRIGHT_BROWSERS_PATH=browsers;
 for(const [target,source] of [['PLAYWRIGHT_MODULE','CREW_PLAYWRIGHT_MODULE'],['PLAYWRIGHT_BROWSERS_PATH','CREW_PLAYWRIGHT_BROWSERS_PATH'],['PLAYWRIGHT_EXECUTABLE_PATH','CREW_PLAYWRIGHT_EXECUTABLE_PATH']])if(process.env[source])env[target]=process.env[source]!;
 return env;
}
/** Check scripts receive the same host-resolved adapter as role tools. */
export function testRunner(cfg:{test:string[]|null;testSource:string|null}){
 try{const c=selectTestCommand(cfg,['__crew_selected_test__.mjs']);return c?.[1]==='--test'&&c[2]==='__crew_selected_test__.mjs'?{node:c[0]}:{custom:true};}
 catch(e:any){return{error:e.message};}
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
