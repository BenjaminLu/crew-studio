// Compare transcripts, the API (docs/units/compare-transcripts.md): a seeded startup Task pairs founder and judge
// round by round from the workflow's `compare` hint; a workflow without one offers every agent Round to pick two;
// every text is redacted; names, traversal and symlinks are refused.        bun tests/compare.ts
import { appendFileSync, linkSync, mkdtempSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suite } from "./rt-harness";
import { seeded, plant, PLANTED, FLOW, FINAL_LONG } from "./compare-fixture";
import { createTranscripts, parseLines } from "../src/transcripts";
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

// ---- a final message is shown once: the writer keeps the whole message only, the reader collapses older copies ----
{ const raw = readFileSync(join(H.data, "runs", startup, "nodes", "pitch2", "1", "stream.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const msgs = raw.filter((o) => o.type === "message" && o.text.includes("已提交第 2 輪提案"));
  const whole = msgs.filter((m) => m.text.endsWith(FINAL_LONG)), pieces = msgs.filter((m) => !m.text.endsWith(FINAL_LONG));
  // a long answer still streams to disk in pieces past 4000 characters (a live round shows progress); the whole message follows once
  ok(whole.length === 1 && pieces.every((m) => whole[0].text.startsWith(m.text)), "the writer records the whole final answer once, after its streamed pieces only", `${msgs.length} ${msgs.map((m) => m.text.length)}`);
  ok(raw.filter((o) => o.type === "message" && o.text === `已提交第 1 輪提案。`).length === 0 && readFileSync(join(H.data, "runs", startup, "nodes", "pitch1", "1", "stream.jsonl"), "utf8").split("已提交第 1 輪提案。").length === 2, "a short streamed answer is written once, not twice");
  const r = await call(`/api/tasks/${startup}/compare/pitch2/1`);
  ok(r?.body.entries.filter((e: any) => e.kind === "text" && /已提交第 2 輪提案/.test(e.text)).length === 1, "the compare view shows it once");
  // an older record, written before the fix: a 4000-character piece, the whole text, and the whole text again 1 ms later
  const full = "舊紀錄的最終回答：" + "x".repeat(6000), t = Date.parse("2026-10-16T07:06:21.698Z");
  const at = (ms: number) => new Date(t + ms).toISOString();
  const lines = [{ ts: at(0), type: "message", text: "我先看一下。" }, { ts: at(1), type: "message", text: full.slice(0, 4005) }, { ts: at(2), type: "message", text: full }, { ts: at(3), type: "message", text: full }, { ts: at(4), type: "status", status: "ok" }].map((o) => JSON.stringify(o));
  const es = parseLines(lines);
  ok(es.filter((e) => e.kind === "text").map((e) => e.text!.length).join(",") === `6,${full.length}`, "the reader shows a piece and a repeat of the same answer once", es.map((e) => `${e.kind}:${e.text?.length}`).join(","));
  { const two = parseLines([{ type: "message", text: "先看。" }, { type: "message", text: full.slice(0, 4005) }, { type: "message", text: full.slice(4005) }, { type: "message", text: full }].map((o) => JSON.stringify(o)));
    ok(two.map((e) => e.text!.length).join(",") === `3,${full.length}`, "pieces that together make up the next message are shown as that message", two.map((e) => e.text!.length).join(",")); }
  ok(parseLines([JSON.stringify({ type: "message", text: "Done." }), JSON.stringify({ type: "tool_call", id: "1", name: "x", args: {} }), JSON.stringify({ type: "message", text: "Done." })]).filter((e) => e.kind === "text").length === 2, "the same text on both sides of a tool call stays twice");
  // the Transcripts page reads the same way
  const d = join(H.data, "runs", startup, "nodes", "judge1", "1");
  appendFileSync(join(d, "stream.jsonl"), lines.join("\n") + "\n");
  const tr = createTranscripts({ stateDir: mkdtempSync(join(tmpdir(), "crew-compare-state-")), dataDir: H.data, sessionFile: () => null });
  const res = await tr.handle(new Request("http://x"), new URL(`http://x/api/node-runs/${startup}/judge1/1/transcript`), { kind: "desktop" }, false);
  const body: any = await res!.json();
  ok(body.entries.filter((e: any) => e.kind === "text" && e.text === full).length === 1 && !body.entries.some((e: any) => e.kind === "text" && e.text === full.slice(0, 4005)), "the Transcripts page shows it once too"); }

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
  ok(readConfined(root, [startup, "nodes", "pitch1", "1"], 1 << 20) === null, "the reader refuses a folder as a file");
  // a hard link to a file outside data/runs
  const d4 = join(H.data, "runs", startup, "nodes", "pitch3", "1");
  unlinkSync(join(d4, "report.json")); linkSync(join(outside, "report.json"), join(d4, "report.json"));
  unlinkSync(join(d4, "prompt.md")); linkSync(join(outside, "prompt.md"), join(d4, "prompt.md"));
  const r4 = await call(`/api/tasks/${startup}/compare/pitch3/1`);
  ok(r4?.status === 200 && !r4.text.includes("OUTSIDE-") && r4.body.report === null && r4.body.prompt === null && r4.body.entries.length > 0, "a hard-linked report or prompt is not served", r4?.text.slice(0, 200));
  // a FIFO in place of the stream: refused at once, never waited on
  const d5 = join(H.data, "runs", startup, "nodes", "pitch2", "1");
  unlinkSync(join(d5, "stream.jsonl")); execFileSync("mkfifo", [join(d5, "stream.jsonl")]);
  const t0 = Date.now(); const r5 = await call(`/api/tasks/${startup}/compare/pitch2/1`);
  ok(r5?.status === 200 && r5.body.entries.length === 0 && Date.now() - t0 < 3000 && /Role: founder; round: 2/.test(r5.body.prompt?.body ?? ""), "a FIFO stream is refused without hanging", `${Date.now() - t0} ms`); }

H.stop();
end();
