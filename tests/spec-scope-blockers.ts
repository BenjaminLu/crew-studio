import "./lib/isolated-env.mjs";
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs";
// Signed, isolated reservation fixtures; no production runtime state is touched.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger,hashInput,INPUT_HASH_ALGORITHM} from '../src/runtime/checks';
import {scopeBlockers,installCodeQueue} from '../src/domain/code-queue';
import {must,setGitHome} from '../src/git';
const data=checkedTempDir('crew-spec-blockers-');
setGitHome(data);
const repo=join(data,'repo');mkdirSync(repo);assertTempRepo(repo);must(repo,['init','-q']);writeFileSync(join(repo,'file.txt'),'base\n');must(repo,['add','file.txt']);must(repo,['commit','-qm','base']);const head=must(repo,['rev-parse','HEAD']);
let runs:any[]=[];
const engine:any={
 list:()=>runs,queueRepo:(p:string)=>{try{return realpathSync(p);}catch{return '';}},queueProject:(r:any)=>r.ctx.project,
 trusted:(id:string)=>{const s=new Ledger(data,id).authenticatedPrefix();return {...s,bad:new Set(s.bad),ok:!s.bad.length&&!s.malformed,truncated:false};},
 verifiedMerge:(r:any)=>engine.queueDomain.merged(r),
};installCodeQueue(engine);
const target:any={id:'R-1',ctx:{repo,project:'test'}};
let serial=1;
const run=()=>{const r:any={id:`R-${++serial}`,title:'Independent demand',status:'waiting',ctx:{repo,project:'test',worktree:repo,baseCommit:head,head,spec:{scope:['file.txt']}}};runs=[target,r];return r;};
const add=(r:any,record:string,d:any,h=head)=>new Ledger(data,r.id).add({run:r.id,kind:'record',record,verdict:'pass',head:h,data:d} as any);
const pin=(scope=['file.txt'])=>({version:2,hashAlgorithm:INPUT_HASH_ALGORITHM,repo:realpathSync(repo),project:'test',specHash:hashInput({scope}),scope,dependencies:[]});
const blocked=()=>scopeBlockers(engine,target);
try {
 let r=run();const missing=join(data,'removed-worktree');
 r.ctx.worktree=missing;r.status='cancelled';assert.deepEqual(blocked(),[],'normal cancelled never-admitted cleanup does not block');
 r.status='waiting';assert.equal(blocked()[0].identityUnavailable,true,'missing live never-admitted worktree fails closed');
 r.status='cancelled';add(r,'scope-admission',pin());assert.equal(blocked().length,1,'terminal cleanup never releases signed reservation');
 r=run();assert.deepEqual(blocked(),[],'pristine spec-only peer has no reservation');
 runs=[r,target];target.ctx={...r.ctx};assert.deepEqual(scopeBlockers(engine,r),[],'pristine peer relation is symmetric');runs=[target,r];
 writeFileSync(join(repo,'untracked.txt'),'unexpected');assert.equal(blocked()[0].identityUnavailable,true,'unadmitted dirty worktree fails closed');rmSync(join(repo,'untracked.txt'));
 const reservation=pin();add(r,'scope-admission',reservation);assert.deepEqual(blocked()[0].scope,['file.txt'],'signed active reservation blocks');
 r.status='cancelled';assert.equal(blocked().length,1,'cancelled unmerged reservation is retained');r.status='failed';assert.equal(blocked().length,1,'failed unmerged reservation is retained');
 r.status='succeeded';r.result='done';assert.equal(blocked().length,1,'success cache alone cannot release');
 add(r,'native-merge',{version:1,repo:realpathSync(repo),project:'test',head,base:must(repo,['branch','--show-current'])});assert.deepEqual(blocked(),[],'verified signed merge releases');
 r=run();r.ctx.nativeAdmission=pin();assert.equal(blocked()[0].identityUnavailable,true,'cache-only admission is not authority');
 r=run();add(r,'unrelated',{});appendFileSync(new Ledger(data,r.id).file(),'{bad tail\n');assert.equal(blocked()[0].identityUnavailable,true,'untrusted history without reservation anchor fails closed');assert.deepEqual(blocked()[0].scope,[]);
 r=run();const p=pin();const prior=add(r,'scope-admission',p);
 const request={version:1,card:'SC-fixture',visit:1,repo:realpathSync(repo),project:'test',prior:prior.seq,priorHash:hashInput(p),from:head,target:head};
 const requested=add(r,'local-rescope-request',request);
 add(r,'card-answer',{card:request.card,choice:'rescope',localRescope:{version:1,card:request.card,visit:1,base:undefined,from:head,target:head}});
 const applied=add(r,'local-rescope-applied',{request:requested.seq,intentHash:hashInput(request)});
 const expanded=pin(['extra.txt']);
 const dispatch=add(r,'card-answer',{kind:'dispatch',choice:'dispatch',queueHashAlgorithm:INPUT_HASH_ALGORITHM,queueSpec:expanded.specHash,repo:expanded.repo,project:expanded.project,scope:expanded.scope,dependencies:[]});
 add(r,'scope-admission',{...expanded,version:3,predecessor:prior.seq,recovery:applied.seq,dispatch:dispatch.seq,heldScope:['file.txt','extra.txt']});
 assert.deepEqual(blocked()[0].scope,['file.txt','extra.txt'],'valid rescope epoch retains original held scope');
 appendFileSync(new Ledger(data,r.id).file(),'{bad tail\n');
 assert.equal(blocked()[0].identityUnavailable,true);assert.deepEqual(blocked()[0].scope,['file.txt','extra.txt'],'corrupt tail preserves authenticated prefix union');
 r.ctx.repo='/forged/repo';r.ctx.project='forged';assert.deepEqual(blocked()[0].scope,['file.txt','extra.txt'],'mutable identity cannot hide trusted reservation');
 // A legitimate different project does not block this project.
 r=run();add(r,'scope-admission',{...pin(),project:'elsewhere'});assert.deepEqual(blocked(),[]);
 console.log('PASS spec-only coexistence, dirty hold, active/terminal scope, signed merge, cache rejection, corrupt-prefix union and identity isolation');
} finally {rmSync(data,{recursive:true,force:true});}
