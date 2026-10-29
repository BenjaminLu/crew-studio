// The review room (#/room/<merge card | Task | pull request>; docs/units/review-room.md, src/domain/review-room.ts): a BOARD the tutor draws
// on step by step (flowcharts built up one part at a time, diff hunks, code excerpts and before / after from the real
// commits) and a CHAT where the captain asks. Each turn is a paid model round: the captain confirms the provider and
// model before it starts. Every claim shows its basis: a citation opens the diff hunk, the ledger entry, the commit or
// the web source it rests on; a claim without one reads "Inference". Model text only ever goes into text nodes.
(() => {
const RR = { audio: null, rooms: new Map(), loading: new Set(), confirm: new Map(), draft: new Map(), posting: new Set(), err: new Map(), cite: new Map(), poll: null, shot: new Map(), zoom: null,
  scene: new Map(), reveal: new Map(), pick: new Map(), seen: new Map(), drawer: new Set(), fold: new Set(), playing: null, timer: null, mic: null, rec: null, heard: false };
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code, offer: j.offer }); return j; };
const uiLang = () => (["zh-TW", "zh-CN"].includes(document.documentElement.lang) ? document.documentElement.lang : "en");
const rerender = () => { if (S.route?.name === "room") render(); };
// what a room finishes later (its poll, a live update, playback, a turn or a citation it sent, the mic) redraws only that
// room's page (redraw): never the page the captain moved on to, where a redraw would replace the button being pressed
// and swallow the click. Leaving a room stops its playback and its mic at once.
const onRoom = (id) => S.route?.name === "room" && S.route.arg === id;
const redraw = (id) => { if (onRoom(id)) render(); };
addEventListener("hashchange", () => { // after app.js's own listener: S.route is already the new page
  if (RR.playing && !onRoom(RR.playing)) stopPlay();
  if (RR.rec && !onRoom(RR.recCard)) try { RR.rec.stop(); } catch {}
});
const enc = encodeURIComponent;
const page = (title, sub, ...kids) => h("div", { class: "page rr-page" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null)), ...kids);
async function load(id, open = false) {
  if (RR.loading.has(id)) return; RR.loading.add(id);
  try { RR.rooms.set(id, await api(`/api/review-room/${enc(id)}${open ? "?open=1" : ""}`)); RR.err.delete(id); }
  catch (e) { if (!RR.rooms.has(id)) RR.rooms.set(id, { error: e.message }); else RR.err.set(id, e.message); }
  finally { RR.loading.delete(id); redraw(id); schedule(); }
}
// while a turn runs, the page follows it (the live stream says when it ends; a slow poll covers a missed event)

function schedule() { clearTimeout(RR.poll); const id = S.route?.name === "room" ? S.route.arg : null, r = id && RR.rooms.get(id); if (r && r.running != null) RR.poll = setTimeout(() => load(id), 2500); }
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
// the room's own line icons (drawn from fixed paths, nothing parsed)
const ICO = { prev: "M15 6l-6 6 6 6", next: "M9 6l6 6-6 6", play: "M8 5l11 7-11 7z", pause: "M8 5v14M16 5v14", replay: ["M4 12a8 8 0 1 0 2.4-5.7", "M4 4v4h4"], list: "M4 6h16M4 12h16M4 18h10", msg: "M4 5h16v11H9l-5 4z", x: "M6 6l12 12M18 6L6 18", send: "M5 12h14M13 6l6 6-6 6", back: "M15 6l-6 6 6 6" };
const ic = (n) => sv("svg", { viewBox: "0 0 24 24", class: "rr-ic", "aria-hidden": "true" }, ...[].concat(ICO[n]).map((d) => sv("path", { d })));
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
  // the picture scales to its box (viewBox), never wider than the board, never blown up past 1.5x
  const svg = sv("svg", { viewBox: `0 0 ${maxX} ${maxY}`, class: "rr-flow", role: "img", preserveAspectRatio: "xMidYMid meet", style: `max-width:${Math.round(maxX * 1.5)}px;max-height:${Math.round(maxY * 1.5)}px` });
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
const CITE = /\[(diff|ledger|commit|source|board|review):([^\]\s]{1,300})\]|\[(inference|inferred|speculative|direct|supported)\]/gi;
const KIND = { diff: ["diff", "diff"], ledger: ["ledger", "帳本"], commit: ["commit", "commit"], source: ["source", "來源"], board: ["board", "白板"], review: ["reviewer", "審查意見"] };
// a link only to a page the server fetched and that is http(s): anything else (a refused address, any other scheme) is text
const webLink = (s) => s && s.ok && typeof s.url === "string" && /^https?:\/\//i.test(s.url) ? s.url : null;
function citeChip(card, ref, ok) {
  const [k, v] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)], label = `${T(KIND[k]?.[0] || k, KIND[k]?.[1] || k)} ${v.length > 48 ? v.slice(0, 46) + "…" : v}`;
  // a citation Studio could not verify opens nothing
  if (ok === false) return h("span", { class: "rr-cite bad", "data-cite-invalid": ref, title: T("Studio could not verify this citation", "Studio 無法驗證這個引用") }, label);
  return h("button", { type: "button", class: `rr-cite${ok === false ? " bad" : ""}`, "data-cite": ref, title: ok === false ? T("Studio could not verify this citation", "Studio 無法驗證這個引用") : T("Open what this rests on", "開啟依據"), onclick: () => openCite(card, ref) },
    `${T(KIND[k]?.[0] || k, KIND[k]?.[1] || k)} ${v.length > 48 ? v.slice(0, 46) + "…" : v}`);
}
/** Someone else's words (a reviewer's, a commit message): a short gist on the board, the full text folded under "Original"
 *  (kept open across redraws, like the transcript drawer). Text nodes only: the words are untrusted, never parsed. */
const gist = (t) => { const lines = String(t).split("\n").map((l) => l.replace(/[*`|]+/g, " ").replace(/\s+/g, " ").trim()).filter((l) => l && !/^[‹<]!--/.test(l));
  const line = lines.find((l) => !/^[>›]/.test(l) && l.replace(/^#+\s*/, "").length > 3)?.replace(/^#+\s*/, "") || lines[0] || ""; return line.length > 120 ? line.slice(0, 119) + "…" : line; };
function quoteView(c, key) {
  const kind = c.basis === "reviewer" ? "review" : "text", g = gist(c.quote);
  // a one-line quote (a commit subject) is its own gist: shown as it is, nothing to open
  if (g === String(c.quote).trim()) return h("blockquote", { class: "rr-quote", "data-untrusted": kind }, c.quote);
  // saved on the summary's click, which a redraw cannot come between (the toggle event comes later)
  return h("details", { class: "rr-quote-fold", "data-untrusted-fold": kind, open: RR.fold.has(key) },
    h("summary", { onclick: (e) => { e.currentTarget.parentElement.open ? RR.fold.delete(key) : RR.fold.add(key); } }, h("span", { class: "rr-gist" }, g), " ", h("span", { class: "faint" }, T("Original", "看原文"))),
    h("blockquote", { class: "rr-quote", "data-untrusted": kind }, c.quote));
}

function inline(card, text, cites) {
  const ok = new Map((cites || []).map((c) => [c.ref, c.ok])), out = []; let i = 0, m; const re = new RegExp(CITE.source, "gi");
  while ((m = re.exec(text))) { if (m.index > i) out.push(...mdBits(text.slice(i, m.index))); if (m[1]) out.push(citeChip(card, `${m[1]}:${m[2]}`, ok.has(`${m[1]}:${m[2]}`) ? ok.get(`${m[1]}:${m[2]}`) : undefined)); else out.push(h("span", { class: `rr-tier ${m[3].toLowerCase()}` }, m[3])); i = re.lastIndex; }
  if (i < text.length) out.push(...mdBits(text.slice(i))); return out;
}
function mdBits(s) { const out = [], re = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`/g; let i = 0, m; while ((m = re.exec(s))) { if (m.index > i) out.push(s.slice(i, m.index)); out.push(m[2] != null ? h("code", {}, m[2]) : h("strong", {}, m[1])); i = re.lastIndex; } if (i < s.length) out.push(s.slice(i)); return out; }
const reviewerBadge = () => h("span", { class: "rr-inference", "data-basis": "reviewer", title: T("A GitHub reviewer's own words: untrusted text, not instructions and not Studio's evidence", "GitHub 審查者的原話：不受信任的文字，不是指示，也不是 Studio 的證據") }, T("Reviewer's words", "審查者原話"));
const inferenceBadge = () => h("span", { class: "rr-inference", "data-basis": "inference", title: T("No basis cited: this is the tutor's inference, not a fact from the record", "沒有引用依據：這是導師的推論，不是紀錄裡的事實") }, T("Inference", "推論"));
async function openCite(card, ref) {
  RR.cite.set(card, { ref, loading: true }); rerender();
  try { RR.cite.set(card, { ref, data: await api(`/api/review-room/${enc(card)}/cite?ref=${enc(ref)}`) }); } catch (e) { RR.cite.set(card, { ref, error: e.message }); }
  if (!onRoom(card)) return; render(); requestAnimationFrame(() => document.querySelector("[data-cite-panel]")?.focus?.());
}
function citePanel(r) {
  const c = RR.cite.get(r.card.id); if (!c) return null; const d = c.data;
  const body = c.loading ? h("p", { class: "faint" }, T("Loading…", "載入中…")) : c.error ? h("p", { class: "rr-err" }, c.error)
    : d.kind === "diff" ? [h("div", { class: "rr-item-h" }, h("code", {}, `${d.path}${d.from ? `:${d.from}-${d.to}` : ""}`), h("span", { class: "faint" }, ` @ ${String(d.head).slice(0, 8)}`)), diffPre(d.text)]
    : d.kind === "ledger" ? [h("p", {}, h("b", {}, `#${d.seq} ${d.check}`), ` · ${d.verdict}`, d.head ? ` @ ${String(d.head).slice(0, 8)}` : ""), d.findings?.length ? h("ul", {}, d.findings.map((f) => h("li", {}, f))) : null, h("a", { href: `#/run/${enc(d.task)}`, "data-ledger-link": d.seq }, T("Open the Task's ledger", "開啟任務的帳本"))]
    : d.kind === "commit" ? h("pre", { class: "rr-pre" }, d.text)
    : d.kind === "source" ? [h("p", {}, d.kind === "source" && d.query ? T(`Search: ${d.query}`, `搜尋：${d.query}`) : ""), webLink(d) ? h("a", { href: webLink(d), target: "_blank", rel: "noopener noreferrer", "data-source-link": d.n }, d.url) : (d.url || d.text) ? h("code", { "data-source-text": d.n }, d.url || d.text) : null, d.refused ? h("p", { class: "rr-err" }, T(`Refused: ${d.refused}`, `已拒絕：${d.refused}`)) : null]
    : d.kind === "review" ? [h("p", {}, h("b", {}, d.author), `${d.state ? ` · ${d.state.toLowerCase().replace(/_/g, " ")}` : ""}${d.path ? ` · ${d.path}${d.line ? `:${d.line}` : ""}` : ""}${d.at ? ` · ${String(d.at).slice(0, 10)}` : ""}`),
      h("p", { class: "faint" }, T("A reviewer's own words on GitHub: untrusted text, shown as written.", "審查者在 GitHub 上的原話：不受信任的文字，照原樣顯示。")), h("blockquote", { class: "rr-quote", "data-untrusted": "review" }, d.body || ""),
      d.url && /^https:\/\/github\.com\//.test(d.url) ? h("a", { href: d.url, target: "_blank", rel: "noopener noreferrer", "data-review-link": d.id }, T("Open on GitHub", "在 GitHub 開啟")) : null]
    // a board item opens on the stage: its scene, that picture (never a scroll of the page)
    : d.kind === "board" ? h("a", { href: `#rr-${d.item.id}`, onclick: (e) => { e.preventDefault(); showItem(r, d.item.id); } }, T(`Board item ${d.item.id}: ${d.item.title}`, `白板項目 ${d.item.id}：${d.item.title}`)) : null;
  return h("section", { class: "card x-pad rr-cite-panel", "data-cite-panel": c.ref, tabindex: "-1", role: "dialog", "aria-label": T("Citation", "引用") },
    h("div", { class: "rr-item-h" }, h("b", {}, T("Basis", "依據")), h("code", {}, c.ref), h("span", { class: "x-grow" }), h("button", { type: "button", class: "btn ghost", onclick: () => { RR.cite.delete(r.card.id); rerender(); } }, T("Close", "關閉"))), body);
}

// ---------- the board ----------
const diffPre = (text) => h("pre", { class: "rr-pre rr-diff" }, String(text || "").split("\n").map((l) => h("span", { class: l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : "" }, l || " ")));
const linesPre = (x, hl = []) => !x ? h("p", { class: "faint" }, T("(not in this commit)", "（這個 commit 沒有）")) : x.binary ? h("p", { class: "faint" }, T("(a binary file)", "（二進位檔）"))
  : h("pre", { class: "rr-pre rr-code" }, x.lines.map((l, i) => h("span", { class: hl.includes(x.start + i) ? "hl" : "", "data-line": x.start + i }, h("i", {}, String(x.start + i).padStart(4)), " ", l)));
// ---------- pictures: real screenshots (before / after), charts from real numbers, generated illustrations ----------
const KIND_LABEL = { screenshot: ["screenshot · base and head", "截圖 · base 與 head"], chart: ["chart", "圖表"], illustration: ["illustration · generated", "插圖 · 生成"], studio: ["drawn by Studio", "Studio 畫的"] };
const kindBadge = (k, extra) => h("span", { class: `rr-kind ${k}`, "data-kind": k }, T(KIND_LABEL[k][0], KIND_LABEL[k][1]), extra ? ` · ${extra}` : "");
const zoom = (src, alt) => { RR.zoom = { src, alt }; rerender(); requestAnimationFrame(() => document.querySelector("[data-zoom] button")?.focus()); };
function shotView(card, it) {
  const key = `${card}/${it.id}`, side = RR.shot.get(key) || "after", pick = (p) => side === "before" ? p.before : p.after;
  return h("div", { class: "rr-shots", "data-shot-side": side },
    h("div", { class: "rr-toggle", role: "group", "aria-label": T("Before or after", "之前或之後") }, ["before", "after"].map((sd) => h("button", { type: "button", class: "btn ghost", "data-shot-toggle": sd, "aria-pressed": String(side === sd), onclick: () => { RR.shot.set(key, sd); rerender(); } }, sd === "before" ? T("Before (base)", "之前（base）") : T("After (head)", "之後（head）")))),
    it.pages.map((p) => h("figure", { class: "rr-fig", "data-shot-page": p.label }, pick(p) ? h("img", { src: pick(p), alt: `${p.label} · ${side}`, loading: "lazy", "data-shot-img": side, onclick: () => zoom(pick(p), `${p.label} · ${side}`) }) : h("p", { class: "faint" }, T("(this side has no picture: the page did not build)", "（這一側沒有圖：頁面沒有建置出來）")),
      h("figcaption", {}, p.label, p.changed && (p.changed.added?.length || p.changed.removed?.length) ? h("span", { class: "faint" }, ` · ${T("text changed", "文字有變")}: ${(p.changed.removed || []).slice(0, 2).join(", ") || "—"} → ${(p.changed.added || []).slice(0, 2).join(", ") || "—"}`) : null))));
}
function chartView(it) {
  const rows = it.rows || [], two = it.mode === "diffstat" || it.mode === "before-after";
  const vals = rows.flatMap((r) => it.mode === "diffstat" ? [r.added, r.removed] : [r.before, r.after, r.value]).filter((v) => typeof v === "number");
  const max = Math.max(1, ...vals.map(Math.abs)), LW = 170, BW = 260, RH = two ? 34 : 22, W = LW + BW + 70, Hh = 18 + rows.length * RH;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${Hh}`, class: "rr-chart", role: "img", "data-chart": it.mode, preserveAspectRatio: "xMidYMid meet", style: `max-width:${Math.round(W * 1.6)}px;max-height:${Math.round(Hh * 1.6)}px` });
  const bar = (y, v, cls) => { if (typeof v !== "number") return; const w = Math.max(1, Math.round(Math.abs(v) / max * BW)); svg.append(sv("rect", { x: LW, y, width: w, height: 12, class: cls, "data-value": v })); const t = sv("text", { x: LW + w + 6, y: y + 10, class: "rr-chart-v" }); t.textContent = `${v}${it.unit ? " " + it.unit : ""}`; svg.append(t); };
  rows.forEach((r, i) => { const y = 14 + i * RH, l = sv("text", { x: LW - 8, y: y + 10, "text-anchor": "end", class: "rr-chart-l" }); l.textContent = r.label.length > 26 ? "…" + r.label.slice(-25) : r.label; svg.append(l);
    if (it.mode === "diffstat") { bar(y, r.added, "add"); bar(y + 14, r.removed, "del"); } else if (it.mode === "before-after") { bar(y, r.before, "before"); bar(y + 14, r.after, "after"); } else bar(y, r.value, "after"); });
  const legend = it.mode === "diffstat" ? [["add", T("lines added", "新增行數")], ["del", T("lines removed", "刪除行數")]] : it.mode === "before-after" ? [["before", T("before", "之前")], ["after", T("after", "之後")]] : [];
  return h("div", { class: "rr-chart-wrap" }, svg, legend.length ? h("div", { class: "rr-legend" }, legend.map(([c, l]) => h("span", {}, h("i", { class: c }), l))) : null);
}
function imageView(it) {
  if (it.status === "pending" || !it.src) return h("figure", { class: "rr-fig rr-pending", "data-illustration-pending": it.id }, it.turn === 0 ? h("figcaption", { class: "faint", "data-paid-image": "" }, T("A paid generated image, made once when this room was first opened.", "付費生成的圖片，在第一次開啟這個審查室時產生一次。")) : null, h("div", { class: "rr-ph", role: "img", "aria-label": T("Illustration being drawn", "插圖繪製中") }, it.status === "failed" ? T(`The illustration could not be made: ${it.error || ""}`, `插圖沒有畫成：${it.error || ""}`) : T("Drawing the illustration in the background (a minute or two)…", "正在背景繪製插圖（約一兩分鐘）…")));
  return h("figure", { class: "rr-fig" }, h("img", { src: it.src, alt: it.title, loading: "lazy", "data-illustration": it.id, onclick: () => zoom(it.src, it.title) }),
    it.turn === 0 ? h("figcaption", { class: "faint", "data-paid-image": "" }, T("A paid generated image, made once when this room was first opened.", "付費生成的圖片，在第一次開啟這個審查室時產生一次。")) : null,
    h("figcaption", { class: "faint" }, T("A generated sketch of the idea, not evidence: the claims it shows cite the diff, a check or a commit.", "生成的示意圖，不是證據：它畫的每個說法都引用 diff、檢查或 commit。")));
}
function basisRow(card, it) { return it.basis === "illustration" ? h("div", { class: "rr-basis" }, h("span", { class: "rr-inference", "data-basis": "illustration" }, T("Not evidence", "不是證據"))) : it.basis === "inference" ? h("div", { class: "rr-basis" }, inferenceBadge()) : it.cites?.length ? h("div", { class: "rr-basis" }, it.cites.map((c) => citeChip(card, c.ref, c.ok))) : null; }
function itemView(card, it, prev) {
  const head = h("div", { class: "rr-item-h" }, it.kind ? kindBadge(it.kind, it.kind === "chart" ? (it.from === "git" ? T("counted by git", "git 計算") : T("from cited numbers", "依引用的數字")) : it.kind === "illustration" && it.model ? `${it.provider} ${it.model}` : null) : h("span", { class: "vbadge" }, it.type), h("b", {}, it.title || ""), it.path ? h("code", { "data-item-path": it.path }, `${it.path}${it.start ? `:${it.start}-${it.end}` : ""}`) : null, it.commit ? h("span", { class: "faint" }, ` @ ${String(it.commit).slice(0, 8)}`) : null);
  let body;
  if (it.type === "mermaid") { const g = parseFlow(it.code), p = prev ? parseFlow(prev.code) : null; body = g ? h("div", { class: "rr-flow-wrap", "data-flow": it.id }, flowSvg(g, p)) : [h("p", { class: "faint" }, T("Diagram source (Studio draws flowcharts; this kind is shown as text)", "圖表原始碼（Studio 會畫 flowchart；這種圖以文字顯示）")), h("pre", { class: "rr-pre" }, it.code)]; }
  else if (it.type === "diff") body = [it.header ? h("p", { class: "faint" }, it.header) : null, diffPre(it.text)];
  else if (it.type === "code") body = linesPre(it, it.highlight || []);
  else if (it.type === "screenshot") body = shotView(card, it);
  else if (it.type === "chart") body = chartView(it);
  else if (it.type === "image") body = imageView(it);
  else if (it.type === "compare") body = h("div", { class: "rr-compare" }, h("div", {}, h("b", {}, T("Before (base)", "之前（base）")), linesPre(it.before)), h("div", {}, h("b", {}, T("After (head)", "之後（head）")), linesPre(it.after)));
  else if (it.type === "keycard") body = keycardView(it);
  else body = h("p", { class: "rr-note" }, inline(card, it.text || "", it.cites));
  // the picture first, filling its box; what it is (kind, title, path) and its basis under it
  const pic = ["mermaid", "chart", "screenshot", "image", "keycard"].includes(it.type);
  return h("article", { class: `rr-item rr-item-${it.type}`, id: `rr-${it.id}`, "data-board-item": it.id, "data-item-type": it.type }, h("div", { class: `rr-body${pic ? " pic" : " text"}` }, body), head, basisRow(card, it));
}
/** Studio's own picture when an answer drew none: the scene's title and the files it cites, as sticky notes (text nodes only) */
function keycardView(it) {
  const files = (it.files || []).slice(0, 4), W = 640, H = 150 + Math.ceil(files.length / 2) * 112;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "rr-keycard", role: "img", preserveAspectRatio: "xMidYMid meet", "aria-label": it.title || "", style: `max-width:${W * 1.5}px;max-height:${H * 1.5}px` });
  const title = sv("text", { x: 24, y: 64, class: "rr-hand rr-key-title" }); title.textContent = clip(it.title || "", 34); svg.append(title);
  svg.append(sv("path", { d: `M24,80 H${Math.min(W - 24, 24 + Math.max(120, (title.textContent.length || 1) * 17))}`, class: "rr-key-line" }));
  files.forEach((f, i) => { const x = 24 + (i % 2) * 304, y = 112 + Math.floor(i / 2) * 112, g = sv("g", { class: "rr-sticky", transform: `rotate(${i % 2 ? 1.5 : -1.5} ${x + 140} ${y + 44})` });
    g.append(sv("rect", { x, y, width: 280, height: 88, rx: 6 }));
    const name = String(f).split("/").pop(), dir = String(f).slice(0, Math.max(0, String(f).length - name.length - 1));
    const a = sv("text", { x: x + 16, y: y + 40, class: "rr-hand rr-sticky-name" }); a.textContent = clip(name, 26); g.append(a);
    if (dir) { const b = sv("text", { x: x + 16, y: y + 68, class: "rr-sticky-dir" }); b.textContent = clip(dir, 36); g.append(b); }
    svg.append(g); });
  return svg;
}
// ---------- the stage: each answer is a scene, a visual beside the tutor's points, revealed step by step ----------
const ACTION_LABEL = { ask: ["Question", "提問"], how: ["How", "怎麼運作"], why: ["Why", "為什麼"], teach: ["Teach me", "教我"], "merge-check": ["Before merging", "合併前檢查"], quiz: ["Check me", "考考我"], since: ["What changed since last time", "上次之後改了什麼"], reviewers: ["What reviewers asked", "審查者問了什麼"] };
/** text cut to n characters at a word, with an ellipsis (one long word is cut where it must) */
const clip = (s, n) => { s = String(s || "").trim(); if (s.length <= n) return s; const cut = s.slice(0, n), at = cut.lastIndexOf(" "); return `${(at > n / 3 ? cut.slice(0, at) : cut.slice(0, n - 1)).replace(/[\s,.;:–—-]+$/, "")}…`; };
const plain = (s) => String(s || "").replace(CITE, "").replace(/\*\*|`/g, "").replace(/^\s*([-*+]|\d+\.)\s+/, "").replace(/\s+/g, " ").trim();
/** the room's scenes: the opening picture (turn 0), then one per turn, its points the answer's claims */
function scenesOf(r) {
  const out = [], opening = r.board.filter((b) => b.turn === 0);
  if (opening.length) out.push({ key: "t0", turn: 0, title: T("This change at a glance", "一眼看懂這個改動"), question: null, visuals: opening, points: [], questions: [] });
  for (const t of r.turns) {
    const claims = t.status === "done" ? (t.claims?.length ? t.claims : [{ text: t.answer, kind: "claim", basis: "inference", cites: [] }]) : [];
    const heading = claims.find((c) => c.kind === "heading"), [en, zh] = ACTION_LABEL[t.action] || [t.action, t.action];
    // a scene Studio made itself (no model): what changed since the captain last looked, what GitHub reviewers asked
    if (t.studio) { out.push({ key: `t${t.n}`, turn: t.n, t, studio: true, title: T(en, zh), question: null, visuals: r.board.filter((b) => b.turn === t.n), points: claims, questions: [] }); continue; }
    out.push({ key: `t${t.n}`, turn: t.n, t, title: heading ? plain(heading.text.replace(/^\s*#+\s*/, "")) : `${T(en, zh)}: ${t.text.slice(0, 80)}`, question: t.text,
      visuals: r.board.filter((b) => b.turn === t.n), points: claims.filter((c) => c.kind !== "heading"), questions: r.check.questions.filter((q) => q.turn === t.n) });
  }
  return out;
}
const sceneState = (card, scenes) => { let i = RR.scene.get(card); if (i == null || i >= scenes.length) i = scenes.length - 1; return Math.max(0, i); };
const revealOf = (card, sc) => Math.min(sc.points.length, RR.reveal.get(`${card}/${sc.key}`) ?? sc.points.length);
/** points a page shows: never more, so the points column never grows past the board; the next ones are the next page,
 *  reached like any other point (a page advances like a beat) */
const PER = 4;
const pageOf = (k) => (k > 0 ? Math.floor((k - 1) / PER) : 0);
/** the visual a scene shows after k points: the last board item a shown point cites, else the scene's first */
function visualAt(r, sc, k) {
  let v = sc.visuals[0] || null;
  for (const p of sc.points.slice(0, k)) { if (p.visual) v = p.visual; for (const c of p.cites || []) if (c.ref.startsWith("board:")) { const b = r.board.find((x) => x.id === c.ref.slice(6)); if (b) v = b; } }
  return v;
}
const citedFiles = (sc) => { const out = []; for (const p of sc.points) for (const c of p.cites || []) if (c.ref.startsWith("diff:")) { const f = c.ref.slice(5).replace(/:L\d+(?:-\d+)?$/, ""); if (f && !out.includes(f)) out.push(f); } return out; };
/** An answer that drew no picture still gets one, free, from Studio: the cited files' line counts (git's numbers), else a key
 *  card (the scene's title and the files it is about as sticky notes). Never "no picture". */
function fallbackVisual(r, sc) {
  const files = citedFiles(sc), stat = r.diffstat?.files || [], rows = stat.filter((f) => files.includes(f.path));
  if (rows.length) return { id: `${sc.key}-files`, synth: true, turn: sc.turn, type: "chart", kind: "chart", mode: "diffstat", from: "git", title: T("The files this answer cites", "這個回答引用的檔案"), unit: T("lines", "行"), rows: rows.slice(0, 8).map((f) => ({ label: f.path, added: f.added, removed: f.removed })), basis: "cited", cites: [] };
  const top = files.length ? files : [...stat].sort((a, b) => (b.added + b.removed) - (a.added + a.removed)).map((f) => f.path);
  return { id: `${sc.key}-key`, synth: true, turn: sc.turn, type: "keycard", kind: "studio", title: sc.title, files: top.slice(0, 4), basis: null, cites: [] };
}
/** show a board item on the stage: its scene, that picture */
function showItem(r, id) {
  const card = r.card.id, scenes = scenesOf(r), i = scenes.findIndex((s) => s.visuals.some((b) => b.id === id)); RR.cite.delete(card);
  if (i >= 0) { stopPlay(); RR.scene.set(card, i); RR.pick.set(`${card}/${scenes[i].key}`, id); }
  rerender();
}
// ---------- narration: captions always; a voice only when the captain picks one (off by default) ----------
// The voice is the tutor vendor's own neural voice when it has one (the narration goes only to that vendor, the one the
// tutor already uses; generated once per scene and kept in the room), else a voice of this Mac (on-device only: a voice
// the browser would send to a server is never offered), the best first (Premium, Enhanced, Siri).
const prefs = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
// never offered: macOS's novelty voices; left out while anything better is there: its robotic legacy ones (MacinTalk,
// Eloquence). By name: an older macOS gives every voice, the good ones too, a com.apple.speech.synthesis.voice. address
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox)$/i;
const LEGACY = /^(agnes|bruce|fred|junior|kathy|princess|ralph|vicki|victoria|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)$/i;
const baseName = (v) => String(v.name || "").replace(/\s*\(.*\)\s*$/, "").trim();
// the best first: Premium, then Enhanced (Safari says so only in the voice's address), Siri and neural voices, the compact ones last
const voiceRank = (v) => { const s = `${v.name} ${v.voiceURI || ""}`; return /premium/i.test(s) ? 4 : /enhanced/i.test(s) ? 3 : /siri|neural|natural/i.test(s) ? 2 : /compact/i.test(s) ? 0 : 1; };
const localVoices = () => { try { const want = uiLang().toLowerCase(), l = want.slice(0, 2), exact = (v) => (v.lang || "").toLowerCase().replace("_", "-") === want ? 1 : 0;
  const mine = (window.speechSynthesis?.getVoices?.() || []).filter((v) => v.localService && v.lang?.toLowerCase().startsWith(l) && !NOVELTY.test(baseName(v)));
  const good = mine.filter((v) => !LEGACY.test(baseName(v)));
  return (good.length ? good : mine).sort((a, b) => voiceRank(b) - voiceRank(a) || exact(b) - exact(a)); } catch { return []; } };
const voicePref = () => prefs.get("crew.room.voice") || "off";
/** the Mac voice to speak with: the one picked, or, when that one is no longer offered (a robotic voice picked before), the best there is */
const chosenLocal = () => { const p = voicePref(); if (!p.startsWith("local:")) return null; const vs = localVoices(); return vs.find((v) => v.voiceURI === p.slice(6)) || vs[0] || null; };
function speak(text, done) {
  const v = chosenLocal(); if (!v) return false;
  try { const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.onend = done; u.onerror = done; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); return true; } catch { return false; }
}
function stopPlay() { clearTimeout(RR.timer); RR.timer = null; RR.playing = null; try { window.speechSynthesis?.cancel(); } catch {} try { RR.audio?.pause(); } catch {} RR.audio = null; }
/** show one more point of the current scene; while playing, the next one follows when its caption has been read (or spoken) */
function advance(card) {
  if (!onRoom(card)) return stopPlay();
  const r = RR.rooms.get(card); if (!r) return; const scenes = scenesOf(r), sc = scenes[sceneState(card, scenes)]; if (!sc) return;
  const k = revealOf(card, sc); if (k >= sc.points.length) { stopPlay(); rerender(); return; }
  RR.pick.delete(`${card}/${sc.key}`); RR.reveal.set(`${card}/${sc.key}`, k + 1); rerender();
  if (RR.playing !== card || RR.audio) return;
  const text = plain(sc.points[k].text), next = () => { if (RR.playing === card) RR.timer = setTimeout(() => advance(card), 400); };
  if (speak(text, next)) return;
  RR.timer = setTimeout(() => advance(card), Math.min(9000, 1600 + text.length * 35));
}
/** the vendor's voice for a whole scene: the points appear as the audio reaches them (by their share of the text) */
async function playVendor(card, sc) {
  try { const out = await postJ(`/api/review-room/${enc(card)}/speech`, { scene: sc.key }); if (RR.playing !== card) return;
    const texts = sc.points.map((p) => plain(p.text)), total = texts.reduce((n, t) => n + t.length, 0) || 1; let acc = 0; const at = texts.map((t) => { const s = acc / total; acc += t.length; return s; });
    const a = new Audio(out.src); RR.audio = a;
    a.ontimeupdate = () => { if (RR.audio !== a || !a.duration) return; if (!onRoom(card)) return stopPlay(); const f = a.currentTime / a.duration, k = at.filter((s) => s <= f + 1e-6).length; if (k > revealOf(card, sc)) { RR.reveal.set(`${card}/${sc.key}`, k); rerender(); } };
    a.onended = () => { if (RR.audio === a && !onRoom(card)) return stopPlay(); if (RR.audio === a) { RR.reveal.set(`${card}/${sc.key}`, sc.points.length); stopPlay(); rerender(); } };
    await a.play(); }
  catch (e) { RR.err.set(card, T(`The voice could not play: ${e.message}`, `語音無法播放：${e.message}`)); RR.audio = null; advance(card); }
}
/** play the scene: from where it stands, or from its start when it is already whole (from: 0 replays it) */
function play(card, sc, from) {
  const k = revealOf(card, sc), start = from ?? (k >= sc.points.length ? 0 : Math.max(0, k - 1));
  stopPlay(); RR.playing = card; RR.reveal.set(`${card}/${sc.key}`, start);
  const r = RR.rooms.get(card); if (voicePref() === "vendor" && r?.offer?.voice && sc.t && !sc.studio) { RR.reveal.set(`${card}/${sc.key}`, 1); rerender(); return void playVendor(card, sc); }
  advance(card);
}
const curScene = (card) => { const r = RR.rooms.get(card); if (!r) return {}; const scenes = scenesOf(r), i = sceneState(card, scenes); return { r, scenes, i, sc: scenes[i] }; };
const togglePlay = (card) => { const { sc } = curScene(card); if (!sc) return; if (RR.playing === card) { stopPlay(); rerender(); } else if (sc.points.length) play(card, sc); };
/** one point forward or back (← →, the play bar's arrows): past a scene's last point is the next scene's first */
function stepPoint(card, dir) {
  const { scenes, i, sc } = curScene(card); if (!sc) return; stopPlay();
  const k = revealOf(card, sc), n = sc.points.length;
  RR.pick.delete(`${card}/${sc.key}`);
  if (dir > 0) { if (k < n) RR.reveal.set(`${card}/${sc.key}`, k + 1); else if (i < scenes.length - 1) { RR.scene.set(card, i + 1); RR.reveal.set(`${card}/${scenes[i + 1].key}`, Math.min(1, scenes[i + 1].points.length)); } }
  else if (k > 1) RR.reveal.set(`${card}/${sc.key}`, k - 1);
  else if (i > 0) { RR.scene.set(card, i - 1); RR.reveal.set(`${card}/${scenes[i - 1].key}`, scenes[i - 1].points.length); }
  rerender();
}
const goScene = (card, n) => { const { scenes } = curScene(card); if (!scenes?.length) return; stopPlay(); RR.scene.set(card, Math.max(0, Math.min(scenes.length - 1, n))); rerender(); };
function voicePicker(r) {
  const vs = localVoices(), vendor = r.offer?.voice, pref = voicePref(), alt = pref.startsWith("local:") ? chosenLocal() : null, cur = alt ? `local:${alt.voiceURI}` : pref;
  const opts = [["off", T("Voice off (captions only)", "語音關（只有字幕）")], ...(vendor ? [["vendor", T(`${vendor.vendor} neural voice (${vendor.model}; paid, only to the tutor's own vendor)`, `${vendor.vendor} 神經語音（${vendor.model}；付費，只送到導師本身的供應商）`)]] : []), ...vs.map((v) => [`local:${v.voiceURI}`, T(`This Mac: ${v.name}`, `這台 Mac：${v.name}`)])];
  return h("label", { class: "rr-voice" }, h("span", { class: "sr" }, T("Voice", "語音")), h("select", { class: "input", "data-voice": "", "aria-label": T("Voice", "語音"),
    onchange: (e) => { prefs.set("crew.room.voice", e.target.value === "off" ? null : e.target.value); stopPlay(); rerender(); } }, opts.map(([v, l]) => h("option", { value: v, selected: v === cur || (v === "off" && !opts.some(([x]) => x === cur)) }, l))));
}
/** The stage: the board (the scene's title, its picture on the left, at most four of its points on the right), the caption
 *  and the play bar. One viewport tall with the header and the dock: nothing in it grows the page. */
function stageView(r) {
  const card = r.card.id, scenes = scenesOf(r);
  if (!scenes.length) return h("section", { class: "rr-stage", "data-stage": card, "aria-label": T("Board", "白板") },
    h("div", { class: "rr-board" }, h("div", { class: "rr-empty", "data-board-empty": "" },
      h("h2", { class: "rr-hand" }, T("Board", "白板")), h("p", { class: "faint" }, T("Ask below. Each answer becomes a scene here: a picture (a diagram built up step by step, the app's screenshots before and after, a chart, the code) beside the tutor's points, revealed one at a time.", "在下方提問。每個回答會在這裡變成一個場景：一張圖（一步步組起來的圖、改動前後的截圖、圖表、程式碼），旁邊是導師的重點，一個一個出現。")))),
    h("div", { class: "rr-caption", "data-caption": "", "aria-live": "polite" }), h("div", { class: "rr-playbar" }, voicePicker(r)));
  const i = sceneState(card, scenes), sc = scenes[i], k = revealOf(card, sc), n = sc.points.length, picked = RR.pick.get(`${card}/${sc.key}`);
  const running = sc.t?.status === "running";
  const v = (picked && sc.visuals.find((b) => b.id === picked)) || visualAt(r, sc, k) || (running ? null : fallbackVisual(r, sc));
  const prev = v?.group ? r.board.filter((b) => b.turn === v.turn && b.group === v.group && (b.step || 0) < (v.step || 0)).sort((a, b) => (a.step || 0) - (b.step || 0)).at(-1) : null;
  const cur = sc.points[k - 1], caption = cur ? plain(cur.text) : running ? T("The tutor is working…", "導師作答中…") : "";
  const page = pageOf(k), shown = sc.points.slice(page * PER, Math.max(page * PER, k)), pages = Math.max(1, Math.ceil(n / PER));
  const [en, zh] = ACTION_LABEL[sc.t?.action] || ["", ""];
  const kicker = sc.studio ? T(`${en} · made by Studio, free`, `${zh} · Studio 做的，免費`) : sc.t ? T(en, zh) : "";
  const pointView = (c, j) => { const at = page * PER + j, now = at === k - 1;
    if (c.kind === "code") return h("li", { class: `rr-point code${now ? " now" : ""}`, "data-claim": "code" }, h("pre", { class: "rr-pre" }, c.text.replace(/^\s*```[^\n]*\n?|\n?\s*```\s*$/g, "")));
    return h("li", { class: `rr-point${c.basis === "inference" ? " inference" : ""}${now ? " now" : " done"}`, "data-claim": c.basis || c.kind, "aria-current": now ? "true" : null },
      c.basis === "inference" ? inferenceBadge() : c.basis === "reviewer" ? reviewerBadge() : null, h("span", { class: "rr-ptext" }, inline(card, c.text.replace(/^\s*[-*+]\s+/, ""), c.cites)),
      // what someone else wrote (a reviewer, a commit message): their words as plain text, never parsed for citations or markup;
      // the gist (its first line, cut short) on the board, the whole text only when the captain opens it
      c.quote ? quoteView(c, `${card}/${sc.key}/${at}`) : null); };
  // the dots: one per scene, the current one opened into its points (or its pages, when it has many)
  const dot = (j, m, on, label) => h("button", { type: "button", class: "rr-dot", "data-dot": `${j}:${m}`, "aria-current": on ? "step" : null, "aria-label": label,
    onclick: () => { stopPlay(); RR.scene.set(card, j); if (m) RR.reveal.set(`${card}/${scenes[j].key}`, m); rerender(); } }, h("i"));
  const dots = scenes.map((x, j) => j !== i ? dot(j, 0, false, T(`Scene ${j + 1}`, `場景 ${j + 1}`))
    : n <= 12 ? sc.points.map((_, m) => dot(j, m + 1, m + 1 === k, T(`Scene ${j + 1}, point ${m + 1}`, `場景 ${j + 1} 第 ${m + 1} 點`)))
    : Array.from({ length: pages }, (_, m) => dot(j, Math.min(n, m * PER + 1), m === page, T(`Scene ${j + 1}, page ${m + 1}`, `場景 ${j + 1} 第 ${m + 1} 頁`)))).flat();
  return h("section", { class: "rr-stage", "data-stage": card, "data-scene": sc.key, "aria-label": T("Board", "白板") },
    h("div", { class: "rr-board", "aria-roledescription": T("board", "白板") },
      h("div", { class: "rr-stitle" },
        h("span", { class: "rr-kicker" }, sc.studio ? h("span", { "data-studio-scene": sc.t.action }, kicker) : kicker, pages > 1 ? ` · ${page + 1}/${pages}` : "",
          sc.question ? h("span", { class: "rr-q", "data-scene-question": "", title: sc.question }, ` · ${clip(sc.question, 60)}`) : null),
        h("h2", { class: "rr-hand", "data-scene-title": "", title: sc.title }, sc.title)),
      h("div", { class: "rr-scene" },
        h("figure", { class: "rr-visual", "data-visual": v?.id || "" },
          v ? itemView(card, v, prev) : h("div", { class: "rr-drawing faint", "data-visual-drawing": "" }, T("The tutor is drawing…", "導師正在畫…")),
          sc.visuals.length > 1 ? h("div", { class: "rr-vstrip", role: "group", "aria-label": T("Pictures in this scene", "這個場景的圖") }, sc.visuals.map((b) => h("button", { type: "button", class: `rr-vchip${b === v ? " on" : ""}`, "data-visual-pick": b.id, "aria-pressed": String(b === v), title: b.title, onclick: () => { const at = sc.points.findIndex((p) => (p.cites || []).some((c) => c.ref === `board:${b.id}`)); RR.pick.set(`${card}/${sc.key}`, b.id); if (at >= 0) RR.reveal.set(`${card}/${sc.key}`, Math.max(k, at + 1)); rerender(); } }, b.kind ? T(KIND_LABEL[b.kind][0].split(" ·")[0], KIND_LABEL[b.kind][1].split(" ·")[0]) : b.type, ` ${clip(b.title, 24)}`))) : null),
        h("div", { class: "rr-points" },
          sc.t && sc.t.status !== "done" ? (running ? h("p", { class: "faint", "data-turn-running": "" }, T(`The tutor is working (${sc.t.provider} · ${sc.t.model})…`, `導師作答中（${sc.t.provider} · ${sc.t.model}）…`)) : h("p", { class: "rr-err", "data-turn-failed": sc.t.status }, sc.t.status === "interrupted" ? T("Interrupted: Studio stopped during this turn.", "中斷：這一回合進行時 Studio 停止了。") : `${T("Failed", "失敗")}: ${sc.t.error || ""}`)) : null,
          h("ol", { class: "rr-pointlist", "data-points": n, start: page * PER + 1 }, shown.map(pointView)),
          n ? h("p", { class: "rr-ppage faint", "data-point-pos": `${k}/${n}` }, T(`Point ${k} of ${n}`, `第 ${k} 點 / 共 ${n} 點`)) : null,
          sc.questions.length ? h("div", { class: "rr-sceneq", "data-scene-check": "" }, h("b", {}, T("Questions for you (answer in the prompt below)", "問你的問題（在下方輸入框回答）")), h("ol", {}, sc.questions.map((q) => h("li", { "data-check-result": q.result ? (q.result.correct ? "correct" : "missed") : "open" }, q.q, q.result ? h("span", { class: `rr-mark ${q.result.correct ? "ok" : "miss"}` }, q.result.correct ? T(" ✓ correct", " ✓ 正確") : T(" ✗ missed: re-explained", " ✗ 沒答對：已重新講解")) : null)))) : null,
          sc.t?.status === "done" && sc.t.cost?.usd != null ? h("p", { class: "faint rr-cost" }, `$${Number(sc.t.cost.usd).toFixed(2)} · ${sc.t.provider} · ${sc.t.model}`) : null))),
    h("div", { class: "rr-caption", "data-caption": "", "aria-live": "polite" }, h("span", { class: "rr-who" }, sc.studio || !sc.t ? "Studio" : T("Tutor", "導師")), h("span", { class: "rr-ctext", "data-caption-text": "" }, caption)),
    h("div", { class: "rr-playbar" },
      h("button", { type: "button", class: "rr-ibtn", "data-point-prev": "", disabled: i === 0 && k <= 1, onclick: () => stepPoint(card, -1), "aria-label": T("Previous point", "上一點"), title: T("Previous point (←)", "上一點（←）") }, ic("prev")),
      h("div", { class: "rr-dots", role: "group", "aria-label": T("Scenes and points", "場景與重點") }, dots),
      h("button", { type: "button", class: "rr-ibtn", "data-point-next": "", disabled: i === scenes.length - 1 && k >= n, onclick: () => stepPoint(card, 1), "aria-label": T(`Next point (${k}/${n})`, `下一點（${k}/${n}）`), title: T("Next point (→)", "下一點（→）") }, ic("next")),
      h("button", { type: "button", class: "rr-ibtn primary", "data-play": "", "aria-pressed": String(RR.playing === card), disabled: !n, onclick: () => togglePlay(card), "aria-label": RR.playing === card ? T("Pause", "暫停") : T("Play", "播放"), title: T("Play / pause (Space)", "播放／暫停（空白鍵）") }, ic(RR.playing === card ? "pause" : "play")),
      h("button", { type: "button", class: "rr-ibtn", "data-replay": "", disabled: !n, onclick: () => play(card, sc, 0), "aria-label": T("Replay this scene", "這個場景重播"), title: T("Replay this scene", "這個場景重播") }, ic("replay")),
      h("span", { class: "rr-scenenav" },
        h("button", { type: "button", class: "rr-mini", "data-scene-prev": "", disabled: i === 0, onclick: () => goScene(card, i - 1), "aria-label": T("Previous scene", "上一個場景") }, "«"),
        h("span", { class: "faint", "data-scene-pos": `${i + 1}/${scenes.length}` }, T(`Scene ${i + 1} of ${scenes.length}`, `場景 ${i + 1} / ${scenes.length}`)),
        h("button", { type: "button", class: "rr-mini", "data-scene-next": "", disabled: i === scenes.length - 1, onclick: () => goScene(card, i + 1), "aria-label": T("Next scene", "下一個場景") }, "»")),
      h("span", { class: "x-grow" }),
      voicePicker(r)));
}
// ---------- the prompt bar: quick actions, a question (typed or spoken), the paid-round confirmation ----------
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
/** push-to-talk, on-device only: the browser must recognise speech locally (processLocally), or the mic stays off */
async function micReady(card) {
  const C = SR(); if (!C) return false; if (RR.mic != null) return RR.mic;
  try { if (typeof C.available !== "function") return (RR.mic = false); const a = await C.available({ langs: [uiLang()], processLocally: true }); RR.mic = a === "available"; } catch { RR.mic = false; }
  redraw(card); return RR.mic;
}
function listen(card) {
  const C = SR(); if (!C || !RR.mic) return; try { const rec = new C(); rec.lang = uiLang(); rec.processLocally = true; rec.interimResults = true; rec.continuous = true;
    // what is heard after the captain left the room is dropped with the recognizer (stopped on leaving)
    rec.onresult = (e) => { if (RR.rec !== rec || !onRoom(card)) return; RR.draft.set(card, [...e.results].map((x) => x[0]?.transcript || "").join(" ").trim()); RR.heard = true; render(); };
    rec.onend = () => { if (RR.rec === rec) RR.rec = null; redraw(card); }; rec.onerror = () => { if (RR.rec === rec) RR.rec = null; redraw(card); };
    RR.rec = rec; RR.recCard = card; rec.start(); redraw(card); } catch { RR.rec = null; }
}
/** ask for a paid turn: it first asks to confirm (the provider and the model) */
const askTurn = (card, action, text) => { if (action === "ask" && !text) return; RR.confirm.set(card, { action, text: text || "" }); rerender(); };
/** The dock under the stage: the quick actions, the question (typed or spoken), the transcript; the paid round's
 *  confirmation, a turn being sent and errors open above it, over the stage, never pushing it */
function promptBar(r) {
  const card = r.card.id, busy = r.running != null || RR.posting.has(card), offer = r.offer, conf = RR.confirm.get(card), err = RR.err.get(card);
  const tbtn = h("button", { type: "button", class: "rr-ibtn rr-tbtn", "data-transcript-toggle": card, "aria-expanded": String(RR.drawer.has(card)), "aria-label": T("Transcript", "紀錄"), title: T("Transcript", "紀錄"), onclick: () => { RR.drawer.has(card) ? RR.drawer.delete(card) : RR.drawer.add(card); rerender(); } }, ic("list"));
  if (!r.open) return h("div", { class: "rr-bar rr-dock" }, h("p", { class: "faint rr-dock-note", "data-room-closed": "" }, r.closed ? T(r.closed.en, r.closed.zh) : T("The merge card is answered: this room is read-only now.", "合併卡已回覆：審查室現在只能閱讀。")), tbtn);
  if (offer?.error) return h("div", { class: "rr-bar rr-dock" }, h("p", { class: "rr-err rr-dock-note", "data-room-unavailable": "" }, offer.error), tbtn);
  if (RR.mic == null) void micReady(card);
  const ask = (action) => askTurn(card, action, action === "ask" ? (RR.draft.get(card) || "").trim() : "");
  const start = async () => { const c = RR.confirm.get(card); if (!c || busy) return; RR.posting.add(card); RR.err.delete(card); rerender();
    try { const room = await postJ(`/api/review-room/${enc(card)}/turn`, { action: c.action, text: c.text, lang: uiLang(), confirm: offer?.hash }); RR.rooms.set(card, room); RR.confirm.delete(card); if (c.action === "ask") RR.draft.delete(card); RR.heard = false; RR.scene.delete(card); }
    catch (e) { RR.err.set(card, e.message); if (e.offer) RR.rooms.set(card, { ...r, offer: e.offer }); }
    finally { RR.posting.delete(card); redraw(card); schedule(); } };
  const talk = !!RR.rec;
  const pops = [
    RR.heard && RR.draft.get(card) ? h("p", { class: "rr-pop faint", "data-heard": "" }, T("Heard you: check the text above, then Ask.", "已聽到：請先檢查上面的文字，再按送出。")) : null,
    conf ? h("div", { class: "rr-pop rr-confirm", role: "group", "data-room-confirm": conf.action, "aria-label": T("Confirm the paid round", "確認付費回合") },
      h("p", {}, T(`This starts a paid model round on ${offer.provider} · ${offer.model ?? "default model"}${offer.effort ? ` (${offer.effort})` : ""}; the tutor may also ask for up to two illustrations, each a paid image job made in the background. The tutor only reads the code; nothing is written, and nothing is sent to GitHub.`,
        `這會開始一次付費的模型執行：${offer.provider} · ${offer.model ?? "預設模型"}${offer.effort ? `（${offer.effort}）` : ""}；導師也可能要求最多兩張插圖，每張都是在背景進行的付費圖片工作。導師只讀程式碼，不寫任何東西，也不送任何東西到 GitHub。`)),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", "data-room-start": "", disabled: busy, onclick: start }, T("Start the round", "開始這一回合")),
        h("button", { type: "button", class: "btn ghost", "data-room-cancel": "", disabled: RR.posting.has(card), onclick: () => { RR.confirm.delete(card); rerender(); } }, T("Cancel", "取消")))) : null,
    err ? h("p", { class: "rr-pop rr-err", role: "alert", "data-room-error": "" }, err, " ", h("button", { type: "button", class: "rr-mini", "aria-label": T("Dismiss", "關閉"), onclick: () => { RR.err.delete(card); rerender(); } }, "×")) : null].filter(Boolean);
  return h("div", { class: "rr-bar rr-dock", "data-chat": card },
    pops.length ? h("div", { class: "rr-pops" }, pops) : null,
    h("div", { class: "rr-quick", role: "group", "aria-label": T("Quick actions", "快速動作") }, r.actions.map((a) => h("button", { type: "button", class: `rr-chip${a.id === "teach" ? " lead" : ""}`, "data-room-action": a.id, disabled: busy, onclick: () => ask(a.id) }, T(...(ACTION_LABEL[a.id] || [a.en, a.zh]))))),
    h("div", { class: "rr-askrow" },
      h("input", { class: "rr-askin", type: "text", maxlength: 4000, "data-room-text": card, disabled: busy, "aria-label": T("Ask anything about this change", "問任何關於這個改動的問題"), placeholder: T("Ask anything, or interrupt with a question…", "隨時打斷、隨便問…"), value: RR.draft.get(card) || "",
        oninput: (e) => { RR.draft.set(card, e.target.value); }, onkeydown: (e) => { if (e.key === "Enter" && !e.isComposing) { RR.draft.set(card, e.target.value); ask("ask"); } } }),
      busy ? h("span", { class: "rr-busy", role: "status", "data-room-busy": "", title: T("The tutor is working; one turn at a time.", "導師作答中；一次一回合。") }, h("i"), T("The tutor is working; one turn at a time.", "導師作答中；一次一回合。")) : null,
      h("button", { type: "button", class: `rr-mic${talk ? " on" : ""}`, "data-mic": "", "aria-pressed": String(talk), disabled: busy || !RR.mic, title: RR.mic ? T("Hold to talk (this Mac recognises your voice; nothing is sent)", "按住說話（由這台 Mac 辨識，不送出任何聲音）") : T("No on-device speech recognition in this browser", "這個瀏覽器沒有裝置上的語音辨識"),
        onpointerdown: (e) => { e.preventDefault(); listen(card); }, onpointerup: () => { try { RR.rec?.stop(); } catch {} }, onpointerleave: () => { try { RR.rec?.stop(); } catch {} } }, talk ? T("Listening…", "聆聽中…") : T("Hold to talk", "按住說話")),
      h("button", { type: "button", class: "rr-send", "data-room-send": "", disabled: busy, onclick: () => ask("ask"), "aria-label": T("Ask", "送出") }, T("Ask", "送出"))),
    h("p", { class: "rr-ro-note faint", "data-room-phone": "" }, T("A phone reads the room; ask from the desktop.", "手機只能閱讀；提問請在電腦上。")),
    tbtn);
}
// ---------- the transcript drawer (closed by default, over the room): questions and scene titles, the check, the sources ----------
function drawer(r) {
  const card = r.card.id, scenes = scenesOf(r), q = r.check.questions, graded = q.filter((x) => x.result), right = graded.filter((x) => x.result.correct).length, asked = r.turns.filter((t) => !t.studio).length, open = RR.drawer.has(card);
  const close = () => { RR.drawer.delete(card); rerender(); };
  return [open ? h("div", { class: "rr-scrim", "data-transcript-scrim": "", onclick: close }) : null,
    h("aside", { class: "rr-drawer", "data-transcript": card, "data-open": String(open), "aria-hidden": String(!open), "aria-label": T("Transcript", "紀錄") },
      h("header", {}, h("b", {}, T(`Transcript · ${asked} question${asked === 1 ? "" : "s"} · check ${graded.length ? `${right}/${graded.length}` : "—"} · ${r.sources.filter((s) => s.ok).length} sources`, `紀錄 · ${asked} 個問題 · 檢查 ${graded.length ? `${right}/${graded.length}` : "—"} · ${r.sources.filter((s) => s.ok).length} 個來源`)),
        h("button", { type: "button", class: "rr-ibtn", "data-transcript-close": "", "aria-label": T("Close", "關閉"), onclick: close }, ic("x"))),
      h("div", { class: "rr-drawer-body" },
        h("h3", {}, T("Scenes", "場景")),
        // a jump changes the scene on the stage and closes the drawer: nothing scrolls
        h("ol", { class: "rr-turns" }, scenes.map((sc, i) => h("li", { "data-turn": sc.turn, "data-turn-status": sc.t?.status || "opening" }, h("button", { type: "button", class: "rr-jump", "data-jump": sc.key, onclick: () => { stopPlay(); RR.scene.set(card, i); RR.drawer.delete(card); rerender(); } },
          sc.question ? h("span", { class: "rr-jq" }, sc.question.slice(0, 160)) : null, h("span", { class: "faint" }, ` → ${sc.title}`))))),
        h("h3", {}, T("Understanding check", "理解檢查")),
        q.length ? [h("p", { "data-check-score": "" }, graded.length ? T(`${right} of ${graded.length} correct`, `答對 ${right}/${graded.length}`) : T("Not answered yet: answer in the prompt.", "還沒作答：請在輸入框回答。")),
          h("ol", { class: "rr-check" }, q.map((x) => h("li", { "data-check": x.n, "data-check-result": x.result ? (x.result.correct ? "correct" : "missed") : "open" }, x.q, x.result?.note ? h("div", { class: "faint" }, x.result.note) : null)))]
          : h("p", { class: "faint" }, T("Press “Check me” for 2 to 4 short questions. Display only: it never blocks the merge.", "按「考考我」會有 2 到 4 個小問題。僅供參考，不會擋合併。")),
        h("h3", {}, T("Sources", "來源")),
        r.sources.length ? h("ul", { class: "rr-sources" }, r.sources.map((s) => h("li", { "data-source": s.n, "data-source-ok": String(s.ok) }, h("span", { class: "vbadge" }, `${s.n} ${s.kind === "search" ? T("search", "搜尋") : T("page", "網頁")}`), " ",
          s.kind === "search" ? s.query : webLink(s) ? h("a", { href: webLink(s), target: "_blank", rel: "noopener noreferrer", "data-source-link": s.n }, webLink(s)) : h("code", { "data-source-text": s.n }, s.url || s.text || ""), s.refused ? h("span", { class: "rr-err" }, T(` refused: ${s.refused}`, ` 已拒絕：${s.refused}`)) : s.error ? h("span", { class: "faint" }, ` ${s.error}`) : null)))
          : h("p", { class: "faint" }, T("Every web search and page the tutor uses is listed here. Studio refuses any that would carry this repository's code or names.", "導師用到的每個網路搜尋和網頁都列在這裡；會帶出這個儲存庫程式碼或名稱的查詢，Studio 一律拒絕。"))))];
}
// ---------- a pull request by its URL: Studio reads it on GitHub (GET only) for a project connected to GitHub ----------
const PR = { url: new Map(), busy: new Set(), err: new Map(), checking: new Set() };
/** the URL box (the Review Room's home, and a small one on a connected project's page) */
function prBox(where, repository) {
  const busy = PR.busy.has(where), err = PR.err.get(where);
  const go = async () => { const url = (PR.url.get(where) || "").trim(); if (!url || busy) return; PR.busy.add(where); PR.err.delete(where); rerenderAny();
    try { const out = await postJ("/api/review-room/open-pr", { url }); RR.rooms.set(out.id, out.room); PR.url.delete(where); location.hash = out.href; }
    catch (e) { PR.err.set(where, e.message); } finally { PR.busy.delete(where); rerenderAny(); } };
  return h("form", { class: "rr-prbox", "data-pr-box": where, onsubmit: (e) => { e.preventDefault(); go(); } },
    h("label", { class: "rr-prlabel" }, h("span", {}, repository ? T(`Review a pull request of ${repository}`, `審查 ${repository} 的 pull request`) : T("Review a pull request", "審查一個 pull request")),
      h("input", { class: "input", type: "url", "data-pr-url": where, required: true, disabled: busy, maxlength: 300, placeholder: repository ? `https://github.com/${repository}/pull/123` : "https://github.com/<owner>/<repo>/pull/<number>", value: PR.url.get(where) || "",
        oninput: (e) => PR.url.set(where, e.target.value), "aria-label": T("Pull request URL", "Pull request 網址") })),
    h("button", { type: "submit", class: "btn primary", "data-pr-open": where, disabled: busy }, busy ? T("Reading it on GitHub…", "正在讀取 GitHub…") : T("Open its review room", "開啟它的審查室")),
    h("p", { class: "faint" }, T("Only a pull request of a registered project connected to GitHub. Studio only reads it on GitHub and copies its commits into its own folder; nothing is written to GitHub or to your checkout.", "只限已註冊且連到 GitHub 的專案的 pull request。Studio 只在 GitHub 上讀取，並把它的 commit 複製到 Studio 自己的資料夾；不寫任何東西到 GitHub 或你的本機儲存庫。")),
    err ? h("p", { class: "rr-err", role: "alert", "data-pr-error": where }, err) : null);
}
const rerenderAny = () => { if (S.route?.name === "room" || S.route?.name === "project") render(); };
window.crewReviewRoomPrBox = (project, repository) => h("section", { class: "card x-pad", "data-project-review-room": project }, prBox(`project:${project}`, repository));
async function checkNow(id) {
  if (PR.checking.has(id)) return; PR.checking.add(id); RR.err.delete(id); rerender();
  try { RR.rooms.set(id, await postJ(`/api/review-room/${enc(id)}/check`, {})); } catch (e) { RR.err.set(id, e.message); } finally { PR.checking.delete(id); redraw(id); }
}
/** The room's header: back, what the room is about (one line, cut), its state as pills (the pull request on GitHub, new
 *  commits since the captain last looked, the tutor and how independent it is), Check for new commits, GitHub, Firstmate */
function header(r) {
  const id = r.card.id, ps = r.prState, mv = r.moved, kind = r.subject?.kind || "merge", offer = r.offer, ds = r.diffstat?.total;
  const title = T(r.card.title?.en || r.card.id, r.card.title?.["zh-TW"] || r.card.title?.en || r.card.id);
  const sub = kind === "merge" ? T(`${r.task.title} · ${r.card.id}${r.pr?.id ? ` · PR #${r.pr.id}` : ""} · head ${String(r.head || "").slice(0, 8)}. The tutor reads only; the room never answers the merge card.`, `${r.task.title} · ${r.card.id}${r.pr?.id ? ` · PR #${r.pr.id}` : ""} · head ${String(r.head || "").slice(0, 8)}。導師只讀；審查室不會回覆合併卡。`)
    : kind === "branch" ? T(`${r.task?.title || r.card.id} · its branch · head ${String(r.head || "").slice(0, 8)}. The tutor reads only; the room changes nothing about the Task.`, `${r.task?.title || r.card.id} · 它的分支 · head ${String(r.head || "").slice(0, 8)}。導師只讀；審查室不改變任務的任何事。`)
    : T(`${r.subject?.repository || ""} #${r.subject?.number || ""} · head ${String(r.head || "").slice(0, 8)}. Studio only reads GitHub; the room never comments, reviews or merges.`, `${r.subject?.repository || ""} #${r.subject?.number || ""} · head ${String(r.head || "").slice(0, 8)}。Studio 只讀 GitHub；審查室不留言、不審查、不合併。`);
  const verdicts = ps?.verdicts?.length ? ps.verdicts.map((v) => `${v.author}: ${v.state === "APPROVED" ? T("approved", "核准") : v.state === "CHANGES_REQUESTED" ? T("changes requested", "要求修改") : T("dismissed", "撤銷")}${v.current ? "" : T(" (an older head)", "（較舊的 head）")}`).join(" · ") : null;
  const pill = (attrs, ...kids) => h("span", { ...attrs, class: `rr-pill ${attrs.class || ""}`, title: attrs.title ?? kids.flat().map((k) => typeof k === "string" ? k : k?.textContent || "").join("") }, ...kids);
  const back = r.task?.id ? h("a", { class: "rr-back", href: `#/run/${enc(r.task.id)}`, "data-room-task": "" }, ic("back"), h("span", {}, T("Task", "任務"))) : h("a", { class: "rr-back", href: "#/room" }, ic("back"), h("span", {}, T("Rooms", "審查室")));
  return h("header", { class: "rr-head", "data-room-subject": kind },
    back, kind === "merge" ? h("a", { class: "rr-back", href: `#/inbox/${enc(r.card.id)}` }, T("The merge card", "合併卡")) : null,
    h("div", { class: "rr-htitle" }, h("b", { title }, title), h("span", { title: sub }, sub)),
    h("div", { class: "rr-pills" },
      ps ? pill({ class: ps.state === "merged" ? "ok" : ps.state === "closed" ? "bad" : ps.approved ? "ok" : "", "data-pr-state": ps.state, "data-pr-approved": String(!!ps.approved) }, h("span", {}, ps.state === "merged" ? T("Merged on GitHub", "已在 GitHub 合併") : ps.state === "closed" ? T("Closed on GitHub", "已在 GitHub 關閉") : ps.approved ? T("Open · approved at this head", "開啟中 · 已在這個 head 核准") : ps.draft ? T("Open · draft", "開啟中 · 草稿") : T("Open", "開啟中")),
        " · ", ps.headRepo && r.subject?.repository && ps.headRepo.toLowerCase() !== r.subject.repository.toLowerCase() ? T(`from the fork ${ps.headRepo} · `, `來自 fork ${ps.headRepo} · `) : "", verdicts ? h("span", { "data-pr-verdicts": "" }, verdicts) : T("No reviewer verdict yet", "還沒有審查者的結論"),
        h("span", { class: "faint" }, T(` · read on GitHub ${String(ps.checkedAt || "").slice(0, 16).replace("T", " ")}`, ` · ${String(ps.checkedAt || "").slice(0, 16).replace("T", " ")} 讀取自 GitHub`))) : null,
      r.stale ? pill({ class: "bad", role: "status", "data-pr-stale": "" }, T(`GitHub shows newer commits (${String(r.stale.head).slice(0, 8)}) Studio could not fetch yet: ${r.stale.error}. The room shows the last head it has; check again before asking.`, `GitHub 上有較新的 commit（${String(r.stale.head).slice(0, 8)}），Studio 還沒抓到：${r.stale.error}。審查室顯示它手上最後的 head；提問前請再檢查一次。`)) : null,
      kind === "branch" ? pill({ class: r.reviewed ? "ok" : "", "data-branch-state": r.reviewed ? "reviewed" : "not-reviewed" }, r.reviewed ? T(`Reviewed by Studio at ${String(r.head || "").slice(0, 8)}${r.local ? " · ready on its local branch, not published" : ""}`, `Studio 已在 ${String(r.head || "").slice(0, 8)} 審查通過${r.local ? " · 在本機分支上就緒，不會發布" : ""}`) : T("Studio's review has not passed at this head yet.", "Studio 的審查還沒在這個 head 通過。")) : null,
      mv ? pill({ class: "warn", role: "status", "data-room-moved": mv.commits ?? "rewritten" }, mv.commits != null ? T(`${mv.commits} new commit${mv.commits === 1 ? "" : "s"} since you last looked (${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}). Your next question opens with what changed.`, `你上次看過之後有 ${mv.commits} 個新 commit（${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}）。下一個問題會先看改了什麼。`)
        : T(`The branch was rewritten since you last looked (${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}).`, `你上次看過之後分支被改寫了（${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}）。`)) : null,
      ds ? pill({ "data-room-diffstat": "" }, h("b", { class: "add" }, `+${ds.added}`), " ", h("b", { class: "del" }, `−${ds.removed}`), T(` · ${ds.files} file${ds.files === 1 ? "" : "s"}`, ` · ${ds.files} 個檔案`)) : null,
      // who the tutor is and how independent it is from the author (another vendor, another model of the same vendor, or the same model)
      offer?.independence ? pill({ class: offer.independence.level === "same" ? "warn" : "", "data-independence": offer.independence.level }, T(`Tutor: ${offer.provider} · ${offer.model ?? "default model"} — ${offer.independence.en}`, `導師：${offer.provider} · ${offer.model ?? "預設模型"}：${offer.independence.zh}`)) : null),
    kind === "pr" ? h("button", { type: "button", class: "rr-back", "data-room-check": id, disabled: PR.checking.has(id) || r.checking || null, onclick: () => checkNow(id) }, PR.checking.has(id) || r.checking ? T("Reading GitHub…", "正在讀取 GitHub…") : T("Check for new commits", "檢查新的 commit")) : null,
    kind === "pr" && /^https:\/\/github\.com\//.test(r.subject?.url || "") ? h("a", { class: "rr-back", href: r.subject.url, target: "_blank", rel: "noopener noreferrer", "data-room-github": "" }, T("Open on GitHub", "在 GitHub 開啟")) : null,
    // Firstmate opens over the room as a sheet, never a column beside the board
    h("button", { type: "button", class: "rr-back", "data-room-firstmate": "", "aria-label": T("Firstmate (over the room)", "Firstmate（疊在審查室上）"), onclick: () => (document.body.classList.contains("chat-closed") ? document.getElementById("chatFab") : document.getElementById("chatClose"))?.click() }, ic("msg"), h("span", {}, "Firstmate")));
}
// ---------- focus mode: a room is the whole screen. The sidebar folds to its rail and Firstmate closes (an overlay sheet from
// the header); neither is saved as the captain's preference, and both come back as they were on leaving ----------
const FOCUS = { on: false, prev: null };
function focusMode(on) {
  const b = document.body; if (on === FOCUS.on) return; FOCUS.on = on;
  if (on) { FOCUS.prev = { side: b.classList.contains("side-collapsed"), chat: !b.classList.contains("chat-closed"), sideStore: prefs.get("crew.side") };
    b.classList.add("room-focus", "side-collapsed", "chat-closed"); return; }
  const p = FOCUS.prev || { side: false, chat: false, sideStore: null }, nowStore = prefs.get("crew.side");
  b.classList.remove("room-focus");
  // the captain folded or opened the sidebar on purpose while in the room (it is saved): that choice wins
  b.classList.toggle("side-collapsed", nowStore !== p.sideStore ? nowStore === "collapsed" : p.side);
  document.getElementById("sideTog")?.setAttribute("aria-label", b.classList.contains("side-collapsed") ? "Expand sidebar" : "Collapse sidebar");
  b.classList.toggle("chat-closed", !p.chat);
}
addEventListener("hashchange", () => { if (S.route?.name !== "room" || !S.route.arg) focusMode(false); });
// the keyboard: ← → a point back or forward, Space play / pause, Escape closes what is open over the room
addEventListener("keydown", (e) => {
  if (S.route?.name !== "room" || !S.route.arg || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const card = S.route.arg, t = e.target;
  if (e.key === "Escape") { if (RR.zoom) RR.zoom = null; else if (RR.cite.has(card)) RR.cite.delete(card); else if (RR.drawer.has(card)) RR.drawer.delete(card); else return; e.preventDefault(); rerender(); return; }
  if (t?.closest?.("input,textarea,select,[contenteditable],[role=dialog]") || RR.zoom) return;
  if (e.key === "ArrowRight") { e.preventDefault(); stepPoint(card, 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); stepPoint(card, -1); }
  else if (e.key === " " && !t?.closest?.("button,a,summary")) { e.preventDefault(); togglePlay(card); }
});
routes.room = (arg) => {
  focusMode(!!arg && RR.rooms.has(arg) && !RR.rooms.get(arg).error);
  if (!arg) return page(T("Review room", "審查室"), T("Open a review room from a merge card, from a Task whose branch passed Studio's review, or paste a pull request's URL.", "可以從合併卡、從通過 Studio 審查的任務分支開啟審查室，或貼上 pull request 的網址。"),
    h("section", { class: "card x-pad", "data-review-home": "" }, prBox("home", null)));
  const r = RR.rooms.get(arg);
  if (!r) { load(arg, true); return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad faint" }, T("Loading…", "載入中…"))); }
  if (r.error) return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad rr-err", "data-room-error": "" }, r.error));
  // a scene that arrives while the page is open is revealed point by point; scenes already there show whole
  const scenes = scenesOf(r), seen = RR.seen.get(arg);
  if (!seen) RR.seen.set(arg, new Set(scenes.filter((s) => !s.t || s.t.status !== "running").map((s) => s.key)));
  else for (const sc of scenes) if (!seen.has(sc.key) && (!sc.t || sc.t.status === "done")) { seen.add(sc.key); RR.scene.delete(arg); RR.reveal.set(`${arg}/${sc.key}`, 0); queueMicrotask(() => play(arg, sc)); }
  return h("div", { class: "rr-room", "data-review-room": r.card.id },
    header(r), stageView(r), promptBar(r), drawer(r), citePanel(r),
    RR.zoom ? h("div", { class: "rr-zoom", "data-zoom": "", role: "dialog", "aria-modal": "true", "aria-label": RR.zoom.alt, onclick: (e) => { if (e.target === e.currentTarget) { RR.zoom = null; rerender(); } } },
      h("button", { type: "button", class: "btn", onclick: () => { RR.zoom = null; rerender(); } }, T("Close", "關閉")), h("img", { src: RR.zoom.src, alt: RR.zoom.alt })) : null);
};
window.crewReviewRoom = { parseFlow, scenesOf };
})();
