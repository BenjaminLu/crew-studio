import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ArtifactStore,websiteHref} from '../artifacts';
import type {Engine} from '../runtime/engine';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function installHelloWeb(engine:Engine,store:ArtifactStore){
 engine.actions['hello.web']=x=>{
  const id=`hello-${x.run.id.toLowerCase()}`,heading=String(x.run.params.heading||'Hello Crew Studio').slice(0,160),dir=join(x.dir,'website');mkdirSync(dir,{recursive:true});
  if(x.ctx.deliver?.build){const old=x.ctx.deliver.build;if(!store.verify(old.id,old.n).length)return 'ok';throw Error('The generated website changed; create a fresh example.');}
  const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;color:#171a21;font:18px/1.6 system-ui,sans-serif}main{width:min(90vw,800px);padding:64px 40px;background:#fff;border:1px solid #e1e5eb;border-radius:24px;box-shadow:0 16px 64px #171a2110}small{color:#2f5bd3;font-weight:700;letter-spacing:.12em}h1{font-size:clamp(36px,7vw,64px);line-height:1.1;letter-spacing:-.04em}p{color:#475063}a{display:inline-block;padding:12px 20px;background:#2f5bd3;color:#fff;border-radius:10px;text-decoration:none}</style><main><small>YOUR FIRST WEBSITE</small><h1>${escape(heading)}</h1><p>你的第一個網頁已經準備好了。</p><p>這是內建的網頁開發起始範例：產生 HTML → 預覽網站 → 確認完成。接著可以回到流程編輯器，修改標題或加入新的步驟。</p><a href="#next">Hello, Captain!</a><p id="next">每一段旅程，都從第一個完成的作品開始。</p></main></html>`;
  writeFileSync(join(dir,'index.html'),html);if(!store.get(id))store.create({id,title:heading,type:'web',source:'file',project:'hello-crew-studio',entry:'index.html',note:'Built-in starter example; no AI model was used.'});
  const v=store.addVersion(id,{from:dir,primary:'index.html',createdBy:{kind:'host',run:x.run.id},source:{run:x.run.id},summary:'Built-in Hello Crew Studio website'});
  x.ctx.deliver={build:{id,n:v.n,sha256:v.sha256,producer:'build',format:'web'}};engine.record(x,'hello-website-created',{data:{artifact:id,version:v.n,sha256:v.sha256,generatedBy:'built-in-template'}});return 'ok';
 };
 engine.cardModes['hello-preview']={
  async start(x){const p=x.ctx.deliver?.build,v=p&&store.version(p.id,p.n);const href=p&&websiteHref(store.get(p.id),v);if(!href||store.verify(p.id,p.n).length)throw Error('Website preview is not intact');await engine.card(x,'acceptance',{captainOnly:true,title:'Your first website is ready',zhTitle:'你的第一個網頁完成了',body:'Open the website, then confirm to finish. This starter uses a built-in template, not an AI model. / 先開啟網站預覽，再確認完成；此範例由內建範本產生，沒有使用 AI 模型。',links:[{label:'Open Hello Crew Studio',href}],options:[{id:'approve',label:'Looks good — finish',labelZh:'確認完成',primary:true}]});return{wait:true};},
  answer(x,c){const p=x.ctx.deliver?.build;if(c.answer?.choice!=='approve'||!p||store.verify(p.id,p.n).length||!engine.trusted(x.run.id).ok)throw Error('The website or its approval is not valid');store.approve(p.id,p.n,c.answer.by);x.ctx.approved={artifact:p.id,version:p.n,sha256:p.sha256,by:c.answer.by};return{outcome:'approve'};}
 };
}
