// Transcripts: for every agent invocation, the exact prompt (with the brief it
// was bound to), what it did, and its report. Crew rounds (#/crew/<actor>),
// the Firstmate page's session history, and Runs' agent nodes
// (#/runs/node/<run>/<node>/<round>). Loaded after takeover.js. No sidebar entry.
(() => {
const TR = { key: null, inv: null, entries: [], next: 0, tab: "prompt", promptMode: "sections", report: null, timer: null, open: new Set(), all: new Set(),
  hist: null, histBusy: false, nodes: null, err: null };
const fmtT = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "");
const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} KB` : `${n} B`);
const PREVIEW = 2000;
const apiBase = (src) => (src.kind === "crew" ? `/api/crew/${encodeURIComponent(src.actor)}` : `/api/node-runs/${[src.run, src.node, src.round].map(encodeURIComponent).join("/")}`);
const same = (src) => TR.key === JSON.stringify(src);

// Every async answer is applied only to the view it was asked for. TR.gen names that view: it changes on a new
// round, a switch of invocation, or a follow. A response that comes back under another generation is dropped.
const bump = () => { TR.gen = (TR.gen || 0) + 1; clearTimeout(TR.timer); TR.timer = null; return TR.gen; };
const current = (src, gen) => same(src) && TR.gen === gen;

async function load(src) {
  const key = JSON.stringify(src);
  if (TR.key !== key) Object.assign(TR, { key, inv: null, entries: [], next: 0, attempt: null, live: false, prompt: src.prompt ?? null, follow: !src.prompt, report: null, err: null, open: new Set(), all: new Set(), tab: src.tab ?? "prompt", promptMode: "sections", phoneSummary: null });
  const gen = bump();
  try {
    const inv = await getJ(src.kind === "crew" ? `${apiBase(src)}/invocation` : `${apiBase(src)}${TR.prompt ? `?prompt=${encodeURIComponent(TR.prompt)}` : ""}`);
    if (!current(src, gen)) return;
    if (inv.error) TR.err = inv.error; else TR.inv = inv;
    if (src.kind === "node") { TR.report = inv.report; TR.prompt = inv.promptName || TR.prompt; }
  } catch (e) { if (!current(src, gen)) return; TR.err = String(e); }
  rerender(src);
  tail(src, gen);
}
/** Show one invocation of a node round (an attempt or a hand-off): its own prompt, transcript and report.
 *  `follow` keeps the view on the newest invocation as new attempts start. */
async function switchInvocation(name, follow) {
  const src = JSON.parse(TR.key);
  const gen = bump();
  Object.assign(TR, { prompt: name, follow, entries: [], next: 0, report: null, open: new Set(), all: new Set() });
  try { const inv = await getJ(`${apiBase(src)}?prompt=${encodeURIComponent(name)}`); if (!current(src, gen)) return; if (!inv.error) { TR.inv = inv; TR.report = inv.report; } } catch { if (!current(src, gen)) return; }
  render(); tail(src, gen);
}
function invocationBar(inv) {
  const list = inv?.invocations || [];
  if (list.length < 2) return null;
  const newest = list.at(-1).name;
  return h("div", { class: "tr-row tr-invs", role: "group", "aria-label": T("Attempts and hand-offs of this round", "這個回合的每次嘗試與交接") },
    h("span", { class: "faint" }, T("Invocation", "呼叫")),
    h("div", { class: "seg" }, list.map((x) => h("button", { "data-invocation": x.name, "aria-pressed": String(TR.prompt === x.name), onclick: () => switchInvocation(x.name, x.name === newest) },
      h("span", { class: "keep" }, `${T("attempt", "嘗試")} ${x.attempt}${x.hop ? ` · ${T("hand-off", "交接")} ${x.hop}` : ""}${x.name === newest ? " ●" : ""}`)))),
    TR.follow ? h("span", { class: "faint", "data-following": "1" }, T("following the newest", "跟著最新的")) : null);
}
async function tail(src, gen) {
  if (!current(src, gen)) return;
  clearTimeout(TR.timer); TR.timer = null;
  try {
    const q = `after=${encodeURIComponent(TR.next)}${TR.attempt ? `&attempt=${encodeURIComponent(TR.attempt)}` : ""}${src.kind === "node" && TR.prompt ? `&prompt=${encodeURIComponent(TR.prompt)}` : ""}`;
    const r = await getJ(`${apiBase(src)}/transcript?${q}`);
    if (!current(src, gen)) return; // asked for another view (another round, invocation or cursor): drop it
    // a newer attempt or hand-off started: the live view moves to it
    if (src.kind === "node" && r.newest && TR.prompt && r.newest !== TR.prompt && TR.follow) { switchInvocation(r.newest, true); return; }
    // a new crew attempt (a retry) has its own file: its offset starts again, and its entries replace the old ones
    if (r.reset) { TR.entries = []; TR.open = new Set(); TR.all = new Set(); if (TR.tab === "transcript") render(); }
    if (r.attempt) TR.attempt = r.attempt;
    if (r.entries?.length) { TR.entries.push(...r.entries); if (TR.tab === "transcript") appendEntries(r.entries); }
    if (typeof r.next === "number" || typeof r.next === "string") TR.next = r.next; // a node's shared stream uses "<offset>|<owner>"
    if (r.phone) TR.phoneSummary = r.summary;
    TR.live = r.live === true;
  } catch { if (!current(src, gen)) return; TR.live = false; }
  // poll only while the server says the round runs (its process lives, or its run is running)
  if (current(src, gen) && TR.live) TR.timer = setTimeout(() => tail(src, gen), 1500);
}
function rerender(src) { if (same(src) && (S.route?.name === "crew" || S.route?.name === "runs")) render(); }

// ---------- the three tabs ----------
function detail(src) {
  if (!same(src)) load(src);
  const inv = TR.inv;
  const id = inv?.identity || {};
  const title = src.kind === "crew" ? src.actor : `${src.run} · ${src.node} · ${T(`Round ${src.round}`, `第 ${src.round} 回合`)}`;
  const tabs = [["prompt", T("Prompt", "提示詞")], ["transcript", T("Transcript", "對話紀錄")], ["report", T("Report", "報告")]];
  const tabBar = h("div", { class: "seg tr-tabs", role: "tablist" }, tabs.map(([k, l]) => h("button", { role: "tab", "data-tab": k, "aria-selected": String(TR.tab === k), "aria-pressed": String(TR.tab === k),
    onclick: () => { TR.tab = k; render(); if (k === "report") loadReport(src); } }, h("span", { class: "keep" }, l))));
  const body = TR.err ? h("div", { class: "card err tr-pad" }, TR.err) : !inv ? h("div", { class: "skel", style: "height:240px" })
    : TR.tab === "prompt" ? promptTab(inv) : TR.tab === "transcript" ? transcriptTab() : reportTab(src);
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", { class: "tr-h1" }, title),
      h("p", {}, [id.role, id.task, id.round ? T(`round ${id.round}`, `第 ${id.round} 回合`) : null, id.vendor && `${id.vendor}${id.model ? " · " + id.model : ""}`, inv?.attempt].filter(Boolean).join(" · "))),
      h("div", { class: "actions" }, src.kind === "crew" && id.task ? h("a", { class: "btn", href: `#/activity/${id.task}` }, icon("activity", "ic sm"), T("Task activity", "任務事件")) : null,
        h("a", { class: "btn ghost", href: src.kind === "crew" ? "#/crew" : "#/runs" }, T("Back", "返回")))),
    src.kind === "node" ? invocationBar(inv) : null, tabBar, body, MS.me?.kind === "phone" ? null : phoneSetting());
}
function phoneSetting() {
  // TR.phoneRaw: undefined = not read yet, "loading", true/false = what the server holds; TR.phoneErr = the last failure
  if (TR.phoneRaw === undefined) readPhoneSetting();
  const known = TR.phoneRaw === true || TR.phoneRaw === false;
  return h("div", { class: "tr-set faint" },
    h("label", { class: "tr-row" }, h("input", { type: "checkbox", checked: TR.phoneRaw === true || null, disabled: !known || null, onchange: async (e) => {
      const prev = TR.phoneRaw, want = e.target.checked;
      const seq = TR.setSeq = (TR.setSeq || 0) + 1; // only the last change's answer is applied
      let r; try { r = await postJ("/api/transcripts/settings", { phoneRaw: want }); } catch (x) { r = { error: String(x) }; }
      if (seq !== TR.setSeq) return;
      if (r.error || typeof r.phoneRaw !== "boolean") { TR.phoneRaw = prev; TR.phoneErr = r.error || T("Studio did not save the setting", "Studio 沒有存下這個設定"); }
      else { TR.phoneRaw = r.phoneRaw; TR.phoneErr = null; }
      render(); } }),
      T("Paired phones may read prompts and transcripts (off: phones see a summary)", "允許已配對的手機看提示詞和對話紀錄（關閉時手機只看摘要）")),
    TR.phoneErr ? h("span", { class: "err", "data-phone-setting-error": "1" }, T(`Setting unavailable: ${TR.phoneErr}`, `設定無法使用：${TR.phoneErr}`),
      known ? null : h("button", { class: "btn ghost", "data-phone-setting-retry": "1", onclick: () => { TR.phoneErr = null; readPhoneSetting(); } }, T("Retry", "重試"))) : null);
}
function readPhoneSetting() {
  const prev = TR.phoneRaw === "loading" ? undefined : TR.phoneRaw;
  TR.phoneRaw = "loading";
  const seq = TR.setSeq = (TR.setSeq || 0) + 1;
  getJ("/api/transcripts/settings").then((s) => {
    if (seq !== TR.setSeq) return;
    if (typeof s?.phoneRaw !== "boolean") throw new Error(s?.error || "no setting in the answer");
    TR.phoneRaw = s.phoneRaw; TR.phoneErr = null; render();
  }).catch((e) => { if (seq !== TR.setSeq) return; TR.phoneRaw = prev === undefined ? null : prev; TR.phoneErr = String(e?.message || e); render(); });
}
function phoneNote(sum) {
  return h("div", { class: "card tr-pad", "data-phone-summary": "1" }, h("b", {}, T("Summary only on a phone", "手機只顯示摘要")),
    h("p", { class: "faint" }, T("The raw prompt and transcript stay on the Mac unless it allows phones to read them.", "原始提示詞和對話紀錄只在 Mac 上看，除非 Mac 允許手機讀取。")),
    sum ? h("ul", { class: "ilist2" }, (sum.sections || []).map((s) => h("li", {}, `${s.label} · ${kb(s.bytes)}${s.binding ? ` · ${T("round", "第")} ${s.binding.round} · ${s.binding.head}` : ""}`))) : null);
}
function promptTab(inv) {
  if (!inv.prompt) return inv.phone ? phoneNote(inv.summary) : h("div", { class: "card tr-pad faint" }, T("This invocation has no prompt.md.", "這次呼叫沒有 prompt.md。"));
  const p = inv.prompt;
  const mode = h("div", { class: "seg", role: "group" }, [["sections", T("Sections", "分段")], ["raw", T("Raw", "原文")]].map(([k, l]) =>
    h("button", { "aria-pressed": String(TR.promptMode === k), "data-mode": k, onclick: () => { TR.promptMode = k; render(); } }, h("span", { class: "keep" }, l))));
  const hops = null; // a node round's attempts and hand-offs are chosen above the tabs (invocationBar)
  const head = h("div", { class: "tr-row" }, mode, hops, h("span", { class: "faint" }, `${inv.promptName || "prompt.md"} · ${kb(p.bytes)} · ${p.sections.length} ${T("sections", "段")}`),
    h("button", { class: "btn ghost", onclick: () => navigator.clipboard?.writeText(p.raw).then(() => toast(T("Copied", "已複製"))) }, icon("copy", "ic sm"), T("Copy", "複製")));
  if (TR.promptMode === "raw") return h("div", { class: "card tr-pad" }, head, h("pre", { class: "tr-raw", "data-raw-prompt": "1" }, p.raw));
  const secs = inv.system != null ? [...p.sections, { kind: "system", label: T("System prompt", "系統提示詞"), text: inv.system }] : p.sections;
  return h("div", { class: "card tr-pad" }, head, h("div", { class: "tr-secs" }, secs.map((s, i) => {
    const b = s.binding;
    return h("details", { class: `tr-sec k-${s.kind}`, "data-section": s.kind, open: s.kind === "brief" || s.kind === "task" || s.kind === "dispatch" || s.kind === "header" || null },
      h("summary", {}, h("span", { class: `badge ${s.kind === "brief" || s.kind === "header" ? "human" : ""}` }, s.label), h("span", { class: "faint" }, kb(new Blob([s.text]).size)),
        b ? h("span", { class: "tr-bind", "data-binding": "1" }, T("round ", "第 "), h("b", { "data-bind-round": b.round }, String(b.round)), T(" · head ", " 回合 · head "), h("code", { "data-bind-head": b.head }, b.head.slice(0, 12))) : null),
      s.kind === "header" && inv.prompt?.header ? h("div", { class: "tr-brief", "data-record-header": "1" }, Object.entries(inv.prompt.header).map(([k, v]) =>
        h("div", {}, h("b", {}, `${k}: `), h("code", {}, typeof v === "string" ? v : JSON.stringify(v))))) : null,
      s.kind === "brief" ? h("div", { class: "tr-brief" }, b ? [
        h("div", {}, h("b", {}, T("Brief file: ", "brief 檔：")), h("code", {}, b.file || T("(no file with the same text)", "（找不到同內容的檔案）"))),
        h("div", {}, h("b", {}, T("Evidence record: ", "證據紀錄：")), h("code", {}, b.record)),
        h("div", {}, h("b", {}, T("Bound to: ", "綁定：")), T(`round ${b.round}, head `, `第 ${b.round} 回合，head `), h("code", {}, b.head), b.time ? ` · ${b.time}` : ""),
        b.carried ? h("div", { class: "faint" }, b.carried) : null] : h("div", { class: "faint" }, T("No matching brief record was found in firstmate's evidence.", "在 firstmate 的證據裡找不到對應的 brief 紀錄。"))) : null,
      h("pre", { class: "tr-raw" }, s.text));
  })));
}
function entryNode(e, i) {
  const t = e.t ? h("span", { class: "tr-t" }, fmtT(e.t)) : h("span", { class: "tr-t" });
  // a model's own words read like a Firstmate reply: 简体中文 converts them for display (i18n.js); code and raw output stay as written
  if (e.kind === "text") return h("div", { class: "tr-e text", "data-entry": "text" }, t, h("div", { class: "tr-body md" }, md(window.crewI18n && typeof lang !== "undefined" ? window.crewI18n.chatText(lang, e.text) : e.text)));
  if (e.kind === "tool") {
    const a = e.args || {}; const main = a.command ?? a.file_path ?? a.pattern ?? a.url ?? a.description ?? "";
    return h("div", { class: "tr-e tool", "data-entry": "tool" }, t, h("div", { class: "tr-body" }, h("b", {}, "▸ ", e.name), " ", h("code", {}, String(main).slice(0, 300)),
      h("details", { class: "tr-args" }, h("summary", { class: "faint" }, T("arguments", "參數")), h("pre", {}, JSON.stringify(a, null, 2)))));
  }
  if (e.kind === "toolResult") {
    const k = `${e.toolId}:${i}`, all = TR.all.has(k), body = e.body || "";
    const shown = all ? body : body.slice(0, PREVIEW);
    return h("div", { class: `tr-e result${e.isError ? " err" : ""}`, "data-entry": "toolResult" }, t, h("details", { class: "tr-res", "data-result": k, open: TR.open.has(k) || null,
      ontoggle: (ev) => { ev.target.open ? TR.open.add(k) : TR.open.delete(k); } },
      h("summary", {}, e.isError ? "✗ " : "✓ ", T("result", "結果"), h("span", { class: "faint" }, ` · ${kb(e.size ?? body.length)}`)),
      h("pre", { "data-result-body": "1" }, shown),
      body.length > PREVIEW && !all ? h("button", { class: "btn ghost", "data-expand": "1", onclick: () => { TR.all.add(k); TR.open.add(k); render(); } }, T(`Show all ${kb(body.length)}`, `顯示全部 ${kb(body.length)}`)) : null,
      e.truncated ? h("div", { class: "faint" }, T(`Cut at ${kb(body.length)} of ${kb(e.size)}.`, `只顯示 ${kb(e.size)} 中的前 ${kb(body.length)}。`)) : null));
  }
  return h("div", { class: `tr-e ${e.kind}`, "data-entry": e.kind }, t, h("div", { class: "tr-body faint" }, e.kind === "result" ? "✓ " : e.kind === "error" ? "✗ " : "", e.text));
}
function transcriptTab() {
  if (TR.phoneSummary) return phoneNote(null);
  return h("div", { class: "card tr-pad" }, h("div", { class: "tr-row" }, h("span", { class: "faint", id: "trCount" }, T(`${TR.entries.length} entries`, `${TR.entries.length} 筆`)),
    h("span", { class: "faint" }, TR.live ? T("live: updates while the round runs", "執行中：即時更新") : T("ended", "已結束"))),
    h("div", { class: "tr-list", id: "trList" }, TR.entries.map(entryNode)));
}
function appendEntries(es) {
  const list = $("#trList"); if (!list) return;
  const base = TR.entries.length - es.length;
  const nearBottom = innerHeight + scrollY >= document.body.scrollHeight - 200;
  es.forEach((e, j) => list.append(entryNode(e, base + j)));
  hydrateIcons(list); const c = $("#trCount"); if (c) c.textContent = T(`${TR.entries.length} entries`, `${TR.entries.length} 筆`);
  if (nearBottom) $("#main").scrollTop = $("#main").scrollHeight;
}
async function loadReport(src) {
  if (src.kind !== "crew" || TR.report != null) return;
  const gen = TR.gen;
  const r = await getJ(`/api/crew/${encodeURIComponent(src.actor)}/report`).catch(() => ({}));
  if (!current(src, gen)) return; TR.report = r.text ?? ""; render();
}
function reportTab(src) {
  if (src.kind === "crew" && TR.report == null) { loadReport(src); return h("div", { class: "skel", style: "height:120px" }); }
  const r = TR.report;
  if (r && typeof r === "object") return h("div", { class: "card tr-pad", "data-report": "1" },
    h("div", { class: "tr-row" }, h("span", { class: `badge ${r.status === "done" ? "ok" : r.status === "failed" ? "bad" : ""}`, "data-job-status": r.status || "" }, ({ done: T("Done", "完成"), failed: T("Failed", "失敗"), cancelled: T("Cancelled", "已取消"), timeout: T("Timed out", "逾時"), running: T("Running", "進行中") })[r.status] || r.status || "—"),
      r.tools != null ? h("span", { class: "faint" }, T(`${r.tools} tool calls`, `${r.tools} 次工具呼叫`)) : null, r.cost != null ? h("span", { class: "faint" }, `$${Number(r.cost).toFixed(3)}`) : null),
    r.error ? h("div", { class: "err" }, String(r.error)) : null, r.said ? h("div", { class: "md" }, md(String(r.said))) : null);
  return r ? h("div", { class: "card tr-pad md", "data-report": "1" }, md(r)) : h("div", { class: "card tr-pad faint" }, T("No report yet.", "還沒有報告。"));
}

// ---------- routes ----------
const crewBase = routes.crew;
routes.crew = (arg) => (arg ? detail({ kind: "crew", actor: arg }) : crewBase(arg));
addEventListener("hashchange", () => { if (!/^#\/(?:crew\/[^/]+|(?:runs|tasks)\/node\/)/.test(location.hash)) { clearTimeout(TR.timer); TR.key = null; } });

// the Firstmate page: the session's history under the takeover controls
async function loadHistory(older) {
  if (TR.histBusy) return; TR.histBusy = true;
  const hgen = TR.histGen = older ? (TR.histGen || 0) : (TR.histGen || 0) + 1, base = TR.hist;
  try {
    const q = older && base ? `?before=${base.cursor}` : "";
    const r = await getJ(`/api/firstmate/history${q}`);
    // a page is joined only onto the history it was asked for ("Newest" starts a new one)
    if (hgen === TR.histGen && (!older || TR.hist === base)) TR.hist = older && base ? { ...r, entries: [...r.entries, ...base.entries] } : r;
  } catch (e) { if (hgen === TR.histGen) TR.hist = { entries: [], error: String(e) }; }
  TR.histBusy = false;
  if (S.route?.name === "firstmate" || S.route?.name === "takeover") render();
}
function historyCard() {
  if (!TR.hist) { loadHistory(false); return h("section", { class: "card tr-pad", "data-section": "history" }, h("div", { class: "skel", style: "height:120px" })); }
  const hh = TR.hist;
  if (hh.phone) return h("section", { class: "card tr-pad", "data-section": "history" }, h("h2", {}, T("Session history", "Session 歷史")), phoneNote(null));
  return h("section", { class: "card tr-pad", "data-section": "history" },
    h("div", { class: "tr-row" }, h("h2", { style: "margin:0;font-size:16px" }, T("Session history", "Session 歷史")), h("span", { class: "faint mono" }, hh.file || ""),
      h("button", { class: "btn ghost", onclick: () => { TR.hist = null; TR.histGen = (TR.histGen || 0) + 1; TR.histBusy = false; render(); } }, icon("refresh", "ic sm"), T("Newest", "最新"))),
    hh.atStart ? h("div", { class: "faint" }, T("Start of the session.", "Session 開頭。")) : h("button", { class: "btn", id: "histOlder", disabled: TR.histBusy || null, onclick: () => loadHistory(true) }, T("Load older turns", "載入更早的回合")),
    h("div", { class: "tr-list", "data-history": hh.entries.length }, hh.entries.map(turnNode)));
}
function turnNode(e) {
  if (e.role === "tool") return h("div", { class: "tr-e result" }, h("span", { class: "tr-t" }, fmtT(e.t)),
    h("details", { class: "tr-res" }, h("summary", {}, T(`${e.results.length} tool result(s)`, `${e.results.length} 個工具結果`)), e.results.map((r) => h("pre", {}, r.body))));
  const tools = (e.tools || []).map((tl) => h("div", { class: "faint" }, "▸ ", tl.name, " ",
    h("code", {}, String(tl.args?.command ?? tl.args?.file_path ?? tl.args?.description ?? "").slice(0, 160))));
  return h("div", { class: `tr-e ${e.role === "captain" ? "captain" : "text"}`, "data-turn": e.role }, h("span", { class: "tr-t" }, fmtT(e.t)),
    h("div", { class: "tr-body" }, h("b", {}, e.role === "captain" ? T("Captain", "船長") : "firstmate"), e.text ? h("div", { class: "md" }, md(e.text)) : null, ...tools));
}
for (const name of ["firstmate", "takeover"]) { const base = routes[name]; if (base) routes[name] = (arg) => { const v = base(arg); if (v?.append) v.append(historyCard()); return v; }; }

// Runs: Studio's own agent node runs, and their detail
async function loadNodes() { const seq = TR.nodesSeq = (TR.nodesSeq || 0) + 1; let r = []; try { r = await getJ("/api/node-runs"); } catch {} if (seq !== TR.nodesSeq) return; TR.nodes = r; if (S.route?.name === "runs") render(); }
function nodesCard() {
  if (!TR.nodes) { loadNodes(); return h("section", { class: "card tr-pad", "data-section": "node-runs" }, h("div", { class: "skel", style: "height:60px" })); }
  return h("section", { class: "card tr-pad", "data-section": "node-runs" }, h("h2", { style: "margin:0;font-size:16px" }, T("Agent rounds", "Agent 回合")),
    TR.nodes.length ? h("div", { class: "tr-list" }, TR.nodes.map((n) => h("a", { class: "tr-e tr-link", href: `#/runs/node/${n.run}/${n.node}/${n.round}`, "data-node-run": `${n.run}/${n.node}/${n.round}` },
      h("span", { class: "tr-t" }, fmtT(n.updated)), h("span", {}, h("b", {}, n.node), ` · ${n.run} · ${T(`Round ${n.round}`, `第 ${n.round} 回合`)}`),
      h("span", { class: "faint" }, [n.prompt && "prompt", n.stream && "stream", n.report && "report"].filter(Boolean).join(" · ")))))
      : h("div", { class: "faint" }, T("No agent rounds yet. Each one keeps its prompt, stream and report.", "還沒有 agent 回合。每個回合都會保留提示詞、串流和報告。")));
}
const wrapRuns = () => {
  const base = routes.runs; if (!base || base.__tr) return;
  const f = (arg) => {
    // …/<round>[/<prompt file>][/prompt|transcript|report]: the last segment opens that tab (the Crew page links each one)
    const m = /^node\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(prompt[\w.]*\.md))?(?:\/(prompt|transcript|report))?$/.exec(arg || "");
    if (m) return detail({ kind: "node", run: m[1], node: m[2], round: m[3], ...(m[4] ? { prompt: m[4] } : {}), ...(m[5] ? { tab: m[5] } : {}) });
    const v = base(arg); const list = [v].flat().filter(Boolean);
    if (!arg && list[0]?.append) list[0].append(nodesCard());
    return list.length === 1 ? list[0] : list;
  };
  f.__tr = true; routes.runs = f;
};
wrapRuns(); addEventListener("load", () => { wrapRuns(); if (/^#\/(runs|tasks|crew\/)/.test(location.hash)) route(); });
if (/^#\/(crew\/|firstmate|takeover)/.test(location.hash)) route();
})();
