import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// This run's effort for a staffed Task (code-firstmate, coffee-kit) (docs/design/crew-seats.md):
//   - the dispatch card's crew offers each node's effort for this run only, like a non-code workflow's; a reviewing seat is
//     offered medium or more only
//   - the Task runs those efforts on top of its signed staffing: recorded in its signed ledger, read by every turn; a judge
//     turn and the staffing itself are untouched
//   - the efforts are bound to the captain's answer on the dispatch card of a Firstmate proposal for this exact workflow and
//     definition, and start one Task only: a replay, other efforts, another definition, or no card is refused
//   - a reviewing seat never runs under medium, whatever reaches the Task
//      bun tests/crew-run-effort.ts
import { harness, suite, until } from "./rt-harness";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("crew-run-effort");
const C = await import("../src/domain/crew");
const { StaffingStore, installStaffingGuard } = await import("../src/domain/staffing");
const { installCrewStaffing } = await import("../src/crew-staffing");
const { installCrewGuard } = await import("../src/crew-guard");
const { installCrewTools } = await import("../src/crew-tools");
const { bundledText } = await import("../src/bundled");
const member = (provider: "codex" | "claude", model: string, effort: string | null) => ({ provider, model, effort, skills: [] });
const h = await harness([bundledText("packs/firstmate/workflows/code-firstmate.wf.yaml")!, bundledText("workflows/v2/firstmate-proposal.wf.yaml")!], { data: checkedTempDir("crew-run-effort-") }), e = h.engine;
try {
  const staffing = new StaffingStore(h.data), crew = new C.CrewStore(h.data), cs = installCrewStaffing(e, staffing, crew);
  const shop = { namespace: "git" as const, id: "shop", identity: "local-shop" };
  installStaffingGuard(e, staffing, () => shop, undefined, (d, c) => cs.verify(d, c));
  installCrewGuard(e, crew);
  const tools = installCrewTools(e, crew, { facts: async () => [] as any });
  crew.write({ schema: 1, members: { coordinator: member("claude", "opus-5.5", "high"), maker: member("codex", "gpt-6.1-sol", "medium"), "alt-maker": member("claude", "sonnet-5.5", "medium"),
    reviewer: member("claude", "opus-5.5", "high"), "design-reviewer": member("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" });
  const def = e.defs.get("code-firstmate")!, config = cs.ensure(def, shop)!;
  // ---------- the card offers this run's efforts ----------
  const shown = tools.dispatchCrew(def, "shop")!;
  const offer = (n: string) => shown.nodes.find((x: any) => x.node === n)?.efforts ?? [];
  ok(offer("build").includes("low") && offer("build").includes("xhigh"), "a staffed Task's dispatch card offers each node's effort for this run", JSON.stringify(offer("build")));
  ok(offer("review").length > 0 && !offer("review").includes("low") && offer("review").includes("medium"), "a reviewing seat is offered medium or more only", JSON.stringify(offer("review")));
  // ---------- the captain answers the card; the Task runs those efforts ----------
  // Firstmate's proposal workflow, with its two steps standing in for firstmate.dispatch and firstmate.launch
  const { proposalHash } = await import("../src/crew-guard");
  e.actions["firstmate.dispatch"] = async (x: any) => { await e.card(x, "dispatch", { crew: shown, captainOnly: true, title: "Start this work?", zhTitle: "開始這項工作嗎？", en: { intent: "fixture", why: "fixture", how: "approve" }, zh: { intent: "fixture", why: "fixture", how: "核准" },
    options: [{ id: "approve", label: "Approve and start", labelZh: "核准並開始", primary: true }, { id: "close", label: "Close", labelZh: "關閉", hold: true }] } as any); return { wait: true }; };
  const children: Record<string, any> = {};
  e.actions["firstmate.launch"] = async (x: any) => { const card = e.cards.list({ run: x.run.id }).find((c: any) => c.node === "dispatch" && c.answer?.choice === "approve")!;
    const crewRun = card.answer.crew ? JSON.stringify(Object.fromEntries(Object.entries(card.answer.crew).map(([n, v]) => [n, { effort: v }]))) : null;
    const child = e.start({ workflow: "code-firstmate", version: def.version, text: "a change", params: { project: "shop", _staffing: config.hash, ...(crewRun ? { _crewRun: crewRun } : {}), _firstmateProposal: x.run.id, _firstmateDefinition: x.run.params.definition }, by: `captain via ${card.id}` });
    children[x.run.id] = child; e.record(x, "native-dispatch", { data: { schema: 1, proposal: x.run.id, card: card.id, child: child.id, workflow: def.id, version: def.version, definition: x.run.params.definition } }); return "ok"; };
  let seq = 0;
  const propose = (definition = proposalHash(def)) => e.start({ workflow: "firstmate-proposal", text: "a change", params: { source: `s-${++seq}`, target: JSON.stringify({ workflow: def.id, version: def.version, text: "a change", params: { project: "shop" } }), definition, project: "x" } });
  const cardOf = async (id: string) => { await until(() => e.cards.list({ run: id, open: true }).length > 0); return e.cards.list({ run: id, open: true })[0]; };
  const p = propose(), card = await cardOf(p.id);
  let refused = ""; try { await e.answer(card.id, { choice: "approve", by: "captain", crew: { review: "low" } }); } catch (err: any) { refused = err.message; }
  ok(/choose an effort this card offers/.test(refused), "the card refuses an effort under medium for a reviewing seat", refused);
  await e.answer(card.id, { choice: "approve", by: "captain", crew: { build: "xhigh", review: "high" } });
  await until(() => !!children[p.id] || ["failed", "succeeded"].includes(e.get(p.id)!.status));
  const run = children[p.id];
  ok(!!run, "the approved dispatch starts its Task", e.get(p.id)!.error ?? "");
  const runEffort = JSON.stringify({ build: { effort: "xhigh" }, review: { effort: "high" } });
  const start = (o: any) => e.start({ workflow: "code-firstmate", text: "a change", params: { project: "shop", _staffing: config.hash, ...o } });
  const node = (id: string) => run.def.nodes.find((n: any) => n.id === id)!;
  const rec = e.trusted(run.id).entries.find((x) => x.record === "crew-run-effort")?.data as any;
  ok(rec?.nodes?.build?.effort === "xhigh" && rec.staffing === config.hash && rec.card === card.id, "the Task's signed ledger records this run's efforts, its staffing and the card", JSON.stringify(rec));
  ok(e.deps.approvedPick(run, node("build"))?.effort === "xhigh" && e.deps.approvedPick(run, node("build"))?.model === "gpt-6.1-sol", "the build turn runs at the captain's effort on its staffed model");
  ok(e.deps.approvedPick(run, node("review"))?.effort === "high" && e.deps.approvedPick(run, node("plan"))?.effort === "medium", "a node the captain left alone keeps its staffed effort");
  ok(e.deps.approvedPick(run, node("build"), "reviewer")?.effort === "high", "a judge turn on that node keeps the reviewer's staffed effort");
  ok(staffing.current(shop).hash === config.hash && staffing.current(shop).roles.worker.effort === "medium", "the project's signed staffing is unchanged");
  // ---------- the binding ----------
  refused = ""; try { start({ _crewRun: runEffort, _firstmateProposal: p.id, _firstmateDefinition: proposalHash(def) }); } catch (err: any) { refused = err.message; }
  ok(/not the efforts the captain approved/.test(refused), "the same answer never starts a second Task (replay)", refused);
  e.actions["firstmate.launch"] = async () => ({ wait: true }) as any;
  { const p2 = propose(), c2 = await cardOf(p2.id); await e.answer(c2.id, { choice: "approve", by: "captain", crew: { build: "high" } });
    refused = ""; try { start({ _crewRun: JSON.stringify({ build: { effort: "low" } }), _firstmateProposal: p2.id, _firstmateDefinition: proposalHash(def) }); } catch (err: any) { refused = err.message; }
    ok(/not the efforts the captain approved/.test(refused), "a Task naming other efforts than the card's answer is refused", refused);
    refused = ""; try { start({ _crewRun: JSON.stringify({ build: { effort: "high" } }), _firstmateProposal: p2.id, _firstmateDefinition: "0".repeat(64) }); } catch (err: any) { refused = err.message; }
    ok(/not the efforts the captain approved/.test(refused), "a Task whose definition is not the proposal's is refused", refused); }
  { const p3 = propose("f".repeat(64)), c3 = await cardOf(p3.id); await e.answer(c3.id, { choice: "approve", by: "captain", crew: { build: "high" } });
    refused = ""; try { start({ _crewRun: JSON.stringify({ build: { effort: "high" } }), _firstmateProposal: p3.id, _firstmateDefinition: "f".repeat(64) }); } catch (err: any) { refused = err.message; }
    ok(/not the efforts the captain approved/.test(refused), "a proposal pinned to another definition cannot carry efforts to this one", refused); }
  refused = ""; try { start({ _crewRun: runEffort }); } catch (err: any) { refused = err.message; }
  ok(/not the efforts the captain approved/.test(refused), "efforts without a dispatch card are refused", refused);
  const plainRun = start({});
  ok(!e.trusted(plainRun.id).entries.some((x) => x.record === "crew-run-effort") && e.deps.approvedPick(plainRun, plainRun.def.nodes.find((n: any) => n.id === "build"))?.effort === "medium", "a staffed Task without efforts from a card runs its staffing as approved");
  // ---------- the floor ----------
  { const { floorRunEffort } = await import("../src/crew-guard");
    const floored = floorRunEffort(C.teamBody(crew.current()!), def, { review: { effort: "low" }, build: { effort: "low" } });
    ok(floored.review.effort === "medium" && floored.build.effort === "low", "a reviewing seat never runs under medium, whatever reaches the Task", JSON.stringify(floored)); }
} catch (err: any) { ok(false, "crew-run-effort threw", err?.stack ?? String(err)); }
finally { for (const x of e.list()) if (!["failed", "cancelled", "succeeded"].includes(x.status)) { try { await e.cancel(x.id); } catch {} } h.stop(); }
end();
