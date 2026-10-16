// One failure taxonomy across every workflow (captain decision 2026-10-16): each class has its card, its actions,
// and its next action; Retry or Rescope with no change is refused with an explanation; nothing is a generic error.
//   bun tests/failures.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("failures");
const F = await import("../src/runtime/failures");
const root = join(import.meta.dir, "..");

const flows: string[] = [];
const W = (o: any) => { flows.push(Y({ roles: [{ id: "worker", label: "Worker", skill: "x" }], ...o })); return o.id; };
// one step that fails the way the run's "mode" param says, then succeeds once the captain's action changed what it needs
W({ id: "fx", name: "failure fixture", params: { mode: { default: "" }, want: { default: "fail" } }, nodes: [
  { id: "act", kind: "hook", label: "Act", do: "act", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["act", "end", "ok"]] });
W({ id: "ag", name: "agent asks", nodes: [{ id: "build", kind: "agent", label: "Build", role: "worker", mode: "asker", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["build", "end", "ok"]] });
const H = await harness(flows);
const E = H.engine;
let envFixed = false;
E.failureBackoff = () => 60; // the real schedule is 5 s, 30 s, 2 min, 10 min: shortened here
E.failureProbes["env.test-command"] = () => (envFixed ? null : "package.json still has no scripts.test");
E.actions.act = (x) => {
  const m = x.run.params.mode, fa = x.rn.data.failureAnswer;
  if (m === "ask") return fa?.kind === "answer" ? "ok" : { outcome: "ask", note: "Which currency does the total use?" };
  if (m === "env") { if (envFixed) return "ok"; throw new F.FailureError("env.test-command", "run_tests: no test command configured for this repository"); }
  if (m === "transient") { x.rn.data.tries = (x.rn.data.tries ?? 0) + 1; if (x.run.ctx.netOk) return "ok"; throw new Error("fetch failed: ECONNRESET socket hang up"); }
  if (m === "det") return x.run.params.want === "pass" ? "ok" : { outcome: "fail", note: "totals.check: fail — 1235 JPY shows as $12.35" };
  if (m === "scope") { if (fa?.kind === "rescope" && /src\/fx\.ts/.test(fa.note)) return "ok"; throw new Error("src/fx.ts is outside the spec's scope"); }
  if (m === "params") { if (x.run.params.want === "pass") return "ok"; throw new Error("params: want must be pass or fail, not " + x.run.params.want); }
  if (m === "internal") throw new Error("kaboom: the act step met a state nobody planned for sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  return "ok";
};
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
  ok(run.status === "failed" && run.failure?.class === "ask" && run.failure.code === "ask.agent-question" && c.kind === "failure" && c.captainOnly === true && ids(c) === "answer,park" && c.options[0].note === true,
    "ask: an agent question is the ask class (not scope), its card offers Answer and continue and Park", JSON.stringify([run.status, run.failure?.code, ids(c)]));
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
  ok(c.failure?.class === "ask" && c.failure.message === "Should JPY have decimals?", "ask: an agent node's ASK report is the question on the card", JSON.stringify(c.failure));
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
    [Object.assign(new Error("remote X and last hand-back diverged: decide which work to keep"), { outcome: "blocked" }), "ask.captain-decision"],
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
// ---------- a restart keeps the typed failure, its card and an edited param ----------
{ const r = start("params", { want: "maybe" }); await failed(r.id); const c = cardOf(r.id);
  const H2 = await harness(flows, { data: H.data }); const E2 = H2.engine; E2.actions.act = E.actions.act; E2.load();
  const back = E2.get(r.id)!;
  ok(back.failure?.code === "invalid-input.params" && back.failureCard === c.id && E2.cards.get(c.id)?.failure?.class === "invalid-input", "restart: the run keeps its typed failure and its open failure card", JSON.stringify([back.failure?.code, back.failureCard]));
  await E2.answer(c.id, { choice: "edit-params", note: "want=pass", by: "captain" }); await until(() => E2.get(r.id)!.status === "succeeded");
  const H3 = await harness(flows, { data: H.data }); H3.engine.load();
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
    .concat(F.FAILURE_CLASSES.flatMap((c) => { const h = F.failureHow(F.failure(c === "ask" ? "ask.agent-question" : c === "environment" ? "env.login" : c === "scope" ? "scope.blocked" : c === "transient" ? "transient.network" : c === "deterministic" ? "deterministic.check" : c === "invalid-input" ? "invalid-input.params" : "internal.bug", "m")); return [{ section: `en.how.${c}`, text: h.en }, { section: `zh-TW.how.${c}`, text: h["zh-TW"] }]; }));
  const out = ste(texts);
  ok(out.verdict !== "fail", `all ${Object.keys(F.FAILURE_CODES).length} codes and 7 class instructions pass STE in en and zh-TW`, JSON.stringify(out.findings?.slice(0, 5)));
}
H.stop();
end();
