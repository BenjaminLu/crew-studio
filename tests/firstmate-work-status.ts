import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// studio_work_status (H10): Firstmate read the oldest 50 Tasks, so with R-061..R-072 on the board it said the list
// "only goes up to R-060", and it called R-068 (a proposal the captain had already dispatched into R-069, PR open)
// still waiting for approval. It reads the newest Tasks first, and a dispatched proposal names its execution run
// and that run's real state.
//      bun tests/firstmate-work-status.ts
import { readFileSync } from "node:fs";
import { harness, until } from "./rt-harness";
import { installFirstmate } from "../src/firstmate";
import { Projects } from "../src/doors";
process.env.CREW_TEST_IN_PROCESS = "1";
let pass = 0, fail = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`${v ? "ok" : "FAIL"} ${n}${v ? "" : " " + extra}`); v ? pass++ : fail++; };
const quick = { id: "quick-fixture", name: "Quick fixture", version: 1, roles: [], nodes: [{ id: "done", kind: "hook", label: "Done", x: 1, y: 1 }], edges: [] };
const target = { id: "status-fixture", name: "Status fixture", version: 1, roles: [], nodes: [{ id: "wait", kind: "card", label: "Wait", x: 1, y: 1, card: { body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, options: [{ id: "done", label: "Done", labelZh: "Done" }] } }, { id: "done", kind: "hook", label: "Done", x: 2, y: 1 }], edges: [{ from: "wait", to: "done", when: "done" }] };
const H = await harness([readFileSync(new URL("../workflows/v2/firstmate-proposal.wf.yaml", import.meta.url), "utf8"), JSON.stringify(quick), JSON.stringify(target)]); const E = H.engine;
const tools = installFirstmate(E, new Projects(H.data));
const owner = (key: string) => ({ key, captain: true, text: "Add euro formatting", live: () => true });
try {
  // more finished Tasks than the status keeps, created before the proposal
  const old: string[] = [];
  for (let i = 0; i < 55; i++) { const r = E.start({ workflow: "quick-fixture", version: 1, text: `old ${i}`, by: "fixture", params: {} } as any); old.push(r.id); }
  await until(() => old.every((id) => E.get(id)?.status === "succeeded"));
  const p: any = await tools.call("studio_propose_work", { workflow: "status-fixture", version: 1, title: "EUR 金額格式", text: "Add euro formatting" }, owner("status"));
  await until(() => E.cards.list({ run: p.proposal }).some((c) => c.node === "dispatch"));
  const before: any = await tools.call("studio_work_status", {}, owner("read-1"));
  const waiting = before.tasks.find((t: any) => t.id === p.proposal);
  ok(!!waiting && before.tasks[0].id === p.proposal, "the newest Task is in the status, first", JSON.stringify(before.tasks.slice(0, 3).map((t: any) => t.id)));
  ok(before.tasks.length === 50 && before.total === 56 && !before.tasks.some((t: any) => t.id === old[0]), "the status keeps the newest 50 and says how many Tasks there are", `${before.tasks.length} ${before.total}`);
  ok(waiting?.dispatched === false && waiting.waitingOn?.some((w: any) => w.node === "dispatch") && !waiting.execution, "an undispatched proposal waits for the captain and names no execution", JSON.stringify(waiting));
  const card = E.cards.list({ run: p.proposal }).find((c) => c.node === "dispatch")!;
  await E.answer(card.id, { choice: "approve", by: "captain" } as any);
  await until(() => !!E.get(p.proposal)?.ctx.childRun && E.get(p.proposal)!.status === "succeeded");
  const child = E.get(p.proposal)!.ctx.childRun as string;
  await until(() => E.get(child)?.status === "waiting");
  const after: any = await tools.call("studio_work_status", {}, owner("read-2"));
  const proposal = after.tasks.find((t: any) => t.id === p.proposal), run = after.tasks.find((t: any) => t.id === child);
  ok(proposal?.dispatched === true && proposal.execution?.id === child, "a dispatched proposal names its execution run", JSON.stringify(proposal));
  ok(proposal?.execution?.status === "waiting" && proposal.execution.waitingOn?.some((w: any) => w.node === "wait"), "and that run's real state: waiting on its own card, not the dispatch approval", JSON.stringify(proposal?.execution));
  ok(run?.status === "waiting" && run.proposal === p.proposal && run.waitingOn?.[0]?.node === "wait", "the execution run names the proposal it came from and the card it waits on", JSON.stringify(run));
} finally { for (const r of E.list()) if (!["failed", "cancelled", "succeeded"].includes(r.status)) await E.cancel(r.id); H.stop(); }
console.log(`\nfirstmate-work-status: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
