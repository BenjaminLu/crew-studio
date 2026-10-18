import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import {execFileSync} from 'node:child_process';
// Actual native runtime + authenticated UI; source-owned offline provider/media fixtures.
// Simulated film bytes are NOT real encoding/playback/quality evidence.
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {freePort,waitUp,withSession} from './boot.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const fixtureDesignPlan=JSON.parse(readFileSync(join(root,'tests/fixture/coffee-design.json'),'utf8'));
const fixturePoster=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=16x16','-frames:v','1','-vcodec','png','-f','image2pipe','pipe:1'],{timeout:10000});
const fixtureFilm=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=tan:s=160x90:r=1:d=12','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{timeout:10000});
if(process.argv.includes('--fixture-server')){
 const {Agents}=await import('../src/agent.ts'),{ArtifactStore}=await import('../src/artifacts.ts'),{createRuntime}=await import('../src/runtime/index.ts'),{installCoffeeKit}=await import('../src/domain/coffee-kit.ts'),{createM3}=await import('../src/m3.ts'),{StudioLog}=await import('../src/rawlog.ts'),{guardWrite,hasSession,sessionCookie}=await import('../src/csrf.ts'),{deflateSync}=await import('node:zlib');
 const data=process.env.CREW_DATA,token='coffee-ui-fixture',port=Number(process.env.CREW_PORT),base=`http://127.0.0.1:${port}`,writers=new Set();
 const send=(type,value)=>{for(const writer of writers)try{writer.enqueue(new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`));}catch{writers.delete(writer);}};
 const agents=new Agents(data,()=>base),artifacts=new ArtifactStore(data),log=new StudioLog(join(data,'events.jsonl'));
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let n=0;n<8;n++)c=c>>>1^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;};
 const chunk=(name,b)=>{const n=Buffer.from(name),l=Buffer.alloc(4),c=Buffer.alloc(4);l.writeUInt32BE(b.length);c.writeUInt32BE(crc(Buffer.concat([n,b])));return Buffer.concat([l,n,b,c]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,161,90,28,255]))),chunk('IEND',Buffer.alloc(0))]);
 const provider={id:'codex',model:'fixture-model',reasoningEffort:'low',sandboxFree:true,start(_s,tools,ctx){if(tools.some(t=>t.name==='judge_report'))return{interrupt(){},async *send(){const args={verdict:'pass',findings:[]};yield{type:'toolStart',id:'offline-judge',name:'judge_report',args};const result=await fetch(base+'/api/tools/judge_report',{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify(args)}).then(r=>r.json());if(result.error)throw new Error(result.error);yield{type:'toolEnd',id:'offline-judge',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};if(tools.some(t=>!t.name.startsWith('work_')))throw new Error('Unexpected fixture authority');return{interrupt(){},async *send(){const args={path:'index.html',content:'<!doctype html><html><head><meta charset="utf-8"></head><body><main><h1>A quieter coffee moment</h1><p>Warm light, coffee and croissants.</p><img src="assets/coffee.png" alt="Offline image fixture"><video controls src="assets/coffee.mp4"></video></main></body></html>'};yield{type:'toolStart',id:'page',name:'work_write',args};const result=await fetch(base+'/api/tools/work_write',{method:'POST',headers:{'content-type':'application/json','x-crew-tool-token':ctx.token},body:JSON.stringify(args)}).then(r=>r.json());if(result.error)throw new Error(result.error);yield{type:'toolEnd',id:'page',result:JSON.stringify(result)};yield{type:'message',text:'Offline page fixture created.'};yield{type:'turnEnd',status:'ok'};}};}};
 const m3=createM3({dataDir:data,fileAllow:[data],studioUrl:()=>base,provider:()=>provider,send,allowDrive:()=>true});
 const coffeeAdapters={choice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),artifacts,image:async o=>{o.authorize();return{bytes:png,mime:'image/png',width:1,height:1,sha256:'offline-fixture',provider:'codex',model:'fixture-model',effort:'low'};},video:async o=>{o.authorize();const bytes=Buffer.from(fixtureFilm);return{poster:fixturePoster,bytes,codec:'h264',duration:12,width:960,height:540,renderer:'hyperframes@0.8.159'};}};
 const verifiedFixtureRender=coffeeAdapters.video,filmStatus={ready:true,reason:null};let discussion=null;
 const rt=createRuntime({staffingFacts:async()=>[{provider:'codex',support:'supported',auth:'verified',quota:'available',expires:Date.now()+30000,models:[{id:'fixture-model',efforts:['low']}]}],dataDir:data,agents,provider:()=>provider,defaultProvider:()=>({provider:'codex',model:'fixture-model'}),log,send,fmRoot:join(data,'protected'),studioUrl:()=>base,coffeeChoice:()=>({provider:'codex',model:'fixture-model',effort:'low'}),coffeeFilmStatus:filmStatus,install:[engine=>{const coffee=installCoffeeKit(engine,coffeeAdapters);m3.useArtifactReviewPolicy(coffee.artifactReview);} ]});
 const {StaffingStore,coffeeStaffingProject,staffingHash}=await import('../src/domain/staffing.ts');
 const staffingStore=new StaffingStore(data),def=rt.defs.get('coffee-kit'),roles={};for(const role of def.roles)roles[role.id]={provider:'codex',model:'fixture-model',effort:'low',...staffingStore.rolePins(role.skill,(r)=>rt.engine.deps.skillText(r))};
 staffingStore.approve({schema:1,algorithm:'sha256-canonical-v1',project:coffeeStaffingProject('ui-coffee-project'),workflow:{id:def.id,version:def.version,sha256:staffingHash(def)},roles,review:{freshContexts:3,distinctProviders:false}},null,{run:'offline-fixture-staffing',card:'offline-fixture-card',answerSeq:1});
 await rt.firstmate.call('studio_staffing_facts',{}, {key:'offline-fixture',captain:true,text:'Offline fixture facts',live:()=>true,signal:new AbortController().signal});
 const {createTasksApi,taskAlias}=await import('../src/tasks-api.ts');
 const tasksApi=createTasksApi({list:()=>rt.engine.list(),get:id=>rt.engine.get(id),openCards:()=>rt.engine.cards.list({open:true}),runView:async id=>{const u=new URL(base+'/api/wruns/'+id),r=await rt.handle(new Request(u),u,{kind:'desktop'},false);return r?.ok?r.json():null;}});
 const server=Bun.serve({port,hostname:'127.0.0.1',async fetch(req){const url=new URL(req.url),p=url.pathname,writing=!['GET','HEAD'].includes(req.method);
  if(p==='/api/fixture/render'&&writing){const denied=guardWrite(req,url,token,false);if(denied)return Response.json(denied,{status:denied.status});const body=await req.json();coffeeAdapters.video=body.available?verifiedFixtureRender:undefined;filmStatus.ready=!!body.available;return Response.json({configured:!!coffeeAdapters.video});}
  if(p==='/api/instance')return Response.json({pid:process.pid});
  if(p==='/session'){if(url.searchParams.get('t')!==token)return new Response('forbidden',{status:403});return new Response(null,{status:303,headers:{location:'/', 'set-cookie':sessionCookie(token)}});}
  if(p==='/api/session')return Response.json({session:hasSession(req,token)});
  if(writing&&!p.startsWith('/api/tools/')){const refusal=guardWrite(req,url,token,false);if(refusal)return Response.json(refusal,{status:refusal.status});}
  if(p==='/api/tools')return Response.json(agents.toolList(req.headers.get('x-crew-tool-token')??''));
  if(p.startsWith('/api/tools/'))return Response.json(await agents.callTool(req.headers.get('x-crew-tool-token')??'',decodeURIComponent(p.slice(11)),await req.json()));
  if(p==='/api/stream'){let controller;const stream=new ReadableStream({start(c){controller=c;writers.add(c);},cancel(){writers.delete(controller);}});return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});}
  const task=await tasksApi.handle(url,writing);if(task)return task;
  const target=new URL(url),alias=taskAlias(p,writing);if(alias)target.pathname=alias;
  if(p==='/api/wruns'&&writing)await rt.firstmate.call('studio_staffing_facts',{}, {key:'offline-fixture-refresh',captain:true,text:'Offline fixture facts',live:()=>true,signal:new AbortController().signal});
  const r=await rt.handle(req.clone(),target,{kind:'desktop'},writing);if(r)return r;
  const artifact=await m3.handle(req,url,{kind:'desktop'},writing);if(artifact)return artifact;
  if(p==='/api/summary')return Response.json({tasks:[],pending:[],crew:[],github:null,board:null,flow:null,events:0,state:'offline-fixture'});
  if(p==='/api/types'||p==='/api/intents')return Response.json([]);
  if(p==='/api/doctor')return Response.json({items:[]});
  if(p==='/api/improve')return Response.json({edits:[],retros:[]});
  if(p==='/api/changes')return Response.json({changes:[],projects:[]});
  if(p==='/api/packs')return Response.json({drafts:[],packs:[]});
  if(p==='/api/skills')return Response.json({skills:[],caps:{}});
  if(p==='/api/main')return Response.json({state:'attached',context:'studio',host:'codex',model:'offline-fixture',busy:false,log:[],approvals:[],queue:[],driver:{holder:'studio'},origin:null,drive:{path:'fresh'},project:data});
  if(p==='/api/main/send'&&writing){discussion=await req.json();return Response.json({ok:true});}
  if(p==='/api/firstmate/history')return Response.json({entries:[],atStart:true,file:'offline-fixture'});
  if(p==='/api/fixture/discussion')return Response.json({discussion});
  if(p==='/api/takeover')return Response.json({error:'Explicit offline conversation fixture; no real primary account turn.'});
  if(p==='/api/codex/account')return Response.json({state:'hold',authenticated:false,quota:'unknown',toolHealth:'unverified',reason:'Offline test fixture'});
  if(p.startsWith('/api/'))return Response.json({});
  const decoded=decodeURIComponent(p);if(decoded.includes('..'))return new Response('forbidden',{status:403});
  const file=join(root,'public',decoded==='/'?'index.html':decoded.slice(1));return existsSync(file)?new Response(Bun.file(file)):new Response('not found',{status:404});
 }});process.on('SIGTERM',()=>{server.stop(true);process.exit(0);});
}else{
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const tmp=mkdtempSync(join(tmpdir(),'crew-coffee-ui-')),data=join(tmp,'data'),home=join(tmp,'home'),shots=join(root,'tests/out/beginner-coffee-kit');for(const p of[data,home,shots])mkdirSync(p,{recursive:true});
 const port=await freePort(),base=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,BUN_OPTIONS:process.env.BUN_OPTIONS,CREW_TEST_ENV_ISOLATED:process.env.CREW_TEST_ENV_ISOLATED,HOME:home,TMPDIR:tmp,CREW_DATA:data,CREW_PORT:String(port)};
 const app=spawn('bun',[fileURLToPath(import.meta.url),'--fixture-server'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let logs='';app.stdout.on('data',b=>logs+=b);app.stderr.on('data',b=>logs+=b);
 let persistent,browser,passed=0;const checks=[],errors=[];const ok=(value,name)=>{if(!value)throw new Error(name);passed++;checks.push(name);console.log('PASS '+name);};
 try{
  const controls=async(page,tag)=>{
   const card=page.locator('[data-scard][data-card-status="open"]').first();
   ok(await card.evaluate(el=>[...el.querySelectorAll('button,a.btn,input,textarea')].filter(e=>e.getBoundingClientRect().width>0).every(e=>e.getBoundingClientRect().height>=44)),`human controls and feedback targets >=44px ${tag}`);
   const first=card.locator('button,a.btn,input,textarea').first();await first.focus();await page.keyboard.press('Tab');
   ok(await card.evaluate(el=>el.contains(document.activeElement)&&document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle!=='none'),`keyboard focus remains visible on actual captain controls ${tag}`);
  };
  const actionsCapture=async(page,tag)=>{
   const dismiss=page.locator('[data-new-card-dismiss]');if(await dismiss.count())await dismiss.click();
   const cardId=await page.locator('[data-scard][data-card-status="open"]').first().getAttribute('data-scard');
   // Live run updates replace cards. Resolve, scroll and measure the same DOM revision.
   await page.waitForFunction(id=>{
    const card=[...document.querySelectorAll('[data-scard][data-card-status="open"]')].find(el=>el.dataset.scard===id),actions=card?[...card.querySelectorAll('[data-option]')]:[];
    if(!actions.length)return false;
    actions.at(-1).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    return actions.every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;});
   },cardId);
   ok(true,`actual captain action region fits viewport ${tag}`);
   await page.screenshot({path:join(shots,tag+'.png'),fullPage:true});
  };
  await waitUp(base,app);
  // One browser launch, private profile. Chromium's own sandbox stays enabled.
  persistent=await chromium.launchPersistentContext(join(tmp,'browser-profile'),{headless:true,chromiumSandbox:true,timeout:20000});browser=withSession(persistent.browser(),base,'coffee-ui-fixture');
  for(const width of[320,390,1440])for(const language of['en','zh-TW','zh-CN'])for(const theme of['light','dark']){
   const tag=`${width}-${language}-${theme}`,ctx=await browser.newContext({viewport:{width,height:960},colorScheme:theme});
   await ctx.addInitScript(({language,theme})=>{localStorage.setItem('crew.lang',language);localStorage.setItem('crew.theme',theme);},{language,theme});
   await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(tag+': '+e.stack));
   await page.goto(base+'/#/workflows/coffee-kit');await page.waitForSelector('[data-coffee-guide]');
   ok(await page.locator('[data-coffee-guide] h1').isVisible(),`guided coffee entry replaces mandatory graph ${tag}`);
   ok(await page.locator('[data-coffee-guide]').evaluate(el=>document.documentElement.scrollWidth<=innerWidth&&[...el.querySelectorAll('button,.btn')].every(b=>b.getBoundingClientRect().height>=44)),`guide fits phone and action targets ${tag}`);
   await page.locator('[data-coffee-project]').fill('ui-coffee-project');await page.locator('[data-coffee-guide] input:not([data-coffee-project])').fill(`Coffee ${tag}`);await page.locator('[data-coffee-guide] textarea').first().fill('A warm coffee-shop introduction. Do not invent opening hours.');
   await page.screenshot({path:join(shots,tag+'-guide.png'),fullPage:true});
   const beforeDiscuss=(await ctx.request.get(base+'/api/wruns').then(r=>r.json())).runs.length;await page.locator('[data-coffee-discuss]').click();await page.waitForURL(u=>new URL(u).hash==='#/firstmate?workflow=coffee-kit&staffing=ui-coffee-project');/* d46c26b: the discussion opens with the workflow and project it is about, so staffing defaults are offered without asking again */const discussion=(await ctx.request.get(base+'/api/fixture/discussion').then(r=>r.json())).discussion;ok(['website','image','three-beat twelve-second video','responsive playback'].every(d=>discussion.text.includes(d))&&discussion.text.includes('before generating any assets')&&(await ctx.request.get(base+'/api/wruns').then(r=>r.json())).runs.length===beforeDiscuss,`conversation-first action discusses all disciplines without creating paid work ${tag}`);await page.goto(base+'/#/workflows/coffee-kit');await page.waitForSelector('[data-coffee-guide]');
   await page.locator('[data-coffee-project]').fill('ui-coffee-project');await page.locator('[data-coffee-guide] input:not([data-coffee-project])').fill(`Coffee ${tag}`);await page.locator('[data-coffee-guide] textarea').first().fill('A warm coffee-shop introduction. Do not invent opening hours.');await page.locator('[data-coffee-plan-editor]').evaluate(el=>el.open=true);await page.locator('[data-coffee-design]').fill(JSON.stringify(fixtureDesignPlan));const beforeMissing=(await ctx.request.get(base+'/api/wruns').then(r=>r.json())).runs.length;await page.locator('[data-coffee-project]').fill('unconfirmed-project');await page.locator('[data-coffee-guide] button[type=submit]').click();await page.waitForFunction(()=>{const status=document.querySelector('[data-coffee-guide] [role=status]');return status&&/Firstmate/.test(status.textContent)&&!document.querySelector('[data-coffee-guide] button[type=submit]').disabled;});ok((await ctx.request.get(base+'/api/wruns').then(r=>r.json())).runs.length===beforeMissing&&JSON.parse(await page.locator('[data-coffee-design]').inputValue()).name===fixtureDesignPlan.name,`missing staffing has actionable recovery, preserved plan and zero Task ${tag}`);await page.locator('[data-coffee-project]').fill('ui-coffee-project');await page.locator('[data-coffee-guide] button[type=submit]').click();await page.waitForURL('**/#/run/*').catch(async e=>{throw new Error(e.message+'; guide status: '+await page.locator('[data-coffee-guide] [role=status]').allTextContents());});
   await page.waitForSelector('[data-option="confirm"]');await page.locator('[data-scard]').first().evaluate(el=>el.scrollIntoView({block:'start'}));await controls(page,tag+' direction');await page.screenshot({path:join(shots,tag+'-direction.png'),fullPage:true});
   await actionsCapture(page,tag+'-direction-actions');await page.locator('[data-option="confirm"]').click();await page.waitForSelector('[data-option="image"]');
   await page.locator('[data-scard]').first().evaluate(el=>el.scrollIntoView({block:'start'}));await controls(page,tag+' review');await page.screenshot({path:join(shots,tag+'-review.png'),fullPage:true});
   const previewPromise=ctx.waitForEvent('page');await page.locator('[data-card-link]').first().click();const preview=await previewPromise;
   await preview.waitForSelector('iframe.a3-iframe');await preview.frameLocator('iframe.a3-iframe').getByRole('heading',{name:'A quieter coffee moment'}).waitFor();
   ok(await preview.frameLocator('iframe.a3-iframe').locator('video').getAttribute('src')==='assets/coffee.mp4',`real artifact destination embeds versioned media ${tag}`);
   if(!process.argv.includes('--controls-control'))ok(await preview.locator('[data-native-preview]').count()===1&&await preview.locator('.a3-prov,[data-native-preview] button:not([data-native-film-toggle])').count()===0&&await preview.locator('[data-native-film-toggle]').count()===1&&await preview.getByRole('link',{name:/Return to Task|返回任務|返回任务/}).count()===1,`native preview returns to bound Task without generic approval or provider ${tag}`);await preview.screenshot({path:join(shots,tag+'-preview.png'),fullPage:true});await preview.close();
   const rid=new URL(page.url()).hash.split('/').at(-1),first=await ctx.request.get(base+'/api/wruns/'+rid).then(r=>r.json());
   ok(first.ledgerOk&&first.cards.some(c=>c.node==='review'&&c.status==='open'),`actual engine bundle review reached ${tag}`);
   // Use the actual captain card HTTP API for targeted revision; the UI renders its new card.
   const card=first.cards.find(c=>c.node==='review'&&c.status==='open');
   await page.locator('[data-note-for="image"]').fill('Use softer light');await actionsCapture(page,tag+'-refine-feedback');await page.locator('[data-option="image"]').click();ok(true,`targeted revision uses actual note and card action ${tag}`);
   let revised,offer;const refineDeadline=Date.now()+30000;while(Date.now()<refineDeadline){revised=await ctx.request.get(base+'/api/wruns/'+rid).then(r=>r.json());offer=revised.cards.find(c=>c.node==='review'&&c.status==='open'&&c.id!==card.id);if(offer&&revised.ledger.some(e=>e.record==='coffee-offer-v1'&&e.data.card===offer.id))break;offer=null;await new Promise(resolve=>setTimeout(resolve,50));}if(!offer)throw new Error('No durable refined native offer: '+JSON.stringify(revised));
   await page.waitForSelector(`[data-scard="${offer.id}"]`);await page.locator(`[data-scard="${offer.id}"]`).evaluate(el=>el.scrollIntoView({block:'start'}));await controls(page,tag+' refined');await page.screenshot({path:join(shots,tag+'-refined.png'),fullPage:true});
   await actionsCapture(page,tag+'-refined-actions');await page.locator('[data-option="approve"]').click();ok(true,`whole website approval uses actual card action ${tag}`);
   const doneDeadline=Date.now()+30000;let done;while(Date.now()<doneDeadline){done=await ctx.request.get(base+'/api/wruns/'+rid).then(r=>r.json());if(done.status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,50));}if(done?.status!=='succeeded')throw new Error('Native Task did not reach Done: '+JSON.stringify(done));
   await page.waitForSelector('[data-run-status="succeeded"]');await page.locator('[data-run-status="succeeded"]').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:join(shots,tag+'-done.png'),fullPage:true});
   ok((await ctx.request.get(base+'/api/wruns/'+rid).then(r=>r.json())).ctx.library.version===2,`actual native Done keeps refined bundle v2 ${tag}`);
   await page.goto(base+'/#/workflows/coffee-kit/advanced');await page.waitForSelector('svg.rt-graph');ok(await page.locator('svg.rt-graph').isVisible(),`Advanced graph remains available ${tag}`);await page.screenshot({path:join(shots,tag+'-advanced.png'),fullPage:true});
   const disable=await ctx.request.post(base+'/api/fixture/render',{data:{available:false}});if(!disable.ok()||(await disable.json()).configured!==false)throw new Error('Fixture renderer disable refused');
   await page.goto(base+'/#/workflows/coffee-kit');await page.waitForSelector('[data-coffee-guide]');
   await page.locator('[data-coffee-project]').fill('ui-coffee-project');await page.locator('[data-coffee-guide] input:not([data-coffee-project])').fill(`Hold ${tag}`);await page.locator('[data-coffee-guide] textarea').first().fill('Coffee preview with unavailable renderer');await page.locator('[data-coffee-plan-editor]').evaluate(el=>el.open=true);await page.locator('[data-coffee-design]').fill(JSON.stringify(fixtureDesignPlan));await page.locator('[data-coffee-guide] button[type=submit]').click();
   await page.waitForURL('**/#/run/*').catch(async e=>{throw new Error(e.message+'; guide status: '+await page.locator('[data-coffee-guide] [role=status]').allTextContents());});await page.waitForSelector('[data-option="confirm"]');await page.locator('[data-scard]').first().evaluate(el=>el.scrollIntoView({block:'start'}));await controls(page,tag+' direction-hold');await page.screenshot({path:join(shots,tag+'-direction-hold.png'),fullPage:true});
   await page.locator('[data-option="confirm"]').click();await page.waitForSelector('[data-option="close"]');
   const holdId=new URL(page.url()).hash.split('/').at(-1);
   let held,heldCard;const deadline=Date.now()+30000;while(Date.now()<deadline){held=await ctx.request.get(base+'/api/wruns/'+holdId).then(r=>r.json());heldCard=held.cards.find(c=>c.node==='capability'&&c.status==='open');if(heldCard)break;await new Promise(resolve=>setTimeout(resolve,50));}if(!heldCard)throw new Error('Missing actual capability card: '+JSON.stringify(held));await page.waitForSelector(`[data-scard="${heldCard.id}"]`);
   ok(heldCard.links.length===2&&heldCard.options.every(o=>o.id==='close')&&!held.ctx.library,`real missing renderer card keeps previews and refuses whole-site approval ${tag}`);
   await page.locator(`[data-scard="${heldCard.id}"]`).evaluate(el=>el.scrollIntoView({block:'start'}));await controls(page,tag+' capability');await page.screenshot({path:join(shots,tag+'-capability.png'),fullPage:true});await actionsCapture(page,tag+'-capability-actions');await page.locator('[data-option="close"]').click();
   await ctx.request.post(base+'/api/fixture/render',{data:{available:true}});
   await ctx.close();
  }
  ok(!errors.length,'interactive matrix has no browser errors: '+errors.join('; '));
 }finally{await persistent?.close();app.kill('SIGTERM');await new Promise(resolve=>app.exitCode!==null?resolve():app.once('exit',resolve));writeFileSync(join(shots,'server.log'),logs);writeFileSync(join(shots,'evidence.json'),JSON.stringify({passed,checks,errors,media:'explicit offline adapter fixtures; not real movie/playback proof',profile:join(tmp,'browser-profile')},null,2));}
 console.log(`beginner-coffee-kit-ui: ${passed} passed, 0 failed`);
}
