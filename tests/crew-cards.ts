import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// The crew's cards and Firstmate's crew tools (docs/design/crew-seats.md):
//   - studio_crew_assignments reads by workflow, by member, the diff against the team, and a hypothetical change's reach
//   - studio_propose_crew_change opens one captain card and never applies anything: only the captain's approval writes the team
//   - a workflow that needs a seat nobody fills raises one seat card, its suggestion filtered by the capabilities the seat needs;
//     when no verified model has a capability, the card names it and where to add an account, and offers nothing to approve
//   - a workflow upgrade that adds a role on an empty seat raises that card, naming the versions; an upgrade with the same seats
//     raises none
//   - the dispatch card shows the crew in one line; the captain's effort change applies to that run only, from the signed answer
//      bun tests/crew-cards.ts
import { readFileSync } from "node:fs";
import { harness, suite, until, Y } from "./rt-harness";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("crew-cards");
const C = await import("../src/domain/crew");
const { installCrewGuard } = await import("../src/crew-guard");
const { installCrewTools } = await import("../src/crew-tools");
const { installFirstmate } = await import("../src/firstmate");
const { Projects } = await import("../src/doors");
const { bundledText } = await import("../src/bundled");
const node = (id: string, seat?: string, extra: any = {}) => ({ id, kind: "agent", label: id.toUpperCase(), role: "maker", mode: "test", ...(seat ? { seat } : {}), x: 0, y: 0, ...extra });
const wait = { id: "wait", kind: "card", label: "Wait", x: 0, y: 0, card: { body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, options: [{ id: "go", label: "Go", labelZh: "Go" }] } };
const flow = (id: string, nodes: any[], o: any = {}) => Y({ id, name: id, kind: "web", version: 1, roles: [{ id: "maker", label: "Maker", skill: "bundled:x", seat: "maker" }], nodes: [wait, ...nodes], edges: [["wait", nodes[0].id, "go"], ...nodes.slice(1).map((n: any, i: number) => [nodes[i].id, n.id])], ...o });
const music = flow("fixture-music", [node("compose"), node("direct", "music-director")], { seats: [{ id: "music-director", label: "Music director", labelZh: "音樂總監", reviews: "maker", needs: ["audio", "long-context"] }] });
const pics = flow("fixture-pics", [node("draw", "image-maker")], { seats: [{ id: "image-maker", label: "Image maker", labelZh: "圖像產出", needs: ["image-generation"], suggest: { provider: "codex" } }] });
const H = await harness([bundledText("workflows/v2/firstmate-proposal.wf.yaml")!, bundledText("workflows/v2/crew-change.wf.yaml")!, flow("fixture-web", [node("a"), node("b", "alt-maker")]), music, pics, flow("fixture-film", [node("cut")])], { data: checkedTempDir("crew-cards-") });
const E = H.engine;
const facts = [{ provider: "codex", support: "supported", auth: "verified", models: [{ id: "gpt-6.1-sol", efforts: ["low", "medium", "high"] }, { id: "gpt-6-astra", efforts: ["low", "medium", "high"] }] }, { provider: "claude", support: "supported", auth: "verified", models: [{ id: "opus-5.5", efforts: [] }] }];
const store = new C.CrewStore(H.data);
installCrewGuard(E, store);
const crew = installCrewTools(E, store, { facts: async () => facts as any });
const fm = installFirstmate(E, new Projects(H.data), { crewSeatGate: (d, o) => crew.seatGate(d, o), dispatchCrew: (d) => crew.dispatchCrew(d) });
const captain = (key: string, text = "please") => ({ key, captain: true, text, live: () => true });
const m = (provider: "codex" | "claude", model: string, effort: string | null) => ({ provider, model, effort, skills: [] });
const done = (id: string) => until(() => ["succeeded", "failed", "cancelled"].includes(E.get(id)!.status));
const cardOf = async (run: string) => { await until(() => E.cards.list({ run, open: true }).length > 0); return E.cards.list({ run, open: true })[0]; };
try {
  // ---------- reading ----------
  let r: any = await crew.call("studio_crew_assignments", {}, captain("r0"));
  ok(r.team === null && /No team yet/.test(r.note), "with no team, the read says so");
  ok(JSON.stringify(r.models?.choices.map((m: any) => `${m.provider}/${m.model}:${m.efforts.join(",")}`)) === '["codex/gpt-6.1-sol:low,medium,high","codex/gpt-6-astra:low,medium,high","claude/opus-5.5:"]' && r.models.unavailable.length === 0 && r.models.providers.length === 2,
    "the read carries the same live model list as the Crew page: the detected models with their efforts", JSON.stringify(r.models));
  // the very first team comes from a card too (no team yet: the card was prepared against "no team")
  const p0: any = await crew.call("studio_propose_crew_change", { change: { kind: "member", seat: "coordinator", set: { provider: "claude", model: "opus-5.5", effort: null } } }, captain("p-first"));
  await E.answer((await cardOf(p0.proposal)).id, { choice: "approve", by: "captain" }); await done(p0.proposal);
  ok(store.current()?.members.coordinator?.model === "opus-5.5" && E.get(p0.proposal)!.status === "succeeded", "the captain approves the first team on a card", E.get(p0.proposal)!.error ?? "");
  store.write({ schema: 1, members: { coordinator: m("claude", "opus-5.5", null), maker: m("codex", "gpt-6.1-sol", "medium"), "alt-maker": m("claude", "opus-5.5", null), reviewer: m("claude", "opus-5.5", null) }, seats: {}, workflows: {} }, store.current()!.hash, { by: "captain", via: "page" });
  r = await crew.call("studio_crew_assignments", { workflow: "fixture-web" }, captain("r1"));
  ok(r.workflow.nodes.find((n: any) => n.node === "a").model === "gpt-6.1-sol" && r.workflow.nodes.find((n: any) => n.node === "b").model === "opus-5.5", "by workflow: each node's member, model and source", JSON.stringify(r.workflow.nodes));
  r = await crew.call("studio_crew_assignments", { member: "maker" }, captain("r2"));
  ok(r.nodes.some((n: any) => n.workflow === "fixture-web" && n.node === "a") && r.nodes.some((n: any) => n.workflow === "fixture-film" && n.node === "cut"), "by member: every node it runs");
  r = await crew.call("studio_crew_assignments", { diff: true }, captain("r3"));
  ok(r.workflows.some((w: any) => w.id === "fixture-music" && w.badge.state === "missing") && !r.workflows.some((w: any) => w.id === "fixture-web"), "diff: only what differs from the team, and empty seats", JSON.stringify(r.workflows.map((w: any) => w.id)));
  const before = store.current()!.hash;
  r = await crew.call("studio_crew_assignments", { change: { kind: "member", seat: "maker", set: { effort: "high" } } }, captain("r4"));
  ok(r.hypothetical && r.count === 3 && store.current()!.hash === before, "a hypothetical change says what it would reach and changes nothing", JSON.stringify(r.reaches));
  // ---------- Firstmate proposes; only the captain applies ----------
  let refused = ""; try { await crew.call("studio_propose_crew_change", { change: { kind: "member", seat: "maker", set: { effort: "high" } } }, { ...captain("p0"), captain: false }); } catch (e: any) { refused = e.message; }
  ok(/Only a current captain request/.test(refused), "a proposal needs a captain's request", refused);
  const p1: any = await crew.call("studio_propose_crew_change", { change: { kind: "node", workflow: "fixture-web", node: "a", set: { effort: "high" } } }, captain("p1"));
  const c1 = await cardOf(p1.proposal);
  ok(p1.status === "captain-approval-required" && store.current()!.hash === before && c1.captainOnly && /only in this workflow/.test(c1.title.en) && /fixture-web · A/.test(c1.body), "proposing opens one captain card; the team is unchanged", c1.title.en);
  await E.answer(c1.id, { choice: "approve", by: "firstmate" }).catch(() => {}); await done(p1.proposal);
  ok(store.current()!.hash === before, "Firstmate's own answer applies nothing");
  const p2: any = await crew.call("studio_propose_crew_change", { change: { kind: "node", workflow: "fixture-web", node: "a", set: { effort: "high" } } }, captain("p2"));
  await E.answer((await cardOf(p2.proposal)).id, { choice: "approve", by: "captain" }); await done(p2.proposal);
  const after = store.current()!;
  ok(after.version === 3 && after.approval.via === "card" && after.approval.run === p2.proposal && after.workflows["fixture-web"]?.nodes.a?.effort === "high", "the captain's approval writes the team, citing the card", JSON.stringify(after.approval));
  // ---------- a seat no verified model can fill ----------
  refused = ""; try { await fm.call("studio_propose_work", { workflow: "fixture-music", version: 1, text: "a jingle" }, captain("w1")); } catch (e: any) { refused = e.message; }
  const unmet = E.list().find((x) => x.workflow === "crew-change" && x.params.reason === "seat-unmet")!;
  const uc = unmet && await cardOf(unmet.id);
  ok(/needs the team seat “Music director”/.test(refused) && /Do not propose staffing/.test(refused), "a workflow whose seat nobody fills is refused, naming the seat and the card", refused);
  ok(!!uc && /can listen to audio/.test(uc.title.en) && /聽音訊/.test(uc.title["zh-TW"]) && /Settings → Accounts/.test(uc.body) && uc.options.length === 1 && uc.options[0].id === "close", "no model can listen to audio: the card names the capability and where to add an account, with nothing to approve", uc?.title.en);
  // ---------- a seat a verified model can fill: the suggestion is filtered by capability ----------
  refused = ""; try { await fm.call("studio_propose_work", { workflow: "fixture-pics", version: 1, text: "a logo" }, captain("w2")); } catch (e: any) { refused = e.message; }
  const seatRun = E.list().find((x) => x.workflow === "crew-change" && x.params.reason === "seat" && JSON.parse(x.params.change).seat?.id === "image-maker")!;
  const sc = await cardOf(seatRun.id);
  ok(/suggesting codex gpt-6.1-sol/.test(refused) && /Add “Image maker” to the team\?/.test(sc.title.en) && /團隊要新增「圖像產出」這個位置嗎？/.test(sc.title["zh-TW"]) && /generate images ✓/.test(sc.body), "an image seat suggests only a model that can generate images", sc.title.en);
  await E.answer(sc.id, { choice: "approve", by: "captain" }); await done(seatRun.id);
  ok(store.current()!.members["image-maker"]?.provider === "codex" && store.current()!.seats["image-maker"]?.labelZh === "圖像產出", "approving fills the specialist seat");
  // ---------- an upgrade: a new role on an empty seat raises one card; the same seats raise none ----------
  const film = E.defs.get("fixture-film")!;
  E.defs.save("fixture-film", { ...film, nodes: [...film.nodes, node("voice", "design-reviewer")], edges: [...film.edges, { from: "cut", to: "voice" }], base: 1 } as any, "captain", "add a voice-over");
  refused = ""; try { await fm.call("studio_propose_work", { workflow: "fixture-film", version: 2, text: "a short film" }, captain("w3")); } catch (e: any) { refused = e.message; }
  const up = E.list().find((x) => x.workflow === "crew-change" && x.params.reason === "new-role")!;
  const upc = up && await cardOf(up.id);
  ok(!!upc && /v1 → v2 adds “VOICE”/.test(upc.title.en) && /v1 → v2 多了「VOICE」/.test(upc.title["zh-TW"]), "an upgrade that adds a role on an empty seat asks about that role only", upc?.title.en);
  const film2 = E.defs.get("fixture-film")!;
  E.defs.save("fixture-film", { ...film2, nodes: film2.nodes.filter((n: any) => n.id !== "voice").map((n: any) => n.id === "cut" ? { ...n, label: "Cut the film" } : n), edges: film2.edges.filter((e: any) => e.to !== "voice"), base: 2 } as any, "captain", "drop the voice-over");
  const quiet: any = await fm.call("studio_propose_work", { workflow: "fixture-film", version: 3, text: "a short film" }, captain("w4"));
  ok(!!quiet.proposal && E.list().filter((x) => x.workflow === "crew-change" && x.params.reason !== "change").length === 3, "an upgrade with the same seats raises no crew card: the work goes straight to its dispatch card");
  // ---------- the dispatch card: the crew in one line; an effort change for this run only ----------
  const prop: any = await fm.call("studio_propose_work", { workflow: "fixture-web", version: 1, text: "two designs" }, captain("w5"));
  const dc = await cardOf(prop.proposal);
  ok(dc.kind === "dispatch" && /A and B on different models/.test(dc.crew?.summary.en ?? "") && /A、B 不同模型/.test(dc.crew?.summary.zh ?? "") && /1 custom here/.test(dc.crew!.summary.en), "the dispatch card shows the crew in one line", JSON.stringify(dc.crew?.summary));
  refused = ""; try { await E.answer(dc.id, { choice: "approve", by: "captain", crew: { a: "ultra" } }); } catch (e: any) { refused = e.message; }
  ok(/choose an effort this card offers/.test(refused), "an effort the card does not offer is refused", refused);
  await E.answer(dc.id, { choice: "approve", by: "captain", crew: { b: "high" } }); await done(prop.proposal);
  const child = E.get(E.get(prop.proposal)!.ctx.childRun)!;
  const rec = E.trusted(child.id).entries.find((x) => x.record === "crew-resolved")?.data as any;
  ok(JSON.parse(child.params._crewRun).b.effort === "high" && rec?.nodes.b.effort === "high" && rec.nodes.b.source === "run" && rec.nodes.a.effort === "high" && rec.nodes.a.source === "workflow", "the captain's effort applies to this run only, recorded with its source", JSON.stringify(rec?.nodes));
  ok(store.current()!.workflows["fixture-web"].nodes.b === undefined, "the team itself is unchanged by a run's effort");
  // the captain's own pick on the run page: recorded next to the crew, with the rule it breaks said plainly
  E.setAgent(child.id, "b", { provider: "codex", model: "gpt-6.1-sol", effort: "low" });
  const swap = E.trusted(child.id).entries.find((x) => x.record === "crew-run-override")?.data as any;
  ok(swap?.node === "b" && swap.to.model === "gpt-6.1-sol" && swap.from.model === rec.nodes.b.model && swap.notes.some((n: any) => /same model as Maker/.test(n.en)), "a run-page pick is recorded in the crew ledger with the rule's note", JSON.stringify(swap));
  // the dispatch card is bound to the team it showed: a team change before approval raises the card again, and nothing starts
  const prop2: any = await fm.call("studio_propose_work", { workflow: "fixture-web", version: 1, text: "two more designs" }, captain("w6"));
  const dc2 = await cardOf(prop2.proposal), shownTeam = dc2.crew!.team;
  const changed = store.write(C.applyChange(C.teamBody(store.current()!), { kind: "member", seat: "alt-maker", set: { effort: "high" } }), store.current()!.hash, { by: "captain", via: "page" });
  await E.answer(dc2.id, { choice: "approve", by: "captain" }); await done(prop2.proposal);
  const old = E.get(prop2.proposal)!, again = old.ctx.crewReraised ? E.get(old.ctx.crewReraised) : null;
  const dc3 = again && await cardOf(again.id);
  ok(old.status === "failed" && !old.ctx.childRun && shownTeam !== changed.hash && dc3?.kind === "dispatch" && dc3.crew?.team === changed.hash, "a team change after the dispatch card showed its crew starts nothing and raises the card again with the new crew", JSON.stringify({ status: old.status, child: old.ctx.childRun, again: again?.id, team: dc3?.crew?.team === changed.hash }));
  refused = ""; try { E.start({ workflow: "fixture-web", text: "x", params: { _crewTeam: shownTeam } }); } catch (e: any) { refused = e.message; }
  ok(/team changed after the dispatch card showed its crew/.test(refused), "a Task bound to the team version a card showed refuses to start on another one", refused);
} catch (e: any) { ok(false, "crew-cards threw", e?.stack ?? String(e)); }
finally { for (const x of E.list()) if (!["failed", "cancelled", "succeeded"].includes(x.status)) { try { await E.cancel(x.id); } catch {} } H.stop(); }
end();
