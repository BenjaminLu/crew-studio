// The refine loop node (docs/check-contract.md, runtime duties): produce → run
// checks → compile a brief from the findings → produce again. The node sits
// after the producer and its checks. It reads the ledger since the producer's
// latest round, and:
//   no blocking failure            → "pass"
//   the same class failed in two rounds in a row → "step-back" (a card: question the design)
//   no score progress for 2 rounds → "stalled" (a card)
//   the round cap (policy round_cap) → "cap" (the round-budget card)
//   a class the workflow routes     → its outcome (args.route_classes, e.g. a door change → the door)
//   only the report failed         → "report" (args.report_checks; re-run the report only, the code is kept)
//   otherwise                      → "retry", with a compiled brief for the producer.
// The brief is a fixed template: each item has its locator, message, expected
// result and class, plus "fix the whole class". A coordinator agent can add a
// root cause; the brief is then checked by brief-quality (a check like any other).
import type { AgentTool } from "../agent";
import type { LedgerEntry } from "./checks";
import type { Engine, X } from "./engine";
import { locatorText, type Finding } from "./locator";

export type BriefItem = { n: number; check: string; class: string; locator: Finding["locator"]; where: string; message: string; expected: string; source: string };
export type Brief = { producer: string; round: number; head: string | null; items: BriefItem[]; classes: string[]; rootCause: string | null; text: string; quality: string | null;
  /** the brief's id, and the evidence ledger entries (seq) it was compiled from */
  id?: string; ledger?: number[] };

/** The fixed brief template. */
export function compileBrief(producer: string, round: number, head: string | null, failing: LedgerEntry[], human: Finding[] = [], rootCause: string | null = null): Brief {
  const items: BriefItem[] = [];
  for (const e of failing) {
    const fs = e.findings.filter((f) => f.severity !== "minor");
    if (!fs.length) items.push({ n: 0, check: e.check, class: e.verdict === "error" ? (/timeout/.test(e.error ?? "") ? "timeout" : "check-error") : e.check.split("/").pop()!, locator: null, where: e.edge ? `edge ${e.edge}` : `node ${e.node}`,
      message: e.error ?? `${e.check} ${e.verdict}`, expected: e.verdict === "error" ? "the check runs and returns a verdict" : `${e.check} passes`, source: "check" });
    for (const f of fs) items.push({ n: 0, check: e.check, class: f.class, locator: f.locator, where: locatorText(f.locator), message: f.message, expected: f.expected || `${e.check} passes`, source: f.source ?? "check" });
  }
  for (const f of human) items.push({ n: 0, check: f.check ?? "captain", class: f.class, locator: f.locator, where: locatorText(f.locator), message: f.message, expected: f.expected || "what the captain asked", source: "human" });
  items.forEach((it, i) => (it.n = i + 1));
  const classes = [...new Set(items.map((i) => i.class))];
  const b: Brief = { producer, round, head, items, classes, rootCause, text: "", quality: null, id: `${producer}@${round}${head ? `:${head.slice(0, 12)}` : ""}`, ledger: failing.map((e) => e.seq).filter((n) => typeof n === "number") };
  b.text = renderBrief(b); return b;
}
/** The fixed template, the same for machine and human findings. */
export function renderBrief(b: Brief): string {
  return [`BRIEF for round ${b.round + 1} (from round ${b.round}${b.head ? ` at ${b.head.slice(0, 8)}` : ""})`,
    `Fix every item below. Fix the whole class each item belongs to, not only the named spot: search for every other instance of the same class and fix those too.`, "",
    ...b.items.map((it) => `${it.n}. [${it.class}] ${it.check} — ${locatorText(it.locator) === "(no locator)" ? it.where : locatorText(it.locator)}\n   Found: ${it.message}\n   Expected: ${it.expected}`),
    ...(b.rootCause ? ["", `Root cause (coordinator): ${b.rootCause}`] : []), "", `Classes: ${b.classes.join(", ")}`].join("\n");
}

/** The brief an agent may read: only the one bound to its round (the round before this visit) and to its current input head. */
export function briefFor(x: X, node = x.node.id): Brief | null {
  const b: Brief | undefined = x.ctx.briefs?.[node];
  if (!b || b.round !== x.visit - 1) return null;
  if (b.head && x.ctx.head && b.head !== x.ctx.head) return null;
  return b;
}

export function installRefine(engine: Engine) {
  // what brief-quality sees: the brief the loop node is about to send
  engine.artifacts.brief ??= (x) => ({ type: "brief", data: x.rn.data.brief ?? null });
  engine.modes.rootcause = {
    tools: (x) => [{ name: "root_cause", description: "Once: the root cause behind the failures (one or two sentences, verified against the findings), and for any item without a clear expected change, the expected change.",
      schema: { type: "object", properties: { cause: { type: "string" }, expected: { type: "array", items: { type: "object", properties: { n: { type: "number" }, expected: { type: "string" } }, required: ["n", "expected"] } } }, required: ["cause"] },
      run: (a) => { x.rn.data.rootcause = { cause: String(a.cause ?? "").slice(0, 1200), expected: Array.isArray(a.expected) ? a.expected : [] }; x.save(); return { ok: true }; } } as AgentTool],
    maxTools: 4,
    system: (x, skill) => `${skill}\n\nYou are the coordinator. Diagnose before the next round: read the compiled brief and name the root cause behind its items, and the expected change where an item lacks one. Never send the worker to hunt. Call root_cause once, then one line.`,
    prompt: (x) => `ROOT CAUSE\nRun ${x.run.id}\n${x.rn.data.brief?.text ?? ""}`,
    after: (x) => { if (!x.rn.data.rootcause) throw new Error("the coordinator gave no root cause"); return "ok"; },
  };
  engine.kinds.loop = {
    async start(x: X) {
      const producer = String(x.node.args?.producer); const prn = x.run.nodes[producer];
      const round = prn?.visits ?? 0;
      const since = [...x.run.steps].reverse().find((s) => s.node === producer)?.startedAt ?? x.run.createdAt;
      // the latest result of each check (node or edge) since the producer's round began
      const latest = new Map<string, LedgerEntry>();
      const t = engine.trusted(x.run.id);
      if (!t.ok) throw new Error(`the evidence ledger failed verification (${t.truncated ? "cut short" : `entries ${[...t.bad].join(", ")} do not match their signatures`}): nothing it says can decide this round`);
      for (const e of t.entries) if (e.at >= since && !String(e.edge ?? "").startsWith("hook:")) latest.set(`${e.check}|${e.node}|${e.edge ?? ""}`, e);
      const entries = [...latest.values()];
      const failing = entries.filter((e) => e.blocking && (e.verdict === "fail" || e.verdict === "error"));
      // the captain's own feedback (a merge card's "request changes", review notes) is a finding of the same type
      const human: Finding[] = [];
      for (const [node, a] of Object.entries(x.ctx.answers ?? {}) as [string, any][]) if (a?.note && ["changes", "request"].includes(a.choice) && a.at >= since && !x.rn.data.used?.includes(`${node}@${a.at}`)) {
        human.push({ locator: { type: "card", field: node }, message: a.note, expected: "what the captain asked", class: "captain-note", severity: "blocking", source: "human", check: `card:${node}` });
        x.rn.data.used = [...(x.rn.data.used ?? []), `${node}@${a.at}`];
      }
      for (const f of x.ctx.humanFindings?.[producer] ?? []) human.push(f);
      const st = (x.ctx.refine ??= {})[x.node.id] ??= { history: [] as any[] };
      const blockingEntries = entries.filter((e) => e.blocking);
      const score = blockingEntries.length ? blockingEntries.reduce((s, e) => s + (e.score != null && Number.isFinite(e.score) ? Math.max(0, Math.min(1, e.score)) : e.verdict === "pass" ? 1 : 0), 0) / blockingEntries.length : 1;
      if (!failing.length && !human.length) { st.history.push({ round, classes: [], score, head: x.ctx.head ?? null, outcome: "pass" }); x.save(); return { outcome: "pass", note: `round ${round}: every blocking check passes (score ${score.toFixed(2)})` }; }
      const brief = compileBrief(producer, round, x.ctx.head ?? null, failing, human);
      const prev = st.history.at(-1);
      const repeated = prev && prev.round === round - 1 ? brief.classes.filter((c) => prev.classes.includes(c) && c !== "captain-note") : [];
      let outcome = "retry";
      // the cap: the loop's own, else policy; a card's run override adds to it
      const cap = (x.node.args?.round_cap != null ? Number(x.node.args.round_cap) + Number(x.run.ctx.policyAdds?.round_cap ?? 0) : Number(x.policy("round_cap", 3))) + (x.rn.extra ?? 0);
      const h2 = st.history.slice(-2);
      const stalled = h2.length === 2 && h2[0].round === round - 2 && h2[1].round === round - 1 && score <= h2[1].score && h2[1].score <= h2[0].score;
      // the workflow maps finding classes to outcomes of its own (e.g. a door change routes back to the door) and names its report checks
      const routes: Record<string, string> = x.node.args?.route_classes ?? {};
      // a captain's answer the workflow routes through this loop (args.answer_routes: {"<card node>:<choice>": outcome}), once per answer
      for (const [k, out] of Object.entries((x.node.args?.answer_routes ?? {}) as Record<string, string>)) { const [cardNode, choice] = k.split(":"); const a = x.ctx.answers?.[cardNode];
        if (a?.choice === choice && (x.ctx.answerRouted ??= {})[k] !== a.at) { x.ctx.answerRouted[k] = a.at; st.history.push({ round, classes: [], score, head: x.ctx.head ?? null, outcome: out }); x.save(); return { outcome: out, note: `the captain's ${cardNode} answer (${choice}) routes ${out}` }; } }
      const routed = brief.classes.find((c) => routes[c]);
      if (routed) outcome = routes[routed];
      else if (repeated.length) outcome = "step-back";
      else if (stalled) outcome = "stalled";
      else if (round >= cap) outcome = "cap";
      else if (failing.length && (x.node.args?.report_checks ?? []).length && failing.every((e) => x.node.args!.report_checks.includes(e.check)) && !human.length) outcome = "report";
      // the coordinator adds a root cause, then the brief is checked like any output
      if ((outcome === "retry" || outcome === "report") && x.node.args?.coordinator && x.run.def.roles.some((r) => r.id === x.node.args!.coordinator)) {
        x.rn.data.brief = brief; x.rn.data.rootcause = null;
        try {
          const sub: X = { ...x, node: { ...x.node, role: x.node.args.coordinator } };
          await engine.runAgent(sub, "rootcause");
          const rc = x.rn.data.rootcause;
          if (rc) { for (const e of rc.expected ?? []) { const it = brief.items.find((i) => i.n === Number(e.n)); if (it && (!it.expected || /passes$/.test(it.expected))) it.expected = String(e.expected).slice(0, 600); }
            brief.rootCause = rc.cause || null; brief.text = renderBrief(brief); }
        } catch (err: any) { x.log(`no root cause: ${err?.message ?? err}`); }
      }
      x.rn.data.brief = brief;
      if (outcome === "retry" || outcome === "report") {
        // the brief-quality check must pass before the brief is sent: fill what the template can, check again, else stop with an error
        let q = await engine.runCheck(x, { use: "core/brief-quality" }, null);
        if (q.verdict !== "pass") {
          for (const it of brief.items) { it.expected ||= `${it.check} passes`; if (!it.locator) it.locator = { type: "card", field: it.check }; }
          brief.text = renderBrief(brief);
          x.rn.data.brief = brief;
          q = await engine.runCheck(x, { use: "core/brief-quality" }, null);
        }
        brief.quality = q.verdict;
        if (q.verdict !== "pass") throw new Error(`the brief failed brief-quality: ${q.findings.map((f) => f.message).join("; ") || q.error}`);
      }
      (x.ctx.briefs ??= {})[producer] = brief;
      if (outcome === "report") (x.ctx.reportOnly ??= {})[producer] = true;
      st.history.push({ round, classes: brief.classes, score, head: x.ctx.head ?? null, outcome, repeated, items: brief.items.length });
      x.save();
      engine.emit(x.run, "brief", `${x.node.label}: round ${round} → ${outcome}: ${brief.items.length} item${brief.items.length === 1 ? "" : "s"} (${brief.classes.join(", ")}), score ${score.toFixed(2)}`, { node: x.node.id, outcome, classes: brief.classes, score });
      return { outcome, note: `${outcome}: ${brief.classes.join(", ")}${repeated.length ? ` (repeated: ${repeated.join(", ")})` : ""}` };
    },
  };
}
