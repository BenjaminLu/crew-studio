// The review room (#/review/<merge card>; docs/units/review-room.md, src/domain/review-room.ts): a BOARD the tutor draws
// on step by step (flowcharts built up one part at a time, diff hunks, code excerpts and before / after from the real
// commits) and a CHAT where the captain asks. Each turn is a paid model round: the captain confirms the provider and
// model before it starts. Every claim shows its basis: a citation opens the diff hunk, the ledger entry, the commit or
// the web source it rests on; a claim without one reads "Inference". Model text only ever goes into text nodes.
(() => {
const RR = { rooms: new Map(), loading: new Set(), confirm: new Map(), draft: new Map(), posting: new Set(), err: new Map(), steps: new Map(), cite: new Map(), poll: null };
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code, offer: j.offer }); return j; };
const uiLang = () => (["zh-TW", "zh-CN"].includes(document.documentElement.lang) ? document.documentElement.lang : "en");
const rerender = () => { if (S.route?.name === "review") render(); };
const enc = encodeURIComponent;
const page = (title, sub, ...kids) => h("div", { class: "page rr-page" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null)), ...kids);
async function load(id, open = false) {
  if (RR.loading.has(id)) return; RR.loading.add(id);
  try { RR.rooms.set(id, await api(`/api/review-room/${enc(id)}${open ? "?open=1" : ""}`)); RR.err.delete(id); }
  catch (e) { if (!RR.rooms.has(id)) RR.rooms.set(id, { error: e.message }); else RR.err.set(id, e.message); }
  finally { RR.loading.delete(id); rerender(); schedule(); }
}
// while a turn runs, the page follows it (the live stream says when it ends; a slow poll covers a missed event)
function schedule() { clearTimeout(RR.poll); const id = S.route?.name === "review" ? S.route.arg : null, r = id && RR.rooms.get(id); if (r && r.running != null) RR.poll = setTimeout(() => load(id), 2500); }
window.liveListen?.("review-room", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} if (d.card && RR.rooms.has(d.card)) load(d.card); });

// ---------- the board's flowcharts: Studio draws mermaid's flowchart subset itself (no library, no markup) ----------
function parseFlow(code) {
  const lines = String(code || "").split(/\n|;/).map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
  const head = /^(flowchart|graph)\b\s*(LR|RL|TD|TB|BT)?/i.exec(lines[0] || ""); if (!head) return null;
  const dir = (head[2] || "TD").toUpperCase(), nodes = new Map(), edges = [];
  const node = (tok) => { const m = /^([A-Za-z0-9_-]+)\s*(?:(\(\(|\(\[|\[\[|\[|\(|\{)\s*(?:"([^"]*)"|([^\]\)\}]*?))\s*(\)\)|\]\)|\]\]|\]|\)|\}))?$/.exec(tok.trim()); if (!m) return null;
    const id = m[1], label = (m[3] ?? m[4] ?? "").trim(), prev = nodes.get(id), shape = m[2] === "{" ? "diamond" : m[2] === "((" ? "circle" : m[2] === "(" || m[2] === "([" ? "round" : m[2] ? "rect" : prev?.shape || "rect";
    nodes.set(id, { id, label: label || prev?.label || id, shape }); return id; };
  for (const raw of lines.slice(1)) {
    if (/^(subgraph|end\b|style|classDef|class\b|click|linkStyle|direction)/.test(raw)) continue;
    const t = raw.replace(/--\s+([^|>-][^>]*?)\s+-->/g, "-->|$1|").replace(/==\s+([^|=>][^>]*?)\s+==>/g, "==>|$1|").replace(/-\.\s+([^|>.-][^>]*?)\s+\.->/g, "-.->|$1|");
    const re = /\s*(-->|==>|-\.->|---|--o|--x)\s*(?:\|([^|]*)\|)?\s*/g, segs = [], arrows = []; let last = 0, m;
    while ((m = re.exec(t))) { segs.push(t.slice(last, m.index)); arrows.push({ kind: m[1], label: (m[2] || "").trim() }); last = re.lastIndex; }
    segs.push(t.slice(last));
    const ids = segs.map((sg) => sg.split("&").map(node).filter(Boolean));
    for (let i = 0; i < arrows.length; i++) for (const a of ids[i] || []) for (const b of ids[i + 1] || []) edges.push({ from: a, to: b, label: arrows[i].label, dashed: arrows[i].kind === "-.->" });
  }
  return nodes.size ? { dir, nodes: [...nodes.values()], edges } : null;
}
const SVGNS = "http://www.w3.org/2000/svg";
const sv = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v)); for (const c of kids) if (c != null) e.append(c); return e; };
function wrapLabel(s, n = 22) { const words = String(s).split(/\s+/), out = []; let cur = ""; for (const w of words) { if ((cur + " " + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); } if (cur) out.push(cur); return out.slice(0, 4); }
/** an SVG of a flowchart; nodes and edges not in `prev` (the step before) are marked new */
function flowSvg(g, prev) {
  const rank = new Map(g.nodes.map((n) => [n.id, 0]));
  for (let k = 0; k < g.nodes.length; k++) for (const e of g.edges) if (e.from !== e.to && rank.get(e.to) <= rank.get(e.from) && rank.get(e.from) < g.nodes.length) rank.set(e.to, rank.get(e.from) + 1);
  const cols = new Map(); for (const n of g.nodes) { const r = rank.get(n.id); if (!cols.has(r)) cols.set(r, []); cols.get(r).push(n); }
  const horiz = g.dir === "LR" || g.dir === "RL", W = 170, H = 58, GX = horiz ? 70 : 30, GY = horiz ? 26 : 56, pos = new Map();
  for (const [r, list] of cols) list.forEach((n, i) => { pos.set(n.id, horiz ? { x: 20 + r * (W + GX), y: 20 + i * (H + GY) } : { x: 20 + i * (W + GX), y: 20 + r * (H + GY) }); });
  const maxX = Math.max(...[...pos.values()].map((p) => p.x)) + W + 20, maxY = Math.max(...[...pos.values()].map((p) => p.y)) + H + 20;
  if (g.dir === "RL" || g.dir === "BT") for (const p of pos.values()) { if (g.dir === "RL") p.x = maxX - W - p.x; else p.y = maxY - H - p.y; }
  const old = prev ? { nodes: new Set(prev.nodes.map((n) => n.id)), edges: new Set(prev.edges.map((e) => `${e.from}>${e.to}`)) } : null;
  const svg = sv("svg", { viewBox: `0 0 ${maxX} ${maxY}`, width: maxX, class: "rr-flow", role: "img" });
  svg.append(sv("defs", {}, sv("marker", { id: "rr-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, sv("path", { d: "M0,0 L10,5 L0,10 z", class: "rr-arrowhead" }))));
  for (const e of g.edges) { const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) continue;
    const [x1, y1, x2, y2] = horiz ? [a.x + W, a.y + H / 2, b.x, b.y + H / 2] : [a.x + W / 2, a.y + H, b.x + W / 2, b.y];
    const isNew = old && !old.edges.has(`${e.from}>${e.to}`);
    svg.append(sv("line", { x1, y1, x2, y2, class: `rr-edge${e.dashed ? " dashed" : ""}${isNew ? " rr-new" : ""}`, "marker-end": "url(#rr-arrow)", "data-edge": `${e.from}>${e.to}` }));
    if (e.label) { const t = sv("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, class: "rr-elabel", "text-anchor": "middle" }); t.textContent = e.label.slice(0, 40); svg.append(t); } }
  for (const n of g.nodes) { const p = pos.get(n.id), isNew = old && !old.nodes.has(n.id), grp = sv("g", { class: `rr-node${isNew ? " rr-new" : ""}`, "data-node": n.id });
    grp.append(n.shape === "diamond" ? sv("polygon", { points: `${p.x + W / 2},${p.y} ${p.x + W},${p.y + H / 2} ${p.x + W / 2},${p.y + H} ${p.x},${p.y + H / 2}` }) : sv("rect", { x: p.x, y: p.y, width: W, height: H, rx: n.shape === "round" || n.shape === "circle" ? 26 : 8 }));
    const ls = wrapLabel(n.label); ls.forEach((l, i) => { const t = sv("text", { x: p.x + W / 2, y: p.y + H / 2 + (i - (ls.length - 1) / 2) * 14 + 4, "text-anchor": "middle" }); t.textContent = l; grp.append(t); });
    svg.append(grp); }
  return svg;
}

// ---------- citations: a link to what a claim rests on ----------
const CITE = /\[(diff|ledger|commit|source|board):([^\]\s]{1,300})\]|\[(inference|inferred|speculative|direct|supported)\]/gi;
const KIND = { diff: ["diff", "diff"], ledger: ["ledger", "帳本"], commit: ["commit", "commit"], source: ["source", "來源"], board: ["board", "白板"] };
function citeChip(card, ref, ok) {
  const [k, v] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)];
  return h("button", { type: "button", class: `rr-cite${ok === false ? " bad" : ""}`, "data-cite": ref, title: ok === false ? T("Studio could not verify this citation", "Studio 無法驗證這個引用") : T("Open what this rests on", "開啟依據"), onclick: () => openCite(card, ref) },
    `${T(KIND[k]?.[0] || k, KIND[k]?.[1] || k)} ${v.length > 48 ? v.slice(0, 46) + "…" : v}`);
}
function inline(card, text, cites) {
  const ok = new Map((cites || []).map((c) => [c.ref, c.ok])), out = []; let i = 0, m; const re = new RegExp(CITE.source, "gi");
  while ((m = re.exec(text))) { if (m.index > i) out.push(...mdBits(text.slice(i, m.index))); if (m[1]) out.push(citeChip(card, `${m[1]}:${m[2]}`, ok.has(`${m[1]}:${m[2]}`) ? ok.get(`${m[1]}:${m[2]}`) : undefined)); else out.push(h("span", { class: `rr-tier ${m[3].toLowerCase()}` }, m[3])); i = re.lastIndex; }
  if (i < text.length) out.push(...mdBits(text.slice(i))); return out;
}
function mdBits(s) { const out = [], re = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`/g; let i = 0, m; while ((m = re.exec(s))) { if (m.index > i) out.push(s.slice(i, m.index)); out.push(m[2] != null ? h("code", {}, m[2]) : h("strong", {}, m[1])); i = re.lastIndex; } if (i < s.length) out.push(s.slice(i)); return out; }
const inferenceBadge = () => h("span", { class: "rr-inference", "data-basis": "inference", title: T("No basis cited: this is the tutor's inference, not a fact from the record", "沒有引用依據：這是導師的推論，不是紀錄裡的事實") }, T("Inference", "推論"));
async function openCite(card, ref) {
  RR.cite.set(card, { ref, loading: true }); rerender();
  try { RR.cite.set(card, { ref, data: await api(`/api/review-room/${enc(card)}/cite?ref=${enc(ref)}`) }); } catch (e) { RR.cite.set(card, { ref, error: e.message }); }
  rerender(); requestAnimationFrame(() => document.querySelector("[data-cite-panel]")?.focus?.());
}
function citePanel(r) {
  const c = RR.cite.get(r.card.id); if (!c) return null; const d = c.data;
  const body = c.loading ? h("p", { class: "faint" }, T("Loading…", "載入中…")) : c.error ? h("p", { class: "rr-err" }, c.error)
    : d.kind === "diff" ? [h("div", { class: "rr-item-h" }, h("code", {}, `${d.path}${d.from ? `:${d.from}-${d.to}` : ""}`), h("span", { class: "faint" }, ` @ ${String(d.head).slice(0, 8)}`)), diffPre(d.text)]
    : d.kind === "ledger" ? [h("p", {}, h("b", {}, `#${d.seq} ${d.check}`), ` · ${d.verdict}`, d.head ? ` @ ${String(d.head).slice(0, 8)}` : ""), d.findings?.length ? h("ul", {}, d.findings.map((f) => h("li", {}, f))) : null, h("a", { href: `#/run/${enc(d.task)}`, "data-ledger-link": d.seq }, T("Open the Task's ledger", "開啟任務的帳本"))]
    : d.kind === "commit" ? h("pre", { class: "rr-pre" }, d.text)
    : d.kind === "source" ? [h("p", {}, d.kind === "source" && d.query ? T(`Search: ${d.query}`, `搜尋：${d.query}`) : ""), d.url ? h("a", { href: d.url, target: "_blank", rel: "noopener noreferrer", "data-source-link": d.n }, d.url) : null, d.refused ? h("p", { class: "rr-err" }, T(`Refused: ${d.refused}`, `已拒絕：${d.refused}`)) : null]
    : d.kind === "board" ? h("a", { href: `#rr-${d.item.id}`, onclick: (e) => { e.preventDefault(); document.getElementById(`rr-${d.item.id}`)?.scrollIntoView({ block: "center" }); } }, T(`Board item ${d.item.id}: ${d.item.title}`, `白板項目 ${d.item.id}：${d.item.title}`)) : null;
  return h("section", { class: "card x-pad rr-cite-panel", "data-cite-panel": c.ref, tabindex: "-1", "aria-label": T("Citation", "引用") },
    h("div", { class: "rr-item-h" }, h("b", {}, T("Basis", "依據")), h("code", {}, c.ref), h("span", { class: "x-grow" }), h("button", { type: "button", class: "btn ghost", onclick: () => { RR.cite.delete(r.card.id); rerender(); } }, T("Close", "關閉"))), body);
}

// ---------- the board ----------
const diffPre = (text) => h("pre", { class: "rr-pre rr-diff" }, String(text || "").split("\n").map((l) => h("span", { class: l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : "" }, l || " ")));
const linesPre = (x, hl = []) => !x ? h("p", { class: "faint" }, T("(not in this commit)", "（這個 commit 沒有）")) : x.binary ? h("p", { class: "faint" }, T("(a binary file)", "（二進位檔）"))
  : h("pre", { class: "rr-pre rr-code" }, x.lines.map((l, i) => h("span", { class: hl.includes(x.start + i) ? "hl" : "", "data-line": x.start + i }, h("i", {}, String(x.start + i).padStart(4)), " ", l)));
function basisRow(card, it) { return it.basis === "inference" ? h("div", { class: "rr-basis" }, inferenceBadge()) : it.cites?.length ? h("div", { class: "rr-basis" }, it.cites.map((c) => citeChip(card, c.ref, c.ok))) : null; }
function itemView(card, it, prev) {
  const head = h("div", { class: "rr-item-h" }, h("span", { class: "vbadge" }, it.type), h("b", {}, it.title || ""), it.path ? h("code", { "data-item-path": it.path }, `${it.path}${it.start ? `:${it.start}-${it.end}` : ""}`) : null, it.commit ? h("span", { class: "faint" }, ` @ ${String(it.commit).slice(0, 8)}`) : null);
  let body;
  if (it.type === "mermaid") { const g = parseFlow(it.code), p = prev ? parseFlow(prev.code) : null; body = g ? h("div", { class: "rr-flow-wrap", "data-flow": it.id }, flowSvg(g, p)) : [h("p", { class: "faint" }, T("Diagram source (Studio draws flowcharts; this kind is shown as text)", "圖表原始碼（Studio 會畫 flowchart；這種圖以文字顯示）")), h("pre", { class: "rr-pre" }, it.code)]; }
  else if (it.type === "diff") body = [it.header ? h("p", { class: "faint" }, it.header) : null, diffPre(it.text)];
  else if (it.type === "code") body = linesPre(it, it.highlight || []);
  else if (it.type === "compare") body = h("div", { class: "rr-compare" }, h("div", {}, h("b", {}, T("Before (base)", "之前（base）")), linesPre(it.before)), h("div", {}, h("b", {}, T("After (head)", "之後（head）")), linesPre(it.after)));
  else body = h("p", { class: "rr-note" }, inline(card, it.text || "", it.cites));
  return h("article", { class: "rr-item", id: `rr-${it.id}`, "data-board-item": it.id, "data-item-type": it.type }, head, body, basisRow(card, it));
}
function boardView(r) {
  const card = r.card.id, out = [], groups = new Map();
  for (const it of r.board) if (it.group) { const k = `${it.turn}/${it.group}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const shown = new Set();
  for (const it of r.board) {
    if (!it.group) { out.push(itemView(card, it, null)); continue; }
    const k = `${it.turn}/${it.group}`; if (shown.has(k)) continue; shown.add(k);
    const steps = groups.get(k).slice().sort((a, b) => (a.step || 0) - (b.step || 0)), key = `${card}/${k}`, at = Math.min(RR.steps.get(key) ?? steps.length - 1, steps.length - 1), cur = steps[at];
    const go = (n) => { RR.steps.set(key, Math.max(0, Math.min(steps.length - 1, n))); rerender(); };
    out.push(h("section", { class: "rr-steps", "data-build-up": it.group, "data-step": at + 1, "data-steps": steps.length },
      h("div", { class: "rr-step-bar" }, h("b", {}, T(`Step ${at + 1} of ${steps.length}`, `第 ${at + 1} 步，共 ${steps.length} 步`)),
        h("button", { type: "button", class: "btn ghost", "data-step-prev": "", disabled: at === 0, onclick: () => go(at - 1) }, T("← Back", "← 上一步")),
        h("button", { type: "button", class: "btn ghost", "data-step-next": "", disabled: at === steps.length - 1, onclick: () => go(at + 1) }, T("Next part →", "下一部分 →"))),
      itemView(card, cur, at ? steps[at - 1] : null)));
  }
  return h("section", { class: "card x-pad rr-board", "data-board": card, "aria-label": T("Board", "白板") }, h("h2", {}, T("Board", "白板")),
    out.length ? out : h("p", { class: "faint", "data-board-empty": "" }, T("The tutor draws here: diagrams built up one part at a time, the diff, code at the head, before and after.", "導師會在這裡畫：一步一步組起來的圖、diff、head 的程式碼、改動前後。")));
}

// ---------- the chat ----------
const ACTION_LABEL = { ask: ["Question", "提問"], how: ["How", "怎麼運作"], why: ["Why", "為什麼"], teach: ["Teach me", "教我"], "merge-check": ["Before merging", "合併前檢查"], quiz: ["Check me", "考考我"] };
function answerView(card, t) {
  if (t.status === "running") return h("p", { class: "faint", "data-turn-running": "" }, T(`The tutor is working (${t.provider} · ${t.model})…`, `導師作答中（${t.provider} · ${t.model}）…`));
  if (t.status !== "done") return h("p", { class: "rr-err", "data-turn-failed": t.status }, t.status === "interrupted" ? T("Interrupted: Studio stopped during this turn.", "中斷：這一回合進行時 Studio 停止了。") : `${T("Failed", "失敗")}: ${t.error || ""}`);
  const claims = t.claims?.length ? t.claims : [{ text: t.answer, kind: "claim", basis: "inference", cites: [] }];
  return h("div", { class: "rr-answer" }, claims.map((c) => c.kind === "heading" ? h("h4", {}, c.text.replace(/^\s*#+\s*/, "")) : c.kind === "code" ? h("pre", { class: "rr-pre" }, c.text.replace(/^\s*```[^\n]*\n?|\n?\s*```\s*$/g, ""))
    : h("p", { class: `rr-claim${c.basis === "inference" ? " inference" : ""}`, "data-claim": c.basis || c.kind }, c.basis === "inference" ? inferenceBadge() : null, inline(card, c.text.replace(/^\s*[-*+]\s+/, "• "), c.cites))));
}
function chatView(r) {
  const card = r.card.id, busy = r.running != null || RR.posting.has(card), offer = r.offer, conf = RR.confirm.get(card), err = RR.err.get(card);
  const ask = (action) => { const text = action === "ask" ? (RR.draft.get(card) || "").trim() : ""; if (action === "ask" && !text) return; RR.confirm.set(card, { action, text }); rerender(); };
  const start = async () => { const c = RR.confirm.get(card); if (!c || busy) return; RR.posting.add(card); RR.err.delete(card); rerender();
    try { const room = await postJ(`/api/review-room/${enc(card)}/turn`, { action: c.action, text: c.text, lang: uiLang(), confirm: offer?.hash }); RR.rooms.set(card, room); RR.confirm.delete(card); if (c.action === "ask") RR.draft.delete(card); }
    catch (e) { RR.err.set(card, e.message); if (e.offer) RR.rooms.set(card, { ...r, offer: e.offer }); }
    finally { RR.posting.delete(card); rerender(); schedule(); } };
  const turns = r.turns.map((t) => h("li", { class: "rr-turn", "data-turn": t.n, "data-turn-status": t.status },
    h("div", { class: "rr-msg captain" }, h("span", { class: "vbadge" }, T(...(ACTION_LABEL[t.action] || [t.action, t.action]))), " ", t.text),
    h("div", { class: "rr-msg tutor" }, answerView(card, t), t.status === "done" && t.cost?.usd != null ? h("span", { class: "faint rr-cost" }, `$${Number(t.cost.usd).toFixed(2)} · ${t.provider} · ${t.model}`) : null)));
  const controls = !r.open ? [h("p", { class: "faint", "data-room-closed": "" }, T("The merge card is answered: this room is read-only now.", "合併卡已回覆：審查室現在只能閱讀。"))]
    : offer?.error ? [h("p", { class: "rr-err", "data-room-unavailable": "" }, offer.error)]
    : [h("div", { class: "rr-quick", role: "group", "aria-label": T("Quick actions", "快速動作") }, r.actions.map((a) => h("button", { type: "button", class: "btn", "data-room-action": a.id, disabled: busy, onclick: () => ask(a.id) }, T(...(ACTION_LABEL[a.id] || [a.en, a.zh]))))),
      h("label", { class: "field" }, h("span", { class: "lbl" }, T("Ask anything about this change", "問任何關於這個改動的問題")),
        h("textarea", { class: "input", rows: 3, maxlength: 4000, "data-room-text": card, disabled: busy, oninput: (e) => { RR.draft.set(card, e.target.value); } }, RR.draft.get(card) || "")),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", "data-room-send": "", disabled: busy, onclick: () => ask("ask") }, T("Ask", "送出問題"))),
      conf ? h("div", { class: "rr-confirm", role: "group", "data-room-confirm": conf.action, "aria-label": T("Confirm the paid round", "確認付費回合") },
        h("p", {}, T(`This starts a paid model round on ${offer.provider} · ${offer.model ?? "default model"}${offer.effort ? ` (${offer.effort})` : ""}. The tutor only reads the code; nothing is written, and nothing is sent to GitHub.`,
          `這會開始一次付費的模型執行：${offer.provider} · ${offer.model ?? "預設模型"}${offer.effort ? `（${offer.effort}）` : ""}。導師只讀程式碼，不寫任何東西，也不送任何東西到 GitHub。`)),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", "data-room-start": "", disabled: busy, onclick: start }, T("Start the round", "開始這一回合")),
          h("button", { type: "button", class: "btn ghost", "data-room-cancel": "", disabled: RR.posting.has(card), onclick: () => { RR.confirm.delete(card); rerender(); } }, T("Cancel", "取消")))) : null,
      busy ? h("p", { class: "faint", role: "status", "data-room-busy": "" }, T("The tutor is working; one turn at a time.", "導師作答中；一次一回合。")) : null];
  return h("section", { class: "card x-pad rr-chat", "data-chat": card, "aria-label": T("Chat", "對話") }, h("h2", {}, T("Chat", "對話")),
    r.turns.length ? h("ol", { class: "rr-turns" }, turns) : h("p", { class: "faint" }, T("Ask the tutor how this change works, why it is built this way, or what to check before you merge.", "可以問導師：這個改動怎麼運作、為什麼這樣做、合併前要檢查什麼。")),
    err ? h("p", { class: "rr-err", role: "alert", "data-room-error": "" }, err) : null, ...controls);
}
function sideView(r) {
  const q = r.check.questions, graded = q.filter((x) => x.result), right = graded.filter((x) => x.result.correct).length;
  return h("section", { class: "card x-pad rr-side" },
    h("h2", {}, T("Understanding check", "理解檢查")),
    q.length ? [h("p", { "data-check-score": "" }, graded.length ? T(`${right} of ${graded.length} correct`, `答對 ${right}/${graded.length}`) : T("Not answered yet: answer in the chat.", "還沒作答：請在對話裡回答。")),
      h("ol", { class: "rr-check" }, q.map((x) => h("li", { "data-check": x.n, "data-check-result": x.result ? (x.result.correct ? "correct" : "missed") : "open" }, x.q, x.result ? h("span", { class: `rr-mark ${x.result.correct ? "ok" : "miss"}` }, x.result.correct ? T(" ✓ correct", " ✓ 正確") : T(" ✗ missed: re-explained", " ✗ 沒答對：已重新講解")) : null, x.result?.note ? h("div", { class: "faint" }, x.result.note) : null)))]
      : h("p", { class: "faint" }, T("Press “Check me” for 2 to 4 short questions. Display only: it never blocks the merge.", "按「考考我」會有 2 到 4 個小問題。僅供參考，不會擋合併。")),
    h("h2", {}, T("Sources", "來源")),
    r.sources.length ? h("ul", { class: "rr-sources" }, r.sources.map((s) => h("li", { "data-source": s.n, "data-source-ok": String(s.ok) }, h("span", { class: "vbadge" }, `${s.n} ${s.kind === "search" ? T("search", "搜尋") : T("page", "網頁")}`), " ",
      s.kind === "search" ? s.query : s.url && s.ok ? h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.url) : s.url, s.refused ? h("span", { class: "rr-err" }, T(` refused: ${s.refused}`, ` 已拒絕：${s.refused}`)) : s.error ? h("span", { class: "faint" }, ` ${s.error}`) : null)))
      : h("p", { class: "faint" }, T("Every web search and page the tutor uses is listed here. Studio refuses any that would carry this repository's code or names.", "導師用到的每個網路搜尋和網頁都列在這裡；會帶出這個儲存庫程式碼或名稱的查詢，Studio 一律拒絕。")));
}
routes.review = (arg) => {
  if (!arg) return page(T("Review room", "審查室"), T("Open a review room from a merge card.", "請從合併卡開啟審查室。"));
  const r = RR.rooms.get(arg);
  if (!r) { load(arg, true); return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad faint" }, T("Loading…", "載入中…"))); }
  if (r.error) return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad rr-err", "data-room-error": "" }, r.error));
  const title = T(r.card.title?.en || r.card.id, r.card.title?.["zh-TW"] || r.card.title?.en || r.card.id);
  return page(T("Review room", "審查室"), T(`${r.task.title} · ${r.card.id}${r.pr?.id ? ` · PR #${r.pr.id}` : ""} · head ${String(r.head || "").slice(0, 8)}. The tutor reads only; the room never answers the merge card.`, `${r.task.title} · ${r.card.id}${r.pr?.id ? ` · PR #${r.pr.id}` : ""} · head ${String(r.head || "").slice(0, 8)}。導師只讀；審查室不會回覆合併卡。`),
    h("div", { class: "rr-top" }, h("b", {}, title), h("a", { class: "btn ghost", href: `#/run/${enc(r.card.run)}`, "data-room-task": "" }, T("Back to the Task", "回到任務")), h("a", { class: "btn ghost", href: `#/inbox/${enc(r.card.id)}` }, T("The merge card", "合併卡"))),
    citePanel(r),
    h("div", { class: "rr-wrap", "data-review-room": r.card.id }, boardView(r), h("div", { class: "rr-right" }, chatView(r), sideView(r))));
};
window.crewReviewRoom = { parseFlow };
})();
