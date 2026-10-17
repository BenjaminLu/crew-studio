import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Per-node configuration on a staffed workflow (retro 2026-10-17 finding 29): a node's own provider, model,
// effort and named skills override its role's staffing. The staffing proposal records them, the captain approves
// them with the roles (the staffing card lists them), and round start enforces them:
//   - the overridden node runs on its own provider/model/effort and loads its own skills; the other node keeps the role's
//   - the step, the round actor and the staffing-instructions entry name what the node ran with
//   - an approval that does not carry the definition's overrides is refused (an older approval still covers skill-only nodes)
//   - a loop node's override applies to its coordinator turns only; a judge on an agent node keeps the reviewer's staffing
//   - the role-skill one-click approval keeps the node overrides
//   - a workflow role's effort is the default its nodes run at when nothing else says
//   - an override naming a model that is not verified available is refused at proposal and at Task start
//   - a loop node's override reaches its coordinator turn end to end (model, effort, named skills)
//      bun tests/node-overrides.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("node-overrides");
const { StaffingStore, installStaffingGuard, staffingHash, staffingNodeOverrides, nodeOverrideProblems, effectivePick, staffedCapability } = await import("../src/domain/staffing");
const { installFirstmateStaffing } = await import("../src/firstmate-staffing");
const { installRefine } = await import("../src/runtime/refine");
const { bundledText } = await import("../src/bundled");
const { roundsOf } = await import("../src/task-round");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const plain = readFileSync(join(import.meta.dir, "..", "packs/core/skills/plain-writing/SKILL.md"), "utf8");
const pin = { id: "plain-writing", v: 1, sha256: sha(plain) };
const ref = "pack:firstmate/skills/worker.md";
const flow = { id: "code-firstmate", name: "Node override fixture", kind: "code", version: 1, roles: [{ id: "worker", label: "Worker", skill: ref }],
  nodes: [{ id: "wait", kind: "card", label: "Wait", x: 0, y: 0, card: { options: [{ id: "go", label: "Go" }] } },
    { id: "work", kind: "agent", label: "Work", role: "worker", mode: "test", provider: "codex", model: "node-model", effort: "xhigh", skills: [pin], x: 1, y: 0 },
    { id: "work2", kind: "agent", label: "Work 2", role: "worker", mode: "test", x: 2, y: 0 }],
  edges: [["wait", "work", "go"], ["work", "work2"]] };
const h = await harness([Y(flow), bundledText("workflows/v2/firstmate-staffing.wf.yaml")!], { data: checkedTempDir("crew-node-overrides-") }), e = h.engine, staffing = new StaffingStore(h.data), project = { namespace: "git" as const, id: "p", identity: "isolated-node-overrides" };
try {
  // the models verified available now (the runtime's staffing facts); a Task start checks every role and node override pick against them
  const available = new Set(["role-model", "node-model", "loop-model"]);
  installStaffingGuard(e, staffing, () => project, (cfg) => staffedCapability(cfg, e.defs.get(cfg.workflow.id, cfg.workflow.version), (p) => available.has(p.model)));
  installRefine(e);
  let text = "# Worker skill, as approved\n";
  e.deps.skillText = () => text;
  const def = e.defs.get(flow.id)!;
  const role = { provider: "codex" as const, model: "role-model", effort: "high", skill: staffing.remember({ ref, version: 1, text }) };
  const draft = (d: any, nodes: any = staffingNodeOverrides(d), worker = role) => ({ schema: 1 as const, algorithm: "sha256-canonical-v1" as const, project, workflow: { id: d.id, version: d.version, sha256: staffingHash(d) }, roles: { worker }, review: { freshContexts: 3, distinctProviders: false }, ...(nodes ? { nodes } : {}) });

  // ---------- the overrides a definition asks for, and what a node runs on ----------
  const nodes = staffingNodeOverrides(def)!;
  ok(JSON.stringify(nodes) === JSON.stringify({ work: { provider: "codex", model: "node-model", effort: "xhigh", skills: [{ ref: "skill:plain-writing", version: 1, sha256: pin.sha256, snapshotSha256: pin.sha256 }] } }),
    "the definition's node settings become one override (provider, model, effort, skill pins); a node without settings has none", JSON.stringify(nodes));
  ok(nodeOverrideProblems({ ...def, nodes: def.nodes.map((n: any) => n.id === "work" ? { ...n, provider: "claude", model: undefined } : n) }, { worker: role }).some((p) => /changes provider names its model/.test(p))
    && nodeOverrideProblems({ ...def, nodes: def.nodes.map((n: any) => n.id === "work" ? { id: "work", kind: "agent", role: "worker", effort: undefined } : n) }, { worker: { ...role, effort: null } }).length === 0,
    "a node that changes provider must name its model");
  const cfg = { roles: { worker: role, coordinator: { ...role, model: "coord-model" } }, nodes: { fix: { model: "loop-model" }, work: { effort: "low" } } };
  const loopDef = { roles: [{ id: "worker" }, { id: "coordinator" }] };
  ok(effectivePick(cfg, loopDef, { id: "fix", kind: "loop", args: { producer: "build", coordinator: "coordinator" }, role: "coordinator" }, "coordinator")?.model === "loop-model"
    && effectivePick(cfg, loopDef, { id: "fix", kind: "loop", args: { producer: "build" } }, "coordinator")?.model === "loop-model"
    && effectivePick(cfg, loopDef, { id: "work", kind: "agent", role: "worker" }, "reviewer") === null
    && effectivePick({ ...cfg, roles: { ...cfg.roles, reviewer: role } }, loopDef, { id: "work", kind: "agent", role: "worker" }, "reviewer")?.effort === "high"
    && effectivePick(cfg, loopDef, { id: "work", kind: "agent", role: "worker" }, "worker")?.effort === "low",
    "a loop's override applies to its coordinator turns; a judge turn on an agent node keeps its own role's staffing");

  // ---------- an approval without the overrides is refused; the approval with them runs them ----------
  const legacy = staffing.approve(draft(def, null), null, { run: "R-src", card: "SC-0", answerSeq: 1 });
  { let msg = ""; try { e.start({ workflow: flow.id, text: "x", params: { project: project.id, _staffing: legacy.hash } }); } catch (err: any) { msg = String(err?.message); }
    ok(/node overrides differ/.test(msg), "an approval that does not carry the definition's node overrides is refused at start", msg); }
  const wrong = staffing.approve(draft(def, { work: { ...nodes.work, model: "other-model" } }), legacy.hash, { run: "R-src", card: "SC-1", answerSeq: 2 });
  { let msg = ""; try { e.start({ workflow: flow.id, text: "x", params: { project: project.id, _staffing: wrong.hash } }); } catch (err: any) { msg = String(err?.message); }
    ok(/node overrides differ/.test(msg), "an approval whose node override differs from the definition is refused", msg); }
  const c1 = staffing.approve(draft(def), wrong.hash, { run: "R-src", card: "SC-2", answerSeq: 3 });
  ok(JSON.stringify(c1.nodes) === JSON.stringify(nodes) && staffing.current(project).hash === c1.hash, "the approved configuration records the node overrides (signed, versioned)");

  const started: { node: string; provider: string; model: string; effort: string | null; system: string }[] = [];
  e.modes.test.system = (_x: any, skill: string) => skill;
  e.deps.selectProvider = async (x: any, p: any) => { const base = e.deps.provider(p.provider, p.model); return { ...base, reasoningEffort: p.effort ?? null,
    start: (sys: string, tools: any, ctx: any) => { started.push({ node: x.node.id, provider: p.provider, model: p.model, effort: p.effort ?? null, system: sys }); return base.start(sys, tools, ctx); } }; };
  const task = e.start({ workflow: flow.id, text: "fixture", params: { project: project.id, _staffing: c1.hash } });
  await until(() => task.nodes.wait.waiting === "card");
  await e.answer(task.nodes.wait.card!, { choice: "go", by: "captain" });
  await until(() => ["succeeded", "failed"].includes(task.status) && !e.busy(task.id));
  const w = started.find((s) => s.node === "work"), w2 = started.find((s) => s.node === "work2");
  ok(task.status === "succeeded" && w?.model === "node-model" && w.effort === "xhigh" && w2?.model === "role-model" && w2.effort === "high",
    "the overridden node runs on its own model and effort; the other node on the role's", JSON.stringify([task.status, task.error, started.map((s) => [s.node, s.model, s.effort])]));
  const body = (await import("../src/skills")).splitFrontmatter(plain).body.trim();
  ok(!!w?.system.includes("# Skill: plain-writing (v1)") && w.system.includes(body) && !w2?.system.includes("# Skill: plain-writing"), "the overridden node loads its own named skill; the other node does not");
  const step = (n: string) => task.steps.filter((s: any) => s.node === n).at(-1) as any;
  ok(step("work")?.model === "node-model" && step("work").effort === "xhigh" && step("work").skills.join() === "plain-writing@v1" && step("work2")?.effort === "high",
    "the step names the model, effort and skills it ran with", JSON.stringify([step("work"), step("work2")].map((s) => [s?.model, s?.effort, s?.skills])));
  const actor = roundsOf(task).find((r) => r.node === "work")?.actor;
  ok(actor?.effort === "xhigh" && actor.skills?.join() === "plain-writing@v1", "the run page's round shows the effort and skills", JSON.stringify(actor));
  const receipt = e.ledger(task.id).filter((x: any) => x.record === "staffing-instructions" && x.data?.node === "work").at(-1);
  ok(receipt?.data?.model === "node-model" && receipt.data.effort === "xhigh" && receipt.data.config === c1.hash, "the signed staffing-instructions entry records the node's approved override", JSON.stringify(receipt?.data));

  // ---------- node skills and a role's named skills share one SkillPin list and one pin check ----------
  { const idxFile = join(h.data, "skills", "_library", "plain-writing", "index.json"), saved = readFileSync(idxFile, "utf8");
    ok(c1.nodes?.work?.skills?.every((p: any) => Object.keys(p).sort().join() === "ref,sha256,snapshotSha256,version"), "a node's approved skills are SkillPins (ref, version, sha256, snapshot)", JSON.stringify(c1.nodes));
    // a library version's record never changes; one that no longer carries the approved hash is refused before the Task exists
    const idx = JSON.parse(saved); idx[0].sha256 = "f".repeat(64); writeFileSync(idxFile, JSON.stringify(idx));
    let msg = ""; const runs = e.list().length; try { e.start({ workflow: flow.id, text: "x", params: { project: project.id, _staffing: c1.hash } }); } catch (err: any) { msg = String(err?.message); }
    writeFileSync(idxFile, saved);
    ok(/Node work skill skill:plain-writing v1 no longer has its approved hash in the skill library/.test(msg) && e.list().length === runs, "a node skill whose library hash moved is refused at start, by the same pin check a role's named skills use", msg); }

  // ---------- an override whose model is not verified available: refused at start and at proposal ----------
  available.delete("node-model");
  { let msg = ""; try { e.start({ workflow: flow.id, text: "x", params: { project: project.id, _staffing: c1.hash } }); } catch (err: any) { msg = String(err?.message); }
    ok(/Refresh staffing facts/.test(msg), "a Task start refuses a node override whose model is no longer verified available (the roles alone are)", msg); }
  available.add("node-model");
  {
    const models = new Set(["role-model"]);
    const facts = async () => [{ provider: "codex", support: "supported" as const, auth: "verified", quota: "available", expires: Date.now() + 30000, models: [...models].map((id) => ({ id, efforts: ["high", "xhigh"] })) }, { provider: "claude", support: "unsupported" as const, auth: "unverified", quota: "unknown", expires: Date.now() + 30000, models: [] }];
    const tools = installFirstmateStaffing(e, staffing, () => project, facts as any);
    const owner = (k: string) => ({ key: k, captain: true, text: "Use Codex role-model high for worker", live: () => true });
    const base = { project: "p", workflow: flow.id, version: 1 };
    await tools.call("studio_staffing_interview", base, owner("i1"));
    await tools.call("studio_staffing_interview", { ...base, answers: { worker: { provider: "codex" } } }, owner("i2"));
    await tools.call("studio_staffing_interview", { ...base, answers: { worker: { model: "role-model" } } }, owner("i3"));
    await tools.call("studio_staffing_interview", { ...base, answers: { worker: { effort: "high" } } }, owner("i4"));
    const runs = e.list().length; let code = "";
    try { await tools.call("studio_propose_staffing", { ...base, roles: { worker: { provider: "codex", model: "role-model", effort: "high" } } }, owner("p1")); } catch (err: any) { code = String(err?.publicFailure?.code ?? err?.code ?? err?.message); }
    ok(code === "staffing_unverified" && e.list().length === runs, "a proposal whose node override names an unverified model is refused like a role (no proposal card)", code);
    models.add("node-model");
    const proposal: any = await tools.call("studio_propose_staffing", { ...base, roles: { worker: { provider: "codex", model: "role-model", effort: "high" } } }, owner("p2"));
    ok(!!proposal?.proposal && e.list().length === runs + 1, "with the node's model verified, the same proposal goes to the captain's staffing card", JSON.stringify(proposal));
    if (proposal?.proposal) await e.cancel(proposal.proposal, "fixture");
  }

  // ---------- the role-skill one-click approval keeps the node overrides ----------
  const t2 = e.start({ workflow: flow.id, text: "fixture 2", params: { project: project.id, _staffing: c1.hash } });
  await until(() => t2.nodes.wait.waiting === "card");
  text = "# Worker skill, new pack text\n"; // the pack text changes after the task was approved and started
  await e.answer(t2.nodes.wait.card!, { choice: "go", by: "captain" });
  await until(() => t2.nodes.work.waiting === "card" && !e.busy(t2.id));
  const card = e.cards.get(t2.nodes.work.card!)!;
  ok(card?.failure?.code === "env.skill-changed" && card.options.some((o: any) => o.id === "approve-skill"), "a changed role skill still holds the round on the one-click card", JSON.stringify(card?.failure));
  await e.answer(card.id, { choice: "approve-skill", by: "captain" });
  await until(() => ["succeeded", "failed"].includes(t2.status) && !e.busy(t2.id));
  const c2 = staffing.current(project);
  ok(t2.status === "succeeded" && c2.version === c1.version + 1 && JSON.stringify(c2.nodes) === JSON.stringify(nodes) && started.filter((s) => s.node === "work").at(-1)?.model === "node-model",
    "approving the new role skill keeps the node overrides, and the node still runs on its own model", JSON.stringify([t2.status, t2.error, c2.nodes]));

  // ---------- an approval from before node overrides still covers a definition whose nodes only pin skills ----------
  const v2 = e.defs.save(flow.id, { base: def.version, nodes: def.nodes.map((n: any) => n.id === "work" ? { id: n.id, kind: n.kind, label: n.label, role: n.role, mode: n.mode, skills: n.skills, x: n.x, y: n.y } : n) }, "test", "skills only");
  const old = staffing.approve(draft(v2, null, c2.roles.worker), c2.hash, { run: "R-src", card: "SC-3", answerSeq: 4 });
  { let msg = ""; try { e.start({ workflow: flow.id, version: v2.version, text: "x", params: { project: project.id, _staffing: old.hash } }); } catch (err: any) { msg = String(err?.message); }
    ok(msg === "", "an approval without node overrides still covers nodes that only pin skills (bound by the definition hash)", msg); }

  // ---------- a loop node's override, end to end: the coordinator turn runs on its model and effort and loads its skills ----------
  {
    const coordRef = "pack:firstmate/skills/firstmate.md", cur = e.defs.get(flow.id)!;
    const v3 = e.defs.save(flow.id, { base: cur.version, roles: [{ id: "worker", label: "Worker", skill: ref }, { id: "coordinator", label: "Coordinator", skill: coordRef }],
      nodes: [{ id: "start", kind: "hook", label: "Start", do: "set", args: { key: "s", value: 1 }, x: -1, y: 0 }, { id: "build", kind: "agent", label: "Build", role: "worker", mode: "test", checks: [{ use: "t/nat", params: { want: "fail" } }], x: 0, y: 0 },
        { id: "fix", kind: "loop", label: "Fix", args: { producer: "build", coordinator: "coordinator", round_cap: 3 }, model: "loop-model", effort: "medium", skills: [pin], x: 1, y: 1 },
        { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }],
      edges: [{ from: "start", to: "build" }, { from: "build", to: "done", when: "ok" }, { from: "build", to: "fix", when: "fail" }, { from: "fix", to: "build", when: "retry" }, { from: "fix", to: "done", when: "pass|cap|step-back|stalled|report" }] }, "test", "a loop with its own model");
    const prior = staffing.current(project);
    const roles = { worker: prior.roles.worker, coordinator: { provider: "codex" as const, model: "role-model", effort: "high", skill: staffing.remember({ ref: coordRef, version: 1, text }) } };
    const c3 = staffing.approve({ schema: 1, algorithm: "sha256-canonical-v1", project, workflow: { id: v3.id, version: v3.version, sha256: staffingHash(v3) }, roles, review: { freshContexts: 3, distinctProviders: false }, nodes: staffingNodeOverrides(v3) }, prior.hash, { run: "R-src", card: "SC-4", answerSeq: 5 });
    const before = started.length;
    const t3 = e.start({ workflow: flow.id, version: v3.version, text: "loop fixture", params: { project: project.id, _staffing: c3.hash } });
    await until(() => started.slice(before).some((s) => s.node === "fix") || ["succeeded", "failed", "cancelled"].includes(t3.status), 30000);
    const turn = started.slice(before).find((s) => s.node === "fix"), build = started.slice(before).find((s) => s.node === "build");
    ok(turn?.model === "loop-model" && turn.effort === "medium" && turn.system.includes("# Skill: plain-writing (v1)") && build?.model === "role-model" && !build.system.includes("# Skill: plain-writing"),
      "the loop's coordinator turn runs on the loop's model and effort and loads its skill; the producer keeps the worker role's", JSON.stringify([t3.status, t3.error, started.slice(before).map((s) => [s.node, s.model, s.effort])]));
    await until(() => !e.busy(t3.id), 10000);
  }

  // ---------- a role's effort is its nodes' default ----------
  { const r = { id: "R-x", def: { ...def, id: "free", kind: "generic", roles: [{ id: "worker", label: "W", skill: ref, provider: "claude", model: "role-model", effort: "medium" }] }, params: {}, nodes: {}, ctx: {} } as any;
    const p = e.x(r, { id: "n", kind: "agent", label: "N", role: "worker", x: 0, y: 0 } as any, { agent: null } as any).pick();
    ok(p.provider === "claude" && p.model === "role-model" && p.effort === "medium", "a workflow role's effort is the default its nodes run at", JSON.stringify(p)); }
} catch (err: any) { ok(false, "unexpected error", String(err?.stack ?? err).slice(0, 1500)); } finally { for (const x of e.list()) if (!["succeeded", "failed", "cancelled"].includes(x.status)) await e.cancel(x.id, "fixture cleanup"); h.stop(); }
end();
