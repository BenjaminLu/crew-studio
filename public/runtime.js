// Studio's native runtime in the browser: Workflows (a list, and a graph editor
// per workflow) and Runs (a list, and a live view per run). No dependency: the
// graph is plain SVG.
//   #/workflows                 the workflows
//   #/workflows/<id>[/v<N>]     the editor: drag nodes (positions kept per version),
//                               pan (drag the background) and zoom (wheel, + and −),
//                               connect (drag from a node's port to another node),
//                               disconnect (select an edge, Delete), add and remove
//                               nodes (palette), drop a check on a node or an edge,
//                               a side panel per node and edge with each check's
//                               params form and "Try on sample", validation as you
//                               edit, save as a new version with its diff, and a live
//                               overlay of a run. Every action also works from the
//                               keyboard (Tab to a node, arrows move it, Enter opens it,
//                               Delete removes it; the panel adds edges and checks).
//   #/runs                      the runs, and a form to start one
//   #/run/<id>                  a run: its graph with live node states, its open cards,
//                               its timeline and its evidence ledger
(() => {
const SVGNS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v); } for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
const api = async (u, body, method, signal) => { const r = await fetch(u, { signal, ...(body === undefined && !method ? {} : { method: method || "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.problems = j.problems; e.code=j.code; e.status=r.status; e.staffing=j.staffing; throw e; } return j; };
const KINDS = [["agent", "Agent", "代理"], ["check", "Check", "檢查"], ["card", "Card", "卡片"], ["loop", "Refine loop", "精修迴圈"], ["hook", "Hook", "掛勾"]];
const NW = 150, NH = 52;
const clone = (o) => JSON.parse(JSON.stringify(o));
const rerender = () => { if (["workflows", "runs", "run"].includes(S.route?.name)) render(); };

// ---------- live updates: the page's one event stream (app.js's, through window.liveListen) ----------
const live = { listeners: new Set() };
for (const t of ["wrun", "scard"]) window.liveListen(t, (m) => { const d = JSON.parse(m.data); for (const f of live.listeners) f(t, d); });

// ---------- the graph (shared by the editor and the run view) ----------
const stateClass = (st) => st ? `st-${st}` : "";
// ---------- the graph: drawn from crewLayout (public/graph-layout.js) ----------
const BADGE = { open: new Map() }; // which badge lists are open, per graph
const stageState = (members, states) => { const st = members.map((m) => states?.[m]).filter(Boolean);
  if (!st.length) return null; if (st.some((x) => x === "failed" || x === "error")) return "failed"; if (st.some((x) => x === "running" || x === "waiting")) return "running";
  return st.every((x) => x === "passed" || x === "skipped" || x === "superseded") ? "passed" : "pending"; };
const fitText = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
function graph(def, o = {}) {
  // o: { states, walked (the edge keys the run's events record as taken), editable, sel, manual, collapsed, onToggleStage, onSelect, onMove, onMoved, onDragStart, onConnect, onDropCheck, problems, view, onView }
  const L = window.crewLayout;
  const reached = o.states ? Object.keys(o.states).filter((k) => o.states[k] && o.states[k] !== "pending") : [];
  const lay = o.simple ? L.layoutSimple(def, { collapsed: o.collapsed || [], wrap: o.wrap, offsets: o.offsets, reached }) : o.manual ? L.place(def, { collapsed: o.collapsed || [] }) : L.layout(def, { collapsed: o.collapsed || [] });
  const byId = Object.fromEntries(lay.nodes.map((n) => [n.id, n]));
  const view = o.view || { ...lay.bbox };
  const svg = s("svg", { class: `rt-graph${o.simple ? " simple" : ""}`, "data-view": o.simple ? "simple" : "detail", viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`, role: "group", "data-layout": o.manual ? "manual" : "auto",
    "aria-label": T(`Workflow graph: ${def.nodes.length} nodes, ${def.edges.length} edges`, `流程圖：${def.nodes.length} 個節點、${def.edges.length} 條邊`), "data-graph": def.id });
  svg.append(s("defs", {}, s("marker", { id: `arr-${def.id}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, s("path", { d: "M0,0 L10,5 L0,10 z", class: "rt-arrow" }))));
  const bad = new Set((o.problems || []).filter((p) => p.level === "error" && p.node).map((p) => p.node));
  const badE = new Set((o.problems || []).filter((p) => p.level === "error" && p.edge).map((p) => p.edge));
  // T() picks the language (zh-CN derives from the zh-TW label), so this also runs where a harness supplies only T
  const zh = T(false, true), stageTw = (st) => T(st.label, st.label_tw || st.label);
  // stage boxes behind everything; the title toggles the stage
  const sg = s("g", { class: "rt-stages" });
  const pending = [], stageBadged = new Set(); // badges drawn once the label layer exists
  for (const st of lay.stages) {
    const state = stageState(st.nodes, o.states);
    const title = s("g", { class: "rt-stage-t", tabindex: 0, role: "button", "aria-expanded": "true", "data-stage-toggle": st.id, "aria-label": T(`${st.label}: collapse`, `${st.label_tw || st.label}：收合`) },
      s("rect", { x: st.x + 6, y: st.y + 5, width: Math.min(st.w - 12, (zh ? stageTw(st).length * 13 : st.label.length * 7.2) + 30), height: 18, rx: 9, class: "rt-stage-pill" }),
      s("text", { x: st.x + 14, y: st.y + 18, class: "rt-stage-label" }, `▾ ${stageTw(st)}`));
    const tog = (ev) => { if (svg.interactionActive) return; ev.stopPropagation(); o.onToggleStage?.(st.id); };
    title.addEventListener("click", tog); title.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); tog(ev); } });
    sg.append(s("g", { class: `rt-stage${state ? ` st-${state}` : ""}`, "data-stage": st.id }, s("rect", { x: st.x, y: st.y, width: st.w, height: st.h, rx: 14, class: "rt-stage-box" }), title));
    for (const b of (lay.badges?.[`stage:${st.id}`] || [])) if (!stageBadged.has(st.id)) { stageBadged.add(st.id); const w = b.text.length * 6.4 + 14; pending.push(() => badge(`s:${st.id}:${b.kind}`, st.x + st.w - w - 8, st.y + 5, b.text, b.labels || [], lg, b.kind)); }
  }
  const eg = s("g", { class: "rt-edges" }), lg = s("g", { class: "rt-labels" });
  const openKey = (k) => `${def.id}|${k}`;
  const badgeList = (key, x, y, items, parent) => {
    if (!BADGE.open.get(openKey(key))) return;
    const w = Math.max(...items.map((t) => t.length)) * 6.6 + 20, h = items.length * 16 + 10;
    parent.append(s("g", { class: "rt-badge-list", "data-badge-list": key }, s("rect", { x, y, width: w, height: h, rx: 8, class: "rt-badge-pop" }),
      ...items.map((t, i) => s("text", { x: x + 10, y: y + 18 + i * 16, class: "rt-badge-item" }, t))));
  };
  const badge = (key, x, y, text, items, parent, kind) => {
    const w = text.length * 6.4 + 14;
    const b = s("g", { class: `rt-badge-g${kind ? ` b-${kind}` : ""}`, tabindex: 0, role: "button", "data-badge": key, "data-badge-kind": kind || "checks", "aria-expanded": String(!!BADGE.open.get(openKey(key))), "aria-label": `${text}: ${items.join(", ")}` },
      s("rect", { x, y, width: w, height: 16, rx: 8, class: "rt-badge" }), s("text", { x: x + w / 2, y: y + 12, class: "rt-badge-t", "text-anchor": "middle" }, text));
    const tog = (ev) => { if (svg.interactionActive) return; ev.stopPropagation(); BADGE.open.set(openKey(key), !BADGE.open.get(openKey(key))); o.redraw?.(); };
    b.addEventListener("click", tog); b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); tog(ev); } });
    parent.append(b); badgeList(key, x, y + 20, items, parent);
  };
  lay.edges.forEach((e) => {
    const i = e.index[0], orig = def.edges[i]; if (!orig) return;
    const key = `${orig.from}→${orig.to}${orig.when ? `[${orig.when}]` : ""}`;
    const sel = o.sel?.edge === i;
    const g = s("g", { class: `rt-edge${e.back ? " back" : ""}${sel ? " sel" : ""}${badE.has(key) ? " bad" : ""}${o.walked && o.walked.has(key) ? " walked" : ""}`,
      "data-edge": key, "data-edge-i": i, "data-back": e.back ? e.side : null, tabindex: o.editable ? 0 : null, role: o.editable ? "button" : null,
      "aria-label": `${e.from} → ${e.to}${e.when ? ` when ${e.when}` : ""}${e.back ? T(", goes back", "，往回") : ""}${e.checks ? `, ${e.checks} gates` : ""}` });
    const d = L.pathD(e);
    g.append(s("path", { d, class: "rt-hit" }), s("path", { d, class: "rt-line", "marker-end": `url(#arr-${def.id})` }));
    if (e.label) { const lb = s("g", { class: `rt-elabel${e.back ? " back" : ""}`, "data-label": key }, s("rect", { x: e.label.x, y: e.label.y, width: e.label.w, height: e.label.h, rx: 4, class: "rt-when-bg" }),
      s("text", { x: e.label.x + 4, y: e.label.y + 10.5, class: "rt-when" }, e.label.text)); if (e.label.full !== e.label.text) lb.append(s("title", {}, e.label.full)); lg.append(lb); }
    if (e.checks) { g.setAttribute("data-edge-checks", e.checks);
      const p = e.label ? [e.label.x, e.label.y + e.label.h + 2] : (() => { const pts = L.sample(e, 8); const m = pts[Math.floor(pts.length / 2)]; return [m[0] - 24, m[1] + 4]; })();
      badge(`e:${key}`, p[0], p[1], T(`${e.checks} gate${e.checks > 1 ? "s" : ""}`, `${e.checks} 個關卡`), (orig.checks || []).map((c) => c.use), lg); }
    if (o.onSelect) { g.addEventListener("click", (ev) => { if (svg.interactionActive) return; ev.stopPropagation(); o.onSelect({ edge: i }); }); g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); o.onSelect({ edge: i }); } if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); o.onDeleteEdge?.(i); } }); }
    if (o.onDropCheck) { g.addEventListener("dragover", (ev) => { if (ev.dataTransfer.types.includes("text/x-check")) { ev.preventDefault(); g.classList.add("drop"); } }); g.addEventListener("dragleave", () => g.classList.remove("drop"));
      g.addEventListener("drop", (ev) => { ev.preventDefault(); g.classList.remove("drop"); const c = ev.dataTransfer.getData("text/x-check"); if (c) o.onDropCheck({ edge: i }, c); }); }
    eg.append(g);
  });
  const ng = s("g", { class: "rt-nodes" });
  for (const vn of lay.nodes) {
    if (vn.kind === "stage") { // a collapsed stage: one box with its state
      const st = stageState(vn.members, o.states);
      const lab = T(vn.label, lay.stageList.find((x) => x.id === vn.stage)?.label_tw || vn.label);
      const g = s("g", { class: `rt-node rt-stagenode${st ? ` st-${st}` : ""}`, transform: `translate(${vn.x},${vn.y})`, "data-stage-node": vn.stage, tabindex: 0, role: "button", "aria-expanded": "false",
        "aria-label": T(`${vn.label} stage, ${vn.members.length} nodes${st ? `, ${st}` : ""}: expand`, `${lab} 階段，${vn.members.length} 個節點${st ? `，${st}` : ""}：展開`) },
        s("rect", { width: vn.w, height: vn.h, rx: 14, class: "rt-box" }), s("text", { x: 12, y: 24, class: "rt-label" }, `▸ ${fitText(lab, 16)}`),
        s("text", { x: 12, y: 44, class: "rt-kind" }, T(`${vn.members.length} nodes${st ? ` · ${st}` : ""}`, `${vn.members.length} 個節點${st ? ` · ${st}` : ""}`)));
      if (st) g.setAttribute("data-state", st);
      for (const b of (lay.badges?.[`stage:${vn.stage}`] || [])) badge(`s:${vn.stage}:${b.kind}`, vn.x, vn.y + vn.h + 4, b.text, b.labels || [], lg, b.kind);
      const tog = (ev) => { if (svg.interactionActive) return; ev.stopPropagation(); o.onToggleStage?.(vn.stage); };
      g.addEventListener("click", tog); g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); tog(ev); } });
      ng.append(g); continue;
    }
    const n = vn.ref;
    const st = o.states?.[n.id]; const sel = o.sel?.node === n.id;
    const g = s("g", { class: `rt-node k-${n.kind} ${stateClass(st)}${sel ? " sel" : ""}${bad.has(n.id) ? " bad" : ""}${vn.main ? " main" : ""}`, transform: `translate(${vn.x},${vn.y})`, "data-node": n.id, tabindex: 0, role: "button",
      "aria-label": `${n.label} (${n.kind}${st ? `, ${st}` : ""}${n.checks?.length ? `, ${n.checks.length} checks` : ""})` });
    g.append(s("rect", { width: vn.w, height: vn.h, rx: 10, class: "rt-box" }), s("text", { x: 12, y: 21, class: "rt-label" }, fitText(n.label, n.checks?.length ? 13 : 20)),
      s("text", { x: 12, y: 39, class: "rt-kind" }, fitText(`${n.kind}${n.mode ? ` · ${n.mode}` : n.do ? ` · ${n.do}` : ""}`, 20)));
    if (st) g.setAttribute("data-state", st);
    if (o.editable && !o.simple) g.append(s("circle", { cx: vn.w, cy: vn.h / 2, r: 7, class: "rt-port", "data-port": n.id }));
    g.addEventListener("focus", () => { const v = view; if (vn.x < v.x || vn.y < v.y || vn.x + vn.w > v.x + v.w || vn.y + vn.h > v.y + v.h) { v.x = vn.x + vn.w / 2 - v.w / 2; v.y = vn.y + vn.h / 2 - v.h / 2; svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`); o.onView?.(v); } });
    if (o.onSelect) {
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); o.onSelect({ node: n.id }); }
        else if (o.editable && ev.key.startsWith("Arrow")) { ev.preventDefault(); const d = ev.shiftKey ? 50 : 10; const dx = ev.key === "ArrowLeft" ? -d : ev.key === "ArrowRight" ? d : 0, dy = ev.key === "ArrowUp" ? -d : ev.key === "ArrowDown" ? d : 0;
          if (o.simple) o.onNudge?.(n.id, dx, dy); else { o.onDragStart?.(lay); o.onMove(n.id, vn.x + dx, vn.y + dy, true); } }
        else if (o.editable && (ev.key === "Delete" || ev.key === "Backspace")) { ev.preventDefault(); o.onDeleteNode?.(n.id); }
      });
      g.addEventListener("click", (ev) => { if (svg.interactionActive) return; ev.stopPropagation(); if (!g.dataset.dragged && !svg.selectedOnUp) o.onSelect({ node: n.id }); delete g.dataset.dragged; delete svg.selectedOnUp; });
    }
    if (o.onDropCheck) { g.addEventListener("dragover", (ev) => { if (ev.dataTransfer.types.includes("text/x-check")) { ev.preventDefault(); g.classList.add("drop"); } }); g.addEventListener("dragleave", () => g.classList.remove("drop"));
      g.addEventListener("drop", (ev) => { ev.preventDefault(); g.classList.remove("drop"); const c = ev.dataTransfer.getData("text/x-check"); if (c) o.onDropCheck({ node: n.id }, c); }); }
    ng.append(g);
    // the simple view: checks, loops, folded asks and escalations hang under the node as small badges, the title keeps its room
    let bx = vn.x, by = vn.y + vn.h + 4;
    if (n.checks?.length) { g.setAttribute("data-checks", n.checks.length); const bt = T(`${n.checks.length} check${n.checks.length > 1 ? "s" : ""}`, `${n.checks.length} 項檢查`); const bw = bt.length * 6.4 + 14;
      if (o.simple) { badge(`n:${n.id}`, bx, by, bt, n.checks.map((c) => c.use), lg); bx += bw + 6; } else badge(`n:${n.id}`, vn.x + vn.w - bw - 6, vn.y + 6, bt, n.checks.map((c) => c.use), lg); }
    for (const b of (lay.badges?.[`node:${n.id}`] || [])) {
      const v = o.visits?.[n.id];
      const text = b.kind === "loop" ? (v ? T(`${b.text} · round ${Math.min(v, b.cap)}/${b.cap}`, `${b.text} · 第 ${Math.min(v, b.cap)}/${b.cap} 回合`) : `${b.text} ≤${b.cap}`) : b.kind === "ask" ? `? ${T(b.text, b.text === "asks you if unsure" ? "不確定時問你" : b.text)}` : b.text;
      const w = text.length * 6.4 + 14; if (bx + w > vn.x + vn.w + 8 && bx > vn.x) { bx = vn.x; by += 20; }
      const items = b.kind === "loop" ? [T(`${b.loop}: refine until the checks pass, at most ${b.cap} rounds`, `${b.loop}：精修到檢查通過，最多 ${b.cap} 回合`)] : b.kind === "ask" ? [b.node] : b.labels || [];
      badge(`${b.kind}:${n.id}`, bx, by, text, items, lg, b.kind); bx += w + 6;
    }
  }
  for (const f of pending) f();
  svg.append(sg, eg, ng, lg);
  const pt = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const setView = () => { svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`); o.onView?.(view); };
  if (o.editable) {
    // drag a node (the first drag of an auto layout keeps its positions: the version turns manual), drag from a port to connect, drag the background to pan
    let drag = null;
    svg.addEventListener("pointerdown", (ev) => {
      if (drag) return; // one owner; secondary pointers cannot overwrite its gesture
      svg.interactionActive = true;
      const port = ev.target.closest?.("[data-port]"); const node = ev.target.closest?.("[data-node]");
      const p = pt(ev);
      if (port) { drag = { kind: "wire", from: port.dataset.port, line: s("path", { class: "rt-wire", d: "" }) }; svg.append(drag.line); }
      else if (node) { const n = byId[node.dataset.node]; drag = { kind: "node", id: n.id, g: node, dx: p.x - n.x, dy: p.y - n.y, x0: n.x, y0: n.y, moved: false }; }
      else drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, vb: { ...view } };
      drag.pointerId = ev.pointerId; svg.setPointerCapture(ev.pointerId);
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return; const p = pt(ev);
      if (drag.kind === "node") { if (!drag.moved && !o.simple) o.onDragStart?.(lay); const n = byId[drag.id]; n.x = Math.round(p.x - drag.dx); n.y = Math.round(p.y - drag.dy); drag.moved = true; drag.g.setAttribute("transform", `translate(${n.x},${n.y})`); o.onDragging?.(drag.id, n.x, n.y); }
      else if (drag.kind === "wire") { const a = byId[drag.from]; drag.line.setAttribute("d", `M${a.x + a.w},${a.y + a.h / 2} L${p.x},${p.y}`); }
      else { const r = svg.getBoundingClientRect(); const k = view.w / r.width; view.x = drag.vb.x - (ev.clientX - drag.sx) * k; view.y = drag.vb.y - (ev.clientY - drag.sy) * k * (view.h / view.w) / (r.height / r.width); setView(); }
    });
    svg.addEventListener("pointerup", (ev) => {
      if (!drag || ev.pointerId !== drag.pointerId) return; const d = drag; drag = null; svg.interactionActive = false;
      if (d.kind === "node" && d.moved) { d.g.dataset.dragged = "1"; const n = byId[d.id]; if (o.simple) o.onNudge?.(d.id, n.x - d.x0, n.y - d.y0); else { o.onMove?.(d.id, n.x, n.y, false); o.onMoved?.(d.id); } }
      // a press and release without moving selects the node here: the svg holds the pointer capture, so the click that follows lands on the svg, not the node
      if (d.kind === "node" && !d.moved && o.onSelect) { svg.selectedOnUp = true; setTimeout(() => delete svg.selectedOnUp, 0); o.onSelect({ node: d.id }); }
      if (d.kind === "wire") { d.line.remove(); const el = document.elementFromPoint(ev.clientX, ev.clientY); const to = el?.closest?.("[data-node]")?.dataset.node; if (to && to !== d.from) o.onConnect?.(d.from, to); }
      o.onInteractionEnd?.();
    });
    const cancelInteraction = (ev) => {
      if (!drag || (ev && ev.pointerId !== drag.pointerId)) return; const d = drag; drag = null; svg.interactionActive = false;
      if (d.kind === "wire") d.line.remove();
      if (d.kind === "node" && d.moved) { const n = byId[d.id]; n.x = d.x0; n.y = d.y0; d.g.setAttribute("transform", `translate(${n.x},${n.y})`); }
      try { if (svg.hasPointerCapture(d.pointerId)) svg.releasePointerCapture(d.pointerId); } catch {}
      o.onInteractionEnd?.();
    };
    svg.cancelInteraction = () => cancelInteraction();
    svg.addEventListener("pointercancel", cancelInteraction);
    svg.addEventListener("lostpointercapture", cancelInteraction);
    svg.addEventListener("wheel", (ev) => { ev.preventDefault(); zoom(ev.deltaY > 0 ? 1.1 : 1 / 1.1, pt(ev)); }, { passive: false });
    svg.addEventListener("click", () => { if (svg.selectedOnUp) { delete svg.selectedOnUp; return; } if (!svg.interactionActive) o.onSelect?.(null); });
  }
  const zoom = (k, at) => { const c = at || { x: view.x + view.w / 2, y: view.y + view.h / 2 }; view.x = c.x - (c.x - view.x) * k; view.y = c.y - (c.y - view.y) * k; view.w *= k; view.h *= k; setView(); };
  svg.zoom = zoom; svg.view = view; svg.lay = lay; svg.setView = (v) => { Object.assign(view, v); setView(); };
  return svg;
}
// the minimap: every node as a dot-box and the visible part as a frame; click or drag to move there
function minimap(svg, onView) {
  const lay = svg.lay, b = lay.bbox, W = 220, H = Math.max(60, Math.min(140, Math.round(W * b.h / b.w)));
  const k = Math.min(W / b.w, H / b.h);
  const frame = s("rect", { class: "rt-mm-frame" });
  const m = s("svg", { class: "rt-minimap", width: W, height: H, viewBox: `${b.x} ${b.y} ${W / k} ${H / k}`, "data-minimap": "1", role: "img", "aria-label": T("Minimap", "縮圖") },
    ...lay.stages.map((st) => s("rect", { x: st.x, y: st.y, width: st.w, height: st.h, rx: 10, class: "rt-mm-stage" })),
    ...lay.nodes.map((n) => s("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 6, class: `rt-mm-node${n.main ? " main" : ""}` })), frame);
  const sync = () => { const v = svg.view; frame.setAttribute("x", v.x); frame.setAttribute("y", v.y); frame.setAttribute("width", v.w); frame.setAttribute("height", v.h); };
  const go = (ev) => { const r = m.getBoundingClientRect(); const x = b.x + (ev.clientX - r.left) / k, y = b.y + (ev.clientY - r.top) / k; const v = svg.view; svg.setView({ x: x - v.w / 2, y: y - v.h / 2 }); sync(); onView?.(svg.view); };
  let down = false; m.addEventListener("pointerdown", (ev) => { down = true; m.setPointerCapture(ev.pointerId); go(ev); }); m.addEventListener("pointermove", (ev) => { if (down) go(ev); }); m.addEventListener("pointerup", () => { down = false; });
  m.sync = sync; sync(); return m;
}

// ---------- Workflows ----------
const WF = { list: null, ed: null, listGeneration: 0 };
function newWorkflow() {
  const name=h("input",{class:"input","data-wf-create-name":"1",maxlength:120,autocomplete:"off"});
  const id=h("input",{class:"input","data-wf-create-id":"1",maxlength:41,autocomplete:"off",spellcheck:false});
  const message=h("div",{role:"status","data-wf-create-error":"1",class:"faint"});
  let editedId=false,pending=false;
  name.addEventListener("input",()=>{if(!editedId)id.value=name.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,41);});
  id.addEventListener("input",()=>{editedId=true;});
  const body=h("div",{class:"rt-create-form"},
    h("p",{class:"faint"},T("Create a starter with a confirmation card and an end. Edit its graph before starting a task.","建立含確認卡片與結束節點的起始流程。可先編輯流程圖，再開始任務。")),
    h("label",{},T("Workflow name","流程名稱"),name),
    h("label",{},T("Workflow id","流程代號"),id),
    h("p",{class:"faint"},T("Use lowercase letters, numbers and hyphens. The id cannot be changed later.","使用小寫英文字母、數字與連字號。建立後無法變更代號。")),message);
  modal(T("New workflow","新增流程"),body,async(close,button)=>{
    if(pending)return;
    if(!name.value.trim()||name.value.trim().length>120){message.textContent=T("Enter a workflow name (up to 120 characters).","請輸入流程名稱（最多 120 個字元）。");name.focus();return;}
    if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id.value)){message.textContent=T("Use 1–41 lowercase letters, numbers or hyphens for the id.","代號須為 1–41 個小寫英文字母、數字或連字號。");id.focus();return;}
    pending=true;button.disabled=true;name.disabled=id.disabled=true;dialog?.querySelectorAll("button").forEach(b=>{b.disabled=true;});message.textContent=T("Creating…","建立中…");
    try{const r=await api("/api/wf",{id:id.value,name:name.value.trim(),locale:window.crewI18n.modelLang(lang)});WF.listGeneration++;WF.list=null;if(!body.isConnected)return;close();location.hash=`#/workflows/${r.def.id}`;}
    catch(error){message.textContent=/already exists/.test(error.message)?T("This workflow id already exists. Choose another id.","此流程代號已存在，請換一個代號。"):T("Could not create the workflow. Try again.","無法建立流程，請重試。");}
    finally{pending=false;button.disabled=false;name.disabled=id.disabled=false;dialog?.querySelectorAll("button").forEach(b=>{b.disabled=false;});}
  });
  const dialog=body.closest("[role=dialog]");const submit=dialog?.querySelector(".btn.primary");if(submit){submit.textContent=T("Create workflow","建立流程");submit.dataset.wfCreateSubmit="1";}
  const backdrop=dialog?.parentElement;
  backdrop?.addEventListener("click",event=>{if(pending&&event.target===backdrop){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  backdrop?.addEventListener("keydown",event=>{if(pending&&event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});name.focus();
}
function workflowTrashDialog(w,restore=false){
  const dlg=h("dialog",{"data-workflow-trash-dialog":"",class:"card x-pad"}),status=h("p",{role:"status"}),ownerHash=location.hash;let pending=false;
  dlg.append(h("h2",{},restore?T("Restore workflow?","復原流程？"):T("Move workflow to Trash?","將流程移至垃圾桶？")),h("p",{},w.name),h("p",{},restore?T("This workflow will be available for new Tasks again.","復原後可再次用於新任務。"):T("You can restore it from Trash. Saved versions and existing Tasks stay available.","你可以從垃圾桶復原。已儲存的版本與既有任務都會保留。")),h("div",{class:"actions"},h("button",{class:"btn","data-workflow-trash-cancel":"",onclick:()=>{if(pending)return;dlg.close();dlg.remove();}},T("Cancel","取消")),h("button",{class:"btn primary","data-workflow-trash-confirm":"",onclick:async e=>{if(pending)return;pending=true;e.target.disabled=true;dlg.querySelector("[data-workflow-trash-cancel]").disabled=true;try{await api(`/api/wf/${w.id}/${restore?"restore":"trash"}`,{base:w.version,revision:w.trashRevision??0});WF.list=null;WF.listGeneration++;RN.list=null;if(dlg.isConnected&&location.hash===ownerHash){WF.ed?.dispose?.();WF.ed=null;dlg.close();dlg.remove();location.hash="#/workflows";rerender();}else{dlg.close();dlg.remove();}}catch(err){status.textContent=err.message;}finally{pending=false;e.target.disabled=false;const cancel=dlg.querySelector("[data-workflow-trash-cancel]");if(cancel)cancel.disabled=false;}}},restore?T("Restore","復原"):T("Move to Trash","移至垃圾桶"))),status);
  dlg.addEventListener("cancel",event=>{if(pending){event.preventDefault();return;}dlg.remove();});document.body.append(dlg);dlg.showModal();
}
function workflowTrashButton(w,restore=false){return h("button",{class:"btn sm",[restore?"data-workflow-restore":"data-workflow-trash"]:w.id,onclick:e=>{e.preventDefault();e.stopPropagation();workflowTrashDialog(w,restore);}},restore?T("Restore","復原"):T("Move to Trash","移至垃圾桶"));}

function workflowCatalogCard(w,held=false){
  const link=h("a",{class:"rt-wf-link",href:`#/workflows/${w.id}`,[held?"data-wf-held":"data-wf"]:w.id},h("div",{class:"rt-wf-h"},h("b",{},w.name),h("span",{class:"vbadge"},`v${w.version}`)),h("p",{class:"faint"},(w.description||"").slice(0,220)),held?h("span",{class:"badge neutral","data-wf-held-reason":w.id},T(w.held.en,w.held.zh)):h("span",{class:"faint"},T(`${w.nodes} nodes · ${w.versions} versions`,`${w.nodes} 個節點 · ${w.versions} 個版本`)));
  return h("div",{class:"card rt-wf"},link,w.personal?workflowTrashButton(w):null);
}

function viewWorkflows(arg) {
  if (arg) return viewEditor(arg);
  WF.ed?.dispose?.(); WF.ed = null;
  if (!WF.list) { const generation=++WF.listGeneration; WF.list = "loading"; api("/api/wf").then((j) => { if(generation!==WF.listGeneration)return; WF.list = j.workflows; WF.held = j.held || []; WF.trash=j.trash||[]; rerender(); }).catch(() => { if(generation!==WF.listGeneration)return; WF.list = []; rerender(); }); }
  const list = Array.isArray(WF.list) ? WF.list : [];
  return h("div", { class: "page" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Workflows", "流程")), h("p", {}, T("Studio's workflows. Open one to see and edit its graph; every save is a new version, and tasks keep the version they started on.", "Studio 的流程。打開一個就能看到並編輯它的流程圖；每次儲存都是新版本，進行中的任務維持它開始時的版本。"))), h("a",{class:"btn",href:"#/first-workflow","data-first-workflow-open":""},T("First workflow tutorial","第一個流程教學")),h("button",{class:"btn primary","data-wf-new":"1",onclick:newWorkflow},T("New workflow","新增流程"))),
    WF.list === "loading" || WF.list === null ? h("div", { class: "skel", style: "height:160px" }) :
    h("div", { class: "rt-cards" },list.map(w=>workflowCatalogCard(w))),
    Array.isArray(WF.list)&&(WF.held||[]).length?h("div",{class:"rt-cards","data-wf-held-list":"1"},WF.held.map(w=>workflowCatalogCard(w,true))):null,
    h("details",{"data-workflow-trash-list":"",class:"card x-pad",open:WF.trashOpen||null,ontoggle:e=>{WF.trashOpen=e.target.open;}},h("summary",{},T("Trash","垃圾桶")+` (${(WF.trash||[]).length})`),...(WF.trash||[]).map(w=>h("div",{class:"rt-row","data-trashed-workflow":w.id},h("a",{href:`#/workflows/${w.id}`},w.name+` · v${w.version}`),workflowTrashButton(w,true)))));
}

function viewEditor(arg) {
  const [id, vs] = arg.split("/"); const v = vs && /^v\d+$/.test(vs) ? Number(vs.slice(1)) : null;
  const key = `${id}@${v ?? "latest"}`;
  if (!WF.ed || WF.ed.key !== key) { WF.ed?.dispose?.(); WF.ed = { key, id, v, loading: true, el: null }; loadEditor(WF.ed); }
  if (WF.ed.loading) return h("div", { class: "page" }, h("div", { class: "skel", style: "height:420px" }));
  if (WF.ed.error) return h("div", { class: "page" }, h("div", { class: "card x-pad" }, WF.ed.error));
  if (WF.ed.def?.kind === "coffee-kit" && !arg.endsWith("/advanced")) { if(!WF.ed.guide)WF.ed.guide=buildCoffeeGuide(WF.ed);return WF.ed.guide; }
  if(WF.ed.def.nodes.some(n=>n.do==="github.review.wait")&&!arg.endsWith("/advanced")){if(!WF.ed.guide)WF.ed.guide=buildGitHubReviewGuide(WF.ed);return WF.ed.guide;}
  if (!WF.ed.el) WF.ed.el = buildEditor(WF.ed);
  return WF.ed.el;
}
function buildGitHubReviewGuide(ed){
 const root=h('div',{class:'page','data-github-review-guide':''}),project=h('input',{class:'input',required:true,'aria-label':T('Registered project ID','已註冊專案 ID')}),url=h('input',{class:'input',required:true,type:'url',placeholder:'https://github.com/owner/repo/pull/123','aria-label':'PR URL'}),name=h('input',{class:'input',required:true,'aria-label':T('Template name','模板名稱')}),id=h('input',{class:'input',required:true,pattern:'[a-z0-9][a-z0-9-]{0,40}','aria-label':T('Template ID','模板 ID')}),status=h('p',{role:'status','aria-live':'polite'}),found=h('div',{'data-github-review-accounts':''});let scan=null,community=null,busy=false;const publication=h('div',{'data-github-publication':''}),template=h('select',{'aria-label':T('PR template choice','PR 模板選擇')}),title=h('input',{class:'input',required:true,maxlength:200,'aria-label':T('PR title','PR 標題')}),body=h('textarea',{class:'input',rows:12,required:true,maxlength:60000,'aria-label':T('PR body preserving template','保留模板的 PR 內容')}),confirmed=h('input',{type:'checkbox',required:true});template.onchange=()=>{const f=community?.pulls.find(x=>x.path===template.value);body.value=f?.text||'';confirmed.checked=false;};
 const scanButton=h('button',{class:'btn',type:'button',onclick:async()=>{if(busy)return;busy=true;scanButton.disabled=true;save.disabled=true;try{scan=await api('/api/github-review/scan',{project:project.value.trim(),url:url.value.trim()});community=await api('/api/github-review/community',{project:project.value.trim()});template.replaceChildren(h('option',{value:''},T('Choose template explicitly','明確選擇模板')),...community.pulls.map(f=>h('option',{value:f.path},`${f.repository} / ${f.path} · ${f.blob.slice(0,12)}`)));if(!community.pulls.length)template.replaceChildren(h('option',{value:''},T('No applicable PR template found','未找到適用 PR 模板')));publication.replaceChildren(...[h('h2',{},T('Contribution rules and publication draft','貢獻規則與發佈草稿')),h('p',{},T('Select the exact source. Preserve its literal text and unchecked checkboxes; add actual evidence. Missing JIRA/testing/security inputs require discussion, never automatic ticks.','請選擇確切來源並保留原文與未勾選項目，再加入實際證據。JIRA、測試或安全資料不足時需討論，不會自動勾選。')),template,title,body,community.contributing?h('details',{},h('summary',{},'CONTRIBUTING · '+community.contributing.path),h('pre',{},community.contributing.text)):null,community.agents?h('details',{},h('summary',{},T('Repository instructions (untrusted guidance)','儲存庫指示（非權限授予）')),h('pre',{},community.agents.text)):null,h('label',{},confirmed,T('I supplied required inputs for this template. Unverified checks remain unchecked.','我已提供此模板的必要資料；未驗證項目維持未勾選。'))].filter(Boolean));found.replaceChildren(h('p',{},T('Scanned head: ','掃描版本：'),h('code',{},scan.head)),...scan.accounts.map(a=>h('label',{class:'github-review-account'},h('input',{type:'checkbox','data-reviewer':a.id,'data-login':a.login}),`${a.login} · ID ${a.id} · ${a.evidence.length} ${T('evidence records','筆證據')}`,h('select',{'data-required':a.id,'aria-label':a.login+' requirement'},h('option',{value:'required'},T('Required','必要審查者')),h('option',{value:'advisory'},T('Advisory','建議審查者'))))),h('p',{},T('An account being present is not approval. Old-head reviews and ordinary comment SHA claims never unlock work.','找到帳號不代表核准；舊版本審查與普通留言中的 SHA 宣稱不會放行工作。')),h('details',{},h('summary',{},T('Observed reviews and findings — current head only','已觀察的審查與意見——僅目前版本')), ...scan.evidence.map(e=>h('div',{class:'card'},h('b',{},`${e.login} · ${e.kind} · ${e.state}`),h('p',{},e.head===scan.head?T('Current head','目前版本'):e.head?T('Older head — not approval','舊版本——不算核准'):T('No verified commit binding — not approval','未驗證 commit 綁定——不算核准')),h('pre',{},e.body||T('(empty body)','（內容空白）')),h('a',{href:e.url,target:'_blank',rel:'noopener noreferrer'},T('Read source evidence','閱讀來源證據'))))));status.textContent=T('Choose actual account IDs, confirm required/advisory policy, then save. Manual triggers only; no message will be sent.','請選擇實際帳號 ID 並確認必要／建議政策後儲存。只使用手動觸發，不會發送訊息。');save.disabled=false;}catch(e){scan=null;found.replaceChildren();status.textContent=e.message;}finally{busy=false;scanButton.disabled=false;}}},T('Scan PR (read only)','唯讀掃描 PR'));
 const save=h('button',{class:'btn primary',type:'submit',disabled:true},T('Confirm policy and save my template','確認政策並儲存我的模板'));
 const form=h('form',{onsubmit:async e=>{e.preventDefault();if(!scan||busy)return;const accounts=[...found.querySelectorAll('[data-reviewer]:checked')].map(x=>({id:Number(x.dataset.reviewer),login:x.dataset.login,required:found.querySelector(`[data-required="${x.dataset.reviewer}"]`).value==='required'}));if(!accounts.some(a=>a.required)){status.textContent=T('Choose at least one required reviewer.','請至少選擇一位必要審查者。');return;}busy=true;save.disabled=true;try{const r=await api('/api/github-review/template',{project:project.value.trim(),url:url.value.trim(),id:id.value.trim(),name:name.value.trim(),confirm:true,publication:{path:template.value,blob:community?.pulls.find(f=>f.path===template.value)?.blob||'',title:title.value,body:body.value,requiredInputsConfirmed:confirmed.checked,sources:community?.sha256},policy:{schema:1,repository:scan.repository,pr:scan.pr,accounts,trigger:'manual'}});WF.list=null;location.hash=r.href.slice(1);}catch(e){status.textContent=e.message;}finally{busy=false;save.disabled=false;}}},h('label',{},T('Registered GitHub project','已註冊 GitHub 專案'),project),h('label',{},'PR URL',url),scanButton,found,publication,h('label',{},T('My template ID','我的模板 ID'),id),h('label',{},T('My template name','我的模板名稱'),name),save,status);
 root.append(h('h1',{},T('GitHub coding and external review','GitHub 開發與外部審查')),ed.held?h('p',{class:'badge neutral','data-workflow-held':'1'},T(ed.held.en,ed.held.zh)):null,h('p',{},T('Save an editable pipeline without starting work. Account identity confirmation and required/advisory policy are separate decisions. No automatic comments, triggers or merge.','先儲存可編輯流程，不啟動工作。帳號身分確認與必要／建議政策是不同決定；不會自動評論、觸發或合併。')),h('p',{class:'faint'},T('Initial slice: discovery and template editing. Coding/review runtime activation is held; pressing Run cannot allocate paid jobs.','初版提供掃描與模板編輯；開發／審查執行整合尚未開放，按執行不會分配付費工作。')),form,h('a',{href:`#/workflows/${ed.id}/advanced`},T('Preview and edit the graph','預覽與編輯流程圖')));return root;
}
function buildCoffeeGuide(ed) {
  const choice=ed.coffeeChoice,root=h("div",{class:"page rt-coffee-guide","data-coffee-guide":"1"});
  const name=h("input",{class:"input",value:ed.def.id==="coffee-kit"?T("My coffee website","我的咖啡店網站","我的咖啡店网站"):ed.def.name,maxlength:120,required:true});
  const brief=h("textarea",{class:"input",rows:5,required:true,placeholder:T("Tell Firstmate about your coffee shop and what visitors should feel. Leave unknown business facts out.","告訴 Firstmate 你的咖啡店特色，以及希望訪客感受到什麼。未知的營業資訊先留白。","告诉 Firstmate 你的咖啡店特色，以及希望访客感受到什么。未知的营业信息先留白。")});
  const project=h("input",{class:"input",required:true,maxlength:200,pattern:"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}","data-coffee-project":"1",value:"my-coffee-shop",placeholder:"my-coffee-shop"});
  const plan=h("textarea",{class:"input",rows:14,"data-coffee-design":"1","aria-label":T("Complete discussed design plan","完整討論後的設計計畫","完整讨论后的设计计划"),placeholder:T("Review the complete editable version-1 plan suggested by Firstmate before approving.","確認 Firstmate 建議的完整可修改 version-1 計畫，再決定是否核准。","确认 Firstmate 建议的完整可修改 version-1 计划，再决定是否批准。")});
  const status=h("p",{role:"status","aria-live":"polite"}),start=h("button",{class:"btn",type:"submit"},T("Review this design plan","檢視這份設計計畫","查看这份设计计划"));
  let pending=false,created=null,uncertain=false;
  const discuss=h("button",{class:"btn primary",type:"button","data-coffee-discuss":"1",onclick:async()=>{
    if(pending)return;if(!brief.value.trim()){status.textContent=T("Describe your goal first.","請先描述你的目標。","请先描述你的目标。");brief.focus();return;}pending=true;discuss.disabled=true;
    try{const main=await api("/api/main");if(main.context!=="studio"||main.state!=="attached"||main.driver?.holder!=="studio"||main.origin){status.textContent=T("Connect your account and start your own Firstmate first.","請先連接帳號並啟動你自己的 Firstmate。","请先连接账号并启动你自己的 Firstmate。");return;}
      await api("/api/main/send",{text:`Prepare one complete editable default coffee-shop website proposal for me before generating any assets. Artifact project: ${project.value.trim()||'ask me to choose an explicit project name'}. Native workflow: ${ed.def.id} v${ed.def.version}. Name: ${name.value.trim()}. Goal: ${brief.value.trim()}. Suggest one coherent editable default plan covering the website, image, three-beat twelve-second video and responsive playback; ask only about essential missing information, not a long questionnaire. Do not invent business facts. Iterate an editable complete design proposal. I want a new complete available default crew, replacing old draft suggestions: call studio_staffing_interview with defaults:"reset" to set all roles at once, then show the full configuration approval card. Do not make me choose each role’s provider/model/effort in three rounds or manually Verify Claude. Explain that video is a pinned local HyperFrames tool rather than a fictitious model role. Confirm the project-local staffing configuration with my real approval card. Never assume the primary account is the worker. Only after both shared plan and staffing are agreed, use studio_list_workflows and studio_propose_work with the required validated coffeeDesignPlan JSON; never approve cards yourself.${plan.value.trim()?" My current editable draft (not approval): "+plan.value.trim():""}`});location.hash="#/firstmate?workflow=coffee-kit&staffing="+encodeURIComponent(project.value.trim());
    }catch(e){status.textContent=e.message;}finally{pending=false;discuss.disabled=false;}
  }},T("Discuss the design with Firstmate","與 Firstmate 討論設計","与 Firstmate 讨论设计"));
  const form=h("form",{class:"card x-pad",onsubmit:async event=>{
    event.preventDefault();if(pending)return;if(!project.value.trim()||!name.value.trim()||!brief.value.trim()||!plan.value.trim()){status.textContent=T("Discuss the complete design with Firstmate first. A full plan is required before creation.","請先與 Firstmate 討論完整設計；製作前必須有完整計畫。","请先与 Firstmate 讨论完整设计；制作前必须有完整计划。");return;}
    pending=true;start.disabled=true;status.textContent=T("Validating your editable plan…","正在驗證可編輯的計畫…","正在验证可编辑的计划…");
    try{let input;try{input=JSON.parse(plan.value);}catch{throw new Error(T("The plan must be valid JSON.","計畫必須是有效的 JSON。","计划必须是有效的 JSON。"));}const validated=await api("/api/coffee/design",{plan:input});plan.value=JSON.stringify(validated.plan,null,2);
      const def=ed.def;uncertain=true;
      const r=await api("/api/wruns",{workflow:def.id,version:def.version,title:name.value.trim(),text:brief.value.trim(),params:{project:project.value.trim(),coffeeDesignPlan:validated.canonical}});if(root.isConnected)location.hash=`#/run/${r.id}`;
    }catch(e){if(e.code==="coffee-staffing-required"){uncertain=false;status.textContent=T("Discuss and approve this project’s role models and skills with Firstmate before starting. Your plan is preserved.","請先與 Firstmate 討論並核准此專案各角色的模型與技能；計畫已保留。","请先与 Firstmate 讨论并批准此项目各角色的模型与技能；计划已保留。");}else status.textContent=uncertain?T("Could not confirm the Task result. Your draft is preserved; check Tasks before trying again.","尚無法確認任務結果；草稿已保留，請先查看任務列表。","尚无法确认任务结果；草稿已保留，请先查看任务列表。"):e.message;}finally{pending=false;if(root.isConnected)start.disabled=uncertain;}
  }},h("label",{},T("Artifact project (confirmed staffing)","作品專案（已確認派工配置）","作品项目（已确认派工配置）"),project),h("label",{},T("Website name","網站名稱","网站名称"),name),h("label",{},T("What should visitors know and feel?","希望訪客認識什麼、感受到什麼？","希望访客了解什么、感受到什么？"),brief),discuss,h("p",{},T("First discuss the website, image, video storyboard and their integration. You can revise the proposal freely. No creation starts until you confirm the complete pinned plan.","先討論網站、圖片、影片分鏡及整合方式。計畫可以先自由修改；只有你確認完整且已鎖定的計畫後，才會開始製作。","先讨论网站、图片、影片分镜及整合方式。计划可以先自由修改；只有你确认完整且已锁定的计划后，才会开始制作。")),h("details",{"data-coffee-plan-editor":"1"},h("summary",{},T("Review or edit a structured proposal","檢視或編輯結構化提案","查看或编辑结构化提案")),h("label",{},T("Complete discussed design plan","完整討論後的設計計畫","完整讨论后的设计计划"),plan),start),status);
  root.append(h("div",{class:"phead"},h("div",{},h("h1",{},T("Design your coffee-shop website together","一起設計你的咖啡店網站","一起设计你的咖啡店网站")),h("p",{},T("Discuss the page, image and film before creating one cohesive experience.","先一起討論網頁、圖片與短片，再製作風格一致的整體體驗。","先一起讨论网页、图片与短片，再制作风格一致的整体体验。")))),h("ol",{class:"rt-coffee-steps"},[T("Connect your account and start Firstmate","連接帳號並啟動 Firstmate","连接账号并启动 Firstmate"),T("Discuss and edit the whole design and storyboard","討論、修改整體設計與影片分鏡","讨论、修改整体设计与影片分镜"),T("Confirm the exact shared plan, then create previews","確認共同計畫後，再開始製作預覽","确认共同计划后，再开始制作预览"),T("Comment on a specific artifact; approve the complete website","針對作品回饋，最後驗收完整網站","针对作品反馈，最后验收完整网站")].map(text=>h("li",{},text))),h("button",{class:"btn",type:"button",onclick:()=>{if(window.crewConnectCodex)window.crewConnectCodex();else status.textContent=T("Open the account panel in Firstmate.","請開啟 Firstmate 的帳號面板。","请打开 Firstmate 的账号面板。");}},T("Connect Codex account","連接 Codex 帳號","连接 Codex 账号")),h("p",{},T("Every role uses your approved project staffing and the skills of the selected workflow version. Your Firstmate account is separate; no worker model is chosen automatically.","各角色使用你已核准的專案派工，技能依指定的 workflow 版本執行；Firstmate 帳號另行設定，不會自動替你挑選工作模型。","各角色使用你已核准的专案派工，技能依指定的 workflow 版本执行；Firstmate 帐号另行设定，不会自动替你挑选工作模型。")),ed.coffeeFilmStatus?.ready?null:h("p",{role:"status"},T("Video tools are not ready; page/image previews can be reviewed, but complete-site approval will wait. Install the pinned local Node/HyperFrames, Chromium and ffmpeg/ffprobe tools, then restart Studio.","影片工具尚未就緒；可以檢視網頁與圖片預覽，但完整網站驗收會等待。請安裝固定版本的本機 Node／HyperFrames、Chromium 及 ffmpeg／ffprobe，然後重新啟動 Studio。","视频工具尚未就绪；可以查看网页与图片预览，但完整网站验收会等待。请安装固定版本的本机 Node／HyperFrames、Chromium 及 ffmpeg／ffprobe，然后重新启动 Studio。")),form,h("a",{class:"btn ghost",href:`#/workflows/${ed.id}${ed.v?`/v${ed.v}`:""}/advanced`},T("Advanced workflow graph","進階流程圖","高级流程图")));
  return root;
}
async function loadEditor(ed) {
  try {
    const [j, all, lib, workspace] = await Promise.all([api(`/api/wf/${ed.id}${ed.v ? `?v=${ed.v}` : ""}`), api("/api/wf"), api("/api/skills").catch(() => ({ skills: [], caps: {} })), api("/api/wf/drafts").catch(() => ({}))]);
    let mode = "auto"; try { mode = (await api(`/api/graph-layout/${ed.id}/v${j.def.version}`)).mode; } catch {}
    const phone = matchMedia("(max-width: 640px)").matches;
    Object.assign(ed, { workspaceScope:workspace.scope||null, mode, collapsed: phone ? (window.crewLayout.stagesFor(j.def) || []).map((x) => x.id) : [], loading: false, selectable:j.selectable!==false, personal:j.personal===true, trash:j.trash||null, held:j.held||null, coffeeChoice:j.coffeeChoice, coffeeFilmStatus:j.coffeeFilmStatus, def: clone(j.def), saved: clone(j.def), versions: j.versions, runs: j.runs, problems: j.problems, checks: all.checks, lib: lib.skills || [], skillCap: lib.caps?.node || 0, sel: null, overlay: null, states: null, lastDiff: null, dirty: false });
  } catch (e) { ed.loading = false; ed.error = e.message; }
  if (WF.ed === ed) rerender();
}
async function copyWorkflowTemplate(ed,asTemplate){
  if(ed.dirty)throw new Error(T("Save edits before copying this version.","请先保存修改，再复制这个版本。"));
  const dlg=h("dialog",{class:"fw-dialog","data-template-dialog":""}),name=h("input",{class:"input",value:ed.def.name+(asTemplate?T(" template"," 模板"):T(" copy"," 副本")),maxlength:120,"data-template-name":""}),status=h("p",{role:"status"});
  const id=(asTemplate?"template-":"workflow-")+crypto.randomUUID().slice(0,8);let pending=false;
  dlg.append(h("h2",{},asTemplate?T("Save reusable template","保存可复用模板"):T("Create from template","从模板创建流程")),h("p",{},T(`Copy saved v${ed.saved.version}. Tasks, artifacts and approvals stay with the original.`, `复制已保存的 v${ed.saved.version}，任务、产物和核准记录留在原流程。`)),h("label",{},T("Name","名称"),name),h("div",{class:"actions"},h("button",{class:"btn",onclick:()=>{dlg.close();dlg.remove();}},T("Cancel","取消")),h("button",{class:"btn primary","data-template-confirm":"",onclick:async e=>{if(pending)return;pending=true;e.target.disabled=true;try{const r=await api(`/api/wf/${ed.id}/copy`,{id,name:name.value.trim(),version:ed.saved.version,asTemplate});WF.list=null;WF.listGeneration++;dlg.close();dlg.remove();location.hash=`#/workflows/${r.def.id}`;}catch(err){status.textContent=err.message;}finally{pending=false;e.target.disabled=false;}}},asTemplate?T("Save template","保存模板"):T("Create workflow","创建流程"))),status);dlg.addEventListener("cancel",()=>dlg.remove());document.body.append(dlg);dlg.showModal();name.focus();
}
function workflowChanges(before,after){
  const rows=[];const clean=n=>Object.fromEntries(Object.entries(n).filter(([k])=>!["x","y"].includes(k)));const byId=new Map(before.nodes.map(n=>[n.id,n]));
  for(const n of after.nodes){const old=byId.get(n.id);byId.delete(n.id);if(!old)rows.push({label:n.label,before:T("Absent","无"),after:JSON.stringify(clean(n),null,2)});else if(JSON.stringify(clean(old))!==JSON.stringify(clean(n))){const keys=[...new Set([...Object.keys(old),...Object.keys(n)])].filter(k=>!["x","y"].includes(k)&&JSON.stringify(old[k])!==JSON.stringify(n[k]));rows.push({label:n.label,before:keys.map(k=>`${k}: ${JSON.stringify(old[k]??null)}`).join("\n"),after:keys.map(k=>`${k}: ${JSON.stringify(n[k]??null)}`).join("\n")});}}
  for(const n of byId.values())rows.push({label:n.label,before:JSON.stringify(clean(n),null,2),after:T("Removed","已删除")});
  if(JSON.stringify(before.edges)!==JSON.stringify(after.edges))rows.push({label:T("Connections and edge checks","连线与连线检查"),before:JSON.stringify(before.edges,null,2),after:JSON.stringify(after.edges,null,2)});
  for(const k of ["name","description","roles","params","policies","hooks","intents","sample","compare"])if(JSON.stringify(before[k])!==JSON.stringify(after[k]))rows.push({label:k,before:JSON.stringify(before[k]??null,null,2),after:JSON.stringify(after[k]??null,null,2)});
  return rows;
}
function workflowBriefKey(ed){return ed.workspaceScope?`crew.workflow.startBrief.v1:${ed.workspaceScope}:${ed.id}`:null;}
function workflowBrief(ed){if(ed.startBrief===undefined){const key=workflowBriefKey(ed);ed.startBrief=(key?store.get(key):null)??ed.def.origin?.brief?.goal??ed.def.sample?.text??"";}return ed.startBrief;}
function saveWorkflowBrief(ed,value){ed.startBrief=value;const key=workflowBriefKey(ed);if(key)store.set(key,value);}
function buildEditor(ed) {
  const root = h("div", { class: "page rt-editor", "data-editor": ed.id });
  const status = h("div", { class: "rt-status", role: "status", "aria-live": "polite" });
  const direction=h("textarea",{class:"input",rows:4,maxlength:2000,"data-workflow-brief":"",placeholder:T("Describe the website, audience, style and outcome you want.","描述你想做的網頁、使用對象、風格與預期成果。"),oninput:e=>saveWorkflowBrief(ed,e.target.value)});direction.value=workflowBrief(ed);
  const briefPanel=h("section",{class:"card x-pad","data-workflow-start-brief":""},h("h2",{},T("What would you like this workflow to make?","這次希望流程幫你做什麼？")),h("label",{class:"rt-field"},h("span",{},T("Task requirements and website direction","任務需求與網頁方向")),direction),h("p",{class:"faint"},T("Saved in this browser for this workflow. Discuss first, or review these requirements when you click Run. Nothing starts automatically.","內容會保留在這個瀏覽器的此流程草稿。你可以先討論，或按下執行時再確認需求；不會自動開始任務。")),h("button",{class:"btn","data-workflow-discuss":"",onclick:()=>{const message=T(`Discuss the direction before running workflow ${ed.id} v${ed.saved.version} (${ed.saved.name}). Ask one short question at a time and help refine my task brief. Do not start a Task or change the workflow until I explicitly confirm. My current requirements: `,`執行流程 ${ed.id} v${ed.saved.version}（${ed.saved.name}）之前，先和我討論方向，一次問一個簡短問題，幫我完善任務需求。在我明確確認之前，不要啟動任務或修改流程。我的目前需求： `)+direction.value;chatMode="main";store.set("crew.chatMode","main");openChat(true);const input=document.querySelector("#chatIn");if(input){if(!input.value.includes(message))input.value+=(input.value.trim()?"\n\n":"")+message;input.dispatchEvent(new Event("input",{bubbles:true}));input.focus();}}},T("Discuss with Firstmate first","先和 Firstmate 討論")));

  const stepList=h("section",{class:"card x-pad","data-workflow-step-list":""});
  const canvas = h("div", { class: "rt-canvas" });
  const dock = h("div", { class: "rt-mm-dock" }); // the minimap sits here, outside the canvas: it never covers the graph
  const canvasWrap = h("div", { class: "rt-canvas-wrap" }, canvas, dock);
  let gview = (() => { try { return localStorage.getItem("crew.graphView") === "detail" ? "detail" : "simple"; } catch { return "simple"; } })();
  ed.offsets = ed.offsets || {};
  // the simple view wraps the main path into bands narrow enough to read at Fit (node titles 15 units → at least 11 px)
  const wrapFor = () => { const w = canvas.getBoundingClientRect().width || Math.min(innerWidth - 40, 1100); return Math.max(1, Math.min(8, Math.floor((w * 15 / 11 - 80) / window.crewLayout.COL))); };
  const panel = h("aside", { class: "rt-panel card", "aria-label": T("Selection", "選取的項目") });
  const probs = h("div", { class: "rt-problems" });
  const say = (t) => { status.textContent = t; };
  let view = null, vtimer = null, validationGeneration = 0, validationAbort = null, disposed = false, draftRevision = 0, savePending = false;
  const checkMan = (ref) => ed.checks.find((c) => c.ref === ref);
  const dirty = () => { draftRevision++; ed.dirty = true; validateSoon(); draw(); };
  const validateSoon = () => {
    clearTimeout(vtimer); validationAbort?.abort(); const generation = ++validationGeneration;
    vtimer = setTimeout(async () => {
      const controller = new AbortController(); validationAbort = controller;
      try {
        const r = await api("/api/wf/validate", { def: clone(ed.def) }, undefined, controller.signal);
        if (disposed || WF.ed !== ed || generation !== validationGeneration) return;
        ed.problems = r.problems; drawProblems(); draw();
      } catch {} finally { if (validationAbort === controller) validationAbort = null; }
    }, 250);
  };
  const drawProblems = () => { const errs = (ed.problems || []).filter((p) => p.level === "error"); const warns = (ed.problems || []).filter((p) => p.level !== "error");
    probs.replaceChildren(h("div", { class: `rt-valid ${errs.length ? "bad" : "ok"}`, "data-valid": errs.length ? "errors" : "ok" }, errs.length ? T(`${errs.length} problem${errs.length > 1 ? "s" : ""}: it cannot be saved or run`, `${errs.length} 個問題：無法儲存或執行`) : T("Valid: every node is reachable, an end is reachable, checks are attached", "有效：每個節點都走得到、終點走得到、檢查都掛好了")),
      ...[...errs, ...warns].slice(0, 12).map((p) => h("div", { class: `rt-prob ${p.level}`, "data-problem": p.node || p.edge || "" }, `${p.level === "error" ? "✗" : "!"} ${p.text}`))); };
  const persistLayout = async (nid) => { // dragging keeps positions per version (no new version) for nodes the saved version has
    await ed.manualP; // the switch from the auto layout saves every position first
    const savedIds = new Set(ed.saved.nodes.map((n) => n.id)); if (!savedIds.has(nid)) return;
    const n = ed.def.nodes.find((x) => x.id === nid); const sv = ed.saved.nodes.find((x) => x.id === nid); if (sv) { sv.x = n.x; sv.y = n.y; }
    try { await api(`/api/wf/${ed.id}/layout`, { version: ed.def.version, positions: { [nid]: { x: n.x, y: n.y } } }); say(T(`${n.label} moved (position kept for v${ed.def.version})`, `${n.label} 已移動（位置保存在 v${ed.def.version}）`)); } catch (e) { say(e.message); }
  };
  const uniq = (base) => { let i = 1, idv = base; while (ed.def.nodes.some((n) => n.id === idv)) idv = `${base}-${++i}`; return idv; };
  const addNode = (kind, at) => {
    const c = at || (view ? { x: view.x + view.w / 2 - NW / 2, y: view.y + view.h / 2 - NH / 2 } : { x: 40, y: 40 });
    const idv = uniq(kind); const n = { id: idv, kind, label: `${KINDS.find((k) => k[0] === kind)[1]} ${idv.split("-").at(-1) === kind ? "" : idv.split("-").at(-1)}`.trim(), x: Math.round(c.x), y: Math.round(c.y) };
    if (kind === "agent") { n.role = ed.def.roles[0]?.id; n.mode = "test"; } if (kind === "hook") { n.do = "note"; n.args = { text: "" }; } if (kind === "card") n.card = { options: [{ id: "ok", label: "OK" }] }; if (kind === "loop") n.args = { producer: ed.def.nodes.find((x) => x.kind === "agent")?.id ?? "" };
    ed.def.nodes.push(n); ed.sel = { node: idv }; dirty(); say(T(`added ${kind} node ${idv}`, `已加入 ${kind} 節點 ${idv}`)); focusNode(idv);
  };
  const delNode = (nid) => { ed.def.nodes = ed.def.nodes.filter((n) => n.id !== nid); ed.def.edges = ed.def.edges.filter((e) => e.from !== nid && e.to !== nid); ed.sel = null; dirty(); say(T(`removed ${nid} and its edges`, `已移除 ${nid} 與它的邊`)); };
  const delEdge = (i) => { const e = ed.def.edges[i]; ed.def.edges.splice(i, 1); ed.sel = null; dirty(); say(T(`disconnected ${e.from} → ${e.to}`, `已斷開 ${e.from} → ${e.to}`)); };
  const connect = (from, to, when) => { if (ed.def.edges.some((e) => e.from === from && e.to === to && (e.when || "") === (when || ""))) return; const e = { from, to }; if (when) e.when = when; ed.def.edges.push(e); ed.sel = { edge: ed.def.edges.length - 1 }; dirty(); say(T(`connected ${from} → ${to}`, `已連接 ${from} → ${to}`)); };
  const dropCheck = (target, ref) => { const t = target.node ? ed.def.nodes.find((n) => n.id === target.node) : ed.def.edges[target.edge]; t.checks = [...(t.checks || []), { use: ref }]; ed.sel = target; dirty(); say(T(`${ref} attached to ${target.node ?? `edge ${t.from} → ${t.to}`}`, `${ref} 已掛到 ${target.node ?? `邊 ${t.from} → ${t.to}`}`)); };
  const focusNode = (nid) => { const f = () => canvas.querySelector(`[data-node="${CSS.escape(nid)}"]`)?.focus({ preventScroll: true }); f(); setTimeout(f, 0); };
  // the layout: auto until a node is dragged (then this version keeps its positions), "Tidy layout" goes back
  const setMode = async (mode) => { ed.mode = mode; try { await api(`/api/graph-layout/${ed.id}/v${ed.def.version}`, { mode }); } catch (e) { say(e.message); } };
  const toManual = async () => {
    if (ed.mode === "manual") return;
    const full = window.crewLayout.layout(ed.def, { collapsed: [] }); const at = Object.fromEntries(full.nodes.map((n) => [n.id, n]));
    const positions = {}; draftRevision++;
    for (const n of ed.def.nodes) if (at[n.id]) { n.x = at[n.id].x; n.y = at[n.id].y; positions[n.id] = { x: n.x, y: n.y }; const sv = ed.saved.nodes.find((x) => x.id === n.id); if (sv) { sv.x = n.x; sv.y = n.y; } }
    ed.mode = "manual";
    await setMode("manual");
    const savedIds = new Set(ed.saved.nodes.map((n) => n.id)); const keep = Object.fromEntries(Object.entries(positions).filter(([k]) => savedIds.has(k)));
    try { await api(`/api/wf/${ed.id}/layout`, { version: ed.def.version, positions: keep }); } catch {}
  };
  const setView = (k) => { gview = k; try { localStorage.setItem("crew.graphView", k); } catch {} view = null; root.querySelectorAll("[data-view-toggle]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.viewToggle === k))); draw(); drawPanel(); say(k === "simple" ? T("Simple view", "簡易檢視") : T("Detail view: every node and edge", "詳細檢視：所有節點與邊")); };
  const toggleStage = (sid) => { const c = new Set(ed.collapsed); c.has(sid) ? c.delete(sid) : c.add(sid); ed.collapsed = [...c]; draw(); say(c.has(sid) ? T(`${sid} collapsed`, `${sid} 已收合`) : T(`${sid} expanded`, `${sid} 已展開`)); };
  let mm = null, drawPending = false;
  const draw = () => {
    if (disposed) return;
    // Validation/live updates must not replace the SVG that owns pointer
    // capture. Keep the gesture intact, then render the newest state once.
    if (canvas.querySelector("svg.rt-graph")?.interactionActive) { drawPending = true; return; }
    drawPending = false;
    stepList.replaceChildren(h("h2",{},T("Edit workflow steps","编辑流程步骤")),h("p",{},T("Choose a step to edit its settings, skills and checks. Choose a connection to edit its condition or checks.","选择步骤来编辑设置、技能与检查；选择连线来修改条件与检查。")),h("div",{class:"actions"},...KINDS.map(([k,en,zh])=>h("button",{class:"btn sm","data-guided-add":k,onclick:()=>{addNode(k);drawPanel();}},T("Add "+en,"添加"+zh)))),h("div",{class:"actions"},...ed.def.nodes.map(n=>h("button",{class:"btn sm","data-edit-step":n.id,onclick:()=>{ed.sel={node:n.id};draw();drawPanel();panel.scrollIntoView({block:"nearest",behavior:"smooth"});}},n.label))),h("div",{class:"actions"},...ed.def.edges.map((e,i)=>h("button",{class:"btn sm","data-edit-connection":String(i),onclick:()=>{ed.sel={edge:i};draw();drawPanel();panel.scrollIntoView({block:"nearest",behavior:"smooth"});}},`${e.from} → ${e.to}${e.when?` [${e.when}]`:""}`))));
    const simple = gview === "simple";
    root.dataset.view = gview; palette.hidden = simple; paletteNote.hidden = !simple;
    const g = graph(ed.def, { editable: true, simple, wrap: wrapFor(), offsets: simple ? ed.offsets : null, sel: ed.sel, problems: ed.problems, states: ed.states, walked: ed.walked, view, manual: !simple && ed.mode === "manual", collapsed: ed.collapsed, redraw: () => draw(),
      onNudge: (nid, dx, dy) => { const o = ed.offsets[nid] || { dx: 0, dy: 0 }; ed.offsets[nid] = { dx: o.dx + dx, dy: o.dy + dy }; draw(); say(T("Moved in the simple view (not kept; arrange in Detail view)", "在簡易檢視中移動（不保存；請在詳細檢視排版）")); },
      onToggleStage: toggleStage, onDragStart: () => { if (ed.mode !== "manual") ed.manualP = toManual(); },
      onInteractionEnd: () => { if (!disposed && drawPending) draw(); },
      onSelect: (sel) => { ed.sel = sel; draw(); drawPanel(); if (sel?.node) focusNode(sel.node); },
      onMove: (nid, x, y) => { draftRevision++; const n = ed.def.nodes.find((q) => q.id === nid); n.x = x; n.y = y; draw(); focusNode(nid); persistLayout(nid); },
      onMoved: () => {}, onConnect: (a, b) => { connect(a, b); drawPanel(); }, onDropCheck: (t, c) => { dropCheck(t, c); drawPanel(); },
      onDeleteNode: delNode, onDeleteEdge: delEdge, onView: (vw) => { view = vw; fitted = false; mm?.sync(); } });
    // Fit must honor both axes: a new stage/node may add another band. Grow
    // the scrollable page canvas instead of shrinking its titles below 11 px.
    canvas.style.minHeight = simple ? `${Math.ceil(g.lay.bbox.h * 11.1 / 15) + 2}px` : "";
    canvas.replaceChildren(g);
    if (!view) { fit(g, simple ? "all" : "start"); } view = g.view;
    // the minimap, on a desktop, docked under the canvas
    mm = null; dock.replaceChildren();
    // (the simple view fits whole: no minimap there)
    if (!simple && (canvas.getBoundingClientRect().width >= 700 || (!canvas.getBoundingClientRect().width && innerWidth > 900))) { mm = minimap(g, (vw) => { view = vw; }); dock.append(mm); }
  };
  // the first view: the graph at a readable scale from its start; Fit to view shows all of it
  const fit = (g, how) => { const r = canvas.getBoundingClientRect(); if (!r.width) { requestAnimationFrame(() => fit(g, how)); return; }
    const v = g.view; const b = g.lay.bbox;
    if (how === "all") { const k = Math.max(b.w / r.width, b.h / r.height); v.w = r.width * k; v.h = r.height * k; v.x = b.x - (v.w - b.w) / 2; v.y = b.y - (v.h - b.h) / 2; }
    else { // readable scale (1.1 units a pixel), from the start, the main lane in the middle
      const k = 1.0; const m = g.lay.nodes.find((n) => n.main) || g.lay.nodes[0]; v.w = r.width * k; v.h = r.height * k; v.x = b.x;
      v.y = b.h <= v.h ? b.y - (v.h - b.h) / 2 : m.y + m.h / 2 - v.h / 2; }
    g.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`); view = v; fitted = how === "all"; lastSize = [r.width, r.height]; mm?.sync(); };
  // the canvas changes size (the chat opens or closes, the window resizes): a fitted graph fits again, any other keeps its scale
  let fitted = false, lastSize = null;
  new ResizeObserver(() => { const g = canvas.querySelector("svg.rt-graph"); const r = canvas.getBoundingClientRect(); if (!g || !r.width || !lastSize || (r.width === lastSize[0] && r.height === lastSize[1])) return;
    if (fitted) fit(g, "all"); else { const v = g.view, k = v.w / lastSize[0]; v.w = r.width * k; v.h = r.height * k; g.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`); view = v; lastSize = [r.width, r.height]; mm?.sync(); } }).observe(canvas);
  const field = (label, input) => h("label", { class: "rt-field" }, h("span", {}, label), input);
  const paramsForm = (ref, holder) => {
    const man = checkMan(ref.use); const props = man?.params?.properties || {};
    const form = h("div", { class: "rt-params", "data-params": ref.use });
    for (const [k, sc] of Object.entries(props)) {
      const cur = ref.params?.[k] ?? man.effective?.[k] ?? sc.default ?? "";
      const set = (val) => { ref.params = { ...(ref.params || {}), [k]: val }; dirty(); };
      const inp = sc.type === "boolean" ? h("input", { type: "checkbox", checked: !!cur, onchange: (e) => set(e.target.checked) })
        : sc.type === "number" || sc.type === "integer" ? h("input", { class: "input", type: "number", value: cur, onchange: (e) => set(Number(e.target.value)) })
        : sc.enum ? h("select", { class: "select", onchange: (e) => set(e.target.value) }, sc.enum.map((x) => h("option", { value: x, selected: x === cur || null }, x)))
        : h("input", { class: "input", value: typeof cur === "object" ? JSON.stringify(cur) : cur, onchange: (e) => { let val = e.target.value; if (sc.type === "array" || sc.type === "object") { try { val = JSON.parse(val); } catch {} } set(val); } });
      form.append(field(`${k}${man.from?.[k] && man.from[k] !== "default" ? ` (${man.from[k]})` : ""}`, inp));
    }
    const out = h("pre", { class: "rt-try-out", "data-try-out": ref.use, hidden: true });
    form.append(h("div", { class: "actions" }, h("button", { class: "btn sm", "data-try": ref.use, onclick: async () => { out.hidden = false; out.textContent = T("running…", "執行中…");
      try { const r = await api("/api/checks/try", { use: ref.use, params: ref.params || {} }); out.textContent = `${r.result.verdict}${r.result.error ? ` — ${r.result.error}` : ""}\n${(r.result.findings || []).map((f) => `· ${f.message}`).join("\n")}`; out.dataset.verdict = r.result.verdict; }
      catch (e) { out.textContent = e.message; out.dataset.verdict = "refused"; } } }, T("Try on sample", "用範例試跑")),
      h("button", { class: "btn sm ghost", onclick: () => { holder.checks = holder.checks.filter((c) => c !== ref); if (!holder.checks.length) delete holder.checks; dirty(); drawPanel(); } }, T("Remove", "移除"))), out);
    return form;
  };
  const checksBlock = (holder) => {
    const pick = h("select", { class: "select", "aria-label": T("Check to add", "要加的檢查") }, ed.checks.map((c) => h("option", { value: c.ref }, c.ref)));
    return h("div", { class: "rt-checks" }, h("h4", {}, T("Checks", "檢查")),
      ...(holder.checks || []).map((c) => h("details", { class: "rt-check", "data-check": c.use, open: (holder.checks || []).length <= 2 || null }, h("summary", {}, h("b", {}, c.use), h("span", { class: "faint" }, ` ${checkMan(c.use)?.kind ?? "?"}`)), paramsForm(c, holder))),
      h("div", { class: "rt-row" }, pick, h("button", { class: "btn sm", "data-add-check": "1", onclick: () => { holder.checks = [...(holder.checks || []), { use: pick.value }]; dirty(); drawPanel(); } }, T("Add check", "加檢查"))));
  };
  // an agent node's enabled skills: turn on or off, order, move to a newer version; each change is part of the next saved version
  const skillsBlock = (n) => {
    const lib = new Map((ed.lib || []).map((x) => [x.id, x]));
    const list = n.skills || []; const set = (next) => { if (next.length) n.skills = next; else delete n.skills; dirty(); drawPanel(); };
    const move = (i, d) => { const next = list.slice(); const [x] = next.splice(i, 1); next.splice(i + d, 0, x); set(next); say(T(`${x.id} moved ${d < 0 ? "up" : "down"}`, `${x.id} 已${d < 0 ? "上移" : "下移"}`)); };
    const verOf = (p) => lib.get(p.id)?.versions?.find((v) => v.n === p.v);
    const total = list.reduce((a, p) => a + (verOf(p)?.bytes || 0), 0);
    const off = [...lib.values()].filter((x) => !list.some((p) => p.id === x.id));
    const pick = h("select", { class: "select", "aria-label": T("Skill to turn on", "要開啟的技能"), "data-skill-pick": "1" }, off.map((x) => h("option", { value: x.id }, `${x.name} · v${x.current}`)));
    // a disabled arrow keeps its place, looks disabled and says so to a screen reader
    const arrow = (p, i, d) => { const dis = d < 0 ? i === 0 : i === list.length - 1;
      return h("button", { class: "btn sm rt-skill-btn", type: "button", "aria-label": T(`Move ${p.id} ${d < 0 ? "up" : "down"}`, `${d < 0 ? "上移" : "下移"} ${p.id}`), [d < 0 ? "data-skill-up" : "data-skill-down"]: p.id,
        disabled: dis || null, "aria-disabled": dis ? "true" : null, onclick: () => move(i, d) }, d < 0 ? "↑" : "↓"); };
    return h("div", { class: "rt-skills", "data-node-skills": n.id }, h("h4", {}, T("Skills", "技能")),
      h("p", { class: "faint sk-note" }, T("The role skill comes first, then these, in this order. A skill is text only: it never changes this node's tools, sandbox, network or credentials.", "角色技能排第一，接著依序是這些。技能只是文字，不會改變這個節點的工具、沙箱、網路或憑證。")),
      list.length ? h("ol", { class: "rt-skill-list" }, list.map((p, i) => { const s = lib.get(p.id); const v = verOf(p); const newer = s && s.current > p.v ? s.current : null;
        return h("li", { class: "rt-skill", "data-node-skill": p.id },
          h("div", { class: "rt-skill-h" }, h("span", { class: "rt-skill-n", "aria-hidden": "true" }, `${i + 1}.`), h("b", {}, `${p.id}@v${p.v}`),
            h("span", { class: "rt-skill-ctl" }, arrow(p, i, -1), arrow(p, i, 1),
              h("button", { class: "btn sm rt-skill-btn", type: "button", "data-skill-off": p.id, onclick: () => { set(list.filter((q) => q.id !== p.id)); say(T(`${p.id} turned off`, `已關閉 ${p.id}`)); } }, T("Turn off", "關閉")))),
          newer ? h("div", { class: "rt-skill-newer" }, h("span", { class: "badge warn", "data-skill-newer": p.id }, T(`v${newer} available`, `有 v${newer}`)),
            h("button", { class: "btn sm rt-skill-btn", type: "button", "data-skill-upgrade": p.id, onclick: () => { const nv = s.versions.find((x) => x.n === newer); set(list.map((q) => (q.id === p.id ? { id: q.id, v: nv.n, sha256: nv.sha256 } : q))); say(T(`${p.id} moves to v${newer} when you save`, `儲存後 ${p.id} 改用 v${newer}`)); } }, T(`Use v${newer}`, `改用 v${newer}`)),
            h("span", { class: "faint" }, T("Saving makes a new workflow version.", "儲存會產生新的流程版本。"))) : null,
          !s ? h("p", { class: "sk-ignored" }, T("Not in this Studio's library.", "這個 Studio 的技能庫裡沒有它。")) : null,
          v?.ignored?.length ? h("p", { class: "sk-ignored", "data-skill-ignored": p.id }, icon("shield", "ic sm"), h("span", {}, window.crewSkillsIgnored(v.ignored))) : null); })) : null,
      off.length ? h("div", { class: "rt-row rt-skill-add" }, pick, h("button", { class: "btn sm rt-skill-btn", type: "button", "data-skill-on": "1", onclick: () => { const x = lib.get(pick.value); if (!x) return; const cur = x.versions.find((v) => v.n === x.current); set([...list, { id: x.id, v: cur.n, sha256: cur.sha256 }]); say(T(`${x.id} turned on`, `已開啟 ${x.id}`)); } }, T("Turn on", "開啟")))
        : h("p", { class: "faint sk-note" }, lib.size ? T("Every library skill is on.", "技能庫的技能都已開啟。") : h("a", { href: "#/library/skills" }, T("Import a skill in Library → Skills", "到成品庫 → 技能匯入"))),
      list.length ? h("div", { class: `faint rt-skill-size${ed.skillCap && total > ed.skillCap ? " over" : ""}`, "data-skill-size": "1" },
        T(`Skill text on this node: ${window.crewSkillsSize(total)} of ${window.crewSkillsSize(ed.skillCap || 0)}`, `這個節點的技能文字：${window.crewSkillsSize(total)} / ${window.crewSkillsSize(ed.skillCap || 0)}`)) : null);
  };
  const drawPanel = () => {
    const sel = ed.sel;
    if (!sel) { panel.replaceChildren(h("h3", {}, T("Nothing selected", "未選取")), h("p", { class: "faint" }, T("Select a node or an edge (click, or Tab to it and press Enter). Drag a node to move it, drag from its right port to another node to connect them, drop a check from the palette on a node or an edge.", "選一個節點或一條邊（點它，或用 Tab 移到它再按 Enter）。拖動節點可移動；從節點右側的接點拖到另一個節點可連線；把調色盤上的檢查拖到節點或邊上即可掛上。")), probs); return; }
    if (sel.node) {
      const n = ed.def.nodes.find((x) => x.id === sel.node); if (!n) { ed.sel = null; return drawPanel(); }
      const txt = (k, label) => field(label, h("input", { class: "input", value: n[k] ?? "", "data-field": k, onchange: (e) => { const val = e.target.value; if (val === "") delete n[k]; else n[k] = ["timeout_s", "retries", "max_visits"].includes(k) ? Number(val) : val; dirty(); } }));
      const target = h("select", { class: "select", "aria-label": T("Connect to", "連到") }, ed.def.nodes.filter((x) => x.id !== n.id).map((x) => h("option", { value: x.id }, x.id)));
      const when = h("input", { class: "input", placeholder: T("when (outcome, optional)", "條件（結果，可留空）"), "aria-label": T("Edge outcome", "邊的結果") });
      // (fields a node kind does not have are null: left out, never shown as the text "null")
      panel.replaceChildren(...[h("h3", {}, n.label), h("p", { class: "faint" }, `${n.id} · ${n.kind}`),
        txt("label", T("Label", "名稱")), txt("detail", T("Detail", "說明")),
        n.kind === "agent" ? field(T("Role", "角色"), h("select", { class: "select", onchange: (e) => { n.role = e.target.value; dirty(); } }, ed.def.roles.map((r) => h("option", { value: r.id, selected: r.id === n.role || null }, r.label)))) : null,
        n.kind === "agent" ? txt("mode", T("Mode", "模式")) : null,
        n.kind === "agent" && ed.def.origin ? nodeModelControls(n, ed.def.roles.find((r) => r.id === n.role)?.skill, { attr: "data-node-model-config", onChange: (k, v) => { if (v === "") delete n[k]; else n[k] = v; dirty(); } }) : null,
        n.kind === "agent" ? skillsBlock(n) : null, n.kind === "hook" ? txt("do", T("Action", "動作")) : null,
        ["agent", "check"].includes(n.kind) ? txt("timeout_s", T("Time limit (s)", "時間上限（秒）")) : null, n.kind === "agent" ? txt("retries", T("Retries", "重試次數")) : null,
        checksBlock(n),
        h("h4", {}, T("Connect", "連線")), h("div", { class: "rt-row" }, target, when, h("button", { class: "btn sm", "data-connect": "1", onclick: () => { connect(n.id, target.value, when.value.trim()); drawPanel(); } }, T("Connect", "連線"))),
        h("div", { class: "actions" }, h("button", { class: "btn sm danger", "data-del-node": n.id, onclick: () => { delNode(n.id); drawPanel(); } }, T("Remove node", "移除節點"))), probs].filter((c) => c != null));
    } else {
      const e = ed.def.edges[sel.edge]; if (!e) { ed.sel = null; return drawPanel(); }
      panel.replaceChildren(h("h3", {}, `${e.from} → ${e.to}`), field(T("When (outcome)", "條件（結果）"), h("input", { class: "input", value: e.when ?? "", "data-field": "when", onchange: (ev) => { if (ev.target.value.trim()) e.when = ev.target.value.trim(); else delete e.when; dirty(); } })),
        checksBlock(e), h("div", { class: "actions" }, h("button", { class: "btn sm danger", "data-del-edge": `${e.from}→${e.to}`, onclick: () => { delEdge(sel.edge); drawPanel(); } }, T("Disconnect", "斷開"))), probs);
    }
  };
  // palette: node kinds (click or drag onto the canvas) and checks (drag onto a node or an edge)
  const paletteNote = h("aside", { class: "rt-palette card", "data-palette-note": "1" }, h("h4", {}, T("Simple view", "簡易檢視")),
    h("p", { class: "faint" }, T("The main path through the stages. Loops, the door question and escalations are badges on their node or stage. Add or remove nodes and edges in Detail view.", "主要路徑。迴圈、門的提問和升級處理都是節點或階段上的徽章。要新增或移除節點與邊，請到詳細檢視。")),
    h("button", { class: "btn sm", "data-edit-detail": "1", onclick: () => setView("detail") }, T("Edit in Detail view", "到詳細檢視編輯")));
  const palette = h("aside", { class: "rt-palette card", "aria-label": T("Palette", "調色盤") }, h("h4", {}, T("Add a node", "加節點")),
    ...KINDS.map(([k, en, tw]) => h("button", { class: `btn sm rt-pal k-${k}`, draggable: "true", "data-add": k, onclick: () => { addNode(k); drawPanel(); }, ondragstart: (e) => { e.dataTransfer.setData("text/x-kind", k); } }, T(en, tw))),
    h("h4", {}, T("Checks", "檢查")), h("p", { class: "faint" }, T("Drag one onto a node or an edge.", "拖到節點或邊上。")),
    h("div", { class: "rt-pal-checks" }, ed.checks.map((c) => h("div", { class: "rt-pal-check", draggable: "true", tabindex: 0, "data-pal-check": c.ref, title: c.description || c.ref, ondragstart: (e) => { e.dataTransfer.setData("text/x-check", c.ref); e.dataTransfer.effectAllowed = "copy"; } }, c.ref))));
  canvas.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-kind")) e.preventDefault(); });
  canvas.addEventListener("drop", (e) => { const k = e.dataTransfer.getData("text/x-kind"); if (!k) return; e.preventDefault(); const svg = canvas.querySelector("svg.rt-graph"); const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); addNode(k, { x: q.x - NW / 2, y: q.y - NH / 2 }); drawPanel(); });
  // the toolbar: version, zoom, validate, save, overlay a run
  const note = h("input", { class: "input", placeholder: T("What changed (note)", "改了什麼（備註）"), "aria-label": T("Save note", "儲存備註"), "data-save-note": "1" });
  const diffBox = h("div", { class: "rt-diff", "data-diff": "1", hidden: true });
  const save = async () => {
    if (disposed || WF.ed !== ed || savePending) return;
    const revision = draftRevision, generation = validationGeneration;
    savePending = true; saveButton.disabled = true; saveButton.textContent = T("Saving…", "儲存中…");
    try { const body = clone({ base: ed.saved.version, nodes: ed.def.nodes, edges: ed.def.edges, roles: ed.def.roles, note: note.value.trim() || null });
      const r = await api(`/api/wf/${ed.id}`, body);
      if (disposed || WF.ed !== ed) return;
      const d = r.diff;
      diffBox.hidden = false; diffBox.replaceChildren(h("b", {}, T(`Saved as v${r.def.version}`, `已存成 v${r.def.version}`)),
        ...[["nodesAdded", "+ nodes"], ["nodesRemoved", "− nodes"], ["nodesChanged", "~ nodes"], ["nodesMoved", "↔ moved"], ["edgesAdded", "+ edges"], ["edgesRemoved", "− edges"], ["edgesChanged", "~ edges"]]
          .filter(([k]) => d[k]?.length).map(([k, l]) => h("div", { class: "rt-diff-row", "data-diff-k": k }, h("span", { class: "vbadge" }, l), " ", d[k].map((x) => typeof x === "string" ? x : `${x.id} (${x.fields.join(", ")})`).join(", "))),
          ...(d.skills || []).length ? [h("div", { class: "rt-diff-row", "data-diff-k": "skills" }, h("span", { class: "vbadge" }, "~ skills"), " ", d.skills.map((x) => `${x.node}: ${x.after.join(", ") || T("none", "無")} (${T("was", "原本")} ${x.before.join(", ") || T("none", "無")})`).join("; "))] : []);
      say(T(`saved v${r.def.version}`, `已存成 v${r.def.version}`));
      WF.list = null;
      if (revision !== draftRevision || canvas.querySelector("svg.rt-graph")?.interactionActive) {
        // The acknowledged snapshot is the new base, not the current draft.
        // Later content/layout edits keep their object and gesture ownership.
        ed.saved = clone(r.def); ed.def.version = r.def.version; ed.def.parent = r.def.parent;
        ed.versions = [...ed.versions.filter(v => v.version !== r.def.version), r.def];
        ed.dirty = true;
        verSel.replaceChildren(...ed.versions.map(v => h("option", { value: v.version, selected: v.version === r.def.version || null }, `v${v.version}${v.note ? ` · ${v.note}` : ""}`)));
        say(T(`Saved v${r.def.version}; later edits remain unsaved`, `已存成 v${r.def.version}；後續修改尚未儲存`));
        return;
      }
      WF.lastDiff = diffBox; ed.dispose?.(); WF.ed = null;
      if (location.hash === `#/workflows/${ed.id}`) rerender(); else location.hash = `#/workflows/${ed.id}`;
    } catch (e) { if (disposed || WF.ed !== ed) return; if (generation === validationGeneration) { ed.problems = e.problems || ed.problems; drawProblems(); } say(e.message); }
    finally { savePending = false; if (!disposed) { saveButton.disabled = false; saveButton.textContent = T("Save as new version", "存成新版本"); } }
  };
  const saveButton = h("button", { disabled:ed.trash?.deleted||null, class: "btn primary sm", "data-save": "1", onclick: save }, T("Save as new version", "存成新版本"));
  const runPick = h("select", { class: "select", "aria-label": T("Show a task on the graph", "在流程圖上顯示一個任務"), "data-overlay": "1", onchange: (e) => setOverlay(e.target.value || null) },
    h("option", { value: "" }, T("No task overlay", "不疊加任務")), (ed.runs || []).slice().reverse().map((r) => h("option", { value: r.id, "data-overlay-run": r.id }, `${r.id} · v${r.version} · ${stateWord(r)}`)));
  const setOverlay = async (rid) => { ed.overlay = rid; ed.states = null; ed.walked = null; if (rid) { try { const r = await api(`/api/wruns/${rid}`); ed.states = Object.fromEntries(Object.entries(r.nodes).map(([k, n]) => [k, n.state])); ed.walked = new Set(r.walked || []); } catch {} } draw(); };
  const onLive = (t, d) => { if (t === "wrun" && ed.overlay === d.id && d.event?.type === "edge_taken") (ed.walked ||= new Set()).add(d.event.edge);
    if (t === "wrun" && ed.overlay === d.id && d.nodes) { ed.states = Object.fromEntries(Object.entries(d.nodes).map(([k, n]) => [k, n.state ?? n])); if (WF.ed === ed) draw(); } };
  live.listeners.add(onLive);
  ed.dispose = () => {
    if (disposed) return; disposed = true; drawPending = false;
    clearTimeout(vtimer); validationGeneration++; validationAbort?.abort(); validationAbort = null;
    canvas.querySelector("svg.rt-graph")?.cancelInteraction?.();
    live.listeners.delete(onLive);
  };
  const verSel = h("select", { class: "select", "aria-label": T("Version", "版本"), onchange: (e) => { location.hash = `#/workflows/${ed.id}/v${e.target.value}`; } }, ed.versions.map((x) => h("option", { value: x.version, selected: x.version === ed.def.version || null }, `v${x.version}${x.note ? ` · ${/^Saved from Firstmate draft /.test(x.note) ? T("Saved from a Firstmate draft", "由 Firstmate 草稿儲存") : x.note}` : ""}`)));
  const svgZoom = (k) => canvas.querySelector("svg.rt-graph")?.zoom(k);
  // the readiness gate for this exact version: Run stays the captain's choice, verified or not
  const gateHost = h("details", { class: "gate-host", "data-gate-host": ed.id, open: true, onclick: (e) => { if (e.target.closest("summary")?.parentElement === gateHost) gateHost.dataset.toggled = "1"; } }, h("summary", {}, T("Readiness", "就緒檢查"), " ", h("span", { class: "faint", "data-gate-summary": "" }, T("checking…", "檢查中…"))));
  const loadGate = async () => { if (!ed.def.origin || !root.isConnected && gateHost.dataset.loaded) return; try { const v = await api(`/api/wf/${ed.id}/gate?v=${ed.def.version}`); gateHost.dataset.loaded = "1";
    const sum = gateHost.querySelector("[data-gate-summary]"); sum.textContent = v.status?.verified ? T("Verified", "已驗證") : T("Not verified yet", "尚未驗證"); sum.className = `badge gate-badge ${v.status?.verified ? "ok" : "wait"}`;
    const runBtn = root.querySelector("[data-ed-run]"); if (runBtn) { runBtn.dataset.verified = v.status?.verified ? "1" : "0"; let tag = root.querySelector("[data-run-verified]"); if (!tag) { tag = h("span", { class: "faint gate-run-tag", "data-run-verified": "" }); runBtn.before(tag); } const sn = GATE_STAGES.findIndex(s => s[0] === v.status?.stage) + 1; tag.textContent = v.status?.verified ? gateL(v.status.text) : v.status?.stage === "smoke" ? T("Not verified yet · stages 1–4 pass", "尚未驗證・前四關已通過") : sn ? T(`Not verified yet · stage ${sn} ${v.gate?.stages?.find(s => s.id === v.status.stage)?.status === "running" ? "checking" : "failing"}`, `尚未驗證・第 ${sn} 關${v.gate?.stages?.find(s => s.id === v.status.stage)?.status === "running" ? "檢查中" : "未通過"}`) : T("Not verified yet", "尚未驗證"); }
    if (!gateHost.dataset.toggled) gateHost.open = !v.passed;
    const verify = async (e) => { e.target.disabled = true; try { let r; try { r = await api(`/api/wf/${ed.id}/gate/smoke`, { version: ed.def.version }); } catch (err) { if (err.code === "staffing_incomplete") { await staffingConfirm(err.staffing, true); return; } if (err.code !== "staffing_confirmation_required") throw err; if (!await staffingConfirm(err.staffing, false)) return; r = await api(`/api/wf/${ed.id}/gate/smoke`, { version: ed.def.version, staffingConfirm: err.staffing.hash }); } RN.list = null; location.hash = r.href; } catch (err) { say(err.message); } finally { e.target.disabled = false; } };
    [...gateHost.children].slice(1).forEach(c => c.remove()); gateHost.append(gatePanel(v, { verify, badge: false })); } catch {} };
  if (ed.def.origin) { void loadGate(); const onGate = (d) => { if (!root.isConnected) { GATE_LIVE.delete(onGate); return; } if (!d?.key || d.key === `wf-${ed.id}-v${ed.def.version}`) loadGate(); }; GATE_LIVE.add(onGate); }
  const compareVersions=h("details",{class:"card x-pad","data-workflow-compare":""},h("summary",{},T("Compare and refine workflow versions","比较与修改流程版本")));
  const beforeVersion=h("select",{class:"select","data-compare-workflow-version":""},ed.versions.map(v=>h("option",{value:v.version,selected:v.version===(ed.saved.parent||ed.saved.version)||null},`v${v.version}`))),changes=h("div",{"data-workflow-changes":""});
  compareVersions.append(h("p",{},T("Compare a saved version with your current edits. Existing Tasks keep their pinned version. Use the step editor to revise, then save a new version.","将已保存版本与当前修改比较。现有任务继续使用原版本；通过步骤编辑器修改，再保存为新版本。")),beforeVersion,h("button",{class:"btn","data-workflow-compare-refresh":"",onclick:async e=>{e.target.disabled=true;try{const j=await api(`/api/wf/${ed.id}?v=${beforeVersion.value}`);if(disposed)return;const rows=workflowChanges(j.def,ed.def);changes.replaceChildren(h("p",{},T(`v${j.def.version} → current edits`,`v${j.def.version} → 当前修改`)),...rows.map(r=>h("section",{class:"card x-pad"},h("h3",{},r.label),h("div",{style:"display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px"},h("div",{},h("b",{},T("Before","修改前")),h("pre",{style:"white-space:pre-wrap;overflow-wrap:anywhere"},r.before)),h("div",{},h("b",{},T("After","修改后")),h("pre",{style:"white-space:pre-wrap;overflow-wrap:anywhere"},r.after))))),...(rows.length?[]:[h("p",{},T("No content changes.","内容没有变化。"))]));}catch(err){say(err.message);}finally{e.target.disabled=false;}}},T("Compare with current edits","与当前修改比较")),changes);
  if(ed.runs?.length)compareVersions.append(h("h3",{},T("Compare execution rounds","比较执行回合")),h("p",{},T("Open a task to compare its actual agent transcripts. Feedback and workflow edits create a new version; prior execution records stay intact.","打开任务可比较实际代理执行记录；按反馈修改流程并保存新版本，原执行记录保留。")),...ed.runs.map(r=>h("a",{class:"btn sm",href:`#/tasks/${r.id}/compare`},`${r.id} · v${r.version} · ${stateWord(r)}`)));
  const reuse=h("details",{class:"card x-pad","data-workflow-reuse":""},h("summary",{},T("Reuse this workflow","复用这个流程")),h("p",{},T("Save the exact saved version as a named template. Create independent workflows from it without copying tasks or approvals.","把已保存的确切版本保存为命名模板，再从中创建独立流程，不复制任务或核准。")),h("button",{class:"btn","data-save-workflow-template":"",onclick:()=>copyWorkflowTemplate(ed,true).catch(e=>say(e.message))},T("Save as template","保存为模板")),ed.def.isTemplate?h("button",{class:"btn primary","data-use-workflow-template":"",onclick:()=>copyWorkflowTemplate(ed,false).catch(e=>say(e.message))},T("Create workflow from this template","从此模板创建流程")):null);
  root.append(
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, ed.def.name), h("p", {}, (ed.def.description || "").slice(0, 300))),
      h("div", { class: "actions" }, h("a", { class: "btn ghost", href: "#/workflows" }, T("All workflows", "全部流程")),ed.personal?workflowTrashButton({id:ed.id,name:ed.saved.name,version:ed.saved.version,trashRevision:ed.trash?.revision??0},ed.trash?.deleted===true):null, ed.held?h("span",{class:"faint","data-workflow-held":"1"},T(ed.held.en,ed.held.zh)):ed.selectable===false?h("span",{class:"faint","data-workflow-unavailable":"1"},T("Historical or internal workflow · unavailable for new tasks","歷史或內部流程 · 不提供新任務使用")):ed.def.origin?h("button",{class:"btn primary","data-ed-run":ed.id,onclick:async(e)=>{if(ed.dirty){say(T("Save your edits as a new version before Run.","執行前請先把修改存成新版本。"));return;}e.target.disabled=true;try{const input=await startInputs(ed.def,workflowBrief(ed),value=>{saveWorkflowBrief(ed,value);direction.value=value;});if(input===null)return;const r=await startOwnRun({workflow:ed.id,version:ed.saved.version,title:ed.def.name,text:input.text,params:input.params});if(r){RN.list=null;location.hash=`#/run/${r.id}`;}}catch(err){say(err.message);}finally{e.target.disabled=false;}}},T("Run…","執行…")):h("a", { class: "btn", href: "#/runs", "data-start-run": ed.id, onclick: () => { RN.prefill = ed.id; } }, T("Start a task", "開始一個任務")))),
    h("div", { class: "rt-toolbar" }, verSel, h("button", { class: "btn sm", "aria-label": T("Zoom in", "放大"), onclick: () => svgZoom(1 / 1.2) }, "+"), h("button", { class: "btn sm", "aria-label": T("Zoom out", "縮小"), onclick: () => svgZoom(1.2) }, "−"),
      h("div", { class: "seg rt-viewseg", role: "group", "aria-label": T("Graph view", "流程圖檢視") }, ["simple", "detail"].map((k) => h("button", { type: "button", "data-view-toggle": k, "aria-pressed": String(gview === k), onclick: () => setView(k) },
        h("span", { class: "keep" }, k === "simple" ? T("Simple", "簡易") : T("Detail", "詳細"))))),
      h("button", { class: "btn sm", "data-tidy": "1", title: T("Lay the graph out again automatically", "自動重新排版"), onclick: async () => { await setMode("auto"); view = null; draw(); say(T("Tidy layout", "已自動排版")); } }, T("Tidy layout", "整理排版")),
      h("button", { class: "btn sm", "data-fit": "1", onclick: () => { const g = canvas.querySelector("svg.rt-graph"); if (g) fit(g, "all"); } }, T("Fit to view", "全部顯示")),
      runPick, note, saveButton, status),
    ...(ed.trash?.deleted?[h("p",{class:"card x-pad","data-workflow-in-trash":""},T("This workflow is in Trash. Restore it before editing or starting a Task.","此流程在垃圾桶中。請先復原，再編輯或開始任務。"))]:[]),
    ...(ed.def.origin && !ed.trash?.deleted ? [gateHost] : []),
    h("div", { "data-diff-host": "1" }, WF.lastDiff || diffBox),
    h("div", { class: "rt-work" }, palette, paletteNote, canvasWrap, panel));
  if(ed.def.origin)root.querySelector(".rt-toolbar").after(briefPanel,stepList,compareVersions,...(ed.trash?.deleted?[]:[reuse]));
  WF.lastDiff = null;
  drawProblems(); draw(); drawPanel();
  return root;
}

// ---------- Runs ----------
const RN = { list: null, prefill: null, view: null };
// The tour seeds only an untouched form; revisiting never replaces the captain's draft.
window.crewPrefillFirstTask = () => {
  if (RN.draft || RN.prefill || RN.provider) return;
  RN.draft = T("Generate an image of a cute puppy.", "產生一張可愛小狗的圖片。");
  RN.prefill = "images";
  RN.provider = "codex";
  rerender();
};
function viewRuns() {
  if (!RN.list) { RN.list = "loading"; RN.startOptions = {}; Promise.all([api(`/api/wruns${RN.archived ? "?archived=1" : ""}`), api("/api/wf")]).then(([r, w]) => { RN.list = r.runs; RN.cards = r.cards; RN.wfs = w.workflows; rerender(); }).catch(() => { RN.list = []; rerender(); }); }
  // #/runs?project=<id>: only that project's Tasks (studio: the Tasks in no project), as /api/tasks?project= lists them
  const pf = S.route?.query?.get("project") || null;
  if (pf && (RN.pf !== pf || RN.pfArchived !== !!RN.archived || RN.pIds === undefined)) { RN.pf = pf; RN.pfArchived = !!RN.archived; RN.pIds = null;
    api(`/api/tasks?project=${encodeURIComponent(pf)}${RN.archived ? "&archived=1" : ""}`).then((x) => { if (RN.pf === pf) { RN.pIds = new Set((x.tasks || []).map((t) => t.id)); rerender(); } }).catch(() => { RN.pIds = new Set(); rerender(); }); }
  if (!pf) { RN.pf = null; RN.pIds = undefined; }
  // the Agent rounds panel below (public/transcripts.js) follows the same filter
  window.crewTaskFilter = () => (RN.pf ? RN.pIds || null : null); // null while the project's Task ids load
  const runs = (Array.isArray(RN.list) ? RN.list.slice().reverse() : []).filter((r) => !pf || (RN.pIds && RN.pIds.has(r.id)));
  // the form keeps what was typed across re-renders (the list loads, a run moves)
  const text = h("textarea", { class: "input", rows: 3, placeholder: T("Say what you want done", "說你要做什麼"), "aria-label": T("Intent", "意圖"), "data-run-text": "1", oninput: (e) => { RN.draft = e.target.value; } });
  text.value = RN.draft || "";
  const wf = h("select", { class: "select", "aria-label": T("Workflow", "流程"), "data-run-wf": "1", onchange: (e) => { RN.prefill = e.target.value; RN.startError = ""; rerender(); } }, h("option", { value: "" }, T("Let Studio pick", "讓 Studio 選")), (RN.wfs || []).map((w) => h("option", { value: w.id, selected: RN.prefill === w.id || null }, w.name)));
  const provider = h("select", { class: "select", "aria-label": T("Provider", "模型供應商"), "data-run-provider": "1", onchange: (e) => { RN.provider = e.target.value; } },
    [["", T("Default provider", "預設模型供應商")], ["codex", "Codex"], ["claude", "Claude"]].map(([value, label]) => h("option", { value, selected: (RN.provider || "") === value || null }, label)));
  const msg = h("div", { class: "faint", role: "status" }, RN.startError || "");
  return h("div", { class: "page" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Tasks", "任務")), h("p", {}, T("Studio's workflow tasks, each with its live graph.", "Studio 的流程任務，每個都有即時流程圖。")))),
    h("div", { class: "card x-pad rt-start" }, h("h3", {}, T("Start a task", "開始一個任務")), text, h("div", { class: "rt-row" }, wf, provider, h("button", { class: "btn primary", "data-run-start": "1", disabled: startBlocked(wf.value) || null, onclick: async () => {
      try {
        if(!wf.value){
          RN.draft=text.value;
          const choice=await api("/api/intake",{text:text.value});
          if(!choice.workflow||!choice.confident){msg.textContent=RN.startError=T("Choose a workflow below; your request is still saved.","請選擇流程；你輸入的需求已保留。");wf.focus();return;}
          RN.prefill=choice.workflow;RN.startError=T("Workflow selected. Review its inputs, then press Start.","已選好流程，確認輸入後按「開始」。");rerender();return;
        }
        const r = await startOwnRun({ text: text.value, workflow: wf.value || undefined, params: { ...(provider.value ? { provider: provider.value } : {}), ...startParamValues(wf.value), ...startProjectValue(wf.value) }, ...startStaffingExpected(wf.value) }); if (!r) return; RN.list = null; RN.draft = ""; RN.startError = ""; location.hash = `#/run/${r.id}`; }
      catch (e) { msg.textContent = RN.startError = e.message; if (/^(staffing_|project_)/.test(e.code || "") && RN.startOptions) { delete RN.startOptions[wf.value]; rerender(); } } } }, T("Start", "開始"))), startProjectPicker(wf.value), startParamInputs(wf.value), msg),
    // one word per state (public/runstate.js); archived runs only with "Show archived", each with Unarchive
    h("label", { class: "rt-row rt-archived-toggle" }, h("input", { type: "checkbox", "data-show-archived": "1", checked: RN.archived || null, onchange: (e) => { RN.archived = e.target.checked; RN.list = null; rerender(); } }), T("Show archived", "顯示已封存")),
    pf ? h("div", { class: "rt-row", "data-project-filter": pf }, h("span", { class: "badge neutral" }, pf === "studio" ? T("Project: none (Studio)", "專案：無（Studio）") : T(`Project: ${pf}`, `專案：${pf}`)),
      pf === "studio" ? null : h("a", { href: `#/project/${encodeURIComponent(pf)}` }, T("Open the project", "開啟專案")), h("a", { href: "#/runs" }, T("Show all tasks", "顯示全部任務"))) : null,
    RN.list === "loading" || RN.list === null || (pf && !RN.pIds) ? h("div", { class: "skel", style: "height:120px" }) : runs.length ? h("div", { class: "card rt-runs" }, runs.map((r) => h("a", { class: `rt-run st-${r.status}${r.archived ? " archived" : ""}`, href: `#/run/${r.id}`, "data-run": r.id },
      h("span", { class: "mono" }, r.id), h("b", {}, r.title), h("span", { class: "vbadge" }, `${r.workflow} v${r.version}`),
      // the state and the archived marker read together; the foot says where the run is and holds Unarchive
      h("span", { class: "rt-state" }, window.runStateBadge(r), r.childRun ? h("span", {class:"faint"}, T(`Execution: ${r.childRun}`,`執行任務：${r.childRun}`)) : null, r.archived ? h("span", { class: "badge neutral rt-archived-tag", "data-archived": "1" }, T("Archived", "已封存")) : null,
      r.archived ? h("button", { class: "btn rt-unarchive", type: "button", "data-run-unarchive": r.id, onclick: async (e) => { e.preventDefault(); e.stopPropagation();
        try { await api(`/api/wruns/${r.id}/archive`, { archived: false }); } catch (err) { alert(err.message); } RN.list = null; rerender(); } }, T("Unarchive", "取消封存")) : null),
      h("div", { class: "rt-foot" }, h("span", { class: "faint rt-where" }, r.current.map((c) => c.waiting === "card" ? T(`Waiting for you at ${c.label || c.node}`, `在「${c.label || c.node}」等你`) : T(`Now: ${c.label || c.node}`, `目前：${c.label || c.node}`)).join(" · ")))))) : h("div", { class: "card x-pad faint", id: "runsEmpty" }, T("No tasks yet.", "還沒有任務。")));
}
// a timeline line in the captain's words (Simple view): run states as public/runstate.js names them, node steps as plain verbs
// with the run, a timeline line names a state exactly as the run's own status pill does (an artifact task "Closed without approval")
const stateWord = (st, r) => { const s = window.runState(r ? { def: r.def, workflow: r.workflow, ctx: r.ctx, ...st } : st); return T(s.en, s.tw); };
const NODE_WORDS = { skipped: ["skipped", "略過"], superseded: ["replaced", "被取代"], pending: ["reset", "重設"] };
// node transitions a display event already says (node_started, node_done, node_failed, node_waiting) are left out of the Simple view
// and so is the run's own "failed" note when the node's failure row already says it (one failure row per node), and the
// run's first transition (the "started" row says it)
const simpleShows = (e, all) => !(e.type === "node" && ["running", "passed", "failed", "error", "waiting"].includes(e.to))
  && !(e.type === "failed" && e.node && all.some((x) => x.type === "node_failed" && x.node === e.node))
  && !(e.type === "run" && (!e.from || e.from === "queued") && all.some((x) => x.type === "started"));
const VERDICT = { pass: ["passed", "通過"], fail: ["failed", "未通過"], warn: ["warned", "警告"], error: ["could not run", "無法執行"] };
function timelineLine(e, r) {
  const node = (n) => r.def?.nodes?.find((x) => x.id === n); const label = (n) => node(n)?.label || n;
  // an outcome in words: ok is Finished; a card's choice by its option's label
  const outcome = (n, o) => o === "ok" || o == null ? T("Finished", "完成") : o === "fail" || o === "error" ? T("Failed", "失敗") : o === "cap" ? T("Round cap reached", "達到回合上限")
    : `${T("Finished", "完成")} (${(node(n)?.card?.options || []).find((x) => x.id === o)?.label || o})`;
  // a message that already starts with the node's name does not say it twice
  const strip = (t, lab) => { t = String(t ?? ""); while (lab && (t.startsWith(`${lab}: `) || t.startsWith(`${lab} `) || t === lab)) t = t.slice(lab.length).replace(/^:?\s*/, ""); return t; };
  const said = (n, t) => { const lab = n ? label(n) : null; const rest = strip(t, lab); return [lab ? h("b", {}, lab) : null, lab && rest ? ": " : "", rest]; };
  if (e.type === "run" && (!e.from || e.from === "queued")) return [h("b", {}, T("Task", "任務")), `: ${T("Started", "開始")}`];
  if (e.type === "started") return [h("b", {}, T("Task", "任務")), `: ${T("Started", "開始")} (${r.def?.name || r.workflow} v${e.workflowVersion ?? r.version})`];
  if (e.type === "failed") return [h("b", {}, T("Task", "任務")), `: ${stateWord({ status: "failed" }, r)}`, e.summary ? ` — ${e.summary}` : ""];
  if (e.type === "check_result") { // "card SC-001 · core/ste-wording failed (1 finding)", the edge or hook in words
    const where = !e.edge ? "" : e.edge.startsWith("card:") ? `${T("card", "卡片")} ${e.edge.slice(5)} · ` : e.edge.startsWith("hook:") ? `${e.edge.slice(5)} ${T("hook", "hook")} · ` : `${e.edge} · `;
    const n = /\((\d+) findings?\)/.exec(e.summary || "")?.[1]; const vw = VERDICT[e.verdict] || [e.verdict, e.verdict];
    return [h("b", {}, e.node ? label(e.node) : T("Check", "檢查")), `: ${where}${e.check} ${T(vw[0], vw[1])}${n ? T(` (${n} finding${n === "1" ? "" : "s"})`, `（${n} 個問題）`) : ""}`]; }
  if (e.type === "run") return [h("b", {}, T("Task", "任務")), `: ${stateWord({ status: e.from }, r)} → ${stateWord({ status: e.to, result: e.to === "succeeded" ? e.result ?? r.result : null, merged: !!r.ctx?.merged }, r)}`];
  if (e.type === "node") { const w = NODE_WORDS[e.to] || [e.to, e.to]; return [h("b", {}, label(e.node)), `: ${T(w[0], w[1])}`]; }
  if (e.type === "node_started") {
    // Only agent/check/card launches are Rounds; a repeated hook or loop is an execution.
    const isRound = ["agent", "check", "card"].includes(node(e.node)?.kind);
    const count = e.visit > 1 ? isRound ? T(` (Round ${e.visit})`, `（第 ${e.visit} 回合）`) : T(` (execution ${e.visit})`, `（第 ${e.visit} 次執行）`) : "";
    return [h("b", {}, label(e.node)), `: ${T("Started", "開始")}${count}`];
  }
  if (e.type === "node_done") return [h("b", {}, label(e.node)), `: ${outcome(e.node, e.outcome)}`];
  if (e.type === "edge_taken") return [h("b", {}, label(e.from)), ` → ${label(e.to)}`];
  if (e.type === "archived") return h("b", {}, T("Archived", "已封存"));
  if (e.type === "unarchived") return h("b", {}, T("Unarchived", "已取消封存"));
  if (e.type === "cancelled") return [h("b", {}, stateWord({ status: "cancelled" }, r)), e.reason ? `: ${e.reason}` : ""];
  if (e.type === "closed" || e.type === "done") { const w = stateWord({ status: "succeeded", result: e.result ?? (e.type === "closed" ? "closed" : "done"), merged: !!r.ctx?.merged }, r);
    const rest = e.summary && e.summary.trim().toLowerCase() !== w.toLowerCase() ? e.summary : ""; return [h("b", {}, w), rest ? `: ${rest}` : ""]; }
  // every row has a bold subject: the node, else what the message names before its first ": ", else the run
  if (!e.node) { const t = String(e.summary || String(e.type).replace(/_/g, " ")); const m = /^([^:]{1,40}): (.+)$/.exec(t); return m ? [h("b", {}, m[1]), `: ${m[2]}`] : [h("b", {}, T("Task", "任務")), `: ${t}`]; }
  return said(e.node, e.summary || String(e.type).replace(/_/g, " "));
}
// Task Rounds come from /api/tasks; never infer launches from graph colours or ledger rows.
function roundHistory(r) {
  const outcomes = { running: ["Running", "進行中"], waiting: ["Waiting", "等待中"], passed: ["Passed", "通過"], failed: ["Failed", "未通過"], error: ["Error", "錯誤"], chosen: ["Chosen", "已選擇"], interrupted: ["Interrupted", "已中斷"], skipped: ["Skipped", "已略過"], superseded: ["Replaced", "已取代"], swapped: ["Replaced", "已取代"] };
  const stamp = (iso) => iso ? h("time", { datetime: iso, title: iso }, new Date(iso).toLocaleString(T("en-US", "zh-TW", "zh-CN"))) : T("Not yet", "尚未");
  const field = (en, tw, value) => h("div", {}, h("dt", {}, T(en, tw)), h("dd", {}, value));
  return h("section", { class: "card x-pad rt-rounds", "data-rounds": r.id, "aria-label": T("Rounds", "回合") },
    h("div", { class: "rt-rounds-head" }, h("h2", {}, T("Rounds", "回合")), (r.rounds || []).filter((x) => x.actor.kind === "agent").length > 1 ? h("a", { class: "btn", href: `#/tasks/${r.id}/compare`, "data-compare-link": r.id }, T("Compare transcripts", "並排比較紀錄")) : null),
    !(r.rounds || []).length ? h("p", { class: "faint" }, T("No rounds yet.", "還沒有回合。")) :
    h("ol", { class: "rt-round-list" }, r.rounds.map((rd) => {
      const actor = rd.actor.kind === "agent" ? [r.def?.roles?.find((x) => x.id === rd.actor.role)?.label || rd.actor.role, rd.actor.provider, rd.actor.model].filter(Boolean).join(" · ") : rd.actor.kind === "check" ? rd.actor.name || T("Check", "檢查") : T("Captain", "船長");
      const imageCards=(r.cards||[]).filter(c=>c.node===rd.node&&c.visit===rd.number&&c.detail?.artifactAcceptance?.offered?.some(o=>o.format==="image"));
      const exact=imageCards.filter(c=>c.detail.artifactAcceptance.review?.round===rd.number&&c.detail.artifactAcceptance.review?.attempt===rd.attempt);
      const imageEvidence=rd.actor.kind==="card"&&imageCards.length&&window.crewImageRefinementSnapshot
        ? exact.length?exact.map(c=>h("div",{"data-round-refinement-card":c.id},h("p",{},c.id),...(c.detail.artifactAcceptance.refinements||[{snapshot:null}]).map(e=>window.crewImageRefinementSnapshot(e.snapshot,{lang:T("en","zh-TW","zh-CN"),review:c.detail.artifactAcceptance.review})))):window.crewImageRefinementSnapshot(null,{lang:T("en","zh-TW","zh-CN")})
        : null;
      const c = rd.cost; const cost = c ? [c.usd != null ? `$${c.usd.toFixed(2)}` : null, c.inTokens != null || c.outTokens != null ? T(`${c.inTokens ?? "—"} in / ${c.outTokens ?? "—"} out tokens`, `${c.inTokens ?? "—"} 輸入 / ${c.outTokens ?? "—"} 輸出 token`) : null, c.seconds != null ? `${c.seconds.toFixed(1)} s` : null].filter(Boolean).join(" · ") : T("No cost recorded", "未記錄費用");
      return h("li", { "data-round-id": rd.id, "data-round-node": rd.node }, h("div", { class: "rt-round-head" }, h("b", {}, rd.actor.label || rd.node),
        h("span", { class: "badge neutral" }, T(`Round ${rd.number}`, `第 ${rd.number} 回合`)), h("span", { class: "faint" }, T(`Attempt ${rd.attempt}`, `第 ${rd.attempt} 次嘗試`))),
        h("p", { class: "rt-round-actor" }, actor), h("dl", {}, field("Started", "開始", stamp(rd.startedAt)), field("Ended", "結束", stamp(rd.endedAt)),
          field("Outcome", "結果", [T(...(outcomes[rd.outcome] || [rd.outcome, rd.outcome])), rd.verdict ? ` · ${rd.verdict}` : ""]), field("Cost", "費用", cost)),
        rd.reason ? h("p", { class: "bad" }, T(rd.reason.en, rd.reason["zh-TW"] || rd.reason.en, rd.reason["zh-CN"])) : null,
        imageEvidence,
        rd.transcript ? h("a", { class: "btn", href: rd.transcript }, T("Transcript", "對話紀錄")) : null);
    })));
}
// an inline panel under the run's header: cancel (with a reason) or delete (with the typed id) read red;
// calmPanel is the same layout with a neutral border for a non-destructive step (continue on the same task)
const endPanel = (title, text, ...kids) => h("div", { class: "card x-pad rt-endpanel", role: "group", "aria-label": title }, h("h3", {}, title), h("p", { class: "faint" }, text), ...kids);
const calmPanel = (title, text, ...kids) => { const el = endPanel(title, text, ...kids); el.classList.add("calm"); return el; };
function viewRun(id) {
  if (!id) return viewRuns();
  if (!RN.view || RN.view.id !== id) { RN.view = { id, r: null }; loadRun(RN.view); }
  const v = RN.view; if (!v.r) return h("div", { class: "page" }, h("div", { class: "skel", style: "height:420px" }));
  const r = v.r; let coffeeProposal=false;try{coffeeProposal=r.workflow==="firstmate-proposal"&&!!JSON.parse(r.params.target||"null")?.params?.coffeeDesignPlan;}catch{} const states = Object.fromEntries(Object.entries(r.nodes).map(([k, n]) => [k, n.state]));
  const act = (what) => api(`/api/wruns/${id}/${what}`, {}).then((x) => { v.r = { ...v.r, ...x }; loadRun(v); rerender(); }).catch((e) => alert(e.message));
  const ended = ["succeeded", "failed", "cancelled"].includes(r.status);
  const canContinue = ended && r.continuable === true && !window.crewRemote?.token?.();
  const open = r.cards.filter((c) => c.status === "open");
  if (!v.collapsed) v.collapsed = matchMedia("(max-width: 640px)").matches ? (window.crewLayout.stagesFor(r.def) || []).map((x) => x.id) : [];
  if (!v.gview) v.gview = (() => { try { return localStorage.getItem("crew.graphView") === "detail" ? "detail" : "simple"; } catch { return "simple"; } })();
  const visits = Object.fromEntries(Object.entries(r.nodes).map(([k, n]) => [k, n.visits || 0]));
  const simpleRun = v.gview === "simple";
  const graphPanel=buildRunGraph(r,v);
  // #/run/<id>?card=<cardId> (a deep link, e.g. from a project page): bring that card into view once
  const want = S.route?.query?.get("card");
  if (want && v.cardShown !== want) { v.cardShown = want; requestAnimationFrame(() => { const el = document.querySelector(`[data-scard="${CSS.escape(want)}"]`);
    if (el) { el.classList.add("rt-card-linked"); el.setAttribute("data-card-linked", "1"); el.scrollIntoView({ block: "start" }); el.querySelector("[data-option]:not([disabled])")?.focus({ preventScroll: true }); }
    else toast(T("That card is no longer waiting: it was answered or withdrawn.", "這張卡片已不在等待：已回答或撤回。")); }); }
  return h("div", { class: `page rt-runview${(r.def.kind==="coffee-kit"||coffeeProposal)?" rt-coffee-run":""}`, "data-runview": id },
    h("div", { class: "phead" }, h("div", {}, h("h1", { title: r.request || r.text || r.title, "data-task-title": r.id }, r.title), h("p", {}, h("span", { class: "mono" }, r.id), " · ", h("a", { href: `#/workflows/${r.workflow}/v${r.version}` }, `${r.workflow} v${r.version}`), " · ", h("span", { "data-run-status": r.status }, window.runStateBadge(r)), r.ctx?.childRun ? [" · ", h("a", {href:`#/run/${r.ctx.childRun}`},T(`Execution: ${r.ctx.childRun}`,`執行任務：${r.ctx.childRun}`))] : null, r.archived ? [" ", h("span", { class: "badge neutral rt-archived-tag", "data-archived": "1" }, T("Archived", "已封存"))] : null, r.error ? ` · ${r.error}` : "")),
      h("div", { class: "actions" }, r.ctx?.captures?.app ? h("a", { class: "btn", href: r.ctx.captures.app, target: "_blank", rel: "noopener", "data-open-app": r.id }, T("Open the app", "打開 app")) : null,
        ["running", "waiting"].includes(r.status) ? h("button", { class: "btn", onclick: () => act("pause") }, T("Pause", "暫停")) : null, r.status === "paused" ? h("button", { class: "btn", onclick: () => act("resume") }, T("Resume", "繼續")) : null,
        r.status === "waiting" && r.def.kind === "coffee-kit" && open.some(c => c.node === "capability") ? h("button", { class: "btn", "data-coffee-recovery": id, onclick: () => api(`/api/wruns/${id}/coffee-recovery`, {}).then(() => loadRun(v)).catch(e => alert(e.message)) }, T("Recheck film capability", "重新檢查影片能力")) : null,
        !ended ? h("button", { class: "btn ghost", "data-run-cancel": id, "aria-expanded": String(v.panel === "cancel"), onclick: () => { v.panel = v.panel === "cancel" ? null : "cancel"; rerender(); } }, T("Cancel task…", "取消任務…")) : null,
        ended ? h("button", { class: "btn", "data-run-archive": id, onclick: () => api(`/api/wruns/${id}/archive`, { archived: !r.archived }).then((x) => { v.r = { ...v.r, ...x }; loadRun(v); RN.list = null; rerender(); }).catch((e) => alert(e.message)) }, r.archived ? T("Unarchive", "取消封存") : T("Archive", "封存")) : null,
        r.claudeVerificationAvailable && !window.crewRemote?.token?.() ? h("button",{class:"btn",type:"button","data-task-claude-verification-open":id,onclick:()=>confirmTaskClaudeVerification(id).then(()=>loadRun(v)).catch(e=>alert(e.message))},T("Authorize Claude verification and continue","授權 Claude 驗證並繼續")) : null,
        r.status === "failed" && !window.crewRemote?.token?.() && (!r.failureCard || r.failure?.code === "internal.unmapped") && !r.archived && !r.parked && !r.ctx?.firstmateQuestion ? h("button", {class:"btn",type:"button","data-failure-refresh":id,onclick:()=>api(`/api/wruns/${id}/failure-refresh`,{}).then(()=>loadRun(v)).catch(e=>alert(e.message))}, T("Refresh failure diagnostics", "重新診斷失敗")) : null,
        // only the desktop captain sees it, and only when the server says an offer can be made (it re-checks every pinned byte on the offer)
        canContinue?h("button",{class:"btn",type:"button",'data-continue-task':r.id,"aria-expanded":String(v.panel==="continue"),onclick:async()=>{if(v.panel==="continue"){v.panel=null;rerender();return;}v.panel='continue';v.continuationMessage='';v.continuationConfirm='';v.continuationOffer=null;v.continuationUncertain=false;rerender();try{v.continuationOffer=await api(`/api/wruns/${r.id}/continuation/offer`,{});}catch(e){v.continuationMessage=e.message;}rerender();}},T("Continue original task…","接續原任務…")):null,
        // Delete stands apart from the other actions (a divider), so it is never tapped by mistake
        ended ? h("span", { class: "rt-danger", "data-danger-zone": id }, h("button", { class: "btn danger", "data-run-delete": id, "aria-expanded": String(v.panel === "delete"), onclick: () => { v.panel = v.panel === "delete" ? null : "delete"; v.delMsg = ""; v.confirm = ""; rerender(); } }, T("Delete…", "刪除…"))) : null)),
    // the captain's full request: the title above is only its short name
    (r.request || r.text) && (r.request || r.text) !== r.title ? h("section", { class: "card x-pad rt-intent", "data-task-intent": r.id }, h("h3", {}, T("Intent", "意圖")), h("p", { class: "rt-intent-text" }, r.request || r.text)) : null,
    v.panel === "cancel" && !ended ? endPanel(T("Cancel this task", "取消這個任務"), T("Its open cards are withdrawn, its agents stop and its on_cancel hooks run. The task ends Cancelled.", "它開著的卡會撤回、agent 會停下、on_cancel hooks 會執行。任務以「已取消」結束。"),
      h("input", { class: "input", "data-cancel-reason": id, placeholder: T("Reason (optional)", "原因（可不填）"), "aria-label": T("Reason", "原因"), value: v.reason || "", oninput: (e) => { v.reason = e.target.value; } }),
      h("div", { class: "actions" }, h("button", { class: "btn danger", "data-cancel-confirm": id, onclick: () => api(`/api/wruns/${id}/cancel`, { reason: v.reason || null }).then((x) => { v.r = { ...v.r, ...x }; loadRun(v); v.panel = null; v.reason = ""; RN.list = null; rerender(); }).catch((e) => { v.cancelMsg = e.message; rerender(); }) }, T("Cancel the task", "取消任務")),
        h("button", { class: "btn ghost", onclick: () => { v.panel = null; rerender(); } }, T("Keep it running", "繼續執行"))), h("div", { class: "bad", role: "status" }, v.cancelMsg || "")) : null,
    v.panel === "delete" && ended ? endPanel(T(`Delete ${id} for good`, `永久刪除 ${id}`), T("Its folder, captures, cards, worktree and branch go. A commit already merged into main stays. The evidence ledger keeps its entries and records the deletion. Type the task id to confirm.", "它的資料夾、截圖、卡片、worktree 和 branch 都會刪除；已合併進 main 的 commit 會留著。證據帳本保留原有紀錄，並記下這次刪除。請輸入任務 id 確認。"),
      // the field starts empty under its hint; Delete for good stays disabled until the typed id matches (the server checks it again)
      h("label", { class: "rt-confirm", for: `del-${id}` }, h("span", { "data-delete-hint": id }, T(`Type ${id} to delete it`, `輸入 ${id} 以刪除`)),
        h("input", { class: "input mono", id: `del-${id}`, "data-delete-confirm-id": id, autocomplete: "off", spellcheck: "false", value: v.confirm || "",
          oninput: (e) => { v.confirm = e.target.value; const b = e.target.closest(".rt-endpanel")?.querySelector("[data-delete-confirm]"); if (b) b.disabled = v.confirm.trim() !== id; } })),
      h("div", { class: "actions" }, h("button", { class: "btn danger-solid", "data-delete-confirm": id, disabled: (v.confirm || "").trim() !== id || null, onclick: () => api(`/api/wruns/${id}/delete`, { confirm: v.confirm || "" }).then(() => { RN.view = null; RN.list = null; location.hash = "#/runs"; }).catch((e) => { v.delMsg = e.message; rerender(); }) }, T("Delete for good", "永久刪除")),
        h("button", { class: "btn ghost", onclick: () => { v.panel = null; rerender(); } }, T("Keep it", "保留"))), h("div", { class: "bad", role: "status", "data-delete-msg": id }, v.delMsg || "")) : null,
    // laid out like Delete below: titled group, "Type <id> to continue it", the primary disabled until the id matches, both buttons on one row
    v.panel==='continue'&&canContinue?calmPanel(T(`Continue ${id} on the same task`,`在原任務上接續 ${id}`),T("A fresh captain card resumes the same task with its outputs, history and requirements. No completed work reruns, and nothing is approved, merged or retried for pay.","會保留原任務的產物、歷史與要求，重新提出船長確認卡。不會重跑已完成的工作，也不會自動核准、合併或付費重試。"),
      v.continuationOffer?h("p",{"data-continuation-card":id},T("Card to reopen: ","要重開的卡片："),h("b",{},L(v.continuationOffer.title))):null,
      v.continuationOffer?h("label",{class:"rt-confirm",for:`cont-${id}`},h("span",{"data-continuation-hint":id},T(`Type ${id} to continue it`,`輸入 ${id} 以接續`)),
        h("input",{class:"input mono",id:`cont-${id}`,'data-continuation-confirm':id,autocomplete:"off",spellcheck:"false",value:v.continuationConfirm||'',
          oninput:e=>{v.continuationConfirm=e.target.value;const b=e.target.closest(".rt-endpanel")?.querySelector("[data-confirm-continuation]");if(b)b.disabled=v.continuationConfirm.trim()!==id||!!v.continuationBusy||!!v.continuationUncertain;}})):null,
      h("div",{class:"actions"},
        v.continuationOffer?h("button",{class:"btn primary",type:"button",'data-confirm-continuation':id,disabled:(v.continuationConfirm||'').trim()!==id||v.continuationBusy||v.continuationUncertain||null,onclick:async()=>{if(v.continuationBusy||v.continuationUncertain||(v.continuationConfirm||'').trim()!==id)return;v.continuationBusy=true;rerender();try{const next=await api(`/api/wruns/${id}/continuation/confirm`,{token:v.continuationOffer.token,confirm:(v.continuationConfirm||'').trim()});v.r={...v.r,...next};v.panel=null;RN.list=null;loadRun(v);}catch(e){v.continuationMessage=T("Could not confirm continuation. Read current state before retrying: ","尚無法確認接續結果；重試前請先讀取目前狀態：")+e.message;v.continuationUncertain=true;}finally{v.continuationBusy=false;rerender();}}},T("Continue the task","接續任務")):null,
        v.continuationUncertain?h("button",{class:"btn",type:"button",'data-continuation-read':id,onclick:async()=>{try{const next=await api(`/api/wruns/${id}`);v.r=next;if(next.continuation?.token===v.continuationOffer?.token){v.panel=null;loadRun(v);}else{v.continuationUncertain=false;v.continuationMessage=T("Current state loaded; review before retrying.","已讀取目前狀態，請檢視後再重試。");}rerender();}catch(e){v.continuationMessage=e.message;rerender();}}},T("Read current state","讀取目前狀態")):null,
        h("button",{class:"btn ghost",type:"button",'data-continuation-keep':id,onclick:()=>{v.panel=null;rerender();}},T("Keep closed","保持關閉"))),
      h("div",{class:"bad",role:"status","data-continuation-msg":id},v.continuationMessage||'')):null,
    r.outputs?.length?h("section",{class:"card x-pad",'data-task-outputs':r.id},h("h3",{},r.outputs.every(o=>o.kind==='doc')?(r.outputs.every(o=>o.label==='competition')?T("Competition write-up","比賽全文"):T("Output","產物")):T("Website output","網站產物")),r.outputs.map(o=>o.kind==='doc'?h("a",{class:"btn",href:o.href,'data-open-task-doc':o.version},o.label==='competition'?T(`Open the competition write-up · v${o.version}`,`檢視比賽全文 · v${o.version}`):T(`Open the full text · v${o.version}`,`檢視完整文字 · v${o.version}`)):h("a",{class:"btn",href:o.href,target:"_blank",rel:"noopener",'data-open-task-website':o.version},T(`Open website in new tab · v${o.version}`,`在新分頁開啟網站 · v${o.version}`)))):null,
    open.length ? h("div", { class: "rt-open" }, open.map(cardView)) : null,
    graphPanel,
    stepsCard(r),
    roundHistory(r),
    h("div", { class: "rt-cols" },
      h("div", { class: "card x-pad" }, h("h3", {}, T("Done lines", "完成條件")), (r.done || []).map((d) => h("div", { class: `rt-done ${d.proved ? "ok" : ""}` }, `${d.proved ? "✓" : "·"} ${d.index + 1}. ${d.text}`)), !(r.done || []).length ? h("p", { class: "faint" }, T("No done lines.", "沒有完成條件。")) : null,
        h("h3", {}, T("Evidence ledger", "證據帳本")), h("p", { class: r.ledgerOk ? "faint" : "bad", "data-ledger-state": id }, !r.ledger.length && r.ledgerOk ? T("No entries yet", "還沒有紀錄") : r.ledgerOk ? T(`${r.ledger.length} entries, signatures verified`, `${r.ledger.length} 筆，簽章已驗證`) : T("the ledger does not verify", "帳本驗證失敗")),
        h("div", { class: "rt-ledger" }, r.ledger.slice(-60).reverse().map((e) => h("div", { class: `rt-le v-${e.verdict}` }, h("span", { class: "mono" }, `#${e.seq}`), ` ${e.check} `, h("b", {}, e.verdict), e.node ? h("span", { class: "faint", "data-ledger-where": e.seq }, v.gview === "detail" ? ` ${e.node}${e.round ? ` r${e.round}` : ""}` // the node id and round in short only in Detail
          : ` · ${r.def?.nodes?.find((x) => x.id === e.node)?.label || e.node}${e.round ? T(`, round ${e.round}`, `，第 ${e.round} 回合`) : ""}`) : null)))),
      h("div", { class: "card x-pad" }, h("h3", {}, T("Timeline", "時間軸")), h("div", { class: "rt-timeline", "data-timeline": id }, r.events.filter((e) => v.gview === "detail" || simpleShows(e, r.events)).slice(-80).reverse().map((e) => h("div", { class: "rt-ev" }, h("span", { class: "mono faint" }, (e.ts || "").slice(11, 19)), " ",
        v.gview === "detail" ? [e.node ? h("b", {}, e.node) : null, ` ${e.type}${e.from || e.to ? ` ${e.from ?? ""}→${e.to ?? ""}` : ""}${e.cause ? ` · ${e.cause}` : ""}`] : timelineLine(e, r)))))));
}
// Run-only navigation: editor gestures and graph topology remain unchanged.
function buildRunGraph(r,v){
 const mode=v.gview||"simple",states=Object.fromEntries(Object.entries(r.nodes).map(([id,n])=>[id,n.state])),current=Object.entries(r.nodes).filter(([,n])=>n.state==="running"||n.state==="waiting"),cur=current[0]?.[0];
 const memory=(v.graphNavigation??={}),saved=memory[mode],detail=h("div",{class:"rt-rungraph-detail", "data-graph-node-detail":"",role:"status"}),viewport=h("div",{class:"rt-rungraph rt-rungraph-viewport"}),panel=h("section",{class:"card rt-rungraph-panel", "data-run-graph-navigation":"", "aria-label":T("Task graph navigation","任務流程圖操作")});
 const select=id=>{const n=r.def.nodes.find(n=>n.id===id),rn=r.nodes[id];if(!n)return;detail.replaceChildren(h("b",{},n.label),h("p",{},T("State: ","狀態：")+(rn?.state||"pending")),h("p",{},rn?.note||rn?.error||T("No blocking reason recorded.","沒有記錄阻塞原因。")));};
 const g=graph(r.def,{redraw:()=>rerender(),states,walked:new Set(r.walked||[]),visits:Object.fromEntries(Object.entries(r.nodes).map(([id,n])=>[id,n.visits||0])),simple:mode==="simple",wrap:Math.max(2,Math.min(8,Math.floor((Math.min(innerWidth,1200)-80)/window.crewLayout.COL))),collapsed:v.collapsed,onToggleStage:sid=>{const c=new Set(v.collapsed);c.has(sid)?c.delete(sid):c.add(sid);v.collapsed=[...c];delete memory[mode];rerender();},onSelect:x=>{if(x?.node)select(x.node);},onView:x=>{memory[mode]={...x};}});
 const bounds=g.lay.bbox;let expanded=false,origin=null,drag=null,suppress=false;
 const set=next=>g.setView(next),fit=()=>{const rect=viewport.getBoundingClientRect(),ratio=Math.max(.2,rect.width/Math.max(1,rect.height)),w=Math.max(bounds.w+48,(bounds.h+48)*ratio),h=w/ratio;set({x:bounds.x+bounds.w/2-w/2,y:bounds.y+bounds.h/2-h/2,w,h});};
 const zoom=(factor,at)=>{const old=g.view,min=(bounds.w+48)/8,max=(bounds.w+48)*4,k=Math.max(min,Math.min(max,old.w*factor))/old.w,c=at||{x:old.x+old.w/2,y:old.y+old.h/2};set({x:c.x-(c.x-old.x)*k,y:c.y-(c.y-old.y)*k,w:old.w*k,h:old.h*k});};
 const point=e=>{const p=g.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(g.getScreenCTM().inverse());};
 const focus=()=>{const n=g.lay.nodes.find(n=>n.id===cur||n.members?.includes(cur))||g.lay.nodes[0];if(!n)return;const rect=viewport.getBoundingClientRect(),ratio=Math.max(.2,rect.width/Math.max(1,rect.height)),w=Math.max(n.w*2,Math.min(bounds.w+48,700)),height=w/ratio;set({x:n.x+n.w/2-w/2,y:n.y+n.h/2-height/2,w,h:height});if(cur)select(cur);};
 const toggle=(restore=false)=>{expanded=!expanded;v.graphExpanded=expanded;panel.classList.toggle("expanded",expanded);panel.setAttribute("role",expanded?"dialog":"region");panel.setAttribute("aria-modal",String(expanded));expand.setAttribute("aria-expanded",String(expanded));expand.textContent=expanded?T("Exit expanded view","退出展開"):T("Expand graph","展開流程圖");if(expanded){origin=expand;expand.focus();}else if(origin?.isConnected)origin.focus();if(!restore)requestAnimationFrame(fit);};
 const button=(key,label,fn)=>h("button",{type:"button",class:"btn sm", "data-run-graph-action":key,onclick:fn},label),expand=button("expand",T("Expand graph","展開流程圖"),toggle);expand.setAttribute("aria-expanded","false");
 const toolbar=h("div",{class:"rt-rungraph-tools",role:"group","aria-label":T("Graph controls","流程圖控制")},["simple","detail"].map(k=>h("button",{class:"btn sm",type:"button","data-view-toggle":k,"aria-pressed":String(mode===k),onclick:()=>{v.gview=k;try{localStorage.setItem("crew.graphView",k);}catch{}rerender();}},k==="simple"?T("Simple","簡易"):T("Detail","詳細"))),button("zoom-in",T("Zoom in +","放大 +"),()=>zoom(.8)),button("zoom-out",T("Zoom out −","縮小 −"),()=>zoom(1.25)),button("fit",T("Fit all","全部顯示"),fit),button("current",T("Focus current","聚焦目前節點"),focus),expand);
 const status=h("div",{class:"rt-rungraph-status","data-current-graph-stage":"",role:"status"},current.length?current.map(([id,rn])=>h("p",{},h("b",{},r.def.nodes.find(n=>n.id===id)?.label||id)," · ",rn.waiting==="card"?T("Waiting for your answer","等待船長回答"):rn.data?.nativeQueue?.state==="waiting"?T("Queued","排隊中"):T("Working","工作中"),rn.note?" · "+rn.note:"")):h("p",{},T("No active node","目前沒有執行中的節點")));
 panel.append(toolbar,status,h("p",{class:"faint"},T("Drag to pan. Wheel zoom in expanded view. Click a node for details.","拖曳平移；展開後可用滾輪縮放。點選節點查看詳細資料。")),viewport,h("div",{class:"rt-rungraph-legend"},[["running",T("Working","執行中")],["waiting",T("Waiting","等待中")],["passed",T("Complete","已完成")],["failed",T("Blocked","受阻")]].map(([state,label])=>h("span",{class:"rt-st st-"+state},label))),detail);viewport.append(g);
 g.addEventListener("pointerdown",e=>{if(e.button!==0||drag||e.pointerType==="touch"&&!expanded)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...g.view},moved:false};});
 g.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<6)return;drag.moved=true;suppress=true;g.interactionActive=true;g.setPointerCapture(e.pointerId);const matrix=g.getScreenCTM(),k=1/Math.max(.00001,matrix.a);set({...drag.view,x:drag.view.x-dx*k,y:drag.view.y-dy*k});e.preventDefault();});
 const release=()=>{if(!drag)return;try{g.releasePointerCapture(drag.id);}catch{}drag=null;g.interactionActive=false;setTimeout(()=>suppress=false,0);};g.addEventListener("pointerup",release);g.addEventListener("pointercancel",release);g.addEventListener("lostpointercapture",release);g.addEventListener("click",e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();}},true);
 g.addEventListener("wheel",e=>{if(!expanded)return;e.preventDefault();zoom(e.deltaY>0?1.12:1/1.12,point(e));},{passive:false});
 panel.addEventListener("keydown",e=>{if(e.key==="Escape"&&expanded){e.preventDefault();toggle();}if(e.key==="Tab"&&expanded){const focusable=[...panel.querySelectorAll('button,a,[tabindex="0"]')];if(e.shiftKey&&document.activeElement===focusable[0]){e.preventDefault();focusable.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===focusable.at(-1)){e.preventDefault();focusable[0]?.focus();}}});
 requestAnimationFrame(()=>{if(saved)set(saved);else fit();if(v.graphExpanded)toggle(true);});return panel;
}
// the agent steps of a run, each with the skills it loaded (name@vN, in order)
function stepsCard(r) {
  const steps = (r.steps || []).filter((st) => st.kind === "agent" && st.state !== "superseded").slice(-30);
  if (!steps.length) return null;
  return h("div", { class: "card x-pad" }, h("h3", {}, T("Agent rounds", "Agent 回合")), h("div", { class: "rt-steps" }, steps.map((st) => h("div", { class: "rt-step", "data-step": st.node },
    h("b", {}, st.node), h("span", { class: "faint" }, T(`Round ${st.visit}`, `第 ${st.visit} 回合`)), h("span", { class: `rt-st st-${st.state}` }, st.state), st.provider ? h("span", { class: "faint" }, st.provider) : null,
    (st.skills || []).length ? h("span", { class: "rt-step-skills", "data-step-skills": st.node, "aria-label": T("Skills loaded", "載入的技能") }, st.skills.map((x) => h("span", { class: "vbadge" }, x))) : null))));
}
// one Studio card: the shared component (public/scard.js), mounted once per card and kept across re-renders so the
// captain's ticks, note and door confirmation survive live updates; the same component serves the run view and the Inbox
const MOUNTS = new Map();
function cardView(c, o = {}) {
  const key = `${o.inbox ? "inbox" : "run"}:${c.id}`; let m = MOUNTS.get(key);
  // an unchanged card is not re-rendered at all: the captain's focus, caret, note and ticks stay as they are (unit inbox-live)
  const sig = JSON.stringify(c);
  if (m && m.status === c.status) { if (m.sig !== sig) { m.ctl.update(c); m.sig = sig; } return m.el; }
  const el = h("div", { class: "card x-pad rt-card", "data-scard": c.id });
  const ctl = window.crewCard.mountCard(el, c, { inbox: !!o.inbox, onAnswered: () => { RN.view && (RN.view.stale = true); loadRun(RN.view); loadOpenCards(); } });
  MOUNTS.set(key, { el, ctl, status: c.status, sig }); if (MOUNTS.size > 60) MOUNTS.delete(MOUNTS.keys().next().value);
  return el;
}
const zhOn = () => zh();
async function loadRun(v) { if (!v) return; try { v.r = await api(`/api/tasks/${v.id}`); } catch (e) { v.r = null; } if (RN.view === v && S.route?.name === "run") render(); }
live.listeners.add((t, d) => {
  if (t === "wrun" && d.deleted) { RN.list = null; if (S.route?.name === "run" && RN.view?.id === d.id) { RN.view = null; location.hash = "#/runs"; return; } }
  if (S.route?.name === "run" && RN.view && (d.id === RN.view.id || d.run === RN.view.id)) { clearTimeout(RN.t); RN.t = setTimeout(() => loadRun(RN.view), 150); }
  if (S.route?.name === "runs" && t === "wrun") { clearTimeout(RN.lt); RN.lt = setTimeout(() => { RN.list = null; render(); }, 300); }
});
// leaving a page drops what it loaded, so coming back shows fresh data
addEventListener("hashchange", () => { if (!/^#\/(runs|tasks)(\/|$)/.test(location.hash)) RN.list = null; if (!/^#\/(run\/|tasks\/R-\d+)/.test(location.hash)) RN.view = null;
  if (!location.hash.startsWith("#/workflows")) { WF.list = null; WF.ed?.dispose?.(); WF.ed = null; } });

// ---------- Studio's own cards in the Inbox, beside firstmate's (labelled with run, workflow and node; answered with the same buttons) ----------
// Live (unit inbox-live): a card raised, answered elsewhere or withdrawn reaches the Inbox, the sidebar counts and the
// Board through the page's one stream; after the stream reconnects (a server restart, a laptop that slept) the cards
// are read again, so an event missed meanwhile is never lost. A card that arrives while the page is open shows one
// non-blocking cue (a status line outside the page view, never a dialog).
const SCX = { open: [], t: null, seen: null, fresh: [], cueT: null };
async function loadOpenCards() {
  try { SCX.open = (await api("/api/scards?open=1")).cards || []; } catch { return; }
  const ids = SCX.open.map((c) => c.id);
  if (SCX.seen) { const add = ids.filter((id) => !SCX.seen.has(id)); if (add.length) cueNew(add); for (const id of add) SCX.seen.add(id); }
  else SCX.seen = new Set(ids); // the cards already waiting when the page opened are not news
  SCX.fresh = SCX.fresh.filter((id) => ids.includes(id)); if (!SCX.fresh.length) dropCue();
  updateNav(); if (S.route?.name === "board") soft(); else if (S.route?.name === "inbox") render(); else updateCue();
}
function cueNew(ids) { SCX.fresh = [...new Set([...SCX.fresh, ...ids])]; updateCue(); clearTimeout(SCX.cueT); SCX.cueT = setTimeout(dropCue, 30000); }
function dropCue() { SCX.fresh = []; document.querySelector("[data-new-card-cue]")?.remove(); }
function updateCue() {
  const n = SCX.fresh.length; let el = document.querySelector("[data-new-card-cue]");
  if (!n) { el?.remove(); return; }
  if (!el) { el = h("div", { class: "rt-cue", role: "status", "aria-live": "polite", "data-new-card-cue": "" }); document.body.append(el); }
  const one = SCX.open.find((c) => c.id === SCX.fresh[0]);
  el.replaceChildren(h("span", { class: "rt-cue-dot" }), h("span", {}, n === 1 ? T(`1 new card: ${one ? L(one.title) : SCX.fresh[0]}`, `1 張新卡片：${one ? L(one.title) : SCX.fresh[0]}`) : T(`${n} new cards`, `${n} 張新卡片`)),
    h("a", { class: "btn", href: n === 1 ? `#/inbox/${encodeURIComponent(SCX.fresh[0])}` : "#/inbox", "data-new-card-show": "", onclick: () => setTimeout(dropCue, 0) }, T("Show", "查看")),
    h("button", { class: "btn ghost", type: "button", "aria-label": T("Dismiss", "關閉"), "data-new-card-dismiss": "", onclick: dropCue }, "×"));
}
live.listeners.add((t) => { if (t === "scard") { clearTimeout(SCX.t); SCX.t = setTimeout(loadOpenCards, 150); } });
addEventListener("crew:live", () => loadOpenCards()); // the stream (re)connected: read the cards again
addEventListener("hashchange", () => { if (location.hash.startsWith("#/inbox")) loadOpenCards(); }); // coming to the Inbox shows fresh cards
loadOpenCards();
window.studioCards = { count: () => SCX.open.length,
  needRows: () => SCX.open.map((c) => h("div", { class: "need", "data-need-scard": c.id }, h("div", { class: "need-ic", style: "background:var(--human-soft);color:var(--human)" }, c.kind === "merge" ? "⇢" : "?"),
    h("div", {}, h("div", { class: "need-t" }, L(c.title)), h("div", { class: "need-d" }, [c.run, c.workflow, c.node].join(" · "))),
    h("div", { class: "need-r" }, h("a", { class: "btn", href: `#/inbox/${encodeURIComponent(c.id)}` }, T("Open", "打開"))))),
  // #/inbox/<id> shows that card first and every other waiting card under it: a card that arrives while the captain
  // is on one card (the Board's Open link) is never hidden; when that card is answered or withdrawn, the rest stay
  section: (id) => { const focus = id ? SCX.open.find((c) => c.id === id) : null; const cs = focus ? [focus, ...SCX.open.filter((c) => c.id !== id)] : SCX.open; if (!cs.length) return null;
    return h("section", { class: "rt-inbox", "data-inbox-studio": "1" }, h("div", { class: "sec-head" }, h("h2", {}, T("Studio tasks", "Studio 的任務")), h("span", { class: "badge human" }, String(cs.length))),
      id && !focus ? h("p", { class: "faint", "data-inbox-gone": id }, T(`${id} is no longer waiting. The cards below still are.`, `${id} 已經不在等待中。下面這些還在等。`)) : null,
      cs.map((c) => cardView(c, { inbox: true }))); } };

// ---------- Studio tasks' live agent node runs on the Crew page, beside firstmate's rounds ----------
const SA = { local: [], list: [], t: null, pending: null, ready: false, error: false };
function agentsChanged(){ updateNav(); if (["crew","board"].includes(S.route?.name) && !S.route.arg) soft(); }
async function loadAgents() {
  if(SA.pending)return SA.pending;
  SA.pending=(async()=>{try{const data=await api("/api/wruns/agents");SA.list=data.agents||[];SA.local=data.localJobs||[];SA.ready=true;SA.error=false;}catch{SA.error=true;}finally{SA.pending=null;agentsChanged();}})();
  return SA.pending;
}
for (const t of ["agent", "wrun", "coffee-local-job"]) window.liveListen(t, () => { clearTimeout(SA.t); SA.t = setTimeout(loadAgents, 200); });
addEventListener("crew:live",loadAgents);
addEventListener("hashchange", () => { if (/^#\/(crew|board)(?:[/?]|$)/.test(location.hash)) loadAgents(); });
setInterval(() => { if (["crew","board"].includes(S.route?.name) && !S.route.arg) loadAgents(); }, 3000); // missed events still converge
loadAgents();
const elapsed = (iso) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
window.studioAgents = { members: () => [...SA.list.map(a=>({name:a.label||a.provider,title:`${a.run} · ${a.label} · ${a.provider}`,href:`#/run/${encodeURIComponent(a.run)}`})),...SA.local.filter(j=>j.outcome==="running"||j.cleanup==="unverified").map(j=>({name:j.label,title:`${j.task} · ${j.label}`,href:`#/run/${encodeURIComponent(j.task)}`}))], ready: () => SA.ready && !SA.error, status: () => SA.error ? T("Crew status unavailable; retrying…", "船員狀態暫時無法取得，正在重試…") : T("Checking crew status…", "正在確認船員狀態…"), count: () => SA.list.length+SA.local.filter(j=>j.outcome==="running"||j.cleanup==="unverified").length,
  section: () => h("section", { class: "rt-agents", "data-studio-agents": String(SA.list.length+SA.local.filter(j=>j.outcome==="running"||j.cleanup==="unverified").length) },
    h("div", { class: "sec-head" }, h("h2", {}, T("Studio tasks: agents working", "Studio 的任務：工作中的 agent")), h("span", { class: "faint" }, SA.error || !SA.ready ? window.studioAgents.status() : String(window.studioAgents.count()))),
    SA.local.length ? h("section", {"data-local-render-jobs":"1"}, h("h3",{},T("Local render jobs (this server session)","本機渲染工作（本次伺服器執行期間）")), SA.local.map(j=>h("article",{class:"card x-pad", "data-local-render-job":j.id},h("b",{},j.label),h("p",{},h("a",{href:`#/run/${encodeURIComponent(j.task)}`},j.task),` · ${j.provider} · ${j.phase}`),h("p",{},T("Outcome","結果"),`: ${j.outcome} · `,T("Cleanup","清理"),`: ${j.cleanup}`),h("p",{class:"faint"},T("Started","開始"),`: ${j.startedAt} · `,T("Last progress","最近進度"),`: ${j.lastProgressAt}`)))):null,
    SA.list.length ? h("div", { class: "rt-agent-grid" }, SA.list.map((a) => { const base = `#/runs/node/${encodeURIComponent(a.run)}/${encodeURIComponent(a.node)}/${a.round}`;
      return h("article", { class: "card x-pad rt-agent", "data-agent-node": a.node ? `${a.run}/${a.node}/${a.round}` : a.job },
        h("div", { class: "rt-agent-h" }, h("b", {}, a.label), a.role ? h("span", { class: "vbadge" }, a.role) : null, h("span", { class: "st" }, h("span", { class: "d pulse" }), T("working", "工作中"))),
        h("div", { class: "rt-agent-m" }, h("a", { href: `#/run/${encodeURIComponent(a.run)}`, class: "mono" }, a.run), h("span", {}, a.workflow), a.round ? h("span", {}, T(`round ${a.round}`, `第 ${a.round} 回合`)) : null,
          h("span", { "data-elapsed": a.startedAt }, T(`up ${elapsed(a.startedAt)}`, `已跑 ${elapsed(a.startedAt)}`)), h("span", { class: "vbadge" }, `${a.provider}${a.model ? ` · ${a.model}` : ""}`)),
        h("div", { class: "rt-agent-act faint" }, a.lastActivity ? `${a.lastActivity.kind}: ${a.lastActivity.text}` : T("starting…", "啟動中…")),
        a.node ? h("div", { class: "rt-row" }, [["prompt", T("Prompt", "提示詞")], ["transcript", T("Transcript", "對話紀錄")], ["report", T("Report", "報告")]].map(([k, l]) => h("a", { class: "btn ghost", href: `${base}/${k}`, "data-agent-link": k }, l))) : null); }))
      : h("p", { class: "faint" }, SA.error || !SA.ready ? window.studioAgents.status() : SA.local.some(j=>j.outcome==="running"||j.cleanup==="unverified") ? T("Local jobs are listed above.","本機工作列於上方。") : T("No Studio agent is working right now.", "目前沒有 Studio 的 agent 在工作。"))) };

// Free authoring is separate from model execution and staffing admission.
// Choices a node may take (the server's closed sets, read once): providers, efforts, bundled role skills.
const DRAFT_OPTS={value:null,pending:null};
const draftOpts=()=>DRAFT_OPTS.value?Promise.resolve(DRAFT_OPTS.value):(DRAFT_OPTS.pending||=api("/api/wf/drafts").then(j=>(DRAFT_OPTS.value={providers:j.providers||[],efforts:j.efforts||[],skills:j.skills||[]})).finally(()=>{DRAFT_OPTS.pending=null;}));
/** One agent node's worker/reviewer model settings: provider, model, effort and role skill.
 *  live: each change applies at once (the editor's next saved version); otherwise a Save button posts it. */
function nodeModelControls(n,roleSkill,{onChange,onSave,attr}){
  const opts=DRAFT_OPTS.value||{providers:["codex","claude"],efforts:["minimal","low","medium","high","xhigh"],skills:[]};
  const sel=(k,list,label,cur)=>h("label",{class:"rt-field"},h("span",{},label),h("select",{class:"select",[`data-node-config-${k}`]:"",onchange:e=>onChange?.(k,e.target.value)},h("option",{value:""},k==="skill"?T("Role default","角色預設"):T("Not chosen","尚未選擇")),list.map(([v,l])=>h("option",{value:v,selected:v===cur||null},l))));
  let catalog=null,chosenProvider=n.provider||"",chosenModel=n.model||"";
  const model=h("select",{class:"select","data-node-config-model":"",onchange:e=>{const custom=e.target.value==="__custom__";customModel.hidden=!custom;if(custom){customModel.focus();return;}chosenModel=e.target.value;onChange?.("model",chosenModel);}});
  const customModel=h("input",{class:"input",hidden:true,"data-node-config-custom-model":"",autocomplete:"off",spellcheck:"false",placeholder:T("Other model ID","其他模型代號"),maxlength:80,onchange:e=>{chosenModel=e.target.value.trim();onChange?.("model",chosenModel);}});
  const fillModels=()=>{const list=catalog?.providers?.find(p=>p.id===chosenProvider)?.models||[];const ids=[...new Set([...list.map(m=>m.id),...(chosenModel?[chosenModel]:[])])];model.replaceChildren(h("option",{value:""},T("Choose a model","選擇模型")),...ids.map(id=>h("option",{value:id,selected:id===chosenModel||null},id)),h("option",{value:"__custom__"},T("Other model…","其他模型…")));model.value=chosenModel;};
  fillModels();api("/api/models").then(value=>{catalog=value;if(box.isConnected&&model.value!=="__custom__")fillModels();}).catch(()=>{});
  const status=h("span",{class:"faint",role:"status","data-node-config-status":""});
  const box=h("div",{class:"fw-node-config",[attr]:n.id},
    h("h4",{},T("Who does this node","這個節點由誰做")),h("p",{class:"faint"},T("Select a model now; availability is checked before running.","先選模型；執行前會檢查實際可用性。")),
    sel("provider",opts.providers.map(v=>[v,v==="codex"?"Codex":"Claude"]),T("Provider","供應商"),n.provider),
    h("label",{class:"rt-field"},h("span",{},T("Model","模型")),model,customModel),
    sel("effort",opts.efforts.map(v=>[v,v]),T("Reasoning effort","推理強度"),n.effort),
    sel("skill",opts.skills.map(x=>[x.ref,T(x.en,x.zh)]),T("Role skill","角色技能"),n.skill),
    h("p",{class:"faint"},T(`Role default: ${roleSkill?skillName(roleSkill):"none"}. Nothing runs or is staffed here; you confirm staffing when you click Run.`,`角色預設：${roleSkill?skillName(roleSkill):"無"}。這裡不會執行或派工；按下執行時才會確認人員配置。`)),
    onSave?h("div",{class:"rt-row"},h("button",{class:"btn sm primary",type:"button","data-node-config-save":"",onclick:async()=>{const val=k=>k==="model"?chosenModel:box.querySelector(`[data-node-config-${k}]`).value;status.textContent=T("Saving…","儲存中…");try{const r=await onSave({provider:val("provider"),model:val("model").trim(),effort:val("effort"),skill:val("skill")});status.textContent=T(`Saved · revision ${r.revision}`,`已儲存 · 第 ${r.revision} 版`);}catch(e){status.textContent=e.message;}}},T("Save node settings","儲存節點設定")),status):null);
  box.querySelector('[data-node-config-provider]').addEventListener('change',e=>{chosenProvider=e.target.value;chosenModel="";customModel.hidden=true;customModel.value="";onChange?.("model","");fillModels();});
  // choices that arrive late fill the selects in place: never replace the box under the captain's typing or click
  if(!DRAFT_OPTS.value)draftOpts().then(o=>{const fill=(k,list)=>{const el=box.querySelector(`[data-node-config-${k}]`);if(!el)return;const cur=el.value;el.replaceChildren(el.firstChild,...list.map(([v,l])=>h("option",{value:v,selected:v===cur||null},l)));el.value=cur;};fill("provider",o.providers.map(v=>[v,v==="codex"?"Codex":"Claude"]));fill("effort",o.efforts.map(v=>[v,v]));fill("skill",o.skills.map(x=>[x.ref,T(x.en,x.zh)]));}).catch(()=>{});
  return box;
}
/** Run of the captain's own workflow: the staffing confirmation appears only now. Resolves true when confirmed. */
function claudeVerificationDisclosure(plan){
  if(!plan?.nodes?.length)return null;
  return h("div",{"data-claude-verification-disclosure":""},h("p",{},T("This confirmation authorizes one bounded Claude verification request for each node below when execution readiness has expired. Each request uses at most 1 turn and USD 0.05. This is separate from the node's work, does not verify quota, and never changes providers. No automatic paid retry after its allowance is consumed.","此確認授權以下每個節點在執行就緒驗證失效時進行一次有上限的 Claude 驗證：每次最多 1 回合、USD 0.05。這與節點本身的工作分開、不代表額度已驗證，也不會切換供應商。用完後不會自動付費重試。")),plan.nodes.map(n=>h("p",{"data-claude-verification-node":n.node},`${n.node}: Claude / ${n.model} / ${n.effort||"—"} · 1 × USD 0.05`)));
}
async function confirmTaskClaudeVerification(id){
 const offer=await api(`/api/wruns/${id}/claude-verification/offer`,{});
 const accepted=await new Promise(resolve=>{const dlg=h("dialog",{class:"fw-dialog","data-task-claude-verification":""});const close=v=>{dlg.close();dlg.remove();resolve(v);};dlg.append(h("h2",{},T("Authorize verification and continue this Task","授權驗證並繼續原任務")),claudeVerificationDisclosure({...offer.plan,nodes:offer.plan.nodes.filter(n=>n.node===offer.node)}),h("button",{class:"btn",onclick:()=>close(false)},T("Cancel","取消")),h("button",{class:"btn primary","data-claude-verification-confirm":"",onclick:()=>close(true)},T("Authorize and continue","授權並繼續")));dlg.addEventListener("cancel",e=>{e.preventDefault();close(false);});document.body.append(dlg);dlg.showModal();});
 if(accepted)await api(`/api/wruns/${id}/claude-verification/confirm`,{...offer,confirm:"authorize-bounded-verification"});
}
function staffingConfirm(staffing,missing){
  return new Promise(resolve=>{
    const dlg=h("dialog",{class:"fw-dialog","data-staffing-confirm":"","aria-label":T("Confirm staffing","確認人員配置")});
    const close=v=>{dlg.close();dlg.remove();resolve(v);};
    dlg.append(h("h2",{},missing?T("Choose who works on each node","請先選擇每個節點的人員"):T("Confirm staffing before this Task starts","開始任務前確認人員配置")),
      h("p",{},missing?T("These agent nodes still need a provider, model and (for Codex) effort. Select the node in the editor to choose.","這些代理節點還需要供應商、模型與（Codex）推理強度；請在編輯器選取節點設定。"):T("Only your confirmation starts the Task. Each node below runs with exactly this provider, model, effort and skill.","只有你的確認會開始任務；以下每個節點將完全依照這些供應商、模型、推理強度與技能執行。")),
      h("table",{class:"fw-staffing"},h("thead",{},h("tr",{},[T("Node","節點"),T("Provider","供應商"),T("Model","模型"),T("Effort","推理強度"),T("Skill","技能")].map(x=>h("th",{},x)))),
        h("tbody",{},staffing.plan.map(r=>h("tr",{"data-staffing-row":r.node,class:staffing.missing.includes(r.node)?"missing":null},h("td",{},r.label),h("td",{},r.provider||"—"),h("td",{},r.model||"—"),h("td",{},r.effort||"—"),h("td",{},r.skill?skillName(r.skill):"—"))))),
      claudeVerificationDisclosure(staffing.claudeVerification),
      h("div",{class:"actions"},h("button",{class:"btn",type:"button","data-staffing-cancel":"",onclick:()=>close(false)},missing?T("Close","關閉"):T("Cancel, no Task","取消，不開始")),missing?null:h("button",{class:"btn primary",type:"button","data-staffing-approve":"",onclick:()=>close(true)},T("Confirm staffing and start","確認配置並開始"))));
    dlg.addEventListener("cancel",e=>{e.preventDefault();close(false);});
    document.body.append(dlg);dlg.showModal();
  });
}
// Project-scoped workflows (code-firstmate) start on a registered project. A staffed one shows that project's crew:
// approved, missing (with the way to choose it), or why it cannot start. The server still checks all of it at Start.
function startOptions(id) {
  if (!id) return null; const all = (RN.startOptions ||= {});
  if (all[id] === undefined) { all[id] = "loading"; api(`/api/wruns/start-options?workflow=${encodeURIComponent(id)}`).then((j) => { all[id] = j; rerender(); }).catch((e) => { all[id] = { error: e.message }; rerender(); }); }
  return all[id] === "loading" ? null : all[id];
}
function startProjectPicker(id) {
  const o = startOptions(id); if (!o?.projectScoped) return null;
  const vals = ((RN.params ||= {})[id] ||= {}), chosen = o.projects.find((p) => p.id === vals.project);
  const sel = h("select", { class: "select", "data-run-project": id, "aria-label": T("Project", "專案"), onchange: (e) => { vals.project = e.target.value; RN.startError = ""; rerender(); } },
    h("option", { value: "" }, T("Choose a registered project", "選擇已登錄專案")), o.projects.map((p) => h("option", { value: p.id, selected: vals.project === p.id || null }, p.name || p.id)));
  const s = o.staffing && chosen ? chosen.staffing : null;
  const crew = !o.projects.length ? h("span", { class: "faint", "data-run-crew": "no-project" }, T("No registered project yet. Ask Firstmate to register one.", "尚無已登錄專案；請請 Firstmate 登錄專案。"))
    : !s ? null
    : s.state === "approved" ? h("span", { class: "badge ok", "data-run-crew": "approved" }, T(`Crew approved · v${s.version}`, `代理配置已核准 · v${s.version}`))
    : s.state === "missing" ? h("span", { class: "rt-crew", "data-run-crew": "missing" }, T("No crew approved for this project. ", "此專案尚未核准代理配置。"), h("a", { href: o.crewHref, "data-run-crew-link": "1" }, T("Choose your crew together", "一起決定代理配置")))
    : h("span", { class: "rt-crew", role: "alert", "data-run-crew": "blocked", "data-run-crew-code": s.code }, h("b", {}, T("Cannot start", "無法開始")), ` · ${s.code} · `, T(s.reason.en, s.reason.zh), s.code === "staffing_changed" ? h("a", { href: o.crewHref, "data-run-crew-link": "1" }, " ", T("Choose your crew again", "重新決定代理配置")) : null);
  return h("div", { class: "rt-row rt-start-project", "data-run-project-row": id }, h("span", { class: "lbl" }, T("Project", "專案")), sel, crew);
}
function startProjectValue(id) { const v = ((RN.params || {})[id] || {}).project; return v ? { project: v } : {}; }
// the approved crew the form showed: the server refuses the start if it was approved again since (staffing_changed)
function startStaffingExpected(id) { const o = (RN.startOptions || {})[id], chosen = o && o !== "loading" && o.staffing ? o.projects.find((p) => p.id === ((RN.params || {})[id] || {}).project) : null; return chosen?.staffing?.state === "approved" ? { staffingExpected: chosen.staffing.hash } : {}; }
function startBlocked(id) { const o = (RN.startOptions || {})[id]; if (!o || o === "loading" || !o.projectScoped) return false; const chosen = o.projects.find((p) => p.id === ((RN.params || {})[id] || {}).project); return !chosen || (o.staffing && chosen.staffing?.state !== "approved"); }
// Adapted from single-source-contracts: Start inputs come from the selected workflow declaration.
function startParamSchema(id){return (RN.wfs||[]).find(w=>w.id===id)?.params||{};}
function startParamOwned(id,key){return key==="provider"||(key==="project"&&RN.startOptions?.[id]?.projectScoped);}
function startParamInputs(id){
  const values=((RN.params||={})[id]||={});
  return h("div",{"data-run-params":id},Object.entries(startParamSchema(id)).filter(([key])=>!startParamOwned(id,key)).map(([key,p])=>{
    const input=h("input",{class:"input","data-run-param":key,"aria-label":T(p.label,p.labelZh||p.label),required:p.required||null,placeholder:p.default??"",oninput:e=>{values[key]=e.target.value;RN.startError="";}});input.value=values[key]??"";
    return h("label",{class:"rt-field"},h("span",{},T(p.label,p.labelZh||p.label),p.required?" *":""),input);
  }));
}
function startParamValues(id){
  const schema=startParamSchema(id),values=RN.params?.[id]||{};
  const missing=Object.entries(schema).filter(([key,p])=>!startParamOwned(id,key)&&p.required&&!String(values[key]??p.default??"").trim()).map(([key])=>key);
  if(missing.length)throw Error(T("Required workflow inputs: ","必須提供流程輸入：")+missing.join(", "));
  return Object.fromEntries(Object.keys(schema).filter(key=>!startParamOwned(id,key)&&String(values[key]??"").trim()).map(key=>[key,values[key]]));
}
async function startOwnRun(body){
  try{return await api("/api/wruns",body);}
  catch(e){const j=e.staffing;if(e.code==="staffing_incomplete"){await staffingConfirm(j,true);return null;}if(e.code!=="staffing_confirmation_required")throw e;if(!await staffingConfirm(j,false))return null;return api("/api/wruns",{...body,staffingConfirm:j.hash,claudeVerification:j.claudeVerification});}
}
const DRAFT_LIVE={fn:null};window.liveListen?.("wfdraft",()=>DRAFT_LIVE.fn?.());
// ---------- readiness gate (src/readiness): stages 1-5, problems with step / reason / fix, briefs, repair rounds ----------
const GATE_LIVE=new Set();window.liveListen?.("wfgate",e=>{let d=null;try{d=JSON.parse(e?.data??"null");}catch{}for(const f of GATE_LIVE)f(d);});
const GATE_STAGES=[["intent","Intent lines","意圖條目"],["contract","Static contract","靜態契約"],["brief","Briefs","簡報"],["dryrun","Stub dry run","替身試跑"],["smoke","Real run","真實試跑"]];
const gateStateText=s=>({pass:T("passed","通過"),fail:T("failed","未通過"),running:T("running","進行中"),skipped:T("waits for 1-3","等前三關"),pending:T("optional","可選")}[s]||s);
const gateL=x=>x?(lang==="en"?x.en:(x.zh||x["zh-TW"]||x.en)):"";
/** Who serves each intent line: the captain's words, what done means, and the nodes that serve it. */
function gateIntents(v){if(!v?.intents?.length)return h("p",{class:"faint","data-gate-intents":"0"},T("No intent lines yet: Firstmate adds them in your words.","尚無意圖條目：Firstmate 會用你的話寫上。"));
  return h("ol",{class:"gate-intents","data-gate-intents":String(v.intents.length)},v.intents.map(l=>h("li",{"data-intent-line":l.n},h("b",{},l.text),h("span",{class:"faint"},T(" — done means: "," — 完成的意思："),l.done),l.assumption?h("span",{class:"gate-assume"},T(` (assumed: ${l.assumption})`,`（假設：${l.assumption}）`)):null,
    h("div",{class:"gate-serves"},l.nodes.length?[T("Served by ","服務節點："),...l.nodes.flatMap((n,i)=>[i?", ":"",h("span",{class:"gate-node","data-serves-node":n.id},n.label)])]:h("span",{class:"gate-bad"},T("served by no node","沒有節點服務"))))));}
function gatePanel(v,o={}){
  const g=v?.gate,st=v?.status,box=h("section",{class:"gate","data-gate":v?.key||"","data-gate-verified":st?.verified?"1":"0"});
  // the badge says verified or not; the line after it says why, once (no "Not verified yet" twice)
  const why=(gateL(st?.text)||T("Checking…","檢查中…")).replace(/^Not verified yet: (.)/,(_,c)=>c.toUpperCase()).replace(/^尚未驗證：/,"");
  box.append(h("div",{class:"gate-head"},o.badge===false?null:h("span",{class:`badge gate-badge ${st?.verified?"ok":"wait"}`,"data-gate-badge":""},st?.verified?T("Verified","已驗證"):T("Not verified yet","尚未驗證")),h("span",{"data-gate-status":st?.stage||"",class:"gate-line"},why)));
  const notice=v?.repair?.notice;if(notice)box.append(h("p",{class:"gate-notice","data-gate-notice":v.repair.status},gateL(notice)));
  // the captain's part (staffing at Run, a sign-in, a network grant): plain lines, apart from the problems, never counted as one
  const yours=[...new Set((g?.stages||[]).flatMap(s=>s.problems).filter(p=>p.owner==="captain"&&p.note).map(p=>gateL(p.note)))];
  if(yours.length&&!notice)box.append(h("div",{class:"gate-yours","data-gate-yours":String(yours.length)},h("b",{},T("Your part","你要做的")),h("ul",{},yours.map(t=>h("li",{},t)))));
  if(v?.repair?.status==="repairing")box.append(h("p",{class:"faint","data-gate-repairing":""},T(`Firstmate is repairing the draft (round ${v.repair.rounds.length}${v.repair.strategy==="redraft"?", redrafting":""}).`,`Firstmate 正在修正草稿（第 ${v.repair.rounds.length} 輪${v.repair.strategy==="redraft"?"，重新起草":""}）。`)));
  if(o.intents!==false)box.append(h("h3",{},T("Intent lines","意圖條目")),gateIntents(v));
  box.append(h("ol",{class:"gate-stages"},GATE_STAGES.map(([id,en,zh],i)=>{const s=g?.stages.find(x=>x.id===id),status=s?.status||(g?"pending":"running"),errs=(s?.problems||[]).filter(p=>p.level!=="notice");
    return h("li",{"data-gate-stage":id,"data-gate-state":status,class:`gate-stage s-${status}`},h("div",{class:"gate-stage-head"},h("b",{},`${i+1} · ${T(en,zh)}`),h("span",{class:"gate-state"},gateStateText(status))),
      s?.note&&status!=="skipped"?h("p",{class:"faint"},gateL(s.note)):null,
      errs.length?h("ul",{class:"gate-problems"},errs.map(p=>h("li",{"data-gate-problem":p.code,"data-gate-owner":p.owner,class:p.level==="notice"?"notice":p.owner==="captain"?"captain":""},
        h("div",{},h("span",{class:"faint"},T("Step: ","步驟：")),p.node?h("code",{},p.node):T("whole workflow","整個流程"),p.owner==="captain"?h("span",{class:"badge gate-you"},T("only you","只有你能處理")):null),
        h("div",{},h("span",{class:"faint"},T("Reason: ","原因：")),gateL(p.reason)),h("div",{},h("span",{class:"faint"},T("How to fix: ","修正方式：")),gateL(p.fix))))):null);})));
  if(v?.repair?.rounds?.length)box.append(h("details",{class:"gate-rounds","data-gate-rounds":String(v.repair.rounds.length)},h("summary",{},T(`Repair rounds (${v.repair.rounds.length})`,`修正輪次（${v.repair.rounds.length}）`)),
    h("ol",{},v.repair.rounds.map(r=>h("li",{"data-gate-round":r.n},h("b",{},T(`Round ${r.n}${r.strategy==="redraft"?" · redraft":""}: `,`第 ${r.n} 輪${r.strategy==="redraft"?"・重新起草":""}：`)),r.problems.map(p=>`${p.node?p.node+": ":""}${gateL(p.reason)}`).join(" · "),
      h("div",{class:"faint"},"→ ",r.refused?T(`refused: ${r.refused}`,`被拒絕：${r.refused}`):r.changes?r.changes.join(", "):T("waiting for Firstmate","等待 Firstmate")))))));
  if(g?.briefs?.length)box.append(h("details",{class:"gate-briefs","data-gate-briefs":String(g.briefs.length)},h("summary",{},T(`Rendered briefs (${g.briefs.length} agent node${g.briefs.length>1?"s":""})`,`產生的簡報（${g.briefs.length} 個代理節點）`)),
    ...g.briefs.map(b=>h("details",{class:"gate-brief","data-gate-brief":b.node},h("summary",{},b.label),h("p",{class:"faint"},T("Round folder: ","回合資料夾："),h("code",{},b.roundDir)),h("pre",{class:"fw-json"},b.system+"\n\n---\n\n"+b.prompt)))));
  if(o.verify&&v?.own&&v.passed&&!st?.verified&&g?.smoke?.status!=="running")box.append(h("div",{class:"actions"},h("button",{class:"btn","data-gate-verify":v.workflow,onclick:o.verify},T("Verify with a real run","以真實任務驗證")),h("span",{class:"faint"},T("Starts one real Task on your subscription with a small sample input; you answer its cards.","以小型樣本在你的訂閱上開始一個真實任務；卡片由你回答。"))));
  if(g?.smoke?.status==="running")box.append(h("p",{"data-gate-smoke":"running"},T("Verification run: ","驗證試跑："),h("a",{href:`#/run/${g.smoke.task}`},g.smoke.task)));
  return box;
}
/** Review the actual task brief and declared inputs before Run, including workflows without params. */
function startInputs(def,text,onText){const ps=Object.entries(def?.params||{});
  return new Promise(resolve=>{const dlg=h("dialog",{class:"fw-dialog","data-start-inputs":""}),fields={},brief=h("textarea",{class:"input",rows:4,maxlength:2000,required:true,"data-start-brief":"",oninput:e=>onText(e.target.value)}),status=h("p",{role:"status"});brief.value=text;
    const close=v=>{dlg.close();dlg.remove();resolve(v);};
    dlg.append(h("h2",{},T("Review task requirements","確認任務需求")),h("label",{class:"rt-field"},h("span",{},T("What should this task make?","這次任務要做什麼？")),brief),...ps.map(([k,p])=>h("label",{class:"rt-field"},h("span",{},T(p.label,p.labelZh||p.label)),fields[k]=h("input",{class:"input",value:p.default??def.sample?.params?.[k]??"","data-start-input":k}))),status,
      h("div",{class:"actions"},h("button",{class:"btn",type:"button",onclick:()=>close(null)},T("Cancel","取消")),h("button",{class:"btn primary",type:"button","data-start-inputs-ok":"",onclick:()=>{if(!brief.value.trim()){status.textContent=T("Describe the task requirements first.","請先描述任務需求。");brief.focus();return;}const params={};for(const[k,el]of Object.entries(fields)){if(!el.value.trim()){el.focus();return;}params[k]=el.value.trim();}onText(brief.value);close({text:brief.value.trim(),params});}},T("Continue","繼續"))));
    dlg.addEventListener("cancel",e=>{e.preventDefault();close(null);});document.body.append(dlg);dlg.showModal();brief.focus();});}
const skillName=ref=>{const x=(DRAFT_OPTS.value?.skills||[]).find(s=>s.ref===ref);return x?T(x.en,x.zh):String(ref).replace(/^.*\//,"").replace(/\.md$/,"");};
function firstWorkflow(arg){
  // local tutorial state is scoped to the server's data folder: a fresh folder never shows a stale draft or starter
  const SCOPE_KEY="crew.firstWorkflow.scope",keyOf=sc=>"crew.firstWorkflow.draft.v1:"+sc;
  const load=sc=>{try{const v=JSON.parse(store.get(keyOf(sc))||"{}");return v&&typeof v==="object"?v:{};}catch{return {};}};
  let scope=store.get(SCOPE_KEY)||"",draft=load(scope||"pending"); // "pending": typed before the first answer names the folder
  const save=()=>store.set(keyOf(scope||"pending"),JSON.stringify(draft));
  const goal=h("textarea",{class:"input",rows:3,"data-first-workflow-goal":"",placeholder:T("What should your workflow help you do?","你希望流程幫你完成什麼？")});goal.value=draft.goal||"";
  const status=h("p",{role:"status","data-first-workflow-status":""}),preview=h("section",{class:"card x-pad fw-preview","data-first-workflow-preview":"",hidden:true});
  const remember=()=>{draft.goal=goal.value;save();};goal.addEventListener("input",remember);
  let model=null,showStarter=false,openNode=null,seen="";
  const graph=(def,onNode)=>{const byId=Object.fromEntries(def.nodes.map(n=>[n.id,n]));const ins=new Set(def.edges.map(e=>e.to));const order=[];const q=def.nodes.filter(n=>!ins.has(n.id)).map(n=>n.id);const seenN=new Set();while(q.length){const id=q.shift();if(seenN.has(id))continue;seenN.add(id);order.push(id);for(const e of def.edges)if(e.from===id)q.push(e.to);}for(const n of def.nodes)if(!seenN.has(n.id))order.push(n.id);
    return h("div",{class:"fw-graph"},h("ol",{class:"fw-nodes"},order.map(id=>{const n=byId[id],role=def.roles.find(r=>r.id===n.role);return h("li",{},h("button",{type:"button",class:`fw-node k-${n.kind}${openNode===n.id?" open":""}`,"data-draft-node":n.id,"aria-expanded":n.kind==="agent"?String(openNode===n.id):null,onclick:()=>onNode?.(n)},h("b",{},n.label),h("span",{class:"faint"},n.kind==="agent"?[role?.label||n.role,n.provider?`${n.provider}${n.model?" · "+n.model:""}${n.effort?" · "+n.effort:""}`:T("not staffed yet","尚未配置")].filter(Boolean).join(" · "):n.kind==="card"?T("your decision","你的決定"):T("end","結束")),n.kind==="agent"&&n.skill&&n.skill!==role?.skill?h("span",{class:"fw-skill","data-node-skill":n.skill},T(`skill: ${skillName(n.skill)}`,`技能：${skillName(n.skill)}`)):null));})),
      h("ul",{class:"fw-edges faint"},def.edges.map(e=>h("li",{},`${byId[e.from]?.label||e.from} → ${byId[e.to]?.label||e.to}${e.when?` (${e.when})`:""}`))));};
  const gateBox=h("div",{"data-draft-gate":""});let gateFor="";
  const loadDraftGate=async()=>{if(!model)return;const id=model.id;try{const v=await api(`/api/wf/drafts/${id}/gate`);if(model?.id!==id)return;gateBox.replaceChildren(h("h3",{},T("Readiness gate","就緒檢查")),gatePanel(v));}catch{}};
  const onDraftGate=d=>{if(!root.isConnected){GATE_LIVE.delete(onDraftGate);return;}if(model&&(!d?.key||d.key===`draft-${model.id}`))loadDraftGate();};GATE_LIVE.add(onDraftGate);
  const draw=()=>{
    if(model&&!showStarter){advanced.open=true;const d=model,def=d.def;if(gateFor!==`${d.id}@${d.revision}`){gateFor=`${d.id}@${d.revision}`;void loadDraftGate();}preview.hidden=false;preview.dataset.firstWorkflowSource="model";
      const roleOf=n=>def.roles.find(r=>r.id===n.role)?.skill;
      const onNode=n=>{openNode=n.kind==="agent"&&openNode!==n.id?n.id:null;draw();};
      const openN=openNode&&def.nodes.find(n=>n.id===openNode&&n.kind==="agent");
      preview.replaceChildren(...[
        h("div",{class:"fw-head"},h("span",{class:"badge fw-badge model","data-first-workflow-badge":"model","data-edited":d.provenance.edited?"1":"0"},d.provenance.edited?T("Generated by Firstmate · AI model · edited by you","由 Firstmate 生成 · AI 模型 · 你已修改"):T("Generated by Firstmate · AI model","由 Firstmate 生成 · AI 模型")),h("span",{class:"faint"},T(`revision ${d.revision} · free draft, nothing runs`,`第 ${d.revision} 版 · 免費草稿，不會執行`))),
        h("h2",{},def.name),h("p",{class:"faint"},d.goal),
        d.interview?.length?h("details",{},h("summary",{},T(`Interview (${d.interview.length} answers)`,`訪談（${d.interview.length} 則回答）`)),h("dl",{class:"fw-interview"},d.interview.flatMap(q=>[h("dt",{},q.question),h("dd",{},q.answer)]))):null,
        h("p",{class:"faint"},T("Click an agent node to choose its provider, model, effort and skill.","點代理節點可選擇供應商、模型、推理強度與技能。")),
        graph(def,onNode),
        gateBox,
        openN?nodeModelControls(openN,roleOf(openN),{attr:"data-node-config",onSave:async body=>{const r=await api(`/api/wf/drafts/${d.id}/nodes/${openN.id}`,{revision:d.revision,...body});model=r.draft;seen=`${model.id}@${model.revision}`;const keep=openNode;draw();openNode=keep;const st=preview.querySelector("[data-node-config-status]");if(st)st.textContent=T(`Saved · revision ${model.revision}`,`已儲存 · 第 ${model.revision} 版`);return model;}}):null,
        h("details",{"data-graph-json":""},h("summary",{},T("Graph JSON (what Firstmate generated)","流程圖 JSON（Firstmate 生成的內容）")),h("pre",{class:"fw-json","data-first-workflow-json":""},JSON.stringify({name:def.name,roles:def.roles,nodes:def.nodes.map(({x,y,...n})=>n),edges:def.edges},null,2))),
        d.saved?h("a",{class:"btn primary",href:`#/workflows/${d.saved.workflow}`,"data-first-workflow-open-saved":""},T("Open the saved workflow","打開已儲存的流程")):
        h("button",{class:"btn primary","data-first-workflow-save-draft":"",onclick:async e=>{e.target.disabled=true;try{const r=await api(`/api/wf/drafts/${d.id}/save`,{revision:d.revision});WF.list=null;WF.listGeneration++;location.hash=r.href;}catch(err){status.textContent=err.status===409?T("Firstmate changed this draft after you looked. The newest revision is shown now; review it, then save again.","Firstmate 在你查看後更新了草稿。已顯示最新版本，請確認後再儲存。"):err.message;e.target.disabled=false;if(err.status===409){seen="";refresh();}}}},T("Save as my workflow (no Task)","儲存為我的流程（不建立任務）"))].filter(Boolean));
      return;}
    if(!showStarter){preview.hidden=true;return;}
    preview.hidden=false;preview.dataset.firstWorkflowSource="starter";
    preview.replaceChildren(h("div",{class:"fw-head"},h("span",{class:"badge fw-badge starter","data-first-workflow-badge":"starter"},T("Free starter · not AI generated","免費起始範本 · 並非 AI 生成"))),h("h2",{},T("Free starter preview · not AI generated","免費起始範本預覽 · 並非 AI 生成")),h("p",{},draft.goal),h("p",{},T("Captain confirmation → Done","船長確認 → 完成")),h("pre",{class:"fw-json"},JSON.stringify({nodes:[{id:"start",kind:"card"},{id:"done",kind:"hook"}],edges:[{from:"start",to:"done",when:"continue"}]},null,2)),create);
  };
  const refresh=async()=>{if(!root.isConnected&&seen)return;try{const j=await api("/api/wf/drafts");if(!j.scope)throw new Error("Missing workspace scope");if(j.scope!==scope){const first=!scope;scope=j.scope;store.set(SCOPE_KEY,scope);draft=first?{...load(scope),...load("pending"),...draft}:load(scope);if(first)try{localStorage.removeItem(keyOf("pending"));}catch{}if(!first){goal.value=draft.goal||"";model=null;seen="";showStarter=false;openNode=null;draw();}save();}if(root.dataset.ready!=="1")root.dataset.ready="1";const want=arg||draft.draftId;let d=null;if(want){try{d=(await api(`/api/wf/drafts/${want}`)).draft;}catch{}}const list=j.drafts||[];const newest=list.find(x=>!x.saved&&(!draft.askedAt||x.updatedAt>=draft.askedAt));if(!arg&&newest&&(!d||d.saved||newest.updatedAt>d.updatedAt))d=(await api(`/api/wf/drafts/${newest.id}`)).draft;if(!d)return;const sig=`${d.id}@${d.revision}`;if(sig===seen)return;seen=sig;model=d;showStarter=false;if(!arg){draft.draftId=d.id;save();}draw();}catch{}};
  let pending=false;const create=h("button",{class:"btn","data-first-workflow-create":"",onclick:async()=>{if(pending)return;remember();if(!draft.goal?.trim()){status.textContent=T("Describe your goal first.","請先寫下目標。");return;}if(draft.workflow){location.hash="#/workflows/"+draft.workflow;return;}if(draft.uncertain){status.textContent=T("Creation is uncertain. Check Workflows for the saved ID before retrying: ","建立結果尚未確認。請先到流程列表查找代號，避免重複建立：")+draft.id;return;}draft.id||="my-workflow-"+crypto.randomUUID().slice(0,8);draft.uncertain=true;save();pending=true;create.disabled=true;try{const result=await api("/api/wf",{id:draft.id,name:draft.goal.trim().slice(0,120),locale:window.crewI18n.modelLang(lang),origin:"starter"});draft.workflow=result.def.id;draft.uncertain=false;save();WF.list=null;WF.listGeneration++;location.hash="#/workflows/"+draft.workflow;}catch(e){status.textContent=T("Could not confirm creation. Inspect Workflows for ","無法確認建立結果，請到流程列表查看 ")+draft.id;}finally{pending=false;create.disabled=false;}}},T("Save starter and edit nodes","儲存起始範本並編輯節點"));
  const ask=(ensure=false)=>{remember();draft.askedAt=new Date(Date.now()-5000).toISOString();save();chatMode="main";store.set("crew.chatMode","main");openChat(true);const input=document.querySelector("#chatIn");if(input){if(!input.value||ensure===true){const message=T("Help me design my own workflow. Interview me briefly (two or three short questions, one at a time: who does the work, who reviews it, when I decide), then draft the graph so this page previews it. This is free drafting: nothing runs and no Task starts. My goal: ","請幫我設計我自己的流程。先簡短訪談我（兩三個問題，一次一題：誰做、誰審、我何時決定），再起草流程圖讓這個頁面預覽。這是免費起草：不會執行，也不會開始任何任務。我的目標：")+draft.goal;if(input.value.trim()&&ensure===true){if(!input.value.includes(message))input.value+="\n\n"+message;}else input.value=message;}input.dispatchEvent(new Event("input",{bubbles:true}));input.focus();}};
  const root=h("div",{class:"page fw-page","data-first-workflow":""},h("h1",{},T("Your first workflow","建立你的第一個流程")),
    h("ol",{class:"fw-steps"},[[T("Interview","訪談"),T("free","免費")],[T("Generated graph and preview","生成流程图与预览"),T("no Task","不启动任务")],[T("Edit each node's model","設定節點模型"),T("free","免費")],[T("Confirm staffing at Run","執行時確認配置"),T("starts the Task","開始任務")],[T("Compare and refine","比较与修改"),T("compare versions and save edits","比较版本并保存修改")],[T("Save as template","保存为模板"),T("reuse from the workflow editor","在流程编辑器中保存并复用")]].map(([a,b])=>b?h("li",{},h("b",{},a),h("span",{class:"faint"},b)):h("li",{class:"fw-roadmap","data-roadmap":""},h("b",{},a),h("span",{class:"badge"},T("Roadmap · coming later","規劃中 · 尚未提供"))))),
    h("label",{class:"rt-field"},h("span",{},T("Your goal (saved in this browser)","你的目標（儲存在此瀏覽器）")),goal),
    h("div",{class:"actions"},h("button",{class:"btn primary","data-first-workflow-chat":"",onclick:ask},T("Interview with Firstmate (you send it)","和 Firstmate 訪談（由你送出）")),h("button",{class:"btn","data-first-workflow-preview-button":"",onclick:()=>{remember();showStarter=true;draw();}},T("Preview free starter instead","改用免費起始範本"))),
    preview,status,
    h("p",{class:"faint"},T("Drafting, previewing, editing nodes and saving are free: no Task, no staffing. Firstmate's graph is labeled as AI model output; the starter is labeled as not AI generated. Staffing is confirmed only when you click Run. The coffee shop is the advanced example.","起草、預覽、設定節點與儲存都免費：不建立任務、不派工。Firstmate 的流程圖標示為 AI 模型產出；起始範本標示為非 AI 生成。只有按下執行時才確認人員配置。咖啡店是進階範例。")),
    h("div",{class:"actions"},h("a",{class:"btn",href:"#/workflows"},T("Saved workflows","已儲存的流程")),h("a",{class:"btn ghost",href:"#/workflows/coffee-kit"},T("Advanced example: coffee shop","進階範例：咖啡店"))));
  const advanced=h("details",{class:"card x-pad","data-custom-workflow":""},h("summary",{},T("Design a custom workflow with Firstmate","進階：和 Firstmate 設計自己的流程")));
  while(root.children.length>1)advanced.append(root.children[1]);
  const helloStatus=h("p",{role:"status","data-hello-status":""});let helloBusy=false;
  const helloButton=h("button",{class:"btn primary","data-hello-create":"",onclick:async()=>{if(helloBusy)return;helloBusy=true;helloButton.disabled=true;try{
    delete root.dataset.ready;await refresh();if(root.dataset.ready!=="1")throw new Error("Could not verify current workspace; try again.");
    if(draft.helloRun){location.hash="#/run/"+draft.helloRun;return;}
    draft.helloId||="hello-crew-"+crypto.randomUUID().slice(0,8);save();
    let found;try{found=await api("/api/wf/"+draft.helloId);}catch(e){if(e.status!==404)throw e;}
    if(!found)await api("/api/wf",{id:draft.helloId,name:"Hello Crew Studio",locale:window.crewI18n.modelLang(lang),template:"hello-crew-studio",origin:"starter"});
    const current=await api("/api/wf/"+draft.helloId);const prior=current.runs?.find(r=>r.workflow===draft.helloId)||current.runs?.[0];
    if(prior){draft.helloRun=prior.id;save();location.hash="#/run/"+prior.id;return;}
    const result=await api("/api/wruns",{workflow:draft.helloId,text:T("Create my first Hello Crew Studio website","建立我的第一個 Hello Crew Studio 網頁"),params:{heading:"Hello Crew Studio"}});draft.helloRun=result.id;save();WF.list=null;WF.listGeneration++;location.hash="#/run/"+result.id;
  }catch(e){helloStatus.textContent=T("Could not confirm creation: ","尚未確認建立結果：")+e.message;}finally{helloBusy=false;helloButton.disabled=false;}}},T("Create my first website","建立我的第一個網頁"));
  const helloInterview=h("button",{class:"btn primary","data-hello-interview":"",onclick:async()=>{
    delete root.dataset.ready;await refresh();if(root.dataset.ready!=="1"){helloStatus.textContent=T("Waiting for workspace; try again.","正在确认工作区，请重试。");return;}
    goal.value=T("Create a simple Hello Crew Studio website workflow. Before drafting, discuss the website's audience, heading and visual style with me, one short question at a time. Show a workflow draft with creation, review and my approval. Do not create a website or start a Task until I confirm.","建立一个简单的 Hello Crew Studio 网页开发流程。先和我讨论网站用途、标题和视觉风格，一次问一个简短问题。再展示包含制作、审查和我核准的流程草稿。等我确认后才制作网页、启动任务。");
    advanced.open=true;ask(true);helloStatus.textContent=T("The discussion is ready in Firstmate. Send it to begin; no Task has started.","讨论内容已放入 Firstmate，发送后开始访谈；尚未启动任务。");
  }},T("Discuss my first workflow","讨论我的第一个流程"));
  helloButton.textContent=T("Try the ready-made website example","直接试用现成网页示例");
  root.append(h("section",{class:"card x-pad","data-hello-starter":""},h("h2",{},"Hello Crew Studio"),h("p",{},T("Discuss your website with Firstmate, review the workflow together, then decide when it runs.","先和 Firstmate 讨论网页需求，一起确认流程，再决定何时执行。")),h("ol",{class:"fw-steps"},[T("Discuss your goal","讨论需求"),T("Review the workflow draft","确认流程草稿"),T("Confirm and run","确认后执行")].map(t=>h("li",{},t))),helloInterview,helloStatus,h("details",{"data-hello-quick":""},h("summary",{},T("Skip discussion: try a ready-made example","跳过讨论：试用现成示例")),h("p",{},T("Uses a built-in template, without an AI model. Starts a Task immediately.","使用内建模板，不调用 AI 模型；点击后立即启动任务。")),helloButton)),advanced);

  DRAFT_LIVE.fn=refresh;draftOpts().catch(()=>{});refresh();const timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);if(DRAFT_LIVE.fn===refresh)DRAFT_LIVE.fn=null;return;}refresh();},2000);
  return root;
}
routes["first-workflow"]=firstWorkflow;
Object.assign(routes, { workflows: viewWorkflows, runs: viewRuns, run: viewRun });
})();
