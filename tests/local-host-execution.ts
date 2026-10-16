import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {codexHost} from '../src/host/codex';
const dir=mkdtempSync(join(tmpdir(),'local-host-')),saved={...process.env};
try{
 process.env.CREW_LOCAL_UNRESTRICTED='1';process.env.CREW_LOCAL_DEPENDENCY_ROOT=process.cwd();
 for(const mode of ['fresh','resume','fork']){
  const log=join(dir,mode+'.jsonl');
  const session=await codexHost(new URL('./stub-host-codex.mjs',import.meta.url).pathname).attach('th-stub-1',{cwd:dir,fresh:mode==='fresh',fork:mode==='fork',env:{STUB_CODEX_LOG:log},onEvent(){},onPermission:async()=>false});
  try{assert.equal((await session.send('hello')).status,'completed');}finally{await session.detach();}
  const rows=readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  const requests=rows.filter(r=>r.dir==='in').map(r=>r.msg);
  const opening=requests.find(r=>r.method===`thread/${mode==='fresh'?'start':mode}`);
  assert.equal(opening?.params.sandbox,'danger-full-access',mode);
  const turn=requests.find(r=>r.method==='turn/start');assert.deepEqual(turn.params.sandboxPolicy,{type:'dangerFullAccess'});assert.match(turn.params.input[0].text,/never globally/);
  assert(!rows.some(r=>r.dir==='problem'),JSON.stringify(rows.filter(r=>r.dir==='problem')));
 }
 console.log('PASS local host: fresh/resume/fork explicit sandbox, every-turn dependency notice, protocol compatibility');
}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);rmSync(dir,{recursive:true,force:true});}
