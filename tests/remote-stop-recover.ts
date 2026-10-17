import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A stopped remote verification that a fresh check can clear (GitHub refused access, could not be reached, the policy could
// not be read) offers "Check again" beside "Close without merging": the captain's own answer re-verifies the pull request
// under the current release's rules, so a free-plan private repository (branch protection not shown) reaches the
// merge-on-GitHub card. A stop only someone's change on GitHub explains (the pull request closed) keeps close alone. An open
// card an older release raised with close as its only answer is presented again with Check again after a restart.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { RemoteMismatch, remoteStopBody, remoteStopReason, REMOTE_CHECK_LIMIT, REMOTE_BEHIND } from "../src/domain/remote-ci";
import { cardContract } from "../src/runtime/card-contract";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("remote-stop-recover");
const temp = checkedTempDir("remote-stop-"); setGitHome(join(temp, "git-home"));
const repo = join(temp, "source"), bare = join(temp, "remote.git"); mkdirSync(repo); assertTempRepo(repo);
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]); must(repo, ["remote", "add", "origin", "https://github.com/fixture/project.git"]);
must(temp, ["clone", "--bare", "-q", repo, bare]);
const baseCommit = must(repo, ["rev-parse", "HEAD"]);
const sim = githubSimulator(bare);
const PLAN = { message: "Upgrade to GitHub Pro or make this repository public to enable this feature.", documentation_url: "https://docs.github.com/rest/branches/branch-protection" };
const DENIED = { message: "Resource not accessible by integration" };
const POLICY = "/branches/main/protection/required_status_checks";
const grant: any = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-17T00:00:00Z", approvalId: "test" };
const adapter = new GitHubPrAdapter(grant, () => "fake-token", 3000);
const commit = (text: string) => { writeFileSync(join(repo, "file"), text); must(repo, ["commit", "-qam", text]); return must(repo, ["rev-parse", "HEAD"]); };
const rows = (head: string, checks: any[]) => { sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: checks.length, check_runs: checks }); sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] }); };
const green = (head: string) => [{ id: 1, name: "test", app: { id: 15368 }, head_sha: head, status: "completed", conclusion: "success" }];
const ids = (c: any) => (c?.options ?? []).map((o: any) => o.id).join();

const flow = Y({ id: "stop-flow", name: "Stop flow", roles: [], nodes: [
  { id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
  { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, x: 2, y: 0 },
  { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 3, y: 1 }],
  edges: [["seed", "pr-open"], ["pr-open", "merge-card", "ok"], ["pr-open", "closed", "close"], ["merge-card", "closed", "close"]] });
// remote readiness after the pull request is open (code-firstmate's remote-ready, where the live Task stopped); "flip" makes
// GitHub's mergeability unknown so remote-ready stops before its checks
const ready = Y({ id: "ready-flow", name: "Ready flow", roles: [], nodes: [
  { id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
  { id: "flip", kind: "hook", do: "fixture.flip", label: "Flip", x: 2, y: 0 }, { id: "remote-ready", kind: "hook", do: "remote.ready", label: "Remote readiness", x: 3, y: 0 },
  { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, x: 4, y: 0 },
  { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 5, y: 1 }],
  edges: [["seed", "pr-open"], ["pr-open", "flip", "ok"], ["pr-open", "closed", "close"], ["flip", "remote-ready"], ["remote-ready", "merge-card", "ok"], ["remote-ready", "closed", "close"], ["merge-card", "closed", "close"]] });
const install = async (data?: string, with_: GitHubPrAdapter = adapter) => {
  const H = await harness([flow, ready], data ? { data } : {}), E = H.engine;
  installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter: with_ });
  E.actions["fixture.flip"] = (x) => { sim.pulls.get(Number(x.ctx.pr.id)).mergeable = null; return "ok"; };
  E.actions["fixture.seed"] = (x) => {
    const branch = x.run.params.branch; must(repo, ["checkout", "-qb", branch, "main"]); const head = commit(branch); must(repo, ["checkout", "-q", "main"]);
    Object.assign(x.ctx, { repo, worktree: repo, base: "main", baseCommit, head, branch, door: { door: "two-way" }, spec: { title: "Stop", what: "w", why: ["y"], done: ["d"], scope: ["file"] } });
    must(repo, ["checkout", "-q", branch]); rows(head, green(head)); return "ok";
  };
  return { H, E };
};
const openCard = (E: any, r: any) => E.cards.list({ run: r.id, open: true })[0];
const settle = (E: any, r: any, not: string | null = null) => until(() => { const c = openCard(E, r); return (!!c && c.id !== not && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status); }, 15000);

try {
  // ---------- the classification: terminal stops keep close alone, every card says what Check again does ----------
  const moved = remoteStopReason(new RemoteMismatch("x"), "fallback");
  ok(ids(remoteStopBody(moved)) === "close" && ids(remoteStopBody("the Task branch crew/a on GitHub moved away from the last pushed head 12345678 (someone else pushed); Studio did not overwrite it")) === "close",
    "a closed, retargeted or moved pull request, or someone else's push, is answered by close alone (a fresh check would stop the same way)");
  const recoverable = ["GitHub could not be reached", "GitHub refused the project's GitHub access (authorization)", "remote PR or required policy could not be verified", "remote CI deadline expired", "check test did not succeed", "pending update naming target, grant or deadline changed; retained for captain recovery"];
  ok(recoverable.every((r) => ids(remoteStopBody(r)) === "check,close" && /Check again verifies/.test(remoteStopBody(r).en.how) && /重新檢查/.test(remoteStopBody(r).zh.how) && /check again or close/.test(remoteStopBody(r).title)),
    "a stop a fresh check can clear offers Check again first, and its words say what Check again does (en and zh-TW)");
  ok(recoverable.every((r) => !cardContract({ title: { en: remoteStopBody(r).title, "zh-TW": remoteStopBody(r).zhTitle }, sections: { en: remoteStopBody(r).en, "zh-TW": remoteStopBody(r).zh } as any, body: remoteStopBody(r).body, options: remoteStopBody(r).options }).length),
    "every remote-stop card keeps the card contract");
  ok(ids(remoteStopBody("GitHub could not be reached", { used: REMOTE_CHECK_LIMIT })) === "close" && /already checked again 5 times/.test(remoteStopBody("GitHub could not be reached", { used: REMOTE_CHECK_LIMIT }).en.how),
    "after the limit of checks, close is the only answer and the card says why");
  ok(ids(remoteStopBody("remote merge grant or CLEAN/non-draft state is unverified", { recover: false })) === "close", "a stop on a node with no check-again route (the merge card) keeps close alone");
  const behind = remoteStopBody(REMOTE_BEHIND);
  ok(ids(behind) === "update,check,close" && /Update the branch runs Studio's normal path/.test(behind.en.how) && /only reads GitHub/.test(behind.en.how) && /更新分支/.test(behind.zh.how) && !cardContract({ title: { en: behind.title, "zh-TW": behind.zhTitle }, sections: { en: behind.en, "zh-TW": behind.zh } as any, body: behind.body, options: behind.options }).length,
    "a pull request behind its base: Update (the normal path's write, the captain's go-ahead), Check again (read only) or close, each said");

  // ---------- recoverable: refused access, the captain checks again, the observed policy reaches merge-on-GitHub ----------
  {
    const { H, E } = await install();
    try {
      sim.expect("GET", POLICY, DENIED, undefined, 403);
      const r = E.start({ workflow: "stop-flow", text: "stop", params: { branch: "crew/denied" } }); await settle(E, r);
      const c = openCard(E, r);
      ok(c?.title.en === "GitHub refused the project's access: check again or close this task?" && ids(c) === "check,close" && c.captainOnly && /Fix the project's GitHub access first/.test(c.sections.en.how),
        "a refused policy read offers Check again and says to fix the access first", `${c?.title?.en} | ${ids(c)}`);
      let refused = ""; try { await E.answer(c.id, { choice: "check", by: "firstmate" } as any); } catch (e: any) { refused = e.message; }
      ok(/Only the captain/.test(refused) && E.cards.get(c.id).status === "open", "Firstmate cannot check again: the card stays open for the captain", refused);
      // the grant is fixed, the repository turns out to be a free-plan private one: branch protection is not shown
      sim.expect("GET", POLICY, PLAN, undefined, 403);
      await E.answer(c.id, { choice: "check", by: "captain" } as any); await settle(E, r, c.id);
      const m = openCard(E, r);
      ok(m?.title.en === `Pull request #${r.ctx.pr?.id} is open: merge it on GitHub` && m.body.includes("GitHub does not show branch protection for this private repository"),
        "Check again verifies under the current rules: the observed policy reaches the merge-on-GitHub card", `${m?.title?.en}`);
      const answers = E.trusted(r.id).entries.filter((e: any) => e.record === "card-answer" && e.data?.card === c.id);
      ok(answers.length === 1 && answers[0].data.choice === "check" && answers[0].actor === "captain" && E.trusted(r.id).entries.some((e: any) => e.record === "external-ci" && e.verdict === "pass"),
        "the captain's Check again is a signed card-answer in the ledger, and remote CI passed after it");
      await E.answer(m.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(r.status), 8000);
    } finally { H.stop(); }
  }

  // ---------- terminal after a check: the pull request was closed on GitHub, close is the only answer ----------
  {
    const { H, E } = await install();
    try {
      sim.expect("GET", POLICY, DENIED, undefined, 403);
      const r = E.start({ workflow: "stop-flow", text: "stop", params: { branch: "crew/closed" } }); await settle(E, r);
      const c = openCard(E, r); sim.pulls.get(Number(r.ctx.pr.id)).state = "closed";
      await E.answer(c.id, { choice: "check", by: "captain" } as any); await settle(E, r, c.id);
      const t = openCard(E, r);
      ok(t?.title.en === "The pull request was closed or moved on GitHub: close this task?" && ids(t) === "close", "a pull request closed on GitHub stops again with close alone", `${t?.title?.en} | ${ids(t)}`);
      await E.answer(t.id, { choice: "close", by: "captain" } as any); await until(() => ["succeeded", "failed"].includes(r.status), 8000);
      ok(r.status === "succeeded" && r.result === "closed", "close ends the Task closed", `${r.status} ${r.result} ${JSON.stringify(E.timeline(r.id).slice(-8).map((e: any) => e.summary ?? e.type))}`);
      // the answer guard itself: below the limit the captain may check again, at the limit (signed answers) it refuses
      const node = r.def.nodes.find((n: any) => n.id === "pr-open")!, x = E.x(r, node, r.nodes["pr-open"]), guard = (by = "captain") => { try { E.deps.authorizeAnswer!(r, c, { choice: "check", by } as any); return ""; } catch (e: any) { return e.message; } };
      ok(guard() === "" && /Only the captain/.test(guard("auth window W-1")), "the guard lets the captain check again below the limit and refuses an authorization window");
      for (let i = 1; i < REMOTE_CHECK_LIMIT; i++) E.record(x, "card-answer", { actor: "captain", data: { card: `SC-fixture-${i}`, kind: "step-back", choice: "check" } } as any);
      ok(/already checked again 5 times/.test(guard()), `with ${REMOTE_CHECK_LIMIT} signed Check again answers on the node the guard refuses another`, guard());
    } finally { H.stop(); }
  }

  // ---------- Check again never writes: remote-ready + a pull request behind its base + an operations grant ----------
  {
    const ops = new GitHubPrAdapter({ ...grant, operations: { version: 1, repository: "fixture/project", approvalId: "fixture-op", approvedAt: "2026-10-17T00:00:00Z", mergeMethod: "merge" } }, () => "fake-token", 3000);
    const { H, E } = await install(undefined, ops);
    try {
      sim.expect("GET", POLICY, PLAN, undefined, 403);
      const r = E.start({ workflow: "ready-flow", text: "stop", params: { branch: "crew/behind" } }); await settle(E, r);
      const c = openCard(E, r); ok(c?.node === "remote-ready" && ids(c) === "check,close", "remote-ready stops first on unknown mergeability", `${c?.node} ${ids(c)}`);
      // a reviewed head is on record, so the normal path would update the branch on GitHub
      E.record(E.x(r, r.def.nodes.find((n: any) => n.id === "remote-ready")!, r.nodes["remote-ready"]), "fixture-review", { check: "firstmate/review-verdict", verdict: "pass", head: r.ctx.pr.head, data: { binding: { head: r.ctx.pr.head, base: baseCommit } } } as any);
      Object.assign(sim.pulls.get(Number(r.ctx.pr.id)), { mergeable: true, mergeable_state: "behind" });
      const before = sim.calls.length;
      await E.answer(c.id, { choice: "check", by: "captain" } as any); await settle(E, r, c.id);
      const b = openCard(E, r);
      ok(!sim.calls.slice(before).some((k: any) => k.method !== "GET") && !E.trusted(r.id).entries.some((e: any) => e.record === "remote-update-request"), "Check again on a pull request behind its base sends no PUT, POST or push and starts no update round", JSON.stringify(sim.calls.slice(before).filter((k: any) => k.method !== "GET")));
      ok(b?.node === "remote-ready" && ids(b) === "update,check,close" && b.title.en === "The pull request is behind its base branch: update it on GitHub, check again or close this task?" && /only reads GitHub/.test(b.body),
        "it stops on a card that can still be resolved: update the branch (the normal path), check again, or close", `${b?.title?.en} | ${ids(b)}`);
      let refused = ""; try { await E.answer(b.id, { choice: "update", by: "firstmate" } as any); } catch (e: any) { refused = e.message; }
      ok(/Only the captain/.test(refused) && E.cards.get(b.id).status === "open", "only the captain gives the go-ahead to update the branch", refused);
      E.cancel(r.id); await until(() => !E.busy(r.id), 5000);
    } finally { H.stop(); }
  }

  // ---------- an older release's card (close its only answer) is presented again after a restart ----------
  {
    const first = await install(); let data = first.H.data, runId = "", oldId = "", prId = 0;
    try {
      // the pull request opens and its checks pass on the observed policy; remote-ready then stops (mergeability unknown)
      sim.expect("GET", POLICY, PLAN, undefined, 403);
      const r = first.E.start({ workflow: "ready-flow", text: "stop", params: { branch: "crew/legacy" } }); await settle(first.E, r); runId = r.id; prId = Number(r.ctx.pr?.id);
      const live = openCard(first.E, r);
      ok(live?.node === "remote-ready" && ids(live) === "check,close" && /could not be proved/.test(live.body), "a remote-ready stop GitHub can clear offers Check again", `${live?.node} ${ids(live)} ${live?.title?.en}`);
      // what the previous release wrote on the live Task (R-069): the fallback reason, close as the only answer
      const c = live; oldId = c.id;
      Object.assign(c, { title: { en: "Remote verification stopped: close this task?", "zh-TW": "遠端驗證已停止：要關閉這個任務嗎？" }, body: "Remote verification stopped: remote PR or required policy could not be verified. Nothing was merged.",
        sections: { en: { ...c.sections.en, why: "Remote verification stopped: remote PR or required policy could not be verified. Nothing was merged.", how: "Inspect the PR on GitHub, then close this task and start a fresh one if the change should go on. No merge is authorized." }, "zh-TW": c.sections["zh-TW"] },
        options: [{ id: "close", label: "Close without merging", labelZh: "不合併，關閉" }] }); first.E.cards.save(c);
    } finally { first.H.stop(); }
    sim.pulls.get(prId).mergeable = true;
    const { H, E } = await install(data);
    try {
      E.load(); const r = E.get(runId)!; await until(() => !E.busy(r.id), 5000);
      const c = openCard(E, r), old = E.cards.get(oldId);
      ok(c && c.id !== oldId && old.status === "cancelled" && old.answer == null && ids(c) === "check,close" && r.nodes["remote-ready"].card === c.id && c.title.en === "Remote verification stopped: check again or close this task?"
        && /Check again verifies/.test(c.sections.en.how) && c.sections.en.intent === old.sections.en.intent,
        "after a restart the old close-only card is replaced by one that offers Check again, and nothing is answered", `${c?.id} ${old?.status} ${ids(c)} ${c?.title?.en}`);
      ok(E.trusted(r.id).entries.some((e: any) => e.record === "card-upgraded" && e.data?.from === oldId && e.data?.to === c.id) && r.status === "waiting", "the replacement is recorded in the ledger; the Task still waits for the captain");
      await E.answer(c.id, { choice: "check", by: "captain" } as any); await settle(E, r, c.id);
      const m = openCard(E, r);
      ok(m?.title.en === `Pull request #${r.ctx.pr?.id} is open: merge it on GitHub` && E.trusted(r.id).entries.filter((e: any) => e.record === "external-ci" && e.verdict === "pass").length === 2,
        "the upgraded card's Check again verifies remote-ready and the checks afresh, and reaches the merge-on-GitHub card", m?.title?.en);
      // a second restart leaves the current card alone
      H.stop(); const again = await install(data); again.E.load(); const r2 = again.E.get(runId)!;
      ok(openCard(again.E, r2)?.id === m.id && !again.E.trusted(r2.id).entries.some((e: any) => e.record === "card-upgraded" && e.data?.from === m.id), "a card the current release raised is not replaced on the next restart");
      again.H.stop();
    } finally { H.stop(); }
  }
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { sim.stop(); }
end();
