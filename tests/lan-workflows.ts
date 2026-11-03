import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Every workflow Studio ships, across two real Studios (docs/units/lan-relay.md): each is either relayed end to end
// (A dispatches → B takes with it → A assigns → B runs it under the restricted profile → B hands back → A refines →
// B takes round 2 → A assigns → B runs → B hands back → A marks it done), or refused at the take with its reason, and
// nothing starts. The list comes from the bundled workflows (workflows/v2 and packs/, what the runtime seeds), so a new
// workflow is in this table the day it ships. The captain cards on B are answered from the workflow's own offline
// acceptance scenario (tests/acceptance/<id>.yaml). Prints the table.               bun tests/lan-workflows.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledList, bundledText, parseYaml } from "../src/bundled";
import { loadScenario, scenarioFiles } from "../scripts/acceptance/scenarios";
import { stubRuns, stubDecision, type StubRun } from "./acceptance/stub";
import { STEPS, type Ctx } from "./acceptance/steps";
import { drive } from "./acceptance/drive";
import { bootPair, introduce, must, patchHash, seenOf, shareBase, until, type Pair } from "./lan/flow";
import type { Studio } from "./acceptance/studio";

let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };

// the expected table, pinned: a workflow that should be relayed and is refused (or the reverse), a reason that changed, a
// workflow that ships without a row here, each fails. Refused rows name the reason the take must give.
const EXPECTED: Record<string, "passes" | RegExp> = {
  "code-firstmate": "passes", documents: "passes", "web-prototype": "passes",
  "coffee-kit": /publishes a website and makes images and a film/, "file-organization": /moves files outside its own folder/,
  "hello-crew-studio": /a guided tour of this Studio/, images: /binary output \(PNG\)/, video: /binary output \(MP4\)/,
  "pack-genesis": /writes a workflow pack into this Studio/, "startup-recursion": /two-vendor demonstration/,
  "github-review": /is held/, "refine-demo": /not installed/, "trivial-lane": /not installed/,
  ...Object.fromEntries(["crew-change", "firstmate-connect-github", "firstmate-grant-merge", "firstmate-proposal", "firstmate-register-project", "firstmate-staffing", "issue-categories", "issue-triage", "local-project-register", "review-room-host"].map((id) => [id, /is internal: Studio starts it itself/])),
};
// the profile's no-binding scope is enforced only on macOS: anywhere else every workflow would refuse, which proves nothing
if (process.platform !== "darwin") { console.log(`  FAIL  the two-board workflow table runs on macOS only (this is ${process.platform}): it is not a pass that every workflow refuses here`); process.exit(1); }
const files = [...bundledList("workflows/v2/"), ...bundledList("packs/")].filter((f) => f.endsWith(".wf.yaml") || (f.startsWith("packs/") && f.endsWith(".flow.yaml")));
const bundled = [...new Set(files.map((f) => String((parseYaml(bundledText(f) ?? "") as any)?.id ?? f)))].sort();
const scenarios = new Map(scenarioFiles().map((f) => { const s = loadScenario(f); return [s.workflow, s] as const; }));
/** The scenario run whose answers finish the work (not one that rejects or closes it). */
const runFor = (id: string): StubRun | null => { const s = scenarios.get(id); if (!s) return null; const rs = stubRuns(s);
  const finishing = (r: StubRun) => (r.expect?.result ?? s.expect.result) !== "closed" && !r.known_failure;
  // a run that finishes on the board, else the board run that stops at a card the relay answers itself (code: dispatch)
  return rs.find((r) => r.how === "board" && finishing(r) && (r.expect?.status ?? s.expect.status) === "succeeded") ?? rs.find((r) => r.how === "board" && finishing(r)) ?? null; };
/** what a code workflow's briefing asks of the scripted agent: two files, round 2 a third */
const CODE = (n: number) => n === 1
  ? "Add a ten-percent discount function in lib/ with a test.\nSTUB_FILE lib/discount.ts :: export const discount = (p: number) => Math.round(p * 90) / 100;\\n\nSTUB_FILE test/discount.test.ts :: import { test, expect } from 'bun:test';\\ntest('ten percent off', async () => { const { discount } = await import('../lib/discount'); expect(discount(100)).toBe(90); });\\n"
  : "Also round to whole cents in a helper, with a test.\nSTUB_FILE lib/cents.ts :: export const cents = (p: number) => Math.round(p * 100) / 100;\\n\nSTUB_FILE test/cents.test.ts :: import { test, expect } from 'bun:test';\\ntest('whole cents', async () => { const { cents } = await import('../lib/cents'); expect(cents(1.005 * 100) / 100).toBeGreaterThan(0); });\\n";

const item = (s: Studio, kind: string, thread: string) => until(`${s.name}'s ${kind} on ${thread}`, async () => (await must(s.api("/api/lan"), "view")).items.find((i: any) => i.kind === kind && i.thread === thread && i.state === "open"));

async function relayOne(p: Pair, w: any, r: StubRun, h: Ctx): Promise<string> {
  const code = !!w.needsProject, provider = r.provider ?? "codex";
  const brief = (n: number) => code ? CODE(n) : n === 1 ? r.topic : `${r.topic}\nRound 2: tighten the wording.`;
  const take = (it: any) => must(p.B.api(`/api/lan/items/${it.id}/approve`, { seen: seenOf(it.prompt), workflow: w.id, provider, roundsOnly: true, rounds: 40, ...(code ? { project: h.vars.project } : {}), ...(w.staffing ? { staffingConfirm: w.staffing.hash } : {}) }), `B takes with ${w.id}`);
  const decide = async (card: any, view: any, visit: number) => {
    // a code workflow's dispatch card (the scenario's board run stops there): B's captain dispatches the spec, as on the board
    if (code && card.node === "dispatch") return { choice: "dispatch" };
    const d = stubDecision(r, card, visit, view.def, { openAuthWindows: [] }); if ("stop" in d) return d;
    let note = d.note, choice = d.choice;
    if (d.before) { const f = STEPS[d.before]; if (!f) return { stop: `no step ${d.before}` }; const o = await f(h, card, view); if (o?.note !== undefined) note = o.note; if (o?.choice) choice = o.choice; }
    return { choice, note };
  };
  const roundOn = async (t: string, n: number, it: any) => {
    await take(it);
    const k = await item(p.A, "take", t); await must(p.A.api(`/api/lan/items/${k.id}/approve`, {}), `A assigns round ${n}`);
    const a = await item(p.B, "assign", t); const v = await must(p.B.api(`/api/lan/items/${a.id}/approve`, {}), `B starts round ${n}`);
    const run = v.rounds[n - 1].run.id;
    const d = await drive(p.B, run, decide, { timeoutMs: Math.max(240_000, r.timeout_s * 1000) });
    if (d.problems.length || d.view?.status !== "succeeded") throw new Error(`round ${n}: B's Task ${run} ended ${d.view?.status}: ${d.problems.join("; ")} ${JSON.stringify((d.view?.steps ?? []).filter((s: any) => s.error).map((s: any) => `${s.node}: ${String(s.error).slice(0, 200)}`))}`);
    const rj = JSON.parse(readFileSync(join(p.B.data, "runs", run, "run.json"), "utf8"));
    if (rj.profile?.name !== "lan" || !rj.profile?.mark?.item) throw new Error(`round ${n}: B's Task ${run} does not carry the LAN marks (it did not run under the restricted profile)`);
    const pre = await must(p.B.api(`/api/lan/threads/${t}/handback/preview`, {}), `B previews round ${n}`);
    if (!pre.ok) throw new Error(`round ${n}: the hand-back gate stopped it: ${JSON.stringify({ secrets: pre.secrets, protected: pre.protectedPaths, tooLarge: pre.tooLarge })}`);
    if (!pre.files.length) throw new Error(`round ${n}: B's Task ${run} has nothing to hand back`);
    await must(p.B.api(`/api/lan/threads/${t}/handback`, { confirm: pre.hash }), `B hands round ${n} back`);
    const res = await item(p.A, "result", t); await must(p.A.api(`/api/lan/items/${res.id}/approve`, {}), `A accepts round ${n}`);
    return { run, files: res.files.map((f: any) => f.path) };
  };
  if (code) shareBase(p);
  const t = await must(p.A.api("/api/lan/dispatch", { to: p.keyB, title: `${w.id} across two boards`, briefing: brief(1), acceptance: ["done when it is done"], workflow: w.id, ...(code ? { project: "sandbox" } : {}) }), `A dispatches ${w.id}`);
  const r1 = await roundOn(t.id, 1, await item(p.B, "dispatch", t.id));
  await must(p.A.api(`/api/lan/threads/${t.id}/refine`, { briefing: brief(2), note: "round 2" }), "A refines");
  const r2 = await roundOn(t.id, 2, await item(p.B, "refine", t.id));
  let applied = "";
  if (code) { const th = await must(p.A.api(`/api/lan/threads/${t.id}`), "A's thread"), patch = th.rounds.at(-1).result.patch as string;
    // a refinement continues from the round before it: round 2's patch is the whole change against the dispatched base,
    // round 1's files included (it applies onto the base on its own)
    if (!/lib\/discount\.ts/.test(patch) || !/lib\/cents\.ts/.test(patch)) throw new Error(`round 2's patch does not carry round 1's work: ${patch.split("\n").filter((l) => l.startsWith("diff --git")).join(" | ")}`);
    const x = await must(p.A.api(`/api/lan/threads/${t.id}/apply`, { project: "sandbox", seen: patchHash(patch) }), "A applies the patch it read"); applied = ` · applied on A as ${x.branch} (based on ${th.base?.sha?.slice(0, 12)})`; }
  await must(p.A.api(`/api/lan/threads/${t.id}/done`, {}), "A marks it done");
  const dn = await item(p.B, "done", t.id); await must(p.B.api(`/api/lan/items/${dn.id}/approve`, {}), "B acknowledges done");
  const ta = await must(p.A.api(`/api/lan/threads/${t.id}`), "A's thread");
  const kinds = ta.steps.map((s: any) => s.kind).join(",");
  if (kinds !== "dispatch,take,assign,result,refine,take,assign,result,done") throw new Error(`A's trail is ${kinds}`);
  return `runs ${r1.run}, ${r2.run} · results ${r1.files.join("+")} / ${r2.files.join("+")}${applied}`;
}

const p = await bootPair({ examples: true });
const rows: { id: string; verdict: string; why: string }[] = [];
try {
  await introduce(p);
  const listed = (await must(p.B.api("/api/lan/workflows"), "B's workflows")).workflows as any[];
  ok(listed.length > 0 && listed.every((w) => w.eligible || w.why.length), "B lists every installed workflow, and each one it does not offer names its reason");
  // classified: every workflow a person can start declares what it would hand back to a peer (lan.output) or why it
  // takes no work from one (lan.refuse); a new workflow fails here until it does
  // the declarations of every source of a workflow (workflows/v2/*.wf.yaml, pack *.wf.yaml and pack *.flow.yaml): a
  // workflow a person can start is classified when one of its sources declares lan.output or lan.refuse, and one with no
  // source that declares anything is unclassified (never skipped because the source is a pack flow)
  const defsOf = new Map<string, any[]>(); for (const f of files) { const d = parseYaml(bundledText(f) ?? "") as any; if (d?.id) defsOf.set(String(d.id), [...(defsOf.get(String(d.id)) ?? []), d]); }
  const declared = (id: string) => (defsOf.get(id) ?? []).some((d) => d.lan && (d.lan.output || d.lan.refuse));
  const unclassified = listed.filter((w) => !w.why.some((y: string) => / is (internal|retired|held|not installed)/.test(y))).map((w) => w.id).filter((id) => !declared(id));
  ok(!unclassified.length, "every workflow a person can start says what it hands back to a peer or why it takes none (lan.output / lan.refuse)", unclassified.join(", "));
  // each workflow's own default rounds cap: a real code-firstmate round needs 7 agent rounds (spec 3, build 1, review 3)
  { const cf = listed.find((x) => x.id === "code-firstmate"), docs = listed.find((x) => x.id === "documents"), web = listed.find((x) => x.id === "web-prototype");
    ok(cf?.defaultRounds === 12 && docs?.defaultRounds === 6 && web?.defaultRounds === 6, "code-firstmate takes 12 rounds by default, documents and web-prototype 6", JSON.stringify([cf?.defaultRounds, docs?.defaultRounds, web?.defaultRounds])); }
  for (const id of ["images", "video"]) { const w = listed.find((x) => x.id === id); ok(w && !w.eligible && w.why.some((y: string) => /binary output/.test(y)), `${id} is refused at the take: its output is binary`, JSON.stringify(w?.why)); }
  // B's setup steps (an approved crew for the code workflow) run as the scenario's own; A applies a patch to its own sandbox project
  const hB: Ctx = { s: p.B, vars: {}, firstmate: async () => [] } as any;
  for (const id of bundled) {
    const w = listed.find((x) => x.id === id);
    if (!w) {
      // shipped but not installed on this Studio (a retired default is not seeded on a new install): the take names that
      const t = await must(p.A.api("/api/lan/dispatch", { to: p.keyB, title: `${id} (not here)`, briefing: "Work for a workflow this Studio does not have." }), `A dispatches for ${id}`);
      const d = await item(p.B, "dispatch", t.id), before = (await must(p.B.api("/api/wruns"), "B's runs")).runs.length;
      const x = await p.B.api(`/api/lan/items/${d.id}/approve`, { seen: seenOf(d.prompt), workflow: id, provider: "codex", roundsOnly: true, rounds: 6 });
      const after = (await must(p.B.api("/api/wruns"), "B's runs")).runs.length, inst = (await p.B.api(`/api/wf/${id}`)).status;
      ok(x.status === 400 && /not installed/.test(String(x.body?.error)) && after === before && inst !== 200, `${id}: not installed on B, refused at the take with that reason, nothing started`, `${x.status} ${JSON.stringify(x.body).slice(0, 300)} (GET /api/wf/${id}: ${inst})`);
      await must(p.B.api(`/api/lan/items/${d.id}/reject`, { note: "not here" }), "B declines"); await must(p.A.api(`/api/lan/threads/${t.id}/withdraw`, { reason: "refused at the take" }), "A withdraws it"); await p.A.api("/api/lan/sync", {});
      rows.push({ id, verdict: "refuses", why: String(x.body?.error ?? "") }); continue;
    }
    if (!w.eligible) {
      // refused at the take, with its reason, and nothing starts
      const t = await must(p.A.api("/api/lan/dispatch", { to: p.keyB, title: `${id} (refused)`, briefing: "Work a peer cannot run here.", workflow: null }), `A dispatches for ${id}`);
      const d = await item(p.B, "dispatch", t.id), before = (await must(p.B.api("/api/wruns"), "B's runs")).runs.length;
      const x = await p.B.api(`/api/lan/items/${d.id}/approve`, { seen: seenOf(d.prompt), workflow: id, provider: "codex", roundsOnly: true, rounds: 6 });
      const after = (await must(p.B.api("/api/wruns"), "B's runs")).runs.length, why = String(x.body?.error ?? "");
      ok(x.status === 409 && x.body?.code === "profile" && why.includes(w.why[0]) && after === before, `${id}: refused at the take with its reason, nothing started`, `${x.status} ${JSON.stringify(x.body).slice(0, 300)}`);
      await must(p.B.api(`/api/lan/items/${d.id}/reject`, { note: "cannot run here" }), "B declines"); await must(p.A.api(`/api/lan/threads/${t.id}/withdraw`, { reason: "refused at the take" }), "A withdraws it"); await p.A.api("/api/lan/sync", {});
      rows.push({ id, verdict: "refuses", why: w.why.join("; ") });
      continue;
    }
    const r = runFor(id);
    if (!r) { ok(false, `${id}: an offline acceptance run that finishes the work answers its cards`); rows.push({ id, verdict: "FAIL", why: "no scenario run" }); continue; }
    try {
      for (const step of r.setup) { const f = STEPS[step]; if (!f) throw new Error(`no setup step ${step}`); await f(hB); }
      if (w.needsProject) hB.vars.project ??= "sandbox";
      const w2 = (await must(p.B.api("/api/lan/workflows"), "B's workflows")).workflows.find((x: any) => x.id === id); // staffing approved by setup
      const what = await relayOne(p, w2, r, hB);
      ok(true, `${id}: relayed end to end across two Studios, two rounds (${what})`);
      rows.push({ id, verdict: "passes", why: what });
    } catch (e: any) { ok(false, `${id}: relayed end to end across two Studios`, String(e?.message ?? e).slice(0, 1200)); rows.push({ id, verdict: "FAIL", why: String(e?.message ?? e).slice(0, 200) }); }
  }
} finally { await p.close(); }
// the table against the pinned one: the same workflows, each with its verdict (and a refusal with its reason)
{ const shipped = new Set(bundled), pinned = new Set(Object.keys(EXPECTED));
  const unpinned = [...shipped].filter((id) => !pinned.has(id)), gone = [...pinned].filter((id) => !shipped.has(id));
  ok(!unpinned.length && !gone.length, "every shipped workflow has a row in the pinned table, and every row ships", JSON.stringify({ unpinned, gone }));
  for (const [id, want] of Object.entries(EXPECTED)) { const r = rows.find((x) => x.id === id);
    const good = !!r && (want === "passes" ? r.verdict === "passes" : r.verdict === "refuses" && want.test(r.why));
    ok(good, `${id}: ${want === "passes" ? "relayed across two boards" : `refused at the take (${want.source})`}, as pinned`, r ? `${r.verdict}: ${r.why.slice(0, 300)}` : "not in the table"); } }

console.log("\nworkflow                     verdict   reason / evidence");
for (const r of rows) console.log(`${r.id.padEnd(28)} ${r.verdict.padEnd(9)} ${r.why}`);
console.log(`\nlan-workflows: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
