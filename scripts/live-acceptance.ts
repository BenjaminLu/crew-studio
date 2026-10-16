// Live acceptance: drives a RUNNING Studio over its real HTTP API, the way the captain does on the board,
// and writes an honest report of what happened. See docs/live-acceptance.md.
//
//   bun scripts/live-acceptance.ts --workflow <id> [--workflow <id> ...] [--all]
//        [--base http://127.0.0.1:4210] [--topic "..."] [--params params.json]
//        [--max-minutes N] [--max-rounds N] [--scenario file.yaml] [--scenarios dir]
//
// Authentication: the registered instance record plus its session, found exactly as
// `bun src/main.ts open` finds them (src/instance.ts). The session is sent only as the
// x-crew-session header and is never printed or written. Login state is only read
// (GET /api/doctor); this script never starts a sign-in.
//
// Exit codes: 0 PASS, 1 FAIL, 2 STOP, 3 BUDGET, 4 setup error (no Studio, bad scenario, bad arguments).
// --offline-fixture is for the offline test only: it lets the stub provider stand in and stamps the
// report OFFLINE FIXTURE, which never counts as a live acceptance.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverInstance } from "../src/instance";
import { decideCard, defHash, loadScenario, openWindowIds, scenarioFiles, SCENARIO_DIR, type Scenario } from "./acceptance/scenarios";
import { modelCalls, modelProblems, nodeRecords, providersToCheck, REAL } from "./acceptance/report";
import { redactJSON, redactText } from "../src/secure";

const REPO = resolve(import.meta.dir, "..");
const EXIT = { PASS: 0, FAIL: 1, STOP: 2, BUDGET: 3, ERROR: 4 } as const;
type Verdict = keyof typeof EXIT;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

// ---------- arguments ----------
type Args = { workflows: string[]; all: boolean; base: string; topic: string | null; params: string | null; maxMinutes: number | null; maxRounds: number | null; scenario: string | null; scenarios: string; offline: boolean };
function parseArgs(argv: string[]): Args {
  const a: Args = { workflows: [], all: false, base: "http://127.0.0.1:4210", topic: null, params: null, maxMinutes: null, maxRounds: null, scenario: null, scenarios: SCENARIO_DIR, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === "--workflow") a.workflows.push(v());
    else if (k === "--all") a.all = true;
    else if (k === "--base") a.base = v();
    else if (k === "--topic") a.topic = v();
    else if (k === "--params") a.params = v();
    else if (k === "--max-minutes") a.maxMinutes = Number(v());
    else if (k === "--max-rounds") a.maxRounds = Number(v());
    else if (k === "--scenario") a.scenario = v();
    else if (k === "--scenarios") a.scenarios = v();
    else if (k === "--offline-fixture") a.offline = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.all && !a.workflows.length && !a.scenario) throw new Error("say which workflow: --workflow <id>, --all, or --scenario <file>");
  if (a.maxMinutes !== null && !(a.maxMinutes > 0)) throw new Error("--max-minutes must be a positive number");
  if (a.maxRounds !== null && !(Number.isInteger(a.maxRounds) && a.maxRounds > 0)) throw new Error("--max-rounds must be a positive whole number");
  const u = new URL(a.base); if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port) throw new Error("--base must be http://127.0.0.1:<port> (Studio listens only there)");
  a.base = u.origin;
  return a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------- the Studio client: the session stays in one header ----------
class Studio {
  #session: string;
  constructor(readonly base: string, session: string, readonly data: string) { this.#session = session; }
  /** every text this script prints or writes passes here, so the session never leaves even by accident */
  scrub(s: string) { return redactText(this.#session ? String(s).split(this.#session).join("[session]") : String(s)); }
  async get(path: string) { const r = await fetch(this.base + path, { headers: { "x-crew-session": this.#session }, signal: AbortSignal.timeout(60_000) }); const t = await r.text(); let body: any = null; try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body }; }
  async post(path: string, payload: unknown) { const r = await fetch(this.base + path, { method: "POST", headers: { "x-crew-session": this.#session, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) }); const t = await r.text(); let body: any = null; try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body }; }
  /** the server's event stream (/api/stream): calls onEvent for each event, reconnecting until stopped */
  follow(onEvent: (type: string, data: any) => void) {
    const ctl = new AbortController(); const stats = { events: 0, reconnects: 0 }; const dec = new TextDecoder();
    (async () => {
      while (!ctl.signal.aborted) {
        try {
          const r = await fetch(this.base + "/api/stream", { headers: { "x-crew-session": this.#session, accept: "text/event-stream" }, signal: ctl.signal });
          const reader = r.body!.getReader(); let buf = "";
          for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
            let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
              const type = /^event: (.*)$/m.exec(chunk)?.[1] ?? "message", raw = chunk.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
              let data: any = null; try { data = JSON.parse(raw); } catch {} stats.events++; onEvent(type, data); } }
        } catch {}
        if (!ctl.signal.aborted) { stats.reconnects++; await sleep(1000); }
      }
    })();
    return { stop: () => ctl.abort(), stats };
  }
}

// ---------- one workflow ----------
type CardRecord = { id: string; node: string; kind: string; decision: string; answered: string | null; reason: string | null; at: string };

async function providersReady(st: Studio, s: Scenario, def: any, offline: boolean, extra: { provider: string; why: string }[] = []): Promise<{ checked: { provider: string; state: string; why?: string[] }[]; stop: string | null }> {
  // Which vendor runs a model call is the engine's pick at run time: node provider, then role
  // provider, then the Start form's provider, then Studio's policy (opposite of the host, then a
  // fallback; src/providers/policy.ts). Every vendor that pick can land on must be signed in.
  const judged = new Set<string>(((await st.get("/api/checks")).body?.checks ?? []).filter((c: any) => c.kind === "judged").map((c: any) => c.ref));
  const policy = offline && (await st.get("/api/settings")).body?.provider === "stub" ? ["stub"] : ["claude", "codex"];
  const needs = [...s.providers.map((p) => ({ provider: p, why: "the scenario lists it" })), ...providersToCheck(def, s.start.provider, judged, policy), ...extra];
  const required = new Map<string, string[]>(); for (const n of needs) required.set(n.provider, [...(required.get(n.provider) ?? []), n.why]);
  const checked: { provider: string; state: string }[] = []; const missing: string[] = [];
  let items: any[] | null = null;
  for (const p of required.keys()) {
    if (p === "stub") { if (offline) { checked.push({ provider: p, state: "offline fixture", why: required.get(p) }); continue; } checked.push({ provider: p, state: "not a real model", why: required.get(p) }); missing.push("stub is not a real model; live acceptance needs Claude or Codex"); continue; }
    if (!REAL.has(p)) { checked.push({ provider: p, state: "not a vendor CLI" }); missing.push(`${p} is not a vendor CLI whose login this script can read`); continue; }
    items ??= (await st.get("/api/doctor")).body?.items ?? [];
    const it = items!.find((x: any) => x.id === p);
    const state = !it ? "not reported" : it.authenticated === true ? "signed in" : it.authenticated === false ? "not signed in" : !it.version ? "CLI unavailable" : "login status unverified";
    const name = p === "claude" ? "Claude" : "Codex";
    // what the Doctor reported, verbatim: an unreadable login is treated as not signed in, and says exactly why
    const doctor = it ? `Doctor item ${p}: authenticated=${JSON.stringify(it.authenticated ?? null)}, version=${JSON.stringify(it.version ?? null)}, detail=${JSON.stringify(String(it.detail ?? "").slice(0, 300))}` : `Doctor reported no ${p} item`;
    checked.push({ provider: p, state, why: required.get(p), ...(state !== "signed in" ? { doctor } : {}) });
    if (state === "signed in") continue;
    if (state === "not signed in") missing.push(`${name} is not signed in (${doctor}). Sign in from Studio's Doctor yourself, then run this again; this script never starts a sign-in`);
    else missing.push(`${name} login status could not be read (${state}; ${doctor}); treated as not signed in. Fix the ${p} CLI or sign in from Studio's Doctor, then run this again; this script never starts a sign-in`);
  }
  return { checked, stop: missing.length ? missing.join("; ") : null };
}

async function runOne(st: Studio, s: Scenario, a: Args, date: string) {
  const t0 = Date.now(), startedAt = new Date().toISOString();
  const wallMinutes = a.maxMinutes ?? s.budget.wall_minutes, maxRounds = a.maxRounds ?? s.budget.max_rounds;
  const topic = a.topic ?? s.topic, text = `ACCEPT ${date} ${topic}`;
  const report: any = { schema: 1, verdict: null, offlineFixture: a.offline, workflow: s.workflow, version: null, scenario: s.file ? s.file.replace(REPO + "/", "") : null, base: st.base, date, startedAt, endedAt: null, wallSeconds: null,
    topic, start: null as any, staffing: null, providers: [], task: null, run: null, nodes: [], cards: [] as CardRecord[], stop: null, budget: { wall_minutes: wallMinutes, max_rounds: maxRounds, rounds: 0, exceeded: null, cancelled: false },
    usedProviders: [] as string[], expect: s.expect, pin: { sha256: s.pin.sha256, seen: null as string | null }, error: null as string | null, cancel: null as any, completion: null as string | null, library: [] as any[], problems: [] as string[], sse: { events: 0, reconnects: 0 } };
  const finish = (v: Verdict) => { report.verdict = v; report.endedAt = new Date().toISOString(); report.wallSeconds = Math.round((Date.now() - t0) / 100) / 10; return report; };
  const stopWith = (reason: string, card: string | null = null) => { report.stop = { reason, card }; return finish("STOP"); };
  // what the error path needs to know: a started Task, a request whose reply never came
  const live = { id: null as string | null, starting: false, answering: null as string | null, terminal: false, waiting: null as string | null };
  // a card left for a person is never cancelled under them, on any path: budget, error or otherwise
  const leftFor = () => live.waiting ? `${live.waiting} waits for a person; the Task is left for the captain, not cancelled` : null;

  const steps = async () => {
  const extra: Record<string, string> = a.params ? JSON.parse(readFileSync(a.params, "utf8")) : {};
  const params: Record<string, string> = { ...(s.start.provider ? { provider: s.start.provider } : {}), ...s.start.params, ...extra };
  const body: any = { text, workflow: s.workflow, params };
  report.start = body;
  const wf = await st.get(`/api/wf/${s.workflow}`);
  if (wf.status !== 200 || !wf.body?.def) return stopWith(`workflow ${s.workflow} is not on this Studio (${wf.status})`);
  if (wf.body.selectable === false) return stopWith(`workflow ${s.workflow} is internal or retired: the board cannot start it`);
  report.version = wf.body.def.version; report.pin.seen = defHash(wf.body.def);
  if (report.pin.seen !== s.pin.sha256) return stopWith(`${s.workflow} v${wf.body.def.version} on this Studio has definition sha256 ${report.pin.seen}, not the ${s.pin.sha256} this scenario was reviewed against; re-review the scenario (bun scripts/acceptance/pin.ts ${s.workflow})`);
  const missingParams = (s.start.required_params ?? []).filter((p) => !params[p]);
  if (missingParams.length) return stopWith(`this workflow needs captain input before it can start: ${missingParams.join(", ")}. Pass them with --params <file.json>`);
  const ready = await providersReady(st, s, wf.body.def, a.offline); report.providers = ready.checked;
  if (ready.stop) return stopWith(ready.stop);

  // start the Task exactly as the board's Start form does (public/runtime.js startOwnRun)
  live.starting = true;
  let started = await st.post("/api/wruns", body);
  if (started.status === 409 && started.body?.code === "staffing_confirmation_required") {
    const plan = started.body.staffing;
    if (!s.approvals.staffing) return stopWith(`the Task needs a staffing confirmation (${(plan?.plan ?? []).map((r: any) => `${r.node}: ${r.provider}/${r.model}`).join(", ")}) and this scenario does not allow staffing approvals`);
    // the staffing plan pins the picks: their vendors must be signed in before the captain-approved confirmation is sent
    const staffed = await providersReady(st, s, wf.body.def, a.offline, (plan?.plan ?? []).filter((r: any) => r.provider).map((r: any) => ({ provider: r.provider, why: `staffing plan ${r.node}` })));
    report.providers = staffed.checked; if (staffed.stop) { live.starting = false; return stopWith(staffed.stop); }
    report.staffing = { approved: plan.hash, plan: plan.plan };
    started = await st.post("/api/wruns", { ...body, staffingConfirm: plan.hash });
  }
  live.starting = false;
  if (started.status !== 200 || !started.body?.id) {
    const code = started.body?.code ?? null, err = String(started.body?.error ?? started.body).slice(0, 500);
    if (["staffing_incomplete", "coffee-staffing-required", "staffing_confirmation_required"].includes(code)) return stopWith(`the Task cannot start until the captain confirms staffing: ${err}`);
    report.problems.push(`start refused (${started.status}${code ? ` ${code}` : ""}): ${err}`); return finish("FAIL");
  }
  const id: string = started.body.id; live.id = id;
  report.task = { id, href: `${st.base}/#/run/${id}` };
  console.log(st.scrub(`${s.workflow}: started ${id} (${report.task.href})`));

  // follow it: the event stream wakes the loop; a slow poll covers a dropped stream
  let wake: () => void = () => {}; const woken = () => new Promise<void>((r) => { wake = r; });
  const stream = st.follow((type, d) => { if ((type === "wrun" && d?.id === id) || (type === "scard" && d?.run === id)) wake(); });
  const handled = new Map<string, CardRecord>(); let view: any = null; let stoppedAt: string | null = null;
  try {
    for (;;) {
      const r = await st.get(`/api/tasks/${id}`);
      if (r.status !== 200) throw new Error(`could not read ${id}: HTTP ${r.status} ${String(r.body?.error ?? r.body).slice(0, 200)}`);
      view = r.body; live.terminal = TERMINAL.has(view.status); report.budget.rounds = (view.rounds ?? []).length;
      // a card left for a person: one the driver already left, or one the scenario says to leave
      live.waiting = (view.cards ?? []).find((c: any) => c.status === "open" && (handled.get(c.id)?.decision === "wait" || s.cards.some((r) => r.action === "wait" && r.node === c.node && (!r.kind || r.kind === c.kind))))?.id ?? null;
      if (report.budget.rounds > maxRounds) {
        if (leftFor()) report.stop = { reason: `the round budget (${maxRounds}) ran out while ${leftFor()}`, card: live.waiting };
        else report.budget.exceeded = `rounds: ${report.budget.rounds} > ${maxRounds}`;
        break;
      }
      if (Date.now() - t0 > wallMinutes * 60_000) {
        // a card left for a person is never cancelled under them: the Task stays for the captain
        if (leftFor()) report.stop = { reason: `the wall budget (${wallMinutes} min) ran out while ${leftFor()}`, card: live.waiting };
        else report.budget.exceeded = `wall time: over ${wallMinutes} min`;
        break;
      }
      if (TERMINAL.has(view.status)) break;
      for (const c of (view.cards ?? []).filter((c: any) => c.status === "open")) {
        if (handled.has(c.id)) continue; // answered or left for a person: never answered twice
        if (s.expect.stop_at && c.node === s.expect.stop_at) { stoppedAt = c.node; handled.set(c.id, { id: c.id, node: c.node, kind: c.kind, decision: "expected stop", answered: null, reason: `reached ${c.node} as expected`, at: new Date().toISOString() }); break; }
        const d = decideCard(s, c, view.def, { openAuthWindows: await openWindows(st, view) });
        if (d.action === "stop") { handled.set(c.id, { id: c.id, node: c.node, kind: c.kind, decision: "stop", answered: null, reason: d.reason, at: new Date().toISOString() }); report.stop = { reason: d.reason, card: c.id }; break; }
        if (d.action === "wait") { handled.set(c.id, { id: c.id, node: c.node, kind: c.kind, decision: "wait", answered: null, reason: "left for a person on the board", at: new Date().toISOString() }); continue; }
        live.answering = c.id;
        const ans = await st.post(`/api/scards/${c.id}/answer`, { choice: d.choice, note: d.note });
        live.answering = null;
        if (ans.status === 200) { handled.set(c.id, { id: c.id, node: c.node, kind: c.kind, decision: "answered", answered: d.choice, reason: null, at: new Date().toISOString() }); console.log(st.scrub(`${s.workflow}: answered ${c.id} (${c.node}) with ${d.choice}`)); continue; }
        const err = String(ans.body?.error ?? ans.body).slice(0, 300);
        if (/still being raised|preparation is still running/.test(err)) continue; // the card is not ready yet: try again on the next pass
        report.stop = { reason: `answering ${c.id} with ${d.choice} was refused: ${err}`, card: c.id }; handled.set(c.id, { id: c.id, node: c.node, kind: c.kind, decision: "refused", answered: null, reason: err, at: new Date().toISOString() }); break;
      }
      if (report.stop || stoppedAt) break;
      const left = wallMinutes * 60_000 - (Date.now() - t0);
      await Promise.race([woken(), sleep(Math.max(50, Math.min(3000, left + 10)))]);
    }
  } finally { stream.stop(); report.sse = { ...stream.stats }; }

  if (report.budget.exceeded && view && !TERMINAL.has(view.status)) {
    report.cancel = await cancelTask(st, id, `live acceptance budget exceeded: ${report.budget.exceeded}`);
    report.budget.cancelled = report.cancel.cancelled;
  }
  const final = await st.get(`/api/tasks/${id}`); if (final.status === 200) view = final.body;
  report.cards = [...handled.values()];
  if (view) {
    report.task = { ...report.task, status: view.status, result: view.result ?? null, rounds: (view.rounds ?? []).length };
    report.run = { status: view.status, result: view.result ?? null, error: view.error ?? null, endedAt: view.endedAt ?? null, outputs: (view.outputs ?? []).map((o: any) => o.href) };
    // the provenance of each delivered artifact version: who made it, for hook nodes that call a model themselves
    const artifacts = new Map<string, any[]>();
    for (const pin of Object.values<any>(view.ctx?.deliver ?? {})) if (pin?.id && !artifacts.has(pin.id)) { const g = await st.get(`/api/artifacts/${encodeURIComponent(pin.id)}`); if (g.status === 200) artifacts.set(pin.id, g.body?.versions ?? []); }
    report.nodes = nodeRecords(st.base, view, artifacts);
    // an ACCEPT Task's approved artifact lands in Studio's own local Library: the report marks it as an acceptance-run item
    const lib = view.ctx?.library; if (lib?.artifact) report.library.push({ artifact: lib.artifact, version: lib.version ?? null, href: lib.href ? `${st.base}/${lib.href}` : null, label: "acceptance run", task: id });
    // what really ran: agent rounds, every node job (loop coordinators), judged-check votes, model hooks' artifacts
    const calls = modelCalls(view, report.nodes);
    report.problems.push(...modelProblems(report.nodes, a.offline, calls));
    report.usedProviders = [...new Set(calls.map((c) => c.call))];
    for (const u of report.usedProviders) if (!report.providers.some((p: any) => p.provider === u.split("/")[0])) report.problems.push(`a round ran on ${u}, whose login was not checked before the start`);
  }
  if (report.stop) return finish("STOP");
  if (report.budget.exceeded) return finish("BUDGET");
  // expectations
  const e = s.expect;
  if (e.stop_at) { if (stoppedAt !== e.stop_at) report.problems.push(`did not reach card ${e.stop_at} (status ${view?.status ?? "unknown"})`); }
  else {
    if (view?.status !== e.status) report.problems.push(`status ${view?.status ?? "unknown"}, expected ${e.status}${view?.error ? `: ${view.error}` : ""}`);
    if (e.result !== undefined && (view?.result ?? null) !== e.result) report.problems.push(`result ${view?.result ?? "none"}, expected ${e.result ?? "none"}`);
  }
  for (const art of e.artifacts) {
    if (art.deliver !== undefined) { const n = Object.keys(view?.ctx?.deliver ?? {}).length; if (n < art.deliver) report.problems.push(`deliver: ${n} delivered artifact(s), expected at least ${art.deliver}`); }
    if (art.outputs !== undefined) { const n = (view?.outputs ?? []).length; if (n < art.outputs) report.problems.push(`outputs: ${n} output(s), expected at least ${art.outputs}`); }
    if (art.file !== undefined) { const f = await st.get(`/api/wruns/${id}/file?path=${encodeURIComponent(art.file)}`); if (f.status !== 200) report.problems.push(`file: ${art.file} is not in the run folder`); }
  }
  if (!report.problems.length) report.completion = e.stop_at ? `reached ${e.stop_at}, stopped by design` : "complete";
  return finish(report.problems.length ? "FAIL" : "PASS");
  };

  try { return await steps(); }
  catch (err: any) {
    // a transport or script error: never leave a started Task running unreported
    const msg = st.scrub(String(err?.message ?? err)).slice(0, 1000);
    report.error = msg; report.problems.push(`error: ${msg}`);
    if (live.starting && !live.id) report.problems.push("the start request got no reply: a Task may have been created anyway; check the board for one with this ACCEPT brief");
    if (live.answering) report.problems.push(`the answer to ${live.answering} got no reply: it may have been applied on the server; check the card on the board`);
    if (live.id && !live.terminal && leftFor()) report.problems.push(leftFor()!);
    else if (live.id && !live.terminal) report.cancel = await cancelTask(st, live.id, `live acceptance stopped on an error: ${msg.slice(0, 200)}`);
    if (live.id) report.task = { ...(report.task ?? { id: live.id, href: `${st.base}/#/run/${live.id}` }) };
    return finish("ERROR");
  }
}

/** The captain's authorization windows open for this run's project: any of them may answer a later card. */
async function openWindows(st: Studio, view: any): Promise<string[]> {
  const r = await st.get("/api/policies/auth-window");
  if (r.status !== 200 || !Array.isArray(r.body?.grants)) throw new Error(`could not read the authorization windows: HTTP ${r.status}`);
  return openWindowIds(r.body.grants, view.ctx?.project ?? view.params?.project ?? null);
}

/** Cancel a Task, retrying for a while: the error that led here may be a Studio restart. */
async function cancelTask(st: Studio, id: string, reason: string, tries = 15) {
  let last = "", attempts = 0;
  for (let i = 0; i < tries; i++) {
    attempts++;
    try {
      const c = await st.post(`/api/wruns/${id}/cancel`, { reason });
      if (c.status === 200) return { cancelled: true, attempts, error: null };
      last = `${c.status} ${st.scrub(String(c.body?.error ?? c.body)).slice(0, 300)}`;
      if (c.status !== 404 && c.status < 500) break; // refused for a reason (already ended): retrying will not help
    } catch (e: any) { last = st.scrub(String(e?.message ?? e)).slice(0, 300); }
    if (i < tries - 1) await sleep(2000);
  }
  return { cancelled: false, attempts, error: last };
}

// ---------- the report ----------
function markdown(r: any): string {
  const L: string[] = [];
  L.push(`# Live acceptance: ${r.workflow} — ${r.verdict}${r.completion && r.completion !== "complete" ? ` (${r.completion}; not complete)` : ""}`, "");
  if (r.offlineFixture) L.push("> OFFLINE FIXTURE run (stub providers). It never counts as a live acceptance.", "");
  L.push(`- Studio: ${r.base}`, `- Scenario: ${r.scenario ?? "inline"}`, `- Workflow version: ${r.version ?? "unknown"}, definition sha256 ${r.pin?.seen ?? "not read"} (scenario pins ${r.pin?.sha256})`, `- Started: ${r.startedAt}  Ended: ${r.endedAt}  Wall: ${r.wallSeconds} s`,
    `- Task: ${r.task ? `[${r.task.id}](${r.task.href}) — ${r.task.status ?? "not read"}${r.task.result ? ` (${r.task.result})` : ""}, ${r.task.rounds ?? 0} rounds` : "none started"}`,
    `- Brief: ${r.start?.text ?? "not sent"}`, `- Start body: \`${JSON.stringify(r.start)}\``,
    `- Used by the run (per round): ${(r.usedProviders ?? []).join(", ") || "no agent round"}`,
    `- Login checked before start: ${r.providers.map((p: any) => `${p.provider} ${p.state}${p.doctor ? ` (${p.doctor})` : ""}`).join(", ") || "none needed"}`,
    `- Completion: ${r.completion ?? "—"}`,
    `- Budget: ${r.budget.rounds}/${r.budget.max_rounds} rounds, ${r.budget.wall_minutes} min${r.budget.exceeded ? ` — EXCEEDED (${r.budget.exceeded})${r.budget.cancelled ? ", Task cancelled" : ""}` : ""}`,
    `- Event stream: ${r.sse.events} events, ${r.sse.reconnects} reconnects`, "");
  if (r.stop) L.push("## STOP", "", r.stop.reason, "", `Card: ${r.stop.card ?? "none"}`, "");
  if (r.error) L.push("## Error", "", "```", r.error, "```", "");
  if (r.cancel) L.push(`Cancel: ${r.cancel.cancelled ? `Task cancelled (attempt ${r.cancel.attempts})` : `NOT cancelled: ${r.cancel.error}`}`, "");
  if (r.run?.error) L.push("## Run error", "", "```", r.run.error, "```", "");
  if (r.problems.length) L.push("## Unmet expectations", "", ...r.problems.map((p: string) => `- ${p}`), "");
  if (r.staffing) L.push("## Staffing approved by the scenario", "", ...r.staffing.plan.map((p: any) => `- ${p.node}: ${p.provider} ${p.model ?? ""} ${p.effort ?? ""}`), "");
  const reached = r.nodes.filter((n: any) => n.outcome !== "not-reached");
  if (reached.length) {
    L.push("## Nodes", "", "| Node | Status | Outcome | Provider / model | Rounds | Duration | Log | First error |", "|---|---|---|---|---|---|---|---|");
    for (const n of reached) L.push(`| ${n.label} (\`${n.node}\`) | ${n.status} | ${n.outcome} | ${n.provider ? `${n.provider} / ${n.model ?? "?"}${n.source === "artifact" ? " (artifact record)" : ""}` : "—"} | ${n.rounds} | ${n.durationSeconds ?? "—"} s | [log](${n.log}) | ${n.firstError ? "`" + n.firstError.replace(/\|/g, "\\|").replace(/\n/g, " ") + "`" : "—"} |`);
    L.push("");
  }
  const not = r.nodes.filter((n: any) => n.outcome === "not-reached").map((n: any) => n.node);
  if (not.length) L.push(`Not reached: ${not.join(", ")}`, "");
  if (r.library.length) { L.push("## Library items (acceptance run)", "", ...r.library.map((x: any) => `- ${x.artifact} v${x.version ?? "?"} — acceptance run, Task ${x.task}${x.href ? ` — ${x.href}` : ""}`), ""); }
  if (r.cards.length) { L.push("## Captain cards", ""); for (const c of r.cards) L.push(`- ${c.id} (${c.kind} on \`${c.node}\`): ${c.decision}${c.answered ? ` → ${c.answered}` : ""}${c.reason ? ` — ${c.reason}` : ""}`); L.push(""); }
  const fails = r.nodes.filter((n: any) => n.firstError);
  if (fails.length) { L.push("## First errors (exact text)", ""); for (const n of fails) L.push(`### ${n.node}`, "", "```", n.firstError, "```", `Log: ${n.log}`, ""); }
  L.push("## What counts as pass", "", "PASS only when no card stopped the run, the budget held, every node ran on a real model, and the run ended as the scenario expects with its artifacts. See docs/live-acceptance.md.", "");
  return L.join("\n");
}

function writeReport(st: Studio, r: any) {
  const dir = join(st.data, "acceptance", r.date); mkdirSync(dir, { recursive: true, mode: 0o700 });
  let name = r.workflow; for (let i = 2; existsSync(join(dir, `${name}.md`)) || existsSync(join(dir, `${name}.json`)); i++) name = `${r.workflow}-${i}`;
  const md = join(dir, `${name}.md`), js = join(dir, `${name}.json`);
  writeFileSync(js, st.scrub(JSON.stringify(redactJSON(r), null, 2)) + "\n", { mode: 0o600 }); writeFileSync(md, st.scrub(markdown(r)), { mode: 0o600 });
  return { md, js };
}

// ---------- main ----------
let scrubOut = (t: string) => t;
async function main() {
  let a: Args; try { a = parseArgs(process.argv.slice(2)); } catch (e: any) { console.error(`live-acceptance: ${e.message}`); return EXIT.ERROR; }
  const files: string[] = [];
  if (a.scenario) files.push(resolve(a.scenario));
  for (const w of a.workflows) files.push(join(a.scenarios, `${w}.yaml`));
  if (a.all) files.push(...scenarioFiles(a.scenarios).filter((f) => loadScenario(f).live !== false)); // internal and retired workflows: the board cannot start them
  const scenarios: Scenario[] = [];
  for (const f of files) { if (!existsSync(f)) { console.error(`live-acceptance: no scenario file ${f}`); return EXIT.ERROR; } try { scenarios.push(loadScenario(f)); } catch (e: any) { console.error(`live-acceptance: ${e.message}`); return EXIT.ERROR; } }
  // find the instance exactly as `open` does; --base selects it by port
  process.env.CREW_PORT = new URL(a.base).port;
  let inst; try { inst = await discoverInstance(); } catch (e: any) { console.error(`live-acceptance: ${String(e?.message ?? e)}`); return EXIT.ERROR; }
  if (!inst || inst.origin !== a.base) { console.error(`live-acceptance: No verified running Studio at ${a.base}. Start it (bun run launch), or pass --base for the instance you mean. No session was created or printed.`); return EXIT.ERROR; }
  const st = new Studio(inst.origin, inst.token, inst.data); scrubOut = (t) => st.scrub(t); inst = null;
  const date = localDate(); let worst = 0;
  for (const s of scenarios) {
    let r: any;
    try { r = await runOne(st, s, a, date); }
    catch (e: any) { console.error(st.scrub(`live-acceptance: ${s.workflow}: ${String(e?.message ?? e)}`)); worst = Math.max(worst, EXIT.ERROR); continue; }
    const { md, js } = writeReport(st, r);
    console.log(st.scrub(`${s.workflow}: ${r.verdict}${r.completion && r.completion !== "complete" ? ` (${r.completion})` : ""}${r.stop ? ` — ${r.stop.reason}` : r.budget.exceeded ? ` — budget exceeded (${r.budget.exceeded})` : r.problems.length ? ` — ${r.problems[0]}` : ""}`));
    if (r.stop) console.error(st.scrub(`STOP ${s.workflow}: ${r.stop.reason}`));
    console.log(`report: ${md}`); console.log(`json: ${js}`);
    worst = Math.max(worst, EXIT[r.verdict as Verdict]);
  }
  return worst;
}
// the last guard: whatever escapes is printed scrubbed, never with the session
main().then((code) => process.exit(code), (e) => { console.error(scrubOut(`live-acceptance: ${String(e?.stack ?? e?.message ?? e)}`)); process.exit(EXIT.ERROR); });
