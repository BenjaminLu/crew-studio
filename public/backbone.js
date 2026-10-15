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
routes.settings = () => page(T("Settings", "設定"), T("Doctor, keys and phone pairing, and the labs switch.", "健康檢查、金鑰、手機配對，以及實驗功能開關。"),
  h("div", { class: "card x-pad bb-settings" },
    h("a", { class: "bb-set", href: "#/doctor" }, icon("tool"), h("span", {}, h("b", {}, T("Doctor", "健康檢查")), h("span", { class: "faint" }, T("What works, what is missing, one-click installs, API keys.", "哪些可用、缺什麼、一鍵安裝、API 金鑰。")))),
    h("a", { class: "bb-set", href: "#/remote" }, icon("monitor"), h("span", {}, h("b", {}, T("Phone pairing", "手機配對")), h("span", { class: "faint" }, T("Planned (labs).", "規劃中（實驗功能）。")))),
    h("a", { class: "bb-set", href: "#/roadmap" }, icon("target"), h("span", {}, h("b", {}, T("Roadmap", "路線圖")), h("span", { class: "faint" }, T("What is planned next, by milestone.", "接下來的規劃，依里程碑。")))),
    h("label", { class: "bb-set" }, h("input", { type: "checkbox", id: "labsToggle", checked: labsOn(), onchange: (e) => { store.set("crew.labs", e.target.checked ? "1" : null); labsGroup.hidden = !e.target.checked; } }),
      h("span", {}, h("b", {}, T("Show labs", "顯示實驗功能")), h("span", { class: "faint" }, T("Adds the planned pages to the sidebar. They work, but they are not the backbone.", "把規劃中的頁面加回側邊欄；可以用，但不是主幹功能。"))))));
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
  document.body.prepend(h("div", { class: "bb-nosession", role: "status", "data-no-session": "1" }, T("This page has no Studio session, so it cannot change anything. Open Studio with its session link: run ", "這個頁面沒有 Studio session，所以無法做任何變更。請用 session 連結開啟 Studio：執行 "), h("code", {}, "bun src/main.ts open"), T(" (the binary: ", "（執行檔：") , h("code", {}, "crew-studio open"), ")")); }).catch(() => {});
const home = () => { if (!location.hash || location.hash === "#" || location.hash === "#/") location.replace("#/board"); };
addEventListener("hashchange", home); home();
route(); setTimeout(mark, 0);
})();
