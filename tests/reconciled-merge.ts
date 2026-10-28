import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// An ended Task whose pull request was merged on GitHub after all (R-069: under an older release the captain merged pull request #1
// on GitHub, then closed the card; the Task ended "closed without merging"). Its signed ledger cannot be rewritten: Studio reads the
// pull request again (read-only, the project's grant) on boot and when the run page asks, and a merge into the Task's base becomes one
// signed `reconciled-merge` entry; the Task reads "Merged (reconciled)". Past entries and the recorded end stay; nothing is sent to
// GitHub; a second check records nothing new; a pull request still open, closed unmerged or merged into another branch records nothing.
// Offline: the GitHub simulator, never real GitHub.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { GitHubPoller } from "../src/github-poller";
import { must, setGitHome } from "../src/git";
import { grantSignature } from "../src/github-grant";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("reconciled-merge");
const temp = checkedTempDir("reconciled-merge-"); setGitHome(join(temp, "git-home"));
const repo = join(temp, "source"), bare = join(temp, "remote.git"); mkdirSync(repo); assertTempRepo(repo);
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]); must(repo, ["remote", "add", "origin", "https://github.com/fixture/project.git"]);
must(temp, ["clone", "--bare", "-q", repo, bare]);
const sim = githubSimulator(bare);
const grant: any = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-17T00:00:00Z", approvalId: "test" };
const adapter = new GitHubPrAdapter(grant, () => "fake-token", 3000);
const commit = (text: string) => { writeFileSync(join(repo, "file"), text); must(repo, ["commit", "-qam", text]); return must(repo, ["rev-parse", "HEAD"]); };
const GATES = ["branch", "rebase", "scope", "failfirst", "ci", "approval", "design"];

// the shape of R-069's end: a review request opened on GitHub, the merge card closed by the captain, the Task ended at "closed"
const flow = Y({ id: "reconcile-flow", name: "Reconcile", roles: [], nodes: [
  { id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
  { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, card: { confirm_door: true, door_from: "door" }, x: 2, y: 0 },
  { id: "merge", kind: "hook", do: "git.merge", label: "Merge", x: 3, y: 0 },
  { id: "done", kind: "hook", label: "Merged", args: { summary: "merged {{ctx.merged.head}}" }, x: 4, y: 0 },
  { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 3, y: 1 }],
  edges: [["seed", "pr-open"], ["pr-open", "merge-card", "ok"], ["pr-open", "closed", "close"], ["merge-card", "merge", "merge"], ["merge-card", "closed", "close"], ["merge", "done"]] });
// adapter null: no injected adapter, the project's own grant is used (and gated) as in Studio
const install = async (o: { data?: string; adapter?: null } = {}) => {
  const H = await harness([flow], o.data ? { data: o.data } : {}), E = H.engine, poller = new GitHubPoller();
  installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter: o.adapter === null ? undefined : adapter, poller, mergeWatchMs: 600_000 });
  E.actions["fixture.seed"] = (x) => {
    const branch = x.run.params.branch; must(repo, ["fetch", "-q", bare, "main"]); const tip = must(repo, ["rev-parse", "FETCH_HEAD"]); must(repo, ["checkout", "-qb", branch, tip]); const head = commit(branch); must(repo, ["checkout", "-q", "main"]);
    Object.assign(x.ctx, { repo, worktree: repo, base: "main", baseCommit: tip, head, gatedHead: head, branch, door: { door: "two-way" }, spec: { title: "Reconcile", what: "w", why: ["y"], done: ["d"], scope: ["file"] } });
    for (const name of GATES) E.record(x, "fixture-gate", { check: `firstmate/gate-${name}`, head, verdict: "pass" } as any);
    sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: 1, check_runs: [{ id: 1, name: "test", app: { id: 15368 }, head_sha: head, status: "completed", conclusion: "success" }] });
    sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] }); must(repo, ["checkout", "-q", branch]); return "ok";
  };
  return { H, E, stop: () => { poller.stop(); H.stop(); } };
};
const openCard = (E: any, r: any) => E.cards.list({ run: r.id, open: true })[0];
/** a Task closed by the captain at its merge card while its pull request was open: it ends "closed without merging" */
const closedTask = async (E: any, branch: string) => {
  const r = E.start({ workflow: "reconcile-flow", text: "reconcile", params: { branch } });
  await until(() => (!!openCard(E, r) && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status), 20000);
  const c = openCard(E, r); await E.answer(c.id, { choice: "close", by: "captain" } as any);
  await until(() => ["succeeded", "failed"].includes(r.status) && !E.busy(r.id), 15000); return r;
};
/** GitHub's merge of a pull request: a merge commit on the remote only, the base moved to it, the pull request closed as merged. */
const mergeOnGitHub = (pr: number, branch: string, base = "main") => { const tip = must(bare, ["rev-parse", base]), head = must(bare, ["rev-parse", branch]);
  const sha = must(bare, ["commit-tree", `${head}^{tree}`, "-p", tip, "-p", head, "-m", "Merge pull request (GitHub)"]); must(bare, ["update-ref", `refs/heads/${base}`, sha, tip]);
  Object.assign(sim.pulls.get(pr), { state: "closed", merged: true, merge_commit_sha: sha, merged_at: "2026-10-18T01:08:19Z", closed_at: "2026-10-18T01:08:19Z", ...(base !== "main" ? { base: { ref: base } } : {}) }); return sha; };
const entries = (E: any, r: any) => E.trusted(r.id).entries;
const writes = (from: number) => sim.calls.slice(from).filter((k: any) => k.method !== "GET");
// the run state word the Board, the Runs list and the run page show (public/runstate.js)
const runState = (() => { const w: any = {}; new Function("window", "h", "T", readFileSync(join(import.meta.dir, "../public/runstate.js"), "utf8"))(w, () => null, (en: string) => en); return w.runState; })();

try {
  sim.expect("GET", "/branches/main/protection/required_status_checks", { message: "Upgrade to GitHub Pro", documentation_url: "https://docs.github.com/rest/branches/branch-protection" }, undefined, 403);
  sim.expect("GET", "", { full_name: "fixture/project", allow_merge_commit: true });
  let data = "", runId = "", sha = "", bootId = "", bootSha = "", gateId = "", gateSha = "";
  {
    const { H, E, stop } = await install(); data = H.data;
    try {
      const r = await closedTask(E, "crew/r069"); runId = r.id; const pr = Number(r.ctx.pr?.id);
      ok(r.status === "succeeded" && r.result === "closed" && r.ctx.pr?.adapter === "github" && sim.pulls.get(pr)?.state === "open" && runState(r).key === "closed",
        "the fixture ends as R-069 did: closed without merging, its pull request on GitHub", `${r.status} ${r.result} ${JSON.stringify(runState(r))}`);
      // still open on GitHub: nothing to reconcile, nothing recorded
      let before = entries(E, r).length, calls = sim.calls.length;
      let res = await E.reconcileFromGitHub!(r.id);
      ok(res.state === "not-merged" && entries(E, r).length === before && !r.reconciled && E.reconcilable!(r) && !writes(calls).length, "a pull request still open on GitHub: nothing is recorded and the Task still reads closed", JSON.stringify(res));
      // a run whose event log is sealed (corrupt, src/runtime/durable-log.ts) is never read on GitHub nor reconciled
      (E as any).sealed.set(r.id, { line: 3, message: "sealed for the test" });
      calls = sim.calls.length; res = await E.reconcileFromGitHub!(r.id);
      ok(!E.reconcilable!(r) && res.state === "skipped" && sim.calls.length === calls, "a Task with a sealed event log is not reconcilable and GitHub is not read for it", JSON.stringify(res));
      (E as any).sealed.delete(r.id);
      // the captain merged it on GitHub (as on 2026-10-18T01:08:19Z): Studio reads it and records the observation once
      sha = mergeOnGitHub(pr, r.ctx.pr.branch);
      const past = entries(E, r).map((e: any) => [e.seq, e.sig]); before = past.length; calls = sim.calls.length;
      res = await E.reconcileFromGitHub!(r.id);
      const all = entries(E, r), rec = all.filter((e: any) => e.record === "reconciled-merge");
      ok(res.state === "merged" && rec.length === 1 && all.length === before + 1 && rec[0].data?.pr === String(pr) && rec[0].data?.sha === sha && rec[0].data?.base === "main" && !!Date.parse(rec[0].data?.observedAt)
        && rec[0].data?.original?.status === "succeeded" && rec[0].data?.original?.result === "closed" && rec[0].data?.mergedAt === "2026-10-18T01:08:19Z" && !/^captain/.test(String(rec[0].actor))
        && rec[0].data?.verifiedHead === true && rec[0].data?.head === r.ctx.pr.head,
        "GitHub shows it merged into the base: one signed reconciled-merge entry with the pull request, the merge commit, when it was observed and the original end", JSON.stringify(rec));
      ok(E.trusted(r.id).ok && JSON.stringify(all.slice(0, before).map((e: any) => [e.seq, e.sig])) === JSON.stringify(past), "the earlier ledger entries are unchanged and the ledger still verifies");
      ok(r.status === "succeeded" && r.result === "closed" && !r.ctx.merged && r.reconciled?.sha === sha && r.reconciled?.ledger === rec[0].seq, "the recorded end stays closed; the Task carries the reconciled merge", JSON.stringify(r.reconciled));
      const st = runState({ ...r, merged: !!r.ctx.merged });
      ok(st.key === "reconciled" && st.en === "Merged (reconciled)" && st.tw === "已合併（事後核對）" && st.tone === "ok", "the Board and the run page read it as Merged (reconciled) / 已合併（事後核對）", JSON.stringify(st));
      ok(!writes(calls).length, "Studio only read GitHub: no write was sent", JSON.stringify(writes(calls)));
      ok(E.events(r.id).some((e: any) => e.type === "reconciled" && e.reconciled?.sha === sha) && !E.reconcilable!(r), "the run's events say it was reconciled, and the run page no longer offers the check");
      // idempotent: asked again (twice at once), nothing new is recorded
      const again = await Promise.all([E.reconcileFromGitHub!(r.id), E.reconcileFromGitHub!(r.id)]);
      ok(again.every((x: any) => x.state === "merged" && x.reconciled?.sha === sha) && entries(E, r).filter((e: any) => e.record === "reconciled-merge").length === 1, "a second check records nothing new");
      // a pull request merged into another branch is not a merge into the Task's base
      const other = await closedTask(E, "crew/elsewhere"); must(bare, ["branch", "-f", "release", "main"]);
      mergeOnGitHub(Number(other.ctx.pr.id), other.ctx.pr.branch, "release");
      const o2 = await E.reconcileFromGitHub!(other.id);
      ok(o2.state === "not-merged" && /not into main/.test(o2.reason ?? "") && !other.reconciled && !entries(E, other).some((e: any) => e.record === "reconciled-merge"), "merged into another branch: nothing is recorded", JSON.stringify(o2));
      // closed unmerged on GitHub: it was really closed
      const shut = await closedTask(E, "crew/shut"); Object.assign(sim.pulls.get(Number(shut.ctx.pr.id)), { state: "closed", merged: false, merge_commit_sha: null, closed_at: "2026-10-18T02:00:00Z" });
      ok((await E.reconcileFromGitHub!(shut.id)).state === "not-merged" && !shut.reconciled, "closed unmerged on GitHub: nothing is recorded");
      // the branch moved after Studio verified it, and GitHub merged the newer head: recorded and shown, not in the success colour
      const moved = await closedTask(E, "crew/moved"), was = moved.ctx.pr.head;
      const newer = must(bare, ["commit-tree", `${was}^{tree}`, "-p", was, "-m", "pushed after Studio's checks"]); must(bare, ["update-ref", "refs/heads/crew/moved", newer, was]);
      mergeOnGitHub(Number(moved.ctx.pr.id), "crew/moved");
      const mv = await E.reconcileFromGitHub!(moved.id), ms = runState(moved);
      ok(mv.state === "merged" && moved.reconciled?.verifiedHead === false && moved.reconciled?.head === newer && moved.reconciled?.reviewed === was
        && ms.key === "reconciled-unverified" && ms.tone === "warn" && ms.en === "Merged (reconciled, unverified head)" && /非 Studio 驗證/.test(ms.tw),
        "GitHub merged another head than the one Studio verified: recorded (verifiedHead false, both heads) and read as Merged (reconciled, unverified head), in the warning colour", JSON.stringify([moved.reconciled, ms]));
      // deleted while GitHub is read: no error, nothing recorded
      const gone = await closedTask(E, "crew/gone"); mergeOnGitHub(Number(gone.ctx.pr.id), "crew/gone");
      const reading = E.reconcileFromGitHub!(gone.id); E.remove(gone.id, gone.id);
      const gr = await reading.then((x: any) => x, (e: any) => ({ state: "threw", reason: String(e?.message ?? e) }));
      ok(gr.state === "skipped" && /deleted/.test(gr.reason ?? "") && !E.ledger(gone.id).some((e: any) => e.record === "reconciled-merge"), "a Task deleted while GitHub is read: skipped, no error, nothing recorded", JSON.stringify(gr));
      // the grant gate (checked with Studio's own adapter below)
      gateId = (await closedTask(E, "crew/gate")).id; // merged on GitHub only once the injected adapter is gone (below)
      // merged on GitHub while Studio is down: the next boot finds it
      const b = await closedTask(E, "crew/boot"); bootId = b.id; bootSha = mergeOnGitHub(Number(b.ctx.pr.id), b.ctx.pr.branch);
    } finally { stop(); }
  }
  // ---------- after a restart: the reconciled Task keeps its state; an ended Task merged meanwhile is reconciled on boot ----------
  {
    const { E, stop } = await install({ data });
    try {
      const calls = sim.calls.length;
      E.load();
      const r = E.get(runId)!, b = E.get(bootId)!;
      await until(() => !!b.reconciled, 10000);
      ok(r.reconciled?.sha === sha && r.result === "closed" && entries(E, r).filter((e: any) => e.record === "reconciled-merge").length === 1, "after a restart the reconciled Task still reads Merged (reconciled), recorded once");
      ok(b.reconciled?.sha === bootSha && b.result === "closed" && entries(E, b).filter((e: any) => e.record === "reconciled-merge").length === 1 && E.trusted(b.id).ok, "on boot Studio reads the ended Task's pull request and reconciles the merge it finds", JSON.stringify(b.reconciled));
      ok(!writes(calls).length, "the boot check only read GitHub");
    } finally { stop(); }
  }
  // ---------- the project's own grant: read only with a grant that passes the same gate as every other GitHub use ----------
  {
    process.env.CREW_GH_NO_CLI = "1"; writeFileSync(join(data, "github-token"), "fake-token"); // never the gh CLI, never real GitHub
    const local = join(temp, "granted"); must(temp, ["clone", "-q", bare, local]); assertTempRepo(local); // origin: the simulator's repository
    const project = { id: "gp", name: "gp", path: local, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null };
    const signed = (extra: any = {}) => { const gr: any = { ...grant, localPath: local }; gr.signature = grantSignature(data, project, gr); return [{ ...project, github: gr, ...extra }]; };
    const { E, stop } = await install({ data, adapter: null });
    try {
      E.load(); await Bun.sleep(500); // the boot check passes over every Task (none has a project here)
      const t = E.get(gateId)!; t.ctx.project = "gp"; // as a Task started on the registered project
      gateSha = mergeOnGitHub(Number(t.ctx.pr.id), "crew/gate");
      const tries = async (records: any, label: string, re: RegExp) => { writeFileSync(join(data, "projects.json"), JSON.stringify(records)); const calls = sim.calls.length;
        const res = await E.reconcileFromGitHub!(t.id);
        ok(res.state === "skipped" && re.test(res.reason ?? "") && sim.calls.length === calls && !t.reconciled && !E.ledger(t.id).some((e: any) => e.record === "reconciled-merge"), `${label}: GitHub is not read and nothing is recorded`, JSON.stringify(res)); };
      await tries(signed().map((p: any) => ({ ...p, github: { ...p.github, signature: "0".repeat(64) } })), "a tampered (unsigned) grant", /does not verify/);
      await tries(signed().map((p: any) => ({ ...p, github: { ...p.github, apiOrigin: "http://127.0.0.1:1" } })), "a grant edited after it was signed", /does not verify/);
      await tries(signed({ enabled: false }), "a disabled project", /disabled|no GitHub grant/);
      writeFileSync(join(data, "projects.json"), JSON.stringify(signed()));
      const res = await E.reconcileFromGitHub!(t.id);
      ok(res.state === "merged" && t.reconciled?.sha === gateSha && E.trusted(t.id).ok, "the captain's signed grant passes the gate: the merge is read and reconciled", JSON.stringify(res));
    } finally { stop(); }
  }
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { sim.stop(); }
end();
