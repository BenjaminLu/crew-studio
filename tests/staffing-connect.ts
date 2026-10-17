import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Connecting a project to GitHub and its staffing (E2E H2/H3): the grant is part of the project's staffing
// identity, so the captain's Connect approval carries the approved crew over to the connected identity (same
// picks, signed, recorded) instead of orphaning it; a staffing card raised before the connect fails as
// deterministic.re-propose (Retry can never succeed), and its "Re-propose" answer raises one fresh card with the
// same picks for the connected project.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { Projects } from "../src/doors";
import { installGitHubConnect, startGitHubConnect, CONNECT_WORKFLOW } from "../src/github-connect";
import { StaffingStore, installStaffingGuard, staffingHash } from "../src/domain/staffing";
import { installFirstmateStaffing } from "../src/firstmate-staffing";
import { fromError, failureActions } from "../src/runtime/failures";
import { NativeToolFailure } from "../src/host/types";
import { bundledText } from "../src/bundled";
import { must, setGitHome } from "../src/git";

const { ok, end } = suite("staffing-connect");
const temp = checkedTempDir("staffing-connect-"); setGitHome(join(temp, "git-home"));

// ---------- 1. the Connect approval carries the approved crew over to the connected identity ----------
{
  const repo = join(temp, "money-kit"); mkdirSync(repo); assertTempRepo(repo);
  must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]);
  must(repo, ["remote", "add", "origin", "https://github.com/fixture/money-kit.git"]);
  const H = await harness([bundledText(`workflows/v2/${CONNECT_WORKFLOW}.wf.yaml`)!]), E = H.engine, projects = new Projects(H.data);
  writeFileSync(join(H.data, "projects.json"), JSON.stringify([{ id: "mk", name: "money-kit", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null }]));
  try {
    const store = new StaffingStore(H.data), identity = (id: string) => projects.staffingIdentity(id);
    const before = identity("mk"), skill = store.remember({ ref: "pack:firstmate/skills/worker.md", version: 1, text: "# Worker\nExact scope." });
    const approved = store.approve({ schema: 1, algorithm: "sha256-canonical-v1", project: before, workflow: { id: "code-firstmate", version: 9, sha256: staffingHash({ definition: 9 }) },
      roles: { worker: { provider: "codex", model: "gpt-fixture", effort: "high", skill } }, review: { freshContexts: 3, distinctProviders: false } }, null, { run: "R-001", card: "SC-001", answerSeq: 1 });
    installGitHubConnect(E, projects, { staffingProject: identity });
    const run = startGitHubConnect(E, projects, "mk", "captain (test)");
    await until(() => E.cards.list({ run: run.id, open: true }).length > 0, 8000);
    const card = E.cards.list({ run: run.id, open: true })[0];
    await E.answer(card.id, { choice: "approve", by: "captain" } as any);
    await until(() => run.status === "succeeded" || run.status === "failed", 8000);
    const after = identity("mk");
    ok(run.status === "succeeded" && staffingHash(after) !== staffingHash(before), "connecting changes the project's staffing identity", run.error);
    let carried: any = null; try { carried = store.current(after); } catch (e: any) { carried = e.message; }
    ok(carried?.roles?.worker?.provider === "codex" && carried.roles.worker.model === "gpt-fixture" && carried.roles.worker.effort === "high" && carried.workflow.version === 9 && staffingHash(carried.project) === staffingHash(after),
      "the approved crew carries over to the connected identity with the same picks (no new staffing interview)", JSON.stringify(carried));
    ok(carried?.approval?.run === run.id && carried.approval.card === card.id, "the carried crew is approved by the captain's Connect answer", JSON.stringify(carried?.approval));
    ok(store.skill(carried.roles.worker.skill, after) === "# Worker\nExact scope.", "the approved role skill text carries over with it");
    ok(E.trusted(run.id).entries.some((e) => e.record === "staffing-carried" && e.data?.from === approved.hash && e.data?.to === carried.hash), "the ledger records the carried crew");
    ok(/approved crew \(code-firstmate v9\) carries over/.test(String(run.nodes.write?.note ?? "")), "the connect note says the crew carried over", run.nodes.write?.note);
  } catch (e: any) { ok(false, "unexpected connect error", e.stack); } finally { H.stop(); }
}

// ---------- 2. a staffing proposal raised before the connect: re-propose, not a futile Retry ----------
{
  const f = fromError(new NativeToolFailure("staffing_stale", "Staffing target changed; discuss and confirm again", "已鎖定的流程、配置或目標已變更。", "read_current_state"));
  const acts = failureActions(f.class, f.code).map((o) => o.id);
  ok(f.code === "deterministic.re-propose" && acts.includes("re-propose") && !acts.includes("retry"), "a stale staffing proposal offers Re-propose, never Retry", `${f.code} ${acts}`);

  const flow = { id: "code-firstmate", name: "Staffing target", kind: "code", version: 1, roles: [{ id: "worker", label: "Worker", skill: "pack:firstmate/skills/worker.md" }], nodes: [{ id: "work", kind: "agent", role: "worker", mode: "receipt", label: "Work", x: 1, y: 1 }], edges: [] };
  const H = await harness([Y(flow), bundledText("workflows/v2/firstmate-staffing.wf.yaml")!]), e = H.engine, store = new StaffingStore(H.data);
  let project = { namespace: "git" as const, id: "p", identity: "before-connect" };
  const facts = async () => [{ provider: "codex", support: "supported" as const, auth: "verified", quota: "available", expires: Date.now() + 30000, models: [{ id: "explicit-model", efforts: ["high"] }] }];
  try {
    installStaffingGuard(e, store, () => project);
    const tools = installFirstmateStaffing(e, store, () => project, facts);
    const owner = (key: string) => ({ key, captain: true, text: "Use Codex explicit-model high for worker", live: () => true });
    const base = { project: "p", workflow: flow.id, version: 1 };
    await tools.call("studio_staffing_interview", { ...base, answers: { worker: { provider: "codex" } } }, owner("r1"));
    await tools.call("studio_staffing_interview", { ...base, answers: { worker: { model: "explicit-model" } } }, owner("r2"));
    await tools.call("studio_staffing_interview", { ...base, answers: { worker: { effort: "high" } } }, owner("r3"));
    const proposal: any = await tools.call("studio_propose_staffing", { ...base, roles: { worker: { provider: "codex", model: "explicit-model", effort: "high" } } }, owner("r4"));
    await until(() => e.get(proposal.proposal)?.nodes.confirm.waiting === "card", 8000);
    // the project connects to GitHub while the staffing card is open: its identity changes
    project = { ...project, identity: "after-connect" };
    const card = e.cards.list({ run: proposal.proposal, open: true })[0];
    await e.answer(card.id, { choice: "approve", by: "captain" } as any);
    await until(() => e.get(proposal.proposal)?.status === "failed", 8000);
    const old = e.get(proposal.proposal)!, fc = e.cards.list({ run: old.id, open: true }).find((c) => c.kind === "failure");
    ok(old.failure?.code === "deterministic.re-propose" && !!fc && fc.options.some((o) => o.id === "re-propose") && !fc.options.some((o) => o.id === "retry"),
      "the stale staffing card fails as deterministic.re-propose with Re-propose and no Retry", JSON.stringify({ code: old.failure?.code, options: fc?.options.map((o) => o.id) }));
    await until(() => !e.busy(old.id), 8000);
    await e.answer(fc!.id, { choice: "re-propose", by: "captain" } as any);
    const next = e.get(String(old.ctx.followedBy ?? ""));
    ok(!!next && next.id !== old.id && !!old.parked, "Re-propose parks the stale proposal and starts a fresh one", JSON.stringify({ followedBy: old.ctx.followedBy, parked: old.parked }));
    const draft = JSON.parse(next!.params.draft);
    ok(draft.project.identity === "after-connect" && draft.roles.worker.provider === "codex" && draft.roles.worker.model === "explicit-model" && draft.roles.worker.effort === "high", "the fresh proposal keeps the same picks for the connected project", next!.params.draft);
    await until(() => e.get(next!.id)?.nodes.confirm.waiting === "card", 8000);
    const again = e.cards.list({ run: next!.id, open: true })[0];
    await e.answer(again.id, { choice: "approve", by: "captain" } as any);
    await until(() => e.get(next!.id)?.status === "succeeded" || e.get(next!.id)?.status === "failed", 8000);
    ok(e.get(next!.id)?.status === "succeeded" && store.current(project).roles.worker.model === "explicit-model", "approving the fresh card writes the crew for the connected project", e.get(next!.id)?.error);
  } catch (err: any) { ok(false, "unexpected staffing error", err.stack); } finally { H.stop(); }
}
end();
