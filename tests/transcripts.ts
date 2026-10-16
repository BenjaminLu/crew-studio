import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Transcripts: what every agent was asked (prompt and bound brief), what it did
// (transcript) and what it reported, for firstmate's crew rounds, the main
// session and Studio's own agent nodes. Redaction, phones, paging, path safety.
// Everything runs on a temp fixture; nothing real is read.   bun tests/transcripts.ts
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFixture, TOKEN, BEARER, KEYED } from "./transcripts-fixture.mjs";

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const TMP = mkdtempSync(join(tmpdir(), "crew-transcripts-"));
const fx = buildFixture(TMP);
const mod: any = await import("../src/transcripts").catch((e) => { console.log(`  FAIL  src/transcripts loads: ${e?.message ?? e}`); fail++; return null; });
if (!mod) { console.log(`\ntranscripts: ${pass} passed, ${fail} failed`); process.exit(1); }

const tr = mod.createTranscripts({ stateDir: fx.state, dataDir: fx.data, sessionFile: () => fx.session });
const desk = { kind: "desktop" }, phone = { kind: "phone", device: { id: "d1", name: "Pixel" } };
const get = async (path: string, who: any = desk) => { const u = new URL(`http://x${path}`); const r = await tr.handle(new Request(u), u, who, false); return r ? { status: r.status, body: await r.json() } : null; };
const post = async (path: string, body: unknown, who: any = desk) => { const u = new URL(`http://x${path}`); const r = await tr.handle(new Request(u, { method: "POST", body: JSON.stringify(body) }), u, who, true); return r ? { status: r.status, body: await r.json() } : null; };
const snapshot = () => { const out: Record<string, number> = {}; const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (p !== fx.cliLog && !p.includes("claude-zzz")) out[p] = statSync(p).mtimeMs + statSync(p).size; } }; walk(fx.state); return out; };
const before = JSON.stringify(snapshot());

// ---------- the prompt ----------
const inv = (await get(`/api/crew/${fx.actor}/invocation`))!;
ok(inv.status === 200 && inv.body.prompt.raw === fx.promptClean, "the invocation returns prompt.md byte for byte", JSON.stringify(inv.body.prompt?.raw?.slice(0, 80)));
const labels = (inv.body.prompt.sections ?? []).map((s: any) => s.kind);
ok(["dispatch", "skill", "spec", "task", "brief", "context"].every((k) => labels.includes(k)) && inv.body.prompt.sections.map((s: any) => s.text).join("") === inv.body.prompt.raw,
  "the prompt splits into labelled sections", JSON.stringify(labels));
const brief = inv.body.prompt.sections.find((s: any) => s.kind === "brief");
ok(brief?.binding?.round === 2 && brief.binding.head === fx.head && /00000001-brief\.json$/.test(brief.binding.record), "the brief section names its evidence record, round and head", JSON.stringify(brief?.binding));
ok(brief?.binding?.file === "briefs/T-900-fix1.md", "the brief section names its brief file", JSON.stringify(brief?.binding));
const leak = (await get(`/api/crew/${fx.leak}/invocation`))!;
ok(leak.status === 200 && !JSON.stringify(leak.body).includes(TOKEN) && leak.body.prompt.raw.includes("[credential removed]"), "a planted token is redacted in the prompt", leak.body.prompt?.raw);
ok(!JSON.stringify(leak.body).includes(BEARER), "an Authorization header is redacted");
ok(mod.redact(`commit ${fx.head} sha256 ${"ab".repeat(32)}`) === `commit ${fx.head} sha256 ${"ab".repeat(32)}`, "the redactor keeps ordinary hashes");
ok(inv.body.identity?.task === "T-900" && inv.body.attempt === "claude-aaa" && inv.body.report === true, "the invocation names the round, its attempt and whether it reported");

// ---------- the transcript ----------
const t1 = (await get(`/api/crew/${fx.actor}/transcript`))!;
const kinds = t1.body.entries.map((e: any) => e.kind);
const call = t1.body.entries.find((e: any) => e.kind === "tool");
const res = t1.body.entries.find((e: any) => e.kind === "toolResult");
ok(kinds.includes("text") && call?.name === "Bash" && call.args?.command === "ls bin/lib" && res && res.toolId === call.id && t1.body.entries.some((e: any) => e.t && /^2026-/.test(e.t)) && kinds.includes("result"),
  "the transcript has text, tool calls with arguments, results and timestamps", JSON.stringify(kinds));
const big = t1.body.entries.find((e: any) => e.kind === "toolResult" && e.size > 50_000);
ok(big && big.body.length <= 50_000 && big.truncated === true && big.size === fx.bigSize, "a large tool result is cut with its full size", JSON.stringify({ size: big?.size, len: big?.body?.length }));
const lt = (await get(`/api/crew/${fx.leak}/transcript`))!;
ok(lt.body.entries.length === 3 && !JSON.stringify(lt.body).includes(TOKEN), "a planted token is redacted in the transcript", JSON.stringify(lt.body).slice(0, 300));
appendFileSync(fx.cliLog, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "a new line after the offset" }] } }) + "\n");
const t2 = (await get(`/api/crew/${fx.actor}/transcript?after=${t1.body.next}`))!;
ok(t2.body.entries.length === 1 && t2.body.entries[0].text === "a new line after the offset" && t2.body.next > t1.body.next, "reading after an offset returns only the new entries", JSON.stringify(t2.body.entries));

// ---------- every route that carries a round's text passes the one redactor ----------
{
  const { createTakeover } = await import("../src/takeover");
  const { FmState } = await import("../src/fm");
  const fm = new FmState(fx.state);
  const tk = createTakeover({ main: { view: () => ({}), handoffs: () => [], driver: () => ({}) } as any, fm, gh: { state: { prs: [] }, merged: [] } as any, board: {} as any, stateDir: fx.state, pending: () => [], tasks: () => [], crew: () => [] });
  const viaTk = async (path: string) => { const u = new URL(`http://x${path}`); const r = await tk.handle(new Request(u), u, desk as any, false); return r ? { status: r.status, body: await r.json() } : null; };
  const leaks = (b: unknown) => { const t = String(JSON.stringify(b)); return [TOKEN, BEARER, ...KEYED].filter((x) => t.includes(x)); };
  const routes: [string, () => Promise<any>][] = [
    ["crew invocation (prompt)", () => get(`/api/crew/${fx.leak}/invocation`)],
    ["crew transcript", () => get(`/api/crew/${fx.leak}/transcript`)],
    ["crew report", () => get(`/api/crew/${fx.leak}/report`)],
    ["crew report (takeover route)", () => viaTk(`/api/crew/report/${fx.leak}`)],
    ["firstmate history", () => get(`/api/firstmate/history`)],
    ["node run (prompt, header, system, report)", () => get(`/api/node-runs/R-2/build/1`)],
    ["node run transcript", () => get(`/api/node-runs/R-2/build/1/transcript`)],
    ["phone: crew invocation summary", () => get(`/api/crew/${fx.leak}/invocation`, phone)],
    ["phone: node run summary", () => get(`/api/node-runs/R-2/build/1`, phone)],
  ];
  for (const [name, f] of routes) { const r = await f(); ok(r && r.status === 200 && leaks(r.body).length === 0 && (name.startsWith("phone") || JSON.stringify(r.body).includes("[credential removed]")), `no secret leaves the server: ${name}`, String(JSON.stringify(r?.body)).slice(0, 160) + " leaks " + JSON.stringify(leaks(r?.body))); }
  const keyed = mod.parseLines([JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "k", name: "X", input: { password: KEYED[0], env: { GITHUB_TOKEN: KEYED[1] }, headers: { Authorization: KEYED[3] } } }] } })]);
  ok(leaks(keyed).length === 0, "a secret named by its key in tool arguments is redacted", JSON.stringify(keyed));
  const sec: any = await import("../src/secure");
  ok(typeof sec.redactText === "function" && typeof sec.redactJSON === "function" && typeof sec.isCredentialName === "function" && sec.SECRET_KEY === undefined && Array.isArray(sec.SECRET_VALUE),
    "redaction lives in the one secret registry (src/secure.ts)");
  process.env.CREW_TEST_SESSION_SECRET = "studio-own-" + "secret-value-1234";
  ok(sec.redactText?.(`it is ${process.env.CREW_TEST_SESSION_SECRET} here`) === "it is [credential removed] here", "Studio's own secret values are redacted wherever they appear");
  delete process.env.CREW_TEST_SESSION_SECRET;
}

// ---------- the live cursor belongs to one attempt ----------
{
  const first = (await get(`/api/crew/${fx.leak}/transcript`))!;
  const newer = join(fx.lrun, "claude-zzz"); mkdirSync(newer, { recursive: true });
  writeFileSync(join(newer, "cli.log"), [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "retry: first line" }] } }), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(first.body.next + 50) }] } })].join("\n") + "\n");
  const t = Date.now() / 1000 + 10; (await import("node:fs")).utimesSync(join(newer, "cli.log"), t, t);
  const after = (await get(`/api/crew/${fx.leak}/transcript?after=${first.body.next}&attempt=${first.body.attempt}`))!;
  ok(after.body.attempt === "claude-zzz" && after.body.reset === true && after.body.entries[0]?.text === "retry: first line", "a new attempt restarts the transcript from its start", JSON.stringify({ attempt: after.body.attempt, reset: after.body.reset, first: after.body.entries[0]?.text?.slice(0, 30) }));
}

// ---------- liveness is a signal, not a default ----------
{
  const ended = (await get(`/api/crew/${fx.leak}/transcript`))!;
  const node2 = (await get(`/api/node-runs/R-3/build/1/transcript`).catch(() => null));
  const n3 = (await get(`/api/node-runs/R-3/check/1/transcript`))!;
  const n1 = (await get(`/api/node-runs/R-1/build/1/transcript`))!;
  ok(ended.body.live === false && n3.body.live === false && n1.body.live === false, "a round that ended says so: a dead crew round, a node round in a terminal state without report.json", JSON.stringify({ crew: ended.body.live, n3: n3.body.live, n1: n1.body.live }));
  void node2;
}

// ---------- phones ----------
const pinv = (await get(`/api/crew/${fx.actor}/invocation`, phone))!;
ok(pinv.status === 200 && !pinv.body.prompt?.raw && !JSON.stringify(pinv.body).includes("Approved local brief") && pinv.body.summary?.bytes > 0 && pinv.body.summary?.sections?.length > 0, "a phone gets a summary, never the raw prompt", JSON.stringify(pinv.body).slice(0, 200));
const ptr = (await get(`/api/crew/${fx.actor}/transcript`, phone))!;
ok(!ptr.body.entries?.length && ptr.body.summary?.entries > 0, "a phone gets no transcript entries");
const phist = (await get(`/api/firstmate/history`, phone))!;
ok(!phist.body.entries?.length && typeof phist.body.summary === "object", "a phone gets no firstmate history");
ok((await post("/api/transcripts/settings", { phoneRaw: true }, phone))!.status === 403, "the phone setting is desktop-only");
ok((await post("/api/transcripts/settings", { phoneRaw: true }))!.status === 200 && (await get(`/api/crew/${fx.actor}/invocation`, phone))!.body.prompt?.raw === fx.promptClean, "with the setting on, a phone may read the prompt");
await post("/api/transcripts/settings", { phoneRaw: false });

// ---------- the firstmate session ----------
const h1 = (await get(`/api/firstmate/history`))!;
ok(h1.status === 200 && h1.body.entries.length >= 40 && h1.body.entries.some((e: any) => e.text === "turn 99") && h1.body.cursor > 0 && h1.body.atStart === false, "the firstmate history pages backwards", JSON.stringify({ n: h1.body.entries.length, last: h1.body.entries.at(-1)?.text }));
const all: any[] = [...h1.body.entries];
let cur = h1.body.cursor, pages = 0;
while (cur > 0 && pages++ < 20) { const h = (await get(`/api/firstmate/history?before=${cur}`))!; all.unshift(...h.body.entries); cur = h.body.atStart ? 0 : h.body.cursor; }
const turns = all.filter((e) => e.role === "captain").map((e) => e.text);
ok(turns.length === 50 && turns[0] === "turn 0" && turns.at(-1) === "turn 98" && new Set(turns).size === 50, "older pages join without gaps or repeats", JSON.stringify(turns.slice(0, 3)));

// ---------- Studio's own agent nodes ----------
const nl = (await get(`/api/node-runs`))!;
const r1 = nl.body.find((n: any) => n.run === "R-1");
ok(nl.body.length === 6 && r1 && r1.node === "build" && r1.round === "1" && r1.prompt && r1.stream && r1.report, "node runs are listed from data/runs/<run>/nodes/<node>/<round>", JSON.stringify(nl.body));
const nr = (await get(`/api/node-runs/R-1/build/1?prompt=prompt.md`))!;
const ns = (await get(`/api/node-runs/R-1/build/1/transcript?prompt=prompt.md`))!;
const nk = ns.body.entries.map((e: any) => e.kind);
ok(nr.body.prompt.raw === fx.nodePrompt && nr.body.report?.said === "node report" && nr.body.report?.status === "done" && nr.body.system === "You are the builder.\n"
  && ns.body.entries.some((e: any) => e.kind === "text" && e.text === "node says hi") && nk.includes("tool") && nk.includes("toolResult") && ns.body.entries.every((e: any) => e.t),
  "a node run returns its prompt, stream and report", JSON.stringify({ nk, rep: nr.body.report }).slice(0, 300));
ok(nr.body.prompt.header?.round === 1 && nr.body.prompt.header?.head === fx.nodeHead && nr.body.prompt.header?.brief === "build@1#3" && JSON.stringify(nr.body.prompt.header?.ledger) === "[3,4]"
  && nr.body.prompt.body === fx.nodeBody, "a node run's prompt header names its round, head, brief and ledger; the body is the exact bytes sent", JSON.stringify(nr.body.prompt.header));
const hop = (await get(`/api/node-runs/R-1/build/1?prompt=prompt.hop2.md`))!;
ok(JSON.stringify(nr.body.prompts) === '["prompt.md","prompt.hop2.md"]' && hop.body.prompt.body === "hand-off prompt\n" && (await get(`/api/node-runs/R-1/build/1?prompt=..%2Fx.md`))!.status === 400,
  "a hand-off's prompt.hop<n>.md is listed and readable, nothing else", JSON.stringify(nr.body.prompts));
const empty = createEmpty();
const er = await empty.handle(new Request("http://x/api/node-runs"), new URL("http://x/api/node-runs"), desk, false);
const missing = await get(`/api/node-runs/R-1/build/7`);
ok(er && JSON.stringify(await er.json()) === "[]" && missing!.status === 404, "a missing node run folder is an empty list");

// ---------- safety ----------
const bad = await Promise.all(["/api/crew/..%2Fx/invocation", "/api/crew/a.b/transcript", "/api/node-runs/..%2F..%2Fetc/x/1", "/api/node-runs/R-1/build/..%2F1"].map((p) => get(p)));
ok(bad.every((r) => !r || r.status === 404 || r.status === 400), "a path outside the runs is refused", JSON.stringify(bad.map((r) => r?.status)));
ok(JSON.stringify(snapshot()) === before, "nothing under the firstmate state is written");

function createEmpty() { const d = join(TMP, "empty-data"); mkdirSync(d, { recursive: true }); return mod.createTranscripts({ stateDir: fx.state, dataDir: d, sessionFile: () => null }); }
void readFileSync; void writeFileSync;
console.log(`\ntranscripts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
