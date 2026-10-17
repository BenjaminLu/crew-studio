import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Crew seats (docs/design/crew-seats.md): one Studio team staffs every workflow's agent nodes.
//   - precedence: run override (effort) > workflow override > the node's definition > team seat
//   - the rules adjust with a visible note, never silently (reviewer ≠ maker's model, alt-maker ≠ maker, reviewers ≥ medium)
//   - a node's skills are its member's skills plus its own (pinned); the team never removes a node skill
//   - "only this workflow" changes one node; "the whole member" changes every node that follows the team
//   - an override carries to a later version while the node keeps its role and kind
//   - the team store is signed, versioned and compare-and-swap; only the captain writes it
//   - a Task records what each node runs (provider, model, effort, skills with pins, source) in its signed ledger, and runs that
//      bun tests/crew-seats.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, Y } from "./rt-harness";
const { ok, end } = suite("crew-seats");
const C = await import("../src/domain/crew");
const { installCrewGuard } = await import("../src/crew-guard");
const pinOf = (id: string, sha = "a") => ({ id, v: 1, sha256: sha.repeat(64).slice(0, 64) });
const member = (provider: "codex" | "claude", model: string, effort: string | null, skills: any[] = []) => ({ provider, model, effort, skills });
const team = (): any => ({ schema: 1, members: { coordinator: member("claude", "opus-5.5", "high"), maker: member("codex", "gpt-6.1-sol", "medium", [pinOf("plain-writing", "b")]),
  "alt-maker": member("claude", "sonnet-5.5", "medium"), reviewer: member("claude", "opus-5.5", "high", [pinOf("code-review", "c")]), "design-reviewer": member("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} });
const flow = (version = 1, over: any = {}) => ({ id: "fixture-web", name: "Fixture web", kind: "web", version,
  roles: [{ id: "designer", label: "Designer", skill: "bundled:x", seat: "maker" }, { id: "judge", label: "Judge", skill: "bundled:y", seat: "reviewer" }],
  nodes: [{ id: "a", kind: "agent", label: "A", role: "designer", mode: "test", skills: [pinOf("web-design", "d")], x: 0, y: 0 },
    { id: "b", kind: "agent", label: "B", role: "designer", seat: "alt-maker", mode: "test", x: 1, y: 0, ...over.b },
    { id: "check", kind: "agent", label: "Check", role: over.checkRole ?? "judge", mode: "test", x: 2, y: 0 }],
  edges: [["a", "b"], ["b", "check"]] });
try {
  // ---------- precedence ----------
  {
    const def = flow(1, { b: { effort: "low" } }), t = team();
    let r = C.resolveCrew(t, def);
    const a = r.nodes.find((n) => n.node === "a")!, b = r.nodes.find((n) => n.node === "b")!;
    ok(a.provider === "codex" && a.model === "gpt-6.1-sol" && a.effort === "medium" && a.source === "team", "a node follows its seat's member", JSON.stringify(a));
    ok(b.seat === "alt-maker" && b.model === "sonnet-5.5" && b.effort === "low" && b.fields.effort === "definition", "the node's own definition wins over the team", JSON.stringify(b));
    const t2 = C.applyChange(t, { kind: "node", workflow: def.id, node: "b", set: { effort: "high" } }, def);
    r = C.resolveCrew(t2, def);
    ok(r.nodes.find((n) => n.node === "b")!.effort === "high" && r.nodes.find((n) => n.node === "b")!.fields.effort === "workflow", "a workflow override wins over the definition");
    r = C.resolveCrew(t2, def, { b: { effort: "xhigh" } });
    ok(r.nodes.find((n) => n.node === "b")!.effort === "xhigh" && r.nodes.find((n) => n.node === "b")!.source === "run", "a run override (effort) wins over the workflow override, for that run only");
    ok(C.resolveCrew(t2, def).nodes.find((n) => n.node === "b")!.effort === "high", "without the run override the workflow override applies again");
    let refused = ""; try { C.parseRunOverride(JSON.stringify({ b: { model: "x" } })); } catch (e: any) { refused = e.message; }
    ok(/unknown field model/.test(refused), "a run override is effort only", refused);
  }
  // ---------- the rules adjust with a note ----------
  {
    const def = flow(), t = team(); t.members.reviewer = member("codex", "gpt-6.1-sol", "low");
    const r = C.resolveCrew(t, def), chk = r.nodes.find((n) => n.node === "check")!;
    ok(chk.model !== "gpt-6.1-sol" && chk.notes.some((n) => /same model as Maker/.test(n.en) && /同一個模型/.test(n.zh)), "a reviewer on the maker's model moves to another team model, with a note", JSON.stringify(chk));
    ok(chk.effort === "medium" && chk.notes.some((n) => /medium effort/.test(n.en)), "a reviewer at low effort runs at medium, with a note", JSON.stringify(chk));
    const t3 = team(); t3.members["alt-maker"] = member("codex", "gpt-6.1-sol", "medium");
    const b = C.resolveCrew(t3, def).nodes.find((n) => n.node === "b")!;
    ok(b.model !== "gpt-6.1-sol" && b.notes.length === 1, "the second maker never runs on the maker's model (A and B differ)", JSON.stringify(b));
    const solo = { schema: 1, members: { maker: member("codex", "m", "medium"), "alt-maker": member("codex", "m", "medium"), reviewer: member("codex", "m", "medium") }, seats: {}, workflows: {} } as any;
    const s = C.resolveCrew(solo, def).nodes.find((n) => n.node === "check")!;
    ok(s.model === "m" && s.notes.some((n) => /not an independent opinion/.test(n.en)), "with no other model the rule says so instead of changing silently", JSON.stringify(s.notes));
  }
  // ---------- skills = member + node ----------
  {
    const def = flow(), t = team();
    const a = C.resolveCrew(t, def).nodes.find((n) => n.node === "a")!;
    ok(JSON.stringify(a.skills.map((p) => `${p.from}:${p.id}`)) === JSON.stringify(["member:plain-writing", "node:web-design"]), "a node carries its member's skills, then its own", JSON.stringify(a.skills));
    const t2 = C.applyChange(t, { kind: "node", workflow: def.id, node: "a", set: {}, removeSkill: "web-design" }, def);
    const t3 = C.applyChange(t2, { kind: "node", workflow: def.id, node: "a", set: {}, addSkill: pinOf("accessible-ui", "e") }, def);
    const a3 = C.resolveCrew(t3, def).nodes.find((n) => n.node === "a")!;
    ok(JSON.stringify(a3.skills.map((p) => p.id)) === JSON.stringify(["plain-writing", "accessible-ui"]) && a3.source === "workflow" && a3.removed[0] === "web-design", "a workflow removes a node skill and adds another", JSON.stringify(a3));
    let refused = ""; try { C.applyChange(t, { kind: "node", workflow: def.id, node: "a", set: {}, removeSkill: "plain-writing" }, def); } catch (e: any) { refused = e.message; }
    ok(/changed on the member/.test(refused), "a member's skill is not removed from one node", refused);
    const t4 = C.applyChange(t, { kind: "member", seat: "maker", set: { skills: [] } }, def);
    ok(C.resolveCrew(t4, def).nodes.find((n) => n.node === "a")!.skills.map((p) => p.id).join() === "web-design", "the team never removes a node's own skill");
  }
  // ---------- scope: only this workflow vs the whole member ----------
  {
    const def = flow(), other = { ...flow(), id: "fixture-doc", nodes: [{ id: "draft", kind: "agent", label: "Draft", role: "designer", mode: "test", x: 0, y: 0 }], edges: [] };
    const t = team();
    const here = C.applyChange(t, { kind: "node", workflow: def.id, node: "a", set: { model: "gpt-6-astra" } }, def);
    const hereImpact = C.changeImpact(t, here, [def, other]);
    ok(hereImpact.length === 1 && hereImpact[0].workflow === "fixture-web" && hereImpact[0].node === "a", "only this workflow: one node changes", JSON.stringify(hereImpact));
    const whole = C.applyChange(here, { kind: "member", seat: "maker", set: { effort: "high" } });
    const wholeImpact = C.changeImpact(here, whole, [def, other]).map((x) => `${x.workflow}/${x.node}`).sort();
    ok(JSON.stringify(wholeImpact) === JSON.stringify(["fixture-doc/draft", "fixture-web/a"]), "the whole member: every maker node, in every workflow", JSON.stringify(wholeImpact));
    ok(C.resolveCrew(whole, def).nodes.find((n) => n.node === "a")!.model === "gpt-6-astra", "the member change keeps the workflow's own model choice");
    const modelWide = C.applyChange(here, { kind: "member", seat: "maker", set: { model: "gpt-7" } });
    ok(C.changeImpact(here, modelWide, [def, other]).map((x) => `${x.workflow}/${x.node}`).join() === "fixture-doc/draft", "a member's model change skips the node this workflow set itself");
    ok(C.seatUses(t, "maker", [def, other]).length === 2, "the scope question counts the member's nodes");
    const restored = C.applyChange(here, { kind: "restore", workflow: def.id });
    ok(!restored.workflows[def.id] && C.crewBadge(C.resolveCrew(restored, def)).state === "team", "restore to team drops the workflow's overrides");
    ok(C.crewBadge(C.resolveCrew(here, def)).state === "custom" && C.crewBadge(C.resolveCrew(here, def)).count === 1, "the card badge counts custom nodes");
  }
  // ---------- carry across versions ----------
  {
    const t = C.applyChange(team(), { kind: "node", workflow: "fixture-web", node: "a", set: { effort: "high" } }, flow(1));
    ok(C.resolveCrew(t, flow(2)).nodes.find((n) => n.node === "a")!.effort === "high", "a workflow override carries to the next version while the node keeps its role");
    const changed = { ...flow(3), nodes: flow(3).nodes.map((n: any) => n.id === "a" ? { ...n, role: "judge" } : n) };
    ok(C.resolveCrew(t, changed).nodes.find((n) => n.node === "a")!.fields.effort !== "workflow", "it is not carried to a node whose role changed");
  }
  // ---------- missing seats and specialists ----------
  {
    const t = team(); delete t.members["alt-maker"];
    const r = C.resolveCrew(t, flow());
    ok(r.missing.join() === "alt-maker" && r.nodes.find((n) => n.node === "b")!.source === "missing" && C.crewBadge(r).state === "missing", "an unfilled seat is reported missing");
    let refused = ""; try { C.applyChange(t, { kind: "member", seat: "music-director", set: { provider: "claude", model: "x", effort: "high" } }); } catch (e: any) { refused = e.message; }
    ok(/not declared/.test(refused), "a member fills only a built-in or declared seat", refused);
    const seat = { id: "music-director", label: "Music director", labelZh: "音樂總監", reviews: "maker", needs: ["audio", "long-context"] };
    const t2 = C.applyChange(t, { kind: "seat", seat, member: member("claude", "opus-5.5", "high") });
    ok(t2.members["music-director"]?.model === "opus-5.5" && t2.seats["music-director"].labelZh === "音樂總監", "a specialist seat is declared and filled together");
    ok(!C.capabilitiesOf("claude", "opus-5.5").includes("audio") && C.capabilitiesOf("codex", "gpt", [{ provider: "codex", models: [{ id: "gpt", tags: ["audio"] }] }]).includes("audio"), "capability tags come from the provider, or the model's own facts");
  }
  // ---------- the store ----------
  {
    const data = checkedTempDir("crew-store-"), store = new C.CrewStore(data);
    ok(store.current() === null, "no team before the first write");
    let refused = ""; try { store.write(team(), null, { by: "firstmate", via: "card" }); } catch (e: any) { refused = e.message; }
    ok(/only the captain/.test(refused), "Firstmate never writes the team", refused);
    const v1 = store.write(team(), null, { by: "captain", via: "page" });
    ok(v1.version === 1 && store.current()!.hash === v1.hash, "the captain writes version 1");
    refused = ""; try { store.write(team(), null, { by: "captain", via: "page" }); } catch (e: any) { refused = e.message; }
    ok(/changed since you looked/.test(refused), "a write from a stale view is refused (compare-and-swap)", refused);
    const v2 = store.write(C.applyChange(team(), { kind: "preset", preset: "quality" }), v1.hash, { by: "captain", via: "page" });
    ok(v2.version === 2 && v2.previous === v1.hash && store.byHash(v1.hash)?.version === 1, "versions chain; an earlier version is still readable by hash");
    const f = join(data, "crew", "v2.json"), raw = JSON.parse(readFileSync(f, "utf8")); raw.members.maker.model = "tampered"; writeFileSync(f, JSON.stringify(raw));
    refused = ""; try { store.current(); } catch (e: any) { refused = e.message; }
    ok(/does not verify/.test(refused), "a tampered team version does not verify", refused);
  }
  // ---------- a Task records and runs its crew ----------
  {
    // real library pins: the built-in library skills' v1 (sha256 of their SKILL.md)
    const p = (id: string) => ({ id, v: 1, sha256: createHash("sha256").update(readFileSync(join(import.meta.dir, "..", `packs/core/skills/${id}/SKILL.md`), "utf8")).digest("hex") });
    const pw = "plain-writing", cr = "code-review", au = "accessible-ui";
    const f = flow(); (f.nodes[0] as any).skills = [p(au)];
    const h = await harness([Y(f)], { data: checkedTempDir("crew-seats-rt-") }), e = h.engine;
    const store = new C.CrewStore(h.data); installCrewGuard(e, store);
    const t = team(); t.members.maker.skills = [p(pw)]; t.members.reviewer.skills = [p(cr)];
    const v1 = store.write(t, null, { by: "captain", via: "page" });
    const run = e.start({ workflow: "fixture-web", text: "two designs", params: { _crewRun: JSON.stringify({ a: { effort: "high" } }) } });
    const rec = e.trusted(run.id).entries.find((x) => x.record === "crew-resolved")?.data as any;
    ok(rec?.team === v1.hash && rec.nodes.a.provider === "codex" && rec.nodes.a.effort === "high" && rec.nodes.a.source === "run" && rec.nodes.b.model === "sonnet-5.5", "the Task's signed ledger records each node's provider, model, effort and source", JSON.stringify(rec?.nodes));
    ok(JSON.stringify(rec.nodes.a.skills) === JSON.stringify([{ ...p(pw), from: "member" }, { ...p(au), from: "node" }]), "the record pins the member's and the node's skills", JSON.stringify(rec.nodes.a.skills));
    const x = (id: string) => e.x(run, run.def.nodes.find((n: any) => n.id === id)!, run.nodes[id]);
    ok(x("a").pick().model === "gpt-6.1-sol" && x("b").pick().model === "sonnet-5.5", "design A and design B run on different models");
    ok(JSON.stringify(e.nodePins(run, run.def.nodes[0] as any).map((q: any) => q.id)) === JSON.stringify(["plain-writing", "accessible-ui"]), "the agent loads member skills then node skills");
    ok(e.instructionsUse(run, "designer", e.nodePins(run, run.def.nodes[0] as any)).skills.join() === "plain-writing@v1,accessible-ui@v1", "its instructions carry those pinned skills");
    ok(e.deps.approvedPick(run, run.def.nodes[0], "reviewer")?.model === "opus-5.5", "a judge turn runs as the reviewer seat");
    store.write({ ...C.teamBody(v1), members: { ...v1.members, maker: member("claude", "changed", "low", []) } }, v1.hash, { by: "captain", via: "page" });
    ok(x("a").pick().model === "gpt-6.1-sol", "a later team edit never changes a running Task");
    const t3 = C.teamBody(store.current()!); delete (t3.members as any)["alt-maker"]; store.write(t3, store.current()!.hash, { by: "captain", via: "page" });
    let refused = ""; try { e.start({ workflow: "fixture-web", text: "again" }); } catch (err: any) { refused = err.message; }
    ok(/needs the team seat alt-maker/.test(refused) && /船員頁/.test(refused), "a start whose seat nobody fills is refused, naming the seat", refused);
    h.stop();
  }
} catch (e: any) { ok(false, "crew-seats threw", e?.stack ?? String(e)); }
end();
