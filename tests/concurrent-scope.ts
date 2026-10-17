import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Overlapping scopes never hold a Task back. Tasks on one project build at the
// same time; each build round starts on the current base; a moved base at the
// merge sends the Task to a rebase round; conflicts go to the worker, never to
// the captain; declared dependencies still wait for a verified merge.
// Real native callers, signed captain answers and a temporary repository.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agents } from "../src/agent";
import { Projects } from "../src/doors";
import { installCode } from "../src/domain/code";
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
const started: string[] = [], briefs = new Map<string, string[]>(), leftMarkers = new Set<string>();
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
        for (const m of text.matchAll(/^- (\S+)$/gm)) await call("fs_write", { path: m[1], content: m[1] === "marked.txt" && !leftMarkers.has(id) ? (leftMarkers.add(id), `<<<<<<< ours\n# ${id}\n=======\n# other\n>>>>>>> theirs\n`) : `# resolved by ${id}\n` });
      }
      if (/ · round 1 · /.test(text)) await call("fs_write", { path: file, content: `# ${id} wrote ${file}\n` });
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
  { id: "merge", kind: "hook", do: "git.merge", label: "Merge", x: 5, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 6, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 6, y: 1 }],
  edges: [{ from: "prepare", to: "spec" }, { from: "spec", to: "dispatch" }, { from: "dispatch", to: "build", when: "dispatch" }, { from: "build", to: "build", when: "rebase-more" }, { from: "build", to: "merge-card", when: "ok" }, { from: "merge-card", to: "merge", when: "merge" }, { from: "merge-card", to: "closed", when: "close" }, { from: "merge", to: "build", when: "rebase" }, { from: "merge", to: "done" }] };
const defs = new WorkflowDefs(data, () => [Y(code)]);
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
await answer(d.id, "merge-card", "merge"); await until(() => builds(d.id) === 2, 15000); await card(d.id, "merge-card");
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
