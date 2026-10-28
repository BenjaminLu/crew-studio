// Web terminals (docs/units/web-terminal.md): #/terminals[/<id>], a "Terminals" tab in the Firstmate panel, and a
// "waiting for you" count on the sidebar's Firstmate item. Any agent CLI (or a command) runs in a real PTY in a project's
// folder, NOT sandboxed: with this user's full permissions, as in the captain's own Terminal. xterm.js
// (public/vendor, pinned, loaded on first use) draws it. The Mac's page types, resizes, starts and stops; a phone only
// watches: its terminal has no input element and the page offers no control. Output arrives over one SSE stream per
// open terminal (GET /api/terminals/<id>/stream: a replay, then live); the list's changes come on the page's own stream
// ("terminals"). Loaded before backbone.js.
(() => {
const XV = "5.5.0", FITV = "0.10.0";
const TM = { refused: new Map(), list: null, presets: [], projects: [], canWrite: false, err: null, panes: new Map(), prev: new Map(), busy: false, cmd: "", args: "",
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

// ---------- data ----------
async function load() {
  try { const j = await getJ("/api/terminals"); TM.err = null; TM.canWrite = !!j.canWrite; TM.presets = j.presets || []; TM.projects = j.projects || []; apply(j.terminals || []); }
  catch (e) { TM.err = String(e.message || e); if (TM.list === null) TM.list = []; }
  if (!TM.project || !TM.projects.some((p) => p.id === TM.project)) TM.project = TM.projects[0]?.id || "";
  redraw();
}
function apply(list) {
  // "waiting for you": a toast here, a system notification when the page is in the background (the captain allowed it)
  for (const t of list) {
    const was = TM.prev.get(t.id);
    if (was && was !== "waiting" && t.state === "waiting" && t.running && !(onPage() && cur() === t.id && !document.hidden)) {
      const msg = T(`${t.label} in ${t.project.name} is waiting for you${t.ask ? `: ${t.ask}` : ""}`, `${t.project.name} 的 ${t.label} 在等你${t.ask ? `：${t.ask}` : ""}`);
      toast(msg);
      try { if (document.hidden && window.Notification?.permission === "granted") new Notification("Crew Studio", { body: msg, tag: `term-${t.id}` }); } catch {}
    }
    TM.prev.set(t.id, t.state);
  }
  TM.list = list;
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
  const item = document.querySelector('.nav-item[data-view="firstmate"]'); if (!item) return;
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
  xtermP = Promise.all([add("link", { rel: "stylesheet", href: `/vendor/xterm-${XV}.css` }), add("script", { src: `/vendor/xterm-${XV}.min.js` }).then(() => add("script", { src: `/vendor/xterm-addon-fit-${FITV}.min.js` }))]).catch((e) => { xtermP = null; throw e; });
  return xtermP;
}
const css = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
const b64bytes = (s) => { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
function pane(t) {
  let p = TM.panes.get(t.id); if (p) return p;
  p = { host: h("div", { class: "wt-xterm", "data-term-host": t.id }), term: null, fit: null, es: null, queue: "", sending: Promise.resolve(), flushT: null, sizeT: null, err: null };
  TM.panes.set(t.id, p);
  xterm().then(() => {
    const term = new window.Terminal({ cursorBlink: TM.canWrite, disableStdin: !TM.canWrite, scrollback: 5000, fontSize: 13, allowProposedApi: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", theme: { background: css("--surface-2", "#111"), foreground: css("--text", "#ddd"), cursor: css("--accent", "#69f") } });
    const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(p.host); p.term = term; p.fit = fit;
    // a phone watches: no input element at all, so a tap never opens a keyboard
    if (!TM.canWrite) p.host.querySelectorAll("textarea, input").forEach((e) => e.remove());
    else {
      term.onData((d) => { p.queue += d; clearTimeout(p.flushT); p.flushT = setTimeout(() => flush(t.id, p), 8); });
      term.onResize(({ cols, rows }) => { clearTimeout(p.sizeT); p.sizeT = setTimeout(() => postJ(`/api/terminals/${t.id}/resize`, { cols, rows }).catch(() => {}), 120); });
    }
    try { new ResizeObserver(() => { try { if (p.host.isConnected && p.host.clientWidth) fit.fit(); } catch {} }).observe(p.host); } catch {}
    try { fit.fit(); } catch {}
    const es = new EventSource(`/api/terminals/${encodeURIComponent(t.id)}/stream`); p.es = es;
    const write = (d) => { if (d.b64 !== undefined) term.write(b64bytes(d.b64)); else if (d.text) term.write(d.text); };
    es.addEventListener("replay", (m) => { const d = JSON.parse(m.data); term.reset(); if (d.hidden === "remote-control") { term.write(`\x1b[2m${T("Output is not shown on a phone while Claude Code's Remote Control is on: its session link is printed in it. The state above stays live; take the session over in the Claude app.", "Claude Code 開著 Remote Control 時，手機上不顯示輸出（裡面有 session 連結）。上面的狀態照常更新；要操作請用 Claude app 接手。")}\x1b[0m\r\n`); return; }
      if (d.dropped) term.write(`\x1b[2m${T(`[earlier output dropped: ${d.dropped} bytes]`, `[較早的輸出已捨棄：${d.dropped} bytes]`)}\x1b[0m\r\n`); write(d); });
    es.addEventListener("out", (m) => write(JSON.parse(m.data)));
    es.addEventListener("meta", (m) => { const v = JSON.parse(m.data); const i = (TM.list || []).findIndex((x) => x.id === v.id); if (i >= 0) { const before = TM.list[i]; TM.list[i] = v; if (before.state !== v.state || before.remote?.url !== v.remote?.url) redraw(); } });
    es.addEventListener("exit", (m) => { const d = JSON.parse(m.data); term.write(`\r\n\x1b[2m${T(`[process ended: ${d.signal || `exit ${d.exitCode}`}]`, `[程序已結束：${d.signal || `exit ${d.exitCode}`}]`)}\x1b[0m\r\n`); es.close(); load(); });
    if (TM.canWrite && cur() === t.id) term.focus();
  }).catch((e) => { p.err = String(e.message || e); p.host.replaceChildren(h("p", { class: "faint" }, T(`The terminal view could not load: ${p.err}`, `終端機畫面無法載入：${p.err}`))); });
  return p;
}
function flush(id, p) { const d = p.queue; p.queue = ""; if (!d) return; p.sending = p.sending.then(() => postJ(`/api/terminals/${id}/input`, { data: d }).catch((e) => toast(String(e.message || e)))); }
function closePane(id) { const p = TM.panes.get(id); if (!p) return; try { p.es?.close(); } catch {} try { p.term?.dispose(); } catch {} TM.panes.delete(id); }

// ---------- actions ----------
async function start(body) {
  if (TM.busy) return; TM.busy = true; redraw();
  try { if (window.Notification?.permission === "default") Notification.requestPermission().catch?.(() => {}); } catch {}
  const size = (() => { const p = [...TM.panes.values()].find((x) => x.term); return p ? { cols: p.term.cols, rows: p.term.rows } : { cols: 120, rows: 32 }; })();
  try { const j = await postJ("/api/terminals", { project: TM.project, ...size, ...body }); await load(); location.hash = `#/terminals/${encodeURIComponent(j.terminal.id)}`; }
  catch (e) { toast(String(e.message || e)); } finally { TM.busy = false; redraw(); }
}
async function termOp(id, op) {
  if (op === "review") { TM.refused.delete(id); redraw(); }
  try { const j = await postJ(`/api/terminals/${id}/${op}`, {}); if (op === "restart") { closePane(id); await load(); location.hash = `#/terminals/${encodeURIComponent(j.terminal.id)}`; return; }
    if (op === "review") { toast(T(`Sent for review as ${j.terminal.review.run}`, `已送審：${j.terminal.review.run}`)); await load(); location.hash = `#/run/${j.terminal.review.run}`; return; }
    if (op === "dismiss") { closePane(id); TM.list = (TM.list || []).filter((t) => t.id !== id); location.hash = "#/terminals"; } await load(); }
  catch (e) { const msg = String(e.message || e); toast(msg); if (op === "review") { TM.refused.set(id, msg); redraw(); } }
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
  const list = document.querySelector(".wt-list"); if (list) list.replaceChildren(...listRows(selected(cur())));
  // the launcher too (busy, presets), unless the captain is in it
  const nw = document.querySelector(".wt-new"); if (nw && !nw.contains(document.activeElement)) nw.replaceWith(launcher());
  const sec = document.querySelector("[data-term-detail]"), t = sec && (TM.list || []).find((x) => x.id === sec.dataset.termDetail), p = t && TM.panes.get(t.id);
  if (!sec || !t || !p || p.host.parentElement !== sec) return soft();
  for (const k of [...sec.children]) if (k !== p.host) k.remove();
  for (const k of detailHead(t)) if (k) sec.insertBefore(k, p.host);
}
// Send for review (docs/units/branch-intake.md): a finished terminal whose checkout is a branch with commits beyond base
// goes to code-firstmate's "From existing branch": spec card, scope, checks at base and head, review, fixes, merge card
function reviewRow(t) {
  const g = t.git?.end || t.git?.start; if (!g && !t.review) return null;
  const where = g ? h("span", { class: "faint" }, g.branch ? `${g.branch} · ` : "", g.commits != null ? T(`${g.commits} commit(s) beyond ${g.base}`, `比 ${g.base} 多 ${g.commits} 個 commit`) : g.head.slice(0, 10)) : null;
  if (t.review) return h("div", { class: "wt-review", "data-term-review": t.id }, where, h("a", { class: "btn sm", "data-term-review-run": t.review.run, href: `#/run/${encodeURIComponent(t.review.run)}` }, T(`In review: ${t.review.run}`, `審查中：${t.review.run}`)));
  if (!TM.canWrite) return where ? h("div", { class: "wt-review" }, where) : null;
  const why = t.running ? T("Send for review once the agent has finished", "agent 做完後才能送審")
    : !t.git?.end && t.stopped ? T("Studio stopped this terminal and did not record where its checkout ended: start a new terminal", "Studio 停掉這個終端機時沒記下 checkout 停在哪：請開新的終端機")
    : !t.git?.end?.commits ? T("No commits beyond the base to review: commit the work on a branch", "沒有比 base 新的 commit 可送審：先在 branch 上 commit") : null;
  // a refusal stays here, in the captain's language, until the next try (a toast alone passed unseen on the live board)
  const refused = TM.refused.get(t.id), [en, zh] = refused ? refused.split(" / ") : [];
  return h("div", { class: "wt-review", "data-term-review": t.id }, where, why ? h("span", { class: "faint" }, why) : null,
    h("button", { type: "button", class: "btn primary sm", "data-term-send": t.id, disabled: !!why, onclick: () => termOp(t.id, "review") }, T("Send for review", "送審")),
    refused ? h("p", { class: "wt-refused", role: "alert", "data-term-review-error": t.id }, T("Send for review was refused: ", "送審被拒："), T(en, zh || en)) : null);
}
// a terminal listed from its record after Studio restarted: nothing re-attached; Studio stopped it, or it had ended before
const restoredNote = (t) => !t.restored ? null : h("p", { class: "faint wt-restored", "data-term-restored": t.stopped || "ended" },
  t.stopped === "studio-stopped" ? T("From before Studio restarted: Studio stopped it while it ran. Its output is the transcript.", "Studio 重新啟動前的終端機：它還在跑時被 Studio 停掉了。輸出是它的紀錄。")
    : T("From before Studio restarted: it had ended. Its output is the transcript.", "Studio 重新啟動前的終端機：它已經結束了。輸出是它的紀錄。"));
function detail(t) {
  const p = pane(t);
  return h("section", { class: "wt-detail", "data-term-detail": t.id }, ...detailHead(t), p.host);
}
function detailHead(t) {
  const url = t.remote?.url;
  return [
    h("div", { class: "wt-dhead" },
      h("div", { class: "wt-title" }, h("b", {}, t.label), h("span", { class: "faint" }, ` · ${t.project.name}`), badge(t),
        h("div", { class: "faint wt-cmd", title: t.project.path }, h("code", {}, t.command), T(` in ${t.project.path}`, ` 於 ${t.project.path}`))),
      TM.canWrite ? h("div", { class: "wt-actions" },
        t.running ? h("button", { type: "button", class: "btn", "data-term-kill": t.id, onclick: () => termOp(t.id, "kill") }, T("Stop", "停止")) : null,
        // a terminal from before Studio restarted has no command to run again here: start a new one
        t.restored ? null : h("button", { type: "button", class: "btn", "data-term-restart": t.id, onclick: () => termOp(t.id, "restart") }, T("Restart", "重新啟動")),
        t.running ? null : h("button", { type: "button", class: "btn ghost", "data-term-dismiss": t.id, onclick: () => termOp(t.id, "dismiss") }, T("Remove", "移除"))) : null),
    restoredNote(t),
    reviewRow(t),
    t.ask && t.state === "waiting" ? h("div", { class: "wt-ask", "data-term-ask": "1" }, T("Asks: ", "問你："), t.ask) : null,
    url ? h("div", { class: "wt-remote", "data-term-remote": "1" }, qrBox(url),
      h("div", {}, h("b", {}, T("Remote Control is on", "Remote Control 已開啟")), h("p", { class: "faint" }, T("Open this link in the Claude app or claude.ai to take the session over. Anyone with the link and your account can drive it.", "在 Claude app 或 claude.ai 開這個連結就能接手這個 session。有這個連結又登入你帳號的人都能操作它。")),
        h("a", { href: url, target: "_blank", rel: "noopener noreferrer", "data-term-remote-url": "1" }, url))) :
      TM.canWrite && t.remote?.enabled && t.running ? h("div", { class: "faint wt-remote-wait" }, T("Remote Control: waiting for Claude Code to print its link…", "Remote Control：等 Claude Code 印出連結…")) : null];
}
const selected = (arg) => TM.list.find((t) => t.id === arg) || (arg ? null : TM.list.filter((t) => t.running).at(-1) || TM.list.at(-1) || null);
const listRows = (sel) => TM.list.map((t) => h("a", { class: "wt-item", href: `#/terminals/${encodeURIComponent(t.id)}`, "data-term-row": t.id, "aria-current": sel?.id === t.id ? "page" : null },
  h("span", { class: "wt-iname" }, t.label), badge(t), h("span", { class: "faint wt-iproj" }, t.project.name),
  t.restored ? h("span", { class: "faint", "data-term-row-restored": t.id }, T(t.stopped ? "· stopped by Studio's restart" : "· before the restart", t.stopped ? "・Studio 重啟時停掉" : "・重啟前")) : null, t.ask && t.state === "waiting" ? h("span", { class: "wt-iask" }, t.ask) : null));
function viewTerminals(arg) {
  if (TM.list === null) { load(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:240px" })); }
  // a terminal no longer listed loses its stream
  for (const id of [...TM.panes.keys()]) if (!TM.list.some((t) => t.id === id)) closePane(id);
  const sel = selected(arg), rows = listRows(sel);
  return h("div", { class: "page wt-page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Terminals", "終端機")),
      h("p", {}, T("Any agent CLI in a real terminal, in your project's folder. Working, waiting for you, done or exited, at a glance.", "在專案資料夾裡，用真的終端機跑任何 agent CLI；執行中、等你、完成或結束，一眼看見。")))),
    TM.err ? h("p", { class: "faint" }, TM.err) : null,
    h("div", { class: "wt-grid" },
      h("aside", { class: "wt-side" }, launcher(), h("div", { class: "wt-list", role: "list" }, rows.length ? rows : h("p", { class: "faint" }, T("No terminals yet.", "還沒有終端機。")))),
      sel ? detail(sel) : h("section", { class: "wt-detail wt-empty" }, h("p", { class: "faint" }, arg ? T("This terminal is gone (Studio restarted, or it was removed).", "這個終端機已不在（Studio 重新啟動過，或已移除）。") : T("Start an agent on the left.", "從左邊啟動一個 agent。")))));
}
routes.terminals = viewTerminals;
load();
})();
