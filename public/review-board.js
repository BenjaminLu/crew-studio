// The lesson board (docs/units/review-room.md, "The lesson board"; public/review-room.js builds it with its own helpers).
// A finished lesson is a canvas the camera owns: each chapter a region laid out in rows, panned by dragging (or Space and
// drag), zoomed with the wheel, a pinch or ± (the viewport never scrolls itself), three levels of detail by scale: far a
// map (each chapter's number, title, one line and its question counts), mid, near the whole chapter. "Next" walks the
// chapters, flying the camera to each at a readable scale; a chapter not reached yet is a placeholder. Every sentence, a
// drawing's node, edge or transition, a transaction or call row and a risk is a place to ask: a question is a paid turn of
// the room (asked, then confirmed in its own card), its answer a card branching beside that place with numbered pins on it;
// a deeper answer goes below, an example beside, a rephrasing is a version tab of the same card. Show the code is free.
// Understood questions fold into a chip, and "tidy the board" folds them into their chapter's text (before / after shows
// the original); the notes panel and the last region list every question. Model text only ever goes into text nodes.
(() => {
window.crewReviewBoard = (D) => {
const { RR, clip, plain, inline, inferenceBadge, reviewerBadge, openCite, postJ, api, enc, rerender, redraw, onRoom, chapterName, reportFigure, diffPre, localTurn, roomLang, autoNote, reduceMotion, uiLang, POINTS_TONE, schedule, githubDiffUrl } = D;
// the board's own state, per room: the camera, what it is locked on, the regions read, the popover, a question waiting for
// its confirmation, the thread in focus, the filters, the open sheet (a phone), the last layout
const B = { cam: new Map(), lock: new Map(), cur: new Map(), visited: new Map(), pop: null, pend: new Map(), focus: new Map(), only: new Set(), before: new Set(), peek: new Set(), sheet: new Map(), ver: new Map(),
  viewer: null, shown: new Map(), code: new Map(), L: new Map(), tween: null, drag: null, space: false, moved: false, toast: null, reveal: new Map(), err: new Map(), busy: new Set(), lod: new Map(), focusKey: new Map(), notes: new Set(), lastScene: new Map(), quiet: false, consent: new Map(), figs: new Map(), lastLayout: 0 };
const phone = () => innerWidth <= 760;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LOD = (s) => (s < 0.42 ? "far" : s < 0.7 ? "mid" : "near");
const CHIP = { deeper: ["Deeper ↓", "更深 ↓"], example: ["Example →", "例子 →"], rephrase: ["Say it another way", "換個說法"], why: ["Why", "為什麼"], code: ["Show the code", "看程式碼"], free: ["Ask", "問"] };
const chipName = (c) => T(...(CHIP[c] || [c, c]));
/** the popover's chips, as the prototype words them (我不懂這句 asks for another way and marks the question 還沒懂) */
const POP = [["deeper", "More detail", "詳細一點"], ["example", "An example", "舉個例子"], ["why", "Why this way", "為什麼這樣做"], ["code", "Show the code", "看程式碼"], ["rephrase", "I don't get this", "我不懂這句"]];
/** the cards' follow-ups */
const FOLLOW = ["deeper", "example", "rephrase"];
/** 還沒懂: the reader said so (我不懂這句, 換個說法 or 還沒懂) and has not said 懂了 since (src/domain/review-room.ts notUnderstood) */
const confusedOf = (t) => !!t.confused && t.state === "open";
/** this page cannot start a paid round: a paired phone, as the server says who is looking (a narrow window on the Mac is not one) */
const phoneSession = () => B.viewer ? B.viewer === "phone" : !!window.crewRemote?.token?.();
// who is looking, as the server says (GET /api/remote/me: a paired phone or this Mac)
fetch("/api/remote/me").then((x) => x.json()).then((m) => { if (m?.kind === "phone" || m?.kind === "desktop") { B.viewer = m.kind; rerender(); } }).catch(() => {});
const deskNote = () => h("p", { class: "rb-popnote", "data-ask-desktop": "" }, T("Ask on the desktop: a phone reads the room.", "在電腦上問：手機只能閱讀。"));
/** an anchor's stable key, as Studio keeps it (src/domain/review-room.ts anchorKey) */
const akey = (chapter, scene, kind, item, part) => `${chapter}/${scene}/${kind}${item ? `/${item}` : ""}${part ? `#${part}` : ""}`;
const kindLabel = { sentence: ["a sentence", "一句話"], risk: ["a risk", "風險"], node: ["a box of the drawing", "圖上的框"], edge: ["a line of the drawing", "圖上的線"], transition: ["a transition", "狀態轉換"], tx: ["a field the transaction writes", "交易寫入的欄位"], field: ["a field of the call", "呼叫的欄位"], call: ["a call", "呼叫"], row: ["a row", "一列"] };

// ---------- a lesson's places: sentences, a drawing's parts, rows ----------
/** a point's text as sentences, each with where it starts and ends; a citation stays with the sentence it closes */
function splitS(t) {
  const out = []; let at = 0;
  for (const piece of String(t).split(/(?<=[。！？])|(?<=[.!?])\s+(?=[^\s[])/)) {
    let i = t.indexOf(piece, at); if (i < 0) i = at; at = i + piece.length;
    const lead = out.length ? /^\s*(?:\[[a-z]+:[^\]\s]+\]\s*)+/i.exec(piece) : null; let s0 = i;
    if (lead) { const prev = out[out.length - 1]; prev.end = i + lead[0].trimEnd().length; prev.s = t.slice(prev.start, prev.end); s0 = i + lead[0].length; }
    const s = t.slice(s0, at); if (s.trim()) out.push({ start: s0 + (s.length - s.trimStart().length), end: at, s: s.trim() });
  }
  return out.length ? out : [{ s: String(t), start: 0, end: String(t).length }];
}
const okRefs = (cites, text) => { const ok = (cites || []).filter((c) => c && c.ok !== false && c.ref); const inIt = text ? ok.filter((c) => text.includes(`[${c.ref}]`)) : []; return [...new Set((inIt.length ? inIt : ok).map((c) => c.ref))].slice(0, 4); };
/** an element made a place to ask about: what Studio keeps of it (its key, kind, drawing, part, words and offsets) */
function place(el, x, kind, item, part0, text, refs, start, end) {
  const part = part0 == null ? null : String(part0).replace(/[^\w.:>#-]/g, "_").slice(0, 140), key = akey(x.chapter, x.key, kind, item, part);
  for (const [k, v] of Object.entries({ "data-akey": key, "data-ascene": x.key, "data-akind": kind, "data-aitem": item, "data-apart": part, "data-atext": clip(String(text || "").replace(/\s+/g, " ").trim(), 300), "data-arefs": (refs || []).join(" "), "data-astart": start, "data-aend": end }))
    if (v != null && v !== "") el.setAttribute(k, String(v));
  el.setAttribute("tabindex", "0"); el.classList.add("rb-ann");
  if (el instanceof SVGElement || !/^(SPAN|P|LI)$/.test(el.tagName)) { el.setAttribute("role", "button"); el.setAttribute("aria-haspopup", "dialog"); }
  el.setAttribute("aria-label", T(`Ask about ${kindLabel[kind][0]}: ${clip(text, 80)}`, `問${kindLabel[kind][1]}：${clip(text, 80)}`));
  return el;
}
/** a point as sentences, each a place to ask about (a risk in "what to watch"), its pins inline */
function sentences(card, x, p, m, kind, ctx) {
  const badge = p.basis === "inference" ? inferenceBadge() : p.basis === "reviewer" ? reviewerBadge() : null;
  const text = (p.basis === "inference" ? p.text.replace(/\s*\[(inference|inferred|speculative)\]/gi, "") : p.text).replace(/^\s*[-*+]\s+/, "");
  const out = badge ? [badge] : [];
  splitS(text).forEach((q, k) => { const part = `p${m}.s${k}`, key = akey(x.chapter, x.key, kind, null, part);
    if (k) out.push(" ");
    out.push(place(h("span", { class: "rb-s" }, inline(card, q.s, p.cites), pinsOf(card, ctx, key)), x, kind, null, part, plain(q.s), okRefs(p.cites, q.s), q.start, q.end)); });
  return out;
}
/** the numbered pins on a place: one per question asked there, coloured by its state */
function pinsOf(card, ctx, key) {
  return ctx.threads.filter((t) => t.key === key).map((t) => h("button", { type: "button", class: `rb-pin ${pinCls(card, t)}`, "data-pin": t.n, "data-pin-for": key, tabindex: -1, "aria-label": T(`Question ${t.n}`, `問題 ${t.n}`), onclick: (e) => { e.stopPropagation(); focusThread(card, t.n); } }, String(t.n)));
}
const pinCls = (card, t) => (t.merged && !B.before.has(card) ? "mg" : t.state === "resolved" ? "done" : confusedOf(t) ? "q" : "a");
/** a drawing's parts made places: a node, an edge's chip, a transition (its chip and its row), a transaction's field, a
 *  call and its fields, a turned-down option, a box of a before / after figure, a step of a sequence */
function decorate(fig, x, it, ctx) {
  const lab = new Map((it.states || []).map((s) => [s.id, s.label || s.id])), trText = (i) => { const t = (it.transitions || [])[i]; return t ? `${lab.get(t.from) ?? t.from} → ${lab.get(t.to) ?? t.to}${t.label ? ` · ${t.label}` : ""}` : ""; };
  const trRefs = (i) => okRefs([(it.transitions || [])[i]?.cite]), its = okRefs(it.cites);
  const svgEdge = (e) => (it.transitions || []).findIndex((t) => t.edge === e);
  for (const el of fig.querySelectorAll("[data-elabel]")) { const n = el.getAttribute("data-edge-n"), e = el.getAttribute("data-elabel");
    if (it.type === "states" && n != null) place(el, x, "transition", it.id, `transition:${n}`, trText(Number(n)), trRefs(Number(n)));
    else place(el, x, "edge", it.id, `edge:${e}`, el.textContent || e, its); }
  if (it.type === "svg") for (const el of fig.querySelectorAll("svg [data-edge]")) { const e = el.getAttribute("data-edge"), k = svgEdge(e);
    place(el, x, k >= 0 ? "transition" : "edge", it.id, k >= 0 ? `transition:${k}` : `edge:${e}`, k >= 0 ? `${e.replace(">", " → ")}${it.transitions[k].label ? ` · ${it.transitions[k].label}` : ""}` : e.replace(">", " → "), k >= 0 ? trRefs(k) : its); }
  for (const el of fig.querySelectorAll("svg [data-node]")) { const id = el.getAttribute("data-node"); place(el, x, "node", it.id, `node:${id}`, (el.textContent || "").replace(/\s+/g, " ").trim() || id, its); }
  for (const el of fig.querySelectorAll("[data-transition]")) { const i = Number(el.getAttribute("data-transition")); place(el, x, "transition", it.id, `transition:${i}`, trText(i), trRefs(i)); }
  const sel = fig.querySelector("[data-tx-panel]")?.getAttribute("data-tx-panel");
  fig.querySelectorAll("[data-tx-panel] [data-tx-table]").forEach((tb, ti) => tb.querySelectorAll(".rp-fields tr").forEach((tr, fi) => place(tr, x, "tx", it.id, `tx:${sel}.${ti}.${fi}`, `${tb.getAttribute("data-tx-table")}.${tr.textContent.replace(/\s+/g, " ").trim()}`, trRefs(Number(sel)))));
  fig.querySelectorAll("[data-call]").forEach((sec) => { const i = Number(sec.getAttribute("data-call")), refs = okRefs([(it.calls || [])[i]?.cite]);
    const hd = sec.querySelector("header"); if (hd) place(hd, x, "call", it.id, `c${i}`, hd.textContent.replace(/\s+/g, " ").trim(), refs);
    for (const part of ["request", "response"]) sec.querySelectorAll(`[data-call-part="${part}"] .rp-kv tr`).forEach((tr, j) => place(tr, x, "field", it.id, `c${i}.${part}.${j}`, `${part}: ${tr.textContent.replace(/\s+/g, " ").trim()}`, refs));
    sec.querySelectorAll(".rp-errs li").forEach((li, j) => place(li, x, "field", it.id, `c${i}.error.${j}`, li.textContent.replace(/\s+/g, " ").trim(), refs));
    sec.querySelectorAll("[data-call-part=\"transaction\"] [data-tx-table]").forEach((tb, ti) => tb.querySelectorAll(".rp-fields tr").forEach((tr, fi) => place(tr, x, "tx", it.id, `c${i}.tx.${ti}.${fi}`, `${tb.getAttribute("data-tx-table")}.${tr.textContent.replace(/\s+/g, " ").trim()}`, refs))); });
  fig.querySelectorAll("[data-rejected-option]").forEach((li) => place(li, x, "row", it.id, `rej:${li.getAttribute("data-rejected-option")}`, li.textContent.replace(/\s+/g, " ").trim(), okRefs([(it.rejected || [])[Number(li.getAttribute("data-rejected-option"))]?.cite])));
  fig.querySelectorAll(".rr-itemfig .rr-ib").forEach((g, i) => place(g, x, "node", it.id, `box:${i}`, (g.textContent || "").replace(/\s+/g, " ").trim(), its));
  fig.querySelectorAll("svg [data-step]").forEach((g) => place(g, x, "edge", it.id, `step:${g.getAttribute("data-step")}`, (g.textContent || "").replace(/\s+/g, " ").trim(), its));
}

// ---------- the board's parts ----------
/** a region's width on the canvas: a text chapter reads in a column, a drawing gets more room; a phone one narrow column */
const widthOf = (x) => (phone() ? 340 : x.pic && !x.skip ? (["states", "arch", "sequence", "svg", "calls", "mermaid"].includes(x.pic.type) ? 760 : 660) : 540);
function regionEl(card, r, x, j, nth, ctx) {
  const key = x.key, ch = x.chapter, tone = POINTS_TONE[ch], seen = ctx.visited.has(key), ths = ctx.threads.filter((t) => t.anchor.scene === key);
  const open = ths.filter(confusedOf).length, done = ths.filter((t) => t.state === "resolved" || t.merged).length, cards = ths.reduce((n, t) => n + t.nodes.length, 0), W = widthOf(x);
  const head = h("div", { class: "rp-head" }, h("span", { class: "rp-num" }, String(j + 1).padStart(2, "0")),
    h("h3", {}, chapterName(ch), ch === "decisions" ? h("span", { class: "rp-of" }, ` · ${T(`Choice ${nth}`, `決定 ${nth}`)}`) : null), h("p", { class: "rp-sub", "data-section-title": "" }, x.title));
  const sent = (p, m) => sentences(card, x, p, m, ch === "watch" ? "risk" : "sentence", ctx);
  const body = x.skip ? h("p", { class: "rp-skip", "data-skip": ch }, h("span", { class: "rp-skip-k" }, T("Not drawn here", "這一章沒有畫")), " ", ...sent(x.points[0] || { text: "", cites: [] }, 0))
    : tone ? h("ul", { class: "rp-points", "data-points-chapter": ch }, x.points.map((p, m) => h("li", { class: tone[0] }, h("span", { class: "rp-tag" }, T(...tone[1])), h("div", {}, ...sent(p, m)),
      // a risk has its own 問 (as the prototype's): it asks about the risk's first sentence
      ch === "watch" ? h("button", { type: "button", class: "rb-askbtn", "data-ask-risk": m, "aria-label": T("Ask about this risk", "問這個風險"), onclick: (e) => { e.stopPropagation(); const a = e.currentTarget.closest("li")?.querySelector("[data-akey]"); if (a) openPop(card, a); } }, T("Ask", "問")) : null)))
    : h("div", { class: `rp-prose${ch === "what" ? " lead" : ""}` }, x.points.map((p, m) => h("p", { class: m === 0 && ch === "what" ? "lead" : "" }, ...sent(p, m))));
  // what tidying folded in: a gist of the answers to the questions asked here, marked as such (hidden to see the original)
  const merged = ths.filter((t) => t.merged).sort((a, b) => a.n - b.n);
  const absorbed = merged.length && !B.before.has(card) ? h("div", { class: "rb-absorbed", "data-absorbed": merged.map((t) => t.n).join(",") },
    h("div", { class: "rb-abs-tag" }, T(`↳ Folded in from your questions ${merged.map((t) => `#${t.n}`).join(", ")}`, `↳ 併入你問的 ${merged.map((t) => `#${t.n}`).join("、")}`)),
    merged.map((t) => h("p", { "data-absorbed-thread": t.n }, h("ins", { class: "rb-abs" }, inline(card, t.merged.gist, t.merged.cites))))) : null;
  let fig = null; if (x.pic && !x.skip) { const fk = `${card}/${x.pic.id}/${roomLang(r)}/${uiLang()}/${RR.tsel.get(`${card}/${x.pic.id}`) ?? 0}/${W}/${Object.keys(r.translations || {}).map((l) => `${l}:${Object.keys(r.translations[l]).length}`).join(",")}`;
    fig = B.figs.get(fk); if (!fig) { fig = reportFigure(card, r, x.pic, phone() ? { narrow: true, w: W - 30, h: 1400 } : { w: W - 40, h: 620 }); decorate(fig, x, x.pic, ctx); if (B.figs.size > 400) B.figs.clear(); B.figs.set(fk, fig); } }
  const gist = plain(x.points[0]?.text || x.title || "");
  return h("section", { class: `rb-region${seen ? "" : " unvisited"}${ths.length ? " hasq" : ""}${ctx.cur === key ? " cur" : ""}`, "data-region": key, "data-report-section": key, "data-chapter": ch, "data-open": open, "data-done": done, id: `rp-${card}-${key}`, "aria-label": `${String(j + 1).padStart(2, "0")} ${chapterName(ch)}` },
    h("div", { class: "rb-rtitle" }, h("b", {}, String(j + 1).padStart(2, "0")), h("span", {}, chapterName(ch)), ths.length ? h("span", { class: "rb-cnt" }, T(`${cards} asked`, `問 ${cards}`), open ? h("i", {}, T(` · ${open} not understood`, ` · 未解 ${open}`)) : null) : null),
    h("div", { class: "rb-rbody", style: `width:${W}px` }, h("div", { class: "rp-card" }, head, body, absorbed), fig,
      // far away: only the chapter's number, its title, one line and its questions
      h("div", { class: "rb-map", "data-map": key, "aria-hidden": "true" }, h("div", { class: "rb-mn" }, String(j + 1).padStart(2, "0")), h("div", { class: "rb-mt" }, chapterName(ch)), h("div", { class: "rb-mg", "data-map-gist": "" }, gist),
        h("div", { class: "rb-mq" }, h("span", { class: "rb-badge q", "data-map-open": open }, T(`${open} not understood`, `未解 ${open}`)), h("span", { class: "rb-badge ok", "data-map-done": done }, T(`${done} understood`, `懂了 ${done}`)))),
      seen ? null : h("button", { type: "button", class: "rb-ph", "data-placeholder": key, onclick: (e) => { e.stopPropagation(); flyTo(card, key); } }, h("b", {}, `${String(j + 1).padStart(2, "0")} · ${chapterName(ch)}`), h("span", {}, T("Not covered yet · press “Next” or pick it in the outline", "還沒講到 · 按「下一段」或點左側章節")))),
    h("div", { class: "rb-tlayer", "data-tlayer": key }, seen ? ths.flatMap((t) => threadEls(card, r, t, ctx)) : null, seen ? pendingEls(card, r, key, ctx) : null));
}
/** the last region: the questions asked on the way */
function endRegion(card, r, n, ctx) {
  const list = [...ctx.threads].sort((a, b) => a.n - b.n), open = list.filter(confusedOf).length, seen = ctx.visited.has("end");
  return h("section", { class: `rb-region rb-end${seen ? "" : " unvisited"}${ctx.cur === "end" ? " cur" : ""}`, "data-region": "end", "data-chapter": "end", "aria-label": T("Your questions", "你的問題") },
    h("div", { class: "rb-rtitle" }, h("b", {}, String(n).padStart(2, "0")), h("span", {}, T("Your questions", "你的問題"))),
    h("div", { class: "rb-rbody", style: `width:${phone() ? 340 : 600}px` },
      h("div", { class: "rp-card" }, h("div", { class: "rp-head" }, h("span", { class: "rp-num" }, String(n).padStart(2, "0")), h("h3", {}, T("Your questions", "你的問題")), h("p", { class: "rp-sub" }, T("What you asked along the way", "你在途中問的"))),
        list.length ? [h("p", { class: "rb-end-n", "data-end-count": list.length }, T(`You asked about ${list.length} place${list.length === 1 ? "" : "s"}; ${open} not understood yet.`, `你在途中問了 ${list.length} 處；還有 ${open} 處沒懂。`)), notesList(card, list, "end")]
          : h("p", { class: "faint" }, T("No question yet. Click any sentence, a box, line or transition of a drawing, or a row, and ask there.", "還沒有問題。點任何一句、圖上的框、線或轉換，或一列欄位，就在那裡問。"))),
      h("div", { class: "rb-map", "aria-hidden": "true" }, h("div", { class: "rb-mn" }, String(n).padStart(2, "0")), h("div", { class: "rb-mt" }, T("Your questions", "你的問題")), h("div", { class: "rb-mg", "data-map-gist": "" }, T(`${list.length} asked along the way`, `途中問了 ${list.length} 處`)),
        h("div", { class: "rb-mq" }, h("span", { class: "rb-badge q" }, T(`${open} not understood`, `未解 ${open}`)), h("span", { class: "rb-badge ok" }, T(`${list.filter((t) => t.state === "resolved" || t.merged).length} understood`, `懂了 ${list.filter((t) => t.state === "resolved" || t.merged).length}`)))),
      seen ? null : h("button", { type: "button", class: "rb-ph", "data-placeholder": "end", onclick: (e) => { e.stopPropagation(); flyTo(card, "end"); } }, h("b", {}, T("Your questions", "你的問題")), h("span", {}, T("Not covered yet", "還沒講到")))),
    h("div", { class: "rb-tlayer" }));
}
/** the notes: every question, its place, how many cards and its state; a click focuses it */
function notesList(card, list, where) {
  const R = B.L.get(card)?.names || {};
  return h("ol", { class: "rb-nlist", "data-notes-list": where }, list.map((t) => { const cf = confusedOf(t), st = t.merged ? T("folded in", "已併入") : t.state === "resolved" ? T("understood", "懂了") : cf ? T("not understood", "還沒懂") : T("answered", "已回答");
    return h("li", {}, h("button", { type: "button", class: "rb-nitem", "data-note-thread": t.n, "data-note-state": t.merged ? "merged" : t.state === "resolved" ? "resolved" : cf ? "confused" : "answered", onclick: () => focusThread(card, t.n) },
      h("span", { class: `rb-pin ${pinCls(card, t)}` }, String(t.n)), h("q", {}, t.anchor.text), h("small", {}, `${R[t.anchor.scene] || chapterName(t.anchor.chapter)} · ${T(`${t.nodes.length} card${t.nodes.length === 1 ? "" : "s"}`, `${t.nodes.length} 則`)} · `, h("b", { class: cf && !t.merged ? "open" : "" }, st)))); }));
}
/** a thread on the board: its cards, or (understood, or folded into its chapter) one small chip */
function chipMode(card, t) { const peek = B.peek.has(`${card}/${t.n}`) || B.focus.get(card)?.n === t.n; return (t.merged || t.state === "resolved") && !peek; }
function threadEls(card, r, t, ctx) {
  if (chipMode(card, t)) { const mg = t.merged && !B.before.has(card);
    return [h("button", { type: "button", class: `rb-tchip${mg ? " merged" : ""}`, "data-group": t.key, "data-tchip": t.n, "data-thread": t.n, onclick: (e) => { e.stopPropagation(); B.peek.add(`${card}/${t.n}`); B.reveal.set(card, `${t.n}`); rerender(); } },
      mg ? T(`Folded in #${t.n}`, `已併入 #${t.n}`) : T(`✓ #${t.n} understood`, `✓ #${t.n} 懂了`))]; }
  const out = t.nodes.map((nd) => cardEl(card, r, t, nd, ctx)), p = B.pend.get(card);
  if (p && p.n === t.n) out.push(pendingCard(card, r, p, t.key, p.rel === "version" ? p.node : p.node, ctx));
  return out;
}
/** a question asked on a place with no thread yet: its card waits for the confirmation at that place */
function pendingEls(card, r, scene, ctx) { const p = B.pend.get(card); return p && p.n == null && p.anchor?.scene === scene ? [pendingCard(card, r, p, p.key, null, ctx)] : []; }
function pendingCard(card, r, p, group, parent, ctx) {
  const o = r.offer, busy = r.running != null || B.busy.has(card), err = B.err.get(card), agree = B.consent.get(card) !== false;
  const label = p.chip === "free" ? T(`You ask: ${p.q}`, `你問：${p.q}`) : p.rel === "version" ? T("Say it another way (a new version)", "換個說法（新版本）") : popName(p.chip);
  return h("article", { class: "rb-card pending", "data-group": group, "data-tnode": "pending", "data-parent": parent ?? "", "data-rel": parent ? (p.rel === "side" ? "side" : "below") : "root", "data-thread": p.n ?? "new", "data-pending": "", role: "group", "aria-label": T("Confirm the paid round", "確認付費回合") },
    h("div", { class: "rb-ch" }, h("span", { class: "rb-pin q" }, p.n ?? "+"), h("span", { class: "rb-cq" }, label)),
    p.n == null ? h("q", { class: "rb-anchor" }, p.anchor.text) : null,
    h("div", { class: "rb-cbody" }, o?.error ? h("p", { class: "rr-err" }, o.error)
      : [h("p", { class: "rb-confirm", "data-board-confirm": "" }, T(`One paid round on ${o?.provider} · ${o?.model ?? "default model"}${o?.effort ? ` (${o.effort})` : ""}, no generated picture. The tutor only reads the code.`,
        `付費一回合：${o?.provider} · ${o?.model ?? "預設模型"}${o?.effort ? `（${o.effort}）` : ""}，不產生圖片。導師只讀程式碼。`)),
        r.followUps?.on && !r.followUps.current && (r.followUps.used ?? 0) >= (r.followUps.limit ?? 10) ? h("p", { class: "rb-confirm", "data-follow-limit": "" }, T(`${r.followUps.used} follow-ups started without asking: confirm once more to go on.`, `已直接追問 ${r.followUps.used} 次：再確認一次就繼續。`)) : null,
        h("label", { class: "rb-consent" }, h("input", { type: "checkbox", "data-board-consent": "", checked: agree, onchange: (e) => B.consent.set(card, e.target.checked) }), T(" Start the next questions right away (this room)", " 之後追問直接開始（這個房間）"))],
      busy && r.running != null ? h("p", { class: "faint" }, T("The tutor is working on another question; one turn at a time.", "導師正在回答另一個問題；一次一回合。")) : null,
      err ? h("p", { class: "rr-err", role: "alert", "data-board-error": "" }, err) : null),
    h("div", { class: "rb-acts" }, o?.error ? null : h("button", { type: "button", class: "rb-btn primary", "data-board-start": "", disabled: busy, onclick: (e) => { e.stopPropagation(); startPending(card); } }, T("Start the round", "開始這一回合")),
      h("button", { type: "button", class: "rb-btn", "data-board-cancel": "", onclick: (e) => { e.stopPropagation(); B.pend.delete(card); B.err.delete(card); rerender(); } }, T("Cancel", "取消"))));
}
/** one card: what was asked, the answer (its versions as tabs), being written ("Thinking"), a code card's excerpt; its
 *  follow-ups, understood and focus */
function cardEl(card, r, t, nd, ctx) {
  const root = nd.rel === "root", vk = `${card}/${t.n}/${nd.id}`, vi = Math.min(B.ver.get(vk) ?? nd.versions.length - 1, nd.versions.length - 1), tn = nd.versions[vi], turn = tn != null ? ctx.TN.get(tn) : null;
  const live = r.open && !r.snapshot, label = nd.code ? chipName("code") : nd.q ? T(`You asked: ${nd.q}`, `你問：${nd.q}`) : root ? popName(nd.chip) : chipName(nd.chip), focus = B.focus.get(card)?.n === t.n;
  let body;
  if (nd.code) body = codeBody(card, r, nd.code);
  else if (!turn) body = h("p", { class: "faint" }, T("(this answer is not in this room)", "（這個回答不在這個審查室裡）"));
  else if (turn.status === "running") { const pr = r.progress?.turn === turn.n ? r.progress : null; body = [h("p", { class: "rb-thinking", "data-thinking": turn.n }, T("Thinking", "思考中")), pr?.said ? h("p", { class: "rb-said", "data-streaming": turn.n }, clip(plain(pr.said), 400)) : null]; }
  else if (turn.status !== "done") body = h("p", { class: "rr-err", "data-card-failed": turn.status }, turn.status === "interrupted" ? T("Interrupted: Studio stopped during this turn.", "中斷：這一回合進行時 Studio 停止了。") : `${T("Failed", "失敗")}: ${turn.error || ""}`);
  else { const lt = localTurn(r, turn, roomLang(r)), claims = (lt.claims?.length ? lt.claims : [{ text: lt.answer || "", kind: "claim", basis: null, cites: [] }]).filter((c) => c.kind !== "heading");
    body = claims.map((c) => (c.kind === "code" || c.kind === "table") ? h("pre", { class: "rr-pre" }, c.text.replace(/^\s*```[^\n]*\n?|\n?\s*```\s*$/g, "")) : h("p", { class: "rb-ans" }, c.basis === "inference" ? inferenceBadge() : null, inline(card, c.text.replace(/^\s*[-*+]\s+/, "").replace(/\s*\[(inference|inferred|speculative)\]/gi, c.basis === "inference" ? "" : "$&"), c.cites))); }
  const acts = live && !nd.code && turn?.status !== "running" ? FOLLOW.map((c) => h("button", { type: "button", class: "rb-btn", "data-follow": c, disabled: B.pend.has(card) || phoneSession(), title: phoneSession() ? T("Ask on the desktop", "在電腦上問") : "", onclick: (e) => { e.stopPropagation(); ask(card, r, { n: t.n, node: nd.id, chip: c, rel: c === "example" ? "side" : c === "rephrase" ? "version" : "below", key: t.key }); } }, chipName(c))) : [];
  if (acts.length && phoneSession()) acts.push(deskNote());
  if (live && root) acts.push(t.state === "resolved" ? h("button", { type: "button", class: "rb-btn", "data-reopen": t.n, onclick: (e) => { e.stopPropagation(); lessonOp(card, { op: "resolve", n: t.n, on: false }); } }, T("Not yet", "還沒懂"))
    : h("button", { type: "button", class: "rb-btn ok", "data-resolve": t.n, onclick: (e) => { e.stopPropagation(); B.peek.delete(`${card}/${t.n}`); if (B.focus.get(card)?.n === t.n) unfocus(card); lessonOp(card, { op: "resolve", n: t.n }); } }, T("Got it ✓", "懂了 ✓")));
  if (root && (t.state === "resolved" || t.merged) && B.peek.has(`${card}/${t.n}`)) acts.push(h("button", { type: "button", class: "rb-btn", "data-fold": t.n, onclick: (e) => { e.stopPropagation(); B.peek.delete(`${card}/${t.n}`); rerender(); } }, T("Fold", "收起")));
  // the drawings and pictures this answer made (board_draw, a figure), with Studio's own renderers
  const figs = turn && turn.status === "done" ? (r.board || []).filter((b) => b.turn === turn.n).map((it) => { try { return reportFigure(card, r, it, { narrow: true, w: 260, h: 520 }); } catch { return null; } }) : [];
  const paid = turn && turn.model ? h("span", { class: "rb-paid", "data-paid-note": "", title: T("A paid round", "付費一回合") },
    turn.follow ? T(`follow-up ${turn.follow} started without asking · paid · ${turn.model}`, `已追問 ${turn.follow} 次 · 付費 · ${turn.model}`) : T(`paid · ${turn.model}`, `付費 · ${turn.model}`)) : null;
  return h("article", { class: `rb-card${root ? " root" : ""}${confusedOf(t) ? " q" : ""}${nd.versions.length > 1 ? " stack" : ""}${focus ? " lit" : ""}`, "data-group": t.key, "data-tcard": `${t.n}:${nd.id}`, "data-thread": t.n, "data-tnode": nd.id, "data-parent": nd.parent ?? "", "data-rel": nd.rel, "data-chip": nd.chip },
    h("div", { class: "rb-ch" }, h("span", { class: `rb-pin ${pinCls(card, t)}` }, String(t.n)), h("span", { class: "rb-cq", title: label }, label),
      nd.versions.length > 1 ? h("span", { class: "rb-tabs", role: "group", "aria-label": T("Versions", "版本") }, nd.versions.map((v, i) => h("button", { type: "button", "data-version-tab": i, "aria-pressed": String(i === vi), onclick: (e) => { e.stopPropagation(); B.ver.set(vk, i); rerender(); } }, String(i + 1))), h("em", {}, `/${nd.versions.length}`)) : null,
      root ? h("button", { type: "button", class: "rb-x", "data-focus-thread": t.n, title: T("Focus this thread (Esc returns)", "聚焦這串（Esc 返回）"), "aria-label": T(`Focus question ${t.n}`, `聚焦問題 ${t.n}`), onclick: (e) => { e.stopPropagation(); focusThread(card, t.n); } }, "⤢") : null),
    root ? h("q", { class: "rb-anchor", title: t.anchor.text }, t.anchor.text) : null,
    nd.versions.length > 1 && vi > 0 ? h("div", { class: "rb-alttag" }, T(`Said another way (${vi + 1}/${nd.versions.length})`, `換個說法（${vi + 1}/${nd.versions.length}）`)) : null,
    h("div", { class: "rb-cbody" }, body, figs.length ? h("div", { class: "rb-cfigs", "data-card-figures": figs.length }, figs) : null), acts.length || paid ? h("div", { class: "rb-acts" }, acts, paid) : null);
}
const popName = (c) => { const x = POP.find((y) => y[0] === c); return x ? T(x[1], x[2]) : chipName(c); };
/** a code card: what the place cites, read through Studio's citation viewer (free; a saved room from its snapshot) */
function codeBody(card, r, ref) {
  // a pull request on GitHub: its code is read there, at those lines (the room's citation opener), never fetched into Studio
  if (githubDiffUrl(r, ref)) return h("div", { class: "rb-coderef" }, h("code", {}, ref), h("button", { type: "button", class: "rb-btn", "data-open-cite": ref, onclick: (e) => { e.stopPropagation(); openCite(card, ref); } }, T("Open on GitHub", "在 GitHub 開啟")));
  const k = `${card}/${ref}`; let c = B.code.get(k);
  if (!c) { const snap = r.snapshot; if (snap) { const d = snap.cites?.[ref]; c = d && !d.error ? { data: d } : { error: T("Not in this snapshot", "這份存檔裡沒有") }; B.code.set(k, c); }
    else { c = { loading: true }; B.code.set(k, c); api(`/api/review-room/${enc(card)}/cite?ref=${enc(ref)}`).then((d) => B.code.set(k, { data: d })).catch((e) => B.code.set(k, { error: e.message })).finally(() => redraw(card)); } }
  const d = c.data;
  return [h("div", { class: "rb-coderef" }, h("code", {}, ref), h("button", { type: "button", class: "rb-btn", "data-open-cite": ref, onclick: (e) => { e.stopPropagation(); openCite(card, ref); } }, T("Open", "打開"))),
    c.loading ? h("p", { class: "faint" }, T("Loading…", "載入中…")) : c.error ? h("p", { class: "rr-err" }, c.error) : d?.kind === "diff" ? diffPre(String(d.text || "").split("\n").slice(0, 40).join("\n")) : d?.text ? h("pre", { class: "rr-pre" }, String(d.text).slice(0, 2000)) : h("p", { class: "faint" }, T("Open it to read it.", "打開來看。"))];
}

// ---------- asking: the popover, the question waiting for its confirmation, the free actions ----------
function anchorData(el) { const g = (k) => el.getAttribute(k); const num = (v) => (v == null || v === "" ? undefined : Number(v));
  return { scene: g("data-ascene"), kind: g("data-akind"), item: g("data-aitem") || undefined, part: g("data-apart") || undefined, text: g("data-atext") || "", start: num(g("data-astart")), end: num(g("data-aend")) }; }
function openPop(card, el, x, y) {
  if (!el || el.closest(".rb-region.unvisited")) return;
  const rect = el.getBoundingClientRect(), at = x == null ? { x: rect.left + Math.min(rect.width, 40), y: rect.bottom } : { x, y };
  B.pop = { card, key: el.getAttribute("data-akey"), anchor: anchorData(el), refs: (el.getAttribute("data-arefs") || "").split(" ").filter(Boolean), x: at.x, y: at.y, text: "" };
  B.focusKey.set(card, B.pop.key); rerender();
  requestAnimationFrame(() => document.querySelector(".rb-pop [data-chip]")?.focus({ preventScroll: true }));
}
function closePop(back = true) { const p = B.pop; B.pop = null; rerender(); if (back && p) requestAnimationFrame(() => focusAnchor(p.card, p.key)); }
const focusAnchor = (card, key) => { const el = key && document.querySelector(`[data-board-vp="${CSS.escape(card)}"] [data-akey="${CSS.escape(key)}"]`); if (el) { B.quiet = true; try { el.focus({ preventScroll: true }); } finally { B.quiet = false; } } };
/** a question asked: a paid chip waits in its card for the confirmation; show the code is free */
function ask(card, r, p) {
  if (p.chip === "code") return showCode(card, r, p);
  const th = (r.lesson?.threads || []).find((t) => (p.n != null ? t.n === p.n : t.key === p.key));
  if (th && p.n == null) { const root = th.nodes.find((n) => n.rel === "root"); Object.assign(p, { n: th.n, node: root?.id, rel: p.chip === "example" ? "side" : p.chip === "rephrase" ? "version" : "below" }); if (th.state !== "open") B.peek.add(`${card}/${th.n}`); }
  // a phone asks nothing paid: the popover stays, saying where to ask
  if (phoneSession()) return;
  B.pend.set(card, p); B.err.delete(card); B.reveal.set(card, "pending"); B.pop = null; rerender();
  // the room agreed to this plan: it starts now (the card says it is paid); otherwise the card asks once
  if (r.followUps?.current) { startPending(card); return; }
  requestAnimationFrame(() => document.querySelector("[data-board-start]")?.focus({ preventScroll: true }));
}
async function showCode(card, r, p) {
  const ref = p.refs?.[0]; B.pop = null; if (!ref) { rerender(); return; }
  // a pull request on GitHub: its code is read there (openCite opens the pull request's files at those lines); a saved room
  // or one that takes no change: Studio's citation viewer, read from what it has. Only then a code card on the board.
  // a phone reads it the same way: the code card is a write to the room, which a phone never makes
  if (!r.open || r.snapshot || githubDiffUrl(r, ref) || phoneSession()) { rerender(); openCite(card, ref); return; }
  await lessonOp(card, p.n != null ? { op: "code", n: p.n, node: p.node, ref } : { op: "code", anchor: p.anchor, ref }); B.reveal.set(card, p.n != null ? `${p.n}` : "new");
}
async function startPending(card) {
  const p = B.pend.get(card), r = RR.rooms.get(card); if (!p || !r || B.busy.has(card)) return;
  B.busy.add(card); B.err.delete(card); rerender();
  try { const thread = p.n != null ? { n: p.n, node: p.node, chip: p.chip, ...(p.q ? { q: p.q } : {}) } : { anchor: p.anchor, chip: p.chip, ...(p.q ? { q: p.q } : {}) };
    // a board question never asks for generated pictures; agreed in this room for this plan, it starts without a confirmation
    const agreed = !!r.followUps?.current && !p.confirming, body = agreed ? { thread, lang: uiLang() } : { thread, lang: uiLang(), confirm: r.offer?.hash, consent: B.consent.get(card) !== false };
    const room = await postJ(`/api/review-room/${enc(card)}/turn`, body);
    RR.rooms.set(card, room); B.pend.delete(card); const t = room.turns?.at(-1)?.thread; if (t) { B.reveal.set(card, `${t.n}`); B.peek.delete(`${card}/${t.n}`); } }
  catch (e) { if (e.code === "confirm_required" && e.offer) { RR.rooms.set(card, { ...r, offer: e.offer, followUps: r.followUps ? { ...r.followUps, current: false } : null }); p.confirming = true; B.pend.set(card, p); B.err.set(card, T("The tutor or its round changed: check it and confirm again.", "導師或這一回合變了：請看過再確認一次。")); } else B.err.set(card, e.message); }
  finally { B.busy.delete(card); redraw(card); schedule(); }
}
async function lessonOp(card, body) {
  try { const out = await postJ(`/api/review-room/${enc(card)}/lesson`, body); const room = out?.card ? out : out?.view; if (room?.card) RR.rooms.set(card, room); return out; }
  catch (e) { B.err.set(card, e.message); toast(card, e.message, true); return null; }
  finally { redraw(card); }
}
async function tidy(card) {
  if (B.busy.has(`${card}/tidy`)) return; B.busy.add(`${card}/tidy`); rerender();
  const out = await lessonOp(card, { op: "tidy" }); B.busy.delete(`${card}/tidy`); B.before.delete(card);
  // what was folded in folds on the board too
  if (out) for (const k of [...B.peek]) if (k.startsWith(`${card}/`)) B.peek.delete(k);
  if (out) toast(card, out.merged ? T(`Folded ${out.merged} answered question${out.merged === 1 ? "" : "s"} into their chapters; the ones not understood stay on the board.`, `已把 ${out.merged} 串問答併回章節；還沒懂的保留在白板上。`) : T("No answered question to fold in yet.", "沒有可以併入的問答。"));
  redraw(card);
}
function toast(card, text, bad) { B.toast = { card, text, bad }; clearTimeout(toast.t); toast.t = setTimeout(() => { B.toast = null; redraw(card); }, 3200); redraw(card); }
function visit(card, r, key) {
  const v = B.visited.get(card) || new Set(); if (v.has(key)) return; v.add(key); B.visited.set(card, v);
  if (r && !r.snapshot) postJ(`/api/review-room/${enc(card)}/lesson`, { op: "visit", scene: key }).catch(() => {});
}

// ---------- the camera ----------
const vpOf = (card) => document.querySelector(`[data-board-vp="${CSS.escape(card)}"]`);
const camOf = (card) => B.cam.get(card) || { x: 0, y: 0, s: 1 };
function applyCam(card, relayout = true) {
  const vp = vpOf(card), plane = vp?.querySelector("[data-board-plane]"), c = camOf(card); if (!plane) return;
  plane.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.s})`;
  vp.style.backgroundSize = `${22 * c.s}px ${22 * c.s}px`; vp.style.backgroundPosition = `${c.x}px ${c.y}px`;
  const pct = vp.parentElement?.querySelector("[data-zoom-pct]"); if (pct) pct.textContent = `${Math.round(c.s * 100)}%`;
  const l = LOD(c.s);
  if (plane.dataset.lod !== l) { const L0 = B.L.get(card), lock = B.lock.get(card), ref = !lock && L0 && refRegion(card), o = ref ? { ...L0.R[ref] } : null;
    plane.dataset.lod = l; B.lod.set(card, l);
    // a new level of detail changes the regions' sizes: what the camera is locked on is aimed at again (a glide on its
    // way there changes course); otherwise the region under the middle of the screen stays where it was
    if (relayout) { layout(card); const L1 = B.L.get(card);
      if (lock) { const t = lockTarget(card); if (t) { if (B.tween?.card === card) B.tween.to = t; else { B.cam.set(card, t); return applyCam(card, false); } } }
      else if (o && L1?.R[ref]) { c.x -= (L1.R[ref].x - o.x) * c.s; c.y -= (L1.R[ref].y - o.y) * c.s; plane.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.s})`; } } }
  minimap(card);
}
function refRegion(card) { const L = B.L.get(card), vp = vpOf(card), c = camOf(card); if (!L || !vp) return null; const bx = (vp.clientWidth / 2 - c.x) / c.s, by = (vp.clientHeight / 2 - c.y) / c.s; let best = null, bd = Infinity;
  for (const [k, r] of Object.entries(L.R)) { const dx = Math.max(r.x - bx, 0, bx - (r.x + r.w)), dy = Math.max(r.y - by, 0, by - (r.y + r.h)), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } } return best; }
/** the camera moves there: glided (450ms, eased) unless motion is reduced */
function moveCam(card, to, glide = true) {
  cancelAnimationFrame(B.tween?.raf ?? 0); B.tween = null;
  if (!glide || reduceMotion()) { B.cam.set(card, { ...to }); applyCam(card); return; }
  const from = { ...camOf(card) }, t0 = performance.now(), dur = 450, ease = (u) => 1 - Math.pow(1 - u, 3), tw = { card, to: { ...to }, raf: 0 };
  const step = (now) => { if (B.tween !== tw) return; const u = Math.min(1, (now - t0) / dur), e = ease(u), T = tw.to; B.cam.set(card, { x: from.x + (T.x - from.x) * e, y: from.y + (T.y - from.y) * e, s: from.s + (T.s - from.s) * e }); applyCam(card);
    if (u < 1 && onRoom(card) && B.tween === tw) tw.raf = requestAnimationFrame(step); else if (B.tween === tw) B.tween = null; };
  B.tween = tw; tw.raf = requestAnimationFrame(step);
}
/** where the camera's lock says it should be: its region, its focused question, or the whole board (or its asked chapters) */
function lockTarget(card) { const lock = B.lock.get(card), L = B.L.get(card); if (!lock || !L) return null;
  return lock.region ? regionCam(card, lock.region) : lock.focus != null ? focusCam(card, lock.focus) : lock.all ? (() => { const ks = B.only.has(card) ? Object.keys(L.R).filter((k) => L.q[k]) : []; return frameRect(card, bounds(card, ks.length ? ks : null), 1, 0.94); })() : null; }
/** a region at a readable scale: its text at 92% or more on a desktop, its column filling a phone's width */
function regionCam(card, key) {
  const L = B.L.get(card), vp = vpOf(card), r = L?.R[key]; if (!r || !vp) return null; const W = vp.clientWidth;
  if (phone()) { const s = clamp((W - 24) / r.W, 0.5, 1.15); return { s, x: (W - r.W * s) / 2 - r.x * s, y: 44 - (r.y - 34) * s }; }
  const avail = W - 32, want = Math.min(r.w, r.W + (r.w > r.W ? 368 : 0)), s = clamp(avail / want, 0.88, 1), vis = Math.min(want, avail / s);
  return { s, x: 16 + (avail - vis * s) / 2 - r.x * s, y: 56 - (r.y - 34) * s };
}
function bounds(card, keys) { const L = B.L.get(card); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of keys || Object.keys(L?.R || {})) { const r = L.R[k]; if (!r) continue; x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y - 40); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
function frameRect(card, b, maxS = 1, pad = 0.92) { const vp = vpOf(card); if (!vp || !isFinite(b.w)) return null; const top = 44, W = vp.clientWidth, H = vp.clientHeight - top, s = Math.min(W * pad / b.w, H * pad / b.h, maxS);
  return { s, x: W / 2 - (b.x + b.w / 2) * s, y: top + H / 2 - (b.y + b.h / 2) * s }; }
function fitAll(card, glide = true) { if (!B.L.get(card)) return; B.lock.set(card, { all: true }); const to = lockTarget(card); if (to) moveCam(card, to, glide); }
function zoomAt(card, f, cx, cy, glide = false) { const c = camOf(card), s2 = clamp(c.s * f, 0.1, 2.4), bx = (cx - c.x) / c.s, by = (cy - c.y) / c.s; B.lock.delete(card); moveCam(card, { s: s2, x: cx - bx * s2, y: cy - by * s2 }, glide); }
function flyTo(card, key, glide = true) {
  const r = RR.rooms.get(card); visit(card, r, key); B.cur.set(card, key); B.lock.set(card, { region: key }); B.sheet.delete(card);
  rerender(); layout(card); const to = regionCam(card, key); if (to) moveCam(card, to, glide);
}
function step(card, dir) { const L = B.L.get(card); if (!L) return; const order = L.order, i = order.indexOf(B.cur.get(card)), n = order[i + dir];
  if (n) flyTo(card, n); else if (dir > 0) fitAll(card); }
function focusThread(card, n) {
  const r = RR.rooms.get(card), t = (r?.lesson?.threads || []).find((x) => x.n === n); if (!t) return;
  // a question from another lesson (taught again since): that lesson comes back to the board first
  const sh = B.shown.get(card), j = sh ? sh.scenes.findIndex((x) => x.key === t.anchor.scene) : -1;
  if (j >= 0 && sh.scenes[sh.i]?.turn !== sh.scenes[j].turn) { RR.scene.set(card, j); rerender(); }
  visit(card, r, t.anchor.scene); if (!B.focus.has(card)) B.focus.set(card, { n, prev: { ...camOf(card) } }); else B.focus.get(card).n = n;
  B.lock.set(card, { focus: n }); B.sheet.delete(card); B.pop = null; rerender(); layout(card);
  const to = focusCam(card, n); if (to) moveCam(card, to);
}
function focusCam(card, n) { const L = B.L.get(card), g = L?.groups[n]; if (!g) return null; return frameRect(card, { x: g.x - 30, y: g.y - 30, w: g.w + 60, h: g.h + 60 }, 1.1, 0.9); }
function unfocus(card) { const f = B.focus.get(card); if (!f) return; B.focus.delete(card); B.lock.delete(card); rerender(); layout(card); moveCam(card, f.prev); }

// ---------- the layout: regions in rows, each question's cards beside its place, nothing on anything ----------
/** Every measurement first (each card's size, each place's box), then the placing (no read after a write, so the page lays
 *  itself out once), then the writes. A card slides down only past the boxes it meets across. */
function layout(card) {
  const t0 = performance.now(), vp = vpOf(card), plane = vp?.querySelector("[data-board-plane]"); if (!plane) return;
  const ph = phone(), C = {}, groups = {}, lines = [], q = {}, names = {}, writes = [], pins = [];
  for (const pin of plane.querySelectorAll(".rb-pin.abs")) pin.remove();
  const r0 = RR.rooms.get(card), byKey = new Map((r0?.lesson?.threads || []).map((t) => [t.key, t]));
  // 1. read
  const regs = [...plane.querySelectorAll("[data-region]")].map((reg) => {
    const key = reg.dataset.region, body = reg.querySelector(".rb-rbody"), layer = reg.querySelector(".rb-tlayer"), W = body.offsetWidth, H = body.offsetHeight, br = body.getBoundingClientRect(), k = br.width / (W || 1) || 1;
    const box = (el) => { let ar = el.getBoundingClientRect(); if (!ar.width && !ar.height) ar = (el.closest("figure") || body).getBoundingClientRect(); return { x: (ar.left - br.left) / k, y: (ar.top - br.top) / k, r: (ar.right - br.left) / k, b: (ar.bottom - br.top) / k }; };
    const els = [...(layer?.children || [])].filter((e) => e.dataset.group != null).map((e) => ({ e, w: e.offsetWidth, h: e.offsetHeight })).filter((x) => x.w);
    const keys = [...new Set(els.map((x) => x.e.dataset.group))], places = new Map();
    for (const gk of keys) { const a = body.querySelector(`[data-akey="${CSS.escape(gk)}"]`); places.set(gk, a ? box(a) : { x: 0, y: 0, r: 0, b: 0 }); }
    // a drawing's place gets its pin at its top right (a sentence's pins are inline)
    if (!reg.classList.contains("unvisited")) for (const [kk, t] of byKey) { if (t.anchor.scene !== key) continue; const a = body.querySelector(`[data-akey="${CSS.escape(kk)}"]`); if (a && !a.classList.contains("rb-s")) pins.push({ reg, t, b: box(a) }); }
    return { reg, key, W, H, els, places, name: reg.querySelector(".rb-rtitle span")?.textContent || key };
  });
  // 2. place (numbers only)
  for (const { reg, key, W, H, els, places, name } of regs) {
    names[key] = name; const rects = [{ x: 0, y: 0, w: W, h: H }]; let mx = W, my = H;
    const push = (x, y, w, hh) => { const g = 16, across = rects.filter((r) => x < r.x + r.w + g && x + w + g > r.x); let moved = true;
      while (moved) { moved = false; for (const r of across) if (y < r.y + r.h + g && y + hh + g > r.y) { y = r.y + r.h + g; moved = true; } }
      rects.push({ x, y, w, h: hh }); mx = Math.max(mx, x + w); my = Math.max(my, y + hh); return { x, y }; };
    const byGroup = new Map(); for (const x of els) { const gk = x.e.dataset.group; if (!byGroup.has(gk)) byGroup.set(gk, []); byGroup.get(gk).push(x); }
    const list = [...byGroup].map(([gk, es]) => ({ gk, es, a: places.get(gk), y: Math.max(0, places.get(gk).y) })).sort((a, b) => a.y - b.y);
    const at = (x, p) => writes.push([x.e, p.x, p.y]);
    // the folded chips first, each beside its own place (a card never pushes one far away)
    for (const g of list) { const chip = g.es.find((x) => x.e.dataset.tchip); if (!chip) continue; const n = chip.e.dataset.thread;
      const p = push(ph ? 0 : W + 24, ph ? H + 14 : g.y, chip.w, chip.h); at(chip, p); q[key] = (q[key] || 0) + 1;
      lines.push({ key, n, d: [ph ? 24 : W, ph ? H : g.y + 10, p.x, p.y + chip.h / 2], k: "anchor" });
      groups[n] = { key, x0: Math.min(g.a.x, p.x), y0: Math.min(g.a.y, p.y), x1: Math.max(g.a.r, p.x + chip.w), y1: Math.max(g.a.b, p.y + chip.h) }; }
    for (const g of list) { if (g.es.some((x) => x.e.dataset.tchip)) continue;
      const n = g.es[0].e.dataset.thread, box = { x0: g.a.x, y0: g.a.y, x1: g.a.r, y1: g.a.b }, grow = (p, w, hh) => { box.x0 = Math.min(box.x0, p.x); box.y0 = Math.min(box.y0, p.y); box.x1 = Math.max(box.x1, p.x + w); box.y1 = Math.max(box.y1, p.y + hh); };
      q[key] = (q[key] || 0) + 1;
      const ids = new Set(g.es.map((x) => x.e.dataset.tnode)), kids = new Map(), done = new Set(); for (const x of g.es) { const par = x.e.dataset.parent || ""; if (!kids.has(par)) kids.set(par, []); kids.get(par).push(x); }
      const placeAt = (x, px, py, par) => { done.add(x); const p = push(px, py, x.w, x.h); at(x, p); grow(p, x.w, x.h);
        const side = x.e.dataset.rel === "side" && !ph;
        if (par) lines.push({ key, n, d: side ? [par.x + par.w, par.y + 22, p.x, p.y + 22] : [par.x + 24, par.y + par.h, p.x + 24, p.y], k: side ? "side" : "below" });
        const me = { x: p.x, y: p.y, w: x.w, h: x.h }, ch = kids.get(x.e.dataset.tnode) || [];
        for (const c of ch.filter((c) => c.e.dataset.rel === "side" && !done.has(c) && !ph)) placeAt(c, p.x + x.w + 40, p.y, me);
        for (const c of ch.filter((c) => (c.e.dataset.rel !== "side" || ph) && !done.has(c))) placeAt(c, p.x, p.y + x.h + 18, me);
        return me; };
      const root = g.es.find((x) => x.e.dataset.rel === "root") || g.es.find((x) => !ids.has(x.e.dataset.parent || "")) || g.es[0];
      const me = placeAt(root, ph ? 0 : W + 48, ph ? H + 18 : Math.max(0, g.y - 14), null);
      lines.push({ key, n, d: [ph ? 24 : W, ph ? H : g.y + 10, ph ? me.x + 24 : me.x, ph ? me.y : me.y + 22], k: "anchor" });
      // a card whose parent is not drawn (a pending one on a folded thread) sits under the others
      for (const x of g.es) if (!done.has(x)) placeAt(x, ph ? 0 : W + 48, my + 18, null);
      // the thread's frame holds its place and its cards (focus frames both)
      groups[n] = { key, ...box }; }
    C[key] = { W, H, w: mx, h: my, reg };
  }
  // the rows: three chapters a row on a desktop, one on a phone; a row as tall as its tallest region
  const keys = Object.keys(C), per = ph ? 1 : 3, R = {}; let y = 0;
  for (let i = 0; i < keys.length; i += per) { let x = 0, rh = 0;
    for (const key of keys.slice(i, i + per)) { const c = C[key]; R[key] = { x, y, w: c.w, h: c.h, W: c.W, H: c.H }; x += c.w + (ph ? 60 : 150); rh = Math.max(rh, c.h); }
    y += rh + (ph ? 110 : 170); }
  for (const [n, g] of Object.entries(groups)) { const r = R[g.key]; groups[n] = { key: g.key, x: r.x + g.x0, y: r.y + g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0 }; }
  B.L.set(card, { R, order: keys, groups, q, names });
  // 3. write
  for (const [e, x, yy] of writes) { e.style.left = `${x}px`; e.style.top = `${yy}px`; }
  for (const key of keys) { const c = C[key], r = R[key]; c.reg.style.left = `${r.x}px`; c.reg.style.top = `${r.y}px`; c.reg.style.width = `${c.w}px`; c.reg.style.height = `${c.h}px`; }
  const svg = plane.querySelector("[data-board-links]"), fn = B.focus.get(card)?.n;
  if (svg) svg.replaceChildren(...lines.filter((l) => R[l.key]).map((l) => { const r = R[l.key], [x1, y1, x2, y2] = [r.x + l.d[0], r.y + l.d[1], r.x + l.d[2], r.y + l.d[3]];
    const d = l.k === "below" || (ph && l.k === "anchor") ? `M${x1} ${y1} C${x1} ${y1 + 14},${x2} ${y2 - 14},${x2} ${y2}` : `M${x1} ${y1} C${x1 + Math.max(24, (x2 - x1) / 2)} ${y1},${x2 - Math.max(24, (x2 - x1) / 2)} ${y2},${x2} ${y2}`;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("class", `${l.k}${String(fn) === String(l.n) ? " lit" : ""}`); p.setAttribute("data-link", l.n); return p; }));
  for (const { reg, t, b } of pins) reg.querySelector(".rb-tlayer").append(h("button", { type: "button", class: `rb-pin abs ${pinCls(card, t)}`, "data-pin": t.n, "data-pin-for": t.key, tabindex: -1, "aria-label": T(`Question ${t.n}`, `問題 ${t.n}`), style: `left:${b.r - 6}px;top:${b.y - 14}px`, onclick: (e) => { e.stopPropagation(); focusThread(card, t.n); } }, String(t.n)));
  B.lastLayout = performance.now() - t0;
}
function minimap(card) {
  const m = document.querySelector(`[data-minimap="${CSS.escape(card)}"]`), L = B.L.get(card), vp = vpOf(card); if (!m || !L || !vp) return;
  const b = bounds(card), mw = 196, sc = mw / (b.w || 1), mh = Math.max(40, Math.round(b.h * sc)), c = camOf(card), v = B.visited.get(card) || new Set(), cur = B.cur.get(card), NS = "http://www.w3.org/2000/svg";
  m.setAttribute("viewBox", `0 0 ${mw} ${mh}`); m.style.aspectRatio = `${mw}/${mh}`; m.dataset.bx = b.x; m.dataset.by = b.y; m.dataset.sc = sc;
  const el = (tag, a) => { const e = document.createElementNS(NS, tag); for (const [k, x] of Object.entries(a)) e.setAttribute(k, String(x)); return e; };
  const kids = Object.entries(L.R).map(([k, r]) => el("rect", { class: `r${v.has(k) ? "" : " un"}${k === cur ? " cur" : ""}`, x: (r.x - b.x) * sc, y: (r.y - b.y) * sc, width: Math.max(2, r.W * sc), height: Math.max(2, r.H * sc), rx: 2 }));
  for (const t of RR.rooms.get(card)?.lesson?.threads || []) { const g = L.groups[t.n]; if (g) kids.push(el("circle", { class: t.state === "open" ? "q" : "", cx: (g.x - b.x) * sc, cy: (g.y - b.y) * sc, r: 2.4 })); }
  kids.push(el("rect", { class: "vw", x: (-c.x / c.s - b.x) * sc, y: (-c.y / c.s - b.y) * sc, width: vp.clientWidth / c.s * sc, height: vp.clientHeight / c.s * sc }));
  m.replaceChildren(...kids);
}
/** after the board is drawn: lay it out, set the camera (first open: the current chapter; a lock follows its target), keep
 *  the popover on screen, bring a new card into view, give the keyboard focus back */
function after(card) {
  const vp = vpOf(card); if (!vp) return; const r = RR.rooms.get(card), plane = vp.querySelector("[data-board-plane]");
  plane.dataset.lod = LOD(camOf(card).s); layout(card);
  const lock = B.lock.get(card);
  if (!B.cam.has(card)) { const key = B.cur.get(card) || B.L.get(card)?.order[0]; B.cur.set(card, key); visit(card, r, key); const to = regionCam(card, key); if (to) B.cam.set(card, to); B.lock.set(card, { region: key });
    if (phone() && !B.sheet.has(card) && !r?.snapshot) B.sheet.set(card, "outline"); if (B.sheet.get(card) === "outline") requestAnimationFrame(() => redraw(card)); }
  else if (lock && !B.drag) { const to = lockTarget(card); if (to) { if (B.tween?.card === card) B.tween.to = to; else B.cam.set(card, to); } }
  applyCam(card); if (plane.dataset.lod !== LOD(camOf(card).s)) applyCam(card);
  // the popover stays inside the screen (a phone's is a bottom sheet)
  const pop = document.querySelector(".rb-pop"); if (pop && !phone()) { const pr = pop.getBoundingClientRect(), x = clamp(pr.left, 12, innerWidth - pr.width - 12); let y = pr.top; if (pr.bottom > innerHeight - 12) y = Math.max(12, (B.pop?.y ?? pr.top) - pr.height - 18); pop.style.left = `${x}px`; pop.style.top = `${clamp(y, 12, innerHeight - pr.height - 12)}px`; }
  const rv = B.reveal.get(card); if (rv) { B.reveal.delete(card); requestAnimationFrame(() => revealCard(card, rv)); }
  const fk = B.focusKey.get(card); if (fk && !B.pop && (document.activeElement === document.body || !document.activeElement)) focusAnchor(card, fk);
}
/** a new card in view with its place: the camera pans just enough to show both, zooming out only when they do not fit */
function revealCard(card, which) {
  const vp = vpOf(card); if (!vp) return; const el = which === "pending" ? vp.querySelector("[data-pending]") : [...vp.querySelectorAll(`.rb-card[data-thread="${CSS.escape(which)}"]`)].at(-1) || vp.querySelector(`.rb-tchip[data-thread="${CSS.escape(which)}"]`) || vp.querySelector(`[data-thread="${CSS.escape(which)}"]`);
  if (!el) return; const a = el.dataset.group && vp.querySelector(`[data-akey="${CSS.escape(el.dataset.group)}"]`), vr = vp.getBoundingClientRect(), er = el.getBoundingClientRect(), ar = a?.getBoundingClientRect(), c = camOf(card);
  const eb = er.top + Math.min(er.height, vr.height * 0.6), u = ar && (ar.width || ar.height) ? { l: Math.min(er.left, Math.max(ar.left, ar.right - 200)), t: Math.min(er.top, ar.top), r: Math.max(er.right, ar.right), b: Math.max(eb, ar.bottom) } : { l: er.left, t: er.top, r: er.right, b: eb };
  const P = (sx, sy) => [(sx - vr.left - c.x) / c.s, (sy - vr.top - c.y) / c.s], [pl, pt] = P(u.l, u.t), [pr, pb] = P(u.r, u.b), W = vr.width, H = vr.height;
  const s2 = Math.max(Math.min(c.s, 0.7), Math.min(c.s, (W - 40) / Math.max(1, pr - pl), (H - 90) / Math.max(1, pb - pt)));
  let x = (u.l - vr.left) - pl * s2, y = (u.t - vr.top) - pt * s2;
  if (pr * s2 + x > W - 20) x = W - 20 - pr * s2; if (pl * s2 + x < 20) x = 20 - pl * s2;
  if (pb * s2 + y > H - 70) y = H - 70 - pb * s2; if (pt * s2 + y < 20) y = 20 - pt * s2;
  if (Math.abs(x - c.x) > 0.5 || Math.abs(y - c.y) > 0.5 || s2 !== c.s) { B.lock.delete(card); moveCam(card, { s: s2, x, y }); }
}

// ---------- input: drag (or Space and drag) to pan, the wheel, a pinch or ± to zoom; a click asks, a drag never does ----------
const ptrs = new Map();
function pointerDown(card, e) {
  if (e.button > 0 || e.target.closest("input,select,textarea,.rb-zoom,.rb-tools,.rb-next,.rb-focusbar,.rb-pop")) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); B.moved = false;
  if (ptrs.size === 1) B.drag = { card, x: e.clientX, y: e.clientY, c: { ...camOf(card) }, space: B.space };
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; B.pinch = { card, d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; B.drag = null; }
}
addEventListener("pointermove", (e) => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2 && B.pinch) { const card = B.pinch.card, [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, vr = vpOf(card)?.getBoundingClientRect(); if (!vr) return;
    const c = camOf(card); B.cam.set(card, { ...c, x: c.x + mx - B.pinch.mx, y: c.y + my - B.pinch.my }); zoomAt(card, d / B.pinch.d, mx - vr.left, my - vr.top); B.pinch = { card, d, mx, my }; B.moved = true; return; }
  const g = B.drag; if (!g) return; const dx = e.clientX - g.x, dy = e.clientY - g.y;
  if (!B.moved && (Math.hypot(dx, dy) > 5 || g.space)) { B.moved = Math.hypot(dx, dy) > 5 || g.space; if (B.moved) { vpOf(g.card)?.classList.add("dragging"); if (B.pop) { B.pop = null; rerender(); } } }
  if (B.moved) { B.lock.delete(g.card); cancelAnimationFrame(B.tween?.raf ?? 0); B.tween = null; B.cam.set(g.card, { ...g.c, x: g.c.x + dx, y: g.c.y + dy }); applyCam(g.card); }
});
const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) B.pinch = null; if (!ptrs.size) { const g = B.drag; B.drag = null; if (g) vpOf(g.card)?.classList.remove("dragging"); setTimeout(() => (B.moved = false), 0); } };
addEventListener("pointerup", up); addEventListener("pointercancel", up);
// a new window size (a phone's column, a narrower desktop) draws the board again and aims the camera at what it is locked on
let resized = 0; addEventListener("resize", () => { clearTimeout(resized); resized = setTimeout(() => { if (document.querySelector("[data-board-vp]")) rerender(); }, 120); });
addEventListener("keyup", (e) => { if (e.key === " ") { B.space = false; document.querySelector("[data-board-vp]")?.classList.remove("grab"); } });
function wheel(card, e) {
  e.preventDefault(); const vr = vpOf(card).getBoundingClientRect(), c = camOf(card);
  // a sideways scroll pans; any other wheel (and a trackpad's pinch, which arrives as a ctrl wheel) zooms at the pointer
  if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { B.lock.delete(card); B.cam.set(card, { ...c, x: c.x - e.deltaX }); applyCam(card); return; }
  zoomAt(card, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - vr.left, e.clientY - vr.top);
}
function click(card, r, e) {
  if (B.moved) { e.preventDefault(); e.stopPropagation(); return; }
  const t = e.target, a = t.closest?.("[data-akey]"), ctl = t.closest?.("button,a,summary,input,select,textarea");
  if (a && (!ctl || ctl === a || ctl.matches?.("[data-akey]")) && !t.closest(".rb-pop")) { openPop(card, a, e.clientX, e.clientY); return; }
  // a card's empty area focuses its whole thread (as the prototype's)
  const tc = t.closest?.(".rb-card[data-thread]:not([data-pending])"); if (tc && !ctl && !t.closest("pre,.rp-fig,[data-cite]")) { focusThread(card, Number(tc.dataset.thread)); return; }
  if (B.pop && !t.closest(".rb-pop")) closePop(false);
}
/** the keyboard on the board: → n / ← p a chapter on or back, Enter or Space on a place asks there, + − 0 zoom, Escape
 *  closes what is open (the popover, the focus, a sheet) */
function keydown(e, card) {
  if (!vpOf(card)) return false; const t = e.target;
  if (e.key === "Escape") { if (B.pop) closePop(); else if (B.pend.has(card)) { B.pend.delete(card); rerender(); } else if (B.focus.has(card)) unfocus(card); else if (B.sheet.get(card)) { B.sheet.delete(card); rerender(); } else return false; e.preventDefault(); return true; }
  if (t?.closest?.("input,textarea,select,[contenteditable]")) return false;
  if ((e.key === "Enter" || e.key === " ") && t?.matches?.("[data-akey]")) { e.preventDefault(); openPop(card, t); return true; }
  if (e.key === " " && !t?.closest?.("button,a,summary")) { e.preventDefault(); B.space = true; vpOf(card)?.classList.add("grab"); return true; }
  if (t?.closest?.(".rb-pop")) return false;
  if (e.key === "ArrowRight" || e.key === "n" || e.key === "N") { e.preventDefault(); step(card, 1); return true; }
  if (e.key === "ArrowLeft" || e.key === "p" || e.key === "P") { e.preventDefault(); step(card, -1); return true; }
  const vp = vpOf(card), W = vp.clientWidth, H = vp.clientHeight;
  if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(card, 1.25, W / 2, H / 2, true); return true; }
  if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(card, 0.8, W / 2, H / 2, true); return true; }
  if (e.key === "0") { e.preventDefault(); fitAll(card); return true; }
  return false;
}
/** a place reached with Tab is brought into view by the camera (the viewport never scrolls itself) */
function focusIn(card, e) { const vp0 = vpOf(card); if (vp0) { vp0.scrollTop = 0; vp0.scrollLeft = 0; } const a = e.target.closest?.("[data-akey]"); if (!a) return; B.focusKey.set(card, a.getAttribute("data-akey"));
  if (B.quiet || !a.matches(":focus-visible")) return;
  const vp = vpOf(card), vr = vp.getBoundingClientRect(), ar = a.getBoundingClientRect(), c = camOf(card); let dx = 0, dy = 0;
  if (ar.left < vr.left + 16) dx = vr.left + 16 - ar.left; else if (ar.right > vr.right - 16) dx = Math.max(vr.right - 16 - ar.right, vr.left + 16 - ar.left);
  if (ar.top < vr.top + 60) dy = vr.top + 60 - ar.top; else if (ar.bottom > vr.bottom - 80) dy = vr.bottom - 80 - ar.bottom;
  vp.scrollTop = 0; vp.scrollLeft = 0; if (dx || dy) { B.lock.delete(card); moveCam(card, { ...c, x: c.x + dx, y: c.y + dy }, false); } }

// ---------- the board ----------
/** the map in the rail (an SVG element of its own: h() makes HTML elements); a click moves the camera there */
function miniSvg(card) {
  const m = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ class: "rb-minimap", "data-minimap": card, role: "img", "aria-label": T("The board's map: click to go there", "白板的小地圖：點一下就移過去"), viewBox: "0 0 196 120" })) m.setAttribute(k, v);
  m.addEventListener("click", (e) => { const rc = m.getBoundingClientRect(), sc2 = Number(m.dataset.sc) * (rc.width / 196) || 1, vp = vpOf(card); if (!vp) return;
    const bx = Number(m.dataset.bx) + (e.clientX - rc.left) / sc2, by = Number(m.dataset.by) + (e.clientY - rc.top) / sc2, c = camOf(card); B.lock.delete(card); moveCam(card, { ...c, x: vp.clientWidth / 2 - bx * c.s, y: vp.clientHeight / 2 - by * c.s }); });
  return m;
}
function popover(card, r) {
  const p = B.pop; if (!p || p.card !== card) return null; const live = r.open && !r.snapshot, desk = !phoneSession(), paid = live && !r.offer?.error && desk;
  const chip = ([c, en, zh]) => h("button", { type: "button", class: `rb-chip${c === "code" ? " free" : c === "rephrase" ? " c-q" : ""}`, "data-chip": c, disabled: c === "code" ? !p.refs.length : !paid,
    title: c === "code" ? (p.refs.length ? T("Free: opens what this place cites", "免費：打開這裡引用的程式碼") : T("This place cites no code", "這裡沒有引用程式碼")) : paid ? T("A paid round", "付費一回合") : !desk ? T("Ask on the desktop", "在電腦上問") : r.offer?.error || T("This room takes no question now", "這個審查室現在不能提問"),
    onclick: (e) => { e.stopPropagation(); ask(card, r, { anchor: p.anchor, key: p.key, refs: p.refs, chip: c, rel: c === "example" ? "side" : c === "rephrase" ? "version" : "below" }); } }, T(en, zh));
  const style = phone() ? "" : `left:${Math.round(clamp(p.x - 20, 12, innerWidth - 352))}px;top:${Math.round(p.y + 14)}px`;
  return h("div", { class: "rb-pop", role: "dialog", "aria-modal": "false", "aria-label": T("Ask about this place", "問這裡"), "data-board-pop": p.key, style },
    h("div", { class: "rb-pq" }, T(`Ask: “${clip(p.anchor.text, 60)}”`, `問：「${clip(p.anchor.text, 60)}」`)),
    h("div", { class: "rb-chips" }, POP.map(chip)),
    paid ? h("form", { class: "rb-popform", onsubmit: (e) => { e.preventDefault(); const q = (B.pop?.text || "").trim(); if (q) ask(card, r, { anchor: p.anchor, key: p.key, chip: "free", q: q.slice(0, 1000) }); } },
      h("input", { "data-pop-input": p.key, maxlength: 1000, value: p.text || "", placeholder: T("Or ask in your own words…", "或直接問…"), "aria-label": T("Your question about this place", "你對這裡的問題"), autocomplete: "off", oninput: (e) => { if (B.pop) B.pop.text = e.target.value; } }),
      h("button", { type: "submit", class: "rb-btn primary" }, T("Ask", "問"))) : null,
    !live ? h("p", { class: "rb-popnote" }, r.snapshot ? T("A saved room: reading only. Show the code opens what it saved.", "存檔的審查室：只能閱讀。看程式碼會打開存下的內容。") : T("This room takes no question now.", "這個審查室現在不能提問。"))
      : !desk ? deskNote() : r.offer?.error ? h("p", { class: "rb-popnote" }, r.offer.error) : null,
    h("button", { type: "button", class: "rb-popx", "aria-label": T("Close", "關閉"), onclick: (e) => { e.stopPropagation(); closePop(); } }, "×"));
}
function view(r, scenes, i) {
  B.shown.set(r.card.id, { scenes, i });
  const card = r.card.id, sc = scenes[i], t = sc.t, secs = scenes.filter((x) => x.turn === sc.turn && x.chapter), live = r.open && !r.snapshot;
  const L = r.lesson || { threads: [], visited: [] }, threads = L.threads || [], TN = new Map((r.turns || []).map((x) => [x.n, x]));
  // a saved room shows every chapter; a live one the chapters read (the first always)
  const visited = B.visited.get(card) || new Set(); for (const k of L.visited || []) visited.add(k); if (r.snapshot) { for (const x of secs) visited.add(x.key); visited.add("end"); } B.visited.set(card, visited);
  // where the board stands: the chapter a jump (the rail, the transcript, a finished lesson) asks for, else where it was, else the first
  const valid = [...secs.map((x) => x.key), "end"], jump = RR.jump?.get(card); if (jump) RR.jump.delete(card);
  const prevScene = B.lastScene.get(card); B.lastScene.set(card, sc.key);
  const want = jump || (prevScene != null && prevScene !== sc.key ? sc.key : null);
  if (!valid.includes(B.cur.get(card))) B.cur.set(card, valid.includes(want) ? want : secs[0]?.key);
  else if (want && valid.includes(want) && want !== B.cur.get(card)) queueMicrotask(() => flyTo(card, want, false));
  const ctx = { threads, TN, visited, cur: B.cur.get(card) };
  let nth = 0; const regions = secs.map((x, j) => regionEl(card, r, x, j, x.chapter === "decisions" ? ++nth : 0, ctx)); regions.push(endRegion(card, r, secs.length + 1, ctx));
  const order = [...secs.map((x) => x.key), "end"], ci = order.indexOf(B.cur.get(card)), next = order[ci + 1], names = Object.fromEntries(secs.map((x, j) => [x.key, `${String(j + 1).padStart(2, "0")} ${chapterName(x.chapter)}`])); names.end = T("Your questions", "你的問題");
  const lod = LOD(camOf(card).s), focus = B.focus.get(card), merged = threads.some((x) => x.merged), sheet = B.sheet.get(card);
  // the outline counts cards (則) and the questions not understood, as the prototype's
  const counts = (key) => { const ths = threads.filter((x) => x.anchor.scene === key), n = ths.reduce((m, x) => m + x.nodes.length, 0), u = ths.filter(confusedOf).length; return ths.length ? h("span", { class: "rb-ocnt", "data-outline-count": `${n}/${u}` }, String(n), u ? h("b", {}, `/${u}`) : null) : null; };
  const outline = h("div", { class: "rb-outline", role: "list" }, order.map((key, j) => h("button", { type: "button", role: "listitem", class: `rb-ol${key === ctx.cur ? " on" : ""}${visited.has(key) ? "" : " un"}${secs[j]?.skip ? " skipped" : ""}`, "data-outline": key, "data-toc-scene": key, "aria-current": key === ctx.cur ? "true" : null, onclick: () => flyTo(card, key) },
    h("span", { class: "rb-onum" }, String(j + 1).padStart(2, "0")), h("span", { class: "rb-olb" }, key === "end" ? names.end : chapterName(secs[j].chapter), key !== "end" ? h("small", {}, secs[j].title) : null), counts(key))));
  const others = scenes.map((x, j) => [x, j]).filter(([x]) => x.turn !== sc.turn), head = r.head ? String(r.head).slice(0, 8) : "";
  const eyebrow = [r.subject?.repository, r.pr?.id ? `PR #${r.pr.id}` : null, r.task?.id || null, head ? `head ${head}` : null].filter(Boolean).join(" · ");
  const rail = h("nav", { class: `rb-rail${sheet === "outline" ? " open" : ""}`, "data-board-rail": card, "aria-label": T("Chapters and the map", "章節與小地圖") },
    phone() ? h("button", { type: "button", class: "rb-sheetx", "aria-label": T("Close", "關閉"), onclick: () => { B.sheet.delete(card); rerender(); } }, "×") : null,
    h("div", { class: "rb-lesson" }, eyebrow ? h("div", { class: "rp-eyebrow rb-eyebrow" }, eyebrow) : null, h("b", {}, T(r.card.title?.en || r.card.id, r.card.title?.["zh-TW"] || r.card.title?.en || r.card.id)), autoNote(r, t)),
    h("h6", {}, T("Map", "小地圖")), miniSvg(card),
    h("label", { class: "rb-filter" }, h("input", { type: "checkbox", "data-only-asked": "", checked: B.only.has(card), onchange: (e) => { if (e.target.checked) B.only.add(card); else B.only.delete(card); rerender(); if (e.target.checked) fitAll(card); } }), T("Only the chapters with questions", "只看有問題的")),
    h("h6", {}, T("Chapters · asked / open", "章節 · 問題／未解")), outline,
    others.length ? [h("h6", {}, T("Other scenes", "其他場景")), h("div", { class: "rb-others" }, others.map(([x, j]) => h("button", { type: "button", class: "rb-ol other", "data-other-scene": x.key, onclick: () => { RR.scene.set(card, j); rerender(); } }, h("span", { class: "rb-olb" }, clip(x.title, 40)))))] : null);
  const notes = h("aside", { class: `rb-notes${sheet === "notes" ? " open" : ""}`, "data-board-notes": card, "aria-label": T("Your questions", "你的問題") },
    phone() ? h("button", { type: "button", class: "rb-sheetx", "aria-label": T("Close", "關閉"), onclick: () => { B.sheet.delete(card); rerender(); } }, "×") : null,
    h("h3", {}, T("Your questions", "我的標註")), h("p", { class: "rb-hint" }, T("Click any sentence, a box, line or transition of a drawing, or a row of a transaction or a call, and ask right there. Click a question here to focus it.", "點任何一句話、圖上的框、線或轉換，或交易、呼叫的一列，就在那裡問。點這裡的一則會聚焦到它。")),
    threads.length ? notesList(card, [...threads].sort((a, b) => a.n - b.n), "side") : h("p", { class: "rb-empty" }, T("No question yet.", "還沒有標註。")));
  const tools = h("div", { class: "rb-tools", role: "toolbar", "aria-label": T("The board", "白板") },
    live ? h("button", { type: "button", class: "rb-btn", "data-board-tidy": "", disabled: B.busy.has(`${card}/tidy`), title: T("Fold the questions you understood back into their chapters", "把懂了的問答併回章節"), onclick: () => tidy(card) }, B.busy.has(`${card}/tidy`) ? T("Tidying…", "整理中…") : T("Tidy the board", "整理白板")) : null,
    merged ? h("span", { class: "rb-seg", role: "group", "aria-label": T("Before or after tidying", "整理前或整理後") }, ["before", "after"].map((v) => h("button", { type: "button", "data-tidy-view": v, "aria-pressed": String((v === "before") === B.before.has(card)), onclick: () => { if (v === "before") B.before.add(card); else B.before.delete(card); rerender(); } }, v === "before" ? T("Before", "整理前") : T("After", "整理後")))) : null,
    live && r.followUps?.on ? h("label", { class: "rb-toolnote rb-agree" }, h("input", { type: "checkbox", "data-followups": "", checked: true, onchange: (e) => { if (!e.target.checked) lessonOp(card, { op: "consent", on: false }); } }), T(" Questions start right away", " 追問直接開始")) : null,
    h("button", { type: "button", class: "rb-btn ghost", "data-report-step": t.n, onclick: () => { RR.step.add(`${card}/${t.n}`); rerender(); } }, T("Step through on the stage", "在舞台上逐步看")),
    !phone() ? h("button", { type: "button", class: "rb-btn ghost", "data-notes-toggle": "", "aria-pressed": String(innerWidth > 1180 ? !B.notes.has(card) : B.notes.has(card)), onclick: () => { if (B.notes.has(card)) B.notes.delete(card); else B.notes.add(card); rerender(); } }, T(`Questions ${threads.length}`, `標註 ${threads.length}`)) : null);
  const vp = h("div", { class: `rb-vp${B.only.has(card) ? " only" : ""}`, "data-board-vp": card, tabindex: "-1", onpointerdown: (e) => pointerDown(card, e), onwheel: (e) => wheel(card, e), onclick: (e) => click(card, r, e), onfocusin: (e) => focusIn(card, e), onscroll: (e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0; } },
    h("div", { class: `rb-plane${focus ? " focusing" : ""}${B.before.has(card) ? " before" : ""}`, "data-board-plane": card, "data-lod": lod, "data-focus": focus ? focus.n : null },
      (() => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", "rb-links"); s.setAttribute("data-board-links", ""); s.setAttribute("aria-hidden", "true"); return s; })(), regions));
  const curName = names[ctx.cur] || "";
  const notesOpen = innerWidth > 1180 ? !B.notes.has(card) : B.notes.has(card);
  const el = h("section", { class: `rr-stage board${notesOpen ? "" : " nonotes"}`, "data-stage": card, "data-scene": ctx.cur, "data-view": "board", "data-report": t.n, "aria-label": T("The lesson board", "課程白板") },
    rail,
    h("div", { class: "rb-main" }, vp, tools,
      focus ? h("div", { class: "rb-focusbar", role: "status", "data-focus-bar": focus.n }, h("span", {}, T(`Focused on #${focus.n} · ${clip((threads.find((x) => x.n === focus.n)?.anchor.text) || "", 24)}`, `聚焦 #${focus.n} · ${clip((threads.find((x) => x.n === focus.n)?.anchor.text) || "", 24)}`)), h("button", { type: "button", "data-focus-exit": "", onclick: () => unfocus(card) }, T("Esc to return", "Esc 返回"))) : null,
      B.toast?.card === card ? h("div", { class: `rb-toast${B.toast.bad ? " bad" : ""}`, role: "status", "data-board-toast": "" }, B.toast.text) : null,
      h("button", { type: "button", class: "rb-next", "data-board-next": next || "", onclick: () => step(card, 1) }, next ? T(`Next: ${names[next]} ▸`, `下一段：${names[next]} ▸`) : T("Back to the whole board", "回到全覽")),
      h("div", { class: "rb-zoom", role: "group", "aria-label": T("Zoom", "縮放") }, h("button", { type: "button", "data-zoom-out": "", "aria-label": T("Zoom out", "縮小"), onclick: () => { const v = vpOf(card); zoomAt(card, 0.8, v.clientWidth / 2, v.clientHeight / 2, true); } }, "−"),
        h("span", { "data-zoom-pct": "", "aria-live": "polite" }, `${Math.round(camOf(card).s * 100)}%`), h("button", { type: "button", "data-zoom-in": "", "aria-label": T("Zoom in", "放大"), onclick: () => { const v = vpOf(card); zoomAt(card, 1.25, v.clientWidth / 2, v.clientHeight / 2, true); } }, "+"),
        h("button", { type: "button", class: "fit", "data-zoom-fit": "", onclick: () => fitAll(card) }, T("Fit all", "全覽")))),
    notesOpen || phone() ? notes : null,
    phone() ? h("nav", { class: "rb-phonebar", "aria-label": T("The board", "白板") }, h("button", { type: "button", "data-sheet": "outline", "aria-pressed": String(sheet === "outline"), onclick: () => { B.sheet.get(card) === "outline" ? B.sheet.delete(card) : B.sheet.set(card, "outline"); rerender(); } }, T("Chapters", "章節")),
      h("button", { type: "button", "data-board-next-phone": next || "", onclick: () => step(card, 1) }, next ? T("Next ▸", "下一段 ▸") : T("All", "全覽")),
      h("button", { type: "button", "data-sheet": "notes", "aria-pressed": String(sheet === "notes"), onclick: () => { B.sheet.get(card) === "notes" ? B.sheet.delete(card) : B.sheet.set(card, "notes"); rerender(); } }, T("Questions ", "標註 "), h("b", {}, String(threads.length)))) : null,
    sheet ? h("div", { class: "rb-scrim", onclick: () => { B.sheet.delete(card); rerender(); } }) : null,
    popover(card, r), h("span", { class: "sr", "aria-live": "polite", "data-board-where": "" }, T(`Chapter ${curName}`, `章節 ${curName}`)));
  queueMicrotask(() => after(card));
  return el;
}
/** forget everything kept for a room (it was started over) */
function forget(card) { for (const m of [B.cam, B.lock, B.cur, B.visited, B.pend, B.focus, B.sheet, B.L, B.reveal, B.err, B.lod, B.focusKey, B.lastScene]) m.delete(card); for (const s of [B.only, B.before, B.notes]) s.delete(card);
  for (const s of [B.peek]) for (const k of [...s]) if (k.startsWith(`${card}/`)) s.delete(k); for (const m of [B.ver, B.code, B.figs]) for (const k of [...m.keys()]) if (k.startsWith(`${card}/`)) m.delete(k); if (B.pop?.card === card) B.pop = null; }
return { view, keydown, forget, state: B, fly: flyTo, layoutOf: (card) => B.L.get(card), relayout: (card) => layout(card), camOf };
};
})();
