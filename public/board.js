// The Board (docs/units/board.md): a task overview. One row per Task, Studio runs and firstmate tasks alike,
// ordered Waiting for you, Stuck, Running, Done today, with filter tabs and their counts:
//   status · title with run, workflow and project · a milestone track (the workflow's main path, see milestones())
//   with the current milestone marked and its round · Now (who is working: seat and model; or which card waits,
//   with a link to it in the Inbox) · an overlap badge when another open Task touches the same files · elapsed
// Selecting a row opens a detail panel with only that Task's visited path (loops as "round N ↺", the current
// node ringed), its recent events, and links to its full graph and its page. The Board shows no card and no
// workflow graph: a decision card lives in the Inbox only, a graph on the Task's page.
// Rows follow the page's one stream (window.liveListen); a live redraw keeps the selected row, the focus and the scroll.
// It also shows a firstmate card's answer on the card itself (the Inbox).
(() => {
const BD = { members: new Set(), life: 0, refresh: 0, refreshPending: false, revisions: new Map(), sequences: new Map(), detailLife: new Map(), requests: new Map(), cardRevision: 0, cardRequest: 0, ended: [], live: false, list: null, det: new Map(), cards: null, pol: null, loading: false, hidden: new Set(), answered: [], t: new Map(), tab: "all", sel: null, focus: null, mode: null };
const api = async (u, signal) => { const r = await fetch(u, { signal }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const DAY = 86400000;
const ranToday = (r) => today(r.updatedAt) || today(r.endedAt);
const inFlight = (r) => ["queued", "running", "waiting", "paused"].includes(r.status) || (r.status === "failed" && clock() - Date.parse(r.endedAt || r.updatedAt) < DAY);
const loc = (x) => L(x);
const oneLine = (t, n = 140) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
// elapsed, compact: 41m, 14h, 3d
const fmtEl = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)), hh = Math.floor(m / 60); return hh >= 24 ? `${Math.floor(hh / 24)}d` : hh ? `${hh}h` : `${m}m`; };
const usd = (n) => `$${n.toFixed(2)}`;
// the Board's clock: one seam for every "today" and elapsed figure (the tests pin the page's clock)
const clock = () => (typeof window.crewClock === "function" ? window.crewClock() : Date.now());
const today = (iso) => { if (!iso) return false; const d = new Date(iso), n = new Date(clock()); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

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
        BD.pol = pol; if (cardRevision === BD.cardRevision && S.conn !== "down") BD.cards = c.cards || [];
        const all = l.runs || []; const members = new Set(all.map(r => r.id));
        for (const id of BD.members) if (!members.has(id)) { invalidateRun(id); BD.det.delete(id); }
        BD.members = members;
        // Only this accepted default list decides membership. Detail requests never add IDs.
        BD.list = all.filter(inFlight).map(r => r.id);
        BD.ended = all.filter(r => !inFlight(r) && r.status !== "failed" && r.endedAt && today(r.endedAt)).map(r => r.id);
        for (const r of all) {
          const old = BD.det.get(r.id); BD.det.set(r.id, old ? { ...old, ...r } : { ...r, nodes: {}, def: null, steps: [] });
          if ((!old?.def || BD.detailLife.get(r.id) !== BD.life || old.updatedAt !== r.updatedAt) && (inFlight(r) || ranToday(r))) void loadRun(r.id);
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
    BD.detailLife.set(id, life); BD.det.set(id, r); soft();
  } catch {} finally { if (BD.requests.get(id) === controller) BD.requests.delete(id); }
}
async function loadCards() {
  if (S.conn === "down") return;
  const generation = BD.cardRevision, request = ++BD.cardRequest, life = BD.life;
  try { const c = await api("/api/scards?open=1"); if (generation !== BD.cardRevision || request !== BD.cardRequest || life !== BD.life || S.route?.name !== "board" || S.conn === "down") return; BD.cards = c.cards || []; }
  catch { return; } soft();
}

// ---------- milestones ----------
// A Task's milestone track comes from its workflow definition alone, so every Task of one definition has the same track:
//  1. the definition's stages when it has any (crewLayout.stagesFor: the nodes' own `stage`, else the built-in grouping,
//     such as code-firstmate's Intake, Door, Plan, Build loop, Gates, Merge, After merge);
//  2. otherwise its main path: from the entry node (the first with no incoming edge), follow at each node the first
//     outgoing edge to a node not yet on the path, an edge with no condition or a forward one (ok, pass, go, approve,
//     accept, merge, done, yes, dispatch) before any other, in definition order. The milestones are the path's work
//     nodes, in order: agents, checks, cards, loops, and hooks that run a role. Bookkeeping hooks (intake, publish,
//     done) are not milestones. A node off the main path (a fix round, an escalation card) is in no milestone: the
//     track then marks the milestone after the last one reached.
const FORWARD = /^(ok|pass|passed|go|approve|approved|accept|accepted|merge|done|yes|dispatch|next|continue)$/i;
const edgeOf = (e) => (Array.isArray(e) ? { from: e[0], to: e[1], when: e[2] ?? null } : e);
function milestones(def) {
  if (!def?.nodes?.length) return [];
  const st = window.crewLayout?.stagesFor(def) || [];
  if (st.length) return st.map((s) => ({ id: s.id, label: window.crewI18n.zhField(lang, s.label, s.label_tw), nodes: s.nodes }));
  const edges = (def.edges || []).map(edgeOf), into = new Set(edges.map((e) => e.to));
  const entry = def.nodes.find((n) => !into.has(n.id)) || def.nodes[0];
  const path = [entry.id], on = new Set(path);
  for (let at = entry.id; ;) {
    const next = edges.filter((e) => e.from === at && !on.has(e.to) && def.nodes.some((n) => n.id === e.to))
      .map((e, i) => ({ e, i, rank: !e.when || FORWARD.test(String(e.when)) ? 0 : 1 })).sort((a, b) => a.rank - b.rank || a.i - b.i)[0];
    if (!next) break; at = next.e.to; path.push(at); on.add(at);
  }
  const work = (n) => ["agent", "check", "card", "loop"].includes(n.kind) || (n.kind === "hook" && !!n.role);
  const list = path.map((id) => def.nodes.find((n) => n.id === id)).filter((n) => n && work(n));
  return (list.length ? list : path.map((id) => def.nodes.find((n) => n.id === id))).map((n) => ({ id: n.id, label: loc(n.label) || n.id, nodes: [n.id] }));
}
// each milestone's state from the run's node states, and the current one
function track(r) {
  const ms = milestones(r.def), nodes = r.nodes || {};
  const segs = ms.map((m) => { const ns = m.nodes.map((id) => nodes[id]).filter(Boolean);
    if (ns.some((n) => n.state === "running" && n.waiting === "card")) return "human";
    if (ns.some((n) => n.state === "running")) return "running";
    if (ns.some((n) => n.state === "failed" || n.state === "error")) return "failed";
    if (ns.some((n) => n.state === "passed" || n.state === "skipped")) return "done";
    return ""; });
  if (r.status === "succeeded") return { ms, segs: segs.map(() => "done"), cur: ms.length - 1 };
  let cur = -1; segs.forEach((s, i) => { if (s === "running" || s === "human" || s === "failed") cur = i; });
  if (cur < 0) { segs.forEach((s, i) => { if (s === "done") cur = i; }); cur = Math.min(ms.length - 1, cur + 1); }
  for (let i = 0; i < cur; i++) if (!segs[i]) segs[i] = "done"; // a milestone the run's branch went around
  return { ms, segs, cur };
}
// the current milestone's round: a refine loop's producer visits against its cap; else the busiest node's visits when above one
function roundOf(r, m) {
  if (!m || !r.def) return null;
  const loops = r.def.nodes.filter((n) => n.kind === "loop" && n.args?.producer && m.nodes.includes(n.args.producer));
  for (const lp of loops) { const v = r.nodes?.[lp.args.producer]?.visits || 0; if (!v) continue;
    // as src/runtime/refine.ts counts it: the loop's own round_cap plus the run's added rounds, else the run's effective policy
    // (project and workflow over org, added rounds included: /api/wruns/<id> roundCap), plus the rounds a budget card extended
    const policy = r.roundCap != null ? Number(r.roundCap) : Number(BD.pol?.org?.round_cap ?? 3) + Number(r.ctx?.policyAdds?.round_cap ?? 0);
    const cap = (lp.args.round_cap != null ? Number(lp.args.round_cap) + Number(r.ctx?.policyAdds?.round_cap ?? 0) : policy) + Number(r.nodes?.[lp.id]?.extra ?? 0);
    return { n: v, cap }; }
  const v = Math.max(0, ...m.nodes.map((id) => r.nodes?.[id]?.visits || 0));
  return v > 1 ? { n: v, cap: null } : null;
}
// a firstmate task's node, placed on the code-firstmate definition's node ids (public/graph-layout.js holds the grouping)
const FM_NODE = { dispatch: "dispatch", door: "door", plan: "plan", failfirst: "plan", build: "build", ci: "ci", review: "review", gates: "merge-card", merge: "merge-card", done: "done" }; // fm's "merge" is its merge card raised
const FM_DEF = { id: "code-firstmate", nodes: [...new Set([...Object.values(FM_NODE), "merge"])].map((id) => ({ id })) };
function fmTrack(t) {
  const ms = milestones(FM_DEF), at = FM_NODE[t.node] || "dispatch";
  const cur = Math.max(0, ms.findIndex((s) => s.nodes.includes(at)));
  const now = t.status === "failed" ? "failed" : t.status === "needs-you" ? "human" : t.status === "done" ? "done" : "running";
  return { ms, segs: ms.map((_, i) => (i < cur ? "done" : i === cur ? now : "")), cur: t.status === "done" ? ms.length - 1 : cur };
}

// ---------- one Task, as the Board shows it ----------
// Stuck, from the run's own state: the run failed (the round cap ending a run is a failure too: result "cap"), or its
// latest step is a round cap (outcome "cap") with nothing run since but the one card the cap raised, still open (the
// round-budget card); or Firstmate is deciding an escalation first (ctx.firstmateQuestion: an agent's question or a card
// Firstmate diagnoses before the captain). A node keeps outcome "cap" after the Task moved on (a rescope to the spec):
// only the steps say whether anything ran after the cap.
// Waiting for you: not stuck, and a card of the run waits on the captain. Done today: it ended today, not failed.
const GROUPS = { you: ["Waiting for you", "等你"], stuck: ["Stuck", "卡住"], run: ["Running", "進行中"], done: ["Done today", "今天完成"] };
const ORDER = { you: 0, stuck: 1, run: 2, done: 3 };
function capStep(r) {
  const steps = r.steps || [], i = steps.findLastIndex((s) => s.outcome === "cap"); if (i < 0) return null;
  const after = steps.slice(i + 1), kind = (s) => s.kind || r.def?.nodes?.find((n) => n.id === s.node)?.kind;
  return !after.length || (after.length === 1 && kind(after[0]) === "card" && ["running", "waiting"].includes(after[0].state)) ? steps[i] : null;
}
function stuckWhy(r) {
  const q = r.ctx?.firstmateQuestion;
  if (q) return T(`Firstmate is deciding first: ${oneLine(q.question, 90)}`, `已交給 Firstmate 判斷：${oneLine(q.question, 60)}`);
  const cap = r.status !== "succeeded" ? capStep(r) : null;
  if (cap) { const label = loc(r.def?.nodes?.find((n) => n.id === cap.node)?.label) || cap.node; return T(`${label}: round cap reached`, `${label}：達到回合上限`); }
  if (r.status === "failed") return oneLine(r.error || loc(r.failure?.title) || T("Failed", "失敗"), 120);
  return null;
}
// who works now: the running agent rounds, each "node · seat · provider model". The seat is the run's own crew resolution
// (/api/wruns/<id> `crew`, from its signed crew-resolved record), named as the team named it; a run without one (a staffed
// code workflow, a Task started before the team) names no seat. The model is the round's own (the captain's pick for the
// node, else its latest step), else the resolution's.
function workers(r) {
  const out = []; if (!r.def) return out;
  for (const n of r.def.nodes) { const rn = r.nodes?.[n.id]; if (rn?.state !== "running" || rn.waiting) continue;
    const st = (r.steps || []).filter((s) => s.node === n.id).at(-1), crew = n.kind === "agent" ? r.crew?.nodes?.[n.id] : null;
    const seat = crew ? (zh() ? crew.label?.zh : crew.label?.en) || crew.seat : null;
    const model = [rn.agent?.provider || st?.provider || crew?.provider, rn.agent?.model || st?.model || crew?.model].filter(Boolean).join(" ");
    out.push([loc(n.label) || n.id, seat, n.kind === "agent" ? model || null : null].filter(Boolean).join(" · ")); }
  return out;
}
const cardTitle = (c) => oneLine(String(loc(c.title) || c.kind || "").replace(/^[A-Z][A-Z ]+ — /, ""), 60);
const studioItem = (id, group) => { const r = BD.det.get(id); return r ? studioView(r, BD.cards || [], group) : null; };
// the card a run waits on now: its oldest open card, never one raised on an earlier visit of its node
const currentCard = (r, cards) => cards.filter((c) => c.status === "open" && c.run === r.id && (!c.node || !c.visit || !r.nodes?.[c.node] || (r.nodes[c.node].visits || 0) === c.visit))
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;
// live S29: a Firstmate proposal is a run of its own (firstmate-proposal) that starts the Task the captain approved. Once it
// started one it is folded into it: no row and no count of its own, and that Task names it ("from Firstmate's proposal
// R-093"). It shows as a row only while it waits for approval, or when it closed without starting anything. Its params
// are hashes (project authority, definition): a row never shows one
const isProposal = (r) => r?.workflow === "firstmate-proposal" || r?.def?.kind === "firstmate-proposal";
const HASHY = /^[0-9a-f]{16,}$/i;
function proposalProject(r) { try { const p = JSON.parse(r.params?.target || "null")?.project; return typeof p === "string" && !HASHY.test(p) ? p : null; } catch { return null; } }
const runProject = (r) => { const p = isProposal(r) ? proposalProject(r) : r.ctx?.project || r.params?.project || null; return typeof p === "string" && !HASHY.test(p) ? p : null; };
const fromProposal = (r) => { const f = r.params?._firstmateProposal; return typeof f === "string" && /^R-\d+$/.test(f) ? f : null; };
const metaLine = (x) => [x.id, x.workflow, x.project || "—", x.from ? T(`from Firstmate's proposal ${x.from}`, `來自 Firstmate 的提案 ${x.from}`) : null].filter(Boolean).join(" · ");
function studioView(r, cards, group) {
  const id = r.id, card = currentCard(r, cards);
  if (!group) group = r.status === "failed" || r.ctx?.firstmateQuestion || (r.status !== "succeeded" && !!capStep(r)) ? "stuck" : card || Object.values(r.nodes || {}).some((n) => n?.waiting === "card") ? "you" : "run";
  const tr = track(r), m = tr.ms[tr.cur];
  const workers0 = workers(r);
  const now = group === "done" ? null : group === "stuck" ? stuckWhy(r)
    : group === "you" ? null
    : r.status === "paused" ? T("Paused", "已暫停") : r.status === "queued" ? T("Queued", "排隊中")
    : workers0.length ? workers0[0] + (workers0.length > 1 ? ` +${workers0.length - 1}` : "")
    : Object.entries(r.nodes || {}).filter(([, n]) => n?.waiting === "external").map(([k]) => T(`Waiting on ${loc(r.def?.nodes?.find((n) => n.id === k)?.label) || k}`, `等待 ${loc(r.def?.nodes?.find((n) => n.id === k)?.label) || k}`))[0] || T("Between steps", "準備下一步");
  return { id, kind: "studio", group, title: r.title, workflow: loc(r.def?.name) || r.workflow, project: runProject(r), from: fromProposal(r), tr, round: roundOf(r, m),
    card: card ? { id: card.id, title: cardTitle(card) } : null, now, state: window.runState({ ...r, merged: !!r.ctx?.merged }), scope: r.ctx?.spec?.scope || [],
    since: r.createdAt, until: r.endedAt || null, href: `#/run/${encodeURIComponent(id)}`, graph: `#/run/${encodeURIComponent(id)}?graph=1`, r };
}
function fmItem(t) {
  const group = t.status === "needs-you" ? "you" : t.status === "failed" ? "stuck" : t.status === "done" ? "done" : "run";
  const tr = fmTrack(t), pend = S.pending.filter((c) => c.task === t.id).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))[0];
  const crew = S.crew.filter((c) => c.alive && c.task === t.id);
  const now = group === "stuck" ? (t.failure ? `${t.failure.type}: ${oneLine(L(t.failure.summary), 100)}` : T("Failed", "失敗"))
    : group === "run" ? (crew.length ? crew.map((c) => [c.name, [c.vendor, c.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")).join(", ") : oneLine(L(t.lastSummary), 90) || T("Working", "工作中")) : null;
  const d = pend ? LD(pend.details) || {} : null;
  return { id: t.id, kind: "firstmate", group, title: t.title || oneLine(L(t.lastSummary), 80), workflow: "code-firstmate", project: t.project, tr,
    round: t.round && ["build", "ci", "review"].includes(t.node) ? { n: t.round, cap: null } : null,
    card: pend ? { id: pend.id, title: oneLine(String(d.title || pend.title || pend.kind || "").replace(/^[A-Z][A-Z ]+ — /, ""), 60) } : null, now,
    state: window.runState(t.status === "needs-you" ? { status: "waiting" } : t.status === "done" ? { status: "succeeded", merged: true } : { status: t.status }), scope: [],
    since: t.firstTs, until: t.status === "failed" || t.status === "done" ? t.lastTs : null, href: `#/task/${encodeURIComponent(t.id)}`, graph: `#/task/${encodeURIComponent(t.id)}`, t };
}
// two scopes meet when one path holds the other (a glob by its static prefix); test paths never count
const scopePaths = (xs) => xs.map((p) => String(p).trim().replace(/^\.\//, "").replace(/\/+$/, "").replace(/\/?[^/]*[*?[].*$/, "")).filter((p) => p !== "tests" && !p.startsWith("tests/"));
const meets = (a, b) => { const x = scopePaths(a), y = scopePaths(b); return x.some((p) => y.some((q) => !p || !q || p === q || p.startsWith(q + "/") || q.startsWith(p + "/"))); };
function items() {
  const studio0 = [...(BD.list || []).map((id) => studioItem(id)), ...(BD.ended || []).map((id) => studioItem(id, "done"))].filter(Boolean);
  const started = new Set(studio0.map((x) => x.from).filter(Boolean));
  const studio = studio0.filter((x) => !(isProposal(x.r) && (x.r.ctx?.childRun || started.has(x.id))));
  const fm = S.tasks.filter((t) => t.status !== "idle" && (t.status !== "done" || today(t.mergedTs || t.lastTs))).map(fmItem);
  const all = [...studio, ...fm];
  const open = all.filter((x) => x.group !== "done" && x.scope.length);
  for (const x of all) x.overlap = x.group === "done" || !x.scope.length ? [] : open.filter((o) => o !== x && meets(x.scope, o.scope)).map((o) => o.id);
  return all.sort((a, b) => ORDER[a.group] - ORDER[b.group] || String(b.since || "").localeCompare(String(a.since || "")));
}

// ---------- the row ----------
const groupWord = (g) => T(...GROUPS[g]);
const stageText = (x) => { const m = x.tr.ms[x.tr.cur]; if (!m) return "—";
  const rd = x.round ? T(` · round ${x.round.n}${x.round.cap ? `/${x.round.cap}` : ""}`, ` · 第 ${x.round.n}${x.round.cap ? `/${x.round.cap}` : ""} 輪`) : "";
  return `${x.group === "done" ? T("Done", "完成") : m.label}${rd} · ${x.tr.cur + 1}/${x.tr.ms.length}`; };
const SEGN = { done: () => T("done", "完成"), running: () => T("running", "進行中"), human: () => T("waiting on you", "等你"), failed: () => T("failed", "失敗"), "": () => T("not started", "未開始") };
const trackEl = (x) => h("span", { class: "tb-track", role: "img", "aria-label": x.tr.ms.map((m, i) => `${m.label}: ${SEGN[x.tr.segs[i]]()}`).join(", ") },
  x.tr.ms.map((m, i) => h("i", { class: `${x.group === "done" ? "done" : i < x.tr.cur ? "past" : i === x.tr.cur ? "cur" : ""}${x.tr.segs[i] ? ` s-${x.tr.segs[i]}` : ""}`, "data-ms": m.id, title: `${m.label}: ${SEGN[x.tr.segs[i]]()}` })));
const inboxLink = (x) => h("a", { class: "tb-inbox", href: `#/inbox/${encodeURIComponent(x.card.id)}`, "data-inbox-link": x.card.id, onclick: (e) => e.stopPropagation() }, T("Go to Inbox →", "去收件匣 →"));
const nowText = (x) => x.group === "you" ? (x.card ? T(`Waiting for you: ${x.card.title}`, `等你：${x.card.title}`) : T("Waiting for you", "等你")) : x.group === "done" ? T(x.state.en, x.state.tw) : x.now || "—";
const overlapEl = (x) => x.overlap.length ? h("span", { class: "tb-overlap", "data-overlap": x.overlap.join(" "), title: T(`Changes the same files as ${x.overlap.join(", ")}: it rebases onto the current base each round`, `和 ${x.overlap.join("、")} 改到同一個檔案：每輪都會 rebase 到最新的 base`) }, T("↻ will rebase", "↻ 會 rebase")) : null;
const elapsed = (x) => x.since ? fmtEl((x.until ? Date.parse(x.until) : clock()) - Date.parse(x.since)) : "—";
// a row is a list item: the selected one carries aria-current, exactly one row of the list is in the tab order (the
// selected one, else the one the keys last moved to, else the first), and its links stay ordinary links. On a phone the
// selected row holds its own detail panel.
function row(x, on, tab, panel) {
  return h("div", { class: `tb-row g-${x.group}${on ? " on" : ""}`, role: "listitem", "aria-current": on ? "true" : null, tabindex: tab ? 0 : -1, id: `tb-${x.id}`,
    "data-task": x.id, "data-kind": x.kind, "data-group": x.group, "aria-label": `${groupWord(x.group)}, ${x.id} ${x.title}`,
    onclick: (e) => { if (e.target.closest("a, button, .tb-detail")) return; pick(x.id, true); } },
    h("span", { class: `tb-st${x.group === "done" ? ` tone-${x.state.tone}` : ""}`, "data-run-state": x.state.key }, h("i", { class: "tb-dot" }), x.group === "done" ? T(x.state.en, x.state.tw) : groupWord(x.group)),
    h("span", { class: "tb-task" }, h("b", { class: "tb-title", title: x.title, "data-task-title": x.id }, x.title), h("span", { class: "tb-meta" }, metaLine(x))),
    h("span", { class: "tb-prog" }, trackEl(x), h("span", { class: "tb-stage" }, stageText(x))),
    h("span", { class: "tb-now" }, x.card && x.group !== "done" ? inboxLink(x) : null, h("span", { class: "tb-now-t", title: nowText(x) }, BD.mode !== "wide" && x.group === "you" && x.card ? x.card.title : nowText(x)), overlapEl(x)),
    h("span", { class: "tb-el num", "data-since": x.since || "", "data-until": x.until || "" }, elapsed(x)), panel);
}

// ---------- the detail panel: this Task's own path ----------
const STEPW = { passed: ["passed", "通過"], failed: ["failed", "失敗"], error: ["error", "錯誤"], skipped: ["skipped", "略過"], superseded: ["replaced", "已取代"], interrupted: ["interrupted", "中斷"] };
function visited(x) {
  if (x.kind === "firstmate") return x.tr.ms.slice(0, x.tr.cur + 1).map((m, i) => ({ node: m.id, name: m.label, visit: 1, note: i < x.tr.cur || x.group === "done" ? T("done", "完成") : x.group === "you" ? T("waiting for you", "等你") : x.group === "stuck" ? T("failed", "失敗") : T("in progress", "進行中"), cur: i === x.tr.cur && x.group !== "done", state: i < x.tr.cur ? "passed" : x.t.status }));
  const r = x.r; if (!r.def) return null;
  const node = (id) => r.def.nodes.find((n) => n.id === id);
  // a bookkeeping hook (no role) is no step of the path unless it failed or is where the Task is now
  const steps = (r.steps || []).filter((s) => { const n = node(s.node); return n && (n.kind !== "hook" || n.role || ["failed", "error", "running", "waiting"].includes(s.state)); });
  const out = [];
  for (const s of steps) { const last = out.at(-1); if (last && last.node === s.node && last.visit === (s.visit || 1)) out.pop(); // a step retried within one visit is one stop
    const n = node(s.node), rn = r.nodes?.[s.node];
    const live = s.state === "running" || s.state === "waiting";
    const what = live && rn?.waiting === "firstmate" ? T("handed to Firstmate", "交給 Firstmate") : live ? (rn?.waiting === "card" || s.state === "waiting" ? T("waiting for you", "等你") : [T("in progress", "進行中"), [s.provider, s.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "))
      : n.kind === "card" && s.outcome && s.outcome !== "ok" ? T(`chose “${n.card?.options?.find((o) => o.id === s.outcome)?.label || s.outcome}”`, `選了「${n.card?.options?.find((o) => o.id === s.outcome)?.label || s.outcome}」`)
      : s.outcome === "cap" ? T("round cap reached", "達到回合上限") : s.outcome && !["ok", "pass"].includes(s.outcome) && s.state === "passed" ? T(`passed (${s.outcome})`, `通過（${s.outcome}）`)
      : T(...(STEPW[s.state] || [s.state, s.state]));
    const loop = (s.visit || 1) > 1 ? T(`round ${s.visit} ↺ · `, `第 ${s.visit} 輪 ↺ · `) : "";
    out.push({ node: s.node, name: loc(n.label) || s.node, visit: s.visit || 1, note: loop + what, state: s.state, cur: false }); }
  // the current node: ringed (Firstmate while it decides an escalation, else the step running or waiting now, else the failed one)
  // (a Task waiting at parallel nodes has each of them ringed)
  const live = out.filter((p) => p.state === "running" || p.state === "waiting");
  if (r.ctx?.firstmateQuestion) out.push({ node: "firstmate", name: "Firstmate", visit: 1, note: stuckWhy(r), state: "running", cur: true });
  else if (live.length) for (const p of live) p.cur = true;
  else if (x.group === "stuck" && out.length) out[out.length - 1].cur = true;
  return out;
}
function events(x) {
  if (x.kind === "firstmate") return x.t.lastTs ? [{ t: x.t.lastTs, text: [L(x.t.lastSummary) || x.t.lastType] }] : [];
  const tl = window.crewTimeline, r = x.r; if (!tl || !r.events) return [];
  return r.events.filter((e) => tl.shows(e, r.events) && e.type !== "node").slice(-4).reverse().map((e) => ({ t: e.ts, text: [tl.line(e, r)].flat() }));
}
// the panel's status line: how an ended Task ended, a waiting Task's card (Now already starts "Waiting for you"), else the
// group and what happens now; never one phrase twice
const statusLine = (x) => x.group === "done" || x.group === "you" ? nowText(x) : [groupWord(x.group), nowText(x)].filter((s, i, a) => s && a.indexOf(s) === i).join(" · ");
function detail(x) {
  if (!x) return h("aside", { class: "tb-detail empty", "aria-label": T("Task details", "任務細節") }, h("p", { class: "faint" }, T("Select a Task to see the path it took.", "選一個任務，看它走過的路。")));
  const path = visited(x), ev = events(x);
  return h("aside", { class: `tb-detail g-${x.group}`, "aria-label": T("Task details", "任務細節"), "data-task-detail": x.id },
    h("div", { class: "tb-d-head" }, h("span", { class: "tb-d-meta mono" }, metaLine(x)), h("h2", {}, x.title),
      h("span", { class: "tb-d-status" }, statusLine(x)), x.card && x.group !== "done" ? inboxLink(x) : null),
    h("section", { class: "tb-d-sec" }, h("h3", {}, T("The path this Task took", "這個任務走過的路")),
      path === null ? h("div", { class: "skel", style: "height:80px" }) : !path.length ? h("p", { class: "faint" }, T("No step has run yet.", "還沒有跑過任何一步。"))
        : h("ol", { class: "tb-path", "data-task-path": x.id }, path.map((p) => h("li", { class: `${p.cur ? "cur" : ""} s-${p.state}`, "data-path-node": p.node, "data-visit": p.visit, ...(p.cur ? { "aria-current": "step" } : {}) },
          h("i", { class: "tb-pdot" }), h("span", {}, h("b", {}, p.name), h("small", {}, p.note)))))),
    h("section", { class: "tb-d-sec tb-d-ev" }, h("h3", {}, T("Recent events", "最近動態")),
      ev.length ? ev.map((e) => h("div", { class: "tb-ev" }, h("span", { class: "mono faint" }, hhmm(e.t)), h("span", {}, e.text))) : h("p", { class: "faint" }, T("Nothing yet.", "還沒有。"))),
    h("div", { class: "tb-d-act" }, h("a", { class: "btn", href: x.graph, "data-full-graph": x.id }, T("Full graph", "完整流程圖")), h("a", { class: "btn primary", href: x.href, "data-open-task": x.id }, T("Open task", "打開任務"))));
}

// ---------- the page ----------
// the layout follows the main column's width (the Firstmate panel takes room from it): a table with the panel beside it,
// a compact list with the panel beside it, or (narrow, a phone) cards with the panel opened under the selected card
const modeFor = (w) => (w >= 1080 ? "wide" : w >= 640 ? "mid" : "narrow");
const mainWidth = () => { const m = document.getElementById("main"); if (!m) return innerWidth; const cs = getComputedStyle(m); return m.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); };
const TABS = [["all", "All", "全部"], ["you", "Waiting for you", "等你"], ["run", "Running", "進行中"], ["stuck", "Stuck", "卡住"], ["done", "Done today", "今天完成"]];
// beside the list (wide, mid) the selection follows a click or the keys; on a phone a tap opens (or folds) the row's panel and
// the keys only move the focus
function pick(id, open = false) {
  BD.focus = id;
  if (BD.mode !== "narrow") BD.sel = id;
  else if (open) BD.sel = BD.sel === id ? null : id;
  render(); document.getElementById(`tb-${id}`)?.focus({ preventScroll: true });
}
function onKeys(e, list) {
  const at = e.target.closest?.("[data-task]"); if (!at || e.target !== at || e.metaKey || e.ctrlKey || e.altKey) return; // keys inside a link or the panel are theirs
  const ids = list.map((x) => x.id), i = ids.indexOf(at.dataset.task);
  if (e.key === "Enter") { e.preventDefault(); location.hash = list[i].href; return; }
  if (e.key === " ") { e.preventDefault(); pick(ids[i], true); return; }
  const to = { ArrowDown: ids[i + 1], ArrowUp: ids[i - 1], Home: ids[0], End: ids.at(-1) }[e.key];
  if (!(e.key in { ArrowDown: 1, ArrowUp: 1, Home: 1, End: 1 })) return;
  e.preventDefault(); if (!to || to === ids[i]) return;
  pick(to); document.getElementById(`tb-${to}`)?.scrollIntoView({ block: "nearest" });
}
// the filter tabs: one tablist, ←/→ (Home/End) move to a tab and show its rows
function onTabKeys(e) {
  const i = TABS.findIndex(([k]) => k === BD.tab), n = TABS.length;
  const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key]; if (j === undefined) return;
  e.preventDefault(); BD.tab = TABS[j][0]; render(); document.querySelector(`[data-tb-tab="${BD.tab}"]`)?.focus();
}
function counts(all) {
  const crew = [...(window.studioAgents?.members() || []), ...S.crew.filter((c) => c.alive)];
  const ran = [...BD.det.values()].filter(ranToday);
  const spend = ran.reduce((a, r) => a + spendToday(r), 0), costed = [...BD.det.values()].some((r) => jobsOf(r).some((j) => j.cost?.usd != null));
  return { open: all.filter((x) => x.group !== "done").length, crew: crew.length, spend: costed ? spend : null };
}
const jobsOf = (r) => Object.values(r.nodes || {}).flatMap((n) => n?.data?.jobs || []);
// a job is dated by its step, else by its node's start or end; a job with neither is not dated, so not counted as today's
const spendToday = (r) => { const at = new Map((r.steps || []).filter((s) => s.job).map((s) => [s.job, s.startedAt]));
  return Object.values(r.nodes || {}).flatMap((n) => (n?.data?.jobs || []).map((j) => [j, at.get(j.id) || n.startedAt || n.endedAt]))
    .filter(([j, when]) => j.cost?.usd != null && today(when)).reduce((a, [j]) => a + j.cost.usd, 0); };
// today's spend only when a job reported a cost (live S28: "— today" read as broken); otherwise the line ends at the crew
const subtitle = (c) => !window.studioAgents?.ready() ? window.studioAgents?.status() || T("Checking crew status…", "正在確認船員狀態…")
  : T(`${c.open} task${c.open === 1 ? "" : "s"}, ${c.crew} crew on duty${c.spend == null ? "" : `, ${usd(c.spend)} today`}`, `${c.open} 個任務、${c.crew} 位船員值班${c.spend == null ? "" : `、今天 ${usd(c.spend)}`}`);
function viewBoard() {
  if (BD.list === null) loadStudio();
  BD.mode = modeFor(mainWidth());
  const all = BD.list === null ? [] : items(), c = counts(all);
  const n = (k) => (k === "all" ? all.length : all.filter((x) => x.group === k).length);
  const list = all.filter((x) => BD.tab === "all" || x.group === BD.tab);
  // the selection stays on its Task through live updates while its row shows; beside the list, a selection the filter hides
  // (or none) moves to the first row shown, so the panel always shows a row of the list. On a phone a hidden selection closes.
  const shown = (id) => list.some((x) => x.id === id);
  if (BD.sel && !shown(BD.sel)) BD.sel = null;
  if (!BD.sel && BD.mode !== "narrow" && list.length) BD.sel = list[0].id;
  const sel = list.find((x) => x.id === BD.sel) || null;
  // exactly one row is in the tab order: the selected one, else the one the keys last reached, else the first
  const tabbable = list.length ? (BD.sel && shown(BD.sel) ? BD.sel : BD.focus && shown(BD.focus) ? BD.focus : list[0].id) : null;
  BD.sig = boardSig();
  const waiting = n("you");
  const rows = BD.list === null ? [1, 2, 3].map(() => h("div", { class: "tb-row tb-skel", role: "listitem" }, h("div", { class: "skel", style: "height:12px;width:70%" }), h("div", { class: "skel", style: "height:8px" })))
    : !all.length ? h("div", { class: "empty", role: "listitem" }, icon("workflow"), h("b", {}, T("No task yet", "還沒有任務")), h("a", { href: "#/runs" }, T("Start one", "開始一個")))
    : !list.length ? h("div", { class: "empty", role: "listitem", "data-tb-empty": BD.tab }, h("b", {}, T("No task under this filter", "這個篩選下沒有任務")))
    : list.map((x) => row(x, x.id === BD.sel, x.id === tabbable, BD.mode === "narrow" && x.id === BD.sel ? detail(x) : null));
  return h("div", { class: `page bd-page tb-${BD.mode}`, "data-board": "1" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Board", "看板")), h("p", { id: "boardSub" }, BD.list === null ? T("Loading tasks…", "載入中…") : subtitle(c))),
      h("div", { class: "actions" }, window.crewBoardViews ? window.crewBoardViews("tasks") : null, ghBar(), h("a", { class: "btn", href: "#/team" }, icon("crew"), T("Crew", "船員")), h("a", { class: "btn primary", href: "#/runs" }, icon("plus"), T("New task", "新任務")))),
    // the operator turned the OS sandbox and egress proxy off (CREW_LOCAL_UNRESTRICTED=1): said above everything else
    BD.pol?.execution === "local-unrestricted" && window.crewUnrestrictedNotice ? window.crewUnrestrictedNotice() : null,
    BD.mode === "narrow" && waiting ? h("a", { class: "tb-waitbar", href: "#/inbox", "data-tb-waitbar": String(waiting) }, h("span", {}, T(`${waiting} task${waiting === 1 ? "" : "s"} waiting for you`, `${waiting} 個任務在等你`)), h("span", {}, T("Go to Inbox →", "去收件匣 →"))) : null,
    h("div", { class: "tb-tabs", role: "tablist", "aria-label": T("Filter", "篩選"), onkeydown: onTabKeys }, TABS.map(([k, en, tw]) => h("button", { type: "button", role: "tab", class: `tb-tab t-${k}`, "aria-selected": String(BD.tab === k), tabindex: BD.tab === k ? 0 : -1, "aria-controls": "tasks", "data-tb-tab": k,
      onclick: () => { BD.tab = k; render(); } }, h("i", { class: "tb-dot" }), T(en, tw), h("span", { class: "tb-count num" }, String(n(k)))))),
    h("div", { class: "tb-body" },
      h("div", { class: "tb-listwrap" },
        h("div", { class: "card tb-list", id: "tasks", role: "tabpanel", "aria-label": T("Tasks", "任務") },
          BD.mode === "wide" ? h("div", { class: "tb-head", "aria-hidden": "true" }, h("span", {}, T("Status", "狀態")), h("span", {}, T("Task", "任務")), h("span", {}, T("Progress", "進度")), h("span", {}, T("Now", "現在")), h("span", { class: "r" }, T("Elapsed", "經過"))) : null,
          h("div", { role: "list", "aria-label": T("Tasks", "任務"), class: "tb-rows", onkeydown: (e) => onKeys(e, list) }, rows)),
        h("p", { class: "tb-foot faint" }, T("Decision cards live in the Inbox only: the Board tells you which Task is waiting, without a second copy of the card.", "要你做決定的卡片只放在收件匣；看板只告訴你「哪個任務在等你」，不再重複一份卡。"))),
      BD.mode !== "narrow" ? detail(sel) : null));
}
routes.board = viewBoard;
window.crewBoardAgentsChanged = () => S.route?.name === "board" && !S.route.arg && soft();
// the Board's own derivations, for tests and other pages: the rows as shown and a definition's milestone track
window.crewBoard = { items: () => items().map(({ r, t, ...x }) => x), task: (r, cards = []) => { const { r: _, ...x } = studioView(r, cards); return x; }, milestones };
// the main column changes width (the Firstmate panel opens or closes, the window resizes): the layout follows
{ const m = document.getElementById("main"); if (m && typeof ResizeObserver === "function") new ResizeObserver(() => { if (S.route?.name === "board" && BD.mode && modeFor(mainWidth()) !== BD.mode) render(); }).observe(m); }
// re-renders from live data (app.js's stream handlers and the loaders here) go through soft(): mark them as live
// and a live update that changes nothing the Board shows does not redraw it (the crew's log tails move every few seconds;
// a redraw between a mouse-down and its mouse-up would swallow the captain's click). A redraw keeps the focused row
// focused and the detail panel's own scroll.
const boardSig = () => JSON.stringify([lang, ghBar()?.textContent ?? null, BD.tab, BD.sel, BD.focus, BD.mode, window.studioAgents?.ready(), window.studioAgents?.status(), window.studioAgents?.members(), window.crewFirstmateWelcomeSignature?.(), S.tasks.filter((t) => t.status !== "idle").map((t) => [t.id, t.status, t.node, t.round, t.title, t.lastTs, t.failure?.type]),
  S.pending.map((c) => [c.id, c.ts, c.task]), S.crew.filter((c) => c.alive).map((c) => [c.actor, c.task, c.vendor, c.model]), BD.list, BD.ended, (BD.cards || []).map((c) => [c.id, c.status, c.run]), [...BD.det.values()].map((r) => [r.id, r.status, r.updatedAt, r.nodes, (r.steps || []).length, (r.events || []).length, !!r.def])]);
{ const baseSoft = soft; soft = function () {
    if (S.route?.name !== "board") return baseSoft();
    if (boardSig() === BD.sig) return updateNav();
    const focused = document.activeElement?.closest?.("[data-task]")?.dataset.task, panel = document.querySelector(".tb-detail")?.scrollTop || 0;
    BD.live = true; try { return baseSoft(); } finally { BD.live = false;
      if (focused) document.getElementById(`tb-${focused}`)?.focus({ preventScroll: true });
      const p = document.querySelector(".tb-detail"); if (p) p.scrollTop = panel; } }; }

// ---------- live: the page's one stream ----------
window.liveListen("wrun", (m) => { let d; try { d = JSON.parse(m.data); } catch { return; }
  const sequence = d.event?.seq;
  if (sequence && sequence <= (BD.sequences.get(d.id) || 0)) return;
  if (sequence) BD.sequences.set(d.id, sequence);
  const previous = BD.det.get(d.id);
  const refreshList = BD.loading || !BD.members.has(d.id) || d.deleted || d.archived !== undefined || (previous && d.status && (inFlight(previous) !== inFlight({ ...previous, status: d.status }) || previous.status !== d.status));
  invalidateRun(d.id);
  if (d.deleted || d.archived === true) {
    BD.members.delete(d.id); BD.det.delete(d.id);
    BD.list = (BD.list || []).filter(id => id !== d.id); BD.ended = BD.ended.filter(id => id !== d.id);
    if (S.route?.name === "board") soft();
  } else {
    const r = BD.det.get(d.id);
    if (r && BD.members.has(d.id) && d.nodes) { if (d.event) { r.events ??= []; if (!r.events.some(e => e.seq === d.event.seq)) r.events.push(d.event); } r.status = d.status || r.status; for (const [k, n] of Object.entries(d.nodes)) r.nodes[k] = { ...(r.nodes[k] || {}), ...n }; if (S.route?.name === "board") soft(); }
    if (BD.members.has(d.id) && S.route?.name === "board") BD.t.set(d.id, setTimeout(() => { BD.t.delete(d.id); void loadRun(d.id); }, 250));
  }
  // archived:false means refresh for an unarchive; membership still comes only from the list.
  if (S.route?.name === "board" && refreshList) requestStudio();
});
window.liveListen("scard", () => { BD.cardRevision++; clearTimeout(BD.ct); if (S.route?.name === "board") void loadCards(); });
addEventListener("crew:live", () => { if (S.route?.name === "board") { BD.cardRevision++; void loadCards(); requestStudio(); } });
// elapsed ticks without re-rendering
setInterval(() => { if (S.route?.name !== "board") return; document.querySelectorAll(".tb-row .tb-el[data-since]").forEach((el) => { if (el.dataset.since && !el.dataset.until) el.textContent = fmtEl(clock() - Date.parse(el.dataset.since)); }); }, 15000);
// coming back to the Board shows fresh runs
addEventListener("hashchange", () => {
  const board = (location.hash.replace(/^#\/?/, "") || "board").startsWith("board");
  BD.life++; BD.refresh++; clearTimeout(BD.ct); BD.cardRequest++;
  BD.listRequest?.abort(); for (const id of [...BD.requests.keys(), ...BD.t.keys()]) invalidateRun(id);
  if (board) void loadStudio(); else BD.refreshPending = false;
});

// ---------- the Inbox: a card answered there says so at the top ----------
function answered(id, text) {
  BD.hidden.add(id); BD.answered = [{ id, text, at: Date.now() }, ...BD.answered.filter((a) => a.id !== id)].slice(0, 8);
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
const answeredRows = () => BD.answered.filter((a) => Date.now() - a.at < 10 * 60000).map((a) => h("div", { class: "need bd-answered", "data-answered": a.id }, h("div", { class: "need-ic", style: "background:var(--ok-soft);color:var(--ok)" }, icon("check")),
  h("div", { class: "need-d" }, h("span", { class: "tid" }, a.id), " ", a.text), h("span", { class: "faint", style: "font-size:12px" }, ago(new Date(a.at).toISOString()))));
{ const orig = routes.inbox; routes.inbox = (id) => { const ans = answeredRows(); return [ans.length ? h("div", { class: "page bd-inbox-answered" }, h("div", { class: "card needs" }, ans)) : null, orig(id)]; }; }
})();
