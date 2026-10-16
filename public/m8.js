// M8 documents: #/docs (every document, new from Markdown or drafted by the
// writer) and #/doc/<id> (the rendered document, its versions, the approval
// gates, and export to Markdown, HTML, Word and PDF). Annotating, revising and
// comparing reuse the M3 review pages (#/review, #/compare).
(() => {
const D = { ov: null, det: new Map() };
const VS = { "in-review": ["run", () => T("In review", "審查中")], approved: ["ok", () => T("Approved", "已核准")], superseded: ["", () => T("Superseded", "已取代")], draft: ["", () => T("Draft", "草稿")] };
const vb = (s) => { const [c, l] = VS[s] || VS.draft; return X.pill(c, l()); };
const by = (m) => !m ? "—" : m.kind === "agent" ? `${T("writer", "writer")} · ${m.provider}` : m.kind === "captain" ? T("captain", "船長") : T("imported", "匯入");
const load = async () => { D.ov = await X.get("/api/docs"); X.refresh(["docs"]); };
const loadDet = async (id) => { const [a, docs] = await Promise.all([X.get(`/api/artifacts/${encodeURIComponent(id)}`), X.get("/api/docs")]);
  const last = a.versions?.at(-1); const gates = last ? await X.getList(`/api/docs/${id}/v/${last.n}/gates`) : [];
  D.det.set(id, { ...a, gates, meta: docs.docs?.find((d) => d.id === id), at: Date.now() }); X.refresh(["doc"]); };
window.onExt.push((t, d) => { if (t === "agent" && d.ref?.startsWith("doc:")) load(); });
const prevM3 = window.onM3; window.onM3 = (t, d) => { prevM3?.(t, d); if (t === "artifacts" || t === "run") { load(); if (S.route?.name === "doc") loadDet(S.route.arg); } };

function newDoc() {
  const id = h("input", { placeholder: "offsite-plan", "aria-label": "id" }), title = h("input", { placeholder: T("Offsite plan", "外出規劃"), "aria-label": T("Title", "標題") });
  const mode = { v: "draft" };
  const prompt = h("textarea", { rows: 4, placeholder: T("What is the document for? The writer drafts it.", "這份文件是做什麼的？由 writer 起草。"), "aria-label": T("Prompt", "說明") });
  const md = h("textarea", { rows: 8, placeholder: "# Title\n\nYour Markdown…", "aria-label": "Markdown", hidden: true });
  const seg = h("div", { class: "seg", role: "group" }, [["draft", "Draft with the writer", "請 writer 起草"], ["md", "Paste Markdown", "貼上 Markdown"]].map(([v, en, tw]) => h("button", { type: "button", "aria-pressed": String(v === "draft"),
    onclick: (e) => { mode.v = v; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); prompt.hidden = v !== "draft"; md.hidden = v !== "md"; } }, h("span", {}, T(en, tw)))));
  modal(T("New document", "新文件"), h("div", { class: "form" }, h("label", { class: "field" }, h("span", { class: "lbl" }, T("Title", "標題")), title),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Id (lowercase, dashes)", "代號（小寫、連字號）")), id), seg, prompt, md),
    async (close, btn) => { const t = title.value.trim(); const i = id.value.trim() || t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      btn.disabled = true; const r = await X.post("/api/docs", mode.v === "draft" ? { id: i, title: t, prompt: prompt.value } : { id: i, title: t, md: md.value }); btn.disabled = false;
      if (r.error) return toast(r.error); close(); load(); if (mode.v === "md") location.hash = `#/doc/${i}`; });
  $(".modal .btn.primary").textContent = T("Create", "建立");
}
function viewDocs() {
  if (!D.ov) { load(); return X.loading(); }
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Documents", "文件")),
      h("p", {}, T("Draft, pin notes on paragraphs, let the writer revise (each revision is a new version), approve once no note is open, export as Markdown, HTML, Word or PDF.", "起草、在段落上加標註、讓 writer 修改（每次修改都是新版本）、沒有未解決的標註時核准，再匯出成 Markdown、HTML、Word 或 PDF。"))),
      h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: newDoc }, icon("plus", "ic sm"), T("New document", "新文件")))),
    D.ov.drafts.length ? h("div", { class: "x-stack" }, D.ov.drafts.map((d) => h("div", { class: "card x-pad x-row wrap" }, d.status === "failed" ? X.pill("bad", T("Draft failed", "起草失敗")) : X.pill("run", T("Writer drafting…", "writer 起草中…")), h("b", {}, d.title), d.error ? h("span", { class: "faint" }, d.error) : null))) : null,
    D.ov.docs.length ? h("div", { class: "x-grid" }, D.ov.docs.map((a) => { const last = a.versions.at(-1);
      return h("a", { class: "card x-prop", href: `#/doc/${a.id}`, "data-doc": a.id }, h("div", { class: "x-row wrap" }, vb(last?.status), h("b", {}, a.title), h("span", { class: "vbadge" }, `v${last?.n}`), h("span", { class: "x-grow" }), h("span", { class: "faint" }, ago(last?.createdAt))),
        h("div", { class: "run-s", style: "font-size:12.5px" }, h("span", {}, T(`${a.words} words`, `${a.words} 字`)), a.openNotes ? h("span", {}, T(`${a.openNotes} open notes`, `${a.openNotes} 個未解決標註`)) : h("span", { class: "faint" }, T("no open note", "沒有未解決標註")), h("span", {}, by(last?.createdBy)))); }))
      : h("div", { class: "card" }, h("div", { class: "empty" }, icon("doc"), h("b", {}, T("No document yet", "還沒有文件")), T("Start one: the writer drafts it from a sentence, or paste Markdown.", "新增一份：writer 會依一句話起草，或貼上 Markdown。"))));
}
function viewDoc(id) {
  const d = D.det.get(id);
  if (!d) { loadDet(id); return X.loading(); }
  if (d.error || !d.artifact) return X.notFound("No such document", "沒有這份文件");
  const a = d.artifact, last = d.versions.at(-1), prev = d.versions.at(-2);
  const open = last.notes.filter((x) => x.status === "open").length;
  const bad = d.gates.filter((g) => g.state === "fail");
  const exp = (f, label) => h("a", { class: "btn", href: `/api/docs/${a.id}/v/${last.n}/export?format=${f}`, download: "" }, icon("download", "ic sm"), label);
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, h("a", { href: "#/docs", class: "a3-back" }, T("Documents", "文件")), " · ", a.title),
      h("p", { class: "run-s", style: "font-size:13px" }, vb(last.status), h("span", { class: "vbadge" }, `v${last.n}`), h("span", {}, by(last.createdBy)), open ? h("span", {}, T(`${open} open notes`, `${open} 個未解決標註`)) : null, h("span", { class: "faint" }, ago(last.createdAt)))),
      h("div", { class: "actions x-wrap" }, h("a", { class: "btn primary", href: `#/review/${a.id}/${last.n}` }, icon("pin", "ic sm"), T("Annotate", "加標註")),
        prev ? h("a", { class: "btn", href: `#/compare/${a.id}/${prev.n}/${last.n}` }, icon("copy", "ic sm"), T(`Compare v${prev.n} ↔ v${last.n}`, `比較 v${prev.n} ↔ v${last.n}`)) : null,
        // a startup competition write-up is accepted only on its Task's accept card
        a.project === "startup-recursion" || /^startup-r-\d+$/.test(a.id) ? (last.createdBy?.run ? h("a", { class: "btn", href: `#/run/${encodeURIComponent(last.createdBy.run)}`, "data-startup-accept-card": "" }, T("Accept on the Task's card", "到任務的驗收卡驗收")) : null) :
        last.status === "in-review" ? h("button", { class: "btn", disabled: !!bad.length, title: bad.map((g) => g.detail).join("; "), onclick: async () => { const r = await X.post(`/api/docs/${a.id}/v/${last.n}/approve`); if (r.error) return toast(r.error); toast(T(`v${last.n} approved`, `v${last.n} 已核准`)); loadDet(a.id); } }, icon("check", "ic sm"), T("Approve", "核准")) : null)),
    h("ul", { class: "card x-pad x-gates" }, d.gates.map((g) => h("li", {}, h("span", { class: `x-gk ${g.state === "pass" ? "ok" : "bad"}` }, g.state === "pass" ? "✓" : "✗"), h("span", {}, g.label), h("span", { class: "faint" }, g.detail)))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Export", "匯出")), h("span", { class: "faint" }, T("written by Studio, no external tool", "由 Studio 產生，不需外部工具"))),
      h("div", { class: "x-row wrap" }, exp("md", "Markdown"), exp("html", "HTML"), exp("docx", "Word (.docx)"), exp("pdf", "PDF"),
        d.meta?.pdfLatinOnly ? h("span", { class: "faint", style: "font-size:12.5px" }, T("PDF uses built-in fonts: non-Latin text shows as “?”. Use HTML and print to PDF instead.", "PDF 用內建字型：非拉丁文字會變成「?」。請改用 HTML 再列印成 PDF。")) : null)),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T(`v${last.n}`, `v${last.n}`))),
      h("div", { class: "card", style: "overflow:hidden" }, h("iframe", { class: "x-docframe", src: `/af/${a.id}/${last.n}/doc.html`, sandbox: "", title: a.title }))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Versions", "版本"))), h("div", { class: "card", style: "display:grid" }, [...d.versions].reverse().map((v) => h("div", { class: "lib-row" },
      h("div", { class: "run-s" }, h("b", {}, `v${v.n}`), vb(v.status), h("span", {}, by(v.createdBy)), v.annotations?.length ? h("span", {}, T(`for ${v.annotations.join(", ")}`, `處理 ${v.annotations.join(", ")}`)) : null,
        v.notes.length ? h("span", { class: "faint" }, T(`${v.notes.length} notes`, `${v.notes.length} 個標註`)) : null, h("a", { href: `#/review/${a.id}/${v.n}` }, T("Review", "審查")), h("span", { class: "faint" }, ago(v.createdAt))))))));
}
Object.assign(routes, { docs: viewDocs, doc: viewDoc });
// coming back to a document refreshes it behind the current view
addEventListener("hashchange", () => { const m = /^#\/doc\/([^/]+)/.exec(location.hash); if (m && D.det.has(decodeURIComponent(m[1]))) loadDet(decodeURIComponent(m[1])); });
X.nav("docs", "doc", "Documents", "文件", "library");
X.own("docs", "doc");
X.reroute(/^#\/(docs|doc)(\/|$)/);
load();
})();
