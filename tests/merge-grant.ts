import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The captain-only card that grants (or revokes) Studio's merge for one repository (src/github-merge-grant.ts). Firstmate may
// propose it, never answer it; a read-only probe checks the GitHub token first, and a token without what merging needs gets a
// card that says what is missing and writes nothing; the captain's grant re-signs the project's grant with the operations added,
// compare-and-set on the registry, and records grant-merge (repository, method, the answer's seq); revoking re-signs it without
// them and records revoke-merge. An R-069-shaped Task (a private repository on a free plan: GitHub does not show branch
// protection; every gate green) whose merge card says the operations grant is missing offers, once merge is granted, the
// captain-only Merge with its acknowledgement; revoked, the merge goes back to GitHub. Offline: the GitHub simulator only.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { GitHubPoller } from "../src/github-poller";
import { OBSERVED_MERGE } from "../src/domain/remote-ci";
import { grantSignature, verifyGitHubGrant } from "../src/github-grant";
import { installFirstmate } from "../src/firstmate";
import { startMergeGrant, proposeMergeGrant, MERGE_GRANT_WORKFLOW } from "../src/github-merge-grant";
import { mergeAccessOf } from "../src/adapters/github";
import { bundledText } from "../src/bundled";
import { must, setGitHome } from "../src/git";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("merge-grant");
process.env.CREW_GH_NO_CLI = "1"; // the token is the fixture's file below, never gh's
const temp = checkedTempDir("merge-grant-"); setGitHome(join(temp, "git-home"));
const repo = join(temp, "source"), bare = join(temp, "remote.git"); mkdirSync(repo); assertTempRepo(repo);
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "file"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]); must(repo, ["remote", "add", "origin", "https://github.com/fixture/project.git"]);
must(temp, ["clone", "--bare", "-q", repo, bare]); must(repo, ["remote", "set-url", "origin", bare]);
const sim = githubSimulator(bare);
const PLAN = { message: "Upgrade to GitHub Pro or make this repository public to enable this feature.", documentation_url: "https://docs.github.com/rest/branches/branch-protection" };
const POLICY = "/branches/main/protection/required_status_checks";
const REPO_OK = { full_name: "fixture/project", private: true, allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false, permissions: { admin: false, maintain: false, push: true, triage: true, pull: true } };
const GATES = ["branch", "rebase", "scope", "failfirst", "ci", "approval", "design"];
const commit = (text: string) => { writeFileSync(join(repo, "file"), text); must(repo, ["commit", "-qam", text]); return must(repo, ["rev-parse", "HEAD"]); };
const rows = (head: string) => { sim.expect("GET", `/commits/${head}/check-runs?filter=all&per_page=100&page=1`, { total_count: 1, check_runs: [{ id: 1, name: "test", app: { id: 15368 }, head_sha: head, status: "completed", conclusion: "success" }] }); sim.expect("GET", `/commits/${head}/status?per_page=100&page=1`, { sha: head, total_count: 0, statuses: [] }); };
const ids = (c: any) => (c?.options ?? []).map((o: any) => o.id).join();
const puts = (from: number) => sim.calls.slice(from).filter((k: any) => k.method === "PUT");
const all = (c: any) => Array.from({ length: c?.detail?.intents?.length ?? 0 }, (_, i) => i);

const flow = Y({ id: "board-flow", name: "Board merge", roles: [], nodes: [
  { id: "seed", kind: "hook", do: "fixture.seed", label: "Seed", x: 0, y: 0 }, { id: "pr-open", kind: "hook", do: "pr.open", label: "Review request", x: 1, y: 0 },
  { id: "merge-card", kind: "card", label: "Merge card", args: { body_from: "merge", card_kind: "merge" }, card: { confirm_door: true, door_from: "door" }, x: 2, y: 0 },
  { id: "merge", kind: "hook", do: "git.merge", label: "Merge", x: 3, y: 0 }, { id: "done", kind: "hook", label: "Merged", x: 4, y: 0 },
  { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 3, y: 1 }],
  edges: [["seed", "pr-open"], ["pr-open", "merge-card", "ok"], ["pr-open", "closed", "close"], ["merge-card", "merge", "merge"], ["merge-card", "closed", "close"], ["merge", "done"]] });

// the same Task with a step after the pull request opened that hand-edits an unsigned operations grant into the registry
const forgeFlow = Y({ ...JSON.parse(flow), id: "forge-flow", name: "Forged merge", nodes: [...JSON.parse(flow).nodes, { id: "forge", kind: "hook", do: "fixture.forge", label: "Forge", x: 1, y: 1 }],
  edges: [["seed", "pr-open"], ["pr-open", "forge", "ok"], ["forge", "merge-card"], ["merge-card", "merge", "merge"], ["merge-card", "closed", "close"], ["merge", "done"]] });
const H = await harness([flow, forgeFlow, bundledText(`workflows/v2/${MERGE_GRANT_WORKFLOW}.wf.yaml`)!, bundledText("workflows/v2/firstmate-connect-github.wf.yaml")!]), E = H.engine, projects = new Projects(H.data), poller = new GitHubPoller();
writeFileSync(join(H.data, "github-token"), "fake-token");
const base = { mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-17T00:00:00Z", approvalId: "R-000/SC-000" } as any;
base.signature = grantSignature(H.data, { id: "proj", path: repo, base: "main" }, base);
writeFileSync(join(H.data, "projects.json"), JSON.stringify([{ id: "proj", name: "Project", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, github: base }], null, 1));
installCode(E, { dataDir: H.data, projects, poller, mergeWatchMs: 60_000 });
const tools = installFirstmate(E, projects); // installs the merge grant (and Firstmate's tools) as Studio does
E.actions["fixture.forge"] = () => { const list = JSON.parse(readFileSync(join(H.data, "projects.json"), "utf8")); list[0].github.operations = { version: 1, repository: "fixture/project", approvalId: "hand", approvedAt: "2026-10-18T00:00:00Z", mergeMethod: "merge", enableRealWrites: true }; writeFileSync(join(H.data, "projects.json"), JSON.stringify(list, null, 1)); return "ok"; };
E.actions["fixture.seed"] = (x) => {
  const branch = x.run.params.branch; must(repo, ["fetch", "-q", bare, "main"]); const tip = must(repo, ["rev-parse", "FETCH_HEAD"]); must(repo, ["checkout", "-qb", branch, tip]); const head = commit(branch); must(repo, ["checkout", "-q", "main"]);
  Object.assign(x.ctx, { project: "proj", repo, worktree: repo, base: "main", baseCommit: tip, head, gatedHead: head, branch, door: { door: "two-way" }, spec: { title: "Board", what: "w", why: ["y"], done: ["d"], scope: ["file"] } });
  for (const name of GATES) E.record(x, "fixture-gate", { check: `firstmate/gate-${name}`, head, verdict: "pass" } as any);
  must(repo, ["checkout", "-q", branch]); rows(head); return "ok";
};
const openCard = (r: any) => E.cards.list({ run: r.id, open: true })[0];
const task = async (branch: string) => { const r = E.start({ workflow: "board-flow", text: "board merge", params: { branch } }); await until(() => (!!openCard(r) && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status), 20000); return r; };
const grantRun = async (action: "grant" | "revoke", by = "captain (test)") => { const r = startMergeGrant(E, projects, "proj", action, by); await until(() => (!!openCard(r) && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status), 15000); return r; };
const ended = (r: any) => until(() => ["succeeded", "failed", "cancelled"].includes(r.status) && !E.busy(r.id), 15000);
const registry = () => readFileSync(join(H.data, "projects.json"), "utf8");
const grantOf = () => JSON.parse(registry())[0].github;
const ledger = (r: any, record: string) => E.trusted(r.id).entries.filter((e: any) => e.record === record);
const refusal = async (card: string, a: any) => { try { await E.answer(card, a); return ""; } catch (e: any) { return e.message; } };

try {
  sim.expect("GET", POLICY, PLAN, undefined, 403);

  // ---------- the probe's verdict, from GitHub's repository answer as the token sees it ----------
  {
    const read = mergeAccessOf("fixture/project", { ...REPO_OK, permissions: { push: false, pull: true } }, null, "classic");
    const scope = mergeAccessOf("fixture/project", REPO_OK, "read:org, gist", "classic");
    const good = mergeAccessOf("fixture/project", REPO_OK, "repo, read:org", "classic");
    const none = mergeAccessOf("fixture/project", { ...REPO_OK, allow_merge_commit: false, allow_squash_merge: false }, null, "other");
    const fine = mergeAccessOf("fixture/project", REPO_OK, null, "fine-grained");
    const hidden = mergeAccessOf("fixture/project", { full_name: "fixture/project" }, null, "other");
    ok(/write access to fixture\/project: .* pull access only/.test(read.missing[0]?.en ?? "") && /repo scope/.test(scope.missing[0]?.en ?? "") && !good.missing.length && good.methods?.join() === "squash,merge" && good.preferred === "squash",
      "read-only access and a classic token without the repo scope are missing; push with repo passes, its allowed methods read, squash offered first", JSON.stringify({ read: read.missing, scope: scope.missing, good }));
    ok(/allows none of merge, squash or rebase/.test(none.missing[0]?.en ?? "") && /does not show this token's permissions/.test(hidden.missing[0]?.en ?? "") && hidden.methods === null && /Contents: write and Pull requests: write/.test(fine.unseen?.en ?? "") && !fine.missing.length,
      "no allowed method and no permissions shown are missing; a fine-grained token says what GitHub cannot show");
    let other = ""; try { mergeAccessOf("fixture/project", { ...REPO_OK, full_name: "someone/else" }, null, "other"); } catch (e: any) { other = e.message; }
    ok(/another repository/.test(other), "an answer for another repository is refused");
  }

  // ---------- an R-069-shaped Task: the merge card names the missing grant and links to where it is granted ----------
  const t1 = await task("crew/r069"); const c1 = openCard(t1);
  ok(c1?.title.en.endsWith("merge it on GitHub") && ids(c1) === "close,changes" && !c1.acknowledge && c1.body.includes("Missing permission: merge")
    && c1.links.some((l: any) => l.label === "Grant Studio merge for fixture/project…" && l.href === "#/project/proj?github=merge") && /on this card \(or the project's GitHub settings\) opens the card/.test(c1.sections.en.why),
    "no operations grant: the merge card offers 'Grant Studio merge for fixture/project…', linking to the project's GitHub settings", `${ids(c1)} ${JSON.stringify(c1?.links)}`);

  // ---------- the token lacks permission: the card explains, nothing is granted ----------
  {
    sim.expect("GET", "", { ...REPO_OK, permissions: { push: false, pull: true } });
    const before = registry(), r = await grantRun("grant"); const c = openCard(r);
    ok(c?.captainOnly && c.title.en === "Studio cannot get merge permission for fixture/project yet" && ids(c) === "check,close" && /Missing: write access to fixture\/project/.test(c.sections.en.why) && /Nothing was granted/.test(c.sections.en.why) && /缺少/.test(c.sections["zh-TW"].why),
      "a token with read access only: the card says what is missing and offers check again or close", `${c?.title?.en} | ${c?.sections?.en?.why}`);
    // fixed on GitHub, then Check again reads the token again and raises the grant card
    sim.expect("GET", "", REPO_OK);
    await E.answer(c.id, { choice: "check", by: "captain" } as any); await until(() => openCard(r)?.id !== c.id && !!openCard(r) && !E.busy(r.id), 10000);
    const again = openCard(r);
    ok(ids(again) === "grant-squash,grant-merge,close" && again.options[0].primary && registry() === before && !grantOf().operations, "check again after the fix raises the grant card; nothing was written meanwhile", ids(again));
    await E.answer(again.id, { choice: "close", by: "captain" } as any); await ended(r);
    ok(r.status === "succeeded" && r.result === "closed" && registry() === before && !ledger(r, "grant-merge").length, "closed without granting: the registry is unchanged, no grant-merge", r.status);
  }

  // ---------- Firstmate proposes; only the captain answers ----------
  let granted: any;
  {
    const r = await grantRun("grant", "Firstmate merge grant proposal (captain approval required)"); const c = openCard(r);
    ok(c?.captainOnly && c.title.en === "Grant Studio merge for fixture/project?" && ids(c) === "grant-squash,grant-merge,close" && c.options[0].label === "Grant merge (squash)"
      && /only after every Studio gate passed at the pull request's head and you confirm that merge on its own merge card/.test(c.sections.en.why)
      && c.sections.en.scope.out.includes("Merging without your confirmation on each pull request's merge card") && c.sections.en.scope.out.some((s: string) => s.startsWith("Pushing to main")) && c.sections.en.scope.out.includes("Changing branch protection or repository settings")
      && /Revocable: revoke it any time/.test(c.body) && /可撤銷/.test(c.body) && /fixture\/project allows squash, merge; squash is offered first/.test(c.body) && /授權 Studio 合併/.test(c.title["zh-TW"]),
      "the grant card says what Studio will and never does, offers the allowed methods (the default first) and that it is revocable", `${ids(c)} | ${c?.body}`);
    ok(/Only the captain grants or revokes Studio merge/.test(await refusal(c.id, { choice: "grant-squash", by: "firstmate" })) && /Only the captain/.test(await refusal(c.id, { choice: "close", by: "firstmate" }))
      && /Only the captain/.test(await refusal(c.id, { choice: "grant-squash", by: "auth window G-1 (granted by captain)" })) && E.cards.get(c.id).status === "open" && !grantOf().operations,
      "Firstmate (and an authorization window) cannot answer the grant card, not even close it; nothing is written");
    const identity = projects.staffingIdentity("proj");
    await E.answer(c.id, { choice: "grant-merge", by: "captain" } as any); await ended(r); granted = r;
    const g = grantOf(), answer = ledger(r, "card-answer").find((e: any) => e.data?.card === c.id), rec = ledger(r, "grant-merge")[0];
    ok(r.status === "succeeded" && g.operations?.mergeMethod === "merge" && g.operations.repository === "fixture/project" && g.operations.approvalId === `${r.id}/${c.id}` && g.operations.enableRealWrites === true,
      "the captain's grant writes the operations grant (the picked method) into the project's GitHub grant", `${r.status} ${r.error ?? ""} ${JSON.stringify(g.operations)}`);
    let verified = ""; try { verifyGitHubGrant(H.data, JSON.parse(registry())[0]); projects.assertExecutable({ project: "proj", base: "main" }); verified = "ok"; } catch (e: any) { verified = e.message; }
    ok(verified === "ok" && g.signature === grantSignature(H.data, { id: "proj", path: repo, base: "main" }, g), "the written grant is signed the way Connect signs it, and verifies", verified);
    ok(rec?.data?.repository === "fixture/project" && rec.data.method === "merge" && rec.data.answerSeq === answer?.seq && rec.data.card === c.id && /^captain/.test(String(rec.actor)),
      "the ledger records grant-merge with the repository, the method and the captain's answer seq", JSON.stringify(rec));
    ok(projects.staffingIdentity("proj").identity === identity.identity, "granting merge keeps the project's staffing identity (its approved crew stays)");
  }

  // ---------- after the grant: the open merge card offers the captain-only Merge with the acknowledgement ----------
  {
    await until(() => openCard(t1)?.id !== c1.id && !E.busy(t1.id), 10000);
    const c = openCard(t1), h = t1.ctx.pr?.head;
    ok(E.cards.get(c1.id).status === "cancelled" && ids(c) === `${OBSERVED_MERGE},close,changes` && c.captainOnly && c.acknowledge?.option === OBSERVED_MERGE && c.acknowledge.id.startsWith(`observed-merge:${h}:`) && /merge card SC-\d+ prepared again/.test(String(granted.nodes.write?.note)),
      "the R-069-shaped Task's merge card is prepared again: the captain-only Merge with the acknowledgement", `${ids(c)} | ${granted.nodes.write?.note}`);
    const before = sim.calls.length;
    ok(/Only the captain merges/.test(await refusal(c.id, { choice: OBSERVED_MERGE, by: "firstmate", ack: c.acknowledge?.id, aligned: all(c) })), "Firstmate still cannot merge");
    sim.expect("PUT", `/pulls/${t1.ctx.pr.id}/merge`, { merged: true }, { sha: h, merge_method: "merge" });
    await E.answer(c.id, { choice: OBSERVED_MERGE, by: "captain", ack: c.acknowledge.id, aligned: all(c) } as any); await ended(t1);
    const put = puts(before);
    ok(t1.status === "succeeded" && put.length === 1 && put[0].body?.sha === h && put[0].body?.merge_method === "merge" && t1.ctx.merged?.sourceHead === h, "the captain's acknowledged Merge sends one merge PUT with the granted method", `${t1.status} ${t1.error ?? ""} ${JSON.stringify(put.map((p: any) => p.body))}`);
  }

  // ---------- revoking: signed, recorded, and the open merge card goes back to GitHub ----------
  {
    const t2 = await task("crew/after-grant"); const m = openCard(t2);
    ok(ids(m) === `${OBSERVED_MERGE},close,changes`, "a Task's merge card under the grant offers Studio's Merge", ids(m));
    let refused = ""; try { proposeMergeGrant(projects, "proj", "grant"); } catch (e: any) { refused = e.message; }
    ok(/already merges for fixture\/project \(merge\); revoke it first/.test(refused), "a second grant is refused while one stands", refused);
    const r = await grantRun("revoke"); const c = openCard(r);
    ok(c?.captainOnly && c.title.en === "Revoke Studio merge for fixture/project?" && ids(c) === "revoke,close" && /with the merge method/.test(c.sections.en.why) && /each merge card offers merging on GitHub again/.test(c.sections.en.why) && /撤銷/.test(c.title["zh-TW"]), "the revoke card is captain-only and says what changes", c?.sections?.en?.why);
    ok(/Only the captain/.test(await refusal(c.id, { choice: "revoke", by: "firstmate" })), "Firstmate cannot revoke either");
    await E.answer(c.id, { choice: "revoke", by: "captain" } as any); await ended(r);
    const g = grantOf(), rec = ledger(r, "revoke-merge")[0], answer = ledger(r, "card-answer").find((e: any) => e.data?.card === c.id);
    let verified = ""; try { verifyGitHubGrant(H.data, JSON.parse(registry())[0]); verified = "ok"; } catch (e: any) { verified = e.message; }
    ok(r.status === "succeeded" && !g.operations && verified === "ok" && rec?.data?.method === "merge" && rec.data.repository === "fixture/project" && rec.data.answerSeq === answer?.seq,
      "revoking removes the operations grant, re-signed (it verifies), and records revoke-merge with the method and the answer seq", `${r.status} ${r.error ?? ""} ${verified} ${JSON.stringify(rec)}`);
    await until(() => openCard(t2)?.id !== m.id && !E.busy(t2.id), 10000);
    const back = openCard(t2);
    ok(E.cards.get(m.id).status === "cancelled" && back?.title.en.endsWith("merge it on GitHub") && ids(back) === "close,changes" && !back.acknowledge, "after revoking, the open merge card offers only the GitHub path again", `${ids(back)} ${back?.title?.en}`);
    await E.answer(back.id, { choice: "close", by: "captain" } as any); await ended(t2);
  }

  // ---------- registry CAS: a registry that changed under the card is never overwritten ----------
  {
    const r = await grantRun("grant"); const c = openCard(r);
    const list = JSON.parse(registry()); list.push({ id: "other", name: "Other", path: null, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null });
    writeFileSync(join(H.data, "projects.json"), JSON.stringify(list, null, 1)); const changed = registry();
    await E.answer(c.id, { choice: "grant-squash", by: "captain" } as any); await ended(r);
    ok(r.status === "failed" && registry() === changed && !grantOf().operations && !ledger(r, "grant-merge").length && /registry changed|propose it again/i.test(String(r.error ?? JSON.stringify(r.failure ?? ""))),
      "the registry changed after the card was raised: the grant is refused, the registry left as it is", `${r.status} ${r.error} ${JSON.stringify(r.failure?.message ?? "")}`);
  }

  // ---------- a hand-edited operations grant does not verify ----------
  {
    const list = JSON.parse(registry()); list[0].github.operations = { version: 1, repository: "fixture/project", approvalId: "hand", approvedAt: "2026-10-18T00:00:00Z", mergeMethod: "squash", enableRealWrites: true };
    writeFileSync(join(H.data, "projects.json"), JSON.stringify(list, null, 1));
    let refused = ""; try { projects.assertExecutable({ project: "proj", base: "main" }); } catch (e: any) { refused = e.message; }
    ok(/not signed by this Studio/.test(refused), "an operations grant written outside the signed path does not verify", refused);
  }

  // ---------- a forged (unsigned) operations grant never lets Studio write: no push, no pull request ----------
  const setGrant = (g: any) => { const list = JSON.parse(registry()); list[0].github = g; writeFileSync(join(H.data, "projects.json"), JSON.stringify(list, null, 1)); };
  {
    const before = sim.calls.length, r = E.start({ workflow: "board-flow", text: "board merge", params: { branch: "crew/forged-open" } });
    await until(() => (!E.busy(r.id) && (["succeeded", "failed"].includes(r.status) || !!openCard(r))), 20000);
    const posts = sim.calls.slice(before).filter((k: any) => k.method === "POST" || k.method === "PUT");
    ok(!r.ctx.pr && !posts.length && !must(bare, ["for-each-ref", "--format=%(refname)", "refs/heads/crew/forged-open"]) && !openCard(r)?.acknowledge,
      "with a forged operations grant the Task opens no pull request and pushes nothing", `${r.status} ${r.error ?? ""} posts=${posts.length} pr=${r.ctx.pr?.id}`);
  }

  // ---------- forged after the pull request opened: the merge card offers no Merge and says the grant is not valid ----------
  setGrant(base);
  {
    const r = E.start({ workflow: "forge-flow", text: "forged merge", params: { branch: "crew/forged-card" } });
    await until(() => (!!openCard(r) && !E.busy(r.id)) || ["succeeded", "failed"].includes(r.status), 20000);
    const c = openCard(r), before = sim.calls.length;
    ok(!!r.ctx.pr && c?.kind === "merge" && ids(c) === "close,changes" && !c.acknowledge && /GitHub grant is not valid/.test(c.sections.en.why) && /授權無效/.test(c.sections["zh-TW"].why),
      "a grant forged after the pull request opened: the merge card offers no Merge and says the grant is not valid", `${ids(c)} | ${c?.sections?.en?.why}`);
    await E.answer(c.id, { choice: "close", by: "captain" } as any); await ended(r);
    ok(!puts(before).length, "no merge PUT was sent");
  }

  // ---------- re-signed through the card: works again; forged again before the PUT: refused ----------
  setGrant(base);
  {
    const g = await grantRun("grant"); const gc = openCard(g);
    await E.answer(gc.id, { choice: "grant-merge", by: "captain" } as any); await ended(g);
    const signed = grantOf();
    const t = await task("crew/resigned"); const c = openCard(t), h = t.ctx.pr?.head;
    ok(g.status === "succeeded" && ids(c) === `${OBSERVED_MERGE},close,changes`, "the grant written again through the card verifies, and the merge card offers Studio's Merge", `${g.status} ${g.error ?? ""} ${ids(c)}`);
    setGrant({ ...signed, operations: { ...signed.operations, approvalId: "hand-edited" } });
    const before = sim.calls.length;
    await E.answer(c.id, { choice: OBSERVED_MERGE, by: "captain", ack: c.acknowledge.id, aligned: all(c) } as any).catch(() => {}); await ended(t);
    ok(t.status !== "succeeded" && !t.ctx.merged && !puts(before).length, "a grant hand-edited after the Merge answer: git.merge refuses before any PUT", `${t.status} ${t.error ?? ""}`);
    setGrant(signed);
    const t2 = await task("crew/resigned-2"); const c2 = openCard(t2), h2 = t2.ctx.pr?.head, before2 = sim.calls.length;
    sim.expect("PUT", `/pulls/${t2.ctx.pr.id}/merge`, { merged: true }, { sha: h2, merge_method: "merge" });
    await E.answer(c2.id, { choice: OBSERVED_MERGE, by: "captain", ack: c2.acknowledge?.id, aligned: all(c2) } as any); await ended(t2);
    ok(!!h && t2.status === "succeeded" && puts(before2).length === 1, "with the signed grant back, Studio's acknowledged Merge sends its one PUT", `${t2.status} ${t2.error ?? ""}`);
  }

  // ---------- Firstmate's proposal (studio_connect_github merge: true): proposes only; never replaces the captain's open card ----------
  {
    const g = await grantRun("revoke"); await E.answer(openCard(g).id, { choice: "revoke", by: "captain" } as any); await ended(g);
    const owner = (captain: boolean) => ({ key: `k-${Math.random()}`, captain, text: "let Studio merge", live: () => true });
    let refused = ""; try { await tools.call("studio_connect_github", { project: "proj", merge: true }, owner(false)); } catch (e: any) { refused = e.message; }
    const res: any = await tools.call("studio_connect_github", { project: "proj", merge: true }, owner(true));
    const run = E.get(res.proposal)!; await until(() => !!openCard(run) && !E.busy(run.id), 15000);
    ok(/Only a current captain request/.test(refused) && res.status === "captain-merge-grant-required" && run.workflow === MERGE_GRANT_WORKFLOW && /^Firstmate/.test(String(run.by ?? run.params?.by ?? "Firstmate")) && openCard(run)?.captainOnly,
      "Firstmate's merge: true proposes the captain-only grant card (only on a captain's request)", `${refused} | ${JSON.stringify(res)}`);
    await E.answer(openCard(run).id, { choice: "close", by: "captain" } as any); await ended(run);
    const mine = await grantRun("grant"); const mc = openCard(mine);
    const list = JSON.parse(registry()); list.push({ id: "third", name: "Third", path: null, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null }); writeFileSync(join(H.data, "projects.json"), JSON.stringify(list, null, 1));
    const again: any = await tools.call("studio_connect_github", { project: "proj", merge: true }, owner(true));
    ok(again.proposal === mine.id && mine.status !== "cancelled" && E.cards.get(mc.id).status === "open", "a Firstmate proposal with different content keeps the captain's open card (it is not cancelled)", `${again.proposal} vs ${mine.id} ${mine.status}`);
    await E.answer(mc.id, { choice: "close", by: "captain" } as any); await ended(mine);
  }
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { poller.stop(); H.stop(); sim.stop(); }
end();
