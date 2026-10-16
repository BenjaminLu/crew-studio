import {NativeOutcomes} from '../src/host/native-outcomes';
import {mkdtempSync,rmSync,readdirSync,writeFileSync,readFileSync,symlinkSync,unlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'outcome-contract-'));
const origin={host:'codex',thread:'original-thread',turn:'captain-turn'};
const source=createHash('sha256').update(JSON.stringify({schema:1,source:'original-thread:captain-turn'})).digest('hex');
const proposal:any={id:'R-001',workflow:'firstmate-proposal',params:{source,definition:'definition-hash'}};
const child:any={id:'R-002',workflow:'coffee-kit',version:1,def:{kind:'coffee-kit'},params:{_firstmateProposal:'R-001',_firstmateDefinition:'definition-hash'},status:'succeeded',result:'approved',endedAt:'2026-10-16T10:00:00Z'};
const card:any={id:'SC-001',run:'R-001',node:'dispatch',captainOnly:true,status:'answered',answer:{choice:'approve'}};
const entries:any[]=[{record:'card-answer',data:{card:'SC-001',choice:'approve'}},{record:'native-dispatch',data:{schema:1,proposal:'R-001',card:'SC-001',child:'R-002',workflow:'coffee-kit',version:1,definition:'definition-hash'}}];
let trusted=true,complete=true;
const engine:any={get:(id:string)=>id===proposal.id?proposal:id===child.id?child:null,trusted:()=>({ok:trusted,entries}),cards:{get:()=>card}};
const make=()=>new NativeOutcomes(dir,()=>engine,()=>({complete,artifact:'coffee-r-002-site',version:1}));
try{
 let store=make();assert.equal(store.list(origin.host,origin.thread).length,0,'historical unbound task absent');
 store.bind(origin,{proposal:proposal.id});store.bind(origin,{proposal:proposal.id});
 let receipts=store.list(origin.host,origin.thread);assert.equal(receipts.length,1);assert.equal(receipts[0].links.length,2);assert.match(receipts[0].text,/已完成/);
 assert.deepEqual(store.list(origin.host,origin.thread),receipts,'repeat projection exactly once');store=make();assert.deepEqual(store.list(origin.host,origin.thread),receipts,'restart preserves receipt');
 assert.equal(store.list('claude',origin.thread).length,0);assert.equal(store.list(origin.host,'new-session').length,0);assert.equal(store.list(null,null).length,0);
 assert.throws(()=>store.bind({...origin,turn:'wrong-turn'},{proposal:proposal.id}));
 for(const mutate of [()=>{trusted=false;return()=>trusted=true},()=>{child.params._firstmateProposal='forged';return()=>child.params._firstmateProposal='R-001'},()=>{child.params._firstmateDefinition='other';return()=>child.params._firstmateDefinition='definition-hash'},()=>{card.answer.choice='close';return()=>card.answer.choice='approve'},()=>{const item=entries.pop();return()=>entries.push(item)},()=>{child.version=2;return()=>child.version=1}]){const restore=mutate();assert.equal(store.list(origin.host,origin.thread).length,0,'invalid authority cannot replay persisted receipt');restore();}
 complete=false;assert.equal(store.list(origin.host,origin.thread)[0].links.length,1,'revoked/unverified artifact no success link');assert.match(store.list(origin.host,origin.thread)[0].text,/未確認/);
 for(const [status,text]of [['failed','失敗'],['cancelled','取消']]){rmSync(join(dir,'native-outcomes','R-001-R-002.receipt.json'));child.status=status;const r=store.list(origin.host,origin.thread)[0];assert.ok(r.text.includes(text));assert.equal(r.links.length,1);}
 child.status='running';assert.equal(store.list(origin.host,origin.thread).length,0,'nonterminal never reported complete');
 assert.equal(readdirSync(join(dir,'native-outcomes')).filter(f=>f.endsWith('.receipt.json')).length,1,'one durable receipt');
 const bindingFile=join(dir,'native-outcomes','R-001.json'),savedBinding=readFileSync(bindingFile,'utf8');child.status='cancelled';
 for(const contents of ['x'.repeat(32769),JSON.stringify({...JSON.parse(savedBinding),proposal:'R-009'}),JSON.stringify({...JSON.parse(savedBinding),host:'other'}),JSON.stringify({...JSON.parse(savedBinding),extra:'not allowed'})]){writeFileSync(bindingFile,contents);assert.equal(store.list(origin.host,origin.thread).length,0);}
 writeFileSync(bindingFile,savedBinding);const external=join(dir,'external.json');writeFileSync(external,savedBinding);unlinkSync(bindingFile);symlinkSync(external,bindingFile);assert.equal(store.list(origin.host,origin.thread).length,0,'binding symlink refused');unlinkSync(bindingFile);writeFileSync(bindingFile,savedBinding);
 const receiptFile=join(dir,'native-outcomes','R-001-R-002.receipt.json');unlinkSync(receiptFile);symlinkSync(external,receiptFile);assert.equal(store.list(origin.host,origin.thread).length,0,'receipt symlink refused');unlinkSync(receiptFile);
 // Exercise the real Main native capability boundary, without a process/socket.
 const {MainSession}=await import('../src/host/main');let bindings=0;let toolName='';
 const main:any=new MainSession({dataDir:dir,projectDir:dir,stateDir:dir,nativeWorkspace:true,hosts:{} as any,permissionMcp:()=>({command:[],env:{}}),nativeTools:()=>({specs:[],async call(name,_args,owner){toolName=name;assert.equal(owner.key,'original-thread:captain-turn');return{proposal:name==='studio_propose_work'?'R-001':'R-999'};}}),onNativeProposal:(o,result)=>{bindings++;store.bind(o,result);}});
 main.state='attached';main.session={id:origin.thread,host:origin.host};main.activeInput={kind:'chat',source:'desktop',text:'Please propose coffee'};
 const cap=main.nativeCapability(),identity={thread:origin.thread,turn:origin.turn,call:'call-1',live:()=>true};
 assert.equal((await cap.call('studio_propose_staffing',{},identity)).proposal,'R-999');assert.equal(bindings,0,'staffing proposal never enters outcome binding');
 await cap.call('studio_propose_work',{},identity);assert.equal(bindings,1);assert.equal(toolName,'studio_propose_work');assert.equal(store.list(origin.host,origin.thread).length,1,'Main-bound work projects to exact source');
 main.activeInput={kind:'card',source:'studio',text:'notice'};await cap.call('studio_propose_work',{},identity);assert.equal(bindings,1,'system notice does not bind captain result');
 main.state='detached';await assert.rejects(()=>cap.call('studio_propose_work',{},identity));assert.equal(bindings,1,'ended owner cannot bind');
 console.log('PASS Main staffing/work boundary, bounded nofollow storage; source binding, dispatch authority, replay/restart, wrong session, missing history, terminal distinctions and artifact revalidation');
}finally{rmSync(dir,{recursive:true,force:true})}
