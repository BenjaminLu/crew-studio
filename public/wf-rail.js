// The workflow page's Steps view, "the rail": one sentence on top, then one continuous line from Start to the Ends block.
// Numbered steps say what they get and hand on; back-branches are drawn as return connectors, skips dashed, refine loops ↻;
// "ask me" cards and check steps are diamonds on the line, a step's must-pass checks and edge checks are tags on the segment
// after it; a sticky strip maps the phases; more than 12 steps open with their phases collapsed; steps only a branch reaches
// are listed below the ends; parallel steps show as a read-only fork/join. Edits change the draft in place and go live only on
// Save (a new version, POST /api/wf/<id>), exactly as the graph editor saves; that editor stays at #/workflows/<id>/advanced.
//   window.crewRail.build(ed, X)  the page for one loaded workflow (runtime.js loadEditor's ed; X its helpers)
//   window.crewRail.model(def)    the rail's reading of a definition (main line, detours, ends, fork groups)
(() => {
P.more ??= '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>';
P.down ??= '<path d="m6 9 6 6 6-6"/>'; P.up ??= '<path d="m18 15-6-6-6 6"/>';
P.undo ??= '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'; P.redo ??= '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>';
P.back ??= '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/>'; P.flag ??= '<path d="M5 21V4h11l-1.5 4L16 12H5"/>';
P.trash ??= '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'; P.skip ??= '<path d="M5 12h14M13 6l6 6-6 6"/>';
P.end ??= '<circle cx="12" cy="12" r="8"/><path d="M9 12h6"/>'; P.pencil ??= '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>';
P.fork ??= '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 6l8 5M8 18l8-5"/>';
P.dup ??= '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>';
P.sliders ??= '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>';
P.book ??= '<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h10"/>';

// kit.js's h, flattening nested child lists (h_ is app.js's alias of it)
const h = (tag, attrs = {}, ...kids) => h_(tag, Object.fromEntries(Object.entries(attrs || {}).filter(([, v]) => v != null)), ...kids.flat(Infinity));
// how the last action came: keys, or a pointer (a click or tap must not raise the phone keyboard or leave a focus ring)
let viaKeys = false; addEventListener("keydown", () => { viaKeys = true; }, true); addEventListener("pointerdown", () => { viaKeys = false; }, true);
// zh-TW: a space between Chinese and a Latin word or number ("如果 Spec 的檢查")
const zhSpace = (t) => String(t).replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, "$1 $2").replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, "$1 $2");
const clone = (o) => JSON.parse(JSON.stringify(o));
const attr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// replaceChildren for built lists: nested lists flattened, null / false parts dropped (never rendered as "null")
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const fit = (t, n) => { t = String(t ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const KIC = { agent: "agent", check: "gate", card: "human", loop: "loop", hook: "tool", group: "fork" };
const kindName = (k) => ({ agent: T("AI step", "AI 步驟"), check: T("Automatic check", "自動檢查"), card: T("You decide", "由你決定"), loop: T("Loop", "迴圈"), hook: T("Automatic action", "自動動作"), group: T("Run together", "同時進行") }[k] || k);
const WORDS = { pass: ["passes", "通過"], fail: ["fails", "失敗"], error: ["fails", "出錯"], timeout: ["times out", "逾時"], cap: ["runs out of rounds", "輪數用完"], stalled: ["stops improving", "沒有進展"],
  "step-back": ["steps back", "退一步"], blocked: ["is blocked", "卡住"], retry: ["retries", "重試"], report: ["reports", "回報"], changes: ["requests changes", "要求修改"], ok: ["finishes", "完成"],
  approve: ["approves", "核准"], approved: ["approves", "核准"], reject: ["rejects", "不採用"], rejected: ["rejects", "不採用"], close: ["closes", "關閉"], unavailable: ["is unavailable", "無法使用"] };
Object.assign(WORDS, { adopt: ["starts from an existing branch", "從現有分支開始"], recapture: ["needs new captures", "需要重新截圖"], escalate: ["escalates", "需要升級處理"],
  "door-change": ["finds the change type was wrong", "發現修改類型判斷錯了"], "env-permission": ["needs an environment permission", "需要環境權限"], "other-model": ["needs another model", "需要換模型"],
  rebase: ["needs a rebase", "需要 rebase"], "rebase-more": ["needs another rebase", "還要再 rebase"], revise: ["needs revising", "需要修改"], notes: ["has notes", "有備註"], gap: ["finds a capture gap", "發現截圖缺口"],
  ui: ["finds a UI change", "發現 UI 修改"], none: ["finds nothing to do", "發現沒事要做"], "two-way": ["says two-way", "判定為雙向門"], "one-way": ["says one-way", "判定為單向門"], undecided: ["cannot decide", "無法決定"],
  merge: ["is ready to merge", "可以合併"], fallback: ["falls back", "改走備案"], continue: ["continues", "繼續"], rescope: ["needs a new scope", "需要重新界定範圍"], park: ["is parked", "被擱置"],
  drop: ["is dropped", "被放棄"], discard: ["is discarded", "被丟棄"], extend: ["needs more rounds", "需要更多輪"], apply: ["is applied", "已套用"], accept: ["is accepted", "被接受"], dispatch: ["is dispatched", "已派出"] });
const word = (w) => (WORDS[w] ? T(WORDS[w][0], WORDS[w][1]) : String(w).replace(/[-_]/g, " "));
// "If it fails", "If it is blocked"; a word Studio does not know reads as the outcome itself
const whenText = (when) => String(when || "").split("|").filter(Boolean).map((w) => (WORDS[w] ? word(w) : T(`ends with “${w}”`, `結果是「${w}」`))).join(T(" or ", " 或 "));
// the outcomes a step can end with, by kind: the rail's branch picker offers these, plus the words already on this step
const OUTCOMES = { agent: ["fail", "changes", "blocked", "timeout"], check: ["fail", "pass"], loop: ["cap", "stalled", "pass", "retry"], hook: ["error", "ok"], card: [] };
const TEMPLATES = [["agent", "agent", "An AI does work", "AI 做事", "Plan, build, write, review …", "規劃、建置、撰寫、審查…"],
  ["check", "gate", "Run an automatic check", "跑自動檢查", "Tests, readiness, captures …", "測試、就緒、截圖…"],
  ["card", "human", "Ask me to decide", "請我決定", "You approve, send back or close", "你核准、退回或關閉"],
  ["loop", "loop", "Loop until it passes", "迴圈直到通過", "Repeat a step until its checks pass", "重做一步直到檢查通過"],
  ["hook", "tool", "Do something automatically", "自動做一件事", "Open a PR, publish, export …", "開 PR、發布、匯出…"]];
const ACTIONS = { "pr.open": ["Open a pull request", "開 PR"], "pr.shepherd": ["Follow the pull request through", "跟進 PR"], "pr.track-deploy": ["Follow to production", "跟到上線"],
  "library.publish": ["Publish to the Library", "發布到成品庫"], "doc.export": ["Export the document", "匯出文件"], "repo.prepare": ["Prepare the repository", "準備 repo"],
  "intent.capture": ["Capture the request", "記下需求"], "deliver.intake": ["Capture the brief", "記下 brief"], "deliver.round": ["Begin a round", "開始一輪"], "deliver.render": ["Render the result", "算繪成品"],
  "remote.ready": ["Check the branch is ready to merge", "確認分支可合併"], "image.generate": ["Generate an image", "產生圖片"], note: ["Write a note", "寫一則備註"] };
Object.assign(ACTIONS, { "git.merge": ["Merge the branch", "合併分支"], "repo.cleanup": ["Remove the worktree", "移除 worktree"], "hello.web": ["Build the sample website", "做出範例網站"],
  "branch.adopt": ["Copy an existing branch", "複製現有分支"], "fileorg.plan": ["Plan the file moves", "規劃檔案搬移"], "fileorg.apply": ["Move the files (with an undo log)", "搬移檔案（附還原紀錄）"], "fileorg.discard": ["Drop the plan", "放棄計畫"],
  "firstmate.dispatch": ["Hand the spec to the crew", "把 spec 交給船員"], "firstmate.launch": ["Start Firstmate", "啟動 Firstmate"], "lane.merge": ["Merge the lane", "合併這條線"], "lane.close": ["Close the lane", "關閉這條線"],
  "coffee.assemble": ["Put the site together", "組合網站"], "coffee.library": ["Save the site to the Library", "把網站存到成品庫"], "crew.apply": ["Apply the crew change", "套用船員變更"], "crew.confirm": ["Ask you to confirm the crew", "請你確認船員"],
  "staffing.confirm": ["Ask you to confirm staffing", "請你確認派工"], "staffing.activate": ["Turn the staffing on", "啟用派工"], "issues.snapshot": ["Read the open issues", "讀取未結 issue"] });
// a plain name for an action id; one Studio does not name reads as its words ("coffee.video-needed" → "Coffee video needed")
const actionName = (id) => (ACTIONS[id] ? T(ACTIONS[id][0], ACTIONS[id][1]) : id ? String(id).replace(/[._-]+/g, " ").replace(/^./, (c) => c.toUpperCase()) : T("does something", "做一件事"));
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh"]; // the efforts a saved step may name (src/workflow-drafts.ts DRAFT_EFFORTS)
const MODELS = { value: null, pending: null }; // Studio's model catalog, loaded once per page
const okEnd = (n) => !n.args?.result && !/clos|drop|park|discard|cancel|empty|none|reject|fail|abandon/i.test(`${n.id} ${n.label}`);

// ---------- the reading: main line, detours, ends, fork groups ----------
function model(def) {
  const nodes = def.nodes || [], byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = (def.edges || []).map((e, i) => ({ ...e, i })).filter((e) => byId.has(e.from) && byId.has(e.to));
  const outE = (id) => edges.filter((e) => e.from === id), inE = (id) => edges.filter((e) => e.to === id);
  const isEnd = (id) => byId.has(id) && !outE(id).length;
  const ends = nodes.filter((n) => isEnd(n.id));
  const entry = (nodes.find((n) => !inE(n.id).length) || nodes[0])?.id;
  // parallel: one outcome to two or more steps that are reached only from there and all go on to the same one step
  const groups = new Map(), member = new Map();
  for (const p of nodes) {
    const by = new Map(); for (const e of outE(p.id)) { if (isEnd(e.to)) continue; const k = e.when || ""; if (!by.has(k)) by.set(k, []); by.get(k).push(e.to); }
    for (const [when, tos] of by) {
      const ms = [...new Set(tos)]; if (ms.length < 2 || ms.some((m) => member.has(m) || m === p.id)) continue;
      const joins = ms.map((m) => [...new Set(outE(m).map((e) => e.to))]);
      if (!joins.every((j) => j.length === 1) || new Set(joins.map((j) => j[0])).size !== 1) continue;
      const j = joins[0][0]; if (ms.includes(j) || ms.some((m) => inE(m).some((e) => e.from !== p.id))) continue;
      const g = { id: `fork:${p.id}`, from: p.id, when, members: ms, join: j }; groups.set(g.id, g); ms.forEach((m) => member.set(m, g.id));
    }
  }
  const rep = (id) => member.get(id) || id;
  const adj = new Map(); for (const n of nodes) adj.set(rep(n.id), adj.get(rep(n.id)) || []);
  for (const e of edges) { const a = rep(e.from), b = rep(e.to); if (a !== b && !adj.get(a).includes(b)) adj.get(a).push(b); }
  const state = new Map(), fwd = new Map();
  const dfs = (u) => { state.set(u, 1); fwd.set(u, []); for (const v of adj.get(u) || []) { if (state.get(v) === 1) continue; fwd.get(u).push(v); if (!state.get(v)) dfs(v); } state.set(u, 2); };
  if (entry) dfs(rep(entry));
  const endish = (id) => !groups.has(id) && isEnd(id);
  // the line follows a step's ordinary way on (no outcome word, or pass / ok / approve …, or into its own refine loop) when it
  // has one; an outcome like "blocked" leads onto the line only when the step has no ordinary way on
  const GOOD = /^(|pass|ok|approve|approved|continue|done|accept|accepted|sent|yes|adopted)$/;
  const good = (a, b) => edges.some((e) => rep(e.from) === a && rep(e.to) === b && (String(e.when || "").split("|").some((w) => GOOD.test(w)) || (byId.get(e.to)?.kind === "loop" && byId.get(e.to).args?.producer === e.from)));
  const memo = new Map();
  const lp = (u) => { if (memo.has(u)) return memo.get(u); const cands = (fwd.get(u) || []).filter((v) => !endish(v)), ok = cands.filter((v) => good(u, v));
    let best = []; for (const v of ok.length ? ok : cands) { const p = lp(v); if (p.length > best.length) best = p; } const r = [u, ...best]; memo.set(u, r); return r; };
  const main = entry && !endish(rep(entry)) ? lp(rep(entry)) : [];
  const onMain = new Set(main);
  const detours = []; for (const n of nodes) { const r = rep(n.id); if (!onMain.has(r) && !endish(r) && !detours.includes(r)) detours.push(r); }
  const rows = [...main, ...detours];
  const num = (id) => { const i = rows.indexOf(rep(id)); return i < 0 ? "" : i + 1; };
  const mi = (id) => main.indexOf(rep(id));
  const label = (id) => groups.has(id) ? groups.get(id).members.map((m) => byId.get(m).label).join(" · ") : byId.get(id)?.label ?? id;
  const froms = (id) => (groups.has(id) ? groups.get(id).members : [id]);
  const tos = (id) => (groups.has(id) ? groups.get(id).members : [id]);
  const link = (id, to) => (id && to ? edges.filter((e) => froms(id).includes(e.from) && tos(to).includes(e.to)) : []);
  // where the line goes after a row: the next main row, or (for the last one) the end its default edge reaches
  const endAfter = (id) => { const out = froms(id).flatMap(outE).filter((e) => isEnd(e.to));
    const score = (e) => (okEnd(byId.get(e.to)) ? 2 : 0) + (!e.when || /(^|\|)(pass|ok|approve|approved|done)(\||$)/.test(e.when) ? 1 : 0);
    return out.sort((a, b) => score(b) - score(a))[0]?.to ?? null; };
  const next = (id) => { const i = main.indexOf(id); if (i < 0) return null; return main[i + 1] ?? endAfter(id); };
  // phases: the definition's own stages (or the built-in ones) along the main line
  const stages = window.crewLayout?.stagesFor ? window.crewLayout.stagesFor(def) : [];
  const stageOf = new Map(); stages.forEach((s) => s.nodes.forEach((n) => stageOf.set(n, s)));
  const sec = new Map(); let cur = null;
  for (const id of main) { const s = stageOf.get(froms(id)[0]); if (s) cur = s; sec.set(id, cur); }
  const firstSec = main.map((id) => sec.get(id)).find(Boolean) || null;
  for (const id of main) if (!sec.get(id)) sec.set(id, firstSec);
  return { def, byId, edges, outE, inE, isEnd, ends, entry, groups, member, rep, main, detours, rows, num, mi, label, link, next, endAfter, froms, sec, stages, onMain };
}

// ---------- the page ----------
function build(ed, X) {
  const R = ed.railState ??= { hist: [], fut: [], changes: 0, sel: null, collapsed: null, editing: false, advOpen: false, renaming: false };
  const root = h("div", { class: "page wf-page", "data-rail": ed.id });
  const pop = h("div", { class: "wf-pop-host" }), drawer = h("aside", { class: "wf-drawer", "aria-label": T("Step settings", "步驟設定"), "data-rail-drawer": "" });
  let M = model(ed.def), disposed = false, vtimer = null, vgen = 0, saving = false, say = (t) => toast(t);
  const readOnly = () => !!ed.trash?.deleted || X.readOnly?.(ed);
  const tab = () => (/\/(map|versions)$/.exec(S.route?.arg || "") || [])[1] || "steps";
  const base = () => `#/workflows/${ed.id}${ed.v ? `/v${ed.v}` : ""}`;
  const node = (id) => ed.def.nodes.find((n) => n.id === id);
  const isLong = () => M.main.length > 12;
  const collapsed = () => { if (!R.collapsed) { const secs = [...new Set(M.main.map((id) => M.sec.get(id)?.id).filter(Boolean))]; R.collapsed = new Set(isLong() ? secs.slice(1) : []); } return R.collapsed; };

  // ---------- draft history: every edit is one change; Save makes a version ----------
  const snap = () => clone({ nodes: ed.def.nodes, edges: ed.def.edges, roles: ed.def.roles });
  const restore = (s) => { ed.def.nodes = s.nodes; ed.def.edges = s.edges; ed.def.roles = s.roles; };
  // while a save is on its way the draft is held still: an edit then would be lost when the saved version reloads
  const busy = () => { if (!saving) return false; say(T("Saving… edit again once it is saved.", "儲存中…存好後再修改。")); return true; };
  const contentKey = (d) => JSON.stringify({ nodes: (d.nodes || []).map(({ x, y, ...n }) => n), edges: d.edges, roles: d.roles });
  const mark = () => { R.key = contentKey(ed.def); };
  const commit = (fn, sel) => { if (readOnly() || busy()) return; R.hist.push(snap()); R.fut = []; fn(); R.changes++; ed.dirty = true; if (sel !== undefined) R.sel = sel; mark(); refresh(); };
  const undo = () => { if (!R.hist.length || busy()) return; R.fut.push(snap()); restore(R.hist.pop()); R.changes = Math.max(0, R.changes - 1); ed.dirty = R.changes > 0; mark(); refresh(); };
  const redo = () => { if (!R.fut.length || busy()) return; R.hist.push(snap()); restore(R.fut.pop()); R.changes++; ed.dirty = true; mark(); refresh(); };
  const discard = () => { if (busy()) return; restore(clone({ nodes: ed.saved.nodes, edges: ed.saved.edges, roles: ed.saved.roles })); R.hist = []; R.fut = []; R.changes = 0; ed.dirty = false; R.sel = null; mark(); refresh(); say(T("Changes discarded.", "已捨棄修改。")); };
  const refresh = () => { M = model(ed.def); if (R.sel && !node(R.sel) && !M.groups.has(R.sel)) R.sel = null; paint(); validate(); };
  // back from the graph editor: its edits are not in this history, so Undo must not step over them
  const sync = () => { const k = contentKey(ed.def); if (R.key !== undefined && R.key !== k) { R.hist = []; R.fut = []; R.changes = k === contentKey(ed.saved) ? 0 : Math.max(1, R.changes); ed.dirty = R.changes > 0; }
    else if (R.key === undefined && k !== contentKey(ed.saved)) R.changes = Math.max(1, R.changes); R.key = k; };
  sync();
  const validate = () => { clearTimeout(vtimer); const gen = ++vgen; vtimer = setTimeout(async () => { try { const r = await X.api("/api/wf/validate", { def: clone(ed.def) }); if (gen !== vgen || disposed) return; ed.problems = r.problems || []; paint(true); } catch {} }, 250); };

  // ---------- graph edits ----------
  const uid = (b) => { const s = String(b).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "step"; let id = /^[a-z0-9]/.test(s) ? s : `s-${s}`, i = 2; while (node(id)) id = `${s.slice(0, 36)}-${i++}`; return id; };
  const addEdge = (e) => { if (!ed.def.edges.some((x) => x.from === e.from && x.to === e.to && (x.when || "") === (e.when || ""))) { const o = { from: e.from, to: e.to }; if (e.when) o.when = e.when; if (e.checks?.length) o.checks = e.checks; ed.def.edges.push(o); } };
  const dropEdges = (list) => { const gone = new Set(list.map((e) => e.i)); ed.def.edges = ed.def.edges.filter((_, i) => !gone.has(i)); };
  const lastAgent = (beforeId) => { const i = M.main.indexOf(beforeId); for (let k = i; k >= 0; k--) { const n = node(M.main[k]); if (n?.kind === "agent") return n; } return ed.def.nodes.find((n) => n.kind === "agent") || null; };
  const closeEnd = () => M.ends.find((n) => !okEnd(n)) || null;
  const backOf = (id) => (M.groups.has(id) ? M.groups.get(id).from : id);
  const freshNode = (kind, afterId) => {
    const at = node(M.froms(afterId)[0]) || ed.def.nodes[0] || { x: 0, y: 0 };
    const n = { id: "", kind, label: "", x: Math.round((at.x || 0) + 40), y: Math.round((at.y || 0) + 90) };
    const agent = lastAgent(afterId);
    if (kind === "agent") { n.label = T("New AI step", "新的 AI 步驟"); n.role = agent?.role || ed.def.roles[0]?.id; n.mode = agent?.mode || "test"; }
    if (kind === "check") { n.label = T("New check", "新的檢查"); n.checks = []; }
    if (kind === "card") { n.label = T("You decide", "由你決定"); n.card = { options: [{ id: "approve", label: "Approve", labelZh: "核准", primary: true }, { id: "changes", label: "Send back", labelZh: "退回" }, ...(closeEnd() ? [{ id: "close", label: "Close", labelZh: "關閉" }] : [])] }; }
    if (kind === "loop") { n.label = T("Repeat until checks pass", "重做直到檢查通過"); n.args = { producer: node(afterId)?.kind === "agent" ? afterId : agent?.id || afterId, round_cap: 3 }; }
    if (kind === "hook") { n.label = T("Do something automatically", "自動做一件事"); n.do = "note"; n.args = { text: "" }; }
    n.id = uid(kind === "agent" ? "step" : kind);
    return n;
  };
  // put a new node on the line after a row: the edges that made that segment now lead into it, and it leads on to the same place
  const insertNode = (afterId, n, outWhen = null) => {
    const to = M.next(afterId), L = M.link(afterId, to);
    ed.def.nodes.push(n);
    if (L.length) { dropEdges(L); for (const e of L) addEdge({ from: e.from, to: n.id, when: e.when, checks: e.checks }); for (const t of [...new Set(L.map((e) => e.to))]) addEdge({ from: n.id, to: t, when: outWhen }); }
    else { for (const f of M.froms(afterId)) addEdge({ from: f, to: n.id }); if (to) for (const t of M.groups.has(to) ? M.groups.get(to).members : [to]) addEdge({ from: n.id, to: t, when: outWhen }); }
    return to;
  };
  const insertStep = (afterId, kind) => {
    const n = freshNode(kind, afterId);
    commit(() => {
      if (kind === "card") { insertNode(afterId, n, "approve"); addEdge({ from: n.id, to: backOf(afterId), when: "changes" }); const c = closeEnd(); if (c) addEdge({ from: n.id, to: c.id, when: "close" }); }
      else if (kind === "loop") { const to = M.next(afterId); ed.def.nodes.push(n); const p = n.args.producer;
        for (const t of to ? (M.groups.has(to) ? M.groups.get(to).members : [to]) : []) addEdge({ from: n.id, to: t, when: "pass" });
        addEdge({ from: p, to: n.id, when: "fail|timeout" }); addEdge({ from: n.id, to: p, when: "retry|report" }); }
      else insertNode(afterId, n);
    }, n.id);
    openDrawer(n.id, true);
  };
  const insertPack = (afterId) => {
    let after = afterId; const added = [];
    commit(() => { for (const [en, zh, preset] of X.presets || []) { const { new: _n, ...rest } = clone(preset); const n = { id: uid(en), label: T(en, zh), x: 0, y: 0, ...rest };
      const at = node(M.froms(after)[0]) || { x: 0, y: 0 }; n.x = Math.round((at.x || 0) + 40); n.y = Math.round((at.y || 0) + 90);
      insertNode(after, n, n.kind === "card" ? n.card?.options?.[0]?.id : null); added.push(n.id); M = model(ed.def); after = n.id; } });
    say(T(`Added ${added.length} follow-through steps, wired in order.`, `已加入 ${added.length} 個跟進步驟，依序接好。`));
  };
  // the line as units: a step and the refine loops right after it that repeat it move as one
  const units = () => { const out = []; for (const id of M.main) { const n = node(id), last = out.at(-1); if (n?.kind === "loop" && last && last[0] === n.args?.producer) last.push(id); else out.push([id]); } return out; };
  // a loop away from its producer, or that producer, cannot move without changing what repeats what
  const pinned = (id) => { if (!M.onMain.has(id) || M.groups.has(id) || node(id)?.kind === "loop") return true; const u = units().find((x) => x.includes(id));
    return M.main.some((x) => node(x)?.kind === "loop" && node(x).args?.producer === id && !u.includes(x)); };
  const targetsOf = (id) => (M.groups.has(id) ? M.groups.get(id).members : [id]);
  // lay the units out in a new order: each unit keeps its own way out (its edges into the unit after it, with their
  // outcome words and checks) and now takes it into its new successor; the last unit takes it to the end the line had
  const relink = (U, NU) => { const endT = M.next(M.main.at(-1)); const sig = new Map(), drop = [];
    U.forEach((u, i) => { const nx = i + 1 < U.length ? U[i + 1][0] : endT; if (!nx) { sig.set(u, []); return; } const T_ = targetsOf(nx), own = new Set(u.flatMap(M.froms));
      const es = M.edges.filter((e) => own.has(e.from) && T_.includes(e.to)); drop.push(...es); sig.set(u, es); });
    dropEdges(drop);
    NU.forEach((u, i) => { const nx = i + 1 < NU.length ? NU[i + 1][0] : endT; if (!nx) return; for (const e of sig.get(u)) for (const t of targetsOf(nx)) addEdge({ from: e.from, to: t, when: e.when, checks: e.checks }); }); };
  const entryOk = (U, NU) => { if (NU[0] === U[0]) return true; const first = NU[0][0], own = new Set(U[0].flatMap(M.froms)); return M.edges.filter((e) => targetsOf(first).includes(e.to)).every((e) => own.has(e.from)); };
  const moveUnit = (id, place) => { const U = units(), i = U.findIndex((u) => u[0] === id); if (i < 0) return false; const NU = place(U.slice(), i); if (!NU || NU.every((u, k) => u === U[k]) || !entryOk(U, NU)) return false; relink(U, NU); return true; };
  const canMove = (id, dir) => { if (readOnly() || pinned(id)) return false; const U = units(), i = U.findIndex((u) => u[0] === id), j = i + dir; if (i < 0 || j < 0 || j >= U.length) return false;
    const NU = U.slice(); [NU[i], NU[j]] = [NU[j], NU[i]]; return entryOk(U, NU); };
  const moveStep = (id, dir) => { if (!canMove(id, dir)) return;
    commit(() => { moveUnit(id, (U, i) => { const j = i + dir; [U[i], U[j]] = [U[j], U[i]]; return U; }); }, id); flash(id); };
  const dropOn = (id, targetId, beforeIt) => {
    if (id === targetId) return;
    if (!M.onMain.has(id) || !M.onMain.has(targetId)) { say(T("Detours stay in the detour list; main steps stay on the line.", "支線留在支線清單；主線步驟留在線上。")); return; }
    if (pinned(id)) { say(T("A refine loop moves with the step it repeats.", "精修迴圈跟著它重做的那一步移動。")); return; }
    const place = (U, i) => { const u = U.splice(i, 1)[0]; let k = U.findIndex((x) => x.includes(targetId)); if (k < 0) return null; if (!beforeIt) k++; U.splice(k, 0, u); return U; };
    const U = units(), NU = place(U.slice(), U.findIndex((u) => u[0] === id)); if (NU && !entryOk(U, NU)) { say(T("The first step stays first here: the step that would replace it is also reached by a branch.", "這裡第一步不能換：要接替它的那一步也有分支連進來。")); return; }
    commit(() => { moveUnit(id, place); }, id); flash(id); };
  const removeStep = (id) => { const n = node(id); if (!n) return;
    commit(() => { const to = M.onMain.has(id) ? M.next(id) : M.outE(id)[0]?.to; const targets = to ? (M.groups.has(to) ? M.groups.get(to).members : [to]) : [];
      const into = ed.def.edges.filter((e) => e.to === id && e.from !== id);
      ed.def.edges = ed.def.edges.filter((e) => e.to !== id && e.from !== id);
      for (const e of into) for (const t of targets) if (t !== e.from) addEdge({ from: e.from, to: t, when: e.when, checks: e.checks });
      ed.def.nodes = ed.def.nodes.filter((x) => x.id !== id); }, null);
    closeDrawer(); say(T(`Removed “${n.label}”. Branches into it now go where it went. Undo with ⌘Z.`, `已移除「${n.label}」。原本連進來的分支改接到它的下一步。按 ⌘Z 可還原。`)); };
  const duplicate = (id) => { const n = node(id); if (!n) return; const c = clone(n); c.id = uid(`${n.id}-copy`); c.label = `${n.label} ${T("(copy)", "（副本）")}`; c.x += 30; c.y += 30;
    commit(() => { const L = new Set(M.link(id, M.next(id)).map((e) => e.i)), branches = M.outE(id).filter((e) => !L.has(e.i));
      insertNode(id, c, M.link(id, M.next(id))[0]?.when ?? null); for (const e of branches) addEdge({ from: c.id, to: e.to === id ? c.id : e.to, when: e.when, checks: e.checks }); }, c.id); flash(c.id); };
  const askCardFor = (id) => { const nx = M.next(id), n = nx && node(nx); return n?.kind === "card" && M.edges.some((e) => e.from === n.id && e.when === "changes" && M.froms(id).includes(e.to)) ? n : null; };
  const toggleAsk = (id) => { const c = askCardFor(id); if (c) { removeStep(c.id); openDrawer(id); return; }
    const n = freshNode("card", id); n.label = T(`You approve: ${node(id)?.label || id}`, `由你核准：${node(id)?.label || id}`);
    commit(() => { insertNode(id, n, "approve"); addEdge({ from: n.id, to: backOf(id), when: "changes" }); const e = closeEnd(); if (e) addEdge({ from: n.id, to: e.id, when: "close" }); }, id); flash(n.id); };

  // ---------- saving ----------
  const save = async (note, btn) => {
    if (saving || !R.changes) return; saving = true; if (btn) { btn.disabled = true; btn.textContent = T("Saving…", "儲存中…"); }
    try { const r = await X.api(`/api/wf/${ed.id}`, clone({ base: ed.saved.version, nodes: ed.def.nodes, edges: ed.def.edges, roles: ed.def.roles, note: note || null }));
      if (disposed) return; const n = R.changes; R.hist = []; R.fut = []; R.changes = 0; R.note = ""; ed.dirty = false; closeDrawer();
      toast(T(`Saved as v${r.def.version} (${n} change${n > 1 ? "s" : ""}). New tasks use it; running tasks keep the version they started on.`, `已存成 v${r.def.version}（${n} 項修改）。新任務會用它；進行中的任務維持原版本。`));
      X.saved(ed, r);
    } catch (e) { if (disposed) return; if (e.problems) ed.problems = e.problems; say(e.message); paint(); }
    finally { saving = false; }
  };

  // ---------- popovers ----------
  const closePop = (refocus = false) => { const o = pop.opener; pop.opener = null; if (refocus && o?.isConnected && pop.contains(document.activeElement)) o.focus(); pop.replaceChildren(); document.querySelectorAll('[data-rail-pop-open="true"]').forEach((b) => b.removeAttribute("data-rail-pop-open")); };
  const popAt = (el, kids, cls = "wf-menu") => {
    closePop(); const p = h("div", { class: cls, role: cls === "wf-menu" ? "menu" : "dialog" }, kids); pop.append(p); if (!pop.isConnected) document.body.append(pop);
    const r = el.getBoundingClientRect(); p.place = () => { const pw = p.offsetWidth, ph = p.offsetHeight; let x = r.left, y = r.bottom + 6;
      if (x + pw > innerWidth - 12) x = Math.max(12, innerWidth - pw - 12); if (y + ph > innerHeight - 8) y = r.top - ph - 6 > 8 ? r.top - ph - 6 : Math.max(8, innerHeight - ph - 8);
      Object.assign(p.style, { position: "fixed", left: `${x}px`, top: `${y}px` }); }; p.place();
    el.setAttribute("data-rail-pop-open", "true"); pop.opener = el; p.addEventListener("click", (e) => e.stopPropagation());
    // a menu takes the focus on its first item; arrows, Home and End move through it, Escape returns to the button that opened it
    if (cls === "wf-menu") { const items = () => [...p.querySelectorAll("button[role=menuitem]:not(:disabled)")];
      setTimeout(() => items()[0]?.focus(), 0);
      p.addEventListener("keydown", (e) => { const l = items(), i = l.indexOf(document.activeElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); l[(i + (e.key === "ArrowDown" ? 1 : l.length - 1)) % l.length]?.focus(); }
        else if (e.key === "Home" || e.key === "End") { e.preventDefault(); (e.key === "Home" ? l[0] : l.at(-1))?.focus(); }
        else if (e.key === "Tab") closePop(); }); }
    return p; };
  const menu = (el, items) => popAt(el, items.map((it) => it === "-" ? h("hr") : it.grp ? h("div", { class: "grp" }, it.grp)
    : h("button", { type: "button", role: "menuitem", class: it.danger ? "danger" : null, "data-mi": it.id, disabled: it.disabled || null, onclick: () => { closePop(); it.fn?.(); } }, icon(it.ic || "chev"), h("span", { class: "t" }, it.n, it.d ? h("small", {}, it.d) : null))));
  const templateMenu = (btn, afterId) => menu(btn, [...TEMPLATES.map(([k, ic, en, zh, den, dzh]) => ({ id: k, ic, n: T(en, zh), d: T(den, dzh), fn: () => insertStep(afterId, k) })),
    ...(X.presets?.length ? ["-", { grp: T("Packs", "套組") }, { id: "pack", ic: "pr", n: T("PR follow-through", "PR 跟進"), d: T(`Follow the PR, ask QA, reviewers again, approval, follow to production, release brief (${X.presets.length} steps)`, `跟進 PR、請 QA、再請 reviewer、approve、跟到上線、上線 brief（${X.presets.length} 步）`), fn: () => insertPack(afterId) }] : [])]);
  const targetOptions = (fromId) => [...M.rows.filter((id) => !M.groups.has(id) && id !== fromId).map((id) => ({ id, n: M.num(id), name: M.label(id) })), ...M.ends.map((e) => ({ id: e.id, end: true, ok: okEnd(e), name: e.label }))];
  const branchPicker = (btn, id, edgeIndex = null) => {
    const n = node(id); const e0 = edgeIndex != null ? ed.def.edges[edgeIndex] : null;
    const draft = { out: e0?.when || null, to: e0?.to || null, max: null };
    const used = new Set(ed.def.edges.filter((e) => e.from === id && e.when).flatMap((e) => e.when.split("|")));
    const outs = n.kind === "card" ? (n.card?.options || []).map((o) => o.id) : [...new Set([...(OUTCOMES[n.kind] || []), ...used])];
    const p = popAt(btn, [], "wf-pick"); p.setAttribute("data-rail-branch", id);
    const apply = () => { if (!draft.out || !draft.to) return false;
      commit(() => { if (e0) { const e = ed.def.edges[edgeIndex]; e.when = draft.out; e.to = draft.to; } else addEdge({ from: id, to: draft.to, when: draft.out });
        if (draft.max && M.mi(draft.to) >= 0 && M.mi(draft.to) <= M.mi(id)) node(draft.to).max_visits = draft.max; });
      closePop(); return true; };
    const draw = () => {
      const back = draft.to && M.mi(draft.to) >= 0 && M.mi(draft.to) <= M.mi(id) && !M.isEnd(draft.to);
      put(p, 
        h("h4", {}, n.kind === "card" ? T("When you choose …", "當你選擇…") : T(`If step ${M.num(id)} …`, `如果第 ${M.num(id)} 步…`)),
        h("div", { class: "wf-opts" }, outs.map((o) => h("button", { type: "button", class: "chip", "data-out": o, "aria-pressed": String(draft.out === o), onclick: () => { draft.out = o; draw(); } }, n.kind === "card" ? optLabel(n, o) : word(o)))),
        h("h4", {}, T("… go to", "…就到")),
        h("div", { class: "wf-targets" }, targetOptions(id).map((t) => [t.end && t === targetOptions(id).find((x) => x.end) ? h("div", { class: "grp" }, T("Or end the task", "或結束任務")) : null,
          h("button", { type: "button", "data-to": t.id, "aria-pressed": String(draft.to === t.id), onclick: () => { draft.to = t.id; if (!apply()) draw(); } }, h("span", { class: "n" }, t.end ? (t.ok ? "✓" : "✕") : String(t.n)), h("span", { class: "wf-ell" }, t.end ? T(`Ends: ${t.name}`, `結束：${t.name}`) : t.name))])),
        back ? h("div", { class: "r" }, h("span", { class: "wf-lbl" }, T("Stop after", "最多")), stepper(draft.max || node(draft.to)?.max_visits || 3, (v) => { draft.max = v; draw(); }), h("span", { class: "wf-lbl" }, T("rounds, then ask me", "輪，然後問我"))) : null,
        h("div", { class: "r" }, e0 ? h("button", { type: "button", class: "btn danger", "data-rm": "1", onclick: () => { commit(() => { ed.def.edges.splice(edgeIndex, 1); }); closePop(); } }, T("Remove", "移除")) : h("span"),
          h("button", { type: "button", class: "btn", "data-done": "1", onclick: () => { if (!apply()) closePop(); } }, T("Done", "完成"))));
      p.place();
    };
    draw();
  };
  const stepper = (v, set) => h("span", { class: "wf-stepper" }, h("button", { type: "button", "aria-label": T("Fewer", "減少"), onclick: () => set(Math.max(1, v - 1)) }, "−"), h("span", {}, String(v)), h("button", { type: "button", "aria-label": T("More", "增加"), onclick: () => set(Math.min(20, v + 1)) }, "+"));
  const checkTitle = (ref) => { const c = (ed.checks || []).find((x) => x.ref === ref); const t = c?.title; return t ? (typeof t === "string" ? t : T(t.en, t["zh-TW"] || t.en)) : ref; };
  const checkPicker = (btn, id) => {
    const n = node(id); let q = "", all = false;
    const usedPacks = new Set(ed.def.nodes.flatMap((x) => x.checks || []).map((c) => String(c.use).split("/")[0]).concat("core"));
    const p = popAt(btn, [], "wf-pick"); p.setAttribute("data-rail-checks", id);
    const input = h("input", { class: "input", placeholder: T("Search checks", "搜尋檢查"), "aria-label": T("Search checks", "搜尋檢查"), oninput: (e) => { q = e.target.value.toLowerCase(); list(); } });
    const box = h("div", { class: "wf-targets" });
    const list = () => { const has = new Set((n.checks || []).map((c) => c.use)); const pool = (ed.checks || []).filter((c) => !has.has(c.ref) && c.kind !== "hook" && (!q || `${checkTitle(c.ref)} ${c.ref}`.toLowerCase().includes(q)));
      const mine = pool.filter((c) => usedPacks.has(c.pack) || usedPacks.has(String(c.ref).split("/")[0])), other = pool.filter((c) => !mine.includes(c));
      const row = (c) => h("button", { type: "button", "data-ck": c.ref, onclick: () => { commit(() => { n.checks = [...(n.checks || []), { use: c.ref }]; }); closePop(); } }, h("span", { class: "n" }, "✓"), h("span", { style: "display:grid" }, h("span", {}, checkTitle(c.ref)), h("small", { class: "wf-dim", style: "font-size:12px" }, `${c.ref} · ${c.kind === "judged" ? T("judged", "評審") : T("deterministic", "確定性")}`)));
      put(box, h("div", { class: "grp" }, T("For this workflow", "這個流程用的")), ...(mine.length ? mine.map(row) : [h("div", { class: "grp" }, T("No match", "沒有符合的"))]),
        other.length ? (all || q ? [h("div", { class: "grp" }, T("From other packs", "其他套組")), ...other.map(row)] : [h("button", { type: "button", class: "wf-dim", "data-all": "1", onclick: () => { all = true; list(); } }, T(`Show ${other.length} from other packs`, `顯示其他套組的 ${other.length} 個`))]) : null); };
    p.append(input, box); list(); p.place(); setTimeout(() => input.focus(), 10);
  };

  // ---------- drawer ----------
  const openDrawer = (id, focusName) => { const r = M.rep(id); if (M.onMain.has(r) && M.sec.get(r) && collapsed().has(M.sec.get(r).id)) collapsed().delete(M.sec.get(r).id);
    // the model catalog (as the graph editor's node panel reads it) is fetched the first time a drawer opens
    if (!MODELS.value && !MODELS.pending) MODELS.pending = X.api("/api/models").then((v) => { MODELS.value = v; if (!disposed && R.sel) paint(true); }).catch(() => {});
    R.sel = id; paint(); drawer.classList.add("open"); document.body.classList.add("drawer-open");
    // opened from the keyboard (or a new step) the focus goes to the name, selected when new; opened by a click or tap it goes to
    // the drawer's header, so no keyboard pops up and Escape still closes it
    const keys = viaKeys || focusName;
    setTimeout(() => { if (R.sel !== id) return; const i = drawer.querySelector("[data-rail-name]"), head = drawer.querySelector(".wf-dh");
      if (keys && i) { i.focus({ preventScroll: true }); if (focusName) i.select(); } else head?.focus({ preventScroll: true }); }, 30); };
  const closeDrawer = () => { const was = R.sel, a = document.activeElement, back = !!was && (drawer.contains(a) || a === document.body || !a);
    R.sel = null; drawer.classList.remove("open"); document.body.classList.remove("drawer-open"); drawer.replaceChildren(); if (disposed) return; paint();
    // and gives it back to the step it was opened from
    if (back) root.querySelector(`.r-row[data-step="${CSS.escape(M.rep(was))}"]`)?.focus({ preventScroll: true }); };
  const optLabel = (n, id) => { const o = (n.card?.options || []).find((x) => x.id === id); return o ? T(o.label, o.labelZh || o.label) : String(id).replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()); }; // a choice without a label reads as its own word ("Rescope")
  // Studio has no model ranking: Strongest and Fast keep the staffed provider and model and set the reasoning effort to the
  // highest / lowest one that model takes in Studio's model catalog (/api/models); a step without its own provider uses the
  // efforts every listed provider takes, else high / low
  const presetOf = (n) => { const role = roleOf(n), prov = n.provider || role?.provider, model = n.model || role?.model, cat = MODELS.value?.providers || [];
    const ok = (l) => EFFORTS.filter((e) => (l || []).includes(e));
    let list = [], from = "";
    const p = prov && cat.find((x) => x.id === prov);
    if (p) { const m = model && p.models.find((x) => x.id === model); list = ok(m ? m.efforts : [...new Set(p.models.flatMap((x) => x.efforts || []))]); if (list.length) from = T(` · from ${prov}${m ? ` ${m.id}` : ""}`, ` · 依 ${prov}${m ? ` ${m.id}` : ""}`); }
    if (!list.length && !prov) { const sets = cat.map((x) => ok([...new Set(x.models.flatMap((m) => m.efforts || []))])).filter((l) => l.length); if (sets.length) list = sets.reduce((a, b) => a.filter((e) => b.includes(e))); }
    if (list.length < 2) list = ["low", "high"];
    const usable = list.filter((e) => e !== "minimal"), strong = list.at(-1), fast = usable[0] || list[0];
    const kind = !n.provider && !n.model && !n.effort ? "default" : !n.provider && !n.model && n.effort === strong ? "strongest" : !n.provider && !n.model && n.effort === fast ? "fast" : "custom";
    return { kind, strong, fast, from }; };
  const roleOf = (n) => ed.def.roles.find((r) => r.id === (n.role ?? (n.kind === "loop" ? n.args?.coordinator ?? "coordinator" : undefined)));
  const section = (ic, title, small, ...kids) => h("section", { class: "wf-ds" }, h("h3", {}, icon(ic), title, small ? h("small", {}, small) : null), ...kids);
  const setField = (n, k, v) => commit(() => { if (v === "" || v == null) delete n[k]; else n[k] = v; });
  const drawDrawer = () => {
    const id = R.sel; if (!id) { drawer.replaceChildren(); return; }
    if (M.groups.has(id)) { const g = M.groups.get(id);
      put(drawer, h("div", { class: "wf-dh", tabindex: "-1" }, h("div", { class: "wf-num" }, String(M.num(id)), h("span", { class: "k k-group" }, icon("fork"))), h("input", { value: kindName("group"), readonly: true, "aria-label": T("Step name", "步驟名稱") }), closeBtn()),
        h("div", { class: "wf-db" }, section("fork", kindName("group"), null, h("p", {}, T(`${g.members.map((m) => node(m).label).join(" and ")} start at the same time. The next step waits for ${g.members.length > 2 ? "all of them" : "both"}.`, `${g.members.map((m) => node(m).label).join("、")} 同時開始，下一步等它們都完成。`)),
          h("p", { class: "wf-dim" }, T("Parallel steps are read-only here for now. Change them in the graph editor.", "同時進行的步驟目前在這裡唯讀，請到流程圖編輯器修改。")), h("a", { class: "btn", href: `${base()}/advanced`, "data-rail-graph": "" }, icon("workflow"), T("Open the graph editor", "開啟流程圖編輯器")))),
        h("div", { class: "wf-df" }, h("span"), h("button", { type: "button", class: "btn", onclick: closeDrawer }, T("Done", "完成"))));
      return; }
    const n = node(id); if (!n) { drawer.replaceChildren(); return; }
    const ro = readOnly(), secs = [];
    const name = h("input", { value: n.label, "aria-label": T("Step name", "步驟名稱"), "data-rail-name": "", readonly: ro || null, onchange: (e) => { const v = e.target.value.trim(); if (v && v !== n.label) commit(() => { n.label = v; }); }, onkeydown: (e) => { if (e.key === "Enter" && !e.isComposing) e.target.blur(); } });
    if (n.kind === "agent" || n.kind === "loop") {
      const role = h("select", { class: "select", "data-rail-role": "", "aria-label": T("Role", "角色"), disabled: ro || null, onchange: (e) => { const v = e.target.value; if (v === "+") { newRole(n, e.target); return; } if (n.kind === "agent") setField(n, "role", v); else commit(() => { n.args = { ...(n.args || {}), coordinator: v }; }); } },
        ed.def.roles.map((r) => h("option", { value: r.id, selected: r.id === roleOf(n)?.id || null }, r.label || r.id)), n.kind === "agent" ? h("option", { value: "+" }, T("New role…", "新角色…")) : null);
      const exact = [n.provider, n.model, n.effort].filter(Boolean).join(" · "), pr = presetOf(n);
      const pick = (k, fn) => h("button", { type: "button", "data-preset": k, "aria-pressed": String(pr.kind === k), disabled: ro || null, onclick: fn }, { default: T("Team default", "團隊預設"), strongest: T("Strongest", "最強"), fast: T("Fast", "快速") }[k]);
      const preset = h("div", { class: "seg wf-seg", role: "group", "aria-label": T("Model", "模型") },
        pick("default", () => { if (pr.kind !== "default") commit(() => { delete n.provider; delete n.model; delete n.effort; }); }),
        pick("strongest", () => { if (pr.kind !== "strongest") commit(() => { n.effort = pr.strong; }); }),
        pick("fast", () => { if (pr.kind !== "fast") commit(() => { n.effort = pr.fast; }); }),
        h("button", { type: "button", "data-preset": "custom", "aria-pressed": String(pr.kind === "custom"), disabled: ro || null, title: T("Exact provider, model and effort", "指定供應商、模型與推理強度"), onclick: () => { R.advOpenStep = true; drawDrawer(); drawer.querySelector("[data-rail-step-adv]")?.scrollIntoView({ block: "nearest" }); } }, T("Exact…", "指定…")));
      secs.push(section("human", T("Who", "誰來做"), null, h("div", { class: "field" }, h("label", {}, T("Role", "角色")), role),
        h("div", { class: "field" }, h("span", { class: "lbl" }, T("Model", "模型")), preset, h("span", { class: "wf-dim", style: "font-size:12px", "data-rail-preset-note": "" }, pr.kind === "default" ? T("The Crew page decides (approved staffing for this role).", "由 Crew 頁決定（這個角色核准的配置）。")
          : pr.kind === "strongest" ? T(`The model the Crew page picks, at its highest reasoning effort (${pr.strong})${pr.from}.`, `Crew 頁選的模型，用最高推理強度（${pr.strong}）${pr.from}。`)
          : pr.kind === "fast" ? T(`The model the Crew page picks, at its lowest reasoning effort (${pr.fast})${pr.from}.`, `Crew 頁選的模型，用最低推理強度（${pr.fast}）${pr.from}。`) : exact))));
    }
    if (n.kind === "agent" || n.kind === "loop" || (n.kind === "hook" && X.pinsSkills?.(n))) secs.push(skillsSection(n, ro));
    if (n.kind === "hook") { const known = [...new Set([...Object.keys(ACTIONS), ...ed.def.nodes.filter((x) => x.kind === "hook" && x.do).map((x) => x.do)])];
      secs.push(section("tool", T("What it does", "做什麼"), null, h("select", { class: "select", "data-rail-action": "", "aria-label": T("Action", "動作"), disabled: ro || M.isEnd(n.id) || null, onchange: (e) => setField(n, "do", e.target.value) },
        M.isEnd(n.id) && !n.do ? h("option", { value: "" }, T("Ends the task", "結束任務")) : null, known.map((a) => h("option", { value: a, selected: a === n.do || null }, actionName(a)))))); }
    if (n.kind === "loop") secs.push(section("loop", T("Repeats", "重做"), null, h("div", { class: "wf-row2" }, h("span", { class: "grow wf-2" }, T(`Step ${M.num(n.args?.producer)} · ${node(n.args?.producer)?.label || "?"}, up to`, `第 ${M.num(n.args?.producer)} 步 · ${node(n.args?.producer)?.label || "?"}，最多`)),
      ro ? h("b", {}, String(n.args?.round_cap ?? 3)) : stepper(Number(n.args?.round_cap ?? 3), (v) => commit(() => { n.args = { ...(n.args || {}), round_cap: v }; })), h("span", { class: "wf-2" }, T("rounds", "輪")))));
    if (!["card", "check"].includes(n.kind) && !M.isEnd(n.id)) secs.unshift(h("section", { class: "wf-ds", "data-rail-gives-section": "" }, h("div", { class: "field" }, h("label", { for: "railGives" }, T("Hands on to the next step", "交給下一步的")), h("input", { id: "railGives", "data-rail-gives": "", value: n.detail || "", readonly: ro || null, placeholder: T("e.g. a tested change", "例如：測過的修改"), onchange: (e) => setField(n, "detail", e.target.value.trim()) }))));
    if (n.kind === "card") secs.push(choicesSection(n, ro));
    if (n.kind !== "card" && !M.isEnd(n.id)) {
      secs.push(section("gate", T("Must pass", "必須通過"), (n.checks || []).length ? T(`${n.checks.length} check${n.checks.length > 1 ? "s" : ""}`, `${n.checks.length} 個檢查`) : T("nothing yet", "還沒有"),
        ...(n.checks || []).map((c, i) => h("div", { class: "wf-chk", "data-rail-check": c.use }, icon("check"), h("span", { class: "nm" }, checkTitle(c.use), " ", h("small", {}, `· ${c.use}`)), ro ? null : h("button", { type: "button", class: "wf-x", "aria-label": T(`Remove ${checkTitle(c.use)}`, `移除 ${checkTitle(c.use)}`), onclick: () => commit(() => { n.checks.splice(i, 1); if (!n.checks.length && n.kind !== "check") delete n.checks; }) }, icon("x")))),
        ro ? null : h("button", { type: "button", class: "wf-linkbtn", "data-act": "addcheck", onclick: (e) => { e.stopPropagation(); checkPicker(e.currentTarget, n.id); } }, icon("plus"), T("Add a check", "加一個檢查"))));
      if (M.onMain.has(n.id) && !ro) { const ask = askCardFor(n.id);
        secs.push(h("section", { class: "wf-ds" }, h("div", { class: "wf-row2" }, h("div", { class: "grow" }, h("h3", {}, icon("human"), T("Ask me before continuing", "繼續前先問我")),
          h("p", { style: "margin-top:2px" }, ask ? [T(`Step ${M.num(ask.id)} asks you: ${(ask.card?.options || []).map((o) => T(o.label, o.labelZh || o.label)).join(" / ")}. `, `第 ${M.num(ask.id)} 步會問你：${(ask.card?.options || []).map((o) => T(o.label, o.labelZh || o.label)).join(" / ")}。`), h("button", { type: "button", class: "wf-linkbtn", onclick: () => openDrawer(ask.id) }, T("Edit the choices", "改選項"))] : T("The task waits for your OK after this step.", "這步之後，任務等你點頭。"))),
          h("button", { type: "button", class: "wf-sw", role: "switch", id: "dAsk", "data-rail-ask": n.id, "aria-checked": String(!!ask), "aria-label": T("Ask me before continuing", "繼續前先問我"), onclick: () => toggleAsk(n.id) })))); }
    }
    secs.push(stepAdvanced(n, ro));
    put(drawer, 
      h("div", { class: "wf-dh", tabindex: "-1" }, h("div", { class: "wf-num" }, String(M.num(n.id)), h("span", { class: `k k-${n.kind}` }, icon(KIC[n.kind] || "agent"))), name, closeBtn()),
      h("div", { class: "wf-db" }, h("div", { class: "wf-dim", style: "font-size:12px;padding-top:10px" }, kindName(n.kind), M.onMain.has(n.id) ? "" : M.isEnd(n.id) ? T(" · an end", " · 結束點") : T(" · only reached by a branch", " · 只有分支會到")),
        ...problemsFor(n.id).map((p) => h("div", { class: "wf-warn" }, icon("alert"), p.text)), ...secs),
      h("div", { class: "wf-df" }, ro ? h("span") : h("button", { type: "button", class: "btn danger", "data-rail-remove": n.id, onclick: () => removeStep(n.id) }, icon("trash"), T("Remove step", "移除步驟")), h("button", { type: "button", class: "btn", "data-act": "close", onclick: closeDrawer }, T("Done", "完成"))));
  };
  const closeBtn = () => h("button", { type: "button", class: "btn ghost icon", "data-act": "close", "aria-label": T("Close", "關閉"), onclick: closeDrawer }, icon("x"));
  const newRole = (n, sel) => { const from = roleOf(n) || ed.def.roles[0]; const box = h("div", { class: "wf-row2", "data-rail-new-role": "" });
    const input = h("input", { class: "input grow", placeholder: T("Role name, e.g. Writer", "角色名稱，例如：寫手"), "aria-label": T("New role name", "新角色名稱") });
    const ok = h("button", { type: "button", class: "btn", onclick: () => { const label = input.value.trim(); if (!label || !from) { sel.value = n.role || ""; box.remove(); return; } const rid = (() => { let b = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "role", s = b, i = 2; while (ed.def.roles.some((r) => r.id === s)) s = `${b}-${i++}`; return s; })();
      commit(() => { ed.def.roles.push({ ...clone(from), id: rid, label }); n.role = rid; }); } }, T("Add", "加入"));
    sel.after(box); box.append(input, ok); input.focus(); if (!from) box.append(h("span", { class: "wf-dim" }, T("Add a role in the graph editor first.", "請先到流程圖編輯器加角色。"))); };
  const skillsSection = (n, ro) => {
    const lib = new Map((ed.lib || []).map((x) => [x.id, x])), list = n.skills || [], role = roleOf(n);
    const set = (next) => commit(() => { if (next.length) n.skills = next; else delete n.skills; });
    const ctx = { kind: n.kind, id: n.id, role: role ? { id: role.id, label: role.label, skill: role.skill } : null, format: n.args?.format ?? null };
    const sugg = [...lib.values()].filter((x) => !list.some((p) => p.id === x.id)).map((x) => ({ x, f: window.crewSkillFit ? window.crewSkillFit(x.fits, ctx) : 0 })).filter((a) => a.f >= 2).slice(0, 6).map((a) => a.x);
    const nameOf = (x, id) => { const nm = x?.name && x.name !== id ? x.name : null; return nm || String(id).split(/[-_]/).map((w) => (/^(ui|pr|ci|qa|api|cjk|ux)$/.test(w) ? w.toUpperCase() : w)).join(" ").replace(/^./, (c) => c.toUpperCase()); };
    const sw = (on, id, label, fn) => h("div", { class: "wf-skill" }, h("span", { class: on ? "nm" : "nm wf-2" }, label), h("button", { type: "button", class: "wf-sw", role: "switch", "aria-checked": String(on), "data-skill": id, "aria-label": label, disabled: ro || null, onclick: fn }));
    return section("book", T("Instructions", "指示"), T(`${list.length} skill${list.length === 1 ? "" : "s"} on`, `開了 ${list.length} 個技能`),
      role ? h("div", { class: "wf-skill" }, h("span", { class: "nm" }, T(`${role.label}'s own instructions`, `${role.label} 自己的指示`), " ", h("small", {}, T("· always on", "· 一直開著"))), h("a", { class: "wf-linkbtn", href: "#/skills" }, T("Read", "閱讀"))) : null,
      ...list.map((p, i) => sw(true, p.id, nameOf(lib.get(p.id), p.id), () => set(list.filter((_, k) => k !== i)))),
      sugg.length ? h("div", { class: "wf-lbl", style: "margin-top:4px" }, role ? T(`Suggested for ${role.label}`, `建議給 ${role.label}`) : T("Suggested", "建議")) : null,
      ...sugg.map((x) => sw(false, x.id, nameOf(x, x.id), () => { const cur = x.versions?.find((v) => v.n === x.current); if (cur) set([...list, { id: x.id, v: cur.n, sha256: cur.sha256 }]); })),
      h("a", { class: "wf-linkbtn", href: "#/skills", "data-act": "moreskills" }, icon("plus"), T("Find more skills", "找更多技能")));
  };
  const choicesSection = (n, ro) => {
    const opts = n.card?.options?.length ? n.card.options.map((o) => o.id) : [...new Set(ed.def.edges.filter((e) => e.from === n.id).flatMap((e) => (e.when || "").split("|").filter(Boolean)))];
    const editable = !!n.card?.options?.length && !ro;
    const where = (opt) => ed.def.edges.find((e) => e.from === n.id && (e.when || "").split("|").includes(opt))?.to || "";
    const setWhere = (opt, to) => commit(() => { const e = ed.def.edges.find((x) => x.from === n.id && (x.when || "").split("|").includes(opt));
      if (e && (e.when || "") === opt) { if (to) e.to = to; else ed.def.edges.splice(ed.def.edges.indexOf(e), 1); }
      else { if (e) e.when = e.when.split("|").filter((w) => w !== opt).join("|"); if (to) addEdge({ from: n.id, to, when: opt }); } });
    return section("human", T("Your choices", "你的選項"), null, h("p", {}, T("What you can answer, and where each answer goes.", "你能怎麼回答，以及每個回答會去哪裡。")),
      ...opts.map((o, i) => h("div", { class: "wf-choice", "data-rail-choice": o },
        h("input", { class: "input", value: optLabel(n, o), readonly: !editable || null, "aria-label": T(`Choice ${i + 1}`, `選項 ${i + 1}`), onchange: (e) => { const v = e.target.value.trim(); if (!v) return; commit(() => { const op = n.card.options.find((x) => x.id === o); if (T(true, false)) op.label = v; else op.labelZh = v; }); } }),
        h("span", { class: "arrow" }, "→"),
        h("select", { class: "select", "aria-label": T(`Where ${optLabel(n, o)} goes`, `${optLabel(n, o)} 去哪裡`), disabled: ro || null, onchange: (e) => setWhere(o, e.target.value) }, h("option", { value: "" }, T("Nowhere (stops)", "不接（停住）")),
          targetOptions(n.id).map((t) => h("option", { value: t.id, selected: t.id === where(o) || null }, t.end ? T(`Ends: ${t.name}`, `結束：${t.name}`) : `${t.n} · ${t.name}`))),
        editable ? h("button", { type: "button", class: "wf-x", "aria-label": T("Remove choice", "移除選項"), onclick: () => commit(() => { n.card.options = n.card.options.filter((x) => x.id !== o); ed.def.edges = ed.def.edges.filter((e) => !(e.from === n.id && e.when === o)); }) }, icon("x")) : h("span"))),
      editable ? h("button", { type: "button", class: "wf-linkbtn", "data-act": "addchoice", onclick: () => commit(() => { let k = "choice", i = 2; while (n.card.options.some((x) => x.id === k)) k = `choice-${i++}`; n.card.options.push({ id: k, label: "New choice", labelZh: "新選項" }); }) }, icon("plus"), T("Add a choice", "加一個選項"))
        : h("p", { class: "wf-dim" }, T("This card's choices come from its mode; change where each goes here, or its wording under Advanced.", "這張卡的選項由它的模式決定；這裡可改每個選項去哪裡，用詞請到進階修改。")));
  };
  const stepAdvanced = (n, ro) => {
    const kv = [];
    const text = (k, ph, num) => h("input", { class: `input${num ? "" : " mono"}`, value: n[k] ?? "", placeholder: ph || "", type: num ? "number" : "text", min: num ? 0 : null, readonly: ro || null, "data-rail-field": k, onchange: (e) => setField(n, k, num ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value.trim()) });
    const json = (k) => h("textarea", { class: "wf-raw", readonly: ro || null, "data-rail-field": k, onchange: (e) => { try { const v = e.target.value.trim() ? JSON.parse(e.target.value) : ""; setField(n, k, v); } catch { e.target.setCustomValidity(T("Not valid JSON", "不是有效的 JSON")); e.target.reportValidity(); } } }, n[k] ? JSON.stringify(n[k], null, 2) : "");
    kv.push([T("Step id", "步驟代號"), h("span", { class: "mono" }, n.id)], [T("Kind", "種類"), h("span", { class: "mono" }, n.kind)], );
    if (n.kind === "agent") kv.push([T("Mode", "模式"), text("mode")]);
    kv.push([T("Time limit (s)", "時間上限（秒）"), text("timeout_s", "", true)], [T("Retries", "重試次數"), text("retries", "", true)], [T("Runs at most", "最多執行"), text("max_visits", T("no limit", "不限"), true)],
      [T("Waits for", "等待"), h("select", { class: "select", disabled: ro || null, "data-rail-field": "join", onchange: (e) => setField(n, "join", e.target.value) }, h("option", { value: "" }, T("Any input (default)", "任一輸入（預設）")), h("option", { value: "all", selected: n.join === "all" || null }, T("All inputs (join)", "所有輸入（匯合）")))],
      [T("Serves intent lines", "服務的意圖行"), h("input", { class: "input", value: (n.serves || []).join(", "), placeholder: "1, 3", readonly: ro || null, onchange: (e) => setField(n, "serves", e.target.value.split(/[ ,]+/).filter(Boolean).map(Number).filter((x) => x >= 1)) })],
      [T("Marks lifecycle", "標記生命週期"), h("input", { class: "input mono", value: (n.lifecycle || []).join(", "), placeholder: "after_round", readonly: ro || null, onchange: (e) => setField(n, "lifecycle", e.target.value.split(/[ ,]+/).filter(Boolean)) })]);
    if (n.kind === "agent" || n.kind === "loop") kv.push([T("Seat", "席位"), text("seat", T("role default", "角色預設"))]);
    if (n.kind === "hook") kv.push([T("Action id", "動作代號"), text("do")]);
    if (n.kind === "hook" || n.kind === "card" || n.kind === "loop" || n.kind === "check") kv.push([T("Args (JSON)", "參數（JSON）"), json("args")]);
    if (n.kind === "card") kv.push([T("Card (JSON)", "卡片（JSON）"), json("card")]);
    const exact = (n.kind === "agent" || n.kind === "loop") && X.nodeModelControls ? X.nodeModelControls(n, roleOf(n)?.skill, { attr: "data-rail-model", note: "saved", roleSkillPick: false, onChange: (k, v) => setField(n, k, v) }) : null;
    const mine = ed.def.edges.map((e, i) => ({ ...e, i })).filter((e) => e.from === n.id);
    const det = h("details", { class: "wf-adv", "data-rail-step-adv": "", open: R.advOpenStep || null, ontoggle: (e) => { R.advOpenStep = e.target.open; } },
      h("summary", {}, icon("chev", "ic chev"), T("Advanced", "進階"), h("small", {}, T("ids, timing, exact model, raw connections", "代號、時間、指定模型、原始連線"))),
      h("div", { class: "wf-advbody", style: "padding-top:12px" }, h("div", { class: "wf-kv" }, kv.flatMap(([a, b]) => [h("span", {}, a), h("span", {}, b)])), exact,
        h("div", { class: "wf-lbl" }, T("Connections from this step (free-text outcome)", "從這一步出去的連線（自由文字結果）")),
        h("table", { class: "wf-edges", "data-rail-raw": n.id }, h("tr", {}, h("th", {}, T("to", "到")), h("th", {}, T("when", "條件")), h("th", {}, T("edge checks", "連線檢查"))),
          mine.map((e) => h("tr", {}, h("td", { class: "mono" }, e.to), h("td", {}, h("input", { value: e.when || "", readonly: ro || null, "aria-label": T("Edge outcome", "邊的結果"), onchange: (ev) => commit(() => { const x = ed.def.edges[e.i]; const v = ev.target.value.trim(); if (v) x.when = v; else delete x.when; }) })),
            h("td", { class: "wf-dim" }, (e.checks || []).map((c) => checkTitle(c.use)).join(", ") || "—")))),
        h("a", { class: "wf-linkbtn", href: `${base()}/advanced` }, icon("workflow"), T("Edit connections and edge checks in the graph editor", "到流程圖編輯器改連線與連線檢查"))));
    return det;
  };
  const problemsFor = (id) => (ed.problems || []).filter((p) => p.node === id);

  // ---------- the rail ----------
  const branchChips = (id) => {
    const out = [], draws = [], n = node(id), main = M.onMain.has(id);
    const to = main ? M.next(id) : null, L = new Set(M.link(id, to).map((e) => e.i));
    const loopRetry = (e) => n?.kind === "loop" && e.to === n.args?.producer;
    for (const e of M.edges.filter((x) => M.froms(id).includes(x.from) && !L.has(x.i))) {
      if (M.groups.has(id)) continue;
      if (loopRetry(e) && main) continue;
      const t = M.rep(e.to), end = M.isEnd(e.to), det = !end && !M.onMain.has(t), back = !end && !det && main && M.mi(t) <= M.mi(id), fwdNext = !end && !det && main && M.mi(t) === M.mi(id) + 1;
      const lbl = n?.kind === "card" && e.when ? h("b", {}, (e.when || "").split("|").map((w) => optLabel(n, w)).join(" / ")) : e.when ? T(`If it ${whenText(e.when)}`, `如果${whenText(e.when)}`) : T("Otherwise", "否則");
      const tgt = end ? T(`ends: ${M.label(e.to)}`, `結束：${M.label(e.to)}`) : det ? T(`detour: ${M.label(t)}`, `支線：${M.label(t)}`)
        : !main ? T(`returns to ${M.num(t)} · ${M.label(t)}`, `回到 ${M.num(t)} · ${M.label(t)}`) : back ? T(`back to ${M.num(t)} · ${M.label(t)}`, `回到 ${M.num(t)} · ${M.label(t)}`) : fwdNext ? T(`continues to ${M.num(t)} · ${M.label(t)}`, `接到 ${M.num(t)} · ${M.label(t)}`) : T(`skips to ${M.num(t)} · ${M.label(t)}`, `跳到 ${M.num(t)} · ${M.label(t)}`);
      const max = back && node(t)?.max_visits ? T(` · max ${node(t).max_visits} rounds`, ` · 最多 ${node(t).max_visits} 輪`) : "";
      const lock = e.checks?.length ? [" · ", icon("lock", "ic sm"), " ", e.checks.map((c) => checkTitle(c.use)).join(", ")] : null;
      // the producer's own way past its refine loop is the line, not a skip
      const pastLoops = main && !end && !det && !back && M.main.slice(M.mi(id) + 1, M.mi(t)).every((x) => node(x)?.kind === "loop" && node(x).args?.producer === id);
      if (pastLoops && !fwdNext) continue;
      const drawn = main && !end && !det && !fwdNext, returns = back || (!main && !end && !det);
      const chip = h("button", { type: "button", class: `wf-chip${returns ? " back" : ""}${end ? " end" : ""}${det ? " det" : ""}${drawn && !back ? " fwd" : ""}`, "data-act": "editbranch", "data-cid": `${id}>${e.i}`, "data-cto": drawn ? t : null, "data-edge-i": e.i,
        onclick: (ev) => { ev.stopPropagation(); if (readOnly()) return; if (det) { openDrawer(t); return; } if (M.groups.has(id) || !node(e.from)) return; branchPicker(ev.currentTarget, e.from, e.i); } },
        icon(end ? "end" : returns ? "back" : det ? "branch" : "skip"), h("span", { class: "wf-ell" }, lbl, " ", returns ? "↩ " : "→ ", tgt, max, lock));
      (drawn ? draws : out).push(chip);
    }
    if (!readOnly() && n && !M.groups.has(id) && !M.isEnd(id)) out.push(h("button", { type: "button", class: "wf-chip add", "data-act": "addbranch", "data-id": id, onclick: (ev) => { ev.stopPropagation(); branchPicker(ev.currentTarget, id); } }, icon("branch"), n.kind === "card" ? T("Add choice", "加選項") : T("Add branch", "加分支")));
    return { out, draws };
  };
  const warnings = (id) => { const n = node(id), w = [];
    if (n?.kind === "check" && !n.args?.route_from && !M.edges.some((e) => e.from === id && (e.when || "").split("|").some((x) => ["fail", "error"].includes(x)))) w.push({ t: T("If this check fails, the task stops here.", "這個檢查失敗時，任務會停在這裡。"), fix: true });
    for (const p of problemsFor(id)) w.push({ t: p.text, level: p.level });
    return w; };
  const gateTag = (id) => { const bits = [], n = node(id);
    if (n && n.kind !== "check" && n.checks?.length) bits.push(h("span", { class: "r-gate", title: n.checks.map((c) => checkTitle(c.use)).join(", "), "data-rail-gate": id }, icon("gate", "ic sm"), h("span", { class: "t" }, T("must pass: ", "必須通過："), n.checks.slice(0, 2).map((c) => checkTitle(c.use)).join(", ")), n.checks.length > 2 ? h("span", { class: "more" }, `+${n.checks.length - 2}`) : null));
    const locked = M.link(id, M.next(id)).flatMap((e) => e.checks || []);
    if (locked.length) bits.push(h("span", { class: "r-gate lock", title: T("Edge checks: edit them in the graph editor", "連線檢查：到流程圖編輯器修改"), "data-rail-lock": id }, icon("lock", "ic sm"), h("span", { class: "t" }, T(`before going on: ${locked.length} gate${locked.length > 1 ? "s" : ""}`, `繼續前：${locked.length} 道關卡`), " · ", locked.map((c) => checkTitle(c.use)).join(", "))));
    return bits; };
  const linkAfter = (id, cls = "") => { const g = gateTag(id), ro = readOnly();
    // the tags stack (one line each, cut with an ellipsis) and the segment grows to hold them; + keeps its own room on the right
    return h("div", { class: `r-link ${cls}${g.length ? " gated" : ""}`, "data-link": id, style: g.length ? `height:${18 + g.length * 26}px` : null }, g.length ? h("div", { class: "r-gates" }, g) : null,
      ro ? null : h("button", { type: "button", class: "r-plus", "data-act": "plus", "data-after": id, "aria-label": T(`Add a step after ${M.label(id)}`, `在 ${M.label(id)} 之後加一步`), title: T("Add a step here", "在這裡加一步"), onclick: (e) => { e.stopPropagation(); templateMenu(e.currentTarget, id); } }, icon("plus")),
      h("span", { class: "r-arrowhead" })); };
  const giverBefore = (id) => { for (let i = M.main.indexOf(id) - 1; i >= 0; i--) { const n = node(M.main[i]); if (n?.detail) return n.detail; } return null; };
  const ioLine = (id) => { const n = node(id); if (!n || ["card", "check"].includes(n.kind)) return null; const main = M.onMain.has(id);
    const gets = main ? giverBefore(id) || (M.main[0] === id ? T("your request", "你的需求") : null) : null;
    const nx = main ? M.next(id) : null;
    const to = !nx ? null : M.isEnd(nx) ? [h("span", { class: "r-arrow" }, " → "), T(`ends: ${M.label(nx)}`, `結束：${M.label(nx)}`)] : [T(" to ", " 給 "), h("b", { class: "r-to" }, `${M.num(nx)} · ${M.label(nx)}`)];
    if (!main && !n.detail) return null;
    return h("div", { class: "r-io" }, gets ? [T(`gets ${fit(gets, 60)}`, `拿到 ${fit(gets, 60)}`), h("span", { class: "r-arrow" }, " · ")] : null, T("hands ", "交出 "), n.detail ? h("b", {}, fit(n.detail, 70)) : T("its result", "它的結果"), to); };
  const whoLine = (n) => { const role = roleOf(n);
    const pk = presetOf(n).kind, pw = pk === "strongest" ? T("highest effort", "最高推理強度") : pk === "fast" ? T("lowest effort", "最低推理強度") : pk === "custom" ? [n.model, n.effort].filter(Boolean).join(" ") : null;
    if (n.kind === "agent") return [T("AI", "AI"), role?.label || n.role, pw, n.skills?.length ? T(`${n.skills.length} skill${n.skills.length > 1 ? "s" : ""}`, `${n.skills.length} 個技能`) : null].filter(Boolean).join(" · ");
    if (n.kind === "hook") return M.isEnd(n.id) ? T("End", "結束") : `${T("Automatic", "自動")} · ${n.do ? actionName(n.do) : n.checks?.length ? T("runs its checks", "執行它的檢查") : actionName(null)}`;
    return ""; };
  const row = (id) => {
    const n = node(id), g = M.groups.get(id), main = M.onMain.has(id), kind = g ? "group" : n.kind, cp = kind === "card" || kind === "check", loop = kind === "loop", num = M.num(id), ro = readOnly();
    const nodeEl = loop ? h("span", { class: "r-node r-loop", "data-node": id }, icon("loop", "ic sm"))
      : cp ? h("span", { class: `r-node r-cp k-${kind}`, "data-node": id }, h("span", { class: "d" }, icon(kind === "card" ? "human" : "gate", "ic sm")))
      : h("span", { class: `r-node k-${kind}`, "data-node": id }, String(num));
    let body;
    if (loop) { const p = node(n.args?.producer), giveUp = M.edges.find((e) => e.from === id && /(^|\|)(cap|stalled)(\||$)/.test(e.when || ""));
      body = [h("div", { class: "r-loopline" }, h("b", {}, n.label), " ", h("span", { class: "wf-2" }, T(`if ${p?.label || "the step"}'s checks fail, refine and try again · max ${n.args?.round_cap ?? 3} rounds`, zhSpace(`如果${p?.label || "那一步"}的檢查沒過，就修正再試`) + ` · 最多 ${n.args?.round_cap ?? 3} 輪`), giveUp ? T(` · then ${M.isEnd(giveUp.to) ? `ends: ${M.label(giveUp.to)}` : `${M.onMain.has(M.rep(giveUp.to)) ? "step" : "detour:"} ${M.label(giveUp.to)}`}`, ` · 然後到 ${M.label(giveUp.to)}`) : ""))]; }
    else if (cp) { const L = main ? M.link(id, M.next(id)) : [];
      const what = kind === "card" ? [h("span", { class: "r-cpk" }, T("Checkpoint · you decide", "檢查點 · 你決定")), L.some((e) => e.when) && main ? [" ", h("span", { class: "wf-2" }, icon("arrow", "ic sm"), " ", h("b", {}, [...new Set(L.flatMap((e) => (e.when || "").split("|")).filter(Boolean))].map((w) => optLabel(n, w)).join(" / ")), T(" continues", " 就繼續"))] : null]
        : [h("span", { class: "r-cpk ok" }, T("Checkpoint · must pass", "檢查點 · 必須通過")), " ", h("span", { class: "wf-2" }, (n.checks || []).slice(0, 3).map((c) => checkTitle(c.use)).join(", "), (n.checks || []).length > 3 ? ` +${n.checks.length - 3}` : "", n.join === "all" ? T(" · waits for every input", " · 等所有輸入") : "")];
      body = [h("div", { class: "r-title" }, h("span", { class: "r-name" }, n.label), " ", what)]; }
    else if (g) { body = [h("div", { class: "r-title" }, h("span", { class: "r-name" }, kindName("group")), h("span", { class: "r-who" }, T(`${g.members.length} steps`, `${g.members.length} 步`))), ioLine(g.members[0]),
      h("div", { class: "r-fork" }, h("span", { class: "r-forkl" }, icon("fork", "ic sm"), T("at the same time", "同時")), g.members.map((m) => h("span", { class: "r-tile", "data-rail-member": m }, h("b", {}, node(m).label), h("small", {}, whoLine(node(m))))),
        h("span", { class: "r-forkl" }, T(`then waits for ${g.members.length > 2 ? "all" : "both"} · `, "然後等它們都完成 · "), h("a", { class: "wf-linkbtn", href: `${base()}/advanced`, "data-rail-graph": "", onclick: (e) => e.stopPropagation() }, T("edit in the graph editor", "到流程圖編輯器修改"))))]; }
    else body = [h("div", { class: "r-title" }, h("span", { class: "r-name" }, n.label), h("span", { class: "r-who" }, whoLine(n))), ioLine(id)];
    if (g) nodeEl.append();
    const { out, draws } = branchChips(id);
    const warn = n ? warnings(id).map((w) => h("div", { class: "wf-warn" }, icon("alert"), w.t, w.fix && !ro ? [" ", h("button", { type: "button", "data-act": "fixwarn", "data-id": id, onclick: (e) => { e.stopPropagation(); branchPicker(e.currentTarget, id); } }, T("Add a branch", "加一個分支"))] : null)) : [];
    const el = h("div", { class: `r-row r-step${g ? " is-group" : ""}${cp ? " is-cp" : ""}${loop ? " is-loop" : ""}${main ? "" : " is-side"}${R.sel === id ? " sel" : ""}`, "data-step": id, draggable: !ro && main && !pinned(id) ? "true" : "false", tabindex: "0",
      "aria-label": T(`Step ${num}: ${M.label(id)}`, `第 ${num} 步：${M.label(id)}`),
      onclick: (e) => { if (e.target.closest("button,a,input,select")) return; openDrawer(id); }, onkeydown: (e) => { if (e.key === "Enter" && e.target === el) openDrawer(id); } },
      h("div", { class: "r-rail" }, nodeEl, g ? forkSvg() : null),
      h("div", { class: "r-body" }, ...body, draws.length ? h("div", { class: "r-drawn" }, draws) : null, h("div", { class: `wf-chips${out.length === 1 && !ro ? " only-add" : ""}` }, out), ...warn),
      h("div", { class: "wf-side" }, ro || g ? null : h("button", { type: "button", class: "btn ghost icon", "data-act": "stepmenu", "data-id": id, "aria-label": T(`More for ${M.label(id)}`, `${M.label(id)} 的更多動作`), onclick: (e) => { e.stopPropagation(); stepMenu(e.currentTarget, id); } }, icon("more"))));
    if (el.draggable) dragRow(el, id);
    return el;
  };
  const forkSvg = () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "r-forksvg"); s.setAttribute("viewBox", "0 0 88 100"); s.setAttribute("preserveAspectRatio", "none"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<path d="M64,22 C64,34 52,34 52,44 V84 C52,94 64,94 64,100"/><path d="M64,22 C64,34 76,34 76,44 V84 C76,94 64,94 64,100"/>'; return s; };
  let dragId = null;
  const dragRow = (el, id) => {
    el.addEventListener("dragstart", (e) => { dragId = id; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", id); } catch {} });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); root.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after")); });
    el.addEventListener("dragover", (e) => { e.preventDefault(); const r = el.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2; root.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after")); el.classList.add(before ? "drop-before" : "drop-after"); });
    el.addEventListener("drop", (e) => { e.preventDefault(); const from = dragId || e.dataTransfer.getData("text/plain"); const before = el.classList.contains("drop-before"); el.classList.remove("drop-before", "drop-after"); if (from) dropOn(from, id, before); dragId = null; });
  };
  const stepMenu = (btn, id) => { const i = M.main.indexOf(id);
    menu(btn, [{ id: "o", ic: "sliders", n: T("Open settings", "開啟設定"), fn: () => openDrawer(id) },
      { id: "u", ic: "up", n: T("Move up", "上移"), disabled: !canMove(id, -1), fn: () => moveStep(id, -1) },
      { id: "dn", ic: "down", n: T("Move down", "下移"), disabled: !canMove(id, 1), fn: () => moveStep(id, 1) },
      { id: "dup", ic: "dup", n: T("Duplicate", "複製"), disabled: i < 0, fn: () => duplicate(id) }, "-",
      { id: "rm", ic: "trash", n: T("Remove step", "移除步驟"), danger: true, fn: () => removeStep(id) }]); };
  const flash = (id) => setTimeout(() => { const e = root.querySelector(`.r-row[data-step="${CSS.escape(id)}"]`); if (e) { e.classList.add("flash"); e.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); } }, 20);
  // what an end means: its own detail, else read from its id and label (parked, dropped …), the result field only as a last resort
  const END_WORDS = [[/park/, "kept for later", "先擱置，之後再做"], [/drop/, "you dropped it", "你放棄了"], [/discard/, "nothing was changed", "什麼都沒改"], [/cancel/, "cancelled", "已取消"],
    [/reject/, "you rejected it", "你不採用"], [/empty|none/, "there was nothing to do", "沒有要做的事"], [/fail/, "it could not finish", "沒能完成"], [/clos/, "closed without finishing", "沒完成就關閉"],
    [/review-room/, "the review room opens", "開啟審查室"], [/filed/, "filed", "已歸檔"], [/install/, "installed", "已安裝"], [/export/, "exported", "已匯出"]];
  const endMeaning = (e, ok) => { if (e.detail) return e.detail; if (ok) return T("the task is done", "任務完成");
    const k = `${e.id} ${e.label}`.toLowerCase(), w = END_WORDS.find(([re]) => re.test(k)) || END_WORDS.find(([re]) => re.test(String(e.args?.result || "")));
    return w ? T(w[1], w[2]) : T("the task stops here", "任務停在這裡"); };
  const endsBlock = () => { const from = (id) => { const s = new Set(); for (const e of M.edges) if (e.to === id) s.add(M.num(e.from)); return [...s].filter(Boolean).sort((a, b) => a - b); };
    return h("div", { class: "r-row r-ends", "data-rail-ends": "" }, h("div", { class: "r-rail" }, h("span", { class: "r-node r-endnode" }, icon("flag", "ic sm"))),
      h("div", { class: "r-body" }, h("div", { class: "r-io" }, h("b", {}, T("Ends", "結束")), M.ends.length === 1 ? T(" here:", "於：") : T(` in one of ${M.ends.length}:`, `：共 ${M.ends.length} 種`)),
        h("div", { class: "r-endlist" }, M.ends.map((e) => { const f = from(e.id), ok = okEnd(e); return h("div", { class: `r-end${ok ? " ok" : ""}`, "data-rail-end": e.id }, icon(ok ? "check" : "end", "ic sm"), h("b", {}, e.label),
          h("span", { class: "wf-2" }, endMeaning(e, ok)),
          h("span", { class: "wf-dim" }, f.length ? T(`from step ${f.join(", ")}`, `來自第 ${f.join("、")} 步`) : "")); }))), h("div")); };
  const strip = () => { const col = collapsed(), segs = [], secs = [];
    for (const id of M.main) { const s = M.sec.get(id); const k = s?.id ?? ""; if (!secs.length || secs.at(-1).k !== k) secs.push({ k, s, ids: [] }); secs.at(-1).ids.push(id); }
    secs.forEach((x, i) => { if (i) segs.push(h("span", { class: "r-phsep", "aria-hidden": "true" }, "›"));
      const on = R.sel && x.ids.includes(M.rep(R.sel));
      segs.push(h("div", { class: `r-ph${col.has(x.k) ? " col" : ""}${on ? " on" : ""}` }, x.s ? h("button", { type: "button", class: "r-phl", "data-phase": x.k, onclick: () => togglePhase(x.k) }, T(x.s.label, x.s.label_tw || x.s.label)) : null,
        h("div", { class: "r-dots" }, x.ids.flatMap((id, j) => { const n = node(id), k = M.groups.has(id) ? "group" : n.kind, cp = k === "card" || k === "check";
          return [j ? h("i") : null, h("button", { type: "button", class: `r-dot k-${k}${cp ? " cp" : ""}${M.rep(R.sel || "") === id ? " on" : ""}`, "data-jump": id, title: `${M.num(id)} · ${M.label(id)}`, "aria-label": T(`Step ${M.num(id)}: ${M.label(id)}`, `第 ${M.num(id)} 步：${M.label(id)}`), onclick: () => { openDrawer(id); flash(id); } }, cp ? "" : String(M.num(id)))]; })))); });
    return h("div", { class: "r-strip", role: "navigation", "aria-label": T("Steps overview", "步驟總覽"), "data-rail-strip": "" }, h("span", { class: "r-sstart", title: T("Start", "開始") }, h("i", { class: "r-sdot" })), ...segs, h("span", { class: "r-phsep" }, "›"),
      h("span", { class: "r-sends" }, M.ends.map((e) => h("span", { class: `r-send${okEnd(e) ? " ok" : ""}` }, e.label)))); };
  const togglePhase = (k) => { const c = collapsed(); c.has(k) ? c.delete(k) : c.add(k); paint(); };
  const rail = () => { const col = collapsed(), out = [];
    out.push(h("div", { class: "r-row r-startrow" }, h("div", { class: "r-rail" }, h("span", { class: "r-node r-start" }, icon("play", "ic sm"))), h("div", { class: "r-body" }, h("div", { class: "r-io" }, h("b", {}, T("Starts", "開始")), T(" with ", "於 "), storyStart())), h("div")));
    let prev = null, lastK = null;
    const secK = (x) => M.sec.get(x)?.id ?? "";
    M.main.forEach((id, i) => { const s = M.sec.get(id), k = secK(id), isCol = !!s && col.has(k);
      if ((i === 0 || k !== lastK) && s) { const run = []; for (const x of M.main.slice(i)) { if (secK(x) !== k) break; run.push(x); }
        const gives = [...run].reverse().map((x) => node(x)?.detail).find(Boolean);
        out.push(prev && !col.has(secK(prev)) ? linkAfter(prev) : h("div", { class: "r-link short" }));
        out.push(h("div", { class: `r-row r-phase${isCol ? " col" : ""}`, "data-rail-phase": k, onclick: isCol ? () => togglePhase(k) : null }, h("div", { class: "r-rail" }, h("span", { class: "r-node r-phnode" }, icon(isCol ? "chev" : "down", "ic sm"))),
          h("div", { class: "r-body" }, h("button", { type: "button", class: "r-phbtn", "data-phase": k, "aria-expanded": String(!isCol), onclick: (e) => { e.stopPropagation(); togglePhase(k); } }, h("b", {}, T(s.label, s.label_tw || s.label)), h("span", { class: "wf-dim" }, T(` · ${run.length} step${run.length > 1 ? "s" : ""}`, ` · ${run.length} 步`))),
            isCol ? h("div", { class: "r-phsum" }, run.flatMap((x, j) => [j ? h("span", { class: "r-arrow" }, " → ") : null, M.label(x)]), gives ? h("span", { class: "wf-dim" }, T(` · hands on ${fit(gives, 50)}`, ` · 交出 ${fit(gives, 50)}`)) : null) : null), h("div")));
        lastK = k; prev = id; if (isCol) return;
        out.push(h("div", { class: "r-link short" }), row(id)); return; }
      lastK = k;
      if (isCol) { prev = id; return; }
      out.push(prev ? linkAfter(prev) : h("div", { class: "r-link short" }), row(id)); prev = id; });
    const last = M.main.at(-1);
    out.push(last && !col.has(M.sec.get(last)?.id ?? "") ? linkAfter(last, "end") : h("div", { class: "r-link end" }, h("span", { class: "r-arrowhead" })), endsBlock());
    if (M.detours.length) out.push(h("div", { class: "r-detours", "data-rail-detours": "" }, h("div", { class: "wf-sec" }, T("Detours", "支線"), " ", h("span", { class: "wf-dim" }, T("· only reached by a branch; each one returns to the line or ends the task", "· 只有分支會到；每條都會回到主線或結束任務"))), M.detours.map(row)));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "r-conn"); svg.setAttribute("aria-hidden", "true");
    return h("div", { class: `r-wrap${R.editing ? " editing" : ""}`, "data-rail-wrap": "" }, svg, ...out, h("p", { class: "wf-dim r-dropped", "data-rail-dropped": "", hidden: true })); };
  const drawConnectors = () => {
    const wrap = root.querySelector("[data-rail-wrap]"), svg = wrap?.querySelector(".r-conn"); if (!wrap || !svg || !wrap.isConnected) return;
    const wr = wrap.getBoundingClientRect(), phone = innerWidth <= 760, lanesX = phone ? [16, 6] : [46, 34, 22, 10], items = [];
    wrap.querySelectorAll(".r-step:not(.is-side) .wf-chip[data-cto]").forEach((c) => { const tn = wrap.querySelector(`[data-node="${CSS.escape(c.dataset.cto)}"]`); if (!tn) return;
      const sr = c.getBoundingClientRect(), tr = tn.getBoundingClientRect(); items.push({ cid: c.dataset.cid, y1: sr.top + sr.height / 2 - wr.top, y2: tr.top + tr.height / 2 - wr.top, x1: sr.left - wr.left, xt: tr.left - wr.left, back: c.classList.contains("back") }); });
    wrap.querySelectorAll(".r-step:not(.is-side) .r-loop").forEach((ln) => { const n = node(ln.dataset.node), pn = n && wrap.querySelector(`[data-node="${CSS.escape(n.args?.producer || "")}"]`); if (!pn) return;
      const a = ln.getBoundingClientRect(), b = pn.getBoundingClientRect(); items.push({ cid: `loop>${n.id}`, y1: a.top + a.height / 2 - wr.top, y2: b.top + b.height / 2 - wr.top, x1: a.left - wr.left, xt: b.left - wr.left, back: true }); });
    items.sort((a, b) => Math.abs(a.y1 - a.y2) - Math.abs(b.y1 - b.y2));
    const lanes = lanesX.map(() => []), paths = []; let dropped = 0;
    for (const it of items) { const lo = Math.min(it.y1, it.y2), hi = Math.max(it.y1, it.y2), li = lanes.findIndex((L) => !L.some(([a, b]) => lo < b + 6 && hi > a - 6));
      if (li < 0) { dropped++; continue; } lanes[li].push([lo, hi]); const x = lanesX[li], r = 8, up = it.y2 < it.y1 ? -1 : 1;
      paths.push(`<path class="${it.back ? "back" : "fwd"}" data-cid="${attr(it.cid)}" d="M${it.x1 - 2},${it.y1} H${x + r} Q${x},${it.y1} ${x},${it.y1 + up * r} V${it.y2 - up * r} Q${x},${it.y2} ${x + r},${it.y2} H${it.xt - 3}" marker-end="url(#rah${it.back ? "b" : "f"}-${ed.id})"/>`); }
    svg.setAttribute("width", wr.width); svg.setAttribute("height", wrap.scrollHeight);
    svg.innerHTML = `<defs><marker id="rahb-${ed.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="r-ah back"/></marker><marker id="rahf-${ed.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="r-ah fwd"/></marker></defs>${paths.join("")}`;
    wrap.dataset.connectors = String(paths.length); wrap.dataset.dropped = String(dropped);
    const note = root.querySelector("[data-rail-dropped]"); if (note) { note.hidden = !dropped; note.textContent = dropped ? T(`${dropped} more branch${dropped > 1 ? "es" : ""} not drawn as a line (no free lane); their chips still say where they go.`, `還有 ${dropped} 條分支沒畫成線（沒有空的線道）；它們的標籤仍寫著去哪裡。`) : ""; } };
  const hoverConn = (e) => { root.querySelectorAll(".r-conn path.hl").forEach((p) => p.classList.remove("hl")); const c = e.target.closest?.("[data-cid]"); if (c) root.querySelector(`.r-conn path[data-cid="${CSS.escape(c.dataset.cid)}"]`)?.classList.add("hl"); };
  root.addEventListener("mouseover", hoverConn);

  // ---------- header, tabs, other views ----------
  const okEndNode = () => M.ends.find(okEnd) || M.ends[0] || null;
  const storyStart = () => (ed.def.params && Object.keys(ed.def.params).length && Object.values(ed.def.params).every((p) => String(p.label).length <= 24) ? T(`your request and ${Object.values(ed.def.params).map((p) => T(p.label, p.labelZh || p.label).toLowerCase()).slice(0, 2).join(", ")}`, `你的需求與${Object.values(ed.def.params).map((p) => T(p.label, p.labelZh || p.label)).slice(0, 2).join("、")}`) : T("your request", "你的需求"));
  // the description's first sentence (or its heading before a colon), capitalised: the "how" after the one sentence on top
  const howLine = () => { let d = String(ed.def.description || "").trim(); if (!d) return "";
    d = d.split(/(?<=[.!?。])\s+/)[0]; if (d.length > 120 && /:\s/.test(d.slice(0, 100))) d = d.slice(0, d.search(/:\s/));
    d = fit(d, 140).replace(/^./, (c) => c.toUpperCase()); return /[.!?。…]$/.test(d) ? d : d + (/[\u3400-\u9fff]/.test(d) ? "。" : "."); };
  const story = () => { const e = okEndNode(), d = howLine();
    return h("p", { class: "r-story", "data-rail-story": "" }, T("Takes ", "拿到 "), h("b", {}, storyStart()), h("span", { class: "r-arrow" }, " → "), T("ends with ", "結束於 "), h("b", {}, e ? e.label : T("its last step", "最後一步")), T(".", "。"),
      d ? h("span", { class: "wf-2" }, " ", d) : null); };
  const titleEl = () => { if (R.renaming) { const input = h("input", { id: "wfName", "data-rail-rename": "", value: ed.displayName || ed.def.name, maxlength: 80, "aria-label": T("Workflow name", "流程名稱") });
      const done = async (keep) => { if (!R.renaming) return; R.renaming = false; const v = input.value.trim(); if (!keep || !v || v === (ed.displayName || ed.def.name)) { paint(); return; }
        try { const r = await X.api("/api/workflow-names", { workflow: ed.id, name: v }); window.setWorkflowNames?.(r.names); ed.displayName = r.displayName || v; ed.renamed = r.renamed ?? true; X.renamed?.(); say(T(`Renamed to “${ed.displayName}”.`, `已改名為「${ed.displayName}」。`)); } catch (err) { say(err.message); } paint(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); done(true); } if (e.key === "Escape") done(false); }); input.addEventListener("blur", () => done(true));
      setTimeout(() => { input.focus(); input.select(); }, 10); return h("div", { class: "wf-title" }, input); }
    return h("div", { class: "wf-title" }, h("h1", { "data-ed-name": ed.id, "data-act": "rename", title: readOnly() ? null : T("Click to rename", "點一下改名"), onclick: () => { if (readOnly() || X.internal) return; R.renaming = true; paint(); } }, ed.displayName || ed.def.name)); };
  const verMenu = (btn) => menu(btn, [{ grp: T("Open a version", "開啟版本") }, ...ed.versions.slice().reverse().slice(0, 8).map((v) => ({ id: `v${v.version}`, ic: v.version === ed.def.version ? "check" : "clock", n: `v${v.version}${v.version === ed.saved.version && !ed.v ? T(" · current", " · 目前") : ""}`, d: v.note ? fit(/^Saved from Firstmate draft /.test(v.note) ? T("Saved from a Firstmate draft", "由 Firstmate 草稿儲存") : v.note, 60) : null, fn: () => { location.hash = `#/workflows/${ed.id}/v${v.version}`; } })),
    "-", { id: "all", ic: "arrow", n: T("All versions", "全部版本"), fn: () => { location.hash = `${base()}/versions`; } }]);
  const pageMenu = (btn) => menu(btn, [
    { id: "r", ic: "pencil", n: T("Rename…", "改名…"), d: T("Or click the title; reset to the default name here", "也可以點標題；這裡可恢復預設名稱"), disabled: readOnly(), fn: () => (X.renameDialog ? X.renameDialog(ed, () => paint()) : ((R.renaming = true), paint())) },
    { id: "d", ic: "dup", n: T("Duplicate", "複製"), disabled: R.changes > 0, fn: () => X.copyTemplate?.(ed, false).catch?.((e) => say(e.message)) },
    "-", { grp: T("Advanced", "進階") },
    { id: "g", ic: "workflow", n: T("Graph editor", "流程圖編輯器"), fn: () => { location.hash = `${base()}/advanced`; } },
    { id: "c", ic: "refresh", n: T("Compare versions…", "比較版本…"), fn: () => { location.hash = `${base()}/advanced`; } },
    { id: "x", ic: "download", n: T("Export / transfer package…", "匯出／傳輸套件…"), fn: () => { location.hash = `${base()}/advanced`; } },
    ...(ed.personal ? ["-", { id: "t", ic: "trash", n: ed.trash?.deleted ? T("Restore from Trash", "從垃圾桶復原") : T("Move to Trash", "移至垃圾桶"), danger: !ed.trash?.deleted, fn: () => X.trash?.(ed) }] : [])]);
  const header = () => {
    const editTog = h("button", { type: "button", class: "btn wf-edit-tog", "data-rail-edit-toggle": "", onclick: () => { R.editing = !R.editing; paint(); } }, R.editing ? T("Done editing", "完成編輯") : T("Edit steps", "編輯步驟"));
    return h("div", { class: "phead" }, h("div", { style: "min-width:0;flex:1" }, titleEl(), story(),
      h("div", { class: "wf-meta" }, h("button", { type: "button", class: "btn ghost", style: "min-height:24px;padding:0 6px", "data-rail-version": "", "aria-label": T("Versions", "版本"), title: T(`Showing v${ed.def.version}${ed.v && ed.v !== ed.versions.at(-1)?.version ? " (not the latest)" : ""}`, `顯示 v${ed.def.version}`), onclick: (e) => { e.stopPropagation(); verMenu(e.currentTarget); } }, h("span", { class: "wf-ver" }, h("i"), `v${ed.saved.version}`), icon("down", "ic sm")),
        h("span", { class: "sep" }), h("span", {}, ed.personal ? T("yours", "你的") : T("built in", "內建")), h("span", { class: "sep" }), h("span", {}, T(`used by ${ed.runs?.length || 0} task${ed.runs?.length === 1 ? "" : "s"}`, `${ed.runs?.length || 0} 個任務用過`)))),
      h("div", { class: "wf-acts" }, h("button", { type: "button", class: "btn ghost icon", "data-rail-page-menu": "", "aria-label": T("More", "更多"), onclick: (e) => { e.stopPropagation(); pageMenu(e.currentTarget); } }, icon("more")),
        readOnly() ? null : editTog, X.startControl(ed, R)));
  };
  const tabs = () => h("div", { class: "wf-tabs" }, h("div", { class: "seg", role: "tablist", "aria-label": T("View", "檢視") },
    [["steps", T("Steps", "步驟"), ""], ["map", T("Map", "地圖"), "/map"], ["versions", T("Versions", "版本"), "/versions"]].map(([k, l, s]) => h("button", { type: "button", role: "tab", "aria-pressed": String(tab() === k), "aria-selected": String(tab() === k), "data-rail-tab": k, onclick: () => { location.hash = base() + s; } }, l))),
    tab() === "steps" ? h("span", { class: "wf-help wf-tip", tabindex: "0", "data-tip": T("Read top to bottom: each step hands its result to the next. Click a step to change it; + on the line adds one; drag a step to reorder. Changes apply only when you save.", "由上往下讀：每一步把結果交給下一步。點一步可修改；線上的 + 可加一步；拖曳可調順序。修改要儲存後才生效。") }, "?") : null,
    h("a", { class: "wf-advlink", href: `${base()}/advanced`, "data-rail-advanced": "" }, T("Graph editor", "流程圖編輯器")));
  const advancedBlock = () => { const items = [["workflow", T("Graph editor", "流程圖編輯器"), T("Every node, port and connection; drag, auto layout, show all connections, minimap, zoom.", "每個節點、連接埠與連線；拖曳、自動排版、全部連線、小地圖、縮放。")],
      ["lock", T("Raw connections and edge checks", "原始連線與連線檢查"), T("All edges with free-text outcomes, edge checks and join rules.", "所有連線的自由文字結果、連線檢查與匯合規則。")],
      ["eye", T("Show a task on the map", "在圖上顯示任務"), T("Overlay where a task is on the graph.", "疊上一個任務走到哪裡。")],
      ["refresh", T("Compare versions", "比較版本"), T("Semantic diff between versions; reuse as a template.", "版本之間的語意差異；存成模板。")],
      ["download", T("Export / transfer package", "匯出／傳輸套件"), T("JSON or a package for another Studio.", "JSON 或給另一個 Studio 的套件。")]];
    return h("details", { class: "wf-adv", "data-rail-adv": "", open: R.advOpen || null, ontoggle: (e) => { R.advOpen = e.target.open; } }, h("summary", {}, icon("chev", "ic chev"), T("Advanced", "進階"), h("small", {}, T("graph editor, raw connections, compare, export", "流程圖編輯器、原始連線、比較、匯出"))),
      h("div", { class: "wf-advbody" }, h("div", { class: "wf-advgrid" }, items.map(([ic, n, d]) => h("a", { class: "wf-advitem", href: `${base()}/advanced` }, h("b", {}, icon(ic), n), h("small", {}, d)))))); };
  const saveBar = () => { if (readOnly()) return null; const note = h("input", { class: "input", id: "note", "data-rail-note": "", value: R.note || "", oninput: (e) => { R.note = e.target.value; }, placeholder: T("What changed? (optional)", "改了什麼？（選填）"), "aria-label": T("Version note", "版本說明") });
    const errs = (ed.problems || []).filter((p) => p.level === "error");
    const saveBtn = h("button", { type: "button", class: "btn primary", "data-rail-save": "", "data-act": "save", onclick: (e) => save(note.value.trim(), e.currentTarget) }, T(`Save as v${(ed.versions.at(-1)?.version ?? ed.saved.version) + 1}`, `存成 v${(ed.versions.at(-1)?.version ?? ed.saved.version) + 1}`));
    return h("div", { class: "wf-save", "data-rail-savebar": "", hidden: R.changes ? null : true, role: "region", "aria-label": T("Unsaved changes", "未儲存的修改") }, h("span", { class: "dot" }),
      h("span", { class: "what", "data-rail-changes": String(R.changes) }, T(`${R.changes} unsaved change${R.changes > 1 ? "s" : ""} · not live until saved`, `${R.changes} 項未儲存的修改 · 儲存後才生效`)),
      errs.length ? h("span", { class: "wf-save-err", title: errs.map((p) => p.text).join("\n") }, icon("alert", "ic sm"), T(`${errs.length} to fix`, `${errs.length} 個待修`)) : null,
      h("button", { type: "button", class: "btn ghost icon", "data-act": "undo", "aria-label": T("Undo", "還原"), title: T("Undo (⌘Z)", "還原（⌘Z）"), disabled: R.hist.length ? null : true, onclick: undo }, icon("undo")),
      h("button", { type: "button", class: "btn ghost icon", "data-act": "redo", "aria-label": T("Redo", "重做"), title: T("Redo (⇧⌘Z)", "重做（⇧⌘Z）"), disabled: R.fut.length ? null : true, onclick: redo }, icon("redo")),
      note, h("button", { type: "button", class: "btn ghost", "data-act": "discard", onclick: discard }, T("Discard", "捨棄")), saveBtn); };
  const banner = () => { const errs = (ed.problems || []).filter((p) => p.level === "error" && !p.node);
    if (ed.trash?.deleted) return h("div", { class: "wf-banner", "data-workflow-in-trash": "" }, icon("alert"), T("This workflow is in Trash. Restore it before editing or starting a Task.", "此流程在垃圾桶中。請先復原，再編輯或開始任務。"));
    if (R.changes && errs.length) return h("div", { class: "wf-banner", "data-rail-errors": "" }, icon("alert"), h("span", {}, T("Fix before saving: ", "儲存前要修："), errs.map((p) => p.text).join(" · ")));
    return null; };
  const mapView = () => { const panel = X.buildRunGraph ? X.buildRunGraph({ def: ed.def, nodes: {}, walked: [] }, (ed.graphState ??= { collapsed: [] })) : h("div");
    panel.querySelectorAll?.('[data-current-graph-stage],.rt-rungraph-legend,[data-run-graph-action="current"]').forEach((e) => e.remove());
    return h("div", { class: "card wf-mapcard", "data-rail-map": "" }, h("div", { class: "wf-maphead" }, h("span", {}, T("Read-only map. To show a task on it or edit connections, use the graph editor.", "唯讀地圖。要疊上任務或改連線，請用流程圖編輯器。")),
      h("a", { class: "btn", href: `${base()}/advanced` }, icon("pencil"), T("Edit as a graph (Advanced)", "以流程圖編輯（進階）"))), panel); };
  const versionsView = () => h("div", { class: "card wf-vers", "data-rail-versions": "" }, ed.versions.slice().reverse().map((v) => h("div", { class: "wf-vrow", "data-rail-version-row": v.version },
    h("b", {}, `v${v.version}`), h("div", { style: "min-width:0" }, h("div", { class: "wf-ell" }, v.note ? (/^Saved from Firstmate draft /.test(v.note) ? T("Saved from a Firstmate draft", "由 Firstmate 草稿儲存") : v.note) : T("No note", "沒有說明")), h("div", { class: "wf-dim", style: "font-size:12px" }, [v.by, v.createdAt ? new Date(v.createdAt).toLocaleString() : null].filter(Boolean).join(" · "))),
    h("div", {}, v.version === ed.def.version ? h("span", { class: "badge run" }, T("shown", "顯示中")) : h("a", { class: "btn ghost", href: `#/workflows/${ed.id}/v${v.version}` }, T("Open", "開啟")), h("a", { class: "btn ghost", href: `#/workflows/${ed.id}/v${v.version}/advanced`, title: T("Compare versions and export live there", "比較版本與匯出在那裡") }, T("Open in graph editor", "在流程圖編輯器開啟"))))));

  const paint = (soft = false) => {
    if (disposed) return; if (!soft) closePop();
    const t = tab(), scroller = document.getElementById("main"), y = scroller?.scrollTop;
    root.classList.toggle("wf-ro", !!readOnly());
    root.replaceChildren(...[h("div", { class: "wf-crumb" }, h("a", { href: "#/workflows" }, T("Workflows", "流程")), " /"), header(), tabs(), banner(),
      ...(t === "steps" ? [strip(), rail(), advancedBlock()] : t === "map" ? [mapView()] : [versionsView()]), saveBar()].filter(Boolean));
    if (!drawer.isConnected) document.body.append(drawer);
    if (R.sel && (node(R.sel) || M.groups.has(R.sel)) && t === "steps") { if (!(soft && drawer.contains(document.activeElement))) drawDrawer(); drawer.classList.add("open"); document.body.classList.add("drawer-open"); }
    else { drawer.classList.remove("open"); document.body.classList.remove("drawer-open"); }
    if (scroller && y != null) scroller.scrollTop = y;
    requestAnimationFrame(drawConnectors);
  };
  const onKey = (e) => { if (!root.isConnected) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.target.closest?.("input,textarea,select,[contenteditable]")) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (e.key === "Escape") { if (pop.childElementCount) closePop(true); else if (R.sel) closeDrawer(); } };
  const onDocClick = (e) => { if (!e.target.closest?.(".wf-pop-host") && !e.target.closest?.('[data-rail-pop-open="true"]')) closePop(); };
  const onResize = () => requestAnimationFrame(drawConnectors);
  document.addEventListener("keydown", onKey); document.addEventListener("click", onDocClick); window.addEventListener("resize", onResize);
  window.pageDirty?.provide?.(`workflow-rail-${ed.id}`, () => root.isConnected && R.changes > 0);
  root.dispose = () => { disposed = true; clearTimeout(vtimer); closePop(); pop.remove(); drawer.remove(); document.body.classList.remove("drawer-open");
    document.removeEventListener("keydown", onKey); document.removeEventListener("click", onDocClick); window.removeEventListener("resize", onResize); };
  root.repaint = () => { M = model(ed.def); paint(); };
  paint(); if (R.changes) validate();
  return root;
}
window.crewRail = { build, model };
})();
