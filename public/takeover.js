// Takeover: Studio as the captain's single entry point to the firstmate session.
// Loaded after m25.js. Adds the Take over page (fork the firstmate session and
// drive the copy, release it back), dispatch from an intent, the live crew
// table, questions and permission prompts in the chat, and intent-alignment
// cards with every section and the one-way door confirmation.
(() => {
const TK = { data: null, loading: false, crew: null, crewTimer: null, revision: 0 };
const fmtDur = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? `${Math.max(0, Math.round(ms / 1000))}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const copyBtn = (text) => h("button", { class: "btn ghost icon", "aria-label": T("Copy", "複製"), title: T("Copy", "複製"), onclick: () => navigator.clipboard?.writeText(text).then(() => toast(T("Copied", "已複製"))) }, icon("copy", "ic sm"));
const cmdBox = (text, attrs = {}) => h("div", { class: "tk-cmd", ...attrs }, h("code", { class: "mono" }, text), copyBtn(text));

async function loadTakeover() {
  if (TK.loading) return; TK.loading = true;
  try { TK.data = await getJ(TK.optional?"/api/takeover":"/api/takeover?independent=1"); } catch (e) { TK.data = { error: String(e) }; }
  TK.loading = false; TK.revision++;
  if(S.route?.name==="board")soft();else if (S.route?.name === "takeover" || S.route?.name === "firstmate") render();
}

// OAuth URL stays only in this browser's transient memory, never localStorage/events.
const ACCOUNT={view:null,url:null,busy:false,loading:false,begin:null,starting:false,revision:0,read:0};
window.crewFirstmateWelcomeSignature=()=>[ACCOUNT.revision,TK.revision,TK.loading,MS.view?.state,MS.view?.context,MS.view?.project,MS.view?.sessionId];
function accountChanged(v,source="read"){if(source==="live"&&v.state==="pending"&&ACCOUNT.begin)ACCOUNT.begin.pending=true;ACCOUNT.revision++;ACCOUNT.view=v;if(["failed","hold","cancelled"].includes(v.state)&&(source==="action"||ACCOUNT.begin?.pending))ACCOUNT.begin=null;if(v.state!=="pending")ACCOUNT.url=null;dispatchEvent(new Event("crew:codex-account"));if(S.route?.name==="board")soft();else if(["firstmate","takeover","doctor"].includes(S.route?.name))render();if(v.state==="ready"&&ACCOUNT.begin)void continueNative(ACCOUNT.begin);}
async function accountAction(action,begin=false){if(ACCOUNT.busy)return;if((begin||action==="login")&&MS.view?.context==="studio")ACCOUNT.begin={project:MS.view.project};if(action==="cancel")ACCOUNT.begin=null;ACCOUNT.busy=true;render();try{const r=await postJ(`/api/codex/account/${action}`,{});if(r.error){ACCOUNT.begin=null;return toast(r.error);}if(action==="login")ACCOUNT.url=r.authUrl||null;accountChanged(r,"action");}finally{ACCOUNT.busy=false;dispatchEvent(new Event("crew:codex-account"));render();}}
// A reconnect may have missed account events; reconcile without starting auth.
function refreshAccount(){const read=++ACCOUNT.read,revision=ACCOUNT.revision;return getJ("/api/codex/account").then(v=>{if(read===ACCOUNT.read&&revision===ACCOUNT.revision)accountChanged(v);}).catch(()=>{});}
addEventListener("crew:live",()=>void refreshAccount());
function accountPanel(begin=false){
 if(!ACCOUNT.view&&!ACCOUNT.loading){ACCOUNT.loading=true;refreshAccount().finally(()=>{ACCOUNT.loading=false;});}
 const a=ACCOUNT.view||{state:"unknown"},phone=MS.me.kind==="phone",owned=MS.view&&MS.view.state!=="detached",pending=a.state==="pending",checking=ACCOUNT.busy||a.state==="checking";
 return h("section",{class:"card tk-drive tk-account","data-codex-account":a.state,"data-account-busy":String(checking)},h("h2",{},T("Connect Codex","連接 Codex")),
 h("p",{class:"muted"},T("Sign in with ChatGPT here, then start a new thread. No terminal session selection or API key is required.","在這裡使用 ChatGPT 登入，再開新 thread。不必選擇終端機 session，也不需要 API 金鑰。")),
 h("p",{"data-account-status":"1"},T(a.reason||"Account not yet verified.",a.reasonZh||"帳號尚未驗證。")),
 a.model?h("div",{class:"mono faint"},`${a.model} · ${a.effort||T("configured default","設定預設")}`):null,
 h("div",{class:"faint"},T("Account readiness and repository tool health are separate; tools remain unverified here.","帳號就緒與專案工具健康是不同的檢查；這裡尚未驗證工具。")),
 pending?(ACCOUNT.url?h("a",{class:"btn primary",href:ACCOUNT.url,target:"_blank",rel:"noopener noreferrer","data-codex-browser":"1"},T("Open official sign-in page","開啟官方登入頁")):h("p",{class:"muted"},T("Continue in the browser window you opened, or cancel and connect again.","請在已開啟的瀏覽器視窗繼續，或取消後重新連接。"))):null,
 owned?h("p",{class:"note"},T("Studio already owns a firstmate session. Release it here before changing the account or starting another.","Studio 已在操作 firstmate session；請先在這裡交還，再變更帳號或開新工作。")):null,
 h("div",{class:"actions"},pending||checking?h("button",{class:"btn","data-codex-cancel":"1",disabled:phone||ACCOUNT.busy||null,onclick:()=>accountAction("cancel")},T("Cancel sign-in","取消登入")):h("button",{class:"btn primary","data-codex-connect":"1",disabled:phone||owned||null,onclick:()=>accountAction("login",begin)},T("Connect Codex…","連接 Codex…")),
 !pending&&!checking?h("button",{class:"btn","data-codex-verify":"1",disabled:phone||owned||null,onclick:()=>accountAction("verify")},T("Verify account","驗證帳號")):null));
}
// Claude: status from the official read-only `claude auth status`; sign-in runs the official `claude auth login`
// (the CLI opens the browser itself). Neither makes a model request.
const CLAUDE={login:null,status:null,loading:false,loaded:false,busy:false,read:0};
function claudeRefresh(){const read=++CLAUDE.read,before=JSON.stringify([CLAUDE.login,CLAUDE.status]);CLAUDE.loading=true;return Promise.all([getJ("/api/claude/account").catch(()=>null),getJ("/api/claude/native/status").catch(()=>null)]).then(([l,st])=>{if(read!==CLAUDE.read)return;if(l&&!l.error)CLAUDE.login=l;CLAUDE.status=st?.provider==="claude"?{...st,at:0,expires:0}:null;}).finally(()=>{if(read!==CLAUDE.read)return;CLAUDE.loading=false;const first=!CLAUDE.loaded;CLAUDE.loaded=true;if(first||JSON.stringify([CLAUDE.login,CLAUDE.status])!==before)render();});}
function claudeChanged(v){const was=CLAUDE.login?.state;CLAUDE.login=v;if(was==="pending"&&v.state!=="pending"){void claudeRefresh();dispatchEvent(new Event("crew:claude-account"));}render();}
async function claudeAction(action){if(CLAUDE.busy)return;CLAUDE.busy=true;render();try{const r=await postJ(`/api/claude/account/${action}`,{});if(r.error)return toast(r.error);claudeChanged(r);}finally{CLAUDE.busy=false;render();}}
function claudeAccountPanel(){
 if(!CLAUDE.loaded&&!CLAUDE.loading)void claudeRefresh();
 const l=CLAUDE.login||{state:"idle"},st=CLAUDE.status,phone=MS.me.kind==="phone",pending=l.state==="pending";
 const state=st?.quota==="exhausted"?"exhausted":st?.loginState==="logged-in"?"signed-in":st?.loginState==="not-logged-in"?"signed-out":"unknown";
 const label={"exhausted":T(`Signed in, but quota is exhausted. ${st?.resetAt?"Reported reset: "+new Date(st.resetAt).toLocaleString()+".":"Reset time unknown."} Wait for reset; signing in again will not help.`,`已登入，但額度已耗盡。${st?.resetAt?"回報的重設時間："+new Date(st.resetAt).toLocaleString()+"。":"重設時間未知。"}請等待重設，重新登入沒有幫助。`),"signed-in":T("This Claude CLI context is signed in. Remaining quota is unknown.","這個 Claude CLI 環境已登入。剩餘額度未知。"),"signed-out":T("Not signed in to Claude in this Studio context. An existing Claude session may use another context; this does not mean the machine is globally logged out.","這個 Studio 環境尚未登入 Claude。既有 Claude 對話可能使用另一個環境；這不代表整台機器都已登出。"),"unknown":T("Claude sign-in in this Studio process is unverified. This does not mean the machine is globally logged out.","這個 Studio 程序的 Claude 登入尚未驗證；這不代表整台機器都已登出。")}[state];
 return h("section",{class:"card tk-drive tk-account","data-claude-account":state,"data-claude-login":l.state},h("h2",{},T("Claude account","Claude 帳號")),
  h("p",{"data-claude-status":"1"},label),
  l.state!=="idle"?h("p",{class:"muted","data-claude-login-reason":"1"},T(l.reason,l.reasonZh)):null,
  h("div",{class:"faint"},T("Signing in makes no model request.","登入不會呼叫模型。")),
  h("div",{class:"actions"},state==="exhausted"&&!pending?null:pending?h("button",{class:"btn","data-claude-cancel":"1",disabled:phone||CLAUDE.busy||null,onclick:()=>claudeAction("cancel")},T("Cancel sign-in","取消登入")):h("button",{class:state==="signed-in"?"btn":"btn primary","data-claude-signin":"1",disabled:phone||CLAUDE.busy||null,onclick:()=>claudeAction("login")},state==="signed-in"?T("Sign in again…","重新登入…"):T("Sign in to Claude…","登入 Claude…")),
   h("button",{class:"btn ghost","data-claude-refresh":"1",onclick:()=>void claudeRefresh()},T("Check again","重新檢查"))),
  phone?h("p",{class:"note"},T("Sign in on the Mac.","請在 Mac 上登入。")):null);
}
window.crewClaudeAccountPanel=claudeAccountPanel;window.crewConnectClaude=()=>claudeAction("login");
// a reconnect may have missed live events (a sign-in finished or was cancelled meanwhile): read the state again.
// Before the first read lands there is nothing stale; that read already covers it.
addEventListener("crew:live",()=>{if(CLAUDE.loaded)void claudeRefresh();});
window.liveListen("claude-account",m=>claudeChanged(JSON.parse(m.data)));
window.crewCodexAccountPanel=accountPanel;window.crewConnectCodex=()=>accountAction("login");
window.liveListen("codex-account",m=>accountChanged(JSON.parse(m.data),"live"));


window.crewFirstmateWelcome=()=>{
 if(MS.view?.state!=="detached")return null;
 if(!TK.data&&!TK.loading)loadTakeover();
 return h("section",{class:"card tk-drive","data-firstmate-welcome":"1"},h("h2",{},T("Welcome. Let’s make something.","歡迎，我們來做點東西。")),h("p",{},T("Connect an agent account, then begin with Studio’s own Firstmate. No terminal session is needed.","連接 agent 帳號，再和 Studio 自己的 Firstmate 開始。不需要終端機 session。")),accountPanel(true),claudeAccountPanel(),TK.data&&!TK.data.error?startCodexCard(TK.data,MS.me.kind==="phone"):h("p",{},T("Loading your workspace…","正在載入你的工作空間…")));
};
// Project staffing is separate from the primary host. Draft answers never start work.
const STAFF={projects:null,project:'',view:null,error:null,busy:false,open:false};
async function staffingRequest(body){STAFF.busy=true;STAFF.error=null;render();try{const result=await postJ('/api/intake/staffing',body);if(result.error)STAFF.error=result.error;else STAFF.view=result;}catch(e){STAFF.error=String(e);}finally{STAFF.busy=false;render();}}
function staffingPanel(){
 if(!STAFF.projects){STAFF.projects=[];getJ('/api/doors').then(v=>{STAFF.projects=(v.projects||[]).filter(p=>p.path&&p.enabled!==false);render();}).catch(e=>{STAFF.error=String(e);render();});}
 const base={project:STAFF.project,workflow:'code-firstmate',version:1},view=STAFF.view;
 const project=h('select',{'aria-label':T('Staffing project','派工專案'),value:STAFF.project,disabled:STAFF.busy||null,onchange:e=>{STAFF.project=e.target.value;STAFF.view=null;render();}},h('option',{value:''},T('Choose registered project','選擇已登錄專案')),...STAFF.projects.map(p=>h('option',{value:p.id,selected:STAFF.project===p.id||null},p.name)));
 return h('section',{class:'card tk-staffing','data-staffing':'1'},h('h2',{},T('Choose your crew together','一起決定代理配置')),h('p',{},T('The Firstmate account is separate. Discuss each role’s vendor, model and effort, review its exact skill, then approve the project configuration before dispatch.','Firstmate 帳號與工作角色分開。逐輪討論各角色供應商、模型和推理強度，查看實際技能，再核准專案配置後派工。')),project,h('button',{class:'btn',disabled:!STAFF.project||STAFF.busy||null,onclick:()=>staffingRequest(base)},T('Discuss agent choices','討論代理配置')),
 STAFF.error?h('p',{class:'note','role':'alert'},STAFF.error):null,
 view?.frontier?h('div',{},h('p',{},T(`Decision round ${view.round}: answer this frontier first.`,`第 ${view.round} 輪：先回答目前的問題。`)),...view.frontier.map(q=>{const selected=view.choices[q.role]||{},cap=view.capabilities.find(c=>c.provider===selected.provider),model=cap?.models.find(m=>m.id===selected.model),options=q.field==='provider'?view.capabilities.map(c=>({id:c.provider,label:c.provider+(c.support==='unsupported'?T(' — native adapter unavailable','（原生介面尚不可用）'):'' )})):q.field==='model'?(cap?.models||[]).map(m=>({id:m.id,label:m.id})):(model?.efforts||[]).map(e=>({id:e,label:e}));const input=h('select',{'aria-label':`${q.role} ${q.field}`,disabled:STAFF.busy||null},h('option',{value:''},T('Choose explicitly','請明確選擇')),...options.map(o=>h('option',{value:o.id},o.label)));return h('div',{class:'tk-staffing-question'},h('label',{},`${q.number}. ${q.role} · ${T(q.field,({provider:'供應商',model:'模型',effort:'推理強度'})[q.field])}`,input),h('p',{class:'muted'},T(q.recommendation,q.recommendationZh)),cap&&cap.auth==='verified'&&cap.quota==='exhausted'?h('p',{class:'note'},T('Signed in, but quota is exhausted. This role stays on hold; no automatic retry or provider switch.','帳號已登入，但額度已用完。此角色保持暫停，不會自動重試或切換供應商。')):null,cap&&cap.support==='unsupported'?h('p',{class:'note'},T('This native adapter is unavailable. Login retries cannot enable it; keep this plan on hold or revise the vendor choice.','此原生介面尚不可用，重新登入無法啟用；請保留暫停或重新討論供應商。')):null,h('button',{class:'btn',disabled:STAFF.busy||!options.length||null,onclick:()=>{if(input.value)staffingRequest({...base,answers:{[q.role]:{[q.field]:input.value}}});}},T('Use this choice','採用這項選擇')));}),view.complete?h('div',{},h('h3',{},T('Review the complete configuration','確認完整配置')),h('pre',{class:'tk-staffing-summary'},JSON.stringify(view.choices,null,2)),h('button',{class:'btn primary',disabled:STAFF.busy||null,onclick:()=>staffingRequest({...base,roles:view.choices,confirm:true})},T('Create captain confirmation card','建立船長確認卡'))):null,
 h('button',{class:'btn ghost',disabled:STAFF.busy||null,onclick:()=>staffingRequest({...base,restart:true})},T('Revise choices from the start','重新討論配置')),
 ...(view.skills||[]).map(skill=>h('details',{},h('summary',{},`${skill.role} · ${skill.ref} · v${skill.version}`),h('code',{},skill.sha256),h('pre',{class:'tk-staffing-summary'},skill.text)))):null,
 view?.href?h('a',{class:'btn primary',href:view.href},T('Open configuration confirmation','開啟配置確認')):null);
}
window.crewStaffingPanel=staffingPanel;
// ---------- the Take over page ----------
function viewTakeover() {
  if (!TK.data) { loadTakeover(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:240px" })); }
  const d = TK.data;
  if (d.error) return h("div", { class: "page" }, h("div", { class: "card err", style: "padding:16px" }, d.error));
  const v = MS.view || d.view, fm = d.firstmate, o = v?.origin;
  const driving = v && (v.state === "attached" || v.state === "paused");
  const phone = MS.me.kind === "phone" && !MS.me.allowDrive;
  const kids = [h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Firstmate", "Firstmate")),
    h("p", {}, T("Connect your account and start new work in the shown project. Taking over an existing session is optional.",
      "連接帳號，在下方顯示的專案開始新工作。接手既有 session 是選用功能。"))))];

  if(!driving)kids.push(accountPanel(),claudeAccountPanel(),startCodexCard(d,phone));
  if (driving) {
    kids.push(h("section", { class: "card tk-drive", "data-takeover": o ? o.mode : "attached" },
      h("div", { class: "tk-row" }, h("span", { class: "badge run" }, h("span", { class: "d" }), o?.mode === "rehearsal" ? T("Rehearsal", "演練中") : T("Studio is driving", "Studio 駕駛中")),
        v.busy ? h("span", { class: "badge" }, T("turn running", "回合進行中")) : h("span", { class: "badge ok" }, T("idle", "閒置")),
        v.state === "paused" ? h("span", { class: "badge bad" }, T("paused", "已暫停")) : null),
      h("div", { class: "tk-kv" },
        kvRow(v.context==="studio" ? T("Primary session","主要對話") : T("Copy Studio drives", "Studio 操作的複本"), h("span", { class: "mono", "data-copy-id": v.sessionId }, v.sessionId === o?.id ? T("named on the first turn", "第一回合時產生") : v.sessionId)),
        o ? kvRow(T("Original (untouched)", "原本的 session（不動）"), h("span", { class: "mono" }, o.id)) : null,
        v.host ? kvRow(T("Host", "主機"), hostBadge(v.host)) : null,
        v.drive?.host === "codex"
          ? kvRow(T("Model · effort", "模型 · 推理強度"), h("span", { "data-model-effort": "1" }, `${v.drive.model || v.model || "—"} · ${v.drive.effort || T("config default", "設定預設")} `, h("span", { class: "faint" }, T("(from your Codex config)", "（來自你的 Codex 設定）"))))
          : kvRow(T("Model · mode", "模型 · 模式"), `${v.model || o?.model || "—"} · ${o?.permissionMode || "default"} → ${T("prompts come here", "權限詢問送到這裡")}`),
        v.drive?.host === "codex" ? kvRow(T("Approvals · sandbox", "核准 · 沙箱"), `${v.drive.approvalPolicy || "—"} · ${v.drive.sandbox || "—"} → ${T("requests come here", "核准請求送到這裡")}`) : null,
        o ? kvRow(T("Terminal", "終端機"), o.terminal ? h("span", { style: "color:var(--warn)" }, T("still open: ", "還開著："), o.terminal) : T("no sign of it", "看不到")) : null,
        o?.originWrites ? kvRow(T("Original written since", "之後原 session 又被寫入"), h("span", { style: `color:var(--${o.mode === "rehearsal" ? "text-2" : "bad"})` }, T(`${o.originWrites} time(s), last ${ago(o.lastOriginWrite)}`, `${o.originWrites} 次，最近 ${ago(o.lastOriginWrite)}`))) : null,
        v.context!=="studio" && (o || v.drive?.handoff) ? kvRow(T("Handoff note", "交接紀錄"), h("span", { class: "mono" }, `data/handoff/${o?.handoff || v.drive.handoff}`)) : null),
      v.drive && v.drive.host === "codex" ? pathBanner(v.drive) : null,
      !o ? null : o.mode !== "rehearsal" ? h("div", { class: "banner", "data-idle-warning": "1" }, icon("alert", "ic sm"),
        o.host === "codex" ? T("Keep the original Codex terminal idle and exit it after its background agents finish. Studio delivers firstmate wakes to the copy.", "請讓原本的 Codex 終端機保持閒置，等背景 agent 完成後退出。Studio 會把 firstmate 喚醒送到複本。") : T("The terminal session must stay idle. Exit it once its background agents finish: while it runs, its Stop hook keeps taking firstmate's wakes.",
          "終端機的 session 必須保持閒置。等它的背景 agent 跑完就退出：它還開著時，它的 Stop hook 會繼續搶走 firstmate 的喚醒。"))
        : h("div", { class: "note" }, T("Rehearsal: firstmate's hooks stand down in the copy (FM_IN_ROUND=1). Wakes are shown and held, never sent. Do not dispatch or answer real cards.",
          "演練：複本裡 firstmate 的 hooks 不啟動（FM_IN_ROUND=1）。喚醒只顯示、保留，不送出。不要派工或回答真的卡。")),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", onclick: () => { chatMode = "main"; store.set("crew.chatMode", "main"); openChat(true); renderChat(); } }, icon("message", "ic sm"), T("Open the firstmate chat", "打開 firstmate 對話")),
        v.busy ? h("button", { class: "btn", onclick: () => postJ("/api/main/interrupt") }, icon("stop", "ic sm"), T("Interrupt", "中斷")) : null,
        v.state === "paused" ? h("button", { class: "btn", onclick: () => postJ("/api/main/resume").then((r) => r.error && toast(r.error)) }, T("Resume", "繼續")) : null,
        h("button", { class: "btn", id: "releaseBtn", disabled: phone || null, onclick: releaseFlow }, v.context==="studio" ? T("Stop Firstmate…","停止 Firstmate…") : T("Release…", "交還…")))));
    if(v.context!=="studio")kids.push(dispatchBox(v));
  } else {
    const drv = v?.driver || {};
    if (v?.context!=="studio" && drv.holder === "terminal" && drv.resume) kids.push(h("section", { class: "card tk-drive", "data-released": "1" },
      h("b", {}, T("Released. Continue in a terminal:", "已交還。在終端機接著用：")), cmdBox(drv.resume),
      drv.forkedFrom ? h("div", { class: "faint", style: "font-size:13px" }, T("Or go back to the original, as it was before the takeover:", "或回到接手前的原本 session："), cmdBox(resumeCmd(drv.host, d.project, drv.forkedFrom))) : null));
    kids.push(fm ? h("section", { class: "card tk-session", "data-firstmate": fm.id },
      h("div", { class: "tk-row" }, h("b", {}, T("The firstmate session", "firstmate session")), hostBadge(fm.host), h("span", { class: "mono faint tk-ellip", style: "flex:0 1 auto" }, fm.id),
        fm.possiblyOpen ? h("span", { class: "badge warn" }, h("span", { class: "d" }), T("open in a terminal", "終端機開著")) : h("span", { class: "badge" }, T("not open", "沒有開著"))),
      h("div", { class: "tk-title" }, fm.title),
      h("div", { class: "tk-kv" },
        kvRow(T("Folder", "資料夾"), h("span", { class: "mono" }, fm.cwd)), kvRow(T("Model", "模型"), fm.host === "codex" ? `${fm.model || "—"} · ${fm.effort || T("config default", "設定預設")}` : fm.model || "—"),
        fm.host === "codex" ? kvRow(T("How Studio takes it", "Studio 怎麼接手"), T("a fork (thread/fork); if the app-server refuses one, a new thread seeded from a handoff. The live thread is never resumed.", "fork（thread/fork）；如果 app-server 不給 fork，就開新 thread、用交接內容起頭。正在用的 thread 絕不會被 resume。"))
          : kvRow(T("Permission mode", "權限模式"), `${fm.permissionMode || "default"} → ${T("Studio's permission bridge", "Studio 的權限橋接")}`),
        kvRow(T("Last activity", "最後活動"), ago(new Date(fm.updated).toISOString())),
        fm.possiblyOpen ? kvRow(T("Why open", "為何判斷開著"), fm.openReason) : null),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", id: "takeoverBtn", disabled: phone || null, onclick: () => takeoverFlow(fm, "takeover") }, icon("arrow", "ic sm"), T("Take over…", "接手…")),
        h("button", { class: "btn", id: "rehearseBtn", disabled: phone || null, onclick: () => takeoverFlow(fm, "rehearsal") }, T("Rehearse on a copy…", "用複本演練…"))))
      : h("div", { class: "card" }, h("div", { class: "empty" }, T("No firstmate session found for this project.", "找不到這個專案的 firstmate session。"))));
  }
  if (!driving) kids.push(h("section",{class:"card tk-notes"},h("h2",{},T("Optional: take over an existing session","選用：接手既有 session")),h("button",{class:"btn","data-optional-sessions":"1",onclick:()=>{TK.optional=true;loadTakeover();}},T("Show existing sessions","顯示既有 session"))),TK.optional?sessionList(d, fm, phone):null);
  if(driving&&v.context==="studio")kids.push(staffingPanel());
  kids.push(cutoverSteps(d, v));
  if (v?.context!=="studio" && d.handoffs?.length) kids.push(h("section", { class: "card tk-notes" }, h("h2", {}, T("Handoff notes", "交接紀錄")),
    d.handoffs.slice(0, 5).map((n, i) => h("details", { open: i === 0 && driving || null }, h("summary", { class: "mono" }, n.name), h("div", { class: "md tk-md" }, md(n.text))))));
  return h("div", { class: "page" }, ...kids);
}
const HOSTS = { claude: "Claude Code", codex: "Codex" };
const hostBadge = (host) => h("span", { class: `badge tk-host tk-host-${host}`, "data-host": host }, HOSTS[host] || host);
const resumeCmd = (host, cwd, id) => `cd ${cwd} && ${host === "codex" ? `codex resume ${id}` : `claude --resume ${id}`}`;
const kvRow = (k, v) => h("div", { class: "kv" }, h("span", { class: "faint" }, k), h("span", {}, v));

function pathBanner(dr) {
  return h("div", { class: dr.path === "handoff" ? "banner" : "note", "data-drive-path": dr.path }, dr.path === "handoff" ? icon("alert", "ic sm") : null,
    h("span", {}, dr.path === "handoff" ? T("Codex has no fork; Studio started a new thread from a handoff", "Codex 沒有 fork；Studio 用交接內容開了一個新 thread")
      : dr.path === "fork" ? T("Codex forked the thread (thread/fork). The live thread is never resumed.", "Codex fork 了這個 thread（thread/fork）。正在用的 thread 絕不會被 resume。")
      : T("Studio started a new firstmate thread on Codex", "Studio 在 Codex 上開了一個新的 firstmate thread"),
      dr.seededFrom ? h("span", { class: "faint" }, ` · ${T("first message", "第一則訊息")}: `, h("span", { class: "mono" }, dr.seededFrom)) : null,
      dr.noFork ? h("span", { class: "faint" }, ` · thread/fork: ${dr.noFork}`) : null));
}

function sessionList(d, fm, phone) {
  const rows = d.sessions || [];
  return h("section", { class: "card tk-notes", "data-section": "sessions" }, h("h2", {}, T("Sessions in this project", "這個專案的 session")),
    rows.length ? h("div", { class: "tk-list" }, rows.map((s) => h("div", { class: "tk-srow", "data-session": s.id, "data-host": s.host },
      h("div", { class: "tk-row" }, hostBadge(s.host), h("span", { class: "mono faint" }, s.id.slice(0, 8)), s.studioCopy ? h("span", { class: "badge run" }, T("Studio copy", "Studio 複本")) : null,
        s.possiblyOpen ? h("span", { class: "badge warn" }, T("open", "開著")) : null, h("span", { class: "faint" }, ago(new Date(s.updated).toISOString()))),
      h("div", { class: "tk-ellip tk-sum" }, s.title),
      s.studioCopy ? null : h("button", { class: "btn sm tk-take", disabled: phone || null, onclick: () => takeoverFlow(s, "takeover") }, T("Take over…", "接手…")))))
      : h("div", { class: "empty" }, T("No Claude Code or Codex session found for this project.", "找不到這個專案的 Claude Code 或 Codex session。")));
}

function startCodexCard(d, phone) {
  const c = d.codex || {}, cfg = c.config || {};const account=ACCOUNT.view||c.account||{};const native=d.view?.context==="studio";
  return h("section", { class: "card tk-drive", "data-section": "start-codex" }, h("h2", {}, T("Start firstmate on Codex", "在 Codex 上啟動 firstmate")),
    h("p", { class: "muted", style: "margin:0" }, native ? T("A fresh Firstmate in Studio’s own workspace. No repository, terminal session or handoff is required.","在 Studio 自己的工作空間開啟全新的 Firstmate。不需要 repo、終端機 session 或交接檔。") : T("Explicit project override: this fresh thread follows the shown project’s authority and handoff.","明確指定的專案：新對話會遵循下方專案的授權與交接內容。")),
    h("div", { class: "tk-kv" },
      kvRow(T("Folder", "資料夾"), h("span", { class: "mono" }, d.project)),
      kvRow(T("First message", "第一則訊息"), native ? T("Studio’s own Firstmate introduction","Studio 自己的 Firstmate 開場") : c.handoffFile ? h("span", { class: "mono", "data-handoff-file": c.handoffFile }, c.handoffFile) : T("No explicit project handoff", "沒有明確指定的專案交接檔")),
      kvRow(T("Model · effort", "模型 · 推理強度"), h("span", { "data-codex-config": "1" }, `${cfg.model || T("Codex default", "Codex 預設")} · ${cfg.effort || T("Codex default", "Codex 預設")} `,
        h("span", { class: "faint" }, cfg.from?.length ? T(`(configured in ${cfg.from.join(", ")}; effective values appear after startup)`, `（設定於 ${cfg.from.join("、")}；啟動後會顯示實際值）`) : T("(Studio never overrides it)", "（Studio 不會改）"))))),
    h("div", { class: "actions" }, h("button", { class: "btn", id: "startCodexBtn", disabled: phone || account.state!=="ready" || ACCOUNT.busy || (MS.view||d.view)?.state!=="detached" || null, onclick: () => native ? continueNative({project:d.project}) : startCodexFlow(d) }, native ? T("Continue with Firstmate","和 Firstmate 開始") : T("Start firstmate on Codex…", "在 Codex 上啟動 firstmate…"))));
}

async function openNativeConversation(){chatMode="main";store.set("crew.chatMode","main");location.hash="#/board";await loadMain();openChat(true);renderChat(false);}

// Only an explicit captain Connect/Continue may create the primary, never page load.
async function continueNative(expected){
 if(ACCOUNT.starting)return;ACCOUNT.starting=true;ACCOUNT.begin=null;
 try{const d=await getJ("/api/takeover?independent=1");if(d.view?.context!=="studio"||d.project!==expected.project)return toast(T("Workspace changed; review it before continuing.","工作空間已變更，請先確認後再繼續。"));if(d.view.state!=="detached"){if(d.view.state==="attached"&&d.view.drive?.path==="fresh"&&!d.view.origin){await openNativeConversation();return;}return toast(T("Review the existing Firstmate before continuing.","請先確認現有 Firstmate 的狀態再繼續。"));}const r=await postJ("/api/main/start",{host:"codex",confirm:true});if(!r.ok){await loadMain();if(MS.view?.state==="attached"&&MS.view.context==="studio"&&MS.view.project===expected.project&&MS.view.drive?.path==="fresh"&&!MS.view.origin){await openNativeConversation();return;}return toast(r.reason||r.error);}await openNativeConversation();loadTakeover();}catch{return toast(T("Could not connect Firstmate. Check the account and try again.","無法連接 Firstmate，請確認帳號後重試。"));}finally{ACCOUNT.starting=false;}
}

function startCodexFlow(d) {
  const ack = h("input", { type: "checkbox", id: "tkStartAck" });
  modal(T("Start firstmate on Codex", "在 Codex 上啟動 firstmate"), h("div", { class:"tk-start-dialog", style: "display:grid;gap:10px;max-width:560px" },
    h("p", { class: "muted", style: "margin:0" }, T(`Studio starts codex app-server in ${d.project} and starts a new thread. Approval requests come to Studio; anything unanswered is declined.`,
      `Studio 會在 ${d.project} 執行 codex app-server 並開一個新 thread。核准請求會送到 Studio；沒回答就拒絕。`)),
    h("div", { class: "banner" }, icon("alert", "ic sm"), T("Use the shown project and its existing authority/coordination rules. This does not release another agent’s project lock.", "請使用顯示的專案並遵守既有授權與協作規則；這不會解除其他 agent 的專案鎖。")),
    h("label", { class: "tk-row", style: "font-size:13px" }, ack, T("This project is available for the new firstmate work.", "這個專案目前可以開始新的 firstmate 工作。"))),
    async (close, btn) => {
      if (!ack.checked) return toast(T("Tick the box first.", "請先打勾。"));
      btn.disabled = true;
      const r = await postJ("/api/main/start", { host: "codex", confirm: true });
      close();
      if (!r.ok) return toast(r.reason || r.error);
      toast(T("firstmate started on Codex", "firstmate 已在 Codex 啟動"));
      chatMode = "main"; store.set("crew.chatMode", "main"); openChat(true);
      await loadMain(); loadTakeover();
      if(d.view?.context==="studio")await openNativeConversation();
    });
  $(".modal .btn.primary").textContent = T("Start", "啟動");
}

function cutoverSteps(d, v) {
  if (!v?.origin) return null; // Fresh Studio sessions have no terminal cutover.
  const { id, host } = v.origin;
  return h("section", { class: "card tk-steps", "data-section": "cutover" }, h("h2", {}, T("Cutover, step by step", "切換步驟")),
    h("ol", {},
      h("li", {}, T("In the terminal, let firstmate finish its turn and its background agents. Do not type anything more there.", "在終端機讓 firstmate 把這回合和背景 agent 做完，之後別再在那邊輸入。")),
      h("li", {}, T("Here, press Take over and confirm. Studio forks the session; the first turn tells firstmate it now runs in Studio.", "在這裡按「接手」並確認。Studio 會 fork 這個 session，第一回合告訴 firstmate 它改在 Studio 執行。")),
      h("li", {}, T("Exit the terminal session (/exit). Firstmate wakes reach the Studio copy through the host hook or Studio’s delivery queue.", "退出終端機的 session（/exit）。firstmate 的喚醒會經由主機 hook 或 Studio 的佇列送到複本。")),
      h("li", {}, T("Work from Studio: chat, dispatch an intent, approve prompts, answer cards in the Inbox.", "在 Studio 工作：對話、提出意圖派工、核准權限、在收件匣回答卡片。")),
      h("li", {}, T("Roll back any time: Release, then in a terminal run the copy's resume command (keeps Studio's turns) or the original's (as before the takeover):", "隨時可退回：按「交還」，再在終端機執行複本的 resume 指令（保留 Studio 的回合）或原本的（回到接手前）：")),
    ), cmdBox(resumeCmd(host, d.project, id), { "data-rollback": "1" }));
}

function takeoverFlow(fm, mode) {
  const rehearse = mode === "rehearsal", codex = fm.host === "codex";
  const ack = h("input", { type: "checkbox", id: "tkAck" });
  modal(rehearse ? T("Rehearse on a copy", "用複本演練") : T("Take over the firstmate session", "接手 firstmate session"), h("div", { style: "display:grid;gap:10px;max-width:560px" },
    h("p", { class: "muted", style: "margin:0" }, rehearse
      ? T("Studio forks the session (--fork-session) with firstmate's hooks standing down. The terminal keeps working; the copy only answers you. Wakes are shown, never sent.",
        "Studio 會 fork 這個 session（--fork-session），firstmate 的 hooks 不啟動。終端機照常工作，複本只回答你。喚醒只顯示，不送出。")
      : codex ? T("Studio asks codex app-server to fork the thread (thread/fork) and drives the fork in the same folder, with your Codex config's model, effort and approvals. If the app-server refuses a fork, Studio starts a new thread from a handoff instead. The live thread is never resumed. Approval requests come to Studio; anything unanswered is declined.",
        "Studio 請 codex app-server fork 這個 thread（thread/fork），在同一個資料夾操作 fork，用你 Codex 設定裡的模型、推理強度和核准規則。如果 app-server 不給 fork，Studio 改用交接內容開新 thread。正在用的 thread 絕不會被 resume。核准請求會送到 Studio；沒回答就拒絕。")
      : T("Studio forks the session (--fork-session) and drives the copy with the same folder, model, permission mode, hooks and MCP. Tool prompts come to Studio; anything unanswered is denied.",
        "Studio 會 fork 這個 session（--fork-session），用同樣的資料夾、模型、權限模式、hooks 和 MCP 操作複本。工具權限詢問會送到 Studio；沒回答就拒絕。")),
    rehearse ? null : h("div", { class: "banner" }, icon("alert", "ic sm"), T("From now on the terminal session must stay idle, then be exited once its background agents finish. Two firstmates must never act on the same state.",
      "從現在起終端機的 session 必須保持閒置，等背景 agent 跑完就退出。絕不能有兩個 firstmate 同時動同一份狀態。")),
    h("label", { class: "tk-row", style: "font-size:13px" }, ack, rehearse ? T("I will not dispatch tasks or answer real cards from the rehearsal.", "演練中我不會派工、也不會回答真的卡。") : T("The terminal session is idle and will stay idle.", "終端機的 session 已閒置，並會保持閒置。")),
    h("div", { class: "faint mono", style: "font-size:12px;overflow-wrap:anywhere" }, codex ? `codex app-server → thread/fork {threadId: ${fm.id}}` : `claude -p --resume ${fm.id} --fork-session${fm.model ? " --model " + fm.model : ""}${fm.permissionMode ? " --permission-mode " + fm.permissionMode : ""} --permission-prompt-tool …`)),
    async (close, btn) => {
      if (!ack.checked) return toast(T("Tick the box first.", "請先打勾。"));
      btn.disabled = true;
      const r = await postJ("/api/main/takeover", { host: fm.host || "claude", id: fm.id, mode, confirm: true });
      close();
      if (!r.ok) return toast(r.reason || r.error);
      toast(rehearse ? T("Rehearsal copy ready", "演練複本已就緒") : T("Studio is driving", "Studio 已接手"));
      if (r.path === "handoff") toast(T("Codex has no fork; Studio started a new thread from a handoff", "Codex 沒有 fork；Studio 用交接內容開了一個新 thread"));
      if (!rehearse && r.path !== "handoff") await postJ("/api/main/send", { text: T("Crew Studio took over this session as a fork. The terminal session stays idle and will be closed. From now on the captain talks to you here. Reply in one line that you are ready.",
        "Crew Studio 以 fork 的方式接手了這個 session。終端機那邊保持閒置並會關閉。之後船長在這裡跟你說話。用一句話回覆你準備好了。") });
      chatMode = "main"; store.set("crew.chatMode", "main"); openChat(true);
      await loadMain(); loadTakeover();
    });
  $(".modal .btn.primary").textContent = rehearse ? T("Start the rehearsal", "開始演練") : T("Take over", "接手");
}

async function releaseFlow() {
  if(MS.view?.context==="studio"){modal(T("Stop Firstmate?","停止 Firstmate？"),h("p",{},T("Studio stops its own primary session. Native workflow Tasks keep their own lifecycle; this does not approve or cancel them.","Studio 會停止自己的主要對話；原生工作流程任務維持各自的生命週期，這不會核准或取消那些任務。")),async(close,btn)=>{btn.disabled=true;const r=await postJ("/api/main/detach");if(r.error){btn.disabled=false;return toast(r.error);}close();await loadMain();loadTakeover();});return;}
  modal(T("Release the session", "交還 session"), h("p", { class: "muted", style: "margin:0;max-width:520px" },
    T("Studio stops its copy and releases the lock. You get the command to continue in a terminal.", "Studio 會停止複本並放開鎖，並給你在終端機接著用的指令。")),
    async (close, btn) => {
      btn.disabled = true;
      const o = MS.view?.origin, r = await postJ("/api/main/detach");
      close();
      if (r.error) return toast(r.error);
      modal(T("Released", "已交還"), h("div", { style: "display:grid;gap:10px;max-width:560px" },
        h("p", { class: "muted", style: "margin:0" }, T("Continue Studio's copy in a terminal:", "在終端機接著用 Studio 的複本：")), cmdBox(r.resume, { id: "resumeCmd" }),
        o ? h("p", { class: "muted", style: "margin:0" }, T("Or go back to the original, as it was before the takeover:", "或回到接手前的原本 session：")) : null,
        o ? cmdBox(resumeCmd(o.host, o.cwd, o.id)) : null), (c) => c());
      $(".modal .btn.primary").textContent = T("Done", "完成");
      await loadMain(); loadTakeover();
    });
  $(".modal .btn.primary").textContent = T("Release", "交還");
}

function dispatchBox(v) {
  const ta = h("textarea", { class: "input", id: "dispatchIn", rows: 3, placeholder: v.context==="studio" ? T("Describe the work. Firstmate proposes a native workflow and asks for your approval.","描述你想做的工作。Firstmate 會提出原生流程，請你核准。") : T("What do you want done? firstmate drafts the spec and raises a dispatch card in your inbox.", "你想做什麼？firstmate 會寫 spec，並在收件匣開一張派工卡。") });
  return h("section", { class: "card tk-drive", "data-section": "dispatch" }, h("h2", {}, T("Dispatch from an intent", "從意圖派工")), ta,
    h("div", { class: "actions" }, h("button", { class: "btn primary", id: "dispatchBtn", disabled: v.origin?.mode === "rehearsal" || null, onclick: async () => {
      const text = ta.value.trim(); if (!text) return;
      const r = await postJ("/api/main/dispatch", { text });
      if (r.error) return toast(r.error);
      ta.value = ""; toast(T("Sent to firstmate; the dispatch card will appear in the Inbox", "已送給 firstmate；派工卡會出現在收件匣"));
      chatMode = "main"; store.set("crew.chatMode", "main"); openChat(true); renderChat();
    } }, icon("send", "ic sm"), T("Send to firstmate", "送給 firstmate")),
      v.origin?.mode === "rehearsal" ? h("span", { class: "faint", style: "font-size:12px" }, T("Off in a rehearsal: no real dispatch.", "演練中關閉：不做真的派工。")) : null));
}

// no sidebar entry of its own: the page is the takeover part of the Firstmate page (#/firstmate), and #/takeover
routes.takeover = viewTakeover;
if (!routes.firstmate) routes.firstmate = viewTakeover;
window.crewTakeover = { view: viewTakeover, load: loadTakeover };
if (/^#\/(takeover|firstmate)/.test(location.hash)) route();

// keep the page in step with the session
(function follow() { // on the page's one event stream (app.js)
  const es = { addEventListener: (t, f) => window.liveListen(t, f) };
  es.addEventListener("main", () => { if (S.route?.name === "takeover" || S.route?.name === "firstmate") { clearTimeout(TK.t); TK.t = setTimeout(loadTakeover, 300); } });
  es.addEventListener("mainEvent", (m) => { const e = JSON.parse(m.data); if (e.type === "turnStart" && isMain()) renderChat(false); });
})();

// ---------- chat: the takeover banner, system lines, questions ----------
const driverBannerBase = driverBanner;
driverBanner = function (v) {
  const base = driverBannerBase(v);
  if (!v.origin || v.state === "detached") return base;
  base.append(h("div", { class: "faint", style: "font-size:12px", "data-origin": v.origin.id },
    v.origin.mode === "rehearsal" ? T("Rehearsal copy. Wakes are shown, not sent.", "演練複本。喚醒只顯示、不送出。") : T("A copy of the terminal session, which must stay idle.", "終端機 session 的複本；終端機必須保持閒置。"),
    " ", h("a", { href: "#/takeover" }, T("Takeover", "接手頁"))));
  return base;
};
KLABEL.system = () => T("System", "系統");
const approvalCardBase = approvalCard;
approvalCard = function (a) {
  if (a.tool !== "AskUserQuestion") return approvalCardBase(a);
  const qs = Array.isArray(a.input?.questions) ? a.input.questions : [];
  const picks = new Map();
  const box = h("div", { class: "rich tk-q", "data-question": a.id, role: "group", "aria-label": T("firstmate asks you", "firstmate 問你") },
    h("div", { class: "rk", style: "color:var(--human)" }, icon("human", "ic sm"), T("firstmate asks you", "firstmate 問你")),
    qs.map((q, i) => {
      const other = h("input", { class: "input", placeholder: T("Or type an answer", "或自己輸入答案"), oninput: (e) => picks.set(q.question, e.target.value) });
      return h("div", { style: "display:grid;gap:6px" }, h("b", { style: "font-size:13.5px" }, q.question),
        h("div", { class: "tk-opts" }, (q.options || []).map((o) => h("button", { type: "button", class: "btn", title: o.description || "", onclick: (e) => {
          picks.set(q.question, o.label); e.target.closest(".tk-opts").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === e.target))); } }, o.label))), other);
    }),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", onclick: async () => { const answers = Object.fromEntries(picks); const r = await postJ("/api/main/question", { id: a.id, answers }); if (r.error) toast(r.error); } }, T("Answer", "回答")),
      h("button", { class: "btn", onclick: () => postJ("/api/main/approve", { id: a.id, allow: false }).then((r) => r.error && toast(r.error)) }, T("Decline", "不回答"))));
  return box;
};
// a firstmate reply that ends in a question gets a reply box under it
const renderChatBase = renderChat;
renderChat = function (stick = true) {
  renderChatBase(stick);
  if (!isMain()) return;
  const v = MS.view, last = v?.log?.filter((x) => x.kind !== "tool" && x.kind !== "system" && x.kind !== "status").at(-1);
  if (!v || v.busy || v.state === "detached" || last?.kind !== "firstmate" || !/[?？]\s*$/.test(last.text.trim())) return;
  const ta = h("textarea", { class: "input", rows: 2, "aria-label": T("Reply to firstmate", "回覆 firstmate") });
  const box = h("div", { class: "rich tk-q", "data-reply": "1" }, h("div", { class: "rk", style: "color:var(--human)" }, icon("human", "ic sm"), T("firstmate is waiting for your answer", "firstmate 在等你回答")), ta,
    h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => { const t = ta.value.trim(); if (t) ask(t); } }, icon("send", "ic sm"), T("Reply", "回覆"))));
  const log = $("#chatLog"); const q = log.querySelector("[data-queue]"); q ? q.before(box) : log.append(box);
};

// ---------- the live crew ----------
const viewCrewBase = viewCrew;
function viewCrewLive(actor) {
  if (actor) return viewCrewBase(actor);
  if (!TK.crew) loadCrewLive();
  clearTimeout(TK.crewTimer); TK.crewTimer = setTimeout(() => { if (S.route?.name === "crew" && !S.route.arg) loadCrewLive(); }, 3000);
  const all = TK.crew || [];
  const list = crewLiveOnly ? all.filter((c) => c.alive) : all;
  const ci = (c) => !c.ci ? h("span", { class: "faint" }, "—") : c.ci.fail ? h("span", { class: "badge bad" }, `✗ ${c.ci.fail}`) : c.ci.pending ? h("span", { class: "badge warn" }, `… ${c.ci.pending}`) : h("span", { class: "badge ok" }, `✓ ${c.ci.pass}`);
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Crew", "船員")),
      h("p", {}, T(`${all.filter((c) => c.alive).length + (window.studioAgents?.count() || 0)} working now · Studio agents and recent Firstmate rounds`, `目前 ${all.filter((c) => c.alive).length + (window.studioAgents?.count() || 0)} 位工作中 · Studio 的 agent 與近期 Firstmate 回合`))),
      h("div", { class: "seg", role: "group" },
        h("button", { "aria-pressed": crewLiveOnly ? "false" : "true", onclick: () => { crewLiveOnly = false; store.set("crew.liveOnly", "0"); render(); } }, h("span", { class: "keep" }, T("Recent", "近期"))),
        h("button", { "aria-pressed": crewLiveOnly ? "true" : "false", onclick: () => { crewLiveOnly = true; store.set("crew.liveOnly", "1"); render(); } }, h("span", { class: "keep" }, T("Working", "工作中"))))),
    !TK.crew ? h("div", { class: "skel", style: "height:240px" }) : !list.length ? h("div", { class: "card" }, h("div", { class: "empty" }, icon("crew"), h("b", {}, T("No crew round is running", "目前沒有船員在跑"))))
      : h("div", { class: "tk-crew", role: "list" }, list.slice(0, 40).map((c) => h("article", { class: `card tk-round${c.alive ? " is-live" : ""}`, role: "listitem", "data-actor": c.actor },
        h("div", { class: "tk-row" }, avaFor(c.name, "ava"), h("a", { href: `#/crew/${encodeURIComponent(c.actor)}`, class: "tk-name" }, c.name), h("span", { class: "vbadge" }, c.role),
          c.task ? h("a", { class: "mono", href: `#/activity/${c.task}` }, c.task) : null, c.round ? h("span", { class: "faint" }, T(`round ${c.round}`, `第 ${c.round} 回合`)) : null,
          h("span", { class: `badge ${c.alive ? "run" : /ended/.test(c.phase) ? "bad" : "ok"}`, "data-phase": c.phase }, h("span", { class: `d${c.alive ? " pulse" : ""}` }), phaseLabel(c.phase))),
        c.title ? h("div", { class: "tk-title" }, c.title) : null,
        h("div", { class: "tk-act" }, act(c.activity) || "—"),
        c.alive && c.lines?.length ? term(c.lines) : null,
        h("div", { class: "tk-meta" },
          h("span", { class: "vbadge" }, `${c.vendor || "?"}${c.model ? " · " + c.model : ""}`),
          h("span", { title: c.started || "" }, icon("clock", "ic sm"), fmtDur(c.elapsedMs)),
          c.taskPhase ? h("span", { class: "faint" }, T("task: ", "任務："), nodeLabel(c.taskPhase)) : null,
          c.pr ? h("a", { href: prUrl(c.pr), target: "_blank", rel: "noopener" }, icon("pr", "ic sm"), `#${c.pr}`) : null,
          c.pr ? h("span", { class: "tk-ci" }, "CI ", ci(c)) : null, c.merged ? h("span", { class: "badge ok" }, T("merged", "已合併")) : null,
          c.report ? h("button", { class: "btn ghost", "data-report": c.actor, onclick: () => openReport(c.actor) }, icon("doc", "ic sm"), T("Final report", "最終報告")) : null)))),
    window.studioAgents?.section() || null); // Studio tasks' agents (public/runtime.js)
}
const phaseLabel = (p) => ({ building: T("building", "實作中"), reviewing: T("reviewing", "審查中"), finished: T("finished", "完成"), stopped: T("stopped", "已停止") })[p] || p;
async function loadCrewLive() { const seq = TK.crewSeq = (TK.crewSeq || 0) + 1; let r = null; try { r = await getJ("/api/crew/live"); } catch {} if (seq !== TK.crewSeq) return; if (r) TK.crew = r; if (S.route?.name === "crew" && !S.route.arg) render(); }
async function openReport(actor) {
  const seq = TK.reportSeq = (TK.reportSeq || 0) + 1;
  const r = await getJ(`/api/crew/report/${encodeURIComponent(actor)}`).catch((e) => ({ error: String(e) }));
  if (seq !== TK.reportSeq) return; // a later report was asked for
  modal(T(`Final report · ${actor}`, `最終報告 · ${actor}`), r.error ? h("div", { class: "err" }, r.error) : h("div", { class: "md tk-report", "data-report-text": actor }, md(r.text)), (c) => c());
  $(".modal .btn.primary").textContent = T("Close", "關閉");
}
routes.crew = viewCrewLive;

// ---------- intent-alignment cards ----------
const doorSel = new Map(); // card id -> { reviewed: Set, answer, ok, why }
const items = (xs) => (Array.isArray(xs) ? xs : []).map((x) => (typeof x === "string" ? x : x?.text)).filter(Boolean);
const sec = (title, body, attrs = {}) => body ? h("section", { class: "tk-sec", ...attrs }, h("h4", {}, title), body) : null;
const list = (xs, ordered) => { const a = items(xs); return a.length ? h(ordered ? "ol" : "ul", { class: "ilist2" }, a.map((x) => h("li", {}, x))) : null; };
function needsDoorUi(c, chosen, st) {
  const en = c.details?.en || {};
  if (en.door?.kind !== "one-way") return false;
  if ([...(st?.answers?.values?.() || [])].some((a) => a.ok === false)) return false;
  const eff = c.details?.effect?.[chosen] ?? ((c.kind === "merge" || c.kind === "merge-untracked") ? (chosen === "A" ? "merge" : "hold") : null);
  return eff === "merge";
}
function nodesRow(nodes) {
  return Array.isArray(nodes) && nodes.length ? h("div", { class: "tk-nodes" }, nodes.flatMap((n, i) => [i ? h("span", { class: "faint" }, "→") : null, h("span", { class: `tk-node ${n.state || "same"}` }, n.label)]).filter(Boolean)) : null;
}
function walkBlock(c, d) {
  const w = c.details?.walk, scene = d.scene;
  if (!w && !scene) return null;
  const loc = (v) => (v && typeof v === "object" ? v[lang] || v.en || "" : v || "");
  const body = [];
  if (scene) body.push(h("div", { class: "faint", style: "font-size:13px" }, T("This card has a scene: the board animates it.", "這張卡有動畫場景，在看板上播放。")));
  if (w?.status === "valid") body.push(...(w.intents || []).map((it) => h("details", { open: (it.key || []).length ? true : null }, h("summary", {}, T(`Intent ${it.intent}`, `意圖 ${it.intent}`), " · ", T(`${(it.key || []).length} key change(s)`, `${(it.key || []).length} 個關鍵改動`)),
    h("ol", { class: "ilist2" }, (it.key || []).map((k) => h("li", {}, h("code", {}, `${k.file}:${k.start}`), " ", loc(k.note)))))),
    (w.other || []).length ? h("div", { class: "faint", style: "font-size:12.5px" }, T(`Other changes: ${w.other.length} file(s)`, `其他改動：${w.other.length} 個檔案`)) : null);
  else if (w) body.push(h("div", { class: "faint", style: "font-size:13px" }, T(`Walk ${w.status || "absent"}`, `程式碼導覽：${w.status || "無"}`), w.reason ? ` · ${w.reason}` : ""));
  body.push(h("a", { href: S.board?.url || "#", target: "_blank", rel: "noopener", style: "font-size:13px" }, T("Walk the diff on the board ↗", "在看板逐段看 diff ↗")));
  return sec(T("Walk", "程式碼導覽"), h("div", { style: "display:grid;gap:6px" }, body), { "data-walk": w?.status || "scene" });
}
function doorBlock(c, d, st) {
  const en = c.details?.en || {}, door = d.door || en.door, check = d.check || en.check;
  if (!door) return null;
  const one = door.kind === "one-way";
  const ds = doorSel.get(c.id) || { reviewed: new Set(), answer: null, ok: false, why: "" }; doorSel.set(c.id, ds);
  const intents = items(d.intent);
  const verify = async () => {
    const seq = ds.seq = (ds.seq || 0) + 1; // every change of selection: only the newest selection's check is applied
    ds.ok = false; ds.why = "";
    if (ds.reviewed.size !== intents.length || !Number.isInteger(ds.answer)) { render(); return; }
    const r = await postJ("/api/answer/check-door", { id: c.id, reviewed_intents: [...ds.reviewed].sort((a, b) => a - b), check_answer: ds.answer, locale: lang });
    if (seq !== ds.seq) return;
    ds.ok = r.ok === true; ds.why = r.ok ? "" : (r.why || r.error || T("Not confirmed", "未確認")); render();
  };
  return h("section", { class: `tk-sec tk-door ${one ? "one" : "two"}`, "data-door": door.kind },
    h("h4", {}, icon("door", "ic sm"), one ? T("One-way door", "單向門") : T("Two-way door", "雙向門")),
    door.reason ? h("p", {}, door.reason) : null, door.rollback ? h("p", { class: "faint" }, h("b", {}, T("Rollback: ", "回復方式：")), door.rollback) : null,
    one && check ? h("div", { class: "tk-check", "data-door-check": c.id },
      h("b", {}, T("Before a merge unlocks: confirm each intent, then answer the check", "解鎖合併前：逐條確認意圖，再回答確認題")),
      intents.map((x, i) => h("label", { class: "tk-intent" },
        h("input", { type: "checkbox", "data-intent": i + 1, checked: ds.reviewed.has(i + 1) || null, onchange: (e) => { e.target.checked ? ds.reviewed.add(i + 1) : ds.reviewed.delete(i + 1); verify(); } }),
        h("span", {}, h("b", {}, `${i + 1}. `), x))),
      h("div", { style: "font-size:13.5px;font-weight:600" }, check.q || check.question || ""),
      h("div", { class: "tk-opts" }, (check.options || []).map((o, i) => h("button", { type: "button", class: "btn", "data-check-answer": i, "aria-pressed": String(ds.answer === i), onclick: () => { ds.answer = i; verify(); } }, typeof o === "string" ? o : o?.text || String(o)))),
      h("div", { class: "faint", role: "status", style: `font-size:12.5px;color:var(--${ds.ok ? "ok" : ds.why ? "bad" : "text-2"})` },
        ds.ok ? T("Confirmed by the board: the merge is unlocked.", "看板已確認：合併已解鎖。") : ds.why || T(`${ds.reviewed.size} of ${intents.length} intents checked`, `已確認 ${ds.reviewed.size}/${intents.length} 條意圖`))) : null);
}
cardView = function (c) {
  const d = c.details?.[lang] || c.details?.en || {};
  const en = c.details?.en || {};
  const st = sel.get(c.id) || { chosen: null, answers: new Map() }; sel.set(c.id, st);
  const opts = Object.entries(d.options || en.options || {});
  const qs = items(d.questions);
  const ds = doorSel.get(c.id);
  const locked = st.chosen && needsDoorUi(c, st.chosen, st) && !ds?.ok;
  const disabled = !S.board?.writable || !!c.boardOnly;
  const send = h("button", { class: "btn primary", disabled: disabled || !st.chosen || locked || null, onclick: () => confirmSend(c, st) },
    icon("send", "ic sm"), locked ? T("Confirm the door first", "請先完成單向門確認") : st.chosen ? T(`Send ${st.chosen}`, `送出 ${st.chosen}`) : T("Pick an option", "先選一個選項"));
  const gl = Array.isArray(d.glossary) ? d.glossary.filter((g) => g?.term && g?.text) : [];
  return h("article", { class: "card icard", "data-card": c.id },
    h("div", { class: "cardmeta" }, h("span", { class: "mono" }, c.id), c.task ? h("a", { href: `#/activity/${c.task}` }, c.task) : null,
      c.pr ? h("a", { href: prUrl(c.pr), target: "_blank", rel: "noopener" }, `#${c.pr}`) : null, c.kind ? h("span", { class: "badge" }, c.kind) : null,
      c.purpose ? h("span", { class: "badge" }, c.purpose) : null, h("span", {}, ago(c.ts)),
      h("span", { class: "seg tk-lang", role: "group", "aria-label": T("Card language", "卡片語言") }, ["en", "zh-TW"].map((l) => h("button", { type: "button", "aria-pressed": String(lang === l), onclick: () => setLang(l) }, h("span", { class: "keep" }, l === "en" ? "EN" : "中文"))))),
    h("h3", {}, d.title || c.title),
    d.explanation ? h("p", { class: "lead" }, d.explanation) : null,
    c.boardOnly ? h("div", { class: "banner" }, icon("alert", "ic sm"), T("A retrospective card takes one answer per item.", "回顧卡要逐項回答。"),
      h("a", { href: S.board?.url || "#", target: "_blank", rel: "noopener" }, T("Answer on the board ↗", "到看板回答 ↗"))) : null,
    h("div", { class: "tk-grid" },
      sec(T("Intent", "意圖"), list(d.intent, true), { "data-sec": "intent" }),
      sec(T("Why", "原因"), list(d.why), { "data-sec": "why" }),
      items(d.scope_in).length || items(d.scope_out).length ? sec(T("Scope", "範圍"), h("div", { class: "tk-scope" },
        h("div", {}, h("b", {}, T("In", "包含")), list(d.scope_in) || h("span", { class: "faint" }, "—")),
        h("div", {}, h("b", {}, T("Out", "不包含")), list(d.scope_out) || h("span", { class: "faint" }, "—"))), { "data-sec": "scope" }) : null,
      sec(T("Done when", "完成條件"), list(d.done), { "data-sec": "done" }),
      d.before || d.after || d.before_nodes ? sec(T("Before → after", "改動前 → 改動後"), h("div", { class: "ba" },
        h("div", {}, h("b", {}, T("Before", "改動前")), nodesRow(d.before_nodes), d.before || ""), h("div", {}, h("b", {}, T("After", "改動後")), nodesRow(d.after_nodes), d.after || "")), { "data-sec": "before-after" }) : null,
      sec(T("How", "作法"), list(d.how), { "data-sec": "how" }),
      d.outcome ? sec(T("Outcome", "結果"), h("p", {}, d.outcome)) : null,
      gl.length ? sec(T("Glossary", "名詞解釋"), h("dl", { class: "tk-gl" }, gl.flatMap((g) => [h("dt", {}, g.term), h("dd", {}, g.text)])), { "data-sec": "glossary" }) : null,
      walkBlock(c, d),
      doorBlock(c, d, st)),
    opts.length ? h("div", { class: "opts", role: "radiogroup", "aria-label": T("Options", "選項") }, opts.map(([k, o]) =>
      h("button", { class: "opt", role: "radio", "aria-pressed": st.chosen === k ? "true" : "false", "aria-checked": st.chosen === k ? "true" : "false", disabled: !!c.boardOnly || null,
        onclick: () => { st.chosen = k; render(); } },
        h("span", { class: "letter" }, needsDoorUi(c, k, st) && !ds?.ok ? "🔒" : k), h("b", {}, o.description || k),
        h("span", { class: "pc" }, o.pros ? h("em", {}, "+ " + o.pros) : null, o.cons ? h("s", {}, "− " + o.cons) : null)))) : null,
    qs.length ? h("div", { style: "display:grid;gap:8px" }, qs.map((q, index) => {
      const a = st.answers.get(index) || { ok: true, text: "" }; st.answers.set(index, a);
      return h("div", { class: "qrow" }, h("label", {}, h("input", { type: "checkbox", checked: a.ok || null, onchange: (e) => { a.ok = e.target.checked; render(); } }), q),
        a.ok ? null : h("input", { class: "input", placeholder: T("What should change?", "要改什麼？"), value: a.text, oninput: (e) => { a.text = e.target.value; } }));
    })) : null,
    h("div", { class: "actions" }, send, disabled && !c.boardOnly ? h("span", { class: "faint", style: "font-size:12px" }, T("Read-only", "唯讀")) : null));
};
// the answer goes from the card itself: no dialog; the result (or the refusal) shows on the card (public/board.js)
// one answer in flight per card: a second click while it runs does nothing, and the card's controls are disabled meanwhile
const inFlight = window.answerInFlight = window.answerInFlight || new Set();
confirmSend = async function (c, st) {
  if (inFlight.has(c.id)) return;
  const done = (ok, text) => (window.onCardAnswered ? window.onCardAnswered(c, ok, text) : toast(text));
  const answers = [...st.answers.entries()].sort((a, b) => a[0] - b[0]).map(([index, a]) => a.ok ? { index, ok: true } : { index, ok: false, text: a.text || "" });
  if (answers.some((a) => !a.ok && !a.text.trim())) return done(false, T("Every unchecked question needs a note.", "每個沒打勾的問題都要寫原因。"));
  const ds = doorSel.get(c.id);
  const door = needsDoorUi(c, st.chosen, st) ? (ds?.ok ? { reviewed_intents: [...ds.reviewed].sort((a, b) => a - b), check_answer: ds.answer, locale: lang } : null) : {};
  if (!door) return done(false, T("Confirm the door first.", "請先完成單向門確認。"));
  inFlight.add(c.id); render();
  let r; try { r = await postJ("/api/answer", { id: c.id, chosen: st.chosen, answers: answers.length ? answers : undefined, ...door }); } catch (e) { r = { error: String(e) }; } finally { inFlight.delete(c.id); }
  if (r.error) return done(false, T(`Refused: ${r.error}`, `被拒：${r.error}`));
  const chosen = st.chosen; sel.delete(c.id); doorSel.delete(c.id);
  done(true, T(`${chosen} recorded ✓`, `已記錄 ${chosen} ✓`));
};
if (location.hash.startsWith("#/crew") || location.hash.startsWith("#/inbox")) route();
})();

// Native tool failures are source-owned guidance, independent of the model's paraphrase.
window.crewNativeToolFailureView=function(f){
 const actions={discuss_staffing:T("Read the saved staffing questions and continue the discussion.","讀取已存的派工問題，接續討論。"),read_current_state:T("Read the current task state before continuing.","繼續前先讀取目前任務狀態。"),review_configuration:T("Review the existing project configuration.","檢查目前專案配置。"),report_reference:T("Report this reference with the action you attempted.","回報此追蹤編號與剛才嘗試的操作。"),captain_review:T("Review the request with the captain.","請船長檢視此請求。")};
 return h("div",{class:"rich chat-err",role:"alert","data-native-failure":f.code},h("strong",{},f.reason?.[lang]||f.reason?.en||f.code),h("p",{},actions[f.nextAction]||T("Follow the stated recovery step before trying again.","請先依說明處理，再決定是否重試。")),f.correlationId?h("code",{"data-error-reference":""},f.correlationId):null,f.diagnosticRecorded===false?h("p",{},T("Private diagnostic could not be saved; include this reference and the attempted action in your report.","私有診斷無法儲存；請連同追蹤編號與嘗試操作一起回報。")):null,h("p",{},f.retryable?T("Retry only after the stated condition is resolved.","處理上述條件後才重試。 "):T("No automatic retry or approval.","不會自動重試或核准。")));
};
const nativeLogItemBase=logItem;
logItem=function(it,i){return it.nativeFailure?window.crewNativeToolFailureView(it.nativeFailure):nativeLogItemBase(it,i);};
