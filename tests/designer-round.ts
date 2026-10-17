import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The designer round in code-firstmate (src/domain/code-design.ts). Stub providers only, the stub renderer for the captures.
//   1 a UI change runs the designer as its own agent node (role designer) after CI's captures, in a fresh context: it gets the
//     before / after captures as pictures, the spec, the captain's notes and the UI diff; its REJECT is a blocking fail that goes
//     back to the worker through the fix loop, and the merge card shows the verdicts beside the captures
//     (main: a single non-blocking designer-compare judge on SSIM numbers, whose warnings no card showed)
//   2 a change that touches no UI path skips the designer, with the reason it is not applicable in the ledger and on the card
//   3 a designer with no verdict after its retry stops on its own step-back card; "another model" reruns the designer on it
//   5 gate-design on the merge edge: design-scope's none or a design APPROVE on the exact head
//   (i) an app is declared but its pages are not captured: a typed env gap routed to Firstmate first, never a diff-only verdict
//   (ii) no app declared, a UI path changed: a diff-only designer review, labelled so on the card
//   bun tests/designer-round.ts
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("designer-round");
const root = join(import.meta.dir, "..");
const WF = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const { prepareSandbox, registerSandbox, applySandboxAddons } = await import("../src/sandbox-repo");
const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
process.env.CREW_RENDER_STUB = "1";
const dirs: string[] = []; const stops: (() => void)[] = [];
const boot = async (app: boolean) => { const data = checkedTempDir("crew-designer-"); dirs.push(data); prepareSandbox(data); if (app) applySandboxAddons(data); registerSandbox(data);
  const H = await harness([WF], { data, checkRoots: [] }); installCode(H.engine, { dataDir: data, projects: new Projects(data) }); stops.push(H.stop); return { E: H.engine, data }; };
const settled = (E: any, id: string) => ["succeeded", "failed", "cancelled"].includes(E.get(id)!.status);
const openCard = (E: any, id: string, pred: (c: any) => boolean) => E.cards.list({ run: id, open: true }).find(pred);
const toMerge = async (E: any, text: string, note?: string, stop: (c: any) => boolean = (c) => c.kind === "merge") => {
  const r = E.start({ workflow: "code-firstmate", params: {}, text });
  await until(() => settled(E, r.id) || !!openCard(E, r.id, (c: any) => c.kind === "dispatch"), 120000);
  const d = openCard(E, r.id, (c: any) => c.kind === "dispatch"); if (d) await E.answer(d.id, { choice: "dispatch", by: "captain", ...(note ? { note } : {}) });
  await until(() => settled(E, r.id) || !!openCard(E, r.id, stop), 240000); return r.id as string; };
const STOP = (c: any) => c.kind === "merge" || c.node === "design-gap-card" || c.node === "step-back";
const L = (E: any, id: string, check: string) => E.ledger(id).filter((e: any) => e.check === check);
const nodes = (E: any, id: string) => JSON.stringify(Object.fromEntries(Object.entries(E.get(id)!.nodes).filter(([, n]: any) => n.state !== "pending").map(([k, n]: any) => [k, `${n.state}:${n.outcome}:${n.error ?? n.note ?? ""}`.slice(0, 160)])));
// a test that is red on the base by an assertion (the module is missing), not by a failed import
const TEST = "STUB_FILE test/notes.test.ts :: import { expect, test } from 'bun:test';\\ntest('the shop has notes', async () => { expect(await Bun.file(new URL('../app/notes.ts', import.meta.url)).exists()).toBe(true); const { notes } = await import('../app/notes'); expect(notes).toBe(1); });\\n";

// ---------- 1. a UI change: the designer sees the captures, REJECTs, the fix loop runs, the re-review approves, the card shows it ----------
{ const { E, data } = await boot(true);
  const id = await toMerge(E, ["Add a notes module to the shop app",
    "STUB_FILE app/notes.ts :: // notes STUB_DESIGN_REJECT STUB_DESIGN_LAZY\\nexport const notes = 1;\\n",
    "STUB_FIX app/notes.ts :: STUB_DESIGN_REJECT => designed", TEST].join("\n"), "Keep the heading short");
  const run = E.get(id)!; const merge = openCard(E, id, (c: any) => c.kind === "merge");
  if (!merge) console.log("no merge card:", nodes(E, id));
  const scope = L(E, id, "firstmate/design-scope"); const ver = L(E, id, "firstmate/design-verdict");
  ok(scope.length >= 2 && scope.every((e: any) => e.verdict === "pass" && e.data?.route === "ui" && e.data.ui.includes("app/notes.ts")),
    "1: a diff touching the app's paths routes to the designer (design-scope: ui), on every round", JSON.stringify(scope.map((e: any) => e.data)));
  const steps = run.steps.filter((s: any) => s.node === "designer" && s.kind === "agent");
  ok(run.def.nodes.find((n: any) => n.id === "designer")?.role === "designer" && run.def.nodes.find((n: any) => n.id === "designer")?.kind === "agent" && steps.length >= 2,
    "1: the designer is its own agent node on the staffed designer role, one round per review", JSON.stringify(steps.map((s: any) => [s.state, s.outcome])));
  const views = ["index.html:after", "index.html:before", "jpy.html:after", "jpy.html:before"];
  ok(ver.length === 2 && ver.every((e: any) => JSON.stringify([...(e.data?.viewed ?? [])].sort()) === JSON.stringify(views)),
    "1: before each verdict the designer saw every page's before and after capture", JSON.stringify(ver.map((e: any) => e.data?.viewed)));
  // the pictures went to the provider as images: the tool route returned them, the stub (no image input) got the note in their place
  const streams = (() => { const dir = join(data, "runs", id, "nodes", "designer"); if (!existsSync(dir)) return "";
    return readdirSync(dir).map((v) => join(dir, v, "stream.jsonl")).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n"); })();
  const attached = (streams.match(/attached \(image\/png, \d+ bytes\)/g) ?? []).length;
  const capFile = join(data, "runs", id, "captures", String(run.ctx.captures?.head ?? "").slice(0, 12), "after", "index.html.png");
  ok(attached >= 8 && existsSync(capFile) && !/"data":"iVBOR/.test(streams),
    "1: each design_view carries the capture as an image part (logs keep a note, never the bytes)", `attached=${attached} ${capFile}`);
  ok((ver[0]?.data?.refusals ?? []).some((r: string) => /a verdict needs every capture seen first; not yet viewed: /.test(r)),
    "1: a verdict before seeing the captures is refused", JSON.stringify(ver[0]?.data?.refusals));
  const f0 = ver[0]?.findings?.[0];
  ok(ver[0]?.verdict === "fail" && ver[0]?.blocking === true && f0?.class === "design" && f0.locator?.type === "web" && /\/captures\/[0-9a-f]{12}\/after\/index\.html\.png$/.test(f0.locator.url) && f0.locator.selector === "h1",
    "1: a design REJECT is a blocking fail with a finding located on the head's capture", JSON.stringify(ver[0]));
  ok(run.nodes.fix?.visits >= 1 && run.nodes.build?.visits === 2 && /firstmate\/design-verdict/.test(run.ctx.briefs?.build?.text ?? "") && /the heading still reads STUB_DESIGN_REJECT/.test(run.ctx.briefs?.build?.text ?? ""),
    "1: the REJECT goes back to the worker through the fix loop, its finding in the brief", nodes(E, id));
  const p2 = run.ctx.lastPrompt?.designer ?? "";
  ok(/^DESIGN REVIEW\n.*design review 2 ·/.test(p2) && /\nView: page=index\.html side=before \(Shop in dollars\)/.test(p2) && /Captain's notes:\n- dispatch \(dispatch\): Keep the heading short/.test(p2)
    && /Your earlier REJECT \(head [0-9a-f]{8}\): check each item on the new head\.\n1\. index\.html · h1: the heading still reads/.test(p2) && /UI diff \(base\.\.head\):\ndiff --git a\/app\/notes\.ts/.test(p2) && /What:/.test(p2),
    "1: the re-review prompt carries the spec, the captain's notes, the captures, the earlier REJECT and the UI diff", p2.slice(0, 1400));
  ok(ver[1]?.verdict === "pass" && JSON.stringify((run.ctx.designs ?? []).map((d: any) => d.verdict)) === '["REJECT","APPROVE"]' && run.ctx.designs[1].head === run.ctx.head,
    "1: the re-review approves the fixed head", JSON.stringify(run.ctx.designs?.map((d: any) => [d.verdict, d.head?.slice(0, 8)])));
  const dd = merge?.detail?.design;
  ok(!!merge && dd?.applicable === true && dd.captures === "seen" && JSON.stringify(dd.verdicts.map((v: any) => v.verdict)) === '["REJECT","APPROVE"]' && dd.seen === 4 && dd.compare?.verdict != null && (merge.captures ?? []).length === 2
    && /\n\nDesigner: APPROVE by stub·no model \(designer #2\) at [0-9a-f]{8}; saw 4 captures\nEarlier: REJECT/.test(merge.body),
    "1: the merge card shows the designer's verdicts and what it saw, with the captures", JSON.stringify([dd, merge?.body.slice(-400)]));
  // 5: the seventh gate, on the merge edge, bound to the head the designer approved
  const gate = L(E, id, "firstmate/gate-design").at(-1) as any;
  ok(!!merge && gate?.verdict === "pass" && gate.edge === "remote-ready→merge-card[ok]" && gate.data.head === run.ctx.designs[1].head && /^design APPROVE at [0-9a-f]{8}$/.test(gate.data.detail)
    && dd?.gate?.verdict === "pass" && /\nDesign gate: ✓ design APPROVE at /.test(merge!.body) && (merge!.detail?.gates ?? []).length === 6,
    "5: gate-design passes on the merge edge only on the head the designer approved, beside the six gates", JSON.stringify([gate?.data, gate?.edge]));
  const gx = (ctx: any, ledger: any[]) => (E as any).natives["gate-design"]({}, { x: { run: { id: "R-gate" }, ctx, rn: { data: {} } } });
  const realLedger = E.ledger.bind(E); const h = run.ctx.designs[1].head;
  const withLedger = async (entries: any[]) => { (E as any).ledger = () => entries; try { return await gx({ ...run.ctx }, entries); } finally { (E as any).ledger = realLedger; } };
  const scopeUi = { check: "firstmate/design-scope", head: "0".repeat(40), data: { route: "ui" } };
  const stale = await withLedger([scopeUi, { check: "firstmate/design-verdict", verdict: "pass", head: "1".repeat(40), data: { head: "1".repeat(40) } }]);
  const reject = await withLedger([scopeUi, { check: "firstmate/design-verdict", verdict: "fail", head: h, data: { head: h } }]);
  const carried = await withLedger([scopeUi, { check: "firstmate/design-verdict", verdict: "pass", head: "1".repeat(40), data: { head: "1".repeat(40) } }, { record: "approval-carry", check: "approval-carry", head: h, data: { proof: { fromHead: "1".repeat(40), toHead: h, clean: true } } }]);
  const noneElsewhere = await withLedger([{ check: "firstmate/design-scope", head: "1".repeat(40), data: { route: "none" } }]);
  ok(stale.verdict === "fail" && /not an APPROVE on/.test(stale.data.detail) && reject.verdict === "fail" && carried.verdict === "pass" && /carried to/.test(carried.data.detail) && noneElsewhere.verdict === "fail",
    "5: gate-design fails an APPROVE on another head, a REJECT and a none on another head; a proven-identical carry passes", JSON.stringify([stale.data, reject.data, carried.data, noneElsewhere.data]));
  E.cancel(id, "captain"); }

// ---------- 1. the merge card shows a standing REJECT's findings and designer-compare's warnings ----------
{ const { designDetail, designText } = await import("../src/domain/mergecard");
  const i: any = { run: "R-1", ledger: [{ check: "firstmate/designer-compare", verdict: "warn", findings: [{ message: "index.html changed visibly (SSIM 0.41)" }] }],
    ctx: { designScope: { route: "ui", reason: "UI paths changed: app/x.ts" }, designs: [{ verdict: "REJECT", by: "codex·gpt (designer #1)", head: "a".repeat(40), seen: ["index.html:after"], findings: [{ page: "index.html", element: "h1", problem: "too big", change: "h1 { font-size: 28px }" }] }] } };
  const d = designDetail(i); const t = designText(d);
  ok(d?.findings.length === 1 && d.compare?.warnings[0] === "index.html changed visibly (SSIM 0.41)" && /1\. index\.html h1: too big → h1 \{ font-size: 28px \}/.test(t) && /Designer-compare \(warn\):\n- index\.html changed visibly/.test(t),
    "1: a REJECT's findings and designer-compare's warnings reach the card", t); }

// ---------- 2. a change that touches no UI path: the designer is skipped, the reason recorded ----------
{ const { E } = await boot(false);
  const id = await toMerge(E, ["Add a percent function to money-kit", 'STUB_FILE src/percent.ts :: export function percent(a: number, p: number): number {\\n  return Math.round((a * p) / 100);\\n}\\n',
    "STUB_FILE test/percent.test.ts :: import { expect, test } from 'bun:test';\\ntest('percent', async () => { expect(await Bun.file(new URL('../src/percent.ts', import.meta.url)).exists()).toBe(true); const { percent } = await import('../src/percent'); expect(percent(1999, 15)).toBe(300); });\\n"].join("\n"));
  const run = E.get(id)!; const merge = openCard(E, id, (c: any) => c.kind === "merge"); const sc = L(E, id, "firstmate/design-scope").at(-1) as any;
  if (!merge) console.log("no merge card:", nodes(E, id));
  ok(!!merge && sc?.verdict === "pass" && sc.data?.route === "none" && /^not applicable: no changed path is UI/.test(sc.data.reason) && !run.steps.some((s: any) => s.node === "designer") && !L(E, id, "firstmate/design-verdict").length,
    "2: a diff with no UI path skips the designer, with the reason it is not applicable in the ledger", nodes(E, id));
  ok(merge?.detail?.design?.applicable === false && /\n\nDesigner: not applicable \(no changed path is UI/.test(merge?.body ?? ""), "2: the merge card says the designer was not applicable and why", merge?.body.slice(-300));
  const gate = L(E, id, "firstmate/gate-design").at(-1) as any;
  ok(gate?.verdict === "pass" && /^no UI path changed at [0-9a-f]{8}$/.test(gate.data.detail) && gate.data.head === sc?.head, "5: with no UI path changed on the merged head, gate-design passes", JSON.stringify(gate?.data));
  E.cancel(id, "captain"); }

// ---------- (ii) no app declared, a UI path changed: a diff-only review, labelled so ----------
{ const { E } = await boot(false);
  const id = await toMerge(E, ["Add a landing page", "STUB_FILE public/landing.html :: <!doctype html><h1>Hi</h1>\\n",
    "STUB_FILE test/landing.test.ts :: import { expect, test } from 'bun:test';\\ntest('landing', async () => { const f = Bun.file(new URL('../public/landing.html', import.meta.url)); expect(await f.exists()).toBe(true); expect(await f.text()).toContain('Hi'); });\\n"].join("\n"));
  const run = E.get(id)!; const merge = openCard(E, id, (c: any) => c.kind === "merge"); const sc = L(E, id, "firstmate/design-scope").at(-1) as any; const ver = L(E, id, "firstmate/design-verdict").at(-1) as any;
  if (!merge) console.log("no merge card:", nodes(E, id));
  ok(sc?.data?.route === "ui" && sc.data.diffOnly === true && sc.data.captures === "diff-only" && ver?.verdict === "pass" && ver.data?.diffOnly === true && run.ctx.designs?.at(-1)?.diffOnly === true && /· diff-only\n/.test(run.ctx.lastPrompt?.designer ?? "") && /Diff-only review, no pictures/.test(run.ctx.lastPrompt?.designer ?? ""),
    "(ii): with no app declared a UI change gets a diff-only designer review, recorded diffOnly", JSON.stringify([sc?.data, ver?.data]));
  ok(!!merge && merge.detail?.design?.captures === "diff-only" && /Designer: APPROVE by .*; diff-only, no pictures \(the repository declares no app\)/.test(merge.body) && L(E, id, "firstmate/gate-design").at(-1)?.verdict === "pass",
    "(ii): the merge card labels it diff-only, no pictures", merge?.body.slice(-400));
  E.cancel(id, "captain"); }

// ---------- (i) an app declared but its pages not captured: an env gap to Firstmate first, never a diff-only verdict ----------
{ const { E } = await boot(true); delete process.env.CREW_RENDER_STUB; process.env.CREW_NODE_BIN = "/nonexistent/node";
  const id = await toMerge(E, ["Add a notes module to the shop app", "STUB_FILE app/notes.ts :: // notes\\nexport const notes = 1;\\n", TEST].join("\n"), undefined, STOP);
  const run = E.get(id)!; const sc = L(E, id, "firstmate/design-scope").at(-1) as any; const card = openCard(E, id, (c: any) => c.node === "design-gap-card");
  const events = E.events?.(id) ?? []; const gapEvent = JSON.stringify(run.ctx.envGaps ?? []);
  ok(sc?.verdict === "fail" && sc.blocking === true && sc.data?.route === "gap" && sc.data.captures === "none-env-gap" && sc.findings?.[0]?.class === "env.design-captures" && /the pictures|no picture|not shot/.test(sc.findings[0].message)
    && /"code":"env.design-captures","route":"firstmate"/.test(gapEvent),
    "(i): an app declared but not captured is a typed env gap (env.design-captures, routed to Firstmate), a blocking fail", JSON.stringify([sc?.data, run.ctx.envGaps]));
  ok(run.steps.some((s: any) => s.node === "design-gap" && s.kind === "agent" && s.outcome === "escalate") && run.def.nodes.find((n: any) => n.id === "design-gap")?.role === "coordinator" && !run.steps.some((s: any) => s.node === "designer")
    && !/env\.design-captures/.test(run.ctx.briefs?.build?.text ?? "") && !(run.ctx.designs ?? []).length,
    "(i): Firstmate gets the gap first; no designer ran, no verdict, nothing reached the worker's brief", nodes(E, id));
  ok(!!card && card.captainOnly && /env\.design-captures/.test(card.body) && /Firstmate \(credential-permission\)/.test(card.body) && !openCard(E, id, (c: any) => c.kind === "merge"),
    "(i): the captain sees it only through Firstmate's escalation, and no merge card", JSON.stringify([card?.body, nodes(E, id)]));
  process.env.CREW_RENDER_STUB = "1"; delete process.env.CREW_NODE_BIN;
  if (card) await E.answer(card.id, { choice: "recapture", by: "captain" });
  await until(() => settled(E, id) || !!openCard(E, id, (c: any) => c.kind === "merge"), 120000);
  const merge = openCard(E, id, (c: any) => c.kind === "merge");
  ok(!!merge && L(E, id, "firstmate/design-scope").at(-1)?.data?.route === "ui" && L(E, id, "firstmate/design-verdict").at(-1)?.data?.viewed?.length === 4 && merge.detail?.design?.captures === "seen",
    "(i): once the renderer is there, recapture runs design-scope again, the designer sees the pictures and the merge card comes", nodes(E, id));
  E.cancel(id, "captain"); }

// ---------- the merge card labels a capture gap "no captures" ----------
{ const { designDetail, designText } = await import("../src/domain/mergecard");
  const d = designDetail({ run: "R-1", ledger: [], ctx: { designScope: { route: "gap", reason: "UI paths changed: app/x.ts; no captures: index.html after: no picture" } } } as any);
  ok(d?.captures === "none-env-gap" && d.applicable === true && /Designer: no verdict; no captures \(an env gap/.test(designText(d)), "(i): a capture gap reads \"no captures\" on the card, never as a diff-only review", designText(d)); }

// ---------- 3. design-unverified: the step-back card, and another model reruns the designer (not the review) ----------
{ const { E } = await boot(true);
  const id = await toMerge(E, ["Add a notes module to the shop app", "STUB_FILE app/notes.ts :: // notes STUB_DESIGN_SILENT\\nexport const notes = 1;\\n", TEST].join("\n"), undefined, STOP);
  const card = openCard(E, id, (c: any) => c.node === "step-back"); const ver = L(E, id, "firstmate/design-verdict").at(-1) as any;
  ok(!!card && ver?.findings?.[0]?.class === "design-unverified" && /^The designer gave no verdict: /.test(card.title?.en ?? card.title) && /^設計審查沒有給出結論：/.test(card.title?.["zh-TW"] ?? "") && JSON.stringify(card.options.map((o: any) => o.id)) === '["other-model","rescope","park"]' && E.get(id)!.ctx.stepBackFor === "design",
    "3: a designer without a verdict after its retry stops on its own step-back card (other model / rescope / park)", JSON.stringify([card?.title, card?.options?.map((o: any) => o.id), nodes(E, id)]));
  const reviewsBefore = (E.get(id)!.nodes.review?.data?.jobs ?? []).length;
  if (card) await E.answer(card.id, { choice: "other-model", note: "other/model-x", by: "captain" });
  await until(() => settled(E, id) || !!openCard(E, id, (c: any) => c.kind === "merge"), 180000);
  const run = E.get(id)!; const djobs = run.nodes.designer?.data?.jobs ?? []; const rjobs = (run.nodes.review?.data?.jobs ?? []).slice(reviewsBefore);
  ok(!!openCard(E, id, (c: any) => c.kind === "merge") && djobs.at(-1)?.provider === "other" && rjobs.length >= 1 && rjobs.every((j: any) => j.provider !== "other") && run.ctx.designUnverified === null && run.ctx.designs?.at(-1)?.verdict === "APPROVE",
    "3: \"another model\" reruns the designer on it (the review keeps its own pick) and the round goes on", JSON.stringify([djobs.map((j: any) => j.provider), rjobs.map((j: any) => j.provider), nodes(E, id)]));
  E.cancel(id, "captain"); }

for (const s of stops) try { s(); } catch {}
for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch {}
end();
