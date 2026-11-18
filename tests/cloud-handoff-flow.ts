import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Cloud hand-off end to end, offline (docs/units/cloud-handoff.md, acceptance 1-6): a real code-firstmate Task on the
// sandbox repository, connected to an invented GitHub repository (the GitHub simulator over a bare clone), its build round
// handed to a loopback stub of the routine fire API. The attempt is on the ledger before the fire, the session id after
// it; a 429 is not retried and shows Retry-After; the Task waits(external) and is read again after a restart; the cloud's
// Handoff-Status: done is seen on GitHub; the take-back flags other branches and pull requests, checks the cloud head out
// in the worktree and runs the build checks again (the adopted edge) in the OS sandbox; a Claude-Session trailer stops the
// take-back; discard goes on from the base head.        bun tests/cloud-handoff-flow.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { ClaudeRoutineProvider } from "../src/domain/cloud-handoff";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";
import { FIXTURE_ROUTINE, FIXTURE_TOKEN, routineFireStub, sessionUrl } from "./lib/routine-fire-stub";

const { ok, end } = suite("cloud-handoff-flow");
const temp = checkedTempDir("cloud-handoff-flow-"); setGitHome(join(temp, "git-home"));
const data = join(temp, "data"); mkdirSync(data, { recursive: true });
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const repo = join(data, "demo-repo"), bare = join(temp, "money-kit.git");
must(temp, ["clone", "--bare", "-q", repo, bare]);
const sim = githubSimulator(bare, "fixture/money-kit"), fire = routineFireStub();
const grant: any = { mode: "simulator", repository: "fixture/money-kit", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "feature/", approvedAt: "2026-11-18T00:00:00Z", approvalId: "fixture" };
const def = readFileSync(join(import.meta.dir, "..", "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const make = async () => {
  const H = await harness([def], { data, checkRoots: [] });
  installCode(H.engine, { dataDir: data, projects: new Projects(data), adapter: new GitHubPrAdapter(grant, () => "fixture-token", 5000, data), cloudProvider: new ClaudeRoutineProvider(fire.origin, 3000), cloudIntervalMs: 150 });
  return H;
};
let H = await make(), E = H.engine;
E.policies.setProject("sandbox", { install: false });
const api = () => E.cloudHandoff!;
const FILES = ["STUB_LINGER",
  "STUB_FILE src/percent.ts :: export function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\nimport { percent } from "../src/percent";\\ntest("percent rounds to the cent", () => { expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
const status = (id: string) => E.get(id)!.status;
const buildLive = (id: string) => { const rn = E.get(id)!.nodes.build; return rn?.state === "running" && !rn.waiting && !!rn.job && (E.deps.agents.jobs.get(rn.job) as any)?.status === "running"; };
const startToBuild = async (text: string) => {
  const r = E.start({ workflow: "code-firstmate", text, params: {} });
  await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === "dispatch") || ["succeeded", "failed"].includes(status(r.id)), 120000);
  const card = E.cards.list({ run: r.id, open: true }).find((c) => c.kind === "dispatch");
  if (!card) throw new Error(`no dispatch card: ${status(r.id)} ${E.get(r.id)!.error}`);
  await E.answer(card.id, { choice: "dispatch", by: "captain" });
  await until(() => buildLive(r.id) || ["succeeded", "failed"].includes(status(r.id)), 120000);
  return r.id;
};
const cloudCommit = (branch: string, files: Record<string, string>, message: string) => {
  const dir = join(temp, `cloud-${Math.random().toString(36).slice(2)}`); must(temp, ["clone", "-q", bare, dir]); assertTempRepo(dir);
  must(dir, ["checkout", "-q", branch]);
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
  must(dir, ["add", "."]); must(dir, ["-c", "user.name=Cloud fixture", "-c", "user.email=cloud@example.invalid", "commit", "-qm", message]);
  must(dir, ["push", "-q", "origin", branch]); return must(dir, ["rev-parse", "HEAD"]);
};
const records = (id: string) => E.ledger(id).filter((e: any) => /^cloud-handoff-/.test(e.record ?? ""));

try {
  // ---------- before setup: refused, pointing at the Doctor ----------
  const id = await startToBuild(`Add a percent function to money-kit\n${FILES}`);
  ok(buildLive(id), "the Task's build round is running (the stub lingers)", `${status(id)} ${E.get(id)!.error}`);
  const unset = await api().preview(id);
  ok(!unset.confirm && unset.blockers.some((b: any) => b.code === "setup") && api().view(E.get(id)!)?.available === false, "no setup: the hand-off is refused and the Task page offers none");
  api().store.save({ routineId: FIXTURE_ROUTINE, token: FIXTURE_TOKEN, repos: ["fixture/elsewhere"] });
  ok((await api().preview(id)).blockers.some((b: any) => b.code === "routine-repo"), "a repository the routine is not bound to is refused (acceptance 7)");
  sim.owner.type = "Organization"; api().store.save({ repos: ["fixture/money-kit"] });
  ok((await api().preview(id)).blockers.some((b: any) => b.code === "org-policy"), "an organisation repository without cloud_handoff: allow is refused (acceptance 7)");
  E.policies.setProject("sandbox", { cloud_handoff: "allow" });
  const p1 = await api().preview(id);
  ok(!p1.blockers.length && p1.confirm?.branch === `feature/handoff/${id}-1`, "with the project policy cloud_handoff: allow it may go ahead", JSON.stringify(p1.blockers));
  const c = p1.confirm;
  ok(/instruction, not something the provider enforces/.test(c.instruction.en) && /不會強制/.test(c.instruction.zh) && /cannot|no way to estimate/i.test(c.quota.en) && !!c.sessionUrlWarning && c.after[0] === "Review request",
    "the confirm view: the branch, the honest instruction wording, no cost estimate, the sessionUrl warning, what Studio runs after", JSON.stringify(c).slice(0, 400));
  ok(c.prompt.includes(`Push your commits to ${c.branch} only`) && c.tests.every((t: string) => c.prompt.includes(t)) && c.doneLines.every((d: string) => c.prompt.includes(d)) && c.tests.length > 0, "the prompt names the branch, the test commands and the done lines the confirm view shows (acceptance 8)", JSON.stringify(c.tests));

  // ---------- a 429: one fire, no retry, Retry-After shown (acceptance 2) ----------
  fire.set({ status: 429, retryAfter: "120" });
  const f1 = await api().fire(id, { branch: c.branch, by: "captain" });
  const r1 = records(id).map((e: any) => e.record);
  ok(f1.status === 429 && f1.body.retryAfter === "120" && f1.body.retried === false && fire.calls.length === 1 && /120/.test(f1.body.error), "a 429 is reported with its Retry-After and sent once", JSON.stringify(f1));
  ok(r1.join() === "cloud-handoff-attempt,cloud-handoff-pushed,cloud-handoff-fire-failed" && buildLive(id), "the ledger: the attempt, the push, the failed fire; the local round goes on", r1.join());
  await Bun.sleep(400); ok(fire.calls.length === 1, "Studio never fires again on its own");
  const stale = await api().fire(id, { branch: c.branch, by: "captain" });
  ok(stale.status === 409 && fire.calls.length === 1, "a confirm view of the failed attempt cannot send again: the captain sees the next branch first", JSON.stringify(stale.body).slice(0, 200));

  // ---------- the hand-off (acceptance 1) ----------
  fire.set({ status: 200 });
  const p2 = await api().preview(id), branch = p2.confirm.branch, baseHead = p2.confirm.baseHead;
  const f2 = await api().fire(id, { branch, by: "captain" });
  const recs = records(id), attempt = recs.filter((e: any) => e.record === "cloud-handoff-attempt").at(-1), fired = recs.find((e: any) => e.record === "cloud-handoff-fired");
  ok(f2.status === 200 && branch === `feature/handoff/${id}-2` && sim.head(branch) === baseHead && fire.calls.length === 2, "the hand-off branch is pushed at the last committed round and the routine is fired once", JSON.stringify(f2));
  ok(!!attempt && !!fired && attempt.seq < fired.seq && attempt.data.promptSha256 && /^[a-f0-9]{64}$/.test(attempt.data.rulesHash) && attempt.data.baseHead === baseHead && fired.data.sessionId === f2.body.sessionId && fired.data.sessionUrl === sessionUrl(f2.body.sessionId),
    "the ledger: the attempt (base head, prompt hash, operating rules hash) before the fire, the session id and URL after it", JSON.stringify([attempt?.data, fired?.data]));
  ok(fire.calls[1].text === p2.confirm.prompt, "the routine got exactly the prompt the confirm view showed");
  const run = E.get(id)!;
  ok(run.status === "waiting" && run.nodes.build.waiting === "external" && E.events(id).some((e: any) => e.cause === "waiting(external)" || /waiting\(external\)/.test(JSON.stringify(e))), "the Task waits(external)", `${run.status} ${run.nodes.build.waiting}`);
  const v = api().view(run);
  ok(v.active?.sessionUrl === sessionUrl(f2.body.sessionId) && v.active.branch === branch, "the Task page shows the session link and the branch");
  ok(!JSON.stringify(E.ledger(id)).includes(FIXTURE_TOKEN), "the token is nowhere in the ledger");

  // ---------- the cloud finishes; Studio reads it after a restart (acceptance 3) ----------
  const cloudHead = cloudCommit(branch, { "src/percent.ts": "export function percent(amount: number, pct: number): number {\n  return Math.round((amount * pct) / 100);\n}\n",
    "test/percent.test.ts": 'import { expect, test } from "bun:test";\nimport { percent } from "../src/percent";\ntest("percent rounds to the cent", () => { expect(percent(1999, 15)).toBe(300); });\n' },
    "feat: percent of an amount in cents\n\nHandoff-Status: done the done line passes with bun test");
  E.disposeExternal(); H.stop();
  H = await make(); E = H.engine; E.load();
  await until(() => E.get(id)?.nodes.build.data.cloudObserved?.head === cloudHead, 10000);
  const seen = E.get(id)!.nodes.build.data.cloudObserved;
  ok(E.get(id)!.nodes.build.waiting === "external" && seen?.status === "done" && seen.commits === 1 && /done line passes/.test(seen.reason) && E.events(id).some((e: any) => e.type === "cloud_handoff_status"),
    "after a restart the wait is watched again: Handoff-Status: done and one new commit are seen on GitHub, and the captain is told", JSON.stringify(seen));
  ok((await api().reconcile(id)).observed?.head === cloudHead, "opening the board reads GitHub once more (same head)");

  // ---------- take back: post checks, then the build checks again in the sandbox (acceptance 4, 6) ----------
  const other = join(temp, "other"); must(temp, ["clone", "-q", bare, other]); assertTempRepo(other); writeFileSync(join(other, "NOTE"), "x"); must(other, ["add", "."]);
  must(other, ["-c", "user.name=Someone", "-c", "user.email=someone@example.invalid", "commit", "-qm", "note"]); must(other, ["push", "-q", "origin", "HEAD:refs/heads/feature/someone-else"]);
  sim.pulls.set(99, { number: 99, state: "open", title: "Opened from the cloud", body: "", draft: false, created_at: new Date().toISOString(), merged_at: null, html_url: "https://github.com/fixture/money-kit/pull/99", head: { ref: "feature/someone-else" }, base: { ref: "main" } });
  const tb = await api().takeBack(id, "captain");
  const classes = (tb.body.findings ?? []).map((f: any) => f.class).sort().join();
  ok(tb.status === 200 && tb.body.red === true && classes === "other-branches,pull-requests", "the take-back flags the other branch and the pull request (red)", JSON.stringify(tb.body).slice(0, 400));
  const pc = records(id).find((e: any) => e.record === "cloud-handoff-postcheck"), head = records(id).find((e: any) => e.record === "cloud-handoff-head");
  ok(pc?.verdict === "fail" && head?.data?.cloudHead === cloudHead && head.seq < pc.seq, "the ledger: the cloud head Studio took, then the failed post checks", JSON.stringify(pc?.data));
  // the edge checks run after the build step ends and before the review request starts: wait for the review request, then read them
  await until(() => (E.get(id)!.nodes["pr-open"]?.visits ?? 0) > 0 || ["failed", "succeeded"].includes(status(id)), 90000);
  const after = E.get(id)!, edgeChecks = E.ledger(id).filter((e: any) => e.head === cloudHead && e.edge && ["firstmate/scope", "firstmate/lints", "firstmate/file-size-cap", "firstmate/covering-suites", "firstmate/fixture-modules"].includes(e.check));
  ok(after.nodes.build.outcome === "adopted" && must(after.ctx.worktree, ["rev-parse", "HEAD"]) === cloudHead, "the worktree is at the cloud head and the build step ends adopted", `${after.nodes.build.state} ${after.nodes.build.outcome} ${after.ctx.head}`);
  ok((after.nodes["pr-open"]?.visits ?? 0) > 0 && edgeChecks.length === 5 && edgeChecks.every((e: any) => e.verdict === "pass" || e.verdict === "not-applicable"), "the build node's checks ran again on the cloud head (OS sandbox) before the workflow went on to the review request", JSON.stringify(edgeChecks.map((e: any) => [e.check, e.verdict, e.edge])));
  E.cancel(id, "captain", "test done"); await until(() => !E.busy(id), 30000);

  // ---------- a Claude-Session trailer stops the take-back; discard goes on from the base (acceptance 5, 6) ----------
  sim.owner.type = "User";
  const id2 = await startToBuild(`Add a percent function to money-kit\n${FILES}`);
  const q = await api().preview(id2), f3 = await api().fire(id2, { branch: q.confirm.branch, by: "captain" });
  ok(f3.status === 200 && E.get(id2)!.nodes.build.waiting === "external", "a second Task is handed off", JSON.stringify(f3.body).slice(0, 200));
  const base2 = q.confirm.baseHead, visits = E.get(id2)!.nodes.build.visits;
  cloudCommit(q.confirm.branch, { "src/percent.ts": "export const percent = (a: number, p: number) => Math.round((a * p) / 100);\n" }, `feat: percent\n\nHandoff-Status: done\nClaude-Session: ${sessionUrl("session_01FixtureLeak")}`);
  await until(() => !!E.get(id2)!.nodes.build.data.cloudObserved?.status, 10000);
  const tb2 = await api().takeBack(id2, "captain");
  ok(tb2.status === 409 && tb2.body.findings.some((f: any) => f.class === "session-trailer") && /Claude-Session/.test(tb2.body.error) && E.get(id2)!.nodes.build.waiting === "external" && E.get(id2)!.ctx.head === base2,
    "a commit with a Claude-Session trailer is caught: the take-back stops, the Task head stays at the base", JSON.stringify(tb2.body).slice(0, 300));
  const d = await api().discard(id2, "captain");
  await until(() => E.get(id2)!.nodes.build.visits > visits && E.get(id2)!.nodes.build.state === "running", 30000);
  const r2 = E.get(id2)!;
  ok(d.status === 200 && r2.ctx.head === base2 && r2.nodes.build.visits === visits + 1 && records(id2).some((e: any) => e.record === "cloud-handoff-discarded") && !!sim.head(q.confirm.branch),
    "discard: a fresh build round from the base head; the hand-off branch stays on GitHub", `${d.status} ${r2.nodes.build.state} ${r2.nodes.build.visits}`);
  E.cancel(id2, "captain", "test done"); await until(() => !E.busy(id2), 30000);
} catch (e: any) { ok(false, "unexpected error", e?.stack); }
finally { E.disposeExternal(); H.stop(); sim.stop(); fire.stop(); }
end();
