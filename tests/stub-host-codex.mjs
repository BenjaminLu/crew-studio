// A stand-in for `codex app-server` (JSON-RPC over stdio) in tests: no model is
// called. Its answers have the shapes of the installed codex's protocol
// (tests/fixture/codex-app-server/protocol.json), and it checks every message it
// receives and sends against that protocol: a client request the vendor would
// refuse gets an "invalid request" error, and every problem is logged.
//   thread/list      one thread for the cwd ("th-stub-1"), or STUB_CODEX_THREADS (a JSON list of {id, preview, model, effort, updatedAt, path})
//   thread/fork      a new thread with forkedFromId (STUB_CODEX_NO_FORK=1: refused as an unknown method, as a codex without it would)
//   thread/start     a new thread;  thread/turns/list  two read-only turns of the asked thread
//   thread/resume    the thread (an id starting with "fork-" comes back as "<id>-new")
//   turn/start       streams an echo; STUB_TOOL asks for a command approval and waits; STUB_SLOW streams until turn/interrupt
//   STUB_CODEX_LOG   a file: how it was started (cwd, FM_IN_ROUND), every message in and out, and every protocol problem, one JSON line each
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { check, isMethod } from "./codex-protocol.mjs";

if (process.env.STUB_CODEX_EXIT_DELAY) process.on("SIGTERM", () => setTimeout(() => process.exit(0), Number(process.env.STUB_CODEX_EXIT_DELAY)));
const LOG = process.env.STUB_CODEX_LOG;
const log = (o) => { if (LOG) try { appendFileSync(LOG, JSON.stringify(o) + "\n"); } catch {} };
log({ dir: "start", cwd: process.cwd(), FM_IN_ROUND: process.env.FM_IN_ROUND ?? null }); // what the app-server was started with
const answered = new Map(); // a client request id -> its method, to check our result against it
const out = (o) => {
  const problems = o.method ? check(o.method, "params", o.params ?? {}) : o.result !== undefined && answered.has(o.id) ? check(answered.get(o.id), "result", o.result) : [];
  for (const p of problems) log({ dir: "problem", side: "stub", problem: p });
  log({ dir: "out", msg: o });
  process.stdout.write(JSON.stringify(o) + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const uuid = () => crypto.randomUUID();
let srv = 1000, thread = null, interrupted = false, previousTurn = null;
const pending = new Map(); // our own requests to the client: id -> { method, r }
const request = (method, params) => new Promise((r) => { const id = ++srv; pending.set(id, { method, r }); out({ jsonrpc: "2.0", id, method, params }); });

const MODEL = process.env.STUB_CODEX_MODEL ?? "stub-gpt", EFFORT = process.env.STUB_CODEX_EFFORT ?? "medium";
const threads = new Map();
const mkThread = (o) => ({ id: o.id, sessionId: o.sessionId ?? o.id, forkedFromId: o.forkedFromId ?? null, parentThreadId: null, preview: o.preview ?? "", ephemeral: false,
  section: null, sectionEnteredAt: null, projectId: null, historyMode: "paginated", modelProvider: "openai", model: o.model ?? MODEL, reasoningEffort: o.effort ?? EFFORT,
  createdAt: o.createdAt ?? now() - 3600, updatedAt: o.updatedAt ?? now(), recencyAt: null, status: { type: o.loaded ? "idle" : "notLoaded" },
  path: o.path ?? null, cwd: o.cwd ?? process.cwd(), cliVersion: "0.162.1", originator: null, source: o.source ?? "cli", threadSource: null,
  agentNickname: null, agentRole: null, gitInfo: null, name: o.name ?? null, turns: [] });
for (const r of process.env.STUB_CODEX_THREADS ? JSON.parse(process.env.STUB_CODEX_THREADS) : [{ id: "th-stub-1", preview: "Stub codex thread", updatedAt: now() - 600 }])
  threads.set(r.id, mkThread({ ...r, cwd: r.cwd ?? process.cwd() }));
const opened = (t) => ({ thread: { ...t, status: { type: "idle" } }, model: t.model ?? MODEL, modelProvider: "openai", serviceTier: null, disabledPluginIds: [], cwd: t.cwd,
  instructionSources: [], approvalPolicy: "on-request", approvalsReviewer: "user",
  sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }, reasoningEffort: t.reasoningEffort ?? EFFORT });
const turnObj = (id, status, items = []) => ({ id, rootTurnId: id, items, itemsView: "summary", status, error: null, startedAt: now(), completedAt: status === "inProgress" ? null : now(), durationMs: null });

async function runTurn(turnId, text) {
  const note = (method, params) => out({ jsonrpc: "2.0", method, params: { threadId: thread, ...params } });
  note("turn/started", { turn: turnObj(turnId, "inProgress") });
  let say = `echo: ${text.slice(0, 80)}`;
  if (text.includes("STUB_FOREIGN_DYNAMIC")) {
    await request("item/tool/call", { threadId: "foreign-thread", turnId, callId: "foreign-call", tool: "exec", namespace: "functions", arguments: {} });
  }
  if (text.includes("STUB_LATE_FAILURE") && previousTurn) note("item/completed", { turnId: previousTurn, item: { type: "functionCallOutput", id: "late-error", name: "exec", namespace: null, output: "timed out negotiating with the code-mode host" }, completedAtMs: Date.now() });
  if (text.includes("STUB_DYNAMIC")) {
    const response = await request("item/tool/call", { threadId: thread, turnId, callId: "unsupported-1", tool: "exec", namespace: "functions", arguments: { code: "never execute this input" } });
    say = response.result?.success === false ? "Dynamic tool declined." : "Dynamic tool response malformed.";
  }
  if (text.includes("STUB_CODEHOST_FAILURE")) note("item/completed", { turnId, item: { type: "functionCallOutput", id: "exec-error", name: "exec", namespace: null, output: "timed out negotiating with the code-mode host" }, completedAtMs: Date.now() });
  if (text.includes("STUB_TOOL")) {
    const item = { id: "cmd1", type: "commandExecution", command: "ls -la", commandActions: [], cwd: process.cwd(), status: "inProgress" };
    note("item/started", { turnId, item, startedAtMs: Date.now() });
    const r = await request("item/commandExecution/requestApproval", { kind: "command", threadId: process.env.STUB_CODEX_WRONG_APPROVAL === "1" ? "unrelated-thread" : thread, turnId, itemId: "cmd1", startedAtMs: Date.now(), approvalId: "ap1", environmentId: null, command: "ls -la", cwd: process.cwd() });
    const okd = r.result?.decision === "accept";
    note("item/completed", { turnId, item: { ...item, status: okd ? "completed" : "declined" }, completedAtMs: Date.now() });
    say = okd ? "Ran ls." : "Not allowed.";
  }
  if (text.includes("STUB_SLOW")) {
    interrupted = false;
    for (let i = 0; i < 300 && !interrupted; i++) { note("item/agentMessage/delta", { turnId, itemId: "m1", delta: "." }); await sleep(50); }
    return note("turn/completed", { turn: turnObj(turnId, interrupted ? "interrupted" : "completed") });
  }
  for (const part of say.match(/.{1,10}/gs)) { note("item/agentMessage/delta", { turnId, itemId: "m1", delta: part }); await sleep(5); }
  note("item/completed", { turnId, item: { id: "m1", type: "agentMessage", text: say }, completedAtMs: Date.now() });
  note("turn/completed", { turn: turnObj(turnId, "completed") });
  previousTurn = turnId;
  if (text.includes("STUB_EXTERNAL_SUCCESS")) setTimeout(() => {
    const external = uuid(); note("turn/started", { turn: turnObj(external, "inProgress") });
    note("item/completed", { turnId: external, item: { id: "external-message", type: "agentMessage", text: "External turn succeeded." }, completedAtMs: Date.now() });
    note("turn/completed", { turn: turnObj(external, "completed") }); previousTurn = external;
  }, 20);
}

const ANSWERS = new Set(["initialize", "thread/list", "thread/fork", "thread/start", "thread/resume", "thread/turns/list", "turn/start", "turn/interrupt"]);
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  log({ dir: "in", msg: m });
  if (m.id !== undefined && !m.method) {
    const w = pending.get(m.id); pending.delete(m.id);
    if (w && m.result !== undefined) for (const p of check(w.method, "result", m.result)) log({ dir: "problem", side: "client", problem: p });
    w?.r(m); return;
  }
  if (m.id === undefined) return; // a notification: "initialized"
  const reply = (result) => { answered.set(m.id, m.method); out({ jsonrpc: "2.0", id: m.id, result }); };
  const error = (code, message) => out({ jsonrpc: "2.0", id: m.id, error: { code, message } });
  if (!isMethod(m.method) || (m.method === "thread/fork" && process.env.STUB_CODEX_NO_FORK === "1")) return error(-32601, `method not found: ${m.method}`);
  const problems = ANSWERS.has(m.method) ? check(m.method, "params", m.params ?? {}) : [`${m.method}: not answered by this stub`];
  if (problems.length) { for (const p of problems) log({ dir: "problem", side: "client", problem: p }); return error(-32600, `Invalid request: ${problems[0]}`); }
  const p = m.params;
  switch (m.method) {
    case "initialize": if (process.env.STUB_CODEX_INIT_DELAY) return setTimeout(() => reply({ userAgent: "stub-codex/0.162.1", codexHome: "/nonexistent/codex-home", platformFamily: "unix", platformOs: "macos" }), Number(process.env.STUB_CODEX_INIT_DELAY)); return reply({ userAgent: "stub-codex/0.162.1", codexHome: "/nonexistent/codex-home", platformFamily: "unix", platformOs: "macos" });
    case "thread/list": { const cwd = Array.isArray(p.cwd) ? p.cwd : p.cwd ? [p.cwd] : null;
      if (!process.env.STUB_CODEX_THREADS && cwd) threads.get("th-stub-1").cwd = cwd[0]; // the default thread lives in the asked folder
      return reply({ data: [...threads.values()].filter((t) => !cwd || cwd.includes(t.cwd)).sort((a, b) => b.updatedAt - a.updatedAt), nextCursor: null, backwardsCursor: null }); }
    case "thread/fork": { const src = threads.get(p.threadId); if (!src) return error(-32600, `thread not found: ${p.threadId}`);
      const t = mkThread({ id: process.env.STUB_CODEX_SAME_FORK === "1" ? src.id : uuid(), forkedFromId: src.id, preview: src.preview, cwd: p.cwd ?? src.cwd, model: src.model, effort: src.reasoningEffort, source: "appServer", loaded: true });
      threads.set(t.id, t); thread = t.id; return reply(opened(t)); }
    case "thread/start": { const t = mkThread({ id: uuid(), cwd: p.cwd ?? process.cwd(), source: "appServer", loaded: true }); threads.set(t.id, t); thread = t.id; return reply(opened(t)); }
    case "thread/resume": { const id = String(p.threadId); thread = id.startsWith("fork-") ? `${id}-new` : id;
      const t = threads.get(thread) ?? mkThread({ id: thread }); threads.set(thread, t); return reply(opened(t)); }
    case "thread/turns/list": return reply({ data: [
      turnObj(uuid(), "completed", [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "Watch T-310 until CI is green", text_elements: [] }] }, { type: "agentMessage", id: "a1", text: "T-310 is green; merge card D-310 raised." }]),
      turnObj(uuid(), "completed", [{ type: "userMessage", id: "u0", content: [{ type: "text", text: "firstmate: run the crew", text_elements: [] }] }, { type: "agentMessage", id: "a0", text: "Crew running: T-310 worker round 2." }]),
    ], nextCursor: null, backwardsCursor: null });
    case "turn/start": { const tid = uuid(); reply({ turn: turnObj(tid, "inProgress") }); runTurn(tid, p.input?.[0]?.text ?? ""); return; }
    case "turn/interrupt": interrupted = true; return reply({});
  }
});
