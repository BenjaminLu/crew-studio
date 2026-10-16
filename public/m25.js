// M2.5: the chat can drive the firstmate MAIN session, and phones reach Studio
// over Tailscale. Loaded after m2.js. Two chat modes: "Status" (the read-only
// M2 agent) and "firstmate" (the attached main session). The firstmate mode
// shows who is driving, the input queue, tool permission requests and the
// session's replies. The Phone page pairs phones and shows Tailscale.
const MS = { view: null, live: "", liveTools: [], sessions: null, sesHost: "claude", sesErr: null, me: { kind: "desktop", allowDrive: false } };
let chatMode = "main"; // One primary conversation; read-only context lives in Activity.
const isMain = () => chatMode === "main";

// ---------- data ----------
const getJ = (u) => fetch(u).then((r) => r.json());
const postJ = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
async function loadMain() { try { MS.view = await getJ("/api/main"); } catch {} if (isMain()) renderChat(false); showChatInfo(); approvalsBar(); if(S.route?.name==="board")soft(); }
getJ("/api/remote/me").then((m) => { MS.me = m; if (isMain()) renderChat(false); }).catch(() => {});
(function stream() { // on the page's one event stream (app.js)
  const es = { addEventListener: (t, f) => window.liveListen(t, f) };
  es.addEventListener("main", (m) => {
    const v = JSON.parse(m.data);
    const finished = MS.view && v.log.length !== MS.view.log.length;
    MS.view = v; if (finished && !v.busy) { MS.live = ""; MS.liveTools = []; }
    if (!v.busy && v.log.at(-1)?.kind === "firstmate") { MS.live = ""; MS.liveTools = []; }
    if (isMain()) renderChat(false); showChatInfo(); approvalsBar(); if(S.route?.name==="board")soft(); else if (S.route?.name === "remote") render();
  });
  es.addEventListener("mainEvent", (m) => {
    const e = JSON.parse(m.data);
    if (e.type === "delta") MS.live += e.text;
    else if (e.type === "toolStart") MS.liveTools.push(`${e.name} ${e.summary}`.trim());
    if (isMain()) { const el = $("#mainLive"); if (el && e.type === "delta") { el.textContent = MS.live; const log = $("#chatLog"); log.scrollTop = log.scrollHeight; } else renderChat(false); }
  });
})();
loadMain();

// ---------- chat: mode switch, header, log ----------
const askStatus = ask, renderStatus = renderChat, chatInfoStatus = showChatInfo;
function modeSeg() { return h("div", {id:"chatMode",class:"tk-row",style:"margin:8px 12px 0"},h("b",{},"Firstmate"),h("a",{href:"#/activity",class:"btn ghost sm",onclick:()=>openChat(false)},T("Activity & context (read-only)","事件與背景（唯讀）"))); }
(function mountSeg() { const head = $(".chat-head"); head.after(modeSeg()); })();
const refreshSeg = () => $$("#chatMode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === chatMode)));

showChatInfo = function () {
  refreshSeg();
  $("#chatProv").hidden = isMain(); // This selector belongs to the old read-only status provider.
  $("#chatClear").hidden = isMain(); // Clearing its local cache does not clear the owned primary.
  if (!isMain()) return chatInfoStatus();
  const v = MS.view, sub = $("#chatSub");
  if (!v) { sub.textContent = "…"; return; }
  if (v.state === "detached") sub.textContent = T("Connect your account to begin", "連接帳號即可開始");
  else if (v.state === "attaching" || v.state === "detaching") { const stopping=v.context==="studio"&&!v.origin&&v.drive?.path==="fresh";sub.textContent = T(v.state === "attaching" ? "Connecting main session…" : stopping ? "Stopping Firstmate…" : "Releasing main session…", v.state === "attaching" ? "正在連接主 session…" : stopping ? "正在停止 Firstmate…" : "正在交還主 session…"); }
  else sub.textContent = `${T("main session", "主 session")} · ${v.host} · ${v.model || "…"} · ${v.state === "paused" ? T("paused", "已暫停") : T("Studio driving", "Studio 駕駛中")}`;
  sub.title = v.sessionId ? `${v.host} ${v.sessionId}` : "";
};

const KLABEL = { captain: null, card: () => T("Card notice", "卡片通知"), wake: () => T("firstmate wake", "firstmate 喚醒"), status: () => T("Studio", "Studio"), tool: null };
function driverBanner(v) {
  const d = v.driver || {};
  const nativePrimary=v.context==="studio"&&!v.origin&&(v.drive?.path==="fresh"||d.path==="fresh")&&!d.forkedFrom;
  if (v?.state === "attaching" || v?.state === "detaching") return h("div", { class: "rich", "data-banner": v.state }, T(v.state === "attaching" ? "Connecting main session…" : nativePrimary ? "Stopping Firstmate…" : "Releasing main session…", v.state === "attaching" ? "正在連接主 session…" : nativePrimary ? "正在停止 Firstmate…" : "正在交還主 session…"));
  if (v.state === "paused") return h("div", { class: "rich chat-err", role: "alert", "data-banner": "paused" },
    h("div", { class: "rk", style: "color:var(--bad)" }, icon("alert", "ic sm"), T("Paused: a terminal may be writing this session", "已暫停：可能有終端機在寫這個 session")),
    h("div", { style: "font-size:13px;color:var(--text-2)" }, v.pausedReason),
    h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => postJ("/api/main/resume").then((r) => r.error && toast(r.error)) }, T("Resume here", "在這裡繼續")),
      h("button", { class: "btn", onclick: handBack }, v.context==="studio" ? T("Stop Firstmate","停止 Firstmate") : T("Hand back to terminal", "交回終端機"))));
  if (v.state === "detached") return h("div", { class: "rich", "data-banner": "detached" },
    h("div", { class: "rk" }, icon("lock", "ic sm"), nativePrimary ? T("Firstmate stopped", "Firstmate 已停止") : d.holder === "terminal" ? T("The terminal is driving", "終端機駕駛中") : T("No session attached", "還沒接上 session")),
    !nativePrimary && d.holder === "terminal" && d.resume ? h("div", { style: "font-size:13px" }, T("Handed back. In a terminal: ", "已交回。在終端機執行："), h("code", {}, d.resume),
      h("button", { class: "btn ghost icon", "aria-label": T("Copy", "複製"), onclick: () => navigator.clipboard?.writeText(d.resume).then(() => toast(T("Copied", "已複製"))) }, icon("copy", "ic sm"))) : null,
    h("div", {class:"faint"}, T("Start Studio's own Firstmate. No existing terminal session is required.","啟動 Studio 自己的 Firstmate，不需要既有終端機 session。")),
    v.context === "studio" ? startChoices() : h("div", {class:"actions"},h("a",{class:"btn primary",href:"#/firstmate",onclick:()=>openChat(false)},T("Connect and begin…","連接並開始…"))));
  return h("div", { class: "rich", "data-banner": "attached" },
    h("div", { class: "rk", style: "color:var(--accent-text)" }, icon("agent", "ic sm"), T("Studio is driving", "Studio 駕駛中"), h("span", { class: "vbadge" }, `${v.host} · ${String(v.sessionId).slice(0, 8)}`), v.busy ? h("span", { class: "badge run" }, h("span", { class: "d" }), T("turn running", "回合進行中")) : null),
    h("div", { class: "actions" },
      v.busy ? h("button", { class: "btn", onclick: () => postJ("/api/main/interrupt") }, icon("stop", "ic sm"), T("Interrupt", "中斷")) : null,
      h("button", { class: "btn", onclick: handBack }, v.context==="studio" ? T("Stop Firstmate","停止 Firstmate") : T("Hand back to terminal", "交回終端機"))));
}
for (const ev of ["crew:claude-status", "crew:codex-account"]) addEventListener(ev, () => { if (isMain() && MS.view?.state === "detached") try { renderChat(); } catch {} });
/** Studio's own workspace: start Firstmate on whichever signed-in host the captain picks, here in the chat. */
function startChoices() {
  const r = window.crewHostReady?.() || {}, phone = MS.me?.kind === "phone" && !MS.me?.allowDrive;
  const start = (host) => (e) => { e.target.disabled = true; Promise.resolve(window.crewStartFirstmate?.(host)).finally(() => renderChat()); };
  return h("div", { class: "actions", "data-chat-start": "1" },
    // both ready: a neutral choice, neither host is the default
    r.codex ? h("button", { class: r.claude ? "btn" : "btn primary", "data-chat-start-host": "codex", disabled: phone || r.starting || null, onclick: start("codex") }, T("Start on Codex", "在 Codex 上開始")) : null,
    r.claude ? h("button", { class: r.codex ? "btn" : "btn primary", "data-chat-start-host": "claude", disabled: phone || r.starting || null, onclick: start("claude") }, T("Start on Claude", "在 Claude 上開始")) : null,
    h("a", { class: r.codex || r.claude ? "btn ghost" : "btn primary", href: "#/firstmate", onclick: () => openChat(false) }, r.codex || r.claude ? T("Accounts…", "帳號…") : T("Connect and begin…", "連接並開始…")));
}
function queueView(v) {
  if (!v.queue.length) return null;
  return h("details", { class: "tools", open: true, "data-queue": v.queue.length },
    h("summary", {}, icon("clock", "ic sm"), T(`${v.queue.length} waiting for the next turn`, `${v.queue.length} 則等下一回合`)),
    v.queue.map((q) => h("div", { class: "toolrow", "data-q": q.kind },
      h("span", {}, h("span", { class: "vbadge" }, q.kind), " ", q.kind === "wake" ? q.lines.join(" · ") : q.text.slice(0, 120)),
      h("button", { class: "btn ghost icon", "aria-label": T("Remove", "移除"), onclick: () => postJ("/api/main/queue/remove", { id: q.id }) }, icon("x", "ic sm")))));
}
function approvalCard(a) {
  return h("div", { class: "rich", "data-approval": a.id, role: "group", "aria-label": T("Permission request", "權限請求") },
    h("div", { class: "rk", style: "color:var(--human-text, var(--accent-text))" }, icon("shield", "ic sm"), T("Firstmate asks to run a tool", "Firstmate 請求使用工具"), h("span", { class: "vbadge" }, a.tool)),
    h("code", { style: "white-space:pre-wrap;word-break:break-word;font-size:12.5px" }, a.summary || JSON.stringify(a.input).slice(0, 300)),
    h("div", { class: "faint", style: "font-size:12px" }, T(`Denied automatically if not answered in ${Math.max(0, Math.round((a.expires - Date.now()) / 1000))}s.`, `${Math.max(0, Math.round((a.expires - Date.now()) / 1000))} 秒內沒回答就自動拒絕。`)),
    h("div", { class: "actions" },
      h("button", { class: "btn primary", onclick: () => postJ("/api/main/approve", { id: a.id, allow: true }).then((r) => r.error && toast(r.error)) }, T("Allow", "允許")),
      h("button", { class: "btn", onclick: () => postJ("/api/main/approve", { id: a.id, allow: false }).then((r) => r.error && toast(r.error)) }, T("Deny", "拒絕"))));
}
function logItem(it, i) {
  if(it.source === "studio:native-outcome")return h("div",{class:"card x-pad","data-native-outcome":it.id},h("p",{},it.text),...(it.links||[]).filter(l=>/^#\/(run|review)\//.test(l.href)).map(l=>h("a",{class:"btn",href:l.href},l.label)));
  if (it.kind === "captain") return h("div", { class: "msg me", "data-main": "captain" }, h("div", { class: "bub" }, it.text), it.source && it.source !== "desktop" ? h("div", { class: "faint", style: "font-size:11px;text-align:right" }, it.source) : null);
  if (it.kind === "firstmate") return h("div", { class: "msg fm", "data-main": "firstmate" }, h("div", { class: "meta" }, "Firstmate", MS.view?.host ? h("span", { class: "vbadge" }, MS.view.host) : null), h("div", { class: "bub" }, md(it.text)));
  if (it.kind === "tool") return h("div", { class: "toolrow", "data-main": "tool", style: "padding:2px 6px" }, h("code", { style: "font-size:12px" }, it.text.slice(0, 160)));
  const lab = KLABEL[it.kind]?.();
  return h("div", { class: "faint", "data-main": it.kind, style: "font-size:12.5px;padding:4px 8px;border-left:2px solid var(--line);white-space:pre-wrap" }, lab ? h("b", {}, lab + " · ") : null, it.kind === "wake" ? it.text.split("\n").slice(1, -1).join("\n") : it.text);
}
renderChat = function (stick = true) {
  if (!isMain()) return renderStatus(stick);
  const log = $("#chatLog"), v = MS.view;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const kids = [];
  if (!v) kids.push(h("div", { class: "skel", style: "height:80px" }));
  else {
    kids.push(driverBanner(v));
    v.approvals.forEach((a) => kids.push(approvalCard(a)));
    v.log.filter((x) => !(v.context==="studio"&&x.source==="studio:handoff") && (x.kind !== "status" || /Paused|Handed|Attached|re-identified|Turn (failed|interrupted)/.test(x.text))).slice(-80).forEach((x, i) => kids.push(logItem(x, i)));
    if (v.busy) kids.push(h("div", { class: "msg fm", "data-main": "live" }, h("div", { class: "meta" }, "Firstmate", h("span", { class: "faint" }, T("working…", "處理中…"))),
      MS.liveTools.length ? h("div", { class: "faint", style: "font-size:12px" }, MS.liveTools.slice(-3).join(" · ")) : null,
      MS.live ? h("div", { class: "bub", id: "mainLive" }, MS.live) : h("div", { class: "typing" }, h("i"), h("i"), h("i"))));
    const q = queueView(v); if (q) kids.push(q);
  }
  log.replaceChildren(...kids);
  hydrateIcons(log);
  $("#chatSug").replaceChildren();
  const attached = v && (v.state === "attached" || v.state === "paused");
  $("#chatSend").disabled = !attached;
  $("#chatIn").placeholder = attached ? T("Tell Firstmate what you want done", "告訴 Firstmate 要做什麼") : T("Connect your account to begin", "連接帳號即可開始");
  if (stick || atBottom) log.scrollTop = log.scrollHeight;
};
ask = async function (text) {
  if (!isMain()) return askStatus(text);
  text = String(text || "").trim(); if (!text) return;
  openChat(true);
  const r = await postJ("/api/main/send", { text });
  if (r.error) toast(r.error);
};
async function handBack() {
  const native=MS.view?.context==="studio";
  const r = await postJ("/api/main/detach");
  if (r.error) return toast(r.error);
  if(native){await loadMain();return toast(T("Firstmate stopped","Firstmate 已停止"));}
  modal(T("Handed back", "已交回"), h("div", { style: "display:grid;gap:10px" },
    h("p", { class: "muted", style: "margin:0" }, T("Studio stopped its process and released the lock. Continue in a terminal with:", "Studio 已停止它的程序並放開鎖。在終端機用這個指令接回：")),
    h("code", { class: "mono", id: "resumeCmd", style: "padding:10px;border:1px solid var(--line);border-radius:8px;word-break:break-all" }, r.resume)),
    (close) => { navigator.clipboard?.writeText(r.resume).catch(() => {}); close(); toast(T("Copied", "已複製")); });
  $(".modal .btn.primary").textContent = T("Copy and close", "複製並關閉");
}
async function openAttach() {
  MS.sessions = null; MS.sesErr = null;
  const body = h("div", { id: "attachBody", style: "display:grid;gap:10px;min-width:min(560px,80vw)" });
  const draw = () => {
    const hostSeg = h("div", { class: "seg", role: "group", "aria-label": T("Host", "主機") }, ["claude", "codex"].map((x) =>
      h("button", { type: "button", "aria-pressed": String(MS.sesHost === x), onclick: () => { MS.sesHost = x; load(); } }, h("span", { class: "keep" }, x === "claude" ? "Claude Code" : "Codex"))));
    const rows = MS.sesErr ? [h("div", { class: "err" }, MS.sesErr)] : !MS.sessions ? [h("div", { class: "skel", style: "height:60px" })]
      : !MS.sessions.length ? [h("div", { class: "empty" }, T("No sessions for this project on this host.", "這個主機上沒有這個專案的 session。"))]
      : MS.sessions.slice(0, 12).map((s) => h("div", { class: "rich", "data-session": s.id, style: "gap:6px" },
          h("div", { class: "rk" }, h("span", { class: "mono" }, s.id.slice(0, 8)), h("span", { class: "faint" }, ago(new Date(s.updated).toISOString())),
            s.possiblyOpen ? h("span", { class: "badge bad" }, h("span", { class: "d" }), T("terminal driving", "終端機使用中")) : null),
          h("div", { style: "font-size:13px" }, s.title),
          s.possiblyOpen ? h("div", { class: "faint", style: "font-size:12px" }, s.openReason) : null,
          h("div", { class: "actions" }, h("button", { class: "btn", disabled: s.possiblyOpen || null, "data-attach": s.id,
            onclick: async (e) => { e.target.disabled = true; const r = await postJ("/api/main/attach", { host: MS.sesHost, id: s.id }); if (!r.ok) { toast(r.reason || r.error); e.target.disabled = false; } else { $("#modalRoot").replaceChildren(); chatMode = "main"; store.set("crew.chatMode", "main"); openChat(true); loadMain(); } } },
            s.possiblyOpen ? T("Exit it in the terminal first", "請先在終端機退出") : T("Attach", "接上")))));
    body.replaceChildren(h("p", { class: "muted", style: "margin:0" }, T(`Sessions of ${MS.view?.project || "the project"}. Attaching resumes the same conversation; the terminal must not be using it.`,
      `${MS.view?.project || "專案"} 的 session。接上會延續同一段對話；終端機不能同時在用。`)), hostSeg, ...rows);
  };
  const load = async () => { MS.sessions = null; draw(); try { const r = await getJ(`/api/main/sessions?host=${MS.sesHost}`); if (r.error) MS.sesErr = r.error; else MS.sessions = r.sessions; } catch (e) { MS.sesErr = String(e); } draw(); };
  modal(T("Attach the main session", "接上主 session"), body, (close) => close());
  $(".modal .btn.primary").textContent = T("Close", "關閉");
  load();
}

// approvals also show on any page as a bar, so a request is never missed
function approvalsBar() {
  let bar = $("#apprBar");
  const n = MS.view?.approvals?.length || 0;
  if (!n) { bar?.remove(); return; }
  if (!bar) { bar = h("button", { id: "apprBar", class: "btn primary", style: "position:fixed;z-index:60;left:50%;transform:translateX(-50%);top:12px;box-shadow:0 6px 24px rgba(0,0,0,.25)" }); document.body.append(bar); bar.onclick = () => { chatMode = "main"; store.set("crew.chatMode", "main"); openChat(true); renderChat(); }; }
  bar.replaceChildren(icon("shield", "ic sm"), h("span", {}, T(`${n} permission request${n > 1 ? "s" : ""}`, `${n} 個權限請求`)));
}

// ---------- the Phone page ----------
const RM = { data: null, pair: null, timer: null };
async function loadRemote() { try { RM.data = await getJ("/api/remote"); } catch { RM.data = null; } if (S.route?.name === "remote") render(); }
function qr(text) {
  if (typeof qrcode !== "function") return h("div", { class: "faint" }, T("QR code unavailable offline; type the code instead.", "離線時無法顯示 QR，請直接輸入號碼。"));
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const box = h("div", { class: "qr", style: "background:#fff;padding:10px;border-radius:10px;width:max-content", "aria-label": T("QR code for pairing", "配對 QR code") });
  box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: false });
  return box;
}
function viewRemote() {
  if (!RM.data) { loadRemote(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:200px" })); }
  const d = RM.data, ts = d.tailscale || {};
  const phone = MS.me.kind === "phone";
  const pairBox = RM.pair && RM.pair.expires > Date.now()
    ? h("div", { class: "card", "data-pair": "active", style: "display:grid;gap:10px;padding:16px" },
        h("div", { class: "rk" }, T("Pairing code", "配對碼")),
        h("div", { class: "mono", style: "font-size:34px;letter-spacing:6px", "data-code": RM.pair.code }, RM.pair.code),
        qr(RM.pair.url), h("div", { class: "faint", style: "font-size:12px;word-break:break-all" }, RM.pair.url),
        h("div", { class: "faint", style: "font-size:12px" }, T(`Valid for ${Math.max(0, Math.round((RM.pair.expires - Date.now()) / 1000))}s, 5 tries.`, `有效 ${Math.max(0, Math.round((RM.pair.expires - Date.now()) / 1000))} 秒，最多試 5 次。`)))
    : null;
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Phone", "手機")),
      h("p", {}, T("Reach Studio from your phone over Tailscale. Studio still listens on 127.0.0.1 only; `tailscale serve` forwards your tailnet name to it.",
        "透過 Tailscale 用手機連 Studio。Studio 仍然只聽 127.0.0.1；由 `tailscale serve` 把你的 tailnet 名稱轉過來。")))),
    phone ? h("div", { class: "rich", "data-phone": "self" }, h("div", { class: "rk" }, icon("check", "ic sm"), T(`This phone is paired (${MS.me.device?.name})`, `這支手機已配對（${MS.me.device?.name}）`)),
      h("div", { class: "faint", style: "font-size:13px" }, MS.me.allowDrive ? T("It may drive firstmate.", "可以操作 firstmate。") : T("It may read and interrupt. Driving firstmate is off; turn it on from the Mac.", "可以看和中斷；操作 firstmate 目前關閉，請在 Mac 上打開。"))) : null,
    h("section", { class: "card", style: "display:grid;gap:10px;padding:16px", "data-section": "tailscale" },
      h("h2", { style: "margin:0;font-size:16px" }, "Tailscale"),
      h("div", { class: "kv" }, h("span", { class: "faint" }, T("Status", "狀態")), h("span", {}, !ts.installed ? T("not installed", "未安裝") : ts.running ? T("running", "運作中") : (ts.error || T("not running", "未運作")))),
      h("div", { class: "kv" }, h("span", { class: "faint" }, T("Phone URL", "手機網址")), h("span", { class: "mono", style: "word-break:break-all" }, ts.url || "—")),
      h("div", { class: "kv" }, h("span", { class: "faint" }, T("Phone access", "手機連線")), h("span", { "data-serve": d.serveOn ? "on" : "off" }, d.serveOn ? T("on", "開啟") : T("off", "關閉"), d.live ? "" : T(" (this build only records the command)", "（這版只記錄指令，不會真的執行）"))),
      phone ? null : h("div", { class: "actions" }, h("button", { class: "btn primary", id: "enablePhone", onclick: () => confirmServe(d.serveOn ? "disable" : "enable") },
        d.serveOn ? T("Turn phone access off…", "關閉手機連線…") : T("Enable phone access…", "開啟手機連線…")))),
    phone ? null : h("section", { class: "card", style: "display:grid;gap:10px;padding:16px", "data-section": "pair" },
      h("h2", { style: "margin:0;font-size:16px" }, T("Pair a phone", "配對手機")),
      h("p", { class: "muted", style: "margin:0" }, T("Show a 6-digit code here, then open the link (or scan the QR) on the phone. The phone gets its own key; only its hash is kept here.",
        "這裡顯示 6 位數碼，手機打開連結或掃 QR 即可。手機會拿到自己的金鑰，這裡只存它的 hash。")),
      pairBox,
      h("div", { class: "actions" }, h("button", { class: "btn", id: "startPair", onclick: async () => { const r = await postJ("/api/remote/pair/start"); if (r.error) return toast(r.error); RM.pair = r; render();
        clearInterval(RM.timer); RM.timer = setInterval(() => { if (S.route?.name !== "remote" || !RM.pair || RM.pair.expires < Date.now()) { clearInterval(RM.timer); if (RM.pair && RM.pair.expires < Date.now()) RM.pair = null; } loadRemote(); }, 3000); } },
        RM.pair ? T("New code", "重新產生") : T("Show pairing code", "顯示配對碼"))),
      h("label", { class: "kv", style: "align-items:center" }, h("span", {}, T("Allow phones to drive firstmate", "允許手機操作 firstmate"),
        h("div", { class: "faint", style: "font-size:12px" }, T("Send messages, attach, approve tool requests, answer cards. Reading and interrupt are always allowed.", "傳訊息、接上、核准工具請求、點卡。看和中斷一律允許。"))),
        h("input", { type: "checkbox", id: "allowDrive", checked: d.allowDrive || null, onchange: async (e) => { const r = await postJ("/api/remote/settings", { allowDrive: e.target.checked }); if (r.error) toast(r.error); loadRemote(); } }))),
    h("section", { class: "card", style: "display:grid;gap:8px;padding:16px", "data-section": "devices" },
      h("h2", { style: "margin:0;font-size:16px" }, T("Paired devices", "已配對裝置")),
      d.devices.length ? d.devices.map((x) => h("div", { class: "kv", "data-device": x.id },
        h("span", {}, h("b", {}, x.name), " ", h("span", { class: "faint" }, T(`paired ${ago(x.paired)}`, `配對於 ${ago(x.paired)}`), x.lastSeen ? T(` · seen ${ago(x.lastSeen)}`, ` · ${ago(x.lastSeen)}上線`) : "")),
        phone ? null : h("button", { class: "btn", "data-revoke": x.id, onclick: async () => { const r = await postJ("/api/remote/revoke", { id: x.id }); if (r.error) toast(r.error); loadRemote(); } }, T("Revoke", "撤銷"))))
        : h("div", { class: "empty" }, T("No phone is paired yet.", "還沒有配對的手機。"))));
}
function confirmServe(action) {
  const cmd = action === "disable" ? RM.data.offCommand : RM.data.command;
  modal(action === "disable" ? T("Turn phone access off", "關閉手機連線") : T("Enable phone access", "開啟手機連線"), h("div", { style: "display:grid;gap:10px" },
    h("p", { class: "muted", style: "margin:0" }, T("Studio will run exactly this command:", "Studio 會執行這個指令：")),
    h("code", { class: "mono", "data-cmd": cmd, style: "padding:10px;border:1px solid var(--line);border-radius:8px;word-break:break-all" }, cmd),
    h("p", { class: "faint", style: "margin:0;font-size:13px" }, RM.data.live ? T("It publishes Studio to your tailnet only (not the internet). Phones still have to pair.", "只發佈到你的 tailnet（不是公網），手機仍需配對。")
      : T("This build does not run it: the command is only recorded. Run it yourself in a terminal when you are ready.", "這版不會真的執行，只記錄指令。準備好時請自己在終端機執行。"))),
    async (close) => { const r = await postJ("/api/remote/tailscale", { action, confirm: true }); close(); toast(r.ok ? (r.live ? T("Done", "完成") : r.out) : (r.error || r.out)); loadRemote(); });
  $(".modal .btn.primary").textContent = T("Run", "執行");
}
Object.assign(routes, { remote: viewRemote });
(function nav() {
  const b = h("button", { class: "nav-item", "data-view": "remote", "data-tip": T("Phone", "手機") }, icon("monitor"), h("span", { class: "nl" }, T("Phone", "手機")));
  $(".nav").append(b); b.addEventListener("click", () => { location.hash = "#/remote"; });
  if (location.hash.startsWith("#/remote")) route();
})();
// a phone that lost its key is asked to pair again
addEventListener("crew-pair-needed", (e) => {
  if ($("#pairAsk")) return;
  const inp = h("input", { class: "input", id: "pairCode", inputmode: "numeric", maxlength: "6", placeholder: "000000", "aria-label": T("Pairing code", "配對碼") });
  modal(T("Pair this phone", "配對這支手機"), h("div", { id: "pairAsk", style: "display:grid;gap:10px" },
    h("p", { class: "muted", style: "margin:0" }, e.detail || T("Enter the 6-digit code shown on the Mac.", "輸入 Mac 上顯示的 6 位數碼。")), inp),
    async (close) => { const r = await window.crewRemote.pair(inp.value.trim(), "phone"); if (r.ok) { close(); location.reload(); } else toast(r.error); });
  $(".modal .btn.primary").textContent = T("Pair", "配對");
});
const prevOnLang = window.onLang;
window.onLang = () => { prevOnLang?.(); showChatInfo(); if (isMain()) renderChat(false); };
setInterval(() => { if (MS.view?.approvals?.length && isMain()) renderChat(false); }, 5000);

// Refresh source-bound durable receipts when native Tasks change. No model wake.
let outcomeRefresh; window.liveListen("wrun",()=>{clearTimeout(outcomeRefresh);outcomeRefresh=setTimeout(()=>loadMain(),100);});
