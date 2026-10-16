// Compare transcripts, the API (docs/units/compare-transcripts.md): a seeded startup Task pairs founder and judge
// round by round from the workflow's `compare` hint; a workflow without one offers every agent Round to pick two;
// every text is redacted; names, traversal and symlinks are refused.        bun tests/compare.ts
import { mkdirSync, mkdtempSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suite } from "./rt-harness";
import { seeded, plant, PLANTED, FLOW } from "./compare-fixture";
import { createCompare, comparePlan, readConfined } from "../src/compare";
import { taskAlias } from "../src/tasks-api";
import { normalize, validate } from "../src/runtime/defs";
import { parseYaml } from "../src/bundled";
const { ok, end } = suite("compare");

const { H, startup, plain } = await seeded();
const E = H.engine as any;
let phoneRaw = false;
const api = createCompare({ dataDir: H.data, get: (id) => E.get(id), current: (wf) => E.defs.get(wf), phoneRaw: () => phoneRaw });
const call = async (p: string, who = "desktop") => { const r = await api.handle(new URL(`http://x${p}`), { kind: who }, false); return r ? { status: r.status, text: await r.clone().text(), body: await r.json() } : null; };

// ---- the hint itself ----
{ const y = normalize(parseYaml(FLOW));
  ok(JSON.stringify((y as any).compare) === JSON.stringify([["founder", "judge"]]), "the startup workflow declares founder↔judge pairs in its yaml", JSON.stringify((y as any).compare));
  ok(!validate(y).some((p) => /compare/.test(p.text)), "the startup hint validates");
  const bad = normalize({ ...parseYaml(FLOW), compare: [["founder", "nobody"]] });
  ok(validate(bad).some((p) => p.level === "error" && /compare/.test(p.text)), "a hint naming an unknown role is an error");
  ok(validate(normalize({ ...parseYaml(FLOW), compare: [["founder", "founder"]] })).some((p) => /compare/.test(p.text)), "a hint pairing a role with itself is an error");
  ok(taskAlias(`/api/tasks/${startup}/compare`, false) === null && taskAlias(`/api/tasks/${startup}/compare/pitch1/1`, false) === null, "compare paths are served here, not aliased to /api/wruns"); }

// ---- done line 1: paired rounds for a seeded startup Task ----
const plan = await call(`/api/tasks/${startup}/compare`);
{ const p = plan?.body;
  ok(plan?.status === 200 && p.source === "task" && JSON.stringify(p.declared) === JSON.stringify([["founder", "judge"]]), "the plan reads the pairs from the Task's own workflow copy", JSON.stringify(p?.declared));
  ok(p?.pairs?.length === 3 && p.pairs.map((x: any) => x.key).join(",") === "1,2,3", "three rounds", JSON.stringify(p?.pairs?.map((x: any) => x.key)));
  ok(p?.pairs?.length === 3 && p.pairs.every((x: any, i: number) => x.left?.node === `pitch${i + 1}` && x.left.role === "founder" && x.right?.node === `judge${i + 1}` && x.right.role === "judge"), "round k pairs pitch k (founder) with judge k (judge)",
    JSON.stringify(p?.pairs?.map((x: any) => [x.left?.node, x.right?.node])));
  ok(p?.pairs?.length === 3 && p.pairs.every((x: any) => x.left.provider === "claude" && x.left.model === "fixture-claude" && x.right.provider === "codex" && x.right.model === "fixture-codex"), "each side names its provider and exact model");
  ok(p?.pairs?.length === 3 && p.pairs.every((x: any) => x.left.roleLabel === "Claude 創業者" && x.right.roleLabel === "Codex 評審" && x.left.seconds != null && x.right.state === "passed" && x.right.outcome === "revise"
    && x.left.transcript === `#/runs/node/${startup}/${x.left.node}/1/transcript`), "each side has its role, duration, outcome and log link", JSON.stringify(p?.pairs?.[0]));
  ok(p?.rounds?.length === 6, "all six agent rounds are offered to pick from too", String(p?.rounds?.length)); }
{ const r = await call(`/api/tasks/${startup}/compare/pitch2/1`), j = await call(`/api/tasks/${startup}/compare/judge2/1`);
  const sub = r?.body.entries?.find((e: any) => e.kind === "tool" && e.name === "startup_submit");
  ok(r?.status === 200 && /Role: founder; round: 2\/3/.test(r.body.prompt?.body ?? "") && r.body.prompt.header?.node === "pitch2", "a side carries its exact prompt and record header", r?.body.prompt?.body?.slice(0, 120));
  ok(/創業提案第 2 輪/.test(sub?.args?.text ?? "") && /回應第 1 輪評審/.test(sub?.args?.revision ?? ""), "its startup_submit tool call carries the proposal and the revision", JSON.stringify(sub));
  ok(r?.body.entries.some((e: any) => e.kind === "toolResult" && /saved/.test(e.body)) && r.body.entries.some((e: any) => e.kind === "text" && /已提交第 2 輪提案/.test(e.text)), "its tool result and messages are there");
  ok(r?.body.report?.status === "done" && j?.body.report?.status === "done" && j.body.entries.some((e: any) => e.kind === "tool" && e.args?.verdict === "revise" && e.args?.score === 70), "the final report and the judge's score and verdict", JSON.stringify(j?.body.report)); }

// ---- done line 2: a workflow without a hint picks any two rounds ----
{ const p = (await call(`/api/tasks/${plain}/compare`))?.body;
  ok(p?.declared?.length === 0 && p.pairs.length === 0 && p.source === null, "a workflow without a hint declares no pairs", JSON.stringify(p?.declared));
  ok(p?.rounds?.map((x: any) => x.node).join(",") === "draft,edit", "its agent rounds are offered to pick from", p?.rounds?.map((x: any) => x.node).join(","));
  const a = await call(`/api/tasks/${plain}/compare/draft/1`), b = await call(`/api/tasks/${plain}/compare/edit/1`);
  ok(a?.status === 200 && b?.status === 200 && /write the draft/.test(a.body.prompt?.body) && /edit the draft/.test(b.body.prompt?.body), "any two of them open side by side"); }
{ // a Task started before its workflow gained the hint pairs by the workflow's current version (roles must still match)
  const old = JSON.parse(JSON.stringify(E.get(startup))); delete old.def.compare;
  const p = comparePlan(old, { compare: [["founder", "judge"]] });
  ok(p.source === "workflow" && p.pairs.length === 3, "a Task whose copy predates the hint pairs by the current workflow", `${p.source} ${p.pairs.length}`);
  ok(comparePlan(old, { compare: [["founder", "ghost"]] }).pairs.length === 0, "a current hint naming roles the Task lacks is ignored"); }

// ---- done line 3: redaction ----
plant(H.data, startup, "pitch1");
{ const r = await call(`/api/tasks/${startup}/compare/pitch1/1`);
  ok(r?.status === 200 && !r.text.includes(PLANTED), "a planted credential never leaves the server (prompt, messages, tool args, report)");
  ok(/Old note: token=/.test(r?.body.prompt?.body ?? "") && r?.body.entries.some((e: any) => /^leaked .* in a message$/.test(e.text ?? "")) && /and /.test(r?.body.report?.said ?? ""), "the text around it stays", r?.body.report?.said);
  phoneRaw = false;
  const ph = await call(`/api/tasks/${startup}/compare/pitch1/1`, "phone");
  ok(ph?.status === 200 && ph.body.phone === true && ph.body.prompt === null && ph.body.entries.length === 0 && ph.body.summary?.entries > 0 && !ph.text.includes("創業提案"), "a paired phone gets a summary unless the Mac allows more");
  phoneRaw = true;
  const ph2 = await call(`/api/tasks/${startup}/compare/pitch1/1`, "phone");
  ok(ph2?.body.entries?.length > 0 && !ph2.text.includes(PLANTED), "with phones allowed, the phone reads the same redacted text"); }

// ---- done line 4: names, traversal and symlinks ----
for (const [p, want] of [[`/api/tasks/${startup}/compare/..%2f..%2fetc/1`, 400], [`/api/tasks/${startup}/compare/pitch1/1%2f..%2f..`, 400],
  [`/api/tasks/${startup}/compare/PITCH1/1`, 400], [`/api/tasks/${startup}/compare/accept/1`, 404], [`/api/tasks/${startup}/compare/pitch1/9`, 404], [`/api/tasks/${startup}/compare/nope/1`, 404],
  [`/api/tasks/..%2f${startup}/compare`, 400], [`/api/tasks/R-999/compare`, 404], [`/api/tasks/${startup}/compare/pitch1/0`, 400]] as [string, number][]) {
  const r = await call(p);
  ok(r?.status === want, `refused: ${p} → ${want}`, `${r?.status} ${r?.text.slice(0, 120)}`);
}
{ const r = await call(`/api/tasks/${startup}/compare/pitch1/..`); // the URL parser resolves the dot segment: it names the plan, never a file
  ok(r?.status === 200 && Array.isArray(r.body.pairs) && !("entries" in r.body), "a dot-dot segment resolves to the plan, never to a file"); }
ok((await api.handle(new URL(`http://x/api/tasks/${startup}/compare`), { kind: "desktop" }, true))?.status === 405, "compare is read only");
{ const outside = mkdtempSync(join(tmpdir(), "crew-compare-outside-"));
  writeFileSync(join(outside, "stream.jsonl"), JSON.stringify({ type: "message", text: "OUTSIDE-STREAM-TEXT" }) + "\n");
  writeFileSync(join(outside, "prompt.md"), "OUTSIDE-PROMPT-TEXT");
  writeFileSync(join(outside, "report.json"), JSON.stringify({ status: "done", said: "OUTSIDE-REPORT-TEXT" }));
  // a symlinked file
  const d1 = join(H.data, "runs", startup, "nodes", "judge1", "1");
  unlinkSync(join(d1, "stream.jsonl")); symlinkSync(join(outside, "stream.jsonl"), join(d1, "stream.jsonl"));
  unlinkSync(join(d1, "report.json")); symlinkSync(join(outside, "report.json"), join(d1, "report.json"));
  const r1 = await call(`/api/tasks/${startup}/compare/judge1/1`);
  ok(r1?.status === 200 && !r1.text.includes("OUTSIDE-") && r1.body.entries.length === 0 && r1.body.report === null, "a symlinked stream or report is not followed", r1?.text.slice(0, 200));
  // a symlinked round folder
  const d2 = join(H.data, "runs", startup, "nodes", "judge2", "1"), moved = join(outside, "moved");
  renameSync(d2, moved); writeFileSync(join(moved, "prompt.md"), "OUTSIDE-PROMPT-TEXT"); symlinkSync(moved, d2);
  const r2 = await call(`/api/tasks/${startup}/compare/judge2/1`);
  ok(r2?.status === 200 && !r2.text.includes("OUTSIDE-") && !r2.text.includes("Critique round 2") && r2.body.prompt === null && r2.body.entries.length === 0, "a symlinked round folder is not followed", r2?.text.slice(0, 200));
  // a symlinked node folder
  const d3 = join(H.data, "runs", startup, "nodes", "judge3"), moved3 = join(outside, "moved3");
  renameSync(d3, moved3); symlinkSync(moved3, d3);
  const r3 = await call(`/api/tasks/${startup}/compare/judge3/1`);
  ok(r3?.status === 200 && r3.body.prompt === null && r3.body.entries.length === 0, "a symlinked node folder is not followed");
  // the reader by itself
  const root = join(H.data, "runs");
  ok(readConfined(root, [startup, "nodes", "pitch1", "1", "prompt.md"], 1 << 20) !== null, "the reader reads a plain file under the root");
  ok([[startup, "..", "..", "x"], [startup, "nodes/pitch1", "1", "prompt.md"], ["..", "outside"], [startup, "nodes", "pitch1", "1", ""]].every((parts) => readConfined(root, parts, 1 << 20) === null), "the reader refuses dot-dot, slashes and empty names");
  mkdirSync(join(outside, "fifo-dir"), { recursive: true });
  ok(readConfined(root, [startup, "nodes", "pitch1", "1"], 1 << 20) === null, "the reader refuses a folder as a file"); }

H.stop();
end();
