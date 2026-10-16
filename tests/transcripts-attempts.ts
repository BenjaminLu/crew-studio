// A node round retried and handed off: every attempt and hop is listed in order,
// each with its own prompt, system prompt, transcript and report, and the live
// view follows the newest one.   bun tests/transcripts-attempts.ts
import { appendFileSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFixture } from "./transcripts-fixture.mjs";
const { createTranscripts } = await import("../src/transcripts");

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const fx = buildFixture(mkdtempSync(join(tmpdir(), "crew-attempts-")));
const tr = createTranscripts({ stateDir: fx.state, dataDir: fx.data, sessionFile: () => null });
const get = async (path: string) => { const u = new URL(`http://x${path}`); const r = await tr.handle(new Request(u), u, { kind: "desktop" }, false); return r ? { status: r.status, body: await r.json() } : null; };
const base = "/api/node-runs/R-4/make/1";

const top = (await get(base))!;
const names = (top.body.invocations ?? []).map((i: any) => i.name);
ok(JSON.stringify(names) === '["prompt.md","prompt.attempt2.md","prompt.attempt2.hop1.md"]', "a node round lists every attempt and hop in order", JSON.stringify(top.body.invocations ?? top.body.prompts));
ok(JSON.stringify((top.body.invocations ?? []).map((i: any) => [i.attempt, i.hop])) === "[[1,0],[2,0],[2,1]]", "each invocation names its attempt and hop");
ok(top.body.promptName === "prompt.attempt2.hop1.md" && top.body.prompt?.body === "attempt 2 hand-off prompt\n", "the newest invocation opens by default", top.body.promptName);
const a2 = (await get(`${base}?prompt=prompt.attempt2.md`))!, a1 = (await get(`${base}?prompt=prompt.md`))!;
ok(a2.body.prompt?.body === "attempt 2 prompt\n" && a2.body.system === "sys a2\n" && a1.body.prompt?.body === "attempt 1 prompt\n" && a1.body.system === "sys a1\n" && a1.body.report === null,
  "an older attempt shows its own prompt and system prompt, and no report it did not write", JSON.stringify({ sys: a2.body.system, rep: a1.body.report }));
const a1t = (await get(`${base}/transcript?prompt=prompt.md`))!;
const a2t = (await get(`${base}/transcript?prompt=prompt.attempt2.md`))!;
const h1t = (await get(`${base}/transcript?prompt=prompt.attempt2.hop1.md`))!;
const texts = (r: any) => (r.body.entries ?? []).filter((e: any) => e.kind === "text").map((e: any) => e.text);
ok(JSON.stringify(texts(a1t)) === '["a1 says"]' && JSON.stringify(texts(a2t)) === '["a2 says"]' && JSON.stringify(texts(h1t)) === '["a2 h1 says"]', "each invocation has its own transcript", JSON.stringify([texts(a1t), texts(a2t), texts(h1t)]));
ok(a2.body.report?.said === "a2 report" && (await get(`${base}?prompt=prompt.attempt2.hop1.md`))!.body.report === null, "the report belongs to the invocation that wrote it");
const s2 = (await get(`/api/node-runs/R-5/make/1?prompt=prompt.attempt2.md`))!, s1 = (await get(`/api/node-runs/R-5/make/1?prompt=prompt.md`))!;
const s2t = (await get(`/api/node-runs/R-5/make/1/transcript?prompt=prompt.attempt2.md`))!;
ok(s2.body.report?.said === "second report" && s1.body.report?.said === "first report" && JSON.stringify(texts(s2t)) === '["second stream"]', "per-attempt stream and report files are read when they exist", JSON.stringify([s1.body.report, s2.body.report, texts(s2t)]));
ok((await get(`${base}?prompt=prompt.attempt2.hop9.md`))!.status === 404 && (await get(`${base}?prompt=..%2Fx.md`))!.status === 400, "an unknown or malformed invocation is refused");
// ---------- liveness comes from the engine's node state, not from the newest attempt's files ----------
const runJson = join(fx.data, "runs", "R-4", "run.json");
const setNode = (n: any, status = "running", queue: string[] = []) => writeFileSync(runJson, JSON.stringify({ id: "R-4", status, queue, nodes: { make: n } }));
ok(h1t.body.live === true && h1t.body.newest === "prompt.attempt2.hop1.md", "a node round is live while the engine runs its node", JSON.stringify({ live: h1t.body.live, newest: h1t.body.newest }));
// the hand-off fails: its terminal status and report.json are written, the engine queues a retry, no new prompt yet
appendFileSync(join(fx.retried, "stream.jsonl"), JSON.stringify({ ts: "2026-10-14T04:02:30Z", type: "status", status: "failed", error: "tests red" }) + "\n");
writeFileSync(join(fx.retried, "report.json"), JSON.stringify({ status: "failed", said: "h1 failed", prompt: "prompt.attempt2.hop1.md" }));
setNode({ state: "pending", visits: 0, attempt: 2 }, "running", ["make"]);
const gap = (await get(`${base}/transcript?prompt=prompt.attempt2.hop1.md&after=${encodeURIComponent(h1t.body.next)}`))!;
ok(gap.body.live === true && gap.body.newest === "prompt.attempt2.hop1.md", "in the gap between one attempt's end and the next attempt's prompt, the round is still live", JSON.stringify({ live: gap.body.live }));
// the next attempt starts
writeFileSync(join(fx.retried, "prompt.attempt3.md"), "---\nrun: \"R-4\"\nattempt: 3\nhop: 0\n---\nattempt 3 prompt\n");
appendFileSync(join(fx.retried, "stream.jsonl"), JSON.stringify({ ts: "2026-10-14T04:03:00Z", type: "status", status: "started", prompt: "prompt.attempt3.md" }) + "\n" + JSON.stringify({ ts: "2026-10-14T04:03:01Z", type: "message", text: "a3 says" }) + "\n");
setNode({ state: "running", visits: 1, attempt: 2 });
const follow = (await get(`${base}/transcript?prompt=prompt.attempt2.hop1.md&after=${encodeURIComponent(gap.body.next)}`))!;
ok(follow.body.newest === "prompt.attempt3.md" && follow.body.entries.length === 0 && follow.body.live === true, "a poll of an older invocation names the newer one to follow", JSON.stringify(follow.body));
const a3t = (await get(`${base}/transcript?prompt=prompt.attempt3.md`))!;
ok(JSON.stringify(texts(a3t)) === '["a3 says"]', "the new attempt's transcript starts at its own start", JSON.stringify(texts(a3t)));
appendFileSync(join(fx.retried, "stream.jsonl"), JSON.stringify({ ts: "2026-10-14T04:03:02Z", type: "message", text: "a3 more" }) + "\n");
const a3more = (await get(`${base}/transcript?prompt=prompt.attempt3.md&after=${encodeURIComponent(a3t.body.next)}`))!;
ok(JSON.stringify(texts(a3more)) === '["a3 more"]', "a poll returns only what was appended after its cursor", JSON.stringify(texts(a3more)));
// the node moves on (a later visit) or ends: this round is no longer live
setNode({ state: "running", visits: 2, attempt: 0 });
ok((await get(`${base}/transcript?prompt=prompt.attempt3.md`))!.body.live === false, "a round whose node has moved to a later visit is not live");
setNode({ state: "passed", visits: 1, attempt: 0 }, "succeeded");
ok((await get(`${base}/transcript?prompt=prompt.attempt3.md`))!.body.live === false, "a round whose node or run ended is not live");

// ---------- a long shared stream is read incrementally, from a byte cursor, with a cap ----------
{
  const big = join(fx.data, "runs", "R-6", "nodes", "make", "1"); mkdirSync(big, { recursive: true });
  writeFileSync(join(big, "prompt.md"), "---\nrun: \"R-6\"\n---\nbig\n");
  // each message differs (a number in front): identical adjacent messages are shown once (transcripts.ts collapseTexts)
  const line = (i: number) => JSON.stringify({ ts: "2026-10-14T06:00:00Z", type: "message", text: `${String(i).padStart(6, "0")} ${"é".repeat(5000)}` }) + "\n";
  const n = Math.ceil((17 << 20) / Buffer.byteLength(line(0)));
  writeFileSync(join(big, "stream.jsonl"), Array.from({ length: n }, (_, i) => line(i)).join(""));
  const bytes = statSync(join(big, "stream.jsonl")).size;
  const r1 = (await get(`/api/node-runs/R-6/make/1/transcript?prompt=prompt.md`))!;
  const off1 = Number(String(r1.body.next).split("|")[0]);
  ok(r1.body.size === bytes && off1 > 0 && off1 <= 16 << 20 && r1.body.entries.length < n, "a long stream is read in capped slices, and its size is in bytes", JSON.stringify({ size: r1.body.size, bytes, off1, got: r1.body.entries.length, n }));
  const r2 = (await get(`/api/node-runs/R-6/make/1/transcript?prompt=prompt.md&after=${encodeURIComponent(r1.body.next)}`))!;
  ok(r1.body.entries.length + r2.body.entries.length === n && Number(String(r2.body.next).split("|")[0]) === bytes, "the next poll continues from the cursor to the end", JSON.stringify({ a: r1.body.entries.length, b: r2.body.entries.length, n }));
}

// ---------- the phone gets the invocation list and which one is shown ----------
{
  const ph = createTranscripts({ stateDir: fx.state, dataDir: fx.data, sessionFile: () => null });
  const u = new URL(`http://x${base}`); const r = await (await ph.handle(new Request(u), u, { kind: "phone" }, false))!.json();
  ok(r.phone === true && !r.prompt && r.promptName === "prompt.attempt3.md" && r.invocations?.length === 4, "the phone's node view names the invocation it shows", JSON.stringify({ promptName: r.promptName, n: r.invocations?.length }));
}
console.log(`\ntranscripts-attempts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
