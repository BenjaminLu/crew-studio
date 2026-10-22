// Opt-in investigation only. Three runs do not replace normal/full CI evidence.
import {run,testEnv,commands} from './ci-tests.mjs';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const COMMAND='node tests/sidebar-workflow-create-ui.mjs',COUNT=3,TIMEOUT_MS=600000;
const sha256=path=>existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):null;
export async function diagnosePan({root=process.cwd(),output=resolve(root,'ci-results/diagnostic-078'),execute=run}={}){
  mkdirSync(output,{recursive:true});
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw new Error('Cannot record exact checkout');return r.stdout.trim();};
  const inventory=commands(JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).scripts,'full');
  const commandIndex=inventory.indexOf(COMMAND)+1;if(!commandIndex)throw new Error('Canonical sidebar command is absent from full inventory');
  const report={kind:'diagnostic-only-not-full-ci',head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),node:process.version,platform:process.platform,arch:process.arch,command:COMMAND,commandIndex,fullInventory:inventory.length,plannedRuns:COUNT,timeoutMs:TIMEOUT_MS,testSha256:sha256(resolve(root,'tests/sidebar-workflow-create-ui.mjs')),runnerSha256:sha256(fileURLToPath(import.meta.url)),results:[]};
  const save=()=>writeFileSync(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');save();
  for(let round=1;round<=COUNT;round++){
    const log=resolve(output,`run-${round}.log`);let result;
    try{result=await execute(COMMAND,log,TIMEOUT_MS,testEnv(process.env));}
    catch(error){result={command:COMMAND,code:null,signal:null,timedOut:false,error:String(error?.message||error),log};}
    const logSha256=sha256(log);report.results.push({round,...result,logSha256,logMissing:logSha256===null});save();
    console.log(`Diagnostic ${round}/${COUNT}: code=${result.code}, signal=${result.signal??'none'}, timedOut=${result.timedOut}`);
  }
  const failed=report.results.filter(r=>r.code!==0||r.signal||r.timedOut||r.logMissing);
  writeFileSync(resolve(output,'summary.md'),`# Sidebar pan diagnostics — not full CI\n\nHead: ${report.head}\n\n${COUNT} planned runs completed; ${failed.length} failed. Each command retains its original 600000 ms bound.\n\n`+report.results.map(r=>`- Run ${r.round}: exit ${r.code}, signal ${r.signal??'none'}, timeout ${r.timedOut}, duration ${r.durationMs??'unavailable'} ms, raw SHA256 ${r.logSha256??'missing'}`).join('\n')+'\n');
  return{report,exitCode:failed.length?1:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))diagnosePan().then(r=>{process.exitCode=r.exitCode;}).catch(error=>{console.error(error);process.exitCode=1;});
