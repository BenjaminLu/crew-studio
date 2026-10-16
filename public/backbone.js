// The backbone sidebar (docs/architecture.md §2): exactly Board, Firstmate, Inbox,
// Crew, Runs, Workflows, Library, plus a gear for Settings. Everything else is a
// lab: hidden from the sidebar and the home page unless "Show labs" is on
// (Settings, or ?labs=1). A labs link without the flag shows a small roadmap
// panel instead of a 404. Loaded last, so every module has registered its routes.
(() => {
const BACKBONE = [
  ["board", "board", "Board", "看板"], ["firstmate", "message", "Firstmate", "Firstmate"], ["inbox", "inbox", "Inbox", "收件匣"], ["crew", "crew", "Crew", "船員"],
  ["runs", "play", "Tasks", "任務"], ["workflows", "workflow", "Workflows", "流程"], ["library", "library", "Library", "成品庫"],
];
// planned work, by milestone: these routes are labs
const ROADMAP = [
  { id: "skins", routes: ["skins"], m: "M4/M5", en: "Skins: a sandboxed, read-only face over Studio (Voyage, Terminal).", tw: "外觀：在 Studio 之上的沙箱唯讀介面（Voyage、Terminal）。" },
  { id: "improve", routes: ["improve", "retro", "edit", "skill"], m: "M6", en: "Improve and retro: skill edits from chat, replay evals, retro proposals.", tw: "改進與回顧：從對話改 skill、重播評測、回顧提案。" },
  { id: "packs", routes: ["packs", "pack-draft", "pack"], m: "M7", en: "Domain packs and pack genesis: a new way of working, authored as a workflow.", tw: "領域套件與套件生成：用流程來撰寫新的工作方式。" },
  { id: "fileorg", routes: ["fileorg"], m: "M7", en: "File organization: a dry-run plan, review, apply with an undo log.", tw: "檔案整理：試跑計畫、審閱、帶復原紀錄地套用。" },
  { id: "docs", routes: ["docs", "doc"], m: "M8", en: "Documents: draft, annotate, revise, export (md, html, docx, pdf).", tw: "文件：草稿、標註、修訂、匯出（md、html、docx、pdf）。" },
  { id: "changes", routes: ["changes", "change", "gates"], m: "M3/gates", en: "Changes and the gates page: moving into Tasks and the workflow editor.", tw: "變更與閘門頁：正併入「任務」和流程編輯器。" },
  { id: "remote", routes: ["remote"], m: "M2.5", en: "Phone pairing: Studio on your phone over Wi-Fi or Tailscale.", tw: "手機配對：透過 Wi-Fi 或 Tailscale 在手機上用 Studio。" },
];
const LABS = new Map(ROADMAP.flatMap((r) => r.routes.map((x) => [x, r])));
const OWNED = { activity: "crew", intents: "inbox", review: "runs", compare: "runs", artifact: "library", run: "runs", workflow: "workflows", flow: "workflows", settings: "settings", doctor: "settings", roadmap: "settings", task: "crew", event: "crew" };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} } };
if (/[?&]labs=1\b/.test(location.search)) store.set("crew.labs", "1");
const labsOn = () => store.get("crew.labs") === "1";
window.crewLabs = labsOn;

// ---------- the sidebar ----------
const nav = $(".nav");
const item = (view, ic, en, tw) => {
  let b = nav.querySelector(`.nav-item[data-view="${view}"]`);
  if (!b) { b = h("button", { class: "nav-item", "data-view": view, "data-tip": T(en, tw) }, icon(ic), h("span", { class: "nl" }, T(en, tw))); b.addEventListener("click", () => { location.hash = `#/${view}`; }); }
  else { b.dataset.tip = T(en, tw); const nl = b.querySelector(".nl"); if (nl) nl.textContent = T(en, tw); }
  b.dataset.backbone = "1"; return b;
};
const labsGroup = h("div", { class: "nav-labs", "data-labs": "1", hidden: true }, h("div", { class: "nav-labs-h" }, T("Labs", "實驗中")));
const gear = h("button", { class: "btn ghost icon side-gear", id: "navSettings", "data-view": "settings", onclick: () => { location.hash = "#/settings"; } }, icon("tool"));
function arrange() {
  const keep = BACKBONE.map(([v, ic, en, tw]) => item(v, ic, en, tw));
  const others = [...nav.querySelectorAll(".nav-item")].filter((b) => !b.dataset.backbone);
  nav.replaceChildren(...keep, labsGroup);
  for (const b of others) { if (["activity", "intents", "workflow", "doctor"].includes(b.dataset.view)) { b.hidden = true; labsGroup.after(b); continue; } b.dataset.lab = "1"; labsGroup.append(b); }
  labsGroup.hidden = !labsOn();
  // attention counts live on backbone items: Board and Inbox carry the decisions (the Inbox is decisions only), the gear the Doctor's
  const doc = document.getElementById("navDoctor"); if (doc && doc.parentElement !== gear) gear.append(doc);
}
arrange();
// a module that adds an item later lands in labs too; the observer stops watching while it rearranges, so it never re-triggers itself
const navObs = new MutationObserver((ms) => {
  if (!ms.some((m) => [...m.addedNodes].some((n) => n.classList?.contains("nav-item") && !n.dataset.backbone && !n.dataset.lab && !n.hidden))) return;
  navObs.disconnect(); try { arrange(); } finally { navObs.observe(nav, { childList: true, subtree: true }); }
});
navObs.observe(nav, { childList: true, subtree: true });
$(".side-foot").prepend(gear);
// every label follows the language switch: nothing is computed once at load
const relabel = () => { for (const [v, ic, en, tw] of BACKBONE) item(v, ic, en, tw); gear.setAttribute("aria-label", T("Settings", "設定")); gear.title = T("Settings", "設定");
  labsGroup.querySelector(".nav-labs-h").textContent = T("Labs", "實驗中"); const ints = document.getElementById("navIntents"); if (ints) ints.title = T("Open intents", "進行中的意圖"); };
relabel();
{ const prev = window.onLang; window.onLang = () => { prev?.(); relabel(); }; }

// sub-pages light their section
const mark = () => {
  const n = S.route?.name; const o = OWNED[n] ?? (LABS.has(n) ? null : n);
  $$(".nav-item").forEach((b) => (b.dataset.view === o ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  n === "settings" || o === "settings" ? gear.setAttribute("aria-current", "page") : gear.removeAttribute("aria-current");
};
addEventListener("hashchange", () => setTimeout(mark, 0));

// ---------- labs routes: the real page with the flag, a roadmap panel without ----------
const roadmapPanel = (name) => { const r = LABS.get(name);
  return h("div", { class: "page" }, h("div", { class: "card x-pad bb-roadmap", "data-roadmap-panel": name },
    h("div", { class: "x-row wrap" }, h("span", { class: "badge" }, h("span", { class: "d" }), T("planned", "規劃中")), h("b", {}, T("This is on the roadmap", "這在路線圖上")), h("span", { class: "faint" }, r ? r.m : "")),
    h("p", {}, r ? T(r.en, r.tw) : ""),
    h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => { store.set("crew.labs", "1"); labsGroup.hidden = false; route(); } }, T("Show labs", "顯示實驗功能")), h("a", { class: "btn ghost", href: "#/roadmap" }, T("Roadmap", "路線圖"))))); };
for (const name of LABS.keys()) { const orig = routes[name]; routes[name] = (arg) => (labsOn() && orig ? orig(arg) : roadmapPanel(name)); }

// ---------- backbone pages this file owns until their units land ----------
const page = (title, sub, ...kids) => h("div", { class: "page" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null)), ...kids);
routes.firstmate = routes.firstmate || (() => page(T("Firstmate", "Firstmate"), T("Chat with firstmate and take over its session.", "和 firstmate 對話，接手它的 session。"),
  h("div", { class: "card x-pad" }, h("p", {}, T("The chat drives firstmate's main session: ask how things stand, say what you want done, approve its permission prompts.", "對話會驅動 firstmate 的主 session：問進度、交代要做的事、核准它的權限請求。")),
    h("div", { class: "actions" }, h("button", { class: "btn primary", id: "openChat", onclick: () => { document.body.classList.remove("chat-closed"); $("#chatIn")?.focus(); } }, icon("message", "ic sm"), T("Open the chat", "開啟對話"))))));
routes.settings = () => page(T("Settings", "設定"), T("Doctor, keys and phone pairing, the labs switch, and the operating rules every job gets.", "健康檢查、金鑰、手機配對、實驗功能開關，以及每個工作都會收到的作業規則。"),
  h("div", { class: "card x-pad bb-settings" },
    h("a", { class: "bb-set", href: "#/doctor" }, icon("tool"), h("span", {}, h("b", {}, T("Doctor", "健康檢查")), h("span", { class: "faint" }, T("What works, what is missing, one-click installs, API keys.", "哪些可用、缺什麼、一鍵安裝、API 金鑰。")))),
    h("a", { class: "bb-set", href: "#/remote" }, icon("monitor"), h("span", {}, h("b", {}, T("Phone pairing", "手機配對")), h("span", { class: "faint" }, T("Planned (labs).", "規劃中（實驗功能）。")))),
    h("a", { class: "bb-set", href: "#/roadmap" }, icon("target"), h("span", {}, h("b", {}, T("Roadmap", "路線圖")), h("span", { class: "faint" }, T("What is planned next, by milestone.", "接下來的規劃，依里程碑。")))),
    h("label", { class: "bb-set" }, h("input", { type: "checkbox", id: "labsToggle", checked: labsOn(), onchange: (e) => { store.set("crew.labs", e.target.checked ? "1" : null); labsGroup.hidden = !e.target.checked; } }),
      h("span", {}, h("b", {}, T("Show labs", "顯示實驗功能")), h("span", { class: "faint" }, T("Adds the planned pages to the sidebar. They work, but they are not the backbone.", "把規劃中的頁面加回側邊欄；可以用，但不是主幹功能。"))))),
  rulesEditor());
// The captain's operating rules: one Studio-wide text and one per project, sent to every
// worker, reviewer, judge, media job and Firstmate. Edited here only (this Mac's page session).
function rulesEditor() {
  const scope = h("select", { id: "rulesScope", "aria-label": T("Rules for", "規則適用於") }, h("option", { value: "" }, T("Studio-wide (every job)", "Studio 全域（所有工作）")));
  const text = h("textarea", { id: "rulesText", rows: 9, spellcheck: "false", maxlength: "8000", "aria-label": T("Operating rules", "作業規則"), placeholder: T("One rule per line, plain text.", "一行一條規則，純文字。") });
  const count = h("span", { class: "faint bb-rules-count" }), state = h("span", { class: "faint", id: "rulesState", role: "status" });
  const save = h("button", { class: "btn primary", id: "rulesSave", disabled: true }, T("Save rules", "儲存規則"));
  const reset = h("button", { class: "btn ghost", id: "rulesDefault", disabled: true }, T("Use the default text", "改用預設內容"));
  let data = null, loaded = "";
  const entry = () => !data ? null : scope.value ? data.projects.find((p) => p.id === scope.value) : data.studio;
  const meta = (e) => !e ? "" : e.unreadable ? T(`Could not read the stored rules (${e.unreadable}). Every prompt says the rules are unreadable until the file is fixed.`, `無法讀取已儲存的規則（${e.unreadable}）。修好檔案前，每個提示都會寫明規則無法讀取。`) : !e.text ? T("None set: prompts say so explicitly.", "未設定：提示中會明確寫出「未設定」。") : e.updatedAt ? T(`Saved ${new Date(e.updatedAt).toLocaleString(document.documentElement.lang || undefined)}${e.by === "studio-default" ? " (first-run default)" : ""}`, `已儲存於 ${new Date(e.updatedAt).toLocaleString(document.documentElement.lang || undefined)}${e.by === "studio-default" ? "（首次啟動預設）" : ""}`) : "";
  const def = () => !data ? "" : document.documentElement.lang === "zh-TW" && data.defaultsZhTW ? data.defaultsZhTW : data.defaults;
  const sync = () => { count.textContent = `${text.value.length} / ${data?.max ?? 8000}`; save.disabled = !data || text.value === loaded || !!entry()?.unreadable; reset.hidden = !!scope.value; reset.disabled = !data || text.value === def(); };
  let shown = "";
  const show = () => { const e = entry(); shown = scope.value; loaded = e?.text ?? ""; text.value = loaded; state.textContent = meta(e); state.classList.toggle("bb-rules-bad", !!e?.unreadable); sync(); };
  const fill = (d) => { data = d; const keep = scope.value; scope.replaceChildren(scope.firstChild, ...d.projects.map((p) => h("option", { value: p.id }, T(`Project: ${p.name}`, `專案：${p.name}`)))); scope.value = d.projects.some((p) => p.id === keep) ? keep : ""; show(); };
  // switching scope never drops an unsaved edit silently
  scope.onchange = () => { if (text.value !== loaded && !confirm(T("Discard your unsaved changes to these rules?", "要捨棄這份規則尚未儲存的修改嗎？"))) { scope.value = shown; return; } show(); };
  text.oninput = sync;
  reset.onclick = () => { text.value = def(); sync(); };
  save.onclick = async () => {
    save.disabled = true; state.textContent = T("Saving…", "儲存中…");
    try { const r = await fetch("/api/operating-rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: scope.value || null, text: text.value }) });
      const d = await r.json().catch(() => ({})); if (!r.ok) { state.textContent = d.error || T("Not saved", "未儲存"); sync(); return; }
      fill(d); state.textContent = T("Saved. The next job and the next round get this text.", "已儲存。下一個工作和下一回合會收到這份內容。"); }
    catch { state.textContent = T("Not saved", "未儲存"); sync(); }
  };
  fetch("/api/operating-rules").then((r) => r.ok ? r.json() : Promise.reject(r.status)).then(fill).catch(() => { state.textContent = T("The rules could not be read.", "無法讀取規則。"); });
  return h("section", { class: "card x-pad bb-rules", "data-operating-rules": "1" },
    h("div", { class: "bb-rules-head" }, h("h2", {}, T("Operating rules", "作業規則")),
      h("p", { class: "faint" }, T("Standing rules every job gets. Workers, reviewers, judges and image jobs receive them in their instructions, right after Studio's safety rules; Firstmate receives them in its first message, and again after a takeover, a resume, a compaction or an edit. Only you edit them, here on this Mac.", "每個工作都會收到的常設規則。worker、reviewer、judge 和圖片工作會在指示中收到，緊接在 Studio 安全規則之後；Firstmate 則在第一則訊息收到，接手、恢復、對話壓縮或規則修改後會再收到一次。只有你能在這台 Mac 上編輯。"))),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Rules for", "規則適用於")), scope),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Rules (plain text)", "規則（純文字）")), text),
    h("div", { class: "bb-rules-foot" }, count, state, h("span", { class: "x-grow" }), reset, save));
}
routes.roadmap = () => page(T("Roadmap", "路線圖"), T("Planned work outside the backbone. Each item is reachable with labs on.", "主幹之外的規劃。開啟實驗功能就能使用。"),
  h("div", { class: "card bb-roadmap-list" }, ROADMAP.map((r) => h("div", { class: "bb-rm", "data-roadmap": r.id }, h("span", { class: "badge" }, h("span", { class: "d" }), T("planned", "規劃中")), h("span", { class: "tid" }, r.m),
    h("span", { class: "bb-rm-t" }, T(r.en, r.tw)), h("a", { href: `#/${r.routes[0]}` }, `#/${r.routes[0]}`)))));
routes.runs = routes.runs || (() => page(T("Tasks", "任務"), T("Studio's workflow tasks, each with its live graph.", "Studio 的流程任務，每個都有即時流程圖。"), h("div", { class: "card x-pad faint", id: "runsEmpty" }, T("No tasks yet.", "還沒有任務。"))));
routes.workflows = routes.workflows || ((arg) => routes.workflow ? routes.workflow(arg) : page(T("Workflows", "流程"), ""));

// ---------- views embedded in a backbone page ----------
// An embedded view's own loader re-renders only its own route, so the host waits
// for that load and re-renders itself when the data arrives.
function embed(host, ready, load, build) {
  const orig = routes[host]; let pending = null;
  routes[host] = (arg) => { const v = orig(arg); if (arg) return v;
    if (!ready()) { pending ??= Promise.resolve(load()).catch(() => {}).finally(() => { pending = null; if (S.route?.name === host && !S.route.arg) render(); }); return v; }
    return [v, build()]; };
}
// Crew: the activity log folds in under the crew. It keeps its own, unfiltered
// list (never #/activity's filters, which it leaves alone), loads it again on
// every visit, and picks up new events while Crew is open.
const CA = { items: null, at: 0 };
const loadCrewActivity = async () => { try { const r = await fetch("/api/activity?limit=25"); CA.items = r.ok ? await r.json() : []; } catch { CA.items = []; } CA.at = Date.now(); };
const crewEvs = () => CA.items.length ? CA.items.slice(0, 25).map((e) => evRow(e)) : [h("div", { class: "empty" }, h("b", {}, T("No events yet", "還沒有事件")))];
// freshness decides when to refetch, never whether to render: a re-render always shows the last list, and a stale one refetches in the background
let caBusy = false;
const refreshCrewList = async () => { if (caBusy) return; caBusy = true; try { await loadCrewActivity(); const l = document.querySelector("[data-crew-evlist]"); if (l) l.replaceChildren(...crewEvs()); } finally { caBusy = false; } };
embed("crew", () => { if (CA.items !== null && Date.now() - CA.at > 3000) setTimeout(refreshCrewList, 0); return CA.items !== null; }, loadCrewActivity,
  () => h("div", { class: "page bb-activity", "data-crew-activity": "1" }, h("div", { class: "sec-head" }, h("h2", {}, T("Activity", "事件紀錄")), h("a", { href: "#/activity" }, T("Filter the log", "篩選紀錄"))),
    h("div", { class: "card evlist", "data-crew-evlist": "1" }, crewEvs())));
setInterval(() => { if (document.querySelector("[data-crew-evlist]") && S.route?.name === "crew" && !document.hidden) refreshCrewList(); }, 5000);

// ---------- home: the Board ----------
// without a session the page can only read: say how to start one (Studio's page never hands one out by itself)
fetch("/api/session").then((r) => r.json()).then((j) => { if (j.session) return;
  document.body.prepend(h("div", { class: "bb-nosession", role: "status", "data-no-session": "1" }, T("This page has no Studio session, so it cannot change anything. Open Studio with its session link: run ", "這個頁面沒有 Studio session，所以無法做任何變更。請用 session 連結開啟 Studio：執行 "), h("code", {}, "bun run launch"), T(" (the binary: ", "（執行檔：") , h("code", {}, "./crew-studio launch"), ")")); }).catch(() => {});
const home = () => { if (!location.hash || location.hash === "#" || location.hash === "#/") location.replace("#/board"); };
addEventListener("hashchange", home); home();
// Board is the first-run entry; existing workflow content remains the same.
{const board=routes.board;routes.board=(...args)=>{const page=board(...args),welcome=window.crewFirstmateWelcome?.();if(welcome)page.prepend(welcome);return page;};}
route(); setTimeout(mark, 0);
})();
