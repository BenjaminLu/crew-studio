// The workflow graph's layout: a layered (Sugiyama-style) left-to-right layout with
// back edges as arcs outside the node band, stage boxes, routed edges and placed
// labels. No dependency; the page and the tests both load it (globalThis.crewLayout).
//   crewLayout.layout(def, { collapsed })  the auto layout
//   crewLayout.place(def, opts)            the same geometry around the definition's own (dragged) positions
//   crewLayout.manual(def)                 the old hand layout's shapes (for measuring crossings)
//   crewLayout.sample(edge, n), crewLayout.crossings(g), crewLayout.stagesFor(def)
// docs/units/graph-tidy.md has the algorithm.
(function () {
  const NW = 150, NH = 52, SW = 150, SH = 60;
  const COL = 230, ROW = 96, GAP = COL - NW;
  const PAD = 18, TITLE = 26, ARC0 = 30, ARC_STEP = 20, LANE = 6, BAND_GAP = 70;
  const CH = 5.9, LH = 14; // label character width and height (10 px text)

  // the stages of the built-in workflows; a node may also name its own `stage`
  const BUILTIN = {
    // code-firstmate: the scope card sits with the spec; every blocked round (spec, plan, build, review) escalates to it and it leads back to the spec
    "code-firstmate": [
      { id: "intake", label: "Intake", label_tw: "接收", nodes: ["intake", "prepare", "spec", "spec-fix", "dispatch", "scope-card"] },
      { id: "door", label: "Door", label_tw: "門", nodes: ["door", "door-pick"] },
      { id: "plan", label: "Plan (one-way)", label_tw: "計畫（單向）", nodes: ["plan", "plan-fix", "plan-accept"] },
      { id: "build", label: "Build loop", label_tw: "建置迴圈", nodes: ["build", "pr-open", "ci", "review", "design-scope", "designer", "remote-ready", "fix"] },
      { id: "gates", label: "Gates", label_tw: "關卡", nodes: ["merge-card", "design-gap", "design-gap-card"] },
      { id: "merge", label: "Merge", label_tw: "合併", nodes: ["merge"] },
      { id: "after", label: "After merge", label_tw: "合併後", nodes: ["after-merge", "cleanup", "done"] },
    ],
  };
  function stagesFor(def) {
    const ids = new Set(def.nodes.map((n) => n.id));
    const own = def.nodes.filter((n) => typeof n.stage === "string" && n.stage);
    let list;
    if (own.length) { const m = new Map(); for (const n of own) { if (!m.has(n.stage)) m.set(n.stage, { id: n.stage, label: n.stage, nodes: [] }); m.get(n.stage).nodes.push(n.id); } list = [...m.values()]; }
    else list = (BUILTIN[def.id] || []).map((s) => ({ ...s, nodes: s.nodes.filter((x) => ids.has(x)) }));
    return list.filter((s) => s.nodes.length);
  }

  // A visible edge needs both ends drawn. One whose ends collapse into the same box is dropped,
  // except a real self-edge in the editable graph (its own node, not a stage).
  const keepEdge = (a, b, e, opts, has) => has(a) && has(b) && (a !== b || (!!opts.actualGraph && typeof a === "string" && a === e.from && e.from === e.to));

  // ---------- the auto layout ----------
  function layout(def, opts = {}) {
    if (!def.nodes.length) return { def: def.id, nodes: [], edges: [], stages: [], stageList: [], collapsed: [], bbox: { x: 0, y: 0, w: COL * 2, h: ROW * 2 }, NW, NH };
    const stages = stagesFor(def);
    const collapsed = new Set((opts.collapsed || []).filter((c) => stages.some((s) => s.id === c)));
    const stageOfNode = new Map(); stages.forEach((s) => s.nodes.forEach((n) => stageOfNode.set(n, s.id)));
    const rep = (id) => { const s = stageOfNode.get(id); return s && collapsed.has(s) ? `stage:${s}` : id; };
    // visible nodes, in definition order
    const vn = new Map();
    for (const n of def.nodes) { const r = rep(n.id); if (vn.has(r)) { vn.get(r).members.push(n.id); continue; }
      const st = stages.find((s) => `stage:${s.id}` === r);
      vn.set(r, st ? { id: r, kind: "stage", stage: st.id, label: st.label, members: [n.id], w: SW, h: SH } : { id: r, kind: "node", stage: stageOfNode.get(n.id) || null, ref: n, members: [n.id], w: NW, h: NH }); }
    const ids = [...vn.keys()];
    // visible edges: the definition's, between visible nodes, duplicates merged
    const ve = [];
    def.edges.forEach((e, i) => { const a = rep(e.from), b = rep(e.to); if (!keepEdge(a, b, e, opts, (x) => vn.has(x))) return;
      const same = ve.find((x) => x.from === a && x.to === b);
      if (same) { same.index.push(i); if (e.when) same.whens.push(e.when); same.checks += e.checks?.length || 0; return; }
      ve.push({ from: a, to: b, index: [i], whens: e.when ? [e.when] : [], checks: e.checks?.length || 0 }); });
    const out = new Map(ids.map((x) => [x, []])), inn = new Map(ids.map((x) => [x, []]));
    ve.forEach((e) => { out.get(e.from).push(e); inn.get(e.to).push(e); });
    // 1. an edge from a later stage into an earlier one goes back; then a depth-first walk from the entry:
    //    edges to a node on the stack are back edges too
    const sIndex = (x) => { const st = vn.get(x)?.stage; return st ? stages.findIndex((q) => q.id === st) : -1; };
    for (const e of ve) { const a = sIndex(e.from), b = sIndex(e.to); if (a >= 0 && b >= 0 && a > b) e.back = true; }
    const entry = ids.find((x) => !inn.get(x).length) ?? ids[0];
    const state = new Map(), order = new Map();
    const walk = (start) => { const stack = [[start, 0]]; state.set(start, 1); order.set(start, order.size);
      while (stack.length) { const top = stack[stack.length - 1]; const es = out.get(top[0]);
        if (top[1] >= es.length) { state.set(top[0], 2); stack.pop(); continue; }
        const e = es[top[1]++]; if (e.back) continue; const s = state.get(e.to);
        if (s === 1) e.back = true; else if (!s) { state.set(e.to, 1); order.set(e.to, order.size); stack.push([e.to, 0]); } } };
    walk(entry); for (const x of ids) if (!state.get(x)) walk(x);
    const fwd = ve.filter((e) => !e.back);
    const fout = new Map(ids.map((x) => [x, []])), fin = new Map(ids.map((x) => [x, []]));
    fwd.forEach((e) => { fout.get(e.from).push(e); fin.get(e.to).push(e); });
    // 2. ranks: longest path over forward edges, then each stage right of the one before
    const topo = []; { const deg = new Map(ids.map((x) => [x, fin.get(x).length])); const q = ids.filter((x) => !deg.get(x));
      while (q.length) { const x = q.shift(); topo.push(x); for (const e of fout.get(x)) { deg.set(e.to, deg.get(e.to) - 1); if (!deg.get(e.to)) q.push(e.to); } } }
    const rank = new Map(ids.map((x) => [x, 0]));
    const propagate = () => { for (const x of topo) for (const e of fout.get(x)) if (rank.get(e.to) < rank.get(x) + 1) rank.set(e.to, rank.get(x) + 1); };
    propagate();
    const stageOfV = (x) => vn.get(x)?.stage ?? null;
    for (let it = 0; it < 30; it++) { let changed = false, lo = 0;
      for (const s of stages) { const mem = ids.filter((x) => stageOfV(x) === s.id); if (!mem.length) continue;
        for (const x of mem) if (rank.get(x) < lo) { rank.set(x, lo); changed = true; }
        if (changed) propagate();
        lo = Math.max(...mem.map((x) => rank.get(x))) + 1; }
      if (!changed) break; }
    // 3. the main path: from the entry to the furthest end, along the latest predecessors
    const sinks = ids.filter((x) => !fout.get(x).length);
    const end = sinks.reduce((a, b) => (rank.get(b) > rank.get(a) ? b : a), sinks[0] ?? entry);
    // the main lane follows the success edges (no label, ok, pass, accept, …) back from the end, else the latest predecessor
    const OK = ["", "ok", "pass", "two-way", "dispatch", "merge", "accept", "approved", "done"];
    const pref = (e) => { const w = e.whens.length ? e.whens[0] : ""; const k = OK.indexOf(w); return k < 0 ? 99 : k; };
    const main = new Set([end]), mainEdges = new Set();
    for (let x = end, guard = 0; x !== entry && fin.get(x).length && guard < 500; guard++) {
      const e = fin.get(x).slice().sort((a, b) => pref(a) - pref(b) || rank.get(b.from) - rank.get(a.from) || order.get(a.from) - order.get(b.from))[0];
      if (main.has(e.from)) break; main.add(e.from); mainEdges.add(e); x = e.from; }
    // placeholders for forward edges longer than one column
    const dummy = new Map(); // id -> { rank, edge }
    for (const e of fwd) { e.chain = [e.from]; for (let r = rank.get(e.from) + 1; r < rank.get(e.to); r++) { const d = `~${e.from}>${e.to}#${r}`; dummy.set(d, { rank: r, edge: e }); rank.set(d, r); order.set(d, order.get(e.from) + 0.5); e.chain.push(d); if (mainEdges.has(e)) main.add(d); } e.chain.push(e.to); }
    const all = [...ids, ...dummy.keys()];
    const R = Math.max(0, ...all.map((x) => rank.get(x)));
    const layers = Array.from({ length: R + 1 }, () => []);
    all.sort((a, b) => order.get(a) - order.get(b)).forEach((x) => layers[rank.get(x)].push(x));
    const pred = new Map(all.map((x) => [x, []])), succ = new Map(all.map((x) => [x, []]));
    for (const e of fwd) for (let k = 1; k < e.chain.length; k++) { succ.get(e.chain[k - 1]).push(e.chain[k]); pred.get(e.chain[k]).push(e.chain[k - 1]); }
    // 4. order in each column: barycentre sweeps
    const pos = new Map(); const index = () => layers.forEach((l) => l.forEach((x, i) => pos.set(x, i)));
    index();
    const bary = (x, nb) => { const ps = nb.get(x).map((y) => pos.get(y)); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(x); };
    // crossings between neighbouring columns, to keep the best order and to try swaps
    const layerX = (r) => { let c = 0; const es = []; for (const x of layers[r]) for (const y of succ.get(x)) es.push([pos.get(x), pos.get(y)]);
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) if ((es[i][0] - es[j][0]) * (es[i][1] - es[j][1]) < 0) c++; return c; };
    const totalX = () => { let c = 0; for (let r = 0; r < R; r++) c += layerX(r); return c; };
    let best = totalX(), bestLayers = layers.map((l) => l.slice());
    for (let it = 0; it < 12; it++) {
      if (it % 2 === 0) for (let r = 1; r <= R; r++) { const k = new Map(layers[r].map((x) => [x, bary(x, pred)])); layers[r].sort((a, b) => k.get(a) - k.get(b)); layers[r].forEach((x, i) => pos.set(x, i)); }
      else for (let r = R - 1; r >= 0; r--) { const k = new Map(layers[r].map((x) => [x, bary(x, succ)])); layers[r].sort((a, b) => k.get(a) - k.get(b)); layers[r].forEach((x, i) => pos.set(x, i)); }
      // transpose: swap neighbours in a column while it lowers the crossings around it
      for (let r = 0; r <= R; r++) for (let i = 0; i + 1 < layers[r].length; i++) {
        const before = (r > 0 ? layerX(r - 1) : 0) + (r < R ? layerX(r) : 0);
        const l = layers[r]; [l[i], l[i + 1]] = [l[i + 1], l[i]]; pos.set(l[i], i); pos.set(l[i + 1], i + 1);
        const after = (r > 0 ? layerX(r - 1) : 0) + (r < R ? layerX(r) : 0);
        if (after >= before) { [l[i], l[i + 1]] = [l[i + 1], l[i]]; pos.set(l[i], i); pos.set(l[i + 1], i + 1); }
      }
      const c = totalX(); if (c < best) { best = c; bestLayers = layers.map((l) => l.slice()); }
    }
    bestLayers.forEach((l, r) => { layers[r] = l; }); index();
    // rows: the main lane is row 0; others keep their order around it, close to their neighbours
    const row = new Map();
    for (let r = 0; r <= R; r++) {
      const l = layers[r]; const m = l.findIndex((x) => main.has(x));
      if (m >= 0) l.forEach((x, i) => row.set(x, i - m));
      else { const want = l.map((x, i) => { const ps = pred.get(x).filter((y) => row.has(y)).map((y) => row.get(y)); return ps.length ? i - ps.reduce((a, b) => a + b, 0) / ps.length : i - (l.length - 1) / 2; }).sort((a, b) => a - b);
        const o = Math.round(want[Math.floor(want.length / 2)] ?? 0); l.forEach((x, i) => row.set(x, i - o)); }
    }
    // a stage's nodes form one block across its columns; other nodes in those columns go above or below it
    for (const s of stages) {
      const mem = ids.filter((x) => stageOfV(x) === s.id); if (!mem.length || collapsed.has(s.id)) continue;
      const rs = mem.map((x) => rank.get(x)); const r0 = Math.min(...rs), r1 = Math.max(...rs);
      const lo = Math.min(...mem.map((x) => row.get(x))), hi = Math.max(...mem.map((x) => row.get(x)));
      for (let r = r0; r <= r1; r++) {
        const others = layers[r].filter((x) => (stageOfV(x) !== s.id || dummy.has(x)) && !main.has(x));
        const above = others.filter((x) => row.get(x) < (lo + hi) / 2).sort((a, b) => row.get(b) - row.get(a));
        const below = others.filter((x) => row.get(x) >= (lo + hi) / 2).sort((a, b) => row.get(a) - row.get(b));
        above.forEach((x, i) => row.set(x, Math.min(row.get(x), lo - 1 - i)));
        below.forEach((x, i) => row.set(x, Math.max(row.get(x), hi + 1 + i)));
        // keep rows distinct in the column
        const used = new Set([...mem, ...layers[r].filter((x) => main.has(x))].filter((x) => rank.get(x) === r).map((x) => row.get(x)));
        for (const x of above) { let v = row.get(x); while (used.has(v)) v--; row.set(x, v); used.add(v); }
        for (const x of below) { let v = row.get(x); while (used.has(v)) v++; row.set(x, v); used.add(v); }
      }
    }
    // 5. coordinates on the grid; with `wrap`, the columns run in bands of at most `wrap` columns, a stage never split
    //    unless it alone is wider than a band (the simple view, so a whole workflow fits readably)
    const RW = opts.row ?? ROW, FOOT = opts.foot ?? 0; // the simple view gives each node a row of badges under it
    const minRow = Math.min(0, ...all.map((x) => row.get(x)));
    const bandOf = new Map(), bandStart = [], bandTop = [], bandRow0 = [], bandBottom = [], bandRows = [];
    if (opts.wrap) {
      const stageAt = (r) => { const ls = layers[r] || []; const m = ls.find((x) => main.has(x) && vn.has(x)) ?? ls.find((x) => vn.has(x) && stageOfV(x)); return m ? stageOfV(m) : null; };
      const segs = []; for (let r = 0; r <= R; r++) { const st = stageAt(r); const last = segs[segs.length - 1]; if (last && st && last.st === st) last.n++; else segs.push({ st, r, n: 1 }); }
      let b = -1, width = Infinity;
      for (const sg of segs) { if (width + sg.n > opts.wrap) { b++; bandStart[b] = sg.r; width = 0; }
        for (let k = 0; k < sg.n; k++) { if (width >= opts.wrap) { b++; bandStart[b] = sg.r + k; width = 0; } bandOf.set(sg.r + k, b); width++; } }
      let y = 0;
      for (let i = 0; i <= b; i++) { const rows = all.filter((x) => bandOf.get(rank.get(x)) === i).map((x) => row.get(x)); const lo = Math.min(...rows), hi = Math.max(...rows);
        bandRow0[i] = lo;
        let height = (hi - lo) * RW;
        if (opts.actualGraph) {
          // Routing-only placeholders need lane clearance, not a full node/badge row.
          const levels = [...new Set(rows)].sort((a, b) => a - b);
          const real = new Map();
          for (const x of ids.filter((x) => bandOf.get(rank.get(x)) === i)) real.set(row.get(x), Math.max(real.get(row.get(x)) || 0, vn.get(x).h));
          const offsets = new Map(); let offset = 0;
          for (let j = 0; j < levels.length; j++) {
            if (j) offset += real.has(levels[j - 1]) ? (real.has(levels[j]) ? (real.get(levels[j - 1]) + real.get(levels[j])) / 2 + FOOT + PAD : real.get(levels[j - 1]) / 2 + NH / 2 + FOOT + LANE * 2) : (real.has(levels[j]) ? real.get(levels[j]) / 2 + LANE : LANE * 2);
            offsets.set(levels[j], offset);
          }
          bandRows[i] = offsets; height = offset;
        }
        bandTop[i] = y + TITLE + PAD; bandBottom[i] = bandTop[i] + height + SH + PAD + FOOT; y = bandBottom[i] + BAND_GAP; }
    }
    const xy = (x, h) => { const r = rank.get(x); if (!opts.wrap) return [r * COL, (row.get(x) - minRow) * RW + (NH - h) / 2, 0];
      const b = bandOf.get(r); return [(r - bandStart[b]) * COL, bandTop[b] + (bandRows[b]?.get(row.get(x)) ?? (row.get(x) - bandRow0[b]) * RW) + (NH - h) / 2, b]; };
    const nodes = ids.map((x) => { const v = vn.get(x); const [px, py, band] = xy(x, v.h); return { id: x, kind: v.kind, stage: v.stage, label: v.label ?? v.ref?.label, ref: v.ref, members: v.members,
      x: px, y: py, w: v.w, h: v.h, row: row.get(x), rank: rank.get(x), main: main.has(x), band, bandBottom: opts.wrap ? bandBottom[band] : null }; });
    const at = new Map(nodes.map((n) => [n.id, n]));
    for (const [d, info] of dummy) { const [px, py, band] = xy(d, NH); at.set(d, { id: d, dummy: true, x: px, y: py, w: NW, h: NH, row: row.get(d), band, bandBottom: opts.wrap ? bandBottom[band] : null }); }
    // a node moved by hand in a view that is not saved (the simple view): its edges follow it
    for (const [id, d] of Object.entries(opts.offsets || {})) { const n = at.get(id); if (n && Number.isFinite(d?.dx) && Number.isFinite(d?.dy)) { n.x += d.dx; n.y += d.dy; } }
    // stage boxes (expanded stages), one per band a stage occupies
    const boxes = [];
    for (const s of stages.filter((s) => !collapsed.has(s.id))) { const mem = nodes.filter((n) => n.stage === s.id && n.kind === "node"); if (!mem.length) continue;
      for (const band of [...new Set(mem.map((n) => n.band))]) { const m2 = mem.filter((n) => n.band === band);
        const x0 = Math.min(...m2.map((n) => n.x)) - PAD, y0 = Math.min(...m2.map((n) => n.y)) - PAD - TITLE, x1 = Math.max(...m2.map((n) => n.x + n.w)) + PAD, y1 = Math.max(...m2.map((n) => n.y + n.h)) + PAD + FOOT;
        boxes.push({ id: s.id, label: s.label, label_tw: s.label_tw, nodes: s.nodes, x: x0, y: y0, w: x1 - x0, h: y1 - y0, band }); } }
    // back edges: each goes above or below, whichever crosses fewer edges (two passes of single flips)
    const backs = ve.filter((e) => e.back);
    const flipping = backs.length && !opts.noFlip;
    // the side search scores plain shapes; only the final route keeps back edges off forward edges' middles (steer)
    let g = route(def, nodes, at, ve, boxes, stages, collapsed, false, !flipping);
    if (flipping) {
      const W = opts.crossWeight ?? 6; // a crossing costs as much as six arc levels
      const levels = (gg, side) => Math.max(0, ...gg.edges.filter((e) => e.back && e.side === side).map((e) => e.level + 1));
      const score = (gg) => fastCrossings(gg) * W + levels(gg, "above") + levels(gg, "below");
      let best = score(g);
      for (let pass = 0; pass < 2; pass++) for (const e of backs) {
        const was = e.sideFixed || e.side; e.sideFixed = -was;
        const g2 = route(def, nodes, at, ve, boxes, stages, collapsed, false, false); const sc = score(g2);
        if (sc < best) { best = sc; g = g2; } else e.sideFixed = was;
      }
      g = route(def, nodes, at, ve, boxes, stages, collapsed, false, true);
    }
    return g;
  }

  // ---------- edges: ports, channels, arcs, labels ----------
  function route(def, nodes, at, ve, boxes, stages, collapsed, free = false, steerLegs = true) {
    const top = Math.min(...nodes.map((n) => n.y), ...boxes.map((b) => b.y)), bottom = Math.max(...nodes.map((n) => n.y + n.h), ...boxes.map((b) => b.y + b.h));
    const cy = (n) => n.y + n.h / 2;
    // ports: spread a node's outgoing edges along its right side and incoming along its left, by where they go
    const outs = new Map(), ins = new Map();
    const side = (e) => { const a = at.get(e.from), b = at.get(e.to); return (a.row ?? 0) + (b.row ?? 0) <= 0 ? -1 : 1; };
    for (const e of ve) {
      if (!e.back && !free) e.firstHop = at.get(e.chain[1]); if (!e.back && !free) e.lastHop = at.get(e.chain[e.chain.length - 2]);
      e.side = e.back ? (e.sideFixed || side(e)) : 0;
      (outs.get(e.from) || outs.set(e.from, []).get(e.from)).push(e); (ins.get(e.to) || ins.set(e.to, []).get(e.to)).push(e);
    }
    const spread = (n, list, key) => { const l = list.slice().sort((a, b) => key(a) - key(b)); const k = l.length, step = k > 1 ? Math.min(10, (n.h - 16) / (k - 1)) : 0; return l.map((e, i) => [e, cy(n) + (i - (k - 1) / 2) * step]); };
    const ys = new Map(), ye = new Map();
    for (const [id, list] of outs) for (const [e, y] of spread(at.get(id), list, (e) => (e.back ? e.side * 1e6 : cy(e.firstHop || at.get(e.to))))) ys.set(e, y);
    for (const [id, list] of ins) for (const [e, y] of spread(at.get(id), list, (e) => (e.back ? e.side * 1e6 : cy(e.lastHop || at.get(e.from))))) ye.set(e, y);
    // channel lanes: each back edge gets its own x in the channel it uses
    const laneOut = new Map(), laneIn = new Map();
    const edges = [];
    const backs = ve.filter((e) => e.back);
    const text = (e) => e.whens.join(" · ");
    // back edges into the same node, on the same side and with the same label, share one arc (a bus): one level, one way down, one label
    const groups = new Map();
    for (const e of backs) { const k = `${e.to}|${e.side}|${text(e)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    for (const e of backs) { const a = at.get(e.from); const ko = laneOut.get(a.x) || 0; laneOut.set(a.x, ko + 1); e.xout = a.x + a.w + 12 + ko * LANE; }
    for (const list of groups.values()) { const b = at.get(list[0].to); const ki = laneIn.get(b.x) || 0; laneIn.set(b.x, ki + 1); for (const e of list) { e.xin = b.x - 12 - ki * LANE; e.group = list; ye.set(e, ye.get(list[0])); } }
    // arcs hug what lies under them: shortest first, each just outside the nodes and stage boxes in its span
    // and outside the arcs already placed over that span (a label widens its span)
    const solids = [...nodes, ...boxes];
    for (const s of [-1, 1]) {
      const list = [...groups.values()].filter((g) => g[0].side === s).map((g) => { const lo0 = Math.min(...g.flatMap((e) => [e.xin, e.xout])), hi0 = Math.max(...g.flatMap((e) => [e.xin, e.xout])); const w = text(g[0]) ? text(g[0]).length * CH + 10 : 0; const mid = (lo0 + hi0) / 2;
        return { g, lo: Math.min(lo0, mid - w / 2) - 8, hi: Math.max(hi0, mid + w / 2) + 8 }; }).sort((x, y) => (x.hi - x.lo) - (y.hi - y.lo));
      const done = [];
      for (const it of list) {
        const under = solids.filter((n) => n.x < it.hi && it.lo < n.x + n.w);
        let y = s < 0 ? Math.min(...under.map((n) => n.y)) - ARC0 : Math.max(...under.map((n) => n.y + n.h)) + ARC0;
        if (!under.length) y = s < 0 ? top - ARC0 : bottom + ARC0;
        for (const o of done) if (o.lo < it.hi && it.lo < o.hi) y = s < 0 ? Math.min(y, o.y - ARC_STEP) : Math.max(y, o.y + ARC_STEP);
        it.y = y; done.push(it);
        for (const e of it.g) { e.arcY = y; e.level = done.filter((o) => o.lo < it.hi && it.lo < o.hi).length - 1; }
      }
    }
    const placed = [];
    const obstacles = [...nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })), ...boxes.map((b) => ({ x: b.x, y: b.y, w: Math.min(b.w, b.label.length * 7 + 24), h: TITLE }))];
    const hits = (r) => placed.some((p) => r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h) || obstacles.some((p) => r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h);
    const fit = (t, room) => { const max = Math.max(3, Math.floor((room - 8) / CH)); return t.length <= max ? t : t.slice(0, max - 1) + "…"; };
    // pass 1: every edge's shape. Forward edges first: a back edge's legs and arc then keep off every forward edge's
    // middle, the point a captain drops a check on (an edge's hit band is 12 px wide)
    const shaped = new Map();
    let connLane = 0;
    for (const e of ve) {
      if (e.back) continue;
      const a = at.get(e.from), b = at.get(e.to);
      const segs = []; const t = text(e);
      const y0 = ys.get(e), y1 = ye.get(e);
      // forward: through the channel between neighbouring columns, straight through placeholders, and down to the next band
      const chain = free ? [e.from, e.to] : e.chain;
      let cur = [a.x + a.w, y0], curItem = a;
      const rooms = [];
      for (let k = 1; k < chain.length; k++) {
        const n = at.get(chain[k]); const last = k === chain.length - 1;
        const nx = n.x, ny = last ? y1 : cy(n);
        if (n.band !== undefined && curItem.band !== undefined && n.band !== curItem.band) {
          // each edge that drops to the next band has its own lane (riser, gap run, descender), far enough apart to tell them
          // apart on a phone, and its label sits on its run along the gap
          const lane = connLane++ % 4; const xr = cur[0] + 14 + lane * 10, gy = curItem.bandBottom + BAND_GAP / 2 - 12 + lane * 9, xl = nx - 14 - lane * 10;
          for (const [p, q] of [[cur, [xr, cur[1]]], [[xr, cur[1]], [xr, gy]], [[xr, gy], [xl, gy]], [[xl, gy], [xl, ny]], [[xl, ny], [nx, ny]]]) segs.push({ t: "L", a: p, b: q });
          rooms.push({ kind: "channel", x: Math.min(xl, xr), x2: Math.max(xl, xr), ya: gy, yb: gy });
          e.corner = 8;
        } else {
          const dx = Math.max(20, (nx - cur[0]) / 2);
          segs.push({ t: "C", a: cur, c1: [cur[0] + dx, cur[1]], c2: [nx - dx, ny], b: [nx, ny] });
          rooms.push({ kind: "channel", x: cur[0], x2: nx, ya: cur[1], yb: ny });
        }
        if (!last) { segs.push({ t: "L", a: [nx, ny], b: [nx + n.w, ny] }); rooms.push({ kind: "slot", x: nx, x2: nx + n.w, ya: ny, yb: ny }); cur = [nx + n.w, ny]; }
        curItem = n;
      }
      shaped.set(e, { e, t, rooms, out: { from: e.from, to: e.to, when: e.whens.join("|") || null, index: e.index, checks: e.checks, back: false, dashed: false, segs, label: null, corner: e.corner } });
    }
    const mids = [...shaped.values()].map((w) => { const ps = sample(w.out, 24); let L = 0; const acc = [0]; for (let i = 1; i < ps.length; i++) acc.push(L += Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1])); return ps[Math.max(0, acc.findIndex((v) => v >= L / 2))]; });
    const HIT = 9; // half the hit band, and a little room
    const segNear = (m, p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = dx * dx + dy * dy; const u = l ? Math.max(0, Math.min(1, ((m[0] - p[0]) * dx + (m[1] - p[1]) * dy) / l)) : 0; return Math.hypot(m[0] - p[0] - u * dx, m[1] - p[1] - u * dy) < HIT; };
    const fpolys = [...shaped.values()].map((w) => ({ e: w.e, p: sample(w.out, 8) }));
    const backPoly = (x) => { const a = at.get(x.from), b = at.get(x.to); return [[a.x + a.w, ys.get(x)], [x.xout, ys.get(x)], [x.xout, x.arcY], [x.xin, x.arcY], [x.xin, ye.get(x)], [b.x, ye.get(x)]]; };
    const meets = (x, y) => x.from === y.from || x.from === y.to || x.to === y.from || x.to === y.to; // edges that share a node meet there: not a crossing
    // the cost of a candidate for edge e: the forward middles it covers, and the edges it crosses that it did not have to
    // (a third each). A middle outweighs any number of crossings: in a crowded channel several crossings once summed past
    // one middle and a leg stayed on it (budget → build over step-back → parked once merge → build took a lane)
    const covered = (e, ...segs) => mids.filter((m) => segs.some(([p, q]) => segNear(m, p, q))).length * 100
      + (fpolys.filter((f) => !meets(f.e, e) && segs.some(([p, q]) => f.p.some((r, i) => i > 0 && cross(f.p[i - 1], r, p, q)))).length
      + backs.filter((o) => o !== e && !e.group.includes(o) && !meets(o, e) && segs.some(([p, q]) => { const bp = backPoly(o); return bp.some((r, i) => i > 0 && cross(bp[i - 1], r, p, q)); })).length) / 3;
    // a leg, the stub to it or an arc over a forward edge's middle moves a lane (half an arc step for an arc) to the side that
    // frees it, a few lanes at most, inside its channel and off the other back edges' legs; the fewest middles covered wins
    const legs = [];
    const legClash = (x, ya, yb) => legs.some(([lx, la, lb]) => Math.abs(lx - x) < 3 && Math.min(ya, yb) < Math.max(la, lb) && Math.min(la, lb) < Math.max(ya, yb));
    const pick = (v, cands, cost) => { if (!steerLegs) return v; let best = v, bc = cost(v); for (const [w, pen] of cands) { const c = cost(w) + pen; if (c < bc) { bc = c; best = w; } } return best; };
    const lanes = (v, lo, hi) => [1, 2, 3, 4, 5, 6].flatMap((k) => [[v + k * LANE, k * 0.01], [v - k * LANE, k * 0.01]]).filter(([w]) => w >= lo && w <= hi);
    const steered = new Set();
    for (const e of ve) {
      if (!e.back) continue;
      const a = at.get(e.from), b = at.get(e.to);
      const y0 = ys.get(e), y1 = ye.get(e);
      if (!steered.has(e.group)) { steered.add(e.group); const g0 = e.group; const yIn = ye.get(g0[0]), bx = at.get(g0[0].to).x;
        const Y = pick(g0[0].arcY, [1, 2, 3, 4, 5].map((k) => [g0[0].arcY + e.side * k * ARC_STEP / 2, k * 0.01]), (yy) => covered(e, ...g0.map((x) => [[x.xin, yy], [x.xout, yy]])));
        const xin = pick(g0[0].xin, lanes(g0[0].xin, bx - GAP + 8, bx - 6), (xx) => covered(e, [[xx, yIn], [xx, Y]], [[xx, yIn], [bx, yIn]]) + (legClash(xx, yIn, Y) ? 0.5 : 0));
        for (const x of g0) { x.arcY = Y; x.xin = xin; } legs.push([xin, yIn, Y]); }
      e.xout = pick(e.xout, lanes(e.xout, a.x + a.w + 6, a.x + a.w + GAP - 8), (xx) => covered(e, [[xx, y0], [xx, e.arcY]], [[a.x + a.w, y0], [xx, y0]]) + (legClash(xx, y0, e.arcY) ? 0.5 : 0));
      legs.push([e.xout, y0, e.arcY]);
      const Y = e.arcY;
      const segs = []; const t = text(e);
      const pts = [[a.x + a.w, y0], [e.xout, y0], [e.xout, Y], [e.xin, Y], [e.xin, y1], [b.x, y1]];
      for (let k = 1; k < pts.length; k++) segs.push({ t: "L", a: pts[k - 1], b: pts[k] });
      shaped.set(e, { e, t, out: { from: e.from, to: e.to, when: e.whens.join("|") || null, index: e.index, checks: e.checks, back: true, dashed: true, side: e.side < 0 ? "above" : "below", arcY: Y, level: e.level, segs, label: null, corner: 8 } });
    }
    const work = ve.map((e) => shaped.get(e));
    // pass 2: labels, arcs first (on the arc), then forward ones at the fork; never on a node, a stage title, another label or another edge
    const pts = work.map((w) => sample(w.out, 10));
    const onEdge = (r, own) => pts.some((ps, i) => i !== own && ps.some((q) => q[0] > r.x - 1 && q[0] < r.x + r.w + 1 && q[1] > r.y - 1 && q[1] < r.y + r.h + 1));
    const order = [...work.keys()].sort((i, j) => Number(work[j].e.back) - Number(work[i].e.back));
    for (const i of order) {
      const { e, t, out } = work[i]; if (!t) continue;
      if (e.back) { if (e.group[0] !== e) continue; const lo = Math.min(...e.group.map((x) => x.xin)), hi = Math.max(...e.group.map((x) => x.xout)); const w = t.length * CH + 8;
        out.label = { x: (lo + hi) / 2 - w / 2, y: e.arcY - LH / 2, w, h: LH, text: t, full: t }; placed.push(out.label); continue; }
      const cands = [];
      for (const shrink of [0, 4, 7]) for (const rm of work[i].rooms) { const room = rm.x2 - rm.x - 6; const tt = fit(t, room - shrink * CH); const w = tt.length * CH + 8; if (w > room) continue;
        for (const f of rm.kind === "slot" ? [0.5] : [0.5, 0.3, 0.7, 0.15, 0.85]) { const x = rm.x + 3 + (room - w) * f, yy = rm.ya + (rm.yb - rm.ya) * (rm.kind === "slot" ? 0.5 : f);
          for (const dy of [-LH - 2, 2, -2 * LH - 4, LH + 4]) cands.push({ x, y: yy + dy, w, h: LH, text: tt, full: t }); } }
      out.label = cands.find((c) => !hits(c) && !onEdge(c, i)) || cands.find((c) => !hits(c)) || cands[0] || null;
      if (out.label) placed.push(out.label);
    }
    for (const w of work) edges.push(w.out);
    const all = [...nodes, ...boxes];
    const minX = Math.min(...all.map((n) => n.x)) - 40, maxX = Math.max(...all.map((n) => n.x + n.w), ...edges.flatMap((e) => (e.label ? [e.label.x + e.label.w] : []))) + 40;
    const arcs = edges.filter((e) => e.back).map((e) => e.arcY);
    const minY = Math.min(top, ...arcs) - 30, maxY = Math.max(bottom, ...arcs) + 30;
    return { def: def.id, nodes, edges, stages: boxes, stageList: stages, collapsed: [...collapsed], bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, NW, NH };
  }

  // ---------- the simple view: the main path through the stages, loops and escalations as badges ----------
  // Loop nodes (kind loop) fold into a "↻" badge on their producer, with the round cap (args.round_cap, default 3);
  // a node whose only way on is back to the node it came from (Pick the door) folds into that node's badge;
  // every other node off the way from the entry to the end (step-back, stalled, budget, scope, parked, closed,
  // dropped) becomes one "⚑ N escalations" badge on the stage (or node) it leaves from. Back edges are not drawn.
  function simplify(def, reached = []) {
    const full = layout(def, { noFlip: true });
    const back = new Set(full.edges.filter((e) => e.back).flatMap((e) => e.index));
    const byId = new Map(def.nodes.map((n) => [n.id, n]));
    const loops = def.nodes.filter((n) => n.kind === "loop" && byId.has(n.args?.producer));
    const isLoop = new Set(loops.map((n) => n.id));
    const fwd = def.edges.map((e, i) => ({ ...e, i })).filter((e) => !back.has(e.i) && !isLoop.has(e.from) && !isLoop.has(e.to));
    // a loop's way on (pass) is its producer's way on
    for (const L of loops) for (const e of def.edges) if (e.from === L.id && !back.has(def.edges.indexOf(e)) && !isLoop.has(e.to) && /(^|\|)pass(\||$)/.test(e.when || "") && !fwd.some((f) => f.from === L.args.producer && f.to === e.to))
      fwd.push({ from: L.args.producer, to: e.to, when: "pass", i: def.edges.indexOf(e) });
    const entry = full.nodes.find((n) => n.id === def.nodes.find((x) => !def.edges.some((e) => e.to === x.id))?.id)?.id ?? def.nodes[0].id;
    const reach = (start, dir) => { const seen = new Set([start]), q = [start]; while (q.length) { const x = q.shift(); for (const e of fwd) { const [a, b] = dir > 0 ? [e.from, e.to] : [e.to, e.from]; if (a === x && !seen.has(b)) { seen.add(b); q.push(b); } } } return seen; };
    const fromEntry = reach(entry, 1);
    // the end: the main lane's end when the simple path still reaches it, else the furthest end it reaches
    const rk = new Map(full.nodes.map((n) => [n.id, n.rank]));
    const sinks = [...fromEntry].filter((x) => !isLoop.has(x) && !fwd.some((e) => e.from === x));
    const mainEnd = full.nodes.filter((n) => n.main).sort((a, b) => b.rank - a.rank)[0]?.id;
    const end = sinks.includes(mainEnd) ? mainEnd : sinks.sort((a, b) => (rk.get(b) ?? 0) - (rk.get(a) ?? 0))[0] ?? entry;
    const toEnd = reach(end, -1);
    const keep = new Set(def.nodes.filter((n) => fromEntry.has(n.id) && toEnd.has(n.id) && !isLoop.has(n.id)).map((n) => n.id));
    // a run's view also keeps the end node the run actually reached (a "closed" end beside the main lane's end)
    for (const id of reached) if (byId.has(id) && !isLoop.has(id) && !def.edges.some((e) => e.from === id)) keep.add(id);
    const badges = {}; const add = (k, b) => (badges[k] = badges[k] || []).push(b);
    for (const L of loops) add(`node:${L.args.producer}`, { kind: "loop", loop: L.id, text: `↻ ${(/^(fix|refine)/i.exec(L.label) || ["refine"])[0].toLowerCase()}`, cap: Number(L.args?.round_cap ?? 3) });
    const stageOf = new Map(); stagesFor(def).forEach((st) => st.nodes.forEach((n) => stageOf.set(n, st.id)));
    const folded = new Set();
    for (const n of def.nodes) { if (keep.has(n.id) || isLoop.has(n.id)) continue;
      const ins = def.edges.filter((e) => e.to === n.id), outs = def.edges.filter((e) => e.from === n.id);
      const src = [...new Set(ins.map((e) => e.from))];
      if (src.length === 1 && keep.has(src[0]) && outs.length && outs.every((e) => e.to === src[0])) { folded.add(n.id); add(`node:${src[0]}`, { kind: "ask", node: n.id, text: n.kind === "card" ? "asks you if unsure" : n.label }); } }
    // escalations: walk back from each to the kept nodes (or loops, standing for their producers) it leaves from
    const escal = def.nodes.filter((n) => !keep.has(n.id) && !isLoop.has(n.id) && !folded.has(n.id));
    const holders = new Map();
    for (const n of escal) {
      const seen = new Set([n.id]), q = [n.id], from = new Set();
      while (q.length) { const x = q.shift(); for (const e of def.edges) if (e.to === x && !seen.has(e.from)) { seen.add(e.from);
        if (keep.has(e.from)) from.add(e.from); else if (isLoop.has(e.from)) from.add(byId.get(e.from).args.producer); else q.push(e.from); } }
      for (const f of from) { const k = stageOf.get(f) ? `stage:${stageOf.get(f)}` : `node:${f}`; if (!holders.has(k)) holders.set(k, new Set()); holders.get(k).add(n.id); }
    }
    for (const [k, set] of holders) add(k, { kind: "escalations", nodes: [...set], text: `⚑ ${set.size} escalation${set.size > 1 ? "s" : ""}`, labels: [...set].map((x) => byId.get(x).label) });
    const nodes = def.nodes.filter((n) => keep.has(n.id));
    const edges = []; for (const e of fwd) if (keep.has(e.from) && keep.has(e.to) && !edges.some((x) => x.from === e.from && x.to === e.to)) edges.push({ from: e.from, to: e.to, when: e.when, checks: def.edges[e.i]?.checks, i: e.i });
    return { def: { ...def, nodes, edges: edges.map(({ i, ...x }) => x) }, edgeIndex: edges.map((e) => e.i), badges, hidden: def.nodes.filter((n) => !keep.has(n.id)).map((n) => n.id) };
  }
  function layoutSimple(def, opts = {}) {
    // Editing represents the actual graph from the outset. Run summaries keep
    // the main-path projection below; removing a step must not promote a hidden branch.
    if (opts.actualGraph || !def.nodes.length) {
      const g = layout(def, { collapsed: opts.collapsed, wrap: opts.wrap ?? 6, noFlip: true, offsets: opts.offsets, row: 128, foot: 28, actualGraph: !!opts.actualGraph });
      g.badges = {}; g.hidden = []; g.simple = true; return g;
    }
    const sim = simplify(def, opts.reached || []);
    const g = layout(sim.def, { collapsed: opts.collapsed, wrap: opts.wrap ?? 6, noFlip: true, offsets: opts.offsets, row: 128, foot: 28 });
    for (const e of g.edges) e.index = e.index.map((i) => sim.edgeIndex[i]); // back to the full definition's edge numbers
    g.badges = sim.badges; g.hidden = sim.hidden; g.simple = true;
    return g;
  }

  // ---------- the definition's own positions (a dragged layout), same shapes ----------
  function place(def, opts = {}) {
    if (!def.nodes.length) return layout(def, opts);
    const stages = stagesFor(def); const collapsed = new Set(opts.collapsed || []);
    const stageOf = new Map(); stages.forEach((s) => s.nodes.forEach((n) => stageOf.set(n, s.id)));
    const vis = []; const repOf = (id) => (stageOf.get(id) && collapsed.has(stageOf.get(id)) ? `stage:${stageOf.get(id)}` : id);
    for (const s of stages.filter((s) => collapsed.has(s.id))) { const mem = def.nodes.filter((n) => s.nodes.includes(n.id)); const cx = mem.reduce((a, n) => a + n.x, 0) / mem.length, cyy = mem.reduce((a, n) => a + n.y, 0) / mem.length;
      vis.push({ id: `stage:${s.id}`, kind: "stage", stage: s.id, label: s.label, members: s.nodes, x: Math.round(cx), y: Math.round(cyy), w: SW, h: SH }); }
    for (const n of def.nodes) if (repOf(n.id) === n.id) vis.push({ id: n.id, kind: "node", stage: stageOf.get(n.id) || null, ref: n, label: n.label, members: [n.id], x: n.x, y: n.y, w: NW, h: NH });
    const at = new Map(vis.map((n) => [n.id, n]));
    const mid = (Math.min(...vis.map((n) => n.y)) + Math.max(...vis.map((n) => n.y + n.h))) / 2;
    vis.forEach((n) => { n.row = n.y + n.h / 2 < mid ? -1 : 1; });
    const ve = []; def.edges.forEach((e, i) => { const a = repOf(e.from), b = repOf(e.to); if (!keepEdge(a, b, e, opts, (x) => at.has(x))) return; const same = ve.find((x) => x.from === a && x.to === b); if (same) { same.index.push(i); if (e.when) same.whens.push(e.when); same.checks += e.checks?.length || 0; return; }
      ve.push({ from: a, to: b, index: [i], whens: e.when ? [e.when] : [], checks: e.checks?.length || 0, back: !(at.get(b).x >= at.get(a).x + NW + 24) }); });
    const boxes = stages.filter((s) => !collapsed.has(s.id)).map((s) => { const mem = vis.filter((n) => n.stage === s.id); if (!mem.length) return null;
      const x0 = Math.min(...mem.map((n) => n.x)) - PAD, y0 = Math.min(...mem.map((n) => n.y)) - PAD - TITLE, x1 = Math.max(...mem.map((n) => n.x + n.w)) + PAD, y1 = Math.max(...mem.map((n) => n.y + n.h)) + PAD;
      return { id: s.id, label: s.label, label_tw: s.label_tw, nodes: s.nodes, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }).filter(Boolean);
    const g = route(def, vis, at, ve, boxes, stages, collapsed, true);
    g.manual = true; return g;
  }

  // the old hand layout's edge shapes, for measuring how many crossings it had
  function manual(def) {
    const at = new Map(def.nodes.map((n) => [n.id, { id: n.id, x: n.x, y: n.y, w: NW, h: NH }]));
    const edges = def.edges.map((e) => { const a = at.get(e.from), b = at.get(e.to); if (!a || !b) return null;
      const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
      const seg = b.x > a.x + NW ? { t: "C", a: [x1, y1], c1: [(x1 + x2) / 2, y1], c2: [(x1 + x2) / 2, y2], b: [x2, y2] } : { t: "C", a: [x1, y1], c1: [x1 + 60, y1 + (y2 >= y1 ? 60 : -60)], c2: [x2 - 60, y2 + (y2 >= y1 ? 60 : -60)], b: [x2, y2] };
      return { from: e.from, to: e.to, segs: [seg] }; }).filter(Boolean);
    return { nodes: [...at.values()], edges, stages: [] };
  }

  // ---------- geometry ----------
  function sample(e, perCurve = 16) {
    const pts = [];
    for (const s of e.segs) {
      if (s.t === "L") { const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); const n = Math.max(1, Math.ceil(len / 6)); for (let i = 0; i <= n; i++) pts.push([s.a[0] + (s.b[0] - s.a[0]) * i / n, s.a[1] + (s.b[1] - s.a[1]) * i / n]); }
      else { const n = Math.max(perCurve, 24); for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * u * s.a[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.b[0], u * u * u * s.a[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.b[1]]); } }
    }
    return pts;
  }
  const cross = (p1, p2, p3, p4) => { const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4); return d1 * d2 < 0 && d3 * d4 < 0; };
  // the same count on coarse shapes (lines as they are, curves in 8 pieces): fast enough to steer the layout
  function fastCrossings(g) {
    const polys = g.edges.map((e) => { const p = [e.segs[0].a]; for (const s of e.segs) { if (s.t === "L") p.push(s.b); else for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t; p.push([u * u * u * s.a[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.b[0], u * u * u * s.a[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.b[1]]); } } return { e, p }; });
    let n = 0;
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) { const A = polys[i], B = polys[j];
      if (A.e.from === B.e.from || A.e.from === B.e.to || A.e.to === B.e.from || A.e.to === B.e.to) continue;
      let hit = false; for (let a = 1; a < A.p.length && !hit; a++) for (let b = 1; b < B.p.length && !hit; b++) if (cross(A.p[a - 1], A.p[a], B.p[b - 1], B.p[b])) hit = true; if (hit) n++; }
    return n;
  }
  /** How many pairs of edges cross (edges that share a node are not counted: they meet there). */
  function crossings(g) {
    const polys = g.edges.map((e) => ({ e, p: sample(e, 16) }));
    let n = 0;
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
      const A = polys[i], B = polys[j];
      if (A.e.from === B.e.from || A.e.from === B.e.to || A.e.to === B.e.from || A.e.to === B.e.to) continue;
      let hit = false;
      for (let a = 1; a < A.p.length && !hit; a++) for (let b = 1; b < B.p.length && !hit; b++) if (cross(A.p[a - 1], A.p[a], B.p[b - 1], B.p[b])) hit = true;
      if (hit) n++;
    }
    return n;
  }
  /** An SVG path for an edge: curves as they are, a back edge's corners rounded. */
  function pathD(e) {
    if (!e.back && !(e.corner && e.segs.every((x) => x.t === "L"))) return e.segs.map((s, i) => `${i ? "" : `M${s.a[0]},${s.a[1]} `}${s.t === "L" ? `L${s.b[0]},${s.b[1]}` : `C${s.c1[0]},${s.c1[1]} ${s.c2[0]},${s.c2[1]} ${s.b[0]},${s.b[1]}`}`).join(" ");
    const p = [e.segs[0].a, ...e.segs.map((s) => s.b)]; const r = e.corner || 8;
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 1; i < p.length - 1; i++) {
      const [ax, ay] = p[i - 1], [bx, by] = p[i], [cx, cyy] = p[i + 1];
      const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cyy - by); const k = Math.min(r, l1 / 2, l2 / 2);
      const s1 = [bx - (bx - ax) / (l1 || 1) * k, by - (by - ay) / (l1 || 1) * k], s2 = [bx + (cx - bx) / (l2 || 1) * k, by + (cyy - by) / (l2 || 1) * k];
      d += ` L${s1[0]},${s1[1]} Q${bx},${by} ${s2[0]},${s2[1]}`;
    }
    return d + ` L${p[p.length - 1][0]},${p[p.length - 1][1]}`;
  }

  const api = { layout, layoutSimple, simplify, place, manual, sample, crossings, stagesFor, pathD, NW, NH, SW, SH, COL, ROW };
  (typeof globalThis !== "undefined" ? globalThis : window).crewLayout = api;
})();
