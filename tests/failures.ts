import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// One failure taxonomy across every workflow (captain decision 2026-10-16): each class has its card, its actions,
// and its next action; Retry or Rescope with no change is refused with an explanation; nothing is a generic error.
//   bun tests/failures.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("failures");
const F = await import("../src/runtime/failures");
const root = join(import.meta.dir, "..");

const flows: string[] = [];
const W = (o: any) => { flows.push(Y({ roles: [{ id: "worker", label: "Worker", skill: "x" }], ...o })); return o.id; };
// one step that fails the way the run's "mode" param says, then succeeds once the captain's action changed what it needs
W({ id: "fx", name: "failure fixture", params: { mode: { default: "" }, want: { default: "fail", options: ["pass", "fail", "maybe"] }, project: { default: "p1" } }, nodes: [
  { id: "act", kind: "hook", label: "Act", do: "act", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["act", "end", "ok"]] });
W({ id: "ag", name: "agent asks", nodes: [{ id: "build", kind: "agent", label: "Build", role: "worker", mode: "asker", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["build", "end", "ok"]] });
// a → (b, c) → d (join all): b fails while c still runs
W({ id: "par", name: "parallel join", nodes: [{ id: "a", kind: "hook", label: "A", do: "set", args: { key: "a", value: 1 }, x: 0, y: 0 },
  { id: "b", kind: "hook", label: "B", do: "flaky", x: 1, y: 0 }, { id: "c", kind: "hook", label: "C", do: "slow", x: 1, y: 1 },
  { id: "d", kind: "hook", label: "D", do: "set", args: { key: "joined", value: true }, join: "all", x: 2, y: 0 }, { id: "end", kind: "hook", label: "End", x: 3, y: 0 }],
  edges: [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["d", "end"]] });
// p → k (card) → m: m fails because something changed after the card; a fresh preparation goes back to p
W({ id: "pg", name: "prepare again", nodes: [{ id: "p", kind: "hook", label: "Prepare", do: "set", args: { key: "prepared", value: true }, x: 0, y: 0 },
  { id: "k", kind: "card", label: "Merge card", card: { title: "Merge?", body: "merge", options: [{ id: "merge", label: "Merge", labelZh: "Merge", primary: true }] }, x: 1, y: 0 },
  { id: "m", kind: "hook", label: "Merge", do: "merge-once", x: 2, y: 0 }, { id: "end", kind: "hook", label: "End", x: 3, y: 0 }], edges: [["p", "k"], ["k", "m", "merge"], ["m", "end", "ok"]] });
// a run whose last step fails ends "succeeded · fail": it is never revived
// an internal workflow (its id is on the internal list): no new task from its card
W({ id: "firstmate-proposal", name: "internal fixture", params: { mode: { default: "stale" } }, nodes: [{ id: "act", kind: "hook", label: "Act", do: "act", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["act", "end", "ok"]] });
W({ id: "endfail", name: "ends on fail", nodes: [{ id: "only", kind: "hook", label: "Only", do: "act", x: 0, y: 0 }], edges: [] });
// an agent round stopped before its agent (a worktree round's RoundBlocked) with no "blocked" edge (R-066 H6)
W({ id: "rb", name: "round blocked", nodes: [{ id: "spec", kind: "agent", label: "Spec", role: "worker", mode: "remote-blocked", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["spec", "end", "ok"]] });
const H = await harness(flows);
const E = H.engine;
let envFixed = false;
E.failureBackoff = () => 60; // the real schedule is 5 s, 30 s, 2 min, 10 min: shortened here
E.failureProbes["env.test-command"] = () => (envFixed ? null : "package.json still has no scripts.test");
E.actions.flaky = (x) => { x.run.ctx.flakyTries = (x.run.ctx.flakyTries ?? 0) + 1; if (x.run.ctx.netOk) return "ok"; throw new Error("fetch failed: ECONNRESET"); };
E.actions.slow = async (x) => { x.run.ctx.slowRuns = (x.run.ctx.slowRuns ?? 0) + 1; await new Promise((res) => setTimeout(res, 300)); return "ok"; };
E.actions["merge-once"] = (x) => { x.run.ctx.mergeTries = (x.run.ctx.mergeTries ?? 0) + 1; if (x.run.ctx.mergeTries > 1) return "ok"; throw new Error(x.run.params.mode === "door" ? "a one-way change needs the door confirmation on the merge card" : "the branch moved since the seven gates ran"); };
E.actions.act = (x) => {
  const m = x.run.params.mode, fa = x.rn.data.failureAnswer;
  if (m === "ask") { if (fa?.kind === "answer") return "ok"; x.rn.data.escalation = { reason: "The currency is a pricing choice only the captain sets." }; return { outcome: "ask", note: "Which currency does the total use?" }; }
  if (m === "env") { if (envFixed) return "ok"; throw new F.FailureError("env.test-command", "run_tests: no test command configured for this repository"); }
  if (m === "transient") { x.rn.data.tries = (x.rn.data.tries ?? 0) + 1; if (x.run.ctx.netOk) return "ok"; throw new Error("fetch failed: ECONNRESET socket hang up"); }
  if (m === "det") return x.run.params.want === "pass" ? "ok" : { outcome: "fail", note: "totals.check: fail — 1235 JPY shows as $12.35" };
  if (m === "scope") { if (fa?.kind === "rescope" && /src\/fx\.ts/.test(fa.note)) return "ok"; throw new Error("src/fx.ts is outside the spec's scope"); }
  if (m === "params") { if (x.run.params.want === "pass") return "ok"; throw new Error("params: want must be pass or fail, not " + x.run.params.want); }
  if (m === "ask0") return fa?.kind === "answer" ? "ok" : { outcome: "ask", note: "Round totals up or down?" };
  if (m === "stale") throw new Error("approved lane image changed");
  if (m === "secret") throw new Error(`boom at ${homedir()}/work/x.ts ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij12`);
  if (m === "internal") throw new Error("kaboom: the act step met a state nobody planned for sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  return "ok";
};
E.modes["remote-blocked"] = { tools: () => [], system: () => "test", prompt: () => "TEST", begin: (x) => { const m = "cannot read the remote head of feature/R-1: fatal: could not read Username for 'https://github.com': terminal prompts disabled";
  x.rn.data.report = { marker: "BLOCKED", summary: m, round: x.visit }; x.save(); throw Object.assign(new Error(m), { outcome: "blocked" }); }, after: () => "ok" } as any;
E.modes.asker = { tools: () => [], system: () => "test", prompt: (x) => `TEST AGENT\n${x.run.text}`, after: (x) => (x.rn.data.failureAnswer?.kind === "answer" ? "ok" : (x.rn.data.report = { summary: "Should JPY have decimals?" }, "ask")) } as any;

const start = (mode: string, extra: Record<string, string> = {}) => E.start({ workflow: "fx", text: `fixture ${mode}`, params: { mode, ...extra } });
const failed = async (id: string) => { await until(() => !!E.get(id)!.failureCard || E.get(id)!.status === "succeeded"); return E.get(id)!; };
const cardOf = (id: string) => E.cards.get(E.get(id)!.failureCard ?? "")!;
const refusal = async (card: string, a: any) => { try { await E.answer(card, { by: "captain", ...a }); return null; } catch (e: any) { return e; } };
const ids = (c: any) => c.options.map((o: any) => o.id).join(",");
const ste = (texts: { section: string; text: string }[]) => JSON.parse(Bun.spawnSync(["python3", join(root, "packs/core/checks/ste-wording/run")], { stdin: Buffer.from(JSON.stringify({ params: { fail_rules: ["R5", "R6", "R8"] }, texts })) }).stdout.toString() || "{}");
const shown: any[] = [], shownViews: any[] = [];
const keep = (c: any) => { shown.push(c); shownViews.push(E.cards.view(E.cards.get(c.id)!)); };

// ---------- ask ----------
{ const r = start("ask"); const run = await failed(r.id); const c = cardOf(r.id);
  ok(run.status === "failed" && run.failure?.class === "ask" && run.failure.code === "ask.escalated" && c.kind === "failure" && c.captainOnly === true && ids(c) === "answer,park" && c.options[0].note === true,
    "ask: a question Firstmate escalated is the ask class (not scope), titled Escalated by Firstmate, with Answer and continue and Park", JSON.stringify([run.status, run.failure?.code, ids(c)]));
  ok(c.title.en.startsWith("Escalated by Firstmate") && c.failure!.escalation?.reason === "The currency is a pricing choice only the captain sets." && c.sections.en.why.endsWith("Firstmate's reason: The currency is a pricing choice only the captain sets.") && c.sections["zh-TW"].why.includes("Firstmate 的理由："),
    "ask: the card shows Firstmate's reason for escalating, in en and zh-TW", c.sections.en.why);
  ok(c.failure!.message === "Which currency does the total use?" && /Answer and continue/.test(c.sections.en.how) && /回答並繼續/.test(c.sections["zh-TW"].how), "ask: the card carries the exact question and the next action in en and zh-TW");
  const e = await refusal(c.id, { choice: "answer" }); ok(!!e && E.cards.get(c.id)!.status === "open", "ask: an answer with no text is refused and the card stays open", e?.message);
  keep(E.cards.get(c.id));
  await E.answer(c.id, { choice: "answer", note: "JPY has no decimals: show ¥1,235", by: "captain" });
  await until(() => E.get(r.id)!.status === "succeeded");
  const after = E.get(r.id)!;
  ok(after.status === "succeeded" && after.nodes.act.visits === 2 && after.ctx.answers?.act?.note?.startsWith("JPY"), "ask: Answer and continue returns to the same node with the answer, and the run goes on", JSON.stringify([after.status, after.nodes.act.visits]));
}
// an agent's question reaches its next prompt
{ const r = E.start({ workflow: "ag", text: "agent ask" }); await failed(r.id); const c = cardOf(r.id);
  ok(c.failure?.code === "ask.escalated" && c.failure.message === "Should JPY have decimals?" && /Firstmate is not running, so it could not answer this question\./.test(c.sections.en.why), "ask: with no Firstmate running, the question reaches the captain and the card says why Firstmate did not answer", JSON.stringify(c.failure));
  await E.answer(c.id, { choice: "answer", note: "No decimals for JPY", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.status === "succeeded" && /CAPTAIN'S ANSWER[\s\S]*Should JPY have decimals\?[\s\S]*No decimals for JPY/.test(E.get(r.id)!.ctx.lastPrompt?.build ?? ""), "ask: the same agent node runs again with the captain's answer in its prompt", E.get(r.id)!.ctx.lastPrompt?.build);
}

// ---------- environment ----------
{ const r = start("env"); const run = await failed(r.id); const c = cardOf(r.id);
  ok(run.failure?.class === "environment" && run.failure.code === "env.test-command" && ids(c) === "fix-retry,park", "environment: a missing test command is the environment class with Fix and retry and Park", JSON.stringify([run.failure?.code, ids(c)]));
  ok(/scripts\.test/.test(c.sections.en.how) && /\.crew\/gates\.json/.test(c.sections.en.how) && /\.crew\/gates\.json/.test(c.sections["zh-TW"].how) && c.failure!.message.includes("no test command"), "environment: the card states exactly what to fix and where, with the exact message", c.sections.en.how);
  keep(c);
  const e = await refusal(c.id, { choice: "fix-retry" });
  ok(!!e && /still not fixed: package.json still has no scripts.test/.test(e.message) && E.cards.get(c.id)!.status === "open", "environment: Fix and retry is refused while the probe says it is still broken", e?.message);
  envFixed = true; await E.answer(c.id, { choice: "fix-retry", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.status === "succeeded", "environment: once fixed, Fix and retry runs the same step again");
}

// ---------- transient ----------
{ const r = start("transient"); const run = await failed(r.id); const c = cardOf(r.id);
  ok(run.failure?.class === "transient" && run.failure.code === "transient.network" && ids(c) === "retry,park" && run.failure.retry?.attempt === 1, "transient: a network error is the transient class with Retry and Park", JSON.stringify([run.failure?.code, ids(c), run.failure?.retry]));
  ok(/backoff/.test(c.sections.en.how) && /Retry 1 waits/.test(c.sections.en.how) && /間隔/.test(c.sections["zh-TW"].how), "transient: the card shows the backoff", c.sections.en.how);
  keep(c);
  await E.answer(c.id, { choice: "retry", by: "captain" });
  ok(E.get(r.id)!.status === "waiting" && (E.get(r.id)!.nodes.act as any).waiting === "backoff", "transient: Retry waits its backoff before the step runs", E.get(r.id)!.status);
  await until(() => !!E.get(r.id)!.failureCard); const c2 = cardOf(r.id);
  ok(c2.id !== c.id && c2.failure?.retry?.attempt === 2 && /Retry 2 waits/.test(c2.sections.en.how), "transient: the second failure counts retry 2 and its own backoff", JSON.stringify(c2.failure?.retry));
  E.get(r.id)!.ctx.netOk = true; await E.answer(c2.id, { choice: "retry", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.status === "succeeded", "transient: a retry after the network is back succeeds");
}

// ---------- deterministic ----------
{ const r = start("det"); const run = await failed(r.id); const c = cardOf(r.id);
  ok(run.failure?.class === "deterministic" && ids(c) === "retry,edit-params,park" && !!run.failure.inputs?.hash, "deterministic: a fail on fixed inputs is the deterministic class with Retry, Edit params and Park, and the inputs are kept", JSON.stringify([run.failure?.code, ids(c)]));
  keep(c);
  const e = await refusal(c.id, { choice: "retry" });
  ok(!!e && /nothing changed since the failure \(compared: agent, base, budget, head, params, policy, spec, workflow\)/.test(e.message) && E.cards.get(c.id)!.status === "open", "deterministic: Retry with no change is refused and says what it compared", e?.message);
  ok(e?.refusal?.["zh-TW"]?.includes("沒有任何輸入改變"), "deterministic: the refusal has zh-TW text");
  // a policy change is a changed input: retry is taken
  mkdirSync(join(H.data, "policies"), { recursive: true }); writeFileSync(join(H.data, "policies", "org.yaml"), "test: { n: 3 }\n");
  const changed = F.changedInputs(c.failure!.inputs!.snapshot, E.failureInputs(E.get(r.id)!, E.get(r.id)!.def.nodes[0]));
  ok(changed.length === 1 && changed[0].key === "policy", "deterministic: the card can show what changed (the policy)", JSON.stringify(changed));
  await E.answer(c.id, { choice: "retry", by: "captain" }); await until(() => E.get(r.id)!.failureCard !== c.id && !!E.get(r.id)!.failureCard);
  const c2 = cardOf(r.id);
  const e2 = await refusal(c2.id, { choice: "edit-params", note: "want=fail" });
  ok(!!e2 && /every value is the same as now/.test(e2.message), "deterministic: an edit that changes nothing is refused", e2?.message);
  await E.answer(c2.id, { choice: "edit-params", note: "want=pass", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.status === "succeeded" && E.get(r.id)!.params.want === "pass", "deterministic: changed inputs (Edit params) run it again");
}
// a blocking check on a node is the deterministic check code with its evidence
{ const f = F.failure("deterministic.check", "t/nat: fail — native says no", { inputs: { head: "a" } });
  ok(f.class === "deterministic" && F.retryRefusal(f, { head: "a" })?.code === "no-change" && F.retryRefusal(f, { head: "b" }) === null, "deterministic: retryRefusal refuses equal inputs and lets a changed head through");
}

// ---------- scope ----------
{ const r = start("scope"); const run = await failed(r.id); const c = cardOf(r.id);
  ok(run.failure?.class === "scope" && run.failure.code === "scope.blocked" && ids(c) === "rescope,park" && c.options[0].note, "scope: work outside the spec's scope is the scope class with Rescope (note required) and Park", JSON.stringify([run.failure?.code, ids(c)]));
  keep(c);
  const e = await refusal(c.id, { choice: "rescope", note: "Rescope" });
  ok(!!e && /not concrete/.test(e.message) && E.cards.get(c.id)!.status === "open", "scope: a vague rescope note is refused", e?.message);
  await E.answer(c.id, { choice: "rescope", note: "Add src/other.ts to the scope", by: "captain" }); await until(() => E.get(r.id)!.failureCard !== c.id && !!E.get(r.id)!.failureCard);
  const c2 = cardOf(r.id);
  const e2 = await refusal(c2.id, { choice: "rescope", note: "add src/other.ts  to the scope" });
  ok(!!e2 && /same as the last rescope/.test(e2.message), "scope: the same rescope note again is refused (no change)", e2?.message);
  await E.answer(c2.id, { choice: "rescope", note: "Add src/fx.ts to the scope", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.status === "succeeded", "scope: a concrete, new rescope runs the step again with the note");
}
{ const x = "a".repeat(40);
  const no = F.rescopeRefusal({ note: "Refresh base", from: x, target: x, base: "main" });
  ok(no?.code === "same-base" && /refreshes base main from aaaaaaaaaaaa to aaaaaaaaaaaa, which changes nothing/.test(no.en) && /沒有任何改變/.test(no["zh-TW"]), "scope: a rescope that refreshes base from X to X is refused with an explanation", no?.en);
  ok(F.rescopeRefusal({ note: "Refresh base", from: x, target: "b".repeat(40) }) === null, "scope: a refresh to a new base commit is allowed");
}

// ---------- invalid-input ----------
{ const r = start("params", { want: "maybe" }); const run = await failed(r.id); const c = cardOf(r.id);
  ok(run.failure?.class === "invalid-input" && run.failure.code === "invalid-input.params" && ids(c) === "edit-params,park", "invalid-input: a refused param is the invalid-input class with Edit params and Park", JSON.stringify([run.failure?.code, ids(c)]));
  keep(c);
  const e = await refusal(c.id, { choice: "edit-params", note: "colour=blue" });
  ok(!!e && /not accepted: colour/.test(e.message) && /Known: mode, want/.test(e.message), "invalid-input: an unknown key is refused and the known keys are listed", e?.message);
  await E.answer(c.id, { choice: "edit-params", note: "want=pass", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.status === "succeeded" && E.get(r.id)!.params.want === "pass", "invalid-input: Edit params changes the param and runs the step again");
}

// ---------- internal ----------
{ const r = start("internal"); const run = await failed(r.id); const c = cardOf(r.id);
  ok(run.failure?.class === "internal" && run.failure.code === "internal.unmapped" && ids(c) === "report,park", "internal: an unmapped failure is the internal class (never a generic string) with Report and Park", JSON.stringify([run.failure?.code, ids(c)]));
  ok(!c.failure!.message.includes("AAAAAAAAAAAAAAAA") && c.failure!.message.includes("kaboom") && !!c.failure!.diagnostics?.stack && c.failure!.diagnostics?.errorName === "Error", "internal: the exact message is kept with credentials removed, and the diagnostics hold the stack", JSON.stringify(c.failure!.diagnostics).slice(0, 300));
  keep(c);
  await E.answer(c.id, { choice: "report", by: "captain" });
  const file = join(H.data, "failures", `${r.id}-${c.id}.json`);
  ok(existsSync(file) && JSON.parse(readFileSync(file, "utf8")).failure.diagnostics.stack && E.get(r.id)!.status === "failed", "internal: Report keeps the diagnostics with the task and the run stays failed");
}

// ---------- park, and the source funnel ----------
{ const r = start("det"); await failed(r.id); const c = cardOf(r.id);
  await E.answer(c.id, { choice: "park", by: "captain" });
  ok(E.get(r.id)!.parked?.by === "captain" && E.get(r.id)!.status === "failed" && E.cards.get(c.id)!.status === "answered", "park: every class offers Park; a parked run stays failed and nothing retries it");
  ok(F.FAILURE_CLASSES.every((k) => F.failureActions(k).some((o) => o.id === "park")), "park: Park is in the actions of every class");
}
{ const cases: [unknown, string][] = [
    [Object.assign(new Error("provider capability is unverified: codex; hold without fallback"), { providerRefusal: true }), "env.provider-unavailable"],
    [Object.assign(new Error("scope held by R-12 until verified merge"), { queueRefusal: true }), "scope.overlap"],
    [Object.assign(new Error("remote X and last hand-back diverged: decide which work to keep"), { outcome: "blocked" }), "ask.one-way"],
    [Object.assign(new Error("inputs are unchanged since the failed check"), { name: "HyperframesFailure", code: "unchanged-inputs", cleanupSafe: true }), "deterministic.unchanged"],
    [Object.assign(new Error("HyperFrames check failed"), { name: "HyperframesFailure", code: "command-failed", cleanupSafe: true }), "deterministic.film"],
    [new Error("You exceeded your current quota"), "env.quota"], [new Error("429 Too Many Requests"), "transient.rate-limit"], [new Error("Not logged in · Please run /login"), "env.login"],
    [new Error("no result within 900 s"), "transient.timeout"], [new Error("refused: provider codex needs an OS sandbox (sandbox-exec)"), "env.sandbox"], [new Error("depends_on must be a JSON array of native task ids"), "invalid-input.params"],
    [new Error("the worker changed nothing"), "deterministic.agent-result"], [new Error("something nobody has seen"), "internal.unmapped"]];
  const got = cases.map(([e]) => F.fromError(e).code);
  ok(cases.every(([, want], i) => got[i] === want), "funnel: provider, queue, round, renderer and plain errors classify at the source; the unknown one is internal", JSON.stringify(got));
}
{ const f = F.failure("transient.network", "x", { log: { k: "job", job: "J-1", run: "R-1" } });
  ok(f.log.ref?.k === "job" && f.log.href === null && /log viewer is not installed/.test(f.log.reason!.en), "log: until the error-log links land, a failure names its log reference and says why there is no link");
  F.setFailureLogLinker((ref) => ({ ref, href: `#/log/k=${ref.k}`, available: true, reason: null }));
  ok(F.failure("transient.network", "x", { log: { k: "job", job: "J-1" } }).log.href === "#/log/k=job", "log: the error-log hook turns the reference into a link"); F.setFailureLogLinker(null);
}

// ---------- every card's words pass STE, en and zh-TW ----------
{ const texts = shown.flatMap((c: any) => (["en", "zh-TW"] as const).flatMap((l) => [{ section: `${l}.title`, text: c.title[l] }, { section: `${l}.how`, text: c.sections[l].how }, { section: `${l}.why`, text: l === "en" ? c.failure.meaning.en : c.sections[l].why }]));
  const out = ste(texts);
  ok(shown.length === 7 && new Set(shown.map((c: any) => c.failure.class)).size === 7 && out.verdict !== "fail", "every class's card text passes the STE wording check in en and zh-TW", JSON.stringify(out.findings?.slice(0, 5)));
  // tests/failures-ui.mjs renders these real cards (as /api/scards serves them) in en and zh-TW
  const emit = process.argv.indexOf("--emit"); if (emit > 0) writeFileSync(process.argv[emit + 1], JSON.stringify(shownViews));
}
// ---------- round 2: the review's blocking and should-fix items ----------
// (1) a retry brings back the siblings the failure stopped, so a join gets every input
{ const r = E.start({ workflow: "par", text: "join" }); await until(() => !!E.get(r.id)!.failureCard, 10000); const c = cardOf(r.id);
  ok(c.failure?.code === "transient.network" && E.get(r.id)!.nodes.c.state === "skipped", "join: b fails while c runs; the failure stopped c", JSON.stringify([c.failure?.code, E.get(r.id)!.nodes.c.state]));
  await until(() => !E.busy(r.id), 5000); E.get(r.id)!.ctx.netOk = true;
  await E.answer(c.id, { choice: "retry", by: "captain" }); await until(() => ["succeeded", "failed"].includes(E.get(r.id)!.status) && !E.get(r.id)!.failureCard?.startsWith("x"), 10000);
  const done = E.get(r.id)!;
  ok(done.status === "succeeded" && done.ctx.joined === true && done.ctx.slowRuns === 2 && !done.failures?.some((f: any) => f.code === "internal.bug"), "join: Retry re-runs b and the stopped sibling c; d gets both inputs and the run succeeds (no stall)", JSON.stringify([done.status, done.ctx.joined, done.ctx.slowRuns, done.failure?.code, done.error]));
}
// (2) the Report file is redacted before any cut, home folder as ~
{ const r = start("secret"); await failed(r.id); const c = cardOf(r.id); const run = E.get(r.id)!;
  run.steps.at(-1)!.note = "token sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ in a step note"; run.error = `R failed: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij34 at ${homedir()}/x`;
  ok(!c.failure!.message.includes("ghp_ABCDEFGHIJ") && !c.failure!.message.includes(homedir()) && c.failure!.message.includes("~/work/x.ts"), "report: the card message has no token and no home path", c.failure!.message);
  await E.answer(c.id, { choice: "report", by: "captain" });
  const text = readFileSync(join(H.data, "failures", `${r.id}-${c.id}.json`), "utf8");
  ok(!/sk-ant-api03-Z|ghp_ABCDEFGHIJ/.test(text) && !text.includes(homedir()) && text.includes("~/x"), "report: the kept report holds no credential and no home path", text.match(/(sk-ant|ghp_|\/Users\/)[^"]{0,30}/)?.[0]);
}
// (3) an archived run, or one whose ledger does not verify, is never revived
{ const r = start("det"); await failed(r.id); const c = cardOf(r.id); await until(() => !E.busy(r.id));
  E.archive(r.id, true);
  const e = await refusal(c.id, { choice: "edit-params", note: "want=pass" });
  ok(!!e && /archived/.test(e.message) && E.get(r.id)!.status === "failed" && E.get(r.id)!.archived === true && E.cards.get(c.id)!.status === "open", "archived: answering a failure card of an archived run is refused; it stays failed and hidden", e?.message);
  E.archive(r.id, false);
  mkdirSync(join(H.data, "evidence", r.id), { recursive: true }); writeFileSync(join(H.data, "evidence", r.id, "ledger.jsonl"), JSON.stringify({ seq: 1, run: r.id, record: "card-answer", sig: "forged" }) + "\n", { flag: "a" });
  const e2 = await refusal(c.id, { choice: "edit-params", note: "want=pass" });
  ok(!!e2 && /does not verify/.test(e2.message) && E.get(r.id)!.status === "failed", "untrusted: a run whose ledger does not verify cannot run again", e2?.message);
}
// (4) Edit params: only declared, unlocked params, checked against their spec
{ const r = start("params", { want: "maybe" }); await failed(r.id); const c = cardOf(r.id);
  const tries = [["_staffing=forged", /not accepted: _staffing/], ["project=other", /not accepted: project/], ["target=/tmp/x", /not accepted: target/], ["want=nope", /want \(not one of pass, fail, maybe\)/]] as const;
  const got = [] as string[]; for (const [note] of tries) got.push((await refusal(c.id, { choice: "edit-params", note }))?.message ?? "taken");
  ok(tries.every(([, re], i) => re.test(got[i])) && E.get(r.id)!.params.project === "p1" && !E.get(r.id)!.params._staffing, "params: _-prefixed and identity keys are refused, and a value outside the declared options is refused", JSON.stringify(got));
  ok(/Known: mode, want\./.test(got[0]) && F.parseParamEdit("x=1", {}, null).code === "bad-params", "params: only declared params are offered; a workflow with none has nothing to edit");
}
// (6) a restart honours the backoff time still left
{ const r = start("transient"); await failed(r.id); const c = cardOf(r.id); E.failureBackoff = () => 1500;
  E.get(r.id)!.ctx.netOk = true; E.commit(E.get(r.id)!); await E.answer(c.id, { choice: "retry", by: "captain" }); E.failureBackoff = () => 60;
  const until0 = Date.parse(E.get(r.id)!.nodes.act.data.backoffUntil); E.runs.delete(r.id); // the old process is gone
  const H2 = await harness(flows, { data: H.data }); const E2 = H2.engine; E2.actions.act = E.actions.act; E2.load();
  await new Promise((res) => setTimeout(res, 400));
  ok(E2.get(r.id)!.status === "waiting" && (E2.get(r.id)!.nodes.act as any).waiting === "backoff" && E2.get(r.id)!.nodes.act.data.backoffUntil, "restart: a retry waiting out its backoff keeps waiting after a restart", JSON.stringify([E2.get(r.id)!.status, E2.get(r.id)!.nodes.act.waiting]));
  await until(() => E2.get(r.id)!.status === "succeeded", 5000);
  ok(E2.get(r.id)!.status === "succeeded" && Date.now() >= until0, "restart: it runs once the time still left is over, not before");
  H2.stop();
}
// (7) a change after the gates or after approval: the card offers what works, never Retry or Answer
{ const codes = ["the branch moved since the seven gates ran", "remote checks changed before merge", "a one-way change needs the door confirmation on the merge card", "reviewed move identity changed or predates pinning; prepare a new task", "approved lane image changed"].map((m) => F.fromError(new Error(m)).code);
  const native = F.fromError(Object.assign(new Error("This proposal already dispatched work that was removed; never replay it"), { publicFailure: { code: "target_changed" } })).code;
  ok(JSON.stringify(codes) === JSON.stringify(["deterministic.prepare-again", "deterministic.prepare-again", "deterministic.prepare-again", "deterministic.new-task", "deterministic.new-task"]) && native === "deterministic.new-task", "classify: moved gates, changed checks and a missing door confirmation need a fresh preparation; a changed approval needs a new task", JSON.stringify([codes, native]));
  ok(F.failureActions("deterministic", "deterministic.prepare-again").map((o) => o.id).join() === "prepare-again,park" && F.failureActions("deterministic", "deterministic.new-task").map((o) => o.id).join() === "new-task,park", "classify: those cards offer Prepare again or Start a new task, and Park");
  for (const mode of ["gates", "door"]) {
    const r = E.start({ workflow: "pg", text: `prepare ${mode}`, params: { mode } }); await until(() => E.cards.list({ run: r.id, open: true }).length > 0); await E.answer(E.cards.list({ run: r.id, open: true })[0].id, { choice: "merge", by: "captain" });
    await failed(r.id); const c = cardOf(r.id);
    ok(c.failure?.code === "deterministic.prepare-again" && ids(c) === "prepare-again,park", `prepare (${mode}): the failed merge offers Prepare again, not Retry or Answer and continue`, JSON.stringify([c.failure?.code, ids(c)]));
    await E.answer(c.id, { choice: "prepare-again", by: "captain" });
    await until(() => E.cards.list({ run: r.id, open: true }).some((k) => k.node === "k"));
    const k2 = E.cards.list({ run: r.id, open: true }).find((k) => k.node === "k")!;
    ok(E.get(r.id)!.nodes.p.visits === 2 && E.get(r.id)!.ctx.mergeTries === 1, `prepare (${mode}): it goes back before the card, and the merge waits for a new card`, JSON.stringify([E.get(r.id)!.nodes.p.visits, E.get(r.id)!.ctx.mergeTries]));
    await E.answer(k2.id, { choice: "merge", by: "captain" }); await until(() => E.get(r.id)!.status === "succeeded");
    ok(E.get(r.id)!.status === "succeeded", `prepare (${mode}): the new card's answer merges`);
  }
  const r = start("stale"); await failed(r.id); const c = cardOf(r.id);
  ok(c.failure?.code === "deterministic.new-task" && ids(c) === "new-task,park", "new task: a changed approval offers Start a new task", ids(c));
  await E.answer(c.id, { choice: "new-task", by: "captain" });
  const next = E.get(E.get(r.id)!.ctx.followedBy)!;
  ok(!!next && next.id !== r.id && next.params.mode === "stale" && E.get(r.id)!.parked?.note === `followed by ${next.id}` && E.get(r.id)!.status === "failed", "new task: a new task starts with the same request and params; this one is parked", JSON.stringify([next?.id, E.get(r.id)!.parked]));
  await until(() => !!E.get(next.id)!.failureCard);
}
// (9) a run that ends "succeeded · fail" is never revived; its card says so and offers a new task
{ const r = E.start({ workflow: "endfail", text: "ends on fail", params: { mode: "det" } }); await until(() => !!E.get(r.id)!.failureCard); const c = cardOf(r.id);
  ok(E.get(r.id)!.status === "succeeded" && E.get(r.id)!.result === "fail" && ids(c) === "new-task,park" && /ended on this result/.test(c.sections.en.how) && !/stays failed/.test(c.sections.en.how), "ended: the card of a run that ended on fail offers a new task and says it does not run again", JSON.stringify([ids(c), c.sections.en.how]));
  const e = await refusal(c.id, { choice: "retry" });
  ok(!!e && E.get(r.id)!.status === "succeeded" && E.get(r.id)!.nodes.only.visits === 1, "ended: a retry on it is refused; the run is not revived", e?.message);
}
// (13) the board's poll reads the changed inputs once per card while the run is unchanged
{ const r = start("det"); await failed(r.id); const c = cardOf(r.id); let n = 0; const orig = E.failureInputs.bind(E); E.failureInputs = (...a: any[]) => { n++; return orig(...(a as [any, any])); };
  for (let i = 0; i < 5; i++) E.cards.view(E.cards.get(c.id)!);
  ok(n === 1, "view: five board polls compute the changed inputs once", String(n)); E.failureInputs = orig;
}
// (10) the card body does not repeat the failure box; zh cards carry no English body or stack
{ const internal = shown.find((c: any) => c.failure.class === "internal");
  ok(shown.every((c: any) => c.body === "") && !!internal.failure.diagnostics.stack, "card: no duplicate body; the stack lives only in the diagnostics");
}

// ---------- round 3: agent questions go to Firstmate first ----------
{ const asked: any[] = []; E.askFirstmate = (r, node, q) => { asked.push([r.id, node.id, q]); return true; };
  const r = start("ask0"); await until(() => !!E.get(r.id)!.ctx.firstmateQuestion); await until(() => !E.busy(r.id));
  ok(!E.get(r.id)!.failureCard && !E.cards.list({ run: r.id, open: true }).length && asked.at(-1)?.[2] === "Round totals up or down?" && E.get(r.id)!.ctx.firstmateQuestion.node === "act", "firstmate: an agent question goes to Firstmate; no captain card", JSON.stringify(asked.at(-1)));
  // Historical persisted questions predate visit binding.
  delete E.get(r.id)!.ctx.firstmateQuestion.visit;
  E.answerFromFirstmate(r.id, "act", { answer: "Round half up" }); await until(() => E.get(r.id)!.status === "succeeded");
  ok(E.get(r.id)!.status === "succeeded" && E.get(r.id)!.nodes.act.data.failureAnswer?.by === "firstmate" && E.trusted(r.id).entries.some((e: any) => e.record === "failure-answer" && e.actor === "firstmate"), "firstmate: its answer runs the same step again and the run succeeds; the ledger records Firstmate as the answerer");
  const a = E.start({ workflow: "ag", text: "agent ask to firstmate" }); await until(() => !!E.get(a.id)!.ctx.firstmateQuestion); await until(() => !E.busy(a.id));
  E.answerFromFirstmate(a.id, "build", { answer: "Two decimals except JPY", visit: E.get(a.id)!.ctx.firstmateQuestion?.visit }); await until(() => E.get(a.id)!.status === "succeeded");
  ok(/FIRSTMATE'S ANSWER[\s\S]*Should JPY have decimals\?[\s\S]*Firstmate answered: Two decimals except JPY/.test(E.get(a.id)!.ctx.lastPrompt?.build ?? "") && !/CAPTAIN'S ANSWER/.test(E.get(a.id)!.ctx.lastPrompt?.build ?? ""), "firstmate: the agent's next prompt carries FIRSTMATE'S ANSWER", E.get(a.id)!.ctx.lastPrompt?.build);
  const e = E.start({ workflow: "ag", text: "agent ask escalated" }); await until(() => !!E.get(e.id)!.ctx.firstmateQuestion); await until(() => !E.busy(e.id));
  E.answerFromFirstmate(e.id, "build", { escalate: "Deleting the remote branch is a one-way decision.", visit: E.get(e.id)!.ctx.firstmateQuestion?.visit }); const c = cardOf(e.id);
  ok(c?.failure?.code === "ask.escalated" && c.failure.escalation?.reason === "Deleting the remote branch is a one-way decision." && c.sections.en.why.includes("Firstmate's reason: Deleting the remote branch") && ids(c) === "answer,park", "firstmate: an escalation raises the captain card with Firstmate's reason", JSON.stringify([c?.failure?.code, c?.sections.en.why]));
  let twice = ""; try { E.answerFromFirstmate(e.id, "build", { answer: "x" }); } catch (err: any) { twice = err.message; }
  ok(/not waiting|no question/.test(twice), "firstmate: a question is answered once", twice);
  await E.answer(c.id, { choice: "answer", note: "Keep the remote branch", by: "captain" }); await until(() => E.get(e.id)!.status === "succeeded");
  ok(/CAPTAIN'S ANSWER[\s\S]*Keep the remote branch/.test(E.get(e.id)!.ctx.lastPrompt?.build ?? "") && !E.get(e.id)!.nodes.build.data.escalation, "firstmate: the captain's answer to an escalation reaches the step as CAPTAIN'S ANSWER");
  E.askFirstmate = () => false; const d = start("ask0"); await failed(d.id); const dc = cardOf(d.id);
  ok(/Firstmate is not running/.test(dc.failure!.escalation!.reason!) && !E.get(d.id)!.ctx.firstmateQuestion, "firstmate: when Firstmate is detached the card says it is not running");
  E.askFirstmate = null;
}
// ---------- round 3: a new task keeps the staffing pins and refuses what start refuses ----------
{ let current = "h2"; const r = start("stale", { _staffing: "h1" }); await failed(r.id); const c = cardOf(r.id);
  E.deps.authorizeStart = (_def: any, o: any) => { if (o.params?._staffing !== current) throw new Error("Staffing changed; confirm a fresh proposal"); };
  const e = await refusal(c.id, { choice: "new-task" });
  ok(!!e && /^New task refused: Staffing changed/.test(e.message) && e.refusal?.["zh-TW"]?.startsWith("已拒絕開始新任務") && E.cards.get(c.id)!.status === "open" && !E.get(r.id)!.ctx.followedBy, "new task: changed staffing is refused and the card stays open", e?.message);
  current = "h1"; await E.answer(c.id, { choice: "new-task", by: "captain" });
  const next = E.get(E.get(r.id)!.ctx.followedBy)!;
  ok(!!next && next.params._staffing === "h1", "new task: a valid _staffing pin travels with the new task and it starts", JSON.stringify(next?.params));
  delete E.deps.authorizeStart;
  const p = E.start({ workflow: "firstmate-proposal", text: "internal" }); await failed(p.id); const pc = cardOf(p.id);
  ok(ids(pc) === "park" && /internal or retired/.test(pc.sections.en.how), "new task: an internal workflow's card offers Park only", ids(pc));
  const pe = await refusal(pc.id, { choice: "new-task" });
  ok(!!pe && E.cards.get(pc.id)!.status === "open", "new task: a forced new-task on firstmate-proposal is refused", pe?.message);
}

// ---------- a restart keeps the typed failure, its card and an edited param ----------
{ const r = start("params", { want: "maybe" }); await failed(r.id); const c = cardOf(r.id);
  const H2 = await harness(flows, { data: H.data }); const E2 = H2.engine; E2.actions.act = E.actions.act; E2.load();
  const back = E2.get(r.id)!;
  ok(back.failure?.code === "invalid-input.params" && back.failureCard === c.id && E2.cards.get(c.id)?.failure?.class === "invalid-input", "restart: the run keeps its typed failure and its open failure card", JSON.stringify([back.failure?.code, back.failureCard]));
  await E2.answer(c.id, { choice: "edit-params", note: "want=pass", by: "captain" }); await until(() => E2.get(r.id)!.status === "succeeded");
  E2.get(r.id)!.params.cache = "in memory only"; E2.commit(E2.get(r.id)!); // a domain's params cache (staffing upgrades) never becomes durable
  const H3 = await harness(flows, { data: H.data }); H3.engine.load();
  ok(H3.engine.get(r.id)!.params.cache === undefined && H3.engine.get(r.id)!.paramEdits?.want === "pass", "restart: only the captain's param edits persist; an in-memory params cache does not", JSON.stringify(H3.engine.get(r.id)!.params));
  ok(E2.get(r.id)!.status === "succeeded" && H3.engine.get(r.id)!.params.want === "pass" && H3.engine.get(r.id)!.failureCard === null, "restart: the answer after a restart runs the step, and the edited param is durable");
  H2.stop(); H3.stop();
}
// the film: a failure without a renderer diagnostic still names its class and exact message (never only "No verified film was offered.")
{ const { coffeeFilmFailureNote } = await import("../src/domain/coffee-kit");
  const note = coffeeFilmFailureNote(null, null, F.fromError(new Error("Film dependencies changed"), { source: "render" }));
  ok(/^The state changed during the step \(transient · transient\.stale\): Film dependencies changed\nNo verified film was offered\.$/.test(note), "film: a film failure with no diagnostic is classified with its exact message", note);
  const bare = coffeeFilmFailureNote(null, null, null);
  ok(bare !== "No verified film was offered." && /internal/.test(bare), "film: even with nothing known the note says internal, not the bare line", bare);
}
// every code's own words pass STE (en) and are real zh-TW
{ const texts = Object.entries(F.FAILURE_CODES).flatMap(([k, v]: any) => [v.title, v.meaning, v.fix, v.where].filter(Boolean).flatMap((x: any, i: number) => [{ section: `en.${k}.${i}`, text: x.en }, { section: `zh-TW.${k}.${i}`, text: x["zh-TW"] }]))
    .concat(F.FAILURE_CLASSES.flatMap((c) => { const h = F.failureHow(F.failure(c === "ask" ? "ask.escalated" : c === "environment" ? "env.login" : c === "scope" ? "scope.blocked" : c === "transient" ? "transient.network" : c === "deterministic" ? "deterministic.check" : c === "invalid-input" ? "invalid-input.params" : "internal.bug", "m")); return [{ section: `en.how.${c}`, text: h.en }, { section: `zh-TW.how.${c}`, text: h["zh-TW"] }]; }));
  const out = ste(texts);
  ok(out.verdict !== "fail", `all ${Object.keys(F.FAILURE_CODES).length} codes and 7 class instructions pass STE in en and zh-TW`, JSON.stringify(out.findings?.slice(0, 5)));
}
// ---------- a round blocked before its agent, with no edge: typed by its cause, never internal.unmapped ----------
{ const r = E.start({ workflow: "rb", text: "fixture blocked", params: {} }); const run = await failed(r.id);
  ok(run.failure?.code === "env.repository" && /cannot read the remote head/.test(run.failure.message) && run.failure.class === "environment",
    "a round blocked before its agent (no blocked edge) is classified by the reason on its report: cannot read the remote head is env.repository, not internal.unmapped", JSON.stringify([run.failure?.code, run.failure?.message])); }
H.stop();
end();
