import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A captain's "Request changes" note binds every later round (R-058, F24): it is kept on the run as a
// cumulative, signed captain amendment that outranks the spec. The next build, the fresh reviewer, the
// root-cause turn and the next merge card all show it above the spec; the reviewer marks the done line it
// supersedes instead of rejecting the captain's change as unauthorized, so nothing reverts it.
//   bun tests/captain-amendment.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("captain-amendment");
const root = join(import.meta.dir, "..");
const WF = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
const { installCode } = await import("../src/domain/code"); const { amendmentsSection } = await import("../src/runtime/refine"); const { Projects } = await import("../src/doors");
const data = checkedTempDir("crew-amend-"); prepareSandbox(data); registerSandbox(data);
const H = await harness([WF], { data, checkRoots: [] }); const E = H.engine; installCode(E, { dataDir: data, projects: new Projects(data) });
// round 1 converts at 1 (what the approved done lines say); the captain's note asks for 0.92, which a fix round writes (STUB_AMENDED)
const intent = ["Add a euro view to money-kit",
  "STUB_FILE src/eur-view.ts :: export const EUR_RATE = 1;\\nexport function eurCents(usdCents: number): number {\\n  return Math.round(usdCents * EUR_RATE);\\n}\\n",
  'STUB_FILE test/eur-view.test.ts :: import { expect, test } from "bun:test";\\ntest("euro view converts cents", async () => { expect(await Bun.file(new URL("../src/eur-view.ts", import.meta.url)).exists()).toBe(true); const { eurCents } = await import("../src/eur-view"); expect(typeof eurCents(850)).toBe("number"); });\\n',
  "STUB_FIX src/eur-view.ts :: EUR_RATE = 1; => EUR_RATE = 0.92; // STUB_AMENDED fixed demo rate",
  // round 3 (after the second note) asks the captain about A1; the captain's answer overrides it
  "STUB_ASK_AFTER A2. Also label the euro view"].join("\n");
const NOTE1 = "EUR must convert at a fixed demo rate 0.92 before formatting";
const NOTE2 = "Also label the euro view as a demo rate";
const NOTE3 = "Drop A1: keep EUR at the rate the done lines say";
const live = (id: string) => !["succeeded", "failed", "cancelled"].includes(E.get(id)!.status);
const openCard = (id: string, kind: string) => E.cards.list({ run: id, open: true }).find((c: any) => c.kind === kind);
const r = E.start({ workflow: "code-firstmate", params: {}, text: intent });
try {
  ok(await until(() => !!openCard(r.id, "dispatch") || !live(r.id), 180000), "dispatch card");
  await E.answer(openCard(r.id, "dispatch")!.id, { choice: "dispatch", by: "captain" });
  ok(await until(() => !!openCard(r.id, "merge") || !live(r.id), 180000), "round 1 reaches the merge card", JSON.stringify([E.get(r.id)!.status, E.get(r.id)!.error]));
  const m1 = openCard(r.id, "merge")!;
  ok(!m1.detail?.amendments && !/Captain's binding changes/.test(m1.body), "no captain change before the captain asks for one");
  await E.answer(m1.id, { choice: "changes", note: NOTE1, by: "captain" });
  const run = () => E.get(r.id)!;
  const a1 = run().ctx.amendments?.[0];
  const signed = E.trusted(r.id).entries.find((e: any) => e.seq === a1?.seq);
  ok(a1?.n === 1 && a1.note === NOTE1 && a1.card === m1.id && !!signed && signed.record === "card-answer" && (signed as any).data?.note === NOTE1 && signed.sig === a1.sig,
    "the captain's note is recorded on the run as amendment A1, bound to its signed card-answer ledger entry", JSON.stringify(a1));

  // round 2 implements it; the fresh reviewer sees it above the spec and supersedes the conflicting done line instead of rejecting it
  ok(await until(() => openCard(r.id, "merge")?.id !== m1.id && !!openCard(r.id, "merge") || !live(r.id) || !!openCard(r.id, "step-back") || !!openCard(r.id, "round-budget"), 240000),
    "round 2 reaches a new merge card (the reviewer did not reject the captain's change)", JSON.stringify([run().status, run().error, (run().ctx.reviews ?? []).map((v: any) => [v.verdict, v.findings.map((f: any) => f.text)])]));
  const prompts = run().ctx.lastPrompt ?? {};
  const build2 = JSON.parse(readFileSync(join(E.root, r.id, "briefs", "round-2.json"), "utf8")).brief as string;
  const above = (t: string) => t.includes("CAPTAIN'S BINDING CHANGES") && t.includes(`A1. ${NOTE1}`) && t.indexOf("CAPTAIN'S BINDING CHANGES") < t.indexOf("Done when:");
  ok(above(build2) && /report ASK with amendment/.test(build2), "the round-2 build brief shows A1 above the spec, labelled as the captain's binding change", build2.slice(0, 600));
  ok(above(prompts.review ?? ""), "the reviewer brief shows A1 above the spec", String(prompts.review).slice(0, 600));
  const reviews = run().ctx.reviews ?? [];
  ok(reviews.length === 2 && reviews[1].verdict === "APPROVE" && JSON.stringify(reviews[1].superseded) === '[{"done":1,"amendment":1}]', "the reviewer approves the captain's change and names done line 1 as superseded by A1", JSON.stringify(reviews.map((v: any) => [v.verdict, v.superseded])));
  const m2 = openCard(r.id, "merge")!;
  ok(/Captain's binding changes \(they outrank the done lines below\):\nA1\. EUR must convert/.test(m2.body) && /1\. .* — reviewer: superseded by A1/.test(m2.body), "the merge card lists A1 above the done lines and marks done line 1 superseded", m2.body.slice(-900));
  ok(m2.detail?.amendments?.[0]?.note === NOTE1 && /reviewer: superseded by A1/.test(m2.detail?.done?.[0]?.text?.en ?? "") && /reviewer 判定：已由 A1 取代/.test(m2.detail?.done?.[0]?.text?.["zh-TW"] ?? ""),
    "the merge card's structured detail carries A1 and the superseded line in en and zh-TW", JSON.stringify([m2.detail?.amendments, m2.detail?.done?.[0]?.text]));
  const head = readFileSync(join(run().ctx.worktree, "src/eur-view.ts"), "utf8");
  ok(/EUR_RATE = 0\.92/.test(head), "the head the merge card offers keeps the captain's 0.92 (no revert)", head);

  // a second note: amendments are cumulative, never latest-only; the root-cause turn and the next build see both
  await E.answer(m2.id, { choice: "changes", note: NOTE2, by: "captain" });
  ok(JSON.stringify(run().ctx.amendments.map((a: any) => [a.n, a.note])) === JSON.stringify([[1, NOTE1], [2, NOTE2]]), "a second note adds A2 and keeps A1");
  ok(await until(() => /round 3/.test(run().ctx.lastPrompt?.build ?? "") || !live(r.id), 120000), "round 3 starts");
  const p3 = run().ctx.lastPrompt ?? {};
  ok(above(p3.build ?? "") && p3.build.includes(`A2. ${NOTE2}`), "the round-3 build brief shows A1 and A2 above the spec");
  ok(String(p3.fix ?? "").startsWith("ROOT CAUSE") && p3.fix.includes(`A1. ${NOTE1}`) && p3.fix.includes(`A2. ${NOTE2}`) && /would undo the captain's latest word on one of these changes is wrong/.test(p3.fix) && /the later one wins/.test(p3.fix), "the root-cause brief shows the captain's changes and says an item undoing one is wrong", String(p3.fix).slice(0, 500));

  // a later captain decision overrides an earlier change: the worker asks about A1, the captain answers the failure card "drop A1"
  ok(await until(() => !!openCard(r.id, "failure") || !live(r.id), 120000), "round 3 asks the captain about A1 (a failure card)");
  const fc = openCard(r.id, "failure")!;
  ok(fc?.failure?.code === "ask.escalated" && /binding change A1/.test(fc.failure?.escalation?.reason ?? ""), "the question about A1 goes straight to the captain", JSON.stringify(fc?.failure?.escalation));
  await E.answer(fc.id, { choice: "answer", note: NOTE3, by: "captain" });
  const a3 = E.amendments(run()).at(-1);
  ok(E.amendments(run()).length === 3 && a3?.n === 3 && a3.note === NOTE3 && a3.card === fc.id && E.trusted(r.id).entries.find((e: any) => e.seq === a3.seq)?.record === "failure-answer",
    "the captain's failure-card answer is recorded as amendment A3, bound to its signed failure-answer entry", JSON.stringify(run().ctx.amendments));
  ok(await until(() => (run().ctx.lastPrompt?.review ?? "").includes(`A3. ${NOTE3}`) || !live(r.id) || !!openCard(r.id, "step-back") || !!openCard(r.id, "round-budget"), 240000), "the next review starts");
  const rv = run().ctx.lastPrompt?.review ?? "";
  ok(rv.indexOf(`A1. ${NOTE1}`) < rv.indexOf(`A3. ${NOTE3}`) && /the later one wins; an earlier one it overrides no longer binds/.test(rv),
    "the next review brief lists the captain's answer as the later amendment that wins over A1", rv.slice(0, 900));

  // a tampered amendment no longer matches its signed entry: dropped from every brief and logged
  const saved = run().ctx.amendments[0].note; run().ctx.amendments[0].note = "EUR must convert at 0.5";
  const kept = E.amendments(run());
  ok(!kept.some((a: any) => a.n === 1) && kept.length === 2 && E.timeline(r.id).some((e: any) => e.type === "log" && /A1 does not match its signed ledger entry/.test(e.summary ?? "")), "a tampered amendment is dropped and logged");
  run().ctx.amendments[0].note = saved;
  ok(E.amendments(run()).length === 3, "the untampered amendments verify");
} finally { if (live(r.id)) await E.cancel(r.id, "captain"); H.stop(); }
// a run without done lines (a non-code workflow) gets no done-line wording
const generic = amendmentsSection([{ n: 1, card: "SC-1", node: "review", note: "warmer tone", by: "captain", at: "", seq: 1, sig: "x" }], { done: false });
ok(/warmer tone/.test(generic) && !/done line/i.test(generic) && /the later one wins/.test(generic), "without done lines the amendment wording names the request, not done lines");
end();
