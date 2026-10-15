/* Guided tour of the real Studio controls. No duplicate form or task submission. */
(() => {
  const KEY = 'crew.onboarding.spotlight.v1';
  let active = null, epoch = 0, checked = false, remembered = false;
  const tr = (en, zh) => T(en, zh);
  const done = () => { try { return remembered || !!store.get(KEY, ''); } catch { return remembered; } };
  const remember = value => { remembered = true; try { store.set(KEY, value); } catch {} };
  const steps = () => [
    {route:'doctor',target:'[data-codex-account]',title:tr('Check your model','確認模型'),text:tr('Use these account controls to sign in. Refresh the capability check below to confirm Codex can accept a task. This does not start a conversation.','在反白區域登入帳號，再按下方「檢查可用性」確認 Codex 能接收任務。檢查不會啟動對話。')},
    {route:'gates',target:'[data-onboarding-projects]',title:tr('Review your workspace','確認工作區與專案'),text:tr('Review or register your local projects here. A first image can use Studio’s managed sandbox without a repository. Registering a project does not select it for every task.','在這裡確認或新增本機專案。第一張圖片可直接使用 Studio 管理的沙箱，不需要 repo；登錄專案不代表所有任務都會使用它。')},
    {route:'runs',target:'.rt-start',title:tr('Start your first task','開始第一個任務'),text:tr('Try generating an image of a cute puppy. An empty form is filled with this idea, Images and Codex; an existing draft is preserved. Edit it if you like, then press Start. Finishing the tour does not submit the task.','試試「產生一張可愛小狗的圖片」。空白表單會預填此任務，並選好 Images 與 Codex；已有草稿則保留。你可以修改後按「開始」。「完成導覽」不會送出任務。')}
  ];
  function stop(result) {
    const s=active;if(!s)return;active=null;epoch++;remember(result);
    s.observer.disconnect();cancelAnimationFrame(s.frame);s.root.remove();
    s.main.style.maxHeight=s.oldMaxHeight;s.main.style.overflow=s.oldOverflow;
    removeEventListener('resize',s.schedule);document.removeEventListener('scroll',s.schedule,true);
    document.removeEventListener('keydown',s.key);
    if(s.trigger?.isConnected)s.trigger.focus();
  }
  function position(s) {
    if(active!==s)return;
    const step=steps()[s.step],target=document.querySelector(step.target);
    const dock=innerWidth<900;
    if(dock){s.main.style.maxHeight=Math.max(120,innerHeight-s.panel.offsetHeight-40-s.main.getBoundingClientRect().top)+'px';s.main.style.overflow='auto';}
    else{s.main.style.maxHeight=s.oldMaxHeight;s.main.style.overflow=s.oldOverflow;}
    s.next.disabled=!target || (s.step===0 && !s.ready);
    if(!target){s.ring.hidden=true;s.panel.style.left='16px';s.panel.style.top='80px';return;}
    if(s.target!==target){s.target=target;target.scrollIntoView({block:'center',behavior:'instant'});}
    const r=target.getBoundingClientRect(),w=innerWidth,h=innerHeight,pad=6,gap=14;
    const bounds=s.main.getBoundingClientRect();
    const top=Math.max(8,bounds.top,r.top-pad),left=Math.max(8,r.left-pad),right=Math.min(w-8,r.right+pad),bottom=Math.min(h-8,bounds.bottom,r.bottom+pad);
    s.ring.hidden=bottom<=top||right<=left;
    Object.assign(s.ring.style,{top:top+'px',left:left+'px',width:Math.max(0,right-left)+'px',height:Math.max(0,bottom-top)+'px'});
    const pw=s.panel.offsetWidth,ph=s.panel.offsetHeight;
    if(dock){Object.assign(s.panel.style,{left:'12px',top:Math.max(12,h-ph-12)+'px'});return;}
    let x=right+gap,y=top;
    if(x+pw>w-12){
      if(left-pw-gap>=12)x=left-pw-gap;
      else {x=Math.min(Math.max(left,12),w-pw-12);y=bottom+gap;
        if(y+ph>h-12)y=top-ph-gap;
        if(y<12)y=h-ph-12;
      }
    }
    Object.assign(s.panel.style,{left:Math.max(12,x)+'px',top:Math.max(12,Math.min(y,h-ph-12))+'px'});
  }
  function draw(s,focus=true) {
    const step=steps()[s.step];s.target=null;
    s.panel.replaceChildren();
    s.panel.append(h('div',{class:'ob-tour-head'},h('span',{class:'faint'},tr(`Getting started · ${s.step+1}/3`,`入門導覽 · ${s.step+1}/3`)),h('button',{class:'btn ghost','data-ob-skip':'',onclick:()=>stop('skipped')},tr('Skip','跳過'))));
    s.panel.append(h('h2',{id:'ob-tour-title',tabindex:'-1'},step.title),h('p',{},step.text));
    if(s.step===0){
      s.status=h('p',{class:'ob-tour-status',role:'status'},s.checking?tr('Checking…','檢查中…'):s.ready?tr('Codex is available','Codex 可用'):tr('Verify capability to continue.','請先確認可用性。'));
      s.refresh=h('button',{class:'btn','data-ob-refresh':'',disabled:s.checking||null,onclick:()=>check(s)},tr('Check capability','檢查可用性'));
      s.panel.append(s.status,s.refresh);
    }
    s.next=h('button',{class:'btn primary','data-ob-next':'',onclick:()=>{if(s.next.disabled)return;if(s.step===2)stop('completed');else go(s,s.step+1);}},s.step===2?tr('Finish tour','完成導覽'):tr('Next','下一步'));
    s.panel.append(h('div',{class:'ob-tour-actions'},s.step?h('button',{class:'btn','data-ob-back':'',onclick:()=>go(s,s.step-1)},tr('Back','上一步')):null,s.next));
    s.schedule();if(focus)s.panel.querySelector('h2').focus({preventScroll:true});
  }
  async function check(s) {
    if(active!==s||s.checking)return;s.checking=true;s.ready=false;if(s.refresh)s.refresh.disabled=true;if(s.status)s.status.textContent=tr('Checking…','檢查中…');s.schedule();
    try {const result=await getJ('/api/codex/native/status');if(active!==s)return;s.ready=result?.state==='ready';s.message=s.ready?tr('Codex is available','Codex 可用')+' · '+result.model:tr('Not verified: ','尚未驗證：')+(result.reason||result.error||'');}
    catch {s.message=tr('Unable to check. Please retry.','無法檢查，請重試。');}
    finally {if(active===s){s.checking=false;if(s.step===0){s.status.textContent=s.message;s.refresh.disabled=false;}s.schedule();}}
  }
  function go(s,index){if(index===2&&!s.seeded){s.seeded=true;window.crewPrefillFirstTask?.();}s.step=index;const route='#/'+steps()[index].route;s.expected=route;draw(s);if(location.hash!==route)location.hash=route;else s.schedule();}
  window.crewOpenOnboarding=async function(trigger){
    const opening=epoch;let session,me;
    try{[session,me]=await Promise.all([getJ('/api/session'),getJ('/api/remote/me')]);}catch{return;}
    if(opening!==epoch||!session?.session||me?.kind!=='desktop')return;
    if(active){active.panel.focus();return;}
    checked=true;epoch++;
    const main=document.querySelector('#main');
    const s={step:0,ready:false,checking:false,trigger:trigger||document.activeElement,main,oldMaxHeight:main.style.maxHeight,oldOverflow:main.style.overflow};active=s;
    s.root=h('div',{class:'ob-tour','data-onboarding':''});s.ring=h('div',{class:'ob-tour-ring','aria-hidden':'true'});
    s.panel=h('section',{class:'ob-tour-panel',role:'region','aria-labelledby':'ob-tour-title',tabindex:'-1'});
    s.root.append(s.ring,s.panel);document.body.append(s.root);
    s.schedule=()=>{cancelAnimationFrame(s.frame);s.frame=requestAnimationFrame(()=>position(s));};
    s.observer=new MutationObserver(s.schedule);s.observer.observe(document.querySelector('#view'),{childList:true,subtree:true});
    addEventListener('resize',s.schedule);document.addEventListener('scroll',s.schedule,true);
    s.key=e=>{if(e.key==='Escape'&&!document.querySelector('.modal-back,dialog[open]')){e.preventDefault();stop('skipped');}};
    document.addEventListener('keydown',s.key);go(s,0);check(s);
  };
  const original=routes.settings;
  routes.settings=function(){const node=original.apply(this,arguments);const button=h('button',{class:'btn','data-ob-open':'',onclick:()=>window.crewOpenOnboarding(button)},tr('Open getting started guide','開啟入門導覽'));node.append(button);return node;};
  function auto(){if(!active&&!checked&&!done()&&S.route?.name==='board'){checked=true;window.crewOpenOnboarding();}}
  addEventListener('hashchange',()=>{
    epoch++;
    if(active){
      if(location.hash===active.expected){active.schedule();return;}
      // A real task navigation is the only automatic completion signal.
      stop(active.step===2&&/^#\/run\/R-\d+$/.test(location.hash)?'completed':'skipped');
    }
    setTimeout(auto,0);
  });
  addEventListener('crew:codex-account',()=>{if(active?.step===0&&!active.checking)check(active);});
  if(S.route?.name==='settings')render();
  setTimeout(auto,0);
})();
