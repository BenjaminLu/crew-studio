// The Board (docs/units/board.md), ported from the approved prototype's Board view:
//   Needs you   the decisions waiting on the captain, Studio's and firstmate's, each answered
//               in place: Answer expands the card (a Studio card is the shared component, public/scard.js;
//               a firstmate card is the Inbox's card view) and the result shows inline
//   Runs        every run in flight, Studio tasks and firstmate tasks, one row each with a
//               stage pipeline (crewLayout.stagesFor), stage and round, status, crew, spend,
//               elapsed; rows follow the page's one stream (window.liveListen)
//   Crew        the agents working right now, across every run
// It also shows a firstmate card's answer on the card itself (the Inbox and Needs you).
(() => {
const BD = { members: new Set(), life: 0, refresh: 0, refreshPending: false, revisions: new Map(), sequences: new Map(), detailLife: new Map(), requests: new Map(), cardRevision: 0, cardRequest: 0, overviewIds: [], ended: [], mounted: new Map(), cstate: new Map(), live: false, list: null, det: new Map(), cards: null, pol: null, loading: false, open: new Set(), hidden: new Set(), answered: [], t: new Map() };
const api = async (u, signal) => { const r = await fetch(u, { signal }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const DAY = 86400000;
const ranToday = (r) => today(r.updatedAt) || today(r.endedAt);
const inFlight = (r) => ["queued", "running", "waiting", "paused"].includes(r.status) || (r.status === "failed" && clock() - Date.parse(r.endedAt || r.updatedAt) < DAY);
const zhOn = () => zh();
const loc = (x) => L(x);
const oneLine = (t) => { const s = String(t || "").replace(/\s+/g, " ").trim(); const m = /^(.{20,}?[.!?。])(\s|$)/.exec(s); const one = m ? m[1] : s; return one.length > 160 ? one.slice(0, 157) + "…" : one; };
const fmtEl = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60), hh = Math.floor(m / 60); return hh ? `${hh}h ${String(m % 60).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`; };
const usd = (n) => `$${n.toFixed(2)}`;
// the Board's clock: one seam for every "today" and elapsed figure (the tests pin the page's clock)
const clock = () => (typeof window.crewClock === "function" ? window.crewClock() : Date.now());
const today = (iso) => { if (!iso) return false; const d = new Date(iso), n = new Date(clock()); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };

// ---------- data ----------
const revision = id => BD.revisions.get(id) || 0;
function invalidateRun(id) {
  BD.revisions.set(id, revision(id) + 1);
  clearTimeout(BD.t.get(id)); BD.t.delete(id);
  BD.requests.get(id)?.abort(); BD.requests.delete(id);
}
function requestStudio() { BD.refresh++; BD.refreshPending = true; if (!BD.loading) void loadStudio(false); }
async function loadStudio(request = true) {
  if (request) { BD.refresh++; BD.refreshPending = true; }
  if (BD.loading) return; BD.loading = true;
  try {
    do {
      BD.refreshPending = false;
      const generation = BD.refresh, life = BD.life, cardRevision = BD.cardRevision;
      const controller = new AbortController(); BD.listRequest = controller;
      try {
        const [l, c, pol] = await Promise.all([api("/api/wruns", controller.signal), api("/api/scards?open=1", controller.signal), BD.pol ? Promise.resolve(BD.pol) : api("/api/policies", controller.signal).catch(() => ({ org: {} }))]);
        if (generation !== BD.refresh || life !== BD.life || S.route?.name !== "board") continue;
        BD.pol = pol; if (cardRevision === BD.cardRevision && S.conn !== "down") { BD.cards = c.cards || []; prune(true); }
        const all = l.runs || []; const members = new Set(all.map(r => r.id));
        for (const id of BD.members) if (!members.has(id)) { invalidateRun(id); BD.det.delete(id); }
        BD.members = members;
        // Only this accepted default list decides membership. Detail requests never add IDs.
        BD.overviewIds = all.filter(window.crewWorkflowOverview.active).map(r => r.id);
        BD.list = all.filter(inFlight).map(r => r.id);
        BD.ended = all.filter(r => !inFlight(r) && r.endedAt && clock() - Date.parse(r.endedAt) < DAY);
        for (const r of all) {
          const old = BD.det.get(r.id); BD.det.set(r.id, old ? { ...old, ...r } : { ...r, nodes: {}, def: null, steps: [] });
          if ((!old?.def || BD.detailLife.get(r.id) !== BD.life || old.updatedAt !== r.updatedAt) && (inFlight(r) || ranToday(r) || BD.overviewIds.includes(r.id))) void loadRun(r.id);
        }
        soft();
      } catch { if (life === BD.life) { BD.list ??= []; BD.cards ??= []; } }
      finally { if (BD.listRequest === controller) BD.listRequest = null; }
    } while (BD.refreshPending && S.route?.name === "board");
  } finally { BD.loading = false; }
}
async function loadRun(id) {
  if (!BD.members.has(id) || S.route?.name !== "board") return;
  BD.requests.get(id)?.abort();
  const controller = new AbortController(), generation = revision(id), life = BD.life; BD.requests.set(id, controller);
  try {
    const r = await api(`/api/wruns/${id}`, controller.signal);
    if (life !== BD.life || generation !== revision(id) || BD.requests.get(id) !== controller || !BD.members.has(id) || S.route?.name !== "board") return;
    const sequence = Math.max(0, ...(r.events || []).map(e => e.seq || 0));
    if (sequence < (BD.sequences.get(id) || 0)) return;
    BD.sequences.set(id, sequence);
    BD.detailLife.set(id, life); BD.det.set(id, r); patchRow(id);
  } catch {} finally { if (BD.requests.get(id) === controller) BD.requests.delete(id); }
}
async function loadCards() {
  if (S.conn === "down") return;
  const generation = BD.cardRevision, request = ++BD.cardRequest, life = BD.life;
  try { const c = await api("/api/scards?open=1"); if (generation !== BD.cardRevision || request !== BD.cardRequest || life !== BD.life || S.route?.name !== "board" || S.conn === "down") return; BD.cards = c.cards || []; }
  catch { return; } prune(true); soft();
}
// a decision that is no longer open (answered here or elsewhere, cancelled, its run ended) leaves nothing behind:
// its open flag, its Studio card state and its mounted card go; the open list is the authority
// A field still focused inside a card that left is let go (data loads only, not a render in progress): otherwise the
// Board's soft redraw waits for its blur and keeps showing the card that left, and the captain's next click (the blur)
// redraws the page between mousedown and mouseup, so the click is lost.
function prune(release = false) {
  const live = new Set([...(BD.cards || []).filter((c) => c.status === "open").map((c) => c.id), ...S.pending.map((c) => c.id)]);
  if (release) { const a = document.activeElement; for (const [id, m] of BD.mounted) if (!live.has(id) && a && m.box?.contains(a)) a.blur(); }
  for (const m of [BD.open, BD.cstate, BD.mounted]) for (const id of [...m.keys()]) if (!live.has(id)) m.delete(id);
}

// ---------- stages ----------
// a firstmate task's node, placed on the code-firstmate definition's node ids (public/graph-layout.js holds the grouping)
const FM_NODE = { dispatch: "dispatch", door: "door", plan: "plan", failfirst: "plan", build: "build", ci: "ci", review: "review", gates: "merge-card", merge: "merge-card", done: "done" }; // fm's "merge" is its merge card raised
const FM_DEF = { id: "code-firstmate", nodes: [...new Set([...Object.values(FM_NODE), "merge"])].map((id) => ({ id })) };
const stagesFor = (def) => { const st = window.crewLayout?.stagesFor(def) || [];
  return st.length ? st : def.nodes.filter((n) => n.kind !== "card").map((n) => ({ id: n.id, label: n.label || n.id, nodes: [n.id] })); };
const stageLabel = (st) => window.crewI18n.zhField(lang, st.label, st.label_tw);
const SEGN = { done: () => T("done", "完成"), running: () => T("running", "進行中"), human: () => T("waiting on you", "等你"), failed: () => T("failed", "失敗"), "": () => T("not started", "未開始") };
function studioStages(r) {
  if (!r.def) return { stages: [], segs: [], cur: -1 };
  const stages = stagesFor(r.def), nodes = r.nodes || {};
  const segs = stages.map((st) => { const ns = st.nodes.map((m) => nodes[m]).filter(Boolean);
    if (ns.some((n) => n.state === "running" && n.waiting === "card")) return "human";
    if (ns.some((n) => n.state === "running")) return "running";
    if (ns.some((n) => n.state === "failed" || n.state === "error")) return "failed";
    if (ns.some((n) => n.state === "passed" || n.state === "skipped")) return "done";
    return ""; });
  if (r.status === "succeeded") return { stages, segs: segs.map(() => "done"), cur: stages.length - 1 };
  let cur = -1; segs.forEach((s, i) => { if (s === "running" || s === "human" || s === "failed") cur = i; });
  if (cur < 0) { segs.forEach((s, i) => { if (s === "done") cur = i; }); cur = Math.min(stages.length - 1, cur + 1); }
  for (let i = 0; i < cur; i++) if (!segs[i]) segs[i] = "done"; // a stage the run's branch went around (Plan on a two-way change)
  return { stages, segs, cur };
}
function roundOf(r, st) {
  if (!st || !r.def) return null;
  const loops = r.def.nodes.filter((n) => n.kind === "loop" && n.args?.producer && st.nodes.includes(n.args.producer));
  for (const lp of loops) { const v = r.nodes?.[lp.args.producer]?.visits || 0; if (!v) continue;
    const cap = (lp.args.round_cap != null ? Number(lp.args.round_cap) : Number(BD.pol?.org?.round_cap ?? 3)) + Number(r.ctx?.policyAdds?.round_cap ?? 0) + Number(r.nodes?.[lp.id]?.extra ?? 0);
    return { n: v, cap }; }
  return null;
}
function fmStages(t) {
  const stages = stagesFor(FM_DEF); const at = FM_NODE[t.node] || "dispatch";
  const cur = Math.max(0, stages.findIndex((s) => s.nodes.includes(at)));
  const now = t.status === "failed" ? "failed" : t.status === "needs-you" ? "human" : t.status === "done" ? "done" : "running";
  return { stages, segs: stages.map((_, i) => (i < cur ? "done" : i === cur ? now : "")), cur };
}

// ---------- rows ----------
const pipe = (p) => h("div", { class: "pipe", role: "img", "aria-label": p.stages.map((st, i) => `${stageLabel(st)}: ${SEGN[p.segs[i]]()}`).join(", ") },
  p.stages.map((st, i) => h("i", { class: `${p.segs[i]}${p.segs[i] === "running" ? " pulse" : ""}`, title: `${stageLabel(st)}: ${SEGN[p.segs[i]]()}${p.notes?.[i] ? ` · ${p.notes[i]}` : ""}` })));
function studioCrew(r) {
  const out = []; if (!r.def) return out;
  for (const n of r.def.nodes) { const rn = r.nodes?.[n.id];
    if (n.kind !== "agent" || rn?.state !== "running" || rn.waiting) continue;
    const st = (r.steps || []).filter((s) => s.node === n.id).at(-1);
    const prov = rn.agent?.provider || st?.provider || null, model = rn.agent?.model || st?.model || null;
    out.push({ key: `${r.id}:${n.id}`, name: n.id, title: [`${n.label || n.id} (${r.id})`, prov, model].filter(Boolean).join(" · "), href: `#/run/${encodeURIComponent(r.id)}` }); }
  return out;
}
const fmCrew = (t) => S.crew.filter((c) => c.alive && (!t || c.task === t.id)).map((c) => ({ key: c.actor, name: c.name, title: [c.actor, c.vendor, c.model].filter(Boolean).join(" · "), href: `#/crew/${encodeURIComponent(c.actor)}` }));
const jobsOf = (r) => Object.values(r.nodes || {}).flatMap((n) => n?.data?.jobs || []);
const spendOf = (r) => { const js = jobsOf(r).filter((j) => j.cost?.usd != null); return js.length ? js.reduce((a, j) => a + j.cost.usd, 0) : null; };
// a job is dated by its step, else by its node's start or end; a job with neither is not dated, so not counted as today's
const spendToday = (r) => { const at = new Map((r.steps || []).filter((s) => s.job).map((s) => [s.job, s.startedAt]));
  return Object.values(r.nodes || {}).flatMap((n) => (n?.data?.jobs || []).map((j) => [j, at.get(j.id) || n.startedAt || n.endedAt]))
    .filter(([j, when]) => j.cost?.usd != null && today(when)).reduce((a, [j]) => a + j.cost.usd, 0); };
function studioRow(id) {
  const r = BD.det.get(id); if (!r) return null;
  const p = studioStages(r); const st = p.stages[p.cur];
  p.notes = p.stages.map((s) => s.nodes.filter((m) => ["running", "failed", "error"].includes(r.nodes?.[m]?.state)).map((m) => r.def.nodes.find((n) => n.id === m)?.label || m).join(", "));
  const rd = roundOf(r, st); const crew = studioCrew(r); const sp = spendOf(r);
  const go = () => { location.hash = `#/run/${encodeURIComponent(id)}`; };
  const row = h("div", { class: "rrow bd-row", "data-run": id, "data-kind": "studio", tabindex: 0, role: "link", "aria-label": `${r.title}, ${r.workflow}`, onclick: (e) => { if (!e.target.closest("a")) go(); }, onkeydown: (e) => { if (e.key === "Enter") go(); } },
    h("div", { style: "min-width:0" }, h("div", { class: "run-t" }, h("span", { class: "tid" }, r.id), h("span", { title: r.request || r.title, "data-task-title": id }, r.title)),
      h("div", { class: "run-s" }, h("span", {}, `${r.workflow} v${r.version}`), h("span", {}, T(`updated ${ago(r.updatedAt)}`, `${ago(r.updatedAt)}更新`)))),
    h("div", { class: "c-stage", style: "min-width:0" }, pipe(p), h("div", { class: "pipe-l" }, st ? `${p.cur + 1}/${p.stages.length} ${stageLabel(st)}${rd ? T(` · round ${rd.n}/${rd.cap}`, ` · 第 ${rd.n}/${rd.cap} 回合`) : ""}` : "—")),
    h("div", {}, window.runStateBadge({ ...r, merged: !!r.ctx?.merged })),
    h("div", { class: "stack c-crew" }, crew.map((c) => { const a = avaFor(c.name); a.title = c.title; return a; })),
    h("div", { class: "c-cost" }, h("div", { class: "spend" }, h("div", { class: "kv num" }, h("span", {}, sp == null ? "—" : usd(sp)), h("span", { class: "faint" }, T("no cap", "無上限"))))),
    h("div", { class: "num faint c-el", "data-since": r.createdAt, "data-until": r.endedAt || "" }, fmtEl((r.endedAt ? Date.parse(r.endedAt) : clock()) - Date.parse(r.createdAt))));
  if (r.status === "failed" && r.error) row.append(h("div", { class: "err" }, icon("alert"), h("span", { class: "mono", style: "flex:1;min-width:0;overflow-wrap:anywhere" }, r.error),
    h("a", { class: "btn", href: `#/run/${encodeURIComponent(id)}` }, T("Open task", "打開任務"))));
  return row;
}
function fmRow(t) {
  const p = fmStages(t); const st = p.stages[p.cur]; const crew = fmCrew(t);
  const go = () => { location.hash = `#/task/${encodeURIComponent(t.id)}`; };
  const until = t.status === "failed" ? t.lastTs : null;
  const row = h("div", { class: "rrow bd-row", "data-run": t.id, "data-kind": "firstmate", tabindex: 0, role: "link", "aria-label": `${t.id} ${t.title || ""}`, onclick: (e) => { if (!e.target.closest("a")) go(); }, onkeydown: (e) => { if (e.key === "Enter") go(); } },
    h("div", { style: "min-width:0" }, h("div", { class: "run-t" }, h("span", { class: "tid" }, t.id), h("span", { title: t.title }, t.title || L(t.lastSummary))),
      h("div", { class: "run-s" }, h("span", {}, T("code-firstmate · firstmate", "code-firstmate · firstmate")), doorBadge(t.door), t.pr ? h("a", { href: prUrl(t.pr), target: "_blank", rel: "noopener" }, `PR #${t.pr}`) : null,
        h("span", {}, T(`updated ${ago(t.lastTs)}`, `${ago(t.lastTs)}更新`)))),
    h("div", { class: "c-stage", style: "min-width:0" }, pipe(p), h("div", { class: "pipe-l" }, `${p.cur + 1}/${p.stages.length} ${stageLabel(st)}${t.round && st?.id === "build" ? T(` · round ${t.round}`, ` · 第 ${t.round} 回合`) : ""}`)),
    h("div", {}, window.runStateBadge(t.waitingOn === "firstmate" ? { status: "waiting", ctx: { firstmateQuestion: true } } : t.status === "needs-you" ? { status: "waiting" } : t.status === "done" ? { status: "succeeded", merged: true } : { status: t.status })),
    h("div", { class: "stack c-crew" }, crew.map((c) => { const a = avaFor(c.name); a.title = c.title; return a; })),
    h("div", { class: "c-cost" }, h("div", { class: "spend" }, h("div", { class: "kv num" }, h("span", { title: T("firstmate does not record spend", "firstmate 沒有記錄花費") }, "—")))),
    h("div", { class: "num faint c-el", "data-since": t.firstTs, "data-until": until || "" }, fmtEl((until ? Date.parse(until) : clock()) - Date.parse(t.firstTs))));
  if (t.status === "failed" && t.failure) row.append(h("div", { class: "err" }, icon("alert"), h("span", { class: "mono", style: "flex:1;min-width:0;overflow-wrap:anywhere" }, `${t.failure.type}: ${L(t.failure.summary)}`)));
  return row;
}
// one run changed: replace its row (and its error line) only
function patchOverview() { const box = document.getElementById("workflowOverview"); if (box) box.replaceChildren(window.crewWorkflowOverview.render(BD.overviewIds.map(id => BD.det.get(id)).filter(Boolean), BD.cards || [])); }
function patchRow(id) {
  patchOverview();
  const old = document.querySelector(`[data-run="${CSS.escape(id)}"]`); const row = studioRow(id); if (!old || !row) return;
  hydrateIcons(row); old.replaceWith(row); updateHead();
  // the page now shows this run as it is: a later soft() with nothing else new (another stream's wrun listener) redraws nothing
  BD.sig = boardSig();
}

// ---------- decisions ----------
function decisions() {
  const studio = (BD.cards || []).filter((c) => c.status === "open" && !BD.hidden.has(c.id)).map((c) => ({ source: "studio", id: c.id, data: c, ts: c.createdAt, run: c.run, kind: c.kind, title: loc(c.title), why: oneLine(loc(c.sections)?.why || c.body) }));
  const fm = S.pending.filter((c) => !BD.hidden.has(c.id)).map((c) => { const d = LD(c.details) || {};
    return { source: "firstmate", id: c.id, data: c, ts: c.ts, run: c.task, kind: c.purpose || c.kind || T("decision", "決定"), title: d.title || c.title, why: oneLine(d.explanation || (Array.isArray(d.why) ? (typeof d.why[0] === "string" ? d.why[0] : d.why[0]?.text) : d.why)) }; });
  return [...studio, ...fm].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
}
// a decision, mounted in place. A Studio card is the shared card component (public/scard.js); its state (ticks, note,
// door tick, refusal, answer in flight) lives in BD.cstate by card id until it is answered, so Close and Answer again keep it.
// A firstmate card is the Inbox's card view (its state lives in app.js's sel and takeover.js's doorSel).
const studioState = (id) => { if (!BD.cstate.has(id)) BD.cstate.set(id, {}); return BD.cstate.get(id); };
function mountDecision(el, dc) {
  if (dc.source === "studio") return window.crewCard.mountCard(el, dc.data, { inbox: true, state: studioState(dc.id),
    onAnswered: (c) => { BD.cstate.delete(c.id); answered(c.id, `${c.options?.find((o) => o.id === c.answer?.choice)?.label || c.answer?.choice || ""} ✓`); } });
  el.replaceChildren(cardView(dc.data)); hydrateIcons(el); return null;
}
window.crewBoard = { mountDecision, held: () => ({ open: [...BD.open], cstate: [...BD.cstate.keys()], mounted: [...BD.mounted.keys()] }) }; // held: what the Board keeps per card (tests)
function answered(id, text) {
  BD.hidden.add(id); BD.open.delete(id); BD.answered = [{ id, text, at: Date.now() }, ...BD.answered.filter((a) => a.id !== id)].slice(0, 8);
  if (["board", "inbox"].includes(S.route?.name)) render();
  setTimeout(loadCards, 200);
}
// a firstmate card's answer, from the card itself (takeover.js confirmSend reports here)
window.cardResults = new Map();
window.onCardAnswered = (c, ok, text) => { if (!ok && window.cardResults.get(c.id)?.ok) return; window.cardResults.set(c.id, { ok, text }); if (ok) { if (S.route?.name === "inbox") window.inboxRecorded?.(c.id); answered(c.id, text); } else render(); };
{ const base = cardView; cardView = function (c) { const el = base(c); const r = window.cardResults.get(c.id);
    const busy = window.answerInFlight?.has(c.id);
    const line = h("div", { class: `bd-result ${r ? (r.ok ? "ok" : "bad") : ""}`, role: "status", "data-answer-result": c.id }, busy ? T("Sending…", "送出中…") : r ? r.text : "");
    (el.querySelector(".actions") || el).after(line);
    if (r?.ok || busy) el.querySelectorAll(".actions .btn, .opt, input, [data-check-answer]").forEach((b) => (b.disabled = true));
    return el; }; }
function needRow(dc) {
  const isOpen = BD.open.has(dc.id); const merge = /merge/i.test(dc.kind || "");
  const toggle = () => { isOpen ? BD.open.delete(dc.id) : BD.open.add(dc.id); render(); };
  const rows = [h("div", { class: `need${isOpen ? " open" : ""}`, "data-need": dc.id, "data-source": dc.source, "data-need-scard": dc.source === "studio" ? dc.id : null },
    h("div", { class: "need-ic", style: `background:var(--${merge ? "ok" : "human"}-soft);color:var(--${merge ? "ok" : "human"})` }, icon(merge ? "pr" : "human")),
    h("div", { style: "min-width:0" }, h("div", { class: "need-t" }, dc.run ? h("span", { class: "tid" }, dc.run) : null, " ", dc.title),
      h("div", { class: "need-d" }, `${dc.kind}${dc.why ? ". " + dc.why : ""}`)),
    h("div", { class: "need-r" }, h("span", { class: "faint num", style: "font-size:12px" }, ago(dc.ts)),
      h("button", { class: "btn", "data-need-open": dc.id, "aria-expanded": String(isOpen), onclick: toggle }, isOpen ? T("Close", "收合") : T("Answer", "回答"))))];
  if (isOpen) { // a live re-render keeps the mounted card as it is (the same elements, mid-click included); the captain's own actions redraw it
    const key = JSON.stringify(dc.data) + lang; const m = BD.mounted.get(dc.id);
    if (m && dc.source === "studio") { if (m.key !== key) { m.ctl?.update(dc.data); m.key = key; } rows.push(m.box); } // the component redraws itself
    else if (BD.live && m && m.key === key) rows.push(m.box);
    else { const box = h("div", { class: "need-x", "data-need-card": dc.id }); const ctl = mountDecision(box, dc); BD.mounted.set(dc.id, { key, box, ctl }); rows.push(box); } }
  else BD.mounted.delete(dc.id);
  return rows;
}
const answeredRows = () => BD.answered.filter((a) => Date.now() - a.at < 10 * 60000).map((a) => h("div", { class: "need bd-answered", "data-answered": a.id }, h("div", { class: "need-ic", style: "background:var(--ok-soft);color:var(--ok)" }, icon("check")),
  h("div", { class: "need-d" }, h("span", { class: "tid" }, a.id), " ", a.text), h("span", { class: "faint", style: "font-size:12px" }, ago(new Date(a.at).toISOString()))));

// ---------- the page ----------
function counts() {
  const studio = (BD.list || []).map((id) => BD.det.get(id)).filter(Boolean);
  const fm = S.tasks.filter((t) => t.status !== "done" && t.status !== "idle");
  const crew = [...(window.studioAgents?.members() || []), ...fmCrew(null)];
  const ran = [...BD.det.values()].filter(ranToday);
  const spend = ran.reduce((a, r) => a + spendToday(r), 0), costed = [...BD.det.values()].some((r) => jobsOf(r).some((j) => j.cost?.usd != null));
  return { studio, fm, crew, spend: costed ? spend : null };
}
function updateHead() { const c = counts(); const el = document.getElementById("boardSub"); if (el) el.textContent = subtitle(c); }
const subtitle = (c) => !window.studioAgents?.ready() ? window.studioAgents?.status() || T("Checking crew status…","正在確認船員狀態…") : T(`${c.studio.length + c.fm.length} tasks, ${c.crew.length} crew on duty, ${c.spend == null ? "—" : usd(c.spend)} today`, `${c.studio.length + c.fm.length} 個任務、${c.crew.length} 位船員值班、今天 ${c.spend == null ? "—" : usd(c.spend)}`);
function viewBoard() {
  if (BD.list === null) loadStudio();
  if (BD.cards !== null) prune();
  BD.sig = boardSig();
  const c = counts(); const ds = decisions();
  const ans = answeredRows();
  return h("div", { class: "page bd-page", "data-board": "1" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Board", "看板")), h("p", { id: "boardSub" }, BD.list === null ? T("Loading tasks…", "載入中…") : subtitle(c))),
      h("div", { class: "actions" }, ghBar(), h("a", { class: "btn", href: "#/crew" }, icon("crew"), T("Crew", "船員")), h("a", { class: "btn primary", href: "#/runs" }, icon("plus"), T("New task", "新任務")))),
    // the operator turned the OS sandbox and egress proxy off (CREW_LOCAL_UNRESTRICTED=1): said above everything else
    BD.pol?.execution === "local-unrestricted" && window.crewUnrestrictedNotice ? window.crewUnrestrictedNotice() : null,
    h("section", { "aria-labelledby": "needsH" },
      h("div", { class: "sec-head" }, h("h2", { id: "needsH" }, T("Needs you", "等你處理")), h("span", { class: "badge human", id: "needsCount" }, String(ds.length))),
      h("div", { class: "card needs", id: "needs" }, ds.length ? ds.flatMap(needRow) : h("div", { class: "empty" }, icon("inbox"), h("b", {}, T("Nothing needs you", "沒有等你的事")), T("Decisions and reviews land here the moment they are raised.", "一有決定或審查就會出現在這裡。")), ans)),
    h("div", { id: "workflowOverview" }, window.crewWorkflowOverview.render(BD.overviewIds.map(id => BD.det.get(id)).filter(Boolean), BD.cards || [])),
    h("section", { "aria-labelledby": "runsH" },
      h("div", { class: "sec-head" }, h("h2", { id: "runsH" }, T("Tasks", "任務")), h("span", { class: "faint", id: "runsCount" }, T(`${c.studio.length + c.fm.length} in flight`, `${c.studio.length + c.fm.length} 個進行中`))),
      h("div", { class: "card runs-table", id: "runs" },
        h("div", { class: "rrow head" }, h("span", {}, T("Task", "任務")), h("span", {}, T("Stage", "階段")), h("span", {}, T("Status", "狀態")), h("span", { class: "c-crew" }, T("Crew", "船員")), h("span", { class: "c-cost" }, T("Spend", "花費")), h("span", { class: "c-el" }, T("Elapsed", "經過"))),
        BD.list === null ? [1, 2, 3].map(() => h("div", { class: "rrow" }, h("div", { class: "skel", style: "height:12px;width:70%" }), h("div", { class: "skel", style: "height:8px" }), h("div", { class: "skel", style: "height:18px;width:80px" }), h("div"), h("div"), h("div")))
          : c.studio.length + c.fm.length ? [...c.studio.map((r) => studioRow(r.id)), ...c.fm.map(fmRow)] : h("div", { class: "empty" }, icon("workflow"), h("b", {}, T("No task in flight", "沒有進行中的任務")), h("a", { href: "#/runs" }, T("Start one", "開始一個"))))),
    (BD.ended || []).length ? h("section", { "aria-labelledby": "endedH" },
      h("div", { class: "sec-head" }, h("h2", { id: "endedH" }, T("Ended", "已結束")), h("span", { class: "faint" }, T("in the last day", "最近一天"))),
      h("div", { class: "card needs bd-ended" }, BD.ended.map((r) => h("a", { class: "need bd-ended-row", href: `#/run/${encodeURIComponent(r.id)}`, "data-ended-run": r.id },
        h("span", { class: "tid" }, r.id), h("div", { style: "min-width:0" }, h("div", { class: "need-t" }, r.title), h("div", { class: "need-d" }, `${r.workflow} v${r.version}${r.cancelReason ? ` · ${r.cancelReason}` : ""}`)),
        h("div", { class: "need-r" }, window.runStateBadge(r), h("span", { class: "faint num", style: "font-size:12px" }, ago(r.endedAt))))))) : null,
    crewSection(c));
}
// the crew on duty: every Studio agent working (public/runtime.js's /api/wruns/agents list) and firstmate's live rounds
const crewSection = (c) => h("section", { "aria-labelledby": "crewH" },
      h("div", { class: "sec-head" }, h("h2", { id: "crewH" }, T("Crew on duty", "值班船員")), h("span", { class: "faint", id: "crewSum2" }, window.studioAgents?.ready() ? T(`${c.crew.length} working`, `${c.crew.length} 位工作中`) : window.studioAgents?.status())),
      h("div", { class: "card crewline" }, h("div", { class: "avas", "data-crew-strip": "1" }, c.crew.length ? c.crew.map((m) => { const a = h("a", { class: "ava lg", href: m.href, title: m.title, "aria-label": m.title, style: avaFor(m.name).getAttribute("style") }, m.name.slice(0, 2), h("span", { class: "sd pulse", style: "background:var(--accent);color:var(--accent)" })); return a; })
        : h("span", { class: "faint" }, window.studioAgents?.ready() ? T("Nobody is working right now.", "目前沒有人在工作。") : window.studioAgents?.status())), h("a", { class: "btn ghost", href: "#/crew" }, T("Open crew", "打開船員"))));
// the agent list changed: patch the crew strip and the subtitle in place, as patchRow does a row (a full redraw between
// a mouse-down and its mouse-up would swallow a click on another row); unchanged, nothing is touched
function patchCrew() {
  const old = document.querySelector('[aria-labelledby="crewH"]'); if (!old) return false;
  const fresh = crewSection(counts()); hydrateIcons(fresh); if (fresh.outerHTML !== old.outerHTML) old.replaceWith(fresh); updateHead(); BD.sig = boardSig(); return true;
}
window.crewBoardAgentsChanged = () => S.route?.name === "board" && !S.route.arg && patchCrew();
routes.board = viewBoard;
// re-renders from live data (app.js's stream handlers and the loaders here) go through soft(): mark them as live
// and a live update that changes nothing the Board shows does not redraw it (the crew's log tails move every few seconds;
// a redraw between a mouse-down and its mouse-up would swallow the captain's click)
const boardSig = () => JSON.stringify([lang, window.studioAgents?.ready(), window.studioAgents?.status(), window.studioAgents?.members(), window.crewFirstmateWelcomeSignature?.(), S.tasks.filter((t) => t.status !== "done" && t.status !== "idle").map((t) => [t.id, t.status, t.node, t.round, t.title, t.door, t.pr, t.failure?.type]),
  S.pending.map((c) => [c.id, c.ts]), S.crew.filter((c) => c.alive).map((c) => [c.actor, c.task, c.vendor, c.model]), BD.list, BD.overviewIds, BD.cards, (BD.ended || []).map((r) => [r.id, r.status, r.result, r.endedAt]), [...BD.det.values()].map((r) => [r.id, r.status, r.updatedAt, r.nodes]), BD.answered.length, [...BD.open], [...BD.hidden]]);
{ const baseSoft = soft; soft = function () {
    if (S.route?.name === "board" && boardSig() === BD.sig) return updateNav();
    BD.live = true; try { return baseSoft(); } finally { BD.live = false; } }; }

// ---------- live: the page's one stream ----------
window.liveListen("wrun", (m) => { let d; try { d = JSON.parse(m.data); } catch { return; }
  const sequence = d.event?.seq;
  if (sequence && sequence <= (BD.sequences.get(d.id) || 0)) return;
  if (sequence) BD.sequences.set(d.id, sequence);
  const previous = BD.det.get(d.id);
  const refreshList = BD.loading || !BD.members.has(d.id) || d.deleted || d.archived !== undefined || (previous && d.status && inFlight(previous) !== inFlight({ ...previous, status: d.status }));
  invalidateRun(d.id);
  if (d.deleted || d.archived === true) {
    BD.members.delete(d.id); BD.det.delete(d.id); BD.overviewIds = BD.overviewIds.filter(id => id !== d.id);
    BD.list = (BD.list || []).filter(id => id !== d.id); BD.ended = BD.ended.filter(r => r.id !== d.id);
    if (S.route?.name === "board") { patchOverview(); soft(); }
  } else {
    const r = BD.det.get(d.id);
    if (r && BD.members.has(d.id) && d.nodes) { if (d.event) { r.events ??= []; if (!r.events.some(e => e.seq === d.event.seq)) r.events.push(d.event); } r.status = d.status || r.status; for (const [k, n] of Object.entries(d.nodes)) r.nodes[k] = { ...(r.nodes[k] || {}), ...n }; if (S.route?.name === "board") patchRow(d.id); }
    if (BD.members.has(d.id) && S.route?.name === "board") BD.t.set(d.id, setTimeout(() => { BD.t.delete(d.id); void loadRun(d.id); }, 250));
  }
  // archived:false means refresh for an unarchive; membership still comes only from the list.
  if (S.route?.name === "board" && refreshList) requestStudio();
});
window.liveListen("scard", () => { BD.cardRevision++; clearTimeout(BD.ct); if (S.route?.name === "board") void loadCards(); });
addEventListener("crew:live", () => { if (S.route?.name === "board") { BD.cardRevision++; void loadCards(); requestStudio(); } });
// elapsed ticks without re-rendering
setInterval(() => { if (S.route?.name !== "board") return; document.querySelectorAll(".bd-row .c-el[data-since]").forEach((el) => { if (!el.dataset.until) el.textContent = fmtEl(clock() - Date.parse(el.dataset.since)); }); }, 1000);
// coming back to the Board shows fresh runs
addEventListener("hashchange", () => {
  const board = (location.hash.replace(/^#\/?/, "") || "board").startsWith("board");
  BD.life++; BD.refresh++; clearTimeout(BD.ct); BD.cardRequest++;
  BD.listRequest?.abort(); for (const id of [...BD.requests.keys(), ...BD.t.keys()]) invalidateRun(id);
  if (board) void loadStudio(); else BD.refreshPending = false;
});

// the Inbox: decisions only; a card answered here says so at the top too
{ const orig = routes.inbox; routes.inbox = (id) => { const ans = answeredRows(); return [ans.length ? h("div", { class: "page bd-inbox-answered" }, h("div", { class: "card needs" }, ans)) : null, orig(id)]; }; }
})();
