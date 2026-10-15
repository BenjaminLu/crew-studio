// The first smoke test of v2's coding workflow (unit code-firstmate-smoke): the
// code-firstmate definition from packs/firstmate runs a two-way change on the
// sandbox repository end to end with the stub provider:
//   intent → worktree → spec (its checks) → dispatch card → door (two-way) → build
//   → build checks: the lint fails (a trailing space) → the refine loop compiles a
//   brief → build round 2 fixes it → CI (bun test, 2 shards), fail-first, shard
//   budget → fresh reviewer and the judged verdict (2 of 3) → the six gates on the
//   edge into the merge card → merge card → local merge → after-merge hooks
//   (self-update dry run, main CI, follow-up triage, retro) → clean up → merged.
// Every node and card is asserted in order.      bun tests/smoke-code.ts
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("smoke-code");
const root = join(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "crew-smoke-"));
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { Projects } = await import("../src/doors");
const { Worktrees } = await import("../src/worktrees");
const originalInstall = Worktrees.prototype.installDeps;
let installsBeforeDispatch = 0;
Worktrees.prototype.installDeps = async function (...args) { installsBeforeDispatch++; return originalInstall.apply(this, args); };
const def = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const H = await harness([def], { data, checkRoots: [] });
const E = H.engine;
installCode(E, { dataDir: data, projects: new Projects(data) });
const repo = join(data, "demo-repo");
const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: repo, stdout: "pipe" }).stdout.toString().trim();
const mainBefore = git("rev-parse", "main");

const intent = [
  "Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100); \\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\nimport { percent } from "../src/percent";\\n\\ntest("percent rounds to the cent", () => expect(percent(1999, 15)).toBe(300));\\n',
  "STUB_FIX src/percent.ts :: / 100);  => / 100);",
].join("\n");
const r = E.start({ workflow: "code-firstmate", text: intent, params: {} });
const waitCard = async (kind: string) => { await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000); return E.cards.list({ run: r.id, open: true }).find((c) => c.kind === kind); };

const dispatch = await waitCard("dispatch");
ok(!!dispatch && /percent/i.test(dispatch.title.en) && /[一-鿿]/.test(dispatch.title["zh-TW"]) && dispatch.options.map((o) => o.id).join(",") === "dispatch,rescope,drop", "the dispatch card comes after the spec, with its options and a Chinese zh-TW title", `${E.get(r.id)!.status} ${E.get(r.id)!.error}`);
ok(installsBeforeDispatch === 0, "spec reaches dispatch without dependency installation");
Worktrees.prototype.installDeps = originalInstall;
E.policies.setProject("sandbox", { install: false });
const spec = E.get(r.id)!.ctx.spec;
ok(spec?.done?.[0]?.includes("test/percent.test.ts") && spec.door?.kind === "two-way" && JSON.stringify(spec.scope) === '["src/percent.ts","test/percent.test.ts"]', "the coordinator's spec names the test, the door and the scope", JSON.stringify(spec));
const specChecks = E.ledger(r.id).filter((e) => e.node === "spec");
ok(["firstmate/spec-schema", "firstmate/done-lines-provable", "firstmate/caller-coverage", "firstmate/overlap", "core/ste-wording"].every((c) => specChecks.some((e) => e.check === c && e.verdict === "pass")), "the spec passed its deterministic checks", JSON.stringify(specChecks.map((e) => `${e.check}:${e.verdict}:${e.error ?? ""}`)));
await E.answer(dispatch!.id, { choice: "dispatch", by: "captain" });

const merge = await waitCard("merge");
const g = E.get(r.id)!;
ok(!!merge, "the merge card comes after the gates", `${g.status} ${g.error} ${JSON.stringify(Object.fromEntries(Object.entries(g.nodes).filter(([, n]) => n.state !== "pending").map(([k, n]) => [k, `${n.state}:${n.outcome}:${n.error ?? ""}`])))}`);
const L = E.ledger(r.id);
const lint = L.filter((e) => e.check === "firstmate/lints");
ok(lint.length === 2 && lint[0].verdict === "fail" && lint[0].findings[0]?.locator?.type === "file" && (lint[0].findings[0].locator as any).path === "src/percent.ts" && lint[1].verdict === "pass", "the forced failure: round 1's lint fails on src/percent.ts, round 2's passes", JSON.stringify(lint.map((e) => [e.verdict, e.findings[0]?.message, e.error])));
const brief = g.ctx.briefs?.build;
ok(brief?.round === 1 && brief.items.some((i: any) => i.check === "firstmate/lints" && i.where.startsWith("src/percent.ts")) && brief.quality === "pass" && !!brief.rootCause, "the refine loop compiled the brief from the lint finding (checked by brief-quality, with a root cause)", JSON.stringify(brief?.items));
ok(E.cards.list({ run: r.id }).filter((c) => c.kind !== "dispatch" && c.kind !== "merge").length === 0, "no human card in the inner loop");
const pass = (c: string) => L.filter((e) => e.check === c).at(-1)?.verdict === "pass";
ok(["firstmate/ci", "firstmate/fail-first", "firstmate/shard-budget", "firstmate/scope", "firstmate/covering-suites", "firstmate/report-schema"].every(pass), "CI (2 shards), fail-first, shard budget, scope, covering suites and the report pass on round 2",
  JSON.stringify(["firstmate/ci", "firstmate/fail-first", "firstmate/shard-budget", "firstmate/scope", "firstmate/covering-suites", "firstmate/report-schema"].map((c) => [c, L.filter((e) => e.check === c).at(-1)?.verdict, L.filter((e) => e.check === c).at(-1)?.error])));
const ci = L.filter((e) => e.check === "firstmate/ci").at(-1) as any;
ok(ci?.data?.shards?.length === 2 && ci.proves.includes(0), "CI ran the repository's 2 shards and proves the done line", JSON.stringify(ci?.data));
const rv = L.filter((e) => e.check === "firstmate/review-verdict").at(-1) as any;
ok(rv?.verdict === "pass" && rv.votes?.length === 3 && rv.blocking, "the reviewer's verdict counts as one of three votes of a blocking judged check", JSON.stringify(rv?.votes));
ok(["branch", "rebase", "scope", "failfirst", "ci", "approval"].every((x) => L.some((e) => e.check === `firstmate/gate-${x}` && e.verdict === "pass" && e.edge === "remote-ready→merge-card[ok]")), "the six gates passed on the edge into the merge card");
ok(merge!.door === "two-way" && /Proved by checks:\n✓ 1\./.test(merge!.body) && /Six gates:/.test(merge!.body), "the merge card shows the six gates and the ledger split (proved by checks / needs your eye)", merge!.body.slice(0, 400));
// (unit intent-merge-card) the merge card carries intent lines: the captain ticks every one
ok((merge!.detail?.intents?.length ?? 0) > 0 && merge!.captainOnly === true, "the merge card carries the intent lines to tick and is captain-only (an authorization window never answers it)");
await E.answer(merge!.id, { choice: "merge", by: "captain", aligned: merge!.detail!.intents.map((_, i) => i) });
await until(() => ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000);
const f = E.get(r.id)!;
ok(f.status === "succeeded" && f.result === "done", "the run reaches Merged", `${f.status} ${f.error}`);
// every step counts, in the order it ran: a step a later visit of its node superseded ran too (here build's round 1)
ok(JSON.stringify(f.steps.filter((s: any) => s.state === "superseded").map((s: any) => `${s.node}#${s.visit}`)) === JSON.stringify(["build#1"]), "the superseded steps are exactly the earlier visits of nodes that ran again (build round 1), and they count in the order",
  JSON.stringify(f.steps.filter((s: any) => s.state === "superseded").map((s: any) => `${s.node}#${s.visit}`)));
const order = f.steps.map((s) => s.node);
const expected = ["intake", "prepare", "spec", "dispatch", "door", "build", "fix", "build", "pr-open", "ci", "review", "remote-ready", "merge-card", "merge", "after-merge", "cleanup", "done"];
ok(JSON.stringify(order) === JSON.stringify(expected), "every node ran in the pipeline's order", JSON.stringify(order));
ok(git("rev-parse", "main") !== mainBefore && existsSync(join(repo, "src/percent.ts")) && /^feat: /.test(git("log", "-1", "--format=%s", "main")) && Bun.spawnSync(["bun", "test"], { cwd: repo }).exitCode === 0, "main fast-forwarded to the change (a Conventional Commit) and its tests pass", git("log", "--oneline", "-3", "main"));
ok(git("branch", "--list", "feature/*").includes(`feature/${r.id}`) && git("worktree", "list").split("\n").length === 1, "the work was on a feature/ branch; its worktree is cleaned up");
const hooks = f.ctx.hooks?.["after-merge"] ?? [];
ok(["firstmate/self-update", "firstmate/main-ci", "firstmate/follow-up-triage", "firstmate/retro-trigger"].every((c) => hooks.some((h: any) => h.check === c && h.verdict === "pass")) && hooks.find((h: any) => h.check === "firstmate/self-update")?.data?.dry_run === true, "after the merge: self-update (a dry run), main CI, follow-up triage and the retro trigger", JSON.stringify(hooks.map((h: any) => `${h.check}:${h.verdict}`)));
ok(E.trusted(r.id).ok && E.doneLines(f)[0].proved, "the ledger verifies and the done line is proved by checks");
// the worktree rules: data/work/<project>/<task>, rounds at the durable head with the brief bound, hand-back commits with trailers
const wtPath = join(data, "work", "wt", "sandbox", r.id);
ok(f.ctx.worktree === wtPath && f.ctx.wt?.project === "sandbox" && !existsSync(wtPath), "the task's worktree was data/work/wt/sandbox/<run>, and it is gone after the merge", f.ctx.worktree);
const starts = E.ledger(r.id).filter((e: any) => e.record === "round-start" && e.node === "build") as any[];
ok(starts.length === 2 && starts[0].data.brief === null && starts[1].data.brief === `build@1:${String(f.ctx.rounds?.[0]?.head).slice(0, 12)}` && starts[1].data.ledger.length > 0 && starts[1].head === f.ctx.rounds?.[0]?.head, "each build round started at the durable head; round 2's brief is bound to round 1's head and its ledger entries", JSON.stringify(starts.map((e) => [e.head?.slice(0, 8), e.data])));
// one hand-back commit per round, each with its own trailers
{ const per = (n: number) => git("log", "--format=%an|%B%x00", "main").split("\0").find((m) => new RegExp(`Crew-Round: ${n}\\b`).test(m)) ?? "";
  const ok1 = (m: string, n: number) => /^\s*Crew agent \(stub·no model\)\|/.test(m) && new RegExp(`Crew-Run: ${r.id}\\b`).test(m) && /Crew-Node: build\b/.test(m) && new RegExp(`Crew-Round: ${n}\\b`).test(m) && /Crew-Agent: stub·no model/.test(m);
  ok(ok1(per(1), 1) && ok1(per(2), 2), "each round handed back its own commit as the agent: round 1's and round 2's, each with run, node, round and agent trailers", JSON.stringify([per(1).slice(0, 200), per(2).slice(0, 200)])); }
ok(existsSync(join(data, "runs", r.id, "nodes", "build", "2", "prompt.md")) && /BRIEF for round 2/.test(readFileSync(join(data, "runs", r.id, "nodes", "build", "2", "prompt.md"), "utf8")), "every agent round left its exact prompt (round 2's carries the brief)");
ok(merge!.options.filter((o) => o.hold).map((o) => o.id).join(",") === "changes,close", "on the merge card, request changes and close are hold options (no door confirmation)");
// a remote that cannot be read stops the build round before its agent starts, and code-firstmate routes it to the scope card
{ const b = E.start({ workflow: "code-firstmate", text: intent, params: {} });
  await until(() => E.cards.list({ run: b.id, open: true }).some((k) => k.kind === "dispatch"), 120000);
  git("remote", "add", "origin", join(data, "no-such-remote.git"))
  await E.answer(E.cards.list({ run: b.id, open: true }).find((k) => k.kind === "dispatch")!.id, { choice: "dispatch", by: "captain" });
  await until(() => E.cards.list({ run: b.id, open: true }).some((k) => k.kind === "scope") || ["failed", "succeeded"].includes(E.get(b.id)!.status), 60000);
  const sc = E.cards.list({ run: b.id, open: true }).find((k) => k.kind === "scope");
  git("remote", "remove", "origin");
  ok(!!sc && /cannot read the remote head/.test(sc.body) && E.get(b.id)!.nodes.build.outcome === "blocked" && !(E.get(b.id)!.nodes.build.data.jobs ?? []).length,
    "a remote that cannot be read stops the build round before its agent starts (blocked), and code-firstmate's [build, scope-card, blocked] edge opens the scope card", JSON.stringify([E.get(b.id)!.status, E.get(b.id)!.error, sc?.body?.slice(0, 200), E.cards.list({ run: b.id, open: true }).map((k) => k.kind + ":" + k.node), Object.entries(E.get(b.id)!.nodes).filter(([, n]: any) => n.state !== "pending").map(([k, n]: any) => `${k}:${n.state}:${n.outcome}`)]));
  await E.cancel(b.id, "captain"); }
// A worker escalation must reach the captain before build checks can mask it.
{ const b = E.start({ workflow: "code-firstmate", text: intent.replaceAll("percent", "blockedPercent") + "\nSTUB_BLOCKED", params: {} });
  await until(() => E.cards.list({ run: b.id, open: true }).some(c => c.kind === "dispatch"), 120000);
  await E.answer(E.cards.list({ run: b.id, open: true }).find(c => c.kind === "dispatch")!.id, { choice: "dispatch", by: "captain" });
  await until(() => E.cards.list({ run: b.id, open: true }).some(c => c.kind === "scope") || ["failed", "succeeded"].includes(E.get(b.id)!.status), 60000);
  const run = E.get(b.id)!;
  ok(run.nodes.build.outcome === "blocked" && run.nodes.build.visits === 1 && E.cards.list({ run: b.id, open: true }).some(c => c.kind === "scope"), "worker SCOPE-BLOCKED reaches the captain once, without a retry loop");
  ok(!E.ledger(b.id).some(e => e.node === "build" && e.check.startsWith("firstmate/")) && run.nodes.ci.state === "pending", "an incomplete build gets no check PASS or CI evidence");
  await E.cancel(b.id, "captain");
}
// a cancelled run's worktree is cleaned up too
{ const c = E.start({ workflow: "code-firstmate", text: intent, params: {} });
  await until(() => E.cards.list({ run: c.id, open: true }).some((k) => k.kind === "dispatch"), 120000);
  const p = E.get(c.id)!.ctx.worktree; const existed = !!p && existsSync(p);
  E.cancel(c.id, "captain"); await until(() => !existsSync(p), 10000);
  ok(existed && !existsSync(p) && !git("worktree", "list").includes(c.id), "cancelling a run removes its worktree (and its git worktree entry)", p); }
H.stop();
end();
