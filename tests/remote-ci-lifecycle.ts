import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitHubPrAdapter } from "../src/adapters/github";
import { RemoteWatchers, requiredPolicy, grantIdentity, registerRemoteWait, validRemoteWait } from "../src/domain/remote-ci";
import { Engine } from "../src/runtime/engine";
import { WorkflowDefs } from "../src/runtime/defs";
import { Agents } from "../src/agent";
import { StudioLog } from "../src/rawlog";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";
let pass = 0, fail = 0;
const ok = (v: any, name: string) => { console.log(`${v ? "PASS" : "FAIL"} ${name}`); v ? pass++ : fail++; };
const heldStarted = async (started: Promise<void>) => { let timer: ReturnType<typeof setTimeout>; try { await Promise.race([started, new Promise<void>((_r, reject) => timer = setTimeout(() => reject(new Error("held fixture request was not reached")), 2500))]); } finally { clearTimeout(timer!); } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 2500) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await sleep(5); return f(); };
const temp = mkdtempSync(join(tmpdir(), "remote-r2-")), repo = join(temp, "repo"), bare = join(temp, "bare.git"), packs = join(temp, "packs"); mkdirSync(repo); setGitHome(join(temp, "git-home"));
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "one"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "one"]); must(temp, ["clone", "--bare", "-q", repo, bare]); must(repo, ["checkout", "-qb", "crew/task"]); writeFileSync(join(repo, "file"), "two"); must(repo, ["commit", "-qam", "two"]); const head = must(repo, ["rev-parse", "HEAD"]);
const sim = githubSimulator(bare), grant = { mode: "simulator" as const, repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "local-fixture" }, adapter = new GitHubPrAdapter(grant, () => "fake-token", 2000), engines: Engine[] = [], watchers: RemoteWatchers[] = [];
const dir = join(temp, "record"); mkdirSync(dir);
const checkDir = join(packs, "r2", "checks", "count"); mkdirSync(checkDir, { recursive: true }); writeFileSync(join(checkDir, "check.yaml"), "id: count\nversion: 1\nkind: deterministic\nnative: counting\nneeds: []\nblocking: false\n");
let checks = 0, actions = 0;
const flow = (name: string, action = "fixture.wait", attached = false) => `id: ${name}\nname: Fixture\nversion: 1\nnodes:\n  - {id: seed, kind: hook, do: fixture.seed, label: Seed}\n  - {id: wait, kind: hook, do: ${action}, label: Wait${attached ? ', checks: [{use: r2/count}]' : ""}}\n  - {id: done, kind: hook, do: note, label: Done, args: {result: done}}\nedges:\n  - [seed, wait]\n  - [wait, done, ok]\n`;
const data = join(temp, "engine"), create = (name = "waiting", action = "fixture.wait", attached = false, install = false) => {
  const e = new Engine({ dataDir: data, agents: new Agents(data, () => "http://127.0.0.1:9"), log: new StudioLog(join(data, "log")), send: () => {}, skillText: () => "", defaultProvider: () => ({ provider: "stub", model: null }), checkRoots: [packs] } as any, new WorkflowDefs(data, () => [flow(name, action, attached)])); engines.push(e);
  (e as any).externalValidators ??= {}; e.externalValidators["github-ci"] = (_x, d) => validRemoteWait(d, adapter);
  if (install) installCode(e, { dataDir: data, projects: new Projects(data), adapter });
  e.actions["fixture.seed"] = x => { x.ctx.repo = x.ctx.worktree = repo; x.ctx.head = head; x.ctx.base = "main"; x.ctx.branch = `crew/${x.run.id}`; return "ok"; };
  e.natives.counting = () => { checks++; return { verdict: "fail", score: 0, findings: [], data: { count: checks } }; };
  return e;
};
try {
  const pr = await adapter.open({ repo, base: "main", branch: "crew/task", head, title: "Fixture", body: "Approved" }, dir);
  sim.expect("GET", "/branches/main/protection/required_status_checks", { strict: true, checks: [{ context: "build", app_id: 7 }], contexts: ["build"] });
  sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: 0, check_runs: [] }); sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] });
  const policy = await requiredPolicy(adapter), wait = (ms = 2000): any => { const startedAt = Date.now(); return { version: 1, handler: "github-ci", grant: grantIdentity(adapter), repository: grant.repository, pr: structuredClone(pr), policy: structuredClone(policy), startedAt, deadline: startedAt + ms, lastDigest: null }; };
  // Each subscriber owns its deadline, even while the shared reader is busy.
  { const watcher = new RemoteWatchers(20); watchers.push(watcher); const held = sim.holdNext("GET", "/pulls/1"), long: any[] = [], short: any[] = [];
    const cancelLong = watcher.subscribe(adapter, "long", wait(), e => long.push(e)); await heldStarted(held.started);
    const shortWait = wait(80); const cancelShort = watcher.subscribe(adapter, "short", shortWait, e => short.push(e));
    await sleep(140); ok(short.some(e => e.state === "stop" && e.reason.includes("deadline")) && long.length === 0 && watcher.size === 1 && watcher.ownership.requests === 1, "short subscriber expires independently before held long response releases; one request owner remains");
    cancelShort(); cancelLong(); held.release(); await until(() => watcher.ownership.requests === 0); ok(watcher.ownership.timers === 0 && watcher.size === 0, "both subscriber and request deadline timers clean up after cancellation"); }
  // Initial publication and initial wait reads are owned by the real run.
  for (const phase of ["publish", "reconcile", "policy", "gate", "merge"]) {
    const action = phase === "gate" || phase === "merge" ? `fixture.${phase}` : "pr.open";
    let e = create(`initial-${phase}`, action, false, true);
    if (phase === "gate" || phase === "merge") e.actions[action] = async x => { x.ctx.pr = structuredClone(pr); x.ctx.remoteCI = { state: "pass", head, policyHash: policy.hash, grant: grantIdentity(adapter) }; if (phase === "gate") await e.runCheck(x, { use: "firstmate/gate-ci" }, null); else await e.cardBodies.merge(x); return "ok"; }; e.load();
    const path = phase === "publish" ? "/pulls" : phase === "policy" ? "/branches/main/protection/required_status_checks" : "/pulls/2";
    // Predict the next PR number from the simulator's durable fixtures.
    const next = sim.pulls.size + 1, actualPath = phase === "reconcile" ? `/pulls/${next}` : phase === "gate" || phase === "merge" ? "/pulls/1" : path;
    const held = sim.holdNext(phase === "publish" ? "POST" : "GET", actualPath);
    const run = e.start({ workflow: `initial-${phase}`, text: "cancel owned initial phase" }); await heldStarted(held.started);
    const cancelStart = Date.now(); e.cancel(run.id); const cancelledEvents = e.events(run.id).length; await until(() => !e.busy(run.id)); const cancelMs = Date.now() - cancelStart, lateWrites = e.events(run.id).slice(cancelledEvents).filter(event => ["card_raised", "check_result", "evidence"].includes(event.type)); const events = e.events(run.id).length, ledger = e.ledger(run.id).length;
    if (phase !== "publish") sim.transformNext("GET", value => ({ ...value, state: "closed" }), actualPath);
    let removed = false; try { e.remove(run.id, run.id); removed = true; } catch {}
    const ledgerAfterDelete = e.ledger(run.id).length; held.release(); await sleep(60);
    ok(removed && !e.get(run.id) && !existsSync(e.rdir(run.id)) && e.cards.list({ run: run.id }).length === 0 && e.ledger(run.id).length === ledgerAfterDelete && lateWrites.length === 0, `${phase}: cancel/delete held initial REST cannot recreate run or late stop card`);
    ok(cancelMs < 500 && events > 0 && ledger >= 0 && adapter.publicationOwners === 0, `${phase}: cancellation completes before held vendor response release`);
  }
  // Corrupt stored identity/policy after persistence, then actually reload it.
  for (const [label, mutate] of [
    ["missing branch", (w: any) => { delete w.pr.branch; }], ["missing branch with completion", (w: any) => { delete w.pr.branch; }], ["malformed PR id", (w: any) => { w.pr.id = "1/reviews"; }],
    ["wrong recorded repo", (w: any) => { w.pr.repo = "/different"; }], ["malformed policy member", (w: any) => { w.policy.checks = [{ name: 7, app: "bad" }]; w.policy.hash = createHash("sha256").update(JSON.stringify({ checks: w.policy.checks, contexts: w.policy.contexts, strict: w.policy.strict })).digest("hex"); }]
  ] as const) {
    const watcher = new RemoteWatchers(20); watchers.push(watcher); let e = create(); e.externalHandlers["github-ci"] = (x, d, wake) => registerRemoteWait(x, adapter, watcher, d, wake); e.actions["fixture.wait"] = () => ({ wait: true, external: wait() }); e.load();
    const run = e.start({ workflow: "waiting" }); await until(() => run.nodes.wait.waiting === "external"); e.disposeExternal(); await until(() => watcher.ownership.requests === 0); mutate(run.nodes.wait.data.external); if (label.includes("completion")) run.nodes.wait.data.externalCompletion = { version: 1, visit: run.nodes.wait.visits, result: { outcome: "ok" } }; e.commit(run, "corrupt fixture stored descriptor"); const calls = sim.calls.length;
    e = create(); e.externalHandlers["github-ci"] = (x, d, wake) => registerRemoteWait(x, adapter, watcher, d, wake); e.load(); await until(() => e.cards.list({ run: run.id, open: true }).length > 0, 150);
    ok(e.cards.list({ run: run.id, open: true })[0]?.title["zh-TW"] === "遠端驗證已停止" && watcher.size === 0 && sim.calls.length === calls, `${label}: restart immediately stops bilingually without watcher or HTTP`);
    ok(JSON.stringify(e.get(run.id)!.nodes.wait.data.external) === JSON.stringify(run.nodes.wait.data.external), `${label}: malformed historical evidence is preserved`); e.cancel(run.id); const quiesced = await until(() => !e.busy(run.id)); const eventCount = e.events(run.id).length, ledgerCount = e.ledger(run.id).length; await sleep(20);
    ok(quiesced && e.events(run.id).length === eventCount && e.ledger(run.id).length === ledgerCount && watcher.ownership.timers === 0 && watcher.ownership.requests === 0, `${label}: cancellation quiesces owned presentation without late event/check writes`);
  }
  // Real attached hook check: success, restart, duplicate callback, cancellation.
  for (const restart of [false, true]) {
    const name = `attached-${restart}`; let wake: any; let e = create(name, "fixture.wait", true); e.externalHandlers.fixture = (_x, _d, callback) => { wake = callback; return () => {}; }; e.actions["fixture.wait"] = () => { actions++; return { wait: true, external: { version: 1, handler: "fixture" } }; }; e.load(); const run = e.start({ workflow: name }); await until(() => run.nodes.wait.waiting === "external"); const actionCount = actions, checkCount = checks;
    if (restart) { e.disposeExternal(); e = create(name, "fixture.wait", true); e.externalHandlers.fixture = (_x, _d, callback) => { wake = callback; return () => {}; }; e.load(); }
    wake({ outcome: "ok" }); wake({ outcome: "ok" }); await until(() => e.get(run.id)?.status === "succeeded"); const current = e.get(run.id)!;
    ok(checks === checkCount + 1 && actions === actionCount && current.ctx.hooks?.wait?.length === 1 && e.ledger(run.id).filter(entry => entry.check === "r2/count").length === 1, `external hook success ${restart ? "after restart" : "before restart"}: attached check/report exactly once without action replay`);
    ok(current.ctx.hooks?.wait?.[0]?.verdict === "fail" && current.status === "succeeded", "external hook keeps canonical nonblocking failure reporting semantics");
  }
  { let wake: any; let e = create("attached-completion", "fixture.wait", true); e.externalHandlers.fixture = (_x, _d, cb) => { wake = cb; return () => {}; }; e.actions["fixture.wait"] = () => { actions++; return { wait: true, external: { version: 1, handler: "fixture" } }; }; e.load();
    const run = e.start({ workflow: "attached-completion" }); await until(() => run.nodes.wait.waiting === "external"); wake({ outcome: "ok" }); await until(() => run.status === "succeeded" && !e.busy(run.id));
    // Durable crash fixture: check/report writes reached disk, finishing/routing
    // did not. Restore that waiting state while retaining signed check evidence.
    const count = checks, note = run.nodes.wait.note, actionCount = actions;
    if (run.ctx.hooks) delete run.ctx.hooks.wait; run.status = "waiting"; run.endedAt = null; run.result = null; run.queue = []; run.nodes.wait.state = "running"; run.nodes.wait.waiting = "external"; run.nodes.wait.routing = undefined; run.nodes.done.state = "pending";
    const step = run.steps.find(s => s.node === "wait")!; step.state = "waiting"; step.outcome = null; e.commit(run, "fixture crash after durable external hook report"); e.disposeExternal();
    e = create("attached-completion", "fixture.wait", true); let registrations = 0; e.externalHandlers.fixture = () => { registrations++; return () => {}; }; e.load(); await until(() => e.get(run.id)?.status === "succeeded");
    ok(checks === count && actions === actionCount && registrations === 0 && e.get(run.id)!.ctx.hooks?.wait?.length === 1 && e.get(run.id)!.nodes.wait.note === note && e.ledger(run.id).filter(entry => entry.check === "r2/count").length === 1, "restart between durable report marker/context rebuilds report from signed check without action, watcher or note duplication");
  }
  { let wake: any; const e = create("attached-fail", "fixture.wait", true); e.externalHandlers.fixture = (_x, _d, cb) => { wake = cb; return () => {}; }; e.actions["fixture.wait"] = () => ({ wait: true, external: { version: 1, handler: "fixture" } }); e.load(); const run = e.start({ workflow: "attached-fail" }); await until(() => run.nodes.wait.waiting === "external"); const count = checks; wake({ outcome: "fail" }); await until(() => run.status === "failed"); ok(checks === count + 1 && run.ctx.hooks?.wait?.length === 1 && run.status === "failed", "completed external failure reports hook checks once like an ordinary returned failure; no approval"); }
  { let wake: any; const e = create("attached-cancel", "fixture.wait", true); e.externalHandlers.fixture = (_x, _d, cb) => { wake = cb; return () => {}; }; e.actions["fixture.wait"] = () => ({ wait: true, external: { version: 1, handler: "fixture" } }); e.load(); const run = e.start({ workflow: "attached-cancel" }); await until(() => run.nodes.wait.waiting === "external"); const count = checks; e.cancel(run.id); await until(() => !e.busy(run.id)); wake({ outcome: "ok" }); await sleep(40); ok(checks === count && !run.ctx.hooks?.wait && !e.ledger(run.id).some(entry => entry.check === "r2/count"), "cancelled external hook runs no attached check/report and accepts no late completion"); }
} catch (e: any) { console.error(e.stack); fail++; }
finally { for (const e of engines) e.disposeExternal(); for (const w of watchers) w.stop(); sim.stop(); rmSync(temp, { recursive: true, force: true }); }
console.log(`${pass} passed / ${fail} failed`); process.exitCode = fail ? 1 : 0;
