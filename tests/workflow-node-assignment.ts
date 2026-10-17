import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Custom workflows (R-044) and routing by deliverable (R-045), on the real runtime over throwaway data:
// - every agent node of a drafted workflow carries its own assignment, never the whole design interview;
// - the builder checks each node's role skill against the skill catalogue (Writer: documents; Designer: web pages,
//   design direction, design review) and refuses a mismatch; the captain's inline pick only has to make the output;
// - a website request routes to web-prototype, and Firstmate cannot propose the text-only startup pitch for it.
// No model is called.
import { gateHarness } from "./gate-harness";
import { WORKFLOW_DRAFT_EXAMPLE } from "../src/workflow-draft-contract";
import { deliverableOf } from "../src/deliverables";

let pass = 0, fail = 0;
const ok = (v: any, name: string, detail = "") => { console.log(`${v ? "  ok   " : "  FAIL "} ${name}${v ? "" : " " + detail}`); v ? pass++ : fail++; };
const WRITER = "bundled:workflows/skills/v2/writer.md", DESIGNER = "bundled:workflows/skills/v2/designer.md";
// the R-044 shape: a design lead writes the direction and reviews the page a developer builds
const r044 = (lead = WRITER, dev = DESIGNER) => ({
  goal: "建立一个简单的 Hello Crew Studio 网页开发流程：先讨论网站用途、标题和视觉风格，再制作、审查，经船长核准后才完成。",
  interview: [{ question: "誰負責製作網頁？", answer: "B. 分兩個角色：一位設計方向、一位寫程式" }, { question: "誰負責審查網頁成果？", answer: "B. 由設計角色回頭審查開發者成果" }],
  workflow: {
    name: "Hello Crew Studio 网页开发流程",
    intents: [{ text: "先和我讨论网站用途、标题和视觉风格", done: "设计方向文件写明网站用途、标题和视觉风格" }, { text: "制作 Hello Crew Studio 网页", done: "一个可在浏览器打开的自包含网页" }, { text: "审查网页", done: "设计角色对照设计方向审查网页" }],
    roles: [{ id: "design-lead", label: "设计方向", skill: lead }, { id: "developer", label: "网页开发者", skill: dev }],
    nodes: [
      { id: "design", kind: "agent", label: "设计方向", role: "design-lead", mode: "deliver", args: { format: "document" }, serves: [1] },
      { id: "build", kind: "agent", label: "制作网页", role: "developer", mode: "deliver", args: { format: "web" }, serves: [2] },
      { id: "review", kind: "agent", label: "Review the page", role: "design-lead", mode: "deliver", args: { format: "document" }, serves: [3] },
      { id: "final", kind: "card", label: "船长最终核准", accept: true, serves: [1, 2, 3] },
      { id: "end", kind: "hook", label: "结束" }, { id: "closed", kind: "hook", label: "关闭" },
    ],
    edges: [{ from: "design", to: "build" }, { from: "build", to: "review" }, { from: "review", to: "final" }, { from: "final", to: "end", when: "approved" }, { from: "final", to: "build", when: "changes" }, { from: "final", to: "closed", when: "rejected" }],
  },
});
const h: any = gateHarness();
try {
  // ---------- 16: per-node assignment ----------
  const fit = r044(DESIGNER, DESIGNER); const d = await h.tool("studio_draft_workflow", fit);
  ok(typeof d.draft === "string", "a design lead and developer both on the Designer skill draft", JSON.stringify(d).slice(0, 300));
  const nodes = d.draft ? h.rt.drafts.get(d.draft).def.nodes.filter((n: any) => n.kind === "agent") : [];
  const details = nodes.map((n: any) => String(n.detail ?? ""));
  ok(nodes.length === 3 && details.every((t: string) => t.trim()) && new Set(details).size === 3, "every agent node gets its own assignment", JSON.stringify(details));
  ok(details.every((t: string) => !t.includes("誰負責") && !t.includes(fit.goal)), "no assignment is the design interview or the goal", JSON.stringify(details));
  ok(/index\.html/.test(nodes.find((n: any) => n.id === "build")?.detail) && /制作 Hello Crew Studio 网页/.test(nodes.find((n: any) => n.id === "build")?.detail), "a node's assignment names its output and the intent line it serves", nodes.find((n: any) => n.id === "build")?.detail);
  const own = structuredClone(fit); (own.workflow.nodes[0] as any).detail = "Write the one-page design direction."; const d2 = await h.tool("studio_draft_workflow", own);
  ok(h.rt.drafts.get(d2.draft).def.nodes.find((n: any) => n.id === "design").detail === "Write the one-page design direction.", "a node's own detail is kept as its assignment");
  const contract = await h.tool("studio_workflow_draft_contract", {});
  ok(Array.isArray(contract.skills) && contract.skills.some((s: any) => s.ref === WRITER && s.formats.join() === "document") && contract.skills.some((s: any) => s.ref === DESIGNER && s.formats.includes("web")), "the draft contract carries the skill catalogue", JSON.stringify(contract.skills));

  // ---------- 16: skill catalogue check ----------
  const asR044 = await h.tool("studio_draft_workflow", r044());
  ok(asR044.code === "draft_invalid" && /design/i.test(asR044.reason?.en ?? asR044.message ?? JSON.stringify(asR044)), "R-044: a Writer on design direction and design review is refused", JSON.stringify(asR044).slice(0, 300));
  const writerWeb = await h.tool("studio_draft_workflow", r044(DESIGNER, WRITER));
  ok(writerWeb.code === "draft_invalid" && /web/.test(JSON.stringify(writerWeb)), "a Writer on a web page node is refused", JSON.stringify(writerWeb).slice(0, 300));
  const reviewOnly = r044(DESIGNER, DESIGNER); reviewOnly.workflow.roles.push({ id: "copy", label: "Copy", skill: WRITER }); (reviewOnly.workflow.nodes[2] as any).role = "copy";
  const rv = await h.tool("studio_draft_workflow", reviewOnly);
  ok(rv.code === "draft_invalid" && /review/.test(JSON.stringify(rv)), "a Writer reviewing the page an earlier node built is refused (design review)", JSON.stringify(rv).slice(0, 300));
  const designerDoc = structuredClone(WORKFLOW_DRAFT_EXAMPLE) as any; designerDoc.workflow.nodes[1].args = { format: "document" }; designerDoc.workflow.nodes[1].label = "Write the newsletter";
  const dd = await h.tool("studio_draft_workflow", designerDoc);
  ok(dd.code === "draft_invalid" && /Writer/.test(JSON.stringify(dd)), "a Designer on a written document that is not design work is refused", JSON.stringify(dd).slice(0, 300));
  const example = await h.tool("studio_draft_workflow", WORKFLOW_DRAFT_EXAMPLE);
  ok(typeof example.draft === "string", "the contract's own example (Designer on a web page) still drafts", JSON.stringify(example).slice(0, 200));
  // the captain's inline choice: any skill that can make the output; a writer cannot make a web page
  const rev = h.rt.drafts.get(example.draft).revision;
  const bad = await h.api(`/api/wf/drafts/${example.draft}/nodes/make`, { revision: rev, skill: WRITER });
  ok(bad.status === 400 && /web/.test(JSON.stringify(bad.body)), "the captain's inline Writer on a web page node is refused", JSON.stringify(bad.body).slice(0, 200));

  // ---------- 17: routing by deliverable ----------
  ok(deliverableOf("我想做一個豆花店網站") === "web" && deliverableOf("A landing page for my bakery") === "web" && deliverableOf("a video for my website") === null, "the deliverable a request names (none when it names two)");
  const cls = h.rt.classify("我想做一個豆花店網站");
  ok(cls.workflow === "web-prototype" && cls.confident, "R-045: a shop website request routes to web-prototype, not startup-recursion", JSON.stringify(cls.scores.slice(0, 3)));
  ok(h.rt.classify("Build a landing page for my bakery").workflow === "web-prototype", "a landing page request routes to web-prototype");
  const list = await h.tool("studio_list_workflows", {});
  const wp = list.workflows?.find((w: any) => w.id === "web-prototype"), sr = list.workflows?.find((w: any) => w.id === "startup-recursion");
  ok(/website/.test(wp?.deliverable ?? "") && /never a website/.test(sr?.deliverable ?? ""), "Firstmate's chooser lists what each workflow delivers", JSON.stringify([wp, sr]).slice(0, 300));
  const spec = h.rt.firstmate.specs.find((s: any) => s.name === "studio_list_workflows");
  ok(/deliverable/.test(spec?.description ?? "") && /web-prototype/.test(spec?.description ?? ""), "the chooser's description says to route by deliverable", spec?.description);
  const before = h.rt.engine.list().length;
  const wrong = await h.tool("studio_propose_work", { workflow: "startup-recursion", version: sr?.version ?? 1, title: "豆花店網站", text: "我想做一個豆花店網站", params: {} }, "我想做一個豆花店網站");
  ok(wrong.code === "invalid_params" && /web-prototype/.test(JSON.stringify(wrong)) && h.rt.engine.list().length === before, "Firstmate cannot propose the startup pitch for a website request", JSON.stringify(wrong).slice(0, 300));
} finally {
  for (const r of h.rt.engine.list()) if (!["succeeded", "cancelled", "failed"].includes(r.status)) await h.rt.engine.cancel(r.id);
  h.rt.readiness?.stop?.(); h.rt.engine.disposeExternal?.(); h.agents.cancelAll?.();
}
console.log(`workflow-node-assignment: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
