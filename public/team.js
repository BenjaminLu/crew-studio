// The Crew page, option C (#/team; docs/design/crew-seats.md): one card per workflow (its agent nodes as a mini pipeline,
// each dot the colour of the member who runs it, ★ for a node this workflow customised, red where a seat is empty) and the
// selected workflow's editable table: member, model, effort, skills (the member's in grey, the node's own removable,
// "+ skill" from the library) and where each value comes from. A model or effort change asks "only this workflow" or
// "the whole member"; the legend opens the member editor (model, effort, own skills, presets). The project selector shows
// one project's crew (its own seat changes applied) and adds "only this project" to the scope question. The server is the
// only authority: every change is one POST /api/team/change with the version the page last read (compare-and-swap).
(() => {
const TM = { data: null, loading: false, sel: null, ask: null, editing: false, notes: [], err: null, busy: false, project: "", opened: false, detecting: false };
const getJson = async (u) => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
// seat colours: the palette tokens (both themes)
const SEAT_COLOR = { coordinator: "var(--a6t)", maker: "var(--a1t)", "alt-maker": "var(--a2t)", reviewer: "var(--a5t)", "design-reviewer": "var(--a3t)" };
const seatColor = (id) => SEAT_COLOR[id] || "var(--a4t)";
const L = (o) => (o ? T(o.en, o.zh) : "");
const seatOf = (id) => TM.data?.seats.find((s) => s.id === id);
const seatName = (id) => L(seatOf(id)?.label) || id;
const SOURCE = { team: ["Team", "跟團隊"], project: ["◆ This project", "◆ 這個專案"], workflow: ["★ Custom here", "★ 這裡自訂"], definition: ["Workflow sets it", "流程設定"], run: ["This run", "這次"], missing: ["Missing", "缺人"] };
// facts: true detects the models again unless the server did so within its reuse window (the page opening);
// "force" detects again (重新偵測)
async function load(facts) {
  if (TM.loading) return; TM.loading = true; TM.detecting = !!facts; if (facts && TM.data) soft();
  const requestedProject=TM.project;let retry=false;
  const q = new URLSearchParams(); if (facts) q.set("facts", "1"); if (facts === "force") q.set("force", "1"); if (TM.project) q.set("project", TM.project);
  try { const data = await getJson(`/api/team${q.size ? `?${q}` : ""}`);if(requestedProject!==TM.project)retry=true;else{TM.data=data; TM.err = null; if (!TM.sel || !TM.data.workflows.some((w) => w.id === TM.sel)) TM.sel = TM.data.workflows.find((w) => w.badge.state !== "team")?.id ?? TM.data.workflows[0]?.id ?? null;} }
  catch (e) { if(requestedProject!==TM.project)retry=true;else TM.err = String(e.message || e); }
  finally { TM.loading = false; TM.detecting = false; }
  if(retry)return load();
  if (S.route?.name === "team") soft();
}
// opening the page detects the models again (leaving it re-arms that)
window.addEventListener("hashchange", () => { if (!/^#\/team\b/.test(location.hash)) TM.opened = false; });
async function change(c, skillDecisions, expected = TM.data?.team?.hash ?? null, requestedProject = TM.project) {
  if (TM.busy) return {ok:false,message:T("Another change is being saved.","另一個變更正在儲存。")}; TM.busy = true; let responseStatus = null;const owner={seat:crewSeat,node:crewNode,workflow:TM.sel,generation:crewFocusGeneration};
  try {
    const r = await fetch("/api/team/change", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change: c, expected, project: requestedProject || null, ...(skillDecisions ? { skillDecisions } : {}) }) });
    responseStatus=r.status;const j = await r.json().catch(() => ({}));
    // a script skill the captain never decided: nothing saved yet; the page shows its scripts and hosts and asks (decidePanel)
    if (r.status === 409 && j.code === "skillDecision") { if(owner.generation!==crewFocusGeneration||requestedProject!==TM.project||owner.seat!==crewSeat||owner.node!==crewNode||owner.workflow!==TM.sel||S.route?.name!=="team")return {ok:false,status:409,message:T("The view changed; reopen the settings to review permissions.","畫面已變更，請重新開啟設定以檢視權限。")}; TM.decide = { change: c, skills: j.skills || [], expected, project:requestedProject }; TM.busy = false; render(); return {ok:false,code:"skillDecision",status:r.status,message:T("Review the skill permissions before saving.","請先檢視 skill 權限再儲存。")}; }
    TM.decide = null;
    if (r.status === 409) { toast(T(j.error || "The team changed; reloaded.", j.tw || "團隊已經改了；已重新整理。")); TM.ask = null; TM.busy = false; await load(); return {ok:false,status:409,message:T("The team changed. Cancel your edits to review the latest settings, then apply them again.","團隊已更新。請取消修改以檢視最新設定，再重新調整。")}; }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if(requestedProject===TM.project)TM.data=j;else await load(); TM.ask = null; TM.notes = j.changed?.notes ?? [];
    const n = j.changed?.impact?.length ?? 0;
    toast(T(`Saved: ${n} node${n === 1 ? "" : "s"} changed.`, `已儲存：${n} 個節點有變動。`));
    return {ok:true,data:j};
  } catch (e) { toast(T(`Not saved: ${e.message || e}`, `沒有儲存：${e.message || e}`)); return {ok:false,status:responseStatus,message:String(e.message||e)}; }
  finally { TM.busy = false; if (S.route?.name === "team") render(); }
}
const modelKey = (p, m) => (p && m ? `${p}/${m}` : "");
const PROVIDER_NAME = { codex: "Codex", claude: "Claude", cursor: "Cursor" };
const modelOf = (provider, model) => TM.data?.models?.find((m) => m.provider === provider && m.model === model);
// only the models detected on this machine, grouped by provider; the current model, when no longer detected, stays marked
function modelSelect(label, cur, onchange, extra = {}) {
  const detected = (TM.data?.models ?? []).filter((m) => m.available), stale = cur?.provider && cur?.model && !modelOf(cur.provider, cur.model)?.available;
  const groups = [...new Set([...detected.map((m) => m.provider), ...(stale ? [cur.provider] : [])])];
  const sel = h("select", { "aria-label": label, class: "tm-sel mono", onchange: (e) => onchange(e.target.value), "data-unavailable": stale ? "1" : null, ...extra },
    h("option", { value: "" }, T("— unassigned", "— 未指派")),
    groups.map((p) => h("optgroup", { label: PROVIDER_NAME[p] || p, "data-provider-group": p },
      stale && cur.provider === p ? h("option", { value: modelKey(cur.provider, cur.model), "data-unavailable": "" }, `${cur.model} · ${T("unavailable now", "目前不可用")}`) : null,
      detected.filter((m) => m.provider === p).map((m) => h("option", { value: modelKey(m.provider, m.model), "data-efforts": m.efforts.join(" ") }, m.unverified ? `${m.model} · ${T("unverified", "未驗證")}` : m.model)))));
  sel.value = modelKey(cur?.provider, cur?.model); return sel;
}
// the efforts the model reported; a model no longer detected keeps the general list (its own is unknown)
function effortSelect(label, cur, provider, onchange, extra = {}, model = null) {
  const own = modelOf(provider, model), efforts = own?.available ? own.efforts : TM.data?.efforts ?? ["low", "medium", "high", "xhigh"];
  const list = cur && !efforts.includes(cur) ? [...efforts, cur] : efforts;
  const sel = h("select", { "aria-label": label, class: "tm-sel", onchange: (e) => onchange(e.target.value === "default" ? null : e.target.value), ...extra },
    provider !== "codex" ? h("option", { value: "default" }, T("default", "預設")) : null, list.map((x) => h("option", { value: x }, efforts.includes(x) ? x : `${x} · ${T("not offered", "此模型不提供")}`)));
  sel.value = cur ?? "default"; return sel;
}
// ---------- what was detected ----------
const LOGIN = { "logged-in": ["signed in", "已登入"], "not-logged-in": ["not signed in", "未登入"], unknown: ["sign-in unknown", "登入狀態不明"] };
function detection() {
  const at = (t) => (t ? new Date(t).toLocaleTimeString() : T("not yet", "尚未偵測"));
  return h("section", { class: "card tm-detect", "data-model-detection": "", "aria-label": T("Models detected on this machine", "這台機器偵測到的模型"), "aria-busy": TM.detecting ? "true" : "false" },
    (TM.data.providers ?? []).map((p) => h("div", { class: `tm-prov ${p.state}`, "data-provider-status": p.provider, "data-state": p.state, "data-login": p.login },
      h("b", {}, PROVIDER_NAME[p.provider] || p.provider),
      h("span", { "data-login-label": "" }, T(...(LOGIN[p.login] || LOGIN.unknown))),
      h("span", { "data-model-count": String(p.count) }, p.state === "unread" ? T("not detected yet", "尚未偵測") : p.state === "unavailable" ? T("no models detected", "沒有偵測到模型") : T(`${p.count} model${p.count === 1 ? "" : "s"}`, `${p.count} 個模型`)),
      h("span", { class: "faint", "data-detected-at": p.detectedAt ?? "" }, `${T("detected at", "偵測時間")} ${at(p.detectedAt)}`),
      p.state === "unverified-fallback" ? h("span", { class: "tm-prov-why", "data-unverified": "" }, T(`Unverified list: ${p.reason || "the CLI's model list could not be read"}`, `未驗證的清單：${p.reason || "讀不到 CLI 的模型清單"}`)) :
        p.reason && p.state !== "detected" ? h("span", { class: "tm-prov-why" }, p.reason) : null)),
    h("button", { class: "btn ghost", "data-redetect": "", disabled: TM.detecting, onclick: () => load("force") }, TM.detecting ? T("Detecting…", "偵測中…") : T("Detect again", "重新偵測")));
}
// an assigned model the providers no longer report: the rules keep it, the page says so
function staleNote() {
  const stale = (TM.data.models ?? []).filter((m) => !m.available);
  return stale.length ? h("div", { class: "tm-adjust", role: "note", "data-models-note": "" },
    T(`Unavailable now: ${stale.map((m) => `${PROVIDER_NAME[m.provider] || m.provider} ${m.model}`).join(", ")}. The team still assigns ${stale.length === 1 ? "it" : "them"}, but ${stale.length === 1 ? "it was" : "they were"} not detected on this machine; a run on ${stale.length === 1 ? "it" : "them"} waits until it is available again. Pick a detected model, or sign in and detect again.`,
      `目前不可用：${stale.map((m) => `${PROVIDER_NAME[m.provider] || m.provider} ${m.model}`).join("、")}。團隊仍指派這些模型，但這台機器沒有偵測到；用到它的執行會等到它再次可用。請改選偵測到的模型，或登入後重新偵測。`)) : null;
}
// a pin as the team keeps it: version and both hashes (filesSha256 when the library gave it)
const pinOf = ({ id, v, sha256, filesSha256 }) => ({ id, v, sha256, ...(filesSha256 ? { filesSha256 } : {}) });
// a script skill's readiness after its chip (src/skillpkg: approved and prepared, text only, not approved, or what is missing)
const READY_WORD = { ready: ["Ready", "可以用"], "text-only": ["Text only", "只當文字"], preparing: ["Preparing", "準備中"], "needs-approval": ["Needs approval", "待核准"], "not-ready": ["Missing prerequisite", "缺少執行條件"] };
async function openSkillStatus(p, upgrade = false) {
  TM.skill = { pin: p, loading: true }; render();
  try { const facts = await getJson(`/api/team/skill?id=${encodeURIComponent(p.id)}&v=${p.v}`); TM.skill = { pin: p, ...facts, upgrade: upgrade && facts.status?.state === "text-only" }; }
  catch (e) { TM.skill = { pin: p, error: e.message || String(e) }; }
  render(); requestAnimationFrame(() => document.querySelector('[data-skill-status] button')?.focus());
}
function closeSkillStatus() {
  const p=TM.skill?.pin; TM.skill=null; render();
  requestAnimationFrame(()=>[...document.querySelectorAll('[data-skill-status-open]')].find(x=>x.dataset.skillStatusOpen===`${p?.id}@v${p?.v}`)?.focus());
}
async function skillAction(action) {
  const d=TM.skill;if(!d?.facts||d.busy)return;d.busy=true;d.error=null;render();
  try {
    const r=await fetch('/api/team/skill',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...pinOf(d.facts),action,...(action==='enable-scripts'?{previousDecision:d.decisionRevision}:{})})});
    const j=await r.json();if(!r.ok)throw new Error(T(j.error||'Not saved',j.tw||'沒有儲存'));
    TM.skill={pin:d.pin,...j};await load();
  }catch(e){d.busy=false;d.error=e.message||String(e);TM.skill=d;}
  render();requestAnimationFrame(()=>document.querySelector('[data-skill-status] button')?.focus());
}
function readyMark(p) {
  const b = TM.data?.skillStatus?.[`${p.id}@v${p.v}`]; if (!b) return null;
  const words=READY_WORD[b.state]||[b.en,b.zh];
  return h("button", {type:"button",class:`tm-ready ${b.state}`,"data-skill-ready":b.state,"data-skill-status-open":`${p.id}@v${p.v}`,title:T(b.en,b.zh),"aria-label":T(`${p.id}: ${words[0]}; view status and next steps`,`${p.id}：${words[1]}；查看原因與下一步`),onclick:()=>openSkillStatus(p)}, T(...words));
}
function skillStatusPanel() {
 const d=TM.skill;if(!d)return null;const f=d.facts,b=d.status,p=d.pin,words=READY_WORD[b?.state];
 return h('section',{class:'card tm-decide',role:'region','aria-label':T('Skill status and next steps','Skill 狀態與下一步'),'data-skill-status':`${p.id}@v${p.v}`},...[
  h('div',{class:'actions'},h('h2',{},`${p.id}@v${p.v}`),h('button',{type:'button',class:'btn ghost','data-status-close':'',disabled:d.busy,onclick:closeSkillStatus},T('Close','關閉'))),
  d.loading?h('p',{},T('Loading recorded status…','讀取實際狀態中…')):null,
  d.error?h('p',{role:'alert','data-status-error':'',class:'bad'},d.error):null,
  b?h('p',{'data-status-label':b.state},words?T(...words):T(b.en,b.zh)):null,
  b?.reasons?.map(r=>h('p',{'data-status-reason':''},T(r.en,r.zh))),
  f?[
   h('p',{class:'mono'},`${f.sha256.slice(0,12)} / ${f.filesSha256.slice(0,12)}`),
   h('p',{},T('Scripts this version runs:','這個版本會執行的 script：')),
   h('ul',{},f.scripts.map(x=>h('li',{class:'mono'},x.path,x.flags.length?` · ${x.flags.join(', ')}`:''))),
   h('p',{},T('Allowed network destinations: ','允許連線的網站：'),f.hosts.length?f.hosts.join(', '):T('none','不連網')),
   f.bins.length?h('p',{},T('Required programs: ','需要的程式：'),f.bins.join(', ')):null,
   h('button',{type:'button',class:'btn','data-status-source':'',onclick:(e)=>window.crewSkillView?.open({kind:'lib',id:p.id,v:p.v,pinned:p.v,name:p.id},e.currentTarget)},T('Inspect SKILL.md and exact script files','查看 SKILL.md 和實際 script 檔案')),
   b?.state==='needs-approval'?[
    h('p',{},T('Choose once for exactly this version, Studio-wide. Text only never runs scripts. Cancel leaves the current assignment unchanged.','只決定這個版本，全 Studio 生效。只當文字不會跑 script；取消會保留目前配置。')),
    h('div',{class:'actions'},h('button',{class:'btn primary','data-status-action':'scripts',disabled:d.busy,onclick:()=>skillAction('scripts')},T('Approve with scripts','核准（含 script）')),h('button',{class:'btn','data-status-action':'text-only',disabled:d.busy,onclick:()=>skillAction('text-only')},T('Text only','只當文字')),h('button',{class:'btn ghost','data-status-cancel':'',disabled:d.busy,onclick:closeSkillStatus},T('Cancel','取消')))
   ]:null,
   ['not-ready','preparing'].includes(b?.state)?[
    h('p',{'data-status-guidance':''},T('For a missing program, install the named prerequisite using its trusted instructions, then recheck. Studio retries only its supported preparation recipes under the existing approval; it cannot install every program. If no recipe exists, ask the skill author or choose another skill.','缺程式時，先依該程式的可信指引安裝，再重新檢查。Studio 只會依既有核准重試支援的準備方式，無法安裝所有程式；沒有支援方式時，請找 skill 作者或換用其他 skill。')),
    h('button',{type:'button',class:'btn primary','data-status-action':'retry',disabled:d.busy,onclick:()=>skillAction('retry')},d.busy?T('Checking…','檢查中…'):T('Recheck and retry preparation','重新檢查並重試準備'))
   ]:null,
   b?.state==='ready'?h('p',{},T('This version is approved and its recorded prerequisites are ready. Scripts run only inside the workflow sandbox.','這個版本已核准，記錄中的執行條件已就緒。Script 只會在 workflow sandbox 裡執行。')):null,
   b?.state==='text-only'?[
    h('p',{},T('Agents receive the skill text; its scripts will not run.','Agent 會收到 skill 文字，script 不會執行。')),
    d.upgrade?[
     h('p',{'data-status-upgrade-review':''},T('Review the exact script files and network destinations above. Enabling replaces text-only for this version across Studio, and retains the earlier decision in the audit history. No other version is approved.','請重新查看上方實際 script 檔案與連線網站。啟用會把全 Studio 這個版本改為可跑 script，原本只當文字的決定仍保留在紀錄中；不會核准其他版本。')),
     h('div',{class:'actions'},h('button',{type:'button',class:'btn primary','data-status-action':'enable-scripts',disabled:d.busy,onclick:()=>skillAction('enable-scripts')},T('Approve and enable scripts for this version','核准並啟用這個版本的 script')),h('button',{type:'button',class:'btn ghost','data-status-upgrade-cancel':'',disabled:d.busy,onclick:closeSkillStatus},T('Keep text only','維持只當文字')))
    ]:h('button',{type:'button',class:'btn','data-status-review-upgrade':'',disabled:d.busy,onclick:()=>openSkillStatus(p,true)},T('Review permissions to enable scripts','重新審閱權限以啟用 script'))
   ]:null,
   h('button',{type:'button',class:'btn ghost','data-status-refresh':'',disabled:d.busy,onclick:()=>openSkillStatus(p)},T('Refresh recorded status','重新讀取狀態'))
  ]:null].flat(Infinity));
}
// the captain's decision on a script skill a change brings: its scripts (with flags) and the hosts approving it allows
function decidePanel() {
  const d = TM.decide; if (!d) return null;
  const all = (how) => Object.fromEntries(d.skills.map((x) => [`${x.id}@v${x.v}`, how]));
  return h("section", { class: "card tm-decide", role: "dialog", "aria-label": T("Script skills in this change", "這個變更裡的 script skill"), "data-skill-decide": "" },
    h("h2", {}, T("This change brings skills that run scripts", "這個變更帶來會跑 script 的 skill")),
    d.skills.map((x) => h("div", { class: "tm-decide-skill", "data-decide-skill": `${x.id}@v${x.v}` },
      h("b", {}, `${x.id}@v${x.v}`), " ", h("span", { class: "faint mono" }, `${String(x.sha256).slice(0, 12)} / ${String(x.filesSha256).slice(0, 12)}`),
      h("ul", {}, x.scripts.slice(0, 12).map((sc) => h("li", { class: "mono" }, sc.path, sc.flags.length ? h("span", { class: "faint" }, ` · ${sc.flags.join(", ")}`) : null))),
      h("div", {}, T("Network when it runs: ", "執行時可連："), x.hosts.length ? x.hosts.join(", ") : T("none", "不連網")),
      x.bins?.length ? h("div", { class: "faint" }, T(`Programs: ${x.bins.join(", ")}`, `會用到的程式：${x.bins.join("、")}`)) : null)),
    h("p", { class: "faint" }, T("Approving covers exactly these versions, Studio-wide. Text only: agents get the skill's text and never run its scripts.", "核准只適用於這些版本（全 Studio）。只當文字：agent 只拿到文字，不跑 script。")),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", "data-decide": "scripts", disabled: TM.busy, onclick: () => submitSkillDecision(d, all("scripts")) }, T("Approve with scripts", "核准（含 script）")),
      h("button", { class: "btn", "data-decide": "text-only", disabled: TM.busy, onclick: () => submitSkillDecision(d, all("text-only")) }, T("Text only", "只當文字")),
      h("button", { class: "btn ghost", "data-decide": "cancel", onclick: () => { TM.decide = null; render(); } }, T("Don't add", "不搭載"))));
}
function skillAdd(label, have, onpick) {
  const sel = h("select", { "aria-label": label, class: "tm-add", onchange: (e) => { const s = TM.data.library.find((x) => x.id === e.target.value); if (s) onpick({ id: s.id, v: s.v, sha256: s.sha256, ...(s.filesSha256 ? { filesSha256: s.filesSha256 } : {}) }); } },
    h("option", { value: "" }, T("+ skill", "＋ skill")), (TM.data?.library ?? []).filter((s) => !have.includes(s.id)).map((s) => h("option", { value: s.id, title: s.description }, s.name || s.id)));
  sel.value = ""; return sel;
}
// ---------- the scope question ----------
function askPanel(wf, row) {
  const a = TM.ask; const what = a.field === "model" ? T("model", "模型") : "effort";
  const shown = a.field === "model" ? a.value.split("/").slice(1).join("/") || T("unassigned", "未指派") : a.value ?? T("default", "預設");
  // the nodes a member change reaches: those that follow the team for this field (a node this workflow set itself keeps it)
  const uses = (a.field === "model" ? seatOf(row.seat)?.usesModel : seatOf(row.seat)?.usesEffort) ?? 0;
  const set = a.field === "model" ? (() => { const [provider, ...m] = a.value.split("/"); return { provider, model: m.join("/") }; })() : { effort: a.value };
  return h("div", { class: "tm-ask", role: "group", "aria-label": T("Where to apply this change", "這個改動要套用到哪裡"), "data-scope-ask": row.node },
    h("span", { class: "tm-ask-t" }, T(`Change ${row.label}'s ${what} to ${shown}:`, `把「${row.label}」的${what}改成 ${shown}：`)),
    h("button", { class: "btn primary", "data-scope-here": "", disabled: TM.busy, onclick: () => change({ kind: "node", workflow: wf.id, node: row.node, set }) }, T("Only this workflow", "只改這個 workflow")),
    // in a project: the seat's member for every workflow of this project only
    TM.project ? (() => { const n = (a.field === "model" ? seatOf(row.seat)?.usesProjectModel : seatOf(row.seat)?.usesProjectEffort) ?? 0;
      return h("button", { class: "btn", "data-scope-project": "", disabled: TM.busy || !seatOf(row.seat)?.member, onclick: () => change({ kind: "project", project: TM.project, seat: row.seat, set }) },
        T(`Only this project (${projectName()}: affects ${n} node${n === 1 ? "" : "s"})`, `只改這個專案（${projectName()}：影響 ${n} 個節點）`)); })() : null,
    h("button", { class: "btn", "data-scope-team": "", disabled: TM.busy || !seatOf(row.seat)?.member && a.field !== "model", onclick: () => change({ kind: "member", seat: row.seat, set }) },
      T(`The whole “${seatName(row.seat)}” (affects ${uses} node${uses === 1 ? "" : "s"})`, `改整個「${seatName(row.seat)}」（影響 ${uses} 個節點）`)),
    h("button", { class: "btn ghost", onclick: () => { TM.ask = null; render(); } }, T("Cancel", "取消")));
}
// ---------- one node row ----------
// the role skill every turn of this node receives first (from the workflow's role, not editable here): name, Studio version, sha256
// A role skill Studio versions opens the skill viewer at that version (the text this node's turns receive)
function roleChip(row, wf) {
  const r = row.roleSkill; if (!r) return null;
  const sha = String(r.sha256 || "").slice(0, 8);
  const attrs = { class: "tm-skill role", "data-role-skill": r.ref || "", title: T(`Role skill ${r.ref || ""} · sha256 ${r.sha256 || ""}`, `角色 skill ${r.ref || ""} · sha256 ${r.sha256 || ""}`) };
  const kids = [h("span", { class: "tm-rk" }, T("Role", "角色")), `${r.name || r.ref}${r.version != null ? ` v${r.version}` : ""}${sha ? ` · ${sha}` : ""}`];
  return wf && r.role && r.version != null && window.crewSkillView ? window.crewSkillView.button({ kind: "role", workflow: wf.id, role: r.role, v: r.version, pinned: r.version, name: r.name || r.ref }, r.name || r.ref, attrs, ...kids) : h("span", attrs, ...kids);
}
// A library skill chip: its name opens the skill viewer at the version this node or seat pins (clicking changes nothing here)
const skillName = (p, text, cls = "tm-skill-open") => window.crewSkillView ? window.crewSkillView.button({ kind: "lib", id: p.id, v: p.v, pinned: p.v, name: p.name || p.id }, p.name || p.id, { class: cls }, text) : text;
// a judged check runs as its reviewing seat: shown so the captain sees who reviews; it follows that member (change it there)
function judgeRow(wf, row) {
  return h("div", { class: `tm-row tm-judge${row.source === "missing" ? " missing" : ""}`, "data-team-row": row.node, "data-team-judge": "" },
    h("div", { class: "tm-grid" },
      h("span", { class: "tm-node" }, h("b", {}, row.label), h("span", { class: "faint" }, T("check", "檢查"))),
      h("span", { class: "tm-cell" }, h("span", { class: "tm-k" }, T("Member", "成員")), seatName(row.seat)),
      h("span", { class: "tm-cell mono" }, h("span", { class: "tm-k" }, T("Model", "模型")), row.provider ? `${row.provider} · ${row.model}` : T("— unassigned", "— 未指派")),
      h("span", { class: "tm-cell" }, h("span", { class: "tm-k" }, "Effort"), row.effort ?? T("default", "預設")),
      h("span", { class: "tm-cell tm-wide" }, h("span", { class: "tm-k" }, "Skills"),
        h("span", { class: "tm-skills" }, roleChip(row, wf), (row.duty ?? []).map((p) => h("span", { class: "tm-skill own duty", title: T("This check's own skill", "這個檢查自己的 skill") }, skillName(p, `${p.name || p.id}@v${p.v}`)))),
        h("span", { class: "faint", "data-judge-order": "" }, T(`Follows “${seatName(row.seat)}”; change it on the member. Loads its role skill, then this check's skills, not the member's.`, `跟著「${seatName(row.seat)}」；要改請改成員。載入角色 skill，再載入這個檢查的 skill，不含成員的。`))),
      h("span", { class: `tm-src ${row.source}`, "data-source": row.source }, T(...(SOURCE[row.source] || [row.source, row.source])))),
    row.notes.length ? h("ul", { class: "tm-notes" }, row.notes.map((n) => h("li", {}, L(n)))) : null);
}
function nodeRow(wf, row) {
  if (row.judge) return judgeRow(wf, row);
  const asking = TM.ask?.workflow === wf.id && TM.ask?.node === row.node ? TM.ask : null;
  const member = h("select", { "aria-label": T(`${row.label}'s member`, `${row.label} 的成員`), class: "tm-sel", onchange: (e) => change({ kind: "node", workflow: wf.id, node: row.node, set: { seat: e.target.value } }) },
    (TM.data.seats ?? []).map((s) => h("option", { value: s.id }, L(s.label))));
  member.value = row.seat;
  const cur = asking?.field === "model" ? (() => { const [provider, ...m] = asking.value.split("/"); return { provider, model: m.join("/") }; })() : { provider: row.provider, model: row.model };
  const model = modelSelect(T(`${row.label}'s model`, `${row.label} 的模型`), cur, (v) => { TM.ask = { workflow: wf.id, node: row.node, field: "model", value: v }; render(); }, { "data-custom": row.fields.model === "workflow" || row.fields.model === "project" ? "1" : null });
  const effort = effortSelect(T(`${row.label}'s effort`, `${row.label} 的 effort`), asking?.field === "effort" ? asking.value : row.effort, row.provider, (v) => { TM.ask = { workflow: wf.id, node: row.node, field: "effort", value: v }; render(); }, { "data-custom": ["workflow", "run", "project"].includes(row.fields.effort) ? "1" : null }, row.model);
  const skills = h("div", { class: "tm-skills" }, roleChip(row, wf),
    row.skills.filter((p) => p.from === "member").map((p) => h("span", { class: "tm-skill base", title: T(`Comes with ${seatName(row.seat)}`, `來自成員「${seatName(row.seat)}」`) }, skillName(p, `${p.name || p.id}`), readyMark(p))),
    row.skills.filter((p) => p.from === "node").map((p) => h("span", { class: "tm-skill own" }, skillName(p, `${p.name || p.id}@v${p.v}`), readyMark(p),
      h("button", { class: "tm-x", "aria-label": T(`Remove ${p.name || p.id}`, `移除 ${p.name || p.id}`), onclick: () => change({ kind: "node", workflow: wf.id, node: row.node, set: {}, removeSkill: p.id }) }, "×"))),
    skillAdd(T(`Add a skill to ${row.label}`, `${row.label} 加 skill`), row.skills.map((p) => p.id), (pin) => change({ kind: "node", workflow: wf.id, node: row.node, set: {}, addSkill: pin })));
  const src = SOURCE[row.source] || [row.source, row.source];
  return h("div", { class: `tm-row${row.source === "missing" ? " missing" : row.custom ? " custom" : ""}`, "data-team-row": row.node },
    h("div", { class: "tm-grid" },
      h("span", { class: "tm-node" }, h("b", {}, row.label), h("span", { class: "faint mono" }, row.node)),
      h("label", { class: "tm-cell" }, h("span", { class: "tm-k" }, T("Member", "成員")), member),
      h("label", { class: "tm-cell" }, h("span", { class: "tm-k" }, T("Model", "模型")), model),
      h("label", { class: "tm-cell" }, h("span", { class: "tm-k" }, "Effort"), effort),
      h("div", { class: "tm-cell tm-wide" }, h("span", { class: "tm-k" }, "Skills"), skills),
      h("span", { class: `tm-src ${row.source}`, "data-source": row.source }, T(...src))),
    row.notes.length ? h("ul", { class: "tm-notes" }, row.notes.map((n) => h("li", {}, L(n)))) : null,
    asking ? askPanel(wf, row) : null);
}
// ---------- the member editor ----------
function memberEditor() {
  const seats = TM.data.seats.filter((s) => s.builtin || s.member || s.declared);
  return h("section", { class: "card tm-members", "data-member-editor": "", "aria-label": T("Team members", "團隊成員") },
    h("div", { class: "tm-mhead" }, h("h2", {}, T("Team members", "團隊成員")),
      h("div", { class: "tm-presets", role: "group", "aria-label": T("Presets", "預設組合") }, (TM.data.presets ?? []).map((p) => h("button", { class: "btn", "data-preset": p.id, disabled: TM.busy || !TM.data.team, onclick: () => change({ kind: "preset", preset: p.id }) }, T(p.en, p.zh)))),
      h("button", { class: "btn ghost", onclick: () => { TM.editing = false; render(); } }, T("Close", "關閉"))),
    h("p", { class: "faint" }, T("A change here reaches every node that follows the team. A node a workflow customised keeps its own choice.", "這裡的改動會套用到所有跟團隊走的節點；workflow 自訂過的節點維持自己的選擇。")),
    seats.map((s) => {
      const m = s.member, specialist = !s.builtin;
      return h("div", { class: "tm-member", "data-seat-editor": s.id },
        h("span", { class: "tm-mname" }, h("i", { class: "tm-dot", style: `background:${seatColor(s.id)}` }), h("b", {}, L(s.label)), specialist ? h("span", { class: "faint" }, T(" · specialist", " · 專家")) : null,
          h("span", { class: "faint" }, T(` · ${s.uses} node${s.uses === 1 ? "" : "s"}`, ` · ${s.uses} 個節點`))),
        modelSelect(T(`${L(s.label)}'s model`, `${L(s.label)} 的模型`), m, (v) => { if (!v) return; const [provider, ...rest] = v.split("/");
          change(specialist && !m ? { kind: "seat", seat: s.declared, member: { provider, model: rest.join("/"), effort: provider === "codex" ? "medium" : null, skills: [] } } : { kind: "member", seat: s.id, set: { provider, model: rest.join("/"), ...(m ? {} : { effort: provider === "codex" ? "medium" : null }) } }); }),
        m ? effortSelect(T(`${L(s.label)}'s effort`, `${L(s.label)} 的 effort`), m.effort, m.provider, (v) => change({ kind: "member", seat: s.id, set: { effort: v } }), {}, m.model) : h("span", { class: "tm-missing" }, T("Nobody yet", "還沒有人")),
        m ? h("div", { class: "tm-skills" }, m.skills.map((p) => h("span", { class: "tm-skill own" }, skillName(p, `${p.name || p.id}@v${p.v}`), readyMark(p),
            h("button", { class: "tm-x", "aria-label": T(`Remove ${p.name || p.id} from ${L(s.label)}`, `從「${L(s.label)}」移除 ${p.name || p.id}`), onclick: () => change({ kind: "member", seat: s.id, set: { skills: m.skills.filter((q) => q.id !== p.id).map(pinOf) } }) }, "×"))),
          skillAdd(T(`Add a skill to ${L(s.label)}`, `「${L(s.label)}」加 skill`), m.skills.map((p) => p.id), (pin) => change({ kind: "member", seat: s.id, set: { skills: [...m.skills.map(pinOf), pin] } }))) : h("span"));
    }));
}
// ---------- the page ----------
function card(w) {
  const on = TM.sel === w.id, b = w.badge;
  const badge = b.state === "missing" ? T("Missing", "缺人") : b.state === "custom" ? T(`${b.count} custom`, `${b.count} 項自訂`) : T("Follows team", "跟團隊");
  return h("button", { class: `tm-card${on ? " on" : ""}`, "aria-pressed": String(on), "data-team-card": w.id, onclick: () => { TM.sel = w.id; TM.ask = null; render(); } },
    h("span", { class: "tm-card-h" }, h("b", {}, w.displayName || w.name), h("span", { class: `tm-badge ${b.state}` }, badge)),
    h("span", { class: "tm-steps" }, w.nodes.map((n) => h("span", { class: `tm-step${n.source === "missing" ? " missing" : n.custom ? " custom" : ""}${n.judge ? " judge" : ""}`, title: `${n.label} · ${seatName(n.seat)}`, "data-step-seat": n.seat },
      h("i", { class: "tm-dot", style: `background:${seatColor(n.seat)}` }), n.judge ? "✓ " : "", n.label, n.custom ? " ★" : ""))),
    // a seat a role needs that no step shows (coffee's image worker): named, in red
    missingLine(w));
}
function missingLine(w) {
  const roles = w.missingRoles ?? [];
  return roles.length ? h("span", { class: "tm-missing-line", "data-missing-roles": w.id }, h("i", { class: "tm-dot", style: "background:var(--bad)" }),
    T(`Missing: ${roles.map((r) => `${r.seatLabel.en} (${r.label})`).join(", ")}`, `缺人：${roles.map((r) => `${r.seatLabel.zh}（${r.label}）`).join("、")}`)) : null;
}
const projectName = () => TM.data?.projects?.find((p) => p.id === TM.project)?.name || TM.project;
// which crew the page shows: the Studio-wide team, or one project's (the team with that project's own seat changes)
function projectPicker() {
  const list = TM.data?.projects ?? [];
  if (!list.length) return null;
  const sel = h("select", { class: "tm-sel", "data-team-project": "", "data-no-unsent":"", "aria-label": T("Show the crew of", "顯示哪裡的人員"), onchange: (e) => { TM.project = e.target.value; TM.ask = null; TM.notes = []; TM.data = null; load(); } },
    h("option", { value: "" }, T("Studio-wide team", "整個 Studio 的團隊")), list.map((p) => h("option", { value: p.id }, `${p.name}${p.custom ? " ◆" : ""}`)));
  sel.value = TM.project; return h("label", { class: "tm-project" }, h("span", { class: "tm-k" }, T("Project", "專案")), sel);
}
function legend() {
  return h("div", { class: "tm-legend", role: "group", "aria-label": T("Team members (open the member editor)", "團隊成員（打開成員編輯）") },
    TM.data.seats.filter((s) => s.builtin || s.member).map((s) => h("button", { class: `tm-leg${s.member ? "" : " empty"}`, "data-legend": s.id, onclick: () => { TM.editing = true; render(); requestAnimationFrame(() => document.querySelector(`[data-seat-editor="${s.id}"] select`)?.focus()); } },
      h("i", { class: "tm-dot", style: `background:${seatColor(s.id)}` }), L(s.label))),
    h("button", { class: "btn", "data-open-members": "", onclick: () => { TM.editing = !TM.editing; render(); } }, T("Edit team", "編輯團隊")));
}
function view() {
  // the page opens on what the server already knows, then detects again
  if (!TM.opened && !TM.loading) { TM.opened = true; (TM.data || TM.err ? load(true) : load().then(() => load(true))); }
  if (!TM.data) { return h("div", { class: "page tm" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Who runs each workflow", "每個 workflow 由誰在做")))), TM.err ? h("div", { class: "card x-pad bad" }, TM.err) : h("div", { class: "skel", style: "height:180px" })); }
  const wf = TM.data.workflows.find((w) => w.id === TM.sel) ?? null;
  const custom = wf?.nodes.some((n) => n.custom && n.source !== "project");
  const projectCustom = !!TM.project && TM.data.seats.some((s) => s.project);
  return h("div", { class: "page tm", "data-team-page": "" },
    h("div", { class: "phead" }, h("div", {}, h("span", { class: "tm-eyebrow" }, T("Crew · one team for every workflow", "船員 · 一個團隊負責所有 workflow")), h("h1", {}, T("Who runs each workflow", "每個 workflow 由誰在做")),
      h("p", {}, T("Pick a card, then change the model, effort or skills right in the table. Each change asks: only here, or the whole member.", "點一張卡，在下面直接改模型、effort、skills。每次改都會問：只改這裡，還是改整個成員。"))), h("div", { class: "tm-tools" }, projectPicker(), legend())),
    !TM.data.team ? h("div", { class: "card x-pad tm-empty", "data-team-empty": "" }, T("No team yet: every workflow uses Studio's default model. Fill the seats in the member editor.", "還沒有團隊：每個 workflow 都用 Studio 的預設模型。請在成員編輯裡補上各個位置。")) : null,
    detection(), staleNote(), skillStatusPanel(), decidePanel(),
    TM.editing ? memberEditor() : null,
    h("div", { class: "tm-cards" }, TM.data.workflows.map(card)),
    wf ? h("section", { class: "card tm-detail", "data-team-detail": wf.id, "aria-label": T(`${wf.displayName || wf.name}: final crew`, `${wf.displayName || wf.name}：最後的人員配置`) },
      h("div", { class: "tm-dhead" }, h("h2", {}, T(`${wf.displayName || wf.name}: who finally runs it`, `${wf.displayName || wf.name}：最後的人員配置`)),
        h("span", { class: "faint" }, T("Role: the workflow role's skill, loaded first. Grey skills come with the member; white ones are this node's.", "角色＝workflow 角色的 skill，最先載入；灰色 skill＝成員本身帶的；白色＝這個節點加的")),
        custom ? h("button", { class: "btn", "data-restore": wf.id, disabled: TM.busy, onclick: () => change({ kind: "restore", workflow: wf.id }) }, T("Restore to team", "恢復成團隊設定")) : null,
        projectCustom ? h("button", { class: "btn", "data-restore-project": TM.project, disabled: TM.busy, onclick: () => change({ kind: "project-restore", project: TM.project }) }, T(`Restore ${projectName()} to the team`, `${projectName()} 恢復成團隊設定`)) : null),
      h("div", { class: "tm-grid tm-head", "aria-hidden": "true" }, [T("Node", "節點"), T("Member", "成員"), T("Model", "模型"), "Effort", "Skills", T("Source", "來源")].map((x) => h("span", {}, x))),
      missingLine(wf),
      wf.nodes.map((n) => nodeRow(wf, n)),
      TM.notes.length ? h("div", { class: "tm-adjust", role: "status", "data-team-notes": "" }, h("b", {}, T("Adjusted by the team rules:", "團隊規則自動調整：")), h("ul", {}, TM.notes.map((n) => h("li", {}, `${wfName(n.workflow)} · ${n.node}: ${L(n)}`)))) : null) : null);
}
// Crew workspace keeps role defaults separate from workflow-specific assignments.
let crewSeat = null, crewNode = null, crewDraft = null, crewSection = 'team', crewReturnFocus = null, crewViewport = null, crewEntryQuery = null, crewFocusGeneration = 0;
const crewUses = id => (TM.data?.workflows || []).flatMap(w => w.nodes.filter(n => n.seat === id).map(n => ({workflow:w.displayName||w.name, ...n})));
const crewSource = row => T(...(SOURCE[row.source] || [row.source,row.source]));
window.pageDirty?.provide('crew-member-draft',()=>!!crewDraft);
const crewFoldState = new Map();
const crewFoldKey = key => JSON.stringify([TM.project || null,key]);
function foldCrew(key,label,...kids){
 const stateKey=crewFoldKey(key);
 return h('details',{class:'tm-simple-fold','data-crew-fold':key,open:crewFoldState.get(stateKey)||null,ontoggle:e=>{if(e.currentTarget.isConnected)crewFoldState.set(stateKey,e.currentTarget.open);}},h('summary',{onclick:e=>{if(!e.defaultPrevented)crewFoldState.set(stateKey,!e.currentTarget.parentElement.open);}},label),...kids);
}
function crewScrollSnapshot(){const main=document.querySelector('#main'),doc=document.scrollingElement;return {mainTop:main?.scrollTop||0,mainLeft:main?.scrollLeft||0,docTop:doc?.scrollTop||0,docLeft:doc?.scrollLeft||0};}
function crewRestoreViewport(view){if(!view||S.route?.name!=='team')return;const main=document.querySelector('#main'),doc=document.scrollingElement;if(main){main.scrollTop=view.mainTop;main.scrollLeft=view.mainLeft;}if(doc){doc.scrollTop=view.docTop;doc.scrollLeft=view.docLeft;}}
function crewAfterRender(callback){const generation=++crewFocusGeneration;requestAnimationFrame(()=>{if(generation===crewFocusGeneration&&S.route?.name==='team')callback();});}
function crewClose(){const viewport=crewViewport,selector=crewReturnFocus;crewDraft=null;crewSeat=null;crewNode=null;TM.ask=null;TM.skill=null;TM.decide=null;render();crewAfterRender(()=>{crewRestoreViewport(viewport);const target=selector?document.querySelector(selector):null;target?.focus({preventScroll:true});crewRestoreViewport(viewport);});}
const crewSectionScroll=new Map();
function crewSelectSection(section){crewSectionScroll.set(crewSection,crewScrollSnapshot());crewSection=section;render();crewAfterRender(()=>{crewRestoreViewport(crewSectionScroll.get(section)||{mainTop:0,mainLeft:0,docTop:0,docLeft:0});document.querySelector(`[data-crew-section="${section}"]`)?.focus({preventScroll:true});});}
window.addEventListener('keydown',e=>{if(S.route?.name!=='team'||!(crewSeat||crewNode)||document.querySelector('[data-skill-viewer], dialog[open]'))return;if(e.key==='Escape'){e.preventDefault();crewClose();}if(e.key==='Tab'){const drawer=document.querySelector('[data-crew-drawer]');const items=[...(drawer?.querySelectorAll('button,select,input,textarea,summary,a[href]')||[])].filter(x=>!x.disabled&&x.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
function crewOpen(seat,node=null){crewViewport=crewScrollSnapshot();const viewport=crewViewport;crewReturnFocus=node?`[data-crew-node="${CSS.escape(node)}"]`:seat==='*'?'[data-crew-manage]':`[data-crew-person="${CSS.escape(seat)}"]`;crewDraft=null;crewSeat=seat;crewNode=node;render();crewAfterRender(()=>{crewRestoreViewport(viewport);document.querySelector('[data-crew-drawer] select, [data-crew-drawer] button')?.focus({preventScroll:true});});}
function settleMemberDraft(draft,result){
 if(crewDraft!==draft)return;
 draft.saving=false;
 if(result?.ok)crewDraft=null;
 else{draft.error=result?.message||T('No save was confirmed. Your edits are retained.','未確認儲存成功，修改已保留。');if(result?.code==='skillDecision'&&TM.decide)TM.decide.draft=draft;}
 if(S.route?.name==='team')render();
}
async function submitSkillDecision(decision,choices){
 const draft=decision.draft;if(draft&&crewDraft===draft){draft.saving=true;render();}
 const result=await change(decision.change,choices,decision.expected,decision.project);
 if(draft)settleMemberDraft(draft,result);
}
async function saveMemberDraft(seat){
 const draft=crewDraft;if(!draft||draft.saving||!draft.model)return;
 draft.saving=true;draft.error=null;render();
 const [provider,...parts]=draft.model.split('/'),set={provider,model:parts.join('/'),effort:draft.effort??(provider==='codex'?'medium':null)};
 const result=await change(!seat?.builtin&&!seat?.member?{kind:'seat',seat:seat.declared,member:{...set,skills:[]}}:{kind:'member',seat:draft.seat,set},undefined,draft.expected);
 settleMemberDraft(draft,result);
}
function workspaceView(){
 const v=view();if(!v.hasAttribute('data-team-page'))return v;v.classList.add('tm-simple');
 const head=v.querySelector('.phead');head.replaceChildren(h('div',{},h('h1',{},T('Crew','船員')),h('p',{},T('People, models, and what needs attention.','誰負責、用什麼模型、有哪些事需要處理。'))),projectPicker()||'');
 v.querySelector('.tm-members')?.remove();
 const people=h('section',{class:'tm-people','aria-label':T('People and models','船員與模型')},TM.data.seats.filter(s=>s.builtin||s.member||s.declared).map(s=>{
  const used=crewUses(s.id),custom=used.filter(n=>n.custom||Object.values(n.fields||{}).some(source=>source==='workflow'||source==='project')).length;
  const pending=(s.member?.skills||[]).filter(p=>{const x=TM.data.skillStatus?.[`${p.id}@v${p.v}`];return x&&!['ready','text-only'].includes(x.state);}).length;
  const models=[...new Set(used.filter(n=>n.model).map(n=>n.model))],effective=s.member?.model||(models.length===1?models[0]:models.length?T('Varies by workflow','依流程個別設定'):null);
  const efforts=[...new Set(used.filter(n=>n.model).map(n=>n.effort||T('default','預設')))],shownEffort=s.member?(s.member.effort||T('default','預設')):efforts.length===1?efforts[0]:efforts.length?T('varies by workflow','依流程個別設定'):null;
  return h('button',{type:'button',class:'tm-person','data-crew-person':s.id,onclick:()=>crewOpen(s.id)},
   h('span',{class:'tm-person-role'},h('b',{},h('i',{class:'tm-dot',style:`background:${seatColor(s.id)}`}),L(s.label)),h('small',{},T(`${used.length} nodes${s.builtin?'':' · specialist'}`,`${used.length} 個節點${s.builtin?'':' · 專家位置'}`))),
   h('span',{class:'tm-person-effective'},h('span',{},effective||T('No team default yet','尚無團隊預設')),h('small',{},shownEffort?`Effort ${shownEffort}`:T('Choose once for this role','為這個角色設定預設'))),
   h('span',{class:'tm-person-scope'},s.member?T('Team default','團隊預設'):effective?T('Workflow assignments only','僅個別流程配置'):T(s.builtin?'Required role':'Optional specialist',s.builtin?'必要角色':'選用專家'),h('small',{},s.project?T('This project has additional overrides','此專案另有自訂設定'):custom?T(`${custom} workflow/project overrides`,`${custom} 個流程／專案自訂`):T('No workflow overrides','沒有流程自訂'))),
   h('span',{class:pending?'tm-attention':'tm-person-action'},pending?T(`${pending} skill(s) need attention`,`${pending} 個 skill 待處理`):T('Configure','設定')));
 }));if(crewSection==='team')head.after(people);
 const detect=v.querySelector('.tm-detect');if(detect&&crewSection!=='team')detect.remove();else if(detect){const mark=h('span');detect.before(mark);mark.replaceWith(foldCrew('model-detection',T('Model availability and detection','模型可用狀態與偵測'),detect));}
 const cards=v.querySelector('.tm-cards'),detail=v.querySelector('[data-team-detail]');
 if(cards&&detail){const wf=TM.data.workflows.find(w=>w.id===TM.sel);const rows=h('div',{class:'tm-workflow-people'},wf.nodes.map(n=>h('button',{type:'button',class:'tm-workflow-person','data-crew-node':n.node,onclick:()=>crewOpen(n.seat,n.node)},h('b',{},n.label),h('span',{},seatName(n.seat)),h('span',{class:'tm-node-effective'},n.model||T('No effective model','尚無生效模型'),h('small',{},`Effort ${n.effort||T('default','預設')} · ${crewSource(n)}`)),T('Settings','設定'))));const restore=[...detail.querySelectorAll('[data-restore],[data-restore-project]')];detail.replaceChildren(h('h2',{},wf.displayName||wf.name),missingLine(wf),rows,restore.length?foldCrew(`restore:${TM.sel}`,T('Restore assignment defaults','恢復配置預設'),...restore):'');const holder=h('div');cards.before(holder);if(crewSection==='workflows'){const picker=h('select',{class:'tm-sel','data-crew-workflow-picker':'','data-no-unsent':'','aria-label':T('Workflow','流程'),onchange:e=>{TM.sel=e.target.value;TM.ask=null;render();}},TM.data.workflows.map(w=>h('option',{value:w.id},w.name)));picker.value=TM.sel;holder.append(h('section',{'data-crew-workflow-view':'','aria-label':T('Workflow assignments','流程個別配置')},h('label',{class:'tm-edit-field'},h('span',{},T('Workflow','流程')),picker),detail,foldCrew('workflow-overview',T('All workflow assignment summaries','所有流程配置摘要'),cards)));}else{cards.remove();detail.remove();}}
 if(crewSection==='team')v.append(foldCrew('team-advanced',T('Team presets and advanced settings','團隊預設組合與進階設定'),h('button',{class:'btn','data-crew-manage':'',onclick:()=>crewOpen('*')},T('Manage all members and presets','管理全部船員與預設組合'))));
 if(crewSection==='workflows'){v.querySelector('[data-team-empty]')?.remove();v.querySelector('[data-models-note]')?.remove();}
 const sectionTabs=h('nav',{class:'tm-section-tabs','aria-label':T('Crew settings areas','船員設定分頁')},...['team','workflows'].map(section=>h('button',{type:'button',class:crewSection===section?'on':'','data-crew-section':section,'aria-pressed':String(crewSection===section),onclick:()=>crewSelectSection(section)},section==='team'?T('Team defaults','團隊預設'):T('Workflow assignments','流程個別配置'))));head.after(sectionTabs);
 const skill=v.querySelector('[data-skill-status]'),decision=v.querySelector('[data-skill-decide]');
 if(crewSeat||crewNode||skill||decision){const wf=TM.data.workflows.find(w=>w.id===TM.sel),row=wf?.nodes.find(n=>n.node===crewNode),seat=seatOf(crewSeat);let editor;
  if(row){editor=nodeRow(wf,row);const grid=editor.querySelector('.tm-grid');if(grid){const cells=[...grid.children];grid.append(foldCrew(`node-skills:${TM.sel}:${crewNode}`,T('Skills and configuration source','Skills 與設定來源'),...cells.slice(4)));}}
  else{editor=memberEditor();if(crewSeat!=='*'){
   editor.querySelectorAll('[data-seat-editor]').forEach(el=>{if(el.dataset.seatEditor!==crewSeat)el.remove();});
   const member=editor.querySelector('.tm-member');
   if(member){
    const m=seat?.member,modelValue=crewDraft?.seat===crewSeat?crewDraft.model:modelKey(m?.provider,m?.model),effortValue=crewDraft?.seat===crewSeat?crewDraft.effort:m?.effort;
    const edit=(key,value)=>{crewDraft??={seat:crewSeat,expected:TM.data?.team?.hash??null,model:modelKey(m?.provider,m?.model),effort:m?.effort??null};crewDraft[key]=value;if(key==='model'&&value.startsWith('codex/')&&!crewDraft.effort)crewDraft.effort='medium';crewDraft.error=null;render();crewAfterRender(()=>document.querySelector(`[data-crew-edit-${key}]`)?.focus({preventScroll:true}));};
    const [provider,...rest]=modelValue.split('/');
    const model=modelSelect(T('Default model','預設模型'),{provider,model:rest.join('/')},value=>edit('model',value),{'data-crew-edit-model':'','data-no-unsent':''});
    const effort=effortSelect(T('Default effort','預設 effort'),effortValue,provider,value=>edit('effort',value),{'data-crew-edit-effort':'','data-no-unsent':''},rest.join('/'));
    const originalSkills=member.querySelector('.tm-skills');
    const uses=crewUses(crewSeat),usedBy=h('section',{class:'tm-used-by'},h('h3',{},T('Used by','套用到哪裡')),uses.length?h('ul',{},uses.map(n=>h('li',{},h('b',{},`${n.workflow} · ${n.label}`),h('small',{},`${n.model||T('no model','尚無模型')} · Effort ${n.effort||T('default','預設')} · ${crewSource(n)}`)))):h('p',{class:'faint'},T('No workflow currently uses this role.','目前沒有流程使用這個角色。')));
    const advanced=foldCrew(`member-skills:${crewSeat}`,T('Skills and script permissions','Skills 與 script 權限'),originalSkills||h('p',{class:'faint'},T('Choose a model to configure this member’s skills.','先選擇模型，再設定這位船員的 skills。')));
    if(!crewFoldState.has(crewFoldKey(`member-skills:${crewSeat}`)))advanced.open=(m?.skills||[]).some(p=>{const x=TM.data.skillStatus?.[`${p.id}@v${p.v}`];return x&&!['ready','text-only'].includes(x.state);});
    member.replaceChildren(h('label',{class:'tm-edit-field'},h('span',{},T('Default model','預設模型')),model),h('label',{class:'tm-edit-field'},h('span',{},T('Effort','推理強度')),effort),!m?h('p',{class:'tm-empty-guidance'},T('Set one default for this role. Workflow-specific choices remain unchanged.','為這個角色設定一次預設；流程已自訂的配置會保留。')):'',usedBy,advanced);
    if(!(TM.data.models||[]).some(x=>x.available)){model.disabled=!m?.model;member.prepend(h('section',{class:'tm-empty-guidance'},h('p',{},T('No available model was detected. Inspect the account before choosing a role default.','尚未偵測到可用模型，先確認帳號，再選擇這個角色的預設。')),h('button',{type:'button',class:'btn primary',onclick:()=>{crewClose();crewAfterRender(()=>{const target=document.querySelector('[data-model-detection]');const fold=target?.closest('details');if(fold)fold.open=true;target?.scrollIntoView({block:'nearest'});target?.querySelector('button')?.focus();});}},T('Inspect model availability','查看模型來源'))));}
   }
   const presets=editor.querySelector('.tm-presets');if(presets){const mark=h('span');presets.before(mark);mark.replaceWith(foldCrew(`member-presets:${crewSeat}`,T('Apply a team preset','套用團隊預設組合'),presets));}
  }editor.querySelector('.tm-mhead > button')?.remove();}
  let footer='';
  if(crewDraft&&crewSeat!=='*'&&!row){footer=h('footer',{class:'tm-crew-footer'},h('p',{role:'status','data-crew-save-status':''},crewDraft.error||T('Unsaved changes to the Studio-wide role default.','尚未儲存的 Studio 全域角色預設。')),h('div',{class:'actions'},h('button',{class:'btn',disabled:crewDraft.saving,onclick:()=>{if(TM.decide?.draft===crewDraft)TM.decide=null;crewDraft=null;render();}},T('Cancel changes','取消修改')),h('button',{class:'btn primary','data-crew-save':'',disabled:!crewDraft.model||crewDraft.saving||TM.busy,onclick:()=>saveMemberDraft(seat)},crewDraft.saving?T('Saving…','儲存中…'):T('Save changes','儲存修改'))));}


  v.append(h('div',{class:'tm-crew-backdrop',onclick:e=>{if(e.target===e.currentTarget)crewClose();}},h('section',{class:'tm-crew-drawer',role:'dialog','aria-modal':'true','aria-label':T('Crew settings','船員設定'),'data-crew-drawer':''},h('header',{},h('div',{},h('h2',{},row?.label||(seat?L(seat.label):T('Team settings','團隊設定'))),h('p',{class:'faint'},row?T('Keep the original workflow, project and member scope choices.','修改時可選流程、專案或整個成員的套用範圍。'):T('Studio-wide default. Workflow and project overrides keep their own settings.','Studio 全域預設；流程與專案自訂的配置會保留。'))),h('button',{type:'button',class:'btn','data-crew-drawer-close':'',onclick:crewClose},T('Close','關閉'))),h('div',{class:'tm-crew-drawer-body'},skill||'',decision||'',editor),footer)));
 }return v;
}
// Crew (the sidebar item) is two tabs: the team (#/team, where the sidebar opens) and its rounds and activity (#/crew,
// whose deep links #/crew/<actor> keep working)
const crewTabs = (on) => h("nav", { class: "tm-tabs", "aria-label": T("Crew", "船員"), "data-crew-tabs": on },
  h("a", { href: "#/team", "data-crew-tab": "team", "aria-current": on === "team" ? "page" : null, ...(on === "team" ? {} : { "data-team-link": "" }) }, icon("crew", "ic sm"), T("Team", "團隊")),
  h("a", { href: "#/crew", "data-crew-tab": "rounds", "aria-current": on === "rounds" ? "page" : null }, icon("activity", "ic sm"), T("Rounds & activity", "回合與紀錄")));
// code-firstmate and coffee-kit run on a crew the captain approves for each project (public/takeover.js's panel): it
// lives here, folded, and opens by itself for a link that asks for it (#/team?staffing=<project>&workflow=<id>)
function staffingSection() {
  const q = S.route?.query, asked = !!(q?.get("staffing") || q?.get("workflow"));
  const panel = window.crewStaffingPanel?.(); if (!panel) return null;
  return h("details", { class: "card tm-staffing", "data-team-staffing": "", open: asked || TM.staffingOpen || null, ontoggle: (e) => { TM.staffingOpen = e.target.open; } },
    h("summary", {}, h("b", {}, T("A project's own approved crew", "專案自己核准的人員")), " ",
      h("span", { class: "faint" }, T(`${wfName("code-firstmate")} and ${wfName("coffee-kit")} run on a crew you approve for each project.`, `${wfName("code-firstmate")} 和 ${wfName("coffee-kit")} 用你按專案核准的人員。`))), panel);
}
routes.team = () => {
  if(!TM.opened)crewEntryQuery=null;
  const q=S.route?.query,entry=JSON.stringify([q?.get('staffing')||null,q?.get('workflow')||null]);
  if(entry!==crewEntryQuery){crewEntryQuery=entry;if(q?.get('staffing')||q?.get('workflow'))crewSection='workflows';}
  const v=workspaceView();v.prepend(crewTabs('team'));
  if(window.crewTeamSetup&&crewSection==='team'){
    const setup=window.crewTeamSetup(null,()=>{TM.data=null;void load();}),missing=(TM.data?.seats||[]).filter(s=>s.builtin&&!s.member).length;
    const setupFold=foldCrew('onboarding',TM.data?missing?T(`${missing} required roles need defaults · set up crew`,`${missing} 個必要角色尚無團隊預設 · 設定船員`):T('Crew assigned · review account and setup','船員已配置 · 查看帳號與準備設定'):T('Crew setup · review configuration','船員設定 · 查看配置'),setup);
    setupFold.classList.add('tm-setup-fold');setupFold.dataset.crewSetupFold='';v.prepend(setupFold);
  }
  if(v.hasAttribute('data-team-page')&&crewSection==='workflows')v.append(staffingSection()??'');return v;
};
{ const base = routes.crew; routes.crew = (arg) => { const v = base(arg);
  if (!arg && v?.prepend && !v.querySelector?.("[data-crew-tabs]")) v.prepend(crewTabs("rounds")); return v; }; }
// a team change elsewhere (a captain card answer) refreshes an open page
window.liveListen?.("team", () => { TM.data = null; if (S.route?.name === "team") load(); });
})();
