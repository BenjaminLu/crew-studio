import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// A project's own crew on top of the Studio team (docs/design/crew-seats.md, "only this project"):
//   - precedence: run override > workflow override > the node's definition > project override > team seat
//   - a project override changes a seat's member (model, effort, skills) for that project only; back to the team's value is no override
//   - the team rules read the project's members (a reviewer the project put on the maker's model moves, with a note)
//   - the team stays signed, versioned and compare-and-swap; a team without project overrides keeps its hash
//   - a staffed workflow's derived staffing carries the project layer, and the guard re-derives it from the signed team
//   - a Task of any other workflow records the project's crew in its signed ledger
//   - Firstmate reads the project layer and proposes a project change on a captain card (never applies it)
//      bun tests/crew-project.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("crew-project");
const C = await import("../src/domain/crew");
const { StaffingStore, installStaffingGuard, staffingHash } = await import("../src/domain/staffing");
const { installCrewStaffing } = await import("../src/crew-staffing");
const { installCrewGuard } = await import("../src/crew-guard");
const { installCrewTools } = await import("../src/crew-tools");
const { crewView } = await import("../src/crew-routes");
const { bundledText } = await import("../src/bundled");
const pinOf = (id: string) => ({ id, v: 1, sha256: createHash("sha256").update(readFileSync(join(import.meta.dir, "..", `packs/core/skills/${id}/SKILL.md`), "utf8")).digest("hex") });
const member = (provider: "codex" | "claude", model: string, effort: string | null, skills: any[] = []) => ({ provider, model, effort, skills });
const team = (): any => ({ schema: 1, members: { coordinator: member("claude", "opus-5.5", "high"), maker: member("codex", "gpt-6.1-sol", "medium"),
  "alt-maker": member("claude", "sonnet-5.5", "medium"), reviewer: member("claude", "opus-5.5", "high"), "design-reviewer": member("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} });
const flow = (): any => ({ id: "fixture-web", name: "Fixture web", kind: "web", version: 1, params: { project: { label: "Project", default: "" } },
  roles: [{ id: "designer", label: "Designer", skill: "bundled:x", seat: "maker" }, { id: "judge", label: "Judge", skill: "bundled:y", seat: "reviewer" }],
  nodes: [{ id: "a", kind: "agent", label: "A", role: "designer", mode: "test", x: 0, y: 0 }, { id: "b", kind: "agent", label: "B", role: "designer", seat: "alt-maker", effort: "low", mode: "test", x: 1, y: 0 },
    { id: "check", kind: "agent", label: "Check", role: "judge", mode: "test", x: 2, y: 0 }],
  edges: [["a", "b"], ["b", "check"]] });
const at = (r: any, n: string) => r.nodes.find((x: any) => x.node === n);
try {
  // ---------- precedence and the change ----------
  {
    const def = flow(), t = team();
    const p = C.applyChange(t, { kind: "project", project: "shop", seat: "maker", set: { model: "gpt-7-shop", effort: "high" } } as any);
    ok(!t.projects && (p as any).projects?.shop?.seats?.maker?.model === "gpt-7-shop", "a project change is kept on the team, for that project only", JSON.stringify((p as any).projects));
    const here = C.resolveCrew(p, def, {}, null, "shop" as any), elsewhere = C.resolveCrew(p, def, {}, null, "other" as any), none = C.resolveCrew(p, def);
    ok(at(here, "a").model === "gpt-7-shop" && at(here, "a").effort === "high" && at(here, "a").fields.model === "project" && at(here, "a").source === "project", "in that project the seat's nodes run the project's member", JSON.stringify(at(here, "a")));
    ok(at(elsewhere, "a").model === "gpt-6.1-sol" && at(none, "a").model === "gpt-6.1-sol" && at(none, "a").source === "team", "every other project, and no project, follow the team");
    const pb = C.applyChange(p, { kind: "project", project: "shop", seat: "alt-maker", set: { effort: "xhigh" } } as any);
    ok(at(C.resolveCrew(pb, def, {}, null, "shop" as any), "b").effort === "low" && at(C.resolveCrew(pb, def, {}, null, "shop" as any), "b").fields.effort === "definition", "the node's own definition wins over the project");
    const wf = C.applyChange(p, { kind: "node", workflow: def.id, node: "a", set: { effort: "low" } }, def);
    ok(at(C.resolveCrew(wf, def, {}, null, "shop" as any), "a").effort === "low" && at(C.resolveCrew(wf, def, {}, null, "shop" as any), "a").model === "gpt-7-shop", "a workflow override wins over the project; the project's model still applies");
    ok(at(C.resolveCrew(wf, def, { a: { effort: "xhigh" } }, null, "shop" as any), "a").effort === "xhigh", "a run override wins over everything");
    const back = C.applyChange(p, { kind: "project", project: "shop", seat: "maker", set: { provider: "codex", model: "gpt-6.1-sol", effort: "medium" } } as any);
    ok(!(back as any).projects, "back to the team's values is no project override at all", JSON.stringify((back as any).projects));
    const restored = C.applyChange(pb, { kind: "project-restore", project: "shop" } as any);
    ok(!(restored as any).projects, "restore drops every override of the project");
    let refused = ""; try { const t2 = team(); delete t2.members["design-reviewer"]; C.applyChange(t2, { kind: "project", project: "shop", seat: "design-reviewer", set: { provider: "codex", model: "x", effort: "low" } } as any); } catch (e: any) { refused = e.message; }
    ok(/fill it for the whole team first/.test(refused), "a project changes a seat the team fills; it never fills an empty one", refused);
    const same = C.applyChange(t, { kind: "project", project: "shop", seat: "reviewer", set: { provider: "codex", model: "gpt-6.1-sol" } } as any);
    const chk = at(C.resolveCrew(same, def, {}, null, "shop" as any), "check");
    ok(chk.model !== "gpt-6.1-sol" && chk.notes.some((n: any) => /same model as Maker/.test(n.en)), "the rules read the project's members: its reviewer leaves the maker's model, with a note", JSON.stringify(chk));
    const impact = C.changeImpact(t, p, [def], "shop" as any), wide = C.changeImpact(t, p, [def]);
    ok(impact.map((x) => x.node).join() === "a" && wide.length === 0, "a project change reaches that project's nodes only", JSON.stringify({ impact, wide }));
    // "only this project" counts per field, like the member's count: a node whose model its definition pins is not reached
    { const pinned = { ...def, id: "fixture-pinned", nodes: [{ id: "n1", kind: "agent", label: "N1", role: "designer", provider: "codex", model: "pinned-x", mode: "test", x: 0, y: 0 }, { id: "n2", kind: "agent", label: "N2", role: "designer", mode: "test", x: 1, y: 0 }], edges: [] };
      ok((C as any).projectUses(p, "maker", [pinned], "shop", "model").length === 1 && (C as any).projectUses(p, "maker", [pinned], "shop", "effort").length === 2, "only this project counts the nodes each field reaches"); }
    // a project never leaves a seat without the capability it needs
    { const img = team(); img.seats["image-maker"] = { id: "image-maker", label: "Image maker", labelZh: "圖像產出", needs: ["image-generation"] }; img.members["image-maker"] = member("codex", "gpt-image-2", "low");
      let refused = ""; try { C.applyChange(img, { kind: "project", project: "shop", seat: "image-maker", set: { provider: "claude", model: "opus-5.5" } } as any); } catch (e: any) { refused = e.message; }
      ok(/cannot generate images, which this seat needs/.test(refused), "a project change that leaves the image maker unable to generate images is refused", refused); }
    ok(C.seatUses(p, "maker", [def], "model", "shop" as any).length === 0 && C.seatUses(p, "maker", [def], "model").length === 1 && C.seatUses(p, "maker", [def], undefined, "shop" as any).length === 1, "in the project, a member's model change skips the nodes whose model the project set itself");
  }
  // ---------- the store ----------
  {
    const data = checkedTempDir("crew-project-store-"), store = new C.CrewStore(data);
    const v1 = store.write(team(), null, { by: "captain", via: "page" });
    ok(v1.hash === staffingHash({ ...team(), version: 1, previous: null, approval: { by: "captain", via: "page" } }) && !("projects" in C.teamBody(v1)), "a team with no project overrides keeps the hash it always had");
    const v2 = store.write(C.applyChange(C.teamBody(v1), { kind: "project", project: "shop", seat: "maker", set: { effort: "xhigh" } } as any), v1.hash, { by: "captain", via: "page" });
    ok((store.current() as any).projects?.shop?.seats?.maker?.effort === "xhigh" && store.byHash(v2.hash)?.version === 2, "a project override is signed and versioned with the team");
    let refused = ""; try { store.write(C.applyChange(C.teamBody(v1), { kind: "project", project: "shop", seat: "maker", set: { effort: "low" } } as any), v1.hash, { by: "captain", via: "page" }); } catch (e: any) { refused = e.message; }
    ok(/changed since you looked/.test(refused), "a project change from a stale view is refused (compare-and-swap)", refused);
  }
  // ---------- a staffed workflow: the project's derived staffing carries its layer ----------
  {
    const h = await harness([bundledText("packs/firstmate/workflows/code-firstmate.wf.yaml")!], { data: checkedTempDir("crew-project-staffed-") }), e = h.engine;
    try {
      const staffing = new StaffingStore(h.data), crew = new C.CrewStore(h.data), cs = installCrewStaffing(e, staffing, crew);
      const shop = { namespace: "git" as const, id: "shop", identity: "local-shop" }, other = { namespace: "git" as const, id: "other", identity: "local-other" };
      let project = shop; const guard = installStaffingGuard(e, staffing, (id) => id === "shop" ? shop : other, undefined, (d, c) => cs.verify(d, c));
      const def = e.defs.get("code-firstmate")!;
      const t = team(); t.members.maker.skills = [pinOf("plain-writing")];
      const v1 = crew.write(t, null, { by: "captain", via: "page" });
      crew.write(C.applyChange(C.teamBody(v1), { kind: "project", project: "shop", seat: "maker", set: { model: "gpt-7-shop" } } as any), v1.hash, { by: "captain", via: "page" });
      const s = cs.ensure(def, shop)!, o = cs.ensure(def, other)!;
      ok(s.roles.worker.model === "gpt-7-shop" && o.roles.worker.model === "gpt-6.1-sol", "the project's staffing is derived with its own layer; another project's is not", JSON.stringify({ shop: s.roles.worker.model, other: o.roles.worker.model }));
      ok((guard.verified(def, { project: "shop", _staffing: s.hash }) as any).hash === s.hash && (guard.verified(def, { project: "other", _staffing: o.hash }) as any).hash === o.hash, "the guard re-derives each from the signed team, project layer included");
      // a version derived for another project, presented as this one's: refused
      { const { version, previous, approval, hash, signature, ...body } = structuredClone(o) as any; body.project = shop;
        const forged = staffing.approve(body, s.hash, { run: "crew-page", card: "x", answerSeq: 1 });
        let refused = ""; try { guard.verified(def, { project: "shop", _staffing: forged.hash }); } catch (err: any) { refused = err.message; }
        ok(/differs from what that team gives/.test(refused), "staffing without the project's layer is refused for that project", refused); }
      void project;
    } finally { h.stop(); }
  }
  // ---------- a Task of another workflow records the project's crew; Firstmate reads and proposes ----------
  {
    const H = await harness([bundledText("workflows/v2/crew-change.wf.yaml")!, Y(flow())], { data: checkedTempDir("crew-project-rt-") }), E = H.engine;
    try {
      const store = new C.CrewStore(H.data); installCrewGuard(E, store);
      const v1 = store.write(team(), null, { by: "captain", via: "page" });
      store.write(C.applyChange(C.teamBody(v1), { kind: "project", project: "shop", seat: "maker", set: { model: "gpt-7-shop" } } as any), v1.hash, { by: "captain", via: "page" });
      const run = E.start({ workflow: "fixture-web", text: "two designs", params: { project: "shop" } });
      const rec = E.trusted(run.id).entries.find((x) => x.record === "crew-resolved")?.data as any;
      ok(rec?.project === "shop" && rec.nodes.a.model === "gpt-7-shop" && rec.nodes.a.source === "project", "the Task's signed ledger records the project's crew and the project", JSON.stringify(rec?.nodes?.a));
      const plain = E.start({ workflow: "fixture-web", text: "elsewhere" });
      ok((E.trusted(plain.id).entries.find((x) => x.record === "crew-resolved")?.data as any)?.nodes.a.model === "gpt-6.1-sol", "a Task without that project follows the team");
      const crew = installCrewTools(E, store, { facts: async () => [] as any });
      const captain = (key: string) => ({ key, captain: true, text: "please", live: () => true });
      let r: any = await crew.call("studio_crew_assignments", {}, captain("r1"));
      ok(r.team?.projects?.some((p: any) => p.project === "shop" && p.seats.maker.model === "gpt-7-shop"), "Firstmate reads the project layer", JSON.stringify(r.team?.projects));
      r = await crew.call("studio_crew_assignments", { workflow: "fixture-web", project: "shop" }, captain("r2"));
      ok(r.workflow.nodes.find((n: any) => n.node === "a").model === "gpt-7-shop" && r.workflow.nodes.find((n: any) => n.node === "a").source === "project" && r.project === "shop", "and one workflow's crew in that project", JSON.stringify(r.workflow?.nodes));
      const before = store.current()!.hash;
      const p: any = await crew.call("studio_propose_crew_change", { change: { kind: "project", project: "shop", seat: "maker", set: { effort: "xhigh" } } }, captain("p1"));
      await until(() => E.cards.list({ run: p.proposal, open: true }).length > 0);
      const card = E.cards.list({ run: p.proposal, open: true })[0];
      ok(store.current()!.hash === before && card.captainOnly && /only in project shop/.test(card.title.en) && /只在專案 shop/.test(card.title["zh-TW"]) && /fixture-web · A/.test(card.body), "proposing a project change opens one captain card and changes nothing", card?.title.en);
      await E.answer(card.id, { choice: "approve", by: "captain" });
      await until(() => E.get(p.proposal)!.status === "succeeded");
      ok((store.current() as any).projects?.shop?.seats?.maker?.effort === "xhigh" && store.current()!.approval.run === p.proposal, "the captain's approval writes the project override", JSON.stringify((store.current() as any).projects));
      // the Crew page's view for one project
      const view: any = crewView({ defs: H.defs as any, store, facts: () => [], library: () => [], projects: () => [{ id: "shop", name: "Shop" }] } as any, "shop");
      ok(view.seats.find((s: any) => s.id === "maker").usesProjectEffort === 1 && view.seats.find((s: any) => s.id === "maker").usesProjectModel === 1, "the page's project counts are per field", JSON.stringify(view.seats.find((s: any) => s.id === "maker")));
      ok(await crew.seatGate(E.defs.get("fixture-web"), { key: "g1" }, "shop") === undefined, "the seat gate reads the work's project (a covered project raises nothing)");
      ok(view.project === "shop" && view.projects.some((x: any) => x.id === "shop") && view.workflows.find((w: any) => w.id === "fixture-web").nodes.find((n: any) => n.node === "a").source === "project", "the Crew page shows a project's crew and lists the projects", JSON.stringify({ project: view.project, projects: view.projects }));
    } finally { for (const x of E.list()) if (!["failed", "cancelled", "succeeded"].includes(x.status)) { try { await E.cancel(x.id); } catch {} } H.stop(); }
  }
} catch (e: any) { ok(false, "crew-project threw", e?.stack ?? String(e)); }
end();
