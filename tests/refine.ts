import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The refine loop node and the brief compiler (docs/architecture.md §3.3,
// docs/check-contract.md "Runtime duties"): produce → checks → brief → produce,
// stopping when every blocking check passes, on the same class twice (step-back),
// on no score progress for 2 rounds, and at the round cap; a report-only failure
// re-runs only the report; a timeout is never report-only; the brief is a fixed
// template checked by brief-quality and bound to its round and head.
//   bun tests/refine.ts
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("refine");
const { compileBrief, renderBrief } = await import("../src/runtime/refine");

const tmp = mkdtempSync(join(tmpdir(), "crew-refine-"));
const flag = (n: string) => join(tmp, `flag-${n}`);
const flows: string[] = [];
const roles = [{ id: "maker", label: "Maker", skill: "x" }, { id: "coord", label: "Coordinator", skill: "x" }];
const loop = (id: string, checks: any[], o: { say?: string; onBrief?: string; cap?: number; coordinator?: boolean; timeout?: number } = {}) => flows.push(Y({ id, name: id, roles, nodes: [
  { id: "start", kind: "hook", label: "Start", do: "set", args: { key: "started", value: true }, x: -1, y: 0 },
  { id: "make", kind: "agent", label: "Make", role: "maker", mode: "test", args: { say: o.say ?? "", onBrief: o.onBrief ?? "" }, checks, ...(o.timeout ? { timeout_s: o.timeout } : {}), x: 0, y: 0 },
  { id: "fix", kind: "loop", label: "Fix", args: { producer: "make", report_checks: ["t/report-schema"], ...(o.cap ? { round_cap: o.cap } : {}), ...(o.coordinator ? { coordinator: "coord" } : {}) }, x: 0, y: 1 },
  { id: "step-back", kind: "card", label: "Step back", args: { card_kind: "step-back" }, card: { title: { en: "Step back?", "zh-TW": "退一步？" }, body: { en: "The same class failed twice.", "zh-TW": "同一類失敗連續兩次。" }, options: [{ id: "park", label: "Park", labelZh: "暫停" }, { id: "continue", label: "Continue", labelZh: "繼續" }] }, x: 1, y: 1 },
  { id: "stalled", kind: "card", label: "No progress", args: { card_kind: "step-back" }, card: { title: { en: "No progress: park?", "zh-TW": "沒有進展：暫停？" }, body: { en: "The score did not rise for two rounds.", "zh-TW": "分數兩輪沒有上升。" }, options: [{ id: "park", label: "Park", labelZh: "暫停" }] }, x: 1, y: 2 },
  { id: "budget", kind: "card", label: "Round budget", args: { card_kind: "round-budget" }, card: { title: { en: "Round budget reached: more rounds?", "zh-TW": "輪數用完：再給幾輪？" }, body: { en: "The round cap is reached.", "zh-TW": "輪數上限已到。" }, options: [{ id: "extend", label: "More", labelZh: "再給" }, { id: "park", label: "Park", labelZh: "暫停" }], effects: { extend: { policy: "round_cap", add: 2 } } }, x: 1, y: 3 },
  { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }, { id: "parked", kind: "hook", label: "Parked", args: { result: "closed" }, x: 2, y: 1 }],
  edges: [["start", "make"], ["make", "done", "ok"], ["make", "fix", "fail|timeout"], ["fix", "make", "retry|report"], ["fix", "done", "pass"], ["fix", "step-back", "step-back"], ["fix", "stalled", "stalled"], ["fix", "budget", "cap"],
    ["step-back", "parked", "park"], ["step-back", "make", "continue"], ["stalled", "parked", "park"], ["budget", "make", "extend"], ["budget", "parked", "park"]] }));
loop("autofix", [{ use: "t/failer", params: { cls: "missing-flag", flagfile: flag("a") } }], { onBrief: `Call: note_write {"flag":"${flag("a")}"}`, coordinator: true });
loop("twice", [{ use: "t/failer", params: { cls: "same-class", flagfile: flag("never") } }], { onBrief: "(the agent tries, but the same class stays)" });
loop("stall", [{ use: "t/rotating" }], { cap: 9 });
loop("cap", [{ use: "t/rotating" }], { cap: 2 });
loop("report", [{ use: "t/report-schema", params: { flagfile: flag("r") } }], { onBrief: `Call: note_write {"flag":"${flag("r")}"}` });
loop("timeout", [{ use: "t/ok" }], { say: "STUB_HANG", timeout: 1, cap: 1 });
loop("vague", [{ use: "t/noexp", params: { flagfile: flag("v") } }], { onBrief: `Call: note_write {"flag":"${flag("v")}"}`, coordinator: true });

const H = await harness(flows, { refine: true });
const E = H.engine;
const settle = (id: string, ms = 30000) => until(() => ["succeeded", "failed", "cancelled", "waiting"].includes(E.get(id)!.status), ms);

// ---------- the brief template ----------
{
  const failing: any = [{ check: "web/contrast", node: "make", verdict: "fail", error: null, edge: null, findings: [{ locator: { type: "web", url: "/af/p/1/index.html", selector: ".cta", viewport: { w: 1280, h: 800 } }, message: "contrast 2.1:1", expected: "4.5:1 or more", class: "contrast", severity: "blocking" }, { locator: null, message: "minor", expected: null, class: "x", severity: "minor" }] },
    { check: "t/crash", node: "make", verdict: "error", error: "exit 3", edge: null, findings: [] }];
  const human: any = [{ locator: { type: "timeline", from: 2, to: 3, bbox: null }, message: "too dark here", expected: null, class: "captain-note", severity: "blocking", source: "human", check: "note:R1" }];
  const b = compileBrief("make", 2, "abcdef1234567890", failing, human, "the palette ignores dark mode");
  ok(b.items.length === 3 && b.items.every((i) => i.class && i.expected && i.message) && b.items[0].where.includes(".cta") && b.items[2].source === "human", "the brief lists each blocking finding and each captain note with locator, message, expected and class (minor findings left out)");
  ok(/BRIEF for round 3 \(from round 2 at abcdef12\)/.test(b.text) && /Fix the whole class/.test(b.text) && /1\. \[contrast\] web\/contrast — .*\.cta.*\n   Found: contrast 2\.1:1\n   Expected: 4\.5:1 or more/.test(b.text) && /0:02\.0–0:03\.0/.test(b.text) && /Root cause \(coordinator\): the palette ignores dark mode/.test(b.text), "the brief is the fixed template: round and head, 'fix the whole class', one block per item, the root cause", b.text);
  ok(b.items[1].class === "check-error" && renderBrief(b) === b.text, "a check that errored becomes an item too; the template renders the same every time");
}

// ---------- a check fails and the loop fixes it without a human ----------
{
  const r = E.start({ workflow: "autofix", text: "make it" }); await settle(r.id);
  const g = E.get(r.id)!; const b = g.ctx.briefs?.make;
  ok(g.status === "succeeded" && g.nodes.make.visits === 2 && existsSync(flag("a")), "a failing check is fixed by the next round, with no card", `${g.status} ${g.nodes.make.visits} ${g.error}`);
  ok(E.cards.list({ run: r.id }).length === 0, "no human card was raised");
  ok(b?.round === 1 && b.items[0].class === "missing-flag" && b.items[0].locator?.type === "file" && b.quality === "pass", "the brief came from the findings and passed brief-quality");
  ok(b?.rootCause === "the last round left the named class unfixed" && /Root cause \(coordinator\)/.test(b.text), "the coordinator added a root cause");
  ok(E.ledger(r.id).filter((e) => e.check === "core/brief-quality").every((e) => e.verdict === "pass"), "brief-quality is in the ledger");
  ok(g.ctx.refine.fix.history.map((h: any) => h.outcome).join(",") === "retry", "the loop's history: one retry, then the producer's checks passed");
}

// ---------- the same class twice → step-back card ----------
{
  const r = E.start({ workflow: "twice", text: "never fixed" }); await settle(r.id);
  const g = E.get(r.id)!; const c = E.cards.list({ run: r.id })[0];
  ok(g.status === "waiting" && c?.kind === "step-back" && c.node === "step-back" && g.nodes.make.visits === 2, "the same class failing twice raises the step-back card", `${g.status} ${c?.kind} ${g.nodes.make.visits}`);
  ok(JSON.stringify(g.ctx.refine.fix.history.at(-1).repeated) === '["same-class"]', "the card's history names the repeated class");
}

// ---------- no score progress for 2 rounds → card ----------
{
  const r = E.start({ workflow: "stall", text: "no progress" }); await settle(r.id);
  const g = E.get(r.id)!; const c = E.cards.list({ run: r.id })[0];
  ok(g.status === "waiting" && c?.node === "stalled" && g.nodes.make.visits === 3 && g.ctx.refine.fix.history.map((h: any) => h.outcome).join(",") === "retry,retry,stalled", "no score progress for 2 rounds raises a card (new classes each round, so it is not a step-back)", JSON.stringify(g.ctx.refine?.fix?.history?.map((h: any) => [h.round, h.outcome, h.score])));
}

// ---------- the round cap → round-budget card; extending it is a run override set by the card ----------
{
  const r = E.start({ workflow: "cap", text: "capped" }); await settle(r.id);
  const g = E.get(r.id)!; const c = E.cards.list({ run: r.id })[0];
  ok(g.status === "waiting" && c?.kind === "round-budget" && g.nodes.make.visits === 2, "the round cap raises the round-budget card", `${g.status} ${c?.kind} ${g.nodes.make.visits}`);
  await E.answer(c.id, { choice: "extend", by: "captain" });
  await until(() => E.cards.list({ run: r.id, open: true }).length > 0 && E.get(r.id)!.nodes.make.visits >= 3, 20000); await settle(r.id);
  ok(E.get(r.id)!.ctx.policyAdds?.round_cap === 2 && E.get(r.id)!.nodes.make.visits === 3 && E.cards.list({ run: r.id, open: true })[0]?.node === "stalled", "extending is a run override set by the card: the cap of 2 becomes 4, round 3 runs, and the next stop condition (no progress) raises its card", JSON.stringify(E.get(r.id)!.ctx.policyAdds) + " visits " + E.get(r.id)!.nodes.make.visits);
}

// ---------- report-only: the code is kept, only the report runs again ----------
{
  const r = E.start({ workflow: "report", text: "report" }); await settle(r.id);
  const g = E.get(r.id)!;
  ok(g.status === "succeeded" && g.ctx.refine.fix.history[0].outcome === "report" && g.ctx.reportOnly?.make === true, "a failure of only the report re-runs the report (outcome report)");
}

// ---------- a timeout is never report-only ----------
{
  const r = E.start({ workflow: "timeout", text: "hang" }); await settle(r.id, 40000);
  const g = E.get(r.id)!; const st = g.steps.find((s) => s.node === "make");
  const to = E.ledger(r.id).find((e) => e.check === "runtime/round-timeout");
  ok(g.nodes.make.data.keptWork === true && st?.state === "failed" && st.outcome === "timeout" && E.events(r.id).some((e) => e.type === "node" && e.node === "make" && e.to === "failed" && e.cause === "timeout"), "a node killed at its time limit ends failed(cause=timeout) and keeps its work", JSON.stringify(st));
  ok(!!to && to.findings[0].class === "timeout" && to.blocking, "the timeout is a blocking ledger finding of class timeout");
  ok(g.ctx.refine.fix.history[0].outcome !== "report" && g.ctx.briefs?.make?.classes.includes("timeout"), "the loop never classes a timeout as report-only", JSON.stringify(g.ctx.refine?.fix?.history));
}

// ---------- brief-quality: a finding with no expected change and no locator gets them from the coordinator, never from a placeholder ----------
{
  const r = E.start({ workflow: "vague", text: "vague" }); await settle(r.id);
  const g = E.get(r.id)!; const q = E.ledger(r.id).filter((e) => e.check === "core/brief-quality"); const it = g.ctx.briefs?.make?.items?.[0];
  ok(q.length >= 1 && q.at(-1)!.verdict === "pass" && g.status === "succeeded" && !!it?.locator && !/ passes$/.test(it.expected), "a brief must pass brief-quality before it is sent; the coordinator, not a template, gives the missing expected change and locator", JSON.stringify([q.map((e) => e.verdict), it]));
}

// ---------- a brief is bound to its round and head ----------
{
  const { briefFor } = await import("../src/runtime/refine");
  const x: any = { node: { id: "make" }, visit: 3, ctx: { head: "h2", briefs: { make: { round: 2, head: "h2", items: [], classes: [], text: "B" } } } };
  ok(briefFor(x)?.text === "B" && briefFor({ ...x, visit: 4 }) === null && briefFor({ ...x, ctx: { ...x.ctx, head: "h9" } }) === null, "an agent reads only the brief bound to its round and its input head");
}
H.stop();
end();
