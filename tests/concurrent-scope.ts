import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Overlapping scopes never hold a Task back. Tasks on one project build at the
// same time; each build round starts on the current base; a moved base at the
// merge sends the Task to a rebase round; conflicts go to the worker, never to
// the captain; declared dependencies still wait for a verified merge.
// Real native callers, signed captain answers and a temporary repository.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agents } from "../src/agent";
import { Projects } from "../src/doors";
import { baseMovedSince, installCode } from "../src/domain/code";
import { Worktrees } from "../src/worktrees";
import { Engine } from "../src/runtime/engine";
import { WorkflowDefs } from "../src/runtime/defs";
import { StudioLog } from "../src/rawlog";
import { suite, until, Y } from "./rt-harness";
const { ok, end } = suite("concurrent-scope");
const data = checkedTempDir("crew-concurrent-scope-");
let port = 0; const agents = new Agents(data, () => `http://127.0.0.1:${port}`);
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async req => { const t = req.headers.get("x-crew-tool-token") ?? "", u = new URL(req.url);
  if (u.pathname === "/api/tools") return Response.json(agents.toolList(t));
  return Response.json(await agents.callTool(t, decodeURIComponent(u.pathname.slice("/api/tools/".length)), await req.json())); } }); port = server.port;
const started: string[] = [], briefs = new Map<string, string[]>(), leftMarkers = new Set<string>(); let notesWriter = "";
let running = 0, maxRunning = 0, gate: Promise<void> = Promise.resolve();
const provider: any = { id: "fixture", model: "strict-local", sandboxFree: true, start(_system: string, tools: any[], ctx: any) { return { interrupt() {}, async *send(text: string) {
  const id = /Run (R-\d+)/.exec(text)?.[1] ?? "?";
  const call = async (name: string, args: any) => { const r = await fetch(`${ctx.studioUrl}/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify(args) }); const v = await r.json(); if (v.error) throw new Error(v.error); return v; };
  const file = /file:([^\s]+)/.exec(text)?.[1] ?? "README.md";
  if (tools.some(t => t.name === "spec_write")) await call("spec_write", { title: "Concurrent fixture", what: "Write a fixture file", why: ["Exercise concurrent scopes"], done: ["tests/concurrent-scope.ts fails on base"], scope: [/scope:([^\s]+)/.exec(text)?.[1] ?? file], door: { kind: "two-way", reason: "Local fixture" }, explain: { en: "Write one file", "zh-TW": "寫入一個檔案" }, zh: { title: "並行範圍測試", why: ["驗證並行開發"] } });
  else if (tools.some(t => t.name === "worker_report")) {
    started.push(id); briefs.set(id, [...(briefs.get(id) ?? []), text]); running++; maxRunning = Math.max(maxRunning, running);
    try {
      await gate;
      if (/^REBASE CONFLICTS/m.test(text)) { // resolve every listed file first, as the brief asks
        // marked.txt: the first resolving round leaves the conflict markers in, as a careless worker would
        // stuck.txt: never resolved, every round leaves the markers. A binary conflict line carries
        // "(binary: …)" after the path, so it is not matched here: the worker cannot pick a side.
        for (const m of text.matchAll(/^- (\S+)$/gm)) await call("fs_write", { path: m[1], content: m[1] === "stuck.txt" || m[1] === "marked.txt" && !leftMarkers.has(id) ? (leftMarkers.add(id), `<<<<<<< ours\n# ${id}\n=======\n# other\n>>>>>>> theirs\n`) : `# resolved by ${id}\n` });
      }
      // a binary file: the fs tools edit text only, so the fixture writes it into the worktree directly (Studio commits it as the round's work)
      if (/ · round 1 · /.test(text)) { if (file.endsWith(".dat")) writeFileSync(join(E.get(id)!.ctx.worktree, file), Buffer.from(`\0${id}\0binary\n`)); else await call("fs_write", { path: file, content: `# ${id} wrote ${file}\n` }); }
      // a Markdown setext heading (a lone ======= line) beside the change: auto-merged, never a conflict
      if (/ · round 1 · /.test(text) && file === "s/setext.txt" && id === notesWriter) await call("fs_write", { path: "s/notes.md", content: `Notes by ${id}\n=======\n\nPlain text.\n` });
      await call("worker_report", { marker: "WORKER_COMPLETE", summary: "Wrote the approved fixture file" });
    } finally { running--; }
  }
  yield { type: "turnEnd", status: "ok" };
} }; } };
const code = { id: "concurrent-code", name: "Concurrent scope fixture", version: 1, roles: [{ id: "coordinator", label: "Coordinator", skill: "test" }, { id: "worker", label: "Worker", skill: "test" }], params: { project: { label: "Project" }, repo: { label: "Repo" }, depends_on: { label: "Dependencies" }, file: { label: "File" }, scope: { label: "Scope" } }, nodes: [
  { id: "prepare", kind: "hook", do: "repo.prepare", label: "Prepare", x: 0, y: 0 }, { id: "spec", kind: "agent", role: "coordinator", mode: "spec", label: "Spec", x: 1, y: 0 },
  { id: "dispatch", kind: "card", label: "Dispatch", args: { card_kind: "dispatch" }, card: { title: "Approve fixture scope", body: "Review the fixture scope", options: [{ id: "dispatch", label: "Dispatch" }] }, x: 2, y: 0 },
  { id: "build", kind: "agent", role: "worker", mode: "build", label: "Build", x: 3, y: 0 },
  { id: "merge-card", kind: "card", label: "Merge", args: { card_kind: "merge" }, card: { title: "Merge checked fixture", body: "Merge only the pinned local fixture", options: [{ id: "merge", label: "Merge" }, { id: "close", label: "Close" }] }, x: 4, y: 0 },
  { id: "scope-card", kind: "card", label: "Scope", args: { card_kind: "scope" }, card: { title: "Worker blocked", body: "The worker or Studio blocked the round", options: [{ id: "rescope", label: "Rescope" }, { id: "park", label: "Park" }] }, x: 4, y: 1 }, { id: "parked", kind: "hook", label: "Parked", args: { result: "parked" }, x: 5, y: 1 },
  { id: "merge", kind: "hook", do: "git.merge", label: "Merge", x: 5, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 6, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 6, y: 1 }],
  edges: [{ from: "prepare", to: "spec" }, { from: "spec", to: "dispatch" }, { from: "dispatch", to: "build", when: "dispatch" }, { from: "build", to: "build", when: "rebase-more" }, { from: "build", to: "merge-card", when: "ok" }, { from: "build", to: "scope-card", when: "blocked" }, { from: "scope-card", to: "parked", when: "park" }, { from: "scope-card", to: "spec", when: "rescope" }, { from: "merge-card", to: "merge", when: "merge" }, { from: "merge-card", to: "closed", when: "close" }, { from: "merge", to: "build", when: "rebase" }, { from: "merge", to: "done" }] };
const defs = new WorkflowDefs(data, () => [Y(code)]);
// what each dependency install saw: the worktree head and its bun.lock (no real install runs)
const installs: { path: string; head: string; lock: string | null }[] = [];
Worktrees.prototype.installDeps = async function (r: any) { installs.push({ path: r.path, head: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: r.path, stdout: "pipe" }).stdout.toString().trim(), lock: existsSync(join(r.path, "bun.lock")) ? readFileSync(join(r.path, "bun.lock"), "utf8") : null }); return { ran: null, ok: true, detail: "fixture: install recorded" } as any; };
const E = new Engine({ dataDir: data, agents, provider: () => provider, defaultProvider: () => ({ provider: "fixture", model: "strict-local" }), log: new StudioLog(join(data, "events.jsonl")), send() {}, skillText: () => "# Fixture skill" }, defs);
const projects = new Projects(data);
installCode(E, { dataDir: data, projects }); E.modes.spec.prompt = x => `Run ${x.run.id} file:${x.run.params.file} scope:${x.run.params.scope || x.run.params.file}`;
const repo = join(data, "fixture-repo"); mkdirSync(repo);
const git = (args: string[]) => { const r = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" }); if (r.exitCode !== 0) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
git(["init", "-q", "-b", "main"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]); writeFileSync(join(repo, "README.md"), "# Initial\n"); git(["add", "README.md"]); git(["commit", "-qm", "Initial"]); projects.add({ id: "concurrent-fixture", path: repo });
const TERMINAL = ["failed", "cancelled", "succeeded"];
const startCode = (file: string, scope = file, depends: string[] = []) => E.start({ workflow: "concurrent-code", text: `STUB_CONCURRENT file:${file}`, params: { project: "concurrent-fixture", file, scope, depends_on: JSON.stringify(depends) } });
const card = async (id: string, node: string) => { await until(() => E.cards.list({ run: id, open: true }).some(c => c.node === node) || TERMINAL.includes(E.get(id)!.status), 15000); return E.cards.list({ run: id, open: true }).find(c => c.node === node); };
const answer = async (id: string, node: string, choice: string) => { const c = await card(id, node); if (!c) throw new Error(`missing ${node} card on ${id}: ${E.get(id)!.status} ${E.get(id)!.error}`); await E.answer(c.id, { choice, by: "fixture captain" }); };
const builds = (id: string) => started.filter(s => s === id).length;
const merged = (id: string) => until(() => TERMINAL.includes(E.get(id)!.status), 15000);
const onlyRoutineCards = (id: string) => E.cards.list({ run: id }).every(c => c.node === "dispatch" || c.node === "merge-card");
const mainHas = (file: string) => git(["show", `main:${file}`]);

// 1. Two Tasks with the same scope both start and run at the same time.
let open!: () => void; gate = new Promise<void>(r => { open = r; });
const a = startCode("shared.txt"), b = startCode("shared.txt");
await answer(a.id, "dispatch", "dispatch"); await answer(b.id, "dispatch", "dispatch");
await until(() => running === 2, 10000);
ok(maxRunning === 2 && builds(a.id) === 1 && builds(b.id) === 1, "overlapping scope: both Tasks' workers run concurrently", `max ${maxRunning} status ${E.get(b.id)!.status} ${E.get(b.id)!.nodes.build?.data?.nativeQueue?.reason ?? ""}`);
open(); gate = Promise.resolve();
await card(a.id, "merge-card"); await card(b.id, "merge-card");
// 2. The first merges; the second's merge finds the base moved and goes to a
// rebase round whose brief opens with REBASE CONFLICTS; the stub worker resolves.
await answer(a.id, "merge-card", "merge"); await merged(a.id);
ok(E.get(a.id)!.status === "succeeded" && E.verifiedMerge(E.get(a.id)!), "first overlapping Task merges");
await answer(b.id, "merge-card", "merge");
await until(() => builds(b.id) === 2, 15000); await card(b.id, "merge-card");
const conflictBrief = briefs.get(b.id)?.[1] ?? "";
ok(/^BUILD ROUND\nRun .*\nREBASE CONFLICTS/.test(conflictBrief) && /^- shared\.txt$/m.test(conflictBrief) && /base side: \w{7,} /.test(conflictBrief) && /task side: \w{7,} /.test(conflictBrief), "conflicting rebase round brief starts with REBASE CONFLICTS right after its header: the file and both sides' commits", conflictBrief.slice(0, 400));
const refresh: any = E.trusted(b.id).entries.filter(e => e.record === "round-start").at(-1)?.data?.baseRefresh;
ok(!!refresh && refresh.baseAfter === git(["rev-parse", "main"]) && refresh.baseBefore !== refresh.baseAfter && refresh.conflicts?.[0]?.path === "shared.txt", "round record carries base before/after and the conflicting files", JSON.stringify(refresh));
await answer(b.id, "merge-card", "merge"); await merged(b.id);
ok(E.get(b.id)!.status === "succeeded" && E.verifiedMerge(E.get(b.id)!) && mainHas("shared.txt") === `# resolved by ${b.id}`, "worker-resolved Task merges on top of the first", `${E.get(b.id)!.status} ${E.get(b.id)!.error}`);
ok(onlyRoutineCards(a.id) && onlyRoutineCards(b.id), "no captain card is raised for overlap or conflicts", JSON.stringify(E.cards.list({ run: b.id }).map(c => c.node)));

// 3. Overlapping scope, different files: the second merges after a clean rebase round.
const c = startCode("docs/c.txt", "docs"), d = startCode("docs/d.txt", "docs");
await answer(c.id, "dispatch", "dispatch"); await answer(d.id, "dispatch", "dispatch");
await card(c.id, "merge-card"); await card(d.id, "merge-card");
await answer(c.id, "merge-card", "merge"); await merged(c.id);
// the base also changes its lockfile: the rebase round's install must see the rebased tree, not the old head
writeFileSync(join(repo, "bun.lock"), "lockfile v2\n"); git(["add", "bun.lock"]); git(["commit", "-qm", "Bump the lockfile"]);
await answer(d.id, "merge-card", "merge"); await until(() => builds(d.id) === 2, 15000); await card(d.id, "merge-card");
const dInstall = installs.filter(i => i.path === E.get(d.id)!.ctx.worktree).at(-1);
ok(dInstall?.lock === "lockfile v2\n" && dInstall.head === E.trusted(d.id).entries.filter(e => e.record === "round-start").at(-1)?.data?.baseRefresh?.headAfter, "the round rebases before installing dependencies: the install sees the base's new lockfile", JSON.stringify(dInstall));
const cleanRefresh: any = E.trusted(d.id).entries.filter(e => e.record === "round-start").at(-1)?.data?.baseRefresh;
ok(!!cleanRefresh && cleanRefresh.conflicts.length === 0 && !/^REBASE CONFLICTS/m.test(briefs.get(d.id)![1]), "clean rebase round lists no conflicts", JSON.stringify(cleanRefresh));
await answer(d.id, "merge-card", "merge"); await merged(d.id);
ok(E.verifiedMerge(E.get(d.id)!) && mainHas("docs/c.txt").includes(c.id) && mainHas("docs/d.txt").includes(d.id), "second Task merges after rebasing at its next round; main has both changes");

// 3b. A resolution that still carries conflict markers is never committed: the
// rebase stays pending, the next round lists the file again, and only a clean
// resolution continues the rebase.
const e = startCode("marked.txt"), f = startCode("marked.txt");
await answer(e.id, "dispatch", "dispatch"); await answer(f.id, "dispatch", "dispatch");
await card(e.id, "merge-card"); await card(f.id, "merge-card");
await answer(e.id, "merge-card", "merge"); await merged(e.id);
await answer(f.id, "merge-card", "merge"); await until(() => builds(f.id) === 3, 15000); await card(f.id, "merge-card");
const fBriefs = briefs.get(f.id) ?? [];
ok(leftMarkers.has(f.id) && /^REBASE CONFLICTS/m.test(fBriefs[1] ?? "") && /^REBASE CONFLICTS/m.test(fBriefs[2] ?? "") && /^- marked\.txt$/m.test(fBriefs[2] ?? ""), "a round that leaves conflict markers keeps the rebase pending and the next round lists the file again", JSON.stringify(fBriefs.map(b => b.slice(0, 120))));
await answer(f.id, "merge-card", "merge"); await merged(f.id);
const markedMain = mainHas("marked.txt");
ok(E.verifiedMerge(E.get(f.id)!) && markedMain === `# resolved by ${f.id}` && !/^(<{7}|={7}|>{7})/m.test(git(["log", "-p", "main", "--", "marked.txt"])), "no commit on main ever carried the conflict markers", markedMain);

// 3c. A lone ======= line (a Markdown setext underline) in an auto-merged file is not a
// conflict marker: only unmerged files are checked, for a full ordered block.
const g = startCode("s/setext.txt", "s"), hh = startCode("s/setext.txt", "s"); notesWriter = hh.id; // only the second Task adds the Markdown file, so it is auto-merged (staged), never a conflict
await answer(g.id, "dispatch", "dispatch"); await answer(hh.id, "dispatch", "dispatch");
await card(g.id, "merge-card"); await card(hh.id, "merge-card");
await answer(g.id, "merge-card", "merge"); await merged(g.id);
await answer(hh.id, "merge-card", "merge"); await until(() => builds(hh.id) === 2, 15000); await card(hh.id, "merge-card");
ok(builds(hh.id) === 2 && !E.cards.list({ run: hh.id, open: true }).some(c => c.node === "scope-card"), "a setext ======= line in a file beside a real conflict does not keep the rebase pending", JSON.stringify(briefs.get(hh.id)?.map(b => b.slice(0, 100))));
await answer(hh.id, "merge-card", "merge"); await merged(hh.id);
ok(E.verifiedMerge(E.get(hh.id)!) && mainHas("s/setext.txt") === `# resolved by ${hh.id}`, "the rebase completed in one resolving round and merged");

// 3d. A rebase that makes no progress goes to the captain after round_cap rounds, not round after round.
const i1 = startCode("stuck.txt"), i2 = startCode("stuck.txt");
await answer(i1.id, "dispatch", "dispatch"); await answer(i2.id, "dispatch", "dispatch");
await card(i1.id, "merge-card"); await card(i2.id, "merge-card");
await answer(i1.id, "merge-card", "merge"); await merged(i1.id);
await answer(i2.id, "merge-card", "merge"); const stuckCard = await card(i2.id, "scope-card");
const stuckReport = E.get(i2.id)!.nodes.build.data.report;
ok(!!stuckCard && builds(i2.id) === 4 && stuckReport?.marker === "SCOPE-BLOCKED" && /no progress in 3 rounds: stuck\.txt/.test(stuckReport.summary) && /The rebase was aborted; the next build round rebases again\./.test(stuckReport.summary) && stuckReport.conflicts?.[0]?.path === "stuck.txt", "three rounds that leave the same conflict go to the scope card with a report that keeps the conflict list", JSON.stringify({ builds: builds(i2.id), stuckReport }));
/** The scope card's rescope runs a spec round (read-only): it must start, on a worktree with no rebase in progress. */
const rebaseState = (run: string) => { const wt = E.get(run)!.ctx.worktree, gitPath = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"], { cwd: wt, stdout: "pipe" }).stdout.toString().trim(); return { record: !!new Worktrees(data).get("concurrent-fixture", run)?.nativeRebase, dir: existsSync(gitPath), head: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: wt, stdout: "pipe" }).stdout.toString().trim() }; };
const rescoped = async (run: string) => { await answer(run, "scope-card", "rescope"); const d = await card(run, "dispatch"); return { dispatch: !!d, report: E.get(run)!.nodes.spec?.data?.report ?? null, status: E.get(run)!.status, ...rebaseState(run) }; };
const i2After = await rescoped(i2.id);
ok(i2After.dispatch && i2After.report?.marker !== "BLOCKED" && !i2After.record && !i2After.dir && i2After.head === E.get(i2.id)!.ctx.head, "rescope after a stalled rebase runs the spec round on a clean worktree (rebase aborted, no RoundBlocked)", JSON.stringify(i2After));
E.cancel(i2.id);

// 3e. A binary conflict is never resolved automatically (that would drop one side): the brief
// lists it as binary with both sides, the rebase is aborted (the Task keeps its own blob) and the captain decides.
const j1 = startCode("asset.dat"), j2 = startCode("asset.dat");
await answer(j1.id, "dispatch", "dispatch"); await answer(j2.id, "dispatch", "dispatch");
await card(j1.id, "merge-card"); await card(j2.id, "merge-card");
await answer(j1.id, "merge-card", "merge"); await merged(j1.id);
await answer(j2.id, "merge-card", "merge"); const binaryCard = await card(j2.id, "scope-card");
const binaryBrief = briefs.get(j2.id)?.[1] ?? "", binaryReport = E.get(j2.id)!.nodes.build.data.report, j2Rec = new Worktrees(data).get("concurrent-fixture", j2.id);
ok(/^- asset\.dat \(binary: base side [0-9a-f]{12}, task side [0-9a-f]{12}\)$/m.test(binaryBrief) && /cannot be resolved with the fs tools/.test(binaryBrief), "the brief lists the binary conflict with both sides' blobs", binaryBrief.slice(0, 600));
const j2Blob = Bun.spawnSync(["git", "show", `${E.get(j2.id)!.ctx.head}:asset.dat`], { cwd: repo, stdout: "pipe" }).stdout.toString();
ok(!!binaryCard && binaryReport?.marker === "SCOPE-BLOCKED" && /binary rebase conflict: asset\.dat/.test(binaryReport.summary) && binaryReport.conflicts?.[0]?.binary === true && !j2Rec?.nativeRebase && j2Blob.includes(j2.id) && builds(j2.id) === 2, "a binary conflict goes to the captain: nothing was auto-resolved, the rebase was aborted and the Task keeps its own blob", JSON.stringify({ binaryReport, rebase: j2Rec?.nativeRebase, builds: builds(j2.id) }));
ok(mainHas("asset.dat").includes(j1.id), "main keeps the first Task's binary; the second Task's blob was not overwritten by a silent resolution");
const j2After = await rescoped(j2.id);
ok(j2After.dispatch && j2After.report?.marker !== "BLOCKED" && !j2After.record && !j2After.dir, "rescope after a binary conflict runs the spec round on a clean worktree", JSON.stringify(j2After));
// cleanup of a worktree with a rebase left in progress (a crash mid-rebase, then cancel): aborted, then removed
{ const wt = E.get(j2.id)!.ctx.worktree, own = E.get(j2.id)!.ctx.head, recFile = join(data, "work", "wt", "concurrent-fixture", `${j2.id}.json`), rec = JSON.parse(readFileSync(recFile, "utf8"));
  Bun.spawnSync(["chmod", "-R", "u+w", wt]); // the spec round left the worktree read-only
  Bun.spawnSync(["git", "rebase", "--onto", "main", rec.baseCommit], { cwd: wt, stdout: "pipe", stderr: "pipe" });
  rec.nativeRebase = { version: 1, from: own, base: rec.baseCommit, target: git(["rev-parse", "main"]) }; writeFileSync(recFile, JSON.stringify(rec, null, 1));
  const midRebase = rebaseState(j2.id).dir;
  E.cancel(j2.id); await until(() => !existsSync(wt), 10000);
  ok(midRebase && !existsSync(wt) && !git(["worktree", "list"]).includes(j2.id) && git(["rev-parse", `crew/${j2.id}`]) === own, "cancelling a Task with a rebase in progress aborts it and removes the worktree; its branch keeps its own head", JSON.stringify({ midRebase, exists: existsSync(wt) })); }

// 3f. A crash after recording the rebase intent but before git started it leaves no
// rebase state: the next round clears the record and redoes the rebase.
const k1 = startCode("crash.txt"), k2 = startCode("crash-other.txt", "crash-other.txt");
await answer(k1.id, "dispatch", "dispatch"); await answer(k2.id, "dispatch", "dispatch");
await card(k1.id, "merge-card"); await card(k2.id, "merge-card");
await answer(k2.id, "merge-card", "merge"); await merged(k2.id);
{ const recFile = join(data, "work", "wt", "concurrent-fixture", `${k1.id}.json`), rec = JSON.parse(readFileSync(recFile, "utf8"));
  rec.nativeRebase = { version: 1, from: rec.head, base: rec.baseCommit, target: git(["rev-parse", "main"]) }; writeFileSync(recFile, JSON.stringify(rec, null, 1)); }
await answer(k1.id, "merge-card", "merge"); await until(() => builds(k1.id) === 2 || E.cards.list({ run: k1.id, open: true }).some(c => c.node === "scope-card") || TERMINAL.includes(E.get(k1.id)!.status), 15000);
await card(k1.id, "merge-card");
ok(builds(k1.id) === 2 && !new Worktrees(data).get("concurrent-fixture", k1.id)?.nativeRebase && E.get(k1.id)!.nodes.build.data.report?.marker !== "BLOCKED", "a rebase intent recorded before a crash is cleared and redone, not blocked forever", JSON.stringify({ builds: builds(k1.id), report: E.get(k1.id)!.nodes.build.data.report, status: E.get(k1.id)!.status }));
await answer(k1.id, "merge-card", "merge"); await merged(k1.id);
ok(E.verifiedMerge(E.get(k1.id)!) && mainHas("crash-other.txt").includes(k2.id) && mainHas("crash.txt").includes(k1.id), "the redone rebase merges on top of the other Task");

// 3g. A remote (GitHub) Task is not rebased per round (rewriting its pushed branch needs the
// captain's rebase card); each build round surfaces early that the base moved, from the last
// fetched origin ref or the local base branch. (No GitHub build-round fixture exists, so the
// detection is checked directly.)
{ const before = git(["rev-parse", "main"]);
  ok(baseMovedSince(repo, "main", before) === null, "a base that did not move is not reported");
  writeFileSync(join(repo, "moved.txt"), "base moved\n"); git(["add", "moved.txt"]); git(["commit", "-qm", "Move the base"]);
  const moved = baseMovedSince(repo, "main", before);
  ok(moved?.from === before && moved.to === git(["rev-parse", "main"]), "a moved base is reported with both commits", JSON.stringify(moved));
  git(["update-ref", "refs/remotes/origin/main", before]);
  ok(baseMovedSince(repo, "main", before) === null, "the last fetched origin ref wins over the local branch");
  git(["update-ref", "-d", "refs/remotes/origin/main"]); }

// 4. Declared dependencies still gate.
const parent = startCode("dep-parent.txt"); await answer(parent.id, "dispatch", "dispatch"); await card(parent.id, "merge-card");
const child = startCode("dep-child.txt", "dep-child.txt", [parent.id]); await answer(child.id, "dispatch", "dispatch");
await until(() => E.get(child.id)!.nodes.build?.data?.nativeQueue?.state === "waiting", 5000); await Bun.sleep(150);
ok(!builds(child.id) && String(E.get(child.id)!.nodes.build.data.nativeQueue.reason).includes(`dependency ${parent.id}`), "a declared dependency still waits for its parent's verified merge");
await answer(parent.id, "merge-card", "merge"); await merged(parent.id); await until(() => builds(child.id) === 1, 15000);
ok(builds(child.id) === 1, "the dependency's verified merge admits the child");
if (!TERMINAL.includes(E.get(child.id)!.status)) E.cancel(child.id);
await until(() => [...agents.jobs.values()].every(j => j.status !== "running"));
server.stop(true); end();
