import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Merging from the board when GitHub does not show branch protection (a free private repository): with an operations grant and
// every one of Studio's own checks green at the pull request's head, the merge card offers a captain-only Merge that needs the
// acknowledgement "GitHub does not enforce required checks here; Studio verified them at <head>", and the merge PUT names that
// exact head. Without merge permission the card names what is missing and offers only the GitHub path. While any merge card is
// open, a pull request merged (or closed) on GitHub ends the Task as merged (or closed): the fact is recorded, the card
// cancelled, nothing answered for the captain, also after a restart. Offline: the GitHub simulator, never real GitHub.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPrAdapter } from "../src/adapters/github";
import { GitHubPoller } from "../src/github-poller";
import { requiredPolicy, grantIdentity } from "../src/domain/remote-ci";
import { Cards } from "../src/runtime/cards";
import { cardContract } from "../src/runtime/card-contract";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("remote-merge-board");
const OBSERVED_MERGE = "merge-observed"; // the option id (spelled out, so this file loads on a release without it and fails by assertion)
const temp = checkedTempDir("remote-merge-board-"); setGitHome(join(temp, "git-home"));
const repo = join(temp, "source"), bare = join(temp, "remote.git"); mkdirSync(repo); assertTempRepo(repo);
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]); must(repo, ["remote", "add", "origin", "https://github.com/fixture/project.git"]);
must(temp, ["clone", "--bare", "-q", repo, bare]);
const baseCommit = must(repo, ["rev-parse", "HEAD"]);
const sim = githubSimulator(bare);
const PLAN = { message: "Upgrade to GitHub Pro or make this repository public to enable this feature.", documentation_url: "https://docs.github.com/rest/branches/branch-protection" };
const POLICY = "/branches/main/protection/required_status_checks";
const grant: any = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-17T00:00:00Z", approvalId: "test" };
const operations = { version: 1, repository: "fixture/project", approvalId: "fixture-op", approvedAt: "2026-10-17T00:00:00Z", mergeMethod: "merge" };
const plain = new GitHubPrAdapter(grant, () => "fake-token", 3000);
const ops = new GitHubPrAdapter({ ...grant, operations }, () => "fake-token", 3000);
const commit = (text: string) => { writeFileSync(join(repo, "file"), text); must(repo, ["commit", "-qam", text]); return must(repo, ["rev-parse", "HEAD"]); };
const rows = (head: string) => { sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: 1, check_runs: [{ id: 1, name: "test", app: { id: 15368 }, head_sha: head, status: "completed", conclusion: "success" }] }); sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] }); };
const GATES = ["branch", "rebase", "scope", "failfirst", "ci", "approval", "design"];
const ids = (c: any) => (c?.options ?? []).map((o: any) => o.id).join();
const puts = (from: number) => sim.calls.slice(from).filter((k: any) => k.method === "PUT");

const flow = Y({ id: "board-flow", name: "Board merge", roles: [], nodes: [
  { id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
  { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, card: { confirm_door: true, door_from: "door" }, x: 2, y: 0 },
  { id: "merge", kind: "hook", do: "git.merge", label: "Merge", x: 3, y: 0 }, { id: "after", kind: "hook", do: "fixture.after", label: "After merge", x: 4, y: 0 },
  { id: "done", kind: "hook", label: "Merged", args: { summary: "merged {{ctx.merged.head}}" }, x: 4, y: 0 },
  { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 3, y: 1 }],
  edges: [["seed", "pr-open"], ["pr-open", "merge-card", "ok"], ["pr-open", "closed", "close"], ["merge-card", "merge", "merge"], ["merge-card", "closed", "close"], ["merge", "after"], ["after", "done"]] });
let dirOf: Record<string, string> = {};
const install = async (adapter: GitHubPrAdapter, o: { data?: string; gates?: string[]; watchMs?: number } = {}) => {
  const H = await harness([flow], o.data ? { data: o.data } : {}), E = H.engine, poller = new GitHubPoller();
  installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter, poller, mergeWatchMs: o.watchMs ?? 60_000 });
  E.actions["fixture.seed"] = (x) => {
    const branch = x.run.params.branch; must(repo, ["fetch", "-q", bare, "main"]); const tip = must(repo, ["rev-parse", "FETCH_HEAD"]); must(repo, ["checkout", "-qb", branch, tip]); const head = commit(branch); must(repo, ["checkout", "-q", "main"]);
    Object.assign(x.ctx, { repo, worktree: repo, base: "main", baseCommit: tip, head, gatedHead: head, branch, door: { door: "two-way" }, spec: { title: "Board", what: "w", why: ["y"], done: ["d"], scope: ["file"] } });
    for (const name of o.gates ?? GATES) E.record(x, "fixture-gate", { check: `firstmate/gate-${name}`, head, verdict: "pass" } as any);
    dirOf[branch] = x.dir; must(repo, ["checkout", "-q", branch]); rows(head); return "ok";
  };
  // after the merge, as code-firstmate's main-ci does: a worktree of the merged base (main_tree), which needs the merge commit locally
  E.actions["fixture.after"] = (x) => { const tree = E.needs.main_tree(x); x.ctx.afterTree = tree ? must(tree, ["rev-parse", "HEAD"]) : null; return "ok"; };
  return { H, E, poller, stop: () => { poller.stop(); H.stop(); } };
};
const openCard = (E: any, r: any) => E.cards.list({ run: r.id, open: true })[0];
const start = async (E: any, branch: string) => { const r = E.start({ workflow: "board-flow", text: "board merge", params: { branch } }); await until(() => (!!openCard(E, r) && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status), 20000); return r; };
const ended = (r: any) => until(() => ["succeeded", "failed"].includes(r.status), 15000);
const all = (c: any) => Array.from({ length: c?.detail?.intents?.length ?? 0 }, (_, i) => i);
const ledger = (E: any, r: any, record: string) => E.trusted(r.id).entries.filter((e: any) => e.record === record);
/** GitHub's merge of a pull request: a merge commit made on the remote only (never in the local repository), the base moved to it. */
const remoteMerge = (branch: string, base = "main") => { const tip = must(bare, ["rev-parse", base]), head = must(bare, ["rev-parse", branch]);
  const sha = must(bare, ["commit-tree", `${head}^{tree}`, "-p", tip, "-p", head, "-m", "Merge pull request (GitHub)"]); must(bare, ["update-ref", `refs/heads/${base}`, sha, tip]);
  ok(!Bun.spawnSync(["git", "-C", repo, "cat-file", "-e", `${sha}^{commit}`]).success, "the merge commit exists only on GitHub, not in the local repository"); return sha; };

try {
  sim.expect("GET", POLICY, PLAN, undefined, 403);
  sim.expect("GET", "", { full_name: "fixture/project", allow_merge_commit: true });

  // ---------- the acknowledgement on a card: carried only for its option, only with its exact id ----------
  {
    const cards = new Cards(join(temp, "cards-unit"));
    const base = { run: "R-1", node: "merge-card", visit: 1, kind: "merge" as const, title: { en: "Merge?", "zh-TW": "合併？" }, sections: { en: {} as any, "zh-TW": {} as any }, body: "b", confirmDoor: false, door: null, links: [], workflow: "w", runTitle: "t", captainOnly: true,
      options: [{ id: OBSERVED_MERGE, label: "Merge", labelZh: "合併" }, { id: "close", label: "Close", labelZh: "關閉", hold: true }], acknowledge: { option: OBSERVED_MERGE, id: "observed-merge:abc", en: "GitHub does not enforce it.", zh: "GitHub 不強制。" } };
    const refuse = (a: any) => { const c = cards.create(base as any); try { cards.answer(c.id, a); return ""; } catch (e: any) { return e.message; } };
    ok(/tick the acknowledgement first/.test(refuse({ choice: OBSERVED_MERGE, by: "captain" })) && /tick the acknowledgement first/.test(refuse({ choice: OBSERVED_MERGE, by: "captain", ack: "observed-merge:other" })),
      "Merge on an observed card without the acknowledgement, or with another one, is refused by the card itself");
    ok(/no acknowledgement to carry/.test(refuse({ choice: "close", by: "captain", ack: "observed-merge:abc" })) && refuse({ choice: "close", by: "captain" }) === "" && refuse({ choice: OBSERVED_MERGE, by: "captain", ack: "observed-merge:abc" }) === "",
      "the acknowledgement goes with its own option only; close needs none");
    ok(cardContract({ ...base, acknowledge: { ...base.acknowledge, option: "nope" } } as any).some((v) => /acknowledgement names option/.test(v)) && !cardContract(base as any).length, "the card contract checks the acknowledgement's option and words");
  }

  // ---------- no merge permission: the card says which permission is missing and where, and offers only the GitHub path ----------
  {
    const { E, stop } = await install(plain);
    try {
      const r = await start(E, "crew/no-grant"); const c = openCard(E, r);
      ok(c?.title.en === `Pull request #${r.ctx.pr?.id} is open: merge it on GitHub` && ids(c) === "close,changes" && !c.acknowledge
        && /needs the merge permission: an operations grant on that GitHub grant, for fixture\/project, with a merge method/.test(c.sections.en.why) && /Studio has no card that grants it yet/.test(c.sections.en.why)
        && c.body.includes("Missing permission: merge") && /合併權限/.test(c.sections["zh-TW"].why) && /ends this Task as merged by itself/.test(c.sections.en.how),
        "no operations grant: the card names the missing merge permission (an operations grant), says where it would come from, offers only close / request changes", `${ids(c)} | ${c?.sections?.en?.why}`);
      await E.answer(c.id, { choice: "close", by: "captain" } as any); await ended(r);
    } finally { stop(); }
  }

  // ---------- operations grant, observed policy, one of Studio's own checks missing: no Studio merge ----------
  {
    const { E, stop } = await install(ops, { gates: GATES.filter((g) => g !== "design") });
    try {
      const before = sim.calls.length, r = await start(E, "crew/unready"); const c = openCard(E, r);
      ok(c?.title.en.endsWith("merge it on GitHub") && ids(c) === "close,changes" && !c.acknowledge && /did not all pass at [0-9a-f]{8}: design/.test(c.body),
        "an observed policy with a gate missing at the head: the card stays merge-on-GitHub and says which check is missing", `${ids(c)} | ${c?.body?.slice(0, 300)}`);
      ok(!puts(before).length && !existsSync(join(dirOf["crew/unready"], "remote-merge-attempts.json")), "no PUT and no merge attempt recorded");
      await E.answer(c.id, { choice: "close", by: "captain" } as any); await ended(r);
    } finally { stop(); }
  }

  // ---------- operations grant, observed policy, every check green: Merge with the acknowledgement ----------
  {
    const { E, stop } = await install(ops);
    try {
      const r = await start(E, "crew/board"); const c = openCard(E, r), h = r.ctx.pr?.head;
      ok(ids(c) === `${OBSERVED_MERGE},close,changes` && c.options[0].label === "Merge" && c.options[1].label === "Close here (I merge on GitHub)" && c.captainOnly
        && c.acknowledge?.option === OBSERVED_MERGE && c.acknowledge.id.startsWith(`observed-merge:${h}:`) && c.acknowledge.en.includes("GitHub does not enforce required checks on fixture/project") && c.acknowledge.en.includes(`Studio verified them itself at ${h.slice(0, 12)}`) && /GitHub 不會/.test(c.acknowledge.zh),
        "every check green at the head: the card offers a captain-only Merge with the acknowledgement naming the head, and keeps 'I merge on GitHub'", `${ids(c)} | ${JSON.stringify(c?.acknowledge)}`);
      ok(E.trusted(r.id).entries.some((e: any) => e.record === "remote-merge-request" && e.data?.card === c.id && e.data?.observed === "plan" && e.head === h), "the card's merge request is signed with the observed policy");
      const before = sim.calls.length;
      const refusal = async (a: any) => { try { await E.answer(c.id, { aligned: all(c), ...a }); return ""; } catch (e: any) { return e.message; } };
      ok(/tick the acknowledgement first/.test(await refusal({ choice: OBSERVED_MERGE, by: "captain" })), "the captain's Merge without the acknowledgement is refused");
      ok(/Only the captain merges/.test(await refusal({ choice: OBSERVED_MERGE, by: "firstmate", ack: c.acknowledge?.id })), "Firstmate cannot merge, even with the acknowledgement");
      ok(/Only the captain merges/.test(await refusal({ choice: OBSERVED_MERGE, by: "auth window G-1 (granted by captain)", ack: c.acknowledge?.id })), "an authorization window cannot merge");
      ok(E.cards.get(c.id).status === "open" && !puts(before).length, "after the refusals the card is still open and nothing was sent");
      sim.expect("PUT", `/pulls/${r.ctx.pr.id}/merge`, { merged: true }, { sha: h, merge_method: "merge" });
      await E.answer(c.id, { choice: OBSERVED_MERGE, by: "captain", ack: c.acknowledge?.id, aligned: all(c) } as any).catch((e: any) => console.log("  (answer refused: " + e.message + ")")); await ended(r);
      const put = puts(before);
      ok(r.status === "succeeded" && put.length === 1 && put[0].body?.sha === h && put[0].path === `/pulls/${r.ctx.pr.id}/merge` && r.ctx.merged?.sourceHead === h && sim.head("main") === r.ctx.merged?.head,
        "the captain's acknowledged Merge sends one merge PUT naming the exact head (GitHub's sha), and the Task ends merged", `${r.status} ${JSON.stringify(put.map((p: any) => p.body))}`);
      const ack = ledger(E, r, "merge-ack")[0], merged = ledger(E, r, "merged")[0];
      ok(ack?.actor === "captain" && ack.head === h && ack.data?.policy === "observed" && ack.data?.observed === "plan" && ack.data?.card === c.id && merged?.data?.sha === r.ctx.merged?.head && merged.data?.policy === "observed",
        "the ledger carries merge-ack (captain, head, observed policy) and merged (the merge commit)", JSON.stringify({ ack, merged }));
    } finally { stop(); }
  }

  // ---------- the merge hook itself: no merge without the acknowledgement, a moved head, or a readable protection ----------
  {
    must(repo, ["fetch", "-q", bare, "main"]); const hookBase = must(repo, ["rev-parse", "FETCH_HEAD"]); must(repo, ["checkout", "-qb", "crew/hook", hookBase]); const h = commit("hook"); must(repo, ["checkout", "-q", "main"]);
    mkdirSync(join(temp, "rec-hook")); const pr = await ops.open({ repo, base: "main", branch: "crew/hook", head: h, title: "Hook", body: "b" }, join(temp, "rec-hook"));
    const observed = await requiredPolicy(ops); rows(h);
    const H3 = await harness([Y({ id: "hook", name: "Hook", roles: [], nodes: [{ id: "n", kind: "hook", do: "fixture.merge", label: "Merge", x: 0, y: 0 }], edges: [] })]), E3 = H3.engine;
    installCode(E3, { dataDir: H3.data, projects: new Projects(H3.data), adapter: ops, poller: new GitHubPoller() });
    const ackId = `observed-merge:${h}:${observed.hash.slice(0, 16)}`;
    const attempt = async (label: string, o: { choice?: string; ack?: string | null; mergeAck?: boolean; actor?: string; move?: boolean; readable?: boolean }) => {
      let message = "", dir = "";
      E3.actions["fixture.merge"] = async (x) => {
        dir = x.dir; Object.assign(x.ctx, { repo, worktree: repo, head: h, baseCommit: hookBase, base: "main", branch: pr.branch, pr, gatedHead: h, door: { door: "two-way" }, spec: { title: "Hook", what: "w", why: ["y"], done: ["d"] }, remoteCI: { state: "pass", head: h, policyHash: observed.hash, grant: grantIdentity(ops) } });
        for (const name of GATES) E3.record(x, "fixture-gate", { check: `firstmate/gate-${name}`, head: h, verdict: "pass" } as any);
        const card = `card-${label}`;
        E3.record(x, "remote-merge-request", { head: h, data: { version: 1, card, grant: grantIdentity(ops), repository: ops.grant.repository, pr: pr.id, branch: pr.branch, base: pr.base, baseHead: hookBase, head: h, method: "merge", policyHash: observed.hash, observed: "plan" } } as any);
        E3.record(x, "card-answer", { head: h, actor: o.actor ?? "captain", data: { card, kind: "merge", choice: o.choice ?? OBSERVED_MERGE, ...(o.ack === null ? {} : { ack: o.ack ?? ackId }) } } as any);
        if (o.mergeAck) E3.record(x, "merge-ack", { head: h, actor: o.actor ?? "captain", data: { version: 1, card, head: h, policy: "observed", observed: "plan", policyHash: observed.hash, ack: o.ack ?? ackId } } as any);
        must(repo, ["checkout", "-q", pr.branch]);
        if (o.readable) sim.expect("GET", POLICY, { url: "x", strict: true, contexts: [], checks: [] });
        try { await E3.actions["git.merge"](x); } catch (e: any) { message = e.message; }
        sim.expect("GET", POLICY, PLAN, undefined, 403); must(repo, ["checkout", "-q", "main"]); return "ok";
      };
      const before = sim.calls.length; const r = E3.start({ workflow: "hook" }); await until(() => ["succeeded", "failed"].includes(r.status), 15000);
      return { message, merged: !!r.ctx.merged, put: puts(before).length, locked: existsSync(join(dir, "remote-merge-attempts.json")) };
    };
    let a = await attempt("plain", { choice: "merge", ack: null });
    ok(/only observed/.test(a.message) && !a.merged && !a.put && !a.locked, "a plain Merge answer on an observed policy is refused before any attempt (no PUT, no head locked)", a.message);
    a = await attempt("no-ack", { mergeAck: false });
    ok(/acknowledgement of this observed-policy merge/.test(a.message) && !a.put && !a.locked, "a Merge answer whose merge-ack is not in the ledger is refused, nothing sent or recorded", a.message);
    a = await attempt("wrong-ack", { mergeAck: true, ack: "observed-merge:0000" });
    ok(/acknowledgement of this observed-policy merge/.test(a.message) && !a.put && !a.locked, "an acknowledgement for another head or policy is refused", a.message);
    a = await attempt("firstmate", { mergeAck: true, actor: "firstmate" });
    ok(/acknowledgement of this observed-policy merge/.test(a.message) && !a.put && !a.locked, "an answer that is not the captain's is refused at the hook too", a.message);
    a = await attempt("readable", { mergeAck: true, readable: true });
    ok(/acknowledgement no longer applies/.test(a.message) && !a.put && !a.locked, "branch protection readable again: the observed acknowledgement no longer applies", a.message);
    // the head moves on GitHub after the acknowledgement: refused before any attempt, so the head is not locked by it
    must(repo, ["checkout", "-q", "crew/hook"]); writeFileSync(join(repo, "file"), "moved"); must(repo, ["commit", "-qam", "moved"]); const moved = must(repo, ["rev-parse", "HEAD"]); must(repo, ["push", "-q", bare, `${moved}:refs/heads/crew/hook`]); must(repo, ["reset", "-q", "--hard", h]); must(repo, ["checkout", "-q", "main"]);
    a = await attempt("moved", { mergeAck: true });
    ok(!!a.message && !a.merged && !a.put && !a.locked, "the head moved on GitHub: no merge, no PUT, no merge attempt that would lock a head", a.message);
    // the adapter's last line: an observed merge PUT names the head; GitHub refuses it when the head moved meanwhile
    must(bare, ["update-ref", "refs/heads/crew/hook", h]);
    const held = sim.holdNext("PUT", `/pulls/${pr.id}/merge`); sim.expect("PUT", `/pulls/${pr.id}/merge`, { merged: true }, { sha: h, merge_method: "merge" });
    const race = ops.mergeHead(pr, undefined, sim.head("main")!, undefined, undefined, { observed: true }).then(() => "", (e: any) => e.message);
    const started = await Promise.race([held.started.then(() => true), Bun.sleep(5000).then(() => false)]); if (!started) { held.release(); console.log("  FAIL  the observed merge PUT never started", await race); } must(bare, ["update-ref", "refs/heads/crew/hook", moved]); held.release();
    ok(/GitHub operation 409/.test(await race) && sim.pulls.get(Number(pr.id)).state === "open", "a head that moves at the PUT itself is refused by GitHub (the merge names its sha)");
    H3.stop();
  }

  // ---------- merged on GitHub while the merge-on-GitHub card is open: the Task ends merged, nothing answered ----------
  {
    const { E, stop } = await install(plain, { watchMs: 100 });
    try {
      const r = await start(E, "crew/detect"); const c = openCard(E, r), h = r.ctx.pr?.head;
      ok(c?.title.en.endsWith("merge it on GitHub"), "the merge-on-GitHub card is open", c?.title?.en);
      // GitHub says merged but names no merge commit yet: inconclusive, the card stays open and Studio reads again
      const p = sim.pulls.get(Number(r.ctx.pr.id)); Object.assign(p, { state: "closed", merged: true, merge_commit_sha: null, merged_at: "2026-10-18T01:00:00Z" });
      await Bun.sleep(600);
      ok(E.cards.get(c.id).status === "open" && r.status === "waiting" && !ledger(E, r, "detected-close").length && !ledger(E, r, "detected-merge").length, "merged without a merge commit is inconclusive: nothing settled, the card stays open", `${E.cards.get(c.id).status} ${r.status}`);
      const sha = remoteMerge(r.ctx.pr.branch); p.merge_commit_sha = sha;
      await ended(r);
      const d = ledger(E, r, "detected-merge")[0];
      ok(r.status === "succeeded" && r.ctx.merged?.head === sha && r.ctx.merged?.detected === true && E.cards.get(c.id).status === "cancelled" && E.cards.get(c.id).answer == null,
        "the pull request merged on GitHub ends the Task as merged; the stale card is cancelled, not answered", `${r.status} ${JSON.stringify(r.ctx.merged)} ${E.cards.get(c.id).status} ${JSON.stringify(Object.values(r.nodes).map((n: any) => n.error).filter(Boolean))}`);
      ok(r.ctx.afterTree === sha, "the merge commit is fetched from GitHub: the step after the merge checks out the merged base (main_tree)", String(r.ctx.afterTree));
      ok(d?.data?.sha === sha && d.data.merged === true && d.data.reviewed === h && d.data.card === c.id && !/^captain/.test(String(d.actor)) && !ledger(E, r, "card-answer").some((e: any) => e.data?.card === c.id),
        "the ledger records detected-merge with the merge commit; no card-answer exists for the card", JSON.stringify(d));
    } finally { stop(); }
  }

  // ---------- closed unmerged on GitHub: the Task ends closed ----------
  {
    const { E, stop } = await install(ops, { watchMs: 100 });
    try {
      const r = await start(E, "crew/detect-close"); const c = openCard(E, r);
      ok(ids(c).startsWith(OBSERVED_MERGE), "the Studio merge card (observed) is open", ids(c));
      Object.assign(sim.pulls.get(Number(r.ctx.pr.id)), { state: "closed", merged: false, merge_commit_sha: null, closed_at: "2026-10-18T01:00:00Z" });
      await ended(r);
      ok(r.status === "succeeded" && r.result === "closed" && !r.ctx.merged && E.cards.get(c.id).status === "cancelled" && ledger(E, r, "detected-close")[0]?.data?.merged === false && !ledger(E, r, "merge-ack").length,
        "a pull request closed unmerged on GitHub ends the Task closed, the card cancelled, detected-close recorded", `${r.status} ${r.result}`);
    } finally { stop(); }
  }

  // ---------- retargeted on GitHub to another branch, then merged there: not a merge into the base; the Task ends closed and says so ----------
  {
    must(bare, ["branch", "-f", "release", "main"]);
    const { E, stop } = await install(plain, { watchMs: 100 });
    try {
      const r = await start(E, "crew/retarget"); const c = openCard(E, r);
      const sha = remoteMerge(r.ctx.pr.branch, "release");
      Object.assign(sim.pulls.get(Number(r.ctx.pr.id)), { base: { ref: "release" }, state: "closed", merged: true, merge_commit_sha: sha, merged_at: "2026-10-18T03:00:00Z" });
      await ended(r); const d = ledger(E, r, "detected-close")[0];
      ok(r.status === "succeeded" && r.result === "closed" && !r.ctx.merged && E.cards.get(c.id).status === "cancelled" && d?.data?.retargeted === true && d.data.actualBase === "release" && d.data.mergedElsewhere === true && d.data.sha === sha && !ledger(E, r, "detected-merge").length
        && /retargeted to release on GitHub and merged there/.test(r.nodes["merge-card"].note ?? ""),
        "a pull request retargeted to another branch and merged there is recorded with that branch and ends the Task closed, with the reason", `${r.status} ${r.result} ${r.nodes["merge-card"]?.note}`);
    } finally { stop(); }
  }

  // ---------- after a restart: an open merge card whose pull request was merged meanwhile ----------
  {
    const first = await install(plain), data = first.H.data; let runId = "", cardId = "", prId = 0;
    try { const r = await start(first.E, "crew/restart"); runId = r.id; cardId = openCard(first.E, r)?.id; prId = Number(r.ctx.pr.id); } finally { first.stop(); }
    ok(!!cardId, "the merge card was open when Studio stopped");
    const restartSha = remoteMerge("crew/restart"); Object.assign(sim.pulls.get(prId), { state: "closed", merged: true, merge_commit_sha: restartSha, merged_at: "2026-10-18T02:00:00Z" });
    const second = await install(plain, { data, watchMs: 100 });
    try {
      second.E.load(); const r = second.E.get(runId)!; await ended(r);
      ok(r.status === "succeeded" && r.ctx.merged?.detected === true && second.E.cards.get(cardId).status === "cancelled" && ledger(second.E, r, "detected-merge")[0]?.data?.sha === restartSha && r.ctx.afterTree === restartSha,
        "on restart the open merge card is reconciled the same way: the Task ends merged", `${r?.status}`);
    } finally { second.stop(); }
  }
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { sim.stop(); }
end();
