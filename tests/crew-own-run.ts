import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// A captain's own workflow on the Studio team (docs/design/crew-seats.md): the Run confirmation shows exactly what will run.
//   - each row is the final pick: the definition's provider and model, the team's effort where the node sets none, the member's
//     skills with versions, where each comes from, and the team rule's note when it moves a reviewer off the maker's model
//   - the confirmation hash covers that whole resolution: the Task records the same crew it confirmed
//   - a team change between the confirmation and the start refuses the start and asks again with the new plan
//      bun tests/crew-own-run.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suite } from "./rt-harness";
const { ok, end } = suite("crew-own-run");
const { createRuntime } = await import("../src/runtime");
const { Agents } = await import("../src/agent");
const { StudioLog } = await import("../src/rawlog");
const C = await import("../src/domain/crew");
const pin = (id: string) => ({ id, v: 1, sha256: createHash("sha256").update(readFileSync(join(import.meta.dir, "..", `packs/core/skills/${id}/SKILL.md`), "utf8")).digest("hex") });
const dir = checkedTempDir("crew-own-run-");
const rt: any = createRuntime({ dataDir: dir, agents: new Agents(dir, () => ""), provider: () => { throw new Error("no provider"); }, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(dir, "events")), send() {}, fmRoot: join(dir, "fm"), readiness: false } as any);
const post = async (body: any) => { const r = await rt.handle(new Request("http://x/api/wruns", { method: "POST", body: JSON.stringify(body) }), new URL("http://x/api/wruns"), { kind: "desktop" }, true); return { status: r.status, j: await r.json() }; };
try {
  const writer = "bundled:workflows/skills/v2/writer.md";
  const def: any = { id: "draft", name: "Own newsletter", version: 1, roles: [{ id: "writer", label: "Writer", skill: writer, seat: "maker" }, { id: "checker", label: "Checker", skill: writer, seat: "reviewer" }],
    nodes: [{ id: "make", kind: "agent", label: "Write it", role: "writer", mode: "deliver", args: { format: "document" }, provider: "claude", model: "sonnet-5.5", x: 0, y: 0 },
      { id: "check", kind: "agent", label: "Check it", role: "checker", mode: "deliver", args: { format: "document" }, provider: "claude", model: "sonnet-5.5", x: 1, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }],
    edges: [{ from: "make", to: "check" }, { from: "check", to: "done" }] };
  const own = rt.defs.createDrafted("own-newsletter", def, "captain", { schema: 1, source: "firstmate-draft", draft: "d-000000000001", revision: 1, definition: "x" });
  const store = new C.CrewStore(dir);
  const m = (provider: "codex" | "claude", model: string, effort: string | null, skills: any[] = []) => ({ provider, model, effort, skills });
  const t1 = store.write({ schema: 1, members: { maker: m("codex", "gpt-6.1-sol", "high", [pin("plain-writing")]), reviewer: m("claude", "opus-5.5", "high"), coordinator: m("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" });
  const first = await post({ workflow: own.id, text: "this week's issue" });
  const plan = first.j.staffing;
  ok(first.status === 409 && first.j.code === "staffing_confirmation_required" && plan?.team === t1.hash, "Run asks for confirmation of the team's resolution", JSON.stringify(first.j).slice(0, 300));
  const make = plan.plan.find((r: any) => r.node === "make"), check = plan.plan.find((r: any) => r.node === "check");
  ok(make.provider === "claude" && make.model === "sonnet-5.5" && make.effort === "high" && make.skills.some((p: any) => p.id === "plain-writing" && p.from === "member" && p.v === 1), "the make row shows what runs: the definition's model, the team's effort, the member's skill with its version", JSON.stringify(make));
  ok(check.model !== "sonnet-5.5" && check.notes.some((n: any) => /same model as Maker/.test(n.en)), "the check row shows the model the rule moved it to, and the rule's note", JSON.stringify(check));
  // a caller's "_" params (Studio's own pins: run efforts, proposal bindings) are dropped, never taken as the captain's
  const started = await post({ workflow: own.id, text: "this week's issue", staffingConfirm: plan.hash, claudeVerification: plan.claudeVerification, params: { _crewRun: JSON.stringify({ make: { effort: "low" } }), _firstmateProposal: "R-0001", _crewTeam: "x" } });
  ok(started.status === 200 && !!started.j.id, "confirming that exact plan starts the Task", JSON.stringify(started.j).slice(0, 300));
  { const params = rt.engine.get(started.j.id)?.params ?? {};
    ok(!Object.keys(params).some((k) => ["_crewRun", "_firstmateProposal", "_crewTeam"].includes(k)), "a caller's internal params are dropped at the Task API", JSON.stringify(Object.keys(params))); }
  const rec = rt.engine.trusted(started.j.id).entries.find((e: any) => e.record === "crew-resolved")?.data;
  ok(rec?.team === t1.hash && ["make", "check"].every((id) => { const r = plan.plan.find((x: any) => x.node === id), n = rec.nodes[id]; return n.provider === r.provider && n.model === r.model && n.effort === r.effort && JSON.stringify(n.skills) === JSON.stringify(r.skills); }),
    "the Task records exactly the crew the captain confirmed", JSON.stringify(rec?.nodes));
  // the team changes after the captain looked: the old confirmation starts nothing, and the new plan is shown
  store.write(C.applyChange(C.teamBody(t1), { kind: "member", seat: "maker", set: { effort: "low" } }), t1.hash, { by: "captain", via: "page" });
  const stale = await post({ workflow: own.id, text: "this week's issue", staffingConfirm: plan.hash, claudeVerification: plan.claudeVerification });
  ok(stale.status === 409 && stale.j.code === "staffing_confirmation_required" && stale.j.staffing.hash !== plan.hash && stale.j.staffing.plan.find((r: any) => r.node === "make").effort === "low", "a team change after confirmation refuses the start and asks again with the new plan", JSON.stringify(stale.j).slice(0, 300));
  let refused = ""; try { rt.engine.start({ workflow: own.id, text: "x", params: { _ownStaffing: plan.hash } }); } catch (e: any) { refused = e.message; }
  ok(/Confirm staffing for every agent node/.test(refused), "the engine refuses a start bound to the old confirmation too", refused);
} catch (e: any) { ok(false, "crew-own-run threw", e?.stack ?? String(e)); }
end();
