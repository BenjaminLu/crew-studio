// The tidy workflow graph, computed geometrically on every built-in workflow:
// no node overlaps, no edge through a node, crossings under a measured
// threshold, back edges as arcs outside the node band, no label overlaps, and
// stage boxes that hold exactly their nodes.      bun tests/graph-tidy.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bundledText, parseYaml } from "../src/bundled";
import { normalize } from "../src/runtime/defs";

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const here = import.meta.dir;
await import("../public/graph-layout.js").catch((e) => { console.log(`  FAIL  public/graph-layout.js loads: ${e?.message ?? e}`); fail++; });
const L: any = (globalThis as any).crewLayout;
if (!L) { console.log(`\ngraph-tidy: ${pass} passed, ${fail} failed`); process.exit(1); }

// every built-in workflow: the bundled definitions, and the pack workflows a live Studio holds (exported fixtures)
const defs: any[] = [
  normalize(parseYaml(bundledText("packs/firstmate/workflows/code-firstmate.wf.yaml")!)),
  normalize(parseYaml(bundledText("packs/core/workflows/refine-demo.wf.yaml")!)),
  normalize(parseYaml(bundledText("workflows/v2/pack-genesis.wf.yaml")!)),
  normalize(parseYaml(bundledText("workflows/v2/coffee-kit.wf.yaml")!)),
  ...readdirSync(join(here, "fixture/workflows")).sort().map((f) => JSON.parse(readFileSync(join(here, "fixture/workflows", f), "utf8"))),
];
const expectedIds=["code-firstmate","coffee-kit","documents","file-organization","pack-genesis","refine-demo","trivial-lane","video","web-prototype"];
ok(JSON.stringify(defs.map(d=>d.id).sort())===JSON.stringify(expectedIds) && defs.every((d) => d.nodes.length && d.edges.length), "exact nine built-in workflows to lay out including native coffee-kit", defs.map((d) => d.id).join(","));

// crossings measured on the new layout (and, for comparison, on the hand-placed one)
const THRESHOLD: Record<string, number> = { "code-firstmate": 17, "refine-demo": 0, "pack-genesis": 3, "coffee-kit": 4, documents: 0, "file-organization": 0, "trivial-lane": 0, video: 0, "web-prototype": 0 };

const inside = (p: [number, number], r: any, m = 2) => p[0] > r.x + m && p[0] < r.x + r.w - m && p[1] > r.y + m && p[1] < r.y + r.h - m;
const overlap = (a: any, b: any, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

for (const def of defs) {
  const stageIds = (L.stagesFor(def) || []).map((s: any) => s.id);
  for (const [tag, collapsed] of [["expanded", []], ["collapsed", stageIds]] as [string, string[]][]) {
    if (tag === "collapsed" && !stageIds.length) continue;
    const g = L.layout(def, { collapsed });
    const id = `${def.id} (${tag})`;
    const rects = g.nodes;
    let olap: string[] = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (overlap(rects[i], rects[j], 8)) olap.push(`${rects[i].id}/${rects[j].id}`);
    ok(!olap.length, `no node overlaps a node: ${id}`, olap.join(" "));
    const through: string[] = [];
    for (const e of g.edges) for (const p of L.sample(e, 6)) for (const r of rects) if (inside(p, r)) { through.push(`${e.from}→${e.to} in ${r.id}`); break; }
    ok(!through.length, `no edge passes through a node: ${id}`, [...new Set(through)].slice(0, 6).join("; "));
    if (tag === "expanded") {
      const c = L.crossings(g), hand = L.crossings(L.manual(def));
      ok(c <= THRESHOLD[def.id] && (hand === 0 || c <= hand / 2), `edge crossings ≤ threshold, and at most half the hand layout's: ${id}`, `crossings ${c} (threshold ${THRESHOLD[def.id]}, hand layout ${hand})`);
      console.log(`        crossings ${def.id}: tidy ${c}, hand ${hand}`);
    }
    const backs = g.edges.filter((e: any) => e.back);
    // an arc runs above (or below) every node and stage box under its span, dashed, its label on it
    const solids = [...rects, ...g.stages];
    const badArc = backs.filter((e: any) => { const xs = [e.segs[2].a[0], e.segs[2].b[0]]; const lo = Math.min(...xs), hi = Math.max(...xs);
      const under = solids.filter((r: any) => r.x < hi && lo < r.x + r.w);
      const clear = e.side === "above" ? under.every((r: any) => e.arcY < r.y) : under.every((r: any) => e.arcY > r.y + r.h);
      return !(e.dashed && typeof e.arcY === "number" && clear && (!e.label || Math.abs(e.label.y + e.label.h / 2 - e.arcY) < 14)); });
    ok(!badArc.length, `back edges are arcs above or below every node: ${id}`, badArc.map((e: any) => `${e.from}→${e.to} arcY=${e.arcY}`).join(" "));
    const labels = g.edges.filter((e: any) => e.label).map((e: any) => ({ ...e.label, id: `${e.from}→${e.to}` }));
    const lo: string[] = [];
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (overlap(labels[i], labels[j])) lo.push(`${labels[i].text}@${labels[i].id} / ${labels[j].text}@${labels[j].id}`);
    for (const l of labels) for (const r of rects) if (overlap(l, r)) lo.push(`${l.text}@${l.id} on node ${r.id}`);
    ok(!lo.length, `no edge labels overlap: ${id}`, lo.slice(0, 5).join("; "));
    if (def.id === "code-firstmate" && tag === "expanded") {
      const st = g.stages;
      ok(JSON.stringify(st.find((s: any) => s.id === "build")?.nodes) === JSON.stringify(["build", "pr-open", "ci", "review", "remote-ready", "fix"]), "review publication belongs to the named Build loop stage before CI and review");
      const wrong: string[] = [];
      for (const s of st) for (const r of rects) { const member = (s.nodes || []).includes(r.id); const inBox = overlap(s, r); if (member && !(r.x >= s.x && r.y >= s.y && r.x + r.w <= s.x + s.w && r.y + r.h <= s.y + s.h)) wrong.push(`${r.id} outside ${s.id}`); if (!member && inBox) wrong.push(`${r.id} inside ${s.id}`); }
      ok(st.length === 7 && !wrong.length, "every code-firstmate node of a named stage is inside its box, and no other node is", `${st.map((s: any) => s.id).join(",")} ${wrong.join("; ")}`);
      const so: string[] = []; for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) if (overlap(st[i], st[j])) so.push(`${st[i].id}/${st[j].id}`);
      ok(!so.length, "stage boxes do not overlap", so.join(" "));
    }
  }
}
const section = async (name: string, f: () => Promise<void> | void) => { try { await f(); } catch (e: any) { fail++; console.log(`  FAIL  ${name}: ${String(e?.message ?? e).split("\n")[0]}`); } };
// ---------- the simple view (graph-simple-view): the main path, loops and escalations as badges ----------
await section("the simple view lays every built-in workflow out", () => { for (const def of defs) for (const wrap of [6, 2]) {
  const g = L.layoutSimple(def, { wrap });
  const id = `${def.id} (simple, wrap ${wrap})`;
  const rects = g.nodes; const olap: string[] = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (overlap(rects[i], rects[j], 8)) olap.push(`${rects[i].id}/${rects[j].id}`);
  ok(!olap.length, `no node overlaps a node: ${id}`, olap.join(" "));
  const through: string[] = []; for (const e of g.edges) for (const p of L.sample(e, 6)) for (const r of rects) if (inside(p, r)) { through.push(`${e.from}→${e.to} in ${r.id}`); break; }
  ok(!through.length, `no edge passes through a node: ${id}`, [...new Set(through)].slice(0, 6).join("; "));
  ok(g.edges.every((e: any) => !e.back) && g.edges.every((e: any) => !g.hidden.includes(e.from) && !g.hidden.includes(e.to)), `no back edges and no escalation edges in simple view: ${id}`);
  const labels = g.edges.filter((e: any) => e.label).map((e: any, k: number) => ({ ...e.label, k, id: `${e.from}→${e.to}` })); const lo: string[] = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (overlap(labels[i], labels[j])) lo.push(`${labels[i].id}/${labels[j].id}`);
  for (const l of labels) { for (const r of [...rects, ...g.stages.map((b: any) => ({ x: b.x, y: b.y, w: Math.min(b.w, b.label.length * 7 + 24), h: 26, id: `title ${b.id}` }))]) if (overlap(l, r)) lo.push(`${l.id} on ${r.id}`);
    for (const e of g.edges) if (`${e.from}→${e.to}` !== l.id && L.sample(e, 10).some((q: number[]) => q[0] > l.x && q[0] < l.x + l.w && q[1] > l.y && q[1] < l.y + l.h)) lo.push(`${l.id} on edge ${e.from}→${e.to}`); }
  ok(!lo.length, `edge labels sit on no node, stage title, other label or other edge: ${id}`, lo.slice(0, 4).join("; "));
} });
await section("the simple view of code-firstmate", () => {
  const cf = defs[0]; const g = L.layoutSimple(cf, { wrap: 6 }); const ids = g.nodes.map((n: any) => n.id);
  const main = ["intake", "prepare", "spec", "dispatch", "door", "plan", "plan-accept", "build", "pr-open", "ci", "review", "remote-ready", "merge-card", "merge", "after-merge", "cleanup", "done"];
  ok(ids.length === 17 && main.every((x) => ids.includes(x)), "the simple view of code-firstmate holds only the main path through the stages (17 nodes)", ids.join(","));
  ok(["spec-fix", "plan-fix", "fix", "door-pick", "step-back", "stalled", "budget", "scope-card", "parked", "closed", "dropped"].every((x) => g.hidden.includes(x)), "loop, door-question and escalation nodes are hidden in simple view", g.hidden.join(","));
  const b = g.badges, txt = (k: string, kind: string) => (b[k] || []).find((x: any) => x.kind === kind);
  ok(txt("node:spec", "loop")?.text === "↻ refine" && txt("node:spec", "loop")?.cap === 3 && txt("node:build", "loop")?.text === "↻ fix" && txt("node:plan", "loop")?.text === "↻ refine", "loops become ↻ badges with their round cap");
  ok(txt("node:door", "ask")?.text === "asks you if unsure", "Pick the door folds into the Door node's badge");
  ok(txt("stage:build", "escalations")?.nodes.length === 6 && txt("stage:intake", "escalations")?.nodes.length === 3 && txt("stage:plan", "escalations")?.nodes.length === 2 && txt("stage:gates", "escalations")?.nodes.length === 1,
    "escalations become one badge per stage they leave from", JSON.stringify(Object.fromEntries(Object.entries(b).map(([k, v]: any) => [k, v.map((x: any) => x.text)]))));
  const door = g.edges.filter((e: any) => e.from === "door").map((e: any) => `${e.to}:${e.when}`).sort();
  ok(JSON.stringify(door) === '["build:two-way","plan:one-way"]' && g.edges.some((e: any) => e.from === "plan-accept" && e.to === "build"), "the door forks in two (one-way → Plan, two-way → Build) and rejoins at Build", JSON.stringify(door));
});
// ---------- a back edge never covers a forward edge's middle (where a captain drops a check; the hit band is 12 px) ----------
// every built-in workflow in each view the editor draws (auto expanded and collapsed, placed, simple), plus the definition
// review-modes r1 shipped (its step-back edges covered build → ci in the editor). A back edge leaving the same node as the
// forward edge is exempt: both leave through that node's side.
{ const near = (m: number[], a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; const u = l ? Math.max(0, Math.min(1, ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / l)) : 0; return Math.hypot(m[0] - a[0] - u * dx, m[1] - a[1] - u * dy) < 7; };
  const midOf = (e: any) => { const ps = L.sample(e, 24); let len = 0; const acc = [0]; for (let i = 1; i < ps.length; i++) acc.push(len += Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1])); return ps[Math.max(0, acc.findIndex((v: number) => v >= len / 2))]; };
  const r1 = { ...defs[0], id: "code-firstmate@review-modes-r1", edges: [...defs[0].edges.filter((e: any) => !(e.from === "step-back" && e.to === "fix")), { from: "review", to: "step-back", when: "error" }, { from: "step-back", to: "review", when: "other-model" }] };
  for (const def of [...defs, r1]) { const stageIds = (L.stagesFor(def) || []).map((st: any) => st.id);
    const views: [string, any][] = [["auto", L.layout(def, { collapsed: [] })], ["collapsed", L.layout(def, { collapsed: stageIds })], ["placed", L.place(def, { collapsed: [] })], ["simple", L.layoutSimple(def, { collapsed: [] })]];
    for (const [view, g] of views) { const bad: string[] = [];
      for (const f of g.edges.filter((e: any) => !e.back)) { const m = midOf(f);
        for (const b of g.edges.filter((e: any) => e.back && e.from !== f.from)) { const ps = L.sample(b, 8); if (ps.some((p: number[], i: number) => i > 0 && near(m, ps[i - 1], p))) bad.push(`${b.from}→${b.to} over ${f.from}→${f.to}`); } }
      ok(!bad.length, `no back edge covers a forward edge's middle: ${def.id} (${view})`, bad.join("; ")); } } }

// ---------- a node that names its own stage ----------
{
  const own = { id: "own-stages", nodes: [{ id: "a", kind: "hook", label: "A", stage: "Prepare" }, { id: "b", kind: "agent", label: "B", stage: "Prepare" }, { id: "c", kind: "check", label: "C", stage: "Check" }, { id: "d", kind: "hook", label: "D" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "c", to: "b", when: "fail" }] };
  const st = L.stagesFor(own); const g = L.layout(own, {});
  const box = (x: string) => g.stages.find((s: any) => s.id === x); const r = (x: string) => g.nodes.find((n: any) => n.id === x);
  const within = (n: any, b: any) => n.x >= b.x && n.y >= b.y && n.x + n.w <= b.x + b.w && n.y + n.h <= b.y + b.h;
  ok(JSON.stringify(st.map((x: any) => [x.id, x.nodes])) === '[["Prepare",["a","b"]],["Check",["c"]]]' && within(r("a"), box("Prepare")) && within(r("b"), box("Prepare")) && within(r("c"), box("Check")) && !overlap(r("d"), box("Check")),
    "a node that names its own stage is boxed in it", JSON.stringify(st));
  const c = L.layout(own, { collapsed: ["Prepare"] });
  ok(c.nodes.some((n: any) => n.id === "stage:Prepare" && n.members.length === 2) && !c.nodes.some((n: any) => n.id === "a"), "its stage collapses like a built-in one");
}
// ---------- the layout mode of a version dragged before this change ----------
await section("layout modes", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs"); const { tmpdir } = await import("node:os");
  const { createGraphMode } = await import("../src/graphmode");
  const dir = mkdtempSync(join(tmpdir(), "crew-gmode-")); mkdirSync(join(dir, "workflows", "video"), { recursive: true });
  writeFileSync(join(dir, "workflows", "video", "layout-v1.json"), JSON.stringify({ make: { x: 300, y: 40 } }));
  const gm = createGraphMode(dir);
  const call = async (path: string, body?: unknown) => { const u = new URL(`http://x${path}`); const r = await gm.handle(new Request(u, body ? { method: "POST", body: JSON.stringify(body) } : {}), u, !!body); return r ? r.json() : null; };
  ok((await call("/api/graph-layout/video/v1"))?.mode === "manual" && (await call("/api/graph-layout/video/v2"))?.mode === "auto", "a version with a layout saved before this change opens in manual mode (no saved layout: auto)");
  await call("/api/graph-layout/video/v1", { mode: "auto" });
  ok((await call("/api/graph-layout/video/v1"))?.mode === "auto", "Tidy layout's explicit auto wins over the old saved layout");
});
// the file itself: each section once (a fail-first branch must not carry a second copy that reads names declared later)
{ const src = readFileSync(join(here, "graph-tidy.ts"), "utf8"); const needle = "await sec" + "tion(\"the simple view lays every built-in workflow out\"";
  ok(src.split(needle).length - 1 === 1 && /^if \(!L\) \{ console\.log\(/m.test(src), "tests/graph-tidy.ts holds each section once, and its no-module branch only reports and exits"); }
console.log(`\ngraph-tidy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
