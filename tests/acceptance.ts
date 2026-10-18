import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
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
// ACCEPTANCE_SCENARIO_DIR=<dir> reads the scenario files from another folder (tests/acceptance-known.ts)
import { bundledList, bundledText, parseYaml } from "../src/bundled";
import { defHash, loadScenario, openWindowIds, scenarioFiles, type Scenario } from "../scripts/acceptance/scenarios";
import { bootStudio, filmSample, SANDBOXED, SANDBOXED_E2E, type Studio } from "./acceptance/studio";
import { installsFor, type Install } from "../scripts/acceptance/installs";
import { drive, verify, type Expect } from "./acceptance/drive";
import { stubRuns, stubDecision, verdictOf, type StubRun } from "./acceptance/stub";
import { STEPS, approveStaffing, type Ctx } from "./acceptance/steps";
import { prove, RENDERER_PROVES } from "./acceptance/proves";

const t0 = Date.now(), problems: string[] = [];
// what the runtime seeds (workflows/v2 and packs/ *.wf.yaml, retired ones included), and the packs' legacy v1 flow files
const files = [...bundledList("workflows/v2/"), ...bundledList("packs/")].filter((f) => f.endsWith(".wf.yaml") || (f.startsWith("packs/") && f.endsWith(".flow.yaml")));
const bundled = [...new Set(files.map((f) => String((parseYaml(bundledText(f) ?? "") as any)?.id ?? f)))];
const scenarios: Scenario[] = [];
for (const f of scenarioFiles(process.env.ACCEPTANCE_SCENARIO_DIR || undefined)) { try { scenarios.push(loadScenario(f)); } catch (e: any) { problems.push(e.message); } }
const runs: StubRun[] = [];
for (const s of scenarios) { try { runs.push(...stubRuns(s)); } catch (e: any) { problems.push(e.message); } }
for (const id of bundled) {
  const s = scenarios.find((x) => x.workflow === id);
  if (!s) problems.push(`no acceptance scenario for workflow ${id} (add tests/acceptance/${id}.yaml)`);
  else if (!s.stub?.length) problems.push(`no acceptance scenario for workflow ${id}: ${s.file} has no stub run`);
}
for (const s of scenarios) if (!bundled.includes(s.workflow)) problems.push(`${s.file} names ${s.workflow}, which is not a bundled workflow`);

const only = (process.env.ACCEPTANCE_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const profile = SANDBOXED_E2E ? "sandboxed-e2e" : SANDBOXED ? "sandboxed" : "default";
const picked = (only.length ? runs.filter((r) => only.includes(r.workflow) || only.includes(`${r.workflow}:${r.name}`)) : runs).filter((r) => r.profiles.includes(profile));

const servers: Record<string, Promise<Studio>> = {};
const serverFor = (kind: StubRun["server"], scope = "") => servers[`${kind}:${scope}`] ??= bootStudio(scope || kind, { localUnrestricted: kind === "local-unrestricted" });
const primaries = new Map<Studio, Promise<void>>();
/** Firstmate's own chat on the codex primary (the stub app-server): one native tool call, as the model would make it. Returns the Tasks it created. */
const firstmate = (s: Studio) => async (marker: "NATIVE-PROPOSE " | "NATIVE-PROJECT " | "NATIVE-TOOL ", args: unknown) => {
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
  // Team approvals and merge-grant token fixtures must not change another scenario's Studio.
  const s = await serverFor(r.server, ["crew", "grant-merge"].includes(r.how) ? `${r.workflow}-${r.name}` : ""), h: Ctx = { s, vars: {}, firstmate: firstmate(s) }, failures: string[] = [];
  for (const step of r.setup) { const f = STEPS[step]; if (!f) return { failures: [`no setup step ${step} (tests/acceptance/steps.ts)`] }; await f(h); }
  const params: Record<string, string> = { ...Object.fromEntries(Object.entries(r.shared.start.params).map(([k, v]) => [k, fill(v, h.vars)])), ...(r.provider ? { provider: r.provider } : {}), ...Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, fill(v, h.vars)])) };
  // the sandbox probe's arguments (setup step probe) go into the intent, where the scripted agent reads them
  const body = { text: r.topic.replaceAll("{probe}", h.vars.probe ?? ""), workflow: r.workflow, params };
  if (r.board_refusal) {
    const st = await s.api("/api/wruns", body);
    if (st.status === 200) failures.push(`the board started ${st.body.id}; expected a refusal ${r.board_refusal.status}`);
    else if (st.status !== r.board_refusal.status || !r.board_refusal.error.test(String(st.body?.error ?? ""))) failures.push(`board start refused ${st.status}: ${String(st.body?.error ?? "").slice(0, 300)}; expected ${r.board_refusal.status} ${r.board_refusal.error}`);
  }
  if (r.how === "held") { // kept for editing, not offered for a new Task: absent from the Start form, listed as held with its reason
    const wf = (await s.api("/api/wf")).body; if ((wf.workflows ?? []).some((w: any) => w.id === r.workflow)) failures.push(`the board's workflow list offers held ${r.workflow}`);
    if (!(wf.held ?? []).some((w: any) => w.id === r.workflow && /^held: /.test(w.held?.en ?? ""))) failures.push(`the catalog does not list ${r.workflow} as held with its reason`);
    if (!r.board_refusal) failures.push(`a held run needs board_refusal`);
    return { failures };
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
    else if (r.how === "connect") created = await h.firstmate("NATIVE-TOOL ", { name: "studio_connect_github", args: { project: h.vars.project } });
    else if (r.how === "grant-merge") created = await h.firstmate("NATIVE-TOOL ", { name: "studio_connect_github", args: { project: h.vars.project, merge: true } });
    else if (r.how === "crew") created = await h.firstmate("NATIVE-TOOL ", { name: "studio_propose_crew_change", args: { change: { kind: "member", seat: "maker", set: { provider: "codex", model: "acceptance-model", effort: "medium" } } } });
    else if (r.how === "staffing") { const id = await approveStaffing(h, tparams.project ?? "sandbox", target.workflow); created = [{ id, workflow: "firstmate-staffing" }]; }
    else created = await h.firstmate("NATIVE-PROPOSE ", { workflow: target.workflow, version, text: body.text, params: tparams });
    const want = r.how === "firstmate" || r.how === "proposal" ? "firstmate-proposal" : r.how === "register" ? "firstmate-register-project" : r.how === "connect" ? "firstmate-connect-github" : r.how === "grant-merge" ? "firstmate-grant-merge" : r.how === "crew" ? "crew-change" : "firstmate-staffing";
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
  if (["crew", "grant-merge"].includes(r.how) && defHash(d.view?.def) !== r.shared.pin.sha256) failures.push("the approval Task definition differs from the reviewed scenario pin");
  // the real side effects: a proof that needs the real renderer only where the renderer is real (the e2e profile)
  for (const p of r.proves) if (SANDBOXED_E2E || !RENDERER_PROVES.includes(p)) failures.push(...(await prove(s, d.view, p, { sinkHits: h.sinkHits, github: h.github })).map((x) => `proves ${p}: ${x}`));
  // a run checked while it waits on a card (stopped by design) is cancelled afterwards: left open, it would still hold its
  // project, and a later run on the same project would meet it as overlapping work (a scope card) instead of its own path
  if (exp.status === "waiting") { const c = await s.api(`/api/wruns/${task}/cancel`, {}); if (c.status !== 200) failures.push(`could not cancel the waiting Task ${task} after its check: ${c.status} ${JSON.stringify(c.body).slice(0, 200)}`); }
  return { failures, task };
}

type Row = { r: StubRun; verdict: "pass" | "FAIL" | "known-fail" | "UNEXPECTED PASS" | "SKIPPED"; ms: number; task?: string; detail: string };
/** Why a run cannot run here (a local tool it needs is missing), or null. */
// The sandboxed profile (ACCEPTANCE_PROFILE=sandboxed, scripts/acceptance-sandboxed.ts) asks the sandbox Studio's own Doctor what
// is installed, and skips (never passes) a run whose workflow needs an install this Mac lacks, naming it.
const defOf = new Map(files.map((f) => parseYaml(bundledText(f) ?? "") as any).filter((d) => d?.id).map((d) => [String(d.id), d]));
let doctorItems: Promise<Record<string, any>> | null = null;
const doctor = () => doctorItems ??= serverFor("sandbox").then(async (s) => Object.fromEntries(((await s.api("/api/doctor")).body.items ?? []).map((i: any) => [i.id, i])));
// the renderer row stays "info" (Chromium is unverified until a capture); the e2e profile counts it installed when Node and Playwright are
// there, and a capture that then cannot launch Chromium fails its run (never a skip)
const installed = (by: Record<string, any>, id: string) => by[id]?.status === "ok" || SANDBOXED_E2E && id === "renderer" && !!by[id] && by[id].availability !== "missing";
const lacking = async (workflow: string): Promise<Install[]> => { const by = await doctor(); return installsFor(defOf.get(workflow)).filter((i) => !installed(by, i.id)); };
async function missing(r: StubRun): Promise<string | null> {
  if (r.needs.includes("ffmpeg") && !filmSample.path) return filmSample.reason;
  if (!SANDBOXED) return null;
  if (r.server === "local-unrestricted") return "the sandboxed profile runs only with the OS sandbox on (this run needs local-unrestricted mode)";
  const lack = await lacking(r.target?.workflow ?? r.workflow);
  if (r.needs.includes("renderer") && !lack.some((i) => i.id === "renderer") && !installed(await doctor(), "renderer")) lack.push({ id: "renderer", why: "this run's change is captured or rendered with Playwright" });
  return lack.length ? `needs ${lack.map((i) => `${i.id} (${i.why})`).join(", ")}: not installed on this Mac (install it from Settings → Doctor)` : null;
}
const rows: Row[] = [];
async function record(r: StubRun) {
  const t = Date.now(); let out: { failures: string[]; task?: string };
  const skip = await missing(r);
  // the e2e profile is the pre-deploy gate: a run that cannot run with the sandbox on is a failure, never a skip
  if (skip && SANDBOXED_E2E && r.server !== "local-unrestricted") { rows.push({ r, verdict: "FAIL", ms: 0, detail: skip }); console.log(`${"FAIL".padEnd(15)} ${r.workflow}:${r.name}\n    ${skip}`); return; }
  if (skip) { rows.push({ r, verdict: "SKIPPED", ms: 0, detail: skip }); console.log(`${"SKIPPED".padEnd(15)} ${r.workflow}:${r.name}\n    ${skip}`); return; }
  try { out = await runOne(r); } catch (e: any) { out = { failures: [`scenario threw: ${String(e?.message ?? e).slice(0, 500)}`] }; }
  const failed = out.failures.length > 0, verdict: Row["verdict"] = verdictOf(r, out.failures);
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
  for (const x of known) console.log(`!! ${x.r.workflow}:${x.r.name}\n!!    observed:   ${x.r.known_failure!.observed}\n!!    matches:    ${x.r.known_failure!.match}\n!!    root cause: ${x.r.known_failure!.root_cause}${x.r.known_failure!.covered_by ? `\n!!    fix:        ${x.r.known_failure!.covered_by}` : ""}\n!!    this run:   ${x.detail.slice(0, 400)}`);
}
for (const x of rows.filter((x) => x.verdict === "UNEXPECTED PASS")) console.log(`\nUNEXPECTED PASS: ${x.r.workflow}:${x.r.name} now passes; remove its known_failure in ${x.r.shared.file} and its row in docs/acceptance.md.`);
const bad = rows.filter((x) => x.verdict === "FAIL" || x.verdict === "UNEXPECTED PASS");
const skipped = rows.filter((x) => x.verdict === "SKIPPED");
if (SANDBOXED) {
  // which workflow needs which install, and whether this Mac has it (the Doctor of the sandboxed Studio)
  const by: Record<string, any> = doctorItems ? await doctorItems.catch(() => ({})) : {}; // read while the servers ran; never boot one now
  console.log(`\nInstalls per workflow (${SANDBOXED_E2E ? "sandboxed e2e profile: OS sandbox on, empty HOME, this Mac's tools" : "sandboxed profile: OS sandbox on, empty HOME, no tool cache"}):`);
  for (const id of [...new Set(rows.map((x) => x.r.workflow))].sort()) {
    const need = installsFor(defOf.get(id)).map((i) => i.id as string);
    const some = rows.some((x) => x.r.workflow === id && x.r.needs.includes("renderer")) && !need.includes("renderer") ? ["renderer"] : [];
    const say = (n: string, extra = "") => `${n}${extra} ${installed(by, n) ? "installed" : "MISSING"}`;
    console.log(`  ${id.padEnd(28)} ${need.length || some.length ? [...need.map((n) => say(n)), ...some.map((n) => say(n, " (some runs: UI captures)"))].join(", ") : "nothing beyond Studio"}`);
  }
}
console.log(`\nacceptance: ${rows.filter((x) => x.verdict === "pass").length} pass, ${known.length} known-fail, ${bad.length} fail, ${skipped.length} skipped (not passed), ${problems.length} coverage problem(s) · ${bundled.length} bundled workflows · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(bad.length || problems.length ? 1 : 0);
