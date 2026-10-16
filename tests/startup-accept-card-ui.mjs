import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The startup competition acceptance card in the real shared card component (public/scard.js):
// every round's proposal, critique, score and verdict, and the link to the pinned artifact.
// Readable for a live demo: rounds, proposals and critiques fold (only the last round and its proposal open),
// nothing scrolls inside a box, model markdown becomes text-node DOM (no model-authored links), one button to
// the artifact, no repeated card text. A ledger that does not verify says so. A card raised before the fix
// (empty body, in-app #/review link only) still shows its link and summary.
import {readFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});let pass=0;
const ok=(v,m)=>{if(!v)throw new Error('FAIL '+m);console.log('PASS '+m);pass++;};
const MD=n=>`FOUNDER-${n} proposal text\n\n## Plan ${n}\n\n**Five paid pilots** first.\n\n- one\n- two\n\n| Metric | Target |\n|---|---|\n| Pilots | 5 |\n\n[click](javascript:window.__x=1) <img src=x onerror="window.__x=2"> https://evil.example/\n\n${'Long line of proposal text. '.repeat(600)}`;
const rounds=[1,2,3].map(n=>({round:n,founder:{provider:'claude',model:'fixture-claude',text:MD(n),revision:n>1?`REVISION-${n} answer`:''},judge:{provider:'codex',model:'fixture-codex',text:`JUDGE-${n} critique text`,score:60+n,verdict:n===3?'ready':'revise'}}));
const base={id:'SC-900',run:'R-900',node:'accept',visit:1,kind:'acceptance',workflow:'startup-recursion',status:'open',title:{en:'Review startup competition','zh-TW':'驗收創業比賽文字成果'},
 sections:{en:{intent:'Review the full proposal, critiques and revisions.',why:'Scores are model opinions.',beforeAfter:'3 rounds; latest score 63; ready',how:'',scope:{in:[],out:[]},done:[],glossary:[]},'zh-TW':{intent:'檢查完整提案。',why:'評分是模型意見。',beforeAfter:'共 3 輪；最後評分 63；判定 ready',how:'',scope:{in:[],out:[]},done:[],glossary:[]}},
 options:[{id:'accept',label:'Accept',primary:true},{id:'reject',label:'Reject',note:true,hold:true}],links:[{label:'檢視完整文字紀錄',href:'#/review/startup-r-900/1'}],detail:null,captainOnly:true};
try{const p=await browser.newPage();await p.setContent('<main id="cards"></main>');await p.addScriptTag({content:readFileSync(new URL('../public/scard.js',import.meta.url),'utf8')});
 const mount=(card)=>p.evaluate((card)=>{const root=document.querySelector('#cards');root.replaceChildren();const el=document.createElement('div');root.append(el);crewCard.mountCard(el,card,{lang:'en'});return el.innerText;},card);
 for(const width of [390,1280]){await p.setViewportSize({width,height:900});
  await mount({...base,body:'## Round 1: founder ...',competition:{schema:1,rounds,artifact:{id:'startup-r-900',version:1,sha256:'a'.repeat(64),href:'#/review/startup-r-900/1',intact:true}}});
  ok(await p.evaluate(()=>[...document.querySelectorAll('[data-competition-round]')].map(d=>d.open).join()==='false,false,true'&&[...document.querySelectorAll('[data-round-founder]')].map(d=>d.open).join()==='false,false,true'&&[...document.querySelectorAll('[data-round-judge]')].every(d=>!d.open)),`${width}: only the last round and its proposal start open; critiques fold`);
  ok(await p.evaluate(()=>[...document.querySelectorAll('[data-round-founder="3"] *')].every(e=>!(['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2))&&document.querySelector('[data-round-proposal="3"]').scrollHeight>1200),`${width}: a long proposal is not boxed in an inner scroll area; the page scrolls`);
  ok(await p.evaluate(()=>{const md=document.querySelector('[data-round-proposal="3"]');return getComputedStyle(md).fontFamily===getComputedStyle(document.body).fontFamily&&!md.closest('pre')&&md.querySelectorAll('[role=heading]').length===1&&md.querySelector('strong')?.textContent==='Five paid pilots'&&md.querySelectorAll('ul li').length===2&&md.querySelectorAll('table td').length===2&&!md.textContent.includes('**')&&!md.textContent.includes('|---');}),`${width}: the proposal renders markdown in the body font: heading, bold, list, table`);
  ok(await p.evaluate(()=>window.__x===undefined&&!document.querySelector('[data-card-root] img')&&[...document.querySelectorAll('[data-card-root] a')].map(a=>a.getAttribute('href')).join()==='#/review/startup-r-900/1'),`${width}: model text makes no element of its own and no link; the card has exactly one link, to the artifact`);
  ok(await p.locator('.rt-card-body').count()===0&&await p.locator('[data-card-link]').count()===0,`${width}: no repeated card text and no second button to the same artifact`);
  await p.evaluate(()=>document.querySelectorAll('[data-competition-round], .cc-part').forEach(d=>d.open=true));
  const text=await p.locator('[data-card-root]').innerText();
  ok(await p.locator('[data-competition-round]').count()===3,`${width}: one section per round`);
  for(const n of [1,2,3])ok(text.includes(`FOUNDER-${n} proposal text`)&&text.includes(`JUDGE-${n} critique text`)&&text.includes(`score ${60+n}`),`${width}: round ${n} shows proposal, critique and score`);
  ok(text.includes('REVISION-2 answer')&&text.includes('REVISION-3 answer'),`${width}: founder responses to critiques are shown`);
  ok(await p.locator('[data-round-verdict="ready"]').count()===1&&await p.locator('[data-round-verdict="revise"]').count()===2,`${width}: each verdict is shown`);
  ok(await p.locator('[data-competition-artifact] a').getAttribute('href')==='#/review/startup-r-900/1',`${width}: the pinned artifact is linked`);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${width}: no horizontal overflow`);
 }
 // hostile model text cannot stall or break the card: a heading padded with whitespace renders fast, and deeply
 // nested blockquotes neither overflow the stack nor drop the card
 {const hostile=(text)=>({...base,body:'',competition:{schema:1,rounds:rounds.map((r,i)=>i===2?{...r,judge:{...r.judge,text}}:r),artifact:null}});
  const t0=Date.now();let err=null;try{await mount(hostile('# a'+' '.repeat(15000)+'x'));}catch(e){err=e;}const took=Date.now()-t0;
  ok(!err&&took<1000,`a heading padded with 15000 spaces mounts in under 1 s (${took} ms)`);
  err=null;try{await mount(hostile('>'.repeat(15000)+' x'));}catch(e){err=e;}
  ok(!err&&await p.locator('[data-competition-round]').count()===3&&await p.locator('[data-option="accept"]').count()===1,'15000 nested blockquote markers neither throw nor drop the card: three rounds and Accept render',String(err?.message??'').slice(0,160));}
 // a ledger that does not verify: a clear notice, no rounds, no repeated body (en and zh-TW)
 await mount({...base,body:'## Round 1: founder FOUNDER-1 proposal text',competition:{untrusted:true}});
 ok((await p.locator('[data-competition-untrusted]').innerText()).includes('Ledger did not verify — the rounds cannot be shown')&&await p.locator('[data-competition-round]').count()===0&&!(await p.locator('[data-card-root]').innerText()).includes('FOUNDER-1'),'untrusted ledger: the card says the rounds cannot be shown, and shows none');
 await p.locator('[data-card-lang="zh-TW"]').click();ok((await p.locator('[data-competition-untrusted]').innerText()).includes('帳本驗證失敗'),'untrusted ledger notice in zh-TW');
 // a card raised before the fix: no body, no competition on the record; its in-app link and summary still render
 const old=await mount({...base,body:''});
 ok(await p.locator('[data-card-link]').getAttribute('href')==='#/review/startup-r-900/1','in-app #/ link is kept, not filtered out');
 ok(old.includes('3 rounds; latest score 63; ready'),'before/after summary of a plain card is shown');
 ok(await p.locator('[data-card-link]').innerText()==='Open the full text','a stored zh-TW link label reads in English in EN mode');
 await p.locator('[data-card-lang="zh-TW"]').click();ok(await p.locator('[data-card-link]').innerText()==='檢視完整文字','and in zh-TW in zh-TW mode');
 await mount({...base,body:'',links:[{label:'Open the full text',href:'#/review/startup-r-900/1'}]});await p.locator('[data-card-lang="zh-TW"]').click();
 ok(await p.locator('[data-card-link]').innerText()==='檢視完整文字','a new card link label is translated in zh-TW');
 console.log(`${pass} passed, 0 failed`);
}finally{await browser.close();}
