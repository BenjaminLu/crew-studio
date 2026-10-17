import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Code Tasks on one repository run concurrently, like pull requests (a Studio v2
// standing rule, docs/v2-spec.md). The real code-firstmate definition, the stub
// provider and the sandbox repository: two Tasks writing the same file both get
// past spec (the overlap check only notes the other Task), both build before
// either merges, the first merges, the second's merge finds the base moved and
// sends it to a build round that rebases onto the first's change, the worker
// resolves the conflict listed under REBASE CONFLICTS, and it merges on top.
// A Task closed without merging drops out of the overlap note.
//                                         bun tests/concurrent-code-firstmate.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkedTempDir } from "./lib/git-hygiene.mjs";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("concurrent-code-firstmate");
const root = join(import.meta.dir, "..");
const data = checkedTempDir("crew-concurrent-cf-");
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { Projects } = await import("../src/doors");
const H = await harness([readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8")], { data, checkRoots: [] });
const E = H.engine;
installCode(E, { dataDir: data, projects: new Projects(data) });
E.policies.setProject("sandbox", { install: false });
const repo = join(data, "demo-repo");
const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: repo, stdout: "pipe" }).stdout.toString().trim();
const TERMINAL = ["succeeded", "failed", "cancelled"];

// the standing rule is in the product: the overlap check can never block again
const overlapYaml = readFileSync(join(root, "packs/firstmate/checks/overlap/check.yaml"), "utf8");
ok(/^blocking: false$/m.test(overlapYaml) && !/^blocking: true$/m.test(overlapYaml), "firstmate/overlap is declared non-blocking");

const task = (name: string, value: number, resolved: string, mod = "shared") => [
  `Add the ${name} constant to the ${mod} module`,
  `STUB_FILE src/${mod}.ts :: export const ${name} = ${value};\\n`,
  `STUB_FILE test/${name}.test.ts :: import { expect, test } from "bun:test";\\ntest("${name} is exported", async () => { const m: any = await import("../src/${mod}"); expect(m.${name}).toBe(${value}); });\\n`,
  `STUB_RESOLVE src/${mod}.ts :: ${resolved}`,
].join("\n");
const both = "export const alpha = 1;\\nexport const beta = 2;\\n";
const card = async (id: string, kind: string) => { await until(() => E.cards.list({ run: id, open: true }).some((c) => c.kind === kind) || TERMINAL.includes(E.get(id)!.status), 120000); return E.cards.list({ run: id, open: true }).find((c) => c.kind === kind); };
const answer = async (id: string, kind: string, choice: string, extra: any = {}) => { const c = await card(id, kind); if (!c) throw new Error(`no ${kind} card on ${id}: ${E.get(id)!.status} ${E.get(id)!.error} ${nodes(id)} ${JSON.stringify(E.cards.list({ run: id, open: true }).map((k) => [k.kind, k.title?.en, k.body?.slice(0, 300)]))}`); await E.answer(c.id, { choice, by: "captain", ...(kind === "merge" ? { aligned: (c.detail?.intents ?? []).map((_: any, i: number) => i) } : {}), ...extra }); };
const nodes = (id: string) => JSON.stringify(Object.fromEntries(Object.entries(E.get(id)!.nodes).filter(([, n]: any) => n.state !== "pending").map(([k, n]: any) => [k, `${n.state}:${n.outcome}:${n.error ?? ""}`])));

const a = E.start({ workflow: "code-firstmate", text: task("alpha", 1, both), params: {} });
await answer(a.id, "dispatch", "dispatch");
const b = E.start({ workflow: "code-firstmate", text: task("beta", 2, both), params: {} });
const bDispatch = await card(b.id, "dispatch");
const bOverlap = E.ledger(b.id).filter((e) => e.check === "firstmate/overlap").at(-1);
ok(!!bDispatch && bOverlap?.verdict === "pass" && bOverlap.findings.some((f) => f.severity === "minor" && f.message.includes(`${a.id}`) && f.message.includes("src/shared.ts")), "a second Task on the same file reaches dispatch: the overlap check passes and only notes the first Task", JSON.stringify(bOverlap?.findings ?? nodes(b.id)));
ok(!E.ledger(b.id).some((e) => e.node === "spec" && e.verdict === "fail") && E.get(b.id)!.nodes["spec-fix"]?.state !== "done", "the overlap never sends the spec to a refine round", nodes(b.id));
await answer(b.id, "dispatch", "dispatch");

const aMerge = await card(a.id, "merge"), bMerge = await card(b.id, "merge");
ok(!!aMerge && !!bMerge, "both Tasks build and reach their merge cards before either merges", `${nodes(a.id)} | ${nodes(b.id)}`);
const bBrief = readFileSync(join(data, "runs", b.id, "nodes", "build", "1", "prompt.md"), "utf8");
ok(/OTHER TASKS ON THESE PATHS/.test(bBrief) && bBrief.includes(`${a.id}`), "the second Task's build brief names the first Task as informational", bBrief.slice(0, 600));
const bSystem = readFileSync(join(data, "runs", b.id, "nodes", "build", "1", "system.md"), "utf8");
ok(bSystem.includes("Studio runtime rule: code Tasks on one repository run concurrently") && bSystem.includes("REBASE CONFLICTS"), "every worker gets the concurrent-Tasks runtime rule with its operating rules");

await answer(a.id, "merge", "merge");
await until(() => TERMINAL.includes(E.get(a.id)!.status), 120000);
ok(E.get(a.id)!.status === "succeeded" && E.get(a.id)!.result === "done", "the first Task merges", `${E.get(a.id)!.status} ${E.get(a.id)!.error}`);

await answer(b.id, "merge", "merge");
const bMerge2 = await card(b.id, "merge");
const rb = E.get(b.id)!;
ok(!!bMerge2 && bMerge2.id !== bMerge!.id, "the second Task's merge found the base moved, rebuilt and asks again", `${rb.status} ${rb.error} ${nodes(b.id)}`);
const starts = E.ledger(b.id).filter((e: any) => e.record === "round-start" && e.node === "build") as any[];
const refresh = starts.at(-1)?.data?.baseRefresh;
ok(!!refresh && refresh.conflicts?.some((c: any) => c.path === "src/shared.ts") && refresh.baseAfter === git("rev-parse", "main"), "its next build round rebased onto the first Task's merge and listed the conflict", JSON.stringify(refresh));
const conflictBrief = readFileSync(join(data, "runs", b.id, "nodes", "build", String(starts.at(-1).round), "prompt.md"), "utf8");
ok(/^BUILD ROUND\nRun .*\nREBASE CONFLICTS/m.test(conflictBrief) && /^- src\/shared\.ts$/m.test(conflictBrief), "that round's brief opens with REBASE CONFLICTS and the file", conflictBrief.slice(0, 500));
ok(E.cards.list({ run: b.id }).every((c) => c.kind === "dispatch" || c.kind === "merge"), "no captain card for the overlap or the conflict");

await answer(b.id, "merge", "merge");
await until(() => TERMINAL.includes(E.get(b.id)!.status), 120000);
ok(E.get(b.id)!.status === "succeeded" && E.get(b.id)!.result === "done" && git("show", "main:src/shared.ts") === both.replaceAll("\\n", "\n").trim(), "the second Task merges on top: main has both constants", `${E.get(b.id)!.status} ${E.get(b.id)!.error} ${git("show", "main:src/shared.ts")}`);

// a Task closed without merging is not "another Task on these paths" any more
const c = E.start({ workflow: "code-firstmate", text: task("gamma", 3, both, "extra"), params: {} });
await answer(c.id, "dispatch", "dispatch"); await answer(c.id, "merge", "close");
await until(() => E.get(c.id)!.status === "succeeded");
const d = E.start({ workflow: "code-firstmate", text: task("delta", 4, both, "extra"), params: {} });
await card(d.id, "dispatch");
const dOverlap = E.ledger(d.id).filter((e) => e.check === "firstmate/overlap").at(-1);
ok(E.get(c.id)!.result === "closed" && dOverlap?.verdict === "pass" && !dOverlap.findings.length, "a Task closed without merging drops out of the overlap note", JSON.stringify(dOverlap?.findings));
E.cancel(d.id, "captain");
await until(() => TERMINAL.includes(E.get(d.id)!.status));
H.stop();
end();
