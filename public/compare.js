// Compare transcripts: two agent Rounds of one Task side by side (#/tasks/<id>/compare). The pairs come from
// the workflow's `compare` hint (src/compare.ts); without one the captain picks any two Rounds. Every text is a
// text node through h() and md(); the server has redacted it. Loaded after runtime.js (it wraps routes.run).
(() => {
const CV = { id: null, plan: null, err: null, pick: 0, any: false, left: null, right: null, sides: new Map(), show: "left", sync: false, gen: 0 };
const keyOf = (s) => (s ? `${s.node}/${s.visit}` : "");
const fmtT = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "");
const dur = (s) => (s == null ? "—" : s < 60 ? T(`${s.toFixed(0)} s`, `${s.toFixed(0)} 秒`) : T(`${Math.floor(s / 60)} min ${Math.round(s % 60)} s`, `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`));
const STATE = { running: ["Running", "進行中"], waiting: ["Waiting", "等待中"], passed: ["Passed", "通過"], failed: ["Failed", "未通過"], error: ["Error", "錯誤"], interrupted: ["Interrupted", "已中斷"], skipped: ["Skipped", "已略過"], superseded: ["Replaced", "已取代"], swapped: ["Replaced", "已取代"] };
const rerender = () => { if (S.route?.name === "run" && new RegExp(`^${CV.id}/compare$`).test(S.route.arg || "")) render(); };

async function loadPlan(id) {
  const gen = ++CV.gen;
  Object.assign(CV, { id, plan: null, err: null, pick: 0, any: false, left: null, right: null, sides: new Map(), show: "left" });
  try {
    const p = await getJ(`/api/tasks/${encodeURIComponent(id)}/compare`);
    if (gen !== CV.gen) return;
    if (p.error) CV.err = p.error; else { CV.plan = p; CV.any = !p.pairs.length; CV.left = keyOf(p.rounds[0]); CV.right = keyOf(p.rounds[1] || p.rounds[0]); }
  } catch (e) { if (gen === CV.gen) CV.err = String(e?.message || e); }
  if (gen === CV.gen) rerender();
}
function side(s) {
  if (!s) return null;
  const k = keyOf(s);
  if (!CV.sides.has(k)) {
    CV.sides.set(k, { loading: true });
    const gen = CV.gen;
    getJ(`/api/tasks/${encodeURIComponent(CV.id)}/compare/${encodeURIComponent(s.node)}/${encodeURIComponent(s.visit)}`)
      .then((v) => { if (gen === CV.gen) { CV.sides.set(k, v.error ? { error: v.error } : v); rerender(); } })
      .catch((e) => { if (gen === CV.gen) { CV.sides.set(k, { error: String(e?.message || e) }); rerender(); } });
  }
  return CV.sides.get(k);
}
/** the two Rounds on screen: a declared pair, or the two the captain picked */
function chosen() {
  const p = CV.plan; if (!p) return [null, null];
  if (!CV.any && p.pairs[CV.pick]) return [p.pairs[CV.pick].left, p.pairs[CV.pick].right];
  const find = (k) => p.rounds.find((r) => keyOf(r) === k) || null;
  return [find(CV.left), find(CV.right)];
}
const roleName = (id) => CV.plan?.rounds.find((r) => r.role === id)?.roleLabel || id;

function head(s, at, roles) {
  if (!s) return h("div", { class: `cmp-head cmp-${at}`, "data-cmp-head": at }, h("b", {}, roles ? roleName(roles[at === "left" ? 0 : 1]) : "—"),
    h("p", { class: "faint" }, T("This round has not run.", "這一輪還沒有執行。")));
  const st = STATE[s.state] || [s.state, s.state];
  const field = (en, tw, v, attr) => h("div", attr || {}, h("dt", {}, T(en, tw)), h("dd", {}, v));
  return h("div", { class: `cmp-head cmp-${at}`, "data-cmp-head": at, "data-cmp-node": s.node, "data-cmp-visit": String(s.visit) },
    h("div", { class: "cmp-title" }, h("b", { "data-cmp-role": s.role || "" }, s.roleLabel || s.role || T("Agent", "Agent")), h("span", { class: "faint" }, `${s.label}${s.visit > 1 ? T(` · round ${s.visit} of this node`, ` · 此節點第 ${s.visit} 回合`) : ""}${s.attempt > 1 ? T(` · attempt ${s.attempt}`, ` · 第 ${s.attempt} 次嘗試`) : ""}`)),
    h("dl", { class: "cmp-meta" },
      field("Provider / model", "廠商 / 模型", [s.provider, s.model].filter(Boolean).join(" · ") || "—", { "data-cmp-model": "1" }),
      field("Duration", "耗時", dur(s.seconds)),
      field("Outcome", "結果", [h("span", { class: `badge ${s.state === "passed" ? "ok" : ["failed", "error"].includes(s.state) ? "bad" : ""}` }, T(st[0], st[1])), s.outcome && s.outcome !== "ok" ? ` · ${s.outcome}` : ""], { "data-cmp-outcome": "1" })),
    s.error ? h("p", { class: "bad cmp-err" }, s.error) : null,
    h("a", { class: "btn ghost cmp-log", href: s.transcript, "data-cmp-log": at }, T("Open the full log", "打開完整紀錄")));
}
/** md() per line, with headings, quotes and list items as blocks; every piece is still a text node */
function blocks(text) {
  const out = []; let para = [];
  const end = () => { if (para.length) { out.push(h("p", {}, md(para.join("\n")))); para = []; } };
  for (const line of String(text).split("\n")) {
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { end(); out.push(h("div", { class: `cmp-h cmp-h${Math.min(m[1].length, 3)}` }, md(m[2]))); }
    else if ((m = /^>\s?(.*)$/.exec(line))) { end(); out.push(h("blockquote", {}, md(m[1]))); }
    else if ((m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line))) { end(); out.push(h("div", { class: "cmp-li", style: `padding-left:${12 + Math.min(m[1].length, 8) * 6}px` }, h("span", { class: "cmp-bullet" }, /\d/.test(m[2]) ? m[2] : "•"), " ", md(m[3]))); }
    else if (!line.trim()) end();
    else para.push(line);
  }
  end(); return out;
}
function argBlocks(a) {
  const short = [], long = [];
  // a word or a number sits on one line; prose (a proposal, a critique) gets its own block
  for (const [k, v] of Object.entries(a || {})) { const str = typeof v === "string", t = str ? v : JSON.stringify(v); (str && (t.length > 60 || t.includes("\n")) ? long : short).push([k, t, str]); }
  return [short.length ? h("div", { class: "cmp-args" }, short.map(([k, t, str]) => h("span", {}, h("span", { class: "faint" }, `${k}: `), str ? h("b", {}, t || "—") : h("code", {}, t)))) : null,
    ...long.map(([k, t]) => h("details", { class: "cmp-long", open: true }, h("summary", { class: "faint" }, k), h("div", { class: "cmp-text md" }, blocks(t))))];
}
function entry(e, i) {
  const t = h("span", { class: "tr-t" }, fmtT(e.t));
  const at = { "data-step": String(i), "data-entry": e.kind };
  if (e.kind === "text") return h("div", { class: "tr-e text", ...at }, t, h("div", { class: "tr-body cmp-text md" }, blocks(e.text || "")));
  if (e.kind === "tool") return h("div", { class: "tr-e tool", ...at }, t, h("div", { class: "tr-body" }, h("b", {}, "▸ ", e.name), ...argBlocks(e.args)));
  if (e.kind === "toolResult") return h("div", { class: `tr-e result${e.isError ? " err" : ""}`, ...at }, t,
    h("details", { class: "tr-res" }, h("summary", {}, e.isError ? "✗ " : "✓ ", T("result", "結果")), h("pre", {}, e.body || ""), e.truncated ? h("div", { class: "faint" }, T("Cut; the full log has the rest.", "已截斷；完整紀錄裡有其餘內容。")) : null));
  return h("div", { class: `tr-e ${e.kind}`, ...at }, t, h("div", { class: "tr-body faint" }, e.kind === "result" ? "✓ " : e.kind === "error" ? "✗ " : "", e.text || ""));
}
// a report's text is the agent's messages again: the last one, or all of them run together
const flat = (t) => String(t || "").replace(/\s+/g, "");
const saidShown = (said, es) => { const texts = es.filter((e) => e.kind === "text").map((e) => e.text || ""); const f = flat(said); return !!f && (f === flat(texts.at(-1)) || f === flat(texts.join(""))); };
function body(s, at) {
  const v = side(s);
  const box = (...kids) => h("div", { class: `cmp-body cmp-${at}`, "data-cmp-body": at, onscroll: (ev) => syncFrom(ev.currentTarget, at) }, ...kids);
  if (!s) return box();
  if (!v || v.loading) return box(h("div", { class: "skel", style: "height:200px" }));
  if (v.error) return box(h("div", { class: "card err tr-pad" }, v.error));
  if (v.phone) return box(h("div", { class: "card tr-pad", "data-phone-summary": "1" }, h("b", {}, T("Summary only on a phone", "手機只顯示摘要")),
    h("p", { class: "faint" }, T("The raw prompt and transcript stay on the Mac unless it allows phones to read them.", "原始提示詞和對話紀錄只在 Mac 上看，除非 Mac 允許手機讀取。")),
    h("p", {}, T(`${v.summary.entries} entries · ${v.summary.tools} tool calls`, `${v.summary.entries} 筆 · ${v.summary.tools} 次工具呼叫`))));
  const r = v.report;
  return box(
    h("details", { class: "cmp-prompt", "data-cmp-prompt": at }, h("summary", {}, h("b", {}, T("Prompt", "提示詞")), h("span", { class: "faint" }, ` · ${v.prompt?.name || "prompt.md"}`)),
      v.prompt ? h("pre", { class: "tr-raw" }, v.prompt.body) : h("p", { class: "faint" }, T("No prompt was recorded.", "沒有記錄提示詞。"))),
    h("div", { class: "tr-list", "data-cmp-entries": String(v.entries.length) }, v.entries.length ? v.entries.map(entry) : h("p", { class: "faint" }, T("No transcript yet.", "還沒有對話紀錄。"))),
    v.stream?.cut ? h("p", { class: "faint" }, T("The transcript is long; the full log has the rest.", "對話紀錄太長；完整紀錄裡有其餘內容。")) : null,
    h("section", { class: "cmp-report", "data-cmp-report": at }, h("h3", {}, T("Final report", "最終報告")),
      r ? [h("p", { class: "faint" }, [r.status, r.tools != null ? T(`${r.tools} tool calls`, `${r.tools} 次工具呼叫`) : null, r.cost?.usd != null ? `$${Number(r.cost.usd).toFixed(3)}` : null].filter(Boolean).join(" · ")),
        r.error && r.error !== "null" ? h("p", { class: "bad" }, r.error) : null, r.said ? (saidShown(r.said, v.entries) ? h("p", { class: "faint", "data-cmp-said-same": at }, T("Its text is the messages above.", "內容就是上方的訊息。"))
          : h("div", { class: "cmp-text md" }, blocks(r.said))) : null]
        : h("p", { class: "faint" }, T("No report yet.", "還沒有報告。"))));
}
// sync scroll by step: the other column shows the same step number at its top
let syncing = false;
function syncFrom(el, at) {
  if (!CV.sync || syncing) return;
  const other = document.querySelector(`[data-cmp-body="${at === "left" ? "right" : "left"}"]`); if (!other) return;
  const steps = [...el.querySelectorAll("[data-step]")]; const top = el.getBoundingClientRect().top;
  const cur = steps.find((x) => x.getBoundingClientRect().bottom > top + 4); if (!cur) return;
  const twin = other.querySelector(`[data-step="${cur.dataset.step}"]`) || [...other.querySelectorAll("[data-step]")].at(-1); if (!twin) return;
  syncing = true; other.scrollTop += twin.getBoundingClientRect().top - other.getBoundingClientRect().top; requestAnimationFrame(() => { syncing = false; });
}

function picker(tools) {
  const p = CV.plan;
  const anyBtn = h("button", { "data-cmp-any": "1", "aria-pressed": String(CV.any), onclick: () => { CV.any = true; render(); } }, h("span", { class: "keep" }, T("Pick any two rounds", "自選兩個回合")));
  const pairs = p.pairs.length ? h("div", { class: "seg", role: "group", "aria-label": T("Round", "輪次"), "data-cmp-rounds": String(p.pairs.length) },
    p.pairs.map((x, i) => h("button", { "data-cmp-pick": String(x.key), "aria-pressed": String(!CV.any && CV.pick === i), onclick: () => { CV.any = false; CV.pick = i; render(); } },
      h("span", { class: "keep" }, `${p.declared.length > 1 ? `${roleName(x.roles[0])} ↔ ${roleName(x.roles[1])} · ` : ""}${T(`Round ${x.key}`, `第 ${x.key} 輪`)}`))), anyBtn) : null;
  const sel = (at) => h("label", { class: "cmp-sel" }, h("span", { class: "faint" }, at === "left" ? T("Left", "左欄") : T("Right", "右欄")),
    h("select", { class: "select", "data-cmp-select": at, onchange: (e) => { CV[at] = e.target.value; render(); } },
      p.rounds.map((r) => h("option", { value: keyOf(r), selected: CV[at] === keyOf(r) || null }, `${r.label} · ${r.roleLabel || r.role || ""} · ${T(`round ${r.visit}`, `第 ${r.visit} 回合`)}`))));
  return h("div", { class: "card x-pad cmp-picker" }, pairs,
    !p.pairs.length ? h("p", { class: "faint", "data-cmp-undeclared": "1" }, T("This workflow does not pair its rounds. Pick any two.", "這個流程沒有宣告配對的回合，請自選兩個。")) : null,
    CV.any ? h("div", { class: "tr-row" }, sel("left"), sel("right")) : null, tools);
}
function view(id) {
  if (CV.id !== id) loadPlan(id);
  const back = h("a", { class: "btn ghost", href: `#/tasks/${id}` }, T("Back to the task", "回到任務"));
  const top = h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Compare transcripts", "並排比較紀錄")), h("p", { class: "mono" }, id)), h("div", { class: "actions" }, back));
  if (CV.err) return h("div", { class: "page cmp-page" }, top, h("div", { class: "card err tr-pad" }, CV.err));
  if (!CV.plan) return h("div", { class: "page cmp-page" }, top, h("div", { class: "skel", style: "height:320px" }));
  if (!CV.plan.rounds.length) return h("div", { class: "page cmp-page", "data-compare": id }, top, h("div", { class: "card tr-pad faint" }, T("This task has no agent rounds yet.", "這個任務還沒有 agent 回合。")));
  const [l, r] = chosen();
  const roles = !CV.any ? CV.plan.pairs[CV.pick]?.roles : null;
  const label = (s, i) => s?.roleLabel || (roles ? roleName(roles[i]) : i ? T("Right", "右欄") : T("Left", "左欄"));
  const toggle = h("div", { class: "seg cmp-toggle", role: "group", "aria-label": T("Show", "顯示") }, [["left", label(l, 0)], ["right", label(r, 1)]].map(([k, t]) =>
    h("button", { "data-cmp-show": k, "aria-pressed": String(CV.show === k), onclick: () => { CV.show = k; render(); } }, h("span", { class: "keep" }, t))));
  const sync = h("label", { class: "cmp-sync faint" }, h("input", { type: "checkbox", "data-cmp-sync": "1", checked: CV.sync || null, onchange: (e) => { CV.sync = e.target.checked; } }), T("Sync scroll by step", "依步驟同步捲動"));
  return h("div", { class: "page cmp-page", "data-compare": id },
    top, picker(h("div", { class: "tr-row cmp-tools" }, toggle, sync)),
    h("div", { class: "cmp-grid", "data-cmp-showing": CV.show }, head(l, "left", roles), head(r, "right", roles), body(l, "left"), body(r, "right")));
}

const wrap = () => {
  const base = routes.run; if (!base || base.__cmp) return;
  const f = (arg) => { const m = /^(R-\d+)\/compare$/.exec(arg || ""); return m ? view(m[1]) : base(arg); };
  f.__cmp = true; routes.run = f;
};
wrap(); addEventListener("load", () => { wrap(); if (/^#\/(run|tasks)\/R-\d+\/compare$/.test(location.hash)) route(); });
addEventListener("hashchange", () => { if (!/^#\/(run|tasks)\/R-\d+\/compare$/.test(location.hash)) { CV.id = null; CV.gen++; } });
})();
