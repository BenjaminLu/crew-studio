import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Remote (GitHub) Tasks rebase every round, like local ones (captain's standing rule).
// The GitHub simulator over a temporary bare repository: when the base moves, the next
// build round fetches it, rebases the Task branch onto it, and the publication step pushes
// with --force-with-lease to the Task's own branch only; a conflict goes to the worker;
// someone else's push is never overwritten (a clear stop card instead); no other ref moves.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agents } from "../src/agent";
import { Projects } from "../src/doors";
import { installCode } from "../src/domain/code";
import { GitHubPrAdapter } from "../src/adapters/github";
import { Engine } from "../src/runtime/engine";
import { WorkflowDefs } from "../src/runtime/defs";
import { StudioLog } from "../src/rawlog";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";
import { suite, until, Y } from "./rt-harness";
const { ok, end } = suite("remote-rebase-round");
const temp = checkedTempDir("crew-remote-rebase-"), repo = join(temp, "repo"), bare = join(temp, "bare.git"), other = join(temp, "other"), data = join(temp, "data");
mkdirSync(repo); mkdirSync(data); setGitHome(join(temp, "git-home"));
const id = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"];
must(repo, ["init", "-qb", "main"]); assertTempRepo(repo); writeFileSync(join(repo, "README.md"), "# Remote fixture\n"); must(repo, ["add", "."]); must(repo, [...id, "commit", "-qm", "Initial"]);
must(temp, ["clone", "--bare", "-q", repo, bare]); must(temp, ["clone", "-q", bare, other]); assertTempRepo(other);
const sim = githubSimulator(bare);
const grant = { mode: "simulator" as const, repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "local-fixture" };
const adapter = new GitHubPrAdapter(grant, () => "fake-token", 5000);
sim.expect("GET", "/branches/main/protection/required_status_checks", { strict: true, checks: [{ context: "build", app_id: 7 }], contexts: ["build"] });
const bareRef = (ref: string) => { try { return must(bare, ["rev-parse", "--verify", "-q", ref]); } catch { return ""; } };
const refs = () => must(bare, ["for-each-ref", "--format=%(refname) %(objectname)"]).split("\n").filter(Boolean);
/** Someone else changes the remote: a commit on <ref> of the bare repository, from a separate clone. */
const remoteCommit = (branch: string, file: string, content: string) => {
  must(other, ["fetch", "-q", "origin"]); must(other, ["checkout", "-q", "-B", "w", `origin/${branch}`]);
  writeFileSync(join(other, file), content); must(other, ["add", file]); must(other, [...id, "commit", "-qm", `Remote change to ${file}`]); must(other, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
  return must(other, ["rev-parse", "HEAD"]);
};

let port = 0; const agents = new Agents(data, () => `http://127.0.0.1:${port}`);
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async req => { const t = req.headers.get("x-crew-tool-token") ?? "", u = new URL(req.url);
  if (u.pathname === "/api/tools") return Response.json(agents.toolList(t));
  return Response.json(await agents.callTool(t, decodeURIComponent(u.pathname.slice("/api/tools/".length)), await req.json())); } }); port = server.port;
const briefs = new Map<string, string[]>(), foreignPush = new Map<string, string>(); let foreignFor = "";
const provider: any = { id: "fixture", model: "strict-local", sandboxFree: true, start(_system: string, tools: any[], ctx: any) { return { interrupt() {}, async *send(text: string) {
  const run = /Run (R-\d+)/.exec(text)?.[1] ?? "?", file = /file:([^\s]+)/.exec(text)?.[1] ?? "README.md";
  const call = async (name: string, args: any) => { const r = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const v = await r.json(); if (v.error) throw new Error(v.error); return v; };
  if (tools.some(t => t.name === "spec_write")) await call("spec_write", { title: "Remote fixture", what: "Write a fixture file", why: ["Exercise remote rebases"], done: ["tests/remote-rebase-round.ts fails on base"], scope: [file], door: { kind: "two-way", reason: "Local fixture" }, explain: { en: "Write one file", "zh-TW": "寫入一個檔案" }, zh: { title: "遠端 rebase 測試", why: ["驗證遠端 rebase"] } });
  else if (tools.some(t => t.name === "worker_report")) {
    briefs.set(run, [...(briefs.get(run) ?? []), text]);
    if (/^REBASE CONFLICTS/m.test(text)) for (const m of text.matchAll(/^- (\S+)$/gm)) await call("fs_write", { path: m[1], content: `# resolved by ${run}\n` });
    if (/ · round 1 · /.test(text)) await call("fs_write", { path: file, content: `# ${run} wrote ${file}\n` });
    else if (!/^REBASE CONFLICTS/m.test(text)) await call("fs_write", { path: file, content: `# ${run} round ${/ · round (\d+) · /.exec(text)?.[1]}\n` });
    // someone else pushes to this Task's branch while the round runs
    if (run === foreignFor && !foreignPush.has(run) && !/ · round 1 · /.test(text)) foreignPush.set(run, remoteCommit(`crew/${run}`, "foreign.txt", "pushed by someone else\n"));
    await call("worker_report", { marker: "WORKER_COMPLETE", summary: "Wrote the approved fixture file" });
  }
  yield { type: "turnEnd", status: "ok" };
} }; } };
const flow = { id: "remote-code", name: "Remote rebase fixture", version: 1, roles: [{ id: "coordinator", label: "Coordinator", skill: "test" }, { id: "worker", label: "Worker", skill: "test" }], params: { project: { label: "Project" }, file: { label: "File" } }, nodes: [
  { id: "prepare", kind: "hook", do: "repo.prepare", label: "Prepare", x: 0, y: 0 }, { id: "spec", kind: "agent", role: "coordinator", mode: "spec", label: "Spec", x: 1, y: 0 },
  { id: "dispatch", kind: "card", label: "Dispatch", args: { card_kind: "dispatch" }, card: { title: "Approve fixture scope", body: "Review the fixture scope", options: [{ id: "dispatch", label: "Dispatch", labelZh: "Dispatch" }] }, x: 2, y: 0 },
  { id: "build", kind: "agent", role: "worker", mode: "build", label: "Build", x: 3, y: 0 },
  { id: "pr-open", kind: "hook", do: "pr.open", label: "Publish", x: 4, y: 0 },
  { id: "hold", kind: "card", label: "Hold", card: { title: "Another round?", body: "Run another build round", options: [{ id: "again", label: "Again", labelZh: "Again" }, { id: "stop", label: "Stop", labelZh: "Stop" }] }, x: 5, y: 0 },
  { id: "scope-card", kind: "card", label: "Scope", args: { card_kind: "scope" }, card: { title: "Blocked", body: "Blocked", options: [{ id: "park", label: "Park", labelZh: "Park" }] }, x: 4, y: 1 },
  { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 6, y: 0 }],
  edges: [{ from: "prepare", to: "spec" }, { from: "spec", to: "dispatch" }, { from: "dispatch", to: "build", when: "dispatch" }, { from: "build", to: "build", when: "rebase-more" }, { from: "build", to: "pr-open", when: "ok" }, { from: "build", to: "scope-card", when: "blocked" },
    { from: "pr-open", to: "hold", when: "ok" }, { from: "hold", to: "build", when: "again" }, { from: "hold", to: "closed", when: "stop" }, { from: "scope-card", to: "closed", when: "park" }] };
const E = new Engine({ dataDir: data, agents, provider: () => provider, defaultProvider: () => ({ provider: "fixture", model: "strict-local" }), log: new StudioLog(join(data, "events.jsonl")), send() {}, skillText: () => "# Fixture skill" }, new WorkflowDefs(data, () => [Y(flow)]));
const projects = new Projects(data); projects.add({ id: "remote-fixture", path: repo });
installCode(E, { dataDir: data, projects, adapter }); E.modes.spec.prompt = x => `Run ${x.run.id} file:${x.run.params.file}`;
// required CI is not under test: the wait completes at once (the real wait re-binds to the new head)
E.externalHandlers["github-ci"] = (_x, _d, wake) => { queueMicrotask(() => wake({ outcome: "ok" })); return () => {}; };
const TERMINAL = ["failed", "cancelled", "succeeded"];
const card = async (run: string, node: string, ms = 20000) => { await until(() => E.cards.list({ run, open: true }).some(c => c.node === node) || TERMINAL.includes(E.get(run)!.status), ms); return E.cards.list({ run, open: true }).find(c => c.node === node); };
const answer = async (run: string, node: string, choice: string) => { const c = await card(run, node); if (!c) throw new Error(`no ${node} card on ${run}: ${E.get(run)!.status} ${E.get(run)!.error} ${JSON.stringify(E.cards.list({ run, open: true }).map(k => [k.node, k.title.en, k.body.slice(0, 200)]))}`); await E.answer(c.id, { choice, by: "fixture captain" }); };
const start = async (file: string) => { const r = E.start({ workflow: "remote-code", text: `STUB_REMOTE file:${file}`, params: { project: "remote-fixture", file } }); await answer(r.id, "dispatch", "dispatch"); await card(r.id, "hold"); return r; };
const ledger = (run: string, record: string) => E.trusted(run).entries.filter(e => e.record === record);
try {
  // 1. The base moves on GitHub: the next round fetches it, rebases, and pushes the Task branch only, with its lease.
  const a = await start("a.txt"), aPr = E.get(a.id)!.ctx.pr, branch = `crew/${a.id}`;
  ok(!!aPr && bareRef(`refs/heads/${branch}`) === aPr.head, "round 1 publishes the Task branch and opens its PR", JSON.stringify({ aPr, status: E.get(a.id)!.status, error: E.get(a.id)!.error }));
  const moved = remoteCommit("main", "base.txt", "the base moved\n"), before = refs().filter(r => !r.startsWith(`refs/heads/${branch} `));
  await answer(a.id, "hold", "again"); await card(a.id, "hold");
  const ra = E.get(a.id)!, rebase: any = ledger(a.id, "remote-rebase").at(-1), push: any = ledger(a.id, "remote-push").at(-1), head = bareRef(`refs/heads/${branch}`);
  ok(rebase?.data?.toBase === moved && rebase.data.lease === aPr.head && rebase.data.fromBase !== moved, "round 2 rebased onto the fetched GitHub base and recorded the rebase with its lease in the signed ledger", JSON.stringify(rebase?.data));
  ok(push?.data?.branch === branch && push.data.lease === aPr.head && push.data.from === aPr.head && push.data.to === head && push.data.rewritten === true && ra.ctx.pr.head === head, "the rebased head was pushed to the Task branch with --force-with-lease on the last pushed head, and recorded", JSON.stringify({ push: push?.data, head, pr: ra.ctx.pr.head }));
  ok(must(bare, ["merge-base", "--is-ancestor", moved, head]) === "" && bareRef("refs/heads/main") === moved && JSON.stringify(refs().filter(r => !r.startsWith(`refs/heads/${branch} `))) === JSON.stringify(before), "the Task branch now contains the new base; main and every other ref are untouched", JSON.stringify(refs()));
  const aStart: any = E.trusted(a.id).entries.filter(e => e.record === "round-start" && e.node === "build").at(-1)?.data;
  ok(aStart?.baseRefresh?.baseAfter === moved && aStart.baseRefresh.conflicts.length === 0 && /^BUILD ROUND\nRun .* · round 2 · head [0-9a-f]{40}/.test(briefs.get(a.id)?.[1] ?? "") && (briefs.get(a.id)?.[1] ?? "").includes(`head ${rebase?.data?.headAfter}`), "the round-start record carries the remote rebase and the round's brief is bound to the rebased head", JSON.stringify({ aStart, brief: (briefs.get(a.id)?.[1] ?? "").slice(0, 160) }));
  ok(E.trusted(a.id).ok, "the signed ledger verifies");
  await answer(a.id, "hold", "stop");

  // 2. A conflicting base change: the brief lists it, the worker resolves it, the resolved rebase is pushed.
  const b = await start("c.txt"), bBranch = `crew/${b.id}`;
  const conflictingBase = remoteCommit("main", "c.txt", "the base wrote this file too\n");
  await answer(b.id, "hold", "again"); await card(b.id, "hold");
  const bBrief = briefs.get(b.id)?.[1] ?? "", bHead = bareRef(`refs/heads/${bBranch}`);
  ok(/^BUILD ROUND\nRun .*\nREBASE CONFLICTS/m.test(bBrief) && /^- c\.txt$/m.test(bBrief), "a conflicting base change opens the round with REBASE CONFLICTS", bBrief.slice(0, 400));
  ok(must(bare, ["merge-base", "--is-ancestor", conflictingBase, bHead]) === "" && must(bare, ["show", `${bHead}:c.txt`]) === `# resolved by ${b.id}` && E.get(b.id)!.ctx.pr.head === bHead, "the worker's resolution is pushed on top of the new base", JSON.stringify({ bHead }));
  await answer(b.id, "hold", "stop");

  // 3. Someone else pushes to the Task branch during the round: the lease refuses, nothing is overwritten, a clear card stops it.
  const c = await start("d.txt"), cBranch = `crew/${c.id}`; foreignFor = c.id;
  remoteCommit("main", "base2.txt", "the base moved again\n");
  await answer(c.id, "hold", "again");
  await until(() => E.cards.list({ run: c.id, open: true }).some(k => k.node === "pr-open") || TERMINAL.includes(E.get(c.id)!.status), 20000);
  const stop = E.cards.list({ run: c.id, open: true }).find(k => k.node === "pr-open");
  ok(!!stop && /someone else pushed/.test(stop.body) && /did not overwrite/.test(stop.body) && bareRef(`refs/heads/${cBranch}`) === foreignPush.get(c.id) && !ledger(c.id, "remote-push").length, "a push by someone else is never overwritten: the lease refuses and a card says why", JSON.stringify({ card: stop && [stop.title.en, stop.body.slice(0, 300)], branch: bareRef(`refs/heads/${cBranch}`), foreign: foreignPush.get(c.id) }));
  E.cancel(c.id);

  // 4. Someone pushed before the round started: the round does not rebase or push at all.
  const d = await start("e.txt"), dBranch = `crew/${d.id}`, dRebases = ledger(d.id, "remote-rebase").length, foreign = remoteCommit(dBranch, "foreign.txt", "pushed before the round\n");
  await answer(d.id, "hold", "again");
  await until(() => E.cards.list({ run: d.id, open: true }).some(k => k.node === "build" || k.node === "scope-card") || TERMINAL.includes(E.get(d.id)!.status), 20000);
  ok(bareRef(`refs/heads/${dBranch}`) === foreign && ledger(d.id, "remote-rebase").length === dRebases && !ledger(d.id, "remote-push").length && E.cards.list({ run: d.id, open: true }).length > 0 && (briefs.get(d.id)?.length ?? 0) === 1 && E.cards.list({ run: d.id, open: true }).some(k => /did not rebase or push anything/.test(k.body)), "a foreign push before the round stops it on a card without rebasing or pushing", JSON.stringify({ cards: E.cards.list({ run: d.id, open: true }).map(k => [k.node, k.title.en, k.body.slice(0, 200)]), branch: bareRef(`refs/heads/${dBranch}`), foreign, rebases: ledger(d.id, "remote-rebase").length, pushes: ledger(d.id, "remote-push").length, briefs: briefs.get(d.id)?.length }));
  E.cancel(d.id);
  await until(() => [...agents.jobs.values()].every(j => j.status !== "running"));
} finally { server.stop(true); sim.stop(); }
end();
