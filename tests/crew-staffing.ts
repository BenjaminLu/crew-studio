import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// A staffed workflow (code-firstmate) on the Studio team (docs/design/crew-seats.md):
//   - when the team fills every seat, the project's signed staffing is derived from it: no per-project staffing card
//   - roles take their seat's member; a node on another seat, or with member skills, gets a node override with those pins
//   - the staffing guard re-derives a crew-derived version from its own signed team version and refuses any difference
//   - a team edit writes a new version on the next start; a Task bound to the earlier one keeps running on it
//   - a workflow upgrade with the same roles derives the new version without a keep-crew card, carrying overrides
//   - a new project identity (a GitHub connect) gets its own derived staffing instead of an orphaned approval
//   - with no team, nothing changes: the per-project flow applies
//      bun tests/crew-staffing.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite } from "./rt-harness";
const { ok, end } = suite("crew-staffing");
const { StaffingStore, installStaffingGuard, staffingHash } = await import("../src/domain/staffing");
const C = await import("../src/domain/crew");
const { installCrewStaffing } = await import("../src/crew-staffing");
const { installFirstmateStaffing } = await import("../src/firstmate-staffing");
const { bundledText } = await import("../src/bundled");
const { parseYaml } = await import("../src/bundled");
const pinOf = (id: string) => ({ id, v: 1, sha256: createHash("sha256").update(readFileSync(join(import.meta.dir, "..", `packs/core/skills/${id}/SKILL.md`), "utf8")).digest("hex") });
const src = bundledText("packs/firstmate/workflows/code-firstmate.wf.yaml")!;
const v2 = (() => { const d: any = parseYaml(src); d.description = (d.description ?? "") + " (v2 fixture)"; d.nodes.find((n: any) => n.id === "build").timeout_s = 1234; return JSON.stringify(d); })();
const member = (provider: "codex" | "claude", model: string, effort: string | null, skills: any[] = []) => ({ provider, model, effort, skills });
const h = await harness([src], { data: checkedTempDir("crew-staffing-") }), e = h.engine;
try {
  const staffing = new StaffingStore(h.data), crew = new C.CrewStore(h.data);
  let project = { namespace: "git" as const, id: "shop", identity: "local-shop" };
  const cs = installCrewStaffing(e, staffing, crew);
  const guard = installStaffingGuard(e, staffing, () => project, undefined, (def, config) => cs.verify(def, config));
  const def = e.defs.get("code-firstmate")!;
  ok(cs.ensure(def, project) === null, "no team: nothing is derived (the per-project staffing flow applies)");
  const team: any = { schema: 1, members: { coordinator: member("claude", "opus-5.5", "high"), maker: member("codex", "gpt-6.1-sol", "medium", [pinOf("plain-writing")]),
    "alt-maker": member("claude", "sonnet-5.5", "medium"), reviewer: member("claude", "opus-5.5", "high", [pinOf("code-review")]), "design-reviewer": member("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} };
  const partial = structuredClone(team); delete partial.members["design-reviewer"];
  const t0 = crew.write(partial, null, { by: "captain", via: "page" });
  ok(cs.ensure(def, project) === null && cs.coverage(def).missing.join() === "design-reviewer", "a team that leaves a seat this workflow needs empty derives nothing and names the seat");
  const t1 = crew.write(team, t0.hash, { by: "captain", via: "page" });
  const c1 = cs.ensure(def, project)!;
  ok(c1?.crew?.team === t1.hash && c1.roles.worker.model === "gpt-6.1-sol" && c1.roles.reviewer.model === "opus-5.5" && c1.roles.designer.model === "gpt-6-astra" && c1.roles.coordinator.provider === "claude",
    "the team covers code-firstmate: the project's staffing is derived (roles take their seats' members)", JSON.stringify(c1?.roles && Object.fromEntries(Object.entries(c1.roles).map(([k, r]: any) => [k, r.model]))));
  ok(c1.approval.run === "crew-page" && c1.approval.card === `crew-team-v${t1.version}-${t1.hash.slice(0, 12)}` && c1.version === 1, "a team changed on the Crew page: the derived version cites that team version, no card", JSON.stringify(c1.approval));
  ok(c1.nodes?.build?.skills?.map((p: any) => p.ref).join() === "skill:plain-writing,skill:fail-first-testing,skill:commit-and-pr-text" && c1.nodes?.review?.skills?.map((p: any) => p.ref).join() === "skill:code-review,skill:security-review,skill:fail-first-testing,skill:plain-writing", "member skills reach their nodes as pinned node skills, before the node's own duty skills (a skill both name once)", JSON.stringify(c1.nodes));
  ok(cs.ensure(def, project)!.hash === c1.hash, "deriving again with nothing changed writes nothing");
  ok((guard.verified(def, { project: "shop", _staffing: c1.hash }) as any).hash === c1.hash, "the staffing guard accepts the derived version (it re-derives it from the signed team)");
  // a forged crew-derived version: the right team, another model
  { const { version, previous, approval, hash, signature, ...body } = structuredClone(c1) as any; body.roles.worker.model = "forged-model";
    const forged = staffing.approve(body, c1.hash, { run: "crew-v2", card: "x", answerSeq: 1 });
    let refused = ""; try { guard.verified(def, { project: "shop", _staffing: forged.hash }); } catch (err: any) { refused = err.message; }
    ok(/differs from what that team gives/.test(refused), "a crew-derived version the team does not give is refused", refused);
    // put the honest one back as current (a new derived version)
  }
  const c2 = cs.ensure(def, project)!;
  ok(c2.hash !== c1.hash && c2.crew?.team === t1.hash && c2.roles.worker.model === "gpt-6.1-sol", "the next start replaces it with what the team gives");
  // a team edit: the next start derives a new version; a Task bound to the earlier one keeps it
  const t2 = crew.write(C.applyChange(C.teamBody(t1), { kind: "node", workflow: "code-firstmate", node: "review", set: { effort: "xhigh" } }, def), t1.hash, { by: "captain", via: "page" });
  const c3 = cs.ensure(def, project)!;
  ok(c3.crew?.team === t2.hash && c3.nodes?.review?.effort === "xhigh" && c3.roles.reviewer.effort === "high", "only this workflow's review node runs at xhigh: a node override in the derived staffing", JSON.stringify(c3.nodes?.review));
  ok((guard.verified(def, { project: "shop", _staffing: c2.hash }) as any).hash === c2.hash, "a Task bound to the earlier derived version keeps running on it");
  // a workflow upgrade, same roles: derived without a keep-crew card, the override carried
  const defs2 = h.defs as any; defs2.bundled = () => [v2]; defs2.seed();
  const def2 = e.defs.get("code-firstmate")!;
  ok(def2.version === 2, "the fixture upgrades code-firstmate to v2");
  const c4 = cs.ensure(def2, project)!;
  ok(c4.workflow.version === 2 && c4.nodes?.review?.effort === "xhigh" && (guard.verified(def2, { project: "shop", _staffing: c4.hash }) as any).hash === c4.hash, "the upgrade is staffed from the team with the override carried, and verifies: no keep-crew card");
  // the project is connected to GitHub: a new identity gets its own derived staffing (H2/H3: no orphaned approval)
  project = { namespace: "git", id: "shop", identity: "github:acme/shop" };
  const c5 = cs.ensure(def2, project)!;
  ok(c5.project.identity === "github:acme/shop" && c5.version === 1 && (guard.verified(def2, { project: "shop", _staffing: c5.hash }) as any).hash === c5.hash, "a new project identity gets the team's staffing at once");
  ok(staffingHash(c5.roles.worker.model) === staffingHash("gpt-6.1-sol"), "with the same crew");
  // a project's own approval made before crew seats: kept while the team is only the seeded one, replaced once the captain changes the team
  { const legacy = { namespace: "git" as const, id: "legacy", identity: "local-legacy" };
    const { version, previous, approval, hash, signature, crew: _c, ...body } = structuredClone(cs.ensure(def2, project)!) as any;
    const own = staffing.approve({ ...body, project: legacy, roles: { ...body.roles, reviewer: { ...body.roles.reviewer, effort: "low" } } }, null, { run: "R-9", card: "SC-9", answerSeq: 1 });
    const seeded = crew.write(C.teamBody(crew.current()!), crew.current()!.hash, { by: "migration", via: "migration" });
    ok(cs.ensure(def2, legacy)!.hash === own.hash, "a seeded team keeps a project's own still-valid approval: deploying never restaffs it");
    const ownCard = own.approval.card;
    { const viaSeed = (await import("../src/crew-staffing")).crewApproval(seeded);
      ok(viaSeed.card !== ownCard && viaSeed.run === "crew-migration" && viaSeed.card.startsWith(`crew-team-v${seeded.version}-`), "a seeded team's derived staffing cites the seed record, never another project's card", JSON.stringify(viaSeed)); }
    crew.write(C.teamBody(seeded), seeded.hash, { by: "captain", via: "page" });
    ok(cs.ensure(def2, legacy)!.crew?.team === crew.current()!.hash, "once the captain changes the team, that project's staffing comes from the team"); }
  // a team change approved on a crew card: the derived staffing cites that card and its run
  { const viaCard = crew.write(C.teamBody(crew.current()!), crew.current()!.hash, { by: "captain (card)", via: "card", card: "SC-77", run: "R-77", answerSeq: 5 });
    const c = cs.ensure(def2, project)!;
    ok(c.crew?.team === viaCard.hash && c.approval.card === "SC-77" && c.approval.run === "R-77" && c.approval.answerSeq === 5, "a team change approved on a card: the derived staffing cites that card", JSON.stringify(c.approval)); }
  // the old staffing tools map cleanly: the interview says the team staffs it (approved and valid); proposing staffing points to a crew change
  { const facts = [{ provider: "codex", support: "supported", auth: "verified", quota: "available", expires: Date.now() + 200000, models: [{ id: "gpt-6.1-sol", efforts: ["low", "medium", "high", "xhigh"] }, { id: "gpt-6-astra", efforts: ["low", "medium", "high"] }] },
      { provider: "claude", support: "supported", auth: "verified", quota: "available", expires: Date.now() + 200000, models: [{ id: "opus-5.5", efforts: ["low", "medium", "high", "xhigh"] }, { id: "sonnet-5.5", efforts: ["medium", "high"] }] }];
    const tools = installFirstmateStaffing(e, staffing, () => project, async () => facts as any, undefined, undefined, { verified: (d, p) => guard.verified(d, p), capability: () => {} }, (d) => cs.ensure(d, project));
    const owner = { key: "crew-interview", captain: true, text: "use the team", live: () => true };
    const r: any = await tools.call("studio_staffing_interview", { project: "shop", workflow: "code-firstmate", version: 2 }, owner);
    ok(r.team?.staffs === true && r.approved?.valid === true && !r.keepCrew, "the staffing interview says the team staffs this workflow: propose the work directly, no card", JSON.stringify({ team: r.team, approved: r.approved }));
    let refused: any = null; try { await tools.call("studio_propose_staffing", { project: "shop", workflow: "code-firstmate", version: 2, roles: {} }, owner); } catch (err: any) { refused = err; }
    ok(refused?.publicFailure?.code === "crew_team" && /studio_propose_crew_change/.test(refused.message), "proposing per-project staffing points to a crew change instead", refused?.message);
    refused = null; try { await tools.call("studio_keep_staffing", { project: "shop", workflow: "code-firstmate", version: 2 }, owner); } catch (err: any) { refused = err; }
    ok(refused?.publicFailure?.code === "crew_team", "and so does keeping a crew on an upgrade: there is no keep-crew card"); }
} catch (err: any) { ok(false, "crew-staffing threw", err?.stack ?? String(err)); }
h.stop();
end();
