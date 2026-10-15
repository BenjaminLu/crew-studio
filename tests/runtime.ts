// The v2 runtime backbone (docs/architecture.md §3–§6, docs/check-contract.md):
// versioned definitions and validation, the five node kinds, the run state
// machine as a fold of its events, restart recovery, hot swap with a hand-off,
// cards answered exactly once (auth window, one-way confirmation, STE), the
// check runtime (params from schema → policy → workflow → run, the sandbox, an
// exit-code adapter, natives, judged checks with locators and quorum, hooks,
// crash/bad JSON/timeout = error), the signed ledger and the done-line map.
// Stub provider only; temporary data.     bun tests/runtime.ts
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const here = import.meta.dir;
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(40); } return f(); };

const { Agents } = await import("../src/agent");
const { stubProvider } = await import("../src/providers/stub");
const { StudioLog } = await import("../src/rawlog");
const { WorkflowDefs, validate, normalize, diff } = await import("../src/runtime/defs");
const { Engine, fold } = await import("../src/runtime/engine");
const { Ledger, doneMap, parseOutput } = await import("../src/runtime/checks");

// ---------- a harness: an engine over temporary data, with a tool route for the stub agents ----------
function harness(flows: string[], o: { policies?: string } = {}) {
  const data = mkdtempSync(join(tmpdir(), "crew-rt-"));
  if (o.policies) { mkdirSync(join(data, "policies"), { recursive: true }); writeFileSync(join(data, "policies", "org.yaml"), o.policies); }
  let port = 0;
  const agents = new Agents(data, () => `http://127.0.0.1:${port}`);
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (req) => {
    const u = new URL(req.url); const t = req.headers.get("x-crew-tool-token") ?? "";
    if (u.pathname === "/api/tools") return Response.json(agents.toolList(t));
    let a: any = {}; try { a = await req.json(); } catch {}
    return Response.json(await agents.callTool(t, decodeURIComponent(u.pathname.slice("/api/tools/".length)), a));
  } });
  port = srv.port;
  const sent: any[] = [];
  const provider = (id?: string, model?: string) => { const p = stubProvider(); return { ...p, id: id || "stub", model: model || "no model", start: p.start }; };
  const defs = new WorkflowDefs(data, () => flows);
  const engine = new Engine({ dataDir: data, agents, provider, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(data, "events.jsonl")), send: (t, d) => sent.push([t, d]),
    skillText: () => "# Test skill\n", checkRoots: [join(here, "fixture/checks")] } as any, defs);
  // a scriptable agent mode: the prompt carries "Call:" lines the stub makes
  engine.modes.test = { tools: (x) => [{ name: "note_write", description: "write a note", schema: { type: "object" }, run: (a: any) => { x.rn.data = { ...x.rn.data, wrote: a }; if (a.flag) writeFileSync(a.flag, "fixed"); return { ok: true }; } }],
    system: () => "test", prompt: (x) => `TEST AGENT\n${x.node.args?.say ?? ""}\n${(x.ctx.briefs?.[x.node.id]?.text ?? "")}\n${x.run.text}`, after: (x) => (x.node.args?.outcome ?? "ok"),
    handoffState: () => "state: half done", onTimeout: (x) => { x.rn.data = { ...x.rn.data, keptWork: true }; } };
  engine.natives["test-native"] = (i) => ({ verdict: i.params.want, score: i.params.want === "pass" ? 1 : 0, findings: i.params.want === "fail" ? [{ locator: { type: "card", field: "x" }, message: "native says no", expected: "yes", class: "nat", severity: "blocking" }] : [] });
  engine.actions["set"] = (x) => { x.ctx[x.node.args!.key] = x.node.args!.value; return x.node.args?.out ?? "ok"; };
  engine.actions["merge-sim"] = (x) => { x.ctx.merged = { at: new Date().toISOString() }; return "ok"; };
  return { data, engine, defs, agents, sent, stop: () => srv.stop(true) };
}
const Y = (o: any) => JSON.stringify(o); // JSON is YAML

// ---------- 1. definitions: validation, versions, diff, layout ----------
{
  const good = { id: "w1", name: "W1", version: 1, roles: [{ id: "r", label: "R", skill: "x" }], nodes: [
    { id: "a", kind: "hook", label: "A", do: "set", args: { key: "k", value: 1 }, x: 0, y: 0 }, { id: "b", kind: "check", label: "B", checks: [{ use: "t/ok" }], x: 100, y: 0 }, { id: "c", kind: "hook", label: "End", x: 200, y: 0 }],
    edges: [["a", "b"], ["b", "c", "pass"]] };
  const h = harness([Y(good)]);
  const known = (r: string) => !!h.engine.registry.get(r);
  ok(validate(normalize(good), known).filter((p) => p.level === "error").length === 0, "a valid workflow has no errors (entry = the node no edge reaches, end = the node no edge leaves)");
  const bad = (patch: (d: any) => void) => { const d = JSON.parse(JSON.stringify(good)); patch(d); return validate(normalize(d), known).filter((p) => p.level === "error").map((p) => p.text).join(" | "); };
  ok(/unknown kind/.test(bad((d) => { d.nodes[1].kind = "router"; })), "only the five node kinds are allowed (agent, check, card, loop, hook)");
  ok(/orphan/.test(bad((d) => { d.nodes.push({ id: "z", kind: "hook", label: "Z", do: "set", x: 0, y: 0 }); d.edges.push(["z", "z"]); })), "a node no path reaches is an orphan");
  ok(/no path from here reaches an end/.test(bad((d) => { d.nodes.push({ id: "loopy", kind: "hook", label: "Loopy", do: "set", x: 0, y: 0 }); d.edges.push(["b", "loopy", "fail"], ["loopy", "b"]); d.edges = d.edges.filter((e: any) => !(e[0] === "b" && e[1] === "c")); })), "every node must reach an end");
  ok(/needs at least one check attached/.test(bad((d) => { d.nodes[1].checks = []; })), "a check node needs a check attached");
  ok(/no check t\/nope/.test(bad((d) => { d.nodes[1].checks = [{ use: "t/nope" }]; })), "an unknown check is an error");
  ok(/exactly one entry/.test(bad((d) => { d.nodes.push({ id: "y", kind: "hook", label: "Y", do: "set", x: 0, y: 0 }); d.edges.push(["y", "c"]); })), "two entries are refused");
  ok(h.defs.get("w1")?.version === 1 && h.defs.versions("w1").length === 1, "the built-in becomes v1");
  let refused = ""; try { h.defs.save("w1", { base: 1, nodes: h.defs.get("w1")!.nodes, edges: h.defs.get("w1")!.edges }, "t"); } catch (e: any) { refused = e.message; }
  ok(/nothing changed/.test(refused), "saving with no change is refused");
  const v1 = h.defs.get("w1")!;
  const v2 = h.defs.save("w1", { base: 1, nodes: [...v1.nodes.map((n) => (n.id === "b" ? { ...n, x: 150, label: "B2" } : n)), { id: "d", kind: "hook", label: "D", do: "set", x: 300, y: 0 }], edges: [...v1.edges.filter((e) => e.to !== "c"), { from: "b", to: "d", when: "pass" }, { from: "d", to: "c" }] }, "captain", "add d");
  ok(v2.version === 2 && v2.diff!.nodesAdded.includes("d") && v2.diff!.nodesChanged.some((c) => c.id === "b" && c.fields.includes("label")) && v2.diff!.nodesMoved.includes("b") && v2.diff!.edgesAdded.includes("b→d[pass]") && v2.diff!.edgesRemoved.includes("b→c[pass]"), "an edit becomes v2 with a diff (added, changed, moved, edges)", JSON.stringify(v2.diff));
  ok(h.defs.get("w1", 1)!.nodes.length === 3, "v1 stays as it was");
  let stale = ""; try { h.defs.save("w1", { base: 1, nodes: v1.nodes, edges: v1.edges, description: "x" }, "t"); } catch (e: any) { stale = e.message; }
  ok(/is the latest now/.test(stale), "an edit of an old version is refused (no lost update)");
  h.defs.setLayout("w1", 1, { a: { x: 42, y: 7 } });
  ok(h.defs.get("w1", 1)!.nodes.find((n) => n.id === "a")!.x === 42 && h.defs.get("w1", 2)!.nodes.find((n) => n.id === "a")!.x === 0, "dragged positions persist per version without a new version");
  ok(h.defs.versions("w1").length === 2, "a layout change is not a new version");
  h.stop();
}

// ---------- a shared harness for runs ----------
const flows: any[] = [];
const F = (o: any) => { flows.push(Y({ roles: [{ id: "worker", label: "Worker", skill: "x" }, { id: "coord", label: "Coord", skill: "x" }], ...o })); return o.id; };
F({ id: "checks", name: "checks", nodes: [
  { id: "a", kind: "hook", label: "A", do: "set", args: { key: "spec", value: { done: ["proved by t/ok", "proved by failer once fixed", "nobody proves this"] } }, x: 0, y: 0 },
  { id: "k", kind: "check", label: "K", checks: [{ use: "t/ok" }, { use: "t/crash", blocking: false }, { use: "t/badjson", blocking: false }, { use: "t/badverdict", blocking: false }, { use: "t/slow", blocking: false }, { use: "t/ex-adapter", blocking: false }, { use: "t/ex-adapter", params: { code: "0" }, blocking: false },
    { use: "t/nat", blocking: false }, { use: "t/nat", params: { want: "fail" }, blocking: false }, { use: "t/judge1" }, { use: "t/judge2", blocking: false }, { use: "t/typed", blocking: false }, { use: "t/typed", params: { limit: "3" }, blocking: false }], x: 1, y: 0 },
  { id: "end", kind: "hook", label: "End", x: 2, y: 0 }], edges: [["a", "k"], ["k", "end", "pass"]], policies: { test: { n: 9 } } });
F({ id: "par", name: "parallel", nodes: [
  { id: "a", kind: "hook", label: "A", do: "set", args: { key: "a", value: 1 }, x: 0, y: 0 },
  { id: "p1", kind: "agent", label: "P1", role: "worker", mode: "test", args: { say: "STUB_SLOW" }, x: 1, y: 0 }, { id: "p2", kind: "agent", label: "P2", role: "worker", mode: "test", args: { say: "STUB_SLOW" }, x: 1, y: 1 },
  { id: "j", kind: "hook", label: "Join", do: "set", args: { key: "joined", value: true }, join: "all", x: 2, y: 0 }, { id: "end", kind: "hook", label: "End", x: 3, y: 0 }],
  edges: [["a", "p1"], ["a", "p2"], ["p1", "j"], ["p2", "j"], ["j", "end"]] });
F({ id: "cardflow", name: "cards", nodes: [
  { id: "a", kind: "hook", label: "A", do: "set", args: { key: "door", value: { door: "one-way" } }, x: 0, y: 0 },
  { id: "q", kind: "card", label: "Merge?", args: { card_kind: "merge" }, card: { title: { en: "Merge {{run.title}}", "zh-TW": "合併 {{run.title}}" }, body: { en: "It is ready.", "zh-TW": "已經準備好了。" }, confirm_door: true, door_from: "door", options: [{ id: "merge", label: "Merge" }, { id: "close", label: "Close", hold: true }] }, x: 1, y: 0 },
  { id: "m", kind: "hook", label: "Merge", do: "merge-sim", x: 2, y: 0 }, { id: "end", kind: "hook", label: "Merged", x: 3, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 3, y: 1 }],
  edges: [["a", "q"], ["q", "m", "merge"], ["q", "closed", "close"], ["m", "end"]] });
F({ id: "edgeck", name: "edge checks", nodes: [
  { id: "a", kind: "hook", label: "A", do: "set", args: { key: "k", value: 1 }, x: 0, y: 0 }, { id: "b", kind: "hook", label: "B", do: "set", args: { key: "k", value: 2 }, x: 1, y: 0 },
  { id: "end", kind: "hook", label: "End", x: 2, y: 0 }, { id: "blocked", kind: "hook", label: "Blocked", args: { result: "blocked" }, x: 2, y: 1 }],
  edges: [["a", "b"], { from: "b", to: "end", checks: [{ use: "t/nat", params: { want: "fail" } }] }, ["b", "blocked", "fail"]] });
F({ id: "slowflow", name: "slow", nodes: [
  { id: "a", kind: "hook", label: "A", do: "set", args: { key: "a", value: 1 }, x: 0, y: 0 },
  { id: "b", kind: "agent", label: "Slow agent", role: "worker", mode: "test", args: { say: "STUB_SLOW" }, x: 1, y: 0 },
  { id: "c", kind: "hook", label: "C", do: "set", args: { key: "c", value: 1 }, x: 2, y: 0 }, { id: "end", kind: "hook", label: "End", x: 3, y: 0 }],
  edges: [["a", "b"], ["b", "c"], ["c", "end"]] });
F({ id: "hang", name: "hang", nodes: [
  { id: "s", kind: "hook", label: "Start", do: "set", args: { key: "s", value: 1 }, x: -1, y: 0 },
  { id: "b", kind: "agent", label: "Hangs", role: "worker", mode: "test", timeout_s: 1, args: { say: "STUB_HANG" }, x: 0, y: 0 },
  { id: "fix", kind: "loop", label: "Fix", args: { producer: "b", round_cap: 1 }, x: 1, y: 1 },
  { id: "end", kind: "hook", label: "End", x: 1, y: 0 }, { id: "capped", kind: "hook", label: "Capped", args: { result: "capped" }, x: 2, y: 1 }, { id: "sb", kind: "hook", label: "Step back", args: { result: "step-back" }, x: 2, y: 2 }],
  edges: [["s", "b"], ["b", "end", "ok"], ["b", "fix", "fail|timeout"], ["fix", "b", "retry|report"], ["fix", "capped", "cap"], ["fix", "sb", "step-back|stalled"], ["fix", "end", "pass"]] });
F({ id: "levels", name: "policy levels", nodes: [
  { id: "a", kind: "hook", label: "A", do: "set", args: { key: "a", value: 1 }, x: 0, y: 0 },
  { id: "k1", kind: "check", label: "Before the card", checks: [{ use: "t/ok" }], x: 1, y: 0 },
  { id: "q", kind: "card", label: "More", card: { title: { en: "Raise n", "zh-TW": "調高 n" }, options: [{ id: "more", label: "More" }], effects: { more: { policy: "test.n", add: 5 } } }, x: 2, y: 0 },
  { id: "k2", kind: "check", label: "After the card", checks: [{ use: "t/ok" }], x: 3, y: 0 }, { id: "end", kind: "hook", label: "End", x: 4, y: 0 }],
  edges: [["a", "k1"], ["k1", "q", "pass"], ["q", "k2", "more"], ["k2", "end", "pass"]] });
F({ id: "hooky", name: "hooks", hooks: [{ at: "after:m", use: "t/hk" }], nodes: [
  { id: "m", kind: "hook", label: "M", do: "merge-sim", x: 0, y: 0 }, { id: "after", kind: "hook", label: "After", checks: [{ use: "t/hk" }], x: 1, y: 0 }, { id: "end", kind: "hook", label: "End", x: 2, y: 0 }],
  edges: [["m", "after"], ["after", "end"]] });

const H = harness(flows, { policies: "test: { n: 7 }\nflaky: { retry: 1 }\n" });
const E = H.engine;
const done = (id: string, ms = 25000) => until(() => ["succeeded", "failed", "cancelled"].includes(E.get(id)!.status) || E.get(id)!.status === "waiting", ms);

// ---------- check runtime ----------
{
  const r = E.start({ workflow: "checks", text: "check the checks" });
  await done(r.id, 30000);
  const L = E.ledger(r.id); const by = (c: string, i = 0) => L.filter((e) => e.check === c)[i];
  ok(by("t/ok")?.verdict === "pass" && (by("t/ok") as any).data?.n === 9, "params: the workflow version's policy override beats org (n=9 over 7)", JSON.stringify((by("t/ok") as any)?.data));
  ok(existsSync(join(by("t/ok")!.dir!, "out", "seen.json")), "a check writes its evidence into out/");
  ok(by("t/crash")?.verdict === "error" && /exit 3/.test(by("t/crash")!.error ?? ""), "a crash is error, never pass (even with pass on stdout)");
  ok(by("t/badjson")?.verdict === "error" && /bad JSON/.test(by("t/badjson")!.error ?? ""), "bad JSON on stdout is error");
  ok(by("t/badverdict")?.verdict === "error" && /unknown verdict/.test(by("t/badverdict")!.error ?? ""), "an unknown verdict is error");
  ok(by("t/slow")?.verdict === "error" && /timeout/.test(by("t/slow")!.error ?? ""), "a check killed at timeout_s is error");
  const ad = (code: string) => L.find((e) => e.check === "t/ex-adapter" && e.params.code === code)!;
  ok(ad("1")?.verdict === "fail" && ad("1").findings.length === 2 && ad("1").findings[0].locator?.type === "file" && (ad("1").findings[0].locator as any).line === 12, "the exit-code adapter maps exit and parses file:line findings from the log");
  ok(ad("0")?.verdict === "pass", "the adapter passes on exit 0");
  const nat = (w: string) => L.find((e) => e.check === "t/nat" && e.params.want === w)!;
  ok(nat("pass")?.verdict === "pass" && nat("fail")?.verdict === "fail" && nat("fail").findings[0].class === "nat", "a native check speaks the same contract");
  const j1 = by("t/judge1")!, j2 = by("t/judge2")!;
  ok(j1.verdict === "fail" && j1.blocking === false && j1.findings.every((f) => f.locator) && (j1 as any).dropped === 1, "a judged finding without a locator is dropped; a judged check without a quorum never blocks", JSON.stringify({ v: j1.verdict, b: j1.blocking, d: (j1 as any).dropped }));
  ok((j2 as any).votes?.length === 3 && j2.verdict === "fail", "a quorum of 2 of 3 runs three independent judges");
  const ty = L.filter((e) => e.check === "t/typed"); const tyBad = ty.find((e) => e.params.limit === undefined)!, tyOk = ty.find((e) => e.params.limit === 3)!;
  ok(tyBad?.verdict === "error" && /limit is required/.test(tyBad.error ?? "") && tyOk?.verdict === "pass", "params are checked against the schema (a form string becomes an integer)");
  ok(E.get(r.id)!.status === "succeeded", "only blocking failures stop a check node (non-blocking errors are recorded)", E.get(r.id)!.error ?? "");
  const led = new Ledger(H.data, r.id);
  ok(led.verify().length === 0 && L.every((e) => e.sig && e.inputHash !== undefined && e.version), "every ledger entry is signed and chained, with version and input hash");
  const f = led.file(); const lines = readFileSync(f, "utf8").split("\n"); const t = JSON.parse(lines[0]); t.verdict = "pass"; lines[0] = JSON.stringify(t); writeFileSync(f + ".bak", readFileSync(f)); writeFileSync(f, lines.join("\n"));
  ok(led.verify().includes(1), "a tampered ledger entry fails verification"); writeFileSync(f, readFileSync(f + ".bak"));
  const dm = E.doneLines(r);
  ok(dm[0].proved && !dm[1].proved && !dm[2].proved, "the done-line map: a passing check's proves binds a line; unbound lines go to 'needs your eye'");
  ok(parseOutput('{"verdict":"pass","findings":[{"message":"m","locator":{"type":"timeline","from":2,"to":1}}]}', "x").findings[0].locator === null, "a malformed locator is not accepted");
}

// ---------- sandbox ----------
{
  const target = join(H.data, "should-not-exist.txt");
  const fake: any = { run: E.get([...E.runs.keys()][0])!, node: { id: "n", label: "n" }, rn: { visits: 1 }, visit: 1, ctx: {}, dir: "", policy: () => undefined };
  const man = E.registry.get("t/escape")!;
  const res = await E.exec(fake, man, { use: "t/escape" }, { run: "x", node: "n", round: 1, artifact: null, previous: null, spec: null, params: { target }, workdir: null, out: join(H.data, "sbx", "out") } as any, join(H.data, "sbx"));
  const sb = (await import("../src/runtime/checks")).sandboxInfo();
  ok(sb.ok && res.data?.wrote === false && res.data?.net === false && res.data?.out === true && !existsSync(target), "sandbox: inputs read-only, writes only in out/, no network (tests/sandbox.ts covers the rest)", JSON.stringify(res.data));
}

// ---------- the state machine: parallel, join, the fold, pause/resume, cancel ----------
{
  const r = E.start({ workflow: "par", text: "parallel" });
  await until(() => E.get(r.id)!.nodes.p1.state === "running" && E.get(r.id)!.nodes.p2.state === "running", 5000);
  ok(E.get(r.id)!.nodes.p1.state === "running" && E.get(r.id)!.nodes.p2.state === "running", "two out-edges run both targets in parallel");
  await done(r.id);
  ok(E.get(r.id)!.status === "succeeded" && E.get(r.id)!.ctx.joined === true && E.get(r.id)!.nodes.j.visits === 1, "join: all waits for both inputs and runs once");
  const evs = E.events(r.id);
  const folded = fold(evs)!; const snap = JSON.parse(readFileSync(join(E.rdir(r.id), "run.json"), "utf8"));
  ok(JSON.stringify(folded.nodes) === JSON.stringify(snap.nodes) && folded.status === snap.status && JSON.stringify(folded.ctx) === JSON.stringify(snap.ctx) && JSON.stringify(folded.steps) === JSON.stringify(snap.steps), "the snapshot is the fold of the events");
  ok(evs.filter((e) => e.type === "node").every((e) => e.ts && e.run && e.node && e.to && "from" in e && e.cause), "every node transition is {ts, run, node, from, to, cause}");
  ok(evs.some((e) => e.type === "run" && e.from === "running" && e.to === "succeeded"), "the run ends succeeded");
  ok(H.sent.some(([t, d]) => t === "wrun" && d.id === r.id && d.event?.type === "node"), "transitions stream over SSE");

  const r2 = E.start({ workflow: "slowflow", text: "pause me" });
  await until(() => E.get(r2.id)!.nodes.b.state === "running", 5000);
  E.pause(r2.id);
  await until(() => E.get(r2.id)!.nodes.b.state === "passed", 10000); await sleep(300);
  ok(E.get(r2.id)!.status === "paused" && E.get(r2.id)!.nodes.c.state === "pending", "pause: the running step finishes, nothing new starts");
  E.resume(r2.id); await done(r2.id);
  ok(E.get(r2.id)!.status === "succeeded" && E.get(r2.id)!.ctx.c === 1, "resume: the run goes on to the end");
  const r3 = E.start({ workflow: "slowflow", text: "cancel me" });
  await until(() => E.get(r3.id)!.nodes.b.state === "running" && !!E.get(r3.id)!.nodes.b.job, 5000);
  E.cancel(r3.id); await sleep(500);
  ok(E.get(r3.id)!.status === "cancelled" && E.get(r3.id)!.nodes.c.state === "pending" && H.agents.jobs.get(E.get(r3.id)!.nodes.b.job!)?.status === "cancelled", "cancel: the live agent stops, nothing else runs");
}

// ---------- restart recovery: replay the events, keep finished nodes, run the interrupted one again ----------
{
  const r = E.start({ workflow: "slowflow", text: "recover me" });
  await done(r.id);
  const evs = E.events(r.id);
  const cut = evs.findIndex((e) => e.type === "node" && e.node === "b" && e.to === "running");
  // a copy of the run as it was when the server died, mid "b": events up to and including b → running (+ the step and display events that follow it)
  let end = cut; while (end + 1 < evs.length && !(evs[end + 1].type === "node" || evs[end + 1].type === "run")) end++;
  const id2 = "R-900"; mkdirSync(E.rdir(id2), { recursive: true });
  writeFileSync(join(E.rdir(id2), "events.jsonl"), evs.slice(0, end + 1).map((e) => JSON.stringify({ ...e, run: id2, ...(e.type === "run_created" ? { run: { ...e.run, id: id2 } } : {}) })).join("\n") + "\n");
  const E2 = new Engine((E as any).deps, H.defs); E2.modes = E.modes; E2.actions = E.actions;
  E2.load();
  const rr = E2.get(id2)!;
  ok(!!rr && rr.recovered === 1 && rr.steps.some((s) => s.node === "b" && s.state === "interrupted"), "recovery replays the events and marks the interrupted step");
  await until(() => ["succeeded", "failed"].includes(E2.get(id2)!.status), 15000);
  const g = E2.get(id2)!;
  ok(g.status === "succeeded" && g.nodes.a.visits === 1 && g.nodes.b.visits === 1 && g.steps.filter((s) => s.node === "a").length === 1 && g.steps.filter((s) => s.node === "b").length === 2, "after a restart the finished node is not redone and the interrupted one runs again", JSON.stringify(g.steps.map((s) => `${s.node}:${s.state}`)));
}

// ---------- hot swap with a hand-off ----------
{
  const r = E.start({ workflow: "slowflow", text: "swap me" });
  await until(() => !!E.get(r.id)!.nodes.b.job && E.get(r.id)!.nodes.b.state === "running", 5000);
  await sleep(300);
  E.setAgent(r.id, "b", { provider: "stub", model: "other-model" });
  await done(r.id);
  const g = E.get(r.id)!; const jobs = g.nodes.b.data.jobs ?? [];
  const hf = join(H.data, "handoff", r.id, "b.md");
  ok(g.status === "succeeded" && jobs.length === 2 && jobs[0].status === "cancelled" && jobs[1].model === "other-model" && jobs[1].status === "done", "a swap stops the live node and the new agent finishes it", JSON.stringify(jobs));
  ok(existsSync(hf) && /## Inputs/.test(readFileSync(hf, "utf8")) && /## Progress/.test(readFileSync(hf, "utf8")) && /## Open findings/.test(readFileSync(hf, "utf8")) && /state: half done/.test(readFileSync(hf, "utf8")), "the hand-off file is data/handoff/<run>/<node>.md with inputs, progress, open findings and state");
  ok(H.agents.jobs.get(jobs[1].id)!.log.some(() => true) && g.steps.find((s) => s.node === "b" && s.handoff), "the step points at its hand-off");
}

// ---------- cards: exactly once, one-way confirmation, STE, auth window ----------
{
  const r = E.start({ workflow: "cardflow", text: "merge it" });
  await done(r.id);
  const c = E.cards.list({ run: r.id })[0];
  ok(E.get(r.id)!.status === "waiting" && c?.kind === "merge" && /[\u4e00-\u9fff]/.test(c.title["zh-TW"]) && /[\u4e00-\u9fff]/.test(c.sections["zh-TW"].why) && !/[\u4e00-\u9fff]/.test(c.title.en) && c.sections.en.why === "It is ready.", "a card carries its intent sections in en and in zh-TW (actually Chinese); the run waits", JSON.stringify(c?.title));
  let e1 = ""; try { await E.answer(c.id, { choice: "merge", by: "captain" }); } catch (e: any) { e1 = e.message; }
  ok(/confirm the door/.test(e1), "a one-way merge needs the explicit door confirmation");
  await E.answer(c.id, { choice: "merge", by: "captain", confirm: "one-way" });
  let e2 = ""; try { await E.answer(c.id, { choice: "close", by: "captain" }); } catch (e: any) { e2 = e.message; }
  await done(r.id);
  ok(/answered exactly once|not the one/.test(e2) && E.get(r.id)!.status === "succeeded" && E.get(r.id)!.result === "done", "a card is answered exactly once; the answer moves the run", e2);
  ok(E.ledger(r.id).some((e) => e.record === "card-answer" && e.actor === "captain" && e.data?.choice === "merge"), "the answer is signed into the ledger with its actor");
  const H2 = harness(flows);
  H2.engine.grants.add({ kinds: ["merge"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)");
  const r2 = H2.engine.start({ workflow: "cardflow", text: "auto" });
  await until(() => H2.engine.cards.list({ run: r2.id }).length > 0, 8000);
  const c2id = H2.engine.cards.list({ run: r2.id })[0].id;
  // The card is persisted before its STE check finishes; wait for the run to settle,
  // not for a desired card status, so an unintended auth-window answer still fails.
  await until(() => ["waiting", "succeeded", "failed", "cancelled"].includes(H2.engine.get(r2.id)!.status), 8000);
  await sleep(400); // observe any scheduled auth-window answer after the check finishes
  const c2 = H2.engine.cards.get(c2id)!;
  ok(c2.status === "open" && H2.engine.get(r2.id)!.status === "waiting", "an auth window never confirms a one-way door: the one-way merge card stays open");
  H2.stop();
}

// ---------- edge checks ----------
{
  const r = E.start({ workflow: "edgeck", text: "edge" }); await done(r.id);
  ok(E.get(r.id)!.result === "blocked" && E.timeline(r.id).some((e) => e.type === "edge_blocked"), "a blocking check on an edge stops the edge and re-routes as fail");
}

// ---------- policy levels: org → project → workflow version → run (a card's override) ----------
{
  mkdirSync(join(H.data, "policies"), { recursive: true }); writeFileSync(join(H.data, "policies", "project-p1.yaml"), "test: { n: 8 }\n");
  const r = E.start({ workflow: "levels", text: "levels", params: { project: "p1" } });
  await until(() => E.get(r.id)!.status === "waiting", 8000);
  const c = E.cards.list({ run: r.id })[0]; await E.answer(c.id, { choice: "more", by: "captain" });
  await until(() => E.get(r.id)!.status === "succeeded", 8000);
  const L = E.ledger(r.id).filter((e) => e.check === "t/ok");
  const before = L.find((e) => e.node === "k1") as any, after = L.find((e) => e.node === "k2") as any;
  ok(before?.data?.n === 8, "params: a project's policy beats org (n=8 over 7)", JSON.stringify(before?.data));
  ok(after?.data?.n === 13, "params: a card's run override adds to what resolved (8 + 5 = 13)", JSON.stringify(after?.data));
}

// ---------- a node killed at its time limit ends failed(cause=timeout) ----------
{
  const r = E.start({ workflow: "hang", text: "hang" }); await until(() => E.get(r.id)!.status === "succeeded", 30000);
  const g = E.get(r.id)!; const ev = E.events(r.id).find((e) => e.type === "node" && e.node === "b" && e.to === "failed");
  ok(ev?.cause === "timeout" && g.nodes.b.data.keptWork === true && g.result === "capped", "a node killed at its time limit ends failed(cause=timeout), keeps its work, and the loop takes it from there", `${ev?.cause} ${g.result}`);
}

// ---------- hooks ----------
{
  const r = E.start({ workflow: "hooky", text: "hooks" }); await done(r.id); await sleep(300);
  const L = E.ledger(r.id).filter((e) => e.check === "t/hk");
  ok(E.get(r.id)!.status === "succeeded" && L.length === 2 && L.every((e) => e.verdict === "fail" && !e.blocking), "a failing hook (node or lifecycle) is reported and never moves the run backward");
}

console.log(`\nruntime: ${pass} passed, ${fail} failed`);
H.stop();
process.exit(fail ? 1 : 0);
