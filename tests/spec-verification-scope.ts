import "./lib/isolated-env.mjs";
// Spec input retains read-only impact without granting write authority.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {harness} from './rt-harness';
import {Projects} from '../src/doors';
import {installCode,specMd} from '../src/domain/code';
const h=await harness([]);
try {
 installCode(h.engine,{dataDir:h.data,projects:new Projects(h.data)});
 const dir=join(h.data,'spec-input');mkdirSync(dir,{recursive:true});
 const ctx:any={worktree:dir};
 const x:any={ctx,dir,run:{id:'R-fixture',title:'fixture'},save(){}};
 const tool=(await h.engine.modes.spec.tools!(x)).find(t=>t.name==='spec_write')!;
 const input={title:'Read-only impact',what:'Keep caller verification separate from write permissions',why:['Avoid scope inflation'],done:['tests/spec-verification-scope.ts observes persistence'],scope:['src/changed.ts'],verificationScope:['src/caller.ts'],door:{kind:'two-way',reason:'test'},explain:{en:'Read callers without write authority','zh-TW':'唯讀檢查引用者，不擴張寫入權'},zh:{title:'唯讀影響',why:['避免範圍膨脹']}};
 await tool.run(input);
 assert.deepEqual(ctx.spec.scope,['src/changed.ts']);assert.deepEqual(ctx.spec.verificationScope,['src/caller.ts']);
 assert.deepEqual(JSON.parse(readFileSync(join(dir,'spec.json'),'utf8')).verificationScope,['src/caller.ts']);
 assert.match(specMd(ctx.spec),/Read\/verification only \(no write authority\): src\/caller.ts/);
 // Losing a head-bound brief must not erase the editable draft during rescope.
 const promptX:any={...x,visit:2,run:{...x.run,def:{nodes:[]}},node:{id:'spec'},log(){}};
 const prompt=await h.engine.modes.spec.prompt!(promptX);
 assert.match(prompt,/src\/changed.ts/);
 assert.match(prompt,/src\/caller.ts/);
 assert.match(prompt,/not approval or current-head verification evidence/);
 const native=h.engine.natives.overlap;
 const mine={artifact:{data:{scope:['src/changed.ts']}}};
 assert.equal((await native({...mine,inflight:[]},{} as any)).verdict,'pass');
 assert.equal((await native({...mine,inflight:[{run:'R-active',title:'active',scope:['src/changed.ts']}]},{} as any)).verdict,'fail');
 assert.equal((await native({...mine,inflight:[{run:'R-unknown',title:'unknown',scope:[],identityUnavailable:true}]},{} as any)).verdict,'fail');
 assert.equal((await native({...mine,inflight:[{run:'R-prefix',title:'prefix',scope:['other.ts'],identityUnavailable:true}]},{} as any)).verdict,'pass');
 // Failed attempts advance visits independently from successful spec versions.
 const retryX:any={...x,visit:8,rn:{},ctx:{...ctx,spec:{...ctx.spec,version:5}}};
 const mode=h.engine.modes.spec;
 let retryTool=(await mode.tools!(retryX)).find(t=>t.name==='spec_write')!;
 await retryTool.run(input);
 assert.equal(retryX.ctx.spec.version,6);
 assert.equal(await mode.after!(retryX,{} as any),'ok','submitted spec succeeds after failed visits');
 // A previous success (even a version greater than visit) is not this attempt's submission.
 retryX.ctx.spec.version=100;
 retryTool=(await mode.tools!(retryX)).find(t=>t.name==='spec_write')!;
 assert.throws(()=>mode.after!(retryX,{} as any),/did not call spec_write/);
 await retryTool.run(input);
 assert.equal(await mode.after!(retryX,{} as any),'ok');
 const otherX:any={...retryX,ctx:{...retryX.ctx}};
 await mode.tools!(otherX);
 assert.throws(()=>mode.after!(otherX,{} as any),/did not call spec_write/);
 const {verificationScope,...legacy}=input;await tool.run(legacy);assert.equal(Object.hasOwn(ctx.spec,'verificationScope'),false);
 console.log('PASS spec tool persists verification-only files without write scope, legacy compatibility, overlap identity handling');
} finally {h.stop();}
