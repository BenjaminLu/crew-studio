import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Resume semantics (retro 2026-10-17 finding 30; docs/architecture.md §3.2 "Resume per node kind"):
// Studio is stopped while an agent node's turn is running, and a fresh engine over the same data resumes the run.
//   the agent node runs again from scratch, with the same prompt; the interrupted turn's record stays (prompt.md),
//   the re-run writes prompt.attempt2.md beside it, and the stream says the first turn was interrupted
//   nothing downstream happens twice: one card, one merge
//   the next node gets the same context as in a run that was never interrupted
//   every agent step's record (prompt, system, stream, report) is on disk before the next node starts
//   a restart while the run waits on a card keeps that card (no second card)
//   bun tests/resume-semantics.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, sleep, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("resume-semantics");
const roles = [{ id: "w", label: "W", skill: "x" }];
const H = await harness([
  Y({ id: "resume", name: "resume", roles, nodes: [
    { id: "a", kind: "agent", label: "Agent", role: "w", mode: "resume-test", x: 0, y: 0 },
    { id: "q", kind: "card", label: "Merge?", card: { title: "Merge?", options: [{ id: "go", label: "Go" }] }, x: 1, y: 0 },
    { id: "m", kind: "hook", label: "Merge", do: "count-merge", x: 2, y: 0 },
    { id: "e", kind: "hook", label: "End", x: 3, y: 0 }], edges: [["a", "q"], ["q", "m", "go"], ["m", "e"]] }),
]);
const { Engine } = await import("../src/runtime/engine");
const { Agents } = await import("../src/agent");
const merges = new Map<string, number>(), seen = new Map<string, any>(), late: string[] = [];
const roundDir = (E: any, run: string, node: string, visit: number) => join(E.root, run, "nodes", node, String(visit));
/** One engine over the test data, with the test's mode, hook and the log guard installed. */
function engine(provider: any, agents = H.agents) {
  const E = new Engine({ ...(H.engine as any).deps, agents, provider }, H.defs);
  E.modes["resume-test"] = { tools: () => [], system: () => "resume test", prompt: (x: any) => `TEST AGENT\nmake the thing for: ${x.run.text}`,
    after: (x: any) => { x.ctx.made = { for: x.run.text, by: "a" }; return "ok"; } };
  E.actions["count-merge"] = (x: any) => { merges.set(x.run.id, (merges.get(x.run.id) ?? 0) + 1); seen.set(x.run.id, structuredClone({ made: x.ctx.made, answer: x.ctx.answers?.q?.choice })); return "ok"; };
  // before any node starts: every agent step that finished has its whole record on disk
  E.beforeStart.logs = (x: any) => {
    for (const s of x.run.steps.filter((s: any) => s.kind === "agent" && s.state === "passed")) {
      const d = roundDir(E, x.run.id, s.node, s.visit), files = existsSync(d) ? readdirSync(d) : [];
      const report = files.includes("report.json") ? JSON.parse(readFileSync(join(d, "report.json"), "utf8")) : null;
      if (!files.some((f) => /^prompt(\.attempt\d+)?\.md$/.test(f)) || !files.some((f) => /^system(\.attempt\d+)?\.md$/.test(f)) || !files.includes("stream.jsonl") || report?.status !== "done" || !files.includes(report.prompt))
        late.push(`${x.run.id} ${x.node.id}: ${s.node}#${s.visit} has ${files.join(",")}`);
    }
    return null;
  };
  return E;
}
const stub = (H.engine as any).deps.provider;
// a provider whose turn never ends: the process is stopped while it runs
const hang = (id?: string, model?: string) => ({ ...stub(id, model), start: () => ({ interrupt() {}, async *send() { await new Promise(() => {}); } }) });
const body = (f: string) => readFileSync(f, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");

// the run that never stops: what the resumed run must match
const C = engine(stub);
const control = C.start({ workflow: "resume", text: "a receipt" });
await until(() => C.get(control.id)!.status === "waiting", 10000);
await C.answer(C.cards.list({ run: control.id, open: true })[0].id, { choice: "go", by: "captain" });
await until(() => C.get(control.id)!.status === "succeeded", 10000);
ok(C.get(control.id)!.status === "succeeded" && merges.get(control.id) === 1, "control: the run ends after one merge", C.get(control.id)!.status);

// the run Studio stops while the agent's turn runs
const E1 = engine(hang);
const r = E1.start({ workflow: "resume", text: "a receipt" });
const dir = roundDir(E1, r.id, "a", 1);
await until(() => !!E1.get(r.id)!.nodes.a.job && existsSync(join(dir, "prompt.md")), 10000);
ok(!!E1.get(r.id)!.nodes.a.job && !existsSync(join(dir, "report.json")), "the agent's turn is running when Studio stops (prompt written, no report yet)");
const firstPrompt = body(join(dir, "prompt.md"));

// restart: a fresh engine (its own agents) over the same data
const E2 = engine(stub, new Agents(H.data, () => H.toolUrl));
E2.load();
const back = E2.get(r.id)!;
ok(back.steps.some((s) => s.node === "a" && s.state === "interrupted") && back.recovered === 1, "the interrupted step is marked interrupted and the run is resumed");
await until(() => E2.get(r.id)!.status === "waiting", 10000);
ok(existsSync(join(dir, "prompt.md")) && existsSync(join(dir, "prompt.attempt2.md")) && body(join(dir, "prompt.md")) === firstPrompt,
  "the interrupted turn's prompt.md is kept; the re-run writes prompt.attempt2.md beside it", readdirSync(dir).join(","));
ok(body(join(dir, "prompt.attempt2.md")) === firstPrompt && body(join(roundDir(C, control.id, "a", 1), "prompt.md")) === firstPrompt,
  "the re-run's prompt is the same as the interrupted turn's and as the uninterrupted run's (deterministic)");
const stream = readFileSync(join(dir, "stream.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(stream.some((e) => e.status === "interrupted") && stream.filter((e) => e.status === "started").length === 2 && JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).prompt === "prompt.attempt2.md",
  "the stream records the interrupted turn and the re-run; report.json names the re-run's prompt");
ok(E2.cards.list({ run: r.id }).length === 1, "one card is raised after the resume", String(E2.cards.list({ run: r.id }).length));

// a second restart while the run waits on the card: the same card stays, no new one
const E3 = engine(stub, new Agents(H.data, () => H.toolUrl));
E3.load(); await sleep(200);
const cards = E3.cards.list({ run: r.id });
ok(cards.length === 1 && cards[0].status === "open" && E3.get(r.id)!.status === "waiting", "a restart while the card waits keeps that one card open", JSON.stringify(cards.map((c) => [c.id, c.status])));
await E3.answer(cards[0].id, { choice: "go", by: "captain" });
await until(() => E3.get(r.id)!.status === "succeeded", 10000);
ok(E3.get(r.id)!.status === "succeeded" && merges.get(r.id) === 1, "the resumed run merges exactly once", String(merges.get(r.id)));
ok(JSON.stringify(seen.get(r.id)) === JSON.stringify(seen.get(control.id)) && seen.get(r.id)?.made?.for === "a receipt", "the merge node gets the same context as in the uninterrupted run", JSON.stringify([seen.get(r.id), seen.get(control.id)]));
ok(E3.get(r.id)!.steps.filter((s) => s.node === "a" && s.state === "passed").length === 1, "the agent node passed once (the interrupted turn is not counted as a result)");
ok(!late.length, "every agent step's prompt, system, stream and report were on disk before the next node started", late.join("; "));
H.stop();
end();
