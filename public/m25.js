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
    if (isMain()) { const el = $("#mainLive"); if (el && e.type === "delta") { el.textContent = I18N.chatText(lang, MS.live); const log = $("#chatLog"); log.scrollTop = log.scrollHeight; } else renderChat(false); }
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
      h("span", {}, h("span", { class: "vbadge" }, q.kind), " ", q.kind === "wake" ? q.lines.join(" · ") : q.text.slice(0, 120), q.attachments?.length ? h("span", { class: "faint", "data-q-att": q.attachments.length }, ` · ${T(`${q.attachments.length} file${q.attachments.length > 1 ? "s" : ""}`, `${q.attachments.length} 個檔案`)}`) : null),
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
/** A typed error from outside Studio: its class, its code, Studio's reason, and the exact external message. */
const EXT_CLASS = { quota: ["Quota or rate limit", "額度或頻率限制"], auth: ["Sign-in refused", "登入被拒"], timeout: ["Timed out", "逾時"], network: ["Network", "網路"], exit: ["Process stopped", "程序停止"], attachment: ["Attachment not sent", "附件沒有送出"], upload: ["Upload failed", "上傳失敗"], api: ["Vendor error", "供應商錯誤"] };
function externalView(x) {
  const who = { claude: "Claude", codex: "Codex", studio: "Studio" }[x.source] || x.source, cls = EXT_CLASS[x.class] || EXT_CLASS.api;
  return h("div", { class: "rich chat-err ext-err", role: "alert", "data-external-error": x.code, "data-error-class": x.class, "data-error-source": x.source },
    h("div", { class: "rk", style: "color:var(--bad)" }, icon("alert", "ic sm"), `${who} · ${T(cls[0], cls[1])}`, h("span", { class: "vbadge" }, x.code)),
    h("div", { style: "font-size:13px" }, L(x.reason)),
    x.message ? h("code", { class: "ext-msg", "data-external-message": "" }, x.message) : null);
}
/** Earlier primary sessions keep their lines as their own block, labelled with host and model. */
function sessionSep(x, prev, all, v) {
  if (!x.session) return null;
  const prevId = (() => { for (let k = all.indexOf(x) - 1; k >= 0; k--) if (all[k].session) return all[k].session.id; return null; })();
  if (prevId === x.session.id) return null;
  const many = all.some((y) => y.session && y.session.id !== x.session.id), earlier = x.session.id !== v.sessionId;
  if (!many && !earlier) return null;
  // the model once known: any later line of the block names it, or the running session reports it
  const model = all.filter((y) => y.session?.id === x.session.id && y.session.model).map((y) => y.session.model).at(-1) || (!earlier && v.model && v.model !== v.host ? v.model : null);
  const when = new Date(x.at).toLocaleString(I18N.locale(lang), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return h("div", { class: "chat-session-sep", "data-session-block": x.session.id, "data-earlier": earlier ? "1" : "0", "data-session-model": model || null },
    h("span", {}, earlier ? T("Earlier session", "較早的 session") : T("This session", "目前的 session"), ` · ${x.session.host}${model ? ` · ${model}` : ""} · ${when}`));
}
// a Studio note in the UI language: its i18n pair when the server sent one, else its text (zh-CN converts any Traditional in it)
const noteText = (it) => (it.i18n ? L(it.i18n) : T(it.text, it.text));
function logItem(it, i) {
  if(it.source === "studio:native-outcome")return h("div",{class:"card x-pad","data-native-outcome":it.id},h("p",{},it.text),...(it.links||[]).filter(l=>/^#\/(run|review)\//.test(l.href)).map(l=>h("a",{class:"btn",href:l.href},l.label)));
  if (it.kind === "captain") return h("div", { class: "msg me", "data-main": "captain" }, it.text ? h("div", { class: "bub" }, it.text) : null, it.attachments?.length ? attView(it.attachments) : null, it.source && it.source !== "desktop" ? h("div", { class: "faint", style: "font-size:11px;text-align:right" }, it.source) : null);
  if (it.external) return externalView(it.external);
  if (it.attachmentRefusal) return externalView({ source: "studio", class: "attachment", code: it.attachmentRefusal, message: it.text.replace(/^Not sent: /, ""), reason: { en: "An attachment could not be sent.", "zh-TW": "附件無法送出。" } });
  if (it.kind === "firstmate") return h("div", { class: "msg fm", "data-main": "firstmate" }, h("div", { class: "meta" }, "Firstmate", (it.session?.host || MS.view?.host) ? h("span", { class: "vbadge" }, it.session?.host || MS.view.host) : null), h("div", { class: "bub" }, md(I18N.chatText(lang, it.text))));
  if (it.kind === "tool") return h("div", { class: "toolrow", "data-main": "tool", style: "padding:2px 6px" }, h("code", { style: "font-size:12px" }, it.text.slice(0, 160)));
  const lab = KLABEL[it.kind]?.();
  return h("div", { class: "faint", "data-main": it.kind, style: "font-size:12.5px;padding:4px 8px;border-left:2px solid var(--line);white-space:pre-wrap" }, lab ? h("b", {}, lab + " · ") : null, it.kind === "wake" ? it.text.split("\n").slice(1, -1).join("\n") : noteText(it));
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
    v.log.filter((x) => !(v.context==="studio"&&x.source==="studio:handoff") && (x.kind !== "status" || x.attachmentRefusal || x.external || /Paused|Handed|Attached|re-identified|Turn (failed|interrupted)/.test(x.text))).slice(-80).forEach((x, i, all) => { const sep = sessionSep(x, all[i - 1], all, v); if (sep) kids.push(sep); kids.push(logItem(x, i)); });
    if (v.busy) kids.push(h("div", { class: "msg fm", "data-main": "live" }, h("div", { class: "meta" }, "Firstmate", h("span", { class: "faint" }, T("working…", "處理中…"))),
      MS.liveTools.length ? h("div", { class: "faint", style: "font-size:12px" }, MS.liveTools.slice(-3).join(" · ")) : null,
      MS.live ? h("div", { class: "bub", id: "mainLive" }, I18N.chatText(lang, MS.live)) : h("div", { class: "typing" }, h("i"), h("i"), h("i"))));
    (MS.notices || []).forEach((n) => kids.push(externalView(n)));
    const q = queueView(v); if (q) kids.push(q);
  }
  log.replaceChildren(...kids);
  hydrateIcons(log);
  $("#chatSug").replaceChildren();
  const attached = v && (v.state === "attached" || v.state === "paused");
  $("#chatSend").disabled = !attached;
  renderAtt();
  $("#chatIn").placeholder = attached ? T("Tell Firstmate what you want done", "告訴 Firstmate 要做什麼") : T("Connect your account to begin", "連接帳號即可開始");
  if (stick || atBottom) log.scrollTop = log.scrollHeight;
};
ask = async function (text) {
  if (!isMain()) return askStatus(text);
  text = String(text || "").trim();
  const att = MS.att;
  if (!text && !att.length) return;
  // every pending file goes, or nothing does: never a silent drop
  if (att.some((a) => a.state === "uploading")) { restoreDraft(text); return toast(T("Wait until the files finish uploading.", "請等檔案上傳完成。")); }
  const bad = att.find((a) => a.state === "refused" || attNote(a)?.refused);
  if (bad) { restoreDraft(text); return toast(T(`Remove ${bad.name} first: it cannot be sent.`, `請先移除 ${bad.name}：它無法送出。`)); }
  openChat(true);
  let r; try { r = await postJ("/api/main/send", { text, ...(att.length ? { attachments: att.map((a) => ({ id: a.ref.id, name: a.ref.name })) } : {}) }); }
  catch (e) { r = { status: 0, error: String(e?.message || e), code: "studio_network" }; }
  if (r.error) { restoreDraft(text); localNotice({ source: "studio", class: r.status === 0 ? "network" : /^(attachment|claude)/.test(r.code || "") ? "attachment" : "api", code: r.code || `http_${r.status}`, message: r.reason ? `${r.reason.en}${r.reason["zh-TW"] ? ` / ${r.reason["zh-TW"]}` : ""}` : r.error, reason: { en: "The message was not sent.", "zh-TW": "訊息沒有送出。" } }); return; }
  MS.notices = [];
  if (att.length) clearAtt();
};
/** An error this page met itself (the send or an upload did not reach Studio, or Studio refused it): shown in the chat until the next send. */
function localNotice(n) { MS.notices = [...(MS.notices || []).slice(-4), { schema: 1, ...n }]; renderChat(); }
const restoreDraft = (text) => { const el = $("#chatIn"); if (el && text && !el.value) el.value = text; };

// ---------- chat attachments: drop, paste or pick images and PDFs; they go with the next message ----------
// The limits mirror src/attachments.ts; the server checks the real type by the file's first bytes and decides.
const ATT = { max: 5, image: 10 * 1024 * 1024, pdf: 20 * 1024 * 1024, claudeImage: 3932160, claudeSide: 8000, claudePages: 100, claudeMessage: 18 * 1024 * 1024, accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf" };
MS.att = [];
let attSeq = 0;
const fmtSize = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
/** What the current host does with a ready file: a note, or a refusal the captain must act on. */
function attNote(a) {
  const host = MS.view?.state !== "detached" ? MS.view?.host : null, ref = a.ref;
  if (!ref) return null;
  if (host === "codex" && ref.kind === "pdf") return { refused: false, text: T("Codex cannot read PDFs directly; it opens the file itself.", "Codex 不能直接讀 PDF，會自己開檔。") };
  if (host === "claude" && ref.kind === "image" && ref.size > ATT.claudeImage) return { refused: true, text: T("Claude takes images up to 3.75 MB. Remove it or send a smaller one.", "Claude 只收 3.75 MB 以內的圖片，請移除或換小一點的。") };
  if (host === "claude" && ref.kind === "image" && Math.max(ref.width || 0, ref.height || 0) > ATT.claudeSide) return { refused: true, text: T(`Claude takes images up to ${ATT.claudeSide} px on a side (this one is ${ref.width}×${ref.height}).`, `Claude 只收每邊 ${ATT.claudeSide} px 以內的圖片（這張 ${ref.width}×${ref.height}）。`) };
  if (host === "claude" && ref.kind === "pdf" && (ref.pages || 0) > ATT.claudePages) return { refused: true, text: T(`Claude takes PDFs up to ${ATT.claudePages} pages (this one has ${ref.pages}).`, `Claude 只收 ${ATT.claudePages} 頁以內的 PDF（這份 ${ref.pages} 頁）。`) };
  if (host !== "codex" && ref.kind === "pdf" && ref.pages == null) return { refused: false, warn: true, text: T(`Page count unknown — Claude refuses PDFs over ${ATT.claudePages} pages.`, `讀不出頁數——Claude 會拒收超過 ${ATT.claudePages} 頁的 PDF。`) };
  if (host !== "codex" && ref.kind === "image" && (ref.width == null || ref.height == null)) return { refused: false, warn: true, text: T(`Image size unknown — Claude refuses images over ${ATT.claudeSide} px on a side.`, `讀不出圖片尺寸——Claude 會拒收每邊超過 ${ATT.claudeSide} px 的圖片。`) };
  return null;
}
function addFiles(list) {
  const files = [...(list || [])];
  if (!files.length) return;
  for (const f of files) {
    if (MS.att.length >= ATT.max) { toast(T(`At most ${ATT.max} files per message.`, `每則訊息最多 ${ATT.max} 個檔案。`)); break; }
    const a = { key: `a${++attSeq}`, name: String(f.name || T("pasted image", "貼上的圖片")), size: f.size, state: "uploading", ref: null, error: null,
      url: /^image\/(png|jpeg|webp|gif)$/.test(f.type) ? URL.createObjectURL(f) : null, pdf: f.type === "application/pdf" };
    MS.att.push(a);
    if (f.size > ATT.pdf) { a.state = "refused"; a.error = T("Too large: images up to 10 MB, PDFs up to 20 MB.", "太大：圖片最大 10 MB，PDF 最大 20 MB。"); continue; }
    upload(a, f);
  }
  renderAtt();
}
async function upload(a, f) {
  try {
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, "")); r.onerror = () => no(r.error); r.readAsDataURL(f); });
    if (!MS.att.includes(a)) return; // removed while reading
    const r = await postJ("/api/main/attachments", { name: a.name, data });
    if (!MS.att.includes(a)) return;
    if (r.ok && r.attachment) { a.state = "ready"; a.ref = r.attachment; a.name = r.attachment.name; a.pdf = r.attachment.kind === "pdf"; if (a.pdf && a.url) { URL.revokeObjectURL(a.url); a.url = null; } }
    else { a.state = "refused"; a.code = r.code || `http_${r.status}`; a.error = r.reason ? L(r.reason) : r.error ? `${T("Upload failed", "上傳失敗")} (${a.code}): ${r.error}` : `${T("Upload failed", "上傳失敗")} (HTTP ${r.status})`; }
  } catch (e) { a.state = "refused"; a.code = "upload_network"; a.error = `${T("Upload failed", "上傳失敗")}: ${String(e?.message || e).slice(0, 300)}`; localNotice({ source: "studio", class: "upload", code: "upload_network", message: String(e?.message || e).slice(0, 300), reason: { en: `${a.name} was not uploaded.`, "zh-TW": `${a.name} 沒有上傳。` } }); }
  renderAtt();
}
function removeAtt(key) { const k = MS.att.findIndex((a) => a.key === key); if (k < 0) return; const [a] = MS.att.splice(k, 1); if (a.url) URL.revokeObjectURL(a.url); renderAtt(); $("#chatIn")?.focus(); }
function clearAtt() { for (const a of MS.att) if (a.url) URL.revokeObjectURL(a.url); MS.att = []; renderAtt(); }
function renderAtt() {
  const tray = $("#chatAtt"); if (!tray) return;
  const show = isMain() && MS.att.length, appearing = show && tray.hidden;
  tray.hidden = !show;
  // the tray takes room under the log: keep the newest line in view when it appears
  if (appearing) requestAnimationFrame(() => { const log = $("#chatLog"); if (log) log.scrollTop = log.scrollHeight; });
  if (!show) return tray.replaceChildren();
  tray.replaceChildren(...MS.att.map((a) => {
    const note = a.state === "refused" ? { refused: true, text: a.error } : attNote(a);
    return h("div", { class: `att-chip${note?.refused ? " is-bad" : ""}`, "data-att": a.state, "data-att-name": a.name, role: "group", "aria-label": a.name },
      a.url ? h("img", { class: "att-thumb", src: a.url, alt: "" }) : h("span", { class: "att-thumb att-doc" }, icon("doc", "ic sm")),
      h("span", { class: "att-meta" }, h("span", { class: "att-name" }, a.name),
        h("span", { class: "att-sub" }, a.state === "uploading" ? T("Uploading…", "上傳中…") : fmtSize(a.ref?.size ?? a.size)),
        note ? h("span", { class: "att-note", role: note.refused ? "alert" : null, "data-att-note": note.refused ? "refused" : note.warn ? "warn" : "info", "data-att-code": a.code || null }, note.text) : null),
      h("button", { type: "button", class: "btn ghost icon att-x", "aria-label": T(`Remove ${a.name}`, `移除 ${a.name}`), onclick: () => removeAtt(a.key) }, icon("x", "ic sm")));
  }));
}
/** A sent message's files in the history: thumbnails for images, a labelled link for PDFs (opened from Studio's copy). */
function attView(list) {
  return h("div", { class: "att-sent", "data-main-att": list.length }, list.map((r) => {
    const href = window.crewRemote?.withToken ? window.crewRemote.withToken(`/api/main/attachments/${r.id}`) : `/api/main/attachments/${r.id}`;
    return r.kind === "image"
      ? h("a", { class: "att-sent-img", href, target: "_blank", rel: "noopener", "data-att-sent": "image", title: r.name }, h("img", { src: `/api/main/attachments/${r.id}`, alt: r.name, loading: "lazy" }))
      : h("a", { class: "att-chip att-sent-doc", href, target: "_blank", rel: "noopener", "data-att-sent": "pdf", title: r.name }, h("span", { class: "att-thumb att-doc" }, icon("doc", "ic sm")),
          h("span", { class: "att-meta" }, h("span", { class: "att-name" }, r.name), h("span", { class: "att-sub" }, `PDF · ${fmtSize(r.size)}`)));
  }));
}
(function mountAttachments() {
  const form = $("#chatForm"), input = $("#chatIn"), chat = $("#chat");
  if (!form || !input || !chat) return;
  const picker = h("input", { type: "file", id: "chatFile", accept: ATT.accept, multiple: true, hidden: true, tabindex: "-1", "aria-hidden": "true", onchange: (e) => { addFiles(e.target.files); e.target.value = ""; } });
  const btn = h("button", { type: "button", class: "btn ghost icon", id: "chatAttach", "aria-label": T("Attach images or PDFs", "附加圖片或 PDF"), title: T("Attach images or PDFs", "附加圖片或 PDF"), onclick: () => picker.click() }, icon("clip", "ic"));
  form.prepend(btn, picker);
  form.before(h("div", { class: "att-tray", id: "chatAtt", hidden: true, "aria-live": "polite" }));
  chat.append(h("div", { class: "att-drop", id: "chatDrop", "aria-hidden": "true" }, h("div", {}, icon("clip", "ic"), h("b", {}, T("Drop images or PDFs", "放開即可附加圖片或 PDF")), h("span", {}, T("PNG, JPEG, WebP, GIF · PDF", "PNG、JPEG、WebP、GIF · PDF")))));
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  let depth = 0;
  chat.addEventListener("dragenter", (e) => { if (!hasFiles(e) || !isMain()) return; e.preventDefault(); depth++; chat.classList.add("drop-on"); });
  chat.addEventListener("dragover", (e) => { if (!hasFiles(e) || !isMain()) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; chat.classList.add("drop-on"); });
  chat.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) chat.classList.remove("drop-on"); });
  chat.addEventListener("drop", (e) => { if (!hasFiles(e) || !isMain()) return; e.preventDefault(); depth = 0; chat.classList.remove("drop-on"); addFiles(e.dataTransfer.files); });
  input.addEventListener("paste", (e) => {
    if (!isMain()) return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (!files.length) return;
    if (![...(e.clipboardData?.types || [])].includes("text/plain")) e.preventDefault();
    addFiles(files);
  });
  hydrateIcons?.(chat);
})();
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
