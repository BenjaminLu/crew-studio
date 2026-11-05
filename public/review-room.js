// The review room (#/room/<merge card | Task | pull request>; docs/units/review-room.md, src/domain/review-room.ts): a BOARD the tutor draws
// on step by step (flowcharts built up one part at a time, diff hunks, code excerpts and before / after from the real
// commits) and a CHAT where the captain asks. Each turn is a paid model round: the captain confirms the provider and
// model before it starts. Every claim shows its basis: a citation opens the diff hunk, the ledger entry, the commit or
// the web source it rests on; a claim without one reads "Inference". Model text only ever goes into text nodes.
(() => {
const RR = { tutorMenu: null, step: new Map(), explain: new Map(), arrived: new Set(), imgWant: new Map(), resetAsk: new Set(), rscroll: new Map(), jump: new Map(), tsel: new Map(), audio: null, rooms: new Map(), loading: new Set(), confirm: new Map(), draft: new Map(), posting: new Set(), err: new Map(), cite: new Map(), poll: null, shot: new Map(), zoom: null,
  scene: new Map(), reveal: new Map(), moved: new Set(), ready: new Map(), list: null, lang: new Map(), ver: new Map(), regen: new Map(), trConfirm: new Set(), drawn: new Map(), titled: new Set(), lastK: new Map(), pick: new Map(), seen: new Map(), drawer: new Set(), fold: new Set(), playing: null, timer: null, mic: null, rec: null, heard: false };
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code, offer: j.offer }); return j; };
const uiLang = () => (["zh-TW", "zh-CN"].includes(document.documentElement.lang) ? document.documentElement.lang : "en");
const rerender = () => { if (S.route?.name === "room") render(); };
// what a room finishes later (its poll, a live update, playback, a turn or a citation it sent, the mic) redraws only that
// room's page (redraw): never the page the captain moved on to, where a redraw would replace the button being pressed
// and swallow the click. Leaving a room stops its playback and its mic at once.
const onRoom = (id) => S.route?.name === "room" && S.route.arg === id;
// a background redraw (a poll, a live update) waits while the captain holds words selected on the board: it would drop the
// selection and its "Ask about this"; it runs once the selection goes (public/review-board.js selHeld)
const redraw = (id) => { if (!onRoom(id)) return; if (BOARD?.selHeld?.()) { RR.heldRedraw = true; return; } render(); };
addEventListener("hashchange", () => { // after app.js's own listener: S.route is already the new page
  if (RR.playing && !onRoom(RR.playing)) stopPlay();
  if (RR.rec && !onRoom(RR.recCard)) try { RR.rec.stop(); } catch {}
});
const enc = encodeURIComponent;
const page = (title, sub, ...kids) => h("div", { class: "page rr-page" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null)), ...kids);
/** a saved room's snapshot as the room reads it: its own view, read-only (no prompt, no paid action), citations resolved inside */
const snapRoom = (id, snap) => ({ ...snap.view, card: { ...snap.view.card, id }, open: false, offer: null, running: null, tutors: [], translate: null, arrive: null,
  snapshot: { artifact: snap.artifact, n: snap.n, versions: snap.versions, savedAt: snap.savedAt, reason: snap.reason, cites: snap.cites || {}, cost: snap.cost, tutors: snap.tutors, subject: snap.subject } });
async function load(id, open = false) {
  if (RR.loading.has(id)) return; RR.loading.add(id);
  try { const lib = /^lib:(room-[a-z0-9-]+)(?:@(\d+))?$/.exec(id);
    RR.rooms.set(id, lib ? snapRoom(id, await api(`/api/review-room/library/${lib[1]}${lib[2] ? `?v=${lib[2]}` : ""}`)) : await api(`/api/review-room/${enc(id)}${open ? "?open=1" : ""}`)); RR.err.delete(id); }
  catch (e) { if (!RR.rooms.has(id)) RR.rooms.set(id, { error: e.message }); else RR.err.set(id, e.message); }
  finally { RR.loading.delete(id); redraw(id); schedule(); }
}
// while a turn runs, the page follows it (the live stream says when it ends; a slow poll covers a missed event)

function schedule() { clearTimeout(RR.poll); RR.poll = null; const id = S.route?.name === "room" ? S.route.arg : null, r = id && RR.rooms.get(id); if (r && r.running != null && !r.snapshot) RR.poll = setTimeout(() => { RR.poll = null; load(id); }, 2500); }
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
const ICO = { prev: "M15 6l-6 6 6 6", next: "M9 6l6 6-6 6", play: "M8 5l11 7-11 7z", pause: "M8 5v14M16 5v14", replay: ["M4 12a8 8 0 1 0 2.4-5.7", "M4 4v4h4"], list: "M4 6h16M4 12h16M4 18h10", msg: "M4 5h16v11H9l-5 4z", x: "M6 6l12 12M18 6L6 18", send: "M5 12h14M13 6l6 6-6 6", back: "M15 6l-6 6 6 6", expand: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5", shrink: "M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" };
const ic = (n) => sv("svg", { viewBox: "0 0 24 24", class: "rr-ic", "aria-hidden": "true" }, ...[].concat(ICO[n]).map((d) => sv("path", { d })));
/** a label in lines that fit `width` units at font size `fs` (a CJK character a whole em, Latin about half): words stay whole,
 *  CJK breaks anywhere; at most `max` lines, the last cut with an ellipsis */
function wrapLabel(s, width = 150, fs = 19, max = 3) {
  const em = (ch) => (/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 1 : 0.55) * fs, out = []; let cur = "", w = 0;
  const tokens = String(s).match(/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]|[^\sᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]+|\s+/g) || [];
  for (const t of tokens) { const tw = [...t].reduce((n, ch) => n + em(ch), 0);
    if (/^\s+$/.test(t)) { if (cur) { cur += " "; w += 0.3 * fs; } continue; }
    if (w + tw > width && cur.trim()) { out.push(cur.trim()); cur = ""; w = 0; }
    cur += t; w += tw; }
  if (cur.trim()) out.push(cur.trim());
  return out.length > max ? [...out.slice(0, max - 1), `${out[max - 1]}…`] : out;
}
const boxPath = (x, y, w, h, r) => `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
const diamondPath = (x, y, w, h) => `M${x + w / 2},${y} L${x + w},${y + h / 2} L${x + w / 2},${y + h} L${x},${y + h / 2} Z`;
/** the parts of a picture this viewer has seen drawn (a diagram's steps share one set, so a step draws only what it adds) */
const drawnOf = (card, it) => { const key = `${card}/${it.group ? `${it.turn}:${it.group}` : it.id}`; if (!RR.drawn.has(key)) RR.drawn.set(key, new Set()); return RR.drawn.get(key); };
/** the picture's box: the scene card's picture column (sceneCard) or a lesson figure's region (reportFigure), set while it is drawn */
let BOX = null;
const picBox = () => BOX || (innerWidth <= 760 ? { narrow: true, w: innerWidth - 60, h: 1400 } : { w: 540, h: 460 });
const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
/** a flowchart's places, left to right (horiz) or top down; node size from its longest label */
function flowLayout(g, horiz, fs) {
  const rank = new Map(g.nodes.map((n) => [n.id, 0]));
  // a cycle (a state machine's way back) does not push its nodes further out: the edges that close a cycle are left out of
  // the ranking (found depth first, in the order given) and still drawn
  const adj = new Map(g.nodes.map((n) => [n.id, []])), mark = new Map(), back = new Set();
  for (const e of g.edges) adj.get(e.from)?.push(e.to);
  const dfs = (u) => { mark.set(u, 1); for (const v of adj.get(u) || []) { if (mark.get(v) === 1) back.add(`${u}>${v}`); else if (!mark.has(v)) dfs(v); } mark.set(u, 2); };
  for (const n of g.nodes) if (!mark.has(n.id)) dfs(n.id);
  for (let k = 0; k < g.nodes.length; k++) for (const e of g.edges) if (e.from !== e.to && !back.has(`${e.from}>${e.to}`) && rank.get(e.to) <= rank.get(e.from) && rank.get(e.from) < g.nodes.length) rank.set(e.to, rank.get(e.from) + 1);
  const cols = new Map(); for (const n of g.nodes) { const r = rank.get(n.id); if (!cols.has(r)) cols.set(r, []); cols.get(r).push(n); }
  const W = 180, labels = new Map(g.nodes.map((n) => [n.id, wrapLabel(n.label, W - 20, fs)])), lines = Math.max(1, ...[...labels.values()].map((l) => l.length)), H = Math.max(60, lines * (fs + 4) + 22);
  // the gap between columns is sized for the longest edge label, so a label never runs across the boxes beside it
  const lw = Math.max(0, ...g.edges.map((e) => [...String(e.label || "")].reduce((n, ch) => n + (/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1), 0)));
  const GX = horiz ? Math.max(64, Math.min(240, lw * 8.5 + 30)) : 28, GY = horiz ? 26 : Math.max(50, lw ? 44 : 50), pos = new Map();
  for (const [r, list] of cols) list.forEach((n, i) => { pos.set(n.id, horiz ? { x: 20 + r * (W + GX), y: 24 + i * (H + GY) } : { x: 20 + i * (W + GX), y: 24 + r * (H + GY) }); });
  const maxX = Math.max(...[...pos.values()].map((p) => p.x)) + W + 20, maxY = Math.max(...[...pos.values()].map((p) => p.y)) + H + 20;
  return { horiz, W, H, pos, maxX, maxY, labels };
}
/** An SVG of a flowchart, drawn by Studio from the tutor's data (text only through text nodes). Nodes and edges not in `prev`
 *  (the step before) are marked new; what this viewer has not seen drawn yet (`seen`, kept per picture) is drawn by the pen,
 *  180ms apart; the rest shows at once. Studio picks the layout that reads largest in the box: top down on a phone. */
function flowSvg(g, prev, seen, box) {
  const narrow = box?.narrow, want = g.dir === "LR" || g.dir === "RL";
  const fit = (L) => Math.min(1.5, (box?.w || 800) / L.maxX, (box?.h || 520) / L.maxY);
  // on a phone: top down, and the labels at least 14px on screen (a larger font in the picture when it is scaled down)
  let fs = 19; if (narrow) for (let i = 0; i < 4; i++) { const sc = fit(flowLayout(g, false, fs)); if (fs * sc >= 14) break; fs = Math.ceil(14 / sc) + 1; }
  const cands = narrow ? [flowLayout(g, false, fs)] : [flowLayout(g, want, fs), flowLayout(g, !want, fs)];
  const L = cands.reduce((a, b) => (fit(b) > fit(a) * 1.15 ? b : a)), { horiz, W, H, pos, maxX, maxY, labels } = L;
  if (L.horiz === want && (g.dir === "RL" || g.dir === "BT")) for (const p of pos.values()) { if (g.dir === "RL") p.x = maxX - W - p.x; else p.y = maxY - H - p.y; }
  const old = prev ? { nodes: new Set(prev.nodes.map((n) => n.id)), edges: new Set(prev.edges.map((e) => `${e.from}>${e.to}`)) } : null;
  const anim = seen && !reduceMotion(); let t = 0;
  const pen = (el, key, d) => { if (anim && !seen.has(key)) { el.classList.add("rr-pen"); el.style.setProperty("--d", `${d}s`); el.style.setProperty("--dl", `${t.toFixed(2)}s`); } return el; };
  const write = (el, key, dl) => { if (anim && !seen.has(key)) { el.classList.add("rr-write"); el.style.setProperty("--dl", `${dl.toFixed(2)}s`); } return el; };
  // the picture scales to its box (viewBox), never wider than the board, never blown up past 1.5x
  const svg = sv("svg", { viewBox: `0 0 ${maxX} ${maxY}`, class: "rr-flow", role: "img", preserveAspectRatio: "xMidYMid meet", "data-layout": horiz ? "LR" : "TD", style: `max-width:${Math.round(maxX * 1.5)}px;max-height:${Math.round(maxY * 1.5)}px` });
  const fresh = [];
  for (const n of g.nodes) { const p = pos.get(n.id), isNew = old && !old.nodes.has(n.id), grp = sv("g", { class: `rr-node${isNew ? " rr-new" : ""}`, "data-node": n.id, "data-box": `${p.x},${p.y},${W},${H}` });
    const shape = sv("path", { class: "rr-box", pathLength: 1, d: n.shape === "diamond" ? diamondPath(p.x, p.y, W, H) : boxPath(p.x, p.y, W, H, n.shape === "round" || n.shape === "circle" ? 26 : 10) });
    grp.append(pen(shape, `n:${n.id}`, 0.45));
    const ls = labels.get(n.id); ls.forEach((l, i) => { const tx = sv("text", { x: p.x + W / 2, y: p.y + H / 2 + (i - (ls.length - 1) / 2) * (fs + 4) + fs * 0.35, "text-anchor": "middle", "font-size": fs, style: `font-size:${fs}px` }); tx.textContent = l; grp.append(write(tx, `n:${n.id}`, t + 0.3 + i * 0.12)); });
    if (anim && !seen.has(`n:${n.id}`)) { fresh.push(`n:${n.id}`); t += 0.18; }
    svg.append(grp); }
  // labels go where they overlap no box, no line and no other label: tried along the edge, on either side (baton: a label
  // between two nodes needs room designed for it); each is also masked by the paper
  const boxes = [...pos.values()].map((p) => ({ x: p.x - 4, y: p.y - 4, w: W + 8, h: H + 8 })), placed = [], dots = [], todo = [];
  const lw = (txt) => [...txt].reduce((n, ch) => n + (/[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 14 : 8), 0) + 8;
  const ext = { x0: 0, y0: 0, x1: maxX, y1: maxY }, grow = (x, y) => { ext.x0 = Math.min(ext.x0, x); ext.y0 = Math.min(ext.y0, y); ext.x1 = Math.max(ext.x1, x); ext.y1 = Math.max(ext.y1, y); };
  const ports = new Map(), forward = (e) => { const a = pos.get(e.from), b = pos.get(e.to); return a && b && e.from !== e.to && (horiz ? b.x > a.x : b.y > a.y); };
  for (const n of g.nodes) { const outs = g.edges.filter((e) => e.from === n.id && forward(e)).sort((p, q) => (horiz ? pos.get(p.to).y - pos.get(q.to).y : pos.get(p.to).x - pos.get(q.to).x));
    const ins = g.edges.filter((e) => e.to === n.id && forward(e)).sort((p, q) => (horiz ? pos.get(p.from).y - pos.get(q.from).y : pos.get(p.from).x - pos.get(q.from).x));
    outs.forEach((e, k) => ports.set(`o${g.edges.indexOf(e)}`, (k + 1) / (outs.length + 1))); ins.forEach((e, k) => ports.set(`i${g.edges.indexOf(e)}`, (k + 1) / (ins.length + 1))); }
  g.edges.forEach((e, ei) => { const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return;
    const po = ports.get(`o${ei}`) ?? 0.5, pi = ports.get(`i${ei}`) ?? 0.5;
    const twins = g.edges.filter((o) => o.from === e.from && o.to === e.to), tw = twins.indexOf(e);
    let x1, y1, x2, y2, cx, cy, d, pt, ang, cands = null;
    if (e.from === e.to) { // a transition back to its own state: a loop beside the box (on top when laid left to right, on the left when top down)
      const lift = 44 + tw * 22;
      if (horiz) { x1 = a.x + W * 0.62; y1 = a.y; x2 = a.x + W * 0.38; y2 = a.y; d = `M${x1},${y1} C${x1 + 16},${a.y - lift} ${x2 - 16},${a.y - lift} ${x2},${y2}`; ang = Math.atan2(y2 - (a.y - lift), 16); grow(a.x + W / 2, a.y - lift - 4);
        pt = (u) => { const q = 1 - u; return [q * q * q * x1 + 3 * q * q * u * (x1 + 16) + 3 * q * u * u * (x2 - 16) + u * u * u * x2, q * q * q * y1 + 3 * q * q * u * (a.y - lift) + 3 * q * u * u * (a.y - lift) + u * u * u * y2]; };
        cands = (w) => [[a.x + W / 2, a.y - lift - 8], [a.x + W / 2 + w / 2 + 24, a.y - lift + 14]]; }
      else { x1 = a.x; y1 = a.y + H * 0.32; x2 = a.x; y2 = a.y + H * 0.68; d = `M${x1},${y1} C${a.x - lift},${y1 - 10} ${a.x - lift},${y2 + 10} ${x2},${y2}`; ang = Math.atan2(10, lift); grow(a.x - lift - 4, a.y + H / 2);
        pt = (u) => { const q = 1 - u; return [q * q * q * x1 + 3 * q * q * u * (a.x - lift) + 3 * q * u * u * (a.x - lift) + u * u * u * x2, q * q * q * y1 + 3 * q * q * u * (y1 - 10) + 3 * q * u * u * (y2 + 10) + u * u * u * y2]; };
        cands = (w) => [[a.x - lift - w / 2 - 6, a.y + H / 2 + 5], [a.x - lift / 2, a.y - 10]]; } }
    else {
      // a way back (against the layout, or its reverse drawn too) bows out under (beside) the boxes; a second edge between the same
      // two states, the same way, bows out the other side, further each time
      const backward = horiz ? b.x <= a.x : b.y <= a.y, bow = backward || g.edges.some((o) => o.from === e.to && o.to === e.from && g.edges.indexOf(o) < ei);
      [x1, y1, x2, y2] = bow ? (horiz ? [a.x + W / 2, a.y + H, b.x + W / 2, b.y + H] : [a.x + W, a.y + H / 2, b.x + W, b.y + H / 2]) : horiz ? [a.x + W, a.y + H * po, b.x, b.y + H * pi] : [a.x + W * po, a.y + H, b.x + W * pi, b.y];
      if (bow) { cx = horiz ? (x1 + x2) / 2 : Math.max(x1, x2) + 56 + tw * 28; cy = horiz ? Math.max(y1, y2) + 56 + tw * 28 : (y1 + y2) / 2; }
      else { const len = Math.hypot(x2 - x1, y2 - y1) || 1, off = tw ? (tw % 2 ? 1 : -1) * 30 * Math.ceil(tw / 2) : 0; cx = (x1 + x2) / 2 - ((y2 - y1) / len) * off; cy = (y1 + y2) / 2 + ((x2 - x1) / len) * off; }
      d = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`; ang = Math.atan2(y2 - cy, x2 - cx); grow((x1 + 2 * cx + x2) / 4, (y1 + 2 * cy + y2) / 4 + 8);
      pt = (u) => [(1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * cx + u * u * x2, (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * cy + u * u * y2]; }
    const steps = Math.max(24, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 5) + 24); for (let k = 1; k < steps; k++) dots.push(pt(k / steps));
    const key = `e:${e.from}>${e.to}`, isNew = old && !old.edges.has(`${e.from}>${e.to}`), cls = isNew ? " rr-new" : "";
    const line = sv("path", { d, pathLength: 1, class: `rr-edge${e.dashed ? " dashed" : ""}${cls}`, "data-edge": `${e.from}>${e.to}`, "data-edge-n": e.n ?? null });
    const head = sv("path", { d: `M${x2 - 11 * Math.cos(ang - 0.5)},${y2 - 11 * Math.sin(ang - 0.5)} L${x2},${y2} L${x2 - 11 * Math.cos(ang + 0.5)},${y2 - 11 * Math.sin(ang + 0.5)}`, pathLength: 1, class: `rr-ahead${cls}` });
    if (e.dashed) { if (anim && !seen.has(key)) { line.classList.add("rr-fade"); line.style.setProperty("--dl", `${t.toFixed(2)}s`); } } else pen(line, key, 0.35);
    if (anim && !seen.has(key)) { const t0 = t; t += 0.33; pen(head, key, 0.12); t = t0; }
    svg.append(line, head, sv("path", { d, class: "rr-edge-hit", "data-edge-hit": `${e.from}>${e.to}`, "data-edge-n": e.n ?? null }));
    if (e.label) todo.push({ e, key, pt, cands, dl: t + 0.25 });
    if (anim && !seen.has(key)) { fresh.push(key); t += 0.18; } });
  const hit = (r) => [...boxes, ...placed].some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) || dots.some(([px, py]) => px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h);
  for (const { e, key, pt, cands, dl } of todo) { const txt = e.label.slice(0, 40), w = lw(txt), hgt = 18, rect = ([px, py]) => ({ x: px - w / 2, y: py - hgt + 4, w, h: hgt });
    // along the edge, then pushed out from it along its normal, further each time (on either side)
    const tries = [...(cands ? cands(w) : []), ...[0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8, 0.12, 0.88].flatMap((u) => { const [px, py] = pt(u), [qx, qy] = pt(Math.min(1, u + 0.02)), dl = Math.hypot(qx - px, qy - py) || 1, nx = -(qy - py) / dl, ny = (qx - px) / dl;
      return [[px + w / 2 + 8, py + 5], [px - w / 2 - 8, py + 5], [px, py - 12], [px, py + 22], ...[16, 30, 46, 64].flatMap((dd) => [[px + nx * (dd + w / 2 * Math.abs(nx)), py + ny * (dd + 9 * Math.abs(ny)) + 5], [px - nx * (dd + w / 2 * Math.abs(nx)), py - ny * (dd + 9 * Math.abs(ny)) + 5]])]; })];
    const cost = (r) => [...boxes, ...placed].filter((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y).length * 50 + dots.filter(([px, py]) => px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h).length;
    const pick = tries.find((c) => !hit(rect(c))) ?? tries.reduce((p, c) => (cost(rect(c)) < cost(rect(p)) ? c : p)); placed.push(rect(pick)); grow(pick[0] - w / 2, pick[1] - hgt); grow(pick[0] + w / 2, pick[1] + 6);
    const tx = sv("text", { x: pick[0], y: pick[1], class: "rr-elabel", "text-anchor": "middle", "data-elabel": `${e.from}>${e.to}`, "data-edge-n": e.n ?? null }); tx.textContent = txt; svg.append(write(tx, key, dl)); }
  for (const k of fresh) seen.add(k);
  // the canvas is what was drawn: a loop above, a way back below, a label beside, never an empty band
  const vx = Math.min(0, ext.x0 - 8), vy = Math.min(0, ext.y0 - 8), fw = Math.max(maxX, ext.x1 + 8) - vx, fh = Math.max(maxY, ext.y1 + 8) - vy;
  if (vx || vy || fw !== maxX || fh !== maxY) { svg.setAttribute("viewBox", `${vx} ${vy} ${fw} ${fh}`); svg.style.maxWidth = `${Math.round(fw * 1.5)}px`; svg.style.maxHeight = `${Math.round(fh * 1.5)}px`; }
  return svg;
}

// ---------- citations: a link to what a claim rests on ----------
const CITE = /\[(diff|ledger|commit|source|board|review):([^\]\s]{1,300})\]|\[(inference|inferred|speculative|direct|supported)\]/gi;
const KIND = { code: ["code", "程式碼"], diff: ["diff", "diff"], ledger: ["ledger", "帳本"], commit: ["commit", "commit"], source: ["source", "來源"], board: ["board", "白板"], review: ["reviewer", "審查意見"] };
// a link only to a page the server fetched and that is http(s): anything else (a refused address, any other scheme) is text
const webLink = (s) => s && s.ok && typeof s.url === "string" && /^https?:\/\//i.test(s.url) ? s.url : null;
function citeChip(card, ref, ok) {
  const dirRoom = RR.rooms.get(card)?.subject?.kind === "dir", [k0, v] = [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)], k = dirRoom && k0 === "diff" ? "code" : k0;
  const label = `${T(KIND[k]?.[0] || k, KIND[k]?.[1] || k)} ${v.length > 48 ? v.slice(0, 46) + "…" : v}`;
  // a citation Studio could not verify opens nothing
  if (ok === false) return h("span", { class: "rr-cite bad", "data-cite-invalid": ref, title: T("Studio could not verify this citation", "Studio 無法驗證這個引用") }, label);
  return h("button", { type: "button", class: `rr-cite${ok === false ? " bad" : ""}`, "data-cite": ref, title: ok === false ? T("Studio could not verify this citation", "Studio 無法驗證這個引用") : onGithub(card, ref) ? T("Open these lines of the pull request on GitHub, in a new window", "在新視窗開啟 GitHub 上這個 PR 的這幾行") : T("Open what this rests on", "開啟依據"), onclick: () => openCite(card, ref) },
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
/** a diff citation in a room whose pull request is on GitHub: the pull request's own files view at those lines (GitHub keys a file by
 *  the sha256 of its path, R<n> is a line on the head side); null when there is no such pull request or the ref is not a diff */
/*  A saved room keeps its frozen copy (GitHub's pull request may have moved on). Synchronous, so window.open keeps the click's activation. */
function githubDiffUrl(r, ref) {
  const m = /^diff:(.+?)(?::L(\d+)(?:-(\d+))?)?$/.exec(ref), pr = r?.pr?.url || (r?.subject?.kind === "pr" ? r.subject.url : null);
  // a directory room: the file at the pinned commit, those lines (a saved room links to the same commit: it never moves)
  if (m && r?.subject?.kind === "dir" && r.dir?.sha && /^[\w.-]+\/[\w.-]+$/.test(r.dir.repository || "")) return `https://github.com/${r.dir.repository}/blob/${r.dir.sha}/${m[1].split("/").map(encodeURIComponent).join("/")}${m[2] ? `#L${m[2]}-L${m[3] || m[2]}` : ""}`;
  if (!m || r?.snapshot || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr || "")) return null;
  return `${pr}/files#diff-${sha256hex(m[1])}${m[2] ? `R${m[2]}-R${m[3] || m[2]}` : ""}`;
}
const onGithub = (card, ref) => !!githubDiffUrl(RR.rooms.get(card), ref);
/** SHA-256 of a UTF-8 string, hex (FIPS 180-4); crypto.subtle is async and absent outside a secure context */
function sha256hex(s) {
  const K = [], H = [], isP = (n) => { for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; }, fr = (x) => ((x - Math.floor(x)) * 2 ** 32) | 0;
  for (let n = 2, i = 0; i < 64; n++) if (isP(n)) { if (i < 8) H[i] = fr(n ** (1 / 2)); K[i++] = fr(n ** (1 / 3)); }
  const b = [...new TextEncoder().encode(s)], bits = b.length * 8; b.push(0x80); while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(i > 3 ? 0 : (bits >>> (i * 8)) & 0xff);
  const rot = (x, n) => (x >>> n) | (x << (32 - n)), w = new Array(64);
  for (let o = 0; o < b.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) { const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, bb, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) { const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0; }
    [a, bb, c, d, e, f, g, hh].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}
function openCite(card, ref) {
  // a diff on a GitHub pull request opens there, in a new window, at the cited lines: no copy of the code in Studio
  const gh = githubDiffUrl(RR.rooms.get(card), ref); if (gh) { window.open(gh, "_blank", "noopener,noreferrer"); rerender(); return; }
  return openPanel(card, ref);
}
async function openPanel(card, ref) {
  // a saved room: what the citation pointed at was copied into the snapshot
  const snap = RR.rooms.get(card)?.snapshot; if (snap) { const d = snap.cites[ref]; RR.cite.set(card, d && !d.error ? { ref, data: d } : { ref, error: d?.error || T("Not in this snapshot", "這份存檔裡沒有") }); rerender(); return; }
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
    // a board item opens on the board: the camera flies to its scene, that picture shown
    : d.kind === "board" && isCode(d.item) ? [h("div", { class: "rr-item-h" }, h("b", {}, itemTitle(d.item)), d.item.path ? h("code", {}, `${d.item.path}${d.item.start ? `:${d.item.start}-${d.item.end}` : ""}`) : null, d.item.commit ? h("span", { class: "faint" }, ` @ ${String(d.item.commit).slice(0, 8)}`) : null),
      d.item.type === "diff" ? h("div", {}, d.item.header ? h("p", { class: "faint" }, d.item.header) : null, diffPre(d.item.text)) : d.item.type === "code" ? linesPre(d.item, d.item.highlight || [])
      : d.item.type === "compare" ? h("div", { class: "rr-compare" }, h("div", {}, h("b", {}, T("Before (base)", "之前（base）")), linesPre(d.item.before)), h("div", {}, h("b", {}, T("After (head)", "之後（head）")), linesPre(d.item.after))) : h("pre", { class: "rr-pre" }, d.item.text || "")]
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
function chartView(it, seen) {
  const anim = seen && !seen.has("bars") && !reduceMotion(); if (seen) seen.add("bars"); let nb = 0;
  const rows = it.rows || [], two = it.mode === "diffstat" || it.mode === "before-after";
  const vals = rows.flatMap((r) => it.mode === "diffstat" ? [r.added, r.removed] : [r.before, r.after, r.value]).filter((v) => typeof v === "number");
  const max = Math.max(1, ...vals.map(Math.abs)), LW = 170, BW = 260, RH = two ? 34 : 22, W = LW + BW + 70, Hh = 18 + rows.length * RH;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${Hh}`, class: "rr-chart", role: "img", "data-chart": it.mode, preserveAspectRatio: "xMidYMid meet", style: `max-width:${Math.round(W * 1.6)}px;max-height:${Math.round(Hh * 1.6)}px` });
  const bar = (y, v, cls) => { if (typeof v !== "number") return; const w = Math.max(1, Math.round(Math.abs(v) / max * BW)); const rect = sv("rect", { x: LW, y, width: w, height: 12, rx: 3, class: `${cls}${anim ? " rr-grow" : ""}`, "data-value": v, ...(anim ? { style: `--dl:${(0.1 + nb++ * 0.08).toFixed(2)}s` } : {}) }); svg.append(rect); const t = sv("text", { x: LW + w + 6, y: y + 10, class: "rr-chart-v" }); t.textContent = `${v}${it.unit ? " " + (it.unit === "lines" ? T("lines", "行") : it.unit) : ""}`; svg.append(t); };
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
  it = figIn(RR.rooms.get(card), it);
  const head = h("div", { class: "rr-item-h" }, it.kind ? kindBadge(it.kind, it.kind === "chart" ? (it.from === "git" ? T("counted by git", "git 計算") : T("from cited numbers", "依引用的數字")) : it.kind === "illustration" && it.model ? `${it.provider} ${it.model}` : null) : h("span", { class: "vbadge", "data-type": it.type }, typeLabel(it.type)), h("b", {}, itemTitle(it)), it.path ? h("code", { "data-item-path": it.path }, `${it.path}${it.start ? `:${it.start}-${it.end}` : ""}`) : null, it.commit ? h("span", { class: "faint" }, ` @ ${String(it.commit).slice(0, 8)}`) : null);
  let body;
  if (it.type === "mermaid") { const g = parseFlow(it.code), p = prev ? parseFlow(prev.code) : null; body = g ? h("div", { class: "rr-flow-wrap", "data-flow": it.id }, flowSvg(g, p, drawnOf(card, it), picBox())) : [h("p", { class: "faint" }, T("Diagram source (Studio draws flowcharts; this kind is shown as text)", "圖表原始碼（Studio 會畫 flowchart；這種圖以文字顯示）")), h("pre", { class: "rr-pre" }, it.code)]; }
  else if (it.type === "diff") body = [it.header ? h("p", { class: "faint" }, it.header) : null, diffPre(it.text)];
  else if (it.type === "code") body = linesPre(it, it.highlight || []);
  else if (it.type === "screenshot") body = shotView(card, it);
  else if (it.type === "chart") body = chartView(it, drawnOf(card, it));
  else if (it.type === "image") body = imageView(it);
  else if (it.type === "compare") body = h("div", { class: "rr-compare" }, h("div", {}, h("b", {}, T("Before (base)", "之前（base）")), linesPre(it.before)), h("div", {}, h("b", {}, T("After (head)", "之後（head）")), linesPre(it.after)));
  else if (it.type === "keycard") body = keycardView(it, drawnOf(card, it));
  else if (it.type === "item") body = itemFigure(it, drawnOf(card, it));
  else if (it.type === "arch") body = archView(card, it);
  else if (it.type === "svg") body = svgFigureView(card, it);
  else if (it.type === "calls") body = callsView(card, it);
  else if (it.type === "decision") body = decisionView(card, it);
  else if (it.type === "states") body = statesView(card, it);
  else if (it.type === "sequence") body = sequenceView(it, drawnOf(card, it));
  // a table, the tutor's or one from an older answer: cells as text
  else if (it.type === "table") body = h("table", { class: "rr-table", "data-table": it.id }, (it.rows || []).map((row, i) => h("tr", {}, row.map((c) => h(i ? "td" : "th", {}, String(c))))));
  else if (it.type === "snippet") body = h("pre", { class: "rr-pre" }, it.text || "");
  else body = h("p", { class: "rr-note" }, inline(card, it.text || "", it.cites));
  // the picture first, filling its box; what it is (kind, title, path) and its basis under it
  const pic = ["mermaid", "chart", "screenshot", "image", "keycard", "item", "states", "sequence", "arch", "decision", "svg", "calls"].includes(it.type);
  return h("article", { class: `rr-item rr-item-${it.type}`, id: `rr-${it.id}`, "data-board-item": it.id, "data-item-type": it.type }, h("div", { class: `rr-body${pic ? " pic" : " text"}` }, body), head, basisRow(card, it));
}
/** One changed item, before and after, from one layout for every item (baton's per-fix card): the same three boxes in two
 *  rows, the change marked on the component in the after row with its mechanism, the old outcome no longer reached. Text
 *  nodes only; the tutor gave the words, Studio draws everything. */
function itemFigure(it, seen) {
  const anim = seen && !seen.has("item") && !reduceMotion(); if (seen) seen.add("item");
  const W = 640, H = 230, svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "rr-itemfig", role: "img", "data-item-figure": it.id, preserveAspectRatio: "xMidYMid meet", "aria-label": `${it.name}: ${it.before} → ${it.after}`, style: `max-width:${W * 1.5}px;max-height:${H * 1.5}px` });
  const box = (x, y, w, h, cls, lines, key, dl) => { const g = sv("g", { class: `rr-ib ${cls}` }), p = sv("path", { d: boxPath(x, y, w, h, 10), pathLength: 1 }); if (anim) { p.classList.add("rr-pen"); p.style.setProperty("--dl", `${dl}s`); } g.append(p);
    lines.forEach((l, i) => { const t = sv("text", { x: x + w / 2, y: y + h / 2 + (i - (lines.length - 1) / 2) * 20 + 6, "text-anchor": "middle", class: i ? "rr-ib-sub" : "rr-ib-main" }); t.textContent = l; if (anim) { t.classList.add("rr-write"); t.style.setProperty("--dl", `${dl + 0.3}s`); } g.append(t); }); return g; };
  const arrow = (x1, x2, y, cls, dl) => { const g = sv("g", { class: `rr-ia ${cls}` }), l = sv("path", { d: `M${x1},${y} L${x2},${y}`, pathLength: 1 }), a = sv("path", { d: `M${x2 - 10},${y - 6} L${x2},${y} L${x2 - 10},${y + 6}`, pathLength: 1, class: "rr-ia-head" }); if (anim) { l.classList.add("rr-pen"); l.style.setProperty("--dl", `${dl}s`); } g.append(l, a); return g; };
  const label = (y, text) => { const t = sv("text", { x: 14, y, class: "rr-ib-row" }); t.textContent = text; return t; };
  svg.append(label(26, T("Before", "之前")), box(90, 40, 210, 64, "", wrapLabel(it.name, 190, 16, 2), "b1", 0), arrow(300, 370, 72, "", 0.2), box(372, 40, 250, 64, "old", wrapLabel(it.before, 230, 16, 2), "b2", 0.3));
  svg.append(label(140, T("After", "之後")), box(90, 154, 210, 64, "fix", [...wrapLabel(it.name, 190, 16, 1), ...(it.mechanism ? [clip(it.mechanism, 37)] : [])], "a1", 0.5), arrow(300, 370, 186, "new", 0.7), box(372, 154, 250, 64, "now", wrapLabel(it.after, 230, 16, 2), "a2", 0.8));
  return svg;
}
/** Studio's own layout for a lifecycle or a "what talks to what", baton's way (diagram-design's connector rules, applied by
 *  code). The caller places the boxes (statePlace: the way it should go on one row, the bad ends below, the side states
 *  above; archPlace: layers left to right, the stores last). Every connector is a straight line or one smooth curve between
 *  the two boxes' borders, bowed only as far as it must to clear every other box and never to run along another connector
 *  (two between the same boxes bow apart); a box's way back to itself is a small loop. Each connector's chip, its number and
 *  words on a paper pill, sits on the connector near its middle. nodes: [{id, label, cls, shape}], edges: [{from, to, label, n, cls}] */
const CJK_W = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯①-⓿]/;
const textW = (s, fs) => [...String(s || "")].reduce((n, ch) => n + (CJK_W.test(ch) ? fs : fs * 0.6), 0);
/** the connectors that close a cycle (the ways back), walking from the first node */
function backEdges(ids, edges) {
  const adj = new Map(ids.map((id) => [id, []])), mark = new Map(), back = new Set();
  edges.forEach((e, i) => { if (e.from !== e.to && adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push([e.to, i]); });
  const dfs = (u) => { mark.set(u, 1); for (const [v, i] of adj.get(u)) { if (mark.get(v) === 1) back.add(i); else if (!mark.has(v)) dfs(v); } mark.set(u, 2); };
  for (const id of ids) if (!mark.has(id)) dfs(id);
  return back;
}
/** each node's longest path from a source (the ways back left out), and the node it came from */
const longestPaths = (ids, edges, back) => { const rank = new Map(ids.map((id) => [id, 0])), pred = new Map();
  for (let k = 0; k < ids.length; k++) edges.forEach((e, i) => { if (e.from !== e.to && !back.has(i) && rank.has(e.from) && rank.has(e.to) && rank.get(e.to) < rank.get(e.from) + 1) { rank.set(e.to, rank.get(e.from) + 1); pred.set(e.to, e.from); } });
  return { rank, pred }; };
const CHIP_FS = 12, chipText = (e) => String(e.label || "").slice(0, 40), chipW = (e) => textW(chipText(e), CHIP_FS) + 18;
const nodeSize = (n, fs) => { const lines = wrapLabel(n.label, 196, fs, 2), w = Math.max(n.shape === "cyl" ? 140 : 112, Math.ceil((Math.max(0, ...lines.map((l) => textW(l, fs))) + 44) / 4) * 4);
  return { w, h: n.shape === "cyl" ? 72 : lines.length > 1 ? 60 : 44, lines }; };
/** a segment crossing: where p–q meets r–s, or null */
const segCross = (p, q, r, t) => { const d = (q[0] - p[0]) * (t[1] - r[1]) - (q[1] - p[1]) * (t[0] - r[0]); if (!d) return null;
  const u = ((r[0] - p[0]) * (t[1] - r[1]) - (r[1] - p[1]) * (t[0] - r[0])) / d, v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])] : null; };
/** a lifecycle, baton's way. The way it should go on one row left to right (the longest path from where it starts to an end
 *  that went well). The ways back along that row, and the skips over a state on it, are arcs above it, nested by span (the
 *  shorter inside). The states that end badly or need attention sit in the lane below, the others in the lane above, each
 *  under the median of the states it meets, in the order that crosses the fewest connectors. */
function statePlace(nodes, edges, fs) {
  const ids = nodes.map((n) => n.id), cls = new Map(nodes.map((n) => [n.id, n.cls || ""])), back = backEdges(ids, edges), { rank, pred } = longestPaths(ids, edges, back);
  const bad = (id) => /\b(seal|amber)\b/.test(cls.get(id)), ends = ids.filter((id) => !edges.some((e) => e.from === id && e.to !== id)), good = ends.filter((id) => !bad(id));
  const end = (good.length ? good : ids).reduce((a, b) => (rank.get(b) > rank.get(a) ? b : a));
  const main = [end]; while (pred.has(main[0]) && !main.includes(pred.get(main[0]))) main.unshift(pred.get(main[0]));
  while (main.length > 2 && bad(main[main.length - 1])) main.pop();
  const size = new Map(nodes.map((n) => [n.id, nodeSize(n, fs)])), gap = Math.min(170, Math.max(110, Math.max(0, ...edges.map(chipW)) + 44)), box = new Map(), col = new Map();
  const H0 = Math.max(...main.map((id) => size.get(id).h)); let x = 0;
  main.forEach((id, c) => { const z = size.get(id); col.set(id, c); box.set(id, { x, y: -z.h / 2, w: z.w, h: z.h, lines: z.lines }); x += z.w + gap; });
  // along the main row: the first step forward between two neighbours is a straight line; every other one an arc above
  const straight = new Set(), arcs = [], seen = new Set();
  edges.forEach((e, i) => { if (e.from === e.to || !col.has(e.from) || !col.has(e.to)) return; const d = col.get(e.to) - col.get(e.from), k = `${e.from}>${e.to}`;
    if (d === 1 && !seen.has(k)) { straight.add(i); seen.add(k); } else arcs.push(i); });
  const iv = (i) => [Math.min(col.get(edges[i].from), col.get(edges[i].to)), Math.max(col.get(edges[i].from), col.get(edges[i].to))];
  arcs.sort((i, j) => iv(i)[1] - iv(i)[0] - (iv(j)[1] - iv(j)[0]) || i - j);
  const arc = new Map(); // edge → its level: one above every shorter arc it overlaps
  for (const i of arcs) { const [a0, a1] = iv(i); let lv = 0; for (const [j, l] of arc) { const [b0, b1] = iv(j); if (b0 < a1 && a0 < b1 || (b0 === a0 && b1 === a1)) lv = Math.max(lv, l + 1); } arc.set(i, lv); }
  const arcTop = arcs.length ? 40 + 30 * Math.max(...arc.values()) + 30 : 0, cx = (id) => box.get(id).x + box.get(id).w / 2;
  // the lanes: each state under the median of the main-row states it meets; the order that crosses fewest straight connectors
  const rest = ids.filter((id) => !col.has(id)), lanes = [[rest.filter(bad), H0 / 2 + 112], [rest.filter((id) => !bad(id)), -H0 / 2 - arcTop - 70]];
  for (const [list, y0] of lanes) { if (!list.length) continue;
    const want = new Map(list.map((id) => { const xs = edges.filter((e) => e.from !== e.to && (e.from === id || e.to === id)).map((e) => (e.from === id ? e.to : e.from)).filter((o) => col.has(o)).map(cx).sort((a, b) => a - b);
      return [id, xs.length ? (xs[(xs.length - 1) >> 1] + xs[xs.length >> 1]) / 2 : cx(main[0])]; }));
    const lay = (perm) => { const out = new Map(); let right = -Infinity;
      for (const id of perm) { const z = size.get(id), left = Math.max(want.get(id) - z.w / 2, right + 48); out.set(id, { x: left, y: y0 > 0 ? y0 : y0 - z.h, w: z.w, h: z.h, lines: z.lines }); right = left + z.w; }
      // shifted back as far as it can go toward where they want to be (the order kept)
      const shift = [...out].reduce((m, [id, b]) => Math.min(m, b.x + b.w / 2 - want.get(id)), Infinity); if (shift > 0) for (const b of out.values()) b.x -= shift; return out; };
    const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((v, k) => perms([...a.slice(0, k), ...a.slice(k + 1)]).map((p) => [v, ...p])));
    const cand = list.length <= 5 ? perms(list) : [[...list].sort((a, b) => want.get(a) - want.get(b))];
    const score = (perm) => { const lb = lay(perm), at = (id) => lb.get(id) ?? box.get(id), c = (id) => { const b = at(id); return b ? [b.x + b.w / 2, b.y + b.h / 2] : null; };
      const segs = edges.map((e, i) => (e.from === e.to || straight.has(i) || arc.has(i) || !c(e.from) || !c(e.to) ? null : [c(e.from), c(e.to), e])).filter(Boolean);
      let n = 0; for (let a = 0; a < segs.length; a++) for (let b2 = a + 1; b2 < segs.length; b2++) { const [p, q, e] = segs[a], [r, t, g] = segs[b2]; if ([e.from, e.to].some((id) => id === g.from || id === g.to)) continue; if (segCross(p, q, r, t)) n++; }
      return n * 1e5 + [...lb].reduce((m, [id, b]) => m + Math.abs(b.x + b.w / 2 - want.get(id)), 0); };
    const best = cand.reduce((a, b) => (score(b) < score(a) ? b : a)); for (const [id, b] of lay(best)) box.set(id, b); }
  return { box, back, straight, arc };
}
/** what talks to what: layers left to right by the longest path, the stores and queues in the last layer, each layer's
 *  boxes ordered by where their neighbours sit and centred on one another */
function archPlace(nodes, edges, fs) {
  const ids = nodes.map((n) => n.id), back = backEdges(ids, edges), { rank } = longestPaths(ids, edges, back), max = Math.max(0, ...rank.values());
  for (const n of nodes) if (n.shape === "cyl" && !edges.some((e) => e.from === n.id && e.to !== n.id)) rank.set(n.id, max);
  const cols = Array.from({ length: max + 1 }, () => []); for (const id of ids) cols[rank.get(id)].push(id);
  const pos = new Map(); cols.forEach((c) => c.forEach((id, i) => pos.set(id, i - (c.length - 1) / 2)));
  for (let sweep = 0; sweep < 3; sweep++) cols.forEach((c, r) => { if (!r) return;
    const bc = (id) => { const ns = edges.filter((e) => e.from !== e.to && (e.to === id || e.from === id)).map((e) => (e.to === id ? e.from : e.to)).filter((o) => rank.get(o) !== r).map((o) => pos.get(o)); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : pos.get(id); };
    c.sort((a, b) => bc(a) - bc(b) || ids.indexOf(a) - ids.indexOf(b)); c.forEach((id, i) => pos.set(id, i - (c.length - 1) / 2)); });
  const size = new Map(nodes.map((n) => [n.id, nodeSize(n, fs)])), gap = Math.min(170, Math.max(100, Math.max(0, ...edges.map(chipW)) + 40)), box = new Map(); let x = 0;
  cols.forEach((c) => { const w = Math.max(0, ...c.map((id) => size.get(id).w)), hs = c.map((id) => size.get(id).h), total = hs.reduce((a, b) => a + b, 0) + (c.length - 1) * 72; let y = -total / 2;
    c.forEach((id, i) => { const s = size.get(id); box.set(id, { x: x + (w - s.w) / 2, y, w: s.w, h: s.h, lines: s.lines }); y += hs[i] + 72; }); x += w + gap; });
  return { box, back };
}
function curveSvg(nodes, edges, placed, opt = {}) {
  const fs = opt.fs || 15, { box, back } = placed, cen = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const rayOut = (b, dx, dy) => { const [cx, cy] = cen(b), t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity); return [cx + dx * t, cy + dy * t]; };
  const bez = (P, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]); };
  const sample = (P, n = 60) => Array.from({ length: n + 1 }, (_, k) => bez(P, k / n));
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // an attach point slid along its face toward the side the connector bows to (two between the same boxes leave apart)
  const slideOn = (b, [px, py], nx, ny, k) => { const side = Math.abs(px - b.x) < 0.5 || Math.abs(px - b.x - b.w) < 0.5;
    return side ? [px, Math.max(b.y + 8, Math.min(b.y + b.h - 8, py + ny * k * (b.h / 2 - 8)))] : [Math.max(b.x + 14, Math.min(b.x + b.w - 14, px + nx * k * (b.w / 2 - 14))), py]; };
  const curveOf = (e, bow) => { const a = box.get(e.from), b = box.get(e.to), [ax, ay] = cen(a), [bx, by] = cen(b), L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
    const k = Math.max(-1, Math.min(1, bow / 36)), p0 = slideOn(a, rayOut(a, bx - ax, by - ay), nx, ny, k), p3 = slideOn(b, rayOut(b, ax - bx, ay - by), nx, ny, k);
    const q = [(p0[0] + p3[0]) / 2 + nx * bow * 2, (p0[1] + p3[1]) / 2 + ny * bow * 2];
    return bow ? [p0, lerp(p0, q, 2 / 3), lerp(p3, q, 2 / 3), p3] : [p0, lerp(p0, p3, 1 / 3), lerp(p0, p3, 2 / 3), p3]; };
  // an arc above the main row: out of the top of one box, into the top of the other, higher by level (outer arcs leave
  // and land further out, so the nested ones never meet)
  const arcOf = (e, lv) => { const a = box.get(e.from), b = box.get(e.to), aLeft = a.x < b.x, [l, r] = aLeft ? [a, b] : [b, a];
    const lx = Math.max(l.x + 12, l.x + l.w * 0.74 - 24 * lv), rx = Math.min(r.x + r.w - 12, r.x + r.w * 0.26 + 24 * lv), H = (40 + 30 * lv) * 4 / 3;
    const L = [lx, l.y], R = [rx, r.y], [p0, p3] = aLeft ? [L, R] : [R, L]; return [p0, [p0[0], p0[1] - H], [p3[0], p3[1] - H], p3]; };
  // a way back from a state in a lane, round the outside: out of its far side, round, into the side of its target
  const aroundOf = (e, sd) => { const a = box.get(e.from), b = box.get(e.to), p0 = [sd > 0 ? a.x + a.w : a.x, a.y + a.h / 2], p3 = [sd > 0 ? b.x + b.w : b.x, b.y + b.h / 2];
    const ox = sd > 0 ? Math.max(p0[0], p3[0]) + 70 : Math.min(p0[0], p3[0]) - 70; return [p0, [ox, p0[1] + 30], [ox, p3[1]], p3]; };
  // under everything between its ends: out of the bottom of one box, into the bottom of the other
  const underOf = (e) => { const a = box.get(e.from), b = box.get(e.to), x0 = Math.min(a.x, b.x), x1 = Math.max(a.x + a.w, b.x + b.w);
    const lo = Math.max(...[...box.values()].filter((o) => o.x + o.w > x0 && o.x < x1).map((o) => o.y + o.h)) + 30, p0 = [a.x + a.w / 2, a.y + a.h], p3 = [b.x + b.w / 2, b.y + b.h];
    return [p0, [p0[0], p0[1] + (lo - p0[1]) * 4 / 3], [p3[0], p3[1] + (lo - p3[1]) * 4 / 3], p3]; };
  const loopOf = (e, s) => { const b = box.get(e.from), cx = b.x + b.w / 2, y = s > 0 ? b.y + b.h : b.y; return [[cx - 16, y], [cx - 40, y + s * 58], [cx + 40, y + s * 58], [cx + 16, y]]; };
  const inBox = ([x, y], b, pad) => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad;
  const segDist = ([px, py], [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
  const near = (p, pts, d) => { for (let k = 1; k < pts.length; k++) if (segDist(p, pts[k - 1], pts[k]) < d) return true; return false; };
  const drawn = [], boxes0 = [...box.values()], chips = []; // drawn: [{i, P, pts, chip}]
  const over = (r, o, pad) => r.x < o.x + o.w + pad && r.x + r.w + pad > o.x && r.y < o.y + o.h + pad && r.y + r.h + pad > o.y;
  // a connector's chip: on it, at its middle or as near it as a place clear of the boxes, the chips and the other connectors allows
  const chipFor = (e, P) => { if (!e.label) return null; const w = chipW(e), hh = 20;
    return [0.5, 0.45, 0.55, 0.4, 0.6, 0.34, 0.66, 0.28, 0.72, 0.22, 0.78].map((t) => { const [x, y] = bez(P, t), r = { x: x - w / 2, y: y - hh / 2, w, h: hh };
      const hard = boxes0.filter((b) => over(r, b, 3)).length + chips.filter((c) => over(r, c, 3)).length, soft = drawn.filter((o) => o.pts.some((p) => inBox(p, r, 2))).length;
      return { r, x, y, cost: hard * 1000 + soft * 400 + Math.abs(t - 0.5) * 20 }; }).reduce((a, b) => (b.cost < a.cost ? b : a)); };
  // a candidate's faults: through a box not its end (or back into its own), along another connector (a run of samples on it), crossings
  // crossings with the connectors already drawn (where two meet at a box they share does not count)
  const crossings = (e, pts, d) => { const g = edges[d.i], shared = [e.from, e.to].filter((id) => id === g.from || id === g.to).map((id) => box.get(id)); let n = 0;
    for (let a = 1; a < pts.length; a++) for (let b = 1; b < d.pts.length; b++) { const x = segCross(pts[a - 1], pts[a], d.pts[b - 1], d.pts[b]); if (x && !shared.some((sb) => inBox(x, sb, 14))) n++; } return n; };
  const judge = (e, P) => { const pts = sample(P, 40), ends = [box.get(e.from), box.get(e.to)]; let hard = 0, cross = 0;
    for (const [id, b] of box) { if (id === e.from || id === e.to) continue; if (pts.some((p) => inBox(p, b, 8))) hard++; }
    if (pts.slice(4, -4).some((p) => ends.some((b) => inBox(p, b, -2)))) hard++;
    // along another connector: a stretch of 12px or more within 3px of it, away from the boxes they meet at (a crossing at
    // a fair angle is shorter)
    const step = pts.slice(1).reduce((n, p, k) => n + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0) / (pts.length - 1);
    for (const d of drawn) { let run = 0, best = 0, hit = 0; for (const p of pts) { if (boxes0.some((b) => inBox(p, b, 10))) { run = 0; continue; } if (near(p, d.pts, 3)) { run += step; hit = 1; best = Math.max(best, run); } else run = 0; }
      if (best >= 12) hard++; cross += crossings(e, pts, d); }
    const onChip = chips.filter((c) => pts.some((p) => inBox(p, c, 2))).length, chip = chipFor(e, P);
    return { hard, cross, pts, chip, cost: hard * 1000 + onChip * 400 + (chip ? chip.cost * 0.6 : 0) + cross * 260 }; };
  const keep = (i, c) => { drawn.push({ i, P: c.P, pts: c.pts, chip: c.chip }); if (c.chip) chips.push(c.chip.r); };
  // the order: the plain steps forward first (they take the straight lines), then the longer ones, the ways back, the loops
  const span = (e) => Math.hypot(...[0, 1].map((k) => cen(box.get(e.to))[k] - cen(box.get(e.from))[k]));
  const order = edges.map((e, i) => i).filter((i) => box.has(edges[i].from) && box.has(edges[i].to)).sort((i, j) => {
    const w = (k) => (edges[k].from === edges[k].to ? 3 : back.has(k) ? 2 : 1); return w(i) - w(j) || span(edges[i]) - span(edges[j]) || i - j; });
  const pairs = new Map(); edges.forEach((e, i) => { if (e.from === e.to) return; const k = [e.from, e.to].sort().join("\u0000"); if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(i); });
  // a connector's best way, the others as they are
  const route = (i) => { const e = edges[i];
    if (e.from === e.to) return [1, -1].map((s) => loopOf(e, s)).map((P) => ({ P, ...judge(e, P) })).reduce((a, b) => (b.cost < a.cost ? b : a));
    if (placed.straight?.has(i)) { const P = curveOf(e, 0); return { P, bow: 0, ...judge(e, P) }; }
    if (placed.arc?.has(i)) { const P = arcOf(e, placed.arc.get(i)); return { P, bow: 0, ...judge(e, P) }; }
    const grp = pairs.get([e.from, e.to].sort().join("\u0000")).filter((j) => !placed.straight?.has(j) && !placed.arc?.has(j)), k = grp.indexOf(i), canon = [e.from, e.to].sort()[0] === e.from ? 1 : -1;
    // apart from the others between the same boxes: far enough that their chips, side by side, do not meet
    const [ax, ay] = cen(box.get(e.from)), [bx, by] = cen(box.get(e.to)), upright = Math.abs(by - ay) > Math.abs(bx - ax);
    const off = grp.length > 1 ? (k - (grp.length - 1) / 2) * (upright ? Math.max(44, ...grp.map((j) => chipW(edges[j]))) + 10 : 44) * canon : 0;
    const pref = grp.length > 1 ? off : back.has(i) ? -40 : 0, cands = [];
    for (const d of [0, 24, -24, 48, -48, 72, -72, 100, -100, 136, -136, 180, -180, 240, -240, 320, -320]) { const bow = pref + d; if (grp.length > 1 && (Math.abs(bow) < 16 || Math.sign(bow) !== Math.sign(off))) continue; const P = curveOf(e, bow); cands.push({ P, bow, ...judge(e, P) }); }
    if (placed.arc && back.has(i)) for (const sd of [1, -1]) { const P = aroundOf(e, sd); cands.push({ P, bow: pref + 120, ...judge(e, P) }); }
    if (placed.arc && grp.length < 2) { const P = underOf(e); cands.push({ P, bow: pref + 100, ...judge(e, P) }); }
    return cands.reduce((a, b) => { const s = (x) => x.cost + Math.abs(x.bow - pref) * 0.8; return s(b) < s(a) ? b : a; }); };
  for (const i of order) keep(i, route(i));
  // twice more, each connector again with every other one in place: one routed early now sees the ones that came after it
  for (let pass = 0; pass < 2; pass++) for (const i of order) { const k = drawn.findIndex((d) => d.i === i), [d] = drawn.splice(k, 1); if (d.chip) chips.splice(chips.indexOf(d.chip.r), 1); keep(i, route(i)); }
  drawn.sort((a, b) => a.i - b.i);
  const svg = sv("svg", { class: "rr-flow rr-ortho rr-curve", role: "img", preserveAspectRatio: "xMidYMid meet" });
  const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, grow = (x, y) => { ext.x0 = Math.min(ext.x0, x); ext.y0 = Math.min(ext.y0, y); ext.x1 = Math.max(ext.x1, x); ext.y1 = Math.max(ext.y1, y); };
  const kindOf = (i) => (edges[i].from === edges[i].to ? "loop" : back.has(i) ? "back" : "next");
  for (const d of drawn) { const e = edges[d.i], P = d.P, kind = kindOf(d.i), cl = `${kind}${e.cls ? ` ${e.cls}` : ""}`; d.pts.forEach(([x, y]) => grow(x, y));
    const [ex, ey] = P[3], ang = Math.atan2(ey - P[2][1], ex - P[2][0]);
    const dd = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)} C${P[1].map((v) => v.toFixed(1))} ${P[2].map((v) => v.toFixed(1))} ${P[3].map((v) => v.toFixed(1))}`;
    svg.append(sv("path", { d: dd, class: `rr-edge ${cl}`, "data-edge": `${e.from}>${e.to}`, "data-edge-n": e.n ?? d.i, fill: "none" }), sv("path", { d: dd, class: "rr-edge-hit", "data-edge-hit": `${e.from}>${e.to}`, "data-edge-n": e.n ?? d.i }),
      sv("path", { d: `M${ex - 10 * Math.cos(ang - 0.42)},${ey - 10 * Math.sin(ang - 0.42)} L${ex},${ey} L${ex - 10 * Math.cos(ang + 0.42)},${ey - 10 * Math.sin(ang + 0.42)} Z`, class: `rr-ahead ${cl}` })); }
  for (const n of nodes) { const b = box.get(n.id), grp = sv("g", { class: `rr-node${n.cls ? ` ${n.cls}` : ""}`, "data-node": n.id, "data-box": `${b.x},${b.y},${b.w},${b.h}` }), e = 9;
    grow(b.x, b.y); grow(b.x + b.w, b.y + b.h);
    if (n.shape === "cyl") grp.append(sv("path", { class: "rr-box", d: `M${b.x},${b.y + e} A${b.w / 2},${e} 0 0 1 ${b.x + b.w},${b.y + e} V${b.y + b.h - e} A${b.w / 2},${e} 0 0 1 ${b.x},${b.y + b.h - e} Z` }), sv("path", { class: "rr-cyl-lip", d: `M${b.x},${b.y + e} A${b.w / 2},${e} 0 0 0 ${b.x + b.w},${b.y + e}`, fill: "none" }));
    else grp.append(sv("path", { class: "rr-box", d: boxPath(b.x, b.y, b.w, b.h, n.shape === "pill" ? b.h / 2 : 8) }));
    const dy = n.shape === "cyl" ? e / 2 : 0; b.lines.forEach((l, k) => { const tx = sv("text", { x: b.x + b.w / 2, y: b.y + b.h / 2 + dy + (k - (b.lines.length - 1) / 2) * (fs + 3) + fs * 0.35, "text-anchor": "middle", class: "rr-nlabel", style: `font-size:${fs}px` }); tx.textContent = l; grp.append(tx); });
    svg.append(grp); }
  // the chips, placed with their connectors
  for (const d of drawn) { const e = edges[d.i], c = d.chip; if (!c) continue; const hh = c.r.h; grow(c.r.x, c.r.y); grow(c.r.x + c.r.w, c.r.y + c.r.h);
    const g = sv("g", { class: `rr-chip ${kindOf(d.i)}${e.cls ? ` ${e.cls}` : ""}`, "data-elabel": `${e.from}>${e.to}`, "data-edge-n": e.n ?? d.i }), t = sv("text", { x: c.x, y: c.y + 4.2, "text-anchor": "middle", class: "rr-elabel" });
    t.textContent = chipText(e); g.append(sv("rect", { class: "rr-chip-bg", x: c.r.x, y: c.r.y, width: c.r.w, height: c.r.h, rx: hh / 2 }), t); svg.append(g); }
  const vw = ext.x1 - ext.x0 + 24, vh = ext.y1 - ext.y0 + 24;
  svg.setAttribute("viewBox", `${(ext.x0 - 12).toFixed(1)} ${(ext.y0 - 12).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);
  svg.style.maxWidth = `${Math.round(vw * 1.15)}px`; svg.style.minWidth = `${Math.round(Math.min(vw * 0.8, 860))}px`;
  return svg;
}
const NUMS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
/** a state's colour by what it is: where it starts, an end that went well, an end that did not (failed, voided, cancelled) */
const stateCls = (it, x, i) => { const outs = (it.transitions || []).filter((t) => t.from === x.id && t.to !== x.id).length, bad = /fail|error|cancel|void|reject|expire|refund|declin|abort/i.test(`${x.id} ${x.label}`);
  return x.mark === "changed" || x.mark === "new" ? `accent${i === 0 ? " start" : ""}` : i === 0 ? "start" : !outs ? (bad ? "seal" : "ok") : bad ? "amber" : ""; };
/** a lifecycle's graph from its data: every state, every transition numbered (the number is the transition's chip) */
const statesGraph = (it) => ({ nodes: (it.states || []).map((x, i) => ({ id: x.id, label: x.label || x.id, shape: "pill", cls: stateCls(it, x, i) })),
  edges: (it.transitions || []).map((t, i) => ({ from: t.from, to: t.to, label: `${NUMS[i] || i + 1} ${t.label || ""}`.trim(), n: i, cls: t.tx?.tables?.length ? "tx" : "" })) });
/** on the lesson board a click on a drawing asks there (its popover's "Show the code" opens what it cites) */
const onBoard = () => !!document.querySelector("[data-board-vp]");
/** an SVG label made a control: Enter and Space as a click */
// on the lesson board a drawing's part is a place to ask: its keys open the board's popover (BOARD.keydown), not this control
const asControl = (el, go) => { el.setAttribute("role", "button"); el.setAttribute("tabindex", "0"); el.addEventListener("click", go); el.addEventListener("keydown", (e) => { if (el.hasAttribute("data-akey") && el.closest("[data-board-vp]")) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }); };
/** a lifecycle: the state machine drawn from the tutor's states and transitions (every transition kept), each transition's
 *  label opening the code it rests on (onPick: the report also selects the transition to show what it writes) */
function statesView(card, it, onPick) {
  if (!it.states?.length) { const g = parseFlow(it.code); return h("div", { class: "rr-flow-wrap", "data-states": it.id }, g ? flowSvg(g, null, drawnOf(card, it), picBox()) : null); }
  const g = statesGraph(it), wrap = h("div", { class: "rr-flow-wrap rr-states", "data-states": it.id }, curveSvg(g.nodes, g.edges, statePlace(g.nodes, g.edges, 15)));
  (it.transitions || []).forEach((t, i) => { const el = wrap.querySelector(`[data-elabel][data-edge-n="${i}"]`); if (!el || (!onPick && !t.cite?.ok)) return;
    if (t.cite?.ok) { el.classList.add("rr-cite-label"); el.setAttribute("data-transition-cite", t.cite.ref); }
    el.setAttribute("data-transition-pick", String(i)); asControl(el, () => (onPick ? onPick(i, t) : !onBoard() && openCite(card, t.cite.ref))); });
  // a state picked: the transaction that brings the entity into it
  if (onPick) for (const nodeEl of wrap.querySelectorAll("[data-node]")) { const id = nodeEl.getAttribute("data-node"), k = (it.transitions || []).findIndex((t) => t.to === id && t.from !== id);
    if (k >= 0) { nodeEl.setAttribute("data-state-pick", id); asControl(nodeEl, () => onPick(k, it.transitions[k], true)); } }
  return wrap;
}
/** one transaction: the tables it writes (op, the guard, each field was → now) inside its envelope, what it writes outside set apart */
function txView(tx) {
  if (!tx || tx.error) return null;
  return h("div", { class: "rp-tx", "data-tx": "" }, (tx.tables || []).length ? h("div", { class: "rp-tx-env" }, h("div", { class: "rp-tx-cap" }, T("One database transaction", "同一個資料庫交易")),
      tx.tables.map((t) => h("div", { class: "rp-tx-row", "data-tx-table": t.table }, h("div", { class: "rp-tx-h" }, h("span", { class: `rp-op ${t.op.toLowerCase()}` }, t.op), h("code", {}, t.table), t.guard ? h("span", { class: "rp-guard" }, `${T("guard", "條件")}: `, h("code", {}, t.guard)) : null),
        h("table", { class: "rp-fields" }, t.fields.map((x) => h("tr", {}, h("td", { class: "k" }, h("code", {}, x.k)), h("td", {}, x.was != null ? h("s", { class: "was" }, x.was) : null, x.was != null ? " → " : "", h("b", { class: "now" }, x.now)))))))) : null,
    (tx.outside || []).length ? h("div", { class: "rp-outside", "data-tx-outside": "" }, h("div", { class: "rp-tx-cap" }, T("Outside the transaction", "交易之外")), h("ul", {}, tx.outside.map((o) => h("li", {}, o.kind ? h("span", { class: "rp-op" }, o.kind) : null, " ", o.what)))) : null);
}
/** every transition as a numbered row: from → to, what it writes (its transaction, when the tutor read one), the code it rests on */
function transitionRows(card, it, sel, pick, lab) {
  return h("ol", { class: "rp-trans", "aria-label": T("Every transition", "每一個轉換") }, (it.transitions || []).map((t, i) => h("li", { class: i === sel ? "on" : "", "data-transition": i, "aria-current": i === sel ? "true" : null },
    h("button", { type: "button", class: "rp-tn", "data-transition-row": i, onclick: () => pick(i, t) }, NUMS[i] || String(i + 1)),
    h("div", {}, h("b", {}, `${lab.get(t.from) ?? t.from} → ${lab.get(t.to) ?? t.to}`), t.label ? h("span", { class: "rp-tl" }, ` · ${t.label}`) : null,
      t.detail ? h("p", { class: "rp-td" }, t.detail) : null, t.why ? h("p", { class: "rp-td rp-tw", "data-transition-why": i }, h("span", { class: "rr-explain-k" }, T("Why this way", "為什麼這樣設計")), " ", t.why) : null, t.cite ? h("div", {}, citeChip(card, t.cite.ref, t.cite.ok)) : h("div", {}, inferenceBadge())))));
}
/** the lifecycle in the report: the map, and every transition as a numbered row (what it writes, the code it rests on) */
function statemapView(card, it) {
  const key = `${card}/${it.id}`, sel = RR.tsel.get(key) ?? 0, lab = new Map((it.states || []).map((x) => [x.id, x.label || x.id]));
  const pick = (i, t, quiet) => { RR.tsel.set(key, i); if (t.cite?.ok && !quiet && !onBoard()) openCite(card, t.cite.ref); else rerender(); };
  const map = statesView(card, it, pick); map.querySelector(`[data-elabel][data-edge-n="${sel}"]`)?.classList.add("on");
  return h("div", { class: "rp-smap", "data-statemap": it.id }, it.entity ? h("p", { class: "rp-entity" }, T("Entity", "實體"), ": ", h("code", {}, it.entity)) : null, map,
    h("div", { class: "rp-legend" }, [...((it.states || []).some((x) => x.mark) ? [["accent", T("this change", "這個改動")]] : []), ["start", T("where it starts", "起點")], ["ok", T("ends well", "正常結束")], ["seal", T("ends badly, cannot be undone", "失敗結束，無法回頭")], ["back", T("a way back", "回頭的轉換")]].map(([c, l]) => h("span", {}, h("i", { class: `sw ${c}` }), l)), h("span", { class: "rp-hint" }, T("Pick a numbered chip or a state: its transaction shows below.", "點編號或狀態：下方顯示它的交易。"))),
    txPanel(card, it, sel, lab), transitionRows(card, it, sel, pick, lab));
}
/** the picked transition's transaction, right under the map (baton's panel): from → to, the tables it writes, what it writes outside */
function txPanel(card, it, sel, lab) {
  const t = (it.transitions || [])[sel]; if (!t) return null;
  return h("div", { class: "rp-txpanel", "data-tx-panel": sel, "aria-live": "polite" }, h("div", { class: "rp-txp-h" }, h("span", { class: "rp-tn" }, NUMS[sel] || String(sel + 1)), h("b", {}, `${lab.get(t.from) ?? t.from} → ${lab.get(t.to) ?? t.to}`), t.label ? h("span", { class: "rp-tl" }, ` · ${t.label}`) : null, t.cite ? citeChip(card, t.cite.ref, t.cite.ok) : inferenceBadge()),
    txView(t.tx) ?? h("p", { class: "rp-td" }, T("No transaction read for this transition.", "這個轉換沒有讀到交易。")));
}
/** what talks to what: Studio's layout of the tutor's components and connections; the kind sets the shape, the change is
 *  marked on the node itself in the room's colours (changed, new, removed, outside), a connection opens what shows it */
const ARCH_SHAPE = { store: "cyl", queue: "cyl", actor: "pill", external: "rect", service: "rect" };
const MARK = { new: ["new", "新增"], changed: ["changed", "改動"], removed: ["removed", "移除"] };
const ARCH_CLS = { new: "ok", changed: "accent", removed: "seal" };
function archView(card, it) {
  const nodes = (it.nodes || []).map((n) => ({ id: n.id, label: n.label, shape: ARCH_SHAPE[n.kind] || "rect", cls: [n.mark ? ARCH_CLS[n.mark] : "", n.kind === "external" ? "muted" : "", `k-${n.kind}`].filter(Boolean).join(" ") }));
  const edges = (it.edges || []).map((e, i) => ({ from: e.from, to: e.to, label: e.label || "", n: i })), svg = curveSvg(nodes, edges, archPlace(nodes, edges, 15));
  for (const n of it.nodes || []) { const el = svg.querySelector(`[data-node="${CSS.escape(n.id)}"]`); if (!el) continue; el.classList.add(`rr-k-${n.kind}`);
    if (n.mark) { el.classList.add(`rr-m-${n.mark}`); el.setAttribute("data-mark", n.mark); const [x, y, w] = (el.getAttribute("data-box") || "0,0,0").split(",").map(Number);
      const tg = sv("text", { x: x + w - 8, y: y + 14, "text-anchor": "end", class: "rr-mark-t" }); tg.textContent = T(...MARK[n.mark]); el.append(tg); } }
  (it.edges || []).forEach((e, i) => { if (!e.cite?.ok) return; const el = svg.querySelector(`[data-elabel][data-edge-n="${i}"]`); if (!el) return; el.classList.add("rr-cite-label"); el.setAttribute("data-edge-cite", e.cite.ref); asControl(el, () => { if (!onBoard()) openCite(card, e.cite.ref); }); });
  const marks = [...new Set((it.nodes || []).map((n) => n.mark).filter(Boolean))];
  return h("div", { class: "rr-flow-wrap rr-arch", "data-arch": it.id }, svg,
    h("div", { class: "rp-legend" }, marks.map((m) => h("span", {}, h("i", { class: `sw ${ARCH_CLS[m]}` }), T(...MARK[m]))), (it.nodes || []).some((n) => n.kind === "external") ? h("span", {}, h("i", { class: "sw ctx" }), T("outside this change", "這個改動之外")) : null,
      h("span", { "data-arch-basis": it.inferred ? "inferred" : "shown" }, it.inferred ? T("Drawn from the code: Studio's layout of the tutor's reading (inferred)", "依程式碼畫出：導師的理解，由 Studio 排版（推論）") : T("As the cited document or record shows it", "依引用的文件或紀錄"))));
}
/** every call: its request and its response (and errors), the transaction it runs, the code it rests on */
function callsView(card, it) {
  const kv = (rows) => h("table", { class: "rp-kv" }, rows.map((x) => h("tr", {}, h("td", { class: "k" }, h("code", {}, x.k)), h("td", {}, h("code", {}, x.v)))));
  return h("div", { class: "rp-calls", "data-calls": it.id }, (it.calls || []).map((c, i) => h("section", { class: "rp-call", "data-call": i },
    h("header", {}, c.method ? h("span", { class: "rp-op" }, c.method) : null, h("code", { class: "rp-call-name" }, c.name), c.cite ? citeChip(card, c.cite.ref, c.cite.ok) : inferenceBadge()),
    h("div", { class: "rp-call-cols" }, h("div", { "data-call-part": "request" }, h("h5", {}, T("Request", "Request")), kv(c.request)),
      h("div", { "data-call-part": "response" }, h("h5", {}, T("Response", "Response")), kv(c.response), (c.errors || []).length ? h("ul", { class: "rp-errs" }, c.errors.map((x) => h("li", {}, h("code", {}, x.code), ` ${x.when}`))) : null),
      h("div", { "data-call-part": "transaction" }, h("h5", {}, T("Transaction", "交易")), txView(c.tx) || h("p", { class: "faint" }, T("Writes nothing", "不寫入任何東西")))))));
}
/** a figure the tutor drew (workflows/skills/diagram-design), as Studio took it: its tree rebuilt element by element with
 *  createElementNS, setAttribute and textContent (no markup), each text in the room's language, its ids kept to this figure */
const FIG_EL = new Set(["svg", "g", "rect", "path", "line", "polyline", "polygon", "circle", "ellipse", "text", "tspan", "marker", "defs", "title", "desc"]);
const FIG_OK = /^(id|role|aria-label|aria-labelledby|data-node|data-edge|data-cite|data-en|data-hant|data-hans|data-kind|fill|stroke|stroke-width|stroke-dasharray|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|font-size|font-weight|font-family|font-style|text-anchor|dominant-baseline|letter-spacing|marker-start|marker-mid|marker-end|x|y|dx|dy|width|height|rx|ry|cx|cy|r|x1|y1|x2|y2|points|d|transform|viewBox|markerWidth|markerHeight|refX|refY|orient|markerUnits)$/;
function figTree(n, lang, pre) {
  if (!n || !FIG_EL.has(n.t)) return null; const el = document.createElementNS(SVGNS, n.t);
  for (const [k, v0] of Object.entries(n.a || {})) { if (!FIG_OK.test(k)) continue; let v = String(v0);
    if (/^(fill|stroke)$/.test(k) && !/^(none|transparent|var\(--fig-[a-z0-9-]+\))$/.test(v)) continue;
    if (/^marker-/.test(k)) { const m = /^url\(#([\w-]+)\)$/.exec(v); if (!m) continue; v = `url(#${pre}-${m[1]})`; }
    if (k === "id") v = `${pre}-${v}`; if (k === "aria-labelledby") v = v.split(/\s+/).map((x) => `${pre}-${x}`).join(" ");
    el.setAttribute(k, v); }
  const leaf = !(n.c || []).some((c) => typeof c !== "string"), say = (n.t === "text" || n.t === "tspan") && leaf ? (LANG_BASE(lang) === "en" ? n.a?.["data-en"] : lang === "zh-CN" ? n.a?.["data-hans"] : n.a?.["data-hant"]) : null;
  if (say) el.textContent = say;
  else for (const c of n.c || []) { if (typeof c === "string") el.append(document.createTextNode(c)); else { const ch = figTree(c, lang, pre); if (ch) el.append(ch); } }
  return el;
}
function svgFigureView(card, it) {
  const r = RR.rooms.get(card), lang = r ? roomLang(r) : uiLang(), svg = figTree(it.tree, lang, `f${it.id}`);
  if (svg) { svg.classList.add("rr-figsvg-svg"); svg.removeAttribute("width"); svg.removeAttribute("height"); const vb = (svg.getAttribute("viewBox") || "").split(/[ ,]+/).map(Number); if (vb[2]) svg.style.maxWidth = `${Math.round(vb[2] * 1.2)}px`; }
  const key = `${card}/${it.id}`, sel = RR.tsel.get(key) ?? 0, tr = it.transitions || [];
  const pick = (i, t, quiet) => { RR.tsel.set(key, i); if (t?.cite?.ok && !quiet && !onBoard()) openCite(card, t.cite.ref); else rerender(); };
  if (svg) { for (const el of svg.querySelectorAll("[data-edge]")) { const e = el.getAttribute("data-edge"), k = tr.findIndex((t) => t.edge === e), cite = el.getAttribute("data-cite");
      if (k >= 0) { el.classList.add("rr-pickable"); if (k === sel) el.classList.add("on"); asControl(el, () => pick(k, tr[k])); } else if (cite) { el.classList.add("rr-pickable"); asControl(el, () => { if (!onBoard()) openCite(card, cite); }); } }
    for (const el of svg.querySelectorAll("[data-node]")) { const id = el.getAttribute("data-node"), k = tr.findIndex((t) => t.to === id && t.from !== id); if (k >= 0) { el.classList.add("rr-pickable"); asControl(el, () => pick(k, tr[k], true)); } } }
  const lab = new Map(); return h("div", { class: `rr-figsvg rr-figsvg-${it.kind}`, "data-svg-figure": it.id, "data-figure-kind": it.kind }, it.entity ? h("p", { class: "rp-entity" }, T("Entity", "實體"), ": ", h("code", {}, it.entity)) : null, svg,
    tr.length ? transitionRows(card, { ...it, transitions: tr }, sel, pick, lab) : null);
}
/** one decision: the question, the option taken and why; the options turned down (only as the record shows them) set apart */
function decisionFigure(it, seen) {
  const anim = seen && !seen.has("dec") && !reduceMotion(); if (seen) seen.add("dec");
  const rej = it.rejected || [], W = 660, qy = 18, qh = 64, y1 = 128, H = Math.max(y1 + 116, y1 + rej.length * 76) + 16;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "rr-itemfig rr-decfig", role: "img", "data-decision": it.id, preserveAspectRatio: "xMidYMid meet", "aria-label": `${it.question} → ${it.chosen}`, style: `max-width:${W * 1.5}px;max-height:${H * 1.5}px` });
  const box = (x, y, w, h, cls, lines, dl) => { const g = sv("g", { class: `rr-ib ${cls}` }), p = sv("path", { d: boxPath(x, y, w, h, 10), pathLength: 1 }); if (anim) { p.classList.add("rr-pen"); p.style.setProperty("--dl", `${dl}s`); } g.append(p);
    lines.forEach(([l, sub], i) => { const t = sv("text", { x: x + w / 2, y: y + h / 2 + (i - (lines.length - 1) / 2) * 20 + 6, "text-anchor": "middle", class: sub ? "rr-ib-sub" : "rr-ib-main" }); t.textContent = l; g.append(t); }); return g; };
  const link = (x1, y1_, x2, y2, cls) => sv("path", { d: `M${x1},${y1_} C${x1},${(y1_ + y2) / 2} ${x2},${(y1_ + y2) / 2} ${x2},${y2}`, class: `rr-dlink ${cls}`, fill: "none" });
  svg.append(box(20, qy, W - 40, qh, "q", wrapLabel(it.question, W - 80, 16, 2).map((l) => [l]), 0));
  svg.append(link(W / 4, qy + qh, 175, y1, "taken"), box(20, y1, 310, 116, "fix", [...wrapLabel(`✓ ${it.chosen}`, 280, 16, 2).map((l) => [l]), ...wrapLabel(it.because, 280, 13, 2).map((l) => [l, true])], 0.3));
  rej.forEach((x, i) => { const y = y1 + i * 76; svg.append(link(W * 3 / 4, qy + qh, 495, y, "not"), box(350, y, 290, 64, "old gone", [[`✗ ${clip(x.option, 34)}`], [clip(x.why, 44), true]], 0.5 + i * 0.15)); });
  if (!rej.length) { const t = sv("text", { x: 495, y: y1 + 58, "text-anchor": "middle", class: "rr-ib-sub" }); t.textContent = T("no alternative on record", "紀錄裡沒有其他選項"); svg.append(t); }
  return svg;
}
/** a decision with its turned-down options listed under the drawing, each with the record that shows it */
function decisionView(card, it) {
  return h("div", { class: "rr-flow-wrap rr-dec" }, decisionFigure(it, drawnOf(card, it)), (it.rejected || []).length ? h("ul", { class: "rp-rej", "data-rejected": it.id }, it.rejected.map((x, i) => h("li", { "data-rejected-option": i },
    h("span", {}, `✗ ${x.option}`), h("span", { class: "faint" }, ` · ${x.why} `), x.cite ? citeChip(card, x.cite.ref, x.cite.ok) : inferenceBadge()))) : null);
}
/** a figure's words as the tutor gave them, in a fixed order (src/domain/review-room.ts figureTexts): what a translation replaces */
function figWords(it) { const own = (() => { switch (it?.type) {
  case "arch": return [...(it.nodes || []).map((n) => n.label), ...(it.edges || []).map((e) => e.label || "")];
  case "item": return [it.name, it.before, it.after, it.mechanism || ""];
  case "decision": return [it.question, it.chosen, it.because, ...(it.rejected || []).flatMap((x) => [x.option, x.why])];
  case "states": return it.states?.length ? [...it.states.map((x) => x.label), ...(it.transitions || []).flatMap((t) => [t.label || "", t.detail || ""])] : null;
  case "sequence": return (it.steps || []).flatMap((x) => [x.label, x.frameLabel || ""]);
  default: return null; } })();
  // what was added later goes after the words an older translation holds (src/domain/review-room.ts figureTexts)
  const extra = [...(it?.type === "states" || it?.type === "svg" ? (it.transitions || []).filter((t) => t?.why).map((t) => t.why) : []), ...(it?.explain || []).flatMap((e) => [e.does || "", e.why || ""])];
  return own ? [it.title || "", ...own, ...extra] : extra.length ? [it.title || "", ...extra] : []; }
function withWords(it, w) { let i = 0; const n = () => String(w[i++] ?? ""), c = JSON.parse(JSON.stringify(it)); c.title = n();
  if (c.type === "arch") { c.nodes.forEach((x) => (x.label = n())); c.edges.forEach((x) => (x.label = n())); }
  else if (c.type === "item") { c.name = n(); c.before = n(); c.after = n(); c.mechanism = n(); }
  else if (c.type === "decision") { c.question = n(); c.chosen = n(); c.because = n(); (c.rejected || []).forEach((x) => { x.option = n(); x.why = n(); }); }
  else if (c.type === "states") { c.states.forEach((x) => (x.label = n())); (c.transitions || []).forEach((t) => { t.label = n(); t.detail = n(); }); }
  else if (c.type === "sequence") c.steps.forEach((x) => { x.label = n(); x.frameLabel = n(); });
  if (c.type === "states" || c.type === "svg") (c.transitions || []).forEach((t) => { if (t.why) t.why = n(); });
  (c.explain || []).forEach((e) => { e.does = n(); const w = n(); if (e.why) e.why = w; });
  return c; }
/** a figure in the room's language: as drawn when its turn was in it (zh-CN through OpenCC), else the words kept for it */
function figIn(r, it) {
  const w = figWords(it), t = r && (r.turns || []).find((x) => x.n === it?.turn); if (!w.length || !t || t.studio) return it;
  const lang = roomLang(r);
  if (LANG_BASE(t.lang || "en") === LANG_BASE(lang)) return lang === "zh-CN" && t.lang !== "zh-CN" ? withWords(it, w.map((x) => toLang(x, t.lang, lang))) : it;
  const tw = r.translations?.[LANG_BASE(lang)]?.[String(it.turn)]?.figures?.[it.id];
  return tw && tw.length === w.length ? withWords(it, tw.map((x) => toLang(x, LANG_BASE(lang), lang))) : it;
}
/** one request in order: lifelines, calls (solid), returns (dashed), async (open head), and the loops, alternatives and
 *  options as frames around their steps */
function sequenceView(it, seen) {
  const anim = seen && !seen.has("seq") && !reduceMotion(); if (seen) seen.add("seq");
  // one event a band; a frame (or an alternative inside it) gets a band of its own for its tab, so no tab sits on a message
  const n = it.actors.length, GX = 150, X0 = 90, RH = 40, top = 70, W = X0 * 2 + GX * (n - 1);
  const opens = it.steps.map((st, i) => !!st.frame && (i === 0 || it.steps[i - 1].frame !== st.frame) && !(st.frame === "else" && it.steps[i - 1]?.frame === "else"));
  const YS = []; { let extra = 0; it.steps.forEach((_, i) => { if (opens[i]) extra += 20; YS.push(top + i * RH + extra); }); }
  const yOf = (i) => (i < YS.length ? YS[i] : YS[YS.length - 1] + RH), H = (YS.length ? YS[YS.length - 1] + RH : top) + 40;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "rr-seq", role: "img", "data-sequence": it.id, preserveAspectRatio: "xMidYMid meet", style: `max-width:${W * 1.5}px;max-height:${H * 1.5}px` });
  const x = (a) => X0 + it.actors.indexOf(a) * GX;
  // frames first, behind: consecutive steps that share a frame
  for (let i = 0; i < it.steps.length;) { const f = it.steps[i].frame; if (!f) { i++; continue; } let j = i; while (j + 1 < it.steps.length && (it.steps[j + 1].frame === f || (f === "alt" && it.steps[j + 1].frame === "else"))) j++;
    const y0 = yOf(i) - 30, y1 = yOf(j) + RH - 14, fr = sv("g", { class: "rr-frame", "data-frame": f }); fr.append(sv("rect", { x: 12, y: y0, width: W - 24, height: y1 - y0, rx: 6 }));
    const t = sv("text", { x: 20, y: y0 + 14, class: "rr-frame-l" }); t.textContent = `${f}${it.steps[i].frameLabel ? ` [${it.steps[i].frameLabel}]` : ""}`; fr.append(t);
    for (let k = i + 1; k <= j; k++) if (it.steps[k].frame === "else" && it.steps[k - 1].frame !== "else") { const ye = yOf(k) - 30; fr.append(sv("line", { x1: 12, y1: ye, x2: W - 12, y2: ye, class: "rr-frame-else" })); const te = sv("text", { x: 20, y: ye + 12, class: "rr-frame-l" }); te.textContent = `else${it.steps[k].frameLabel ? ` [${it.steps[k].frameLabel}]` : ""}`; fr.append(te); }
    svg.append(fr); i = j + 1; }
  it.actors.forEach((a) => { const g = sv("g", { class: "rr-actor" }); g.append(sv("rect", { x: x(a) - 62, y: 14, width: 124, height: 34, rx: 8 }), sv("line", { x1: x(a), y1: 48, x2: x(a), y2: H - 14, class: "rr-lifeline" }));
    const t = sv("text", { x: x(a), y: 36, "text-anchor": "middle", class: "rr-actor-l" }); t.textContent = clip(a, 16); g.append(t); svg.append(g); });
  it.steps.forEach((st, i) => { const y = yOf(i) + 10, x1 = x(st.from), x2 = x(st.to), self = x1 === x2, g = sv("g", { class: `rr-step ${st.kind}${st.frame ? ` in-${st.frame}` : ""}`, "data-step": i + 1 });
    const d = self ? `M${x1},${y - 8} h36 v16 h-36` : `M${x1},${y} L${x2},${y}`, dir = x2 >= x1 ? 1 : -1, ex = self ? x1 : x2;
    const line = sv("path", { d, pathLength: 1, class: "rr-step-line" }), head = sv("path", { d: self ? `M${ex + 10},${y + 2} L${ex},${y + 8} L${ex + 10},${y + 14}` : `M${ex - 10 * dir},${y - 6} L${ex},${y} L${ex - 10 * dir},${y + 6}${st.kind === "async" ? "" : " Z"}`, class: "rr-step-head" });
    if (anim) { line.classList.add("rr-pen"); line.style.setProperty("--dl", `${(i * 0.18).toFixed(2)}s`); }
    const t = sv("text", { x: self ? x1 + 44 : (x1 + x2) / 2, y: y - 7, "text-anchor": self ? "start" : "middle", class: "rr-step-l" }); t.textContent = `${i + 1}. ${clip(st.label, 34)}`;
    g.append(line, head, t, sv("path", { d, class: "rr-edge-hit", "data-edge-hit": `step:${i + 1}` })); svg.append(g); });
  return svg;
}
/** Studio's own picture when an answer drew none: the scene's title and the files it cites, as sticky notes (text nodes only) */
function keycardView(it, seen) {
  const anim = seen && !seen.has("card") && !reduceMotion(); if (seen) seen.add("card");
  const files = (it.files || []).slice(0, 4), W = 640, H = 150 + Math.ceil(files.length / 2) * 112;
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, class: "rr-keycard", role: "img", preserveAspectRatio: "xMidYMid meet", "aria-label": it.title || "", style: `max-width:${W * 1.5}px;max-height:${H * 1.5}px` });
  const title = sv("text", { x: 24, y: 64, class: `rr-hand rr-key-title${anim ? " rr-write" : ""}` }); title.textContent = clip(it.title || "", 34); svg.append(title);
  svg.insertBefore(sv("path", { class: `rr-key-line${anim ? " rr-grow" : ""}`, style: "--dl:.3s;--d:.45s", d: `M24,74 H${Math.min(W - 24, 24 + Math.max(120, (title.textContent.length || 1) * 17))}` }), title);
  files.forEach((f, i) => { const x = 24 + (i % 2) * 304, y = 112 + Math.floor(i / 2) * 112, g = sv("g", { class: `rr-sticky${anim ? " rr-fade" : ""}`, style: `--dl:${(0.5 + i * 0.18).toFixed(2)}s`, transform: `rotate(${i % 2 ? 1.5 : -1.5} ${x + 140} ${y + 44})` });
    g.append(sv("rect", { x, y, width: 280, height: 88, rx: 6 }));
    const name = String(f).split("/").pop(), dir = String(f).slice(0, Math.max(0, String(f).length - name.length - 1));
    const a = sv("text", { x: x + 16, y: y + 40, class: "rr-hand rr-sticky-name" }); a.textContent = clip(name, 26); g.append(a);
    if (dir) { const b = sv("text", { x: x + 16, y: y + 68, class: "rr-sticky-dir" }); b.textContent = clip(dir, 36); g.append(b); }
    svg.append(g); });
  return svg;
}
// ---------- the explanation's language (zh-TW ⇄ en, zh-CN as zh-TW through OpenCC): switched live, translated once ----------
const LANG_BASE = (l) => (l === "zh-CN" ? "zh-TW" : l);
/** the language the room explains in: the captain's pick, else the language of its latest answer, else the page's */
const roomLang = (r) => RR.lang.get(r.card.id) || [...(r.turns || [])].reverse().find((t) => !t.studio && t.lang)?.lang || uiLang();
let CUR = { lang: "en" };
/** Studio's own words in the room's language (not the page's): the welcome scene, its scene titles, its scenes' lines */
const TL = (en, zh) => window.crewI18n.pick(CUR.lang, en, zh);
const toLang = (text, from, to) => (to === "zh-CN" && from !== "zh-CN" ? window.crewI18n.toCN(text) : text);
/** a tutor turn's words in the room's language: its own, else the translation kept for it (null: none yet) */
function turnIn(r, t, lang) {
  const base = LANG_BASE(lang);
  if (LANG_BASE(t.lang || "en") === base) return { scenes: null, claims: null, answer: toLang(t.answer, t.lang, lang), conv: (x) => toLang(x, t.lang, lang), own: true };
  const tr = r.translations?.[base]?.[String(t.n)]; if (!tr) return null;
  return { scenes: tr.scenes, claims: tr.claims, answer: toLang(tr.answer, base, lang), conv: (x) => toLang(x, base, lang), own: false };
}
/** the turn as the room shows it in its language: its scenes' titles and points, its answer's blocks, replaced in order */
function localTurn(r, t, lang) {
  if (t.studio || t.status !== "done") return t;
  const w = turnIn(r, t, lang); if (!w) return { ...t, untranslated: true };
  if (w.own) return lang === t.lang ? t : { ...t, answer: w.answer, scenes: t.scenes?.map((sc) => ({ ...sc, title: w.conv(sc.title), points: sc.points.map((p) => ({ ...p, text: w.conv(p.text), ...(p.detail ? { detail: w.conv(p.detail) } : {}) })) })), claims: t.claims?.map((c) => ["claim", "aside", "heading"].includes(c.kind) ? { ...c, text: w.conv(c.text) } : c) };
  let i = 0;
  return { ...t, answer: w.answer, scenes: t.scenes?.map((sc, m) => ({ ...sc, title: w.conv(w.scenes[m]?.title ?? sc.title), points: sc.points.map((p, j) => ({ ...p, text: w.conv(w.scenes[m]?.points[j] ?? p.text), ...(p.detail ? { detail: w.conv(w.scenes[m]?.details?.[j] || p.detail) } : {}) })) })),
    claims: t.claims?.map((c) => ["claim", "aside", "heading"].includes(c.kind) ? { ...c, text: w.conv(w.claims[i++] ?? c.text) } : c) };
}
/** Studio's own scene lines in the room's language (a reviewer's words, the quote, stay as written) */
const studioClaim = (c, lang) => (LANG_BASE(lang) === "zh-TW" && c.zh ? { ...c, text: toLang(c.zh, "zh-TW", lang) } : c);
const missingIn = (r, lang) => (r.turns || []).filter((t) => t.status === "done" && !t.studio && !turnIn(r, t, lang)).map((t) => t.n);
/** switch the room's language: at once when every answer is in it; otherwise a translation turn, confirmed once per room */
async function switchLang(r, lang) {
  const card = r.card.id; RR.lang.set(card, lang); stopPlay();
  const missing = missingIn(r, lang);
  if (!missing.length || !r.open || r.snapshot) { rerender(); return; }
  if (!r.translate?.confirmed && !RR.trConfirm.has(card)) { RR.confirm.set(card, { action: "translate", lang }); rerender(); return; }
  await startTranslate(r, lang);
}
async function startTranslate(r, lang, hash, confirmed) {
  const card = r.card.id; RR.posting.add(card); RR.err.delete(card); rerender();
  try { const room = await postJ(`/api/review-room/${enc(card)}/translate`, { lang: LANG_BASE(lang), confirm: hash }); RR.rooms.set(card, room); RR.confirm.delete(card); RR.trConfirm.add(card); }
  catch (e) { if (e.code === "confirm_required" && e.offer?.translate && confirmed && !hash) { RR.posting.delete(card); return startTranslate(r, lang, e.offer.translate.hash, false); } if (e.code === "confirm_required" && e.offer?.translate) { RR.rooms.set(card, { ...r, offer: { ...(r.offer || {}), ...e.offer } }); RR.confirm.set(card, { action: "translate", lang }); } else RR.err.set(card, e.message); }
  finally { RR.posting.delete(card); redraw(card); schedule(); }
}
function langToggle(r) {
  const cur = roomLang(r), opts = [["en", "EN"], ["zh-TW", "繁"], ["zh-CN", "简"]];
  return h("div", { class: "rr-langs", role: "group", "data-room-lang": cur, "aria-label": T("The explanation's language", "解說的語言") }, opts.map(([l, label]) => {
    const missing = missingIn(r, l).length, some = (r.turns || []).some((t) => t.status === "done" && !t.studio && turnIn(r, t, l));
    // a room that takes no turn shows only what it has: a language with at least one answer in it (the rest as written)
    const can = !missing || (r.open && !r.snapshot && !r.offer?.error) || ((r.snapshot || !r.open) && some);
    return h("button", { type: "button", class: "rr-lang", "data-lang-pick": l, "aria-pressed": String(cur === l), disabled: !can || r.running != null, title: missing ? (can ? T("Not translated yet: a small paid round", "還沒翻譯：一次小的付費回合") : T("Not in this language", "沒有這個語言的版本")) : "", onclick: () => switchLang(r, l) }, label); }));
}
// ---------- the scenes: each answer is one or more, a picture beside the tutor's points, played point by point ----------
const ACTION_LABEL = { ask: ["Question", "提問"], how: ["How", "怎麼運作"], why: ["Why", "為什麼"], teach: ["Teach me", "教我"], "merge-check": ["Before merging", "合併前檢查"], quiz: ["Check me", "考考我"], reviews: ["Digest reviews", "整理審查意見"], since: ["What changed since last time", "上次之後改了什麼"], reviewers: ["What reviewers asked", "審查者問了什麼"] };
/** text cut to n characters at a word, with an ellipsis (one long word is cut where it must) */
const clip = (s, n) => { s = String(s || "").trim(); if (s.length <= n) return s; const cut = s.slice(0, n), at = cut.lastIndexOf(" "); return `${(at > n / 3 ? cut.slice(0, at) : cut.slice(0, n - 1)).replace(/[\s,.;:–—-]+$/, "")}…`; };
const plain = (s) => String(s || "").replace(CITE, "").replace(/\*\*|`/g, "").replace(/^\s*([-*+]|\d+\.)\s+/, "").replace(/\s+/g, " ").trim();
// what Studio itself names a picture or a scene, in the captain's language (the model's own titles stay as written)
const STUDIO_TITLES = { "This change at a glance": "一眼看懂這個改動", "What changed since you last looked": "你上次看過之後改了什麼", "The app, before and after": "這個 app 改動前後", "Chart": "圖表", "Illustration": "插圖" };
const itemTitle = (it) => (STUDIO_TITLES[it?.title] ? T(it.title, STUDIO_TITLES[it.title]) : it?.title || "");
/** a lesson's chapters, in order (src/domain/review-room.ts CHAPTERS) */
const CHAPTER = { calls: ["Every call: request, response, transaction", "每個呼叫：request、response、交易"], what: ["What this is", "這是什麼"], talks: ["What talks to what", "誰跟誰說話"], decisions: ["The decisions", "做了哪些決定"], roads: ["Roads not taken", "沒走的路"], change: ["The change itself", "改了什麼"], lifecycle: ["Its life, state by state", "狀態的一生"], sequence: ["One request, in order", "一次請求的順序"], reviewers: ["What reviewers raised", "審查者提了什麼"], watch: ["What to watch", "要注意的地方"], questions: ["Open questions", "待解問題"] };
/** a directory's lesson names some chapters its own way (src/domain/review-room.ts DIR_CHAPTERS) */
const DIR_CHAPTER = { what: ["What this directory is", "這個目錄是什麼"], modules: ["Its parts, one by one", "它的組成，一個一個看"], talks: ["How the parts compose", "各部分怎麼組在一起"], sequence: ["How data flows through it", "資料怎麼流過它"], entry: ["Where to start reading", "從哪裡開始讀"] };
const chapterName = (id) => (CUR.kind === "dir" && DIR_CHAPTER[id] ? TL(...DIR_CHAPTER[id]) : CHAPTER[id] ? TL(...CHAPTER[id]) : "");
/** the chapters' order (src/domain/review-room.ts CHAPTERS): a lesson is shown in it */
const CHAPTER_ORDER = ["what", "talks", "decisions", "change", "lifecycle", "sequence", "calls", "reviewers", "roads", "watch", "questions"];
/** a directory's lesson's order (src/domain/review-room.ts DIR_CHAPTERS): what it is, its parts, how they compose and flow, where to start */
const DIR_CHAPTER_ORDER = ["what", "modules", "talks", "sequence", "entry", "lifecycle", "watch", "questions"];
const TYPE_LABEL = { svg: ["drawn by the tutor, checked by Studio", "導師畫的圖，Studio 檢查過"], calls: ["every call", "每個呼叫"], arch: ["what talks to what", "架構"], decision: ["a decision", "決定"], item: ["the change, before → after", "改動前後"], states: ["state machine", "狀態機"], sequence: ["sequence", "順序圖"], mermaid: ["diagram", "流程圖"], diff: ["diff", "diff"], code: ["code at the head", "head 的程式碼"], compare: ["before / after", "前後對照"], note: ["note", "筆記"], table: ["table", "表格"], snippet: ["the tutor's code", "導師寫的程式碼"], keycard: ["key card", "重點卡"] };
const typeLabel = (t) => T(...(TYPE_LABEL[t] || [t, t]));
// ---------- lengths: a point on the board is a sentence (two short ones at most), a CJK character weighing two Latin ones ----------
const CJK_RE = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/g;
const boardLen = (s) => { const t = plain(s), c = (t.match(CJK_RE) || []).length; return c * 2 + ([...t].length - c); };
const POINT_LEN = 120;
/** an older answer's paragraph as points of at most one or two sentences: a citation stays with the sentence it follows */
function sentences(text) {
  const raw = String(text || "").replace(/^\s*([-*+]|\d+\.)\s+/, "").replace(/\s*\n\s*/g, " ").split(/(?<=[。！？；])|(?<=[.!?;])\s+(?=[^\s[])/).map((x) => x.trim()).filter(Boolean), out = [];
  for (const p of raw) { const m = /^((?:\[[a-z]+:[^\]\s]+\]\s*)+)(.*)$/i.exec(p); if (m && out.length) { out[out.length - 1] += ` ${m[1].trim()}`; if (m[2].trim()) out.push(m[2].trim()); } else out.push(p); }
  const packed = []; for (const s of out) { const last = packed.at(-1); if (last != null && boardLen(`${last} ${s}`) <= POINT_LEN) packed[packed.length - 1] = `${last} ${s}`; else packed.push(s); }
  return packed;
}
const isTable = (t) => { const ls = String(t || "").split("\n").filter((l) => l.trim()); return ls.length >= 2 && ls.every((l) => /^\s*\|/.test(l)); };
const tableRows = (t) => String(t || "").split("\n").filter((l) => l.trim() && !/^\s*\|?\s*:?-{2,}/.test(l)).slice(0, 9).map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").slice(0, 5).map((c) => clip(plain(c), 60)));
/** an older answer (no scenes of its own) as points: sentences, its tables and code as pictures shown with the point after them */
function legacyPoints(key, claims) {
  const out = [], extra = []; let pend = null;
  claims.forEach((c, i) => {
    if (c.kind === "heading") return;
    if (c.kind === "table" || isTable(c.text)) { pend = { id: `${key}-table${i + 1}`, synth: true, type: "table", title: T("A table from the answer", "回答裡的表格"), rows: tableRows(c.text), basis: null, cites: c.cites || [] }; extra.push(pend); return; }
    if (c.kind === "code") { pend = { id: `${key}-code${i + 1}`, synth: true, type: "snippet", title: T("Code the tutor wrote (not from the commit)", "導師寫的程式碼（不是 commit 裡的）"), text: c.text.replace(/^\s*```[^\n]*\n?|\n?\s*```\s*$/g, ""), basis: null, cites: [] }; extra.push(pend); return; }
    const parts = c.quote || c.basis === "reviewer" ? [c.text] : sentences(c.text);
    parts.forEach((t, j) => { out.push({ ...c, text: t, cites: parts.length === 1 ? c.cites : (c.cites || []).filter((x) => t.includes(`[${x.ref}]`)), ...(j === 0 && pend ? { visual: pend } : {}) }); if (j === 0) pend = null; });
  });
  if (pend && out.length) out.at(-1).visual ||= pend;
  return { points: out, extra };
}
/** what the room is about, in a few words: the pull request's number, the branch, or the merge card's pull request */
const subjectName = (r) => { const k = r.subject?.kind || "merge";
  if (k === "dir") { const d = r.dir || {}, where = `${d.repository || r.subject?.repository || ""}${d.path ? `/${d.path}` : ""}`; return { en: `the directory ${where}`, zh: `${where} 這個目錄` }; }
  return k === "pr" ? { en: `pull request #${r.subject?.number ?? ""}`, zh: `#${r.subject?.number ?? ""} 這一個 PR` }
    : k === "branch" ? { en: `branch ${r.card.title?.en?.replace(/^Branch\s+/, "") || r.card.id}`, zh: `${r.card.title?.en?.replace(/^Branch\s+/, "") || r.card.id} 這一個 branch` }
    : r.pr?.id ? { en: `pull request #${r.pr.id}`, zh: `#${r.pr.id} 這一個 PR` } : { en: "this change", zh: "這一個改動" }; };
/** The welcome scene, made by Studio for free: what the room is about, its files' line counts (git's), three points, and
 *  "Teach me this change" (a paid turn, confirmed like any other). The opening illustration, when there is one, is a picture
 *  of this scene too. */
function welcomeScene(r, opening) {
  if (r.subject?.kind === "dir") return dirWelcome(r, opening);
  const ds = r.diffstat, name = subjectName(r), files = ds?.files || [], top = [...files].sort((a, b) => (b.added + b.removed) - (a.added + a.removed))[0];
  const chart = files.length ? { id: "t0-files", synth: true, turn: 0, type: "chart", kind: "chart", mode: "diffstat", from: ds.from === "github" ? "numbers" : "git", title: TL("What changed, by file", "改了哪些檔案"), unit: "lines", rows: [...files].sort((a, b) => (b.added + b.removed) - (a.added + a.removed)).slice(0, 8).map((f) => ({ label: f.path, added: f.added, removed: f.removed })), basis: "cited", cites: [] } : null;
  const ps = r.prState, verdict = ps?.verdicts?.find((v) => v.state === "CHANGES_REQUESTED") || ps?.verdicts?.find((v) => v.state === "APPROVED");
  const studio = (en, zh, cites = []) => ({ text: TL(en, zh) + cites.map((c) => ` [${c.ref}]`).join(""), kind: "claim", basis: "studio", cites });
  const points = [
    ds ? studio(`This change touches ${ds.total.files} file${ds.total.files === 1 ? "" : "s"}, +${ds.total.added} −${ds.total.removed} lines${top ? `; the most in ${top.path}` : ""}.`, `這個改動動了 ${ds.total.files} 個檔案、+${ds.total.added} −${ds.total.removed} 行${top ? `；最多在 ${top.path}` : ""}。`, top ? [{ ref: `diff:${top.path}`, ok: true }] : [])
      : studio("Studio has not counted this change's lines yet.", "Studio 還沒算出這個改動的行數。"),
    ps ? (verdict ? studio(`${verdict.author} ${verdict.state === "APPROVED" ? "approved it" : "asked for changes"}${verdict.current ? "" : " (at an older head)"}; their words are a scene of their own.`, `${verdict.author} ${verdict.state === "APPROVED" ? "核准了" : "要求修改"}${verdict.current ? "" : "（在較舊的 head）"}；審查者的原話另有一個場景。`) : studio("No reviewer has given a verdict on GitHub yet.", "GitHub 上還沒有審查者給出結論。"))
      : r.subject?.kind === "branch" ? studio("Studio's own review passed at this head; nothing here goes to GitHub.", "Studio 自己的審查在這個 head 通過了；這裡的東西不會送到 GitHub。")
      : studio("Studio's checks ran at this head; the merge card waits for your answer, the room never gives it.", "Studio 的檢查在這個 head 跑過了；合併卡等你回覆，審查室不會替你回。"),
    studio("Press “Teach me” to start; every point names its basis, a click opens it.", "按「教我這個 PR」開始；每一點都附依據，點了就打開。")];
  return { key: "t0", turn: 0, welcome: true, studio: true, title: TL(`This room is only about ${name.en}`, `這間審查室只講 ${name.zh}`), question: null, visuals: [chart, ...opening].filter(Boolean), points, questions: [] };
}
/** a directory room's welcome (Studio's, free): its parts by how many files each holds, where it is pinned, how to start */
function dirWelcome(r, opening) {
  const d = r.dir || { parts: [] }, name = subjectName(r), parts = d.parts || [], top = parts[0];
  const chart = parts.length ? { id: "t0-parts", synth: true, turn: 0, type: "chart", kind: "chart", mode: "values", from: "numbers", title: TL("Its parts, by files", "它的組成（依檔案數）"), unit: TL("files", "個檔案"), rows: parts.slice(0, 10).map((x) => ({ label: `${x.name}${x.kind === "dir" ? "/" : ""}`, value: x.files })), basis: null, cites: [] } : null;
  const studio = (en, zh) => ({ text: TL(en, zh), kind: "claim", basis: "studio", cites: [] });
  const points = [studio(`It holds ${d.files ?? 0} file${d.files === 1 ? "" : "s"} in ${parts.length} part${parts.length === 1 ? "" : "s"}${top ? `; the most in ${top.name}${top.kind === "dir" ? "/" : ""} (${top.files})` : ""}.`, `它有 ${d.files ?? 0} 個檔案、${parts.length} 個部分${top ? `；最多在 ${top.name}${top.kind === "dir" ? "/" : ""}（${top.files} 個）` : ""}。`),
    studio(`Read at ${d.refKind === "commit" ? "commit" : d.refKind === "tag" ? "tag" : "branch"} ${d.ref || ""}, pinned at ${String(d.sha || "").slice(0, 8)}: every citation opens that commit on GitHub, so it never moves.`, `讀的是 ${d.ref || ""}，固定在 ${String(d.sha || "").slice(0, 8)}：每個引用都打開 GitHub 上的那個 commit，不會變。`),
    studio("Press “Teach me” for what each part does and how they compose; every point names its basis.", "按「教我這個目錄」看每個部分做什麼、怎麼組在一起；每一點都附依據。")];
  return { key: "t0", turn: 0, welcome: true, studio: true, title: TL(`This room is only about ${name.en}`, `這間審查室只講 ${name.zh}`), question: null, visuals: [chart, ...opening].filter(Boolean), points, questions: [] };
}
/** the room's scenes: the welcome scene (turn 0, with the opening picture), then each turn's: the scenes the tutor showed (scene_show), else its answer
 *  as points; Studio's own scenes (what changed, what reviewers asked) as they are */
function scenesOf(r) {
  const out = [], opening = r.board.filter((b) => b.turn === 0), lang = roomLang(r); CUR = { lang, kind: r.subject?.kind || "merge" };
  out.push(welcomeScene(r, opening));
  const rootOf = (t) => t.regenOf ?? t.n, versions = new Map();
  for (const t of r.turns) if (!t.studio) { const k = rootOf(t); if (!versions.has(k)) versions.set(k, []); versions.get(k).push(t); }
  const shownOf = (root) => { const vs = versions.get(root) || [], pick = RR.ver.get(`${r.card.id}/${root}`); return vs.find((t) => t.n === pick) || vs.at(-1); };
  for (const t0 of r.turns) {
    // a question asked on a lesson's chapter is answered in its card there, never a scene of its own
    if (t0.hidden || t0.thread) continue;
    if (!t0.studio && shownOf(rootOf(t0)) !== t0) continue;
    const t = { ...localTurn(r, t0, lang), versions: t0.studio ? null : versions.get(rootOf(t0)) };
    const asked = r.check.questions.filter((q) => q.turn === t.n), questions = asked.filter((q) => !q.options), quiz = asked.filter((q) => q.options), turnBoard = r.board.filter((b) => b.turn === t.n);
    const claims = t.status === "done" ? (t.claims?.length ? t.claims : [{ text: t.answer, kind: "claim", basis: "inference", cites: [] }]).map((c) => (t.studio ? studioClaim(c, lang) : c)) : [];
    // a scene Studio made itself (no model): what changed since the captain last looked, what GitHub reviewers asked
    if (t.studio) { const [en, zh] = ACTION_LABEL[t.action] || [t.action, t.action]; out.push({ key: `t${t.n}`, turn: t.n, t, studio: true, title: TL(en, zh), question: null, visuals: turnBoard, points: claims, questions: [] }); continue; }
    // the tutor's own scenes: each its picture and its few points; the answer itself is in the transcript
    if ((t.status === "done" || t.status === "running") && t.scenes?.length) {
      const ORDER = r.subject?.kind === "dir" ? DIR_CHAPTER_ORDER : CHAPTER_ORDER, used = new Set(t.scenes.map((s) => s.picture)), rank = (s) => (ORDER.includes(s.chapter) ? ORDER.indexOf(s.chapter) : -1);
      const ordered = t.action === "teach" ? t.scenes.map((s, m) => [s, m]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]) : t.scenes.map((s, m) => [s, m]);
      ordered.forEach(([s, m], o) => { const pic = r.board.find((b) => b.id === s.picture), last = o === t.scenes.length - 1;
        out.push({ key: m ? `t${t.n}-${m + 1}` : `t${t.n}`, turn: t.n, t, chapter: s.chapter || null, skip: !!s.skip, pic: pic || null, title: s.title, question: m ? null : t.text, visuals: [pic, ...(last ? turnBoard.filter((b) => !used.has(b.id) && !b.group) : [])].filter(Boolean), points: s.points, questions: last ? questions : [] }); });
    } else {
    const heading = claims.find((c) => c.kind === "heading"), { points, extra } = legacyPoints(`t${t.n}`, claims);
    // the scene's title: the answer's heading, else the question itself (shown once, never as "Question: …" beside itself)
    out.push({ key: `t${t.n}`, turn: t.n, t, title: heading ? plain(heading.text.replace(/^\s*#+\s*/, "")) : clip(plain(t.text), 48), question: heading ? t.text : null,
      visuals: [...turnBoard, ...extra], points, questions });
    }
    // a multiple-choice check is a scene of its own: one question a page, the options on the board
    if (quiz.length) out.push({ key: `t${t.n}-quiz`, turn: t.n, t, quiz: true, title: quiz[0].q, question: null, visuals: [], questions: [], points: quiz.map((q) => ({ kind: "quiz", text: q.q, q, cites: q.cites || [], basis: null })) });
  }
  return out;
}
/** the scene the room is on: the one picked, else the latest (a lesson's first chapter, which is read from the top) */
const sceneState = (card, scenes) => { let i = RR.scene.get(card);
  if (i == null || i >= scenes.length) { i = scenes.length - 1; const last = scenes[i]; if (last?.chapter && last.t?.action === "teach") i = scenes.findIndex((x) => x.turn === last.turn); }
  return Math.max(0, i); };
const revealOf = (card, sc) => Math.min(sc.points.length, RR.reveal.get(`${card}/${sc.key}`) ?? sc.points.length);
/** the visual a scene shows after k points: the last board item a shown point cites, else the scene's first */
function visualAt(r, sc, k) {
  let v = sc.visuals[0] || null;
  for (const p of sc.points.slice(0, k)) { if (p.visual) v = p.visual; for (const c of p.cites || []) if (c.ref.startsWith("board:")) { const b = r.board.find((x) => x.id === c.ref.slice(6)); if (b) v = b; }
    // a step names the picture it shows (scene_show's picture on a point)
    if (p.picture) { const b = r.board.find((x) => x.id === p.picture); if (b) v = b; } }
  return v;
}
// ---------- a card is numbered steps beside an illustration (docs/units/review-room.md, "Steps and illustrations") ----------
/** code is never drawn in the illustration: it is cited, a link away (GitHub for a pull request on GitHub, else the citation panel) */
const CODEISH = new Set(["code", "diff", "compare", "snippet"]);
const isCode = (it) => !!it && CODEISH.has(it.type);
/** the step a card is on: the point being read while it plays or is stepped through, else the step the captain picked (null: the whole card) */
const stepOf = (card, sc, k) => (k < sc.points.length ? (k > 0 ? k - 1 : null) : RR.step.get(`${card}/${sc.key}`) ?? null);
/** pick a step: the points up to it shown (as the play bar's dots do), its picture zoomed to what it is about */
function pickStep(card, sc, m) { markMoved(card); stopPlay(); RR.pick.delete(`${card}/${sc.key}`); RR.explain.delete(card); RR.reveal.set(`${card}/${sc.key}`, m + 1); RR.step.set(`${card}/${sc.key}`, m); rerender(); }
const stepBtn = (card, sc, m, cur) => h("button", { type: "button", class: `rr-stepn${cur === m ? " on" : ""}`, "data-step-pick": m + 1, "aria-pressed": String(cur === m), "aria-label": T(`Show step ${m + 1}`, `看第 ${m + 1} 步`), onclick: (e) => { e.stopPropagation(); pickStep(card, sc, m); } }, String(m + 1));
/** the focus keys of a step, with an edge's two ends: what the illustration zooms to */
const focusOf = (p) => (Array.isArray(p?.focus) ? p.focus.filter((f) => typeof f === "string" && f).slice(0, 8) : []);
/** a step's detail, under the illustration */
const stepDetail = (sc, cur) => { const d = cur != null ? sc.points[cur]?.detail : null; return d ? h("p", { class: "rr-stepdetail", "data-step-detail": cur + 1 }, h("b", {}, T(`Step ${cur + 1}`, `第 ${cur + 1} 步`)), " ", plain(d)) : null; };
/** the code a card rests on, as links: a pull request on GitHub opens there at those lines, anything else in the citation panel */
function codeRefs(card, r, items) {
  if (!items.length) return null;
  return h("div", { class: "rr-coderefs", "data-code-refs": items.length }, h("span", { class: "rr-coderefs-k" }, T("Code this rests on", "依據的程式碼")),
    items.map((it) => { const ref = it.path && it.type !== "snippet" ? `diff:${it.path}${it.start ? `:L${it.start}-${it.end || it.start}` : ""}` : null, gh = ref ? githubDiffUrl(r, ref) : null;
      return h("button", { type: "button", class: "rr-cite rr-coderef", "data-code-ref": ref || `board:${it.id}`, "data-code-link": gh ? "github" : "panel", title: gh ? T("Open these lines on GitHub, in a new window", "在新視窗開啟 GitHub 上的這幾行") : T("Open the code", "打開程式碼"),
        onclick: (e) => { e.stopPropagation(); if (gh) { window.open(gh, "_blank", "noopener,noreferrer"); return; } RR.cite.set(card, { ref: `board:${it.id}`, data: { kind: "board", item: it } }); rerender(); } },
        `${it.path || itemTitle(it) || typeLabel(it.type)}${it.start ? `:${it.start}-${it.end}` : ""}${gh ? " ↗" : ""}`); })); }
/** zoom every illustration with a focus to it: the padded box of its focused parts (an edge with its two ends), the rest dimmed */
function zoomFocus() {
  for (const fig of document.querySelectorAll("[data-zoom-focus]")) {
    const want = fig.getAttribute("data-zoom-focus") || "", svg = fig.querySelector("svg.rr-flow, svg.rr-seq, svg.rr-figsvg-svg") || fig.querySelector("svg"); if (!svg || !want || svg.dataset.zoomed === want) continue;
    const keys = want.split(",").filter(Boolean), q = (s) => [...svg.querySelectorAll(s)], all = new Set();
    for (const k of keys) { const step = /^step:(\d+)$/.exec(k);
      const els = step ? q(`[data-step="${step[1]}"]`) : k.includes(">") ? [...q(`[data-edge="${CSS.escape(k)}"]`), ...q(`[data-elabel="${CSS.escape(k)}"]`), ...k.split(">").flatMap((id) => q(`[data-node="${CSS.escape(id)}"]`))] : q(`[data-node="${CSS.escape(k)}"]`);
      els.forEach((el) => all.add(el)); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of all) { try { const b = el.getBBox(); if (!b.width && !b.height) continue; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); } catch {} }
    if (!isFinite(x0)) continue;
    // at most about half again as near: the rest of the picture stays in sight around what the step is about
    const vb = (svg.getAttribute("viewBox") || "").split(/[ ,]+/).map(Number), pad = 28, w = Math.max(x1 - x0 + pad * 2, 200, (vb[2] || 0) * 0.7), hh = Math.max(y1 - y0 + pad * 2, 120, (vb[3] || 0) * 0.7), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (vb.length === 4 && w >= vb[2] * 0.92 && hh >= vb[3] * 0.92) { svg.dataset.zoomed = want; } // it is the whole picture already
    else svg.setAttribute("viewBox", `${(cx - w / 2).toFixed(1)} ${(cy - hh / 2).toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)}`);
    svg.dataset.zoomed = want; svg.classList.add("rr-zoomed"); for (const el of all) el.classList.add("rr-focus"); }
}
/** what a connector's step does and why (the tutor's explain, a transition's detail and why), and the words the drawing gives it */
function explainFor(it, key, label) {
  const ex = (it?.explain || []).find((e) => e.edge === key) || null, tr = (it?.transitions || []).find((t) => (t.edge || `${t.from}>${t.to}`) === key) || null;
  const lab = label || tr?.label || (it?.type === "arch" ? (it.edges || []).find((e) => `${e.from}>${e.to}` === key)?.label : null) || (/^step:\d+$/.test(key) ? it?.steps?.[Number(key.slice(5)) - 1]?.label : null) || "";
  return { key, label: lab, does: ex?.does || null, why: ex?.why || tr?.why || null, detail: tr?.detail || null, cites: [...(ex?.cites || []), ...(tr?.cite ? [tr.cite] : [])] };
}
/** the explanation of one connector: what this step does, why it is built this way; with nothing recorded, what the drawing has */
function explainBox(card, it, key, label) {
  const x = explainFor(it, key, label), name = /^step:(\d+)$/.test(key) ? T(`Step ${key.slice(5)}`, `第 ${key.slice(5)} 步`) : key.replace(">", " → ");
  return h("div", { class: "rr-explain-body", "data-explain-edge": key },
    h("p", { class: "rr-explain-h" }, h("b", {}, name), x.label ? h("span", { class: "faint" }, ` · ${x.label}`) : null),
    x.does ? h("p", { "data-explain-does": "" }, h("span", { class: "rr-explain-k" }, T("What this step does", "這一步做什麼")), " ", x.does) : null,
    x.why ? h("p", { "data-explain-why": "" }, h("span", { class: "rr-explain-k" }, T("Why this way", "為什麼這樣設計")), " ", x.why) : null,
    x.detail ? h("p", { "data-explain-detail": "" }, h("span", { class: "rr-explain-k" }, T("What it writes", "它寫入什麼")), " ", x.detail) : null,
    !x.does && !x.why ? h("p", { class: "faint", "data-explain-none": "" }, T("No explanation was recorded for this step: ask about it.", "這一步沒有記錄說明：可以問。")) : null,
    x.cites.length ? h("div", { class: "rr-basis" }, x.cites.map((c) => citeChip(card, c.ref, c.ok))) : null);
}
/** a connector clicked on an answer's illustration: its explanation over the picture; "Ask about this" only fills the question (free) */
function explainPop(card, r, sc, it) {
  const ex = RR.explain.get(card); if (!ex || ex.scene !== sc.key || ex.item !== it?.id) return null;
  const close = () => { RR.explain.delete(card); rerender(); };
  return h("div", { class: "rr-explain", role: "dialog", "aria-label": T("Why this step", "這一步的說明"), "data-explain": ex.key, onclick: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation() },
    h("button", { type: "button", class: "rr-explain-x", "aria-label": T("Close", "關閉"), onclick: close }, "×"),
    explainBox(card, it, ex.key, ex.label),
    r.open && !r.snapshot ? h("button", { type: "button", class: "rb-btn", "data-explain-ask": "", title: T("Fills the question below; nothing is sent until you ask", "填進下方的問題；你按送出之前什麼都不會送出"),
      onclick: () => { const name = /^step:/.test(ex.key) ? T(`step ${ex.key.slice(5)}`, `第 ${ex.key.slice(5)} 步`) : ex.key.replace(">", " → "); RR.draft.set(card, T(`Why does ${name}${ex.label ? ` (${ex.label})` : ""} work this way?`, `${name}${ex.label ? `（${ex.label}）` : ""} 為什麼這樣做？`)); RR.explain.delete(card); rerender();
        requestAnimationFrame(() => document.querySelector(`[data-room-text="${CSS.escape(card)}"]`)?.focus()); } }, T("Ask about this", "問這一步")) : null);
}
/** a click on an answer's illustration: a connector (its line, its label, a sequence's step, a drawn figure's edge) opens its explanation */
function edgeClick(card, sc, it) {
  return (e) => { if (BOARD.state.moved) return; const t = e.target.closest?.("[data-edge-hit], [data-elabel], svg [data-edge], [data-step]"); if (!t || !it) return;
    const key = t.getAttribute("data-edge-hit") || t.getAttribute("data-elabel") || t.getAttribute("data-edge") || `step:${t.getAttribute("data-step")}`;
    const n = t.getAttribute("data-edge-n"), tr = it.type === "states" && n != null ? (it.transitions || [])[Number(n)] : null;
    const label = (t.closest("svg")?.querySelector(`[data-elabel="${CSS.escape(key)}"]`)?.textContent || "").replace(/^[①-⑳]\s*/, "").trim();
    e.stopPropagation(); RR.explain.set(card, { scene: sc.key, item: it.id, key: tr ? `${tr.from}>${tr.to}` : key, label: tr?.label || label }); rerender(); };
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
/** show a board item: its scene (the board flies there), that picture */
function showItem(r, id) {
  const card = r.card.id, scenes = scenesOf(r), i = scenes.findIndex((s) => s.visuals.some((b) => b.id === id)); RR.cite.delete(card);
  if (i >= 0) { stopPlay(); RR.scene.set(card, i); RR.pick.set(`${card}/${scenes[i].key}`, id); }
  rerender();
}
// ---------- narration: captions always; a voice of this Mac by default (on-device, free), off only when the captain says so ----------
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
const localVoices = () => { try { const want = (CUR.lang || uiLang()).toLowerCase(), l = want.slice(0, 2), exact = (v) => (v.lang || "").toLowerCase().replace("_", "-") === want ? 1 : 0;
  const mine = (window.speechSynthesis?.getVoices?.() || []).filter((v) => v.localService && v.lang?.toLowerCase().startsWith(l) && !NOVELTY.test(baseName(v)));
  // Taiwan Mandarin has no Premium voice; the captain picked Eddy (Chinese (Taiwan)) to sit beside Mei-Jia, so it is not left out there
  const twEddy = (v) => l === "zh" && /^eddy$/i.test(baseName(v)) && /tw/i.test(v.lang || "");
  const good = mine.filter((v) => !LEGACY.test(baseName(v)) || twEddy(v));
  const rank = (v) => (twEddy(v) ? -1 : voiceRank(v)); // Eddy sits beside Mei-Jia, never ahead of it, however compact Mei-Jia is
  return (good.length ? good : mine).sort((a, b) => rank(b) - rank(a) || exact(b) - exact(a)); } catch { return []; } };
// this Mac's local neural voice (Kokoro, src/voice): offered when Studio says its engine is ready; a room in the Library
// (lib:…) has no folder to keep clips in. Picked, it speaks each point from a clip Studio makes once and keeps in the room.
const KV = { stat: null, asked: 0, clips: new Map() };
/** ask Studio again (fresh: it looks at the model again): when the picker opens and when the page comes back into focus,
 *  so a model installed or removed in Doctor shows in the room without a reload */
const kokoroRefresh = (fresh = true) => { if (Date.now() - KV.asked < 1500) return; KV.asked = Date.now();
  api(`/api/voice/status${fresh ? "?fresh=1" : ""}`).then((s) => { const was = JSON.stringify(KV.stat); KV.stat = s; if (JSON.stringify(s) !== was) rerender(); }).catch(() => {}); };
const kokoroStat = () => { if (!KV.stat && Date.now() - KV.asked > 30000) kokoroRefresh(false); return KV.stat; };
addEventListener("focus", () => { if (S.route?.name === "room") kokoroRefresh(); });
addEventListener("hashchange", () => { if (S.route?.name === "room") kokoroRefresh(); });
const kokoroReady = (card) => !!kokoroStat()?.ready && /^(SC-\d+|R-\d+|PR-[0-9a-f]{12}-\d+|DIR-[0-9a-f]{12}-[0-9a-f]{12})$/.test(String(card || S.route?.arg || ""));
const kokoroVoice = () => (LANG_BASE(CUR.lang) === "en" ? kokoroStat()?.voices?.en : kokoroStat()?.voices?.zh) || "";
/** mixed Chinese and English: "switch" speaks Latin runs with the English voice (the default), "same" keeps one voice */
const voiceMix = () => (prefs.get("crew.room.voice.mix") === "same" ? "same" : "switch");
const rawVoicePref = () => prefs.get("crew.room.voice") || "auto";
/** the voice in effect: Kokoro only while it is ready (else this Mac's best voice speaks instead of silence) */
const voicePref = () => { const p = rawVoicePref(); return p === "kokoro" && !kokoroReady() ? "auto" : p; };
/** the Mac voice to speak with: the one picked, or, when that one is no longer offered (a robotic voice picked before), the best there is */
const chosenLocal = () => { const p = voicePref(); if (p !== "auto" && !p.startsWith("local:")) return null; const vs = localVoices(); return (p === "auto" ? null : vs.find((v) => v.voiceURI === p.slice(6))) || vs[0] || null; };
/** speak a point; when the browser refuses (no click yet, a voice gone) the caller's reading-pace timer takes over (fail) */
function speak(text, done, fail, best = false) {
  const v = best ? localVoices()[0] : chosenLocal(); if (!v) return false;
  try { const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.onend = done; u.onerror = () => fail(); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); return true; } catch { return false; }
}
// a browser lists its voices late: the picker and the default voice follow when they arrive
try { window.speechSynthesis?.addEventListener?.("voiceschanged", () => { if (S.route?.name === "room") rerender(); }); } catch {}
function stopPlay() { RR.explain.clear(); clearTimeout(RR.timer); RR.timer = null; RR.playing = null; try { window.speechSynthesis?.cancel(); } catch {} try { RR.audio?.pause(); } catch {} RR.audio = null; try { KV.clip?.pause(); } catch {} KV.clip = null; KV.gen = (KV.gen || 0) + 1; dropPendingClips(); }
/** a point's clip in the local voice: asked for once per text, voice language and mix (the next point's is asked for while
 *  one plays). A request playback no longer needs (paused, left, another mix) is cancelled, so Studio stops making it. */
function kokoroClip(card, text) {
  const lang = LANG_BASE(CUR.lang), mix = voiceMix(), key = `${card}|${lang}|${mix}|${text}`;
  if (!KV.clips.has(key)) {
    const ac = new AbortController(), entry = { ac, settled: false };
    entry.job = fetch(`/api/review-room/${enc(card)}/voice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, lang, mix }), signal: ac.signal })
      .then(async (res) => { let j = {}; try { j = await res.json(); } catch {} if (!res.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { code: j.code }); return j.src; })
      .finally(() => { entry.settled = true; });
    entry.job.catch(() => { if (KV.clips.get(key) === entry) KV.clips.delete(key); });
    KV.clips.set(key, entry); if (KV.clips.size > 300) KV.clips.delete(KV.clips.keys().next().value);
  }
  return KV.clips.get(key).job;
}
/** a clip whose address no longer plays (its file was dropped: the room started over, the clips' bounds): asked for again */
const forgetClip = (card, text) => KV.clips.delete(`${card}|${LANG_BASE(CUR.lang)}|${voiceMix()}|${text}`);
function dropPendingClips(card) { for (const [key, e] of [...KV.clips]) if (!e.settled && (!card || key.startsWith(`${card}|`))) { e.ac.abort(); KV.clips.delete(key); } }
/** speak point k with the local voice; the caption is the point's text, shown as it starts. A clip that fails: this Mac's voice, else reading pace */
async function sayKokoro(card, sc, k, text, next, paced, again = false) {
  const after = sc.points[k + 1], gen = KV.gen;
  let src; try { src = await kokoroClip(card, text); } catch (e) { if (RR.playing !== card || KV.gen !== gen) return; if (e.code !== "not_a_point") RR.err.set(card, T(`The local voice could not speak: ${e.message}`, `本機語音無法朗讀：${e.message}`)); return void (speak(text, next, paced, true) || paced()); }
  if (RR.playing !== card || KV.gen !== gen || !onRoom(card)) return;
  if (after && !after.q) kokoroClip(card, plain(after.text)).catch(() => {});
  const a = new Audio(src); KV.clip = a;
  a.onended = () => { if (KV.clip === a) { KV.clip = null; next(); } };
  const mac = () => speak(text, next, paced, true) || paced();
  // the clip is gone (the room started over, the bounds dropped it): ask for it once more, then this Mac's voice
  a.onerror = () => { if (KV.clip !== a) return; KV.clip = null; forgetClip(card, text); if (!again) sayKokoro(card, sc, k, text, next, paced, true); else mac(); };
  try { await a.play(); } catch { if (KV.clip === a) { KV.clip = null; mac(); } }
}
/** show one more point of the current scene; while playing, the next one follows when its caption has been read (or spoken) */
function advance(card) {
  if (!onRoom(card)) return stopPlay();
  const r = RR.rooms.get(card); if (!r) return; const scenes = scenesOf(r), sc = scenes[sceneState(card, scenes)]; if (!sc) return;
  const k = revealOf(card, sc); if (k >= sc.points.length || sc.quiz) { stopPlay(); rerender(); return; }
  RR.pick.delete(`${card}/${sc.key}`); RR.step.delete(`${card}/${sc.key}`); RR.reveal.set(`${card}/${sc.key}`, k + 1); rerender();
  if (RR.playing !== card || RR.audio) return;
  const text = plain(sc.points[k].text), next = () => { if (RR.playing === card) RR.timer = setTimeout(() => advance(card), 400); };
  const paced = () => { if (RR.playing === card) RR.timer = setTimeout(() => advance(card), Math.max(2600, [...text].length * 170)); };
  // Studio's own welcome scene is not a tutor's point: this Mac's voice reads it
  if (voicePref() === "kokoro") return void (sc.welcome ? speak(text, next, paced, true) || paced() : sayKokoro(card, sc, k, text, next, paced));
  if (speak(text, next, paced)) return;
  paced();
}
/** the vendor's voice for a whole scene: the points appear as the audio reaches them (by their share of the text) */
async function playVendor(card, sc) {
  try { const out = await postJ(`/api/review-room/${enc(card)}/speech`, { scene: sc.key.replace(/-\d+$|-quiz$/, ""), lang: LANG_BASE(CUR.lang) }); if (RR.playing !== card) return;
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
  markMoved(card);
  const { scenes, i, sc } = curScene(card); if (!sc) return; stopPlay();
  const k = revealOf(card, sc), n = sc.points.length;
  RR.pick.delete(`${card}/${sc.key}`); RR.step.delete(`${card}/${sc.key}`);
  if (dir > 0) { if (k < n) RR.reveal.set(`${card}/${sc.key}`, k + 1); else if (i < scenes.length - 1) { RR.scene.set(card, i + 1); RR.reveal.set(`${card}/${scenes[i + 1].key}`, Math.min(1, scenes[i + 1].points.length)); } }
  else if (k > 1) RR.reveal.set(`${card}/${sc.key}`, k - 1);
  else if (i > 0) { RR.scene.set(card, i - 1); RR.reveal.set(`${card}/${scenes[i - 1].key}`, scenes[i - 1].points.length); }
  rerender();
}
/** the captain looked elsewhere while a turn ran: its answer, when ready, waits behind a chip instead of pulling the board away */
const markMoved = (card) => { if (RR.rooms.get(card)?.running != null) RR.moved.add(card); };
const goScene = (card, n) => { markMoved(card); const { scenes } = curScene(card); if (!scenes?.length) return; stopPlay(); RR.scene.set(card, Math.max(0, Math.min(scenes.length - 1, n))); rerender(); };
function voicePicker(r) {
  const vs = localVoices(), vendor = r.offer?.voice, pref = voicePref(), alt = pref.startsWith("local:") ? chosenLocal() : null, cur = alt ? `local:${alt.voiceURI}` : pref;
  const kokoro = kokoroReady(r.card.id) ? [["kokoro", T(`Kokoro local neural voice (${kokoroVoice()})`, `Kokoro 本機神經語音（${kokoroVoice()}）`)]] : [];
  const mix = pref === "kokoro" ? h("label", { class: "rr-voice" }, h("span", { class: "sr" }, T("Mixed Chinese and English", "中英混合")), h("select", { class: "input", "data-voice-mix": "", "aria-label": T("Mixed Chinese and English", "中英混合"),
    onchange: (e) => { prefs.set("crew.room.voice.mix", e.target.value === "switch" ? null : e.target.value); stopPlay(); rerender(); } },
    [["switch", T("English words in an English voice", "英文詞換英文聲音")], ["same", T("One voice for everything", "全部同一個聲音")]].map(([v, l]) => h("option", { value: v, selected: v === voiceMix() }, l)))) : null;
  const opts = [...(vs.length ? [["auto", T(`This Mac's best voice (${vs[0].name})`, `這台 Mac 最好的聲音（${vs[0].name}）`)]] : []), ...kokoro, ["off", T("Voice off (captions only)", "語音關（只有字幕）")], ...(vendor ? [["vendor", T(`${vendor.vendor} neural voice (${vendor.model}; paid, only to the tutor's own vendor)`, `${vendor.vendor} 神經語音（${vendor.model}；付費，只送到導師本身的供應商）`)]] : []), ...vs.map((v) => [`local:${v.voiceURI}`, T(`This Mac: ${v.name}`, `這台 Mac：${v.name}`)])];
  const pick = h("label", { class: "rr-voice" }, h("span", { class: "sr" }, T("Voice", "語音")), h("select", { class: "input", "data-voice": "", "aria-label": T("Voice", "語音"), onfocus: () => kokoroRefresh(), onmousedown: () => kokoroRefresh(),
    onchange: (e) => { prefs.set("crew.room.voice", e.target.value === "auto" ? null : e.target.value); stopPlay(); rerender(); } }, opts.map(([v, l]) => h("option", { value: v, selected: v === cur || (v === "off" && !opts.some(([x]) => x === cur)) }, l))));
  return mix ? h("span", { class: "rr-voices" }, pick, mix) : pick;
}
// ---------- the check on the board: multiple choice, graded by Studio (no model) the moment the captain picks ----------
const LETTERS = "ABCD";
async function pickOption(card, q, i, at) {
  const key = `${card}/q${q.n}`; if (RR.posting.has(key)) return; if (at) RR.reveal.set(at[0], at[1]);
  // one answer per question: the lock is set before anything else (a second click while it is sent does nothing); the verdict stays in view
  RR.posting.add(key); RR.err.delete(card); rerender();
  try { const out = await postJ(`/api/review-room/${enc(card)}/check-answer`, { n: q.n, choice: i }); RR.rooms.set(card, out.room); }
  catch (e) { RR.err.set(card, e.message); } finally { RR.posting.delete(key); redraw(card); }
}
/** a check mark drawn by the pen (a path; the motion only on the first showing) */
const checkMark = (ok, fresh) => sv("svg", { viewBox: "0 0 24 24", class: `rr-mk ${ok ? "ok" : "miss"}${fresh ? " rr-pen" : ""}`, "aria-hidden": "true" }, sv("path", { d: ok ? "M5 12.5l4.5 4.5L19 7" : "M7 7l10 10M17 7L7 17", pathLength: 1 }));
function quizView(card, r, q, at) {
  const markKey = `${card}/mk${q.n}`, fresh = !!q.result && !RR.titled.has(markKey) && !reduceMotion(); if (q.result) RR.titled.add(markKey);
  const answered = !!q.result, open = r.open && !r.offer?.error, busy = RR.posting.has(`${card}/q${q.n}`);
  return h("div", { class: "rr-quiz", "data-scene-check": "", "data-quiz": q.n, "data-check-result": answered ? (q.result.correct ? "correct" : "missed") : "open" },
    h("p", { class: "rr-quiz-q rr-hand" }, q.q),
    h("div", { class: "rr-opts", role: "group", "aria-label": T("Options", "選項") }, q.options.map((o, i) => {
      const right = answered && i === q.answer, wrong = answered && i === q.choice && !right;
      return h("button", { type: "button", class: `rr-opt${right ? " right" : wrong ? " wrong" : ""}`, "data-quiz-option": `${q.n}:${i}`, "aria-pressed": String(q.choice === i), disabled: answered || busy || !open, onclick: () => pickOption(card, q, i, at) },
        h("span", { class: "rr-optk" }, LETTERS[i]), h("span", { class: "rr-optt" }, o), right || wrong ? checkMark(right, fresh) : h("span"));
    })),
    answered ? h("div", { class: `rr-verdict ${q.result.correct ? "ok" : "miss"}`, role: "status", "data-quiz-verdict": q.result.correct ? "correct" : "missed" },
      h("b", {}, q.result.correct ? T("Right. ", "答對了。") : T("Not quite. ", "沒答對，再看一次：")), q.why || "", " ", (q.cites || []).map((c) => citeChip(card, c.ref, c.ok))) : null,
    answered && !q.result.correct && open ? h("button", { type: "button", class: "rr-chip", "data-quiz-reteach": q.n, onclick: () => askTurn(card, "ask", T(`Re-explain question ${q.n} with the board: “${q.q}” I picked ${LETTERS[q.choice]} (${q.options[q.choice]}); the right one is ${LETTERS[q.answer]} (${q.options[q.answer]}).`, `用白板重講第 ${q.n} 題：「${q.q}」我選了 ${LETTERS[q.choice]}（${q.options[q.choice]}），正確是 ${LETTERS[q.answer]}（${q.options[q.answer]}）。`)) },
      T("Re-explain with the board (a paid round)", "用白板重講（付費一回合）")) : null);
}
function quizSide(r, sc) {
  const qs = sc.points.map((p) => p.q), done = qs.filter((q) => q.result), right = done.filter((q) => q.result.correct).length;
  return [h("p", { class: "rr-quiz-help" }, T("Pick one. Studio grades it at once (no model, nothing paid); a missed one can be re-explained on the board.", "選一個答案。Studio 立刻評分（不用模型、不付費）；答錯的可以在白板上重講。")),
    h("p", { class: "rr-ppage", "data-quiz-score": `${right}/${done.length}` }, T(`${right} of ${done.length} right · ${qs.length - done.length} to go`, `答對 ${right}/${done.length} · 還有 ${qs.length - done.length} 題`))];
}
/** Explain a turn again with another model: the models this machine can run (adaptive staffing's facts), the current one and
 *  the author's vendor marked; a held one is listed but cannot be picked. A pick is a paid turn, confirmed like any other. */
function regenList(r, t) {
  const card = r.card.id, lvl = { vendor: ["another vendor than the author", "和作者不同供應商"], model: ["same vendor as the author", "和作者同一個供應商"], same: ["same model as the author", "和作者同一個模型"] };
  const pick = async (m) => { RR.regen.delete(card); RR.posting.add(card); RR.err.delete(card); rerender();
    try { await postJ(`/api/review-room/${enc(card)}/turn`, { regenerate: t.n, pick: { provider: m.provider, model: m.model }, lang: uiLang() }); }
    catch (e) { if (e.code === "confirm_required" && e.offer) RR.confirm.set(card, { action: t.action, text: t.text, regenerate: t.n, pick: { provider: m.provider, model: m.model }, offer: e.offer }); else RR.err.set(card, e.message); }
    finally { RR.posting.delete(card); redraw(card); } };
  return h("div", { class: "rr-regenlist", role: "group", "data-regen-list": t.n, "aria-label": T("Models on this machine", "這台機器上的模型") },
    (r.tutors || []).map((m) => h("button", { type: "button", class: "rr-regenopt", "data-regen-pick": `${m.provider}|${m.model}`, disabled: !m.runnable || RR.posting.has(card), title: m.held || "", onclick: () => pick(m) },
      h("b", {}, `${m.provider} · ${m.model}`), m.current ? h("span", { class: "rr-pill ok" }, T("current", "目前")) : null,
      h("span", { class: `rr-pill${m.level === "vendor" ? "" : " warn"}`, "data-regen-level": m.level || "unknown" }, m.level ? T(...lvl[m.level]) : T("independence from the author unknown", "和作者的獨立程度未知")),
      m.held ? h("span", { class: "rr-pill bad", "data-regen-held": "" }, T(`held: ${m.held}`, `暫停：${m.held}`)) : null)));
}
// ---------- the tutor: the captain picks it (this room's, else Studio's default, else Automatic); independence is information ----------
const LEVEL = { vendor: ["another vendor than the author", "和作者不同供應商"], model: ["same vendor as the author", "和作者同一個供應商"], same: ["the author's own model", "和作者同一個模型"] };
const levelPill = (m) => h("span", { class: `rr-pill${m.level === "vendor" ? "" : " warn"}`, "data-tutor-level": m.level || "unknown" }, m.level ? T(...LEVEL[m.level]) : T("independence from the author unknown", "和作者的獨立程度未知"));
/** the header's tutor: who it is and how independent from the author (said, not enforced); a click opens the picker */
function tutorButton(r) {
  const id = r.card.id, o = r.offer, src = r.tutorChoice?.source || "auto", pick = r.tutorChoice?.room || (src === "studio" ? r.tutorChoice?.studio : null);
  const text = o?.error ? T(`Tutor: ${pick ? `${pick.provider} · ${pick.model}` : "none"} — cannot run now`, `導師：${pick ? `${pick.provider} · ${pick.model}` : "無"}：現在不能用`)
    : T(`Tutor: ${o?.provider} · ${o?.model ?? "default model"} — ${o?.independence?.en ?? ""}`, `導師：${o?.provider} · ${o?.model ?? "預設模型"}：${o?.independence?.zh ?? ""}`);
  return h("button", { type: "button", class: `rr-pill rr-tutor${o?.error ? " bad" : o?.independence?.level === "same" ? " warn" : ""}`, "data-tutor-open": id, "data-independence": o?.independence?.level ?? null, "data-tutor-source": src, "aria-expanded": String(RR.tutorMenu === id), "aria-haspopup": "dialog", title: o?.error || text,
    onclick: () => { const open = RR.tutorMenu !== id; RR.tutorMenu = open ? id : null; rerender();
      // the keyboard follows: into the picker when it opens, back to the tutor's button when it closes
      requestAnimationFrame(() => document.querySelector(open ? "[data-tutor-menu] [data-tutor-pick]:not([disabled])" : "[data-tutor-open]")?.focus({ preventScroll: true })); } }, text);
}
async function pickTutor(id, pick) {
  RR.posting.add(`${id}/tutor`); RR.err.delete(id); rerender();
  try { RR.rooms.set(id, await postJ(`/api/review-room/${enc(id)}/tutor`, { pick })); RR.tutorMenu = null; dropPasteOffers(); } catch (e) { RR.err.set(id, e.message); }
  finally { RR.posting.delete(`${id}/tutor`); redraw(id); if (!RR.tutorMenu) requestAnimationFrame(() => document.querySelector("[data-tutor-open]")?.focus({ preventScroll: true })); }
}
/** the picker: Studio's default (or Automatic), then every model this machine has; one that cannot run or is not verified is
 *  shown disabled with why (never swapped for another by itself); each says how independent it is from the change's author */
function tutorMenu(r) {
  const id = r.card.id, c = r.tutorChoice || {}, busy = RR.posting.has(`${id}/tutor`), cur = c.room;
  const dflt = c.studio ? T(`Studio's default: ${c.studio.provider} · ${c.studio.model}`, `Studio 預設：${c.studio.provider} · ${c.studio.model}`) : T("Automatic: Studio picks the most independent model it can run", "自動：Studio 挑它能跑、最獨立的模型");
  return h("div", { class: "rr-regenlist rr-tutormenu", role: "dialog", "aria-label": T("The tutor for this room", "這間審查室的導師"), "data-tutor-menu": id },
    h("b", {}, T("The tutor for this room", "這間審查室的導師")),
    h("p", { class: "faint" }, T("Every answer in this room, the analysis on arrival, questions and regenerations run on it. How independent it is from the author is shown, not enforced; one that cannot run is never swapped for another.", "這間房間的每個回答、進來時的分析、提問和重講都用它。和作者的獨立程度只是資訊，不會強制；不能用的導師不會被偷偷換掉。")),
    h("button", { type: "button", class: "rr-regenopt", "data-tutor-pick": "default", "aria-pressed": String(!cur), disabled: busy, onclick: () => pickTutor(id, null) }, h("b", {}, dflt), !cur ? h("span", { class: "rr-pill ok" }, T("current", "目前")) : null),
    (r.tutors || []).map((m) => h("button", { type: "button", class: "rr-regenopt", "data-tutor-pick": `${m.provider}|${m.model}`, "aria-pressed": String(!!cur && cur.provider === m.provider && cur.model === m.model), disabled: !m.runnable || busy, title: m.held || "", onclick: () => pickTutor(id, { provider: m.provider, model: m.model }) },
      h("b", {}, `${m.provider} · ${m.model}`), cur && cur.provider === m.provider && cur.model === m.model ? h("span", { class: "rr-pill ok" }, T("this room", "這間房間")) : null, levelPill(m),
      m.held ? h("span", { class: "rr-pill bad", "data-tutor-held": "" }, m.verified === false && m.runnable === false && /not verified/.test(m.held) ? T("not verified on this machine yet", "這台機器還沒驗證") : T(`cannot run: ${m.held}`, `不能用：${m.held}`)) : null)),
    (r.tutors || []).length ? null : h("p", { class: "faint", "data-tutor-none": "" }, T("Studio has no facts about this machine's models yet: the room uses its own pick.", "Studio 還沒有這台機器模型的資料：房間用自己的選擇。")));
}
// ---------- a finished lesson is the lesson board (public/review-board.js): its chapters are regions of a canvas ----------
const POINTS_TONE = { watch: ["risk", ["risk", "風險"]], reviewers: ["warn", ["reviewer", "審查"]], roads: ["ok", ["not taken", "沒走"]], questions: ["", ["open", "待解"]] };
/** a figure in the report: the drawing Studio lays out from the tutor's data, its title and what it rests on */
function reportFigure(card, r, it, box) {
  // a lesson's figure reads at its drawn size, left to right where it fits: its region's column
  BOX = box || (innerWidth <= 760 ? { narrow: true, w: innerWidth - 56, h: 1400 } : { w: Math.min(1180, innerWidth - 420), h: 640 });
  const v = figIn(r, it); let body; try { body = v.type === "arch" ? archView(card, v) : v.type === "decision" ? decisionView(card, v) : v.type === "item" ? itemFigure(v, drawnOf(card, v))
    : v.type === "states" ? statemapView(card, v) : v.type === "sequence" ? sequenceView(v, drawnOf(card, v)) : v.type === "svg" ? svgFigureView(card, v) : v.type === "calls" ? callsView(card, v) : itemView(card, v, null); } finally { BOX = null; }
  // never blown up: at most a little over the size it was laid out at
  for (const sg of [body, ...(body.querySelectorAll ? body.querySelectorAll("svg") : [])]) if (sg?.tagName === "svg" && sg.viewBox?.baseVal?.width) sg.style.maxWidth = `${Math.round(sg.viewBox.baseVal.width * 1.15)}px`;
  return h("figure", { class: `rp-fig rp-fig-${v.type}`, "data-report-figure": v.id, "data-figure-type": v.type }, h("div", { class: "rp-figbody" }, body),
    h("figcaption", {}, h("span", { class: "vbadge", "data-type": v.type }, typeLabel(v.type)), h("b", {}, itemTitle(v)), basisRow(card, v)));
}
/** a lesson auto-teach started (on arrival in the room, or on a paste): said so, with what it ran on, and the room's switch to
 *  stop it starting by itself next time */
function autoNote(r, t) {
  if (!t?.auto) return null; const card = r.card.id, arrival = t.autoFrom === "arrival";
  return h("p", { class: "rr-auto-note faint", "data-auto-started": t.n, "data-auto-from": arrival ? "arrival" : "paste" }, arrival ? T(`Started automatically when you opened the room: one paid round on ${t.provider} · ${t.model}.`, `打開審查室時自動開始：在 ${t.provider} · ${t.model} 上付費一回合。`)
    : T(`Started automatically on paste: one paid round on ${t.provider} · ${t.model}.`, `貼上後自動開始：在 ${t.provider} · ${t.model} 上付費一回合。`), " ",
    !r.snapshot ? h("label", {}, h("input", { type: "checkbox", "data-auto-off": "", checked: r.autoTeach?.on !== false, onchange: async (e) => { try { RR.rooms.set(card, await postJ(`/api/review-room/${enc(card)}/auto`, { on: e.target.checked })); dropPasteOffers(); } catch (er) { RR.err.set(card, er.message); } rerender(); } }),
      T(" start by itself next time (opening the room on a new head, or a paste)", " 下次（在新的 head 打開審查室或貼上時）自動開始")) : null);
}
// ---------- the board is the room's only view (public/review-board.js): every scene a region on its canvas ----------
/** what a scene is, in a few words: its chapter, Studio's welcome, a check, the action asked */
function sceneLabel(sc) {
  const [en, zh] = ACTION_LABEL[sc.t?.action] || ["", ""];
  return sc.welcome ? T("Welcome", "開場") : sc.quiz ? T("Check me", "考考我") : sc.chapter ? chapterName(sc.chapter) : sc.t ? T(en, zh) : "";
}
/** what a turn is and what it did, over its first scene: the answers to the same question (one per tutor), Regenerate with…,
 *  how it started (auto-teach), what it cost */
function sceneHead(r, sc) {
  const card = r.card.id, t = sc.t; if (!t || sc.studio || sc.quiz) return null;
  const vers = t.versions?.length > 1 ? h("span", { class: "rr-vers", role: "group", "data-versions": t.regenOf ?? t.n, "aria-label": T("Answers to this question", "這一題的回答") }, t.versions.map((x) => h("button", { type: "button", class: "rr-ver", "data-version-pick": x.n, "aria-pressed": String(x.n === t.n), title: x.status, onclick: () => { stopPlay(); RR.ver.set(`${card}/${t.regenOf ?? t.n}`, x.n); rerender(); } }, `${x.provider} ${x.model}`))) : null;
  const regen = t.status === "done" && r.open && !r.snapshot && (r.tutors || []).length ? h("button", { type: "button", class: "rr-mini rr-regen", "data-regen": t.n, "aria-expanded": String(RR.regen.get(card) === t.n), onclick: () => { RR.regen.get(card) === t.n ? RR.regen.delete(card) : RR.regen.set(card, t.n); rerender(); } }, T("Regenerate with…", "換一位導師重講")) : null;
  const cost = t.status === "done" && t.cost?.usd != null ? h("span", { class: "faint rr-cost" }, `$${Number(t.cost.usd).toFixed(2)} · ${t.provider} · ${t.model}`) : null, auto = autoNote(r, t);
  if (!vers && !regen && !cost && !auto) return null;
  return h("div", { class: "rb-shead", "data-scene-head": t.n }, vers || regen || cost ? h("div", { class: "rb-shead-row" }, vers, regen, cost) : null, RR.regen.get(card) === t.n ? regenList(r, t) : null, auto);
}
/** One scene on the board: its title (the kicker says what it is), its picture (the one the point being read cites; the
 *  others a chip away), its points (played: the ones not reached yet dimmed), and what the turn is doing: working (its tool
 *  calls and what it said so far), failed, a check graded on the spot, the welcome's lesson button. */
function sceneCard(r, scenes, j, W) {
  const card = r.card.id, sc = scenes[j], n = sc.points.length, k = sc.quiz ? n : revealOf(card, sc), picked = RR.pick.get(`${card}/${sc.key}`);
  const running = sc.t?.status === "running", narrow = innerWidth <= 760, first = scenes.find((x) => x.turn === sc.turn) === sc;
  // the step it is on (played, stepped through, or picked) sets the illustration: that step's picture, zoomed to its focus
  const cur = sc.quiz ? null : stepOf(card, sc, k), v0 = sc.quiz ? null : (picked && sc.visuals.find((b) => b.id === picked)) || visualAt(r, sc, cur != null ? cur + 1 : k) || (running ? null : fallbackVisual(r, sc));
  // code is never the illustration: Studio's own picture of the files instead, the code a link away
  const pics = sc.visuals.filter((b) => !isCode(b)), codes = sc.quiz ? [] : [...new Set([...sc.visuals.filter(isCode), ...(isCode(v0) ? [v0] : [])])];
  // the whole card shows its first picture that is not code; a step whose picture is code shows Studio's picture of the files
  const v = isCode(v0) ? (cur == null && pics[0]) || fallbackVisual(r, sc) : v0;
  const focus = cur != null && v === v0 ? focusOf(sc.points[cur]) : [];
  const prev = v?.group ? r.board.filter((b) => b.turn === v.turn && b.group === v.group && (b.step || 0) < (v.step || 0)).sort((a, b) => (a.step || 0) - (b.step || 0)).at(-1) : null;
  const [en, zh] = ACTION_LABEL[sc.t?.action] || ["", ""];
  const kicker = sc.chapter ? `${chapterName(sc.chapter)} · ${T(en, zh)}` : sc.t?.untranslated ? T("Not in this language yet: shown as written", "還沒有這個語言的版本：照原文顯示") : sc.welcome ? T("Welcome · made by Studio, free", "開場 · Studio 做的，免費") : sc.quiz ? T(`Check me · ${n} question${n === 1 ? "" : "s"}`, `考考我 · ${n} 題`) : sc.studio ? T(`${en} · made by Studio, free`, `${zh} · Studio 做的，免費`) : sc.t ? T(en, zh) : "";
  const titleKey = `${card}/${sc.key}`, firstTitle = !RR.titled.has(titleKey); RR.titled.add(titleKey);
  const entering = RR.lastK.get(titleKey) !== k; RR.lastK.set(titleKey, k);
  const pointView = (c, at) => { const now = k < n && at === k - 1, later = at >= k;
    if (c.kind === "code") return h("li", { class: `rr-point code${now ? " now" : ""}${later ? " later" : ""}`, "data-claim": "code" }, stepBtn(card, sc, at, cur), h("pre", { class: "rr-pre" }, c.text.replace(/^\s*```[^\n]*\n?|\n?\s*```\s*$/g, "")));
    return h("li", { class: `rr-point${c.basis === "inference" ? " inference" : ""}${now ? " now" : later ? " later" : " done"}${cur === at ? " picked" : ""}${now && entering && !reduceMotion() ? " rr-enter" : ""}`, "data-claim": c.basis || c.kind, "data-step": at + 1, "aria-current": now ? "true" : null },
      stepBtn(card, sc, at, cur), c.basis === "inference" ? inferenceBadge() : c.basis === "reviewer" ? reviewerBadge() : null, h("span", { class: "rr-ptext" }, inline(card, (c.basis === "inference" ? c.text.replace(/\s*\[(inference|inferred|speculative)\]/gi, "") : c.text).replace(/^\s*[-*+]\s+/, ""), c.cites)),
      // what someone else wrote (a reviewer, a commit message): their words as plain text, never parsed for citations or markup;
      // the gist (its first line, cut short) on the board, the whole text only when the captain opens it
      c.quote ? quoteView(c, `${card}/${sc.key}/${at}`) : null); };
  // the picture is laid out for the scene's column: the left of the card on a desktop, its whole width on a phone
  const box = narrow ? { narrow: true, w: W - 30, h: 1400 } : { w: Math.round(W * 0.56) - 30, h: 340 };
  let pic; BOX = box; try { pic = sc.quiz ? h("div", { class: "rr-quizzes" }, sc.points.map((p) => quizView(card, r, p.q, null))) : v ? itemView(card, v, prev) : h("div", { class: "rr-drawing faint", "data-visual-drawing": "" }, T("The tutor is drawing…", "導師正在畫…")); } finally { BOX = null; }
  const answers = (r.turns || []).some((t) => !t.studio && !t.hidden && !t.thread);
  if (focus.length) queueMicrotask(zoomFocus);
  return h("div", { class: `rp-card rb-scard${sc.quiz ? " quiz" : ""}`, "data-scene-card": sc.key },
    first ? sceneHead(r, sc) : null,
    h("div", { class: "rr-stitle" },
      h("span", { class: "rr-kicker" }, sc.studio && sc.t ? h("span", { "data-studio-scene": sc.t.action }, kicker) : kicker,
        sc.question ? h("span", { class: "rr-q", "data-scene-question": "", title: sc.question }, ` · ${clip(sc.question, 60)}`) : null),
      h("h2", { class: "rr-hand", "data-scene-title": "", title: sc.title }, h("span", { class: `rr-hl${firstTitle && !reduceMotion() ? " rr-anim" : ""}`, "aria-hidden": "true" }), sc.quiz ? T("Check me", "考考我") : sc.title)),
    h("div", { class: `rr-scene${sc.quiz ? "" : " rr-steps"}` },
      h("figure", { class: "rr-visual", "data-visual": sc.quiz ? "quiz" : v?.id || "", "data-illustration-of": sc.quiz ? null : cur != null ? cur + 1 : "all", "data-zoom-focus": focus.length ? focus.join(",") : null, onclick: sc.quiz ? null : edgeClick(card, sc, v) }, pic,
        sc.quiz ? null : stepDetail(sc, cur), sc.quiz ? null : explainPop(card, r, sc, v), sc.quiz ? null : codeRefs(card, r, codes),
        pics.length > 1 ? h("div", { class: "rr-vstrip", role: "group", "aria-label": T("Pictures in this scene", "這個場景的圖") }, pics.map((b) => h("button", { type: "button", class: `rr-vchip${b === v ? " on" : ""}`, "data-visual-pick": b.id, "aria-pressed": String(b === v), title: b.title, onclick: () => { const at = sc.points.findIndex((p) => (p.cites || []).some((c) => c.ref === `board:${b.id}`)); RR.pick.set(`${card}/${sc.key}`, b.id); if (at >= 0 && revealOf(card, sc) < sc.points.length) RR.reveal.set(`${card}/${sc.key}`, Math.max(k, at + 1)); rerender(); } }, b.kind ? T(KIND_LABEL[b.kind][0].split(" ·")[0], KIND_LABEL[b.kind][1].split(" ·")[0]) : typeLabel(b.type), ` ${clip(itemTitle(b), 24)}`))) : null),
      h("div", { class: "rr-points" },
        sc.t && sc.t.status !== "done" && r.progress?.turn === sc.t.n && first ? h("div", { class: "rr-progress faint", "data-turn-progress": sc.t.n }, T(`${r.progress.tools} tool call${r.progress.tools === 1 ? "" : "s"} so far`, `目前呼叫了 ${r.progress.tools} 次工具`), r.progress.said ? h("p", { class: "rr-progress-said" }, clip(plain(r.progress.said), 280)) : null) : null,
        sc.t && sc.t.status !== "done" && first ? (running ? h("p", { class: "faint", "data-turn-running": "" }, T(`The tutor is working (${sc.t.provider} · ${sc.t.model})…`, `導師作答中（${sc.t.provider} · ${sc.t.model}）…`)) : h("p", { class: "rr-err", "data-turn-failed": sc.t.status }, sc.t.status === "interrupted" ? T("Interrupted: Studio stopped during this turn.", "中斷：這一回合進行時 Studio 停止了。") : `${T("Failed", "失敗")}: ${sc.t.error || ""}`)) : null,
        sc.quiz ? quizSide(r, sc) : n ? h("ol", { class: "rr-pointlist", "data-points": n }, sc.points.map(pointView)) : null,
        n && !sc.quiz ? h("p", { class: "rr-ppage faint", "data-point-pos": `${k}/${n}` }, T(`Point ${k} of ${n}`, `第 ${k} 點 / 共 ${n} 點`)) : null,
        // the welcome's one action: the lesson, a paid turn that asks to confirm first; before any answer, what the board is for
        sc.welcome && !r.snapshot && r.autoTeach?.skipped ? h("p", { class: "rr-err", "data-auto-skipped": "" }, T(`Studio did not start the lesson by itself: ${r.autoTeach.skipped}`, `Studio 沒有自動開始這一課：${r.autoTeach.skipped}`)) : null,
        // what arriving starts (on this Mac only: a phone reads the room and starts nothing)
        sc.welcome && !r.snapshot && r.arrive && BOARD.state.viewer !== "phone" ? (r.arrive.error ? h("p", { class: "rr-err", "data-arrive": "none" }, T(`Studio cannot start the full analysis by itself: ${r.arrive.error}`, `Studio 無法自動開始完整分析：${r.arrive.error}`))
          : h("p", { class: "rr-paste-offer", "data-arrive": "on", "data-arrive-images": r.arrive.images ? "on" : "off" }, T(`Arriving here starts the full analysis by itself: one paid model round on ${r.arrive.provider} · ${r.arrive.model ?? "default model"}${r.arrive.effort ? ` (${r.arrive.effort})` : ""}${r.arrive.createsHost ? ", after creating this room's host Task" : ""}; ${r.arrive.images ? "generated pictures are on in this room: the tutor may ask for up to two, and an opening picture is made once, each a paid image job" : "no generated pictures"}. The tutor only reads the code; turn it off in the transcript drawer.`,
            `進到這裡就會自動開始完整分析：在 ${r.arrive.provider} · ${r.arrive.model ?? "預設模型"}${r.arrive.effort ? `（${r.arrive.effort}）` : ""} 上付費一回合${r.arrive.createsHost ? "，會先建立承載這間審查室的任務" : ""}；${r.arrive.images ? "這間房間開了生成圖片：導師可能要求最多兩張，另外會產生一次開場圖，每張都是付費的圖片工作" : "不產生圖片"}。導師只讀程式碼；可在紀錄抽屜裡關掉。`))) : null,
        sc.welcome && r.open && !r.offer?.error && r.actions?.some((a) => a.id === "teach") ? h("button", { type: "button", class: "rr-cta", "data-welcome-teach": "", disabled: r.running != null || RR.posting.has(card), onclick: () => askTurn(card, "teach") },
          r.subject?.kind === "dir" ? T("Teach me this directory", "教我這個目錄") : T("Teach me this change", "教我這個 PR"), h("small", {}, T(`Asks first: ${r.offer?.provider ?? ""} · ${r.offer?.model ?? "default model"}, one paid round`, `會先確認：${r.offer?.provider ?? ""} · ${r.offer?.model ?? "預設模型"}，付費一回合`))) : null,
        sc.welcome && !answers ? h("p", { class: "faint rr-boardhint", "data-board-empty": "" }, T("Ask below. Each answer becomes a block on this board: a picture (a diagram built up step by step, the app's screenshots before and after, a chart, the code) beside the tutor's points, played one at a time.", "在下方提問。每個回答會在這塊白板上變成一個區塊：一張圖（一步步組起來的圖、改動前後的截圖、圖表、程式碼），旁邊是導師的重點，一個一個播放。")) : null,
        sc.questions.length ? h("div", { class: "rr-sceneq", "data-scene-check": "" }, h("b", {}, T("Questions for you (answer in the prompt below)", "問你的問題（在下方輸入框回答）")), h("ol", {}, sc.questions.map((q) => h("li", { "data-check-result": q.result ? (q.result.correct ? "correct" : "missed") : "open" }, q.q, q.result ? h("span", { class: `rr-mark ${q.result.correct ? "ok" : "miss"}` }, q.result.correct ? T(" ✓ correct", " ✓ 正確") : T(" ✗ missed: re-explained", " ✗ 沒答對：已重新講解")) : null)))) : null)));
}
/** The play bar, floating on the board: the caption of the point being read, a point back, a dot per point, a point on,
 *  play / pause, replay, the scene before and after, the voice */
function playBar(r, scenes, i) {
  const card = r.card.id, sc = scenes[i]; if (!sc) return null;
  const n = sc.points.length, k = sc.quiz ? n : revealOf(card, sc), running = sc.t?.status === "running";
  const cur = sc.quiz ? null : sc.points[k - 1], caption = cur ? plain(cur.text) : running ? T("The tutor is working…", "導師作答中…") : "";
  // a lesson's chapter is read, not played: until it plays the bar is a small pill (play, replay, the voice) that leaves the
  // chapter and its question cards clear
  const playBtn = h("button", { type: "button", class: "rr-ibtn primary", "data-play": "", "aria-pressed": String(RR.playing === card), disabled: !n || sc.quiz, onclick: () => togglePlay(card), "aria-label": RR.playing === card ? T("Pause", "暫停") : T("Play", "播放"), title: T("Play / pause (Space)", "播放／暫停（空白鍵）") }, ic(RR.playing === card ? "pause" : "play"));
  const replay = h("button", { type: "button", class: "rr-ibtn", "data-replay": "", disabled: !n || sc.quiz, onclick: () => play(card, sc, 0), "aria-label": T("Replay this scene", "這個場景重播"), title: T("Replay this scene", "這個場景重播") }, ic("replay"));
  if (sc.chapter && sc.t?.action === "teach" && sc.t.status === "done" && RR.playing !== card && k >= n)
    return h("div", { class: "rb-play mini", "data-playbar": card, role: "group", "aria-label": T("Playback", "播放") }, h("div", { class: "rr-playbar" }, playBtn, replay, h("span", { class: "rb-play-l" }, T("Play this chapter", "播放這一章")), voicePicker(r)));
  const dot = (m) => h("button", { type: "button", class: "rr-dot", "data-dot": `${i}:${m}`, "aria-current": m === k ? "step" : null, "aria-label": T(`Point ${m}`, `第 ${m} 點`), onclick: () => { markMoved(card); stopPlay(); RR.step.delete(`${card}/${sc.key}`); RR.reveal.set(`${card}/${sc.key}`, m); rerender(); } }, h("i"));
  return h("div", { class: "rb-play", "data-playbar": card, role: "group", "aria-label": T("Captions and playback", "字幕與播放") },
    h("div", { class: "rr-caption", "data-caption": "", "aria-live": "polite" }, h("span", { class: "rr-who" }, sc.studio || !sc.t ? "Studio" : T("Tutor", "導師")), h("span", { class: "rr-ctext", "data-caption-text": "" }, caption)),
    h("div", { class: "rr-playbar" },
      h("button", { type: "button", class: "rr-ibtn", "data-point-prev": "", disabled: i === 0 && k <= 1, onclick: () => stepPoint(card, -1), "aria-label": T("Previous point", "上一點"), title: T("Previous point", "上一點") }, ic("prev")),
      n && !sc.quiz && n <= 24 ? h("div", { class: "rr-dots", role: "group", "aria-label": T("Points", "重點") }, sc.points.map((_, m) => dot(m + 1))) : null,
      h("button", { type: "button", class: "rr-ibtn", "data-point-next": "", disabled: i === scenes.length - 1 && k >= n, onclick: () => stepPoint(card, 1), "aria-label": T(`Next point (${k}/${n})`, `下一點（${k}/${n}）`), title: T("Next point", "下一點") }, ic("next")),
      playBtn, replay,
      h("span", { class: "rr-scenenav" },
        h("button", { type: "button", class: "rr-mini", "data-scene-prev": "", disabled: i === 0, onclick: () => goScene(card, i - 1), "aria-label": T("Previous scene", "上一個場景") }, "«"),
        h("span", { class: "faint", "data-scene-pos": `${i + 1}/${scenes.length}` }, T(`Scene ${i + 1} of ${scenes.length}`, `場景 ${i + 1} / ${scenes.length}`)),
        h("button", { type: "button", class: "rr-mini", "data-scene-next": "", disabled: i === scenes.length - 1, onclick: () => goScene(card, i + 1), "aria-label": T("Next scene", "下一個場景") }, "»")),
      voicePicker(r)));
}
/** the captain looked elsewhere while a turn ran: its answer, when ready, waits behind this chip on the board */
function readyChip(r, scenes) {
  const card = r.card.id; if (!RR.ready.has(card)) return null;
  return h("button", { type: "button", class: "rr-chip lead rb-ready", "data-answer-ready": RR.ready.get(card), onclick: () => { const key = RR.ready.get(card), at = scenes.findIndex((x) => x.key === key); RR.ready.delete(card); RR.moved.delete(card); if (at >= 0) { RR.scene.set(card, at); RR.jump.set(card, key); RR.reveal.set(`${card}/${key}`, 0); queueMicrotask(() => play(card, scenes[at])); } rerender(); } }, T("The answer is ready — show it", "回答好了：顯示"));
}
/** a point on or back while a scene is being played or stepped through (→ ← on the board); false when the scene is whole */
function stepReveal(card, dir) {
  const { sc } = curScene(card); if (!sc || sc.quiz) return false; const k = revealOf(card, sc), n = sc.points.length;
  if (k >= n || (dir < 0 && k <= 1)) return false;
  markMoved(card); stopPlay(); RR.pick.delete(`${card}/${sc.key}`); RR.step.delete(`${card}/${sc.key}`); RR.reveal.set(`${card}/${sc.key}`, k + dir); rerender(); return true;
}
const boardView = (r) => { const scenes = scenesOf(r); return BOARD.view(r, scenes, sceneState(r.card.id, scenes)); };
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
const askTurn = (card, action, text, again) => { if (action === "ask" && !text) return; const r = RR.rooms.get(card);
  const prior = !again && r && action !== "quiz" ? [...(r.turns || [])].reverse().find((t) => !t.studio && t.status === "done" && t.action === action && t.head === r.head && (action !== "ask" || String(t.text).trim() === String(text).trim())) : null;
  RR.confirm.set(card, prior ? { action, text: text || "", existing: prior.n } : { action, text: text || "" }); rerender(); };
/** go to a turn's scene (its first) */
const showTurn = (card, n) => { const r = RR.rooms.get(card); if (!r) return; const scenes = scenesOf(r), at = scenes.findIndex((x) => x.t?.n === n); if (at >= 0) { stopPlay(); RR.scene.set(card, at); } rerender(); };
/** The dock under the board: the quick actions, the question (typed or spoken), the transcript; the paid round's
 *  confirmation, a turn being sent and errors open above it, over the board, never pushing it */
function promptBar(r) {
  const card = r.card.id, busy = r.running != null || RR.posting.has(card), offer = r.offer, conf = RR.confirm.get(card), err = RR.err.get(card);
  const answers = (r.turns || []).filter((t) => !t.studio && t.status === "done").length;
  const tbtn = h("button", { type: "button", class: "rr-ibtn rr-tbtn", "data-transcript-toggle": card, "data-answers": answers, "aria-expanded": String(RR.drawer.has(card)), "aria-label": T("Transcript", "紀錄"), title: T("Transcript", "紀錄"), onclick: () => { RR.drawer.has(card) ? RR.drawer.delete(card) : RR.drawer.add(card); rerender(); } }, ic("list"));
  if (r.snapshot) return h("div", { class: "rr-bar rr-dock" }, h("p", { class: "faint rr-dock-note", "data-room-closed": "", "data-room-readonly": r.snapshot.artifact }, T("A review room saved in the Library: a read-only replay. Captions and this Mac's voice play; nothing here asks a model or pays.", "存在成品庫的審查室：唯讀重播。字幕和這台 Mac 的語音照常播放；這裡不會呼叫模型，也不付費。")), tbtn);
  if (!r.open) return h("div", { class: "rr-bar rr-dock" }, h("p", { class: "faint rr-dock-note", "data-room-closed": "" }, r.closed ? T(r.closed.en, r.closed.zh) : T("The merge card is answered: this room is read-only now.", "合併卡已回覆：審查室現在只能閱讀。")), tbtn);
  if (offer?.error) return h("div", { class: "rr-bar rr-dock" }, h("p", { class: "rr-err rr-dock-note", "data-room-unavailable": "" }, offer.error), tbtn);
  if (RR.mic == null) void micReady(card);
  const ask = (action) => askTurn(card, action, action === "ask" ? (RR.draft.get(card) || "").trim() : "");
  const start = async () => { const c = RR.confirm.get(card); if (!c || busy) return; RR.posting.add(card); RR.err.delete(card); rerender();
    try { const room = await postJ(`/api/review-room/${enc(card)}/turn`, c.regenerate ? { regenerate: c.regenerate, pick: c.pick, lang: uiLang(), confirm: c.offer?.hash, images: RR.imgWant.get(card) ?? !!r.images } : { action: c.action, text: c.text, lang: uiLang(), confirm: offer?.hash, images: RR.imgWant.get(card) ?? !!r.images }); RR.imgWant.delete(card); RR.rooms.set(card, room); RR.confirm.delete(card); if (c.action === "ask") RR.draft.delete(card); RR.heard = false; RR.scene.delete(card); }
    catch (e) { RR.err.set(card, e.message); if (e.offer) RR.rooms.set(card, { ...r, offer: e.offer }); }
    finally { RR.posting.delete(card); redraw(card); schedule(); } };
  const talk = !!RR.rec;
  const pops = [
    RR.heard && RR.draft.get(card) ? h("p", { class: "rr-pop faint", "data-heard": "" }, T("Heard you: check the text above, then Ask.", "已聽到：請先檢查上面的文字，再按送出。")) : null,
    conf?.existing ? h("div", { class: "rr-pop rr-confirm", role: "group", "data-existing-offer": conf.existing },
      h("p", {}, T("This head already has that explanation, saved in the room. Show it, or explain it again (a new paid round)?", "這個 head 已經有這個解說，存在審查室裡。要直接看，還是重新講一次（新的付費回合）？")),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", "data-existing-show": conf.existing, onclick: () => { RR.confirm.delete(card); showTurn(card, conf.existing); } }, T("Show the existing explanation", "看現有的解說")),
        h("button", { type: "button", class: "btn", "data-existing-again": "", onclick: () => askTurn(card, conf.action, conf.text, true) }, T("Explain again (paid)", "重新講一次（付費）")),
        h("button", { type: "button", class: "btn ghost", "data-room-cancel": "", onclick: () => { RR.confirm.delete(card); rerender(); } }, T("Cancel", "取消")))) :
    conf?.action === "translate" ? h("div", { class: "rr-pop rr-confirm", role: "group", "data-translate-confirm": conf.lang, "aria-label": T("Confirm the translation", "確認翻譯") },
      h("p", {}, T(`Translate this room's explanation (~US$${r.translate?.estimate ?? "?"}): one small paid round on ${offer?.provider} · ${offer?.model ?? "default model"}. Text only: no code is read; citations, the board and its pictures stay as they are. Asked once for this room; switching back costs nothing.`, `翻譯這間房間的解說（約 US$${r.translate?.estimate ?? "?"}）：在 ${offer?.provider} · ${offer?.model ?? "預設模型"} 上一次小的付費回合。只翻文字：不讀程式碼；引用、白板和圖都不變。這間房間只問一次；切回原文不用錢。`)),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", "data-translate-start": "", disabled: RR.posting.has(card), onclick: () => startTranslate(r, conf.lang, offer?.translate?.hash, true) }, T("Translate", "翻譯")),
        h("button", { type: "button", class: "btn ghost", "data-room-cancel": "", onclick: () => { RR.confirm.delete(card); RR.lang.delete(card); rerender(); } }, T("Cancel", "取消")))) :
    conf ? h("div", { class: "rr-pop rr-confirm", role: "group", "data-room-confirm": conf.action, "aria-label": T("Confirm the paid round", "確認付費回合") },
      h("p", {}, conf.regenerate ? T(`Explain this again with ${conf.offer.provider} · ${conf.offer.model ?? "default model"}: `, `改由 ${conf.offer.provider} · ${conf.offer.model ?? "預設模型"} 重講這一題：`) : null, T(`This starts a paid model round on ${(conf.offer || offer).provider} · ${(conf.offer || offer).model ?? "default model"}${(conf.offer || offer).effort ? ` (${(conf.offer || offer).effort})` : ""}${r.images ? "; the tutor may also ask for up to two generated pictures, each a paid image job made in the background" : ""}. The tutor only reads the code; nothing is written, and nothing is sent to GitHub.`,
        `這會開始一次付費的模型執行：${offer.provider} · ${offer.model ?? "預設模型"}${offer.effort ? `（${offer.effort}）` : ""}${r.images ? "；導師也可能要求最多兩張生成圖片，每張都是在背景進行的付費圖片工作" : ""}。導師只讀程式碼，不寫任何東西，也不送任何東西到 GitHub。`)),
      h("label", { class: "rr-imgopt" }, h("input", { type: "checkbox", "data-images-toggle": "", checked: RR.imgWant.get(card) ?? !!r.images, disabled: RR.posting.has(card), onchange: (e) => { RR.imgWant.set(card, e.target.checked); rerender(); } }),
        h("span", {}, T("Generated pictures for this room, from this round on: up to two a turn and, once, an opening picture of the change, each a paid image job. Applied only when you start this round; off by default (Studio draws every diagram from the tutor's data).", "這個審查室從這一回合起使用生成圖片：每回合最多兩張，另外會產生一次這個改動的開場圖，每張都是付費圖片工作。只有在你開始這一回合時才生效；預設關閉（Studio 會依導師的資料畫出每張圖）。"))),
      h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", "data-room-start": "", disabled: busy, onclick: start }, T("Start the round", "開始這一回合")),
        h("button", { type: "button", class: "btn ghost", "data-room-cancel": "", disabled: RR.posting.has(card), onclick: () => { RR.confirm.delete(card); RR.imgWant.delete(card); rerender(); } }, T("Cancel", "取消")))) : null,
    err ? h("p", { class: "rr-pop rr-err", role: "alert", "data-room-error": "" }, err, " ", h("button", { type: "button", class: "rr-mini", "aria-label": T("Dismiss", "關閉"), onclick: () => { RR.err.delete(card); rerender(); } }, "×")) : null].filter(Boolean);
  return h("div", { class: "rr-bar rr-dock", "data-chat": card },
    pops.length ? h("div", { class: "rr-pops" }, pops) : null,
    h("div", { class: "rr-quick", role: "group", "aria-label": T("Quick actions", "快速動作") }, r.actions.map((a) => h("button", { type: "button", class: `rr-chip${a.id === "teach" ? " lead" : ""}`, "data-room-action": a.id, disabled: busy, onclick: () => ask(a.id) }, T(...(ACTION_LABEL[a.id] || [a.en, a.zh]))))),
    h("div", { class: "rr-askrow" },
      h("input", { class: "rr-askin", type: "text", maxlength: 4000, "data-room-text": card, disabled: busy, "aria-label": T("Ask anything about this change", "問任何關於這個改動的問題"), placeholder: T("Ask anything, or interrupt with a question…", "隨時打斷、隨便問…"), value: RR.draft.get(card) || "",
        oninput: (e) => { RR.draft.set(card, e.target.value); }, onkeydown: (e) => { if (e.key === "Enter" && !e.isComposing) { RR.draft.set(card, e.target.value); ask("ask"); } } }),
      busy ? h("span", { class: "rr-busy", role: "status", "data-room-busy": r.running === -2 ? "translate" : "", title: T("The tutor is working; one turn at a time.", "導師作答中；一次一回合。") }, h("i"), r.running === -2 ? T("Translating the explanation…", "正在翻譯解說…") : T("The tutor is working; one turn at a time.", "導師作答中；一次一回合。")) : null,
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
        // a jump flies the board to the scene and closes the drawer: nothing scrolls
        h("ol", { class: "rr-turns" }, scenes.map((sc, i) => h("li", { "data-turn": sc.turn, "data-turn-status": sc.t?.status || "opening" }, h("button", { type: "button", class: "rr-jump", "data-jump": sc.key, onclick: () => { stopPlay(); markMoved(card); RR.scene.set(card, i); RR.drawer.delete(card); rerender(); } },
          sc.question ? h("span", { class: "rr-jq" }, sc.question.slice(0, 160)) : null, h("span", { class: "faint" }, ` → ${sc.title}`)),
          // the tutor's whole answer: the board shows it short, the transcript in full (text only)
          sc.t && !sc.t.studio && sc.t.status === "done" && sc.t.answer && sc.key === `t${sc.t.n}` ? h("details", { class: "rr-answer", "data-answer": sc.t.n, open: RR.fold.has(`${card}/answer/${sc.t.n}`) },
            h("summary", { onclick: (e) => { const k = `${card}/answer/${sc.t.n}`; e.currentTarget.parentElement.open ? RR.fold.delete(k) : RR.fold.add(k); } }, T("The tutor's full answer", "導師的完整回答")),
            String(sc.t.answer).split(/\n\s*\n/).filter((x) => x.trim()).map((para) => h("p", { class: isTable(para) ? "rr-ans-table" : "" }, inline(card, para.trim(), (sc.t.claims || []).flatMap((c) => c.cites || []))))) : null))),
        h("h3", {}, T("Understanding check", "理解檢查")),
        q.length ? [h("p", { "data-check-score": "" }, graded.length ? T(`${right} of ${graded.length} correct`, `答對 ${right}/${graded.length}`) : (q.some((x) => x.options) ? T("Not answered yet: pick an option on the board.", "還沒作答：請在白板上選一個答案。") : T("Not answered yet: answer in the prompt.", "還沒作答：請在輸入框回答。"))),
          h("ol", { class: "rr-check" }, q.map((x) => h("li", { "data-check": x.n, "data-check-result": x.result ? (x.result.correct ? "correct" : "missed") : "open" }, x.q, x.options && x.result ? h("div", { class: "faint" }, T(`You picked ${LETTERS[x.choice]} (${x.options[x.choice]}); right: ${LETTERS[x.answer]} (${x.options[x.answer]})`, `你選 ${LETTERS[x.choice]}（${x.options[x.choice]}）；正確 ${LETTERS[x.answer]}（${x.options[x.answer]}）`)) : null, x.result?.note ? h("div", { class: "faint" }, x.result.note) : null)))]
          : h("p", { class: "faint" }, T("Press “Check me” for 2 to 4 short questions. Display only: it never blocks the merge.", "按「考考我」會有 2 到 4 個小問題。僅供參考，不會擋合併。")),
        // GitHub reviewers' notes: their words, folded; the board shows only Studio's short summary and the tutor's digest
        r.notes?.length ? h("details", { class: "rr-notes", "data-notes": r.notes.length, open: RR.fold.has(`${card}/notes`) },
          h("summary", { onclick: (e) => { e.currentTarget.parentElement.open ? RR.fold.delete(`${card}/notes`) : RR.fold.add(`${card}/notes`); } }, T(`Reviewers' notes on GitHub (${r.notes.length}, newest first)`, `GitHub 上審查者的意見（${r.notes.length} 則，新的在前）`)),
          h("ol", { class: "rr-notelist" }, r.notes.map((x) => h("li", { "data-note": x.id },
            h("div", { class: "faint" }, `${x.author}${x.bot ? " (bot)" : ""} · ${x.kind === "review" ? `${T("review", "審查")}${x.state ? ` ${x.state.toLowerCase().replace(/_/g, " ")}` : ""}` : x.kind === "inline" ? `${x.path ?? ""}${x.line ? `:L${x.line}` : ""}${x.outdated ? T(" (outdated)", "（已過時）") : ""}` : T("comment", "留言")}${x.at ? ` · ${String(x.at).slice(0, 10)}` : ""} `, citeChip(card, `review:${x.id}`, true)),
            x.body ? quoteView({ quote: x.body, basis: "reviewer" }, `${card}/note/${x.id}`) : null)))) : null,
        h("h3", {}, T("Sources", "來源")),
        r.sources.length ? h("ul", { class: "rr-sources" }, r.sources.map((s) => h("li", { "data-source": s.n, "data-source-ok": String(s.ok) }, h("span", { class: "vbadge" }, `${s.n} ${s.kind === "search" ? T("search", "搜尋") : T("page", "網頁")}`), " ",
          s.kind === "search" ? s.query : webLink(s) ? h("a", { href: webLink(s), target: "_blank", rel: "noopener noreferrer", "data-source-link": s.n }, webLink(s)) : h("code", { "data-source-text": s.n }, s.url || s.text || ""), s.refused ? h("span", { class: "rr-err" }, T(` refused: ${s.refused}`, ` 已拒絕：${s.refused}`)) : s.error ? h("span", { class: "faint" }, ` ${s.error}`) : null)))
          : h("p", { class: "faint" }, T("Every web search and page the tutor uses is listed here. Studio refuses any that would carry this repository's code or names.", "導師用到的每個網路搜尋和網頁都列在這裡；會帶出這個儲存庫程式碼或名稱的查詢，Studio 一律拒絕。")),
        // start the room over: confirmed first; what goes and what stays said plainly; refused while a turn or a translation runs
        !r.snapshot ? h("label", { class: "rr-imgopt", "data-auto-zone": "" }, h("input", { type: "checkbox", "data-auto-room": "", checked: r.autoTeach?.on !== false, onchange: async (e) => { try { RR.rooms.set(card, await postJ(`/api/review-room/${enc(card)}/auto`, { on: e.target.checked })); dropPasteOffers(); } catch (er) { RR.err.set(card, er.message); } rerender(); } }),
          h("span", {}, T("Analyse this room by itself when you open it on a new head (or paste its pull request): one paid round on the room's tutor, once per head", "在新的 head 打開這個審查室（或貼上它的 pull request）時自動完整分析：用房間的導師付費一回合，每個 head 一次"))) : null,
        r.snapshot ? null : h("div", { class: "rr-reset", "data-reset-zone": "" }, h("h3", {}, T("Start over", "清空重來")),
          RR.resetAsk.has(card) ? h("div", { class: "rr-pop rr-confirm", role: "group", "data-reset-confirm-box": "", "aria-label": T("Start this room over", "清空這個審查室重來") },
            h("p", {}, T("Start this room over? Its answers, its board, its translations and its generated pictures go (moved to an archive folder beside the room, not deleted; a Task's room keeps that archive in the Task's own folder, so it goes if the Task is deleted). The Library's saved snapshots and the Task's ledger stay.", "要清空這個審查室重來嗎？它的回答、白板、翻譯和生成圖片都會移走（搬到審查室旁的封存資料夾，不會刪除；任務的審查室會把封存放在任務自己的資料夾裡，任務被刪除時封存也會一起刪除）。成品庫裡存過的快照和任務的帳本都會保留。")),
            h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", "data-reset-confirm": "", disabled: RR.posting.has(card), onclick: () => resetRoom(card) }, T("Start over", "清空重來")),
              h("button", { type: "button", class: "btn ghost", "data-reset-cancel": "", onclick: () => { RR.resetAsk.delete(card); rerender(); } }, T("Cancel", "取消"))))
          : h("button", { type: "button", class: "btn", "data-room-reset": "", disabled: r.running != null || r.translating?.status === "running", title: r.running != null ? T("A turn is running", "有回合在進行") : "", onclick: () => { RR.resetAsk.add(card); rerender(); } }, T("Start this room over…", "清空重來…")))))];
}
/** the room started over: Studio archived it; this page forgets everything it kept for it and opens it fresh, on its welcome */
async function resetRoom(card) {
  if (RR.posting.has(card)) return; RR.posting.add(card); RR.err.delete(card); rerender();
  try { await postJ(`/api/review-room/${enc(card)}/reset`, {});
    stopPlay(); clearTimeout(RR.poll); RR.poll = null;
    for (const key of [...KV.clips.keys()]) if (key.startsWith(`${card}|`)) KV.clips.delete(key); // its clips were deleted with it
    for (const m of [RR.scene, RR.seen, RR.confirm, RR.draft, RR.cite, RR.err, RR.reveal, RR.ready, RR.rscroll, RR.jump, RR.lang]) m.delete(card);
    for (const set of [RR.moved, RR.resetAsk, RR.drawer, RR.regen]) set.delete(card);
    for (const m of [RR.ver, RR.pick, RR.drawn, RR.tsel, RR.lastK, RR.shot]) for (const key of [...m.keys()]) if (key.startsWith(`${card}/`)) m.delete(key);
    for (const set of [RR.titled, RR.fold]) for (const key of [...set]) if (key.startsWith(`${card}/`)) set.delete(key);
    BOARD.forget(card); RR.rooms.delete(card); RR.scene.set(card, 0); await load(card, true); RR.scene.set(card, 0); }
  catch (e) { RR.err.set(card, e.message); RR.resetAsk.delete(card); }
  finally { RR.posting.delete(card); rerender(); }
}
/** Studio's default tutor (the room list): Automatic, or a model this machine runs and has verified (one it cannot is disabled with why) */
function tutorDefault() {
  const list = RR.list?.tutors || [], cur = RR.list?.settings?.tutor || null, val = cur ? `${cur.provider}|${cur.model}` : "auto";
  return h("label", { class: "rr-imgopt rr-tutordefault" }, h("span", {}, T("Studio's default tutor for every room (a room can pick its own):", "每間審查室的預設導師（房間可以自己選）：")),
    h("select", { class: "input", "data-tutor-default": "", onchange: async (e) => { const v = e.target.value; try { const st = await postJ("/api/review-room/settings", { tutor: v === "auto" ? null : { provider: v.split("|")[0], model: v.split("|").slice(1).join("|") } }); if (RR.list) RR.list.settings = st; dropPasteOffers(); PR.err.delete("home");
          // every room kept on this page offered the old default: each is read again when it is next opened
          for (const [rid, rr] of [...RR.rooms]) if (!rr?.snapshot && rr?.running == null) RR.rooms.delete(rid); } catch (er) { PR.err.set("home", er.message); } rerenderAny(); } },
      h("option", { value: "auto", selected: val === "auto" }, T("Automatic: the most independent model Studio can run", "自動：Studio 能跑、最獨立的模型")),
      list.map((m) => h("option", { value: `${m.provider}|${m.model}`, selected: val === `${m.provider}|${m.model}`, disabled: !m.runnable, "data-tutor-option-held": m.held ? "" : null }, `${m.provider} · ${m.model}${m.held ? T(` (cannot be picked: ${m.held})`, `（不能選：${m.held}）`) : ""}`))));
}
// ---------- a pull request by its URL: Studio reads it on GitHub (GET only) for a project connected to GitHub ----------
const PR = { url: new Map(), busy: new Set(), err: new Map(), checking: new Set(), offer: new Map(), shown: new Map() };
/** a switch changed: what a paste starts is asked again */
const dropPasteOffers = () => { PR.offer.clear(); PR.shown.clear(); };
const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?$/;
/** a GitHub directory's address: a repository's page, or …/tree/<branch, tag or commit>/<path> */
const DIR_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\/tree\/[^?#\s]+)?\/?$/;
const pastable = (u) => PR_URL.test(u) || DIR_URL.test(u);
/** what pasting this address would start, asked of Studio once per address (the paste box says it before the paste) */
const pasteOffer = (url) => { if (!pastable(url) || PR.offer.has(url)) return PR.offer.get(url); PR.offer.set(url, { loading: true });
  api(`/api/review-room/paste-offer?url=${encodeURIComponent(url)}`).then((o) => PR.offer.set(url, o)).catch((e) => PR.offer.set(url, { error: e.message })).finally(rerenderAny); return PR.offer.get(url); };
/** the paste box's line about the paste: a paid round on this tutor when auto-teach is on, else nothing runs until asked */
function pasteLine(url, where) {
  const o = url ? pasteOffer(url) : null; if (!o || o.loading) { PR.shown.delete(where); return null; }
  PR.shown.set(where, { url, auto: o.auto !== false && !o.error, plan: o.plan || null }); // what go() may start: only what this line said
  if (o.auto === false) return h("p", { class: "faint", "data-paste-offer": "off" }, T("Pasting opens the room; nothing runs until you ask (auto-teach is off).", "貼上只會開啟審查室；你開口之前什麼都不跑（自動教學已關）。"));
  if (o.error) return h("p", { class: "faint", "data-paste-offer": "none" }, T(`Pasting opens the room; no lesson starts by itself: ${o.error}`, `貼上會開啟審查室，不會自動開始教學：${o.error}`));
  const who = `${o.provider} · ${o.model ?? T("default model", "預設模型")}${o.effort ? ` (${o.effort})` : ""}`;
  // a directory: no pull request, its own host Task (no crew: the tutor the box names)
  if (!PR_URL.test(url)) return h("p", { class: "rr-paste-offer", "data-paste-offer": "on", "data-paste-kind": "dir", "data-paste-images": o.images ? "on" : "off", "data-paste-host": o.createsHost ? "new" : "kept" },
    T(`Pasting reads the directory at that ref (pinned at its commit) and starts its lesson by itself: ${o.createsHost ? "it creates the room's host Task, then runs " : ""}one paid model round on ${who}; ${o.images ? "the tutor may also ask for up to two generated pictures, each a paid image job" : "no generated pictures"}. The tutor only reads the code, and nothing is sent to GitHub.`,
      `貼上會讀取這個目錄（固定在它的 commit）並自動開始這一課：${o.createsHost ? "會先建立承載這間審查室的任務，再" : ""}在 ${who} 上付費執行一回合；${o.images ? "導師也可能要求最多兩張生成圖片，每張都是付費的圖片工作" : "不產生圖片"}。導師只讀程式碼，也不送任何東西到 GitHub。`));
  return h("p", { class: "rr-paste-offer", "data-paste-offer": "on", "data-paste-images": o.images ? "on" : "off", "data-paste-host": o.createsHost ? "new" : "kept" },
    T(`Pasting starts the lesson by itself: ${o.createsHost ? "it creates this pull request's host Task and its tutor's staffing, then runs " : ""}one paid model round on ${who}; ${o.images ? "the tutor may also ask for up to two generated pictures, each a paid image job" : "no generated pictures"}. The tutor only reads the code, and nothing is sent to GitHub.`,
      `貼上就會自動開始這一課：${o.createsHost ? "會先為這個 pull request 建立承載它的任務和導師的人員配置，再" : ""}在 ${who} 上付費執行一回合；${o.images ? "導師也可能要求最多兩張生成圖片，每張都是付費的圖片工作" : "不產生圖片"}。導師只讀程式碼，也不送任何東西到 GitHub。`));
}
/** the URL box (the Review Room's home, and a small one on a connected project's page) */
function prBox(where, repository) {
  const busy = PR.busy.has(where), err = PR.err.get(where);
  const go = async () => { const url = (PR.url.get(where) || "").trim(); if (!url || busy) return; PR.busy.add(where); PR.err.delete(where); rerenderAny();
    // the lesson starts by itself only when this box has said so for this very address; before that the paste opens the room only
    const said = PR.shown.get(where), auto = !!(said && said.url === url && said.auto && said.plan);
    // a pull request's address, or (the home's box) a GitHub directory's
    try { const out = await postJ(PR_URL.test(url) || repository ? "/api/review-room/open-pr" : "/api/review-room/open-dir", { url, lang: uiLang(), ...(auto ? { auto: true, plan: said.plan } : {}) }); RR.rooms.set(out.id, out.room);
      // the plan changed since the box said it (a new tutor, pictures, a host): nothing started; the box shows the new plan to paste again
      if (out.plan) { PR.offer.set(url, out.plan); PR.err.set(where, T("What a paste starts has changed (above): nothing started. Paste again to start it.", "貼上會開始的內容變了（見上方）：什麼都沒有開始。再貼一次才會開始。")); return; }
      PR.url.delete(where); dropPasteOffers(); location.hash = out.href; }
    catch (e) { PR.err.set(where, e.message); } finally { PR.busy.delete(where); rerenderAny(); } };
  return h("form", { class: "rr-prbox", "data-pr-box": where, onsubmit: (e) => { e.preventDefault(); go(); } },
    h("label", { class: "rr-prlabel" }, h("span", {}, repository ? T(`Review a pull request of ${repository}`, `審查 ${repository} 的 pull request`) : T("Review a pull request, or learn a directory of any GitHub repository", "審查一個 pull request，或學習任何 GitHub 儲存庫的一個目錄")),
      h("input", { class: "input", type: "url", "data-pr-url": where, required: true, disabled: busy, maxlength: 800, placeholder: repository ? `https://github.com/${repository}/pull/123` : "https://github.com/<owner>/<repo>/pull/<number>  ·  …/tree/<branch>/<path>", value: PR.url.get(where) || "",
        oninput: (e) => { PR.url.set(where, e.target.value); const u = e.target.value.trim(); if ((repository ? PR_URL.test(u) : pastable(u)) && !PR.offer.has(u)) { pasteOffer(u); } }, "aria-label": repository ? T("Pull request URL", "Pull request 網址") : T("Pull request or directory URL", "Pull request 或目錄的網址") })),
    pasteLine((PR.url.get(where) || "").trim(), where),
    h("button", { type: "submit", class: "btn primary", "data-pr-open": where, disabled: busy }, busy ? T("Reading it on GitHub…", "正在讀取 GitHub…") : T("Open its review room", "開啟它的審查室")),
    h("p", { class: "faint" }, repository ? T("Only a pull request of a registered project connected to GitHub. Studio only reads it on GitHub and copies its commits into its own folder; nothing is written to GitHub or to your checkout.", "只限已註冊且連到 GitHub 的專案的 pull request。Studio 只在 GitHub 上讀取，並把它的 commit 複製到 Studio 自己的資料夾；不寫任何東西到 GitHub 或你的本機儲存庫。")
      : T("A pull request of a registered project connected to GitHub; or a directory of any GitHub repository (a public one as it is, a private one through your gh login), read at one commit. Studio only reads GitHub and copies the commits into its own folder; nothing is written to GitHub or to your checkout.", "已註冊且連到 GitHub 的專案的 pull request；或任何 GitHub 儲存庫的一個目錄（公開的直接讀，私人的用你的 gh 登入），固定在一個 commit。Studio 只讀 GitHub，並把 commit 複製到 Studio 自己的資料夾；不寫任何東西到 GitHub 或你的本機儲存庫。")),
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
    : kind === "dir" ? T(`${r.dir?.repository || r.subject?.repository || ""}${r.dir?.path ? `/${r.dir.path}` : ""} @ ${r.dir?.ref || ""} · pinned at ${String(r.dir?.sha || "").slice(0, 8)}. The tutor reads only; nothing is written to GitHub.`, `${r.dir?.repository || r.subject?.repository || ""}${r.dir?.path ? `/${r.dir.path}` : ""} @ ${r.dir?.ref || ""} · 固定在 ${String(r.dir?.sha || "").slice(0, 8)}。導師只讀；不寫任何東西到 GitHub。`)
    : T(`${r.subject?.repository || ""} #${r.subject?.number || ""} · head ${String(r.head || "").slice(0, 8)}. Studio only reads GitHub; the room never comments, reviews or merges.`, `${r.subject?.repository || ""} #${r.subject?.number || ""} · head ${String(r.head || "").slice(0, 8)}。Studio 只讀 GitHub；審查室不留言、不審查、不合併。`);
  const verdicts = ps?.verdicts?.length ? ps.verdicts.map((v) => `${v.author}: ${v.state === "APPROVED" ? T("approved", "核准") : v.state === "CHANGES_REQUESTED" ? T("changes requested", "要求修改") : T("dismissed", "撤銷")}${v.current ? "" : T(" (an older head)", "（較舊的 head）")}`).join(" · ") : null;
  const pill = (attrs, ...kids) => h("span", { ...attrs, class: `rr-pill ${attrs.class || ""}`, title: attrs.title ?? kids.flat().map((k) => typeof k === "string" ? k : k?.textContent || "").join("") }, ...kids);
  const back = r.snapshot ? h("a", { class: "rr-back", href: `#/artifact/${enc(r.snapshot.artifact)}` }, ic("back"), h("span", {}, T("Library", "成品庫"))) : r.task?.id ? h("a", { class: "rr-back", href: `#/run/${enc(r.task.id)}`, "data-room-task": "" }, ic("back"), h("span", {}, T("Task", "任務"))) : h("a", { class: "rr-back", href: "#/room" }, ic("back"), h("span", {}, T("Rooms", "審查室")));
  return h("header", { class: "rr-head", "data-room-subject": kind },
    back, kind === "merge" ? h("a", { class: "rr-back", href: `#/inbox/${enc(r.card.id)}` }, T("The merge card", "合併卡")) : null,
    h("div", { class: "rr-htitle" }, h("span", { class: "rr-crumb" }, h("a", { href: "#/room", "data-room-home": "" }, T("Review room", "審查室")), " › "), h("b", { title }, title), h("span", { title: sub }, sub)),
    langToggle(r),
    h("div", { class: "rr-pills" },
      ps ? pill({ class: ps.state === "merged" ? "ok" : ps.state === "closed" ? "bad" : ps.approved ? "ok" : "", "data-pr-state": ps.state, "data-pr-approved": String(!!ps.approved) }, h("span", {}, ps.state === "merged" ? T("Merged on GitHub", "已在 GitHub 合併") : ps.state === "closed" ? T("Closed on GitHub", "已在 GitHub 關閉") : ps.approved ? T("Open · approved at this head", "開啟中 · 已在這個 head 核准") : ps.draft ? T("Open · draft", "開啟中 · 草稿") : T("Open", "開啟中")),
        " · ", ps.headRepo && r.subject?.repository && ps.headRepo.toLowerCase() !== r.subject.repository.toLowerCase() ? T(`from the fork ${ps.headRepo} · `, `來自 fork ${ps.headRepo} · `) : "", verdicts ? h("span", { "data-pr-verdicts": "" }, verdicts) : T("No reviewer verdict yet", "還沒有審查者的結論"),
        h("span", { class: "faint" }, T(` · read on GitHub ${String(ps.checkedAt || "").slice(0, 16).replace("T", " ")}`, ` · ${String(ps.checkedAt || "").slice(0, 16).replace("T", " ")} 讀取自 GitHub`))) : null,
      r.stale ? pill({ class: "bad", role: "status", "data-pr-stale": "" }, T(`GitHub shows newer commits (${String(r.stale.head).slice(0, 8)}) Studio could not fetch yet: ${r.stale.error}. The room shows the last head it has; check again before asking.`, `GitHub 上有較新的 commit（${String(r.stale.head).slice(0, 8)}），Studio 還沒抓到：${r.stale.error}。審查室顯示它手上最後的 head；提問前請再檢查一次。`)) : null,
      kind === "branch" ? pill({ class: r.reviewed ? "ok" : "", "data-branch-state": r.reviewed ? "reviewed" : "not-reviewed" }, r.reviewed ? T(`Reviewed by Studio at ${String(r.head || "").slice(0, 8)}${r.local ? " · ready on its local branch, not published" : ""}`, `Studio 已在 ${String(r.head || "").slice(0, 8)} 審查通過${r.local ? " · 在本機分支上就緒，不會發布" : ""}`) : T("Studio's review has not passed at this head yet.", "Studio 的審查還沒在這個 head 通過。")) : null,
      mv ? pill({ class: "warn", role: "status", "data-room-moved": mv.commits ?? "rewritten" }, mv.commits != null ? T(`${mv.commits} new commit${mv.commits === 1 ? "" : "s"} since you last looked (${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}). Your next question opens with what changed.`, `你上次看過之後有 ${mv.commits} 個新 commit（${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}）。下一個問題會先看改了什麼。`)
        : T(`The branch was rewritten since you last looked (${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}).`, `你上次看過之後分支被改寫了（${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}）。`)) : null,
      // a directory: where it is pinned (its citations open that commit, it never moves), and whether it is private
      kind === "dir" && r.dir ? pill({ "data-dir-pin": r.dir.sha, title: T(`Read at ${r.dir.ref}, pinned at commit ${r.dir.sha}`, `讀的是 ${r.dir.ref}，固定在 commit ${r.dir.sha}`) }, T(`Pinned at ${String(r.dir.sha).slice(0, 8)} · ${r.dir.files} files`, `固定在 ${String(r.dir.sha).slice(0, 8)} · ${r.dir.files} 個檔案`), r.dir.private ? T(" · private", " · 私人") : "") : null,
      ds ? pill({ "data-room-diffstat": "" }, h("b", { class: "add" }, `+${ds.added}`), " ", h("b", { class: "del" }, `−${ds.removed}`), T(` · ${ds.files} file${ds.files === 1 ? "" : "s"}`, ` · ${ds.files} 個檔案`)) : null,
      // who the tutor is and how independent it is from the author (another vendor, another model of the same vendor, or the same model)
      // a room that takes turns: the pill is the tutor picker (this room's pick, Studio's default, or Automatic)
      r.open && !r.snapshot ? tutorButton(r) : offer?.independence ? pill({ class: offer.independence.level === "same" ? "warn" : "", "data-independence": offer.independence.level }, T(`Tutor: ${offer.provider} · ${offer.model ?? "default model"} — ${offer.independence.en}`, `導師：${offer.provider} · ${offer.model ?? "預設模型"}：${offer.independence.zh}`)) : null),
    RR.tutorMenu === id && r.open && !r.snapshot ? tutorMenu(r) : null,
    kind === "pr" && !r.snapshot ? h("button", { type: "button", class: "rr-back", "data-room-check": id, disabled: PR.checking.has(id) || r.checking || null, onclick: () => checkNow(id) }, PR.checking.has(id) || r.checking ? T("Reading GitHub…", "正在讀取 GitHub…") : T("Check for new commits", "檢查新的 commit")) : null,
    kind === "pr" && /^https:\/\/github\.com\//.test(r.subject?.url || "") ? h("a", { class: "rr-back", href: r.subject.url, target: "_blank", rel: "noopener noreferrer", "data-room-github": "" }, T("Open on GitHub", "在 GitHub 開啟")) : null,
    kind === "dir" && r.dir?.sha && /^[\w.-]+\/[\w.-]+$/.test(r.dir.repository || "") ? h("a", { class: "rr-back", href: `https://github.com/${r.dir.repository}/tree/${r.dir.sha}${r.dir.path ? `/${r.dir.path.split("/").map(encodeURIComponent).join("/")}` : ""}`, target: "_blank", rel: "noopener noreferrer", "data-room-github": "" }, T("Open on GitHub", "在 GitHub 開啟")) : null,
    // the Library: save the room (any time; an ended room is saved by Studio), or, in a saved room, its versions
    r.snapshot ? h("span", { class: "rr-pill", "data-room-snapshot": `${r.snapshot.artifact}@${r.snapshot.n}`, title: r.snapshot.reason || "" }, T(`Saved ${String(r.snapshot.savedAt || "").slice(0, 16).replace("T", " ")} · read-only`, `存於 ${String(r.snapshot.savedAt || "").slice(0, 16).replace("T", " ")} · 唯讀`)) : null,
    r.snapshot && r.snapshot.versions?.length > 1 ? h("span", { class: "rr-vers", role: "group", "aria-label": T("Saved versions", "存過的版本") }, r.snapshot.versions.map((v) => h("a", { class: "rr-ver", href: `#/room/lib:${r.snapshot.artifact}@${v.n}`, "data-snapshot-version": v.n, "aria-current": v.n === r.snapshot.n ? "page" : null }, `v${v.n}`))) : null,
    !r.snapshot && r.turns?.some((t) => t.status === "done") ? h("button", { type: "button", class: "rr-back", "data-room-save": id, disabled: RR.posting.has(`${id}/save`), title: r.library ? T(`In the Library as ${r.library.artifact} (v${r.library.versions.at(-1)?.n})`, `已在成品庫：${r.library.artifact}（v${r.library.versions.at(-1)?.n}）`) : "",
      onclick: async () => { RR.posting.add(`${id}/save`); rerender(); try { const out = await postJ(`/api/review-room/${enc(id)}/save`, {}); RR.saved = out; await load(id); } catch (e) { RR.err.set(id, e.message); } finally { RR.posting.delete(`${id}/save`); redraw(id); } } },
      RR.posting.has(`${id}/save`) ? T("Saving…", "存檔中…") : T("Save to Library", "存到成品庫")) : null,
    r.library && !r.snapshot ? h("a", { class: "rr-back", href: `#/room/lib:${r.library.artifact}`, "data-room-library": r.library.artifact }, T(`Library v${r.library.versions.at(-1)?.n}`, `成品庫 v${r.library.versions.at(-1)?.n}`)) : null,
    // Firstmate opens over the room as a sheet, never a column beside the board
    h("button", { type: "button", class: "rr-back", "data-room-firstmate": "", "aria-label": T("Firstmate (over the room)", "Firstmate（疊在審查室上）"), onclick: () => (document.body.classList.contains("chat-closed") ? document.getElementById("chatFab") : document.getElementById("chatClose"))?.click() }, ic("msg"), h("span", {}, "Firstmate")));
}
// ---------- focus mode: a room is the whole screen (app.js pageFocus, the terminal page's too). The sidebar folds to its rail and
// Firstmate closes (an overlay sheet from the header); neither is saved as the captain's preference, and both come back as they
// were on leaving. Only a room that has loaded: the home page, a loading room and an error keep the board's layout ----------
// the room list is read again on coming back to it: app.js has already drawn the new route when this runs, so leaving the
// list (for a room or any page) is what marks it stale
addEventListener("hashchange", () => { if (RR.list && !(S.route?.name === "room" && !S.route.arg)) RR.list.fresh = false;
  // back in a room whose turn still runs (the poll stopped when the captain left): read it now, and the poll follows it again
  // back in any live room (the room list, a link): read it again as an arrival (?open=1), so a head that moved since (a pull
  // request is read again on GitHub then) is seen, and its analysis starts by itself when auto-teach is on
  const id = S.route?.name === "room" ? S.route.arg : null, r = id && RR.rooms.get(id); if (r && !r.snapshot && !r.error) load(id, r.running == null); });
// ---------- full screen: only the board (docs/units/review-room.md 41). The Fullscreen API goes to #view, the stable container
// the board is drawn in: every redraw replaces the board itself, and an element taken out of the page drops out of full
// screen. body.rr-fs is the layout (only the board, the whole window) while the request is pending, when it is refused (said
// nowhere: the layout is the mode) and on a phone, which gets the layout only. Nothing is kept: full screen is per visit ----------
const FS = { card: null, last: null, at: 0 };
const fsView = () => document.getElementById("view");
/** the board's Full screen control; in full screen the same control, pressed, reads Exit full screen */
function fsToggle(card) {
  const on = FS.card === card;
  return h("button", { type: "button", class: `rr-fs-btn${on ? " on" : ""}`, "data-fs-toggle": card, "aria-pressed": String(on), "aria-keyshortcuts": "F",
    title: on ? T("Exit full screen (Esc or F)", "離開全螢幕（Esc 或 F）") : T("Full screen: only the board (F)", "全螢幕：只留下白板（F）"), onclick: () => (on ? exitFs() : enterFs(card)) },
    ic(on ? "shrink" : "expand"), h("span", {}, on ? T("Exit full screen", "離開全螢幕") : T("Full screen", "全螢幕")));
}
/** the camera re-fitted once the new size is laid out (the scene regions are drawn for the new width anew) */
const fsRefit = (card) => requestAnimationFrame(() => { if (onRoom(card)) BOARD.refit(card); });
const isFs = () => FS.card != null;
const fsFocus = () => requestAnimationFrame(() => document.querySelector("[data-fs-toggle]")?.focus({ preventScroll: true }));
function enterFs(card) {
  if (FS.card != null || !onRoom(card) || !document.querySelector("[data-board]")) return;
  BOARD.fitMark(card); FS.card = card; FS.last = card; document.body.classList.add("rr-fs"); render(); fsRefit(card); fsFocus();
  // true full screen where the window can have it; a phone keeps the layout only. A refusal leaves the layout as it is
  const v = fsView();
  if (innerWidth > 760 && v?.requestFullscreen && !document.fullscreenElement) try { Promise.resolve(v.requestFullscreen({ navigationUI: "hide" })).catch(() => {}); } catch {}
}
function exitFs(focus = true) {
  const card = FS.card; if (card == null) return; FS.card = null; FS.at = performance.now(); document.body.classList.remove("rr-fs");
  if (document.fullscreenElement) try { Promise.resolve(document.exitFullscreen()).catch(() => {}); } catch {}
  if (onRoom(card)) { render(); fsRefit(card); if (focus) fsFocus(); }
}
// the browser's own exit (its Esc, its menu) comes back to the room; any change of size re-fits the camera
document.addEventListener("fullscreenchange", () => {
  if (FS.card != null && !document.fullscreenElement) return exitFs();
  // granted after the captain left full screen (or the room) while the request was pending: undone at once
  if (FS.card == null && document.fullscreenElement && document.fullscreenElement === fsView()) { try { Promise.resolve(document.exitFullscreen()).catch(() => {}); } catch {} return; }
  const card = FS.card ?? FS.last; if (card != null && onRoom(card)) { render(); fsRefit(card); }
});
let fsResized = 0; addEventListener("resize", () => { if (FS.card == null && performance.now() - FS.at > 1500) return; clearTimeout(fsResized); fsResized = setTimeout(() => { const card = FS.card ?? FS.last; if (card != null && onRoom(card)) fsRefit(card); }, 160); });
// leaving the room leaves full screen
addEventListener("hashchange", () => { if (FS.card != null && !onRoom(FS.card)) exitFs(false); });
// the keyboard: the board's own (← → n p a point of a scene being played, else a region; a Space tap plays or pauses, held it
// pans; + − 0 zoom), f full screen, Escape closes what is open over the room (then full screen)
addEventListener("keydown", (e) => {
  if (S.route?.name !== "room" || !S.route.arg || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const card = S.route.arg, t = e.target;
  // the lesson board's own keys first (a chapter on or back, ask here, zoom, Escape closes what it opened)
  // the board's keys are off while the tutor picker is open (its Escape closes the picker, its arrows stay in it)
  if (!RR.zoom && !RR.cite.has(card) && !RR.drawer.has(card) && RR.tutorMenu !== card && !(e.key === "Escape" && RR.explain.has(card)) && BOARD.keydown(e, card)) return;
  if (e.key === "Escape") { if (RR.explain.has(card)) RR.explain.delete(card); else if (RR.zoom) RR.zoom = null; else if (RR.tutorMenu === card) { RR.tutorMenu = null; e.preventDefault(); rerender(); requestAnimationFrame(() => document.querySelector("[data-tutor-open]")?.focus({ preventScroll: true })); return; } else if (RR.cite.has(card)) RR.cite.delete(card); else if (RR.drawer.has(card)) RR.drawer.delete(card); else if (FS.card === card) { e.preventDefault(); exitFs(); return; } else return; e.preventDefault(); rerender(); return; }
  if (t?.closest?.("input,textarea,select,[contenteditable],[role=dialog]") || RR.zoom) return;
  if ((e.key === "f" || e.key === "F") && !e.repeat && document.querySelector("[data-fs-toggle]")) { e.preventDefault(); if (FS.card === card) exitFs(); else enterFs(card); }
});
// the board, built with the room's own helpers (public/review-board.js)
const BOARD = window.crewReviewBoard({ RR, clip, plain, inline, inferenceBadge, reviewerBadge, openCite, postJ, api, enc, rerender, redraw, onRoom, chapterName, reportFigure, diffPre, localTurn, roomLang, autoNote, reduceMotion, uiLang, POINTS_TONE, schedule, githubDiffUrl, fsToggle,
  sceneCard, sceneLabel, sceneHead, playBar, readyChip, stepReveal, togglePlay, stopPlay, markMoved, revealOf, isFs,
  stepOf, stepBtn, focusOf, stepDetail, zoomFocus, isCode, codeRefs, explainBox, fallbackVisual });
routes.room = (arg) => {
  if (!arg) { if (!RR.list) { RR.list = { rooms: [], loading: true }; api("/api/review-room").then((j) => { RR.list = { rooms: j.rooms || [], settings: j.settings || null, tutors: j.tutors || [] }; }).catch((e) => { RR.list = { rooms: [], error: e.message }; }).finally(() => { if (S.route?.name === "room" && !S.route.arg) render(); }); }
    else if (!RR.list.loading && !RR.list.fresh) { RR.list.fresh = true; api("/api/review-room").then((j) => { RR.list = { rooms: j.rooms || [], settings: j.settings || null, tutors: j.tutors || [], fresh: true }; if (S.route?.name === "room" && !S.route.arg) render(); }).catch(() => {}); }
    const rooms = RR.list.rooms || [];
    return page(T("Review room", "審查室"), T("Open a review room from a merge card, from a Task whose branch passed Studio's review, or paste a pull request's URL or a GitHub directory's.", "可以從合併卡、從通過 Studio 審查的任務分支開啟審查室，或貼上 pull request 或 GitHub 目錄的網址。"),
      h("section", { class: "card x-pad", "data-room-list": rooms.length, "data-room-list-loading": RR.list.loading ? "" : null }, h("h2", {}, T("Your review rooms", "你的審查室")),
        RR.list.loading ? h("p", { class: "faint" }, T("Loading…", "載入中…")) : rooms.length ? h("ul", { class: "rr-roomlist" }, rooms.map((x) => h("li", {},
          h("a", { href: `#/room/${enc(x.id)}`, "data-room-link": x.id }, h("b", {}, T(x.title, x.titleZh || x.title))), " ",
          h("span", { class: `rr-pill${x.open ? " ok" : ""}` }, x.running ? T("a turn is running", "有一回合在跑") : x.open ? T("open", "開啟中") : T("read-only", "唯讀")),
          h("span", { class: "faint" }, ` · ${T(`${x.turns} answer${x.turns === 1 ? "" : "s"}`, `${x.turns} 個回答`)} · ${String(x.updatedAt).slice(0, 16).replace("T", " ")}`)))) : h("p", { class: "faint" }, T("No review room yet.", "還沒有審查室。"))),
      h("section", { class: "card x-pad", "data-review-home": "" }, prBox("home", null), tutorDefault(),
        h("label", { class: "rr-imgopt" }, h("input", { type: "checkbox", "data-auto-global": "", checked: RR.list?.settings?.autoTeach !== false, onchange: async (e) => { const on = e.target.checked; try { const st = await postJ("/api/review-room/settings", { autoTeach: on }); dropPasteOffers(); if (RR.list) RR.list.settings = st; } catch (er) { PR.err.set("home", er.message); } rerenderAny(); } }),
          h("span", {}, T("Analyse a room by itself when you arrive: opening any review room (from a merge card, a Task, this list) or pasting a pull request starts its full analysis (one paid round on the room's tutor, with the room's pictures setting; the room and the paste box say which), once per head.", "一進審查室就自動完整分析：從合併卡、任務或這個清單打開任何審查室，或貼上 pull request，都會開始完整分析（用房間的導師付費一回合，圖片依房間設定；審查室和貼上框會先說明），每個 head 只一次。"))))); }
  const r = RR.rooms.get(arg);
  if (!r) { load(arg, true); return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad faint" }, T("Loading…", "載入中…"))); }
  if (r.error) return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad rr-err", "data-room-error": "" }, r.error));
  // a scene that arrives while the page is open is played point by point; scenes already there show whole
  const scenes = scenesOf(r), seen = RR.seen.get(arg);
  if (!seen) RR.seen.set(arg, new Set(scenes.filter((s) => !s.t || s.t.status !== "running").map((s) => s.key)));
  // an answer of several scenes (a lesson's chapters) arrives at once: the board flies to its first, the rest wait in order
  else { const took = new Set(); for (const sc of scenes) if (!seen.has(sc.key) && (!sc.t || sc.t.status === "done")) { seen.add(sc.key);
    const tk = sc.turn ?? sc.key; if (took.has(tk)) continue; took.add(tk);
    // the captain moved elsewhere while it ran: the answer waits behind "the answer is ready", never pulling the board away
    if (RR.moved.has(arg)) { if (!RR.ready.has(arg)) RR.ready.set(arg, sc.key); continue; }
    // the board flies to that answer itself (not to whatever scene happens to be last)
    RR.scene.set(arg, scenes.indexOf(sc)); if (sc.quiz) continue;
    // a lesson opens at its first chapter: read, not played
    if (sc.chapter && sc.t?.action === "teach") { RR.jump.set(arg, sc.key); continue; } RR.reveal.set(`${arg}/${sc.key}`, 0); queueMicrotask(() => play(arg, sc)); } }
  // entering a room while a turn runs: the board shows that turn (its progress, the scenes it made so far)
  if (!seen && r.running != null && r.running > 0) { const at = scenes.findIndex((x) => x.t?.n === r.running); if (at >= 0) RR.scene.set(arg, at); }
  if (r.running == null && RR.moved.has(arg) && !RR.ready.has(arg)) RR.moved.delete(arg);
  queueMicrotask(() => arriveIn(arg, r));
  return h("div", { class: "rr-room", "data-review-room": r.card.id },
    header(r), boardView(r), promptBar(r), drawer(r), citePanel(r),
    RR.zoom ? h("div", { class: "rr-zoom", "data-zoom": "", role: "dialog", "aria-modal": "true", "aria-label": RR.zoom.alt, onclick: (e) => { if (e.target === e.currentTarget) { RR.zoom = null; rerender(); } } },
      h("button", { type: "button", class: "btn", onclick: () => { RR.zoom = null; rerender(); } }, T("Close", "關閉")), h("img", { src: RR.zoom.src, alt: RR.zoom.alt })) : null);
};
/** Arriving in a room (any route: a merge card, a Task's link, the room list, a paste) starts its full analysis by itself when
 *  auto-teach is on and this head has none: the room says so on its welcome, and the page sends back the plan it was shown
 *  (POST …/arrive {plan}); Studio starts it only on that very plan. Once per room, head and plan on this page; a phone never. */
function arriveIn(id, r) {
  // only this Mac's captain: who is looking is known once the server said so (GET /api/remote/me; the board redraws then)
  const a = r?.arrive; if (!a?.plan || a.error || r.snapshot || !r.open || r.running != null || !onRoom(id) || BOARD.state.viewer !== "desktop") return;
  const key = `${id}@${r.head}@${a.plan}`; if (RR.arrived.has(key)) return; RR.arrived.add(key);
  postJ(`/api/review-room/${enc(id)}/arrive`, { lang: uiLang(), plan: a.plan }).then((out) => { if (out?.room?.card) RR.rooms.set(id, out.room);
      // what arriving starts changed since the page read it (a new tutor, pictures, a host): nothing started, and nothing is sent
      // again by itself; the welcome shows the new terms, and the captain starts it with "Teach me" (confirmed as usual)
      if (out?.plan?.plan) { RR.arrived.add(`${id}@${r.head}@${out.plan.plan}`); RR.err.set(id, T("What arriving starts has changed (on the welcome): nothing started. Press “Teach me” to start it.", "進來時要開始的內容變了（見開場）：什麼都沒開始。按「教我」才會開始。")); } })
    .catch((e) => RR.err.set(id, e.message)).finally(() => { redraw(id); schedule(); });
}
routes.room.focus = (arg) => (arg && RR.rooms.has(arg) && !RR.rooms.get(arg).error ? "room" : null);
window.crewReviewRoom = { parseFlow, scenesOf, curveSvg, statePlace, archPlace, board: BOARD };
})();
