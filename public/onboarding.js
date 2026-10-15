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
    if(active!==s&&journey!==s)return;
    const step=s.mode==='journey'?{target:s.targetSelector||'[data-firstmate-welcome]'}:steps()[s.step],target=document.querySelector(step.target);
    const dock=innerWidth<900;
    if(s.mode==='journey')document.documentElement.style.setProperty('--ob-journey-reserve',dock&&!document.body.classList.contains('chat-closed')?(s.panel.offsetHeight+24)+'px':'0px');
    if(dock){s.main.style.maxHeight=Math.max(120,innerHeight-s.panel.offsetHeight-40-s.main.getBoundingClientRect().top)+'px';s.main.style.overflow='auto';}
    else{s.main.style.maxHeight=s.oldMaxHeight;s.main.style.overflow=s.oldOverflow;}
    if(s.next)s.next.disabled=!target || (s.step===0 && !s.ready);
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
    if(journey)closeJourney();
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
  const JOURNEY_KEY='crew.onboarding.journey.dismissed.v1';
  let journey=null,openingJourney=false,refreshing=false,refreshAgain=false;
  const jt=(en,tw,cn)=>store.get('crew.lang','en')==='zh-CN'?(cn??tw):T(en,tw);
  function closeJourney(){const s=journey;if(!s)return;journey=null;document.documentElement.style.removeProperty('--ob-journey-reserve');s.observer.disconnect();cancelAnimationFrame(s.frame);s.root.remove();removeEventListener('resize',s.schedule);document.removeEventListener('scroll',s.schedule,true);document.removeEventListener('keydown',s.key);s.main.style.maxHeight=s.oldMaxHeight;s.main.style.overflow=s.oldOverflow;if(s.trigger?.isConnected)s.trigger.focus();}
  async function refreshJourney(){
    if(!journey)return;if(refreshing){refreshAgain=true;return;}refreshing=true;const s=journey;
    try{const[state,main]=await Promise.all([getJ('/api/onboarding'),getJ('/api/main')]);if(journey!==s)return;s.state=state;s.mainView=main;drawJourney(s);}
    catch{if(journey===s){s.status.textContent=jt('Could not read progress. Your work is preserved.','無法讀取進度；現有工作已保留。','无法读取进度；现有工作已保留。');}}
    finally{refreshing=false;if(refreshAgain){refreshAgain=false;void refreshJourney();}}
  }
  function drawJourney(s){
    const state=s.state||{},main=s.mainView,ready=main?.context==='studio'&&main.state==='attached'&&main.driver?.holder==='studio'&&!main.origin&&Array.isArray(main.log)&&main.log.some(x=>x.kind==='firstmate'&&x.text?.trim());
    const phase=!ready&&!state.task&&!state.proposal?'connect':!state.started?'choose':state.stage;
    const copy={connect:[jt('Meet your Firstmate','先認識你的 Firstmate','先认识你的 Firstmate'),jt('Use Connect on Board to sign in and start your own conversation. Wait for Firstmate’s actual greeting. Worker models and quota are confirmed separately.','使用 Board 的連接按鈕登入並開始自己的對話，等待 Firstmate 實際回覆。工作角色的模型與額度另外確認。','使用 Board 的连接按钮登录并开始自己的对话，等待 Firstmate 实际回复。工作角色的模型与额度另行确认。')],choose:[jt('What shall we make?','我們要做什麼？','我们要做什么？'),jt('Try the coffee-shop website, image and film, or discuss your own goal. Nothing starts until your real confirmation cards.','可以試做咖啡店網站、圖片及短片，也可以討論自己的目標；真正的確認卡核准前不會開始製作。','可以试做咖啡店网站、图片及短片，也可以讨论自己的目标；真正的确认卡批准前不会开始制作。')],discuss:[jt('Discuss the complete plan','討論完整計畫','讨论完整计划'),jt('In chat, discuss website design, image direction, video storyboard and integration. Choose every role’s model, effort and actual skill, then approve the project configuration and design cards. No Git repository is required for these artifacts.','在聊天中討論網站設計、圖片方向、影片分鏡及整合；逐一確認角色模型、推理強度與實際技能，再核准專案配置和設計卡。這些作品不需要 Git 儲存庫。','在聊天中讨论网站设计、图片方向、影片分镜及整合；逐一确认角色模型、推理强度与实际技能，再批准项目配置和设计卡。这些作品不需要 Git 仓库。')],confirm:[jt('Review your confirmation card','檢視真正的確認卡','查看真正的确认卡'),jt('Check the exact pinned work before approving. This guide never answers a card.','核准前請確認已鎖定的工作；導覽不會替你回答卡片。','批准前请确认已锁定的工作；导览不会替你回答卡片。')],produce:[jt('Follow your actual Task','查看實際 Task 進度','查看实际 Task 进度'),jt('Outputs appear in Library as drafts. Task creation is not completion; review required cards and previews.','產出會以草稿出現在 Library；建立 Task 不等於完成，請查看需要你處理的卡片和預覽。','产出会以草稿出现在 Library；创建 Task 不等于完成，请查看需要你处理的卡片和预览。')],review:[jt('Review, refine, then approve','檢視、修改，再驗收','查看、修改，再验收'),jt('Preview the whole site, request targeted changes, and approve only the current complete bundle.','預覽整個網站、提出具體修改，最後只核准目前完整的作品集。','预览整个网站、提出具体修改，最后只批准当前完整的作品集。')],hold:[jt('Your work needs attention','現有工作需要處理','现有工作需要处理'),state.reason||jt('Open the existing Task to inspect its hold or cancellation. Reloading this guide never starts a replacement.','請打開現有 Task 查看暫停或取消原因；重載導覽不會建立替代工作。','请打开现有 Task 查看暂停或取消原因；重新加载导览不会创建替代工作。')],complete:[jt('Your approved website is ready','已驗收的網站完成了','已验收的网站完成了'),jt('The signed whole-site approval and actual Task Done are verified. Open the result or find it in Library.','已驗證整站的簽章核准與實際 Task Done；可以開啟成果，或到 Library 查看。','已验证整站的签名批准与实际 Task Done；可以打开成果，或到 Library 查看。')],'own-goal':[jt('Start with your own goal','從你的目標開始','从你的目标开始'),jt('Discuss your goal with Firstmate. The coffee example is optional; the quick tour remains in Settings.','請和 Firstmate 討論你的目標；咖啡店範例並非必要，Settings 仍保留快速導覽。','请和 Firstmate 讨论你的目标；咖啡店示例并非必需，Settings 仍保留快速导览。')]};
    const text=copy[phase]||copy.hold;s.targetSelector=phase==='connect'?'[data-firstmate-welcome]':phase==='choose'||phase==='discuss'||phase==='own-goal'?'#chatLog':phase==='complete'?'[data-native-preview]':'[data-scard]';
    s.panel.replaceChildren(h('div',{class:'ob-tour-head'},h('span',{class:'faint'},jt('First project','第一個作品','第一个作品')),h('button',{class:'btn ghost','data-ob-journey-skip':'',onclick:async()=>{try{await postJ('/api/onboarding',{action:'skip'});}finally{store.set(JOURNEY_KEY,'dismissed');closeJourney();}}},jt('Hide guide','收起導覽','收起导览'))),h('h2',{id:'ob-journey-title'},text[0]),h('p',{},text[1]));
    s.status=h('p',{role:'status'});s.panel.append(s.status);
    const actions=h('div',{class:'ob-tour-actions'});
    if(phase==='choose'||phase==='own-goal')actions.append(h('a',{class:'btn primary',href:'#/first-workflow','data-ob-own-workflow':''},jt('Build my first workflow','建立我的第一個流程','建立我的第一个流程')));
    if(phase==='choose')for(const[choice,label]of[['coffee',jt('Coffee-shop example','咖啡店範例','咖啡店示例')],['own',jt('My own goal','自己的目標','自己的目标')]])actions.append(h('button',{class:'btn', 'data-ob-choice':choice,onclick:async()=>{if(s.pending)return;s.pending=true;try{const result=await postJ('/api/onboarding',{action:'choose',choice});if(result?.error)throw new Error(result.error);if(journey!==s)return;if(choice==='coffee')location.hash='#/workflows/coffee-kit';else location.hash='#/firstmate';await refreshJourney();}catch(error){if(journey===s)s.status.textContent=error.message;}finally{s.pending=false;}}},label));
    if(['connect','choose','discuss','own-goal'].includes(phase))actions.append(h('button',{class:'btn','data-ob-chat':'',onclick:()=>{chatMode='main';store.set('crew.chatMode','main');openChat(true);}},jt('Open Firstmate chat','打開 Firstmate 對話','打开 Firstmate 对话')));
    if(state.href)actions.append(h('a',{class:'btn primary',href:state.href,'data-ob-task':''},jt('Open existing Task','打開現有 Task','打开现有 Task')));
    if(state.complete){actions.append(h('a',{class:'btn primary',href:state.preview},jt('Open approved site','開啟已驗收網站','打开已验收网站')),h('a',{class:'btn',href:'#/library'},'Library'));}
    s.panel.append(actions);s.schedule();
  }
  window.crewOpenFirstUse=async function(trigger){if(journey||openingJourney)return;openingJourney=true;const opening=epoch;let session,me;try{[session,me]=await Promise.all([getJ('/api/session'),getJ('/api/remote/me')]);}catch{return;}finally{openingJourney=false;}if(opening!==epoch||!session?.session||me?.kind!=='desktop')return;if(active)stop('skipped');
    const main=document.querySelector('#main'),s={mode:'journey',main,trigger:trigger||document.activeElement,oldMaxHeight:main.style.maxHeight,oldOverflow:main.style.overflow};journey=s;
    s.root=h('div',{class:'ob-tour','data-onboarding-journey':''});s.ring=h('div',{class:'ob-tour-ring','aria-hidden':'true'});s.panel=h('section',{class:'ob-tour-panel',role:'region','aria-labelledby':'ob-journey-title'});s.root.append(s.ring,s.panel);document.body.append(s.root);
    s.schedule=()=>{cancelAnimationFrame(s.frame);s.frame=requestAnimationFrame(()=>position(s));};
    s.observer=new MutationObserver(s.schedule);s.observer.observe(document.querySelector('#view'),{childList:true,subtree:true});addEventListener('resize',s.schedule);document.addEventListener('scroll',s.schedule,true);s.key=e=>{if(e.key==='Escape'&&!document.querySelector('.modal-back,dialog[open]')){store.set(JOURNEY_KEY,'dismissed');void postJ('/api/onboarding',{action:'skip'});closeJourney();}};document.addEventListener('keydown',s.key);await refreshJourney();
  };
  window.crewOnboardingPrimaryReady=()=>{if(journey){void refreshJourney();return true;}return false;};
  const priorLanguage=window.onLang;window.onLang=()=>{priorLanguage?.();if(journey)void refreshJourney();};
  if(window.liveListen)for(const event of['main','wrun','scard'])window.liveListen(event,()=>{if(journey)void refreshJourney();});
  const original=routes.settings;
  // Legacy quick tour stays manual in Settings. Only the native journey may auto-open; it never redirects Board.
  routes.settings=function(){const node=original.apply(this,arguments);const button=h('button',{class:'btn','data-ob-open':'',onclick:()=>window.crewOpenOnboarding(button)},tr('Open getting started guide','開啟入門導覽'));node.append(button,h('button',{class:'btn','data-ob-resume':'',onclick:async()=>{await postJ('/api/onboarding',{action:'resume'});store.set(JOURNEY_KEY,'');window.crewOpenFirstUse();}},tr('Resume first project guide','繼續第一個作品導覽')));return node;};
  async function auto(){if(!active&&!journey&&!checked&&!store.get(JOURNEY_KEY,'')&&S.route?.name){checked=true;try{const state=await getJ('/api/onboarding');if(state.paused||state.complete)return;if(state.started||S.route?.name==='board')window.crewOpenFirstUse?.();}catch{}}}
  addEventListener('hashchange',()=>{
    epoch++;
    if(journey){journey.schedule();void refreshJourney();}
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
