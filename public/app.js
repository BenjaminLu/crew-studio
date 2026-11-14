// Crew Studio front end: one page, hash routes, live updates over SSE.
// Data comes from /api/*; the only write is POST /api/answer, which the
// server forwards to the firstmate board's own route.
const S = { tasks: [], pending: [], crew: [], github: null, board: null, flow: null, events: 0, types: [], recent: [], conn: "connecting", sel: null };
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
// the UI language (i18n.js): the stored choice, else the browser's language on first run
const I18N = window.crewI18n;
let lang = I18N.initial(store.get("crew.lang", null), navigator.languages?.length ? navigator.languages : [navigator.language]);
const L = (t) => I18N.loc(lang, t);
// an object keyed by language holding structures (card details, sections)
const LD = (o) => I18N.deep(lang, o);
// firstmate's placeholder when a round has not described its work yet
const act = (t) => { const s = L(t); return /^Work description unavailable|^尚無工作說明/.test(s) ? "" : s; };
const zh = () => lang !== "en";
// the Chinese a two-way EN / 中文 toggle switches to: the current one, else the last one used
let lastZh = lang !== "en" ? lang : I18N.browserLang(navigator.languages || []) === "zh-CN" ? "zh-CN" : "zh-TW";
const zhLang = () => (lang !== "en" ? lang : lastZh);
// English, the zh-TW text, or zh-CN: the optional third argument, else derived from zh-TW
const T = (en, tw, cn) => I18N.pick(lang, en, tw, cn);
// a workflow's display name: the captain's rename, else Studio's default (code-firstmate shows as "coding"), else the
// fallback given (the definition's own name), else its id. Served by /api/workflow-names and /api/wf; always rendered as text
const WFN = { names: {} };
const wfName = (id, fallback) => (id && Object.hasOwn(WFN.names, id) ? WFN.names[id] : null) || (id === "pr-follow" ? T("PR follow-through", "PR 跟進") : null) || fallback || id || ""; // an internal workflow has no listed name
const setWorkflowNames = (names) => { if (names && typeof names === "object" && !Array.isArray(names)) WFN.names = Object.fromEntries(Object.entries(names).filter(([, v]) => typeof v === "string")); };
const loadWorkflowNames = () => fetch("/api/workflow-names").then((r) => (r.ok ? r.json() : null)).then((j) => setWorkflowNames(j?.names)).catch(() => {});

// ---------- time ----------
const ago = (iso) => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return T(`${Math.round(s)}s ago`, `${Math.round(s)} 秒前`);
  if (s < 3600) return T(`${Math.round(s / 60)}m ago`, `${Math.round(s / 60)} 分鐘前`);
  if (s < 86400) return T(`${Math.round(s / 3600)}h ago`, `${Math.round(s / 3600)} 小時前`);
  return T(`${Math.round(s / 86400)}d ago`, `${Math.round(s / 86400)} 天前`);
};
const clock = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); } catch { return ""; } };
const dur = (iso) => { if (!iso) return ""; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };

// ---------- shared bits ----------
const AV = ["a1", "a2", "a3", "a4", "a5", "a6"];
const avaFor = (name, cls = "ava") => { let h = 0; for (const c of name || "?") h = (h * 31 + c.charCodeAt(0)) >>> 0; const k = AV[h % AV.length];
  return h_("span", { class: cls, style: `background:var(--${k});color:var(--${k}t)`, title: name }, (name || "?").slice(0, 2)); };
const h_ = h; // from kit.js
const STATUS = {
  "needs-you": ["human", () => T("Needs you", "等你")], running: ["run", () => T("Running", "進行中")],
  failed: ["bad", () => T("Failed", "失敗")], done: ["ok", () => T("Merged", "已合併")], idle: ["", () => T("Idle", "閒置")],
};
const statusBadge = (s) => { const [c, l] = STATUS[s] || STATUS.idle; return h("span", { class: `badge ${c}` }, h("span", { class: "d" }), l()); };
const doorBadge = (d) => d ? h("span", { class: `door ${d === "one-way" ? "one" : "two"}`, title: T("Change type from the pin", "pin 記錄的改動類型") }, d) : null;
const prUrl = (n) => `https://github.com/${S.github?.repo || "unknown/unknown"}/pull/${n}`;
const nodeLabel = (id) => S.flow?.nodes?.find((n) => n.id === id)?.label || id;
const pathFor = (door) => door === "two-way" ? ["dispatch", "door", "build", "ci", "review", "gates", "merge", "done"]
  : ["dispatch", "door", "plan", "failfirst", "build", "ci", "review", "gates", "merge", "done"];
// a server message may carry Traditional text ("… / 請先…"): in 简体中文 displayCN converts it, keeping any code or path in it
const toast = (msg) => { const t = h("div", { class: "toast", role: "status" }, typeof msg === "string" ? I18N.chatText(lang, msg) : msg); document.body.append(t); setTimeout(() => t.remove(), 3200); };

function ciSummary(pr) {
  const p = S.github?.prs?.find((x) => x.number === pr);
  if (!p) return h("span", { class: "faint" }, pr ? "—" : "");
  const b = { pass: 0, fail: 0, pending: 0 };
  for (const c of p.checks) { if (c.bucket === "pass") b.pass++; else if (c.bucket === "fail") b.fail++; else if (c.bucket === "pending") b.pending++; }
  return h("span", { class: "cisum", title: p.checks.map((c) => `${c.name}: ${c.bucket}`).join("\n") },
    b.fail ? h("span", { class: "bad" }, `✗ ${b.fail}`) : null, b.pending ? h("span", { class: "run" }, `● ${b.pending}`) : null,
    h("span", { class: "ok" }, `✓ ${b.pass}`));
}

// ---------- routing ----------
const routes = { board: viewBoard, inbox: viewInbox, crew: viewCrew, activity: viewActivity, workflow: viewWorkflow };
/** the route the address names now (route() draws it): name, its path parts and its query */
function hashRoute() {
  // a route may carry a query after "?" (#/run/R-1?card=SC-2, #/runs?project=studio): S.route.query
  const raw = location.hash.replace(/^#\/?/, "") || "board", qi = raw.indexOf("?");
  const [name, ...rest] = (qi < 0 ? raw : raw.slice(0, qi)).split("/");
  const query = new URLSearchParams(qi < 0 ? "" : raw.slice(qi + 1));
  const normalized = name === "tasks" ? (/^R-\d+$/.test(rest[0] || "") ? "run" : "runs") : name;
  return { v: routes[normalized] ? normalized : "board", rest, query };
}
window.crewHashRoute = () => hashRoute().v;
function route() {
  const { v, rest, query } = hashRoute();
  $$(".nav-item").forEach((b) => b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  S.route = { name: v, arg: rest.map(decodeURIComponent).join("/") || null, query };
  render.nav = true; render();
}
// A focus page takes the whole screen: the terminal page (docs/units/web-terminal.md) and an open review room
// (docs/units/review-room.md). A route's view says so with .focus: a name, or a function of the route's argument that
// answers one or null (a room is in focus only once it has loaded). render() asks on every draw. While a focus page is
// shown, body[data-focus] names it, the sidebar is its 64 px rail, Firstmate is closed (opened from the page, it is a sheet
// over it: styles.css) and its button is hidden. Nothing is stored: crew.side and crew.chatOpen stay the captain's (openChat
// saves nothing during focus). Leaving gives back what the captain had, except a sidebar folded or opened on purpose while
// there (setSide saves it): that choice wins.
const PAGE_FOCUS = { name: null, prev: null };
function pageFocus(name) {
  const b = document.body; name = name || null;
  if (name && !PAGE_FOCUS.name) { PAGE_FOCUS.prev = { side: b.classList.contains("side-collapsed"), chat: !b.classList.contains("chat-closed"), sideStore: store.get("crew.side", null) }; b.classList.add("side-collapsed", "chat-closed"); }
  if (!name && PAGE_FOCUS.name) {
    const p = PAGE_FOCUS.prev || { side: false, chat: false, sideStore: null }, now = store.get("crew.side", null);
    b.classList.toggle("side-collapsed", now !== p.sideStore ? now === "collapsed" : p.side);
    $("#sideTog")?.setAttribute("aria-label", b.classList.contains("side-collapsed") ? "Expand sidebar" : "Collapse sidebar");
    b.classList.toggle("chat-closed", !p.chat); PAGE_FOCUS.prev = null;
  }
  PAGE_FOCUS.name = name;
  if (name) b.dataset.focus = name; else delete b.dataset.focus;
}
const focusOf = (r) => { const f = routes[r?.name]?.focus; return (typeof f === "function" ? f(r.arg) : f) || null; };
const fieldKey = (el) => { if (el.id) return `#${CSS.escape(el.id)}`; const d = [...el.attributes].find((x) => x.name.startsWith("data-"));
  return d ? `${el.tagName.toLowerCase()}[${d.name}="${CSS.escape(d.value)}"]` : null; };
function render() {
  const nav = render.nav; render.nav = false;
  // a draw that is not route()'s, asked for after the address moved on (a deferred redraw landing between a sidebar click
  // and its hashchange): route() draws the new page; drawing the old one on the new address would carry its state there
  if (!nav && S.route && hashRoute().v !== S.route.name) return;
  // a list toolbar (public/list-tools.js) is never redrawn while the focus is in it, its search box, a suggestion or a
  // facet's popover (an input method's composition, a keyboard pick): a redraw of the same page waits until the focus
  // leaves the toolbar. A navigation, route(), always draws
  const bar = !nav && ltFocus();
  if (bar && String(render.at).split("/")[0] === S.route?.name) return renderAfterBar(bar);
  const root = $("#view");
  pageFocus(focusOf(S.route));
  const scroll = $("#main").scrollTop;
  // a field the captain is typing in that the new view keeps (a mounted card is reused, unit inbox-live) keeps its focus and caret
  // a field the view draws anew (the Start form's request field) is found again by its stable key (id, else its first data-
  // attribute) on the same page, and takes the focus and caret, so the next keys land in it
  const a = document.activeElement; const restore = render.restore && a && root.contains(a) ? (() => { const key = fieldKey(a) || (a.getAttribute("href") ? `${a.tagName.toLowerCase()}[href="${CSS.escape(a.getAttribute("href"))}"]` : null);
    return key ? { key, tag: a.tagName, at: [...root.querySelectorAll(key)].indexOf(a) } : null; })() : null; render.restore = false; const inboxFocus = S.route.name === "inbox" && a && root.contains(a) && a.matches("[data-inbox-row]") ? a.dataset.inboxRow : null; const keep = a && root.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? { a, s: a.selectionStart, e: a.selectionEnd, key: fieldKey(a), at: render.at } : null;
  // Live refresh detaches even reused cards. Keep only the exact still-valid card action;
  // never transfer focus to a replacement, a different page, or over another focus target.
  const card = a?.closest('[data-scard][data-card-status="open"]');
  const action = a && root.contains(a) && card && a.matches('button,a[href]') && !a.matches(':disabled,[aria-disabled="true"]') && a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden' && fieldKey(a) ? { card, id: card.dataset.scard, key: fieldKey(a), hash: location.hash, option: a.getAttribute('data-option'), href: a.getAttribute('href'), page: `${S.route.name}/${S.route.arg ?? ""}` } : null;
  root.replaceChildren(...[routes[S.route.name](S.route.arg)].flat().filter(Boolean));
  render.at = `${S.route.name}/${S.route.arg ?? ""}`;
  const again = keep && (keep.a.isConnected ? keep.a : keep.key && keep.at === render.at ? (() => { const m = root.querySelectorAll(keep.key); return m.length === 1 && m[0].tagName === keep.a.tagName ? m[0] : null; })() : null);
  // what was typed into a field the view draws anew, empty, is carried into it rather than lost to the redraw
  if (again && again !== keep.a && !again.value && keep.a.value && again.type !== "file" && again.type !== "password") again.value = keep.a.value;
  if (again && document.activeElement !== again) { try { again.focus({ preventScroll: true }); const n = again.value.length; again.setSelectionRange(Math.min(keep.s ?? n, n), Math.min(keep.e ?? n, n)); } catch {} }
  // a redraw that waited for the focus to leave a list toolbar (Tab to a facet, a row): the focus goes to the same control or
  // row drawn anew, found by its stable key, so the next Tab and Enter go on from there
  if (restore && !keep && (document.activeElement === document.body || !root.contains(document.activeElement))) {
    // its key (an id, its first data- attribute, else its link), the same one of several (the row's place)
    const m = root.querySelectorAll(restore.key), el = m.length === 1 ? m[0] : m[restore.at]; if (el && el.tagName === restore.tag) el.focus({ preventScroll: true }); }
  // A retained card may rebuild its controls while the route renders. Bind to
  // that same card element and unique action, rather than the detached old button.
  if (action && action.page === render.at && action.hash === location.hash && root.contains(action.card) && action.card.matches('[data-card-status="open"]') && action.card.dataset.scard === action.id && document.activeElement === document.body) {
    const matches = [...action.card.querySelectorAll(action.key)].filter(next => next.closest('[data-scard][data-card-status="open"]') === action.card && next.getAttribute('data-option') === action.option && next.getAttribute('href') === action.href);
    const next = matches.length === 1 ? matches[0] : null;
    if (next && !next.matches(':disabled,[aria-disabled="true"]') && next.getClientRects().length && getComputedStyle(next).visibility !== 'hidden') next.focus({ preventScroll: true });
  }
  // List rows are rebuilt on live refresh. Restore their exact current owner synchronously:
  // leaving this to rAF briefly loses focus and lets a later refresh lose the owner entirely.
  if (inboxFocus && S.route.name === "inbox" && IB.sel === inboxFocus && document.activeElement === document.body) {
    const rows = root.querySelectorAll(`[data-inbox-row="${CSS.escape(inboxFocus)}"]`), row = rows.length === 1 ? rows[0] : null;
    if (row?.getClientRects().length && getComputedStyle(row).visibility !== "hidden") row.focus({ preventScroll: true });
  }
  hydrateIcons(root);
  $("#main").scrollTop = scroll;
  updateNav();
}
/** one redraw when the focus leaves the toolbar (not when it moves within it: box → suggestion → popover); none if the page changed */
function renderAfterBar(bar) {
  if (renderAfterBar.on === bar) return; renderAfterBar.on = bar;
  const out = (e) => { if (e.relatedTarget && bar.contains(e.relatedTarget) && !e.relatedTarget.closest(".lt-extra")) return; bar.removeEventListener("focusout", out);
    afterPress(() => setTimeout(() => { if (renderAfterBar.on === bar) renderAfterBar.on = null;
      const again = ltFocus(); if (again) return renderAfterBar(again); // focus put back (a redrawn checkbox)
      if (S.route && hashRoute().v === S.route.name) { render.restore = true; render(); } }, 0)); };
  bar.addEventListener("focusout", out);
}
/** the toolbar the focus is in, when it is in the toolbar's own controls (the box, a suggestion, a facet popover); a page's
 *  own control placed in the toolbar's row (Tasks' Show archived) redraws its page as usual */
const ltFocus = () => { const a = document.activeElement, bar = a?.closest?.("#view [data-lt-bar]"); return bar && !a.closest(".lt-extra") ? bar : null; };
// a live update never yanks focus out of a field being typed in; it renders once the field is left
let deferred = false;
// a pointer press in progress: a render now would replace the pressed button before its click (mouseup on a new
// element fires no click), so a live update waits until the press is over
let pressing = false;
addEventListener("pointerdown", () => { pressing = true; }, true);
addEventListener("pointerup", () => { pressing = false; }, true);
addEventListener("pointercancel", () => { pressing = false; }, true);
/** Run go once the current press ends (now when nothing is pressed); after the click it ends in, not before. */
function afterPress(go) {
  if (!pressing) return go();
  const after = () => { removeEventListener("pointerup", after, true); removeEventListener("pointercancel", after, true); setTimeout(go, 0); };
  addEventListener("pointerup", after, true); addEventListener("pointercancel", after, true);
}
// the field that deferred the render: a field removed without a blur (an Enter submit that swaps the view) releases it
let deferredOn = null;
function soft() {
  if (deferred && (!deferredOn || deferredOn.isConnected)) return updateNav();
  deferred = false; deferredOn = null;
  const a = document.activeElement;
  if (a && $("#view").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
    deferred = true; deferredOn = a;
    // drawn once the new focus has landed (during blur it is nowhere): a focus moving within a list toolbar keeps waiting (render)
    a.addEventListener("blur", () => afterPress(() => setTimeout(() => { if (deferredOn !== a) return; deferred = false; deferredOn = null; render.restore = !!a.closest("[data-lt-bar]"); render(); }, 0)), { once: true });
    return updateNav();
  }
  if (pressing) { deferred = true; deferredOn = null; afterPress(() => { deferred = false; render(); }); return updateNav(); }
  render();
}
function updateNav() {
  const n = S.pending.length + (window.studioCards?.count() || 0); // firstmate's cards and Studio's own
  const needs = $("#navNeeds"); needs.hidden = !n; needs.textContent = n;
  $("#navInbox").textContent = n || "";
  $("#navCrew").textContent = (S.crew.filter((c) => c.alive).length + (window.studioAgents?.count() || 0)) || ""; // firstmate's rounds and Studio's agents
  document.title = n ? `(${n}) Crew Studio` : "Crew Studio";
}

// ---------- board ----------
function viewBoard() {
  const live = S.crew.filter((c) => c.alive);
  const waiting = S.pending.length + (window.studioCards?.count() || 0); // firstmate's cards and Studio's own
  const active = S.tasks.filter((t) => t.status !== "done" && t.status !== "idle");
  const done = S.tasks.filter((t) => t.status === "done");
  const idle = S.tasks.filter((t) => t.status === "idle");
  const shown = S.showIdle ? S.tasks : S.tasks.filter((t) => t.status !== "idle");
  return h("div", { class: "page" },
    h("div", { class: "phead" },
      h("div", {}, h("h1", {}, T("Board", "看板")),
        h("p", {}, T(`${active.length} active tasks, ${live.length} crew working, ${waiting} waiting on you`,
          `${active.length} 個進行中的任務、${live.length} 位船員工作中、${waiting} 張卡等你`))),
      h("div", { class: "actions" }, ghBar())),
    h("section", {},
      h("div", { class: "sec-head" }, h("h2", {}, T("Needs you", "等你處理")), h("span", { class: "badge human" }, String(waiting))),
      h("div", { class: "card needs" }, waiting ? [...S.pending.map(needRow), ...(window.studioCards?.needRows() || [])]
        : h("div", { class: "empty" }, icon("check"), h("b", {}, T("Nothing waits on you", "沒有等你的卡")), T("New cards appear here the moment firstmate raises them.", "firstmate 一開卡就會出現在這裡。")))),
    h("section", {},
      h("div", { class: "sec-head" }, h("h2", {}, T("Tasks", "任務")), h("span", { class: "faint" }, T(`${active.length} active · ${done.length} merged in the last 3 days`, `${active.length} 個進行中 · 近 3 天合併 ${done.length} 個`))),
      h("div", { class: "card runs-table" },
        h("div", { class: "rrow cs head" }, h("div", {}, T("Task", "任務")), h("div", {}, T("Stage", "階段")), h("div", {}, T("Status", "狀態")), h("div", { class: "c-ci" }, "CI"), h("div", { class: "c-up" }, T("Updated", "更新"))),
        shown.length ? shown.map(taskRow) : h("div", { class: "empty" }, h("b", {}, T("No recent tasks", "近期沒有任務"))),
        idle.length ? h("div", { class: "rrow cs", style: "display:flex" }, h("button", { class: "btn ghost", onclick: () => { S.showIdle = !S.showIdle; render(); } },
          S.showIdle ? T(`Hide ${idle.length} idle`, `隱藏 ${idle.length} 個閒置`) : T(`Show ${idle.length} idle (no crew, no card)`, `顯示 ${idle.length} 個閒置（沒有船員、沒有卡）`))) : null)),
    h("section", {},
      h("div", { class: "sec-head" }, h("h2", {}, T("Crew on duty", "值班船員")), h("span", { class: "faint" }, window.studioAgents?.ready() ? T(`${live.length + window.studioAgents.count()} working`, `${live.length + window.studioAgents.count()} 位工作中`) : window.studioAgents?.status() || T("Checking crew status…","正在確認船員狀態…"))),
      h("div", { class: "card crewline" },
        h("div", { class: "avas" }, live.length ? live.map((c) => h("a", { href: `#/crew/${encodeURIComponent(c.actor)}`, title: `${c.actor}\n${L(c.activity)}`, style: "display:flex;gap:8px;align-items:center;text-decoration:none;color:inherit" },
          avaFor(c.name), h("span", { style: "font-size:13px" }, c.name, h("span", { class: "faint" }, ` · ${c.role} · ${c.task || ""}`))))
          : h("span", { class: "faint" }, window.studioAgents?.count() ? T(`${window.studioAgents.count()} Studio agents or local jobs working — open crew for details.`, `${window.studioAgents.count()} 個 Studio agent 或本機工作執行中，打開船員查看。`) : window.studioAgents?.ready() ? T("No crew round is running.", "目前沒有船員在跑。") : window.studioAgents?.status() || T("Checking crew status…","正在確認船員狀態…"))),
        h("a", { class: "btn ghost", href: "#/crew" }, T("Open crew", "打開船員")))));
}
function ghBar() {
  const g = S.github;
  if (!g) return null;
  const bad = g.enabled && !g.ok;
  return h("span", { class: `ghbar${bad ? " bad" : ""}` }, icon("github", "ic sm"),
    !g.enabled ? T("GitHub off", "GitHub 未啟用") : g.ok ? T(`GitHub synced ${ago(g.lastSync)}`, `GitHub ${ago(g.lastSync)}同步`)
      : g.lastSync === null && !g.error ? T("GitHub syncing…", "GitHub 同步中…")
      : T(`GitHub unavailable, backing off until ${clock(g.backoffUntil)}`, `GitHub 連不上，退避到 ${clock(g.backoffUntil)}`));
}
function needRow(c) {
  const d = LD(c.details) || {};
  const merge = c.kind === "merge" || /^MERGE CARD/i.test(c.title);
  return h("div", { class: "need" },
    h("div", { class: "need-ic", style: `background:var(--${merge ? "ok" : "human"}-soft);color:var(--${merge ? "ok" : "human"})` }, icon(merge ? "pr" : "human")),
    h("div", {}, h("div", { class: "need-t" }, d.title || c.title), h("div", { class: "need-d" }, [c.task, c.pr ? `#${c.pr}` : null, d.explanation].filter(Boolean).join(" · "))),
    h("div", { class: "need-r" }, h("span", { class: "faint", style: "font-size:12px" }, ago(c.ts)), h("a", { class: "btn", href: `#/inbox/${encodeURIComponent(c.id)}` }, T("Open", "打開"))));
}
function taskRow(t) {
  const path = pathFor(t.door);
  const at = Math.max(0, path.indexOf(t.node));
  const pipe = h("div", { class: "pipe", "aria-hidden": "true" }, path.slice(0, -1).map((n, i) =>
    h("i", { class: i < at ? "done" : i === at ? (t.status === "failed" ? "failed" : t.status === "needs-you" ? "human" : t.status === "done" ? "done" : "running") : "" })));
  return h("div", { class: "rrow cs", "data-task": t.id },
    h("div", {},
      h("div", { class: "run-t" }, h("span", { class: "tid" }, t.id), h("span", { title: t.title }, t.title || L(t.lastSummary))),
      h("div", { class: "run-s" }, doorBadge(t.door), t.pr ? h("a", { href: prUrl(t.pr), target: "_blank", rel: "noopener" }, `#${t.pr}`) : null,
        t.round ? h("span", {}, T(`round ${t.round}`, `第 ${t.round} 回合`)) : null,
        t.currentActor ? h("a", { href: `#/crew/${encodeURIComponent(t.currentActor)}` }, t.currentActor.split("-")[1]) : null,
        h("a", { href: `#/activity/${t.id}` }, T("activity", "事件")))),
    h("div", {}, pipe, h("div", { class: "pipe-l" }, `${Math.min(at + 1, path.length - 1)}/${path.length - 1} ${nodeLabel(t.node)}`)),
    h("div", {}, statusBadge(t.status)),
    h("div", { class: "c-ci" }, ciSummary(t.pr)),
    h("div", { class: "c-up faint", style: "font-size:12px" }, ago(t.lastTs)),
    t.failure && t.status === "failed" ? h("div", { class: "failnote" }, `${t.failure.type}: ${L(t.failure.summary)}`) : null);
}

// ---------- inbox ----------
// One card at a time (unit inbox-focus). Every open card, firstmate's and Studio's, is one row of a list, oldest first:
// the card waiting longest is on top, and a card that arrives later joins the bottom without moving the selection. Beside
// the list, the selected card alone, under a sticky header naming its Task. #/inbox/<id> selects a card; ↑/↓ or j/k
// move the selection; an answered card leaves and the card after it is selected, with "Recorded for <Task>". With the
// Firstmate panel open (520–900px) the list is a compact rail beside the card; below 520px (a phone) the list and the
// card take turns: a row opens its card full width and Back returns to the list. Two full cards are never stacked.
const IB = { sel: null, order: [], recorded: null, recT: null, clickedCard: false };
function inboxItems() {
  // a spec card names its Task by the spec's own title, in the page language (its zh-TW title, without the 核准規格： prefix)
  const named = (c) => c.spec && c.title?.["zh-TW"] ? T(c.runTitle || c.title.en, c.title["zh-TW"].replace(/^核准規格：/, "")) : c.runTitle || L(c.title);
  const studio = (window.studioCards?.open() || []).map((c) => ({ source: "studio", id: c.id, kind: c.follow ? L(c.follow.kindLabel ? { en: c.follow.kindLabel.en, "zh-TW": c.follow.kindLabel.tw } : c.kind) : c.kind, task: c.follow?.heading ? L({ en: c.follow.heading.en, "zh-TW": c.follow.heading.tw }) : named(c), workflow: c.workflow, run: c.run, ts: c.createdAt, data: c }));
  const fm = S.pending.map((c) => { const d = LD(c.details) || {};
    return { source: "firstmate", id: c.id, kind: c.purpose || c.kind || T("decision", "決定"), task: d.title || c.title, workflow: "code-firstmate", run: c.task, ts: c.ts, data: c }; });
  return [...studio, ...fm].sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}
/** The captain's answer to card `id` was recorded: the Inbox says so and, once the card leaves, selects the next one. */
window.inboxRecorded = (id) => {
  const x = inboxItems().find((i) => i.id === id); if (!x) return;
  IB.recorded = { id, task: x.task, at: Date.now() }; clearTimeout(IB.recT);
  IB.recT = setTimeout(() => { IB.recorded = null; document.querySelector("[data-inbox-recorded]")?.remove(); }, 8000);
};
const ibQuery = () => { const i = location.hash.indexOf("?"); return S.route?.name === "inbox" && i >= 0 ? location.hash.slice(i) : ""; };
const ibHash = (id) => (id ? `#/inbox/${encodeURIComponent(id)}` : "#/inbox") + ibQuery();
function viewInbox(id) {
  const items = inboxItems(), ids = items.map((x) => x.id);
  const ready = window.studioCards?.ready?.() !== false; // Studio's cards are read: a card missing now is really gone
  let want = id || IB.sel, gone = null, left = null;
  if (want && !ids.includes(want) && ready) {
    const at = IB.order.indexOf(want);
    if (at >= 0) { // it was in the list and left (answered, here or elsewhere, or withdrawn): the card after it is selected
      const next = IB.order.slice(at + 1).find((x) => ids.includes(x)) || IB.order.slice(0, at).reverse().find((x) => ids.includes(x)) || null;
      // a navigation already under way (the URL moved on, its hashchange not handled yet) keeps its URL
      if (id) { if (location.hash === ibHash(id)) history.replaceState(null, "", ibHash(next)); S.route.arg = id = next; }
      left = want; want = next;
    } else { if (id) gone = id; want = null; }
  }
  const cur = items.find((x) => x.id === want) || items[0] || null;
  const moved = !!cur && IB.sel !== cur.id;
  // the list and the selection follow what is shown, firstmate's cards too while Studio's cannot be read (j/k keep working)
  IB.sel = cur?.id || null; IB.order = ids;
  // on a phone, the URL decides which one shows: #/inbox the list, #/inbox/<id> that card
  const mode = id && cur && cur.id === id ? "card" : "list";
  const rec = IB.recorded && Date.now() - IB.recorded.at < 8000 ? IB.recorded : null;
  const said = rec && cur ? T(`Recorded for ${rec.task}. Next: ${cur.task}.`, `已記錄「${rec.task}」的回答。下一張：${cur.task}。`) : rec ? T(`Recorded for ${rec.task}. Nothing else is waiting.`, `已記錄「${rec.task}」的回答。沒有其他等你的卡。`) : "";
  requestAnimationFrame(() => {
    // another card selected: its top shows, not the middle the previous card was scrolled to
    const m = $("#main"), box = document.querySelector("[data-inbox-studio]");
    if (moved && m && box) { const top = box.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 12; if (m.scrollTop > top) m.scrollTop = Math.max(0, top); }
    if (left && rec?.id === left) { // the captain's answer took the card away: focus goes to the next card's header (or the page title) and the answer is announced
      (document.querySelector("[data-inbox-head]") || document.querySelector(".ib-page h1"))?.focus({ preventScroll: true }); inboxAnnounce(said);
    }
  });
  return h("div", { class: "page ib-page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", { tabindex: "-1" }, T("Inbox", "收件匣")),
      // what the page is for; the legacy firstmate board is named only when one of its cards is here
      h("p", { "data-inbox-sub": "" }, T("Decisions waiting on you, one card at a time.", "等你決定的事，一次一張。"),
        !items.some((x) => x.source === "firstmate") ? null : " " + (S.board?.writable ? T("Firstmate board cards are answered through that board.", "firstmate 看板的卡片經由該看板回答。")
          : T(`Firstmate board cards are read-only here (${S.board?.readonlyReason || "board unavailable"}).`, `firstmate 看板的卡片在這裡唯讀（${S.board?.readonlyReason || "看板無法連線"}）。`))))),
    rec ? h("p", { class: "ib-recorded", "data-inbox-recorded": rec.id }, icon("check", "ic sm"), h("span", {}, said)) : null,
    gone ? h("p", { class: "faint", "data-inbox-gone": gone }, items.length ? T(`${gone} is no longer waiting. The cards below still are.`, `${gone} 已經不在等待中。下面這些還在等。`) : T(`${gone} is no longer waiting.`, `${gone} 已經不在等待中。`)) : null,
    items.length ? inboxSection(items, cur, mode)
    : h("div", { class: "card" }, h("div", { class: "empty" }, icon("inbox"), h("b", {}, T("Inbox zero", "沒有待處理的卡")), T("Cards show up here live.", "新卡會即時出現。"))));
}
// The list under the shared toolbar (public/list-tools.js): search and facets filter the left list only; j/k move among the
// cards that match, and the selected card is always one of them (a filter that leaves it out selects the first match)
function inboxSection(items, cur, mode) {
  let detail = null;
  const list = window.crewListTools.list({ id: "inbox", route: "inbox", title: T("the Inbox", "收件匣"), noun: ["card", "卡"], items,
    placeholder: T("Search card titles, tasks, workflows…  or type kind:merge", "搜尋卡的標題、任務、流程…  也可以打 kind:合併"),
    text: (x) => [x.task, x.kind, x.id, x.run, x.workflow, x.workflow ? wfName(x.workflow) : null],
    facets: [{ key: "kind", name: T("Kind", "種類"), value: (x) => x.kind },
      { key: "workflow", name: T("Workflow", "流程"), value: (x) => x.workflow, show: (v) => wfName(v) },
      { key: "project", name: T("Project", "專案"), value: (x) => x.data?.project || null }],
    sorts: [{ key: "old", label: T("Oldest first", "最久的在上"), cmp: (a, b) => String(a.ts || "").localeCompare(String(b.ts || "")) || a.id.localeCompare(b.id, undefined, { numeric: true }) },
      { key: "new", label: T("Newest first", "最新的在上"), cmp: (a, b) => String(b.ts || "").localeCompare(String(a.ts || "")) || b.id.localeCompare(a.id, undefined, { numeric: true }) }],
    rows: (page, ctx) => {
      // j/k and the selection follow the matches, in the list's order
      IB.order = ctx.matched.map((x) => x.id);
      if (!IB.order.includes(IB.sel)) IB.sel = IB.order[0] || null;
      const word = T(ctx.sort === "new" ? "newest first" : "oldest first", ctx.sort === "new" ? "最新的在上" : "最久的在上");
      return h("div", { class: "ib-list card" },
        h("div", { class: "ib-list-h" }, h("b", {}, T("Waiting on you", "等你處理")), h("span", { class: "badge human", "data-inbox-count": "" }, IB.order.length < items.length ? T(`${IB.order.length} of ${items.length}`, `${IB.order.length} / ${items.length}`) : String(items.length)), h("span", { class: "faint" }, word)),
        h("div", { role: "listbox", "aria-label": T(`Open cards, ${word}`, `待處理的卡，${word}`) }, page.map((x) => inboxRow(x, IB.order.indexOf(x.id), x.id === IB.sel, ctx.mark))));
    },
    onChange: (v) => {
      IB.order = v.matched.map((x) => x.id); if (!IB.order.includes(IB.sel)) IB.sel = IB.order[0] || null; // no match draws no rows
      // the shown card's place among the matches follows every filter change
      const pos = detail?.querySelector("[data-inbox-pos]"), cur = items.find((y) => y.id === detail?.dataset.inboxShows); if (pos && cur) pos.textContent = inboxPos(cur, items);
      // a filter took the shown card out of the list: the first match is shown (or none), and the address follows
      if (!detail || detail.dataset.inboxShows === (IB.sel || "")) return;
      const x = items.find((y) => y.id === IB.sel) || null;
      detail.dataset.inboxShows = x?.id || ""; detail.replaceChildren(...(x ? [inboxHead(x, items), inboxCard(x)] : []));
      if (S.route?.name === "inbox" && S.route.arg) { history.replaceState(null, "", ibHash(x?.id || null)); S.route.arg = x?.id || null; }
      hydrateIcons(detail);
    } });
  // the selected card's page is the one shown (a link to a card deep in the list, a j/k step past the page)
  if (IB.sel) list.ltReveal?.((x) => x.id === IB.sel);
  // the card shown is the selected match (the toolbar may have left the asked-for card out)
  const shown = items.find((y) => y.id === IB.sel) || null;
  detail = h("div", { class: "ib-detail" }, ...(shown ? [inboxHead(shown, items), inboxCard(shown)] : []));
  detail.dataset.inboxShows = shown?.id || "";
  if (shown?.id !== cur?.id && S.route?.name === "inbox" && S.route.arg) { history.replaceState(null, "", ibHash(shown?.id || null)); S.route.arg = shown?.id || null; }
  const bar = list.querySelector(".lt");
  return h("section", { class: "ib", "data-inbox-studio": "1", "data-ib-mode": mode }, bar, h("div", { class: "ib-col" }, list), detail);
}
const inboxRow = (x, i, on, mark = (t) => t) => h("a", { class: `ib-row${on ? " on" : ""}`, href: ibHash(x.id), role: "option", "aria-selected": String(on), title: x.task, "aria-label": [x.task, x.kind, x.workflow ? wfName(x.workflow) : null, x.run, ago(x.ts)].filter(Boolean).join(" · "), "data-inbox-row": x.id, "data-inbox-source": x.source },
  h("span", { class: "ib-n num", "aria-hidden": "true" }, String(i + 1)),
  h("span", { class: "ib-row-main" }, h("span", { class: "ib-row-t", title: x.task }, mark(x.task)),
    h("span", { class: "ib-row-d" }, h("span", { class: "vbadge ib-kind", "data-kind": x.kind }, x.kind), x.workflow ? h("span", { class: "ib-wf" }, icon("workflow", "ic sm"), wfName(x.workflow)) : null, x.run ? h("span", { class: "mono" }, x.run) : null)),
  h("span", { class: "ib-age faint num", title: x.ts || "" }, ago(x.ts)));
/** where the card is: among the cards the toolbar lets through (and how many wait in all, when that is fewer) */
function inboxPos(x, items) { const shown = IB.order.length && IB.order.includes(x.id) ? IB.order : items.map((y) => y.id), i = shown.indexOf(x.id) + 1, n = shown.length;
  return n < items.length ? T(`${i} of ${n} (${items.length} in all)`, `第 ${i} / ${n} 張（共 ${items.length}）`) : T(`${i} of ${n}`, `第 ${i} / ${n} 張`); }
// the selected card's header: which Task this is, kept on screen while the card scrolls (Back returns to the list when narrow)
const inboxHead = (x, items) => h("div", { class: "ib-head", tabindex: "-1", "aria-label": T(`${x.task}, ${x.kind}`, `${x.task}，${x.kind}`), "data-inbox-head": x.id },
  h("a", { class: "btn ghost ib-back", href: "#/inbox", "data-inbox-back": "" }, "← ", T("Back to list", "回到列表")),
  h("div", { class: "ib-head-t" }, h("b", {}, x.task), h("span", { class: "faint num", "data-inbox-pos": "" }, inboxPos(x, items))),
  h("div", { class: "ib-head-d" }, h("span", { class: "vbadge" }, x.kind), x.workflow ? h("span", {}, wfName(x.workflow)) : null,
    x.run ? h("a", { class: "mono", href: x.source === "studio" ? `#/run/${encodeURIComponent(x.run)}` : `#/activity/${encodeURIComponent(x.run)}` }, x.run) : null, h("span", { class: "mono" }, x.id)));
const inboxCard = (x) => (x.source === "studio" ? window.studioCards.card(x.data, x.task) : cardView(x.data));
// the Inbox's one live region: it stays in the page across renders and its text is set after the change, so a screen
// reader announces it (a status inserted together with its text often is not)
addEventListener("pointerdown", (e) => { IB.clickedCard = e.target instanceof Element && !!e.target.closest(".ib-detail"); }, true);
function inboxAnnounce(text) {
  let el = document.querySelector("[data-inbox-live]");
  if (!el) { el = h("div", { class: "ib-live", role: "status", "aria-live": "polite", "data-inbox-live": "" }); document.body.append(el); }
  el.textContent = ""; setTimeout(() => { el.textContent = text; }, 60);
}
// ↑/↓ move the selection from a row of the list; j/k anywhere but inside the card (its text, its buttons) or a field, so
// arrow keys still scroll a long card. Only while the list and the card are side by side.
addEventListener("keydown", (e) => {
  if (S.route?.name !== "inbox" || e.metaKey || e.ctrlKey || e.altKey || !["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) return;
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest("input, textarea, select, [contenteditable], #chat, #modalRoot")) return;
  // a click in the card's text leaves the focus on the page (body or the main column): the captain is still in the card
  const inCard = t?.closest(".ib-detail") || ((!t || t.contains(document.querySelector(".ib-detail"))) && IB.clickedCard);
  if (e.key.startsWith("Arrow") ? !t?.closest("[data-inbox-row]") : inCard) return;
  const box = document.querySelector("[data-inbox-studio]"); if (!box || !box.querySelector(".ib-list").getClientRects().length || !box.querySelector(".ib-detail").getClientRects().length) return;
  const to = IB.order[IB.order.indexOf(IB.sel) + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)]; e.preventDefault(); if (!to) return;
  history.replaceState(null, "", ibHash(to)); S.route.arg = to; IB.sel = to; render();
  const row = document.querySelector(`[data-inbox-row="${CSS.escape(to)}"]`); row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: "nearest" });
});
const sel = new Map(); // card id -> { chosen, answers: Map(index -> {ok,text}) }
// a firstmate card's pick and answers not yet sent are unsent state for a reload (pageDirty, below)
const fmCardsDirty = () => [...sel].some(([id, st]) => (st.chosen || st.answers.size) && (S.pending || []).some((c) => c.id === id));
function cardView(c) {
  const d = LD(c.details) || {};
  const en = c.details?.en || {};
  const st = sel.get(c.id) || { chosen: null, answers: new Map() }; sel.set(c.id, st);
  const facts = (xs) => (Array.isArray(xs) ? xs : []).map((x) => (typeof x === "string" ? x : x?.text)).filter(Boolean);
  const opts = Object.entries(d.options || en.options || {});
  const qs = facts(d.questions);
  const disabled = !S.board?.writable || !!c.boardOnly;
  const send = h("button", { class: "btn primary", disabled: disabled || !st.chosen || null, onclick: () => confirmSend(c, st) },
    icon("send", "ic sm"), st.chosen ? T(`Send ${st.chosen} · ${d.title || c.title}`, `送出 ${st.chosen} · ${d.title || c.title}`) : T("Pick an option", "先選一個選項"));
  return h("article", { class: "card icard", "data-card": c.id },
    h("div", { class: "cardmeta" }, h("span", { class: "mono" }, c.id), c.task ? h("a", { href: `#/activity/${c.task}` }, c.task) : null,
      c.pr ? h("a", { href: prUrl(c.pr), target: "_blank", rel: "noopener" }, `#${c.pr}`) : null, c.kind ? h("span", { class: "badge" }, c.kind) : null,
      c.purpose ? h("span", { class: "badge" }, c.purpose) : null, h("span", {}, ago(c.ts))),
    h("h3", {}, d.title || c.title),
    d.explanation ? h("p", { class: "lead" }, d.explanation) : null,
    c.boardOnly ? h("div", { class: "banner" }, icon("alert", "ic sm"), c.boardOnly === "retro" ? T("A retrospective card takes one answer per item.", "回顧卡要逐項回答。") : T("This merge card asks you to confirm each intent first.", "這張合併卡要先逐條確認意圖。"),
      h("a", { href: S.board?.url || "#", target: "_blank", rel: "noopener" }, T("Answer on the board ↗", "到看板回答 ↗"))) : null,
    d.before || d.after ? h("div", { class: "ba" }, h("div", {}, h("b", {}, T("Before", "改動前")), d.before || "—"), h("div", {}, h("b", {}, T("After", "改動後")), d.after || "—")) : null,
    facts(d.intent).length ? h("div", {}, h("h2", { style: "margin-bottom:6px" }, T("Intent", "意圖")), h("ol", { class: "ilist2" }, facts(d.intent).map((x) => h("li", {}, x)))) : null,
    facts(d.why).length ? h("div", {}, h("h2", { style: "margin-bottom:6px" }, T("Why", "原因")), h("ul", { class: "ilist2" }, facts(d.why).map((x) => h("li", {}, x)))) : null,
    facts(d.how).length ? h("div", {}, h("h2", { style: "margin-bottom:6px" }, T("How", "作法")), h("ul", { class: "ilist2" }, facts(d.how).map((x) => h("li", {}, x)))) : null,
    opts.length ? h("div", { class: "opts", role: "radiogroup", "aria-label": T("Options", "選項") }, opts.map(([k, o]) =>
      h("button", { class: "opt", role: "radio", "aria-pressed": st.chosen === k ? "true" : "false", "aria-checked": st.chosen === k ? "true" : "false", disabled: !!c.boardOnly || null,
        onclick: () => { st.chosen = k; render(); } },
        h("span", { class: "letter" }, k), h("b", {}, o.description || k),
        h("span", { class: "pc" }, o.pros ? h("em", {}, "+ " + o.pros) : null, o.cons ? h("s", {}, "− " + o.cons) : null)))) : null,
    qs.length ? h("div", { style: "display:grid;gap:8px" }, qs.map((q, index) => {
      const a = st.answers.get(index) || { ok: true, text: "" }; st.answers.set(index, a);
      return h("div", { class: "qrow" }, h("label", {}, h("input", { type: "checkbox", checked: a.ok || null, onchange: (e) => { a.ok = e.target.checked; render(); } }), q),
        a.ok ? null : h("input", { class: "input", placeholder: T("What should change?", "要改什麼？"), value: a.text, oninput: (e) => { a.text = e.target.value; } }));
    })) : null,
    h("div", { class: "actions" }, send, disabled && !c.boardOnly ? h("span", { class: "faint", style: "font-size:12px" }, T("Read-only", "唯讀")) : null));
}
function confirmSend(c, st) {
  const answers = [...st.answers.entries()].sort((a, b) => a[0] - b[0]).map(([index, a]) => a.ok ? { index, ok: true } : { index, ok: false, text: a.text || "" });
  if (answers.some((a) => !a.ok && !a.text.trim())) { toast(T("Every unchecked question needs a note.", "每個沒打勾的問題都要寫原因。")); return; }
  const o = (LD(c.details) || {}).options?.[st.chosen];
  modal(T(`Send ${st.chosen} on ${c.id}?`, `在 ${c.id} 送出 ${st.chosen}？`),
    h("p", { class: "muted", style: "margin:0" }, o?.description || st.chosen, " — ", T("the board records it and runs its effect.", "看板會記錄並執行它。")),
    async (close, btn) => {
      btn.disabled = true;
      const r = await fetch("/api/answer", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: c.id, chosen: st.chosen, answers: answers.length ? answers : undefined }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
      close();
      if (r.error) toast(T(`Refused: ${r.error}`, `被拒：${r.error}`));
      else { toast(T(`${c.id}: ${st.chosen} recorded`, `${c.id}：已記錄 ${st.chosen}`)); sel.delete(c.id); window.pageDirty.clean(); }
    });
}
function modal(title, body, onOk) {
  const root = $("#modalRoot");
  const close = () => root.replaceChildren();
  const ok = h("button", { class: "btn primary" }, T("Send", "送出"));
  ok.onclick = () => onOk(close, ok);
  const back = h("div", { class: "modal-back", onclick: (e) => { if (e.target === back) close(); } },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h2", {}, title), body,
      h("div", { class: "actions", style: "justify-content:flex-end" }, h("button", { class: "btn", onclick: close }, T("Cancel", "取消")), ok)));
  root.replaceChildren(back);
  ok.focus();
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

// ---------- crew ----------
let crewLiveOnly = store.get("crew.liveOnly", "0") === "1";
function viewCrew(actor) {
  if (actor) return crewFocus(actor);
  const list = crewLiveOnly ? S.crew.filter((c) => c.alive) : S.crew;
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Crew", "船員")),
      h("p", {}, window.studioAgents?.ready() ? T(`${S.crew.filter((c) => c.alive).length + window.studioAgents.count()} working now · Studio agents and Firstmate rounds`, `目前 ${S.crew.filter((c) => c.alive).length + window.studioAgents.count()} 位工作中 · Studio agent 與 Firstmate 回合`) : window.studioAgents?.status() || T("Checking crew status…","正在確認船員狀態…"))),
      h("div", { class: "seg", role: "group" },
        h("button", { "aria-pressed": crewLiveOnly ? "false" : "true", onclick: () => { crewLiveOnly = false; store.set("crew.liveOnly", "0"); render(); } }, h("span", {}, T("Recent", "近期"))),
        h("button", { "aria-pressed": crewLiveOnly ? "true" : "false", onclick: () => { crewLiveOnly = true; store.set("crew.liveOnly", "1"); render(); } }, h("span", {}, T("Working", "工作中"))))),
    window.studioAgents?.section() || null,
    list.length ? h("div", { class: "crewgrid" }, list.slice(0, 24).map(crewTile))
      : h("div", { class: "card" }, h("div", { class: "empty" }, icon("crew"), h("b", {}, crewLiveOnly ? T("No Firstmate round is working right now","目前沒有 Firstmate 回合在工作") : T("No recent Firstmate rounds","近期沒有 Firstmate 回合")), T("Live rounds show up here with their log.", "跑起來的回合會帶著 log 出現在這裡。"))));
}
const term = (lines, big) => h("div", { class: `screen dark${big ? " big" : ""}` },
  h("div", { class: "term" }, lines.length ? lines.map((l) => h("div", { class: `tl ${l.kind}` }, (l.kind === "tool" ? "▸ " : l.kind === "error" ? "✗ " : l.kind === "result" ? "✓ " : "") + l.text))
    : h("div", { class: "tl fm" }, T("no log yet", "還沒有 log"))));
function crewTile(c) {
  return h("a", { class: `tile${c.alive ? "" : " dead"}`, href: `#/crew/${encodeURIComponent(c.actor)}`, style: "text-decoration:none", "data-actor": c.actor },
    h("div", { class: "tile-top" }, avaFor(c.name, "ava lg"),
      h("div", {}, h("div", { class: "tile-name" }, c.name, h("span", { class: "faint", style: "font-weight:400" }, ` · ${c.role}`)),
        h("div", { class: "tile-task" }, [c.task, c.round ? T(`round ${c.round}`, `第 ${c.round} 回合`) : null, c.attempt ? `#${c.attempt}` : null].filter(Boolean).join(" · "))),
      h("span", { class: "st", style: `color:var(--${c.alive ? "accent" : "text-3"})` }, h("span", { class: `d${c.alive ? " pulse" : ""}` }), c.alive ? T("working", "工作中") : T("finished", "已結束"))),
    h("div", { class: "act" }, act(c.activity) || c.lines?.at(-1)?.text || "\u00a0"),
    h("div", { style: "position:relative" }, term(c.lines || []), c.alive ? h("span", { class: "live" }, h("i"), "LIVE") : null),
    h("div", { class: "tile-stats" }, h("span", { class: "vbadge" }, `${c.vendor || "?"}${c.model ? " · " + c.model : ""}`),
      c.alive ? h("span", {}, T(`up ${dur(c.started)}`, `已跑 ${dur(c.started)}`)) : null, h("span", {}, T(`log ${ago(c.lastWrite)}`, `log ${ago(c.lastWrite)}`))));
}
let focusTimer = null, focusData = null;
function crewFocus(actor) {
  if (!focusData || focusData.actor !== actor) { focusData = { actor, loading: true }; loadFocus(actor); }
  const c = focusData.loading ? S.crew.find((x) => x.actor === actor) : focusData;
  if (!c) return h("div", { class: "page" }, h("div", { class: "skel", style: "height:320px" }));
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", { style: "display:flex;gap:12px;align-items:center" }, avaFor(c.name, "ava lg"),
      h("div", {}, h("h1", {}, c.actor), h("p", {}, [c.role, c.task, c.vendor && `${c.vendor}${c.model ? " · " + c.model : ""}`].filter(Boolean).join(" · ")))),
      h("div", { class: "actions" }, h("a", { class: "btn", href: `#/activity/${c.task || ""}` }, icon("activity", "ic sm"), T("Task activity", "任務事件")), h("a", { class: "btn ghost", href: "#/crew" }, T("All crew", "全部船員")))),
    h("div", { class: "focus" },
      h("div", { style: "position:relative;min-width:0" }, term(c.lines || [], true), c.alive ? h("span", { class: "live" }, h("i"), "LIVE") : null),
      h("div", { class: "card", style: "padding:14px 16px;display:grid;gap:10px;align-content:start" },
        h("h2", {}, T("Round", "回合")),
        kv(T("Status", "狀態"), c.alive ? T("working", "工作中") : T("finished", "已結束")),
        kv(T("Task", "任務"), c.task || "—"), kv(T("Round", "回合"), c.round ?? "—"), kv(T("Attempt", "嘗試"), c.attempt ?? "—"),
        kv(T("Started", "開始"), c.started ? `${clock(c.started)} (${ago(c.started)})` : "—"), kv(T("Last log write", "最後寫 log"), ago(c.lastWrite)),
        h("div", { class: "note" }, h("b", {}, T("Now: ", "目前：")), act(c.activity) || c.lines?.at(-1)?.text || "—"),
        h("p", { class: "faint", style: "font-size:12px;margin:0" }, T("Crew Studio only watches. Rounds start and stop through firstmate's scripts.", "Crew Studio 只觀看；回合由 firstmate 的 scripts 啟動和停止。")))));
}
const kv = (k, v) => h("div", { class: "kv" }, h("span", {}, k), h("b", {}, String(v)));
async function loadFocus(actor) {
  clearTimeout(focusTimer);
  try { const r = await fetch(`/api/crew/${encodeURIComponent(actor)}`); if (r.ok) focusData = await r.json(); } catch {}
  if (S.route?.name === "crew" && S.route.arg === actor) { render(); const t = $(".screen.big .term"); if (t) t.scrollTop = t.scrollHeight; focusTimer = setTimeout(() => loadFocus(actor), 3000); }
}

// ---------- activity ----------
// The event log under the list toolbar (public/list-tools.js), filtered and paged by the server (src/activity-list.ts): the
// log has no cap, so a filter or a page always reads all of it. Task, type and actor are facets; a search reads the
// summaries. #/activity/<task> is the task facet (the URL becomes #/activity?task=<task>).
const AF = { shown: 0, mark: null, liveT: null };
const evClass = (t) => /failed|crashed|lost|violation|unavailable/.test(t) ? "gate-fail" : /approved|merged|passed/.test(t) ? "gate-pass" : /decision/.test(t) ? "card" : t === "crew_status" ? "" : "fm";
function viewActivity(task) {
  if (task) { const q = new URLSearchParams(S.route.query); if (!q.getAll("task").includes(task)) q.append("task", task); q.delete("page");
    history.replaceState(history.state, "", `#/activity?${q}`); S.route = { ...S.route, arg: null, query: q }; }
  const taskName = (id) => { const t = S.tasks.find((x) => x.id === id); return t?.title ? `${id} · ${t.title}` : id; };
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Activity", "事件紀錄")),
      h("p", {}, T(`firstmate's event log, ${S.events.toLocaleString()} events. Everything the crew does lands here first.`, `firstmate 的事件紀錄，共 ${S.events.toLocaleString()} 筆。船員做的每件事都先寫到這裡。`))),
      h("a", { class: "btn", href: "#/crew" }, T("← Back to Crew", "← 回 Crew"))),
    window.crewListTools.list({ id: "activity", route: "activity", path: "#/activity", title: T("events", "事件"), noun: ["event", "事件"],
      placeholder: T("Search what happened…  or type type:node_failed", "搜尋事件內容…  也可以打 type:node_failed"),
      facets: [{ key: "type", name: "Type" }, { key: "actor", name: "Actor" }, { key: "task", name: "Task", show: taskName }],
      sorts: [{ key: "new", label: T("Newest first", "最新的在上") }, { key: "old", label: T("Oldest first", "最舊的在上") }],
      emptyAttrs: { id: "evlist" }, // #evlist is the log's list whether it holds events or says none match
      server: async (st) => { const q = new URLSearchParams({ page: String(st.page), size: String(st.size) });
        if (st.sort === "old") q.set("sort", "old"); if (st.free.length) q.set("q", st.free.map((w) => (/\s/.test(w) ? `"${w}"` : w)).join(" "));
        for (const k of ["type", "actor", "task"]) { for (const v of st.f[k] || []) q.append(k, v); for (const v of st.tok[k] || []) q.append(`tok.${k}`, v); }
        const r = await fetch(`/api/activity?${q}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); },
      none: () => h("div", { class: "card evlist" }, h("div", { class: "empty" }, h("b", {}, T("No events yet", "還沒有事件")))),
      // a live refresh (connect(), below) marks the rows newer than the newest one shown before it; any other draw marks none
      rows: (page, ctx) => { const mark = AF.mark; AF.mark = null; AF.shown = Math.max(0, ...page.map((e) => e.seq));
        return h("div", { class: "card evlist", id: "evlist" }, page.map((e) => evRow(e, mark != null && e.seq > mark, ctx.mark))); } }));
}
function evRow(e, fresh, mark = (t) => t) {
  return h("div", { class: `ev${fresh === true ? " new" : ""}`, "data-seq": e.seq },
    h("span", { class: "faint num", title: e.ts }, clock(e.ts)),
    h("span", { class: `evt ${evClass(e.type)}` }, e.type),
    h("span", { style: "min-width:0;overflow-wrap:anywhere" }, mark(L(e.summary)), act(e.activity) && act(e.activity) !== L(e.summary) ? h("span", { class: "faint" }, ` — ${act(e.activity)}`) : null),
    h("span", { class: "evmeta" }, e.task ? h("a", { class: "vbadge", href: `#/activity/${e.task}` }, e.task) : null, h("span", { class: "vbadge" }, e.actor || "—")));
}

// ---------- workflow ----------
function viewWorkflow(taskId) {
  const f = S.flow;
  if (!f) return h("div", { class: "skel", style: "height:300px" });
  const sel = S.tasks.find((t) => t.id === (taskId || S.sel)) || null;
  const W = 172, H = 70, PAD = 30;
  const maxX = Math.max(...f.nodes.map((n) => n.x)) + W + PAD * 2, maxY = Math.max(...f.nodes.map((n) => n.y)) + H + PAD * 2;
  const by = Object.fromEntries(f.nodes.map((n) => [n.id, n]));
  const counts = {}; for (const t of S.tasks) if (t.status !== "done" && t.status !== "idle") counts[t.node] = (counts[t.node] || 0) + 1;
  const onPath = sel ? new Set(pathFor(sel.door)) : null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graph"); svg.setAttribute("width", maxX); svg.setAttribute("height", maxY); svg.setAttribute("viewBox", `0 0 ${maxX} ${maxY}`);
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", T("Code workflow graph", "寫 code 的流程圖"));
  let out = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--border-strong)"/></marker></defs>`;
  for (const [a, b, label] of f.edges) {
    const A = by[a], B = by[b]; if (!A || !B) continue;
    const back = B.x < A.x;
    // forward edges leave right and enter left; a back edge (REJECT) arcs over the top
    const x1 = A.x + PAD + (back ? W / 2 : W), y1 = A.y + PAD + (back ? 0 : H / 2), x2 = B.x + PAD + (back ? W / 2 : 0), y2 = B.y + PAD + (back ? 0 : H / 2);
    const hot = sel && onPath.has(a) && onPath.has(b) && !(label === "REJECT");
    const d = back ? `M${x1} ${y1} C ${x1} ${y1 - 90}, ${x2} ${y2 - 90}, ${x2} ${y2}` : `M${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;
    out += `<path class="ge${hot ? " hot" : ""}" d="${d}" marker-end="url(#ah)"/>`;
    if (label) out += `<text class="gel" x="${(x1 + x2) / 2}" y="${back ? Math.min(y1, y2) - 70 : (y1 + y2) / 2 - 8}" text-anchor="middle">${esc(label)}</text>`;
  }
  for (const n of f.nodes) {
    const x = n.x + PAD, y = n.y + PAD, c = counts[n.id] || 0;
    const hot = sel && sel.node === n.id, dim = sel && !onPath.has(n.id);
    out += `<g class="gn${hot ? " hot" : ""}${dim ? " dim" : ""}" data-node="${n.id}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="10"/>`
      + `<text class="kind" x="${x + 12}" y="${y + 18}">${esc(n.kind)}</text><text class="lbl" x="${x + 12}" y="${y + 38}">${esc(n.label)}</text>`
      + `<text class="det" x="${x + 12}" y="${y + 56}">${esc(n.detail || "")}</text>`
      + (c ? `<circle class="cntbg" cx="${x + W - 14}" cy="${y + 14}" r="10"/><text class="cnt" x="${x + W - 14}" y="${y + 18}" text-anchor="middle">${c}</text>` : "") + `</g>`;
  }
  svg.innerHTML = out;
  const active = S.tasks.filter((t) => t.status !== "done" && t.status !== "idle");
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, `${f.name}`, " ", h("span", { class: "vbadge" }, `v${f.version}`)),
      h("p", {}, T("Read-only view of today's flow, from workflows/code.flow.yaml. Badges count active tasks on each step; pick a task to trace its path.", "今天流程的唯讀檢視，來自 workflows/code.flow.yaml。數字是各步驟上進行中的任務；選一個任務可看它的路徑。")))),
    h("div", { class: "graphwrap" }, svg),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Where each task is", "每個任務在哪一步"))),
      h("div", { class: "card placed" }, f.nodes.filter((n) => active.some((t) => t.node === n.id)).map((n) =>
        h("div", { class: "prow" }, h("b", {}, n.label), h("div", {}, active.filter((t) => t.node === n.id).map((t) =>
          h("button", { class: "tchip", "aria-pressed": sel?.id === t.id ? "true" : "false", title: t.title,
            onclick: () => { S.sel = sel?.id === t.id ? null : t.id; location.hash = S.sel ? `#/workflow/${S.sel}` : "#/workflow"; } },
            h("span", { class: "tid" }, t.id), doorBadge(t.door), statusBadge(t.status)))))),
        active.length ? null : h("div", { class: "empty" }, T("No active task", "沒有進行中的任務")))));
}

// ---------- live data ----------
async function load() {
  // Bootstrap metadata belongs to this load/error boundary, before live-ready.
  const [s, types] = await Promise.all([fetch("/api/summary").then((r) => r.json()), fetch("/api/types").then((r) => r.json()), loadWorkflowNames()]);
  Object.assign(S, { tasks: s.tasks, pending: s.pending, crew: s.crew, github: s.github, board: s.board, flow: s.flow, events: s.events, types });
  // the legacy firstmate checkout's name, when Studio reads one; a native Studio names no checkout
  $("#wsSub").textContent = s.legacy ? s.state.split("/").slice(-2, -1)[0] || "" : "";
  route();
}
// the page's one event stream: every module listens on it (window.liveListen), none opens its own;
// a browser keeps 6 connections per host, and each extra stream starves the page's requests
const LIVE = { es: null, queue: [] };
// a deploy (live S25): an open tab kept the old page JS until a manual reload. The page knows the release it is (index.html's
// crew-release meta, src/page-release.ts); when the stream's hello names another, it reloads itself if that loses nothing (no
// unsent state anywhere, no request in flight), else it shows a small bar to reload
const RELEASE = { mine: document.querySelector('meta[name="crew-release"]')?.content || null, inflight: 0 };
{ const _f = window.fetch; window.fetch = (input, init) => { const own = String(typeof input === "string" ? input : input?.url).includes("/api/main/locale");
  if (!own) RELEASE.inflight++; const r = _f(input, init); if (!own) r.finally(() => { RELEASE.inflight--; }).catch(() => {}); return r; }; }
// What a reload would lose, asked of the modules that own it rather than guessed from the DOM: each module that holds unsent
// state (the chat draft and its attachments, a mounted card's ticks, picks, notes and acknowledgement, a firstmate card's
// choice, the Start form's draft) provides a check. As a safety net any input, change or composition on the page marks it
// touched until a module says its state was sent or cleared (pageDirty.clean()); an open dialog or preview counts too.
window.pageDirty = {
  checks: new Map(), touched: false,
  /** name → () => true while it holds unsent state; a check that throws counts as unsent */
  provide(name, check) { this.checks.set(name, check); },
  drop(name) { this.checks.delete(name); },
  /** a module sent or cleared what it held: the page is clean again unless a check still says otherwise */
  clean() { this.touched = false; },
  why() {
    for (const [name, check] of this.checks) { let d = true; try { d = !!check(); } catch {} if (d) return name; }
    if (this.touched) return "input";
    const shown = (e) => e.getClientRects().length > 0;
    if ([...document.querySelectorAll("dialog[open], [role=dialog], [aria-modal=true], #modalRoot > *, .lightbox, [data-preview-open]")].some(shown)) return "dialog";
    // fields no module claims: any typed text or secret, and any tick or pick that differs from what the page drew
    for (const e of document.querySelectorAll("textarea, input, select, [contenteditable=true], [contenteditable='']")) {
      if (e.disabled || e.readOnly || e.closest("[data-no-unsent], [data-unsent-owner]")) continue; // an owned field: its module says
      const t = (e.type || "").toLowerCase();
      if (e.tagName === "SELECT") { if ([...e.options].some((o) => o.selected !== o.defaultSelected) && [...e.options].some((o) => o.defaultSelected)) return "pick"; continue; }
      if (t === "checkbox" || t === "radio") { if (e.checked !== e.defaultChecked) return "tick"; continue; }
      if (["button", "submit", "reset", "hidden", "range", "color", "image"].includes(t)) continue;
      if (t === "file") { if (e.files?.length) return "file"; continue; }
      const v = "value" in e ? e.value : e.textContent; if (String(v ?? "").trim()) return "text";
    }
    return null;
  },
};
window.pageDirty.provide("firstmate-cards", fmCardsDirty);
for (const ev of ["input", "change", "compositionstart"]) document.addEventListener(ev, (e) => { if (!e.target?.closest?.("[data-no-unsent]")) window.pageDirty.touched = true; }, true);
function releaseBar(said) {
  const bar = $("#releaseBar") || document.body.appendChild(h("div", { id: "releaseBar", role: "status", "data-release": said }));
  const ask = () => bar.replaceChildren(h("span", {}, T("There is unsent content. Reload anyway?", "有未送出的內容，仍要重新載入？")),
    h("button", { class: "btn sm", "data-release-confirm": "1", onclick: () => location.reload() }, T("Reload", "重新載入")),
    h("button", { class: "btn ghost sm", "data-release-cancel": "1", onclick: () => releaseBar(said) }, T("Cancel", "取消")));
  bar.replaceChildren(h("span", {}, T("Studio was updated", "Studio 已更新")),
    h("button", { class: "btn sm", "data-release-reload": "1", onclick: () => (window.pageDirty.why() ? ask() : location.reload()) }, T("Reload", "重新載入")));
}
// true: the page is reloading. Requests in flight get a moment to settle (a reconnect fires a few reads) before they count
function checkRelease(said) {
  if (!said) return false;
  if (!RELEASE.mine) { RELEASE.mine = said; return false; }
  if (said === RELEASE.mine) return false;
  const decide = (tries) => {
    if (window.pageDirty.why()) return releaseBar(said);
    if (RELEASE.inflight > 0 && tries > 0) return setTimeout(() => decide(tries - 1), 100);
    if (RELEASE.inflight > 0) return releaseBar(said);
    location.reload();
  };
  if (!window.pageDirty.why() && !RELEASE.inflight) { location.reload(); return true; }
  decide(30);
  return false;
}
window.liveListen = (type, fn) => { if (LIVE.es) LIVE.es.addEventListener(type, fn); else LIVE.queue.push([type, fn]); };
function connect() {
  const es = new EventSource("/api/stream");
  LIVE.es = es; for (const [t, f] of LIVE.queue) es.addEventListener(t, f); LIVE.queue = [];
  const conn = (state) => { S.conn = state; const c = $("#conn"); c.className = `conn ${state === "live" ? "ok" : state === "down" ? "bad" : ""}`;
    c.querySelector("span").textContent = state === "live" ? T("Live", "即時") : state === "down" ? T("Reconnecting…", "重新連線中…") : T("Connecting…", "連線中…"); };
  // every (re)connect: modules read their state again, so an event missed while the stream was down is not lost (unit inbox-live)
  // firstmate's open cards too: a card that landed after the page read its summary but before this stream connected was
  // announced to nobody (the server reads the cards fresh on each summary; the stream only says what changes after it)
  es.addEventListener("hello", (m) => { let said = null; try { said = JSON.parse(m.data)?.release ?? null; } catch {} if (checkRelease(said)) return;
    conn("live"); dispatchEvent(new Event("crew:live")); tellLang();
    fetch("/api/summary").then((r) => r.json()).then((s) => { if (!Array.isArray(s?.pending) || JSON.stringify(s.pending) === JSON.stringify(S.pending)) return;
      S.pending = s.pending; S.tasks = s.tasks ?? S.tasks; if (["board", "inbox"].includes(S.route?.name)) soft(); else updateNav(); }).catch(() => {}); });
  es.onerror = () => conn("down");
  es.addEventListener("events", (m) => {
    const d = JSON.parse(m.data); S.tasks = d.tasks; S.events += d.events.length;
    // the Activity page asks its page again (the server filters): new events that match show up marked as new
    if (S.route?.name === "activity") { clearTimeout(AF.liveT); AF.liveT = setTimeout(() => { AF.mark = AF.shown; $('#view [data-lt="activity"]')?.ltRefresh?.(); }, 250); return updateNav(); }
    if (S.route?.name === "board" || S.route?.name === "workflow") soft(); else updateNav();
  });
  es.addEventListener("pending", (m) => { const d = JSON.parse(m.data); S.pending = d.pending; S.tasks = d.tasks;
    if (["board", "inbox"].includes(S.route?.name)) soft(); else updateNav(); });
  es.addEventListener("crew", (m) => { const d = JSON.parse(m.data); S.crew = d.crew; S.tasks = d.tasks;
    if (S.route?.name === "crew" && !S.route.arg) soft(); else if (S.route?.name === "board") soft(); else updateNav(); });
  es.addEventListener("github", (m) => { S.github = JSON.parse(m.data); if (S.route?.name === "board") soft(); });
  // a rename in another tab or by another device: this page shows the new name too (src/runtime/index.ts sends it)
  es.addEventListener("workflow-names", (m) => { try { setWorkflowNames(JSON.parse(m.data)?.names); } catch {} soft(); });
  es.addEventListener("intents",(m) => window.onIntents?.(JSON.parse(m.data)));
  es.addEventListener("chat", (m) => window.onChatInfo?.(JSON.parse(m.data)));
  for (const t of ["artifacts", "run", "lane"]) es.addEventListener(t, (m) => window.onM3?.(t, JSON.parse(m.data)));
  for (const t of ["improve", "agent", "changes", "packs", "fileorg", "skins"]) es.addEventListener(t, (m) => { for (const f of window.onExt || []) f(t, JSON.parse(m.data)); });
}

// ---------- shell: theme, language, sidebar ----------
function setTheme(t) { if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; store.set("crew.theme", t);
  $$("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === t))); }
// Studio learns the Board's language: Firstmate's first message (a Start, a switch, a restart) greets in it. Said on every
// language change and on every stream hello, so a Studio that restarted (and may be waiting to greet) hears it from a Board
// that was already open
// It also says whether this tab is the one on screen and whether the captain chose the language (Settings) or it is only this
// browser's default: a restart greets in the language of the Board the captain is looking at, not of a tab left in the back
function tellLang() { fetch("/api/main/locale", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ locale: lang, visible: document.visibilityState !== "hidden", explicit: store.get("crew.lang", null) != null, tab: TAB_ID }) }).catch(() => {}); }
// this page's own id in those reports (Studio logs them, so a live check can tell which tab said what); new on every load
const TAB_ID = Math.random().toString(36).slice(2, 10);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tellLang(); });
// persist = false keeps a first-run (browser) language unstored until the captain picks one in Settings
function setLang(l, persist = true) { l = I18N.LANGS.includes(l) ? l : "en"; lang = l; if (l !== "en") lastZh = l; if (persist) store.set("crew.lang", l); document.documentElement.lang = l;
  tellLang();
  $$("[data-lang-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.langSet === l)));
  const names = { board: ["Board", "看板"], inbox: ["Inbox", "收件匣"], crew: ["Crew", "船員"], activity: ["Activity", "事件"], workflow: ["Workflow", "流程"], intents: ["Intents", "意圖"], library: ["Library", "成品庫"], remote: ["Phone", "手機"], doctor: ["Doctor", "健康檢查"], changes: ["Changes", "變更"] };
  $$(".nav-item").forEach((b) => { const n = names[b.dataset.view]; if (!n) return; b.querySelector(".nl").textContent = T(...n); b.dataset.tip = T(...n); });
  const th = { system: ["Auto", "自動", "Use system theme", "跟隨系統主題"], light: ["Light", "淺色", "Light theme", "淺色主題"], dark: ["Dark", "深色", "Dark theme", "深色主題"] };
  $("#themeLabel").textContent = T("Theme", "主題"); $("#themeSeg").setAttribute("aria-label", T("Theme", "主題"));
  $$("#themeSeg button").forEach((b) => { const t = th[b.dataset.themeSet]; if (!t) return; const sp = b.querySelector("span:not([data-ic])"); if (sp) sp.textContent = T(t[0], t[1]); b.setAttribute("aria-label", T(t[2], t[3])); });
  window.onLang?.();
  if (S.route) render(); }
function setSide(collapsed) { document.body.classList.toggle("side-collapsed", collapsed); store.set("crew.side", collapsed ? "collapsed" : "open");
  $("#sideTog").setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar"); }

hydrateIcons(document);
setTheme(store.get("crew.theme", "system"));
if (document.documentElement.classList.contains("pre-collapsed")) document.body.classList.add("side-collapsed");
$$("#themeSeg button").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeSet)));
// a nav item may open another route than its own name (Crew opens the team page, #/team)
$$(".nav-item").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.href || `#/${b.dataset.view}`; }));
$("#sideTog").addEventListener("click", () => setSide(!document.body.classList.contains("side-collapsed")));
addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); setSide(!document.body.classList.contains("side-collapsed")); } });
addEventListener("hashchange", route);
// Studio runs in an app window with no back button: a link that leaves Studio always opens in a new window (target=_blank,
// rel=noopener), never in this one, whatever page drew it; Studio's own pages stay in place (the browser's back works for them). It listens
// in the bubble phase, so a link's own handler runs first and can take the click (preventDefault)
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[href]"); if (!a || e.defaultPrevented || a.hasAttribute("download") || e.button > 0) return;
  let u; try { u = new URL(a.getAttribute("href"), location.href); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return;
  if (a.target === "_blank") { if (!/noopener/.test(a.rel)) a.rel = "noopener noreferrer"; return; }
  e.preventDefault(); window.open(u.href, "_blank", "noopener,noreferrer");
});
setInterval(() => { if (S.route?.name === "board") render(); }, 30_000); // keep "ago" fresh
setLang(lang, false);
load().then(connect).catch((e) => { $("#view").replaceChildren(h("div", { class: "card" }, h("div", { class: "empty" }, icon("alert"), h("b", {}, "Crew Studio could not load"), String(e)))); });
