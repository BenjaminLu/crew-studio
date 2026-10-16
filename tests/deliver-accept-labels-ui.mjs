import './lib/isolated-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Expose the actual private label projections to this VM only. No browser or
// rendered-layout claim: this checks old persisted cards and both languages.
const source=readFileSync(new URL('../public/scard.js',import.meta.url),'utf8').replace('const api = { mountCard };','const api = { mountCard, artifactVersionLabel, artifactOptionLabel };');
const ctx={window:{}};runInNewContext(source,ctx);const api=ctx.crewCard;
runInNewContext(readFileSync(new URL('../public/vendor/opencc-js-1.4.2-t2cn.min.js',import.meta.url),'utf8'),ctx);ctx.window.OpenCC=ctx.OpenCC;runInNewContext(readFileSync(new URL('../public/i18n.js',import.meta.url),'utf8'),ctx);
let pass=0;const check=(v,m)=>{assert.ok(v,m);console.log('PASS '+m);pass++;};
const offers=['brand','menu','social'].map(producer=>({producer,id:'out-'+producer,n:1}));
const card={detail:{artifactAcceptance:{offered:offers}}};const before=JSON.stringify(card);
for(const lang of ['en','zh-TW','zh-CN']){
 const T=(en,zh)=>ctx.window.crewI18n.pick(lang,en,zh);
 const labels=offers.map(r=>api.artifactOptionLabel(card,{id:'approve-'+r.producer,label:'Approve v1',labelZh:'核准版本 1'},T));
 const links=offers.map(r=>api.artifactVersionLabel(r,true,T));
 check(new Set(labels).size===3&&offers.every((r,i)=>labels[i].includes(r.producer)),'old stored generic options gain distinct '+lang+' producer labels');
 check(new Set(links).size===3&&offers.every((r,i)=>links[i].includes(r.producer)),'multi-output links are distinct in '+lang);
 check(api.artifactOptionLabel(card,{id:'changes',label:'Request changes',labelZh:'要求修改'},T)===T('Request changes','要求修改'),'changes choice remains unchanged in '+lang);
 check(api.artifactOptionLabel({detail:{artifactAcceptance:{offered:[offers[0]]}}},{id:'approve-brand',label:'Approve v1',labelZh:'核准版本 1'},T)===T('Approve v1','核准版本 1'),'single-output option compatibility '+lang);
 check(api.artifactVersionLabel(offers[0],false,T)===T('Version 1','版本 1'),'single-output link compatibility '+lang);
 check(api.artifactVersionLabel({producer:'design-a',n:1},true,T)===T('Direction A · v1','方向 A · 版本 1'),'design direction label compatibility '+lang);
}
const unusual={detail:{artifactAcceptance:{offered:['design-one','design-three'].map(producer=>({producer,id:producer,n:1}))}}};
for(const zh of [false,true]){
 const T=(en,tw)=>zh?tw:en;
 const labels=unusual.detail.artifactAcceptance.offered.map(r=>api.artifactOptionLabel(unusual,{id:'approve-'+r.producer,label:'Approve direction E v1'},T));
 const links=unusual.detail.artifactAcceptance.offered.map(r=>api.artifactVersionLabel(r,true,T));
 check(new Set(labels).size===2&&labels.every((s,i)=>s.includes(unusual.detail.artifactAcceptance.offered[i].producer)),'non-letter design producer approval identity '+zh);
 check(new Set(links).size===2&&links.every((s,i)=>s.includes(unusual.detail.artifactAcceptance.offered[i].producer)),'non-letter design producer link identity '+zh);
 check(api.artifactOptionLabel(card,{id:'approve-foreign',label:'Custom action',labelZh:'自訂操作'},T)===T('Custom action','自訂操作'),'unmatched option is not rebound to an offer '+zh);
}
const hostile={producer:'<img src=x onerror=alert(1)>',n:1};check(api.artifactVersionLabel(hostile,true,(en)=>en).includes(hostile.producer),'producer remains literal label data (DOM insertion uses text nodes)');
check(JSON.stringify(card)===before,'projection does not rewrite persisted offers or approval ids');
console.log(`deliver-accept-labels-ui: ${pass} passed, 0 failed`);
