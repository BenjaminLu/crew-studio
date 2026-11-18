// Web terminals (docs/units/web-terminal.md): #/terminals[/<id>], a "Terminals" tab in the Firstmate panel, and a
// "waiting for you" count on the sidebar's Firstmate item. Any agent CLI (or a command) runs in a real PTY in a project's
// folder, NOT sandboxed: with this user's full permissions, as in the captain's own Terminal. xterm.js
// (public/vendor, pinned, loaded on first use) draws it. The Mac's page types, resizes, starts and stops; a phone only
// watches: its terminal has no input element and the page offers no control. Output arrives over one SSE stream per
// open terminal (GET /api/terminals/<id>/stream: a replay, then live); the list's changes come on the page's own stream
// ("terminals"). Loaded before backbone.js.
(() => {
const XV = "6.0.0", FITV = "0.11.0", U11V = "0.9.0";
const TM = { refused: new Map(), list: null, presets: [], projects: [], canWrite: false, err: null, panes: new Map(), prev: new Map(), busy: false, cmd: "", args: "", showNew: null,
  project: store.get("crew.term.project", ""), rc: store.get("crew.term.rc", "1") !== "0", tab: store.get("crew.chat.tab", "chat") };
window.crewTerminals = TM;
const getJ = async (u) => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const STATE = { working: ["run", () => T("Working", "執行中")], waiting: ["human", () => T("Waiting for you", "等你")], done: ["ok", () => T("Done", "完成")], exited: ["bad", () => T("Exited", "已結束")] };
const badge = (t) => { const [c, l] = STATE[t.state] || STATE.working; const code = t.state === "exited" ? (t.signal ? ` ${t.signal}` : t.exitCode != null ? ` ${t.exitCode}` : "") : "";
  return h("span", { class: `badge ${c}`, "data-term-state": t.state, title: t.ask || "" }, h("span", { class: "d" }), l() + code); };
const waiting = () => (TM.list || []).filter((t) => t.running && t.state === "waiting");
const cur = () => (S.route?.name === "terminals" ? S.route.arg : null);
const onPage = () => S.route?.name === "terminals";
// a terminal in a pane of the tab on screen (the tabs and panes below)
const onScreen = (id) => cur() === id || panesOf(curTab()?.root).some((p) => p.term === id);

// ---------- data ----------
async function load() {
  try { const j = await getJ("/api/terminals"); TM.err = null; TM.canWrite = !!j.canWrite; TM.presets = j.presets || []; TM.projects = j.projects || []; apply(j.terminals || []); restarted(j.boot, j.restartEnded); }
  catch (e) { TM.err = String(e.message || e); if (TM.list === null) TM.list = []; }
  if (!TM.project || !TM.projects.some((p) => p.id === TM.project)) TM.project = TM.projects[0]?.id || "";
  redraw();
}
function apply(list) {
  // "waiting for you": a toast here, a system notification when the page is in the background (the captain allowed it)
  for (const t of list) {
    const was = TM.prev.get(t.id);
    if (was && was !== "waiting" && t.state === "waiting" && t.running && !(onPage() && onScreen(t.id) && !document.hidden)) {
      const msg = T(`${t.label} in ${t.project.name} is waiting for you${t.ask ? `: ${t.ask}` : ""}`, `${t.project.name} 的 ${t.label} 在等你${t.ask ? `：${t.ask}` : ""}`);
      toast(msg);
      try { if (document.hidden && window.Notification?.permission === "granted") new Notification("Crew Studio", { body: msg, tag: `term-${t.id}` }); } catch {}
    }
    TM.prev.set(t.id, t.state);
  }
  TM.list = list; seeRunning();
}
// Studio restarted since this window last saw it (a PTY cannot outlive Studio): the terminals that were running when
// this window last loaded the list, and are not running now, leave its tabs, and the page says once how many, rather
// than drawing a dead tab. A terminal that had already ended (an agent kept for Send for review) keeps its tab. What the
// window saw is its own (sessionStorage, which a reload of the same window keeps), so every open window cleans its own
// tabs; a new window starts from the last one any window saw (localStorage). A reload of the same run says nothing.
const SEEN = "crew.term.seen";
function seenBefore() { for (const s of [() => sessionStorage, () => localStorage]) { try { const v = JSON.parse(s().getItem(SEEN) || "null"); if (v && typeof v.boot === "string" && Array.isArray(v.running)) return v; } catch {} } return null; }
// a terminal seen running on the page's live stream (started in another window, say) counts as seen in this run too;
// a live list never removes one (after a restart the stream's first list comes before the run is known)
function seeRunning() {
  if (!TM.boot) return; const ids = TM.list.filter((t) => t.running).map((t) => t.id); if (!ids.length) return;
  for (const s of [() => sessionStorage, () => localStorage]) { try { const v = JSON.parse(s().getItem(SEEN) || "null");
    if (v && v.boot === TM.boot && Array.isArray(v.running) && ids.some((id) => !v.running.includes(id))) s().setItem(SEEN, JSON.stringify({ boot: v.boot, running: [...new Set([...v.running, ...ids])] })); } catch {} }
}
function restarted(boot, ended = []) {
  if (!boot) return; const was = seenBefore(); TM.boot = boot;
  const now = JSON.stringify({ boot, running: TM.list.filter((t) => t.running).map((t) => t.id) });
  for (const s of [() => sessionStorage, () => localStorage]) { try { s().setItem(SEEN, now); } catch {} }
  if (!was || was.boot === boot) return;
  // only those Studio's stop ended (their records say so): one that had ended on its own, while no window looked, keeps its tab
  const byStop = new Set(Array.isArray(ended) ? ended : []);
  const died = new Set(was.running.filter((id) => byStop.has(id) && !TM.list.some((t) => t.id === id && t.running))); let n = 0;
  for (const tab of [...TM.lay.tabs]) for (const pn of panesOf(tab.root)) if (died.has(pn.term)) { n++; detachPane(tab, pn); }
  if (!n) return;
  TM.autoOpened = true; // the tabs were the captain's: none is opened in their place
  // an address that names a terminal the restart ended (the window reopened where it was) is replaced, or the page would
  // reveal that tab again; opening it from the list later is a new address, and works as ever
  if (died.has(cur())) { history.replaceState(null, "", "#/terminals"); S.route.arg = null; TM.lastArg = null; }
  toast(T(`${n === 1 ? "A terminal session" : `${n} terminal sessions`} ended when Studio restarted`, `${n} 個工作階段在 Studio 重啟時結束`));
}
let redrawT = null;
function redraw() {
  badgeNav(); drawTab();
  // once a terminal is shown, its list and header are patched in place: a full re-render waits while any field has the focus
  // (the command field, the terminal), and a state change, an exit or a review row must not wait for a blur (live bug)
  if (onPage()) { clearTimeout(redrawT); redrawT = setTimeout(() => (document.querySelector("[data-term-detail]") ? patchPage() : soft()), 0); }
}
window.liveListen?.("terminals", (m) => { try { const d = JSON.parse(m.data); const known = new Map((TM.list || []).map((t) => [t.id, t]));
  // the stream carries the phone-safe summary (no Remote Control link): keep the link the page already has
  apply((d.terminals || []).map((t) => (t.remote && known.get(t.id)?.remote?.url ? { ...t, remote: { ...t.remote, url: known.get(t.id).remote.url } } : t))); redraw(); } catch {} });
window.liveListen?.("hello", () => load());
addEventListener("focus", () => { if (TM.list) load(); });

// ---------- the sidebar's count and the Firstmate panel's tab ----------
function badgeNav() {
  const item = document.querySelector('.nav-item[data-view="terminals"]'); if (!item) return;
  let b = item.querySelector("#navTerms"); const n = waiting().length;
  if (!b) { b = h("span", { class: "count attn", id: "navTerms" }); item.append(b); }
  b.hidden = !n; b.textContent = n ? String(n) : ""; b.title = T(`${n} terminals waiting for you`, `${n} 個終端機在等你`);
}
function drawTab() {
  const chat = document.getElementById("chat"), head = chat?.querySelector(".chat-head"); if (!head) return;
  let bar = chat.querySelector(".chat-tabs"), pane = document.getElementById("chatTerms");
  if (!bar) {
    bar = h("div", { class: "chat-tabs", role: "tablist", "aria-label": T("Firstmate panel", "Firstmate 面板") });
    pane = h("div", { id: "chatTerms", class: "chat-terms", role: "tabpanel" });
    head.after(bar); bar.after(pane);
  }
  const tab = (id, label) => h("button", { type: "button", role: "tab", "data-chat-tab": id, "aria-selected": String(TM.tab === id), onclick: () => { TM.tab = id; store.set("crew.chat.tab", id); drawTab(); if (id === "terms") load(); } }, label);
  const n = waiting().length;
  bar.replaceChildren(tab("chat", T("Chat", "對話")), tab("terms", h("span", {}, T("Terminals", "終端機"), n ? h("span", { class: "count attn" }, String(n)) : null)));
  chat.classList.toggle("show-terms", TM.tab === "terms");
  pane.hidden = TM.tab !== "terms";
  if (TM.tab !== "terms") return;
  const rows = (TM.list || []).map((t) => h("a", { class: "ct-row", href: `#/terminals/${encodeURIComponent(t.id)}`, "data-term-row": t.id },
    h("span", { class: "ct-name" }, t.label, h("span", { class: "faint" }, ` · ${t.project.name}`)), badge(t), t.ask ? h("span", { class: "ct-ask" }, t.ask) : null));
  pane.replaceChildren(
    h("div", { class: "ct-head" }, h("b", {}, T("Terminals", "終端機")), h("a", { class: "btn sm", href: "#/terminals" }, TM.canWrite ? T("Open · new", "開啟 · 新增") : T("Open", "開啟"))),
    rows.length ? h("div", { class: "ct-list" }, rows) : h("p", { class: "faint" }, TM.canWrite ? T("No terminals yet. Start an agent from the Terminals page.", "還沒有終端機。到「終端機」頁啟動一個 agent。") : T("No terminals running.", "沒有執行中的終端機。")),
    TM.canWrite ? "" : h("p", { class: "faint ct-ro" }, T("View only on this device.", "此裝置只能檢視。")));
}

// ---------- xterm, loaded on first use ----------
let xtermP = null;
function xterm() {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  if (xtermP) return xtermP;
  const add = (tag, attrs) => new Promise((res, rej) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.onload = res; e.onerror = () => rej(new Error(`${attrs.src || attrs.href} did not load`)); document.head.append(e); });
  xtermP = Promise.all([add("link", { rel: "stylesheet", href: `/vendor/xterm-${XV}.css` }), add("script", { src: `/vendor/xterm-${XV}.min.js` }).then(() => Promise.all([add("script", { src: `/vendor/xterm-addon-fit-${FITV}.min.js` }), add("script", { src: `/vendor/xterm-addon-unicode11-${U11V}.min.js` }).catch(() => {}) /* widths only: the terminal works without it */]))]).catch((e) => { xtermP = null; throw e; });
  return xtermP;
}
const css = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
const b64bytes = (s) => { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
// The font: the Mac's own monospace for text, then the Nerd Fonts a shell prompt is drawn for (powerlevel10k, starship,
// oh-my-posh: Powerline separators U+E0A0-E0D4 and icons up to U+F8FF, in the private use area), so those glyphs come from the font
// the captain installed for them instead of drawing as empty boxes. The browser falls back glyph by glyph: text keeps the
// first font that has it. Unicode 11 widths (its addon): an emoji takes the two cells a program that measures it counts,
// not one with the next character drawn over it.
const TERM_FONT = ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "'MesloLGS NF'", "'MesloLGS Nerd Font'", "'Symbols Nerd Font Mono'", "'Symbols Nerd Font'",
  "'JetBrainsMono Nerd Font'", "'JetBrainsMono NF'", "'FiraCode Nerd Font'", "'Hack Nerd Font'", "'CaskaydiaCove Nerd Font'", "'Powerline Symbols'", "monospace"].join(", ");
function unicode11(term) {
  try { if (!window.Unicode11Addon || !term.unicode) return; term.loadAddon(new window.Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = "11"; } catch {}
}
// The wheel through the scrollback: as far as the wheel or trackpad moved, a row per row height of pixels (xterm.js 5.5.0's
// way). 6.0.0's scrollbar reads the deprecated wheelDelta instead, a fixed step per event whatever the distance, so a
// trackpad flick moved a line or two. In the capture phase, ahead of xterm, and only on the normal screen with no mouse
// reporting asked for: a full-screen program (vim, less, an agent's TUI) still gets the wheel from xterm as before.
function wheelRows(host, term) {
  let part = 0;
  host.addEventListener("wheel", (e) => {
    try {
      if (!e.deltaY || e.shiftKey || e.ctrlKey || term.buffer.active.type !== "normal" || term.modes.mouseTrackingMode !== "none") return;
      const rowPx = (term.element?.querySelector(".xterm-screen")?.clientHeight || 0) / term.rows; if (!(rowPx > 0)) return;
      part += e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * term.rows : e.deltaY / rowPx;
      const n = Math.trunc(part); part -= n;
      if (n) term.scrollLines(n);
      e.preventDefault(); e.stopPropagation();
    } catch {}
  }, { capture: true, passive: false });
}
function pane(t) {
  let p = TM.panes.get(t.id); if (p) return p;
  p = { host: h("div", { class: "wt-xterm", "data-term-host": t.id }), term: null, fit: null, queue: "", sending: Promise.resolve(), flushT: null, sizeT: null, err: null };
  TM.panes.set(t.id, p);
  xterm().then(() => {
    // colours that read (public/term-theme.js): the 16 ANSI colours and their dim forms at 4.5:1 on this background, and
    // xterm keeps any other colour a program asks for (256-colour, truecolor) at 4.5:1 too
    const TT = window.crewTermTheme, { theme, dim } = TT.themeFor(css("--surface-2", "#111111"), css("--text", "#dddddd"), css("--accent", "#6699ff"));
    p.host.append(h("style", {}, TT.dimCss(`[data-term-host="${CSS.escape(t.id)}"]`, dim)));
    const term = new window.Terminal({ cursorBlink: TM.canWrite, disableStdin: !TM.canWrite, scrollback: 5000, fontSize: 13, allowProposedApi: true, // term.unicode (Unicode 11 widths) is a proposed API
      fontFamily: TERM_FONT, theme, minimumContrastRatio: TT.AA });
    const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(p.host); p.term = term; p.fit = fit; unicode11(term); wheelRows(p.host, term);
    // a phone watches: no input element at all, so a tap never opens a keyboard
    if (!TM.canWrite) p.host.querySelectorAll("textarea, input").forEach((e) => e.remove());
    else {
      term.onData((d) => { p.queue += d; clearTimeout(p.flushT); p.flushT = setTimeout(() => flush(t.id, p), 8); });
      term.onResize(({ cols, rows }) => { clearTimeout(p.sizeT); p.sizeT = setTimeout(() => postJ(`/api/terminals/${t.id}/resize`, { cols, rows }).catch(() => {}), 120); });
    }
    try { new ResizeObserver(() => { try { if (p.host.isConnected && p.host.clientWidth) fit.fit(); } catch {} }).observe(p.host); } catch {}
    try { fit.fit(); } catch {}
    // everything the shared stream brought for it so far, a tab drawn later or a pane unzoomed included
    const f = FEED.get(t.id); if (f) { if (f.trimmed) term.write(dropNote()); for (const c of f.log) term.write(c); }
    if (TM.canWrite && focusPane()?.term === t.id && !sheetOpen() && !document.activeElement?.matches?.("[data-lt-q], [data-lt-fq]")) term.focus(); // never from the list search being typed in
  }).catch((e) => { p.err = String(e.message || e); p.host.replaceChildren(h("p", { class: "faint" }, T(`The terminal view could not load: ${p.err}`, `終端機畫面無法載入：${p.err}`))); });
  return p;
}
// ---------- output: every pane's terminal on one stream (GET /api/terminals/mux) ----------
// A browser keeps at most six connections to Studio; one stream per pane would leave none for typing once five panes are
// open. The page holds one stream for all the terminals in its tabs, opened again when that set changes (each terminal
// replays, so nothing is lost), and closed for a terminal that leaves every tab.
const MUX = { es: null, key: "", retryT: null, retryMs: 3000 };
// Per terminal, what the stream has written (its log, bounded) and up to where (end, a position in its output). The stream
// carries every terminal in the tabs, drawn or not: a pane drawn later (another tab, after a reload, a pane unzoomed) is
// filled from the log. When the stream opens again (a pane added or closed), each terminal replays; one already shown up
// to some position gets only what follows, so a pane whose terminal stayed is never reset (its scrollback and selection stay).
const FEED = new Map(), LOG_CAP = 2 * 1024 * 1024;
TM.feed = FEED; TM.resets = 0; TM.gone = new Map();
const feedOf = (id) => { let f = FEED.get(id); if (!f) FEED.set(id, (f = { end: null, log: [], size: 0, trimmed: false, exited: false })); return f; };
const dropNote = (n) => `\x1b[2m${n ? T(`[earlier output dropped: ${n} bytes]`, `[較早的輸出已捨棄：${n} bytes]`) : T("[earlier output dropped]", "[較早的輸出已捨棄]")}\x1b[0m\r\n`;
function onOut(id, type, d) {
  const f = feedOf(id), term = TM.panes.get(id)?.term;
  const put = (c) => { f.log.push(c); f.size += c.length; while (f.size > LOG_CAP && f.log.length > 1) { f.size -= f.log.shift().length; f.trimmed = true; } term?.write(c); };
  const fresh = () => { const had = f.end !== null || f.log.length > 0; f.log = []; f.size = 0; f.trimmed = false; f.exited = false; f.end = null; if (term && had) { term.reset(); TM.resets++; } };
  if (type === "replay") {
    if (TM.gone.delete(id)) redraw();
    if (d.hidden === "remote-control") { fresh(); put(`\x1b[2m${T("Output is not shown on a phone while Claude Code's Remote Control is on: its session link is printed in it. The state above stays live; take the session over in the Claude app.", "Claude Code 開著 Remote Control 時，手機上不顯示輸出（裡面有 session 連結）。上面的狀態照常更新；要操作請用 Claude app 接手。")}\x1b[0m\r\n`); return; }
    if (d.b64 !== undefined && Number.isFinite(d.end)) {
      const bytes = b64bytes(d.b64), start = d.end - bytes.length;
      if (f.end !== null && f.end >= start && f.end <= d.end) { if (f.end < d.end) put(bytes.subarray(f.end - start)); f.end = d.end; return; }
      fresh(); if (d.dropped) put(dropNote(d.dropped)); put(bytes); f.end = d.end; return;
    }
    // a phone's text (the link removed) has no positions: drawn again
    fresh(); if (d.dropped) put(dropNote(d.dropped)); if (d.b64 !== undefined) put(b64bytes(d.b64)); else if (d.text) put(d.text); return;
  }
  if (type === "out") {
    if (d.b64 === undefined) { if (d.text) put(d.text); return; }
    let bytes = b64bytes(d.b64);
    if (Number.isFinite(d.end) && f.end !== null) { const start = d.end - bytes.length; if (d.end <= f.end) return; if (start < f.end) bytes = bytes.subarray(f.end - start); }
    put(bytes); if (Number.isFinite(d.end)) f.end = d.end; return;
  }
  if (type === "exit" && !f.exited) { f.exited = true; put(`\r\n\x1b[2m${T(`[process ended: ${d.signal || `exit ${d.exitCode}`}]`, `[程序已結束：${d.signal || `exit ${d.exitCode}`}]`)}\x1b[0m\r\n`); load(); }
}
// a terminal the server would not show on this stream (too many views of it): the pane says so, and the stream is asked
// for again after a while, sooner with the pane's Retry; a terminal that is gone leaves with the next list
function retryMux() { clearTimeout(MUX.retryT); MUX.retryT = null; try { MUX.es?.close(); } catch {} MUX.es = null; MUX.key = ""; muxSync(); }
function onGone(d) {
  if (d.code === "gone") { load(); return; }
  TM.gone.set(d.id, d.code); redraw();
  if (!MUX.retryT) { MUX.retryT = setTimeout(retryMux, MUX.retryMs); MUX.retryMs = Math.min(30000, MUX.retryMs * 2); }
}
function muxSync() {
  if (!TM.list || TM.err) return; // a list that did not load says nothing about which terminals are gone
  const listed = new Set(TM.list.map((t) => t.id)), want = [...new Set(TM.lay.tabs.flatMap((tab) => panesOf(tab.root).map((p) => p.term)))].filter((id) => listed.has(id)).sort();
  for (const id of [...TM.panes.keys()]) if (!want.includes(id)) closePane(id);
  for (const id of [...FEED.keys()]) if (!want.includes(id)) { FEED.delete(id); TM.gone.delete(id); }
  const key = want.join(","); if (key === MUX.key && (MUX.es || !key)) return;
  try { MUX.es?.close(); } catch {} MUX.es = null; MUX.key = key; if (!key) return;
  const es = new EventSource(`/api/terminals/mux?ids=${encodeURIComponent(key)}`); MUX.es = es;
  for (const type of ["replay", "out", "exit"]) es.addEventListener(type, (m) => { const d = JSON.parse(m.data); onOut(d.id, type, d); });
  es.addEventListener("gone", (m) => onGone(JSON.parse(m.data)));
  es.addEventListener("replay", () => { if (!TM.gone.size) MUX.retryMs = 3000; });
  es.addEventListener("meta", (m) => { const v = JSON.parse(m.data); const i = (TM.list || []).findIndex((x) => x.id === v.id); if (i >= 0) { const before = TM.list[i]; TM.list[i] = v; if (before.state !== v.state || before.remote?.url !== v.remote?.url) redraw(); } });
}
TM.retryMux = retryMux;
TM.mux = MUX;
function flush(id, p) { const d = p.queue; p.queue = ""; if (!d) return; p.sending = p.sending.then(() => postJ(`/api/terminals/${id}/input`, { data: d }).catch((e) => toast(String(e.message || e)))); }
function closePane(id) { const p = TM.panes.get(id); if (!p) return; try { p.term?.dispose(); } catch {} TM.panes.delete(id); }

// ---------- actions ----------
async function start(body, place = {}) {
  if (TM.busy) return; TM.busy = true; redraw();
  try { if (window.Notification?.permission === "default") Notification.requestPermission().catch?.(() => {}); } catch {}
  const size = (() => { const p = [...TM.panes.values()].find((x) => x.term); return p ? { cols: p.term.cols, rows: p.term.rows } : { cols: 120, rows: 32 }; })();
  try { const j = await postJ("/api/terminals", { project: TM.project, ...size, ...body }), id = j.terminal.id; TM.showNew = false; await load();
    // beside the focused pane (a split), else in a tab of its own
    const tab = curTab(), pn = focusPane(tab);
    if (place.split && tab && pn) { const nw = leaf(id), sp = { t: "split", id: nid("s"), dir: place.split, a: pn, b: nw, ratio: 0.5 }, par = parentOf(tab.root, pn);
      if (!par) tab.root = sp; else if (par.a === pn) par.a = sp; else par.b = sp; tab.focus = nw.id; tab.zoom = null; saveLay(); }
    else openTab(id);
    redo(); }
  catch (e) { toast(String(e.message || e)); } finally { TM.busy = false; redraw(); }
}
async function termOp(id, op) {
  if (op === "review") { TM.refused.delete(id); redraw(); }
  try { const j = await postJ(`/api/terminals/${id}/${op}`, {}); if (op === "restart") { closePane(id); const w = where(id); if (w) { w.pn.term = j.terminal.id; saveLay(); } await load(); location.hash = `#/terminals/${encodeURIComponent(j.terminal.id)}`; return; }
    if (op === "review") { toast(T(`Sent for review as ${j.terminal.review.run}`, `已送審：${j.terminal.review.run}`)); await load(); location.hash = `#/run/${j.terminal.review.run}`; return; }
    if (op === "dismiss") { closePane(id); TM.list = (TM.list || []).filter((t) => t.id !== id); location.hash = "#/terminals"; } await load(); }
  catch (e) { const msg = String(e.message || e); toast(msg); if (op === "review") { TM.refused.set(id, msg); redraw(); } }
}

// ---------- tabs and panes (docs/units/web-terminal.md, "Tabs, panes and keys") ----------
// The page's layout: tabs, each a binary tree of splits whose leaves are panes, each pane one terminal (its own PTY). It is
// this viewer's own arrangement, kept in localStorage (a convenience: losing it loses no terminal). Closing a pane or a tab
// takes the terminal off the screen, never stops it: Stop does that. The keys follow the platform (public/term-keys.js).
const K = window.crewTermKeys;
const plat = () => K.platformOf(navigator);
// a Studio window: opened by `crew-studio launch` or the page's button (Chrome --app, ?window=studio, kept for this window),
// installed as an app, or fullscreen. There the browser keeps no chord for itself
const studioWindow = () => { try { if (sessionStorage.getItem("crew.studioWindow") === "1") return true; } catch {}
  return ["standalone", "window-controls-overlay", "fullscreen"].some((m) => matchMedia(`(display-mode: ${m})`).matches) || !!document.fullscreenElement; };
const inTab = () => !studioWindow();
const LAYOUT = "crew.term.layout";
TM.lay = (() => { try { const v = JSON.parse(localStorage.getItem(LAYOUT) || "null"); if (v && Array.isArray(v.tabs) && Number.isInteger(v.uid)) return v; } catch {} return { tabs: [], cur: 0, uid: 0 }; })();
TM.ui = { picker: null, help: false, naming: null, menu: false, remote: null };
const saveLay = () => { try { localStorage.setItem(LAYOUT, JSON.stringify(TM.lay)); } catch {} };
const nid = (p) => `${p}${++TM.lay.uid}`;
const leaf = (term) => ({ t: "pane", id: nid("p"), term });
const panesOf = (n, out = []) => { if (!n) return out; if (n.t === "pane") out.push(n); else { panesOf(n.a, out); panesOf(n.b, out); } return out; };
const parentOf = (n, child) => (!n || n.t !== "split" ? null : n.a === child || n.b === child ? n : parentOf(n.a, child) || parentOf(n.b, child));
const curTab = () => TM.lay.tabs[TM.lay.cur] || null;
const focusPane = (tab = curTab()) => (tab ? panesOf(tab.root).find((p) => p.id === tab.focus) || panesOf(tab.root)[0] || null : null);
const termOf = (pn) => (pn && (TM.list || []).find((t) => t.id === pn.term)) || null;
const where = (termId) => { for (const [i, tab] of TM.lay.tabs.entries()) { const pn = panesOf(tab.root).find((p) => p.term === termId); if (pn) return { i, tab, pn }; } return null; };
function openTab(termId) { const pn = leaf(termId); TM.lay.tabs.push({ id: nid("t"), name: null, root: pn, focus: pn.id, zoom: null }); TM.lay.cur = TM.lay.tabs.length - 1; saveLay(); }
function reveal(termId) { const w = where(termId); if (!w) return openTab(termId); TM.lay.cur = w.i; w.tab.focus = w.pn.id; if (w.tab.zoom && w.tab.zoom !== w.pn.id) w.tab.zoom = null; saveLay(); }
function closeTab(i) { TM.lay.tabs.splice(i, 1); TM.lay.cur = Math.max(0, Math.min(i < TM.lay.cur ? TM.lay.cur - 1 : TM.lay.cur, TM.lay.tabs.length - 1)); saveLay(); }
/** The pane leaves the screen (its terminal keeps running); the last pane of a tab closes the tab, as in iTerm2. */
function detachPane(tab, pn) {
  const par = parentOf(tab.root, pn);
  if (!par) return closeTab(TM.lay.tabs.indexOf(tab));
  const sib = par.a === pn ? par.b : par.a, g = parentOf(tab.root, par);
  if (!g) tab.root = sib; else if (g.a === par) g.a = sib; else g.b = sib;
  if (tab.focus === pn.id) tab.focus = panesOf(sib)[0].id; if (tab.zoom === pn.id) tab.zoom = null; saveLay();
}
/** A terminal no longer listed (removed, or gone with a restart) leaves its pane. */
function reconcile() { const known = new Set((TM.list || []).map((t) => t.id)); for (const tab of [...TM.lay.tabs]) for (const pn of panesOf(tab.root)) if (!known.has(pn.term)) detachPane(tab, pn); }
// the address names the focused terminal; replaced in place, so moving between panes does not add history or re-route
function syncHash() { const t = termOf(focusPane()), q = location.hash.split("?")[1], want = (t ? `#/terminals/${encodeURIComponent(t.id)}` : "#/terminals") + (q ? `?${q}` : "");
  if (location.hash !== want) { history.replaceState(null, "", want); if (S.route?.name === "terminals") S.route.arg = t?.id ?? null; } TM.lastArg = t?.id ?? null; }
// asked again on the next frame: a sheet opened in between (a double-click's rename) keeps its field's focus
const sheetOpen = () => TM.ui.picker || TM.ui.naming || TM.ui.help || TM.ui.remote || TM.ui.menu;
// the terminal never takes the focus from the list toolbar's search the captain is typing in (public/list-tools.js)
function focusTerm() { if (!TM.canWrite || sheetOpen() || document.activeElement?.matches?.("[data-lt-q], [data-lt-fq]")) return; const id = focusPane()?.term, go = () => { if (!sheetOpen()) TM.panes.get(id)?.term?.focus(); }; go(); requestAnimationFrame(go); }
const redo = () => { saveLay(); syncHash(); render(); focusTerm(); };
// a click in a pane moves the focus without rebuilding the page (xterm keeps its focus and selection)
function markFocus() { syncHash(); const tab = curTab(), t = termOf(focusPane(tab)), sec = document.querySelector("[data-term-detail]"); if (!tab || !t || !sec) return;
  sec.dataset.termDetail = t.id; document.querySelectorAll(".wt-pane").forEach((e) => e.classList.toggle("focus", e.dataset.pane === tab.focus)); patchPage(); }
// each move answers whether it did anything: one that has nothing to move to leaves the key to the shell (Alt+← is a word back)
function moveFocus(dir, swap = false) {
  const tab = curTab(); if (!tab || tab.zoom) return false;
  const els = [...document.querySelectorAll(".wt-stage .wt-pane")], me = els.find((e) => e.dataset.pane === tab.focus); if (!me) return false;
  const r = me.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let best = null, bd = Infinity;
  for (const e of els) { if (e === me) continue; const o = e.getBoundingClientRect();
    const fits = dir === "h" ? o.right <= r.left + 4 : dir === "l" ? o.left >= r.right - 4 : dir === "k" ? o.bottom <= r.top + 4 : o.top >= r.bottom - 4; if (!fits) continue;
    const overlap = dir === "h" || dir === "l" ? o.top < r.bottom && o.bottom > r.top : o.left < r.right && o.right > r.left;
    const d = Math.hypot(o.left + o.width / 2 - cx, o.top + o.height / 2 - cy) + (overlap ? 0 : 10000); if (d < bd) { bd = d; best = e; } }
  if (!best) return false;
  const all = panesOf(tab.root), a = all.find((p) => p.id === tab.focus), b = all.find((p) => p.id === best.dataset.pane);
  if (swap) [a.term, b.term] = [b.term, a.term]; // the terminal moves, and the focus goes with it
  tab.focus = b.id; return true;
}
function cyclePane(d) { const tab = curTab(); if (!tab || tab.zoom) return false; const ps = panesOf(tab.root); if (ps.length < 2) return false;
  const i = ps.findIndex((p) => p.id === tab.focus); tab.focus = ps[(i + d + ps.length) % ps.length].id; return true; }
function resizeSplit(dir) {
  const tab = curTab(); if (!tab || tab.zoom) return false; const want = dir === "h" || dir === "l" ? "row" : "col";
  let node = focusPane(tab), s = null; for (;;) { const p = parentOf(tab.root, node); if (!p) break; if (p.dir === want) { s = p; break; } node = p; }
  if (!s) return false; const r = Math.min(0.85, Math.max(0.15, s.ratio + (dir === "l" || dir === "j" ? 0.05 : -0.05)));
  if (r === s.ratio) return false; s.ratio = r; return true;
}
// a new tab or split runs a login shell in the focused terminal's project, as a terminal app opens one in its folder
const startShell = (split) => start({ project: termOf(focusPane())?.project?.id || TM.project, preset: "shell" }, split ? { split } : {});
/** What a key (or a toolbar button) asks; false: not on this page (copy mode, workspaces), or nothing to do (one pane, no
 * such tab), so the key goes to the terminal. */
function run(act, arg) {
  const tab = curTab(), pn = focusPane(tab), n = TM.lay.tabs.length, t = termOf(pn);
  switch (act) {
    // the ⋯ menu, drawn in place; its first item takes the focus, so the arrows and Enter are the menu's while it is open
    case "menu": TM.ui.menu = !TM.ui.menu; menuSync(TM.ui.menu ? 0 : null); if (!TM.ui.menu) focusTerm(); return true;
    case "launch": { if (!TM.canWrite) return false; TM.showNew = !(TM.showNew ?? !(TM.list || []).some((x) => x.running)); render();
      if (TM.showNew) document.getElementById("termCmd")?.focus(); else focusTerm(); return true; }
    case "kill": if (!TM.canWrite || !t?.running) return false; termOp(t.id, "kill"); return true;
    // a terminal from before Studio restarted has no command to run again here: start a new one
    case "restart": if (!TM.canWrite || !t || t.restored) return false; termOp(t.id, "restart"); return true;
    case "dismiss": if (!TM.canWrite || !t || t.running) return false; termOp(t.id, "dismiss"); return true;
    case "review": { const rv = TM.canWrite && t && !t.review && reviewState(t); if (!rv) return false; if (rv.why) toast(rv.why); else termOp(t.id, "review"); return true; }
    case "retry": if (!TM.gone.size) return false; retryMux(); return true;
    case "remote": if (!t?.remote?.url) return false; TM.ui.remote = t.id; break;
    case "appWindow": if (!TM.canWrite) return false; openStudioWindow(); return true;
    case "closeTab": if (!tab) return false; closeTab(TM.lay.cur); break;
    case "newTab": if (!TM.canWrite) return false; startShell(null); return true;
    case "splitRight": case "splitDown": if (!TM.canWrite || !pn) return false; startShell(act === "splitRight" ? "row" : "col"); return true;
    case "tabN": if (arg - 1 >= n) return false; TM.lay.cur = arg - 1; break;
    case "nextTab": case "prevTab": if (n < 2) return false; TM.lay.cur = (TM.lay.cur + (act === "nextTab" ? 1 : -1) + n) % n; break;
    case "renameTab": if (!tab) return true; TM.ui.naming = { tab: tab.id }; break;
    case "focus": if (!moveFocus(arg)) return false; break;
    case "swap": if (!moveFocus(arg, true)) return false; break;
    case "nextPane": if (!cyclePane(arg)) return false; break;
    case "resize": if (!resizeSplit(arg)) return false; break;
    case "zoom": if (!tab || (!tab.zoom && panesOf(tab.root).length < 2)) return false; tab.zoom = tab.zoom ? null : pn?.id ?? null; break;
    case "closePane": if (!tab || !pn) return false; detachPane(tab, pn); break;
    case "clear": { const x = TM.panes.get(pn?.term)?.term; if (!x) return false; x.clear(); return true; }
    case "goto": TM.ui.picker = { q: "", sel: 0 }; break;
    case "sidebar": setSide(!document.body.classList.contains("side-collapsed")); return true;
    case "help": TM.ui.help = !TM.ui.help; break;
    default: return false;
  }
  redo(); return true;
}
TM.run = run;
const pickRows = () => { const q = (TM.ui.picker?.q || "").toLowerCase();
  return (TM.list || []).filter((t) => !q || `${t.label} ${t.project.name} ${t.command}`.toLowerCase().includes(q)); };
const choose = (id) => { TM.ui.picker = null; reveal(id); redo(); };
// the keys: in the capture phase, ahead of xterm, so a chord that is Studio's never also reaches the shell; anything else
// (plain keys, Ctrl+C, an unmapped chord) is left alone and goes to the terminal or the field
addEventListener("keydown", (e) => {
  if (!onPage() || e.isComposing || !document.querySelector(".wt-full")) return;
  const ui = TM.ui, stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (ui.naming) { if (e.key === "Escape") { stop(); ui.naming = null; redo(); }
    else if (e.key === "Enter") { stop(); const tab = TM.lay.tabs.find((x) => x.id === ui.naming.tab), v = document.getElementById("termName")?.value.trim(); if (tab) tab.name = v || null; ui.naming = null; redo(); } return; }
  if (ui.picker) { const list = pickRows();
    if (e.key === "Escape") { stop(); ui.picker = null; redo(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { stop(); ui.picker.sel = Math.max(0, Math.min(list.length - 1, ui.picker.sel + (e.key === "ArrowDown" ? 1 : -1))); render(); }
    else if (e.key === "Enter") { stop(); const r = list[ui.picker.sel]; if (r) choose(r.id); else { ui.picker = null; redo(); } }
    return; }
  const hit = K.lookup(e, plat(), inTab());
  if (ui.help) { if (e.key === "Escape" || hit?.act === "help") { stop(); ui.help = false; redo(); } return; }
  if (ui.remote) { if (e.key === "Escape") { stop(); ui.remote = null; redo(); } return; }
  // the open menu has the focus: arrows move through its items, Enter is the focused item's own, ? is the key table, Esc
  // gives the keys back to the terminal; a chord closes it and does what it says
  if (ui.menu && !hit) {
    const xs = menuItemsOn(), i = xs.indexOf(document.activeElement);
    if (e.key === "Escape") { stop(); menuClose(true); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { stop(); xs[(i + (e.key === "ArrowDown" ? 1 : -1) + xs.length) % xs.length]?.focus(); }
    else if (e.key === "Home" || e.key === "End") { stop(); xs[e.key === "Home" ? 0 : xs.length - 1]?.focus(); }
    else if (e.key === "?") { stop(); menuClose(); run("help"); }
    return;
  }
  if (ui.menu && hit?.act !== "menu") menuClose();
  if (hit && run(hit.act, hit.arg)) stop();
}, true);
// A tab is its title and one dot: the state of what it shows (waiting first, then working, exited, done). Everything else a
// tab or a pane once carried as buttons (close, the pane's bar) is a key and an item of the ⋯ menu.
const RANK = ["waiting", "working", "exited", "done"];
const stateText = (t) => { const [, l] = STATE[t.state] || STATE.working; return l() + (t.state === "exited" ? (t.signal ? ` ${t.signal}` : t.exitCode != null ? ` ${t.exitCode}` : "") : ""); };
function tabEls() {
  return TM.lay.tabs.map((x, i) => { const ts = panesOf(x.root).map(termOf).filter(Boolean), ft = termOf(focusPane(x));
    const st = ts.map((t) => (t.running || t.state !== "waiting" ? t.state : "done")).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] || "working";
    const says = ts.map((t) => `${t.label} · ${t.project.name} · ${stateText(t)}${t.ask && t.state === "waiting" ? `: ${t.ask}` : ""}`).join("\n");
    return h("div", { class: "wt-tab", role: "tab", "data-term-tab": x.id, "aria-selected": String(i === TM.lay.cur), title: says,
      onclick: () => { TM.lay.cur = i; redo(); }, ondblclick: () => { TM.ui.naming = { tab: x.id }; redo(); } },
      h("i", { class: `wt-dot ${st}`, "data-term-state": st, role: "img", "aria-label": ts.map(stateText).join(", ") }), h("span", { class: "wt-tname" }, x.name || ft?.label || "…")); });
}
// a terminal Studio will not show on this stream right now: a quiet line over its pane (Retry is in the ⋯ menu, ⌥⌘G)
const goneNote = (t) => (TM.gone.has(t.id) ? h("div", { class: "wt-gone", role: "status", "data-term-gone": t.id }, T("Open in too many places: its output waits. Retrying…", "開著的地方太多，輸出暫停，正在重試…")) : null);
function drawNode(n, tab) {
  if (n.t === "pane") { const t = termOf(n); if (!t) return h("div", { class: "wt-pane" });
    return h("div", { class: `wt-pane${n.id === tab.focus ? " focus" : ""}`, "data-pane": n.id, "data-term-pane": t.id,
      onmousedown: () => { if (tab.focus !== n.id) { tab.focus = n.id; saveLay(); markFocus(); } },
      // a click on the pane around the terminal (its frame, its notice) gives the keys back to the terminal: left to the
      // browser the focus stayed on the page, and Tab then moved it to the next button instead of completing in the shell.
      // The first button only, and not after a drag that selected text
      onclick: (e) => { if (e.button !== 0 || e.target.closest?.(".xterm, button, a, input, select, textarea")) return;
        if (String(window.getSelection?.() ?? "")) return; focusTerm(); } }, goneNote(t), pane(t).host); }
  const wrap = h("div", { class: `wt-split ${n.dir}` });
  const a = h("div", { class: "wt-slot", style: `flex:${n.ratio} 1 0` }, drawNode(n.a, tab)), b = h("div", { class: "wt-slot", style: `flex:${1 - n.ratio} 1 0` }, drawNode(n.b, tab));
  const d = h("div", { class: "wt-div", role: "separator", "aria-orientation": n.dir === "row" ? "vertical" : "horizontal", "data-split": n.id });
  d.addEventListener("pointerdown", (ev) => { ev.preventDefault(); d.setPointerCapture(ev.pointerId); d.classList.add("drag"); const r = wrap.getBoundingClientRect();
    const move = (m) => { const v = n.dir === "row" ? (m.clientX - r.left) / r.width : (m.clientY - r.top) / r.height; n.ratio = Math.min(0.85, Math.max(0.15, v)); a.style.flex = `${n.ratio} 1 0`; b.style.flex = `${1 - n.ratio} 1 0`; };
    const up = () => { d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); d.classList.remove("drag"); saveLay(); };
    d.addEventListener("pointermove", move); d.addEventListener("pointerup", up); });
  wrap.append(a, d, b); return wrap;
}
async function openStudioWindow() {
  try { const j = await postJ("/api/terminals/app-window", {}); toast(T(`Opened Studio in its own window (${j.used}). You can close this tab.`, `已在獨立的 Studio 視窗開啟（${j.used}）。這個分頁可以關了。`)); }
  catch (e) { toast(String(e.message || e)); }
}
// ---------- the ⋯ menu: every action the page once had a button for, each with its key ----------
// What the focused terminal is (its command, folder, question, branch) is the menu's head, not a header over the terminal.
function menuInfo(t) {
  if (!t) return null;
  const rv = reviewState(t), url = t.remote?.url;
  return h("div", { class: "wt-minfo" },
    h("div", { class: "wt-mtitle" }, h("b", {}, t.label), h("span", { class: "faint" }, ` · ${t.project.name}`), badge(t)),
    h("div", { class: "faint wt-cmd", title: t.project.path }, h("code", {}, t.command), T(` in ${t.project.path}`, ` 於 ${t.project.path}`)),
    restoredNote(t),
    t.ask && t.state === "waiting" ? h("div", { class: "wt-ask", "data-term-ask": "1" }, T("Asks: ", "問你："), t.ask) : null,
    rv ? h("div", { class: "faint wt-review", "data-term-review": t.id }, rv.where, rv.why ? h("span", {}, rv.why) : null) : null,
    !url && TM.canWrite && t.remote?.enabled && t.running ? h("div", { class: "faint wt-remote-wait" }, T("Remote Control: waiting for Claude Code to print its link…", "Remote Control：等 Claude Code 印出連結…")) : null,
    TM.canWrite ? null : h("div", { class: "faint", "data-term-readonly": "1" }, T("View only: typing, starting and stopping happen on the Mac.", "只能檢視：輸入、啟動和停止要在 Mac 上做。")));
}
function menuItems(t, tab) {
  const w = TM.canWrite, p = plat(), inT = inTab(), rv = t && reviewState(t), showNew = TM.showNew ?? !(TM.list || []).some((x) => x.running);
  const it = (act, en, zh, more = {}) => ({ act, en, zh, ...more });
  return [
    [w && it("launch", "Launch…", "啟動…", { attrs: { "data-term-new": "1", role: "menuitemcheckbox", "aria-checked": String(!!showNew) } }),
      w && t?.running && it("kill", "Stop", "停止", { attrs: { "data-term-kill": t.id } }),
      w && t && !t.restored && it("restart", "Restart", "重新啟動", { attrs: { "data-term-restart": t.id } }),
      w && t && !t.running && it("dismiss", "Remove", "移除", { attrs: { "data-term-dismiss": t.id } }),
      w && rv && !t.review && it("review", "Send for review", "送審", { attrs: { "data-term-send": t.id }, disabled: !!rv.why }),
      t?.review && it("inReview", `In review: ${t.review.run}`, `審查中：${t.review.run}`, { href: `#/run/${encodeURIComponent(t.review.run)}`, attrs: { "data-term-review-run": t.review.run } }),
      t?.remote?.url && it("remote", "Remote Control link…", "Remote Control 連結…", { attrs: { "data-term-remote-open": t.id } }),
      TM.gone.size && it("retry", "Retry the output that waits", "重試暫停的輸出", { attrs: { "data-term-gone-retry": [...TM.gone.keys()].join(" ") } })],
    [w && it("newTab", "New tab", "新分頁"), w && it("splitRight", "Split right", "向右分割"), w && it("splitDown", "Split down", "向下分割"),
      tab && it("zoom", "Zoom", "放大", { attrs: { role: "menuitemcheckbox", "aria-checked": String(!!tab.zoom) }, disabled: !tab.zoom && panesOf(tab.root).length < 2 }),
      it("clear", "Clear the screen", "清畫面"), it("closePane", "Close pane", "關閉窗格"), it("closeTab", "Close tab", "關閉分頁"),
      it("renameTab", "Rename tab…", "分頁改名…"), it("goto", "Go to a terminal…", "跳到終端機…")],
    [w && inT && it("appWindow", "Open in a Studio window", "用 Studio 視窗開"), it("sidebar", "Show / hide the sidebar", "顯示 / 隱藏側欄"),
      it("help", "Keyboard shortcuts", "快捷鍵", { key: "?", attrs: { "data-term-keys": "1" } })],
  ].map((g) => g.filter(Boolean)).filter((g) => g.length).map((g) => g.map((x) => ({ ...x, chord: x.key ? `? · ${K.useNow(x.act, p, inT)}` : K.KEYMAP.some((r) => r[1] === x.act) ? K.useNow(x.act, p, inT) : "" })));
}
function menuEl(t, tab) {
  const open = !!TM.ui.menu;
  const btn = h("button", { type: "button", class: "btn ghost sm wt-mbtn", "data-term-menu": "1", "aria-haspopup": "menu", "aria-expanded": String(open),
    "aria-label": T("Terminal menu", "終端機選單"), title: `${T("Menu", "選單")} (${K.useNow("menu", plat(), inTab())})`, onclick: (e) => { e.stopPropagation(); run("menu"); } }, "⋯");
  if (!open) return h("div", { class: "wt-more" }, btn);
  const groups = menuItems(t, tab), kids = [menuInfo(t)];
  for (const g of groups) { kids.push(h("div", { class: "wt-msep", role: "separator" }));
    for (const x of g) { const label = [h("span", { class: "wt-ml" }, T(x.en, x.zh)), x.chord ? h("kbd", {}, x.chord) : null];
      kids.push(x.href ? h("a", { class: "fm-item", role: "menuitem", "data-term-mi": x.act, href: x.href, ...x.attrs, onclick: () => menuClose() }, label)
        : h("button", { type: "button", class: "fm-item", role: "menuitem", "data-term-mi": x.act, disabled: x.disabled || null, ...x.attrs, onclick: (e) => { e.stopPropagation(); menuClose(); run(x.act); } }, label)); } }
  return h("div", { class: "wt-more" }, btn, h("div", { class: "fm-pop wt-pop", role: "menu", "aria-label": T("Terminal menu", "終端機選單"), "data-term-menu-pop": "1" }, kids));
}
const menuItemsOn = () => [...document.querySelectorAll(".wt-pop [role^=menuitem]:not([disabled])")];
/** The menu is drawn in place (never a full render: the terminals keep their focus and selection). */
function menuSync(focusIdx) {
  const old = document.querySelector(".wt-bar .wt-more"); if (!old) return;
  const tab = curTab(), nw = menuEl(termOf(focusPane(tab)), tab); old.replaceWith(nw);
  if (TM.ui.menu && focusIdx != null) { const xs = menuItemsOn(); xs[Math.max(0, Math.min(focusIdx, xs.length - 1))]?.focus(); }
}
function menuClose(back = false) { if (!TM.ui.menu) return; TM.ui.menu = false; menuSync(); if (back) focusTerm(); }
addEventListener("pointerdown", (e) => { if (TM.ui.menu && !e.target.closest?.(".wt-more")) menuClose(); }, true);
function remoteSheet() {
  const t = (TM.list || []).find((x) => x.id === TM.ui.remote), url = t?.remote?.url; if (!url) { TM.ui.remote = null; return null; }
  return h("div", { class: "wt-veil", "data-term-remote-sheet": t.id, onclick: (e) => { if (e.target === e.currentTarget) { TM.ui.remote = null; redo(); } } },
    h("div", { class: "card wt-sheet", role: "dialog", "aria-label": "Remote Control" },
      h("div", { class: "wt-remote", "data-term-remote": "1" }, qrBox(url),
        h("div", {}, h("b", {}, T("Remote Control is on", "Remote Control 已開啟")), h("p", { class: "faint" }, T("Open this link in the Claude app or claude.ai to take the session over. Anyone with the link and your account can drive it.", "在 Claude app 或 claude.ai 開這個連結就能接手這個 session。有這個連結又登入你帳號的人都能操作它。")),
          h("a", { href: url, target: "_blank", rel: "noopener noreferrer", "data-term-remote-url": "1" }, url)))));
}
function helpSheet() {
  const p = TM.ui.helpPlat || plat(), tab = inTab(); let group = null; const kids = [];
  for (const [g, act, label, mac, win] of K.KEYMAP) {
    if (!["newWs", "copy"].includes(act)) { // not on this page: no workspaces, xterm selects and copies by itself
      if (g[0] !== group) { kids.push(h("h3", {}, T(...g))); group = g[0]; }
      const specs = p === "mac" ? mac : win;
      kids.push(h("div", { "data-help-act": act }, h("span", {}, T(...label)), h("span", {}, specs[0] ? h("kbd", { class: tab && specs[1] ? "off" : null }, K.show(specs[0], p)) : null, specs[1] ? [" ", h("kbd", { class: tab ? null : "off" }, K.show(specs[1], p))] : null)));
    }
  }
  return h("div", { class: "wt-veil", "data-term-help": p, onclick: (e) => { if (e.target === e.currentTarget) { TM.ui.help = false; redo(); } } },
    h("div", { class: "card wt-sheet", role: "dialog", "aria-label": T("Keys", "快捷鍵") },
      h("div", { class: "wt-sh" }, h("b", {}, T("Keys", "快捷鍵")), h("span", { class: "wt-seg" }, [["mac", "macOS"], ["win", "Windows / Linux"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(p === k), onclick: () => { TM.ui.helpPlat = k; render(); } }, l))), h("kbd", {}, "Esc")),
      h("div", { class: "wt-help" }, kids),
      h("p", { class: "faint wt-note" }, T("Mac follows iTerm2, Windows and Linux follow Windows Terminal, chosen by your computer. Where an action has two keys, a browser tab takes the first (new, close, next tab, new window) and the second works; in a Studio window or fullscreen the first works. The struck-out one is the one that does not work here. Closing a pane or a tab never stops its terminal: Stop does.",
        "Mac 照 iTerm2，Windows 和 Linux 照 Windows Terminal，依你的電腦自動切換。有兩個鍵的那幾項，第一個在瀏覽器分頁裡會被瀏覽器拿走（新分頁、關分頁、切分頁、新視窗），這時第二個生效；在 Studio 視窗或全螢幕裡第一個就能用。劃掉的是現在用不到的那個。關掉窗格或分頁不會停掉終端機，要停請按「停止」。"))));
}
function pickerSheet() {
  const list = pickRows(), sel = Math.min(TM.ui.picker.sel, Math.max(0, list.length - 1));
  setTimeout(() => { const q = document.getElementById("termPickQ"); if (q && document.activeElement !== q) q.focus(); }, 0);
  return h("div", { class: "wt-veil", "data-term-picker": "1", onclick: (e) => { if (e.target === e.currentTarget) { TM.ui.picker = null; redo(); } } },
    h("div", { class: "card wt-sheet", role: "dialog", "aria-label": T("Go to a terminal", "跳到終端機") },
      h("div", { class: "wt-sh" }, h("input", { id: "termPickQ", type: "text", autocomplete: "off", spellcheck: "false", value: TM.ui.picker.q, placeholder: T("Find a terminal: agent, project, command", "找終端機：agent、專案、指令"),
        oninput: (e) => { TM.ui.picker.q = e.target.value; TM.ui.picker.sel = 0; render(); } })),
      h("div", { class: "wt-pick" }, list.length ? list.map((t, i) => h("div", { class: `wt-prow${i === sel ? " sel" : ""}`, "data-pick": t.id, onclick: () => choose(t.id) },
        h("b", {}, t.label), h("span", { class: "faint" }, t.project.name), badge(t))) : h("p", { class: "faint" }, T("No terminal matches.", "沒有符合的終端機。")))));
}
function namingSheet() {
  const tab = TM.lay.tabs.find((x) => x.id === TM.ui.naming.tab); if (!tab) { TM.ui.naming = null; return null; }
  const input = h("input", { id: "termName", type: "text", autocomplete: "off", value: tab.name || termOf(focusPane(tab))?.label || "" });
  setTimeout(() => { if (document.activeElement !== input) { input.focus(); input.select(); } }, 0);
  return h("div", { class: "wt-veil", "data-term-naming": tab.id }, h("div", { class: "card wt-sheet", role: "dialog", "aria-label": T("Tab name", "分頁名稱") },
    h("div", { class: "wt-sh" }, h("span", { class: "faint" }, T("Tab name", "分頁名稱")), input), h("p", { class: "faint wt-note" }, T("Enter to keep, Esc to cancel", "Enter 確定 · Esc 取消"))));
}
function focusView(arg) {
  if (!TM.err) reconcile(); // a list that did not load says nothing about which terminals are gone: the saved tabs stay
  if (arg && !TM.list.some((t) => t.id === arg)) return null; // a link to a terminal that is gone says so
  if (arg !== TM.lastArg) { TM.lastArg = arg; if (arg && TM.list.some((t) => t.id === arg)) reveal(arg); }
  // a first visit (this browser has no tabs saved: another profile, a cleared one) opens a tab for every running terminal,
  // else the one the list would pick; once the captain closes every tab, the launcher stays
  if (!TM.lay.tabs.length && !TM.autoOpened && !arg) { const run = TM.list.filter((t) => t.running); if (run.length) run.forEach((t) => openTab(t.id)); else { const s = selected(null); if (s) reveal(s.id); } }
  TM.autoOpened = true;
  const tab = curTab(), t = termOf(focusPane(tab)); if (!tab || !t) return null;
  if (arg && arg !== t.id) queueMicrotask(syncHash); else if (!arg) queueMicrotask(syncHash);
  const showNew = TM.showNew ?? !TM.list.some((x) => x.running);
  // one slim strip: the tabs (a title and a state dot each) and the ⋯ menu; the rest of the window is the terminal
  return h("div", { class: "page wt-page wt-full", "data-term-focus": t.id },
    h("div", { class: "wt-bar" },
      h("div", { class: "wt-tabs", role: "tablist", "aria-label": T("Terminal tabs", "終端機分頁") }, tabEls()),
      menuEl(t, tab)),
    TM.err ? h("p", { class: "faint" }, TM.err) : null,
    TM.canWrite && showNew ? h("div", { class: "wt-launch" }, launcher(), terminalsList(t)) : null,
    h("section", { class: "wt-detail", "data-term-detail": t.id }, ...detailHead(t), h("div", { class: "wt-stage" }, drawNode(tab.zoom ? panesOf(tab.root).find((p) => p.id === tab.zoom) || tab.root : tab.root, tab))),
    TM.ui.help ? helpSheet() : null, TM.ui.picker ? pickerSheet() : null, TM.ui.naming ? namingSheet() : null, TM.ui.remote ? remoteSheet() : null);
}

// ---------- the page ----------
function qrBox(text) {
  if (typeof qrcode !== "function") return null;
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const box = h("div", { class: "wt-qr", "aria-label": T("QR code for this session's Remote Control link", "這個 session 的 Remote Control 連結 QR code") });
  box.innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: false }); return box;
}
const warnText = (proj) => T(`Not sandboxed: runs with your user's full permissions in ${proj.path}`, `不在沙箱內：以你的使用者完整權限在 ${proj.path} 執行`);
function launcher() {
  if (!TM.canWrite) return h("div", { class: "card x-pad wt-ro", "data-term-readonly": "1" }, h("b", {}, T("View only", "只能檢視")),
    h("p", { class: "faint" }, T("On a phone you can watch terminals and their state. Typing, starting and stopping happen on the Mac.", "手機上可以看終端機與狀態；輸入、啟動和停止要在 Mac 上做。")));
  const proj = TM.projects.find((p) => p.id === TM.project);
  const hasClaude = TM.presets.some((p) => p.remoteControl);
  const sel = h("select", { id: "termProject", "aria-label": T("Project", "專案"), onchange: (e) => { TM.project = e.target.value; store.set("crew.term.project", TM.project);
      // the warning follows the project in place: a re-render now would replace a command field the captain is typing in
      const w = document.querySelector("[data-term-warning]"), pj = TM.projects.find((x) => x.id === TM.project); if (w && pj) w.textContent = warnText(pj); } },
    TM.projects.map((p) => h("option", { value: p.id, selected: p.id === TM.project }, p.name)));
  const cmd = h("input", { id: "termCmd", type: "text", placeholder: T("Custom command, e.g. npm run dev", "自訂指令，例如 npm run dev"), value: TM.cmd, autocomplete: "off", spellcheck: "false",
    oninput: (e) => { TM.cmd = e.target.value; }, onkeydown: (e) => { if (e.key === "Enter" && TM.cmd.trim()) { e.preventDefault(); start({ command: TM.cmd }); } } });
  return h("div", { class: "card x-pad wt-new" },
    h("div", { class: "wt-row" }, h("label", { for: "termProject" }, T("Project", "專案")), TM.projects.length ? sel : h("span", { class: "faint" }, T("Register a project first (Projects).", "請先註冊專案（專案頁）。"))),
    proj ? h("p", { class: "wt-warn", "data-term-warning": "1" }, warnText(proj)) : null,
    h("div", { class: "wt-presets" }, TM.presets.map((p) => h("button", { type: "button", class: "btn", "data-preset": p.id, disabled: TM.busy || !proj, title: p.path, onclick: () => start({ preset: p.id, ...(p.remoteControl ? { remoteControl: TM.rc } : {}) }) }, p.label))),
    hasClaude ? h("label", { class: "wt-rc" }, h("input", { type: "checkbox", id: "termRc", checked: TM.rc, onchange: (e) => { TM.rc = e.target.checked; store.set("crew.term.rc", TM.rc ? "1" : "0"); } }),
      T(" Claude Code: turn on Remote Control (take the session over from the Claude app)", " Claude Code：開啟 Remote Control（可從 Claude app 接手這個 session）")) : null,
    h("div", { class: "wt-row" }, cmd, h("button", { type: "button", class: "btn primary", "data-term-run": "1", disabled: TM.busy || !proj, onclick: () => TM.cmd.trim() && start({ command: TM.cmd }) }, T("Run", "執行"))));
}
// while the captain types in a terminal the page is not rebuilt (that would take the focus away): the list and the
// terminal's header are patched in place, the terminal itself stays where it is
function patchPage() {
  // the launcher (busy, presets), unless the captain is in it, and the list beside it
  const nw = document.querySelector(".wt-new"); if (nw && !nw.contains(document.activeElement)) nw.replaceWith(launcher());
  const tab = curTab(), t = termOf(focusPane(tab));
  // the list under its toolbar takes the new rows in place (public/list-tools.js): its search box is never replaced
  TM.listSel = t || selected(cur()); document.querySelector('#view [data-lt="terminals"]')?.ltItems?.(TM.list);
  const sec = document.querySelector("[data-term-detail]"), stage = sec?.querySelector(":scope > .wt-stage");
  // a pane whose terminal went (a shell that exited leaves the list) or left the tabs (a restart ended it): drawn again
  // now, unless the captain is typing in a field (another terminal, the go-to picker, a tab's name, the command field:
  // the app's own deferral, soft(), waits for its blur); the gone terminal's own input is no field to keep
  const inTabs = new Set(TM.lay.tabs.flatMap((x) => panesOf(x.root).map((pn) => pn.term)));
  if (sec && (!tab || panesOf(tab.root).some((pn) => !termOf(pn)) || [...sec.querySelectorAll(".wt-pane[data-term-pane]")].some((e) => !inTabs.has(e.dataset.termPane)))) {
    const a = document.activeElement, own = a && [...TM.panes.entries()].some(([id, pn]) => pn.host.contains(a) && (!inTabs.has(id) || !TM.list.some((x) => x.id === id)));
    const editing = a && !own && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    if (!editing) { redo(); return; }
    // soft() waits for an input, a textarea or a select; a contenteditable (none on this page today) waits here
    if (a.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { a.addEventListener("blur", () => redraw(), { once: true }); return; }
    return soft();
  }
  // a focus the page does not show: the page is drawn again
  if (!sec || !stage || !t || sec.dataset.termDetail !== t.id || panesOf(tab.root).some((pn) => !termOf(pn))) return soft();
  const tabs = document.querySelector(".wt-tabs"); if (tabs) tabs.replaceChildren(...tabEls());
  for (const k of [...sec.children]) if (k !== stage) k.remove();
  for (const k of detailHead(t)) if (k) sec.insertBefore(k, stage);
  // a pane's notice is replaced only when it says something new
  for (const el of stage.querySelectorAll(".wt-pane[data-pane]")) { const tt = termOf(panesOf(tab.root).find((x) => x.id === el.dataset.pane)); if (!tt) continue;
    const was = el.querySelector(":scope > .wt-gone"), nb = goneNote(tt); if (was && nb) { if (!was.isEqualNode(nb)) was.replaceWith(nb); } else if (was) was.remove(); else if (nb) el.prepend(nb); }
  // the ⋯ menu follows the focused terminal (Stop becomes Remove, Send for review becomes ready), keeping the item in focus
  const xs = menuItemsOn(), at = xs.indexOf(document.activeElement); menuSync(TM.ui.menu && at >= 0 ? at : null);
}
// Send for review (docs/units/branch-intake.md): a finished terminal whose checkout is a branch with commits beyond base
// goes to code-firstmate's "From existing branch": spec card, scope, checks at base and head, review, fixes, merge card.
// Where its checkout is and why it cannot go yet are the ⋯ menu's (its head and its item); null: nothing to send.
function reviewState(t) {
  const g = t.git?.end || t.git?.start; if (!g && !t.review) return null;
  const where = g ? h("span", {}, g.branch ? `${g.branch} · ` : "", g.commits != null ? T(`${g.commits} commit(s) beyond ${g.base}`, `比 ${g.base} 多 ${g.commits} 個 commit`) : String(g.head ?? "").slice(0, 10)) : null;
  const why = t.review || !TM.canWrite ? null : t.running ? T("Send for review once the agent has finished", "agent 做完後才能送審")
    : !t.git?.end && t.stopped ? T("Studio stopped this terminal and did not record where its checkout ended: start a new terminal", "Studio 停掉這個終端機時沒記下 checkout 停在哪：請開新的終端機")
    : !t.git?.end?.commits ? T("No commits beyond the base to review: commit the work on a branch", "沒有比 base 新的 commit 可送審：先在 branch 上 commit") : null;
  return { where, why };
}
// a refusal stays over the terminal, in the captain's language, until the next try (a toast alone passed unseen on the
// live board): the one line the page adds above a terminal, and only then
function refusedLine(t) {
  const refused = TM.refused.get(t.id); if (!refused) return null; const [en, zh] = refused.split(" / ");
  return h("p", { class: "wt-refused", role: "alert", "data-term-review-error": t.id }, T("Send for review was refused: ", "送審被拒："), T(en, zh || en));
}
// a terminal listed from its record after Studio restarted: nothing re-attached; Studio stopped it, or it had ended before
const restoredNote = (t) => !t.restored ? null : h("p", { class: "faint wt-restored", "data-term-restored": t.stopped || "ended" },
  t.stopped === "studio-stopped" ? T("From before Studio restarted: Studio stopped it while it ran. Its output is the transcript.", "Studio 重新啟動前的終端機：它還在跑時被 Studio 停掉了。輸出是它的紀錄。")
    : T("From before Studio restarted: it had ended. Its output is the transcript.", "Studio 重新啟動前的終端機：它已經結束了。輸出是它的紀錄。"));
// over the terminal only what needs the captain now: a refused Send for review. Its name, command, state, question,
// branch and Remote Control link are the ⋯ menu's; Stop, Restart and Remove are its items and keys
const detailHead = (t) => [refusedLine(t)];
const selected = (arg) => TM.list.find((t) => t.id === arg) || (arg ? null : TM.list.filter((t) => t.running).at(-1) || TM.list.at(-1) || null);
const listRows = (sel, list = TM.list, mark = (x) => x) => list.map((t) => h("a", { class: "wt-item", href: `#/terminals/${encodeURIComponent(t.id)}`, "data-term-row": t.id, "aria-current": sel?.id === t.id ? "page" : null },
  h("span", { class: "wt-iname" }, mark(t.label)), badge(t), h("span", { class: "faint wt-iproj" }, t.project.name),
  t.restored ? h("span", { class: "faint", "data-term-row-restored": t.id }, T(t.stopped ? "· stopped by Studio's restart" : "· before the restart", t.stopped ? "・Studio 重啟時停掉" : "・重啟前")) : null, t.ask && t.state === "waiting" ? h("span", { class: "wt-iask" }, t.ask) : null));
/** the page's list of terminals under the list toolbar (public/list-tools.js); the jump menu keeps its own search */
const TERM_STATE = { working: ["Working", "執行中"], waiting: ["Waiting for you", "等你"], done: ["Done", "完成"], exited: ["Exited", "已結束"] };
function terminalsList(sel) {
  TM.listSel = sel;
  return window.crewListTools.list({ id: "terminals", route: "terminals", title: T("terminals", "終端機"), noun: ["terminal", "終端機"], items: TM.list,
    placeholder: T("Search names, projects, commands…  or type state:waiting", "搜尋名稱、專案、指令…  也可以打 state:等你"),
    text: (t) => [t.label, t.id, t.project?.name, t.command, t.ask],
    facets: [{ key: "state", name: T("State", "狀態"), value: (t) => t.state || "working", show: (k) => T(...(TERM_STATE[k] || [k, k])) },
      { key: "project", name: T("Project", "專案"), value: (t) => t.project?.name }],
    sorts: [{ key: "new", label: T("Recently used", "最近用過"), cmp: (a, b) => Number(!!b.running) - Number(!!a.running) || String(b.endedAt || b.startedAt || "").localeCompare(String(a.endedAt || a.startedAt || "")) || TM.list.indexOf(b) - TM.list.indexOf(a) },
      { key: "title", label: T("Name", "名稱"), cmp: (a, b) => String(a.label).localeCompare(String(b.label), lang) }],
    none: () => h("div", { class: "wt-list", role: "list" }, h("p", { class: "faint" }, T("No terminals yet.", "還沒有終端機。"))),
    rows: (page, ctx) => h("div", { class: "wt-list", role: "list" }, listRows(TM.listSel, page, ctx.mark)) });
}
function viewTerminals(arg) {
  if (TM.list === null) { load(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:240px" })); }
  // a terminal no longer listed loses its stream
  queueMicrotask(muxSync);
  // a terminal shown: the terminal takes the window (body[data-focus="terminal"], app.js pageFocus), in tabs and panes
  const full = focusView(arg); if (full) return full;
  const sel = arg ? selected(arg) : null;
  return h("div", { class: "page wt-page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Terminals", "終端機")))),
    TM.err ? h("p", { class: "faint" }, TM.err) : null,
    h("div", { class: "wt-grid" },
      h("aside", { class: "wt-side" }, launcher(), terminalsList(sel)),
      h("section", { class: "wt-detail wt-empty" }, h("p", { class: "faint" }, arg && !sel ? T("This terminal is gone (Studio restarted, or it was removed).", "這個終端機已不在（Studio 重新啟動過，或已移除）。") : T("Start an agent on the left.", "從左邊啟動一個 agent。")))));
}
routes.terminals = viewTerminals;
viewTerminals.focus = "terminal"; // app.js pageFocus: the rail, no chat panel, the terminal takes the window
load();
})();
