import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The synthetic account must accept only the production protocol additions.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const home=mkdtempSync(join(tmpdir(),'account-sandbox-'));
try {
 writeFileSync(join(home,'.fixture-account.json'),JSON.stringify({authenticated:true}));
 const run=(argv:string[],params:any,method='thread/start')=>{
  const r=Bun.spawnSync([process.execPath,new URL('./fixture/codex-account.mjs',import.meta.url).pathname,...argv],{env:{PATH:process.env.PATH!,CODEX_HOME:home},stdin:Buffer.from(JSON.stringify({id:1,method,params})+'\n'),stdout:'pipe',stderr:'pipe'});
  return {code:r.exitCode,rows:r.stdout.toString().trim().split('\n').filter(Boolean).map(l=>JSON.parse(l))};
 };
 for(const argv of [['app-server'],['app-server','-c','sandbox_mode="danger-full-access"']]) {
  assert.equal(run(argv,{cwd:home,sandbox:'danger-full-access'}).rows[0].result.sandbox.type,'dangerFullAccess');
  assert.equal(run(argv,{cwd:home}).rows[0].result.sandbox.type,'workspaceWrite');
  for(const params of [{cwd:home,sandbox:'other'},{cwd:home,unexpected:true},{cwd:home,sandbox:'danger-full-access',unexpected:true}])assert.equal(run(argv,params).rows[0].error.code,-32602);
  for(const params of [{threadId:'fixture',input:[],sandboxPolicy:{type:'unknown'}},{threadId:'fixture',input:[],sandboxPolicy:{type:'dangerFullAccess',extra:true}},{threadId:'fixture',input:[],extra:true}])assert.equal(run(argv,params,'turn/start').rows[0].error.code,-32602);
  assert(run(argv,{threadId:'fixture',input:[],sandboxPolicy:{type:'dangerFullAccess'}},'turn/start').rows[0].result);
 }
 assert.equal(run(['app-server','-c','sandbox_mode="read-write-anything"'],{cwd:home}).code,2);
 assert.equal(run(['app-server','--unexpected'],{cwd:home}).code,2);
 console.log('PASS strict account fixture: exact sandbox additions, default preserved, unknown argv/keys/policies rejected');
} finally {rmSync(home,{recursive:true,force:true});}
