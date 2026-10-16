import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Process lifetime (fix round 1, runtime class "lifetime", check-runtime#3, #8):
// when a run ends — a terminal reached on one branch, or no edge for an outcome —
// every sibling still running stops: its agent job is cancelled, its check's
// process group is killed, its card is cancelled, and a result that arrives late
// is refused (no node event follows the run's terminal event).    bun tests/lifetime.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { harness, sleep, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("lifetime");
const roles = [{ id: "w", label: "W", skill: "x" }];
const H = await harness([
  Y({ id: "race", name: "race", roles, nodes: [{ id: "s", kind: "hook", label: "S", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "pause", kind: "hook", label: "Child started", do: "fixture.child-started", x: 1, y: 0 }, // observable process barrier, not a timing guess
    { id: "fast", kind: "hook", label: "Fast end", do: "set", args: { key: "f", value: 1 }, x: 1, y: 0 },
    { id: "slow", kind: "agent", label: "Slow", role: "w", mode: "test", args: { say: "STUB_SLOW" }, x: 1, y: 1 },
    { id: "long", kind: "check", label: "Long check", checks: [{ use: "t/long" }], x: 1, y: 2 },
    { id: "after", kind: "hook", label: "After slow", do: "set", args: { key: "late", value: 1 }, x: 2, y: 1 }, { id: "e2", kind: "hook", label: "E2", x: 3, y: 1 }],
    edges: [["s", "pause"], ["pause", "fast", "ok"], ["s", "slow"], ["s", "long"], ["slow", "after"], ["long", "after", "pass|fail"], ["after", "e2"]] }),
  Y({ id: "noedge", name: "noedge", roles, nodes: [{ id: "s", kind: "hook", label: "S", do: "set", args: { key: "s", value: 1 }, x: 0, y: 0 },
    { id: "weird", kind: "hook", label: "Weird", do: "set", args: { key: "w", value: 1, out: "sideways" }, x: 1, y: 0 },
    { id: "slow", kind: "agent", label: "Slow", role: "w", mode: "test", args: { say: "STUB_SLOW" }, x: 1, y: 1 },
    { id: "e", kind: "hook", label: "E", x: 2, y: 0 }], edges: [["s", "weird"], ["s", "slow"], ["weird", "e", "ok"], ["slow", "e"]] }),
]);
const E = H.engine;
let captured: { self: number; child: number } | null = null, startedLive = false;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code !== "ESRCH"; } };
E.actions["fixture.child-started"] = async x => {
  const evidence = join(H.data, "evidence", x.run.id);
  const started = await until(() => {
    for (const name of existsSync(evidence) ? readdirSync(evidence).filter(name => name.endsWith("-long")) : []) {
      const file = join(evidence, name, "out", "pids.json"); if (!existsSync(file)) continue;
      let p: any; try { p = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
      const job = x.run.nodes.slow.data.jobs?.[0]?.id ?? x.run.nodes.slow.job;
      if (Number.isInteger(p.self) && Number.isInteger(p.child) && p.self > 0 && p.child > 0 && alive(p.self) && alive(p.child) && H.agents.jobs.get(job ?? "")?.status === "running") {
        captured = { self: p.self, child: p.child }; startedLive = x.run.status === "running"; return true;
      }
    }
    return false;
  }, 10000);
  if (!started) throw new Error("the real check parent/child and agent did not start before the terminal barrier");
  return "ok";
};
{ const r = E.start({ workflow: "race", text: "x" });
  await until(() => E.get(r.id)!.status === "succeeded", 10000);
  const g = E.get(r.id)!; const job = g.nodes.slow.data.jobs?.[0]?.id ?? g.nodes.slow.job;
  await sleep(4500); // long enough for the slow agent to have finished had it not been stopped
  const evs = E.events(r.id); const endAt = evs.findIndex((e) => e.type === "run" && e.to === "succeeded");
  ok(g.result === "done" && g.nodes.slow.state === "skipped" && g.nodes.slow.cause === "the run ended" && H.agents.jobs.get(job)?.status === "cancelled", "a terminal reached on one branch cancels the agent still running on another", `${g.nodes.slow.state} ${g.nodes.slow.cause} ${H.agents.jobs.get(job)?.status}`);
  const pids = captured;
  ok(startedLive && !!pids, "the actual check parent/child and slow agent were observed running before the terminal, independent of late ledger evidence");
  ok(!!pids && !alive(pids.self) && !alive(pids.child) && g.nodes.long.state === "skipped", "… and kills the process group of a check still running (the check and its child, by pid)", JSON.stringify(pids));
  ok(!E.ledger(r.id).some(e => e.check === "t/long"), "the cancelled long check produces no ordinary late ledger result; PID proof was captured before cancellation");
  ok(!evs.slice(endAt + 1).some((e) => e.type === "node" && e.to !== "skipped") && E.get(r.id)!.ctx.late === undefined, "a result that arrives after the run ended is refused: no node moves after the terminal event", JSON.stringify(evs.slice(endAt + 1).filter((e) => e.type === "node").map((e) => `${e.node}:${e.to}`))); }
{ const r = E.start({ workflow: "noedge", text: "x" });
  await until(() => E.get(r.id)!.status === "failed", 10000); await sleep(300);
  const g = E.get(r.id)!;
  ok(/no edge takes it/.test(g.error ?? "") && g.nodes.slow.state === "skipped" && H.agents.jobs.get(g.nodes.slow.job ?? "")?.status === "cancelled", "a run that fails for want of an edge stops its siblings too", `${g.error} ${g.nodes.slow.state}`); }
H.stop();
end();
