import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Who a Task waits on (projects design §3.3): card, readiness hold, staffing hold, queue, CI, agent, none.
//   bun tests/waits-on.ts
import { waitsOn } from "../src/task-round";
import { suite } from "./rt-harness";
const { ok, end } = suite("waits-on");

const node = (o: any = {}) => ({ state: "pending", visits: 1, extra: 0, attempt: 0, outcome: null, cause: null, error: null, startedAt: null, endedAt: null, inbox: [], agent: null, swap: null, job: null, card: null, waiting: null, data: {}, note: null, ...o });
const run = (status: string, nodes: Record<string, any>, extra: any = {}) => ({ id: "R-7", workflow: "code-firstmate", version: 1, status, result: null, steps: [],
  def: { kind: "code", nodes: [{ id: "build", kind: "agent", label: "Build", role: "worker" }, { id: "merge", kind: "card", label: "Merge" }, { id: "ci", kind: "hook", label: "CI" }] }, nodes, ...extra }) as any;
const open = (id: string, nodeId: string) => ({ id, run: "R-7", node: nodeId, status: "open" });

{ const w = waitsOn(run("waiting", { merge: node({ state: "running", waiting: "card", card: "SC-1" }) }), [open("SC-1", "merge")]);
  ok(w.kind === "captain" && w.node === "merge" && w.nodeLabel === "Merge" && w.card === "SC-1" && w.detail.en === "at Merge" && w.detail["zh-TW"] === "在「Merge」", "an open card on a waiting node: captain, at that node", JSON.stringify(w)); }
{ const w = waitsOn(run("waiting", { merge: node({ state: "running", waiting: "card", card: "SC-1" }) }), [open("SC-1", "merge")].map((c) => ({ ...c, run: "R-8" })));
  ok(w.kind === "none", "another run's card does not count"); }
{ const w = waitsOn(run("waiting", { build: node({ state: "running", waiting: "card", card: "SC-2", data: { nativeQueueCapability: { version: 1, reason: "scope held by R-3" } } }) }), [open("SC-2", "build")]);
  ok(w.kind === "hold" && w.card === "SC-2" && !w.staffing && w.detail.en === "Round not ready: scope held by R-3" && w.detail["zh-TW"].startsWith("這一輪還不能開始："), "a readiness hold reads as the hold, with its reason and card", JSON.stringify(w)); }
{ const w = waitsOn(run("waiting", { build: node({ state: "running", waiting: "card", card: "SC-3", data: { nativeQueueCapability: { version: 1, reason: "approved staffing role configuration is missing" } } }) }), [open("SC-3", "build")]);
  ok(w.kind === "hold" && w.staffing === true && w.detail.en === "Round not ready: crew needs approval" && w.detail["zh-TW"] === "這一輪還不能開始：船員配置待核准", "the staffing hold reads: crew needs approval", JSON.stringify(w)); }
{ const w = waitsOn(run("queued", { build: node({ state: "running", data: { nativeQueue: { version: 1, state: "waiting", reason: "live owned-round capacity is full" } } }) }), [], { active: 2, limit: 2 });
  ok(w.kind === "queue" && w.detail.en === "queue: project capacity full (2/2)" && w.detail["zh-TW"] === "佇列：專案名額已滿（2/2）", "a queue wait names the capacity", JSON.stringify(w)); }
{ const w = waitsOn(run("queued", { build: node({ state: "running", data: { nativeQueue: { version: 1, state: "waiting", reason: "previous owned round has not completed" } } }) }), []);
  ok(w.kind === "queue" && w.detail.en === "queue: previous owned round has not completed", "a queue wait for another reason says it", JSON.stringify(w)); }
{ const w = waitsOn(run("waiting", { ci: node({ state: "running", waiting: "external", data: { external: { version: 1, handler: "github-ci", deadline: Date.now() + 12 * 60000 } } }) }), []);
  ok(w.kind === "ci" && /^CI: GitHub checks · 1[12] min left$/.test(w.detail.en), "a remote CI wait: checks and time left", JSON.stringify(w)); }
{ const w = waitsOn(run("running", { build: node({ state: "running", job: "J-1", agent: { provider: "codex", model: "gpt-5.5", effort: "high" } }) }), []);
  ok(w.kind === "agent" && w.role === "worker" && w.provider === "codex" && w.model === "gpt-5.5" && w.effort === "high" && w.detail.en === "agent: worker · codex gpt-5.5 high" && w.detail["zh-TW"] === "代理：worker · codex gpt-5.5 high", "a running round with a job: agent, role and pick", JSON.stringify(w)); }
{ const w = waitsOn(run("running", { build: node({ state: "running", job: null }) }), []);
  ok(w.kind === "none", "a running node with no job yet waits on nobody"); }
{ const w = waitsOn(run("succeeded", { merge: node({ state: "running", waiting: "card" }) }), [open("SC-1", "merge")]);
  ok(w.kind === "none", "an ended Task waits on nobody"); }
{ const w = waitsOn(run("paused", {}), []);
  ok(w.kind === "none" && w.detail.en === "", "a paused Task with no wait: none"); }
end();
