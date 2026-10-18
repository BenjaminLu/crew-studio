import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Seeding the Studio team from approved staffing (docs/design/crew-seats.md), on a copy of a fixture data folder only:
//   - the most recent approved code-firstmate staffing gives the members (worker → maker, reviewer, designer → design-reviewer)
//   - the second maker takes an approved pick on another model than the maker's
//   - another workflow whose approved picks differ becomes that workflow's overrides; a declared specialist seat takes its role's pick
//   - running it again changes nothing (idempotent); an approval that does not verify seeds nothing; the fixture itself is never written
//   - the image-maker seat takes the image pick Studio used before the team (the Codex image adapter's configured model) when no
//     approved image worker fills it; a team seeded without one gets it once as the next signed version (shaped like the live team);
//     a pick that cannot generate images, or none, fills nothing and Studio raises the seat card at startup
//      bun tests/crew-migrate.ts
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { suite, until } from "./rt-harness";
const { ok, end } = suite("crew-migrate");
const { StaffingStore, staffingHash } = await import("../src/domain/staffing");
const { WorkflowDefs } = await import("../src/runtime/defs");
const { bundledText } = await import("../src/bundled");
const { migrateCrew } = await import("../src/crew-migrate");
const { CrewStore, resolveCrew, teamBody } = await import("../src/domain/crew");
try {
  const fixture = checkedTempDir("crew-migrate-fixture-");
  const defs = new WorkflowDefs(fixture, () => [bundledText("packs/firstmate/workflows/code-firstmate.wf.yaml")!, bundledText("workflows/v2/github-review.wf.yaml")!, bundledText("workflows/v2/coffee-kit.wf.yaml")!]);
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
  approve("coffee-kit", "cafe", { worker: ["codex", "gpt-6.1-sol", "medium"], "image-worker": ["codex", "gpt-image-fixture", "medium"], reviewer: ["claude", "opus-5.5", "high"], designer: ["codex", "gpt-6-astra", "medium"] }, "R-6", 2500);
  approve("github-review", "lib", { coordinator: ["claude", "opus-5.5", "high"], worker: ["claude", "sonnet-5.5", "high"], reviewer: ["claude", "opus-5.5", "high"], designer: ["codex", "gpt-6-astra", "medium"] }, "R-5", 2000);
  // a copy of the fixture: migration runs on the copy only
  const data = checkedTempDir("crew-migrate-copy-"); cpSync(fixture, data, { recursive: true });
  const before = readdirSync(fixture).sort().join();
  const m1 = migrateCrew(data, defs);
  const team = new CrewStore(data).current()!;
  ok(m1.status === "seeded" && m1.from?.project === "shop" && team.approval.via === "migration" && team.approval.run === undefined && team.approval.card === undefined, "the most recent approved code-firstmate staffing seeds the team", JSON.stringify(m1));
  ok(team.members.maker.model === "gpt-6.1-sol" && team.members.reviewer.model === "opus-5.5" && team.members["design-reviewer"].model === "gpt-6-astra" && team.members.coordinator.provider === "claude", "roles become seats: worker → maker, reviewer, designer → design-reviewer, coordinator", JSON.stringify(team.members));
  ok(team.members["alt-maker"].model !== team.members.maker.model, "the second maker is on another model than the maker", team.members["alt-maker"].model);
  const gr = team.workflows["github-review"]?.nodes ?? {};
  ok(gr.build?.model === "sonnet-5.5" && gr.plan?.model === "sonnet-5.5" && gr.build?.provider === "claude" && !gr.review, "github-review's differing worker pick becomes overrides on its worker nodes only", JSON.stringify(gr));
  const res = resolveCrew(teamBody(team), defs.get("github-review"));
  ok(res.nodes.find((n) => n.node === "build")!.model === "sonnet-5.5" && res.nodes.find((n) => n.node === "build")!.source === "workflow", "the team gives github-review what was approved for it");
  ok(team.seats["image-maker"]?.needs?.includes("image-generation") && team.members["image-maker"]?.model === "gpt-image-fixture", "coffee's approved image worker fills the image-maker specialist seat", JSON.stringify(team.seats));
  const m2 = migrateCrew(data, defs);
  ok(m2.status === "exists" && new CrewStore(data).current()!.version === 1, "a second run changes nothing (idempotent)");
  ok(!existsSync(join(fixture, "crew")) && readdirSync(fixture).sort().join() === before, "the fixture itself is never written");
  // an approval that does not verify seeds nothing
  const tampered = checkedTempDir("crew-migrate-tampered-"); cpSync(fixture, tampered, { recursive: true });
  for (const d of readdirSync(join(tampered, "projects"))) { const f = join(tampered, "projects", d, "staffing", "v1.json"); const c = JSON.parse(readFileSync(f, "utf8")); c.roles.worker.model = "tampered"; writeFileSync(f, JSON.stringify(c)); }
  ok(migrateCrew(tampered, defs).status === "nothing" && !new CrewStore(tampered).exists(), "approvals that do not verify seed nothing");
  ok(migrateCrew(checkedTempDir("crew-migrate-empty-"), defs).status === "nothing", "a Studio with no approved staffing gets no team");
  // ---------- the image maker from the pre-team image pick (a Studio shaped like the live one: code-firstmate staffing only) ----------
  const liveFixture = checkedTempDir("crew-migrate-live-");
  {
    const ls = new StaffingStore(liveFixture), ldefs = new WorkflowDefs(liveFixture, () => [bundledText("packs/firstmate/workflows/code-firstmate.wf.yaml")!, bundledText("workflows/v2/images.wf.yaml")!]);
    const def = ldefs.get("code-firstmate")!, p = { namespace: "git" as const, id: "hello", identity: "local-hello" };
    const picks: Record<string, [string, string | null]> = { coordinator: ["gpt-6.1-sol", "low"], worker: ["gpt-6.1-sol", "low"], reviewer: ["gpt-6-astra", "medium"], designer: ["gpt-6-astra", "medium"] };
    const roles = Object.fromEntries(def.roles.map((r: any) => [r.id, { provider: "codex", model: picks[r.id][0], effort: picks[r.id][1], skill: ls.remember({ ref: r.skill, version: 1, text: `# ${r.skill}\n` }) }]));
    ls.approve({ schema: 1, algorithm: "sha256-canonical-v1", project: p, workflow: { id: def.id, version: def.version, sha256: staffingHash(def) }, roles, review: { freshContexts: 3, distinctProviders: false } } as any, null, { run: "R-2", card: "SC-1", answerSeq: 1 });
    const pick = () => ({ provider: "codex" as const, model: "gpt-6.1-sol", effort: null });
    const copy = (tag: string) => { const d = checkedTempDir(`crew-migrate-live-${tag}-`); cpSync(liveFixture, d, { recursive: true }); return d; };
    const fresh = copy("fresh"), f1 = migrateCrew(fresh, ldefs, { imagePick: pick }), ft = new CrewStore(fresh).current()!;
    ok(f1.status === "seeded" && f1.image === "seeded" && ft.version === 1 && ft.members["image-maker"]?.model === "gpt-6.1-sol" && ft.members["image-maker"].effort === "medium" && ft.seats["image-maker"]?.needs?.includes("image-generation") && ft.approval.by === "migration",
      "a fresh team's image maker is Studio's configured image model (no approved image worker), in the same signed migration version", JSON.stringify({ f1, m: ft.members["image-maker"] }));
    ok(resolveCrew(teamBody(ft), ldefs.get("images")).missing.length === 0, "Images Tasks are no longer refused for a missing seat");
    // the live shape: a team seeded before the image maker was (five members, no image-maker)
    const old = copy("old"); migrateCrew(old, ldefs); const v1 = new CrewStore(old).current()!;
    ok(v1.version === 1 && !v1.members["image-maker"] && Object.keys(v1.members).sort().join() === "alt-maker,coordinator,design-reviewer,maker,reviewer", "the fixture team is shaped like the live one (no image maker)", Object.keys(v1.members).join());
    const o1 = migrateCrew(old, ldefs, { imagePick: pick }), v2 = new CrewStore(old).current()!;
    ok(o1.image === "seeded" && v2.version === 2 && v2.previous === v1.hash && v2.approval.by === "migration" && v2.approval.via === "migration" && v2.members["image-maker"]?.model === "gpt-6.1-sol" && v2.members.maker.model === v1.members.maker.model,
      "an existing team without an image maker gets it once as the next signed version (team v+1, by migration)", JSON.stringify(o1));
    const o2 = migrateCrew(old, ldefs, { imagePick: () => ({ provider: "codex", model: "gpt-other", effort: "high" }) });
    ok(o2.status === "exists" && !o2.image && new CrewStore(old).current()!.version === 2, "running it again changes nothing (idempotent)");
    for (const [name, p2] of [["none", () => null], ["claude", () => ({ provider: "claude" as const, model: "opus-5.5", effort: null })]] as const) {
      const d = copy(name); migrateCrew(d, ldefs); const r = migrateCrew(d, ldefs, { imagePick: p2 as any }), t = new CrewStore(d).current()!;
      ok(r.image === "unfilled" && t.version === 1 && !t.members["image-maker"], `no pick that can generate images (${name}) fills nothing and reports the seat unfilled`, JSON.stringify(r));
    }
    ok(!existsSync(join(liveFixture, "crew")), "the live-shaped fixture itself is never written");
    // at startup: an unfilled image seat raises its seat card (never a silent block); a configured image model fills it
    process.env.CREW_TEST_IN_PROCESS = "1";
    const { createRuntime } = await import("../src/runtime"), { Agents } = await import("../src/agent"), { ArtifactStore } = await import("../src/artifacts"), { StudioLog } = await import("../src/rawlog");
    const boot = (data: string, coffeeChoice?: any): any => createRuntime({ dataDir: data, agents: new Agents(data, () => ""), provider: () => { throw new Error("No language provider in migrate fixture"); }, defaultProvider: () => ({ provider: "stub", model: null }),
      log: new StudioLog(join(data, "events")), send() {}, fmRoot: join(data, "fm"), protectedRoots: [], m3: { store: new ArtifactStore(data), lane: {} } as any, fileorg: {} as any, docs: {} as any, readiness: false, coffeeChoice } as any);
    const cancelAll = async (E: any) => { for (const x of E.list()) if (!["failed", "cancelled", "succeeded"].includes(x.status)) { try { await E.cancel(x.id); } catch {} } };
    const unf = copy("card"); migrateCrew(unf, ldefs);
    const E = boot(unf).engine, seatRun = () => E.list().find((x: any) => x.workflow === "crew-change" && /^seat/.test(x.params.reason));
    await until(() => !!seatRun());
    ok(JSON.parse(seatRun()?.params.context ?? "{}").seat?.id === "image-maker", "an unfilled image seat raises its seat card at startup", JSON.stringify(seatRun()?.params ?? null));
    await cancelAll(E);
    const seeded = copy("boot"); migrateCrew(seeded, ldefs);
    const E2 = boot(seeded, () => ({ provider: "codex", model: "gpt-6.1-sol", effort: "medium" })).engine;
    ok(new CrewStore(seeded).current()!.members["image-maker"]?.model === "gpt-6.1-sol" && !E2.list().some((x: any) => x.workflow === "crew-change"), "at startup the image maker is seeded from Studio's configured image model, with no card");
    await cancelAll(E2);
  }
} catch (e: any) { ok(false, "crew-migrate threw", e?.stack ?? String(e)); }
end();
