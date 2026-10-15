// Voyage: ships for tasks, sailors for crew, flags for waiting cards.
const NS = "http://www.w3.org/2000/svg";
const el = (t, a = {}, ...k) => { const e = document.createElementNS(NS, t); for (const [x, v] of Object.entries(a)) e.setAttribute(x, v); for (const c of k) e.append(c); return e; };
const txt = (s, a) => { const t = el("text", a); t.textContent = s; return t; };
const sea = document.getElementById("sea");
const lines = [];
function sailor(x, y, robot, name) {
  const g = el("g", { transform: `translate(${x} ${y})` });
  if (robot) g.append(el("rect", { x: -6, y: -22, width: 12, height: 11, rx: 2, fill: "#9fb4c8" }), el("rect", { x: -7, y: -11, width: 14, height: 12, rx: 2, fill: "#7d93a8" }), el("circle", { cx: -2.5, cy: -17, r: 1.4, fill: "#2de0ff" }), el("circle", { cx: 2.5, cy: -17, r: 1.4, fill: "#2de0ff" }), el("line", { x1: 0, y1: -22, x2: 0, y2: -27, stroke: "#7d93a8" }));
  else g.append(el("circle", { cx: 0, cy: -17, r: 5, fill: "#f1c9a5" }), el("path", { d: "M-6 -1 Q0 -16 6 -1 Z", fill: "#1f4e79" }), el("path", { d: "M-5 -21 Q0 -26 5 -21 Z", fill: "#fff" }));
  const t = el("title"); t.textContent = name; g.append(t);
  return g;
}
function draw(s) {
  document.documentElement.classList.toggle("night", s.theme === "dark");
  const nodes = (s.flow?.nodes ?? []).filter((n) => !n.lane);
  const ids = nodes.map((n) => n.id);
  const W = 1200, left = 60, right = 1140, y0 = 300;
  const xOf = (id) => { const i = Math.max(0, ids.indexOf(id)); return left + (i * (right - left)) / Math.max(1, ids.length - 1); };
  sea.replaceChildren();
  sea.append(el("rect", { x: -3000, y: 250, width: 7200, height: 3000, fill: "var(--sea1)" }), el("rect", { x: -3000, y: 430, width: 7200, height: 3000, fill: "var(--sea2)" }));
  const waves = el("g", { class: "wave" }); for (let i = -20; i < 42; i++) waves.append(el("path", { d: `M${i * 120} 270 q30 -10 60 0 t60 0`, stroke: "#ffffff55", fill: "none", "stroke-width": 2 })); sea.append(waves);
  sea.append(el("path", { d: `M${left} ${y0 + 40} L${right} ${y0 + 40}`, stroke: "#ffffff66", "stroke-dasharray": "6 10", "stroke-width": 2 }));
  nodes.forEach((n) => { const x = xOf(n.id); sea.append(el("g", { class: "buoy" }, el("circle", { cx: x, cy: y0 + 40, r: 7, fill: n.kind === "human" ? "#f2b631" : n.kind === "gate" ? "#e2483d" : "#fff" }), txt(n.label, { x, y: y0 + 70, "text-anchor": "middle" }))); });
  // the harbour: firstmate on the pier
  const pier = el("g", {}, el("rect", { x: 10, y: 200, width: 70, height: 60, fill: "#8a6a4a" }), el("rect", { x: 30, y: 150, width: 30, height: 50, fill: "#c9b18a" }), txt("harbour", { x: 45, y: 145, "text-anchor": "middle", style: "font:11px system-ui;fill:var(--mute)" }));
  pier.append(sailor(55, 198, false, "firstmate")); sea.append(pier);
  const tasks = (s.tasks ?? []).filter((t) => t.status !== "done" && t.status !== "idle");
  const workers = (s.crew ?? []).filter((c) => c.role === "worker").map((c) => c.name);
  const lanes = {};
  tasks.slice(0, 14).forEach((t) => {
    const x = xOf(t.node), k = (lanes[t.node] = (lanes[t.node] ?? 0) + 1) - 1;
    const y = y0 - 125 + (k % 2) * 34, dx = k ? (k % 2 ? 46 : -46) * Math.ceil(k / 2) : 0;
    const g = el("g", { class: "ship", transform: `translate(${x - 50 + dx} ${y})` }); const b = el("g", { class: "bob", style: `animation-delay:${(k * 0.7) % 3}s` });
    b.append(el("path", { d: "M0 60 L100 60 L86 80 L12 80 Z", fill: "var(--hull)" }), el("line", { x1: 50, y1: 6, x2: 50, y2: 60, stroke: "#5b3a22", "stroke-width": 3 }),
      el("path", { d: "M52 10 L52 54 L88 54 Z", fill: "var(--sail)" }), el("path", { d: "M48 14 L48 54 L18 54 Z", fill: "var(--sail)", opacity: .9 }),
      el("path", { d: "M50 6 L66 10 L50 14 Z", fill: t.status === "failed" ? "#e2483d" : t.status === "needs-you" ? "#f2b631" : "#2f9e62" }));
    const aboard = (s.crew ?? []).filter((c) => c.task === t.id && c.alive);
    aboard.slice(0, 3).forEach((c, i) => b.append(sailor(24 + i * 22, 60, c.role === "worker" && workers.indexOf(c.name) === 3, `${c.name} (${c.role})`)));
    b.append(txt(t.id, { x: 50, y: 98, "text-anchor": "middle" }), txt(t.status, { x: 50, y: 113, "text-anchor": "middle", class: "st" }));
    const tt = el("title"); tt.textContent = `${t.id}: ${t.title}`; b.append(tt);
    g.append(b); sea.append(g);
  });
  const flags = document.getElementById("flags"); flags.replaceChildren();
  for (const c of (s.pending ?? []).slice(0, 12)) {
    const b = document.createElement("button"); b.className = `flag ${c.kind === "merge" ? "merge" : ""}`; b.textContent = c.task || c.id; b.title = `${c.title} — open this card`;
    b.onclick = () => CrewSkin.openCard(c.id); flags.append(b);
  }
  document.getElementById("sub").textContent = `${tasks.length} ships at sea · ${(s.crew ?? []).filter((c) => c.alive).length} hands on deck · ${(s.pending ?? []).length} flags flying`;
}
CrewSkin.onSnapshot(draw);
CrewSkin.onEvent((e) => { lines.push(`${e.ts.slice(11, 19)} ${e.task ?? ""} ${e.summary}`); document.getElementById("log").textContent = lines.slice(-1)[0]; });
CrewSkin.ready();
