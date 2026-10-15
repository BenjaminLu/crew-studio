// M7 domain packs: #/packs (installed and built-in packs, workflow genesis:
// describe a way of working, get a drafted pack), #/pack/<id>, #/pack-draft/<id>
// (files, validation, evals, install), and the file-organization pack's pages:
// #/fileorg (pick a folder, dry run) and #/fileorg/<plan> (review, apply, undo).
(() => {
const K = { ov: null, drafts: new Map(), packs: new Map(), fo: null, plans: new Map() };
const DST = { drafting: ["run", () => T("Drafting", "撰寫中")], drafted: ["human", () => T("Ready to install", "可安裝")], invalid: ["bad", () => T("Invalid", "不合格")], failed: ["bad", () => T("Failed", "失敗")],
  installed: ["ok", () => T("Installed", "已安裝")], discarded: ["", () => T("Discarded", "已捨棄")] };
const dBadge = (s) => { const [c, l] = DST[s] || DST.failed; return X.pill(c, l()); };
const PST = { planned: ["human", () => T("Planned (dry run)", "已規劃（試跑）")], applied: ["ok", () => T("Applied", "已套用")], undone: ["", () => T("Undone", "已還原")], discarded: ["", () => T("Discarded", "已捨棄")] };
const pBadge = (s) => { const [c, l] = PST[s] || PST.discarded; return X.pill(c, l()); };
const ENGINE_PAGE = { "file-organization": "#/fileorg", documents: "#/docs" };
const load = async () => { K.ov = await X.get("/api/packs"); X.count("navPacks", K.ov.drafts.filter((d) => d.status === "drafted").length); X.refresh(["packs"]); };
const loadDraft = async (id) => { K.drafts.set(id, await X.get(`/api/packs/drafts/${encodeURIComponent(id)}`)); X.refresh(["pack-draft"]); };
const loadPack = async (id) => { K.packs.set(id, await X.get(`/api/packs/${encodeURIComponent(id)}`)); X.refresh(["pack"]); };
const loadFo = async () => { K.fo = await X.get("/api/fileorg"); X.refresh(["fileorg"]); };
const loadPlan = async (id) => { K.plans.set(id, await X.get(`/api/fileorg/${encodeURIComponent(id)}`)); X.refresh(["fileorg"]); };
window.onExt.push((t, d) => { if (t === "packs") { load(); for (const id of K.drafts.keys()) loadDraft(id); } if (t === "agent" && d.ref?.startsWith("pack:")) { const id = d.ref.slice(5); if (["completed", "done", "failed"].includes(d.status) || K.drafts.has(id)) { loadDraft(id); load(); } }
  if (t === "fileorg") { loadFo(); if (K.plans.has(d.id)) loadPlan(d.id); } });

const evalLine = (ev) => ev ? h("span", { class: "x-evs" }, h("span", { class: "faint" }, T("evals", "評測")), h("span", { class: `x-ev ${ev.passed === ev.total ? "up" : "down"}` }, `${ev.passed}/${ev.total}`), h("span", { class: "faint" }, T("static replay", "靜態重放"))) : null;
function packCard(p) {
  const m = p.manifest || {};
  return h("div", { class: "card x-prop", "data-pack": p.id },
    h("div", { class: "x-row wrap" }, p.ok ? X.pill("ok", p.kind === "builtin" ? T("Built in", "內建") : p.kind === "published" ? T("Published", "已發布") : T("Installed", "已安裝")) : X.pill("bad", p.tampered.length ? T("Refused: files changed", "拒用：檔案被改過") : T("Invalid", "不合格")),
      h("a", { href: `#/pack/${p.id}`, style: "font-weight:600;color:inherit" }, m.name || p.id), h("span", { class: "vbadge" }, m.version || "?"), h("span", { class: "x-grow" }), p.lock ? h("code", { class: "faint", title: T("sha256 of the pinned file list", "鎖定檔案清單的 sha256") }, `sha ${p.lock.sha256.slice(0, 10)}`) : null),
    h("div", { class: "x-req" }, m.description || ""),
    h("div", { class: "run-s", style: "font-size:12.5px" }, h("span", {}, T(`${p.flows.length} workflow${p.flows.length === 1 ? "" : "s"}`, `${p.flows.length} 個流程`)), h("span", {}, T(`${(m.skills || []).length} roles`, `${(m.skills || []).length} 個角色`)),
      h("span", {}, m.engine==='native-v2'?T(`${(m.checks||[]).length} checks`,`${(m.checks||[]).length} 個檢查`):T(`${(m.gates || []).length} gates`, `${(m.gates || []).length} 個閘門`)), h("span", {}, T(`${(m.artifactTypes || []).length} artifact types`, `${(m.artifactTypes || []).length} 種成品`)), h("span", {}, p.measurement?T(`${p.cases} measured samples`,`${p.cases} 個實測樣本`):T(`${p.cases} evals`, `${p.cases} 個評測`)),
      (m.permissions || []).length ? h("span", {}, icon("lock", "ic sm"), m.permissions.join(", ")) : null),
    p.tampered.length ? h("div", { class: "err" }, icon("alert", "ic sm"), T(`Not loaded: ${p.tampered.join(", ")} no longer match the install.`, `未載入：${p.tampered.join("、")} 與安裝時不同。`)) : null,
    h("div", { class: "actions" }, m.engine && ENGINE_PAGE[m.engine] && p.ok ? h("a", { class: "btn primary", href: ENGINE_PAGE[m.engine] }, T("Open", "打開")) : null,
      p.flows[0] && p.ok ? h("a", { class: "btn ghost", href: `${p.kind==='published'?'#/workflows/':'#/workflow/'}${p.flows[0].id}` }, icon("workflow", "ic sm"), T("Workflow", "流程")) : null, h("a", { class: "btn ghost", href: `#/pack/${p.id}` }, T("Files", "檔案"))));
}
function viewPacks() {
  if (!K.ov) { load(); return X.loading(); }
  const box = h("textarea", { rows: 3, id: "genesisAsk", "aria-label": T("Describe a new way of working", "描述新的工作方式"), placeholder: T("e.g. Every Friday, sort the open support mail, answer the easy ones, and escalate the rest to a person", "例如：每週五整理未處理的客服信，簡單的直接回，其他轉給人處理") });
  const send = h("button", { class: "btn primary", type: "submit" }, icon("wand", "ic sm"), T("Draft a pack", "起草套件"));
  const form = h("form", { class: "x-ask", onsubmit: async (e) => { e.preventDefault(); const t = box.value.trim(); if (!t) return; send.disabled = true; const r = await X.post("/api/packs/genesis", { description: t }); send.disabled = false;
    if (r.error) return toast(r.error); box.value = ""; load(); location.hash = r.native ? `#/tasks/${r.id}` : `#/pack-draft/${r.id}`; } }, box, send);
  const drafts = K.ov.drafts.filter((d) => d.status !== "discarded" && d.status !== "installed");
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Packs", "套件")),
      h("p", {}, T("A domain pack is a way of working as data: a manifest, skills per role, gates, artifact types, workflow templates and evals. Installs are pinned by sha256.", "領域套件是把一種工作方式寫成資料：manifest、各角色的技能、閘門、成品類型、流程範本與評測。安裝時以 sha256 鎖定。")))),
    h("section", { class: "card x-pad x-chat" }, h("div", { class: "sec-head" }, h("h2", {}, T("Workflow genesis", "流程生成")), h("span", { class: "faint" }, T("Describe it; answer the interview, label samples, measure checks, run shadow Tasks, then promote and publish.", "描述它；回答訪談、標記樣本、實測檢查、執行影子任務，再升級與發布。"))),
      drafts.length ? h("div", { class: "x-bubbles" }, drafts.slice(0, 6).reverse().map((d) => h("div", { class: "x-bub" }, h("div", { class: "x-me" }, d.description),
        h("a", { class: "x-them", href: `#/pack-draft/${d.id}` }, dBadge(d.status), h("b", {}, d.id), d.summary ? h("span", {}, d.summary) : null, evalLine(d.evals), d.validation && !d.validation.ok ? h("span", { class: "faint" }, d.validation.errors[0]) : null)))) : null, form),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Packs", "套件")), h("span", { class: "faint" }, String(K.ov.packs.length))), h("div", { class: "x-grid" }, K.ov.packs.map(packCard))));
}
const fileList = (files, open) => h("div", { class: "x-stack" }, files.map((f) => h("details", { class: "card x-pad", open: open === f.path }, h("summary", {}, h("code", {}, f.path)), h("pre", { class: "x-skilltext", style: "padding:10px 0 0;max-height:360px" }, f.text ?? ""))));
function viewDraft(id) {
  const d = K.drafts.get(id);
  if (!d) { loadDraft(id); return X.loading(); }
  if (d.error && !d.id) return X.notFound("No such draft", "沒有這個草稿");
  const act = async (what) => { const r = await X.post(`/api/packs/drafts/${d.id}/${what}`); if (r.error) return toast(r.error); loadDraft(d.id); load(); if (what === "install") toast(T("Installed and pinned", "已安裝並鎖定")); };
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/packs", class: "a3-back" }, T("Packs", "套件")), " · ", T(`Draft ${d.id}`, `草稿 ${d.id}`)),
      h("p", { class: "run-s", style: "font-size:13px" }, dBadge(d.status), h("span", {}, d.by), h("span", { class: "faint" }, ago(d.createdAt)), evalLine(d.evals))),
      h("div", { class: "actions" }, d.status === "drafted" ? h("button", { class: "btn primary", onclick: () => modal(T("Install this pack?", "安裝這個套件？"), h("p", {}, T("Its files are copied and pinned by sha256; if one changes later, Studio refuses the pack.", "檔案會被複製並以 sha256 鎖定；之後若有檔案被改，Studio 會拒用這個套件。")), (c) => { c(); act("install"); }) }, icon("check", "ic sm"), T("Install", "安裝")) : null,
        ["drafted", "invalid"].includes(d.status) ? h("button", { class: "btn", onclick: () => act("recheck") }, icon("refresh", "ic sm"), T("Check again", "重新檢查")) : null,
        ["drafted", "invalid", "failed"].includes(d.status) ? h("button", { class: "btn ghost", onclick: () => act("discard") }, T("Discard", "捨棄")) : null)),
    h("div", { class: "card x-pad x-stack" }, h("div", { class: "x-req" }, `“${d.description}”`), d.summary ? h("p", { class: "faint", style: "font-size:13px;margin:0" }, d.summary) : null, d.error ? h("div", { class: "err" }, icon("alert", "ic sm"), d.error) : null),
    d.validation ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Gates", "閘門"))), h("ul", { class: "card x-pad x-gates" },
      h("li", {}, h("span", { class: `x-gk ${d.validation.ok ? "ok" : "bad"}` }, d.validation.ok ? "✓" : "✗"), h("span", {}, T("The pack follows the format", "套件符合格式")), h("span", { class: "faint" }, d.validation.ok ? T("every reference resolves", "所有引用都找得到") : d.validation.errors.join("; "))),
      h("li", {}, h("span", { class: `x-gk ${d.evals && d.evals.passed === d.evals.total ? "ok" : d.evals ? "bad" : "skip"}` }, d.evals ? (d.evals.passed === d.evals.total ? "✓" : "✗") : "·"), h("span", {}, T("Its evals exist and run", "評測存在且能執行")), h("span", { class: "faint" }, d.evals ? `${d.evals.passed}/${d.evals.total}` : T("not run", "未執行"))),
      ...(d.validation.warnings || []).map((w) => h("li", {}, h("span", { class: "x-gk skip" }, "!"), h("span", {}, T("Warning", "提醒")), h("span", { class: "faint" }, w))))) : null,
    d.evals?.results?.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Eval cases", "評測案例"))), h("div", { class: "card", style: "display:grid" }, d.evals.results.map((r) => h("div", { class: "lib-row" }, h("div", { class: "run-s" }, h("span", { class: `x-ck ${r.pass ? "ok" : "bad"}` }, r.pass ? "✓" : "✗"), h("b", {}, r.title), h("span", { class: "faint" }, r.checks.map((c) => c.why).join(", "))))))) : null,
    d.files?.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Files", "檔案")), h("span", { class: "faint" }, String(d.files.length))), fileList(d.files, "manifest.yaml")) : null,
    d.job ? h("details", { class: "card x-pad" }, h("summary", {}, T(`Author round: ${d.job.provider} · ${d.job.model} · ${d.job.tools} tool calls`, `作者回合：${d.job.provider} · ${d.job.model} · ${d.job.tools} 次工具呼叫`)), h("ul", { class: "x-log" }, d.job.log.map((l) => h("li", { class: l.kind }, h("span", { class: "faint" }, clock(l.ts)), " ", l.text)))) : null);
}
function viewPack(id) {
  const p = K.packs.get(id);
  if (!p) { loadPack(id); return X.loading(); }
  if (p.error && !p.id) return X.notFound("No such pack", "沒有這個套件");
  const files = h("div", { class: "x-stack" }, p.files.map((f) => { const det = h("details", { class: "card x-pad" }, h("summary", {}, h("code", {}, f)));
    det.addEventListener("toggle", async () => { if (!det.open || det.dataset.loaded) return; det.dataset.loaded = "1"; const r = await X.get(`/api/packs/${p.id}/file?path=${encodeURIComponent(f)}`); det.append(h("pre", { class: "x-skilltext", style: "padding:10px 0 0;max-height:360px" }, r.text ?? r.error)); }); return det; }));
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/packs", class: "a3-back" }, T("Packs", "套件")), " · ", p.manifest?.name || p.id), h("p", {}, p.manifest?.description || "")),
      h("div", { class: "actions" }, p.manifest?.engine && ENGINE_PAGE[p.manifest.engine] && p.ok ? h("a", { class: "btn primary", href: ENGINE_PAGE[p.manifest.engine] }, T("Open", "打開")) : null,
        p.kind === "installed" ? h("button", { class: "btn ghost", onclick: async () => { const r = await X.post(`/api/packs/${p.id}/uninstall`); if (r.error) return toast(r.error); load(); location.hash = "#/packs"; } }, T("Uninstall", "解除安裝")) : null)),
    h("div", { class: "card x-pad" }, X.kv([[T("Version", "版本"), p.manifest?.version], [T("Kind", "類型"), p.kind], [T("Engine", "引擎"), p.manifest?.engine || "—"], [T("Roles", "角色"), (p.manifest?.skills || []).map((s) => s.role).join(", ")],
      [T("Gates", "閘門"), (p.manifest?.gates || []).map((g) => g.label || g.id).join("; ")], [T("Artifact types", "成品類型"), (p.manifest?.artifactTypes || []).map((t) => t.label).join(", ")],
      [T("Permissions", "權限"), (p.manifest?.permissions || []).join(", ") || "—"], p.lock ? [T("Pinned", "鎖定"), `sha256 ${p.lock.sha256}`] : null])),
    p.measurement?h('section',{class:'card x-pad'},h('h2',{},T('Frozen measured evidence','鎖定實測證據')),h('p',{},T(`${p.measurement.samples} actual labelled samples`,`${p.measurement.samples} 個實際標記樣本`)),p.measurement.metrics.map(m=>h('p',{},`${m.check}: `,T('precision','精確率'),` ${m.precision==null?'—':Math.round(m.precision*100)+'%'} · `,T('recall','召回率'),` ${m.recall==null?'—':Math.round(m.recall*100)+'%'} · `,T(`${m.errors} errors`,`${m.errors} 個錯誤`)))):null,
    p.errors?.length ? h("div", { class: "err" }, icon("alert", "ic sm"), p.errors.join("; ")) : null,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Files", "檔案")), h("span", { class: "faint" }, String(p.files.length))), files));
}

// ---------- file organization ----------
function viewFileorg(planId) {
  if (planId) return viewPlan(planId);
  if (!K.fo) { loadFo(); return X.loading(); }
  const inp = h("input", { id: "foRoot", placeholder: "/Users/you/Downloads", "aria-label": T("Folder", "資料夾"), style: "min-width:0" });
  const go = h("button", { class: "btn primary", type: "submit" }, icon("eye", "ic sm"), T("Dry run", "試跑"));
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/packs", class: "a3-back" }, T("Packs", "套件")), " · ", T("File organization", "檔案整理")),
      h("p", {}, T("Sort a folder's loose files into folders by kind. The dry run moves nothing; you untick what stays; it applies with an undo log; Undo puts everything back. It never deletes or overwrites.", "把資料夾裡零散的檔案依種類分到子資料夾。試跑不會動任何檔案；你取消勾選要留下的；套用時寫下還原紀錄；按還原就全部放回。不會刪除或覆蓋。")))),
    h("form", { class: "card x-pad x-ask", onsubmit: async (e) => { e.preventDefault(); go.disabled = true; const r = await X.post("/api/fileorg/plan", { root: inp.value.trim() }); go.disabled = false; if (r.error) return toast(r.error); K.plans.set(r.id, r); loadFo(); location.hash = `#/fileorg/${r.id}`; } },
      h("label", { class: "x-field", style: "display:grid;gap:4px" }, h("span", { class: "faint", style: "font-size:12.5px" }, T("Folder inside your home (absolute path)", "家目錄裡的資料夾（絕對路徑）")), inp), go),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Plans", "計畫")), h("span", { class: "faint" }, String(K.fo.plans.length))),
      K.fo.plans.length ? h("div", { class: "card", style: "display:grid" }, K.fo.plans.map((p) => h("a", { class: "lib-row x-link", href: `#/fileorg/${p.id}` }, h("div", { class: "run-s" }, h("b", {}, p.id), pBadge(p.status), h("code", { class: "a3-path" }, p.root),
        h("span", {}, T(`${p.moveCount} moves`, `${p.moveCount} 個搬移`)), p.moved ? h("span", {}, T(`${p.moved} moved`, `已搬 ${p.moved}`)) : null, h("span", { class: "faint" }, ago(p.createdAt))))))
        : h("div", { class: "card faint", style: "padding:14px 16px" }, T("No plan yet.", "還沒有計畫。"))));
}
function viewPlan(id) {
  const p = K.plans.get(id);
  if (!p) { loadPlan(id); return X.loading(); }
  if (p.error && !p.id) return X.notFound("No such plan", "沒有這個計畫");
  const rel = (f) => f.startsWith(p.root + "/") ? f.slice(p.root.length + 1) : f;
  const act = async (what, body) => { const r = await X.post(`/api/fileorg/${p.id}/${what}`, body); if (r.error) return toast(r.error); K.plans.set(p.id, r); loadFo(); soft(); };
  const cats = [...new Set(p.moves.map((m) => m.category))];
  const n = p.moves.filter((m) => m.include).length;
  const failed = p.gates.filter((g) => g.state === "fail");
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/fileorg", class: "a3-back" }, T("File organization", "檔案整理")), " · ", p.id),
      h("p", { class: "run-s", style: "font-size:13px" }, pBadge(p.status), h("code", { class: "a3-path" }, p.root), h("span", {}, T(`${n} of ${p.moves.length} moves`, `${p.moves.length} 個中的 ${n} 個`)), h("span", { class: "faint" }, ago(p.createdAt)))),
      h("div", { class: "actions" },
        p.status === "planned" ? h("button", { class: "btn primary", disabled: !!failed.length || !n, onclick: () => modal(T("Apply this plan?", "套用這個計畫？"), h("p", {}, T(`Moves ${n} files inside ${p.root}. Each move is written to the undo log first; Undo puts them back.`, `在 ${p.root} 裡搬移 ${n} 個檔案。每次搬移前先寫入還原紀錄；按還原可放回。`)), (c) => { c(); act("apply"); }) }, icon("check", "ic sm"), T("Apply", "套用")) : null,
        p.status === "applied" ? h("button", { class: "btn", onclick: () => modal(T("Undo this plan?", "還原這個計畫？"), h("p", {}, T("Every moved file goes back to where it was, last move first; the folders it made are removed when empty.", "每個搬過的檔案都放回原處（從最後一個開始）；它建立的空資料夾會移除。")), (c) => { c(); act("undo"); }) }, icon("refresh", "ic sm"), T("Undo", "還原")) : null,
        p.status === "planned" ? h("button", { class: "btn ghost", onclick: () => act("discard") }, T("Discard", "捨棄")) : null)),
    h("ul", { class: "card x-pad x-gates" }, p.gates.map((g) => h("li", {}, h("span", { class: `x-gk ${g.state === "pass" ? "ok" : "bad"}` }, g.state === "pass" ? "✓" : "✗"), h("span", {}, g.label), h("span", { class: "faint" }, g.detail)))),
    cats.map((cat) => h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, icon("folder", "ic sm"), " ", cat), h("span", { class: "faint" }, String(p.moves.filter((m) => m.category === cat).length))),
      h("div", { class: "card x-plan" }, p.moves.filter((m) => m.category === cat).map((m) => h("label", { class: `x-mv ${m.include ? "" : "off"}`, "data-move": m.id },
        h("input", { type: "checkbox", checked: m.include, disabled: p.status !== "planned", "aria-label": T(`Move ${rel(m.from)}`, `搬移 ${rel(m.from)}`), onchange: (e) => { e.target.blur(); act("include", { include: { [m.id]: e.target.checked } }); } }),
        h("code", {}, rel(m.from)), h("code", {}, `→ ${rel(m.to)}`),
        h("span", { class: "faint", style: "font-size:12px" }, m.result ? `${m.result}${m.note ? ` · ${m.note}` : ""}` : m.note || `${Math.max(1, Math.round(m.size / 1024))} KB`)))))),
    p.skipped.length ? h("details", { class: "card x-pad" }, h("summary", {}, T(`${p.skipped.length} stay where they are`, `${p.skipped.length} 個留在原地`)), h("ul", { class: "x-reasons", style: "margin-top:8px" }, p.skipped.map((s) => h("li", {}, h("code", {}, s.name), " — ", s.why)))) : null);
}

Object.assign(routes, { packs: viewPacks, "pack-draft": viewDraft, pack: viewPack, fileorg: viewFileorg });
X.nav("packs", "tag", "Packs", "套件", "improve", "navPacks");
X.own("packs", "pack-draft", "pack", "fileorg");
X.reroute(/^#\/(packs|pack-draft|pack|fileorg)/);
load();
})();
