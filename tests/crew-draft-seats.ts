import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// A Firstmate workflow draft names the team seat every agent node runs as (docs/design/crew-seats.md): on the node or on
// its role. A draft without one is refused, naming the node; a seat outside the team's seats is refused too.
//      bun tests/crew-draft-seats.ts
import { suite } from "./rt-harness";
const { ok, end } = suite("crew-draft-seats");
const { WorkflowDefs } = await import("../src/runtime/defs");
const { WorkflowDrafts } = await import("../src/workflow-drafts");
const { WORKFLOW_DRAFT_EXAMPLE, workflowDraftSchema } = await import("../src/workflow-draft-contract");
try {
  const data = checkedTempDir("crew-draft-seats-"), drafts = new WorkflowDrafts(data, new WorkflowDefs(data, () => []));
  const noSeat = structuredClone(WORKFLOW_DRAFT_EXAMPLE) as any; delete noSeat.workflow.roles[0].seat;
  let refused = ""; try { drafts.preview(noSeat); } catch (e: any) { refused = e.message; }
  ok(/node make \("Create the website"\) has no team seat/.test(refused), "a draft whose agent node has no seat is refused, naming the node", refused);
  const onNode = structuredClone(noSeat); onNode.workflow.nodes.find((n: any) => n.id === "make").seat = "alt-maker";
  ok(drafts.preview(onNode).nodes.find((n: any) => n.id === "make")?.seat === "alt-maker", "a seat on the node itself is enough, and is kept");
  const bad = structuredClone(WORKFLOW_DRAFT_EXAMPLE) as any; bad.workflow.roles[0].seat = "drummer";
  refused = ""; try { drafts.preview(bad); } catch (e: any) { refused = e.message; }
  ok(/seat must be one of the team seats/.test(refused), "a seat outside the team's seats is refused", refused);
  ok(drafts.preview(structuredClone(WORKFLOW_DRAFT_EXAMPLE)).roles[0].seat === "maker", "the example draft names its seat and passes");
  const schema: any = workflowDraftSchema(["bundled:workflows/skills/v2/designer.md"], ["codex"], ["low"]);
  ok(schema.properties.workflow.properties.roles.items.properties.seat.enum.includes("design-reviewer") && schema.properties.workflow.properties.nodes.items.properties.seat.enum.includes("alt-maker"), "the draft tool's schema offers the seats on roles and nodes");
} catch (e: any) { ok(false, "crew-draft-seats threw", e?.stack ?? String(e)); }
end();
