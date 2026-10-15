// M3: artifacts with versions, the web pin review and the video timeline review,
// agent runs that make v(N+1), side-by-side compare, and the trivial lane
// ("Use in repo" cards). Routes: #/library (replaced), #/artifact/<id>,
// #/review/<id>/<n>, #/compare/<id>/<a>/<b>, #/changes.
(() => {
const A = { list: null, render: null, detail: new Map(), lane: null, chat: null, thumbs: new Map() };
const get = (u) => fetch(u).then((r) => r.json());
const api = (u, b) => postJ(u, b);
const fmtT = (t) => (t == null ? "?" : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`);
const short = (s) => (s ? s.slice(0, 10) : "—");
const money = (c) => !c ? "—" : c.usd != null ? `$${c.usd.toFixed(c.usd < 1 ? 3 : 2)}` : c.inTokens != null ? `${(c.inTokens / 1000).toFixed(1)}k in · ${((c.outTokens || 0) / 1000).toFixed(1)}k out` : "—";
const VST = { "in-review": ["run", () => T("In review", "審查中")], approved: ["ok", () => T("Approved", "已核准")], superseded: ["", () => T("Superseded", "已取代")], draft: ["", () => T("Draft", "草稿")] };
const vBadge = (s) => { const [c, l] = VST[s] || VST.draft; return h("span", { class: `badge ${c}` }, h("span", { class: "d" }), l()); };
const RST = { running: ["run", () => T("Working", "進行中")], rendering: ["run", () => T("Rendering", "算圖中")], done: ["ok", () => T("Done", "完成")], failed: ["bad", () => T("Failed", "失敗")], cancelled: ["", () => T("Cancelled", "已取消")] };
const rBadge = (s) => { const [c, l] = RST[s] || RST.cancelled; return h("span", { class: `badge ${c}` }, h("span", { class: "d" }), l()); };
const maker = (m) => !m ? "—" : m.kind === "agent" ? `${m.provider} · ${m.model}` : m.kind === "captain" ? T("captain", "船長") : T("imported", "匯入");
const typeIc = (t) => ({ web: "monitor", video: "film", audio:"film", image: "eye", doc: "doc" }[t] || "doc");
const LST = { ready: ["human", () => T("Ready to merge", "可合併")], fallback: ["bad", () => T("Needs the normal path", "需走一般流程")], merged: ["ok", () => T("Merged", "已合併")],
  draft: ["run", () => T("Proposed", "提議中")], closed: ["", () => T("Closed", "已關閉")], error: ["bad", () => T("Error", "錯誤")] };
const lBadge = (s) => { const [c, l] = LST[s] || LST.closed; return h("span", { class: `badge ${c}` }, h("span", { class: "d" }), l()); };

async function loadList() { try { const d = await get("/api/artifacts"); A.list = d.artifacts; A.render = d.render; A.runs = d.runs; } catch { A.list = []; } refresh(["library", "artifact"]); }
const sigs = new Map();
async function loadArt(id) {
  let d; try { const r = await fetch(`/api/artifacts/${encodeURIComponent(id)}`); d = r.ok ? await r.json() : { error: true }; } catch { d = { error: true }; }
  const sig = JSON.stringify(d); if (sigs.get(id) === sig && A.detail.has(id)) return; // nothing changed: keep the page (and its players) as they are
  sigs.set(id, sig); A.detail.set(id, d); refresh(["artifact", "review", "compare"], id);
}
async function loadLane() { try { A.lane = await get("/api/lane"); } catch { A.lane = { cards: [], repos: [] }; } refresh(["changes", "artifact"]); navCount(); }
async function loadChat() { try { A.chat = await get("/api/settings"); } catch {} }
const routeArtifact = () => (S.route?.arg || "").split("/")[0];
function refresh(names, id) { if (!S.route || !names.includes(S.route.name)) return; if (id && routeArtifact() !== id) return; soft(); }
window.onM3 = (type, d) => {
  if (type === "artifacts") {
    const id = ["artifact", "review", "compare"].includes(S.route?.name) ? routeArtifact() : null;
    // A workflow can approve an artifact while its detail page is not open.
    for (const cached of A.detail.keys()) if (cached !== id) { A.detail.delete(cached); sigs.delete(cached); }
    loadList(); if (id) loadArt(id);
  }
  if (type === "run") { const det = A.detail.get(d.artifact); if (det && !det.error) { det.runs = [d, ...(det.runs || []).filter((r) => r.id !== d.id)]; refresh(["artifact", "review"], d.artifact); }
    if (["done", "failed", "cancelled"].includes(d.status)) loadArt(d.artifact); }
  if (type === "lane") loadLane();
};
function navCount() { const n = (A.lane?.cards || []).filter((c) => c.state === "ready" || c.state === "draft").length; const el = $("#navChanges"); if (el) { el.hidden = !n; el.textContent = n; } }

// ---------- Library: artifacts with versions, then merged code ----------
function viewLibrary3() {
  if (!A.list) { loadList(); return h("div", { class: "page media-library" }, h("div", { class: "skel", style: "height:240px" })); }
  if (!LB.data) loadLibrary();
  const kind = LB.kind;
  const arts = A.list.filter((a) => kind === "all" || a.type === kind || (kind === "web" && a.type === "image"));
  const code = kind === "all" || kind === "code" ? (LB.data?.code || []).filter((x) => LB.range === "all" || (x.ts || "") >= new Date(Date.now() - Number(LB.range) * 86400e3).toISOString()) : [];
  const seg = (vals, cur, set) => h("div", { class: "seg media-filters", role: "group" }, vals.map(([v, en, tw]) => h("button", { "aria-pressed": String(cur === v), "data-filter": v, onclick: () => set(v) }, h("span", {}, T(en, tw)))));
  return h("div", { class: "page media-library" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Library", "成品庫")),
      h("p", {}, T("Deliverables with their versions, notes and approvals, and merged code with its lineage.", "成品和它的版本、標註與核准，以及已合併的程式碼和來歷。"))),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: newWebArtifact }, icon("plus", "ic sm"), T("New web page", "新增網頁")),
        h("button", { class: "btn ghost", onclick: () => { A.list = null; LB.data = null; render(); } }, icon("refresh", "ic sm"), T("Refresh", "重新整理")))),
    h("div", { class: "filters" },
      seg([["all", "All", "全部"], ["code", "Code", "程式碼"], ["video", "Video", "影片"], ["audio", "Audio", "音訊"], ["web", "Web & images", "網頁與圖片"]], kind, (v) => { LB.kind = v; store.set("crew.libKind", v); render(); }),
      seg([["7", "7 days", "7 天"], ["30", "30 days", "30 天"], ["all", "All time", "全部"]], LB.range, (v) => { LB.range = v; store.set("crew.libRange", v); render(); })),
    arts.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Artifacts", "成品")), h("span", { class: "faint" }, String(arts.length))),
      h("div", { class: "libgrid" }, arts.map(artCard))) : null,
    code.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Merged code", "已合併的程式碼")), h("span", { class: "faint" }, String(code.length))),
      h("div", { class: "card", style: "display:grid" }, code.map(codeRow))) : null,
    !arts.length && !code.length ? h("div", { class: "card" }, h("div", { class: "empty" }, icon("library"), h("b", {}, T("Nothing matches", "沒有符合的成品")), T("Try another type or a longer time range.", "換個類型或拉長時間範圍。"))) : null);
}
function artPreview(a, v, big) {
  const st = big ? "" : "height:170px";
  if (!v) return h("div", { class: "lprev", style: st });
  if (a.source === "url") return h("div", { class: "lprev a3-ph", style: st }, icon("link", "ic lg"), h("span", {}, T("External link", "外部連結")));
  if (!v.url && (v.fileCount === 0 || (v.files && !v.files.length))) return h("div", { class: "lprev a3-ph", style: st }, icon("alert", "ic lg"), h("span", { style: "text-align:center;padding:0 12px" }, v.summary || T("No file", "沒有檔案")));
  if (a.type === "audio") return h("div",{class:"lprev media-audio"},h("audio",{controls:true,preload:"metadata",src:`/af/${a.id}/${v.n}/${v.primary||a.entry||"audio.wav"}`,"aria-label":a.title}));
  if (a.type === "video") { const path=(v.files?.some(f=>f.path==="render.mp4")||v.render?.state==="done")?"render.mp4":(/\.mp4$/i.test(v.primary||"")?v.primary:null);return path?h("video",{class:"lprev",src:`/af/${a.id}/${v.n}/${path}#t=0.5`,controls:!!big,preload:"metadata",muted:true,playsinline:true,style:"width:100%;aspect-ratio:16/9;background:#000;display:block"}):h("div",{class:"lprev a3-ph"},T("No render yet","尚未算圖")); }
  if (a.type === "image") return h("div", { class: "lprev a3-img", style: st }, h("img", { src: `/af/${a.id}/${v.n}/${a.entry || "image.png"}`, alt: "" }));
  if (a.type === "web" || a.source === "md") { const w = h("div", { class: "lprev a3-thumb", style: st }, h("iframe", { src: `/af/${a.id}/${v.n}/${a.source === "md" ? "doc.html" : a.entry || "index.html"}`, sandbox: "", tabindex: "-1", "aria-hidden": "true", loading: "lazy" }));
    new ResizeObserver(() => w.style.setProperty("--k", String((w.clientWidth || 300) / 1280))).observe(w); return w; }
  return h("div", { class: "lprev a3-ph", style: st }, icon(typeIc(a.type), "ic lg"));
}
function artCard(a) {
  const last = a.versions.at(-1);
  return h(a.type==="audio"?"div":"a", { class: "card lib a3-card", href: `#/artifact/${a.id}`, "data-artifact": a.id, "data-file": a.legacy || a.id },
    artPreview(a, last),
    h("div", { class: "lbody" },
      h(a.type==="audio"?"a":"div", { class: "t",...(a.type==="audio"?{href:`#/artifact/${a.id}`}:{}) }, a.title),
      h("div", { class: "run-s" }, h("span", { class: "vbadge" }, a.type), h("span", { class: "vbadge" }, `v${a.latest}`), last ? vBadge(last.status) : null,
        a.approved ? h("span", { class: "faint" }, T(`v${a.approved} approved`, `v${a.approved} 已核准`)) : null),
      last?.media?h("div",{class:"faint media-provenance"},`${last.media.origin} · ${last.media.provider||"import"}${last.media.model?" / "+last.media.model:""} · Task ${last.media.task} · g${last.media.generation}`):null,
      a.note ? h("div", { class: "faint", style: "font-size:13px" }, a.note) : null));
}
function newWebArtifact() {
  const id = h("input", { placeholder: "landing-page", "aria-label": "id" }), title = h("input", { placeholder: T("Landing page", "首頁"), "aria-label": T("Title", "標題") });
  const html = h("textarea", { rows: 8, placeholder: "<!doctype html>…", "aria-label": "HTML" });
  modal(T("New web page artifact", "新增網頁成品"), h("div", { class: "form" },
    h("label", { class: "field" }, h("span", { class: "lbl" }, "id"), id), h("label", { class: "field" }, h("span", { class: "lbl" }, T("Title", "標題")), title),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("HTML (one self-contained page; it gets no network)", "HTML（單一自足頁面；沒有網路）")), html)),
    async (close, btn) => { btn.disabled = true; const r = await api("/api/artifacts", { id: id.value.trim(), title: title.value.trim() || id.value.trim(), type: "web", html: html.value });
      btn.disabled = false; if (r.error) return toast(r.error); close(); location.hash = `#/artifact/${r.artifact.id}`; loadList(); });
}

// ---------- artifact detail ----------
function viewArtifact(arg) {
  const id = (arg || "").split("/")[0];
  const d = A.detail.get(id);
  if (!d) { loadArt(id); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:260px" })); }
  if (d.error) return h("div", { class: "page" }, h("div", { class: "card" }, h("div", { class: "empty" }, h("b", {}, T("No such artifact", "找不到這個成品")), h("a", { href: "#/library" }, T("Library", "成品庫")))));
  const a = d.artifact, vs = d.versions, last = vs.at(-1), ap = vs.filter((v) => v.status === "approved").at(-1);
  const reviewable = a.source !== "url";
  const live = (d.runs || []).find((r) => r.status === "running" || r.status === "rendering");
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, a.title),
      h("p", { class: "run-s", style: "font-size:13px" }, h("span", { class: "vbadge" }, a.type), h("span", { class: "vbadge" }, a.source === "film" ? T("HTML film", "HTML 影片") : a.source === "html" ? T("web page", "網頁") : a.source === "md" ? T("document", "文件") : a.source === "url" ? T("link", "連結") : T("file", "檔案")),
        h("span", {}, a.project), h("span", {}, T(`created ${ago(a.created)}`, `${ago(a.created)}建立`)))),
      h("div", { class: "actions" },
        reviewable && last ? h("a", { class: "btn primary", href: `#/review/${a.id}/${last.n}` }, icon(a.type === "video" ? "film" : "pin", "ic sm"), T(`Review v${last.n}`, `審查 v${last.n}`)) : null,
        a.source === "url" && last?.url ? h("a", { class: "btn", href: last.url, target: "_blank", rel: "noopener" }, icon("link", "ic sm"), T("Open link", "打開連結")) : null,
        vs.length > 1 ? h("a", { class: "btn", href: `#/compare/${a.id}/${vs.at(-2).n}/${last.n}` }, icon("copy", "ic sm"), T(`Compare v${vs.at(-2).n} ↔ v${last.n}`, `比較 v${vs.at(-2).n} ↔ v${last.n}`)) : null,
        a.type === "image" && ap ? h("button", { class: "btn", onclick: () => useInRepo(a, ap, d.repos) }, icon("github", "ic sm"), T("Use in repo", "用在 repo")) : null,
        a.source === "md" ? h("a", { class: "btn", href: `#/doc/${a.id}` }, icon("doc", "ic sm"), T("Approve and export", "核准與匯出")) : null)),
    last?.media?h("div",{class:"faint media-provenance"},`${last.media.origin} · ${last.media.provider||"import"}${last.media.model?" / "+last.media.model:""} · Task ${last.media.task} · g${last.media.generation}`):null,
      a.note ? h("div", { class: "card", style: "padding:12px 16px;font-size:14px" }, a.note) : null,
    live ? runPanel(live) : null,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Versions", "版本")), h("span", { class: "faint" }, String(vs.length))),
      h("div", { class: "card a3-vtable" }, vs.slice().reverse().map((v) => verRow(a, v, d)))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Lineage", "來歷"))), h("div", { class: "card", style: "padding:14px 16px" }, lineage(a, vs, d.runs || []))),
    (d.runs || []).length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Agent rounds", "Agent 回合紀錄")), h("span", { class: "faint" }, String(d.runs.length))),
      h("div", { class: "card", style: "display:grid" }, d.runs.map(runRow))) : null,
    (d.cards || []).length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("In repositories", "放進 repo")), h("a", { href: "#/changes", class: "faint" }, T("All changes", "全部變更"))),
      h("div", { class: "card", style: "display:grid" }, d.cards.map(laneRowSmall))) : null);
}
function verRow(a, v, d) {
  const intact = !v.integrity?.length;
  return h("div", { class: "a3-vrow", "data-version": v.n },
    h("div", { class: "a3-vn" }, `v${v.n}`),
    h("div", { class: "a3-vmain" },
      h("div", { class: "run-s" }, vBadge(v.status), h("span", {}, maker(v.createdBy)), h("span", {}, ago(v.createdAt)), v.parent ? h("span", {}, T(`from v${v.parent}`, `來自 v${v.parent}`)) : null,
        v.annotations?.length ? h("span", {}, T(`for ${v.annotations.join(", ")}`, `處理 ${v.annotations.join(", ")}`)) : null,
        v.cost ? h("span", { title: T("Spend the provider reported", "provider 回報的花費") }, money(v.cost)) : null,
        v.sha256 ? h("code", { class: "a3-sha", title: v.sha256 }, `sha ${v.sha256.slice(0, 10)}`) : null,
        intact ? null : h("span", { class: "badge bad" }, T(`changed: ${v.integrity.join(", ")}`, `被改動：${v.integrity.join(", ")}`)),
        v.render && a.type === "video" ? h("span", { class: `badge ${v.render.state === "done" ? "ok" : v.render.state === "failed" ? "bad" : "run"}` }, v.render.state === "done" ? T("rendered", "已算圖") : v.render.state === "failed" ? T("render failed", "算圖失敗") : T("rendering…", "算圖中…")) : null),
      v.summary ? h("div", { class: "faint", style: "font-size:13px" }, v.summary) : null,
      v.approvedBy ? h("div", { class: "faint", style: "font-size:13px" }, T(`Approved by ${v.approvedBy} ${ago(v.approvedAt)}`, `${v.approvedBy} ${ago(v.approvedAt)}核准`)) : null),
    h("div", { class: "a3-vact" },
      a.source !== "url" ? h("a", { class: "btn sm", href: `#/review/${a.id}/${v.n}` }, T(`Notes (${v.notes.length})`, `標註 (${v.notes.length})`)) : null,
      v.status === "in-review" ? h("button", { class: "btn sm", onclick: () => approve(a, v) }, icon("check", "ic sm"), T("Approve", "核准")) : null,
      v.render?.state === "failed" && A.render?.canFilm ? h("button", { class: "btn sm", onclick: async () => { const r = await api(`/api/artifacts/${a.id}/v/${v.n}/render`); if (r.error) toast(r.error); } }, T("Render again", "重新算圖")) : null));
}
function lineage(a, vs, runs) {
  const parts = [];
  vs.forEach((v, i) => {
    if (i) { const run = runs.find((r) => r.version === v.n); parts.push(h("span", { class: "a3-arrow" }, "→"),
      h("span", { class: "lstep" }, h("b", {}, v.annotations?.length ? v.annotations.join(", ") : T("new file", "新檔案")), h("span", {}, run ? `${run.provider} · ${money(run.cost)}` : maker(v.createdBy))), h("span", { class: "a3-arrow" }, "→")); }
    parts.push(h("a", { class: `lstep ${v.status === "approved" ? "ok" : ""}`, href: a.source === "url" ? (v.url || "#") : `#/review/${a.id}/${v.n}` }, h("b", {}, `v${v.n}`), h("span", {}, VST[v.status]?.[1]() || v.status)));
  });
  return h("div", { class: "lineage" }, parts);
}
async function approve(a, v) {
  modal(T(`Approve ${a.title} v${v.n}?`, `核准 ${a.title} v${v.n}？`), h("p", {}, T("Approving pins this version's sha. A repository that holds an older approved version gets an update proposal.", "核准會固定這個版本的 sha；已放了舊版本的 repo 會收到更新提議。")),
    async (close) => { const r = await api(`/api/artifacts/${a.id}/v/${v.n}/approve`); close(); if (r.error) return toast(r.error); toast(T(`v${v.n} approved`, `v${v.n} 已核准`)); loadArt(a.id); loadList(); });
}
function runPanel(r) {
  const secs = Math.round((Date.now() - Date.parse(r.started)) / 1000);
  return h("div", { class: "card a3-run", "data-run": r.id },
    h("div", { class: "a3-runh" }, rBadge(r.status), h("b", {}, T(`Revising v${r.from}`, `修改 v${r.from}`)), h("span", { class: "faint" }, `${r.provider} · ${r.model}`),
      h("span", { class: "faint" }, r.status === "rendering" && r.renderProgress != null ? T(`render ${Math.round(r.renderProgress * 100)}%`, `算圖 ${Math.round(r.renderProgress * 100)}%`) : `${Math.floor(secs / 60)}m ${secs % 60}s · ${r.tools} ${T("tool calls", "次工具呼叫")}`),
      r.status === "running" ? h("button", { class: "btn sm danger", onclick: async () => { const x = await api(`/api/runs/${r.id}/cancel`); if (x.error) toast(x.error); } }, T("Cancel", "取消")) : null),
    r.status === "rendering" ? h("div", { class: "a3-prog" }, h("i", { style: `width:${Math.round((r.renderProgress || 0) * 100)}%` })) : null,
    h("div", { class: "term a3-log" }, (r.log || []).slice(-8).map((l) => h("div", { class: l.kind === "error" ? "bad" : "" }, h("span", { class: "dim" }, clock(l.ts) + " "), l.text))));
}
function runRow(r) {
  return h("div", { class: "lib-row" },
    h("div", { class: "run-s" }, rBadge(r.status), h("b", {}, `v${r.from} → ${r.version ? `v${r.version}` : "—"}`), h("span", {}, `${r.provider} · ${r.model}`), h("span", {}, r.notes.join(", ")),
      h("span", {}, money(r.cost)), h("span", {}, ago(r.started)), r.error ? h("span", { class: "bad" }, r.error) : null),
    r.summary ? h("div", { class: "faint", style: "font-size:13px" }, r.summary) : null);
}

// ---------- review: dispatch by type ----------
function viewReview(arg) {
  const [id, nStr] = (arg || "").split("/");
  const d = A.detail.get(id);
  if (!d) { loadArt(id); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:420px" })); }
  if (d.error) return viewArtifact(id);
  const n = Number(nStr) || d.versions.at(-1)?.n;
  const v = d.versions.find((x) => x.n === n);
  if (!v) return h("div", { class: "page" }, h("div", { class: "card" }, h("div", { class: "empty" }, h("b", {}, T("No such version", "沒有這個版本")))));
  if(d.managedMedia||d.artifact.type==="audio")return h("div",{class:"page","data-managed-media":d.managedMedia?"1":"0"},h("h1",{},d.artifact.title),vBadge(v.status),artPreview(d.artifact,v,true),h("p",{},d.managedMedia?T("Draft visibility is not approval. Review and refine this output in its workflow Task.","草稿可見不代表已核准，請回到工作流程任務驗收或修改。"):T("Imported audio","匯入音訊")),d.managedMedia&&v.media?h("a",{class:"btn",href:`#/run/${encodeURIComponent(v.media.task)}`},T("Open source Task","開啟來源任務")):null,h("a",{class:"btn",href:`#/artifact/${d.artifact.id}`},T("Versions","版本")));
  return d.artifact.type === "video" ? videoReview(d, v) : d.artifact.type === "image" ? imageReview(d, v) : webReview(d, v);
}
function reviewHead(d, v, extra) {
  const a = d.artifact;
  return h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: `#/artifact/${a.id}`, class: "a3-back" }, a.title), " · ", `v${v.n}`),
    h("p", { class: "run-s", style: "font-size:13px" }, vBadge(v.status), h("span", {}, maker(v.createdBy)), h("span", {}, ago(v.createdAt)),
      h("span", { class: "a3-vchips" }, d.versions.map((x) => h("a", { class: "chip", "aria-pressed": String(x.n === v.n), href: `#/review/${a.id}/${x.n}` }, `v${x.n}`))))),
    h("div", { class: "actions" }, extra));
}
const openNotes = (v) => v.notes.filter((x) => x.status === "open");
function reviewActions(d, v, canRegen, why) {
  const a = d.artifact;
  const live = (d.runs || []).find((r) => r.status === "running" || r.status === "rendering");
  const sel = h("select", { class: "input a3-prov", "aria-label": T("Agent provider", "Agent 提供者") },
    (A.chat?.choices || ["claude"]).map((p) => h("option", { value: p, selected: p === A.chat?.provider }, p)));
  const n = openNotes(v).length;
  return [
    canRegen ? h("label", { class: "a3-provwrap" }, h("span", { class: "faint" }, T("Agent", "Agent")), sel) : null,
    canRegen ? h("button", { class: "btn primary", disabled: !n || !!live, title: live ? T("A run is working on this artifact", "已有一個執行在處理這個成品") : "", onclick: async (e) => {
      e.target.disabled = true; const r = await api(`/api/artifacts/${a.id}/v/${v.n}/request`, { provider: sel.value }); if (r.error) { toast(r.error); e.target.disabled = false; } else { toast(T("The agent is working on it", "Agent 開始修改")); loadArt(a.id); } } },
      icon("wand", "ic sm"), T(`Request changes (${n})`, `要求修改（${n}）`)) : h("span", { class: "faint a3-why" }, why),
    h("button", { class: "btn", disabled: !n, onclick: () => showBrief(a, v) }, icon("doc", "ic sm"), T("Feedback brief", "回饋 brief")),
    v.status === "in-review" ? h("button", { class: "btn", onclick: () => approve(a, v) }, icon("check", "ic sm"), T(`Approve v${v.n}`, `核准 v${v.n}`)) : null,
  ];
}
async function showBrief(a, v) {
  const b = await get(`/api/artifacts/${a.id}/v/${v.n}/brief`);
  const pre = h("pre", { class: "a3-brief" }, b.brief);
  const json = h("pre", { class: "a3-brief", hidden: true }, JSON.stringify(b.structured, null, 2));
  const tog = h("button", { class: "btn sm ghost", onclick: () => { json.hidden = !json.hidden; pre.hidden = !pre.hidden; tog.textContent = json.hidden ? "JSON" : T("Text", "文字"); } }, "JSON");
  modal(T("Feedback brief", "回饋 brief"), h("div", { class: "form" }, h("p", { class: "faint" }, T("What the agent gets. You can also copy it to any other tool.", "這是 agent 收到的內容，也可以複製到其他工具。")), tog, pre, json),
    (close) => { try { navigator.clipboard.writeText(json.hidden ? b.brief : json.textContent); toast(T("Copied", "已複製")); } catch {} close(); });
  $(".modal .btn.primary").textContent = T("Copy", "複製");
}
function noteItem(a, v, x, opts = {}) {
  const claim = x.addressed;
  return h("div", { class: `a3-note ${x.status === "resolved" ? "done" : ""}`, "data-note": x.id, onmouseenter: () => opts.hover?.(x), onmouseleave: () => opts.hover?.(null), onclick: () => opts.pick?.(x) },
    h("div", { class: "a3-noteh" }, h("span", { class: "a3-num" }, x.id), x.kind === "range" ? h("code", {}, `${fmtT(x.t0)}–${fmtT(x.t1)}`) : x.selector ? h("code", { class: "a3-selc" }, x.selector) : null,
      x.status === "resolved" ? h("span", { class: "badge ok" }, T("resolved", "已解決")) : null),
    x.crop ? h("img", { class: "a3-crop", src: x.crop, alt: T(`Crop of ${x.id}`, `${x.id} 的截圖`), loading: "lazy" }) : null,
    h("div", { class: "a3-cm" }, x.comment),
    opts.scenes ? h("div", { class: "faint", style: "font-size:12px" }, opts.scenes) : null,
    claim ? h("div", { class: `a3-claim ${claim.claim ? "ok" : "bad"}` }, claim.claim ? T(`Agent says addressed in v${claim.version}: `, `Agent 說已在 v${claim.version} 處理：`) : T(`Agent says not addressed (v${claim.version}): `, `Agent 說未處理（v${claim.version}）：`), claim.how) : null,
    h("div", { class: "a3-noteact" },
      claim ? h("label", { class: "a3-chk" }, h("input", { type: "checkbox", checked: !!x.verified, onchange: async (e) => { e.stopPropagation(); await api(`/api/artifacts/${a.id}/v/${v.n}/notes/${x.id}`, { verified: e.target.checked }); loadArt(a.id); } }), T("Verified", "已確認")) : null,
      h("button", { class: "btn sm ghost", onclick: async (e) => { e.stopPropagation(); await api(`/api/artifacts/${a.id}/v/${v.n}/notes/${x.id}`, { status: x.status === "open" ? "resolved" : "open" }); loadArt(a.id); } },
        x.status === "open" ? T("Resolve", "標為已解決") : T("Reopen", "重新打開"))));
}

// ---------- web pin review ----------
const VIRT = 1280; // the page is laid out at this width and scaled to fit
function cssPath(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  while (el && el.nodeType === 1 && el.tagName !== "HTML" && el.tagName !== "BODY" && parts.length < 5) {
    if (el.id) { parts.unshift(`#${CSS.escape(el.id)}`); break; }
    let s = el.tagName.toLowerCase();
    const cls = [...el.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c)).slice(0, 2);
    if (cls.length) s += "." + cls.map((c) => CSS.escape(c)).join(".");
    const sib = el.parentElement ? [...el.parentElement.children].filter((x) => x.tagName === el.tagName) : [];
    if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(el) + 1})`;
    parts.unshift(s); el = el.parentElement;
  }
  return parts.join(" > ") || "body";
}
function framed(src, o = {}) {
  // an artifact page at VIRT px wide, scaled to the column; scripts off (sandbox without allow-scripts), same origin so Studio can read it
  const iframe = h("iframe", { src, sandbox: "allow-same-origin", title: o.title || "artifact", class: "a3-iframe", scrolling: "no" });
  const over = h("div", { class: "a3-over" });
  const wrap = h("div", { class: "a3-fwrap" }, iframe, over);
  const fit = () => { const w = wrap.clientWidth || 600; const doc = iframe.contentDocument; const hh = Math.min(4000, Math.max(400, doc?.documentElement?.scrollHeight || 800));
    const k = w / VIRT; iframe.style.height = `${hh}px`; iframe.style.transform = `scale(${k})`; over.style.transform = `scale(${k})`; over.style.height = `${hh}px`; wrap.style.height = `${hh * k}px`; wrap.dataset.k = k; o.onFit?.(k); };
  iframe.addEventListener("load", () => { fit(); o.onLoad?.(iframe.contentDocument, over, fit); });
  new ResizeObserver(fit).observe(wrap);
  return { wrap, iframe, over, fit };
}
const box = (b, cls, label) => h("div", { class: `a3-box ${cls || ""}`, style: `left:${b.x}px;top:${b.y}px;width:${Math.max(6, b.w)}px;height:${Math.max(6, b.h)}px` }, label ? h("span", { class: "a3-tag" }, label) : null);
function webReview(d, v) {
  const a = d.artifact;
  const src = `/af/${a.id}/${v.n}/${a.source === "md" ? "doc.html" : v.primary || a.entry || "index.html"}`;
  let hover = null, hl = null;
  const pins = h("div", { class: "a3-pins" });
  const f = framed(src, { title: a.title, onLoad: (doc, over) => {
    if (!doc) return;
    over.append(pins, (hover = h("div", { class: "a3-box hover", hidden: true })));
    drawPins();
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + doc.defaultView.scrollX, y: r.top + doc.defaultView.scrollY, w: r.width, h: r.height }; };
    doc.addEventListener("mousemove", (e) => { const el = e.target; if (!el || el === doc.documentElement) return; const r = rectOf(el); Object.assign(hover.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); hover.hidden = false; });
    doc.addEventListener("mouseleave", () => { hover.hidden = true; });
    doc.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const el = e.target; if (!el || el === doc.documentElement) return; composer(cssPath(el), rectOf(el), e.clientX, e.clientY); }, true);
  } });
  function drawPins() { pins.replaceChildren(...v.notes.filter((x) => x.bbox).map((x) => { const b = box(x.bbox, `pin ${x.status === "resolved" ? "done" : ""} ${hl === x.id ? "hl" : ""}`, x.id); b.dataset.pin = x.id; return b; })); }
  function composer(selector, bb, cx, cy) {
    $(".a3-compose")?.remove();
    const ta = h("textarea", { rows: 3, placeholder: T("What should change here?", "這裡要改什麼？"), "aria-label": T("Comment", "意見") });
    const k = Number(f.wrap.dataset.k || 1);
    const pop = h("div", { class: "a3-compose card", style: `left:${Math.min(Math.max(8, cx * k), f.wrap.clientWidth - 288)}px;top:${Math.min(cy * k + 12, Math.max(8, f.wrap.clientHeight - 170))}px` },
      h("div", { class: "faint", style: "font-size:12px" }, h("code", {}, selector)), ta,
      h("div", { class: "actions", style: "justify-content:flex-end" }, h("button", { class: "btn sm", onclick: () => pop.remove() }, T("Cancel", "取消")),
        h("button", { class: "btn sm primary", onclick: async (e) => { if (!ta.value.trim()) return ta.focus(); e.target.disabled = true;
          const r = await api(`/api/artifacts/${a.id}/v/${v.n}/notes`, { kind: "pin", selector, bbox: bb, comment: ta.value.trim() }); pop.remove(); if (r.error) return toast(r.error); loadArt(a.id); } }, T("Add pin", "加上標註"))));
    f.wrap.append(pop); ta.focus();
  }
  const side = h("aside", { class: "a3-side" },
    h("div", { class: "sec-head" }, h("h2", {}, T("Pins", "標註")), h("span", { class: "faint" }, `${openNotes(v).length} ${T("open", "未解決")}`)),
    v.notes.length ? h("div", { class: "a3-notes" }, v.notes.map((x) => noteItem(a, v, x, { hover: (n) => { hl = n?.id || null; drawPins(); } })))
      : h("div", { class: "empty", style: "padding:16px" }, icon("pin"), h("b", {}, T("No pins yet", "還沒有標註")), T("Click anything on the page to pin a note to it.", "點頁面上任何地方，就能在那裡加標註。")));
  const live = (d.runs || []).find((r) => r.status === "running" || r.status === "rendering" || (r.from === v.n && r.version && r.status === "done"));
  return h("div", { class: "page a3-wide" },
    reviewHead(d, v, reviewActions(d, v, a.source === "html" || a.source === "md", T("This artifact has no source to revise.", "這個成品沒有可修改的原始檔。"))),
    live && live.from === v.n && live.version ? h("div", { class: "card a3-done" }, icon("check"), h("span", {}, T(`The agent made v${live.version} from these pins.`, `Agent 依這些標註做出了 v${live.version}。`)),
      h("a", { class: "btn sm primary", href: `#/compare/${a.id}/${v.n}/${live.version}` }, T(`Compare v${v.n} ↔ v${live.version}`, `比較 v${v.n} ↔ v${live.version}`))) : live ? runPanel(live) : null,
    h("div", { class: "a3-review" }, h("div", { class: "card a3-stage" }, h("div", { class: "a3-hint faint" }, icon("pin", "ic sm"), T("Click an element to pin a note. Scripts on the page are off; it has no network.", "點選元素即可加標註。頁面的 script 已關閉，也沒有網路。")), f.wrap), side));
}
function imageReview(d, v) {
  const a = d.artifact;
  return h("div", { class: "page" }, reviewHead(d, v, reviewActions(d, v, false, T("Images take notes; a new version comes from you.", "圖片可以加標註；新版本由你提供。"))),
    h("div", { class: "a3-review" }, h("div", { class: "card a3-stage" }, h("img", { class: "a3-imgfull", src: `/af/${a.id}/${v.n}/${v.primary}`, alt: a.title })),
      h("aside", { class: "a3-side" }, h("div", { class: "sec-head" }, h("h2", {}, T("Notes", "標註"))), v.notes.length ? h("div", { class: "a3-notes" }, v.notes.map((x) => noteItem(a, v, x))) : h("div", { class: "faint" }, T("No notes", "沒有標註")))));
}

// ---------- video timeline review ----------
function thumbsFor(src, dur, n, onDone) {
  const key = `${src}|${n}`;
  if (A.thumbs.has(key)) return A.thumbs.get(key);
  const list = []; A.thumbs.set(key, list);
  const vid = h("video", { src, muted: true, preload: "auto", playsinline: true, crossorigin: "anonymous" });
  let i = 0;
  const next = () => { if (i >= n) { onDone?.(); return; } vid.currentTime = Math.min(dur - 0.05, ((i + 0.5) * dur) / n); };
  vid.addEventListener("seeked", () => { try { const c = document.createElement("canvas"); c.width = 160; c.height = 90; c.getContext("2d").drawImage(vid, 0, 0, 160, 90); list[i] = c.toDataURL("image/jpeg", 0.6); } catch {} i++; next(); });
  vid.addEventListener("loadedmetadata", next, { once: true });
  return list;
}
function videoReview(d, v) {
  const a = d.artifact;
  const has = v.files.some((f) => f.path === "render.mp4");
  const scenes = d.scenes || [];
  const sel = { t0: null, t1: null, box: null };
  const sceneOf = (t0, t1) => scenes.filter((s) => (t1 > t0 ? t1 > s.t0 && t0 < s.t1 : t0 >= s.t0 && t0 < s.t1)).map((s) => s.name).join(", ");
  const head = reviewHead(d, v, reviewActions(d, v, a.source === "film", T("Plain MP4: notes export as a brief; there is no source to regenerate.", "一般 MP4：標註可匯出成 brief，但沒有原始檔可重新產生。")));
  const live = (d.runs || []).find((r) => r.status === "running" || r.status === "rendering");
  const done = (d.runs || []).find((r) => r.from === v.n && r.version && r.status === "done");
  if (!has) return h("div", { class: "page" }, head, live ? runPanel(live) : null,
    h("div", { class: "card" }, h("div", { class: "empty" }, icon("film"), h("b", {}, v.render?.state === "running" ? T("Rendering this version…", "這個版本算圖中…") : T("This version has no MP4 yet", "這個版本還沒有 MP4")),
      v.render?.state === "failed" ? h("span", {}, v.render.detail) : null, !A.render?.canFilm ? h("a", { href: "#/doctor" }, T("The renderer is not installed: see Doctor", "尚未安裝算圖工具：請看健康檢查")) : null)));
  const video = h("video", { src: `/af/${a.id}/${v.n}/render.mp4`, preload: "auto", playsinline: true, class: "a3-video" });
  const frameBox = h("div", { class: "a3-fbox", hidden: true });
  const draw = h("div", { class: "a3-draw" }, frameBox);
  const player = h("div", { class: "a3-player" }, video, draw);
  const strip = h("div", { class: "a3-strip" });
  const marks = h("div", { class: "a3-marks" });
  const selEl = h("div", { class: "a3-sel", hidden: true });
  const head2 = h("div", { class: "a3-playhead" });
  const tl = h("div", { class: "a3-tl", role: "slider", tabindex: "0", "aria-label": T("Timeline: drag to select a range", "時間軸：拖曳選取區段") }, strip, marks, selEl, head2);
  const timeLbl = h("span", { class: "a3-time" }, "0:00.0");
  const play = h("button", { class: "btn icon", "aria-label": T("Play", "播放"), onclick: () => (video.paused ? video.play() : video.pause()) }, icon("play"));
  let boxMode = false;
  const boxBtn = h("button", { class: "btn sm", "aria-pressed": "false", onclick: () => { boxMode = !boxMode; boxBtn.setAttribute("aria-pressed", String(boxMode)); draw.classList.toggle("on", boxMode); if (boxMode) video.pause(); } }, icon("fit", "ic sm"), T("Draw a box", "框選畫面"));
  const rangeLbl = h("code", {}, T("drag on the timeline", "在時間軸上拖曳"));
  const sceneLbl = h("span", { class: "faint", style: "font-size:12px" });
  const ta = h("textarea", { rows: 2, placeholder: T("What should change in this range?", "這段要改什麼？"), "aria-label": T("Comment", "意見") });
  const add = h("button", { class: "btn primary sm", disabled: true, onclick: async () => {
    if (!ta.value.trim()) return ta.focus();
    const r = await api(`/api/artifacts/${a.id}/v/${v.n}/notes`, { kind: "range", t0: sel.t0, t1: sel.t1, box: sel.box, comment: ta.value.trim(), scene: sceneOf(sel.t0, sel.t1) || null });
    if (r.error) return toast(r.error); loadArt(a.id); } }, T("Add note", "加上標註"));
  const dur = () => video.duration || 1;
  const xToT = (x) => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(dur(), ((x - r.left) / r.width) * dur())); };
  const pct = (t) => `${(t / dur()) * 100}%`;
  const showSel = () => {
    if (sel.t0 == null) { selEl.hidden = true; add.disabled = true; return; }
    selEl.hidden = false; selEl.style.left = pct(sel.t0); selEl.style.width = `calc(${pct(sel.t1 - sel.t0)} + 2px)`;
    rangeLbl.textContent = `${fmtT(sel.t0)}–${fmtT(sel.t1)}`; sceneLbl.textContent = sceneOf(sel.t0, sel.t1) ? T(`scenes: ${sceneOf(sel.t0, sel.t1)}`, `場景：${sceneOf(sel.t0, sel.t1)}`) : ""; add.disabled = false; };
  const drawMarks = () => marks.replaceChildren(...v.notes.map((x) => h("div", { class: `a3-mark ${x.status === "resolved" ? "done" : ""}`, title: `${x.id}: ${x.comment}`, style: `left:${pct(x.t0)};width:calc(${pct(Math.max(0.05, x.t1 - x.t0))} + 2px)`, onclick: (e) => { e.stopPropagation(); pick(x); } }, h("span", {}, x.id))));
  const drawStrip = () => { const list = thumbsFor(video.src, dur(), 12, () => drawStrip()); strip.replaceChildren(...Array.from({ length: 12 }, (_, i) => list[i] ? h("img", { src: list[i], alt: "" }) : h("i"))); };
  video.addEventListener("loadedmetadata", () => { drawMarks(); drawStrip(); });
  video.addEventListener("timeupdate", () => { head2.style.left = pct(video.currentTime); timeLbl.textContent = `${fmtT(video.currentTime)} / ${fmtT(dur())}`; });
  video.addEventListener("play", () => play.replaceChildren(icon("pause"))); video.addEventListener("pause", () => play.replaceChildren(icon("play")));
  let drag = null;
  tl.addEventListener("pointerdown", (e) => { tl.setPointerCapture(e.pointerId); drag = xToT(e.clientX); sel.t0 = sel.t1 = drag; video.currentTime = drag; showSel(); });
  tl.addEventListener("pointermove", (e) => { if (drag == null) return; const t = xToT(e.clientX); sel.t0 = Math.min(drag, t); sel.t1 = Math.max(drag, t); showSel(); });
  tl.addEventListener("pointerup", () => { if (drag == null) return; if (sel.t1 - sel.t0 < 0.1) { sel.t1 = Math.min(dur(), sel.t0 + 1); showSel(); } drag = null; sel.t0 = Math.round(sel.t0 * 10) / 10; sel.t1 = Math.round(sel.t1 * 10) / 10; showSel(); ta.focus({ preventScroll: true }); });
  let bdrag = null;
  draw.addEventListener("pointerdown", (e) => { if (!boxMode) return; draw.setPointerCapture(e.pointerId); const r = draw.getBoundingClientRect(); bdrag = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; });
  draw.addEventListener("pointermove", (e) => { if (!bdrag) return; const r = draw.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    sel.box = { x: Math.max(0, Math.min(bdrag.x, x)), y: Math.max(0, Math.min(bdrag.y, y)), w: Math.min(1, Math.abs(x - bdrag.x)), h: Math.min(1, Math.abs(y - bdrag.y)) };
    Object.assign(frameBox.style, { left: `${sel.box.x * 100}%`, top: `${sel.box.y * 100}%`, width: `${sel.box.w * 100}%`, height: `${sel.box.h * 100}%` }); frameBox.hidden = false; });
  draw.addEventListener("pointerup", () => { bdrag = null; });
  function pick(x) { video.pause(); video.currentTime = x.t0; if (x.box) { Object.assign(frameBox.style, { left: `${x.box.x * 100}%`, top: `${x.box.y * 100}%`, width: `${x.box.w * 100}%`, height: `${x.box.h * 100}%` }); frameBox.hidden = false; } else frameBox.hidden = true; }
  const side = h("aside", { class: "a3-side" },
    h("div", { class: "sec-head" }, h("h2", {}, T("Notes", "標註")), h("span", { class: "faint" }, `${openNotes(v).length} ${T("open", "未解決")}`)),
    v.notes.length ? h("div", { class: "a3-notes" }, v.notes.map((x) => noteItem(a, v, x, { pick, scenes: x.scene || sceneOf(x.t0, x.t1) })))
      : h("div", { class: "empty", style: "padding:16px" }, icon("clock"), h("b", {}, T("No notes yet", "還沒有標註")), T("Drag on the timeline to pick a range, optionally draw a box on the frame, then add a note.", "在時間軸上拖曳選取區段，也可以在畫面上框選，再加上標註。")));
  return h("div", { class: "page a3-wide" }, head,
    done ? h("div", { class: "card a3-done" }, icon("check"), h("span", {}, T(`The agent made v${done.version} from these notes.`, `Agent 依這些標註做出了 v${done.version}。`)), h("a", { class: "btn sm primary", href: `#/compare/${a.id}/${v.n}/${done.version}` }, T(`Compare v${v.n} ↔ v${done.version}`, `比較 v${v.n} ↔ v${done.version}`))) : live ? runPanel(live) : null,
    h("div", { class: "a3-review" },
      h("div", { class: "card a3-stage" }, player,
        h("div", { class: "a3-ctrl" }, play, timeLbl, h("span", { class: "a3-grow" }), boxBtn), tl,
        h("div", { class: "a3-composer" }, h("div", { class: "run-s" }, h("b", {}, T("New note", "新標註")), rangeLbl, sceneLbl), ta, h("div", { class: "actions", style: "justify-content:flex-end" }, add))),
      side));
}

// ---------- compare ----------
function viewCompare(arg) {
  const [id, aStr, bStr] = (arg || "").split("/");
  const d = A.detail.get(id);
  if (!d) { loadArt(id); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:420px" })); }
  if (d.error) return viewArtifact(id);
  const a = d.artifact, va = d.versions.find((x) => x.n === Number(aStr)), vb = d.versions.find((x) => x.n === Number(bStr));
  if (!va || !vb) return h("div", { class: "page" }, h("div", { class: "card" }, h("div", { class: "empty" }, h("b", {}, T("No such versions", "沒有這些版本")))));
  const headR = h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: `#/artifact/${a.id}`, class: "a3-back" }, a.title), " · ", `v${va.n} ↔ v${vb.n}`),
    h("p", { class: "run-s", style: "font-size:13px" }, h("span", {}, T(`v${vb.n} by ${maker(vb.createdBy)}`, `v${vb.n} 由 ${maker(vb.createdBy)}`)), vb.annotations?.length ? h("span", {}, T(`for ${vb.annotations.join(", ")}`, `處理 ${vb.annotations.join(", ")}`)) : null, vb.cost ? h("span", {}, money(vb.cost)) : null)),
    h("div", { class: "actions" }, vb.status === "in-review" ? h("button", { class: "btn primary", onclick: () => approve(a, vb) }, icon("check", "ic sm"), T(`Approve v${vb.n}`, `核准 v${vb.n}`)) : vBadge(vb.status),
      h("a", { class: "btn", href: `#/review/${a.id}/${vb.n}` }, T(`Review v${vb.n}`, `審查 v${vb.n}`))));
  const list = h("div", { class: "card a3-notes", style: "padding:8px" }, va.notes.length ? va.notes.map((x) => noteItem(a, va, x, { pick: (n) => pickAll(n), hover: (n) => hlAll(n) })) : h("div", { class: "faint", style: "padding:8px" }, T(`No notes on v${va.n}`, `v${va.n} 沒有標註`)));
  let pickAll = () => {}, hlAll = () => {};
  let body;
  if (a.type === "video") {
    const mk = (v) => v.files.some((f) => f.path === "render.mp4") ? h("video", { class: "a3-video", src: `/af/${a.id}/${v.n}/render.mp4`, preload: "auto", playsinline: true, muted: true, controls: true }) : h("div", { class: "empty" }, T("No MP4", "沒有 MP4"));
    const A1 = mk(va), B1 = mk(vb);
    pickAll = (n) => { for (const x of [A1, B1]) if (x.tagName === "VIDEO") { x.pause(); x.currentTime = n.t0; } };
    const both = h("button", { class: "btn sm", onclick: () => { for (const x of [A1, B1]) if (x.tagName === "VIDEO") { x.currentTime = A1.currentTime || 0; x.play(); } } }, icon("play", "ic sm"), T("Play both", "同時播放"));
    body = h("div", { class: "a3-cmp" }, h("div", { class: "card a3-cmpcol" }, h("div", { class: "a3-cmph" }, `v${va.n}`), A1), h("div", { class: "card a3-cmpcol" }, h("div", { class: "a3-cmph" }, `v${vb.n}`, h("span", { class: "a3-grow" }), both), B1));
  } else if (a.type === "image") {
    body = h("div", { class: "a3-cmp" }, [va, vb].map((v) => h("div", { class: "card a3-cmpcol" }, h("div", { class: "a3-cmph" }, `v${v.n}`), h("img", { class: "a3-imgfull", src: `/af/${a.id}/${v.n}/${v.primary}`, alt: `v${v.n}` }))));
  } else {
    const mk = (v, other) => framed(`/af/${a.id}/${v.n}/${a.source === "md" ? "doc.html" : v.primary || a.entry || "index.html"}`, { title: `v${v.n}`, onLoad: (doc, over) => {
      const layer = h("div", {}); over.append(layer);
      const draw = (hl) => layer.replaceChildren(...va.notes.map((x) => { let b = x.bbox; if (other && x.selector) { try { const el = doc.querySelector(x.selector); if (el) { const r = el.getBoundingClientRect(); b = { x: r.left, y: r.top + doc.defaultView.scrollY, w: r.width, h: r.height }; } } catch {} }
        return b ? box(b, `pin ${hl === x.id ? "hl" : ""}`, x.id) : null; }).filter(Boolean));
      draw(null); const prev = hlAll; hlAll = (n) => { prev(n); draw(n?.id || null); };
      doc.addEventListener("click", (e) => e.preventDefault(), true);
    } });
    const fa = mk(va, true), fb = mk(vb, true); // both resolve each pin by its selector (the stored box is the fallback)
    body = h("div", { class: "a3-cmp" }, h("div", { class: "card a3-cmpcol" }, h("div", { class: "a3-cmph" }, `v${va.n}`, h("span", { class: "faint" }, T(" · pins where they were", "・標註原本的位置"))), fa.wrap),
      h("div", { class: "card a3-cmpcol" }, h("div", { class: "a3-cmph" }, `v${vb.n}`, h("span", { class: "faint" }, T(" · the same elements now", "・同樣的元素現在的位置"))), fb.wrap));
  }
  return h("div", { class: "page a3-wide" }, headR, body,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T(`v${va.n}'s notes: did v${vb.n} address them?`, `v${va.n} 的標註：v${vb.n} 有處理嗎？`))), list));
}

// ---------- the trivial lane ----------
function useInRepo(a, v, repos) {
  repos = repos || A.lane?.repos || [];
  const sel = h("select", { "aria-label": T("Repository", "Repository") }, repos.map((r) => h("option", { value: r.id }, `${r.name} (${r.github || T("local", "本地")})`)));
  const name = h("input", { value: a.id, "aria-label": T("File name", "檔名") });
  const body = repos.length ? h("div", { class: "form" },
    h("p", { class: "faint" }, T(`Puts ${a.title} v${v.n} at the top of the README. Deterministic: no agent, no model. Script checks run; any failure sends it to the normal path.`, `把 ${a.title} v${v.n} 放到 README 最上面。純程式：不用 agent、不用模型。會跑檢查，有任何一項不過就走一般流程。`)),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Repository", "Repository")), sel),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Recipe", "做法")), h("select", { disabled: true }, h("option", {}, T("Add image to README top", "把圖片放到 README 最上面")))),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("File name in assets/", "assets/ 裡的檔名")), name))
    : h("div", { class: "form" }, h("p", {}, T("No repository yet. Add one on the Changes page (Mac only).", "還沒有 repository。請在「變更」頁新增（只能在 Mac 上）。")), h("a", { class: "btn", href: "#/changes" }, T("Changes", "變更")));
  modal(T("Use in repo", "用在 repo"), body, async (close, btn) => {
    if (!repos.length) return close();
    btn.disabled = true; const r = await api("/api/lane/run", { artifact: a.id, version: v.n, repo: sel.value, name: name.value.trim() }); btn.disabled = false;
    if (r.error) return toast(r.error); close(); location.hash = `#/changes`; loadLane(); });
  $(".modal .btn.primary").textContent = T("Make the change", "產生變更");
}
function viewChanges() {
  if (!A.lane) { loadLane(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:240px" })); }
  const cards = A.lane.cards.filter((c) => c.state !== "closed");
  const closed = A.lane.cards.filter((c) => c.state === "closed");
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Changes", "變更")),
      h("p", {}, T("Small changes from approved artifacts: a recipe makes the commit, scripts check it, you merge it with one click. Anything outside the recipe goes to the normal path.", "從已核准成品產生的小變更：recipe 產生 commit、script 檢查、你點一下合併。超出 recipe 範圍的就走一般流程。"))),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: addRepo }, icon("plus", "ic sm"), T("Add repository", "新增 repository")))),
    cards.length ? h("section", {}, h("div", { class: "a3-lane" }, cards.map(laneCard)))
      : h("div", { class: "card" }, h("div", { class: "empty" }, icon("github"), h("b", {}, T("No changes waiting", "沒有待處理的變更")), T("Approve an image artifact, then use “Use in repo” on it.", "核准一個圖片成品，再按「用在 repo」。"))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Repositories", "Repository")), h("span", { class: "faint" }, String(A.lane.repos.length))),
      A.lane.repos.length ? h("div", { class: "card", style: "display:grid" }, A.lane.repos.map((r) => h("div", { class: "lib-row" }, h("div", { class: "run-s" }, h("b", {}, r.name), h("code", { class: "a3-path" }, r.path),
        h("span", { class: "vbadge" }, r.base), r.github ? h("span", {}, icon("github", "ic sm"), r.github) : h("span", { class: "faint" }, T("local only", "只在本地")), r.remote ? h("span", { class: "faint" }, `remote ${r.remote}`) : null))))
        : h("div", { class: "card faint", style: "padding:14px 16px" }, T("None yet.", "還沒有。"))),
    closed.length ? h("details", { class: "card", style: "padding:10px 16px" }, h("summary", {}, T(`${closed.length} closed`, `${closed.length} 個已關閉`)), closed.map(laneRowSmall)) : null);
}
function laneRowSmall(c) {
  return h("div", { class: "lib-row" }, h("div", { class: "run-s" }, lBadge(c.state), h("b", {}, `${c.artifact} v${c.version}`), h("span", {}, "→"), h("code", { class: "a3-path" }, `${c.repo}:${c.asset}`),
    c.pr ? h("a", { href: c.pr.url, target: "_blank", rel: "noopener" }, `#${c.pr.number}`) : null, h("span", {}, ago(c.mergedAt || c.createdAt)), c.error ? h("span", { class: "faint" }, c.error) : null));
}
function laneCard(c) {
  const repo = A.lane.repos.find((r) => r.id === c.repo);
  const prev = h("div", { class: "a3-md" }, h("div", { class: "skel", style: "height:80px" }));
  if (c.readme) get(`/api/lane/${c.id}/preview`).then((p) => { prev.innerHTML = p.html || ""; prev.querySelectorAll("a").forEach((x) => x.setAttribute("rel", "noopener")); }).catch(() => {});
  else prev.replaceChildren(h("div", { class: "faint" }, c.kind === "update" ? T("Prepare to see the change.", "按「準備」看變更內容。") : ""));
  const act = async (what) => { const r = await api(`/api/lane/${c.id}/${what}`); if (r.error) toast(r.error); loadLane(); };
  return h("div", { class: `card a3-lcard ${c.state}`, "data-card": c.id },
    h("div", { class: "a3-lch" }, lBadge(c.state), window.doorChip?.(c.door) ?? null, h("b", {}, c.kind === "update" ? T(`Update ${c.asset} to ${c.artifact} v${c.version}`, `把 ${c.asset} 更新成 ${c.artifact} v${c.version}`) : T(`Add ${c.title} to the README`, `把 ${c.title} 加到 README`)),
      h("span", { class: "faint" }, repo ? `${repo.name}${repo.github ? ` · ${repo.github}` : ""}` : c.repo), h("span", { class: "a3-grow" }), h("span", { class: "faint" }, ago(c.createdAt))),
    c.replaces ? h("div", { class: "faint", style: "font-size:13px" }, T(`Replaces v${c.replaces.version} (sha ${short(c.replaces.sha256)}) with v${c.version} (sha ${short(c.sha256)}).`, `用 v${c.version}（sha ${short(c.sha256)}）取代 v${c.replaces.version}（sha ${short(c.replaces.sha256)}）。`)) : null,
    c.state === "fallback" ? h("div", { class: "err" }, icon("alert", "ic sm"), T("A check failed: this change needs the normal two-way path. Nothing merges here.", "有檢查沒過：這個變更要走一般 two-way 流程，這裡不會合併。")) : null,
    c.error ? h("div", { class: "err" }, icon("alert", "ic sm"), c.error) : null,
    c.checks.length ? h("ul", { class: "a3-checks" }, c.checks.map((x) => h("li", { class: x.ok === false ? "bad" : x.ok ? "ok" : "na" }, h("span", { class: "a3-ck" }, x.ok === false ? "✗" : x.ok ? "✓" : "·"), h("b", {}, x.label), h("span", { class: "faint" }, x.detail)))) : null,
    c.branch ? h("div", { class: "run-s", style: "font-size:13px" }, icon("branch", "ic sm"), h("code", { class: "a3-path" }, c.branch), c.commit ? h("code", {}, c.commit.slice(0, 8)) : null, c.pr ? h("a", { href: c.pr.url, target: "_blank", rel: "noopener" }, icon("pr", "ic sm"), `PR #${c.pr.number}`) : null,
      c.diff ? h("span", { class: "faint" }, c.diff.split("\n").at(-1)) : null) : null,
    c.readme ? h("details", { open: c.state === "ready" }, h("summary", {}, T("README preview", "README 預覽")), prev) : null,
    h("div", { class: "actions" },
      c.state === "draft" ? h("button", { class: "btn primary", onclick: () => act("prepare") }, T("Prepare", "準備")) : null,
      c.state === "ready" && repo?.github && !c.pr ? h("button", { class: "btn", onclick: () => act("pr") }, icon("pr", "ic sm"), T("Open PR", "開 PR")) : null,
      c.pr && c.state === "ready" ? h("button", { class: "btn ghost", onclick: () => act("ci") }, icon("refresh", "ic sm"), T("Refresh CI", "更新 CI")) : null,
      c.state === "ready" ? h("button", { class: "btn primary", disabled: !!repo?.github && !c.pr, onclick: () => modal(T("Merge this change?", "合併這個變更？"), h("p", {}, repo?.github ? T(`Squash-merges PR #${c.pr?.number} on ${repo.github} at ${c.commit?.slice(0, 8)}.`, `在 ${repo.github} 以 squash 合併 PR #${c.pr?.number}（${c.commit?.slice(0, 8)}）。`) : T(`Fast-forwards ${c.base} in ${repo?.path} to ${c.commit?.slice(0, 8)}.`, `把 ${repo?.path} 的 ${c.base} fast-forward 到 ${c.commit?.slice(0, 8)}。`)),
        async (close) => { close(); await act("merge"); }) }, icon("check", "ic sm"), T("Merge", "合併")) : null,
      ["ready", "fallback", "draft", "error"].includes(c.state) ? h("button", { class: "btn ghost", onclick: () => act("close") }, T("Close", "關閉")) : null));
}
function addRepo() {
  const path = h("input", { placeholder: "/Users/you/code/project", "aria-label": T("Path", "路徑") }), name = h("input", { placeholder: T("optional", "可留空"), "aria-label": T("Name", "名稱") });
  const ghI = h("input", { placeholder: "owner/name", "aria-label": "GitHub" });
  modal(T("Add a repository", "新增 repository"), h("div", { class: "form" },
    h("p", { class: "faint" }, T("A local clone. Studio writes branches only through recipes, in a temporary worktree; it never touches your working tree unless you merge.", "本地的 clone。Studio 只透過 recipe、在暫時的 worktree 裡寫 branch；除非你按合併，不會動你的工作目錄。")),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Absolute path", "絕對路徑")), path), h("label", { class: "field" }, h("span", { class: "lbl" }, T("Name", "名稱")), name),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("GitHub repository (optional: PRs and merges go through its REST API)", "GitHub repository（可留空：PR 與合併走它的 REST API）")), ghI)),
    async (close, btn) => { btn.disabled = true; const r = await api("/api/lane/repos", { path: path.value.trim(), name: name.value.trim() || undefined, github: ghI.value.trim() || null }); btn.disabled = false; if (r.error) return toast(r.error); close(); loadLane(); });
}

Object.assign(routes, { library: viewLibrary3, artifact: viewArtifact, review: viewReview, compare: viewCompare, changes: viewChanges });
{
  const b = h("button", { class: "nav-item", "data-view": "changes", "data-tip": T("Changes", "變更") }, icon("branch"), h("span", { class: "nl" }, T("Changes", "變更")), h("span", { class: "count attn", id: "navChanges", hidden: true }));
  $('.nav-item[data-view="library"]').after(b); b.addEventListener("click", () => { location.hash = "#/changes"; });
  // the library nav item stays current on artifact, review and compare pages
  const mark = () => { const n = S.route?.name; if (["artifact", "review", "compare"].includes(n)) $('.nav-item[data-view="library"]')?.setAttribute("aria-current", "page"); };
  addEventListener("hashchange", () => setTimeout(mark, 0)); setTimeout(mark, 0);
  if (/^#\/(changes|artifact|review|compare|library)/.test(location.hash)) route();
}
loadList(); loadLane(); loadChat();
})();
