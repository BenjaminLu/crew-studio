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
// the two tabs of #/improve: proposals, retros and skills; and the retro's candidates (workflows/studio.retro.yaml)
const improveTabs = (on) => h("div", { class: "tb-tabs pw-tabs x-tabs", role: "group", "aria-label": T("Improve", "改進") },
  [["overview", "#/improve", "Proposals and retros", "提案與回顧"], ["candidates", "#/improve/candidates", "Candidates", "候選"]].map(([k, href, en, tw]) =>
    h("a", { class: "tb-tab", href, "aria-current": k === on ? "page" : null, "data-improve-tab": k }, T(en, tw), k === "candidates" && I.cand ? h("span", { class: "tb-count num" }, String(I.cand.rows.length)) : null)));
const loadCand = async () => { if (I.candBusy) return; I.candBusy = true;
  try { const r = await X.get("/api/improve/candidates"); I.cand = Array.isArray(r.rows) ? r : { rows: [], other: [], dismissed: [], window: { days: 30 }, error: r.error || `HTTP ${r._http}` }; }
  catch (e) { I.cand = { rows: [], other: [], dismissed: [], window: { days: 30 }, error: String(e) }; } finally { I.candBusy = false; } X.refresh(["improve"]); };
window.onExt.push((t, d) => { if (t === "improve" && (d?.candidates || S.route?.arg === "candidates")) loadCand(); });
// a candidate's ref: the pull request on GitHub, the Task, the room; a note's own page
const refOf = (c) => c.groupKind === "pr" ? (/^[\w.-]+\/[\w.-]+#\d+$/.test(c.group) ? h("a", { href: `https://github.com/${c.group.replace("#", "/pull/")}`, target: "_blank", rel: "noopener", class: "mono" }, c.group) : h("span", { class: "mono" }, c.group))
  : c.groupKind === "task" ? h("a", { href: `#/run/${encodeURIComponent(c.group)}`, class: "mono" }, c.group) : c.groupKind === "room" ? h("a", { href: `#/room/${encodeURIComponent(c.group)}`, class: "mono" }, c.group) : null;
const KIND = { note: ["Noted", "手記"], pr: ["Pull requests", "Pull requests"], run: ["Tasks", "任務"], room: ["Review rooms", "審查室"] };
const CLASS_TW = { "note.captain": "你記下的問題", "note.firstmate": "跟 Firstmate 說的問題", "pr.rollback": "回滾", "pr.incident": "事故", "pr.partial-24h": "部分上線超過一天", "pr.ship-undo": "撤回上線標記" };
const CLASS_EN = { "note.captain": "Problems you noted", "note.firstmate": "Problems you told Firstmate", "pr.rollback": "Rollbacks", "pr.incident": "Incidents" };
const classTitle = (c) => T(CLASS_EN[c.class] || c.title, CLASS_TW[c.class] || (c.class.startsWith("run.") ? `任務用同一種方式失敗：${c.class.slice(4)}` : c.class.startsWith("room.") ? `審查室回合同樣中斷：${c.class.slice(5)}` : c.title));
function candRow(c) {
  const dismiss = h("button", { class: "btn ghost icon x-cand-x", "data-cand-dismiss": c.key, "aria-label": T(`Not needed: ${c.title} (${c.group})`, `不用：${c.title}（${c.group}）`), title: T("Not needed (new hits only add to its count)", "不用（之後的命中只加次數）"),
    onclick: async () => { dismiss.disabled = true; const r = await X.post("/api/improve/candidates/dismiss", { key: c.key }); if (r.error) { dismiss.disabled = false; return toast(r.error); } I.cand = r; X.refresh(["improve"]);
      toast(h("span", {}, T("Marked not needed", "已標成不用"), " ", h("button", { class: "btn sm", onclick: async () => { const u = await X.post("/api/improve/candidates/undismiss", { key: c.key }); if (!u.error) { I.cand = u; X.refresh(["improve"]); } } }, T("Undo", "復原")))); } }, icon("x"));
  return h("div", { class: "lib-row x-cand", role: "listitem", "data-cand": c.key },
    h("div", { class: "x-cand-b" },
      c.note ? h("div", { class: "x-cand-note" }, `“${c.note.text}”`) : null,
      h("div", { class: "run-s" }, c.groupKind === "note" ? null : refOf(c), c.count > 1 ? h("span", { class: "badge" }, T(`${c.count} times`, `${c.count} 次`)) : null,
        c.recurring ? h("span", { class: "faint" }, T(`in ${c.recurring.groups} ${c.groupKind === "room" ? "rooms" : "Tasks"} within ${c.recurring.days} days`, `${c.recurring.days} 天內在 ${c.recurring.groups} 個${c.groupKind === "room" ? "審查室" : "任務"}出現`)) : null,
        c.note?.sel ? h("span", { class: "faint", title: c.note.sel }, T("with a selection", "附選取")) : null,
        h("span", { class: "faint" }, ago(c.lastTs)))),
    dismiss);
}
function viewCandidates() {
  if (!I.cand) { loadCand(); return X.loading(); }
  const c = I.cand, groups = new Map();
  for (const r of c.rows) { const g = groups.get(r.class) ?? []; g.push(r); groups.set(r.class, g); }
  const order = ["note", "pr", "run", "room"], keys = [...groups.keys()].sort((a, b) => order.indexOf(a.split(".")[0]) - order.indexOf(b.split(".")[0]) || a.localeCompare(b));
  const others = c.other.reduce((n, o) => n + o.count, 0);
  return h("div", { class: "page", "data-improve-candidates": "" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Improve", "改進")),
      h("p", {}, T(`What went wrong in the last ${c.window.days} days, for the next retro: what you noted, rollbacks and incidents, and failures that repeat. Studio works it out from its log each time; × marks one not needed.`,
        `最近 ${c.window.days} 天出過的問題，留給下次 retro：你記下的、回滾和事故、一再發生的失敗。Studio 每次都從事件紀錄重新算；按 × 標成不用。`)))),
    improveTabs("candidates"),
    keys.length ? keys.map((k) => { const rows = groups.get(k); return h("section", { "data-cand-class": k },
      h("div", { class: "sec-head" }, h("h2", {}, classTitle(rows[0])), h("span", { class: "vbadge" }, T(...(KIND[k.split(".")[0]] || [k, k]))), h("span", { class: "faint" }, String(rows.length))),
      h("div", { class: "card", role: "list", style: "display:grid" }, rows.map(candRow))); })
      : h("div", { class: "card" }, h("div", { class: "empty", "data-cand-empty": "" }, icon("check"), h("b", {}, T("Nothing to look at", "沒有要看的")),
        T("Press ! on a pull request, a review room or a Task to note a problem, or tell Firstmate.", "在 PR、審查室或任務頁按 ! 記下問題，或跟 Firstmate 說。"))),
    c.other.length ? h("details", { class: "card x-other", "data-cand-other": "" }, h("summary", {}, T(`${others} other signal${others === 1 ? "" : "s"}`, `其他 ${others} 個訊號`), h("span", { class: "faint" }, T(" · only counted", " · 只計數"))),
      h("div", { class: "x-other-l" }, c.other.map((o) => h("div", { class: "kv", "data-cand-other-class": o.class }, h("span", { class: "mono" }, o.class), h("span", {}, T(`${o.count} × in ${o.groups}`, `${o.count} 次・${o.groups} 處`)))))) : null,
    c.dismissed.length ? h("details", { class: "card x-other", "data-cand-dismissed": "" }, h("summary", {}, T(`${c.dismissed.length} marked not needed`, `${c.dismissed.length} 個標成不用`)),
      h("div", { class: "x-other-l" }, c.dismissed.map((d) => h("div", { class: "kv", "data-cand-dismissed-key": d.key }, h("span", {}, h("span", { class: "mono" }, d.class), " ", d.group),
        h("span", {}, d.since ? T(`+${d.since} since`, `之後 +${d.since}`) : "", " ", h("button", { class: "btn sm", onclick: async () => { const u = await X.post("/api/improve/candidates/undismiss", { key: d.key }); if (u.error) return toast(u.error); I.cand = u; X.refresh(["improve"]); } }, T("Show again", "重新顯示"))))))) : null);
}
function viewImprove(arg) {
  if (arg === "candidates") return viewCandidates();
  if (!I.cand) loadCand(); // the tab's count
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
    improveTabs("overview"),
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

// ---------- the quick note: 記問題（!） on the pull request, review room and Task pages ----------
// One line of the captain's, kept verbatim for the retro, with the page it was written on as a removable context chip
// (the page, its Task or room, and any text selected). Enter saves, Esc cancels, the toast takes it back. The key ! (or the
// full-width ！ an input method types) opens it, except while typing in a field, during a composition or with a dialog open.
const QN_PAGES = ["prs", "room", "run"];
const QN = { pop: null };
const qnOn = () => QN_PAGES.includes(S.route?.name);
const qnContext = () => {
  const n = S.route?.name, arg = String(S.route?.arg || "").split("/")[0], sel = String(getSelection?.()?.toString() || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const ref = (n === "run" || n === "room") && /^[\w.-]{1,80}$/.test(arg) ? arg : null;
  const route = n === "prs" ? "#/prs" : ref ? `#/${n}/${ref}` : `#/${n}`;
  const label = n === "prs" ? T("Pull requests", "Pull requests") : n === "room" ? (ref ? T(`Review room ${ref}`, `審查室 ${ref}`) : T("Review rooms", "審查室")) : ref ? T(`Task ${ref}`, `任務 ${ref}`) : T("Tasks", "任務");
  return { route, ref, sel: sel || null, label };
};
const qnModal = () => !!document.querySelector("#modalRoot > *, [aria-modal='true'], dialog[open]");
function qnClose(refocus = true) { const p = QN.pop; if (!p) return; QN.pop = null; p.el.remove(); document.removeEventListener("pointerdown", p.off, true); if (refocus) p.from?.focus?.({ preventScroll: true }); }
function qnOpen(anchor) {
  if (QN.pop) { QN.pop.input.focus(); return; }
  const from = document.activeElement instanceof HTMLElement ? document.activeElement : null, ctx = qnContext();
  let keep = true;
  const input = h("input", { type: "text", maxlength: 500, "data-qnote-input": "", "aria-label": T("What went wrong, in one line", "一句話：哪裡出了問題"), placeholder: T("What went wrong? Enter saves, Esc cancels", "哪裡出了問題？Enter 儲存、Esc 取消") });
  const chip = h("span", { class: "qn-chip", "data-qnote-chip": "" }, h("span", { title: ctx.sel ? `${ctx.label} · “${ctx.sel}”` : ctx.label }, ctx.label, ctx.sel ? ` · “${ctx.sel}”` : ""),
    h("button", { type: "button", "data-qnote-chip-x": "", "aria-label": T("Leave the page out of the note", "不附上這一頁"), onclick: () => { keep = false; chip.remove(); input.focus(); } }, "×"));
  const el = h("div", { class: "qn-pop", role: "dialog", "aria-label": T("Note a problem", "記問題"), "data-qnote": "" }, input,
    h("div", { class: "qn-row" }, chip, h("span", { class: "x-grow" }), h("span", { class: "faint" }, T("For the retro · Enter saves", "留給 retro · Enter 儲存"))));
  const save = async () => {
    const text = input.value.trim(); if (!text) return input.focus();
    input.disabled = true;
    const r = await X.post("/api/improve/notes", { text, ...(keep ? { route: ctx.route, ref: ctx.ref, sel: ctx.sel } : {}) });
    if (r.error) { input.disabled = false; input.focus(); return toast(r.error); }
    qnClose();
    toast(h("span", { "data-qnote-saved": r.note }, T("Noted for the retro", "已記下，會進 retro"), " ", h("button", { class: "btn sm", "data-qnote-undo": r.note, onclick: async (e) => { e.currentTarget.disabled = true; const u = await X.post(`/api/improve/notes/${encodeURIComponent(r.note)}/undo`, {}); toast(u.error ? u.error : T("Note taken back", "已復原")); } }, T("Undo", "復原"))));
  };
  // its own keys stay its own: Enter saves, Esc cancels (the review room's Escape never sees them)
  input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") { e.preventDefault(); qnClose(); } });
  const off = (e) => { if (!el.contains(e.target) && !anchor?.contains?.(e.target)) qnClose(false); };
  document.body.append(el);
  const b = (anchor && anchor.isConnected ? anchor : document.querySelector("[data-qnote-open]"))?.getBoundingClientRect(), w = el.offsetWidth;
  el.style.top = `${Math.round(b ? Math.min(b.bottom + 6, innerHeight - el.offsetHeight - 8) : 72)}px`;
  el.style.left = `${Math.round(Math.max(16, Math.min(b ? b.left : (innerWidth - w) / 2, innerWidth - w - 16)))}px`;
  QN.pop = { el, input, from, off }; document.addEventListener("pointerdown", off, true);
  input.focus();
}
const qnButton = (fixed) => h("button", { type: "button", class: `btn qn-btn${fixed ? " qn-fixed" : ""}`, "data-qnote-open": "", title: T("Note a problem for the retro (!)", "記下問題，留給 retro（!）"), onclick: (e) => qnOpen(e.currentTarget) }, icon("alert", "ic sm"), h("span", {}, T("Note a problem", "記問題")), h("kbd", {}, "!"));
// the button in the page's header (a room's own header), else fixed at the top right
function qnMount() {
  const view = document.getElementById("view"); if (!view) return;
  const have = document.querySelector("[data-qnote-open]");
  if (!qnOn()) { have?.remove(); qnClose(false); return; }
  const head = view.querySelector(".rr-head, .phead"); if (have && (head ? head.contains(have) : have.classList.contains("qn-fixed"))) return;
  have?.remove();
  if (!head) { document.body.append(qnButton(true)); return; }
  const actions = head.classList.contains("phead") ? head.querySelector(":scope > .actions") : null;
  if (actions) actions.prepend(qnButton(false)); else head.append(qnButton(false));
}
new MutationObserver(() => qnMount()).observe(document.getElementById("view") || document.body, { childList: true });
addEventListener("hashchange", () => setTimeout(qnMount, 0)); setTimeout(qnMount, 0);
addEventListener("keydown", (e) => {
  if (!qnOn() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  if (e.key !== "!" && e.key !== "！") return;
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), #chat") || qnModal()) return;
  e.preventDefault(); qnOpen(document.querySelector("[data-qnote-open]"));
});

Object.assign(routes, { improve: viewImprove, retro: viewRetro, edit: viewEdit, skill: viewSkill });
X.nav("improve", "wand", "Improve", "改進", "changes", "navImprove");
X.own("improve", "retro", "edit", "skill");
X.reroute(/^#\/(improve|retro|edit|skill)/);
load();
})();
