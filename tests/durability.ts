import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Durability (fix round 1, runtime class "durability", check-runtime#11): every
// change that takes two writes is one durable step, or recovers from a crash
// between them. Each case replays a run's events cut at the crash point into a
// fresh engine over the same data:
//   a node's result and its routing (edge checks in flight) → the routing replays
//   a card answered just before the crash → the answer is carried on
//   a card raised by a step that did not finish → the orphan is cancelled, one card stays
//   a run whose creation was recorded but not its first step → it starts
//   bun tests/durability.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, sleep, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("durability");
const flows = [
  Y({ id: "edgeck", name: "edge", roles: [], nodes: [{ id: "a", kind: "hook", label: "A", do: "set", args: { key: "k", value: 1 }, x: 0, y: 0 }, { id: "b", kind: "hook", label: "B", do: "set", args: { key: "k", value: 2 }, x: 1, y: 0 },
    { id: "end", kind: "hook", label: "End", x: 2, y: 0 }, { id: "blocked", kind: "hook", label: "Blocked", args: { result: "blocked" }, x: 2, y: 1 }],
    edges: [["a", "b"], { from: "b", to: "end", checks: [{ use: "t/nat", params: { want: "fail" } }] }, ["b", "blocked", "fail"]] }),
  Y({ id: "ask", name: "ask", roles: [], nodes: [{ id: "a", kind: "hook", label: "A", do: "set", args: { key: "k", value: 1 }, x: 0, y: 0 }, { id: "q", kind: "card", label: "Q", card: { title: "Go?", options: [{ id: "go", label: "Go" }] }, x: 1, y: 0 },
    { id: "e", kind: "hook", label: "E", args: { result: "went" }, x: 2, y: 0 }], edges: [["a", "q"], ["q", "e", "go"]] }),
];
const H = await harness(flows);
const E = H.engine;
const { Engine } = await import("../src/runtime/engine");
let next = 900;
/** Write the events up to (and including) index `upto` as a new run, and load it in a fresh engine. */
const replay = (id: string, upto: number) => {
  const evs = E.events(id).slice(0, upto + 1); const nid = `R-${next++}`;
  mkdirSync(E.rdir(nid), { recursive: true });
  writeFileSync(join(E.rdir(nid), "events.jsonl"), evs.map((e) => JSON.stringify({ ...e, run: nid, ...(e.type === "run_created" ? { run: { ...e.run, id: nid } } : {}) })).join("\n") + "\n");
  return nid;
};
const fresh = () => { const E2 = new Engine((E as any).deps, H.defs); E2.actions = E.actions; E2.modes = E.modes; E2.natives = E.natives; return E2; };

// (a) the result is durable, the routing (with its edge checks) was cut off
{
  const r = E.start({ workflow: "edgeck", text: "x" }); await until(() => E.get(r.id)!.status === "succeeded", 8000);
  const evs = E.events(r.id); const cut = evs.findIndex((e) => e.type === "node" && e.node === "b" && e.to === "passed");
  ok(evs[cut]?.set?.routing?.outcome === "ok", "a node's result and its routing marker are one durable event");
  const nid = replay(r.id, cut); const E2 = fresh(); E2.load();
  await until(() => E2.get(nid)!.status === "succeeded", 8000);
  ok(E2.get(nid)!.result === "blocked" && E2.ledger(nid).some((e) => e.check === "t/nat"), "after a crash between the result and the routing, the routing replays (edge checks again) and the run reaches its end", `${E2.get(nid)!.status} ${E2.get(nid)!.result} ${E2.get(nid)!.error}`);
}
// (b) the card was answered, the node had not moved
{
  const r = E.start({ workflow: "ask", text: "x" }); await until(() => E.get(r.id)!.status === "waiting", 8000);
  const c = E.cards.list({ run: r.id })[0];
  E.cards.answer(c.id, { choice: "go", by: "captain" }); // the answer is on disk; the crash comes before the run moves
  const nid = replay(r.id, E.events(r.id).length - 1);
  // the copy waits on the same card id: point it at a copy of the answered card
  const cc = { ...E.cards.get(c.id)!, id: "SC-990", run: nid }; writeFileSync(join(H.data, "cards", "SC-990.json"), JSON.stringify(cc));
  const lines = E.events(nid).map((e: any) => JSON.stringify(e).replaceAll(`"${c.id}"`, '"SC-990"')); writeFileSync(join(E.rdir(nid), "events.jsonl"), lines.join("\n") + "\n");
  const E2 = fresh(); E2.load();
  await until(() => E2.get(nid)!.status === "succeeded", 8000);
  ok(E2.get(nid)!.result === "went" && E2.get(nid)!.ctx.answers?.q?.choice === "go", "after a crash between a card's answer and the run's move, the answer is carried on", `${E2.get(nid)!.status}`);
  ok(E2.ledger(nid).filter((e) => e.record === "card-answer" && e.data?.card === "SC-990").length === 1, "… and the answer is recorded in the ledger exactly once");
}
// (c) the card was raised, the step had not recorded that it waits on it
{
  const r = E.start({ workflow: "ask", text: "x" }); await until(() => E.get(r.id)!.status === "waiting", 8000);
  const evs = E.events(r.id); const cut = evs.findIndex((e) => (e.type === "ndata" || e.type === "node") && e.node === "q" && e.set?.waiting === "card") - 1;
  const old = E.cards.list({ run: r.id })[0];
  const nid = replay(r.id, cut);
  const oc = { ...old, id: "SC-991", run: nid }; writeFileSync(join(H.data, "cards", "SC-991.json"), JSON.stringify(oc));
  const E2 = fresh(); E2.load(); await until(() => E2.cards.list({ run: nid, open: true }).length >= 1 && E2.get(nid)!.status === "waiting", 8000); await sleep(200);
  const open = E2.cards.list({ run: nid, open: true });
  ok(open.length === 1 && open[0].id !== "SC-991" && E2.cards.get("SC-991")!.status === "cancelled", "a card raised by a step cut short is cancelled; the step runs again and exactly one card is open", JSON.stringify(open.map((c) => c.id)));
}
// (d) only the run's creation was recorded
{
  const r = E.start({ workflow: "edgeck", text: "x" }); await until(() => E.get(r.id)!.status === "succeeded", 8000);
  const nid = replay(r.id, 0); const E2 = fresh(); E2.load();
  await until(() => E2.get(nid)!.status === "succeeded", 8000);
  ok(E2.get(nid)!.status === "succeeded", "a run whose creation was recorded but not its first step starts after a restart");
}
H.stop();
end();
