// Doors and gates: #/gates (changes with their door and gate results, projects
// and their sensitive lists, the org defaults, a path classifier), #/change/<id>
// (one change: why its door, every node's gates, each worker/reviewer round),
// and the workflow view for every workflow (#/workflow/<id>[/<change>]) with
// each node's gates and a selected change's results on the graph.
(() => {
const G = { ov: null, det: new Map(), flows: null };
const CST = { classifying: ["run", () => T("Classifying", "分類中")], "needs-door": ["human", () => T("Pick a door", "請選門")], running: ["run", () => T("Gates running", "閘門執行中")],
  fixing: ["run", () => T("Worker fixing", "worker 修正中")], reviewing: ["run", () => T("Reviewing", "審查中")], ready: ["human", () => T("Ready to merge", "可合併")],
  failed: ["bad", () => T("Failed", "失敗")], merged: ["ok", () => T("Merged", "已合併")], closed: ["", () => T("Closed", "已關閉")] };
const cBadge = (s) => { const [c, l] = CST[s] || CST.closed; return X.pill(c, l()); };
const TIER = { "one-way": () => T("one-way", "單向門"), "two-way": () => T("two-way", "雙向門"), trivial: () => T("two-way · trivial", "雙向門・小改動"), undecided: () => T("undecided", "未決定") };
const doorChip = (d) => d ? h("span", { class: `x-door ${d.tier}`, title: (d.reasons || []).map((r) => `${r.path}: ${r.why}${r.glob ? ` (${r.glob})` : ""}`).join("\n") }, icon("door", "ic sm"), (TIER[d.tier] || TIER.undecided)()) : null;
window.doorChip = doorChip;
const gk = (s) => h("span", { class: `x-gk ${s === "pass" ? "ok" : s === "fail" ? "bad" : "skip"}` }, s === "pass" ? "✓" : s === "fail" ? "✗" : "·");
const load = async () => { G.ov = await X.get("/api/changes"); X.count("navGates", G.ov.changes.filter((c) => c.status === "ready" || c.status === "needs-door").length); X.refresh(["gates", "workflow"]); };
const loadDet = async (id) => { G.det.set(id, await X.get(`/api/changes/${encodeURIComponent(id)}`)); X.refresh(["change", "workflow"]); };
const loadFlows = async () => { G.flows = await X.getList("/api/flows"); X.refresh(["workflow"]); };
window.onExt.push((t, d) => { if (t === "changes") { load(); if (G.det.has(d.id)) loadDet(d.id); } if (t === "agent" && d.ref && G.det.has(d.ref)) loadDet(d.ref); });

const gateSummary = (gates) => {
  const by = {}; for (const g of gates) (by[g.node] ||= []).push(g);
  return h("div", { class: "x-row wrap" }, Object.entries(by).map(([n, gs]) => h("span", { class: "x-metric", title: gs.map((g) => `${g.state}: ${g.label} — ${g.detail}`).join("\n") }, h("b", {}, n),
    h("span", { class: "x-gk ok" }, `✓${gs.filter((g) => g.state === "pass").length}`), gs.some((g) => g.state === "fail") ? h("span", { class: "x-gk bad" }, `✗${gs.filter((g) => g.state === "fail").length}`) : null)));
};
async function act(c, what, body) { const r = await X.post(`/api/changes/${c.id}/${what}`, body); if (r.error) return toast(r.error); G.det.set(c.id, r); load(); soft(); }
function mergeBtn(c) {
  if (c.status !== "ready") return null;
  return h("button", { class: "btn primary", onclick: () => {
    const one = c.door?.door === "one-way";
    const tick = h("input", { type: "checkbox", id: "oneWayOk" });
    modal(T("Merge this change?", "合併這個變更？"), h("div", { class: "form" },
      h("p", {}, T(`Fast-forwards ${c.base} in ${c.repo} to ${c.head?.slice(0, 8)} (branch ${c.branch}). Local only: nothing is pushed.`, `把 ${c.repo} 的 ${c.base} fast-forward 到 ${c.head?.slice(0, 8)}（branch ${c.branch}）。只在本地，不會 push。`)),
      one ? h("label", { class: "x-row", style: "align-items:flex-start" }, tick, h("span", {}, T("This is a one-way change: a revert will not undo it. I have read why (", "這是單向門變更：revert 無法還原。我讀過原因（"),
        (c.door.reasons || []).slice(0, 3).map((r) => `${r.path}: ${r.why}`).join("; "), ")")) : null),
      async (close) => { if (one && !tick.checked) return toast(T("Tick the one-way box first", "請先勾選單向門確認")); close(); act(c, "merge", one ? { confirm: "one-way" } : {}); });
    $(".modal .btn.primary").textContent = T("Merge", "合併"); } }, icon("check", "ic sm"), T("Merge", "合併"));
}
const doorPick = (c) => c.status === "needs-door" ? h("div", { class: "x-row wrap" }, h("span", { class: "faint" }, T("No list can classify this change. Pick its door:", "沒有清單能分類這個變更。請選門：")),
  h("button", { class: "btn", onclick: () => act(c, "door", { door: "two-way" }) }, T("Two-way (revertable)", "雙向門（可 revert）")), h("button", { class: "btn", onclick: () => act(c, "door", { door: "one-way" }) }, T("One-way", "單向門"))) : null;

function changeCard(c) {
  return h("div", { class: "card x-prop", "data-change": c.id },
    h("div", { class: "x-row wrap" }, cBadge(c.status), h("a", { href: `#/change/${c.id}`, style: "font-weight:600;color:inherit" }, c.title), doorChip(c.door), h("span", { class: "x-grow" }), h("span", { class: "faint" }, `${c.id} · ${ago(c.createdAt)}`)),
    h("div", { class: "run-s", style: "font-size:13px" }, c.project ? h("span", { class: "vbadge" }, c.project) : null, h("code", { class: "a3-path" }, `${c.source} → ${c.base}`), h("span", {}, T(`${c.paths.length} paths`, `${c.paths.length} 個路徑`)),
      c.rounds.filter((r) => r.n > 0).length ? h("span", {}, T(`${c.rounds.filter((r) => r.n > 0).length} fix rounds`, `${c.rounds.filter((r) => r.n > 0).length} 回合修正`)) : null),
    c.door?.reasons?.length && c.door.tier !== "trivial" ? h("ul", { class: "x-reasons" }, c.door.reasons.slice(0, 3).map((r) => h("li", {}, h("code", {}, r.path), " — ", r.why, r.glob ? h("span", { class: "faint" }, ` (${r.list}: ${r.glob})`) : null))) : null,
    c.gates.length ? gateSummary(c.gates) : null,
    c.error ? h("div", { class: "err" }, icon("alert", "ic sm"), c.error) : null,
    doorPick(c),
    h("div", { class: "actions" }, mergeBtn(c), h("a", { class: "btn ghost", href: `#/change/${c.id}` }, T("Details", "細節")), h("a", { class: "btn ghost", href: `#/workflow/${c.workflow}/${c.id}` }, icon("workflow", "ic sm"), T("On the graph", "在流程圖上")),
      ["ready", "failed", "needs-door"].includes(c.status) ? h("button", { class: "btn ghost", onclick: () => act(c, "close") }, T("Close", "關閉")) : null));
}
function newChange() {
  const ps = G.ov?.projects || [];
  if (!ps.some((p) => p.path)) return toast(T("Add a project with a repository path first", "請先新增有 repository 路徑的專案"));
  const proj = h("select", { "aria-label": T("Project", "專案") }, ps.filter((p) => p.path).map((p) => h("option", { value: p.id }, p.name)));
  const br = h("input", { placeholder: "feature/my-change", "aria-label": T("Branch", "Branch") }), ti = h("input", { "aria-label": T("Title", "標題") });
  modal(T("Check a branch", "檢查一個 branch"), h("div", { class: "form" }, h("p", { class: "faint" }, T("Studio copies the branch to crew/<id> in a worktree, sorts it by door, runs the gates, and fixes failures with a worker/reviewer cycle. Your branch is not touched.", "Studio 會把 branch 複製到 worktree 的 crew/<id>，依門分類、跑閘門，失敗時由 worker/reviewer 循環修正。不會動你的 branch。")),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Project", "專案")), proj), h("label", { class: "field" }, h("span", { class: "lbl" }, T("Branch", "Branch")), br), h("label", { class: "field" }, h("span", { class: "lbl" }, T("Title", "標題")), ti)),
    async (close, btn) => { btn.disabled = true; const r = await X.post("/api/changes", { project: proj.value, branch: br.value.trim(), title: ti.value.trim() || undefined }); btn.disabled = false; if (r.error) return toast(r.error); close(); load(); location.hash = `#/change/${r.id}`; });
  $(".modal .btn.primary").textContent = T("Start", "開始");
}
function classifyTool() {
  const ta = h("textarea", { rows: 5, placeholder: "src/app.ts\nmigrations/002.sql", "aria-label": T("Paths, one per line", "路徑，一行一個") });
  const proj = h("select", { "aria-label": T("Project", "專案") }, h("option", { value: "" }, T("org defaults only", "只用組織預設")), (G.ov?.projects || []).map((p) => h("option", { value: p.id }, p.name)));
  const out = h("div", {});
  modal(T("Classify paths", "分類路徑"), h("div", { class: "form" }, h("label", { class: "field" }, h("span", { class: "lbl" }, T("Project", "專案")), proj), h("label", { class: "field" }, h("span", { class: "lbl" }, T("Changed paths", "改動的路徑")), ta), out),
    async () => { const r = await X.post("/api/doors/classify", { project: proj.value || undefined, paths: ta.value }); if (r.error) return toast(r.error);
      out.replaceChildren(h("div", { class: "x-stack" }, doorChip(r), r.reasons.length ? h("ul", { class: "x-reasons" }, r.reasons.map((x) => h("li", {}, h("code", {}, x.path), " — ", x.why, x.glob ? h("span", { class: "faint" }, ` (${x.list}: ${x.glob})`) : null))) : h("span", { class: "faint" }, T("No listed path: two-way.", "沒有列管的路徑：雙向門。")))); });
  $(".modal .btn.primary").textContent = T("Classify", "分類");
}
function addProject() {
  const name = h("input", { "aria-label": T("Name", "名稱") }), path = h("input", { placeholder: "/Users/you/code/project", "aria-label": T("Path", "路徑") }), base = h("input", { value: "main", "aria-label": "Base" });
  const rules = h("textarea", { rows: 3, placeholder: "src/billing/** | money moves", "aria-label": T("Sensitive paths", "敏感路徑") });
  modal(T("Add a project", "新增專案"), h("div", { class: "form" }, h("label", { class: "field" }, h("span", { class: "lbl" }, T("Name", "名稱")), name), h("label", { class: "field" }, h("span", { class: "lbl" }, T("Local repository (absolute path)", "本地 repository（絕對路徑）")), path),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Base branch", "主 branch")), base),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Its own one-way paths (glob | why, one per line). Proposed only: they count after you approve.", "專案自己的單向門路徑（glob | 原因，一行一個）。只是提議：你核准後才生效。")), rules)),
    async (close, btn) => { btn.disabled = true; const propose = rules.value.split("\n").map((l) => l.split("|")).filter((x) => x[0].trim()).map(([g, w]) => ({ glob: g.trim(), why: (w || "").trim() }));
      const r = await X.post("/api/projects", { name: name.value.trim(), path: path.value.trim() || null, base: base.value.trim(), propose }); btn.disabled = false; if (r.error) return toast(r.error); close(); load(); });
  $(".modal .btn.primary").textContent = T("Add", "新增");
}
function viewGates() {
  if (!G.ov) { load(); return X.loading(); }
  const o = G.ov;
  const open = o.changes.filter((c) => !["merged", "closed"].includes(c.status)), done = o.changes.filter((c) => ["merged", "closed"].includes(c.status));
  const projAct = async (p, what) => { const r = await X.post(`/api/projects/${p.id}/${what}`); if (r.error) return toast(r.error); load(); };
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Gates", "閘門")),
      h("p", {}, T("Every change gets a door from its paths: one-way (a revert will not undo it), two-way, or trivial. Script gates run per workflow node; a failure goes to a worker/reviewer cycle. You merge.",
        "每個變更依路徑分到一扇門：單向門（revert 無法還原）、雙向門、或小改動。每個流程節點跑腳本閘門；失敗就交給 worker/reviewer 循環。由你合併。"))),
      h("div", { class: "actions x-wrap" }, h("button", { class: "btn primary", onclick: newChange }, icon("plus", "ic sm"), T("Check a branch", "檢查 branch")), h("button", { class: "btn", onclick: classifyTool }, icon("door", "ic sm"), T("Classify paths", "分類路徑")))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Changes", "變更")), X.pill("human", String(open.length))),
      open.length ? h("div", { class: "x-grid" }, open.map(changeCard)) : h("div", { class: "card" }, h("div", { class: "empty" }, icon("gate"), h("b", {}, T("No change in flight", "沒有進行中的變更")), T("Check a branch of a project's repository.", "檢查某個專案 repository 的 branch。")))),
    h("section", { "data-onboarding-projects": "1" }, h("div", { class: "sec-head" }, h("h2", {}, T("Projects", "專案")), h("span", { class: "x-grow" }), h("button", { class: "btn ghost", onclick: addProject }, icon("plus", "ic sm"), T("Add project", "新增專案"))),
      o.projects.length ? h("div", { class: "x-stack" }, o.projects.map((p) => h("div", { class: "card x-pad x-stack", "data-project": p.id },
        h("div", { class: "x-row wrap" }, h("b", {}, p.name), p.path ? h("code", { class: "a3-path" }, p.path) : h("span", { class: "faint" }, T("no repository", "沒有 repository")), h("span", { class: "vbadge" }, p.base),
          p.approvedAt ? X.pill("ok", T(`list approved ${ago(p.approvedAt)}`, `清單已核准（${ago(p.approvedAt)}）`)) : X.pill("", T("org defaults only", "只用組織預設"))),
        p.sensitive.length ? h("ul", { class: "x-reasons" }, p.sensitive.map((r) => h("li", {}, h("code", {}, r.glob), " — ", r.why))) : null,
        p.proposed ? h("div", { class: "card x-pad x-stack", style: "background:var(--human-soft)" }, h("b", {}, T("Proposed one-way paths (not in force until you approve)", "提議的單向門路徑（核准前不生效）")),
          h("ul", { class: "x-reasons" }, p.proposed.map((r) => h("li", {}, h("code", {}, r.glob), " — ", r.why))),
          h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => projAct(p, "approve") }, T("Approve list", "核准清單")), h("button", { class: "btn ghost", onclick: () => projAct(p, "decline") }, T("Decline", "拒絕")))) : null)))
        : h("div", { class: "card faint", style: "padding:14px 16px" }, T("No project yet.", "還沒有專案。"))),
    h("details", { class: "card x-pad" }, h("summary", {}, T(`Org defaults: ${o.defaults.base.length} one-way paths every project keeps, ${o.defaults.trivial.length} trivial ones`, `組織預設：每個專案都保留的 ${o.defaults.base.length} 條單向門路徑、${o.defaults.trivial.length} 條小改動路徑`)),
      h("ul", { class: "x-reasons", style: "margin-top:8px" }, o.defaults.base.map((r) => h("li", {}, h("code", {}, r.glob), " — ", r.why))),
      h("p", { class: "faint", style: "font-size:12.5px" }, T(`Trivial (two-way, at most ${o.defaults.trivial_max_lines} lines): ${o.defaults.trivial.map((r) => r.glob).join(", ")}`, `小改動（雙向門，最多 ${o.defaults.trivial_max_lines} 行）：${o.defaults.trivial.map((r) => r.glob).join("、")}`))),
    done.length ? h("details", { class: "card", style: "padding:10px 16px" }, h("summary", {}, T(`${done.length} merged or closed`, `${done.length} 個已合併或關閉`)), h("div", { class: "x-grid", style: "margin-top:10px" }, done.map(changeCard))) : null);
}

function viewChange(id) {
  const c = G.det.get(id);
  if (!c) { loadDet(id); return X.loading(); }
  if (c.error && !c.id) return X.notFound("No such change", "沒有這個變更");
  const flow = (G.flows || []).find((f) => f.id === c.workflow); if (!G.flows) loadFlows();
  const byNode = {}; for (const g of c.gates) (byNode[g.node] ||= []).push(g);
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/gates", class: "a3-back" }, T("Gates", "閘門")), " · ", c.title),
      h("p", { class: "run-s", style: "font-size:13px" }, cBadge(c.status), doorChip(c.door), c.project ? h("span", { class: "vbadge" }, c.project) : null, h("code", { class: "a3-path" }, `${c.source} → ${c.branch} → ${c.base}`), h("span", { class: "faint" }, ago(c.createdAt)))),
      h("div", { class: "actions" }, mergeBtn(c), h("a", { class: "btn", href: `#/workflow/${c.workflow}/${c.id}` }, icon("workflow", "ic sm"), T("On the graph", "在流程圖上")),
        ["failed", "ready"].includes(c.status) ? h("button", { class: "btn ghost", onclick: () => act(c, "rerun") }, icon("refresh", "ic sm"), T("Re-run", "重跑")) : null)),
    c.error ? h("div", { class: "err" }, icon("alert", "ic sm"), c.error) : null,
    doorPick(c),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Door", "門")), doorChip(c.door), c.door?.decidedBy === "captain" ? h("span", { class: "faint" }, T("picked by the captain", "船長選的")) : null),
      h("div", { class: "card x-pad x-stack" }, h("p", { class: "x-explain" }, c.door?.tier === "one-way" ? T("A revert will not undo this change: it takes the one-way path (plan check, every gate, a confirm at merge).", "revert 無法還原這個變更：走單向門路徑（計畫檢查、所有閘門、合併時要確認）。")
        : c.door?.tier === "trivial" ? T("Docs and assets only, small: two-way with light gates.", "只有文件和素材、改動小：雙向門、輕量閘門。") : c.door?.tier === "undecided" ? T("No list can classify it: you pick.", "沒有清單能分類：由你決定。") : T("Revertable: the two-way path.", "可以 revert：走雙向門路徑。")),
        c.door?.reasons?.length ? h("ul", { class: "x-reasons" }, c.door.reasons.map((r) => h("li", {}, h("code", {}, r.path), " — ", r.why, r.glob ? h("span", { class: "faint" }, ` (${r.list}: ${r.glob})`) : null))) : null,
        h("div", { class: "faint", style: "font-size:12.5px" }, T(`${c.paths.length} paths, ${c.door?.lines ?? 0} lines; lists: ${c.door?.lists?.org ?? 0} org + ${c.door?.lists?.project ?? 0} project`, `${c.paths.length} 個路徑、${c.door?.lines ?? 0} 行；清單：組織 ${c.door?.lists?.org ?? 0} 條 + 專案 ${c.door?.lists?.project ?? 0} 條`)))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Gates by node", "各節點的閘門"))),
      h("div", { class: "x-stack" }, (flow?.nodes || []).filter((n) => n.gates?.length).map((n) => h("div", { class: "x-node" }, h("h3", {}, n.label, n.lane ? h("span", { class: "vbadge" }, n.lane) : null, n.cycle ? h("span", { class: "faint", style: "font-weight:400;font-size:12px" }, T(`cycle: ${n.cycle.worker} ⇄ ${n.cycle.reviewer}, up to ${n.cycle.max_rounds} rounds`, `循環：${n.cycle.worker} ⇄ ${n.cycle.reviewer}，最多 ${n.cycle.max_rounds} 回合`)) : null),
        h("ul", { class: "x-gates" }, n.gates.map((g) => { const r = (byNode[n.id] || []).find((x) => x.id === g.id); return h("li", { "data-gate": g.id }, gk(r?.state || "skip"), h("span", {}, g.label || g.id), h("span", { class: "faint" }, r ? r.detail.split("\n")[0] : n.lane && n.lane !== c.door?.door ? T("not on this path", "不在這條路徑上") : T("not run", "未執行"))); })))))),
    c.rounds.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Worker ⇄ reviewer", "worker ⇄ reviewer"))), h("div", { class: "x-stack" }, c.rounds.map((r) => h("div", { class: "card x-pad x-stack" },
      h("div", { class: "x-row wrap" }, h("b", {}, r.n ? T(`Round ${r.n}`, `第 ${r.n} 回合`) : T("First review", "首次審查")), r.gates ? h("span", { class: "x-num" }, `✓${r.gates.pass} ✗${r.gates.fail}`) : null,
        r.review?.verdict ? X.pill(r.review.verdict === "APPROVE" ? "ok" : "bad", r.review.verdict) : null, r.worker?.commit ? h("code", {}, r.worker.commit.slice(0, 8)) : null),
      r.why.length ? h("ul", { class: "x-reasons" }, r.why.map((w) => h("li", {}, w))) : null,
      r.worker?.said ? h("div", { class: "x-cycle" }, h("b", {}, T("Worker", "Worker")), r.worker.said) : null,
      r.review?.findings?.length ? h("div", { class: "x-cycle" }, h("b", {}, T("Reviewer findings", "Reviewer 的發現")), h("ol", { style: "margin:0;padding-left:18px" }, r.review.findings.map((f) => h("li", {}, f)))) : null)))) : null,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Changed paths", "改動的路徑")), h("span", { class: "faint" }, String(c.paths.length))),
      h("div", { class: "card", style: "display:grid" }, c.paths.map((p) => h("div", { class: "lib-row" }, h("div", { class: "run-s" }, h("code", { class: "a3-path" }, p.path), h("span", { class: "vbadge" }, p.status || "M"), h("span", { class: "x-num" }, `+${p.added ?? 0} −${p.removed ?? 0}`)))))),
    c.jobs?.length ? h("details", { class: "card x-pad" }, h("summary", {}, T(`${c.jobs.length} agent runs`, `${c.jobs.length} 次 agent 執行`)), h("ul", { class: "x-log" }, c.jobs.map((j) => h("li", {}, `${j.kind} · ${j.provider} · ${j.status} · ${j.tools} tools — ${j.said}`)))) : null);
}

// ---------- the workflow view, for every workflow ----------
function flowTabs(cur) {
  if (!G.flows) { loadFlows(); return null; }
  return h("div", { class: "x-tabs", role: "group", "aria-label": T("Workflows", "流程") }, G.flows.map((f) => h("a", { class: "chip", href: f.id === "code" ? "#/workflow" : `#/workflow/${f.id}`, "aria-pressed": String(f.id === cur), style: "text-decoration:none" }, f.name)));
}
function graph(f, sel) {
  const W = 172, Hh = 70, PAD = 30;
  const maxX = Math.max(...f.nodes.map((n) => n.x)) + W + PAD * 2, maxY = Math.max(...f.nodes.map((n) => n.y)) + Hh + PAD * 2;
  const by = Object.fromEntries(f.nodes.map((n) => [n.id, n]));
  const res = {}; if (sel) for (const g of sel.gates) (res[g.node] ||= []).push(g);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graph"); svg.setAttribute("width", maxX); svg.setAttribute("height", maxY); svg.setAttribute("viewBox", `0 0 ${maxX} ${maxY}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", f.name);
  let out = `<defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--border-strong)"/></marker></defs>`;
  for (const [a, b, label] of f.edges) { const A = by[a], B = by[b]; if (!A || !B) continue; const back = B.x < A.x;
    const x1 = A.x + PAD + (back ? W / 2 : W), y1 = A.y + PAD + (back ? 0 : Hh / 2), x2 = B.x + PAD + (back ? W / 2 : 0), y2 = B.y + PAD + (back ? 0 : Hh / 2);
    const hot = sel && sel.door && ((label === "one-way" && sel.door.door === "one-way") || (label === "two-way" && sel.door.door === "two-way"));
    out += `<path class="ge${hot ? " hot" : ""}" d="${back ? `M${x1} ${y1} C ${x1} ${y1 - 90}, ${x2} ${y2 - 90}, ${x2} ${y2}` : `M${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`}" marker-end="url(#ah2)"/>`;
    if (label) out += `<text class="gel" x="${(x1 + x2) / 2}" y="${back ? Math.min(y1, y2) - 70 : (y1 + y2) / 2 - 8}" text-anchor="middle">${esc(label)}</text>`; }
  for (const n of f.nodes) { const x = n.x + PAD, y = n.y + PAD, rs = res[n.id] || [];
    const st = rs.some((g) => g.state === "fail") ? "bad" : rs.some((g) => g.state === "pass") ? "ok" : "";
    const dim = sel && n.lane && sel.door && n.lane !== sel.door.door;
    const gates = n.gates?.length || 0;
    out += `<g class="gn${st ? ` g-${st}` : ""}${dim ? " dim" : ""}" data-node="${n.id}"><rect x="${x}" y="${y}" width="${W}" height="${Hh}" rx="10"/>`
      + `<text class="kind" x="${x + 12}" y="${y + 18}">${esc(n.kind)}${gates ? ` · ${gates} gate${gates > 1 ? "s" : ""}` : ""}</text><text class="lbl" x="${x + 12}" y="${y + 38}">${esc(n.label)}</text>`
      + `<text class="det" x="${x + 12}" y="${y + 56}">${esc(rs.length ? `✓${rs.filter((g) => g.state === "pass").length} ✗${rs.filter((g) => g.state === "fail").length} ·${rs.filter((g) => g.state === "skip").length}` : n.detail || "")}</text></g>`; }
  svg.innerHTML = out;
  return h("div", { class: "graphwrap" }, svg);
}
function viewFlow(id, changeId) {
  if (!G.flows) { loadFlows(); return X.loading(); }
  const f = G.flows.find((x) => x.id === id); if (!f) return X.notFound("No such workflow", "沒有這個流程");
  if (!G.ov) load();
  const cs = (G.ov?.changes || []).filter((c) => c.workflow === id);
  const sel = changeId ? (G.det.get(changeId) || cs.find((c) => c.id === changeId)) : null;
  if (changeId && !G.det.has(changeId)) loadDet(changeId);
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, f.name, " ", h("span", { class: "vbadge" }, `v${f.version}`)), h("p", {}, f.description || T("A workflow with its gates per node.", "一個流程和各節點的閘門。")))),
    flowTabs(id), graph(f, sel),
    sel ? h("div", { class: "card x-pad x-row wrap" }, h("b", {}, sel.title), cBadge(sel.status), doorChip(sel.door), h("a", { href: `#/change/${sel.id}` }, T("Details", "細節"))) : null,
    cs.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Changes on this workflow", "這個流程上的變更"))), h("div", { class: "x-row wrap" }, cs.map((c) => h("a", { class: "tchip", href: `#/workflow/${id}/${c.id}`, "aria-pressed": String(sel?.id === c.id), style: "text-decoration:none" }, h("span", { class: "tid" }, c.id), doorChip(c.door), cBadge(c.status))))) : null,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Gates on each node", "各節點的閘門"))),
      h("div", { class: "x-stack" }, f.nodes.filter((n) => n.gates?.length).map((n) => h("div", { class: "x-node" }, h("h3", {}, n.label, n.lane ? h("span", { class: "vbadge" }, n.lane) : null),
        h("ul", { class: "x-gates" }, n.gates.map((g) => { const r = sel?.gates?.find((x) => x.node === n.id && x.id === g.id); return h("li", {}, gk(r?.state || "skip"), h("span", {}, g.label || g.id),
          h("span", { class: "faint" }, r ? r.detail.split("\n")[0] : `${g.builtin ? `builtin ${g.builtin}` : `run ${(g.run || []).join(" ")}`}${g.when?.door ? ` · ${g.when.door.join("/")}` : ""}`)); })))))),
    f.roles?.length ? h("p", { class: "faint", style: "font-size:13px" }, T("Roles: ", "角色："), f.roles.map((r) => h("a", { href: `#/skill/${f.id}/${r.id}`, style: "margin-right:10px" }, r.label))) : null);
}
const origWorkflow = routes.workflow;
routes.workflow = (arg) => {
  const [a, b] = (arg || "").split("/");
  if (a && G.flows?.some((f) => f.id === a && f.id !== "code")) return viewFlow(a, b);
  if (a && !G.flows) { loadFlows(); return X.loading(); }
  const page = origWorkflow(a && /^T-/.test(a) ? a : null);
  const tabs = flowTabs("code"); if (tabs && page?.children?.length > 1) page.insertBefore(tabs, page.children[1]);
  return page;
};
Object.assign(routes, { gates: viewGates, change: viewChange });
X.nav("gates", "gate", "Gates", "閘門", "changes", "navGates");
X.own("gates", "change");
X.reroute(/^#\/(gates|change|workflow\/)/);
load(); loadFlows();
})();
