import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Resume semantics for a hook (retro 2026-10-17 finding 30; docs/architecture.md §3.2): Studio stops after the
// pr.open hook pushed the branch and opened the pull request on GitHub (the simulator), before the hook's result was
// recorded. A fresh engine over the same data runs the hook again: it finds the open pull request for the branch
// and updates it, so there is still one pull request and one POST, and the Task goes on to remote readiness.
//   bun tests/resume-hook.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";
const { ok, end } = suite("resume-hook");
const temp = checkedTempDir("resume-hook-"), repo = join(temp, "repo"), bare = join(temp, "bare.git");
mkdirSync(repo); setGitHome(join(temp, "git"));
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]);
const head = must(repo, ["rev-parse", "HEAD"]); must(temp, ["clone", "--bare", "-q", repo, bare]);
const sim = githubSimulator(bare);
const grant: any = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "fixture" };
sim.expect("GET", "/branches/main/protection/required_status_checks", { strict: true, checks: [], contexts: [] });
sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: 0, check_runs: [] });
sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] });
const H = await harness([Y({ id: "publish", name: "Publish", roles: [], nodes: [{ id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Publish", x: 1, y: 0 },
  { id: "ready", kind: "hook", do: "remote.ready", label: "Ready", x: 2, y: 0 }], edges: [["seed", "pr-open"], ["pr-open", "ready", "ok"]] })]);
const { Engine } = await import("../src/runtime/engine");
const { Agents } = await import("../src/agent");
const seed = (E: any) => { E.actions["fixture.seed"] = (x: any) => { Object.assign(x.ctx, { repo, worktree: repo, base: "main", baseCommit: head, head, branch: "crew/task", spec: { title: "Resume publish", scope: ["file"], done: [] } }); return "ok"; }; };
// the first process: its adapter opens the pull request on GitHub, then the process stops before the hook returns
let opened = false;
class Stopping extends GitHubPrAdapter { async open(...a: Parameters<GitHubPrAdapter["open"]>) { await super.open(...a); opened = true; return new Promise<never>(() => {}); } }
const E1 = new Engine({ ...(H.engine as any).deps }, H.defs); installCode(E1, { dataDir: H.data, projects: new Projects(H.data), adapter: new Stopping(grant, () => "fake-token", 2000) } as any); seed(E1);
try {
  const run = E1.start({ workflow: "publish", text: "publish" });
  await until(() => opened, 10000);
  const posts = () => sim.calls.filter((c) => c.method === "POST" && c.path === "/pulls").length;
  ok(opened && sim.pulls.size === 1 && posts() === 1 && !E1.get(run.id)!.ctx.pr && E1.get(run.id)!.nodes["pr-open"].state === "running", "the pull request is open on GitHub, and Studio stops before the hook's result is recorded");
  // restart: a fresh engine (its own agents and adapter) over the same data
  const E2 = new Engine({ ...(H.engine as any).deps, agents: new Agents(H.data, () => H.toolUrl) }, H.defs); installCode(E2, { dataDir: H.data, projects: new Projects(H.data), adapter: new GitHubPrAdapter(grant, () => "fake-token", 2000) } as any); seed(E2);
  E2.load();
  await until(() => ["succeeded", "failed"].includes(E2.get(run.id)!.status) || E2.get(run.id)!.nodes.ready.waiting === "card", 15000);
  const back = E2.get(run.id)!;
  ok(back.steps.some((s) => s.node === "pr-open" && s.state === "interrupted"), "the interrupted hook step is marked interrupted and runs again");
  ok(sim.pulls.size === 1 && posts() === 1 && back.ctx.pr?.id === "1" && sim.head("crew/task") === head, "the hook run again finds the open pull request: still one pull request and one POST, the same branch head", JSON.stringify([sim.pulls.size, posts(), back.ctx.pr?.id]));
  ok(back.status === "succeeded" && back.ctx.remoteCI?.state === "pass", "the Task goes on to remote readiness and ends", JSON.stringify([back.status, back.error]));
} catch (e: any) { ok(false, "unexpected error", String(e?.stack ?? e).slice(0, 1200)); }
H.stop(); sim.stop(); rmSync(temp, { recursive: true, force: true }); end();
