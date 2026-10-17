import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Seeding the Studio team from approved staffing (docs/design/crew-seats.md), on a copy of a fixture data folder only:
//   - the most recent approved code-firstmate staffing gives the members (worker → maker, reviewer, designer → design-reviewer)
//   - the second maker takes an approved pick on another model than the maker's
//   - another workflow whose approved picks differ becomes that workflow's overrides
//   - running it again changes nothing (idempotent); an approval that does not verify seeds nothing; the fixture itself is never written
//      bun tests/crew-migrate.ts
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { suite } from "./rt-harness";
const { ok, end } = suite("crew-migrate");
const { StaffingStore, staffingHash } = await import("../src/domain/staffing");
const { WorkflowDefs } = await import("../src/runtime/defs");
const { bundledText } = await import("../src/bundled");
const { migrateCrew } = await import("../src/crew-migrate");
const { CrewStore, resolveCrew, teamBody } = await import("../src/domain/crew");
try {
  const fixture = checkedTempDir("crew-migrate-fixture-");
  const defs = new WorkflowDefs(fixture, () => [bundledText("packs/firstmate/workflows/code-firstmate.wf.yaml")!, bundledText("workflows/v2/github-review.wf.yaml")!]);
  const store = new StaffingStore(fixture);
  const skill = (ref: string) => store.remember({ ref, version: 1, text: `# ${ref}\n` });
  const approve = (workflow: string, project: string, picks: Record<string, [string, string, string | null]>, run: string, at: number) => {
    const def = defs.get(workflow)!, p = { namespace: "git" as const, id: project, identity: `local-${project}` };
    const roles = Object.fromEntries(def.roles.map((r: any) => [r.id, { provider: picks[r.id][0] as any, model: picks[r.id][1], effort: picks[r.id][2], skill: skill(r.skill) }]));
    const c = store.approve({ schema: 1, algorithm: "sha256-canonical-v1", project: p, workflow: { id: def.id, version: def.version, sha256: staffingHash(def) }, roles, review: { freshContexts: 3, distinctProviders: false } }, null, { run, card: "SC-1", answerSeq: 1 });
    const ptr = join(fixture, "projects", store.key(p), "staffing", "current.json"); utimesSync(ptr, at, at); return c;
  };
  approve("code-firstmate", "old", { coordinator: ["claude", "old-c", null], worker: ["codex", "old-w", "low"], reviewer: ["claude", "old-r", null], designer: ["codex", "old-d", "low"] }, "R-1", 1000);
  approve("code-firstmate", "shop", { coordinator: ["claude", "opus-5.5", "high"], worker: ["codex", "gpt-6.1-sol", "medium"], reviewer: ["claude", "opus-5.5", "high"], designer: ["codex", "gpt-6-astra", "medium"] }, "R-7", 3000);
  approve("github-review", "lib", { coordinator: ["claude", "opus-5.5", "high"], worker: ["claude", "sonnet-5.5", "high"], reviewer: ["claude", "opus-5.5", "high"], designer: ["codex", "gpt-6-astra", "medium"] }, "R-5", 2000);
  // a copy of the fixture: migration runs on the copy only
  const data = checkedTempDir("crew-migrate-copy-"); cpSync(fixture, data, { recursive: true });
  const before = readdirSync(fixture).sort().join();
  const m1 = migrateCrew(data, defs);
  const team = new CrewStore(data).current()!;
  ok(m1.status === "seeded" && m1.from?.project === "shop" && team.approval.via === "migration" && team.approval.run === "R-7", "the most recent approved code-firstmate staffing seeds the team", JSON.stringify(m1));
  ok(team.members.maker.model === "gpt-6.1-sol" && team.members.reviewer.model === "opus-5.5" && team.members["design-reviewer"].model === "gpt-6-astra" && team.members.coordinator.provider === "claude", "roles become seats: worker → maker, reviewer, designer → design-reviewer, coordinator", JSON.stringify(team.members));
  ok(team.members["alt-maker"].model !== team.members.maker.model, "the second maker is on another model than the maker", team.members["alt-maker"].model);
  const gr = team.workflows["github-review"]?.nodes ?? {};
  ok(gr.build?.model === "sonnet-5.5" && gr.plan?.model === "sonnet-5.5" && gr.build?.provider === "claude" && !gr.review, "github-review's differing worker pick becomes overrides on its worker nodes only", JSON.stringify(gr));
  const res = resolveCrew(teamBody(team), defs.get("github-review"));
  ok(res.nodes.find((n) => n.node === "build")!.model === "sonnet-5.5" && res.nodes.find((n) => n.node === "build")!.source === "workflow", "the team gives github-review what was approved for it");
  const m2 = migrateCrew(data, defs);
  ok(m2.status === "exists" && new CrewStore(data).current()!.version === 1, "a second run changes nothing (idempotent)");
  ok(!existsSync(join(fixture, "crew")) && readdirSync(fixture).sort().join() === before, "the fixture itself is never written");
  // an approval that does not verify seeds nothing
  const tampered = checkedTempDir("crew-migrate-tampered-"); cpSync(fixture, tampered, { recursive: true });
  for (const d of readdirSync(join(tampered, "projects"))) { const f = join(tampered, "projects", d, "staffing", "v1.json"); const c = JSON.parse(readFileSync(f, "utf8")); c.roles.worker.model = "tampered"; writeFileSync(f, JSON.stringify(c)); }
  ok(migrateCrew(tampered, defs).status === "nothing" && !new CrewStore(tampered).exists(), "approvals that do not verify seed nothing");
  ok(migrateCrew(checkedTempDir("crew-migrate-empty-"), defs).status === "nothing", "a Studio with no approved staffing gets no team");
} catch (e: any) { ok(false, "crew-migrate threw", e?.stack ?? String(e)); }
end();
