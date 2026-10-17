import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {execFileSync} from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';
import {HyperframesFailure} from '../src/render/hyperframes';
import {CodexImageFailure} from '../src/providers/codex-image';
import { coffeeManifest, verifyCoffeeManifest, reviseCoffeeGenerations, installCoffeeKit } from '../src/domain/coffee-kit';
const fixtureDesignPlan=JSON.parse(readFileSync(join(import.meta.dir,'fixture/coffee-design.json'),'utf8'));
const fixturePoster=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=16x16','-frames:v','1','-vcodec','png','-f','image2pipe','pipe:1'],{timeout:10000});
const fixtureFilm=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=160x90:r=1:d=12','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{timeout:10000});

const dir = mkdtempSync(join(tmpdir(), 'coffee-bundle-integrity-'));
let passed = 0;
const check = (name: string, test: () => void) => { test(); passed++; console.log(`PASS ${name}`); };
try {
  writeFileSync(join(dir, 'index.html'), '<img src="coffee.png"><video src="coffee.mp4"></video>');
  writeFileSync(join(dir, 'coffee.png'), 'planted-image-fixture');
  writeFileSync(join(dir, 'coffee.mp4'), 'planted-video-fixture-not-playback-proof');
  const pin = coffeeManifest(dir);
  check('complete original bundle remains valid', () => assert(verifyCoffeeManifest(dir, pin)));
  writeFileSync(join(dir, 'coffee.png'), 'changed-image-fixture');
  check('image changes rejected while index remains identical', () => assert(!verifyCoffeeManifest(dir, pin)));
  writeFileSync(join(dir, 'coffee.png'), 'planted-image-fixture');
  writeFileSync(join(dir, 'coffee.mp4'), 'changed-video-fixture');
  check('video changes rejected while index remains identical', () => assert(!verifyCoffeeManifest(dir, pin)));
  writeFileSync(join(dir, 'coffee.mp4'), 'planted-video-fixture-not-playback-proof');
  writeFileSync(join(dir, 'extra.js'), 'unapproved');
  check('unrecorded files cannot enter approved bundle', () => assert(!verifyCoffeeManifest(dir, pin)));
  rmSync(join(dir, 'extra.js')); symlinkSync(join(dir, 'index.html'), join(dir, 'extra.html'));
  check('links rejected even when pointing inside bundle', () => assert(!verifyCoffeeManifest(dir, pin)));
  const old = {page:1,image:1,video:1,site:1};
  check('image revision invalidates film and site without changing page generation', () => assert.deepEqual(reviseCoffeeGenerations(old,'image'), {page:1,image:2,video:2,site:2}));
  check('video revision preserves image and page', () => assert.deepEqual(reviseCoffeeGenerations(old,'video'), {page:1,image:1,video:2,site:2}));
  check('direction revision invalidates every dependent output', () => assert.deepEqual(reviseCoffeeGenerations(old,'direction'), {page:2,image:2,video:2,site:2}));
  check('prior generation snapshot remains unchanged', () => assert.deepEqual(old, {page:1,image:1,video:1,site:1}));
  check('unknown historical generation cannot silently upgrade', () => assert.throws(() => reviseCoffeeGenerations({...old,image:NaN},'image')));
  const { harness, until } = await import('./rt-harness');
  const { ArtifactStore } = await import('../src/artifacts');
  const definition = JSON.stringify({id:'coffee-direction-fixture',name:'Coffee direction fixture',version:1,nodes:[{id:'direction',kind:'card',label:'Direction',args:{mode:'coffee-direction'}},{id:'done',kind:'hook',label:'Done',do:'set',args:{key:'finished',value:true}}],edges:[['direction','done','confirmed']]});
  const pageDefinition = JSON.stringify({id:'coffee-page-fixture',name:'Coffee page fixture',version:1,roles:[{id:'designer',label:'Designer',skill:'fixture'}],nodes:[{id:'direction',kind:'card',label:'Direction',args:{mode:'coffee-direction'}},{id:'page',kind:'agent',label:'Draft page',role:'designer',mode:'coffee-page'},{id:'done',kind:'hook',label:'Done',do:'set',args:{key:'finished',value:true}}],edges:[['direction','page','confirmed'],['page','done','ok']]});
  const coffeeDefinition=readFileSync(join(import.meta.dir,'../workflows/v2/coffee-kit.wf.yaml'),'utf8');
  if(process.env.COFFEE_LEGACY_CRASH){
    const copied=mkdtempSync(join(tmpdir(),'coffee-old-admission-'));cpSync(process.env.COFFEE_LEGACY_CRASH,copied,{recursive:true});const old=await harness([coffeeDefinition],{data:copied});let launches=0;
    try{old.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxFree:true,start(){launches++;return{interrupt(){},async *send(){yield{type:'turnEnd',status:'ok'};}};}} as any);
      installCoffeeKit(old.engine,{artifacts:new ArtifactStore(copied),choice:()=>({provider:'codex',model:'fixture-model',effort:'low'})});
      const evidence=join(copied,'evidence','R-001','ledger.jsonl'),historic=readFileSync(evidence,'utf8');old.engine.load();
      assert(await until(()=>old.engine.cards.list({run:'R-001',open:true}).some(c=>c.node==='capability')));
      check('actual frozen-old paid admission without format pin cannot relaunch',()=>assert.equal(launches,0));
      check('legacy signed history is not rewritten or silently certified',()=>{assert(readFileSync(evidence,'utf8').startsWith(historic));assert(!old.engine.trusted('R-001').entries.some(e=>e.record==='coffee-plan-v1'&&e.data.pageAdmission));});
      const c=old.engine.cards.list({run:'R-001',open:true}).find(c=>c.node==='capability')!;check('historical workflow without recovery edge offers close only',()=>assert(c.options.every(o=>o.id==='close')));await old.engine.answer(c.id,{choice:'close',by:'fixture captain'});
      const fresh=old.engine.start({workflow:'coffee-kit',text:'Explicit fresh Task after historical interrupted work',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});assert(await until(()=>old.engine.cards.list({run:fresh.id,open:true}).length===1));await old.engine.answer(old.engine.cards.list({run:fresh.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});assert(await until(()=>launches===1));
      check('explicit fresh Task creates its own signed paid admission',()=>assert(old.engine.trusted(fresh.id).entries.some(e=>e.record==='coffee-plan-v1'&&e.data.pageAdmission==='paid-intent-v1')));old.engine.cancel(fresh.id,'fixture teardown');
    }finally{old.stop();rmSync(copied,{recursive:true,force:true});}
    console.log(`${passed}/0 legacy-upgrade assertions`);process.exit(0);
  }
  const {bundledText}=await import('../src/bundled');const H = await harness([definition,pageDefinition,coffeeDefinition,bundledText('workflows/v2/firstmate-proposal.wf.yaml')!]);
  try {
    const artifacts=new ArtifactStore(H.data);
    let imageCalls=0,videoCalls=0;const imageRules:any[]=[];
    const {deflateSync}=await import('node:zlib');
    const crc=(b:Buffer)=>{let c=0xffffffff;for(const v of b){c^=v;for(let n=0;n<8;n++)c=c>>>1^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;};
    const chunk=(name:string,b:Buffer)=>{const n=Buffer.from(name),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([n,b])));return Buffer.concat([l,n,b,c]);};
    const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
    const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,161,90,28,255]))),chunk('IEND',Buffer.alloc(0))]);
    let pendingJudgeFinding=false;let configured='codex';const imageContexts:any[]=[],videoContexts:any[]=[],pageTexts:string[]=[];
    const coffeeInstall=installCoffeeKit(H.engine,{choice:()=>({provider:configured as any,model:'fixture-model',effort:'low'}),artifacts,image:async o=>{o.authorize();imageContexts.push(o.context);imageRules.push(o.rules);imageCalls++;assert(H.agents.queue.snapshot().active.some(a=>a.key.includes('coffee-image')));return{bytes:png,mime:'image/png',width:1,height:1,sha256:'fixture-only',provider:'codex',model:o.direction.model,effort:o.direction.effort};},video:async o=>{o.authorize();videoContexts.push(o.context);videoCalls++;const live=coffeeInstall.localJobs();assert(live.some(j=>j.task===H.engine.list().find(r=>r.nodes.video?.state==='running')?.id&&j.outcome==='running'&&j.cleanup==='pending'));o.onProgress?.('check');assert(coffeeInstall.localJobs().some(j=>j.phase==='check'));if(process.env.COFFEE_LOCAL_JOB_CONTROL){if(process.env.COFFEE_LOCAL_JOB_CONTROL==='cancel')H.engine.cancel(coffeeInstall.localJobs().find(j=>j.outcome==='running')!.task);throw new HyperframesFailure('Fixture timeout',process.env.COFFEE_LOCAL_JOB_CONTROL!=='unsafe','check','timeout');}assert(readFileSync(o.image).equals(png));assert(H.agents.queue.snapshot().active.some(a=>a.key.includes('coffee-video')));const bytes=Buffer.from(fixtureFilm);return{poster:fixturePoster,bytes,codec:'h264',duration:12,width:960,height:540,renderer:'hyperframes@0.8.159'};}});
    const r = H.engine.start({workflow:'coffee-direction-fixture',text:'A quiet coffee shop introduction',title:'Coffee fixture',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
    assert(await until(() => H.engine.cards.list({run:r.id,open:true}).length === 1));
    const c = H.engine.cards.list({run:r.id,open:true})[0];
    check('actual Engine direction card does not allocate a model job', () => assert(!H.engine.get(r.id)!.steps.some(s => s.job)));
    check('direction is not signed until captain approval', () => assert(!H.engine.trusted(r.id).entries.some(e => e.record === 'coffee-plan-v1')));
    assert(await until(()=>!!H.engine.get(r.id)!.nodes.direction.data.coffeeDirection));
    H.engine.get(r.id)!.nodes.direction.data.coffeeDirection.model='mutated-cache-must-not-authorize';
    await H.engine.answer(c.id,{choice:'confirm',by:'fixture captain'});
    assert(await until(() => H.engine.get(r.id)?.status === 'succeeded'));
    const signed = H.engine.trusted(r.id);
    check('actual answer records authenticated direction and generations', () => assert(signed.ok && signed.entries.some(e => e.record === 'coffee-plan-v1' && e.data.direction.model === 'fixture-model' && e.data.generations.image === 1)));
    check('captain direction starts ordinary next node exactly once', () => assert.equal(H.engine.get(r.id)!.nodes.done.visits,1));
    let calls = 0;
    let pageHTML='<!doctype html><html><head><meta charset="utf-8"></head><body><main><h1>Quiet coffee</h1><p>A welcoming introduction.</p><img src="assets/coffee.png" alt="Coffee"><video controls src="assets/coffee.mp4"></video></main></body></html>';
    H.engine.deps.provider = (id='codex',model='fixture-model') => ({id,model,reasoningEffort:'low',sandboxFree:true,start(_system:any,tools:any[],ctx:any) {
      if(tools.some(t=>t.name==='judge_report'))return {interrupt(){},async *send(text:string){
        assert(_system.includes('text-only')||_system.includes('TEXT-ONLY')||text.includes('text-and-source-only'));
        const warn=pendingJudgeFinding;pendingJudgeFinding=false;const args={verdict:warn?'warn':'pass',findings:warn?[{locator:{type:'file',path:'index.html',line:1},message:'Preserve accessible CTA contrast',expected:'Verify CTA contrast visually',class:'fixture-unresolved-review',severity:'minor'}]:[]};yield {type:'toolStart',id:'fixture-judge',name:'judge_report',args};
        const response=await fetch(`${ctx.studioUrl}/api/tools/judge_report`,{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify(args)});const result=await response.json();assert(!result.error);
        yield {type:'toolEnd',id:'fixture-judge',result:JSON.stringify(result)};yield {type:'turnEnd',status:'ok'};
      }};
      assert(tools.every(t => t.name.startsWith('work_')));
      return {interrupt(){},async *send(text:string) {
        pageTexts.push(text);calls++;
        const args = {path:'index.html',content:pageHTML};
        yield {type:'toolStart',id:'write-page',name:'work_write',args};
        const response = await fetch(`${ctx.studioUrl}/api/tools/work_write`,{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify(args)});
        const result = await response.json(); assert(!result.error);
        yield {type:'toolEnd',id:'write-page',result:JSON.stringify(result)};
        yield {type:'message',text:'Created a page with actual media destinations.'};
        yield {type:'turnEnd',status:'ok'};
      }};
    }} as any);
    const pageRun = H.engine.start({workflow:'coffee-page-fixture',text:'Introduce a quiet coffee shop',title:'Coffee page fixture',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
    assert(await until(() => H.engine.cards.list({run:pageRun.id,open:true}).length === 1));
    const pageDirection = H.engine.cards.list({run:pageRun.id,open:true})[0];
    await H.engine.answer(pageDirection.id,{choice:'confirm',by:'fixture captain'});
    assert(await until(() => ['succeeded','failed'].includes(H.engine.get(pageRun.id)!.status)));
    const pageState = H.engine.get(pageRun.id)!;
    check('native page producer executes actual bounded folder tools', () => assert(pageState.status === 'succeeded' && calls === 1));
    const pageProof = H.engine.trusted(pageRun.id);
    check('page artifact records actual AgentJob provenance and full manifest receipt', () => assert(pageProof.ok && pageProof.entries.some(e => e.record === 'coffee-output-v1' && e.data.part === 'page' && e.data.manifest.some((f:any) => f.path === 'index.html'))));
    const validHTML=pageHTML;
    for(const [name,html] of ((process.argv.includes("--replay-control")||process.argv.includes("--cancel-control"))?[]:[
      ['comment-only media','<main>Useful page<!-- <img src="assets/coffee.png"><video controls src="assets/coffee.mp4"></video> --></main>'],
      ['wrong media tag','<main><img src="assets/coffee.png"><img src="assets/coffee.mp4"></main>'],
      ['missing video controls','<main><img src="assets/coffee.png"><video src="assets/coffee.mp4"></video></main>'],
      ['inactive template media','<main><template><img src="assets/coffee.png"><video controls src="assets/coffee.mp4"></video></template></main>'],
      ['alternate image source','<main><img src="assets/coffee.png" srcset="other.png 2x"><video controls src="assets/coffee.mp4"></video></main>'],
      ['alternate video source','<main><img src="assets/coffee.png"><video controls><source src="other.mp4"><source src="assets/coffee.mp4"></video></main>'],
      ['wrong asset path','<main><img src="assets/coffee.png"><video controls src="elsewhere/coffee.mp4"></video></main>'],
    ])) {
      pageHTML=html;const bad=H.engine.start({workflow:'coffee-page-fixture',text:name,params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
      assert(await until(()=>H.engine.cards.list({run:bad.id,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:bad.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});
      assert(await until(()=>['succeeded','failed'].includes(H.engine.get(bad.id)!.status)));
      check('actual page producer rejects '+name,()=>assert(H.engine.get(bad.id)!.status==='failed'&&!H.engine.trusted(bad.id).entries.some(e=>e.record==='coffee-output-v1')));
    }
    pageHTML='<main><img src="assets/coffee.png"><video controls><source src="assets/coffee.mp4" type="video/mp4"></video></main>';
    const nested=H.engine.start({workflow:'coffee-page-fixture',text:'Nested source',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});assert(await until(()=>H.engine.cards.list({run:nested.id,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:nested.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});assert(await until(()=>['succeeded','failed'].includes(H.engine.get(nested.id)!.status)));check('actual page producer accepts controlled video with exact nested source',()=>assert.equal(H.engine.get(nested.id)!.status,'succeeded'));pageHTML=validHTML;
    // Hold the actual HTML parser promise between paid page completion and version creation.
    const NativeRewriter=globalThis.HTMLRewriter;let parserHeld=false,holdOnce=true,releaseParser=()=>{},afterSettled=()=>{};
    const settled=new Promise<void>(resolve=>{afterSettled=resolve;}),actualAfter=H.engine.modes['coffee-page'].after;
    H.engine.modes['coffee-page'].after=async(...args:any[])=>{try{return await (actualAfter as any)(...args);}finally{afterSettled();}};
    globalThis.HTMLRewriter=class extends NativeRewriter{transform(response:any){const out=super.transform(response),read=out.text.bind(out);out.text=async()=>{const text=await read();if(holdOnce){holdOnce=false;parserHeld=true;await new Promise<void>(resolve=>{releaseParser=resolve;});}return text;};return out;}};
    let cancelledPage:any;
    try{cancelledPage=H.engine.start({workflow:'coffee-page-fixture',text:'Cancel held parsed page',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});assert(await until(()=>H.engine.cards.list({run:cancelledPage.id,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:cancelledPage.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});assert(await until(()=>parserHeld));H.engine.cancel(cancelledPage.id,'captain cancels during awaited page validation');releaseParser();await settled;
      check('cancel during real awaited page parser creates no late artifact or version',()=>assert.equal(artifacts.get(`coffee-${cancelledPage.id.toLowerCase()}-page`),null));
      check('cancel during validation creates no page receipt Library or Done',()=>{assert(!H.engine.trusted(cancelledPage.id).entries.some(e=>e.record==='coffee-output-v1'));assert(!H.engine.get(cancelledPage.id)!.ctx.library);assert.equal(H.engine.get(cancelledPage.id)!.status,'cancelled');});
    }finally{releaseParser();globalThis.HTMLRewriter=NativeRewriter;H.engine.modes['coffee-page'].after=actualAfter;}
    const beforePlanRefusal=H.engine.list().length;
    check('missing full design refuses native Task allocation before any producer',()=>assert.throws(()=>H.engine.start({workflow:'coffee-kit',params:{provider:'codex',model:'fixture-model',effort:'low'}})));
    check('malformed full design refuses native Task allocation',()=>assert.throws(()=>H.engine.start({workflow:'coffee-kit',params:{coffeeDesignPlan:'{}',provider:'codex',model:'fixture-model',effort:'low'}})));
    check('design refusal allocates no Task or paid generation',()=>assert.equal(H.engine.list().length,beforePlanRefusal));
    const countBeforeNative=H.engine.list().length;
    check('native bridge direct Engine.start cannot bypass configured coffee model',()=>assert.throws(()=>H.engine.start({workflow:'coffee-kit',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'unapproved-model'}})));
    check('rejected native bridge start allocates no Task',()=>assert.equal(H.engine.list().length,countBeforeNative));
    const disguised=H.defs.create('disguised-coffee','Disguised coffee fixture','fixture captain','en','coffee-kit');
    H.defs.save(disguised.id,{base:1,kind:'web',nodes:disguised.nodes.map(n=>n.id==='direction'?{...n,label:'Disguised direction'}:n)},'fixture captain');
    check('changing mutable kind cannot bypass coffee mode/action authority',()=>assert.throws(()=>H.engine.start({workflow:disguised.id,params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),model:'unapproved-model'}})));
    const {StaffingStore:JourneyStaffing,coffeeStaffingProject:journeyProject,staffingHash:journeyHash,installStaffingGuard:journeyGuard}=await import('../src/domain/staffing');
    const {skillTextFor}=await import('../src/runtime');H.engine.deps.skillText=skillTextFor(join(H.data,'protected'));
    const journeyStore=new JourneyStaffing(H.data),journeyDef=H.defs.get('coffee-kit')!,journeyRoles:any={};
    for(const role of journeyDef.roles){journeyRoles[role.id]={provider:'codex',model:'fixture-model',effort:'low',...journeyStore.rolePins(role.skill,(r:string)=>H.engine.deps.skillText(r))};}
    const journeyConfig=journeyStore.approve({schema:1,algorithm:'sha256-canonical-v1',project:journeyProject('journey-coffee'),workflow:{id:journeyDef.id,version:journeyDef.version,sha256:journeyHash(journeyDef)},roles:journeyRoles,review:{freshContexts:3,distinctProviders:false}},null,{run:'fixture-captain-staffing',card:'fixture-confirmation',answerSeq:1});
    journeyGuard(H.engine,journeyStore,()=>{throw new Error('Coffee cannot borrow Git project identity');});
    const staffedParams={project:'journey-coffee',_staffing:journeyConfig.hash};
    pendingJudgeFinding=true;let kit:any,onboarding:any;
    if(process.env.COFFEE_ONBOARDING){
      const {Onboarding}=await import('../src/onboarding'),{installFirstmate}=await import('../src/firstmate'),{Projects}=await import('../src/doors');onboarding=new Onboarding(H.engine,artifacts);const count=H.engine.list().length;onboarding.choose('coffee');
      check('choosing the first project never allocates work',()=>assert.equal(H.engine.list().length,count));
      const primary=installFirstmate(H.engine,new Projects(H.data),{onCoffeeProposal:id=>onboarding.proposal(id),onCoffeeDispatch:(proposal,task)=>onboarding.dispatch(proposal,task)});
      const proposal:any=await primary.call('studio_propose_work',{workflow:'coffee-kit',version:journeyDef.version,text:'Captain discussed coffee-shop introduction',params:{project:'journey-coffee',coffeeDesignPlan:JSON.stringify(fixtureDesignPlan)}},{key:'onboarding-captain-turn',captain:true,text:'Explicit offline captain brief',live:()=>true,signal:new AbortController().signal});
      check('only validated native proposal is durably bound before any child exists',()=>{assert.equal(onboarding.view().stage,'confirm');assert.equal(onboarding.view().complete,false);assert.equal(H.engine.list().length,count+1);});
      assert(await until(()=>H.engine.cards.list({run:proposal.proposal,open:true}).length===1));await H.engine.answer(H.engine.cards.list({run:proposal.proposal,open:true})[0].id,{choice:'approve',by:'offline captain'});assert(await until(()=>!!H.engine.get(proposal.proposal)?.ctx.childRun));kit=H.engine.get(H.engine.get(proposal.proposal)!.ctx.childRun)!;
      assert(await until(()=>onboarding.view().task===kit.id));const boundCount=H.engine.list().length;
      onboarding.pause(true);const reload=new Onboarding(H.engine,artifacts);
      check('skip/reload keeps the exact dispatched Task without cancelling or replacing it',()=>{assert(reload.view().paused);assert.equal(reload.view().task,kit.id);assert.notEqual(kit.status,'cancelled');assert.equal(H.engine.list().length,boundCount);});
      onboarding.pause(false);onboarding.choose('coffee');
      check('resume and repeated choice cannot duplicate a Task or certify creation',()=>{assert.equal(onboarding.view().task,kit.id);assert.equal(onboarding.view().complete,false);assert.equal(H.engine.list().length,boundCount);});
    }else kit=H.engine.start({workflow:'coffee-kit',title:'Coffee kit fixture',text:'A warm coffee-shop introduction',params:{...staffedParams,coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
    assert(await until(()=>H.engine.cards.list({run:kit.id,open:true}).length===1));
    const direction=H.engine.cards.list({run:kit.id,open:true})[0];
    await H.engine.answer(direction.id,{choice:'confirm',by:'fixture captain'});
    if(process.env.COFFEE_LOCAL_JOB_CONTROL){
      assert(await until(()=>coffeeInstall.localJobs().some(j=>j.task===kit.id&&j.endedAt!==null)));
      const job=coffeeInstall.localJobs().find(j=>j.task===kit.id)!;
      check('actual local renderer failure/cancel settles with source-owned outcome',()=>assert.equal(job.outcome,process.env.COFFEE_LOCAL_JOB_CONTROL==='cancel'?'cancelled':'failed'));
      check('cleanup and capacity reflect actual adapter death receipt',()=>{const unsafe=process.env.COFFEE_LOCAL_JOB_CONTROL==='unsafe';assert.equal(job.cleanup,unsafe?'unverified':'verified');assert.equal(H.agents.queue.snapshot().active.some(a=>a.key.includes('coffee-video')),unsafe);});
      check('progress timestamp and task link identity remain available after failure',()=>assert(job.startedAt<=job.lastProgressAt&&job.lastProgressAt<=job.endedAt!&&job.phase==='check'&&job.task===kit.id));
      H.stop();console.log(`${passed}/0 local-render controls`);process.exit(0);
    }
    assert(await until(()=>H.engine.cards.list({run:kit.id,open:true}).some(c=>c.node==='review') || H.engine.get(kit.id)?.status==='failed'),JSON.stringify({nodes:H.engine.get(kit.id)?.nodes,cards:H.engine.cards.list({run:kit.id,open:true})}));
    const review=H.engine.cards.list({run:kit.id,open:true}).find(c=>c.node==='review');
    assert(review,JSON.stringify(H.engine.get(kit.id)?.nodes));
    check('completed local renderer remains distinct from LLM jobs',()=>{const j=coffeeInstall.localJobs().find(j=>j.task===kit.id)!;assert.equal(j.outcome,'succeeded');assert.equal(j.cleanup,'verified');assert(j.endedAt);assert(H.sent.some(([t])=>t==='coffee-local-job'));const copy=coffeeInstall.localJobs();copy[0].phase='mutated';assert.notEqual(coffeeInstall.localJobs()[0].phase,'mutated');});
    const first=H.engine.trusted(kit.id).entries.filter(e=>e.record==='coffee-output-v1');
    const site=first.find(e=>e.data.part==='site')!.data;
    check('actual native workflow integrates pinned image and locally synthesized real MP4 bytes',()=>{assert(readFileSync(join(artifacts.filesDir(site.artifact,site.n),'assets/coffee.png')).equals(png));assert(readFileSync(join(artifacts.filesDir(site.artifact,site.n),'assets/coffee.mp4')).equals(fixtureFilm));});
    check('combined staffed journey consumes website and both review role skill snapshots',()=>{const receipts=H.engine.trusted(kit.id).entries.filter(e=>e.record==='staffing-instructions');for(const role of ['worker','reviewer','designer'])assert(receipts.some(e=>e.data.role===role&&e.data.config===journeyConfig.hash&&e.data.skill===journeyRoles[role].skill.sha256));assert.equal(receipts.filter(e=>e.data.role==='reviewer').length,3);assert.equal(receipts.filter(e=>e.data.role==='designer').length,3);assert(H.engine.trusted(kit.id).entries.some(e=>e.record==='coffee-image-instructions-v1'&&e.data.skill===journeyRoles['image-worker'].skill.sha256));});
    const pageVersion=first.find(e=>e.data.part==='page')!.data.n;
    await H.engine.answer(review.id,{choice:'image',note:'Use softer coffee lighting',by:'fixture captain'});
    assert(await until(()=>H.engine.cards.list({run:kit.id,open:true}).some(c=>c.node==='review' && c.id!==review.id)),JSON.stringify({nodes:H.engine.get(kit.id)?.nodes,checks:H.engine.ledger(kit.id).filter(e=>e.record==='check').map(e=>({check:e.check,verdict:e.verdict,error:e.error}))}));
    const revised=H.engine.cards.list({run:kit.id,open:true}).find(c=>c.node==='review' && c.id!==review.id)!;
    const all=H.engine.trusted(kit.id).entries.filter(e=>e.record==='coffee-output-v1');
    check('every coffee image job receives the operating rules section with its hash',()=>{assert(imageRules.length>0&&imageRules.every(r=>typeof r?.text==='string'&&r.text.startsWith('# Operating rules (set by the captain)')&&/^[0-9a-f]{64}$/.test(r.hash)));});
    check('targeted image revision preserves page and rerenders film/site',()=>{assert.equal(all.filter(e=>e.data.part==='page').length,1);assert.equal(all.find(e=>e.data.part==='page')!.data.n,pageVersion);assert.equal(imageCalls,2);assert.equal(videoCalls,2);assert.equal(all.filter(e=>e.data.part==='site').length,2);});
    const beforeSharedImage=imageCalls,beforeSharedVideo=videoCalls;
    await assert.rejects(H.engine.answer(revised.id,{choice:'direction',note:'Make the whole design blue',by:'fixture captain'}));
    check('unstructured shared-plan change keeps existing offer open without production',()=>{assert.equal(H.engine.cards.get(revised.id)!.status,'open');assert.equal(imageCalls,beforeSharedImage);});
    const nextDesign=structuredClone(fixtureDesignPlan);nextDesign.brand.palette[2]='#996b45';nextDesign.video.beats[1].caption='A newly confirmed shared moment.';
    await H.engine.answer(revised.id,{choice:'direction',note:JSON.stringify(nextDesign),by:'fixture captain'});assert(await until(()=>H.engine.cards.list({run:kit.id,open:true}).some(c=>c.node==='round')));const sharedCard=H.engine.cards.list({run:kit.id,open:true}).find(c=>c.node==='round')!;
    check('shared-plan editing remains free until complete revised plan confirmation',()=>{assert.equal(imageCalls,beforeSharedImage);assert.equal(videoCalls,beforeSharedVideo);assert(sharedCard.body.includes('A newly confirmed shared moment.'));});
    await H.engine.answer(sharedCard.id,{choice:'confirm-design',by:'fixture captain'});assert(await until(()=>H.engine.cards.list({run:kit.id,open:true}).some(c=>c.node==='review'&&c.id!==revised.id)));const finalShared=H.engine.cards.list({run:kit.id,open:true}).find(c=>c.node==='review')!;
    check('reconfirmed shared plan invalidates all dependent outputs and preserves history',()=>{assert.equal(imageCalls,beforeSharedImage+1);assert.equal(videoCalls,beforeSharedVideo+1);assert.equal(H.engine.trusted(kit.id).entries.filter(e=>e.record==='coffee-output-v1'&&e.data.part==='page').length,2);assert.equal(artifacts.versions(site.artifact).length,3);});
    let acceptance=finalShared;
    for(const [target,firstNote,secondNote]of [['page','Keep the CTA blue','Move the CTA lower'],['image','Keep the cat black','Tilt the cat left'],['video','Use less motion','Keep the slower pacing']] as const){
      for(const note of [firstNote,secondNote]){const previous=acceptance.id;await H.engine.answer(previous,{choice:target,note,by:'fixture captain'});assert(await until(()=>H.engine.cards.list({run:kit.id,open:true}).some(c=>c.node==='review'&&c.id!==previous)),JSON.stringify({target,note,nodes:Object.fromEntries(Object.entries(H.engine.get(kit.id)!.nodes).map(([id,n])=>[id,{state:n.state,error:n.error,note:n.note}])),checks:H.engine.ledger(kit.id).filter(e=>e.record==='check').slice(-6).map(e=>({check:e.check,verdict:e.verdict,error:e.error}))}));acceptance=H.engine.cards.list({run:kit.id,open:true}).find(c=>c.node==='review')!;assert(await until(()=>H.engine.trusted(kit.id).entries.some(e=>e.record==='coffee-offer-v1'&&e.data.card===acceptance.id)));}
      check(`two ${target} refinements retain both original comments and exact target versions`,()=>{const offer=H.engine.trusted(kit.id).entries.filter(e=>e.record==='coffee-offer-v1').at(-1)!.data;assert(acceptance.body.includes(firstNote)&&acceptance.body.includes(secondNote));const requests=offer.constraints.requests.filter((r:any)=>r.target===target);assert(requests.some((r:any)=>r.originalCaptainComment===firstNote&&r.targetVersion?.manifest));assert(requests.some((r:any)=>r.originalCaptainComment===secondNote&&r.targetVersion?.manifest),JSON.stringify({target,secondNote,requests}));if(target==='page')assert(pageTexts.at(-1)!.includes(firstNote)&&pageTexts.at(-1)!.includes(secondNote));if(target==='image')assert(JSON.stringify(imageContexts.at(-1)).includes(firstNote)&&JSON.stringify(imageContexts.at(-1)).includes(secondNote));if(target==='video')assert(JSON.stringify(videoContexts.at(-1)).includes(firstNote)&&JSON.stringify(videoContexts.at(-1)).includes(secondNote));});
    }
    check('prior unresolved actual reviewer finding survives later passing reviews and all producer loops',()=>{const offer=H.engine.trusted(kit.id).entries.filter(e=>e.record==='coffee-offer-v1').at(-1)!.data;assert(JSON.stringify(offer.constraints.machineFindings).includes('Preserve accessible CTA contrast'));assert(pageTexts.at(-1)!.includes('Preserve accessible CTA contrast'));assert(JSON.stringify(imageContexts.at(-1)).includes('Preserve accessible CTA contrast'));assert(JSON.stringify(videoContexts.at(-1)).includes('Preserve accessible CTA contrast'));});
    await H.engine.answer(acceptance.id,{choice:'approve',by:'fixture captain'});

    assert(await until(()=>H.engine.get(kit.id)?.status==='succeeded'));
    check('whole-bundle human approval reaches native Done and Library once',()=>{const state=H.engine.get(kit.id)!;assert(state.ctx.library);assert.equal(state.nodes.library.visits,1);assert.equal(artifacts.approved(state.ctx.library.artifact)?.n,9);assert.equal(H.agents.queue.snapshot().active.length,0);});
    if(onboarding){
      const {Onboarding}=await import('../src/onboarding');check('only signed whole-site captain approval and actual Done completes the journey',()=>{const view=new Onboarding(H.engine,artifacts).view();assert.equal(view.complete,true);assert.equal(view.stage,'complete');assert.equal(view.task,kit.id);assert.equal(view.version,9);});
      if(process.env.COFFEE_ONBOARDING_EXPORT){const destination=process.env.COFFEE_ONBOARDING_EXPORT;cpSync(H.data,destination,{recursive:true,errorOnExist:true});const {readdirSync}=await import('node:fs');const keep=new Set([kit.id,kit.params._firstmateProposal]);for(const sub of ['runs','evidence'])for(const id of readdirSync(join(destination,sub)))if(!keep.has(id))rmSync(join(destination,sub,id),{recursive:true,force:true});for(const file of readdirSync(join(destination,'cards'))){const c=JSON.parse(readFileSync(join(destination,'cards',file),'utf8'));if(!keep.has(c.run))rmSync(join(destination,'cards',file));}}
      const siteFile=join(artifacts.filesDir(site.artifact,9),'assets/coffee.png'),original=readFileSync(siteFile);writeFileSync(siteFile,'changed after approval');check('changed final media cannot retain a completed journey badge',()=>{assert.equal(onboarding.view().complete,false);assert.equal(onboarding.view().stage,'hold');});writeFileSync(siteFile,original);
      const record=join(H.data,'onboarding','000001.json'),saved=readFileSync(record);writeFileSync(record,'{}');const count=H.engine.list().length;check('corrupt journey holds without adopting another Task or allocating replacement',()=>{assert.equal(onboarding.view().stage,'hold');assert.equal(onboarding.view().complete,false);assert.equal(H.engine.list().length,count);});writeFileSync(record,saved);
    }
    const tampered=H.engine.start({workflow:'coffee-kit',title:'Tamper refusal fixture',text:'Coffee preview',params:{...staffedParams,coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
    assert(await until(()=>H.engine.cards.list({run:tampered.id,open:true}).length===1));
    await H.engine.answer(H.engine.cards.list({run:tampered.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});
    assert(await until(()=>H.engine.cards.list({run:tampered.id,open:true}).some(c=>c.node==='review')));
    const stale=H.engine.cards.list({run:tampered.id,open:true}).find(c=>c.node==='review')!;
    const sitePin=H.engine.trusted(tampered.id).entries.filter(e=>e.record==='coffee-output-v1'&&e.data.part==='site').at(-1)!.data;
    writeFileSync(join(artifacts.filesDir(sitePin.artifact,sitePin.n),'assets/coffee.png'),'tampered after final offer');
    await H.engine.answer(stale.id,{choice:'approve',by:'fixture captain'});
    assert(await until(()=>H.engine.cards.list({run:tampered.id,open:true}).some(c=>c.node==='capability')));
    check('unchanged index with changed embedded image refuses real card approval and Done',()=>{assert(!artifacts.approved(sitePin.artifact));assert(!H.engine.get(tampered.id)!.ctx.library);assert.equal(H.engine.get(tampered.id)!.nodes.done.visits,0);});
    H.engine.cancel(tampered.id,'fixture teardown after refusal');
    const held=await harness([coffeeDefinition]);
    try {
      held.engine.deps.provider=H.engine.deps.provider;
      installCoffeeKit(held.engine,{choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),artifacts:new ArtifactStore(held.data),image:async o=>{o.authorize();return{bytes:png,mime:'image/png',width:1,height:1,sha256:'fixture-only',provider:'codex',model:'fixture-model',effort:'low'};}});
      const run=held.engine.start({workflow:'coffee-kit',title:'Renderer unavailable fixture',text:'Create useful coffee previews',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
      assert(await until(()=>held.engine.cards.list({run:run.id,open:true}).length===1));
      await held.engine.answer(held.engine.cards.list({run:run.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});
      assert(await until(()=>held.engine.cards.list({run:run.id,open:true}).some(c=>c.node==='capability')));
      const card=held.engine.cards.list({run:run.id,open:true}).find(c=>c.node==='capability')!;
      check('missing real renderer exposes useful page/image links without approval',()=>{assert.equal(card.links.length,2);assert(card.links.some(l=>l.label.startsWith('page'))&&card.links.some(l=>l.label.startsWith('image')));assert(card.options.every(o=>o.id==='close'));});
      check('unavailable film cannot silently produce Library or fake Done',()=>{assert(!held.engine.get(run.id)!.ctx.library);assert.equal(held.engine.get(run.id)!.nodes.done.visits,0);assert.equal(held.agents.queue.snapshot().active.length,0);});
      held.engine.cancel(run.id,'fixture teardown');
    }finally{held.stop();rmSync(held.data,{recursive:true,force:true});}
    const uncertain=await harness([coffeeDefinition]);
    try {
      uncertain.engine.deps.provider=H.engine.deps.provider;
      installCoffeeKit(uncertain.engine,{choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),artifacts:new ArtifactStore(uncertain.data),image:async()=>{throw new CodexImageFailure('Fixture reports unverified process death',false);}});
      const run=uncertain.engine.start({workflow:'coffee-kit',title:'Unverified cleanup fixture',text:'Coffee preview',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
      assert(await until(()=>uncertain.engine.cards.list({run:run.id,open:true}).length===1));
      await uncertain.engine.answer(uncertain.engine.cards.list({run:run.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});
      assert(await until(()=>uncertain.engine.cards.list({run:run.id,open:true}).some(c=>c.node==='capability')&&uncertain.engine.get(run.id)!.nodes.page.state==='passed'));
      check('unverified image cleanup retains actual native capacity lease',()=>assert.equal(uncertain.agents.queue.snapshot().active.length,1));
      uncertain.engine.cancel(run.id,'fixture teardown; capacity authority must remain held');
      check('Task cancellation cannot fabricate verified process cleanup',()=>assert.equal(uncertain.agents.queue.snapshot().active.length,1));
    }finally{uncertain.stop();rmSync(uncertain.data,{recursive:true,force:true});}
    // Copy a real interrupted paid page round, then load it with fresh owners.
    const crash=await harness([coffeeDefinition]);let releaseCrash=()=>{},pageStarted=false;
    const originalProvider=H.engine.deps.provider;
    crash.engine.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxFree:true,start(){return{interrupt(){releaseCrash();},async *send(){pageStarted=true;await new Promise<void>(resolve=>{releaseCrash=resolve;});yield{type:'turnEnd',status:'cancelled'};}};}} as any);
    const replayData=mkdtempSync(join(tmpdir(),'coffee-paid-replay-'));let loaded:any;
    try {
      installCoffeeKit(crash.engine,{choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),artifacts:new ArtifactStore(crash.data),image:async o=>{o.authorize();return{bytes:png,mime:'image/png',width:1,height:1,sha256:'fixture-only',provider:'codex',model:'fixture-model',effort:'low'};}});
      const interrupted=crash.engine.start({workflow:'coffee-kit',text:'Interrupted actual page fixture',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
      assert(await until(()=>crash.engine.cards.list({run:interrupted.id,open:true}).length===1));await crash.engine.answer(crash.engine.cards.list({run:interrupted.id,open:true})[0].id,{choice:'confirm',by:'fixture captain'});
      assert(await until(()=>pageStarted&&crash.engine.trusted(interrupted.id).entries.some(e=>e.record==='coffee-output-v1'&&e.data.part==='image')));
      const partial=join(crash.engine.get(interrupted.id)!.nodes.page.data.coffeeWork,'partial.txt');writeFileSync(partial,'captured paid page work');cpSync(crash.data,replayData,{recursive:true});if(process.env.COFFEE_CRASH_EXPORT)cpSync(replayData,process.env.COFFEE_CRASH_EXPORT,{recursive:true});
      crash.engine.cancel(interrupted.id,'stop original owned fixture after crash snapshot');releaseCrash();
      loaded=await harness([coffeeDefinition],{data:replayData});let replayCalls=0;
      loaded.engine.deps.provider=(...args:any[])=>{const p=(originalProvider as any)(...args);return{...p,start(...a:any[]){replayCalls++;return (p.start as any)(...a);}};};
      installCoffeeKit(loaded.engine,{choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),artifacts:new ArtifactStore(replayData)});loaded.engine.load();
      assert(await until(()=>loaded.engine.cards.list({run:interrupted.id,open:true}).some((c:any)=>c.node==='capability')));
      check('actual Engine.load cannot repeat interrupted paid page generation',()=>assert.equal(replayCalls,0));
      check('interrupted page generation and copied work remain unchanged before recovery',()=>{assert.equal(loaded.engine.trusted(interrupted.id).entries.filter((e:any)=>e.record==='coffee-plan-v1').at(-1).data.generations.page,1);assert(existsSync(partial.replace(crash.data,replayData)));});
      const recovery=loaded.engine.cards.list({run:interrupted.id,open:true}).find((c:any)=>c.node==='capability');assert(recovery.options.some((o:any)=>o.id==='fresh-page'));
      await loaded.engine.answer(recovery.id,{choice:'fresh-page',note:'Explicitly authorize a new paid page attempt after interrupted round',by:'fixture captain'});
      assert(await until(()=>loaded.engine.cards.list({run:interrupted.id,open:true}).some((c:any)=>c.node==='capability'&&c.id!==recovery.id)));
      check('explicit recovery authorizes exactly one fresh page generation preserving image',()=>{assert.equal(replayCalls,1);const p=loaded.engine.trusted(interrupted.id).entries.filter((e:any)=>e.record==='coffee-plan-v1').at(-1).data;assert.equal(p.generations.page,2);assert.equal(p.generations.image,1);});
    }finally{releaseCrash();crash.stop();loaded?.stop();rmSync(crash.data,{recursive:true,force:true});rmSync(replayData,{recursive:true,force:true});}
    const {createRuntime}=await import('../src/runtime');
    const runtime=createRuntime({staffingFacts:async()=>[{provider:'codex',support:'supported',auth:'verified',quota:'available',expires:Date.now()+30000,models:[{id:'fixture-model',efforts:['low']}]}],dataDir:H.data,agents:H.agents,provider:H.engine.deps.provider,defaultProvider:()=>({provider:'codex',model:'fixture-model'}),log:H.engine.deps.log,send(){},fmRoot:join(H.data,'protected'),studioUrl:()=>H.toolUrl,m3:{store:artifacts,runs:null,lane:null},coffeeChoice:()=>({provider:'codex',model:'fixture-model',effort:'low'})});
    const request=async(path:string,body?:any,kind='desktop')=>{const req=new Request(`http://localhost${path}`,body?{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}}:undefined);return runtime.handle(req,new URL(req.url),{kind},!!body);};
    const beforeCreate=runtime.engine.list().length;
    const created=await request('/api/wf',{id:'my-coffee-fixture',name:'My useful coffee workflow',template:'coffee-kit',locale:'en'});
    assert.equal(created?.status,201);const createdBody=await created!.json();
    check('native API creates source-pinned coffee template without allocating a Task',()=>{assert.equal(createdBody.def.kind,'coffee-kit');assert(createdBody.def.note.includes('SHA256'));assert.equal(runtime.engine.list().length,beforeCreate);});
    const duplicate=await request('/api/wf',{id:'my-coffee-fixture',name:'Overwrite refused',template:'coffee-kit'});
    check('native workflow create never overwrites existing identity',()=>assert(duplicate!.status>=400));
    const chosen=await request('/api/wf/my-coffee-fixture');const chosenBody=await chosen!.json();
    check('guided API exposes native configured identity separately from account proof',()=>assert.deepEqual(chosenBody.coffeeChoice,{provider:'codex',model:'fixture-model',effort:'low'}));
    const mismatched=await request('/api/wruns',{workflow:'my-coffee-fixture',text:'Coffee fixture',params:{coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),model:'unapproved-model'}});
    check('missing confirmed staffing refuses before Task allocation',()=>{assert.equal(mismatched?.status,409);assert.equal(runtime.engine.list().length,beforeCreate);});
    const {StaffingStore,coffeeStaffingProject,staffingHash}=await import('../src/domain/staffing');
    const staffingStore=new StaffingStore(H.data),artifactProject=coffeeStaffingProject('captain-coffee-fixture'),roles:any={};
    for(const role of createdBody.def.roles){roles[role.id]={provider:'codex',model:'fixture-model',effort:'low',...staffingStore.rolePins(role.skill,(r:string)=>runtime.engine.deps.skillText(r))};}
    staffingStore.approve({schema:1,algorithm:'sha256-canonical-v1',project:artifactProject,workflow:{id:createdBody.def.id,version:createdBody.def.version,sha256:staffingHash(createdBody.def)},roles,review:{freshContexts:3,distinctProviders:false}},null,{run:'explicit-fixture-approval',card:'explicit-fixture-card',answerSeq:1});
    await runtime.firstmate.call('studio_staffing_facts',{}, {key:'fixture',captain:true,text:'Read verified offline facts',live:()=>true,signal:new AbortController().signal});
    const started=await request('/api/wruns',{workflow:'my-coffee-fixture',version:1,title:'Native API coffee fixture',text:'Coffee fixture',params:{project:'captain-coffee-fixture',coffeeDesignPlan:JSON.stringify(fixtureDesignPlan),provider:'codex',model:'fixture-model',effort:'low'}});
    assert.equal(started?.status,200);const startedBody=await started!.json();
    check('native API starts exact chosen workflow/version with atomic model pin',()=>{assert.equal(startedBody.workflow,'my-coffee-fixture');assert.equal(startedBody.version,1);assert.equal(startedBody.params.model,'fixture-model');});
    assert(await until(()=>runtime.engine.cards.list({run:startedBody.id,open:true}).length===1));
    runtime.engine.cancel(startedBody.id,'fixture teardown before any real capability call');
    const phone=await request('/api/wf',{id:'phone-no-create',name:'No',template:'coffee-kit'},'phone');
    check('phone cannot allocate a native coffee workflow',()=>assert.equal(phone?.status,403));
    console.log('Full native Engine fixture uses explicitly simulated media adapters; NOT real model/video/playback acceptance.');
  } finally { H.stop(); rmSync(H.data,{recursive:true,force:true}); }
  console.log(`${passed}/0 assertions; real provider/render/playback and browser UI acceptance remain pending`);
} finally { rmSync(dir, {recursive:true,force:true}); }
