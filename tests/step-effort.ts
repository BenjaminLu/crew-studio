import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// A step's own reasoning effort without a provider of its own (the Steps view's Strongest / Fast, an effort-only override in the
// graph editor) reaches the round: the engine's pick carries it as stepEffort, and the provider selection runs the chosen
// provider and model at that effort when the model takes it; otherwise it keeps the chosen effort and its evidence says why.
//   - pick: a node with effort and no provider carries stepEffort on the role's / Studio's pick; a node with a provider does not
//   - selection: a supported step effort replaces the configured one (probed again with that pair); an unsupported one is kept out
//   - end to end: a Task's agent round starts at the step's effort through selectNativeProvider with a stub capability
//      bun tests/step-effort.ts
import { harness, suite, until, Y } from "./rt-harness";
const { selectNativeProvider } = await import("../src/providers/policy");
const { ok, end } = suite("step-effort");
const flow = { id: "step-effort", name: "Step effort fixture", version: 1, roles: [{ id: "worker", label: "Worker", skill: "pack:core/skills/coordinator.md" }],
  nodes: [{ id: "strong", kind: "agent", label: "Strong", role: "worker", mode: "test", effort: "high", x: 0, y: 0 },
    { id: "own", kind: "agent", label: "Own provider", role: "worker", mode: "test", provider: "stub", model: "m1", effort: "low", x: 1, y: 0 },
    { id: "plain", kind: "agent", label: "Plain", role: "worker", mode: "test", x: 2, y: 0 }],
  edges: [["strong", "own"], ["own", "plain"]] };
const h = await harness([Y(flow)], { data: checkedTempDir("crew-step-effort-") }), e = h.engine;
const fresh = () => { const at = Date.now(); return { provider: "stub", available: true, auth: "verified" as const, quota: "available" as const, models: [{ id: "m1", efforts: ["low", "medium", "high"] }], at, expires: at + 30_000 }; };
const input = (stepEffort?: string) => ({ role: "worker", host: null, explicit: false, provider: "stub", model: null, configured: { stub: { model: "m1", effort: "low" } }, fallback: ["stub"], known: ["stub"], ...(stepEffort ? { stepEffort } : {}) });
try {
  // the engine's pick
  const task0 = e.start({ workflow: flow.id, text: "pick only", params: {} } as any);
  const def = e.defs.get(flow.id)!, rn = (task0 as any).nodes.strong;
  const pickOf = (id: string) => e.x(task0 as any, def.nodes.find((n: any) => n.id === id)!, rn).pick();
  ok(pickOf("strong").stepEffort === "high" && pickOf("strong").provider === "stub", "a node with an effort and no provider carries it as stepEffort on Studio's pick", JSON.stringify(pickOf("strong")));
  ok(pickOf("own").stepEffort === undefined && pickOf("own").effort === "low", "a node with its own provider keeps its own effort, no stepEffort", JSON.stringify(pickOf("own")));
  ok(pickOf("plain").stepEffort === undefined, "a node with no effort carries none", JSON.stringify(pickOf("plain")));
  e.cancel?.(task0.id, "pick only");
  await until(() => !e.busy(task0.id));

  // the selection
  const probes: { effort: string | null }[] = [], made: { effort: string | null }[] = [];
  const probe = async (_id: string, pair: { model: string; effort: string | null }) => { probes.push({ effort: pair.effort }); return fresh(); };
  const make = (id: string, model: string, effort: string | null) => { made.push({ effort }); return { ...e.deps.provider(id, model), id, model } as any; };
  const a = await selectNativeProvider(input("high") as any, probe, make);
  ok(a.evidence.effort === "high" && made.at(-1)?.effort === "high" && a.evidence.stepEffort?.applied === true && probes.at(-1)?.effort === "high", "a supported step effort runs instead of the configured one, verified at that pair", JSON.stringify({ ev: a.evidence, probes }));
  const b = await selectNativeProvider(input("xhigh") as any, probe, make);
  ok(b.evidence.effort === "low" && made.at(-1)?.effort === "low" && b.evidence.stepEffort?.applied === false && /does not take reasoning effort xhigh/.test(b.evidence.stepEffort?.reason ?? ""), "an unsupported step effort keeps the configured one and says why", JSON.stringify(b.evidence));
  const c = await selectNativeProvider(input() as any, probe, make);
  ok(c.evidence.effort === "low" && c.evidence.stepEffort === undefined, "with no step effort nothing changes", JSON.stringify(c.evidence));

  // end to end: a Task's rounds
  const started: { node: string; effort: string | null }[] = [];
  e.deps.selectProvider = async (x: any, p: any) => {
    const sel = await selectNativeProvider({ ...input(), ...(p.stepEffort ? { stepEffort: p.stepEffort } : {}), ...(p.provider === "stub" && p.model ? { explicit: true, model: p.model, ...(p.effort ? { effort: p.effort } : {}) } : {}) } as any, async () => fresh(), (id, model, effort) => {
      const base = e.deps.provider(id, model); return { ...base, id, model, reasoningEffort: effort, start: (sys: string, tools: any, ctx: any) => { started.push({ node: x.node.id, effort }); return base.start(sys, tools, ctx); } } as any; });
    return sel.provider; };
  const task = e.start({ workflow: flow.id, text: "run", params: {} } as any);
  await until(() => ["succeeded", "failed"].includes(task.status) && !e.busy(task.id));
  const at = (n: string) => started.find((s) => s.node === n)?.effort;
  ok(task.status === "succeeded" && at("strong") === "high" && at("own") === "low" && at("plain") === "low", "the Task runs the step at its own effort; the others at theirs", JSON.stringify([task.status, task.error, started]));
} finally { h.stop(); }
end();
