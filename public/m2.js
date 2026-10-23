// M2: the firstmate chat (status answers from the event log, intent capture),
// the Intents and Library pages, and the task and event pages answers link to.
// Loaded after app.js and uses its helpers (h, icon, T, L, S, route, render…).

// ---------- tiny safe markdown: links to Studio pages or GitHub, **bold**, `code`, and pipe tables ----------
// A Firstmate reply often carries a status table; it showed as raw pipes (live E2E S24). A table is a header row with
// pipes, a separator row (---, :--, --:) and its body rows; each cell is inline markdown. CJK cells need no special case.
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const tableCells = (line) => { const t = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, ""); return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")); };
function md(text) {
  const lines = String(text ?? "").split("\n"), out = document.createDocumentFragment();
  let i = 0, plain = [];
  const flush = () => { if (plain.length) { out.append(mdInline(plain.join("\n"))); plain = []; } };
  while (i < lines.length) {
    if (lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = tableCells(lines[i]), aligns = tableCells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : null));
      const rows = []; i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(tableCells(lines[i++]));
      // the newline before the table belongs to the text above it; the table is its own block
      if (plain.length && plain[plain.length - 1] === "") plain.pop();
      flush();
      const cell = (tag, c, k) => h(tag, aligns[k] ? { style: `text-align:${aligns[k]}` } : {}, mdInline(c ?? ""));
      out.append(h("div", { class: "md-table-wrap" }, h("table", { class: "md-table" },
        h("thead", {}, h("tr", {}, head.map((c, k) => cell("th", c, k)))),
        h("tbody", {}, rows.map((r) => h("tr", {}, head.map((_, k) => cell("td", r[k], k))))))));
      if (i < lines.length && !lines[i].trim()) i++; // one blank line after the table is its margin
      continue;
    }
    plain.push(lines[i++]);
  }
  flush();
  return out;
}
function mdInline(text) {
  const out = document.createDocumentFragment();
  const re = /\[([^\]]{1,120})\]\(([^)\s]{1,300})\)|\*\*([^*]{1,200})\*\*|`([^`]{1,200})`/g;
  let last = 0, m;
  const repo = S.github?.repo || "unknown/unknown";
  while ((m = re.exec(text))) {
    if (m.index > last) out.append(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = m[2];
      if (href.startsWith("#/")) out.append(h("a", { class: "cite", href, "data-cite": href }, m[1]));
      else if (href.startsWith(`https://github.com/${repo}/`)) out.append(h("a", { class: "cite", href, target: "_blank", rel: "noopener", "data-cite": href }, m[1], " ↗"));
      else out.append(m[1]); // any other link is shown as plain text
    } else if (m[3] !== undefined) out.append(h("b", {}, m[3]));
    else out.append(h("code", {}, m[4]));
    last = re.lastIndex;
  }
  if (last < text.length) out.append(text.slice(last));
  return out;
}

// ---------- chat state ----------
const CH = { msgs: [], busy: false, abort: null };
try { const s = JSON.parse(localStorage.getItem("crew.chat") || "[]"); if (Array.isArray(s)) CH.msgs = s.slice(-60); } catch {}
const saveChat = () => { try { localStorage.setItem("crew.chat", JSON.stringify(CH.msgs.slice(-60))); } catch {} };
const SUG = () => [T("How is T-305 doing?", "T-305 現在進度如何"), T("What did the crew merge today?", "今天合併了什麼？"),
  T("Which cards wait on me?", "有什麼卡在等我？"), T("What is the crew doing right now?", "船員現在在做什麼？")];

function toolChips(tools) {
  if (!tools?.length) return null;
  const done = tools.filter((t) => t.rows !== undefined || t.error).length;
  return h("details", { class: "tools", "data-tools": tools.length },
    h("summary", {}, icon("tool", "ic sm"), T(`${tools.length} lookup${tools.length > 1 ? "s" : ""} in the event log`, `查了 ${tools.length} 次紀錄`),
      done < tools.length ? h("span", { class: "faint" }, "…") : null),
    tools.map((t) => h("div", { class: "toolrow", "data-tool": t.name },
      h("code", {}, `${t.name}(${argStr(t.args)})`),
      h("span", { class: t.error ? "bad" : "faint", style: "font-size:12px" },
        t.error ? `✗ ${t.error}` : t.rows === undefined ? T("running…", "查詢中…") : t.rows === null ? "✓" : T(`${t.rows} row${t.rows === 1 ? "" : "s"}`, `${t.rows} 筆`)))));
}
const argStr = (a) => { if (!a || typeof a !== "object") return ""; return Object.entries(a).map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v) : JSON.stringify(v)}`).join(", "); };

function intentCard(i) {
  return h("div", { class: "rich", "data-intent": i.id },
    h("div", { class: "rk", style: "color:var(--accent-text)" }, icon("target", "ic sm"), T("Intent recorded", "已記錄意圖"), h("span", { class: "iid" }, i.id)),
    h("div", { class: "rt" }, i.goal),
    h("div", { class: "faint", style: "font-size:13px" }, T("firstmate drafts a spec and raises a dispatch card; you answer it on the board. Nothing has been dispatched yet.",
      "firstmate 會寫 spec、開派工卡，由你在看板上點。目前還沒有派任何工作。")),
    h("div", {}, h("a", { class: "btn", href: `#/intents/${i.id}` }, T("Open intent", "打開意圖"))));
}

function msgView(m, i) {
  if (m.role === "captain") return h("div", { class: "msg me" }, h("div", { class: "bub" }, m.text));
  return h("div", { class: "msg fm", "data-msg": i },
    h("div", { class: "meta" }, "firstmate", m.provider ? h("span", { class: "vbadge" }, `${m.provider}${m.model ? " · " + m.model : ""}`) : null, m.ms ? h("span", {}, `${(m.ms / 1000).toFixed(1)} s`) : null),
    toolChips(m.tools),
    m.text ? h("div", { class: "bub" }, md(m.role === "firstmate" ? I18N.chatText(lang, m.text) : m.text)) : m.error ? null : h("div", { class: "typing", "aria-label": T("firstmate is answering", "firstmate 回答中") }, h("i"), h("i"), h("i")),
    m.intent ? intentCard(m.intent) : null,
    m.error ? h("div", { class: "rich chat-err", role: "alert" }, h("div", { class: "rk", style: "color:var(--bad)" }, icon("alert", "ic sm"), errTitle(m.error.code)),
      h("div", { style: "font-size:13px;color:var(--text-2)" }, m.error.message),
      m.error.code === "notLoggedIn" || m.error.code === "cliUnavailable" ? h("div", { class: "faint", style: "font-size:12px" },
        T("Run `claude` once in a terminal and log in, then ask again.", "請在終端機執行一次 `claude` 並登入，再問一次。")) : null) : null);
}
const errTitle = (c) => ({ timeout: T("No answer in time", "逾時沒有回答"), notLoggedIn: T("The claude CLI is not logged in", "claude CLI 尚未登入"),
  cliUnavailable: T("The claude CLI is not available", "找不到 claude CLI"), tooManyTools: T("Stopped: too many lookups", "已停止：查詢次數太多"),
  busy: T("firstmate is busy", "firstmate 忙線中"), cancelled: T("Cancelled", "已取消") }[c] || T("The answer failed", "回答失敗"));

function renderChat(stick = true) {
  const log = $("#chatLog");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.replaceChildren(...(CH.msgs.length ? CH.msgs.map(msgView) : [h("div", { class: "empty", style: "padding:24px 8px" }, icon("message"),
    h("b", {}, T("Ask firstmate how things stand", "問 firstmate 現在的狀況")),
    T("Answers come only from the event log, with links to the source. Say what you want done and it is recorded as an intent.",
      "回答只來自事件紀錄，並附來源連結。說出想做的事，會記成一個意圖。"))]));
  $("#chatSug").replaceChildren(...(CH.busy ? [] : SUG().map((s) => h("button", { class: "chip", type: "button", onclick: () => ask(s) }, s))));
  $("#chatSend").disabled = CH.busy;
  $("#chatIn").placeholder = T("Ask about the crew, or say what you want done", "問船員的狀況，或說出想做的事");
  $("#chatInLabel").textContent = T("Message Firstmate", "傳訊息給 Firstmate");
  if (stick || atBottom) log.scrollTop = log.scrollHeight;
}

async function ask(text) {
  text = String(text || "").trim();
  if (!text || CH.busy) return;
  openChat(true);
  const history = CH.msgs.filter((m) => m.text && !m.error).map((m) => ({ role: m.role, text: m.text })).slice(-8);
  CH.msgs.push({ role: "captain", text, ts: new Date().toISOString() });
  const reply = { role: "firstmate", text: "", tools: [], ts: new Date().toISOString() };
  CH.msgs.push(reply);
  CH.busy = true; renderChat(); saveChat();
  const ctrl = new AbortController(); CH.abort = ctrl;
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, history, lang: I18N.modelLang(lang) }), signal: ctrl.signal });
    if (!r.ok || !r.body) { const e = await r.json().catch(() => ({})); reply.error = { code: e.code || "cliError", message: e.error || `HTTP ${r.status}` }; }
    else {
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "", pend = false;
      const flush = () => { pend = false; renderChat(false); };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue;
          let e; try { e = JSON.parse(data.slice(6)); } catch { continue; }
          if (e.type === "start") { reply.provider = e.provider; reply.model = e.model; }
          else if (e.type === "text") reply.text += e.delta;
          else if (e.type === "tool") reply.tools.push({ id: e.id, name: e.name, args: e.args });
          else if (e.type === "toolResult") { const t = reply.tools.find((x) => x.id === e.id); if (t) { t.rows = e.rows; t.error = e.error; } }
          else if (e.type === "intent") reply.intent = e.intent;
          else if (e.type === "done") { reply.ms = e.ms; if (!reply.text) reply.text = e.text; }
          else if (e.type === "error") reply.error = { code: e.code, message: e.message };
          if (!pend) { pend = true; requestAnimationFrame(flush); }
        }
      }
    }
  } catch (e) { if (!reply.error) reply.error = { code: e?.name === "AbortError" ? "cancelled" : "cliError", message: String(e?.message || e) }; }
  if (!reply.text && !reply.error) reply.error = { code: "cliError", message: T("The answer ended without text.", "回答沒有內容就結束了。") };
  CH.busy = false; CH.abort = null; renderChat(); saveChat();
}

// ---------- chat panel: open, close, resize, widen ----------
const isPhone = () => innerWidth <= 1100;
function openChat(open) {
  document.body.classList.toggle("chat-closed", !open);
  if (!isPhone()) store.set("crew.chatOpen", open ? "1" : "0");
  if (open) { renderChat(); setTimeout(() => $("#chatIn")?.focus({ preventScroll: true }), 0); }
}
function setChatW(w, persist = true) {
  const side = $(".side")?.getBoundingClientRect().width || 232;
  const max = Math.max(360, Math.min(680, innerWidth - side - 480));
  const v = Math.max(360, Math.min(max, Number.isFinite(w) ? Math.round(w) : 400));
  document.documentElement.style.setProperty("--chat-w", v + "px");
  const grip = $("#chatGrip"); grip?.setAttribute("aria-valuemin", "360"); grip?.setAttribute("aria-valuemax", String(max)); grip?.setAttribute("aria-valuenow", String(v));
  if (persist) store.set("crew.chatW", String(v));
}
(function initChat() {
  // The cap follows the current window, so startup only clamps on screen: a narrow window must not overwrite the saved width.
  const w = Number(store.get("crew.chatW", "400")); if (w) setChatW(w, false);
  if (!isPhone() && store.get("crew.chatOpen", "1") === "1") document.body.classList.remove("chat-closed");
  $("#chatFab").addEventListener("click", () => openChat(true));
  $("#chatClose").addEventListener("click", () => openChat(false));
  $("#chatClear").addEventListener("click", () => { if (CH.busy) CH.abort?.abort(); CH.msgs = []; saveChat(); renderChat(); });
  $("#chatWide").addEventListener("click", () => document.body.classList.toggle("chat-wide"));
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#chatIn").value; $("#chatIn").value = ""; autosize(); ask(v); });
  const autosize = () => { const t = $("#chatIn"); t.style.height = "auto"; t.style.height = Math.min(160, t.scrollHeight) + "px"; };
  $("#chatIn").addEventListener("input", autosize);
  $("#chatIn").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#chatForm").requestSubmit(); } });
  addEventListener("resize", () => { if (!isPhone()) setChatW(Number(store.get("crew.chatW", "400")), false); });
  const grip = $("#chatGrip");
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    document.body.classList.remove("chat-wide");
    grip.setPointerCapture(e.pointerId); grip.classList.add("drag");
    const move = (ev) => setChatW(innerWidth - ev.clientX);
    const up = () => { grip.classList.remove("drag"); grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); grip.removeEventListener("lostpointercapture", up); };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up); grip.addEventListener("lostpointercapture", up);
  });
  grip.addEventListener("keydown", (e) => { const cur = $("#chat").offsetWidth; if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); document.body.classList.remove("chat-wide"); } if (e.key === "ArrowLeft") setChatW(cur + 20); if (e.key === "ArrowRight") setChatW(cur - 20); });
  // a citation inside the chat closes the sheet on a phone so the page it opens is visible
  $("#chatLog").addEventListener("click", (e) => { const a = e.target.closest("a.cite"); if (a && a.getAttribute("href").startsWith("#/") && isPhone()) openChat(false); });
  renderChat();
})();
// ---------- which model answers: shown in the header, chosen in a small settings dialog ----------
const CI = { info: null };
function showChatInfo() {
  const i = CI.info; if (!i) return;
  const sub = $("#chatSub");
  sub.textContent = `${i.provider} · ${i.model} · ${T("read-only", "唯讀")}`;
  sub.title = T(`Answered by ${i.provider} (${i.model}) from the event log; it cannot act for you`, `由 ${i.provider}（${i.model}）根據事件紀錄回答；不會替你動手`);
  $("#chatProv").title = T("Chat model settings", "對話模型設定");
}
window.onChatInfo = (i) => { CI.info = i; showChatInfo(); };
fetch("/api/settings").then((r) => r.json()).then(window.onChatInfo).catch(() => {});
$("#chatProv").addEventListener("click", () => {
  const i = CI.info || { provider: "claude", model: "", choices: ["claude", "codex"] };
  const sel = h("select", { class: "select", id: "provSel", "aria-label": T("Provider", "提供者") }, i.choices.map((c) => h("option", { value: c, selected: c === i.provider || null }, c)));
  const model = h("input", { class: "input", id: "provModel", placeholder: T("default model", "預設模型"), value: i.provider === sel.value ? (i.model.includes("default") || i.model === "no model" ? "" : i.model) : "" });
  sel.addEventListener("change", () => { model.value = ""; });
  modal(T("Chat model", "對話模型"), h("div", { style: "display:grid;gap:10px" },
    h("p", { class: "muted", style: "margin:0" }, T("Any provider works: each gets the same instructions and the same read-only Studio tools. Leave the model empty for the provider's default.",
      "任何提供者都可以：每個都拿到相同的指示和相同的唯讀 Studio 工具。模型留空就用該提供者的預設。")),
    h("label", { style: "display:grid;gap:4px;font-size:13px" }, T("Provider", "提供者"), sel),
    h("label", { style: "display:grid;gap:4px;font-size:13px" }, T("Model", "模型"), model)),
    async (close, btn) => {
      btn.disabled = true;
      const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: sel.value, model: model.value }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
      close();
      if (r.error) toast(r.error); else { window.onChatInfo(r); toast(T(`Chat now uses ${r.provider} · ${r.model}`, `對話改用 ${r.provider} · ${r.model}`)); }
    });
  $(".modal .btn.primary").textContent = T("Save", "儲存");
});
window.onLang = () => { renderChat(false); showChatInfo(); };

// ---------- intents ----------
const IN = { list: null };
const STEP = [["received", "Received", "已收到"], ["spec", "Spec drafted", "已寫 spec"], ["dispatch", "Dispatch card", "派工卡"], ["running", "Running", "執行中"], ["merged", "Merged", "已合併"]];
function trail(step, big) {
  const at = STEP.findIndex((s) => s[0] === step);
  const kids = [];
  STEP.forEach((s, i) => {
    if (i) kids.push(h("i", { class: `ln${i <= at ? " done" : ""}` }));
    const cls = i < at ? "done" : i === at ? (step === "merged" ? "fin" : step === "dispatch" ? "you" : "cur") : "";
    kids.push(h("span", { class: `s ${cls}`, "data-step": s[0] }, h("i", { class: "d" }), h("span", {}, T(s[1], s[2]))));
  });
  return h("div", { class: `trail${big ? " big" : " compact"}`, "aria-label": T(`Status: ${STEP[at]?.[1]}`, `狀態：${STEP[at]?.[2]}`) }, kids);
}
async function loadIntents() { try { IN.list = await fetch("/api/intents").then((r) => r.json()); } catch { IN.list = []; } if (["intents"].includes(S.route?.name)) render(); updateNav2(); }
window.onIntents = (list) => { IN.list = list; if (S.route?.name === "intents") soft(); updateNav2(); };
function updateNav2() { const n = (IN.list || []).filter((i) => i.step !== "merged" && !i.declined).length; const el = $("#navIntents"); if (el) el.textContent = n || ""; }
function viewIntents(id) {
  if (IN.list === null) { loadIntents(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:200px" })); }
  if (id) return intentPage(id);
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Intents", "意圖")),
      h("p", {}, T("What you asked for in the chat. firstmate turns each into a spec and a dispatch card; the trail follows the task through to its merge.",
        "你在對話裡交代的事。firstmate 把每一件寫成 spec 和派工卡，軌跡會一路跟到合併。"))),
      h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => { openChat(true); $("#chatIn").value = T("I want ", "我想要"); $("#chatIn").focus(); } }, icon("plus", "ic sm"), T("New intent", "新意圖")))),
    h("div", { class: "card ilist" },
      h("div", { class: "irow head" }, h("div", {}, "ID"), h("div", {}, T("Goal", "目標")), h("div", {}, T("Task", "任務")), h("div", {}, T("Status", "狀態")), h("div", {}, T("Asked", "時間"))),
      IN.list.length ? IN.list.map((i) => h("a", { class: "irow", href: `#/intents/${i.id}`, "data-intent-row": i.id, style: "text-decoration:none" },
        h("span", { class: "iid" }, i.id), h("span", { style: "min-width:0;overflow-wrap:anywhere" }, i.goal),
        h("span", {}, i.tasks.length ? i.tasks.map((t) => h("span", { class: "tid", style: "margin-right:6px" }, t.task)) : h("span", { class: "faint" }, i.declined ? T("declined", "未接") : T("not yet", "尚未"))),
        trail(i.step), h("span", { class: "faint", style: "font-size:12px" }, ago(i.ts))))
        : h("div", { class: "empty" }, icon("target"), h("b", {}, T("No intents yet", "還沒有意圖")), T("Tell firstmate in the chat what you want done.", "在對話裡告訴 firstmate 你想做什麼。"))));
}
function intentPage(id) {
  const i = IN.list.find((x) => x.id === id);
  if (!i) return h("div", { class: "page" }, h("div", { class: "card" }, h("div", { class: "empty" }, h("b", {}, T("No such intent", "找不到這個意圖")), h("a", { href: "#/intents" }, T("All intents", "全部意圖")))));
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("span", { class: "iid", style: "font-size:15px;margin-right:8px" }, i.id), i.goal),
      h("p", {}, T(`Asked ${ago(i.ts)} from the ${i.source}`, `${ago(i.ts)}從${i.source === "chat" ? "對話" : i.source}提出`))), h("a", { class: "btn", href: "#/intents" }, T("All intents", "全部意圖"))),
    h("div", { class: "card", style: "padding:18px 20px;overflow-x:auto" }, trail(i.step, true)),
    h("div", { class: "card", style: "padding:16px 20px;display:grid;gap:10px" },
      i.details ? kv2(T("Details", "細節"), i.details) : null, i.constraints ? kv2(T("Constraints", "限制"), i.constraints) : null,
      i.deadline ? kv2(T("Deadline", "期限"), i.deadline) : null, i.budget ? kv2(T("Budget", "預算"), i.budget) : null,
      i.text && i.text !== i.goal ? kv2(T("Your words", "你的原話"), i.text) : null),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Tasks", "任務"))),
      i.tasks.length ? h("div", { class: "card", style: "display:grid" }, i.tasks.map((t) => h("div", { class: "lib-row" },
        h("div", { class: "run-t" }, h("a", { class: "tid", href: `#/task/${t.task}` }, t.task), h("span", {}, t.title || "")), trail(t.step), lineageChain(t.lineage))))
        : h("div", { class: "card" }, h("div", { class: "empty" }, icon("clock"), h("b", {}, i.declined ? T("firstmate declined this intent", "firstmate 沒有接這個意圖") : T("Waiting for firstmate to draft a spec", "等 firstmate 寫 spec")),
          i.declined ? i.declined.reason || "" : T("firstmate picks captured intents up from data/intents.jsonl, writes the spec, links it here and raises the dispatch card.",
            "firstmate 從 data/intents.jsonl 讀取意圖，寫好 spec 後會連結到這裡並開派工卡。")))));
}
const kv2 = (k, v) => h("div", { style: "display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px;font-size:14px" }, h("span", { class: "faint" }, k), h("span", { style: "white-space:pre-wrap;overflow-wrap:anywhere" }, v));

// ---------- lineage chain, shared by the Library, task and intent pages ----------
function lineageChain(l, merged) {
  if (!l) return h("span", { class: "faint", style: "font-size:12px" }, T("No lineage: the task is older than the event window.", "沒有來歷：任務早於事件紀錄的範圍。"));
  const repo = S.github?.repo || "unknown/unknown";
  const step = (ic, b, sub, href, ext) => h("a", { class: "lstep", href, target: ext ? "_blank" : null, rel: ext ? "noopener" : null }, h("b", {}, b), h("span", {}, sub));
  const arrow = () => icon("chev", "ic sm");
  const parts = [];
  if (l.dispatch) parts.push(step("human", l.dispatch.id.replace(/^D-[a-z-]+-/, "D-…"), T(`dispatch ${l.dispatch.chosen} · ${ago(l.dispatch.ts)}`, `派工 ${l.dispatch.chosen} · ${ago(l.dispatch.ts)}`), `#/event/${l.dispatch.seq}`));
  else parts.push(h("span", { class: "lstep", style: "cursor:default" }, h("b", {}, T("dispatch", "派工")), h("span", {}, T("not in the window", "不在紀錄範圍"))));
  const ap = l.reviews.filter((r) => r.verdict === "APPROVE").length, rj = l.reviews.length - ap;
  parts.push(arrow(), step("crew", T(`${l.rounds || "?"} round${l.rounds === 1 ? "" : "s"}`, `${l.rounds || "?"} 回合`), T(`${ap} approve · ${rj} reject`, `${ap} 次通過 · ${rj} 次退件`), `#/task/${l.task}`));
  if (merged?.checks) parts.push(arrow(), h("a", { class: "lstep", href: merged.url + "/checks", target: "_blank", rel: "noopener" }, h("b", {}, "CI"),
    h("span", {}, merged.checks.fail ? T(`${merged.checks.fail} failed`, `${merged.checks.fail} 項失敗`) : T(`${merged.checks.pass} passed`, `${merged.checks.pass} 項通過`))));
  if (l.merge) parts.push(arrow(), step("pr", l.merge.id.replace(/^D-[a-z-]+-/, "D-…"), T(`merge ${l.merge.chosen} by ${l.merge.by} · ${ago(l.merge.ts)}`, `合併 ${l.merge.chosen}（${l.merge.by}）· ${ago(l.merge.ts)}`), `#/event/${l.merge.seq}`));
  if (l.merged) parts.push(arrow(), merged?.commit ? h("a", { class: "lstep", href: `https://github.com/${repo}/commit/${merged.commit}`, target: "_blank", rel: "noopener" }, h("b", {}, merged.commit.slice(0, 8)), h("span", {}, T(`merged ${ago(l.merged.ts)}`, `${ago(l.merged.ts)}合併`)))
    : step("check", l.merged.pr ? `#${l.merged.pr}` : T("merged", "已合併"), T(`merged ${ago(l.merged.ts)}`, `${ago(l.merged.ts)}合併`), `#/event/${l.merged.seq}`));
  return h("div", { class: "lineage", "data-lineage": l.task }, parts);
}

// ---------- library ----------
const LB = { data: null, kind: store.get("crew.libKind", "all"), range: store.get("crew.libRange", "30") };
async function loadLibrary() { try { LB.data = await fetch("/api/library").then((r) => r.json()); } catch { LB.data = { code: [], files: [] }; } if (S.route?.name === "library") render(); }
function viewLibrary() {
  if (!LB.data) { loadLibrary(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:240px" })); }
  const cutoff = LB.range === "all" ? "" : new Date(Date.now() - Number(LB.range) * 86400e3).toISOString();
  const inRange = (ts) => !cutoff || (ts || "") >= cutoff;
  const code = LB.kind === "all" || LB.kind === "code" ? LB.data.code.filter((x) => inRange(x.ts)) : [];
  const files = LB.data.files.filter((x) => (LB.kind === "all" || LB.kind === x.kind) && (inRange(x.ts) || !x.ts));
  const seg = (vals, cur, set) => h("div", { class: "seg", role: "group" }, vals.map(([v, en, tw]) => h("button", { "aria-pressed": String(cur === v), "data-filter": v, onclick: () => set(v) }, h("span", {}, T(en, tw)))));
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Library", "成品庫")),
      h("p", {}, T("Delivered work and how it got here: the cards you answered, the rounds and reviews, CI and the merge.", "已交付的成果和它的來歷：你點過的卡、回合和審查、CI、合併。"))),
      h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => { LB.data = null; render(); } }, icon("refresh", "ic sm"), T("Refresh", "重新整理")))),
    h("div", { class: "filters" },
      seg([["all", "All", "全部"], ["code", "Code", "程式碼"], ["video", "Video", "影片"], ["web", "Web", "網頁"]], LB.kind, (v) => { LB.kind = v; store.set("crew.libKind", v); render(); }),
      seg([["7", "7 days", "7 天"], ["30", "30 days", "30 天"], ["all", "All time", "全部"]], LB.range, (v) => { LB.range = v; store.set("crew.libRange", v); render(); }),
      LB.data.github && !LB.data.github.ok ? h("span", { class: "ghbar bad" }, icon("github", "ic sm"), T("GitHub unavailable; showing the last list", "GitHub 連不上，顯示上次的清單")) : null),
    files.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Files", "檔案")), h("span", { class: "faint" }, String(files.length))),
      h("div", { class: "libgrid" }, files.map(fileCard))) : null,
    code.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Merged code", "已合併的程式碼")), h("span", { class: "faint" }, String(code.length))),
      h("div", { class: "card", style: "display:grid" }, code.map(codeRow))) : null,
    !files.length && !code.length ? h("div", { class: "card" }, h("div", { class: "empty" }, icon("library"), h("b", {}, T("Nothing matches", "沒有符合的成品")), T("Try another type or a longer time range.", "換個類型或拉長時間範圍。"))) : null);
}
function fileCard(f) {
  return h("div", { class: "card lib", "data-file": f.id },
    h("div", { class: "lprev", style: f.kind === "video" ? "height:auto;background:#000" : "display:grid;place-items:center" },
      f.kind === "video" && f.playable ? h("video", { src: f.url, controls: true, preload: "metadata", playsinline: true, style: "display:block;width:100%;aspect-ratio:16/9;background:#000" })
        : h("div", { class: "faint", style: "display:grid;justify-items:center;gap:8px" }, icon(f.kind === "web" ? "monitor" : f.kind === "video" ? "film" : "doc", "ic lg"), f.kind === "video" ? T("file not found", "找不到檔案") : f.kind)),
    h("div", { class: "lbody" },
      h("div", { class: "t" }, f.title), f.note ? h("div", { class: "faint", style: "font-size:13px" }, f.note) : null,
      h("div", { class: "run-s" }, h("span", { class: "vbadge" }, f.kind), f.ts ? h("span", {}, ago(f.ts)) : null,
        h("span", {}, f.approvedBy ? T(`approved by ${f.approvedBy}`, `${f.approvedBy} 已核准`) : T("not yet approved", "尚未核准"))),
      f.external ? h("div", {}, h("a", { class: "btn", href: f.url, target: "_blank", rel: "noopener" }, icon("link", "ic sm"), T("Open", "打開"))) : null));
}
function codeRow(x) {
  return h("div", { class: "lib-row", "data-pr": x.pr },
    h("div", { class: "run-t" }, x.task ? h("a", { class: "tid", href: `#/task/${x.task}` }, x.task) : null, h("span", { style: "min-width:0;overflow-wrap:anywhere" }, x.title)),
    h("div", { class: "run-s" }, doorBadge(x.door), h("a", { href: x.url, target: "_blank", rel: "noopener" }, `#${x.pr}`), h("span", {}, T(`merged ${ago(x.ts)}`, `${ago(x.ts)}合併`)),
      x.intent ? h("a", { href: `#/intents/${x.intent}` }, x.intent) : null),
    lineageChain(x.lineage, x));
}

// ---------- task and event pages (where answers link) ----------
const TK = { id: null, data: null };
async function loadTask(id) { try { const r = await fetch(`/api/task/${encodeURIComponent(id)}`); TK.data = r.ok ? await r.json() : { error: true }; } catch { TK.data = { error: true }; } if (S.route?.name === "task" && TK.id === id) render(); }
function viewTask(id) {
  id = String(id || "").toUpperCase();
  if (TK.id !== id) { TK.id = id; TK.data = null; loadTask(id); }
  const d = TK.data;
  if (!d) return h("div", { class: "page" }, h("div", { class: "skel", style: "height:260px" }));
  if (d.error) return h("div", { class: "page" }, h("div", { class: "card" }, h("div", { class: "empty" }, h("b", {}, T(`${id} is not in the log`, `紀錄裡沒有 ${id}`)))));
  const t = d.task;
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("span", { class: "tid", style: "font-size:15px;margin-right:8px" }, d.id), d.title || ""),
      h("p", { class: "run-s", style: "font-size:13px" }, doorBadge(d.door?.door), t ? statusBadge(t.status) : null, t?.pr || d.lineage.merged?.pr ? h("a", { href: prUrl(t?.pr || d.lineage.merged.pr), target: "_blank", rel: "noopener" }, `#${t?.pr || d.lineage.merged.pr}`) : null,
        t?.round ? h("span", {}, T(`round ${t.round}`, `第 ${t.round} 回合`)) : null, t?.currentActor ? h("a", { href: `#/crew/${encodeURIComponent(t.currentActor)}` }, t.currentActor) : null,
        d.intent ? h("a", { href: `#/intents/${d.intent}` }, d.intent) : null)),
      h("div", { class: "actions" }, h("a", { class: "btn", href: `#/activity/${d.id}` }, icon("activity", "ic sm"), T("All events", "全部事件")), h("button", { class: "btn ghost", onclick: () => { TK.id = null; render(); } }, icon("refresh", "ic sm")))),
    d.door?.reason ? h("div", { class: "card", style: "padding:12px 16px;font-size:14px" }, h("b", {}, T("Change type: ", "改動類型：")), d.door.door || "—", " — ", d.door.reason) : null,
    d.pending.length ? h("div", { class: "card needs" }, d.pending.map((c) => h("div", { class: "need" }, h("div", { class: "need-ic", style: "background:var(--human-soft);color:var(--human)" }, icon("human")),
      h("div", {}, h("div", { class: "need-t" }, c.title)), h("div", { class: "need-r" }, h("a", { class: "btn", href: `#/inbox/${encodeURIComponent(c.id)}` }, T("Open", "打開")))))) : null,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Lineage", "來歷"))), h("div", { class: "card", style: "padding:14px 16px" }, lineageChain(d.lineage))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Events", "事件")), h("span", { class: "faint" }, String(d.events.length))),
      h("div", { class: "card evlist" }, d.events.map((e) => evRow(e)))));
}
const EV = { seq: null, data: null };
async function loadEvent(seq) { try { const r = await fetch(`/api/event/${seq}`); EV.data = r.ok ? await r.json() : { error: true }; } catch { EV.data = { error: true }; } if (S.route?.name === "event") { render(); $(`.ev.hl`)?.scrollIntoView({ block: "center" }); } }
function viewEvent(seq) {
  if (EV.seq !== seq) { EV.seq = seq; EV.data = null; loadEvent(seq); }
  const d = EV.data;
  if (!d) return h("div", { class: "page" }, h("div", { class: "skel", style: "height:260px" }));
  if (d.error) return h("div", { class: "page" }, h("div", { class: "card" }, h("div", { class: "empty" }, h("b", {}, T("No such event", "沒有這筆事件")))));
  const e = d.event;
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("span", { class: "evt" }, e.type), " · ", clock(e.ts)),
      h("p", {}, L(e.summary))), h("div", { class: "actions" }, e.task ? h("a", { class: "btn", href: `#/task/${e.task}` }, e.task) : null)),
    h("div", { class: "card", style: "padding:12px 16px;display:grid;gap:6px;font-size:13px" },
      kv2("seq", String(e.seq)), kv2(T("Time", "時間"), e.ts), kv2("actor", e.actor), e.task ? kv2(T("Task", "任務"), e.task) : null, e.pr ? kv2("PR", `#${e.pr}`) : null,
      e.decision ? kv2(T("Card", "卡"), `${e.decision} → ${e.chosen || "—"}${e.effect ? ` (${e.effect})` : ""}`) : null),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Around it", "前後事件"))),
      h("div", { class: "card evlist" }, d.around.map((x) => { const r = evRow(x); if (x.seq === e.seq) r.classList.add("hl"); return r; }))));
}

Object.assign(routes, { intents: viewIntents, library: viewLibrary, task: viewTask, event: (a) => viewEvent(Number(a)) });
loadIntents();
addEventListener("hashchange", () => { if (S.route?.name === "library" && LB.data && Date.now() - (LB.t || 0) > 60_000) { LB.t = Date.now(); loadLibrary(); } });
