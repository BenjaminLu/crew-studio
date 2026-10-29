// A figure the review room's tutor composes itself (workflows/skills/diagram-design, workflows/skills/baton): an SVG it writes,
// which Studio never puts on the page as markup. Studio parses it into a tree of allowed elements and attributes (everything
// else is dropped and reported), keeps colours only as the room's palette tokens, and runs a geometric gate: no label on
// another label, no label crossing a line, no connector through a box that is not one of its ends, nothing outside the
// picture, no Chinese text under 12px, every label in three languages. The page rebuilds the tree with createElementNS,
// setAttribute and textContent: no innerHTML, no script, no link, no style, no external reference.

export type FigNode = { t: string; a: Record<string, string>; c: (FigNode | string)[] };
export type FigResult = { tree: FigNode | null; stripped: string[]; errors: string[]; nodes: string[]; edges: string[] };

/** the palette a figure may use: the room maps each token to its light and dark colours */
export const FIG_TOKENS = ["paper", "card", "card-2", "ink", "muted", "soft", "rule", "rule-strong", "accent", "accent-tint", "ok", "ok-tint", "amber", "amber-tint", "seal", "seal-tint", "link"] as const;
export const FIG_LIMITS = { bytes: 80_000, elements: 900, depth: 12, text: 120, view: 2400, minCjk: 12, points: 40_000, margin: 40 } as const;
const ELEMENTS = new Set(["svg", "g", "rect", "path", "line", "polyline", "polygon", "circle", "ellipse", "text", "tspan", "marker", "defs", "title", "desc"]);
const NUM = /^-?\d{1,5}(\.\d{1,4})?$/, COLOR = new RegExp(`^(none|transparent|var\\(--fig-(${FIG_TOKENS.join("|")})\\))$`), ID = /^[A-Za-z][\w-]{0,60}$/;
const SAY = /^[^<>]{0,160}$/;
const ATTRS: Record<string, (v: string, t: string) => boolean> = {
  id: (v) => ID.test(v), role: (v) => /^(img|presentation|button)$/.test(v), "aria-label": (v) => SAY.test(v), "aria-labelledby": (v) => /^[\w -]{1,120}$/.test(v),
  "data-node": (v) => /^[\w.-]{1,60}$/.test(v), "data-edge": (v) => /^[\w.-]{1,60}>[\w.-]{1,60}(#\d{1,2})?$/.test(v), "data-cite": (v) => /^(diff|ledger|commit|source|review):[^\s<>"]{1,300}$/.test(v),
  "data-en": (v) => SAY.test(v), "data-hant": (v) => SAY.test(v), "data-hans": (v) => SAY.test(v), "data-kind": (v) => /^[a-z-]{1,24}$/.test(v),
  fill: (v) => COLOR.test(v), stroke: (v) => COLOR.test(v), "stroke-width": (v) => NUM.test(v), "stroke-dasharray": (v) => /^[\d.]+([ ,]+[\d.]+){0,5}$/.test(v),
  "stroke-linecap": (v) => /^(butt|round|square)$/.test(v), "stroke-linejoin": (v) => /^(miter|round|bevel)$/.test(v), opacity: (v) => NUM.test(v), "fill-opacity": (v) => NUM.test(v), "stroke-opacity": (v) => NUM.test(v),
  "font-size": (v) => NUM.test(v), "font-weight": (v) => /^(400|500|600|700|normal|bold)$/.test(v), "font-family": (v) => /^var\(--fig-(sans|mono|serif)\)$/.test(v), "font-style": (v) => /^(normal|italic)$/.test(v),
  "text-anchor": (v) => /^(start|middle|end)$/.test(v), "dominant-baseline": (v) => /^(auto|middle|central|hanging)$/.test(v), "letter-spacing": (v) => /^-?[\d.]{1,6}(em|px)?$/.test(v),
  "marker-start": (v) => /^url\(#[A-Za-z][\w-]{0,60}\)$/.test(v), "marker-mid": (v) => /^url\(#[A-Za-z][\w-]{0,60}\)$/.test(v), "marker-end": (v) => /^url\(#[A-Za-z][\w-]{0,60}\)$/.test(v),
  x: (v) => NUM.test(v), y: (v) => NUM.test(v), dx: (v) => NUM.test(v), dy: (v) => NUM.test(v), width: (v, t) => t !== "svg" && NUM.test(v), height: (v, t) => t !== "svg" && NUM.test(v),
  rx: (v) => NUM.test(v), ry: (v) => NUM.test(v), cx: (v) => NUM.test(v), cy: (v) => NUM.test(v), r: (v) => NUM.test(v), x1: (v) => NUM.test(v), y1: (v) => NUM.test(v), x2: (v) => NUM.test(v), y2: (v) => NUM.test(v),
  points: (v) => v.length <= 2000 && /^[-\d.,\s]+$/.test(v), d: (v) => v.length <= 6000 && /^[MmLlHhVvCcSsQqTtAaZz\d.,\s-]+$/.test(v),
  transform: (v, t) => t === "g" && /^translate\(\s*-?\d{1,5}(\.\d+)?(\s*[ ,]\s*-?\d{1,5}(\.\d+)?)?\s*\)$/.test(v),
  viewBox: (v) => /^-?\d{1,5}(\.\d+)?([ ,]+-?\d{1,5}(\.\d+)?){3}$/.test(v),
  markerWidth: (v) => NUM.test(v), markerHeight: (v) => NUM.test(v), refX: (v) => NUM.test(v), refY: (v) => NUM.test(v), orient: (v) => /^(auto|auto-start-reverse|-?\d{1,3})$/.test(v), markerUnits: (v) => /^(strokeWidth|userSpaceOnUse)$/.test(v),
};
const COLOR_ATTRS = new Set(["fill", "stroke"]);
const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,5});/gi, (m, e) => e[0] === "#" ? (() => { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; })() : ENT[e.toLowerCase()] ?? m);

/** Parse and sanitise. Elements and attributes off the allowlist are dropped (and listed); a colour that is not one of the
 *  room's tokens, markup Studio cannot read, or a figure over its size caps is an error. */
export function sanitizeFigure(src: unknown): FigResult {
  const out: FigResult = { tree: null, stripped: [], errors: [], nodes: [], edges: [] };
  const s = String(src ?? "");
  if (!s.trim()) { out.errors.push("svg is required"); return out; }
  if (s.length > FIG_LIMITS.bytes) { out.errors.push(`the figure is ${s.length} characters: at most ${FIG_LIMITS.bytes}`); return out; }
  if (/<!DOCTYPE|<!\[CDATA\[|<\?/i.test(s)) { out.errors.push("no DOCTYPE, CDATA or processing instruction"); return out; }
  const src2 = s.replace(/<!--[\s\S]*?-->/g, "");
  const stack: FigNode[] = [{ t: "#root", a: {}, c: [] }], drop: number[] = []; let count = 0, i = 0;
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  while (i < src2.length) {
    const lt = src2.indexOf("<", i);
    const text = src2.slice(i, lt < 0 ? src2.length : lt);
    if (text.trim() && !drop.length) { const top = stack[stack.length - 1]; if (top.t === "text" || top.t === "tspan" || top.t === "title" || top.t === "desc") top.c.push(decode(text).replace(/\s+/g, " ").slice(0, FIG_LIMITS.text)); }
    if (lt < 0) break;
    tag.lastIndex = lt; const m = tag.exec(src2);
    if (!m) { out.errors.push(`unreadable markup near character ${lt}`); return out; }
    i = tag.lastIndex; const close = !!m[1], name = m[2], self = !!m[4];
    if (close) {
      if (drop.length) { drop.pop(); continue; } // the end of something dropped (or of an element inside it)
      const top = stack.pop(); if (!top || top.t !== name) { out.errors.push(`</${name}> does not close <${top?.t ?? "nothing"}>`); return out; } continue; }
    if (drop.length) { if (!self) drop.push(stack.length); continue; }
    if (!ELEMENTS.has(name)) { out.stripped.push(`<${name}>`); if (!self) drop.push(stack.length); continue; }
    if (++count > FIG_LIMITS.elements) { out.errors.push(`at most ${FIG_LIMITS.elements} elements`); return out; }
    if (stack.length > FIG_LIMITS.depth) { out.errors.push(`nested at most ${FIG_LIMITS.depth} deep`); return out; }
    const node: FigNode = { t: name, a: {}, c: [] };
    for (const am of m[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g)) {
      const k = am[1], v = decode(am[2] ?? am[3] ?? "").trim();
      if (k === "xmlns" || k === "xmlns:xlink" || k === "version") continue;
      const ok = ATTRS[k];
      if (!ok || !ok(v, name)) { if (COLOR_ATTRS.has(k)) out.errors.push(`${name} ${k}="${v.slice(0, 40)}": colours are only the room's tokens, var(--fig-${FIG_TOKENS.slice(0, 4).join(" | ")} | …)`); else out.stripped.push(`${name} ${k}`); continue; }
      node.a[k] = v; }
    stack[stack.length - 1].c.push(node);
    if (!self) stack.push(node);
  }
  if (stack.length !== 1) { out.errors.push(`<${stack[stack.length - 1].t}> is not closed`); return out; }
  const root = stack[0].c.find((x): x is FigNode => typeof x !== "string");
  if (!root || root.t !== "svg" || stack[0].c.filter((x) => typeof x !== "string").length !== 1) { out.errors.push("one <svg> element, nothing around it"); return out; }
  if (!root.a.viewBox) { out.errors.push("the <svg> has a viewBox"); return out; }
  const [, , vw, vh] = root.a.viewBox.split(/[ ,]+/).map(Number);
  if (!(vw > 0 && vh > 0 && vw <= FIG_LIMITS.view && vh <= FIG_LIMITS.view)) { out.errors.push(`the viewBox is at most ${FIG_LIMITS.view} × ${FIG_LIMITS.view}`); return out; }
  // a marker reference names a marker of this figure
  const ids = new Set<string>(), markers = new Set<string>();
  const walk = (n: FigNode, f: (n: FigNode) => void) => { f(n); for (const c of n.c) if (typeof c !== "string") walk(c, f); };
  walk(root, (n) => { if (n.a.id) ids.add(n.a.id); if (n.t === "marker" && n.a.id) markers.add(n.a.id); });
  walk(root, (n) => { for (const k of ["marker-start", "marker-mid", "marker-end"]) { const v = n.a[k]; if (v && !markers.has(v.slice(5, -1))) { delete n.a[k]; out.stripped.push(`${n.t} ${k} (no such marker)`); } }
    if (n.a["data-node"]) out.nodes.push(n.a["data-node"]); if (n.a["data-edge"]) out.edges.push(n.a["data-edge"]); });
  out.tree = root; return out;
}

// ---------- the geometric gate ----------
type Box = { x: number; y: number; w: number; h: number };
const CJK_CH = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]|[\ud840-\ud87f][\udc00-\udfff]/;
const textWidth = (s: string, fs: number) => [...s].reduce((n, ch) => n + (CJK_CH.test(ch) ? 1 : 0.6) * fs, 0);
const inside = (p: [number, number], b: Box, inset: number) => p[0] > b.x + inset && p[0] < b.x + b.w - inset && p[1] > b.y + inset && p[1] < b.y + b.h - inset;
const overlap = (a: Box, b: Box, inset: number) => a.x + inset < b.x + b.w - inset && a.x + a.w - inset > b.x + inset && a.y + inset < b.y + b.h - inset && a.y + a.h - inset > b.y + inset;
const nums = (s: string) => (s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);

/** the gate stops: a figure too big to check, or drawing outside its picture */
export class FigureStop extends Error {}
/** what a figure's checking may spend: points left to sample, and the picture's bounds (plus a margin) every coordinate keeps to */
export type FigureBudget = { left: number; box?: { x: number; y: number; w: number; h: number }; ox?: number; oy?: number };
const within = (lim: FigureBudget | undefined, ...xy: number[]) => { if (!lim?.box) return; const m = FIG_LIMITS.margin, b = lim.box;
  for (let k = 0; k + 1 < xy.length; k += 2) { const x = xy[k] + (lim.ox ?? 0), y = xy[k + 1] + (lim.oy ?? 0);
    if (!(x >= b.x - m && x <= b.x + b.w + m && y >= b.y - m && y <= b.y + b.h + m)) throw new FigureStop(`a coordinate (${Math.round(x)}, ${Math.round(y)}) lies outside the viewBox: draw inside it`); } };
const spend = (lim: FigureBudget | undefined, n: number) => { if (!lim) return; lim.left -= n; if (lim.left < 0) throw new FigureStop(`the figure has too much line to check (over ${FIG_LIMITS.points} sample points): draw fewer or shorter connectors`); };
/** points along a path's d (lines, curves and arcs sampled; arcs approximated by their chord's bulge). With a budget, every
 *  coordinate is checked against the picture and every sample paid for before it is made. */
export function pathPoints(d: string, step = 4, lim?: FigureBudget): [number, number][] {
  const pts: [number, number][] = []; let x = 0, y = 0, sx = 0, sy = 0, px = 0, py = 0;
  const seg = (x0: number, y0: number, f: (t: number) => [number, number], len: number) => { const n = Math.max(2, Math.ceil(len / step)); spend(lim, n); for (let k = 1; k <= n; k++) pts.push(f(k / n)); };
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g; let m: RegExpExecArray | null;
  while ((m = re.exec(d))) { const c = m[1], a = nums(m[2]), rel = c === c.toLowerCase() && c !== "z" && c !== "Z"; let C = c.toUpperCase();
    let i = 0; const take = (n: number) => { const v = a.slice(i, i + n); i += n; return v; };
    do {
      if (C === "Z") { const x0 = x, y0 = y; seg(x0, y0, (t) => [x0 + (sx - x0) * t, y0 + (sy - y0) * t], Math.hypot(sx - x0, sy - y0)); x = sx; y = sy; break; }
      if (C === "M") { const [nx, ny] = take(2); if (nx === undefined) break; x = rel ? x + nx : nx; y = rel ? y + ny : ny; within(lim, x, y); spend(lim, 1); sx = x; sy = y; pts.push([x, y]); C = "L"; continue; } // pairs after a moveto are linetos
      if (C === "L" || C === "T") { const [nx, ny] = take(2); if (ny === undefined) break; const x0 = x, y0 = y, x1 = rel ? x + nx : nx, y1 = rel ? y + ny : ny; within(lim, x1, y1); seg(x0, y0, (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], Math.hypot(x1 - x0, y1 - y0)); x = x1; y = y1; continue; }
      if (C === "H") { const [nx] = take(1); if (nx === undefined) break; const x0 = x, x1 = rel ? x + nx : nx; within(lim, x1, y); seg(x0, y, (t) => [x0 + (x1 - x0) * t, y], Math.abs(x1 - x0)); x = x1; continue; }
      if (C === "V") { const [ny] = take(1); if (ny === undefined) break; const y0 = y, y1 = rel ? y + ny : ny; within(lim, x, y1); seg(x, y0, (t) => [x, y0 + (y1 - y0) * t], Math.abs(y1 - y0)); y = y1; continue; }
      if (C === "Q" || C === "S") { const v = take(4); if (v.length < 4) break; const [qx, qy, ex, ey] = rel ? [x + v[0], y + v[1], x + v[2], y + v[3]] : v; within(lim, qx, qy, ex, ey); const x0 = x, y0 = y;
        seg(x0, y0, (t) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * qx + t * t * ex, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * qy + t * t * ey], Math.hypot(qx - x0, qy - y0) + Math.hypot(ex - qx, ey - qy)); x = ex; y = ey; px = qx; py = qy; continue; }
      if (C === "C") { const v = take(6); if (v.length < 6) break; const [ax, ay, bx, by, ex, ey] = rel ? [x + v[0], y + v[1], x + v[2], y + v[3], x + v[4], y + v[5]] : v; within(lim, ax, ay, bx, by, ex, ey); const x0 = x, y0 = y;
        seg(x0, y0, (t) => { const u = 1 - t; return [u ** 3 * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * ex, u ** 3 * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * ey]; }, Math.hypot(ax - x0, ay - y0) + Math.hypot(bx - ax, by - ay) + Math.hypot(ex - bx, ey - by)); x = ex; y = ey; continue; }
      if (C === "A") { const v = take(7); if (v.length < 7) break; const ex = rel ? x + v[5] : v[5], ey = rel ? y + v[6] : v[6]; within(lim, ex, ey); const x0 = x, y0 = y, r = Math.min(v[0], v[1]), dx = ex - x0, dy = ey - y0, L = Math.hypot(dx, dy) || 1, bulge = Math.min(r, L / 2) * (v[4] ? 1 : -1);
        seg(x0, y0, (t) => [x0 + dx * t - (dy / L) * bulge * Math.sin(Math.PI * t), y0 + dy * t + (dx / L) * bulge * Math.sin(Math.PI * t)], L * 1.6); x = ex; y = ey; continue; }
      break;
    } while (i < a.length);
    void px; void py; }
  return pts;
}

/** The gate: every problem found, each saying where, so the tutor redraws. Bounded: every coordinate inside the picture
 *  (plus a margin), at most FIG_LIMITS.points sample points in all, the label-against-line scan only where their boxes meet. */
export function figureGate(root: FigNode, opts: { langs?: boolean } = {}): string[] {
  const errs: string[] = [], [vx, vy, vw, vh] = root.a.viewBox.split(/[ ,]+/).map(Number), lim: FigureBudget = { left: FIG_LIMITS.points, box: { x: vx, y: vy, w: vw, h: vh } };
  const texts: { box: Box; say: string; i: number }[] = [], nodes: { id: string; box: Box }[] = [], lines: { pts: [number, number][]; edge: string | null; i: number; bb: Box }[] = [];
  let ti = 0, li = 0;
  const num = (v: string | undefined) => Number(v ?? 0) || 0, strs = (n: FigNode): string => n.c.map((c) => (typeof c === "string" ? c : strs(c))).join("");
  // one label (a text, or a line of it: a tspan): measured at its own place, in each of its languages
  const label = (n: FigNode, x: number, y: number, fs: number, anchor: string, base: string, own: string) => {
    const says = [own, n.a["data-en"], n.a["data-hant"], n.a["data-hans"]].filter((s): s is string => !!s && !!s.trim());
    if (!says.length) return 0;
    const widest = says.reduce((w, s) => Math.max(w, textWidth(s, fs)), 0);
    const left = anchor === "middle" ? x - widest / 2 : anchor === "end" ? x - widest : x, top = base === "middle" || base === "central" ? y - fs * 0.5 : base === "hanging" ? y : y - fs * 0.8;
    const box = { x: left, y: top, w: widest, h: fs }, say = (own || says[0] || "").slice(0, 30);
    texts.push({ box, say, i: ti++ });
    if (says.some((s) => CJK_CH.test(s)) && fs < FIG_LIMITS.minCjk) errs.push(`text "${say}" is ${fs}px: Chinese text is at least ${FIG_LIMITS.minCjk}px`);
    if (box.x < vx - 1 || box.y < vy - 1 || box.x + box.w > vx + vw + 1 || box.y + box.h > vy + vh + 1) errs.push(`text "${say}" runs outside the viewBox`);
    if (opts.langs !== false && /\p{L}/u.test(own) && !(n.a["data-en"] && n.a["data-hant"] && n.a["data-hans"])) errs.push(`text "${say}" needs data-en, data-hant and data-hans (the page switches language with them)`);
    return anchor === "start" ? widest : 0; };
  const visit = (n: FigNode, ox: number, oy: number, inh: { fs: number; anchor: string; base: string }, hidden: boolean) => {
    let dx = 0, dy = 0; if (n.a.transform) { const v = nums(n.a.transform); dx = v[0] ?? 0; dy = v[1] ?? 0; }
    const X = ox + dx, Y = oy + dy, fs = Number(n.a["font-size"] ?? inh.fs), anchor = n.a["text-anchor"] ?? inh.anchor, base = n.a["dominant-baseline"] ?? inh.base;
    const hide = hidden || n.t === "defs" || n.t === "marker" || n.t === "title" || n.t === "desc";
    if (!hide) { lim.ox = X; lim.oy = Y;
      if (n.t === "rect") within(lim, num(n.a.x), num(n.a.y), num(n.a.x) + num(n.a.width), num(n.a.y) + num(n.a.height));
      else if (n.t === "circle" || n.t === "ellipse") { const rx = num(n.a.r ?? n.a.rx), ry = num(n.a.r ?? n.a.ry); within(lim, num(n.a.cx) - rx, num(n.a.cy) - ry, num(n.a.cx) + rx, num(n.a.cy) + ry); }
      else if (n.t === "line") within(lim, num(n.a.x1), num(n.a.y1), num(n.a.x2), num(n.a.y2));
      else if (n.t === "polygon" || n.t === "polyline") within(lim, ...nums(n.a.points ?? "")); }
    if (!hide && n.t === "text") {
      // a text is its own words at its x/y, and each tspan a line of its own at its x/y (else where the last one ended) moved by dx/dy
      let cx = X + num(n.a.x) + num(n.a.dx), cy = Y + num(n.a.y) + num(n.a.dy);
      const direct = n.c.filter((c): c is string => typeof c === "string").join("").trim(), spans = n.c.filter((c): c is FigNode => typeof c !== "string" && c.t === "tspan");
      if (!spans.length || direct || n.a["data-en"]) cx += label(n, cx, cy, fs, anchor, base, spans.length ? direct : strs(n).trim());
      for (const t of spans) { const tfs = Number(t.a["font-size"] ?? fs), ta = t.a["text-anchor"] ?? anchor, tb = t.a["dominant-baseline"] ?? base;
        const x = (t.a.x != null ? X + num(t.a.x) : cx) + num(t.a.dx), y = (t.a.y != null ? Y + num(t.a.y) : cy) + num(t.a.dy);
        cx = x + label(t, x, y, tfs, ta, tb, strs(t).trim()); cy = y; }
      return; }
    if (!hide && n.a["data-node"]) { let b: Box | null = null;
      if (n.t === "rect") b = { x: X + num(n.a.x), y: Y + num(n.a.y), w: num(n.a.width), h: num(n.a.height) };
      else if (n.t === "circle") { const r = num(n.a.r); b = { x: X + num(n.a.cx) - r, y: Y + num(n.a.cy) - r, w: 2 * r, h: 2 * r }; }
      else if (n.t === "ellipse") { const rx = num(n.a.rx), ry = num(n.a.ry); b = { x: X + num(n.a.cx) - rx, y: Y + num(n.a.cy) - ry, w: 2 * rx, h: 2 * ry }; }
      else if (n.t === "polygon" || n.t === "path") { const v = n.t === "polygon" ? nums(n.a.points ?? "") : pathPoints(n.a.d ?? "", 8, lim).flat(); const xs = v.filter((_, k) => k % 2 === 0), ys = v.filter((_, k) => k % 2 === 1);
        if (xs.length) b = { x: X + Math.min(...xs), y: Y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
      if (b && b.w > 0 && b.h > 0) nodes.push({ id: n.a["data-node"], box: b }); }
    // a connector: a line, a polyline, or a path that is not a closed filled shape (an open path is a line whatever its fill)
    const shape = n.t === "path" && /[Zz]/.test(n.a.d ?? "") && n.a.fill !== "none" && n.a.fill !== "transparent";
    const isLine = !hide && !n.a["data-node"] && (n.t === "line" || n.t === "polyline" || (n.t === "path" && !shape));
    if (isLine) { let pts: [number, number][] = [];
      if (n.t === "line") { const x1 = num(n.a.x1), y1 = num(n.a.y1), x2 = num(n.a.x2), y2 = num(n.a.y2), L = Math.hypot(x2 - x1, y2 - y1), k = Math.max(2, Math.ceil(L / 4)); spend(lim, k + 1); for (let j = 0; j <= k; j++) pts.push([x1 + ((x2 - x1) * j) / k, y1 + ((y2 - y1) * j) / k]); }
      else if (n.t === "polyline") { const v = nums(n.a.points ?? ""); pts = pathPoints(`M${v.slice(0, 2).join(",")}${v.length > 2 ? " L" + v.slice(2).join(",") : ""}`, 4, lim); }
      else pts = pathPoints(n.a.d ?? "", 4, lim);
      const abs = pts.map(([a, b]): [number, number] => [a + X, b + Y]), xs = abs.map((p) => p[0]), ys = abs.map((p) => p[1]);
      if (abs.length) lines.push({ pts: abs, edge: n.a["data-edge"]?.replace(/#\d+$/, "") ?? null, i: li++, bb: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } }); }
    for (const c of n.c) if (typeof c !== "string") visit(c, X, Y, { fs, anchor, base }, hide);
  };
  try { visit(root, 0, 0, { fs: 16, anchor: "start", base: "auto" }, false); }
  catch (e) { if (e instanceof FigureStop) return [e.message]; throw e; }
  const meets = (a: Box, b: Box, pad: number) => a.x - pad <= b.x + b.w && a.x + a.w + pad >= b.x && a.y - pad <= b.y + b.h && a.y + a.h + pad >= b.y;
  for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) if (overlap(texts[a].box, texts[b].box, 1)) errs.push(`text "${texts[a].say}" overlaps text "${texts[b].say}"`);
  for (const t of texts) for (const l of lines) if (meets(t.box, l.bb, 2) && l.pts.some((p) => inside(p, t.box, 1.5))) { errs.push(`text "${t.say}" sits on a line (move it 6–10px off its connector)`); break; }
  for (const l of lines) { if (l.pts.length < 2) continue;
    const ends = l.edge ? l.edge.split(">") : nodes.filter((nd) => [l.pts[0], l.pts[l.pts.length - 1]].some((p) => inside(p, { x: nd.box.x - 8, y: nd.box.y - 8, w: nd.box.w + 16, h: nd.box.h + 16 }, 0))).map((nd) => nd.id);
    for (const nd of nodes) { if (ends.includes(nd.id) || !meets(nd.box, l.bb, 0)) continue; if (l.pts.some((p) => inside(p, nd.box, 2))) { errs.push(`a connector${l.edge ? ` (${l.edge})` : ""} passes through "${nd.id}", which is not one of its ends: route it around`); } } }
  return [...new Set(errs)].slice(0, 30);
}
