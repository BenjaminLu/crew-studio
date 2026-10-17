import {homedir} from 'node:os';
import {localUnrestricted} from './local-execution';
import {cpSync,readFileSync,existsSync,lstatSync,mkdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {must,gitArgv,gitEnv} from './git';
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

/** runner=npm-test: the base package.json scripts.test, unchanged on the tree it runs in, with pre/post hooks skipped.
 * Works whether the declared command came from .crew/gates.json or package.json; every refusal names the call to make. */
export function packageTestCommand(baseScript:string|null,cwd:string,target:string){
 const declared=`call run_tests({target:"${target}"}) without runner to use the declared command`;
 if(typeof baseScript!=='string'||!baseScript.trim())throw Error(`runner:"npm-test" needs scripts.test in the base package.json and this repository has none; ${declared}.`);
 let script:unknown;try{script=JSON.parse(readFileSync(join(cwd,'package.json'),'utf8'))?.scripts?.test;}catch{script=undefined;}
 if(script!==baseScript)throw Error(`runner:"npm-test" only runs the unchanged base package.json test script (${JSON.stringify(baseScript)}) but this tree has ${JSON.stringify(script??null)}; restore it, or ${declared}.`);
 return ['npm','--ignore-scripts','test']; // run the actual test lifecycle, deliberately skip pretest/posttest hooks.
}

/** Selection env for gates.json adapters: CREW_TEST_FILES carries basenames, the contract the fail-first and
 * covering-suites gates already use; CREW_TEST_PATHS carries the repo-relative paths for adapters that want them. */
export function selectionEnv(files?:string[]):Record<string,string>{
 if(!files?.length)return{};
 return{CREW_TEST_FILES:files.map(f=>f.split('/').at(-1)!).join(','),CREW_TEST_PATHS:files.join(',')};
}

/** A run whose output says it selected or ran no tests proves nothing, whatever its exit code. */
export function ranNoTests(output:string):boolean{
 return /\bno test files\b|did not match any test files|\bno tests? (?:found|ran|were run|to run)\b|^\s*Ran 0 tests\b|^\s*(?:#|ℹ) tests 0\s*$|^\s*0 tests?,? (?:passed|run)\b/im.test(output);
}

/** The tree a test ran on: the commit, plus whether the worktree has uncommitted changes and the tree hash of what is on disk. */
export function treeState(wt:string,scratch:string):{head:string;dirty:boolean;tree:string}{
 const head=must(wt,['rev-parse','HEAD']);
 if(!must(wt,['status','--porcelain=v1','--untracked-files=all']).trim())return{head,dirty:false,tree:must(wt,['rev-parse','HEAD^{tree}'])};
 mkdirSync(scratch,{recursive:true});const idx=join(scratch,'tree-state.index'),env=gitEnv({GIT_INDEX_FILE:idx});
 const run=(args:string[])=>{const r=Bun.spawnSync(gitArgv(args),{cwd:wt,stdout:'pipe',stderr:'pipe',env});if(!r.success)throw Error(`git ${args[0]}: ${r.stderr.toString().trim()}`);return r.stdout.toString().trim();};
 try{run(['read-tree',head]);run(['add','--all']);return{head,dirty:true,tree:run(['write-tree'])};}finally{rmSync(idx,{force:true});} // a private index: the worktree's own index is untouched
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
