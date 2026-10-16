// The startup competition acceptance card in the real shared card component (public/scard.js):
// every round's proposal, critique, score and verdict, and the link to the pinned artifact.
// A card raised before the fix (empty body, in-app #/review link only) still shows its link and summary.
import {readFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});let pass=0;
const ok=(v,m)=>{if(!v)throw new Error('FAIL '+m);console.log('PASS '+m);pass++;};
const rounds=[1,2,3].map(n=>({round:n,founder:{provider:'claude',model:'fixture-claude',text:`FOUNDER-${n} proposal text`,revision:n>1?`REVISION-${n} answer`:''},judge:{provider:'codex',model:'fixture-codex',text:`JUDGE-${n} critique text`,score:60+n,verdict:n===3?'ready':'revise'}}));
const base={id:'SC-900',run:'R-900',node:'accept',visit:1,kind:'acceptance',workflow:'startup-recursion',status:'open',title:{en:'Review startup competition','zh-TW':'驗收創業比賽文字成果'},
 sections:{en:{intent:'Review the full proposal, critiques and revisions.',why:'Scores are model opinions.',beforeAfter:'3 rounds; latest score 63; ready',how:'',scope:{in:[],out:[]},done:[],glossary:[]},'zh-TW':{intent:'檢查完整提案。',why:'評分是模型意見。',beforeAfter:'共 3 輪；最後評分 63；判定 ready',how:'',scope:{in:[],out:[]},done:[],glossary:[]}},
 options:[{id:'accept',label:'Accept',primary:true},{id:'reject',label:'Reject',note:true,hold:true}],links:[{label:'檢視完整文字紀錄',href:'#/review/startup-r-900/1'}],detail:null,captainOnly:true};
try{const p=await browser.newPage();await p.setContent('<main id="cards"></main>');await p.addScriptTag({content:readFileSync(new URL('../public/scard.js',import.meta.url),'utf8')});
 const mount=(card)=>p.evaluate((card)=>{const root=document.querySelector('#cards');root.replaceChildren();const el=document.createElement('div');root.append(el);crewCard.mountCard(el,card,{lang:'en'});return el.innerText;},card);
 for(const width of [390,1280]){await p.setViewportSize({width,height:900});
  await mount({...base,body:'## Round 1: founder ...',competition:{schema:1,rounds,artifact:{id:'startup-r-900',version:1,sha256:'a'.repeat(64),href:'#/review/startup-r-900/1',intact:true}}});
  await p.evaluate(()=>document.querySelectorAll('[data-competition-round]').forEach(d=>d.open=true));
  const text=await p.locator('[data-card-root]').innerText();
  ok(await p.locator('[data-competition-round]').count()===3,`${width}: one section per round`);
  for(const n of [1,2,3])ok(text.includes(`FOUNDER-${n} proposal text`)&&text.includes(`JUDGE-${n} critique text`)&&text.includes(`score ${60+n}`),`${width}: round ${n} shows proposal, critique and score`);
  ok(text.includes('REVISION-2 answer')&&text.includes('REVISION-3 answer'),`${width}: founder responses to critiques are shown`);
  ok(await p.locator('[data-round-verdict="ready"]').count()===1&&await p.locator('[data-round-verdict="revise"]').count()===2,`${width}: each verdict is shown`);
  ok(await p.locator('[data-competition-artifact] a').getAttribute('href')==='#/review/startup-r-900/1',`${width}: the pinned artifact is linked`);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${width}: no horizontal overflow`);
 }
 // a card raised before the fix: no body, no competition on the record; its in-app link and summary still render
 const old=await mount({...base,body:''});
 ok(await p.locator('[data-card-link]').getAttribute('href')==='#/review/startup-r-900/1','in-app #/ link is kept, not filtered out');
 ok(old.includes('3 rounds; latest score 63; ready'),'before/after summary of a plain card is shown');
 console.log(`${pass} passed, 0 failed`);
}finally{await browser.close();}
