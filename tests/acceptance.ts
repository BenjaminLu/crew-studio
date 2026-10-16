// Workflow acceptance harness (offline): every bundled workflow, end to end, through the production path.
//
// The scenario list is the shared one (tests/acceptance/<id>.yaml, read with
// scripts/acceptance/scenarios.ts, the same files the live driver reads). Each bundled workflow
// (workflows/v2 and packs/, what the runtime seeds: src/runtime/defs.ts) needs a scenario file
// with at least one `stub:` run, or this suite fails with "no acceptance scenario for workflow X".
//
// Each stub run starts its Task the way the captain does (the board's POST /api/wruns body, or
// Firstmate's own native tools) on a real Studio (`bun src/server.ts`, temporary CREW_DATA), with
// the providers bound to stub CLIs (CREW_CODEX_BIN, CREW_CLAUDE_BIN) that speak codex exec and
// app-server JSON-RPC and claude stream-json (tests/acceptance/agent.mjs). It answers the captain
// cards over the card API and checks the terminal status, the nodes visited, the agent path check,
// the artifacts and Library entries, and that no error text is generic.
//
// A run with `known_failure` is a product bug recorded with its root cause: it prints loudly and does
// not fail the suite. If it passes, the suite fails, so the list stays true when the fix lands.
// See docs/acceptance.md.   ACCEPTANCE_ONLY=<workflow|workflow:run>[,…]   ACCEPTANCE_KEEP=1 keeps temp data
import { bundledList, bundledText, parseYaml } from "../src/bundled";
import { loadScenario, openWindowIds, scenarioFiles, type Scenario } from "../scripts/acceptance/scenarios";
import { bootStudio, type Studio } from "./acceptance/studio";
import { drive, verify, type Expect } from "./acceptance/drive";
import { stubRuns, stubDecision, type StubRun } from "./acceptance/stub";
import { STEPS, approveStaffing, type Ctx } from "./acceptance/steps";

const t0 = Date.now(), problems: string[] = [];
// what the runtime seeds (workflows/v2 and packs/ *.wf.yaml, retired ones included), and the packs' legacy v1 flow files
const files = [...bundledList("workflows/v2/"), ...bundledList("packs/")].filter((f) => f.endsWith(".wf.yaml") || (f.startsWith("packs/") && f.endsWith(".flow.yaml")));
const bundled = [...new Set(files.map((f) => String((parseYaml(bundledText(f) ?? "") as any)?.id ?? f)))];
const scenarios: Scenario[] = [];
for (const f of scenarioFiles()) { try { scenarios.push(loadScenario(f)); } catch (e: any) { problems.push(e.message); } }
const runs: StubRun[] = [];
for (const s of scenarios) { try { runs.push(...stubRuns(s)); } catch (e: any) { problems.push(e.message); } }
for (const id of bundled) {
  const s = scenarios.find((x) => x.workflow === id);
  if (!s) problems.push(`no acceptance scenario for workflow ${id} (add tests/acceptance/${id}.yaml)`);
  else if (!s.stub?.length) problems.push(`no acceptance scenario for workflow ${id}: ${s.file} has no stub run`);
}
for (const s of scenarios) if (!bundled.includes(s.workflow)) problems.push(`${s.file} names ${s.workflow}, which is not a bundled workflow`);

const only = (process.env.ACCEPTANCE_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const picked = only.length ? runs.filter((r) => only.includes(r.workflow) || only.includes(`${r.workflow}:${r.name}`)) : runs;

const servers: Record<string, Promise<Studio>> = {};
const serverFor = (kind: StubRun["server"]) => servers[kind] ??= bootStudio(kind, { localUnrestricted: kind === "local-unrestricted" });
const primaries = new Map<Studio, Promise<void>>();
/** Firstmate's own chat on the codex primary (the stub app-server): one native tool call, as the model would make it. Returns the Tasks it created. */
const firstmate = (s: Studio) => async (marker: "NATIVE-PROPOSE " | "NATIVE-PROJECT ", args: unknown) => {
  if (!primaries.has(s)) primaries.set(s, (async () => { const r = await s.api("/api/main/start", { host: "codex", confirm: true }); if (r.status !== 200) throw new Error(`Firstmate primary did not start: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); for (let i = 0; i < 300 && (await s.api("/api/main")).body.busy; i++) await Bun.sleep(50); })());
  await primaries.get(s);
  const before = new Set(((await s.api("/api/wruns")).body.runs ?? []).map((r: any) => r.id));
  const sent = await s.api("/api/main/send", { text: marker + JSON.stringify(args) }); if (sent.status !== 200) throw new Error(`Firstmate send refused: ${sent.status} ${JSON.stringify(sent.body).slice(0, 300)}`);
  for (let i = 0; i < 400; i++) { await Bun.sleep(50); if (i > 4 && !(await s.api("/api/main")).body.busy) break; }
  return ((await s.api("/api/wruns")).body.runs ?? []).filter((r: any) => !before.has(r.id));
};
/** The captain's authorization windows open for this Task's project (as the live driver reads them). */
async function openWindows(s: Studio, view: any): Promise<string[]> {
  const r = await s.api("/api/policies/auth-window"); if (r.status !== 200 || !Array.isArray(r.body?.grants)) throw new Error(`could not read the authorization windows: HTTP ${r.status}`);
  return openWindowIds(r.body.grants, view.ctx?.project ?? view.params?.project ?? null);
}
const fill = (v: string, vars: Record<string, string>) => v.replace(/\{(\w+)\}/g, (_m, k) => { if (!(k in vars)) throw new Error(`params name {${k}}, which no setup step provided`); return vars[k]; });

/** The run's expectations: its own, else the shared scenario's end (status/result/artifacts, or stop_at). */
function expectFor(r: StubRun): Expect {
  const sh = r.shared.expect, e = r.expect;
  const art = sh.artifacts ?? [], deliver = art.map((a) => a.deliver).find((n) => n !== undefined), filesWanted = art.map((a) => a.file).filter(Boolean) as string[];
  if (!e) return sh.stop_at ? { status: "waiting", visited: [], waitingOn: sh.stop_at } : { status: sh.status!, result: sh.result, visited: [], outputs: deliver, files: filesWanted };
  if (e.waiting_on) return { status: "waiting", visited: e.visited, notVisited: e.not_visited, waitingOn: e.waiting_on };
  // the shared result and artifacts hold for a run that ends the same way (same status, and the same result when it names one)
  const same = e.status === sh.status && (e.result === undefined || sh.result === undefined || e.result === sh.result);
  return { status: e.status!, result: e.result !== undefined ? e.result : same ? sh.result : undefined, visited: e.visited, notVisited: e.not_visited, library: e.library, outputs: e.outputs ?? (same ? deliver : undefined), minVisits: e.min_visits, approved: e.approved, files: same ? filesWanted : [] };
}

async function runOne(r: StubRun): Promise<{ failures: string[]; task?: string }> {
  const s = await serverFor(r.server), h: Ctx = { s, vars: {}, firstmate: firstmate(s) }, failures: string[] = [];
  for (const step of r.setup) { const f = STEPS[step]; if (!f) return { failures: [`no setup step ${step} (tests/acceptance/steps.ts)`] }; await f(h); }
  const params: Record<string, string> = { ...Object.fromEntries(Object.entries(r.shared.start.params).map(([k, v]) => [k, fill(v, h.vars)])), ...(r.provider ? { provider: r.provider } : {}), ...Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, fill(v, h.vars)])) };
  const body = { text: r.topic, workflow: r.workflow, params };
  if (r.board_refusal) {
    const st = await s.api("/api/wruns", body);
    if (st.status === 200) failures.push(`the board started ${st.body.id}; expected a refusal ${r.board_refusal.status}`);
    else if (st.status !== r.board_refusal.status || !r.board_refusal.error.test(String(st.body?.error ?? ""))) failures.push(`board start refused ${st.status}: ${String(st.body?.error ?? "").slice(0, 300)}; expected ${r.board_refusal.status} ${r.board_refusal.error}`);
  }
  if (r.how === "retired") {
    const wf = (await s.api("/api/wf")).body.workflows ?? []; if (wf.some((w: any) => w.id === r.workflow)) failures.push(`the board's workflow list offers retired ${r.workflow}`);
    return { failures };
  }
  const decide = async (card: any, view: any, visit: number) => {
    const d = stubDecision(r, card, visit, view.def, { openAuthWindows: await openWindows(s, view) }); if ("stop" in d) return d;
    let note = d.note, choice = d.choice;
    if (d.before) { const f = STEPS[d.before]; if (!f) return { stop: `no step ${d.before}` }; const o = await f(h, card, view); if (o?.note !== undefined) note = o.note; if (o?.choice) choice = o.choice; }
    return { choice, note };
  };
  let task: string;
  if (r.how === "board") {
    const st = await s.api("/api/wruns", body);
    if (st.status !== 200) return { failures: [...failures, `the board start route refused: ${st.status} ${String(st.body?.error ?? JSON.stringify(st.body)).slice(0, 400)}`] };
    task = st.body.id;
  } else {
    const target = r.target ?? { workflow: r.workflow, params: {} };
    const tparams: Record<string, string> = { ...params, ...Object.fromEntries(Object.entries(target.params).map(([k, v]) => [k, fill(v, h.vars)])) }; delete tparams.provider;
    const version = (await s.api(`/api/wf/${target.workflow}`)).body.def?.version ?? 1;
    let created: any[];
    if (r.how === "register") { if (!h.vars.repo) await STEPS.repo(h); created = await h.firstmate("NATIVE-PROJECT ", { path: h.vars.repo, name: "Acceptance repo", workflow: target.workflow, version, text: r.topic, params: {} }); }
    else if (r.how === "staffing") { const id = await approveStaffing(h, tparams.project ?? "sandbox", target.workflow); created = [{ id, workflow: "firstmate-staffing" }]; }
    else created = await h.firstmate("NATIVE-PROPOSE ", { workflow: target.workflow, version, text: r.topic, params: tparams });
    const want = r.how === "firstmate" || r.how === "proposal" ? "firstmate-proposal" : r.how === "register" ? "firstmate-register-project" : "firstmate-staffing";
    const own = created.find((x) => x.workflow === want);
    if (!own) return { failures: [...failures, `Firstmate created no ${want} Task (it created: ${created.map((x) => `${x.id} ${x.workflow}`).join(", ") || "nothing"})`] };
    if (r.how !== "firstmate") task = own.id;
    else {
      // the captain approves Firstmate's proposal on its dispatch card; the launched child is the Task under test
      const pd = await drive(s, own.id, async (c) => c.node === "dispatch" ? { choice: "approve" } : { stop: "only the proposal's dispatch card is answered here" }, { timeoutMs: 60_000 });
      const pbad = await verify(s, pd, { status: "succeeded", visited: ["dispatch", "launch", "done"] }); if (pbad.length) return { failures: [...failures, ...pbad.map((x) => `proposal ${own.id}: ${x}`)], task: own.id };
      task = pd.view.ctx?.childRun; if (!task) return { failures: [...failures, `proposal ${own.id} launched no Task`], task: own.id };
    }
  }
  const exp = expectFor(r);
  const d = await drive(s, task, decide, { timeoutMs: r.timeout_s * 1000, until: exp.status === "waiting" ? (v) => (v.cards ?? []).some((c: any) => c.status === "open" && c.node === exp.waitingOn) : undefined });
  failures.push(...await verify(s, d, exp));
  return { failures, task };
}

type Row = { r: StubRun; verdict: "pass" | "FAIL" | "known-fail" | "UNEXPECTED PASS"; ms: number; task?: string; detail: string };
const rows: Row[] = [];
async function record(r: StubRun) {
  const t = Date.now(); let out: { failures: string[]; task?: string };
  try { out = await runOne(r); } catch (e: any) { out = { failures: [`scenario threw: ${String(e?.message ?? e).slice(0, 500)}`] }; }
  const failed = out.failures.length > 0, verdict: Row["verdict"] = r.known_failure ? (failed ? "known-fail" : "UNEXPECTED PASS") : failed ? "FAIL" : "pass";
  const row: Row = { r, verdict, ms: Date.now() - t, task: out.task, detail: failed ? out.failures.join(" | ") : r.covers }; rows.push(row);
  console.log(`${(verdict === "pass" ? "PASS" : verdict === "known-fail" ? "KNOWN-FAIL" : verdict).padEnd(15)} ${r.workflow}:${r.name} (${(row.ms / 1000).toFixed(1)} s${row.task ? `, ${row.task}` : ""})${verdict === "pass" ? "" : `\n    ${row.detail}`}`);
}
try {
  for (const p of problems) console.log(`FAIL            ${p}`);
  // Tasks run side by side; runs that drive Firstmate's one primary chat run one at a time
  // and so do Claude runs: Studio holds one Claude verification at a time (a second one meanwhile is refused)
  const serial = picked.filter((r) => r.how === "firstmate" || r.how === "proposal" || r.how === "register" || r.setup.includes("register") || r.provider === "claude" || r.workflow === "startup-recursion" || r.setup.includes("verify-claude") || r.cards.some((c) => c.before === "pack-shadow")), parallel = picked.filter((r) => !serial.includes(r));
  const lane = async () => { for (const r of serial) await record(r); };
  const pool = async (n: number) => { const q = [...parallel]; await Promise.all(Array.from({ length: n }, async () => { for (let r; (r = q.shift());) await record(r); })); };
  await Promise.all([lane(), pool(Number(process.env.ACCEPTANCE_PARALLEL ?? 4))]);
} finally { await Promise.all(Object.values(servers).map(async (p) => (await p.catch(() => null))?.close())); }

const known = rows.filter((x) => x.verdict === "known-fail");
if (known.length) {
  console.log(`\n${"!".repeat(78)}\n!! ${known.length} KNOWN-FAILING acceptance run(s): workflows that break on the live board today\n${"!".repeat(78)}`);
  for (const x of known) console.log(`!! ${x.r.workflow}:${x.r.name}\n!!    observed:   ${x.r.known_failure!.observed}\n!!    root cause: ${x.r.known_failure!.root_cause}${x.r.known_failure!.covered_by ? `\n!!    fix:        ${x.r.known_failure!.covered_by}` : ""}\n!!    this run:   ${x.detail.slice(0, 400)}`);
}
for (const x of rows.filter((x) => x.verdict === "UNEXPECTED PASS")) console.log(`\nUNEXPECTED PASS: ${x.r.workflow}:${x.r.name} now passes; remove its known_failure in ${x.r.shared.file} and its row in docs/acceptance.md.`);
const bad = rows.filter((x) => x.verdict === "FAIL" || x.verdict === "UNEXPECTED PASS");
console.log(`\nacceptance: ${rows.filter((x) => x.verdict === "pass").length} pass, ${known.length} known-fail, ${bad.length} fail, ${problems.length} coverage problem(s) · ${bundled.length} bundled workflows · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad.length || problems.length ? 1 : 0);
