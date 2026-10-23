import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The startup competition on the real run page (public/runtime.js + public/scard.js through createRuntime's
// /api/wruns routes): the run's output is the signed competition write-up (kind 'doc', opened in the review page,
// never "Website output" / a new tab) whose review page shows the text (doc.md + doc.html; a legacy md-only version is
// rendered on the fly without writing to it) and exports, the acceptance card renders the model's markdown as text-node DOM with
// no model-authored links, and once the ledger stops verifying the output disappears and the card says why.
//   bun tests/startup-run-output-ui.mjs        (PLAYWRIGHT_MODULE points at playwright/index.mjs)
import{mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{createM3}from'../src/m3.ts';import{createDocs}from'../src/docs.ts';import{createRuntime}from'../src/runtime/index.ts';import{Agents}from'../src/agent.ts';import{StudioLog}from'../src/rawlog.ts';
process.env.CREW_EXAMPLE_WORKFLOWS='1'; // the startup competition is an example: seeded only when asked (src/runtime/defs.ts)
const data=mkdtempSync(join(tmpdir(),'startup-run-output-ui-'));let port=0;
const m3=createM3({dataDir:data,fileAllow:[data],studioUrl:()=>`http://127.0.0.1:${port}`,provider:()=>{throw new Error('No provider calls')},send(){},allowDrive:()=>true,session:()=>'fixture-session'});
const agents=new Agents(data,()=>'');
let logins={};
const runtime=createRuntime({providerLogins:async()=>logins,dataDir:data,agents,provider:()=>{throw new Error('No paid model')},defaultProvider:()=>({provider:'stub',model:null}),log:new StudioLog(join(data,'events')),send(){},fmRoot:data,m3,fileorg:{},docs:{}});const E=runtime.engine;
const EVIL='<img src=x onerror="window.__x=1"> [click](javascript:window.__x=2) https://evil.example/ #/settings';
const proposal=(n)=>`## Round ${n} proposal\n\n**Harbor Insights** is a research service for independent coffee shops.\n\n- Five **paid** pilots before any growth spend\n- Monthly report at \`US$49\`\n\n| Metric | Target |\n|---|---|\n| Pilots | 5 |\n| Churn | < 10% |\n\n${EVIL}`;
E.deps.provider=(id='codex',model='fixture-model')=>({id,model,sandboxFree:true,start(_s,_t,ctx){return{interrupt(){},async *send(text){const judge=text.includes('Role: judge'),round=Number(/round: (\d)/.exec(text)[1]);
 const payload=judge?{text:`### Critique ${round}\n\nWillingness to pay is **untested**.\n\n1. Run five paid pilots\n2. Report churn`,score:60+round*10,verdict:round===2?'ready':'revise'}:{text:proposal(round),revision:round===1?'':`Answered critique ${round-1}: **five paid pilots** are now the first step.`};
 yield{type:'toolStart',id:'submit',name:'startup_submit',args:payload};const result=await agents.callTool(ctx.token,'startup_submit',payload);if(result.error)throw new Error(JSON.stringify(result));yield{type:'toolEnd',id:'submit',result:JSON.stringify(result)};yield{type:'turnEnd',status:'ok'};}};}});
const wait=async(fn)=>{for(let i=0;i<500;i++){if(fn())return;await Bun.sleep(20);}throw new Error('fixture wait timed out');};
const task=E.start({workflow:'startup-recursion',text:'Fixture only: coffee startup competition.',params:{founderModel:'fixture-claude',judgeModel:'fixture-codex'}});
await wait(()=>E.cards.list({run:task.id,open:true}).length===1);await E.answer(E.cards.list({run:task.id,open:true})[0].id,{choice:'template',by:'fixture captain'});
await wait(()=>E.cards.list({run:task.id,open:true}).some(c=>c.node==='accept'));
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const url=new URL(req.url),p=url.pathname;if(p==='/api/session')return Response.json({session:true});if(p==='/api/stream')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(': fixture\n\n'));}}),{headers:{'content-type':'text/event-stream'}});if(p==='/api/intents')return Response.json([]);if(p==='/api/doctor')return Response.json({items:[]});if(p==='/api/improve')return Response.json({edits:[],reports:[]});if(p==='/api/changes')return Response.json({changes:[],projects:[]});if(p==='/api/packs')return Response.json({drafts:[],packs:[]});if(p==='/api/flows')return Response.json([]);if(p==='/api/docs')return Response.json({docs:[]});if(p==='/api/skins')return Response.json({skins:[]});if(p==='/api/claude/native/status')return Response.json({provider:'claude',support:'unsupported',auth:'unverified',quota:'unknown',models:[]});if(p==='/api/settings')return Response.json({provider:'stub',model:'offline'});if(p==='/api/summary')return Response.json({tasks:[],pending:[],crew:[],github:null,board:null,flow:null,events:0,state:data});if(p==='/api/types')return Response.json([]);if(p==='/api/me'||p==='/api/remote/me')return Response.json({kind:'desktop'});if(p==='/api/main')return Response.json({state:'detached',context:'studio',busy:false,log:[],queue:[],approvals:[],driver:{holder:'none'},project:data});if(p==='/api/github/status')return Response.json({enabled:false});const art=await m3.handle(new Request(req,{headers:(()=>{const h=new Headers(req.headers);h.set('x-crew-session','fixture-session');return h;})()}),url,{kind:'desktop'},req.method!=='GET');if(art)return art;const nativeUrl=new URL(url);if(nativeUrl.pathname.startsWith('/api/tasks'))nativeUrl.pathname=nativeUrl.pathname.replace('/api/tasks','/api/wruns');const rt=await runtime.handle(req,nativeUrl,{kind:'desktop'},req.method!=='GET');if(rt)return rt;const f=join(import.meta.dir,'../public',p==='/'?'index.html':p.slice(1));if(!p.includes('..')&&existsSync(f))return new Response(Bun.file(f));return Response.json({error:'fixture route not found'},{status:404});}});port=server.port;
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch();let pass=0,fail=0;const ok=(v,n,extra='')=>{if(v){console.log('ok '+n);pass++;}else{console.log('FAIL '+n+' '+extra);fail++;}};
const out=join(import.meta.dir,'out/startup-run-output');mkdirSync(out,{recursive:true});
const view=async()=>(await runtime.handle(new Request(`http://fixture/api/wruns/${task.id}`),new URL(`http://fixture/api/wruns/${task.id}`),{kind:'desktop'},false)).json();
try{
 const pin=E.trusted(task.id).entries.find(e=>e.record==='startup-artifact').data;
 const r=await view();ok(r.outputs.length===1&&r.outputs[0].kind==='doc'&&r.outputs[0].label==='competition'&&r.outputs[0].href===`#/review/${pin.artifact}/${pin.version}`,'run view lists the signed competition write-up as a doc output',JSON.stringify(r.outputs));
 for(const [width,theme,language] of [[1280,'light','en'],[390,'dark','zh-TW']]){
  const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:theme});await ctx.addInitScript(({language,theme})=>{localStorage.setItem('crew.lang',language);localStorage.setItem('crew.theme',theme);},{language,theme});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${port}/#/run/${task.id}`);await page.waitForSelector('[data-open-task-doc]');await page.waitForSelector('[data-competition-round]');
  const tag=`${width}-${theme}-${language}`,zh=language==='zh-TW';
  const doc=page.locator('[data-open-task-doc]');ok(await doc.getAttribute('href')===`#/review/${pin.artifact}/${pin.version}`&&await doc.getAttribute('target')===null,`${tag}: the doc output opens the review page in place`);
  const outText=await page.locator('[data-task-outputs]').innerText();ok(outText.includes(zh?'比賽全文':'Competition write-up')&&!/Website output|網站產物|new tab|新分頁/.test(outText)&&await page.locator('[data-open-task-website]').count()===0,`${tag}: labelled as the competition write-up, not a website`,outText);
  const card=page.locator('[data-card-root]').filter({has:page.locator('[data-competition-round]')});
  ok(await card.locator('[data-round-founder="2"][open] .cc-md table').count()===1&&await card.locator('[data-round-founder="2"] .cc-md strong').count()>=3&&await card.locator('[data-round-founder="2"] .cc-md ul li').count()===2&&await card.locator('[data-round-founder="1"]').evaluate(d=>!d.open)&&await card.locator('[data-round-founder="2"] [role=heading]').count()===1,`${tag}: the open proposal renders markdown as headings, bold, list and table`);
  ok(await card.locator('.cc-pre').count()===0&&await card.locator('.rt-card-body').count()===0,`${tag}: no monospace box and no duplicate card text`);
  ok(await card.locator('a').evaluateAll(as=>as.map(a=>a.getAttribute('href')))+''===`#/review/${pin.artifact}/${pin.version}`,`${tag}: one link on the card, to the pinned artifact (no model-authored anchors, no second button)`,String(await card.locator('a').evaluateAll(as=>as.map(a=>a.getAttribute('href')))));
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&window.__x===undefined&&!document.querySelector('[data-card-root] img')),`${tag}: no horizontal page scroll and hostile model text stays text`);
  await page.screenshot({path:join(out,`run-${tag}.png`),fullPage:true});
  ok(errors.length===0,`${tag}: no page errors`,errors.join('; '));await ctx.close();
 }
 // the board start form: the founder and judge providers are choices (empty keeps Claude founder, Codex judge)
 for(const language of ['en','zh-TW']){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});await ctx.addInitScript(language=>localStorage.setItem('crew.lang',language),language);
  const page=await ctx.newPage(),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/wruns'))posts.push(r.postDataJSON());});
  await page.goto(`http://127.0.0.1:${port}/#/runs`);await page.locator('[data-run-wf] option[value="startup-recursion"]').waitFor({state:'attached'});await page.selectOption('[data-run-wf]','startup-recursion');
  const founder=page.locator('[data-run-param="founderProvider"]'),judge=page.locator('[data-run-param="judgeProvider"]');await founder.waitFor();
  const options=async l=>l.locator('option').evaluateAll(os=>os.map(o=>`${o.value}=${o.textContent}`).join(','));const zh=language==='zh-TW',dflt=zh?'預設':'Default';
  ok(await founder.evaluate(e=>e.tagName)==='SELECT'&&await options(founder)===`=${dflt},claude=claude,codex=codex,cursor=cursor`&&await options(judge)===`=${dflt},claude=claude,codex=codex,cursor=cursor`&&await founder.inputValue()===''&&await judge.inputValue()==='',`${language}: the start form offers the founder and judge provider as choices, empty by default`,await options(founder));
  const form=await page.locator('.rt-start').innerText();ok(zh?form.includes('創業者使用的廠商（預設 Claude）')&&form.includes('評審使用的廠商（預設 Codex）'):form.includes('Founder provider (default Claude)')&&form.includes('Judge provider (default Codex)'),`${language}: the choices are labelled in the captain's language`,form.slice(0,400));
  await page.selectOption('[data-run-param="founderProvider"]','cursor');await page.selectOption('[data-run-param="judgeProvider"]','cursor');await page.fill('[data-run-text]','Fixture only: startup competition on Cursor.');await page.click('[data-run-start]');
  for(let i=0;i<100&&!posts.length;i++)await page.waitForTimeout(50);
  ok(posts[0]?.params?.founderProvider==='cursor'&&posts[0]?.params?.judgeProvider==='cursor',`${language}: the chosen providers go with the start request`,JSON.stringify(posts));
  ok(errors.length===0,`${language}: no page errors on the start form`,errors.join('; '));await ctx.close();
 }
 // Claude and Codex not signed in while Cursor is: the start form says to move both roles to Cursor and offers it
 const startOptions=async()=>(await runtime.handle(new Request('http://fixture/api/wruns/start-options?workflow=startup-recursion'),new URL('http://fixture/api/wruns/start-options?workflow=startup-recursion'),{kind:'desktop'},false)).json();
 ok(!('providerAdvice' in await startOptions()),'start options carry no Cursor advice while no vendor is signed in');
 logins={claude:'not-logged-in',codex:'not-logged-in',cursor:'logged-in'};
 ok(JSON.stringify((await startOptions()).providerAdvice?.params)==='["founderProvider","judgeProvider"]','start options name both provider params when only Cursor is signed in');
 for(const language of ['en','zh-TW']){
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});await ctx.addInitScript(language=>localStorage.setItem('crew.lang',language),language);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const zh=language==='zh-TW';
  await page.goto(`http://127.0.0.1:${port}/#/runs`);await page.locator('[data-run-wf] option[value="startup-recursion"]').waitFor({state:'attached'});await page.selectOption('[data-run-wf]','startup-recursion');
  const notice=page.locator('[data-run-provider-advice="startup_use_cursor"]');await notice.waitFor({timeout:8000}).catch(()=>{});const text=await notice.count()?await notice.innerText():'';
  ok(zh?text.includes('尚未登入 Claude 與 Codex')&&text.includes('改用 Cursor'):text.includes('Claude and Codex are not signed in')&&text.includes('Set founderProvider and judgeProvider to cursor')&&text.includes('Use Cursor'),`${language}: the start form says to set both providers to Cursor`,text);
  if(text){await page.click('[data-run-provider-cursor]');ok(await page.locator('[data-run-param="founderProvider"]').inputValue()==='cursor'&&await page.locator('[data-run-param="judgeProvider"]').inputValue()==='cursor'&&await notice.count()===0,`${language}: Use Cursor sets both choices and the notice goes away`);}
  ok(errors.length===0,`${language}: no page errors with the Cursor advice`,errors.join('; '));await ctx.close();
 }
 logins={};
 // the review page the card and the run page open: the write-up is shown (not blank), the header names the Task, and
 // export works; a legacy version holding only competition.md (sha-pinned) renders on the fly and is left byte-identical
 const legacyDir=join(data,'legacy-src');mkdirSync(legacyDir,{recursive:true});writeFileSync(join(legacyDir,'competition.md'),'# 創業比賽：提案、銳評與修訂\n\nLEGACY-COMPETITION text from an older run.\n');
 m3.store.create({id:'startup-r-legacy',title:'Legacy competition',type:'doc',source:'md',entry:'competition.md',project:'startup-recursion'});const lv=m3.store.addVersion('startup-r-legacy',{from:legacyDir,primary:'competition.md',createdBy:{kind:'agent',run:'R-900'},source:{run:'R-900'},status:'in-review'});
 for(const [id,n,want,run] of [[pin.artifact,pin.version,'Harbor Insights',task.id],['startup-r-legacy',lv.n,'LEGACY-COMPETITION','R-900']]){
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],bad=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/af/'))bad.push(`${r.status()} ${r.url()}`);});
  await page.goto(`http://127.0.0.1:${port}/#/review/${id}/${n}`);await page.waitForSelector('iframe');
  const frame=page.frameLocator('iframe').first();let text='';try{await frame.locator('body').waitFor({timeout:8000});text=await frame.locator('body').innerText();}catch{}
  ok(text.includes(want),`${id}: the review page shows the write-up text, not a blank frame`,text.slice(0,120)+' '+bad.join(' '));
  const head=await page.locator('.phead, main').first().innerText();ok(!head.includes('undefined')&&head.includes(run),`${id}: the review header names the Task, never "undefined"`,head.slice(0,200));
  const buttons=(await page.locator('main button, main a.btn').allInnerTexts()).join(' | ');ok(!/Approve|Request changes|核准|要求修改/.test(buttons)&&(await page.locator('[data-native-reason]').innerText()).includes("accepted only on its Task's accept card"),`${id}: review-only: no Approve / Request changes, and it says to use the accept card`,buttons);
  ok(bad.length===0&&errors.length===0,`${id}: the artifact page itself loads (no /af 404) and no page error`,bad.concat(errors).join('; '));
  await page.screenshot({path:join(out,`review-${id}.png`),fullPage:false});await page.close();
 }
 ok(m3.store.file('startup-r-legacy',lv.n,'doc.html')===null&&m3.store.verify('startup-r-legacy',lv.n).length===0&&m3.store.version('startup-r-legacy',lv.n).sha256===lv.sha256,'the legacy version is rendered on the fly: no file written, its pin still matches');
 ok(m3.store.file(pin.artifact,pin.version,'doc.md')&&m3.store.file(pin.artifact,pin.version,'doc.html')&&E.cards.view(E.cards.list({run:task.id,open:true}).find(c=>c.node==='accept')).competition.artifact.intact===true,'a new startup version carries doc.md and doc.html and stays intact after review');
 // approval outside the accept card is refused for new and legacy versions; export stays open
 for(const [id,n] of [[pin.artifact,pin.version],['startup-r-legacy',lv.n]]){
  const ua=new URL(`http://127.0.0.1:${port}/api/artifacts/${id}/v/${n}/approve`);const r1=await m3.handle(new Request(ua,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),ua,{kind:'desktop'},true);const j1=await r1.json();
  ok(r1.status===403&&j1.errorZh?.includes('驗收卡')&&m3.store.version(id,n).status==='in-review',`${id}: the artifact approve route refuses it (403, en/zh-TW reason) and the version stays in review`,`${r1.status} ${JSON.stringify(j1)}`);
 }
 const docs=createDocs({dataDir:data,store:m3.store,agents,skills:{},log:new StudioLog(join(data,'events')),provider:()=>{throw new Error('No paid model')},send(){}});
 for(const [id,n] of [[pin.artifact,pin.version],['startup-r-legacy',lv.n]]){const u=new URL(`http://fixture/api/docs/${id}/v/${n}/approve`);const res=await docs.handle(new Request(u,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),u,{kind:'desktop'},true);const j=await res.json();
  ok(res.status===409&&j.code==='startup-accept-card-only'&&j.error.includes('accept card')&&j.errorZh.includes('驗收卡')&&m3.store.version(id,n).status==='in-review',`${id}: the docs approve route refuses it (409, en/zh-TW reason pointing to the accept card)`,`${res.status} ${JSON.stringify(j)}`);}
 for(const [id,n,want] of [[pin.artifact,pin.version,'Harbor Insights'],['startup-r-legacy',lv.n,'LEGACY-COMPETITION']])for(const format of ['md','html']){const u=new URL(`http://fixture/api/docs/${id}/v/${n}/export?format=${format}`);const res=await docs.handle(new Request(u),u,{kind:'desktop'},false);const body=res?await res.text():'';ok(res?.status===200&&body.includes(want),`${id}: export as ${format} carries the write-up`,`${res?.status} ${body.slice(0,80)}`);}
 // the ledger stops verifying: no output on the run page, and the card says the rounds cannot be shown
 const lf=join(data,'evidence',task.id,'ledger.jsonl'),lines=readFileSync(lf,'utf8').split('\n'),i=lines.findIndex(l=>l.includes('"record":"startup-round"'));lines[i]=lines[i].replace('Harbor Insights','Tampered Insights');writeFileSync(lf,lines.join('\n'));
 const t=await view();ok(t.ledgerOk===false&&t.outputs.length===0,'a ledger that does not verify lists no startup output',JSON.stringify(t.outputs));
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(`http://127.0.0.1:${port}/#/run/${task.id}`);await page.waitForSelector('[data-competition-untrusted]');
 ok((await page.locator('[data-competition-untrusted]').innerText()).includes('Ledger did not verify')&&await page.locator('[data-competition-round]').count()===0&&await page.locator('[data-task-outputs]').count()===0,'the card says the ledger did not verify and shows no rounds');
 await page.screenshot({path:join(out,'run-untrusted-1280-light-en.png'),fullPage:true});
 console.log(`startup-run-output-ui: ${pass} passed, ${fail} failed`);if(fail)process.exitCode=1;
}finally{await browser.close();server.stop(true);E.stop?.();}
