import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Round path conformance: every registered agent mode, plus the judge/designer vote path
// and the code merge-card coordinator, builds the sandbox spec it would hand to Agents,
// and that spec passes the real round path check (the one rule in src/agent.ts) and opens
// the round under data/work, never in Studio's data (data/runs, ...).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { harness, suite } from "./rt-harness";
import { ArtifactStore } from "../src/artifacts";
import { Projects } from "../src/doors";
import { installCode } from "../src/domain/code";
import { installDeliver } from "../src/domain/deliver";
import { installCoffeeKit } from "../src/domain/coffee-kit";
import { installStartupRecursion } from "../src/domain/startup-recursion";
import { installPackGenesis } from "../src/pack-genesis";

const { ok, end } = suite("round paths");
const H = await harness([], { refine: true });
const data = H.data, artifacts = new ArtifactStore(data);
const protectedRoot = join(data, "..", `${data.split("/").pop()}-protected`); mkdirSync(protectedRoot, { recursive: true });
H.agents.protect = () => [protectedRoot];
installCode(H.engine, { dataDir: data, projects: new Projects(data) });
installDeliver(H.engine, { dataDir: data, artifacts, lane: {} as any, fileorg: {} as any, docs: {} as any });
installCoffeeKit(H.engine, { artifacts });
installStartupRecursion(H.engine, { artifacts });
const { pg } = installPackGenesis(H.engine, { dataDir: data, artifacts }) as any;
// the one rule, when this checkout has it extracted (it does after the fix; Agents uses it either way)
const rule: any = await import("../src/runtime/round-paths").catch(() => null);

// Agents' real path check: a sandboxed in-process provider, so nothing spawns; a refusal comes back as the job error
H.agents.toolUrl = () => H.toolUrl; (H.agents as any).egress = { port: 1, open() {}, close() {} };
const sandboxed = { id: "fixture", model: "fixture-model", sandboxNeeds: () => ({ inProcess: true, hosts: [], reads: [], tmpEnv: [] }),
  start() { return { interrupt() {}, async *send() { yield { type: "turnEnd", status: "ok" }; } }; } } as any;

const run = { id: "R-900", ctx: {}, params: {}, nodes: {}, def: { nodes: [] }, text: "", title: "fixture" } as any;
const worktree = join(data, "work", "wt", "fixture-project", "T-900"); mkdirSync(worktree, { recursive: true });
const reviewTree = join(data, "work", "wt", ".tmp", "R-900-review-head"); mkdirSync(reviewTree, { recursive: true });
const xFor = (mode: string, node = "n1") => {
  const x: any = { run, node: { id: node, mode, label: node, args: { round: 1 } }, visit: 1, rn: { attempt: 0, data: {} }, engine: H.engine, deps: H.engine.deps,
    ctx: { worktree, repo: worktree }, dir: join(data, "runs", run.id, "nodes", node), log() {}, save() {}, cancelled: () => false, policy: (_p: string, d: any) => d };
  // what each mode's begin records before its round starts (read by older sandbox specs)
  x.rn.data.dir = join(data, "work", "deliver", run.id, `${node}-1-0`); x.rn.data.coffeeWork = join(data, "work", "coffee", run.id, `page-${node}-1-0`);
  if (mode === "review") x.rn.data.tree = reviewTree;
  return x;
};
pg.init(xFor("pack-interview")); // the real pack genesis record its rounds work in
const producers: [string, () => any][] = [
  ...Object.entries(H.engine.modes).map(([name, mode]) => [`mode ${name}`, () => { const x = xFor(name); return H.engine.roundSandbox(x, mode.sandbox?.(x) ?? null); }] as [string, () => any]),
  ["judge/designer vote", () => H.engine.roundSandbox(xFor("judge", "check"), null, "judge-designer-1")],
  ["code merge-card coordinator", () => H.engine.roundSandbox(xFor("merge", "merge"), null, "merge-card")],
];
const expected = ["spec", "plan", "plan-accept", "build", "review", "deliver", "coffee-page", "startup-pitch", "startup-judge", "rootcause",
  "pack-interview", "pack-samples", "pack-author", "pack-refine", "pack-propose", "pack-produce"];
ok(expected.every((m) => H.engine.modes[m]), "every known round producer is registered here (the enumeration is not vacuous)", expected.filter((m) => !H.engine.modes[m]).join(","));

for (const [name, build] of producers) {
  let spec: any, err = "";
  try { spec = build(); } catch (e: any) { err = String(e?.message ?? e); }
  if (!spec) { ok(false, `${name}: builds a sandbox spec`, err); continue; }
  const job = await H.agents.run({ kind: `t:${name}`, title: name, system: "s", text: "x", tools: [], provider: sandboxed, timeoutMs: 5000, sandbox: spec });
  ok(!/a round may not reach/.test(job.error ?? ""), `${name}: passes Agents' round path check`, `${job.error} ${JSON.stringify(spec)}`);
  if (rule) ok(rule.roundPathRefusal(data, H.agents.protect(), spec) === null, `${name}: passes the shared round path rule`, JSON.stringify(spec));
  const work = join(data, "work") + "/";
  ok(typeof spec.cwd === "string" && spec.cwd.startsWith(work), `${name}: opens under data/work`, String(spec.cwd));
  ok([...spec.writes, ...(spec.reads ?? [])].every((p: string) => p.startsWith(work)), `${name}: reads and writes only under data/work`, JSON.stringify(spec));
}
// a reviewer/designer that reads a worktree read-only still reaches it
{ const x = xFor("review"); const s = H.engine.modes.review.sandbox!(x)!; ok(s.writes.length === 0 && s.reads?.[0] === reviewTree && s.cwd === reviewTree, "review reads its checkout read-only and opens in it", JSON.stringify(s)); }
// the rule still refuses Studio's data and protected roots
{ const bad = await H.agents.run({ kind: "t", title: "bad", system: "s", text: "x", tools: [], provider: sandboxed, timeoutMs: 5000, sandbox: { writes: [], cwd: join(data, "runs", run.id) } });
  ok(/^refused: a round may not reach .*runs\/R-900 \(only its worktree, never Studio's data or a protected root\)$/.test(bad.error ?? ""), "a round in data/runs is still refused", bad.error ?? "");
  const prot = await H.agents.run({ kind: "t", title: "prot", system: "s", text: "x", tools: [], provider: sandboxed, timeoutMs: 5000, sandbox: { writes: [], reads: [protectedRoot] } });
  ok(/a round may not reach/.test(prot.error ?? ""), "a round reading a protected root is still refused", prot.error ?? ""); }
H.stop(); end();
