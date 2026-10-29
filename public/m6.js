// M6 self-improvement: #/improve (proposals, retros, skills, eval settings),
// #/retro/<id> (the report viewer), #/edit/<id> (a proposal or chat edit: the
// diff, before/after replay evals, adopt or reject, tracking after adoption),
// #/skill/<workflow>/<role> (versions and the "edit with chat" panel).
(() => {
const I = { ov: null, reports: new Map(), edits: new Map(), skills: new Map() };
const ES = { drafting: ["run", () => T("Drafting", "撰寫中")], evaluating: ["run", () => T("Running evals", "跑評測中")], offered: ["human", () => T("Offered", "待決定")],
  adopted: ["ok", () => T("Adopted", "已採用")], rejected: ["", () => T("Rejected", "已拒絕")], failed: ["bad", () => T("Failed", "失敗")], "no-change": ["", () => T("No change", "沒有變更")] };
const eBadge = (s) => { const [c, l] = ES[s] || ES.failed; return X.pill(c, l()); };
const load = async () => { I.ov = await X.get("/api/improve"); X.count("navImprove", I.ov.edits.filter((e) => e.status === "offered").length); X.refresh(["improve"]); };
const loadEdit = async (id) => { I.edits.set(id, await X.get(`/api/improve/edits/${encodeURIComponent(id)}`)); X.refresh(["edit"]); };
const loadReport = async (id) => { I.reports.set(id, await X.get(`/api/improve/retro/${encodeURIComponent(id)}`)); X.refresh(["retro"]); };
const loadSkill = async (k) => { I.skills.set(k, await X.get(`/api/improve/skills/${k}`)); X.refresh(["skill"]); };
window.onExt.push((t, d) => {
  if (t === "improve") { load(); if (S.route?.name === "edit" && (!d.edit || d.edit === S.route.arg)) loadEdit(S.route.arg); if (S.route?.name === "retro") loadReport(S.route.arg);
    if (S.route?.name === "skill") loadSkill(S.route.arg); }
  if (t === "agent" && S.route?.name === "edit" && d.ref === S.route.arg) loadEdit(S.route.arg);
});

const evalBar = (ev) => {
  if (!ev) return h("span", { class: "faint" }, T("evals pending", "評測尚未完成"));
  if (!ev.cases) return h("span", { class: "faint" }, T("no recorded cases for this role yet", "這個角色還沒有錄製的案例"));
  const step = (en, tw, x) => h("span", { class: "x-evs" }, h("span", { class: "faint" }, T(en, tw)), h("span", { class: "x-ev" }, `${x.before}/${x.total}`), icon("arrow", "ic sm"),
    h("span", { class: `x-ev ${x.after > x.before ? "up" : x.after < x.before ? "down" : ""}` }, `${x.after}/${x.total}`));
  const own = ev.own || { total: 0 }, others = ev.others || { total: ev.cases, before: ev.before.passed, after: ev.after.passed };
  const reg = ev.regressions || [];
  return h("span", { class: "x-evs" }, own.total ? step("its cases", "本類案例", own) : null, others.total ? step(own.total ? "other cases" : "replay cases", own.total ? "其他案例" : "重放案例", others) : null,
    reg.length ? X.pill("bad", T(`${reg.length} regression${reg.length > 1 ? "s" : ""}`, `${reg.length} 個退步`)) : X.pill("ok", T("no regressions", "沒有退步")),
    h("span", { class: "faint" }, ev.before.mode === "model" ? `${ev.before.provider} · ${ev.before.model}` : T("static replay (no model)", "靜態重放（不用模型）")));
};
const metricLine = (e) => e.expected ? h("span", { class: "x-metric" }, icon("target", "ic sm"), T(`${e.expected.metric}: ${e.expected.baselinePerWeek}/wk → ${e.expected.target}/wk`, `${e.expected.metric}：每週 ${e.expected.baselinePerWeek} → ${e.expected.target}`)) : null;
const tracking = (t) => t ? h("span", { class: "x-metric" }, icon("activity", "ic sm"), t.afterPerWeek == null ? T(`before ${t.beforePerWeek}/wk · after: ${t.afterCount} so far (${t.afterDays} d, too early)`, `採用前每週 ${t.beforePerWeek} · 採用後目前 ${t.afterCount} 次（${t.afterDays} 天，還太早）`)
  : T(`before ${t.beforePerWeek}/wk → after ${t.afterPerWeek}/wk (${t.afterDays} d)`, `採用前每週 ${t.beforePerWeek} → 採用後每週 ${t.afterPerWeek}（${t.afterDays} 天）`)) : null;

function propCard(e) {
  return h("a", { class: "card x-prop", href: `#/edit/${e.id}`, "data-edit": e.id },
    h("div", { class: "x-row" }, eBadge(e.status), h("b", {}, e.kind === "proposal" ? e.title : T("Chat edit", "對話修改")), h("span", { class: "vbadge" }, `${e.workflow}/${e.role}`), h("span", { class: "x-grow" }), h("span", { class: "faint" }, `${e.id} · ${ago(e.createdAt)}`)),
    h("div", { class: "x-req" }, e.kind === "proposal" ? e.request.replace(/^- /, "") : `“${e.request}”`),
    h("div", { class: "x-row wrap" }, metricLine(e), e.status === "adopted" ? tracking(e.tracking) : evalBar(e.evals)));
}
function viewImprove() {
  if (!I.ov) { load(); return X.loading(); }
  const o = I.ov;
  const offered = o.edits.filter((e) => ["offered", "drafting", "evaluating"].includes(e.status));
  const adopted = o.edits.filter((e) => e.status === "adopted");
  const rest = o.edits.filter((e) => ["rejected", "failed", "no-change"].includes(e.status));
  const wfSel = h("select", { "aria-label": T("Workflow", "流程") }, o.flows.filter((f) => f.retro).map((f) => h("option", { value: f.id }, f.name)));
  const daysSel = h("select", { "aria-label": T("Window", "範圍") }, [7, 14, 30].map((d) => h("option", { value: d, selected: d === 14 }, T(`last ${d} days`, `最近 ${d} 天`))));
  const run = h("button", { class: "btn primary", onclick: async () => { run.disabled = true; run.lastChild.textContent = T("Running retro…", "回顧中…");
    const r = await X.post("/api/improve/retro", { workflow: wfSel.value, days: Number(daysSel.value) }); run.disabled = false; if (r.error) return toast(r.error); load(); location.hash = `#/retro/${r.id}`; } }, icon("refresh", "ic sm"), h("span", {}, T("Run retro now", "立即回顧")));
  const mode = h("div", { class: "seg", role: "group", "aria-label": T("Eval mode", "評測方式") }, [["static", "Static replay", "靜態重放"], ["model", "Model replay", "模型重放"]].map(([v, en, tw]) =>
    h("button", { "aria-pressed": String(o.settings.evalMode === v), onclick: async () => { await X.post("/api/improve/settings", { ...o.settings, evalMode: v }); load(); } }, h("span", {}, T(en, tw)))));
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Improve", "改進")),
      h("p", {}, T("Retros find what keeps going wrong; each fix is a skill edit, replay-evaluated on recorded tasks before it reaches you. Studio keeps its own skill versions: firstmate's files are never written.",
        "回顧找出一再出錯的地方；每個修正都是一次技能修改，先在任務紀錄上重放評測，才交給你。Studio 保存自己的技能版本，不會寫入 firstmate 的檔案。"))),
      h("div", { class: "actions x-wrap" }, wfSel, daysSel, run)),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Proposals", "提案")), X.pill("human", String(offered.length)), h("span", { class: "x-grow" }),
      h("span", { class: "faint", style: "font-size:12px" }, T("Evals:", "評測：")), mode),
      offered.length ? h("div", { class: "x-grid" }, offered.map(propCard)) : h("div", { class: "card" }, h("div", { class: "empty" }, icon("check"), h("b", {}, T("No open proposals", "沒有待決定的提案")),
        T("Run a retro, or ask for a skill edit from a role below or in the chat.", "執行回顧，或從下面的角色或對話要求修改技能。")))),
    adopted.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Adopted, tracked", "已採用・追蹤中")), h("span", { class: "faint" }, String(adopted.length))), h("div", { class: "x-grid" }, adopted.map(propCard))) : null,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Retros", "回顧")), h("span", { class: "faint" }, String(o.reports.length))),
      o.reports.length ? h("div", { class: "card", style: "display:grid" }, o.reports.map((r) => h("a", { class: "lib-row x-link", href: `#/retro/${r.id}` }, h("div", { class: "run-s" }, h("b", {}, r.id), h("span", { class: "vbadge" }, r.workflow),
        h("span", {}, T(`${r.found} of ${r.classes} classes repeat`, `${r.classes} 類中有 ${r.found} 類重複`)), h("span", {}, T(`${r.proposals.length} proposals`, `${r.proposals.length} 個提案`)),
        h("span", { class: "faint" }, `${r.window.days}d · ${r.window.events} ${T("events", "事件")}`), h("span", { class: "faint" }, r.trigger), h("span", { class: "faint" }, ago(r.createdAt))))))
        : h("div", { class: "card faint", style: "padding:14px 16px" }, T("No retro yet. Triggers: weekly, after many merges, or when a class repeats; or run one now.", "還沒有回顧。觸發條件：每週、合併很多次之後、某類問題重複時；也可以立即執行。"))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Skills", "技能")), h("span", { class: "faint" }, T(`${o.skills.length} roles in ${o.flows.length} workflows · ${o.cases} eval cases`, `${o.flows.length} 個流程、${o.skills.length} 個角色・${o.cases} 個評測案例`))),
      h("div", { class: "card", style: "display:grid" }, o.skills.map((s) => h("a", { class: "lib-row x-link", href: `#/skill/${s.workflow}/${s.role}` }, h("div", { class: "run-s" }, icon("agent", "ic sm"), h("b", {}, s.label), h("span", { class: "vbadge" }, s.workflowName),
        s.pack ? h("span", { class: "faint" }, T(`pack ${s.pack}`, `套件 ${s.pack}`)) : null, h("span", {}, s.current ? `v${s.current}` : T("not imported yet", "尚未匯入")),
        h("code", { class: "a3-path" }, s.source), s.readOnlySource ? h("span", { class: "faint" }, icon("lock", "ic sm"), T("source read-only", "來源唯讀")) : null))))),
    rest.length ? h("details", { class: "card", style: "padding:10px 16px" }, h("summary", {}, T(`${rest.length} rejected, failed or unchanged`, `${rest.length} 個已拒絕、失敗或沒有變更`)), h("div", { class: "x-grid", style: "margin-top:10px" }, rest.map(propCard))) : null,
    o.rejected.length ? h("p", { class: "faint", style: "font-size:13px" }, T(`Never proposed again: ${o.rejected.map((r) => r.fingerprint).join(", ")}`, `不會再提：${o.rejected.map((r) => r.fingerprint).join("、")}`)) : null);
}

function viewRetro(id) {
  const r = I.reports.get(id);
  if (!r) { loadReport(id); return X.loading(); }
  if (r.error) return X.notFound("No such retro", "沒有這份回顧");
  const found = r.classes.filter((c) => c.found), not = r.classes.filter((c) => !c.found);
  const cls = (c) => h("div", { class: `card x-class ${c.found ? "found" : ""}`, "data-class": c.id },
    h("div", { class: "x-row" }, c.found ? X.pill("bad", T("Repeats", "重複")) : X.pill("", T("Not found", "沒找到")), h("b", {}, c.title), h("span", { class: "x-grow" }),
      h("span", { class: "x-num" }, T(`${c.count} hits · ${c.groups.length} ${c.groups.length === 1 ? "group" : "groups"} · ${c.perWeek}/wk`, `${c.count} 次・${c.groups.length} 組・每週 ${c.perWeek}`))),
    c.explain ? h("p", { class: "x-explain" }, c.explain) : null,
    c.note ? h("p", { class: "faint", style: "font-size:13px" }, c.note) : null,
    c.examples.length ? h("ul", { class: "x-hits" }, c.examples.map((x) => h("li", {}, h("a", { href: `#/event/${x.seq}` }, `#${x.seq}`), x.task ? h("a", { href: `#/task/${x.task}` }, x.task) : null,
      h("span", { class: "faint" }, x.actor), h("span", { class: "x-hit" }, x.text)))) : null,
    (() => { const e = r.edits.find((x) => x.class === c.id); const sk = r.skipped.find((x) => x.class === c.id);
      return e ? h("div", { class: "x-row" }, icon("wand", "ic sm"), h("a", { href: `#/edit/${e.id}` }, T(`Proposal ${e.id}`, `提案 ${e.id}`)), eBadge(e.status), evalBar(e.evals)) : sk ? h("div", { class: "faint", style: "font-size:13px" }, sk.why) : null; })());
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/improve", class: "a3-back" }, T("Improve", "改進")), " · ", T(`Retro ${r.id}`, `回顧 ${r.id}`)),
      h("p", { class: "run-s", style: "font-size:13px" }, h("span", { class: "vbadge" }, wfName(r.workflow)), h("span", {}, `${r.window.from.slice(0, 10)} → ${r.window.to.slice(0, 10)}`), h("span", {}, T(`${r.window.events} events`, `${r.window.events} 個事件`)),
        h("span", {}, r.trigger), r.config ? h("span", { class: "faint" }, T(`source: ${r.config.source} (read-only)`, `來源：${r.config.source}（唯讀）`)) : null))),
    h("div", { class: "x-tiles" }, r.metrics.map((m) => h("div", { class: "card x-tile" }, h("div", { class: "x-tv" }, m.value == null ? "—" : String(m.value)), h("div", { class: "faint" }, m.label)))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Repeat classes", "重複的問題類別")), h("span", { class: "faint" }, T(`${found.length} found · ${not.length} not found`, `找到 ${found.length}・沒找到 ${not.length}`))),
      h("div", { class: "x-stack" }, [...found, ...not].map(cls))),
    r.config ? h("p", { class: "faint", style: "font-size:13px" }, T(`Triggers: ${r.config.triggers.map((t) => t.kind === "every" ? `every ${t.days} days` : t.kind === "count" ? `${t.n} × ${t.type}` : `a class repeating on ${t.min_groups}`).join(" · ")}`,
      `觸發：${r.config.triggers.map((t) => t.kind === "every" ? `每 ${t.days} 天` : t.kind === "count" ? `${t.n} 次 ${t.type}` : `某類重複 ${t.min_groups} 次`).join("・")}`)) : null);
}

function viewEdit(id) {
  const e = I.edits.get(id);
  if (!e) { loadEdit(id); return X.loading(); }
  if (e.error && !e.id) return X.notFound("No such edit", "沒有這個修改");
  const act = async (what, body) => { const r = await X.post(`/api/improve/edits/${e.id}/${what}`, body); if (r.error) return toast(r.error); I.edits.set(e.id, r); load(); soft(); };
  const cases = e.evals ? e.evals.before.results.map((b, i) => ({ b, a: e.evals.after.results[i] })) : [];
  const mark = (ok) => h("span", { class: `x-ck ${ok ? "ok" : "bad"}` }, ok ? "✓" : "✗");
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/improve", class: "a3-back" }, T("Improve", "改進")), " · ", e.kind === "proposal" ? e.title : T(`Chat edit ${e.id}`, `對話修改 ${e.id}`)),
      h("p", { class: "run-s", style: "font-size:13px" }, eBadge(e.status), h("a", { href: `#/skill/${e.workflow}/${e.role}` }, `${wfName(e.workflow)}/${e.role}`), h("span", {}, T(`from v${e.base}`, `基於 v${e.base}`)),
        e.stat ? h("span", { class: "x-num" }, `+${e.stat.added} −${e.stat.removed}`) : null, h("span", {}, e.by), e.retro ? h("a", { href: `#/retro/${e.retro}` }, e.retro) : null, h("span", { class: "faint" }, ago(e.createdAt)))),
      h("div", { class: "actions" },
        e.status === "offered" ? h("button", { class: "btn primary", onclick: () => modal(T("Adopt this edit?", "採用這個修改？"), h("p", {}, T(`Studio's ${wfName(e.workflow)}/${e.role} skill gets a new version. ${e.workflow === "code" ? "firstmate's own file is not written: download the patch from the skill page to hand it over." : ""}`,
          `Studio 的 ${wfName(e.workflow)}/${e.role} 技能會多一個版本。${e.workflow === "code" ? "不會寫入 firstmate 自己的檔案：到技能頁下載 patch 交給它。" : ""}`)), (close) => { close(); act("adopt"); }) }, icon("check", "ic sm"), T("Adopt", "採用")) : null,
        e.status === "offered" || e.status === "failed" ? h("button", { class: "btn", onclick: () => { const why = h("textarea", { rows: 3, "aria-label": T("Why", "原因"), placeholder: T("optional", "可留空") });
          modal(T("Reject this edit?", "拒絕這個修改？"), h("div", { class: "form" }, h("p", { class: "faint" }, e.fingerprint ? T("A rejected proposal is never proposed again for this class and role.", "被拒絕的提案，同一類別與角色不會再提。") : ""), why), (close) => { close(); act("reject", { reason: why.value }); }); } }, T("Reject", "拒絕")) : null,
        e.status === "offered" ? h("button", { class: "btn ghost", onclick: () => act("reeval") }, icon("refresh", "ic sm"), T("Re-run evals", "重跑評測")) : null)),
    e.error ? h("div", { class: "err" }, icon("alert", "ic sm"), e.error) : null,
    h("div", { class: "card x-pad x-stack" },
      h("div", { class: "x-req" }, e.kind === "proposal" ? e.request.replace(/^- /, "") : `“${e.request}”`),
      e.rationale ? h("p", { class: "x-explain" }, e.rationale) : null, e.summary ? h("p", { class: "faint", style: "font-size:13px" }, e.summary) : null,
      h("div", { class: "x-row wrap" }, metricLine(e), e.status === "adopted" ? tracking(e.tracking) : null, e.status === "adopted" ? h("span", { class: "faint" }, T(`became v${e.adoptedVersion}`, `成為 v${e.adoptedVersion}`)) : null)),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Replay evals: before and after", "重放評測：改前與改後")), evalBar(e.evals)),
      cases.length ? h("div", { class: "card x-evtable" }, h("div", { class: "x-evr head" }, h("div", {}, T("Case (from a recorded run)", "案例（來自任務紀錄）")), h("div", {}, T("Before", "改前")), h("div", {}, T("After", "改後"))),
        cases.map(({ b, a }) => h("details", { class: "x-evr" }, h("summary", {}, h("div", {}, b.title), h("div", {}, mark(b.pass)), h("div", {}, mark(a.pass))),
          h("div", { class: "x-evd" }, h("div", {}, h("b", {}, T("Before", "改前")), h("ul", {}, b.checks.map((c) => h("li", {}, mark(c.ok), c.why))), h("pre", {}, b.answer || T("(no answer)", "（沒有回答）"))),
            h("div", {}, h("b", {}, T("After", "改後")), h("ul", {}, a.checks.map((c) => h("li", {}, mark(c.ok), c.why))), h("pre", {}, a.answer || T("(no answer)", "（沒有回答）"))))))) : h("div", { class: "card faint", style: "padding:14px 16px" },
          e.status === "drafting" || e.status === "evaluating" ? T("Running…", "執行中…") : T("No replay cases for this role yet. A retro adds them from recorded tasks.", "這個角色還沒有重放案例。回顧會從任務紀錄加入。"))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("The change", "變更內容"))), X.diff(e.hunks || [])),
    e.evidence?.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Evidence", "證據"))), h("ul", { class: "card x-hits x-pad" }, e.evidence.map((x) => h("li", {}, h("a", { href: `#/event/${x.seq}` }, `#${x.seq}`),
      x.task ? h("a", { href: `#/task/${x.task}` }, x.task) : null, h("span", { class: "faint" }, x.actor), h("span", { class: "x-hit" }, x.text))))) : null,
    e.job ? h("details", { class: "card x-pad" }, h("summary", {}, T(`Editor run: ${e.job.provider} · ${e.job.model} · ${e.job.tools} tool calls`, `編輯執行：${e.job.provider} · ${e.job.model} · ${e.job.tools} 次工具呼叫`)),
      h("ul", { class: "x-log" }, e.job.log.map((l) => h("li", { class: l.kind }, h("span", { class: "faint" }, clock(l.ts)), " ", l.text)))) : null);
}

function viewSkill(arg) {
  const k = arg || "";
  const s = I.skills.get(k);
  if (!s) { loadSkill(k); return X.loading(); }
  if (s.error) return X.notFound(s.error, s.error);
  const box = h("textarea", { rows: 3, id: "skillAsk", "aria-label": T("Tell the editor what to change", "告訴編輯要改什麼"), placeholder: T("e.g. Add a rule: stop when the brief names another head", "例如：加一條規則，簡報指向別的 head 時要停下來") });
  const send = h("button", { class: "btn primary", type: "submit" }, icon("send", "ic sm"), T("Ask the editor", "請編輯修改"));
  const form = h("form", { class: "x-ask", onsubmit: async (ev) => { ev.preventDefault(); const t = box.value.trim(); if (!t) return; send.disabled = true;
    const r = await X.post("/api/improve/edits", { workflow: s.workflow, role: s.role, request: t }); send.disabled = false; if (r.error) return toast(r.error); box.value = ""; loadSkill(k); location.hash = `#/edit/${r.id}`; } }, box, send);
  const lines = s.text.split("\n");
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/improve", class: "a3-back" }, T("Improve", "改進")), " · ", `${s.workflow}/${s.role}`),
      h("p", { class: "run-s", style: "font-size:13px" }, h("span", {}, `v${s.n}`), s.sha256 ? h("code", { class: "faint" }, s.sha256.slice(0, 12)) : null,
        s.current != null ? (s.n === s.current ? X.pill("ok", T("Agents receive this text", "agent 收到的就是這份")) : h("span", { class: "faint" }, T(`Agents receive v${s.current}`, `agent 收到的是 v${s.current}`))) : null,
        h("span", {}, T(`${lines.length} lines`, `${lines.length} 行`)), s.source ? h("code", { class: "a3-path" }, s.source) : null),
      s.sourceChanged ? h("p", { class: "faint", "data-skill-source-changed": "" }, T("The source changed after this edit was adopted. Agents keep receiving the adopted edit until you change it.", "這份修改採用後，來源又改了。在你改它之前，agent 仍然收到採用的版本。")) : null),
      h("div", { class: "actions" }, s.versions.length > 1 ? h("a", { class: "btn", href: `/api/improve/skills/${s.workflow}/${s.role}/patch`, download: "" }, icon("download", "ic sm"), T("Patch for the source", "給來源的 patch")) : null)),
    h("section", { class: "x-chat card x-pad" }, h("div", { class: "sec-head" }, h("h2", {}, T("Edit with chat", "用對話修改")), h("span", { class: "faint" }, T("An editor agent changes a copy; replay evals run before it is offered.", "編輯 agent 改的是副本；先跑重放評測再交給你。"))),
      h("div", { class: "x-bubbles" }, s.edits.slice(0, 8).reverse().map((e) => h("div", { class: "x-bub" }, h("div", { class: "x-me" }, e.kind === "proposal" ? T(`Retro ${e.retro}: ${e.title}`, `回顧 ${e.retro}：${e.title}`) : e.request),
        h("a", { class: "x-them", href: `#/edit/${e.id}` }, eBadge(e.status), h("span", {}, e.summary || e.id), e.stat ? h("span", { class: "x-num" }, `+${e.stat.added} −${e.stat.removed}`) : null, evalBar(e.evals))))), form),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Versions", "版本"))), h("div", { class: "card", style: "display:grid" }, [...s.versions].reverse().map((v) => h("a", { class: "lib-row x-link", href: `#/skill/${s.workflow}/${s.role}`, onclick: async (ev) => { ev.preventDefault(); I.skills.set(k, await X.get(`/api/improve/skills/${k}?v=${v.n}`)); soft(); } },
      h("div", { class: "run-s" }, h("b", {}, `v${v.n}`), v.n === s.n ? X.pill("ok", T("shown", "顯示中")) : null, h("span", {}, v.reason), v.edit ? h("span", { class: "vbadge" }, v.edit) : null, h("span", { class: "faint" }, ago(v.createdAt))))))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T(`Text of v${s.n}`, `v${s.n} 全文`))), h("pre", { class: "card x-skilltext" }, s.text)),
    s.cases.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Replay cases", "重放案例")), h("span", { class: "faint" }, String(s.cases.length))),
      h("div", { class: "card", style: "display:grid" }, s.cases.map((c) => h("div", { class: "lib-row" }, h("div", { class: "run-s" }, h("b", {}, c.title), c.from.seq != null ? h("a", { href: `#/event/${c.from.seq}` }, `#${c.from.seq}`) : null,
        h("span", { class: "faint" }, c.ask)))))) : null);
}

Object.assign(routes, { improve: viewImprove, retro: viewRetro, edit: viewEdit, skill: viewSkill });
X.nav("improve", "wand", "Improve", "改進", "changes", "navImprove");
X.own("improve", "retro", "edit", "skill");
X.reroute(/^#\/(improve|retro|edit|skill)/);
load();
})();
