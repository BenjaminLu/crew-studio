import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
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
// plus the two captain-made four-agent workflows kept as fixtures (6ad1e71): laid out and measured like the rest
const expectedIds=["code-firstmate","coffee-kit","crew-onboarding-collab","documents","file-organization","four-agent-proposals","pack-genesis","refine-demo","trivial-lane","video","web-prototype"];
ok(JSON.stringify(defs.map(d=>d.id).sort())===JSON.stringify(expectedIds) && defs.every((d) => d.nodes.length && d.edges.length), "exact nine built-in workflows plus the two retained four-agent fixtures to lay out, including native coffee-kit", defs.map((d) => d.id).join(","));

// crossings measured on the new layout (and, for comparison, on the hand-placed one)
// code-firstmate: 45 is the ceiling since the designer round (design-scope and designer in the Build loop, the capture gap and its card in Gates)
const THRESHOLD: Record<string, number> = { "code-firstmate": 45, "refine-demo": 0, "pack-genesis": 3, "coffee-kit": 4, "crew-onboarding-collab": 0, "four-agent-proposals": 0, documents: 0, "file-organization": 0, "trivial-lane": 0, video: 0, "web-prototype": 0 };

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
      ok(JSON.stringify(st.find((s: any) => s.id === "build")?.nodes) === JSON.stringify(["build", "pr-open", "ci", "review", "design-scope", "designer", "remote-ready", "fix"]), "review publication belongs to the named Build loop stage before CI and review");
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
  const main = ["intake", "prepare", "spec", "dispatch", "door", "plan", "plan-accept", "build", "pr-open", "ci", "review", "design-scope", "designer", "remote-ready", "merge-card", "merge", "after-merge", "cleanup", "done"];
  ok(ids.length === 19 && main.every((x) => ids.includes(x)), "the simple view of code-firstmate holds only the main path through the stages (19 nodes: the designer round is on it)", ids.join(","));
  ok(["spec-fix", "plan-fix", "fix", "door-pick", "step-back", "stalled", "budget", "scope-card", "parked", "closed", "dropped"].every((x) => g.hidden.includes(x)), "loop, door-question and escalation nodes are hidden in simple view", g.hidden.join(","));
  const b = g.badges, txt = (k: string, kind: string) => (b[k] || []).find((x: any) => x.kind === kind);
  ok(txt("node:spec", "loop")?.text === "↻ refine" && txt("node:spec", "loop")?.cap === 3 && txt("node:build", "loop")?.text === "↻ fix" && txt("node:plan", "loop")?.text === "↻ refine", "loops become ↻ badges with their round cap");
  ok(txt("node:door", "ask")?.text === "asks you if unsure", "Pick the door folds into the Door node's badge");
  ok(txt("stage:build", "escalations")?.nodes.length === 8 && txt("stage:intake", "escalations")?.nodes.length === 3 && txt("stage:plan", "escalations")?.nodes.length === 2 && txt("stage:gates", "escalations")?.nodes.length === 1,
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
  // pinned: the edge set concurrent Tasks shipped (3c783ae added merge → build "rebase"; no pr-open → closed), on r1. Its
  // rebase arc crowded the escalation cards' channel and budget → build's leg sat on step-back → parked's middle; a later
  // edge elsewhere hid that by chance, so this shape is kept as it was
  const pinned = { ...r1, id: "code-firstmate@concurrent-tasks-r1", edges: [...r1.edges.filter((e: any) => !(e.from === "pr-open" && e.to === "closed") && !(e.from === "merge" && e.to === "build")), { from: "merge", to: "build", when: "rebase" }] };
  ok(defs[0].edges.some((e: any) => e.from === "merge" && e.to === "build"), "code-firstmate still has the merge → build rebase edge the pinned shape keeps");
  for (const def of [...defs, r1, pinned]) { const stageIds = (L.stagesFor(def) || []).map((st: any) => st.id);
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
// Editable Overview represents the complete actual graph; run summaries stay projected.
{
  const compactDef=normalize(defs.find(d=>d.id==="code-firstmate")),compactBytes=JSON.stringify(compactDef),compact=L.layoutSimple(compactDef,{actualGraph:true,wrap:6});
  const compactCrossings=compact.edges.flatMap((e:any)=>compact.nodes.filter((n:any)=>L.sample(e,3).some((point:any)=>inside(point,n))).map((n:any)=>`${e.from}→${e.to} in ${n.id}`));
  ok(compactCrossings.length===0,"compact full editor bus arcs avoid every actual node at six-column wrap",compactCrossings.join("; "));
  const directions=new Set(compact.edges.filter((e:any)=>e.back).map((e:any)=>Math.sign(e.segs[2].b[0]-e.segs[2].a[0])));
  ok(directions.has(-1)&&directions.has(1),"compact routing regression covers buses in both horizontal directions");
  ok(JSON.stringify(compactDef)===compactBytes&&JSON.stringify(compact.edges.flatMap((e:any)=>e.index).sort((a:number,b:number)=>a-b))===JSON.stringify(compactDef.edges.map((_:any,i:number)=>i)),"bus routing preserves every original node, endpoint, condition/check object and edge identity");
  const def: any = {id:"delete-projection",nodes:["start","middle","tail","done"].map(id=>({id,kind:"hook",do:"note",label:"Repeated label"})),edges:[{from:"start",to:"middle"},{from:"middle",to:"tail"},{from:"tail",to:"done",when:"ok",checks:[{use:"fixture-check"}]}],roles:[]};
  for(const removed of ["start","middle","done"]){const after={...def,nodes:def.nodes.filter((n:any)=>n.id!==removed),edges:def.edges.filter((e:any)=>e.from!==removed&&e.to!==removed)};const rendered=L.layoutSimple(after,{actualGraph:true});
    ok(JSON.stringify(rendered.nodes.flatMap((n:any)=>n.members).sort())===JSON.stringify(after.nodes.map((n:any)=>n.id).sort()),`editor keeps exact surviving IDs after deleting ${removed}`);
    ok(rendered.edges.flatMap((e:any)=>e.index).every((index:number)=>after.edges[index]),`editor edges retain original identities after deleting ${removed}`);
  }
  const disconnected:any={...def,nodes:[{id:"start",kind:"hook",do:"note",label:"Entry"},{id:"cycle-a",kind:"hook",do:"note",label:"Same",stage:"repair"},{id:"cycle-b",kind:"hook",do:"note",label:"Same",stage:"repair"},{id:"refine",kind:"loop",label:"Refine",args:{producer:"cycle-a"}}],edges:[{from:"cycle-a",to:"cycle-b",when:"ok"},{from:"cycle-a",to:"cycle-b",when:"fail",checks:[{use:"fixture-check"}]},{from:"cycle-b",to:"cycle-a"},{from:"cycle-a",to:"refine"},{from:"refine",to:"cycle-a",when:"retry"}]};
  const missingEndpoint={...def,nodes:[{id:"start",kind:"hook",do:"note",label:"Start",x:0,y:0}],edges:[{},{from:"start"},{to:"start"},{from:"missing",to:"start"},{from:"ghost",to:"ghost"},["start","start"]]};
  ok(L.place(missingEndpoint,{actualGraph:true}).edges.length===0&&L.layout(missingEndpoint,{actualGraph:true}).edges.length===0,"missing edge IDs cannot be mistaken for a real self-edge");
  const validSelf={...missingEndpoint,edges:[{from:"start",to:"start",when:"retry",checks:[{use:"fixture-self-check",params:{strict:true}}]}]};
  const selfPayload=JSON.stringify(validSelf.edges);
  ok([L.layout,L.place,L.layoutSimple].every(fn=>{const g=fn(validSelf,{actualGraph:true});return JSON.stringify(g.edges.flatMap((e:any)=>e.index))==="[0]"&&g.edges[0].when==="retry"&&g.edges[0].checks===1&&JSON.stringify(validSelf.edges)===selfPayload;}),"every editable layout preserves the known self-edge index, condition and check payload");
  const normalLoop={...def,nodes:[{id:"start",kind:"hook",do:"note",label:"Start"},{id:"producer",kind:"agent",label:"Build"},{id:"refine",kind:"loop",label:"Refine",args:{producer:"producer"}},{id:"done",kind:"hook",do:"note",label:"Done"}],edges:[{from:"start",to:"producer"},{from:"producer",to:"refine"},{from:"refine",to:"producer",when:"retry"},{from:"refine",to:"done",when:"pass"}]};
  ok(JSON.stringify(L.layoutSimple(normalLoop,{actualGraph:true}).nodes.map((n:any)=>n.id).sort())===JSON.stringify(normalLoop.nodes.map(n=>n.id).sort()),"editable Overview shows the actual connected loop from the outset");
  const summary=L.layoutSimple(disconnected),editor=L.layoutSimple(disconnected,{actualGraph:true});
  ok(summary.nodes.length===1&&summary.nodes[0].id==="start", "run Overview preserves its existing entry-path summary");
  ok(JSON.stringify(editor.nodes.flatMap((n:any)=>n.members).sort())===JSON.stringify(disconnected.nodes.map((n:any)=>n.id).sort()),"editor retains all disconnected cyclic/loop component IDs");
  ok(JSON.stringify(editor.edges.flatMap((e:any)=>e.index).sort())===JSON.stringify(disconnected.edges.map((_:any,i:number)=>i)),"disconnected parallel conditions, checks, back/loop edges retain every original index");
  ok(!Object.values(editor.badges).flat().some((b:any)=>b.loop==="refine"),"visible disconnected loop is not also folded into a duplicate badge");
  const folded=L.layoutSimple(disconnected,{actualGraph:true,collapsed:["repair"]});
  ok(folded.nodes.some((n:any)=>n.kind==="stage"&&n.members.includes("cycle-a")&&n.members.includes("cycle-b")),"collapsed disconnected members retain an explicit expandable stage representation");
  ok(L.layoutSimple({...def,nodes:[],edges:[]},{actualGraph:true}).nodes.length===0,"deleting the last node leaves a truthful empty editor");
  ok([L.layout,L.layoutSimple,L.place].every(fn=>{const g=fn({...def,nodes:[],edges:[]},{actualGraph:true});return g.nodes.length===0&&Object.values(g.bbox).every(Number.isFinite);}),"all empty graph layouts have finite bounds");
  const fork={...def,nodes:[...def.nodes,{id:"branch",kind:"hook",do:"note",label:"Branch"}],edges:[...def.edges,{from:"start",to:"branch"},{from:"branch",to:"done"}]};
  const forkAfter={...fork,nodes:fork.nodes.filter(n=>n.id!=="middle"),edges:fork.edges.filter(e=>e.from!=="middle"&&e.to!=="middle")};
  const forkView=L.layoutSimple(forkAfter,{actualGraph:true});
  ok(forkView.nodes.some((n:any)=>n.id==="tail")&&forkView.nodes.some((n:any)=>n.id==="branch"),"fork deletion preserves both the still-connected branch and isolated downstream tail");
  for(const rawSource of defs){const source=normalize(rawSource);const golden=JSON.stringify(L.layoutSimple(source));
    ok(JSON.stringify(L.layoutSimple(source,{actualGraph:true}).nodes.flatMap((n:any)=>n.members).sort())===JSON.stringify(source.nodes.map((n:any)=>n.id).sort()),`${source.id}: editor Overview initially represents every actual node`);
    for(const index of source.nodes.keys()){const removed=source.nodes[index].id;const after={...source,nodes:source.nodes.filter((n:any)=>n.id!==removed),edges:source.edges.filter((e:any)=>e.from!==removed&&e.to!==removed)};if(!after.nodes.length)continue;
      const view=L.layoutSimple(after,{actualGraph:true}),represented=new Set(view.nodes.flatMap((n:any)=>n.members));
      ok(JSON.stringify([...represented].sort())===JSON.stringify(after.nodes.map((n:any)=>n.id).sort()),`${source.id}: deleting ${removed} changes only the selected visible ID`);
      ok(JSON.stringify(view.edges.flatMap((e:any)=>e.index).sort((a:number,b:number)=>a-b))===JSON.stringify(after.edges.map((_:any,i:number)=>i)),`${source.id}: deleting ${removed} retains exact original remaining edge identities`);
    }
    ok(JSON.stringify(L.layoutSimple(source))===golden,`${source.id}: editing repair projections do not mutate the existing run Overview`);
  }

}
console.log(`\ngraph-tidy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
